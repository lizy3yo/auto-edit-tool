import { Router } from "express";
import { Readable } from "stream";

function buildAllowedPrefixes(): string[] {
  const prefixes: string[] = [];
  if (process.env.R2_PUBLIC_URL) prefixes.push(process.env.R2_PUBLIC_URL);
  if (process.env.R2_ACCOUNT_ID)
    prefixes.push(
      `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    );
  return prefixes;
}

// Host-equality, not prefix matching: `startsWith` let an attacker append their own
// domain ("https://pub-x.r2.dev.attacker.com") or use userinfo
// ("https://pub-x.r2.dev@attacker.com") and turn this unauthenticated route into an
// open proxy. https-only so file:/http: to internal hosts can't be smuggled in.
export function isTrustedUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return buildAllowedPrefixes().some(prefix => {
    try {
      return new URL(prefix).host === u.host;
    } catch {
      return false;
    }
  });
}

function extFromContentType(contentType: string, type: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("mp3") || ct.includes("mpeg")) return "mp3";
  if (ct.includes("wav")) return "wav";
  // Unknown/octet-stream: fall back to the caller's media type
  if (type === "video") return "mp4";
  if (type === "audio") return "mp3";
  return "jpg";
}

// Strip a user-supplied title down to a safe filename base (no path
// separators, control chars, or header-breaking quotes). Returns "" if nothing
// usable remains, so the caller falls back to the default name.
export function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[\\/]/g, " ") // path separators
    .replace(/[^\x20-\x7E]/g, "") // non-ASCII: Node rejects >U+00FF header values
    .replace(/[<>:"|?*]/g, "") // illegal on common filesystems
    .replace(/\s+/g, "_")
    .replace(/^[._]+|[._]+$/g, "") // no leading/trailing dots/underscores
    .slice(0, 80)
    .trim();
}

export const downloadRouter = Router();

downloadRouter.get("/", async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    res.status(400).json({ error: "Invalid url encoding" });
    return;
  }

  if (!isTrustedUrl(decoded)) {
    res.status(403).json({ error: "URL not from a trusted source" });
    return;
  }

  try {
    const upstream = await fetch(decoded, {
      // A 3xx must not walk us off the allowlisted host, and a hung upstream must
      // not pin the socket open forever.
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) {
      res
        .status(upstream.status)
        .json({ error: "Failed to fetch file from storage" });
      return;
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", contentType);

    const type = typeof req.query.type === "string" ? req.query.type : "";
    const ext = extFromContentType(contentType, type);
    const rawName = typeof req.query.name === "string" ? req.query.name : "";
    const safeName = sanitizeFilename(rawName);
    const filename = safeName
      ? `${safeName}.${ext}`
      : `download-${type || "file"}-${Date.now()}.${ext}`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    if (upstream.body) {
      Readable.fromWeb(
        upstream.body as Parameters<typeof Readable.fromWeb>[0]
      ).pipe(res);
    } else {
      const buffer = await upstream.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch {
    res.status(500).json({ error: "Download proxy failed" });
  }
});

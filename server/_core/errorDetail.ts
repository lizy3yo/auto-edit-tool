/**
 * Undici's `fetch` reports every connection-level failure as the same opaque
 * `TypeError: fetch failed`, hiding the real reason (DNS, refused, TLS, connect
 * timeout) one level down in `err.cause`. Storing the bare message meant a whole
 * render's worth of scenes surfaced "fetch failed" with nothing to act on.
 *
 * `describeError` walks the cause chain and appends the first thing that
 * actually names the failure, so a persisted `scene.error` stays diagnosable
 * after the process that produced it is gone.
 */
export function describeError(err: unknown): string {
  const base =
    (err as any)?.message ?? (typeof err === "string" ? err : String(err));

  const parts: string[] = [];
  let cause: any = (err as any)?.cause;
  // Cause chains are 1-2 deep in practice; the bound is a cycle guard.
  for (let depth = 0; cause && depth < 4; depth++) {
    const code = cause.code ? String(cause.code) : "";
    const msg = cause.message ? String(cause.message) : "";
    const detail = [code, msg].filter(Boolean).join(": ");
    // Skip a cause that only repeats what the outer message already says.
    if (detail && !base.includes(detail) && !parts.includes(detail)) {
      parts.push(detail);
    }
    cause = cause.cause;
  }

  // undici hangs the target host off the socket-level cause, not the message.
  const host = (err as any)?.cause?.hostname ?? (err as any)?.hostname;
  if (host && !base.includes(host)) parts.push(`host=${host}`);

  return parts.length ? `${base} (${parts.join("; ")})` : base;
}

/**
 * Collapse a raw HTTP error body into one short, readable line for an error message.
 *
 * Provider APIs sit behind Cloudflare, so an origin outage answers a JSON call with a whole
 * HTML error page — one 69Labs 521 pasted ~6 KB of markup into a job's `error` column and the
 * UI. Nothing in that page beyond its title, its error code and the Ray ID is diagnostic.
 *
 *  - HTML: the page `<title>` (Cloudflare titles are `host | 521: Web server is down`), plus
 *    the Ray ID when present — the one string Cloudflare support can look up.
 *  - JSON: the first string under the conventional keys (`error.message`, `message`, `error`,
 *    `detail`), else the compacted document.
 *  - Anything else: whitespace collapsed, then hard-capped.
 *
 * Pure — unit-tested. Callers keep the raw body for their own classifiers (credits, policy,
 * voice-not-found); this only shapes what a PERSON ends up reading.
 */
export function summarizeHttpBody(body: unknown, max = 300): string {
  const raw = typeof body === "string" ? body : safeStringify(body);
  const s = raw.trim();
  if (!s) return "(empty response body)";

  if (/^\s*<(!doctype\s+html|html)[\s>]/i.test(s) || /<html[\s>]/i.test(s)) {
    const title = decodeEntities(
      s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
    );
    const ray = s.match(/Ray ID:\s*(?:<[^>]+>\s*)*([a-f0-9]{12,20})/i)?.[1];
    const heading = decodeEntities(
      s.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i)?.[1] ?? ""
    );
    const label = collapse(title) || collapse(heading) || "HTML error page";
    const cf = /cloudflare/i.test(s) ? "Cloudflare" : "HTML";
    return cap(`${label} [${cf} error page${ray ? `, Ray ${ray}` : ""}]`, max);
  }

  if (/^[\[{]/.test(s)) {
    try {
      const j = JSON.parse(s);
      const pick =
        j?.error?.message ??
        j?.error?.error ??
        j?.message ??
        (typeof j?.error === "string" ? j.error : undefined) ??
        j?.detail ??
        j?.msg;
      if (typeof pick === "string" && pick.trim()) {
        const code = j?.error?.code ?? j?.code;
        const codeStr =
          code !== undefined &&
          code !== null &&
          !String(pick).includes(String(code))
            ? ` (${code})`
            : "";
        return cap(`${collapse(pick)}${codeStr}`, max);
      }
      return cap(JSON.stringify(j), max);
    } catch {
      // not JSON after all — fall through to plain text
    }
  }

  return cap(collapse(s), max);
}

function safeStringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  try {
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

function collapse(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "crypto";

/**
 * `@smithy/node-http-handler` defaults `requestTimeout` to 0, and its `setSocketTimeout`
 * passes that straight to `socket.setTimeout(0)` — which *disables* the timeout. A stalled
 * R2 socket therefore parks its caller forever. That matters most at the end of a longform
 * assembly, where the final upload is the last step and a hang there leaves a live job doing
 * no DB writes, outliving the inactivity watchdog with every clip already rendered.
 *
 * `requestTimeout` maps to `socket.setTimeout`, an INACTIVITY timer that resets on every byte
 * — it does not cap total transfer, so a multi-GB upload that is progressing never trips it.
 * The SDK also classifies the resulting `TimeoutError` as transient and retries it on its own
 * (the Buffer bodies here are replayable), so no retry wrapper is needed.
 */
const R2_CONNECTION_TIMEOUT_MS = Number(
  process.env.R2_CONNECTION_TIMEOUT_MS ?? 10_000
);
const R2_REQUEST_TIMEOUT_MS = Number(
  process.env.R2_REQUEST_TIMEOUT_MS ?? 120_000
);

// ponytail: one client for the process. Was constructed per call, which meant no connection
// reuse across the ~200 per-scene uploads a film does. Credentials are read from the env once;
// if they ever need to rotate without a restart, reset this to null.
let s3Client: S3Client | null = null;

const getS3Client = (): S3Client => {
  if (s3Client) return s3Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 credentials missing: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY"
    );
  }

  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: {
      connectionTimeout: R2_CONNECTION_TIMEOUT_MS,
      requestTimeout: R2_REQUEST_TIMEOUT_MS,
    },
  });
  return s3Client;
};

const getBucket = (): string => {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET is not configured");
  return bucket;
};

const normalizeKey = (relKey: string): string => relKey.replace(/^\/+/, "");

/**
 * `R2_PUBLIC_URL` with any trailing slash removed. A base configured as
 * "https://pub-x.r2.dev/" would otherwise build "https://pub-x.r2.dev//key" — R2 treats the
 * empty leading segment as part of the key and serves a 404, so every upload lands fine and
 * every read of it fails. Mirrors the same normalization in musicBeds.ts.
 */
const publicBase = (): string | undefined => {
  const raw = process.env.R2_PUBLIC_URL;
  return raw ? raw.replace(/\/+$/, "") : undefined;
};

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const s3 = getS3Client();

  await s3.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: data as Buffer,
      ContentType: contentType,
    })
  );

  const publicUrl = publicBase();
  const url = publicUrl ? `${publicUrl}/${key}` : `r2://${getBucket()}/${key}`;
  return { key, url };
}

// ponytail: rehost an external ref image onto R2 so APIMART/gpt-image only ever fetch our CDN.
// Passes through URLs already on R2 (near-zero cost for the normal widget-upload case).
export async function rehostToR2(url: string, prefix: string): Promise<string> {
  const pub = publicBase();
  if (pub && url.startsWith(pub)) return url; // already ours
  const res = await fetch(url, {
    signal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ref image fetch ${res.status} for ${url}`);
  const ct = res.headers.get("content-type") || "image/jpeg";
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const key = `refs/${prefix}-${createHash("sha1")
    .update(url)
    .digest("hex")}.${ext}`;
  const { url: r2 } = await storagePut(
    key,
    Buffer.from(await res.arrayBuffer()),
    ct
  );
  return r2;
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const s3 = getS3Client();

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    { expiresIn: 3600 }
  );

  return { key, url };
}

/**
 * Rewrite one of OUR public `R2_PUBLIC_URL` links into a presigned URL on the S3 API
 * endpoint (`<account>.r2.cloudflarestorage.com`). Anything else passes through untouched.
 *
 * A server-side read of our own bucket has no reason to go out over the public CDN
 * hostname: it is unauthenticated, it needs public access to stay switched on, and — the
 * reason this exists — `*.r2.dev` sits on the DNS blocklist of a lot of managed networks.
 * On one of those, uploads all succeeded (S3 endpoint) while every read back died at
 * `ENOTFOUND pub-<hash>.r2.dev`, so a render burned its whole clips stage and then failed
 * at the first `downloadToTemp` in assembly. The S3 endpoint is a different hostname and
 * stays reachable, so this is also the more robust path even on an unfiltered network.
 *
 * Presigning is local HMAC — no network call — and a failure falls back to the original
 * URL, so this can only widen what works, never narrow it. Signatures last an hour;
 * resolve immediately before the fetch rather than persisting the result anywhere.
 */
export async function presignOwnBucketUrl(url: string): Promise<string> {
  const pub = publicBase();
  if (!pub || !url.startsWith(`${pub}/`)) return url;
  try {
    // The public URL was built as `${base}/${key}` with no encoding, so decoding the
    // pathname reverses whatever `new URL` percent-escaped on the way in.
    const key = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
    if (!key) return url;
    return (await storageGet(key)).url;
  } catch (err: any) {
    console.warn(
      `[storage] presign failed, falling back to the public URL: ${err?.message ?? err}`
    );
    return url;
  }
}

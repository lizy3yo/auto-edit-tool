/**
 * server/tracking.ts — per-video sales attribution.
 *
 * A video's CTA pitches a book. The link that goes in the YouTube description, and the QR shown
 * on screen during that pitch, both point at that book's `shopUrl` with one extra parameter
 * identifying the VIDEO:
 *
 *     https://shop.example/soil-handbook?ref=183
 *
 * The webstore catches `ref` on arrival, carries it to checkout, saves it on the order, and
 * reports the paid sale back to `POST /api/sales`. That is the whole mechanism — this module owns
 * only our half of it: building the URL and rendering it as a scannable QR.
 *
 * Deliberately NOT encoded into the ref: which book. One video can pitch two books, so both links
 * carry the same `ref`, and a visitor can arrive on one book's page and check out with the other.
 * The ref records where they came FROM; the store's order records what they BOUGHT. Collapsing
 * the two would file sales under a book that was never sold, so the store sends `productId`
 * alongside and the two facts are joined at report time.
 *
 * Pure except `renderTrackingQrPng` (rasterizes) — unit-tested.
 */
import jsQR from "jsqr";
import QRCode from "qrcode";
import sharp from "sharp";

/** The query parameter the webstore reads. Changing it breaks every link already published. */
export const TRACKING_PARAM = "ref";

/**
 * Build a video's tracking URL from a book's shop URL.
 *
 * Preserves any query string the shop URL already carries (`?utm_campaign=autumn` survives), and
 * REPLACES rather than appends an existing `ref` so re-deriving a link is idempotent. Returns
 * null when the book has no shop URL, or when it isn't a parseable http(s) URL — a malformed
 * link must surface as "no tracking" rather than ship a QR that leads nowhere.
 */
export function buildTrackingUrl(
  shopUrl: string | null | undefined,
  jobId: number
): string | null {
  const raw = shopUrl?.trim();
  if (!raw) return null;
  // Tolerate a URL typed without a scheme — operators paste "shop.example/book" constantly — but
  // only when there is NO scheme at all. Testing for `https?://` and prefixing otherwise turned
  // `ftp://shop.example/x` into `https://ftp//shop.example/x`, which then sailed through the
  // protocol check below because it really was https by then.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  try {
    const url = new URL(hasScheme ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // A hostname must either be dotted, or be an explicit loopback name. The dot rule alone
    // rejected `http://localhost:4000/buy/book`, which is precisely what a local end-to-end test
    // of the whole tracking loop needs — the guard was catching a typo nobody makes at the cost
    // of the only way to rehearse this before going live.
    const host = url.hostname.toLowerCase();
    const loopback =
      host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (!host.includes(".") && !loopback) return null;
    url.searchParams.set(TRACKING_PARAM, String(jobId));
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Normalize a shop URL for storage: add a missing scheme and drop any tracking parameter already
 * on it. An operator who pastes a link they copied out of a previous video would otherwise store
 * `?ref=183` as part of the BOOK, and every later video would carry the wrong tag.
 *
 * Returns the input unchanged when it isn't parseable — validation is the caller's job.
 */
export function stripTrackingParam(shopUrl: string): string {
  const raw = shopUrl.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  try {
    const url = new URL(hasScheme ? raw : `https://${raw}`);
    url.searchParams.delete(TRACKING_PARAM);
    // Drop a now-empty "?" so the stored value reads cleanly.
    return url.toString().replace(/\?$/, "");
  } catch {
    return raw;
  }
}

/**
 * Read a `ref` back out of a URL — the inverse of `buildTrackingUrl`, used to verify a rendered
 * QR decodes to the video we think it does. Returns null when absent or not a positive integer.
 */
export function parseTrackingRef(url: string): number | null {
  try {
    const value = new URL(url).searchParams.get(TRACKING_PARAM);
    if (!value || !/^\d{1,12}$/.test(value)) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Normalize whatever the webstore sends as `ref` into a job id.
 *
 * Accepts the bare number we issue, and tolerates a full URL or a `ref=`-prefixed string in case
 * a store forwards the landing URL verbatim. Anything else returns null, and the caller stores
 * the raw value with a null jobId so a mis-tagged sale is visible rather than dropped.
 */
export function refToJobId(ref: string | null | undefined): number | null {
  const raw = ref?.trim();
  if (!raw) return null;
  if (/^\d{1,12}$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  if (/^https?:\/\//i.test(raw)) return parseTrackingRef(raw);
  const m = raw.match(/(?:^|[?&])ref=(\d{1,12})(?:&|$)/);
  return m ? Number(m[1]) : null;
}

/**
 * Error-correction level. `M` (~15% recoverable) is the sweet spot for a code that is filmed
 * rather than printed: `L` is fragile against video compression, `H` inflates the module count so
 * far that each module shrinks and scans WORSE at the same on-screen size.
 */
const QR_ERROR_CORRECTION = "M" as const;

/**
 * Quiet-zone modules around the code. The spec requires 4; the assembly overlay already pads the
 * QR onto a white card, so 2 here avoids paying for the margin twice and keeps the modules large.
 */
const QR_QUIET_MODULES = 2;

/**
 * Render a URL as a square PNG QR code.
 *
 * Pure black on pure white — no channel colour, no logo. Both are common ways to make a filmed
 * QR unscannable, and this code has one job.
 *
 * `size` is the pixel width; 1024 matches the still lane so the overlay never upscales it.
 */
export async function renderTrackingQrPng(
  url: string,
  size = 1024
): Promise<Buffer> {
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: QR_ERROR_CORRECTION,
    margin: QR_QUIET_MODULES,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

/**
 * Decode a rendered QR PNG back to the string it encodes.
 *
 * This is the self-check that makes generated QR codes trustworthy: a code that is subtly wrong
 * — wrong link, over-compressed, too small to resolve — looks completely fine to the eye and only
 * surfaces when a customer says the scan did nothing. Reading our own output back closes that.
 *
 * Returns null when nothing decodes. Never throws.
 */
export async function decodeQrPng(png: Buffer): Promise<string | null> {
  try {
    // jsQR wants raw RGBA. Downscale first — it is markedly more reliable on a modest raster
    // than on a 1024px one, and the payload is identical either way.
    const { data, info } = await sharp(png)
      .resize(512, 512, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    return result?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Render a QR AND prove it scans back to the URL requested.
 *
 * Returns the PNG plus a verdict. A failed verification does NOT throw: the caller decides
 * whether to ship the code with a warning or fall back, and a job must never die because a
 * decoder was unsure. `decoded` carries whatever came back, so a mismatch is diagnosable.
 */
export async function renderVerifiedQrPng(
  url: string,
  size = 1024
): Promise<{ png: Buffer; verified: boolean; decoded: string | null }> {
  const png = await renderTrackingQrPng(url, size);
  const decoded = await decodeQrPng(png);
  return { png, verified: decoded === url, decoded };
}

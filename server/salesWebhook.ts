import { timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import {
  getBookById,
  getLongformVideoJobById,
  getVideoTitles,
  recordSale,
} from "./db";
import { refToJobId } from "./tracking";
import type { LongformInputParams } from "../shared/types";

/**
 * server/salesWebhook.ts — the WEBSTORE-FACING API. Two routes, both gated by the same shared
 * secret, both called by the store rather than by a browser:
 *
 *   POST /api/sales             a payment cleared — record it against the video that sold it
 *   GET  /api/videos?ids=1,2,3  job id → title, so the store's report reads by name
 *
 * The store owns the truth about money. `POST /api/sales` keeps a COPY, purely so a video's
 * earnings can be shown beside the video instead of requiring a query against another system.
 * That framing drives every decision here: a lost ping costs a report line, never a sale, so the
 * endpoint prefers recording something imperfect over rejecting it.
 *
 * Guarantees:
 *   - Rejects anything without the correct secret, in constant time.
 *   - `orderId` is UNIQUE, so a retried or replayed ping is ignored rather than double-counted.
 *   - An unrecognised `ref` is STORED with a null jobId rather than dropped — a mis-tagged link
 *     surfaces as an unattributed sale instead of silently vanishing.
 *   - `GET /api/videos` has no side effects and is safe to call on every report load.
 */

/** Env var holding the shared secret. Unset ⇒ the endpoint refuses every request. */
const SECRET_ENV = "SALES_SECRET";

const salesPayload = z.object({
  /** The `?ref=` value the store saved on the order. Null/absent = unattributed. */
  ref: z.string().max(64).nullish(),
  /** The store's own order (or order-line) id — the duplicate guard. */
  orderId: z.string().min(1).max(128),
  /** Integer minor units. Rejected if fractional: money is not a floating-point quantity. */
  amountCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().min(1).max(8).default("USD"),
  /** The store's product identifier — SKU, slug, or id. */
  productId: z.string().min(1).max(128).nullish(),
});

/** Constant-time compare that tolerates unequal lengths without leaking them. */
function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so the reject path doesn't time differently by length.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Match the store's `productId` to one of the books this video actually pitched.
 *
 * Matching is deliberately loose and read-only: the store's SKU is its own vocabulary and will
 * not equal our book id. We check the book's shop URL for the product identifier, then fall back
 * to a title-slug comparison. No match just means the sale is attributed to the video but not to
 * a specific book, which is still the answer the operator mostly wants.
 */
async function matchBookId(
  productId: string | null | undefined,
  jobId: number | null
): Promise<number | null> {
  if (!productId || jobId == null) return null;
  const job = await getLongformVideoJobById(jobId).catch(() => null);
  const ctaBooks = (job?.inputParams as LongformInputParams | null)?.ctaBooks;
  if (!ctaBooks?.length) return null;

  const needle = productId.trim().toLowerCase();
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  for (const book of ctaBooks) {
    if (book.shopUrl && book.shopUrl.toLowerCase().includes(needle)) {
      return book.bookId;
    }
  }
  const needleSlug = slug(needle);
  for (const book of ctaBooks) {
    if (needleSlug && slug(book.title) === needleSlug) return book.bookId;
  }
  // Last resort: a single-book video has only one answer worth giving.
  if (ctaBooks.length === 1) {
    const only = await getBookById(ctaBooks[0].bookId).catch(() => null);
    return only?.id ?? ctaBooks[0].bookId;
  }
  return null;
}

/**
 * Most ids one `GET /api/videos` call may ask for.
 *
 * A report page renders a bounded number of rows, so a request past this is a caller bug rather
 * than a big page — and an unbounded `IN (…)` is how a read endpoint becomes a way to scan the
 * whole table one request at a time.
 */
export const MAX_TITLE_IDS = 500;

/**
 * Shared gate for both store routes. Returns true when the request may proceed; otherwise it has
 * already answered and the caller must return.
 */
function storeAuthOk(req: any, res: any, tag: string): boolean {
  const expected = process.env[SECRET_ENV];
  if (!expected) {
    // Refuse rather than accept-anything. An unconfigured secret is a misconfiguration, and an
    // open endpoint would let anyone invent revenue or enumerate titles.
    console.warn(`[${tag}] ${SECRET_ENV} is not set — rejecting the request`);
    res.status(503).json({ error: "store API not configured" });
    return false;
  }
  if (!secretMatches(req.get("x-sales-secret"), expected)) {
    res.status(401).json({ error: "bad secret" });
    return false;
  }
  return true;
}

export function registerSalesWebhook(app: Express) {
  /**
   * Job id → title, for the store's sales report. Read-only; the store calls it on every report
   * load, so it must stay cheap and free of side effects.
   *
   * Unknown ids — and jobs with no title set — are OMITTED rather than returned as null, so the
   * store has one rule ("absent ⇒ show #id") instead of two.
   */
  app.get("/api/videos", async (req, res) => {
    if (!storeAuthOk(req, res, "Videos")) return;

    const raw = req.query.ids;
    if (typeof raw !== "string") {
      return res.status(400).json({
        error: "pass ids as a comma-separated list, e.g. ?ids=183,205",
      });
    }
    // Non-numeric entries are DROPPED, not rejected: they could never match a job anyway, and the
    // store's fallback already covers "absent". Rejecting the whole request would lose the ids
    // that were fine.
    const ids = Array.from(
      new Set(
        raw
          .split(",")
          .map(s => s.trim())
          .filter(s => /^\d{1,12}$/.test(s))
          .map(Number)
          .filter(n => Number.isSafeInteger(n) && n > 0)
      )
    );
    if (ids.length > MAX_TITLE_IDS) {
      return res
        .status(400)
        .json({ error: `too many ids — the limit is ${MAX_TITLE_IDS}` });
    }
    if (ids.length === 0) return res.status(200).json({});

    try {
      const titles = await getVideoTitles(ids);
      const out: Record<string, string> = {};
      titles.forEach((title, id) => {
        out[String(id)] = title;
      });
      return res.status(200).json(out);
    } catch (err: any) {
      console.error("[Videos] title lookup failed:", err);
      return res.status(500).json({ error: "could not read titles" });
    }
  });

  app.post("/api/sales", async (req, res) => {
    if (!storeAuthOk(req, res, "Sales")) return;

    const parsed = salesPayload.safeParse(req.body);
    if (!parsed.success) {
      // 400, not 500: the store should log and NOT retry a malformed body.
      return res
        .status(400)
        .json({ error: parsed.error.issues.map(i => i.message).join("; ") });
    }
    const { ref, orderId, amountCents, currency, productId } = parsed.data;
    const jobId = refToJobId(ref);

    try {
      const bookId = await matchBookId(productId, jobId);
      const inserted = await recordSale({
        externalOrderId: orderId,
        ref: ref ?? null,
        jobId,
        productId: productId ?? null,
        bookId,
        amountCents,
        currency,
      });
      if (!inserted) {
        // Already recorded. This is SUCCESS from the store's side — it retried, we ignored it.
        return res.status(200).json({ ok: true, duplicate: true });
      }
      if (jobId == null && ref) {
        console.warn(
          `[Sales] order ${orderId} carried ref "${ref}", which matches no video — ` +
            `recorded as unattributed`
        );
      }
      console.log(
        `[Sales] ${orderId} → ${jobId ? `job ${jobId}` : "unattributed"}` +
          `${productId ? ` (${productId})` : ""} ${(amountCents / 100).toFixed(2)} ${currency}`
      );
      return res.status(200).json({ ok: true, jobId, bookId });
    } catch (err: any) {
      // 5xx so the store can retry — the duplicate guard makes that safe.
      console.error(`[Sales] failed to record ${orderId}:`, err);
      return res.status(500).json({ error: "could not record sale" });
    }
  });
}

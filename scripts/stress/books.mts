/**
 * scripts/stress/books.mts — per-video TEST books for the stress channels that have none saved
 * (Hannah Yoder, Quilting With Granny Ruth). A CTA only gets its QR from a book's shop link, so
 * without one those channels could not exercise the CTA at all. The cover is generated once
 * (gpt-image-2, square) and stored in R2; the book is passed to `generate` as a per-video
 * `ctaBooks` entry and is NOT saved to the channel. The shop link is a placeholder.
 *
 *   npx tsx scripts/stress/books.mts     # writes scripts/stress/books/<channel>.json
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateStillWithFallback } from "../../server/providers/fallback";
import { storagePut } from "../../server/storage";
import { getApimartSlotKey } from "../../server/longformVideo";

const BOOKS = [
  {
    channel: "hannah_yoder",
    title: "Plain Sewing: 50 Simple Projects for the Home",
    look: "a plain dark-green cover with a folded stack of homespun cloth, a spool of thread and a needle",
    shop: "https://example.com/books/plain-sewing",
  },
  {
    channel: "quilting_with_granny_ruth",
    title: "Scrap Quilts That Sell",
    look: "a warm cream cover with a folded scrap quilt in bright patchwork squares",
    shop: "https://example.com/books/scrap-quilts-that-sell",
  },
];

// Video 1 tab's own APIMART key — the same provider the pipeline's stills use.
const apimartKey = await getApimartSlotKey(0);
const dir = path.join("scripts", "stress", "books");
mkdirSync(dir, { recursive: true });
for (const b of BOOKS) {
  const r = await generateStillWithFallback({
    prompt:
      `A flat front cover of a paperback how-to book, filling the whole frame, ${b.look}. ` +
      `The title "${b.title}" is printed large and clearly in bold serif lettering at the top. ` +
      "Clean print design, no photo of a person, no other text.",
    square: true,
    apimartKey,
  });
  if (!r.success || !r.fileData) throw new Error(`${b.channel}: ${r.error}`);
  const { url } = await storagePut(
    `longform/stress/book-${b.channel}.png`,
    Buffer.from(r.fileData),
    r.mimeType ?? "image/png"
  );
  writeFileSync(
    path.join(dir, `${b.channel}.json`),
    JSON.stringify([{ title: b.title, coverImageUrl: url, shopUrl: b.shop }], null, 1)
  );
  console.log(`${b.channel}: ${url}`);
}
process.exit(0);

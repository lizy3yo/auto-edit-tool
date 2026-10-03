/**
 * The upsell VSL (the "Upsell VSL" page): a short clip of a channel's host for the top of the
 * upsell page, played right after a purchase — thanks for buying the book, then the bundle
 * offer.
 *
 * It runs on the HeyGen test's engine (`server/heygenTest.ts`: voiced once in the channel's
 * voice, cut to `HEYGEN_TEST_MAX_SEC`, the production lip-sync call) and is stored on the same
 * table as `kind = "vsl"`, saved per channel with the book it thanks the buyer for. What is
 * particular to a VSL lives here, so the form and the server refuse the same thing.
 */
import { countScriptWords, HEYGEN_TEST_MAX_WORDS } from "./heygenTest";

export type HeygenTestKind = "test" | "vsl";

/** Where the book's title goes in a script template. */
export const VSL_BOOK_TOKEN = "{book}";
/** The `bookTitle` column's width. */
export const VSL_MAX_BOOK_TITLE = 255;

/**
 * The starting script: about 50 words before the book's title goes in, of the 84 a 30 s clip
 * holds. No tip — the operator's call on 2026-10-03; a `{tip}` slot was built and removed.
 */
export const VSL_DEFAULT_TEMPLATE =
  `Thank you so much for picking up ${VSL_BOOK_TOKEN}! While you're here, I put the same care ` +
  `into every one of my books, so why not grab a few more? Pick up the bundle and you get the ` +
  `biggest discount I offer anywhere. It's only on this page, and only right now.`;

/** The script as the host says it: every `{book}` replaced by the title. */
export function fillVslScript(template: string, bookTitle: string): string {
  const title = bookTitle.trim();
  return title ? template.split(VSL_BOOK_TOKEN).join(title) : template;
}

/**
 * A saved VSL's script turned back into a template, so the next one for the channel starts from
 * the wording the last one used with the new book's title dropped in.
 */
export function vslTemplateFrom(script: string, bookTitle: string | null): string {
  const title = bookTitle?.trim();
  return title ? script.split(title).join(VSL_BOOK_TOKEN) : script;
}

/** Words left for the script before it passes the 30 s cap (negative when over). */
export function vslWordsLeft(script: string): number {
  return HEYGEN_TEST_MAX_WORDS - countScriptWords(script);
}

/**
 * Why a VSL would be refused beyond the engine's own checks (`heygenTestInputError`), or null.
 * `script` is the filled script — what will be voiced.
 */
export function vslInputError(input: {
  script: string;
  bookTitle: string;
}): string | null {
  if (!input.bookTitle.trim()) return "Type the book the customer just bought.";
  if (input.bookTitle.trim().length > VSL_MAX_BOOK_TITLE)
    return "That book title is too long.";
  if (input.script.includes(VSL_BOOK_TOKEN))
    return `The script still says ${VSL_BOOK_TOKEN} — type the book's title.`;
  return null;
}

/**
 * Pure: which rows change when `pickedBatchId` becomes the upsell page's clip. One clip per
 * channel and book is "in use", so every other picked run of the same channel and book is
 * unpicked. Picking the run already in use unpicks it (the button is a toggle).
 */
export function planVslPick(
  rows: { batchId: string; channelKey: string; bookTitle: string | null; isPicked: boolean }[],
  pickedBatchId: string
): { pick: string[]; unpick: string[] } {
  const target = rows.find(r => r.batchId === pickedBatchId);
  if (!target) return { pick: [], unpick: [] };
  if (target.isPicked) return { pick: [], unpick: [pickedBatchId] };
  const same = (r: (typeof rows)[number]) =>
    r.channelKey === target.channelKey &&
    (r.bookTitle ?? "").trim().toLowerCase() ===
      (target.bookTitle ?? "").trim().toLowerCase();
  const unpick = new Set(
    rows.filter(r => r.isPicked && r.batchId !== pickedBatchId && same(r)).map(r => r.batchId)
  );
  return { pick: [pickedBatchId], unpick: Array.from(unpick) };
}

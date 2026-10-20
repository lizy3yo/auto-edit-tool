// Turns a CUE SHEET written in the script's own words into exact times on the film's clock.
//
// A cue never carries a hand-typed time. It names the words it starts on, the words it ends on,
// and, inside its props, the words each element appears on; this resolver finds them in the word
// transcript. That is the contract Phase 2's planner would write to (the same way the shot list
// names the words each shot starts on), and it is why a graphic cannot drift off its line when
// the voice is re-timed: re-resolve and every element follows its word.
//
// Pure: no I/O, no React — unit-tested in cueResolve.test.ts.
import { MOTION } from "./theme";

export type Word = { text: string; start: number; end: number };

/** A phrase to show, timed word by word against the transcript. */
export type PhraseSpec = { text: string; words: true; from?: string };

export type CueSpec = {
  id: string;
  template: string;
  /** Words the cue starts on (its first word's start). */
  start: string;
  startPad?: number;
  /** Words the cue ends on (their last word's end) — or `durationSec`. A graphic with timed
   * content never stays more than LINGER_SEC past its last word, whatever this says. */
  end?: string;
  endPad?: number;
  durationSec?: number;
  props: Record<string, unknown>;
};

export type ResolvedCue = {
  id: string;
  template: string;
  start: number;
  end: number;
  props: Record<string, unknown> & { durationSec: number };
  /** Every word-timed element: what it shows, the word it waits for, and when that word starts.
   * `prop`: the path in `props` of the cue-relative seconds the element is DRAWN at, when it is not
   * simply its word (a Versus side's sub, `left.subAt`) — QA reads the drawn time from there. */
  sync: { element: string; word: string; wordStart: number; onCut?: boolean; prop?: string }[];
  /** Which edges were snapped onto a picture cut; `held` when the end was held through a pause to
   * the cut so no blink of footage is left (MIN_SHOT_SEC). */
  conformed: { start: boolean; end: boolean; held?: boolean };
  /** The same edges as FRAME NUMBERS — what the composite switches on (first frame shown) and
   * off (first frame NOT shown). Seconds rounded to the millisecond can land either side of a
   * frame and put one frame of graphic on the next shot. */
  startFrame: number;
  endFrame: number;
  /** When its first WORDS are drawn (seconds on the film's clock, on a frame), when that is later
   * than `start`: a graphic whose elements wait for their words shows nothing before them (a label
   * that appears on "@a mower blade" 1.2 s into a cue snapped back onto the cut, job 413). Every
   * reading time is measured from here (`shownFrom`). Unset ⇒ its words show from `start`. */
  shownAt?: number;
  /** When the last of the graphic's own words is spoken (seconds), if it has any. */
  contentEnd?: number;
  /** Seconds it needs on screen to be read (`readingSec`); the QA measures lingering past it. */
  readSec?: number;
  /** Seconds it needs once a new clause it does not show has begun (`readAlongSec`, and its last
   * element on screen LINGER_SEC): the reading time that counts when it stays past `newClauseAt`. */
  readAlongSec?: number;
  /** When the first words it does NOT show began while it was up — a new clause after its own words,
   * or the next sentence (`ownSentenceEnd`). */
  newClauseAt?: number;
  /** It left in the next pause (within PAUSE_REACH_SEC) instead of mid-word. */
  leftInPause?: boolean;
  /** When its own words finished, as said (`ownSentenceEnd`): the words after its own last word that
   * only finish its sentence — never a new clause of it — among those said while it was up. A hold is
   * measured from here, and so is every graphic's lingering (`stillUpAfterWords`), the same in the
   * resolver and the QA. */
  spokenEnd?: number;
  /** A picture-replacing graphic that leaves WITH the picture, on a cut the hold rule covers
   * (`holdToCut`) — held there, or its end already on it: that cut, and how long after `spokenEnd`
   * the rule lets it stay (CARD_HOLD_SILENT_MAX_SEC when nothing more is said before the cut, else
   * CARD_HOLD_MAX_SEC). It excuses staying until THAT cut, never past it. */
  hold?: { cut: number; max: number };
};

/** Lower-case, digits kept, punctuation dropped; "10-year" → ["10", "year"]. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(/[\s\-–—/]+/)
    .map(t => t.replace(/[^a-z0-9']/g, "").replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9 };

/**
 * A number spoken in words, from `toks[i]`: "twenty five" → 25, "a hundred and fifty" → 150,
 * "three million" → 3000000. Returns the value and how many tokens it took, or null when
 * `toks[i]` does not start a number in words.
 */
export function parseSpokenNumber(toks: string[], i: number): { value: number; n: number } | null {
  let total = 0, cur = 0, n = 0, any = false;
  for (let j = i; j < Math.min(toks.length, i + 8); j++) {
    const t = toks[j];
    if (t in UNITS) cur += UNITS[t];
    else if (t in TENS) cur += TENS[t];
    else if (t === "hundred" && (any || toks[j - 1] === "a")) cur = (cur || 1) * 100;
    else if (t in SCALES && (any || toks[j - 1] === "a")) {
      total += (cur || 1) * SCALES[t];
      cur = 0;
    } else if (t === "a" && !any && (toks[j + 1] === "hundred" || toks[j + 1] in SCALES)) {
      n++;
      continue;
    } else if (t === "and" && any && (toks[j + 1] in UNITS || toks[j + 1] in TENS)) {
      n++;
      continue;
    } else break;
    any = true;
    n++;
  }
  return any ? { value: total + cur, n } : null;
}

/** Are `a` and `b` at most `max` single-letter edits apart (a letter added, dropped or changed)?
 * Stops as soon as every way through costs more. Pure. */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * Two spellings of ONE word, the way speech-to-text writes a word differently from the script:
 * - from four letters, one letter CHANGED ("disc" heard as "disk", job 384);
 * - from seven letters, one edit per seven letters of ANY kind, a letter added or dropped as well:
 *   the rare word the transcriber has to guess (a Latin name, a brand, a coined term). Walter's job
 *   411 (1:47) heard the robin's "migratorius" as "migratorious", one letter longer. One changed
 *   letter was forgiven only between words of EQUAL length, so the script's spelling could not be
 *   anchored ('start words "ends in the word migratorius" not found'), the repair round took the
 *   transcript's, and the term card showed "migratorious" beside a field guide printing "migratorius".
 * Never a word with a digit, never under four letters, and no letter added or dropped under seven,
 * where one letter usually makes another word ("though"/"through", "plane"/"planet"). Pure.
 */
export function closeSpelling(a: string, b: string): boolean {
  if (a === b || /\d/.test(a + b)) return false;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 4) return false;
  if (shorter < 7) return oneLetterChanged(a, b);
  return withinEdits(a, b, Math.floor(shorter / 7));
}

/** The same length, four letters or more, no digit, and exactly one letter different. Pure. */
function oneLetterChanged(a: string, b: string): boolean {
  if (a.length < 4 || a.length !== b.length || /\d/.test(a + b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length && diff < 2; i++) if (a[i] !== b[i]) diff++;
  return diff === 1;
}

/**
 * One word for another: case, number words ("three" = "3"), a plural "s", an apostrophe one side
 * writes and the other leaves out ("robin's" heard as "robins"), and a close spelling
 * (`closeSpelling`). Never for short words, where one letter is a new word.
 * `spelling` false is the measure for two words JOINED into one (a compound split differently on each
 * side, `step`): only one letter changed, never one added — "a seasoned" joined is "aseasoned", one
 * letter from "seasoned", and an article must not be read as part of the next word (job 407's Versus
 * side "a seasoned one" would have had its sub land on "seasoned", a word late).
 */
function same(a: string, b: string, spelling = true): boolean {
  if (a === b) return true;
  const x = NUMBER_WORDS[a] ?? a;
  const y = NUMBER_WORDS[b] ?? b;
  if (x === y || x === `${y}s` || y === `${x}s`) return true;
  // A trailing -d, like the plural -s: "lap-sized" against a transcript's "lap size".
  if (x.length >= 4 && y.length >= 4 && (x === `${y}d` || y === `${x}d`)) return true;
  if (!spelling) return oneLetterChanged(x, y);
  // The apostrophe, from four letters ("it's" and "its" stay apart).
  const bareX = x.replace(/'/g, "");
  if (bareX.length >= 4 && bareX === y.replace(/'/g, "")) return true;
  return closeSpelling(x, y);
}
/** The resolver's one word for another (`same`), for a check that holds a graphic's shown words to
 * the spoken ones by the same measure (the planner's steps, which have no word-timed line), and for
 * putting a shown word back in the script's spelling (planner `inScriptSpelling`). */
export const sameWord = (a: string, b: string): boolean => same(a, b);

/**
 * Match want[k] at index[i], forgiving how the two sides SPLIT a compound — the script's
 * "multipacks" against the transcript's "multi-packs", "10-year" against "10 year" — and a number
 * READ DIGIT BY DIGIT: "10-year" against "one zero year" (job 384's voice, 2:29). Returns the tokens
 * consumed on each side, or null.
 */
const digitOf = (t: string) => (/^\d$/.test(NUMBER_WORDS[t] ?? "") ? NUMBER_WORDS[t] : t);
function step(index: TokenIndex, i: number, want: string[], k: number): { di: number; dk: number } | null {
  if (i >= index.length || k >= want.length) return null;
  if (same(index[i].tok, want[k])) return { di: 1, dk: 1 };
  // A whole number in words on one side and digits on the other: the script's "twenty-five"
  // against the transcript's "25", or the other way round.
  if (/^\d+$/.test(index[i].tok)) {
    const p = parseSpokenNumber(want, k);
    if (p && String(p.value) === index[i].tok) return { di: 1, dk: p.n };
  }
  if (/^\d+$/.test(want[k])) {
    const p = parseSpokenNumber(index.slice(i, i + 6).map(x => x.tok), 0);
    if (p && String(p.value) === want[k]) return { di: p.n, dk: 1 };
  }
  if (i + 1 < index.length && same(index[i].tok + index[i + 1].tok, want[k], false)) return { di: 2, dk: 1 };
  if (i + 1 < index.length && /^\d+$/.test(want[k]) && digitOf(index[i].tok) + digitOf(index[i + 1].tok) === want[k]) return { di: 2, dk: 1 };
  if (k + 1 < want.length && same(index[i].tok, want[k] + want[k + 1], false)) return { di: 1, dk: 2 };
  return null;
}

/** Token positions of `want` matched consecutively from `i` (one entry per want token), or null. */
function runAt(index: TokenIndex, i: number, want: string[]): number[] | null {
  const hits: number[] = [];
  let k = 0;
  while (k < want.length) {
    const s = step(index, i, want, k);
    if (!s) return null;
    for (let j = 0; j < s.dk; j++) hits.push(i);
    i += s.di;
    k += s.dk;
  }
  return hits;
}

/** The transcript flattened to one token per entry, each pointing back to its word. */
export type TokenIndex = { tok: string; word: number }[];

export function indexWords(words: Word[]): TokenIndex {
  const out: TokenIndex = [];
  words.forEach((w, i) => tokens(w.text).forEach(tok => out.push({ tok, word: i })));
  return out;
}

/**
 * First place at or after token `from` where `phrase`'s tokens occur CONSECUTIVELY.
 * Returns the token positions, or null.
 */
export function findPhrase(index: TokenIndex, phrase: string, from = 0): number[] | null {
  const want = tokens(phrase);
  if (want.length === 0) return null;
  for (let i = Math.max(0, from); i < index.length; i++) {
    const hits = runAt(index, i, want);
    if (hits) return hits;
  }
  return null;
}

/**
 * `phrase`'s tokens IN ORDER from token `from`, each within `maxGap` tokens of the one before —
 * a card may drop words the narrator says ("thick, greasy smoke [for a long stretch] before
 * [there's] a single flame"), but never reorder or invent them.
 */
export function findSubsequence(index: TokenIndex, phrase: string, from = 0, maxGap = 8): number[] | null {
  const want = tokens(phrase);
  if (want.length === 0) return null;
  for (let s = Math.max(0, from); s < index.length; s++) {
    const first = step(index, s, want, 0);
    if (!first) continue;
    const hits: number[] = Array(first.dk).fill(s);
    let next = s + first.di;
    let k = first.dk;
    let ok = true;
    while (k < want.length && ok) {
      ok = false;
      for (let j = next; j <= Math.min(index.length - 1, next + maxGap); j++) {
        const m = step(index, j, want, k);
        if (m) {
          for (let x = 0; x < m.dk; x++) hits.push(j);
          next = j + m.di;
          k += m.dk;
          ok = true;
          break;
        }
      }
    }
    if (ok && k >= want.length) return hits;
  }
  return null;
}

/**
 * `phrase` WORD FOR WORD from token `from`: its tokens in a row, nothing left out in the middle —
 * what a word-by-word caption must be (Dale's job 386 at 0:26 showed "And the Etsy fee can more
 * than double" for "And hang on for the Etsy fee that can more than double…", five words gone).
 * The one forgiveness is ONE interior word the transcriber misheard (same count on both sides),
 * on a line of four words or more: the line still reads as said.
 */
export function findVerbatim(index: TokenIndex, phrase: string, from = 0): number[] | null {
  const exact = findPhrase(index, phrase, from);
  if (exact) return exact;
  const want = tokens(phrase);
  if (want.length < 4) return null;
  for (let s = Math.max(0, from); s < index.length; s++) {
    const hits: number[] = [];
    let i = s, k = 0, subs = 1;
    while (k < want.length) {
      const m = step(index, i, want, k);
      if (m) {
        for (let x = 0; x < m.dk; x++) hits.push(i);
        i += m.di;
        k += m.dk;
      } else if (subs > 0 && k > 0 && k < want.length - 1 && i < index.length) {
        subs--;
        hits.push(i);
        i++;
        k++;
      } else break;
    }
    if (k >= want.length) return hits;
  }
  return null;
}

/** How long a silence is a natural break (subtitle practice: a pause is where a line may end). */
export const BREAK_PAUSE_SEC = 0.25;
/** Words a clause starts on: a line may end before one, or start on one (BBC subtitle guidelines:
 * break before a conjunction or a relative word, never inside a phrase). */
const CLAUSE_WORDS = new Set(["and", "but", "or", "so", "because", "where", "when", "which", "who", "whose", "that", "while", "if", "then", "until", "before", "after", "since", "though", "although", "unless", "whether", "once"]);
/** A sentence's opening word that a line may leave off its front ("So | get a stepladder"). */
const OPENERS = new Set(["so", "and", "but", "now", "well", "okay", "ok", "then", "plus", "also"]);
const CLOSES = new RegExp("[.,;:?!…—–\"”)]$");

/** Every word and number a graphic SHOWS, besides one of its lines (to let a line stop right where
 * the graphic's own big number or label takes over: "an extra fee of" + 15 %). */
function shownTokens(props: unknown, except: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, key = "") => {
    if (v === except || ["at", "say", "icon", "from", "start", "end", "winner", "answer"].includes(key)) return;
    if (typeof v === "number") out.add(String(v));
    else if (typeof v === "string") tokens(v).forEach(t => out.add(t));
    else if (Array.isArray(v)) v.forEach(x => walk(x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(props);
  return out;
}

/**
 * Why a word-by-word line does not start or end at a natural break, or null when it does. A line
 * starts after a full stop, comma or pause, or on a clause word; it ends on one, before a pause, or
 * before a clause word — or within three words of where the graphic's own number or label takes over
 * (Frederick's "from smoking to fully involved" + "in about 3 minutes" on the same card). Dale's
 * "Put the $10 to $40 items along the front edge" stopped before "of the table", and read as cut.
 */
export function breakProblem(text: string, hits: number[], index: TokenIndex, words: Word[], shown: Set<string> = new Set()): string | null {
  const first = index[hits[0]].word;
  const last = index[hits[hits.length - 1]].word;
  const prev = words[first - 1];
  const next = words[last + 1];
  const said = (w: Word) => w.text.trim();
  const isShown = (w: Word) => tokens(w.text).length > 0 && tokens(w.text).every(t => shown.has(t));
  // A sentence's opening "So", "And", "Now"… may be left off the front of a line.
  const afterOpener = (i: number) =>
    !!words[i] && OPENERS.has(tokens(words[i].text)[0] ?? "") && (!words[i - 1] || CLOSES.test(said(words[i - 1])) || words[i].start - words[i - 1].end >= BREAK_PAUSE_SEC);
  const startsOk =
    !prev ||
    CLOSES.test(said(prev)) ||
    words[first].start - prev.end >= BREAK_PAUSE_SEC ||
    CLAUSE_WORDS.has(tokens(words[first].text)[0] ?? "") ||
    afterOpener(first - 1) ||
    words.slice(Math.max(0, first - 3), first).some(isShown);
  if (!startsOk) {
    const before = words.slice(Math.max(0, first - 4), first).map(said).join(" ");
    return `"${text}" starts mid-sentence ("${before} ‖ ${said(words[first])}…") — start it where he starts the sentence or a clause`;
  }
  const endsOk =
    !next || CLOSES.test(said(words[last])) || next.start - words[last].end >= BREAK_PAUSE_SEC || CLAUSE_WORDS.has(tokens(next.text)[0] ?? "") || words.slice(last + 1, last + 4).some(isShown);
  if (!endsOk) {
    const after = words.slice(last + 1, last + 7).map(said).join(" ");
    return `"${text}" ends mid-sentence ("…${said(words[last])} ‖ ${after}") — end it at a full stop, a comma or a pause, or split it into two lines at a clause`;
  }
  return null;
}

/** Per DISPLAYED word (split on whitespace), the start time of its first token's word. */
function displayWordTimes(text: string, hits: number[], index: TokenIndex, words: Word[]): number[] {
  const out: number[] = [];
  let k = 0;
  for (const dw of text.trim().split(/\s+/)) {
    const n = tokens(dw).length;
    out.push(n > 0 && k < hits.length ? words[index[hits[k]].word].start : out[out.length - 1] ?? 0);
    k += n;
  }
  return out;
}

export class CueError extends Error {}

/**
 * How far a graphic's edge may sit from a picture cut before it is SNAPPED onto it. A graphic
 * that ends a frame or two before a cut lets the old picture flash between it and the next shot
 * (Frederick job 376: the VS card ended 2 frames early at 1:17, the old b-roll flashed); one that
 * starts a frame or two before a cut lands on the wrong shot for those frames. Half a second is
 * well past the word/edit disagreement measured (±0.14 s) and well short of a deliberate overlap.
 */
export const CUT_SNAP_SEC = 0.5;

/**
 * A graphic whose last second crosses a picture cut ENDS on that cut instead of spilling a sliver
 * onto a shot it has nothing to do with (job 383: the warning ran 0.73 s onto the next shot, the
 * door). Only when at least `MIN_AFTER_TRIM_SEC` of it is left.
 */
export const TAIL_SPILL_SEC = 1.0;
/** A graphic is never ended on a cut before its last element (a number landing, its last word)
 * has been up this long: Hank's "6 hours" was cut 0.23 s after the 6 landed (job 390, 0:20). */
export const MIN_READ_SEC = 0.5;
export const MIN_AFTER_TRIM_SEC = 1.5;

/**
 * A graphic leaves this long after the last of its OWN words is spoken — broadcast caption
 * practice: text clears within about a second of the speech moving on. Job 384 at 0:10-0:13:
 * "It isn't broken. It isn't dead." stayed 4.7 s into "It just happens to be slow…".
 *
 * MIN_ON_SCREEN_SEC is the shortest a graphic may be up and still be read. Here it is only where
 * the reading floor (`readingSec`) STARTS: the cap at the next sentence and a snap back onto a
 * picture cut can still end a graphic sooner — Dale's "3 piles" on the two-word shot "Three piles."
 * was capped at "Smalls," then snapped back to the cut, 1.27 s on screen (job 397, 0:48) — and a
 * title keeps the length it was planned with. So the floor is held where a graphic can be turned
 * away, not here: the planner sends a new graphic that resolves shorter back for repair and raises
 * a title's `durationSec` to it, and QA reports any shipped graphic under it.
 */
export const LINGER_SEC = 0.8;
export const MIN_ON_SCREEN_SEC = 1.5;

/** Up too short to read: under MIN_ON_SCREEN_SEC from when its first words are drawn (`shownAt`),
 * with one frame allowed for edges rounded onto the frame grid. The ONE test the planner (a new
 * graphic is refused), the film's end (`endWithFilm`) and QA (a shipped one is reported) all ask, so
 * they cannot disagree. It measured from the cue's start, which is not when anything shows: job 413's
 * "A mower blade" label started on the cut at 70.33 s, appeared on its words at 71.51 s and was gone
 * at 72.47 s — under a second to read — and job 412's "MYTH" stamp started at 33.13 s and appeared at
 * 36.12 s, 1.25 s before it left; QA said "Shorter than 1.5 s: 0" on both. */
export function tooShortToRead(c: { startFrame: number; endFrame: number; shownAt?: number }, fps: number): boolean {
  return readableFrames(c, fps) < MIN_ON_SCREEN_SEC * fps - 1 - 1e-6;
}

/** Frames a graphic's words are on screen: from its first drawn words (`shownAt`) to its end. */
export function readableFrames(c: { startFrame: number; endFrame: number; shownAt?: number }, fps: number): number {
  const shown = c.shownAt === undefined ? c.startFrame : Math.max(c.startFrame, Math.round(c.shownAt * fps));
  return c.endFrame - shown;
}

/** When a graphic's words are first on screen, seconds on the film's clock: `shownAt`, else its start. */
export const shownFrom = (c: { start: number; shownAt?: number }): number => Math.max(c.start, c.shownAt ?? c.start);

/** A graphic's own LEAD-IN: its plate or scrim easing in just before its first word (the planner's
 * `startPad` of -0.15 s, a start snapped a frame or two onto a cut). Words drawn within this of its
 * start are read with its entrance, and reading counts from the start; later than this, the graphic
 * shows nothing to read until them, and reading counts from them (`shownAt`). The same lead a card is
 * given before its first word (`CARD_LEAD_SEC`). */
export const WORDS_LEAD_IN_SEC = 0.3;

/** Top-level fixed text a template draws from its first frame, before any timed element: a kicker
 * over a number pair or a card, a list's or a chart's title. Every other piece of fixed text belongs
 * to the element whose `at` it sits with (a label's text, a stamp's word, a value and its label). */
const DRAWN_FROM_START = ["kicker", "title"];

/**
 * The frame, counted from a graphic's start, its first WORDS are drawn on: at once for a title
 * (`structural`), fixed text drawn from the first frame (`DRAWN_FROM_START`) or an element set to show
 * at once ("at": 0); else the earliest element's resolved `at`, on the frame the templates draw it
 * (their read-ahead lead, `MOTION.wordLeadSec`, as `appearFrame` in timing.ts). Job 412's label-only
 * MYTH stamp opened on "A few people," (33.13 s) and its one element waited for "call it revenge"
 * (36.12 s). Pure.
 */
export function firstWordsFrame(props: Record<string, unknown>, fps: number, structural = false): number {
  if (structural || showsAtStart(props)) return 0;
  if (DRAWN_FROM_START.some(k => typeof props[k] === "string" && (props[k] as string).trim())) return 0;
  let first = Infinity;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "at" && typeof x === "number" && Number.isFinite(x)) first = Math.min(first, x);
      else walk(x);
    }
  };
  walk(props);
  return first === Infinity ? 0 : Math.max(0, Math.round((first - MOTION.wordLeadSec) * fps));
}

/**
 * Nothing outlasts the film: a graphic held for its reading time near the end could run past the
 * last frame, and measuring it there grabbed nothing (Scarlett's job 395 shipped without graphics),
 * so it ends on the last frame. One the film's end leaves too short to read is LEFT OUT, by the same
 * test the planner and QA ask — kept down to 1 s, it shipped and QA then failed the film for it. Any
 * other graphic is only left out under a second (a saved plan on a film edited since): an approved
 * one keeps its length, and a chapter label left out would break its series. `cues` is changed in
 * place; returns the ids left out.
 */
export function endWithFilm(cues: ResolvedCue[], lastFrame: number, fps: number): string[] {
  const cutByEnd = new Set<ResolvedCue>();
  for (const c of cues) {
    if (c.endFrame <= lastFrame) continue;
    c.endFrame = lastFrame;
    c.end = lastFrame / fps;
    c.props = { ...c.props, durationSec: (c.endFrame - c.startFrame) / fps };
    cutByEnd.add(c);
  }
  const out: string[] = [];
  for (let k = cues.length - 1; k >= 0; k--) {
    const c = cues[k];
    if (cutByEnd.has(c) ? !tooShortToRead(c, fps) : c.endFrame - c.startFrame >= fps) continue;
    out.push(c.id);
    cues.splice(k, 1);
  }
  return out;
}

/**
 * HAND-OFF: two graphics never butt up against each other — the next one would read as the tail of
 * the one before (or, overlapping, as one stacked on the other). When the next starts less than
 * HANDOFF_GAP_SEC after this one ends, this one leaves early, on a fade, as long as it still holds
 * its own last word for HANDOFF_MIN_TAIL_SEC and MIN_ON_SCREEN_SEC in all. Its words are never cut
 * short to make room: if they would be, the two still touch and the rule check reports it.
 */
export const HANDOFF_GAP_SEC = 1.0;

/** The most a graphic may stay after its own words, even to leave with a picture cut: past it the
 * graphic reads as stale. Measured from where its own sentence finished, as said (`ownSentenceEnd`) —
 * the rest of a sentence it stayed up for is not lingering — so an end snaps FORWARD onto a cut only
 * within this of that point, and QA (`stillUpAfterWords`) counts from the same point. */
export const MAX_LINGER_SEC = 1.2;

/**
 * A full-screen card replaces the picture, so it must show something at once: one that opens
 * more than CARD_MAX_WAIT_SEC before its first word (an empty ground — job 384's "3 minutes" card
 * sat blank 3 s) starts CARD_LEAD_SEC before that word instead, or on a cut just before it.
 */
export const CARD_MAX_WAIT_SEC = 0.7;
export const CARD_LEAD_SEC = 0.3;
export const HANDOFF_MIN_TAIL_SEC = 0.3;

/**
 * A graphic that REPLACES the picture (a card, a framed window) never leaves a sliver of the shot
 * behind it shorter than MIN_SHOT_SEC: the viewer sees card → a blink of b-roll → host, and reads
 * it as a glitch (Dale 1:30, Scarlett 0:57, Hank 1:29 — 0.6-0.9 s each). It HOLDS through the pause
 * and leaves with the picture, as long as that is within CARD_HOLD_MAX_SEC of its last word and no
 * new line has begun more than NEW_LINE_GRACE_SEC before the cut. The same at its start: a card
 * that would open just after a cut opens ON the cut, if its first word is then near enough.
 */
export const MIN_SHOT_SEC = 1.5;

/**
 * READING TIME. A graphic stays up long enough to READ what it shows: about a second plus 0.3 s a
 * word, between MIN_ON_SCREEN_SEC and READ_MAX_SEC (Scarlett's "2 inches lower" was up 1.8 s for
 * nine words, job 392 at 0:13). And it leaves in a PAUSE rather than mid-word: when its end falls
 * inside speech and a pause of PAUSE_GAP_SEC begins within PAUSE_REACH_SEC, it leaves in that pause.
 */
export const READ_BASE_SEC = 1.0;
export const READ_PER_WORD_SEC = 0.3;
export const READ_MAX_SEC = 4.0;
export const PAUSE_GAP_SEC = 0.2;
export const PAUSE_REACH_SEC = 1.0;
/** A comparison with a winner holds this long after its last side is said, so the verdict is seen. */
export const VERDICT_SEC = 0.6;

/**
 * Lines that must be a WHOLE SENTENCE as said — a statement, a quote, a fact, a myth and its truth,
 * a question — never stopped at a comma: Dale's closing quote ended at "price it honest," while he
 * went on "and let every piece find its lane." (job 389, 3:56). Captions keep clause breaks.
 */
const WHOLE_SENTENCE: Record<string, string[]> = {
  Statement: ["headline"],
  Quote: ["quote"],
  FactCard: ["fact"],
  MythTruth: ["myth", "truth"],
  YesNoCard: ["question"],
  // captions too, since 2026-10-17: a long sentence PAGES (WordReveal `pageWords`) instead of being
  // stopped at a comma — Dale's closing caption "Build it well, price it honest," left the rest unsaid
  HostCaption: ["phrase"],
  DimCaption: ["phrase"],
  ArrowCaption: ["phrase"],
};
const ENDS_SENTENCE = new RegExp("[.?!][\"”')]*$");

/**
 * A PAIR GETS "vs" ONLY WHEN IT IS COMPARED (round 11 review). NumberLabel drew "vs" between its two
 * values whatever joined them: Gary's job 406 (1:22) read "A KNIFE $5 to $10 vs A MOWER BLADE $10 to
 * $20" for "$5 to $10 a knife and $10 to $20 a mower blade" — a price for each of two services, not
 * a contest — and Dale's job 397 (1:04) "FROM $150 vs UP TO $600" for "And furniture, $150 to $600.",
 * a range. The separator is drawn only when the pair is compared (`compare`, set by the resolver on
 * each template in SEPARATED_PAIRS): the plan marks it, and the words the narrator says BETWEEN the
 * two VALUES — after the first one's spoken words (`a.at`), up to the second value's number (an "at"
 * may lead with words of its own: "@took 6.", "@to $600") — settle it where they can. A range (only
 * "to", "up to" or "through" between) or a list or a choice (the join ENDS on "and", "or" or "plus",
 * the second value said right after it) never does, marked or not — that is how THESE two are joined,
 * so it is read first; a contrast names its side between the "and" and the value ("…and now 3",
 * "…and his 81"). A comparing word ("versus", "compared to", "instead of"…) compares them, marked or
 * not — "against" only right before the second value ("$15 against $40"), never "sanded against the
 * grain" or "leaned against the wall" said on the way. Anything else is the plan's call (Gideon's job
 * 401, "He is 64. His father made it to 81."). A "vs" left out still reads (the labels name both
 * values); a "vs" put in says the wrong thing — so an unclear pair goes without.
 */
const SEPARATED_PAIRS = new Set(["NumberLabel"]);

/**
 * Templates whose sides draw their SUB at its own words (`subAt`) instead of with the side's title: a
 * Versus side's sub is the half of the side the narrator gives last — its point, often the reveal
 * ("German bathroom" … "A small bin, with a lid", job 408). Only templates that draw `subAt`, so QA's
 * row for a sub is never a time the template ignores.
 */
const TIMED_SUBS = new Set(["Versus"]);

/** The LAST run of `text`'s words in order (`findSubsequence`) that lies inside token positions
 * lo..hi, or undefined: a common first word ("a") is never taken from earlier in the span. */
function lastRunWithin(index: TokenIndex, text: string, lo: number, hi: number): number[] | undefined {
  let best: number[] | undefined;
  for (let s = lo; s <= hi; ) {
    const m = findSubsequence(index, text, s);
    if (!m || m[m.length - 1] > hi) break;
    best = m;
    s = m[0] + 1;
  }
  return best;
}

/**
 * When a side's sub is said: the first of its words, in order, inside the side's own "say" (`sayHits`,
 * as found) — else, when the sub rewords the narrator, the first word of the say itself. Both are the
 * last run inside the span: the say "a small bin stands there, with a lid" is found from the card's
 * start as "[In] a [German bathroom, usually,] … small bin…", 2.2 s before he says it (job 408). Pure.
 */
export function subHeard(index: TokenIndex, words: Word[], sub: string, say: string, sayHits: number[]): Word {
  const lo = sayHits[0], hi = sayHits[sayHits.length - 1];
  const run = lastRunWithin(index, sub, lo, hi) ?? lastRunWithin(index, say, lo, hi) ?? sayHits;
  return words[index[run[0]].word];
}

const COMPARING_WORD = /\b(?:versus|vs|compared (?:to|with)|instead of|rather than|unlike|whereas|as opposed to)\b/;
const AGAINST_THE_VALUE = /\bagainst(?: (?:the|a|an|his|her|its|their|my|your|our))?$/;
const RANGE_JOIN = /^(?:(?:and|or) )?(?:all the way )?(?:up )?(?:to|through|thru)$/;
const LIST_JOIN = /\b(?:and|or|plus)$/;

/** Is a pair compared? `planned` is the plan's `compare`; `said` is what the narrator says between the
 * two elements' spoken words (`join`) and the second element's own spoken words (`second`), when both
 * are timed to words. Pure. */
export function pairCompared(planned: unknown, said?: { join: string; second: string }): boolean {
  if (said) {
    const second = tokens(said.second);
    // Where the second VALUE is said: the first number among its own words ("took 6", "to $600").
    const value = second.findIndex((t, i) => /^\d/.test(t) || parseSpokenNumber(second, i) !== null);
    const join = [...tokens(said.join), ...second.slice(0, Math.max(0, value))].join(" ");
    if (value >= 0 && (RANGE_JOIN.test(join) || LIST_JOIN.test(join))) return false;
    if (COMPARING_WORD.test(join) || AGAINST_THE_VALUE.test(join)) return true;
  }
  return planned === true;
}

/** How many words (and numbers) a graphic SHOWS, for its reading time. */
function shownWordCount(props: unknown, fixedOnly = false): number {
  let n = 0;
  const walk = (v: unknown, key = "") => {
    if (["at", "say", "icon", "from", "start", "end", "winner", "answer", "theme", "place", "target", "exit"].includes(key)) return;
    if (typeof v === "number" && key === "value") n += 1;
    else if (typeof v === "string") n += v.trim().split(/\s+/).filter(Boolean).length;
    else if (Array.isArray(v)) v.forEach(x => walk(x));
    else if (v && typeof v === "object" && !(fixedOnly && (v as { words?: unknown }).words === true)) for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(props);
  return n;
}

/**
 * Seconds a graphic needs to be read once a NEW CLAUSE it does not show has begun (`ownSentenceEnd`):
 * its FIXED text — a kicker, a number, a side's title — at the reading rate, while a line shown word by
 * word as it is said counts as read when it was heard (kinetic text is read with the voice). Job 408's
 * "9 things" card was held its full 4.0 s for 14 words, 2.1 s over "…the toilet there, | and in plenty
 * of American homes," — the contrast its line sets up — though only "Out of the toilet / 9 things"
 * (6 words, 2.8 s) was still to be read. A graphic with no word-by-word line keeps its whole reading
 * time (Dale's "Shop open at / 2 a.m.", job 397). Pure.
 */
export function readAlongSec(props: unknown): number {
  return Math.min(READ_MAX_SEC, Math.max(MIN_ON_SCREEN_SEC, READ_BASE_SEC + READ_PER_WORD_SEC * shownWordCount(props, true)));
}

/** Seconds a graphic needs on screen to be read. */
export function readingSec(props: unknown): number {
  return Math.min(READ_MAX_SEC, Math.max(MIN_ON_SCREEN_SEC, READ_BASE_SEC + READ_PER_WORD_SEC * shownWordCount(props)));
}
export const CARD_HOLD_MAX_SEC = 2.0;
/** Through pure SILENCE (no word spoken until the picture changes) a card may hold this long:
 * Dale's "$10 in fees" left 1.2 s before the cut, 2.2 s after his last word, in silence (job 397). */
export const CARD_HOLD_SILENT_MAX_SEC = 3.5;
export const NEW_LINE_GRACE_SEC = 0.3;
/** A word that ends a sentence (the next word starts a new line). */
const SENTENCE_END = new RegExp("[.?!][\"”')]*$");
/** A word a clause ends on INSIDE a sentence: a comma, semicolon, colon or dash. */
const CLAUSE_END = new RegExp("[,;:—–][\"”')]*$");
/** Joining words that open a NEW statement after a clause break ("…, and in plenty of American homes,
 * most of them go down it"). Not the words that may open a relative clause (which, who, whose, that,
 * where, when): "…the robin, which hardly anybody knows" still tells about what the graphic shows. */
const NEW_CLAUSE_WORDS = new Set(["and", "but", "or", "so", "yet", "because", "while", "whereas", "if", "then", "until", "before", "after", "since", "though", "although", "unless", "whether", "once"]);
/** Seconds a graphic may run into words it does not show (a new sentence or a new clause): one word's
 * onset, as the cap at the next sentence has always allowed. */
export const NEW_LINE_SPILL_SEC = 0.15;

/** Does `w` open a NEW CLAUSE of its sentence after `prev`: a comma, semicolon, colon or dash, then a
 * joining word — "…stay out of the toilet there, | and in plenty of American homes," (job 408, 0:24). */
function opensClause(prev: Word, w: Word): boolean {
  return CLAUSE_END.test(prev.text.trim()) && NEW_CLAUSE_WORDS.has(tokens(w.text)[0] ?? "");
}

/**
 * Where a graphic's OWN words finish, as said: the words after its own last word (`from`) that only
 * finish what it shows — the rest of its sentence ("…a good night's sleep | you may or may not have
 * had."), but never a NEW CLAUSE of it (`opensClause`) — among those starting before `before`.
 * `newLineAt` is when the next sentence begins, if it does before `before`; `newClauseAt` when the
 * first words it does not show begin: that new clause, else that sentence; `sentenceSpoken` where its
 * whole sentence finished among those words, new clauses and all.
 *
 * The rest of a clause is its own ("7 things | about the robin that hardly anybody knows,", job 404);
 * a new clause is not. Job 408's "9 things / Nine things stay out of the toilet there" was measured to
 * the end of "…, and in plenty of American homes," — the contrast it sets up — so the 2 s it stood over
 * those words passed as "the rest of its own sentence", and QA said "Still up after their words: 0".
 * A graphic's lingering, its snap forward onto a cut and its hold to a cut are all measured from here.
 */
export function ownSentenceEnd(words: Word[], from: number, before: number): { spoken: number; sentenceSpoken: number; newLineAt?: number; newClauseAt?: number } {
  let spoken = from;
  let sentenceSpoken = from;
  let newClauseAt: number | undefined;
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (w.start <= from + 1e-6 || w.start >= before) continue;
    const prev = words[k - 1];
    if (prev && SENTENCE_END.test(prev.text.trim()) && prev.end <= w.start) return { spoken, sentenceSpoken, newLineAt: w.start, newClauseAt: newClauseAt ?? w.start };
    if (newClauseAt === undefined && prev && opensClause(prev, w)) newClauseAt = w.start;
    if (newClauseAt === undefined) spoken = Math.max(spoken, w.end);
    sentenceSpoken = Math.max(sentenceSpoken, w.end);
  }
  return newClauseAt === undefined ? { spoken, sentenceSpoken } : { spoken, sentenceSpoken, newClauseAt };
}

/**
 * HOLD TO THE CUT: whether a picture-replacing graphic that would leave at `end` may stay until the
 * picture changes at `cut` — through the rest of its own sentence and the pause after it, as long as
 * the cut comes within CARD_HOLD_MAX_SEC of where its own words finished (`ownSentenceEnd`: a new
 * clause of the sentence is not its own; CARD_HOLD_SILENT_MAX_SEC when nothing more is said before the
 * cut) and no new line has begun more than NEW_LINE_GRACE_SEC
 * before it. The ONE test the resolver holds a card by and QA judges a card leaving with the picture
 * by (`stillUpAfterWords`), on the same words, so the two cannot disagree: job 400's "7 thieves" card
 * left on the cut at 100.63, in the pause after "…all seven of the thieves.", and QA failed it as
 * "still up after its words" — it measured from "seven" (98.94) with the 1.2 s a caption gets.
 */
export function holdToCut(words: Word[], from: number, end: number, cut: number): { ok: boolean; spoken: number; max: number } {
  const { spoken, newLineAt } = ownSentenceEnd(words, from, cut);
  const newLine = newLineAt !== undefined && newLineAt > end + 1e-6 && newLineAt < cut - NEW_LINE_GRACE_SEC;
  const silent = !words.some(w => w.start > spoken - 1e-6 && w.start < cut);
  const max = silent ? CARD_HOLD_SILENT_MAX_SEC : CARD_HOLD_MAX_SEC;
  return { ok: cut - spoken <= max && !newLine, spoken, max };
}

/**
 * STILL UP AFTER ITS WORDS — QA's question, answered by the resolver's own rules on what it recorded
 * from the same words, so QA never fails a graphic the resolver deliberately kept up. A graphic may
 * stay, after its own words finished (`spokenEnd`, else its last word — never counting a new clause it
 * does not show, `ownSentenceEnd`):
 *  - LINGER_SEC, or to a picture cut within MAX_LINGER_SEC (the end snaps forward onto one);
 *  - to the next pause within PAUSE_REACH_SEC (`leftInPause`), or for its reading time and then that
 *    pause (`inReadingTime`) — over a new clause it does not show, only the time its fixed text needs;
 *  - a picture-replacing graphic leaving WITH the picture: until the cut its hold covers (`hold`,
 *    from `holdToCut`), never past it.
 * One frame is allowed for edges rounded onto the frame grid. QA leaves titles out: they keep their
 * planned length. Job 408's "9 things" card (22.27-26.60) passed, 2.1 s over "…, and in plenty of
 * American homes," on its 4 s reading time; it fails now, and the resolver no longer places it so.
 */
export function stillUpAfterWords(c: ResolvedCue, fps: number): boolean {
  if (c.contentEnd === undefined) return false;
  const slack = 1 / fps + 1e-6;
  if (inReadingTime(c, slack)) return false;
  const past = c.end - (c.spokenEnd ?? c.contentEnd);
  if (c.hold && c.end <= c.hold.cut + slack && past <= c.hold.max + slack) return false;
  return past > (c.leftInPause ? LINGER_SEC + PAUSE_REACH_SEC + 0.15 : MAX_LINGER_SEC) + slack;
}

/** Up no longer than its reading time and the pause it may leave in after it — the time its fixed text
 * needs (`readAlongSec`) once it runs into words it does not show (`newClauseAt`): never lingering in
 * QA's eyes, and never stale for a snap forward onto a cut in the resolver's (the same test). Counted
 * from when its words are first drawn (`shownFrom`), as the reading floor is. */
function inReadingTime(c: { start: number; end: number; shownAt?: number; readSec?: number; readAlongSec?: number; newClauseAt?: number }, slack: number): boolean {
  const overNew = c.newClauseAt !== undefined && c.end > c.newClauseAt + NEW_LINE_SPILL_SEC + slack;
  const read = (overNew ? c.readAlongSec : undefined) ?? c.readSec ?? 0;
  return c.end - shownFrom(c) <= read + PAUSE_REACH_SEC + 0.15 + slack;
}

/**
 * A BLINK OF FOOTAGE beside a graphic that replaces the picture: the shot it leaves behind before
 * the next picture cut — or the one it opens after, past the cut before it — shows for less than
 * MIN_SHOT_SEC, and card → a flash of the picture → a new picture reads as a glitch. Measured on
 * FRAMES, the film's cuts as the composite and QA see them. The ONE test the planner refuses a new
 * graphic by and QA fails a film by: QA alone saw job 404's Versus card leave 0.80 s of its shot
 * before the next one (1:28) and job 403's "The toilet is fine." leave 1.22 s (2:06), and both films
 * shipped with it. Whether a graphic replaces the picture is the caller's to
 * say (registry `replacesPicture`). Returns the side, the cut and how long the sliver is, or
 * undefined. `cutFrames` ascending.
 */
export function blinkBeside(c: { startFrame: number; endFrame: number }, cutFrames: number[], fps: number): { side: "after" | "before"; cutFrame: number; sec: number } | undefined {
  const minShot = Math.round(MIN_SHOT_SEC * fps);
  const after = cutFrames.find(k => k >= c.endFrame);
  if (after !== undefined && after > c.endFrame && after - c.endFrame < minShot) return { side: "after", cutFrame: after, sec: (after - c.endFrame) / fps };
  let before: number | undefined;
  for (const k of cutFrames) if (k <= c.startFrame) before = k;
  if (before !== undefined && before < c.startFrame && c.startFrame - before < minShot) return { side: "before", cutFrame: before, sec: (c.startFrame - before) / fps };
  return undefined;
}

export type ResolveOptions = {
  /** The film's real picture cuts, in seconds (the first frame of each new shot). */
  cuts?: number[];
  fps?: number;
  /** Templates that are TITLES, not captions (a chapter label): they keep their planned length. */
  structural?: Set<string>;
  /** Full-screen CARDS (they replace the picture), held to CARD_MAX_WAIT_SEC. */
  cards?: Set<string>;
  /** Every template that replaces the picture (cards, framed windows, an overlay over the blurred
   * picture): held to the cut so no sliver of footage under MIN_SHOT_SEC is left beside it. Defaults
   * to `cards`. */
  fullFrame?: Set<string>;
  /** Framed WINDOWS (their items land with their pictures; one ends with its last item's picture).
   * Defaults to `fullFrame` minus `cards` — pass it when `fullFrame` holds a blurred overlay, which
   * replaces the picture but is no window (registry `resolveSets`). */
  windows?: Set<string>;
};

/**
 * Where a graphic due to leave at `t` leaves: at `t` when nothing is being said, else in the next pause
 * (PAUSE_GAP_SEC) that begins within PAUSE_REACH_SEC, else at the end of the word it is up in — never
 * mid-word (Scarlett's "2 inches lower", job 392). Pure.
 */
function leaveInPause(words: Word[], t: number): { at: number; inPause: boolean } {
  const speaking = words.some(w => w.start < t - 1e-6 && w.end > t + 1e-6) || words.some(w => w.start > t && w.start - t < 0.15);
  if (!speaking) return { at: t, inPause: false };
  for (let k = 0; k + 1 < words.length; k++) {
    const gapAt = words[k].end;
    if (gapAt < t - 1e-6) continue;
    if (gapAt - t > PAUSE_REACH_SEC) break;
    if (words[k + 1].start - gapAt >= PAUSE_GAP_SEC) return { at: gapAt + Math.min(0.1, (words[k + 1].start - gapAt) / 2), inPause: true };
  }
  // No pause within reach: at least never leave in the middle of a word.
  const inside = words.find(w => w.start < t - 1e-6 && w.end > t + 1e-6);
  return { at: inside ? inside.end : t, inPause: false };
}

/** The cut nearest `t` within `CUT_SNAP_SEC`, or undefined. */
export function nearestCut(cuts: number[], t: number): number | undefined {
  let best: number | undefined;
  for (const c of cuts) if (Math.abs(c - t) <= CUT_SNAP_SEC && (best === undefined || Math.abs(c - t) < Math.abs(best - t))) best = c;
  return best;
}

/**
 * Resolve a whole sheet. Cues are searched IN ORDER, each from where the previous one started,
 * so a phrase the narrator repeats ("the label") binds to the occurrence the cue is about.
 *
 * Per cue: (1) the start, conformed to the edit; (2) every element timed against its words, and
 * when the graphic's own content is last spoken; (3) the end — the planned end, but never more
 * than LINGER_SEC past that last word; (4) the end, conformed to the edit.
 */
export function resolveCues(specs: CueSpec[], words: Word[], opts: ResolveOptions = {}): ResolvedCue[] {
  const index = indexWords(words);
  const cuts = opts.cuts ?? [];
  const fps = opts.fps ?? 30;
  const structural = opts.structural ?? new Set<string>();
  const cards = opts.cards ?? new Set<string>();
  const fullFrame = opts.fullFrame ?? cards;
  const windows = opts.windows ?? new Set(Array.from(fullFrame).filter(id => !cards.has(id)));
  // Every edge lands on a frame boundary: an edit between frames does not exist.
  const onFrame = (t: number) => Math.round(t * fps) / fps;
  let cursor = 0;
  const out = specs.map(spec => {
    const startHits = findPhrase(index, spec.start, cursor);
    if (!startHits) throw new CueError(`cue ${spec.id}: start words "${spec.start}" not found after token ${cursor}`);
    cursor = startHits[0];

    // 1. The start.
    const rawStart = words[index[startHits[0]].word].start + (spec.startPad ?? 0);
    let startCut = nearestCut(cuts, rawStart);
    let t0 = onFrame(startCut ?? rawStart);
    const sync: ResolvedCue["sync"] = [];
    /** Each element's "at" words, as word positions (first, last), by the element's path ("a", "b"). */
    const atWords = new Map<string, { first: number; last: number }>();
    const searchFrom = startHits[0];
    let contentEnd: number | undefined;
    /** When the graphic's LAST element appears (its number lands, its last word shows). */
    let lastShown = -Infinity;
    const said = (end: number) => {
      contentEnd = contentEnd === undefined ? end : Math.max(contentEnd, end);
    };

    // 2. Every element.
    const walk = (v: unknown, pathName: string): unknown => {
      if (Array.isArray(v)) return v.map((x, i) => walk(x, `${pathName}[${i}]`));
      if (!v || typeof v !== "object") return v;
      const o = v as Record<string, unknown>;
      // A word-timed phrase.
      if (typeof o.text === "string" && o.words === true) {
        const from = typeof o.from === "string" ? findPhrase(index, o.from, searchFrom)?.[0] ?? searchFrom : searchFrom;
        const hits = findVerbatim(index, o.text, from);
        if (!hits) {
          const loose = findSubsequence(index, o.text, from);
          if (loose) {
            const a = index[loose[0]].word, b = index[loose[loose.length - 1]].word;
            const spoken = words.slice(a, b + 1).map(w => w.text.trim()).join(" ");
            throw new CueError(`cue ${spec.id}: "${o.text}" leaves out words he says ("${spoken}") — a word-by-word line shows his words exactly, in a row`);
          }
          throw new CueError(`cue ${spec.id}: "${o.text}" is not in the narration near "${spec.start}"`);
        }
        const broken = breakProblem(o.text, hits, index, words, shownTokens(spec.props, v));
        if (broken) throw new CueError(`cue ${spec.id}: ${broken}`);
        if (WHOLE_SENTENCE[spec.template]?.includes(pathName)) {
          const first = index[hits[0]].word, last = index[hits[hits.length - 1]].word;
          const prev = words[first - 1], next = words[last + 1];
          const starts = !prev || ENDS_SENTENCE.test(prev.text.trim()) || words[first].start - prev.end >= 0.35;
          const ends = ENDS_SENTENCE.test(o.text.trim()) && (!next || ENDS_SENTENCE.test(words[last].text.trim()) || next.start - words[last].end >= 0.35 || /^[A-Z]/.test(next.text.trim()));
          if (!starts || !ends) {
            const said = words.slice(first, Math.min(words.length, last + 9)).map(w => w.text.trim()).join(" ");
            throw new CueError(`cue ${spec.id}: "${o.text}" is not a whole sentence ("${said}…") — ${spec.template} shows one complete sentence as said; use the whole sentence, or a caption for part of it`);
          }
        }
        const times = displayWordTimes(o.text, hits, index, words).map(t => round(t - t0));
        lastShown = Math.max(lastShown, words[index[hits[hits.length - 1]].word].start);
        sync.push({ element: `${pathName} "${o.text}"`, word: words[index[hits[0]].word].text, wordStart: words[index[hits[0]].word].start });
        said(words[index[hits[hits.length - 1]].word].end);
        return { text: o.text, at: times[0], wordTimes: times };
      }
      const out: Record<string, unknown> = {};
      /** Where this element's "say" was found (token positions), for its sub's own timing. */
      let sayHits: number[] | undefined;
      for (const [k, x] of Object.entries(o)) {
        if (k === "at" && typeof x === "string" && x.startsWith("@")) {
          const hits = findPhrase(index, x.slice(1), searchFrom);
          if (!hits) throw new CueError(`cue ${spec.id}: "${x.slice(1)}" (${pathName}.at) not in the narration`);
          let w = words[index[hits[0]].word];
          // An item that stands for spoken words appears on the FIRST of them: Hank's "a stack of
          // sandpaper" waited for "sandpaper", 0.7 s after its picture (job 388, 0:33).
          if (typeof o.say === "string") {
            // The item's own words in a row, the last occurrence that starts at or before its "at".
            let first: Word | undefined;
            for (let from = searchFrom; ; ) {
              const sh = findVerbatim(index, o.say, from);
              if (!sh || sh[0] > hits[0]) break;
              if (sh[sh.length - 1] >= hits[0]) first = words[index[sh[0]].word];
              from = sh[0] + 1;
            }
            if (first && first.start < w.start && w.start - first.start <= 3) w = first;
          }
          // In a framed window, an item lands WITH its picture when that changes just before it.
          const cut = windows.has(spec.template) ? cuts.filter(c => c <= w.start + 1e-6 && w.start - c <= CUT_SNAP_SEC).pop() : undefined;
          sync.push({ element: `${pathName}.at "${x.slice(1)}"`, word: w.text, wordStart: w.start, ...(cut !== undefined ? { onCut: true } : {}) });
          atWords.set(pathName, { first: index[hits[0]].word, last: index[hits[hits.length - 1]].word });
          said(words[index[hits[hits.length - 1]].word].end);
          lastShown = Math.max(lastShown, w.start);
          // A number is said once its UNIT is said: Hank's "6" + "hours" (job 390, 0:20).
          if (typeof o.unit === "string" && o.unit.trim()) {
            const unit = runAt(index, hits[hits.length - 1] + 1, tokens(o.unit));
            if (unit?.length) said(words[index[unit[unit.length - 1]].word].end);
          }
          out[k] = round(Math.max(0, (cut ?? w.start) - t0));
        } else if (k === "say" && typeof x === "string") {
          // The spoken words a piece of FIXED text stands for (a VS side's "A cord under a rug"):
          // never drawn, only counted, so the graphic stays until they are said and no longer.
          const hits = findSubsequence(index, x, searchFrom);
          if (!hits) throw new CueError(`cue ${spec.id}: "${x}" (${pathName}.say) not in the narration`);
          sayHits = hits;
          const end = words[index[hits[hits.length - 1]].word].end;
          said(end);
          // When this side's words FINISH: a comparison waits for it before it gives its verdict.
          out.saidUntil = round(Math.max(0, end - t0));
        } else {
          out[k] = walk(x, pathName ? `${pathName}.${k}` : k);
        }
      }
      // A comparison side's SUB appears when ITS words are said, not with the side's title: job 408's
      // "American bathroom — It is empty" showed "It is empty" 1.6 s before it was said, and "German
      // bathroom — A small bin, with a lid" gave the reveal away 2.3 s early, while the narrator was
      // still on "In a German bathroom, usually,". A sub said with its title, or before it, enters with it
      // (no time of its own: a frame or less after the title is the same moment).
      if (TIMED_SUBS.has(spec.template) && typeof o.sub === "string" && o.sub.trim() && typeof o.say === "string" && sayHits && typeof out.at === "number") {
        const heard = subHeard(index, words, o.sub, o.say, sayHits);
        const subAt = round(heard.start - t0);
        if (subAt - out.at > 1 / fps + 1e-6) {
          out.subAt = subAt;
          sync.push({ element: `${pathName}.sub "${o.sub}"`, word: heard.text, wordStart: heard.start, prop: `${pathName}.subAt` });
          lastShown = Math.max(lastShown, heard.start);
        }
      }
      return out;
    };
    let props = walk(spec.props, "") as Record<string, unknown>;
    // A pair's "vs" only when the pair is compared (`pairCompared`): read off what is said between
    // its two values, else the plan's mark. Decided here, where every graphic is resolved — a new
    // plan, a saved one, the lab — so a saved plan that predates `compare` is drawn the same way.
    if (SEPARATED_PAIRS.has(spec.template)) {
      const a = atWords.get("a"), b = atWords.get("b");
      const text = (from: number, to: number) => words.slice(from, to).map(w => w.text.trim()).join(" ");
      props.compare = pairCompared(spec.props?.compare, a && b && a.last < b.first ? { join: text(a.last + 1, b.first), second: text(b.first, b.last + 1) } : undefined);
    }
    // A comparison with a winner gives its verdict after its last side is said, and holds it.
    if ((spec.props?.winner === "left" || spec.props?.winner === "right") && contentEnd !== undefined) said(contentEnd + VERDICT_SEC);
    const readSec = readingSec(spec.props);

    // 2b. A card that would open on an empty ground moves later, onto its first word. One that
    // shows something from its first frame (a VS side "at": 0) is not empty and stays — moving it
    // put both sides of job 385's VS card up at once, the first already greyed out.
    const firstWord = Math.min(...sync.map(x => x.wordStart));
    // A graphic built around a NUMBER (a value it counts up to) is held to the same wait: Hank's
    // "6 hours" opened 2.4 s early showing only its label (job 390).
    const aroundNumber = typeof spec.props?.value === "number";
    if ((cards.has(spec.template) || aroundNumber) && sync.length && !showsAtStart(spec.props) && firstWord - t0 > CARD_MAX_WAIT_SEC) {
      const want = firstWord - CARD_LEAD_SEC;
      const cut = nearestCut(cuts, want);
      startCut = cut !== undefined && cut <= firstWord ? cut : undefined;
      const moved = onFrame(startCut ?? want);
      props = shiftTimes(props, moved - t0) as Record<string, unknown>;
      t0 = moved;
    }

    // 2c. No blink of footage before a picture-replacing graphic: it opens on the cut just before it.
    if (fullFrame.has(spec.template) && startCut === undefined) {
      const before = cuts.filter(c => c < t0 - 1e-6 && t0 - c < MIN_SHOT_SEC);
      const c = before[before.length - 1];
      const first = sync.length ? Math.min(...sync.map(x => x.wordStart)) : t0;
      if (c !== undefined && (showsAtStart(spec.props) || first - c <= CARD_MAX_WAIT_SEC + 0.5)) {
        const moved = onFrame(c);
        props = shiftTimes(props, moved - t0) as Record<string, unknown>;
        t0 = moved;
        startCut = c;
      }
    }

    // 2d. A framed window opens on its FIRST ITEM'S picture, never on the shot before it: Dale's
    // "where to sell" window opened on "Today I'm ranking" over the cutting-board picture, 1.1 s
    // before the Etsy picture its first item stands for (job 397, 0:18). When the first item lands
    // with a picture cut, the window starts on that cut, its heading arriving with the first item.
    if (windows.has(spec.template)) {
      const items = sync.filter(x => x.element.includes(".at "));
      const first = items.length ? items.reduce((a, b) => (b.wordStart < a.wordStart ? b : a)) : undefined;
      const cut = first?.onCut ? cuts.filter(c => c <= first.wordStart + 1e-6 && first.wordStart - c <= CUT_SNAP_SEC).pop() : undefined;
      if (cut !== undefined && cut - t0 > 0.1) {
        const moved = onFrame(cut);
        props = shiftTimes(props, moved - t0) as Record<string, unknown>;
        t0 = moved;
        startCut = cut;
      }
    }

    // 2e. When its words are first DRAWN: reading is counted from there once they wait past the lead-in
    // (`WORDS_LEAD_IN_SEC`). A start snapped back onto a cut, or put on words said before the graphic's
    // own, shows nothing until its first element's word — job 413's "A mower blade" label opened on the
    // cut at 70.33 s and appeared on "a mower blade" at 71.51 s, so a reading floor counted from the
    // start ran out 0.7 s after it appeared and it was gone a second later; job 412's MYTH stamp waited
    // 3 s for "call it revenge".
    const lead = firstWordsFrame(props, fps, structural.has(spec.template)) / fps;
    const shown = lead > WORDS_LEAD_IN_SEC + 1e-6 ? Math.round(t0 * fps) / fps + lead : t0;

    // What is still to read once a new clause it does not show has begun: its fixed text, and its last
    // element on screen LINGER_SEC (job 401's "81" was readable 0.6 s and read as cut short).
    const readAlong = Math.max(readAlongSec(spec.props), lastShown + LINGER_SEC - shown);

    // 3. The end.
    let planned: number | undefined;
    if (spec.end) {
      const endHits = findPhrase(index, spec.end, startHits[0]);
      if (!endHits) throw new CueError(`cue ${spec.id}: end words "${spec.end}" not found`);
      planned = words[index[endHits[endHits.length - 1]].word].end + (spec.endPad ?? 0);
    } else if (spec.durationSec) {
      planned = t0 + spec.durationSec;
    }
    let rawEnd: number;
    let leftInPause = false;
    if (!structural.has(spec.template) && contentEnd !== undefined) {
      const byWords = contentEnd + LINGER_SEC;
      rawEnd = Math.max(shown + readSec, planned === undefined ? byWords : Math.min(planned, byWords));
      // Leave in a pause, not mid-word: an end inside speech moves to the next pause within reach.
      const left = leaveInPause(words, rawEnd);
      rawEnd = left.at;
      leftInPause = left.inPause;
      // Never into the NEXT sentence: reading time and a pause may carry a graphic through the rest of
      // its own sentence, not into a new one (Scarlett's "Keep the scale. Change the finish." card
      // stood over "Ivory, oat, a warm coral…", job 395).
      const ownEnd = contentEnd;
      const nextSentence = words.find((w, k) => w.start > ownEnd + 1e-6 && k > 0 && SENTENCE_END.test(words[k - 1].text.trim()));
      if (nextSentence && rawEnd > nextSentence.start + NEW_LINE_SPILL_SEC) {
        const cap = Math.max(ownEnd + 0.3, nextSentence.start + NEW_LINE_SPILL_SEC);
        if (cap < rawEnd) {
          rawEnd = cap;
          leftInPause = false;
        }
      }
      // Nor into a NEW CLAUSE of its sentence (`ownSentenceEnd`) for longer than its FIXED text takes to
      // read (`readAlong`): job 408's "9 things / Nine things stay out of the toilet there" was held its
      // full 4 s reading time and then to the pause after "homes,", 2.1 s over "…, and in plenty of
      // American homes," — the contrast its line sets up. Its line had been read as it was said. The same
      // cap as at a new sentence, but the fixed text is still given its time, and then it leaves as any
      // graphic does, in a pause or at a word's end (Scarlett's "Too low / 2 inches lower" over "…, and
      // that same necklace drags", job 392, leaves in the pause after "drags": 2.8 s up, 1.6 s after its
      // words — it was 3.7 s, over "your chin" too).
      const clauseAt = ownSentenceEnd(words, ownEnd, Infinity).newClauseAt;
      if (clauseAt !== undefined && clauseAt < (nextSentence?.start ?? Infinity) - 1e-6 && rawEnd > clauseAt + NEW_LINE_SPILL_SEC) {
        const reading = shown + readAlong;
        const cap = Math.max(ownEnd + 0.3, clauseAt + NEW_LINE_SPILL_SEC, reading);
        if (cap < rawEnd) {
          // Held there for its fixed text, it leaves as any graphic does: in the next pause within
          // reach, else at the end of the word it is up in.
          const left = cap === reading ? leaveInPause(words, cap) : { at: cap, inPause: false };
          if (left.at < rawEnd) {
            rawEnd = left.at;
            leftInPause = left.inPause;
          }
        }
      }
      // A window shows its items' own pictures: it ends with the last item's picture, never showing
      // the next shot (Dale's "Facebook Marketplace" over the Etsy picture that followed, job 397).
      if (windows.has(spec.template)) {
        const after = cuts.find(c => c > lastShown + 0.3 && c < rawEnd - 1e-6);
        if (after !== undefined && after - shown >= MIN_ON_SCREEN_SEC) rawEnd = after;
      }
    } else if (planned !== undefined) {
      rawEnd = planned;
    } else {
      throw new CueError(`cue ${spec.id}: needs "end" words, "durationSec" or timed content`);
    }

    // 4. The end, conformed to the edit.
    let endCut = nearestCut(cuts, rawEnd);
    // Never stay stale to leave with a picture: a forward snap more than MAX_LINGER_SEC past where its
    // own sentence finished, as said before that cut, is refused — the point QA measures lingering
    // from (`spokenEnd`, `stillUpAfterWords`). It was measured from the graphic's own last word, so a
    // graphic its reading time had carried through the rest of its sentence could not take a snap of
    // two frames, and faded out into the cut instead: the fade lifts the old shot in its last frames,
    // a flicker right before the cut. Job 404's opening title "The song at first light goes quiet"
    // ("quiet" 7.88, "…in the mornings," to 10.24) ended at 10.33 for the cut at 10.40, and its "7
    // things" at 42.57 for 42.63 — QA's "flicker before a cut at 10.40 s, 42.63 s". A new clause of the
    // sentence is not its own (job 408): a snap more than MAX_LINGER_SEC past its own words is refused
    // too, unless the graphic is still inside its reading time and pause (`inReadingTime`) — QA, which
    // measures from its own words, excuses exactly that stay.
    if (endCut !== undefined && endCut > rawEnd && contentEnd !== undefined && !structural.has(spec.template)) {
      const said = ownSentenceEnd(words, contentEnd, endCut);
      const stay = { start: t0, shownAt: shown, end: onFrame(endCut), readSec, readAlongSec: readAlong, newClauseAt: said.newClauseAt };
      if (endCut - said.sentenceSpoken > MAX_LINGER_SEC || (endCut - said.spoken > MAX_LINGER_SEC && !inReadingTime(stay, 1 / fps + 1e-6))) endCut = undefined;
    }
    if (endCut === undefined) {
      const spill = cuts.filter(c => c < rawEnd && c > rawEnd - TAIL_SPILL_SEC && c - shown >= MIN_AFTER_TRIM_SEC && c - (lastShown - (spec.startPad ?? 0)) >= MIN_READ_SEC);
      if (spill.length) endCut = spill[spill.length - 1];
    }
    // 4a. A graphic that must cross a shot change (its last element appears too close before the cut
    // to end there) stays at least TAIL_SPILL_SEC onto the new shot — never a sliver of it (subtitle
    // practice; Scarlett's "Chunky black or very dark beads." ran 0.x s onto the next shot, job 395).
    if (endCut === undefined) {
      const crossed = cuts.filter(c => c > t0 + 0.1 && c < rawEnd - 1e-6 && rawEnd - c < TAIL_SPILL_SEC);
      const c = crossed[crossed.length - 1];
      if (c !== undefined) rawEnd = c + TAIL_SPILL_SEC;
    }
    // 4b. No blink of footage after a picture-replacing graphic: it holds through the pause and
    // leaves with the picture.
    let held = false;
    let holdMax: number | undefined;
    if (fullFrame.has(spec.template)) {
      const end = endCut ?? rawEnd;
      const next = cuts.find(c => c > end + 1e-6);
      // Words in the sliver that only FINISH the graphic's own sentence keep it up; a NEW sentence
      // starting there does not (`holdToCut`, measured from the graphic's own last word, so words it
      // already stayed up for are counted too).
      if (next !== undefined && next - end < MIN_SHOT_SEC && holdToCut(words, contentEnd ?? end, end, next).ok) {
        endCut = next;
        held = true;
      }
      // Leaving WITH the picture, however it got there — held to the cut, or its end already on it:
      // the hold's verdict on that cut is recorded for QA, which judges the graphic by the same rule.
      // Job 400's "7 thieves" card never took the hold: its end fell inside "thieves.", which the
      // transcript stretched over the pause to 100.91, and snapped back onto the cut at 100.63.
      if (endCut !== undefined) {
        const h = holdToCut(words, contentEnd ?? end, end, endCut);
        if (h.ok) holdMax = h.max;
      }
    }
    // When its own words finished among those said while it was up: its lingering is measured from here
    // (a hold's too).
    const own = contentEnd === undefined ? undefined : ownSentenceEnd(words, contentEnd, endCut ?? rawEnd);
    const spokenEnd = own?.spoken;
    const t1 = onFrame(endCut ?? rawEnd);
    if (t1 <= t0) throw new CueError(`cue ${spec.id}: ends before it starts`);
    const conformed = { start: startCut !== undefined, end: endCut !== undefined, ...(held ? { held: true } : {}) };
    return {
      id: spec.id,
      template: spec.template,
      start: round(t0),
      end: round(t1),
      startFrame: Math.round(t0 * fps),
      endFrame: Math.round(t1 * fps),
      ...(shown > t0 + 1e-6 ? { shownAt: round(shown) } : {}),
      // A graphic that ends ON a cut leaves WITH the picture: a fade there would brighten the old
      // shot for its last frames and read as a flicker right before the cut (job 376, 2:23, 3:01).
      props: {
        ...props,
        durationSec: (Math.round(t1 * fps) - Math.round(t0 * fps)) / fps,
        ...(conformed.end ? { exit: "cut" } : {}),
      },
      sync,
      conformed,
      contentEnd: contentEnd === undefined ? undefined : round(contentEnd),
      readSec: round(readSec),
      ...(own?.newClauseAt !== undefined ? { readAlongSec: round(readAlong), newClauseAt: round(own.newClauseAt) } : {}),
      ...(leftInPause ? { leftInPause: true } : {}),
      ...(spokenEnd !== undefined ? { spokenEnd: round(spokenEnd) } : {}),
      ...(holdMax !== undefined ? { hold: { cut: round(t1), max: holdMax } } : {}),
    };
  });

  // 5. Hand-off to the next graphic.
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i];
    const next = out[i + 1];
    if (next.start - a.end >= HANDOFF_GAP_SEC - 1e-6) continue;
    // A graphic held to a cut leaves WITH the picture; the next one is on a new shot.
    if (a.conformed.end && next.start >= a.end - 1e-6) continue;
    const floor = Math.max(shownFrom(a) + (a.readSec ?? MIN_ON_SCREEN_SEC), (a.contentEnd ?? a.start) + HANDOFF_MIN_TAIL_SEC);
    const t1 = Math.floor((next.start - HANDOFF_GAP_SEC) * fps + 1e-6) / fps;
    if (t1 < floor - 1e-6 || t1 >= a.end) continue;
    a.end = round(t1);
    a.endFrame = Math.round(t1 * fps);
    a.conformed = { ...a.conformed, end: false };
    const { exit: _exit, ...rest } = a.props as Record<string, unknown>;
    a.props = { ...rest, durationSec: (a.endFrame - a.startFrame) / fps };
  }
  return out;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** True when some element is set to appear at the cue's own start (`"at": 0`). */
function showsAtStart(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(showsAtStart);
  if (!v || typeof v !== "object") return false;
  return Object.entries(v as Record<string, unknown>).some(([k, x]) => (k === "at" && x === 0) || showsAtStart(x));
}

/** Every cue-relative time in resolved props (`at`, `wordTimes`) moved `delta` s earlier, so
 * each element stays on its word when the cue's start moves later. */
function shiftTimes(v: unknown, delta: number): unknown {
  if (Array.isArray(v)) return v.map(x => shiftTimes(x, delta));
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if ((k === "at" || k === "saidUntil" || k === "subAt") && typeof x === "number") out[k] = round(Math.max(0, x - delta));
    else if (k === "wordTimes" && Array.isArray(x)) out[k] = x.map(t => round(Math.max(0, (t as number) - delta)));
    else out[k] = shiftTimes(x, delta);
  }
  return out;
}

// Turns a CUE SHEET written in the script's own words into exact times on the film's clock.
//
// A cue never carries a hand-typed time. It names the words it starts on, the words it ends on,
// and, inside its props, the words each element appears on; this resolver finds them in the word
// transcript. That is the contract Phase 2's planner would write to (the same way the shot list
// names the words each shot starts on), and it is why a graphic cannot drift off its line when
// the voice is re-timed: re-resolve and every element follows its word.
//
// Pure: no I/O, no React — unit-tested in cueResolve.test.ts.

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
  /** Every word-timed element: what it shows, the word it waits for, and when that word starts. */
  sync: { element: string; word: string; wordStart: number; onCut?: boolean }[];
  /** Which edges were snapped onto a picture cut; `held` when the end was held through a pause to
   * the cut so no blink of footage is left (MIN_SHOT_SEC). */
  conformed: { start: boolean; end: boolean; held?: boolean };
  /** The same edges as FRAME NUMBERS — what the composite switches on (first frame shown) and
   * off (first frame NOT shown). Seconds rounded to the millisecond can land either side of a
   * frame and put one frame of graphic on the next shot. */
  startFrame: number;
  endFrame: number;
  /** When the last of the graphic's own words is spoken (seconds), if it has any. */
  contentEnd?: number;
  /** Seconds it needs on screen to be read (`readingSec`); the QA measures lingering past it. */
  readSec?: number;
  /** It left in the next pause (within PAUSE_REACH_SEC) instead of mid-word. */
  leftInPause?: boolean;
  /** For a graphic held to a cut: when the sentence it belongs to finished (its hold is measured
   * from here, the same in the resolver and the QA). */
  spokenEnd?: number;
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

/**
 * One word for another: case, number words ("three" = "3"), a plural "s", and — for words of four
 * letters or more — one letter changed, the way speech-to-text spells a word differently from the
 * script ("disc" heard as "disk", job 384). Never for short words, where one letter is a new word.
 */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  const x = NUMBER_WORDS[a] ?? a;
  const y = NUMBER_WORDS[b] ?? b;
  if (x === y || x === `${y}s` || y === `${x}s`) return true;
  // A trailing -d, like the plural -s: "lap-sized" against a transcript's "lap size".
  if (x.length >= 4 && y.length >= 4 && (x === `${y}d` || y === `${x}d`)) return true;
  if (x.length < 4 || x.length !== y.length || /\d/.test(x + y)) return false;
  let diff = 0;
  for (let i = 0; i < x.length && diff < 2; i++) if (x[i] !== y[i]) diff++;
  return diff === 1;
}

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
  if (i + 1 < index.length && same(index[i].tok + index[i + 1].tok, want[k])) return { di: 2, dk: 1 };
  if (i + 1 < index.length && /^\d+$/.test(want[k]) && digitOf(index[i].tok) + digitOf(index[i + 1].tok) === want[k]) return { di: 2, dk: 1 };
  if (k + 1 < want.length && same(index[i].tok, want[k] + want[k + 1])) return { di: 1, dk: 2 };
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

/** Up too short to read: under MIN_ON_SCREEN_SEC, with one frame allowed for edges rounded onto the
 * frame grid. The ONE test the planner (a new graphic is refused) and QA (a shipped one is reported)
 * both ask, so the two cannot disagree. */
export function tooShortToRead(c: { startFrame: number; endFrame: number }, fps: number): boolean {
  return c.endFrame - c.startFrame < MIN_ON_SCREEN_SEC * fps - 1 - 1e-6;
}

/**
 * HAND-OFF: two graphics never butt up against each other — the next one would read as the tail of
 * the one before (or, overlapping, as one stacked on the other). When the next starts less than
 * HANDOFF_GAP_SEC after this one ends, this one leaves early, on a fade, as long as it still holds
 * its own last word for HANDOFF_MIN_TAIL_SEC and MIN_ON_SCREEN_SEC in all. Its words are never cut
 * short to make room: if they would be, the two still touch and the rule check reports it.
 */
export const HANDOFF_GAP_SEC = 1.0;

/** The most a graphic may stay after its own last word, even to leave with a picture cut: past it
 * the graphic reads as stale. An end snaps FORWARD onto a cut only within this. */
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

/** How many words (and numbers) a graphic SHOWS, for its reading time. */
function shownWordCount(props: unknown): number {
  let n = 0;
  const walk = (v: unknown, key = "") => {
    if (["at", "say", "icon", "from", "start", "end", "winner", "answer", "theme", "place", "target", "exit"].includes(key)) return;
    if (typeof v === "number" && key === "value") n += 1;
    else if (typeof v === "string") n += v.trim().split(/\s+/).filter(Boolean).length;
    else if (Array.isArray(v)) v.forEach(x => walk(x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(props);
  return n;
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

export type ResolveOptions = {
  /** The film's real picture cuts, in seconds (the first frame of each new shot). */
  cuts?: number[];
  fps?: number;
  /** Templates that are TITLES, not captions (a chapter label): they keep their planned length. */
  structural?: Set<string>;
  /** Full-screen CARDS (they replace the picture), held to CARD_MAX_WAIT_SEC. */
  cards?: Set<string>;
  /** Every template that replaces the picture (cards and framed windows): held to the cut so no
   * sliver of footage under MIN_SHOT_SEC is left beside it. Defaults to `cards`. */
  fullFrame?: Set<string>;
};

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
  const windows = new Set(Array.from(fullFrame).filter(id => !cards.has(id)));
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
          const end = words[index[hits[hits.length - 1]].word].end;
          said(end);
          // When this side's words FINISH: a comparison waits for it before it gives its verdict.
          out.saidUntil = round(Math.max(0, end - t0));
        } else {
          out[k] = walk(x, pathName ? `${pathName}.${k}` : k);
        }
      }
      return out;
    };
    let props = walk(spec.props, "") as Record<string, unknown>;
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
      rawEnd = Math.max(t0 + readSec, planned === undefined ? byWords : Math.min(planned, byWords));
      // Leave in a pause, not mid-word: an end inside speech moves to the next pause within reach.
      const speaking = words.some(w => w.start < rawEnd - 1e-6 && w.end > rawEnd + 1e-6) || words.some(w => w.start > rawEnd && w.start - rawEnd < 0.15);
      if (speaking) {
        let moved = false;
        for (let k = 0; k + 1 < words.length; k++) {
          const gapAt = words[k].end;
          if (gapAt < rawEnd - 1e-6) continue;
          if (gapAt - rawEnd > PAUSE_REACH_SEC) break;
          if (words[k + 1].start - gapAt >= PAUSE_GAP_SEC) {
            rawEnd = gapAt + Math.min(0.1, (words[k + 1].start - gapAt) / 2);
            moved = true;
            leftInPause = true;
            break;
          }
        }
        // No pause within reach: at least never leave in the middle of a word.
        const inside = moved ? undefined : words.find(w => w.start < rawEnd - 1e-6 && w.end > rawEnd + 1e-6);
        if (inside) rawEnd = inside.end;
      }
      // Never into the NEXT sentence: reading time and a pause may carry a graphic through the rest of
      // its own sentence, not into a new one (Scarlett's "Keep the scale. Change the finish." card
      // stood over "Ivory, oat, a warm coral…", job 395).
      const ownEnd = contentEnd;
      const nextSentence = words.find((w, k) => w.start > ownEnd + 1e-6 && k > 0 && SENTENCE_END.test(words[k - 1].text.trim()));
      if (nextSentence && rawEnd > nextSentence.start + 0.15) {
        const cap = Math.max(ownEnd + 0.3, nextSentence.start + 0.15);
        if (cap < rawEnd) {
          rawEnd = cap;
          leftInPause = false;
        }
      }
      // A window shows its items' own pictures: it ends with the last item's picture, never showing
      // the next shot (Dale's "Facebook Marketplace" over the Etsy picture that followed, job 397).
      if (windows.has(spec.template)) {
        const after = cuts.find(c => c > lastShown + 0.3 && c < rawEnd - 1e-6);
        if (after !== undefined && after - t0 >= MIN_ON_SCREEN_SEC) rawEnd = after;
      }
    } else if (planned !== undefined) {
      rawEnd = planned;
    } else {
      throw new CueError(`cue ${spec.id}: needs "end" words, "durationSec" or timed content`);
    }

    // 4. The end, conformed to the edit.
    let endCut = nearestCut(cuts, rawEnd);
    // Never stay stale to leave with a picture: a forward snap past MAX_LINGER_SEC is refused.
    if (endCut !== undefined && endCut > rawEnd && contentEnd !== undefined && !structural.has(spec.template) && endCut - contentEnd > MAX_LINGER_SEC)
      endCut = undefined;
    if (endCut === undefined) {
      const spill = cuts.filter(c => c < rawEnd && c > rawEnd - TAIL_SPILL_SEC && c - t0 >= MIN_AFTER_TRIM_SEC && c - (lastShown - (spec.startPad ?? 0)) >= MIN_READ_SEC);
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
    let heldFrom: number | undefined;
    if (fullFrame.has(spec.template)) {
      const end = endCut ?? rawEnd;
      const next = cuts.find(c => c > end + 1e-6);
      // Words in the sliver that only FINISH the graphic's own sentence ("…a good night's sleep |
      // you may or may not have had.") keep it up; a NEW sentence starting there does not.
      // (from the graphic's own last word, so words it already stayed up for are counted too)
      const inSliver = next === undefined ? [] : words.filter(w => w.start > (contentEnd ?? end) + 1e-6 && w.start < next);
      let spoken = contentEnd ?? end;
      let newLine = false;
      for (const w of inSliver) {
        const prev = words[words.indexOf(w) - 1];
        if (prev && SENTENCE_END.test(prev.text.trim()) && prev.end <= w.start) {
          newLine = w.start > end + 1e-6 && w.start < (next as number) - NEW_LINE_GRACE_SEC;
          break;
        }
        spoken = Math.max(spoken, w.end);
      }
      const silent = next !== undefined && !words.some(w => w.start > spoken - 1e-6 && w.start < next);
      const holdMax = silent ? CARD_HOLD_SILENT_MAX_SEC : CARD_HOLD_MAX_SEC;
      if (next !== undefined && next - end < MIN_SHOT_SEC && next - spoken <= holdMax && !newLine) {
        endCut = next;
        held = true;
        heldFrom = spoken;
      }
    }
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
      ...(leftInPause ? { leftInPause: true } : {}),
      ...(heldFrom !== undefined ? { spokenEnd: round(heldFrom) } : {}),
    };
  });

  // 5. Hand-off to the next graphic.
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i];
    const next = out[i + 1];
    if (next.start - a.end >= HANDOFF_GAP_SEC - 1e-6) continue;
    // A graphic held to a cut leaves WITH the picture; the next one is on a new shot.
    if (a.conformed.end && next.start >= a.end - 1e-6) continue;
    const floor = Math.max(a.start + (a.readSec ?? MIN_ON_SCREEN_SEC), (a.contentEnd ?? a.start) + HANDOFF_MIN_TAIL_SEC);
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
    if ((k === "at" || k === "saidUntil") && typeof x === "number") out[k] = round(Math.max(0, x - delta));
    else if (k === "wordTimes" && Array.isArray(x)) out[k] = x.map(t => round(Math.max(0, (t as number) - delta)));
    else out[k] = shiftTimes(x, delta);
  }
  return out;
}

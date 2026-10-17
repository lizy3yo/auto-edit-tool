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
  sync: { element: string; word: string; wordStart: number }[];
  /** Which edges were snapped onto a picture cut. */
  conformed: { start: boolean; end: boolean };
  /** The same edges as FRAME NUMBERS — what the composite switches on (first frame shown) and
   * off (first frame NOT shown). Seconds rounded to the millisecond can land either side of a
   * frame and put one frame of graphic on the next shot. */
  startFrame: number;
  endFrame: number;
  /** When the last of the graphic's own words is spoken (seconds), if it has any. */
  contentEnd?: number;
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
export const MIN_AFTER_TRIM_SEC = 1.5;

/**
 * A graphic leaves this long after the last of its OWN words is spoken — broadcast caption
 * practice: text clears within about a second of the speech moving on — and is never on screen
 * for less than MIN_ON_SCREEN_SEC, so a short line can still be read. Job 384 at 0:10-0:13:
 * "It isn't broken. It isn't dead." stayed 4.7 s into "It just happens to be slow…".
 */
export const LINGER_SEC = 0.8;
export const MIN_ON_SCREEN_SEC = 1.5;

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

export type ResolveOptions = {
  /** The film's real picture cuts, in seconds (the first frame of each new shot). */
  cuts?: number[];
  fps?: number;
  /** Templates that are TITLES, not captions (a chapter label): they keep their planned length. */
  structural?: Set<string>;
  /** Full-screen CARDS (they replace the picture), held to CARD_MAX_WAIT_SEC. */
  cards?: Set<string>;
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
        const hits = findSubsequence(index, o.text, from);
        if (!hits) throw new CueError(`cue ${spec.id}: "${o.text}" is not in the narration near "${spec.start}"`);
        const times = displayWordTimes(o.text, hits, index, words).map(t => round(t - t0));
        sync.push({ element: `${pathName} "${o.text}"`, word: words[index[hits[0]].word].text, wordStart: words[index[hits[0]].word].start });
        said(words[index[hits[hits.length - 1]].word].end);
        return { text: o.text, at: times[0], wordTimes: times };
      }
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(o)) {
        if (k === "at" && typeof x === "string" && x.startsWith("@")) {
          const hits = findPhrase(index, x.slice(1), searchFrom);
          if (!hits) throw new CueError(`cue ${spec.id}: "${x.slice(1)}" (${pathName}.at) not in the narration`);
          const w = words[index[hits[0]].word];
          sync.push({ element: `${pathName}.at "${x.slice(1)}"`, word: w.text, wordStart: w.start });
          said(words[index[hits[hits.length - 1]].word].end);
          out[k] = round(Math.max(0, w.start - t0));
        } else if (k === "say" && typeof x === "string") {
          // The spoken words a piece of FIXED text stands for (a VS side's "A cord under a rug"):
          // never drawn, only counted, so the graphic stays until they are said and no longer.
          const hits = findSubsequence(index, x, searchFrom);
          if (!hits) throw new CueError(`cue ${spec.id}: "${x}" (${pathName}.say) not in the narration`);
          said(words[index[hits[hits.length - 1]].word].end);
        } else {
          out[k] = walk(x, pathName ? `${pathName}.${k}` : k);
        }
      }
      return out;
    };
    let props = walk(spec.props, "") as Record<string, unknown>;

    // 2b. A card that would open on an empty ground moves later, onto its first word. One that
    // shows something from its first frame (a VS side "at": 0) is not empty and stays — moving it
    // put both sides of job 385's VS card up at once, the first already greyed out.
    const firstWord = Math.min(...sync.map(x => x.wordStart));
    if (cards.has(spec.template) && sync.length && !showsAtStart(spec.props) && firstWord - t0 > CARD_MAX_WAIT_SEC) {
      const want = firstWord - CARD_LEAD_SEC;
      const cut = nearestCut(cuts, want);
      startCut = cut !== undefined && cut <= firstWord ? cut : undefined;
      const moved = onFrame(startCut ?? want);
      props = shiftTimes(props, moved - t0) as Record<string, unknown>;
      t0 = moved;
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
    if (!structural.has(spec.template) && contentEnd !== undefined) {
      const byWords = contentEnd + LINGER_SEC;
      rawEnd = Math.max(t0 + MIN_ON_SCREEN_SEC, planned === undefined ? byWords : Math.min(planned, byWords));
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
      const spill = cuts.filter(c => c < rawEnd && c > rawEnd - TAIL_SPILL_SEC && c - t0 >= MIN_AFTER_TRIM_SEC);
      if (spill.length) endCut = spill[spill.length - 1];
    }
    const t1 = onFrame(endCut ?? rawEnd);
    if (t1 <= t0) throw new CueError(`cue ${spec.id}: ends before it starts`);
    const conformed = { start: startCut !== undefined, end: endCut !== undefined };
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
    };
  });

  // 5. Hand-off to the next graphic.
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i];
    const next = out[i + 1];
    if (next.start - a.end >= HANDOFF_GAP_SEC - 1e-6) continue;
    const floor = Math.max(a.start + MIN_ON_SCREEN_SEC, (a.contentEnd ?? a.start) + HANDOFF_MIN_TAIL_SEC);
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
    if (k === "at" && typeof x === "number") out[k] = round(Math.max(0, x - delta));
    else if (k === "wordTimes" && Array.isArray(x)) out[k] = x.map(t => round(Math.max(0, (t as number) - delta)));
    else out[k] = shiftTimes(x, delta);
  }
  return out;
}

// Word times the transcriber gets wrong, put right from the sound itself. Pure.
//
// The aligner times words by their letters, and a word written in digits ("$40", "15%", "1,500")
// has none it can use, so its time is guessed — usually late. Dale's job 386 at 2:57: the voice
// runs straight on from "to" into "forty dollars" at ~177.1 s, the transcript put "$40" at
// 177.62, and the caption's "$40" came up half a second after it was heard. On-screen words may
// lead the voice a little but never lag it (subtitle practice), so a number is moved EARLIER to
// where the sound says it began — never later, and never across a pause.
import type { Word } from "../cueResolve";

/** Loudness frames the caller measures the film's sound in (dBFS). */
export const LEVEL_FRAME_SEC = 0.02;
/** A frame this far under the narration's speech level is a pause, not a word. */
const QUIET_BELOW_DB = 25;
/** That quiet for this long is a pause the number must not be moved across. */
const PAUSE_SEC = 0.12;
/** How long a word of n letters takes, roughly (a slow narrator's ~15 letters a second). */
const wordSec = (text: string) => 0.05 + 0.065 * text.replace(/[^a-z]/gi, "").length;

function speechDb(levels: number[]): number {
  const voiced = levels.filter(db => db > -50).sort((a, b) => a - b);
  return voiced.length ? voiced[Math.floor(voiced.length / 2)] : -20;
}

/** Whether the sound from `a` to `b` (seconds) runs on with no pause in it. */
function continuous(levels: number[], a: number, b: number, quiet: number): boolean {
  const need = Math.round(PAUSE_SEC / LEVEL_FRAME_SEC);
  let run = 0;
  for (let i = Math.max(0, Math.floor(a / LEVEL_FRAME_SEC)); i < Math.min(levels.length, Math.ceil(b / LEVEL_FRAME_SEC)); i++) {
    run = levels[i] < quiet ? run + 1 : 0;
    if (run >= need) return false;
  }
  return true;
}

/**
 * The words with each number's start moved back to where it was really said: right after the
 * word before it when the voice runs straight on, or inside that word when the aligner stretched
 * it over the number ("the" timed 0.4 s long, swallowing "ten"). Returns new objects.
 */
export function retimeNumbers(words: Word[], levels: number[]): Word[] {
  const out = words.map(w => ({ ...w }));
  if (!levels.length) return out;
  const quiet = speechDb(levels) - QUIET_BELOW_DB;
  for (let i = 1; i < out.length; i++) {
    const w = out[i];
    const prev = out[i - 1];
    if (!/\d/.test(w.text)) continue;
    let start = w.start;
    const expected = wordSec(prev.text);
    if (prev.end - prev.start > expected + 0.12 && continuous(levels, prev.start + expected, w.start, quiet)) {
      start = prev.start + expected;
    } else if (w.start - prev.end > 0.06 && continuous(levels, prev.end, w.start, quiet)) {
      start = prev.end + 0.02;
    }
    if (start < w.start - 0.01) {
      w.start = +start.toFixed(3);
      prev.end = Math.min(prev.end, w.start);
    }
  }
  return out;
}

/**
 * A word that the aligner started in the PAUSE before it is moved to where its sound begins.
 * Scarlett's "almost never | the problem" (job 392, 0:20): "the" was timed 20.47-21.25 across her
 * pause after "never", so the caption showed "the" 0.6 s before she said it. Only a word whose
 * start sits in a real pause (a quiet run of PAUSE_SEC from its start) is moved, and only later,
 * to the first sound inside its own span — never past its end.
 */
export function retimeLateStarts(words: Word[], levels: number[]): Word[] {
  const out = words.map(w => ({ ...w }));
  if (!levels.length) return out;
  const quiet = speechDb(levels) - QUIET_BELOW_DB;
  const need = Math.round(PAUSE_SEC / LEVEL_FRAME_SEC);
  for (const w of out) {
    let i = Math.floor(w.start / LEVEL_FRAME_SEC);
    const last = Math.floor((w.end - 0.06) / LEVEL_FRAME_SEC);
    let run = 0;
    while (i <= last && i < levels.length && levels[i] < quiet) {
      run++;
      i++;
    }
    if (run >= need && i <= last) w.start = +(i * LEVEL_FRAME_SEC).toFixed(3);
  }
  return out;
}

// ── Drift: a STRETCH of words timed seconds away from their sound ─────────────────────────────
//
// The fixes above move one word. The aligner can also slide a whole stretch: Hank's job 398 at
// 1:18 — "It sells for $90 to $130. But once you take out the lumber, that's about $14 for every
// hour" — has three numbers it cannot time by their letters, and it put "But once you take out the
// lumber, that's" 3 s early, over the end of the sentence before; the caption showed those words
// while he was still saying "$130", then sat still for 3.7 s of him speaking. The sound shows the
// damage plainly: speech with no word under it, and a word stretched over a real pause. Such a
// stretch is heard again on its own (a short request times well) and the new times are kept only
// when they are the same words and agree with the sound better (`healDrift` in server/graphics).

/** A run of speech this long with almost no word under it is a stretch the aligner lost. */
const UNHEARD_RUN_SEC = 1.0;
/** "Almost no word": less of the run than this is covered by word spans. */
const UNHEARD_COVER = 0.35;
/** A single word spanning a pause this long was stretched over it. */
const STRETCHED_PAUSE_SEC = 0.6;
/** A heard-again stretch reaches back at least this far before the damage, to where drift began. */
const DRIFT_REACH_SEC = 6;
/** The silence a heard-again stretch is cut in, so no word is cut in two. */
const CUT_PAUSE_SEC = 0.25;

type Span = { start: number; end: number };

/** The film's speech as runs between pauses of at least `pauseSec`. */
export function speechRuns(levels: number[], pauseSec = 0.2): Span[] {
  if (!levels.length) return [];
  const quiet = speechDb(levels) - QUIET_BELOW_DB;
  const need = Math.round(pauseSec / LEVEL_FRAME_SEC);
  const runs: Span[] = [];
  let from = -1;
  let silent = 0;
  for (let i = 0; i <= levels.length; i++) {
    const loud = i < levels.length && levels[i] >= quiet;
    if (loud) {
      if (from < 0) from = i;
      silent = 0;
    } else if (from >= 0) {
      silent++;
      if (silent >= need || i === levels.length) {
        runs.push({ start: from * LEVEL_FRAME_SEC, end: (i - silent + 1) * LEVEL_FRAME_SEC });
        from = -1;
        silent = 0;
      }
    }
  }
  return runs.filter(r => r.end - r.start >= 0.08);
}

const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * How well words agree with the sound inside [from, to], 0..1: the share of speech time covered
 * by words, times the share of word time that is over speech. Pure.
 */
export function fitToSound(words: Word[], levels: number[], from: number, to: number): number {
  const box = { start: from, end: to };
  const runs = speechRuns(levels).filter(r => overlap(r, box) > 0);
  const inside = words.filter(w => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 <= to);
  const speech = runs.reduce((n, r) => n + overlap(r, box), 0);
  const said = inside.reduce((n, w) => n + (w.end - w.start), 0);
  if (!speech || !said) return 0;
  const covered = runs.reduce((n, r) => n + inside.reduce((m, w) => m + overlap(r, w), 0), 0);
  return Math.min(1, covered / speech) * Math.min(1, covered / said);
}

/**
 * The stretches whose words the sound says are misplaced: a speech run of UNHEARD_RUN_SEC with
 * under UNHEARD_COVER of it covered by words, or one word spanning a pause of STRETCHED_PAUSE_SEC.
 * Each reaches back DRIFT_REACH_SEC (drift builds up before it shows) and is cut in silence on
 * both sides; overlapping stretches are joined. Pure.
 */
export function driftedStretches(words: Word[], levels: number[]): Span[] {
  const runs = speechRuns(levels);
  const pauses = speechRuns(levels, CUT_PAUSE_SEC)
    .map((r, k, all) => (k ? { start: all[k - 1].end, end: r.start } : undefined))
    .filter((p): p is Span => !!p);
  const damage: Span[] = [];
  for (const r of runs) {
    if (r.end - r.start < UNHEARD_RUN_SEC) continue;
    const covered = words.reduce((n, w) => n + overlap(r, w), 0);
    if (covered < (r.end - r.start) * UNHEARD_COVER) damage.push(r);
  }
  for (let k = 0; k + 1 < runs.length; k++) {
    const gap = { start: runs[k].end, end: runs[k + 1].start };
    if (gap.end - gap.start < STRETCHED_PAUSE_SEC) continue;
    if (words.some(w => w.start <= gap.start + 0.05 && w.end >= gap.end - 0.05)) damage.push(gap);
  }
  const mid = (p: Span) => (p.start + p.end) / 2;
  const total = levels.length * LEVEL_FRAME_SEC;
  const out: Span[] = [];
  for (const d of damage.sort((a, b) => a.start - b.start)) {
    const before = pauses.filter(p => p.end <= d.start - DRIFT_REACH_SEC).pop();
    const after = pauses.find(p => p.start >= d.end);
    const s = { start: before ? mid(before) : 0, end: after ? mid(after) : total };
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push(s);
  }
  return out;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether two word lists say the same thing (in order, allowing a word or two misheard). Pure. */
export function sameWords(a: Word[], b: Word[]): boolean {
  const x = a.map(w => norm(w.text)).filter(Boolean);
  const y = b.map(w => norm(w.text)).filter(Boolean);
  if (!x.length || !y.length) return false;
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const lcs = dp[x.length][y.length];
  return lcs >= 0.85 * x.length && lcs >= 0.85 * y.length;
}

/**
 * The words with those inside [from, to] (by midpoint) replaced by `patch` (absolute times), when
 * the patch says the same words and fits the sound better; otherwise unchanged. Pure.
 */
export function spliceStretch(words: Word[], patch: Word[], levels: number[], from: number, to: number): { words: Word[]; used: boolean } {
  const inside = (w: Word) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 <= to;
  const had = words.filter(inside);
  const fresh = patch.filter(inside);
  if (!sameWords(had, fresh)) return { words, used: false };
  if (fitToSound(fresh, levels, from, to) <= fitToSound(had, levels, from, to) + 0.05) return { words, used: false };
  return { words: [...words.filter(w => !inside(w)), ...fresh].sort((a, b) => a.start - b.start), used: true };
}

/** Every word timed by its sound: late starts out of the pause before them, then numbers back. */
export function retimeWords(words: Word[], levels: number[]): Word[] {
  return retimeNumbers(retimeLateStarts(words, levels), levels);
}

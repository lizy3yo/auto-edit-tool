// The QA every film with graphics is held to — ONE copy, used by the app's finishing step and the
// lab's composite. Pure: it reads frame-to-frame change measured off the RENDERED files (the
// faults it catches — a one-frame flash, a graphic still up after its words — only exist in the
// output), the resolved cues and the readability readings.
import { CUT_SNAP_SEC, MIN_ON_SCREEN_SEC, blinkBeside, stillUpAfterWords, tooShortToRead, type ResolvedCue } from "../cueResolve";
import { replacesPicture, templateById } from "../registry";
import { appearFrame } from "../timing";
import type { RuleProblem } from "./rules";

/**
 * HARD CUTS: frames whose change is a jump against their neighbourhood — at least 10 and 6x the
 * median of the second around it. A slow zoom, a moving clip or a talking host never gets there
 * (0.1-2); every scene cut on job 376 measured 30-108. `d[k]` is the change INTO frame k.
 */
export function detectCuts(d: number[]): number[] {
  const cuts: number[] = [];
  for (let k = 1; k < d.length; k++) {
    const around = [...d.slice(Math.max(1, k - 15), k - 1), ...d.slice(k + 2, k + 17)].sort((a, b) => a - b);
    const med = around[around.length >> 1] ?? 0;
    if (d[k] >= Math.max(10, 6 * med)) cuts.push(k);
  }
  return cuts;
}

/** A FLASH: a picture that lasts 3 frames or fewer between two HARD cuts (both ≥ 20). */
export function flashes(d: number[], cutFrames: number[], maxFrames = 3, hard = 20): [number, number][] {
  const big = cutFrames.filter(k => d[k] >= hard);
  const out: [number, number][] = [];
  for (let i = 1; i < big.length; i++) if (big[i] - big[i - 1] <= maxFrames) out.push([big[i - 1], big[i]]);
  return out;
}

/**
 * Change the graphics ADD in the frames right before each of the film's cuts. A graphic fading out
 * into a cut brightens the old shot for its last frames — a flicker no cut detector sees, because
 * each step is small. The film's own change is subtracted, so a moving clip is not blamed.
 */
export function preCutPumps(reel: number[], film: number[], cutFrames: number[], window = 5, limit = 3): { frame: number; added: number }[] {
  const out: { frame: number; added: number }[] = [];
  for (const c of cutFrames) {
    let added = 0;
    for (let k = Math.max(1, c - window); k < c; k++) added += Math.max(0, (reel[k] ?? 0) - (film[k] ?? 0));
    if (added > limit) out.push({ frame: c, added: Math.round(added * 10) / 10 });
  }
  return out;
}

export type Readability = { id: string; pass: boolean; summary: string; steps: string[] };

export type QaInput = {
  fps: number;
  cues: ResolvedCue[];
  /** Frame-to-frame change of the film WITHOUT graphics and WITH them. */
  filmDiffs: number[];
  reelDiffs: number[];
  rules: RuleProblem[];
  readability: Readability[];
};

export type QaResult = { pass: boolean; lines: string[]; failures: string[] };

/** Every check, in the order a person reads them; `failures` is empty when the film passes. */
export function judgeFilm(q: QaInput): QaResult {
  const { fps, cues } = q;
  const filmCuts = detectCuts(q.filmDiffs);
  const reelCuts = detectCuts(q.reelDiffs);
  const filmFlashes = new Set(flashes(q.filmDiffs, filmCuts).map(([a]) => a));
  // A flash is a graphic edge landing a few frames off a PICTURE cut. Two steep frames inside a
  // graphic's own fade (a full-frame darkening easing out over 12 frames), with no film cut within
  // 3 frames, are that fade, not a flash: listed, not failed.
  const nearFilmCut = (f: number) => filmCuts.some(k => Math.abs(k - f) <= 3);
  const inOwnFade = (f: number) => cues.some(c => (f >= c.startFrame - 1 && f <= c.startFrame + 13) || (f >= c.endFrame - 13 && f <= c.endFrame + 1));
  const all = flashes(q.reelDiffs, reelCuts).filter(([a]) => !filmFlashes.has(a));
  const fades = all.filter(([a, b]) => inOwnFade(a) && inOwnFade(b) && !nearFilmCut(a) && !nearFilmCut(b));
  const newFlashes = all.filter(f => !fades.includes(f));
  const pumps = preCutPumps(q.reelDiffs, q.filmDiffs, filmCuts);

  // Every word-timed element: the frame it appears on vs. the word it waits for. Text that would
  // start just before a shot change starts ON it (the subtitling shot-change rule, BBC subtitle
  // guidelines): listed as aligned to the cut, not out of sync.
  const rows: { cue: string; offsetMs: number; onCut: boolean }[] = [];
  for (const c of cues)
    for (const s of c.sync) {
      const rel = appearFrame(s.wordStart - c.start, fps);
      const offsetMs = Math.round(((c.startFrame + rel) / fps - s.wordStart) * 1000);
      rows.push({ cue: c.id, offsetMs, onCut: ((rel === 0 && c.conformed.start) || !!s.onCut) && Math.abs(offsetMs) <= CUT_SNAP_SEC * 1000 });
    }
  const worstSync = rows.filter(r => !r.onCut).reduce((m, r) => Math.max(m, Math.abs(r.offsetMs)), 0);
  const onCut = rows.filter(r => r.onCut && Math.abs(r.offsetMs) > 100);

  const structural = (c: ResolvedCue) => !!templateById(c.template).structural;
  // Still up after its words: asked by the resolver's own rules (`stillUpAfterWords`), on what it
  // recorded from the same words — a hold to the cut through the pause, a pause it left in, its
  // reading time. QA kept its own copy of those rules, which drifted: it failed job 400's
  // "7 thieves" card, which left on the cut in the silence after its own sentence (1:41).
  const lingering = cues.filter(c => !structural(c) && stillUpAfterWords(c, fps));
  // A blink of footage (under MIN_SHOT_SEC) between a graphic that hides the picture and the next or
  // previous shot change: card → b-roll for 0.8 s → host reads as a glitch. The planner refuses a new
  // graphic by the same test (`blinkBeside`), and a quote over the blurred picture is one of them
  // (`replacesPicture`): job 407's ended 0.54 s before the cut to the host and this line said 0.
  const blinks = cues.filter(c => replacesPicture(templateById(c.template)) && !!blinkBeside(c, filmCuts, fps));
  // A graphic carrying a tail of less than a second onto the next shot (one that ENDS on a cut
  // covers its last shot whole, which is not a spill).
  const spills = cues.filter(c => !c.conformed.end && filmCuts.some(k => k > c.startFrame + 3 && k < c.endFrame && c.endFrame - k < fps));
  // Up too short to read (under MIN_ON_SCREEN_SEC) — titles and approved graphics too, which the
  // planner raises or keeps rather than refuses: Dale's "3 piles" stood 1.27 s and his "The ad fee"
  // chapter 1.40 s, and QA said pass (job 397).
  const tooShort = cues.filter(c => tooShortToRead(c, fps));
  const unreadable = q.readability.filter(r => !r.pass);

  const failures: string[] = [];
  const at = (f: number) => `${(f / fps).toFixed(2)} s`;
  if (newFlashes.length) failures.push(`a flash the graphics added at ${newFlashes.map(([a]) => at(a)).join(", ")}`);
  if (pumps.length) failures.push(`flicker before a cut at ${pumps.map(p => at(p.frame)).join(", ")}`);
  if (worstSync > 100) failures.push(`a word on screen ${worstSync} ms off its voice`);
  if (lingering.length) failures.push(`still up after its words: ${lingering.map(c => c.id).join(", ")}`);
  if (blinks.length) failures.push(`a blink of footage beside ${blinks.map(c => c.id).join(", ")}`);
  if (spills.length) failures.push(`a tail onto the next shot: ${spills.map(c => c.id).join(", ")}`);
  if (tooShort.length) failures.push(`up too short to read (under ${MIN_ON_SCREEN_SEC} s): ${tooShort.map(c => `${c.id} (${at(c.endFrame - c.startFrame)})`).join(", ")}`);
  if (q.rules.length) failures.push(`placement: ${q.rules.map(p => `${p.cue} ${p.problem}`).join("; ")}`);
  if (unreadable.length) failures.push(`text not readable: ${unreadable.map(r => `${r.id} (${r.summary})`).join(", ")}`);

  const lines = [
    `Picture cuts: ${filmCuts.length}; graphic edges on a cut: ${cues.filter(c => c.conformed.start).length} starts, ${cues.filter(c => c.conformed.end).length} ends`,
    `Flashes added: ${newFlashes.length}${fades.length ? ` (${fades.length} steep step${fades.length > 1 ? "s" : ""} inside a graphic's own fade)` : ""}`,
    `Flicker before a cut: ${pumps.length}`,
    `Words on screen vs. heard: worst ${worstSync} ms over ${rows.length - onCut.length} elements${onCut.length ? `; ${onCut.length} moved onto a shot change` : ""}`,
    `Still up after their words: ${lingering.length}`,
    `Shorter than ${MIN_ON_SCREEN_SEC} s: ${tooShort.length}`,
    `Tails onto the next shot: ${spills.length}`,
    `Blinks of footage beside a card: ${blinks.length}`,
    `Placement rules: ${q.rules.length ? q.rules.length + " problem(s)" : "pass"}`,
    `Text readable on every shot it crosses: ${q.readability.length - unreadable.length}/${q.readability.length}`,
  ];
  return { pass: failures.length === 0, lines, failures };
}

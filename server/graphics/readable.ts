// Readability on the real frames (graphics/src/legibility.ts does the maths). For every overlay
// with text on footage, the finishing step renders it, measures it against the film under it at
// every shot it spans, and — only if it fails — fixes it (darker behind the words, a lighter shade
// of the coloured words, the calmest part of the picture), re-rendering and re-measuring each time.
import type { ResolvedCue } from "../../graphics/src/cueResolve";
import { PLACES, type Place } from "../../graphics/src/components";
import { MIN_COLOUR, MIN_WHITE, boxBrightness, findSubject, measureContrast, overlap, type Contrast } from "../../graphics/src/legibility";
import { themeFor } from "../../graphics/src/palette";
import { FRAME_H, FRAME_W, grabFrame } from "./media";

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Moments to judge: 0.35 s before the end of every shot the graphic spans (its words are up by
 * then, and it is clear of its own fade-out), and before its own end. */
export function sampleTimes(cue: ResolvedCue, cuts: number[]): number[] {
  const edges = [cue.start, ...cuts.filter(c => c > cue.start + 0.3 && c < cue.end - 0.3), cue.end];
  const out: number[] = [];
  for (let i = 1; i < edges.length; i++) if (edges[i] - edges[i - 1] > 0.5) out.push(edges[i] - 0.35);
  return out.slice(-5);
}

/** The theme's coloured text colours for this cue, exactly as it renders them. */
const inksOf = (props: Record<string, unknown>): number[][] => {
  const t = themeFor(props);
  return [t.accent, t.danger].map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
};

export type Reading = Contrast;

/** How readable it is relative to the minimums (≥ 1 passes). */
export const score = (r: Contrast) => Math.min((r.white ?? 99) / MIN_WHITE, (r.colour ?? 99) / MIN_COLOUR);

/** The worst reading over every shot the graphic crosses. */
export async function measureCue(film: string, gfx: string, cue: ResolvedCue, cuts: number[]): Promise<Reading> {
  let worst: Reading | undefined;
  for (const t of sampleTimes(cue, cuts)) {
    const [ov, fr] = await Promise.all([grabFrame(gfx, t - cue.start, true), grabFrame(film, t, false)]);
    const c = measureContrast(ov, fr, FRAME_W, FRAME_H, inksOf(cue.props));
    if (!worst || score(c) < score(worst)) worst = c;
  }
  return worst ?? { pass: true };
}

export async function subjectOf(film: string, t: number) {
  return findSubject(await grabFrame(film, t, false), FRAME_W, FRAME_H);
}

/** Where a block of `w`×`h` text would sit at `place` (matches the templates' placeStyle). */
function boxAt(place: Place, w: number, h: number): Box {
  const y0 = place.v === "top" ? 150 : place.v === "bottom" ? FRAME_H - 170 - h : (FRAME_H - h) / 2;
  const x0 = place.h === "left" ? 160 : FRAME_W - 160 - w;
  return { x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x0 + w), y1: Math.round(y0 + h) };
}

/** The calmest place for the text on these frames: the darkest box, off the subject. */
export async function calmestPlace(film: string, cue: ResolvedCue, cuts: number[], size: { w: number; h: number }): Promise<Place> {
  const frames = await Promise.all(sampleTimes(cue, cuts).map(t => grabFrame(film, t, false)));
  if (!frames.length) return PLACES[0];
  const subject = findSubject(frames[frames.length - 1], FRAME_W, FRAME_H).box;
  let best: { place: Place; score: number } | undefined;
  for (const place of PLACES) {
    const box = boxAt(place, size.w, size.h);
    const bright = Math.max(...frames.map(f => boxBrightness(f, FRAME_W, box)));
    const onSubject = overlap(box, subject) / ((box.x1 - box.x0) * (box.y1 - box.y0));
    const s = bright + 0.5 * onSubject;
    if (!best || s < best.score) best = { place, score: s };
  }
  return best!.place;
}

export const describe = (r: Contrast) =>
  [r.white !== undefined ? `white ${r.white.toFixed(1)}:1` : "", r.colour !== undefined ? `colour ${r.colour.toFixed(1)}:1` : ""].filter(Boolean).join(", ") || "no text";

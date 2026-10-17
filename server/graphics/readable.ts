// Readability on the real frames (graphics/src/legibility.ts does the maths). For every overlay
// with text on footage, the finishing step renders it, measures it against the film under it at
// every shot it spans, and — only if it fails — fixes it (darker behind the words, a lighter shade
// of the coloured words, the calmest part of the picture, and last the coloured words in the plain
// text colour), re-rendering and re-measuring each time (`makeReadable`).
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

/** The theme's coloured text colours for this cue, exactly as it renders them. Words drawn in the
 * plain text colour (`plain`) are white words, held to the white minimum, not a coloured ink. */
const inksOf = (props: Record<string, unknown>): number[][] => {
  const t = themeFor(props);
  return [t.accent, t.danger].filter(h => h !== t.text).map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
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

/**
 * Whether the last fix — the coloured words drawn in the plain text colour — can make a graphic
 * readable: it still fails on its COLOURED words, and its white words (if any) already read there.
 * White words that fail on this picture say the plain colour would fail too, so it is not drawn.
 */
export const plainInkMayHelp = (r: Contrast): boolean =>
  !r.pass && r.colour !== undefined && r.colour < MIN_COLOUR && (r.white === undefined || r.white >= MIN_WHITE);

/** What the fixes need from the finishing step: draw a cue as its props say, measure a drawing on
 * the film, and find the calmest part of the picture (asked only of a movable graphic). */
export type ReadableIo = {
  render: (c: ResolvedCue) => Promise<string>;
  measure: (c: ResolvedCue, file: string) => Promise<Reading>;
  calmest: (c: ResolvedCue, size: { w: number; h: number }) => Promise<Place>;
};

/**
 * Fixes a graphic's text on footage until it reads, one step at a time and only while it fails,
 * each step re-drawn and re-measured: darker behind the words (0.5, then 1), a lighter shade of
 * the coloured words, the calmest part of the picture (a movable graphic), and LAST the coloured
 * words in the theme's plain text colour (`plain`, built on the most readable drawing so far).
 * The cue's props are left as the most readable drawing found; the caller leaves the graphic out
 * when even that fails. No step touches WHEN the graphic shows — its start, end and frames stay
 * as resolved, so every other graphic's timing (and its drawing, already made) stays right.
 *
 * Why the last step: Hank's job 390 left out its "6 hours" number over dimmed b-roll ("colour
 * 4.0:1" after every fix) — a big number over the picture has no other place to go (not movable),
 * and white is the lightest ink there is. The graphic keeps the footage under it and its timing;
 * only the colour of its number is given up. A full-screen card in its place was not used: a card
 * re-times itself to the cuts, which moves the graphic before it after that one was drawn.
 */
export async function makeReadable(
  c: ResolvedCue,
  movable: boolean,
  designed: string,
  io: ReadableIo,
  /** Every drawing a fix makes (not the designed one) is added here, even when a later step
   * throws: the caller deletes those it does not ship. */
  attempts: string[]
): Promise<{ r: Reading; file: string; steps: string[] }> {
  const steps: string[] = [];
  let file = designed;
  let r = await io.measure(c, file);
  steps.push(`as designed: ${describe(r)}`);
  let best = { r, file, props: { ...c.props } };
  const keep = () => {
    attempts.push(file);
    if (r.pass || score(r) > score(best.r)) best = { r, file, props: { ...c.props } };
  };
  for (const shade of [0.5, 1]) {
    if (r.pass) break;
    c.props.shade = shade;
    file = await io.render(c);
    r = await io.measure(c, file);
    steps.push(`darker behind the words (${shade}): ${describe(r)}`);
    keep();
  }
  if (!r.pass && r.colour !== undefined && r.colour < MIN_COLOUR) {
    c.props.lift = 1;
    file = await io.render(c);
    r = await io.measure(c, file);
    steps.push(`lighter shade of the coloured words: ${describe(r)}`);
    keep();
  }
  if (!r.pass && movable && r.box) {
    c.props.place = await io.calmest(c, { w: r.box.x1 - r.box.x0, h: r.box.y1 - r.box.y0 });
    file = await io.render(c);
    r = await io.measure(c, file);
    steps.push(`moved to the calmest part of the picture: ${describe(r)}`);
    keep();
  }
  if (plainInkMayHelp(best.r)) {
    c.props = { ...best.props, plain: true } as typeof c.props;
    file = await io.render(c);
    r = await io.measure(c, file);
    steps.push(`coloured words in the plain text colour: ${describe(r)}`);
    keep();
  }
  c.props = best.props as typeof c.props;
  return { r: best.r, file: best.file, steps };
}

export const describe = (r: Contrast) =>
  [r.white !== undefined ? `white ${r.white.toFixed(1)}:1` : "", r.colour !== undefined ? `colour ${r.colour.toFixed(1)}:1` : ""].filter(Boolean).join(", ") || "no text";

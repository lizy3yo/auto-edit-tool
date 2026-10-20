// Readability on the real frames (graphics/src/legibility.ts does the maths). For every overlay
// with text on footage, the finishing step renders it, measures it against the film under it at
// every shot it spans, and — only if it fails — fixes it (darker behind the words, a lighter shade
// of the coloured words, the calmest part of the picture, and last the coloured words in the plain
// text colour), re-rendering and re-measuring each time (`makeReadable`).
import { shownFrom, type ResolvedCue } from "../../graphics/src/cueResolve";
import { PLACES, type Place } from "../../graphics/src/components";
import { MIN_COLOUR, MIN_WHITE, boxBrightness, findSubject, footprint, measureContrast, onSubject, subjectMap, type Contrast } from "../../graphics/src/legibility";
import { themeFor } from "../../graphics/src/palette";
import { clearSpot, placeBox, type SpotChoice, type Spots } from "../../graphics/src/spots";
import { FRAME_H, FRAME_W, grabFrame } from "./media";

/** Moments to judge: 0.35 s before the end of every shot the graphic spans (its words are up by
 * then, and it is clear of its own fade-out), and before its own end. */
export function sampleTimes(cue: ResolvedCue, cuts: number[]): number[] {
  const edges = [cue.start, ...cuts.filter(c => c > cue.start + 0.3 && c < cue.end - 0.3), cue.end];
  const out: number[] = [];
  for (let i = 1; i < edges.length; i++) if (edges[i] - edges[i - 1] > 0.5) out.push(edges[i] - 0.35);
  return out.slice(-5);
}

/** The moments of `sampleTimes` at which the graphic's words are on screen (`shownFrom`), for judging
 * WHERE it goes: a graphic whose start was put on a cut, or on words said before its own, draws nothing
 * until its first element's word (job 412's MYTH stamp: up at 33.13 s, drawn at 36.07 s), so a picture
 * it has left by then is not one it covers. The last moment is always kept. */
export function shownTimes(cue: ResolvedCue, cuts: number[]): number[] {
  const all = sampleTimes(cue, cuts);
  const shown = all.filter(t => t >= shownFrom(cue) - 1e-6);
  return shown.length ? shown : all.slice(-1);
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

/**
 * The calmest place for the text on these frames: the darkest box, off the subject — among the
 * template's own places when it has them (`spots`), else every place a block of text may take. The
 * subject is where the picture's subject map (`subjectMap`) puts it on each shot the graphic spans:
 * `findSubject`'s box, read off the last frame only, spread over most of the picture, so this chose
 * by brightness alone.
 */
export async function calmestPlace(film: string, cue: ResolvedCue, cuts: number[], size: { w: number; h: number }, spots?: Spots): Promise<Place> {
  const frames = await Promise.all(shownTimes(cue, cuts).map(t => grabFrame(film, t, false)));
  if (!frames.length) return spots?.places[0] ?? PLACES[0];
  const maps = frames.map(f => subjectMap(f, FRAME_W, FRAME_H));
  let best: { place: Place; score: number } | undefined;
  for (const place of spots?.places ?? PLACES) {
    const box = spots ? spots.box(place, size) : placeBox(place, size, size.h);
    const bright = Math.max(...frames.map(f => boxBrightness(f, FRAME_W, box)));
    const subject = Math.max(...maps.map(m => onSubject(m, box, FRAME_W, FRAME_H)));
    const s = bright + 0.5 * subject;
    if (!best || s < best.score) best = { place, score: s };
  }
  return best!.place;
}

/**
 * CLEAR OF THE SUBJECT: the place, of a template's own (`spots`), whose drawing covers least of the
 * picture's subject on every shot its words are up over (`shownTimes`, src/spots.ts `clearSpot`), its
 * drawing's size measured off the drawing as designed (`designed`, at the last moment judged — every
 * element is up by then). Asked before any readability fix, of a graphic drawn as designed over b-roll.
 * Undefined when there is nothing to judge (a graphic too short to sample, a drawing with nothing on it).
 */
export async function clearOfSubject(film: string, designed: string, cue: ResolvedCue, cuts: number[], spots: Spots): Promise<SpotChoice | undefined> {
  const times = shownTimes(cue, cuts);
  if (!times.length) return undefined;
  const drawn = footprint(await grabFrame(designed, times[times.length - 1] - cue.start, true), FRAME_W, FRAME_H);
  if (!drawn) return undefined;
  const frames = await Promise.all(times.map(t => grabFrame(film, t, false)));
  const maps = frames.map(f => subjectMap(f, FRAME_W, FRAME_H));
  return clearSpot(spots, { w: drawn.x1 - drawn.x0, h: drawn.y1 - drawn.y0 }, maps, { w: FRAME_W, h: FRAME_H }, cue.props.place as Place | undefined);
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

/** What a graphic with places of its own needs besides the readability fixes: which of them is clear
 * of the picture's subject (`clearOfSubject`), judged on its drawing as designed. */
export type PlaceIo = ReadableIo & { clear: (c: ResolvedCue, designed: string) => Promise<SpotChoice | undefined> };

const placeName = (p: Place) => `${p.v} ${p.h}`;

/**
 * A graphic with places of its own (registry `spots`), drawn as designed over b-roll: moved first to
 * the place clear of the picture's subject (`clearOfSubject`), then made readable there
 * (`makeReadable`). Readable only where it was designed, it goes back there rather than be left out —
 * the subject is a measure, a graphic that cannot be read is a loss. Any failure to judge the subject
 * keeps it as designed. The cue's props are left as the drawing returned; WHEN it shows never changes.
 */
export async function placeAndRead(c: ResolvedCue, movable: boolean, designed: string, io: PlaceIo, attempts: string[]): Promise<{ r: Reading; file: string; steps: string[] }> {
  let choice: SpotChoice | undefined;
  try {
    choice = await io.clear(c, designed);
  } catch {
    choice = undefined;
  }
  if (!choice?.moved) return makeReadable(c, movable, designed, io, attempts);
  const asDesigned = { ...c.props };
  const moveStep = `clear of the picture's subject: ${placeName(choice.from)} → ${placeName(choice.place)} (on the subject: ${choice.scores.map(s => `${placeName(s.place)} ${s.on.toFixed(2)}`).join(", ")})`;
  c.props.place = choice.place;
  const moved = await io.render(c);
  attempts.push(moved);
  const there = await makeReadable(c, movable, moved, io, attempts);
  if (there.r.pass) return { ...there, steps: [moveStep, ...there.steps] };
  const thereProps = { ...c.props };
  c.props = { ...asDesigned };
  const back = await makeReadable(c, movable, designed, io, attempts);
  const steps = [moveStep, ...there.steps, "not readable clear of the subject — back where it was designed:", ...back.steps];
  if (back.r.pass || score(back.r) >= score(there.r)) return { ...back, steps };
  c.props = thereProps as typeof c.props;
  return { r: there.r, file: there.file, steps };
}

export const describe = (r: Contrast) =>
  [r.white !== undefined ? `white ${r.white.toFixed(1)}:1` : "", r.colour !== undefined ? `colour ${r.colour.toFixed(1)}:1` : ""].filter(Boolean).join(", ") || "no text";

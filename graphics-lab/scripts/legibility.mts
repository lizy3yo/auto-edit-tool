// Readability on the real frames (src/legibility.ts does the maths). For every overlay with text
// on footage, the composite renders it, measures it against the film under it at every shot it
// spans, and — only if it fails — fixes it in this order, re-rendering and re-measuring each time:
//   1. darken more behind the words (shade 0.5, then 1)
//   2. if the template can move, put it where the picture is calmest, off the subject
// The arrow of an ArrowCaption is pointed at the picture's subject the same way.
import { spawn } from "node:child_process";
import type { ResolvedCue } from "../../graphics/src/cueResolve.ts";
import { PLACES, type Place } from "../../graphics/src/components.tsx";
import { themeFor } from "../../graphics/src/palette.ts";
import { MIN_COLOUR, MIN_WHITE, boxBrightness, findSubject, measureContrast, overlap, type Contrast } from "../../graphics/src/legibility.ts";

const W = 1920, H = 1080;
type Box = { x0: number; y0: number; x1: number; y1: number };

function grab(ff: string, file: string, t: number, rgba: boolean): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(ff, ["-hide_banner", "-loglevel", "error", "-ss", Math.max(0, t).toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-pix_fmt", rgba ? "rgba" : "rgb24", "-f", "rawvideo", "-"], { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", d => chunks.push(d));
    p.stderr.on("data", d => (err += d));
    p.on("error", reject);
    p.on("close", code => {
      const b = Buffer.concat(chunks);
      if (code !== 0 || b.length < W * H * (rgba ? 4 : 3)) reject(new Error(`frame grab failed at ${t.toFixed(2)} s of ${file}: ${err.slice(-300)}`));
      else resolve(new Uint8Array(b.buffer, b.byteOffset, W * H * (rgba ? 4 : 3)));
    });
  });
}

/** Moments to judge: the end of every shot the graphic spans (its words are up by then), and
 * its own end. */
export function sampleTimes(cue: ResolvedCue, cuts: number[]): number[] {
  const edges = [cue.start, ...cuts.filter(c => c > cue.start + 0.3 && c < cue.end - 0.3), cue.end];
  const out: number[] = [];
  // 0.35 s before each edge: clear of an overlay's own fade-out (8 frames) and of the cut.
  for (let i = 1; i < edges.length; i++) if (edges[i] - edges[i - 1] > 0.5) out.push(edges[i] - 0.35);
  return out.slice(-5);
}

export type Reading = Contrast & { at: number; film: Uint8Array };

/** The theme's coloured text colours for this cue, exactly as it renders them (src/palette themeFor). */
const inksOf = (props: Record<string, unknown>): number[][] => {
  const t = themeFor(props);
  return [t.accent, t.danger].map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
};

export async function measureCue(ff: string, film: string, gfx: string, cue: ResolvedCue, cuts: number[]): Promise<Reading> {
  let worst: Reading | undefined;
  for (const t of sampleTimes(cue, cuts)) {
    const [ov, fr] = await Promise.all([grab(ff, gfx, t - cue.start, true), grab(ff, film, t, false)]);
    const c = measureContrast(ov, fr, W, H, inksOf(cue.props));
    const score = Math.min((c.white ?? 99) / MIN_WHITE, (c.colour ?? 99) / MIN_COLOUR);
    const ws = worst ? Math.min((worst.white ?? 99) / MIN_WHITE, (worst.colour ?? 99) / MIN_COLOUR) : Infinity;
    if (!worst || score < ws) worst = { ...c, at: t, film: fr };
  }
  return worst ?? { pass: true, at: cue.start, film: new Uint8Array(0) };
}

export async function subjectOf(ff: string, film: string, t: number) {
  return findSubject(await grab(ff, film, t, false), W, H);
}

/** Where a block of `w`×`h` text would sit at `place` (matches components.placeStyle). */
export function boxAt(place: Place, w: number, h: number): Box {
  const y0 = place.v === "top" ? 150 : place.v === "bottom" ? H - 170 - h : (H - h) / 2;
  const x0 = place.h === "left" ? 160 : W - 160 - w;
  return { x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x0 + w), y1: Math.round(y0 + h) };
}

/** The calmest place for the text on these frames: the darkest box, off the subject. */
export async function calmestPlace(ff: string, film: string, cue: ResolvedCue, cuts: number[], size: { w: number; h: number }): Promise<{ place: Place; score: number }> {
  const frames = await Promise.all(sampleTimes(cue, cuts).map(t => grab(ff, film, t, false)));
  const subject = findSubject(frames[frames.length - 1], W, H).box;
  let best: { place: Place; score: number } | undefined;
  for (const place of PLACES) {
    const box = boxAt(place, size.w, size.h);
    const bright = Math.max(...frames.map(f => boxBrightness(f, W, box)));
    const onSubject = overlap(box, subject) / ((box.x1 - box.x0) * (box.y1 - box.y0));
    const score = bright + 0.5 * onSubject;
    if (!best || score < best.score) best = { place, score };
  }
  return best!;
}

export const describe = (r: Contrast) =>
  [r.white !== undefined ? `white ${r.white.toFixed(1)}:1` : "", r.colour !== undefined ? `colour ${r.colour.toFixed(1)}:1` : ""].filter(Boolean).join(", ") || "no text";

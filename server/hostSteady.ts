/**
 * Holds a lip-synced host clip's CAMERA still (2026-09-27).
 *
 * HeyGen's Avatar IV animates the whole frame, and on some photos it adds a slow "breathing"
 * camera — the room zooms in and out by ~1% every few seconds while the host talks. On Ruth's
 * phone-style photo (job 182) it measured 1.0% (her old photo 0.3%, Hank's and Mae's 0), and her
 * busy sewing room made it read as the camera moving in and out. Nothing in the request switches it
 * off, and vid.stab's tripod mode corrects slide and rotation but not zoom, so it is undone here:
 * the room behind the host is tracked against the first frame (zoom about the centre plus a slide,
 * measured on the frame's outer band, where the host is not), and each frame is resampled back
 * onto frame 0's geometry with `perspective`, zoomed in just enough that no edge ever shows.
 *
 * A clip whose camera does not move is returned untouched, so a steady render costs one decode.
 * Best-effort: any failure keeps the clip as rendered.
 *
 * v2 (2026-09-28): Ruth's job 206 still read as "the room moves when she moves" — 0.2-0.4% left
 * after steadying, against 0.03% on a photo HeyGen never moved. The fixed outer band was the
 * cause: her phone photo is framed wide, her shawl reaches 79% across, so the band tracked HER
 * as well as the room. The room is now found from the clip itself (`roomMask`: whatever still
 * differs from frame 0 after a first correction is the host, her hands, her shawl — dropped with a
 * margin), the path is tracked on every remaining pixel, corrected every `KNOT_EVERY` frames, and
 * the result measured again: a second pass runs while more than `STEADY_MIN_ZOOM` is left.
 * What that still leaves is JITTER, not a camera: HeyGen redraws the room a little differently
 * every frame (±0.1% zoom, ±1 px, on Ruth's takes — Mae's photo 0.03%), which no camera path can
 * follow. So a clip that needed steadying also has its ROOM FROZEN (`freezeRoom`): the room is the
 * photo and nothing in it should move, so every pixel outside where the host moves (her body,
 * hands, shawl, with a soft margin — `hostArea`) is taken from the clip's first frame. The host is
 * HeyGen's, untouched.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeCornerMark } from "./cornerMark";
import { execFfmpeg } from "./ffmpegSpawn";
import { personMasks, PH, PW } from "./personMask";


/** Analysis size: enough detail to track a shelf edge, small enough to scan every frame. */
const AW = 480;
const AH = 270;
/** Below both, the camera is still and the clip is left alone. */
export const STEADY_MIN_ZOOM = 0.0012; // 0.12% — a photo HeyGen leaves alone measures 0.03%
export const STEADY_MIN_SLIDE_PX = 2; // at 1920 wide
/** One knot of the correction curve every this many frames (a knot is a 5-frame mean). */
const KNOT_EVERY = 2;
/** Most passes: the second corrects what the first left. */
const MAX_PASSES = 2;

/** Frame k relative to frame 0: f_k((p − c)·s + c + d) ≈ f_0(p), in ANALYSIS pixels. */
export interface CameraPose {
  s: number;
  dx: number;
  dy: number;
}

/** The starting guess at the room: everything but the middle, where the host sits. */
const inBand = (x: number, y: number) => x < AW * 0.25 || x > AW * 0.75 || y < AH * 0.12;

/** Which analysis pixels are ROOM (1). */
export type RoomMask = Uint8Array;

export function bandMask(): RoomMask {
  const m = new Uint8Array(AW * AH);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) m[y * AW + x] = inBand(x, y) ? 1 : 0;
  return m;
}

/** Pixels that differ from frame 0 by more than this after correction are the host (0-255). */
const MOVING_LEVEL = 10;
/** How far around the host is dropped too (analysis px): hair, shawl edges, a hand's blur. */
const HOST_MARGIN = 8;

/**
 * The room, measured from the clip: after correcting each sampled frame with its pose, a pixel
 * that still differs from frame 0 is something that moves by itself — the host — and it is
 * dropped, with `HOST_MARGIN` around it. Falls back to the band when too little room is left
 * (a close-up). Pure.
 */
export function roomMask(frames: Uint8Array[], poses: CameraPose[]): RoomMask {
  const f0 = frames[0];
  const moving = new Uint8Array(AW * AH);
  const step = Math.max(1, Math.floor(frames.length / 40));
  for (let k = step; k < frames.length; k += step) {
    const p = poses[k];
    for (let y = 0; y < AH; y++) {
      for (let x = 0; x < AW; x++) {
        const v = bilinear(frames[k], (x - AW / 2) * p.s + AW / 2 + p.dx, (y - AH / 2) * p.s + AH / 2 + p.dy);
        if (v >= 0 && Math.abs(v - f0[y * AW + x]) > MOVING_LEVEL) moving[y * AW + x] = 1;
      }
    }
  }
  // Grow the host by the margin: a box dilation, rows then columns.
  const grown = new Uint8Array(AW * AH);
  for (let y = 0; y < AH; y++) {
    let last = -1e9;
    for (let x = 0; x < AW; x++) {
      if (moving[y * AW + x]) last = x;
      if (x - last <= HOST_MARGIN) grown[y * AW + x] = 1;
    }
    last = 1e9;
    for (let x = AW - 1; x >= 0; x--) {
      if (moving[y * AW + x]) last = x;
      if (last - x <= HOST_MARGIN) grown[y * AW + x] = 1;
    }
  }
  const mask = new Uint8Array(AW * AH);
  let room = 0;
  for (let x = 0; x < AW; x++) {
    const host = new Uint8Array(AH);
    let last = -1e9;
    for (let y = 0; y < AH; y++) {
      if (grown[y * AW + x]) last = y;
      if (y - last <= HOST_MARGIN) host[y] = 1;
    }
    last = 1e9;
    for (let y = AH - 1; y >= 0; y--) {
      if (grown[y * AW + x]) last = y;
      if (last - y <= HOST_MARGIN) host[y] = 1;
    }
    for (let y = 0; y < AH; y++) {
      const edge = x < 4 || y < 4 || x >= AW - 4 || y >= AH - 4;
      const keep = !edge && !host[y];
      mask[y * AW + x] = keep ? 1 : 0;
      if (keep) room++;
    }
  }
  return room >= AW * AH * 0.08 ? mask : bandMask();
}

function bilinear(f: Uint8Array, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= AW - 1 || yi >= AH - 1) return -1;
  const ax = x - xi;
  const ay = y - yi;
  const i = yi * AW + xi;
  return (
    (f[i] * (1 - ax) + f[i + 1] * ax) * (1 - ay) +
    (f[i + AW] * (1 - ax) + f[i + AW + 1] * ax) * ay
  );
}

function poseError(f0: Uint8Array, fk: Uint8Array, p: CameraPose, mask?: RoomMask): number {
  let e = 0;
  let n = 0;
  for (let y = 3; y < AH - 3; y += 2) {
    for (let x = 3; x < AW - 3; x += 2) {
      if (mask ? !mask[y * AW + x] : !inBand(x, y)) continue;
      const v = bilinear(fk, (x - AW / 2) * p.s + AW / 2 + p.dx, (y - AH / 2) * p.s + AH / 2 + p.dy);
      if (v < 0) continue;
      const d = v - f0[y * AW + x];
      e += d * d;
      n++;
    }
  }
  return n ? e / n : Infinity;
}

/** Coarse-to-fine descent from `seed` (the previous frame's pose — the camera moves slowly). */
export function trackPose(
  f0: Uint8Array,
  fk: Uint8Array,
  seed: CameraPose,
  mask?: RoomMask
): CameraPose {
  let best = { ...seed };
  let bestE = poseError(f0, fk, best, mask);
  for (const [ds, dp] of [
    [0.004, 1],
    [0.001, 0.25],
    [0.00025, 0.06],
  ]) {
    for (let guard = 0; guard < 40; guard++) {
      let moved = false;
      for (const [a, b, c] of [
        [ds, 0, 0],
        [-ds, 0, 0],
        [0, dp, 0],
        [0, -dp, 0],
        [0, 0, dp],
        [0, 0, -dp],
      ]) {
        const cand = { s: best.s + a, dx: best.dx + b, dy: best.dy + c };
        const e = poseError(f0, fk, cand, mask);
        if (e < bestE) {
          best = cand;
          bestE = e;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  return best;
}

/** Whether a measured path is worth correcting. Pure. */
export function needsSteadying(poses: CameraPose[], width = 1920): boolean {
  if (poses.length < 2) return false;
  const k = width / AW;
  const range = (v: number[]) => Math.max(...v) - Math.min(...v);
  return (
    range(poses.map(p => p.s)) >= STEADY_MIN_ZOOM ||
    range(poses.map(p => p.dx * k)) >= STEADY_MIN_SLIDE_PX ||
    range(poses.map(p => p.dy * k)) >= STEADY_MIN_SLIDE_PX
  );
}

/** A piecewise-linear ffmpeg expression in the input frame number `in`, through `knots`. Pure. */
export function knotExpr(knots: { at: number; v: number }[]): string {
  if (knots.length === 1) return knots[0].v.toFixed(5);
  const terms: string[] = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    const slope = (b.v - a.v) / (b.at - a.at);
    // `between` is inclusive at both ends; the half-open upper bound keeps a knot frame from
    // being counted twice.
    const upper = i === knots.length - 2 ? `lte(in,${b.at})` : `lt(in,${b.at})`;
    terms.push(`gte(in,${a.at})*${upper}*(${a.v.toFixed(5)}+${slope.toFixed(7)}*(in-${a.at}))`);
  }
  const last = knots[knots.length - 1];
  terms.push(`gt(in,${last.at})*${last.v.toFixed(5)}`);
  return terms.join("+");
}

/**
 * The `perspective` filter that puts every frame back on frame 0's geometry. `poses` are per
 * frame, in analysis pixels; the output is `width`×`height`. Pure.
 */
export function steadyFilter(poses: CameraPose[], width: number, height: number): string {
  const k = width / AW;
  // Knots: the mean pose over each window, so a single noisy frame cannot twitch the picture.
  const knots: { at: number; s: number; dx: number; dy: number }[] = [];
  for (let at = 0; at < poses.length; at += KNOT_EVERY) {
    const win = poses.slice(Math.max(0, at - 2), at + 3);
    const avg = (f: (p: CameraPose) => number) => win.reduce((a, p) => a + f(p), 0) / win.length;
    knots.push({ at, s: avg(p => p.s), dx: avg(p => p.dx) * k, dy: avg(p => p.dy) * k });
  }
  // Zoom in just enough that the corrected frame never samples outside the source.
  let m = 1;
  for (const q of knots) {
    const needX = q.s + (2 * Math.abs(q.dx)) / width;
    const needY = q.s + (2 * Math.abs(q.dy)) / height;
    m = Math.max(m, needX, needY);
  }
  m += 0.002;
  const S = `(${knotExpr(knots.map(q => ({ at: q.at, v: q.s / m })))})`;
  const DX = `(${knotExpr(knots.map(q => ({ at: q.at, v: q.dx })))})`;
  const DY = `(${knotExpr(knots.map(q => ({ at: q.at, v: q.dy })))})`;
  const X = (sx: number) => `W/2+${sx}*W/2*${S}+${DX}`;
  const Y = (sy: number) => `H/2+${sy}*H/2*${S}+${DY}`;
  return (
    `perspective=x0='${X(-1)}':y0='${Y(-1)}':x1='${X(1)}':y1='${Y(-1)}':` +
    `x2='${X(-1)}':y2='${Y(1)}':x3='${X(1)}':y3='${Y(1)}':` +
    `interpolation=cubic:sense=source:eval=frame`
  );
}

/** Every frame of a clip at analysis size, grey. */
async function readFrames(file: string): Promise<Uint8Array[]> {
  const { stdout } = await execFfmpeg(
    ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${AW}:${AH},format=gray`, "-f", "rawvideo", "-"],
    { encoding: "buffer", maxBuffer: 1 << 30 }
  );
  const raw = stdout as unknown as Buffer;
  const n = Math.floor(raw.length / (AW * AH));
  return Array.from({ length: n }, (_, i) => raw.subarray(i * AW * AH, (i + 1) * AW * AH));
}

function trackAll(frames: Uint8Array[], mask?: RoomMask): CameraPose[] {
  const poses: CameraPose[] = [{ s: 1, dx: 0, dy: 0 }];
  for (let i = 1; i < frames.length; i++) poses.push(trackPose(frames[0], frames[i], poses[i - 1], mask));
  return poses;
}

/**
 * Per-frame camera poses of a clip, relative to its first frame — tracked on the ROOM: a first
 * pass on the outer band finds roughly where the camera went, `roomMask` then drops whatever
 * still moves (the host), and the path is tracked again on everything that is left.
 */
export async function measureCameraPath(file: string): Promise<CameraPose[]> {
  const frames = await readFrames(file);
  if (frames.length < 2) return [{ s: 1, dx: 0, dy: 0 }];
  const rough = trackAll(frames);
  return trackAll(frames, roomMask(frames, rough));
}

/** A pixel is the HOST when it differs from frame 0 by this much in enough sampled frames. */
const HOST_LEVEL = 14;
const HOST_SHARE = 0.12;
/** The host's margin (analysis px) and the blend width at its edge (output px). */
const FREEZE_MARGIN = 12;
const FREEZE_FEATHER = 10;
/** Past this share of the frame the "host" is really the whole picture — freezing is skipped. */
const FREEZE_MAX_HOST = 0.7;

/**
 * The host as a SOLID shape (1) from where it moved (1). Motion only shows at the EDGES of a plain
 * surface: a navy tee or a black blazer looks the same frame to frame even while the body under it
 * moves, so only its outline read as "host" and the chest between the arms was frozen to frame 0
 * while the collar, shoulders and arms around it moved (a HeyGen host clip, 2026-09-30: 68% of the
 * shirt frozen). Two fills, both general:
 *  1. each row is host from its leftmost to its rightmost moving pixel — a person is solid between
 *     their own edges;
 *  2. any still pocket the room cannot reach from the TOP, LEFT or RIGHT edge is host — a seated
 *     host runs off the BOTTOM of the frame, so a pocket open only downwards is inside the body.
 * A little room between an arm and the body may be kept live; the camera correction still holds it.
 * Only the BODY is filled (`bodyPieces`, and what moves within its width): HeyGen redraws the room
 * a little every frame, so a plant edge or a shelf corner at the far left and right of the frame
 * still reads as moving, and a row filled from one such speck to the other covered the whole room
 * (Ruth's job 255, measured before the camera correction: the "host" filled the frame and the
 * freeze would have been skipped). The specks stay live as they are; they are never filled across.
 * Pure — unit-tested.
 */
export function solidHost(moving: Uint8Array, w = AW, h = AH): Uint8Array {
  // Everything moving within the body's WIDTH: a plain shirt's weak outline often joins up only
  // through small bits beside the big pieces (a black tee's far shoulder, 2026-09-30), and those
  // must still count. What lies past the body's left and right edges is the room.
  const pieces = bodyPieces(moving, w, h);
  let x0 = w;
  let x1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (!pieces[i]) continue;
    const x = i % w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
  }
  const body = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    if (moving[i] && x >= x0 && x <= x1) body[i] = 1;
  }
  const out = new Uint8Array(moving);
  for (let y = 0; y < h; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      if (!body[y * w + x]) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    if (lo >= 0) {
      out.fill(1, y * w + lo, y * w + hi + 1);
      body.fill(1, y * w + lo, y * w + hi + 1);
    }
  }
  // Room reachable from the top, left or right edge through non-body pixels; the rest is host.
  const room = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!body[i] && !room[i]) {
      room[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) seed(x);
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  for (let i = 0; i < w * h; i++) if (!room[i]) out[i] = 1;
  return out;
}

/** A moving piece is part of the body when it holds at least this share of all the movement. */
const BODY_PIECE_SHARE = 0.05;

/**
 * The pieces of `moving` that are the PERSON: every connected piece holding `BODY_PIECE_SHARE` of
 * the movement, and always the largest. The body need not be one piece — a plain shirt moves only
 * at its edges, so the head and each arm can come out separate (a HeyGen host clip: 76% / 13% / 8%)
 * — while HeyGen's redraw flicker on the room is many small specks (≤ 2.4% each on every host clip
 * measured, 2026-09-30). Pure.
 */
export function bodyPieces(moving: Uint8Array, w = AW, h = AH): Uint8Array {
  const label = new Int32Array(w * h);
  const sizes: number[] = [0];
  const stack: number[] = [];
  let total = 0;
  for (let s = 0; s < w * h; s++) {
    if (!moving[s] || label[s]) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const visit = (j: number) => {
        if (moving[j] && !label[j]) {
          label[j] = id;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < w * (h - 1)) visit(i + w);
    }
    sizes.push(size);
    total += size;
  }
  const largest = Math.max(...sizes);
  const keep = sizes.map(sz => sz > 0 && (sz === largest || sz >= total * BODY_PIECE_SHARE));
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (keep[label[i]]) out[i] = 1;
  return out;
}

/** Grow a mask by `r` along rows (`horizontal`) or columns — half of a box dilation. Pure. */
function grow(src: Uint8Array, horizontal: boolean, r: number, w = AW, h = AH): Uint8Array {
  const out = new Uint8Array(w * h);
  const [outer, inner] = horizontal ? [h, w] : [w, h];
  const at = (o: number, i: number) => (horizontal ? o * w + i : i * w + o);
  for (let o = 0; o < outer; o++) {
    let last = -1e9;
    for (let i = 0; i < inner; i++) {
      if (src[at(o, i)]) last = i;
      if (i - last <= r) out[at(o, i)] = 1;
    }
    last = 1e9;
    for (let i = inner - 1; i >= 0; i--) {
      if (src[at(o, i)]) last = i;
      if (last - i <= r) out[at(o, i)] = 1;
    }
  }
  return out;
}

/**
 * Where the host moves over the whole clip (1), with `FREEZE_MARGIN` around it: a pixel that
 * differs from frame 0 by `HOST_LEVEL` in at least `HOST_SHARE` of the sampled frames (so
 * compression noise on a busy shelf does not count, and a hand that only passes once still does
 * when it passes by a lot). Null when the host covers too much of the frame to freeze around. Pure.
 */
export function hostArea(frames: Uint8Array[]): Uint8Array | null {
  const f0 = frames[0];
  const hits = new Uint16Array(AW * AH);
  const big = new Uint8Array(AW * AH);
  const step = Math.max(1, Math.floor(frames.length / 60));
  let sampled = 0;
  for (let k = step; k < frames.length; k += step) {
    sampled++;
    const fk = frames[k];
    for (let i = 0; i < AW * AH; i++) {
      const d = Math.abs(fk[i] - f0[i]);
      if (d > HOST_LEVEL) hits[i]++;
      if (d > 40) big[i] = 1;
    }
  }
  const host = new Uint8Array(AW * AH);
  for (let i = 0; i < AW * AH; i++) host[i] = hits[i] >= sampled * HOST_SHARE || big[i] ? 1 : 0;
  const invert = (m: Uint8Array) => m.map(v => 1 - v);
  // Shave first: the room's thin edges (a shelf line, the window frame) flicker by a pixel under
  // HeyGen's redraw and read as "moving" — grown by the margin they covered Ruth's whole room.
  // An erosion removes anything thinner than 2 × SHAVE; the host's body survives it.
  const SHAVE = 2;
  const shaved = invert(grow(grow(invert(host), true, SHAVE), false, SHAVE));
  // The whole body, not just its moving outline (see `solidHost`).
  const margin = (m: Uint8Array) => grow(grow(m, true, FREEZE_MARGIN + SHAVE), false, FREEZE_MARGIN + SHAVE);
  const shareOf = (m: Uint8Array) => m.reduce((a, v) => a + v, 0) / (AW * AH);
  const area = margin(solidHost(shaved));
  if (shareOf(area) <= FREEZE_MAX_HOST) return area;
  // The fill swallowed the room (a host leaning on something that flickers): freeze around the
  // moving outline rather than not at all.
  const outline = margin(shaved);
  return shareOf(outline) > FREEZE_MAX_HOST ? null : outline;
}

/** Outputs frozen up to the person's edge — only so the log can say which freeze ran. */
const frozenAroundPerson = new Set<string>();

/** Room kept live around the person's cut-out in each frame (analysis px): hair, a hand's blur. */
const PERSON_MARGIN = 6;
/** The cut-out is trusted only when this share of the person, in most frames, sits in the band. */
const PERSON_IN_BAND = 0.75;

export type PersonMatte = {
  /** Per frame, what stays live (1) — always inside `hostArea`. */
  live: Uint8Array[];
  /** The frame whose room fills where the host sat in frame 0 (her spot is not room there). */
  fillFrame: number;
  /** Where the room is taken from `fillFrame` instead of frame 0. */
  fillFrom: Uint8Array;
};

/**
 * The room frozen right up to the host's edge in EVERY frame, not just outside the band she ever
 * moves through. The band (`hostArea`) must hold everywhere she goes, so whatever she is NOT
 * covering inside it used to show as rendered — and HeyGen drags a patterned thing next to a host
 * along with her as she sways (Ruth's quilt beside her shoulder, job 255, 2026-09-30), which read
 * as the cloth sliding against the still room around it. Now a pixel is live where the person
 * cut-out (`personMasks`, dilated `PERSON_MARGIN`, and ±1 frame) is — band or not — or where, inside
 * the band, it is clearly moving in that frame (`MOVE_LEVEL`); the rest of the band is room. Frame 0
 * is the room plate except where she sat in frame 0 — that is her, not room — which is taken from
 * the frame she overlaps least with it; what she covers in both stays live throughout, so no
 * ghost of her is ever painted in. Null when the cut-out does not agree with the band (the model
 * missed her), and the caller freezes around the band as before. Pure — unit-tested.
 */
export function personMatte(
  area: Uint8Array,
  persons: Uint8Array[],
  frames: Uint8Array[],
  pw = PW,
  ph = PH,
  w = AW,
  h = AH
): PersonMatte | null {
  const n = persons.length;
  if (!n) return null;
  let trusted = 0;
  const grown = persons.map(p => {
    const up = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(ph - 1, Math.floor((y * ph) / h));
      for (let x = 0; x < w; x++) up[y * w + x] = p[sy * pw + Math.min(pw - 1, Math.floor((x * pw) / w))];
    }
    let total = 0;
    let inBand = 0;
    for (let i = 0; i < w * h; i++) {
      if (!up[i]) continue;
      total++;
      inBand += area[i];
    }
    if (total >= w * h * 0.03 && inBand >= total * PERSON_IN_BAND) trusted++;
    return grow(grow(up, true, PERSON_MARGIN, w, h), false, PERSON_MARGIN, w, h);
  });
  if (trusted < n * 0.9) return null;
  // The frame that overlaps her frame-0 spot least fills it.
  let fillFrame = 0;
  let best = Infinity;
  for (let k = 1; k < n; k++) {
    let o = 0;
    for (let i = 0; i < w * h; i++) if (area[i] && grown[0][i] && grown[k][i]) o++;
    if (o < best) {
      best = o;
      fillFrame = k;
    }
  }
  const always = new Uint8Array(w * h);
  const fillFrom = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!grown[0][i]) continue;
    if (grown[fillFrame][i]) always[i] = 1;
    else fillFrom[i] = 1;
  }
  const f0 = frames[0];
  const live = grown.map((g, k) => {
    const prev = grown[Math.max(0, k - 1)];
    const next = grown[Math.min(n - 1, k + 1)];
    // Clearly moving right now, inside the band: a hand the cut-out missed stays live too.
    const diff = new Float32Array(w * h);
    const fk = frames[Math.min(k, frames.length - 1)];
    for (let i = 0; i < w * h; i++) diff[i] = area[i] ? Math.abs(fk[i] - f0[i]) : 0;
    const moving = boxMean(diff, MOVE_RADIUS, w, h);
    const m = new Uint8Array(w * h);
    // The person is live wherever the cut-out finds them, band or not: a plain apron or a far
    // shoulder barely moves, sits outside the band, and used to be frozen with the room.
    for (let i = 0; i < w * h; i++)
      if (g[i] || prev[i] || next[i] || always[i] || (area[i] && moving[i] >= MOVE_LEVEL)) m[i] = 1;
    return m;
  });
  return { live, fillFrame, fillFrom };
}

/** Inside the band, a patch this far from frame 0 (mean grey levels) is moving now: the host's
 *  face and shawl measure 24-38, HeyGen's redraw of a patterned quilt 5-7 (Ruth, job 255). */
const MOVE_LEVEL = 15;
const MOVE_RADIUS = 3;

/** Mean over a (2r+1)² box, edges clamped. Pure. */
function boxMean(src: Float32Array, r: number, w: number, h: number): Float32Array {
  const a = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let lo = 0;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      while (hi < Math.min(w - 1, x + r)) sum += src[y * w + ++hi];
      while (lo < x - r) sum -= src[y * w + lo++];
      a[y * w + x] = sum / (hi - lo + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let lo = 0;
    let hi = -1;
    for (let y = 0; y < h; y++) {
      while (hi < Math.min(h - 1, y + r)) sum += a[++hi * w + x];
      while (lo < y - r) sum -= a[lo++ * w + x];
      b[y * w + x] = sum / (hi - lo + 1);
    }
  }
  return b;
}

/** The clip's frame rate, read off ffmpeg's stream line ("25 fps"). */
async function frameRate(src: string): Promise<string> {
  const { stderr } = await execFfmpeg(["-hide_banner", "-i", src, "-frames:v", "1", "-f", "null", "-"]);
  const m = String(stderr).match(/(\d+(?:\.\d+)?) fps/);
  if (!m) throw new Error("no frame rate");
  return m[1];
}

/** `freezeRoom` with a per-frame matte (`personMatte`): the room is still up to the host's edge. */
async function freezeAroundPerson(dir: string, src: string, matte: PersonMatte): Promise<string> {
  const pgm = (m: Uint8Array) => Buffer.concat([Buffer.from(`P5\n${AW} ${AH}\n255\n`), Buffer.from(m.map(v => (v ? 255 : 0)))]);
  // The room plate: frame 0, with her frame-0 spot filled from `fillFrame`.
  const first = path.join(dir, "plate-0.png");
  const other = path.join(dir, "plate-fill.png");
  const fillMask = path.join(dir, "plate-fill.pgm");
  const plate = path.join(dir, "plate.png");
  await execFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-frames:v", "1", first]);
  await execFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf",
    `select='eq(n,${matte.fillFrame})'`, "-frames:v", "1", other]);
  await writeFile(fillMask, pgm(matte.fillFrom));
  await execFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", first, "-i", other, "-i", fillMask,
    "-filter_complex",
    `[2:v]scale=1920:1080,format=gray,gblur=sigma=${FREEZE_FEATHER / 2}[m];` +
      `[1:v]scale=1920:1080,format=rgba[f];[f][m]alphamerge[fill];` +
      `[0:v]scale=1920:1080[b];[b][fill]overlay=format=auto[p]`,
    "-map", "[p]", "-frames:v", "1", plate]);
  // The ROOM mask per frame (255 = room), as raw grey frames at the clip's own rate.
  const masks = path.join(dir, "room.gray");
  await writeFile(masks, Buffer.concat(matte.live.map(m => Buffer.from(m.map(v => (v ? 0 : 255))))));
  const fps = await frameRate(src);
  const out = path.join(dir, "frozen.mp4");
  const graph =
    `[2:v]scale=1920:1080,format=gray,gblur=sigma=${FREEZE_FEATHER / 2}[m];` +
    `[1:v]scale=1920:1080,format=rgba[r];[r][m]alphamerge[room];` +
    `[0:v]scale=1920:1080,setsar=1[v0];[v0][room]overlay=shortest=1:format=auto,format=yuv420p[v]`;
  await execFfmpeg(
    ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-loop", "1", "-i", plate,
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${AW}x${AH}`, "-r", fps, "-i", masks,
      "-filter_complex", graph, "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-c:a", "copy",
      "-movflags", "+faststart", out],
    { maxBuffer: 1 << 26 }
  );
  return out;
}

/**
 * The clip with its room taken from the first frame everywhere outside `hostArea`, blended over
 * `FREEZE_FEATHER` px at the host's edge. Returns the input path when there is nothing to freeze
 * around (the host fills the frame).
 */
async function freezeRoom(dir: string, src: string): Promise<string> {
  const frames = await readFrames(src);
  if (frames.length < 2) return src;
  const area = hostArea(frames);
  if (!area) return src;
  const persons = await personMasks(src);
  const matte = persons && persons.length === frames.length ? personMatte(area, persons, frames) : null;
  if (matte) {
    try {
      const out = await freezeAroundPerson(dir, src, matte);
      frozenAroundPerson.add(out);
      return out;
    } catch (err: any) {
      console.warn(`[HostSteady] per-frame freeze failed, freezing around the band — ${err?.message ?? err}`);
    }
  }
  // The ROOM mask (255 = room) as a greyscale image; ffmpeg scales and softens it.
  const room = Buffer.alloc(AW * AH);
  for (let i = 0; i < AW * AH; i++) room[i] = area[i] ? 0 : 255;
  const maskFile = path.join(dir, "room.pgm");
  await writeFile(maskFile, Buffer.concat([Buffer.from(`P5\n${AW} ${AH}\n255\n`), room]));
  const still = path.join(dir, "room.png");
  await execFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-frames:v", "1", still]);
  const out = path.join(dir, "frozen.mp4");
  const graph =
    `[2:v]scale=1920:1080,format=gray,gblur=sigma=${FREEZE_FEATHER / 2}[m];` +
    `[1:v]scale=1920:1080,format=rgba[r];[r][m]alphamerge[room];` +
    `[0:v]scale=1920:1080,setsar=1[v0];[v0][room]overlay=shortest=1:format=auto,format=yuv420p[v]`;
  await execFfmpeg(
    ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-loop", "1", "-i", still,
      "-loop", "1", "-i", maskFile, "-filter_complex", graph, "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-c:a", "copy",
      "-movflags", "+faststart", out],
    { maxBuffer: 1 << 26 }
  );
  return out;
}

/**
 * The clip with its camera held still and its room frozen, or the same buffer when the camera
 * already was still (or anything failed). `label` names the scene in the log.
 */
export async function steadyHostClip(
  clip: Buffer,
  label = "host clip",
  /**
   * Also freeze the room around the host (default). B-roll passes false: the camera is still
   * corrected, but a handled cloth or board is not a "room" — a plain one partly frozen would
   * tear the same way the plain shirt did.
   */
  opts: { freezeRoom?: boolean } = {}
): Promise<Buffer> {
  // A provider's stamped corner mark goes first (`server/cornerMark.ts`): this is the one seam
  // every provider clip crosses, and a patch rebuilt before the room is frozen is frozen with it.
  // A clip with no mark comes back as the same buffer, so nothing below changes for it.
  clip = await removeCornerMark(clip, label);
  if (process.env.HOST_STEADY === "0") return clip;
  const dir = await mkdtemp(path.join(tmpdir(), "host-steady-"));
  try {
    let src = path.join(dir, "in.mp4");
    await writeFile(src, clip);
    const range = (p: CameraPose[]) => Math.max(...p.map(q => q.s)) - Math.min(...p.map(q => q.s));
    let poses = await measureCameraPath(src);
    if (!needsSteadying(poses)) return clip;
    const before = range(poses);
    let pass = 0;
    // Correct, measure the result, and correct again while the room still moves.
    while (pass < MAX_PASSES && needsSteadying(poses)) {
      pass++;
      const script = path.join(dir, `filter-${pass}.txt`);
      const out = path.join(dir, `out-${pass}.mp4`);
      await writeFile(script, `[0:v]${steadyFilter(poses, 1920, 1080)},scale=1920:1080,setsar=1[v]`);
      await execFfmpeg(
        ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-filter_complex_script", script,
          "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "fast", "-crf", "16",
          "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", out],
        { maxBuffer: 1 << 26 }
      );
      src = out;
      poses = await measureCameraPath(src);
    }
    const frozen =
      process.env.HOST_FREEZE_ROOM === "0" || opts.freezeRoom === false
        ? src
        : await freezeRoom(dir, src);
    console.log(
      `[HostSteady] ${label}: camera zoom ${(before * 100).toFixed(2)}% → ${(range(poses) * 100).toFixed(2)}% ` +
        `(${pass} pass${pass > 1 ? "es" : ""})` +
        (frozen === src ? "" : frozenAroundPerson.delete(frozen) ? ", room frozen up to the host's edge" : ", room frozen")
    );
    return await readFile(frozen);
  } catch (err: any) {
    console.warn(`[HostSteady] ${label}: kept as rendered — ${err?.message ?? err}`);
    return clip;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

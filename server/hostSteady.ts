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
import { execFfmpeg } from "./ffmpegSpawn";


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
 * Pure — unit-tested.
 */
export function solidHost(moving: Uint8Array, w = AW, h = AH): Uint8Array {
  const out = new Uint8Array(moving);
  for (let y = 0; y < h; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      if (!moving[y * w + x]) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    if (lo >= 0) out.fill(1, y * w + lo, y * w + hi + 1);
  }
  // Room reachable from the top, left or right edge through non-host pixels; the rest is host.
  const room = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!out[i] && !room[i]) {
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
  // Grow by `r`, rows then columns (a box dilation).
  const grow = (src: Uint8Array, horizontal: boolean, r: number) => {
    const out = new Uint8Array(AW * AH);
    const [outer, inner] = horizontal ? [AH, AW] : [AW, AH];
    const at = (o: number, i: number) => (horizontal ? o * AW + i : i * AW + o);
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
  };
  const invert = (m: Uint8Array) => m.map(v => 1 - v);
  // Shave first: the room's thin edges (a shelf line, the window frame) flicker by a pixel under
  // HeyGen's redraw and read as "moving" — grown by the margin they covered Ruth's whole room.
  // An erosion removes anything thinner than 2 × SHAVE; the host's body survives it.
  const SHAVE = 2;
  const shaved = invert(grow(grow(invert(host), true, SHAVE), false, SHAVE));
  // The whole body, not just its moving outline (see `solidHost`).
  const area = grow(grow(solidHost(shaved), true, FREEZE_MARGIN + SHAVE), false, FREEZE_MARGIN + SHAVE);
  const share = area.reduce((a, v) => a + v, 0) / (AW * AH);
  return share > FREEZE_MAX_HOST ? null : area;
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
        `(${pass} pass${pass > 1 ? "es" : ""})${frozen !== src ? ", room frozen" : ""}`
    );
    return await readFile(frozen);
  } catch (err: any) {
    console.warn(`[HostSteady] ${label}: kept as rendered — ${err?.message ?? err}`);
    return clip;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

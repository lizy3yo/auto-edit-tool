/**
 * A provider's CORNER MARK, taken out of a clip before it is stored.
 *
 * A host clip came back from the lip-sync provider with a small four-pointed sparkle stamped in
 * its bottom-right corner — on a photo that was uploaded clean, so the mark is added somewhere
 * after the upload and nothing in our request switches it off. Whatever puts it there, the place
 * to deal with it is the one seam every provider clip crosses on its way to storage
 * (`steadyHostClip`): host takes, b-roll videos, the HeyGen test and the Upsell VSL alike.
 *
 * Two steps, and the second only when the first says so:
 *
 *  1. LOOK — one frame's bottom-right corner goes to a quick vision check that answers whether a
 *     logo or watermark is stamped there, and roughly where.
 *  2. REMOVE — ffmpeg's `delogo` rebuilds that small patch from the pixels around it. The frame
 *     is then looked at once more; a mark still showing gets one wider pass.
 *
 * A clip with no mark is returned as the SAME buffer, untouched. Never throws: a check that
 * cannot run, or a removal that fails, keeps the clip as it was rendered. `CORNER_MARK=0` turns
 * the whole thing off.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { invokeClaude } from "./claude";
import { execFfmpeg } from "./ffmpegSpawn";
import { safeParseJSON } from "./jsonRepair";
import { isMockMode } from "./mockMode";

/**
 * The careful checker (2026-10-07, the operator's call after the quick one let marks through):
 * a faint, see-through mark over a busy background is a fine judgement, and it is asked only for
 * the clips the shape search could not settle. `CORNER_MARK_MODEL` overrides it.
 */
const CORNER_MARK_MODEL = () =>
  process.env.CORNER_MARK_MODEL || "claude-sonnet-5-5";

/** The part of the frame that is looked at: its right 28% and bottom 32%. */
export const CORNER_W = 0.28;
export const CORNER_H = 0.32;
/** Width the corner is shown at — a 60 px mark in a 1080p frame becomes ~85 px. */
const LOOK_WIDTH = 768;

/** The removed patch, as a share of the frame's width: never smaller, never larger. */
export const BOX_MIN = 0.05;
export const BOX_MAX = 0.13;
/** How much wider than the mark itself the patch is cut — `delogo` needs clean pixels round it. */
const BOX_PAD = 1.7;
/** Where the mark sat on the clip this was built for: centre and width, as shares of the frame. */
export const USUAL_MARK = { cx: 0.933, cy: 0.874, w: 0.045 };

export const CORNER_MARK_SYSTEM =
  "You are shown the BOTTOM-RIGHT CORNER of a video clip twice, enlarged. IMAGE 1 is that corner " +
  "on the clip's FIRST frame. IMAGE 2 is the same corner on the clip's LAST frame. The camera " +
  "does not move, so the two show the same place.\n" +
  "Decide whether a logo or watermark has been STAMPED OVER the picture: a small four-pointed " +
  "sparkle or star, a small icon or badge, or a short brand word, sitting flat on top of the " +
  "image near the corner, usually white, grey or pale and partly see-through, ignoring the " +
  "scene's own light, focus and perspective. It is often FAINT. Such a mark frequently appears " +
  "only at the end of a clip: look carefully for a pale symbol in IMAGE 2 that is not in IMAGE " +
  "1 at the same spot — that difference is the strongest sign of one.\n" +
  "It is NOT a mark when it is part of the photographed scene and sits there in both images: a " +
  "real object, a light or its glint, a window, a pattern on cloth, a tool, printing on a real " +
  "label, or a real sign.\n" +
  'Return ONLY this JSON, no prose: {"mark":true|false,"on_first":true|false,"cx":0-100,"cy":0-100,"size":0-100,"what":"..."}\n' +
  "mark: true when a stamped mark is in IMAGE 2 (or in both). on_first: true when it is also in " +
  "IMAGE 1. cx, cy: the centre of the mark in IMAGE 2, as a percent of that image from its left " +
  "and top edges. size: the mark's width as a percent of that image's width. what: 2-6 words " +
  'naming it; "" when there is none.';

export interface CornerMarkVerdict {
  mark: boolean;
  /** The mark is on the clip's first frame too — it is there throughout, not only at the end. */
  onFirst?: boolean;
  /** Centre and width of the mark inside the corner image, 0..1 — absent when not given. */
  cx?: number;
  cy?: number;
  size?: number;
  what: string;
}

const share = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : undefined;
};

/**
 * Read the check's answer. Anything off-shape reads as "no mark": removing a patch of a clean
 * clip on an unreadable answer would be worse than leaving a marked one. Pure.
 */
export function parseCornerMarkVerdict(
  raw: string,
  stopReason?: string
): CornerMarkVerdict {
  const parsed = safeParseJSON<any>(raw, stopReason);
  if (!parsed.success || parsed.data?.mark !== true)
    return { mark: false, what: "" };
  const what = parsed.data.what;
  return {
    mark: true,
    onFirst: parsed.data.on_first === true,
    cx: share(parsed.data.cx),
    cy: share(parsed.data.cy),
    size: share(parsed.data.size),
    what: typeof what === "string" ? what.slice(0, 60) : "",
  };
}

export interface MarkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The patch to rebuild, in frame pixels. Centred where the check saw the mark (where the mark
 * usually sits when it gave no position), a square `BOX_PAD` times the mark's width held between
 * `BOX_MIN` and `BOX_MAX` of the frame, and kept a pixel inside every edge — `delogo` refuses a
 * box that touches one. `widen` is the second pass: it also covers the usual position. Pure.
 */
export function markBox(
  frameW: number,
  frameH: number,
  verdict: Pick<CornerMarkVerdict, "cx" | "cy" | "size">,
  widen = false
): MarkBox {
  const seen = verdict.cx != null && verdict.cy != null;
  if (!seen) return boxAround(frameW, frameH, USUAL_MARK, widen);
  return boxAround(
    frameW,
    frameH,
    {
      cx: 1 - CORNER_W + (verdict.cx as number) * CORNER_W,
      cy: 1 - CORNER_H + (verdict.cy as number) * CORNER_H,
      w: verdict.size != null ? verdict.size * CORNER_W : USUAL_MARK.w,
    },
    widen
  );
}

/** `markBox` for a mark whose centre and width are known as shares of the whole FRAME. Pure. */
export function boxAround(
  frameW: number,
  frameH: number,
  at: { cx: number; cy: number; w: number },
  widen = false,
  /** How much wider than the mark the patch is cut. */
  pad = BOX_PAD
): MarkBox {
  const cx = at.cx * frameW;
  const cy = at.cy * frameH;
  const markW = at.w * frameW;
  const side = Math.min(
    BOX_MAX * frameW,
    Math.max(BOX_MIN * frameW, markW * pad)
  );
  let x0 = cx - side / 2;
  let y0 = cy - side / 2;
  let x1 = cx + side / 2;
  let y1 = cy + side / 2;
  if (widen) {
    const half = (BOX_MAX * frameW) / 2;
    x0 = Math.min(x0, USUAL_MARK.cx * frameW - half);
    y0 = Math.min(y0, USUAL_MARK.cy * frameH - half);
    x1 = Math.max(x1, USUAL_MARK.cx * frameW + half);
    y1 = Math.max(y1, USUAL_MARK.cy * frameH + half);
  }
  const x = Math.max(1, Math.floor(x0));
  const y = Math.max(1, Math.floor(y0));
  const w = Math.max(2, Math.min(frameW - 1, Math.ceil(x1)) - x);
  const h = Math.max(2, Math.min(frameH - 1, Math.ceil(y1)) - y);
  return { x, y, w, h };
}

// ─── The sparkle, found by its shape ─────────────────────────────────────────────────────────
//
// The first version asked the vision check alone, both WHETHER a mark was there and WHERE. On
// the first real video it removed nothing: a faint, see-through sparkle on a dark bench is the
// case a "when unsure, answer false" check passes, and a position read off an enlarged corner is
// rough enough to rebuild a patch beside the mark. The mark that actually turns up is one fixed
// shape — a four-pointed star, paler than what is behind it — so it is now FOUND by that shape:
// measured, free, the same answer every time, and exact about where it sits. The vision check
// stays for a mark of any other kind.

/** Width the frame is searched at. The sparkle is ~4% of the frame wide: ~38 px here. */
const STAR_FRAME_W = 960;
/** Star radii tried, in px at `STAR_FRAME_W` — a mark 3.3% to 6.3% of the frame wide. */
const STAR_RADII = [16, 18, 20, 22, 24, 27, 30];
/**
 * At or above this the shape IS the sparkle. Measured with the background taken out
 * (`liftedOffBackground`): marked frames read 0.86, a clean workshop frame 0.69 at another spot.
 */
export const STAR_SURE = 0.78;
/** At or above this the shape's position is trusted over the vision check's. */
export const STAR_LIKELY = 0.6;
/**
 * A mark found by its shape is measured exactly, so its patch is cut close: the star's own width
 * and a quarter more. The wider cut a rough position needs reached far enough to drag whatever
 * sat beside the mark into the rebuilt patch as streaks.
 */
const STAR_PAD = 1.25;

export interface StarMatch {
  /** How closely the best spot matches a pale four-pointed star, -1..1. */
  score: number;
  /** How closely that same spot matches the star's plump rival (`starTemplate`). */
  rival: number;
  /** Its centre and width, as shares of the whole frame. */
  cx: number;
  cy: number;
  w: number;
}

/**
 * A four-pointed star (an astroid) of radius `r` on a square, with its mean taken out. `plump`
 * draws the diamond the star's four points span instead — the shape a soft blob of light, a
 * rounded highlight or a bump in a texture resembles, used as the star's rival (`bestStar`). Pure.
 */
export function starTemplate(
  r: number,
  plump = false
): {
  t: Float32Array;
  n: number;
  norm: number;
} {
  const n = 2 * r + 9;
  const c = (n - 1) / 2;
  const t = new Float32Array(n * n);
  let inside = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = Math.abs(x - c) / r;
      const dy = Math.abs(y - c) / r;
      if (plump ? dx + dy <= 1 : Math.sqrt(dx) + Math.sqrt(dy) <= 1) {
        t[y * n + x] = 1;
        inside++;
      }
    }
  const mean = inside / (n * n);
  let ss = 0;
  for (let i = 0; i < t.length; i++) {
    t[i] -= mean;
    ss += t[i] * t[i];
  }
  return { t, n, norm: Math.sqrt(ss) };
}

/**
 * The spot in a grey image that most resembles a pale four-pointed star, by normalised
 * correlation with `starTemplate` at each size. `gray` is `width × height`, one byte or float a
 * pixel. Flat patches are skipped: with no contrast there is nothing to correlate with, and the
 * division would turn noise into a perfect match. Pure.
 */
export function bestStar(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  radii: readonly number[] = STAR_RADII
): { score: number; rival: number; x: number; y: number; r: number } {
  let best = { score: -1, rival: -1, x: 0, y: 0, r: 0 };
  let at = { x: 0, y: 0 };
  /** Correlation of the `n`-square window at (x, y) with template `t`, or null on a flat one. */
  const match = (
    x: number,
    y: number,
    t: Float32Array,
    n: number,
    norm: number
  ): number | null => {
    let sum = 0;
    let sum2 = 0;
    let dot = 0;
    for (let j = 0; j < n; j++) {
      const row = (y + j) * width + x;
      const tr = j * n;
      for (let i = 0; i < n; i++) {
        const v = gray[row + i];
        sum += v;
        sum2 += v * v;
        dot += v * t[tr + i];
      }
    }
    const N = n * n;
    const spread = sum2 - (sum * sum) / N;
    return spread < N * 4 ? null : dot / (Math.sqrt(spread) * norm);
  };
  for (const r of radii) {
    const { t, n, norm } = starTemplate(r);
    for (let y = 0; y + n <= height; y += 2)
      for (let x = 0; x + n <= width; x += 2) {
        const score = match(x, y, t, n, norm);
        if (score != null && score > best.score) {
          best = { score, rival: -1, x: x + (n - 1) / 2, y: y + (n - 1) / 2, r };
          at = { x, y };
        }
      }
  }
  // How well the same spot matches the plump rival: a real sparkle has thin points and hollow
  // sides, so it matches the star clearly better; a soft blob matches the rival as well or better.
  if (best.r) {
    const rival = starTemplate(best.r, true);
    best.rival = match(at.x, at.y, rival.t, rival.n, rival.norm) ?? -1;
  }
  return best;
}

/** How much better than its plump rival a spot must match the star to be the sparkle. */
export const STAR_OVER_RIVAL = 0.05;

/**
 * The match that is enough when the star sits exactly where the mark always sits — a frame
 * where it is still fading in reads ~0.71. Anything star-like at that exact spot is the mark; a
 * clean frame's best match (~0.69) is elsewhere in the corner.
 */
export const STAR_AT_USUAL_SPOT = 0.62;
/** How far from the usual spot still counts as it, as a share of the frame. */
export const USUAL_SPOT_REACH = 0.02;

/**
 * True when a star match is the sparkle beyond doubt: a strong match anywhere in the corner, or
 * a fair one at the mark's usual spot (`cx`, `cy`: its centre as shares of the frame, when
 * known) — and in both cases clearly more star than blob. Pure.
 */
export const isSparkle = (m: {
  score: number;
  rival: number;
  cx?: number;
  cy?: number;
}): boolean => {
  if (m.score - m.rival < STAR_OVER_RIVAL) return false;
  if (m.score >= STAR_SURE) return true;
  return (
    m.cx != null &&
    m.cy != null &&
    Math.abs(m.cx - USUAL_MARK.cx) <= USUAL_SPOT_REACH &&
    Math.abs(m.cy - USUAL_MARK.cy) <= USUAL_SPOT_REACH &&
    m.score >= STAR_AT_USUAL_SPOT
  );
};

/**
 * How well ONE spot matches the star: the `bestStar` measure at a known centre and radius, for
 * following a mark already found through the frames around it. Null on a flat patch. Pure.
 */
export function starScoreAt(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number
): number | null {
  const { t, n, norm } = starTemplate(r);
  const x = Math.round(cx - (n - 1) / 2);
  const y = Math.round(cy - (n - 1) / 2);
  if (x < 0 || y < 0 || x + n > width || y + n > height) return null;
  let sum = 0;
  let sum2 = 0;
  let dot = 0;
  for (let j = 0; j < n; j++) {
    const row = (y + j) * width + x;
    const tr = j * n;
    for (let i = 0; i < n; i++) {
      const v = gray[row + i];
      sum += v;
      sum2 += v * v;
      dot += v * t[tr + i];
    }
  }
  const N = n * n;
  const spread = sum2 - (sum * sum) / N;
  return spread < N * 4 ? null : dot / (Math.sqrt(spread) * norm);
}

/** The corner's size at the width it is searched at. */
const cornerSize = (frameW: number, frameH: number) => {
  const H = Math.round((STAR_FRAME_W * frameH) / frameW);
  return {
    cw: Math.round(STAR_FRAME_W * CORNER_W),
    ch: Math.round(H * CORNER_H),
  };
};

/** The background's scale: wider than the sparkle's thin points, so they do not survive it. */
const BACKGROUND_MEDIAN = 31;

/**
 * What is LIGHTER than its surroundings in a grey corner image: each pixel minus the median of
 * the pixels around it, never below zero. The sparkle is see-through, so over a block of wood or
 * a bench edge the picture behind it dominated the match (0.55 on the first real clip, with a
 * clean frame at 0.46 — too close to tell apart). A wide median keeps the wood and the edges and
 * loses the thin-pointed star, so the difference is the star on a flat field: the same clip
 * reads 0.86, its faintest marked frame 0.71.
 */
async function liftedOffBackground(
  gray: Buffer,
  width: number,
  height: number
): Promise<Float32Array> {
  const { data, info } = await sharp(gray, {
    raw: { width, height, channels: 1 },
  })
    .median(BACKGROUND_MEDIAN)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // sharp hands a one-channel image back as three unless told otherwise, so the stride is read
  // off what actually came back: indexed as one channel, every pixel past the first third was
  // compared with the wrong one and the background was not removed at all.
  const step = info.channels;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++)
    out[i] = Math.max(0, gray[i] - data[i * step]);
  return out;
}

/** A star found in a frame's corner, with where it sits inside the corner image (for a scan). */
type FoundStar = StarMatch & { at: { x: number; y: number; r: number } };

/** Search a frame's bottom-right corner for the sparkle. */
async function findStar(png: Buffer): Promise<FoundStar> {
  const { data, info } = await sharp(png)
    .resize({ width: STAR_FRAME_W })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const cw = Math.round(W * CORNER_W);
  const ch = Math.round(H * CORNER_H);
  const x0 = W - cw;
  const y0 = H - ch;
  const corner = Buffer.alloc(cw * ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++)
      corner[y * cw + x] =
        data[(y0 + y) * W * info.channels + (x0 + x) * info.channels];
  const b = bestStar(await liftedOffBackground(corner, cw, ch), cw, ch);
  return {
    score: b.score,
    rival: b.rival,
    cx: (x0 + b.x) / W,
    cy: (y0 + b.y) / H,
    w: (2 * b.r) / W,
    at: { x: b.x, y: b.y, r: b.r },
  };
}

/**
 * The `-vf` value that rebuilds `box` from the pixels around it — from `fromSec` on when the mark
 * only comes in partway through the clip, so the frames before it are left exactly as rendered.
 * Pure.
 */
export const delogoFilter = (box: MarkBox, fromSec = 0): string =>
  `delogo=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}` +
  (fromSec > 0 ? `:enable='gte(t,${fromSec.toFixed(3)})'` : "");

type Frame = { png: Buffer; width: number; height: number };

/** The clip's first or last frame as a png, plus its size. */
async function frameOf(
  dir: string,
  clip: string,
  name: string,
  which: "first" | "last"
): Promise<Frame> {
  const file = path.join(dir, name);
  await execFfmpeg(
    which === "first"
      ? ["-hide_banner", "-loglevel", "error", "-y", "-i", clip, "-frames:v", "1", file]
      : // Every frame of the last second overwrites the one before: what is left is the last.
        ["-hide_banner", "-loglevel", "error", "-y", "-sseof", "-1", "-i", clip, "-update", "1", file],
    { maxBuffer: 1 << 26 }
  );
  const png = await readFile(file);
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) throw new Error("frame has no size");
  return { png, width: meta.width, height: meta.height };
}

/**
 * Ask whether a mark is stamped in the clip's bottom-right corner, showing the careful checker
 * the corner on the FIRST frame and on the LAST: a mark that comes in at the end is plain as the
 * difference between the two, where a faint one looked at alone is easy to pass. Throws when it
 * cannot ask.
 */
async function lookForMark(
  first: Frame,
  last: Frame
): Promise<CornerMarkVerdict> {
  const corner = async (frame: Frame) => {
    const w = Math.round(frame.width * CORNER_W);
    const h = Math.round(frame.height * CORNER_H);
    const png = await sharp(frame.png)
      .extract({ left: frame.width - w, top: frame.height - h, width: w, height: h })
      .resize({ width: LOOK_WIDTH })
      .png()
      .toBuffer();
    return { base64: png.toString("base64"), mediaType: "image/png" as const };
  };
  const result = await invokeClaude({
    systemPrompt: CORNER_MARK_SYSTEM,
    userMessage:
      "IMAGE 1 is the corner on the first frame, IMAGE 2 on the last. Is a logo or watermark stamped over it?",
    imageInput: [await corner(first), await corner(last)],
    maxTokens: 200,
    model: CORNER_MARK_MODEL(),
    thinking: "off",
    step: "Corner mark check",
  });
  return parseCornerMarkVerdict(result.text, result.stopReason);
}

/** How far back from the end the mark is followed. A longer run is treated as the whole clip. */
const TAIL_SEC = 4;
/** At or above this a frame still shows the mark at the spot it was found (it fades in). */
export const STAR_PRESENT = 0.45;
/** The patch starts this long before the first frame the mark shows in — its faintest frames. */
const START_LEAD_SEC = 0.3;

/**
 * When the mark starts, given how well each frame of the clip's tail matched it. `scores` are
 * the tail's frames in order, the last one the clip's last frame. 0 ⇒ the whole clip: the mark
 * is there from the first frame looked at (and the tail did not reach the clip's start), or the
 * frames could not be read. Pure.
 */
export function markStartSec(
  scores: (number | null)[],
  fps: number,
  durationSec: number
): number {
  if (!scores.length || !(fps > 0) || !(durationSec > 0)) return 0;
  const first = scores.findIndex(s => s != null && s >= STAR_PRESENT);
  if (first < 0) return 0;
  const tailStart = durationSec - scores.length / fps;
  // There from the tail's first frame, and the tail began after the clip did: it started
  // earlier than was looked at, so nothing is assumed about where.
  if (first === 0 && tailStart > 0.2) return 0;
  return Math.max(0, tailStart + first / fps - START_LEAD_SEC);
}

/** The clip's length and frame rate, read off ffmpeg's banner. */
async function probe(
  src: string
): Promise<{ durationSec: number; fps: number }> {
  const { stderr } = await execFfmpeg(["-hide_banner", "-i", src, "-frames:v", "1", "-f", "null", "-"]);
  const text = String(stderr);
  const d = text.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const f = text.match(/(\d+(?:\.\d+)?) fps/);
  if (!d || !f) throw new Error("no duration or frame rate");
  return {
    durationSec: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]),
    fps: Number(f[1]),
  };
}

/**
 * When a mark found on the clip's LAST frame comes in. The mark that turned up is not on the
 * clip from the start — it fades in over its final few frames — so the patch is rebuilt only
 * from there: the rest of the clip keeps every pixel it was rendered with. 0 (the whole clip) on
 * any failure to read the tail, which costs sharpness in one small patch, never a missed mark.
 */
async function whenMarkStarts(
  src: string,
  frame: Frame,
  star: FoundStar
): Promise<number> {
  try {
    const { durationSec, fps } = await probe(src);
    const { cw, ch } = cornerSize(frame.width, frame.height);
    const { stdout } = await execFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-sseof", `-${TAIL_SEC}`, "-i", src, "-vf",
        `crop=iw*${CORNER_W}:ih*${CORNER_H}:iw*${1 - CORNER_W}:ih*${1 - CORNER_H},` +
          `scale=${cw}:${ch},format=gray`,
        "-f", "rawvideo", "-"],
      { encoding: "buffer", maxBuffer: 1 << 28 }
    );
    const bytes = stdout as unknown as Buffer;
    const size = cw * ch;
    const scores: (number | null)[] = [];
    for (let off = 0; off + size <= bytes.length; off += size)
      scores.push(
        starScoreAt(
          await liftedOffBackground(bytes.subarray(off, off + size), cw, ch),
          cw,
          ch,
          star.at.x,
          star.at.y,
          star.at.r
        )
      );
    return markStartSec(scores, fps, durationSec);
  } catch {
    return 0;
  }
}

/** Re-encode `src` with `box` rebuilt from `fromSec` on — the steadier's own encode settings. */
async function rebuildPatch(
  src: string,
  out: string,
  box: MarkBox,
  fromSec = 0
): Promise<void> {
  await execFfmpeg(
    ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf", delogoFilter(box, fromSec),
      "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-movflags", "+faststart", out],
    { maxBuffer: 1 << 26 }
  );
}

/**
 * The clip with a stamped corner mark removed, or the SAME buffer when it has none (or the check
 * or the removal could not run). `label` names the clip in the log.
 *
 * The clip is judged on its LAST frame as well as its first. The first version looked at the
 * first frame only and removed nothing from the first real video: on the provider's clips the
 * sparkle is not there at the start — it fades in over the final few frames. That is also why it
 * showed so plainly in a film: a clip a little shorter than its line holds its LAST frame.
 */
export async function removeCornerMark(
  clip: Buffer,
  label = "clip"
): Promise<Buffer> {
  if (process.env.CORNER_MARK === "0") return clip;
  // Mock clips are drawn locally and carry no provider's mark; the check would only be a bill.
  if (await isMockMode().catch(() => false)) return clip;
  const dir = await mkdtemp(path.join(tmpdir(), "corner-mark-"));
  try {
    const src = path.join(dir, "in.mp4");
    await writeFile(src, clip);
    const last = await frameOf(dir, src, "last.png", "last");
    const first = await frameOf(dir, src, "first.png", "first");
    // The sparkle is found by its shape: sure enough, and the vision check is not asked.
    const atEnd = await findStar(last.png);
    const atStart = await findStar(first.png);
    const star = isSparkle(atStart) && !isSparkle(atEnd) ? atStart : atEnd;    const sure = isSparkle(star);
    // Not settled by the shape: the careful checker compares the first frame with the last.
    const seen: CornerMarkVerdict = sure
      ? { mark: true, onFirst: isSparkle(atStart), what: "a sparkle mark" }
      : await lookForMark(first, last);
    if (!seen.mark) return clip;
    // WHERE: the shape's own position when the shape is what was found, or sits where the
    // checker saw the mark — measured, where the checker's is an estimate off an enlarged corner.
    const seenAt =
      seen.cx != null && seen.cy != null
        ? {
            cx: 1 - CORNER_W + seen.cx * CORNER_W,
            cy: 1 - CORNER_H + seen.cy * CORNER_H,
          }
        : null;
    const byShape =
      sure ||
      (star.score >= STAR_LIKELY &&
        (!seenAt ||
          (Math.abs(star.cx - seenAt.cx) <= 0.05 &&
            Math.abs(star.cy - seenAt.cy) <= 0.05)));
    const boxFor = (widen: boolean) =>
      byShape
        ? boxAround(last.width, last.height, star, widen, STAR_PAD)
        : markBox(last.width, last.height, seen, widen);
    // WHEN: the whole clip when it is on the first frame too — some clips carry it throughout.
    // Otherwise from where it comes in, followed back through the tail by its shape; a mark
    // whose shape cannot be followed is rebuilt over the whole clip, since guessing where it
    // starts risks leaving it in.
    const fromSec =
      seen.onFirst || !byShape ? 0 : await whenMarkStarts(src, last, star);

    const out = path.join(dir, "out.mp4");
    await rebuildPatch(src, out, boxFor(false), fromSec);
    let cleaned = out;
    // Looked at again: a patch cut beside the mark leaves it in the film with a smudge next to
    // it. The sparkle is re-measured; a mark only the checker saw is shown to it again.
    const after = await frameOf(dir, out, "after.png", "last");
    const still = sure
      ? isSparkle(await findStar(after.png))
      : await lookForMark(first, after).then(
          v => v.mark,
          () => false
        );
    if (still) {
      const wide = path.join(dir, "wide.mp4");
      await rebuildPatch(src, wide, boxFor(true), 0);
      cleaned = wide;
    }
    console.log(
      `[CornerMark] ${label}: removed ${seen.what || "a corner mark"} ` +
        `(${sure ? `found by shape, match ${star.score.toFixed(2)} against ${star.rival.toFixed(2)} for a blob` : `found by the careful checker${byShape ? ", placed by shape" : ""}`}` +
        `, ${fromSec > 0 ? `from ${fromSec.toFixed(2)}s` : "whole clip"}` +
        `${still ? ", second wider pass" : ""})`
    );
    return await readFile(cleaned);
  } catch (err: any) {
    console.warn(
      `[CornerMark] ${label}: kept as rendered — ${err?.message ?? err}`
    );
    return clip;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

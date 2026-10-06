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

/** Haiku: a yes/no on one small image, on the path of every provider clip. */
const CORNER_MARK_MODEL = "claude-haiku-4-5-20251001";

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
  "You are shown the BOTTOM-RIGHT CORNER of one frame of a video, enlarged. Decide whether a " +
  "logo or watermark has been STAMPED OVER the picture there: a small four-pointed sparkle or " +
  "star, a small icon or badge, or a short brand word, sitting flat on top of the image near " +
  "the corner, usually white or pale and partly see-through, ignoring the scene's own light, " +
  "focus and perspective.\n" +
  "It is NOT a mark when it is part of the photographed scene: a real object, a light or its " +
  "glint, a window, a pattern on cloth, a tool, printing on a real label, or a real sign.\n" +
  "When unsure, answer false.\n" +
  'Return ONLY this JSON, no prose: {"mark":true|false,"cx":0-100,"cy":0-100,"size":0-100,"what":"..."}\n' +
  "cx, cy: the centre of the mark, as a percent of THIS image from its left and top edges. " +
  "size: the mark's width as a percent of this image's width. what: 2-6 words naming it; \"\" " +
  "when there is none.";

export interface CornerMarkVerdict {
  mark: boolean;
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
/** At or above this the shape IS the sparkle (it scores ~0.80; a clean workshop frame ~0.47). */
export const STAR_SURE = 0.66;
/** At or above this the shape's position is trusted over the vision check's. */
export const STAR_LIKELY = 0.5;
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

/** True when a `bestStar` result is the sparkle beyond doubt. Pure. */
export const isSparkle = (m: { score: number; rival: number }): boolean =>
  m.score >= STAR_SURE && m.score - m.rival >= STAR_OVER_RIVAL;

/** Search a frame's bottom-right corner for the sparkle. */
async function findStar(png: Buffer): Promise<StarMatch> {
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
  const gray = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++)
      gray[y * cw + x] = data[(y0 + y) * W * info.channels + (x0 + x) * info.channels];
  const b = bestStar(gray, cw, ch);
  return {
    score: b.score,
    rival: b.rival,
    cx: (x0 + b.x) / W,
    cy: (y0 + b.y) / H,
    w: (2 * b.r) / W,
  };
}

/** The `-vf` value that rebuilds `box` from the pixels around it. Pure. */
export const delogoFilter = (box: MarkBox): string =>
  `delogo=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}`;

/** One frame of the clip as a png, plus its size. */
async function firstFrame(
  dir: string,
  clip: string,
  name: string
): Promise<{ png: Buffer; width: number; height: number }> {
  const file = path.join(dir, name);
  await execFfmpeg(
    ["-hide_banner", "-loglevel", "error", "-y", "-i", clip, "-frames:v", "1", file],
    { maxBuffer: 1 << 26 }
  );
  const png = await readFile(file);
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height) throw new Error("frame has no size");
  return { png, width: meta.width, height: meta.height };
}

/** Ask whether a mark is stamped in the frame's bottom-right corner. Throws when it cannot ask. */
async function lookForMark(frame: {
  png: Buffer;
  width: number;
  height: number;
}): Promise<CornerMarkVerdict> {
  const w = Math.round(frame.width * CORNER_W);
  const h = Math.round(frame.height * CORNER_H);
  const corner = await sharp(frame.png)
    .extract({ left: frame.width - w, top: frame.height - h, width: w, height: h })
    .resize({ width: LOOK_WIDTH })
    .png()
    .toBuffer();
  const result = await invokeClaude({
    systemPrompt: CORNER_MARK_SYSTEM,
    userMessage: "Is a logo or watermark stamped over this corner?",
    imageInput: { base64: corner.toString("base64"), mediaType: "image/png" },
    maxTokens: 120,
    model: CORNER_MARK_MODEL,
    step: "Corner mark check",
  });
  return parseCornerMarkVerdict(result.text, result.stopReason);
}

/** Re-encode `src` with `box` rebuilt — the encode settings the steadier writes with. */
async function rebuildPatch(
  src: string,
  out: string,
  box: MarkBox
): Promise<void> {
  await execFfmpeg(
    ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf", delogoFilter(box),
      "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-movflags", "+faststart", out],
    { maxBuffer: 1 << 26 }
  );
}

/**
 * The clip with a stamped corner mark removed, or the SAME buffer when it has none (or the check
 * or the removal could not run). `label` names the clip in the log.
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
    const frame = await firstFrame(dir, src, "before.png");
    // The sparkle is found by its shape first: sure enough, and the vision check is not asked.
    const star = await findStar(frame.png);
    const sure = isSparkle(star);
    const seen: CornerMarkVerdict = sure
      ? { mark: true, what: "a sparkle mark" }
      : await lookForMark(frame);
    if (!seen.mark) return clip;
    // WHERE: the shape's own position whenever the shape is there at all — measured, where the
    // vision check's is an estimate off an enlarged corner.
    const byShape = star.score >= STAR_LIKELY;
    const boxFor = (widen: boolean) =>
      byShape
        ? boxAround(frame.width, frame.height, star, widen, STAR_PAD)
        : markBox(frame.width, frame.height, seen, widen);

    const out = path.join(dir, "out.mp4");
    await rebuildPatch(src, out, boxFor(false));
    let cleaned = out;
    // Looked at again: a patch cut beside the mark leaves it in the film with a smudge next to
    // it. A mark found by its shape is re-measured; one only the vision check saw is re-asked.
    const afterFrame = await firstFrame(dir, out, "after.png");
    const still = byShape
      ? isSparkle(await findStar(afterFrame.png))
      : await lookForMark(afterFrame).then(
          v => v.mark,
          () => false
        );
    if (still) {
      const wide = path.join(dir, "wide.mp4");
      await rebuildPatch(src, wide, boxFor(true));
      cleaned = wide;
    }
    console.log(
      `[CornerMark] ${label}: removed ${seen.what || "a corner mark"} ` +
        `(${byShape ? `found by shape, match ${star.score.toFixed(2)} against ${star.rival.toFixed(2)} for a blob` : "found by the vision check"}` +
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

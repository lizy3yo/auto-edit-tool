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
  const cropX = frameW * (1 - CORNER_W);
  const cropY = frameH * (1 - CORNER_H);
  const seen = verdict.cx != null && verdict.cy != null;
  const cx = seen
    ? cropX + (verdict.cx as number) * frameW * CORNER_W
    : USUAL_MARK.cx * frameW;
  const cy = seen
    ? cropY + (verdict.cy as number) * frameH * CORNER_H
    : USUAL_MARK.cy * frameH;
  const markW =
    seen && verdict.size != null
      ? verdict.size * frameW * CORNER_W
      : USUAL_MARK.w * frameW;
  const side = Math.min(
    BOX_MAX * frameW,
    Math.max(BOX_MIN * frameW, markW * BOX_PAD)
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
    const seen = await lookForMark(frame);
    if (!seen.mark) return clip;

    const out = path.join(dir, "out.mp4");
    const box = markBox(frame.width, frame.height, seen);
    await rebuildPatch(src, out, box);
    let cleaned = out;
    // Looked at again: the check's idea of where the mark sits is rough, and a patch cut beside
    // it leaves the mark in the film with a smudge next to it.
    const after = await lookForMark(await firstFrame(dir, out, "after.png")).catch(
      () => ({ mark: false, what: "" }) as CornerMarkVerdict
    );
    if (after.mark) {
      const wide = path.join(dir, "wide.mp4");
      await rebuildPatch(src, wide, markBox(frame.width, frame.height, seen, true));
      cleaned = wide;
    }
    console.log(
      `[CornerMark] ${label}: removed ${seen.what || "a corner mark"}` +
        (after.mark ? " (second, wider pass)" : "")
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

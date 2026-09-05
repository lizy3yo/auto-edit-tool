/**
 * server/lipsyncSeams.ts — the stitch lines in an InfiniteTalk render, found and smoothed.
 *
 * InfiniteTalk cannot paint a scene in one pass: it renders WINDOWS of `WINDOW_FRAMES` (81)
 * frames and carries `motionFrame` frames of each window into the next, so a new window begins
 * every `81 - motionFrame` frames after the first. The carried frames give the new window
 * motion to continue, but its first frame does not always start where the old one stopped —
 * measured on a delivered clip, the person went from closed mouth to a full open smile in ONE
 * frame at delivered frame 76, exactly the second handoff (81 + 44 = 125 raw, minus the 50-frame
 * run-up the app trims), with the frame-to-frame change there 2.7× the clip's typical. The
 * background never moves at these seams (the plate holds it), which is why the background-corner
 * seam check never saw them; only the person jumps.
 *
 * The seam positions are arithmetic — window size, overlap, trimmed lead — so they are known
 * exactly for any host and any scene length. Each is measured (ffmpeg's per-frame scene score,
 * a normalized frame difference) against its own neighbourhood, and where the jump is
 * `SEAM_JUMP_RATIO` times its neighbours the two frames either side are replaced with
 * motion-compensated interpolations between the frames just outside them: the expression
 * change spreads over ~200 ms instead of 40, which reads as a quick expression change rather
 * than a cut. A seam whose jump is ordinary is left alone — a mouth closing on a "b" at a
 * handoff is speech, not a seam.
 *
 * Fail-open: any failure returns the clip untouched.
 */
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { getFFmpegPath } from "./ffmpegPath";
import { runFfmpeg } from "./videoAssembly";

export const WINDOW_FRAMES = 81;
/** The worker's own default when the app sends no `motion_frame`. */
export const DEFAULT_MOTION_FRAME = 25;
/** A seam's jump must be this many times the median of its neighbours to be repaired… */
export const SEAM_JUMP_RATIO = 1.8;
/** …and at least this large in absolute terms, so a near-static clip cannot flag noise. */
export const SEAM_ABS_FLOOR = 0.004;
/** Frames replaced either side of the seam (the seam frame is the first of the new window). */
const REPAIR_HALF = 2;
const FPS = 25;

/**
 * Delivered-frame indices where a new render window begins, i.e. the first frame that came
 * from a different window than the frame before it. `leadSec` is the run-up trimmed off the
 * front. Seams too close to either edge to repair are dropped.
 */
export function predictSeamFrames(opts: {
  totalFrames: number;
  leadSec?: number;
  motionFrame?: number;
  fps?: number;
}): number[] {
  const fps = opts.fps ?? FPS;
  const step = WINDOW_FRAMES - (opts.motionFrame ?? DEFAULT_MOTION_FRAME);
  if (step <= 0) return [];
  const lead = Math.round((opts.leadSec ?? 0) * fps);
  const out: number[] = [];
  for (let raw = WINDOW_FRAMES; raw < opts.totalFrames + lead; raw += step) {
    const d = raw - lead;
    if (d - REPAIR_HALF - 1 >= 0 && d + REPAIR_HALF + 1 < opts.totalFrames)
      out.push(d);
  }
  return out;
}

/**
 * Per-frame change: ffmpeg's `scene` score (normalized sum of absolute differences against the
 * previous frame, 0-1). Index 0 is the first frame and is always 0.
 */
export async function frameJumps(videoPath: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(getFFmpegPath(), [
      "-hide_banner",
      "-loglevel",
      "info",
      "-i",
      videoPath,
      "-vf",
      "select='gte(scene,0)',metadata=print",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    let err = "";
    p.stderr.on("data", d => (err += d));
    p.on("error", reject);
    p.on("close", code => {
      if (code !== 0)
        return reject(new Error(`ffmpeg exited ${code}\n${err.slice(-600)}`));
      const vals = Array.from(
        err.matchAll(/lavfi\.scene_score=([0-9.]+)/g),
        m => Number(m[1])
      );
      if (!vals.length) return reject(new Error("no frames measured"));
      resolve(vals);
    });
  });
}

/** The predicted seams whose jump stands out from the frames around them. */
export function seamsNeedingRepair(
  jumps: number[],
  seams: number[]
): { frame: number; ratio: number }[] {
  const out: { frame: number; ratio: number }[] = [];
  for (const b of seams) {
    if (b <= 0 || b >= jumps.length) continue;
    const near: number[] = [];
    for (let i = b - 10; i <= b + 10; i++)
      if (i > 0 && i < jumps.length && Math.abs(i - b) > 1) near.push(jumps[i]);
    if (near.length < 4) continue;
    const sorted = [...near].sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)];
    const ratio = med > 0 ? jumps[b] / med : Infinity;
    if (jumps[b] >= SEAM_ABS_FLOOR && ratio >= SEAM_JUMP_RATIO)
      out.push({ frame: b, ratio });
  }
  return out;
}

/**
 * One filter graph that replaces frames [b-2, b+1] at every seam `b` with frames interpolated
 * between b-3 and b+2, and copies everything else. The two anchor frames are re-timed to 1/5 s
 * apart so `minterpolate` to 25 fps yields exactly the four in-between frames.
 */
export function seamRepairFilter(seams: number[], totalFrames: number): string {
  const sorted = [...seams].sort((a, b) => a - b);
  const parts: string[] = [];
  const outs: string[] = [];
  let cursor = 0;
  let n = 0;
  const segments: (["copy", number, number] | ["interp", number])[] = [];
  for (const b of sorted) {
    const from = b - REPAIR_HALF;
    if (from > cursor) segments.push(["copy", cursor, from]);
    segments.push(["interp", b]);
    cursor = b + REPAIR_HALF;
  }
  if (cursor < totalFrames) segments.push(["copy", cursor, totalFrames]);
  parts.push(
    `[0:v]split=${segments.length}${segments.map((_, i) => `[s${i}]`).join("")}`
  );
  for (const seg of segments) {
    const tag = `[o${n}]`;
    if (seg[0] === "copy")
      parts.push(
        `[s${n}]trim=start_frame=${seg[1]}:end_frame=${seg[2]},setpts=PTS-STARTPTS${tag}`
      );
    else {
      const b = seg[1];
      parts.push(
        // Three anchors, not two: minterpolate emits nothing for a two-frame input. The third
        // (b+3) sits after the span and only gives the filter something to look ahead to.
        `[s${n}]select='eq(n\\,${b - REPAIR_HALF - 1})+eq(n\\,${b + REPAIR_HALF})+eq(n\\,${b + REPAIR_HALF + 1})',` +
          `setpts=N/5/TB,` +
          `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none,` +
          `trim=start_frame=1:end_frame=${1 + 2 * REPAIR_HALF},setpts=PTS-STARTPTS${tag}`
      );
    }
    outs.push(tag);
    n++;
  }
  parts.push(
    `${outs.join("")}concat=n=${outs.length}:v=1:a=0,setpts=N/${FPS}/TB[out]`
  );
  return parts.join(";");
}

/**
 * Find and smooth the window seams of a delivered RunPod clip. Returns the clip (repaired or
 * untouched) and what was checked and repaired, for the log.
 */
export async function smoothWindowSeams(
  video: Buffer,
  opts: { leadSec?: number; motionFrame?: number; label?: string } = {}
): Promise<{ video: Buffer; checked: number[]; repaired: number[] }> {
  const dir = path.join(os.tmpdir(), `lipsync-seams-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const inPath = path.join(dir, "in.mp4");
    const outPath = path.join(dir, "out.mp4");
    writeFileSync(inPath, video);
    const jumps = await frameJumps(inPath);
    const seams = predictSeamFrames({
      totalFrames: jumps.length,
      leadSec: opts.leadSec,
      motionFrame: opts.motionFrame,
    });
    const bad = seamsNeedingRepair(jumps, seams);
    const label = opts.label ?? "clip";
    if (!bad.length) {
      console.log(
        `[LipsyncSeams] ${label}: ${seams.length} window handoff(s) at frame ${seams.join(", ") || "—"}, none stands out`
      );
      return { video, checked: seams, repaired: [] };
    }
    console.log(
      `[LipsyncSeams] ${label}: smoothing ${bad.length} of ${seams.length} window handoff(s) — ` +
        bad.map(s => `frame ${s.frame} (${s.ratio.toFixed(1)}x)`).join(", ")
    );
    await runFfmpeg([
      "-y",
      "-i",
      inPath,
      "-filter_complex",
      seamRepairFilter(
        bad.map(s => s.frame),
        jumps.length
      ),
      "-map",
      "[out]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outPath,
    ]);
    return {
      video: readFileSync(outPath),
      checked: seams,
      repaired: bad.map(s => s.frame),
    };
  } catch (err: any) {
    console.warn(
      `[LipsyncSeams] ${opts.label ?? "clip"}: seam pass failed (${err?.message ?? err}) — keeping the clip as rendered`
    );
    return { video, checked: [], repaired: [] };
  } finally {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}

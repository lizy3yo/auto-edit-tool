/**
 * server/cameraPlate.ts — the static clip behind pinned-camera lip-sync.
 *
 * InfiniteTalk's I2V mode inherits Wan's trained-in camera bias: with nothing said about the
 * camera it drifts slowly toward the speaker, and the background is re-hallucinated as it
 * goes (measured on real host clips — the chair widens, the lamp slides). Prompt language
 * only shifts the odds. The maintainer's actual fix is to condition on a VIDEO instead of a
 * photo: V2V mimics the input's camera, and a video in which nothing moves has no camera to
 * mimic. So this module turns the host photo into that video — the same frame, repeated —
 * uploads it to R2, and hands back the URL for the worker's V2V workflow.
 *
 * The operator's workflow is untouched: they upload a photo, this clip is synthesised per
 * render and never seen. Durations are rounded UP into buckets so the in-process cache can
 * reuse one encode across a job's host scenes (5 tabs share ~2 host photos; without the
 * bucket every 5.7s scene would re-encode the same picture at a slightly different length).
 * A plate longer than the narration is fine — the worker derives its frame count from the
 * audio and ignores the excess — so rounding up is free correctness.
 *
 * Failures throw; the lip-sync lane catches and falls back to the plain photo path, same
 * fail-open shape as `hostPlate.ts` — a worse render beats no render.
 */
import path from "path";
import os from "os";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { downloadToTemp, runFfmpeg } from "./videoAssembly";
import { storagePut } from "./storage";

/** Bucket size (and minimum length) for plate durations, seconds. */
const PLATE_BUCKET_SEC = 15;

/** Matches the worker's output rate; the exact value only affects file size, not sync. */
const PLATE_FPS = 25;

/**
 * One encode per (photo, length bucket) per process. Promise-valued so concurrent host
 * scenes sharing a photo wait on the same encode instead of racing five identical ones.
 * A rejected build is evicted so the next scene retries rather than inheriting the failure.
 */
const plateCache = new Map<string, Promise<string>>();

/**
 * Build (or reuse) a static video of `imageUrl` at least `durationSec` long and return its
 * R2 public URL.
 */
export async function buildCameraPlate(
  imageUrl: string,
  durationSec: number
): Promise<string> {
  const bucket =
    Math.max(
      1,
      Math.ceil((durationSec || PLATE_BUCKET_SEC) / PLATE_BUCKET_SEC)
    ) * PLATE_BUCKET_SEC;
  const key = `${imageUrl}|${bucket}`;
  let pending = plateCache.get(key);
  if (!pending) {
    pending = encodePlate(imageUrl, bucket).catch(err => {
      plateCache.delete(key);
      throw err;
    });
    plateCache.set(key, pending);
  }
  return pending;
}

async function encodePlate(imageUrl: string, seconds: number): Promise<string> {
  const workDir = path.join(os.tmpdir(), `camera-plate-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });
  try {
    const src = await downloadToTemp(imageUrl, workDir, "plate-src.img");
    const out = path.join(workDir, "plate.mp4");
    await runFfmpeg([
      "-loop",
      "1",
      "-i",
      src,
      "-t",
      String(seconds),
      "-r",
      String(PLATE_FPS),
      // Even dimensions for yuv420p; the worker center-crops to the render size itself,
      // so the plate keeps the photo's own aspect.
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v",
      "libx264",
      // A static frame compresses to almost nothing at any quality; veryfast keeps the
      // encode in the low seconds even for the longest bucket.
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-y",
      out,
    ]);
    const { url } = await storagePut(
      `lipsync/plates/${randomUUID()}.mp4`,
      readFileSync(out),
      "video/mp4"
    );
    console.log(
      `[CameraPlate] built ${seconds}s static plate for pinned-camera lip-sync → ${url}`
    );
    return url;
  } finally {
    if (existsSync(workDir)) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}

/** Test-only: reset the cache between cases. */
export function __resetCameraPlateCache(): void {
  plateCache.clear();
}

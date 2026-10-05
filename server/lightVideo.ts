/**
 * The LIGHT copy of a finished film — 480p at about a sixth of the size — so the player on
 * the page works on a weak connection. Full screen and Download still use the film itself;
 * this copy is never what is published.
 *
 * It lives in the bucket at a key that is a hash of the film's own URL, so nothing is written
 * to the job row: whether a film has one is answered by looking, a Reassemble (a new final
 * URL) simply has a new key, and films made before this get theirs the first time they are
 * opened. Made after the film is finished, one at a time on two threads, so it never delays a
 * film or crowds an assembly. `LIGHT_VIDEO=0` turns it off (the player then plays the film).
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isTrustedUrl } from "./download";
import { execFfmpeg } from "./ffmpegSpawn";
import {
  IMMUTABLE_CACHE,
  presignOwnBucketUrl,
  storageExists,
  storagePublicUrl,
  storagePut,
} from "./storage";

export type LightVideo = {
  /** The light copy, once there is one. */
  url: string | null;
  /** True while it is being made (or waiting its turn) — ask again shortly. */
  pending: boolean;
};

const NONE: LightVideo = { url: null, pending: false };

export const lightVideoEnabled = () => process.env.LIGHT_VIDEO !== "0";

export function lightVideoKey(filmUrl: string): string {
  const id = createHash("sha1").update(filmUrl).digest("hex");
  return `previews/${id.slice(0, 2)}/${id}-480p.mp4`;
}

/** Only a finished film gets one: an mp4 in our own bucket. Pure — `trusted` is passed in. */
export function wantsLightVideo(
  filmUrl: string,
  trusted: (url: string) => boolean
): boolean {
  if (!trusted(filmUrl)) return false;
  try {
    return /\/final-[\w-]+\.mp4$/i.test(new URL(filmUrl).pathname);
  } catch {
    return false;
  }
}

/**
 * ffmpeg args for the light copy. 480p, capped near 600 kbps so it plays on a ~1 Mbps link,
 * a keyframe every two seconds so a seek lands quickly, `+faststart` so it starts before it
 * has finished downloading. Pure.
 */
export function lightVideoArgs(input: string, output: string): string[] {
  return [
    "-v",
    "error",
    "-y",
    "-i",
    input,
    "-vf",
    "scale=-2:480",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "30",
    "-maxrate",
    "600k",
    "-bufsize",
    "1200k",
    "-g",
    "60",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-ac",
    "2",
    "-threads",
    "2",
    "-movflags",
    "+faststart",
    output,
  ];
}

const MAKE_TIMEOUT_MS = 45 * 60_000;
/** Films waiting for a light copy. Past this a request is answered "none" rather than queued. */
const QUEUE_MAX = 20;
const FAILED_TTL_MS = 10 * 60_000;

const ready = new Map<string, string>();
const failedAt = new Map<string, number>();
const pending = new Set<string>();
let chain: Promise<void> = Promise.resolve();

async function build(filmUrl: string): Promise<void> {
  const key = lightVideoKey(filmUrl);
  const out = path.join(os.tmpdir(), `light-${path.basename(key)}`);
  const started = Date.now();
  try {
    // ffmpeg reads the film over HTTP itself, through the S3 endpoint (see storage.ts).
    await execFfmpeg(lightVideoArgs(await presignOwnBucketUrl(filmUrl), out), {
      timeout: MAKE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    const bytes = await fs.readFile(out);
    const { url } = await storagePut(key, bytes, "video/mp4", IMMUTABLE_CACHE);
    ready.set(filmUrl, url);
    console.log(
      `[light video] ${path.basename(key)} made in ${Math.round((Date.now() - started) / 1000)}s, ${(bytes.length / 1e6).toFixed(1)} MB`
    );
  } catch (err: any) {
    failedAt.set(filmUrl, Date.now());
    console.warn(
      `[light video] could not make one for ${filmUrl}: ${err?.message ?? err}`
    );
  } finally {
    pending.delete(filmUrl);
    await fs.rm(out, { force: true }).catch(() => {});
  }
}

/**
 * The light copy of a film, started if there is none. Never throws: with no copy (not made
 * yet, turned off, storage unreachable) the answer is "none" and the player plays the film.
 */
export async function lightVideoFor(filmUrl: string): Promise<LightVideo> {
  if (!lightVideoEnabled() || !wantsLightVideo(filmUrl, isTrustedUrl))
    return NONE;
  const known = ready.get(filmUrl);
  if (known) return { url: known, pending: false };
  if (pending.has(filmUrl)) return { url: null, pending: true };
  const failed = failedAt.get(filmUrl);
  if (failed && Date.now() - failed < FAILED_TTL_MS) return NONE;
  try {
    const key = lightVideoKey(filmUrl);
    const url = storagePublicUrl(key);
    if (!url) return NONE;
    if (await storageExists(key)) {
      ready.set(filmUrl, url);
      return { url, pending: false };
    }
  } catch {
    return NONE;
  }
  // Checked again: two requests can both get here across the `await` above.
  if (pending.has(filmUrl)) return { url: null, pending: true };
  if (pending.size >= QUEUE_MAX) return NONE;
  pending.add(filmUrl);
  chain = chain.then(() => build(filmUrl));
  return { url: null, pending: true };
}

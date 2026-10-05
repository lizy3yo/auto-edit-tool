/**
 * Small pictures for the page — `/api/thumb?url=<stored file>&w=<width>&t=<second>`.
 *
 * Every thumbnail used to be made in the BROWSER by opening the real file: a storyboard tile
 * fetched the scene's 1080p clip to show one frame of it, a host-photo tile the full photo.
 * That is most of what a page of thumbnails costs on a weak connection. Here the server makes
 * a small WebP once, keeps it in the bucket under a key that is a hash of what it was made
 * from, and the browser keeps it for good.
 *
 * It works for every file already stored (nothing in the pipeline changes, and no film has to
 * be re-rendered), and any failure is a 404 the page answers by loading the picture the way it
 * did before — so this can only make a page lighter, never emptier.
 */

import { createHash } from "node:crypto";
import { freemem } from "node:os";
import { Router } from "express";
import sharp from "sharp";
import { sdk } from "./_core/sdk";
import { isTrustedUrl } from "./download";
import { execFfmpeg, FFMPEG_MIN_FREE_MB } from "./ffmpegSpawn";
import {
  IMMUTABLE_CACHE,
  presignOwnBucketUrl,
  storagePut,
  storageRead,
} from "./storage";

/** The only widths served, so a page cannot ask for 10,000 variants of one file. */
export const THUMB_WIDTHS = [160, 320, 640] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

export type ThumbRequest = { url: string; w: ThumbWidth; t: number };

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;

/** What a request asks for, or why it is refused. Pure — `trusted` is passed in. */
export function parseThumbRequest(
  query: Record<string, unknown>,
  trusted: (url: string) => boolean
): ThumbRequest | { error: string; status: number } {
  const url = typeof query.url === "string" ? query.url : "";
  if (!url) return { error: "Missing url", status: 400 };
  if (!trusted(url)) return { error: "Not a stored file", status: 403 };
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return { error: "Bad url", status: 400 };
  }
  if (AUDIO_EXT.test(path)) return { error: "Not a picture", status: 400 };
  const asked = Number(query.w);
  // The nearest served width at or above what was asked, so a tile never upscales.
  const w: ThumbWidth =
    Number.isFinite(asked) && asked > 0
      ? (THUMB_WIDTHS.find(x => x >= asked) ?? 640)
      : 320;
  const rawT = Number(query.t);
  // Tenths of a second, 0–1 h: a trim dragged by a frame is the same thumbnail.
  const t =
    Number.isFinite(rawT) && rawT > 0
      ? Math.min(3600, Math.round(rawT * 10) / 10)
      : 0;
  return { url, w, t };
}

export const isVideoUrl = (url: string) => {
  try {
    return VIDEO_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

/** Where a thumbnail lives in the bucket — a hash of exactly what it was made from. */
export function thumbKey({ url, w, t }: ThumbRequest): string {
  const id = createHash("sha1").update(`${url}|${w}|${t}`).digest("hex");
  return `thumbs/${id.slice(0, 2)}/${id}.webp`;
}

const SOURCE_MAX_BYTES = 40 * 1024 * 1024;
const MAKE_TIMEOUT_MS = 30_000;

/**
 * The machine is too busy to make a thumbnail right now. Every ffmpeg start WAITS for free
 * memory, up to three minutes — right for a film, wrong for a tile: on a machine with under
 * 1 GB free every tile sat on its spinner for minutes behind that wait. A thumbnail is a
 * convenience, so it steps aside at once and the page loads the picture the old way.
 */
export class ThumbBusyError extends Error {}

/** Longest a tile waits for its picture before the page is told to load it the old way. */
export const THUMB_DEADLINE_MS = 5_000;

async function frameOf(url: string, t: number, w: number): Promise<Buffer> {
  if (freemem() / 1048576 < FFMPEG_MIN_FREE_MB)
    throw new ThumbBusyError("not enough free memory to start ffmpeg");
  // ffmpeg reads the clip over HTTP itself and stops after one frame: the files are
  // `+faststart`, so that is the header and the first few hundred KB, not the clip.
  const { stdout } = await execFfmpeg(
    [
      "-v",
      "error",
      "-ss",
      String(t),
      "-i",
      url,
      "-frames:v",
      "1",
      "-vf",
      `scale=${w}:-2`,
      "-f",
      "image2pipe",
      "-c:v",
      "png",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
      timeout: MAKE_TIMEOUT_MS,
    }
  );
  return stdout as Buffer;
}

async function pictureOf(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(MAKE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`source answered ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > SOURCE_MAX_BYTES) throw new Error("source too large");
  return bytes;
}

async function makeThumb(req: ThumbRequest): Promise<Buffer> {
  // Our own objects are read through the S3 endpoint, never `*.r2.dev` (see storage.ts).
  const source = await presignOwnBucketUrl(req.url);
  const raw = isVideoUrl(req.url)
    ? await frameOf(source, req.t, req.w)
    : await pictureOf(source);
  return sharp(raw)
    .rotate() // honour the camera's orientation tag before it is stripped
    .resize({ width: req.w, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
}

/** Thumbnails being made at once. Each is one short ffmpeg or one sharp resize. */
const MAKE_CONCURRENCY = 2;
let making = 0;
const makeQueue: (() => void)[] = [];
async function withMakeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (making >= MAKE_CONCURRENCY)
    await new Promise<void>(r => makeQueue.push(r));
  making++;
  try {
    return await fn();
  } finally {
    making--;
    makeQueue.shift()?.();
  }
}

/** One build per key, however many tiles ask for it together. */
const inFlight = new Map<string, Promise<Buffer>>();
/** A source that failed is not tried again for a while — a missing clip must not loop ffmpeg. */
const FAILED_TTL_MS = 60_000;
const failedAt = new Map<string, number>();

export async function getThumb(req: ThumbRequest): Promise<Buffer> {
  const key = thumbKey(req);
  const failed = failedAt.get(key);
  if (failed && Date.now() - failed < FAILED_TTL_MS)
    throw new Error("recently failed");
  const running = inFlight.get(key);
  if (running) return running;
  const build = (async () => {
    // A storage read that fails (no credentials, a blip) is not a reason to refuse: make it.
    const stored = await storageRead(key).catch(() => null);
    if (stored) return stored;
    const made = await withMakeSlot(() => makeThumb(req));
    // Keeping it is best-effort — the bytes are served either way.
    void storagePut(key, made, "image/webp", IMMUTABLE_CACHE).catch(() => {});
    return made;
  })();
  inFlight.set(key, build);
  try {
    return await build;
  } catch (err) {
    // Busy is about the machine, not this picture: the next request tries again.
    if (!(err instanceof ThumbBusyError)) {
      if (failedAt.size > 2000) failedAt.clear();
      failedAt.set(key, Date.now());
    }
    throw err;
  } finally {
    inFlight.delete(key);
  }
}

export const thumbRouter = Router();

thumbRouter.get("/", async (req, res) => {
  try {
    await sdk.authenticateRequest(req);
  } catch {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  const parsed = parseThumbRequest(req.query, isTrustedUrl);
  if ("error" in parsed) {
    res.status(parsed.status).json({ error: parsed.error });
    return;
  }
  try {
    // Past the deadline the tile is answered "none" — the build itself carries on and is
    // kept, so the next look at this picture is instant.
    const build = getThumb(parsed);
    build.catch(() => {});
    const bytes = await Promise.race([
      build,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("deadline")), THUMB_DEADLINE_MS)
      ),
    ]);
    res.setHeader("Content-Type", "image/webp");
    // `private`: it is behind the sign-in. The URL names exactly what it shows, so for good.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(bytes);
  } catch {
    // The page falls back to loading the picture itself; never cache a miss.
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "No thumbnail" });
  }
});

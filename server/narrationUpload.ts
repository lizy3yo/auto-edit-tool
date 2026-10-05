/**
 * Operator-supplied master narration — the ingest half of the manual-VO hatch.
 *
 * WHY THIS EXISTS: `resolveTTSProvider` has exactly one lane (69Labs). When that vendor is
 * unreachable there is no voiceover, and with no voiceover there is no film — even though every
 * OTHER lane (APIMART b-roll, gpt-image-2 stills, HeyGen/RunPod host, assembly) is completely
 * independent of it. This route lets an operator supply the one artifact the dead vendor owed us
 * and render the rest normally.
 *
 * Deliberately a RAW streaming route rather than the base64 data-URL mutation the image uploads
 * use (`styleReference.upload`): a 20-minute narration is ~29 MB, which is ~39 MB once base64'd,
 * against a 50 MB JSON body cap. It fits today and has no headroom for a longer film — and the
 * bytes would pass through the JSON parser for no reason.
 *
 * The upload only produces a NORMALIZED, stored track. Whether that track is actually a read of
 * this job's script is decided separately (`longformVideo.verifyNarration`), because the script
 * itself is large and already travels over tRPC.
 */

import { Router, type Request, type Response } from "express";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { PART_BYTES, isUploadId, partCount } from "../shared/uploadParts";
import { sdk } from "./_core/sdk";
import { storagePut } from "./storage";
import {
  normalizeNarrationAudio,
  probeAudioDurationSec,
} from "./narrationIngest";

/**
 * Hard ceiling on an accepted upload. A 60-minute WAV at 48k/16-bit stereo is ~660 MB, so an
 * operator who exports the wrong format should be told, not silently allowed to fill a disk.
 * Comfortably above any mp3 of a feature-length narration.
 */
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024;

/** Container types ffmpeg will be asked to normalize. Anything else is a mistake, not a format. */
const ACCEPTED = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
  "audio/ogg",
  "audio/opus",
  "audio/webm",
]);

/** Collect the raw request body, refusing anything over the cap WITHOUT buffering the rest. */
async function readBody(req: Request, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    // Stop at the cap rather than reading to the end and checking after: the point of the
    // limit is to bound memory, which a post-hoc check does not do.
    if (total > max) throw new Error("TOO_LARGE");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** The content type an upload names, lower-cased and without its parameters. */
const contentTypeOf = (raw: unknown) =>
  (raw ?? "").toString().split(";")[0].trim().toLowerCase();

const unsupported = (contentType: string) =>
  `Unsupported audio type "${contentType || "unknown"}". Upload MP3, WAV, M4A, ` +
  `FLAC, OGG or Opus.`;

/**
 * Normalize an uploaded narration, store it, and answer `{ url, durationSec }` — the tail the
 * single request and the upload in pieces share. Returns what it stored, or null once it has
 * answered with an error.
 */
async function storeNarration(
  raw: Buffer,
  res: Response
): Promise<{ url: string; durationSec: number } | null> {
  try {
    // Normalize FIRST, store the result: what lands in R2 is what the pipeline will read, in
    // the same shape a voiced master arrives in. Storing the raw upload as well would leave two
    // plausible masters in the bucket and no way to tell which one a job used.
    const mp3 = await normalizeNarrationAudio(raw);
    const durationSec = await probeAudioDurationSec(mp3);
    if (!(durationSec > 0)) {
      res.status(400).json({
        error:
          "That file has no readable audio track. Re-export it and try again.",
      });
      return null;
    }
    const key = `longform/manual-narration/${nanoid(12)}.mp3`;
    const { url } = await storagePut(key, mp3, "audio/mpeg");
    console.log(
      `[Narration] stored operator upload ${key} — ${durationSec.toFixed(1)}s, ` +
        `${(mp3.length / 1024 / 1024).toFixed(1)} MB (from ${(raw.length / 1024 / 1024).toFixed(1)} MB)`
    );
    res.json({ url, durationSec });
    return { url, durationSec };
  } catch (e: any) {
    console.error("[Narration] upload failed:", e);
    res
      .status(500)
      .json({ error: `Could not process the audio: ${e?.message ?? e}` });
    return null;
  }
}

export const narrationUploadRouter = Router();

narrationUploadRouter.post("/", async (req, res) => {
  try {
    await sdk.authenticateRequest(req);
  } catch {
    res.status(401).json({ error: "Not signed in" });
    return;
  }

  const contentType = contentTypeOf(req.headers["content-type"]);
  if (!ACCEPTED.has(contentType)) {
    res.status(400).json({ error: unsupported(contentType) });
    return;
  }

  let raw: Buffer;
  try {
    raw = await readBody(req, MAX_UPLOAD_BYTES);
  } catch (e: any) {
    if (e?.message === "TOO_LARGE") {
      res.status(413).json({
        error: `Audio must be under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. Export as MP3 rather than WAV.`,
      });
      return;
    }
    res.status(400).json({ error: `Upload failed: ${e?.message ?? e}` });
    return;
  }
  if (raw.length === 0) {
    res.status(400).json({ error: "Empty upload" });
    return;
  }

  await storeNarration(raw, res);
});

// ── The upload in pieces (`shared/uploadParts.ts`) ─────────────────────────────────────────
// Pieces are written to disk under the system temp folder, one folder per upload and per
// account, and joined when the browser says it has sent them all. What is stored at the end is
// exactly what the single request above stores.

const PARTS_ROOT = path.join(os.tmpdir(), "longform-narration-parts");
/** An upload nobody finished is cleared after this — a day covers "I will retry tonight". */
const PARTS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PARTS = partCount(MAX_UPLOAD_BYTES);

async function heldParts(dir: string) {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const held: { index: number; bytes: number }[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue; // a `.tmp` still being written is not a piece yet
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (stat) held.push({ index: Number(name), bytes: stat.size });
  }
  return held.sort((a, b) => a.index - b.index);
}

async function clearStaleParts() {
  const dirs = await fs.readdir(PARTS_ROOT).catch(() => [] as string[]);
  for (const name of dirs) {
    const dir = path.join(PARTS_ROOT, name);
    const stat = await fs.stat(dir).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > PARTS_TTL_MS)
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A finished upload's answer, kept briefly: on a weak connection the browser may never hear
 * the first reply and ask again, and the pieces are gone by then.
 */
const finished = new Map<
  string,
  { url: string; durationSec: number; at: number }
>();
const FINISHED_TTL_MS = 30 * 60_000;

/** Signed in, and a well-formed upload id — or the refusal has been sent and this is null. */
async function partsRequest(req: Request, res: Response) {
  let userId: number;
  try {
    userId = (await sdk.authenticateRequest(req)).id;
  } catch {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  const id = req.params.id;
  if (!isUploadId(id)) {
    res.status(400).json({ error: "Bad upload id" });
    return null;
  }
  // Per account: one person's upload id is never another's folder.
  const key = `${userId}-${id}`;
  return { key, dir: path.join(PARTS_ROOT, key) };
}

/** Which pieces of this upload the server already holds — what a resumed upload asks first. */
narrationUploadRouter.get("/:id", async (req, res) => {
  const up = await partsRequest(req, res);
  if (!up) return;
  res.json({ held: await heldParts(up.dir) });
});

/** One piece. Sending the same piece again replaces it, so a retry is always safe. */
narrationUploadRouter.put("/:id/part/:index", async (req, res) => {
  const up = await partsRequest(req, res);
  if (!up) return;
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTS) {
    res.status(400).json({ error: "Bad piece number" });
    return;
  }
  try {
    const bytes = await readBody(req, PART_BYTES);
    await fs.mkdir(up.dir, { recursive: true });
    // Written whole and then renamed, so a connection cut mid-piece never leaves a short
    // file under the piece's own name.
    const tmp = path.join(up.dir, `${index}.${nanoid(6)}.tmp`);
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, path.join(up.dir, String(index)));
    res.json({ index, bytes: bytes.length });
  } catch (e: any) {
    res
      .status(e?.message === "TOO_LARGE" ? 413 : 400)
      .json({ error: `Piece ${index} failed: ${e?.message ?? e}` });
  }
});

/** Every piece is up: join them and store the narration, exactly as the single request does. */
narrationUploadRouter.post("/:id/complete", async (req, res) => {
  const up = await partsRequest(req, res);
  if (!up) return;
  const done = finished.get(up.key);
  if (done && Date.now() - done.at < FINISHED_TTL_MS) {
    res.json({ url: done.url, durationSec: done.durationSec });
    return;
  }
  const contentType = contentTypeOf(req.body?.contentType);
  if (!ACCEPTED.has(contentType)) {
    res.status(400).json({ error: unsupported(contentType) });
    return;
  }
  const total = Number(req.body?.parts);
  const held = await heldParts(up.dir);
  if (
    !Number.isInteger(total) ||
    total < 1 ||
    total > MAX_PARTS ||
    held.length !== total ||
    held.some((h, i) => h.index !== i)
  ) {
    // 409, with what IS held: the browser sends what is missing and asks again.
    res.status(409).json({ error: "Some pieces are missing", held });
    return;
  }
  const raw = Buffer.concat(
    await Promise.all(
      held.map(h => fs.readFile(path.join(up.dir, String(h.index))))
    )
  );
  if (raw.length === 0) {
    res.status(400).json({ error: "Empty upload" });
    return;
  }
  const stored = await storeNarration(raw, res);
  if (stored) {
    finished.set(up.key, { ...stored, at: Date.now() });
    finished.forEach((v, k) => {
      if (Date.now() - v.at > FINISHED_TTL_MS) finished.delete(k);
    });
    await fs.rm(up.dir, { recursive: true, force: true }).catch(() => {});
  }
  void clearStaleParts();
});

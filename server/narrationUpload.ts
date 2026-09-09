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

import { Router, type Request } from "express";
import { nanoid } from "nanoid";
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

export const narrationUploadRouter = Router();

narrationUploadRouter.post("/", async (req, res) => {
  try {
    await sdk.authenticateRequest(req);
  } catch {
    res.status(401).json({ error: "Not signed in" });
    return;
  }

  const contentType = (req.headers["content-type"] ?? "")
    .toString()
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ACCEPTED.has(contentType)) {
    res.status(400).json({
      error:
        `Unsupported audio type "${contentType || "unknown"}". Upload MP3, WAV, M4A, ` +
        `FLAC, OGG or Opus.`,
    });
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
      return;
    }
    const key = `longform/manual-narration/${nanoid(12)}.mp3`;
    const { url } = await storagePut(key, mp3, "audio/mpeg");
    console.log(
      `[Narration] stored operator upload ${key} — ${durationSec.toFixed(1)}s, ` +
        `${(mp3.length / 1024 / 1024).toFixed(1)} MB (from ${(raw.length / 1024 / 1024).toFixed(1)} MB)`
    );
    res.json({ url, durationSec });
  } catch (e: any) {
    console.error("[Narration] upload failed:", e);
    res
      .status(500)
      .json({ error: `Could not process the audio: ${e?.message ?? e}` });
  }
});

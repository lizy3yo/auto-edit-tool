/**
 * Unified TTS routing layer — 69Labs is the only TTS lane in this app.
 * It uses ElevenLabs voice IDs and model IDs.
 *
 * 69Labs TTS: POST /api/v1/tts/generate → poll /api/v1/tts/status/:id → download /api/v1/tts/download/:id
 */

import {
  createTTSTask69Labs,
  pollTTSTask69Labs,
  downloadTTSAudio69Labs,
} from "./tts69labs";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, readFile, unlink } from "fs/promises";
import { getFFmpegPath } from "./ffmpegPath";

/** Thrown when the TTS provider reports exhausted credits. */
export class TTSCreditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TTSCreditError";
  }
}

/**
 * Parse a per-channel volume multiplier (stored as a decimal string like "1.30").
 * Returns undefined for null/"NULL"/invalid/out-of-range/neutral (≈1.0) so the
 * caller skips the ffmpeg pass entirely — neutral channels stay byte-identical.
 * Range mirrors the 69labs volume band (0.5–2).
 */
export function parseVolumeMultiplier(
  raw: string | null | undefined
): number | undefined {
  if (raw == null || raw === "NULL") return undefined;
  const v = parseFloat(raw);
  if (!isFinite(v) || v < 0.5 || v > 2) return undefined;
  if (Math.abs(v - 1) < 0.001) return undefined; // neutral → no-op
  return v;
}

/**
 * Run one ffmpeg audio filter over an mp3 buffer and return the re-encoded result.
 */
async function runMp3Filter(
  audioBuffer: Buffer,
  filter: string,
  label: string
): Promise<Buffer<ArrayBuffer>> {
  const base = join(tmpdir(), `ttsfilt-${nanoid(8)}`);
  const inPath = `${base}-in.mp3`;
  const outPath = `${base}-out.mp3`;
  try {
    await writeFile(inPath, audioBuffer);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(getFFmpegPath(), [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inPath,
        "-af",
        filter,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        outPath,
      ]);
      let stderr = "";
      proc.stderr.on("data", d => {
        stderr += d.toString();
      });
      proc.on("close", code =>
        code !== 0
          ? reject(
              new Error(
                `FFmpeg ${label} failed (exit ${code}): ${stderr.trim()}`
              )
            )
          : resolve()
      );
      proc.on("error", err =>
        reject(new Error(`FFmpeg process error: ${err.message}`))
      );
    });
    return Buffer.from(await readFile(outPath));
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

/**
 * Apply an ffmpeg volume gain to an mp3 buffer. Provider-independent, so it works
 * for every voice (elevenlabs, minimax, clones) unlike the 69labs volume param.
 */
async function applyVolumeGain(
  audioBuffer: Buffer,
  volume: number
): Promise<Buffer<ArrayBuffer>> {
  return runMp3Filter(audioBuffer, `volume=${volume}`, "volume gain");
}

/** Cap an interior pause at this length. */
export const PAUSE_CAP_SEC = 0.45;
/** Only pauses quieter than this count — every channel's room tone sits above it. */
export const PAUSE_FLOOR_DB = -60;

/**
 * Cap over-long dead-air pauses inside a narration mp3.
 *
 * The Wes Kingfisher clone was trained on noise-gated audio: its pauses collapse to ~-85 dBFS
 * with no room tone at all (every other channel's pauses sit at -52..-58 dBFS), so a 0.7s beat
 * reads as the audio dropping out rather than as a breath — which is exactly what was reported
 * on job 153. Keying the threshold on the *absence* of a floor makes this self-targeting: at
 * -60 dB it strips 35-55s of dead air from the Wes masters and is a byte-for-byte no-op on
 * donna/garry/roy/travis.
 *
 * `stop_duration` alone keeps the first PAUSE_CAP_SEC of each gap and drops the remainder.
 * Do NOT add `stop_silence` — it makes silenceremove a near no-op on ffmpeg 6.1. This only
 * touches interior silence, never the head or tail, so it is not the -40dB edge trim that
 * videoAssembly bans for chopping soft trailing consonants.
 */
export const PAUSE_CAP_FILTER =
  `silenceremove=stop_periods=-1:stop_duration=${PAUSE_CAP_SEC}` +
  `:stop_threshold=${PAUSE_FLOOR_DB}dB`;

/** A gap must beat the cap by this much to be worth a re-encode. */
const PAUSE_CAP_MARGIN_SEC = 0.1;

/** Longest dead-air run in an mp3, in seconds (0 if none reach PAUSE_CAP_SEC). */
async function longestDeadAir(audioBuffer: Buffer): Promise<number> {
  const inPath = join(tmpdir(), `ttssil-${nanoid(8)}.mp3`);
  try {
    await writeFile(inPath, audioBuffer);
    const stderr = await new Promise<string>((resolve, reject) => {
      const proc = spawn(getFFmpegPath(), [
        "-hide_banner",
        "-nostats",
        "-i",
        inPath,
        "-af",
        `silencedetect=noise=${PAUSE_FLOOR_DB}dB:d=${PAUSE_CAP_SEC}`,
        "-f",
        "null",
        "-",
      ]);
      let out = "";
      proc.stderr.on("data", d => {
        out += d.toString();
      });
      proc.on("close", code =>
        code !== 0
          ? reject(new Error(`FFmpeg silencedetect failed (exit ${code})`))
          : resolve(out)
      );
      proc.on("error", err =>
        reject(new Error(`FFmpeg process error: ${err.message}`))
      );
    });
    const durs = (stderr.match(/silence_duration: [\d.]+/g) ?? []).map(m =>
      parseFloat(m.slice("silence_duration: ".length))
    );
    return durs.length ? Math.max(...durs) : 0;
  } finally {
    await unlink(inPath).catch(() => {});
  }
}

export async function capDeadAirPauses(
  audioBuffer: Buffer
): Promise<Buffer<ArrayBuffer>> {
  // Channels with real room tone have nothing over the cap — skip the re-encode so their
  // master stays byte-identical to what the provider rendered, same as the neutral-volume skip.
  const longest = await longestDeadAir(audioBuffer);
  if (longest < PAUSE_CAP_SEC + PAUSE_CAP_MARGIN_SEC) {
    return Buffer.from(audioBuffer);
  }
  return runMp3Filter(audioBuffer, PAUSE_CAP_FILTER, "pause cap");
}

export interface UnifiedTTSParams {
  text: string;
  voiceId: string;
  modelId?: string;
  voiceProvider?: "elevenlabs" | "edgetts" | "minimax";
  speed?: number;
  stability?: number;
  similarity?: number;
  style?: number;
  minimaxSettings?: {
    speed?: number;
    pitch?: number;
    volume?: number;
    languageBoost?: string;
  };
}

export interface UnifiedTTSResult {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed" | "censored";
  audioUrl?: string;
  subtitleUrl?: string;
  error?: string;
}

/**
 * Create a TTS task using the appropriate provider.
 */
export async function createUnifiedTTSTask(
  providerType: string,
  apiKey: string,
  params: UnifiedTTSParams
): Promise<string> {
  if (providerType === "sixtynine_labs") {
    return createTTSTask69Labs(apiKey, params);
  }
  throw new Error(`Unsupported TTS provider: ${providerType}`);
}

/**
 * Poll a TTS task using the appropriate provider.
 * For 69Labs, when completed, downloads the audio and uploads to S3
 * so the URL is publicly accessible (69Labs download requires auth headers).
 */
export async function pollUnifiedTTSTask(
  providerType: string,
  apiKey: string,
  taskId: string,
  /** Optional per-channel volume multiplier applied as an ffmpeg gain. */
  volume?: number
): Promise<UnifiedTTSResult> {
  if (providerType === "sixtynine_labs") {
    const result = await pollTTSTask69Labs(apiKey, taskId);

    if (result.status === "completed") {
      // 69Labs download requires auth — download and re-upload to S3
      try {
        const audioResp = await fetch(
          `https://69labs.vip/api/v1/tts/download/${taskId}`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            redirect: "follow",
          }
        );

        if (!audioResp.ok) {
          return {
            taskId,
            status: "failed",
            error: `Failed to download TTS audio from 69Labs (${audioResp.status})`,
          };
        }

        let audioBuffer = Buffer.from(await audioResp.arrayBuffer());
        if (volume !== undefined) {
          audioBuffer = await applyVolumeGain(audioBuffer, volume);
        }
        const fileKey = `voiceovers/${taskId}-${nanoid(6)}.mp3`;
        const { url } = await storagePut(fileKey, audioBuffer, "audio/mpeg");

        console.log(`[69Labs TTS] Downloaded and uploaded to S3: ${url}`);

        return {
          taskId,
          status: "completed",
          audioUrl: url,
        };
      } catch (dlErr: any) {
        console.error(`[69Labs TTS] Download/upload error:`, dlErr);
        return {
          taskId,
          status: "failed",
          error: `Audio download failed: ${dlErr.message}`,
        };
      }
    }

    return result;
  }

  throw new Error(`Unsupported TTS provider: ${providerType}`);
}

/**
 * 69Labs Text-to-Speech integration.
 * Uses the /api/v1/tts/* endpoints — same ElevenLabs voice IDs as GenAIPro.
 * Mirrors the GenAIPro tts.ts interface (createTTSTask, pollTTSTask, listVoices).
 */

import { recordUsage } from "./costMeter";

const BASE_URL = "https://69labs.vip/api/v1";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Thrown when 69Labs rejects the voice ID outright (400 "This voice ID was not found").
 * Deterministic config error — retrying, chunking, or falling back cannot fix it, so callers
 * must NOT retry (a cloned voice only resolves if it exists in the 69Labs account's own voice
 * library or is a public ElevenLabs voice; a private clone on another account never will).
 */
export class VoiceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceNotFoundError";
  }
}

// ─── Per-key rate limiter for TTS submits (Token Bucket + adaptive 429 backpressure) ───
// The video lane already has a submit bucket (SIXTYNINE_VIDEO_SUBMIT_RATE), but /tts/generate had
// none — the master narration is ONE call so the main pipeline never noticed, but retry-failed-
// scenes fans ~23 scene workers out and each with missing audio submits TTS immediately, and
// 69Labs answers the storm with 429 TOO_MANY_REQUESTS. The numeric ceiling is undisclosed, so
// pace to a conservative default and let a real 429 self-correct via a shared per-key cooldown.
const TTS_SUBMIT_RATE = Number(process.env.SIXTYNINE_TTS_SUBMIT_RATE ?? 20); // per minute
const TTS_SUBMIT_BURST = Number(process.env.SIXTYNINE_TTS_SUBMIT_BURST ?? 3);
const TTS_REFILL_RATE = TTS_SUBMIT_RATE / 60; // tokens/sec
type TTSBucket = { tokens: number; lastRefill: number; cooldownUntil: number };
const _ttsBuckets = new Map<string, TTSBucket>();
const ttsBucketFor = (key: string): TTSBucket => {
  let b = _ttsBuckets.get(key);
  if (!b) {
    b = { tokens: TTS_SUBMIT_BURST, lastRefill: Date.now(), cooldownUntil: 0 };
    _ttsBuckets.set(key, b);
  }
  return b;
};

/** Block until this key's bucket has a token, waiting out any active 429 cooldown first. */
async function acquireTTSToken(key: string): Promise<void> {
  const b = ttsBucketFor(key);
  while (true) {
    const now = Date.now();
    if (now < b.cooldownUntil) {
      await sleep(Math.max(b.cooldownUntil - now, 100));
      continue; // re-check cooldown + refill after waiting out the 429 window
    }
    const elapsed = (now - b.lastRefill) / 1000;
    b.tokens = Math.min(TTS_SUBMIT_BURST, b.tokens + elapsed * TTS_REFILL_RATE);
    b.lastRefill = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil(((1 - b.tokens) / TTS_REFILL_RATE) * 1000);
    await sleep(Math.max(waitMs, 100));
  }
}

/** On a 429, pause ALL TTS submits on this key so every concurrent worker backs off together. */
function penalizeTTSRateLimit(key: string, retryMs: number): void {
  const b = ttsBucketFor(key);
  b.cooldownUntil = Math.max(b.cooldownUntil, Date.now() + retryMs);
  b.tokens = 0;
}

/** Bounded 429 retries per createTTSTask call — each waits out the shared cooldown first. */
const TTS_SUBMIT_MAX_ATTEMPTS = 5;
/** Cooldown applied on a 429 with no Retry-After header. */
const TTS_429_COOLDOWN_MS = 30_000;

// Known-bad (key, voiceId) pairs: a batch of 161 scenes sharing one misconfigured voice must
// fail 161 times INSTANTLY off this cache, not via 161 API calls (which is itself what tripped
// the 429 storm). TTL'd so fixing the voice on the 69Labs side doesn't need a process restart.
const BAD_VOICE_TTL_MS = 5 * 60 * 1000;
const _badVoices = new Map<string, { until: number; message: string }>();

const isVoiceNotFound = (status: number, errText: string): boolean =>
  status === 400 && /voice id was not found/i.test(errText);

export interface TTSParams {
  text: string;
  voiceId: string;
  modelId?: string;
  /** Wire-level provider: "elevenlabs" (default), "edgetts", or "minimax" (catalog voices) */
  voiceProvider?: "elevenlabs" | "edgetts" | "minimax";
  speed?: number;
  stability?: number;
  similarity?: number;
  style?: number;
  /** Minimax catalog-voice tuning (overrides individual fields below if set) */
  minimaxSettings?: {
    speed?: number; // 0.01–10
    pitch?: number; // -12 to 12
    volume?: number; // 0.5–2
    languageBoost?: string; // defaults to English
  };
}

export interface TTSResult {
  taskId: string;
  status: "pending" | "processing" | "completed" | "failed" | "censored";
  audioUrl?: string;
  subtitleUrl?: string;
  error?: string;
  /** If censored, contains the blocked chunks that need rewriting */
  blockedChunks?: Array<{ index: number; text: string }>;
}

/**
 * Create a TTS task on 69Labs.
 * Returns the job ID for polling.
 */
export async function createTTSTask69Labs(
  apiKey: string,
  params: TTSParams
): Promise<string> {
  const isMinimax = params.voiceProvider === "minimax";
  const body: Record<string, any> = {
    text: params.text,
    voiceId: params.voiceId,
    // Catalog (minimax) voices default to speech-02-hd, not the elevenlabs model
    modelId:
      params.modelId || (isMinimax ? "speech-02-hd" : "eleven_multilingual_v2"),
    splitType: "smart",
  };
  if (params.voiceProvider) body.voiceProvider = params.voiceProvider;

  if (isMinimax) {
    // Catalog voice mode: speed/pitch/volume/languageBoost go in minimaxSettings, not voiceSettings.
    const minimaxSettings: Record<string, any> = { ...params.minimaxSettings };
    if (minimaxSettings.speed === undefined && params.speed !== undefined) {
      minimaxSettings.speed = params.speed;
    }
    if (Object.keys(minimaxSettings).length > 0) {
      body.minimaxSettings = minimaxSettings;
    }
  } else {
    // Build voiceSettings if any are provided (elevenlabs / edgetts)
    const voiceSettings: Record<string, any> = {};
    if (params.speed !== undefined) voiceSettings.speed = params.speed;
    if (params.stability !== undefined)
      voiceSettings.stability = params.stability;
    if (params.similarity !== undefined)
      voiceSettings.similarityBoost = params.similarity;
    if (params.style !== undefined) voiceSettings.style = params.style;
    if (Object.keys(voiceSettings).length > 0) {
      body.voiceSettings = voiceSettings;
    }
  }

  // Fail instantly on a voice already known bad — no API call, no 429 pressure.
  const badKey = `${apiKey}:${params.voiceId}`;
  const bad = _badVoices.get(badKey);
  if (bad && Date.now() < bad.until) throw new VoiceNotFoundError(bad.message);
  if (bad) _badVoices.delete(badKey);

  let response: Response;
  for (let attempt = 1; ; attempt++) {
    await acquireTTSToken(apiKey); // pace submits under 69Labs' undisclosed per-key rate
    response = await fetch(`${BASE_URL}/tts/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.ok) break;

    const errText = await response.text();
    if (isVoiceNotFound(response.status, errText)) {
      const message =
        `69Labs rejected voice ID "${params.voiceId}" — not found. The channel's voice must ` +
        `exist in this 69Labs account's voice library or be a public voice ID; a private ` +
        `cloned voice from another account will not resolve. Fix the voice in Admin → Channels.`;
      _badVoices.set(badKey, {
        until: Date.now() + BAD_VOICE_TTL_MS,
        message,
      });
      throw new VoiceNotFoundError(message);
    }
    // 429 is 69Labs pacing us, not a failure of THIS request: put the whole key in cooldown
    // (so concurrent workers back off with us) and retry after the window.
    if (response.status === 429) {
      const retryAfterSec = Number(response.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec >= 0
          ? Math.max(retryAfterSec * 1000, 1000)
          : TTS_429_COOLDOWN_MS;
      penalizeTTSRateLimit(apiKey, waitMs);
      if (attempt < TTS_SUBMIT_MAX_ATTEMPTS) {
        console.warn(
          `[69Labs TTS] 429 on task creation — cooling down ${Math.round(waitMs / 1000)}s ` +
            `(attempt ${attempt}/${TTS_SUBMIT_MAX_ATTEMPTS})`
        );
        continue;
      }
      throw new Error(
        `69Labs TTS task creation rate-limited (429) after ${attempt} attempts — ` +
          `the account's request rate is exhausted; retry later.`
      );
    }
    const lowerErr = errText.toLowerCase();
    if (
      lowerErr.includes("credit") ||
      lowerErr.includes("limit") ||
      lowerErr.includes("quota")
    ) {
      throw new Error(
        "TTS credits depleted on 69Labs. Check your 69Labs dashboard for remaining credits."
      );
    }
    // 409: an identical TTS job is still running. The error body carries no task ID, so we
    // can't resume it here — surface a clear, retryable message. (The caller normally avoids
    // this by reusing the original task ID across retries instead of re-creating.)
    if (
      response.status === 409 ||
      errText.includes("DUPLICATE_TTS_IN_PROGRESS")
    ) {
      throw new Error(
        "69Labs TTS job already in progress (DUPLICATE_TTS_IN_PROGRESS) — a matching job is still running."
      );
    }
    throw new Error(
      `69Labs TTS task creation failed (${response.status}): ${errText}`
    );
  }

  const data = await response.json();
  const taskId = data.id || data.jobId;
  if (!taskId) {
    throw new Error(
      `69Labs TTS task creation returned no ID: ${JSON.stringify(data)}`
    );
  }

  console.log(
    `[69Labs TTS] Created task ${taskId} for voice ${params.voiceId}`
  );

  // Billed on accepted characters, so meter at task creation rather than at download —
  // a task that is created and then abandoned still spent the credits.
  recordUsage({
    lane: "tts",
    provider: "sixtynine_labs",
    model: body.modelId,
    calls: 1,
    quantity: params.text.length,
  });

  return taskId;
}

/**
 * Poll a 69Labs TTS task for its current status.
 */
export async function pollTTSTask69Labs(
  apiKey: string,
  taskId: string
): Promise<TTSResult> {
  const response = await fetch(`${BASE_URL}/tts/status/${taskId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`69Labs TTS poll failed (${response.status}): ${errText}`);
  }

  const data = await response.json();

  if (data.status === "COMPLETED") {
    // 69Labs requires a separate download endpoint — construct the download URL
    const audioUrl = `${BASE_URL}/tts/download/${taskId}`;
    return {
      taskId,
      status: "completed",
      audioUrl,
    };
  }

  if (data.status === "FAILED") {
    return {
      taskId,
      status: "failed",
      error: data.error || data.message || "TTS generation failed",
    };
  }

  if (data.status === "CANCELLED") {
    return {
      taskId,
      status: "failed",
      error: "TTS job was cancelled",
    };
  }

  if (data.status === "CENSORED") {
    return {
      taskId,
      status: "censored",
      error:
        "Some chunks were blocked by content moderation. Rewrite and retry.",
      blockedChunks: data.blockedChunks,
    };
  }

  // Still PENDING, PROCESSING, or FINALIZING
  return {
    taskId,
    status: data.status === "PENDING" ? "pending" : "processing",
  };
}

/**
 * Download the audio file from 69Labs TTS.
 * Returns the actual audio URL after following the redirect.
 */
export async function downloadTTSAudio69Labs(
  apiKey: string,
  taskId: string
): Promise<string> {
  const response = await fetch(`${BASE_URL}/tts/download/${taskId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `69Labs TTS download failed (${response.status}): ${errText}`
    );
  }

  // The response URL after redirect is the actual presigned URL
  return response.url;
}

/**
 * 69Labs Text-to-Speech integration.
 * Uses the /api/v1/tts/* endpoints — same ElevenLabs voice IDs as GenAIPro.
 * Mirrors the GenAIPro tts.ts interface (createTTSTask, pollTTSTask, listVoices).
 */

import { recordUsage } from "./costMeter";
import { summarizeHttpBody } from "./_core/errorDetail";

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
/**
 * Backoff base for a 5xx on task creation (doubles per attempt: 5s, 10s, 20s, 40s ≈ 75s total).
 * 69Labs sits behind Cloudflare, and an origin blip answers as a 521/522/523 HTML page for tens
 * of seconds — long enough to fail a single un-retried submit, short enough to ride out here
 * instead of failing the whole voiceover stage. Env override exists so tests can run it fast.
 */
const TTS_5XX_BASE_DELAY_MS =
  Number(process.env.SIXTYNINE_TTS_5XX_BASE_DELAY_MS) || 5_000;

// Known-bad (key, voiceId) pairs: a batch of 161 scenes sharing one misconfigured voice must
// fail 161 times INSTANTLY off this cache, not via 161 API calls (which is itself what tripped
// the 429 storm). TTL'd so fixing the voice on the 69Labs side doesn't need a process restart.
const BAD_VOICE_TTL_MS = 5 * 60 * 1000;
const _badVoices = new Map<string, { until: number; message: string }>();

// Standard lane has a known exact message; the clone lane's wording is unverified, so match
// any 400/404 "not found" there (a clone-lane request only ever references the one clone ID).
const isVoiceNotFound = (
  status: number,
  errText: string,
  cloneLane = false
): boolean =>
  cloneLane
    ? (status === 400 || status === 404) && /not found/i.test(errText)
    : status === 400 && /voice id was not found/i.test(errText);

// ─── Account voice clones (69Labs-native, uploaded via the site's clone lab) ───
// These IDs are NOT in the /tts/generate voice space — that endpoint 400s "voice ID was not
// found" for them even though the account owns them. They synthesize through the dedicated
// POST /voice-clones/generate lane (minimax-backed; status/download endpoints are shared with
// regular TTS). We detect them lazily: on a voice-not-found 400 we ask GET /voice-clones once,
// and remember the routing so every later call goes straight to the clone lane.
const CLONE_LIST_TTL_MS = 5 * 60 * 1000;
const _cloneLists = new Map<string, { until: number; ids: Set<string> }>();
const _cloneRoutes = new Set<string>(); // `${apiKey}:${voiceId}` confirmed clone-lane voices

/** IDs of this account's voice clones, cached per key. Null when the lookup itself fails. */
async function fetchVoiceCloneIds(apiKey: string): Promise<Set<string> | null> {
  const hit = _cloneLists.get(apiKey);
  if (hit && Date.now() < hit.until) return hit.ids;
  try {
    const resp = await fetch(`${BASE_URL}/voice-clones`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) return hit?.ids ?? null;
    const body: any = await resp.json();
    const ids = new Set<string>(
      (Array.isArray(body?.voiceClones) ? body.voiceClones : []).map((v: any) =>
        String(v.id)
      )
    );
    _cloneLists.set(apiKey, { until: Date.now() + CLONE_LIST_TTL_MS, ids });
    return ids;
  } catch {
    return hit?.ids ?? null;
  }
}

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
function buildStandardBody(params: TTSParams): Record<string, any> {
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
  return body;
}

// /voice-clones/generate contract (from the 69Labs web app): flat body, minimax field names —
// { voiceCloneId, text, model, speed?, pitch?, volume?, language_boost? }. Stability/similarity/
// style are elevenlabs-space knobs and do not apply to clones.
function buildCloneBody(params: TTSParams): Record<string, any> {
  const mm = params.minimaxSettings ?? {};
  const body: Record<string, any> = {
    voiceCloneId: params.voiceId,
    text: params.text,
    // Clone synthesis runs on minimax models; an elevenlabs modelId would fail validation here.
    model:
      (params.voiceProvider === "minimax" && params.modelId) || "speech-02-hd",
  };
  const speed = mm.speed ?? params.speed;
  if (speed !== undefined) body.speed = speed;
  if (mm.pitch !== undefined) body.pitch = mm.pitch;
  if (mm.volume !== undefined) body.volume = mm.volume;
  if (mm.languageBoost !== undefined) body.language_boost = mm.languageBoost;
  return body;
}

export async function createTTSTask69Labs(
  apiKey: string,
  params: TTSParams
): Promise<string> {
  // Fail instantly on a voice already known bad — no API call, no 429 pressure.
  const badKey = `${apiKey}:${params.voiceId}`;
  const bad = _badVoices.get(badKey);
  if (bad && Date.now() < bad.until) throw new VoiceNotFoundError(bad.message);
  if (bad) _badVoices.delete(badKey);

  let useCloneLane = _cloneRoutes.has(badKey);
  let body: Record<string, any>;
  let response: Response;
  for (let attempt = 1; ; attempt++) {
    body = useCloneLane ? buildCloneBody(params) : buildStandardBody(params);
    await acquireTTSToken(apiKey); // pace submits under 69Labs' undisclosed per-key rate
    response = await fetch(
      `${BASE_URL}/${useCloneLane ? "voice-clones/generate" : "tts/generate"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    if (response.ok) break;

    const errText = await response.text();
    if (isVoiceNotFound(response.status, errText, useCloneLane)) {
      // An account voice clone is invisible to /tts/generate by design — before declaring the
      // voice bad, ask the clone list and reroute to /voice-clones/generate if it's there.
      if (!useCloneLane) {
        const cloneIds = await fetchVoiceCloneIds(apiKey);
        if (cloneIds?.has(params.voiceId)) {
          console.log(
            `[69Labs TTS] Voice ${params.voiceId} is an account voice clone — ` +
              `routing via /voice-clones/generate`
          );
          _cloneRoutes.add(badKey);
          useCloneLane = true;
          continue;
        }
      } else {
        _cloneRoutes.delete(badKey); // clone was deleted on the 69Labs side — stop routing there
      }
      const message =
        `69Labs rejected voice ID "${params.voiceId}" — not found. The channel's voice must ` +
        `exist in this 69Labs account's voice library or voice clones, or be a public voice ` +
        `ID; a voice from another 69Labs account will not resolve. Fix the voice in Admin → Channels.`;
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
    // 5xx (including Cloudflare's 52x "origin down" pages) is the provider, not this request:
    // back off and resubmit the same body. Only after the budget is spent does it become an error.
    if (response.status >= 500) {
      if (attempt < TTS_SUBMIT_MAX_ATTEMPTS) {
        const waitMs = TTS_5XX_BASE_DELAY_MS * 2 ** (attempt - 1);
        console.warn(
          `[69Labs TTS] ${response.status} on task creation — ${summarizeHttpBody(errText, 120)}; ` +
            `retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${TTS_SUBMIT_MAX_ATTEMPTS})`
        );
        await sleep(waitMs);
        continue;
      }
      throw new Error(
        `69Labs TTS is unavailable (${response.status}) after ${attempt} attempts — ` +
          `${summarizeHttpBody(errText)}. The provider's server is down; retry the job in a few minutes.`
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
      `69Labs TTS task creation failed (${response.status}): ${summarizeHttpBody(errText)}`
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
    `[69Labs TTS] Created task ${taskId} for voice ${params.voiceId}` +
      (useCloneLane ? " (voice-clone lane)" : "")
  );

  // Billed on accepted characters, so meter at task creation rather than at download —
  // a task that is created and then abandoned still spent the credits.
  recordUsage({
    lane: "tts",
    provider: "sixtynine_labs",
    model: body.modelId ?? body.model,
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
    // A 5xx/429 on a STATUS read says nothing about the task — it is still running on the
    // provider. Report it as in progress so the caller keeps polling through the blip instead of
    // abandoning a job already paid for. A 4xx (task gone, key revoked) is genuinely terminal.
    if (response.status >= 500 || response.status === 429) {
      console.warn(
        `[69Labs TTS] poll ${taskId} got ${response.status} — ${summarizeHttpBody(errText, 120)}; will retry`
      );
      return { taskId, status: "processing" };
    }
    throw new Error(
      `69Labs TTS poll failed (${response.status}): ${summarizeHttpBody(errText)}`
    );
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
      `69Labs TTS download failed (${response.status}): ${summarizeHttpBody(errText)}`
    );
  }

  // The response URL after redirect is the actual presigned URL
  return response.url;
}

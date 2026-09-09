/**
 * MiniMax text-to-speech — the SECOND voice lane, offered when 69Labs cannot deliver.
 *
 * Not an automatic failover. The vendor is chosen by an operator before anything is voiced and
 * pinned to the job (`inputParams.ttsVendor`), so a film is never silently returned in a
 * different voice than the one that was asked for, and a master is never stitched from two
 * vendors. See `resolveTTSVendor` in longformVideo.ts.
 *
 * Three ways this differs from `tts69labs.ts`, each of which is a trap if missed:
 *
 *  1. **Synchronous.** One POST returns the finished audio inline, where 69Labs is
 *     create-then-poll. The unified layer is create/poll shaped, so `create` does the work and
 *     parks the result for `poll` to hand back immediately — keeping the retry/resume loop in
 *     `generateSceneVoiceover` untouched rather than forking it.
 *  2. **Errors arrive as HTTP 200.** Failures come back with `base_resp.status_code != 0` and a
 *     200 status line, so checking `resp.ok` alone reports an auth failure as success and
 *     returns a task whose audio is an empty string.
 *  3. **44100 is its ceiling** (`audio_setting.sample_rate` accepts up to 44100; 48000 is not a
 *     legal value). Our masters are 48k, and the shared completion tail only resamples when a
 *     volume gain or a dead-air cap actually runs — both no-ops on a clean file. So every clip
 *     is put through `normalizeNarrationAudio`, which forces 48k/stereo unconditionally.
 */

import { recordUsage } from "./costMeter";
import { normalizeNarrationAudio } from "./narrationIngest";
import { VoiceNotFoundError } from "./tts69labs";
import { nanoid } from "nanoid";
import type { TTSParams, TTSResult } from "./tts69labs";

/** Western endpoint. `api.minimaxi.chat` is the mainland host and takes different keys. */
const BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1";

/** Hard ceiling on one synthesis call. */
const CALL_TIMEOUT_MS = Number(process.env.MINIMAX_CALL_TIMEOUT_MS ?? 180_000);

/** MiniMax's documented per-request limit is 10,000 characters. */
export const MINIMAX_MAX_CHARS = 10_000;

/** MiniMax's own `base_resp.status_code` values (0 = success). */
const STATUS = {
  OK: 0,
  UNKNOWN: 1000,
  TIMEOUT: 1001,
  RATE_LIMIT: 1002,
  AUTH_FAILED: 1004,
  TPM_LIMIT: 1039,
  INVALID_CHARS: 1042,
  INVALID_PARAMS: 2013,
} as const;

/**
 * Finished audio waiting for the poll that immediately follows its create. The synthesis is
 * synchronous, so this is a handoff between two calls microseconds apart, not a job store —
 * single process (see CLAUDE.md), and entries are deleted on read.
 *
 * The TTL only matters for the abandoned case: a create whose caller threw before polling would
 * otherwise pin a whole narration's bytes in memory for the life of the process.
 */
const _pending = new Map<string, { buffer: Buffer; at: number }>();
const PENDING_TTL_MS = 30 * 60 * 1000;

function reapPending(): void {
  const cutoff = Date.now() - PENDING_TTL_MS;
  // `Array.from` rather than iterating the Map directly: the tsconfig target predates
  // downlevel iteration, and a snapshot is what we want anyway while deleting from it.
  for (const [id, v] of Array.from(_pending.entries())) {
    if (v.at < cutoff) _pending.delete(id);
  }
}

/** Map a MiniMax status code onto the error taxonomy the callers already branch on. */
function raiseFor(code: number, msg: string): never {
  // A bad voice is config, not flakiness — `generateSceneVoiceover` must not retry it, and the
  // same class is what the 69Labs lane throws for the identical mistake.
  if (code === STATUS.INVALID_PARAMS && /voice/i.test(msg)) {
    throw new VoiceNotFoundError(
      `MiniMax rejected the voice id — the channel's MiniMax voice must exist in THIS ` +
        `MiniMax account. A 69Labs or ElevenLabs voice id will not resolve here. ` +
        `Fix it in Admin → Channels. (${msg})`
    );
  }
  if (code === STATUS.AUTH_FAILED) {
    throw new Error(
      `MiniMax authentication failed (1004) — check the API key and Group ID in ` +
        `Admin → Provider Keys. (${msg})`
    );
  }
  if (code === STATUS.RATE_LIMIT || code === STATUS.TPM_LIMIT) {
    throw new Error(
      `MiniMax rate-limited this request (${code}) — retry shortly. (${msg})`
    );
  }
  throw new Error(`MiniMax TTS failed (${code}): ${msg}`);
}

export interface MinimaxAuth {
  apiKey: string;
  /** Optional: older accounts scope requests by group. Appended as a query param when set. */
  groupId?: string;
}

/**
 * Synthesize one segment and park the audio for the poll that follows.
 * Returns a synthetic task id — this lane has no server-side job to resume.
 */
export async function createTTSTaskMinimax(
  auth: MinimaxAuth,
  params: TTSParams
): Promise<string> {
  if (params.text.length > MINIMAX_MAX_CHARS) {
    // `splitScriptForNarration` already chunks at 4000, so this is a guard against a future
    // caller handing over a whole script, not something the pipeline can reach today.
    throw new Error(
      `MiniMax accepts ${MINIMAX_MAX_CHARS} characters per request; got ${params.text.length}.`
    );
  }
  const url =
    `${BASE_URL}/t2a_v2` +
    (auth.groupId ? `?GroupId=${encodeURIComponent(auth.groupId)}` : "");

  const body: Record<string, unknown> = {
    // MiniMax models, not ElevenLabs ones — `params.modelId` carries the channel's
    // `eleven_multilingual_v2` on the 69Labs path and would fail validation here.
    model: process.env.MINIMAX_TTS_MODEL || "speech-2.6-hd",
    text: params.text,
    stream: false,
    output_format: "hex",
    voice_setting: {
      voice_id: params.voiceId,
      // Same 0.5-2 band the channel's speed dial already lives in, so a channel tuned for
      // 69Labs reads at the same rate here.
      ...(params.speed !== undefined
        ? { speed: Math.min(2, Math.max(0.5, params.speed)) }
        : {}),
    },
    audio_setting: {
      format: "mp3",
      // 44100 is the API's ceiling; `normalizeNarrationAudio` lifts the result to the 48k
      // stereo shape the rest of the pipeline is built on.
      sample_rate: 44100,
      bitrate: 128000,
      channel: 2,
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    // The 69Labs lane has no timeout at all, which is why a stalled socket there reads as a
    // silent five-minute hang. Do not inherit that.
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  // A transport-level failure is still possible (proxy, gateway) and is retryable.
  if (!resp.ok) {
    throw new Error(
      `MiniMax TTS HTTP ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`
    );
  }

  const data: any = await resp.json();
  const code = data?.base_resp?.status_code;
  if (code !== STATUS.OK && code !== undefined) {
    raiseFor(code, String(data?.base_resp?.status_msg ?? "no message"));
  }
  const hex = data?.data?.audio;
  if (typeof hex !== "string" || hex.length === 0) {
    throw new Error("MiniMax returned no audio for this request");
  }

  // Billed on characters accepted, mirroring the 69Labs lane's metering point. `usage_characters`
  // is MiniMax's own count and is preferred over ours when present — punctuation and invisible
  // characters are counted differently by each side.
  recordUsage({
    lane: "tts",
    provider: "minimax",
    model: String(body.model),
    calls: 1,
    quantity: Number(data?.extra_info?.usage_characters) || params.text.length,
  });

  reapPending();
  const taskId = `mm_${nanoid(12)}`;
  _pending.set(taskId, {
    buffer: await normalizeNarrationAudio(Buffer.from(hex, "hex")),
    at: Date.now(),
  });
  return taskId;
}

/**
 * Hand back the audio parked by `createTTSTaskMinimax`. Always terminal — there is no remote
 * job, so a missing entry means the process restarted or the id was already consumed, and the
 * caller's retry loop will (correctly) synthesize afresh rather than wait forever.
 */
export function pollTTSTaskMinimax(taskId: string): TTSResult & {
  buffer?: Buffer;
} {
  const hit = _pending.get(taskId);
  if (!hit) {
    return {
      taskId,
      status: "failed",
      error: "MiniMax audio is no longer held for this task — re-synthesizing",
    };
  }
  _pending.delete(taskId);
  return { taskId, status: "completed", buffer: hit.buffer };
}

/**
 * Cheap liveness probe for the Admin "Test connection" button — one short synthesis, since
 * MiniMax has no free list/quota endpoint that also proves the key can actually synthesize.
 * A voice id is required, so the caller passes any configured channel's.
 */
export async function testMinimaxConnection(
  auth: MinimaxAuth,
  voiceId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const id = await createTTSTaskMinimax(auth, {
      text: "Connection test.",
      voiceId,
    });
    _pending.delete(id); // discard the audio; only the round trip mattered
    return {
      success: true,
      message: "MiniMax responded and synthesized audio.",
    };
  } catch (e: any) {
    return { success: false, message: e?.message ?? String(e) };
  }
}

export type TranscribeOptions = {
  audioUrl: string;
  language?: string;
  prompt?: string;
};

export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

/** One word with its start/end offset (seconds), returned when word-level granularity is requested. */
export type WhisperWord = {
  word: string;
  start: number;
  end: number;
};

export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
  /** Present only when the request asks for `timestamp_granularities[]=word`. */
  words?: WhisperWord[];
};

export type TranscriptionResponse = WhisperResponse;

export type TranscriptionError = {
  error: string;
  code:
    | "FILE_TOO_LARGE"
    | "INVALID_FORMAT"
    | "TRANSCRIPTION_FAILED"
    | "UPLOAD_FAILED"
    | "SERVICE_ERROR";
  details?: string;
};

import { randomUUID } from "node:crypto";
import { storagePut } from "../storage";
import { sleep } from "../providers/base";
import { ENV } from "./env";

const WHISPERX_BASE = `https://api.runpod.ai/v2/${ENV.runpodWhisperxEndpoint}`;
/** Client-side poll ceiling. A timeout is non-fatal — both callers fall back proportionally. */
const POLL_TIMEOUT_MS = 900_000; // 15 min (set RunPod endpoint Execution Timeout ≥ this)

type RunPodStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

/** One whisperx word — start/end are OPTIONAL (worker omits them on numerals/punctuation). */
type WhisperXWord = { word: string; start?: number; end?: number };
type WhisperXSegment = {
  start: number;
  end: number;
  text: string;
  words?: WhisperXWord[];
};
type WhisperXOutput = {
  segments: WhisperXSegment[];
  detected_language?: string;
  language_probability?: number;
};

/**
 * Submit one whisperx-worker job (async `POST /run`) and poll `GET /status/{id}` until terminal.
 * Transcription runs ONCE per longform/dubbing job, so — unlike runpod-wan2-video.ts — no
 * Semaphore/token-bucket rate limiters; a plain sequential poll loop is enough.
 * ponytail: single-job poll loop; add rate limiting only if transcription ever fans out.
 */
async function runWhisperX(
  audioUrl: string,
  opts: { language?: string; alignOutput: boolean }
): Promise<WhisperXOutput | TranscriptionError> {
  const apiKey = ENV.runPodApiKey;
  if (!apiKey) {
    return {
      error: "Transcription service is not configured",
      code: "SERVICE_ERROR",
      details: "RUN_POD_KEY is not set",
    };
  }

  // ── submit ──
  let jobId: string;
  try {
    const res = await fetch(`${WHISPERX_BASE}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          audio_file: audioUrl,
          align_output: opts.alignOutput,
          ...(opts.language ? { language: opts.language } : {}),
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        error: "Transcription submit failed",
        code: "SERVICE_ERROR",
        details: `${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`,
      };
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) {
      return {
        error: "Transcription submit returned no job id",
        code: "SERVICE_ERROR",
      };
    }
    jobId = data.id;
  } catch (e) {
    return {
      error: "Transcription submit error",
      code: "SERVICE_ERROR",
      details: e instanceof Error ? e.message : "unknown",
    };
  }

  // ── poll ──
  const start = Date.now();
  let pollCount = 0;
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await sleep(
      pollCount === 0 ? 2_000 : Math.min(3_000 * 1.4 ** pollCount, 6_000)
    );
    pollCount++;
    try {
      const res = await fetch(`${WHISPERX_BASE}/status/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 429) {
        const ra = parseInt(res.headers.get("Retry-After") ?? "", 10);
        await sleep(Math.min((ra || 10) * 1000, 60_000));
        continue;
      }
      if (!res.ok) {
        if (res.status >= 500) {
          await sleep(5_000);
          continue;
        }
        return {
          error: "Transcription poll failed",
          code: "SERVICE_ERROR",
          details: `${res.status} ${res.statusText}`,
        };
      }
      const data = (await res.json()) as {
        status: RunPodStatus;
        output?: WhisperXOutput;
        error?: string;
      };

      if (data.status === "COMPLETED") {
        if (!data.output || !Array.isArray(data.output.segments)) {
          return {
            error: "Transcription returned no segments",
            code: "SERVICE_ERROR",
            details: JSON.stringify(data.output).slice(0, 200),
          };
        }
        return data.output;
      }
      if (
        data.status === "FAILED" ||
        data.status === "CANCELLED" ||
        data.status === "TIMED_OUT"
      ) {
        return {
          error: "Transcription job failed",
          code: "TRANSCRIPTION_FAILED",
          details: data.error || data.status,
        };
      }
      // IN_QUEUE / IN_PROGRESS → keep polling
    } catch {
      await sleep(5_000); // transient network error — retry within the timeout window
    }
  }
  return {
    error: "Transcription timed out",
    code: "TRANSCRIPTION_FAILED",
    details: `client poll ceiling ${POLL_TIMEOUT_MS / 1000}s exceeded`,
  };
}

/**
 * Flatten whisperx segments → WhisperWord[]. whisperx omits start/end on some words (numerals,
 * punctuation-adjacent); forward-fill from the running cursor so timings are always finite and
 * non-decreasing. Never drop words — narrationAlignment matches word TEXT against script tokens,
 * so a dropped token would desync the cursor.
 */
export function mapWhisperXToWords(segments: WhisperXSegment[]): WhisperWord[] {
  const out: WhisperWord[] = [];
  let cursor = 0; // last known end
  for (const seg of segments) {
    for (const w of seg.words ?? []) {
      const start =
        typeof w.start === "number" ? Math.max(w.start, cursor) : cursor;
      const end = typeof w.end === "number" ? Math.max(w.end, start) : start;
      out.push({ word: w.word, start, end });
      cursor = end;
    }
  }
  return out;
}

/** Total duration = last segment/word end (whichever is later). */
export function whisperxDuration(
  segments: WhisperXSegment[],
  words: WhisperWord[]
): number {
  const lastSeg = segments.length ? segments[segments.length - 1].end : 0;
  const lastWord = words.length ? words[words.length - 1].end : 0;
  return Math.max(lastSeg || 0, lastWord || 0);
}

export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  // NOTE: options.prompt is ignored — whisperx-worker exposes no initial_prompt input.
  const out = await runWhisperX(options.audioUrl, {
    language: "en",
    alignOutput: false, // callers here only read .text
  });
  if ("error" in out) return out;

  const text = out.segments
    .map(s => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return {
      error: "Invalid transcription response",
      code: "SERVICE_ERROR",
      details: "whisperx returned no text",
    };
  }
  const segments: WhisperSegment[] = out.segments.map((s, i) => ({
    id: i,
    seek: 0,
    start: s.start,
    end: s.end,
    text: s.text,
    tokens: [],
    temperature: 0,
    avg_logprob: 0,
    compression_ratio: 0,
    no_speech_prob: 0,
  }));
  return {
    task: "transcribe",
    language: out.detected_language ?? "en",
    duration: out.segments.length
      ? out.segments[out.segments.length - 1].end
      : 0,
    text,
    segments,
  };
}

/**
 * Transcribe an in-memory audio buffer with WORD-level timestamps via the RunPod whisperx-worker.
 * whisperx needs a URL, so the buffer is staged to S3 first (same pattern as dubbing), then
 * transcribed with `align_output: true`. Returns the word list (start/end seconds) + total
 * duration, or an error. No size cap — that was an OpenAI Whisper limit; RunPod/whisperx has none.
 */
export async function transcribeWordsFromBuffer(
  buffer: Buffer,
  _options?: { prompt?: string } // prompt unsupported by whisperx-worker; kept for signature compat
): Promise<{ words: WhisperWord[]; duration: number } | TranscriptionError> {
  let url: string;
  try {
    ({ url } = await storagePut(
      `transcription/temp-audio/${randomUUID()}.mp3`,
      buffer,
      "audio/mpeg"
    ));
  } catch (e) {
    return {
      error: "Failed to stage audio for transcription",
      code: "UPLOAD_FAILED",
      details: e instanceof Error ? e.message : "unknown",
    };
  }

  const out = await runWhisperX(url, { language: "en", alignOutput: true });
  if ("error" in out) return out;

  const words = mapWhisperXToWords(out.segments);
  if (words.length === 0) {
    return {
      error: "Transcription returned no word timings",
      code: "SERVICE_ERROR",
      details: "no words after align",
    };
  }
  return { words, duration: whisperxDuration(out.segments, words) };
}

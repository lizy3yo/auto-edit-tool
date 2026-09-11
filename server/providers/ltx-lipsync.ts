import type { GenerationResult } from "../../shared/types";
import type { VideoSubmitResult } from "./base";
import { sleep } from "./base";
import { Semaphore } from "./semaphore";
import { ENV } from "../_core/env";
import { presignOwnBucketUrl } from "../storage";
import { recordUsage } from "../costMeter";
import { summarizeHttpBody } from "../_core/errorDetail";

/**
 * Host lip-sync on self-hosted LTX-2 (Lightricks) running as a RunPod serverless worker —
 * the third host lane, beside HeyGen (`heygen-lipsync.ts`) and InfiniteTalk
 * (`runpod-lipsync.ts`).
 *
 * Same contract as both (submit → taskId, poll → downloaded bytes) so `resolveLipsyncLane`
 * can hand any of the three to a caller that knows none of them. What is different:
 *
 * - The lane is deliberately UNTUNED. It sends the photo, the narration and a short prompt,
 *   and nothing else unless an env override is set — the worker's own workflow defaults are
 *   the standard the lane starts from, and every dial is a measured change away from it.
 *   None of InfiniteTalk's run-up, batching, window seams or sharpen apply here.
 * - LTX-2.3 renders at most 20 s per call, so a longer beat arrives as several chunks of the
 *   same scene (`server/lipsyncChunks.ts`); this adapter sees one chunk at a time.
 * - Billed on GPU TIME like InfiniteTalk, so it meters its own usage from RunPod's reported
 *   `executionTime` rather than being wrapped by the per-output-second meter in
 *   `resolveLipsyncAdapter`.
 *
 * WORKER CONTRACT (the handler the endpoint runs must honour this):
 *   input:  { image_url, audio_url, prompt, negative_prompt?, width?, height?, seed? }
 *   output: { video: <base64 mp4>, error?, timings? }
 * The delivered clip must carry the INPUT audio untouched (the A2V graph muxes the original
 * waveform back in) and be as long as that audio.
 */

/** One LTX render: the still to animate, the narration it should speak, and a short direction. */
export interface LtxLipsyncParams {
  /** Host photo or generated plate (R2 URL) — the identity reference. */
  imageUrl: string;
  /** Our own narration for this chunk (R2 URL). Drives both the mouth and the clip's length. */
  audioUrl: string;
  /** Short direction — see `buildLtxLipsyncPrompt` in longformVideo. */
  prompt: string;
  /** Optional; an older worker image ignores the field. */
  negativePrompt?: string;
  /** Sent only when both are set; unset means the workflow's own size. */
  width?: number;
  height?: number;
  /** Fixed seed for an A/B; unset lets the workflow pick. */
  seed?: number;
}

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

/**
 * Client-side poll ceiling for one LTX render. A 20 s chunk is minutes on a single card
 * including model load, not the half hour InfiniteTalk's windows take, so this is sized
 * between HeyGen's 15 min and InfiniteTalk's 35. A poll that runs out returns `pending` and
 * the resume path keeps collecting the paid-for render.
 */
export const LTX_LIPSYNC_TIMEOUT_MS = Number(
  process.env.LTX_LIPSYNC_TIMEOUT_MS ?? 1_200_000 // 20 minutes
);

/**
 * Server-side cap sent with every submit as `policy.executionTimeout`, overriding the
 * endpoint's own setting — the same per-request contract as the InfiniteTalk lane, and for
 * the same reason: a render RunPod stops at this cap comes back as a deterministic, terminal
 * failure rather than being resubmitted identically for as long as the job lives.
 */
export const LTX_LIPSYNC_EXECUTION_TIMEOUT_MS = Number(
  process.env.LTX_LIPSYNC_EXECUTION_TIMEOUT_MS ?? 1_500_000 // 25 minutes
);

/**
 * Whole-call ceiling on a RunPod request. The completed `/status` response carries the whole
 * MP4 as base64, so it is a download in status-call clothing.
 */
const CALL_TIMEOUT_MS = Number(
  process.env.LTX_LIPSYNC_CALL_TIMEOUT_MS ?? 300_000
);
const callSignal = () => AbortSignal.timeout(CALL_TIMEOUT_MS);

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 5_000;

/**
 * In-flight cap, per endpoint. RunPod queues anything beyond the endpoint's max-workers, and
 * a queued job's wait burns the poll ceiling above while doing no work — keep this at or a
 * little above that worker count.
 */
const _ltxSlots = new Map<string, Semaphore>();
export const ltxLipsyncSlotsFor = (endpointId: string): Semaphore => {
  let s = _ltxSlots.get(endpointId);
  if (!s)
    _ltxSlots.set(endpointId, (s = new Semaphore(ENV.ltxLipsyncConcurrency)));
  return s;
};

/** RunPod serverless job lifecycle. Only the first two are non-terminal. */
type RunPodStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

type RunPodStatusBody = {
  status?: RunPodStatus;
  /** Handler return value. `video` is base64 MP4; `error` is its own failure channel. */
  output?: {
    video?: string;
    video_path?: string;
    error?: string;
    /** Worker's per-node seconds, when the handler reports them. */
    timings?: Record<string, number>;
  };
  error?: unknown;
  /** Billed GPU milliseconds — the metered quantity for this lane. */
  executionTime?: number;
  /** Queue wait in ms. Not billed, but worth logging when it dominates. */
  delayTime?: number;
};

export class LtxLipsyncAdapter {
  constructor(
    private readonly endpointId: string,
    private readonly apiKey: string
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Submit one render and return RunPod's job id as `taskId`, so a poll timeout or a process
   * restart resumes the already-running job instead of re-paying for it.
   *
   * Both media URLs are presigned onto the S3 endpoint first: the worker fetches them itself,
   * and `*.r2.dev` is DNS-blocked on a lot of networks (see `presignOwnBucketUrl`).
   */
  async submitLipsync(params: LtxLipsyncParams): Promise<VideoSubmitResult> {
    const [imageUrl, audioUrl] = await Promise.all([
      presignOwnBucketUrl(params.imageUrl),
      presignOwnBucketUrl(params.audioUrl),
    ]);

    const body = JSON.stringify({
      input: {
        image_url: imageUrl,
        audio_url: audioUrl,
        prompt: params.prompt,
        ...(params.negativePrompt
          ? { negative_prompt: params.negativePrompt }
          : {}),
        // Override-only: absent fields leave the worker on its workflow defaults.
        ...(params.width != null && params.height != null
          ? { width: params.width, height: params.height }
          : {}),
        ...(params.seed != null ? { seed: params.seed } : {}),
      },
      policy: { executionTimeout: LTX_LIPSYNC_EXECUTION_TIMEOUT_MS },
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${RUNPOD_API_BASE}/${this.endpointId}/run`, {
          method: "POST",
          headers: this.headers(),
          body,
          signal: callSignal(),
        });

        if (!res.ok) {
          const errText = await res.text();
          const retriable = res.status === 429 || res.status >= 500;
          if (retriable && attempt < MAX_RETRIES) {
            const retryAfter = parseInt(
              res.headers.get("Retry-After") ?? "",
              10
            );
            const waitMs = retryAfter
              ? Math.min(retryAfter * 1000, 60_000)
              : BASE_RETRY_DELAY_MS * 2 ** attempt;
            await sleep(waitMs);
            continue;
          }
          return {
            error: `LTX submit failed (${res.status}): ${summarizeHttpBody(errText, 200)}`,
          };
        }

        const data = (await res.json()) as { id?: string };
        if (!data.id) return { error: "LTX submit returned no job id" };
        return { taskId: data.id };
      } catch (err: any) {
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
          continue;
        }
        return { error: `LTX submit error: ${err?.message ?? err}` };
      }
    }
    return { error: "LTX submit exhausted retries" };
  }

  /**
   * Poll one job to a terminal state and return the clip bytes.
   *
   * A timeout resolves `{ pending: true, taskId }` rather than failing, so the orchestrator
   * marks the scene "rendering" and a later resume pass downloads the finished job — the
   * GPU time is already spent either way.
   */
  async pollVideo(
    taskId: string,
    timeoutMs: number = LTX_LIPSYNC_TIMEOUT_MS
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    let pollCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      // Renders are minutes long: an unhurried first check, widening to 30 s — each completed
      // poll drags the whole MP4 down with it.
      await sleep(
        pollCount === 0 ? 10_000 : Math.min(10_000 * 1.3 ** pollCount, 30_000)
      );
      pollCount++;

      let data: RunPodStatusBody;
      try {
        const res = await fetch(
          `${RUNPOD_API_BASE}/${this.endpointId}/status/${taskId}`,
          { headers: this.headers(), signal: callSignal() }
        );

        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("Retry-After") ?? "", 10);
          await sleep(Math.min((retryAfter || 10) * 1000, 60_000));
          continue;
        }
        if (res.status === 404) {
          // Unknown job id — a stale id after a provider swap, or a result RunPod has aged
          // out. Terminal: let the caller re-submit.
          return {
            success: false,
            taskId,
            error: "LTX job not found (404) — it may have expired",
            infraFailure: true,
          };
        }
        if (!res.ok) {
          const errText = await res.text();
          console.warn(
            `[LTX] Poll error (${res.status}): ${summarizeHttpBody(errText, 200)}`
          );
          await sleep(5_000);
          continue;
        }
        data = (await res.json()) as RunPodStatusBody;
      } catch (err: any) {
        console.warn(`[LTX] Poll network error: ${err?.message ?? err}`);
        await sleep(5_000);
        continue;
      }

      if (data.status === "COMPLETED") {
        return this.finish(taskId, data, startTime, pollCount);
      }

      if (
        data.status === "FAILED" ||
        data.status === "CANCELLED" ||
        data.status === "TIMED_OUT"
      ) {
        const detail =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? data.status);
        // Killed at the execution cap (RunPod reports it as FAILED with this wording, not as
        // TIMED_OUT). The GPU time IS billed, so it is metered like a success; and the failure
        // is deterministic — resubmitted, the same render is stopped at the same minute — so it
        // is `terminal`, not `infraFailure`.
        if (data.status === "TIMED_OUT" || /executionTimeout/i.test(detail)) {
          const gpuSeconds = this.meterGpuTime(data);
          const minutes = Math.round(gpuSeconds / 60);
          console.error(
            `[LTX] Job ${taskId} stopped at the execution cap after ${minutes} min of GPU — ` +
              `not resubmitting (the same render would be stopped at the same point)`
          );
          return {
            success: false,
            taskId,
            terminal: true,
            error:
              `LTX stopped this render at its execution cap after ${minutes} min of GPU time. ` +
              `Shorten the chunk (LTX_LIPSYNC_MAX_SEC), move the endpoint to a faster GPU, or ` +
              `raise LTX_LIPSYNC_EXECUTION_TIMEOUT_MS.`,
          };
        }
        // CANCELLED is a decision, not a fault: the app cancels a render it has given up on
        // and an operator can cancel from the dashboard. Never resubmit one.
        if (data.status === "CANCELLED") {
          console.log(`[LTX] Job ${taskId} was cancelled — not resubmitting`);
          return {
            success: false,
            taskId,
            terminal: true,
            error: `LTX job was cancelled (${detail.slice(0, 200)})`,
          };
        }
        console.log(`[LTX] Job ${taskId} terminal: ${detail.slice(0, 300)}`);
        return {
          success: false,
          taskId,
          error: `LTX job ${data.status}: ${detail.slice(0, 500)}`,
          infraFailure: true,
        };
      }
      // IN_QUEUE / IN_PROGRESS — keep polling.
    }

    return {
      success: false,
      pending: true,
      taskId,
      error: `Client timed out after ${Math.round(timeoutMs / 1000)}s. The render may still be running on RunPod.`,
    };
  }

  /**
   * Best-effort "stop billing for this job". RunPod bills the GPU for as long as a job runs;
   * only for a scene abandoned for GOOD — a poll timeout deliberately does not call this, so
   * a resume can still collect a render already paid for. Never throws.
   */
  async cancelJob(taskId: string): Promise<void> {
    try {
      const res = await fetch(
        `${RUNPOD_API_BASE}/${this.endpointId}/cancel/${taskId}`,
        {
          method: "POST",
          headers: this.headers(),
          signal: AbortSignal.timeout(15_000),
        }
      );
      console.log(
        `[LTX] cancel ${taskId}: ${res.ok ? "accepted" : `HTTP ${res.status}`}`
      );
    } catch (err: any) {
      console.warn(`[LTX] cancel ${taskId} failed: ${err?.message ?? err}`);
    }
  }

  /**
   * Turn a COMPLETED job into bytes, and meter what it cost. A handler-level failure arrives
   * HERE as `{ error }` on a job RunPod considers successful — only a crashed worker produces
   * a FAILED status.
   */
  private finish(
    taskId: string,
    data: RunPodStatusBody,
    startTime: number,
    pollCount: number
  ): GenerationResult {
    const out = data.output ?? {};

    if (out.error) {
      return {
        success: false,
        taskId,
        error: `LTX worker error: ${String(out.error).slice(0, 500)}`,
        infraFailure: true,
      };
    }

    if (!out.video) {
      if (out.video_path) {
        return {
          success: false,
          taskId,
          error:
            "LTX worker returned a network-volume path instead of the clip; this lane " +
            "expects base64 in `video`.",
          infraFailure: true,
        };
      }
      return {
        success: false,
        taskId,
        error: `LTX completed with no video in its output (keys: ${Object.keys(out).join(", ") || "none"})`,
        infraFailure: true,
      };
    }

    let fileData: Buffer;
    try {
      fileData = Buffer.from(out.video.replace(/^data:[^,]+,/, ""), "base64");
    } catch (err: any) {
      return {
        success: false,
        taskId,
        error: `LTX returned an undecodable clip: ${err?.message ?? err}`,
        infraFailure: true,
      };
    }
    if (fileData.length === 0) {
      return {
        success: false,
        taskId,
        error: "LTX returned an empty clip",
        infraFailure: true,
      };
    }

    const gpuSeconds = this.meterGpuTime(data);
    const workerTimings =
      out.timings && typeof out.timings === "object" ? out.timings : undefined;
    console.log(
      `[LTX] Job ${taskId} completed — ${(fileData.length / 1024 / 1024).toFixed(1)}MB | ` +
        `gpu ${gpuSeconds.toFixed(0)}s | queue ${Math.round((data.delayTime ?? 0) / 1000)}s | ` +
        `wall ${Math.round((Date.now() - startTime) / 1000)}s | polls ${pollCount}` +
        (workerTimings
          ? ` | worker ${Object.entries(workerTimings)
              .map(([k, v]) => `${k} ${v}s`)
              .join(", ")}`
          : "")
    );

    return {
      success: true,
      fileData,
      mimeType: "video/mp4",
      taskId,
      gpuSeconds,
      workerTimings,
    };
  }

  /**
   * Meter what RunPod says a job cost, in seconds. Recorded for a success and for a render
   * stopped at the execution cap (both billed in full); a crashed worker's partial compute
   * cannot be attributed, and over-reporting spend is worse than under-reporting it.
   */
  private meterGpuTime(data: RunPodStatusBody): number {
    const gpuSeconds = (data.executionTime ?? 0) / 1000;
    if (gpuSeconds > 0) {
      recordUsage({
        lane: "lipsync",
        provider: "ltx",
        model: "ltx-2.3",
        calls: 1,
        quantity: gpuSeconds,
      });
    }
    return gpuSeconds;
  }

  /** Cheap reachability probe for the endpoint — the boot log and the Admin readiness check. */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${RUNPOD_API_BASE}/${this.endpointId}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok)
        return {
          success: false,
          message: `LTX health check failed (${res.status})`,
        };
      return { success: true, message: "RunPod LTX endpoint reachable" };
    } catch (err: any) {
      return {
        success: false,
        message: `LTX health check error: ${err?.message ?? err}`,
      };
    }
  }
}

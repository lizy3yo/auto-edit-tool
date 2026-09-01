import type { GenerationResult } from "../../shared/types";
import type { VideoSubmitResult } from "./base";
import { sleep } from "./base";
import { Semaphore } from "./semaphore";
import { ENV } from "../_core/env";
import { presignOwnBucketUrl } from "../storage";
import { recordUsage } from "../costMeter";

/**
 * Host lip-sync on self-hosted InfiniteTalk (MeiGen-AI) running as a RunPod serverless
 * worker — the alternative to the HeyGen lane in `heygen-lipsync.ts`.
 *
 * Same contract as HeyGen's adapter (submit → taskId, poll → downloaded bytes) so
 * `resolveLipsyncLane` can hand either one to a caller that knows neither. The differences
 * that matter:
 *
 * - InfiniteTalk is PROMPTED (`buildLipsyncPrompt`); Avatar IV ignores prompts entirely.
 * - It renders at most 720p, so `LIPSYNC_RESOLUTION` is a real argument here rather than
 *   the fixed 1080p HeyGen always returns.
 * - There is no avatar to register: the host photo is a plain input, which removes HeyGen's
 *   whole register→wait→cache dance and its "missing image dimensions" retry window.
 * - It is billed on GPU TIME, not on seconds of finished video, so this adapter meters its
 *   own usage from RunPod's reported `executionTime` (the whisperx lane in
 *   `_core/voiceTranscription.ts` does the same) instead of being wrapped by the
 *   per-output-second meter in `resolveLipsyncAdapter`.
 */

/** One host render: the still to animate, the narration it should speak, and how to shoot it. */
export interface RunpodLipsyncParams {
  /** Host photo or generated plate (R2 URL) — the identity reference. */
  imageUrl: string;
  /** Our own TTS narration (R2 URL). Drives both the mouth and the clip's length. */
  audioUrl: string;
  /** InfiniteTalk direction — see `buildLipsyncPrompt`; short and framing-focused. */
  prompt: string;
  /**
   * What the render must NOT do (`LIPSYNC_NEGATIVE_DIRECTION`). Optional: an older worker
   * image ignores the field and falls back to the negative prompt baked into its workflow,
   * so a lagging endpoint still renders rather than 400ing.
   */
  negativePrompt?: string;
  width: number;
  height: number;
}

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

/**
 * Client-side poll ceiling for one InfiniteTalk render. Far longer than HeyGen's 15 min
 * because the worker is our own single GPU rather than a fleet: at ~10-25 GPU-seconds per
 * second of output on the fast tier, a long host scene is minutes of compute on its own, and
 * anything queued behind another scene waits through that too. `SCENE_DEADLINE_HOST_RUNPOD_MS`
 * sits above this so the deadline never fires first.
 */
export const RUNPOD_LIPSYNC_TIMEOUT_MS = Number(
  process.env.RUNPOD_LIPSYNC_TIMEOUT_MS ?? 2_100_000 // 35 minutes
);

/**
 * Whole-call ceiling on a RunPod request. The completed `/status` response carries the whole
 * MP4 as base64, so it is a download in status-call clothing and gets the generous number;
 * a mid-body stall would otherwise park the scene until its deadline, since the poll loop
 * only re-checks its own clock BETWEEN iterations.
 */
const CALL_TIMEOUT_MS = Number(
  process.env.RUNPOD_LIPSYNC_CALL_TIMEOUT_MS ?? 300_000
);
const callSignal = () => AbortSignal.timeout(CALL_TIMEOUT_MS);

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 5_000;

/**
 * In-flight cap, per endpoint. Unlike the HeyGen semaphore this is NOT about a vendor's
 * concurrency allowance — RunPod happily accepts everything and queues the overflow. It
 * exists because a queued job's wait burns the client poll ceiling above while doing no
 * work, so submitting far more than the endpoint's max-workers setting just converts
 * render time into timeouts. Keep it at or a little above that worker count.
 */
const _runpodSlots = new Map<string, Semaphore>();
export const runpodLipsyncSlotsFor = (endpointId: string): Semaphore => {
  let s = _runpodSlots.get(endpointId);
  if (!s)
    _runpodSlots.set(
      endpointId,
      (s = new Semaphore(ENV.runpodLipsyncConcurrency))
    );
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
  output?: { video?: string; video_path?: string; error?: string };
  error?: unknown;
  /** Billed GPU milliseconds — the metered quantity for this lane. */
  executionTime?: number;
  /** Queue wait in ms. Not billed, but worth logging when it dominates. */
  delayTime?: number;
};

export class RunpodLipsyncAdapter {
  constructor(
    private readonly endpointId: string,
    private readonly apiKey: string,
    /**
     * `fast` = 8-step distill (the default); `full` = 40 steps with real CFG, which is ~10x
     * the model evaluations (40 steps x 2 CFG passes vs 8 x 1) and so ~10x the GPU time.
     */
    private readonly quality: "fast" | "full"
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
   * Both media URLs are presigned onto the S3 endpoint first: the worker fetches them itself
   * with wget, and `*.r2.dev` is DNS-blocked on a lot of networks (see `presignOwnBucketUrl`).
   * Signatures last an hour, which is why they are minted here at submit rather than
   * persisted — a job that sat in the queue that long has already blown its deadline.
   */
  async submitLipsync(params: RunpodLipsyncParams): Promise<VideoSubmitResult> {
    const [imageUrl, audioUrl] = await Promise.all([
      presignOwnBucketUrl(params.imageUrl),
      presignOwnBucketUrl(params.audioUrl),
    ]);

    const body = JSON.stringify({
      input: {
        input_type: "image",
        person_count: "single",
        image_url: imageUrl,
        wav_url: audioUrl,
        prompt: params.prompt,
        ...(params.negativePrompt
          ? { negative_prompt: params.negativePrompt }
          : {}),
        width: params.width,
        height: params.height,
        quality: this.quality,
      },
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
            error: `RunPod submit failed (${res.status}): ${errText.substring(0, 200)}`,
          };
        }

        const data = (await res.json()) as { id?: string };
        if (!data.id) return { error: "RunPod submit returned no job id" };
        return { taskId: data.id };
      } catch (err: any) {
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
          continue;
        }
        return { error: `RunPod submit error: ${err?.message ?? err}` };
      }
    }
    return { error: "RunPod submit exhausted retries" };
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
    timeoutMs: number = RUNPOD_LIPSYNC_TIMEOUT_MS
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    let pollCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      // A render is minutes long, so the first check is unhurried and the cadence widens
      // to 30s — polling harder cannot make the GPU faster, and each completed poll drags
      // the whole MP4 down with it.
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
          // Unknown job id — includes a stale HeyGen taskId after a provider swap, and a
          // result RunPod has already aged out. Terminal: let the caller re-submit.
          return {
            success: false,
            taskId,
            error: "RunPod job not found (404) — it may have expired",
            infraFailure: true,
          };
        }
        if (!res.ok) {
          const errText = await res.text();
          console.warn(
            `[RunPod] Poll error (${res.status}): ${errText.substring(0, 200)}`
          );
          await sleep(5_000);
          continue;
        }
        data = (await res.json()) as RunPodStatusBody;
      } catch (err: any) {
        console.warn(`[RunPod] Poll network error: ${err?.message ?? err}`);
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
        console.log(`[RunPod] Job ${taskId} terminal: ${detail.slice(0, 300)}`);
        return {
          success: false,
          taskId,
          error: `RunPod job ${data.status}: ${detail.slice(0, 500)}`,
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
   * Best-effort "stop billing for this job".
   *
   * RunPod bills the GPU for as long as a job runs, and our poll ceiling giving up does NOT
   * stop it: a wedged render keeps burning until the endpoint's own execution timeout, which
   * is the most expensive failure this lane has — an hour of GPU for a scene nobody is
   * waiting for any more.
   *
   * Only for a scene abandoned for GOOD. A poll timeout deliberately does not call this: that
   * path returns `pending` precisely so a resume can collect a render already paid for, and
   * cancelling would throw that money away.
   *
   * Never throws. Cancelling is an optimisation, and failing to cancel is exactly the
   * behaviour we had before it existed.
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
        `[RunPod] cancel ${taskId}: ${res.ok ? "accepted" : `HTTP ${res.status}`}`
      );
    } catch (err: any) {
      console.warn(`[RunPod] cancel ${taskId} failed: ${err?.message ?? err}`);
    }
  }

  /**
   * Turn a COMPLETED job into bytes, and meter what it cost.
   *
   * A handler-level failure arrives HERE, not as a FAILED job: the worker catches its own
   * errors and returns `{ error }` from a job RunPod considers successful. Only a crashed
   * worker produces a FAILED status, so this branch is the one that actually reports what
   * went wrong inside ComfyUI.
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
        error: `RunPod worker error: ${String(out.error).slice(0, 500)}`,
        infraFailure: true,
      };
    }

    if (!out.video) {
      // `video_path` means the worker was asked to write to a network volume, which this
      // adapter has no way to read. Say so plainly rather than reporting an empty render.
      if (out.video_path) {
        return {
          success: false,
          taskId,
          error:
            "RunPod returned a network-volume path instead of the clip; this lane expects " +
            "base64 (`network_volume` must stay off).",
          infraFailure: true,
        };
      }
      return {
        success: false,
        taskId,
        error: `RunPod completed with no video in its output (keys: ${Object.keys(out).join(", ") || "none"})`,
        infraFailure: true,
      };
    }

    let fileData: Buffer;
    try {
      // Strip a `data:video/mp4;base64,` prefix if the worker ever grows one.
      fileData = Buffer.from(out.video.replace(/^data:[^,]+,/, ""), "base64");
    } catch (err: any) {
      return {
        success: false,
        taskId,
        error: `RunPod returned an undecodable clip: ${err?.message ?? err}`,
        infraFailure: true,
      };
    }
    if (fileData.length === 0) {
      return {
        success: false,
        taskId,
        error: "RunPod returned an empty clip",
        infraFailure: true,
      };
    }

    // RunPod bills the GPU time it reports, not the wall clock we waited (which includes
    // queueing) and not the seconds of video produced — so that is what gets metered. Only
    // a success is recorded: a crashed worker's partial compute is not something we can
    // attribute, and over-reporting spend is worse than under-reporting it.
    const gpuSeconds = (data.executionTime ?? 0) / 1000;
    if (gpuSeconds > 0) {
      recordUsage({
        lane: "lipsync",
        provider: "runpod",
        model: `infinitetalk-${this.quality}`,
        calls: 1,
        quantity: gpuSeconds,
      });
    }

    console.log(
      `[RunPod] Job ${taskId} completed — ${(fileData.length / 1024 / 1024).toFixed(1)}MB | ` +
        `gpu ${gpuSeconds.toFixed(0)}s | queue ${Math.round((data.delayTime ?? 0) / 1000)}s | ` +
        `wall ${Math.round((Date.now() - startTime) / 1000)}s | polls ${pollCount}`
    );

    return { success: true, fileData, mimeType: "video/mp4", taskId };
  }

  /**
   * Cheap reachability probe for the endpoint — used by the boot log so a missing or
   * mistyped endpoint id surfaces before the first host scene, not during one.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${RUNPOD_API_BASE}/${this.endpointId}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok)
        return {
          success: false,
          message: `RunPod health check failed (${res.status})`,
        };
      return {
        success: true,
        message: "RunPod InfiniteTalk endpoint reachable",
      };
    } catch (err: any) {
      return {
        success: false,
        message: `RunPod health check error: ${err?.message ?? err}`,
      };
    }
  }
}

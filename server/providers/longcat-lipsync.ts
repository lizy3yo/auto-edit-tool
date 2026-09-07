import type { GenerationResult } from "../../shared/types";
import type { VideoSubmitResult } from "./base";
import { sleep } from "./base";
import { Semaphore } from "./semaphore";
import { ENV } from "../_core/env";
import { presignOwnBucketUrl } from "../storage";
import { recordUsage } from "../costMeter";
import { summarizeHttpBody } from "../_core/errorDetail";

/**
 * Host lip-sync on self-hosted LongCat-Video-Avatar-1.5 (Meituan) running as a RunPod
 * serverless worker — the third host lane, beside `heygen-lipsync.ts` and
 * `runpod-lipsync.ts`.
 *
 * Same contract as the other two (submit → taskId, poll → downloaded bytes) so
 * `resolveLipsyncLane` can hand any of them to a caller that knows none of them. What is
 * genuinely different from the InfiniteTalk lane, all of it measured on the first real
 * render (2026-09-08, job on endpoint f58uprisaijd8b):
 *
 * - GEOMETRY. InfiniteTalk renders 81-frame windows overlapping by `motion_frame` and the
 *   person can JUMP where a new window begins, which is why `lipsyncSeams.ts` exists.
 *   LongCat renders a 93-frame first segment then continues in +80-frame steps, re-rendering
 *   13 frames of context it then DISCARDS rather than blends. The join is the model's own
 *   reference-skip-attention. On the first render the segment-1→2 boundary (frames 92→93)
 *   was not visible at all, so seam repair is not merely unnecessary here — running
 *   InfiniteTalk's arithmetic over this clip would "repair" frames that are not joins.
 * - SIZE follows the INPUT IMAGE's aspect ratio, not a fixed preset: the pipeline buckets
 *   the request (`longcat_video/utils/bukcet_config.py`), so a 1.44:1 photo rendered
 *   1152x800. There is no exact 16:9 bucket at 720p — a 16:9 host plate lands on the 1.70
 *   bucket, 1248x736 — so assembly has to crop rather than assume the frame it asked for.
 *   The worker reports what it actually produced and this adapter passes that through.
 * - NEGATIVE PROMPTS DO NOTHING on the default path. `use_distill` forces text and audio
 *   guidance to 1.0, and guidance 1.0 skips the classifier-free pass entirely. The worker
 *   reports `negative_prompt_active` so a render that silently ignored one is visible.
 *   (The same trap as NAG-less negatives on InfiniteTalk's fast tier.)
 * - It is billed on GPU TIME, so like the InfiniteTalk lane this adapter meters its own
 *   usage from RunPod's `executionTime` rather than being wrapped by the per-output-second
 *   meter in `resolveLipsyncAdapter`. Abandoning a render is therefore expensive, and
 *   `cancelJob` is wired to `withSceneDeadline` and `cancelJobProviderRenders` for the same
 *   reason it is on the InfiniteTalk lane.
 *
 * Cost, measured, so nobody has to re-derive it: 696 GPU-seconds for 6.91 s of finished
 * 720p video = 100.7 GPU-s per finished second. On H100 PCIe at $4.79/h that is $0.134 per
 * finished second, against InfiniteTalk's measured $0.101 — i.e. this lane is currently
 * 33% DEARER at the same pixel count (1152x800 and 1280x720 are both 921,600 px). It is
 * opt-in for that reason: the case for it is picture quality, not price, until an INT8-vs-
 * bf16 comparison says otherwise.
 */

/** One host render: the still to animate, the narration it should speak, and how to shoot it. */
export interface LongcatLipsyncParams {
  /** Host photo or generated plate (R2 URL) — identity reference AND the frame's aspect. */
  imageUrl: string;
  /** Our own TTS narration (R2 URL). Drives the mouth and sizes the segment count. */
  audioUrl: string;
  /** LongCat is text-conditioned; unlike Avatar IV this is load-bearing. */
  prompt: string;
  /**
   * What the render must NOT do. Sent when set, but see the note above: it is INERT while
   * the distilled 8-step path is in use. Kept so turning distill off makes it live without
   * a payload change.
   */
  negativePrompt?: string;
  /** `480p` or `720p`. Not pixels: the worker buckets by the image's aspect ratio. */
  resolution: "480p" | "720p";
  /**
   * How many segments to render. Omitted, the worker derives it from the audio — which is
   * right in production and dangerous in testing, where a 82 s example track would render
   * 26 segments. The lane always sends it.
   */
  numSegments?: number;
  /** Weight precision. `false` loads the bf16 DiT, which needs an 80GB card. */
  useInt8?: boolean;
  /** `false` runs the undistilled 50-step path — ~6x the cost, and makes the negative bite. */
  useDistill?: boolean;
  /**
   * Scales the audio embedding before it reaches the DiT's audio cross-attention — how hard
   * the voice drives the face. The one real dial on mouth motion on this lane: prompt wording
   * is weak here because the distilled path pins both guidance scales to 1.0, and
   * `audio_guidance_scale` below 1.0 does nothing (the pipeline only runs a CFG pass above
   * it). Omitted, the worker uses 1.0 and renders as it always did.
   */
  audioScale?: number;
  /** Fixed seed for an A/B; omitted, the worker draws a new one per render. */
  seed?: number;
}

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";

/**
 * Frames per segment, and what a continuation adds. Mirrors `worker/geometry.py` in the
 * worker repo (Metropolis-Media/longcat) — these two numbers decide both the length of a
 * render and its price, so the caller has to agree with the worker about them.
 */
export const LONGCAT_FPS = 25;
export const LONGCAT_SEGMENT_FRAMES = 93;
/** 93 rendered − 13 re-rendered as context = 80 new frames, 3.2 s, per continuation. */
export const LONGCAT_NEW_FRAMES_PER_SEGMENT = 80;

/**
 * Segments needed to cover `seconds` of narration.
 *
 * Cost here is a STEP FUNCTION, not a rate: the first segment buys 3.72 s and each one after
 * buys 3.2 s, so a 3.8 s beat costs exactly what a 6.9 s beat costs. Worth knowing before
 * trimming a host beat to "save money" — below the next boundary it saves nothing at all.
 */
export function longcatSegmentsFor(seconds: number): number {
  const frames = Math.ceil(Math.max(0, seconds) * LONGCAT_FPS);
  if (frames <= LONGCAT_SEGMENT_FRAMES) return 1;
  return (
    1 +
    Math.ceil(
      (frames - LONGCAT_SEGMENT_FRAMES) / LONGCAT_NEW_FRAMES_PER_SEGMENT
    )
  );
}

/** Seconds of video `segments` segments produce, before the worker trims to the audio. */
export function longcatDurationFor(segments: number): number {
  const n = Math.max(1, segments);
  return (
    (LONGCAT_SEGMENT_FRAMES + (n - 1) * LONGCAT_NEW_FRAMES_PER_SEGMENT) /
    LONGCAT_FPS
  );
}

/**
 * Client-side poll ceiling for one render. Measured: 696 s for a 2-segment 720p beat on
 * H100 PCIe, so ~350 GPU-seconds per segment. A 10 s beat is 3 segments (~18 min) and
 * anything queued behind another scene waits through that too, hence the generous default.
 * `SCENE_DEADLINE_HOST_RUNPOD_MS` sits above this so the deadline never fires first.
 */
export const LONGCAT_LIPSYNC_TIMEOUT_MS = Number(
  process.env.LONGCAT_LIPSYNC_TIMEOUT_MS ?? 2_100_000 // 35 minutes
);

/**
 * Server-side cap sent with every submit as `policy.executionTimeout`. Same reasoning as the
 * InfiniteTalk lane: RunPod stops the job (and the billing) there whatever the endpoint's own
 * dashboard setting says, and a render killed at the cap must come back TERMINAL so the
 * resume path does not resubmit an identical job to be killed identically.
 */
export const LONGCAT_EXECUTION_TIMEOUT_MS = Number(
  process.env.LONGCAT_LIPSYNC_EXECUTION_TIMEOUT_MS ?? 2_400_000 // 40 minutes
);

/**
 * Whole-call ceiling. The completed `/status` response carries the whole MP4 as base64, so
 * it is a download in status-call clothing; a mid-body stall would otherwise park the scene
 * until its deadline, since the poll loop only re-checks its clock BETWEEN iterations.
 */
const CALL_TIMEOUT_MS = Number(
  process.env.LONGCAT_LIPSYNC_CALL_TIMEOUT_MS ?? 300_000
);
const callSignal = () => AbortSignal.timeout(CALL_TIMEOUT_MS);

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 5_000;

/**
 * In-flight cap, per endpoint. As on the InfiniteTalk lane this is not a vendor allowance —
 * RunPod accepts everything and queues the overflow — but a queued job's wait burns the poll
 * ceiling above while doing no work. Keep it at or a little above the endpoint's max workers.
 */
const _longcatSlots = new Map<string, Semaphore>();
export const longcatLipsyncSlotsFor = (endpointId: string): Semaphore => {
  let s = _longcatSlots.get(endpointId);
  if (!s)
    _longcatSlots.set(
      endpointId,
      (s = new Semaphore(ENV.longcatLipsyncConcurrency))
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

type LongcatOutput = {
  /** base64 MP4. */
  video?: string;
  /** The worker's own failure channel — a caught exception, on a job RunPod calls COMPLETED. */
  error?: string;
  /** What was ACTUALLY produced; size follows the input image's aspect, so never assume. */
  width?: number;
  height?: number;
  frames?: number;
  duration_sec?: number;
  segments?: number;
  steps?: number;
  seed?: number;
  /** False whenever the distilled path ran — see the negative-prompt note at the top. */
  negative_prompt_active?: boolean;
  /** Seconds to build the models. Always reported: it is what a worker shutdown costs. */
  load_seconds?: number;
  cold_start?: boolean;
  /** Per-stage seconds: `audio_embedding`, `segment_1`…, `encode`, `total`. */
  timings?: Record<string, number>;
};

type RunPodStatusBody = {
  status?: RunPodStatus;
  output?: LongcatOutput;
  error?: unknown;
  /** Billed GPU milliseconds — the metered quantity for this lane. */
  executionTime?: number;
  /** Queue wait in ms. Not billed, but worth logging when it dominates. */
  delayTime?: number;
};

export class LongcatLipsyncAdapter {
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
   * and `*.r2.dev` is DNS-blocked on a lot of networks (see `presignOwnBucketUrl`). Signatures
   * last an hour, which is why they are minted here at submit rather than persisted — a job
   * that sat in the queue that long has already blown its deadline.
   */
  async submitLipsync(
    params: LongcatLipsyncParams
  ): Promise<VideoSubmitResult> {
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
        resolution: params.resolution,
        ...(params.numSegments != null
          ? { num_segments: params.numSegments }
          : {}),
        ...(params.useInt8 != null ? { use_int8: params.useInt8 } : {}),
        ...(params.useDistill != null
          ? { use_distill: params.useDistill }
          : {}),
        ...(params.audioScale != null
          ? { audio_scale: params.audioScale }
          : {}),
        ...(params.seed != null ? { seed: params.seed } : {}),
      },
      policy: { executionTimeout: LONGCAT_EXECUTION_TIMEOUT_MS },
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
            error: `LongCat submit failed (${res.status}): ${summarizeHttpBody(errText, 200)}`,
          };
        }

        const data = (await res.json()) as { id?: string };
        if (!data.id) return { error: "LongCat submit returned no job id" };
        return { taskId: data.id };
      } catch (err: any) {
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
          continue;
        }
        return { error: `LongCat submit error: ${err?.message ?? err}` };
      }
    }
    return { error: "LongCat submit exhausted retries" };
  }

  /**
   * Poll one job to a terminal state and return the clip bytes.
   *
   * A timeout resolves `{ pending: true, taskId }` rather than failing, so the orchestrator
   * marks the scene "rendering" and a later resume downloads the finished job — the GPU time
   * is already spent either way.
   */
  async pollVideo(
    taskId: string,
    timeoutMs: number = LONGCAT_LIPSYNC_TIMEOUT_MS
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    let pollCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      // A render is minutes long, so the first check is unhurried and the cadence widens to
      // 30s — polling harder cannot make the GPU faster, and each completed poll drags the
      // whole MP4 down with it.
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
          // Unknown job id — includes a task id left over from another lane after a provider
          // swap, and a result RunPod has already aged out. Terminal: let the caller decide.
          return {
            success: false,
            taskId,
            error: "LongCat job not found (404) — it may have expired",
            infraFailure: true,
          };
        }
        if (!res.ok) {
          const errText = await res.text();
          console.warn(
            `[LongCat] Poll error (${res.status}): ${summarizeHttpBody(errText, 200)}`
          );
          await sleep(5_000);
          continue;
        }
        data = (await res.json()) as RunPodStatusBody;
      } catch (err: any) {
        console.warn(`[LongCat] Poll network error: ${err?.message ?? err}`);
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

        // Killed at the execution cap. The GPU time IS billed, so it is metered like a
        // success; and the failure is deterministic — the same beat renders the same
        // segments and is stopped at the same minute — so it is `terminal`, not
        // `infraFailure`: fail the scene with a reason rather than pay for it twice.
        if (data.status === "TIMED_OUT" || /executionTimeout/i.test(detail)) {
          const gpuSeconds = this.meterGpuTime(data);
          const minutes = Math.round(gpuSeconds / 60);
          console.error(
            `[LongCat] Job ${taskId} stopped at the execution cap after ${minutes} min of GPU — ` +
              `not resubmitting (the same render would be stopped at the same point)`
          );
          return {
            success: false,
            taskId,
            terminal: true,
            error:
              `LongCat stopped this render at its execution cap after ${minutes} min of GPU time. ` +
              `Measured cost is ~350 GPU-seconds per segment at 720p, and a beat's segment count ` +
              `is a step function of its length (3.72s, then +3.2s each) — so shorten the host beat ` +
              `past a segment boundary, render at 480p (LONGCAT_RESOLUTION), move the endpoint to a ` +
              `faster GPU, or raise LONGCAT_LIPSYNC_EXECUTION_TIMEOUT_MS.`,
          };
        }

        // CANCELLED is a decision, not a fault: the app cancels a render it has given up on
        // (`withSceneDeadline`) and an operator can cancel from the dashboard. Treating it as
        // an infrastructure failure would resubmit a render nobody is waiting for.
        if (data.status === "CANCELLED") {
          console.log(
            `[LongCat] Job ${taskId} was cancelled — not resubmitting`
          );
          return {
            success: false,
            taskId,
            terminal: true,
            error: `LongCat job was cancelled (${detail.slice(0, 200)})`,
          };
        }

        // A worker killed by the CUDA arch mismatch lands here rather than in the handler's
        // own error channel, because the process dies instead of returning. Name it: the
        // symptom ("no kernel image is available") reads like a broken build when it is
        // actually the endpoint scheduling onto a GPU the image was not compiled for.
        if (/no kernel image is available/i.test(detail)) {
          return {
            success: false,
            taskId,
            terminal: true,
            error:
              `LongCat worker has no CUDA kernels for the GPU it was scheduled on. The image is ` +
              `built for Ampere/Ada/Hopper (sm_80-90); Blackwell cards (RTX 5090, B200, RTX PRO ` +
              `6000) need a cu128 rebuild. Restrict the endpoint's enabled GPU types. (${detail.slice(0, 160)})`,
          };
        }

        console.log(
          `[LongCat] Job ${taskId} terminal: ${detail.slice(0, 300)}`
        );
        return {
          success: false,
          taskId,
          error: `LongCat job ${data.status}: ${detail.slice(0, 500)}`,
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
   * This lane bills the GPU for as long as a job runs, and our poll ceiling giving up does
   * NOT stop it — a wedged render burns on until the endpoint's execution timeout. Only for
   * a scene abandoned for GOOD: a poll timeout deliberately does not call this, because that
   * path returns `pending` precisely so a resume can collect a render already paid for.
   *
   * Never throws. Cancelling is an optimisation; failing to cancel is the behaviour that
   * existed before it.
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
        `[LongCat] cancel ${taskId}: ${res.ok ? "accepted" : `HTTP ${res.status}`}`
      );
    } catch (err: any) {
      console.warn(`[LongCat] cancel ${taskId} failed: ${err?.message ?? err}`);
    }
  }

  /**
   * Turn a COMPLETED job into bytes, and meter what it cost.
   *
   * A handler-level failure arrives HERE, not as a FAILED job: the worker catches its own
   * exceptions and returns `{ error }` from a job RunPod considers successful. Only a dead
   * worker produces a FAILED status.
   */
  private finish(
    taskId: string,
    data: RunPodStatusBody,
    startTime: number,
    pollCount: number
  ): GenerationResult {
    const out = data.output ?? {};

    if (out.error) {
      // Metered even though it failed: the worker ran on the GPU to get here.
      this.meterGpuTime(data);
      return {
        success: false,
        taskId,
        error: `LongCat worker error: ${String(out.error).slice(0, 500)}`,
        infraFailure: true,
      };
    }

    if (!out.video) {
      this.meterGpuTime(data);
      return {
        success: false,
        taskId,
        error: `LongCat completed with no video in its output (keys: ${Object.keys(out).join(", ") || "none"})`,
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
        error: `LongCat returned an undecodable clip: ${err?.message ?? err}`,
        infraFailure: true,
      };
    }
    if (fileData.length === 0) {
      return {
        success: false,
        taskId,
        error: "LongCat returned an empty clip",
        infraFailure: true,
      };
    }

    const gpuSeconds = this.meterGpuTime(data);

    // The one number worth watching per render: GPU seconds bought per second of film. It is
    // how this lane is compared with InfiniteTalk (measured 100.7 on its first 720p render),
    // and a change in it is the first sign a dial or a GPU tier moved underneath us.
    const perFinishedSecond =
      out.duration_sec && out.duration_sec > 0
        ? gpuSeconds / out.duration_sec
        : 0;

    console.log(
      `[LongCat] Job ${taskId} completed — ${(fileData.length / 1024 / 1024).toFixed(1)}MB | ` +
        `${out.duration_sec?.toFixed(2) ?? "?"}s of video (${out.frames ?? "?"} frames, ` +
        `${out.segments ?? "?"} segments, ${out.width ?? "?"}x${out.height ?? "?"}) | ` +
        `gpu ${gpuSeconds.toFixed(0)}s = ${perFinishedSecond.toFixed(1)} GPU-s per finished s | ` +
        `queue ${Math.round((data.delayTime ?? 0) / 1000)}s | ` +
        `wall ${Math.round((Date.now() - startTime) / 1000)}s | polls ${pollCount}` +
        (out.load_seconds ? ` | model load ${out.load_seconds}s` : "") +
        (out.timings
          ? ` | worker ${Object.entries(out.timings)
              .map(([k, v]) => `${k} ${v}s`)
              .join(", ")}`
          : "")
    );

    // Loud, because it is silent otherwise and it invalidates any conclusion drawn from the
    // negative wording of a render: the distilled path runs at guidance 1.0, which skips the
    // classifier-free pass the negative prompt would have steered.
    if (out.negative_prompt_active === false) {
      console.warn(
        `[LongCat] Job ${taskId}: negative prompt was NOT applied (distilled 8-step path runs ` +
          `at guidance 1.0). Judge negative wording only with use_distill=false.`
      );
    }

    return {
      success: true,
      fileData,
      mimeType: "video/mp4",
      taskId,
      gpuSeconds,
      workerTimings: out.timings,
    };
  }

  /**
   * Meter what RunPod says a job cost, in seconds. RunPod bills the GPU time it reports, not
   * the wall clock we waited (which includes queueing) and not the seconds of video produced.
   * Recorded for a success, for a worker-level error, and for a render stopped at the
   * execution cap — all three are billed in full.
   */
  private meterGpuTime(data: RunPodStatusBody): number {
    const gpuSeconds = (data.executionTime ?? 0) / 1000;
    if (gpuSeconds > 0) {
      recordUsage({
        lane: "lipsync",
        provider: "longcat",
        model: "longcat-avatar-1.5",
        calls: 1,
        quantity: gpuSeconds,
      });
    }
    return gpuSeconds;
  }

  /**
   * Cheap reachability probe — used by the boot log so a missing or mistyped endpoint id
   * surfaces before the first host scene, not during one.
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
          message: `LongCat health check failed (${res.status})`,
        };
      return { success: true, message: "LongCat endpoint reachable" };
    } catch (err: any) {
      return {
        success: false,
        message: `LongCat health check error: ${err?.message ?? err}`,
      };
    }
  }
}

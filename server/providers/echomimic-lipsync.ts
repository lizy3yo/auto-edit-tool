import type { GenerationResult } from "../../shared/types";
import type { VideoSubmitResult } from "./base";
import { sleep } from "./base";
import { Semaphore } from "./semaphore";
import { ENV } from "../_core/env";
import { presignPut } from "../storage";

/**
 * EchoMimicV3 host lip-sync, self-hosted on RunPod serverless — the cheap lane.
 * Selected with `LIPSYNC_PROVIDER=echomimic`; the worker lives in
 * `runpod/echomimic-worker/` (there is no public prebuilt image for this model).
 *
 * Why the shape differs from the HeyGen and fal adapters: those hand back a provider URL we
 * download and re-upload. RunPod's response payload is the wrong place for several MB of mp4,
 * so instead we mint a presigned R2 PUT up front and the worker uploads straight into our
 * bucket. `pollVideo` therefore resolves with `fileUrl` (already in R2) and no `fileData` —
 * `runChunkTasks` takes that branch and skips the pointless download-then-reupload, which on a
 * 40-host-scene film saves a few hundred MB of round trip.
 *
 * The submit/poll split is deliberately identical to the other lanes so the RunPod job id
 * lands in `scene.renderTaskIds` and a crash, poll timeout, or watchdog sweep resumes the
 * already-running (already-billed) render instead of re-submitting.
 */

const RUNPOD_BASE = "https://api.runpod.ai/v2";

/**
 * The model renders a SQUARE frame and tops out at 768×768 — it cannot produce 16:9 or 1080p.
 * `hostFrame.ts` is what turns that square into a 1080p 16:9 delivery frame; this constant is
 * the contract between the two.
 */
export const ECHOMIMIC_SIZE = Number(process.env.ECHOMIMIC_SIZE ?? 768);

/**
 * Longest narration one render can cover. Standard inference caps at 138 frames, which at
 * 25fps is 5.52s — BELOW this pipeline's 8s host-scene ceiling (`LONG_SCENE_MAX_SEC`), so a
 * share of host scenes genuinely will not fit. Rejecting locally beats paying for the
 * failure; the operator's fix is to lower the scene ceiling or enable long-video mode on the
 * worker (see runpod/echomimic-worker/README.md).
 */
export const ECHOMIMIC_MAX_AUDIO_SEC = Number(
  process.env.ECHOMIMIC_MAX_AUDIO_SEC ?? 5.4
);

/** Client-side poll ceiling for one render, including RunPod queue time. */
export const ECHOMIMIC_TIMEOUT_MS = Number(
  process.env.ECHOMIMIC_TIMEOUT_MS ?? 900_000
);

const CALL_TIMEOUT_MS = Number(
  process.env.ECHOMIMIC_CALL_TIMEOUT_MS ?? 120_000
);
const callSignal = () => AbortSignal.timeout(CALL_TIMEOUT_MS);

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 4_000;

const retryDelay = (attempt: number): number =>
  Math.min(
    BASE_RETRY_DELAY_MS * Math.pow(2, attempt) +
      Math.floor(Math.random() * 2000),
    30_000
  );

/**
 * In-flight cap. Unlike HeyGen (per-account limit) or fal (spend governor) this one is
 * physical: it should mirror the endpoint's **max workers** setting. Submitting far past that
 * just grows RunPod's queue, which burns the poll ceiling rather than any real throughput.
 */
let _slots: Semaphore | null = null;
export const echomimicSlots = (): Semaphore =>
  (_slots ??= new Semaphore(ENV.echomimicConcurrency));

/** Square region of the plate the model animates. Mirrors `HostBox` in `hostFrame.ts`. */
export interface EchomimicBox {
  x: number;
  y: number;
  size: number;
}

export interface EchomimicParams {
  /**
   * The FULL 1920×1080 contextual plate — not a pre-cut square. The worker runs RetinaFace
   * over it to find where the image model actually put the host and crops there. Sending the
   * whole plate is precisely what makes that possible; a pre-cut square would have baked the
   * guess in already.
   */
  plateUrl: string;
  /** Narration for this scene. */
  audioUrl: string;
  /** Measured narration length — drives the local over-length guard. */
  durationSec?: number;
  /** R2 key the finished mp4 should land on. */
  outputKey: string;
  /** Where to crop when no face is found — the old fixed-box behaviour, as a floor. */
  fallbackBox: EchomimicBox;
}

/**
 * `pollVideo`'s result widened with the box the worker actually cut from. Deliberately local
 * rather than pushed onto the shared `GenerationResult`: only this lane has a box, and the
 * lane wrapper in `resolveLipsyncAdapter` consumes it and returns a plain result upward.
 */
export type EchomimicResult = GenerationResult & {
  box?: EchomimicBox;
  /** False ⇒ detection failed and `fallbackBox` was used. */
  detected?: boolean;
};

type RunpodStatus = {
  status?: string;
  output?: {
    ok?: boolean;
    error?: string;
    gpu_seconds?: number;
    seconds?: number;
    box?: EchomimicBox;
    detected?: boolean;
  };
  error?: string;
};

/** RunPod's terminal non-success states (same set `voiceTranscription.ts` treats as fatal). */
const TERMINAL_FAILURES = new Set(["FAILED", "CANCELLED", "TIMED_OUT"]);

export class EchomimicLipsyncAdapter {
  private apiKey: string;
  private endpoint: string;
  /** Filled at submit time so `pollVideo` knows where the worker put the file. */
  private urlByJob = new Map<string, string>();

  constructor(
    apiKey: string = ENV.runPodApiKey,
    endpoint: string = ENV.runpodEchomimicEndpoint
  ) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
  }

  private base(): string {
    return `${RUNPOD_BASE}/${this.endpoint}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Mint the presigned upload, submit the job, and return RunPod's job id as `taskId`.
   * Returns `{ error }` rather than throwing — a submit failure is a scene-level problem, not
   * a pipeline crash.
   */
  async submitLipsync(params: EchomimicParams): Promise<VideoSubmitResult> {
    if (!this.endpoint)
      return { error: "RUNPOD_ECHOMIMIC_ENDPOINT is not set" };
    if (params.durationSec && params.durationSec > ECHOMIMIC_MAX_AUDIO_SEC) {
      return {
        error:
          `Narration is ${params.durationSec.toFixed(1)}s but EchoMimicV3 standard inference ` +
          `covers at most ${ECHOMIMIC_MAX_AUDIO_SEC}s. Lower LONG_SCENE_MAX_SEC or enable ` +
          `long-video mode on the worker.`,
      };
    }

    let uploadUrl: string;
    let publicUrl: string;
    try {
      ({ uploadUrl, publicUrl } = await presignPut(
        params.outputKey,
        "video/mp4"
      ));
    } catch (err: any) {
      return { error: `presign failed: ${err?.message ?? err}` };
    }

    const body = JSON.stringify({
      input: {
        plate_url: params.plateUrl,
        audio_url: params.audioUrl,
        upload_url: uploadUrl,
        fallback_box: {
          x: params.fallbackBox.x,
          y: params.fallbackBox.y,
        },
        prompt: "A person is speaking to the camera.",
        steps: ENV.echomimicSteps,
        size: ECHOMIMIC_SIZE,
        fps: 25,
      },
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${this.base()}/run`, {
          method: "POST",
          headers: this.headers(),
          body,
          signal: callSignal(),
        });
        if (!res.ok) {
          const text = await res.text();
          if (
            (res.status === 429 || res.status >= 500) &&
            attempt < MAX_RETRIES
          ) {
            await sleep(retryDelay(attempt));
            continue;
          }
          return {
            error: `RunPod submit failed (${res.status}): ${text.substring(0, 400)}`,
          };
        }
        const data = (await res.json()) as { id?: string };
        if (!data.id) return { error: "RunPod returned no job id" };
        this.urlByJob.set(data.id, publicUrl);
        console.log(`[EchoMimic] submitted ${data.id} → ${params.outputKey}`);
        return { taskId: data.id };
      } catch (err: any) {
        const networkish =
          /terminated|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|abort|closed/i.test(
            err?.message ?? ""
          );
        if (attempt < MAX_RETRIES && networkish) {
          await sleep(retryDelay(attempt));
          continue;
        }
        return { error: err?.message ?? "Unknown RunPod submit error" };
      }
    }
    return { error: "RunPod submit failed after retries" };
  }

  /**
   * Poll `GET /status/{id}` to a terminal state. On success the mp4 is already in R2 (the
   * worker PUT it), so this returns `resultUrl` rather than bytes.
   *
   * `expectedUrl` lets a RESUMED poll — a fresh process with an empty `urlByJob` — say where
   * the file was destined. Without it a watchdog resume would complete and have nowhere to
   * point.
   */
  async pollVideo(
    taskId: string,
    timeoutMs: number = ECHOMIMIC_TIMEOUT_MS,
    expectedUrl?: string
  ): Promise<EchomimicResult> {
    const start = Date.now();
    let delay = 4_000;

    while (Date.now() - start < timeoutMs) {
      await sleep(delay);
      delay = Math.min(delay * 1.4, 20_000);

      try {
        const res = await fetch(`${this.base()}/status/${taskId}`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: callSignal(),
        });

        if (res.status === 429) {
          await sleep(10_000);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          // A bad RUN_POD_KEY is not fixed by re-submitting, so no infraFailure.
          return {
            success: false,
            taskId,
            error: `RunPod rejected the API key (${res.status})`,
          };
        }
        if (res.status === 404) {
          return {
            success: false,
            taskId,
            error: "RunPod job not found (expired or wrong endpoint)",
            infraFailure: true,
          };
        }
        if (!res.ok) {
          await sleep(5_000);
          continue;
        }

        const body = (await res.json()) as RunpodStatus;
        const status = body.status ?? "";

        if (TERMINAL_FAILURES.has(status)) {
          return {
            success: false,
            taskId,
            error: `RunPod job ${status}: ${body.error ?? body.output?.error ?? "no detail"}`,
            infraFailure: true,
          };
        }
        if (status !== "COMPLETED") continue; // IN_QUEUE / IN_PROGRESS

        // COMPLETED means the worker returned — not that it succeeded. Our handler reports
        // its own failures in `output.error` with a 200.
        const out = body.output ?? {};
        if (out.error || !out.ok) {
          return {
            success: false,
            taskId,
            error: `EchoMimic worker error: ${out.error ?? "handler reported failure"}`,
            infraFailure: true,
          };
        }

        const url = this.urlByJob.get(taskId) ?? expectedUrl;
        if (!url) {
          return {
            success: false,
            taskId,
            error:
              "EchoMimic render completed but the destination URL is unknown (resumed " +
              "without an expectedUrl)",
            infraFailure: true,
          };
        }
        this.urlByJob.delete(taskId);
        const ratio =
          out.gpu_seconds && out.seconds
            ? (out.gpu_seconds / out.seconds).toFixed(0)
            : "?";
        console.log(
          `[EchoMimic] ${taskId} done — ${out.gpu_seconds ?? "?"}s GPU for ${out.seconds ?? "?"}s video ` +
            `(${ratio}× realtime, box ${out.detected ? "detected" : "FALLBACK"})`
        );
        return {
          success: true,
          fileUrl: url,
          mimeType: "video/mp4",
          taskId,
          box: out.box,
          detected: out.detected,
        };
      } catch (err: any) {
        console.warn(`[EchoMimic] poll error: ${err?.message ?? err}`);
        await sleep(5_000);
      }
    }

    return {
      success: false,
      pending: true,
      taskId,
      error: `Client timed out after ${Math.round(timeoutMs / 1000)}s; the render may still be running on RunPod.`,
    };
  }

  /** Endpoint health for the admin panel: true when RunPod answers for this endpoint. */
  async checkEndpoint(): Promise<boolean | null> {
    if (!this.endpoint || !this.apiKey) return null;
    try {
      const res = await fetch(`${this.base()}/health`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 401 || res.status === 403) return false;
      return res.ok;
    } catch {
      return null;
    }
  }
}

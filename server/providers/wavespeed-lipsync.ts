import type { GenerationResult } from "../../shared/types";
import type { VideoSubmitResult } from "./base";
import { sleep } from "./base";
import { Semaphore } from "./semaphore";
import { ENV } from "../_core/env";

/**
 * WaveSpeedAI InfiniteTalk host lip-sync — selected with `LIPSYNC_PROVIDER=wavespeed`.
 *
 * Same still + audio shape as HeyGen Avatar IV and fal OmniHuman, so it drops into the
 * `LipsyncLane` contract with no pipeline changes. Three things distinguish it:
 *
 *  - **Long renders.** Up to 10 minutes in one call, so this pipeline's 8s host-scene
 *    ceiling never comes near a limit. (EchoMimicV3's 5.5s cap was what forced
 *    `HOST_SCENE_MAX_SEC`; nothing like that is needed here.)
 *  - **720p ceiling.** Not 1080p. Assembly upscales 1280×720 → 1920×1080, a 1.5× stretch —
 *    softer than HeyGen's native 1080p, though far gentler than a 768² square's 2.5×.
 *  - **5-second minimum charge.** A 4s host beat still bills as 5s, so short scenes are
 *    proportionally more expensive than the per-second rate suggests.
 *
 * InfiniteTalk is built for long-form identity consistency, which is precisely where the
 * self-hosted EchoMimicV3 experiment failed (visible identity drift inside a single 3s clip).
 * That is the property worth judging it on.
 */

const WAVESPEED_BASE = "https://api.wavespeed.ai/api/v3";

type WavespeedModelSpec = {
  /** Endpoint path under /api/v3. */
  id: string;
  /**
   * Documented ceiling on input audio for one render. Host scenes cap at
   * `LONG_SCENE_MAX_SEC` (8s), so neither model is remotely constrained — but a submit past
   * the limit is a billed rejection, so it is checked locally.
   */
  maxAudioSec: number;
  label: string;
  /**
   * Whether the endpoint accepts a `resolution` field. InfiniteTalk Fast does NOT — its schema
   * is image/audio/mask_image/prompt/seed only, and it bills a flat $0.015/s with no tiers.
   * Sending an undocumented field risks a 422 on a submit we would still be billed for.
   */
  supportsResolution: boolean;
};

/**
 * The WaveSpeed still+audio models. Both take an identical input shape and share the
 * predictions protocol, so switching between them is a model id and a duration ceiling —
 * nothing else. `WAVESPEED_MODEL` picks one.
 */
export const WAVESPEED_MODELS: Record<string, WavespeedModelSpec> = {
  /**
   * MeiGen InfiniteTalk — built for unlimited-length talking video holding identity across the
   * whole take, which is the property that matters for a host appearing in ~40 scenes.
   */
  infinitetalk: {
    id: "wavespeed-ai/infinitetalk",
    maxAudioSec: 600,
    label: "InfiniteTalk",
    supportsResolution: true,
  },
  /**
   * InfiniteTalk Fast — **$0.015/s, roughly a quarter of HeyGen**, and the only option here
   * that is materially cheaper rather than at parity. Same photo+audio inputs and the same
   * 10-minute ceiling as standard InfiniteTalk.
   *
   * The catch is in the name: "fast" variants buy speed and price with fewer sampling steps,
   * so expect softer detail and less stable identity than the standard model. Whether that
   * matters is exactly the thing to A/B — at this rate a whole film's host lane is ~$6
   * against HeyGen's ~$28.
   *
   * Wall time runs ~10–30s per second of video, so an 8s host beat is 1.5–4 minutes; the
   * per-key semaphore is what keeps that from serialising a film.
   */
  "infinitetalk-fast": {
    id: "wavespeed-ai/infinitetalk-fast",
    maxAudioSec: 600,
    label: "InfiniteTalk Fast",
    /**
     * `resolution` is absent from its documented schema, and the playground reports a
     * **576x384** output — a third of 720p's height, i.e. a 3.3x upscale onto the 1080p canvas.
     *
     * `WAVESPEED_FAST_RESOLUTION=1` sends the field anyway, on the chance it is merely
     * undocumented rather than unsupported. Three possible outcomes: honoured (720p at a
     * quarter of standard's price — the good case), silently ignored (still 576x384), or a 422.
     * One clip plus `ffprobe` settles it; none of WaveSpeed's landing, model or API pages state
     * an output size at all.
     */
    supportsResolution: !!process.env.WAVESPEED_FAST_RESOLUTION,
  },
  /**
   * Tencent HunyuanVideo-Avatar. Benchmarks above EchoMimic v1/v2 and Hallo-3 on audio-driven
   * portrait animation, and produces more head motion and expression than InfiniteTalk — which
   * cuts both ways for a calm seated host. Same price; a 2-minute ceiling instead of 10.
   */
  hunyuan: {
    id: "wavespeed-ai/hunyuan-avatar",
    maxAudioSec: 120,
    label: "Hunyuan Avatar",
    supportsResolution: true,
  },
};

/** The model this process renders on. Unknown ids fall back to InfiniteTalk. */
export const wavespeedModel = (): WavespeedModelSpec =>
  WAVESPEED_MODELS[ENV.wavespeedModel] ?? WAVESPEED_MODELS.infinitetalk;

/** `480p` (~$0.03/s) or `720p` (~$0.06/s). 720p is the ceiling. */
export const wavespeedResolution = (): string =>
  ENV.wavespeedResolution === "480p" ? "480p" : "720p";

/** Client-side poll ceiling for one render, including queue time. */
export const WAVESPEED_TIMEOUT_MS = Number(
  process.env.WAVESPEED_TIMEOUT_MS ?? 900_000
);

const CALL_TIMEOUT_MS = Number(
  process.env.WAVESPEED_CALL_TIMEOUT_MS ?? 120_000
);
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.WAVESPEED_DOWNLOAD_TIMEOUT_MS ?? 300_000
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
 * In-flight cap PER KEY — same per-account shape as `heygenSlotsFor`/`falSlotsFor`, so the
 * 5 long-form tabs each get their own budget and tabs sharing a key correctly share one
 * semaphore. A spend governor: every slot is a billed render.
 */
const _slots = new Map<string, Semaphore>();
export const wavespeedSlotsFor = (apiKey: string): Semaphore => {
  let s = _slots.get(apiKey);
  if (!s) _slots.set(apiKey, (s = new Semaphore(ENV.wavespeedConcurrency)));
  return s;
};

export interface WavespeedLipsyncParams {
  /** Host photo (R2 public URL). WaveSpeed fetches it server-side. */
  imageUrl: string;
  /** Our own TTS narration (R2 public URL) — the audio IS the script. */
  audioUrl: string;
  /** Measured narration length, for the local over-length guard. */
  durationSec?: number;
}

/** Terminal non-success states from the documented status set. */
const TERMINAL_FAILURES = new Set(["failed", "cancelled", "timeout"]);

type PredictionData = {
  id?: string;
  status?: string;
  outputs?: string[];
  error?: string;
  timings?: { inference?: number };
};

export class WavespeedLipsyncAdapter {
  private apiKey: string;
  private model: WavespeedModelSpec;

  constructor(apiKey: string, model: WavespeedModelSpec = wavespeedModel()) {
    this.apiKey = apiKey;
    this.model = model;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Submit one render and return the prediction id as `taskId`, so it lands in
   * `scene.renderTaskIds` and a crash, poll timeout, or watchdog sweep resumes the
   * already-running (already-billed) render instead of re-submitting.
   */
  async submitLipsync(
    params: WavespeedLipsyncParams
  ): Promise<VideoSubmitResult> {
    if (params.durationSec && params.durationSec > this.model.maxAudioSec) {
      return {
        error: `Narration is ${params.durationSec.toFixed(1)}s but ${this.model.label} accepts at most ${this.model.maxAudioSec}s`,
      };
    }

    const body = JSON.stringify({
      image: params.imageUrl,
      audio: params.audioUrl,
      // Only where the endpoint documents it — see `supportsResolution`.
      ...(this.model.supportsResolution
        ? { resolution: wavespeedResolution() }
        : {}),
      // No prompt: host beats are "seated host talks to camera", and a motion prompt is what
      // makes these models gesticulate. Same reasoning as HeyGen's `expressiveness: "low"`.
      seed: -1,
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${WAVESPEED_BASE}/${this.model.id}`, {
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
            error: `WaveSpeed API error (${res.status}): ${text.substring(0, 400)}`,
          };
        }
        const body2 = (await res.json()) as {
          code?: number;
          message?: string;
          data?: PredictionData;
        };
        // A 200 can still carry a business-level rejection in the envelope.
        if (body2.code && body2.code !== 200) {
          return {
            error: `WaveSpeed rejected the task: ${body2.message ?? "unknown"}`,
          };
        }
        const id = body2.data?.id;
        if (!id) return { error: "WaveSpeed returned no prediction id" };
        console.log(`[WaveSpeed] ${this.model.label} submitted: ${id}`);
        return { taskId: id };
      } catch (err: any) {
        const networkish =
          /terminated|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|abort|closed/i.test(
            err?.message ?? ""
          );
        if (attempt < MAX_RETRIES && networkish) {
          await sleep(retryDelay(attempt));
          continue;
        }
        return { error: err?.message ?? "Unknown WaveSpeed submit error" };
      }
    }
    return { error: "WaveSpeed submit failed after retries" };
  }

  /**
   * Poll a prediction to a terminal state and download the result. Returns
   * `{ pending: true }` on client timeout (the id stays persisted for resume); a failed
   * render and an unknown/404 id — e.g. a stale HeyGen taskId resumed after a provider swap
   * — return `infraFailure: true` so the orchestrator clears the ids and re-submits fresh.
   */
  async pollVideo(
    taskId: string,
    timeoutMs: number = WAVESPEED_TIMEOUT_MS
  ): Promise<GenerationResult> {
    const start = Date.now();
    let delay = 4_000;

    while (Date.now() - start < timeoutMs) {
      await sleep(delay);
      delay = Math.min(delay * 1.4, 20_000);

      try {
        const res = await fetch(
          `${WAVESPEED_BASE}/predictions/${taskId}/result`,
          {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            signal: callSignal(),
          }
        );

        if (res.status === 429) {
          await sleep(10_000);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          // A bad key is not fixed by re-submitting, so no infraFailure.
          return {
            success: false,
            taskId,
            error: `WaveSpeed rejected the API key (${res.status})`,
          };
        }
        if (res.status === 404) {
          return {
            success: false,
            taskId,
            error: "WaveSpeed prediction not found (expired or unknown id)",
            infraFailure: true,
          };
        }
        if (!res.ok) {
          await sleep(5_000);
          continue;
        }

        const data = ((await res.json()) as { data?: PredictionData }).data;
        if (!data) continue;
        const status = (data.status ?? "").toLowerCase();

        if (TERMINAL_FAILURES.has(status)) {
          return {
            success: false,
            taskId,
            error: `WaveSpeed render ${status}: ${data.error || "no detail"}`,
            infraFailure: true,
          };
        }
        if (status !== "completed") continue; // created / processing

        const url = data.outputs?.[0];
        if (!url) {
          return {
            success: false,
            taskId,
            error: "WaveSpeed completed but returned no output url",
            infraFailure: true,
          };
        }

        console.log(
          `[WaveSpeed] ${taskId} completed — wall ${Math.round((Date.now() - start) / 1000)}s` +
            (data.timings?.inference
              ? `, inference ${data.timings.inference}ms`
              : "")
        );
        const dl = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
        if (!dl.ok) {
          return {
            success: false,
            taskId,
            error: `WaveSpeed download failed (${dl.status})`,
            infraFailure: true,
          };
        }
        return {
          success: true,
          fileData: Buffer.from(await dl.arrayBuffer()),
          mimeType: "video/mp4",
          taskId,
        };
      } catch (err: any) {
        console.warn(`[WaveSpeed] poll error: ${err?.message ?? err}`);
        await sleep(5_000);
      }
    }

    return {
      success: false,
      pending: true,
      taskId,
      error: `Client timed out after ${Math.round(timeoutMs / 1000)}s; the render may still be running on WaveSpeed.`,
    };
  }

  /**
   * Key health for the admin panel. WaveSpeed exposes no public balance endpoint, so this
   * asks for a prediction id that cannot exist: a live key gets 404, a dead one 401/403.
   * Null when the probe itself fails — unknown, not invalid.
   */
  async checkKey(): Promise<boolean | null> {
    try {
      const res = await fetch(
        `${WAVESPEED_BASE}/predictions/00000000-0000-0000-0000-000000000000/result`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          // 8s, not the render budget: the admin page batches every query into one request,
          // so a slow probe here stalls the whole Provider Keys panel.
          signal: AbortSignal.timeout(8_000),
        }
      );
      if (res.status === 401 || res.status === 403) return false;
      if (res.status === 404 || res.ok) return true;
      return null;
    } catch {
      return null;
    }
  }
}

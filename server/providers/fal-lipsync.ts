import { createHash } from "crypto";
import type { GenerationResult } from "../../shared/types";
import type { VideoSubmitResult } from "./base";
import { sleep } from "./base";
import { Semaphore } from "./semaphore";
import { ENV } from "../_core/env";

/**
 * fal.ai queue host. Every model on fal is reachable at `{FAL_QUEUE_BASE}/{endpoint id}`; the
 * synchronous `fal.run` host exists too but has a short request ceiling and no resume, so this
 * adapter only ever uses the queue.
 *
 * `FAL_QUEUE_BASE` overrides it so the whole host lane can be pointed at `scripts/fal-stub.mjs`
 * — a local server that speaks fal's queue protocol and renders a real (unsynced) clip from the
 * same photo + audio. That exercises submit → poll → webhook → download → R2 → assembly end to
 * end for $0. fal's own signup credits are Playground/Sandbox-only and cannot be spent through
 * the API, so a local stub is the ONLY way to integration-test this lane without billing.
 */
const FAL_QUEUE_BASE = (
  process.env.FAL_QUEUE_BASE ?? "https://queue.fal.run"
).replace(/\/+$/, "");

// Loud on purpose: a stray FAL_QUEUE_BASE in a real environment silently renders every host
// scene as stub footage, and the films look *almost* right — the failure would ship.
if (FAL_QUEUE_BASE !== "https://queue.fal.run")
  console.warn(
    `[fal] ⚠ FAL_QUEUE_BASE is overridden to ${FAL_QUEUE_BASE} — host scenes are NOT rendering on fal.ai`
  );

/**
 * fal's queue ROUTES hang off the model's APP id — the first two path segments — while the
 * SUBMIT goes to the full endpoint path. `fal-ai/bytedance/omnihuman/v1.5` is submitted at
 * `/fal-ai/bytedance/omnihuman/v1.5` but polled at `/fal-ai/bytedance/requests/{id}/status`,
 * exactly as fal's own `fal-ai/flux/dev` polls under `/fal-ai/flux`. Getting this wrong 404s
 * every poll while the render bills anyway, so `submitLipsync` also remembers the absolute
 * `response_url` fal hands back and prefers it (see `_responseUrlById`).
 */
export const falQueueApp = (modelId: string): string =>
  modelId.split("/").slice(0, 2).join("/");

/**
 * One host lip-sync render: the host still + the narration audio it should speak. Same shape as
 * `LipsyncParams` in the HeyGen adapter plus `durationSec`, which models that size their render
 * in FRAMES (InfiniTalk) need and models that simply follow the audio (OmniHuman) ignore.
 */
export interface FalLipsyncParams {
  /** Host photo (R2 public URL). fal fetches it server-side, so it must be publicly reachable. */
  imageUrl: string;
  /** Our own TTS narration (R2 public URL). fal has no TTS in this path — the audio IS the script. */
  audioUrl: string;
  /** Measured narration length. Used for frame-count models and the local over-length guard. */
  durationSec?: number;
}

type FalModelSpec = {
  /** Full endpoint id, i.e. the submit path. */
  id: string;
  /**
   * Hard ceiling on input audio at the settings we submit. Host scenes cap at
   * `LONG_SCENE_MAX_SEC` (8s), so this is a guard against a future re-chunking, not a live
   * constraint — but a submit over the limit is a paid 422, so it is rejected locally.
   */
  maxAudioSec: number;
  build(p: FalLipsyncParams): Record<string, unknown>;
};

/**
 * The fal models that take a STILL + AUDIO and return a talking host — the drop-in shape for
 * HeyGen Avatar IV. Lip-sync models that need an existing VIDEO (`fal-ai/sync-lipsync`,
 * `fal-ai/veed/lipsync`) are deliberately absent: this lane only ever has a photo.
 *
 * Unlike HeyGen there is NO avatar registration step — no `POST /avatars`, no group-ready
 * poll, no per-account avatar cache, and so no "missing image dimensions" retry window. The
 * photo URL goes straight into the render call, which is why this adapter is roughly half the
 * size of the HeyGen one.
 */
export const FAL_LIPSYNC_MODELS: Record<string, FalModelSpec> = {
  /**
   * ByteDance OmniHuman 1.5 — the recommended default. Renders 1080p natively (30s audio
   * ceiling; 60s at 720p) and, like Avatar IV, INHERITS the gaze and framing of the still it
   * animates, so the alt-angle host photo keeps working as the "camera" knob with no extra
   * parameter. Billed per second of OUTPUT, and the output is the length of the audio.
   */
  omnihuman: {
    id: "fal-ai/bytedance/omnihuman/v1.5",
    maxAudioSec: 30,
    build: p => ({
      image_url: p.imageUrl,
      audio_url: p.audioUrl,
      resolution: "1080p",
      // No prompt: the storyboard's host beats are "seated host talks to camera", and a motion
      // prompt is what makes these models gesticulate. Silence here is the calm setting, the
      // same reason HeyGen is pinned to `expressiveness: "low"`.
    }),
  },
  /**
   * InfiniTalk — 480p/720p only and priced per second above OmniHuman at 720p, so it is here
   * as a fallback/experiment lane rather than a recommendation. Sized in FRAMES at 25fps.
   */
  infinitalk: {
    id: "fal-ai/infinitalk",
    maxAudioSec: 28,
    build: p => ({
      image_url: p.imageUrl,
      audio_url: p.audioUrl,
      prompt: "A person speaking directly to the camera",
      resolution: "720p",
      // 25fps, +1 for the trailing frame, clamped to the documented 41–721 window. Rounding UP
      // matters: a render short of its narration trips runChunkTasks' truncation guard and is
      // re-paid.
      num_frames: Math.min(
        721,
        Math.max(41, Math.ceil((p.durationSec ?? 6) * 25) + 1)
      ),
    }),
  },
};

/** The model this process renders host scenes on. Unknown ids fall back to the default. */
export function falLipsyncModel(): FalModelSpec {
  return (
    FAL_LIPSYNC_MODELS[ENV.falLipsyncModel] ?? FAL_LIPSYNC_MODELS.omnihuman
  );
}

/**
 * Active-job concurrency cap for fal host lip-sync, PER KEY — same per-account shape as
 * `heygenSlotsFor`, so the 5 long-form tabs each get their own budget and tabs sharing a key
 * (all falling back to `FAL_API_KEY`) correctly share one semaphore.
 *
 * fal does not publish a hard per-account concurrency limit the way HeyGen caps at 10, so this
 * is a SPEND governor first and a rate-limit guard second: every in-flight slot is a billed
 * render. Raise `FAL_CONCURRENCY` only alongside a look at the fal dashboard.
 */
const _falSlots = new Map<string, Semaphore>();
export const falSlotsFor = (apiKey: string): Semaphore => {
  let s = _falSlots.get(apiKey);
  if (!s) _falSlots.set(apiKey, (s = new Semaphore(ENV.falConcurrency)));
  return s;
};

/**
 * Client-side poll ceiling for one fal lip-sync request. fal queues can sit cold for minutes
 * before a worker picks the job up, and the render itself is a few multiples of the clip
 * length, so this matches the HeyGen lane's 15 minutes rather than trying to be tighter.
 */
export const FAL_LIPSYNC_TIMEOUT_MS = 900_000; // 15 minutes

/**
 * Whole-call ceiling on every fal request. Without it the poll loop's wall clock is decorative:
 * it only re-checks the clock BETWEEN iterations, so a socket stalled mid-body never returns and
 * `FAL_LIPSYNC_TIMEOUT_MS` is never reached — the host lane then parks a scene forever.
 */
const CALL_TIMEOUT_MS = Number(process.env.FAL_CALL_TIMEOUT_MS ?? 120_000);
/** The finished-clip download moves real bytes, so it gets more room than an API call. */
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.FAL_DOWNLOAD_TIMEOUT_MS ?? 300_000
);
const callSignal = () => AbortSignal.timeout(CALL_TIMEOUT_MS);

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 5_000;

function retryDelay(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 3000);
  return Math.min(base + jitter, 30_000);
}

/**
 * Absolute `response_url`s handed back at submit time, keyed by request id. Prefer these over a
 * reconstructed URL: they are what fal itself says to fetch, so a model whose app id doesn't
 * follow the two-segment rule still polls correctly. In-memory only — after a restart
 * `requestsUrl()` reconstructs, which is why the two-segment rule still has to be right.
 */
const _responseUrlById = new Map<string, string>();

/**
 * Render-completion callback URL, or `null` when `PUBLIC_BASE_URL` is unset (local dev) — then
 * host scenes poll only. The token is derived from JWT_SECRET so there is no extra env to
 * provision; `server/falWebhook.ts` derives the same string to authenticate the incoming POST.
 *
 * fal DOES sign its callbacks (Ed25519, `X-Fal-Webhook-Signature`), but this route deliberately
 * treats the body as an untrusted hint and never reads the result out of it — the payload is a
 * WAKE SIGNAL and `pollVideo` still does the authoritative status GET + download. That keeps the
 * gate a single URL token, identical to the HeyGen route, with no libsodium dependency.
 */
export function falCallbackUrl(): string | null {
  const base = ENV.publicBaseUrl.replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/api/webhooks/fal/${falWebhookToken()}`;
}

export function falWebhookToken(): string {
  return createHash("sha256")
    .update(`${ENV.cookieSecret}:fal-webhook`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Poll loops parked on a request id, plus the ids whose webhook landed with nobody listening.
 * A missed callback costs nothing but the fallback poll interval.
 * ponytail: in-memory — a restart or a second instance simply polls. `notified` retains an id
 * only when its poll loop already exited (job abandoned), so the leak is one string per orphan.
 */
const falWaiters = new Map<string, Set<() => void>>();
const notifiedRequestIds = new Set<string>();

/** Called by the webhook route: wake every poll loop waiting on this request. */
export function notifyFalRequest(requestId: string): void {
  const waiting = falWaiters.get(requestId);
  if (!waiting?.size) {
    notifiedRequestIds.add(requestId);
    return;
  }
  falWaiters.delete(requestId);
  waiting.forEach(wake => wake());
}

/**
 * Promise that settles when `requestId`'s completion webhook lands. `cancel()` unregisters it so
 * an abandoned wait can't retain the resolver.
 */
export function waitForFalRequest(requestId: string): {
  wait: Promise<void>;
  cancel: () => void;
} {
  if (notifiedRequestIds.delete(requestId))
    return { wait: Promise.resolve(), cancel: () => {} };
  let wake!: () => void;
  const wait = new Promise<void>(resolve => (wake = resolve));
  const waiting = falWaiters.get(requestId) ?? new Set<() => void>();
  waiting.add(wake);
  falWaiters.set(requestId, waiting);
  return {
    wait,
    cancel: () => {
      const set = falWaiters.get(requestId);
      if (!set) return;
      set.delete(wake);
      if (!set.size) falWaiters.delete(requestId);
    },
  };
}

/** Sleep `ms` before the next status GET, waking early on the completion webhook. */
async function waitBeforeNextPoll(
  requestId: string,
  ms: number
): Promise<boolean> {
  if (!falCallbackUrl()) {
    await sleep(ms);
    return false;
  }
  const w = waitForFalRequest(requestId);
  let woke = false;
  try {
    await Promise.race([
      sleep(ms),
      w.wait.then(() => {
        woke = true;
      }),
    ]);
  } finally {
    w.cancel();
  }
  return woke;
}

/**
 * fal.ai adapter for host lip-sync — the HeyGen Avatar IV alternative, selected with
 * `LIPSYNC_PROVIDER=fal`. Flow: POST the still + our own TTS audio to the fal QUEUE → poll
 * `/requests/{id}/status` until COMPLETED → GET the result → download the mp4.
 *
 * Deliberately the same submit/poll split as `HeygenLipsyncAdapter`, so the fal `request_id`
 * lands in `scene.renderTaskIds` exactly like a HeyGen `video_id` and a crash, poll timeout, or
 * watchdog sweep resumes the already-running (already-billed) render instead of re-submitting.
 */
export class FalLipsyncAdapter {
  private apiKey: string;
  private model: FalModelSpec;

  constructor(apiKey: string, model: FalModelSpec = falLipsyncModel()) {
    this.apiKey = apiKey;
    this.model = model;
  }

  private headers(): Record<string, string> {
    // `Key <token>` — NOT `Bearer`. fal 401s a Bearer prefix.
    return {
      Authorization: `Key ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /** Queue route base for this model's requests (see `falQueueApp`). */
  private requestsUrl(requestId: string, suffix = ""): string {
    const remembered = _responseUrlById.get(requestId);
    if (remembered) return `${remembered}${suffix}`;
    return `${FAL_QUEUE_BASE}/${falQueueApp(this.model.id)}/requests/${requestId}${suffix}`;
  }

  /**
   * Submit one lip-sync render and return the fal `request_id` as `taskId` for resume-safe
   * polling. Returns `{ error }` rather than throwing — the orchestrator treats a submit error
   * as a scene-level failure, not a pipeline crash.
   */
  async submitLipsync(params: FalLipsyncParams): Promise<VideoSubmitResult> {
    if (params.durationSec && params.durationSec > this.model.maxAudioSec) {
      // Local reject: fal bills the attempt and 422s, so never send it.
      return {
        error: `Narration is ${params.durationSec.toFixed(1)}s — ${this.model.id} accepts at most ${this.model.maxAudioSec}s`,
      };
    }

    const callbackUrl = falCallbackUrl();
    const url =
      `${FAL_QUEUE_BASE}/${this.model.id}` +
      (callbackUrl ? `?fal_webhook=${encodeURIComponent(callbackUrl)}` : "");
    // REST takes the model input as the RAW body. The `{ input: … }` wrapper belongs to the
    // @fal-ai/client SDK only; sending it here 422s on every field being "missing".
    const body = JSON.stringify(this.model.build(params));

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: this.headers(),
          body,
          signal: callSignal(),
        });

        if (!response.ok) {
          const errText = await response.text();
          const retriable = response.status === 429 || response.status >= 500;
          if (retriable && attempt < MAX_RETRIES) {
            const retryAfter = response.headers.get("Retry-After");
            const waitMs =
              response.status === 429 && retryAfter
                ? Math.min(parseInt(retryAfter, 10) * 1000, 60_000) ||
                  retryDelay(attempt)
                : retryDelay(attempt);
            console.log(
              `[fal] submit ${response.status}, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1})...`
            );
            await sleep(waitMs);
            continue;
          }
          return {
            error: `fal API error (${response.status}): ${errText.substring(0, 500)}`,
          };
        }

        const data = (await response.json()) as {
          request_id?: string;
          response_url?: string;
        };
        const requestId = data.request_id;
        if (!requestId) return { error: "fal returned no request_id" };
        if (data.response_url)
          _responseUrlById.set(requestId, data.response_url);
        console.log(
          `[fal] Lip-sync submitted: ${requestId} (${this.model.id})`
        );
        return { taskId: requestId };
      } catch (err: any) {
        const isNetworkErr =
          /terminated|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|abort|closed/i.test(
            err.message || ""
          );
        if (attempt < MAX_RETRIES && isNetworkErr) {
          await sleep(retryDelay(attempt));
          continue;
        }
        return { error: err.message || "Unknown error during fal submit" };
      }
    }
    return { error: "fal submit failed after retries" };
  }

  /**
   * Poll a fal request to completion and download the result. Returns `{ pending: true }` on
   * client timeout (the request id stays persisted for resume); a failed render and an
   * unknown/404 request id — e.g. a stale HeyGen `video_id` resumed after the provider swap —
   * return `infraFailure: true` so the orchestrator clears the ids and re-submits fresh.
   */
  async pollVideo(
    taskId: string,
    timeoutMs: number = FAL_LIPSYNC_TIMEOUT_MS
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    let delay = 5_000;
    let pollCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      if (await waitBeforeNextPoll(taskId, delay))
        console.log(`[fal] webhook wake ${taskId}`);
      // With a callback configured the webhook is the primary signal and this poll is only the
      // safety net, so it may drift further out; without one it stays the 20s cadence.
      delay = Math.min(delay * 1.5, falCallbackUrl() ? 60_000 : 20_000);
      pollCount++;

      try {
        const resp = await fetch(this.requestsUrl(taskId, "/status"), {
          headers: { Authorization: `Key ${this.apiKey}` },
          signal: callSignal(),
        });

        if (resp.status === 429) {
          const retryAfter = resp.headers.get("Retry-After");
          const waitSec = retryAfter
            ? Math.min(parseInt(retryAfter, 10) || 10, 60)
            : 10;
          await sleep(waitSec * 1000);
          continue;
        }

        if (resp.status === 401 || resp.status === 403) {
          // Bad/revoked key — re-submitting cannot fix it, so don't invite the orchestrator to.
          return {
            success: false,
            taskId,
            error: `fal rejected the API key (${resp.status})`,
          };
        }

        if (resp.status === 404 || resp.status === 400) {
          const errText = await resp.text();
          return {
            success: false,
            taskId,
            error: `fal request not found (${resp.status}): ${errText.substring(0, 200)}`,
            infraFailure: true,
          };
        }

        if (!resp.ok) {
          const errText = await resp.text();
          console.warn(
            `[fal] Poll error (${resp.status}): ${errText.substring(0, 200)}`
          );
          await sleep(5_000 + Math.floor(Math.random() * 3000));
          continue;
        }

        // IN_QUEUE / IN_PROGRESS come back 202 (still `resp.ok`), COMPLETED comes back 200.
        const status = (
          (await resp.json().catch(() => ({}))) as { status?: string }
        ).status;
        if (status !== "COMPLETED") continue;

        console.log(
          `[fal] Request ${taskId} completed — wall ${Math.round((Date.now() - startTime) / 1000)}s | polls ${pollCount}`
        );

        // COMPLETED means "the worker is done", not "the worker succeeded": a render that
        // errored also completes, and the failure only surfaces on the RESULT fetch.
        const resultResp = await fetch(this.requestsUrl(taskId), {
          headers: { Authorization: `Key ${this.apiKey}` },
          signal: callSignal(),
        });
        if (!resultResp.ok) {
          const errText = await resultResp.text();
          return {
            success: false,
            taskId,
            error: `fal render failed (${resultResp.status}): ${errText.substring(0, 300)}`,
            infraFailure: true,
          };
        }
        const result = (await resultResp.json()) as {
          video?: { url?: string };
        };
        const videoUrl = result.video?.url;
        if (!videoUrl) {
          return {
            success: false,
            taskId,
            error: "fal request completed but returned no video url",
            infraFailure: true,
          };
        }

        // fal media URLs are public CDN links — no Authorization header (sending one 403s).
        const dl = await fetch(videoUrl, {
          redirect: "follow",
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
        if (!dl.ok) {
          return {
            success: false,
            taskId,
            error: `fal video download failed (${dl.status})`,
            infraFailure: true,
          };
        }
        _responseUrlById.delete(taskId);
        return {
          success: true,
          fileData: Buffer.from(await dl.arrayBuffer()),
          mimeType: "video/mp4",
          taskId,
        };
      } catch (err: any) {
        console.warn(`[fal] Poll network error: ${err.message}`);
        await sleep(5_000);
      }
    }

    return {
      success: false,
      pending: true,
      taskId,
      error: `Client timed out after ${Math.round(timeoutMs / 1000)}s. The render may still be running on fal.`,
    };
  }

  /**
   * Key health for the admin panel. fal has no public per-key credit-balance endpoint (billing
   * lives behind the dashboard session, not the API key), so there is no HeyGen-style credit
   * number to show. Instead this asks the queue about a request id that cannot exist: a live key
   * gets "no such request" (404), a dead one gets 401/403 before the lookup ever happens.
   * Returns null when the call itself fails — unknown, not invalid.
   */
  async checkKey(): Promise<boolean | null> {
    try {
      const res = await fetch(
        `${FAL_QUEUE_BASE}/${falQueueApp(this.model.id)}/requests/00000000-0000-0000-0000-000000000000/status`,
        {
          headers: { Authorization: `Key ${this.apiKey}` },
          // 8s, not the 120s render budget: the admin page batches every query into one
          // request, so a slow probe here stalls the entire Provider Keys panel.
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

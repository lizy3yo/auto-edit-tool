import { nanoid } from "nanoid";
import type { GenerationResult } from "../../shared/types";
import type {
  ProviderAdapter,
  VideoGenerationParams,
  ImageGenerationParams,
  VideoSubmitResult,
} from "./base";
import { sleep } from "./base";
import { Semaphore } from "./semaphore";
import { ENV } from "../_core/env";
import { getAppSetting, setAppSetting } from "../db";
import { encrypt, decrypt, maskApiKey } from "../encryption";
import { recordUsage } from "../costMeter";
import { summarizeHttpBody } from "../_core/errorDetail";

/**
 * ════════════════════════════════════════════════════════════════════════════════════════
 * AIREITER BOLT-ON — TEMPORARY, DESIGNED TO BE DELETED
 * ════════════════════════════════════════════════════════════════════════════════════════
 *
 * Routes the b-roll clip and/or still-image lanes at AIReiter (an aggregated model gateway)
 * instead of APIMART / OpenAI, so prepaid AIReiter credits get spent on real test renders
 * rather than sitting idle. It is OFF unless `AIREITER_LANES` is set, so an unconfigured
 * environment behaves exactly as before.
 *
 * AIReiter CANNOT serve the two lanes this product depends on most — it sells no
 * audio-driven lip-sync model and no TTS at all — so host scenes stay on HeyGen/fal and
 * narration stays on 69Labs no matter what this file is set to.
 *
 * ── TO REMOVE ENTIRELY (3 steps, ~10 lines) ──────────────────────────────────────────────
 *   1. Delete this file and `aireiter.test.ts`.
 *   2. `server/longformVideo.ts` → `apimartAdapterForJob()`: delete the AIREITER BOLT-ON
 *      block and restore the return type to `Promise<ApimartAdapter | null>`.
 *   3. `server/providers/fallback.ts` → `generateStillWithFallback()`: delete the AIREITER
 *      BOLT-ON branch and change the following `else if (input.apimartKey)` back to
 *      `if (input.apimartKey)`.
 *   (Then drop the `AIREITER_*` vars from `.env` / `.env.example`. The `ENV` entries are
 *   inert without them.)
 * ════════════════════════════════════════════════════════════════════════════════════════
 */

const AIREITER_BASE = "https://aireiter.com/api/openapi";

/** AIReiter's model ids. Both are the same models the pipeline already uses elsewhere. */
const VIDEO_MODEL = "grok_imagine_1_5";
const IMAGE_MODEL = "gpt_image_2";

const CALL_TIMEOUT_MS = Number(process.env.AIREITER_CALL_TIMEOUT_MS ?? 120_000);
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.AIREITER_DOWNLOAD_TIMEOUT_MS ?? 300_000
);
const callSignal = () => AbortSignal.timeout(CALL_TIMEOUT_MS);
/**
 * Much tighter budget for the admin balance probe. The client batches every admin query into
 * ONE http request (`httpBatchLink`), so the response waits on the SLOWEST resolver — a
 * balance check on the render-sized 120s timeout would leave the whole Provider Keys page
 * showing "Loading…" for two minutes. A dashboard number is not worth that: give up at 8s
 * and render "balance check failed".
 */
const PROBE_TIMEOUT_MS = Number(process.env.AIREITER_PROBE_TIMEOUT_MS ?? 8_000);

/** Client-side poll ceiling for one AIReiter task. */
export const AIREITER_TIMEOUT_MS = Number(
  process.env.AIREITER_POLL_TIMEOUT_MS ?? 600_000
);

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 4_000;

function retryDelay(attempt: number): number {
  return Math.min(
    BASE_RETRY_DELAY_MS * Math.pow(2, attempt) +
      Math.floor(Math.random() * 2000),
    30_000
  );
}

/**
 * Admin-entered key, stored AES-encrypted in `app_settings` exactly like the 69Labs /
 * APIMART / HeyGen keys (Channel B in CLAUDE.md). Read straight from `db` + `encryption`
 * rather than reusing longformVideo's private helpers — importing longformVideo here would
 * be a cycle (it imports this file), and keeping the storage local keeps the bolt-on
 * self-contained and deletable.
 */
const AIREITER_SETTING_KEY = "aireiter_key";

/** The key in force: Admin-entered wins, `AIREITER_API_KEY` is the fallback. */
export async function aireiterKey(): Promise<string> {
  try {
    const raw = await getAppSetting(AIREITER_SETTING_KEY);
    if (raw) {
      const { enc } = JSON.parse(raw) as { enc?: string };
      const key = enc ? decrypt(enc) : "";
      if (key.trim()) return key;
    }
  } catch {
    // Unreadable/undecryptable row (e.g. after a JWT_SECRET rotation) — fall back to env.
  }
  return ENV.aireiterApiKey ?? "";
}

/** Masked key for admin display (•••…last4), or null when unset. */
export async function aireiterKeyMasked(): Promise<string | null> {
  const raw = await getAppSetting(AIREITER_SETTING_KEY);
  if (!raw) return null;
  try {
    const { last4 } = JSON.parse(raw) as { last4?: string };
    return last4 ? maskApiKey("x".repeat(20) + last4) : null;
  } catch {
    return null;
  }
}

/** Store (or, with an empty string, clear) the Admin-entered key. */
export async function setAireiterKey(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  await setAppSetting(
    AIREITER_SETTING_KEY,
    key ? JSON.stringify({ last4: key.slice(-4), enc: encrypt(key) }) : ""
  );
}

/**
 * Which lanes AIReiter takes over, from `AIREITER_LANES` (comma-separated: `broll`,
 * `stills`, or `all`). Unset/empty ⇒ the bolt-on is inert and every lane keeps its normal
 * provider. A key is required too — a lane named with no key (Admin or env) stays off
 * rather than failing every render.
 */
export async function aireiterLaneEnabled(
  lane: "broll" | "stills"
): Promise<boolean> {
  // `?? ""` is load-bearing, not paranoia: this runs on the hot path of lanes the bolt-on
  // does not own, and a partially-stubbed ENV (several suites mock `_core/env` with only the
  // few fields they need) would otherwise throw here and fail a still that never wanted
  // AIReiter in the first place. An off switch must not be able to break anything.
  const lanes = (ENV.aireiterLanes ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  if (!lanes.includes("all") && !lanes.includes(lane)) return false;
  return !!(await aireiterKey());
}

/**
 * Shared in-flight cap. AIReiter publishes no concurrency limit, so this is a politeness +
 * spend governor; every slot is a billed generation.
 */
let _slots: Semaphore | null = null;
const slots = (): Semaphore =>
  (_slots ??= new Semaphore(ENV.aireiterConcurrency));

type QueryResult = {
  status?: string;
  output?: Array<{ url?: string }>;
  credits_used?: number;
};

/**
 * Outcome of one `/query`. The three-way split matters because AIReiter reports BUSINESS
 * errors as HTTP 200 with `statusCode: 400` in the body (and a meaningless `"ok": true`) —
 * e.g. `{"statusCode":400,"message":"api task not found"}`. Collapsing that into "no data
 * yet" would make an unknown task id poll for the full 10-minute ceiling before surfacing as
 * a resumable pending, instead of failing immediately like it should.
 */
type QueryOutcome =
  | { kind: "ok"; data: QueryResult }
  | { kind: "terminal"; message: string }
  | { kind: "transient" };

/**
 * AIReiter adapter. Every model shares one protocol: `POST /submit {model, params,
 * out_task_id}` → `POST /query {out_task_id}` until `completed`, then read `output[0].url`.
 *
 * The caller supplies `out_task_id`, which means OUR id is the provider id — so the
 * persisted `renderTaskIds` resume path works with no id translation at all.
 */
export class AireiterAdapter implements ProviderAdapter {
  readonly supportsImageGeneration = true;
  private apiKey: string;

  constructor(apiKey: string = ENV.aireiterApiKey) {
    this.apiKey = apiKey;
  }

  /** Build an adapter on the key in force (Admin row first, then env). */
  static async resolve(): Promise<AireiterAdapter> {
    return new AireiterAdapter(await aireiterKey());
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /** `POST /submit`, with retry on 429/5xx. Returns the out_task_id we generated. */
  private async submit(
    model: string,
    params: Record<string, unknown>
  ): Promise<VideoSubmitResult> {
    // Their id charset is [A-Za-z0-9_-], 1–64 — nanoid's default alphabet is exactly that.
    const outTaskId = `ae_${nanoid(16)}`;
    const body = JSON.stringify({ model, params, out_task_id: outTaskId });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${AIREITER_BASE}/submit`, {
          method: "POST",
          headers: this.headers(),
          body,
          signal: callSignal(),
        });
        if (!res.ok) {
          const errText = await res.text();
          if (
            (res.status === 429 || res.status >= 500) &&
            attempt < MAX_RETRIES
          ) {
            await sleep(retryDelay(attempt));
            continue;
          }
          return {
            error: `AIReiter ${model} error (${res.status}): ${summarizeHttpBody(errText, 400)}`,
          };
        }
        // AIReiter answers an unrecognised route/method with 200 + the marketing HTML page
        // rather than a 404/405 (verified live on `POST /balance`). Swallowing a parse failure
        // here would turn that into a FALSE SUCCESS: we'd hand back an out_task_id that no task
        // exists for and poll it until timeout. So a non-JSON body is a hard error.
        const raw = await res.text();
        let data: {
          statusCode?: number;
          message?: string;
          data?: { out_task_id?: string };
        };
        try {
          data = JSON.parse(raw);
        } catch {
          return {
            error:
              `AIReiter ${model} returned a non-JSON body (${res.status}) — check the ` +
              `endpoint/method: ${raw.substring(0, 120)}`,
          };
        }
        // A 200 can still carry a business-level failure in the envelope.
        if (data.statusCode && data.statusCode !== 200) {
          return {
            error: `AIReiter ${model} rejected the task: ${data.message ?? "unknown"}`,
          };
        }
        console.log(`[AIReiter] ${model} submitted: ${outTaskId}`);
        // An accepted task is a billed task. This lane is a drop-in replacement for the
        // metered APIMART/OpenAI ones, so without this a job with `AIREITER_LANES` set would
        // silently report its b-roll and stills as free.
        if (model === VIDEO_MODEL) {
          recordUsage({
            lane: "video",
            provider: "aireiter",
            model: VIDEO_MODEL,
            calls: 1,
            quantity: Number(params.video_length ?? 0), // billed seconds of 720p clip
          });
        } else {
          // gpt_image_2 returns one image per task, so a submit IS an image.
          recordUsage({
            lane: "image",
            provider: "aireiter",
            model: IMAGE_MODEL,
            calls: 1,
            quantity: 1,
          });
        }
        return { taskId: data.data?.out_task_id ?? outTaskId };
      } catch (err: any) {
        const networkish =
          /terminated|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|abort|closed/i.test(
            err?.message ?? ""
          );
        if (attempt < MAX_RETRIES && networkish) {
          await sleep(retryDelay(attempt));
          continue;
        }
        return { error: err?.message ?? "Unknown AIReiter submit error" };
      }
    }
    return { error: "AIReiter submit failed after retries" };
  }

  /** `POST /query` once. See `QueryOutcome` for why this is three-way, not nullable. */
  private async query(outTaskId: string): Promise<QueryOutcome> {
    try {
      const res = await fetch(`${AIREITER_BASE}/query`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ out_task_id: outTaskId }),
        signal: callSignal(),
      });
      if (!res.ok) return { kind: "transient" };
      const raw = await res.text();
      let body: { statusCode?: number; message?: string; data?: QueryResult };
      try {
        body = JSON.parse(raw);
      } catch {
        // Non-JSON ⇒ we hit the marketing page, i.e. wrong route/method. Never recoverable.
        return {
          kind: "terminal",
          message: `AIReiter /query returned a non-JSON body: ${raw.substring(0, 120)}`,
        };
      }
      if (body.statusCode && body.statusCode !== 200)
        return {
          kind: "terminal",
          message: body.message ?? `AIReiter query error ${body.statusCode}`,
        };
      return body.data
        ? { kind: "ok", data: body.data }
        : { kind: "transient" };
    } catch {
      return { kind: "transient" };
    }
  }

  /** Poll one task to a terminal state and download its first output. */
  private async pollTask(
    outTaskId: string,
    timeoutMs: number,
    mimeType: string
  ): Promise<GenerationResult> {
    const start = Date.now();
    let delay = 4_000;

    while (Date.now() - start < timeoutMs) {
      await sleep(delay);
      delay = Math.min(delay * 1.4, 20_000);

      const outcome = await this.query(outTaskId);
      if (outcome.kind === "transient") continue; // network blip — keep polling
      if (outcome.kind === "terminal") {
        // Unknown/expired task id (includes a stale APIMART taskId resumed after a lane
        // swap) — let the orchestrator clear the ids and re-submit fresh.
        return {
          success: false,
          taskId: outTaskId,
          error: `AIReiter: ${outcome.message}`,
          infraFailure: true,
        };
      }
      const data = outcome.data;

      if (data.status === "failed") {
        return {
          success: false,
          taskId: outTaskId,
          error: "AIReiter task failed",
          // Terminal but re-submittable: let the orchestrator clear ids and retry fresh.
          infraFailure: true,
        };
      }
      if (data.status !== "completed") continue;

      const url = data.output?.[0]?.url;
      if (!url) {
        return {
          success: false,
          taskId: outTaskId,
          error: "AIReiter completed but returned no output url",
          infraFailure: true,
        };
      }
      const dl = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!dl.ok) {
        return {
          success: false,
          taskId: outTaskId,
          error: `AIReiter download failed (${dl.status})`,
          infraFailure: true,
        };
      }
      console.log(
        `[AIReiter] ${outTaskId} done — ${Math.round((Date.now() - start) / 1000)}s, ${data.credits_used ?? "?"} credits`
      );
      return {
        success: true,
        fileData: Buffer.from(await dl.arrayBuffer()),
        mimeType,
        taskId: outTaskId,
      };
    }

    return {
      success: false,
      pending: true,
      taskId: outTaskId,
      error: `Client timed out after ${Math.round(timeoutMs / 1000)}s; the task may still be running on AIReiter.`,
    };
  }

  // ─── Video (b-roll clips) ───────────────────────────────────────────────

  /**
   * Submit one b-roll clip. AIReiter's Grok Imagine 1.5 is IMAGE-TO-VIDEO ONLY (`image_url`
   * is required), which matches how this pipeline already drives it — every b-roll clip is
   * seeded with a gpt-image-2 keyframe. A text-only submit is rejected locally rather than
   * paying for the 400.
   */
  async submitVideo(params: VideoGenerationParams): Promise<VideoSubmitResult> {
    const imageUrl = params.imageUrls?.[0];
    if (!imageUrl) {
      return {
        error:
          "AIReiter Grok Imagine 1.5 is image-to-video only and requires a keyframe " +
          "(unset BROLL_NO_KEYFRAME, or take this lane off AIReiter).",
      };
    }
    return this.submit(VIDEO_MODEL, {
      image_url: imageUrl,
      prompt: params.prompt,
      // Their Grok tops out at 720p — the requested `resolution` cannot be honoured, so b-roll
      // is upscaled into the 1080p assembly canvas. Fine for test renders, visible in a final.
      resolution: ENV.aireiterVideoResolution,
      video_length: Math.max(1, Math.min(15, Math.round(params.duration))),
      aspect_ratio: params.aspectRatio,
    });
  }

  async pollVideo(
    taskId: string,
    timeoutMs: number = AIREITER_TIMEOUT_MS
  ): Promise<GenerationResult> {
    return this.pollTask(taskId, timeoutMs, "video/mp4");
  }

  /** Non-resumable path, kept for interface completeness. */
  async generateVideo(
    params: VideoGenerationParams
  ): Promise<GenerationResult[]> {
    const out: GenerationResult[] = [];
    for (let i = 0; i < params.count; i++) {
      const sem = slots();
      await sem.acquire();
      try {
        const sub = await this.submitVideo(params);
        out.push(
          sub.taskId
            ? await this.pollVideo(sub.taskId)
            : { success: false, error: sub.error ?? "submit failed" }
        );
      } finally {
        sem.release();
      }
    }
    return out;
  }

  // ─── Images (stills / keyframes) ────────────────────────────────────────

  async generateImage(
    params: ImageGenerationParams
  ): Promise<GenerationResult[]> {
    const one = async (): Promise<GenerationResult> => {
      const sem = slots();
      await sem.acquire();
      try {
        const sub = await this.submit(IMAGE_MODEL, {
          prompt: params.prompt,
          aspect_ratio: params.aspectRatio,
          resolution: params.imageSize ?? ENV.aireiterImageResolution,
          ...(params.imageUrls?.length
            ? { image_url: params.imageUrls.slice(0, 10) }
            : {}),
        });
        if (!sub.taskId)
          return { success: false, error: sub.error ?? "submit failed" };
        return this.pollTask(sub.taskId, AIREITER_TIMEOUT_MS, "image/png");
      } finally {
        sem.release();
      }
    };
    // gpt_image_2 returns one image per task, so `count` becomes N parallel tasks.
    return Promise.all(Array.from({ length: params.count }, one));
  }

  /**
   * Remaining credits, or null when the check fails. Doubles as a key health probe.
   * GET, not POST — `POST /balance` returns the marketing HTML page with a 200 (verified
   * live), which is the same silent-failure trap `submit` guards against.
   */
  async getBalance(): Promise<number | null> {
    try {
      if (!this.apiKey) return null;
      const res = await fetch(`${AIREITER_BASE}/balance`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: { credits?: number; balance?: number };
      };
      return body.data?.credits ?? body.data?.balance ?? null;
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const credits = await this.getBalance();
    return credits == null
      ? { success: false, message: "AIReiter balance check failed" }
      : { success: true, message: `AIReiter OK — ${credits} credits` };
  }
}

/**
 * Adapter on the current key. Deliberately NOT cached: the Admin row can be re-entered mid-
 * session and a render (or a resumed job) must pick up the new key, matching how
 * `apimartAdapterForJob` and `resolveLipsyncAdapter` re-read their keys at render time.
 */
export const aireiterAdapter = (): Promise<AireiterAdapter> =>
  AireiterAdapter.resolve();

/**
 * Still/keyframe helper matching `generateStillWithFallback`'s input shape — the single call
 * the fallback.ts hook makes, so that hook stays one line and deletes cleanly.
 */
export async function aireiterStill(input: {
  prompt: string;
  referenceImageUrl?: string;
  square?: boolean;
}): Promise<GenerationResult> {
  const [r] = await (
    await aireiterAdapter()
  ).generateImage({
    prompt: input.prompt,
    model: "gpt-image-2",
    aspectRatio: input.square ? "1:1" : "16:9",
    count: 1,
    ...(input.referenceImageUrl
      ? { imageUrls: [input.referenceImageUrl] }
      : {}),
  });
  return r ?? { success: false, error: "AIReiter returned no image" };
}

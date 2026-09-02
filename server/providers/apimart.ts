import type { GenerationResult } from "../../shared/types";
import type {
  ProviderAdapter,
  VideoGenerationParams,
  ImageGenerationParams,
  VideoSubmitResult,
} from "./base";
import { sleep } from "./base";
import {
  isContentPolicyError,
  isTransientVideoError,
  isCreditsError,
} from "./sixtynine-labs";
import { recordUsage } from "../costMeter";
import { summarizeHttpBody } from "../_core/errorDetail";

/**
 * APIMART video/image provider. One async gateway — submit returns a task_id, then poll
 * `GET /v1/tasks/{id}` until completed. Same submit→poll→download shape as 69Labs, so it plugs
 * into longform's resumable `submitVideo`/`pollVideo` clip path and its `generateImage`
 * still/keyframe path unchanged.
 *
 * ONE video model — grok-imagine, image-to-video / text-to-video — for every caller (longform
 * b-roll cutaways, host scenes, studio edit-video). `params.model` only selects video vs image;
 * every other model field is ignored. Stills/keyframes are gpt-image-2.
 *
 * Docs: https://docs.apimart.ai/en/api-reference/videos/grok-imagine/generation
 *       https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation
 */
const BASE_URL = "https://api.apimart.ai";
const VIDEO_MODEL = "grok-imagine-1.5-video-apimart";
const IMAGE_MODEL = "gpt-image-2";
const DEFAULT_TIMEOUT_MS = 7 * 60_000;
const POLL_INTERVAL_MS = 60_000;
// Images (gpt-image-2) can finish fast, but apimart's provider-side variance is huge and NOT
// caused by our own concurrency: live probes (scripts/probe-apimart-image.ts, 2026-07-08) saw
// 6 identical submits — parallel AND strictly sequential — complete in 36s..547s, with a LONE
// sequential task queueing 8 min before its ~40s render (`actual_time` up to 5.5x the ~100s
// `estimated_time`). Timing out abandons the in-flight, already-billed image and makes the
// caller resubmit a fresh task, so the ceiling clears the observed ~9.1-min worst case with
// headroom (production runs many images per key, so tails run longer than the probe's). Poll
// faster than video (15s) so a quick image still returns promptly.
const IMAGE_TIMEOUT_MS = 12 * 60_000;
const IMAGE_POLL_INTERVAL_MS = 15_000;
const MAX_RETRIES = 6;

// apimart's gateway/CDN stalls intermittently; an unbounded call rides undici's default 300s
// timeouts and surfaces as "terminated"/"fetch failed" — a live probe
// (scripts/probe-apimart-image.ts) saw the finished-image download hit exactly this. Bound each
// request so a stalled socket fails fast and the retry loop reconnects on a fresh one.
// AbortSignal.timeout (not an undici Agent dispatcher): a npm-undici Agent passed to the
// runtime's built-in fetch fails EVERY call with a bare "fetch failed" ("invalid onRequestStart
// method") whenever the two undici versions' dispatcher interfaces drift — Node 22 (built-in
// undici 6) vs npm undici 8 did exactly that and took down every APIMART render locally.
// ponytail: 120s whole-call ceiling (vs the old per-phase headers/body timeouts); no single
// apimart call — submit, poll, or a ~10s 720p clip download — legitimately needs more.
const APIMART_CALL_TIMEOUT_MS = 120_000;
const withDispatcher = (init: RequestInit = {}): RequestInit => ({
  ...init,
  signal: AbortSignal.timeout(APIMART_CALL_TIMEOUT_MS),
});

// Reads cleanly for the user and contains "content policy" so `isContentPolicyError`
// matches it — longform's b-roll retry gate inspects this to try a softer prompt.
const CONTENT_POLICY_MESSAGE =
  "APIMART blocked this scene's prompt (content policy). Simplify the visual, remove " +
  "real names, and avoid age-sensitive wording, then retry.";

const retryDelay = (attempt: number): number =>
  Math.min(30_000, 2_000 * 2 ** attempt);

// ─── Per-key rate limiter for APIMART submits (Token Bucket + adaptive 429 backpressure) ───
// "rate_limit_exceeded: No available tokens" is APIMART (or its upstream provider) throttling REQUEST
// RATE per key — a separate meter from the credit balance (that surfaces as 402 "Insufficient
// balance"), so it fires with a full account. APIMART is the only media provider here with no client
// throttle (openai-image/genaipro/69Labs each have a bucket), so parallel b-roll submits + the
// unbounded Edit pages burst the per-key limit. The numeric ceiling is undisclosed (Console Dashboard
// only), so pace to a conservative default and let a 429 self-correct via a global cooldown. Gate
// submits only — polls are fixed-interval and already swallow non-ok responses.
// ponytail: per-KEY bucket keyed on the raw key string, so each configured key (5 tab slots +
// apimart_key_edit = 6 today) self-paces independently — nothing pooled, auto-scales to however many
// keys exist. If APIMART turns out to meter per-ACCOUNT, collapse the Map to one bucket; nothing else
// changes. To go faster, read the real per-key limit at https://apimart.ai/keys and set the env var.
const APIMART_RATE_PER_MIN = Number(process.env.APIMART_RATE_PER_MIN ?? 40);
// Burst 5: the docs publish no number (only "the platform has a per-minute submission cap"), so a
// lane restart / batch of 5 fires back-to-back and the 40/min refill still paces the tail. Drop
// back to 1 if 429s reappear at start-of-batch.
const APIMART_BURST = Number(process.env.APIMART_BURST ?? 5);
const APIMART_REFILL_RATE = APIMART_RATE_PER_MIN / 60; // tokens/sec
type ApimartBucket = {
  tokens: number;
  lastRefill: number;
  cooldownUntil: number;
};
const _apimartBuckets = new Map<string, ApimartBucket>();
const apimartBucketFor = (key: string): ApimartBucket => {
  let b = _apimartBuckets.get(key);
  if (!b) {
    b = { tokens: APIMART_BURST, lastRefill: Date.now(), cooldownUntil: 0 };
    _apimartBuckets.set(key, b);
  }
  return b;
};

/** Block until this key's bucket has a token (refilling at APIMART_RATE_PER_MIN), waiting out any
 * active 429 cooldown first — paces our submits under APIMART's undisclosed per-key rate. */
async function acquireApimartToken(key: string): Promise<void> {
  const b = apimartBucketFor(key);
  while (true) {
    const now = Date.now();
    if (now < b.cooldownUntil) {
      await sleep(Math.max(b.cooldownUntil - now, 100));
      continue; // re-check cooldown + refill after waiting out the 429 window
    }
    const elapsed = (now - b.lastRefill) / 1000;
    b.tokens = Math.min(
      APIMART_BURST,
      b.tokens + elapsed * APIMART_REFILL_RATE
    );
    b.lastRefill = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil(((1 - b.tokens) / APIMART_REFILL_RATE) * 1000);
    await sleep(Math.max(waitMs, 100));
  }
}

/** On a 429, pause ALL submits on this key for `retryMs` and drain its bucket, so every concurrent
 * worker backs off with APIMART instead of past it. */
function penalizeApimartRateLimit(key: string, retryMs: number): void {
  const b = apimartBucketFor(key);
  b.cooldownUntil = Math.max(b.cooldownUntil, Date.now() + retryMs);
  b.tokens = 0;
}

/** "1K"/"2K"/"4K" → APIMART resolution "1k"/"2k"/"4k". Defaults to "1k". */
const toResolution = (imageSize?: string): string => {
  const s = (imageSize ?? "1K").toLowerCase();
  return s === "2k" || s === "4k" ? s : "1k";
};

const isNetworkErr = (msg: string): boolean =>
  /terminated|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|abort|closed/i.test(
    msg
  );

export class ApimartAdapter implements ProviderAdapter {
  readonly supportsImageGeneration = true;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  /**
   * Remaining/used credits for this key's ACCOUNT via the free
   * `GET /v1/user/balance` endpoint. (Per-key `/v1/balance` reports
   * unlimited_quota when the key has no quota cap — true for all our keys —
   * while the account balance is the number that actually runs out.) Null on
   * any failure, which doubles as a key/gateway health signal for the admin
   * panel.
   */
  async getBalance(): Promise<{
    remainBalance: number;
    remainCredits: number;
    usedBalance: number;
    usedCredits: number;
  } | null> {
    try {
      const res = await fetch(
        `${BASE_URL}/v1/user/balance`,
        withDispatcher({ headers: this.headers() })
      );
      if (!res.ok) return null;
      const data: any = await res.json();
      if (!data?.success) return null;
      return {
        remainBalance: data.remain_balance,
        remainCredits: data.remain_credits,
        usedBalance: data.used_balance,
        usedCredits: data.used_credits,
      };
    } catch {
      return null;
    }
  }

  private buildVideoBody(params: VideoGenerationParams): Record<string, any> {
    const body: Record<string, any> = {
      model: VIDEO_MODEL,
      prompt: params.prompt,
      size: "16:9", // APIMART video is locked to 16:9 720p only
      // APIMART accepts an INTEGER 6–15 for Grok video (over 15 is a hard 400
      // `invalid_duration`); longform b-roll sends the exact per-scene length
      // (`brollClipDuration`). Round + clamp to the valid range.
      duration: Math.max(6, Math.min(15, Math.round(params.duration))),
      // APIMART caps at 720p; the pipeline renders clips at 720p.
      quality: "720p",
    };
    if (params.imageUrls && params.imageUrls.length > 0) {
      body.image_urls = params.imageUrls.slice(0, 7); // grok keyframe path sends 1
    }
    return body;
  }

  private buildImageBody(params: ImageGenerationParams): Record<string, any> {
    // ponytail: pixel size for the two ratios we ship; other ratios keep the aspect
    // passthrough. Explicit pixels are a firmer landscape lock than the "16:9" hint,
    // which gpt-image-2 sometimes ignores.
    const SIZE_PX: Record<string, string> = {
      "16:9": "1280x720",
      "9:16": "720x1280",
    };
    const body: Record<string, any> = {
      model: IMAGE_MODEL,
      prompt: params.prompt,
      n: params.count,
      size: SIZE_PX[params.aspectRatio] ?? params.aspectRatio,
      resolution: toResolution(params.imageSize),
      quality: "high",
    };
    if (params.imageUrls && params.imageUrls.length > 0) {
      body.image_urls = params.imageUrls.slice(0, 16);
    }
    return body;
  }

  /** Submit ONE generation task; returns its APIMART task_id to poll. Retry on 429/5xx/network. */
  private async submit(
    path: "/v1/videos/generations" | "/v1/images/generations",
    body: Record<string, any>
  ): Promise<VideoSubmitResult> {
    const kind = path.includes("videos") ? "Video" : "Image";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await acquireApimartToken(this.apiKey); // pace to this key's undisclosed rate
        const res = await fetch(
          `${BASE_URL}${path}`,
          withDispatcher({
            method: "POST",
            headers: this.headers(true),
            body: JSON.stringify(body),
          })
        );
        if (!res.ok) {
          const errText = await res.text();
          const retriable = res.status === 429 || res.status >= 500;
          if (retriable && attempt < MAX_RETRIES) {
            const retryAfter = res.headers.get("Retry-After");
            const waitMs =
              res.status === 429 && retryAfter
                ? parseInt(retryAfter, 10) * 1000 || retryDelay(attempt)
                : retryDelay(attempt);
            if (res.status === 429)
              penalizeApimartRateLimit(this.apiKey, waitMs);
            console.log(
              `[APIMART] ${kind} submit ${res.status}, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1})...`
            );
            await sleep(waitMs);
            continue;
          }
          return { error: this.mapError(errText, res.status) };
        }
        const data = await res.json();
        const taskId = data?.data?.[0]?.task_id;
        if (!taskId) {
          console.warn(
            `[APIMART] ${kind}: no task_id in response:`,
            JSON.stringify(data).substring(0, 300)
          );
          return { error: "APIMART returned no task_id" };
        }
        console.log(`[APIMART] ${kind} job submitted: ${taskId}`);
        // An accepted task is a billed task — whether or not the caller later abandons it on
        // a poll timeout or discards the result on a content-policy re-roll. Meter here, at
        // the one point both the video and image lanes pass through.
        if (kind === "Video") {
          recordUsage({
            lane: "video",
            provider: "apimart",
            model: VIDEO_MODEL,
            calls: 1,
            quantity: body.duration ?? 0, // billed seconds of 720p clip
          });
        } else {
          recordUsage({
            lane: "image",
            provider: "apimart",
            model: IMAGE_MODEL,
            calls: 1,
            quantity: body.n ?? 1,
          });
        }
        return { taskId };
      } catch (err: any) {
        if (attempt < MAX_RETRIES && isNetworkErr(err.message || "")) {
          await sleep(retryDelay(attempt));
          continue;
        }
        return {
          error: err.message || `Unknown error during APIMART ${kind} submit`,
        };
      }
    }
    return { error: `APIMART ${kind} submit failed after retries` };
  }

  async submitVideo(params: VideoGenerationParams): Promise<VideoSubmitResult> {
    return this.submit("/v1/videos/generations", this.buildVideoBody(params));
  }

  /**
   * Poll a submitted task to a terminal state. Returns the completed `data` object, or a
   * terminal-error/pending `GenerationResult`. Shared by video + image; the caller extracts its
   * own media URL. A client timeout returns `{ pending: true }` so longform can resume the task.
   */
  private async pollTask(
    taskId: string,
    timeoutMs: number,
    intervalMs: number = POLL_INTERVAL_MS
  ): Promise<{ data: any } | GenerationResult> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let data: any;
      try {
        const res = await fetch(
          `${BASE_URL}/v1/tasks/${taskId}`,
          withDispatcher({ headers: this.headers() })
        );
        if (!res.ok) {
          // Transient status-endpoint blip: keep polling until the deadline.
          await sleep(intervalMs);
          continue;
        }
        data = (await res.json())?.data ?? {};
      } catch {
        await sleep(intervalMs);
        continue;
      }

      if (data.status === "completed") return { data };
      if (
        data.status === "failed" ||
        data.status === "error" ||
        data.status === "cancelled"
      ) {
        const raw = data.error || data.message || `APIMART task ${data.status}`;
        return { success: false, taskId, error: this.mapError(raw) };
      }
      // pending | processing | anything non-terminal
      await sleep(intervalMs);
    }
    // Timed out client-side — render likely still running; let the caller resume.
    return {
      success: false,
      pending: true,
      taskId,
      error: "APIMART poll timed out",
    };
  }

  async pollVideo(
    taskId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<GenerationResult> {
    const polled = await this.pollTask(taskId, timeoutMs);
    if ("success" in polled) return polled; // pending / error
    const url = extractMediaUrl(polled.data, "videos");
    if (!url)
      return {
        success: false,
        taskId,
        error: "APIMART completed but returned no video URL",
      };
    const dl = await this.download(url);
    if ("buffer" in dl)
      return {
        success: true,
        fileData: dl.buffer,
        mimeType: "video/mp4",
        taskId,
      };
    return { success: false, taskId, error: dl.error };
  }

  private async download(
    url: string
  ): Promise<{ buffer: Buffer } | { error: string }> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, withDispatcher());
        if (!res.ok) {
          if (attempt < MAX_RETRIES) {
            await sleep(retryDelay(attempt));
            continue;
          }
          return { error: `APIMART download failed (${res.status})` };
        }
        return { buffer: Buffer.from(await res.arrayBuffer()) };
      } catch (err: any) {
        if (attempt < MAX_RETRIES && isNetworkErr(err.message || "")) {
          await sleep(retryDelay(attempt));
          continue;
        }
        return { error: err.message || "APIMART download error" };
      }
    }
    return { error: "APIMART download failed after retries" };
  }

  /**
   * Normalize a raw provider error into a message the longform classifiers understand:
   * content blocks → CONTENT_POLICY_MESSAGE (softer-prompt retry), credits/transient kept
   * as recognizable phrasing, everything else passed through (truncated).
   */
  private mapError(rawInput: unknown, status?: number): string {
    // APIMART's failed-task payload can carry `error`/`message` as an object or number,
    // not always a string. Coerce before any classifier/.substring use so a non-string
    // can't throw "raw.substring is not a function" and destroy the real error text.
    const raw =
      typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput ?? "");
    if (isContentPolicyError(raw)) return CONTENT_POLICY_MESSAGE;
    if (isCreditsError(raw))
      return "APIMART credits depleted. Check your APIMART dashboard.";
    if (isTransientVideoError(raw))
      return `APIMART: ${summarizeHttpBody(raw, 300)}`;
    const prefix = status ? `APIMART API error (${status}): ` : "APIMART: ";
    return `${prefix}${summarizeHttpBody(raw, 500)}`;
  }

  async generateVideo(
    params: VideoGenerationParams
  ): Promise<GenerationResult[]> {
    const sub = await this.submitVideo(params);
    if (!sub.taskId) return [{ success: false, error: sub.error }];
    return [await this.pollVideo(sub.taskId)];
  }

  async generateImage(
    params: ImageGenerationParams
  ): Promise<GenerationResult[]> {
    // ponytail: n=1 at the longform call sites; APIMART returns all images under one task,
    // and the pipeline only reads results[0], so one submit/poll suffices.
    const sub = await this.submit(
      "/v1/images/generations",
      this.buildImageBody(params)
    );
    if (!sub.taskId) return [{ success: false, error: sub.error }];
    const polled = await this.pollTask(
      sub.taskId,
      IMAGE_TIMEOUT_MS,
      IMAGE_POLL_INTERVAL_MS
    );
    if ("success" in polled) return [polled]; // pending / error
    const url = extractMediaUrl(polled.data, "images");
    if (!url)
      return [
        {
          success: false,
          taskId: sub.taskId,
          error: "APIMART completed but returned no image URL",
        },
      ];
    const dl = await this.download(url);
    if ("buffer" in dl)
      return [
        {
          success: true,
          fileData: dl.buffer,
          mimeType: "image/png",
          taskId: sub.taskId,
        },
      ];
    return [{ success: false, taskId: sub.taskId, error: dl.error }];
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.apiKey)
      return { success: false, message: "APIMART_KEY is not set" };
    return { success: true, message: "APIMART key present" };
  }
}

/**
 * Media URL lives at data.result.{videos|images}[].url, which is either a string or a string[].
 */
export function extractMediaUrl(
  data: any,
  kind: "videos" | "images"
): string | undefined {
  const items = data?.result?.[kind];
  if (!Array.isArray(items)) return undefined;
  for (const it of items) {
    const u = it?.url;
    if (typeof u === "string") return u;
    if (Array.isArray(u) && typeof u[0] === "string") return u[0];
  }
  return undefined;
}

/** @deprecated use `extractMediaUrl(data, "videos")` — kept for the existing unit test. */
export const extractVideoUrl = (data: any): string | undefined =>
  extractMediaUrl(data, "videos");

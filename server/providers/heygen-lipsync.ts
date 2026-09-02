import { createHash } from "crypto";
import type { GenerationResult } from "../../shared/types";
import type { VideoSubmitResult } from "./base";
import { sleep } from "./base";
import { Semaphore } from "./semaphore";
import { ENV } from "../_core/env";
import { summarizeHttpBody } from "../_core/errorDetail";

const HEYGEN_API_BASE = "https://api.heygen.com/v3";

/** Quota still lives on the v2 API; everything else here is v3. */
const HEYGEN_QUOTA_URL = "https://api.heygen.com/v2/user/remaining_quota";
/**
 * HeyGen reports quota in raw units, 60 per API credit.
 * ponytail: calibration knob — compare the admin badge against the account's HeyGen
 * dashboard on first run and set this to 1 if they already match.
 */
const HEYGEN_QUOTA_PER_CREDIT = 60;

/**
 * One host lip-sync render: the host still + the narration audio it should speak.
 * Avatar IV takes no prompt and needs no resolution hint (we always render 1080p),
 * so those are deliberately absent.
 */
export interface LipsyncParams {
  /** Host photo (R2 URL) — registered as a HeyGen photo avatar, then animated. */
  imageUrl: string;
  /** Our own TTS narration (R2 URL). Passing audio bypasses HeyGen's voices entirely. */
  audioUrl: string;
}

/**
 * Active-job concurrency cap for HeyGen host lip-sync, PER ACCOUNT. HeyGen pay-as-you-go
 * allows 10 concurrent video jobs account-wide; 8 leaves headroom for manual runs in the
 * HeyGen app while jobs render.
 * ponytail: per-KEY semaphore keyed on the raw key string (same shape as apimart's per-key
 * bucket) — the 5 long-form tabs each lip-sync on their own HeyGen account, and ONE global
 * semaphore would have capped all 5 tabs at 8 jobs COMBINED. Tabs that fall back to the
 * shared HEYGEN_API_KEY resolve to the same string, so they correctly SHARE one semaphore.
 */
const _heygenSlots = new Map<string, Semaphore>();
export const heygenSlotsFor = (apiKey: string): Semaphore => {
  let s = _heygenSlots.get(apiKey);
  if (!s) _heygenSlots.set(apiKey, (s = new Semaphore(ENV.heygenConcurrency)));
  return s;
};

/**
 * Client-side poll ceiling for HeyGen lip-sync jobs. Avatar IV renders ~5s of video
 * per second of wall time (a 7s clip took ~45s live), so 15 min covers even a
 * multi-minute host scene plus queue delay.
 */
export const HEYGEN_LIPSYNC_TIMEOUT_MS = 900_000; // 15 minutes

/**
 * Whole-call ceiling on every HeyGen request. Without it the poll loop's own wall clock is
 * decorative: it only re-checks the clock BETWEEN iterations, so a socket stalled mid-body
 * never returns and HEYGEN_LIPSYNC_TIMEOUT_MS is never reached — the host lane then parks a
 * scene forever, which is what `withSceneDeadline` exists to paper over.
 */
const CALL_TIMEOUT_MS = Number(process.env.HEYGEN_CALL_TIMEOUT_MS ?? 120_000);
/** The finished-clip download moves real bytes, so it gets more room than an API call. */
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.HEYGEN_DOWNLOAD_TIMEOUT_MS ?? 300_000
);
const callSignal = () => AbortSignal.timeout(CALL_TIMEOUT_MS);

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 5_000;

/**
 * Render-completion callback URL, or `null` when `PUBLIC_BASE_URL` is unset (local dev) — then
 * host scenes poll only, exactly as before. The token is derived from JWT_SECRET so there is no
 * extra env to provision; `server/heygenWebhook.ts` derives the same string to authenticate the
 * incoming POST. HeyGen sends per-request callbacks unsigned, so the token is the ONLY gate and
 * the body is treated as an untrusted hint (see `pollVideo`).
 */
export function heygenCallbackUrl(): string | null {
  const base = ENV.publicBaseUrl.replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/api/webhooks/heygen/${heygenWebhookToken()}`;
}

export function heygenWebhookToken(): string {
  return createHash("sha256")
    .update(`${ENV.cookieSecret}:heygen-webhook`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Poll loops parked on a video id, plus the ids whose webhook landed with nobody listening.
 * The webhook is a WAKE SIGNAL only: it shortens the gap between "HeyGen finished" and "we ask",
 * and `pollVideo` still does the authoritative GET + download. A missed/undelivered callback
 * costs nothing but the fallback poll interval.
 * ponytail: in-memory — a restart or a second instance simply polls. `notified` retains an id
 * only when its poll loop already exited (job abandoned), so the leak is one string per orphan.
 */
const heygenWaiters = new Map<string, Set<() => void>>();
const notifiedVideoIds = new Set<string>();

/** Called by the webhook route: wake every poll loop waiting on this video. */
export function notifyHeygenVideo(videoId: string): void {
  const waiting = heygenWaiters.get(videoId);
  if (!waiting?.size) {
    // Callback beat the next poll's wait window (or the render is already downloaded) — remember
    // it so the next wait returns immediately instead of burning a full backoff.
    notifiedVideoIds.add(videoId);
    return;
  }
  heygenWaiters.delete(videoId);
  waiting.forEach(wake => wake());
}

/**
 * Promise that settles when `videoId`'s completion webhook lands. `cancel()` unregisters it so an
 * abandoned wait can't retain the resolver.
 */
export function waitForHeygenVideo(videoId: string): {
  wait: Promise<void>;
  cancel: () => void;
} {
  if (notifiedVideoIds.delete(videoId))
    return { wait: Promise.resolve(), cancel: () => {} };
  let wake!: () => void;
  const wait = new Promise<void>(resolve => (wake = resolve));
  const waiting = heygenWaiters.get(videoId) ?? new Set<() => void>();
  waiting.add(wake);
  heygenWaiters.set(videoId, waiting);
  return {
    wait,
    cancel: () => {
      const set = heygenWaiters.get(videoId);
      if (!set) return;
      set.delete(wake);
      if (!set.size) heygenWaiters.delete(videoId);
    },
  };
}

/** Sleep `ms` before the next status GET, waking early on the completion webhook. */
async function waitBeforeNextPoll(
  videoId: string,
  ms: number
): Promise<boolean> {
  if (!heygenCallbackUrl()) {
    await sleep(ms);
    return false;
  }
  const w = waitForHeygenVideo(videoId);
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

function retryDelay(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 3000);
  return Math.min(base + jitter, 30_000);
}

/**
 * Photo-avatar registration cache: `<key fingerprint>:<host photo URL>` → avatar_id promise.
 * HeyGen requires the photo to be registered as an avatar before video creation; registration
 * is billed $0 but is ASYNC — creating a video before the avatar group reaches status
 * "completed" fails with "missing image dimensions". Caching the in-flight promise dedupes the
 * many concurrent host-scene chunks of a job to a single registration per photo.
 * An avatar_id belongs to the ACCOUNT that registered it, so the key fingerprint is part of the
 * cache key: without it, two long-form tabs on different HeyGen keys sharing a host photo would
 * have the second tab reuse the first account's foreign avatar_id and fail every video create.
 * ponytail: in-memory only — a restart re-registers (free, ~30s once per process per account).
 */
const avatarIdByPhotoUrl = new Map<string, Promise<string>>();

/**
 * HeyGen v3 adapter for host lip-sync (Avatar IV) — the ONLY host lip-sync provider.
 * Flow: register photo avatar (cached) → POST /videos with our own TTS audio_url
 * (HeyGen voices are never used) → poll GET /videos/{id} until completed/failed.
 */
export class HeygenLipsyncAdapter {
  private apiKey: string;
  /** Short hash of the key — scopes the account-owned avatar cache. Never logged. */
  private keyFp: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.keyFp = createHash("sha1").update(apiKey).digest("hex").slice(0, 8);
  }

  private jsonHeaders(): Record<string, string> {
    return { "x-api-key": this.apiKey, "Content-Type": "application/json" };
  }

  /** Register `imageUrl` as a photo avatar and wait until it is ready to render. */
  private async registerAvatar(imageUrl: string): Promise<string> {
    const name = `host-${createHash("sha1").update(imageUrl).digest("hex").slice(0, 10)}`;
    const res = await fetch(`${HEYGEN_API_BASE}/avatars`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        type: "photo",
        name,
        file: { type: "url", url: imageUrl },
      }),
      signal: callSignal(),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { avatar_item?: { id?: string }; avatar_group?: { id?: string } };
    };
    const avatarId = body.data?.avatar_item?.id;
    if (!res.ok || !avatarId) {
      throw new Error(
        `HeyGen avatar registration failed (${res.status}): ${JSON.stringify(body).substring(0, 300)}`
      );
    }
    const groupId = body.data?.avatar_group?.id;
    if (groupId) await this.waitForAvatarReady(groupId);
    else await sleep(60_000); // no group id in response — flat wait, observed ready well within 1 min
    console.log(`[HeyGen] Photo avatar registered: ${avatarId} (${name})`);
    return avatarId;
  }

  private async waitForAvatarReady(
    groupId: string,
    maxWaitMs = 180_000
  ): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const res = await fetch(`${HEYGEN_API_BASE}/avatars/${groupId}`, {
        headers: this.jsonHeaders(),
        signal: callSignal(),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { status?: string };
      };
      if (body.data?.status === "completed") return;
      await sleep(5_000);
    }
    throw new Error(
      `HeyGen avatar group ${groupId} not ready within ${maxWaitMs}ms`
    );
  }

  private ensureAvatar(imageUrl: string): Promise<string> {
    const cacheKey = `${this.keyFp}:${imageUrl}`;
    let pending = avatarIdByPhotoUrl.get(cacheKey);
    if (!pending) {
      pending = this.registerAvatar(imageUrl);
      avatarIdByPhotoUrl.set(cacheKey, pending);
      // Drop a failed registration so the next chunk retries instead of caching the error.
      pending.catch(() => avatarIdByPhotoUrl.delete(cacheKey));
    }
    return pending;
  }

  /**
   * Submit one lip-sync job. Always renders 1080p (same price as 720p; the 1080p
   * assembly canvas gets real detail instead of an upscale) with
   * `expressiveness: "low"` — the calmest Avatar IV setting; `high`'s motion bursts
   * read as jitter on an elderly host (measured on job 160 scene 11).
   * Returns the HeyGen `video_id` as `taskId` for resume-safe polling.
   */
  async submitLipsync(params: LipsyncParams): Promise<VideoSubmitResult> {
    let avatarId: string;
    try {
      avatarId = await this.ensureAvatar(params.imageUrl);
    } catch (err: any) {
      return { error: err.message || "HeyGen avatar registration failed" };
    }

    // The avatar group reports "completed" slightly BEFORE the talking photo itself is
    // renderable — video create then 400s with "missing image dimensions" for a short
    // window (verified live: the same request succeeds on retry). Give that specific
    // error its own patient retry budget instead of burning the generic attempts.
    let notReadyRetries = 0;
    const MAX_NOT_READY_RETRIES = 12; // × 15s = 3 min
    const callbackUrl = heygenCallbackUrl();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${HEYGEN_API_BASE}/videos`, {
          method: "POST",
          headers: this.jsonHeaders(),
          body: JSON.stringify({
            type: "avatar",
            avatar_id: avatarId,
            audio_url: params.audioUrl,
            // expressiveness is TOP-LEVEL, not an engine field — nesting it 400s with
            // "Extra inputs are not permitted" (the Avatar IV guide shows it nested; the
            // API reference and the live API disagree with the guide).
            expressiveness: "low",
            engine: { type: "avatar_iv" },
            resolution: "1080p",
            aspect_ratio: "16:9",
            title: "longform host clip",
            // Per-request completion callback (no account-level webhook endpoint to register, so
            // nothing to provision per HeyGen key). Omitted entirely when unconfigured.
            ...(callbackUrl ? { callback_url: callbackUrl } : {}),
          }),
          signal: callSignal(),
        });

        if (!response.ok) {
          const errText = await response.text();
          if (
            response.status === 400 &&
            /missing image dimensions/i.test(errText) &&
            notReadyRetries < MAX_NOT_READY_RETRIES
          ) {
            notReadyRetries++;
            attempt--; // doesn't count against the generic retry budget
            console.log(
              `[HeyGen] Avatar ${avatarId} not renderable yet, retrying in 15s (${notReadyRetries}/${MAX_NOT_READY_RETRIES})...`
            );
            await sleep(15_000);
            continue;
          }
          const retriable = response.status === 429 || response.status >= 500;
          if (retriable && attempt < MAX_RETRIES) {
            const retryAfter = response.headers.get("Retry-After");
            const waitMs =
              response.status === 429 && retryAfter
                ? Math.min(parseInt(retryAfter, 10) * 1000, 60_000) ||
                  retryDelay(attempt)
                : retryDelay(attempt);
            console.log(
              `[HeyGen] submit ${response.status}, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1})...`
            );
            await sleep(waitMs);
            continue;
          }
          return {
            error: `HeyGen API error (${response.status}): ${summarizeHttpBody(errText, 500)}`,
          };
        }

        const data = (await response.json()) as {
          data?: { video_id?: string };
        };
        const videoId = data.data?.video_id;
        if (!videoId) return { error: "HeyGen returned no video_id" };
        console.log(`[HeyGen] Lip-sync video submitted: ${videoId}`);
        return { taskId: videoId };
      } catch (err: any) {
        const isNetworkErr =
          /terminated|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|abort|closed/i.test(
            err.message || ""
          );
        if (attempt < MAX_RETRIES && isNetworkErr) {
          await sleep(retryDelay(attempt));
          continue;
        }
        return { error: err.message || "Unknown error during HeyGen submit" };
      }
    }
    return { error: "HeyGen submit failed after retries" };
  }

  /**
   * Poll a HeyGen video to completion and download the result. Returns
   * `{ pending: true }` on client timeout (job ID stays persisted for resume);
   * `failed` — and an unknown/404 video id, e.g. a stale RunPod taskId resumed after
   * the provider swap — return `infraFailure: true` so the orchestrator clears the IDs
   * and re-submits fresh on the resume pass.
   */
  async pollVideo(
    taskId: string,
    timeoutMs: number = HEYGEN_LIPSYNC_TIMEOUT_MS
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    let delay = 5_000;
    let pollCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      if (await waitBeforeNextPoll(taskId, delay))
        console.log(`[HeyGen] webhook wake ${taskId}`);
      // With a callback configured the webhook is the primary signal and this poll is only the
      // safety net, so it may drift further out; without one it stays the 20s cadence.
      delay = Math.min(delay * 1.5, heygenCallbackUrl() ? 60_000 : 20_000);
      pollCount++;

      try {
        const resp = await fetch(`${HEYGEN_API_BASE}/videos/${taskId}`, {
          headers: this.jsonHeaders(),
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

        if (resp.status === 404 || resp.status === 400) {
          // Unknown video id (includes stale RunPod taskIds after the provider swap) —
          // terminal, let the orchestrator re-submit fresh.
          const errText = await resp.text();
          return {
            success: false,
            taskId,
            error: `HeyGen video not found (${resp.status}): ${summarizeHttpBody(errText, 200)}`,
            infraFailure: true,
          };
        }

        if (!resp.ok) {
          const errText = await resp.text();
          console.warn(
            `[HeyGen] Poll error (${resp.status}): ${summarizeHttpBody(errText, 200)}`
          );
          await sleep(5_000 + Math.floor(Math.random() * 3000));
          continue;
        }

        const body = (await resp.json()) as {
          data?: {
            status?: string;
            video_url?: string;
            failure_code?: string;
            failure_message?: string;
          };
        };
        const data = body.data ?? {};

        if (data.status === "completed") {
          if (!data.video_url) {
            return {
              success: false,
              taskId,
              error: "HeyGen video completed but returned no video_url",
              infraFailure: true,
            };
          }
          console.log(
            `[HeyGen] Video ${taskId} completed — wall ${Math.round((Date.now() - startTime) / 1000)}s | polls ${pollCount}`
          );
          const dl = await fetch(data.video_url, {
            redirect: "follow",
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
          });
          if (!dl.ok) {
            return {
              success: false,
              taskId,
              error: `HeyGen video download failed (${dl.status})`,
              infraFailure: true,
            };
          }
          return {
            success: true,
            fileData: Buffer.from(await dl.arrayBuffer()),
            mimeType: "video/mp4",
            taskId,
          };
        }

        if (data.status === "failed") {
          const reason =
            data.failure_message || data.failure_code || "HeyGen render failed";
          console.log(`[HeyGen] Video ${taskId} terminal: ${reason}`);
          return { success: false, taskId, error: reason, infraFailure: true };
        }

        // pending / processing — keep polling
      } catch (err: any) {
        console.warn(`[HeyGen] Poll network error: ${err.message}`);
        await sleep(5_000);
      }
    }

    return {
      success: false,
      pending: true,
      taskId,
      error: `Client timed out after ${Math.round(timeoutMs / 1000)}s. The video may still be rendering on HeyGen.`,
    };
  }

  /**
   * Remaining API credits on this key's account, or `null` if the call fails — which
   * doubles as a key/gateway health signal for the admin panel.
   */
  async getRemainingQuota(): Promise<number | null> {
    try {
      const res = await fetch(HEYGEN_QUOTA_URL, {
        headers: { "x-api-key": this.apiKey },
        signal: callSignal(),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: { remaining_quota?: number };
      };
      const raw = body.data?.remaining_quota;
      return typeof raw === "number" ? raw / HEYGEN_QUOTA_PER_CREDIT : null;
    } catch {
      return null;
    }
  }
}

import type { GenerationResult } from "../../shared/types";
import type {
  ProviderAdapter,
  VideoGenerationParams,
  ImageGenerationParams,
} from "./base";
import { GeminiImageAdapter } from "./gemini-image";
import { ENV } from "../_core/env";
// AIREITER BOLT-ON (temporary) — delete with the branch in `generateStillWithFallback`.
import { aireiterLaneEnabled } from "./aireiter";

/**
 * Wraps a primary provider adapter (e.g. 69Labs) and automatically falls back to
 * Google Gemini (gemini-3.1-flash-image) for any image that the primary fails to
 * produce. Video generation and connection testing delegate straight to the
 * primary — only image generation gains the fallback behavior.
 *
 * Fallback triggers on ANY primary image failure: a returned `{success:false}`,
 * a thrown exception, OR the primary exceeding its time budget. The budget is
 * critical: the 69Labs adapter's internal retry loop can take ~12 minutes to give
 * up when jobs hang PENDING, which is far longer than the 5-minute DB timeout
 * (server/generationTimeout.ts) that marks the generation failed. Racing the
 * primary against `ENV.imagePrimaryTimeoutMs` lets us fail over to Gemini well
 * within that window so the user still gets an image.
 *
 * A lightweight circuit breaker avoids paying the full budget on every image
 * during a sustained outage: after a couple of budget-exceeded failovers, the
 * breaker opens and subsequent images route straight to Gemini for a cooldown.
 */

/**
 * Still/keyframe generation with a Gemini fallback — the signature `generateValidatedStill`
 * expects for its `genImage` argument.
 *
 * Why this exists: `FallbackImageAdapter` only wraps the PROVIDER adapter (69Labs). The still
 * and b-roll-keyframe lanes call `generateOpenAIStill` directly, so `gpt-image-2` was the sole
 * source for ~65% of scenes with no fallback at all — an empty OpenAI balance failed whole
 * renders outright (job 3: "2 scene(s) have no clip"). Routing them through here makes OpenAI
 * genuinely PRIMARY-with-fallback, which is what the architecture already claimed.
 *
 * Deliberately NOT budget-raced like `FallbackImageAdapter`: the OpenAI adapter has its own
 * call timeout (`OPENAI_IMAGE_CALL_TIMEOUT_MS`), so a second racing timer here would only
 * fight it. Fallback triggers on a returned `{success:false}` or a throw.
 */
export async function generateStillWithFallback(input: {
  prompt: string;
  referenceImageUrl?: string;
  square?: boolean;
  apimartKey?: string | null;
}): Promise<GenerationResult> {
  let primaryError = "unknown error";
  try {
    // ─── AIREITER BOLT-ON (temporary) ──────────────────────────────────────
    // Spends prepaid AIReiter credits on stills/keyframes instead of APIMART/OpenAI. Same
    // gpt-image-2 model, different gateway. Off unless AIREITER_LANES names `stills`.
    // TO REMOVE: delete this branch and change the `} else if (input.apimartKey) {` below
    // back to `if (input.apimartKey) {`. See server/providers/aireiter.ts.
    if (await aireiterLaneEnabled("stills")) {
      const { aireiterStill } = await import("./aireiter");
      const r = await aireiterStill(input);
      if (r.success) return r;
      primaryError = r.error ?? "AIReiter returned no image";
      // ─── END AIREITER BOLT-ON ────────────────────────────────────────────
    } else if (input.apimartKey) {
      // Architecture Stage 3: APIMART is the sole still/keyframe provider.
      const { ApimartAdapter } = await import("./apimart");
      const apimart = new ApimartAdapter(input.apimartKey);
      const [r] = await apimart.generateImage({
        prompt: input.prompt,
        model: "gpt-image-2", // APIMART hardcodes this internally; required by ImageGenerationParams
        aspectRatio: input.square ? "1:1" : "16:9",
        count: 1,
        ...(input.referenceImageUrl
          ? { imageUrls: [input.referenceImageUrl] }
          : {}),
      });
      if (r?.success) return r;
      primaryError = r?.error ?? "APIMART returned no image";
    } else {
      // No APIMART key configured — fall through to direct OpenAI.
      const { generateOpenAIStill } = await import("./openai-image");
      const r = await generateOpenAIStill(input);
      if (r.success) return r;
      primaryError = r.error ?? "primary returned no image";
    }
  } catch (err: any) {
    primaryError = err?.message ?? String(err);
  }

  // No Gemini fallback: per the final architecture, Stage 3 is APIMART-only.
  // Failing fast surfaces the real error instead of burning the free-tier Gemini quota.
  return { success: false, error: primaryError };
}

// ─── Circuit breaker state (module-level, shared across calls) ───
let consecutiveTimeouts = 0;
let breakerOpenUntil = 0; // epoch ms; primary is skipped while now < this
const BREAKER_THRESHOLD = 2; // open after this many consecutive budget-exceeded failovers
const BREAKER_COOLDOWN_MS = 120_000; // 2 minutes

/** Test-only: reset breaker state between tests. */
export function __resetBreaker(): void {
  consecutiveTimeouts = 0;
  breakerOpenUntil = 0;
}

/** Sentinel returned when the primary exceeds its time budget. */
const TIMEOUT_SENTINEL = Symbol("primary-timeout");

export class FallbackImageAdapter implements ProviderAdapter {
  private primary: ProviderAdapter;

  // Optional resumable-video seam. Forwarded straight to the primary, but only when the
  // primary actually implements them — so callers (longform) can feature-detect submit/poll
  // through the wrapper. Without this forwarding the wrapper would always hide these methods
  // and force the no-resume legacy video path. Video gets no image-style fallback either way.
  submitVideo?: ProviderAdapter["submitVideo"];
  pollVideo?: ProviderAdapter["pollVideo"];

  constructor(primary: ProviderAdapter) {
    this.primary = primary;
    if (primary.submitVideo) {
      this.submitVideo = params => primary.submitVideo!(params);
    }
    if (primary.pollVideo) {
      this.pollVideo = (taskId, timeoutMs) =>
        primary.pollVideo!(taskId, timeoutMs);
    }
  }

  /** Generate `count` images via Gemini, returning exactly `count` slots. */
  private async geminiBatch(
    params: ImageGenerationParams,
    count: number
  ): Promise<GenerationResult[]> {
    const gemini = new GeminiImageAdapter();
    const recovered = await gemini.generateImage({ ...params, count });
    return Array.from(
      { length: count },
      (_, i) =>
        recovered[i] ?? { success: false, error: "Gemini returned no result" }
    );
  }

  /**
   * Run the primary once, waiting at most `budgetMs`. Returns the primary's results, or
   * `TIMEOUT_SENTINEL` if the budget elapsed first. The 69Labs adapter can block for ~12 min
   * on hung jobs, so a budget is essential. A late primary rejection (it can throw minutes
   * after we abandon it) is swallowed so it never surfaces as an unhandled rejection.
   */
  private async runPrimaryBudgeted(
    params: ImageGenerationParams,
    budgetMs: number
  ): Promise<GenerationResult[] | typeof TIMEOUT_SENTINEL> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const primaryPromise = this.primary.generateImage(params).then(
      r => r,
      err => {
        console.warn(`[ImageFallback] primary threw: ${err?.message || err}`);
        return [] as GenerationResult[];
      }
    );

    const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), budgetMs);
    });

    try {
      return await Promise.race([primaryPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async generateImage(
    params: ImageGenerationParams
  ): Promise<GenerationResult[]> {
    const count = Math.max(1, params.count);
    const hasGeminiKey = !!ENV.geminiApiKey && !params.noGeminiFallback;

    // A video-only primary can never produce images — skip the pointless
    // primary attempt and its [ImageFallback] warning, go straight to Gemini.
    if (this.primary.supportsImageGeneration === false) {
      if (!hasGeminiKey) {
        throw new Error(
          "Active provider does not support image generation and GEMINI_API_KEY is not set"
        );
      }
      return this.geminiBatch(params, count);
    }

    // 0. Circuit breaker: if the primary is known-down, skip it entirely and go
    //    straight to Gemini. Only when a Gemini fallback is actually available.
    if (hasGeminiKey && Date.now() < breakerOpenUntil) {
      console.warn(
        `[ImageFallback] breaker open — routing ${count} image(s) straight to Gemini`
      );
      return this.geminiBatch(params, count);
    }

    // 1. Try the primary, retrying ONLY the still-failing slots up to imagePrimaryRetries
    //    times before any Gemini fallback. The same prompt's slots are interchangeable, so a
    //    retry just re-renders `pending.length` images. Both an in-budget failure AND a
    //    budget-exceeded timeout are retried. On no-heartbeat callers a total-time ceiling
    //    keeps the whole phase under the 5-min DB image timeout; heartbeated callers (shuttle)
    //    touch updatedAt every 60s and so use the full retry count.
    const start = Date.now();
    const maxAttempts = 1 + Math.max(0, ENV.imagePrimaryRetries);

    const normalized: GenerationResult[] = Array.from(
      { length: count },
      () => ({
        success: false,
        error: "primary not attempted",
      })
    );
    let pending: number[] = Array.from({ length: count }, (_, i) => i);
    let attempts = 0;

    for (
      let attempt = 0;
      attempt < maxAttempts && pending.length > 0;
      attempt++
    ) {
      // No-heartbeat deadline guard: don't start a retry that can't finish under the cap.
      if (
        attempt > 0 &&
        !params.heartbeated &&
        Date.now() - start + ENV.imageRetryTimeoutMs >
          ENV.imageRetryTotalBudgetMs
      ) {
        break;
      }

      const budgetMs =
        attempt === 0 ? ENV.imagePrimaryTimeoutMs : ENV.imageRetryTimeoutMs;
      attempts = attempt + 1;

      const raced = await this.runPrimaryBudgeted(
        { ...params, count: pending.length },
        budgetMs
      );

      // Budget exceeded → abandon this attempt (it keeps running in the background, its
      // result discarded) and retry the primary (pending unchanged).
      if (raced === TIMEOUT_SENTINEL) {
        consecutiveTimeouts++;
        if (consecutiveTimeouts >= BREAKER_THRESHOLD) {
          breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
        }
        // Record the real reason so a subsequent budget-guard break surfaces "timed out"
        // instead of the "primary not attempted" placeholder. Overwritten by a later success
        // or the Gemini result, so it only shows when the timeout is the final primary state.
        for (const slot of pending) {
          normalized[slot] = {
            success: false,
            error: `primary timed out (budget ${budgetMs}ms exceeded)`,
          };
        }
        continue;
      }

      // Primary returned within budget. Map results back into the pending slots and
      // recompute which slots still need an image.
      const stillPending: number[] = [];
      pending.forEach((slot, k) => {
        const r = raced[k];
        if (r?.success) {
          normalized[slot] = r;
        } else {
          normalized[slot] = r ?? {
            success: false,
            error: "primary returned no result",
          };
          stillPending.push(slot);
        }
      });

      // Any in-budget success closes the breaker — primary is healthy again.
      if (stillPending.length < pending.length) {
        consecutiveTimeouts = 0;
        breakerOpenUntil = 0;
      }

      pending = stillPending;
    }

    const retries = Math.max(0, attempts - 1);
    const retryLabel = `${retries} retr${retries === 1 ? "y" : "ies"}`;

    // 2. Primary produced every slot.
    if (pending.length === 0) return normalized;

    // 3. No Gemini key → graceful no-op, return primary results unchanged.
    if (!hasGeminiKey) {
      console.warn(
        `[ImageFallback] ${pending.length}/${count} image(s) failed after ${retryLabel} but GEMINI_API_KEY is not set — skipping fallback`
      );
      return normalized;
    }

    // Capture the primary's failure reason(s) BEFORE Gemini overwrites the slots, so the
    // log surfaces WHY the primary failed (e.g. a 400 "does not support resolution") instead
    // of silently masking it behind a successful Gemini recovery.
    const primaryReasons = Array.from(
      new Set(
        pending
          .map(slot => normalized[slot]?.error)
          .filter((e): e is string => Boolean(e))
      )
    );
    const reasonLabel = primaryReasons.length
      ? ` (primary: ${primaryReasons.join(" | ")})`
      : "";

    // 4. Last resort: regenerate the still-failing slots via Gemini.
    const recovered = await this.geminiBatch(
      { ...params, count: pending.length },
      pending.length
    );

    let recoveredCount = 0;
    pending.forEach((slot, k) => {
      const replacement = recovered[k];
      if (replacement?.success) {
        normalized[slot] = replacement;
        recoveredCount++;
      }
    });

    console.warn(
      `[ImageFallback] 69Labs failed ${pending.length}/${count} after ${retryLabel}${reasonLabel} → Gemini recovered ${recoveredCount}/${pending.length}`
    );

    return normalized;
  }

  generateVideo(params: VideoGenerationParams): Promise<GenerationResult[]> {
    return this.primary.generateVideo(params);
  }

  testConnection(): Promise<{ success: boolean; message: string }> {
    return this.primary.testConnection();
  }
}

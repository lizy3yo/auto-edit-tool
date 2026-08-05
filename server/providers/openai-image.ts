import { ENV } from "../_core/env";
import type { GenerationResult } from "../../shared/types";

/**
 * OpenAI gpt-image-2 for longform b-roll/still images. Text-to-image via
 * `/v1/images/generations`; when a reference image is supplied (the channel
 * book cover on a `showsBook` beat) it's image-to-image via `/v1/images/edits`.
 *
 * Fixed at 16:9 1280×720 / low quality.
 *
 * ponytail: 720p BY DECISION, then upscaled to the 1920×1080 assembly canvas (`dimensionsFor`)
 * like the other two lanes — the export is 1080p only for YouTube's bitrate ladder (it tiers by
 * upload resolution), NOT because any source is 1080p. This saves little memory: the Ken Burns
 * render scales the still to the full canvas regardless of its native size.
 * Upgrade path, measured & near-free: 2048×1152 (both dims /16 — gpt-image-2 rejects others) would
 * make the still lane (~50% of runtime) the ONE genuinely-1080p lane at 106→157 output tokens
 * (~$0.003→$0.005/image, ~+$0.24/video); flip it back here if real-1080p stills are wanted,
 * nothing else changes. `low` governs render tokens (detail DRAWN) — a cost choice with a known
 * softness ceiling; bump to `medium` if stills read soft.
 *
 * Uses raw `fetch` (no `openai` SDK) to match `server/_core/voiceTranscription.ts`.
 * Returns the shared `GenerationResult` shape so `generateValidatedStill`'s
 * retry/validation loop is reused unchanged. On a non-2xx it surfaces OpenAI's
 * error text verbatim so `isContentPolicyError` (matches "safety"/"moderation")
 * can short-circuit the retry loop on a moderation block.
 */
export const OPENAI_IMAGE_SIZE = "1280x720" as const; // 16:9, both dims /16 (API rule)
/**
 * Square variant, requested via `square: true` — the split-screen right panel is a full-height
 * 1:1 slot, so its still must be composed square or the composite crops its sides off.
 *
 * 1024x1024 is a DOCUMENTED gpt-image-2 preset, so it can't be rejected. It also clears the
 * custom-size rules either way: both edges /16, and 1,048,576 px sits inside the 655,360–8,294,400
 * range (the 16:9 default's 921,600 does too). Size choice stays in here, where those rules are
 * written down — callers pass a flag, never a dimension string.
 */
export const OPENAI_IMAGE_SIZE_SQUARE = "1024x1024" as const;
export const OPENAI_IMAGE_QUALITY = "low" as const;
const OPENAI_IMAGE_MODEL = "gpt-image-2";

/**
 * Whole-call ceiling on every OpenAI image request. `longformVideo.ts:5426` names this exact
 * gap as the cause of the prod 140/141/143 stalls: "the still lane has no timeout anywhere in
 * its path (runFfmpeg spawn, the OpenAI image fetches, storagePut)", which left `mapPool`'s
 * Promise.all permanently unsettled. Generation is slow (a gpt-image-2 render runs minutes), so
 * this sits well above the legitimate worst case — it exists only to catch a socket that will
 * otherwise never return at all.
 */
const CALL_TIMEOUT_MS = Number(
  process.env.OPENAI_IMAGE_CALL_TIMEOUT_MS ?? 300_000
);
const callSignal = () => AbortSignal.timeout(CALL_TIMEOUT_MS);

// ─── Global rate limiter for gpt-image-2 (Token Bucket) ───
// The account is Tier 3: gpt-image-2 is capped at 50 images/min. A longform job needs one keyframe
// per b-roll scene and dispatches ~8 at once with no cross-scene coordination, so without pacing it
// 429-storms and fails dozens of scenes — per-scene backoff can't fix it, since 80 scenes share one
// account IPM budget and each only waits ~60s before giving up. This bucket paces EVERY OpenAI
// image call (text-to-image and edits) to the account IPM so scenes queue instead of collide; the
// caller's backoff (generateValidatedStill) then absorbs the rare straggler 429.
// ponytail: process-global bucket, default 50/min burst 1. Bump OPENAI_IMAGE_RATE_PER_MIN when the
// account tier changes (Tier 1 = 5, Tier 2 = 20, Tier 3 = 50, Tier 4 = 150, Tier 5 = 250).
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const IMG_BUCKET_MAX = Number(process.env.OPENAI_IMAGE_BURST ?? 1);
const OPENAI_IMAGE_RATE_PER_MIN = Number(
  process.env.OPENAI_IMAGE_RATE_PER_MIN ?? 50
);
// ponytail: emit a hair under the account cap so our clock's rolling minute can't
// spill a 6th call into OpenAI's arrival-time window (zero margin was 429-storming
// at exactly Limit 5, Used 5). The 429 cooldown below catches whatever still slips.
const IMG_EFFECTIVE_RATE_PER_MIN = Math.max(1, OPENAI_IMAGE_RATE_PER_MIN - 0.5);
const IMG_REFILL_RATE = IMG_EFFECTIVE_RATE_PER_MIN / 60; // tokens/sec
// The rate window length (≈12s at 5/min): the default cooldown when a 429 carries
// no Retry-After / "try again" hint.
const IMG_WINDOW_MS = (60 / OPENAI_IMAGE_RATE_PER_MIN) * 1000;
let _imgTokens = IMG_BUCKET_MAX;
let _imgLastRefill = Date.now();
// Closed-loop backpressure: a 429 sets a GLOBAL pause so every worker (not just
// the one that failed) waits out OpenAI's reported window instead of re-hitting it.
let _imgCooldownUntil = 0;

/** Extract the retry wait (ms) from a 429: `Retry-After` header, else the
 * "Please try again in 12s" hint in the body, else the rate-window length.
 * Exported for unit testing. */
export function parseImageRetryMs(
  retryAfterHeader: string | null,
  message: string
): number {
  const header = Number(retryAfterHeader);
  if (retryAfterHeader != null && Number.isFinite(header) && header > 0)
    return header * 1000;
  const m = /try again in\s+(\d+(?:\.\d+)?)\s*s/i.exec(message);
  if (m) return Number(m[1]) * 1000;
  return IMG_WINDOW_MS;
}

/** Pause ALL image calls for `retryMs` and drain the bucket — called when OpenAI
 * 429s so concurrent workers back off with the account, not past it. */
export function penalizeImageRateLimit(retryMs: number): void {
  _imgCooldownUntil = Math.max(_imgCooldownUntil, Date.now() + retryMs);
  _imgTokens = 0;
}

async function acquireImageToken(): Promise<void> {
  while (true) {
    const now = Date.now();
    if (now < _imgCooldownUntil) {
      await sleep(Math.max(_imgCooldownUntil - now, 100));
      continue; // re-check cooldown + refill after waiting out the 429 window
    }
    const elapsed = (now - _imgLastRefill) / 1000;
    _imgTokens = Math.min(
      IMG_BUCKET_MAX,
      _imgTokens + elapsed * IMG_REFILL_RATE
    );
    _imgLastRefill = now;
    if (_imgTokens >= 1) {
      _imgTokens -= 1;
      return;
    }
    const waitMs = Math.ceil(((1 - _imgTokens) / IMG_REFILL_RATE) * 1000);
    await sleep(Math.max(waitMs, 100));
  }
}

export async function generateOpenAIStill(input: {
  prompt: string;
  referenceImageUrl?: string;
  /** Render 1:1 instead of 16:9 — the split-screen right panel. */
  square?: boolean;
}): Promise<GenerationResult> {
  const apiKey = ENV.openaiApiKey;
  if (!apiKey)
    return { success: false, error: "OPENAI_API_KEY is not configured" };

  const size = input.square ? OPENAI_IMAGE_SIZE_SQUARE : OPENAI_IMAGE_SIZE;
  try {
    await acquireImageToken(); // pace to the account's gpt-image-2 images-per-min cap
    const res = input.referenceImageUrl
      ? await editWithReference(
          apiKey,
          input.prompt,
          input.referenceImageUrl,
          size
        )
      : await generateFromText(apiKey, input.prompt, size);

    if (!res.ok) {
      // OpenAI errors are JSON `{ error: { message, code } }`; fall back to raw text.
      const body = await res.text();
      let msg = body;
      try {
        const j = JSON.parse(body);
        msg = j?.error?.message || j?.error?.code || body;
      } catch {
        // non-JSON body — use as-is
      }
      // On a 429, pause every image call for the window OpenAI reports so the
      // caller's retry lands after the account resets, not back into the hot window.
      if (res.status === 429) {
        penalizeImageRateLimit(
          parseImageRetryMs(res.headers.get("retry-after"), msg)
        );
      }
      return { success: false, error: `OpenAI image ${res.status}: ${msg}` };
    }

    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) return { success: false, error: "OpenAI returned no image data" };
    return {
      success: true,
      fileData: Buffer.from(b64, "base64"),
      mimeType: "image/png",
    };
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || "OpenAI image request failed",
    };
  }
}

function generateFromText(
  apiKey: string,
  prompt: string,
  size: string
): Promise<Response> {
  return fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt,
      size,
      quality: OPENAI_IMAGE_QUALITY,
      n: 1,
    }),
    signal: callSignal(),
  });
}

async function editWithReference(
  apiKey: string,
  prompt: string,
  referenceImageUrl: string,
  size: string
): Promise<Response> {
  const imgRes = await fetch(referenceImageUrl, { signal: callSignal() });
  if (!imgRes.ok)
    throw new Error(
      `reference image fetch ${imgRes.status} for ${referenceImageUrl}`
    );
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get("content-type") || "image/png";

  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", OPENAI_IMAGE_QUALITY);
  form.append("n", "1");
  form.append(
    "image",
    new Blob([bytes], { type: contentType }),
    "reference.png"
  );

  return fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: callSignal(),
  });
}

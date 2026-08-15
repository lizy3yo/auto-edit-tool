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
import { recordUsage } from "../costMeter";

const BASE_URL = "https://69labs.vip";

/**
 * Active-job concurrency cap for 69Labs video generation. A slot is held for the whole
 * submit→poll lifecycle of one clip (see `runChunkTasks`), so at most this many video jobs are
 * ever in-flight across all longform jobs on this process. This is the hard limit; the video
 * submit token bucket below only shapes how fast jobs ramp up to it.
 */
export const SIXTYNINE_VIDEO_SLOTS = new Semaphore(
  ENV.sixtynineVideoConcurrency
);

/**
 * Active-job concurrency cap for 69Labs image generation. A slot is held for the whole
 * submit→poll→download lifecycle of one image, so at most this many image jobs are
 * ever in-flight across all concurrent callers on this process.
 */
export const SIXTYNINE_IMAGE_SLOTS = new Semaphore(
  ENV.sixtynineImageConcurrency
);

// ─── Polling configuration ───

/**
 * Maximum time to wait for an image task to complete. Must stay ABOVE the
 * FallbackImageAdapter budget (`imagePrimaryTimeoutMs`) so the budget sentinel — not this
 * poll — governs failover to Gemini and the circuit breaker. A poll TIMEOUT here is treated
 * as "still rendering on 69Labs", NOT a failure, so it never resubmits a duplicate job.
 */
export const IMAGE_TIMEOUT_MS = 600_000; // 10 minutes

/** Maximum time to wait for a video task to complete.
 * ponytail: 6 min. A 10-job grok-imagine-video measurement showed real renders finish ≤199s and
 * 69Labs self-fails stuck jobs at ~320s ("providers did not respond"); 360s sits above that fail
 * point so we still receive the real FAILED instead of masking it with a client TIMEOUT, while
 * freeing a stuck video slot far sooner than the old 600s. Override via SIXTYNINE_VIDEO_TIMEOUT_MS. */
const VIDEO_TIMEOUT_MS = Number(
  process.env.SIXTYNINE_VIDEO_TIMEOUT_MS ?? 360_000
); // 6 minutes

/**
 * Whole-call ceiling on every request to 69Labs. Without it the poll loop's own wall clock is
 * decorative: `while (Date.now() - start < VIDEO_TIMEOUT_MS) { await fetch(...) }` only re-checks
 * the clock BETWEEN iterations, so a socket that stalls mid-body never returns and the timeout it
 * exists for is never reached — the parked-worker failure of prod jobs 140/141/143.
 *
 * AbortSignal.timeout, not an undici Agent dispatcher: passing an npm-undici Agent to the
 * runtime's built-in fetch fails every call with a bare "fetch failed" (see apimart.ts).
 */
const CALL_TIMEOUT_MS = Number(
  process.env.SIXTYNINE_CALL_TIMEOUT_MS ?? 120_000
);
/** Downloads move a whole clip, so they get more room than a status poll. */
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.SIXTYNINE_DOWNLOAD_TIMEOUT_MS ?? 300_000
);
const callSignal = () => AbortSignal.timeout(CALL_TIMEOUT_MS);

/** Max retries for transient errors (POST submission) */
const MAX_RETRIES = 3;

/** Base delay between retries (will be multiplied by attempt for backoff) */
const BASE_RETRY_DELAY_MS = 5_000;

// ─── Global Rate Limiter for Submissions (Token Bucket) ───
// Limits image API submissions to prevent 429 bursts.
// Image submit cap: 20/min → 1 token / 3 sec refill.

const SUBMIT_BUCKET_MAX = 3; // max burst size
const SUBMIT_BUCKET_REFILL_RATE = 20 / 60; // tokens per second (20/min)

let _submitBucketTokens = SUBMIT_BUCKET_MAX;
let _submitBucketLastRefill = Date.now();

async function acquireSubmitToken(): Promise<void> {
  while (true) {
    const now = Date.now();
    const elapsed = (now - _submitBucketLastRefill) / 1000;
    _submitBucketTokens = Math.min(
      SUBMIT_BUCKET_MAX,
      _submitBucketTokens + elapsed * SUBMIT_BUCKET_REFILL_RATE
    );
    _submitBucketLastRefill = now;

    if (_submitBucketTokens >= 1) {
      _submitBucketTokens -= 1;
      return;
    }

    const waitMs = Math.ceil(
      ((1 - _submitBucketTokens) / SUBMIT_BUCKET_REFILL_RATE) * 1000
    );
    await sleep(Math.max(waitMs, 100));
  }
}

// ─── Video Submit Limiter (Token Bucket) ───
// Shapes the *rate* of `POST /videos/generate` to avoid 429 bursts. This is ORTHOGONAL to the
// active-job cap (`SIXTYNINE_VIDEO_SLOTS`): the semaphore bounds how many jobs run at once, this
// bounds how fast they're submitted.
// ponytail: API cap is 5 req/min (docs/69labs-api.md:292). Default 5/min spends the full cap (a
// probe at ~4.6/min saw zero 429s); the old 30/min default was 6x over and a standing 429 risk.
// Override via env vars.

const VIDEO_SUBMIT_BUCKET_MAX = Number(
  process.env.SIXTYNINE_VIDEO_SUBMIT_BURST ?? 2
); // small burst (a 429 retry needs a 2nd token to resubmit promptly)
const VIDEO_SUBMIT_REFILL_RATE =
  Number(process.env.SIXTYNINE_VIDEO_SUBMIT_RATE ?? 5) / 60; // tokens per second ≈ 5/min

let _videoSubmitBucketTokens = VIDEO_SUBMIT_BUCKET_MAX;
let _videoSubmitBucketLastRefill = Date.now();

async function acquireVideoSubmitToken(): Promise<void> {
  while (true) {
    const now = Date.now();
    const elapsed = (now - _videoSubmitBucketLastRefill) / 1000;
    _videoSubmitBucketTokens = Math.min(
      VIDEO_SUBMIT_BUCKET_MAX,
      _videoSubmitBucketTokens + elapsed * VIDEO_SUBMIT_REFILL_RATE
    );
    _videoSubmitBucketLastRefill = now;

    if (_videoSubmitBucketTokens >= 1) {
      _videoSubmitBucketTokens -= 1;
      return;
    }

    const waitMs = Math.ceil(
      ((1 - _videoSubmitBucketTokens) / VIDEO_SUBMIT_REFILL_RATE) * 1000
    );
    await sleep(Math.max(waitMs, 100));
  }
}

// ─── Global Poll Throttler ───
// Limits concurrent-poll bursts that trigger 69Labs 429s. The 429s come from synchronized BURSTS,
// not sustained rate: a burst=8 rate=6/sec bucket fired 10 polls in ~2s, saturating the ~20s
// rate-limit window. The documented `GET /*/status/*` ceiling is 120/min, and a steady ~500ms
// pacer (validated by test_69labs_image_concurrency.ts) holds it without 429s. So spend the full
// 120/min, but smoothly: small burst keeps spacing ~500ms under contention.
// ponytail: 2/sec, burst 2. With 60 image + 30 video in-flight, 60/min meant each job polled ~once
// per 90s (detectLatency 77-208s, slots locked). 120/min ≈ every 45s, halving detectLatency so
// the 60/30 slots actually cycle. The 429/Retry-After handler self-throttles if the real ceiling
// is lower. Uses a simple token bucket with jitter.

const POLL_BUCKET_MAX = 2; // small burst — keeps spend smooth (~500ms spacing), no synchronized hammer
const POLL_BUCKET_REFILL_RATE = 2; // 2 tokens/sec (120/min) — the documented status ceiling

let _pollBucketTokens = POLL_BUCKET_MAX;
let _pollBucketLastRefill = Date.now();

// ─── Poll Priority ───
// The 120/min bucket is heavily oversubscribed: 60 image + 30 video jobs polling round-robin get
// a token only ~every 45s each, so a render that finished server-side waits ~45-140s to be DETECTED
// (logs: `detectLatency 100-140s`). That latency pushes a healthy still past the 240s image budget
// and terminally fails the scene. Fix: don't spend scarce tokens equally — serve jobs that are
// PROCESSING/FINALIZING (about to complete; detection latency matters) ahead of PENDING ones (still
// queued provider-side; polling sooner reveals nothing). A waiter only takes a token when no
// strictly-higher-priority waiter is queued. PENDING can't starve — a job leaves PENDING once the
// provider starts rendering, and unblocked tokens still respect the 2/sec ceiling (no 429 risk).
// ponytail: 3 priority tiers, counted waiters. Per-tier fairness if no upgrade path appears.
export type PollPriority = 0 | 1 | 2; // 0 = FINALIZING (most urgent), 1 = PROCESSING, 2 = PENDING
const _pollWaitersByPriority = [0, 0, 0];

/** Map a job's last-seen status to a poll priority. Pure — exported for unit testing. */
export function pollPriorityFor(lastStatus: string): PollPriority {
  if (lastStatus === "FINALIZING") return 0;
  if (lastStatus === "PROCESSING") return 1;
  return 2;
}

export async function acquirePollToken(
  priority: PollPriority = 2
): Promise<void> {
  _pollWaitersByPriority[priority]++;
  try {
    while (true) {
      const now = Date.now();
      const elapsed = (now - _pollBucketLastRefill) / 1000;
      _pollBucketTokens = Math.min(
        POLL_BUCKET_MAX,
        _pollBucketTokens + elapsed * POLL_BUCKET_REFILL_RATE
      );
      _pollBucketLastRefill = now;

      // Yield to any strictly-more-urgent waiter so near-complete jobs are detected first.
      const higherWaiting = _pollWaitersByPriority
        .slice(0, priority)
        .some(c => c > 0);

      if (_pollBucketTokens >= 1 && !higherWaiting) {
        _pollBucketTokens -= 1;
        return;
      }

      const waitMs = Math.ceil(
        ((1 - _pollBucketTokens) / POLL_BUCKET_REFILL_RATE) * 1000
      );
      // Add jitter (0-200ms) to prevent synchronized bursts. A lower-priority waiter that's
      // yielding still wakes within this window to re-check once the higher-priority one clears.
      const jitter = Math.floor(Math.random() * 200);
      await sleep(Math.max(waitMs + jitter, 100));
    }
  } finally {
    _pollWaitersByPriority[priority]--;
  }
}

// ─── Credits Detection ───
// Matches actual credit/quota exhaustion but NOT rate-limit errors.
const CREDITS_REGEX = /credit|quota|insufficient/i;
// Reassurance/refund phrasing that MENTIONS credits but is NOT a credits error.
// Grok's transient FAILED includes "No credits were taken out of your account",
// which naively matched CREDITS_REGEX and was misreported as "credits depleted".
const CREDITS_REFUND_REGEX =
  /no credits?|credits? (?:were|are|was)?\s*(?:not|n't)?\s*(?:taken|charged|deducted|refunded)|refunded|no charge/i;

/**
 * True only when an error genuinely indicates credit/quota exhaustion.
 * The documented machine code `PAYMENT_REQUIRED` is authoritative; otherwise we
 * match credit/quota wording but EXCLUDE refund/reassurance phrasing so a
 * transient provider timeout ("...No credits were taken out...") is not flagged.
 * Pure — exported for unit testing. Accepts either a raw error JSON body
 * (submission path) or a plain detail message (render-FAILED path).
 */
export function isCreditsError(text: string | undefined | null): boolean {
  if (!text) return false;
  if (/PAYMENT_REQUIRED/.test(text)) return true;
  return CREDITS_REGEX.test(text) && !CREDITS_REFUND_REGEX.test(text);
}

/**
 * True for transient video failures worth resubmitting. 69Labs FAILED refunds
 * credits and the docs recommend re-submitting the same input, so we treat
 * server/overload/timeout AND Grok's provider-timeout phrasings ("took too long",
 * "did not respond") as retryable. Rate-limit phrasings (429 / "No available tokens" /
 * "too many requests") are transient too — the input is fine, the provider is just
 * throttling, so it recovers on resubmit (now paced by each provider's token bucket).
 * Pure — exported for unit testing.
 */
export function isTransientVideoError(
  text: string | undefined | null
): boolean {
  // "No providers support this combination" is a param-incompatibility error — resubmitting
  // the same body will never recover it. Exclude it before the broad "provider" keyword fires.
  if (/No providers support/i.test(text || "")) return false;
  return /INTERNAL|UNAVAILABLE|SERVER_ERROR|overloaded|timeout|timed out|took too long|did not respond|no response|provider|failed to complete|missing[ _]post[ _]id|rate[ _-]?limit|no available tokens|too many requests/i.test(
    text || ""
  );
}

// ─── Content-policy Detection ───
// Grok's content classifier rejects restricted prompts/reference images with a 400 (submit) or
// a FAILED job (poll) whose message carries this vocabulary. Distinct from credits/transient:
// a softer/shorter prompt may recover, so the b-roll path retries on this (and only this).
const CONTENT_POLICY_REGEX =
  /blocked prompt|content policy|content[-_ ]moderat(?:ion|ed)|moderation|safety|celebrity|well[- ]known person|underage|minor detect|nsfw|sexual|erotic|copyright/i;

/**
 * True when an error is a content/safety classifier rejection (not credits, not transient).
 * Pure — exported for unit testing. Accepts a raw error body or a plain detail message.
 */
export function isContentPolicyError(text: string | undefined | null): boolean {
  if (!text) return false;
  if (isCreditsError(text)) return false;
  return CONTENT_POLICY_REGEX.test(text);
}

// Readable, actionable message shown in place of the raw "API error". Keeps the words
// "content policy" so `isContentPolicyError` still matches it downstream (the b-roll retry gate
// inspects this thrown message), while reading cleanly for the user.
const CONTENT_POLICY_MESSAGE =
  "69Labs blocked this scene's prompt (content policy). Simplify the visual, remove real " +
  "names, and avoid age-sensitive wording, then retry.";

/**
 * Detect actual image MIME type from file magic bytes.
 */
function detectImageMimeType(buffer: Buffer): string {
  if (buffer.length < 4) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
    return "image/png";
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return "image/webp";
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  )
    return "image/gif";
  return "image/png";
}

/**
 * Map our internal aspect ratios to 69Labs format.
 */
function toImageAspectRatio69Labs(ar: string, model: string): string {
  if (model === "imagen-4" || model === "imagen-3.5") {
    switch (ar) {
      case "16:9":
      case "4:3":
      case "3:2":
        return "landscape";
      case "9:16":
      case "3:4":
      case "2:3":
        return "portrait";
      case "1:1":
        return "square";
      default:
        return "landscape";
    }
  }
  // Normalize 2:3 to 3:4 for models that use raw ratio strings (both are portrait)
  return ar === "2:3" ? "3:4" : ar;
}

function toVideoAspectRatio69Labs(ar: string): string {
  return ar;
}

function mapImageModel(model: string): string {
  switch (model) {
    case "nano-banana":
      return "nano-banana-2";
    case "nano-banana-pro":
      return "nano-banana-pro";
    case "gpt-image-2":
      return "gpt-image-2";
    default:
      return model;
  }
}

/**
 * On a persistent server-availability failure (HTTP 5xx) for the primary image model, re-submit on
 * this fallback model BEFORE FallbackImageAdapter drops to Gemini. Keyed by the MAPPED model id.
 * `nano-banana-pro` is the heavier/less-available tier; `nano-banana-2` is the documented default
 * and renders the same baked-in cover text, so a cover stays on 69Labs when only `pro` is down.
 */
const IMAGE_MODEL_FALLBACK: Record<string, string> = {
  "nano-banana-pro": "nano-banana-2",
  // When gpt-image-2 is unavailable (5xx), render on grok-imagine-image (16:9, no resolution param).
  "gpt-image-2": "grok-imagine-image",
};

/** Ordered list of mapped model ids to try for one image: primary, then its fallback (if any). */
export function imageModelChain(rawModel: string): string[] {
  const primary = mapImageModel(rawModel);
  const fb = IMAGE_MODEL_FALLBACK[primary];
  return fb && fb !== primary ? [primary, fb] : [primary];
}

/**
 * 69Labs video models that accept a `videoInputMode` (image-usage mode). Per the live model
 * table, ONLY gemini-omni exposes modes (ingredients, keyframes); grok-imagine-video, veo-video
 * and the veo family take image input but no mode — sending one yields a hard 400. Keyed by the
 * MAPPED (wire) model id from `mapVideoModel`.
 */
const VIDEO_MODELS_WITH_INPUT_MODE = new Set(["gemini-omni"]);

function mapVideoModel(model: string): string {
  switch (model) {
    case "veo-3.1-generate":
      return "veo-video";
    case "veo-video":
      // Veo 3.1 Lite. 69Labs sends no duration/resolution for it, so it runs at its fixed
      // default — verified text-only via the live API.
      return "veo-video";
    case "veo-3.1-fast":
      // Veo Fast (BETA) — the b-roll grok→veo fallback model. No duration/resolution/mode
      // params (runs at its fixed default); accepts up to 2 image inputs. Pass-through wire id.
      return "veo-3.1-fast";
    case "gemini-omni":
      // The one 69Labs model exposing an "ingredients" (Reference Images) mode — used for
      // on-camera-host b-roll so the face is a reference ingredient, not a start frame.
      return "gemini-omni";
    case "grok-imagine-video":
      return "grok-imagine-video";
    default:
      return model;
  }
}

/**
 * Identity / face-lock instruction injected into the prompt text.
 *
 * Grok exposes no API-level face-lock flag, so when a reference image is
 * supplied we make the lock "present in the text" by prepending this clause.
 * Kept as a named constant because prompt quality is the key lever for how
 * real/consistent the host looks — tune here.
 */
export const FACE_LOCK_PROMPT_PREFIX =
  "The reference image is supplied for IDENTITY ONLY: it shows the on-camera host's face. " +
  "Preserve their exact facial identity, features, and likeness throughout the clip — " +
  "same face, same person, consistent across every frame. " +
  "Do NOT display, reproduce, or open on the reference photo itself, its framing, or its plain/studio backdrop. " +
  "From the very first frame the host is already inside the scene described below, already in motion — " +
  "no static portrait, no posed headshot intro, no fade or morph out of the reference photo. " +
  "Begin directly in the scene. ";

/**
 * Seated talking-head variant of the face-lock clause. Keeps the same identity
 * guard and reference-photo-leak guard, but the host stays seated and talking
 * instead of "already in motion" (which would contradict a static talking-head).
 */
export const FACE_LOCK_PROMPT_PREFIX_SEATED =
  "The reference image is supplied for IDENTITY ONLY: it shows the on-camera host's face. " +
  "Preserve their exact facial identity, features, and likeness throughout the clip — " +
  "same face, same person, consistent across every frame. " +
  "Do NOT display, reproduce, or open on the reference photo itself, its framing, or its plain/studio backdrop. " +
  "The host is seated and talking calmly to the camera in the scene described below — " +
  "no static portrait, no posed headshot intro, no fade or morph out of the reference photo, " +
  "and do NOT have him stand up, walk, or leave the seat. Begin already seated and mid-sentence in the scene. ";

/**
 * Ingredient variant — for models with a true "ingredients" / reference-images mode
 * (Gemini Omni), where the image is a reference the model builds a fresh scene FROM, never
 * the literal first frame. Unlike the Grok variants there is no start-frame leak to guard
 * against; this just pins identity and forbids reproducing the reference photo itself.
 */
export const FACE_LOCK_PROMPT_PREFIX_INGREDIENT =
  "The reference image is a face/identity INGREDIENT: it shows the on-camera host. " +
  "Render that same man — his exact face, features, age, and likeness — as the person in " +
  "the scene described below, consistent across every frame. Do NOT reproduce the reference " +
  "photo itself, its framing, pose, or its plain/studio background; build a fresh scene from " +
  "the description, with the host already inside it and naturally in motion from the first frame. ";

/** Prepend the face-lock clause to a prompt (idempotent-ish; callers gate on faceLock). */
export function withFaceLockPrompt(
  prompt: string,
  variant: "motion" | "seated" | "ingredient" = "motion"
): string {
  const prefix =
    variant === "seated"
      ? FACE_LOCK_PROMPT_PREFIX_SEATED
      : variant === "ingredient"
        ? FACE_LOCK_PROMPT_PREFIX_INGREDIENT
        : FACE_LOCK_PROMPT_PREFIX;
  return `${prefix}${prompt}`;
}

/**
 * Per-model image capabilities, from the live `GET /api/v1/images/models` discovery
 * endpoint (the authoritative, server-enforced source). Keyed by the MAPPED model id
 * (`mapImageModel` output). Used to gate request-body fields so we never send a param a
 * model rejects with a 400 — which the FallbackImageAdapter would otherwise swallow into a
 * silent failover to Gemini.
 *
 * Unknown / future models (not in this table) are treated permissively (pass params
 * through) EXCEPT `resolution`, which stays OFF unless the model is known to support it.
 */
const IMAGE_MODEL_CAPS: Record<
  string,
  {
    resolution: boolean;
    aspectRatios: Set<string>;
    maxImageUrls: number; // 0 = no image input
    defaultAspectRatio: string;
  }
> = {
  "nano-banana-2": {
    resolution: true,
    aspectRatios: new Set([
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
      "1:4",
      "4:1",
      "1:8",
      "8:1",
    ]),
    maxImageUrls: 14,
    defaultAspectRatio: "16:9",
  },
  "nano-banana-pro": {
    resolution: true,
    aspectRatios: new Set([
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "5:4",
      "4:5",
      "9:16",
      "16:9",
      "21:9",
    ]),
    maxImageUrls: 10,
    defaultAspectRatio: "16:9",
  },
  "gpt-image-2": {
    resolution: false,
    aspectRatios: new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]),
    maxImageUrls: 10,
    defaultAspectRatio: "16:9",
  },
  "z-image": {
    resolution: false,
    aspectRatios: new Set(["1:1", "4:3", "3:4", "16:9", "9:16"]),
    maxImageUrls: 0,
    defaultAspectRatio: "16:9",
  },
  "img-flux": {
    resolution: false,
    aspectRatios: new Set(["16:9"]),
    maxImageUrls: 0,
    defaultAspectRatio: "16:9",
  },
  "grok-imagine-image": {
    resolution: false,
    aspectRatios: new Set(["1:1", "2:3", "3:2", "9:16", "16:9", "4:3", "3:4"]),
    maxImageUrls: 5,
    defaultAspectRatio: "3:2",
  },
};

function mapImageResolution(imageSize?: string): string | undefined {
  if (!imageSize) return undefined;
  switch (imageSize.toUpperCase()) {
    case "1K":
      return "1k";
    case "2K":
      return "2k";
    case "4K":
      return "4k";
    default:
      return undefined;
  }
}

/**
 * Build the `POST /api/v1/images/generate` body for one mapped model id, gating each field against
 * that model's capabilities so we never 400 on an unsupported param (the FallbackImageAdapter would
 * otherwise swallow it into a silent Gemini failover). Pure — caller passes an already-mapped model
 * id, so the same params can be re-bodied for a fallback model with its own caps.
 */
function buildImageBody(
  params: ImageGenerationParams,
  model69: string
): Record<string, any> {
  const caps = IMAGE_MODEL_CAPS[model69];

  // Aspect ratio: coerce to the model's default if the requested ratio isn't in its allowed list,
  // so we never 400 on an unsupported ratio (e.g. img-flux only takes 16:9). imagen-* is
  // intentionally absent from the caps table — it uses landscape/portrait/square strings via
  // toImageAspectRatio69Labs and is left untouched.
  let aspectRatio = toImageAspectRatio69Labs(params.aspectRatio, model69);
  if (caps && !caps.aspectRatios.has(aspectRatio)) {
    console.warn(
      `[69Labs] ${model69} does not support aspectRatio "${aspectRatio}" — using "${caps.defaultAspectRatio}"`
    );
    aspectRatio = caps.defaultAspectRatio;
  }

  const body: Record<string, any> = {
    prompt: params.prompt,
    model: model69,
    aspectRatio,
  };

  // Resolution: only the nano-banana family accepts it. Others (gpt-image-2, z-image, img-flux,
  // grok-imagine-image) 400 with "does not support resolution selection" — see
  // GET /api/v1/images/models (resolutionCosts:null). Unknown models stay off.
  const resolution = mapImageResolution(params.imageSize);
  if (resolution && caps?.resolution) {
    body.resolution = resolution;
  }

  // Optional image-to-image / identity reference (e.g. the host face model for a human in a
  // non-host still). Only send `imageUrls` to models that support image input, capped at the
  // model's maxImageUrls. Models with supportsImageInput=false (z-image, img-flux) 400 if it's
  // sent. Unknown models pass through unchanged.
  if (params.imageUrls && params.imageUrls.length > 0) {
    const max = caps ? caps.maxImageUrls : params.imageUrls.length;
    if (max > 0) {
      body.imageUrls = params.imageUrls.slice(0, max);
    } else {
      console.warn(
        `[69Labs] ${model69} does not support image input — dropping ${params.imageUrls.length} imageUrl(s)`
      );
    }
  }

  return body;
}

/**
 * Calculate retry delay with exponential backoff + jitter.
 */
function retryDelay(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 3000);
  return Math.min(base + jitter, 30_000); // cap at 30 seconds
}

type JobStatus =
  | "PENDING"
  | "PROCESSING"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  /**
   * Synthetic (client-only) status: the poll hit its timeout ceiling before a terminal
   * COMPLETED/FAILED. The job is usually still rendering server-side and its result stays
   * downloadable, so callers treat this as `pending` (persist jobId + resume) — never a fail.
   */
  | "TIMEOUT";

interface StatusResponse {
  id: string;
  status: JobStatus;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  outputMetadata?: {
    format?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  };
  error?: string;
}

/**
 * Next poll delay (ms) given the job's last-seen status. Status-aware so we detect completion
 * fast at the moment that matters — FINALIZING means the output is downloading server-side
 * (done imminently), so poll tight; a PENDING job is just queued, so polling fast wins nothing.
 * `elapsed` keeps the very first poll snappy (before any status is known) so quick jobs aren't
 * stuck waiting a full PENDING interval. Pure — exported for unit testing.
 */
export function nextPollInterval(
  lastStatus: string,
  elapsedMs: number
): number {
  // First poll (nothing observed yet): check quickly so fast jobs finish fast.
  if (elapsedMs < 2_500) return 2_500;
  switch (lastStatus) {
    case "FINALIZING":
      return 1_500; // output downloading — completion imminent
    case "PROCESSING":
      return 3_000; // actively rendering
    case "PENDING":
    default:
      return 5_000; // queued — nothing gained polling faster
  }
}

/**
 * Poll a single 69Labs job until it completes, fails, or times out.
 * Uses the global poll throttler to stay under 120/min.
 * Poll interval is status-aware (see `nextPollInterval`): tight near completion, relaxed in queue.
 */
async function pollJob(
  jobId: string,
  type: "images" | "videos",
  authHeaders: Record<string, string>,
  timeoutMs: number,
  label: string
): Promise<StatusResponse> {
  const startTime = Date.now();
  let lastStatus: string = "PENDING";
  let polls = 0;

  while (Date.now() - startTime < timeoutMs) {
    // Status-aware poll interval: tight near completion (FINALIZING), relaxed in queue (PENDING).
    const elapsed = Date.now() - startTime;
    await sleep(nextPollInterval(lastStatus, elapsed));
    polls++;

    // Acquire a token from the global poll throttler, prioritizing jobs whose last-seen status
    // means completion is imminent so their detect-latency stays low under the 120/min ceiling.
    await acquirePollToken(pollPriorityFor(lastStatus));

    try {
      const resp = await fetch(`${BASE_URL}/api/v1/${type}/status/${jobId}`, {
        headers: authHeaders,
        signal: callSignal(),
      });

      if (resp.status === 429) {
        // Respect Retry-After header if present
        const retryAfter = resp.headers.get("Retry-After");
        const waitSec = retryAfter
          ? Math.min(parseInt(retryAfter, 10) || 10, 60)
          : 10;
        console.log(
          `[69Labs] ${label} job ${jobId} poll rate limited, waiting ${waitSec}s (Retry-After: ${retryAfter || "none"})...`
        );
        await sleep(waitSec * 1000);
        continue;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(
          `[69Labs] ${label} poll error (${resp.status}): ${errText.substring(0, 200)}`
        );
        if (resp.status >= 500) {
          // 5xx: backoff and retry
          await sleep(5_000 + Math.floor(Math.random() * 3000));
          continue;
        }
        return {
          id: jobId,
          status: "FAILED",
          error: `Poll error (${resp.status}): ${errText.substring(0, 200)}`,
        };
      }

      const data: StatusResponse = await resp.json();
      lastStatus = data.status;

      if (data.status === "COMPLETED") {
        // Timing breakdown: separate provider queue + render from our poll-detection latency,
        // so the full-script build can see where wall-clock actually goes. Provider timestamps
        // are best-effort (69Labs sometimes omits them).
        const wallSec = Math.round((Date.now() - startTime) / 1000);
        const ts = (s?: string) => (s ? Date.parse(s) : NaN);
        const created = ts(data.createdAt);
        const started = ts(data.startedAt);
        const completed = ts(data.completedAt);
        const sec = (ms: number) => Math.round(ms / 1000);
        const parts: string[] = [`wall ${wallSec}s`, `polls ${polls}`];
        if (!isNaN(created) && !isNaN(started))
          parts.push(`queue ${sec(started - created)}s`);
        if (!isNaN(started) && !isNaN(completed))
          parts.push(`render ${sec(completed - started)}s`);
        if (!isNaN(created) && !isNaN(completed))
          parts.push(
            `detectLatency ${sec(Date.now() - startTime - (completed - created))}s`
          );
        console.log(
          `[69Labs] ${label} job ${jobId} completed — ${parts.join(" | ")}`
        );
        return data;
      }

      if (data.status === "FAILED" || data.status === "CANCELLED") {
        const raw = data as Record<string, any>;
        // 69Labs often returns FAILED with an empty `error` field — log the full
        // response body so the real reason (image fetch, credits, model outage) is visible.
        const detail =
          data.error ??
          raw.message ??
          raw.failureReason ??
          raw.userMessage ??
          JSON.stringify(data).slice(0, 300);
        console.log(
          `[69Labs] ${label} job ${jobId} ${data.status}: ${detail} | raw: ${JSON.stringify(data).slice(0, 500)}`
        );
        return { ...data, error: detail };
      }

      // Still PENDING, PROCESSING, or FINALIZING — continue polling
    } catch (err: any) {
      console.warn(`[69Labs] ${label} poll network error: ${err.message}`);
      await sleep(5_000);
    }
  }

  return {
    id: jobId,
    status: "TIMEOUT",
    error: `Client timed out after ${Math.round(timeoutMs / 1000)}s (last status: ${lastStatus}). The job may still be processing on 69Labs' side.`,
  };
}

/**
 * Download a file from 69Labs (follows 302 redirect to presigned R2 URL).
 */
async function downloadFile(
  jobId: string,
  type: "images" | "videos",
  authHeaders: Record<string, string>,
  index?: number
): Promise<{ buffer: Buffer; contentType: string } | { error: string }> {
  try {
    let url = `${BASE_URL}/api/v1/${type}/download/${jobId}`;
    if (index !== undefined) url += `?index=${index}`;

    const resp = await fetch(url, {
      headers: authHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        error: `Download failed (${resp.status}): ${errText.substring(0, 200)}`,
      };
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    const contentType =
      resp.headers.get("content-type") ||
      (type === "videos" ? "video/mp4" : "image/png");
    return { buffer, contentType };
  } catch (err: any) {
    return { error: `Download error: ${err.message}` };
  }
}

/**
 * 69Labs provider adapter.
 * Uses the async job pattern: POST to create → GET to poll status → GET to download.
 *
 * Key design decisions (based on 69Labs rep feedback):
 * 1. count>1 normalizes response.jobs[] array (not just response.id)
 * 2. Global poll throttler limits status checks to 2/sec (120/min limit)
 * 3. Retry-After header respected on 429, exponential backoff on 5xx
 * 4. Each image is submitted/polled independently — one failure doesn't kill the batch
 * 5. All job IDs are logged immediately after POST for debugging
 */
export class SixtyNineLabsAdapter implements ProviderAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private jsonHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  // ─── Video Generation ───

  /** Build the 69Labs videos/generate body for one clip. */
  private buildVideoBody(params: VideoGenerationParams): Record<string, any> {
    const model69 = mapVideoModel(params.model);
    const body: Record<string, any> = {
      prompt: params.prompt,
      model: model69,
      aspectRatio: toVideoAspectRatio69Labs(params.aspectRatio),
    };

    const modelsSupportingDuration = [
      "luma-flash",
      "luma-ray-v3",
      "luma-ray-v3-reasoning",
      "grok-imagine-video",
    ];
    if (params.duration && model69 === "gemini-omni") {
      // Gemini Omni accepts explicit 4/6/8/10s; our fixed clip param (6 or 10) is already valid.
      body.duration = String(params.duration);
    } else if (params.duration && model69 === "grok-imagine-video") {
      // Grok Video accepts 6–30s (integer seconds).
      const d = Math.max(6, Math.min(30, Math.round(params.duration)));
      body.duration = String(d);
    } else if (params.duration && modelsSupportingDuration.includes(model69)) {
      // Luma family: documented 5/10 options.
      body.duration = params.duration <= 5 ? "5" : "10";
    }

    // Image-to-video / identity (face) lock: pass reference image(s).
    // Per the live 69Labs model table, `videoInputMode` is ONLY supported by gemini-omni
    // (modes: ingredients, keyframes). grok-imagine-video, veo-video and the veo family accept
    // imageUrls but expose NO modes — sending any videoInputMode to them returns a hard 400
    // ("No providers support this combination of video options"). grok also caps image input at 1.
    if (params.imageUrls && params.imageUrls.length > 0) {
      const maxImg = model69 === "grok-imagine-video" ? 1 : 2;
      body.imageUrls = params.imageUrls.slice(0, maxImg);
      if (VIDEO_MODELS_WITH_INPUT_MODE.has(model69)) {
        body.videoInputMode = params.videoInputMode ?? "ingredients";
      }
    }
    return body;
  }

  /**
   * Submit ONE video job, retrying transient submit failures (429 / 5xx / network) with
   * bounded backoff. Returns the job ID so the caller can persist it BEFORE polling — a poll
   * timeout or crash can then resume the render instead of re-submitting.
   */
  async submitVideo(params: VideoGenerationParams): Promise<VideoSubmitResult> {
    const body = this.buildVideoBody(params);
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await acquireVideoSubmitToken();
      try {
        const response = await fetch(`${BASE_URL}/api/v1/videos/generate`, {
          method: "POST",
          headers: this.jsonHeaders(),
          body: JSON.stringify(body),
          signal: callSignal(),
        });

        if (!response.ok) {
          const errText = await response.text();
          // 69Labs occasionally returns a transient 400 ("No providers support this combination
          // of video options") when no upstream provider is momentarily available for the combo —
          // resubmitting the SAME body recovers it. Treat that (and only that) 400 as retriable so
          // the bounded backoff below absorbs the blip; genuine param 400s don't match the regex
          // and still fail fast.
          const retriable =
            response.status === 429 ||
            response.status >= 500 ||
            (response.status === 400 && isTransientVideoError(errText));
          if (retriable && attempt < MAX_RETRIES) {
            const retryAfter = response.headers.get("Retry-After");
            const waitMs =
              response.status === 429 && retryAfter
                ? parseInt(retryAfter, 10) * 1000 || retryDelay(attempt)
                : retryDelay(attempt);
            console.log(
              `[69Labs] Video submit ${response.status}, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1})...`
            );
            await sleep(waitMs);
            continue;
          }
          return {
            error: isCreditsError(errText)
              ? "69Labs credits depleted. Check your 69Labs dashboard."
              : isContentPolicyError(errText)
                ? CONTENT_POLICY_MESSAGE
                : `69Labs API error (${response.status}): ${errText.substring(0, 500)}`,
          };
        }

        const data = await response.json();
        // Normalize: handle both { id } and { jobs: [{ id }] } response formats
        const ids =
          data.jobs?.map((j: any) => j.id) ?? [data.id].filter(Boolean);
        if (ids.length === 0) {
          console.warn(
            `[69Labs] Video: no job ID in response:`,
            JSON.stringify(data).substring(0, 300)
          );
          return { error: "69Labs returned no job ID" };
        }
        console.log(
          `[69Labs] Video job submitted: ${ids[0]} (queue: ${data.queuePosition || data.jobs?.[0]?.queuePosition || "?"})`
        );
        recordUsage({
          lane: "video",
          provider: "sixtynine_labs",
          model: body.model ?? "unknown",
          calls: 1,
          quantity: body.duration ?? params.duration ?? 0,
        });
        return { taskId: ids[0] };
      } catch (err: any) {
        const isNetworkErr =
          /terminated|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|abort|closed/i.test(
            err.message || ""
          );
        if (attempt < MAX_RETRIES && isNetworkErr) {
          await sleep(retryDelay(attempt));
          continue;
        }
        return {
          error: err.message || "Unknown error during 69Labs video submit",
        };
      }
    }
    return { error: "69Labs video submit failed after retries" };
  }

  /** Poll + download a previously-submitted video job (resume entry point). */
  async pollVideo(
    taskId: string,
    timeoutMs: number = VIDEO_TIMEOUT_MS
  ): Promise<GenerationResult> {
    const status = await pollJob(
      taskId,
      "videos",
      this.authHeaders(),
      timeoutMs,
      "Video"
    );
    return this.resultFromVideoStatus(status);
  }

  /**
   * Turn a video poll status into a GenerationResult: download on COMPLETED, mark `pending`
   * on TIMEOUT (still rendering — resume later), credits-aware error otherwise. Does NOT
   * resubmit — transient-failure resubmit is handled by `_generateVideoWithRetry`.
   */
  private async resultFromVideoStatus(
    status: StatusResponse
  ): Promise<GenerationResult> {
    if (status.status === "TIMEOUT") {
      return {
        success: false,
        pending: true,
        taskId: status.id,
        error: status.error || "69Labs poll timed out",
      };
    }
    if (status.status === "COMPLETED") {
      const dl = await downloadFile(status.id, "videos", this.authHeaders());
      if ("buffer" in dl) {
        return {
          success: true,
          fileData: dl.buffer,
          mimeType: "video/mp4",
          taskId: status.id,
        };
      }
      return { success: false, error: dl.error, taskId: status.id };
    }
    const errorMsg =
      status.error || `Video generation failed (status: ${status.status})`;
    return {
      success: false,
      error: isCreditsError(errorMsg)
        ? "69Labs credits depleted. Check your 69Labs dashboard."
        : isContentPolicyError(errorMsg)
          ? CONTENT_POLICY_MESSAGE
          : `69Labs: ${errorMsg}`,
      taskId: status.id,
    };
  }

  async generateVideo(
    params: VideoGenerationParams
  ): Promise<GenerationResult[]> {
    return this._generateVideoWithRetry(params, 0, 0, []);
  }

  private async _generateVideoWithRetry(
    params: VideoGenerationParams,
    attempt: number,
    chainIndex: number,
    fullChain: string[]
  ): Promise<GenerationResult[]> {
    // Resolve the ordered model chain on first call; carry it unchanged on recursive calls.
    // Raw model names (e.g. "veo-3.1-generate") are mapped to 69Labs wire values here so
    // every recursive call re-uses the same already-mapped chain without double-mapping.
    const chain: string[] =
      fullChain.length > 0
        ? fullChain
        : params.modelChain?.length
          ? params.modelChain.map(mapVideoModel)
          : [mapVideoModel(params.model)];

    const currentModel = chain[chainIndex];
    // Substitute the current chain model into params so buildVideoBody / submitVideo use it.
    const currentParams: VideoGenerationParams = {
      ...params,
      model: currentModel as any,
    };

    const results: GenerationResult[] = [];

    // Submit one job per count (69Labs has no count param for videos).
    const jobIds: string[] = [];
    for (let i = 0; i < params.count; i++) {
      const sub = await this.submitVideo(currentParams);
      if (sub.taskId) jobIds.push(sub.taskId);
      else results.push({ success: false, error: sub.error });
    }

    // Poll all submitted jobs concurrently.
    const polled = await Promise.allSettled(
      jobIds.map(id =>
        pollJob(id, "videos", this.authHeaders(), VIDEO_TIMEOUT_MS, "Video")
      )
    );

    for (const pr of polled) {
      if (pr.status === "rejected") {
        results.push({
          success: false,
          error: pr.reason?.message || "Poll failed",
        });
        continue;
      }
      const status = pr.value;

      // Transient render-FAILEDs (incl. Grok's provider-timeout phrasing) are checked
      // BEFORE downloading/erroring so a refund-message timeout resubmits instead of
      // aborting. A client TIMEOUT is NOT a render failure — it falls through to
      // `resultFromVideoStatus` as `pending` (resume), never a resubmit.
      if (
        status.status !== "COMPLETED" &&
        status.status !== "TIMEOUT" &&
        isTransientVideoError(status.error || "")
      ) {
        if (attempt < MAX_RETRIES) {
          // Same-model retry: transient error with attempts remaining.
          console.log(
            `[69Labs] Transient video error "${status.error}" on ${currentModel}, retrying in ${Math.round(retryDelay(attempt) / 1000)}s (attempt ${attempt + 1})...`
          );
          await sleep(retryDelay(attempt));
          return this._generateVideoWithRetry(
            params,
            attempt + 1,
            chainIndex,
            chain
          );
        }
        if (chainIndex + 1 < chain.length) {
          // Chain advance: exhausted same-model retries — try next model in chain.
          const nextModel = chain[chainIndex + 1];
          console.warn(
            `[69Labs] Video model ${currentModel} exhausted ${MAX_RETRIES} retries — advancing to ${nextModel}`
          );
          return this._generateVideoWithRetry(params, 0, chainIndex + 1, chain);
        }
      }

      results.push(await this.resultFromVideoStatus(status));
    }

    return results;
  }

  // ─── Image Generation ───

  async generateImage(
    params: ImageGenerationParams
  ): Promise<GenerationResult[]> {
    return this._generateImageBatch(params, 0);
  }

  /**
   * Image generation: submit all images concurrently, poll each independently.
   * Per-image resilience: one failure doesn't kill the batch.
   * Global rate limiters prevent overwhelming 69Labs' endpoints.
   */
  private async _generateImageBatch(
    params: ImageGenerationParams,
    attempt: number
  ): Promise<GenerationResult[]> {
    const count = params.count || 1;

    // Per-image model chain: explicit modelChain (e.g. edit-images page) overrides the default
    // two-step fallback table so callers can specify their own ordered list without touching
    // the IMAGE_MODEL_FALLBACK map used by all other generation paths.
    const chain = params.modelChain?.length
      ? params.modelChain.map(mapImageModel)
      : imageModelChain(params.model);

    // ponytail: one concise line per request, not a pretty-printed JSON dump. At 24+ concurrent
    // images the multi-line full-body dump flooded Railway's 500 logs/sec cap (dropped messages).
    // Key request fields stay greppable; full prompt is intentionally omitted.
    const primaryBody = buildImageBody(params, chain[0]);
    console.log(
      `[69Labs] Image request (count=${count}) model=${primaryBody.model} aspect=${primaryBody.aspectRatio ?? "default"} promptLen=${primaryBody.prompt.length} → ${BASE_URL}/api/v1/images/generate`
    );

    // Generate each image independently with per-image retry + model fallback
    const imagePromises = Array.from({ length: count }, (_, i) =>
      this._generateSingleImage(params, chain, i, attempt)
    );

    // Run all images concurrently (rate limiter inside handles throttling)
    const results = await Promise.all(imagePromises);
    return results;
  }

  /**
   * Generate one image, walking the model chain: try the primary model's full retry loop, and only
   * on a persistent server-availability failure (5xx) re-submit on the fallback model before giving
   * up (→ Gemini). Terminal failures (4xx / credits / validation / timeout / network) stop the chain
   * immediately — a different model wouldn't help and would just burn credits/time.
   */
  private async _generateSingleImage(
    params: ImageGenerationParams,
    chain: string[],
    index: number,
    initialAttempt: number
  ): Promise<GenerationResult> {
    await SIXTYNINE_IMAGE_SLOTS.acquire();
    try {
      let last: GenerationResult & { serverUnavailable?: boolean } = {
        success: false,
        error: "No image model attempted",
      };
      for (let m = 0; m < chain.length; m++) {
        const model69 = chain[m];
        const body = buildImageBody(params, model69);
        last = await this._submitImageForModel(body, index, initialAttempt);
        if (last.success) return last;
        // Only a server-availability failure is worth retrying on a different model.
        if (!last.serverUnavailable) return last;
        const next = chain[m + 1];
        if (next) {
          console.warn(
            `[69Labs] Image #${index} model ${model69} unavailable (5xx) — falling back to ${next}`
          );
        }
      }
      return last;
    } finally {
      SIXTYNINE_IMAGE_SLOTS.release();
    }
  }

  /**
   * Submit + poll + download one image for a single (already caps-gated) request body, with its own
   * retry loop. Uses the global submit rate limiter + poll throttler. Sets `serverUnavailable` when
   * the request was abandoned after exhausting retries on an HTTP 5xx, so the caller can try a
   * fallback model.
   */
  private async _submitImageForModel(
    body: Record<string, any>,
    index: number,
    initialAttempt: number
  ): Promise<GenerationResult & { serverUnavailable?: boolean }> {
    for (let attempt = initialAttempt; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Acquire a token from the global submission rate limiter
        await acquireSubmitToken();

        const response = await fetch(`${BASE_URL}/api/v1/images/generate`, {
          method: "POST",
          headers: this.jsonHeaders(),
          body: JSON.stringify(body),
          signal: callSignal(),
        });

        if (!response.ok) {
          const errText = await response.text();

          // 429: respect Retry-After header
          if (response.status === 429 && attempt < MAX_RETRIES) {
            const retryAfter = response.headers.get("Retry-After");
            const waitMs = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : retryDelay(attempt);
            console.log(
              `[69Labs] Image #${index} rate limited (429), waiting ${Math.round(waitMs / 1000)}s (Retry-After: ${retryAfter || "none"}, attempt ${attempt + 1})...`
            );
            await sleep(waitMs);
            continue;
          }

          // 5xx: exponential backoff + jitter
          if (response.status >= 500 && attempt < MAX_RETRIES) {
            const waitMs = retryDelay(attempt);
            console.log(
              `[69Labs] Image #${index} server error (${response.status}), retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1})...`
            );
            await sleep(waitMs);
            continue;
          }

          const isCredits = isCreditsError(errText);
          const userMsg = isCredits
            ? `69Labs credits depleted. Check your 69Labs dashboard for remaining credits.`
            : `69Labs API error (${response.status}): ${errText.substring(0, 500)}`;

          // A 5xx here means we exhausted retries on a server-availability failure — let the caller
          // try a fallback model. 4xx/429/credits are terminal for this model (a different one
          // won't help), so they leave the flag off.
          return {
            success: false,
            error: userMsg,
            serverUnavailable: !isCredits && response.status >= 500,
          };
        }

        const data = await response.json();

        // FIX: Normalize response — handle both { id } and { jobs: [{ id }] }
        const jobIds =
          data.jobs?.map((j: any) => j.id) ?? [data.id].filter(Boolean);
        if (jobIds.length === 0) {
          console.warn(
            `[69Labs] Image #${index}: no job ID in response:`,
            JSON.stringify(data).substring(0, 300)
          );
          return { success: false, error: "69Labs returned no job ID" };
        }

        const jobId = jobIds[0];
        console.log(
          `[69Labs] Image #${index} job ${jobId} submitted (queue: ${data.queuePosition || data.jobs?.[0]?.queuePosition || "?"})`
        );
        recordUsage({
          lane: "image",
          provider: "sixtynine_labs",
          model: body.model ?? "unknown",
          calls: 1,
          quantity: 1,
        });

        // Poll this specific job (uses global poll throttler)
        const status = await pollJob(
          jobId,
          "images",
          this.authHeaders(),
          IMAGE_TIMEOUT_MS,
          `Img#${index}`
        );

        if (status.status === "COMPLETED") {
          const dl = await downloadFile(jobId, "images", this.authHeaders());
          if ("buffer" in dl) {
            const mimeType = detectImageMimeType(dl.buffer);
            return {
              success: true,
              fileData: dl.buffer,
              mimeType,
              taskId: jobId,
            };
          } else {
            return { success: false, error: dl.error, taskId: jobId };
          }
        }

        // Job failed — check error type
        const errorMsg =
          status.error || `Image generation failed (status: ${status.status})`;

        const isCredits = isCreditsError(errorMsg);
        if (isCredits) {
          return {
            success: false,
            error: `69Labs credits depleted. Check your 69Labs dashboard.`,
          };
        }

        // Client-side poll TIMEOUT ≠ render failure: the job is still processing on 69Labs.
        // Resubmitting would double-charge credits and spawn orphaned jobs, so return the
        // failure and let the fallback layer decide (Gemini). Mirrors the video poll path,
        // which returns `pending` rather than resubmitting.
        if (status.status === "TIMEOUT") {
          return { success: false, error: errorMsg, taskId: jobId };
        }

        // Render-level FAILED: advance to the fallback model immediately instead of
        // retrying the same model. serverUnavailable=true signals _generateSingleImage
        // to walk the chain (e.g. gpt-image-2 → grok-imagine-image).
        console.warn(
          `[69Labs] Image #${index} render FAILED ("${errorMsg}") — trying fallback model`
        );
        return {
          success: false,
          error: `69Labs: ${errorMsg}`,
          taskId: jobId,
          serverUnavailable: true,
        };
      } catch (err: any) {
        console.error(`[69Labs] Image #${index} generation error:`, err);
        const isNetworkError =
          /terminated|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|abort/i.test(
            err.message || ""
          );
        if (isNetworkError && attempt < MAX_RETRIES) {
          const waitMs = retryDelay(attempt);
          console.log(
            `[69Labs] Image #${index} network error "${err.message}", retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1})...`
          );
          await sleep(waitMs);
          continue;
        }
        return {
          success: false,
          error: err.message || "Unknown error during image generation",
        };
      }
    }

    return { success: false, error: "Max retries exhausted" };
  }

  // ─── Connection Test ───

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/images/models`, {
        headers: this.authHeaders(),
        signal: callSignal(),
      });

      if (response.ok) {
        const data = await response.json();
        const credits = data.credits;
        const monthly = data.monthlyUsage;
        return {
          success: true,
          message: `Connected! Image credits: ${credits?.remaining || "?"} daily remaining, ${monthly?.remaining || "?"} monthly remaining. ${data.models?.length || 0} models available.`,
        };
      }

      const errText = await response.text();
      return {
        success: false,
        message: `Connection failed (${response.status}): ${errText.substring(0, 200)}`,
      };
    } catch (err: any) {
      return { success: false, message: err.message || "Connection failed" };
    }
  }

  /**
   * Get balance/credits info from 69Labs.
   */
  async getBalance(): Promise<{
    imageCredits: {
      used: number;
      limit: number;
      remaining: number;
      resetsAt: string | null;
    };
    videoCredits: {
      used: number;
      limit: number;
      remaining: number;
      resetsAt: string | null;
    };
    monthlyImageUsage: { used: number; limit: number; remaining: number };
    monthlyVideoUsage: { used: number; limit: number; remaining: number };
  } | null> {
    try {
      const [imgResp, vidResp] = await Promise.all([
        fetch(`${BASE_URL}/api/v1/images/models`, {
          headers: this.authHeaders(),
          signal: callSignal(),
        }),
        fetch(`${BASE_URL}/api/v1/videos/models`, {
          headers: this.authHeaders(),
          signal: callSignal(),
        }),
      ]);

      if (!imgResp.ok || !vidResp.ok) return null;

      const imgData = await imgResp.json();
      const vidData = await vidResp.json();

      return {
        imageCredits: imgData.credits || {
          used: 0,
          limit: 0,
          remaining: 0,
          resetsAt: null,
        },
        videoCredits: vidData.credits || {
          used: 0,
          limit: 0,
          remaining: 0,
          resetsAt: null,
        },
        monthlyImageUsage: imgData.monthlyUsage || {
          used: 0,
          limit: 0,
          remaining: 0,
        },
        monthlyVideoUsage: vidData.monthlyUsage || {
          used: 0,
          limit: 0,
          remaining: 0,
        },
      };
    } catch {
      return null;
    }
  }
}

import type {
  GenerationResult,
  VideoModel,
  ImageModel,
  VideoAspectRatio,
  ImageAspectRatio,
  Resolution,
  Duration,
} from "../../shared/types";

export interface VideoGenerationParams {
  prompt: string;
  negativePrompt?: string;
  model: VideoModel;
  aspectRatio: VideoAspectRatio;
  resolution: Resolution;
  /**
   * Requested clip length in seconds. Adapters snap/clamp to what their API supports:
   * 69labs maps per model (grok ≤6 → "6", else "10"; gemini-omni 4/6/8/10); APIMART
   * accepts any integer 6–15. UI-facing requests still use the `Duration` union.
   */
  duration: number;
  count: number;
  /**
   * Reference image URL(s) for image-to-video (identity / face lock).
   * Only used by models that support image input (e.g. grok-imagine-video).
   * Capped at 2 for Grok (69Labs maxImageUrls).
   */
  imageUrls?: string[];
  /**
   * How the reference image(s) drive generation:
   * - "ingredients": image is an identity anchor; model generates a new scene from the prompt.
   * - "keyframes": image is the literal starting frame, then animated.
   */
  videoInputMode?: "ingredients" | "keyframes";
  /**
   * Ordered list of raw model IDs to try in sequence. When provided, the adapter walks
   * this chain (primary → fallback → …) on persistent transient failures rather than
   * retrying the same model indefinitely. Each entry is mapped through `mapVideoModel`
   * internally. Callers that don't set this get the default single-model behaviour.
   */
  modelChain?: string[];
}

export interface ImageGenerationParams {
  prompt: string;
  model: ImageModel;
  aspectRatio: ImageAspectRatio;
  count: number;
  /** Image resolution: "1K", "2K", "4K". Defaults to "2K" */
  imageSize?: string;
  /**
   * Optional reference image URL(s) for image-to-image / identity conditioning.
   * Only honored by models that accept an input image (69Labs nano-banana via
   * `imageUrls`; the Gemini fallback via an inline-data part). Ignored otherwise.
   */
  imageUrls?: string[];
  /**
   * True when the caller touches the generation's `updatedAt` on a heartbeat during this
   * call (shuttle batch jobs do, ~every 60s). Lets `FallbackImageAdapter` run the full
   * retry count without the no-heartbeat total-time ceiling that otherwise keeps the primary
   * phase under the 5-min DB image timeout. Defaults to false (treated as no-heartbeat).
   */
  heartbeated?: boolean;
  /**
   * When true, skip the Google Gemini last-resort fallback for this call. The primary
   * provider's own model chain (e.g. 69Labs grok-imagine-image → gpt-image-2) still runs
   * and retries; on persistent failure the failed slots are returned as-is instead of
   * being re-rendered on Gemini. Used by longform stills/keyframes. Defaults to false.
   */
  noGeminiFallback?: boolean;
  /**
   * Ordered list of raw model IDs to try in sequence. When provided, the adapter uses this
   * chain instead of the default `imageModelChain(model)` fallback table. Each entry is
   * mapped through `mapImageModel` internally. Scoped to callers that need a custom chain
   * (e.g. edit-images page); all other callers keep the existing two-step fallback.
   */
  modelChain?: string[];
}

/** Result of submitting one async video task whose ID can be persisted for resume. */
export interface VideoSubmitResult {
  /** Provider-side task/job ID to poll. Absent when submission failed. */
  taskId?: string;
  /** Failure detail when no taskId was issued. */
  error?: string;
}

/**
 * Base interface for all provider adapters.
 * Each provider must implement these methods.
 */
export interface ProviderAdapter {
  /** Generate video(s) — returns array of results (one per count) */
  generateVideo(params: VideoGenerationParams): Promise<GenerationResult[]>;
  /** Generate image(s) — returns array of results (one per count) */
  generateImage(params: ImageGenerationParams): Promise<GenerationResult[]>;
  /** Test the connection/API key validity */
  testConnection(): Promise<{ success: boolean; message: string }>;
  /**
   * When false, this adapter cannot generate images at all (e.g. a video-only
   * provider). FallbackImageAdapter then skips the primary entirely and routes
   * straight to Gemini instead of attempting-then-catching a throw.
   * Omitted/true means the adapter is expected to handle images.
   */
  readonly supportsImageGeneration?: boolean;
  /**
   * Optional resumable video flow. `submitVideo` submits ONE task and returns its
   * provider-side ID; `pollVideo` polls + downloads that ID. Persisting the ID between
   * the two calls lets a poll timeout, crash, or watchdog sweep resume the already-running
   * render (download the finished result) instead of re-submitting and re-incurring the
   * cost + timeout. On poll timeout `pollVideo` returns `{ success: false, pending: true,
   * taskId }`. Adapters that omit these fall back to `generateVideo`.
   */
  submitVideo?(params: VideoGenerationParams): Promise<VideoSubmitResult>;
  pollVideo?(taskId: string, timeoutMs?: number): Promise<GenerationResult>;
}

/** Helper to sleep for polling */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

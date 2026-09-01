/**
 * server/lipsyncProvider.ts — which vendor renders host scenes, and at what quality.
 *
 * Both settings live in `app_settings` rather than only in env, so an operator can switch
 * providers from Admin → Provider Keys without a redeploy. The env vars stay meaningful as
 * the DEFAULT: an unset row falls back to `LIPSYNC_PROVIDER` / `RUNPOD_LIPSYNC_QUALITY`, so
 * an existing deployment behaves exactly as it did before this file existed, and a fresh
 * database still starts on HeyGen.
 *
 * Switching provider does NOT touch the stored HeyGen keys. Turning HeyGen off is a routing
 * decision, not a credential one — the keys stay encrypted in place and come straight back
 * when it is switched on again.
 *
 * Same cached-read shape as `mockMode.ts`, and for the same reason: `resolveLipsyncLane`
 * runs per pipeline pass and the readers are cheap to call, so a DB round trip per read
 * would be pure waste while a stale read costs at most a few seconds of lag after a toggle.
 */
import { getAppSetting, setAppSetting } from "./db";
import { ENV } from "./_core/env";

/** app_settings keys. Persisted so a toggle survives a restart, like every other setting. */
export const LIPSYNC_PROVIDER_KEY = "lipsync_provider";
export const LIPSYNC_QUALITY_KEY = "lipsync_quality";
export const LIPSYNC_CAMERA_KEY = "lipsync_camera";

export type LipsyncProvider = "heygen" | "runpod";
/** `fast` = 8-step distill; `full` = 40 steps with real CFG. RunPod lane only. */
export type LipsyncQuality = "fast" | "full";
/**
 * What the RunPod worker is conditioned on. `photo` = the host image (I2V, today's behaviour).
 * `pinned` = a static VIDEO synthesised from that same image (V2V): InfiniteTalk mimics the
 * input video's camera, and a video in which nothing moves has no camera to mimic — the
 * maintainer's own fix for Wan I2V's drift toward the speaker. The operator still only ever
 * uploads a photo; the static clip is built and uploaded by the pipeline per render.
 */
export type LipsyncCameraMode = "photo" | "pinned";

const CACHE_MS = 5_000;
let providerCache: { value: LipsyncProvider; at: number } | null = null;
let qualityCache: { value: LipsyncQuality; at: number } | null = null;
let cameraCache: { value: LipsyncCameraMode; at: number } | null = null;

/**
 * The vendor host scenes render on. `runpod` here is a REQUEST, not a guarantee:
 * `resolveLipsyncLane` still falls back to HeyGen when the RunPod endpoint or key is
 * missing, because a config gap must never fail a film. The Admin UI reads the same
 * readiness flags so it can refuse to offer a switch it cannot honour.
 */
export async function getLipsyncProvider(): Promise<LipsyncProvider> {
  if (providerCache && Date.now() - providerCache.at < CACHE_MS)
    return providerCache.value;
  const raw = await getAppSetting(LIPSYNC_PROVIDER_KEY).catch(() => null);
  // An unset row (not an empty string) means "never chosen" — that is the env default's job.
  const value: LipsyncProvider =
    raw === "runpod" || raw === "heygen"
      ? raw
      : ENV.lipsyncProvider === "runpod"
        ? "runpod"
        : "heygen";
  providerCache = { value, at: Date.now() };
  return value;
}

export async function setLipsyncProvider(
  provider: LipsyncProvider
): Promise<void> {
  await setAppSetting(LIPSYNC_PROVIDER_KEY, provider);
  providerCache = { value: provider, at: Date.now() };
}

/**
 * InfiniteTalk quality tier. Ignored entirely on the HeyGen lane, which has no equivalent
 * knob — Avatar IV renders one way at one price.
 */
export async function getLipsyncQuality(): Promise<LipsyncQuality> {
  if (qualityCache && Date.now() - qualityCache.at < CACHE_MS)
    return qualityCache.value;
  const raw = await getAppSetting(LIPSYNC_QUALITY_KEY).catch(() => null);
  const value: LipsyncQuality =
    raw === "full" || raw === "fast" ? raw : ENV.runpodLipsyncQuality;
  qualityCache = { value, at: Date.now() };
  return value;
}

export async function setLipsyncQuality(
  quality: LipsyncQuality
): Promise<void> {
  await setAppSetting(LIPSYNC_QUALITY_KEY, quality);
  qualityCache = { value: quality, at: Date.now() };
}

/**
 * Camera conditioning for the RunPod lane (ignored on HeyGen — Avatar IV animates the still,
 * so its camera is pinned by construction). Defaults to `photo` via `RUNPOD_LIPSYNC_INPUT`;
 * `pinned` is the experimental V2V path and stays opt-in until an A/B says otherwise.
 */
export async function getLipsyncCameraMode(): Promise<LipsyncCameraMode> {
  if (cameraCache && Date.now() - cameraCache.at < CACHE_MS)
    return cameraCache.value;
  const raw = await getAppSetting(LIPSYNC_CAMERA_KEY).catch(() => null);
  const value: LipsyncCameraMode =
    raw === "pinned" || raw === "photo"
      ? raw
      : ENV.runpodLipsyncInput === "video"
        ? "pinned"
        : "photo";
  cameraCache = { value, at: Date.now() };
  return value;
}

export async function setLipsyncCameraMode(
  mode: LipsyncCameraMode
): Promise<void> {
  await setAppSetting(LIPSYNC_CAMERA_KEY, mode);
  cameraCache = { value: mode, at: Date.now() };
}

/**
 * Whether the RunPod lane could actually run right now. Split into its two causes so the
 * Admin UI can name the missing piece instead of greying a button out silently.
 */
export function runpodLipsyncReadiness(): {
  endpointSet: boolean;
  keySet: boolean;
  ready: boolean;
} {
  const endpointSet = !!ENV.runpodInfinitetalkEndpoint;
  const keySet = !!ENV.runPodApiKey;
  return { endpointSet, keySet, ready: endpointSet && keySet };
}

/** Test-only: drop the caches so a test can flip a setting without waiting out CACHE_MS. */
export function __resetLipsyncCaches(): void {
  providerCache = null;
  qualityCache = null;
  cameraCache = null;
}

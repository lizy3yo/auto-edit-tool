/**
 * server/longformVideo.ts
 *
 * Long-form video pipeline. One pasted script becomes a finished multi-minute
 * video — a seated talking host interspersed with b-roll cutaways, narrated by the
 * VERBATIM script — fully AI-generated in a single fire-and-forget run:
 *
 *   1. voiceover  — the exact script voiced as ONE continuous master narration
 *      (per-paragraph TTS concatenated), stored to R2; its duration sets the length.
 *   2. storyboard — Claude turns the script into an ordered scene list sized to the
 *      narration, alternating host-on-camera shots and relevant b-roll cutaways
 *      (opening and closing on the host).
 *   3. clips      — one Grok clip per scene (host scenes get the reference face +
 *      seated face-lock prompt; b-roll is text-only) via the 69labs adapter.
 *   4. assembly   — clips concatenated and the master narration laid over the whole
 *      thing, trimmed to the narration length (server/videoAssembly.ts).
 *
 * Output is always 16:9; clip pacing is derived from the script, not user inputs.
 * Modeled on the multi-stage job pattern in ebookOrchestrator.ts / orchestrator.ts:
 * progress is persisted to the longform_video_jobs row and polled by the client.
 */

import { nanoid } from "nanoid";
import sharp from "sharp";
import { invokeClaude } from "./claude";
import { invokeGemini } from "./gemini";
import { safeParseJSON, stripMarkdownFences } from "./jsonRepair";
import { hasOverlayText } from "./overlayTextScan";
import {
  deriveStyleBible,
  deriveVisualDirection,
  truncateWords,
} from "./visualDirection";
import { getChannelLayer } from "./composer";
import { getBookNameTokens } from "./ctaDetector";
import {
  createUnifiedTTSTask,
  pollUnifiedTTSTask,
  capDeadAirPauses,
} from "./ttsUnified";
import { storagePut } from "./storage";
import { getActiveProvider, getProviderByType, hostNameAliases } from "./db";
import {
  createLongformVideoJob,
  updateLongformVideoJob,
  getLongformVideoJobById,
  getLongformVideoJobStatus,
  getAppSetting,
  setAppSetting,
} from "./db";
import { decrypt, encrypt, maskApiKey } from "./encryption";
import { createProviderAdapter, type ProviderAdapter } from "./providers";
import { ApimartAdapter } from "./providers/apimart";
import { generateOpenAIStill } from "./providers/openai-image";
import {
  withFaceLockPrompt,
  SIXTYNINE_VIDEO_SLOTS,
  SIXTYNINE_IMAGE_SLOTS,
  isContentPolicyError,
  isTransientVideoError,
} from "./providers/sixtynine-labs";
import {
  HeygenLipsyncAdapter,
  heygenSlotsFor,
  HEYGEN_LIPSYNC_TIMEOUT_MS,
} from "./providers/heygen-lipsync";
import { Semaphore } from "./providers/semaphore";

/**
 * The host lip-sync lane, resolved once per pipeline pass. Two providers ship today —
 * HeyGen Avatar IV (production) and RunPod InfiniteTalk (staging) — and they differ in more
 * than an API call: payload shape, concurrency cap, poll ceiling, scene wall clock, and
 * whether the render needs a tail trim. All of that hangs off this object so
 * `resolveLipsyncAdapter` is the ONLY place that branches on `ENV.lipsyncProvider`; every
 * caller downstream just uses the lane it was handed.
 */
type LipsyncLane = {
  provider: "runpod" | "heygen";
  /** Build + submit one render. The lane owns the provider-specific payload shape. */
  submit(req: {
    scene: StoryboardScene;
    imageUrl: string;
    audioUrl: string;
    /** True when the scene is pinned to the alt-angle host photo. */
    useAlt: boolean;
  }): Promise<VideoSubmitResult>;
  poll(taskId: string, timeoutMs?: number): Promise<GenerationResult>;
  /** Process-global in-flight cap for this provider. */
  slots: Semaphore;
  /** How wide the host `mapPool` runs. */
  concurrency: number;
  /** Per-scene wall clock for the host lane (see `SCENE_DEADLINE_*`). */
  sceneDeadlineMs: number;
};
import { ENV } from "./_core/env";
import { pickMusicBeds } from "./musicBeds";
import {
  assemblePerSceneFilm,
  planMusicSchedule,
  concatAudio,
  compositeSplitScreenClip,
  extractHostPanel,
  renderKenBurnsClip,
  dimensionsFor,
  probeBufferDurationSec,
  probeUrlDurationSec,
  extractMonoAudio,
  sliceAudioSegments,
  detectSilencesFromBuffer,
  HOST_INTRO_TRIM_SEC,
} from "./videoAssembly";
import { renderNameCardPng } from "./nameCard";
import { assignSceneRanges, numberWords } from "./narrationAlignment";
import {
  transcribeWordsFromBuffer,
  type WhisperWord,
} from "./_core/voiceTranscription";
import type {
  StoryboardScene,
  LongformInputParams,
  ProviderType,
  GenerationResult,
} from "../shared/types";
import { stripHostNames } from "../shared/constants";
import type { VideoSubmitResult } from "./providers/base";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Coalesced progress persistence. The clip stage rewrites the entire (large) `storyboard`
// JSON to one row on every scene completion and every per-chunk submit — 250-500 writes/run,
// many concurrent — which is what produces the `longform_video_jobs: Lock wait timeout`
// warnings. schedulePersist() collapses bursts to one trailing write per ~2.5s; flushPersist()
// drains the pending write before milestone transitions / read-backs.
// ponytail: trailing debounce, ~2.5s. A crash inside the window re-pays at most one chunk on
// resume (its submitted taskId wasn't flushed yet). Upgrade path: flush right after submit if
// double-pay ever shows up. `scenes` is a live mutated array, so a late write is never stale.
const PERSIST_DEBOUNCE_MS = 2500;
const _pendingPersist = new Map<
  number,
  { timer: ReturnType<typeof setTimeout>; updates: Record<string, unknown> }
>();

export function schedulePersist(
  jobId: number,
  updates: Record<string, unknown>
): void {
  const existing = _pendingPersist.get(jobId);
  if (existing) {
    Object.assign(existing.updates, updates);
    return;
  }
  const merged = { ...updates };
  const timer = setTimeout(() => {
    _pendingPersist.delete(jobId);
    updateLongformVideoJob(jobId, merged).catch(err =>
      console.warn(
        `[Longform ${jobId}] debounced persist failed: ${err?.message || err}`
      )
    );
  }, PERSIST_DEBOUNCE_MS);
  if (typeof timer.unref === "function") timer.unref();
  _pendingPersist.set(jobId, { timer, updates: merged });
}

export async function flushPersist(jobId: number): Promise<void> {
  const pending = _pendingPersist.get(jobId);
  if (!pending) return;
  clearTimeout(pending.timer);
  _pendingPersist.delete(jobId);
  await updateLongformVideoJob(jobId, pending.updates);
}

// Advisory job warnings, surfaced to the operator via the `progress` JSON blob that `pollJob`
// already returns verbatim (no schema change). Every wholesale `progress:` write goes through
// `jobProgress()` so appended warnings ride along instead of being clobbered.
// ponytail: in-memory only — a mid-job server restart loses them and the next progress write
// drops previously-persisted ones. Advisory data; seed from persisted progress on resume if
// that ever matters.
const _jobWarnings = new Map<number, string[]>();

export function clearJobWarnings(jobId: number): void {
  _jobWarnings.delete(jobId);
}

export function appendJobWarning(jobId: number, message: string): void {
  const list = _jobWarnings.get(jobId) ?? [];
  list.push(message);
  _jobWarnings.set(jobId, list);
  console.warn(`[Longform ${jobId}] WARNING: ${message}`);
}

export function jobProgress(
  jobId: number,
  counts: { scenesTotal: number; scenesDone: number }
): { scenesTotal: number; scenesDone: number; warnings?: string[] } {
  const warnings = _jobWarnings.get(jobId);
  return warnings?.length ? { ...counts, warnings } : counts;
}

// ─── Pure helpers (unit-tested) ────────────────────────────────────

/**
 * Shortest internal clip length (seconds). Replaces the removed user-facing clip-length
 * control: clip pacing is derived from the script, not chosen by the user. Grok Video
 * accepts 6–15s; 6 is the shortest possible raw clip. Each b-roll scene renders ONE clip
 * at `brollClipDuration(narration)`; assembly trims/pads to the measured narration.
 */
export const FIXED_CLIP_LEN = 6 as const;

/**
 * Maximum b-roll clip generation length (seconds) — matches the APIMART Grok range (6–15;
 * over 15 is a hard 400). Only the never-split scenes (`qrHero` / `coverHero` / an
 * unsplittable sentence) reach it — normal scenes cap at `LONG_SCENE_MAX_SEC`.
 */
export const BROLL_CLIP_MAX_SEC = 15 as const;

// ─── Per-scene sizing ──────────────────────────────────────────────
// Segmentation is SENTENCE-FIRST: a scene is one full sentence (or a few short
// consecutive sentences merged up to the 3s floor), so cuts always land where a
// sentence ends. Only a single sentence longer than `LONG_SCENE_MAX_SEC` may be
// clause-split — the sanctioned fallback. Post-TTS, `splitOverlongScenes` re-splits
// any scene MEASURING over that ceiling (TTS pace drift) at the same boundaries,
// and `coalesceShortScenes` merges any measured runt into a neighbor.

/** Best-effort floor (seconds) for any scene's measured narration. */
export const SCENE_MIN_SEC = 3;
/**
 * Ceiling (seconds) past which a single sentence may be clause-split — kept under the
 * `BROLL_CLIP_MAX_SEC` provider cap so every scene renders as ONE full-motion clip with no
 * freeze-frame pad. A longer unsplittable sentence stays whole and renders one clip at
 * `brollClipDuration` (freeze-padded past 15s).
 *
 * Was 10; lowered to 8 so cuts land faster. Applies to BOTH registers — `capFor` is
 * register-agnostic; host and b-roll differ only in their FLOOR (`HOST_MIN_HOLD_SEC` vs
 * `SCENE_MIN_HOLD_SEC`). A `qrTail` beat's spoken part gets `8 - QR_TAIL_HOLD_SEC` = 5s.
 */
export const LONG_SCENE_MAX_SEC = 8;

/**
 * Conversational pace assumed across the pipeline for word↔second estimates. Calibrated from
 * 197 scenes across 19 completed jobs (median 2.78, mean 2.82 words/sec at default TTS speed) —
 * tune if the default voice/speed changes. Was 2.5, which undershot the real rate.
 */
export const WORDS_PER_SEC = 2.8;
/**
 * ~`SCENE_MIN_SEC` worth of words at pace `wps` — a chunk keeps absorbing whole sentences
 * while under this. Sizing helpers take a pace so a voice whose RECOGNIZED pace (see
 * `recognizeVoiceWps`) differs from the default gets floors/ceilings in its own words.
 */
export const floorWordsFor = (wps: number): number =>
  Math.round(SCENE_MIN_SEC * wps);
/** ~`LONG_SCENE_MAX_SEC` worth of words at pace `wps` — only a sentence over this is clause-split. */
export const longWordsFor = (wps: number): number =>
  Math.round(LONG_SCENE_MAX_SEC * wps);
/** ~`SCENE_MIN_SEC` worth of words at the default pace — 8. */
export const FLOOR_WORDS = floorWordsFor(WORDS_PER_SEC);
/** ~`LONG_SCENE_MAX_SEC` worth of words at the default pace — 22. */
export const LONG_WORDS = longWordsFor(WORDS_PER_SEC);

/**
 * Minimum on-screen time (seconds) for any scene — a hard floor. Clause-splits and short tails
 * can still *measure* under it, and a cut that flips in under this reads as a jarring flash.
 * `coalesceShortScenes` merges any sub-floor scene into a neighbor (re-voiced as one take), or
 * holds the last frame, so no scene is ever on screen for less than this.
 */
export const SCENE_MIN_HOLD_SEC = 3;

/**
 * Minimum on-screen time (seconds) for a HOST scene — higher than the cutaway floor. A b-roll
 * cutaway can flash by; the lip-synced talking head cannot — a host cut that flips at ~3s reads
 * as a glitch on a face mid-sentence. Sub-floor host beats are made LONGER (merged with a
 * neighbor and re-voiced as one take, keeping the host register — see `coalesceShortScenes`),
 * and only freeze-held when there is no neighbor to merge with.
 */
export const HOST_MIN_HOLD_SEC = 4;

// ElevenLabs delivery dials. These were previously pinned to a defensive maximum
// (1.0 / 0 / 1.0) to stop the model improvising an "uhm"/breath lead-in on a scene that opens
// mid-sentence. That rationale is retired: the max never actually fixed it (see `fixClauseOnset`
// below — the filler appeared at TTS_STABILITY=1.0 too), capitalizing the clause onset did, and
// that runs on every scene, so TTS text never starts lowercase. The dials are free to serve
// delivery instead of guarding a bug that is already handled upstream.
//
// Values from an A/B sweep on voice 9T9vSqRrPPxIs5wpyZfK (scripts/voice-settings-test.ts): a
// one-factor sweep off the old baseline, plus an ONSET=1 rerun feeding the API a raw lowercase
// clause start — no invented lead-in at ANY setting, including stability 0.3. Lower stability
// buys shorter sentences with longer beats between them; style and similarity measured as
// near no-ops on that voice (±0.3s over a 72s read, identical transcripts) and are kept only
// because the chosen variant was tested as a set.
//
// ponytail: three global constants, not per-channel config — voice and speed are the dials that
// actually vary by channel. Move these into `channel_configs` only if a channel needs its own
// delivery. Re-run scripts/voice-settings-test.ts to re-tune.
export const TTS_STABILITY = 0.5; // 0–1, lower = more expressive phrasing/pauses
export const TTS_STYLE = 0.3; // 0–1, mild style exaggeration
export const TTS_SIMILARITY = 0.8; // 0–1, high = strong match to the source voice

/**
 * Stop ElevenLabs inventing a lead-in filler ("uhm"/breath) when a scene's TTS text starts
 * mid-sentence on a lowercase word — a clause-split beat can open on a lowercase "and" (see
 * `splitOverlongScenes`), which the model reads as a mid-sentence continuation and prefixes with
 * an improvised hesitation even at maximum stability. Capitalizing the first letter (casing only
 * — "And" and "and" are phonetically identical, so no spoken word changes) makes it read a clean
 * sentence onset instead. Scenes already starting on an uppercase letter (or with no letter) are
 * returned unchanged.
 *
 * ponytail: capitalize-only. A leading SSML `<break>` was tried and REMOVED — it made the model
 * inhale before the pause, which sounded like the very filler we were removing (A/B lab: the
 * break variant ran longer and kept the breath; capitalize-only was clean). Keep it to one dial.
 */
export function fixClauseOnset(text: string): string {
  const m = text.match(/[A-Za-z]/);
  if (!m || m.index === undefined) return text; // no letter → nothing to normalize
  if (!/[a-z]/.test(m[0])) return text; // first letter already uppercase → clean onset
  const i = m.index;
  return text.slice(0, i) + m[0].toUpperCase() + text.slice(i + 1);
}

// ─── Recognized speech pace ────────────────────────────────────────
// `WORDS_PER_SEC` is a global default; the real pace varies per voice. After a job's first
// voicing pass every scene carries its text AND a measured (ffprobe) duration, so the true
// pace is RECOGNIZED — median measured words/sec — instead of guessed. The current job uses
// it for the post-TTS split, and it is cached per voice so later jobs segment with it from
// the start: chunks are packed with enough words to genuinely fill `SCENE_MIN_HOLD_SEC` of
// speech, instead of voicing short and padding the shortfall with frozen-frame silence.
// ponytail: in-memory cache — the first job after a restart falls back to WORDS_PER_SEC;
// persist the pace in app settings if that ever matters.
const voiceWpsCache = new Map<string, number>();
/** Sanity clamp (≈130–210 wpm) so one anomalous job can't poison future segmentation. */
const WPS_SANE_MIN = 2.2;
const WPS_SANE_MAX = 3.5;
/** Minimum voiced scenes before a median is trusted. */
const WPS_MIN_SAMPLES = 5;

/**
 * The recognized pace for a voice: the cached measurement if any, else the `WORDS_PER_SEC`
 * default.
 */
export function wpsForVoice(voiceId: string | undefined | null): number {
  return voiceWpsCache.get(voiceId ?? "") ?? WORDS_PER_SEC;
}

/**
 * Recognize the job's real speech pace from its voiced scenes — the median of measured
 * words/sec — and cache it for the voice. Host scenes are excluded (pinned at
 * `HOST_TTS_SPEED`, not the conversational pace). Returns null (caching nothing) with fewer
 * than `WPS_MIN_SAMPLES` usable scenes or a median outside the sanity clamp. Unit-tested.
 */
export function recognizeVoiceWps(
  voiceId: string | undefined | null,
  scenes: StoryboardScene[]
): number | null {
  const rates = scenes
    .filter(s => !s.hostPresent && (s.audioDuration ?? 0) > 0)
    .map(s => wordCount(s.scriptText ?? s.narration ?? "") / s.audioDuration!)
    .filter(r => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b);
  if (rates.length < WPS_MIN_SAMPLES) return null;
  const mid = rates.length >> 1;
  const median =
    rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  if (median < WPS_SANE_MIN || median > WPS_SANE_MAX) return null;
  voiceWpsCache.set(voiceId ?? "", median);
  return median;
}

/**
 * B-roll clip generation length (seconds) for a scene whose narration is `durationSec`.
 * One scene → one clip: round UP to the next whole second and clamp to the provider range
 * 6–15. Ceil, not round: rounding down left the clip short of its narration, and assembly's
 * `tpad` clone-pad then froze the last frame for the remainder — visible on any moving
 * subject (job 199 scene 21: 8.461s narration → 8s clip → 0.42s of frozen fire). Ceiling
 * over-renders by <1s, which `-t durationSec` trims away. Pure — unit-tested.
 */
export function brollClipDuration(durationSec: number): number {
  if (durationSec <= 0) return FIXED_CLIP_LEN;
  return Math.max(
    FIXED_CLIP_LEN,
    Math.min(BROLL_CLIP_MAX_SEC, Math.ceil(durationSec))
  );
}

/**
 * Enforce clip field consistency: `clipUrl` mirrors `clipUrls[0]`. Legacy b-roll rows
 * that still carry multiple chunks collapse to the primary clip only.
 */
export function syncSceneClipFields(scene: StoryboardScene): StoryboardScene {
  if (scene.clipUrls?.length) {
    scene.clipUrl = scene.clipUrls[0];
    if (!scene.hostPresent && scene.clipUrls.length > 1) {
      scene.clipUrls = [scene.clipUrls[0]];
    }
  } else if (scene.clipUrl) {
    scene.clipUrls = [scene.clipUrl];
  }
  return scene;
}

/**
 * Target share of total video runtime spent on the seated talking-head host (the
 * lip-synced host scenes). The host is a frequent register, but cutaways still make
 * up the majority — the remaining runtime is b-roll. `rebalanceHostScreenTime` demotes
 * overshoot host scenes to b-roll to land at/just under this fraction (the open/close host
 * bookends are never demoted, so very short scripts may still exceed it). See
 * `rebalanceHostScreenTime`.
 *
 * The 35% host budget is itself split three ways by runtime: main camera 17.5% of total,
 * alt camera 10% (`HOST_ALT_CAMERA_FRACTION`), split-screen 7.5%
 * (`HOST_SPLITVISUAL_FRACTION`). The rest of the video is b-roll: stills 50%
 * (`STILL_IMAGE_FRACTION`), motion video the ~15% remainder.
 *
 * This is the WHOLE-VIDEO mean, not a flat per-scene rule: host is front-loaded along
 * `HOST_RAMP` (48% of Q1 down to 22% of Q4). It stays the literal budget only on a short
 * script (under `RAMP_MIN_SCENES`), where the ramp is skipped.
 */
export const HOST_SCREEN_FRACTION = 0.35;

/**
 * B-roll clips render on `grok-imagine-video`, keyframe-first, with NO cross-model fallback —
 * a grok failure fails the scene loudly (an in-model content-policy softer-prompt retry is the
 * only advance). Host clips also use `grok-imagine-video` (all via 69Labs). Grok accepts 1
 * imageUrl with no videoInputMode; only gemini-omni (face/reference, host) sends `videoInputMode`.
 * HeyGen Avatar IV lip-sync is active when the job's tab has a HeyGen key or HEYGEN_API_KEY is
 * set; without either, host scenes fail loudly (no silent grok fallback).
 */

/**
 * IMAGE LANE — a third scene register (alongside host and b-roll video). A person-free
 * cutaway marked `stillImage` is rendered as a 69labs STILL image animated with a subtle
 * pan/zoom (Ken Burns) instead of AI video: far cheaper/faster than a grok clip and free of motion
 * hallucination. `USE_IMAGE_LANE` is a kill switch — when false, `stillImage` scenes fall
 * back to the normal person-free b-roll video path.
 *
 * Emergency use only now: cutaways are stills unless flagged as moving (`parseStoryboard`), so
 * flipping this false drops ~70% of runtime onto the grok clip lane as frozen `settle` clips —
 * the exact spend the still-by-default rule exists to avoid.
 */
export const USE_IMAGE_LANE = true;
/**
 * Number of long-form video tabs (slots 0–4). Each tab holds its own per-provider API keys —
 * APIMART for b-roll clips, HeyGen for host lip-sync — stored encrypted in `app_settings`
 * (no schema migration) as JSON `{ last4, enc }`.
 */
export const LONGFORM_SLOT_COUNT = 5;
/**
 * Per-tab APIMART keys. Each tab renders b-roll grok-imagine CLIPS on its own APIMART account
 * (stills/keyframes always render on OpenAI's official gpt-image-2 — see
 * generateSceneStillClip/generateBrollKeyframe). A blank/unset slot ⇒ that tab falls back to the
 * 69Labs video path.
 */
const apimartSlotSettingKey = (slot: number): string =>
  `apimart_key_slot_${slot}`;
/** The Edit Images / Edit Videos pages render on their own APIMART key. */
const APIMART_EDIT_SETTING_KEY = "apimart_key_edit";
/**
 * Per-tab HeyGen keys. Each tab lip-syncs its host on its own HeyGen account — HeyGen caps
 * concurrent renders per ACCOUNT, so 5 accounts render 5× wider than one shared key. A
 * blank/unset slot ⇒ that tab falls back to the shared `HEYGEN_API_KEY` env var.
 */
const heygenSlotSettingKey = (slot: number): string =>
  `heygen_key_slot_${slot}`;

/** Decrypted raw provider API key for a setting, or null when unset/blank. */
async function getStoredKey(settingKey: string): Promise<string | null> {
  const raw = await getAppSetting(settingKey);
  if (!raw) return null;
  try {
    const { enc } = JSON.parse(raw) as { enc?: string };
    const key = enc ? decrypt(enc) : "";
    return key.trim() ? key : null;
  } catch {
    return null;
  }
}

/** Masked provider API key for admin display (•••…last4), or null when unset. */
async function getStoredMasked(settingKey: string): Promise<string | null> {
  const raw = await getAppSetting(settingKey);
  if (!raw) return null;
  try {
    const { last4 } = JSON.parse(raw) as { last4?: string };
    return last4 ? maskApiKey("x".repeat(20) + last4) : null;
  } catch {
    return null;
  }
}

/** Store (or, with an empty key, clear) a provider API key setting. */
async function setStoredKey(settingKey: string, apiKey: string): Promise<void> {
  const key = apiKey.trim();
  await setAppSetting(
    settingKey,
    key ? JSON.stringify({ last4: key.slice(-4), enc: encrypt(key) }) : ""
  );
}

export const getApimartSlotKey = (slot: number): Promise<string | null> =>
  getStoredKey(apimartSlotSettingKey(slot));
export const getApimartSlotMasked = (slot: number): Promise<string | null> =>
  getStoredMasked(apimartSlotSettingKey(slot));
export const setApimartSlotKey = (
  slot: number,
  apiKey: string
): Promise<void> => setStoredKey(apimartSlotSettingKey(slot), apiKey);

export const getApimartEditKey = (): Promise<string | null> =>
  getStoredKey(APIMART_EDIT_SETTING_KEY);
export const getApimartEditMasked = (): Promise<string | null> =>
  getStoredMasked(APIMART_EDIT_SETTING_KEY);
export const setApimartEditKey = (apiKey: string): Promise<void> =>
  setStoredKey(APIMART_EDIT_SETTING_KEY, apiKey);

export const getHeygenSlotKey = (slot: number): Promise<string | null> =>
  getStoredKey(heygenSlotSettingKey(slot));
export const getHeygenSlotMasked = (slot: number): Promise<string | null> =>
  getStoredMasked(heygenSlotSettingKey(slot));
export const setHeygenSlotKey = (slot: number, apiKey: string): Promise<void> =>
  setStoredKey(heygenSlotSettingKey(slot), apiKey);

/**
 * The APIMART video adapter for a job's tab, or null when the tab has no key. APIMART is the
 * ONLY b-roll VIDEO provider (no toggle, no fallback — `generateSceneClips` throws on null).
 * Resolved from `params.apimartSlot` at render time so a key rotation and job resumes both pick
 * up the current key.
 */
async function apimartAdapterForJob(
  params: LongformInputParams
): Promise<ApimartAdapter | null> {
  if (params.apimartSlot == null) return null;
  const key = await getApimartSlotKey(params.apimartSlot);
  return key ? new ApimartAdapter(key) : null; // no key ⇒ b-roll fails loud
}

/**
 * Target share of TOTAL video runtime rendered as stills (the still image lane). With host
 * at ~35% (`HOST_SCREEN_FRACTION`), the remaining ~15% of runtime is motion video — plain
 * person-free b-roll plus hands-at-work cutaways. The storyboard prompt nudges Claude
 * toward this mix, but the model is non-deterministic, so `enforceStillMotionRatio` converges
 * the actual still share to this fraction (clamped to the cutaway runtime) in code post-TTS.
 *
 * Like `HOST_SCREEN_FRACTION` this is the WHOLE-VIDEO mean: stills are back-loaded (26% of Q1
 * rising to 72% of Q4) as the derived remainder of `MOTION_RAMP`. It is the literal target
 * only on a short script (under `RAMP_MIN_SCENES`), where the ramp is skipped.
 *
 * In practice stills land WELL ABOVE this: only cutaways flagged `humanPresent`/`objectMotion`
 * may be clips at all (`parseStoryboard`), so every beat that just sits there lands here. Read
 * it as a floor on the still share rather than a target.
 */
export const STILL_IMAGE_FRACTION = 0.5;
/**
 * Target share of HOST runtime rendered as a split-frame (host + a generated visual beside
 * them) rather than full-frame host alone: 7.5% of total out of the 35% host budget.
 * `enforceHostSplitMix` converges the actual split to this fraction in code post-TTS; the
 * prompt only nudges Claude toward it. Split scenes always render from the PRIMARY host
 * photo (`assignHostShots` pins them to `hostShot = 0`), so they never eat the alt-camera slice.
 */
export const HOST_SPLITVISUAL_FRACTION = 7.5 / 35;
/**
 * Target share of HOST runtime rendered from the channel's SECOND host photo
 * (`faceImageUrl2`, the alt camera angle): 10% of total out of the 35% host budget, leaving
 * 17.5% on the main camera. `assignHostShots` converges the actual alt share by runtime.
 * Without a second photo the whole 27.5% non-split host budget stays on the main camera.
 */
export const HOST_ALT_CAMERA_FRACTION = 10 / 35;

/**
 * THE RAMP — the visual mix is NOT flat across the video. The film opens energetic (talking
 * head + moving b-roll) and settles into a calmer, image-led back half: the expensive,
 * high-motion registers buy attention early, cheap stills carry the tail.
 *
 * Both tables are indexed by RUNTIME QUARTER (`runtimeQuarters`) and are a share of THAT
 * QUARTER's runtime, not of the whole video. Their means are exactly the global fractions
 * above, so the ramp only REORDERS the mix — total render cost is unchanged:
 *
 *   quarter │ host │ video │ still
 *      Q1   │ 48%  │  26%  │  26%
 *      Q2   │ 40%  │  18%  │  42%
 *      Q3   │ 30%  │  10%  │  60%
 *      Q4   │ 22%  │   6%  │  72%
 *   ────────┼──────┼───────┼──────
 *     mean  │ 35%  │  15%  │  50%
 *
 * The still share is DERIVED (`eligible − motion`), never a third table: `rebalanceHostScreenTime`
 * only demotes, so host can land under its target, and anchoring stills would let motion balloon
 * into that slack and blow the global 15% (and the grok budget). Anchoring motion caps the
 * expensive lane instead and lets stills — the cheap, safe register — absorb every remainder.
 *
 * The video column is a CEILING, not a quota. Only cutaways flagged `humanPresent`/`objectMotion`
 * may be clips (`parseStoryboard`), and `enforceStillMotionRatio` will not manufacture more, so a
 * quarter whose material barely moves is MEANT to undershoot 26/18/10/6 — the self-verify log
 * prints the achievable cap beside the target to tell that apart from the balancer failing.
 */
export const HOST_RAMP = [0.48, 0.4, 0.3, 0.22];
/** Per-quarter MOTION b-roll CEILING — see `HOST_RAMP`. Mean 15%; stills take whatever is left. */
export const MOTION_RAMP = [0.26, 0.18, 0.1, 0.06];
/**
 * Below this scene count the ramp is skipped and the flat global fractions apply to the whole
 * film: quarters of a handful of scenes are too coarse to converge, and a short video has no
 * "back half" to settle into anyway.
 */
export const RAMP_MIN_SCENES = 8;

/**
 * Storyboard batching. The storyboard JSON costs ~250–400 output tokens per scene, so a
 * long video (e.g. ~69 scenes) blows past a single call's token budget and truncates —
 * which used to drop the whole video to all-host. We split the chunks into batches and
 * storyboard each in parallel, so no single response ever has to hold every scene.
 */
export const STORYBOARD_BATCH_SIZE = 25;
/**
 * Per-batch `maxTokens` for the storyboard call. ~1.6× headroom over a worst-case
 * `STORYBOARD_BATCH_SIZE`-scene batch (no extended thinking on this call). `salvageStoryboard`
 * is the safety net if a batch still truncates.
 */
export const STORYBOARD_BATCH_MAX_TOKENS = 16000;

/** app_settings key for the admin-editable longform direction (see `getAppSetting`). */
export const LONGFORM_INSTRUCTION_KEY = "longform_instruction_prompt";

/**
 * Default directing instruction, always applied to every long-form session when no
 * admin override is saved in `app_settings`. This is DIRECTION ONLY — it shapes the
 * storyboard/visuals (host identity, look, b-roll, tone, framing) and is NEVER voiced.
 * The spoken audio is always the user's verbatim script (see `extractSpokenScript`).
 * Admins can edit the live value at Admin → Longform.
 */
export const DEFAULT_LONGFORM_INSTRUCTION = `HOST IDENTITY (locked): the same on-camera host in every host shot — an early-60s man, weathered friendly face, real skin texture, short gray hair, wearing a plain, faded casual polo shirt with a worn, at-home look. Keep him visually identical across all host scenes. Absolutely no CGI, no "AI" look, no face changes, no morphing, no doubles.

LOOK: the seated host is real and unpolished — medium-quality consumer-camera footage, natural indoor light, calm and conversational in a cozy home study. No on-screen captions, text overlays, logos, motion graphics, drone shots, or fast cuts.

SPLIT-SCREEN (occasional): on product-demo or before/after beats, roughly 1 in 5 host shots may use a split-frame — host on the left half talking to camera, the relevant product or before/after result on the right half.

TONE: slow, trustworthy, educational, aimed at viewers aged 50+.

FRAMING: every shot is 16:9 horizontal landscape.`;

// Tolerant spoken-script markers: case-insensitive, any run of "=", optional spaces.
const SCRIPT_START_MARKER = /^[ \t]*={2,}[ \t]*SCRIPT[ \t]*={2,}[ \t]*$/im;
const SCRIPT_END_MARKER =
  /^[ \t]*={2,}[ \t]*END[ \t]+SCRIPT[ \t]*={2,}[ \t]*$/im;

/** True if a blank-line-delimited paragraph is part of the known template preamble. */
function isPreambleParagraph(p: string): boolean {
  const t = p.trim();
  if (!t) return true;
  if (/^reference image\b.*identity lock/i.test(t)) return true;
  if (/^this is the spoken script\b/i.test(t)) return true;
  if (/^host\s*\(/i.test(t)) return true;
  if (/^look\s*&?\s*pacing/i.test(t)) return true;
  // A paragraph made entirely of "* …" bullets (optionally led by a Host:/Look header).
  const lines = t
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
  return (
    lines.length > 0 &&
    lines.every(
      l =>
        l.startsWith("*") ||
        /^host\s*\(/i.test(l) ||
        /^look\s*&?\s*pacing/i.test(l)
    )
  );
}

/**
 * Return ONLY the spoken portion of a pasted script — the text that should be voiced
 * verbatim. Directing text (identity lock, host look, look & pacing) must never be
 * spoken; that lives in the saved instruction (`DEFAULT_LONGFORM_INSTRUCTION`).
 *
 * - If a tolerant `=== SCRIPT ===` marker is present, return what's after it (up to an
 *   optional `=== END SCRIPT ===`).
 * - Otherwise strip a recognized leading template-preamble block only, stopping at the
 *   first normal narration paragraph. A pure script (no marker/preamble) is unchanged.
 *
 * Conservative: never returns empty when the input is non-empty (falls back to the raw
 * text if stripping would remove everything). Pure — unit-tested.
 */
export function extractSpokenScript(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const start = raw.match(SCRIPT_START_MARKER);
  if (start && start.index !== undefined) {
    let after = raw.slice(start.index + start[0].length);
    const end = after.match(SCRIPT_END_MARKER);
    if (end && end.index !== undefined) after = after.slice(0, end.index);
    const trimmed = after.trim();
    return trimmed || raw.trim();
  }
  const paras = raw.split(/\n\s*\n/);
  let i = 0;
  while (i < paras.length && isPreambleParagraph(paras[i])) i++;
  if (i === 0 || i >= paras.length) return raw.trim(); // nothing stripped, or would empty
  return paras.slice(i).join("\n\n").trim();
}

// Exact CTA block markers (own line; surrounding spaces/tabs tolerated, nothing else).
// Deliberately NOT tolerant like the SCRIPT markers — the script template emits them verbatim.
const CTA_START_LINE = /^[ \t]*===START CTA===[ \t]*$/;
const CTA_END_LINE = /^[ \t]*===END CTA===[ \t]*$/;

/** One marked CTA block, as WORD offsets (whitespace-split, end-exclusive) into the cleaned
 *  script — word offsets because downstream scene chunking whitespace-normalizes text. */
export interface CtaSpan {
  start: number;
  end: number;
}

/**
 * Parse the explicit `===START CTA===` / `===END CTA===` marker lines out of the spoken
 * script. The markers are ground truth for where each CTA pitch block sits (mid-roll +
 * close); they are stripped here so they are never voiced. Returns the cleaned script, the
 * marked blocks as word-offset spans into it, and any pairing errors (`END` before `START`,
 * an unclosed `START`, a nested `START`) — non-empty errors mean the script is malformed and
 * the caller should reject it. Empty blocks (adjacent markers) are dropped. A script with no
 * markers returns unchanged with `spans: []`. Pure — unit-tested.
 */
export function parseCtaMarkers(spoken: string): {
  script: string;
  spans: CtaSpan[];
  errors: string[];
} {
  const kept: string[] = [];
  const spans: CtaSpan[] = [];
  const errors: string[] = [];
  let open: number | null = null;
  let words = 0;
  for (const line of spoken.split("\n")) {
    if (CTA_START_LINE.test(line)) {
      if (open != null)
        errors.push("===START CTA=== while the previous block is still open");
      else open = words;
      continue;
    }
    if (CTA_END_LINE.test(line)) {
      if (open == null)
        errors.push("===END CTA=== without a preceding ===START CTA===");
      else {
        if (words > open) spans.push({ start: open, end: words });
        open = null;
      }
      continue;
    }
    kept.push(line);
    words += line.split(/\s+/).filter(Boolean).length;
  }
  if (open != null)
    errors.push("===START CTA=== without a closing ===END CTA===");
  const script = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { script, spans, errors };
}

/**
 * Marker validation for job submission: extract the spoken portion, then parse the CTA
 * markers. The router rejects on `errors` (malformed pairing) and — when the channel has a
 * book cover/QR configured — on `spans.length === 0` (markers required). Pure — unit-tested.
 */
export function validateCtaMarkers(rawScript: string): {
  spans: CtaSpan[];
  errors: string[];
} {
  const { spans, errors } = parseCtaMarkers(extractSpokenScript(rawScript));
  return { spans, errors };
}

/**
 * The 69Labs Grok duration the adapter will actually generate for a given clip length.
 * Grok Video only accepts 6 or 10 (no 4/5), so this is the identity over those two values.
 */
export function clipDurationParam(clipLen: 6 | 10): 6 | 10 {
  return clipLen;
}

/** Approximate spoken word budget that fits within a clip (leaving ~2s headroom). */
export function narrationWordBudget(clipLen: 6 | 10): number {
  // ~2.5 words/sec conversational pace
  return Math.max(4, Math.round((clipLen - 2) * 2.5));
}

/**
 * Split a script into TTS-sized segments WITHOUT rewriting a single word. Splits
 * on blank-line paragraph boundaries (natural pauses); any paragraph longer than
 * `maxChars` is sub-split on sentence boundaries and greedily re-packed. Joining
 * the returned segments with a space reproduces the script (whitespace-normalized).
 * Used by the talking-head path to voice the verbatim script as one continuous
 * narration instead of a per-scene paraphrase. Pure — unit-tested.
 */
export function splitScriptForNarration(
  script: string,
  maxChars = 4000
): string[] {
  const paragraphs = script
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const segments: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      segments.push(para);
      continue;
    }
    // Paragraph too long for one TTS request — sub-split on sentence boundaries.
    const sentences = para.split(/(?<=[.!?])\s+/);
    let buf = "";
    for (const s of sentences) {
      if (!buf) buf = s;
      else if ((buf + " " + s).length <= maxChars) buf += " " + s;
      else {
        segments.push(buf);
        buf = s;
      }
    }
    if (buf) segments.push(buf);
  }
  return segments.length ? segments : [script.replace(/\s+/g, " ").trim()];
}

/** One atomic script unit (a sentence) with exact offsets into the original script. */
export interface ScriptUnit {
  /** 1-based position in the unit list. */
  index: number;
  /** Trimmed display text of the unit (what Claude is shown). */
  text: string;
  /** Inclusive start offset into the script. */
  start: number;
  /** Exclusive end offset into the script (includes the unit's trailing whitespace). */
  end: number;
}

/**
 * Split a script into numbered sentence UNITS with exact character offsets, such that
 * `units.map(u => script.slice(u.start, u.end)).join("")` reproduces the script
 * byte-for-byte (the offset spans tile `[0, script.length)` with no gap/overlap).
 *
 * This is the alignment foundation: Claude groups these unit indices into scenes, and
 * each scene's verbatim narration is sliced back out of the original string by offset —
 * so the text Claude returns is never trusted, only its integer boundaries. Over-splitting
 * (e.g. on "Dr." or a decimal) is harmless: no text is lost and Claude regroups. Pure.
 */
export function splitIntoUnits(script: string): ScriptUnit[] {
  if (!script) return [];
  const units: ScriptUnit[] = [];
  // Sentence end: terminal punctuation, optional closing quote/bracket, then whitespace.
  const boundary = /[.!?]+["')\]]?\s+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = boundary.exec(script)) !== null) {
    const end = m.index + m[0].length;
    const text = script.slice(last, end).trim();
    if (text) {
      units.push({ index: ++idx, text, start: last, end });
      last = end;
    }
  }
  if (last < script.length) {
    const text = script.slice(last, script.length).trim();
    if (text) {
      units.push({ index: idx + 1, text, start: last, end: script.length });
    } else if (units.length) {
      // Trailing whitespace only — absorb it into the last unit so the span tiles fully.
      units[units.length - 1].end = script.length;
    }
  }
  if (units.length === 0) {
    return [{ index: 1, text: script.trim(), start: 0, end: script.length }];
  }
  return units;
}

/** Word count of a string (whitespace-collapsed). */
function wordCount(s: string): number {
  const t = s.replace(/\s+/g, " ").trim();
  return t ? t.split(" ").length : 0;
}

/** First `n` words of a string, for a short scene display label. */
function firstWords(text: string, n: number): string {
  const joined = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, n)
    .join(" ");
  return joined || "(narration)";
}

/**
 * Deterministic fallback partition: greedily group consecutive units into ~one-clip-worth
 * beats (by word budget), returning each group's [start,end) offset span. Always a valid
 * in-order, complete, verbatim cover of the script. Pure.
 */
export function groupUnitsForFallback(
  units: ScriptUnit[]
): { start: number; end: number }[] {
  if (units.length === 0) return [];
  const budget = narrationWordBudget(FIXED_CLIP_LEN);
  const groups: { start: number; end: number }[] = [];
  let curStart = units[0].start;
  let curEnd = units[0].end;
  let curWords = wordCount(units[0].text);
  for (let i = 1; i < units.length; i++) {
    const w = wordCount(units[i].text);
    if (curWords > 0 && curWords + w > budget) {
      groups.push({ start: curStart, end: curEnd });
      curStart = units[i].start;
      curEnd = units[i].end;
      curWords = w;
    } else {
      curEnd = units[i].end;
      curWords += w;
    }
  }
  groups.push({ start: curStart, end: curEnd });
  return groups;
}

/** An offset span into the script (verbatim — `script.slice(start, end)`). */
export interface OffsetSpan {
  start: number;
  end: number;
}

/**
 * Split ONE sentence unit into clause-level sub-spans so an over-long sentence can be broken
 * without rewriting a word. Boundaries are TWO-TIER, not one flat set:
 *
 * 1. `,` `;` `:` and em/en dashes — always used. A sentence separates at its commas and dashes.
 * 2. Coordinating conjunctions (and/but/or/so/…) — FALLBACK only, added inside a comma clause
 *    that is still over `longWords`. Cutting before a bare `that`/`then` reads mid-phrase, so
 *    it happens only where commas alone can't get the piece under the ceiling.
 *
 * The returned spans tile `[unit.start, unit.end)` exactly (verbatim cover); a sentence with no
 * usable boundary returns a single span (the whole unit — unsplittable). Over-splitting is
 * harmless: the segmenter's floor-merge regroups runt sub-spans. Pure.
 */
export function splitUnitIntoClauses(
  unit: ScriptUnit,
  script: string,
  /** Ceiling past which a comma clause is cut further, at conjunctions. */
  longWords: number = longWordsFor(WORDS_PER_SEC)
): OffsetSpan[] {
  const raw = script.slice(unit.start, unit.end);
  const bounds = new Set<number>();
  // Clause punctuation: comma/semicolon/colon (optional closing quote/bracket) then space, OR an
  // em/en dash with or without surrounding space (scripts lean on `—` as a clause break, and one
  // written without spaces used to leave the whole sentence unsplittable).
  const punct = /(?:[,;:]["')\]]?\s+|\s*[—–]\s*)/g;
  let m: RegExpExecArray | null;
  while ((m = punct.exec(raw)) !== null) bounds.add(m.index + m[0].length);
  /** Tile [unit.start, unit.end) at `bounds` (offsets into `raw`), verbatim and gap-free. */
  const spansFrom = (): OffsetSpan[] => {
    const sorted = Array.from(bounds)
      .filter(b => b > 0 && b < raw.length)
      .sort((a, b) => a - b);
    const out: OffsetSpan[] = [];
    let last = 0;
    for (const b of sorted) {
      out.push({ start: unit.start + last, end: unit.start + b });
      last = b;
    }
    // Final sub-span runs to unit.end (covers the unit's trailing whitespace) so the spans
    // tile [unit.start, unit.end) with no gap.
    out.push({ start: unit.start + last, end: unit.end });
    return out;
  };
  // Tier 2: only the comma clauses that are STILL too long get conjunction boundaries.
  for (const s of spansFrom()) {
    if (wordCount(script.slice(s.start, s.end)) <= longWords) continue;
    const to = s.end - unit.start;
    // Cut BEFORE the conjunction (the leading whitespace stays with the previous clause so
    // the spans still tile fully).
    const conj = /\s+(?:and|but|or|so|because|yet|while|then|which|that)\s+/gi;
    conj.lastIndex = s.start - unit.start;
    while ((m = conj.exec(raw)) !== null && m.index < to) {
      const lead = (m[0].match(/^\s+/) ?? [""])[0].length;
      bounds.add(m.index + lead);
    }
  }
  // No usable boundary → one span (the whole unit), which is what an empty `bounds` tiles to.
  return spansFrom();
}

/**
 * Pack `count` chunks off the FRONT of the script, each filled to at least `floorWords` — the
 * locked host cold open (`StoryboardScene.hostOpener`), which must genuinely SPEAK its
 * `HOST_MIN_HOLD_SEC` rather than voice short and hold a frozen face over inserted silence
 * (`applySceneHoldFloor`). This is a FLOOR, not the ceiling the rest of the film packs against:
 * a chunk keeps taking atoms until it crosses the floor, so an opener is never under it and
 * overshoot is whatever the crossing clause carries.
 *
 * Atoms are whole SENTENCES (same rule as the main pass): the opener ends where a sentence
 * ends, so the cold-open cut never lands mid-sentence. Only a single sentence over the long
 * ceiling is clause-split. The crossing sentence's overshoot is fine — the host speaks its
 * whole shot regardless of length, and `splitOverlongScenes` exempts `hostOpener`.
 *
 * Returns the packed chunks plus the units still to be segmented normally. When the opener ends
 * mid-sentence (clause fallback only), the straddled unit's REMAINDER is re-emitted as its own
 * unit so the two halves still tile the script with no gap. Pure — unit-tested.
 */
function packOpenerChunks(
  units: ScriptUnit[],
  script: string,
  floorWords: number,
  count: number,
  /** Sentence-length ceiling past which a single sentence is clause-split. */
  longWords: number = longWordsFor(WORDS_PER_SEC)
): { chunks: OffsetSpan[]; rest: ScriptUnit[] } {
  if (count <= 0 || units.length === 0) return { chunks: [], rest: units };
  const atoms: { start: number; end: number; words: number }[] = [];
  for (const u of units) {
    if (wordCount(u.text) > longWords) {
      for (const span of splitUnitIntoClauses(u, script, longWords)) {
        atoms.push({
          ...span,
          words: wordCount(script.slice(span.start, span.end)),
        });
      }
    } else {
      atoms.push({ start: u.start, end: u.end, words: wordCount(u.text) });
    }
  }
  const chunks: OffsetSpan[] = [];
  let i = 0;
  while (chunks.length < count && i < atoms.length) {
    const start = atoms[i].start;
    let end = atoms[i].end;
    let words = atoms[i].words;
    i++;
    // Keep absorbing until the chunk clears the floor. The crossing atom is included, so the
    // only way to close under the floor is to run out of script.
    while (i < atoms.length && words < floorWords) {
      end = atoms[i].end;
      words += atoms[i].words;
      i++;
    }
    chunks.push({ start, end });
  }
  const last = chunks[chunks.length - 1];
  const rest: ScriptUnit[] = [];
  for (const u of units) {
    if (u.start >= last.end) rest.push(u);
    else if (u.end > last.end) {
      const text = script.slice(last.end, u.end);
      // A clause bound always lands on a word, so the remainder has content; if a degenerate
      // script ever leaves only whitespace, keep it with the opener rather than emit a runt.
      if (text.trim()) rest.push({ ...u, start: last.end, text: text.trim() });
      else last.end = u.end;
    }
  }
  return { chunks, rest };
}

/**
 * SENTENCE-FIRST segmentation: partition the script into chunks whose boundaries always land
 * where a sentence ends, returning verbatim offset spans that tile the whole script. This runs
 * BEFORE the storyboard — Claude then assigns a visual to each fixed chunk rather than choosing
 * the cuts — and post-TTS `splitOverlongScenes`/`coalesceShortScenes` correct the residual after
 * the real durations are measured.
 *
 * Algorithm:
 * - Decompose units to ATOMS: one atom per sentence, UNLESS a single sentence exceeds
 *   `longWordsFor(wps)` (~`LONG_SCENE_MAX_SEC` of speech) — then its clauses
 *   (`splitUnitIntoClauses`: commas first, conjunctions only inside a comma clause that is
 *   still over the ceiling) are repacked into ≤ long-ceiling sub-chunks, each emitted as its
 *   own final chunk (the sanctioned clause fallback; a split sentence never merges with
 *   neighboring sentences). Atoms tile the script.
 * - Pack sentences: accumulate consecutive sentence atoms only while the chunk is under
 *   `floorWordsFor(wps)`; the moment the floor is met the chunk closes. No target, no ceiling
 *   packing — one sentence at/above the floor is exactly one scene. (Forward-greedy also
 *   regroups `splitIntoUnits` over-splits like "Dr." — a runt merges into the next sentence.)
 * - Tail: a trailing sub-floor chunk is absorbed into the previous chunk (up to
 *   `longWordsFor(wps)`) so we don't emit a runt; an un-absorbable lone short chunk is left
 *   as-is.
 *
 * `segmentScriptByDuration(units, s).map(c => s.slice(c.start, c.end)).join("")` reproduces `s`. Pure.
 *
 * `openerChunks` > 0 packs that many chunks off the FRONT against a FLOOR of `HOST_MIN_HOLD_SEC`
 * worth of words, for the locked host cold open (see `StoryboardScene.hostOpener`) — a talking
 * head must speak its whole shot, never freeze-hold to the floor. See `packOpenerChunks`.
 */
export function segmentScriptByDuration(
  units: ScriptUnit[],
  script: string,
  /** Speech pace for the word floors/ceilings — the voice's recognized pace when known. */
  wps: number = WORDS_PER_SEC,
  /** Chunks packed to the host floor off the front for the locked host opener (0 = none). */
  openerChunks: number = 0
): OffsetSpan[] {
  if (units.length === 0) return [];
  const floorWords = floorWordsFor(wps);
  const longWords = longWordsFor(wps);
  // 0. Locked host opener: pack the first `openerChunks` against the host floor, then segment the
  //    rest normally. Both halves tile their own span, so the concatenation still reproduces
  //    `script`. Ceil, not round: a voice faster than `wps` must still clear HOST_MIN_HOLD_SEC.
  const opener = packOpenerChunks(
    units,
    script,
    Math.ceil(HOST_MIN_HOLD_SEC * wps),
    openerChunks,
    longWords
  );
  if (opener.chunks.length > 0) {
    return [
      ...opener.chunks,
      ...segmentScriptByDuration(opener.rest, script, wps),
    ];
  }
  const chunks: OffsetSpan[] = [];
  // Open sentence-accumulator chunk (null = none open).
  let cur: { start: number; end: number; words: number } | null = null;
  const closeCur = () => {
    if (cur) chunks.push({ start: cur.start, end: cur.end });
    cur = null;
  };
  for (const u of units) {
    const uWords = wordCount(u.text);
    if (uWords > longWords) {
      // Over-long sentence: repack its clauses into ≤ longWords sub-chunks, each ≥ floorWords
      // where possible, emitted as final chunks. A sub-floor run of short sentences still
      // accumulating is folded into the FIRST sub-chunk (its cut still lands on a clause
      // boundary) rather than emitted as a mid-script runt.
      const clauses = splitUnitIntoClauses(u, script, longWords).map(span => ({
        ...span,
        words: wordCount(script.slice(span.start, span.end)),
      }));
      let sub = cur
        ? {
            start: cur.start,
            end: clauses[0].end,
            words: cur.words + clauses[0].words,
          }
        : { ...clauses[0] };
      cur = null;
      const firstSubIndex = chunks.length;
      for (let i = 1; i < clauses.length; i++) {
        const c = clauses[i];
        if (sub.words + c.words > longWords && sub.words >= floorWords) {
          chunks.push({ start: sub.start, end: sub.end });
          sub = { ...c };
        } else {
          sub.end = c.end;
          sub.words += c.words;
        }
      }
      // Absorb a sub-floor trailing sub-chunk into its previous sibling (same sentence, so the
      // merge cannot cross a sentence boundary) — unless the merge would break the long
      // ceiling; then it stays a runt for the post-TTS coalesce to fold.
      const prev = chunks[chunks.length - 1];
      if (
        sub.words < floorWords &&
        chunks.length > firstSubIndex &&
        prev &&
        wordCount(script.slice(prev.start, sub.end)) <= longWords
      ) {
        prev.end = sub.end;
      } else {
        chunks.push({ start: sub.start, end: sub.end });
      }
      continue;
    }
    if (!cur) {
      cur = { start: u.start, end: u.end, words: uWords };
    } else {
      cur.end = u.end;
      cur.words += uWords;
    }
    // Close the moment the floor is met — one sentence at/above the floor is one scene.
    if (cur.words >= floorWords) closeCur();
  }
  closeCur();
  // Tail floor: absorb a trailing sub-floor chunk into the previous one when the merge stays
  // under the long ceiling.
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    const lastWords = wordCount(script.slice(last.start, last.end));
    const mergedWords = wordCount(script.slice(prev.start, last.end));
    if (lastWords < floorWords && mergedWords <= longWords) {
      chunks.splice(chunks.length - 2, 2, { start: prev.start, end: last.end });
    }
  }
  return chunks;
}

/**
 * Snap Claude's (possibly imperfect) scene ranges into a contiguous, complete partition
 * of units `1..M`: scene 1 starts at unit 1, each scene starts right after the previous,
 * and the final scene always extends to unit M. Drops surplus scenes once M is covered.
 * Throws only when there is nothing to partition. Pure.
 */
export function repairPartition<
  T extends { startUnit: number; endUnit: number },
>(ranges: T[], M: number): T[] {
  if (M <= 0) throw new Error("No script units to partition");
  const out: T[] = [];
  let cursor = 1;
  for (const r of ranges) {
    if (cursor > M) break;
    const start = cursor;
    let end = Math.min(M, Math.round(Number(r.endUnit)));
    if (!Number.isFinite(end) || end < start) end = start;
    out.push({ ...r, startUnit: start, endUnit: end });
    cursor = end + 1;
  }
  if (out.length === 0) throw new Error("Storyboard partition empty");
  out[out.length - 1].endUnit = M;
  return out;
}

/**
 * Number of talking-head clips needed to cover a narration of `durationSec`. Each
 * generated clip is ~`clipDurationParam` seconds, minus the reference-photo intro
 * trimmed off its head (`HOST_INTRO_TRIM_SEC`), so the usable length is shorter.
 * One safety clip is added; the assembly trims the surplus to the exact narration
 * length. Pure — unit-tested.
 */
export function talkingHeadClipCount(
  durationSec: number,
  clipLen: 6 | 10
): number {
  const usable = Math.max(2, clipDurationParam(clipLen) - HOST_INTRO_TRIM_SEC);
  return Math.max(1, Math.ceil(durationSec / usable) + 1);
}

/** Visual treatment Claude assigns to one fixed chunk (everything except the script slice). */
type ChunkVisual = Pick<
  StoryboardScene,
  | "visualPrompt"
  | "cameraCue"
  | "hostPresent"
  | "brollVisual"
  | "splitVisual"
  | "stillImage"
  | "humanPresent"
  | "objectMotion"
  | "shotAngle"
  | "cta"
  | "showsBook"
>;

/**
 * Validate + normalize the storyboard JSON returned by Claude. Boundaries are NOT Claude's
 * to choose — the script is pre-segmented into `chunks` (`segmentScriptByDuration`) and Claude
 * returns one visual-assignment object per chunk, keyed by 1-based `index`. We map each entry
 * to its chunk, slice the VERBATIM narration out of `spokenScript` by the chunk's offsets
 * (Claude's text is never trusted), and DEFAULT-FILL any chunk Claude omitted or returned
 * malformed with a plain host shot. Throws only when the JSON has no usable scenes array (so
 * `buildUnifiedScenes` retries / falls back). Returns one scene per chunk, in order.
 */
export function parseStoryboard(
  rawText: string,
  chunks: OffsetSpan[],
  spokenScript: string,
  stopReason?: string,
  /**
   * How many leading scenes form the LOCKED host cold open (`StoryboardScene.hostOpener`): 1
   * (the "open on host" invariant), or 2 when the channel has an alt host photo, so every film
   * opens on the same two-angle host shot. 0 for non-first batches, whose first scene is
   * interior to the merged video and must not be forced to host.
   */
  openerHostScenes = 1
): StoryboardScene[] {
  const parsed = safeParseJSON<{ scenes: any[] }>(rawText, stopReason);
  if (!parsed.success || !parsed.data) {
    throw new Error(parsed.error || "Storyboard JSON parse failed");
  }
  const rawScenes = parsed.data.scenes;
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    throw new Error("Storyboard contained no scenes");
  }
  const K = chunks.length;
  const VALID_SHOT_ANGLES = ["mid", "wide", "overhead", "low", "pov"] as const;
  // Parse each returned object into a visual assignment keyed by its chunk index. Entries
  // with a bad/out-of-range index or no visualPrompt are dropped (their chunk default-fills);
  // first valid entry wins if Claude duplicates an index.
  const byIndex = new Map<number, ChunkVisual>();
  for (const s of rawScenes) {
    const index = Math.round(Number(s?.index));
    if (!Number.isFinite(index) || index < 1 || index > K) continue;
    if (byIndex.has(index)) continue;
    const visualPrompt =
      typeof s?.visualPrompt === "string" ? s.visualPrompt.trim() : "";
    if (!visualPrompt) continue;
    const splitVisual =
      typeof s?.splitVisual === "string" && s.splitVisual.trim()
        ? s.splitVisual.trim()
        : undefined;
    // Script-tailored lighting/mood + camera-movement cue. Now consumed ONLY by host
    // split-screen scenes (styles the right-half panel); b-roll/still prompts ignore it.
    const cameraCue =
      typeof s?.cameraCue === "string" && s.cameraCue.trim()
        ? s.cameraCue.trim()
        : undefined;
    // Person-free cutaway used only if this host scene is demoted to b-roll to
    // hit the host-screen-time budget (see rebalanceHostScreenTime).
    const brollVisual =
      typeof s?.brollVisual === "string" && s.brollVisual.trim()
        ? s.brollVisual.trim()
        : undefined;
    const hostPresent = Boolean(s?.hostPresent);
    // A scripted human in a non-host cutaway (still or motion b-roll) — rendered from
    // the face model. Redundant on host shots (they already place the host on camera),
    // so only honored when hostPresent is false.
    const humanPresent = !hostPresent && Boolean(s?.humanPresent);
    // The beat's subject moves by itself (running water, a flame, pouring liquid) — the clip
    // locks the camera and lets it move. Not gated on `stillImage`: `buildStillPrompt` serves
    // both the still lane and the b-roll keyframe, and a frame of water mid-stream beats a
    // settled puddle in either.
    const objectMotion = !hostPresent && Boolean(s?.objectMotion);
    // Image lane: a still + pan/zoom. Only valid on a non-host cutaway.
    //
    // Backstop for the planner rule in `buildUnifiedStoryboardPrompt`: a cutaway with NEITHER
    // motion flag is FORCED to a still whatever the planner asked for. A grok clip of nothing
    // moving is the expensive lane rendering what the cheap one renders better — measured at
    // 10.4% of runtime before this gate. Establishes the invariant the clip lanes rely on:
    //   !hostPresent && !stillImage  ⟹  humanPresent || objectMotion
    // Declared after both flags on purpose — reading them above this line is a TDZ error.
    const stillImage =
      !hostPresent &&
      (Boolean(s?.stillImage) || !(humanPresent || objectMotion));
    // CTA scene (Claude-marked). markCtaScenes later flags the full pitch span `cta:true`
    // (bridging short gaps) to drive the QR overlay; it no longer touches the register.
    const cta = Boolean(s?.cta);
    // Shot angle for b-roll/still scenes — drives a camera-direction phrase appended in code.
    // Validated against the allowed enum; absent on host/CTA scenes (ignored there).
    const shotAngle =
      !hostPresent && VALID_SHOT_ANGLES.includes(s?.shotAngle)
        ? (s.shotAngle as (typeof VALID_SHOT_ANGLES)[number])
        : undefined;
    // ponytail: b-roll no longer depicts the book — force off so no cover reference is
    // attached at gen time (any lane gating on `showsBook` sees false). The end-of-video
    // literal cover reveal (`coverHero`) is independent and unaffected.
    const showsBook = false;
    byIndex.set(index, {
      visualPrompt,
      cameraCue,
      hostPresent,
      brollVisual,
      splitVisual,
      stillImage,
      humanPresent,
      objectMotion,
      shotAngle,
      cta,
      showsBook,
    });
  }
  const scenes: StoryboardScene[] = chunks.map((c, i) => {
    const scriptText = spokenScript.slice(c.start, c.end).trim();
    const v = byIndex.get(i + 1);
    // Default-fill an omitted/malformed chunk with a plain host shot (the saved descriptor
    // look) so every chunk still becomes a complete, voiceable scene.
    if (!v) {
      return {
        index: i + 1,
        scriptText,
        narration: firstWords(scriptText, 8),
        visualPrompt: talkingHeadVisualPrompt(DEFAULT_HOST_DESCRIPTOR, i),
        hostPresent: true,
        sceneStatus: "pending" as const,
      };
    }
    return {
      index: i + 1,
      scriptText,
      narration: firstWords(scriptText, 8),
      ...v,
      sceneStatus: "pending" as const,
    };
  });
  // Hard invariant: the video OPENS on the LOCKED host cold open — scene 1, plus scene 2 when the
  // channel has an alt host photo. Claude is asked to (storyboard prompt), but this guarantees it,
  // and `hostOpener` carries the lock through every later pass (no demotion, no forced split, no
  // split/merge) so the opening two-shot is identical in every longform job.
  // A non-host opener is rebuilt from the default-fill host shape; an already-host one keeps
  // Claude's visual and just loses any split (the cold open is always full-frame host).
  for (let i = 0; i < openerHostScenes && i < scenes.length; i++) {
    const s = scenes[i];
    scenes[i] =
      s.hostPresent === true
        ? { ...s, splitVisual: undefined, hostOpener: true as const }
        : {
            index: s.index,
            scriptText: s.scriptText,
            narration: s.narration,
            visualPrompt: talkingHeadVisualPrompt(DEFAULT_HOST_DESCRIPTOR, i),
            hostPresent: true,
            hostOpener: true as const,
            sceneStatus: "pending" as const,
          };
  }
  return scenes;
}

/**
 * Enforce the host-screen-time budget by runtime, PER RUNTIME QUARTER along `HOST_RAMP` —
 * 48% of Q1 falling to 22% of Q4, which means `HOST_SCREEN_FRACTION` (35%) over the whole film.
 * Host scenes (the lip-synced Avatar IV shots) are the only ones counted; demoting one to
 * b-roll changes only its visual register, never its narration or duration, so this can run
 * after TTS (when each scene's exact `audioDuration` is known) with zero wasted work.
 *
 * Each quarter is budgeted against ITS OWN runtime and drained independently, so a host-heavy
 * back half is trimmed hard while the same density is left alone up front. Below
 * `RAMP_MIN_SCENES` the film is one bucket at the flat `HOST_SCREEN_FRACTION`.
 *
 * DEMOTE-ONLY, by design: this can lower the host share in a quarter but never raise it, so
 * Q1/Q2 only reach 48/40% if the storyboard prompt (`buildUnifiedStoryboardPrompt`, which is
 * given the same per-quarter target) got Claude to write that much host. When it writes host
 * flat instead, the front quarters simply keep what they have and the film lands under 35%.
 *
 * Mutates `scenes` in place. The first and last scenes are bookends and are never demoted,
 * so on very short scripts the host share may stay above target. Interior host scenes are
 * demoted smallest-duration-first (converging toward the target rather than overshooting
 * low) until the quarter's host share is at/under its budget or it has no interior host scenes
 * left. Demotion swaps in a person-free cutaway via `hostBrollFallback` (the scene's
 * `brollVisual` when present, else a synthesized one), so it never depends on Claude having
 * written a fallback. Pure aside from the in-place mutation — unit-tested.
 */
export function rebalanceHostScreenTime(scenes: StoryboardScene[]): {
  total: number;
  before: number;
  after: number;
  demoted: number;
} {
  const dur = (s: StoryboardScene) => s.audioDuration ?? 0;
  const total = scenes.reduce((sum, s) => sum + dur(s), 0);
  const hostTime = (set: StoryboardScene[]) =>
    set.reduce((sum, s) => sum + (s.hostPresent ? dur(s) : 0), 0);
  const before = hostTime(scenes);

  const quarters = runtimeQuarters(scenes);
  if (total <= 0) {
    return { total, before, after: before, demoted: 0 };
  }

  // The open/close bookends and the locked cold open are never demoted — identified by GLOBAL
  // index, not position within a quarter, so Q1's first scene is protected but Q2's is not.
  const lastIndex = scenes.length - 1;
  const protectedScene = (s: StoryboardScene) =>
    s === scenes[0] || s === scenes[lastIndex] || !!s.hostOpener;

  let demoted = 0;
  quarters.forEach((quarter, q) => {
    const quarterSeconds = quarter.reduce((sum, s) => sum + dur(s), 0);
    // One bucket ⇒ the ramp was skipped (short film): fall back to the flat global fraction.
    const fraction =
      quarters.length === 1 ? HOST_SCREEN_FRACTION : HOST_RAMP[q];
    const budget = fraction * quarterSeconds;
    if (hostTime(quarter) <= budget) return;

    // Interior host scenes of THIS quarter, shortest first. CTA scenes are demotable like any
    // other host scene — the QR card rides on the `cta` flag regardless of register, so a CTA
    // beat can become b-roll without losing the call-to-action.
    const candidates = quarter
      .filter(s => s.hostPresent && !protectedScene(s))
      .sort((a, b) => dur(a) - dur(b));

    for (const scene of candidates) {
      if (hostTime(quarter) <= budget) break;
      // Always to the STILL lane (see `demoteHostToStill`): host slack is per-quarter against
      // HOST_RAMP, so it lands mostly in Q3/Q4 — dumping it on the clip lane would ramp the
      // expensive side UP across the film, the exact inverse of MOTION_RAMP.
      demoteHostToStill(scene);
      demoted++;
    }
  });

  return {
    total,
    before,
    after: hostTime(scenes),
    demoted,
  };
}

/**
 * Reorder `items` for even timeline coverage: visit the middle first, then the quarter
 * points, then the eighths, and so on (a breadth-first bisection). Greedily flipping scene
 * types in this order keeps the flipped set spread across the video instead of clustered at
 * one end. Preserves every item; deterministic.
 */
function spreadOrder<T>(items: T[]): T[] {
  if (items.length <= 2) return items.slice();
  const order: T[] = [];
  const seen = new Set<number>();
  const queue: [number, number][] = [[0, items.length - 1]];
  while (queue.length) {
    const [lo, hi] = queue.shift()!;
    if (lo > hi) continue;
    const mid = (lo + hi) >> 1;
    if (!seen.has(mid)) {
      seen.add(mid);
      order.push(items[mid]);
    }
    queue.push([lo, mid - 1]);
    queue.push([mid + 1, hi]);
  }
  return order;
}

/**
 * Bucket `scenes` into the four RUNTIME quarters the ramp tables (`HOST_RAMP`, `MOTION_RAMP`)
 * are indexed by. A scene belongs to the quarter its MIDPOINT falls in, so a long scene
 * straddling a boundary lands wherever most of it plays rather than being split or double-counted.
 *
 * Buckets are by seconds, not scene count, so they are unequal in length whenever scene durations
 * are — which is the point: every ramp target is a share of its bucket's runtime.
 *
 * Degrades to ONE bucket holding every scene when the film is shorter than `RAMP_MIN_SCENES` or
 * has no measured runtime; callers then read `HOST_RAMP`/`MOTION_RAMP` as the flat global fraction
 * instead and behave exactly as they did before the ramp. Pure — unit-tested.
 */
export function runtimeQuarters(
  scenes: StoryboardScene[]
): StoryboardScene[][] {
  const dur = (s: StoryboardScene) => s.audioDuration ?? 0;
  const total = scenes.reduce((sum, s) => sum + dur(s), 0);
  if (scenes.length < RAMP_MIN_SCENES || total <= 0) return [scenes.slice()];

  const buckets: StoryboardScene[][] = [[], [], [], []];
  let elapsed = 0;
  for (const s of scenes) {
    const mid = elapsed + dur(s) / 2;
    // Clamp: the final scene's midpoint can only reach total*(1 - half its share), but a
    // zero-length tail scene would compute exactly `total` and index past the last bucket.
    const q = Math.min(3, Math.floor((mid / total) * 4));
    buckets[q].push(s);
    elapsed += dur(s);
  }
  return buckets;
}

/**
 * Split the cutaway lane between MOTION video and STILL images, PER RUNTIME QUARTER along
 * `MOTION_RAMP` — 26% of Q1 falling to 6% of Q4, which means ~15% motion (and so
 * `STILL_IMAGE_FRACTION`, ≈50% stills) over the whole film. The storyboard prompt only nudges
 * Claude toward the mix; this guarantees it by runtime, not scene count, so a few long beats
 * can't skew the look.
 *
 * MOTION is the anchored side and stills are the derived remainder (`eligible − motion`),
 * because `rebalanceHostScreenTime` demotes only: when host lands under its target, that slack
 * has to go somewhere, and it must not go to the expensive, failure-prone grok lane. Stills —
 * cheap, fast, no motion hallucination — absorb every remainder instead.
 *
 * Eligible scenes are the non-host cutaways (the only ones where `stillImage` is meaningful).
 * Run AFTER `rebalanceHostScreenTime` so host scenes demoted to b-roll are included. The
 * model's own picks are respected first: scenes are flipped still⇄motion only while each flip
 * moves that quarter's still-seconds CLOSER to target, walking a spread order within the
 * quarter so changes aren't clustered. Below `RAMP_MIN_SCENES` the film is one bucket at the
 * flat `STILL_IMAGE_FRACTION`. Mutates `scenes` in place; pure otherwise — unit-tested.
 */
export function enforceStillMotionRatio(scenes: StoryboardScene[]): {
  eligible: number;
  stillSeconds: number;
  motionSeconds: number;
  total: number;
  /** Motion seconds in each runtime quarter (one entry when the ramp is skipped). */
  motionPerQuarter: number[];
} {
  const dur = (s: StoryboardScene) => s.audioDuration ?? 0;
  const isMotion = (s?: StoryboardScene) =>
    !!s && !s.hostPresent && !s.stillImage;
  const total = scenes.reduce((sum, s) => sum + dur(s), 0);
  const quarters = runtimeQuarters(scenes);
  const motionSecondsIn = (set: StoryboardScene[]) =>
    set.reduce((sum, s) => sum + (isMotion(s) ? dur(s) : 0), 0);

  // A motion beat next to another motion beat is exactly what `enforceVisualAdjacency` converts
  // straight back to a still — so allocating one wastes the budget we are trying to spend. Q1
  // runs 26% motion (up from a flat 15%), which makes that collision common enough to guard.
  const neighbourIsMotion = (s: StoryboardScene) => {
    const i = scenes.indexOf(s);
    return isMotion(scenes[i - 1]) || isMotion(scenes[i + 1]);
  };

  let stillSeconds = 0;
  let eligibleCount = 0;
  let eligibleSecondsTotal = 0;

  quarters.forEach((quarter, q) => {
    const eligible = quarter.filter(s => !s.hostPresent);
    const eligibleSeconds = eligible.reduce((sum, s) => sum + dur(s), 0);
    eligibleCount += eligible.length;
    eligibleSecondsTotal += eligibleSeconds;
    if (eligibleSeconds <= 0) return;

    const quarterSeconds = quarter.reduce((sum, s) => sum + dur(s), 0);
    // One bucket ⇒ the ramp was skipped (short film): fall back to the flat global fraction.
    // Otherwise stills are whatever this quarter's runtime is NOT spending on motion. Clamp to
    // the cutaway pool — stills can only come from eligible cutaways (e.g. a host-heavy quarter).
    const target =
      quarters.length === 1
        ? Math.min(STILL_IMAGE_FRACTION * total, eligibleSeconds)
        : Math.min(
            Math.max(0, eligibleSeconds - MOTION_RAMP[q] * quarterSeconds),
            eligibleSeconds
          );
    let acc = eligible.reduce((sum, s) => sum + (s.stillImage ? dur(s) : 0), 0);

    if (acc < target) {
      // Too few still seconds — promote spread-out motion beats to stills while it helps.
      for (const s of spreadOrder(eligible.filter(s => !s.stillImage))) {
        if (acc >= target) break;
        if (Math.abs(acc + dur(s) - target) < Math.abs(acc - target)) {
          s.stillImage = true;
          acc += dur(s);
        }
      }
    } else if (acc > target) {
      // Too many still seconds — demote spread-out stills to motion while it helps. Beats that
      // would land beside an existing motion beat are PREFERRED LAST, not banned (see
      // `neighbourIsMotion`): the second, unguarded pass only runs when the first left the
      // quarter short of target, so a cutaway pool with nowhere clean to put motion still
      // converges instead of silently undershooting.
      //
      // Only beats that can ACTUALLY move are demotable — MOTION_RAMP is a ceiling, not a quota,
      // and a quarter with no moving subjects is meant to undershoot it rather than manufacture
      // frozen clips (`parseStoryboard`'s invariant). The promote branch above stays unrestricted:
      // tightening toward stills is always safe.
      for (const guarded of [true, false]) {
        for (const s of spreadOrder(
          eligible.filter(
            s => s.stillImage && (s.humanPresent || s.objectMotion)
          )
        )) {
          if (acc <= target) break;
          if (guarded && neighbourIsMotion(s)) continue;
          if (Math.abs(acc - dur(s) - target) < Math.abs(acc - target)) {
            s.stillImage = false;
            acc -= dur(s);
          }
        }
      }
    }

    stillSeconds += acc;
  });

  return {
    eligible: eligibleCount,
    stillSeconds,
    motionSeconds: eligibleSecondsTotal - stillSeconds,
    total,
    motionPerQuarter: quarters.map(motionSecondsIn),
  };
}

/**
 * Split the host runtime between full-frame host (alone) and split-frame host (a generated
 * visual beside them via `splitVisual`), so the split lane lands at ≈7.5% of total. The
 * storyboard prompt nudges Claude; this converges the actual split by runtime in code.
 *
 * Run AFTER `rebalanceHostScreenTime` so it only sees the final host set. The open/close
 * bookends are never FORCED a split — the host stays clean and full-frame at the top/tail.
 * CTA host scenes ARE eligible (the QR overlay rides on the `cta` flag, not the split). A
 * forced split's right half is sourced from the scene's `brollVisual` fallback (or its own
 * `visualPrompt`). Scenes are flipped only while each flip moves the split-seconds total
 * closer to target, walking a spread order. Mutates `scenes` in place; pure otherwise —
 * unit-tested.
 */
export function enforceHostSplitMix(scenes: StoryboardScene[]): {
  hostSeconds: number;
  splitSeconds: number;
  aloneSeconds: number;
} {
  const dur = (s: StoryboardScene) => s.audioDuration ?? 0;
  const host = scenes.filter(s => s.hostPresent);
  const hostSeconds = host.reduce((sum, s) => sum + dur(s), 0);
  if (hostSeconds <= 0) {
    return { hostSeconds: 0, splitSeconds: 0, aloneSeconds: 0 };
  }

  const lastIndex = scenes.length - 1;
  // Scenes that may be FORCED to/from a split: interior host scenes (CTA included — the QR
  // overlay is independent of the split, so a CTA host beat can be split like any other).
  // The locked cold open is excluded — it is always clean full-frame host.
  const eligible = (s: StoryboardScene, i: number) =>
    s.hostPresent && i !== 0 && i !== lastIndex && !s.hostOpener;

  // Belt-and-braces: `eligible` only gates FORCED flips, so a split Claude authored on a cold-open
  // scene would otherwise survive (and be counted against the target). Clear it here too.
  for (const s of host) if (s.hostOpener) s.splitVisual = undefined;

  const target = HOST_SPLITVISUAL_FRACTION * hostSeconds;
  let acc = host.reduce((sum, s) => sum + (s.splitVisual ? dur(s) : 0), 0);

  if (acc < target) {
    // Too little split runtime — add a beside-visual to spread-out host scenes.
    const candidates = scenes.filter(
      (s, i) => eligible(s, i) && !s.splitVisual
    );
    for (const s of spreadOrder(candidates)) {
      if (acc >= target) break;
      if (Math.abs(acc + dur(s) - target) < Math.abs(acc - target)) {
        s.splitVisual = s.brollVisual ?? s.visualPrompt;
        acc += dur(s);
      }
    }
  } else if (acc > target) {
    // Too much split runtime — clear the beside-visual on spread-out host scenes.
    const candidates = scenes.filter(
      (s, i) => eligible(s, i) && !!s.splitVisual
    );
    for (const s of spreadOrder(candidates)) {
      if (acc <= target) break;
      if (Math.abs(acc - dur(s) - target) < Math.abs(acc - target)) {
        s.splitVisual = undefined;
        acc -= dur(s);
      }
    }
  }

  return { hostSeconds, splitSeconds: acc, aloneSeconds: hostSeconds - acc };
}

/**
 * Keep "heavy" visual registers from piling up: host scenes never sit back-to-back EXCEPT the
 * locked two-angle cold open (scene 1 + scene 2, both `hostOpener`); every later host scene is
 * capped at a run of 1. Two MOTION-video b-roll scenes are never back-to-back either. A STILL
 * cutaway is the intended breather and may sit beside anything, so we break an over-cap run by
 * converting a scene TO a still.
 *
 * Run LAST, AFTER the ratio passes (`rebalanceHostScreenTime`, `enforceHostSplitMix`,
 * `enforceStillMotionRatio`) — those run after storyboard assembly and can re-introduce a
 * same-register pair (a host→b-roll demotion, a still→motion flip), so adjacency must be the
 * final flag-mutating pass. Converting to stills nudges the still share above its target,
 * which is acceptable (more stills read calmer and cost less).
 *
 * Register: `host` (hostPresent), `still` (!hostPresent && stillImage), `motion` (otherwise).
 *
 * - MOTION pair → flip the later scene `stillImage = true` (same mutation
 *   `enforceStillMotionRatio` already makes; no content change).
 * - HOST run over the cap → convert the overflowing host scene to a still cutaway
 *   (`demoteHostToStill` synthesizes a person-free frame from the scene when it has no pre-written
 *   `brollVisual`, so the still is always available). The target is the overflowing scene UNLESS it
 *   is the protected closer (the video must open AND close on host), in which case the earlier
 *   neighbor is converted; the opener is never a target. CTA scenes are NOT protected: a demoted
 *   CTA scene keeps `cta:true` so its QR card still rides on the still. Only when both candidates
 *   are bookends is the run left in place and logged.
 *
 * A single forward pass suffices: every conversion produces a `still`, which conflicts with
 * neither `host` nor `motion`, so a fix can never create a new forbidden pair downstream.
 * Mutates `scenes` in place; pure otherwise — unit-tested.
 */
export function enforceVisualAdjacency(
  scenes: StoryboardScene[],
  opts?: { hasAltHost?: boolean; allowAdjacentMotion?: boolean }
): {
  hostBroken: number;
  motionBroken: number;
  /** Host runtime rendered from the alt host photo (`assignHostShots`); 0 without one. */
  altSeconds: number;
} {
  const hasAltHost = opts?.hasAltHost ?? false;
  const lastIndex = scenes.length - 1;
  const isHost = (s: StoryboardScene) => s.hostPresent === true;
  const isMotion = (s: StoryboardScene) => !s.hostPresent && !s.stillImage;
  // The video opens AND closes on host, so the locked cold open (`hostOpener` — index 0, plus
  // index 1 with an alt photo) and the closing bookend (lastIndex) are never demotion targets.
  // CTA scenes are NOT protected — a demoted CTA scene keeps `cta:true`, so its QR card still
  // rides along on the still cutaway.
  const canDemote = (i: number) =>
    i !== 0 && i !== lastIndex && !scenes[i].hostOpener;

  let hostBroken = 0;
  let motionBroken = 0;
  // Consecutive KEPT-host scenes ending at the previous index.
  let hostRun = isHost(scenes[0]) ? 1 : 0;

  for (let i = 1; i <= lastIndex; i++) {
    const prev = scenes[i - 1];
    const cur = scenes[i];

    if (isMotion(prev) && isMotion(cur)) {
      if (opts?.allowAdjacentMotion) {
        hostRun = 0;
        continue;
      }
      cur.stillImage = true;
      motionBroken++;
      hostRun = 0;
      continue;
    }

    if (!isHost(cur)) {
      hostRun = 0;
      continue;
    }

    // cur is host — extend the run, or start fresh if prev wasn't host.
    hostRun = isHost(prev) ? hostRun + 1 : 1;
    // A host scene may sit beside another host scene ONLY inside the locked cold open (scene 1 +
    // scene 2, both `hostOpener` — the one two-angle opening). Everywhere else the cap is 1: no
    // two host scenes adjacent, even with a second photo.
    const cap = prev.hostOpener && cur.hostOpener ? MAX_ADJACENT_HOST : 1;
    if (hostRun <= cap) continue;

    // Over the cap → break the run by converting a host scene to a still (a still may sit beside
    // anything). Prefer the overflowing scene; if it is the protected closer, convert the earlier
    // neighbor instead. `demoteHostToStill` synthesizes a person-free cutaway when the scene has no
    // pre-written `brollVisual`, so a run is always breakable unless both candidates are bookends.
    if (canDemote(i)) {
      demoteHostToStill(cur);
      hostBroken++;
      hostRun = 0;
    } else if (canDemote(i - 1)) {
      demoteHostToStill(prev);
      hostBroken++;
      hostRun = 1;
    }
    // else: both candidates are bookends — leave the run, logged by the caller.
  }

  // Assign the host camera angle last, once the runs are final.
  const shots = assignHostShots(scenes, hasAltHost);

  return { hostBroken, motionBroken, altSeconds: shots.altSeconds };
}

/**
 * Max consecutive on-camera host scenes, allowed ONLY at the locked two-angle cold open (scene 1 +
 * scene 2, both `hostOpener`): the pair reads as an angle change rather than a jump-cut. Every later
 * host scene is capped at a run of 1 — no two host scenes adjacent. Enforced in
 * `enforceVisualAdjacency`.
 */
export const MAX_ADJACENT_HOST = 2;

/**
 * Assign each host scene its camera angle by RUNTIME: 0 = primary photo (`faceImageUrl`),
 * 1 = alt angle (`faceImageUrl2`). The alt camera targets `HOST_ALT_CAMERA_FRACTION` of host
 * runtime (10% of total), leaving the main camera at ~17.5% and split-screen at ~7.5%.
 *
 * Three angles are MANDATORY and assigned first (they can push alt above target, which is fine):
 * the locked cold open (`hostOpener`) is pinned by ordinal — main then alt; an adjacent host PAIR
 * always reads main → alt (that angle change is the only reason a pair is allowed); and a
 * split-screen scene always renders from the PRIMARY photo. Every remaining host scene starts on
 * the main camera and is promoted to alt in `spreadOrder` only while the promotion moves the alt
 * seconds CLOSER to target — the same converge shape as `enforceHostSplitMix`.
 *
 * Without a second host photo this is a no-op (all host scenes stay on the primary, so the
 * alt budget falls to the main camera). Mutates in place; pure otherwise — unit-tested.
 */
export function assignHostShots(
  scenes: StoryboardScene[],
  hasAltHost: boolean
): { hostSeconds: number; altSeconds: number } {
  const dur = (s: StoryboardScene) => s.audioDuration ?? 0;
  const hostSeconds = scenes.reduce(
    (sum, s) => sum + (s.hostPresent ? dur(s) : 0),
    0
  );
  if (!hasAltHost) return { hostSeconds, altSeconds: 0 };

  // Pass 1 — mandatory angles. Everything else lands on the main camera and becomes a
  // candidate for the alt budget below.
  const free: StoryboardScene[] = [];
  let openerOrdinal = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.hostPresent) continue;
    // The locked cold open is pinned by ORDINAL, not by the pair rule below: that rule reads
    // scenes[i+1] and would flip shot 2 back to the main photo if scene 3 also happened to be
    // host, collapsing the two-angle opener into two identical shots.
    if (s.hostOpener) {
      s.hostShot = openerOrdinal === 0 ? 0 : 1;
      openerOrdinal++;
      continue;
    }
    // A split-frame scene always renders from the PRIMARY photo — the split IS the visual
    // change, so a pair containing one needs no angle change either.
    if (s.splitVisual) {
      s.hostShot = 0;
      continue;
    }
    const prev = scenes[i - 1];
    if (prev?.hostPresent && !prev.splitVisual) {
      s.hostShot = prev.hostShot === 0 ? 1 : 0; // never repeat the neighbor's angle
      continue;
    }
    if (scenes[i + 1]?.hostPresent && !scenes[i + 1].splitVisual) {
      s.hostShot = 0; // a pair opens on the main photo (so it reads main → alt)
      continue;
    }
    s.hostShot = 0;
    free.push(s);
  }

  // Pass 2 — converge the alt-camera runtime toward its share of the host budget.
  const target = HOST_ALT_CAMERA_FRACTION * hostSeconds;
  let acc = scenes.reduce(
    (sum, s) => sum + (s.hostPresent && s.hostShot === 1 ? dur(s) : 0),
    0
  );
  for (const s of spreadOrder(free)) {
    if (acc >= target) break;
    if (Math.abs(acc + dur(s) - target) < Math.abs(acc - target)) {
      s.hostShot = 1;
      acc += dur(s);
    }
  }

  return { hostSeconds, altSeconds: acc };
}

/**
 * A person-free cutaway prompt to demote a host scene onto. Prefers Claude's own `brollVisual`
 * safety net (byte-identical to before when present); otherwise synthesizes an on-topic, explicitly
 * person-free frame from the scene's verbatim `scriptText` so demotion NEVER needs a pre-written
 * `brollVisual` and never carries the talking-head prompt into a cutaway. `enhanceBrollPrompts`
 * (which runs after every demotion) rewrites the seed against the narration, so a terse seed is fine.
 */
export function hostBrollFallback(s: StoryboardScene): string {
  const own = s.brollVisual?.trim();
  if (own) return own;
  const beat = (s.scriptText ?? s.narration ?? "").trim();
  return beat
    ? `${beat} — a calm, photoreal cutaway of that subject, no people in the frame`
    : GENERIC_SAFE_VISUAL;
}

/**
 * Convert a host (or motion) scene into a still cutaway — a person-free frame with a gentle Ken
 * Burns move added in code, sourced from `hostBrollFallback` (its `brollVisual` when present, else a
 * synthesized person-free prompt). Shared by `enforceVisualAdjacency` and `ensureHostInCta` so
 * "demote to a still" is the same mutation everywhere. Mutates in place.
 */
function demoteHostToStill(s: StoryboardScene): void {
  const seed = hostBrollFallback(s);
  s.hostPresent = false;
  s.stillImage = true;
  s.visualPrompt = seed;
  s.splitVisual = undefined;
  if (!s.shotAngle) s.shotAngle = "wide";
}

/**
 * Demote every host scene to a person-free b-roll cutaway and re-gate any flagless motion clips
 * to the still lane. Returns how many host scenes were converted. Mutates in place.
 */
export function demoteAllHostsToBroll(scenes: StoryboardScene[]): number {
  let demoted = 0;
  for (const s of scenes) {
    if (!s.hostPresent) continue;
    demoteHostToStill(s);
    s.hostOpener = undefined;
    s.hostShot = undefined;
    s.lipsynced = false;
    s.humanPresent = false;
    demoted++;
  }
  for (const s of scenes) {
    if (!s.hostPresent && !s.stillImage && !s.humanPresent && !s.objectMotion) {
      s.stillImage = true;
      if (!s.shotAngle) s.shotAngle = "wide";
    }
  }
  return demoted;
}

/**
 * Force every non-host cutaway onto the video clip lane (`stillImage: false`). Sets
 * `objectMotion: true` on beats that are not already `humanPresent`. Used by `brollMotionOnly`
 * test runs so every scene exercises the grok/APIMART video path. Mutates in place.
 */
export function forceAllBrollMotion(scenes: StoryboardScene[]): number {
  let forced = 0;
  for (const s of scenes) {
    if (s.hostPresent) continue;
    const wasMotion = !s.stillImage && (s.humanPresent || s.objectMotion);
    s.stillImage = false;
    if (!s.humanPresent) s.objectMotion = true;
    if (!wasMotion) forced++;
  }
  return forced;
}

const VIDEO_SUBJECT_SYSTEM =
  "You read a video script and name its single overall subject in 3–8 words " +
  "(the noun phrase a viewer would use as the video's topic). Reply with ONLY that " +
  "phrase — no quotes, no punctuation, no explanation.";

const CLICKBAIT_LEAD =
  /^\s*(?:stop|wait|warning|attention|urgent|breaking|never|don'?t|do not|please|watch)\b[\s,:.—-]*/i;
const CLICKBAIT_TAIL =
  /[\s,—-]*\b(?:right now|today|immediately|before it'?s too late|or (?:you'?ll )?regret it|and thank me later)\s*$/i;

/**
 * Reduce an operator title to the 3–8 word noun phrase `VIDEO_SUBJECT_SYSTEM` asks an LLM for.
 * The subject is interpolated VERBATIM into `amateurSettingClause` on every b-roll prompt, so a
 * clickbait imperative ("STOP! … Right Now or Regret It!") reads to the image model as a directive
 * — job 200 staged a white hydrogen-peroxide bottle into bottle-free lawn shots because of it.
 * Pure — exported for unit testing.
 *
 * ponytail: fixed word lists, no LLM. Deterministic so a regenerate recomputes the SAME subject
 * the original render used, and so an old job's clickbait subject is repaired for free on regen.
 * Widen the lists when a real title slips through.
 */
export function normalizeVideoSubject(title: string): string {
  let s = (title ?? "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  // A leading shouted fragment ("STOP! ", "You won't believe this! ") — up to 3 words then bang.
  s = s.replace(/^\s*(?:\S+\s+){0,2}\S*[!?]+\s+/, "");
  for (let i = 0; i < 3; i++)
    s = s
      .replace(/[\s!?.]+$/, "")
      .replace(CLICKBAIT_LEAD, "")
      .replace(CLICKBAIT_TAIL, "");
  s = s
    .replace(/[!?]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:—-]+|[\s,.;:—-]+$/g, "")
    .trim();
  return truncateWords(s, 8) || (title ?? "").trim();
}

/**
 * The one short "what the whole video is about" line threaded into the storyboard, enhancer, and
 * safety prompts so a per-scene visual resolves an ambiguous narration noun ("the meat" → the
 * video's animal) to the RIGHT subject. Prefer the user title (normalized); else one cheap Claude
 * call over the script head. Never throws — returns "" on any failure so callers simply omit the
 * subject hint.
 */
export async function deriveVideoSubject(
  params: LongformInputParams,
  spokenScript: string
): Promise<string> {
  const fromTitle = normalizeVideoSubject(params.title ?? "");
  if (fromTitle) return fromTitle;
  try {
    const r = await invokeGemini({
      systemPrompt: VIDEO_SUBJECT_SYSTEM,
      // 6000 chars ≈ intro + first body section — a cold-open story can eat 1500 chars
      // before the topic is ever stated.
      userMessage: `Script:\n"""${spokenScript.slice(0, 6000)}"""\n\nSubject:`,
      maxTokens: 32,
    });
    return r.text.trim().replace(/^["']+|["']+$/g, "");
  } catch {
    return "";
  }
}

/**
 * Resolve the video subject for a regenerate, mutating params in place. The operator-supplied
 * title is an explicit statement of the subject, so it WINS over any earlier LLM-guessed
 * videoSubject; only untitled jobs fall back to the persisted/script-derived subject. Titled
 * jobs resolve synchronously (no LLM call). Returns the resolved subject ("" if none).
 */
export async function ensureVideoSubject(
  params: LongformInputParams
): Promise<string> {
  const fromTitle = normalizeVideoSubject(params.title ?? "");
  if (fromTitle) return (params.videoSubject = fromTitle);
  if (!params.videoSubject)
    params.videoSubject = await deriveVideoSubject(
      params,
      parseCtaMarkers(extractSpokenScript(params.script)).script
    );
  return params.videoSubject ?? "";
}

/**
 * Build the storyboard system + user prompts for the unified talking-head + b-roll
 * format. The script is pre-split into numbered sentence `units`; Claude GROUPS
 * consecutive units into scenes (choosing the cuts) and returns an integer-range
 * partition — never verbatim prose. Each scene then voices exactly its own units, so
 * its visuals are locked to the audio under it. Pure — unit-tested.
 */
export function buildUnifiedStoryboardPrompt(opts: {
  /** Pre-computed, sentence-sized verbatim chunks (`segmentScriptByDuration`). Boundaries are fixed. */
  chunks: OffsetSpan[];
  /** The spoken script the chunk offsets index into. */
  spokenScript: string;
  faceAvailable: boolean;
  /** A channel book cover is configured — enables the `showsBook` reference-image field. */
  coverAvailable?: boolean;
  /** Authoritative directing block (host look, b-roll, tone, framing). Never voiced. */
  instruction?: string;
  /** The whole-video subject; disambiguates ambiguous narration nouns. Absent → no subject hint. */
  subject?: string;
  /** The one shared physical world (`deriveStyleBible`), so every scene seeds in it. Absent → none. */
  styleBible?: string;
  /**
   * Leading chunks of THIS batch that form the locked host cold open (`parseStoryboard`) — 0 for a
   * non-first batch, whose chunks are all interior to the merged video.
   */
  openerHostScenes?: number;
  /**
   * Target register mix for THIS batch's stretch of the film — its runtime quarter on the ramp
   * (`HOST_RAMP` / `MOTION_RAMP`). Shares of the batch's own runtime, summing to 1. Absent ⇒ the
   * flat whole-video means. This is a NUDGE: the balancer passes are the guarantee, but they only
   * demote host, so an early batch gets its extra host from here or not at all.
   */
  mixTarget?: { host: number; video: number; still: number };
  /**
   * Hero-subject digest of b-roll shots ALREADY chosen by earlier (sequential) batches, so this
   * batch can enforce the whole-video B-ROLL VARIETY rule instead of only its own 25 chunks.
   * Absent/empty → block omitted; batch 0 and single-batch videos are byte-identical to before.
   */
  priorShots?: string[];
  /** 1-based global chunk number of this batch's first chunk (with `totalChunks`, situates the batch). */
  batchStartIndex?: number;
  /** Total chunk count across the whole video. */
  totalChunks?: number;
}): { systemPrompt: string; userMessage: string } {
  const { chunks, spokenScript, faceAvailable } = opts;
  const instruction = opts.instruction ?? DEFAULT_LONGFORM_INSTRUCTION;
  const subject = opts.subject?.trim();
  const styleBible = opts.styleBible?.trim();
  const K = chunks.length;

  // ponytail: b-roll never depicts the book anymore — no `showsBook` guidance is emitted, so
  // Claude is not told to place a book in any scene. The end-of-video cover reveal is handled
  // separately (literal still, no generation). `coverAvailable` is left threaded but unused.
  const bookTail = "";

  // Identity-lock guidance; carries the "reference photo" / "No host photo" tokens.
  const faceTail = faceAvailable
    ? ` A reference photo of the host is available, so host shots will lock to ` +
      `that exact person — keep the host's described look consistent across all ` +
      `host scenes.`
    : ` No host photo was provided; you may still use hostPresent for shots where ` +
      `a person speaks to camera.`;

  // Host scenes never sit adjacent EXCEPT the fixed two-angle cold open (scenes 1 & 2), which the
  // COLD OPEN rule states separately. `enforceVisualAdjacency` caps the run either way — this only
  // stops the model generating mid-film host pairs it would then have to demote.
  const hostRunRule = `never place two host scenes next to each other`;

  // The cold open is FIXED in code (`parseStoryboard` forces + flags it). Telling the model keeps
  // it from writing a cutaway we would only overwrite, and from following the opener with one more
  // host scene — a run the adjacency pass would then have to break. Empty on a non-first batch,
  // whose chunk 1 is interior to the merged video.
  // The register mix this batch is aimed at — its quarter of the ramp, or the flat whole-video
  // means when no target was threaded through. `scope` swaps "the whole video" for "this stretch"
  // so a batch is never told its own quarter's mix is the film's overall average.
  const mix = opts.mixTarget ?? {
    host: HOST_SCREEN_FRACTION,
    video: 1 - HOST_SCREEN_FRACTION - STILL_IMAGE_FRACTION,
    still: STILL_IMAGE_FRACTION,
  };
  const pct = (n: number) => Math.round(n * 100);
  const scope = opts.mixTarget
    ? "this stretch of the video"
    : "the whole video";
  const openers = opts.openerHostScenes ?? 0;
  const coldOpenRule =
    openers <= 0
      ? ""
      : openers >= 2
        ? `- COLD OPEN (fixed): chunks 1 AND 2 are BOTH host shots — one continuous two-angle ` +
          `opening on the same seated host. Write a talking-head visual for each ` +
          `("hostPresent":true, no "splitVisual"). Chunk 3 must NOT be a host shot.\n`
        : `- COLD OPEN (fixed): chunk 1 is a host shot ("hostPresent":true, no "splitVisual"). ` +
          `Chunk 2 must NOT be a host shot.\n`;

  const systemPrompt =
    `You are a director of long-form talking-head-with-b-roll YouTube videos for an ` +
    `older (50–70) audience. Two visual registers: the ` +
    `SEATED HOST talking-head is real and unpolished — medium-quality consumer-camera ` +
    `footage, natural indoor light. The B-ROLL cutaways are whatever the script's beat ` +
    `is literally about — describe ONLY that subject and its action; the camera/quality ` +
    `look is added automatically in code, so do NOT write any camera, lighting, lens, or ` +
    `quality wording into a b-roll visualPrompt. Both registers stay photoreal: never ` +
    `"AI", no on-screen captions, text overlays, logos, motion graphics, or CGI.\n\n` +
    `The video is a SEATED host talking directly to camera in one fixed indoor room, ` +
    `INTERSPERSED with relevant b-roll cutaways (the beat's subject, product, or ` +
    `before/after result — whatever the beat is literally about) that match what is ` +
    `being discussed at that point. Cut away ` +
    `to b-roll on concrete/demonstrable beats, then return to the host.\n\n` +
    `The narration is the verbatim script, voiced separately. The script below is ` +
    `already SEGMENTED for you into ${K} numbered CHUNKS (1..${K}) — each chunk is one ` +
    `scene's exact narration: one full sentence (or a few short sentences merged), ` +
    `typically ~${SCENE_MIN_SEC}–${LONG_SCENE_MAX_SEC} seconds on screen. You ` +
    `do NOT choose the cuts: your job is to ASSIGN ONE VISUAL to each chunk. Return STRICT ` +
    `JSON ONLY (no markdown, no prose) of the form:\n` +
    `{"scenes":[{"index":1,"visualPrompt":"...","cameraCue":"...","hostPresent":true,"brollVisual":"...","splitVisual":"...","stillImage":false,"humanPresent":false,"objectMotion":false,"shotAngle":"mid","cta":false}]}\n\n` +
    `Rules:\n` +
    `- Return EXACTLY ONE entry per chunk: one object for every "index" 1..${K}, each ` +
    `referencing its chunk by that 1-based "index". Do NOT split, merge, reorder, skip, or ` +
    `invent chunks — the boundaries are fixed; you only describe what each chunk LOOKS like. ` +
    `An omitted chunk defaults to a plain host shot, so cover them all.\n` +
    coldOpenRule +
    `- Decide each chunk's register from the narration it covers (and how it flows from the ` +
    `chunks around it): cut away to b-roll on concrete/demonstrable beats, return to the ` +
    `host at pivots. The chunk's narration length is fixed — this is NOT a limit on how long ` +
    `the "visualPrompt" itself may be.\n` +
    `- "hostPresent" = true for a shot of the seated host talking to camera; false for ` +
    `a b-roll cutaway (the beat's subject/product/result — whatever the beat is about) ` +
    `with NO person on screen.\n` +
    `- HOST BUDGET: the seated talking-head host is a FREQUENT presence. Across ` +
    `${scope}, host (hostPresent=true) scenes should total ABOUT ${pct(mix.host)}% of the ` +
    `spoken script — cutaways (b-roll) make up the other ~${pct(1 - mix.host)}%. ALWAYS close (the ` +
    `last scene) on a host shot (the opening is fixed by COLD OPEN above), then return to the ` +
    `host regularly at pivots, interleaved with b-roll cutaways. Each host appearance is a ` +
    `SUBSTANTIVE beat — roughly a full sentence or two, about 3–8 seconds spoken — NEVER a ` +
    `1–2 second fragment; if a host line would be that short, fold it into the adjacent host ` +
    `sentence or make the beat b-roll instead. About ONE IN FIVE host beats is a split-frame ` +
    `(host + a visual beside them — see SPLIT-SCREEN below); the rest are full-frame ` +
    `host alone.\n` +
    `- NO BACK-TO-BACK SAME REGISTER: ${hostRunRule}, and ` +
    `never place two MOTION-video b-roll scenes ("stillImage":false) next to each other. ` +
    `Separate same-register beats with a STILL cutaway ("stillImage":true) in between — a ` +
    `still may sit beside anything. This applies to CTA pitches too — do NOT bunch host ` +
    `shots during a CTA.\n` +
    `- CALL-TO-ACTION: a CTA scene is one that is part of the book/product SALES PITCH — the host ` +
    `is pitching the book/product, naming its website/URL, or telling the viewer to scan the code ` +
    `/ tap the link in the description (that pitch runs up through "Now go ahead and grab your ` +
    `phone … I'll wait right here"). Set "cta":true on those pitch scenes. A scene is NOT a CTA ` +
    `merely because it says a dollar amount: instructional money references in the body — "a ` +
    `five-dollar word", "compost runs about six dollars", "sharpen the blade for a few dollars", ` +
    `"the two-dollar pantry powder" — are NORMAL content, keep "cta":false. (A price stated INSIDE ` +
    `the pitch, like the book's own price, is part of that pitch and stays cta.) CTA pitch scenes ` +
    `follow the SAME host/still/motion alternation as the rest of the video — pick whatever ` +
    `register fits each beat, do NOT force the host on, and do NOT place CTA host shots ` +
    `back-to-back. When a CTA scene IS a host shot, keep the host's hands EMPTY — do NOT describe ` +
    `him holding, showing, or holding up any product, book, or object; he simply talks to camera. ` +
    `When a CTA scene is a CUTAWAY (and the "brollVisual" you write on any CTA host scene), make ` +
    `the visual a GENERIC, on-topic cutaway tied to the video's broader subject — ` +
    `NEVER a literal depiction of the pitch: no phone, QR code, screen, TV, scanning, book, ` +
    `packaging, website, or "link in the description". A script may contain more than one CTA ` +
    `block (e.g. a mid-roll and a closing pitch); mark each one. Non-CTA scenes keep "cta":false.\n` +
    `- BROLL FALLBACK on host scenes: every host scene MUST also include a "brollVisual" ` +
    `string — a self-contained, non-host b-roll cutaway derived from the SAME script ` +
    `units the host scene covers (follow the NON-HOST B-ROLL rules below). It is a ` +
    `safety net used only if the host budget forces this scene to become b-roll; write it ` +
    `as carefully as a real cutaway.\n` +
    `- CUTAWAY LANE — STILLS BY DEFAULT, VIDEO ONLY WHERE SOMETHING MOVES: a non-host cutaway ` +
    `is either a STILL image with a gentle camera move (set "stillImage":true) or a ` +
    `VIDEO clip ("stillImage":false). THE RULE IS ABSOLUTE: a cutaway may be ` +
    `"stillImage":false ONLY if it also sets "objectMotion":true or "humanPresent":true. ` +
    `A beat with neither — a finished result, a landscape, a laid-out arrangement, a tool on a ` +
    `bench, anything that just sits there — is ALWAYS "stillImage":true. A video clip of nothing ` +
    `moving looks worse than the still and costs far more, so there is no reason to ask for one. ` +
    `Across ${scope.toUpperCase()} video clips are capped at about ${pct(mix.video)}% of runtime ` +
    `(the rest is ~${pct(mix.still)}% stills and ~${pct(mix.host)}% host) — that is a CEILING, not ` +
    `a quota to fill: most videos land well under it, and you must never set "objectMotion" on a ` +
    `beat that does not genuinely move just to reach it. UNLESS you set "objectMotion":true (see ` +
    `OBJECT MOTION below), the "visualPrompt" describes a single calm, composed, photoreal FRAME — ` +
    `the subject as it sits in the shot, NOT a motion. The still's gentle pan/zoom is added ` +
    `in code, so you never write movement. "stillImage" only applies to ` +
    `non-host cutaways (NOT host shots). NO PERSON EVER APPEARS IN A CUTAWAY — no face, ` +
    `head, or body, whole or partial. A cutaway MAY show a pair of bare hands at the task ` +
    `("humanPresent":true — hands and forearms ONLY, framed so nothing above them is in ` +
    `shot) roughly once every 3–4 scenes, on beats about a manual action. Keep the rest ` +
    `free of any human part.\n` +
    `- OBJECT MOTION (cutaways only): set "objectMotion":true on a cutaway whose subject MOVES ` +
    `BY ITSELF while the shot runs — running or falling water, flames on kindling, liquid ` +
    `pouring from a spout, a rolling boil, foliage moving in wind. On those scenes ONLY, write ` +
    `the visualPrompt as the motion IN PROGRESS, connected to its source (water streaming from ` +
    `the spout onto the bed, flames working along the kindling) instead of the settled frame. ` +
    `Leave "objectMotion":false ` +
    `everywhere else — on any beat whose subject just sits there, on host scenes, and whenever ` +
    `the movement would come from a person rather than the thing itself (that is ` +
    `"humanPresent"). Most cutaways are false.\n` +
    `- CAMERA CUE (host split-screen ONLY): emit a short "cameraCue" phrase ONLY on a host ` +
    `scene that carries a "splitVisual" — there it styles the lighting/color mood of the ` +
    `right-half panel (one short clause, e.g. "soft overcast light" or "warm low evening ` +
    `light"). Do NOT emit "cameraCue" on b-roll or still cutaways — those ` +
    `prompts are subject-only and the look is added in code. Omit it on full-frame ` +
    `talking-host scenes.\n` +
    `- VISUAL PROMPT RICHNESS: every "visualPrompt" is a concrete, filmable description of a ` +
    `single ~4s shot in 16:9 horizontal landscape framing. There is NO length limit (up to ` +
    `~15000 characters), so be generous and specific; longer prompts produce better footage. ` +
    `NEVER compress into a terse one-liner. HOST scenes cover subject, action, setting, ` +
    `framing, lighting, lens, texture, and color. NON-HOST b-roll cutaways cover ONLY the ` +
    `specific subject, its action or state, the setting, and material/texture/detail — NO ` +
    `camera, lens, shot-type, lighting-quality, or production wording (those are added in ` +
    `code via shotAngle and the amateur look).\n` +
    `- HOST scenes: the SAME seated man, talking calmly to camera, sitting still and ` +
    `composed — no hand gestures or body movement, only natural speaking and subtle ` +
    `facial expression — static ` +
    `medium shot from the chest up. Do NOT invent a room/background for host scenes — a ` +
    `fixed indoor background is supplied separately and added in code; describe only the ` +
    `man and his seated talking performance.\n` +
    `- SPLIT-SCREEN host shots (use on roughly ONE IN FIVE host scenes — ` +
    `at product-demo or ` +
    `before/after beats): add a "splitVisual" string to the scene JSON. The host always ` +
    `appears on the LEFT half; "splitVisual" describes the RIGHT half — a specific product ` +
    `(e.g. "plain unbranded bottle pouring over the work surface, liquid darkening the spot"), ` +
    `the beat's subject, or a before/after result. The RIGHT half is OBJECT / PRODUCT / SETTING ` +
    `ONLY — no people, no hands, no body parts (the host already carries the person on the LEFT). ` +
    `Leave "splitVisual" absent ` +
    `on most host shots.\n` +
    `- NON-HOST B-ROLL (the large majority of cutaways): the visualPrompt MUST be ` +
    `derived from the SPECIFIC subject in the script units it covers. Read those units and ` +
    `identify the KEY NOUN, PRODUCT, ACTION, or RESULT being narrated, then OPEN the ` +
    `visualPrompt with that exact subject/action ITSELF as the hero — do NOT prepend a ` +
    `shot-type label ("close-up of", "tight shot of", "wide ground-level shot of", "a ` +
    `shot of"); start with the thing. Let the kind of subject drive what you describe: a ` +
    `named PRODUCT → the generic unbranded container in focus or being applied; an ACTION ` +
    `verb (pour, spray, mix, scrape) → the substance at its target as a composed frame (liquid ` +
    `pooled and darkening on the surface, loose matter freshly settled, a stirred mixture), with ` +
    `the actor staying in place — show the substance or result, not large arm or ` +
    `body action; a ` +
    `RESULT (a cleared surface, a finished fix, a completed step) → that result; a general ` +
    `CONDITION/state → the subject or setting the beat describes — choose the shotAngle that ` +
    `makes the state most vivid rather than always ` +
    `defaulting to ground level. NEVER fall back to a vague generic view when the ` +
    `beat is about something specific: a wide establishing view fits only a literal general ` +
    `scene-setting beat; if a beat has no concrete subject, show the closest specific thing ` +
    `the surrounding units reference. Do NOT reuse the same opening construction across ` +
    `scenes — vary which element leads and the implied framing through the wording, not a ` +
    `fixed prefix. ` +
    `When a beat genuinely needs a human action on screen — hands applying a treatment, ` +
    `holding a tool, or working at a task — set "humanPresent":true on that cutaway ` +
    `(still OR motion) and describe ONLY the hands: bare, ordinary, unadorned adult hands ` +
    `and at most the forearms, framed tight at the work so that NO face, head, hair, ` +
    `shoulders, torso, or legs are anywhere in shot. NEVER describe a person, figure, ` +
    `someone, a man, a woman, a gardener, a homeowner, or anyone standing, walking, ` +
    `crouching, watching, or inspecting — a cutaway never shows a human being, only their ` +
    `hands. Reserve "humanPresent" for beats where hands genuinely add something; keep most ` +
    `cutaways free of any human part, with the named subject/product/result the hero.\n` +
    `- CLASSIFIER-SAFE VISUALS: the image/video model rejects restricted content, so keep ` +
    `every visualPrompt clean. NEVER name a real person, celebrity, or brand. NEVER depict ` +
    `children, teens, minors, schools, or any age-ambiguous youth — every person is an ` +
    `anonymous adult roughly 50–70. Frame any pest or cleanup task as gentle, ordinary care: ` +
    `describe results and care (treated, cleared, wiped away, tidied), not violence — avoid ` +
    `"kill", "poison", "exterminate", "dead", "infestation", and similar harsh wording.\n` +
    `- B-ROLL VARIETY: across the whole video, no two b-roll shots should repeat the same ` +
    `subject AND framing. Vary the hero element (product, action, result, condition) and vary ` +
    `the SHOT ANGLE. For every non-host b-roll scene (including stillImage scenes) you MUST ` +
    `set a "shotAngle" field — one of exactly these five values:\n` +
    `  "mid" — waist-height: hands applying something, product bottle held up, container being poured\n` +
    `  "wide" — full-scene: the whole setting, a before/after view, the space the beat is about\n` +
    `  "overhead" — looking straight down from just above: a laid-out arrangement, a treated area, items in a tray\n` +
    `  "low" — near ground looking across: the base of the subject, a low surface line, the ground plane\n` +
    `  "pov" — first-person handheld POV: camera at the doer's chest looking down at the product and work surface as if the viewer is doing it — a bottle held over the target, weathered bare hands at work with no face or body in shot. Use on roughly 1 in 3 application beats (pour, spray, spread, mix, wipe, place).\n` +
    `DISTRIBUTION RULE: no more than 2 consecutive b-roll scenes may share the same shotAngle ` +
    `value. Spread all 5 angles across the video. ` +
    `Match the angle to the subject: product container → "mid"; whole-scene result → "wide"; ` +
    `fine detail or texture → "mid"; a laid-out pattern → "overhead"; ` +
    `a base or ground-level detail → "low"; application from the doer's perspective → "pov". ` +
    `When several consecutive beats cover the same product, advance the STAGE ` +
    `(bottle → pouring it → the finished result). ` +
    `ILLUSTRATIVE VARIETY ON FLAT/REPEATED BEATS: when a beat names a SPECIFIC ` +
    `product, action, or result, keep it literal and show that exact subject. But when ` +
    `the script is generic or keeps circling the SAME broad subject across consecutive ` +
    `beats (e.g. a repeated "the surface", "the material", "the problem"), do NOT re-render that ` +
    `identical literal noun more than about twice — instead rotate to a DIFFERENT but ` +
    `related CONCRETE visual drawn from the same topic: bare hands working on it ` +
    `(no face or body in shot), the tool involved (whatever implement ` +
    `the task uses), the cause (what created the condition), the consequence/result (a ` +
    `finished, improved, or worsened state), a before/after, or a time-of-day variation ` +
    `(the same subject in early-morning vs late-afternoon light). ` +
    `The enemy is BOTH vagueness AND monotony: every substitute must still be a ` +
    `single specific filmable shot — never a vaguer one like "the setting" or "man talks". ` +
    `Leave "shotAngle" absent on hostPresent/CTA scenes.\n` +
    `- VISUAL PROMPT COMPLETENESS: every visualPrompt must be a fully self-contained ` +
    `shot description — the model sees only that one prompt with no memory of others. ` +
    `Host scenes embed: (a) a compact physical description matching the script's host ` +
    `(e.g. "early 60s man, weathered face, short gray hair"), (b) the exact outfit from ` +
    `the script, (c) camera cues ("medium-quality iPhone footage, fixed camera, natural ` +
    `indoor light, static medium shot from the chest up"), (d) the seated talking action ` +
    `plus a small gesture. B-roll scenes embed ONLY the specific environment/subject and ` +
    `its action — NO camera, lens, lighting, or quality wording (that look is added in ` +
    `code). Script-to-b-roll example — script: "pour the solution over the surface"; ` +
    `BAD: "a messy surface" (vague) or any version starting "tight shot of …"; ` +
    `GOOD (non-host): "clear ` +
    `liquid streaming from a plain unbranded jug onto a worn surface, the wet patch ` +
    `spreading and darkening". Second example — script: "set out a simple bait dish"; ` +
    `GOOD (non-host): "dark liquid pouring from a plain unbranded bottle into a shallow bowl ` +
    `on a railing at dusk". ` +
    `A vague one-liner like "man talks" or "the setting" is WRONG. ` +
    `Never write any person's proper name in a visualPrompt. Refer to the on-camera person ` +
    `as "the host" ONLY on host (talking-head/CTA) scenes; on b-roll never name or imply the ` +
    `host or any other person — when a cutaway needs a human action, write "a pair of bare ` +
    `hands" (humanPresent) and nothing more of the body. ` +
    `Even if the script names someone, do NOT put that name in any visual prompt.\n` +
    `- PHYSICS: every visualPrompt must describe only a physically plausible STATE — the frame ` +
    `as a real photo of a real moment. Gravity: liquids sit, pool, or run downward and loose ` +
    `solids (granules, powder, crumbs) rest settled on surfaces; nothing "clings", "hangs ` +
    `suspended", or holds an impossible surface-tension state. Flexible objects (leaves, ` +
    `fabric, cords) rest or lean naturally; solids (tools, containers, products) rest on ` +
    `surfaces or are held — they do not float. Keep every object a consistent, real shape and ` +
    `identity — no morphing, melting, or impossible geometry. Invented atmosphere is banned: no ` +
    `"mist hanging", no wisp or plume of steam or vapour rising off a surface (ordinary ` +
    `surfaces do not visibly steam) — show the concrete subject instead (a wet patch darkening ` +
    `as it soaks in, a freshly cleared surface). That ban covers atmosphere the narration never ` +
    `asked for; on an "objectMotion":true scene the beat's own moving element IS the subject, so ` +
    `show it moving — but still connected to its source and following a real path under gravity, ` +
    `never suspended, blurred, or streaked.` +
    faceTail +
    bookTail +
    `\n\nDIRECTION (authoritative — follow it exactly for the look, host, tone, ` +
    `and framing of host scenes; but DO NOT speak any of it — it shapes only the ` +
    `visuals):\n${instruction}`;

  const chunkList = chunks
    .map((c, i) => `[${i + 1}] ${spokenScript.slice(c.start, c.end).trim()}`)
    .join("\n");

  const subjectBlock = subject
    ? `VIDEO SUBJECT (what this entire video is about): ${subject}\n` +
      `Every chunk below is part of THIS video. When a chunk's narration refers to a generic or ` +
      `ambiguous thing ("the meat", "the animal", "the blade", "it", "this"), read it as the ` +
      `VIDEO SUBJECT's version of that thing and picture THAT specific subject. This only ` +
      `DISAMBIGUATES what the narration already says — do NOT force the subject into a chunk that ` +
      `is about something else, and never add an object the narration doesn't mention.\n\n`
    : "";

  // The one shared world, so every b-roll scene seeds in the same place and the location does not
  // drift between scenes. Disambiguation-only, exactly like subjectBlock — not a checklist.
  const worldBlock = styleBible
    ? `WORLD (every b-roll cutaway in this video shares ONE physical place — for CONSISTENCY, ` +
      `not a checklist): ${styleBible}\n` +
      `When a chunk's b-roll leaves the setting open, place it in THIS world so the location does ` +
      `not drift between scenes; do NOT add an object the narration doesn't mention, and let a ` +
      `chunk whose narration clearly happens elsewhere go where it says.\n\n`
    : "";

  // What earlier batches already chose — the only way the whole-video VARIETY rule can bind
  // across batches. A digest of hero phrases, not full prompts, to bound token growth.
  const priorShots = opts.priorShots?.filter(s => s.trim()) ?? [];
  const priorBlock =
    priorShots.length && opts.batchStartIndex && opts.totalChunks
      ? `SHOTS ALREADY USED EARLIER IN THIS VIDEO (this batch covers chunks ` +
        `${opts.batchStartIndex}–${opts.batchStartIndex + K - 1} of ${opts.totalChunks}). ` +
        `Never repeat the same subject AND shot angle from this list — reuse a subject only ` +
        `with a different angle or a clearly advanced stage:\n` +
        priorShots.map(s => `- ${s}`).join("\n") +
        `\n\n`
      : "";

  const userMessage =
    `Assign ONE visual to each of the ${K} numbered CHUNKS below, returning one JSON entry ` +
    `per chunk "index" 1..${K} (every chunk covered exactly once), so each b-roll cutaway ` +
    `matches the topic of the chunk it covers. Open and close on the seated host. Apply the ` +
    `host look, outfit, and visual style from the DIRECTION above to every host scene.\n\n` +
    subjectBlock +
    worldBlock +
    priorBlock +
    `=== SCRIPT CHUNKS ===\n${chunkList}\n=== END SCRIPT CHUNKS ===`;

  return { systemPrompt, userMessage };
}

// ─── Provider key resolution (mirrors helper in routers.ts) ────────

async function getProviderApiKey(provider: any): Promise<string> {
  return decrypt(provider.apiKeyEncrypted!);
}

/**
 * Return the providerType + apiKey to use for TTS voiceover.
 * 69Labs owns voiceover in this app — it is the only TTS lane.
 */
export async function resolveTTSProvider(
  _videoProvider: any
): Promise<{ providerType: string; apiKey: string }> {
  const sixtyNine = await getProviderByType("sixtynine_labs");
  if (sixtyNine?.apiKeyEncrypted) {
    return {
      providerType: sixtyNine.providerType,
      apiKey: await getProviderApiKey(sixtyNine),
    };
  }
  throw new Error(
    "No 69Labs provider configured — add a 69Labs API key in Admin for voiceover"
  );
}

/**
 * Return the providerType + apiKey to use for clip (video) generation.
 * Prefer a configured 69Labs provider — it owns video clips for longform
 * regardless of which provider is active. Fall back to the active provider
 * otherwise.
 */
export async function resolveVideoProvider(
  activeProvider: any
): Promise<{ providerType: string; apiKey: string }> {
  const sixtyNine = await getProviderByType("sixtynine_labs");
  if (sixtyNine?.apiKeyEncrypted) {
    return {
      providerType: sixtyNine.providerType,
      apiKey: await getProviderApiKey(sixtyNine),
    };
  }
  return {
    providerType: activeProvider.providerType,
    apiKey: await getProviderApiKey(activeProvider),
  };
}

/**
 * Resolve the host lip-sync lane, independent of which provider is active for b-roll clips.
 * `LIPSYNC_PROVIDER` picks it: `heygen` (Avatar IV — production default) or `runpod`
 * (InfiniteTalk on our own serverless GPU — the cheap staging lane). Returns null when the
 * chosen provider's key is unset, and `generateSceneClips` then fails host scenes loudly
 * rather than silently rendering them as non-lip-synced grok video.
 *
 * This is the ONLY branch on the provider — see `LipsyncLane`.
 */
export async function resolveLipsyncAdapter(
  params: LongformInputParams
): Promise<LipsyncLane | null> {
  // Per-tab HeyGen account, shared HEYGEN_API_KEY as the fallback. Read at render time so a key
  // rotation AND a job resume both pick up the current key — same contract as
  // `apimartAdapterForJob`. The `!= null` guard keeps the settings read off the path for a job
  // with no slot (and slot 0 is valid, so this cannot become a truthiness check).
  const key =
    (params.apimartSlot != null
      ? await getHeygenSlotKey(params.apimartSlot)
      : null) ?? ENV.heygenApiKey;
  if (!key) return null;
  const heygen = new HeygenLipsyncAdapter(key);
  return {
    provider: "heygen",
    // Avatar IV takes no prompt and has no gaze/camera knob: it INHERITS the gaze of the still
    // it animates, so the alt photo's off-axis look survives on its own — the choice of photo
    // IS the choice of angle.
    submit: ({ imageUrl, audioUrl }) =>
      heygen.submitLipsync({ imageUrl, audioUrl }),
    poll: (id, ms) => heygen.pollVideo(id, ms ?? HEYGEN_LIPSYNC_TIMEOUT_MS),
    // Per-ACCOUNT, not global: the 5 tabs each get their own 8 slots; tabs sharing a key
    // (e.g. all falling back to HEYGEN_API_KEY) correctly share one semaphore.
    slots: heygenSlotsFor(key),
    concurrency: ENV.heygenConcurrency,
    sceneDeadlineMs: SCENE_DEADLINE_HOST_MS,
  };
}

// ─── Concurrency pool ──────────────────────────────────────────────

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const idx = next++;
        await fn(items[idx], idx);
      }
    }
  );
  await Promise.all(workers);
}

// Thrown when a job is cancelled mid-pipeline. The background pipeline is
// fire-and-forget, so cancellation is cooperative: stages and per-scene workers
// re-check the job status and bail by throwing this, which unwinds the pipeline.
class JobCancelledError extends Error {
  constructor() {
    super("Cancelled by user");
    this.name = "JobCancelledError";
  }
}

// Re-reads the job status (cheap, status-only). A job that is no longer
// "processing" was cancelled/failed externally — abort the pipeline so no new
// (slow, billed) work is started.
async function assertNotCancelled(jobId: number): Promise<void> {
  const status = await getLongformVideoJobStatus(jobId);
  if (status && status !== "processing") throw new JobCancelledError();
}

// Clip generation is dispatched in two provider lanes (see `dispatchScenesByProvider`):
// b-roll on 69Labs at ENV.sixtynineVideoConcurrency, host lip-sync on HeyGen at
// ENV.heygenConcurrency. The per-provider semaphores (SIXTYNINE_VIDEO_SLOTS, and HeyGen's
// per-account `heygenSlotsFor(key)`) remain the hard in-flight cap.
const BROLL_ENHANCE_CONCURRENCY = 8;

// The enhancer is the highest-CALL-COUNT model in the pipeline: ~270 calls per 20-min video (one
// per cutaway + one per splitVisual), each re-sending a ~2000-token system prompt to emit ~120
// tokens of prompt rewrite — so this step dominates authoring spend. The whole authoring lane
// (subject, direction, storyboard, enhance) runs on Gemini 2.5 Flash via `invokeGemini`.
const TTS_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Per-scene workers ─────────────────────────────────────────────

/** Bounded attempts for one TTS segment — a timeout or transient failure is retried fresh. */
const TTS_MAX_ATTEMPTS = 2;

async function generateSceneVoiceover(
  providerType: string,
  apiKey: string,
  text: string,
  voiceId: string,
  ttsModel?: string,
  speed?: number,
  volume?: number,
  stability?: number,
  style?: number,
  similarity?: number
): Promise<string> {
  let lastError = "TTS failed";
  // Preserved across attempts: a timeout leaves the task running on the provider, so the next
  // attempt resumes polling the same job instead of re-creating it (which 69Labs rejects with
  // 409 DUPLICATE_TTS_IN_PROGRESS). Cleared on a genuine `failed` status so we create fresh.
  let taskId: string | undefined;
  for (let attempt = 0; attempt < TTS_MAX_ATTEMPTS; attempt++) {
    try {
      if (!taskId) {
        taskId = await createUnifiedTTSTask(providerType, apiKey, {
          text,
          voiceId,
          modelId: ttsModel,
          speed,
          stability,
          style,
          similarity,
        });
      } else {
        console.log(`[Longform] Resuming in-progress TTS task ${taskId}`);
      }
      const start = Date.now();
      while (Date.now() - start < TTS_TIMEOUT_MS) {
        await sleep(4000);
        const r = await pollUnifiedTTSTask(
          providerType,
          apiKey,
          taskId,
          volume
        );
        if (r.status === "completed" && r.audioUrl) return r.audioUrl;
        // "censored" is deterministic content moderation — retrying the same text won't help.
        if (r.status === "censored") {
          throw new CensoredTTSError(r.error || "TTS censored");
        }
        if (r.status === "failed") {
          // A failed job won't complete on resume — create a fresh one next attempt.
          taskId = undefined;
          throw new Error(r.error || "TTS failed");
        }
      }
      // Timeout: leave `taskId` set so the next attempt resumes polling this same job.
      throw new Error("TTS timed out");
    } catch (e: any) {
      if (e instanceof CensoredTTSError) throw e; // never retry moderation blocks
      lastError = e.message || "TTS failed";
      if (attempt < TTS_MAX_ATTEMPTS - 1) {
        console.warn(
          `[Longform] TTS attempt ${attempt + 1} failed (${lastError}) — retrying`
        );
        await sleep(5000);
      }
    }
  }
  throw new Error(lastError);
}

/** TTS content-moderation block — deterministic, so not retried (unlike a timeout/transient fail). */
class CensoredTTSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CensoredTTSError";
  }
}

/**
 * One fixed indoor background reused verbatim in every talking-head clip prompt.
 * Injected here (not in the Claude storyboard prompt) so it is byte-identical
 * across all clips and across regenerateScene reruns — the strongest available
 * lever for a consistent background, since each clip is an independent Grok call
 * with no memory of the others.
 */
export const TALKING_HEAD_BACKGROUND =
  "Background (identical in every shot): a cozy home study / living room — warm " +
  "wooden bookshelf filled with books behind him slightly out of focus, a small " +
  "potted plant on a shelf, a soft table lamp giving warm indoor light, a framed " +
  "picture on the wall, neutral beige wall. Same room, same chair, same angle in " +
  "every shot.";

/**
 * Appended wherever a longform b-roll prompt is submitted to the image/video model.
 * The models hallucinate garbled foreign-script text on labels/packaging even when we
 * ask for unbranded products; this forces any text that does render to be English/Latin.
 */
export const ENGLISH_TEXT_ONLY =
  "Any text, lettering, labels, or branding visible on packaging, containers, " +
  "signage, or products is plain English in the Latin alphabet only — never a " +
  "foreign language, non-Latin script, or invented gibberish characters.";

/**
 * Overlay-text guard appended to every generation prompt (b-roll via
 * `AMATEUR_IPHONE_LOOK`, host talking-head, and split-screen). Bans text STAMPED OVER the
 * frame — captions, watermarks, logos, titles — while `ENGLISH_TEXT_ONLY` continues to
 * allow incidental real-world text (product labels, packaging) that the amateur look
 * wants. Host lip-sync takes no prompt at all (Avatar IV animates the still directly),
 * so there is nothing to guard there.
 */
export const NO_OVERLAY_TEXT_SUFFIX =
  "No overlaid or superimposed text of any kind: no captions, subtitles, titles, " +
  "watermarks, logos, channel graphics, or lettering stamped over the frame.";

/**
 * The ONE fixed look phrase appended to every b-roll prompt (motion clips AND stills).
 * Everything else in a b-roll prompt is the script-derived `visualPrompt`; this is the
 * only imposed-look text, kept byte-identical across clips so the amateur aesthetic is
 * always present. NOT used on host (talking-head / split-screen) scenes.
 */
/**
 * The setting/background clause — the ONLY subject-dependent part of the look. It no longer
 * pins b-roll to a house/home interior: with a subject the setting is wherever the video's
 * topic really happens (so backgrounds track the title/script), and with no subject it is
 * just a real, unstaged everyday setting with no fixed location. The quality guardrails (no
 * staged sets / clean product photography / blank backgrounds) are kept in both. Ends at
 * "no blank backgrounds." so it joins cleanly with `AMATEUR_LOOK_TAIL`.
 */
function amateurSettingClause(subject?: string): string {
  const s = subject?.trim();
  return s
    ? // ponytail: "real products in use" + the subject staged the video's hero product into
      // shots that never mentioned it (job 200: a peroxide bottle on bare-lawn cutaways).
      // The frame-contents rail replaces it; drop it only if backgrounds go bare again.
      `shot handheld by an amateur in the real, unstaged setting where ${s} really ` +
        `happens, with natural everyday clutter; the frame contains only what this shot ` +
        `describes; no staged sets, no clean product photography, no blank backgrounds.`
    : "shot handheld by an amateur in a real, unstaged everyday setting with natural " +
        "everyday clutter and real products in use; no staged sets, no clean product " +
        "photography, no blank backgrounds.";
}

/**
 * The MOVEMENT half of the look: a locked-off camera plus one small, physics-driven ambient
 * settling — no subject acting on its own. Embedded in `AMATEUR_LOOK_TAIL` (and so in
 * `AMATEUR_IPHONE_LOOK`), it reaches every gpt-image-2 keyframe and every still; at video
 * clip-build time it is swapped per scene: `objectMotion` clips take `OBJECT_MOTION_CAMERA_CLAUSE`
 * (the subject's own motion runs) and `humanPresent` clips take `PERSON_MOTION_CAMERA_CLAUSE`
 * (the hands get one small task motion). A cutaway with neither flag never becomes a clip at all —
 * it is forced onto the still lane in `parseStoryboard`. Phrased as continuous physical motion on
 * purpose: a literal "motionless"/"frozen" directive makes grok emit a static frame, not a clip,
 * and handing grok one concrete, physically-caused motion to anchor on is what keeps it from
 * filling the clip by morphing textures.
 */
export const CAMERA_LOCK_CLAUSE =
  "The shot is a locked tripod frame, the camera fixed and " +
  "unmoving from the first frame to the last — braced or resting on a steady surface. The only " +
  "motion across the whole shot is what real-world physics alone would cause — the natural " +
  "settling and faint give of what is already there under gravity and the room's air — easing by " +
  "the barest amount, so gradually that almost nothing seems to happen until the very end of the " +
  "shot. No person or object moves under its own power or performs an action of its own; every " +
  "subject holds its exact solid shape, weight, and identity, and the background, the " +
  "surroundings, and every other object or person stay exactly as the frame already shows " +
  "them — steady and unchanged.";

/**
 * Hands-present sibling of `CAMERA_LOCK_CLAUSE` for the `humanPresent` b-roll VIDEO clip
 * (NOT the still keyframe, which stays on the base clause). The base clause froze everything
 * ("No person or object moves under its own power or performs an action of its own"), so a
 * hands-at-work cutaway just sat there. This variant keeps the same locked camera and holds
 * everything else still, but grants the hands ONE small, slow, natural action that continues
 * the task the frame already shows — and since the frame (`scene.visualPrompt`) is derived
 * from the narrated subject/action, that motion is script-based without any per-scene motion
 * authoring. Same opening/closing seams as the base clause so it splices into the look tail
 * identically; anti-morph rails guard the classic hand-warp failure. Nothing here licenses a
 * person to appear — `NO_FIGURES_SUFFIX` on the same prompt keeps the frame face- and body-free.
 */
export const PERSON_MOTION_CAMERA_CLAUSE =
  "The shot is a locked tripod frame, the camera fixed and " +
  "unmoving from the first frame to the last — braced or resting on a steady surface. " +
  "The hands in frame stay where they are and make a SINGLE small, slow, natural " +
  "movement that continues the task the frame already shows — a quiet motion of the fingers " +
  "or a gentle press, turn, or adjust of what they are working on, at an unhurried " +
  "real-time pace: the smallest believable action and nothing more. They do NOT withdraw " +
  "from frame, reach toward the camera, or make any broad gesture or large arm movement, " +
  "and no face, head, or body ever comes into the shot. The hands hold one " +
  "stable shape and proportion for the whole shot — no warping, morphing, " +
  "melting, or extra or missing fingers or limbs. Every object keeps its exact solid shape, " +
  "weight, and identity, and the background and the surroundings " +
  "stay exactly as the frame already shows them — the only other motion is the " +
  "faint, physics-caused settling of what is already there under gravity and the room's " +
  "air, so subtle it is barely there.";

/**
 * OBJECT-MOTION (`scene.objectMotion`) b-roll clip variant — the beat's subject moves BY ITSELF:
 * running water, a burning flame, rising smoke, liquid pouring. This is the whole reason an
 * object-only cutaway earns a clip at all: without it the scene is forced onto the still lane in
 * `parseStoryboard`, because a clip of nothing moving spends the expensive grok budget on a frame
 * a still renders better and safer.
 *
 * The camera is a locked tripod, so the subject's own motion carries the clip's entire motion
 * budget — and the morph rails cap that motion rather than any camera arc: same place, same path,
 * same rate, no spreading or growing beyond what the first frame already shows. That matters most
 * for fire, which grok will happily grow to fill the frame. Everything NOT moving keeps the base
 * clause's object rails (position, shape, weight, identity, nothing enters or leaves).
 *
 * Only ONE thing moves, and it is the thing the keyframe already shows underway — the same
 * script-derived, no-per-scene-authoring trick `PERSON_MOTION_CAMERA_CLAUSE` uses for hands.
 * Same opening/closing seams as `CAMERA_LOCK_CLAUSE` so it splices into the look tail identically.
 * Keeps the no-"motionless"/"frozen"/"still" rail (that vocabulary makes grok emit a static frame).
 */
export const OBJECT_MOTION_CAMERA_CLAUSE =
  "The shot is a locked tripod frame, the camera fixed and " +
  "unmoving from the first frame to the last — braced or resting on a steady surface. " +
  "The ONE thing in frame that is already in motion when the shot opens — the running " +
  "water, the burning flame, the rising smoke, the pouring liquid, whatever the frame " +
  "shows underway — simply keeps doing exactly that for the whole shot, at an ordinary " +
  "real-time pace, in the same place, along the same path, and at the same rate it starts " +
  "at. It does not speed up, surge, spread, grow, or travel beyond where the first frame " +
  "already shows it, and it never changes into anything else. Everything else in frame is " +
  "an inanimate object at rest and stays exactly where and as the first frame shows it, " +
  "holding its exact position, solid shape, weight, and identity — nothing else tips, " +
  "rolls, slides, sways, or acts on its own, and nothing enters or leaves the frame. The " +
  "background and the surroundings stay exactly as the frame already shows them.";

/**
 * STILL/KEYFRAME sibling of `OBJECT_MOTION_CAMERA_CLAUSE`. b-roll is image-to-video: the
 * gpt-image-2 keyframe IS grok's first frame, so a keyframe built with the base
 * `CAMERA_LOCK_CLAUSE` ("No person or object moves under its own power or performs an action of
 * its own") hands grok a settled puddle and asks it to invent running water — and invented
 * geometry is where the morphing starts. This clause instead composes the motion mid-action, the
 * way a real photograph catches it.
 *
 * "sharp and clearly readable, not blurred, streaked, or smeared" is load-bearing: asked for
 * motion in a still, image models reach for motion blur, and a smeared first frame degrades every
 * frame grok generates after it. The impossible-suspension rail is carried over from
 * `STILL_BROLL_ENHANCER_SYSTEM`'s physics rule, which this lane's directive otherwise relaxes.
 */
export const STILL_OBJECT_MOTION_CLAUSE =
  "The shot is a locked tripod frame, the camera fixed and unmoving — braced or resting on a " +
  "steady surface. The frame catches the subject's natural motion in progress, exactly as a " +
  "real photograph taken mid-action would catch it: water mid-stream, a flame mid-burn, " +
  "liquid mid-pour — sharp and clearly readable, not blurred, streaked, or smeared. Nothing " +
  "is impossibly suspended: whatever moves stays connected to its source and follows a real " +
  "path under gravity. Every other object in frame is at rest, holding its exact solid shape, " +
  "weight, and identity, and the background and the surroundings are steady and unchanged.";

/**
 * Everything after the setting clause — the fixed, subject-independent look/camera cues.
 * The camera never moves in any lane, so the closing "never sweeps, glides, or cranes" guard is
 * unconditional: every lane's clause locks the camera and lets (or forbids) the SUBJECT to move.
 * A `cameraMoves` variant existed for the deleted handheld-pan inert lane — see the changelog.
 */
function amateurLookTail(cameraClause: string): string {
  return (
    " Natural available light only. " +
    cameraClause +
    " Low production quality, authentic found-footage look. Muted, true-to-life colors " +
    "with a neutral white balance — slightly desaturated like real phone footage, no " +
    "color grading, no vivid, punchy, or oversaturated colors. " +
    "The camera stays at natural human height — eye level or below — never an aerial, " +
    "overhead-drone, crane, or flyover viewpoint" +
    ", and it never sweeps, glides, or cranes through the scene. " +
    NO_OVERLAY_TEXT_SUFFIX +
    " " +
    ENGLISH_TEXT_ONLY
  );
}

const AMATEUR_LOOK_TAIL = amateurLookTail(CAMERA_LOCK_CLAUSE);
const AMATEUR_LOOK_TAIL_PERSON = amateurLookTail(PERSON_MOTION_CAMERA_CLAUSE);
const AMATEUR_LOOK_TAIL_OBJECT = amateurLookTail(OBJECT_MOTION_CAMERA_CLAUSE);
const AMATEUR_LOOK_TAIL_OBJECT_STILL = amateurLookTail(
  STILL_OBJECT_MOTION_CLAUSE
);

export const AMATEUR_IPHONE_LOOK = amateurSettingClause() + AMATEUR_LOOK_TAIL;
export const AMATEUR_IPHONE_LOOK_PERSON =
  amateurSettingClause() + AMATEUR_LOOK_TAIL_PERSON;
export const AMATEUR_IPHONE_LOOK_OBJECT =
  amateurSettingClause() + AMATEUR_LOOK_TAIL_OBJECT;
export const AMATEUR_IPHONE_LOOK_OBJECT_STILL =
  amateurSettingClause() + AMATEUR_LOOK_TAIL_OBJECT_STILL;

/** Which camera clause a caller's lane gets — see `amateurIphoneLook`. */
type LookMotion = "settle" | "person" | "object" | "objectStill";

const LOOK_TAIL_BY_MOTION: Record<LookMotion, string> = {
  settle: AMATEUR_LOOK_TAIL,
  person: AMATEUR_LOOK_TAIL_PERSON,
  object: AMATEUR_LOOK_TAIL_OBJECT,
  objectStill: AMATEUR_LOOK_TAIL_OBJECT_STILL,
};

const LOOK_BY_MOTION: Record<LookMotion, string> = {
  settle: AMATEUR_IPHONE_LOOK,
  person: AMATEUR_IPHONE_LOOK_PERSON,
  object: AMATEUR_IPHONE_LOOK_OBJECT,
  objectStill: AMATEUR_IPHONE_LOOK_OBJECT_STILL,
};

/**
 * Subject-aware `AMATEUR_IPHONE_LOOK`: same fixed look/camera cues, but the setting clause
 * fits the whole-video subject (title, else a cheap LLM read of the script). Returns the
 * plain constant when no subject is known, so no-subject callers stay byte-identical.
 * `motion` swaps the camera clause: "person"
 * (`humanPresent` hands-at-work b-roll VIDEO clips) → the
 * `PERSON_MOTION_CAMERA_CLAUSE` that grants the hands one small task motion; "object"
 * (`objectMotion` b-roll VIDEO clips) → the `OBJECT_MOTION_CAMERA_CLAUSE` that locks the camera
 * and lets the subject's own motion run; "objectStill" → its `STILL_OBJECT_MOTION_CLAUSE`
 * keyframe/still sibling, composed mid-motion; the default "settle" keeps
 * every still/edit caller byte-identical on the base `CAMERA_LOCK_CLAUSE`.
 */
export function amateurIphoneLook(
  subject?: string,
  motion: LookMotion = "settle"
): string {
  if (subject?.trim())
    return amateurSettingClause(subject) + LOOK_TAIL_BY_MOTION[motion];
  return LOOK_BY_MOTION[motion];
}

/**
 * Which camera clause a non-host cutaway CLIP gets. Precedence: hands at work → object moving by
 * itself. Shared by `buildClipChain` and the content-policy escalation retry so the two can't
 * drift apart.
 *
 * The "settle" fallback is defensive only: `parseStoryboard` forces any non-host cutaway with
 * NEITHER motion flag onto the still lane, so a flagless scene should never reach a clip at all
 * (see the `stillImage` invariant there). If one does, the locked, no-self-powered-motion base
 * clause is the safe register — it is what stills already use.
 */
function brollLookMotion(scene: StoryboardScene): LookMotion {
  if (scene.humanPresent) return "person";
  if (scene.objectMotion) return "object";
  return "settle";
}

// The b-roll VIDEO enhancer is gone: b-roll no longer authors per-scene motion. A
// (formerly-video) cutaway now uses STILL_BROLL_ENHANCER_SYSTEM (visual-only rewrite); the
// single fixed CAMERA_LOCK_CLAUSE supplies the near-imperceptible motion at clip-build time.

/**
 * Fixed look tail for EDIT-PAGES videos only (longform and edit stills keep
 * AMATEUR_IPHONE_LOOK). Adds the older-filmer identity, first-person snapshot
 * framing, and iPhone rendering cues matched to the user's reference footage.
 */
export const EDIT_VIDEO_AMATEUR_LOOK =
  "filmed by an older homeowner on their iPhone, casual first-person framing — " +
  "the kind of slightly tilted, imperfectly composed shot a 60-year-old takes of " +
  "their own home or space; subject sometimes partly cropped at the frame edge. Real " +
  "lived-in home — actual kitchen counters, tables, garages, patios, or outdoor spaces with " +
  "everyday clutter and real products in use; no staged sets, no clean product " +
  "photography. Natural available light only, whatever the time of day — flat " +
  "overcast, dim garage window light, or low morning sun with soft backlight. " +
  "Handheld with slight natural shake, no gimbal, no smooth production movement. " +
  "Deep focus and mild phone oversharpening, true-to-life neutral colors, slightly " +
  "desaturated like real phone footage — no color grading, no vivid or punchy " +
  "colors, authentic found-footage look.";

/**
 * Enhancer system prompt for EDIT-PAGES videos only — the one b-roll lane that still authors
 * per-scene motion. Task narration is framed as the filmer's own first-person POV hands
 * (instead of people-incidental), and natural light of any time of day is allowed
 * (golden-hour ban dropped; saturation ban kept).
 */
export const EDIT_VIDEO_BROLL_ENHANCER_SYSTEM =
  "You are a video-prompt specialist for a YouTube channel whose viewers are mostly " +
  "50–70 years old. They find busy, fast, or jittery motion tiring and hard to follow, " +
  "so b-roll must feel calm, slow, and easy on the eye.\n\n" +
  "Rewrite the prompt to:\n" +
  "- Add one concrete sensory or tactile detail OF THE NARRATED SUBJECT (texture, colour, " +
  "material — what you would actually see up close); do not add new objects.\n" +
  "- Add a natural lighting or colour-mood cue using natural light as a real person " +
  "would find it — soft overcast, even indoor daylight, dim shed light, or low warm " +
  "morning/evening sun — never studio lighting; keep color true-to-life and never " +
  "vivid or saturated.\n" +
  "- Give it ONE gentle, slow motion and nothing more, and make it the SMALLEST " +
  "believable movement: a slight drift, sway, settle, or thin trickle. That motion MUST " +
  "belong to the HERO SUBJECT the narration is about (the water it pours, the plant or " +
  "leaves it shows, the material being worked) — the thing the viewer is watching is the " +
  "thing that moves. Do NOT deflect the motion onto an unrelated background or ambient " +
  "element (a stray leaf, a loose thread, a background stream) while the subject sits " +
  "frozen; if the subject genuinely cannot move, keep it a still, not a video. If hands " +
  "are present they hold their position with only subtle natural motion (no walking, " +
  "bending, reaching, leaning, big gestures, or repositioning). " +
  "Describe it moving softly and continuously with a calm, low-energy verb (drifting, " +
  "gently swaying, slowly settling, a slow trickle, barely stirring), " +
  'phrased as ONGOING THROUGHOUT THE WHOLE SHOT (e.g. "continues to", "keeps slowly", ' +
  '"gently") so it never freezes — but the motion must be minimal and unhurried, like ' +
  "real life at rest. Do NOT use fast, forceful, or busy verbs (no pouring, streaming, " +
  "scattering, billowing, rushing, splashing), and NO large, repeated, or whole-body " +
  "movement and no subject locomotion; do NOT add a second moving element — " +
  'everything else in the frame stays calm and still. Do NOT write "motionless", ' +
  '"still", "suspended", or "frozen" — these instruct the video model to produce ' +
  "a static frame, not a video clip.\n" +
  "- NO INVENTED ATMOSPHERIC HAZE: do NOT use a wisp, plume, trail, or veil of steam, " +
  "moisture, vapour, mist, or heat-haze rising, drifting, or curling up off a surface, " +
  "water, or any material as the motion — ordinary surfaces do NOT " +
  "visibly steam or give off vapour, and it reads as fake AI atmosphere. Use a real, visible " +
  "motion of the ACTUAL subject instead (the subject's own water trickling, the material " +
  "settling, hands working unhurriedly).\n" +
  "- PHYSICS & REALISM: every motion must obey real-world physics — gravity, momentum, " +
  "inertia, weight, balance, friction, and natural human biomechanics. Gravity pulls " +
  'liquids and loose matter downward; liquids flow, drip, or pool (never "cling ' +
  'motionless" or "hang suspended"); plants sway in the ' +
  "direction of wind; granules or powder settle onto surfaces and stay put. Objects keep " +
  "a consistent size, shape, position, colour, and identity for the whole shot — no " +
  "morphing, duplication, disappearance, teleportation, stretching, melting, flickering, " +
  "or unexplained movement. Any person has realistic anatomy and proportions, natural " +
  "joint movement, and plausible body mechanics (no extra limbs or fingers). Clothing, " +
  "hair, fabric, water, loose materials, and tools react naturally to movement, wind, gravity, " +
  "and contact, and every action produces a realistic reaction. Lighting stays consistent " +
  "and interacts naturally with surfaces; depth, perspective, shadows, reflections, and " +
  "occlusion stay accurate. Describe a real, physically-true moment as if filmed on a " +
  "phone, never a CGI render. Any phrasing where the physical cause of the motion is " +
  "unclear or impossible must be rewritten.\n" +
  "- REAL-WORLD ACCURACY: tools are held and used correctly; water follows natural gravity " +
  "and flow; materials have realistic texture and weight; any plants, fabric, or loose matter " +
  "behave accurately; any task reflects how it is really done; settings look like authentic " +
  "everyday spaces belonging to adults aged 50–70.\n" +
  "- SCRIPT ALIGNMENT: depict only what the current narration states or clearly implies. " +
  "Do NOT introduce future events, unrelated objects or actions, or decorative elements " +
  "not in the narration. Prefer literal visual interpretation over artistic, and make every " +
  "visible action directly support the spoken line.\n" +
  "- NEVER depict a book, book cover, booklet, magazine, or any printed publication — even " +
  "when the narration mentions one. Show the actual subject the narration is about " +
  "instead.\n" +
  "- Do NOT describe the camera, lens, or shot type — those are added separately.\n" +
  "- Compose for older (50–70) viewers: ONE clear hero subject — and the hero is the " +
  "TOPIC of the shot itself (the product, tool, material, task, or setting), uncluttered " +
  "and easy to read at a glance, in a warm, familiar everyday setting.\n" +
  "- FIRST-PERSON POV FOR TASKS: when the narration states or clearly implies a physical " +
  "task (sprinkling, pouring, holding, planting, spreading, pruning), frame it as the " +
  "filmer's own point of view — weathered bare hands and forearms entering " +
  "the frame from the bottom or side, doing the task while they film with the other hand; " +
  "a sleeve cuff or the bucket they are working from may edge into frame. NEVER show a " +
  "face, head, hair, shoulders, torso, or legs, and never a second person. When the " +
  "narration is purely scenic (a setting, an object, weather, a product " +
  "sitting somewhere), show NO human parts at all.\n" +
  "- NO PEOPLE: hands and forearms are the ONLY human parts that may appear — no face, " +
  "head, body, silhouette, reflection, or anyone in the background. If the original prompt " +
  "or narration names or implies a person, rewrite them out to the object, tool, task, or " +
  "result, or to a pair of bare hands. Never write a proper name.\n" +
  '- Remove generic AI-video clichés ("cinematic", "8k", "ultra-realistic", ' +
  '"professional", "stunning", "beautiful", "breathtaking") and any saturation-pushing ' +
  'words ("vivid", "vibrant", "saturated", "richly colored")\n' +
  "- SAFE VOCABULARY: image/video providers reject prompts with violent or harm wording. " +
  'Never use "kill", "poison", "pesticide", "exterminate", "destroy", "dead", "dying", ' +
  '"rotting", "infestation", or "chemicals" — use neutral alternatives ("repel", ' +
  '"remove", "treatment", "wilted", "insects").\n\n' +
  "Keep the rewrite under 55 words. Output the enhanced prompt only — no explanation, " +
  "no quotes, no prefix.";

/**
 * System prompt for the b-roll STILL image prompt enhancer. Same contract as the video
 * variant but targets composition and depth-of-field instead of motion cues.
 */
export const STILL_BROLL_ENHANCER_SYSTEM =
  "You are an image-prompt specialist for a YouTube channel. Your job is to take a short " +
  "still-image prompt and make it natural and realistic and compositionally strong for " +
  "an AI image generator.\n\n" +
  "Rewrite the prompt to:\n" +
  "- Add one concrete sensory or tactile detail OF THE NARRATED SUBJECT (texture, colour, " +
  "material up close); do not add new objects.\n" +
  "- Add a natural lighting or colour-mood cue using soft, neutral light (soft overcast, " +
  "even indoor daylight, flat diffused shade, etc. — avoid warm golden-hour light). Keep " +
  "the color muted and natural, never vivid or saturated — but do NOT name a camera, lens, " +
  "shot type, or depth-of-field; the look is appended in code.\n" +
  "- Add one compositional note about the narrated subject (tight foreground subject, " +
  "objects at an angle, etc.) — but do NOT describe camera, lens, shot type, lighting " +
  "quality, depth-of-field, or production look; those are appended in code.\n" +
  "- Compose for older (50–70) viewers: ONE clear hero subject, uncluttered and easy " +
  "to read at a glance, in a warm, familiar everyday setting.\n" +
  "- SCRIPT ALIGNMENT: depict only what the current narration states or clearly implies — " +
  "no unrelated objects, no future events, no decorative extras. Prefer literal over " +
  "artistic. Bare hands appear only when the narration implies a manual action, and are " +
  "shown paused or at rest, not mid-motion.\n" +
  "- NEVER depict a book, book cover, booklet, magazine, manual, handbook, handout, " +
  "blueprint, printed guide, or any printed publication or printed page — even when the " +
  "narration mentions, quotes, or is entirely about one. When the narration cites what a " +
  "book, manual, or guide SAYS, depict the real-world thing it describes, at a settled " +
  'moment just after the action — never the document itself ("the manual says water ' +
  'deeply" → a garden bed dark and soaked after a deep watering, NOT a manual).\n' +
  "- REAL-WORLD ACCURACY: materials have realistic texture and weight; any plants, fabric, " +
  "or loose matter look accurate; tools are held and used correctly; settings look like " +
  "authentic everyday spaces of adults aged 50–70 under neutral, natural light.\n" +
  "- NO PEOPLE: never depict a person — no face, head, hair, shoulders, torso, legs, " +
  "silhouette, or reflection of anyone, and nobody in the background. If the original " +
  "prompt or the narration names or implies a person (a man, a gardener, a homeowner, " +
  "someone watching or inspecting), rewrite them out: keep the object, tool, task, or " +
  'result they interact with, or reduce them to "a pair of weathered bare hands" at the ' +
  "work, framed so nothing above the forearms is in shot. Never write any person's proper " +
  "name — even if the original prompt or narration names someone.\n" +
  '- Remove generic AI-image clichés ("photorealistic", "8k", "ultra-realistic", ' +
  '"professional photography", "stunning", "beautiful", "breathtaking") and any ' +
  'saturation-pushing words ("vivid", "vibrant", "saturated", "richly colored")\n' +
  "- SAFE VOCABULARY: image providers reject prompts with violent or harm wording. " +
  'Never use "kill", "poison", "pesticide", "exterminate", "destroy", "dead", "dying", ' +
  '"rotting", "infestation", or "chemicals" — use neutral alternatives ("repel", ' +
  '"remove", "treatment", "wilted", "insects").\n' +
  "- PHYSICS & REALISM: describe a physically plausible moment at rest — the settled " +
  "instant just after any action, never the middle of a motion: a droplet come to rest, a " +
  "cloth hanging still, hands paused on a finished task, a surface freshly wiped and set " +
  "down. Nothing is airborne or in mid-motion — no droplet, granule, tool, or material " +
  "mid-fall, mid-pour, mid-splash, or mid-swing; anything loose has already landed and " +
  "rests fully supported on a surface. " +
  "Any hands have realistic anatomy and proportions and no extra limbs or fingers; " +
  "objects keep a consistent shape and identity with no morphing or duplication. Depth, " +
  "perspective, shadows, reflections, and occlusion stay accurate, and lighting interacts " +
  'naturally with materials. Avoid ambient states that imply impossible suspension ("dew ' +
  'clinging perfectly", "mist frozen in place", "frost suspended"). The still should look ' +
  "like a real photograph taken at a calm, settled instant, not a CGI render of an " +
  "impossible scene.\n\n" +
  "Keep the rewrite under 60 words. Output the enhanced prompt only — no explanation, " +
  "no quotes, no prefix.";

/**
 * Enhancer for CTA cutaways. The scene's narration is a sales pitch ("scan the QR code",
 * "the link's in the description", "grab the book"), which must NOT drive the image — the QR
 * card is composited in code, so the cutaway shows calm, on-topic b-roll instead.
 */
const CTA_BROLL_ENHANCER_SYSTEM =
  "You write b-roll image prompts for a YouTube channel for an older (50–70) audience.\n\n" +
  "The scene's narration is a SALES PITCH (asking the viewer to scan a code, visit a site, " +
  "or buy a book/product). IGNORE that pitch completely — do NOT depict it. Instead write a " +
  "calm, generic, ON-TOPIC cutaway in the SAME subject space as the rest of " +
  "the video (use the provided topic context).\n\n" +
  "HARD RULES:\n" +
  "- NEVER depict a phone, smartphone, QR code, screen, TV, monitor, laptop, tablet, book, " +
  "book cover, booklet, magazine, manual, handbook, handout, blueprint, printed guide, printed " +
  "page, packaging, website, URL, link, app, or any person scanning/looking at/holding a device " +
  "or product — even when the narration mentions or quotes one. Show the real-world thing the " +
  "video is about instead, never the printed object. No text overlays, no logos.\n" +
  "- NO invented atmospheric haze: no wisps, plumes, trails, or steam rising off a surface " +
  "unless the narration is specifically about that motion — show the concrete subject instead.\n" +
  "- ONE clear hero subject — a product, tool, material, surface, or setting from the " +
  "video's topic — uncluttered and easy to read at a glance.\n" +
  "- A single concrete composed subject as a frame (the clip barely moves; any motion is " +
  "added in code).\n" +
  "- NO people: no face, head, body, or figure of any kind. Bare hands at the task are the " +
  "only human parts allowed, and only when the shot needs them.\n" +
  "- Soft, neutral, muted natural light — never vivid or saturated. No AI-image clichés.\n" +
  "- PHYSICS & REALISM: a real, physically-plausible, accurate everyday " +
  "moment with correct anatomy and natural materials — not a CGI render.\n\n" +
  "Keep the rewrite under 40 words. Output the enhanced prompt only — no explanation, no " +
  "quotes, no prefix.";

/**
 * Prepended to the split-screen enhancer userMessage. The split right panel sits beside the
 * talking host, so it must be object/setting only — stricter than the cutaway lane's
 * `CUTAWAY_PERSON_FREE_DIRECTIVE`, which still allows bare hands at the task. Rewrites any
 * person out of the positive description, NAMES the object that replaces them, and lets the
 * narration outrank the seed when the two disagree.
 *
 * The last two clauses exist because banning hands leaves this lane with no legal subject on a
 * person-action beat: `STILL_BROLL_ENHANCER_SYSTEM` also says "do not add new objects", so the
 * only compliant output left was to restate `Original prompt:` — and `enforceHostSplitMix` seeds
 * `splitVisual` from `brollVisual ?? visualPrompt`, so that seed is often the host's own
 * talking-head prompt. The cutaway lane never had the bug: its directive already pairs the
 * prohibition with a positive fallback ("a pair of bare hands at the work").
 */
export const SPLIT_PANEL_PERSON_FREE_DIRECTIVE =
  "IMPORTANT: this is a split-screen RIGHT PANEL shown beside the talking host — it must be " +
  "OBJECT / PRODUCT / SETTING ONLY, with NO people, NO hands, and NO body parts. If the original " +
  "names or implies a person, replace them with the object, tool, task, or result they interact " +
  "with.\n" +
  "IMPORTANT: when the narration's subject is a PERSON DOING SOMETHING, show the physical thing " +
  "that action happens to or leaves behind — the garment, material, tool, food, container, " +
  "surface, or finished result — unattended and at rest, in place exactly as the action left it. " +
  "Never substitute a diagram, chart, illustration, cross-section, or anatomical rendering; the " +
  "panel is always a real photograph of real objects.\n" +
  "IMPORTANT: the narration decides the SUBJECT; the original prompt only supplies wording. If " +
  "the original prompt is about something this narration is not about, DISCARD it entirely and " +
  'describe the narrated subject instead — here that outranks the "do not add new objects" rule.';

/**
 * Cutaway sibling of `SPLIT_PANEL_PERSON_FREE_DIRECTIVE`, prepended to the b-roll enhancer's
 * user message. Same job — rewrite any person out of the POSITIVE description before it reaches
 * render — but a cutaway is the whole frame rather than a panel beside the host, so bare hands
 * at the task stay allowed (often the only literal way to show a narrated manual action).
 * `NO_FIGURES_SUFFIX` is the render-time negation behind it.
 */
export const CUTAWAY_PERSON_FREE_DIRECTIVE =
  "IMPORTANT: this cutaway must show NO PERSON — no face, head, hair, shoulders, torso, legs, " +
  "silhouette, reflection, or anyone in the background. If the original names or implies a " +
  "person (a man, a gardener, a homeowner, someone watching or inspecting), rewrite them out: " +
  "keep the object, tool, task, or result they interact with, or reduce them to a pair of bare " +
  "hands at the work, framed so nothing above the forearms is in shot.";

/**
 * Prepended to the cutaway enhancer userMessage on an `objectMotion` scene. The shared
 * `STILL_BROLL_ENHANCER_SYSTEM` demands "the settled instant just after any action, never the
 * middle of a motion" and bans anything mid-pour or mid-fall — it would rewrite the running water
 * straight back into a puddle before the prompt ever reaches render. The system prompt is shared
 * with the split-panel lane, so the override goes here instead, the same way
 * `CUTAWAY_PERSON_FREE_DIRECTIVE` overrides person handling from the user message.
 * It relaxes ONLY the settled-instant rule, and only for the beat's own moving element — the
 * impossible-suspension and no-blur rails stay, because this rewrite becomes the keyframe.
 */
export const OBJECT_MOTION_DIRECTIVE =
  "IMPORTANT: this cutaway's subject is IN MOTION — the narration is about something actively " +
  "moving on its own (water running, a flame burning, liquid pouring, smoke rising). For this " +
  "one prompt, override the settled-instant rule: describe that motion IN PROGRESS as a real " +
  "photograph would catch it (water mid-stream, flames mid-burn), not the settled moment after " +
  "it. Keep it physically plausible — the moving element stays connected to its source and " +
  "follows a real path under gravity, nothing impossibly suspended, and nothing blurred, " +
  "streaked, or smeared. Everything else in the frame stays at rest.";

/**
 * Prepended to the cutaway enhancer userMessage on a `humanPresent` VIDEO clip (not still).
 * The shared `STILL_BROLL_ENHANCER_SYSTEM` demands hands "paused or at rest" — correct for
 * stills and Ken Burns, wrong for the video lane where `ANON_PERSON_SUFFIX` and
 * `PERSON_MOTION_CAMERA_CLAUSE` expect hands mid-task from the first frame. Same pattern as
 * `OBJECT_MOTION_DIRECTIVE`: override only the settled-instant rule for hands; everything else
 * in the system prompt stays.
 */
export const HUMAN_MOTION_DIRECTIVE =
  "IMPORTANT: this is a VIDEO cutaway with hands at work — the narration implies a manual " +
  "action. For this one prompt, override the paused/at-rest rule for the hands ONLY: describe " +
  "bare weathered hands already in frame and mid-task from the start (fingers on the tool, " +
  "pressing or adjusting what they work on), never entering from off-screen and never paused " +
  "on a finished result. Keep everything else at rest — no face, head, or body, and no broad " +
  "arm movement. The hands hold realistic anatomy with no extra fingers.";

/**
 * Maps a scene's `shotAngle` value (assigned by the storyboard model) to a short
 * camera-direction phrase appended to the b-roll prompt in `buildClipChain`. Keeps
 * camera language out of `visualPrompt` (Claude's domain) while still driving variety.
 */
const SHOT_ANGLE_SUFFIX: Record<string, string> = {
  mid: "medium shot waist height",
  wide: "wide phone shot taking in the whole scene, camera at standing height",
  overhead:
    "phone held above the subject looking straight down at it, from arm's length",
  low: "low angle near ground level",
  pov: "handheld first-person POV — camera at chest height looking down at an older man's weathered hands and the work surface as if the viewer is doing the task themselves",
};

/**
 * Appended to the HANDS-ONLY b-roll lane (`humanPresent`) — used only when a beat genuinely
 * needs a human action on screen. B-roll never shows a person: only bare hands and forearms
 * enter the frame at the task, never a face, head, or body, and never the channel host.
 */
export const ANON_PERSON_SUFFIX =
  "The only part of a human visible anywhere in this shot is a pair of bare hands (and at " +
  "most the forearms) at the task — ordinary, weathered, unadorned adult hands. The hands " +
  "are already in frame and on the task from the very first frame of the shot — mid-task " +
  "from the start, never entering from off-screen, reaching in later, or appearing partway " +
  "through. " +
  "NO face, NO head, NO hair, NO shoulders, NO torso, NO legs, and no full or partial figure " +
  "of a person is visible or reflected anywhere in the frame; the camera is framed close and " +
  "low enough that everything above the forearms is outside the shot. The hands belong to no " +
  "named, specific, famous, or recurring individual. They work quietly and do not gesture at " +
  "or address the camera — the narration is voiced over the top. No on-screen text or " +
  "captions. Keep the script's subject/product/result the hero of the shot, with the hands " +
  "incidental to the action.";

/**
 * Appended to CTA / QR host scenes only. The QR card is composited over the frame in
 * assembly, so the host must keep his hands empty rather than holding up the product —
 * a product in-hand clutters the frame and fights the QR overlay.
 */
export const CTA_EMPTY_HANDS_SUFFIX =
  "In this shot the host's hands are empty and relaxed (resting naturally or gesturing " +
  "lightly) — he is NOT holding, lifting, showing, or displaying any product, book, " +
  "bottle, container, or object of any kind. He only talks calmly to the camera.";

/**
 * Appended to every b-roll generation prompt (still lane, b-roll keyframe, and b-roll video).
 * B-roll never depicts the book — the `showsBook` cover-reference path is disabled, so this is
 * the unconditional guard against a hallucinated book in a cutaway. (The end-of-video literal
 * cover reveal is a separate non-generated still and is unaffected.)
 */
export const NO_BOOK_SUFFIX =
  "No book, book cover, magazine, booklet, pamphlet, brochure, catalog, notebook, " +
  "journal, instruction manual, handbook, handout, blueprint, printed page, or any " +
  "printed publication anywhere in the frame.";

/**
 * Appended to the split-screen RIGHT-half visual (both the lip-sync Ken Burns still and the
 * text-to-video split prompt). The host already carries a person on the LEFT half, so the right
 * panel is object/product/setting only — a second person there competes with the host and reads
 * off. Phrased WITHOUT "anywhere in the frame" so it can be scoped to the right half inside the
 * two-half text-to-video prompt without threatening the LEFT host. Enhancer/authoring nudges the
 * positive description person-free; this is the render-time negation guard.
 */
export const NO_PEOPLE_SUFFIX =
  "No people, no person, no human figure, no hands, arms, or body parts — only the " +
  "object, product, or setting itself.";

/**
 * Render-time negation appended to EVERY non-host b-roll prompt (motion clips and stills alike),
 * unconditionally — the guarantee that a cutaway never shows a person, whatever the storyboard
 * or the enhancer wrote into the positive description. Looser than `NO_PEOPLE_SUFFIX` (which the
 * split-screen right panel keeps): hands and forearms at the task ARE allowed here, since a
 * hands-on b-roll shot is often the only literal way to depict a narrated manual action. What is
 * banned is a *person* — any face, head, or body, whole or partial.
 */
export const NO_FIGURES_SUFFIX =
  "No person is visible in this shot: no face, head, hair, shoulders, torso, or legs, no " +
  "whole or partial human figure, no silhouette, no reflection of a person, and no people in " +
  "the background. Bare hands and forearms working at the task are the ONLY human parts that " +
  "may appear, and only where the action needs them.";

/**
 * Self-contained lip-sync directive — the ENTIRE InfiniteTalk host prompt (see
 * `buildLipsyncPrompt`), used ONLY on the RunPod lane; HeyGen Avatar IV takes no prompt at all.
 * InfiniteTalk wants a CONCISE prompt focused on articulation / expression / framing; identity
 * comes from the reference photo, and a long brief produces noisy output, so we do NOT prepend
 * the rich per-scene visualPrompt. Encodes: the host descriptor (so the prompt stands alone),
 * face large + front-facing (better sync), clear unobstructed mouth articulation, single speaker,
 * and a firm minimal-motion restriction (the on-screen host is elderly — head/body sway and
 * gesturing read as jittery).
 */
export const LIPSYNC_HOST_DIRECTION =
  "An older man in his early 60s speaks straight to the camera in a tight medium " +
  "close-up, face large and centered, looking at the lens. Clear, precise lip-sync: " +
  "his mouth articulates every word and stays fully visible, hands never near his " +
  "face. He is calm and still — torso, shoulders, and head barely move, no swaying or " +
  "gesturing, hands resting quietly out of frame. One person speaking, no one else talking.";

/**
 * Ordered term→synonym map that rewrites harm-adjacent words Grok's 69labs content classifier
 * misclassifies in our pest-control niche ("restricted or misclassified content" rejections)
 * into neutral language. Applied to b-roll visual prompts before submit. Longer/multi-
 * word patterns come first so they win over the single-word ones (e.g. `infestation` before
 * any future `infest`). Word-boundary, case-insensitive. Extend as new rejections surface.
 */
export const CONTENT_SOFTENING_MAP: ReadonlyArray<[RegExp, string]> = [
  [/\binfestations?\b/gi, "cluster of insects"],
  [/\binfested\b/gi, "covered"],
  [/\bexterminat(?:e|es|ed|ing|or|ors|ion)\b/gi, "remove"],
  [/\bpesticides?\b/gi, "treatment"],
  [/\binsecticides?\b/gi, "treatment"],
  [/\bpoisonous\b/gi, "harmful"],
  [/\bpoison(?:ed|ing|s)?\b/gi, "treatment"],
  [/\bkilling\b/gi, "repelling"],
  [/\bkilled\b/gi, "repelled"],
  [/\bkills?\b/gi, "repels"],
  [/\bdestroy(?:s|ed|ing)?\b/gi, "damaged"],
  [/\btraps?\b/gi, "deterrent"],
  // Decay / disease / chemical wording the classifier reads as gore or hazard.
  [/\bdiseased?\b/gi, "damaged"],
  [/\bchemicals?\b/gi, "treatment"],
  [/\bmaggots?\b/gi, "small insects"],
  [/\blarvae?\b/gi, "small insects"],
  [/\bvenom(?:ous)?\b/gi, "harsh"],
  [/\bfung(?:us|i|al)\b/gi, "mildew"],
  [/\brot(?:s|ted|ting)?\b/gi, "spoiled"],
  [/\bdecay(?:s|ed|ing)?\b/gi, "aging"],
  [/\bdying\b/gi, "wilting"],
  [/\bdead\b/gi, "wilted"],
  [/\bswarm(?:s|ed|ing)?\b/gi, "cluster"],
  // Minor/underage tier — PEOPLE words only, so subject terms ("young seedlings",
  // "minor damage") are untouched. Neutralized to the anonymous-adult identity. Bare nouns
  // (no article) so we don't produce "a an adult" when a determiner already precedes them.
  [/\bschoolchildren\b/gi, "adults"],
  [/\bchild(?:ren)?\b/gi, "adult"],
  [/\bkids?\b/gi, "adult"],
  [/\btoddlers?\b/gi, "adult"],
  [/\bteen(?:ager)?s?\b/gi, "adult"],
  [/\bpests?\b/gi, "insects"],
  [/\bbugs?\b/gi, "insects"],
];

// Markers for the invented "atmospheric haze" beat the b-roll enhancer likes to add — a
// wisp/plume of steam, moisture, vapour, or mist rising/drifting/settling off a ground surface.
// A hit needs ALL THREE (haze noun + rise/drift verb + ground/surface source) so real motion
// (water trickling, a leaf swaying, dust raked up, steam off a mug of tea) is left alone.
const WISP_HAZE =
  /\b(?:wisps?|plumes?|trails?|threads?|tendrils?|curls?|veils?|hazes?|vapou?rs?|steam|mist)\b/i;
const WISP_MOTION =
  /\b(?:ris\w*|drift\w*|curl\w*|waft\w*|settl\w*|billow\w*|hover\w*)\b/i;
const WISP_SOURCE =
  /\b(?:soil|compost|ground|mulch|earth|dirt|surfaces?|beds?|heaps?|piles?|bins?|puddles?|water)\b/i;

function isAtmosphericWisp(s: string): boolean {
  return WISP_HAZE.test(s) && WISP_MOTION.test(s) && WISP_SOURCE.test(s);
}

/**
 * Strip the fake "wisp of moisture vapour gently rises from the soil surface" ambient motion the
 * b-roll enhancer invents — ordinary surfaces don't visibly steam, and it bakes fake
 * vapour into the still keyframe. Two shapes are handled: a standalone sentence whose subject IS
 * the wisp (removed whole) and a trailing "as/while/with … wisp …" subordinate clause (only the
 * clause is cut, the real main clause stays). Conservative by design — see the marker regexes.
 * Pure — exported for unit testing.
 *
 * ponytail: heuristic keys on the wisp leading its sentence / a connector clause — the shapes the
 * enhancer actually emits; the prompt-template ban is the primary defense, this is the safety net.
 */
export function stripAtmosphericWisps(text: string): string {
  const leadsWithWisp =
    /^(?:(?:a|an|one|the)\s+)?(?:(?:single|thin|faint|tiny|soft|slight|gentle|small|cool|earthy|warm|nearly|barely|invisible|imperceptible|visible)\s+)*(?:wisps?|plumes?|trails?|threads?|tendrils?|curls?|veils?|hazes?|(?:moisture|heat|earthy|water|cool)\s+(?:vapou?rs?|steam)|vapou?rs?|steam|mist)\b/i;

  const out = text
    .split(/(?<=[.!?])\s+/)
    .filter(s => !(leadsWithWisp.test(s.trim()) && isAtmosphericWisp(s)))
    .join(" ")
    // Trim an embedded/trailing "as|while|with|and <haze> …" clause up to sentence end. The haze
    // noun must sit within ~3 words of the connector so an earlier "while <real clause>" is kept.
    .replace(
      /[\s,;—-]+\b(?:as|while|with|and)\b\s+(?:(?:a|an|one|the|thin|single|faint|tiny|soft|slight|gentle|small|of|cool|earthy|heat|moisture|water)\s+){0,3}(?:wisps?|plumes?|trails?|tendrils?|threads?|curls?|veils?|hazes?|vapou?rs?|steam|mist)\b[^.!?]*(?=[.!?]|$)/gi,
      ""
    );

  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;!?])/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .trim();
}

/**
 * Strip the image-generator syntax the b-roll enhancer hallucinates onto its rewrite — Midjourney
 * flags (`--ar 16:9 --style raw --v 5.2`), `/imagine prompt:` prefixes, `<lora:…>`/`<div…>` tags,
 * `(token:1.2)` attention weights, markdown fences, and trailing `Look:`/`Style:`/`Negative
 * prompt:` label lines. None of it means anything to gpt-image-2 or grok; it just burns prompt
 * budget and occasionally leaks into the render. Pure — exported for unit testing.
 *
 * Applied at the enhancer's adoption sites (so the stored prompt is clean) AND inside
 * `softenVisualPrompt` (so every render path is clean even when adoption was skipped). Idempotent.
 *
 * ponytail: regex scrub, not a stricter enhancer prompt — the model emits these tails despite
 * the instruction, and the scrub is cheaper than another retry round.
 */
export function stripPromptArtifacts(text: string): string {
  return (
    stripMarkdownFences(text ?? "")
      .replace(/`+/g, "")
      .replace(/^\s*\/?imagine\s+prompt\s*:\s*/i, "")
      .replace(/<[^>\n]{0,120}>/g, " ")
      .replace(/\s--[a-z]+(?:\s+[\w.:,]+)?/gi, " ")
      .replace(/\(([^()]{1,80}?):\s*\d(?:\.\d+)?\)/g, "$1")
      // Label lines, with or without markdown emphasis: "Look:", "**Visual style:**", "Camera: …".
      .replace(
        /^[*_#\s]*(?:visual\s+)?(?:look|style|lighting|camera|negative prompt|parameters?|aspect ratio)[*_\s]*:.*$/gim,
        ""
      )
      .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;!?])/g, "$1")
      .replace(/([.,;:])[\s]*\1+/g, "$1")
      .replace(/^[ \t]+$/gm, "")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

/**
 * Soften a script-derived visual prompt so the 69labs (Grok) text-to-video/image content
 * filter stops flagging benign pest-control b-roll as restricted, and strip the enhancer's
 * invented soil-vapour haze. Non-destructive: only the generation prompt is rewritten — the
 * stored `scene.visualPrompt` is left untouched. Pure.
 *
 * Also runs `stripPromptArtifacts` FIRST — this is the one choke point every b-roll prompt
 * crosses on its way to a provider (`buildStillPrompt`, the split composite, `buildClipChain`,
 * the escalation ladder, `aggressiveSoftenVisualPrompt`), so scrubbing here covers the paths
 * that never touch the enhancer's adoption sites: an enhancer failure that keeps the original,
 * a non-verbatim operator override, and an `enforceHostSplitMix` seed. Before softening, so a
 * fence or label line can't survive into `stripAtmosphericWisps`'s sentence handling or become
 * `aggressiveSoftenVisualPrompt`'s "first sentence".
 */
export function softenVisualPrompt(text: string): string {
  const softened = CONTENT_SOFTENING_MAP.reduce(
    (s, [re, rep]) => s.replace(re, rep),
    stripPromptArtifacts(text)
  );
  return stripAtmosphericWisps(softened);
}

/**
 * Stronger softening for the b-roll RETRY clip after a content-policy block: apply the same
 * CONTENT_SOFTENING_MAP, then SHORTEN to the first sentence — "start with a shorter prompt" is
 * 69labs' own recovery advice. The caller also drops the people suffix on this variant ("use
 * fewer people"), so a long, noisy, person-heavy prompt collapses to a short, clean hero shot.
 * Pure — exported for unit testing.
 */
export function aggressiveSoftenVisualPrompt(text: string): string {
  const softened = softenVisualPrompt(text).trim();
  const firstSentence = softened.split(/(?<=[.!?])\s+/)[0] ?? softened;
  return firstSentence.slice(0, 200).trim();
}

/**
 * Last-resort visual when every scene-derived prompt variant is content-policy blocked:
 * a deterministic, guaranteed-safe on-niche shot so the scene still gets a clip instead of
 * killing the whole assembly. The operator can regenerate with a custom prompt afterwards.
 */
export const GENERIC_SAFE_VISUAL =
  "A quiet backyard vegetable garden with raised wooden beds and healthy green plants in soft morning light, no people";

/**
 * Subject-anchored variant of `GENERIC_SAFE_VISUAL`: a deterministic, policy-safe scene that
 * still names the video's topic, so a blocked scene degrades to an on-topic filler shot before
 * the topic-free last resort. The subject is run through `aggressiveSoftenVisualPrompt` (same
 * softening map as the retry ladder). Empty subject → the plain generic.
 * Pure — exported for unit testing.
 */
export function genericSafeVisualFor(subject?: string): string {
  const s = subject ? aggressiveSoftenVisualPrompt(subject) : "";
  return s
    ? `A quiet, tidy real-world setting associated with ${s}, everyday objects arranged and at rest on a plain surface, no people`
    : GENERIC_SAFE_VISUAL;
}

const POLICY_SAFE_REWRITE_SYSTEM =
  "You rewrite an image/video generation prompt that was blocked by a provider's content " +
  "safety filter into a version that will pass, while keeping the scene's general subject. " +
  "Remove every proper name, celebrity, or brand name; remove ALL age references (child, " +
  "teen, elderly, ages); remove violence, harm, weapon, chemical, pesticide, disease, and " +
  "decay wording. The shot has NO people in it — no face, head, or body; include a pair of " +
  "bare hands only if a manual action is essential. " +
  "Reply with ONE simple descriptive sentence and nothing else.";

/**
 * Tier-3 recovery for a content-policy block: ask Claude for a policy-safe rewrite of the
 * scene's visual that keeps the subject. Returns null on any failure (LLM error, empty
 * reply) so callers fall straight through to `GENERIC_SAFE_VISUAL` — never throws.
 */
export async function rewritePolicySafeVisual(
  visualPrompt: string,
  subject?: string
): Promise<string | null> {
  const s = subject?.trim();
  try {
    const result = await invokeClaude({
      systemPrompt: POLICY_SAFE_REWRITE_SYSTEM,
      userMessage:
        `Blocked prompt: ${visualPrompt}\n` +
        (s ? `Keep it recognizably about: ${s}.\n` : "") +
        `\nPolicy-safe rewrite:`,
      maxTokens: 100,
      model: "claude-sonnet-4-6",
    });
    return result.text.trim() || null;
  } catch (err) {
    console.warn(
      "[Longform] policy-safe rewrite failed → falling back to generic visual:",
      err
    );
    return null;
  }
}

/**
 * Full prompt for a STILL-lane image: the script-derived `visualPrompt`, a shot-angle phrase,
 * the hands-only clause when the still depicts a human action (`humanPresent`), the one fixed
 * amateur-iPhone look phrase, and the unconditional `NO_FIGURES_SUFFIX` guard. B-roll never
 * shows a person — no face reference is ever conditioned on the image.
 * No imposed framing/mood/guardrail beyond the `AMATEUR_IPHONE_LOOK` tail.
 * Pure — exported for unit testing.
 */
export function buildStillPrompt(
  scene: StoryboardScene,
  /** Content-policy retry variant: aggressively softened visual, no hands clause. */
  aggressive = false,
  /** Tier-3/4 escalation: replace the scene visual entirely (LLM rewrite or generic). */
  visualOverride?: string,
  /** Whole-video subject (title/script) — fits the look's setting clause to the topic. */
  subject?: string,
  /**
   * Compose 1:1 instead of 16:9 — the split-screen right panel. Load-bearing alongside the
   * square `size` on the request: told "wide 16:9" inside a square canvas, gpt-image-2 composes
   * a letterboxed wide shot in the middle of the frame.
   */
  square = false
): string {
  const angleSuffix =
    scene.shotAngle && SHOT_ANGLE_SUFFIX[scene.shotAngle]
      ? `, ${SHOT_ANGLE_SUFFIX[scene.shotAngle]}`
      : "";
  const personSuffix =
    !aggressive && scene.humanPresent ? ` ${ANON_PERSON_SUFFIX}` : "";
  const visual = visualOverride
    ? softenVisualPrompt(visualOverride)
    : aggressive
      ? aggressiveSoftenVisualPrompt(scene.visualPrompt)
      : softenVisualPrompt(scene.visualPrompt);
  const framing = square
    ? "Square 1:1 framing, the subject centered and filling the square frame."
    : "Wide 16:9 horizontal landscape framing.";
  // An `objectMotion` beat composes the frame mid-motion (STILL_OBJECT_MOTION_CLAUSE) instead of
  // at rest — this function also builds the b-roll KEYFRAME, which is grok's literal first frame,
  // so a settled puddle here would force grok to invent the running water. Dropped on the
  // aggressive content-policy retry alongside the hands clause: the moving element is the likely
  // block, so the retry falls back to the settled base clause.
  const motion = !aggressive && scene.objectMotion ? "objectStill" : "settle";
  return `${visual}${angleSuffix}${personSuffix} ${amateurIphoneLook(subject, motion)} ${framing} ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`;
}

/**
 * Talking-head videos are always landscape, regardless of the UI aspect-ratio
 * toggle. Single source of truth for both the generation request and assembly.
 */
export const TALKING_HEAD_ASPECT_RATIO = "16:9" as const;

/** Default host description used when extraction from the script fails. */
const DEFAULT_HOST_DESCRIPTOR =
  "a man in his early 60s, weathered friendly face, short gray hair, wearing a " +
  "plain, faded casual polo shirt";

/**
 * Restrained, near-motionless seated poses for the talking host. The on-screen host is
 * elderly, so we keep him still — these rotate only subtle, low-motion descriptors (no
 * gestures or leaning) so independent clips vary slightly without injecting body movement.
 */
const TALKING_HEAD_GESTURES = [
  "sitting still and composed",
  "hands resting quietly in his lap",
  "calm and steady, barely moving",
  "still and relaxed as he speaks",
  "a quiet, settled posture",
];

/**
 * Build the fixed per-clip visual prompt for a talking-head scene. The host
 * descriptor + camera cues are identical across every clip (consistency); only
 * the small gesture rotates. The fixed room background is appended later by
 * `buildClipRequest`, so it is NOT included here.
 */
export function talkingHeadVisualPrompt(
  hostDescriptor: string,
  gestureIdx: number
): string {
  const gesture =
    TALKING_HEAD_GESTURES[gestureIdx % TALKING_HEAD_GESTURES.length];
  return (
    `${hostDescriptor}, seated in a chair talking directly to the camera, ` +
    `${gesture}, medium-quality iPhone footage, fixed camera on a desk, ` +
    `natural indoor light, static medium shot from the chest up, ` +
    `16:9 horizontal landscape framing`
  );
}

/** Max run of consecutive non-signal scenes bridged INSIDE one CTA block — keeps a single
 *  pitch contiguous without merging two separate CTA blocks that sit far apart. */
const CTA_MAX_BRIDGE_GAP = 2;

/** Host talking-head beats `ensureHostInCta` guarantees per CTA run — one on-camera beat, so the
 *  host is present without clustering back-to-back talking-head shots (the rest stays b-roll). */
const CTA_HOST_SCENES = 1;

/**
 * The fixed CTA block that appears verbatim (mid-roll + close) in every channel's script. The big
 * centered QR fills the screen from the TRIGGER line through the RELEASE line, then holds a silent
 * frozen tail (`QR_TAIL_HOLD_SEC`); the book-cover reveal plays on the beat right before the
 * trigger. See `markCtaQrBlock`. Matched whitespace/apostrophe-tolerantly (`anchorRegex`).
 */
const CTA_QR_TRIGGER = "Now go ahead and grab your phone";
const CTA_QR_RELEASE = "I'll wait right here.";

/** Silent frozen-frame tail (seconds) the QR holds after the RELEASE line — the host just said
 *  "I'll wait right here" — added to the held scene length in assembly (mux tpad/apad). */
const QR_TAIL_HOLD_SEC = 3;

/** Patterns that flag a scene's verbatim narration as call-to-action content. */
const CTA_SIGNAL_PATTERNS: RegExp[] = [
  // A spoken/written domain like "example.com". Curated TLDs + the no-space
  // requirement before the TLD avoid false hits on prose like "St. Augustine" or "e.g.".
  /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|co|io|shop|store|info|us|club|site|online)\b/i,
  /\bqr[\s-]*code\b/i, // "scan the QR code on screen"
  /\bin the description\b/i, // "the link's in the description below"
  /\$\s?\d/, // a written price like "$17" (spelled-out "dollars" is intentionally NOT a signal)
];

/** True when a scene's narration text reads as call-to-action content. Pure — unit-tested. */
export function ctaSignalInText(text: string): boolean {
  const t = text ?? "";
  return CTA_SIGNAL_PATTERNS.some(re => re.test(t));
}

/**
 * Patterns that flag a VISUAL prompt as a literal depiction of the CTA action (someone
 * scanning a QR/TV, holding a phone or book, a website/URL) rather than on-topic b-roll. A
 * CTA cutaway should show calm on-topic b-roll — the QR card is composited in code, so the
 * image itself must never depict the act of scanning/buying.
 */
const CTA_VISUAL_BANNED_PATTERNS: RegExp[] = [
  /\bqr\b/i,
  /\bscan(?:s|ning|ned)?\b/i,
  /\b(?:smart)?phones?\b/i,
  /\bscreens?\b/i,
  /\b(?:tv|television|monitor|laptop|tablet|computer)s?\b/i,
  /\b(?:e-?)?books?\b/i,
  /\b(?:website|url|browser)s?\b/i,
  /\bhttps?:\/\//i,
  /\bwww\./i,
  /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|co|io|shop|store|info|us|club|site|online)\b/i,
  /\bin the description\b/i,
  /\blink(?:s|ed)?\b/i,
  /\bclick(?:s|ing|ed)?\b/i,
  /\b(?:buy|buys|buying|bought|purchase[ds]?|purchasing|order(?:s|ed|ing)?)\b/i,
  /\bapps?\b/i,
];

/** True when a VISUAL prompt would render literal CTA/sales imagery. Pure — unit-tested. */
export function ctaVisualIsLiteral(text: string): boolean {
  const t = text ?? "";
  return CTA_VISUAL_BANNED_PATTERNS.some(re => re.test(t));
}

/**
 * Print cues that mark an ambiguous noun as a physical printed object rather than an adjective:
 * "an OPEN manual" is a book; "MANUAL watering" is a way of watering.
 */
const PRINT_CUE =
  "open|opened|printed|dog-?eared|folded|laminated|glossy|tattered|" +
  "well-thumbed|hardback|paperback|stapled|spiral-bound";

/** Nouns that are printed matter only in a print context — bare, they are ordinary garden words. */
const AMBIGUOUS_PRINT_NOUN =
  "manuals?|guides?|blueprints?|leaflets?|pages?|chapters?|recipes?|" +
  "instructions?|atlas(?:es)?";

/**
 * Up to 2 intervening words, none of them a preposition — a preposition starts a NEW noun
 * phrase, so "an OPEN bag of soil beside the MANUAL pump" must not read as an open manual.
 */
const CUE_GAP =
  "(?:\\s+(?!on|in|of|with|beside|near|by|at|to|from|over|under|and|behind|" +
  "against|onto|into)[\\w'’-]+){0,2}\\s+";

/**
 * Printed-matter nouns whose POSITIVE mention in a b-roll prompt beats the trailing
 * `NO_BOOK_SUFFIX` negation (generation models handle negation poorly). Two tiers: unambiguous
 * nouns always fire; horticulturally ambiguous ones ("manual", "guide", "leaflet", "atlas")
 * fire ONLY next to a `PRINT_CUE`, so "manual watering" and "a planting guide sign" stay legit
 * garden b-roll while "an open manual" does not.
 *
 * ponytail: a regex heuristic, not a parser — a book described with no cue word ("a manual
 * resting beside the trowel") still slips through, and nothing downstream catches it: this fires
 * on the PROMPT, and no check looks at the rendered frame. The upgrade path is a vision check on
 * the render, which is a real cost per scene — only worth it if review shows books shipping.
 */
const BOOK_VISUAL_PATTERNS: RegExp[] = [
  // Unambiguous printed matter.
  /\b\w*books?\b/i, // any -book compound: book, e-book, guidebook, handbook, notebook, textbook, playbook, cookbook, logbook (not "booking")
  /\bbooklets?\b/i,
  /\bmagazines?\b/i,
  /\bpublications?\b/i,
  /\bpaperbacks?\b/i,
  /\bhardcovers?\b/i,
  /\balmanacs?\b/i,
  /\bjournals?\b/i,
  /\bpamphlets?\b/i,
  /\bbrochures?\b/i,
  /\bcatalog(?:ue)?s?\b/i,
  /\bencycloped(?:ia|ias|ic)\b/i,
  /\bfield\s+guides?\b/i,
  /\bdiar(?:y|ies)\b/i,
  /\bmanuscripts?\b/i,
  /\bhandouts?\b/i,
  /\bprintouts?\b/i,
  // Handling print: "leafing/flipping/thumbing/paging/riffling through …". The verb must be
  // INFLECTED, so the bare nouns stay legit ("presses his thumb through the compost").
  /\b(?:leaf|flip|thumb|pag|riffl)\w*(?:s|ing|ed)\s+through\b/i,
  // Cue-gated: ambiguous nouns count only with a print cue immediately adjacent.
  new RegExp(
    `\\b(?:${PRINT_CUE})\\b${CUE_GAP}\\b(?:${AMBIGUOUS_PRINT_NOUN})\\b`,
    "i"
  ),
  new RegExp(
    `\\b(?:${AMBIGUOUS_PRINT_NOUN})\\b${CUE_GAP}\\b(?:${PRINT_CUE})\\b`,
    "i"
  ),
];

/** True when a b-roll VISUAL prompt would render a book/printed publication. Pure — unit-tested. */
export function brollDepictsBook(text: string): boolean {
  const t = text ?? "";
  return BOOK_VISUAL_PATTERNS.some(re => re.test(t));
}

/** Calm, generic topic-neutral cutaway subjects — used only when a CTA cutaway has no
 *  on-topic neighbor to borrow from. */
const GENERIC_CTA_BROLL: string[] = [
  "a clean, tidy home surface in soft, even daylight",
  "a simple unbranded product resting on a wooden table",
  "an everyday hand-tool laid out neatly on a work surface",
  "a pair of weathered older hands resting on a table",
  "a calm, uncluttered corner of a lived-in home",
];

/**
 * Deterministic, on-topic fallback for a CTA cutaway's visual: reuse the subject of the
 * nearest non-CTA, non-host scene (the real subject this video discusses); if
 * the video has no such cutaway, fall back to the generic pool, varied by index. Pure —
 * unit-tested.
 */
export function genericCtaBrollFor(
  scenes: StoryboardScene[],
  i: number
): string {
  for (let d = 1; d < scenes.length; d++) {
    for (const j of [i - d, i + d]) {
      const s = scenes[j];
      if (!s || s.cta || s.hostPresent) continue;
      const subject = s.visualPrompt ?? s.brollVisual;
      if (subject && !ctaVisualIsLiteral(subject) && !brollDepictsBook(subject))
        return subject;
    }
  }
  return GENERIC_CTA_BROLL[i % GENERIC_CTA_BROLL.length];
}

/**
 * Keyword guard for CTA cutaways: keep `candidate` if it is non-empty and not literal CTA
 * imagery, otherwise swap in an on-topic generic. Pure — unit-tested.
 */
export function sanitizeCtaCutaway(
  candidate: string | undefined,
  scenes: StoryboardScene[],
  i: number
): string {
  const c = candidate?.trim() ?? "";
  return c && !ctaVisualIsLiteral(c) && !brollDepictsBook(c)
    ? c
    : genericCtaBrollFor(scenes, i);
}

/**
 * Deterministic CTA safety net, run right after `parseStoryboard`. Flags scenes whose
 * narration is a call-to-action — by Claude's own "cta" flag OR by content signal (a URL,
 * "qr code", "in the description", a price) — by setting `cta=true`. That flag drives CTA
 * *visual* handling (generic cutaways, empty host hands, the `ensureHostInCta` host guarantee)
 * and the fallback cover-reveal placement; it does NOT drive the QR overlay (that keys off
 * `qrHero`/`qrCorner`) and does NOT force the host. CTA scenes keep whatever register the
 * pipeline assigned, so a pitch alternates host/still/motion like the rest of the video. Short
 * gaps (<= CTA_MAX_BRIDGE_GAP non-signal scenes) BETWEEN two CTA scenes are bridged so the span
 * stays contiguous over one pitch, WITHOUT merging two separate CTA blocks placed far apart
 * (e.g. a mid-roll and a closing pitch). Mutates in place and returns the array. Pure — unit-tested.
 */
export function markCtaScenes(scenes: StoryboardScene[]): StoryboardScene[] {
  // Seeds: Claude-marked CTA scenes plus any scene carrying a content signal.
  const seed = scenes.map(
    s => s.cta === true || ctaSignalInText(s.scriptText ?? s.narration ?? "")
  );

  // Bridge short interior gaps between seeds (within one block, never across blocks).
  const isCta = seed.slice();
  let prev = -1;
  for (let i = 0; i < scenes.length; i++) {
    if (!seed[i]) continue;
    const gap = i - prev - 1;
    if (prev >= 0 && gap > 0 && gap <= CTA_MAX_BRIDGE_GAP) {
      for (let j = prev + 1; j < i; j++) isCta[j] = true;
    }
    prev = i;
  }

  // Flag the CTA span only — the `cta` flag's sole job is to drive the QR overlay (composited
  // in assembly for every cta scene, regardless of register). Registers are left exactly as
  // Claude/the pipeline assigned them, so a CTA pitch alternates host/still/motion like the
  // rest of the video while the QR card stays on screen across the whole pitch.
  scenes.forEach((scene, i) => {
    if (!isCta[i]) return;
    scene.cta = true;
  });

  return scenes;
}

/**
 * Marker-driven replacement for `markCtaScenes`: flag exactly the scenes inside the
 * `===START CTA=== / ===END CTA===` word-offset spans (`parseCtaMarkers`) as `cta:true` and
 * everything else `cta:false` — the markers are ground truth, so Claude's storyboard flags and
 * the content-signal heuristics are overridden in BOTH directions (a "$2 pantry powder" price
 * outside a span can no longer flag a scene). A span boundary landing mid-scene splits the
 * scene at that word (`splitSceneAtOffset`) so the CTA block starts/ends exactly on the
 * markers. Scene `scriptText` slices are verbatim and ordered, so cumulative word counting
 * maps each scene to its `[startWord, endWord)` range. Renumbers indices after splices.
 * Mutates in place and returns it. Pure — unit-tested.
 */
export function markCtaFromSpans(
  scenes: StoryboardScene[],
  spans: CtaSpan[]
): StoryboardScene[] {
  if (!spans.length) return scenes;
  const boundaries = spans.flatMap(sp => [sp.start, sp.end]);
  let ws = 0; // running word offset of scenes[i]'s first word
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const text = s.scriptText ?? s.narration ?? "";
    const we = ws + text.split(/\s+/).filter(Boolean).length;
    // Split at the first span boundary strictly inside this scene, then reprocess the head
    // (which now contains no interior boundary; the tail is handled on a later iteration).
    const boundary = boundaries.find(b => b > ws && b < we);
    if (boundary != null && s.scriptText) {
      let offset = -1;
      let count = 0;
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s.scriptText)) !== null) {
        if (count === boundary - ws) {
          offset = m.index;
          break;
        }
        count++;
      }
      if (offset > 0) {
        const [head, tail] = splitSceneAtOffset(s, offset);
        scenes.splice(i, 1, head, tail);
        i--; // reprocess the head with the same ws
        continue;
      }
    }
    s.cta = spans.some(sp => ws >= sp.start && we <= sp.end && we > ws);
    ws = we;
  }
  scenes.forEach((s, i) => (s.index = i + 1));
  return scenes;
}

/** How many scenes right before each cover reveal carry the LARGE CENTERED QR. */
export const QR_SCENES_BEFORE_COVER = 2;

/**
 * Put the LARGE CENTERED QR on the `QR_SCENES_BEFORE_COVER` scenes immediately BEFORE each
 * book-cover reveal, so every pitch shows the big QR (across two beats of real narration for a
 * generous scan window) and then lands on the cover. Runs AFTER `markCoverReveal` (which sets
 * `coverHero`). Converts each preceding scene into a big-QR beat: sets `qrHero` (routes to the
 * centered overlay in assembly, and exempts the scene from the over-long split / short-scene merge /
 * on-screen floor / `ensureHostInCta` host quota); also sets `cta` for CTA visual handling (the
 * QR overlay itself keys off `qrHero` in the `qrOverlayUrl` assembly gate). Flips
 * each to a person-free still so the centered QR doesn't cover a face, but KEEPS its own verbatim
 * script narration (no text added or changed). Walks back up to `QR_SCENES_BEFORE_COVER` scenes
 * regardless of their prior cta status — stops only at the array start, a prior QR beat, or another
 * cover beat — so a reveal at the very start of the video gets none and back-to-back reveals don't
 * double-claim. No-op without a channel QR (`qrImageUrl` unset). The `prev.qrHero` guard keeps it
 * idempotent. Mutates in place and returns it. Pure — unit-tested.
 */
export function markQrBeforeCover(
  scenes: StoryboardScene[],
  params: LongformInputParams
): StoryboardScene[] {
  if (!params.qrImageUrl) return scenes;
  const toQr = (s: StoryboardScene) => {
    s.qrHero = true;
    s.cta = true; // big-QR overlay only draws on cta scenes (assembly gate) — force it
    s.stillImage = true;
    s.hostPresent = false;
    s.splitVisual = undefined;
  };
  for (let i = 0; i < scenes.length; i++) {
    if (!scenes[i].coverHero) continue;
    for (let k = 1; k <= QR_SCENES_BEFORE_COVER; k++) {
      const prev = scenes[i - k];
      if (!prev || prev.qrHero || prev.coverHero) break;
      toQr(prev);
    }
  }
  return scenes;
}

/** How many scenes right before each cover reveal carry the SMALL corner QR when the script has
 *  NO ===CTA=== markers (legacy scripts, fuzzy `markCtaScenes` flags — the fixed window can't ride
 *  them). With markers the window is the marked pitch itself, not this constant. */
export const CORNER_QR_SCENES_BEFORE_COVER = 6;

/**
 * Put the SMALL bottom-right QR on the book pitch — the scan window that leads into the cover +
 * big-QR block. `ctaScoped` (script had explicit ===CTA=== markers, so `cta` flags are ground
 * truth): EVERY marked pitch beat carries it, minus the beats that own a bigger treatment
 * (`qrHero`'s centered QR, the clean `coverHero`). So the QR appears exactly at ===START CTA===,
 * never leaks onto a pre-marker scene (staging job 204 had both failures), and does not blink off
 * for the rest of the pitch when the cover reveal lands mid-block on the title mention
 * (`coverBeatFor`). Un-scoped (legacy no-marker script): the fixed
 * `CORNER_QR_SCENES_BEFORE_COVER` lookback walked back from each `coverHero`, since fuzzy cta flags
 * can't be trusted; it stops at the array start, a `qrHero` beat, or another cover beat (so a
 * mid-roll and close don't bleed into each other). Unlike `markQrBeforeCover` / `markCtaQrBlock` it
 * does NOT change register (a corner card never covers a centered face), so scenes keep their
 * host/still/motion. No-op without a channel QR. Runs AFTER `markCtaQrBlock` (which sets
 * `coverHero`). Mutates in place; returns it. Pure — unit-tested.
 */
export function markCornerQrBeforeCover(
  scenes: StoryboardScene[],
  params: LongformInputParams,
  ctaScoped = false
): StoryboardScene[] {
  if (!params.qrImageUrl) return scenes;
  if (ctaScoped) {
    for (const s of scenes) {
      if (s.cta && !s.qrHero && !s.coverHero) s.qrCorner = true;
    }
    return scenes;
  }
  for (let i = 0; i < scenes.length; i++) {
    if (!scenes[i].coverHero) continue;
    for (let k = 1; k <= CORNER_QR_SCENES_BEFORE_COVER; k++) {
      const prev = scenes[i - k];
      if (!prev || prev.qrHero || prev.coverHero) break;
      prev.qrCorner = true;
    }
  }
  return scenes;
}

/**
 * The channel QR to composite on a scene, or undefined for none. Draws ONLY on anchored beats —
 * the big-QR "grab your phone" block (`qrHero`) and the small pre-cover scan window (`qrCorner`) —
 * never on the cover-reveal beat, and never on ordinary cta/price scenes, so a spoken dollar amount
 * can't surface it. No-op without a channel QR. Pure — unit-tested.
 */
export function qrOverlayUrlFor(
  scene: Pick<StoryboardScene, "qrHero" | "qrCorner" | "coverHero">,
  qrImageUrl: string | undefined
): string | undefined {
  return (scene.qrHero || scene.qrCorner) && !scene.coverHero && qrImageUrl
    ? qrImageUrl
    : undefined;
}

/**
 * Which scenes carry the host's lower third: the LOCKED cold open (`hostOpener`) — scene 1, plus
 * scene 2 when the channel has an alt host photo — so the card introduces the host across the whole
 * two-angle opening the way a broadcast lower third does, held continuously over the cut rather
 * than blinking out and back in. Falls back to the first host shot when no opener survived, and
 * `[]` when there are no host shots at all (no card).
 *
 * Takes positions in the ASSEMBLED scene list (the filtered `ready` array), not
 * `StoryboardScene.index` — a scene dropped for a missing clip therefore shifts the card onto the
 * next surviving host shot instead of onto nothing, and a dropped opener shortens the run rather
 * than splitting it. Pure — unit-tested.
 */
export function nameCardSceneIndices(
  scenes: Pick<StoryboardScene, "hostPresent" | "hostOpener">[]
): number[] {
  // Only a LEADING run counts: a gap would mean the card pops back on after an unrelated cutaway.
  const run: number[] = [];
  for (let i = 0; i < scenes.length && scenes[i].hostOpener; i++) {
    if (scenes[i].hostPresent) run.push(i);
  }
  if (run.length > 0) return run;
  const first = scenes.findIndex(s => s.hostPresent);
  return first >= 0 ? [first] : [];
}

/**
 * True when `text` names the book — i.e. it contains at least a majority (min 1) of the title's
 * distinctive tokens (`getBookNameTokens` already drops stop words / short words). Word-boundary
 * matched so "art" doesn't fire inside "started". Pure — unit-tested.
 */
export function mentionsTitle(text: string, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const hay = (text ?? "").toLowerCase();
  const hits = tokens.filter(t =>
    new RegExp(`\\b${t}\\b`, "i").test(hay)
  ).length;
  return hits >= Math.max(1, Math.ceil(tokens.length / 2));
}

/**
 * Test for one title token, tolerant of how a host actually says it: a number matches its spoken
 * form too ("$9,000" ⇄ "nine thousand", "101" ⇄ "one hundred one" — the script almost never speaks
 * digits), and every other word matches its singular/plural twin ("secrets" ⇄ "secret").
 */
function tokenTest(token: string): (hay: string) => boolean {
  const word = (w: string) => new RegExp(`\\b${w}\\b`, "i");
  if (/^\d+$/.test(token)) {
    const spoken = numberWords(Number(token)).map(word);
    return hay => word(token).test(hay) || spoken.every(re => re.test(hay));
  }
  const stem = new RegExp(`\\b${token.replace(/(es|s)$/, "")}(e?s)?\\b`, "i");
  return hay => stem.test(hay);
}

/**
 * Predicate for "this line names the book", tolerant of the ways a script drifts from the
 * configured title: the host speaks only the MAIN title ("called The Texas BBQ Bible" while the
 * config carries the subtitle too), paraphrases it ("Save Nine Thousand Dollars a Year" / "$9,000"),
 * or swaps/drops one word of it ("the Texas Barbecue Bible", "it's in the Whitetail Bible").
 * So a line matches when it contains all-but-one distinctive token of the main title (the part
 * before the first colon — 2+ must still land, else one common word would fire everywhere), OR a
 * majority of the full title's tokens (the `mentionsTitle` rule, over the same tolerant tests).
 * Strictly more permissive than `mentionsTitle` alone.
 * Returns a never-matching predicate without a title. Pure — unit-tested.
 */
export function titleMatcher(
  bookTitle: string | undefined
): (text: string) => boolean {
  const full = bookTitle ? getBookNameTokens(bookTitle) : [];
  if (!full.length) return () => false;
  const mainSet = new Set(getBookNameTokens(bookTitle!.split(":")[0]));
  const tests = full.map(t => ({ main: mainSet.has(t), fn: tokenTest(t) }));
  const main = tests.filter(t => t.main);
  return text => {
    const hay = (text ?? "").toLowerCase();
    const mainHits = main.filter(t => t.fn(hay)).length;
    if (main.length >= 2 && mainHits >= Math.max(2, main.length - 1)) {
      return true;
    }
    const hits = tests.filter(t => t.fn(hay)).length;
    return hits >= Math.max(1, Math.ceil(full.length / 2));
  };
}

/**
 * Mark the book-cover reveal beat: inside EACH contiguous CTA run, flip the first scene that
 * names the book (`titleMatcher`) into a full-frame cover still — `coverHero: true`,
 * `stillImage: true`, `hostPresent: false`, no split — keeping its own narration (which speaks the
 * title) so the cover lands exactly as the host names it. No-op without both a cover image and a
 * resolvable title, or when a run never names the book. The QR-hero beat (no title in its line) is
 * skipped naturally. Idempotent via the `!s.coverHero` guard. Mutates in place; returns it. Pure —
 * unit-tested.
 */
export function markCoverReveal(
  scenes: StoryboardScene[],
  params: LongformInputParams
): StoryboardScene[] {
  if (!params.bookCoverImageUrl || !params.bookTitle) return scenes;
  const namesBook = titleMatcher(params.bookTitle);
  let i = 0;
  while (i < scenes.length) {
    if (scenes[i].cta !== true) {
      i++;
      continue;
    }
    // [i, j) is one contiguous CTA run; reveal at the first title mention within it.
    let j = i;
    while (j < scenes.length && scenes[j].cta === true) j++;
    for (let k = i; k < j; k++) {
      const s = scenes[k];
      if (s.coverHero) break; // already marked (idempotent)
      if (namesBook(s.scriptText ?? s.narration ?? "")) {
        s.coverHero = true;
        s.stillImage = true;
        s.hostPresent = false;
        s.splitVisual = undefined;
        break;
      }
    }
    i = j;
  }
  return scenes;
}

/**
 * The beat that carries the cover reveal for a QR block starting at `qrStart`: the FIRST scene in
 * the contiguous pitch run before it that NAMES the book (`titleMatcher`), so the cover lands as
 * the host speaks the title instead of over an unrelated later line. Falls back to the beat right
 * before the block — the original placement — when the pitch never names the book or no title
 * resolved, so no script regresses. Skips beats already claimed by a QR/cover block and stops the
 * walk-back at a previous block, so a mid-roll and a close don't cross-claim. Pure — unit-tested.
 */
export function coverBeatFor(
  scenes: StoryboardScene[],
  qrStart: number,
  params: LongformInputParams
): StoryboardScene | undefined {
  if (qrStart < 1) return undefined; // block opens the video — nothing precedes it
  const fallback = scenes[qrStart - 1];
  const namesBook = titleMatcher(params.bookTitle);
  let start = qrStart - 1;
  while (start > 0) {
    const prev = scenes[start - 1];
    if (!prev.cta || prev.qrHero || prev.coverHero) break;
    start--;
  }
  for (let k = start; k < qrStart; k++) {
    const s = scenes[k];
    if (s.qrHero || s.coverHero) continue;
    if (namesBook(s.scriptText ?? s.narration ?? "")) return s;
  }
  return fallback;
}

/**
 * Whitespace/apostrophe-tolerant matcher for a fixed anchor phrase: the phrase's own runs of
 * whitespace match `\s+` and its apostrophe matches any of `' ' '`, so a channel script with
 * reflowed spacing or a curly quote still anchors. Case-sensitive (the anchors are fixed English).
 * Pure — unit-tested.
 */
export function anchorRegex(phrase: string): RegExp {
  const src = phrase
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex metacharacters
    .replace(/['‘’]/g, "['\\u2018\\u2019]") // any apostrophe variant
    .replace(/\s+/g, "\\s+"); // flexible whitespace
  return new RegExp(src);
}

/** Split one (unvoiced) scene's verbatim `scriptText` at a raw offset into [before, after],
 *  each keeping the parent's visual/register (the caller re-flags them). Pure. */
function splitSceneAtOffset(
  s: StoryboardScene,
  offset: number
): [StoryboardScene, StoryboardScene] {
  const raw = s.scriptText ?? "";
  const before = raw.slice(0, offset).trim();
  const after = raw.slice(offset).trim();
  return [
    { ...s, scriptText: before, narration: firstWords(before, 8) },
    { ...s, scriptText: after, narration: firstWords(after, 8) },
  ];
}

/**
 * Re-join a fixed anchor phrase that greedy segmentation split across a scene boundary — its head
 * trails scene N, its tail opens scene N+1, so neither scene alone contains the whole phrase and the
 * per-scene `anchorRegex` test misses it (this is how a mid-roll CTA silently loses its QR block).
 * Walks adjacent pairs; when the phrase straddles the boundary (matches the concatenation, starting
 * inside scene N's text), moves scene N's trailing head fragment down onto the front of scene N+1 so
 * the phrase sits contiguously in one scene and the normal single-scene anchoring runs. Only acts on
 * a genuine cross-boundary split (skips a phrase already whole in one scene, or one that begins in
 * N+1). If the fragment consumes all of scene N, folds N entirely into N+1. Mutates `scriptText` /
 * `narration` in place; returns the scenes. Pure — unit-tested.
 */
function joinSplitAnchor(
  scenes: StoryboardScene[],
  phrase: string
): StoryboardScene[] {
  const re = anchorRegex(phrase);
  const textOf = (s: StoryboardScene) => s.scriptText ?? s.narration ?? "";
  for (let i = 0; i + 1 < scenes.length; i++) {
    const head = textOf(scenes[i]);
    if (re.test(head)) continue; // already whole in this scene
    const m = `${head} ${textOf(scenes[i + 1])}`.match(re);
    if (!m || m.index === undefined || m.index >= head.length) continue; // starts in N+1 (or absent)
    const moved = head.slice(m.index).trim();
    const newHead = head.slice(0, m.index).trim();
    const newNext = `${moved} ${textOf(scenes[i + 1])}`.trim();
    if (!newHead) {
      // Scene N was entirely the phrase head → fold it wholly into N+1.
      scenes[i + 1].scriptText = newNext;
      scenes[i + 1].narration = firstWords(newNext, 8);
      scenes.splice(i, 1);
      i--;
      continue;
    }
    scenes[i].scriptText = newHead;
    scenes[i].narration = firstWords(newHead, 8);
    scenes[i + 1].scriptText = newNext;
    scenes[i + 1].narration = firstWords(newNext, 8);
  }
  return scenes;
}

/**
 * Anchor the big centered QR + book-cover reveal to the fixed CTA block (`CTA_QR_TRIGGER` …
 * `CTA_QR_RELEASE`), which appears verbatim in every channel's script (twice: mid-roll + close).
 * For EACH occurrence: the scenes from the trigger line through the release line become big-QR
 * beats (`qrHero` — person-free stills with the centered overlay across the whole window), the
 * release beat is flagged `qrTail` so it holds a silent frozen `QR_TAIL_HOLD_SEC` tail in assembly,
 * and the first beat of the pitch that NAMES the book becomes the full-frame cover reveal
 * (`coverHero` — see `coverBeatFor`; falls back to the beat right before the trigger). The
 * trigger scene is split so the QR starts EXACTLY on "Now go ahead…" when greedy segmentation had
 * packed a preceding sentence into its chunk; likewise the release scene is split off any trailing
 * text. A `joinSplitAnchor` pre-pass first re-stitches any trigger/release phrase segmentation broke
 * across a scene boundary, so a mid-roll block whose "…grab your phone" landed in the next chunk
 * still anchors. No-op without a channel QR (`qrImageUrl`); when the block is absent entirely, falls
 * back to the legacy title-mention placement (`markCoverReveal` → `markQrBeforeCover`) so no script
 * regresses. Idempotent (the `!qrHero` scan skips already-marked blocks). Mutates in place
 * (splicing the splits) and returns it. Pure — unit-tested.
 */
/** Words of QR guidance at the tail of a CTA block (script OS STEP 8.5 fixes it at ~90). */
const QR_GUIDANCE_WORDS = 90;

/**
 * QR placement for marked scripts whose CTA blocks don't carry the verbatim `CTA_QR_TRIGGER`
 * line — e.g. a script OS that rotates the QR wording instead of freezing it. The guidance is
 * always the TAIL of the block, so take the last ~QR_GUIDANCE_WORDS of each contiguous `cta` run
 * and reveal the cover on the beat before it. Only reachable with explicit markers, so the
 * anchored v5 path is untouched.
 * ponytail: word-count tail, not a parse of the guidance itself. If the estimate ever drifts,
 * add a `===START QR===` sub-marker to the script contract and split on that instead.
 */
function markQrFromCtaTails(
  scenes: StoryboardScene[],
  params: LongformInputParams
): StoryboardScene[] {
  const words = (s: StoryboardScene) =>
    (s.scriptText ?? s.narration ?? "").split(/\s+/).filter(Boolean).length;

  for (let end = scenes.length - 1; end >= 0; end--) {
    if (!scenes[end].cta) continue;

    // Walk back inside this run while the guidance block's word budget still fits, so a long
    // sell beat adjacent to short guidance beats stays out of the window.
    let start = end;
    let n = words(scenes[end]);
    while (
      start > 0 &&
      scenes[start - 1].cta &&
      n + words(scenes[start - 1]) <= QR_GUIDANCE_WORDS
    ) {
      start--;
      n += words(scenes[start]);
    }

    for (let k = start; k <= end; k++) {
      const s = scenes[k];
      s.qrHero = true;
      s.stillImage = true;
      s.hostPresent = false;
      s.splitVisual = undefined;
    }
    scenes[end].qrTail = true;

    const cover = coverBeatFor(scenes, start, params);
    if (
      params.bookCoverImageUrl &&
      cover &&
      !cover.qrHero &&
      !cover.coverHero
    ) {
      cover.coverHero = true;
      cover.stillImage = true;
      cover.hostPresent = false;
      cover.splitVisual = undefined;
    }

    // Skip past the head of this run so the next iteration lands on the previous block.
    while (end > 0 && scenes[end - 1].cta) end--;
  }

  scenes.forEach((s, i) => (s.index = i + 1));
  return scenes;
}

export function markCtaQrBlock(
  scenes: StoryboardScene[],
  params: LongformInputParams,
  /** True when explicit ===START/END CTA=== spans set the `cta` flags (`markCtaFromSpans`):
   *  the trigger then only anchors INSIDE a marked block, never on a stray sound-alike line. */
  ctaScoped = false
): StoryboardScene[] {
  if (!params.qrImageUrl) return scenes;
  // Segmentation can split the trigger/release phrase across a scene boundary; re-join it first so
  // the per-scene matcher below sees it whole (else the whole block silently skips — the mid-roll bug).
  joinSplitAnchor(scenes, CTA_QR_TRIGGER);
  joinSplitAnchor(scenes, CTA_QR_RELEASE);
  const triggerRe = anchorRegex(CTA_QR_TRIGGER);
  const releaseRe = anchorRegex(CTA_QR_RELEASE);
  const textOf = (s: StoryboardScene) => s.scriptText ?? s.narration ?? "";
  const inScope = (s: StoryboardScene) => !ctaScoped || s.cta === true;

  // No block in this script → keep the legacy placement so nothing regresses.
  if (!scenes.some(s => inScope(s) && triggerRe.test(textOf(s)))) {
    if (ctaScoped && scenes.some(s => s.cta)) {
      console.warn(
        `[longform] marked CTA block(s) lack the "${CTA_QR_TRIGGER}" line — ` +
          `placing the QR on the tail of each marked block`
      );
      return markQrFromCtaTails(scenes, params);
    }
    return markQrBeforeCover(markCoverReveal(scenes, params), params);
  }

  const toQr = (s: StoryboardScene) => {
    s.qrHero = true;
    s.cta = true; // the centered overlay only draws on cta scenes (assembly gate)
    s.stillImage = true;
    s.hostPresent = false;
    s.splitVisual = undefined;
  };

  // One occurrence per pass; re-scan from scratch so the splices' index shifts don't matter, and
  // the `!qrHero` guard skips a block already marked (so a second call is a no-op).
  for (;;) {
    const ti = scenes.findIndex(
      s => !s.qrHero && inScope(s) && triggerRe.test(textOf(s))
    );
    if (ti < 0) break;

    // Start the QR exactly on the trigger line: if segmentation packed a preceding sentence into
    // this chunk, split so a fresh scene begins at "Now go ahead…".
    let bs = ti;
    const tm = textOf(scenes[ti]).match(triggerRe);
    if (tm && tm.index! > 0 && textOf(scenes[ti]).slice(0, tm.index!).trim()) {
      const [head, tail] = splitSceneAtOffset(scenes[ti], tm.index!);
      scenes.splice(ti, 1, head, tail);
      bs = ti + 1;
    }

    // Release line closes the block; split off any trailing text so the block ends exactly on it.
    let be = -1;
    for (let k = bs; k < scenes.length; k++) {
      const rm = textOf(scenes[k]).match(releaseRe);
      if (!rm) continue;
      const end = rm.index! + rm[0].length;
      if (textOf(scenes[k]).slice(end).trim()) {
        const [head, tail] = splitSceneAtOffset(scenes[k], end);
        scenes.splice(k, 1, head, tail);
      }
      be = k;
      break;
    }
    if (be < 0) break; // trigger with no release (degenerate) — leave the rest as-is.

    for (let k = bs; k <= be; k++) toQr(scenes[k]);
    scenes[be].qrTail = true;

    // Cover reveal on the beat that NAMES the book (falling back to the beat right before the
    // trigger when the pitch never names it). Needs a configured cover image.
    const cover = coverBeatFor(scenes, bs, params);
    if (
      params.bookCoverImageUrl &&
      cover &&
      !cover.qrHero &&
      !cover.coverHero
    ) {
      cover.coverHero = true;
      cover.stillImage = true;
      cover.hostPresent = false;
      cover.splitVisual = undefined;
    }
  }

  scenes.forEach((s, i) => (s.index = i + 1));
  return scenes;
}

/**
 * Prompt for the RunPod InfiniteTalk lip-sync call (HeyGen Avatar IV ignores prompts entirely).
 * Deliberately a FIXED, self-contained directive (`LIPSYNC_HOST_DIRECTION`) — the per-scene
 * `visualPrompt` is NOT prepended: InfiniteTalk degrades on long prompts, identity comes from the
 * reference photo, and the rich storyboard visualPrompt injects gesture/lean/nod motion that
 * contradicts the minimal-motion restriction. The only per-scene variation is the empty-hands
 * clause on CTA scenes. The narration audio drives speech, so no script text is included.
 */
export function buildLipsyncPrompt(scene: StoryboardScene): string {
  const cta = scene.cta ? ` ${CTA_EMPTY_HANDS_SUFFIX}` : "";
  return `${LIPSYNC_HOST_DIRECTION}${cta}`.trim();
}

/**
 * Guarantee the host appears on camera during EACH CTA run. Walk every contiguous CTA span and
 * flip non-hero (`!qrHero`) scenes to talking-head shots until `CTA_HOST_SCENES` are host,
 * counting any already-host scene toward the quota. Runs LAST — after the
 * host-screen-time/split/ratio/adjacency balancers and `enhanceBrollPrompts` — so nothing
 * downstream can demote them back to b-roll before clip generation. Flipped scenes keep their
 * already-voiced narration and `cta` flag (so the empty-hands clause and bottom-right QR still
 * apply). Mutates in place and returns it. Pure — unit-tested.
 */
export function ensureHostInCta(scenes: StoryboardScene[]): StoryboardScene[] {
  // ponytail: flips up to CTA_HOST_SCENES per run; short CTA blocks get fewer, no synthetic scenes
  let i = 0;
  while (i < scenes.length) {
    if (scenes[i].cta !== true) {
      i++;
      continue;
    }
    // [i, j) is one contiguous CTA run.
    let j = i;
    while (j < scenes.length && scenes[j].cta === true) j++;
    const run = scenes.slice(i, j).filter(s => !s.qrHero && !s.coverHero);
    let hosts = run.filter(s => s.hostPresent).length;
    for (const s of run) {
      if (hosts >= CTA_HOST_SCENES) break;
      if (s.hostPresent) continue;
      s.hostPresent = true;
      s.stillImage = false;
      s.splitVisual = undefined;
      s.visualPrompt = talkingHeadVisualPrompt(
        DEFAULT_HOST_DESCRIPTOR,
        s.index
      );
      hosts++;
      // Keep the "no host after host" guarantee: enforceVisualAdjacency already ran and won't
      // re-check, so flipping this CTA beat to host may leave it adjacent to a content host
      // outside the run. The CTA host is the one we must keep, so a host NEIGHBOR yields to a
      // still instead. ponytail: leaves the pair if the only host neighbor is a bookend
      // (index 0 / last) or lacks a brollVisual — the same ceiling enforceVisualAdjacency
      // accepts for unbreakable pairs.
      const idx = scenes.indexOf(s);
      const lastIdx = scenes.length - 1;
      for (const nIdx of [idx - 1, idx + 1]) {
        const n = scenes[nIdx];
        if (n?.hostPresent && nIdx !== 0 && nIdx !== lastIdx && n.brollVisual) {
          demoteHostToStill(n);
        }
      }
    }
    i = j;
  }
  return scenes;
}

/**
 * Build the clip request(s) for a scene. Every b-roll scene (no host on screen) is a single
 * `grok-imagine-video` clip with NO cross-model fallback — if it fails, the scene fails loudly.
 * It is IMAGE-TO-VIDEO: `generateSceneClips` renders a gpt-image-2 keyframe per clip and attaches
 * it as the start frame (grok is not a competent text-to-video model), so the prompt built here
 * is left to drive the motion. B-roll NEVER shows a person at all:
 *   - Plain person-free b-roll: grok, keyframe + prompt, no videoInputMode.
 *   - Hands-at-work b-roll (`humanPresent`): same, bare hands and forearms only
 *     (ANON_PERSON_SUFFIX). No face reference is ever attached on these lanes.
 * HOST scenes (split-screen, talking head) are single-element grok (they lip-sync on
 * HeyGen Avatar IV or fail loudly). `buildClipRequest` returns `chain[0]`. Output is always
 * 16:9 at a fixed clip length. The return type stays an array for back-compat with the
 * `generateSceneClips` chain loop (which now always runs the one element). Pure — exported for
 * unit testing.
 */
export function buildClipChain(
  scene: StoryboardScene,
  params: LongformInputParams
): import("./providers/base").VideoGenerationParams[] {
  type ClipRequest = import("./providers/base").VideoGenerationParams;
  const base = {
    aspectRatio: TALKING_HEAD_ASPECT_RATIO,
    resolution: "720p" as const,
    duration: clipDurationParam(FIXED_CLIP_LEN),
    count: 1,
  };
  // B-roll (no host on screen): grok only, no fallback. Used by plain b-roll and by hands-only
  // b-roll with no face reference (anonymous person either way). The gpt-image-2 keyframe is
  // attached downstream by `generateSceneClips` as the clip's start frame — grok reads a prompt
  // alone poorly — so what's built here is movement direction over that frame. Single-element →
  // a failure fails the scene loudly.
  const brollChain = (visual: string): ClipRequest[] => [
    { ...base, prompt: visual, model: "grok-imagine-video" },
  ];

  const useHost = scene.hostPresent && !!params.faceImageUrl;
  // Book-depicting beat: the real cover is the reference image (takes priority over the face —
  // see plan). Only b-roll uses the keyframe path instead; host/split submit the ref directly.
  const bookRef =
    scene.showsBook && params.bookCoverImageUrl
      ? params.bookCoverImageUrl
      : undefined;

  // Split-screen: host on LEFT half, product/visual on RIGHT half. Single-element (host).
  if (scene.hostPresent && scene.splitVisual) {
    const leftSide = `${scene.visualPrompt} ${TALKING_HEAD_BACKGROUND}`;
    const full =
      `STRICT 50/50 SPLIT-SCREEN 16:9: hard vertical dividing line at the exact horizontal ` +
      `center of the frame. Both halves fully visible from the very first frame — no ` +
      `transition, no sweep, no wipe. ` +
      `LEFT HALF (exactly 50% of frame width): ${leftSide}. ` +
      `RIGHT HALF (exactly 50% of frame width): ${softenVisualPrompt(scene.splitVisual)} — ` +
      `the right half is object/product/setting only: ${NO_PEOPLE_SUFFIX} ` +
      `${scene.cameraCue?.trim() || "shot handheld on a smartphone, natural available light, deep focus, plain realistic color"}. ` +
      `Thin hard visible vertical separator line between both halves. ` +
      `No morphing, no warping, no flickering textures on either side. ` +
      `${NO_OVERLAY_TEXT_SUFFIX} ` +
      ENGLISH_TEXT_ONLY;
    return [
      {
        ...base,
        prompt: useHost ? withFaceLockPrompt(full, "seated") : full,
        model: "grok-imagine-video",
        // Book cover ref wins over the face ref on a showsBook beat (cover-priority).
        imageUrls: bookRef
          ? [bookRef]
          : useHost
            ? [params.faceImageUrl as string]
            : undefined,
        // Any ref (cover or face) → grok ingredients mode; no ref → text-only (mode omitted).
        videoInputMode: bookRef || useHost ? "ingredients" : undefined,
      },
    ];
  }

  // The fixed indoor room background applies to the TALKING host only; b-roll shots are
  // script-only + the one fixed amateur-iPhone look tail. A `humanPresent` cutaway shows bare
  // hands at the task and nothing else of a human (ANON_PERSON_SUFFIX); the channel host photo
  // is never referenced on b-roll, and `NO_FIGURES_SUFFIX` below keeps every cutaway face-free.
  const peopleSuffix =
    !scene.hostPresent && scene.humanPresent ? ` ${ANON_PERSON_SUFFIX}` : "";
  // Shot-angle phrase appended to non-host prompts so camera variety is enforced in code
  // rather than relying on Claude's implicit framing choices.
  const angleSuffix =
    !scene.hostPresent && scene.shotAngle && SHOT_ANGLE_SUFFIX[scene.shotAngle]
      ? `, ${SHOT_ANGLE_SUFFIX[scene.shotAngle]}`
      : "";
  // Non-host b-roll is image-to-video on grok: the gpt-image-2 keyframe fixes what the shot
  // looks like, and this prompt drives it. It is the full softened description + the fixed
  // amateur-iPhone look, whose camera clause holds the frame
  // near-still. Three cutaway lanes, in precedence order: humanPresent →
  // PERSON_MOTION_CAMERA_CLAUSE (the hands make one small, slow task motion continuing the
  // script-derived frame, instead of sitting frozen); objectMotion → OBJECT_MOTION_CAMERA_CLAUSE
  // (locked camera, the subject's OWN motion — water running, a flame burning — carries the
  // clip). There is no third lane: a cutaway with NEITHER flag is forced to a still in
  // `parseStoryboard`, because a clip of nothing moving spends the expensive grok budget on a
  // frame a still renders better. humanPresent wins a tie: its clause already grants a motion and
  // hands carry the higher morph risk. The clause is still generic and fixed; it is the only
  // movement direction grok gets.
  const baseVisual = scene.hostPresent
    ? `${scene.visualPrompt} ${TALKING_HEAD_BACKGROUND}${
        scene.cta ? ` ${CTA_EMPTY_HANDS_SUFFIX}` : ""
      } ${NO_OVERLAY_TEXT_SUFFIX}`
    : `${softenVisualPrompt(scene.visualPrompt)}${angleSuffix}${peopleSuffix} ${amateurIphoneLook(params.videoSubject, brollLookMotion(scene))} ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`;

  // `humanPresent` b-roll carries no ref image HERE — the hands are described by the prompt
  // (ANON_PERSON_SUFFIX + PERSON_MOTION_CAMERA_CLAUSE) and the only image it ever gets is the
  // generated keyframe attached downstream, never the channel face — so it falls through to
  // `brollChain` below.

  // Talking host (seated): grok-imagine-video with face image when available.
  // Face ref → ingredients mode (seated prompt variant keeps him seated/talking); no ref →
  // text-only (mode omitted).
  if (scene.hostPresent) {
    const faceLocked = !!params.faceImageUrl;
    return [
      {
        ...base,
        prompt: faceLocked
          ? withFaceLockPrompt(baseVisual, "seated")
          : baseVisual,
        model: "grok-imagine-video",
        // Book cover ref wins over the face ref on a showsBook beat (cover-priority).
        imageUrls: bookRef
          ? [bookRef]
          : faceLocked
            ? [params.faceImageUrl as string]
            : undefined,
        videoInputMode: bookRef || faceLocked ? "ingredients" : undefined,
      },
    ];
  }

  // Person-free / hands-only b-roll: a two-element grok chain. Element 0 is the normal softened
  // visual; element 1 is a SHORTER, aggressively-softened, person-free retry used ONLY when
  // element 0 is rejected for content policy (advance gated in `generateSceneClips`). 69labs'
  // own recovery advice for a block is "shorter prompt, fewer people" — that is exactly
  // element 1. Both elements are grok: there is NO cross-model (veo) fallback — any non-policy
  // failure fails the scene loudly.
  // Element 1: a shorter, aggressively person-free retry of the same descriptive prompt.
  // The aggressive retry is person-free by construction, so it always takes the base "settle"
  // clause — even on an `objectMotion` scene: a blocked prompt was most likely blocked ON the
  // moving element (fire especially), so the degraded retry must not re-assert it.
  const aggressiveVisual = `${aggressiveSoftenVisualPrompt(
    scene.visualPrompt
  )}${angleSuffix} ${amateurIphoneLook(params.videoSubject, "settle")} ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`;
  // Chain: [grok(normal), grok(aggressive-soft, content-policy retry only)].
  // Single-model — `generateSceneClips` advances 0→1 on a content-policy block and resumes the
  // same model on transient stalls; a terminal failure is a hard fail.
  return [
    ...brollChain(baseVisual),
    { ...base, prompt: aggressiveVisual, model: "grok-imagine-video" },
  ];
}

/**
 * The primary (first-choice) clip request for a scene — `buildClipChain(...)[0]`. Kept as
 * the back-compat entry point for callers/tests that need a single request.
 */
export function buildClipRequest(
  scene: StoryboardScene,
  params: LongformInputParams
): import("./providers/base").VideoGenerationParams {
  return buildClipChain(scene, params)[0];
}

/**
 * Read-only preview of the exact provider prompts for a scene: the clip prompt that ships to
 * grok-imagine-video and the still prompt that ships to gpt-image-2, assembled by the real
 * builders so what the operator sees IS what generation would send. Best-effort — any builder
 * throw yields "" so a poll-time preview can never break polling. Surfaced by `pollJob`; not
 * part of generation. Pure.
 */
export function assembleScenePromptPreview(
  scene: StoryboardScene,
  params: LongformInputParams
): { assembledClipPrompt: string; assembledStillPrompt: string } {
  let assembledClipPrompt = "";
  let assembledStillPrompt = "";
  // A split scene ships exactly one prompt: the square still for its RIGHT panel. Its host half
  // is lip-synced (prompt-free) and the 50/50 text prompt buildClipRequest would return here
  // belongs to the legacy no-lip-sync lane, which this scene never takes — showing it would
  // point the operator at a string that changes nothing.
  if (isSplitScene(scene)) {
    try {
      assembledStillPrompt = buildStillPrompt(
        buildSplitRightScene(scene),
        false,
        undefined,
        params.videoSubject,
        true
      );
    } catch {
      // preview is best-effort; leave ""
    }
    return { assembledClipPrompt, assembledStillPrompt };
  }
  try {
    assembledClipPrompt = buildClipRequest(scene, params).prompt;
  } catch {
    // preview is best-effort; leave ""
  }
  try {
    assembledStillPrompt = buildStillPrompt(
      scene,
      false,
      undefined,
      params.videoSubject
    );
  } catch {
    // preview is best-effort; leave ""
  }
  return { assembledClipPrompt, assembledStillPrompt };
}

/**
 * Whether a scene's clip chain is allowed to advance to a next candidate. Only b-roll
 * (no host on screen) qualifies: its `buildClipChain` returns [grok(normal),
 * grok(aggressive-soft)]. `generateSceneClips` advances 0→1 on a content-policy block (softer
 * grok prompt) only; there is no cross-model fallback. Host scenes are single-element grok and
 * never advance.
 */
export function isBrollChain(scene: StoryboardScene): boolean {
  return !scene.hostPresent;
}

/**
 * Per-clip head-trim for assembly. Grok image-to-video off a reference photo leaks a
 * reference-photo intro, so only the seated talking-host shots that carry a face photo need
 * trimming. B-roll never attaches a face reference at all (the `humanPresent`
 * hands-only lane is text-only grok), so it has no intro to trim — and
 * the channel face URLs still present in `params` (for the host lane) must NOT cause a b-roll
 * trim. Lip-synced host clips are audio-driven (no intro) and are never trimmed.
 * Pure — exported for testing.
 */
export function clipTrimFor(
  scene: StoryboardScene,
  faceImageUrl?: string
): number {
  // Lip-sync clips are generated from the audio itself — no reference-photo intro to trim.
  if (scene.lipsynced) return 0;
  // Host clips carrying a face reference open on the reference image; trim the intro.
  if (scene.hostPresent && !!faceImageUrl) return HOST_INTRO_TRIM_SEC;
  return 0;
}

async function generateSceneClip(
  adapter: ReturnType<typeof createProviderAdapter>,
  apimart: ApimartAdapter | null,
  jobId: number,
  scene: StoryboardScene,
  params: LongformInputParams,
  clipIdx = 0,
  /** Per-clip generation length (b-roll `brollClipDuration`); omitted → chain default. */
  durationSec?: number
): Promise<string> {
  // Blocking b-roll generation that mirrors the resumable path's submit (`submitBrollClip` +
  // the chain loop above), walking `buildClipChain`'s elements (b-roll: normal + softer retry;
  // host: single). There is no cross-model fallback, so once the chain is exhausted a failure
  // throws. The split-screen right half (a transient b-roll scene) and the legacy
  // non-submit/poll fallback both route through here; host scenes skip the keyframe.
  const chain = buildClipChain(scene, params);

  // Keyframe for every b-roll clip, on both lanes: grok needs it as a start frame, so the
  // composed still fixes the subject's appearance and the prompt is left to drive the motion.
  // One frame reused across the chain.
  // On failure (whole image chain exhausted or 90s timeout) the error propagates — the scene
  // fails rather than degrading to a text-only clip.
  let keyframe: string | undefined;
  if (!scene.hostPresent && !chain[0].imageUrls && !brollKeyframeDisabled()) {
    keyframe = await Promise.race([
      generateBrollKeyframe(
        jobId,
        scene,
        clipIdx,
        undefined,
        params.videoSubject
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("B-roll keyframe timed out")), 90_000)
      ),
    ]);
  }

  // B-roll clips render on APIMART (`generateSceneClips` already refused a keyless b-roll scene);
  // the 69Labs adapter is only reached by host shots and the local 69labs-only test runner.
  const videoAdapter = apimart ?? adapter;

  let lastError = "";
  for (let idx = 0; idx < chain.length; idx++) {
    // Attach the keyframe unless the req already carries images (host/split face reference).
    const sized =
      durationSec != null
        ? { ...chain[idx], duration: durationSec }
        : chain[idx];
    const req =
      keyframe && !sized.imageUrls
        ? { ...sized, imageUrls: [keyframe] }
        : sized;
    try {
      const results = await videoAdapter.generateVideo(req);
      const r = results[0];
      if (r?.success && r.fileData) {
        const key = `longform/${jobId}/clip-${scene.index}-${clipIdx}-${nanoid(6)}.mp4`;
        const { url } = await storagePut(
          key,
          Buffer.from(r.fileData),
          r.mimeType || "video/mp4"
        );
        return url;
      }
      lastError = r?.error || "Clip generation failed";
    } catch (e: any) {
      lastError = e?.message || String(e);
    }
    if (idx < chain.length - 1) {
      console.warn(
        `[Longform ${jobId}] scene ${scene.index} clip failed on ${chain[idx].model} (${lastError}) → falling back to ${chain[idx + 1].model}`
      );
    }
  }
  throw new Error(lastError || "Clip generation failed");
}

/**
 * IMAGE LANE: generate ONE OpenAI still for this person-free cutaway, animate it with a
 * subtle pan/zoom (Ken Burns), and return the clip URL — so it flows through assembly like
 * any other clip. The still is text-free; the on-screen caption (if any) is drawn later at
 * assembly. Synchronous (no submit/poll/resume): on failure it throws, marking the scene
 * failed. Image gen uses OpenAI gpt-image-2 only (no fallback) — a failure fails the scene
 * loudly.
 */
/**
 * Generate ONE still (OpenAI gpt-image-2, 16:9 720p / low quality), retrying a FRESH request on a
 * transient/decode failure and validating the bytes actually decode as an image. Both the still
 * lane (Ken Burns) and the b-roll keyframe feed the result straight to ffmpeg/grok, so an
 * undecodable buffer would abort libx264 with "incorrect parameters ... width or height", and a
 * lone image failure would kill the scene with no resume (the still lane has none). A
 * content-policy block is NOT retried — a resubmit can't clear it. Returns the raw image buffer +
 * mime; throws the last error after `attempts` are exhausted.
 * `genImage` is injectable so the retry/validation loop stays unit-testable.
 */
/**
 * How long to wait before the next still-gen attempt given the failure text. A gpt-image-2 HTTP
 * 429 (images-per-minute cap) only clears when the per-minute window resets, so retrying instantly
 * just re-429s until the attempt budget is gone — the whole scene then fails during a rate-limit
 * storm even though nothing is wrong with it. So on a 429 we back off exponentially with jitter
 * (2s, 4s, 8s, 16s, 30s cap — ~60s across a 6-attempt budget, spanning a full IPM reset window).
 * Every other error (decode failure, transient server error) keeps the original instant retry (0ms).
 * ponytail: fixed backoff, not the Retry-After header — a minute of spread covers the per-minute
 * reset regardless; plumb the header through GenerationResult only if a shorter reset shows up.
 */
export function stillRetryDelayMs(error: string, attempt: number): number {
  if (!/\b429\b|rate.?limit/i.test(error)) return 0;
  const base = Math.min(30_000, 1_000 * 2 ** attempt);
  return base + Math.floor(Math.random() * 1_000);
}

export async function generateValidatedStill(
  scene: StoryboardScene,
  attempts = 6,
  /**
   * Optional reference image (the channel book cover) so a book-depicting beat renders the REAL
   * cover instead of a hallucinated one — passed to gpt-image-2 as an image-to-image input.
   */
  referenceImageUrl?: string,
  genImage?: (i: {
    prompt: string;
    referenceImageUrl?: string;
    square?: boolean;
  }) => Promise<GenerationResult>,
  /** The whole-video subject — re-grounds the policy-safe rewrite + generic fallback on a block. */
  subject?: string,
  /**
   * Start from this visual instead of `scene.visualPrompt` — used when a caller (the b-roll
   * keyframe) has already de-escalated the visual on a content-policy block and needs the frame
   * to match the softened/neutral clip prompt rather than the original blocked visual.
   */
  visualOverride?: string,
  /**
   * Render 1:1 — the split-screen right panel. Travels to BOTH the prompt's framing clause and
   * the request size, and must survive every content-policy escalation below: a tier-3 generic
   * still that came back 16:9 would get its sides cropped off in the square slot.
   */
  square = false
): Promise<{ buffer: Buffer; mimeType?: string }> {
  if (!genImage)
    throw new Error("generateValidatedStill requires a genImage generator");
  let prompt = buildStillPrompt(scene, false, visualOverride, subject, square);
  let tier = 0; // 0 normal → 1 aggressive → 2 llm-rewrite → 3 subject-generic → 4 generic
  let lastError = "Still image generation failed";
  // Fail-open ballast for the overlay-text gate below — see the return past the loop.
  let textyFallback: { buffer: Buffer; mimeType?: string } | undefined;
  // A content-policy block can't be cleared by resubmitting the same prompt — escalate the
  // ladder instead: aggressively-softened variant, then a Claude policy-safe rewrite, then a
  // subject-anchored generic, then the guaranteed-generic visual. Escalations don't burn the
  // attempt budget (caller decrements), so tier 4 is always reached; only a blocked
  // GENERIC_SAFE_VISUAL is terminal.
  const onContentPolicy = async () => {
    tier += 1;
    if (tier > 4) throw new Error(lastError); // generic blocked too → terminal
    if (tier === 1)
      prompt = buildStillPrompt(scene, true, undefined, subject, square);
    else if (tier === 2) {
      const rewritten = await rewritePolicySafeVisual(
        scene.visualPrompt,
        subject
      );
      if (rewritten)
        prompt = buildStillPrompt(scene, true, rewritten, subject, square);
      else tier = 3; // LLM rewrite unavailable → straight to the anchored generic
    }
    if (tier === 3) {
      // Scene-free but not topic-free: a deterministic safe setting that still names the
      // subject, so the filler shot stays on-topic. A gore-adjacent subject can re-trip the
      // filter here — that's fine, the next rung is unblockable. No subject → skip to it.
      if (subject?.trim()) {
        prompt = buildStillPrompt(
          scene,
          true,
          genericSafeVisualFor(subject),
          subject,
          square
        );
      } else tier = 4;
    }
    if (tier === 4)
      // Terminal rung must be UNBLOCKABLE: drop the subject entirely (a gore subject like
      // "field dress a deer" re-trips the filter even when phrased "wholesome"). On-topic already
      // got three tries; the last resort trades topic for a guaranteed pass.
      prompt = buildStillPrompt(
        scene,
        true,
        GENERIC_SAFE_VISUAL,
        undefined,
        square
      );
    console.warn(
      `[Longform] scene ${scene.index} still blocked (content policy) → tier ${tier} (${["aggressive", "llm-rewrite", "subject-generic", "generic"][tier - 1]}) prompt`
    );
  };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let r: GenerationResult | undefined;
    try {
      r = await genImage({ prompt, referenceImageUrl, square });
    } catch (e: any) {
      lastError = e?.message || "Still image generation error";
      if (isContentPolicyError(lastError)) {
        await onContentPolicy();
        attempt--; // escalation is free — keep the retry budget for transient errors
        continue;
      }
      if (attempt < attempts)
        await sleep(stillRetryDelayMs(lastError, attempt));
      continue; // fresh request (backoff first on a 429 rate-limit)
    }
    if (!r?.success || !r.fileData) {
      lastError = r?.error || "Still image generation failed";
      if (isContentPolicyError(lastError)) {
        await onContentPolicy();
        attempt--; // escalation is free — keep the retry budget for transient errors
        continue;
      }
      if (attempt < attempts)
        await sleep(stillRetryDelayMs(lastError, attempt));
      continue; // transient / other → fresh request (backoff first on a 429 rate-limit)
    }
    const buffer = Buffer.from(r.fileData);
    // Reject a corrupt/empty/non-image buffer before it reaches ffmpeg or grok.
    try {
      // .stats() fully decodes the pixel stream (unlike .metadata(), which reads
      // only the PNG header) — a valid-header/corrupt-IDAT buffer that would render
      // as plaid throws here and regenerates instead of reaching the Ken Burns render.
      await sharp(buffer).stats();
    } catch {
      lastError = "OpenAI returned an undecodable image";
      continue; // regenerate
    }
    // Overlay-text gate. gpt-image-2 stamps a caption/title/watermark over the frame despite
    // NO_OVERLAY_TEXT_SUFFIX, and the b-roll VIDEO lane hands this exact frame to grok as its
    // keyframe — so a texty frame here becomes a texty clip. Same shape as the decode check
    // above: reject, keep the prompt, regenerate on a fresh seed. Runs AFTER the decode check so
    // no vision call is spent on a corrupt buffer.
    // NOT free like the content-policy ladder (no `attempt--`): a tier escalation is a bounded
    // state change that mutates the prompt, but a re-roll is a stochastic retry of the SAME
    // prompt, so a free one would loop forever on a visual that always renders text.
    // Skipped when a reference image is attached — that caller (the book cover) asked for text.
    if (!referenceImageUrl && (await hasOverlayText(buffer))) {
      lastError = "Still image has overlaid text";
      textyFallback ??= { buffer, mimeType: r.mimeType };
      console.warn(
        `[Longform] scene ${scene.index} still has overlay text ` +
          `(attempt ${attempt}/${attempts}) → regenerating`
      );
      continue; // fresh seed — the prompt already bans it, so a re-roll is the fix
    }
    if (attempt > 1)
      console.log(
        `[Longform] scene ${scene.index} still image OK on retry ${attempt}`
      );
    return { buffer, mimeType: r.mimeType };
  }
  // Fail open: a decodable-but-texty still renders fine, it's just ugly. Shipping it beats
  // failing a scene over a caption — the still lane has no resume, so a throw here kills the job
  // at the completeness gate. Nothing downstream badges it, so the warn below is the only trace.
  // ponytail: the ceiling this names is a visualPrompt that literally asks for lettering ("a
  // packet labeled X"). No suffix fixes that — a second anti-text clause just stacks negation,
  // which NO_BOOK_SUFFIX already warns doesn't work. Log the visual so the fix lands in the
  // storyboard prompt instead.
  if (textyFallback) {
    console.warn(
      `[Longform] scene ${scene.index} still has overlay text after ${attempts} ` +
        `attempts → shipping it: ${scene.visualPrompt.slice(0, 80)}`
    );
    return textyFallback;
  }
  throw new Error(lastError);
}

export async function generateSceneStillClip(
  jobId: number,
  scene: StoryboardScene,
  /**
   * For the cover-reveal beat: the literal channel book-cover URL. When set, the still IS this
   * image (no text-to-image generation) and Ken Burns renders it over a dark backdrop.
   */
  coverImageUrl?: string,
  /**
   * For a `showsBook` beat: the channel cover passed as a REFERENCE image so the generated still
   * contains the real cover art (distinct from `coverImageUrl`, which replaces generation entirely).
   */
  referenceImageUrl?: string,
  /** The whole-video subject — re-grounds the still's content-policy fallbacks. */
  subject?: string,
  /**
   * Render the still AND its Ken Burns clip 1:1 instead of 16:9 — the split-screen right panel,
   * whose slot is a full-height square. Square source into a square slot means the composite's
   * cover-crop takes nothing off the sides.
   */
  square = false
): Promise<string[]> {
  let imageUrl: string;
  if (coverImageUrl) {
    // Cover beat: animate the actual cover image, no generation.
    imageUrl = coverImageUrl;
  } else {
    // A still never shows a person: at most bare hands at the task (described in the
    // prompt via ANON_PERSON_SUFFIX) — never the channel host — so no face reference image is
    // attached. Person-free stills are plain.
    // Stills render on OpenAI's official gpt-image-2, 16:9 (1:1 for a split-screen panel).
    // Validate + retry: a corrupt buffer would crash the Ken Burns ffmpeg and a lone image
    // failure would kill the scene with no resume, so we regenerate instead of failing.
    const { buffer, mimeType } = await generateValidatedStill(
      scene,
      4,
      referenceImageUrl,
      generateOpenAIStill,
      subject,
      undefined,
      square
    );
    const ext = mimeType?.includes("png") ? "png" : "jpg";
    const imgKey = `longform/${jobId}/still-src-${scene.index}-${nanoid(6)}.${ext}`;
    ({ url: imageUrl } = await storagePut(
      imgKey,
      buffer,
      mimeType || "image/jpeg"
    ));
  }
  // ONE continuous Ken Burns clip for the whole narration: a single zoom (in/out by scene
  // index parity) stretched across the full duration. Long scenes read slow and gentle,
  // short scenes faster — and there's no mid-scene restart from stitched segments.
  // A split-screen panel animates on a SQUARE canvas sized to its slot (the frame height), so
  // the square still fills it edge to edge and the composite's cover-crop is a no-op.
  const side = dimensionsFor(TALKING_HEAD_ASPECT_RATIO).height;
  const buf = await renderKenBurnsClip(imageUrl, {
    durationSec: scene.audioDuration ?? 0,
    aspectRatio: TALKING_HEAD_ASPECT_RATIO,
    index: scene.index,
    // The cover sits on a blurred, darkened copy of itself over a solid dark backdrop.
    cover: Boolean(coverImageUrl),
    dims: square ? { width: side, height: side } : undefined,
  });
  const clipKey = `longform/${jobId}/still-${scene.index}-${nanoid(6)}.mp4`;
  const { url } = await storagePut(clipKey, buf, "video/mp4");
  return [url];
}

/**
 * IMAGE-FIRST B-ROLL: generate ONE still for a person-free motion cutaway and upload it,
 * returning its public URL — to be fed to the b-roll video model (grok-imagine-video) as a
 * literal keyframe (start frame) so the clip animates a concrete, well-composed
 * frame instead of one the model hallucinates from text. Uses the SAME prompt as the b-roll clip
 * (`buildStillPrompt`), so the frame matches the intended shot. Image gen uses OpenAI's official
 * gpt-image-2 (no Gemini fallback); throws on failure, which propagates up to fail the
 * scene (no text-only degradation) so the completeness gate stops the job rather than shipping a
 * partial cut.
 */
/**
 * grok-imagine inherits its output orientation from the keyframe image, ignoring the video
 * request's `size`. gpt-image-2 sometimes returns a portrait frame despite `size: "16:9"`
 * (the amateur-iphone prompt cue overrides it), which then makes the clip portrait. Force the
 * keyframe to landscape 16:9 so the clip is always 16:9.
 * ponytail: cover-crop only when the frame comes back non-landscape; a correct 16:9 frame is
 * returned untouched to avoid a needless re-encode.
 */
export async function normalizeKeyframeToLandscape(
  buf: Buffer
): Promise<Buffer> {
  const { width, height } = await sharp(buf).metadata();
  if (width && height && width >= height) return buf; // already landscape
  const dims = dimensionsFor(TALKING_HEAD_ASPECT_RATIO);
  return sharp(buf)
    .resize(dims.width, dims.height, { fit: "cover" })
    .png()
    .toBuffer();
}

/**
 * ponytail: A/B escape hatch. `BROLL_NO_KEYFRAME=1` renders b-roll text-to-video — no gpt-image-2
 * start frame — so a render can be judged against a normal one to see what the keyframe is
 * actually buying. Unset in production; the keyframe is the shipped behaviour on both lanes.
 */
const brollKeyframeDisabled = (): boolean =>
  process.env.BROLL_NO_KEYFRAME === "1";

export async function generateBrollKeyframe(
  jobId: number,
  scene: StoryboardScene,
  clipIdx: number,
  /**
   * Reference image baked into the keyframe (image-to-image): the book cover on a `showsBook`
   * beat. The channel host photo is NEVER referenced here — b-roll shows no person.
   */
  referenceImageUrl?: string,
  /** The whole-video subject — re-grounds the keyframe's content-policy fallbacks. */
  subject?: string,
  /**
   * De-escalated visual for the keyframe: when the b-roll VIDEO step content-policy-blocks, the
   * clip text is softened but the keyframe (image-first) must be softened too — else OpenAI keeps
   * emitting the same graphic frame that the video provider rejects. Overrides `scene.visualPrompt`.
   */
  visualOverride?: string
): Promise<string> {
  // Keyframe stills render on OpenAI's official gpt-image-2, 16:9.
  // Same validate + retry as the still lane (my earlier 10s motion cap tripled these calls).
  const { buffer: src, mimeType } = await generateValidatedStill(
    scene,
    4,
    referenceImageUrl,
    generateOpenAIStill,
    subject,
    visualOverride
  );
  const buf = await normalizeKeyframeToLandscape(src);
  // normalize returns the same buffer when it was already landscape; a crop re-encodes to png.
  const cropped = buf !== src;
  const mime = cropped ? "image/png" : mimeType || "image/jpeg";
  const ext = mime.includes("png") ? "png" : "jpg";
  const key = `longform/${jobId}/broll-kf-${scene.index}-${clipIdx}-${nanoid(6)}.${ext}`;
  const { url } = await storagePut(key, buf, mime);
  return url;
}

/** Clips needed to cover a scene whose narration is `audioDuration` long. */
export function clipsNeededFor(
  scene: StoryboardScene,
  faceImageUrl?: string
): number {
  // B-roll: one clip per scene at `brollClipDuration`.
  if (!scene.hostPresent) {
    return 1;
  }
  // Host scenes use the full clip length minus any intro trim (reference-photo head-trim).
  const usable = Math.max(
    2,
    clipDurationParam(FIXED_CLIP_LEN) - clipTrimFor(scene, faceImageUrl)
  );
  return Math.max(1, Math.ceil((scene.audioDuration ?? 0) / usable));
}

/**
 * On-screen CEILING for one scene. `LONG_SCENE_MAX_SEC` for every scene, less the silent frozen
 * tail a `qrTail` beat carries into assembly (`tailHoldSec` → `QR_TAIL_HOLD_SEC`) — that tail is
 * added ON TOP of the narration there, so the spoken part must leave room for it.
 */
const capFor = (s: StoryboardScene): number =>
  LONG_SCENE_MAX_SEC - (s.qrTail ? QR_TAIL_HOLD_SEC : 0);

/** On-screen FLOOR for one scene — host beats hold longer so cuts never flip on a face. */
const floorFor = (s: StoryboardScene): number =>
  s.hostPresent ? HOST_MIN_HOLD_SEC : SCENE_MIN_HOLD_SEC;

/**
 * Split any scene whose MEASURED narration exceeds its ceiling (`capFor`) — a scene the sentence-
 * first segmenter expected to fit one clip but TTS pace drift pushed over. Runs post-TTS.
 * Scenes at/under the ceiling pass through untouched.
 *
 * The over-long slice is decomposed into ATOMS at sentence granularity (only a single sentence
 * over `longWordsFor(wps)` is clause-split via `splitUnitIntoClauses`), then partitioned into the
 * MINIMAL `n` contiguous groups that brings every child under the ceiling. `n` is driven by the
 * MEASURED length (`ceil(dur / capFor)`) and only raised by the word estimate — a scene delivered
 * slower than the job's median pace crosses the ceiling while still carrying fewer than
 * `longWords` words, and a word-only count would silently no-op on it. It is then bounded above by
 * the atom count and by the scene's FLOOR (`floor(dur / floorFor)`) so the split never mints
 * children coalesce would just merge back; the ceiling wins if those two conflict. Groups
 * balance word counts — so children land on sentence boundaries whenever atoms are sentences,
 * and only a genuinely over-long sentence splits at a clause. Each child carries one verbatim
 * `scriptText` slice, inherits the parent's flags via spread (host children keep host; b-roll
 * children rotate `shotAngle` so split beats don't frame identically), and is reset to "pending"
 * with audio/clip fields cleared so the caller re-voices and re-renders it. The list is
 * renumbered with contiguous 1-based `index` values. Pure — exported for unit testing.
 *
 * NO scene is exempt: a `qrHero`/`coverHero`/`hostOpener` beat splits like any other and its flags
 * ride the spread onto every child, so the big QR / cover reveal / locked open holds the same
 * visual continuously across the children instead of running one arbitrarily long beat.
 *
 * The one slice this cannot fix is a single sentence with no comma, semicolon, colon OR conjunction
 * — `splitUnitIntoClauses` returns it whole, `atoms.length === 1`, and it passes through over the
 * ceiling (`describeOverlongScenes` names it). Cutting mid-sentence is worse than one clip at
 * `brollClipDuration` with a frozen tail.
 */
export function splitOverlongScenes(
  scenes: StoryboardScene[],
  /** Speech pace for the child word ceilings — the job's recognized pace when known. */
  wps: number = WORDS_PER_SEC
): StoryboardScene[] {
  const longWords = longWordsFor(wps);
  const ANGLES: NonNullable<StoryboardScene["shotAngle"]>[] = [
    "mid",
    "wide",
    "overhead",
    "low",
    "pov",
  ];
  const out: StoryboardScene[] = [];
  for (const scene of scenes) {
    const text = (scene.scriptText ?? "").trim();
    const dur = scene.audioDuration ?? 0;
    if (!text || dur <= capFor(scene)) {
      out.push(scene);
      continue;
    }
    const byCap = Math.ceil(dur / capFor(scene));
    // Words one child may carry. `longWords` is the ceiling in WORD space, tightened to the share
    // the MEASURED length demands: a slow-delivered scene runs over the ceiling on fewer than
    // `longWords` words, so gating clause-splitting on `longWords` alone leaves it a single atom
    // (one long sentence with commas) and the split silently no-ops.
    const childWords = Math.min(
      longWords,
      Math.ceil(wordCount(text) / byCap) || longWords
    );
    // Clause-aware atoms over `text` (offsets are into `text`, so each slice stays verbatim).
    const units = splitIntoUnits(text);
    const atoms: { start: number; end: number; words: number }[] = [];
    for (const u of units) {
      if (wordCount(u.text) > childWords) {
        for (const span of splitUnitIntoClauses(u, text, childWords)) {
          atoms.push({
            ...span,
            words: wordCount(text.slice(span.start, span.end)),
          });
        }
      } else {
        atoms.push({ start: u.start, end: u.end, words: wordCount(u.text) });
      }
    }
    const totalWords = atoms.reduce((sum, a) => sum + a.words, 0);
    // Child COUNT: the MINIMAL number that brings every child under the ceiling. Driven by the
    // MEASURED length — the word estimate alone no-ops on a scene delivered slower than the job's
    // median pace (over the ceiling on fewer than `longWords` words) — and only raised by it.
    let n = Math.max(byCap, Math.ceil(totalWords / longWords));
    // Bounded above by the atoms available and by the floor, so the split never mints children
    // `coalesceShortScenes` would merge straight back (a 7s host scene must not become two ~3.5s
    // beats). ponytail: the ceiling wins when the two bounds cross — a marginally short child is
    // floored by `applySceneHoldFloor`, whereas an over-ceiling scene freeze-pads past the clip.
    n = Math.max(
      byCap,
      Math.min(n, atoms.length, Math.floor(dur / floorFor(scene)))
    );
    // `n <= 1` means the slice can't be split further (e.g. one over-long, clause-less
    // sentence) — leave it whole; one clip at `brollClipDuration` covers it.
    n = Math.min(n, atoms.length);
    if (n <= 1) {
      out.push(scene);
      continue;
    }
    // Partition atoms into exactly `n` contiguous groups, balancing word counts: close the
    // current group once it has reached its balanced share, or when the remaining atoms are
    // only just enough to fill the remaining groups (no tiny trailing group).
    const groups: { start: number; end: number }[] = [];
    let curStart = atoms[0].start;
    let curEnd = atoms[0].end;
    let curWords = atoms[0].words;
    let opened = 1;
    let remainingWords = totalWords; // words not yet closed into a group (incl. the open one)
    for (let i = 1; i < atoms.length; i++) {
      const w = atoms[i].words;
      const remainingAtoms = atoms.length - i;
      const remainingGroups = n - opened;
      const reserveForRest = remainingAtoms <= remainingGroups;
      // Share is recomputed against what's LEFT, not the global average: closing every group at
      // the global share dumps the rounding remainder on the last child, which can push it back
      // over the ceiling the split exists to respect.
      const share = remainingWords / (remainingGroups + 1);
      const reachedShare = curWords >= share - w / 2;
      if (opened < n && (reserveForRest || reachedShare)) {
        groups.push({ start: curStart, end: curEnd });
        remainingWords -= curWords;
        curStart = atoms[i].start;
        curEnd = atoms[i].end;
        curWords = w;
        opened++;
      } else {
        curEnd = atoms[i].end;
        curWords += w;
      }
    }
    groups.push({ start: curStart, end: curEnd });
    groups.forEach((g, i) => {
      const slice = text.slice(g.start, g.end).trim();
      out.push({
        ...scene,
        scriptText: slice,
        narration: firstWords(slice, 8),
        // Host children keep the parent's angle (host shots ignore shotAngle); b-roll children
        // rotate so split beats don't all frame identically.
        shotAngle: scene.hostPresent
          ? scene.shotAngle
          : (scene.shotAngle ?? ANGLES[i % ANGLES.length]),
        sceneStatus: "pending",
        // Cleared so the pipeline re-voices and re-renders each child fresh.
        audioUrl: undefined,
        audioDuration: undefined,
        clipUrls: undefined,
        clipUrl: undefined,
        renderTaskIds: undefined,
        renderModelIndex: undefined,
        error: undefined,
      });
    });
  }
  // Contiguous 1-based indices across the whole list.
  out.forEach((s, i) => {
    s.index = i + 1;
  });
  return out;
}

/**
 * How a scene's length is measured for the short-scene merge. The pipeline runs this merge twice:
 * pre-TTS in WORD space (a scene under `FLOOR_WORDS` of text can't voice long enough to fill the
 * floor, so merge it before wasting a voicing) and post-TTS in MEASURED-SECOND space (real durations
 * catch what the word estimate missed). `sizeOf` returns 0 for a not-yet-sized scene (skipped);
 * `onOrphan` runs when a short scene has no eligible neighbor (measured path floors its hold; the
 * word path leaves it for the measured pass). `hostMin` is the higher floor host scenes are held
 * to (`HOST_MIN_HOLD_SEC`); `minFor` resolves the two per scene.
 */
type SizeMetric = {
  sizeOf: (s: StoryboardScene) => number;
  min: number;
  hostMin: number;
  max: number;
  onOrphan?: (s: StoryboardScene) => void;
};
/** The floor this scene must clear — host scenes get the taller one. */
const minFor = (metric: SizeMetric, s: StoryboardScene): number =>
  s.hostPresent ? metric.hostMin : metric.min;
const MEASURED_SIZE: SizeMetric = {
  sizeOf: s => s.audioDuration ?? 0,
  min: SCENE_MIN_HOLD_SEC,
  hostMin: HOST_MIN_HOLD_SEC,
  max: LONG_SCENE_MAX_SEC,
  onOrphan: s => {
    s.audioDuration = floorFor(s);
  },
};
// pre-TTS: no audioDuration to floor (nothing is voiced yet). The relaxed fallback in
// coalesceShortScenes folds a sub-floor scene into any non-hero neighbor, so a short scene
// only survives here when both neighbors are hero beats — then the measured pass handles it.
export const wordSizeFor = (wps: number): SizeMetric => ({
  sizeOf: s => wordCount(s.scriptText ?? s.narration ?? ""),
  min: floorWordsFor(wps),
  hostMin: Math.round(HOST_MIN_HOLD_SEC * wps),
  max: longWordsFor(wps),
});
export const WORD_SIZE: SizeMetric = wordSizeFor(WORDS_PER_SEC);

/**
 * Last resort BEFORE freeze-padding: a sub-floor scene that cannot MERGE (every neighbor would
 * breach `metric.max`) instead BORROWS whole clauses from a neighbor — the boundary moves, the
 * text stays verbatim, nothing is re-voiced. This is free: both coalesce passes are followed by
 * `assignSceneRanges`, which re-derives every scene's range from the same master word timeline
 * and re-slices it, so a shifted boundary costs one re-cut, not one TTS call.
 *
 * Without this a short host beat wedged between two long ones had nowhere to go, so its hold was
 * floored to `HOST_MIN_HOLD_SEC` while the lip-sync clip rendered at the REAL narration length —
 * assembly then clone-padded the difference and the host's face visibly froze. Borrowing makes the
 * scene genuinely SPEAK its floor instead.
 *
 * Returns true (and mutates BOTH scenes in place) when the short scene now clears its floor;
 * false when no neighbor can spare the text, leaving the caller's `onOrphan` path unchanged.
 * Pure — unit-tested.
 */
function borrowIntoShortScene(
  short: StoryboardScene,
  prev: StoryboardScene | undefined,
  next: StoryboardScene | undefined,
  metric: SizeMetric,
  isExempt: (s: StoryboardScene) => boolean
): boolean {
  const textOf = (s: StoryboardScene) =>
    (s.scriptText ?? s.narration ?? "").trim();
  const need = minFor(metric, short) - metric.sizeOf(short);
  // What a neighbor can give up without dropping under its OWN floor. A qrTail beat is pinned to
  // the CTA anchor (`ctaAnchors` in narrationAlignment) — its boundary is not ours to move.
  const spare = (n: StoryboardScene | undefined) =>
    !n || isExempt(n) || n.qrTail ? 0 : metric.sizeOf(n) - minFor(metric, n);
  // Same field reset as `merge` — the pair is re-sliced and re-rendered off the new boundary.
  const reseat = (s: StoryboardScene, text: string) => {
    s.scriptText = text;
    s.narration = firstWords(text, 8);
    s.sceneStatus = "pending";
    s.audioUrl = undefined;
    s.audioDuration = undefined;
    s.clipUrls = undefined;
    s.clipUrl = undefined;
    s.renderTaskIds = undefined;
    s.renderModelIndex = undefined;
    s.error = undefined;
  };

  const attempt = (donor: StoryboardScene): boolean => {
    const donorText = textOf(donor);
    const donorWords = wordCount(donorText);
    const donorSize = metric.sizeOf(donor);
    if (donorWords === 0 || donorSize <= 0) return false;
    // Clause atoms tiling donorText verbatim. `longWords: 0` opts every comma clause into the
    // conjunction tier too — the finest cut set the splitter offers. Coarser atoms overshoot:
    // the smallest bite off a 17-word neighbor was 11 words, which shoved the DONOR sub-floor and
    // lost a rescue that a cut before "that" makes trivially. Over-splitting costs nothing here —
    // we take the fewest atoms that clear the floor and stop.
    const atoms = splitIntoUnits(donorText).flatMap(u =>
      splitUnitIntoClauses(u, donorText, 0)
    );
    if (atoms.length < 2) return false; // one clause-less sentence — unsplittable

    // Take whole clauses off the SEAM side (next's head / prev's tail) until the short scene
    // clears its floor. A clause's size is its word share of the donor — the true value comes
    // back from `assignSceneRanges` moments later, this only has to pick the right cut.
    const fromHead = donor === next;
    let take = 0;
    let moved = 0;
    while (take < atoms.length - 1 && moved < need) {
      const a = fromHead ? atoms[take] : atoms[atoms.length - 1 - take];
      moved +=
        (donorSize * wordCount(donorText.slice(a.start, a.end))) / donorWords;
      take++;
    }
    if (moved < need) return false; // donor kept its last atom and still came up short
    if (metric.sizeOf(short) + moved > metric.max) return false; // breaches the ceiling
    if (donorSize - moved < minFor(metric, donor)) return false; // donor drops sub-floor

    const cut = fromHead
      ? atoms[take - 1].end
      : atoms[atoms.length - take].start;
    const taken = (
      fromHead ? donorText.slice(0, cut) : donorText.slice(cut)
    ).trim();
    const kept = (
      fromHead ? donorText.slice(cut) : donorText.slice(0, cut)
    ).trim();
    if (!taken || !kept) return false;

    const shortText = textOf(short);
    reseat(short, fromHead ? `${shortText} ${taken}` : `${taken} ${shortText}`);
    reseat(donor, kept);
    return true;
  };

  // Richest neighbor first, then the other — where the clauses fall decides as much as the
  // spare does, so a neighbor with more to give can still have no usable cut.
  return [next, prev]
    .filter((n): n is StoryboardScene => !!n && spare(n) >= need)
    .sort((a, b) => spare(b) - spare(a))
    .some(attempt);
}

/**
 * Merge any scene shorter than its floor (`metric.min`, or `metric.hostMin` for a host scene)
 * into an adjacent neighbor so cuts never flip faster than the floor. For each short, non-exempt
 * scene we fold into any FOLDABLE neighbor — not a `qrHero`/`coverHero` beat, combined size ≤
 * `metric.max`. CTA-ness need not match (a sub-floor scene must not survive on that technicality);
 * `merge` ORs the `cta` flag so the QR overlay is preserved across a cross-CTA fold. The ceiling is
 * hard: merging past it would undo `splitOverlongScenes`, which runs first and never runs again.
 * We prefer the shorter neighbor, join
 * the two verbatim `scriptText` slices in script order, keep the NEIGHBOR's visuals/flags (or the
 * SHORT scene's when it is a host beat — a short host shot is lengthened, never dissolved), and clear
 * audio/clip fields so the caller re-voices the merged text as one continuous take. A short scene is
 * left in place when NO neighbor is foldable (both hero beats, both would breach the ceiling, or it
 * is the lone scene) — then the measured metric floors its on-screen time (last-frame freeze +
 * silent audio pad in assembly). Renumbers.
 * Runs pre-TTS in `WORD_SIZE` and post-TTS in `MEASURED_SIZE` (the default). Pure — unit-tested.
 *
 * The locked cold open (`hostOpener`) is exempt ONE WAY: nothing folds backwards into it, but a
 * sub-floor opener folds FORWARD like any other short host beat, so it speaks its `HOST_MIN_HOLD_SEC`
 * rather than pads. Its chunks are packed against that floor in WORD space up front
 * (`packOpenerChunks`) — this catches the residual when the real TTS pace missed the estimate.
 * With TWO locked openers, scene 1's only neighbor is scene 2, itself a blocked target: merging them
 * would collapse the two-angle open, so that lone case orphans and pads (`MEASURED_SIZE.onOrphan`).
 */
export function coalesceShortScenes(
  scenes: StoryboardScene[],
  metric: SizeMetric = MEASURED_SIZE
): StoryboardScene[] {
  // Heroes hold one indivisible beat — never merged, in either direction.
  const isHeroBeat = (s: StoryboardScene) =>
    s.qrHero === true || s.coverHero === true;
  // Exemption for the NEIGHBOR role only: nothing folds BACKWARDS into a locked cold-open scene
  // (see the `prevOk` branch), which would push an opener already packed past the host floor well
  // beyond its intended length. An opener that measures SHORT is still a merge SUBJECT — it folds
  // FORWARD and absorbs its next scene, so it genuinely SPEAKS its floor instead of freeze-holding
  // a face over inserted silence.
  const isExempt = (s: StoryboardScene) =>
    isHeroBeat(s) || s.hostOpener === true;
  const merge = (
    first: StoryboardScene,
    second: StoryboardScene,
    keep: StoryboardScene
  ): StoryboardScene => {
    const text = `${(first.scriptText ?? first.narration ?? "").trim()} ${(
      second.scriptText ??
      second.narration ??
      ""
    ).trim()}`.trim();
    return {
      ...keep,
      scriptText: text,
      narration: firstWords(text, 8),
      // Keep the QR overlay if either side was a CTA — a relaxed cross-CTA fold
      // must never drop the QR (at most extends it over one short beat).
      cta: first.cta || second.cta || undefined,
      sceneStatus: "pending",
      // Cleared so the caller re-voices the combined slice as one continuous take.
      audioUrl: undefined,
      audioDuration: undefined,
      clipUrls: undefined,
      clipUrl: undefined,
      renderTaskIds: undefined,
      renderModelIndex: undefined,
      error: undefined,
    };
  };
  const out: StoryboardScene[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const dur = metric.sizeOf(s);
    if (isHeroBeat(s) || dur === 0 || dur >= minFor(metric, s)) {
      out.push(s);
      continue;
    }
    const prev = out[out.length - 1];
    const next = scenes[i + 1];
    // A sub-floor scene folds into any non-hero neighbor that still fits under the ceiling. CTA-ness
    // is NOT required to match — a short beat must never survive on that technicality — so the QR
    // may extend over one short beat (merge() ORs the cta flag), the one bounded cost we accept.
    // The CEILING is not negotiable: a merge that ran over it would undo the split that just ran,
    // and nothing re-splits afterwards. When neither neighbor fits, `onOrphan` floors the scene in
    // place (freeze + silent pad in assembly) — still zero dead air. Heroes are exempt either way.
    const foldable = (n: StoryboardScene | undefined): n is StoryboardScene =>
      !!n && !isExempt(n) && dur + metric.sizeOf(n) <= metric.max;
    const prevOk = foldable(prev);
    const nextOk = foldable(next);
    // Prefer the shorter neighbor; tie → prev (already emitted).
    const useNext =
      nextOk && (!prevOk || metric.sizeOf(next) < metric.sizeOf(prev));
    if (useNext) {
      // A short HOST scene keeps its own register: the fold makes the host beat LONGER
      // (it gains the neighbour's script text) instead of dissolving it into a b-roll
      // cutaway. Same reason the bookends were already protected — forceOpenOnHost runs
      // at storyboard build, so a neighbour must not steal the opener/closer's visuals.
      const keep = s.hostPresent === true ? s : next;
      out.push(merge(s, next, keep)); // text = s + next
      i++; // consume next
    } else if (prevOk) {
      const keep = s.hostPresent === true ? s : prev;
      out[out.length - 1] = merge(prev, s, keep); // text = prev + s
    } else if (borrowIntoShortScene(s, prev, next, metric, isExempt)) {
      // Couldn't merge under the ceiling, so the BOUNDARY moved instead: the scene took whole
      // clauses off a neighbor and now genuinely speaks its floor. Free — same master read.
      out.push(s);
    } else {
      // Both neighbors are hero beats, unsplittable, or too short to spare a clause (or the
      // scene is alone) — measured metric floors the hold (freeze + silent pad in mux).
      metric.onOrphan?.(s);
      out.push(s);
    }
  }
  out.forEach((s, i) => (s.index = i + 1));
  return out;
}

/**
 * Hold one scene to its on-screen floor (idempotent, mutates in place). qrHero and coverHero beats
 * take no floor hold here — the CTA block's release beat gets its silent QR tail added in assembly
 * via `tailHoldSec`, and the cover reveal ends with its narration; every other voiced scene holds
 * ≥ SCENE_MIN_HOLD_SEC (≥ HOST_MIN_HOLD_SEC on a host scene). Applied after voicing in both the
 * main pipeline and the single-scene
 * regenerate/retry path, so a scene never reaches assembly below its floor regardless of how it
 * was (re)voiced. Pure — unit-tested.
 */
export function applySceneHoldFloor(s: StoryboardScene): void {
  if (s.qrHero) return;
  if (s.coverHero) return; // cover ends with its narration — no silent hold
  const dur = s.audioDuration ?? 0;
  const floor = floorFor(s);
  if (dur > 0 && dur < floor) s.audioDuration = floor;
}

/**
 * Return a descriptive string naming every scene whose MEASURED narration is over its on-screen
 * ceiling (`capFor`), or null when the whole list is in band. The split/merge passes bring every
 * splittable scene under the ceiling, so a hit here is one of the two residuals: a single
 * clause-less sentence longer than the ceiling, or a scene re-voiced by the regenerate/retry path
 * (which re-renders one scene and never re-splits). Both freeze-pad past `BROLL_CLIP_MAX_SEC`
 * rather than fail, so this is the ONLY thing that surfaces them. Pure — exported for unit testing.
 */
export function describeOverlongScenes(
  scenes: StoryboardScene[]
): string | null {
  const over = scenes.filter(s => (s.audioDuration ?? 0) > capFor(s));
  if (over.length === 0) return null;
  const detail = over
    .map(s => `scene ${s.index} (${(s.audioDuration ?? 0).toFixed(1)}s)`)
    .join(", ");
  return `${over.length} scene(s) over the ${LONG_SCENE_MAX_SEC}s ceiling: ${detail}`;
}

/**
 * Return a descriptive error string if any scene lacks a clip (so assembling would silently
 * drop that scene's narration and desync the final video from the script), or null when
 * every scene has at least one clip. Pure — exported for unit testing and used as the
 * pre-assembly completeness gate.
 */
export function describeIncompleteScenes(
  scenes: StoryboardScene[]
): string | null {
  const missing = scenes.filter(s => !(s.clipUrls?.length || s.clipUrl));
  if (missing.length === 0) return null;
  const detail = missing
    .map(s => `scene ${s.index}${s.error ? ` (${s.error})` : ""}`)
    .join(", ");
  return `${missing.length} scene(s) have no clip — not assembling a partial video: ${detail}`;
}

/**
 * Resolution hint for lip-synced host clips on the RunPod lane (the InfiniteTalk worker renders
 * 720p natively, so this is advisory): 720p in production; 480p on localhost/dev. HeyGen is
 * always 1080p and takes no resolution argument.
 */
const LIPSYNC_RESOLUTION: "480p" | "720p" = ENV.isProduction ? "720p" : "480p";

/**
 * Short poll ceiling used when RESUMING an already-submitted render (retry / watchdog).
 * Long enough to download a task that has since finished, short enough to return `pending`
 * quickly when it's still rendering — so a resume pass never blocks for the full 20-min ceiling.
 */
export const RESUME_POLL_MS = 500_000;

/**
 * Thrown when a scene's render task(s) were submitted but the poll hit the client timeout
 * before completing. The provider taskIds are persisted on the scene, so the caller marks the
 * scene "rendering" (not "failed") and a later resume pass downloads the finished result
 * instead of re-submitting. Distinct from a normal Error, which means a terminal task failure.
 */
export class PendingRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PendingRenderError";
  }
}

/** Retry `fn` when it throws a transient PendingRenderError (provider timeout / self-fail /
 * "job failed to complete"). Non-transient errors and the final attempt propagate unchanged. */
export async function withTransientRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: {
    attempts?: number;
    delayMs?: (attempt: number) => number;
    onRetry?: (attempt: number, err: Error) => void;
  }
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const delayMs = opts?.delayMs ?? (a => Math.min(60_000, 15_000 * a)); // 15s, 30s
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (!(e instanceof PendingRenderError) || attempt === attempts) throw e;
      opts?.onRetry?.(attempt, e as Error);
      await sleep(delayMs(attempt));
    }
  }
  throw lastErr; // unreachable; satisfies the type checker
}

/**
 * Submit + persist + poll a scene's render tasks, resilient to poll timeouts. The single
 * seam both the initial run and the resume path go through:
 *  - Fresh run (`scene.renderTaskIds` empty): submit each of `chunkCount` tasks via `submit(i)`,
 *    persisting each provider taskId immediately (so a crash/timeout before polling can still
 *    resume), then poll every task.
 *  - Resume (`scene.renderTaskIds` populated): skip submission and poll those existing tasks.
 * Throws `PendingRenderError` (taskIds kept) if any task is still rendering at the poll ceiling;
 * throws a normal `Error` (scene failed) on a terminal task failure. On full success downloads
 * every clip to R2 in order, clears `renderTaskIds`, and returns the ordered clip URLs.
 */
export async function runChunkTasks(
  jobId: number,
  scene: StoryboardScene,
  provider: "runpod" | "heygen" | "sixtynine_labs",
  chunkCount: number,
  submit: (i: number) => Promise<VideoSubmitResult>,
  poll: (taskId: string) => Promise<GenerationResult>,
  persist: () => Promise<void>,
  // Global per-provider active-job semaphore: a slot is held for one chunk's whole
  // submit→poll lifecycle and released in `finally`, so the in-flight job count never exceeds
  // the provider cap — even when a single scene splits into more chunks than the cap.
  slots: Semaphore,
  // Optional per-chunk expected playable duration (seconds). When provided, a returned clip
  // materially shorter than its expected length is treated as a truncated render and retried
  // (see the `tooShort` check below). Lip-sync passes this; b-roll omits it (its clips are
  // legitimately clone-padded to the audio at assembly time).
  expectedDurationSec?: (i: number) => number | undefined
): Promise<string[]> {
  // Pre-size the id array (preserve any ids already persisted on a resume). Each chunk fills
  // its own index after submit, so concurrent submits below are index-safe.
  if (!scene.renderTaskIds?.length) {
    scene.renderProvider = provider;
    scene.renderTaskIds = new Array<string>(chunkCount).fill("");
  }
  const taskIds = scene.renderTaskIds;

  // Each chunk is an independent acquire → submit (if not already submitted) → persist →
  // poll → release unit. They all kick off here but queue on `slots.acquire()`, so at most
  // `cap` are ever in-flight. Wall time is the slowest single chunk, not the sum.
  const polls = await Promise.all(
    Array.from({ length: chunkCount }, (_, i) =>
      (async (): Promise<GenerationResult> => {
        await slots.acquire();
        try {
          if (!taskIds[i]) {
            let taskId = "";
            for (let attempt = 0; attempt < 2 && !taskId; attempt++) {
              const sub = await submit(i);
              if (sub.taskId) taskId = sub.taskId;
              else if (attempt === 1)
                throw new Error(sub.error || "clip submit failed");
              else await sleep(15_000);
            }
            taskIds[i] = taskId;
            await persist(); // persist id BEFORE the long poll — resume-safe per chunk
          }
          return await poll(taskIds[i]);
        } finally {
          slots.release();
        }
      })().catch((e: any): GenerationResult => ({
        success: false,
        error: e?.message || "poll failed",
      }))
    )
  );

  const pending = polls.filter(r => r.pending).length;
  if (pending > 0) {
    await persist();
    throw new PendingRenderError(
      `${pending} clip(s) still rendering on the provider`
    );
  }
  const failed = polls.find(r => !r.success);
  if (failed) {
    // Use the canonical classifier (single source of truth) so grok's provider-timeout phrasing
    // ("took too long", "did not respond" — the ~320s 69Labs self-fail) is treated transient like
    // "try again", instead of hard-failing the scene. Guarded so a content-policy block (which a
    // resubmit can't fix) still falls through to the fail/chain-advance path below.
    const isTransient =
      isTransientVideoError(failed.error) &&
      !isContentPolicyError(failed.error);
    if (isTransient) {
      // Transient server-side failure — clear IDs so the resume path re-submits fresh.
      // renderAttempts counts a scene's grok stalls for diagnostics; grok keeps resuming on
      // transient failure (no cross-model fallback), so this no longer gates a chain advance.
      scene.renderAttempts = (scene.renderAttempts ?? 0) + 1;
      scene.renderTaskIds = undefined;
      await persist();
      throw new PendingRenderError(
        `transient render failure (${failed.error}) — will retry`
      );
    }
    if (failed.infraFailure) {
      // Provider-side terminal failure (HeyGen render failed, unknown/expired video id) —
      // clear IDs and re-submit fresh on the same provider via the resume path. Never fail
      // over to another provider.
      scene.renderTaskIds = undefined;
      await persist();
      throw new PendingRenderError(
        `${provider} render failure (${failed.error || "provider infra failure"}) — will retry on ${provider}`
      );
    }
    throw new Error(failed.error || "clip render failed");
  }

  // Duration guard: a provider can return a clip materially SHORTER than the audio it was given
  // (a partial/truncated render under load). Assembly's last-frame clone-pad
  // (`tpad`) would silently mask that as a frozen face, so detect it here and retry the whole
  // scene fresh on the resume path instead. Allow a 10% (min 0.5s) shortfall for encode rounding.
  if (expectedDurationSec) {
    for (let i = 0; i < polls.length; i++) {
      const want = expectedDurationSec(i);
      if (!want || want <= 0) continue;
      const got = await probeBufferDurationSec(polls[i].fileData as Buffer);
      const tooShort = got < want - Math.max(0.5, want * 0.1);
      if (tooShort) {
        scene.renderTaskIds = undefined;
        await persist();
        throw new PendingRenderError(
          `scene ${scene.index} chunk ${i} clip truncated ` +
            `(${got.toFixed(2)}s < expected ${want.toFixed(2)}s) — will retry`
        );
      }
    }
  }

  const urls: string[] = [];
  for (let i = 0; i < polls.length; i++) {
    const r = polls[i];
    const key = `longform/${jobId}/clip-${scene.index}-${i}-${nanoid(6)}.mp4`;
    const { url } = await storagePut(
      key,
      Buffer.from(r.fileData as Buffer),
      r.mimeType || "video/mp4"
    );
    urls.push(url);
  }
  scene.renderTaskIds = undefined; // complete — no longer needs resume
  return urls;
}

/**
 * A split-screen scene: lip-synced host on the LEFT, a still from `splitVisual` on the RIGHT.
 * The one scene shape whose regenerate reuses its host clip and re-renders only the still, so
 * this predicate gates the prompt it exposes, the clips it may clear, and the lane it renders
 * on. Pure — exported for testing.
 */
export function isSplitScene(scene: StoryboardScene): boolean {
  return !!(scene.hostPresent && scene.splitVisual);
}

/**
 * The RIGHT half of a split-screen scene, expressed as a standalone b-roll scene: a still
 * rendered from `splitVisual`, forced person-free (the host already carries the person on the
 * LEFT — enhanceBrollPrompts nudges the description person-free, this suffix is the guarantee
 * if that rewrite failed open). Shared by the render path and the regenerate path so the two
 * can't drift apart.
 */
function buildSplitRightScene(scene: StoryboardScene): StoryboardScene {
  return {
    ...scene,
    hostPresent: false,
    splitVisual: undefined,
    visualPrompt: `${scene.splitVisual} ${NO_PEOPLE_SUFFIX}`,
  };
}

/**
 * Render the split-screen RIGHT panel: a gpt-image-2 still from `splitVisual`, Ken Burns'd to
 * the scene length — same still lane as every other still in the video, so the right panel
 * never hallucinates b-roll motion. Square, because the panel is a full-height 1:1 slot (see
 * `buildSplitScreenArgs`), so nothing is cropped off its sides. Bounded so a wedged image
 * render can't hold the host clip hostage.
 */
async function renderSplitRightClip(
  jobId: number,
  scene: StoryboardScene,
  params: LongformInputParams
): Promise<string> {
  const [rightUrl] = await Promise.race([
    generateSceneStillClip(
      jobId,
      buildSplitRightScene(scene),
      undefined,
      undefined,
      params.videoSubject,
      true
    ),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Split-screen right still timed out")),
        300_000
      )
    ),
  ]);
  return rightUrl;
}

/**
 * Generate a host scene's clip by lip-syncing its OWN narration audio to the host
 * photo via HeyGen Avatar IV — so the host's mouth speaks the verbatim script instead
 * of a text-to-video model's hallucinated speech. The render is the length of the input
 * audio, so the whole scene narration goes in a single task (reusing the public scene
 * track). The task is retried once. Returns the clip URL; its length equals the scene
 * narration.
 */
async function generateSceneLipsyncClips(
  lipsync: LipsyncLane,
  jobId: number,
  scene: StoryboardScene,
  params: LongformInputParams,
  instruction: string,
  persist: () => Promise<void>,
  pollTimeoutMs?: number
): Promise<string[]> {
  // Scene may be pinned to the alt-angle host photo (assigned by `assignHostShots` so consecutive
  // host cuts differ — an adjacent host pair reads main → alt). Fall back to the primary if no
  // alt photo is configured. `useAlt` also rides along to the lane: RunPod needs it as an
  // explicit `camera` knob so InfiniteTalk doesn't pull the off-axis subject onto this lens,
  // while HeyGen simply INHERITS the still's gaze — there, the choice of photo IS the angle.
  const useAltPhoto = scene.hostShot === 1 && !!params.faceImageUrl2;
  const faceImageUrl = (
    useAltPhoto ? params.faceImageUrl2 : params.faceImageUrl
  ) as string;

  // One lip-sync task per host scene. `chunkDurations` feeds runChunkTasks' truncation guard:
  // a render materially shorter than the narration is rejected and retried (e.g. if the worker
  // ever regressed to a fixed-length clip). On RESUME (`renderTaskIds` already set) the audio is
  // already submitted — just poll it; on a fresh run, submit the full scene track.
  // Expected length = the audio actually handed to HeyGen, not scene.audioDuration —
  // which applySceneHoldFloor floors to HOST_MIN_HOLD_SEC for short host scenes (assembly
  // freeze-pads them later). Using the floored value made every floored scene read as
  // "truncated" forever (1.39s render < 2.5s floor). Probe the real narration so the guard
  // only fires on a genuine short render.
  // ponytail: re-probes the narration per host render; cache on the scene if host volume
  // ever makes the fetch matter.
  const realNarrationSec = scene.audioUrl
    ? await probeUrlDurationSec(scene.audioUrl)
    : 0;
  const chunkDurations: number[] = [
    realNarrationSec || (scene.audioDuration ?? 0),
  ];
  let chunkUrls: string[] = [];
  if (!scene.renderTaskIds?.length) {
    const audioUrl = scene.audioUrl;
    if (!audioUrl) throw new Error("scene has no narration audio for lip-sync");
    chunkUrls = [audioUrl];
  }
  const chunkCount = scene.renderTaskIds?.length ?? chunkUrls.length;

  // Lip-sync runs on whichever lane `resolveLipsyncAdapter` handed us (HeyGen in production,
  // RunPod InfiniteTalk in staging) — the payload difference lives there, not here. A terminal
  // provider failure surfaces as a PendingRenderError (from runChunkTasks) so the scene
  // re-submits ON THE SAME PROVIDER via the resume pass; there is no cross-provider fallback.
  let urls = await runChunkTasks(
    jobId,
    scene,
    lipsync.provider,
    chunkCount,
    i =>
      lipsync.submit({
        scene,
        imageUrl: faceImageUrl,
        audioUrl: chunkUrls[i],
        useAlt: useAltPhoto,
      }),
    id => lipsync.poll(id, pollTimeoutMs),
    persist,
    lipsync.slots,
    i => chunkDurations[i]
  );

  // Split-screen: keep the lip-synced host on the LEFT half and composite a Ken Burns still
  // (from `splitVisual`) onto the RIGHT half — same gpt-image-2 still + slow pan/zoom as every
  // other still in the video, so the right panel never hallucinates b-roll motion. The host's
  // mouth still speaks the verbatim script; only the framing changes. The right panel is a
  // full-height SQUARE (see buildSplitScreenArgs) and its still is generated 1:1 to match, so the
  // b-roll is shown whole instead of side-cropped. If the right-half generation or compositing
  // fails, fall back to the plain full-frame host clips (still script-faithful) rather than
  // failing the whole job.
  // Remember the bare host renders. They already live in R2 (uploaded by runChunkTasks); without
  // this the composite below is the only surviving URL and a regenerate has to re-run the
  // lip-sync provider just to change the right half. See `regenerateSplitRight`.
  scene.hostClipUrls = urls;

  if (scene.splitVisual) {
    try {
      const rightUrl = await renderSplitRightClip(jobId, scene, params);
      const dims = dimensionsFor(TALKING_HEAD_ASPECT_RATIO);
      const composited: string[] = [];
      for (let i = 0; i < urls.length; i++) {
        const buf = await compositeSplitScreenClip(urls[i], rightUrl, dims);
        const key = `longform/${jobId}/split-${scene.index}-${i}-${nanoid(6)}.mp4`;
        const { url } = await storagePut(key, buf, "video/mp4");
        composited.push(url);
      }
      return composited;
    } catch (e: any) {
      console.warn(
        `[Longform ${jobId}] scene ${scene.index} split-screen composite failed, using full-frame host: ${e.message}`
      );
    }
  }

  return urls;
}

/**
 * Generate every clip a scene needs to cover its own narration. HOST scenes with a face
 * photo (and a configured HeyGen key) are LIP-SYNCED to their narration via Avatar IV
 * — the host's mouth matches the script. B-roll (and host-without-photo) scenes use the
 * text-to-video provider with one clip sized to the narration (`brollClipDuration`: 6–15s).
 */
export async function generateSceneClips(
  adapter: ReturnType<typeof createProviderAdapter>,
  jobId: number,
  scene: StoryboardScene,
  params: LongformInputParams,
  lipsync: LipsyncLane | null = null,
  instruction: string = DEFAULT_LONGFORM_INSTRUCTION,
  persist: () => Promise<void> = async () => {},
  pollTimeoutMs?: number,
  /**
   * Explicit 69Labs opt-in for the local 69labs-only test runner: allows a host shot to render
   * unsynced AND b-roll to fall back off APIMART. Production leaves this false.
   */
  allow69Labs: boolean = false
): Promise<string[]> {
  // ponytail: b-roll never depicts the book — neutralize any persisted `showsBook=true` from an
  // OLD job so no lane attaches the cover reference on regen/resume (new jobs already parse
  // false). Runs before every generation lane; the mutation is persisted back, self-healing the
  // stored storyboard. The end-of-video literal cover reveal (`coverHero`) is independent.
  scene.showsBook = false;

  // Images (keyframes/stills) always render on OpenAI's official gpt-image-2. B-roll MOTION clips
  // render on APIMART grok-imagine ONLY. Resolved once per scene from `params.apimartSlot` so a
  // key rotation is picked up on resume.
  const apimart = await apimartAdapterForJob(params);

  // No silent provider swap for b-roll: a missing APIMART key fails the scene loud instead of
  // rendering it on 69Labs, whose grok build has different duration/quality behaviour.
  if (!scene.hostPresent && !apimart && !allow69Labs) {
    throw new Error(
      `Scene ${scene.index} is b-roll, which renders on APIMART only, but no APIMART key is ` +
        `configured for slot ${params.apimartSlot ?? "(unset)"}. Set the tab's APIMART key.`
    );
  }

  if (lipsync && scene.hostPresent && params.faceImageUrl && scene.audioUrl) {
    scene.lipsynced = true;
    return generateSceneLipsyncClips(
      lipsync,
      jobId,
      scene,
      params,
      instruction,
      persist,
      pollTimeoutMs
    );
  }

  // A host scene with a face photo + narration is meant to lip-sync on whichever lane
  // LIPSYNC_PROVIDER selects. If we got here that lane's key is unset/misconfigured.
  // Fail loud instead of silently rendering a non-lip-synced grok clip on 69labs — that mistake
  // ships a host whose mouth doesn't match the script. `regenerateScene` catches this and
  // marks the scene failed so the misconfig surfaces.
  // `allow69Labs` is an explicit opt-in (local 69labs-only test runner) that lets a host
  // shot render via the 69labs grok face-ref image-to-video path below instead of lip-sync. In
  // production this stays false, so a missing lip-sync adapter fails loud rather than silently
  // shipping a host whose mouth doesn't match the script.
  if (
    !lipsync &&
    !allow69Labs &&
    scene.hostPresent &&
    params.faceImageUrl &&
    scene.audioUrl
  ) {
    throw new Error(
      `Scene ${scene.index} is a host shot that requires lip-sync, but no lip-sync ` +
        `adapter is configured (set HEYGEN_API_KEY or a per-tab HeyGen key in Admin). ` +
        `Refusing to fall back to non-lip-synced 69labs video.`
    );
  }

  scene.lipsynced = false;

  // Cover-reveal beat: always the literal channel cover (full-frame, dark backdrop), regardless of
  // the image-lane kill switch — generating a cover from a prompt would be nonsense.
  if (scene.coverHero && params.bookCoverImageUrl) {
    return generateSceneStillClip(
      jobId,
      scene,
      params.bookCoverImageUrl,
      undefined,
      params.videoSubject
    );
  }

  // Image lane: a person-free cutaway rendered as an OpenAI still + pan/zoom (no AI video).
  // The kill switch (USE_IMAGE_LANE=false) drops these back to the b-roll video path below.
  if (USE_IMAGE_LANE && scene.stillImage) {
    return generateSceneStillClip(
      jobId,
      scene,
      undefined,
      // Book-depicting still → pass the real cover as a reference image.
      scene.showsBook ? params.bookCoverImageUrl : undefined,
      params.videoSubject
    );
  }

  // Resumable text-to-video path: submit each clip, persist its taskId, poll — so a poll
  // timeout marks the scene "rendering" and can be resumed instead of re-submitting. Used
  // when the active video adapter exposes submit/poll (69Labs). Other adapters fall back
  // to the legacy submit+poll-in-one path below (no resume).
  //
  // CLIP CHAIN: `buildClipChain` returns [grok(normal), grok(aggressive-soft)] for b-roll and a
  // single grok element for host scenes, with NO cross-model fallback either way (b-roll picks
  // up its keyframe below). A poll timeout (PendingRenderError) keeps the SAME model +
  // taskIds so the resume path re-polls the still-running render. The only chain advance is the
  // content-policy retry (0→1, same model); a terminal failure rethrows (hard fail).
  // `renderModelIndex` persists the position for resume.
  const videoAdapter = apimart ?? adapter;
  if (videoAdapter.submitVideo && videoAdapter.pollVideo) {
    const chain = buildClipChain(scene, params);
    // B-roll: one clip sized to the narration (6–15s). Host scenes keep the chain's fixed duration.
    const brollDuration = scene.hostPresent
      ? null
      : brollClipDuration(scene.audioDuration ?? 0);
    const durFor = () => (brollDuration ? { duration: brollDuration } : null);
    let idx = Math.min(scene.renderModelIndex ?? 0, chain.length - 1);
    // Content-policy escalations past the pre-built chain: 0 = none yet, 1 = llm-rewrite
    // pushed, 2 = subject-anchored generic pushed, 3 = generic pushed (last resort — a block
    // on it is terminal).
    let escalation = 0;
    // Both lanes feed grok a gpt-image-2 keyframe (see `submitBrollClip`), and the provider
    // blocks on the FRAME, so softening only the clip text is futile — the keyframe must follow
    // the text down the content-policy ladder. undefined = build from scene.visualPrompt as
    // normal; set on each escalation below.
    let kfVisual: string | undefined;
    let kfSubject = params.videoSubject;
    while (true) {
      scene.renderModelIndex = idx;
      const req = chain[idx];
      // Fresh submit uses one b-roll clip; host / resume honor persisted task count.
      const need =
        scene.renderTaskIds?.length ??
        (scene.hostPresent ? clipsNeededFor(scene, params.faceImageUrl) : 1);
      // B-roll gets one gpt-image-2 keyframe (clipIdx 0): grok needs a start frame. The composed
      // still is what fixes the subject's appearance — the clip prompt only describes movement.
      // Host / split-screen / already-image reqs submit unchanged. If keyframe gen fails (whole image chain
      // exhausted), the error propagates — the scene fails and the completeness gate stops the
      // job, rather than silently degrading to a text-only clip.
      const submitBrollClip = async (
        i: number
      ): Promise<import("./providers/base").VideoSubmitResult> => {
        if (!scene.hostPresent && !req.imageUrls && !brollKeyframeDisabled()) {
          // Reference baked into the keyframe: the real book cover on a showsBook beat, and
          // nothing else. The channel host photo is never referenced on b-roll — a cutaway
          // shows no person at all (see NO_FIGURES_SUFFIX).
          const kf = await generateBrollKeyframe(
            jobId,
            scene,
            i,
            scene.showsBook ? params.bookCoverImageUrl : undefined,
            kfSubject,
            kfVisual
          );
          // Grok takes the lone input image as the clip's start frame, with no videoInputMode
          // (only gemini-omni supports modes). buildVideoBody caps images and strips any mode;
          // we send a single keyframe and omit videoInputMode here too.
          return videoAdapter.submitVideo!({
            ...req,
            ...durFor(),
            imageUrls: [kf],
          });
        }
        return videoAdapter.submitVideo!({ ...req, ...durFor() });
      };
      try {
        const urls = await runChunkTasks(
          jobId,
          scene,
          "sixtynine_labs",
          need,
          i => submitBrollClip(i),
          id => videoAdapter.pollVideo!(id, pollTimeoutMs),
          persist,
          SIXTYNINE_VIDEO_SLOTS
        );
        scene.renderModelIndex = undefined; // success — reset chain position
        scene.renderAttempts = undefined; // success — reset grok-stall budget
        return urls;
      } catch (e: any) {
        // grok transient stalls surface as PendingRenderError and are retried on grok via the
        // resume loop — there is no cross-model (veo) fallback, so we always keep resuming grok.
        if (e instanceof PendingRenderError) {
          throw e; // keep resuming the same (grok) model
        }
        // B-roll content-policy ladder: element 1 (shorter, person-free, aggressively
        // softened) is pre-built; past it we push a Claude policy-safe rewrite, then a
        // subject-anchored generic, then the guaranteed GENERIC_SAFE_VISUAL. Credits/other
        // terminal errors fail fast — a softer prompt won't fix them. Only a block on the
        // generic element is terminal.
        if (!isBrollChain(scene) || !isContentPolicyError(e.message)) throw e; // host / non-policy
        if (idx >= chain.length - 1) {
          if (escalation >= 3) throw e; // neutral generic blocked too → terminal (unreachable in practice)
          const rewritten =
            escalation === 0
              ? await rewritePolicySafeVisual(
                  scene.visualPrompt,
                  params.videoSubject
                )
              : null;
          const subjectAnchor = params.videoSubject?.trim()
            ? genericSafeVisualFor(params.videoSubject)
            : null;
          escalation = rewritten ? 1 : escalation <= 1 && subjectAnchor ? 2 : 3;
          // rewrite + subject-generic tiers stay on-topic (keep the subject); the generic tier
          // is the terminal rung and MUST be unblockable, so it drops the subject (a gore
          // subject re-trips the filter even in the "wholesome" generic phrasing) and uses the
          // fixed neutral look. The keyframe gets the SAME de-escalated visual so the frame the
          // video model sees matches the text.
          const nextVisual =
            escalation === 1
              ? rewritten!
              : escalation === 2
                ? subjectAnchor!
                : GENERIC_SAFE_VISUAL;
          if (escalation < 3) {
            kfVisual = nextVisual;
            kfSubject = params.videoSubject;
          } else {
            kfVisual = GENERIC_SAFE_VISUAL;
            kfSubject = undefined;
          }
          chain.push({
            ...chain[chain.length - 1],
            prompt:
              escalation < 3
                ? `${softenVisualPrompt(nextVisual)} ${amateurIphoneLook(params.videoSubject, escalation === 1 ? brollLookMotion(scene) : "settle")} ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`
                : `${softenVisualPrompt(GENERIC_SAFE_VISUAL)} ${amateurIphoneLook(undefined, "settle")} ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`,
          });
        }
        console.warn(
          `[Longform ${jobId}] scene ${scene.index} clip blocked on ${req.model} (${e.message}) → retrying ${
            ["shorter/softer", "llm-rewrite", "subject-generic", "generic"][
              escalation
            ]
          } prompt`
        );
        idx += 1;
        scene.renderModelIndex = idx;
        scene.renderTaskIds = undefined; // resubmit fresh on the next model
        await persist();
      }
    }
  }

  // Legacy blocking path (no submit/poll on the adapter — never APIMART).
  if (!scene.hostPresent) {
    const duration = brollClipDuration(scene.audioDuration ?? 0);
    let clipUrl = "";
    for (let attempt = 0; attempt < 2 && !clipUrl; attempt++) {
      try {
        clipUrl = await generateSceneClip(
          adapter,
          apimart,
          jobId,
          scene,
          params,
          0,
          duration
        );
      } catch (e: any) {
        if (attempt === 1) throw e;
        console.warn(
          `[Longform ${jobId}] scene ${scene.index} clip retry: ${e.message}`
        );
        await sleep(45_000);
      }
    }
    return [clipUrl];
  }
  const need = clipsNeededFor(scene, params.faceImageUrl);
  const urls: string[] = [];
  for (let i = 0; i < need; i++) {
    let clipUrl = "";
    for (let attempt = 0; attempt < 2 && !clipUrl; attempt++) {
      try {
        clipUrl = await generateSceneClip(
          adapter,
          apimart,
          jobId,
          scene,
          params,
          i
        );
      } catch (e: any) {
        if (attempt === 1) throw e;
        console.warn(
          `[Longform ${jobId}] scene ${scene.index} clip ${i} retry: ${e.message}`
        );
        await sleep(45_000);
      }
    }
    urls.push(clipUrl);
  }
  return urls;
}

// ─── Provider-partitioned clip dispatch ────────────────────────────
// Clips render on three independently-capped lanes, run concurrently:
//   • host lip-sync → HeyGen (cap ENV.heygenConcurrency)
//   • motion b-roll → 69Labs video (cap ENV.sixtynineVideoConcurrency, 30)
//   • still image   → 69Labs image (cap ENV.sixtynineImageConcurrency, 60)
// A single combined pool head-of-line blocks (workers stuck on a slow HeyGen slot leave 69Labs
// idle); worse, folding stills and motion into ONE 69Labs pool sized to the *video* cap means
// the two media types compete for the same 30 workers, so neither the 30-video nor the 60-image
// cap is ever saturated (≈50/50 STILL_IMAGE_FRACTION → video peaks ~15-22). Giving each medium
// its own lane lets motion fill all 30 video slots and stills scale into the 60 image slots. The
// per-lane semaphores (SIXTYNINE_VIDEO_SLOTS / SIXTYNINE_IMAGE_SLOTS / heygenSlotsFor) remain the
// hard in-flight caps (motion keyframes also draw on SIXTYNINE_IMAGE_SLOTS, sharing it fairly).

/**
 * A scene renders on the host lip-sync lane (HeyGen Avatar IV) exactly when
 * `generateSceneClips` would route it to `generateSceneLipsyncClips` — mirror that condition.
 * Everything else (motion b-roll video + still-image lane) renders on the 69Labs lane.
 */
export function isHostLipsyncScene(
  scene: StoryboardScene,
  lipsync: LipsyncLane | null,
  params: LongformInputParams
): boolean {
  return Boolean(
    lipsync && scene.hostPresent && params.faceImageUrl && scene.audioUrl
  );
}

/**
 * Sample 69Labs in-flight slot usage every 5s while clips render, so a run's logs reveal whether
 * the video (30) / image (60) concurrency caps are actually reached or left idle. Returns a stop
 * fn; read-only (only calls the Semaphore introspection getters). Diagnostic — cheap to leave on.
 */
function startSixtyNineLaneUsageLogger(jobId: number): () => void {
  const tag = `[Longform ${jobId}] 69labs lanes`;
  const timer = setInterval(() => {
    const v = SIXTYNINE_VIDEO_SLOTS;
    const i = SIXTYNINE_IMAGE_SLOTS;
    console.log(
      `${tag}: video ${v.inUse()}/${v.max} (peak ${v.peakInUse()}, +${v.waiting()} waiting) | ` +
        `image ${i.inUse()}/${i.max} (peak ${i.peakInUse()}, +${i.waiting()} waiting)`
    );
  }, 5_000);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}

/**
 * Per-scene wall-clock backstops, one per lane. NOT tuning knobs — each sits several times above
 * the legitimate worst case, because the only thing they exist to catch is a worker that will
 * otherwise never return at all. That happened in prod (jobs 140/141/143): the still lane has no
 * timeout anywhere in its path (`runFfmpeg` spawn, the OpenAI image fetches, `storagePut`), so one
 * parked scene left `mapPool`'s `Promise.all` below permanently unsettled → no further DB write →
 * the 30-min inactivity watchdog killed a job that was still alive, one scene short of done.
 *
 * host: `HEYGEN_LIPSYNC_TIMEOUT_MS` is 15min (providers/heygen-lipsync.ts) and that clock only
 *   starts once the scene wins a global HeyGen slot; add the ≤5min split-screen right panel and
 *   the composite. The RunPod lane gets its own, longer number — see below.
 * motion: 69Labs video polls 6min per chunk, a scene may run several, plus lane queueing.
 * still: typically <2min, but the worst legit case stacks the process-global gpt-image-2 bucket,
 *   up to 4 `generateValidatedStill` attempts with 429 backoff, the Ken Burns encode + its wait for
 *   an FFMPEG_SLOTS slot, and two uploads. The still lane has no resume, so a false abort re-pays
 *   the full image cost — hence 20min, not 10.
 */
export const SCENE_DEADLINE_HOST_MS = 25 * 60_000;
/**
 * Host deadline on the RunPod InfiniteTalk lane. Nearly double the HeyGen one because the poll
 * ceiling underneath it is: `RUNPOD_LIPSYNC_TIMEOUT_MS` is 35min vs HeyGen's 15, and that clock
 * only starts once the scene wins a global RunPod slot. `resolveLipsyncAdapter` hands the right
 * one to `dispatchScenesByProvider`; nothing else picks between them.
 */
export const SCENE_DEADLINE_HOST_RUNPOD_MS = 45 * 60_000;
export const SCENE_DEADLINE_MOTION_MS = 20 * 60_000;
export const SCENE_DEADLINE_STILL_MS = 20 * 60_000;

/**
 * Run `processOne(scene)` under a wall clock. On expiry the scene is abandoned and marked failed,
 * and this RESOLVES rather than rejects — rejecting would unwind the `Promise.all` below and abort
 * the sibling lanes, killing ~200 healthy scenes to punish one. Resolving matches what
 * `renderSceneClip` already does for a terminal failure: the pass finishes, `describeIncompleteScenes`
 * reports a true error, and the UI's Retry re-renders just the holdouts.
 * ponytail: the abandoned promise keeps running — there's no AbortSignal plumbed through the OpenAI
 * fetches or S3, so orphaned work is leaked (the ffmpeg case is bounded by FFMPEG_MAX_MS). That's a
 * cosmetic leak now rather than a fatal hang; add real cancellation only if it measurably starves
 * lane slots. `renderTaskIds` is deliberately NOT cleared, so a Retry re-polls the provider task
 * instead of re-paying a submit.
 */
async function withSceneDeadline(
  scene: StoryboardScene,
  ms: number,
  processOne: (s: StoryboardScene) => Promise<void>
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"expired">(resolve => {
    timer = setTimeout(() => resolve("expired"), ms);
  });
  try {
    const outcome = await Promise.race([
      processOne(scene).then(() => "done" as const),
      expired,
    ]);
    if (outcome === "expired") {
      scene.sceneStatus = "failed";
      scene.error = `Clip: scene exceeded ${Math.round(ms / 60_000)}min wall clock (worker abandoned)`;
      console.error(
        `[Longform] scene ${scene.index} abandoned after ${ms}ms — marked failed, retryable`
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Partition scenes into three render lanes and run them concurrently, each at its own cap. */
export async function dispatchScenesByProvider(
  scenes: StoryboardScene[],
  lipsync: LipsyncLane | null,
  params: LongformInputParams,
  processOne: (scene: StoryboardScene) => Promise<void>,
  jobId?: number
): Promise<void> {
  const host = scenes.filter(s => isHostLipsyncScene(s, lipsync, params));
  const broll = scenes.filter(s => !isHostLipsyncScene(s, lipsync, params));
  // Mirror generateSceneClips' still-vs-motion routing so each medium gets its own lane, sized to
  // its own cap — stills (OpenAI image) no longer share the motion (video) worker pool. (OpenAI's
  // own process-global gpt-image-2 rate limiter paces the actual image calls within this lane.)
  const stills = broll.filter(s => USE_IMAGE_LANE && s.stillImage);
  const motion = broll.filter(s => !(USE_IMAGE_LANE && s.stillImage));
  console.log(
    `[Longform ${jobId ?? "?"}] clip dispatch: ${host.length} host(${lipsync?.provider ?? "none"}) + ` +
      `${stills.length} still(OpenAI image) + ${motion.length} motion(69labs video)`
  );
  const stopUsageLog =
    jobId !== undefined ? startSixtyNineLaneUsageLogger(jobId) : () => {};
  // Motion b-roll renders on the 69Labs grok video lane (cap ENV.sixtynineVideoConcurrency).
  try {
    await Promise.all([
      // Host lane cap and wall clock both come from the resolved lane — RunPod runs wider (25)
      // and slower (45min) than HeyGen (8 / 25min). `host` is empty when lipsync is null.
      mapPool(
        host,
        Math.max(1, lipsync?.concurrency ?? ENV.heygenConcurrency),
        s =>
          withSceneDeadline(
            s,
            lipsync?.sceneDeadlineMs ?? SCENE_DEADLINE_HOST_MS,
            processOne
          )
      ),
      mapPool(motion, Math.max(1, ENV.sixtynineVideoConcurrency), s =>
        withSceneDeadline(s, SCENE_DEADLINE_MOTION_MS, processOne)
      ),
      mapPool(stills, Math.max(1, ENV.sixtynineImageConcurrency), s =>
        withSceneDeadline(s, SCENE_DEADLINE_STILL_MS, processOne)
      ),
    ]);
  } finally {
    stopUsageLog();
  }
}

/**
 * Render one scene's clip(s) and fold the outcome into its status. Shared by the main clip
 * stage and the resume stage. A still-running render (PendingRenderError) stays "rendering"
 * so it resumes later; any other failure marks the scene "failed".
 */
async function renderSceneClip(
  scene: StoryboardScene,
  jobId: number,
  adapter: ReturnType<typeof createProviderAdapter>,
  params: LongformInputParams,
  lipsync: LipsyncLane | null,
  instruction: string,
  persist: () => Promise<void>,
  pollTimeoutMs?: number
): Promise<void> {
  scene.sceneStatus = "processing";
  try {
    scene.clipUrls = await generateSceneClips(
      adapter,
      jobId,
      scene,
      params,
      lipsync,
      instruction,
      persist,
      pollTimeoutMs
    );
    syncSceneClipFields(scene);
    scene.sceneStatus = "completed";
  } catch (e: any) {
    if (e instanceof PendingRenderError) {
      // Render still running provider-side — keep the taskIds, mark resumable (not failed).
      scene.sceneStatus = "rendering";
      scene.error = undefined;
      console.warn(
        `[Longform ${jobId}] scene ${scene.index} ${e.message} — will resume`
      );
    } else {
      // Reaching here means the render terminally failed: a grok clip failed with no
      // cross-model fallback (b-roll or host scene). Either way the scene fails — there is no
      // still-image recovery.
      scene.sceneStatus = "failed";
      scene.error = `Clip: ${e.message}`;
      scene.renderTaskIds = undefined;
      scene.renderModelIndex = undefined;
      scene.renderAttempts = undefined;
    }
  }
}

/**
 * Resume scenes left in the "rendering" state by re-polling their persisted provider tasks
 * (the renders kept running server-side after a poll timeout / crash). For each rendering
 * scene this re-enters `generateSceneClips`, which — seeing `renderTaskIds` already set —
 * polls the existing tasks (short ceiling) and downloads them instead of re-submitting.
 * Mutates `scenes` in place and persists after each. A scene still rendering stays "rendering"
 * (retry again later); a terminal failure becomes "failed" (needs a fresh Regenerate).
 */
async function resumeRenderingScenes(
  jobId: number,
  scenes: StoryboardScene[],
  params: LongformInputParams,
  adapter: ReturnType<typeof createProviderAdapter>,
  lipsync: LipsyncLane | null,
  instruction: string,
  persist: () => Promise<void>
): Promise<void> {
  // Short-circuit rendering scenes that already have a clip (completed before the crash).
  const toResume: StoryboardScene[] = [];
  for (const scene of scenes) {
    if (scene.sceneStatus !== "rendering") continue;
    if (scene.clipUrls?.length || scene.clipUrl) {
      scene.sceneStatus = "completed";
      scene.renderTaskIds = undefined;
      continue;
    }
    toResume.push(scene);
  }

  // Re-poll the remaining renders across both provider lanes concurrently (was a sequential
  // for-loop), so a backlog of slow host (HeyGen) resumes no longer blocks b-roll resumes.
  await dispatchScenesByProvider(
    toResume,
    lipsync,
    params,
    async scene => {
      await renderSceneClip(
        scene,
        jobId,
        adapter,
        params,
        lipsync,
        instruction,
        persist,
        RESUME_POLL_MS
      );
      await persist();
    },
    jobId
  );
}

// ─── Talking-head (verbatim full-script) helpers ───────────────────

/**
 * Voice ONE scene's verbatim slice as its own narration track: split the slice into
 * TTS-sized segments (preserving every word), TTS each in order, concat into a single
 * scene track, upload it. Returns the scene audio URL + measured duration. Concatenating
 * every scene's track in index order reproduces the full continuous narration. Uses the one
 * channel speed (`params.ttsSpeed`) for every scene — host and b-roll alike — so a regenerated
 * scene matches the uniform pace of the master read.
 */
export async function buildSceneNarration(
  jobId: number,
  providerType: string,
  apiKey: string,
  scene: StoryboardScene,
  params: LongformInputParams
): Promise<{ url: string; durationSec: number }> {
  const text = fixClauseOnset(
    (scene.scriptText ?? scene.narration ?? "").trim()
  );
  const segments = splitScriptForNarration(text);
  const speed = params.ttsSpeed;
  const audioUrls: string[] = [];
  for (const seg of segments) {
    audioUrls.push(
      await generateSceneVoiceover(
        providerType,
        apiKey,
        seg,
        params.voiceId,
        params.ttsModel,
        speed,
        params.ttsVolume,
        TTS_STABILITY,
        TTS_STYLE,
        TTS_SIMILARITY
      )
    );
  }
  const { buffer, durationSec } = await concatAudio(audioUrls);
  const key = `longform/${jobId}/scene-${scene.index}-vo-${nanoid(6)}.mp3`;
  const { url } = await storagePut(key, buffer, "audio/mpeg");
  return { url, durationSec };
}

/**
 * Voice the ENTIRE spoken script as ONE continuous master narration and return its URL. A single
 * 69Labs request (`text` accepts up to 500k chars) gives one uninterrupted read — consistent
 * prosody with no per-scene restarts. If that one-shot fails for any non-moderation reason (e.g. a
 * pathologically long request), fall back to chunk-then-concat (`splitScriptForNarration` +
 * `concatAudio`): far fewer prosody breaks than the old per-scene voicing. A `CensoredTTSError`
 * propagates unchanged — chunking can't clear a moderation block, and it already failed the job
 * under the per-scene design.
 */
async function voiceMasterNarration(
  jobId: number,
  providerType: string,
  apiKey: string,
  spokenScript: string,
  params: LongformInputParams
): Promise<{ url: string }> {
  const speed = params.ttsSpeed;
  let providerUrl: string;
  try {
    providerUrl = await generateSceneVoiceover(
      providerType,
      apiKey,
      spokenScript,
      params.voiceId,
      params.ttsModel,
      speed,
      params.ttsVolume,
      TTS_STABILITY,
      TTS_STYLE,
      TTS_SIMILARITY
    );
  } catch (e: any) {
    if (e instanceof CensoredTTSError) throw e;
    console.warn(
      `[Longform ${jobId}] master one-shot TTS failed (${e?.message}); ` +
        `falling back to chunked master narration`
    );
    const segments = splitScriptForNarration(spokenScript);
    const audioUrls: string[] = [];
    for (const seg of segments) {
      audioUrls.push(
        await generateSceneVoiceover(
          providerType,
          apiKey,
          seg,
          params.voiceId,
          params.ttsModel,
          speed,
          params.ttsVolume,
          TTS_STABILITY,
          TTS_STYLE,
          TTS_SIMILARITY
        )
      );
    }
    const { buffer } = await concatAudio(audioUrls);
    const key = `longform/${jobId}/master-vo-${nanoid(6)}.mp3`;
    const { url } = await storagePut(
      key,
      await capMasterPauses(jobId, buffer),
      "audio/mpeg"
    );
    return { url };
  }
  // Mirror the one-shot master to R2 (outside the try, so a mirror blip can't trigger a
  // full re-voice): the master is persisted on the job — assembly lays it over the whole
  // film — and the provider CDN link expires, so a resumed/retried job must still reach it.
  const resp = await fetch(providerUrl, {
    // The master VO is a whole film's narration; 5 min is a ceiling on a stalled socket,
    // not a budget for the transfer.
    signal: AbortSignal.timeout(300_000),
  });
  if (!resp.ok)
    throw new Error(
      `master narration mirror fetch failed: HTTP ${resp.status}`
    );
  const buf = Buffer.from(await resp.arrayBuffer());
  const key = `longform/${jobId}/master-vo-${nanoid(6)}.mp3`;
  const { url } = await storagePut(
    key,
    await capMasterPauses(jobId, buf),
    "audio/mpeg"
  );
  return { url };
}

/**
 * Trim over-long dead-air pauses out of the master before it is persisted — i.e. before
 * whisperx alignment, so scene ranges and the per-scene VO slices stay self-consistent and
 * nothing downstream needs to know. A pacing tidy-up must never fail a 20-minute render, so a
 * broken ffmpeg pass falls through with the original audio.
 */
async function capMasterPauses(jobId: number, buf: Buffer): Promise<Buffer> {
  try {
    return await capDeadAirPauses(buf);
  } catch (e: any) {
    console.warn(
      `[Longform ${jobId}] master pause cap failed (${e?.message}); ` +
        `keeping the un-capped narration`
    );
    return buf;
  }
}

/**
 * Build all-host scenes (the fixed saved descriptor look) for a set of chunks — the
 * graceful-degradation shape used both by the whole-video fallback and per-batch when a
 * storyboard batch fails entirely. Scenes carry LOCAL indices (1..chunks.length); callers
 * renumber after merge. Same shape `parseStoryboard` default-fills an omitted chunk with.
 */
function hostFillScenes(
  chunks: OffsetSpan[],
  spokenScript: string,
  /** Leading scenes to flag as the locked cold open — see `parseStoryboard`. */
  openerHostScenes = 0
): StoryboardScene[] {
  return chunks.map((c, i) => {
    const scriptText = spokenScript.slice(c.start, c.end).trim();
    return {
      index: i + 1,
      scriptText,
      narration: firstWords(scriptText, 8),
      // Host look is always the fixed saved descriptor (no per-script inference).
      visualPrompt: talkingHeadVisualPrompt(DEFAULT_HOST_DESCRIPTOR, i),
      hostPresent: true,
      // Every scene is host here, so the flag only marks which ones carry the name card and
      // are exempt from the balancers — the cold open still reads as intended.
      ...(i < openerHostScenes ? { hostOpener: true as const } : {}),
      sceneStatus: "pending" as const,
    };
  });
}

/**
 * Salvage a truncated `{"scenes":[...]}` response: extract every COMPLETE `{...}` object
 * from the array, drop a trailing partial one, and rebuild well-formed JSON. Returns null
 * when nothing usable parsed. Feeding the result back through `parseStoryboard` keeps the
 * completed scenes and lets the cut-off tail default-fill to host (rather than the whole
 * batch throwing). String/brace-aware so braces/brackets inside string values don't fool it.
 */
export function salvageStoryboard(raw: string): string | null {
  const text = stripMarkdownFences(raw);
  const scenesKey = text.indexOf('"scenes"');
  if (scenesKey === -1) return null;
  const arrayStart = text.indexOf("[", scenesKey);
  if (arrayStart === -1) return null;

  const objects: string[] = [];
  let objStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = arrayStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        objects.push(text.slice(objStart, i + 1));
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break; // array closed cleanly
    }
  }

  if (objects.length === 0) return null;
  return `{"scenes":[${objects.join(",")}]}`;
}

/** Split chunks into order-preserving batches of at most `size`. */
function chunkIntoBatches(chunks: OffsetSpan[], size: number): OffsetSpan[][] {
  const batches: OffsetSpan[][] = [];
  for (let i = 0; i < chunks.length; i += size) {
    batches.push(chunks.slice(i, i + size));
  }
  return batches;
}

/**
 * The hero subject of a b-roll visualPrompt, for the cross-batch shot digest: the storyboard
 * prompt mandates OPENING every cutaway with the hero subject itself, so the head of the prompt
 * IS the subject. First ~8 words, clause-trimmed. Pure — exported for unit testing.
 */
export function heroPhrase(visualPrompt: string): string {
  return visualPrompt
    .split(/[,.;—]/)[0]
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join(" ");
}

/** Cap on the cross-batch shot digest — recency matters most; a repeat 40 min apart is fine. */
const PRIOR_SHOTS_CARRY_MAX = 150;

/**
 * Storyboard ONE batch of chunks. Builds a prompt over just this batch (the prompt asks for
 * indices 1..batch.length, sliced from the global `spokenScript` by each chunk's offsets, so
 * the verbatim text stays correct), invokes Claude, and on a `max_tokens` truncation salvages
 * the completed scenes before retrying. Always resolves — a fully failed batch returns
 * all-host scenes for ONLY its own chunks, so one bad batch never collapses the whole video.
 * Returns LOCAL indices (1..batch.length).
 */
async function storyboardBatch(args: {
  batch: OffsetSpan[];
  spokenScript: string;
  params: LongformInputParams;
  instruction: string;
  openerHostScenes: number;
  /** Which runtime quarter (0–3) of the film this batch sits in, or undefined for the flat mix. */
  quarter?: number;
  /** Digest of shots already chosen by earlier batches (sequential storyboarding). */
  priorShots?: string[];
  /** 1-based global chunk number of this batch's first chunk. */
  batchStartIndex?: number;
  /** Total chunk count across the whole video. */
  totalChunks?: number;
}): Promise<StoryboardScene[]> {
  const { batch, spokenScript, params, instruction, openerHostScenes } = args;
  const q = args.quarter;
  const { systemPrompt, userMessage } = buildUnifiedStoryboardPrompt({
    chunks: batch,
    spokenScript,
    faceAvailable: !!params.faceImageUrl,
    coverAvailable: !!params.bookCoverImageUrl,
    instruction,
    subject: params.videoSubject,
    styleBible: params.visualStyleBible,
    openerHostScenes,
    priorShots: args.priorShots,
    batchStartIndex: args.batchStartIndex,
    totalChunks: args.totalChunks,
    mixTarget:
      q === undefined
        ? undefined
        : {
            host: HOST_RAMP[q],
            video: MOTION_RAMP[q],
            still: 1 - HOST_RAMP[q] - MOTION_RAMP[q],
          },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await invokeGemini({
        systemPrompt,
        userMessage,
        maxTokens: STORYBOARD_BATCH_MAX_TOKENS,
      });
      // On truncation, salvage the completed scenes (clearing stopReason so the rebuilt JSON
      // actually parses); the cut-off tail default-fills to host inside parseStoryboard.
      if (r.stopReason === "max_tokens") {
        const salvaged = salvageStoryboard(r.text);
        if (salvaged) {
          return parseStoryboard(
            salvaged,
            batch,
            spokenScript,
            undefined,
            openerHostScenes
          );
        }
        throw new Error(
          "storyboard truncated (max_tokens), nothing salvageable"
        );
      }
      return parseStoryboard(
        r.text,
        batch,
        spokenScript,
        r.stopReason,
        openerHostScenes
      );
    } catch (e: any) {
      console.warn(
        `[Longform] storyboard batch attempt ${attempt + 1} failed: ${e.message}`
      );
    }
  }
  // Batch fully failed — host-fill ONLY this batch's chunks so siblings are unaffected.
  return hostFillScenes(batch, spokenScript, openerHostScenes);
}

/**
 * Build the storyboard scene list. The script is FIRST segmented into sentence-sized chunks
 * (`segmentScriptByDuration`) so every cut lands where a sentence ends; Claude then assigns
 * a VISUAL to each fixed chunk (it does not choose the cuts). To keep the storyboard JSON
 * under the model's output budget on long videos, chunks are storyboarded in SEQUENTIAL batches
 * (`STORYBOARD_BATCH_SIZE`) and merged in order — sequential so each batch's prompt carries a
 * digest of the shots earlier batches chose; a failed/truncated batch degrades to host
 * shots for only its own chunks. On a total wipeout (empty chunks) fall back to all-host so
 * the run never dies. Every scene carries its own verbatim `scriptText` slice — the basis for
 * per-scene narration that locks each scene's visuals to the audio under it.
 */
export async function buildUnifiedScenes(
  params: LongformInputParams,
  spokenScript: string,
  instruction: string,
  /** Word-offset CTA spans from `parseCtaMarkers` — when present they are ground truth for the
   *  `cta` flags (`markCtaFromSpans`) and scope the QR trigger search; empty → legacy heuristics. */
  ctaSpans: CtaSpan[] = [],
  /** Called after each storyboard batch — the pipeline touches the job row so the 30-min
   *  stale-job watchdog doesn't reap a long sequential storyboard as inactive. */
  heartbeat?: () => void
): Promise<StoryboardScene[]> {
  const units = splitIntoUnits(spokenScript);
  // The locked host cold open: a two-angle shot (main photo → alt photo) when the channel has a
  // second host photo, else the single open-on-host scene. Its chunks are packed against the
  // HOST_MIN_HOLD_SEC floor rather than the snappy target, so each opening shot speaks its whole
  // 4s+ instead of voicing short and freeze-holding a face over inserted silence.
  const openerHostScenes = params.faceImageUrl2 ? 2 : 1;
  // Segment at the voice's RECOGNIZED pace when a previous job measured it — chunks then
  // carry enough words to genuinely fill the scene floor at this voice's real speed.
  const chunks = segmentScriptByDuration(
    units,
    spokenScript,
    wpsForVoice(params.voiceId),
    openerHostScenes
  );

  if (chunks.length === 0) {
    // markCtaScenes still flags the CTA beats for the QR overlay.
    const fill = hostFillScenes(chunks, spokenScript);
    return ctaSpans.length
      ? markCtaFromSpans(fill, ctaSpans)
      : markCtaScenes(fill);
  }

  const batches = chunkIntoBatches(chunks, STORYBOARD_BATCH_SIZE);
  // Which ramp quarter to aim each batch at (see `HOST_RAMP`). Batches are fixed-size chunk runs,
  // so a batch's MIDPOINT position among them is its quarter — approximate, because the real
  // quarters are cut by measured runtime we don't have until after TTS. That's fine: this is only
  // the nudge to Claude; `rebalanceHostScreenTime`/`enforceStillMotionRatio` re-cut by real
  // seconds afterwards. Skipped on a short script, matching `runtimeQuarters`' own fallback.
  const rampBatches = chunks.length >= RAMP_MIN_SCENES;
  // SEQUENTIAL, not parallel: each batch's prompt carries a digest of the shots earlier batches
  // actually chose — the only way the whole-video B-ROLL VARIETY rule can bind across batches
  // (an outline can't prevent two parallel batches independently landing on the same subject+angle).
  // Costs one serialized Flash call per batch; sits next to minutes of TTS and clip renders.
  const results: StoryboardScene[][] = [];
  const priorShots: string[] = [];
  let globalStart = 1;
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const r = await storyboardBatch({
      batch,
      spokenScript,
      params,
      instruction,
      // The cold-open lock applies only to the true video opener (batch 0); a non-first
      // batch's first scene is interior to the merged video and stays whatever Claude chose.
      openerHostScenes: bi === 0 ? openerHostScenes : 0,
      quarter: rampBatches
        ? Math.min(3, Math.floor(((bi + 0.5) / batches.length) * 4))
        : undefined,
      priorShots: priorShots.slice(-PRIOR_SHOTS_CARRY_MAX),
      batchStartIndex: globalStart,
      totalChunks: chunks.length,
    });
    results.push(r);
    // Digest this batch's chosen cutaways for the next batch. A host-filled failed batch has
    // no cutaways and contributes nothing — automatic.
    for (const s of r) {
      if (!s.hostPresent && s.visualPrompt) {
        priorShots.push(
          `${heroPhrase(s.visualPrompt)} (${s.shotAngle ?? "unspecified"})`
        );
      }
    }
    globalStart += batch.length;
    heartbeat?.();
  }

  // Merge in order and renumber to GLOBAL indices (batches returned local 1..len indices).
  const merged = results.flat().map((s, i) => ({ ...s, index: i + 1 }));

  // CTA flagging runs ONCE over the merged list — a pitch can straddle a batch seam. With
  // explicit ===START/END CTA=== markers the spans are ground truth (markCtaFromSpans);
  // otherwise markCtaScenes bridges it into one contiguous CTA span (for CTA *visual* handling; the QR no
  // longer rides on `cta`). Then `markCtaQrBlock` anchors the big centered QR to the fixed "Now go
  // ahead and grab your phone … I'll wait right here" block and reveals the cover on the pitch beat
  // that NAMES the book (falling back to the beat right before the block, and to the legacy
  // markCoverReveal → markQrBeforeCover pair if a script lacks the block); finally
  // `markCornerQrBeforeCover` puts the small corner QR on the pitch. All pre-TTS, so the beats flow through
  // narration + render.
  const flagged = ctaSpans.length
    ? markCtaFromSpans(merged, ctaSpans)
    : markCtaScenes(merged);
  return markCornerQrBeforeCover(
    markCtaQrBlock(flagged, params, ctaSpans.length > 0),
    params,
    ctaSpans.length > 0
  );
}

/**
 * Unified pipeline. The script is segmented into sentence-sized chunks up front and Claude
 * assigns a visual to each (it does NOT choose the cuts); each scene then voices EXACTLY its own
 * slice, measured outliers are corrected (split over-long at sentence/clause bounds, merge runts),
 * and each scene gets clip(s) sized to its spoken duration and is assembled independently — so
 * every scene's visuals stay locked to the audio under it and drift cannot accumulate. The only
 * pipeline.
 */

/**
 * LLM-enhance every cutaway scene's visualPrompt in-place, in parallel, before any clip
 * is submitted to 69Labs. Runs after all scene flags (stillImage, hostPresent, cta) are
 * finalized. Uses Gemini 2.5 Flash with separate system prompts for video vs. still lanes.
 *
 * CTA cutaways are included but get the CTA enhancer (their narration is a sales pitch, so
 * the image must be a generic on-topic cutaway, never a literal "scan the QR /
 * hold the book" shot) plus a deterministic keyword guard so a literal prompt can never
 * survive — even if the LLM call fails or slips. Per-scene failures are logged, swallowed
 * (never fails the job), and reported back as `failedScenes` so callers with a jobId can
 * surface an advisory warning.
 *
 * Also carries the whole-video direction (`deriveVisualDirection`) into every rewrite:
 * `params.visualStyleBible` — the one world all cutaways share — and `scene.visualBeat` — this
 * stretch's slice of the arc. Both are DISAMBIGUATION-ONLY hints, phrased like `subjectLine`,
 * because the enhancer's own SCRIPT ALIGNMENT rule forbids introducing anything the narration
 * doesn't state. CTA cutaways get the bible but never a beat. With neither set (a pre-feature
 * job, or a derive that failed open) every user message is byte-identical to before the feature.
 *
 * Split-screen right halves (`scene.splitVisual`, which live on HOST scenes) get their own pass
 * after the cutaways — see the comment there for why it must precede the book guard.
 */
export async function enhanceBrollPrompts(
  scenes: StoryboardScene[],
  params: LongformInputParams,
  // When set, only these scene.index values are rewritten (regenerate re-enhances just its
  // target scenes); the topic/dedup context below still reads the full scenes array.
  onlyIndices?: number[]
): Promise<{ failedScenes: number[]; failReasons: string[] }> {
  const failedScenes: number[] = [];
  // Deduped reasons for the FINAL (post-retry) failures. The error text used to reach
  // console.warn only, so a warning on a finished job was undiagnosable — 429 vs. safety
  // block vs. truncation all read the same.
  const failReasons: string[] = [];
  const noteFailure = (index: number, err: unknown) => {
    failedScenes.push(index);
    const reason = String((err as any)?.message ?? err);
    if (!failReasons.includes(reason)) failReasons.push(reason);
  };
  const only = onlyIndices && new Set(onlyIndices);
  const cutaways = scenes
    .map((scene, i) => ({ scene, i }))
    .filter(({ scene }) => !scene.hostPresent)
    .filter(({ scene }) => !only || only.has(scene.index));
  // Split-screen right halves are b-roll too, and they live on HOST scenes — so they survive
  // neither the `!hostPresent` filter above nor an early return keyed only on cutaways. A
  // regenerate targeting one host split-screen scene has zero cutaways and still has work here.
  const splits = scenes
    .map((scene, i) => ({ scene, i }))
    .filter(({ scene }) => scene.hostPresent && !!scene.splitVisual)
    .filter(({ scene }) => !only || only.has(scene.index));
  if (cutaways.length === 0 && splits.length === 0)
    return { failedScenes, failReasons };

  // The channel persona — the same profile that drives script generation — so the rewrite knows
  // the audience and tone, not just a raw key like "haven". Capped: persona layers are full
  // personality profiles and the enhancer is a strict ≤60-word rewrite task. Falls back to the
  // old raw-key line byte-identical when no layer exists.
  const layer = await getChannelLayer(params.channelKey).catch(() => null);
  const persona = layer?.layerContent?.trim();
  const channelLine = persona
    ? `Channel persona (context for audience and tone — NOT content to depict): ` +
      `${truncateWords(persona, 120)}\n`
    : `Channel: ${params.channelKey}\n`;

  // The video's own non-CTA cutaway subjects are the "topic" signal for CTA cutaways.
  const topicContext = spreadOrder(
    scenes.filter(s => !s.hostPresent && !s.cta && s.visualPrompt)
  )
    .slice(0, 6)
    .map(s => s.visualPrompt)
    .join("; ");

  const subject = params.videoSubject?.trim();
  const subjectLine = subject
    ? `Video subject (the whole video is about this — for DISAMBIGUATION only): ${subject}. ` +
      `Use it only to resolve a vague or ambiguous reference in the narration or original prompt ` +
      `to the correct specific thing; do NOT add the subject to a shot about something else and ` +
      `do NOT introduce any object the narration doesn't state.\n`
    : "";

  // The whole-video style bible (deriveVisualDirection). Phrased exactly like subjectLine above,
  // and for the same reason: the enhancer's SCRIPT ALIGNMENT rule ("do NOT introduce ...
  // decorative elements not in the narration") is what a shared-world hint would otherwise fight.
  // It settles what the narration leaves open; it never licenses a new object.
  // Empty when no bible was derived ⇒ the user message is byte-identical to pre-feature.
  const bible = params.visualStyleBible?.trim();
  const directionLine = bible
    ? `Channel visual direction (every cutaway in this video shares ONE world — for ` +
      `DISAMBIGUATION only): ${bible}. Use it only to settle a detail the narration leaves ` +
      `open (which place, which season, which of these materials); do NOT introduce any object ` +
      `the narration doesn't state, and do NOT treat it as a list of things to show.\n`
    : "";

  // The scene's slice of the video's arc. Cutaways and splitVisual get it; CTA cutaways never do
  // — their narration is a sales pitch that CTA_BROLL_ENHANCER_SYSTEM exists to ignore, so a beat
  // derived from it would reintroduce exactly what that lane suppresses.
  const beatLineFor = (scene: StoryboardScene): string => {
    const beat = scene.visualBeat?.trim();
    return beat ? `This stretch of the video shows: ${beat}\n` : "";
  };

  // Rewrite FROM the seed, never from the last rewrite. `scene.visualPrompt` is this function's
  // own ≤60-word output after the first pass, so reading it back made every regen a
  // re-compression of a compression and concrete script detail bled away a little each time.
  // Captured lazily here so pre-seed storyboards adopt their current prompt as the baseline.
  const seedOf = (scene: StoryboardScene): string =>
    (scene.visualPromptSeed ??= scene.visualPrompt);
  const splitSeedOf = (scene: StoryboardScene): string | undefined =>
    (scene.splitVisualSeed ??= scene.splitVisual);

  // Resolves to null when the rewrite landed, or to the caught error when the original was
  // kept. Safe to re-run: `seedOf` latched the seed, so a retry rewrites from the same
  // baseline rather than from the failure fallback, and both guards below are idempotent.
  const enhanceCutaway = async ({
    scene,
    i,
  }: {
    scene: StoryboardScene;
    i: number;
  }): Promise<unknown> => {
    const isCta = scene.cta === true;
    const systemPrompt = isCta
      ? CTA_BROLL_ENHANCER_SYSTEM
      : STILL_BROLL_ENHANCER_SYSTEM;
    const userMessage = isCta
      ? channelLine +
        subjectLine +
        directionLine +
        `Type: ${scene.stillImage ? "still" : "motion"}\n` +
        `Topic context (other cutaways in this video): ${topicContext || "the video's general subject"}\n` +
        `Scene narration (a SALES PITCH — never depict the pitch itself; use it only to stay ` +
        `in the video's topic register): "${scene.scriptText ?? scene.narration}"\n\n` +
        `Enhanced prompt:`
      : `${CUTAWAY_PERSON_FREE_DIRECTIVE}\n` +
        (scene.objectMotion && !scene.humanPresent
          ? `${OBJECT_MOTION_DIRECTIVE}\n`
          : "") +
        (scene.humanPresent && !scene.stillImage
          ? `${HUMAN_MOTION_DIRECTIVE}\n`
          : "") +
        channelLine +
        subjectLine +
        directionLine +
        beatLineFor(scene) +
        `Type: ${scene.stillImage ? "still" : scene.objectMotion && !scene.humanPresent ? "motion-object" : scene.humanPresent ? "motion-human" : "still"}\n` +
        `Scene narration: "${scene.scriptText ?? scene.narration}"\n` +
        `Original prompt: ${seedOf(scene)}\n\n` +
        `Enhanced prompt:`;
    let failure: unknown = null;
    try {
      const result = await invokeGemini({
        systemPrompt,
        userMessage,
        // Well above the ≤60-word (≤40 for CTA) cap the system prompts impose, and thinking is
        // off in `invokeGemini`, so this costs nothing extra — it just stops a model that
        // overruns its word cap from being discarded as a truncated rewrite.
        maxTokens: 600,
      });
      // A max_tokens rewrite is cut mid-sentence — keep the original rather than adopt it.
      if (result.stopReason === "max_tokens")
        throw new Error("rewrite truncated (max_tokens)");
      const enhanced = stripPromptArtifacts(result.text);
      if (isCta) {
        scene.visualPrompt = sanitizeCtaCutaway(
          enhanced || scene.visualPrompt,
          scenes,
          i
        );
      } else if (enhanced) {
        scene.visualPrompt = enhanced;
      }
    } catch (err) {
      failure = err ?? new Error("unknown error");
      console.warn(
        `[enhanceBrollPrompts] scene ${scene.index} failed, keeping original:`,
        err
      );
      // CTA cutaways must never keep a literal pitch prompt, even on LLM failure.
      if (isCta) {
        scene.visualPrompt = sanitizeCtaCutaway(scene.visualPrompt, scenes, i);
      }
    }
    // Book guard for non-CTA cutaways (CTA lane already bans books via sanitizeCtaCutaway):
    // a narration that mentions the book without a hard CTA signal (URL/QR/price) is not
    // flagged cta, so the enhancer's script-alignment rule writes a book into the prompt —
    // and a positive book mention beats the trailing NO_BOOK_SUFFIX negation. Swap in the
    // same on-topic fallback the CTA lane uses. Runs on both the enhanced and the
    // LLM-failure/original prompt.
    if (!isCta && brollDepictsBook(scene.visualPrompt ?? "")) {
      scene.visualPrompt = genericCtaBrollFor(scenes, i);
    }
    return failure;
  };

  const retryCutaways: typeof cutaways = [];
  await mapPool(cutaways, BROLL_ENHANCE_CONCURRENCY, async item => {
    if (await enhanceCutaway(item)) retryCutaways.push(item);
  });
  // ponytail: one sequential sweep, no backoff — a failure here is a 429/5xx burst inside a
  // ~270-call pool that outlasted invokeGemini's own retries, and by the time the pool has
  // drained the burst is over. Add real backoff if this still leaks.
  for (const item of retryCutaways) {
    const err = await enhanceCutaway(item);
    if (err) noteFailure(item.scene.index, err);
  }

  // Split-screen cutaways live on HOST scenes (scene.splitVisual, rendered in the right half),
  // which the cutaway pass above skips on `!hostPresent` — so this was the one b-roll lane no
  // LLM ever touched. It is also the least-directed text in the pipeline: `enforceHostSplitMix`
  // seeds splitVisual from `brollVisual ?? visualPrompt`, so a host scene with no brollVisual
  // renders the host's OWN talking-head prompt as the right half. Always the motion lane — the
  // right half is a grok clip, never a Ken Burns still.
  const enhanceSplit = async ({
    scene,
  }: {
    scene: StoryboardScene;
  }): Promise<unknown> => {
    try {
      const result = await invokeGemini({
        systemPrompt: STILL_BROLL_ENHANCER_SYSTEM,
        userMessage:
          `${SPLIT_PANEL_PERSON_FREE_DIRECTIVE}\n` +
          channelLine +
          subjectLine +
          directionLine +
          beatLineFor(scene) +
          `Scene narration: "${scene.scriptText ?? scene.narration}"\n` +
          `Original prompt: ${splitSeedOf(scene)}\n\n` +
          `Enhanced prompt:`,
        maxTokens: 600,
      });
      if (result.stopReason === "max_tokens")
        throw new Error("rewrite truncated (max_tokens)");
      const enhanced = stripPromptArtifacts(result.text);
      if (enhanced) scene.splitVisual = enhanced;
      return null;
    } catch (err) {
      console.warn(
        `[enhanceBrollPrompts] splitVisual ${scene.index} failed, keeping original:`,
        err
      );
      return err ?? new Error("unknown error");
    }
  };

  const retrySplits: typeof splits = [];
  await mapPool(splits, BROLL_ENHANCE_CONCURRENCY, async item => {
    if (await enhanceSplit(item)) retrySplits.push(item);
  });
  for (const item of retrySplits) {
    const err = await enhanceSplit(item);
    if (err) noteFailure(item.scene.index, err);
  }

  // Deterministic book→on-topic swap over every scene's splitVisual. No LLM.
  // MUST stay AFTER the pass above: it is the only guard on splitVisual, so enhancing after it
  // would let an LLM-introduced book straight through — reintroducing what ac2cb89 fixed.
  // Unconditional over all scenes (not just `only`): idempotent, cheap, and catches a booky
  // splitVisual that predates this call.
  scenes.forEach((scene, i) => {
    if (scene.splitVisual && brollDepictsBook(scene.splitVisual)) {
      scene.splitVisual = genericCtaBrollFor(scenes, i);
    }
  });

  return {
    failedScenes: Array.from(new Set(failedScenes)).sort((a, b) => a - b),
    failReasons: failReasons.slice(0, 3),
  };
}

/** One warning string for all three enhance call sites, with the reason when we have one. */
function enhanceWarningFor(result: {
  failedScenes: number[];
  failReasons: string[];
}): string {
  return (
    `Prompt enhancement failed on scene(s) ${result.failedScenes.join(", ")} — ` +
    `original prompts kept` +
    (result.failReasons.length ? ` (${result.failReasons.join("; ")})` : "")
  );
}

async function runUnifiedPipeline(
  jobId: number,
  params: LongformInputParams,
  adapter: ReturnType<typeof createProviderAdapter>,
  ttsType: string,
  ttsKey: string
): Promise<void> {
  // Fresh run, fresh warnings — a completed job keeps its warnings, a re-run starts clean.
  clearJobWarnings(jobId);
  // The saved directing instruction is read once per session (admin-editable;
  // falls back to the default). Only the SPOKEN portion of the script is voiced —
  // any stray template preamble/marker is stripped so direction text is never read.
  const instruction =
    (await getAppSetting(LONGFORM_INSTRUCTION_KEY)) ??
    DEFAULT_LONGFORM_INSTRUCTION;
  const {
    script: spokenScript,
    spans: ctaSpans,
    errors: ctaErrors,
  } = parseCtaMarkers(extractSpokenScript(params.script));
  if (ctaErrors.length)
    console.warn(
      `[Longform ${jobId}] malformed CTA markers (router should have rejected): ` +
        ctaErrors.join("; ")
    );
  // The one whole-video subject, derived once (title, else a cheap LLM read of the script) and
  // threaded into every per-scene prompt so an ambiguous narration noun ("the meat") resolves to
  // the right subject instead of drifting (e.g. a "field dress a deer" video showing chicken).
  params.videoSubject = await deriveVideoSubject(params, spokenScript);
  // The one physical WORLD the whole video lives in (channel persona + full script), derived HERE —
  // before storyboarding — so the same world seeds every scene instead of only re-converging them
  // at the enhancer. Guard preserves an operator's persisted/hand-edited bible on regenerate (same
  // intent as the beats pass below). brollDepictsBook stays at this call site (import cycle), so a
  // book-mentioning bible never reaches the seeds.
  if (!params.visualStyleBible) {
    const bible = await deriveStyleBible(params, spokenScript);
    if (bible && brollDepictsBook(bible)) {
      appendJobWarning(
        jobId,
        "Style bible depicted printed matter — dropped; b-roll world consistency degraded"
      );
    } else if (bible) {
      params.visualStyleBible = bible;
    } else {
      appendJobWarning(
        jobId,
        "Style bible derivation failed after 2 attempts — b-roll world consistency degraded"
      );
    }
  }

  // ── Stage 1: storyboard — AI partitions the script into scenes (with verbatim slices) ──
  // Persist inputParams alongside the stage so a later regenerate reuses the derived subject.
  await updateLongformVideoJob(jobId, {
    stage: "storyboard",
    inputParams: params,
  });
  let scenes = await buildUnifiedScenes(
    params,
    spokenScript,
    instruction,
    ctaSpans,
    // Touch the row per batch so a long sequential storyboard isn't reaped as inactive.
    () =>
      void updateLongformVideoJob(jobId, { stage: "storyboard" }).catch(
        () => {}
      )
  );
  // Pre-TTS text gate: merge any scene carrying too few words to voice long enough to fill the
  // on-screen floor into a neighbor, so we never voice a scene that can only end in silence. The
  // measured post-TTS pass (below) still catches TTS-pace drift the word estimate missed.
  const beforeGate = scenes.length;
  const preWps = wpsForVoice(params.voiceId);
  scenes = coalesceShortScenes(scenes, wordSizeFor(preWps));
  if (scenes.length !== beforeGate) {
    console.log(
      `[Longform ${jobId}] pre-TTS text gate: merged sub-floor scenes ` +
        `${beforeGate} → ${scenes.length} (floor ${floorWordsFor(preWps)} words ` +
        `≈ ${SCENE_MIN_HOLD_SEC}s at ${preWps.toFixed(2)} words/sec)`
    );
  }
  if (params.brollOnly) {
    const demoted = demoteAllHostsToBroll(scenes);
    console.log(
      `[Longform ${jobId}] brollOnly: demoted ${demoted} host scene(s) → cutaways (0% host target)`
    );
  }
  await updateLongformVideoJob(jobId, {
    stage: "voiceover",
    storyboard: scenes,
    progress: jobProgress(jobId, {
      scenesTotal: scenes.length,
      scenesDone: 0,
    }),
  });

  // ── Stage 2: ONE continuous master narration, aligned + sliced back per scene ──
  // The whole spokenScript is voiced in a single 69Labs request (naturalness: one uninterrupted
  // read, no per-scene prosody restarts). We recover each scene's [start,end] inside the master
  // from Whisper word timings and slice the master into per-scene tracks — so every downstream
  // stage still sees a per-scene audioUrl + audioDuration and is otherwise untouched.
  await assertNotCancelled(jobId);
  const master = await voiceMasterNarration(
    jobId,
    ttsType,
    ttsKey,
    spokenScript,
    params
  );
  await assertNotCancelled(jobId);
  // Transcribe a mono-16k copy (keeps Whisper under its 25MB cap on long videos) for word
  // timings; any transcription failure falls back to a proportional (by-word-count) split.
  const monoAudio = await extractMonoAudio(master.url);
  // Word timings (for scene assignment) and real pauses (to snap cuts into silence) are both
  // read off the same mono copy, in parallel. The 0.04s scan is the snap's fallback tier: real
  // inter-word gaps can be as short as ~85ms, invisible to the 0.12s pause scan.
  let [transcript, silences, shortSilences] = await Promise.all([
    transcribeWordsFromBuffer(monoAudio),
    detectSilencesFromBuffer(monoAudio),
    detectSilencesFromBuffer(monoAudio, 0.04),
  ]);
  if ("error" in transcript) {
    // One retry before the proportional fallback: proportional slicing loses CTA/QR keyword
    // alignment (job 70), so a transient whisperx failure must not decide the whole film.
    console.warn(
      `[Longform ${jobId}] master transcription failed (${transcript.error}) — retrying once`
    );
    transcript = await transcribeWordsFromBuffer(monoAudio);
  }
  let words: WhisperWord[] | null = null;
  let masterDurationSec: number;
  if ("error" in transcript) {
    masterDurationSec = await probeUrlDurationSec(master.url, "mp3");
    console.warn(
      `[Longform ${jobId}] master transcription failed (${transcript.error}); ` +
        `slicing by proportional split over ${masterDurationSec.toFixed(1)}s`
    );
  } else {
    words = transcript.words;
    masterDurationSec = transcript.duration;
    console.log(
      `[Longform ${jobId}] master voiced ${masterDurationSec.toFixed(1)}s, ` +
        `${words.length} word timings across ${scenes.length} scenes`
    );
  }
  // Give every scene its slice of the master (sets scene.audioDuration; split/merge passes read it).
  assignSceneRanges(scenes, words, masterDurationSec);

  // Every scene is now voiced AND measured, so the job's real speech pace is recognized
  // (median words/sec) — used for the post-TTS split below and cached so future jobs with
  // this voice segment at the real pace from the start.
  const jobWps = recognizeVoiceWps(params.voiceId, scenes);
  if (jobWps !== null) {
    console.log(
      `[Longform ${jobId}] recognized speech pace ${jobWps.toFixed(2)} words/sec ` +
        `(segmented at ${preWps.toFixed(2)})`
    );
  }

  // ── Band enforcement WITHOUT re-voicing: a single master read can't re-synthesize one scene,
  // so we only RESHAPE boundaries (split over-long, merge sub-floor) and re-derive each scene's
  // range from the SAME master word timeline. The per-scene speed-nudge lever is therefore gone —
  // an outlier scene keeps its natural length and the on-screen floor below still holds it.
  // Runs before the lane balancers so they compute ratios on the final scene set.
  // The split partitions in WORD space but the ceiling is in SECONDS: children come back from
  // `assignSceneRanges` with their real measured length, and one spoken slower than its share can
  // land over the ceiling again. So re-measure and re-split until it settles.
  // ponytail: 3 passes — each pass strictly shortens the longest scene so it converges immediately;
  // the bound only stops a pathological script from looping.
  for (let pass = 1; pass <= 3; pass++) {
    const beforeSplit = scenes.length;
    scenes = splitOverlongScenes(scenes, jobWps ?? preWps);
    if (scenes.length === beforeSplit) break;
    assignSceneRanges(scenes, words, masterDurationSec);
    console.log(
      `[Longform ${jobId}] overlong split pass ${pass}: ${beforeSplit} → ${scenes.length} scenes (re-sliced)`
    );
  }
  const beforeCoalesce = scenes.length;
  // Every sub-floor scene either merges (replaced by a new object), borrows clauses off a
  // neighbor (kept by reference, audio cleared for the re-cut), or is floored in place — the
  // last of which freeze-pads on screen. Identity + a surviving audioUrl names exactly that set.
  const subFloor = scenes.filter(
    s => (s.audioDuration ?? 0) > 0 && (s.audioDuration ?? 0) < floorFor(s)
  );
  scenes = coalesceShortScenes(scenes);
  if (scenes.length !== beforeCoalesce || subFloor.length) {
    const floored = subFloor.filter(s => s.audioUrl && scenes.includes(s));
    console.log(
      `[Longform ${jobId}] short-scene merge: ${beforeCoalesce} → ${scenes.length} scenes ` +
        `(floor ${SCENE_MIN_HOLD_SEC}s, host ${HOST_MIN_HOLD_SEC}s); ` +
        `${subFloor.length} sub-floor, ${subFloor.length - floored.length} reshaped, ` +
        `${floored.length} held+padded${
          floored.length
            ? ` [${floored.map(s => `#${s.index}`).join(", ")}]`
            : ""
        }`
    );
  }

  // Final ranges after all reshaping has settled, then physically cut the master into per-scene
  // tracks and upload each (downstream stages consume scene.audioUrl exactly as before). Cuts are
  // snapped onto real pauses (never mid-word), so each slice is clean for lip-sync too.
  const sceneRanges = assignSceneRanges(
    scenes,
    words,
    masterDurationSec,
    silences,
    shortSilences
  );
  await assertNotCancelled(jobId);
  const sceneClips = await sliceAudioSegments(
    master.url,
    sceneRanges.map(r => ({
      startSec: r.startSec,
      // ponytail: 0.1s floor so a degenerate zero-length range never yields an empty ffmpeg cut.
      lenSec: Math.max(0.1, r.endSec - r.startSec),
    }))
  );
  await Promise.all(
    scenes.map(async (scene, i) => {
      const key = `longform/${jobId}/scene-${scene.index}-vo-${nanoid(6)}.mp3`;
      const { url } = await storagePut(key, sceneClips[i], "audio/mpeg");
      scene.audioUrl = url;
      // Persist the scene's slice of the master timeline — assembly lays the untouched
      // master over the whole film using these (seamless audio), with the per-scene
      // slices kept only as its fallback.
      scene.narrationStartSec = sceneRanges[i].startSec;
      scene.narrationEndSec = sceneRanges[i].endSec;
    })
  );

  // Hold every scene to its on-screen floor now that all durations are known: a sub-floor scene
  // freezes to SCENE_MIN_HOLD_SEC (last-frame freeze + silent apad in assembly). qrHero and
  // coverHero beats are skipped (they play their own narration with no pad). Same helper guards
  // the regenerate/retry path so no scene escapes.
  for (const s of scenes) applySceneHoldFloor(s);
  // Post-condition on the whole band-enforcement sequence, checked against the FINAL durations
  // (silence snapping above rewrites them by up to SNAP_TOLERANCE_SEC). A survivor here is a
  // clause-less over-long sentence — it renders one clip with a frozen tail rather than failing,
  // so this warning is the only thing that surfaces it.
  const overlong = describeOverlongScenes(scenes);
  if (overlong) console.warn(`[Longform ${jobId}] ${overlong}`);
  // A cold-open scene that still measures short here was packed for 4s of words and voiced under it
  // — the pace estimate (`wpsForVoice`) missed for this voice. It pads rather than speaks; log it,
  // since nothing else surfaces that drift.
  for (const s of scenes.filter(s => s.hostOpener)) {
    const spoken = (s.narrationEndSec ?? 0) - (s.narrationStartSec ?? 0);
    if (spoken > 0 && spoken < HOST_MIN_HOLD_SEC) {
      console.warn(
        `[Longform ${jobId}] cold open scene ${s.index} voiced ${spoken.toFixed(2)}s ` +
          `< ${HOST_MIN_HOLD_SEC}s — padded to the floor (voice pace drifted from the estimate)`
      );
    }
  }

  await updateLongformVideoJob(jobId, {
    storyboard: scenes,
    masterAudioUrl: master.url,
    progress: jobProgress(jobId, {
      scenesTotal: scenes.length,
      scenesDone: 0,
    }),
  });

  // Enforce the host-screen-time budget by exact runtime now that every scene's
  // narration length is measured — overshoot host scenes become b-roll before any
  // (slow, costly) clip is generated. See `rebalanceHostScreenTime`.
  const balance = rebalanceHostScreenTime(scenes);
  if (balance.demoted > 0) {
    const pct = (n: number) =>
      balance.total > 0 ? Math.round((n / balance.total) * 100) : 0;
    console.log(
      `[Longform ${jobId}] host screen time ${pct(balance.before)}% → ` +
        `${pct(balance.after)}% (target ${Math.round(HOST_SCREEN_FRACTION * 100)}%), ` +
        `demoted ${balance.demoted} host scene(s) to b-roll`
    );
  }

  // Split the host runtime between full-frame host and host-with-visual-beside, so the split
  // lane lands at ≈7.5% of total. See `enforceHostSplitMix`.
  const split = enforceHostSplitMix(scenes);
  if (split.hostSeconds > 0) {
    const totalPct = (n: number) =>
      balance.total > 0 ? Math.round((n / balance.total) * 100) : 0;
    console.log(
      `[Longform ${jobId}] host split: ${totalPct(split.splitSeconds)}% beside / ` +
        `${totalPct(split.aloneSeconds)}% alone of total ` +
        `(target ${Math.round(HOST_SPLITVISUAL_FRACTION * 100)}% of host is split)`
    );
  }

  // Converge the still-image share to STILL_IMAGE_FRACTION of total runtime before any clip
  // is rendered, so each scene routes down the correct lane (still vs video) with no waste.
  // Motion (plain b-roll + hands-at-work cutaways) is the remainder — the ~15% video-gen bucket.
  let mix: ReturnType<typeof enforceStillMotionRatio>;
  if (params.brollMotionOnly) {
    const forced = forceAllBrollMotion(scenes);
    const dur = (s: StoryboardScene) => s.audioDuration ?? 0;
    const eligible = scenes.filter(s => !s.hostPresent);
    const total = scenes.reduce((sum, s) => sum + dur(s), 0);
    const motionSeconds = eligible.reduce((sum, s) => sum + dur(s), 0);
    mix = {
      eligible: eligible.length,
      stillSeconds: 0,
      motionSeconds,
      total,
      motionPerQuarter: runtimeQuarters(scenes).map(q =>
        q.reduce(
          (sum, s) => sum + (!s.hostPresent && !s.stillImage ? dur(s) : 0),
          0
        )
      ),
    };
    console.log(
      `[Longform ${jobId}] brollMotionOnly: forced ${forced} cutaway(s) → 100% video clips (test mode)`
    );
  } else {
    mix = enforceStillMotionRatio(scenes);
    const mixPct = (n: number) =>
      mix.total > 0 ? Math.round((n / mix.total) * 100) : 0;
    console.log(
      `[Longform ${jobId}] cutaway mix: ${mixPct(mix.stillSeconds)}% still / ` +
        `${mixPct(mix.motionSeconds)}% motion of total ` +
        `(target ${Math.round(STILL_IMAGE_FRACTION * 100)}% still — a FLOOR: only ` +
        `flagged moving beats can be motion, so stills absorb the rest)`
    );
  }

  // Final adjacency guarantee: no two motion b-roll scenes back-to-back (a still always separates
  // them), and — unless the channel has a second host photo — no two host scenes either. With an
  // alt host photo, host pairs are kept and rendered from alternating angles instead. Also assigns
  // each host scene its camera angle (hostShot). Runs LAST so the ratio passes above can't
  // re-introduce a forbidden pair. See `enforceVisualAdjacency`.
  const adjacency = enforceVisualAdjacency(scenes, {
    hasAltHost: !!params.faceImageUrl2,
    allowAdjacentMotion: params.brollMotionOnly,
  });
  if (adjacency.hostBroken > 0 || adjacency.motionBroken > 0) {
    console.log(
      `[Longform ${jobId}] adjacency: broke ${adjacency.hostBroken} host / ` +
        `${adjacency.motionBroken} motion pair(s) by inserting stills`
    );
  }
  if (params.faceImageUrl2) {
    const totalPct = (n: number) =>
      mix.total > 0 ? Math.round((n / mix.total) * 100) : 0;
    console.log(
      `[Longform ${jobId}] host cameras: ${totalPct(adjacency.altSeconds)}% alt / ` +
        `${totalPct(split.aloneSeconds - adjacency.altSeconds)}% main / ` +
        `${totalPct(split.splitSeconds)}% split of total ` +
        `(targets 10 / 17.5 / 7.5)`
    );
  }

  // The ramp, measured on the FINAL lanes (after adjacency, which can convert motion → still).
  // Every production run self-verifies here: actual vs target, per quarter. Q1/Q2 host landing
  // consistently short is the signal that demote-only is not enough and host needs a promote path.
  const rampQuarters = runtimeQuarters(scenes);
  if (rampQuarters.length === 4) {
    const report = rampQuarters.map((quarter, q) => {
      const secs = quarter.reduce((sum, s) => sum + (s.audioDuration ?? 0), 0);
      const share = (pick: (s: StoryboardScene) => boolean) =>
        secs > 0
          ? Math.round(
              (quarter.reduce(
                (sum, s) => sum + (pick(s) ? (s.audioDuration ?? 0) : 0),
                0
              ) /
                secs) *
                100
            )
          : 0;
      const host = share(s => !!s.hostPresent);
      const video = share(s => !s.hostPresent && !s.stillImage);
      const still = share(s => !s.hostPresent && !!s.stillImage);
      // MOTION_RAMP is a ceiling, not a quota: only cutaways with a motion flag may be clips
      // (`parseStoryboard`), so a quarter with few moving beats CANNOT reach the target. `cap`
      // is the most video this quarter's material allows — video short of target but at cap is
      // correct, video short of BOTH is the balancer under-delivering.
      const cap = share(
        s => !s.hostPresent && (!!s.humanPresent || !!s.objectMotion)
      );
      const target = `${Math.round(HOST_RAMP[q] * 100)}/${Math.round(MOTION_RAMP[q] * 100)}/${Math.round((1 - HOST_RAMP[q] - MOTION_RAMP[q]) * 100)}`;
      return `Q${q + 1} ${host}/${video}/${still} (→${target}, video cap ${cap}%)`;
    });
    console.log(
      `[Longform ${jobId}] mix ramp: ${report.join("  ")}  [host/video/still % of each quarter]`
    );
  }

  // Derive the ONE visual world every b-roll cutaway in this video shares, from the channel's
  // persona layer + the full script, read once. Must run HERE: the beats key off scene.index
  // (final since coalesceShortScenes) but also need the final LANES — enforceHostSplitMix above
  // is what CREATES splitVisual, and enforceVisualAdjacency is what settles still-vs-motion.
  // Both fields ride the existing storyboard/inputParams writes, so regenerate reads them back
  // and never re-derives — which is also what keeps an operator's hand-edited bible safe.
  //
  // ponytail: one blocking call at the top of the enhance stage. The bible needs only
  // persona+script and could overlap Stage 2's TTS, but the beats need the post-balancer lanes.
  // Splitting it means keying beats to script offsets and fuzzy-matching back after the balancers
  // reshape the scene list. Revisit only if it shows up in job wall-clock — it currently sits
  // between minutes of TTS and tens of minutes of clip renders.
  // Beats pass: keys off the FINAL scene.index + lanes, so it runs HERE (after the balancers).
  // Pin the pre-storyboard bible so the beats key off the SAME world the seeds used; if that pass
  // produced no bible, this call's bible is a late fallback (helps the enhancer, though the seeds
  // already missed it).
  const direction = await deriveVisualDirection(
    params,
    scenes,
    params.visualStyleBible
  );
  if (!direction) {
    appendJobWarning(
      jobId,
      "Visual direction derivation failed — scene beats unavailable, b-roll uses per-scene prompts only"
    );
  }
  if (direction) {
    // The persona layer carries the channel's book/CTA strategy — it is literally what
    // extractBookName reads — so a book-mentioning bible stays a live risk however hard
    // VISUAL_DIRECTION_SYSTEM bans it. Same never-trust-the-LLM posture as the CTA lane.
    // brollDepictsBook can't move into visualDirection.ts (import cycle), so the sweep is here.
    // Only adopt this pass's bible when the pre-storyboard pass produced none — never clobber the
    // world the scenes were already seeded with (or an operator's hand-edited one).
    if (!params.visualStyleBible) {
      if (brollDepictsBook(direction.styleBible)) {
        console.warn(
          `[Longform ${jobId}] style bible depicted printed matter — dropped`
        );
      } else {
        params.visualStyleBible = direction.styleBible;
      }
    }
    for (const s of scenes) {
      const beat = direction.beats[s.index];
      if (beat && !brollDepictsBook(beat)) s.visualBeat = beat;
    }
  }

  // Enrich every b-roll visualPrompt with sensory detail, lighting mood, and (for video)
  // a motion cue before any clip is submitted. Runs in parallel; failures are silent.
  // (Over-long scenes were already split + re-voiced by splitOverlongScenes, above the balancers.)
  const enhanceResult = await enhanceBrollPrompts(scenes, params);
  if (enhanceResult.failedScenes.length) {
    appendJobWarning(jobId, enhanceWarningFor(enhanceResult));
  }

  // Safety net: no proper host name may reach 69labs ("well-known person" filter).
  // Scrub every scene's prompt fields once, after the last mutation stage, so
  // `buildClipChain` (69labs) gets clean text.
  const hostAliases = await hostNameAliases(params.channelKey);
  for (const s of scenes) {
    s.visualPrompt = stripHostNames(s.visualPrompt, hostAliases);
    if (s.splitVisual)
      s.splitVisual = stripHostNames(s.splitVisual, hostAliases);
  }

  // Guarantee the host appears on camera at least once across the CTA — run LAST, after the
  // balancers and prompt scrub, so nothing demotes it before clip generation. Its talking-head
  // prompt uses the generic descriptor (no host name), so it needs no further scrub.
  ensureHostInCta(scenes);
  // ensureHostInCta may have created a new host beat after the adjacency pass assigned angles —
  // re-derive so any surviving pair still reads main → alt. Pure and O(n); this is the last
  // mutation before the storyboard persists and clips render.
  assignHostShots(scenes, !!params.faceImageUrl2);
  // A configured alt photo that reaches the clip stage with no scene assigned to it means the
  // whole film renders single-angle — silently, since every scene still has a valid photo.
  // Job 181 shipped that way (hostShot unset on all 9 host scenes, and visualBeat gone too),
  // while 179 and 182 either side of it were fine on the same code — i.e. this block's writes
  // were clobbered, not skipped (`withJobLock` only opens below, so a watchdog/regen pass can
  // snapshot the pre-balancer storyboard here and write the whole array back). Warn rather
  // than widen the lock across this block for a race seen once.
  if (params.faceImageUrl2 && !scenes.some(s => s.hostShot === 1)) {
    console.warn(
      `[Longform ${jobId}] alt host photo configured but NO scene got the alt camera — ` +
        `every host shot will render from the primary photo`
    );
  }

  await assertNotCancelled(jobId);
  await updateLongformVideoJob(jobId, { stage: "clips", storyboard: scenes });

  // ── Stage 3: clips — host shots lip-synced to their narration, b-roll text-to-video ──
  // Host lip-sync needs a face photo + a HeyGen key; without either, host shots fall back
  // to text-to-video (which can't lip-sync the script — see plan).
  const lipsync = params.faceImageUrl
    ? await resolveLipsyncAdapter(params)
    : null;
  const persist = async () => {
    schedulePersist(jobId, { storyboard: scenes });
  };
  let clipDone = 0;
  const clipStageStart = Date.now();
  // Hold the per-job lock across the clip + assembly stages so an external resume/retry, the
  // watchdog, or a scene regen can't run a second submit pass for this job while it's still
  // rendering — that race produced duplicate 69Labs jobs and clobbered storyboard writes.
  // withJobLock releases automatically when the body settles (throw or return).
  await withJobLock(jobId, async () => {
    // Two provider lanes run concurrently: host (HeyGen) at heygenConcurrency, b-roll (69Labs)
    // at sixtynineVideoConcurrency. Feeds both providers to capacity instead of one shared pool
    // where host scenes blocking on HeyGen starve idle 69Labs capacity.
    await dispatchScenesByProvider(
      scenes,
      lipsync,
      params,
      async scene => {
        // Before the render so a cancellation unwinds the lane instead of being swallowed into
        // scene.error — no new scene clips start once cancelled (both lanes detect it here).
        await assertNotCancelled(jobId);
        try {
          await renderSceneClip(
            scene,
            jobId,
            adapter,
            params,
            lipsync,
            instruction,
            persist
          );
        } finally {
          clipDone++;
          schedulePersist(jobId, {
            storyboard: scenes,
            progress: jobProgress(jobId, {
              scenesTotal: scenes.length,
              scenesDone: clipDone,
            }),
          });
        }
      },
      jobId
    );
    // Drain coalesced progress writes before the stage transition / assembly reads.
    await flushPersist(jobId);

    // Headline timing for the full-script build: total clip wall-clock across both lanes.
    const rendering = scenes.filter(s => s.sceneStatus === "rendering").length;
    console.log(
      `[Longform ${jobId}] clips done in ${Math.round((Date.now() - clipStageStart) / 1000)}s | ` +
        `lanes 69labs=${ENV.sixtynineVideoConcurrency}/heygen=${ENV.heygenConcurrency} | ${scenes.length} scenes` +
        (rendering > 0 ? ` | ${rendering} still rendering (will resume)` : "")
    );

    // Scenes that timed out mid-poll kept rendering server-side while later scenes ran — many
    // have finished by now. Re-poll them once (short ceiling) before the completeness gate so
    // the common case completes in this pass rather than waiting for a user Retry / the watchdog.
    if (scenes.some(s => s.sceneStatus === "rendering")) {
      await resumeRenderingScenes(
        jobId,
        scenes,
        params,
        adapter,
        lipsync,
        instruction,
        persist
      );
    }

    // ── Completeness gate: never assemble a script-incomplete cut ──
    // If any scene ended without a clip, its narration would be silently dropped from the
    // final video (the audio would skip part of the script). Fail loudly instead — the user
    // can Regenerate the failed scene(s) and then Retry assembly. A still-"rendering" scene
    // (provider task not finished) is reported here too; Retry resumes it once it completes.
    const incomplete = describeIncompleteScenes(scenes);
    if (incomplete) throw new Error(incomplete);

    // ── Stage 4: assembly ──
    await assertNotCancelled(jobId);
    await updateLongformVideoJob(jobId, { stage: "assembly" });
    await assembleAndFinalize(jobId, scenes, params);
  });
}

// ─── Public API ────────────────────────────────────────────────────

/** Create a job row and return its id. */
export async function createLongformJob(
  userId: number,
  userName: string,
  params: LongformInputParams
): Promise<number | null> {
  // Clip count is derived from the (verbatim) narration length, which isn't known
  // until TTS runs; estimate from word count for the initial progress bar
  // (corrected once the narration is measured).
  const scenesTotal = Math.max(
    1,
    Math.ceil(
      parseCtaMarkers(extractSpokenScript(params.script))
        .script.trim()
        .split(/\s+/).length /
        (clipDurationParam(FIXED_CLIP_LEN) * WORDS_PER_SEC)
    )
  );
  return createLongformVideoJob({
    userId,
    userName,
    status: "processing",
    stage: "storyboard",
    inputParams: params,
    storyboard: [],
    progress: { scenesTotal, scenesDone: 0 },
  });
}

/**
 * Run the full pipeline for a job. Fire-and-forget; catches its own errors and
 * records them on the job row.
 */
export async function runLongformPipeline(jobId: number): Promise<void> {
  try {
    const job = await getLongformVideoJobById(jobId);
    if (!job) throw new Error("Job not found");
    const params = job.inputParams as LongformInputParams;

    const provider = await getActiveProvider();
    if (!provider) throw new Error("No active provider configured");
    const { providerType: videoType, apiKey: videoKey } =
      await resolveVideoProvider(provider);
    const adapter = createProviderAdapter(videoType as ProviderType, videoKey);
    const { providerType: ttsType, apiKey: ttsKey } =
      await resolveTTSProvider(provider);

    // Single unified path: verbatim continuous narration + AI host/b-roll storyboard.
    await runUnifiedPipeline(jobId, params, adapter, ttsType, ttsKey);
  } catch (err: any) {
    // Cancellation: the row was already set to failed/"Cancelled by user" by
    // cancelLongformJob — don't clobber it or log as an error.
    if (err instanceof JobCancelledError) {
      console.log(`[Longform ${jobId}] pipeline stopped — cancelled by user`);
      return;
    }

    // If the pipeline failed only because some renders are still in-flight on the provider
    // (not truly failed), don't mark the job failed — schedule a background retry so the
    // user doesn't wait 30 min for the watchdog to pick it up.
    if (
      typeof err.message === "string" &&
      err.message.includes("have no clip")
    ) {
      try {
        const freshJob = await getLongformVideoJobById(jobId);
        const freshScenes = (freshJob?.storyboard ?? []) as StoryboardScene[];
        if (freshScenes.some(s => s.sceneStatus === "rendering")) {
          const retryDelaySec = 180;
          console.log(
            `[Longform ${jobId}] ${freshScenes.filter(s => s.sceneStatus === "rendering").length} scene(s) still rendering — auto-retry in ${retryDelaySec}s`
          );
          setTimeout(
            () =>
              retryJobAssembly(jobId).catch(retryErr =>
                console.error(
                  `[Longform ${jobId}] auto-retry failed:`,
                  retryErr?.message
                )
              ),
            retryDelaySec * 1000
          );
          return; // Job remains "processing" — retryJobAssembly will update status
        }
      } catch {
        // Fall through to the normal failure path if re-reading the job fails
      }
    }

    console.error(`[Longform ${jobId}] pipeline failed:`, err);
    await updateLongformVideoJob(jobId, {
      status: "failed",
      errorMessage: err.message || "Unknown error",
      completedAt: new Date(),
    }).catch(onFailedStatusWriteError(jobId));
  }
}

/**
 * Stitch the ready scenes and mark the job complete. Each scene is assembled
 * INDEPENDENTLY — its clip(s) locked to its own narration slice — then the scenes are
 * concatenated in order, so every scene's visuals stay aligned to the audio under it.
 * Only host clips with a reference photo are head-trimmed (per `clipTrimFor`). Output
 * is always 16:9.
 */
/**
 * Catch handler for the write that marks a job failed. Rethrowing would replace the real
 * pipeline error with a DB error, so the write stays best-effort — but swallowing it silently
 * leaves the job stuck in `processing` with the cause gone, the same dead end a hung pass
 * produces, and with nothing in the logs to say why. So: still non-fatal, no longer invisible.
 */
function onFailedStatusWriteError(jobId: number) {
  return (dbErr: any) =>
    console.error(
      `[Longform ${jobId}] could not write status=failed — job will sit in "processing" until the stale-job watchdog reaps it:`,
      dbErr
    );
}

/** Group per-scene assembly failures into a short, human-readable cause summary for the job row. */
function summarizeSkips(skipped: { index: number; reason: string }[]): string {
  const categorize = (reason: string): string => {
    if (/Resource temporarily unavailable/i.test(reason))
      return 'ffmpeg "Resource temporarily unavailable" (host resource exhaustion)';
    if (/opening encoder/i.test(reason)) return "ffmpeg encoder init failure";
    if (/Failed to configure output pad/i.test(reason))
      return "ffmpeg scale/filter config failure";
    if (/Download failed/i.test(reason)) return "clip/audio download failed";
    return reason.length > 80 ? reason.slice(0, 80) + "…" : reason;
  };
  const counts = new Map<string, number>();
  for (const { reason } of skipped) {
    const cat = categorize(reason);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const causes = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${n}× ${cat}`)
    .join("; ");
  return `Causes: ${causes}. Scenes: ${skipped.map(d => d.index).join(", ")}`;
}

/**
 * Whether assembly may lay the continuous master narration over the whole film: the master
 * must be persisted and every scene must still carry a CONTIGUOUS slice of its timeline
 * (`narrationStartSec/EndSec` tile [0, master end] — a re-voiced or hand-edited scene breaks
 * the tiling and drops the job back to the per-scene audio concat path). Pure — unit-tested.
 */
export function masterOverlayEligible(
  scenes: StoryboardScene[],
  masterAudioUrl: string | null | undefined
): boolean {
  if (!masterAudioUrl || scenes.length === 0) return false;
  const eps = 1e-3;
  let prevEnd = 0;
  for (const s of scenes) {
    const start = s.narrationStartSec;
    const end = s.narrationEndSec;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if ((end as number) < (start as number) - eps) return false;
    if (Math.abs((start as number) - prevEnd) > eps) return false;
    prevEnd = end as number;
  }
  return true;
}

async function assembleAndFinalize(
  jobId: number,
  scenes: StoryboardScene[],
  params: LongformInputParams
): Promise<void> {
  // Completeness gate: every scene must have BOTH a clip and its narration, or its words
  // would be silently dropped from the final cut (desyncing the video from the script).
  // Fail loudly instead of shipping a partial video — covers the pipeline, regenerate, and
  // retry-assembly entry points. Recover via per-scene Regenerate, then Retry assembly.
  const notReady = scenes.filter(
    s => !((s.clipUrls?.length || s.clipUrl) && s.audioUrl)
  );
  if (notReady.length > 0) {
    const detail = notReady
      .map(s => `scene ${s.index}${s.error ? ` (${s.error})` : ""}`)
      .join(", ");
    throw new Error(
      `${notReady.length} scene(s) not ready (missing clip or narration) — not assembling a partial video: ${detail}`
    );
  }

  // Master-overlay eligibility: pass the persisted master + per-scene timeline slices through
  // to assembly (seamless audio); an ineligible job (pre-overlay, or a scene re-voiced
  // off-master) simply omits them and assembly keeps the per-scene audio concat path.
  const sorted = scenes.slice().sort((a, b) => a.index - b.index);
  const job = await getLongformVideoJobById(jobId);
  const masterAudioUrl = masterOverlayEligible(sorted, job?.masterAudioUrl)
    ? (job?.masterAudioUrl as string)
    : undefined;
  if (job?.masterAudioUrl && !masterAudioUrl) {
    console.warn(
      `[Longform ${jobId}] master overlay ineligible (broken scene range tiling) — per-scene audio concat`
    );
  }

  const readyScenes = scenes
    .filter(s => (s.clipUrls?.length || s.clipUrl) && s.audioUrl)
    .sort((a, b) => a.index - b.index);
  const ready = readyScenes.map(s => ({
    clipUrls: s.clipUrls?.length ? s.clipUrls : [s.clipUrl as string],
    trimLeadSec: clipTrimFor(s, params.faceImageUrl),
    audioUrl: s.audioUrl as string,
    // Covers ignore the stored duration — pre-6db7131 jobs persisted the old 5s
    // COVER_HOLD_SEC floor into audioDuration, which would freeze the cover over
    // trailing silence; the cover must end with its measured narration.
    audioDurationSec: s.coverHero ? undefined : s.audioDuration,
    // The QR draws ONLY on anchored beats — the big-QR "grab your phone" block (qrHero) and the
    // small pre-cover scan window (qrCorner) — never on ordinary cta/price scenes, so a spoken
    // dollar amount can't surface it. The cover-reveal beat is left clean so the cover reads.
    qrOverlayUrl: qrOverlayUrlFor(s, params.qrImageUrl),
    // qrHero → large centered QR; a qrCorner-only beat → small bottom-right corner QR.
    qrPlacement: (s.qrHero ? "center" : "corner") as "corner" | "center",
    // The block's release beat holds a silent frozen QR_TAIL_HOLD_SEC tail so the QR lingers
    // ~3s past "I'll wait right here" (extended in assembly via tpad/apad).
    tailHoldSec: s.qrTail ? QR_TAIL_HOLD_SEC : undefined,
    // The scene's slice of the master timeline (overlay mode only).
    sliceStartSec: masterAudioUrl ? s.narrationStartSec : undefined,
    sliceEndSec: masterAudioUrl ? s.narrationEndSec : undefined,
  }));

  // Host lower third ("Riley Danvers" / "Gardener" / "Fresno, CA"), held continuously across the
  // locked cold open. Entirely non-fatal: a render failure — or no host identity on the channel,
  // or no host shot at all — just means the film ships without a card.
  let nameCard: { png: Buffer; sceneIndices: number[] } | undefined;
  const nameCardScenes = nameCardSceneIndices(readyScenes);
  if (nameCardScenes.length > 0) {
    try {
      const png = await renderNameCardPng({
        name: params.hostName,
        title: params.hostTitle,
        location: params.hostLocation,
        ...dimensionsFor(TALKING_HEAD_ASPECT_RATIO),
      });
      if (png) nameCard = { png, sceneIndices: nameCardScenes };
    } catch (err: any) {
      console.warn(
        `[Longform ${jobId}] name card render failed, continuing without it: ${err.message}`
      );
    }
  }

  // Music bed under the narration, drawn from THIS channel's set — each persona's beds are
  // generated to its voice and niche. Seeded by jobId so a retried assembly rebuilds the SAME
  // soundtrack; sized off the summed scene runtime (assembly re-plans against the real film
  // length, and over-supplying beds is free).
  const filmSec = ready.reduce((t, s) => t + (s.audioDurationSec ?? 0), 0);
  const musicBedUrls = pickMusicBeds(
    planMusicSchedule(filmSec).length || 1,
    String(jobId),
    params.channelKey
  );

  // Assembly is the one stage with no wall clock and no per-step progress write, so a hang here
  // is invisible: the job heartbeats on, the resume sweep skips it, and the stale-job reaper
  // never fires. These three timings are the minimum needed to tell a slow assembly from a
  // parked one — and to size any future stall budget off measurements rather than a guess.
  const assemblyStart = Date.now();
  const sinceStart = () => Math.round((Date.now() - assemblyStart) / 1000);
  console.log(
    `[Longform ${jobId}] assembly start | ${ready.length} scenes | ${Math.round(filmSec)}s film | ${masterAudioUrl ? "master overlay" : "per-scene concat"}`
  );

  const { buffer, skipped } = await assemblePerSceneFilm({
    scenes: ready,
    aspectRatio: TALKING_HEAD_ASPECT_RATIO,
    masterAudioUrl,
    nameCard,
    musicBedUrls,
  });
  console.log(
    `[Longform ${jobId}] assembly rendered in ${sinceStart()}s | ${Math.round(buffer.length / 1e6)}MB | uploading`
  );

  if (skipped.length > 0) {
    const indices = skipped.map(d => d.index).join(", ");
    console.warn(
      `[Longform ${jobId}] assembly skipped ${skipped.length} scene(s): ${indices}`
    );
    // ANY drop fails the film. The old threshold (>2) let one or two scenes vanish silently — the
    // job settled to "completed" with the loss recorded nowhere but a console.warn, and prod job
    // 199 shipped ~17s short of its script. A dropped scene loses its narration too (a skip
    // disables the master-overlay path), so there is no such thing as a harmless one.
    // Surface the actual causes (not just a count) so the failure is diagnosable from the job
    // row instead of the Railway logs. Clips/audio stay in storage — recover via Retry assembly.
    throw new Error(
      `Assembly dropped ${skipped.length}/${ready.length} scene(s) — not uploading a truncated video. ${summarizeSkips(skipped)}`
    );
  }

  const key = `longform/${jobId}/final-${nanoid(8)}.mp4`;
  const uploadStart = Date.now();
  const { url } = await storagePut(key, buffer, "video/mp4");
  console.log(
    `[Longform ${jobId}] final upload done in ${Math.round((Date.now() - uploadStart) / 1000)}s | assembly total ${sinceStart()}s`
  );

  await updateLongformVideoJob(jobId, {
    status: "completed",
    stage: "done",
    finalVideoUrl: url,
    finalFileKey: key,
    completedAt: new Date(),
  });
}

/**
 * Settle a job to done WITHOUT re-stitching — the chosen clips are freshly rendered
 * but the final cut is intentionally left un-assembled until the user clicks Assemble.
 * Clears finalVideoUrl so the UI hides the now-stale cut and surfaces the Assemble
 * button, and so retryJobAssembly's "already finished" short-circuit is bypassed (it
 * only fires when finalVideoUrl is present) — i.e. Assemble genuinely re-encodes.
 * The prior final-*.mp4 stays on storage as a backup; assembly overwrites finalFileKey.
 */
async function settleRenderOnly(
  jobId: number,
  scenes: StoryboardScene[]
): Promise<void> {
  await updateLongformVideoJob(jobId, {
    status: "completed",
    stage: "done",
    storyboard: scenes,
    finalVideoUrl: null,
    errorMessage: null,
    completedAt: new Date(),
  });
}

/** Mark a running job as cancelled (best-effort; background pipeline keeps its slot). */
export async function cancelLongformJob(
  jobId: number,
  userId: number
): Promise<void> {
  const job = await getLongformVideoJobById(jobId);
  if (!job || job.userId !== userId) throw new Error("Job not found");
  await updateLongformVideoJob(jobId, {
    status: "failed",
    errorMessage: "Cancelled by user",
    completedAt: new Date(),
  });
}

/**
 * Resume any scenes whose render tasks timed out mid-poll: re-poll the persisted provider
 * taskIds (the renders kept running server-side) and download the finished clips instead of
 * re-submitting. Loads the job, reconstructs the same adapters the pipeline used, and resumes.
 * Returns true if every scene now has a clip (job is ready to assemble). Safe to call on a job
 * with no pending renders — it's a no-op that just reports completeness.
 */
export async function resumePendingRenders(jobId: number): Promise<boolean> {
  if (jobLocks.has(jobId)) return false; // another pass owns this job's lock
  return withJobLock(jobId, () => resumePendingRendersLocked(jobId));
}

/** Core of resumePendingRenders — assumes the caller already holds the job lock (withJobLock)
 * (so a lock-holder like retryJobAssembly/retryFailedScenes can call it without self-deadlock). */
async function resumePendingRendersLocked(jobId: number): Promise<boolean> {
  const job = await getLongformVideoJobById(jobId);
  if (!job) return false;
  const params = job.inputParams as LongformInputParams;
  const scenes = (job.storyboard as StoryboardScene[]) || [];
  if (!scenes.some(s => s.renderTaskIds?.length)) {
    return describeIncompleteScenes(scenes) === null;
  }

  const provider = await getActiveProvider();
  if (!provider) return false;
  const { providerType: videoType, apiKey: videoKey } =
    await resolveVideoProvider(provider);
  const adapter = createProviderAdapter(videoType as ProviderType, videoKey);
  const lipsync = params.faceImageUrl
    ? await resolveLipsyncAdapter(params)
    : null;
  const instruction =
    (await getAppSetting(LONGFORM_INSTRUCTION_KEY)) ??
    DEFAULT_LONGFORM_INSTRUCTION;
  const persist = async () => {
    schedulePersist(jobId, { storyboard: scenes });
  };

  await resumeRenderingScenes(
    jobId,
    scenes,
    params,
    adapter,
    lipsync,
    instruction,
    persist
  );
  await flushPersist(jobId);
  return describeIncompleteScenes(scenes) === null;
}

/**
 * Re-run the assembly stage for a job whose clips and audio are already
 * generated (e.g. after a server restart killed the pipeline mid-stitch).
 * Resets the job to processing/assembly so the UI and watchdog see active state.
 * First resumes any scenes still rendering on the provider so a timed-out job
 * completes on Retry instead of failing again (and without re-submitting renders).
 */
export async function retryJobAssembly(jobId: number): Promise<void> {
  if (jobLocks.has(jobId)) return; // an active pass will finish + assemble this job
  await withJobLock(jobId, async () => {
    const job = await getLongformVideoJobById(jobId);
    if (!job) throw new Error("Job not found");
    const params = job.inputParams as LongformInputParams;

    // Already-finished job: a valid final exists and every scene has a clip. Re-encoding it
    // gains nothing and, on a big film, risks re-breaking a good cut when the host runs out of
    // ffmpeg headroom (EAGAIN). Just settle the row to done — don't touch the existing final.
    const scenes0 = (job.storyboard as StoryboardScene[]) || [];
    if (job.finalVideoUrl && describeIncompleteScenes(scenes0) === null) {
      await updateLongformVideoJob(jobId, {
        status: "completed",
        stage: "done",
        errorMessage: null,
      });
      return;
    }

    await updateLongformVideoJob(jobId, {
      status: "processing",
      stage: "clips",
      errorMessage: null,
    });

    try {
      // Resume in-flight renders first, then re-load the (possibly updated) storyboard.
      await resumePendingRendersLocked(jobId); // we already hold the lock
      const fresh = await getLongformVideoJobById(jobId);
      const scenes = (fresh?.storyboard as StoryboardScene[]) || [];
      await updateLongformVideoJob(jobId, { stage: "assembly" });
      await assembleAndFinalize(jobId, scenes, params);
    } catch (err: any) {
      await updateLongformVideoJob(jobId, {
        status: "failed",
        errorMessage: err.message || "Assembly failed",
        completedAt: new Date(),
      }).catch(onFailedStatusWriteError(jobId));
      throw err;
    }
  });
}

// Tracks jobId:sceneIndex pairs currently regenerating so duplicate concurrent requests
// (caused by the fire-and-forget tRPC pattern re-enabling the button before work starts)
// don't each submit a fresh 69Labs job.
const activeRegenerations = new Set<string>();

/** True while any scene of this job is mid-regeneration — so the recovery watchdog
 * doesn't auto-assemble a job the user is actively editing. */
export function isJobRegenerating(jobId: number): boolean {
  const prefix = `${jobId}:`;
  return Array.from(activeRegenerations).some(k => k.startsWith(prefix));
}

// A job's storyboard is one JSON blob, and every pass (pipeline clip stage, watchdog
// retryJobAssembly, tRPC resume/retry, AND scene regen) loads its own in-memory `scenes`
// snapshot and writes the WHOLE array back. Run two passes for one job at once and their writes
// clobber each other (last writer wins): a scene one pass just rendered gets reverted to
// clip-less, and a status-driven re-render loop then re-renders it — so regenerating one scene
// silently regenerates a random other. withJobLock serializes every whole-storyboard pass per
// job so their snapshots never overlap. Keyed by jobId → different jobs stay fully parallel.
// Queues (never drops): a second regen waits, then snapshots the fresh post-persist storyboard.
// NOT re-entrant — inside a withJobLock body call only the *Locked cores, never the wrapper
// variants, or the same-job chain deadlocks.
// ponytail: in-memory, single-process. If the server is ever run multi-instance, move this to a
// DB/advisory lock keyed by jobId.
const jobLocks = new Map<number, Promise<unknown>>();

export function withJobLock<T>(
  jobId: number,
  fn: () => Promise<T>
): Promise<T> {
  // Heartbeat for as long as THIS pass owns the job. The lock body (clips + assembly, resume,
  // retry, regen) can legitimately run far past the 30-min `markStaleLongformJobsFailed` window
  // without a DB write of its own — prod job 136 died mid-assembly with all 252 clips rendered,
  // and 140/141/143 died mid-clips one scene short. Touching `updatedAt` every 60s means the
  // watchdog only reaps jobs whose process is actually gone: the lock dies with the process, so
  // the heartbeat dies with it too.
  // MUST set `updatedAt` explicitly — MySQL fires ON UPDATE CURRENT_TIMESTAMP only when a column
  // value actually changes, so writing `{ status: "processing" }` to an already-processing row is
  // a no-op and would silently heartbeat nothing.
  const guarded = async () => {
    const beat = setInterval(() => {
      void updateLongformVideoJob(jobId, { updatedAt: new Date() }).catch(
        () => {}
      );
    }, 60_000);
    if (typeof beat.unref === "function") beat.unref();
    try {
      return await fn();
    } finally {
      clearInterval(beat);
    }
  };
  const prev = jobLocks.get(jobId) ?? Promise.resolve();
  // `guarded`, not `fn` — a queued second pass must not heartbeat while it's merely waiting here.
  const run = prev.then(guarded, guarded); // run after the prior pass settles, either outcome
  // tail never rejects, so one failing pass can't wedge the job's queue.
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  jobLocks.set(jobId, tail);
  void tail.then(() => {
    if (jobLocks.get(jobId) === tail) jobLocks.delete(jobId);
  });
  return run;
}

/** True while any whole-storyboard pass (render/resume/retry/regen) owns this job's lock
 * (so the watchdog skips it). */
export function isJobRendering(jobId: number): boolean {
  return jobLocks.has(jobId);
}

/**
 * Render one scene's clip in place (and its voiceover if missing), discarding any stale
 * in-flight taskIds so this is a FRESH submit (not a resume). Dispatches host (HeyGen
 * lip-sync), still-image, and b-roll (69Labs) scenes via `generateSceneClips`. Mutates the
 * scene (status, clipUrls, audio) and persists. Throws on a terminal render failure — the
 * caller decides how to surface it (single-scene regen vs. batch retry). Shared by
 * `regenerateScene` and `retryFailedScenes`.
 */
async function renderSceneClipInPlace(
  jobId: number,
  scene: StoryboardScene,
  scenes: StoryboardScene[],
  params: LongformInputParams,
  adapter: ReturnType<typeof createProviderAdapter>,
  ttsType: string,
  ttsKey: string,
  lipsync: LipsyncLane | null,
  instruction: string
): Promise<void> {
  scene.sceneStatus = "processing";
  scene.error = undefined;
  // Force a FRESH render — discard any persisted in-flight taskIds so we re-submit rather
  // than resume, and restart the clip chain at element 0 (a prior failure inside this path
  // can leave renderModelIndex parked mid-chain).
  scene.renderTaskIds = undefined;
  scene.renderProvider = undefined;
  scene.renderModelIndex = undefined;
  scene.renderAttempts = undefined;
  const persist = async () => {
    schedulePersist(jobId, { storyboard: scenes });
  };
  // Each scene voices its own slice; if its audio is missing (or we lack a measured
  // duration to size clips), (re)build it from `scriptText`. The visuals may change, the
  // spoken slice does not — so we keep the existing audio when it's present.
  if (!scene.audioUrl || scene.audioDuration == null) {
    const { url, durationSec } = await buildSceneNarration(
      jobId,
      ttsType,
      ttsKey,
      scene,
      params
    );
    scene.audioUrl = url;
    scene.audioDuration = durationSec;
    // Fresh TTS is NOT a slice of the master narration — clear the scene's master-timeline
    // range so assembly drops the whole job back to the per-scene audio concat path (a
    // master overlay would desync from here on). Any ops script that replaces a scene's
    // audioUrl off-master must do the same.
    scene.narrationStartSec = undefined;
    scene.narrationEndSec = undefined;
  }
  // Re-voicing here yields the raw narration length; hold it to the floor like the main pipeline
  // so a regenerated/retried short scene freezes to SCENE_MIN_HOLD_SEC instead of cutting short.
  applySceneHoldFloor(scene);
  // The ceiling can't be enforced the same way: splitting one scene here would renumber the whole
  // storyboard mid-render. A re-voice that lands over it renders one clip with a frozen tail — warn
  // so the drift is visible instead of silently padded.
  const overlong = describeOverlongScenes([scene]);
  if (overlong) console.warn(`[Longform ${jobId}] ${overlong}`);
  scene.clipUrls = await withTransientRetry(
    () => {
      // Fresh resubmit each attempt — discard any in-flight taskIds from the prior try
      // and restart the clip chain at element 0.
      scene.renderTaskIds = undefined;
      scene.renderProvider = undefined;
      scene.renderModelIndex = undefined;
      scene.renderAttempts = undefined;
      scene.sceneStatus = "processing";
      scene.error = undefined;
      return generateSceneClips(
        adapter,
        jobId,
        scene,
        params,
        lipsync,
        instruction,
        persist
      );
    },
    {
      onRetry: (attempt, err) =>
        console.warn(
          `[Longform ${jobId}] scene ${scene.index} transient render failure ` +
            `(attempt ${attempt}) — retrying: ${err.message}`
        ),
    }
  );
  syncSceneClipFields(scene);
  scene.sceneStatus = "completed";
}

/**
 * Regenerate ONLY the RIGHT panel of a split-screen scene, keeping the lip-synced host on the
 * LEFT exactly as it was. The host render is the expensive, slow, non-deterministic half and
 * the operator is almost never trying to change it — the right still is. So: render a fresh
 * still from `splitVisual`, composite it onto the stored host clips, done. No lip-sync
 * provider call, no TTS.
 *
 * Scenes rendered before `hostClipUrls` existed carry only the finished composite; for those,
 * crop the host panel back out of it once (`extractHostPanel`) and store the result, so this
 * scene's next regenerate is a straight reuse.
 *
 * Deliberately leaves `audioUrl` / `narrationStartSec` / `narrationEndSec` alone — the spoken
 * slice hasn't changed, so the job stays on the master-audio overlay path at assembly (the
 * per-scene re-voice in `renderSceneClipInPlace` is what drops a job off it). And unlike the
 * render path there is no fall-back-to-full-frame-host on failure: the operator asked for a
 * new right panel, so a failure must surface as a failed scene, not a silently un-split clip.
 */
async function regenerateSplitRight(
  jobId: number,
  scene: StoryboardScene,
  scenes: StoryboardScene[],
  params: LongformInputParams
): Promise<void> {
  scene.sceneStatus = "processing";
  scene.error = undefined;
  const dims = dimensionsFor(TALKING_HEAD_ASPECT_RATIO);

  if (!scene.hostClipUrls?.length) {
    const existing = scene.clipUrls?.length
      ? scene.clipUrls
      : scene.clipUrl
        ? [scene.clipUrl]
        : [];
    if (!existing.length)
      throw new Error(
        `scene ${scene.index} has no host clip to reuse — render it before regenerating its split panel`
      );
    const recovered: string[] = [];
    for (let i = 0; i < existing.length; i++) {
      const buf = await extractHostPanel(existing[i], dims);
      const key = `longform/${jobId}/host-${scene.index}-${i}-${nanoid(6)}.mp4`;
      const { url } = await storagePut(key, buf, "video/mp4");
      recovered.push(url);
    }
    scene.hostClipUrls = recovered;
    schedulePersist(jobId, { storyboard: scenes });
  }

  const rightUrl = await renderSplitRightClip(jobId, scene, params);
  const composited: string[] = [];
  for (let i = 0; i < scene.hostClipUrls.length; i++) {
    const buf = await compositeSplitScreenClip(
      scene.hostClipUrls[i],
      rightUrl,
      dims
    );
    const key = `longform/${jobId}/split-${scene.index}-${i}-${nanoid(6)}.mp4`;
    const { url } = await storagePut(key, buf, "video/mp4");
    composited.push(url);
  }
  scene.clipUrls = composited;
  syncSceneClipFields(scene);
  scene.sceneStatus = "completed";
}

/**
 * Regenerate a single scene's clip (and voiceover if missing), then re-stitch.
 * Used by the review/regenerate path. Returns when finished.
 *
 * `verbatim` renders a non-host `customVisualPrompt` EXACTLY as given — it skips the
 * enhanceBrollPrompts rewrite (and its host-name scrub), matching the batch
 * `verbatimIndices` semantics. The UI sets it when the operator actually edited the prompt.
 *
 * SPLIT-SCREEN scenes take a different path entirely: only their RIGHT panel re-renders and
 * the lip-synced host is reused (see `regenerateSplitRight`). `customSplitVisual` — not
 * `customVisualPrompt` — is the prompt that moves them; on a lip-synced host scene
 * `visualPrompt` is sent to no model at all.
 */
export async function regenerateScene(
  jobId: number,
  sceneIndex: number,
  customVisualPrompt?: string,
  verbatim?: boolean,
  customSplitVisual?: string
): Promise<void> {
  const key = `${jobId}:${sceneIndex}`;
  if (activeRegenerations.has(key)) {
    console.warn(
      `[Longform ${jobId}] Scene ${sceneIndex} regeneration already in progress — ignoring duplicate`
    );
    return;
  }
  activeRegenerations.add(key);
  try {
    await withJobLock(jobId, async () => {
      const job = await getLongformVideoJobById(jobId);
      if (!job) throw new Error("Job not found");
      const params = job.inputParams as LongformInputParams;
      const scenes = (job.storyboard as StoryboardScene[]) || [];
      const scene = scenes.find(s => s.index === sceneIndex);
      if (!scene) throw new Error(`Scene ${sceneIndex} not found`);

      // Apply the operator's prompt before the early persist below, so the client can
      // drop its local override on mutation success and poll the new value back. (On a
      // host scene visualPrompt isn't rendered — lip-sync uses its own prompt — so it's
      // effectively verbatim metadata either way.)
      if (customVisualPrompt) scene.visualPrompt = customVisualPrompt;

      // A split scene regenerates its RIGHT panel only — the host clip on the left is reused.
      // Its editable prompt is `splitVisual`, so that (not visualPrompt) is what the operator's
      // text lands on.
      const splitOnly = isSplitScene(scene);
      if (splitOnly && customSplitVisual) scene.splitVisual = customSplitVisual;
      const edited = splitOnly ? !!customSplitVisual : !!customVisualPrompt;

      // A verbatim edit is the operator taking this scene's direction by hand, so it becomes the
      // baseline any LATER re-enhance rewrites from — otherwise the next non-verbatim regen
      // rewrites the pre-edit seed and the typed intent vanishes with no trace.
      // ponytail: visualBeat is deliberately NOT cleared here — a verbatim render skips the
      // enhancer, so clearing only stripped the script arc off that later re-enhance. The batch
      // path never cleared it either.
      if (verbatim && edited) {
        if (splitOnly) scene.splitVisualSeed = scene.splitVisual;
        else scene.visualPromptSeed = scene.visualPrompt;
      }

      // Flip processing BEFORE the slow LLM re-enhance below and persist the scene's
      // in-flight status, so the client's very next poll confirms the regen started
      // (its queued-scene spinner settles on seen-processing → terminal, not on the
      // stale pre-regen snapshot). Any throw before the render must un-strand this.
      scene.sceneStatus = "processing";
      scene.error = undefined;
      await updateLongformVideoJob(jobId, {
        status: "processing",
        stage: "clips",
        storyboard: scenes,
      });

      // Definite-assignment (!): the catch below re-throws, so past it these are set.
      let adapter!: ReturnType<typeof createProviderAdapter>;
      let ttsType!: string;
      let ttsKey!: string;
      let instruction!: string;
      let lipsync!: LipsyncLane | null;
      try {
        if ((!scene.hostPresent || splitOnly) && !(verbatim && edited)) {
          // Default: customVisualPrompt is a SEED — enhanceBrollPrompts rewrites it with the
          // video subject threaded in (subjectLine), so regenerates never lose topic context.
          // Then scrub host names like the main pipeline (longformVideo.ts:5108-5112).
          // Verbatim (operator-edited prompt) skips both, like batch verbatimIndices.
          // Anchor on the title first (wins over any stale/empty persisted subject) so the
          // re-enhance is always subject-grounded — a titled job resolves synchronously.
          await ensureVideoSubject(params);
          const regenEnhance = await enhanceBrollPrompts(scenes, params, [
            sceneIndex,
          ]);
          if (regenEnhance.failedScenes.length) {
            appendJobWarning(jobId, enhanceWarningFor(regenEnhance));
          }
          const aliases = await hostNameAliases(params.channelKey);
          scene.visualPrompt = stripHostNames(scene.visualPrompt, aliases);
          if (scene.splitVisual)
            scene.splitVisual = stripHostNames(scene.splitVisual, aliases);
        }

        // A split regen renders one still and re-composites — no video model, no TTS, no
        // lip-sync lane. Skip resolving them so a missing/paused provider can't fail a
        // regenerate that never needed one.
        if (!splitOnly) {
          const provider = await getActiveProvider();
          if (!provider) throw new Error("No active provider configured");
          const { providerType: videoType, apiKey: videoKey } =
            await resolveVideoProvider(provider);
          adapter = createProviderAdapter(videoType as ProviderType, videoKey);
          ({ providerType: ttsType, apiKey: ttsKey } =
            await resolveTTSProvider(provider));
          instruction =
            (await getAppSetting(LONGFORM_INSTRUCTION_KEY)) ??
            DEFAULT_LONGFORM_INSTRUCTION;
          lipsync = params.faceImageUrl
            ? await resolveLipsyncAdapter(params)
            : null;
        }
      } catch (e: any) {
        // Pre-render failure after the early "processing" flip — settle the job back to
        // done-with-error exactly like the render-failure path so it can't strand "processing".
        scene.sceneStatus = "failed";
        scene.error = e.message;
        await updateLongformVideoJob(jobId, {
          status: "completed",
          stage: "done",
          storyboard: scenes,
          errorMessage: `Scene ${sceneIndex} regeneration failed: ${e.message}`,
        });
        throw e;
      }

      try {
        if (splitOnly) {
          await regenerateSplitRight(jobId, scene, scenes, params);
        } else {
          await renderSceneClipInPlace(
            jobId,
            scene,
            scenes,
            params,
            adapter,
            ttsType,
            ttsKey,
            lipsync,
            instruction
          );
        }
      } catch (e: any) {
        scene.sceneStatus = "failed";
        scene.error = e.message;
        await flushPersist(jobId);
        await updateLongformVideoJob(jobId, {
          status: "completed",
          stage: "done",
          storyboard: scenes,
          errorMessage: `Scene ${sceneIndex} regeneration failed: ${e.message}`,
        });
        throw e;
      }

      scene.regenerated = true;
      await flushPersist(jobId);
      // Render-only: leave the film un-stitched so the operator can preview this clip
      // before committing to a re-encode. The stale cut is hidden and the manual
      // Assemble button rebuilds it (regeneration and assembly are separate).
      await settleRenderOnly(jobId, scenes);
    });
  } finally {
    activeRegenerations.delete(key);
  }
}

/**
 * Regenerate a chosen set of scenes (storyboard multi-select → batch regen), then assemble
 * once. Mirrors `retryFailedScenes` but targets scenes by index and force-clears their clips
 * so they actually re-render (vs. retry, which only fills clip-less scenes). `promptOverrides`
 * (from the storyboard editor) replace a scene's `visualPrompt` before render; unedited scenes
 * keep their existing prompt. Renders concurrently via `dispatchScenesByProvider`, then
 * stitches once; fails loudly listing any holdouts.
 *
 * `verbatimIndices` lists non-host scenes whose override must render EXACTLY as given — they skip
 * `enhanceBrollPrompts`. Use only when the enhancer keeps steering a scene wrong (e.g. narration
 * that trips content policy back onto graphic content); normal edits stay seeds and re-enhance.
 *
 * Split-screen targets follow the same rule as the single-scene path: only their RIGHT panel
 * re-renders (`regenerateSplitRight`), driven by the override's `splitVisual`.
 */
export async function regenerateScenes(
  jobId: number,
  sceneIndices: number[],
  promptOverrides?: Array<{
    index: number;
    visualPrompt?: string;
    splitVisual?: string;
  }>,
  verbatimIndices?: number[]
): Promise<void> {
  // Dedup against in-flight single/batch regens (fire-and-forget tRPC can double-fire).
  const wanted = sceneIndices.filter(
    i => !activeRegenerations.has(`${jobId}:${i}`)
  );
  if (wanted.length === 0) {
    console.warn(
      `[Longform ${jobId}] All requested scenes already regenerating — ignoring`
    );
    return;
  }
  wanted.forEach(i => activeRegenerations.add(`${jobId}:${i}`));
  const wantedSet = new Set(wanted);
  try {
    await withJobLock(jobId, async () => {
      const job = await getLongformVideoJobById(jobId);
      if (!job) throw new Error("Job not found");
      const params = job.inputParams as LongformInputParams;
      const scenes = (job.storyboard as StoryboardScene[]) || [];
      const targets = scenes.filter(s => wantedSet.has(s.index));
      if (targets.length === 0)
        throw new Error("No matching scenes to regenerate");

      // Apply edited prompts as SEEDS (not verbatim): the b-roll/still render lanes read
      // scene.visualPrompt downstream, and enhanceBrollPrompts below rewrites every cutaway seed
      // with the video subject threaded in, so overrides stay topic-anchored. Host lip-sync
      // ignores visualPrompt by design (buildLipsyncPrompt), so host overrides are left verbatim.
      // A split target's editable prompt is `splitVisual` (its host half is reused and its
      // visualPrompt reaches no model), so its override lands there instead.
      if (promptOverrides?.length) {
        const asTyped = new Set(verbatimIndices ?? []);
        const overrides = new Map(promptOverrides.map(p => [p.index, p]));
        const reworded: number[] = [];
        for (const s of targets) {
          const o = overrides.get(s.index);
          if (!o) continue;
          if (isSplitScene(s)) {
            if (!o.splitVisual?.trim()) continue;
            s.splitVisual = o.splitVisual.trim();
            if (asTyped.has(s.index)) s.splitVisualSeed = s.splitVisual;
            else reworded.push(s.index);
          } else if (o.visualPrompt?.trim()) {
            s.visualPrompt = o.visualPrompt.trim();
            // Verbatim ⇒ the operator owns this prompt; make it the baseline a later
            // re-enhance rewrites from, not just this render's text.
            if (asTyped.has(s.index)) s.visualPromptSeed = s.visualPrompt;
            else reworded.push(s.index);
          }
        }
        // Loud because it is invisible in the output: a non-verbatim override is only a seed —
        // enhanceBrollPrompts below rewrites it, so a hand-typed clause can silently not ship
        // (22 scenes of job 181 rendered white bottles this way).
        if (reworded.length)
          console.warn(
            `[Longform ${jobId}] Prompt override(s) on scene(s) ${reworded.join(", ")} are ` +
              `NOT verbatim — they seed the enhancer and will be reworded, not rendered as typed`
          );
      }

      // ponytail: clear clips so the chosen scenes re-render — same fields renderSceneClipInPlace
      // overwrites. Done (and persisted) BEFORE the slow LLM re-enhance below so the client's very
      // next poll shows the targets in-flight and its queued-scene spinners confirm the regen
      // started (settle is seen-processing → terminal, not the stale pre-regen snapshot).
      for (const s of targets) {
        // Split targets keep their clips: the existing composite is the only source the host
        // panel can be recovered from on a scene rendered before `hostClipUrls` existed, and
        // regenerateSplitRight overwrites clipUrls itself when the new composite is up.
        if (!isSplitScene(s)) {
          s.clipUrl = undefined;
          s.clipUrls = [];
        }
        s.sceneStatus = "processing";
        s.error = undefined;
      }
      await updateLongformVideoJob(jobId, {
        status: "processing",
        stage: "clips",
        errorMessage: null,
        storyboard: scenes,
      });

      try {
        // Every cutaway target re-enhances so it picks up the current enhancer wording AND the
        // title-anchored subject, then gets the same host-name scrub as the main pipeline
        // (5108-5112). Host scenes are a no-op in enhanceBrollPrompts and are excluded here,
        // as are verbatim targets (operator-edited prompts render exactly as typed).
        const verbatim = new Set(verbatimIndices ?? []);
        const reEnhanceIndices = targets
          .filter(
            s => (!s.hostPresent || isSplitScene(s)) && !verbatim.has(s.index)
          )
          .map(s => s.index);
        if (reEnhanceIndices.length) {
          // Anchor on the title (wins over stale/empty persisted subject); titled → no LLM call.
          await ensureVideoSubject(params);
          const batchEnhance = await enhanceBrollPrompts(
            scenes,
            params,
            reEnhanceIndices
          );
          if (batchEnhance.failedScenes.length) {
            appendJobWarning(jobId, enhanceWarningFor(batchEnhance));
          }
          const reSet = new Set(reEnhanceIndices);
          const aliases = await hostNameAliases(params.channelKey);
          for (const s of targets) {
            if (!reSet.has(s.index)) continue;
            s.visualPrompt = stripHostNames(s.visualPrompt, aliases);
            if (s.splitVisual)
              s.splitVisual = stripHostNames(s.splitVisual, aliases);
          }
        }

        const provider = await getActiveProvider();
        if (!provider) throw new Error("No active provider configured");
        const { providerType: videoType, apiKey: videoKey } =
          await resolveVideoProvider(provider);
        const adapter = createProviderAdapter(
          videoType as ProviderType,
          videoKey
        );
        const { providerType: ttsType, apiKey: ttsKey } =
          await resolveTTSProvider(provider);
        const instruction =
          (await getAppSetting(LONGFORM_INSTRUCTION_KEY)) ??
          DEFAULT_LONGFORM_INSTRUCTION;
        const lipsync = params.faceImageUrl
          ? await resolveLipsyncAdapter(params)
          : null;

        await dispatchScenesByProvider(
          targets,
          lipsync,
          params,
          async scene => {
            try {
              if (isSplitScene(scene)) {
                await regenerateSplitRight(jobId, scene, scenes, params);
              } else {
                await renderSceneClipInPlace(
                  jobId,
                  scene,
                  scenes,
                  params,
                  adapter,
                  ttsType,
                  ttsKey,
                  lipsync,
                  instruction
                );
              }
              scene.regenerated = true;
            } catch (e: any) {
              scene.sceneStatus = "failed";
              scene.error = e.message;
            }
            const scenesDone = scenes.filter(
              s => s.clipUrls?.length || s.clipUrl
            ).length;
            schedulePersist(jobId, {
              storyboard: scenes,
              progress: jobProgress(jobId, {
                scenesTotal: scenes.length,
                scenesDone,
              }),
            });
          },
          jobId
        );
        await flushPersist(jobId);

        const incomplete = describeIncompleteScenes(scenes);
        if (incomplete) {
          await updateLongformVideoJob(jobId, {
            status: "failed",
            storyboard: scenes,
            errorMessage: incomplete,
            completedAt: new Date(),
          });
          return;
        }
        // Render-only: leave the film un-stitched so the operator can preview the
        // new clips before a re-encode; the manual Assemble button rebuilds it.
        await settleRenderOnly(jobId, scenes);
      } catch (err: any) {
        // Any throw after the early "processing" flip (re-enhance, provider resolution, or
        // assembly — dispatch already catches per scene) must not strand the job "processing":
        // the client would poll forever and the regen buttons would stay locked out.
        for (const s of targets) {
          if (s.sceneStatus === "processing") {
            s.sceneStatus = "failed";
            s.error = s.error ?? err.message;
          }
        }
        await updateLongformVideoJob(jobId, {
          status: "failed",
          storyboard: scenes,
          errorMessage: err.message || "Scene regeneration failed",
          completedAt: new Date(),
        }).catch(onFailedStatusWriteError(jobId));
        throw err;
      }
    });
  } finally {
    wanted.forEach(i => activeRegenerations.delete(`${jobId}:${i}`));
  }
}

/**
 * Retry every scene that still has no clip, then assemble once. First resumes any in-flight
 * renders cheaply (persisted taskIds, no resubmit), then re-renders the remaining clip-less
 * scenes — host (HeyGen) and b-roll/still (69Labs) alike via `generateSceneClips`. If all
 * scenes end up with a clip the film is stitched and finalized; otherwise the job is left
 * `failed` listing the holdouts (the Retry button re-appears, so it's safely re-runnable).
 *
 * "Finalized" depends on whether this job ever shipped a cut: a job that failed BEFORE its first
 * assembly is stitched automatically (there's no earlier cut to preview against — the manual
 * button would just be friction), while a job that already has a final settles render-only like
 * every other user-initiated clip action.
 */
export async function retryFailedScenes(jobId: number): Promise<void> {
  if (jobLocks.has(jobId)) return; // an active pass owns this job's lock
  return withJobLock(jobId, () => retryFailedScenesLocked(jobId));
}

/** Core of retryFailedScenes — assumes the caller holds the job lock (withJobLock). */
async function retryFailedScenesLocked(jobId: number): Promise<void> {
  const job = await getLongformVideoJobById(jobId);
  if (!job) throw new Error("Job not found");
  const params = job.inputParams as LongformInputParams;

  await updateLongformVideoJob(jobId, {
    status: "processing",
    stage: "clips",
    errorMessage: null,
  });

  try {
    // 1) Recover any scenes still rendering on the provider (no resubmit), then re-read.
    await resumePendingRendersLocked(jobId); // we already hold the lock
    const fresh = await getLongformVideoJobById(jobId);
    const scenes = (fresh?.storyboard as StoryboardScene[]) || [];

    // 2) Re-render every scene that still lacks a clip — host and b-roll/still alike.
    const provider = await getActiveProvider();
    if (!provider) throw new Error("No active provider configured");
    const { providerType: videoType, apiKey: videoKey } =
      await resolveVideoProvider(provider);
    const adapter = createProviderAdapter(videoType as ProviderType, videoKey);
    const { providerType: ttsType, apiKey: ttsKey } =
      await resolveTTSProvider(provider);
    const instruction =
      (await getAppSetting(LONGFORM_INSTRUCTION_KEY)) ??
      DEFAULT_LONGFORM_INSTRUCTION;
    const lipsync = params.faceImageUrl
      ? await resolveLipsyncAdapter(params)
      : null;

    const missing = scenes.filter(s => !(s.clipUrls?.length || s.clipUrl));
    // Re-render the missing scenes across all three provider lanes concurrently (was a
    // sequential for-loop that submitted only one scene's chunks at a time and blocked ~25min
    // on its polls before touching the next scene), mirroring resumeRenderingScenes. Host
    // scenes now fan out up to ENV.heygenConcurrency instead of one-at-a-time.
    await dispatchScenesByProvider(
      missing,
      lipsync,
      params,
      async scene => {
        try {
          await renderSceneClipInPlace(
            jobId,
            scene,
            scenes,
            params,
            adapter,
            ttsType,
            ttsKey,
            lipsync,
            instruction
          );
        } catch (e: any) {
          scene.sceneStatus = "failed";
          scene.error = e.message;
        }
        const scenesDone = scenes.filter(
          s => s.clipUrls?.length || s.clipUrl
        ).length;
        schedulePersist(jobId, {
          storyboard: scenes,
          progress: jobProgress(jobId, {
            scenesTotal: scenes.length,
            scenesDone,
          }),
        });
      },
      jobId
    );
    await flushPersist(jobId);

    // 3) Every scene has a clip → finalize; else fail loudly listing holdouts.
    const incomplete = describeIncompleteScenes(scenes);
    if (incomplete) {
      await updateLongformVideoJob(jobId, {
        status: "failed",
        storyboard: scenes,
        errorMessage: incomplete,
        completedAt: new Date(),
      });
      return;
    }
    // First cut this job ever gets → stitch it now. `finalFileKey` is written only by a
    // successful assembly and never cleared (settleRenderOnly nulls finalVideoUrl but keeps
    // the key), so its absence means no film has existed yet — there is nothing to preview
    // the new clips against, and making the operator click Assemble is pure friction.
    // A job that already shipped a cut keeps the render-only contract: every user-initiated
    // clip action leaves the re-stitch to the manual Assemble button.
    if (!job.finalFileKey) {
      await updateLongformVideoJob(jobId, {
        stage: "assembly",
        storyboard: scenes,
      });
      await assembleAndFinalize(jobId, scenes, params);
    } else {
      await settleRenderOnly(jobId, scenes);
    }
  } catch (err: any) {
    await updateLongformVideoJob(jobId, {
      status: "failed",
      errorMessage: err.message || "Retry failed",
      completedAt: new Date(),
    }).catch(onFailedStatusWriteError(jobId));
    throw err;
  }
}

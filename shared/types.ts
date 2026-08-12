/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

/** Provider types supported by the system */
export type ProviderType = "genaipro" | "sixtynine_labs";

/** Display names for providers */
export const PROVIDER_DISPLAY_NAMES: Record<ProviderType, string> = {
  genaipro: "GenAIPro (genaipro.io)",
  sixtynine_labs: "69Labs (69labs.vip)",
};

/** Video models */
export type VideoModel =
  | "veo-3.1-generate"
  | "veo-video"
  | "veo-3.1-fast"
  | "gemini-omni"
  | "grok-imagine-video"
  | "grok-imagine-video-1-5-preview";

/** Image models */
export type ImageModel =
  | "nano-banana"
  | "nano-banana-2"
  | "nano-banana-pro"
  | "gpt-image-2"
  | "grok-imagine-image";

/** All model types */
export type ModelType = VideoModel | ImageModel;

/** Display names for models */
export const MODEL_DISPLAY_NAMES: Record<ModelType, string> = {
  "veo-3.1-generate": "Veo 3.1",
  "veo-video": "Veo 3.1 Lite",
  "veo-3.1-fast": "Veo Fast (BETA)",
  "gemini-omni": "Gemini Omni",
  "grok-imagine-video": "Grok Imagine Video",
  "grok-imagine-video-1-5-preview": "Grok Imagine Video 1.5 Preview",
  "nano-banana": "Nano Banana (Fast)",
  "nano-banana-2": "Nano Banana 2",
  "nano-banana-pro": "Nano Banana Pro (Quality)",
  "gpt-image-2": "GPT Image 2",
  "grok-imagine-image": "Grok Imagine Image",
};

/** Video aspect ratios */
export type VideoAspectRatio = "16:9" | "9:16";

/** Image aspect ratios — GenAIPro supports more options */
export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "2:3";

/** Resolutions */
export type Resolution = "720p" | "1080p" | "4K";

/** Durations in seconds (69labs: gemini-omni accepts 4/6/8/10, grok 6/10, luma 5/10) */
export type Duration = 4 | 6 | 8 | 10;

/** Generation type */
export type GenerationType = "video" | "image";

/** Generation status */
export type GenerationStatus =
  "pending" | "processing" | "completed" | "failed";

/** Video generation request */
export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  model: VideoModel;
  aspectRatio: VideoAspectRatio;
  resolution: Resolution;
  duration: Duration;
  count: number;
}

/** Image generation request */
export interface ImageGenerationRequest {
  prompt: string;
  model: ImageModel;
  aspectRatio: ImageAspectRatio;
  count: number;
  /** Image resolution: "1K", "2K", "4K". Defaults to "2K" */
  imageSize?: string;
}

/** Standardized generation result from any provider */
export interface GenerationResult {
  success: boolean;
  fileUrl?: string;
  fileData?: Buffer | Uint8Array;
  mimeType?: string;
  error?: string;
  /** Provider-side task ID for async polling */
  taskId?: string;
  /**
   * True when the task was submitted successfully but the poll hit the client
   * timeout ceiling without a terminal success/fail. The render is likely still
   * running provider-side — `taskId` is set so the caller can persist it and
   * resume polling later rather than treating this as a failure.
   */
  pending?: boolean;
  /**
   * True when the provider returned a terminal FAILED status that looks like an
   * infrastructure problem (GPU arch mismatch, OOM, worker crash) rather than a
   * content or parameter error. The caller can transparently retry on a different
   * provider instead of surfacing the error to the user.
   */
  infraFailure?: boolean;
}

/** Custom provider config shape */
export interface CustomProviderConfig {
  videoEndpoint?: string;
  imageEndpoint?: string;
  authHeaderName?: string;
  authHeaderValueFormat?: string;
}

/** Provider status for sidebar display */
export interface ProviderStatus {
  providerType: ProviderType | null;
  displayName: string;
  connectionStatus: "connected" | "disconnected" | "untested";
}

/** GenAIPro account balance — matches /api/v1/veo/me response */
export interface GenAIProBalance {
  totalQuota: number;
  usedQuota: number;
  availableQuota: number;
}

// ─── Long-form faceless video pipeline ───

/** Pipeline stages for a long-form video job (drives the progress UI) */
export type LongformJobStage =
  "storyboard" | "voiceover" | "clips" | "assembly" | "done";

/** Per-scene generation status within a long-form job */
export type SceneStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  /**
   * Clip submitted to the provider, but the client poll hit its timeout ceiling
   * before success/fail. The render is likely still running provider-side; the
   * task ID is persisted in `renderTaskIds` so it can be resumed (re-polled +
   * downloaded) instead of re-submitted. Not "failed" — recoverable.
   */
  | "rendering";

/** Lock mode for the host reference image (mirrors Grok videoInputMode) */
export type FaceLockMode = "ingredients" | "keyframes";

/** Output format for a long-form video job */
export type LongformVideoFormat = "vlog" | "talkingHead";

/** A single storyboard scene = one beat (its own verbatim script slice) + clip(s) */
export interface StoryboardScene {
  index: number;
  /** Short display label for this beat (derived = first words of `scriptText`) */
  narration: string;
  /**
   * The VERBATIM slice of the script this scene voices (its own narration text).
   * Concatenating every scene's `scriptText` in index order reproduces the full
   * script. This is what locks each scene's visuals to the audio under it.
   */
  scriptText?: string;
  /** Visual direction sent to the video model for this clip */
  visualPrompt: string;
  /**
   * The prompt `enhanceBrollPrompts` rewrites FROM — captured the first time it runs, and
   * replaced by an operator's verbatim override. Without it the enhancer read back its own
   * ≤60-word rewrite on every regen, so each regen re-compressed a compression and concrete
   * script detail eroded (job 181 scene 48 lost "poured from an aged watering can").
   * `visualPrompt` still holds the rewrite that actually renders.
   */
  visualPromptSeed?: string;
  /**
   * Read-only preview, computed at poll time by `pollJob` and NEVER persisted: the exact
   * fully-assembled prompts this scene ships to the providers — `assembledClipPrompt` to
   * grok-imagine-video, `assembledStillPrompt` to gpt-image-2. Undefined outside pollJob.
   */
  assembledClipPrompt?: string;
  assembledStillPrompt?: string;
  /**
   * Script-tailored lighting/color mood + (for moving shots) camera movement for this
   * beat. Authored by Claude in the storyboard call; the fixed photographic guardrails are
   * still appended in code. Absent → code falls back to the default mood (byte-identical to
   * the legacy fixed suffix). Only meaningful on cutaway / split-right lanes, not the
   * talking host.
   */
  cameraCue?: string;
  /** Whether the on-camera host appears (gets the reference face + face-lock) */
  hostPresent: boolean;
  /**
   * Which host photo drives this scene's lip-sync: 0 = primary (`faceImageUrl`), 1 = alt angle
   * (`faceImageUrl2`). Assigned by `assignHostShots` only when the channel has a second host
   * photo: shots alternate across the film, and the cold-open host pair (scenes 1 & 2, the only
   * adjacent host pair) always reads main → alt (its first scene is pinned to the primary). Only
   * meaningful when `hostPresent`; undefined = primary. Persisted in the storyboard JSON so
   * resume/regenerate reuse it.
   */
  hostShot?: 0 | 1;
  /**
   * Part of the LOCKED host cold open: scene 1, plus scene 2 when the channel has an alt host
   * photo (`faceImageUrl2`) — a fixed two-angle opener that every longform film shares. Set once
   * in `parseStoryboard` and honored by every later pass: opener scenes are never demoted
   * (`rebalanceHostScreenTime`, `enforceVisualAdjacency`), never forced into a split-frame
   * (`enforceHostSplitMix`), never split (`splitOverlongScenes`) or merged
   * (`coalesceShortScenes`), and are the scenes the host name card rides on
   * (`nameCardSceneIndices`). Their chunks are packed to the host floor (`HOST_MIN_HOLD_SEC`)
   * at segmentation, ending on a sentence boundary.
   */
  hostOpener?: true;
  /**
   * Call-to-action scene: the narration is part of the book/product sales pitch. The flag drives
   * CTA *visual* handling — generic on-topic cutaways (`sanitizeCtaCutaway`), empty host hands, and
   * the `ensureHostInCta` host guarantee — plus the fallback cover-reveal placement
   * (`markCoverReveal`). It does NOT drive the QR overlay (that keys off `qrHero`/`qrCorner`,
   * anchored to the "grab your phone" block + cover) and does NOT force the host register; CTA
   * scenes are demotable like any other host scene (see `markCtaScenes` / `rebalanceHostScreenTime`).
   */
  cta?: boolean;
  /**
   * A "QR hero" beat: a person-free still with a LARGE CENTERED QR overlaid (instead of the small
   * bottom-right card) for its whole duration. Set by `markCtaQrBlock` across the fixed CTA block
   * ("Now go ahead and grab your phone" … "I'll wait right here"), so the big QR fills the screen
   * for the whole scan window. Exempt from band enforcement (`splitOverlongScenes` / speed-nudge),
   * merge, and the on-screen floor so the spoken lines keep their natural length. Implies `cta`
   * and `!hostPresent`.
   */
  qrHero?: boolean;
  /**
   * A small bottom-right QR beat that is NOT a hero still: the corner QR card is overlaid but the
   * scene KEEPS its normal register (host/still/motion) — a corner card never covers a centered
   * face. Set by `markCornerQrBeforeCover` on the `CORNER_QR_SCENES_BEFORE_COVER` scenes right
   * before each cover reveal (the book-pitch scan window). Independent of `cta`, so a dollar
   * mention in the body never surfaces a QR.
   */
  qrCorner?: boolean;
  /**
   * The last `qrHero` beat of a CTA block (the release line "I'll wait right here"). Adds a silent
   * frozen `QR_TAIL_HOLD_SEC` tail in assembly (via the assembly `tailHoldSec`) so the QR lingers
   * ~3s after the host stops talking. Set by `markCtaQrBlock`.
   */
  qrTail?: boolean;
  /**
   * The "book cover reveal" beat: shown full-frame as the literal channel cover image (large,
   * white outer glow, slight Ken Burns) instead of a host/b-roll shot. Set by `markCtaQrBlock` on
   * the beat right before the CTA QR block (or, as a fallback when the block is absent, by
   * `markCoverReveal` at the first in-CTA title mention); implies `stillImage` and `!hostPresent`,
   * keeps `cta`, suppresses the corner QR, and is exempt from band split / speed-nudge / host-flip
   * / coalesce so the cover reveal is one clean beat that ends with its narration.
   */
  coverHero?: boolean;
  /**
   * The beat visually depicts the physical book (host/hands holding it, book on a table/soil,
   * close-up of the book). Authored by Claude in the storyboard. When set AND a channel cover is
   * configured, the channel `bookCoverImageUrl` is passed to image/video generation as a reference
   * (`image_urls`) so the REAL cover art appears instead of a hallucinated one. Distinct from
   * `coverHero` (the dedicated full-frame reveal beat).
   */
  showsBook?: boolean;
  /**
   * Image lane: render this (person-free) cutaway as a 69labs STILL image animated
   * with a subtle pan/zoom (Ken Burns) instead of AI video — cheaper, faster, no motion
   * hallucination. Only valid when `hostPresent` is not set.
   *
   * The DEFAULT for a cutaway, not the exception: `parseStoryboard` forces it on any cutaway
   * that sets neither `humanPresent` nor `objectMotion`, whatever the storyboard asked for.
   * A video clip of a subject that does not move is the expensive lane rendering what the
   * cheap one renders better and safer, so the invariant downstream is
   * `!hostPresent && !stillImage` ⟹ `humanPresent || objectMotion`.
   */
  stillImage?: boolean;
  /**
   * When set on a host scene, renders a SPLIT-SCREEN: LEFT half = seated host talking,
   * RIGHT half = this string (a product, weed close-up, or result visual). The RIGHT half is
   * object/product/setting ONLY — never a person, hands, or body parts (the host already carries
   * the person on the LEFT). Enforced at render via NO_PEOPLE_SUFFIX + the split enhancer's
   * SPLIT_PANEL_PERSON_FREE_DIRECTIVE in longformVideo.ts.
   * Absent on most host shots — used only on ~1 in 4 host scenes.
   */
  splitVisual?: string;
  /** `visualPromptSeed`'s counterpart for the split right-half lane. */
  splitVisualSeed?: string;
  /**
   * B-roll cutaway (person-free, script-derived) to fall back to if this host
   * scene is demoted to b-roll while enforcing the host-screen-time budget
   * (see `rebalanceHostScreenTime`). Only meaningful on host scenes.
   */
  brollVisual?: string;
  /**
   * Camera angle for this b-roll/still scene, assigned by the storyboard model.
   * Drives an angle-specific phrase appended to the video/still prompt in code.
   * Absent on host and CTA scenes (those use a fixed talking-head look).
   */
  shotAngle?: "mid" | "wide" | "overhead" | "low" | "pov";
  /**
   * HANDS-ONLY cutaway: this non-host beat depicts a manual action (e.g. "weathered hands
   * spreading mulch"), so bare hands and forearms enter the frame at the task
   * (ANON_PERSON_SUFFIX in longformVideo.ts). A cutaway NEVER shows a person — no face, head,
   * or body, and the channel host photo is never referenced on b-roll; `NO_FIGURES_SUFFIX` is
   * appended to every non-host prompt regardless of this flag. Only valid when `hostPresent`
   * is false (that already places the host on camera).
   */
  humanPresent?: boolean;
  /**
   * OBJECT-MOTION cutaway: this non-host beat's subject moves BY ITSELF while the shot runs —
   * running water, a burning flame, rising smoke, liquid pouring. The clip takes
   * `OBJECT_MOTION_CAMERA_CLAUSE` (locked camera, the subject's own motion continues) and the
   * keyframe is composed mid-motion so grok has the motion to continue rather than to invent.
   * Only valid when `hostPresent` is false. When `humanPresent` is also set it wins — the hands
   * clause already grants one task motion and hands carry the higher morph risk.
   *
   * Together with `humanPresent` this is what earns a cutaway a video clip at all: without
   * either flag `parseStoryboard` forces the beat onto the still lane (see `stillImage`). It
   * is therefore a statement of fact about the beat, never a lever for hitting the video share
   * — that share is a ceiling most videos land well under.
   */
  objectMotion?: boolean;
  /** R2 URL of this scene's generated voiceover (filled in stage "voiceover") */
  audioUrl?: string;
  /** Measured duration of the scene voiceover, seconds */
  audioDuration?: number;
  /**
   * This scene's slice of the continuous master narration, in seconds on the MASTER
   * timeline (set in Stage 2 alongside the physical slice). Assembly uses these to lay
   * the untouched master over the whole film (seamless audio) instead of re-concatenating
   * the per-scene slices. Cleared when the scene is re-voiced off-master (fresh TTS), which
   * drops the whole job back to the per-scene audio concat path.
   */
  narrationStartSec?: number;
  narrationEndSec?: number;
  /**
   * R2 URLs of this scene's generated clip(s), in order. B-roll is always ONE clip sized to
   * the narration; only a HOST scene whose narration outruns one clip gets several.
   */
  clipUrls?: string[];
  /** First clip URL — back-compat mirror of `clipUrls[0]` for the review UI. */
  clipUrl?: string;
  /**
   * Raw lip-sync clips BEFORE split-screen compositing, in step with `clipUrls`. Persisted so
   * a split scene's regenerate can swap the RIGHT panel onto the existing host without
   * re-running the lip-sync provider. Back-filled by cropping the host panel out of the
   * composite for scenes rendered before this field existed.
   */
  hostClipUrls?: string[];
  /**
   * True when this scene's clip(s) were produced by the audio-driven lip-sync model
   * (host shots with a face photo) rather than text-to-video. Lip-synced clips already
   * equal the narration length and carry no reference-photo intro, so assembly must not
   * head-trim them and clip-count is the number of audio chunks, not `ceil(d/usable)`.
   */
  lipsynced?: boolean;
  /** Per-scene status */
  sceneStatus?: SceneStatus;
  /** User regenerated this scene's clip at least once (drives the review badge). */
  regenerated?: boolean;
  /** Error detail when sceneStatus is "failed" */
  error?: string;
  /**
   * Which provider issued the in-flight render task(s) for this scene's clip(s).
   * Set alongside `renderTaskIds` so the resume path knows which adapter to poll.
   */
  renderProvider?: "runpod" | "heygen" | "fal" | "sixtynine_labs";
  /**
   * Provider-side task/job IDs for this scene's in-flight clip(s), in clip/chunk
   * order. Persisted as soon as a clip is submitted so a poll timeout, crash, or
   * watchdog sweep can resume the already-running render (download the finished
   * result) instead of re-submitting and re-incurring the cost + timeout.
   * Cleared once the clip URLs are downloaded.
   */
  renderTaskIds?: string[];
  /**
   * Index into this scene's `buildClipChain()` of the video model currently being
   * rendered/resumed. Advanced (and `renderTaskIds` cleared) when a b-roll clip fails
   * terminally so the next fallback model is submitted fresh; cleared on success.
   * Undefined === position 0. Persisted in the storyboard JSON blob (no migration).
   */
  renderModelIndex?: number;
  /**
   * Count of grok transient render failures accumulated for this scene across resume
   * passes. Once it reaches GROK_TRANSIENT_ATTEMPTS_BEFORE_VEO, a b-roll scene falls over
   * to the veo-3.1-fast chain element instead of retrying grok forever. Reset on chain
   * advance and on success. Only read for b-roll. Persisted in the storyboard JSON blob.
   */
  renderAttempts?: number;
  /**
   * What this stretch of the video should physically show, and how it differs from the stretches
   * around it — the scene's slice of the whole-video arc (`deriveVisualDirection`). Claude writes
   * these as consecutive scene RANGES (a scene is only ~4s; a beat covers ~45–60s) and
   * `resolveBeats` denormalizes them onto each scene, so nothing downstream knows ranges existed.
   *
   * Injected into the b-roll enhancer's user message alongside `params.visualStyleBible`, which
   * supplies the shared world this beat sits in. Read only for cutaways and `splitVisual` — CTA
   * cutaways deliberately get the bible but no beat, since their narration is a pitch that
   * `CTA_BROLL_ENHANCER_SYSTEM` exists to ignore. Survives a verbatim override — that render
   * skips the enhancer anyway, so clearing it only stripped the arc off a LATER re-enhance.
   * Persisted in the storyboard JSON blob (no migration).
   */
  visualBeat?: string;
}

/** Persisted input parameters for a long-form video job */
export interface LongformInputParams {
  /** The script the video is narrated from (voiced verbatim as one continuous track) */
  script: string;
  /**
   * @deprecated No longer an input — video length is derived from the script.
   * Retained optional so persisted JSON from older jobs still type-checks.
   */
  targetSeconds?: number;
  /** @deprecated No longer an input — clip length is a fixed internal constant. */
  clipLen?: 5 | 10;
  /** @deprecated No longer an input — output is always 16:9. */
  aspectRatio?: VideoAspectRatio;
  lockMode: FaceLockMode;
  /** @deprecated Single unified format now; retained optional for legacy rows. */
  videoFormat?: LongformVideoFormat;
  /** Optional uploaded host face (R2 URL); host scenes use it for identity lock */
  faceImageUrl?: string;
  /**
   * Optional second host face (R2 URL) at a different camera angle, resolved from the channel
   * config. When set, the locked cold open runs as a two-angle PAIR (scene 1 + scene 2) — rendered
   * from `faceImageUrl` then this one (see `StoryboardScene.hostShot`) so the opening cut reads as
   * an angle change. That opener is the ONLY place two host scenes sit adjacent; every later host
   * scene stands alone. Unset ⇒ single-angle, single-scene open, and no host pair anywhere.
   */
  faceImageUrl2?: string;
  /**
   * The host's on-screen identity, resolved from the channel config. Rendered as a lower-third
   * card over the SECOND host shot of the film (see `nameCardSceneIndex` / `renderNameCardPng`).
   * All three unset → no card.
   */
  hostName?: string;
  hostTitle?: string;
  hostLocation?: string;
  /**
   * Optional QR-code image (R2 URL) resolved from the channel config. Overlaid in the
   * bottom-right corner of CTA host scenes so viewers can scan it (e.g. the book/product
   * site). Unset → CTA scenes still keep the host on camera, just without the QR card.
   */
  qrImageUrl?: string;
  /**
   * Optional book-cover image (R2 URL) resolved from the channel config. Revealed full-frame
   * (large, white outer glow, slight Ken Burns) the first time the book is named inside each
   * CTA — see `markCoverReveal`. Unset → no cover beat.
   */
  bookCoverImageUrl?: string;
  /**
   * The book's title, resolved at job startup from the channel layer (`extractBookName`). Used
   * only to detect the first in-CTA mention that triggers the cover reveal. Unset → no cover beat.
   */
  bookTitle?: string;
  /** Channel the voice was resolved from */
  channelKey: string;
  /** TTS voice id (resolved from the channel config by the router) */
  voiceId: string;
  /** TTS model id (resolved from the channel config) */
  ttsModel?: string;
  /** TTS speed multiplier (resolved from the channel config) */
  ttsSpeed?: number;
  /** TTS volume multiplier (resolved from the channel config; applied as an ffmpeg gain) */
  ttsVolume?: number;
  /** User-supplied video title (optional). Names the downloaded MP4; persisted so it survives refresh/cross-device. */
  title?: string;
  /**
   * The whole-video subject, derived once at render start (the title, else a cheap LLM read of the
   * script). Injected as a disambiguation hint into the storyboard, b-roll enhancer, and safety
   * prompts so an ambiguous narration noun ("the meat", "the animal") resolves to the right subject.
   * Persisted in `inputParams` so regenerate reuses it.
   */
  videoSubject?: string;
  /**
   * The whole-video visual style bible, derived once at render start from the channel's persona
   * layer + the full script (`deriveVisualDirection`). Names the one physical world every b-roll
   * cutaway in this video shares — the concrete place, the season, the recurring props, the tone
   * of the work.
   *
   * CONTENT ONLY: never camera/lighting/palette/grade. Those are owned by `amateurIphoneLook()`
   * and friends — a look-flavored bible would contradict them inside the same prompt and pull
   * every render toward the stock-footage look.
   *
   * Injected into the b-roll enhancer's user message as a tie-breaker (resolve what the narration
   * leaves open), never as an addition. Persisted in `inputParams`, so regenerate reuses it with
   * no Claude call and an operator's hand-edit is never clobbered. Unset (a pre-feature job, or a
   * derive that failed open) ⇒ every prompt is byte-identical to the pre-feature pipeline.
   */
  visualStyleBible?: string;
  /**
   * Which long-form tab (slot 0–4) launched this job. Selects BOTH per-tab provider keys: the
   * APIMART key for b-roll VIDEO generation (unset or a slot with no key ⇒ the 69Labs video path)
   * and the HeyGen key for host lip-sync (⇒ the shared `HEYGEN_API_KEY`). Still images always
   * render on OpenAI's official gpt-image-2, independent of this. Persisted so job resumes
   * re-resolve the same tab's keys; the apimart-flavoured name is kept for compatibility with
   * `inputParams` already stored on live jobs.
   */
  apimartSlot?: number;
  /**
   * When true, every host scene is demoted to a b-roll cutaway immediately after storyboarding,
   * before TTS and the host balancers run — the finished video has no talking-head shots.
   * Used by `scripts/broll-only-longform.ts` and diagnostics that exercise the b-roll lane alone.
   */
  brollOnly?: boolean;
  /**
   * Test mode: every b-roll cutaway renders as a VIDEO clip (never the still/image lane).
   * Skips `enforceStillMotionRatio` and allows adjacent motion scenes. Pair with `brollOnly`
   * for an all-video b-roll diagnostic reel.
   */
  brollMotionOnly?: boolean;
}

/** Progress counters surfaced to the client */
export interface LongformProgress {
  scenesTotal: number;
  scenesDone: number;
}

/** Style reference attached to an image or voiceover generation */
export interface StyleReference {
  /** "upload" = user-uploaded image; "library" = curated library item */
  type: "upload" | "library";
  /** R2/S3 URL of the reference image */
  source: string;
}

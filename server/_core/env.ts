export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  /** Single-admin login credentials */
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  /** OpenAI API key — longform b-roll/still images (gpt-image-2). */
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  /**
   * Max ms to wait on the primary image provider before failing over to Gemini
   * (default 480s). Set above the real still-image render time so a healthy
   * render isn't abandoned and re-paid via Gemini.
   */
  imagePrimaryTimeoutMs: Number(
    process.env.IMAGE_PRIMARY_TIMEOUT_MS ?? 480_000
  ),
  /**
   * Extra attempts on the primary image provider for slots it fails to produce,
   * before falling back to Gemini (default 1).
   */
  imagePrimaryRetries: Number(process.env.IMAGE_PRIMARY_RETRIES ?? 1),
  /** Per-attempt budget for primary image RETRIES (default 240s). */
  imageRetryTimeoutMs: Number(process.env.IMAGE_RETRY_TIMEOUT_MS ?? 240_000),
  /**
   * Hard wall-clock ceiling for the whole primary image phase (first attempt +
   * retries) on no-heartbeat paths (default 600s) — i.e. longform b-roll, whose
   * only job-level guard is the 30-min longform watchdog.
   */
  imageRetryTotalBudgetMs: Number(
    process.env.IMAGE_RETRY_TOTAL_BUDGET_MS ?? 600_000
  ),
  /** Max concurrent active 69Labs video-generation jobs in-flight. */
  sixtynineVideoConcurrency: Number(
    process.env.SIXTYNINE_VIDEO_CONCURRENCY ?? 8
  ),
  /**
   * Max concurrent active 69Labs image-generation jobs in-flight (default 7).
   * Double duty: also bounds the stills-lane worker pool, so it is the ceiling
   * on how many heavy local Ken Burns ffmpeg encodes run at once.
   */
  sixtynineImageConcurrency: Number(
    process.env.SIXTYNINE_IMAGE_CONCURRENCY ?? 7
  ),
  /** RunPod API key — whisperx word-level transcription. */
  runPodApiKey: process.env.RUN_POD_KEY ?? "",
  /**
   * RunPod serverless endpoint ID for whisperx-worker
   * (kodxana/whisperx-worker_v2) transcription. Deploy your own endpoint and
   * set this — there is no default.
   */
  runpodWhisperxEndpoint: process.env.RUNPOD_WHISPERX_ENDPOINT ?? "",
  /**
   * RunPod serverless endpoint ID for the self-hosted InfiniteTalk host lip-sync worker.
   * Deploy your own (Metropolis-Media/infinitetalk-runpod-hub) and set this; blank keeps
   * the host lane on HeyGen no matter what `LIPSYNC_PROVIDER` says.
   */
  runpodInfinitetalkEndpoint: process.env.RUNPOD_INFINITETALK_ENDPOINT ?? "",
  /**
   * Which vendor renders host scenes: `heygen` (default) or `runpod`. Deliberately an
   * explicit opt-in rather than "use RunPod if its endpoint is set" — a configured
   * endpoint should be testable without silently moving every render onto it.
   */
  lipsyncProvider: (process.env.LIPSYNC_PROVIDER ?? "heygen").toLowerCase(),
  /**
   * InfiniteTalk quality tier: `fast` (8-step distill, the default) or `full` (40 steps,
   * real CFG). CFG above 1 costs two forward passes per step, so full is ~10x the model
   * evaluations (40 x 2 vs 8 x 1) and ~10x the cost, not the 6x a step count alone suggests.
   * Both render 720p from the same base model, and full additionally makes the PROMPT bite:
   * at fast's CFG 1 the framing/minimal-motion direction is only weakly applied.
   *
   * The default here is only that — a default. Admin -> Provider Keys stores the live value
   * (`server/lipsyncProvider.ts`), so the tier can change without a redeploy.
   */
  runpodLipsyncQuality:
    (process.env.RUNPOD_LIPSYNC_QUALITY ?? "fast").toLowerCase() === "full"
      ? ("full" as const)
      : ("fast" as const),
  /**
   * Host renders kept in flight on the RunPod lane. Track your endpoint's max-workers
   * setting: RunPod queues anything beyond it, and a queued job's wait counts against
   * `RUNPOD_LIPSYNC_TIMEOUT_MS` while doing no work.
   */
  runpodLipsyncConcurrency: Number(
    process.env.RUNPOD_LIPSYNC_CONCURRENCY ?? 4
  ),
  /**
   * Default camera conditioning for the RunPod lane: `image` sends the host photo (I2V),
   * `video` sends a static clip built from that photo (V2V) so the model has no camera
   * motion to mimic — the InfiniteTalk maintainer's fix for Wan's drift toward the speaker.
   * Admin -> Provider Keys stores the live value (`server/lipsyncProvider.ts`); this is
   * only the fallback for a never-set row.
   */
  runpodLipsyncInput:
    (process.env.RUNPOD_LIPSYNC_INPUT ?? "image").toLowerCase() === "video"
      ? ("video" as const)
      : ("image" as const),
  /**
   * Pinned-camera anchor dial, sent to the worker's V2V sampler when set. `steps` is the
   * total schedule and `start_step` how many are skipped at the noisy end — active steps =
   * steps − start_step, and MORE active steps = more motion freedom, LESS anchoring to the
   * static plate. The workflow ships 8/2 (75% free); walk start_step 2→1 if the mouth is
   * still too quiet, 2→3 if drift returns. Unset sends nothing and the workflow default rules.
   */
  runpodLipsyncV2vSteps: process.env.RUNPOD_LIPSYNC_V2V_STEPS
    ? Number(process.env.RUNPOD_LIPSYNC_V2V_STEPS)
    : undefined,
  runpodLipsyncV2vStartStep: process.env.RUNPOD_LIPSYNC_V2V_START_STEP
    ? Number(process.env.RUNPOD_LIPSYNC_V2V_START_STEP)
    : undefined,
  /** HeyGen API key — fallback when a per-tab key slot is empty. */
  heygenApiKey: process.env.HEYGEN_API_KEY ?? "",
  /**
   * Public origin of this server (e.g. `https://myapp.example.com`) — used to
   * build the HeyGen render-completion callback URL. Blank (local dev) ⇒ no
   * callback is sent and host scenes fall back to pure polling.
   */
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "",
  /** Max concurrent active HeyGen lip-sync jobs. */
  heygenConcurrency: Number(process.env.HEYGEN_CONCURRENCY ?? 8),
  /**
   * `1` renders host scenes onto generated contextual PLATES instead of the raw studio
   * headshot, so the background follows the script. Provider-independent — see
   * `server/hostPlate.ts`. Off by default; every lip-sync model animates whatever image it
   * is given, so without this the host stands against the headshot's backdrop all film.
   */
  hostPlates: process.env.HOST_PLATES ?? "0",
  /**
   * How many distinct host settings ("looks") a film gets. Host scenes are bucketed by
   * narrative position and share a look's plate. Higher = more variety but more generated
   * faces to keep consistent, and one image each.
   */
  hostPlateLooks: Number(process.env.HOST_PLATE_LOOKS ?? 4),

  // ─── AIREITER BOLT-ON (temporary; see server/providers/aireiter.ts) ──────
  /** AIReiter gateway key. Blank ⇒ the bolt-on is inert regardless of lanes. */
  aireiterApiKey: process.env.AIREITER_API_KEY ?? "",
  /**
   * Which lanes AIReiter takes over: comma-separated `broll`, `stills`, or `all`.
   * Unset/empty (the default) ⇒ b-roll stays on APIMART and stills on OpenAI.
   * Host lip-sync and TTS are NEVER affected — AIReiter sells neither.
   */
  aireiterLanes: process.env.AIREITER_LANES ?? "",
  /** Grok Imagine on AIReiter tops out here: `480p` (cheapest) or `720p`. */
  aireiterVideoResolution: process.env.AIREITER_VIDEO_RESOLUTION ?? "720p",
  /** gpt_image_2 resolution tier: `1K`, `2K`, or `4K`. */
  aireiterImageResolution: process.env.AIREITER_IMAGE_RESOLUTION ?? "2K",
  /** Shared in-flight cap — a spend governor; every slot is a billed generation. */
  aireiterConcurrency: Number(process.env.AIREITER_CONCURRENCY ?? 4),
  // ─── END AIREITER BOLT-ON ───────────────────────────────────────────────
};

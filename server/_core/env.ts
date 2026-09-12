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
   * RunPod serverless endpoint ID for the self-hosted LTX-2 host lip-sync worker
   * (`server/providers/ltx-lipsync.ts`) — the third host lane beside HeyGen and InfiniteTalk.
   * Shares `RUN_POD_KEY`. Blank keeps the host lane wherever it is, whatever
   * `LIPSYNC_PROVIDER` says, for the same reason as the InfiniteTalk endpoint above.
   */
  runpodLtxEndpoint: process.env.RUNPOD_LTX_ENDPOINT ?? "",
  /**
   * Longest narration one LTX call may carry. LTX-2.3 generates at most 20 s per render, so a
   * host beat over this is cut at pauses into pieces of at most this length
   * (`server/lipsyncChunks.ts`) and rendered as separate chunks of the same scene.
   */
  ltxLipsyncMaxSec: Number(process.env.LTX_LIPSYNC_MAX_SEC ?? 20),
  /** Host renders kept in flight on the LTX endpoint — same reasoning as the InfiniteTalk cap. */
  ltxLipsyncConcurrency: Number(process.env.LTX_LIPSYNC_CONCURRENCY ?? 4),
  /**
   * Render size for the LTX lane, OVERRIDE ONLY: unset sends no `width`/`height` and the
   * worker's own workflow default rules — the lane starts at the graph's standard and every
   * dial is a deliberate change from it. `480p` | `720p` | `1080p`.
   */
  ltxLipsyncResolution:
    (["480p", "720p", "1080p"] as const).find(
      r => r === (process.env.LTX_LIPSYNC_RESOLUTION ?? "").toLowerCase()
    ) ?? undefined,
  /**
   * The graph's Gemma prompt ENHANCER. OFF by default here although the graph ships it on:
   * measured on job 94's scene 1 it rewrote "the camera is static" into a cinematic
   * push-in (background morph 31.6 against a limit of 1; 2.3 with it off and the camera
   * spelled out). `1` re-enables it for an A/B.
   */
  ltxLipsyncEnhancePrompt: process.env.LTX_LIPSYNC_ENHANCE_PROMPT === "1",
  /**
   * Override-only render dials, each absent unless set so the worker's graph defaults rule:
   * stage-1 photo anchor strength (graph 0.7), sampler for both stages (graph
   * `euler_ancestral`; the LTX-2.5 custom-audio thread blames it for broken sync), VAE
   * decode tiling `tile/overlap/temporal/temporal_overlap` (graph 512/64/128/32, sized for
   * small cards; the graph's own note lists 1536/384/192/48 for big ones).
   */
  ltxLipsyncImgStrength: process.env.LTX_LIPSYNC_IMG_STRENGTH
    ? Number(process.env.LTX_LIPSYNC_IMG_STRENGTH)
    : undefined,
  // `euler`, not the graph's `euler_ancestral`, is the ONE dial this lane bakes in — measured
  // on two hosts (jobs 94 and 96, scene 1 of each): the mouth's correlation with the words
  // went from chance (r 0.05) to r 0.47-0.49 with nothing else changed; the ancestral
  // sampler's fresh noise per step is what the LTX-2.5 custom-audio thread blamed, and it
  // was right. `LTX_LIPSYNC_SAMPLER=euler_ancestral` restores the graph's own for an A/B.
  ltxLipsyncSampler: process.env.LTX_LIPSYNC_SAMPLER || "euler",
  ltxLipsyncDecodeTile: process.env.LTX_LIPSYNC_DECODE_TILE || undefined,
  /**
   * Text guidance on stage 1 (`text_cfg`), default 3 — the second dial baked in, for the
   * FACE. At the graph's cfg 1 the prompt is only weakly applied and the negative prompt is
   * never read, so three "eyebrows at rest, eyes soft" wordings all rendered the same
   * hoisted brows and wide eyes (job 97 scene 1). At 3 the brows settle and the negative
   * prompt exists, with sync intact (r 0.40 at 0 ms, 83% of sounds) for ~+15% GPU. `1`
   * restores the graph's own guider.
   */
  ltxLipsyncTextCfg: Number(process.env.LTX_LIPSYNC_TEXT_CFG ?? 3),
  /**
   * Which vendor renders host scenes: `heygen` (default), `runpod` (InfiniteTalk) or `ltx`.
   * Deliberately an explicit opt-in rather than "use RunPod if its endpoint is set" — a
   * configured endpoint should be testable without silently moving every render onto it.
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
  runpodLipsyncConcurrency: Number(process.env.RUNPOD_LIPSYNC_CONCURRENCY ?? 4),
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
   * Host lip-sync render size on the RunPod lane (HeyGen ignores it — Avatar IV is always
   * 1080p). 720p everywhere by default. This used to follow NODE_ENV — 720p in production,
   * 480p on a dev box — which meant every local A/B of the InfiniteTalk lane was judging a
   * different product (softer, 2.25x fewer pixels, faster and cheaper) than the deploy
   * ships. Opt into 480p explicitly for cheap experiments; never inherit it from the env.
   *
   * `1080p` is SELECTABLE but not the default. It was briefly made the default on 2026-09-06
   * and reverted the same day: the film is assembled at 1920x1080 and every other source
   * (b-roll, stills) is native there, so the 720p host clip is the one piece upscaled 1.5x —
   * but closing that gap costs 2.25x the pixels and therefore ~2.25x the GPU seconds, which
   * undoes the cost work, and the checkpoint (`wan2.1_i2v_720p_14B`) is TRAINED at 720p, so
   * 1080p is off-distribution and can duplicate features rather than add detail. What is left
   * carrying the gap is `HOST_UPSCALE_SHARPEN`, which recovers the half the upscale itself
   * loses. Set `LIPSYNC_RESOLUTION=1080p` and judge one scene with `scripts/lipsync-bench.mts`
   * before believing it is better rather than merely dearer.
   */
  lipsyncResolution:
    (["480p", "720p", "1080p"] as const).find(
      r => r === (process.env.LIPSYNC_RESOLUTION ?? "720p").toLowerCase()
    ) ?? "720p",
  /**
   * Pinned-camera anchor dial, sent to the worker's V2V sampler when set. `steps` is the
   * total schedule and `start_step` how many are skipped at the noisy end — active steps =
   * steps − start_step, and MORE active steps = more motion freedom, LESS anchoring to the
   * static plate. Defaults to 8/2 (75% free), the value that measured at parity with the
   * reference; 8/1 overshot to ~150%. Walk start_step 2→1 for more motion, 2→3 for less.
   */
  // Both defaulted together so the anchor stays a FRACTION: 16/4 is the same 75% freedom as
  // the measured-at-parity 8/2, with twice the refinement per frame (texture crawl was the
  // remaining gap to the reference). Sent on every pinned render, so the worker's own
  // workflow default cannot silently disagree with the ratio.
  // 12/3 (2026-09-07), up from 8/2. Three quantities live here and confusing them wasted a
  // day: COST is the ACTIVE step count (`steps - start_step`), FREEDOM is the ratio
  // (`1 - start_step/steps`), and QUALITY is how FINE each denoising jump is, which only the
  // TOTAL step count controls. 12/3 holds the 75% freedom of the 8/2 it replaces — so this is
  // a refinement change and nothing else — at 9 active steps instead of 6.
  //
  // Why: commit fca64a1, the last state the operator remembers as good, ran 16/4 (12 active)
  // with audio guidance on EVERY step and bf16 weights — 24 model passes per window. 8/2 with
  // `audio_cfg_steps` 0.5 and fp8 is 9. Renders at 6 active steps came back with background
  // morph 1.7-3.1 (limit 1), motion roughness up to 0.79 (limit 0.7) and whole-frame sharpness
  // 374-431 against the reference engine's 463, and were reported for hours as "blurry" and
  // "the resolution is off". Under-refined output is soft, morphy and rough — that is the
  // symptom list, and halving the steps is its textbook cause. A day was spent on schedulers,
  // plate anchors, sharpening and framing before checking the step count.
  //
  // 9 active is the compromise, not a restoration: 16/4 is ~$0.19 per finished second against
  // this ~$0.137 and 8/2's ~$0.095. If 9 is still short, walk back toward fca64a1 ONE change
  // at a time — `RUNPOD_LIPSYNC_V2V_STEPS=16`/`_START_STEP=4`, then unset
  // `RUNPOD_LIPSYNC_AUDIO_CFG_STEPS` for guidance on every step, then
  // `RUNPOD_LIPSYNC_QUANTIZATION=disabled` for bf16 — and stop when it looks right, so the
  // price of the quality is known rather than guessed.
  //
  // NOTE these are commonly overridden in `.env`, which silently beats every default here.
  runpodLipsyncV2vSteps: process.env.RUNPOD_LIPSYNC_V2V_STEPS
    ? Number(process.env.RUNPOD_LIPSYNC_V2V_STEPS)
    : 12,
  runpodLipsyncV2vStartStep: process.env.RUNPOD_LIPSYNC_V2V_START_STEP
    ? Number(process.env.RUNPOD_LIPSYNC_V2V_START_STEP)
    : 3,
  /**
   * Motion-tuning dials sent to the worker on EVERY RunPod render (photo and pinned), each
   * only when set — unset means the workflow's own default rules. Every one maps to a worker
   * override, so tuning is an env change and a restart, never an image rebuild.
   *
   * - shift: how far the sampler may wander from the photo per frame (framing creep, room
   *   morph). Workflow default 4; the official InfiniteTalk lightx2v recipe runs 2.
   * - audioScale: how hard the voice drives motion, body and mouth alike — the lever for
   *   "exaggerated". Workflow default 0.8.
   * - audioCfgScale: audio guidance strength; >1 adds a forward pass (~2x GPU). Default 1.
   * - nagScale: strength of the negative prompt on the fast tier. Default 11.
   */
  runpodLipsyncShift: process.env.RUNPOD_LIPSYNC_SHIFT
    ? Number(process.env.RUNPOD_LIPSYNC_SHIFT)
    : undefined,
  /**
   * How hard the VOICE drives the body (the wav2vec embed's `audio_scale`, workflow default
   * 1.0). Above 1 the same audio produces more head and shoulder movement — the free half of
   * the "she looks plain" fix, the other half being the gesture cue in `server/delivery.ts`.
   * Costs nothing: it scales an embedding, it does not add a pass. Judged by the body script's
   * liveliness line (head travel 6-12% of face size) against its exaggeration caps.
   *
   * 1.3, not 1.15: four accepted reference-engine clips measured 9-12% head travel and head
   * motion at 114-163% of the mouth's, where ours read 1-3% and ~40%. The dial is the free
   * half of closing that gap; the gesture cue in `server/delivery.ts` is the directed half.
   */
  runpodLipsyncAudioScale: process.env.RUNPOD_LIPSYNC_AUDIO_SCALE
    ? Number(process.env.RUNPOD_LIPSYNC_AUDIO_SCALE)
    : 1.3,
  // The accepted-render dials, baked (2026-09-05/06): audio guidance 2.5 is what makes the lips
  // meet on p/b/m (a viseme audit failed without it — never off), NAG 13 calmed the eyes.
  runpodLipsyncAudioCfgScale: process.env.RUNPOD_LIPSYNC_AUDIO_CFG
    ? Number(process.env.RUNPOD_LIPSYNC_AUDIO_CFG)
    : 2.5,
  runpodLipsyncNagScale: process.env.RUNPOD_LIPSYNC_NAG_SCALE
    ? Number(process.env.RUNPOD_LIPSYNC_NAG_SCALE)
    : 13,
  /**
   * Sampler scheduler name, passed through verbatim (e.g. `euler`, `flowmatch_distill`,
   * `dpm++_sde`). The stochastic `dpm++_sde` injects fresh noise every step, which measured as
   * ~1.5x the reference's skin shimmer and 2.2x on fabric; the workflow default is now
   * deterministic `euler`. Unset sends nothing.
   */
  runpodLipsyncScheduler: process.env.RUNPOD_LIPSYNC_SCHEDULER || undefined,
  /**
   * Window-handoff dials. InfiniteTalk renders 81-frame windows and carries `motion_frame`
   * frames of the previous window into the next; too few and the SUBJECT snaps at the
   * boundary (the background is held by the plate, so the cut shows only on the person —
   * measured as a 4-5x face/torso jump at frame 82 with the background flat). Enhance-A-Video
   * strengthens coherence INSIDE a window, which can make the boundary stand out more.
   */
  // 37, not the worker's default 25. Dropping to 25 was justified by "`lipsyncSeams.ts`
  // repairs the handoffs that made 37 necessary" — and that was wrong in a way only a viewer
  // caught. The repair fixes a ONE-FRAME jump. Measured on the same join frame of the same
  // sentence, 2 s run-up, overlap 37 vs 25:
  //
  //   overlap 37   f29 .0004  f30 .0021  f31 .0160  f32 .0018  f33 .0105  f34 .0005
  //   overlap 25   f29 .0006  f30 .0057  f31 .0075  f32 .0061  f33 .0062  f34 .0070
  //
  // 37 gives one sharp spike the repair is built for and the eye skips over. 25 gives a
  // SUSTAINED plateau: with less context carried across, the new window renders the head at a
  // slightly different scale and the model itself blends over ~6 frames — a quarter-second
  // morph that reads as a dissolve mid-sentence, and that no spike-based check can see.
  // Costs what it saves: 44 new frames per window instead of 56, so ~27% more windows.
  runpodLipsyncMotionFrame: process.env.RUNPOD_LIPSYNC_MOTION_FRAME
    ? Number(process.env.RUNPOD_LIPSYNC_MOTION_FRAME)
    : 37,
  runpodLipsyncFetaWeight: process.env.RUNPOD_LIPSYNC_FETA_WEIGHT
    ? Number(process.env.RUNPOD_LIPSYNC_FETA_WEIGHT)
    : 0,
  /**
   * torch.compile in the worker (inductor, transformer blocks only): identical frames,
   * 15-30% less GPU time per window after a one-off compile on each cold worker. On by
   * default in the workflow; `0` sends `torch_compile: false` so a compile failure on a new
   * base image can be worked around from here without a worker rebuild.
   */
  // OFF by default (`1` turns it on): on a scale-to-zero endpoint every render lands on a cold
  // worker and pays the compile again — a 5.7 s beat ran past 26 min compiled vs 14 without.
  // Worth revisiting only with a network volume holding the inductor cache.
  runpodLipsyncTorchCompile:
    process.env.RUNPOD_LIPSYNC_TORCH_COMPILE === "1" ? undefined : false,
  /**
   * Host beats per RunPod call (`server/lipsyncBatch.ts`): consecutive host scenes are
   * rendered as one clip so the run-up and the last-window padding — ~40% of a solo beat's
   * frames — are paid once per group. `1` = one call per scene (the old behaviour). The
   * per-job GPU cap has to hold the whole group, so `RUNPOD_LIPSYNC_BATCH_MAX_SEC` bounds the
   * narration a group may carry. Defaults sized to ~6-14 min per beat; raise both once the
   * compiler and the step cut have landed.
   */
  /**
   * Audio-guidance schedule: keep audio guidance (and its extra model pass per step) on only
   * the first fraction of the active steps — the mouth's shape is settled early, the late
   * steps refine texture. 0.5 halves the guidance cost. Unset = guidance on every step.
   */
  runpodLipsyncAudioCfgSteps: process.env.RUNPOD_LIPSYNC_AUDIO_CFG_STEPS
    ? Number(process.env.RUNPOD_LIPSYNC_AUDIO_CFG_STEPS)
    : 0.5, // the everything-on render held lip closure at 0.056 (bar 0.068) with guidance on the first half
  /**
   * Weight quantization in the worker's model loader (`fp8_e4m3fn_fast` etc.); the bf16
   * weights are cast at load. Unset = the workflow's own setting (bf16, no quantization).
   */
  // Standard fp8 as the default (the `_fast` matmul path needs the LoRA merged at load and
  // is being proven separately; `.env` selects it once it is).
  runpodLipsyncQuantization:
    process.env.RUNPOD_LIPSYNC_QUANTIZATION || "fp8_e4m3fn",
  runpodLipsyncBatch: Math.max(
    1,
    Math.round(Number(process.env.RUNPOD_LIPSYNC_BATCH ?? 2)) || 1
  ),
  runpodLipsyncBatchMaxSec: Number(
    process.env.RUNPOD_LIPSYNC_BATCH_MAX_SEC ?? 14
  ),
  /**
   * Run-up handed to the lip-sync worker and trimmed off the returned clip
   * (`server/lipsyncLead.ts`): the model starts from a frozen photo and its first ~2 s are a
   * talking statue — mouth moving, body still — so every host beat opened stiff. 2 s of the
   * preceding narration (silence where there is none) lets the body arrive before the visible
   * start. Costs that many extra seconds of GPU per host scene. 0 disables. RunPod lane only.
   */
  runpodLipsyncLeadSec: Number(process.env.RUNPOD_LIPSYNC_LEAD_SEC ?? 2),
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

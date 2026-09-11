# CLAUDE.md

Long-form faceless-video generator: script → TTS → AI storyboard → per-scene clips →
host lip-sync → stitched MP4. Express + tRPC + Drizzle/MySQL + React 19, **one
long-lived Node process**.

## Commands

```bash
docker compose up -d   # MySQL 8.4 on :3306 (longform/longform)
pnpm dev               # tsx watch → http://localhost:3000 (Express serves Vite + tRPC)
pnpm check             # tsc --noEmit
pnpm test              # vitest run
pnpm format            # prettier
pnpm build && pnpm start
pnpm db:push           # drizzle-kit generate + migrate

node scripts/seed.mjs  # needs DATABASE_URL — seeds the ACTIVE 69Labs provider row
```

`server/sixtynine-labs.test.ts` is a **live** A/B that spends 69Labs credits. It skips
unless `SIXTYNINE_LABS_API_KEY` + the `R2_*` creds + a face image (`FACE_IMAGE_PATH`)
are all present — leave them unset for normal `pnpm test`.

## API keys — two channels

Keys arrive **two different ways**. Half are env vars; the 69Labs/APIMART/HeyGen keys
are AES-encrypted rows in MySQL entered through the Admin UI and are **never** env vars.

### Channel A — env vars (`.env`, gitignored; annotated template in `.env.example`)

Read through the single `ENV` object in `server/_core/env.ts`, except `R2_*`, which
`server/storage.ts`, `server/download.ts` and `server/musicBeds.ts` read straight off
`process.env`.

| Var                                                                      | Consumer                                                                                               | Missing ⇒                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `DATABASE_URL`                                                           | `server/db.ts`, `drizzle.config.ts`                                                                    | no boot                                   |
| `JWT_SECRET`                                                             | `server/_core/cookies.ts` + `server/encryption.ts:getKey()`                                            | no login, no stored keys — see gotchas    |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`                                         | `server/adminAuth.ts:ensureRootAdmin` — **seeds the first admin only**                                 | no login on a fresh DB                    |
| `PORT` (3000)                                                            | `server/_core/index.ts:77` — auto-scans +20 if busy                                                    | —                                         |
| `ANTHROPIC_API_KEY`                                                      | `server/claude.ts` (`claude-opus-4-8`), `server/overlayTextScan.ts` (`claude-haiku-4-5-20251001`)      | storyboard stage fails                    |
| `GEMINI_API_KEY`                                                         | `server/gemini.ts` (`gemini-2.5-flash`), `server/providers/gemini-image.ts` (`gemini-3.1-flash-image`) | no visual direction, no image fallback    |
| `OPENAI_API_KEY`                                                         | `server/providers/openai-image.ts` (`gpt-image-2`, direct api.openai.com)                              | no stills / b-roll keyframes              |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | `server/storage.ts` (S3 API)                                                                           | every upload fails                        |
| `R2_PUBLIC_URL`                                                          | `server/storage.ts:83`, `server/musicBeds.ts:101`                                                      | narration-only films (warns, no crash)    |
| `RUN_POD_KEY` + `RUNPOD_WHISPERX_ENDPOINT`                               | `server/_core/voiceTranscription.ts` → `kodxana/whisperx-worker_v2` serverless                         | no word-level narration alignment         |
| `HEYGEN_API_KEY`                                                         | `server/longformVideo.ts:2506` — **fallback only**, used when a tab's slot key is blank                | host lip-sync fails for slot-less tabs    |
| `RUNPOD_INFINITETALK_ENDPOINT` + `LIPSYNC_PROVIDER=runpod`               | `server/providers/runpod-lipsync.ts` — **optional**, moves host lip-sync off HeyGen                    | host lane stays on HeyGen (the default)   |
| `RUNPOD_LTX_ENDPOINT` + `LIPSYNC_PROVIDER=ltx`                           | `server/providers/ltx-lipsync.ts` — **optional**, the third host lane (self-hosted LTX-2)              | host lane stays on HeyGen (the default)   |
| `PUBLIC_BASE_URL`                                                        | `server/providers/heygen-lipsync.ts:78` (webhook callback URL)                                         | blank ⇒ pure polling; slower, still works |

### Channel B — DB-stored, AES-256-GCM, entered in Admin

| Key               | Storage                                                                                      | Base URL                    |
| ----------------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| 69Labs            | `provider_configs.apiKeyEncrypted` (`server/db.ts`)                                          | `https://69labs.vip/api/v1` |
| MiniMax (TTS)     | `provider_configs` row + `customConfig.groupId` (`saveMinimaxProvider`)                      | `https://api.minimax.io/v1` |
| APIMART ×5 + edit | `app_settings` → `apimart_key_slot_0..4`, `apimart_key_edit` (`server/longformVideo.ts:452`) | `https://api.apimart.ai`    |
| HeyGen ×5         | `app_settings` → `heygen_key_slot_0..4` (`server/longformVideo.ts:461`)                      | `https://api.heygen.com/v3` |

`LONGFORM_SLOT_COUNT = 5` — one key slot per UI tab, so 5 accounts render 5× wider than
one shared key. Crypto lives in `server/encryption.ts`:
`scryptSync(JWT_SECRET, "longform-studio", 32)`, stored as `iv:tag:ciphertext` inside
JSON `{ last4, enc }`. The salt is load-bearing — changing it orphans every key already
in the DB.

A full render needs live keys for all eight: 69Labs, APIMART, HeyGen, Anthropic,
Gemini, OpenAI, R2, RunPod. Missing ones fail loudly at the first stage that needs them
— by design.

## Optional tuning vars (defaults from code; most are not in `.env.example`)

| Var                             | Default           | Var                                        | Default                      |
| ------------------------------- | ----------------- | ------------------------------------------ | ---------------------------- |
| `FFMPEG_PATH`                   | auto-probe        | `FFMPEG_CONCURRENCY`                       | cpu-derived                  |
| `FFMPEG_PROBE_MAX_MS`           | 600s              | `ASSEMBLY_DOWNLOAD_TIMEOUT_MS`             | 120s                         |
| `PROBE_MAX_MS`                  | 60s               | `BROLL_NO_KEYFRAME`                        | unset (`1` disables)         |
| `R2_CONNECTION_TIMEOUT_MS`      | 10s               | `R2_REQUEST_TIMEOUT_MS`                    | 120s                         |
| `APIMART_RATE_PER_MIN`          | 40                | `APIMART_BURST`                            | 5                            |
| `HEYGEN_CONCURRENCY`            | 8                 | `HEYGEN_CALL_TIMEOUT_MS`                   | 120s                         |
| `HEYGEN_DOWNLOAD_TIMEOUT_MS`    | 300s              | `OPENAI_IMAGE_CALL_TIMEOUT_MS`             | 300s                         |
| `OPENAI_IMAGE_BURST`            | 1                 | `OPENAI_IMAGE_RATE_PER_MIN`                | 50 (Tier-3 cap)              |
| `SIXTYNINE_VIDEO_CONCURRENCY`   | 8                 | `SIXTYNINE_IMAGE_CONCURRENCY`              | 7                            |
| `SIXTYNINE_VIDEO_TIMEOUT_MS`    | 360s              | `SIXTYNINE_CALL_TIMEOUT_MS`                | 120s                         |
| `SIXTYNINE_DOWNLOAD_TIMEOUT_MS` | 300s              | `SIXTYNINE_VIDEO_SUBMIT_BURST`             | 2                            |
| `SIXTYNINE_VIDEO_SUBMIT_RATE`   | 5/min (API cap)   | `IMAGE_PRIMARY_TIMEOUT_MS`                 | 480s                         |
| `SIXTYNINE_TTS_SUBMIT_RATE`     | 20/min            | `SIXTYNINE_TTS_SUBMIT_BURST`               | 3                            |
| `SIXTYNINE_TTS_409_COOLDOWN_MS` | 45s               | `SIXTYNINE_TTS_5XX_BASE_DELAY_MS`          | 5s                           |
| `SIXTYNINE_TTS_JAM_TTL_MS`      | 60s               | —                                          | —                            |
| `IMAGE_PRIMARY_RETRIES`         | 1                 | `IMAGE_RETRY_TIMEOUT_MS`                   | 240s                         |
| `IMAGE_RETRY_TOTAL_BUDGET_MS`   | 600s              | `MYSQL_SORT_BUFFER_SIZE`                   | 8 MB                         |
| `AUTO_MIGRATE`                  | on (`0` skips)    | `ASSEMBLY_CACHE`                           | on (`0` skips)               |
| `LIPSYNC_RESOLUTION`            | 720p (480p/1080p) | `RUNPOD_LIPSYNC_INPUT`                     | image (`video` = pinned)     |
| `ASSEMBLY_CACHE_MAX_GB`         | 20                | `ASSEMBLY_CACHE_DIR`                       | tmp/longform-assembly-cache  |
| `RUNPOD_LIPSYNC_TIMEOUT_MS`     | 35 min (poll)     | `RUNPOD_LIPSYNC_EXECUTION_TIMEOUT_MS`      | 40 min (per-job GPU cap)     |
| `RUNPOD_LIPSYNC_TORCH_COMPILE`  | off (`1` = on)    | `RUNPOD_LIPSYNC_BATCH`                     | 2 beats per call (`1` = off) |
| `RUNPOD_LIPSYNC_BATCH_MAX_SEC`  | 14 s per call     | `RUNPOD_LIPSYNC_AUDIO_CFG_STEPS`           | 0.5 (first half guided)      |
| `RUNPOD_LIPSYNC_QUANTIZATION`   | fp8_e4m3fn        | `RUNPOD_LIPSYNC_V2V_STEPS` / `_START_STEP` | 12 / 3 (9 active)            |
| `LTX_LIPSYNC_MAX_SEC`           | 20 s per call     | `LTX_LIPSYNC_RESOLUTION`                   | unset (worker default)       |
| `LTX_LIPSYNC_TIMEOUT_MS`        | 20 min (poll)     | `LTX_LIPSYNC_EXECUTION_TIMEOUT_MS`         | 25 min (per-job GPU cap)     |
| `LTX_LIPSYNC_CONCURRENCY`       | 4                 | —                                          | —                            |

`RUNPOD_LIPSYNC_EXECUTION_TIMEOUT_MS` is sent with every submit as RunPod's `policy.executionTimeout`
and overrides the endpoint's own setting (dashboard default 20 min). InfiniteTalk at 720p on the
A40/A6000 class costs ~800 GPU-s per 81-frame window — a 6 s host beat is three windows, ~30 min —
so under a 20-min cap any beat over ~4 s was killed on every attempt and resubmitted identically for
as long as the job lived. A render RunPod stops at the cap now comes back `terminal` and fails its
scene with the levers named (shorter beat, 480p, faster GPU, higher cap); an ordinary provider
failure is resubmitted at most `MAX_INFRA_RESUBMITS` (2) times before the scene fails too.

`MYSQL_SORT_BUFFER_SIZE` is set per pooled connection in `server/db.ts`. MySQL's 256 KB default
is not enough for the library query: filesort sizes its buffer from each column's **declared**
width, and `json_unquote(json_extract(...))` is typed LONGTEXT (4 GB), so it fails with
`ER_OUT_OF_SORTMEMORY` on a table holding one row. MySQL 9.4 hits this and 8.4 does not on
identical settings — so it reproduces in production only. `AUTO_MIGRATE=0` skips the boot-time
migration in `server/migrate.ts`.

## Cost rates (`server/pricing.ts`)

Quantities are metered from real calls; **only Anthropic's rates are exact**. Every other rate
is a list-price estimate because HeyGen/69Labs/APIMART bill per-plan credit bundles — check one
invoice, then pin the real number via the env var below (or edit the file).

| Var                          | Default     | Var                               | Default  |
| ---------------------------- | ----------- | --------------------------------- | -------- |
| `COST_APIMART_IMAGE`         | $0.02/image | `COST_OPENAI_IMAGE`               | $0.003   |
| `COST_APIMART_VIDEO_PER_SEC` | $0.02/s     | `COST_HEYGEN_PER_SEC`             | $0.06/s  |
| `COST_TTS_PER_1K_CHARS`      | $0.05       | `COST_GEMINI_IMAGE`               | $0.03    |
| `COST_69LABS_IMAGE`          | $0.05       | `COST_69LABS_VIDEO_PER_SEC`       | $0.05/s  |
| `COST_WHISPERX_PER_GPU_SEC`  | $0.0004     | `COST_RUNPOD_LIPSYNC_PER_GPU_SEC` | $0.00097 |
| `COST_LTX_LIPSYNC_PER_GPU_SEC` | $0.00097  | —                                 | —        |

## Architecture

React 19 · wouter · TanStack Query · tRPC 11 · shadcn/ui · Tailwind v4 —
Express · tRPC · Drizzle · MySQL.

- `server/_core/index.ts` — bootstrap order: fontconfig → ffmpeg probe → adminAuth →
  HeyGen webhook → `/api/download` proxy → tRPC → Vite/static → watchdog
- `server/longformVideo.ts` — **9k lines, the whole pipeline. Start here.**
- `server/routers.ts` — tRPC surface · `server/videoAssembly.ts` — ffmpeg assembly
- `shared/filmTimeline.ts` — `planMasterOverlayScenes` + `planScenePieces`, the pure arithmetic
  deciding where every frame of a film comes from. In `shared/` so the renderer
  (`videoAssembly.ts`), the chapter map (`videoTimeline.ts`) and the browser's live cut preview
  all run the SAME code — a second implementation would drift and the preview would show a cut
  Reassemble does not produce. `videoAssembly.ts` re-exports both, so existing importers are
  unchanged
- `server/assemblyCache.ts` — content-addressed disk cache for assembly's intermediates. Each
  normalized clip, muxed scene, film narration track and music mix is named by a hash of its
  own inputs, so a Reassemble after a one-scene edit re-encodes that one scene and reuses the
  rest. `CACHE_EPOCH` in that file MUST be bumped whenever a cached arg builder changes —
  bumping is free, forgetting ships a film assembled from stale bytes. Every failure mode
  (no dir, full disk, corrupt entry) degrades to "encode it now"
- `client/src/components/LongformCutPreview.tsx` — the same film with NO assembly: the browser
  plays the scene clips against the film's own narration, so an edit is judged in a second
  instead of a re-encode. Its clock is FILM time, planned by `shared/filmTimeline.ts`, so trims,
  splits, per-piece slips and frozen holds are exact: during a hold the picture freezes and the
  narration pauses, precisely where assembly splices its silence in. Outside a hold the NARRATION
  is the clock and nothing seeks it — slaving the voice to a wall clock livelocks, because every
  correction is a seek, a seek drops readyState, that stalls the clock, and the drift grows.
  TWO NARRATION SHAPES feed that clock, and `planCutBeats` picks between them. An ordinary job
  has one master track with every scene carrying its slice, and plays on that track's own
  timeline. A job with NO master has each scene's own voice file instead, laid end to end to
  recover the very timeline assembly's per-scene concat path builds — which is what a film whose
  master voicing FAILED becomes once "Retry failed scenes" repairs it beat by beat, since
  `ensureSceneNarration` clears a scene's master range as it re-voices it. That shape is not
  exotic and it is not broken: it renders and ships. Requiring a master here hid the preview on
  exactly those jobs, under copy that still said "preview them below". The narration therefore
  gets the video's ping-pong pair too, swapped ONLY where the track actually changes — on a
  master job it never changes, so one element still plays through every cut untouched, which is
  what the "nothing seeks it" rule above depends on. The beat signature carries the track for the
  same reason: a poll can change a scene's audio while its clip and its timings do not move.
  Still a preview of the CUT, not the FILE — no burned-in QR/lower third/captions, no music bed
- `server/providers/ltx-lipsync.ts` — the THIRD host lane: self-hosted LTX-2 (Lightricks,
  open weights) on its own RunPod endpoint (`RUNPOD_LTX_ENDPOINT`, shared `RUN_POD_KEY`),
  chosen as `ltx` in Admin → Provider Keys beside HeyGen and InfiniteTalk. It started at the
  graph's own defaults and now departs from them in exactly the ways the first renders
  measured (2026-09-12, jobs 94 and 96, `scripts/measure-host-motion.mjs` +
  `measure-lipsync.mts`, one variable per render): the Gemma prompt ENHANCER is off
  (`LTX_LIPSYNC_ENHANCE_PROMPT`; on, it rewrote "static camera" into a push-in — background
  morph 31.6 against a limit of 1, 2.3 with it off), the direction spells the locked-off camera
  out positively and carries NO gesture cue (`LTX_LIPSYNC_DIRECTION`; the negative prompt is
  never read at CFG 1, and "leans in" is a camera move to this model), the sampler is `euler`
  (`LTX_LIPSYNC_SAMPLER`; on the graph's `euler_ancestral` the mouth's correlation with the
  words was CHANCE, r 0.05, and r 0.47 on euler with nothing else changed), and the worker
  compensates a measured 10-frame MOUTH LAG (renders the narration padded on the 1+8n grid,
  drops the first 10 frames, muxes the original back — `LTX_LAG_FRAMES` on the endpoint) that
  put the mouth 400-520 ms behind the sound on every render of both hosts. Final numbers on
  Granny Mae: r 0.34 at 0 ms, 83% of sounds matched, lips closing at 0.051 — at or above the
  HeyGen reference (r 0.21, 0.059) — for ~$0.037 per finished second. The photo-anchor dial
  (`LTX_LIPSYNC_IMG_STRENGTH`) measured NO effect and audio guidance (`a2v_scale`, the pack's
  MultimodalGuider) did not beat euler; both stay as overrides. The lane still sends nothing
  else unless `LTX_LIPSYNC_RESOLUTION` / `_DECODE_TILE` are set. None of the
  InfiniteTalk machinery below (run-up, batching, plate, seams, sharpen) runs on it — that
  is a year of tuning against Wan's failure modes, not LTX's. The model renders at most 20 s
  per call, so `server/lipsyncChunks.ts` cuts a longer beat at real pauses (the master's
  silences mapped into scene time, else detected on the file) into chunks of the same scene,
  which `runChunkTasks` renders and `composeHostScene` joins as it always could; a resume
  re-runs the plan only, for the chunk lengths the truncation guard needs. Billed by GPU time
  like InfiniteTalk, so it meters its own `executionTime` (provider `ltx`, its own
  `COST_LTX_LIPSYNC_PER_GPU_SEC`) and `cancelJobProviderRenders` stops its renders too. The
  worker contract is in the adapter's header: `{ image_url, audio_url, prompt, negative_prompt?,
  width?, height?, seed? }` in, `{ video: base64 mp4, error?, timings? }` out, input audio
  returned untouched. Worker source: `Metropolis-Media/ltx-auto-edit-test` (a mirror of
  `Lightricks/ComfyUI-LTXVideo`; the image+audio graph is
  `example_workflows/2.5/LTX-2.5_A2V_Two_Stage_Distilled.json`)
- `server/providers/` — one adapter per vendor; `base.ts` is the interface,
  `fallback.ts` the image chain (primary → Gemini). The host lip-sync lane has TWO adapters,
  picked in `resolveLipsyncLane` and handed to callers that know neither: `heygen-lipsync.ts`
  (Avatar IV, 1080p, per-tab account keys, billed per second of output) and
  `runpod-lipsync.ts` (self-hosted InfiniteTalk, ≤720p, one shared endpoint, billed per GPU
  second — so it meters itself from RunPod's `executionTime` instead of being wrapped by the
  per-output-second meter in `resolveLipsyncAdapter`). HeyGen is the default; RunPod requires
  an explicit opt-in, since a deployed endpoint should be testable without silently moving
  every render onto it. That choice (and the RunPod quality tier) lives in `app_settings` via
  `server/lipsyncProvider.ts` and is flipped in Admin → Provider Keys, with
  `LIPSYNC_PROVIDER` / `RUNPOD_LIPSYNC_QUALITY` as the DEFAULTS an unset row falls back to —
  so switching vendors needs no redeploy, and switching away from HeyGen never touches the
  stored HeyGen keys. Only the RunPod lane is prompted
  (`buildLipsyncPrompt`) and only it needs `useAlt` spelled out — Avatar IV inherits the
  still's gaze, InfiniteTalk squares an off-axis subject up to the lens unless told not to.
  Being billed by RUNNING time also makes abandonment expensive there and free on HeyGen, so
  the lane carries an optional `cancel` that `withSceneDeadline` fires when it gives up on a
  host scene — otherwise a wedged render bills on to the endpoint's own execution timeout.
  A poll TIMEOUT deliberately does not cancel: it returns `pending` so a resume can still
  collect a render already paid for. CANCELLING or DELETING a job now stops the GPU too
  (`server/cancelRenders.ts`): both used to touch database rows only, so a render already
  submitted ran on unwatched — one left over from a removed job billed 8 minutes of GPU before
  it was spotted, and would have run to the execution cap. `cancelJobProviderRenders` is called
  before the row is written or removed (the ids die with it), touches only scenes whose
  `renderProvider` is `runpod` (a 69Labs or HeyGen task is billed per OUTPUT, so abandoning one
  costs the same as stopping it), and is best-effort — `cancelJob` never throws. The RunPod lane also sends a NEGATIVE prompt
  (`LIPSYNC_NEGATIVE_DIRECTION`): the fast tier's cfg 1 skips the uncond pass entirely, so
  the worker workflow wires it through NAG (attention-level guidance, ~10-25% per step vs
  CFG's +100%) — before that, no negative wording did anything on the tier renders actually
  use. Its camera has two conditioning modes (`lipsync_camera` in app_settings, same
  Admin panel): `photo` sends the host photo (I2V — Wan's prior drifts slowly toward the
  speaker and re-hallucinates the background), `pinned` sends a static VIDEO of that photo
  built per render by `server/cameraPlate.ts` (V2V mimics the input's camera; a video where
  nothing moves has none to mimic — the InfiniteTalk maintainer's own fix). The operator
  still only uploads a photo; plates are bucketed 15s and cached per (photo, bucket), and
  any plate failure falls back to photo conditioning — which is a measured quality CLIFF, not a
  nicety: a render whose plate build failed (transient R2 unreachability) came back with
  background morph 2.22 against a 1.0 limit and a plain body, because the PHOTO direction says
  "calm and still" while every body/brow improvement lives on the PINNED one. So the build
  retries with backoff (`PLATE_ATTEMPTS`) before giving up, the fallback logs at error level,
  and the lane records `scene.lipsyncConditioning` so a degraded render is visible afterwards
  instead of having to be inferred from the picture. The photo direction now carries the
  mouth-region half of the pinned work (lips do the work, jaw and cheeks quiet, brows alive)
  but keeps its body suppression: with no plate holding the frame, "sway" and "camera drift"
  are the same failure in I2V. The RunPod lane also hands the worker a
  RUN-UP (`server/lipsyncLead.ts`, `RUNPOD_LIPSYNC_LEAD_SEC`, default 2): the model starts
  from a frozen photo and its first ~2 s are a talking statue, so the preceding narration is
  prepended and that much trimmed off the returned clip (`trimClipHead` in `runChunkTasks`,
  lead remembered on `scene.lipsyncLeadSec` for a resume). Its LENGTH is then snapped to the
  render-window grid (`fitLeadToWindowGrid`): cost is a step function — 81 frames for the first
  window, `81 - motion_frame` new ones for each after — so a run-up that pushes a beat a few
  frames past a boundary buys a whole extra window for warm-up nobody sees. Measured on a 6.9 s
  beat at overlap 37: 2 s made 222 frames and 5 windows, 1.64 s makes 213 and 4 — same delivered
  picture, 20% less GPU, 82% of the warm-up kept. It only ever shrinks, never below
  `MIN_LEAD_SEC` (1 s, under which the cold start returns), and leaves a beat that is not near a
  boundary untouched. After the trim, `server/lipsyncSeams.ts`
  smooths the WINDOW HANDOFFS: InfiniteTalk renders 81-frame windows overlapping by
  `motion_frame`, and the person can jump where a new window begins (closed mouth to full smile
  in one frame, measured 2.8× the clip's typical frame change, background flat so the seam
  metric never saw it). The handoff frames are arithmetic (81 + k·(81−overlap) − trimmed lead),
  each is judged against its own neighbourhood, and one that stands out gets the two frames
  either side replaced by motion-compensated interpolations, so the change spreads over ~200 ms.
  Frame count and audio are untouched; any failure keeps the clip as rendered. That repair is
  for a ONE-FRAME jump, and `motion_frame` must stay wide enough (37, not the worker's 25) for
  the join to BE one: measured on the same join of the same sentence, overlap 37 gives a single
  spike the eye skips (.0021 / .0160 / .0018) while overlap 25 gives a sustained plateau (.0057
  / .0075 / .0061 / .0062 / .0070) — with less context carried across, the new window renders
  the head at a slightly different scale and the model blends its way there over a quarter of a
  second, which a viewer reads as a dissolve mid-sentence. Dropping to 25 to save ~27% of the
  windows was a false economy, and no spike-based check could see it. Host beats are
  rendered in GROUPS (`server/lipsyncBatch.ts`, `RUNPOD_LIPSYNC_BATCH`, default 2): a solo beat
  pays for ~40% frames nobody sees (the run-up and the padding out to the last 81-frame
  window), so consecutive host scenes sharing a photo/plate are packed into one call — run-up,
  beat, 500 ms room-tone gap, beat — rendered once and cut back at offsets measured from the
  real slice lengths. The group's LEADER carries the task id and cut list (`scene.lipsyncGroup`),
  members are marked `rendering` and never dispatched alone while their leader is in the batch;
  a member whose leader is gone renders solo (paid again, never lost). The compiler is wired
  into the worker's workflows (`RUNPOD_LIPSYNC_TORCH_COMPILE=0` unlinks it per job). Two more
  COST dials ride the same override contract and are judge-gated (one scene, one variable, the
  three measure scripts against the accepted clip): `RUNPOD_LIPSYNC_AUDIO_CFG_STEPS` keeps
  audio guidance — and its second model pass per step, ~45% of a beat's GPU time — on only the
  first fraction of the active steps (the mouth's shape is settled early; the sampler takes a
  per-step list and skips the pass where the value is 1.0, delivered via a KJNodes
  StringToFloatList node the handler inserts), and `RUNPOD_LIPSYNC_QUANTIZATION` casts the bf16
  weights to fp8 at load (`fp8_e4m3fn_fast`, native on Blackwell). The floor with guidance on
  every step is ~$0.05/s; the schedule is the lever that reaches ~$0.03/s at HeyGen's measured
  quality (mouth-tracking r 0.21, closure 0.059) — `scripts/lipsync-bench.mts` prints GPU-s per
  finished second beside the three verdicts for exactly that comparison. DELIVERY is
  script-based (`server/delivery.ts`): before the master is voiced, one Claude call reads the
  script paragraph by paragraph and returns a pace (slow/measured/natural/brisk → ±15% on the
  channel's speed dial), a pause to leave after it (0/300/600 ms of -56 dBFS room tone, not
  digital silence — the pause cap strips that and the ear hears a dropout) and a 3-5 word mood.
  When the plan changes the read, the master is voiced as RUNS of same-pace paragraphs joined
  with those beats instead of one request (`voiceMasterNarration`), the scene re-voice
  follows its paragraph's pace (`scene.deliveryPace`), and the mood is appended to the RunPod
  lip-sync prompt (`scene.deliveryCue`), as is a 3-6 word BODY cue (`scene.gestureCue`: "small
  nod on the number", "leans in slightly", "holds still") — the fixed direction can only ask for
  natural body language in general, and a host who moves BECAUSE of what she is saying is the
  difference between alive and plain. All of it rides the one Claude call and the same render,
  so gestures cost nothing. The pinned direction's body clause now names what a seated host
  does (small nods on stressed words, a slight lean on a point, weight shifts between
  sentences) with its own ceiling ("small, occasional, never rhythmic"), and `audio_scale`
  defaults to 1.15 — the voice drives the body harder for free, since it scales an embedding
  rather than adding a pass. A PINNED-only `audio_scale` of 1.8 was tried on 2026-09-07 and
  REVERTED: the plate damps this dial hard (at 1.3 the photo path measured 13-21% head travel
  of face size against pinned's 1-2%), so raising it looked like the obvious fix for a head
  that moves in TIME with the emphasis but only 1% of a face width. It did not raise the head
  and the render came back visibly softer. Whatever holds the pinned body still is not this
  dial being too low. `scripts/measure-host-body.mts` gates the result with a
  LIVELINESS line: head travel 6-12% of face size with shoulders at 0.1+ of the head's motion
  is the target band, measured off FOUR accepted reference-engine clips of two hosts (9, 9, 9
  and 12% travel; shoulders 0.12-0.24) rather than guessed. Those clips also settled what the
  balance should be: their MOUTHS move less than ours (articulation 2.6-2.9 against 4.5-7.0)
  while their heads and brows move more (114-163% of the mouth's motion against ~40%), so the
  pinned direction now puts the calm on the JAW AND CHEEKS ("the work is done by the lips
  alone") and frees what is above — brief brow lifts and small glances on the words that
  matter — with the wide-eyed shape still blocked by name in the negative and the blanket brow
  freeze removed. `audio_scale` 1.3 is the free half of the same gap. Reported as a target
  rather than a failure so a deliberately still beat is allowed, while the
  jitter/roughness/flicker caps above it still catch exaggeration. The CHAIN line measures the
  seated body band by band — head, shoulders, chest, lap, plus the arms — because a real body's
  movement DECAYS downward (reference clips: head 0.67-2.03, shoulders 0.25-0.56, chest
  0.20-0.35, lap 0.11-0.23, arms 0.10-0.16) while ours read almost flat (0.86 / 0.35 / 0.45 /
  0.64): the whole torso drifting as one mass, which no other line here can see and which is
  why a render can pass every check and still look wrong. The pinned direction now asks for the
  chain in those words ("the head leads … the chest only breathes … the lap, arms and hands
  stay settled"), and the negative names the floating-torso shapes without re-introducing the
  blanket suppressors that froze the body. Arms are deliberately NOT asked to gesture: none of
  the reference clips gesture, and at this framing hands sit on the frame edge where the model
  invents them (one reference clip drifts 20 in the lap band doing exactly that).
  The plan is snapshotted on `inputParams.deliveryPlan`
  so a resume voices the same film; no plan (mock mode, a failed call) means exactly the old
  behaviour. RESOLUTION is the one quality gap that
  is not a prompt or a dial: the lane renders 1280x720 and the film is 1920x1080, so a host
  clip is upscaled 1.5x while HeyGen's is native — 2.25x the pixels on the same face, and it
  shows in the eyes. `HOST_UPSCALE_SHARPEN` recovers the half that is the upscale's fault (two
  unsharp stages, small radius for iris and eyelash edges then wide for local contrast: the eye
  band reads 84 plain, 140 with the old single pass, 234 with both, against 186 for the
  reference engine's own eye band — and cheek flicker only moves 1.90 → 2.32 of a limit of 5).
  The other half needs real pixels: `LIPSYNC_RESOLUTION=1080p` renders the host natively at the
  film's own size. It was made the default on 2026-09-06 and reverted the same day — 2.25x the
  pixels is ~2.25x the GPU seconds, which undoes the cost work, and the checkpoint is trained at
  720p so 1080p is off-distribution and can duplicate features rather than add detail. It stays
  selectable per render; the sharpen carries the gap by default, and the bench settles whether
  1080p is actually better or merely dearer.
  STEP COUNT is the first thing to check when a host render looks soft, and on 2026-09-07 it
  was the last: `RUNPOD_LIPSYNC_V2V_STEPS`/`_START_STEP` set COST (the active count,
  `steps - start_step`), FREEDOM (the ratio) and QUALITY (how fine each denoising jump is,
  which only the TOTAL controls) all at once, and conflating them wasted a day. Renders at 6
  active steps — 8/2, half of what commit fca64a1 ran — came back with background morph 1.7-3.1
  against a limit of 1, motion roughness up to 0.79 against 0.7, and whole-frame Laplacian
  sharpness 374-431 against the reference engine's 463, and were reported for hours as "blurry"
  and "the resolution is off". Under-refined diffusion output is soft, morphy and rough: that
  IS the symptom list. Schedulers, plate anchors, sharpening, framing and `audio_scale` were
  all investigated first, and every conclusion drawn from those renders is suspect because the
  refinement was halved underneath them. The default is now 12/3 (9 active, ~$0.137 per
  finished second against 8/2's ~$0.095); fca64a1's 16/4 with guidance on every step and bf16
  weights was 24 model passes per window against today's 13, ~$0.31/s. Walk back toward it ONE
  change at a time and stop when it looks right. Two traps: these two are commonly set in
  `.env`, which silently beats every default in `env.ts` — check there before believing any
  code value — and the render-to-render NOISE FLOOR is +-40%, so judge a change on the median
  of two or three renders of the same beat, never on one clip.
  `scripts/measure-host-motion.mjs`
  turns "she moves too much" into numbers (per-region jitter + background morph vs frame 0)
  so a worker/prompt change is judged against the clip that prompted it, and
  `scripts/measure-lipsync.mts` (tsx; transcribes via whisperx, tracks the face with `pico.ts`)
  scores whether the mouth SAYS the words, with no reference needed: every word is looked up
  in the CMU Pronouncing Dictionary, each sound is given the opening speech requires (p/b/m
  shut, "ah" wide, t/d/s parted, silence shut), and that predicted curve is correlated with
  the measured mouth over ±600 ms of lag. Peak height is how well the mouth tracks the words,
  peak position is the sync offset (a mouth leads its sound by 40-120 ms, so small negative
  lags are normal), and the far-lag level is the built-in out-of-sync control — a SyncNet-style
  offset/confidence pair driven by the script instead of a learned audio model, so it is
  host- and sentence-independent. A per-sound pass/fail table names WHERE it missed but is
  informational: shifted 400 ms it barely changes, and it prints that shifted score beside
  itself. A host's accepted HeyGen clip can still be saved as a profile
  (`--save-reference NAME` → `scripts/lipsync-reference/NAME.json`) and passed with
  `--reference NAME` — that adds HeyGen's column on the same judge plus the older per-class
  A-Z table and contact sheet. `scripts/measure-host-body.mts` does the same for the REST of
  the host with no reference: every region follows the tracked face (one median box per
  clip — a box that wobbled with the detector manufactured an 11 px head "jump"), and each
  verdict is a rule of human behaviour: blink rate 8-40/min and 80-400 ms each, no one-frame
  flicker, eyes still between blinks, head motion below 4 Hz (energy above it is sampler
  jitter), head travel 1-40% of face size, shoulders moving less than the head and with it.
  Head-motion-vs-loudness and eyes-vs-photo are printed but informational: over a 5 s beat
  even the accepted clip shows no head/speech correlation, and a box-cut eye band reads the
  photo ~25% narrower than that clip — landmarks would fix the second. `--beside other.mp4`
  prints a second clip in a side column; `--photo host.jpg` adds the photo line
- **Host minutes** (`shared/hostMinutes.ts` + `planHostMinutes`/`capHostMinutes` in
  longformVideo) — the per-video host budget, picked on the generate form ("Talking head": 3 /
  4 / 5 / 6 / 7 min, default 3, `client/src/components/LongformHostMinutes.tsx`). Lip-sync is
  billed per second of output, so the old percentage mix (35%) made a film's biggest cost grow
  with its length; a job carrying `inputParams.hostMinutes` spends a fixed number of seconds
  instead, and a job without it runs `rebalanceHostScreenTime` exactly as before. The budget is
  `resolveHostBudget`, run TWICE on the same function: by the form on the word-count estimate
  (`ESTIMATE_WORDS_PER_SEC`, which `WORDS_PER_SEC` now re-exports, so the form's "roughly N min"
  moved from 150 wpm to the calibrated 168) to decide whether the confirm dialog asks, and by the
  pipeline on the measured narration. Within the guide (the visual-mix host share) ⇒ the pick;
  over it ⇒ the dialog asks, "use anyway" (`hostMinutesOverride: true`) honours the pick up to
  HALF the film, "use the guide" (`false`) takes the guide. `undefined` means nobody was asked —
  the estimate fitted — so a film that measures shorter falls back to the guide and the job
  carries a warning saying so. The plan, after voicing and before any clip is paid for: the hook,
  every CTA/scan-window host beat and the outro are ANCHORS (never removed), with a reserve for
  the beat `ensureHostInCta` will flip later; the rest of the budget becomes check-ins at evenly
  spaced targets ~60 s apart in each stretch between anchors — nearest existing host beat in the
  window, else a ≤10 s cutaway promoted (`promoteCutawayToHost`, shared with
  `shapePitchQrStretches`) — widening the spacing until the budget covers every target and
  visiting targets middle-out so a short budget still spreads; leftover budget keeps more of the
  storyboard's own host beats; every other host beat goes to the still lane. Splits and alt
  angles are host renders and count toward it. `capHostMinutes` re-checks after the CTA passes
  (which add host beats late) and demotes the most redundant check-in, never an anchor. The
  storyboard prompt is unchanged: it still writes host at the ramp's shares, which is what gives
  the planner candidates near every target. Harness: `client/__harness/host-minutes.html`
- `server/hostPlate.ts` — **provider-independent**. The lip-sync model animates the image it
  is handed and never changes the setting, so `HOST_PLATES=1` generates a 16:9 plate of the host
  IN each beat's setting (host photo as identity reference) and syncs from that instead of the
  studio headshot. Host beats are bucketed into `HOST_PLATE_LOOKS` looks sharing one plate —
  fewer generated faces to keep consistent, and fewer images. Falls back to the raw photo on any
  failure
- `server/faceAlign.ts` + `server/pico.ts` — split-screen host centring. The host panel is the
  middle ~44% of the 16:9 host clip, so the crop is panned to the face: `pico.ts` is a vendored
  pure-JS frontal-face cascade (asset `server/assets/facefinder`, offline, deterministic),
  Haiku is the fallback, and `measureHostFocusX` (videoAssembly) crops the sampled frames the
  way ffmpeg will and re-detects to VERIFY the face sits mid-panel. The result persists as
  `scene.splitAutoFocusX` and is reused by every recomposite; manual `splitLayout.hostFocusX`
  overrides it
- `server/sceneEditQueue.ts` + `enqueueSceneEdit`/`runSceneEditSession` (longformVideo) — operator
  edits on a rendered job (regenerate scene, batch regenerate, split edits) are queued per job and
  run by ONE edit session inside a single `withJobLock` pass: one live storyboard document, tasks
  rendered concurrently through lane semaphores, new clicks picked up while it runs, job flipped
  `processing` once and settled once. Same scene: pending ⇒ superseded, rendering ⇒ ignored (the
  router returns `accepted`). `pollJob.sceneEdits {queued, active, editing}` drives the client's
  per-scene Queued/Rendering badges and keeps the editors live (`isPipelineRunning`, not
  `isProcessing`, hides them)
- `server/sceneTiming.ts` — the cut room: pure edits to WHEN a scene's picture shows, on top of a
  narration that never moves — with ONE exception, the ripple trim below. A scene sits on screen for `max(its slice, its floor)` — the FLOOR
  being `scene.minHoldSec` (`applySceneHoldFloor`), NEVER `audioDuration`. That distinction is
  load-bearing twice over: `audioDuration` is measured at TTS time and the ranges are then
  snapped onto real pauses (`SNAP_TOLERANCE_SEC` 0.75s), so on an ORDINARY untouched scene the
  measured length routinely exceeds the slice — uncapped, every such scene froze its last frame
  for the difference and had that much silence spliced under it; and it goes stale outright when
  a scene is shortened, pinning it to its old length so the film got LONGER when asked to get
  shorter. A storyboard predating `minHoldSec` gets the floor DERIVED server-side
  (`sceneFloorSec`) for assembly and for `pollJob`, since `floorFor` needs the channel's pacing
  and the browser cannot work it out; `shared/filmTimeline.ts` falls back to `MAX_SCENE_FLOOR_SEC`
  only if neither reaches it. And an OPERATOR-SET length wins over both the floor and the CTA tail
  default (`operatorSetLength` — the narration range differs from `timingOriginal`'s): those
  defaults exist to stop the PIPELINE emitting a flash beat or an unscannable QR, not to overrule
  a length a person chose. All four consumers map a scene through the one `sceneHoldPlan` helper
  so they cannot disagree. Consequence worth knowing: re-timing a `qrTail` beat drops its 3s QR
  linger — set "Hold after line" explicitly to keep one. RIPPLE TRIM (`planRippleTrim`/`applyRippleTrim`) is the one edit that changes the
  film's LENGTH: it ends a scene earlier and DELETES the narration between there and where it
  ended, instead of handing those words to the next scene. The hole it leaves between one
  scene's end and the next one's start IS the instruction — `masterOverlayEligible` allows gaps
  (an overlap, and a non-zero FIRST start, stay illegal), and `buildMasterOverlayAudioArgs`
  concatenates the spans either side of it via `planMasterOverlayParts`, the one walk that
  handles inserts and drops together. The cut snaps onto a real pause (`snapToPause`) using
  `job.masterSilences`, kept at voicing instead of thrown away, so it never lands mid-word; a job
  voiced before that column existed cuts exactly where the operator dragged and says so. It is the DEFAULT for
  both handles: shortening a scene removes what it gives up, at either edge. The old
  hand-it-to-the-neighbour behaviour is still there behind "Give time to neighbour", but it is no
  longer what happens when you say nothing — handing the time over grows the neighbour, and a
  scene stretched past its own footage freezes on its last frame, so the commonest edit used to
  produce exactly the frozen tail an operator was trying to remove. Trimming a START drops that
  scene's opening words, so its own `clipInSec` advances to keep a lip-synced mouth on the voice;
  trimming an END inside one continuous shot (`isContinuousPair`) pulls the second half's
  `clipInSec` back by the same amount so the picture doesn't jump at an invisible seam. The first
  scene's start cannot be rippled at all. A rippled film also
  suppresses assembly's "stretch the final slice" fix-up, which would otherwise put a trailing cut
  straight back. Trim (`scene.clipInSec`), move a cut between neighbours
  (`narrationStartSec/EndSec`, lip-synced hosts keep sync by trimming) — one-directional, in that
  a boundary handle only ever SHORTENS the scene it belongs to and never leaves that scene's own
  range (`boundaryLimits`); the bounds used to come from the NEIGHBOUR's far edge, so an 11–17
  scene could be dragged out to 5.5–23. Time given up goes to the neighbour on that side, so
  lengthening a scene means shortening its neighbour from that neighbour's editor. Split a scene in two (same
  footage continues; renumbers), hold the last frame (`scene.tailHoldSec` — the CTA release beat's
  hard-wired `QR_TAIL_HOLD_SEC = 3` is its default; 0 removes the pause) or hold the FIRST frame
  (`scene.headHoldSec` — `tailHoldSec`'s mirror, at the front; only the film's actual first scene
  qualifies, since every other scene's start is a shared boundary with a neighbour instead). A
  head hold prepends silence to the master-overlay audio at that scene's own `sliceStartSec`
  (`atSec: 0` — spliced in specially, `buildMasterOverlayAudioArgs`'s `leadHold`, since there's no
  master-audio chunk before it to trim) and clones the FIRST frame in `buildSceneMuxArgs`
  (`tpad`'s `start_duration`, the mirror of its existing `stop_duration` tail hold) — the master
  narration itself never moves. Queued on the edit session as `timing` / `cut` requests — instant
  metadata writes: they never mark a scene failed,
  never flip the job to `processing`, and are hidden from `pollJob.sceneEdits`, so a split looks
  like a split (moving the cut between two continuous same-footage neighbours carries the footage across it —
  `isContinuousPair`). SPLIT is CapCut-style: it places a cut MARKER on the one clip
  (`scene.cutPoints`, `addCutPoint`) — the scene stays one clip/one card, the marker just shows
  the division on the timeline; output is unchanged (no reassemble) until a piece is acted on.
  Every footage-addressing edit — both slips, placing a cut, dragging one — stops on the clip's
  LAST FRAME and never past it (`maxSlipSec` / `pieceLiveEnd` in `SceneTimingEditor.tsx`), and
  does nothing at all while the clip's duration is still unknown (that case used to be
  `Infinity`). The old bound reserved `MIN_SLICE_SEC`, which was too strict at the top and left a
  clip shorter than 0.5s un-slippable.
  Remove a marker to undo (`removeCutPoint`); drag a marker to slide it (`moveCutPoint`), clamped
  off the slice edges and off every other cut, carrying that piece's slip (below) to the new key.
  Queued as `cut`/`uncut`/`movecut` requests — instant metadata, never flip the job. A piece IS
  acted on by slipping it (`scene.pieceClipIns`, keyed by the cut that starts it — `setPieceClipIn`
  / `pieceClipIn`): each piece between cuts can show a different moment of the SAME footage,
  independent of its neighbour — no separate AI regeneration per piece. Queued as a `piececlip`
  request; unlike a bare cut this DOES set `timingEdited` (a real render change). Assembly
  (`buildPiecedSceneVideo`/`planScenePieces` in `videoAssembly.ts`) trims+holds each piece
  separately then concats them — a piece whose chosen footage runs out before its on-screen time
  ends freezes on its own last frame, independent of its neighbour's freeze. A cut marker is free
  to add, drag or remove ONLY while nothing is slipped across it: dragging a cut that starts a
  slipped piece changes where that piece begins and how long it runs (and re-derives the next
  piece's continuous default), and removing one reverts that region to continuous footage — both
  real render changes, so `moveCutPoint`/`removeCutPoint` set `timingEdited` in exactly those
  cases. `timingEdited` drives
  the "Reassemble to apply" notice until a final is written. The FIRST edit to touch a scene
  saves its pristine cut to `scene.timingOriginal` (`snapshotTiming`, never overwritten — the
  target is the original, not one undo step), which is the only copy that exists: the narration
  ranges come from whisperx at voicing time and are overwritten in place, and the word timings
  behind them aren't persisted. `revertSceneTiming` puts one scene back and
  `revertAllSceneTiming` the whole job; a shared start/end edge carries the neighbour's opposite
  edge with it, which is safe because `applyTimingEdit` snapshots BOTH sides of a boundary while
  the board is still tiled, so the two recorded edges are the same number. A re-voice drops the
  snapshot (`forgetTimingSnapshot`) — the old edges stop describing anything. Jobs edited before
  this existed have no snapshot and the controls stay hidden. UI:
  `client/src/components/SceneTimingEditor.tsx`
- `server/narrationAlignment.ts`, `server/_core/voiceTranscription.ts` — whisperx
- `server/ttsMinimax.ts` — the SECOND voice lane, and the third narration option beside the
  channel voice and a supplied file. Deliberately NOT an automatic failover: the vendor is an
  operator's choice made before anything is voiced and pinned to `inputParams.ttsVendor`, so a
  film is never returned in a voice nobody asked for, and — the failure a `catch` would actually
  cause — a master is never stitched from two vendors when only some delivery runs had landed.
  The pin is read by `resolveTTSVendor`, and by regenerate/retry too: a MiniMax film whose scene
  is re-voiced on 69Labs gets a second voice spliced in, which is the manual-narration ban
  arrived at from the other direction. `voiceIdForVendor` picks the id, because the two live in
  different voice SPACES — `channel_configs.voiceId` is an ElevenLabs id or a 69Labs account
  clone and resolves on neither the other vendor nor MiniMax, so each channel carries its own
  `minimaxVoiceId`. Three traps this lane does not share with 69Labs: it is SYNCHRONOUS (one
  POST returns the audio, so `create` does the work and parks it for the `poll` microseconds
  later, keeping the retry loop unforked); its errors arrive as **HTTP 200** with
  `base_resp.status_code != 0`, so checking `resp.ok` reports an auth failure as success; and
  44100 is its sample-rate CEILING while our masters are 48k — the shared completion tail only
  resamples when a volume gain or dead-air cap actually runs, both no-ops on a clean file, so
  every clip goes through `normalizeNarrationAudio` unconditionally. The key is stored the way
  69Labs' is (AES row) but the row is NEVER active — active selects the one video/image
  provider, and marking MiniMax active would deactivate 69Labs and break every other lane. Its
  Group ID is not a secret and rides in `customConfig`; it also gets its own Test-connection
  route, since the generic one builds a `ProviderAdapter` and wraps it in `FallbackImageAdapter`,
  which is all about images. `pricing.ts` grew a per-provider `TTS_RATES` map for the same
  reason the image lane has one: reporting MiniMax spend at 69Labs' rate is a wrong number that
  looks right. UI: the MiniMax card in `AdminPage.tsx`, the voice field in
  `ChannelConfigPanel.tsx`, and the three-way chooser in `LongformNarrationUpload.tsx` — which
  names WHICH half is missing (no key ⇒ Provider Keys; no voice ⇒ Channels) rather than only
  greying out, because the two are configured on different screens
- `server/narrationUpload.ts` + `server/narrationIngest.ts` — the MANUAL-VO hatch, for a TTS
  vendor that is down. 69Labs is the only voiceover lane (`resolveTTSProvider` throws without
  it) while every other lane — APIMART b-roll, `gpt-image-2` stills, HeyGen/RunPod host,
  assembly — is independent of it, so one supplied mp3 is the difference between no film and a
  complete render. It is ONE substitution at ONE line: `voiceMasterNarration` returns
  `params.manualNarrationUrl` and makes no provider call, and everything after that statement
  (whisperx, `detectSilences`, `assignSceneRanges`, per-scene slicing, both lip-sync lanes,
  assembly) is alignment-driven and cannot tell a supplied master from a voiced one. Chosen over
  a parallel ingest pipeline precisely so the two paths cannot drift. The upload is a RAW
  streaming Express route, not the base64 data-URL mutation the image uploads use: a 20-minute
  narration is ~29 MB, ~39 MB once encoded, against a 50 MB JSON body cap — it fits today with
  no headroom for a longer film. `normalizeNarrationAudio` re-encodes any accepted container to
  the exact shape a voiced master has (mp3/48k/stereo, volume gain, dead-air cap), because every
  ffmpeg stage downstream was written against that and a 44.1k mono export surfaces as a subtly
  wrong film rather than an error. `verifyNarrationRead` is the gate that makes the whole thing
  safe, and it is not a formality: scene boundaries are recovered by locating each scene's text
  inside the transcript (`findPhrase`), so a wrong file, an older draft or an ad-libbed read does
  not FAIL — it degrades to the proportional split, losing CTA/QR keyword alignment invisibly
  until someone watches the finished film, after every clip has been paid for. `readCoverage` is
  a greedy in-order word match with a bounded look-ahead (unbounded, a skipped paragraph is
  "covered" by finding its words 900 words later); `MIN_READ_COVERAGE` is 0.85 because whisper
  mishears proper nouns and numerals, so a perfect read of the right script scores 0.93-0.98 and
  a different recording scores near zero — nothing realistic lands in between. A transcription
  OUTAGE returns `unverified` rather than a rejection: it says nothing about the read, and
  refusing there would block a correct upload on an unrelated failure. Consequence that is
  load-bearing elsewhere: fresh per-scene TTS is BANNED on such a job (`ensureSceneNarration`
  throws) — re-voicing one scene from a provider that did not read the other 200 puts a second
  voice inside one film, which unlike a missing slice still assembles and ships. The only legal
  repair is a re-cut of the supplied master. Lip-sync is unaffected: both lanes are handed
  `scene.audioUrl` and animate whatever waveform arrives, though the MOUTH is only as good as the
  slice boundaries, so a clean TTS export from another vendor aligns better than a room recording.
  The panel also hands out the DELIVERY DIRECTION before the operator records (`planDelivery` in
  the router) and pins it onto `inputParams.deliveryPlan`, which the pipeline reuses verbatim
  (`if (!params.deliveryPlan)` at the voicing stage). Without that, a supplied read and the
  host's BODY disagree: the plan's mood/gesture become `scene.deliveryCue`/`gestureCue` in the
  lip-sync prompt, and on an automatic render they and the voice come from one Claude call so
  they agree by construction — while a supplied read is fixed BEFORE the pipeline plans, and the
  plan is non-deterministic, so even a correctly-guessed mood would not survive into the render.
  Fetching it up front and pinning it makes the direction the host is given the same direction
  that was read. The voice settings (`TTS_STABILITY` 0.5 / `TTS_STYLE` 0.3 / `TTS_SIMILARITY`
  0.8, tuned as a SET) are shown with their OWN copy button, never concatenated into the script
  copy — a single blob pasted into a TTS text box would speak "Stability: 0.5" into the master,
  the `===START CTA===` failure again with nothing downstream to catch it. `supplyNarration`
  is the RESCUE path for a job that already died at voicing: it restarts through
  `runLongformPipeline` (the same entry point, so the pinned subject/style-bible/delivery-plan
  are reused and only the storyboard call repeats — one code path to keep correct instead of a
  bespoke resume lane), gated on `!masterAudioUrl` because a job that HAS voiced may have paid
  for clips that restarting would re-render. "Retry failed scenes" cannot serve this case at all:
  it re-renders CLIPS, and a job dead at voicing has none.
  UI: `client/src/components/LongformNarrationUpload.tsx` (`compact` = rescue mode, no toggle),
  harness `client/__harness/narration-upload.html`
- `server/costMeter.ts` + `server/pricing.ts` — per-video spend. Every billable adapter calls
  `recordUsage`; an `AsyncLocalStorage` set inside `withJobLock` attributes it, so the six
  spending entry points (pipeline, resume, retry-assembly, retry-failed, regen scene/scenes)
  are metered by construction and the adapters stay job-unaware. Totals persist to
  `longform_video_jobs.costUsage`; `getCostBreakdown` prices them for the Cost dialog
- **Accounts & roles** — `shared/roles.ts` is the single definition of the three tiers, and
  BOTH the tRPC gates (`server/_core/trpc.ts`) and the nav (`client/src/App.tsx`) answer from
  it, so what the UI hides and what the server refuses cannot drift. `admin` = everything
  including provider keys and account management; `manager` (operations manager) = channels,
  books, CTA assets, directing instruction, pacing and oversight of every render, never the
  keys; `editor` = long-form video and the library, scoped to their OWN renders (own five tabs,
  own history — `canSeeAllJobs`). Passwords are scrypt (`server/passwords.ts`, no native dep);
  `server/adminAuth.ts` holds the login route, the in-memory failed-attempt throttle and
  `ensureRootAdmin`. Sessions carry only a `uid` — `sdk.authenticateRequest` reloads the row on
  every request (2 s memo), so a role change or a disable takes effect immediately. Managed in
  Admin → Users (`client/src/components/admin/UserManagement.tsx`)
- `drizzle/schema.ts` — `users`, `provider_configs`, `longform_video_jobs`,
  `channel_configs`, `channel_layers`, `app_settings` (+ `books`, `channel_assets`,
  `longform_slots`, `longform_sales`)
- `client/src/pages/{LongformPage,AdminPage}.tsx` · aliases `@` → `client/src`,
  `@shared` → `shared`

## Pipeline (`longform_video_jobs.stage`)

1. **voiceover** — the verbatim script as ONE continuous master narration
   (per-paragraph TTS concatenated) → R2 `masterAudioUrl`; its duration sets film length
2. **storyboard** — Claude turns the script into a scene list sized to the narration,
   alternating host-on-camera and b-roll, opening/closing on the host
3. **clips** — one clip per scene: APIMART `grok-imagine-1.5-video` (or 69Labs
   fallback); stills/keyframes via `gpt-image-2`; host scenes lip-synced by HeyGen
4. **assembly** — concat + master narration laid over the whole film (per-scene
   `narrationStartSec/EndSec` map scenes onto it) + music bed, trimmed to narration

Always 16:9. Fire-and-forget; progress persisted to the job row and polled by the client.

## Gotchas

- **`JWT_SECRET` does double duty** — it signs the session cookie _and_ derives the AES
  key for stored provider keys. It is **required**: `getKey()` throws rather than falling
  back to a default. Rotating it logs everyone out **and** makes every stored
  69Labs/APIMART/HeyGen key undecryptable; they must be re-entered in Admin.
- **Single process only.** In-memory semaphores, per-job heartbeats, poll loops and the
  HeyGen webhook wake-up all assume it. No serverless, no horizontal scaling — one
  instance with restart-on-crash. The 1-min watchdog (`server/generationTimeout.ts`)
  resumes orphaned renders (provider results stay downloadable ~24 h).
- **`ADMIN_EMAIL` / `ADMIN_PASSWORD` are a bootstrap, not the login.** They create the first
  admin when `users` is empty and are ignored forever after — in particular they never
  overwrite a password changed in Admin → Users, so a stale value in the deploy's environment
  cannot silently reset it. The seed is pinned at **`id = 1`** because every pre-accounts job,
  slot and library row carries `userId = 1`; seeding anywhere else orphans all of it. With no
  admin row and no env vars, nobody can sign in and boot says so loudly.
- **A 69Labs TTS task is never abandoned.** `generateSceneVoiceover` persists the provider's
  task id on `scene.ttsTaskIds` (the TTS mirror of `renderTaskIds`) the moment it is created,
  and clears it once the audio is collected or the job reports `failed`. Before that the id
  lived only in a local, so a segment that spent both its 5-minute polling attempts walked away
  from a job STILL RUNNING on the account — and 69Labs then refuses the identical resubmit with
  409 `DUPLICATE_TTS_IN_PROGRESS` for as long as the orphan sits in its queue. The result was a
  render that could not be retried at all: every click resubmitted the same text, collided with
  a ghost of our own making, failed in milliseconds, and left the paid-for audio unreachable.
  A 409 is now recoverable rather than terminal — if the body names the blocking job
  (`parseDuplicateTaskId`) the caller ADOPTS that id and polls it, and if it names nothing the
  submit waits out a shared per-key cooldown sized to a TTS job's runtime, not a rate window.
  That wait is right for ONE orphan and wrong for an account full of them — it is per submit, so
  a retry across 200 unvoiced scenes spent minutes each to learn the identical fact — hence
  `_duplicateJams`: once a submit spends its whole 409 budget, other submits on that key fail
  instantly for `SIXTYNINE_TTS_JAM_TTL_MS` (60s), cleared by the first accepted submit. And a
  pass now writes `sceneStatus: "processing"` to the row when it CLAIMS a scene, not when the
  scene finishes, so a beat being re-voiced reads as "Working" instead of showing the previous
  attempt's "Failed" badge for the whole wait.
  Two consequences worth knowing: a scene carrying `ttsTaskIds` will POLL rather than submit, so
  clearing that field by hand is what forces a genuinely fresh read; and the duplicate body's
  shape is still unverified, so `parseDuplicateTaskId` reads it defensively and rejects
  SCREAMING_SNAKE tokens (`DUPLICATE_TTS_IN_PROGRESS` is itself 25 characters of the id
  alphabet) and anything with no digit in it.
- **A batch repair must not be hostage to its worst member.** `restoreMissingNarrationSlices`
  re-cuts every missing per-scene slice out of the master in ONE call, and both halves of it
  used to be all-or-nothing — a strict `sliceAudioSegments` plus a `Promise.all` of uploads
  inside a single `try`. On a job with 200 missing slices, one range ffmpeg refused meant ZERO
  free repairs landed and all 200 fell through to fresh paid TTS (which is how the duplicate
  storm above got started). It now cuts through `sliceAudioSegmentsBestEffort`, uploads each
  scene independently, names every scene it could not repair, and persists whatever did land.
  The strict `sliceAudioSegments` remains for callers that need every cut (a lip-sync batch is
  meaningless with a hole in it). Related: `ensureSceneNarration` PROBES a scene that still has
  its audio but lost only the measured length — voicing there paid for a second reading of a
  correct slice and cleared the scene's master range, dropping the whole film off the
  master-overlay path to recover a number in the file's own header.
- **Provider gate**: generation needs an _active_ `provider_configs` row. "No active
  provider configured" ⇒ re-run `scripts/seed.mjs` or set active in Admin.
- **FFmpeg needs drawtext** or text overlays silently disable. The startup log names the
  binary it picked (`server/ffmpegPath.ts`); bundled `ffmpeg-static` has drawtext.
- **`*.r2.dev` is blocked on a lot of managed networks** (DNS NXDOMAIN _and_ TCP to its
  anycast IPs), while `<bucket>.<account>.r2.cloudflarestorage.com` stays reachable. The
  symptom is lopsided: every upload succeeds and every read back dies with
  `ENOTFOUND pub-<hash>.r2.dev`. Server-side reads therefore never use `R2_PUBLIC_URL` —
  `downloadToTemp` sends our own objects through `presignOwnBucketUrl`
  (`server/storage.ts`), which presigns them onto the S3 endpoint. Public URLs are still
  what gets persisted and handed to the browser and to providers, so a blocked network
  still breaks client-side playback and `/api/download` — check DNS before suspecting R2.
- **Music beds** come from your own R2 (`R2_PUBLIC_URL` + `music/beds/<set>/`, keys in
  `server/musicBeds.ts`). No external CDN is contacted at runtime.
- **Never commit `.env`**; never print key values into logs or chat — `maskApiKey()` in
  `server/encryption.ts` is there for display.
- **Current local `.env`** sets only `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`,
  `ADMIN_PASSWORD`, `PORT` — every provider key is absent, so any generation run fails at
  stage 1.

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
| `PUBLIC_BASE_URL`                                                        | `server/providers/heygen-lipsync.ts:78` (webhook callback URL)                                         | blank ⇒ pure polling; slower, still works |

### Channel B — DB-stored, AES-256-GCM, entered in Admin

| Key               | Storage                                                                                      | Base URL                    |
| ----------------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| 69Labs            | `provider_configs.apiKeyEncrypted` (`server/db.ts`)                                          | `https://69labs.vip/api/v1` |
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

| Var                             | Default         | Var                                   | Default                     |
| ------------------------------- | --------------- | ------------------------------------- | --------------------------- |
| `FFMPEG_PATH`                   | auto-probe      | `FFMPEG_CONCURRENCY`                  | cpu-derived                 |
| `FFMPEG_PROBE_MAX_MS`           | 600s            | `ASSEMBLY_DOWNLOAD_TIMEOUT_MS`        | 120s                        |
| `PROBE_MAX_MS`                  | 60s             | `BROLL_NO_KEYFRAME`                   | unset (`1` disables)        |
| `R2_CONNECTION_TIMEOUT_MS`      | 10s             | `R2_REQUEST_TIMEOUT_MS`               | 120s                        |
| `APIMART_RATE_PER_MIN`          | 40              | `APIMART_BURST`                       | 5                           |
| `HEYGEN_CONCURRENCY`            | 8               | `HEYGEN_CALL_TIMEOUT_MS`              | 120s                        |
| `HEYGEN_DOWNLOAD_TIMEOUT_MS`    | 300s            | `OPENAI_IMAGE_CALL_TIMEOUT_MS`        | 300s                        |
| `OPENAI_IMAGE_BURST`            | 1               | `OPENAI_IMAGE_RATE_PER_MIN`           | 50 (Tier-3 cap)             |
| `SIXTYNINE_VIDEO_CONCURRENCY`   | 8               | `SIXTYNINE_IMAGE_CONCURRENCY`         | 7                           |
| `SIXTYNINE_VIDEO_TIMEOUT_MS`    | 360s            | `SIXTYNINE_CALL_TIMEOUT_MS`           | 120s                        |
| `SIXTYNINE_DOWNLOAD_TIMEOUT_MS` | 300s            | `SIXTYNINE_VIDEO_SUBMIT_BURST`        | 2                           |
| `SIXTYNINE_VIDEO_SUBMIT_RATE`   | 5/min (API cap) | `IMAGE_PRIMARY_TIMEOUT_MS`            | 480s                        |
| `SIXTYNINE_TTS_SUBMIT_RATE`     | 20/min          | `SIXTYNINE_TTS_SUBMIT_BURST`          | 3                           |
| `IMAGE_PRIMARY_RETRIES`         | 1               | `IMAGE_RETRY_TIMEOUT_MS`              | 240s                        |
| `IMAGE_RETRY_TOTAL_BUDGET_MS`   | 600s            | `MYSQL_SORT_BUFFER_SIZE`              | 8 MB                        |
| `AUTO_MIGRATE`                  | on (`0` skips)  | `ASSEMBLY_CACHE`                      | on (`0` skips)              |
| `LIPSYNC_RESOLUTION`            | 720p (all envs) | `RUNPOD_LIPSYNC_INPUT`                | image (`video` = pinned)    |
| `ASSEMBLY_CACHE_MAX_GB`         | 20              | `ASSEMBLY_CACHE_DIR`                  | tmp/longform-assembly-cache |
| `RUNPOD_LIPSYNC_TIMEOUT_MS`     | 35 min (poll)   | `RUNPOD_LIPSYNC_EXECUTION_TIMEOUT_MS` | 40 min (per-job GPU cap)    |

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
  plays the scene clips against the master narration, so an edit is judged in a second instead
  of a re-encode. Its clock is FILM time, planned by `shared/filmTimeline.ts`, so trims, splits,
  per-piece slips and frozen holds are exact: during a hold the picture freezes and the narration
  pauses, precisely where assembly splices its silence in. Outside a hold the NARRATION is the
  clock and nothing seeks it — slaving the voice to a wall clock livelocks, because every
  correction is a seek, a seek drops readyState, that stalls the clock, and the drift grows.
  Still a preview of the CUT, not the FILE — no burned-in QR/lower third/captions, no music bed
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
  collect a render already paid for. The RunPod lane also sends a NEGATIVE prompt
  (`LIPSYNC_NEGATIVE_DIRECTION`): the fast tier's cfg 1 skips the uncond pass entirely, so
  the worker workflow wires it through NAG (attention-level guidance, ~10-25% per step vs
  CFG's +100%) — before that, no negative wording did anything on the tier renders actually
  use. Its camera has two conditioning modes (`lipsync_camera` in app_settings, same
  Admin panel): `photo` sends the host photo (I2V — Wan's prior drifts slowly toward the
  speaker and re-hallucinates the background), `pinned` sends a static VIDEO of that photo
  built per render by `server/cameraPlate.ts` (V2V mimics the input's camera; a video where
  nothing moves has none to mimic — the InfiniteTalk maintainer's own fix). The operator
  still only uploads a photo; plates are bucketed 15s and cached per (photo, bucket), and
  any plate failure falls back to photo conditioning. The RunPod lane also hands the worker a
  RUN-UP (`server/lipsyncLead.ts`, `RUNPOD_LIPSYNC_LEAD_SEC`, default 2): the model starts
  from a frozen photo and its first ~2 s are a talking statue, so the preceding narration is
  prepended and that much trimmed off the returned clip (`trimClipHead` in `runChunkTasks`,
  lead remembered on `scene.lipsyncLeadSec` for a resume). After the trim, `server/lipsyncSeams.ts`
  smooths the WINDOW HANDOFFS: InfiniteTalk renders 81-frame windows overlapping by
  `motion_frame`, and the person can jump where a new window begins (closed mouth to full smile
  in one frame, measured 2.8× the clip's typical frame change, background flat so the seam
  metric never saw it). The handoff frames are arithmetic (81 + k·(81−overlap) − trimmed lead),
  each is judged against its own neighbourhood, and one that stands out gets the two frames
  either side replaced by motion-compensated interpolations, so the change spreads over ~200 ms.
  Frame count and audio are untouched; any failure keeps the clip as rendered. DELIVERY is
  script-based (`server/delivery.ts`): before the master is voiced, one Claude call reads the
  script paragraph by paragraph and returns a pace (slow/measured/natural/brisk → ±15% on the
  channel's speed dial), a pause to leave after it (0/300/600 ms of -56 dBFS room tone, not
  digital silence — the pause cap strips that and the ear hears a dropout) and a 3-5 word mood.
  When the plan changes the read, the master is voiced as RUNS of same-pace paragraphs joined
  with those beats instead of one request (`voiceMasterNarration`), the scene re-voice
  follows its paragraph's pace (`scene.deliveryPace`), and the mood is appended to the RunPod
  lip-sync prompt (`scene.deliveryCue`). The plan is snapshotted on `inputParams.deliveryPlan`
  so a resume voices the same film; no plan (mock mode, a failed call) means exactly the old
  behaviour. `scripts/measure-host-motion.mjs`
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

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
| `HEYGEN_API_KEY`                                                         | `server/longformVideo.ts` (`resolveLipsyncAdapter`) — **fallback only**, used when no HeyGen account has a key | host lip-sync fails with no account       |
| `RUNPOD_INFINITETALK_ENDPOINT` + `LIPSYNC_PROVIDER=runpod`               | `server/providers/runpod-lipsync.ts` — **optional**, moves host lip-sync off HeyGen                    | host lane stays on HeyGen (the default)   |
| `PUBLIC_BASE_URL`                                                        | `server/providers/heygen-lipsync.ts:78` (webhook callback URL)                                         | blank ⇒ pure polling; slower, still works |

### Channel B — DB-stored, AES-256-GCM, entered in Admin

| Key               | Storage                                                                                      | Base URL                    |
| ----------------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| 69Labs            | `provider_configs.apiKeyEncrypted` (`server/db.ts`)                                          | `https://69labs.vip/api/v1` |
| MiniMax (TTS)     | `provider_configs` row + `customConfig.groupId` (`saveMinimaxProvider`)                      | `https://api.minimax.io/v1` |
| APIMART ×N + edit | `app_settings` → `apimart_key_slot_0..19`, `apimart_key_edit` (`server/longformVideo.ts`)    | `https://api.apimart.ai`    |
| HeyGen ×N         | `app_settings` → `heygen_key_slot_0..19` (`server/longformVideo.ts`)                         | `https://api.heygen.com/v3` |
| HeyGen test       | `app_settings` → `heygen_key_test` — HeyGen test page only, never a film                      | `https://api.heygen.com/v3` |

APIMART and HeyGen keys are an ACCOUNT POOL (`shared/accountPool.ts`, 2026-10-04), not one key
per tab. They used to belong to tab numbers (`apimart_key_slot_N` = "tab N+1's key") and every
user has their own five tabs, so everyone's tab 1 rendered on the same account while account 5
sat idle, and a sixth could not be added. The rows are unchanged — account N+1 is still
`…_key_slot_N`, up to `PROVIDER_ACCOUNT_MAX` (20), so the five keys entered before are accounts
1–5 with nothing to re-enter — but a video is now given the LEAST BUSY account of each provider
at Generate (`assignJobAccounts` in `server/accountPool.ts`: fewest processing videos, lowest
number on a tie, picked and written under one in-process lock so two clicks landing together
cannot take the same one) and keeps it for life (`inputParams.apimartAccount` /
`heygenAccount`): a resume, retry or regenerate must reach the account holding its task ids, and
it never changes account by itself. `apimartKeyForJob` / `heygenKeyForJob` (longformVideo) are
the ONLY readers of a job's key — a tripwire in `accountPool.test.ts` fails on any other — and a
job made before the pool falls back to its tab number (`apimartSlot`). No account with a key ⇒
b-roll fails loud and the host uses the shared `HEYGEN_API_KEY`, as a keyless tab used to.
"Configured" is read off the stored row's masked tail, never a decrypt (a key derivation each).
Admin → Provider Keys lists accounts with "Add account", the balance and how many videos are
rendering on each; saving a row empty removes it. `LONGFORM_SLOT_COUNT = 5` is now only the
tabs per user. Only these two providers are pooled — 69Labs, OpenAI, Anthropic, Gemini, RunPod
and R2 are one shared key each, and OpenAI stills (50/min) and 69Labs TTS (20/min) are the next
ceilings when many videos run together. Harness: `client/__harness/activity.html`.

Crypto lives in `server/encryption.ts`:
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
| `SIXTYNINE_TTS_JAM_TTL_MS`      | 60s               | `TTS_WAIT_CHECK_MS`                        | 5 min                        |
| `TTS_WAIT_MAX_MS`               | 2 h               | `TTS_WAIT_MAX_REVOICES`                    | 2                            |
| `IMAGE_PRIMARY_RETRIES`         | 1                 | `IMAGE_RETRY_TIMEOUT_MS`                   | 240s                         |
| `IMAGE_RETRY_TOTAL_BUDGET_MS`   | 600s              | `MYSQL_SORT_BUFFER_SIZE`                   | 8 MB                         |
| `AUTO_MIGRATE`                  | on (`0` skips)    | `ASSEMBLY_CACHE`                           | on (`0` skips)               |
| `LIPSYNC_RESOLUTION`            | 720p (480p/1080p) | `RUNPOD_LIPSYNC_INPUT`                     | image (`video` = pinned)     |
| `ASSEMBLY_CACHE_MAX_GB`         | 20                | `ASSEMBLY_CACHE_DIR`                       | tmp/longform-assembly-cache  |
| `RUNPOD_LIPSYNC_TIMEOUT_MS`     | 35 min (poll)     | `RUNPOD_LIPSYNC_EXECUTION_TIMEOUT_MS`      | 40 min (per-job GPU cap)     |
| `RUNPOD_LIPSYNC_TORCH_COMPILE`  | off (`1` = on)    | `RUNPOD_LIPSYNC_BATCH`                     | 2 beats per call (`1` = off) |
| `RUNPOD_LIPSYNC_BATCH_MAX_SEC`  | 14 s per call     | `RUNPOD_LIPSYNC_AUDIO_CFG_STEPS`           | 0.5 (first half guided)      |
| `RUNPOD_LIPSYNC_QUANTIZATION`   | fp8_e4m3fn        | `RUNPOD_LIPSYNC_V2V_STEPS` / `_START_STEP` | 12 / 3 (9 active)            |

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

Quantities are metered from real calls; **only Anthropic's rates are exact**. Claude's prices are
never typed in: `server/claudePrices.ts` reads Anthropic's own price page
(`platform.claude.com/docs/en/about-claude/pricing.md`, by column header) at boot and daily, keeps
the last good table in `app_settings.claude_prices`, re-reads at once for a model it has no price
for, and keeps the old table if the page fails to parse. Each Claude call's dollars are fixed WHEN
IT IS METERED (`UsageLine.usd`, US-only ×1.1 included), so a later price change never rewrites an
old video; `BUILT_IN_CLAUDE_RATES` in `pricing.ts` is only the fallback. A whole pipeline run is
metered from Generate (`runLongformPipeline` → `withCostMeter`), and a call is counted the moment
Anthropic answers — including replies past our own timeout and replies with no text, both billed. Every other rate
is a list-price estimate because HeyGen/69Labs/APIMART bill per-plan credit bundles — check one
invoice, then pin the real number via the env var below (or edit the file).

CLAUDE COST PER STEP (2026-10-04): every `invokeClaude` call carries a `step` ("Shot list",
"Picture check (careful)", "Picture prompts"…), kept on the cost line (`UsageLine.step`, part of
the merge key), so the Cost dialog shows a line per step and model — before, only per model, and
which rule cost what was a guess. A new call site without a `step` still meters, under its bare
model name. Three levers went in with it, each with a switch back: the picture checker's rulebook
is cached apart from its per-picture questions (`systemSuffix`; `CLAUDE_SPLIT_SYSTEM_CACHE=0`) —
glued together every check re-wrote the cache, ~$0.0087 a careful check on the live site against
~$0.0053 with the split (job 337); `thinking: "off"` on the two yes/no checks on Sonnet 5 (same
object, clip glitch), which thinks when the param is omitted and bills it as output (sent only
where the model accepts it, `canDisableThinking` — Sonnet 5.5 and Opus 5.5 answer 400); and
cheaper models on three easy steps: what may be a video → Haiku (`SELF_MOVING_MODEL`), the
delivery plan → Sonnet 5 with thinking off (`DELIVERY_MODEL`), spoken lists → Sonnet 5.5
(`LIST_MODEL`). Haiku's rulebooks never cache: its minimum is 4,096 tokens and they are ~1,700.
THE SECOND ROUND (2026-10-05), measured on one 3-minute Dale practice script run seven times (jobs
338-344; $1.28 of Claude before): (a) THE CAREFUL PICTURE CHECK ALWAYS ANSWERS — Sonnet 5.5
thinks unless told not to and thinking counts against `maxTokens`, so 14 of 61 checks used the
whole 250 on thinking, wrote no verdict, were paid for and redone on the quick checker (the
picture that needed the careful check got the quick one). It now runs with thinking off
(`thinking: "off"` → `between_tools` on Sonnet 5.5, `thinkingOffParam`; `CAREFUL_CHECK_THINKING=1`
gives it back with room to finish): 0 empty answers in six runs. The two questions asked of every
picture (messy, staged) ride in the cached part. (b) PLANNING THINKS LESS (`planningEffort`,
`output_config.effort` low unless `SHOT_LIST_EFFORT` / `CONTEXT_EFFORT` / `PROPS_EFFORT` /
`FIT_EFFORT` / `NAMED_LOOK_EFFORT` says `medium`, `high` or `default`): the shot list $0.34 →
$0.09, same-topic groups $0.09 → $0.02. (c) PICTURE PROMPTS ARE WRITTEN EIGHT TO A CALL
(`BROLL_ENHANCE_BATCH`, 1 = one each): the rulebook and the video's own lines go once per group,
$0.12 → $0.05; a shot the answer leaves out takes the one-shot path. With all of it on: $0.71-0.72
(-44%), the audit no worse. NOT SETTLED: host seconds (50-77) and pictures drawn (61-86) swing
between runs of the SAME setup by more than any lever moved them, so one run per setup proves
nothing about either — compare averages of three. (d) WHICH PICTURES FAIL
(`server/pictureCheckLog.ts`, `scene.pictureChecks`, `scripts/stress/checks.mts --jobs N`): every
check is recorded with its kind of picture. Job 343: 25 of 37 pictures passed first time; phone
screens (2 of 5) and named kinds (1 of 4) took 23 of the 61 checks; 8 of the 12 that failed never
passed. A redraw that comes back with EXACTLY the faults of the picture before it is kept
(`REDRAW_SAME_FAULTS=1` restores the run to the last attempt) — a different fault still gets its
next try, since two screens came right on tries 3 and 4. The causes seen, not yet fixed at the
source: a screen about ONE listing held to its app's grid layout by the exact-look check, a
"personalized" board that needs carving the no-writing rule forbids, and a step picture asked for
hands that came back without them.
ONE PICTURE, ONE INSTRUCTION (2026-10-05, job 344's failed pictures): those three were one cause.
A picture is described by up to four steps — `showSubject` (what the line needs, and what the
CHECK holds the frame to), `visualPrompt` (the prompt writer's rewrite), `namedLook` (one general
look per named kind) and the memory picture — and they disagreed: three said "a plain board", one
said "engraved". Which wins, for any channel: (1) what the line needs LEADS the prompt whenever
the rewrite dropped any of it (`subjectLead`, "THE PICTURE MUST SHOW: …"); (2) specific beats
general — the named look settles pattern, colours and style, the picture's own words settle which
part, page, stage or addition is shown (`SUBJECT_OVER_LOOK`, and the same sentence in
`exactLookQuestion`, or the check fails a settings page for not being the app's front grid); (3) a
remembered thing is the same piece WITH what this picture does or adds to it (`memoryClause`); (4)
a split panel is drawn from and checked against its OWN description (`buildSplitRightScene` sets
`showSubject` to the panel's — it inherited the host beat's "hands sorting…" beside a no-people
rule); (5) an engraving is soft print — shallow carved lines too soft to read
(`BLURRED_PRINT_CLAUSE`), and the check counts that as shown (`SOFT_PRINT_QUESTION`, `blurPrint`
passed to `scanStillDefects`); (6) words on a screen are drawn as soft grey bars
(`SCREEN_TEXT_AS_BARS`, and the named-things rulebook no longer lets an app's look ask for "a
price line") — a price the line SAYS stays readable. Cases in `operatorCases.test.ts`.
"STAGED" IS THE LIGHT AND THE FINISH, NEVER THE CONTENT (`STAGED_RULE`, one wording shared by the
picture check and the audit's rule 13): after the six rules "staged" was the main cause of redraws
(27 times on Dale's job 345) and the pictures were stacks of finished pieces in plain daylight,
under lines about pieces being stacked and sorted; 7 of 9 came back "staged" again. A first fix
that said "stacks and piles are fine" was refused by the operator as a rule about one channel. The
rule now judges only light and finish (a glowing lamp, golden glow, dramatic light, an advert
finish) and never what is in the picture or how it is arranged — that comes from the script and
is held by the other questions. It names no object.
SOMEONE ELSE IS DRAWN AS SOMEONE ELSE (2026-10-05, the operator chose this over leaving people
out): the only person b-roll could show was the host, so a line about a customer — Dale's "a buyer
three states away, hunting for a board with her parents' last name on it" — came back as Dale at
his bench, run after run ("shows a man, not a woman"). Shot-list rule 6a: when a line is about
ANOTHER person doing something (never the host, never "you" — the viewer's work is the host's),
the shot names them in `other` (`otherPersonOf` → `scene.otherPerson`). `markHostBroll` gives that
picture no host look and no host photo; `personClauseFor` draws them with `otherPersonClause` —
from behind or the side, the face never shown, one body, "NOT the video's host" — under
`ONE_OTHER_PERSON_SUFFIX`. Always a photo. A line-check rewrite with no person in it clears it.

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
- `server/providers/` — one adapter per vendor; `base.ts` is the interface,
  `fallback.ts` the image chain (primary → Gemini). The host lip-sync lane has TWO adapters,
  picked in `resolveLipsyncLane` and handed to callers that know neither: `heygen-lipsync.ts`
  (Avatar IV, 1080p, pooled account keys, billed per second of output) and
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
  beat, 500 ms silent gap, beat — rendered once and cut back at offsets measured from the
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
  channel's speed dial), a pause to leave after it (0/300/600 ms of SILENCE — it was -56 dBFS room tone until
  2026-09-27, when the operator heard room tone as a buzz and had it removed everywhere; the pause
  cap now trims a 600 ms beat to 0.45 s) and a 3-5 word mood.
  When the plan changes the read, the master is voiced as RUNS of same-pace paragraphs joined
  with those beats instead of one request (`voiceMasterNarration`; a run that fails is voiced again
  on its own after 20 s / 60 s, keeping the runs that landed — `voiceRunWithRetries` — instead of
  throwing the paced read away for the flat one-shot read, which Ruth's 3-min test, job 233, hit), the scene re-voice
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
  carries a warning saying so. INTRO AND OUTRO SECTIONS come first (`shapeHostSections`,
  `hostSectionSecFor`): the film's first and last 20 s at 3 min, +15 s per extra minute (35 / 50 /
  65 / 80), capped at a fifth of the film, CUT between host and b-roll — the intro walked forward
  from the cold open, the outro backward from the closing shot, keeping the storyboard's host
  beats where the alternation allows, promoting a 4–10 s cutaway where it needs one and sending a
  host beat that would sit beside another to the still lane. CTA/QR/cover/asset beats inside a
  section are left alone. Every section host beat is an anchor (hook/outro) in both the plan and
  `capHostMinutes`, and the sections spend the SAME budget — check-ins only run between them. The
  plan, after voicing and before any clip is paid for: the hook,
  every CTA/scan-window host beat and the outro are ANCHORS (never removed), with a reserve for
  every pitch beat `hostTheCtaPitch` will flip later (`ctaPitchBeats`, minus the beats the
  operator's assets take) — so the CTA's host time comes OUT of the check-ins, not on top of the
  budget; the rest of the budget becomes check-ins at evenly
  spaced targets ~60 s apart in each stretch between anchors — nearest existing host beat in the
  window, else a ≤10 s cutaway promoted (`promoteCutawayToHost`, shared with
  `hostTheCtaPitch`) — widening the spacing until the budget covers every target and
  visiting targets middle-out so a short budget still spreads; leftover budget keeps more of the
  storyboard's own host beats; every other host beat goes to the still lane. Splits and alt
  angles are host renders and count toward it. HOST ANGLES (`assignHostShots`) rotate EVENLY
  through the video's selected photos by default: the cold open reads primary → angle 2, split
  beats stay on the primary, and every other host beat takes the next angle in turn, so no two
  consecutive host shots repeat one and each photo is seen about as often. The old
  primary-dominant share (`HOST_ALT_CAMERA_FRACTION`, ~71% on the primary) is kept ONLY for the
  RunPod lane (`HostRotation` "budget"), where same-angle neighbours batch into one GPU call —
  on a host-minutes film, whose check-ins are never adjacent by design, it showed the primary
  on 18 of 25 host beats and each other photo two or three times, which read as one photo.
  Even rotation means more angles = fewer shots each, so `shared/hostMinutes.ts` carries an
  ANGLE GUIDE per host minute (3 → 2, 4-5 → 3, 6-7 → 4, ~1.5 min of host per angle); the
  picker warns past it and the job records the same line (`hostAngleGuideWarning`), nothing is
  unticked. A selected photo that fails to rehost at generate is counted on
  `inputParams.droppedHostPhotos` and warned about at pipeline start, since a photo that
  quietly vanished there looks exactly like the planner ignoring it. The render log's
  `host cameras` line prints beats per angle. WHICH photos a channel shoots from is SAVED ON
  THE CHANNEL (`channel_host_photos.isSelected`, migration 0010): the picker on the generate
  form reads and writes it through `channelHostPhoto.setSelected`, so the ticks are one shared
  choice on every device and survive a reload (they used to be component state that reset to
  "all" on mount). The generate route defaults to those ticks when the form sends no ids
  (`server/hostPhotoSelection.ts`, pure, tested); the last ticked photo cannot be unticked. The
  picker's star calls the same `setPrimary` Admin has — it reorders the channel library, so
  both are open to every signed-in role, not managers only. Admin shows an unticked photo as
  "Not used". Harness: `client/__harness/host-photos.html` `capHostMinutes` re-checks after the CTA passes
  (which add host beats late) and demotes the most redundant check-in, never an anchor. The
  storyboard prompt is unchanged: it still writes host at the ramp's shares, which is what gives
  the planner candidates near every target. Harness: `client/__harness/host-minutes.html`
- **Host photos are used in their PHONE LOOK by default** (`server/hostPhoneLook.ts`,
  `shared/hostPhotoLook.ts`, 2026-09-28, the operator: "everything should be phone look as a default,
  same as in the test, but the user can still go back to the original"). A studio-lit host photo
  stays "AI" under any filter because HeyGen keeps the photo's look, so each library photo
  (`channel_host_photos`, migration 0014) carries a `phoneImageUrl`: the same person in the same
  room remade by gpt-image-2 (APIMART, the original as the reference) as a frame of a video they
  recorded on a propped-up phone — chest-up, plain daylight, hands down (a raised hand would freeze
  in a HeyGen take). The recipe (`phoneLookPrompt`) is word for word the one that made the four
  photos the operator chose, with the SETTING read off the photo by one Sonnet call
  (`describeHostSetting`); a version that only said "the same room" came back as the original. A
  result with no detectable face is refused (`phoneLookError`). `hostPhotoUrl` is the one rule —
  phone look unless `useOriginal` or none made yet — used by the generate route, the picker, Admin
  and the HeyGen test. Made once per photo in the background when the photo is first listed
  (`ensurePhoneLooks` in `channelHostPhoto.list`); a generate waits up to `PHONE_LOOK_WAIT_MS`
  (150 s) and otherwise renders the original. Every tile has a Phone / Original switch
  (`channelHostPhoto.setLook`, any role, like ticking — `HostPhotoLookSwitch.tsx`); Admin shows
  both versions side by side with "Make phone look again" (`remakePhoneLook`, managers). The
  HeyGen test renders the phone look too (uploads through `heygenTest.phoneLook`, cached per
  source photo in app_settings) and its clips now go through `steadyHostClip` like a film's, so the
  test shows what a video will. A photo opens BIG (`HostPhotoPreview.tsx`): the original and the
  phone look side by side, the one in use outlined, the same switch under them — click a thumbnail
  in Admin or the HeyGen test, or the magnifier on a picker tile (the tile itself ticks). The picker
  and the HeyGen test draw the SAME tile (`HostPhotoTile.tsx`: magnifier, corner badge — a tick or
  a remove button — label row, switch), so the two pages cannot drift apart. Harnesses:
  `host-photos.html`, `heygen-test.html`
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
  way ffmpeg will and re-detects to VERIFY the face sits mid-panel. The face is read off the
  STILL the scene was synced from FIRST (`scene.lipsyncImageUrl`, persisted at render; else the
  angle's photo) and the clip frames are a cross-check (`resolveFaceReadings` — a clip reading
  more than `PHOTO_CLIP_DISAGREEMENT` from the photo's is discarded, never averaged in): the
  lane animates the photo without reframing it, so the photo IS the framing, and a clean still
  is the detector's easy case where a video frame is where it used to miss and ship the face at
  the panel's edge. Nothing found anywhere ⇒ centred crop plus a JOB WARNING naming the scene
  (`scene.splitFocusSource` "centre"), never a silent centre. The result persists as
  `scene.splitAutoFocusX` and is reused by every recomposite; manual `splitLayout.hostFocusX`
  overrides it
- **CTA layout** (`markCtaQrBlock`, `hostTheCtaPitch`, `qrPlacementFor`, `ctaAssemblyScene` in
  longformVideo) — the operator's structure since 2026-09-23, and the QR moves exactly ONCE in it:
  HOST (small QR bottom-right) → BOOK COVER when the title is spoken (small QR) → HOST (small QR)
  → from the line telling the viewer to SCAN (`CTA_QR_TRIGGER`, else the first `SCAN_INTENT`
  sentence of a marked block) to ===END CTA===: the big centred QR over a person-free, on-topic
  b-roll still (a host beat in the window gives the frame up, its picture seeded from its own
  `brollVisual`; a plain dark backdrop was tried the same day and the operator preferred b-roll).
  No split screens inside a CTA, and no b-roll in the pitch before the scan line (`enforceHostSplitMix` skips and clears CTA beats,
  and sizes the split share from content host beats only). No frozen pause after it either: the
  3s silent `QR_TAIL_HOLD_SEC` tail and `extendQrHeroWindow`'s top-up read as the film "stopping"
  after every CTA and are retired — the scan window is the block's own narration, and the voicing
  stage WARNS when it is under `QR_SCAN_WINDOW_WARN_SEC` (8s) so the script gets another line.
  This replaces the 2026-09-10 rule (big card on every b-roll beat, in split panels, corner over a
  host; `shapePitchQrStretches`, `qrBigDuringHold` — both deleted), under which the card jumped
  seven times in one pitch. FILMS RENDERED BEFORE get it on Reassemble: `ctaAssemblyScene` runs the
  scan window to the block's end — a window beat that is a HOST take borrows the nearest
  person-free window beat's picture, so the card never sits on a face — and plays a split pitch beat's own full-frame
  host take (`hostClipUrls` — not a back-filled `host-…` panel crop, which would zoom the face);
  only turning the old pitch's b-roll into host needs a fresh render. Pitch hosting and the
  no-split rule apply to MARKED blocks only (`inMarkedCta`): an unmarked script's `cta` flags
  come from `markCtaScenes`, which also fires on any spoken price. `titleMatcher` counts each title word ONCE: Diane's "The French Way: … Secrets
  The French Use …" counted "french" twice, so "ordinary French habit" named the book and the
  cover went on the wrong line (job 245: book → host → QR). The scan window is ONE picture (`joinScanWindow`, 2026-09-28): it was one per line, so
  Hannah's 3-min test (job 228) changed the picture under the card three times in 10 s, the last
  for 0.8 s; consecutive card beats of one block now join into the first one's picture on the final
  lengths (qrTail carried, within the picture limit), never the cover or another block. The BOOK COVER is one shot the same way: Ruth's 3-min test (job 233)
  had the cover line split in two, both halves still the cover, so it played twice with a jump —
  consecutive cover beats of one block join too (never into the card). The scan window is not split at the quarter's limit
  (`SCAN_WINDOW_PICTURE_MAX_SEC`, 40 s — the card is the subject): Dale's job 248 showed two
  near-identical stills behind it. A list's last item also runs on into a NEARLY identical next
  picture (`nearlySameSubject`: ≥85% of the shorter description's words, or "same view"), and both
  picture writers are told to name ONE thing, never "X or Y"
- **Stress rehearsals** (`scripts/stress/`, 2026-09-24): `run.mts` renders a script N times through
  the real `generate` route as the bootstrap admin into Video tab `--slot`, then `audit.mts`
  checks the operator's rules (no CTA pause, CTA order, right place, clean pictures, no text,
  self-intro on camera, clean host switches, and since 2026-09-25 host often — ≤40 s faceless in
  the first 3 min, ≤75 s after — pictures ≤6.5 s, the picture shows what is said, ≥30% of cutaway
  time moving) from the storyboard, the film and a Sonnet judge on one frame per picture. CTA
  books come from the channel (the scripts name them in `===START CTA(title)===`). `generate`'s admin-only `rehearsal` flag
  (`LongformInputParams.rehearsal`, `rehearseSceneClips`) runs everything except the two paid
  video lanes — a host beat is a slow zoom on its photo, a moving cutaway its still — so a whole
  21-minute film costs the stills. Run them with `ASSEMBLY_CACHE=0` and at most two assembling at
  once: four parallel assemblies filled the disk. `resume.mts --job N` continues an interrupted job instead of re-rendering it (pipeline from the saved master at voicing/storyboard, else "Retry failed scenes") and audits it; `audit.mts` gives its film scan 25 min and reports SCAN FAILED rather than hanging. Three failures only a full-length film showed: WhisperX runs out of GPU memory past ~25 min of narration, so a failed transcript is retried in 8-min pieces with 30 s overlap (`transcribeInPieces`, `server/alignmentHeal.ts`); a CRLF script hid every CTA marker (`extractSpokenScript` normalises line endings); and ~470 concurrent R2 uploads timed out, so `storagePut` caps them (`R2_PUT_CONCURRENCY`, 16) and retries a transient failure. `tailor.mts` wrote the channel scripts,
  `books.mts` the two test books (per-video, never saved to the channel). Other fixes the runs
  forced: the master is voiced three delivery runs at a time with "Recording narration n/N" on
  the card (`MASTER_TTS_CONCURRENCY`); a scene attempt that failed on a network timeout is retried
  (`isTransientSceneError`) instead of dropping the scene and refusing the film; an operator
  label used as a title ("Hank Test", "720p 0.35", "#1") is not the video's subject
  (`isOperatorLabelTitle`) — it was written onto a picture; `scrubLegibleWriting` (inside
  `softenVisualPrompt`, so every lane) rewrites lettering, names burned in, initials, quoted
  text, chalkboards, tally marks, calendars and price tags before a prompt reaches the model; a
  marked CTA block without the fixed trigger gets its scan window even when another block has one
  (`markQrFromCtaTails` after the trigger loop); the self-introduction is found across the WHOLE
  running text, since the word-count chunker can cut inside the name ("…I'm Granny" | "Mae, and…")
- **Host takes speak whole sentences** (`completeHostSentences`, `endsSentence`/`startsSentence`
  in longformVideo, 2026-09-24). The script is cut into clause-sized pieces for the b-roll lane
  (≤8 s, ≤5 s in the fast open) and host beats came from those same pieces, so job 110 had 22 of
  31 host takes starting or ending mid-sentence — the cold open stopped on "…box-store lumber,",
  flashed 0.37 s of b-roll, and came back mid-thought. After voicing (the free re-slice stage, just
  before the final `assignSceneRanges`) each host beat absorbs the rest of its own sentence both
  ways, keeping the host's register (the opener's when it is one side), up to
  `HOST_SENTENCE_MAX_SEC` (15 s — a longer sentence cuts at a clause, the ordinary L-cut); never
  across a scan-window/cover/asset beat or a CTA-block edge, never folding the two cold-open
  angles. `planHostMinutes` and `shapeHostSections` only PROMOTE a cutaway that is itself whole
  sentences. And `coalesceShortScenes` folds a FLASH (`FLASH_SHOT_SEC`, 1.5 s) past the ceiling
  into a neighbour — the freeze-pad that used to hold an orphan to its floor is retired, so an
  orphan otherwise blinks past. On job 110's storyboard: mid-sentence host takes 22 → 8, flashes
  1 → 0, opener one 10.6 s take. A rendered film needs its host scenes re-rendered to pick it up.
  Since 2026-09-25 a host take may END mid-sentence on purpose — the shot list's hand-off below —
  but only where the shot list chose the break (right before a named thing, a comma, an "and");
  it still STARTS on a sentence
- **The shot list** (`server/shotList.ts`, `cutShotsOnWords` in longformVideo, 2026-09-25). The
  storyboard writes one picture per fixed word-count chunk, so a picture changed every 2–13 s
  whatever was said: Hank's "a saw, a drill, and a stack of sandpaper" played under an 11 s host
  take, "a wall full of fancy saws" sat on one still for 10 s, the film went 80 s without the host
  at 0:35, and 147 of 172 cutaways were stills. After voicing — every word's time known, before
  the final `assignSceneRanges` — one Sonnet call per 24 beats (`SHOT_LIST_MODEL`) returns, per
  beat, the words each shot STARTS on and what it must show, literally ("SAY IT, SHOW IT"); a
  spoken list gets one quick shot per item (`listCut`); a HOST beat that goes on to name things
  hands over to them at a natural break (`hostUntil`; on the self-introduction only after the
  name is said). `applyShotPlan` anchors those words in the beat's verbatim text (a `from` that
  is not there is dropped, so pieces always tile the text), `settleShots` measures against the
  word timeline and folds anything under `SHOT_MIN_SEC`/`LIST_SHOT_MIN_SEC`, gives the line back
  to the host when its part is under `HOST_HANDOFF_MIN_SEC`, splits a picture over
  `MAX_PICTURE_SEC` at a clause break, and makes a moving shot under `MOTION_MIN_SEC` a still.
  Pieces carry `wordCut` (their floor is their own, so a 0.7 s list shot is not frozen to 3 s),
  `showSubject` (the MUST SHOW line the enhancer leads with, and the still checker's fourth
  question: `scanStillDefects(buffer, expect)` → `missing`, one re-roll) and `shotGroup`. Motion is
  the shot list's call ("hands" when the words are about doing something) — the only way a
  cutaway becomes video, since `parseStoryboard` allows clips only on `humanPresent`/`objectMotion`.
  Never touches the CTA, cover, assets, splits or the cold open. Any failure keeps the storyboard's
  cuts with a job warning. The PROPS LIST (`deriveContinuitySheet` →
  `inputParams.continuitySheet`) and the three previous shots ride into every enhancer call, which
  used to rewrite each scene alone. Host check-ins: the planner walks at HALF the cadence in the
  first `HOST_EARLY_ZONE_SEC` (180 s — every ~30 s, ~60 s after), may promote a shot-list piece that
  starts a sentence (≥ `HOST_CHECKIN_MIN_SEC`, prefers ≤ 6 s), and warns when the budget widened
  the rhythm. Still-image zoom now travels at a steady rate (`kenBurnsMaxZoom`: 14% on a 5 s still,
  3% on a 1 s list shot) instead of a fixed 8%
  GUARDS the real renders forced (2026-09-26), all judged on the MEASURED cut, never the plan: a
  host part the voice timing leaves under its floor hands over ONE PICTURE LATER instead of
  keeping the whole line (`settleShots`); the host says ≥ `HOST_HANDOFF_MIN_WORDS` (5) first, and a
  hyphenated word is one token, so a cut never lands inside "nine-patch"; the introduction's host
  take starts on the sentence holding the name (`moveHostLeadIns`/`introSentenceStart`); a HOOK
  still whole and over `HOOK_MAX_WHOLE_SEC` (8 s) after cutting is re-planned with the hand-off
  required, up to twice — the old check read the PLAN, which on Mae's job 170 named a hand-off the
  cut then undid, so a 15 s hook shipped; pieces are settled with a `SNAP_MARGIN_SEC` and, after
  the final pause-snap, `foldSnappedFlashes` folds any shot under its own floor (list 0.4 s, else
  1.2 s) into a neighbour. A spoken list keeps ONE PICTURE PER ITEM at the pace it is spoken
  ("a saw," then "a drill,") — on 2026-09-27 a reading wait after short lines and a slight pause
  after each list item were built (fixed 2 / 1.5 / 1 s on-screen times, then a 0.35 s beat, drawn
  as a tail hold since the automatic freeze-pad is retired) and dropped at the operator's call;
  joining two items into one shot of both was rejected too. The HOOK (everything before
  `hostIntro`, else the first 20 s) keeps its pace but shows fewer pictures: `joinHookPictures` joins adjacent
  non-list shot-list pictures into their shorter neighbour until each runs `HOOK_PICTURE_MIN_SEC` (2.2 s),
  never across a host take and never past `MAX_PICTURE_SEC` — Mae's and Hannah's first 10 s went
  through five pictures. Host takes are never held. A host who hands over at the FIRST thing worth showing, not a later one
  (rule 7 of `SHOT_LIST_SYSTEM`): Hank's practice opening talked 6.8 s past "Japanese woodworking
  projects" and "cheap box-store lumber" to hand over before "a coffee can". The result is measured
  too: a hook or intro still whole past `HOOK_MAX_WHOLE_SEC`, or any hand-off whose host part runs
  past `HOST_PART_MAX_SEC` (5 s; the hand-off's minimum is 2 s for every host part including the
  hook — the operator's call: 2 s floor, 5 s ceiling, the script's first named thing deciding where
  in between; a 3 s hook floor against a 3.5 s ceiling left Mae's slow opening no room and it took
  a whole picture back, 5.4 s. A part under the floor now BORROWS only the words it needs from the
  next shot, which keeps its picture; the intro counts only the words after the name, `wordsAfterName`),
  is re-planned with the hand-off at the first named thing, up to twice. The host planner walks each stretch from the last host END (not the
  anchor), and a shot-list `hostCandidate` is a tie-break bonus, not a scoring tier — as a tier it
  left a 104 s faceless gap
- **Pictures follow the context; the host in b-roll; the phone look v2** (2026-09-28, the
  operator's notes on Hannah's film: too many images and clips, a new picture should come only
  when the context changes, 5-8 s is fine, lists still one picture per item, fewer videos than
  stills, static shots, b-roll of someone doing something should be OUR character, everything
  adaptable to every channel and script, and "the b-rolls still look AI"). (a) The shot list
  (`SHOT_LIST_SYSTEM`) now CHANGES THE PICTURE ONLY WHEN THE CONTEXT CHANGES — "a stack of feed
  sacks my husband set aside for the burn barrel" is one shot — and marks a beat's first shot
  `same` when it continues the picture before (`scene.sameShot`, joined across beats by
  `joinSameContext` on the final lengths). (b) The longest a picture stays grows through the film
  by quarter, `pictureMaxSecAt`: 7 / 10 / 12 / 14 s (`PICTURE_MAX_BY_QUARTER`, replacing a flat
  5.5 s split and the gate's 6.5 s); `settleShots`, `splitLingering` and plan-gate rule 9 all use
  it (`pictureLimitFor` adds up measured lengths for the start). (c) Video share 10-25% (was ≥ 30%):
  `MOTION_SHARE_MIN`/`_MAX`, target 15%; `removeMotion` turns the shortest clips back to stills
  (never below the floor, never a paid clip). A still may be `static` (`scene.staticShot` → no zoom,
  `renderKenBurnsClip({ still })`; 8 s+ always drifts). (d) THE HOST IN B-ROLL: `deriveHostLook`
  (`server/hostLook.ts`) reads one line of the host's look off their own photo once per video
  (`inputParams.hostLook`), `markHostBroll` marks every picture of someone doing the work
  (`brollHostLook`/`brollHostRef`, never a split's picture half), and `buildStillPrompt` /
  the clip prompt use `hostBrollClause` + `NO_OTHER_FIGURES_SUFFIX` with the host photo as the
  image reference — seen from behind or the side, the face NEVER shown (a drawn face would not
  match the HeyGen host; the operator chose this). ONE BODY, TWO ARMS (`ONE_BODY_CLAUSE`, in `hostBrollClause`; `NO_FIGURES_SUFFIX` for
  hands-only shots, 2026-09-29): over-the-shoulder hands shots are where the picture model adds an
  arm — Norbert's 3-min test (job 232, 2:19) had a third sleeve ending at the drill's battery, and
  neither Haiku nor Sonnet could see it at 768 px or full size, even told to trace every sleeve, so
  it is PREVENTED in the prompt, not checked after. NO MIRRORS in a host picture (2026-09-29): a mirror must show the face we never
  show, so the model fakes it — Scarlett's 3-min test (job 234) got a reflection of her BACK (0:19)
  and one sliced off at the chin (1:14). `markHostBroll` strips mirror phrases (`withoutMirrors`)
  and `NO_OTHER_FIGURES_SUFFIX` bans any mirror/glass the host could be reflected in. B-ROLL VIDEOS
  ARE STEADIED like host takes (`steadyHostClip` on every provider clip in `runChunkTasks`): the
  model ignores "locked tripod" — Scarlett's opening clip drifted 1.9% in 8 s, 0.2% after.
  A TOOL BITING INTO MATERIAL IS A PHOTO (`contactToolWork` in shotList.ts, via `safeMotion`,
  `settleMotion` and `addMotion`): drilling, sawing, driving a screw, hammering, chiselling,
  cutting, carving — the ACTION, not a tool merely held. The video model cannot fake the contact:
  Norbert's 3-min test (job 236, 2:19) drilled 10 s with the bit never going in. Gentle hand work
  (sewing, crochet, sanding, oiling) still moves. `TOOL_CONTACT_CLAUSE` (host and hands-only
  prompts) asks for the tool really in its material, and the still checker's `broken` names a
  drill bit or screw that is not in it. The SHOT LIST judges it too (rule 9b, `contact` → `scene.toolContact`), so any craft
  and any wording is caught, not just the word list: live on 2026-09-29 it marked punching leather,
  stapling, welding, boring and engraving as contact and left knitting and sanding as video. A topic
  holding a contact shot is a photo in every view (`applyContextGroups`), and the gate never makes
  one moving (`settleMotion`, `addMotion`). The word list stays as the backup. A HELD THING HAS A HOLDER: `SHOWS_PERSON` counts "held near/up/against…", so
  such a picture gets the host's hands (Norbert's job 238 asked for a drill "held near the doorframe",
  read it as person-free, and got it floating), and `NO_FIGURES_SUFFIX` says a tool with no hand on
  it rests on a surface. The still checker misses a floating tool (tested), so it is prevented.
  The SHOT LIST judges "held" too (rule 9c → `humanPresent` on the piece, still or moving), so any
  wording works: live, it marked "raise the drill to the frame", "aim the dryer at the roots",
  "hold your phone up" and "scissors right over the chalk line" as held, and a drill on its shelf
  or a dryer on its hook as not. A HANDS VIDEO SHOWS HANDS: `safeMotion` and `settleMotion` make a "hands" shot whose
  description has no hands or person a still (Ruth's job 239 had a moving coffee tin, 11.5 s). And a
  RUN LABEL is not the subject: `isOperatorLabelTitle` now catches "3min", "v3", "take 2" (job 239
  wrote "(as used for Ruth 3min v3)" into picture descriptions via the list lead-in). Host descriptions use the same look; the stock
  "a man in his early 60s" (`DEFAULT_HOST_DESCRIPTOR`, `DEFAULT_LONGFORM_INSTRUCTION`, the POV
  angle's "older man's weathered hands") is gone — it described Hannah and Mae as a man. (e) THE
  PHONE LOOK v2: `amateurSettingClause` asks for plain, slightly dull daylight, no glowing lamps /
  candles / golden glow / dark corners, nothing arranged, no decorative props unless named, shot
  from a step back; the still enhancer writes plain snapshot captions (no texture, light or mood
  words); `phoneLookFilter` is neutral-to-cool with softer detail, flatter contrast and no vignette
  (the warm tint fed the orange glow). A still checker question, `staged` (`STAGED_QUESTION`),
  re-rolls a styled/AI-looking picture once; the audit gained rule 13, "looks like a phone photo".
  Two follow-ups the same day (Hannah's 0:02-0:10 and 0:10): ONE topic may run 50% past its
  quarter's limit (`SAME_TOPIC_SLACK`, 50%: 10.5 / 15 / 18 / 21 s) before it splits — an 8.1 s
  feed-sack shot had been split into two near-identical photos — and a split's later parts are
  clearly different VIEWS (close detail / much further back / other side) named in their own
  `showSubject`; `joinSameContext` also joins two neighbours whose subject is the same
  (`sameSubject`) even when the planner did not mark `same`. And NAME IT EXACTLY (shot-list rule
  12): a specific kind — nine-patch, granny square, kumiko — keeps its name plus a plain
  description of how it looks, the enhancer keeps both word for word (and adds no lamp/lamplight
  the line does not name — the props list had put an oil lamp in most of Hannah's shots), and the
  still checker's `missing` question counts a generic version (a checkered quilt for a nine-patch)
  as missing. The audit's rule 1 counts a frozen picture only with a ≥ 1.5 s stop in the voice
  under it (`FROZEN_PAUSE_SEC`) — static stills made every one read as a pause.
  SAME TOPIC, SAME PICTURE (`markSameContext`, shotList.ts, same day, the operator: "if the context
  is still the same no need to change the shots"). The shot list plans 12 beats at a time and
  `joinSameContext` only joined a `same` mark or an IDENTICAL description, so Mae's scarf section
  (job 219, 12:00-13:40) was 12 pictures of one scarf, "scarf on a chair" twice in a row. Now, on
  the final lengths and before the join, ONE Sonnet call per film reads every picture in order
  (runs of pictures only — `contextRuns` never crosses a host take, list item, CTA, cover, asset
  or split) and groups consecutive lines about the same thing; `parseContextGroups` keeps only
  consecutive, same-run, non-overlapping groups, and `applyContextGroups` gives the group's first
  picture ONE description covering all its lines (one still moment, never "or") and marks the rest
  `sameShot`. A person in any member stays in the picture (the host from behind — the joined
  picture keeps `humanPresent`, and "the host's hands" is added if the description dropped them).
  Past the quarter's limit the topic gets a new picture that is a different VIEW (`OTHER_VIEWS`:
  close-up → further back → other side, rotating along the chain), never a near-copy. `withView` REPLACES an angle already on
  the text and the rotation reads the picture before's own angle (`viewIndexOf`) across passes —
  Scarlett's job 244 had "a close-up" twice in a row, stacked twice in one description. The
  host is recognised by "Host …", "wearing", "collarbone", "neck", "wrist" too (`SHOWS_PERSON`), so
  such a picture gets the host look, the one-body rule and loses its mirror. On job 219's
  storyboard: 160 → 133 pictures, the scarf section 12 → 7. Any failure (mock, no transcript, the
  call) changes nothing.
  ONE TOPIC, ONE SHOT — a video OR a photo, never both (the operator, same day): the whole group
  takes one kind, a VIDEO when any line in it was a moving shot (hands at work, or a thing that
  moves by itself — still through `safeMotion`), else a PHOTO; every member carries the kind and
  the topic description, so a topic past its limit continues as the same kind from another view.
  A video joins only up to `MOVING_PICTURE_MAX_SEC` (15 s, the video model's cap) — past it the
  picture would freeze. The plan gate still holds videos to 10-25% of cutaway time. The same cap holds on
  EVERY path (`capMovingLength`, the last step of `enforcePlanRules`, and `addMotion` only picks
  stills ≤ 15 s): Hank's 3-min test (job 227) shipped an 18 s "video" the motion top-up had made
  from the LONGEST still. A view is added with `withView`, which drops a trailing full stop first.
  The video-share passes (`addMotion`/`removeMotion`) turn a whole TOPIC (`topicOf`: the picture and
  the `sameShot` views it continued into) video or photo together — Dale's 3-min test (job 230) had
  "coasters at the market" as a video, then its close-up a photo. A list's last item runs on into an
  identical picture right after it (the same subject twice, 1.8 s + 3.9 s, in job 230), and a shot
  description never says "or" (the generator draws one thing).
  KEPT ON PURPOSE (the operator, 2026-09-28, after the 3-min tests showed 1-2 videos per film):
  the 10-25% video share stays, so a "hands at work" topic past it is a PHOTO of the hands. The
  alternative, a video for every topic where something is done, was ~$0.70 more per 3-min film and
  ~$7 per 20-min at the list rates, plus glitch re-renders. Do not raise the share without asking.
- **A video only of what moves by itself; every photo zooms; key things remembered** (2026-09-30,
  the operator's notes on the Frederick/Hank 3-min tests, jobs 257/258). (a) NO HANDS IN ANY VIDEO
  ("never do the videos with fingers"), and NO CAMERA MOVES ("no more b-roll zoom and zoom in" — a
  push-in/pull-back lane was built and removed the same day; the room steadier had also been
  "correcting" its move away). A video is only ever something that MOVES BY ITSELF in the moment the
  words describe (`videoKind` in shotList.ts — the ONE rule the shot list, the context groups,
  `parseStoryboard`, the plan gate's `settleMotion`/`addMotion`/rule 15 and `renderSceneClip` right
  before a clip is paid for all go through; `MOVES_ON_ITS_OWN`: a lit incense stick's smoke, fire,
  steam, water, weather, a vehicle driving, a door or gate opening). What moves is that smoke, fire or
  car; anything else in the frame, small or not, holds still — Hank's charred incense holder smoking
  beside the can of scraps is the operator's example. Hands, a person or a tool biting in is always a
  PHOTO (the hands stay in it, as the host at work). The planner is told to make the MAIN thing's
  moment the video when something with it moves, and the gate's top-up and cut-back keep the main
  thing's video first (`addMotion`/`removeMotion`, `main`). The "hands gently working with…" top-up is
  gone. The glitch check fails any clip with hands in it, and in a self-moving shot anything ELSE
  moving on its own. The 10-25% share is unchanged: a film with little that moves by itself lands
  under 10% and says so (rule 11) rather than faking a video. (b) EVERY PHOTO ZOOMS ("no static
  images"): `STILL_ZOOM_MIN_SEC` 0; the zoom's own rate keeps a 0.5 s list shot at ~1.4%. (c) KEY
  THINGS: the props list's second line is `MAIN name: look` — what the video is about — and every
  later line a key thing (`parseKeyThings` → `inputParams.keyThings`). The shot list sets `thing` on a
  shot about one (even "it keeps the whole house warm" = the stove's fire) → `scene.keyThing`; a line
  that names or explains a key thing shows it FIRST and cuts to anything new it names (rule 1c:
  "Kumiko is…" = the panel, "…Japanese sliding doors" = a sliding door). This follows the SCRIPT, not
  the film's position — a forced "opening shows the main thing" rule was built and removed the same
  day. (d) PICTURE MEMORY (`server/pictureMemory.ts`): a later picture of a key thing is drawn FROM
  its first picture and the latest one before it (`memoryRefUrls`, sent as reference images before
  the host photo), at an exact new camera position (`memoryViewFor`/`MEMORY_VIEWS`, rotating, never
  its memory's own — told only "a different spot" the picture maker copied the framing, four identical
  alarms on Frederick's job 257). Split-screen panels and the QR background are drawn from memory
  too (`tagKeyThings` finds the key thing in their own words, `withSplitMemory`) — Hank's "that's the
  whole build" split showed a square holder unlike the one built; a split is never a SOURCE, its
  panel is drawn long after the b-roll. A picture waits for a memory still being made in the same
  pass (≤8 min, earlier scenes only, so nothing waits on itself); `scanSameThing` compares the two
  side by side — a different object OR a near-copy (`copy`) is re-rolled once, then drawn from
  words. (e) APPS: a line about an app or selling online is a phone showing a plain buy-and-sell app
  (`APP_SCREEN_CLAUSE`: item photos, no logo, nothing readable); `scrubLegibleWriting` turns Facebook
  Marketplace / Etsy / eBay… into "a buy-and-sell app" everywhere, so no brand is ever drawn.
  (f) LIST ITEMS ARE NEVER JOINED: `joinPieces` keeps one picture, never "X, together with Y" (Hank's
  "a saw, a drill," at 0.9 s came back as one picture — rejected on 2026-09-27), and
  `LIST_SHOT_MIN_SEC` is 0.25 s, a blink. The list lead-in hint names the thing being made (the
  list's key thing, else the main one), never the video's title. (g) A LINE NAMING SOMETHING NEW
  KEEPS ITS OWN PICTURE: `parseContextGroups` cuts a same-topic group at a picture whose own thing
  the group's picture does not show (`namesSomethingElse`), and the group picture must fit its first
  line. (h) EVERY PICTURE IS CHECKED AGAINST ITS LINE (`fitPicturesToLines`, run on the final
  lengths right before the plan gate, one call per ~80 lines): nothing used to compare a picture
  with what is SAID under it — the still checker only asks whether the frame shows its own
  description — so Frederick's job 259 put the smoke alarm on "Fires don't all behave the same
  way". Pictures that do not show what their line is about are rewritten (`applyPictureFixes`: key
  things re-read, photo or video by what the new picture shows), including a line that only refers
  to the MAIN thing ("the one that paid me best came out of a coffee can of burnt scraps" = the
  incense holder, lit and smoking, the can beside it — the operator's example). The planner is told
  a key thing appears ONLY when the line is about it. (i) EVERY KEY THING IN A PICTURE IS
  REMEMBERED (`otherKeyThings`, `keyThingsIn`): a picture linked by the mattress drew the heater
  beside it fresh, and it changed between two shots. (j) SAMENESS BEATS THE ANGLE: a memory picture
  that differs or copies the framing is redrawn ONCE and then kept — the old fallback drew it from
  words and gave a different heater. (k) A THING THAT CAN MOVE IS NOT MOVING: a door, gate or water
  counts only when the words say it moves, and a word used as a name never does ("smoke alarm",
  "fire extinguisher", "rain boots", "water bottle") — Hank's job 260 made a video of a sliding door
  standing there. (l) HANDS STAY OUTSIDE EQUIPMENT (`HANDS_OUTSIDE_CLAUSE`, in `ONE_BODY_CLAUSE` and
  `ANON_PERSON_SUFFIX`; the still checker's `broken` names a hand inside a vise, clamp, machine or
  tool) — Hank's job 261 at 1:53 drew his hand in the bench vise's jaws. (m) WRITING ONLY WHEN THE
  SCRIPT SAYS IT, EXACTLY (2026-10-01, the operator on Frederick's made-up date labels): the shot
  list may set `text` only to words its line says; `saidText` drops it unless every word is in the
  piece's own line → `scene.pictureText`; `withAllowedText` swaps the look's `NO_READABLE_TEXT` for
  "the ONLY readable writing is exactly …"; the checker's `allowedTextQuestion` fails anything else
  readable or a misspelling (judged at 1280 px), and with no allowed text it now counts dates, model
  numbers and labels on products too. (n) THE MAIN THING IN USE: the first time it appears, a main
  thing naturally used with smoke, steam, a flame or water (an incense holder lit, a kettle, a
  stove) is shown in use — planner rule 8 and the line-fit check both say so; a thing with nothing
  moving by itself stays a photo. (o) WHAT MOVES BY ITSELF IS JUDGED, NOT LISTED (2026-10-01, the operator: "a door
  needs hand so it should not move … i much prefer not [specific]"): the `MOVES_ON_ITS_OWN` word list
  is gone — it let "a sliding door" and "a smoke alarm" through. `judgeSelfMoving` (one call per ~150
  pictures, right before the plan gate, after the splits exist) reads each picture's and split
  panel's own words and sets `selfMoving` / `splitSelfMoving`: movement a camera would catch with no
  person causing it; anything a person has to move (a door, a drawer, a tool) is NO. `videoKind`
  honours it (a planner's request stands only until judged), `addMotion` turns only JUDGED pictures
  into videos, `assignSplitMotion` (pulled out of `enforceHostSplitMix`, run again after judging)
  moves only judged panels, and an unjudged batch makes no videos. The planner and checker prompts no
  longer carry any channel's examples (incense holder, kumiko, smoke alarm, feed sacks…) — neutral
  ones where an example is needed. Picture numbers a model writes back are read by `pictureId` (12, "12" or "#12" —
  it copies the "#12:" it was shown about half the time, and every "#" id used to be dropped, so
  jobs 265/266 judged 0 pictures moving); the fit check and the same-topic groups read ids the same way. (p) A SPOKEN LIST IS RECOGNISED FROM ITS WORDS (`markListPieces`/`looksLikeListItem`,
  run at the end of `applyShotPlan`): list protection used to rest on the planner marking EVERY item
  `list`, and Hank's job 268 had "and a stack of sandpaper," marked and "a saw," not — the unmarked
  half-second item folded into "a drill,". Two or more consecutive pictures of one beat that each only
  NAME a thing (a few words, article-led, no subject or verb — `LIST_ITEM_CLAUSE` keeps "the cheapest
  fabric won," out) are all `listCut`, and a picture the planner gave several items ("a saw, a
  drill,") becomes one picture per item (`splitListPieces`). A list with no articles counts too (`looksLikeBareListItem`: "flour, sugar, and
  butter", "hammers, saws, and chisels" — one to four words, no subject or verb, no "-ly" word, never
  opening on an aside or a where/how-much word from `NOT_A_LIST_ITEM`: "Honestly,", "all on one wall"),
  and only inside a run of two or more. (q) THE SUBJECT, NOT THE PLACE (shot-list rule 1 and `FIT_SYSTEM`): a place or
  surface a line names is where its subject is shown, never the picture alone — Hank's job 269 showed
  an empty market table under "is that clean Japanese look really worth anything on a market table".
  A line naming the work by a quality ("that clean look") shows the work; a picture of something NEW
  the line names (a comparison to something you can see) is right and is never changed back. (r) THE LINE CHECK GOES PICTURE BY PICTURE, AND CAN SPLIT (2026-10-01, Hank's job
  271: the planner follows the rules one run and not the next, and the check passed both misses). It
  now answers for EVERY picture — what the line is about, then whether the picture shows it
  (`pictures[]`, `about`, `shows_it`) — which caught what a list of only the wrong ones skipped: "the
  one that paid me best came out of a coffee can" read as about the can (it names what the thing was
  made FROM; "the one that…" is one of the things the video counts). A line comparing to something
  else you can see ("the kind you see in …") is SPLIT at those words (`applyPictureSplits`, both parts
  ≥ 4 words), and the film's ranges are re-cut on the same words. 3 of 3 runs on job 271 fixed both. The check runs on OPUS (`FIT_MODEL`): on Frederick's practice storyboard (job 274)
  Sonnet showed "the one kind of fire that likes to start while the house is asleep" as the alarm
  again 2 times in 3, Opus showed the night fire 3 in 3. (s) DON'T REPEAT (shot-list rule 1d,
  `FIT_SYSTEM`): a line whose subject is already on screen ("It just happens to be slow at …") and
  that names something NEW you can see — a thing, or a kind of event or situation — shows the new
  thing. (t) BLURRED PRINT (`blurPrint`, `blurredPrint`, `BLURRED_PRINT_CLAUSE`; the operator: "show the
  3 things, the date, but make it blurry"): printing a line talks about without saying the words is
  SHOWN, soft and unreadable, instead of hidden; exact words the line says are still printed exactly.
  (u) THE MAIN THING'S FIRST PICTURE IN USE: the line check is told which picture is the "FIRST of
  the MAIN thing" and makes it in use when it naturally is; `removeMotion` gives that video up last. (v) A HOST LINE THAT ENDS IN A LIST HANDS OVER TO IT (now part of `applySpokenLists`, below;
  it was `handOffHostLists`): Hank's job 275 stretched the introduction to finish its sentence ("…standing in a
  garage with a saw, a drill, and a stack of sandpaper,") and the planner, asked twice, kept the list
  on camera. The host keeps the words before the first item (≥ 5, the name kept on an introduction)
  and each item becomes a `listCut` picture. (The plan gate's picture-blink rule is unchanged: a run
  under 2 s BETWEEN two host takes still goes back to the host, as agreed for Norbert's job 232.)
- **Spoken lists are found in the whole script; named things are drawn exactly** (2026-10-01, the
  operator on Granny Ruth's practice film, job 281). (a) LISTS (`server/spokenLists.ts`): whether a
  piece was a list item used to be judged one storyboard piece at a time, and where a piece starts is
  wherever the storyboard cut — so "the one | that paid me best" read as two items (one bowl, two
  pictures) and "…a kitchen table with a straight-stitch machine, | a rotary cutter, and | a mountain
  of scraps" crossed a beat cut and kept the machine on the host. Now one Opus call (`LIST_MODEL`)
  reads the numbered SENTENCES while the shot list is planned and writes every list's items word for
  word; `validateSpokenList` keeps a list only when every item is there, in order, ≤12 words, ≤3
  words apart, joined like a list (two items need a comma; "the potholders and the coasters were
  done" is not one); a failed call falls back to the same rules by sentence shape (`listsByShape`:
  "X, Y, and Z", a first item at the end of a clause, bare names like "flour, sugar, and butter").
  `applySpokenLists` (after the shot list's cut, in place of `handOffHostLists`/`pullListLeadIns`,
  which are gone) re-cuts the film so every item is exactly one picture wherever the storyboard cut,
  keeps a planner picture that already showed the item, hands a host line over at the first item (≥5
  words kept, the name on the introduction, never when the host speaks on in a new sentence), sends
  the words after the last item to the next picture, and unmarks every non-host piece that is not an
  item of any list, so the folds join it. Never a CTA, cover, asset, QR or split beat.
  (b) NAMED THINGS (`server/namedLooks.ts`): the shot list described "a churn dash" as a pinwheel,
  picture memory drew "a churn dash here, a bear paw there" as two more copies of the whole folded
  sampler quilt, and the quick checker could not tell a block from a block. `describeNamedLooks`
  (one Opus call per ≤150 pictures, `NAMED_LOOK_MODEL`, right after the line check) writes every
  specific named kind's exact look — shapes, counts, arrangement, light and dark — onto the pictures
  showing it (`scene.namedLook`, `namedLookClause` in `buildStillPrompt`), and marks a picture about
  ONE PART of a key thing (`scene.partOf`): it is drawn from the thing's memory as a close-up of that
  part (`PART_VIEW`, `memoryClause`), never compared with the whole by `scanSameThing`. A picture of
  someone at work keeps the person and is never made a part close-up. The still checker holds a
  named-kind picture to its exact look (`exactLookQuestion`) on Sonnet at 1280 px
  (`EXACT_LOOK_MODEL`), one redraw like any `missing`. Any failure changes nothing.
  Follow-ups the same day (Dale's practice films, jobs 288-293): (c) ONE IDEA, ONE PICTURE: two
  pictures splitting one sentence become one (`joinedLine`) when the line check (Opus) marks them
  one idea (`join` → `applyPictureJoins`: "Sell your furniture | on Facebook Marketplace") or either
  part runs under `SPLIT_PART_MIN_SEC` (3 s, `joinShortSplits` in the fold loop); the check then
  writes ONE picture for the whole line — what it really points at (a comparison's new thing, the
  main thing, or both together). Its own splits never leave a part under 3 s. Lists are exempt.
  (d) REAL THINGS LOOK REAL: a real app, website, store or market the LINE names is a named kind —
  its real colours and layout (`REAL_APP_SCREEN_CLAUSE`), logo and words soft and unreadable (the
  operator's option A). (e) A list item is its own thing: never `partOf` a group, never drawn from
  the item before it (`memorySourcesFor`), a part close-up is still held to not COPYING its memory,
  and writing a rewrite names but the line does not say is blurred (`blurredPrint` now covers
  engraved/monogram/initials). (f) LISTS STAY CUT: the pause-snap may no longer take a piece's own
  words away (`keepOwnWords` — "…ranking | Etsy, |" snapped over the word), the opening line hands
  its list over too (only the goodbye keeps it), and the found lists (`inputParams.spokenLists`) are
  applied once more on the final lengths right before the line check, so any later step that undid
  an item is put right. The shape rules also take a last item that runs into a clause ("…and
  Facebook Marketplace by what each one does well").
  (g) STEPS ARE A LIST TOO (2026-10-02, Hank's job 326: "Square up the scrap with a couple of saw
  cuts, give it a quick brush, drill the hole…, oil it, and put a felt dot on the bottom" played as
  one split and one photo, because the list finder was told "actions one after another" are not a
  list and the shape rules only knew things). The finder now returns `kind: "steps"` for a sequence
  someone DOES (never a story of what happened); `stepsByShape` is its backup (3+ comma pieces, the
  last after "and"/"then", each a short instruction on its plain verb — no subject, determiner,
  aside, -ed/-ing form, number, or "money WAS tight"). Each step is its own picture of the host's
  hands doing it, while making the main thing (`humanPresent`, a photo — hands never move). The
  CTA's "point your phone…, tap the link" steps are left alone like every CTA beat.
  (h) A STORY IS DIFFERENT MOMENTS; A TOOL IN ITS REAL POSITION (2026-10-02, Hank's job 332 at
  1:34: "Now the winner. Charred cedar incense holders… the can by the trash bin… why not drill a
  hole in one" was ONE 17 s picture of the drilling — the same-topic step's rule "if any picture
  shows hands, the group picture MUST" carried the last line's hands onto the first). `CONTEXT_SYSTEM`
  now joins lines only when one still photo shows every line at the same moment, keeps each moment
  of a story apart, and gives a picture of someone doing something only to the lines that say it;
  `parseContextGroups` cuts a group where pictures turn between someone at work and a thing on its
  own (`atWork`), and a things-only part never takes an at-work group picture. Same film, the saw
  step: a small block flat on the bench, the other hand beside the blade. `TOOL_POSITION_CLAUSE`
  (inside `TOOL_CONTACT_CLAUSE`, so every hands/host-at-work prompt) asks for the real grip, angle
  and set-up (overhanging the bench, a vise or bench hook, clamped with a scrap block under, a mat,
  a board) and hands well back from the blade, bit or edge; the still checker's `broken` names a
  tool held or angled wrongly, a path into the table or a hand, and fingers by a blade.
  (i) WHAT THE LINE IS ABOUT STAYS THE SUBJECT; UNREAD PRINT FROM ARM'S LENGTH; A FAILED CHECK IS
  NOT A PASS (2026-10-02, Frederick's job 335). The night-fire picture at 0:07 drew the alarm filling
  the frame: it was the picture's key thing only because the description named it last ("…, a smoke
  alarm on the ceiling above"), and memory's camera rotation gave it "a close view". `isSubject`
  (pictureMemory.ts) compares how fully the description's LEAD (up to the first comma / with / beside
  / above …) and its rest name the key thing; named more fully in the rest ⇒ `BACKGROUND_VIEW`: drawn
  from memory (same thing), small, in place, never close up, and not compared side by side. A `partOf`
  picture is always about its part. The label at 1:05 asked for a close-up with blurred print and was
  refused for readable writing four times, then shipped: a close-up of print is drawn sharp, so a
  `blurPrint` picture is framed from arm's length (`BLUR_PRINT_VIEW`, close-up words swapped in
  `withAllowedText`) and, if writing is still readable, once more further back (`STEP_BACK_CLAUSE`).
  Print the script SAYS keeps its close-up. And the checker that refused the night fire failed on the
  redraw ("Claude returned no text"), and a failed check passed: `scanStillDefects` now asks the other
  model, then returns `unchecked`, and the still loop draws once more before shipping. And NOTHING IS MERGED INTO A LIST ITEM
  (`mergeable`, asked by `settleShots`, `foldSnappedFlashes` and the plan gate's flash join): the
  list cut leaves a short lead-in ("Today I'm ranking", ~1 s) and every one of those folds used to
  pick the item beside it, so the joined piece lost the item's picture (Dale's job 293) — a short
  piece now goes to the neighbour that is not a list item; only a list item squeezed to a blink
  may still join the item next to it. (g) PARTS VS SEPARATE THINGS, ONE PLACE: a list item MAY be a
  `partOf` its key thing again ("a churn dash here" on the quilt) — refusing that for Dale's board/
  sign drew Ruth's "a bear paw there" as the whole quilt (job 298); separate list items are kept
  apart by memory instead (never drawn from another item). A memory picture's framing is decided in
  ONE place from the picture itself (`shotFraming`: a part, or words asking for a close view ⇒
  `PART_VIEW`), so the rotating camera can never say "further back" to a close-up. A SCREEN picture
  (`SHOWS_SCREEN`) never gets, and never is, an object memory — Dale's job 295 built the tablet out
  of the cutting board; the device is a plain real one, the checker's `broken` question names a
  device built into another object, and quoted/brand words are scrubbed out of a real look before
  the prompt. `server/operatorCases.test.ts` holds every case the operator found, side by side, so
  a fix for one cannot quietly undo another. (h) THE BRIDGE INTO A LIST IS A GROUP PICTURE: the
  words leading from a host take into a list ("…I'm Granny Ruth, | and this one's for anybody
  sitting at a kitchen table with | a straight-stitch machine, …") drew an empty kitchen table (job
  302). `applySpokenLists` now makes that bridge (a short clause right after a host take, and/or
  the list head's own lead-in, ≥3 words) ONE `listSet` picture: the place the bridge names with
  every item of the list in it together (`setPicture`/`placeOf`), never rewritten by the line
  check; each item after it is drawn FROM that picture (`listSetFor`, `SET_ITEM_VIEW`) so the
  close-up is the same machine. The host never says the bridge: that was tried (job 304) and its
  ~3 s took the time of a later check-in, leaving 48 s without the host — host minutes are planned
  after this step, so a bridge cannot know whether the host has any to spare. (i) Dale's job 306:
  a SCREEN gets its key thing's memory again, used ONLY as the photo inside the listing
  (`SCREEN_ITEM_VIEW`, its own `memoryClause`; never compared with `scanSameThing`; a screen is still
  never a memory source) — with none, "the bookcase listing" showed four random items; a picture
  about ONE listing shows that item's own page (`appScreenClause`/`ONE_LISTING`); a price or name
  the line SAYS (`pictureText`) is readable and exact on a screen too, where the screen clauses used
  to blur it into a grey bar; and every key thing a picture is about is checked by the stronger
  checker (`requiredThingsQuestion` in `scanStillDefects`, Sonnet) — a box drawn where the bookcase
  was asked for counts as missing and is redrawn. (j) Diane's job 309 / Lance's job 311 / Pearl's
  job 310: a BODY PART is always on a person — hair, scalp, skin, nails or a face make a picture
  the host's (`SHOWS_PERSON`; a hair dryer/brush/clip stays a thing), every person picture carries
  `BODY_ON_PERSON_CLAUSE`, and a thing worn on the FRONT (headlamp, glasses, apron…) is seen from the
  side where it really sits (`personClauseFor`) — the host-from-behind rule had put Lance's headlamp
  on the back of his head; the checker's `broken` question names both. A host line that is ONLY a
  list (after a host line, never the first line or the introduction) goes to one picture per item
  inside `applySpokenLists`. The CTA keeps host → book → host → QR in ANY wording: `SCAN_INTENT` also
  reads "use the link in the description", "link below", "pinned comment", "to get it…"; with no such
  line the card takes only the block's last ~30 words (`QR_FALLBACK_WORDS`, never a line naming the
  book — it used to take ~90 and swallowed Pearl's whole pitch), and a beat holding the title and
  more pitch is split right after the title's sentence so the host comes back before the card.
  (k) SHOW EXACTLY WHAT THE LINE POINTS AT (Frederick's job 329: "three things printed on the box"
  drew the alarm on the ceiling, "First thing on the label" a stack of PLAIN boxes): the planner,
  the line check and the named-things step all carry the rule — a line pointing at a specific thing
  or part (the box, its label, a dial, the back, the date) gets a close-up of exactly that. One Opus
  call reads what the SCRIPT says is on things (`collectShownFacts`: what a label/box/dial covers,
  written the way a label prints it, only the script's own words — `scriptWords` checks every word
  by stem); the named-things step gives a picture of that part those words as `pictureText`
  (readable and exact, everything else blurred). So a label shows "Photoelectric, Sealed 10-Year
  Battery, Interconnected" at the line that promises the three things, before each is explained.
- **A sentence finishes, a word is never cut** (2026-09-28, the operator: "it should adapt to
  everything and not only these videos"). Three rules, none per-channel. (a) Nothing folds across a
  MARKED CTA edge: `coalesceShortScenes` used to fold a sub-floor scene into either neighbour, and
  the marker had split "…a dollar | and thirty cents an hour. | Let me stop here…" — the 5-word tail
  went into the CTA's host take (Hannah 0:59). Unmarked scripts fold as before. (b) A host take
  starts only where a sentence starts: coming in after a comma was allowed in `checkInShaped`,
  plan-gate rule 7 and `cleanHostCandidate`, and read as the host cutting in (Mae 2:12 "…well now,
  | why not…"); rule 7's excuse is now the length of the sentence's OWN lead (`sentenceLeadSec`), not
  the whole picture before. A take that still starts mid-sentence takes its sentence back off the
  pictures before it, or starts at its next sentence (`finishSentenceBeforeHost`, cut on the
  LONGEST nearby pause — the sentence break). The book cover starting on the title and the host
  handing over to a picture mid-sentence are the operator's own design and stay. (c) No cut inside
  a word: a SHORT gap (40-120 ms, the second snap tier) is also what a "k"/"t"/"p" closure inside a
  word looks like — Ruth's "blocks," was cut before its "s" — so it may take a cut only within
  `SHORT_GAP_SLACK_SEC` (30 ms) of where the transcript says the words meet (`meets`); a real pause keeps
  the wide window. Audit rule 14 (`cutsInsideWords`) flags a cut well inside a transcribed word
  and not in a real pause — on the four 2026-09-28 films it found exactly that one.
  The plan gate's own cuts (a glimpse, a sentence given back, a lingering picture split) had no
  word timings — only pauses and a word-share guess — so on a voice with breath noise between
  words one landed inside "apiece" (Mae, job 209). The gate now gets the voicing transcript
  (`PlanGateOptions.words`) and `gapBeforeWord` puts each cut in the real gap between two words,
  on a pause inside that gap when there is one; without a transcript it falls back to the guess.
  With the comma entry gone, a stretch without the host could no longer be filled when the host
  minutes were nearly spent (real HeyGen jobs 205/206: 43 s and 42 s, the one whole-sentence spot
  longer than the budget left), so the gate's last resort is a GLIMPSE (`hostGlimpse`): the host
  says the opening clause of a sentence — which may start inside a picture — and hands over to the
  picture at its comma, within the budget and `HOST_PART_MAX_SEC`.
- **The host's name always exists; a spoken list is always shown** (2026-09-28). Every rule keyed to
  the host's name (the self-introduction on camera, the intro hand-off, the lower third) read
  `channel_configs.hostName` only, and Diane De Chambray's channel had none, so "I'm Diane" played
  over a picture (job 217). `resolveHostName` (server/db.ts) is the one source — `hostName`, else the
  display name — used by the generate route, the delivery planner and a resume; with no name at all,
  `introSpans` treats the first "I'm <Name>" in the script's opening as the introduction (`NOT_A_NAME`
  keeps "I'm Not sure" out). And a host line that is JUST a spoken list (`spokenListItems`: one
  sentence, 3+ short pieces each naming a thing) goes to the pictures (`handListsToPictures`, before
  the shot list), so it gets one picture per item — even on the second cold-open angle, which the
  shot list otherwise left on the host (Lance's "a bin…, a bag…, maybe a box…", job 218). The first
  line, the intro, the CTAs and the goodbye never move, and a list only moves right after a host line.
  And a list whose FIRST item fell at the end of the line before (a beat boundary inside the list)
  gets it back — Granny Mae's "…at a kitchen table with a hook, | a skein of yarn, and a stack of
  stitch books" (job 231) kept "a hook" on the host; since 2026-10-01 this is `applySpokenLists`,
  which finds lists in whole sentences (see the spoken-lists entry).
- **Every film passes the checks BEFORE it is paid for** (2026-09-26). The rehearsal audit's rules
  used to be checked only after a film was finished, so a live render shipped whatever they would
  have found. Now: (a) THE VOICE SAYS EVERY WORD (`server/narrationSkips.ts`, voicing stage, right
  after the master is transcribed): 69Labs sometimes DROPS text from a generation — Hank's job 162
  read "…and a stack." and went on to the next sentence, twice in one film, and the plausibility
  gate mistook it for a transcript hole. `findSkippedWords` tells them apart by the clock (a skip is
  script words with no TIME for them; a hole is time with no words; a price whisper writes as
  "$1.30" leaves a token or two and is neither), `repairSkippedNarration` re-voices just that
  paragraph at its delivery pace, checks the new take, and splices it over the old read with every
  pause kept; a paragraph that skips twice FAILS the job at voicing (`SkippedNarrationError`) before
  anything else is paid for. Manual narration and mock mode are exempt. (b) THE PLAN
  (`server/planGate.ts`, clip stage, after `joinBackToBackHostTakes`, before `assignHostShots`):
  `checkPlan` is the audit's rules 1/2/6/7/8/9/11 — the audit imports it, so the two cannot
  disagree — and `enforcePlanRules` fixes what fails one change at a time, re-checking after each:
  a flash shot joins its neighbour, a picture over 6.5 s splits on a pause (`job.masterSilences`),
  a stretch without the host gets the clean candidate that best halves it (whole sentences, or in
  at a comma / out at a shot-list hand-off, never beside another host take), and past the host
  minutes a spare check-in whose removal leaves its own stretch under 92% of the limit goes back to
  a picture — works for any pick, 3-7 min; too little real video turns the longest stills into
  moving shots — and when no still shows hands (Ruth's job 178 had none), a still of a THING
  becomes "hands gently working with" it (`NOT_A_THING` keeps places and wide scenes still); the
  host minutes are enforced at the end too (joins and CTA passes can add seconds), and a spare may
  also be a crowded intro/outro SECTION beat (`SECTION_SPARE_GAP`, Ruth's host at 0, 5 and 13 s
  while 2:19 went 49 s without her) but never the start, intro, a CTA, the end or a beat with
  `submits` (its render is paid for); a picture merged into a host keeps its `wordCut`, so a
  joined intro still reads as a hand-off. A BLINK — a run of pictures between two host takes shorter than
  `PICTURE_RUN_MIN_SEC` (2 s, the host part's own floor) — is rule 7 too: the host before keeps
  those words, and the two takes become one when they fit `HOST_JOIN_MAX_SEC` (Norbert's 3-min
  test, job 232: host → 0.6 s "the drill" → 1.3 s "or the handyman" → host, in the goodbye). A CTA split screen or pitch picture is fixed. What cannot be fixed is a job warning,
  never a stopped film; beats the gate moved are re-sliced from the master and demoted hosts
  re-enhanced. (c) THE PICTURES (`scanStillDefects(buffer, expect, line)`): the one vision call now
  also asks `messy` (a legible brand or logo, or the subject lost in clutter — rule 4) and, given the
  line, `wrong_place` (rule 3); each gets one re-roll, like `missing`. The audit adds rule 12 (voice
  says every word) and never overwrites a full report with a partial (`--no-*`) run. (d) NOTHING
  MOVES ON ITS OWN: the video model animates whatever it is handed, and an ordinary object set
  moving slides around by itself (Hank's kumiko strips crept across a split panel). Only hands at
  work (`SHOWS_HANDS`) or a thing that moves by itself in real life (`MOVES_ON_ITS_OWN`: fire,
  water, smoke, steam, a running machine…) may move — enforced by `safeMotion` on every shot-list
  piece, by `settleMotion` in the gate, by the real-video top-up, and by `enforceHostSplitMix`
  (a split's right half is person-free, so it moves only for a self-moving thing). The still
  checker's `broken` question names impossible tools (a blade through a clamp, a saw that is not
  touching what it cuts, a needle through a finger). (e) THE CLIPS (`server/clipGlitchScan.ts`):
  every moving cutaway is judged as SPOT THE DIFFERENCE on its first and last frame, 640 wide and
  stacked (Sonnet, `CLIP_GLITCH_MODEL`): the model lists what changed and whether hands are in it,
  and the verdict is decided in code (`parseClipGlitchVerdict`) — any change in a shot with no hands
  that is not a self-moving thing, a morph, or something moving untouched. "Does anything move
  wrong?" on a 2x2 sheet passed the kumiko clip with Haiku AND Sonnet; the list named the strips at
  once. On 15 of Hank's clips it flagged the kumiko panel and one chisel shaving. With hands in the
  shot only a MORPH counts: the first real render (job 175) flagged "hands repositioned lower on the
  paper" and "chisel angle shifted" as untouched motion and swapped good hands clips for stills. But a thing that DISAPPEARS, appears or clearly changes size with no hand doing
  it (`vanished`) fails even with hands in the shot, and the pair is laid SIDE BY SIDE (768 each):
  Granny Ruth's 3-min test (job 233, 1:00) had the quilt over the table front shrink away to bare
  table while she sewed; stacked, Sonnet called that pair "slight shifts" at 640 and 1024 px, side
  by side it named it and still passed five good hands clips (2026-09-29). A glitch renders
  the beat again once; a second makes it the still (`scene.motionGlitches`); a moving split panel
  that glitches falls back to its still panel. Skipped in rehearsals
- **B-roll prompts** — the style bible is a HOME BASE plus the places the script travels to, not
  "the ONE physical world" (that put a whole Japanese-woodworking film in one garage, a Japanese
  home drawn as a poster on its wall); the storyboard's WORLD block, the enhancer's direction
  line and `amateurSettingClause` all send a line about where a thing is used/sold/comes from
  THERE. `CLEAN_FRAME_RULE` (subject fills the frame, tidy background, no brands; openwork shown
  backed or on a calm backdrop) replaced "natural everyday clutter". `NO_READABLE_TEXT` /
  `NO_NARRATION_TEXT_RULE` replaced `ENGLISH_TEXT_ONLY`, which ALLOWED in-scene text and got the
  narration written onto chalkboards ("$93/hour"); `scanStillDefects` has a third verdict,
  `writing`, that re-rolls a still with readable text in it
- **The iPhone look** (2026-09-27, the operator's call: "realistic like a person took it, not AI").
  Two halves, because a filter alone did not fix it — measured on job 175's stills, the AI tell was
  the COMPOSITION (dead centre, level, flattering light, a styled bench), not the texture.
  (a) PROMPT: `amateurSettingClause` asks for "a quick, ordinary photo someone took themselves on an
  old iPhone" — framed from where a person stands, a little off-centre and tilted, the room's own
  uneven light, a real used place whose edge props CHANGE shot to shot (the first test put the same
  mug and tape measure in every frame), deep focus. `heroFramingClause` and the enhancer's MUST SHOW
  rule dropped "centred"; `CLEAN_FRAME_RULE` and the `messy` questions (still checker + audit) now
  allow a lived-in room and still catch brands and a lost subject. (b) FINISH: `phoneLookFilter` in
  videoAssembly — small-lens softness, phone oversharpening, milky shadows, early-clipping
  highlights, a slightly warm white balance, lens shading, sensor noise — drawn in
  `buildSceneMuxArgs` UNDER the QR/name card/caption so they stay crisp. `phoneLookFor` picks it:
  `broll` on cutaways, the lighter `host` on host takes and splits (heavy softening makes a
  lip-synced mouth hard to read), none on a book cover or an operator's asset. NO MOTION is added —
  a handheld wobble was tried and rejected. It is in the `mux` cache key (as the filter string), so
  finished films get it on Reassemble; `PHONE_LOOK=0` turns it off. The HOST needs the same fix at
  the source: HeyGen keeps the photo's look, and a portrait-lit, blurred-background photo stays
  "AI" under any filter — a host photo should read as a frame of a phone propped on the bench.
  HeyGen then added a slow "breathing" camera on some of those photos (Ruth's job 182: the room
  zoomed in and out 0.6-1.2% on all 12 host clips; her old photo 0.3%, Hank's and Mae's 0), which
  nothing in the request switches off and vid.stab's tripod mode does not correct (slide and
  rotation only). `server/hostSteady.ts` tracks the room on the frame's outer band against frame 0
  (zoom about the centre + slide) and resamples each frame back with `perspective`, zoomed in just
  enough to hide edges; it runs in `runChunkTasks` right after the black-clip check, before the
  clip is stored, so full-frame takes and splits built from them are both steady. A still camera is
  left byte-identical (one decode, ~1 s); `HOST_STEADY=0` turns it off. Films rendered before get
  it through `steadyJobHostClips(jobId)` + Reassemble (recomposites splits from `hostClipUrls`). v2 (2026-09-28, Ruth's job 206 "the room moves when she moves"): the
  fixed outer band tracked HER as well as the room — her phone photo is framed wide, the shawl
  reaches 79% across — so the room is now found from the clip (`roomMask`: what still differs from
  frame 0 after a first correction is the host), corrected every 2 frames and re-measured for a
  second pass (threshold 0.12%, a photo HeyGen leaves alone measures 0.03%). What that leaves is
  JITTER — HeyGen redraws the room slightly differently every frame, ±0.1% — so a clip that needed
  steadying also has its ROOM FROZEN (`freezeRoom`/`hostArea`): outside where the host moves
  (thin flickering edges shaved off first, then a 12 px margin, a 10 px feather) every pixel is the
  clip's first frame. Ruth's takes: 0.2-0.4% → 0.00%. `HOST_FREEZE_ROOM=0` keeps the camera fix
  only. THE HOST IS A SOLID SHAPE (`solidHost`, 2026-09-30): motion only shows at the EDGES of a
  plain surface, so a navy tee's chest read as "room" and was frozen while the collar, shoulders
  and arms moved around it — on the operator's clip 88% of the shirt froze. Each row is now host
  between its leftmost and rightmost moving pixel, and any still pocket the room cannot reach from
  the top/left/right edge (a seated host runs off the bottom) is host too: the same clip went 12% →
  100% of the shirt covered, room corners still 100% frozen. Only what moves WITHIN THE BODY'S WIDTH is filled
  (`bodyPieces`: a piece holding ≥5% of the movement is body; flicker specks past its edges are
  room), and a fill that still swallows the frame falls back to the outline instead of skipping the
  freeze. THE ROOM IS STILL UP TO THE HOST'S EDGE IN EVERY FRAME (`personMatte`/`server/personMask.ts`,
  2026-09-30): the band had to hold everywhere the host ever goes, so whatever she was NOT covering
  inside it showed as rendered — HeyGen drags a patterned thing beside a host along as she sways
  (Ruth's quilt at her shoulder, job 255, read as the cloth sliding against the still room). Google's
  MediaPipe selfie segmenter (landscape 256×144, Apache-2.0, `server/assets/selfie-landscape.onnx`,
  run offline by `onnxruntime-web`'s WASM backend — `onnxruntime-node` crashes pnpm at 300 MB) cuts
  the person out of every frame (~8 ms a frame with decode); a pixel is live where she is (+6 px,
  ±1 frame) — band or not, which also un-froze a plain apron hem and a far shoulder that barely
  move — or where, inside the band, it clearly moves now (`MOVE_LEVEL`, a hand the model missed).
  Her frame-0 spot is filled from the frame she overlaps it least, never painted with her. Uncovered
  quilt on job 255: frame-to-frame change 0.51 → 0.02. A cut-out that disagrees with the band
  (`PERSON_IN_BAND`) or any failure falls back to the band freeze; the log says which ran ("room
  frozen up to the host's edge"). Only HOST takes freeze
  (`steadyHostClip(…, { freezeRoom })`); b-roll gets the camera fix only. The provider's untouched
  host clip is kept (`scene.rawClipUrls`) and `steadyJobHostClips` starts from it, so a steadier fix
  re-applies to a finished film for free. Practice runs show the host as a still photo (no slow zoom) so they look like the real take
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
  so they cannot disagree. The CTA release beat's automatic 3s QR linger is RETIRED (see the CTA
  entry) — only an explicit "Hold after line" freezes a scene. RIPPLE TRIM (`planRippleTrim`/`applyRippleTrim`) is the one edit that changes the
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
  footage continues; renumbers), hold the last frame (`scene.tailHoldSec` — no default any more;
  `QR_TAIL_HOLD_SEC` is 0) or hold the FIRST frame
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
- `server/alignmentHeal.ts` + the PLAUSIBILITY GATE in `narrationAlignment.ts`
  (`implausibleScenes` / `repairImplausibleRuns`) — production job 94 shipped a film that
  "freezes" at 9:20 while the narrator carries on for five minutes: seven scenes a fraction of a
  second long, then ONE still held for 319 s. ROOT CAUSE, and the fix that matters: a CTA ANCHOR
  BOUND TO THE WRONG OCCURRENCE OF ITS PHRASE. The QR block's release is pinned by finding the
  qrTail scene's last five words in the transcript; the closing pitch ended "…come back with
  three quarters of an inch", the host had ALSO said those five words at 9:15, and — the block's
  START anchor having gone unfound (one misheard word is tolerated, two are not), which left the
  search starting back at the mid-roll CTA — the release bound there, five minutes early. A pin
  is AUTHORITATIVE ("predecessors that overshot are pulled back"), so everything belonging to
  9:17–14:34 was crushed in front of it and the scene after it ran to the outro. Deterministic:
  a fresh transcript reproduces it exactly, which is why the first diagnosis (a HOLE in the
  transcript — same picture, and reproducible by deleting words) was wrong, and why the repair
  built on that diagnosis refused job 94 with "does not match the script at 8:44–9:17,
  9:17–14:45" — two runs split at the bad pin. `alignBoundaries` now resolves anchors AFTER the
  global alignment, to the occurrence NEAREST where that alignment put the scene, and drops one
  further than `ANCHOR_MAX_DRIFT_TOKENS` (30 ≈ 10 s) away: the alignment is global, so a repeat
  elsewhere costs it nothing, and the anchor keeps the one job it is good at — placing the cut
  exactly on the phrase. On job 94's real narration: old aligner, 170 scenes under 1 s and one of
  800 s; new, the block at 14:17–14:36, none under 1 s, longest 10.7 s. The rest of this entry
  is DEFENCE IN DEPTH against anything that produces the same picture (a genuine transcript hole
  does): the only check used to be a GLOBAL match ratio (`MIN_MATCH_RATIO` 0.5), which a
  five-minute fault in a fifteen-minute film passes at ~66%, and the merge passes then ran on the
  zero-length scenes and folded dozens together. Regenerate cannot help such a film — it
  re-renders the same broken slice. The gate judges each scene's
  slice against its word count at the film's own MEDIAN pace (median, not mean: one scene holding
  five stray minutes drags the mean until every healthy scene reads as starved) and re-splits a
  bad stretch by word count — but only when the stretch's audio FITS its words (0.6–1.6×), never
  across a CTA-pinned boundary, and it runs inside `assignSceneRanges`, i.e. BEFORE the merge
  passes read a duration. It runs a SECOND time on the boundaries as persisted — after the
  pause-snap, and on the no-transcript path too (`unsnapImplausible` + `finalPlausibilityGate`) —
  because that is what the banner audits: the first run judged pre-snap cuts, and a snap could
  still starve a short scene, so a fresh film left voicing flaggable. Proportional cuts land a median ~2.6 s off the words, so they are the
  last resort: the voicing stage first calls `healTranscriptHoles`, which re-transcribes JUST the
  damaged stretch and splices the words in (`mergePatchedWords`), and only a stretch still
  unheard keeps the word-count cuts, with a job warning naming the time range. A stretch that
  does not fit at all (minutes of audio for a line of text) is `unrepairable` and FAILS THE JOB AT
  VOICING with the range named — before a single clip is paid for. For films already rendered:
  `auditStoryboardTimeline` runs on every poll (`pollJob.timelineIssues`; scenes whose length an
  operator set are exempt) and drives a "Repair timeline" banner, and `repairJobTimeline` →
  `planTimelineRepair` (pure, tested) re-transcribes the master, re-aligns the EXISTING scenes
  (their text was never lost, only their timing), re-splits damaged scenes that come back over
  the ceiling, and touches ONLY scenes whose range moved more than 0.25 s: their slice is re-cut
  from the same master, their clip cleared, and the ordinary retry pass renders them. Every other
  scene is returned as the original object — range, slice and paid-for clip byte-identical — and
  the moved stretch's outer edges are clamped onto those stored neighbours so the film still
  tiles to the millisecond and stays on the master-overlay path. Audited against 70 real jobs:
  one flag, and it was a second genuine case (461 words in 1.4 s)
- **No room tone, no hiss** (2026-09-27). The operator heard the -56 dBFS room tone as a BUZZ, so
  every spliced pause is now clean silence (delivery run joins, lip-sync batch gaps, assembly holds
  — `HOLD_GAP_SOURCE`). That exposed the 69Labs voices' own ~-62 dB hiss in their pauses, which now
  sat right beside dead silence and read as the same buzz; `denoiseMasterHiss` (`afftdn=nf=-50`)
  cleans it out of the master on all three save paths, before the pause cap and the leveller, so
  whisperx, the slices and both lip-sync lanes inherit it (3-min master: 13 → 1 hiss-next-to-silence
  stretches, speech level -27.1 → -27.4 dB, same length). `NARRATION_DENOISE=0` turns it off.
- `server/narrationLevel.ts` — the voice at ONE level across a film. 69Labs (ElevenLabs
  underneath) chops a long script into chunks it generates separately (`splitType: "smart"`),
  and the delivery plan voices it as runs joined in `concatWithPauses`; each generation lands
  at its own energy and a long one trails off. A hosted 16-min film (2026-09-22) swung 14 dB
  while speaking — a slow slide, then a jump back up wherever a new generation began — and
  nothing downstream evened it out (the per-channel multiplier is one fixed gain, the pause cap
  only trims silence, assembly measures loudness once to set the music bed). ffmpeg's stock
  levellers were tried on that film and rejected: `dynaudnorm` is peak-driven and TTS peaks are
  already uniform (11 → 9.5 dB), `speechnorm` did nothing or lifted the whole file 9 dB. The
  curve is MEASURED instead (`planLevelGains`, pure): voice-band level per 250 ms frame, gated
  to the frames within 20 dB of the loud ones, per 2 s bin, gain to the film's OWN median
  (overall loudness untouched, every channel keeps its level), smoothed ~10 s so a word never
  moves it, clamped -6..+10 dB, capped per bin under -1.5 dBFS. Result on the same film: 11 →
  2.8 dB spread, second-to-second wobble unchanged. Applied as a 100 Hz float gain ENVELOPE
  multiplied in (`amultiply`); the envelope leg MUST pin `osf=fltp` or negotiation feeds the
  resampler 16-bit and clips every gain above 1.0 to exactly 1.0, and `amultiply` ends at its
  SHORTER input so the envelope is padded past the audio. Wired in three places, each
  best-effort (a failure keeps the audio as voiced): `levelMasterNarration` on all three
  master paths BEFORE the master is persisted, so whisperx, the slices and both lip-sync lanes
  inherit it; `runMatchGainsDb` in `concatWithPauses` matches each delivery run to the runs'
  median at the join; `matchSceneToMasterLevel` in `buildSceneNarration` brings a re-voiced
  scene to the master's level (master measured once per URL, `masterSpeechLevelDb`). A steady
  read comes back byte-identical (`LEVEL_MIN_SPREAD_DB`). The render log prints the spread
  before/after. Uploads (`normalizeNarrationAudio`) are NOT levelled — a human read's dynamics
  are the operator's. FILMS RENDERED BEFORE the leveller get the one-time "Even out voice"
  button on the job card (`levelJobNarration`, route `levelNarration`). It is LEVEL-ONLY and
  takes seconds: it levels the stored master and uploads it under a NEW url, and does not
  assemble — the live cut preview plays the master, so the operator hears it at once, and
  `narrationLevelled.applied === false` drives an "assemble to apply" notice until the next
  final is written (`assembleAndFinalizeCore` flips it). It used to re-stitch as its last step,
  which on a film with no final yet made a seconds-long fix look like a twenty-minute one (that
  was the film's first assembly) with nothing on the card while it ran. On a film on the master
  track (`masterOverlayEligible`) the scene SLICES ARE DELIBERATELY LEFT ALONE: each scene's
  video file embeds its slice and the `mux` cache key names the slice URL, so re-cutting them
  forced every scene to re-encode on the next Reassemble for audio the film never plays; only
  the `filmaudio-overlay` key (which names the master) misses. Measured on a 10-scene job:
  levelling 4.3 s, then Reassemble 8.8 s with 10/10 scenes reused. Off the master track the
  slices are re-cut (the film plays them); a job with no master has each scene file matched to
  the film's median (`runMatchGainsDb`). No provider is touched. The job flips to `processing`
  for the pass and is put back to its prior status and stage. It does not fix a provider
  artifact (a buzzy or robotic generation) — that needs a fresh read. PROGRESS for this pass and
  for every assembly is `shared/jobPhase.ts`: a label and a weighted percentage (scene encodes
  own 3-85% of assembly, cache hits count instantly) written as `progress.phase` through
  `setJobPhase`, which throttles to one write per 1.5 s and chains writes per job so a late one
  never lands after the clear. `assemblePerSceneFilm` reports through its `onProgress` option.
  Narration slices are now cut eight at a time (`SLICE_CONCURRENCY`): 224 slices of a 16-min
  master went 24 s → 5 s; strict callers still throw the first error, after every worker stops
- **Voice directions** (`shared/voiceDirections.ts`, 2026-10-03) — a script may carry `[laughs]`,
  `[sighs]`, `[whispers]`, `[warmly]`… where the host should do them. ElevenLabs v3/v4 act a
  bracketed direction out; every older model, and MiniMax (which is what a 69Labs account CLONE
  runs on, whatever model is asked for), reads it ALOUD. So a script has two copies: the CLEAN one
  — `parseCtaMarkers` and its browser twin `stripCtaMarkerLines` remove directions first, so the
  storyboard, alignment, the skip check (a direction would read as a skipped word and stop the
  film), scene text, captions and shot list never see one — and the DIRECTED one
  (`directedSpokenScript`), handed to the voice by `voiceTextFor` only when `directionsBlockedBy`
  says the voice can act them (69Labs vendor, ElevenLabs library voice, `eleven_v3`/`eleven_v4`
  model). Otherwise the clean copy is voiced and the job warns. The two copies MUST split into the
  same paragraphs — the delivery plan voices paragraph-indexed runs — so a direction on a line of
  its own is joined to a neighbour (`attachLoneDirections`) and `voiceTextFor` falls back to clean
  if they ever differ. A re-voiced scene (regenerate/retry/skip repair) is voiced from clean scene
  text, so it loses its direction. Only Roger, Amos, Diane and Dale are ElevenLabs voices; the
  other 9 channels are 69Labs clones and v4 refuses them (tested on Hank, 2026-10-02:
  `/voice-clones/generate` "Unsupported voice model"). v4 is 1.5x 69Labs credits; `pricing.ts`
  does not price it differently yet. The generate form says before the click whether a script's
  directions will be acted or left out; Admin → Channels offers `eleven_v4` as a TTS model
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
- `server/heygenTest.ts` + `shared/heygenTest.ts` — the HeyGen TEST BENCH (its own nav entry
  "HeyGen test" beside Channels, `/heygen-test`, admins and operations managers only —
  `canManageChannels` in the nav, `managerProcedure` on the router): which host
  PHOTO makes the best talking head, before a film pays for it. One script (≤84 words) is voiced
  ONCE in a channel's own voice (`resolveTTSVendor` + `generateSceneVoiceover`, the film's
  settings), cut to 30 s (the hard cost cap), and every photo in the run (≤4) is lip-synced from
  that same file with the production call (`submitLipsync`, Avatar IV, expressiveness "low"), so
  the photo is the only variable. Rows live in `heygen_tests` (migration 0011), one per photo,
  grouped by `batchId`; HeyGen's `video_id` is persisted on accept and `resumeHeygenTests` (run on
  every `heygenTest.list`) polls an orphan instead of resubmitting — a row cut off before HeyGen
  accepted it is failed, never re-spent. Shares the account's `heygenSlotsFor` semaphore with the
  pipeline. NOBODY PICKS THE ACCOUNT (2026-10-04): the page had a
  dropdown of the accounts with no film on them, which stopped working the day videos began
  spreading over every account (the pool, above) — "All HeyGen accounts are in use" would have
  been the normal state. A run is now GIVEN its account by the server
  (`assignHeygenTestAccount` in `server/accountPool.ts` → `pickHeygenTestAccount`, pure): the
  TEST account first (`heygen_key_test`, Admin → Provider Keys → HeyGen "Test" row; no film ever
  renders on it, so a test there slows no video; stored on a row as `heygenSlot = -1` via
  `accountToSlot`/`slotToAccount`), then the least busy pool account, lowest number on a tie;
  the shared `HEYGEN_API_KEY` only when no account has a key. Films and test clips count against
  ONE load number per account, and a video's own pick counts running test clips too. A busy
  account is never refused — the clips wait their turn on its semaphore — so the only thing
  that blocks a run is "No HeyGen key is set" (`heygenTest.status`, which also carries the rate
  the cost estimate uses). The pick and the row write happen under the same in-process lock as a
  video's, and the account is kept for the run's life: a retry or a resume must reach the
  account holding its HeyGen video id. Each clip's card says which account it is on
  (`heygenAccountLabel`). The start routes take no `account` input — a tripwire in
  `accountPool.test.ts` fails if one comes back. Retired with the dropdown: the
  `heygenTest.accounts` route, `planHeygenAvailability`, and the live account stream
  (`heygenAccountStream.ts`, `heygenAccountEvents.ts` and the `notifyHeygenAccountsChanged` calls
  in the db helpers), which existed only to keep that dropdown current.
  Each running clip shows a PROGRESS BAR from `heygenTestProgress` (shared/heygenTest.ts):
  HeyGen reports a stage, never a percentage, so it is an estimate from `phaseStartedAt`
  (migration 0012, stamped at voicing → preparing the photo → HeyGen accepted) against each
  stage's typical length — voicing 0-15%, preparing 15-30%, rendering 30-100% at ~6.5 s per
  second of video — never backwards, never 100 before done, "taking longer than usual" past the
  typical time. RETRY (`retryHeygenTests`, per clip or "Retry all failed") resubmits failed clips
  on the batch's existing audio, or re-voices the whole batch when voicing was what failed; it is
  an operator click, so it may spend; it runs on the batch's own account and waits its turn there
  (refused only if that account's key has since been removed).
  A failed clip shows `friendlyHeygenTestError(raw)` — plain language plus what to do — with the
  raw error kept on the row and shown on hover; a new failure mode needs a rule there or it
  reads as the generic "Something went wrong".
  Runs carry an optional, renamable `runName` (migration 0013). The results list is PAGED BY RUN
  (5 per page, numbered `pageList` buttons) and filtered on the server (`listHeygenTestPage`:
  search over name + script, channel, run by; the channel and run-by options list only channels
  and people that have runs) — it only ever sorts `batchId`/`max(id)`, never a text column (the sort-buffer trap above).
  Spend is priced per clip on the card (audio seconds × `COST_HEYGEN_PER_SEC`) and is NOT
  in the Spend tab, which totals per-job `costUsage`. Refused in mock mode. UI
  `client/src/pages/HeygenTestPage.tsx` + `client/src/components/HeygenTest.tsx`, harness `client/__harness/heygen-test.html`
- **Upsell VSL** (`shared/vsl.ts`, `/vsl`, nav entry "Upsell VSL" beside "HeyGen test", same
  gate, 2026-10-03) — the host's ≤30 s clip for the top of the upsell page, right after a
  purchase: thanks for the book, then the bundle offer. It is NOT a second engine: a VSL is a
  `heygen_tests` row with `kind = "vsl"` (migration 0015, plus `bookTitle` and `isPicked`), run by
  `startHeygenTest` — voicing, the 30 s cut, the production lip-sync call, the steadier, resume,
  retry, progress and the account rules are the test bench's one code path, and the page reuses
  its pieces (`useHeygenTestStatus`, `HeygenClipStatus`, `RunName`, exported
  from `HeygenTest.tsx`) and its `status` / `retry` / `rename` / `deleteBatch` routes. What a VSL
  adds: it is KEPT PER CHANNEL (the page is one channel's voice, photos, books and clips;
  `vsl.list` filters `kind` + `channelKey`, the test page lists only `kind = "test"`, while the
  account pick and `resumeHeygenTests` read every kind), files live under
  `vsl/<channelKey>/<batchId>/` (`heygenTestStorageDir`), exactly one photo (the channel's primary
  by default, in the look the channel is switched to), and the book the buyer bought — stored as
  the TITLE the host says, not an id, because CTA books are often uploaded per video and are not
  in `books`: the form is ONE dropdown (`BookPicker`): the channel's books with their covers, a search box,
  and a `Use "…"` row for a typed title, which is used for that VSL only and never added to `books`. The
  script is a template: `{book}` is filled with the title (`vslInputError` refuses a script still
  holding it — the host would read it aloud); there is NO tip (a `{tip}` slot was built and
  removed the same day, the operator's call); a channel's next VSL starts from its last one's
  wording (`vslTemplateFrom`). A NEW PHOTO can be uploaded on the page and it asks first: "Just for
  this VSL" (component state, phone look via `heygenTest.phoneLook`, never saved) or "Keep on
  channel" (`channelHostPhoto.save` with `isSelected: false` — in the library for the next VSL but
  UNTICKED, so it never becomes a camera angle in the channel's videos behind anyone's back; a
  channel's only photo is saved ticked regardless). Generate waits for a photo's phone look. "Use this
  one" (`vsl.pick` → `planVslPick`, pure) keeps ONE clip in use per channel and book and is a
  toggle; it is a label for people — nothing reads it yet, the upsell page is given the clip by
  Download MP4 / Copy link. Not in the Spend tab, like tests. Harness: `client/__harness/vsl.html`
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
- **Activity and taking a video over** (`shared/activity.ts`, `shared/jobTakeover.ts`,
  `server/jobTakeover.ts`, `server/jobAccess.ts`, `/activity`, 2026-10-04) — the oversight
  tiers' live view of everyone's videos, in the top nav beside "Upsell VSL" (`managerProcedure`
  on the `activity` router). `activity.list` returns every processing job plus the 40 most
  recently settled in the last 24 h (`getActivityRows`: ids first, details `WHERE id IN` with no
  ORDER BY — the sort-buffer trap — and never the script or storyboard; the host flags are
  answered inside MySQL by `json_contains_path`). NEEDS ATTENTION (`activityAttention`) is a
  failure in that window that is not the maker's own cancel, or a running video waiting on the
  voice (`ttsWait`), on HeyGen (`hostWaiting`) or on a "Host needed" beat; the count is the red
  badge on the nav entry, and the 24 h window is what keeps old failures from lighting it
  forever. TAKE OVER opens the video in the taker's own tab (the Library's `/?open=<id>` path:
  a free tab, else the one in view) and PAUSES everyone else on it — the owner and other admins
  alike, since two people clicking Retry pay twice. The pause is enforced by
  `assertJobAccess(job, user, "read" | "write")`, the ONE permission check: it replaced ~35
  inline copies in `routers.ts` and closed two routes that had none ("Make host", a paid HeyGen
  render, and the cost breakdown were open to any signed-in user on any video); a tripwire in
  `jobAccess.test.ts` fails if a route with a `jobId` input skips it or an inline ownership
  test comes back. The owner's card shows "Being fixed by …" and wraps the job card and
  storyboard in ONE `<fieldset disabled>`, so every button inside pauses and nothing added later
  can be missed; it learns of a takeover from `longformVideo.takeoverState`, polled apart from
  `pollJob` because a finished or failed video is not polled and a failed one is exactly what
  gets taken over. It is HANDED BACK by the button, when the tab holding it is cleared, when the
  video is deleted, when a video it re-ran finishes (`sawProcessing` then `completed`), or 30
  minutes after its holder last had it open (`TAKEOVER_IDLE_MS` — the holder's polls and clicks
  are what refresh it, so a long re-render being watched does not release halfway); an admin can
  break a takeover someone else left. State lives in memory, written through to
  `app_settings.job_takeovers` — deliberately NOT on the job row, whose `updatedAt` is the
  heartbeat the stale-job sweep and the restart resume read, so a takeover kept alive by an open
  page would make a dead render look alive. Paid clicks during a takeover are already named on
  the ledger (`SceneSubmit.by`). Harness: `client/__harness/activity.html`
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
  resumes orphaned renders (provider results stay downloadable ~24 h). At BOOT every job still
  `processing` was cut off by the restart (a deploy, a crash, or `tsx watch` reloading on a
  saved file), so `server/restartResume.ts` continues each one ONCE (`inputParams.autoResumedAt`)
  through the path the operator's buttons use — pipeline from the top reusing the checkpointed
  master (`inputParams.voicedMasterUrl`, written the moment the master is voiced), "Retry failed
  scenes" for the clip stage, "Retry assembly" after it. A second cut-off, a job idle past 24 h,
  or a clip-stage job whose scenes lack narration (continuing would buy a voiceover per scene)
  is failed with a message instead — it never spends on TTS unattended. Boot first waits
  `LIVE_CHECK_MS` (90 s) and leaves alone any job whose row moved meanwhile
  (`stillRunningElsewhere`): every running job heartbeats `updatedAt` once a minute
  (`startJobHeartbeat`), for the WHOLE pipeline — voicing and storyboarding included, which used
  to send nothing, so a long master that took 30+ min to voice was reaped mid-TTS as "timed out
  after 30 minutes of inactivity". Without the live check, a `tsx watch` reload resumed a job
  another process was still running and the job ran twice.
- **`ADMIN_EMAIL` / `ADMIN_PASSWORD` are a bootstrap, not the login.** They create the first
  admin when `users` is empty and are ignored forever after — in particular they never
  overwrite a password changed in Admin → Users, so a stale value in the deploy's environment
  cannot silently reset it. The seed is pinned at **`id = 1`** because every pre-accounts job,
  slot and library row carries `userId = 1`; seeding anywhere else orphans all of it. With no
  admin row and no env vars, nobody can sign in and boot says so loudly.
- **A narration outage is waited out, not failed** (`server/ttsRecovery.ts`, 2026-09-26). A hosted
  job's master narration failed, then "Retry failed scenes" voiced all 229 scenes one by one and
  69Labs failed every one ("TTS generation failed" — 69Labs' task said FAILED with no reason). Now
  the pipeline tags a master failure (`NarrationFailedError`) and `classifyNarrationFailure`
  sorts it: the voice gone, no credits, a rejected key or a blocked text FAIL at once with what
  to fix; anything else WAITS — the job stays `processing` on voiceover, the card says "Waiting
  for 69Labs", and every `TTS_WAIT_CHECK_MS` one short line is voiced in the film's own voice
  (`probeNarrationVoice`). When it comes back the render is run again from the top with the same
  inputs (storyboard repeats, cheap) — at most `TTS_WAIT_MAX_REVOICES` times, and never past
  `TTS_WAIT_MAX_MS` from `inputParams.ttsWait.since`, which is persisted so a restart neither
  loses the wait (`restartResume` → `resumeTtsWait`, without spending the one auto-resume) nor
  extends it. It never switches vendor. "Try voicing again" (`retryNarration`) checks now on a
  waiting job and re-runs a job that failed before it was voiced; "Retry failed scenes" on such
  a job (`diedBeforeNarration`: no master, nothing voiced or rendered) does the same instead of
  its per-scene fan-out. A heartbeat keeps the waiting row fresh for the stale-job sweep.
  A BROKEN VOICE looks exactly like an outage, so the first check runs at once and a failed
  check tries the same line in up to two OTHER channels' voices (`probeNarrationVoice`; there is
  no stock voice to compare with — 69Labs refuses ElevenLabs' premade ones): film voice failing
  while another works `VOICE_STUCK_CHECKS` (2) checks in a row ⇒ fail with "pick a different
  voice", ~5 min instead of 2 h. Werner's voice (`IsC5x9dr2Ii3Qcxbkusu`, 2026-09-26) is the
  case: its tasks sit PENDING in a queue, never start, and FAIL ~4 min later with only
  `userMessage` "This job failed to complete" (now read by `pollTTSTask69Labs`), unbilled,
  while every other channel's voice answers in under a minute.
  The comparison is only between voices of the SAME KIND (`voiceSpace69Labs`: an account clone or a
  library voice — they go through different 69Labs endpoints and fail independently), and a
  provider outage (`isProviderOutage`: a 5xx after the adapter's retries, VOICE_LOOKUP_FAILED,
  "temporarily unavailable") never counts towards a stuck voice and skips the comparison: on
  2026-10-01 the clone lane answered 503 VOICE_LOOKUP_FAILED for over an hour while library voices
  worked, and Pearl's, Scarlett's and Lance's practice films (jobs 284-286) were failed as "pick a
  different voice" because the comparison voice was a library one.
  THAT "OUTAGE" WAS OUR ROUTING (found 2026-10-02): `/tts/generate` started answering an account
  clone's id with 503 VOICE_LOOKUP_FAILED instead of the 400 "not found" the clone reroute waited
  for, so every clone voice stayed on the wrong endpoint while `/voice-clones/generate` (what the
  69Labs website uses) accepted it at once. `createTTSTask69Labs` now picks the clone lane UP
  FRONT for a UUID-shaped id the account's clone list holds (`fetchVoiceCloneIds`, cached), and a
  VOICE_LOOKUP_FAILED on the standard lane re-checks the list and switches lanes. All 9 clone
  channels voiced at once after it. Before blaming 69Labs for a clone failure, POST the same voice
  to `/voice-clones/generate` directly.
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
- **A finished clip is never thrown away.** `runChunkTasks` used to discard a host clip that
  probed shorter than its narration and resubmit it — with no cap, and with a FAILED probe
  reading as 0 and therefore as "short" — so a billed HeyGen render was re-paid on every retry
  pass: production jobs on a 3-min host pick metered 463–634 s of HeyGen (2.5–3.5×) with three
  minutes of host on screen. The guard now KEEPS the clip (assembly holds its last frame, the
  shortfall is `scene.clipShortSec`, the job warns), a probe of 0 is "unknown", and only an
  EMPTY clip goes back, through the bounded infra path. Transient resubmits on the host lanes
  are capped too (`MAX_TRANSIENT_RESUBMITS_HOST`); b-roll stalls stay unbounded because a grok
  stall is not billed. The expected length is the last SPOKEN word plus 0.25 s
  (`speechEndWithinSlice`, off `job.masterSilences`), not the slice end, so a beat ending on a
  pause is not "short" by that pause. Every accepted submit is written to `scene.submits`
  (`{provider, at, reason, sec}`; reasons first / resume / transient / infra / regenerate /
  retry / merge) — the per-scene ledger behind the card's "Rendered N× — paid each time"
  badge; `scene.nextSubmitReason` is how a resubmit path names the next entry. The cost
  dialog's lip-sync seconds are submits × narration, so on a job predating the ledger the only
  way to tell re-renders from budget is the render log's "host budget" line.
- **Each host beat may be paid for a fixed number of times in its LIFE** (`shared/hostRegenLimit.ts`,
  2026-09-25). A 3-min pick metered 11:44 of host (3.9×), almost all "Retry failed scenes" clicks:
  one click could pay three times (`withTransientRetry` resubmitted a failed host render) and
  nothing counted clicks across a beat's life. Now, counted off the ledger (host lanes only, so
  films made before follow it too) and enforced by `decideHostRender` at the one seam every paid
  submit crosses (`runChunkTasks`, before the spend gate): AUTOMATIC renders (first / resume /
  transient / infra / retry click) are the first plus ONE retry (`HOST_AUTO_RETRIES`), TWO on the
  start/CTAs/end (`HOST_AUTO_RETRIES_PROTECTED`, `scene.hostProtected` — which covers the "I'm
  Hank" intro and the whole intro/outro sections); OPERATOR regenerates are ONE
  (`MAX_HOST_REGENERATIONS`). The first pass takes its retry on the spot (`renderSceneClip` loop,
  `hostMayRetryNow`); a regenerate or retry CLICK is one render — its retry loop still re-polls a
  render running past the poll ceiling but never resubmits a failed one. Past the allowance
  (`HostRenderCapError`, nothing submitted) `settleFailedHostScene` decides: a check-in is made
  b-roll AUTOMATICALLY (`autoBrollHostScene`/`planAutoBroll`, "Auto b-roll — host lane failed"
  badge, job warning; `HOST_FAIL_TO_BROLL=0` keeps a failed card), a PROTECTED beat is flagged
  `scene.hostNeeded` ("Host needed", red) and never demoted behind anyone's back — the assembly
  gate names it and "Retry failed scenes" skips it, so a person Regenerates or makes it b-roll.
  A HeyGen ACCOUNT failure (`server/hostLaneFailure.ts`: 401/403 key, 402/credits/quota,
  suspended, 429 or 5xx/network after the adapter's own retries, no key for the video's account) is not the
  beat's: `HostAccountError` PAUSES the job's host lane (in-memory, `pauseHostLane`), every other
  host submit fails fast without calling HeyGen, beats are left clip-less with
  `scene.hostWaiting` ("Waiting for HeyGen"), none of their allowance is spent (HeyGen accepted
  nothing), and the job stops at the assembly gate naming the account. It never switches account
  on its own; "Retry failed scenes" or any render click lifts the pause (`resumeHostLane`). The
  router still refuses a used regenerate as `accepted: "locked"` before enqueueing; an editor's
  card then shows "Make b-roll" IN PLACE of Regenerate (also when the video's host minutes are
  used), while an admin or manager keeps Regenerate behind a cost confirm — that render is
  ledgered `pastLimit`. A regenerate never throws away the shot it replaces: HOST TAKES
  (`shared/hostTakes.ts`) keep the old take beside the new one (`scene.hostTakes`/`activeTake`,
  the new one active), the card's `HostTakePicker` switches between them for free (`take` edit,
  instant metadata, marks `timingEdited` so "Reassemble to apply" shows), and a regenerate that
  fails or is refused puts the old take back. Every click is NAMED on the ledger
  (`SceneSubmit.by`, from `req.by`/`scene.nextSubmitBy`), and the Cost dialog's host lines
  (`hostRenderBreakdown`) split first renders / automatic retries / regenerates / retry clicks /
  past-the-limit with who clicked each ("before tracking" for older entries). Harness:
  `client/__harness/host-takes.html`
- **A video's host lip-sync spend is capped at the minutes picked** (`shared/hostSpend.ts` +
  `server/hostSpend.ts`, 2026-09-23). The plan (`planHostMinutes`/`capHostMinutes`) only decides
  which beats are host; every other limit is PER BEAT (3 paid renders each then; 2-3 now), so ~36 beats could
  bill ~108 renders — a 3-min pick metered 98 calls / 566 s / $33.96 and tripped nothing. The
  limit is `inputParams.hostBudgetSec` (the budget the plan spent, written at the clip stage;
  older jobs fall back to `hostMinutes × 60`), so the form's "max ~$10.80" is a promise. It is
  enforced on the one seam every paid HeyGen submit crosses, the metering wrapper in
  `resolveLipsyncAdapter`: a per-job running total seeded once from `costUsage` and reserved
  SYNCHRONOUSLY, so eight concurrent submits cannot all read "under". The start, CTAs and end
  (`scene.hostProtected`, stamped by `markProtectedHostBeats` from `hostAnchorKind`) are sent to
  HeyGen FIRST (`protectedHostFirst` in the dispatcher) and never refused on an automatic pass —
  their retries come out of the same budget, and the middle check-ins, last in line, are what the
  limit refuses: `HostSpendLimitError` → `autoBrollHostScene(…, limit)` → "Auto b-roll — host
  limit". An operator's paid click (full-frame Regenerate, batch, "Make host") is refused in the
  router as `accepted: "overLimit"` on every beat; admin/manager `force` grants ONE render
  (`grantHostSpendOverride`). A refused regenerate keeps the clip the scene had. The Cost dialog
  prints spent/limit and who paid for what (see the per-beat entry). `HOST_SPEND_LIMIT=0` turns it off. RunPod is not
  gated (billed by GPU time, retired since 2026-09-10). The storyboard header shows "Host minutes:
  X of Y", and a host Regenerate once they are USED (`hostSpend.reached`, not only when this one
  render would cross) opens a warning box for every role — "Regenerate anyway" for admin/manager,
  "Make b-roll" for all; a server `overLimit` answer opens the same box instead of a toast.
- **A host photo HeyGen refuses stops at the first refusal** (`shared/hostRedo.ts`,
  `hostPhotoRefusal` in `server/hostLaneFailure.ts`, 2026-10-03). HeyGen's content check refused a
  phone-look photo (`400 avatar_not_usable`) and it was treated as each beat's own failure: every
  host beat spent its retries on a photo that could never pass, ~25 check-ins were made b-roll
  (paid pictures, thrown away later), the start/CTAs/end were left "Host needed", and the card
  carried 30 warnings for one cause. Now it takes the account-failure road (`HostAccountError`
  with `photoUrl`): one call, nothing on the ledger, no b-roll, `scene.hostWaiting.photo` ("Photo
  refused"), ONE job warning per photo, and only beats on THAT photo wait (`hostLanePause(jobId,
  scene.lipsyncImageUrl)`) — another angle keeps rendering. The film never changes photo by itself
  (the operator's call). "Redo host clips" (`redoHostClips`, route of the same name, any role that
  may retry, behind a cost confirm from `pollJob.hostRedo`) is the way forward: it re-reads the
  channel's photos as they are NOW (`channelHostPhotoUrls`, shared with generate — the film's own
  snapshot is the refused photo, so "Retry failed scenes" alone would resend it), takes back the
  waiting and "Host needed" beats and the check-ins already made b-roll for this reason
  (`prepareHostRedo`, full-frame), and runs the ordinary retry pass. Only refusals of the photo
  are taken — never a beat the host limit, another failure or a person made b-roll.
- **A host photo HeyGen cannot get READY is retried, then waited out** (`registerAvatar` in
  `server/providers/heygen-lipsync.ts`, `isHostPhotoPrepFailure` in `shared/hostRedo.ts`,
  2026-10-05). A 226-scene film on ONE photo came back with 13 start/CTA/end beats "Host needed",
  ~20 check-ins made b-roll and 33 warnings: HeyGen answered the free photo registration
  (`POST /v3/avatars` by URL) with `404 asset_not_found` for the copy of the photo it had just
  made — which its docs call "retry after a brief delay" — and nothing retried it. The beats on
  a photo share one registration promise, so each failed call failed up to eight of them at once
  (11 distinct asset ids on the card = 11 failed registrations), and the failure was then read
  as each beat's own. Now: the photo's BYTES are uploaded first (`POST /v3/assets`, png/jpeg;
  anything else, or a refused upload, registers by URL as before) and the avatar is made from
  that `asset_id`, so a retry reuses the asset instead of racing a new one; `asset_not_found`,
  409, 429, 5xx and a dropped connection wait out `REGISTER_BACKOFF_MS` (~105 s); a 400 (no
  face) or a `failed` avatar group is a definite answer and fails at once. The `Idempotency-Key`
  is KEPT across a 5xx/network retry (the request may have landed) and CHANGED after a definite
  refusal (a reused key replays the refusal). `avatar_not_found` at video create drops the
  cached id and registers once more (`forgetAvatar` — only if that registration is still the
  cached one, so eight beats share ONE new registration). A registration that outlasts all of it
  is worded `HOST_PHOTO_PREP_FAILED` and takes the refused-photo road with its own copy
  (`HostAccountError(…, photoUrl, prep)`, `hostWaiting.prep`, "Photo not ready"): one call, no
  ledger entry, no b-roll, one warning per photo, other angles keep rendering — and the way
  forward says the photo is fine, try again. It is checked AFTER `hostAccountFailure`, so a
  registration that died on the key, the credits or a 5xx is still the account's. "Redo host
  clips" takes these beats back too, including what films recorded BEFORE this (the old
  "avatar registration failed (404/409)" and `avatar_not_found` words), and its confirm says
  "refused" only when `planHostRedo().refused > 0`. NOT live-verified: the `/v3/assets` shape is
  from HeyGen's docs and mocks — one run on the HeyGen test page confirms it.
- **The job card's warnings are grouped** (`shared/jobWarnings.ts`,
  `client/src/components/JobWarnings.tsx`, 2026-10-05): one row per cause listing its scenes,
  the row standing for the most warnings first, the provider's raw error behind "Details", three
  rows until "Show all N warnings". It only re-arranges `progress.warnings` — the server still
  writes one line per event and nothing is dropped. Harness:
  `client/__harness/job-warnings.html`
- **Every video shows what it was MADE WITH** (`shared/jobPicks.ts`,
  `client/src/components/JobPicks.tsx`, 2026-10-05). The generate form only ever shows the picks
  for the NEXT video (it returns to its defaults on every load), so a card whose Cost screen
  read "Host limit: 2:55 of 7:00 used" sat under a form showing "3 min" and the form looked
  like the answer — the video had been generated with 7. The limit is the pick or LESS
  (`resolveHostBudget`), never more, so a 7:00 limit always means 7 was picked. `jobPickFacts`
  reduces the job's snapshot to what is worth showing (never the script's text, a URL or a voice
  id — it rides every `pollJob`), `summarizeJobPicks` words it in the form's order: channel,
  voice (channel / MiniMax / own file), talking head (pick, the limit it became, and why when
  lower), host photos, call to action, title, script length, who made it and when, practice
  run. The Cost dialog's host line says "· N min picked" (`HostSpendSummary.pickedMinutes`). A
  setting a video predates reads "Not recorded". It only SHOWS: who may pick what is unchanged
  (an editor can still pick 7). Harness: `client/__harness/job-picks.html`
- **A black clip is refused** (`isBlankClip`/`judgeBlankFrames` in videoAssembly, 2026-09-25). A
  hosted film carried a HeyGen take that was black end to end on a host beat, and nothing looked.
  Every host-lane clip is sampled twice a second at 64×36 before it is stored; ≥85% frames dark
  (mean luma < 16) or flat (σ < 4) ⇒ `scene.blankClips++`, a job warning, and the render THROWS —
  so the lane's own rules decide: another render within the beat's allowance and the host minutes,
  then a check-in is made b-roll and the start/intro/CTAs/end are flagged "Host needed".
  Assembly re-checks host clips not yet checked (`refuseBlankHostClips`, remembered on
  `scene.clipCheckedUrl`) and stops the film naming them, for "Retry failed scenes" to follow the
  same rules. B-roll lanes are not checked at render (a black b-roll clip would loop their
  unbounded stall retries).
- **Back-to-back host beats are one take** (`joinBackToBackHostTakes`, clip stage, 2026-09-25).
  Every HeyGen render starts from the same still pose, so two host beats in a row on one photo
  jump at the join — the CTA pitch after the book did it every time. Full-frame host beats that
  tile the narration join into one render (same seconds, same cost) up to `HOST_JOIN_MAX_SEC`
  (30 s), never across a CTA edge, QR/cover/asset beat or the two-angle cold open; the joined
  narration is re-cut from the master before anything renders.
- **Provider gate**: generation needs an _active_ `provider_configs` row. "No active
  provider configured" ⇒ re-run `scripts/seed.mjs` or set active in Admin.
- **FFmpeg needs drawtext** or text overlays silently disable. The startup log names the
  binary it picked (`server/ffmpegPath.ts`); bundled `ffmpeg-static` has drawtext.
- **A tiny voice slice is read as VIDEO unless told** (2026-09-28). ffmpeg guesses an input's
  format from its first bytes; a sub-second mp3 is mostly its ID3 tag (69Labs' AIGC label), and
  the guess came back raw VVC — `-map 1:a` then matched nothing and Mae's job 219 lost its
  storyboard scene 7 at assembly on every attempt. **Every ffmpeg call goes through
  `server/ffmpegSpawn.ts`** (`spawnFfmpeg` / `execFfmpeg`), which names each mp3 input
  (`withInputFormats`, sniffing ID3 / MPEG sync — never when the input already names its format
  anywhere among its own options: a raw mask of 255s reads as an MPEG sync) and waits out a machine too busy to START ffmpeg
  (`retryUnstarted`: `spawn UNKNOWN`/EAGAIN/ENOMEM, Windows exit 3221225794, 2/5/10/20 s) —
  Diane's job 222 died slicing narration and Pearl's 220 in assembly on exactly those, at steps
  with no retry of their own. `isTransientFfmpegError` knows the Windows words too. A TRIPWIRE in
  `ffmpegSpawn.test.ts` fails if any other server file imports `child_process` (only
  `ffmpegPath.ts` and the ffprobe in `mediaProbe.ts`, which does both itself, may). And every start WAITS
  FOR MEMORY (`waitForFreeMemory`, < `FFMPEG_MIN_FREE_MB` 1024 free ⇒ wait, ≤3 min, jittered): each
  process caps its own ffmpeg count but nothing watched the machine — three 3-min films at once
  left 0.9 of 13.9 GB free and x264 failed "malloc of size … failed" (now also a never-started
  retry). Off under vitest.
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

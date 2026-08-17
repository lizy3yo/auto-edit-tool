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
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`                                         | `server/adminAuth.ts` (single admin)                                                                   | no login                                  |
| `PORT` (3000)                                                            | `server/_core/index.ts:77` — auto-scans +20 if busy                                                    | —                                         |
| `ANTHROPIC_API_KEY`                                                      | `server/claude.ts` (`claude-opus-4-8`), `server/overlayTextScan.ts` (`claude-haiku-4-5-20251001`)      | storyboard stage fails                    |
| `GEMINI_API_KEY`                                                         | `server/gemini.ts` (`gemini-2.5-flash`), `server/providers/gemini-image.ts` (`gemini-3.1-flash-image`) | no visual direction, no image fallback    |
| `OPENAI_API_KEY`                                                         | `server/providers/openai-image.ts` (`gpt-image-2`, direct api.openai.com)                              | no stills / b-roll keyframes              |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | `server/storage.ts` (S3 API)                                                                           | every upload fails                        |
| `R2_PUBLIC_URL`                                                          | `server/storage.ts:83`, `server/musicBeds.ts:101`                                                      | narration-only films (warns, no crash)    |
| `RUN_POD_KEY` + `RUNPOD_WHISPERX_ENDPOINT`                               | `server/_core/voiceTranscription.ts` → `kodxana/whisperx-worker_v2` serverless                         | no word-level narration alignment         |
| `HEYGEN_API_KEY`                                                         | `server/longformVideo.ts:2506` — **fallback only**, used when a tab's slot key is blank                | host lip-sync fails for slot-less tabs    |
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

| Var                             | Default         | Var                            | Default              |
| ------------------------------- | --------------- | ------------------------------ | -------------------- |
| `FFMPEG_PATH`                   | auto-probe      | `FFMPEG_CONCURRENCY`           | cpu-derived          |
| `FFMPEG_PROBE_MAX_MS`           | 600s            | `ASSEMBLY_DOWNLOAD_TIMEOUT_MS` | 120s                 |
| `PROBE_MAX_MS`                  | 60s             | `BROLL_NO_KEYFRAME`            | unset (`1` disables) |
| `R2_CONNECTION_TIMEOUT_MS`      | 10s             | `R2_REQUEST_TIMEOUT_MS`        | 120s                 |
| `APIMART_RATE_PER_MIN`          | 40              | `APIMART_BURST`                | 5                    |
| `HEYGEN_CONCURRENCY`            | 8               | `HEYGEN_CALL_TIMEOUT_MS`       | 120s                 |
| `HEYGEN_DOWNLOAD_TIMEOUT_MS`    | 300s            | `OPENAI_IMAGE_CALL_TIMEOUT_MS` | 300s                 |
| `OPENAI_IMAGE_BURST`            | 1               | `OPENAI_IMAGE_RATE_PER_MIN`    | 50 (Tier-3 cap)      |
| `SIXTYNINE_VIDEO_CONCURRENCY`   | 8               | `SIXTYNINE_IMAGE_CONCURRENCY`  | 7                    |
| `SIXTYNINE_VIDEO_TIMEOUT_MS`    | 360s            | `SIXTYNINE_CALL_TIMEOUT_MS`    | 120s                 |
| `SIXTYNINE_DOWNLOAD_TIMEOUT_MS` | 300s            | `SIXTYNINE_VIDEO_SUBMIT_BURST` | 2                    |
| `SIXTYNINE_VIDEO_SUBMIT_RATE`   | 5/min (API cap) | `IMAGE_PRIMARY_TIMEOUT_MS`     | 480s                 |
| `IMAGE_PRIMARY_RETRIES`         | 1               | `IMAGE_RETRY_TIMEOUT_MS`       | 240s                 |
| `IMAGE_RETRY_TOTAL_BUDGET_MS`   | 600s            | `MYSQL_SORT_BUFFER_SIZE`       | 8 MB                 |
| `AUTO_MIGRATE`                  | on (`0` skips)  |                                |                      |

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

| Var                          | Default     | Var                         | Default |
| ---------------------------- | ----------- | --------------------------- | ------- |
| `COST_APIMART_IMAGE`         | $0.02/image | `COST_OPENAI_IMAGE`         | $0.003  |
| `COST_APIMART_VIDEO_PER_SEC` | $0.02/s     | `COST_HEYGEN_PER_SEC`       | $0.06/s |
| `COST_TTS_PER_1K_CHARS`      | $0.05       | `COST_GEMINI_IMAGE`         | $0.03   |
| `COST_69LABS_IMAGE`          | $0.05       | `COST_69LABS_VIDEO_PER_SEC` | $0.05/s |
| `COST_WHISPERX_PER_GPU_SEC`  | $0.0004     |                             |         |

## Architecture

React 19 · wouter · TanStack Query · tRPC 11 · shadcn/ui · Tailwind v4 —
Express · tRPC · Drizzle · MySQL.

- `server/_core/index.ts` — bootstrap order: fontconfig → ffmpeg probe → adminAuth →
  HeyGen webhook → `/api/download` proxy → tRPC → Vite/static → watchdog
- `server/longformVideo.ts` — **9k lines, the whole pipeline. Start here.**
- `server/routers.ts` — tRPC surface · `server/videoAssembly.ts` — ffmpeg assembly
- `server/providers/` — one adapter per vendor; `base.ts` is the interface,
  `fallback.ts` the image chain (primary → Gemini). `heygen-lipsync.ts` is the host lip-sync
  lane, resolved in `resolveLipsyncAdapter`
- `server/hostPlate.ts` — **provider-independent**. The lip-sync model animates the image it
  is handed and never changes the setting, so `HOST_PLATES=1` generates a 16:9 plate of the host
  IN each beat's setting (host photo as identity reference) and syncs from that instead of the
  studio headshot. Host beats are bucketed into `HOST_PLATE_LOOKS` looks sharing one plate —
  fewer generated faces to keep consistent, and fewer images. Falls back to the raw photo on any
  failure
- `server/narrationAlignment.ts`, `server/_core/voiceTranscription.ts` — whisperx
- `server/costMeter.ts` + `server/pricing.ts` — per-video spend. Every billable adapter calls
  `recordUsage`; an `AsyncLocalStorage` set inside `withJobLock` attributes it, so the six
  spending entry points (pipeline, resume, retry-assembly, retry-failed, regen scene/scenes)
  are metered by construction and the adapters stay job-unaware. Totals persist to
  `longform_video_jobs.costUsage`; `getCostBreakdown` prices them for the Cost dialog
- `drizzle/schema.ts` — 5 tables: `provider_configs`, `longform_video_jobs`,
  `channel_configs`, `channel_layers`, `app_settings`
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

# Longform Studio

Standalone long-form faceless-video generator: script → AI storyboard → per-scene
TTS + video clips → host lip-sync → stitched MP4. Extracted from the GardenFlow
"Long-form Video" page into its own server, database, and repo.

## Stack

- **Frontend:** React 19, wouter, TanStack Query, tRPC, shadcn/ui, Tailwind v4
- **Backend:** Express + tRPC 11 + Drizzle ORM + MySQL, single long-lived Node process
- **Providers:** Anthropic Claude (storyboard/vision), Google Gemini (visual
  direction + image fallback), OpenAI gpt-image-2 (stills/keyframes), APIMART
  grok-imagine (video), 69Labs (video/image/TTS), HeyGen Avatar IV (host
  lip-sync), RunPod whisperx (narration alignment), Cloudflare R2 (storage),
  FFmpeg (assembly)

## Prerequisites

- Node 20+, pnpm, Docker
- FFmpeg **with drawtext support** for local dev (`ffmpeg-static` is bundled and
  has it; a system ffmpeg without drawtext disables text overlays — the startup
  log tells you which binary was picked)

## Setup

```bash
docker compose up -d           # local MySQL on :3306
cp .env.example .env           # fill in the values (see below)
pnpm install
pnpm db:push                   # create the 5 tables
node scripts/seed.mjs          # seed the 69Labs provider row (+ channels.json if present)
pnpm dev                       # http://localhost:3000
```

Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then in **Admin**:

1. **Provider Keys** — enter the 69Labs API key (Save + Test connection), the
   per-tab APIMART keys (slots 0–4), and the per-tab HeyGen keys. These are
   AES-encrypted and stored in the database — they are never env vars.
2. **Channels** — create channels (persona, voice ID, host photos, CTA QR, book
   cover) or import them from the old database (below).
3. **Longform Instruction** — the global directing prompt (a default ships in
   code).

### Importing channels from the old (gardenflow) database

```bash
OLD_DATABASE_URL="mysql://..." node scripts/export-channels.mjs   # → scripts/channels.json
node scripts/seed.mjs                                             # upserts them into the new DB
```

### Env vars

See `.env.example` for the full annotated list. Env keys: `DATABASE_URL`,
`JWT_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `OPENAI_API_KEY`, `R2_*`, `RUN_POD_KEY` +
`RUNPOD_WHISPERX_ENDPOINT`, `HEYGEN_API_KEY` (fallback), `PUBLIC_BASE_URL`.
Provider keys for 69Labs/APIMART/HeyGen live in the DB via the Admin UI.

## Commands

- `pnpm dev` — dev server (Express serves Vite + tRPC)
- `pnpm check` — typecheck · `pnpm test` — vitest · `pnpm format` — prettier
- `pnpm build` / `pnpm start` — production build / run
- `pnpm db:push` — generate + run drizzle migrations

## Operational notes (read before deploying)

- **Single process only.** The pipeline is fire-and-forget inside one Node
  process: in-memory semaphores, per-job heartbeats, poll loops, and the HeyGen
  webhook wake-up all assume it. No serverless, no horizontal scaling. Deploy
  one instance with restart-on-crash; the 1-minute watchdog resumes orphaned
  renders after a restart (provider results stay downloadable ~24 h).
- **`JWT_SECRET` does double duty.** It signs the session cookie AND derives the
  AES key for the provider keys stored in `app_settings`/`provider_configs`.
  Rotating it invalidates every stored key — you must re-enter them in Admin.
  (To import encrypted keys from the old DB, the new app must use the old
  `JWT_SECRET`; otherwise just re-enter keys.)
- **Music beds** are served from YOUR R2 (`R2_PUBLIC_URL` +
  `music/beds/<channel>/`). Run `node scripts/migrate-music-beds.mjs` once to
  copy the 21 bed mp3s from the old gardenflow CDN into your bucket. Until
  `R2_PUBLIC_URL` is set (and the files copied), films render narration-only
  with a warn — no external CDN is contacted at runtime.
- **whisperx**: deploy `kodxana/whisperx-worker_v2` as a RunPod serverless
  endpoint and set `RUNPOD_WHISPERX_ENDPOINT` — there is no default.
- **`PUBLIC_BASE_URL`** blank (local dev) means HeyGen host scenes rely on pure
  polling — slower but fully functional. Set it in production so the webhook
  wakes the poll loops.
- **Provider gate:** generation requires an _active_ provider row
  (`scripts/seed.mjs` seeds 69Labs as active). If you see "No active provider
  configured", re-run the seed or use Admin → Provider Keys → Set active.
- A full render needs live keys for: 69Labs, APIMART, HeyGen, Anthropic,
  Gemini, OpenAI, R2, and RunPod whisperx. Without them, jobs fail loudly at
  the first stage that needs the missing key (by design).

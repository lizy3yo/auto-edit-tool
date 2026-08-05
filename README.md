# Longform Studio

Standalone long-form faceless-video generator: script → AI storyboard → per-scene
TTS + video clips → host lip-sync → stitched MP4.

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
node scripts/seed.mjs          # seed the 69Labs provider row
pnpm dev                       # http://localhost:3000
```

Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then in **Admin**:

1. **Provider Keys** — enter the 69Labs API key (Save + Test connection), the
   per-tab APIMART keys (slots 0–4), and the per-tab HeyGen keys. These are
   AES-encrypted and stored in the database — they are never env vars.
2. **Channels** — create channels (persona, voice ID, host photos, CTA QR, book
   cover). There is no built-in set; every channel is a row you create here. See
   [Your first render](#your-first-render) for which fields are required.
3. **Longform Instruction** — the global directing prompt (a default ships in
   code).

### Env vars

See `.env.example` for the full annotated list. Env keys: `DATABASE_URL`,
`JWT_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `OPENAI_API_KEY`, `R2_*`, `RUN_POD_KEY` +
`RUNPOD_WHISPERX_ENDPOINT`, `HEYGEN_API_KEY` (fallback), `PUBLIC_BASE_URL`.
Provider keys for 69Labs/APIMART/HeyGen live in the DB via the Admin UI.

## Your first render

Setup above gets the app running. These three things get a film out of it.

### 1. Channel fields that block a render

In **Admin → Channels**, not every field is optional:

- **Voice ID** — **required.** Generation is rejected with "No voice configured for
  this channel" without it. It is a 69Labs/ElevenLabs voice ID.
- **Host photo** — the identity-lock start frame for talking-host scenes and the
  image HeyGen lip-syncs. It is rehosted onto your R2 up front and treated as a
  required reference, so a broken URL fails the job rather than degrading. The
  second host photo is an optional alternate camera angle; if it fails, the job
  quietly goes single-angle.
- **Book cover / CTA QR** — optional, but setting either one makes the CTA markers
  below **mandatory**. A failed QR rehost is non-fatal; a failed cover is not.
- **Host name / title / location** — the on-screen lower third. All three blank ⇒
  no card is drawn.

### 2. Script format — the CTA markers

The script you paste is voiced **verbatim** as one continuous master narration, and
its duration sets the length of the film. The only markup is a pair of marker lines
fencing each call-to-action block:

```
Most people plant these far too late in the season.

===START CTA===
The rest is in the guide — scan the code on screen.
===END CTA===

Back to the beds themselves.
```

Each marker sits alone on its own line (surrounding spaces/tabs are tolerated,
nothing else is). They are stripped before voicing, so they are never spoken — they
tell the pipeline where the QR overlay and the book-cover reveal go.

- Required as soon as the channel has a book cover or QR configured; submitting
  without them is rejected.
- The script template emits two blocks (mid-roll + close). One works, but logs a
  warning.
- Malformed pairing — unclosed, nested, or a stray `===END CTA===` — is always
  rejected, cover/QR configured or not.

### 3. Music beds (optional)

Music is served from **your own** R2 bucket; no external CDN is contacted at
runtime. Per channel, upload two mp3s:

```
music/beds/<channelKey>/bed-01.mp3
music/beds/<channelKey>/bed-02.mp3
```

`<channelKey>` must match the channel's key exactly, and the set must then be added
to `CHANNEL_MUSIC_BEDS` in `server/musicBeds.ts` — the map is static, nothing lists
the bucket at runtime. Each bed should run **longer than ~170 s**: assembly offsets
every reuse by up to `length − 120 s`, so a shorter bed restarts from the same place
each time it comes back. The mix constraints that actually matter (instrumental, no
percussion, major key, flat dynamics) are documented at the top of that file.

The ten sets already in the map are prefixes for a bucket you don't have. Until you
add your own, each job logs one warning and the film ships narration-only — a
warning, not a failure.

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
  It is required — the app throws rather than encrypting under a default.
  Rotating it invalidates every stored key; you must re-enter them in Admin →
  Provider Keys.
- **Music beds** are served from YOUR R2 (`R2_PUBLIC_URL` +
  `music/beds/<channelKey>/`) — see [Music beds](#3-music-beds-optional). Until
  `R2_PUBLIC_URL` is set and the mp3s are uploaded, films render narration-only
  with a warn. No external CDN is contacted at runtime.
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

# UI harness (dev only)

Mounts a component in isolation with synthetic media so it can be exercised without the
database or providers. Not part of the app build (Vite's build input is `client/index.html`).

    pnpm exec vite --config client/__harness/vite.harness.config.ts --port 5199
    # then open http://localhost:5199/__harness/index.html

`POST /__save {name, dataUrl}` writes an image to `.harness-out/` (gitignored) — used to inspect
canvas output when no screenshot is possible.

`provider-keys.html` → `providerKeys.tsx` mounts the host lip-sync provider/quality switch
with a stubbed tRPC transport, so the HeyGen↔InfiniteTalk toggle, the full-quality
confirmation and the "endpoint not configured" state can be exercised without a database.

`host-minutes.html` → `hostMinutes.tsx` mounts the generate form's "Talking head" step and the
confirm dialog's over-the-guide question, with a script-length slider so both sides of the guide
can be seen (~1,700 words ≈ 10 min, where 5+ min needs confirming; ~3,400 ≈ 20 min, where every
pick fits).

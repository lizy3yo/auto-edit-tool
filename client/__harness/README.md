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
pick fits). An angle-count slider beside it shows the host-photo picker's "too many angles for
these minutes" note (3 min → 2 angles, 7 → 4).

`host-photos.html` → `hostPhotos.tsx` mounts the generate form's "Host photos" picker against a
stubbed `channelHostPhoto` router (list / setSelected / setPrimary) backed by in-page state, so
ticking, the last-ticked guard, "make primary" and the angle guide can be exercised; "Remount"
clears the query cache to prove the ticks come back from the channel, not the component.

`heygen-test.html` → `heygenTest.tsx` mounts the HeyGen test page's panel against a stubbed `heygenTest`
router (plus channel list, host photos and upload), backed by in-page state. Generate adds a batch
that steps voicing → rendering → done on successive polls, so the grid, the poll stopping and
delete can be exercised without a database or a HeyGen credit. A fake EventSource
stands in for the live account stream: the "a film is rendering on" toggles push to it, so the
available-only picker and the all-busy warning can be watched updating in real time.

`host-takes.html` → `hostTakes.tsx` mounts the host take picker (old vs new render of a regenerated
host beat — "Use this take" runs the same `selectHostTake` the edit session does) and the Cost
dialog's host lip-sync lines (first renders / automatic retries / regenerates / retry clicks / past
the limit, with who clicked) against a synthetic board.

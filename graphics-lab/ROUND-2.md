# Round 2: delay, flash at 0:31, flicker, and b-roll fixes

**Scope, as asked:**

- Changed: only the graphics prototype (`graphics-lab/`), plus one new real render of Frederick's film using the other session's look and voice (job 383), plus redraws of off pictures in that job only.
- Not changed: no app code, and job 376 itself.

## 1. The delay: fixed

- **Cause:** the 83 s highlights clip was stitched from separately encoded pieces. Each piece's AAC audio lead-in pushed the sound later at every join: +20 ms at the first, **+140 ms** by the end. That is past the ~125 ms at which lips are seen to move before the voice. The full reel was always frame-exact.
- **Fix:** the clip is now cut in one pass, picture by whole frames and sound by the exact matching samples (1,600 per frame).
- **Measured:** sound against picture is **0 ms on every piece** of both films (18 pieces). The check runs on every build (`highlights-sync.txt`).
- **Also tightened:**
  - Words fade in over 5 frames instead of 7.
  - Big numbers finish counting as the number is spoken, instead of starting then.
  - Cards no longer open more than 0.7 s before showing anything.

## 2. The 0:31 → 0:32 cut, and 3. the flicker: fixed

- **Cause:** graphic edges came from word times and picture cuts from the edit, and the two disagreed by a frame or two. That produced three flashes:
  - At 1:17 (0:32 in the highlights), the VS card ended 2 frames early and the old b-roll flashed.
  - At 2:23 and 3:01, a fade-out brightened the footage for 1–2 frames just before a cut.
- **Fix** (standard practice: graphics follow the picture edit):
  - Every cut is measured off the rendered film.
  - Any graphic edge within 0.5 s of a cut snaps exactly onto it.
  - A graphic ending on a cut leaves with the picture (no fade).
  - A graphic never carries a sub-second tail onto the next shot.
  - Graphics switch on and off with half-frame guards, so rounding can't move them a frame.
  - Full-frame dimming eases in and out.
- **Found and fixed during testing:**
  - Gating by frame number showed every card for one frame only.
  - Remotion merged sample text into settings a cue left empty (a VS card showed the wrong kicker).

## Automatic QA, run on every composite (`qa.md`)

| Check | Job 376 (old film) | Job 383 (new film) |
|---|---|---|
| Flashes the graphics add | 0 | 0 |
| Flicker in the 5 frames before a cut | 0 | 0 |
| Spill under 1 s onto the next shot | 0 | 0 |
| Words on screen vs. heard (worst) | 67 ms (2 frames, deliberately early) | 60 ms |
| Cards waiting over 0.7 s | 0 | 0 |
| Rules (no overlap, nothing in a CTA, cards and dimming only on b-roll) | pass | pass |
| Highlights sound vs. picture | 0 ms | 0 ms |

**Runs:** 5 on the old film and 5 on the new one. Run 4 rendered every graphic from scratch and matched run 3 (74 dB average, 54 dB worst frame; above 50 dB means no visible difference). 15 unit tests pass.

## 4. B-roll pictures: improved, not all fixed

- **Render:** job 383, a real render of the same script using the other session's look (phone look v4) and voice (sentence pauses). It took 31 minutes.
- **Audit:** every shot was checked against the words under it (`out/jobs/383/shots-*.jpg`). 6 pictures were off. They were redrawn through the app's own Regenerate, 11 redraws in all.

| Shot | Line | Result |
|---|---|---|
| #6 | "Grease catches on the stove" | **Fixed**: a pan of grease on fire |
| #20 | "or dual sensor" | **Fixed**: only "Dual Sensor" on the box, beside the alarm |
| #40 | "That number surprises people" | **Fixed**: Frederick from behind writing the year on a blank note |
| #33 | "At 10 years, the unit is finished" | Better: old yellowed alarm beside a new one, but its label print is readable (invented "Model SA-320") |
| #29 | "a sealed 10-year unit" | Nearly unchanged |
| #31 | "wireless models" | Nearly unchanged (same 4-line box) |

**Why the last three resisted:** the app's picture memory hands the image model the earlier pictures of the same key object as references (for #33 and #40 that object is "detector back panel"). It copies their composition and their invented label print, even with an exact typed description, which keeps the memory. Prompts can't fix that; it needs a change in the app's picture-memory code, in files the other session is editing now.

**Spend:** job 383 metered **$7.24** at list rates, render plus all redraws.

**Seen, not touched:** this channel's music bed returns 404, so the film shipped with narration only. The old render did the same.

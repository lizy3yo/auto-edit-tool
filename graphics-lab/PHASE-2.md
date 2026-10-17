# Phase 2: motion graphics built into the app

The app now adds Steve Cooper-style graphics itself. A Generate (or a Reassemble) in the tool produces the finished video with its graphics. The lab (`graphics-lab/`) is now only the studio and test bench.

## How it works in the app

**Where.** One finishing step at the end of assembly (`server/graphics/apply.ts` → `finish.ts`): after the film's loudness is set, before it is uploaded. The saved video carries the graphics.

**What the step does:**
1. **Words:** read from the finished film's own narration, transcribed by the same service voicing uses, and cached by the sound itself. This stays exact after any edit.
2. **Picture cuts:** measured off the film.
3. **Colours:** from the video's own host photo.
4. **Plan:** the saved plan when the video has one, so a Reassemble brings back the same graphics with no model call. Otherwise one Opus call, shown as "Graphics plan" on the Cost dialog.
5. **Render:** each graphic is rendered; text on footage is measured on the real frames and fixed until readable. A graphic that still can't be read is left out, never shipped.
6. **Composite:** one ffmpeg pass lays the graphics on the film. The sound is copied untouched.
7. **QA** on the finished film: flashes, flicker, word sync, lingering, placement, readability. Failures become a warning on the video card.

**It never fails a film.** On any error, or with graphics off, the film ships as assembled, with a warning saying why.

**One copy of every rule.** The templates (29 types), the planner, the placement rules and the QA live in `graphics/src/`. The app and the lab run the same code.

## Controls

- **Admin → Channels → "Motion graphics":** On / Off per channel; on by default (migration 0025).
- **`GRAPHICS=0`:** turns graphics off app-wide.
- **Video card:** shows "Motion graphics: N placed · QA pass", or why there are none.
- **"Re-plan graphics":** writes a fresh plan, behind a confirm (one planning call, about $0.30).
- **Reassemble:** keeps the saved graphics.

## Notes

- **Headless Chrome:** the server downloads it once (113 MB) the first time it renders graphics.
- **Remotion licence:** a company licence is needed for a for-profit company with more than 3 employees before production use.
- **Not covered:** the live cut preview does not show graphics (like the QR card), and single graphics cannot yet be edited on the storyboard.
- **Pre-existing test failures:** the app's test suite has 15 failures that existed before this work (ffmpeg path, Gemini, still fallback, camera plate, one routing test). This work adds none.

## Final test in the tool (2026-10-17)

Each film below was reassembled by the app itself, each with the script its video already had:

| Channel | Job | Graphics placed | Left out | QA |
| --- | --- | --- | --- | --- |
| Frederick | 385 | 21 | 0 | pass |
| Hank | 388 | 8 | 0 | pass |
| Scarlett | 387 | 17 | 0 | pass |
| Dale | 386 | 21 | 0 | pass |

Every graphic was checked by eye on a contact sheet, at `graphics-lab/out/finals/<job>/sheet.jpg`. The films are in the same folders (`film.mp4`).

**Fixes the finals forced (general, any channel):**

- **Readability measured on the words alone.** The readability check now ignores card borders (on a measuring copy), alongside icons and strike lines. A border had been measured as unreadable text, which dropped Scarlett's "not the pendant" and Dale's furniture list.
- **Large numbers get thousands separators.** Numbers are written the way scripts write them: "$10,000", not "$10000". Commas start at 10,000, or at 1,000 for money; a bare four-digit number such as a year stays bare.

**Seen in the finals but outside graphics:**

- **No music bed in any of the four.** Every music bed download returned 404 ("shipping narration-only audio"), so the local bucket has no `music/beds/` files.
- **Hank's voice errors.** At 1:15 the voice says "about four" where the script says "$14", and it reads "10-year" as "one zero year".

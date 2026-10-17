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

## Round 5: the issues found in the finals (2026-10-17)

Every spot reported on the first finals was traced to a cause, fixed as a general rule, and given a test.

| Reported | Cause | Rule now |
| --- | --- | --- |
| Dale 1:06 and 3:04, Hank 1:20: the voice cut off | The sentence-pause step quieted any gap the transcript showed between sentences. The transcriber drops prices, so it erased "$150 to $600", "to $1,500", "to $130" and "of them": 2.5–3.3 s of digital silence. | A gap is only quieted when the audio says it is quiet (`holdsSpeech` in `server/sentencePauses.ts`). |
| Dale 0:26: the caption did not follow the script | The planner was allowed to leave words out, and a caption could stop mid-sentence. | A word-by-word line is the narrator's exact words, in a row (`findVerbatim`). It starts and ends at a natural break (`breakProblem`): a full stop, comma, pause, clause word, or the graphic's own number. |
| Dale 2:56: the caption was late | The transcriber guesses the time of a word written in digits, usually late. | A number is moved back to where the sound says it began (`graphics/src/plan/wordTiming.ts`). It is never moved later, and never across a pause. |
| Dale 1:27, Scarlett 0:58, Hank 1:29: a blink of b-roll after a card | A card left 0.6–0.9 s before the shot change. | A card or window graphic holds to the cut when the shot left would be under 1.5 s. The rest of its own sentence may finish under it. QA checks "Blinks of footage beside a card". |
| Hank 0:31: the list item was late; lists did not hold attention | An item waited for its last word. The text was small and sat at the top beside the picture. | An item appears on its first spoken word, and lands with its picture. Items are 60 px and centred on the picture. Earlier items step back. |
| Scarlett 2:14: the host jumped mid-sentence | Back-to-back host takes were only joined up to 30 s (here 26 s + 6 s). | They are joined up to 60 s (`HOST_JOIN_MAX_SEC`). |

**Found while checking the new films:**

- **Chapter series.** A chapter label that clashes with another new graphic no longer takes the whole series down; the other graphic gives way. Frederick's "On the label" series had been lost this way.
- **Numbers stay readable.** A graphic built around a number opens near it, counts the number as said once its unit is said, and is never cut at a shot change within 0.5 s of its number landing. Hank's "6 hours" had shown for 0.2 s.
- **Planner refusals are logged.** The checks' refusals now appear in the render log ("graphics plan round N: … refused …").

**Second finals** (generated in the tool, then re-assembled with the final code): Dale 389 — 18 graphics, QA pass; Hank 390 — 5 placed, 1 left out (the "6 hours" number read 4.0:1 on its picture, under the 4.5:1 minimum), QA pass; Scarlett 392 — 17, QA pass; Frederick 393 — 16, QA pass. No blinks, no lingering, no erased words in any of the four. Tests: 2,662 pass; the same 15 failures that predate this work.

**Network.** Several runs failed on this connection (`ENOTFOUND` / connect timeouts to R2) and were re-run from where they stopped.

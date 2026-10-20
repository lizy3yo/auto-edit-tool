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

## Round 6: the voice cut-off and the second review (2026-10-17)

| Reported | Cause | Rule now |
| --- | --- | --- |
| Frederick 1:10: "The type." sounded cut off | The clone voices' pause mark makes the provider fill the pause with dead digital silence, and it cuts the sentence's last word to fit. The pause step also quieted from the transcript's end time, to absolute zero, with a 20 ms fade. | No pause mark for any voice. The pause step takes every edge from the sound (`soundEnd` / `soundStart`): 80 ms fades, a breath lowered 30 dB instead of muted, inserted silence at the quietest moment, and sentence ends taken from the script as well. Pause 0.5 s (0.3 s was too short for Scarlett: 3 HeyGen rounds each, `bench/lipsync-pause`). The operator chose this natural pause over the mark. |
| Dale 3:56: the quote cut off | 13 words against a 12-word limit, so the planner stopped at the comma; later it used a caption, which could also stop at a comma. | Statement, Quote, Fact, Myth/Truth, Yes/No **and every caption** show a whole sentence. Captions page a long sentence the way subtitles do (8-10 words a page, `pageStarts`). |
| Scarlett 0:15: "2 inches lower" too short | It ended as soon as its words did. | Reading time: about 1 s + 0.3 s a word (1.5-4 s). It leaves in the next pause within 1 s, else at a word's end, never mid-word. |
| Scarlett 0:20: "the" shown early | The transcriber started the word inside the pause before it. | A word starts where its sound starts (`retimeLateStarts`). |
| Scarlett 0:54: "Polished metal" greyed while said | The verdict came 0.2 s after the side appeared. | The verdict waits until each side's words finish (`saidUntil`), then holds 0.6 s. |
| Hank and others: too few graphics | Nothing asked the planner to fill empty stretches. | A fill round: stretches of 15 s or more with no graphic are offered back, with one repair round (`emptyStretches`). |

**Found while making the finals:**

- **QR codes survive network drops.** A failed address lookup to our own storage is now treated as temporary. Uploads wait up to ~30 s over 6 tries; assembly downloads wait up to ~30 s over 5. A network drop had given Frederick the channel QR instead of the book's.
- **One bad graphic can't wipe out all the graphics.** It is left out, with the reason logged. Timed lines written as plain text are repaired first.
- **Nothing outlasts the film.**
- **A graphic that crosses a shot change stays at least 1 s on the new shot.** This includes chapter labels.

**Third finals** (generated in the tool, graphics re-planned with the final code): Dale 397 (18 graphics), Hank 398 (7), Scarlett 395 (13), Frederick 396 (18). QA passed on all four. No missing words. Abrupt drops into silence per film: 15/2/10/10 before, 2/0/0/1 now. Tests: 2,676 pass, plus the same 15 old failures.

## Round 7: lists, script-based graphics and the host's pose (2026-10-17)

| Reported | Cause | Rule now |
| --- | --- | --- |
| Dale 0:22: an Etsy picture behind "Facebook Marketplace" | The list window stayed up for reading time past its last item's shot, so its window showed the next picture. | A window graphic ends with its last item's picture. |
| Dale 0:54: "ornaments" was not the centre of attention; most of Dale's lists had no graphic | Nothing guaranteed a spoken list its graphic. | Every list the pipeline finds (`inputParams.spokenLists`) is a must-have for the planner. One still missed is built from the list's own words (`missingListCues`) and comes before a new graphic in its way. |
| "No 15 s per graphic" | The fill round offered time stretches. | The fill round offers SENTENCES that hold a moment (a number, comparison, term, warning or step) and have no graphic (`uncoveredMoments`). It goes by the script, never by the clock. |
| Scarlett 2:53: the old card stayed over a new list | Reading time carried a card into the next sentence, and the list had no graphic. | A graphic never runs into the next sentence. Two graphics may follow each other straight away across a shot change. |
| Scarlett: body forward, head twisted away | Nothing said how to hide the face when the body faces the camera. | `HOST_FRAMING_CLAUSE`: the head faces the way the body does. A body facing the camera is framed from the lips or chin down; a body turned away shows the back or side of the head. She is recognisable by hair, skin and clothes. The picture checker's "broken" question names the twisted pose. Scarlett's two such pictures (#21, #25) were redrawn through the tool's Regenerate. |

**Also:** a card holds through pure silence until the picture changes, up to 3.5 s (Dale's "$10 in fees").

**Finals** (graphics re-planned in the tool; only Scarlett's 2 pictures redrawn; no voice or video re-made): Dale 397 (21 graphics), Hank 398 (8), Scarlett 395 (17), Frederick 396 (18). QA passed on all four.

## Round 8: list pictures, list windows and word times that drift (2026-10-18)

| Reported | Cause | Rule now |
| --- | --- | --- |
| Dale 0:53 / 0:54: coasters and ornaments were the same picture | Both list items took the pile of small pieces as their key thing, so both were drawn from that pile picture. Both descriptions also said "round maple and walnut". | A list item is drawn from a key thing's picture only when its own words name that thing, or it is a part of it (`wordsName`, `memorySourcesFor`). Every list item's prompt names the other items of its list, so it is drawn as what makes it different from them (`listItems`, `listItemClause`). |
| Dale 0:18: the "where to sell" window over the cutting-board picture | The window opened on "Today I'm ranking", 1.1 s before the Etsy picture its first item stands for. | A window opens on the cut to its first item's picture (2d in `resolveCues`). |
| Hank 1:19-1:28: captions ahead of the voice | The transcriber put "But once you take out the lumber, that's" 3 s early. It cannot time "$90 to $130" and "$14" by their letters, so it slid the stretch around them. The caption then sat still for 3.7 s while he spoke. | The word times are checked against the sound: speech with no words under it, or a word stretched over a real pause (`driftedStretches`). Such a stretch is heard again on its own and kept only if it says the same words and fits the sound better (`spliceStretch`, `healDrift`). Across the four films it flagged Hank's stretch (fit 0.48 → 0.77, corrected) and one Dale stretch (kept: the second hearing was no better). |

## Round 9: the audit's graphics checks (2026-10-18)

Found by replaying the 12 films that have graphics, not by a viewer. No film changes except where noted.

| Found | Rule now |
| --- | --- |
| The planner was told every spoken list MUST get a graphic, including lists inside the call to action, where no graphic may go (15 of 49 lists) | Only lists outside the CTA are named (`listsWhereGraphicsGo`, the same locate-and-CTA test as `missingListCues`). |
| A graphic could be on screen for 1.27 s (Dale's "3 piles") and still pass QA | Nothing under 1.5 s (`tooShortToRead`): the planner sends it back, a chapter label is raised to 1.5 s, QA fails a shorter one. |
| The planner read each scene's script text; where the film says a line over the next scene, it asked for graphics the rules then refused | The planner reads what the film's sound says over each picture (`wordsSaidOver`), keeping the script's spelling where the words match. |
| A refusal left no trace on the job | The job keeps every planning round (asked, kept, refused), the sentences the fill round offered, and the readability steps (`graphics.planner`, `graphics.readability`); a saved-plan Reassemble carries them over. |
| An overlay left out because its coloured number could not be read | One last, timing-neutral try: the number in the plain text colour (white on the dim ground), judged at 7:1. |

## Round 10: what the new channels' practice films showed (2026-10-18)

Helena Hart (job 399) and Gideon Grant (job 400), reviewed graphic by graphic; every finding re-checked against the frames.

| Found | Rule now |
| --- | --- |
| Myth/Truth: on a two-line myth the strike-through fell between the lines | Every word and space of the myth is struck where it sits, however it wraps (`strikeSweep`). |
| A red dot sat alone before an arrow drew | Nothing of an arrow shows before it has length (`drawnTo`). |
| A caption on a split straddled the seam onto the picture | A caption over a split sits inside the host panel (`hostPanelFor`, registry flag `panel`). |
| A WARNING card showed the thing to avoid as advice ("Ask while the cart is still working its way back,") | A warning's words must say what not to do or what goes wrong (`namesTheDanger`), else another template. |
| A Quote signed with the host's name held words the viewer is told to say | A Quote is the host's own words only; a line handed to the viewer becomes an unsigned caption. |
| A step chain numbered an "or" alternative as the next step | A choice is part of the step before it, never a numbered step. |
| The planner wrote its own list from one sentence ("Two thousand years ago / Seneca wrote a short / Furious") | A list window must be a list the narrator says (`notAListAsSaid`); rows keep the spoken grammar, up to 6 words. |
| QA failed a card the resolver had held to the cut through a pause | QA asks the resolver's own hold rule (`stillUpAfterWords`, `holdToCut`). |
| A soup tin for a soda can; cartoon clock and megaphone | An icon only when one emoji IS the object; otherwise none (every card but IconCallout works without one). |

## Round 11: the seven new channels' practice films (2026-10-18)

Jobs 401-407 (Gary, Gideon, Helena, Luca, Sam, Walter, Werner), reviewed graphic by graphic; every finding re-checked against the frames.

| Found | Rule now |
| --- | --- |
| Cards left a sub-second blink of a shot before the cut (job 403 "The toilet is fine.", job 404's Versus card); QA only reported it | The planner runs QA's own blink check: a card, window graphic or Quote leaving under 1.5 s of a shot is sent back with the reason and a suggestion (a template over the footage, a better line, or none). |
| A Quote showed a drawn face for half a second at its end (job 407) | A Quote blurs the whole picture, so it counts as hiding it: held to the cut, its blinks counted. One list of picture-hiding templates for planner, finishing step, lab and QA. |
| Graphics faded out two frames before a cut (job 404, "flicker") | The resolver and QA measure from the same point (where the sentence finished), so a graphic leaves on the cut with no fade. |
| The host name card fell back to Times on Windows, and a 2.3 s cold open took the card and drew none (jobs 403, 405, 406, 407) | Inter is registered with fontconfig through sharp before any text render and checked by width (`interFontReady`). The card uses the graphics' label style and goes on the intro take, else the first host take that can show it (`nameCardOnWindow`); no host caption is planned under it. |
| The chapter label cut across the host's beard (job 407) and ran past a split's seam (job 402) | Over a host it sits below the chin at 0.8 size (`LAYOUT.belowChinY`); on a split it stays in the host panel; beside the name card it moves bottom-right (`placementFor`). |
| NumberLabel drew "vs" between a range ("$150 to $600") and two prices (job 406) | "vs" only when the words compare the values ("versus", "compared to"…); "to", "up to" or a join on "and"/"or" never; else the plan's `compare` mark. The "vs" comes in with the second value. |
| A list graphic showed two places of three (job 401) | A last item that runs into a closing clause keeps its words up to the clause word. |

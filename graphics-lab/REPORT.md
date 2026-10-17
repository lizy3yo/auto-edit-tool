# Phase 1 report: Steve Cooper–style graphics with Remotion

**Status:** prototype built and tested on a real film of ours (Frederick Barnes, job 376, 3:19). The app is untouched. Everything is in `graphics-lab/`, and nothing goes into the tool until approved.

## 1. What we copied from Steve Cooper, and why it works

Sources: our competitor review of 4 videos (`Talking-heads-review.xlsx`, `Talking-heads-conclusions.xlsx`), plus 28 full-size frames and 6 frame-by-frame sequences pulled from our review copies.

- **One design system.** Navy `#0B192B` card ground with a `#1C283A` centre glow and a faint 120 px grid, one accent blue `#44A3FF`, white bold sans, a small spaced kicker with a short underline, and 3D emoji icons. All colours were *measured* off his frames.
- **Motion follows the voice.** Words appear as they're spoken, numbers count up and settle, and step labels build one by one on the word that names them.
- **Cards replace a picture** exactly where a point is made, and labels on footage tie the picture to the point.
- **Restraint.** 7–9 cards per ~14 min, about 5% of runtime, one blue word at most.

## 2. What was built

14 templates, all on one shared theme:

- **Cards (opaque H.264):** Statement, Myth → Truth, This vs That, Big number (count-up), Step cards, Before → After, Two points.
- **Overlays (ProRes 4444 with alpha):** Chapter label, Step labels, Warning label, Icon labels, Caption over host, Caption over darkened footage, Quote card (footage blurred underneath).

The pipeline is the shape Phase 2 would use:

1. **Word times:** local whisper.cpp (free, no provider). On job 376 the first word of all 38 scenes landed within **0.06 s median, 0.25 s worst** of the app's own WhisperX scene boundaries.
2. **Cue sheet in the script's own words:** a graphic names the words it starts on, ends on and reveals on, never a time. The resolver finds them, tolerating "multi-packs" vs "multipacks", "three" vs "3" and plurals. It refuses any word the narrator never says, so no invented text can reach the screen.
3. **Render** with Remotion 4.0.531 (pinned).
4. **Composite** with the app's own ffmpeg build: cards cover the picture, overlays sit on top, the quote's footage is blurred, and the film's sound is untouched.
5. **Rule check** on the resolved times (below).

## 3. How it was tested: 7 review rounds

| Round | Found | Fixed |
|---|---|---|
| 1 | VS card greyed the "losing" side before the other side was even said. Quote mark rendered as slanted bars. Fog emoji showed as a white square. Uneven step boxes. One-word orphan line. | Verdict waits for the second side. Drawn round quote mark. 👁️ icon. Fixed box height. |
| 2 | Word-matching broke on "multi-packs". A card line bound to a word said *before* the card. | Compound/plural/number-word matching. Phrases searched from the cue start. 11 unit tests. |
| 3 | Rule check: VS card covered 0.6 s of a paid host take; icon labels ran 0.56 s into the CTA. Host caption sat on the chin. "3 minutes" card half empty for 3 s. Quote and darkened caption ran over a host take. | Retimed. Caption moved below the chin. Number card follows speaking order. Darkening overlays held to b-roll. Balanced line wrapping. |
| 4 | Below the chin, the caption hit the host's name tag (Frederick fills the frame down to ~69%). | Rule: no host caption while the name tag is up. Moved to a later host line. |
| 5 | That host line is a split screen, so the caption crossed the seam. | Caption fits inside the host panel on splits. Overlays ending on a cut leave with the picture. |
| 6 | Clean: all rules pass. | Quote signature shown earlier on short quotes. |
| Repeat test ×2 | 3 of 14 templates differed between runs. Traced to 4 parallel render tabs (±1 pixel values), amplified by H.264. | Measured: every frame ≥ 57 dB PSNR, invisible (threshold 50 dB). One tab = bit-identical, at half the speed. |

**Final repeat test** (3 renders of each template): 14/14 visually identical, 13/14 bit-identical. 16–20 frames/s for cards and 13–15 for overlays on this laptop, so the 14 graphics of one film render in about 2–3 minutes. Full table: `out/bench/bench.md`.

**Rules checked on every composite** (`composite.mts`), all passing on the final run:

- No two graphics overlap.
- Nothing inside a CTA block.
- Cards, and overlays that darken or blur, never cover a paid host take.

## 4. Deliverables

- `out/jobs/376/final/highlights.mp4`: about 85 s of Frederick's film around each graphic, with sound.
- `out/jobs/376/final/reel.mp4`: the whole 3:19 film with all 14 graphics.
- `out/jobs/376/final/steve-vs-ours.jpg`: Steve's frame next to ours for 11 kinds of graphic.
- `out/jobs/376/final/sync.txt`: every graphic, the word it waits for and when that word is spoken.
- `pnpm studio`: every template live in Remotion Studio, props editable.

## 5. Not verified / limits

- **Density.** The demo puts 14 graphics in 3:19 to show every template. Steve runs about 1 card per 1.6–2 min plus about 1 label per minute. Phase 2's planner must be held to his density.
- **Word times.** On this film they come from local Whisper, not the app's WhisperX. Phase 2 should keep the WhisperX words at voicing (today they're thrown away) rather than transcribe twice.
- **Split-screen panel width** (840 px) was measured off this film, not read from the app's split layout.
- **Watching on a phone.** Not tested: text sizes were matched to Steve's 1080p frames only.
- **Licence.** Remotion needs a paid company licence for a for-profit company with more than 3 employees before production use.
- **Server.** Remotion runs headless Chrome (about 100 MB, downloaded on first render), which the production host must allow.

## 6. Phase 2 (only after approval)

1. **Keep the word times** from voicing (`words` on the job).
2. **A planner step** (one Claude call on the final storyboard) writes the cue sheet in script words, held to Steve's density and to the rules in §3. `cueResolve.ts` anchors it unchanged.
3. **Render** the graphics once per job through the assembly cache (keyed on props, which repeatability makes safe).
4. **Composite in `buildSceneMuxArgs`** above the phone look (crisp, like the QR). A card stands in for a b-roll still, saving a picture.
5. **Preview:** the cut preview shows the same templates through `@remotion/player`.
6. **Storyboard:** operators can edit, swap or remove a graphic.
7. **Settings:** a per-channel switch and accent colour, plus `GRAPHICS=0` to turn everything off.

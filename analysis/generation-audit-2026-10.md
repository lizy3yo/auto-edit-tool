# Generation audit: every video, Oct 1–16 2026

Read only, from production (your Chrome session). Nothing in the app was clicked, and no paid API was used:
all checks ran locally or by looking at frames.

## What was checked

| Check | Coverage | Method |
|---|---|---|
| Every shipped clip, picture vs its line | 139 videos, 24,400 clips | One frame per still/host/split, three frames (start/middle/end) per b-roll video, read against the narration line and its neighbours |
| Technical scan of moving clips | 4,341 host, split and b-roll clips | ffmpeg: black frames, frozen stretches, hard jumps, clip length vs line |
| Voice vs script | in progress (free local speech-to-text); 11 videos fully checked | Transcript aligned word by word to the script, every flagged spot re-checked on its own scene audio with a larger model |
| Pipeline data | every scene: renders, retries, picture checks, warnings, operator redos | Read from the job records |

Accuracy of the visual review: I checked 48 random flags myself; 46–47 are real (about 96% precise).
A blind test against operator redos showed that operator redos are not a clean answer key: about 40% of
redraws look nearly identical to the original, and pictures operators accepted carry errors at the normal rate.

## Headline numbers

- **4,165 of 24,400 shipped clips (17.1%) have a visible error**, 733 of them clearly noticeable.
- **Operators caught 286 of those 4,165.** Most errors ship unnoticed.
- The rate was flat every week (16–18%): the October changes did not move it.
- Host lip-sync clips are technically clean (no black frames; 1 freeze).
- Voice: no confirmed misread word so far. One real script problem (below).

## Errors by cause (each clip counted once, by its first cause)

| # | Cause | Clips | Severe | Where it comes from |
|---|---|---|---|---|
| 1 | Line's specific detail missing (named object, person, state, place) | ~1,060 | — | The picture is judged against the planner's paraphrase (`showSubject`), not the line; when the paraphrase drops the detail, nothing catches it |
| 2 | Near-identical to the picture next to it | 759 | 48 | List items and same-topic runs drawn from the same memory; split panels reuse the previous picture's description (`enforceHostSplitMix` copies `brollVisual`); near-copy check not on `main` |
| 3 | Key thing changes look (colour, shape, breed, material) | 490 | 80 | Memory not attached to every picture of the thing; a wrong first picture is copied by every later one (job 242: "pine block" drawn as a black metal rack ~100 times) |
| 4 | Build step shows the finished piece | 464 | 121 | Picture memory references the first/latest picture of the thing (usually the finished hook shot); there is no notion of the build stage |
| 5 | Host drawn as someone else, twice in one frame, or face shown | 400 | 147 | Any person without the planner's `other` flag becomes the host (`SHOWS_PERSON` → host photo); burglar, stylist, client, passenger, customer all become the host |
| 6 | Invented readable text, the video's own title, fake QR codes | 194 | 64 | The raw title goes into every picture prompt (`amateurSettingClause`); `textyFallback` ships the picture when writing persists |
| 7 | Physically wrong: tool use, floating objects, wrong mechanism | 168 | 41 | Image-model limits; the check flags some but the fallback ships them |
| 8 | "Don't / never / instead" drawn as doing it | 132 | 49 | No negation handling anywhere; `showSubject` names the forbidden action |
| 9 | A look shown from behind / on a hanger (beauty & fashion) | 137 | 21 | The "host face never shown" rule makes face/fit/colour lines unshowable |
| 10 | Fault or "after" state drawn as the ideal or "before" | ~115 | 24 | Memory copies the earlier state; the planner names the object, not its state |
| 11 | Wrong person missing (line names a person; picture has none) | ~105 | 14 | Detail dropped in paraphrase (cause 1) |
| 12 | Phone/laptop screen shows a shopping grid | 52+ | 17 | `APP_SCREEN` clause fires on any "app"/"phone screen" and forces "a buy-and-sell app" |
| 13 | Split screen shipped with no picture panel | 49 | — | `composeHostScene` catch falls back to the host take with only a console warning |
| 14 | Video clip morphs | 23 | 13 | Clip glitch check misses slow morphs |
| 15 | Collage (two panels in one picture) | 8 | 7 | Not in the picture check |

Concentration: causes 5, 9 and mirrors are almost all on Scarlett, Diane and Helena (looks and persona channels).
Cause 4 is all build/how-to videos (Hank, Dale, Pearl, Granny, Ruth, Brenda).

## Other problems found in the data

- **Script notes read aloud (jobs 204, 205):** the pasted script carried a QA report ("VERDICT: PASS…",
  "VO COPY — ELEVENLABS V4") and a second full copy of the script. Both were voiced; the film plays twice.
  Nothing checks the script for this at Generate.
- **26 zero-length scenes** in 19 videos: a picture with no narration under it, shown as a 0.5 s flash.
- **21 of 139 videos end on a host shot under 1 second** (the final goodbye beat).
- **False list cuts:** "six and a half", "give or take", "quick and quiet", "too" cut into list items, each
  with its own picture (`namesAThing` accepts numbers and any ≤3-word phrase).
- **Paid video wasted:** 169 of 656 b-roll videos (26%) were rendered once or twice then thrown away as a
  still; 54 of 412 shipped videos are more than half frozen (they look like stills).
- **Pictures shipped knowing they failed a check:** about 9% of pictures (mostly "does not show the subject",
  "readable writing", "staged") ship after the redraws run out.

## Proposed general rules (for "go")

All are generation rules, not per-channel patches. Each gets a test built from the real cases above.

| Rule | Fixes causes | Cost |
|---|---|---|
| R1. Judge every picture against the **line**, not only the paraphrase: the existing still check gets the line's concrete nouns, people and states as its "must show" list | 1, 10, 11 | none (same call) |
| R2. **Build stage**: the planner marks each step picture's stage; memory references only pictures at the same or an earlier stage; the prompt says the stage | 4, part of 3 | none |
| R3. **One fixed look per key thing**, written from the script before drawing; the first picture is checked against it before anything copies it; every picture of the thing (incl. split panels, list items) gets memory | 3, 10 | ~5 small checks per video (≈$0.02) |
| R4. **Who is in the picture**: a named role (burglar, stylist, client, buyer, passenger, agent, neighbour…) is another person; never two people drawn from the host photo; mirrors removed at every prompt build; the existing check also asks "is a face shown / two copies of one person" | 5, mirrors | none |
| R5. **Negation**: a "don't/never/instead/avoid" line shows the right way or the thing alone; the check asks "does it show the forbidden action" | 8 | none |
| R6. **No title, no fake QR, no invented text**: the title never enters a picture prompt (topic noun only); "no QR codes or book covers" in every picture; persistent writing → redraw without screens/papers/signs instead of shipping | 6 | ≈ +0.2 images/video |
| R7. **Screens show what the line says** (map, message, camera, booking, settings); the shopping grid only for selling lines | 12 | none |
| R8. **Near-copies**: deploy the branch's near-copy check; split panels and list items get their own description and view | 2 | existing |
| R9. **Never ship a known-bad picture**: after the last redraw, draw once more as a simpler, wider, person-free shot instead of shipping the flagged frame | 1, 6, 7 | ≈ +0.3 images/video |
| R10. **Split panel must exist**: retry the panel once, then warn on the job; never silently ship host-only | 13 | none |
| R11. **No zero-length or sub-second scenes**: fold after the last re-cut; the closing beat joins the previous host take | flashes | none |
| R12. **List items must be things**: no numbers continuing a quantity, fixed phrases, or adverb pairs | false lists | none |
| R13. **Script check at Generate**: refuse metadata lines (ALL-CAPS label + colon) and a repeated script, with the line named | voiced notes | none |
| R14. **Video lane**: one render; if it glitches or barely moves, use the still | wasted video | saves ≈$0.50/video |
| R15. **Redo must differ** from the scene's earlier takes | operator redo loops | none |

Net cost: about the same or lower per video (R14 saves more than R3/R6/R9 add).

## Decision needed

- **Looks lines (beauty and fashion channels):** with the face hidden, lines about how a cut, colour or neckline
  looks on the face cannot be shown (cause 9). Options: show the host's face for those lines (from her photo,
  with the identity check already on this branch), or show an anonymous woman of the audience's age.

## How the fixes will be tested

1. Unit tests from the real failing cases (each rule).
2. Replay the text rules (R4, R5, R6, R7, R11, R12, R13) over all 139 stored storyboards and count which
   flagged clips each rule would have changed, and how many clean clips it would wrongly touch.
3. A practice render (stills only) on the worst channels before shipping; asks first, costs a few dollars.

Raw data: scratchpad `results/*.tsv` (one line per flagged clip), `data/tech.jsonl`, `data/voice*.json`.

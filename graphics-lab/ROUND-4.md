# Round 4: every Steve Cooper graphic, as general rules, readable on any picture

**Asked:**
1. All the graphics in the Steve Cooper analysis.
2. Text that is unreadable over the picture must not happen.
3. Nothing lost between versions.
4. Everything adaptable: any channel, any script, each graphic reused whenever the script calls for it.

**Scope:** only `graphics-lab/`. No app code. No new renders: tested on three finished films (Frederick 385, Hank 382, Ruth 350).

## 1. Every graphic in the analysis (29)

The competitor review's "Steve Cooper" sheet counts every graphic in four of his videos.

- **14 were already built.**
- **15 are new** (`src/more.tsx`):
  - opening title with one blue word, small label, big number over darkened footage, number label (two values), bar chart;
  - checklist (ticks as each item is said), crossed-out list, red MYTH stamp;
  - yes/no answer card, fact card;
  - term in a window, list in a window, host in a window beside a list;
  - caption with an arrow to the subject, icon callout.
- **Left out on purpose**, because the app already does them: the book offer card (the app's CTA) and the host beside a picture (split screens).

All 29 use the same building blocks and the channel's own colours. The gallery shows each one.

## 2. Readable on the real picture (the error in the screenshot)

**The standard is WCAG contrast**, measured on the real rendered frames at the end of every shot a graphic crosses:
- white text 7:1 (the AAA level, because footage is busier than a page);
- coloured words 4.5:1 (AA).

**When a graphic fails**, it is fixed in this order, and each step is re-rendered and re-measured, never assumed:
1. darker behind the words;
2. a lighter shade of the coloured words;
3. moved to the calmest part of the picture, off its subject.

**Arrows** point at the picture's subject, found from where the frame's detail is.

**How the measurement was made right**: each problem was reproduced as a unit test first.
- A letter's own soft edges were being counted as the background; now they aren't.
- A label's accent border, against the picture outside its plate, was being counted as reading; now it isn't.
- An emoji was being judged as text; now only the theme's own text colours count.

## 3. Graphics appear whenever the script calls for them

**No quota.**
- Each of the 29 has one condition, written as what a line *does*: compares two things, says a number, gives steps, corrects a belief, names a term, asks yes/no, and so on.
- It is placed every time a line meets it. The old limits ("2 cards", "one quote", "not twice in a row") are gone.

**Shared rules for every graphic** (`scripts/rules.mts`):
- only the narrator's words;
- nothing over the host's face or in the CTA;
- cards and picture graphics only over b-roll;
- 1 s between graphics;
- readable text.

**New checks**, all general:
- **Every number shown must be said** while the graphic is up. Spoken numbers in words ("twenty-five") are matched to digits ("25"), either way round.
- **No graphic sits still more than 5 s** between its own words. Hank's number graphic had waited 9 s.
- **A currency sign goes before its number.**

## 4. Nothing lost

- **Saved graphics are a fixed base.** `--keep <sheet>` places a film's approved graphics first, in order. A new graphic only joins where it adds no conflict.
- **New rules can't drop a saved graphic.** A saved graphic is never removed by a rule added after it was approved.
- **On Frederick, all 16 approved graphics are kept**, including "It isn't broken. It isn't dead." and "You'll know three things printed on the box".

## 5. QA corrections found while testing

- **Stale QA cache.** The frame-difference cache was keyed by file name. A reel rewritten under the same name was judged on the old reel. It is now keyed by file version.
- **Fades are not flashes.** A darkening graphic leaving over 12 frames is no longer counted as a flash when no picture cut is near.
- **Darkening graphics leave smoothly.** They now ease out the way they ease in.
- **Labels may start on the shot change.** A label moved onto the shot change of the picture it names is listed as aligned (the subtitling shot-change rule), not out of sync.

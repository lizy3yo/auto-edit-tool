# Round 3: graphics that leave on time, colours from the host, automatic placement

**Asked:** (1) a graphic stayed after its words were done (job 384, 0:10-0:13: "It isn't broken. It
isn't dead." stayed into the next line); (2) colours that follow the host photo; (3) contents that
adapt to each script; (4) a new film with the other session's body fix.

**Scope:** only `graphics-lab/`, plus one new real render (job 385). No app code changed.

## 1. A graphic leaves when its words are done

- **Rule:** a graphic stays at most 0.8 s after the last word it shows, and at least 1.5 s in all so
  a short line can be read. Chapter titles keep their planned length (they are titles, not captions).
- **Fixed text** (a VS side's "The slow one") names the spoken words it stands for (`say`), so it
  leaves when those are said.
- **Hand-off:** when the next graphic starts less than 1 s later, this one leaves early, on a fade,
  but never before its own last word has had 0.3 s.
- **Cuts:** an edge still snaps onto a picture cut within 0.5 s, but never forward past 1.2 s after
  the last word (the QA limit).
- **Cards never open empty:** a full-screen card that would show a blank ground for more than 0.7 s
  starts 0.3 s before its first word instead (or on a cut just before it).
- **Checked on every composite:** "Graphics still up more than 1.2 s after their own words".

## 2. Colours from the host photo

- **Method:** Google's Material Color Utilities (Apache-2.0, the engine behind Android's "Material
  You"). The photo's colours are clustered, skin and greys are left out, and the clusters vote by
  hue (share of the photo × colour strength). The winner becomes a tonal palette: the card ground,
  glow and accent are all tones of that one hue, so they belong together.
- **Why a vote:** one shirt comes back as many small shades. Frederick's navy tee was 7 shades of
  2-4% each (~20% together), and Material's own scorer picked the grey wall instead.
- **Readability is guaranteed:** every text colour is pushed to the tone that meets its WCAG minimum
  on the card ground (body 7:1, accent 4.5:1, quiet text 3:1, accent on a label plate 3:1).
- **Red is kept for warnings:** a red source (a red flannel, a red scarf) becomes a warm orange.
- **No usable colour** (a grey shirt in a grey room) keeps Steve's navy and blue.
- **Tested on all 12 channels:** every one meets every minimum. Accents: navy-blue (Frederick,
  Lance), sky blue (Beau, Brenda, Pearl), orange (Hank, Scarlett, Mae, Dale), lavender (Ruth),
  green (Diane), default (Norbert). Swatches: `out/jobs/<job>/theme-swatch.png`.

## 3. Contents adapt to each script: the planner

`scripts/plan.mts`: one Claude Opus call reads the film scene by scene (what is on screen, what is
said, where the b-roll stretches and the call to action are) and writes the cue sheet. Nothing it
writes is trusted:

- every cue is resolved against the real word times (no word on screen the narrator doesn't say);
- every cue is held to the same rules the composite checks (`scripts/rules.mts`, one copy for both):
  no overlap, nothing in the CTA, cards and darkening overlays only over b-roll, no host caption
  while the name tag is up, 1 s between graphics;
- Steve's density: about 1 card per 1.6 min and 1 label per minute, at most 3 host captions;
- a shown line must read as a whole thought (starts a sentence or clause);
- chapter labels are all or none ("2 of 3" alone is a broken promise);
- emoji are fetched from Noto (pinned v2.047) on first use;
- whatever fails goes back for ONE repair round; whatever still fails is dropped.

Rehearsed on job 384: 9 written, 8 kept, composite QA PASS with no hand edits.

## 4. The new film: job 385

- **Render:** Frederick's script through the app with the other session's body fix (level head,
  phone-look v4 photo), 3:33, -14.1 LUFS. One app note: the music bed was missing from local R2
  (404), so the film is narration only — app-side, not touched here.
- **Colours:** Frederick's navy tee → ground `#161a21`, accent `#7ca6f5` (all contrast minimums met).
- **Planner:** 9 graphics, all passing on the first round: a darkened caption on the hook, the
  "3 minutes" number card, three chapter labels (1-3 of 3), step cards, icon labels, one host
  caption, and "Smoke alarms expire" at the end.
- **QA: PASS.** No flashes, no flicker, no spills, nothing lingering, nothing waiting empty, words
  on screen within 67 ms of the voice, all rules pass. Highlights: 8 pieces, sound vs picture 0 ms.
- **Caught by eye on the first pass, fixed in code and re-run:**
  - the VS card opened with its first side already greyed: the "never open empty" rule moved it,
    not counting a side shown from the start. A card already showing something now stays put
    (unit-tested);
  - two warning labels of 18-19 words read like subtitles (one stayed 11.5 s). Hard word limits per
    template now (warning 10, host caption 8, statement 10, quote 12), enforced in code.
- **Varies by run:** the planner is a model; two runs on the same film chose different, equally
  valid mixes. Every run is held to the same checks.

## 5. Other fixes found while testing

- **Number card:** a line that wrapped to two rows ran under the big number. Number and line are
  now one stacked column.
- **"10-year" read as "one zero year":** the transcript of both Frederick films has the voice saying
  "a sealed one zero year unit" (the two words take about a second). The matcher now accepts a
  number read digit by digit. The voice itself is app-side and not changed here.

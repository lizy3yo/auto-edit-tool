import { describe, it, expect } from "vitest";
import {
  assignSceneRanges,
  implausibleScenes,
  newAlignmentReport,
  repairImplausibleRuns,
  tokenizeNarration,
} from "./narrationAlignment";
import type { WhisperWord } from "./_core/voiceTranscription";
import type { StoryboardScene } from "../shared/types";

const scene = (scriptText: string, index: number): StoryboardScene => ({
  index,
  narration: scriptText.slice(0, 20),
  scriptText,
  visualPrompt: "",
  hostPresent: false,
});

const hostScene = (scriptText: string, index: number): StoryboardScene => ({
  ...scene(scriptText, index),
  hostPresent: true,
});

const w = (word: string, start: number, end: number): WhisperWord => ({
  word,
  start,
  end,
});

/** Ranges must tile [0, dur] in order: start at 0, end at dur, contiguous, non-decreasing. */
function expectTiles(
  ranges: { startSec: number; endSec: number }[],
  dur: number
) {
  expect(ranges[0].startSec).toBeCloseTo(0, 5);
  expect(ranges[ranges.length - 1].endSec).toBeCloseTo(dur, 5);
  for (let i = 0; i < ranges.length; i++) {
    expect(ranges[i].endSec).toBeGreaterThanOrEqual(ranges[i].startSec);
    if (i > 0) expect(ranges[i].startSec).toBeCloseTo(ranges[i - 1].endSec, 5);
  }
}

describe("tokenizeNarration", () => {
  it("keeps digits as one token and strips punctuation/edge apostrophes", () => {
    expect(tokenizeNarration("It was 2024, wasn't it?")).toEqual([
      "it",
      "was",
      "2024",
      "wasn't",
      "it",
    ]);
  });
});

describe("assignSceneRanges", () => {
  it("aligns clean 1:1 word→token and cuts at the next scene's first word", () => {
    const scenes = [
      scene("Hello there friends.", 1),
      scene("Today we plant tomatoes.", 2),
      scene("Water them well.", 3),
    ];
    const words = [
      w("Hello", 0.0, 0.4),
      w("there", 0.4, 0.7),
      w("friends", 0.7, 1.1),
      w("Today", 1.3, 1.6),
      w("we", 1.6, 1.8),
      w("plant", 1.8, 2.2),
      w("tomatoes", 2.2, 2.9),
      w("Water", 3.1, 3.4),
      w("them", 3.4, 3.6),
      w("well", 3.6, 4.0),
    ];
    const dur = 4.2;
    const ranges = assignSceneRanges(scenes, words, dur);

    expectTiles(ranges, dur);
    // Boundary 1 = next scene's first word onset (Today.start) = 1.3
    expect(ranges[0].endSec).toBeCloseTo(1.3, 5);
    // Boundary 2 = next scene's first word onset (Water.start) = 3.1
    expect(ranges[1].endSec).toBeCloseTo(3.1, 5);
    // audioDuration is set as a side effect (band helpers read it).
    expect(scenes[0].audioDuration).toBeCloseTo(1.3, 5);
    expect(scenes[1].audioDuration).toBeCloseTo(1.8, 5);
    expect(scenes[2].audioDuration).toBeCloseTo(1.1, 5);
  });

  it("re-syncs across Whisper-inserted words so the boundary stays correct", () => {
    const scenes = [
      scene("Plant the seeds now.", 1),
      scene("Then wait patiently.", 2),
    ];
    // Whisper doubled "the" — an extra word the script doesn't have.
    const words = [
      w("plant", 0.0, 0.4),
      w("the", 0.4, 0.6),
      w("the", 0.6, 0.8),
      w("seeds", 0.8, 1.2),
      w("now", 1.2, 1.5),
      w("then", 1.7, 2.0),
      w("wait", 2.0, 2.3),
      w("patiently", 2.3, 2.9),
    ];
    const dur = 3.1;
    const ranges = assignSceneRanges(scenes, words, dur);

    expectTiles(ranges, dur);
    // The extra "the" is absorbed into scene 1; boundary = then.start (next word onset).
    expect(ranges[0].endSec).toBeCloseTo(1.7, 5);
  });

  it("falls back to a proportional (by word count) split when there are no word timings", () => {
    const scenes = [
      scene("one two three four", 1), // 4 words
      scene("five six", 2), // 2 words
    ];
    const dur = 6;
    const ranges = assignSceneRanges(scenes, null, dur);

    expectTiles(ranges, dur);
    // 4:2 word split of 6s → 4s / 2s.
    expect(ranges[0].endSec).toBeCloseTo(4, 5);
    expect(scenes[0].audioDuration).toBeCloseTo(4, 5);
    expect(scenes[1].audioDuration).toBeCloseTo(2, 5);
  });

  it("returns an empty array for no scenes", () => {
    expect(assignSceneRanges([], null, 10)).toEqual([]);
  });

  it("keeps a cut already inside a pause; pulls one just outside onto the pause edge", () => {
    const scenes = [
      scene("Hello there friends.", 1),
      scene("Today we plant tomatoes.", 2),
      scene("Water them well.", 3),
    ];
    const words = [
      w("Hello", 0.0, 0.4),
      w("there", 0.4, 0.7),
      w("friends", 0.7, 1.1),
      w("Today", 1.3, 1.6),
      w("we", 1.6, 1.8),
      w("plant", 1.8, 2.2),
      w("tomatoes", 2.2, 2.9),
      w("Water", 3.3, 3.6),
      w("them", 3.6, 3.8),
      w("well", 3.8, 4.2),
    ];
    // First cut (1.3) already sits inside the measured pause → stays exactly where it is.
    // Second cut (3.3, Whisper onset ran late) sits past its pause → pulled back onto the
    // pause's usable edge (end − 40ms margin), not all the way to the center.
    const silences = [
      { start: 1.15, end: 1.35 },
      { start: 2.95, end: 3.15 },
    ];
    const ranges = assignSceneRanges(scenes, words, 4.4, silences);

    expectTiles(ranges, 4.4);
    expect(ranges[0].endSec).toBeCloseTo(1.3, 5);
    expect(ranges[1].endSec).toBeCloseTo(3.11, 5);
  });

  it("snaps onto a long pause that ends just before the cut (center out of tolerance)", () => {
    // Production job 75: a 1.53s pause ended 43ms before the boundary, but its CENTER was 0.81s
    // away — the old center-distance metric rejected it and the cut stayed mid-word.
    const scenes = [
      scene("Hello there friends.", 1),
      scene("Today we plant tomatoes.", 2),
    ];
    const words = [
      w("Hello", 0.0, 0.4),
      w("there", 0.4, 0.7),
      w("friends", 0.7, 1.1),
      w("Today", 2.7, 3.0),
      w("we", 3.0, 3.2),
      w("plant", 3.2, 3.6),
      w("tomatoes", 3.6, 4.3),
    ];
    const silences = [{ start: 1.1, end: 2.66 }]; // center 1.88, 0.82s from the 2.7 cut
    const ranges = assignSceneRanges(scenes, words, 4.5, silences);

    expectTiles(ranges, 4.5);
    expect(ranges[0].endSec).toBeCloseTo(2.62, 5); // sil.end − 40ms margin
  });

  it("uses a pause hidden inside the previous word's sloppy Whisper span", () => {
    // Whisper claimed "friends" runs 0.7→1.45, straight through the real 1.1–1.35 pause (ends
    // run late through pauses). The old [prevEnd, nextStart] clamp rejected the pause; the snap
    // window now spans the neighbor words, so the cut lands in the real pause instead of
    // mid-"Today".
    const scenes = [
      scene("Hello there friends.", 1),
      scene("Today we plant tomatoes.", 2),
    ];
    const words = [
      w("Hello", 0.0, 0.4),
      w("there", 0.4, 0.7),
      w("friends", 0.7, 1.45),
      w("Today", 1.5, 1.8),
      w("we", 1.8, 2.0),
      w("plant", 2.0, 2.4),
      w("tomatoes", 2.4, 3.1),
    ];
    const silences = [{ start: 1.1, end: 1.35 }];
    const ranges = assignSceneRanges(scenes, words, 3.3, silences);

    expectTiles(ranges, 3.3);
    expect(ranges[0].endSec).toBeCloseTo(1.31, 5); // inside the real pause (end − 40ms)
  });

  it("falls back to the short-gap scan only when no real pause qualifies", () => {
    const scenes = [
      scene("Hello there friends.", 1),
      scene("Today we plant tomatoes.", 2),
    ];
    const words = [
      w("Hello", 0.0, 0.4),
      w("there", 0.4, 0.7),
      w("friends", 0.7, 1.1),
      w("Today", 1.3, 1.6),
      w("we", 1.6, 1.8),
      w("plant", 1.8, 2.2),
      w("tomatoes", 2.2, 2.9),
    ];
    const shortSilences = [{ start: 1.15, end: 1.21 }]; // 60ms gap — invisible to the 0.12s scan
    // No tier-1 pause anywhere near the cut → the 60ms inter-word gap hosts it (sub-80ms → center).
    const fallback = assignSceneRanges(
      scenes,
      words,
      3.1,
      [{ start: 0.0, end: 0.05 }],
      shortSilences
    );
    expectTiles(fallback, 3.1);
    expect(fallback[0].endSec).toBeCloseTo(1.18, 5);

    // A qualifying tier-1 pause wins even when the short gap is closer to the raw cut.
    const tier1 = assignSceneRanges(
      scenes,
      words,
      3.1,
      [{ start: 1.11, end: 1.29 }],
      [{ start: 1.29, end: 1.35 }]
    );
    expectTiles(tier1, 3.1);
    expect(tier1[0].endSec).toBeCloseTo(1.25, 5); // clamp hits tier-1's end − 40ms margin
  });

  it("gives one pause to only the closest cut, so scenes stay strictly ordered", () => {
    // Proportional boundaries at 3 and 4 (tokens 3:1:3 over 7s); one pause at 3.4–3.6 is within
    // tolerance of BOTH — only the closer (tie → first) snaps onto its usable edge (start + 40ms
    // margin), the other keeps its spot.
    const scenes = [
      scene("one two three", 1),
      scene("four", 2),
      scene("five six seven", 3),
    ];
    const silences = [{ start: 3.4, end: 3.6 }];
    const ranges = assignSceneRanges(scenes, null, 7, silences);

    expectTiles(ranges, 7);
    expect(ranges[0].endSec).toBeCloseTo(3.44, 5); // first cut snapped
    expect(ranges[1].endSec).toBeCloseTo(4, 5); // second cut unchanged (no collision)
    expect(ranges[1].endSec).toBeGreaterThan(ranges[0].endSec); // no zero-length scene
  });

  it("leaves a cut alone when no pause is within tolerance", () => {
    const scenes = [
      scene("Hello there friends.", 1),
      scene("Today we plant tomatoes.", 2),
    ];
    const words = [
      w("Hello", 0.0, 0.4),
      w("there", 0.4, 0.7),
      w("friends", 0.7, 1.1),
      w("Today", 1.3, 1.6),
      w("we", 1.6, 1.8),
      w("plant", 1.8, 2.2),
      w("tomatoes", 2.2, 2.9),
    ];
    const silences = [{ start: 0.0, end: 0.05 }]; // far from the 1.3 word-onset cut
    const ranges = assignSceneRanges(scenes, words, 3.1, silences);

    expectTiles(ranges, 3.1);
    expect(ranges[0].endSec).toBeCloseTo(1.3, 5); // unchanged
  });

  // give(0-0.3) them(0.3-0.6) water(0.6-1.0) [breath 1.0-1.6] now(1.6-1.9) | mulch(2.0-2.3)...
  // The breath (center 1.3) sits INSIDE the host's speech, before its last word "now".
  const breathWords = [
    w("give", 0.0, 0.3),
    w("them", 0.3, 0.6),
    w("water", 0.6, 1.0),
    w("now", 1.6, 1.9),
    w("mulch", 2.0, 2.3),
    w("the", 2.3, 2.5),
    w("beds", 2.5, 2.9),
  ];

  it("does NOT let a mid-sentence host breath capture the boundary (host stays whole)", () => {
    const scenes = [
      hostScene("Give them water now.", 1),
      scene("Mulch the beds.", 2),
    ];
    const silences = [{ start: 1.0, end: 1.6 }]; // center 1.3, within 0.75 of the 1.95 midpoint
    const ranges = assignSceneRanges(scenes, breathWords, 3.1, silences);

    expectTiles(ranges, 3.1);
    // Cut sits at nextStart (mulch.start 2.0); the breath at 1.3 is rejected (outside the gap).
    // Before the gap clamp this snapped to 1.3, clipping "now" off the host into the next scene.
    expect(ranges[0].endSec).toBeCloseTo(2.0, 5);
  });

  it("clamps the snap to the inter-word gap for b-roll scenes too", () => {
    const scenes = [
      scene("Give them water now.", 1), // both b-roll
      scene("Mulch the beds.", 2),
    ];
    const silences = [{ start: 1.0, end: 1.6 }]; // same breath as above
    const ranges = assignSceneRanges(scenes, breathWords, 3.1, silences);

    expectTiles(ranges, 3.1);
    // Cut at mulch.start 2.0; the breath at 1.3 is out of gap → no snap.
    expect(ranges[0].endSec).toBeCloseTo(2.0, 5);
  });

  it("puts every outgoing cut at the next word's start (scene keeps its trailing pause)", () => {
    // Wide gap now(1.5) → mulch(2.4): the outgoing scene keeps the whole 0.9s pause after its
    // last word — Whisper `end` timestamps run early, so cutting inside the gap chops word tails.
    const words = [
      w("give", 0.0, 0.3),
      w("them", 0.3, 0.6),
      w("water", 0.6, 1.0),
      w("now", 1.0, 1.5),
      w("mulch", 2.4, 2.7),
      w("the", 2.7, 2.9),
      w("beds", 2.9, 3.4),
    ];
    const host = assignSceneRanges(
      [hostScene("Give them water now.", 1), scene("Mulch the beds.", 2)],
      words,
      3.6
    );
    expectTiles(host, 3.6);
    expect(host[0].endSec).toBeCloseTo(2.4, 5); // nextStart

    // Register-agnostic: a b-roll outgoing scene gets the same cut.
    const broll = assignSceneRanges(
      [scene("Give them water now.", 1), scene("Mulch the beds.", 2)],
      words,
      3.6
    );
    expect(broll[0].endSec).toBeCloseTo(2.4, 5);
  });

  // ── CTA anchoring: the QR block's boundaries must pin to the spoken trigger/release phrases,
  // even when the greedy cursor drifted before the block (e.g. TTS spoke unscripted words).
  const qrScene = (scriptText: string, index: number): StoryboardScene => ({
    ...scene(scriptText, index),
    qrHero: true,
  });
  /** Equal-paced words: word i spans [i*0.5, i*0.5+0.4]. */
  const paced = (text: string): WhisperWord[] =>
    text.split(/\s+/).map((word, i) => w(word, i * 0.5, i * 0.5 + 0.4));

  const INTRO = "the garden is lovely today my friends";
  const RAMBLE = "um well you know let me just think"; // spoken, in no scene's script
  const TRIGGER = "now go ahead and grab your phone";
  const RELEASE = "take your time i'll wait right here";
  const OUTRO = "back out to the garden we go";

  const ctaScenes = () => [
    scene(INTRO, 1),
    { ...qrScene(TRIGGER, 2) },
    { ...qrScene(RELEASE, 3), qrTail: true },
    scene(OUTRO, 4),
  ];
  // 7 intro + 8 ramble = trigger starts at word 15, release at 22..28 (end 29), outro at 29.
  const ctaWords = paced(
    `${INTRO} ${RAMBLE} ${TRIGGER} ${RELEASE.replace("i'll", "I'll")} ${OUTRO}`
  );
  const ctaDur = ctaWords[ctaWords.length - 1].end + 0.2;

  it("pins the QR block start to the spoken trigger phrase despite unscripted drift", () => {
    const scenes = ctaScenes();
    const ranges = assignSceneRanges(scenes, ctaWords, ctaDur);

    expectTiles(ranges, ctaDur);
    // Trigger scene starts exactly on "now" (word 15): 15*.5 = 7.5.
    expect(ranges[1].startSec).toBeCloseTo(7.5, 5);
    // Release (qrTail) scene ends at the next word's onset after "here" (word 29): 29*.5 = 14.5.
    expect(ranges[2].endSec).toBeCloseTo(14.5, 5);
  });

  it("pins the anchored gap so a mid-ramble pause can't pull the trigger cut early", () => {
    // A pause during the unscripted ramble (6.7–7.1, within snap tolerance of the 7.5 cut).
    // Un-anchored, the boundary's snap window spans the ramble so the snap accepts it (usable
    // edge 7.06); the anchor keeps the narrow [prevEnd, nextStart] gap — the trigger phrase was
    // found verbatim, so its onset is trusted — rejecting the pause: the QR trigger stays pinned
    // to its spoken onset.
    const silences = [{ start: 6.7, end: 7.1 }];
    const control = assignSceneRanges(
      ctaScenes().map(s => ({ ...s, qrHero: undefined, qrTail: undefined })),
      ctaWords,
      ctaDur,
      silences
    );
    expect(control[1].startSec).toBeCloseTo(7.06, 5);
    const anchored = assignSceneRanges(ctaScenes(), ctaWords, ctaDur, silences);
    expect(anchored[1].startSec).toBeCloseTo(7.5, 5);
  });

  it("still anchors when Whisper misheard one word of the phrase", () => {
    const words = ctaWords.map(x =>
      x.word === "grab" ? { ...x, word: "grap" } : x
    );
    const ranges = assignSceneRanges(ctaScenes(), words, ctaDur);
    expect(ranges[1].startSec).toBeCloseTo(7.5, 5);
    expect(ranges[2].endSec).toBeCloseTo(14.5, 5);
  });

  it("skips an anchor whose phrase never appears (behaves like the un-anchored walk)", () => {
    // Master never contains the trigger/release lines at all.
    const words = paced(`${INTRO} ${RAMBLE} ${OUTRO}`);
    const dur = words[words.length - 1].end + 0.2;
    const anchored = assignSceneRanges(ctaScenes(), words, dur);
    const control = assignSceneRanges(
      ctaScenes().map(s => ({ ...s, qrHero: undefined, qrTail: undefined })),
      words,
      dur
    );
    expect(anchored.map(r => r.endSec)).toEqual(control.map(r => r.endSec));
  });

  it("binds the k-th QR block to the k-th spoken occurrence of the repeated phrase", () => {
    const scenes = [
      scene(INTRO, 1),
      qrScene(TRIGGER, 2),
      { ...qrScene(RELEASE, 3), qrTail: true },
      scene(OUTRO, 4),
      qrScene(TRIGGER, 5),
      { ...qrScene(RELEASE, 6), qrTail: true },
      scene("that is all for today folks", 7),
    ];
    const words = paced(
      `${INTRO} ${TRIGGER} ${RELEASE} ${OUTRO} ${TRIGGER} ${RELEASE} that is all for today folks`
    );
    const dur = words[words.length - 1].end + 0.2;
    const ranges = assignSceneRanges(scenes, words, dur);

    expectTiles(ranges, dur);
    // Block 2's trigger scene starts at the SECOND "now" (word 7+7+7+7=28): 28*.5 = 14.0.
    expect(ranges[4].startSec).toBeCloseTo(14.0, 5);
    // Block 2's release ends at the word after the second "here" (word 42): 42*.5 = 21.0.
    expect(ranges[5].endSec).toBeCloseTo(21.0, 5);
  });

  // ── qrTail rescue: staging job 204 — whisperx word timestamps drifted ~1s early around the
  // CTA tail, so the release anchor pinned "I'll wait right here." entirely inside the pause
  // BEFORE it was spoken and the 3s QR hold fired before the phrase. Timestamps can lie; the
  // waveform can't: a qrTail range with no real speech must advance onto the next speech burst.
  const tailScenes = () => [
    scene("take your time there is no rush at all", 1),
    { ...qrScene("i'll wait right here", 2), qrTail: true },
    scene("alright back to the root", 3),
  ];
  /** Real audio: speech to 3.35, pause 3.4–4.4, the RELEASE burst 4.4–5.5, pause 5.5–6.3. */
  const tailSilences = [
    { start: 3.4, end: 4.4 },
    { start: 5.5, end: 6.3 },
  ];
  const TAIL_DUR = 8;
  /** Lead-in words end at 3.1 — safely before the 3.4s pause. */
  const tailLead = () =>
    "take your time there is no rush at all"
      .split(" ")
      .map((word, i) => w(word, i * 0.35, i * 0.35 + 0.3));

  it("advances a qrTail range that landed on dead air onto the next speech burst", () => {
    // Whisper words for the release phrase drifted INTO the pause (3.45–3.85, real burst
    // 4.4–5.5), and the next scene's onset drifted with them — the job-204 shape.
    const words = [
      ...tailLead(),
      w("i'll", 3.45, 3.55),
      w("wait", 3.55, 3.65),
      w("right", 3.65, 3.75),
      w("here", 3.75, 3.85),
      w("alright", 4.0, 4.2),
      w("back", 4.5, 4.7),
      w("to", 4.8, 4.9),
      w("the", 5.0, 5.1),
      w("root", 5.2, 5.4),
    ];
    const ranges = assignSceneRanges(
      tailScenes(),
      words,
      TAIL_DUR,
      tailSilences
    );

    expectTiles(ranges, TAIL_DUR);
    // The qrTail scene must hug the real burst: start just before it (silence end − 40ms),
    // end just after it (next silence start + 40ms) — the 3s hold now lands AFTER the phrase.
    expect(ranges[1].startSec).toBeCloseTo(4.36, 5);
    expect(ranges[1].endSec).toBeCloseTo(5.54, 5);
    expect(ranges[2].startSec).toBeCloseTo(5.54, 5);
  });

  it("leaves a qrTail range alone when it already contains real speech", () => {
    // Same scenes, honest word timings: the release phrase sits on its burst.
    const words = [
      ...tailLead(),
      w("i'll", 4.45, 4.65),
      w("wait", 4.7, 4.9),
      w("right", 5.0, 5.2),
      w("here", 5.3, 5.45),
      w("alright", 6.3, 6.5),
      w("back", 6.6, 6.8),
      w("to", 6.9, 7.0),
      w("the", 7.1, 7.2),
      w("root", 7.3, 7.5),
    ];
    const ranges = assignSceneRanges(
      tailScenes(),
      words,
      TAIL_DUR,
      tailSilences
    );

    expectTiles(ranges, TAIL_DUR);
    // Untouched by the rescue: the range covers the burst the anchor found.
    expect(ranges[1].startSec).toBeLessThan(4.45);
    expect(ranges[1].endSec).toBeGreaterThan(5.45);
  });

  it("keeps each host's tail across a host→host boundary and still tiles", () => {
    const words = [
      w("give", 0.0, 0.3),
      w("them", 0.3, 0.6),
      w("water", 0.6, 1.0),
      w("now", 1.0, 1.5),
      w("mulch", 2.4, 2.7),
      w("the", 2.7, 2.9),
      w("beds", 2.9, 3.4),
    ];
    const ranges = assignSceneRanges(
      [hostScene("Give them water now.", 1), hostScene("Mulch the beds.", 2)],
      words,
      3.6
    );
    expectTiles(ranges, 3.6);
    // Outgoing host keeps the whole pause; incoming host starts exactly on its first word (2.4).
    expect(ranges[0].endSec).toBeCloseTo(2.4, 5);
  });
});

/**
 * A film of `n` ten-word scenes read at a steady 3 words/sec, with every word timed. `holeFrom`
 * / `holeTo` (scene positions, inclusive) drop those scenes' words from the transcript — the
 * shape a transcript hole produces: no words for a stretch of clean speech.
 */
function steadyFilm(n: number, holeFrom = -1, holeTo = -1) {
  const scenes: StoryboardScene[] = [];
  const words: WhisperWord[] = [];
  let t = 0;
  for (let s = 0; s < n; s++) {
    const toks: string[] = [];
    for (let k = 0; k < 10; k++) {
      const tok = `w${s}x${k}`;
      toks.push(tok);
      if (s < holeFrom || s > holeTo) words.push(w(tok, t, t + 0.3));
      t += 1 / 3;
    }
    scenes.push(scene(toks.join(" "), s + 1));
  }
  return { scenes, words, dur: t };
}

describe("implausibleScenes", () => {
  it("flags nothing on an evenly read film", () => {
    const flags = implausibleScenes(
      new Array(20).fill(10),
      new Array(20).fill(3.3)
    );
    expect(flags.some(Boolean)).toBe(false);
  });

  it("flags a collapsed scene and the scene that swallowed the gap", () => {
    const durations = new Array(20).fill(3.3);
    durations[8] = 0;
    durations[9] = 0;
    durations[10] = 60;
    const flags = implausibleScenes(new Array(20).fill(10), durations);
    expect(flags[8] && flags[9] && flags[10]).toBe(true);
    expect(flags.filter(Boolean)).toHaveLength(3);
  });

  it("leaves a short line followed by a scripted pause alone", () => {
    const tokens = new Array(20).fill(10);
    const durations = new Array(20).fill(3.3);
    tokens[5] = 3; // ~1s of words…
    durations[5] = 3.2; // …plus a 2s beat
    expect(implausibleScenes(tokens, durations)[5]).toBe(false);
  });

  it("honours skip, and never judges a film too short to have a pace", () => {
    const durations = new Array(20).fill(3.3);
    durations[4] = 0;
    const skip = new Array(20).fill(false);
    skip[4] = true;
    expect(implausibleScenes(new Array(20).fill(10), durations, skip)[4]).toBe(
      false
    );
    expect(implausibleScenes([10, 10, 10], [0, 30, 0]).some(Boolean)).toBe(
      false
    );
  });
});

describe("repairImplausibleRuns", () => {
  it("re-splits a collapsed stretch by word count and touches nothing else", () => {
    // 20 scenes × 10 tokens; scenes 9–13 collapsed at 27s, scene 14 owns their audio.
    const b: number[] = [];
    for (let i = 0; i <= 20; i++) b.push(i * 3);
    for (let i = 10; i <= 14; i++) b[i] = 27; // scenes 9..13 zero-width, scene 14 = 27→45
    const fix = repairImplausibleRuns(b, new Array(20).fill(10));
    expect(fix.unrepairable).toHaveLength(0);
    expect(fix.repaired).toEqual([
      { fromScene: 9, toScene: 14, startSec: 27, endSec: 45 },
    ]);
    for (let i = 0; i <= 20; i++)
      expect(fix.boundaries[i]).toBeCloseTo(i * 3, 5);
    expect(b[10]).toBe(27); // input not mutated
  });

  it("refuses a stretch whose audio its words cannot fill", () => {
    // One scene owns five minutes and there are no starved neighbours to explain it.
    const b: number[] = [0];
    for (let i = 1; i <= 20; i++) b.push(b[i - 1] + (i === 11 ? 300 : 3));
    const fix = repairImplausibleRuns(b, new Array(20).fill(10));
    expect(fix.repaired).toHaveLength(0);
    expect(fix.unrepairable).toHaveLength(1);
    expect(fix.unrepairable[0].fromScene).toBeLessThanOrEqual(10);
    expect(fix.unrepairable[0].toScene).toBeGreaterThanOrEqual(10);
    expect(fix.boundaries).toEqual(b);
  });

  it("never moves a pinned boundary", () => {
    const b: number[] = [];
    for (let i = 0; i <= 20; i++) b.push(i * 3);
    for (let i = 10; i <= 14; i++) b[i] = 27;
    const fix = repairImplausibleRuns(b, new Array(20).fill(10), [12]);
    expect(fix.boundaries[12]).toBe(27);
  });
});

describe("assignSceneRanges — transcript hole", () => {
  it("keeps every scene near its true length when the transcript loses a stretch", () => {
    const { scenes, words, dur } = steadyFilm(40, 20, 33);
    const report = newAlignmentReport();
    const ranges = assignSceneRanges(scenes, words, dur, null, null, report);
    expectTiles(ranges, dur);
    expect(report.repaired).toHaveLength(1);
    expect(report.unrepairable).toHaveLength(0);
    for (const r of ranges) {
      expect(r.endSec - r.startSec).toBeGreaterThan(2);
      expect(r.endSec - r.startSec).toBeLessThan(5);
    }
  });

  it("reports nothing on a clean transcript", () => {
    const { scenes, words, dur } = steadyFilm(40);
    const report = newAlignmentReport();
    assignSceneRanges(scenes, words, dur, null, null, report);
    expect(report.repaired).toHaveLength(0);
    expect(report.unrepairable).toHaveLength(0);
  });
});

describe("assignSceneRanges — CTA anchor on a phrase the script says twice", () => {
  /**
   * Production job 94. The closing pitch ended "...come back with three quarters of an inch",
   * so the QR block's release anchor was those five words — which the host had ALSO said at
   * 9:15, mid-explanation. The anchor bound to the first occurrence it met and, being
   * authoritative, crushed five minutes of scenes in front of it.
   */
  function filmWithRepeatedPhrase() {
    const phrase = "three quarters of an inch";
    const scenes: StoryboardScene[] = [];
    const words: WhisperWord[] = [];
    let t = 0;
    for (let s = 0; s < 40; s++) {
      const filler = Array.from({ length: 5 }, (_, k) => `w${s}x${k}`).join(
        " "
      );
      // Scene 10 says the phrase in passing; scene 35 is the block's release and ENDS on it.
      const text =
        s === 10 || s === 35
          ? `${filler} ${phrase}`
          : `${filler} v${s}a v${s}b v${s}c v${s}d v${s}e`;
      const sc = scene(text, s + 1);
      if (s >= 33 && s <= 35) sc.qrHero = true;
      if (s === 35) sc.qrTail = true;
      scenes.push(sc);
      // Whisper mishears the first two words of the block's opening line, so its START anchor
      // (one miss tolerated) goes unfound — and the release search begins far too early.
      text.split(" ").forEach((tok, k) => {
        words.push(w(s === 33 && k < 2 ? `misheard${k}` : tok, t, t + 0.3));
        t += 1 / 3;
      });
    }
    return { scenes, words, dur: t };
  }

  it("pins the release to the occurrence its own scene is at, not the first sound-alike", () => {
    const { scenes, words, dur } = filmWithRepeatedPhrase();
    const report = newAlignmentReport();
    const ranges = assignSceneRanges(scenes, words, dur, null, null, report);
    expectTiles(ranges, dur);
    expect(report.repaired).toHaveLength(0);
    expect(report.unrepairable).toHaveLength(0);
    // Every scene is ten words at 3 words/sec (3.33 s). The two misheard words stay with the
    // scene before them — a cut lands on the next scene's first MATCHED word — so that pair
    // reads 4.0 s / 2.67 s. Nothing is crushed and nothing runs for minutes.
    for (const r of ranges) {
      expect(r.endSec - r.startSec).toBeGreaterThan(2.6);
      expect(r.endSec - r.startSec).toBeLessThan(4.1);
    }
    // The block ends where scene 36 actually finishes speaking.
    expect(ranges[35].endSec).toBeCloseTo((36 * 10) / 3, 1);
  });
});

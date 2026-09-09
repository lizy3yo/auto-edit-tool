import { describe, it, expect } from "vitest";
import { readCoverage, MIN_READ_COVERAGE } from "./narrationIngest";
import { parseCtaMarkers, extractSpokenScript } from "./longformVideo";
import { stripCtaMarkerLines } from "../shared/ctaMarkers";

/**
 * The manual-narration hatch shows an operator the exact words to read aloud, in the BROWSER,
 * where `parseCtaMarkers` is not available (it lives server-side because it also computes word
 * offsets and span labels). `stripCtaMarkerLines` is the client-side twin, and the two must
 * agree on every script: a divergence would put "equals equals equals CTA" into the master
 * narration, and the mismatch against the verifier's text would then read as a bad recording.
 */
describe("stripCtaMarkerLines agrees with parseCtaMarkers", () => {
  const cases: Record<string, string> = {
    "no markers at all": "Just a plain script.\n\nWith two paragraphs.",
    "one marked block":
      "Opening line.\n\n===START CTA===\nGrab the book.\n===END CTA===\n\nClosing line.",
    "a labelled block":
      "Intro.\n\n===START CTA (feeder)===\nBuy the feeder plans.\n===END CTA===\n\nOutro.",
    "two blocks, mid-roll and close":
      "A.\n\n===START CTA===\nMid-roll pitch.\n===END CTA===\n\nB.\n\n" +
      "===START CTA===\nClosing pitch.\n===END CTA===",
    "markers with trailing whitespace":
      "A.\n===START CTA===  \nPitch.\n  ===END CTA===\t\nB.",
    "blank runs left behind by a stripped block":
      "A.\n\n\n===START CTA===\n\nPitch.\n\n===END CTA===\n\n\nB.",
  };

  for (const [name, raw] of Object.entries(cases)) {
    it(name, () => {
      const spoken = extractSpokenScript(raw);
      expect(stripCtaMarkerLines(spoken)).toBe(parseCtaMarkers(spoken).script);
    });
  }
});

/**
 * `readCoverage` is the gate that decides whether an operator-supplied recording is a read of
 * this film's script. It has to clear two bars at once, and they pull in opposite directions:
 * tolerate ordinary transcription noise (a perfect read scores ~0.93-0.98, never 1.0), while
 * scoring a genuinely different recording low enough that no threshold between them exists.
 */
describe("readCoverage", () => {
  const SCRIPT =
    "Eight dollars of cedar. That's the entire material cost on the best selling " +
    "thing I've ever set on a table, and it's a bird feeder.";

  it("scores an exact transcript at 1", () => {
    expect(readCoverage(SCRIPT, SCRIPT).coverage).toBe(1);
  });

  it("ignores case and sentence punctuation, which a transcript never matches exactly", () => {
    // Apostrophes are deliberately NOT stripped here: `tokenizeNarration` keeps interior ones,
    // so "that's" and "thats" are different words to this check — as they should be, since a
    // transcript that lost them is a transcript of a different read.
    const heard = SCRIPT.toUpperCase().replace(/[.,]/g, "");
    expect(readCoverage(SCRIPT, heard).coverage).toBe(1);
  });

  it("stays above the threshold when whisper mishears a few words", () => {
    // Two substitutions in 27 words — the ordinary failure mode on proper nouns and numerals.
    const heard = SCRIPT.replace("cedar", "seeder").replace("bird", "burd");
    const { coverage } = readCoverage(SCRIPT, heard);
    expect(coverage).toBeGreaterThan(MIN_READ_COVERAGE);
    expect(coverage).toBeLessThan(1);
  });

  it("rejects a different recording outright", () => {
    const other =
      "Today we are going to talk about repotting tomatoes in the middle of summer " +
      "without shocking the roots or losing a single flower truss.";
    expect(readCoverage(SCRIPT, other).coverage).toBeLessThan(
      MIN_READ_COVERAGE
    );
  });

  it("rejects a truncated file and points at where it stopped", () => {
    // The commonest real mistake: an export that cut off partway through.
    const half = SCRIPT.slice(0, Math.floor(SCRIPT.length / 2));
    const { coverage, firstMissIndex } = readCoverage(SCRIPT, half);
    expect(coverage).toBeLessThan(MIN_READ_COVERAGE);
    // The divergence is reported where the audio ran out, not at word 0 — that position is what
    // the operator is shown, and "it stopped matching here" is the whole diagnostic.
    expect(firstMissIndex).toBeGreaterThan(5);
  });

  it("does not credit a word matched far past the gap", () => {
    // A skipped middle paragraph must not be papered over by finding those words later. The
    // bounded look-ahead is what stops an unbounded scan from calling this fully covered.
    const words = SCRIPT.split(" ");
    const heard = [...words.slice(0, 4), ...words.slice(20)].join(" ");
    expect(readCoverage(SCRIPT, heard).coverage).toBeLessThan(1);
  });

  it("treats an empty script as covered rather than dividing by zero", () => {
    expect(readCoverage("", "anything at all").coverage).toBe(1);
  });
});

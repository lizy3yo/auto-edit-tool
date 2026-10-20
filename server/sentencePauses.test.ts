import { describe, it, expect } from "vitest";
import { LEVEL_FRAME_SEC, MIN_GAP_SEC, holdsSpeech, planSentencePauses, soundEnd, soundStart, speechLevelDb } from "./sentencePauses";

const w = (word: string, start: number, end: number) => ({ word, start, end });

describe("every sentence ends with a real pause (Dale: a voice that never stops)", () => {
  it("adds silence after a sentence the voice ran straight on from", () => {
    const plan = planSentencePauses([w("Start", 0, 0.3), w("small.", 0.3, 0.7), w("Stay", 0.72, 1.0), w("patient.", 1.0, 1.5), w("Then", 1.6, 1.8)], 0.3);
    expect(plan).toEqual([
      { atSec: 0.71, addSec: 0.28 },
      { atSec: 1.55, addSec: 0.2 },
    ]);
  });

  it("quiets the breath in a long sentence gap instead of adding to it, and never touches the last word", () => {
    expect(planSentencePauses([w("Done.", 0, 0.4), w("Next", 1.0, 1.3), w("end.", 1.3, 1.6)], 0.3)).toEqual([
      { atSec: 0.7, addSec: 0, muteFrom: 0.44, muteTo: 0.96 },
    ]);
    expect(MIN_GAP_SEC).toBe(0.25);
  });

  it("never pauses mid-sentence, after an abbreviation or a list number", () => {
    const words = [w("Ask", 0, 0.2), w("Dr.", 0.2, 0.4), w("Smith,", 0.4, 0.7), w("step", 0.7, 0.9), w("3.", 0.9, 1.0), w("then", 1.0, 1.2), w("go", 1.2, 1.4)];
    expect(planSentencePauses(words, 0.3)).toEqual([]);
  });

  it("treats a question or an exclamation as a sentence end, quotes and all", () => {
    const plan = planSentencePauses([w("right?", 0, 0.4), w("Yes!\"", 0.42, 0.8), w("So", 0.82, 1.0)], 0.3);
    expect(plan.map(p => p.atSec)).toEqual([0.41, 0.81]);
  });
});

describe("a gap the transcript calls quiet is checked against the audio (Dale's and Hank's erased prices)", () => {
  // 20 ms loudness frames: speech at -16 dBFS, breath at -42, silence at -90.
  const levels = (spans: [number, number, number][], total: number) => {
    const out = new Array(Math.round(total / LEVEL_FRAME_SEC)).fill(-90);
    for (const [from, to, db] of spans) for (let i = Math.round(from / LEVEL_FRAME_SEC); i < Math.round(to / LEVEL_FRAME_SEC); i++) out[i] = db;
    return out;
  };

  it("leaves Dale's 'And furniture, $150 to $600. Once' alone: the transcript missed the price, the audio did not", () => {
    // job 386: "furniture." 63.24-63.72, then nothing written down until "Once" at 67.22 — the voice was saying the price.
    const words = [w("And", 62.94, 63.1), w("furniture.", 63.24, 63.72), w("Once", 67.22, 67.38), w("every", 67.54, 67.76)];
    const lv = levels([[62.9, 63.72, -16], [63.9, 66.9, -16], [67.2, 67.8, -16]], 70);
    expect(planSentencePauses(words, 0.3, lv)).toEqual([]);
    // without the audio it would have erased 3.5 s of speech
    expect(planSentencePauses(words, 0.3)[0].muteTo! - planSentencePauses(words, 0.3)[0].muteFrom!).toBeGreaterThan(3);
  });

  it("still quiets a real breath, and still adds a pause where the voice ran on", () => {
    const words = [w("Done.", 0, 0.4), w("Next", 1.0, 1.3), w("end.", 1.3, 1.6), w("Go", 1.62, 1.9)];
    const lv = levels([[0, 0.4, -16], [0.55, 0.85, -42], [1.0, 1.6, -16], [1.62, 1.9, -16]], 3);
    // the gap's edges come from the SOUND (where "Done." died away, where "Next" begins), and the
    // pause for "end. Go" goes in at the quietest moment between them
    expect(planSentencePauses(words, 0.3, lv)).toEqual([
      { atSec: 0.7, addSec: 0, muteFrom: 0.43, muteTo: 0.97 },
      { atSec: 1.61, addSec: 0.3 },
    ]);
  });

  it("never quiets a word's own fade-out: the gap starts where the sound died away, not where the transcript ended it (Frederick's 'The type.')", () => {
    // the transcript ends "type." at 71.06, but the word's tail rings on to 71.2
    const words = [w("the", 70.64, 70.72), w("type.", 70.78, 71.06), w("Ionization", 71.94, 72.66)];
    const lv = levels([[70.6, 71.06, -16], [71.06, 71.2, -40], [71.2, 71.9, -62], [71.9, 72.7, -16]], 74);
    const [p] = planSentencePauses(words, 0.3, lv);
    expect(p.muteFrom).toBeGreaterThanOrEqual(71.2);
    expect(p.muteTo).toBeLessThanOrEqual(71.9);
    expect(soundEnd(lv, 71.06, 71.94, -16)).toBeCloseTo(71.23, 2);
    expect(soundStart(lv, 71.94, 71.2, -16)).toBeCloseTo(71.87, 2);
  });

  it("a click or a short loud peak is not a word", () => {
    const lv = levels([[0, 1, -16], [1.5, 1.54, -10]], 3);
    expect(holdsSpeech(lv, 1.1, 2.0)).toBe(false);
    expect(holdsSpeech(levels([[0, 1, -16], [1.5, 1.7, -18]], 3), 1.1, 2.0)).toBe(true);
    expect(speechLevelDb(levels([[0, 1, -16]], 3))).toBe(-16);
  });
});

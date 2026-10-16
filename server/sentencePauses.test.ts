import { describe, it, expect } from "vitest";
import { MIN_GAP_SEC, planSentencePauses } from "./sentencePauses";

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

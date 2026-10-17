import { describe, expect, it } from "vitest";
import { LEVEL_FRAME_SEC, retimeNumbers } from "./wordTiming";

// 20 ms loudness frames: speech at -16 dBFS everywhere unless a span says otherwise.
const levels = (total: number, spans: [number, number, number][] = []) => {
  const out = new Array(Math.round(total / LEVEL_FRAME_SEC)).fill(-16);
  for (const [a, b, db] of spans) for (let i = Math.round(a / LEVEL_FRAME_SEC); i < Math.round(b / LEVEL_FRAME_SEC); i++) out[i] = db;
  return out;
};

describe("a number is shown when it is said, not when the transcript guessed (Dale 2:57)", () => {
  it("moves '$40' back to right after 'to' when the voice runs straight on", () => {
    const words = [
      { text: "$10", start: 176.6, end: 176.9 },
      { text: "to", start: 176.98, end: 177.06 },
      { text: "$40", start: 177.62, end: 177.88 },
      { text: "items", start: 177.98, end: 178.26 },
    ];
    const out = retimeNumbers(words, levels(180));
    expect(out[2].start).toBeCloseTo(177.08, 2);
    expect(out[3].start).toBe(177.98);
  });

  it("finds a number the aligner hid inside a stretched word ('the' 0.4 s long, then '$10')", () => {
    const out = retimeNumbers(
      [
        { text: "the", start: 176.04, end: 176.44 },
        { text: "$10", start: 176.6, end: 176.9 },
      ],
      levels(178)
    );
    expect(out[1].start).toBeCloseTo(176.04 + 0.05 + 0.065 * 3, 2);
    expect(out[0].end).toBeLessThanOrEqual(out[1].start);
  });

  it("never moves a number across a real pause, never later, and leaves words alone", () => {
    const words = [
      { text: "fee", start: 1.0, end: 1.3 },
      { text: "15%.", start: 1.8, end: 2.2 },
      { text: "Then", start: 2.5, end: 2.7 },
    ];
    const out = retimeNumbers(words, levels(3, [[1.32, 1.78, -70]]));
    expect(out).toEqual(words);
    expect(retimeNumbers(words, [])).toEqual(words);
  });
});

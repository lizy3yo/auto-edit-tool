import { describe, expect, it } from "vitest";
import { driftedStretches, LEVEL_FRAME_SEC, retimeLateStarts, retimeNumbers, sameWords, spliceStretch } from "./wordTiming";

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

describe("a word appears when its sound starts (Scarlett's 'the problem', job 392 at 0:20)", () => {
  it("moves 'the' out of the pause the aligner started it in", () => {
    // "never" 20.09-20.45, then a pause, then "the" really starts at ~21.0 (the aligner said 20.47)
    const words = [
      { text: "never", start: 20.09, end: 20.45 },
      { text: "the", start: 20.47, end: 21.25 },
      { text: "problem.", start: 21.27, end: 21.65 },
    ];
    const out = retimeLateStarts(words, levels(23, [[20.46, 21.0, -70]]));
    expect(out[1].start).toBeCloseTo(21.0, 1);
    expect(out[0]).toEqual(words[0]);
    expect(out[2]).toEqual(words[2]);
  });
  it("leaves a word that starts on its sound alone, and never moves one past its end", () => {
    const words = [{ text: "and", start: 1.0, end: 1.2 }];
    expect(retimeLateStarts(words, levels(3))).toEqual(words);
    expect(retimeLateStarts(words, levels(3, [[0.9, 1.3, -70]]))).toEqual(words);
  });
});

describe("a stretch timed seconds off is heard again (Hank 1:18, job 398)", () => {
  // Speech 0-4 s, pause 4-5 s, speech 5-9 s, pause 9-10 s, speech 10-12 s.
  const sound = levels(12, [[4, 5, -80], [9, 10, -80]]);
  const W = (s: string, start: number, step: number) => s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + step * 0.9 }));
  const first = W("It sells for $90 to $130.", 0, 0.66);
  // The aligner slid the second sentence 3 s early, over the pause and the first sentence's end.
  const drifted = [...first.slice(0, 4), ...W("to $130. But once you take out the lumber, that's", 2.6, 0.2), { text: "$14", start: 5.2, end: 5.4 }, ...W("for every hour", 10, 0.6)];
  const truth = [...first, ...W("But once you take out the lumber, that's $14", 5, 0.5), ...W("for every hour", 10, 0.6)];

  it("finds the stretch from the sound: speech with no words under it", () => {
    const s = driftedStretches(drifted, sound);
    expect(s.length).toBe(1);
    expect(s[0].start).toBeLessThanOrEqual(2.6);
    expect(s[0].end).toBeGreaterThanOrEqual(9);
  });
  it("leaves words that agree with the sound alone", () => {
    expect(driftedStretches(truth, sound)).toEqual([]);
  });
  it("splices the second hearing in only when it says the same words and fits the sound better", () => {
    const [s] = driftedStretches(drifted, sound);
    const r = spliceStretch(drifted, truth, sound, s.start, s.end);
    expect(r.used).toBe(true);
    expect(r.words.find(w => w.text === "But")!.start).toBeCloseTo(5, 1);
    const other = truth.map(w => (w.text === "lumber," ? { ...w, text: "timber," } : w.text === "once" ? { ...w, text: "when" } : w.text === "take" ? { ...w, text: "pull" } : w));
    expect(spliceStretch(drifted, other.map(w => ({ ...w, text: w.text + "x" })), sound, s.start, s.end).used).toBe(false);
    expect(spliceStretch(truth, drifted, sound, 0, 12).used).toBe(false); // never worse
  });
  it("same words allows a word misheard, not a different line", () => {
    const a = W("one two three four five six seven eight nine ten", 0, 0.3);
    expect(sameWords(a, a.map((w, i) => (i === 4 ? { ...w, text: "fife" } : w)))).toBe(true);
    expect(sameWords(a, W("a whole other sentence said here", 0, 0.3))).toBe(false);
  });
});

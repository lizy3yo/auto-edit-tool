import { describe, expect, it } from "vitest";
import {
  CueError,
  CARD_MAX_WAIT_SEC,
  MAX_LINGER_SEC,
  HANDOFF_GAP_SEC,
  HANDOFF_MIN_TAIL_SEC,
  LINGER_SEC,
  MIN_ON_SCREEN_SEC,
  findPhrase,
  findSubsequence,
  indexWords,
  resolveCues,
  tokens,
  type Word,
} from "./cueResolve";
import { countUpValue, splitWords, wordFrames } from "./timing";

// "So get a stepladder, take one alarm down, and read the label. ... read the label again."
const W = (s: string, start: number): Word[] =>
  s.split(" ").map((text, i) => ({ text, start: start + i * 0.4, end: start + i * 0.4 + 0.35 }));
const words: Word[] = [
  ...W("First thing on the label.", 10),
  ...W("The type. Ionization is quick on open flame,", 12),
  ...W("So get a stepladder, take one alarm down, and read the label.", 20),
  ...W("At 10-year the unit is finished. Read the label again.", 30),
];
const index = indexWords(words);

describe("tokens", () => {
  it("drops punctuation, keeps apostrophes, splits hyphens", () => {
    expect(tokens("It isn't DEAD.")).toEqual(["it", "isn't", "dead"]);
    expect(tokens("10-year unit")).toEqual(["10", "year", "unit"]);
    expect(tokens("“Photoelectric,”")).toEqual(["photoelectric"]);
  });
});

describe("findPhrase / findSubsequence", () => {
  it("finds consecutive words and honours the cursor", () => {
    const first = findPhrase(index, "read the label")!;
    const second = findPhrase(index, "read the label", first[0] + 1)!;
    expect(second[0]).toBeGreaterThan(first[0]);
  });
  it("matches a card that drops words but never reorders them", () => {
    expect(findSubsequence(index, "Ionization quick open flame")).not.toBeNull();
    expect(findSubsequence(index, "flame open quick")).toBeNull();
  });
  it("treats number words and digits alike, and a plural s", () => {
    expect(findPhrase(index, "at ten year")).not.toBeNull();
    expect(findPhrase(index, "at 10 years")).not.toBeNull();
  });
  it("forgives one changed letter in a long word, never in a short one or a number", () => {
    const idx = indexWords(W("a plastic disk glued to the ceiling 10 years", 0));
    expect(findPhrase(idx, "plastic disc glued")).not.toBeNull();
    expect(findPhrase(idx, "a plastic disc gluted")).toBeNull();
    expect(findPhrase(indexWords(W("at the end", 0)), "at the and")).toBeNull();
    expect(findPhrase(idx, "11 years")).toBeNull();
  });

  it("forgives a compound split differently on each side", () => {
    const idx = indexWords(W("the cheap multi-packs. Photoelectric sees", 0));
    expect(findPhrase(idx, "cheap multipacks")).not.toBeNull();
    expect(findSubsequence(idx, "multipacks photoelectric")).not.toBeNull();
    expect(findPhrase(indexWords(W("a sealed 10year unit", 0)), "sealed 10-year unit")).not.toBeNull();
    expect(findPhrase(indexWords(W("a sealed one zero year unit", 0)), "sealed 10-year unit")).not.toBeNull();
    expect(findPhrase(indexWords(W("a sealed one two year unit", 0)), "sealed 10-year unit")).toBeNull();
  });
});

describe("resolveCues", () => {
  it("times every element against the words, relative to the cue start", () => {
    const [cue] = resolveCues(
      [
        {
          id: "steps",
          template: "StepLabels",
          start: "get a stepladder",
          end: "read the label",
          endPad: 0.5,
          props: { steps: [{ text: "Get a stepladder", at: "@get a stepladder" }, { text: "Read the label", at: "@read the label" }] },
        },
      ],
      words
    );
    const getAt = words.find(w => w.text === "get")!.start;
    expect(cue.start).toBeCloseTo(getAt, 3);
    const steps = cue.props.steps as { at: number }[];
    expect(steps[0].at).toBe(0);
    expect(steps[1].at).toBeCloseTo(words.find(w => w.text === "read")!.start - getAt, 3);
    expect(cue.props.durationSec).toBeCloseTo(cue.end - cue.start, 3);
  });

  it("gives each DISPLAYED word of a phrase its own spoken time", () => {
    const [cue] = resolveCues(
      [{ id: "s", template: "Statement", start: "Ionization", durationSec: 4, props: { headline: { text: "Ionization: quick on flame", words: true } } }],
      words
    );
    const h = cue.props.headline as { wordTimes: number[] };
    expect(h.wordTimes).toHaveLength(4);
    expect(h.wordTimes[0]).toBe(0);
    expect(h.wordTimes[3]).toBeGreaterThan(h.wordTimes[2]);
  });

  it("refuses words the narrator never says — a card shows the script, nothing else", () => {
    expect(() =>
      resolveCues(
        [{ id: "x", template: "Statement", start: "Ionization", durationSec: 3, props: { headline: { text: "Ionization is radioactive", words: true } } }],
        words
      )
    ).toThrow(CueError);
  });

  it("binds a repeated phrase to the occurrence after the previous cue", () => {
    const cues = resolveCues(
      [
        { id: "a", template: "ChapterLabel", start: "First thing", durationSec: 2, props: {} },
        { id: "b", template: "ChapterLabel", start: "Read the label again", durationSec: 2, props: {} },
      ],
      words
    );
    expect(cues[1].start).toBeGreaterThan(30);
  });
});

describe("conform to the edit", () => {
  const spec = { id: "c", template: "Versus", start: "Ionization", end: "open flame", props: {} };
  const flame = words.find(w => w.text.startsWith("flame"))!;

  it("an end a few frames short of a cut snaps onto the cut and leaves with the picture", () => {
    const cut = flame.end + 0.07; // the old picture would flash for 2 frames
    const [c] = resolveCues([spec], words, { cuts: [cut] });
    expect(c.end).toBeCloseTo(Math.round(cut * 30) / 30, 3);
    expect(c.conformed.end).toBe(true);
    expect(c.props.exit).toBe("cut");
  });

  it("a start near a cut moves onto it, and word times stay on their words", () => {
    const ion = words.find(w => w.text === "Ionization")!;
    const cut = ion.start - 0.2;
    const [c] = resolveCues(
      [{ ...spec, props: { headline: { text: "Ionization is quick", words: true } } }],
      words,
      { cuts: [cut] }
    );
    expect(c.start).toBeCloseTo(Math.round(cut * 30) / 30, 3);
    const h = c.props.headline as { wordTimes: number[] };
    expect(c.start + h.wordTimes[0]).toBeCloseTo(ion.start, 2);
  });

  it("a last second that spills past a cut ends on the cut", () => {
    const cut = flame.end - 0.8;
    const [c] = resolveCues([{ ...spec, endPad: 0 }], words, { cuts: [cut] });
    expect(c.end).toBeCloseTo(Math.round(cut * 30) / 30, 3);
    expect(c.props.exit).toBe("cut");
  });

  it("a cut further than half a second away is left alone, and edges sit on frames", () => {
    const [c] = resolveCues([spec], words, { cuts: [flame.end + 2] });
    expect(c.conformed).toEqual({ start: false, end: false });
    expect(c.props.exit).toBeUndefined();
    expect(Number.isInteger(c.endFrame) && Number.isInteger(c.startFrame)).toBe(true);
    expect(Math.abs(c.end * 30 - c.endFrame)).toBeLessThan(0.05);
    expect(c.props.durationSec * 30).toBeCloseTo(c.endFrame - c.startFrame, 6);
  });
});

describe("a graphic leaves when its own words are done", () => {
  // "The type. Ionization is quick on open flame," … then the narrator moves on.
  const quick = words.find(w => w.text === "quick")!;
  const flame = words.find(w => w.text.startsWith("flame"))!;
  const stepladder = words.find(w => w.text.startsWith("stepladder"))!;

  it("ends LINGER_SEC after its last displayed word, not at the far planned end", () => {
    const [c] = resolveCues(
      [{ id: "s", template: "Statement", start: "Ionization", end: "read the label", props: { headline: { text: "Ionization is quick", words: true } } }],
      words
    );
    expect(c.contentEnd).toBeCloseTo(quick.end, 3);
    expect(c.end).toBeCloseTo(Math.round((quick.end + LINGER_SEC) * 30) / 30, 2);
  });

  it("counts fixed text by the words it stands for (say)", () => {
    const [c] = resolveCues(
      [{ id: "v", template: "Versus", start: "Ionization", end: "read the label", props: { left: { title: "Ionization", sub: "Quick on open flame", say: "quick on open flame", at: 0 } } }],
      words
    );
    expect(c.contentEnd).toBeCloseTo(flame.end, 3);
    expect((c.props.left as Record<string, unknown>).say).toBeUndefined();
  });

  it("is never shorter than MIN_ON_SCREEN_SEC, and a title keeps its planned length", () => {
    const [short] = resolveCues([{ id: "h", template: "HostCaption", start: "get a", end: "read the label", props: { phrase: { text: "get a", words: true } } }], words);
    expect(short.end - short.start).toBeGreaterThanOrEqual(MIN_ON_SCREEN_SEC - 0.04);
    const [title] = resolveCues(
      [{ id: "t", template: "ChapterLabel", start: "get a stepladder", end: "read the label", props: { phrase: { text: "get a stepladder", words: true } } }],
      words,
      { structural: new Set(["ChapterLabel"]) }
    );
    expect(title.end).toBeGreaterThan(stepladder.end + LINGER_SEC);
  });
});

describe("timing", () => {
  it("count-up lands exactly on the target and keeps its decimals", () => {
    expect(countUpValue(1000, 0, 60, 30)).toBe("60");
    expect(countUpValue(1000, 0, 2.5, 30)).toBe("2.5");
    expect(Number(countUpValue(10, 0, 60, 30))).toBeLessThan(60);
  });
  it("a word appears a little before it is spoken, never before frame 0", () => {
    const f = wordFrames({ text: "one two", at: 0, wordTimes: [0, 1] }, 30);
    expect(f).toEqual([0, 29]);
    expect(splitWords("  a  b ")).toEqual(["a", "b"]);
  });
});

describe("hand-off between graphics", () => {
  const W2 = (s: string, start: number): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * 0.4, end: start + i * 0.4 + 0.35 }));
  // "keep it simple" ends 10.75; the next graphic starts on "now the label" at 11.6.
  const ws = [...W2("keep it simple", 10), ...W2("now the label says three things", 11.6)];
  it("the earlier graphic leaves HANDOFF_GAP_SEC before the next one starts, its words kept", () => {
    const [a, b] = resolveCues(
      [
        { id: "a", template: "HostCaption", start: "keep it simple", durationSec: 2, props: { phrase: { text: "keep it simple", words: true } } },
        { id: "b", template: "ChapterLabel", start: "now the label", durationSec: 3, props: {} },
      ],
      ws,
      { structural: new Set(["ChapterLabel"]) }
    );
    expect(b.start - a.end).toBeLessThan(HANDOFF_GAP_SEC);
    expect(a.end).toBeGreaterThanOrEqual(a.start + MIN_ON_SCREEN_SEC - 0.04);
    const [a2] = resolveCues(
      [
        { id: "a", template: "HostCaption", start: "keep it", durationSec: 2, props: { phrase: { text: "keep it", words: true } } },
        { id: "b", template: "ChapterLabel", start: "the label says", durationSec: 3, props: {} },
      ],
      ws,
      { structural: new Set(["ChapterLabel"]) }
    );
    expect(a2.end).toBeGreaterThanOrEqual(ws[1].end + HANDOFF_MIN_TAIL_SEC - 0.04);
  });
  it("never cuts a graphic's own words short to make room", () => {
    const [a, b] = resolveCues(
      [
        { id: "a", template: "HostCaption", start: "keep it simple", props: { phrase: { text: "keep it simple", words: true } } },
        { id: "b", template: "ChapterLabel", start: "now the label", durationSec: 3, props: {} },
      ],
      ws,
      { structural: new Set(["ChapterLabel"]) }
    );
    expect(a.end).toBeGreaterThanOrEqual(ws[2].end + HANDOFF_MIN_TAIL_SEC - 0.04);
    expect(b.start - a.end).toBeLessThan(HANDOFF_GAP_SEC); // still too close: the rule check reports it
  });
});

describe("cards and cuts never leave the screen stale", () => {
  const W3 = (s: string, start: number): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * 0.4, end: start + i * 0.4 + 0.35 }));
  // "and once foam furniture catches a bedroom goes up in about 3 minutes"
  const ws = W3("and once foam furniture catches a bedroom goes up in about 3 minutes", 50);
  const three = ws.find(w => w.text === "3")!;
  it("a card opening long before its first word moves onto it, every element still on its word", () => {
    const [c] = resolveCues(
      [{ id: "n", template: "BigNumber", start: "and once foam", end: "3 minutes", props: { value: 3, unit: "minutes", at: "@3 minutes" } }],
      ws,
      { cards: new Set(["BigNumber"]) }
    );
    expect(three.start - c.start).toBeLessThanOrEqual(CARD_MAX_WAIT_SEC);
    expect(c.start + (c.props.at as number)).toBeCloseTo(three.start, 1);
  });
  it("a card already showing something at its start stays where it is (a VS card's first side)", () => {
    const [c] = resolveCues(
      [{ id: "v", template: "Versus", start: "and once foam", end: "3 minutes", props: { left: { title: "Foam", at: 0 }, right: { title: "Three minutes", at: "@3 minutes" } } }],
      ws,
      { cards: new Set(["Versus"]) }
    );
    expect(c.start).toBeCloseTo(ws[0].start, 1);
    expect((c.props.left as { at: number }).at).toBe(0);
  });
  it("an end snaps forward onto a cut only while within MAX_LINGER_SEC of the last word", () => {
    const spec = { id: "h", template: "HostCaption", start: "a bedroom", props: { phrase: { text: "about 3 minutes", words: true } } };
    const last = ws[ws.length - 1].end;
    const [far] = resolveCues([spec], ws, { cuts: [last + LINGER_SEC + 0.45] });
    expect(far.end - last).toBeLessThanOrEqual(MAX_LINGER_SEC);
    expect(far.conformed.end).toBe(false);
    const [near] = resolveCues([spec], ws, { cuts: [last + LINGER_SEC + 0.2] });
    expect(near.conformed.end).toBe(true);
  });
});

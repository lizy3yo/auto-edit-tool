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
  parseSpokenNumber,
  resolveCues,
  tokens,
  findVerbatim,
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
  it("reads a whole spoken number against its digits, either way round", () => {
    expect(findPhrase(indexWords(W("It takes about 25 minutes apiece", 0)), "about twenty-five minutes")).not.toBeNull();
    expect(findPhrase(indexWords(W("call it fifty cents", 0)), "call it 50 cents")).not.toBeNull();
    expect(findPhrase(indexWords(W("a hundred and fifty dollars", 0)), "150 dollars")).not.toBeNull();
    expect(findPhrase(indexWords(W("about 25 minutes", 0)), "about twenty-six minutes")).toBeNull();
    expect(parseSpokenNumber(["three", "million", "dogs"], 0)).toEqual({ value: 3000000, n: 2 });
    expect(parseSpokenNumber(["a", "dog"], 0)).toBeNull();
  });
  it("forgives a trailing -d like a plural -s", () => {
    expect(findPhrase(indexWords(W("Mine was lap size, 12 blocks", 0)), "Mine was lap-sized, twelve blocks")).not.toBeNull();
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
      [{ id: "s", template: "Statement", start: "Ionization", durationSec: 4, props: { headline: { text: "Ionization is quick on open flame,", words: true } } }],
      words
    );
    const h = cue.props.headline as { wordTimes: number[] };
    expect(h.wordTimes).toHaveLength(6);
    expect(h.wordTimes[0]).toBe(0);
    expect(h.wordTimes[5]).toBeGreaterThan(h.wordTimes[4]);
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
      [{ ...spec, props: { headline: { text: "Ionization is quick on open flame,", words: true } } }],
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
    const flame = words.find(w => w.text.startsWith("flame"))!;
  const stepladder = words.find(w => w.text.startsWith("stepladder"))!;

  it("ends LINGER_SEC after its last displayed word, not at the far planned end", () => {
    const [c] = resolveCues(
      [{ id: "s", template: "Statement", start: "Ionization", end: "read the label", props: { headline: { text: "Ionization is quick on open flame,", words: true } } }],
      words
    );
    expect(c.contentEnd).toBeCloseTo(flame.end, 3);
    expect(c.end).toBeCloseTo(Math.round((flame.end + LINGER_SEC) * 30) / 30, 2);
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
    const [short] = resolveCues([{ id: "h", template: "HostCaption", start: "take one alarm", end: "read the label", props: { phrase: { text: "take one alarm down,", words: true } } }], words);
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
    // Digits grouped as written: 10,000 and up, money from 1,000; a bare year stays bare.
    expect(countUpValue(1000, 0, 10000, 30)).toBe("10,000");
    expect(countUpValue(1000, 0, 1998, 30)).toBe("1998");
    expect(countUpValue(1000, 0, 1500, 30, 1.1, 1000)).toBe("1,500");
    expect(countUpValue(1000, 0, 1234567.5, 30)).toBe("1,234,567.5");
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
  const ws = [...W2("keep it, simple", 10), ...W2("now the label says three things", 11.6)];
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
  // "and once foam furniture catches, a bedroom goes up in about 3 minutes"
  const ws = W3("and once foam furniture catches, a bedroom goes up in about 3 minutes", 50);
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
    const spec = { id: "h", template: "HostCaption", start: "a bedroom", props: { phrase: { text: "a bedroom goes up in about 3 minutes", words: true } } };
    const last = ws[ws.length - 1].end;
    const [far] = resolveCues([spec], ws, { cuts: [last + LINGER_SEC + 0.45] });
    expect(far.end - last).toBeLessThanOrEqual(MAX_LINGER_SEC);
    expect(far.conformed.end).toBe(false);
    const [near] = resolveCues([spec], ws, { cuts: [last + LINGER_SEC + 0.2] });
    expect(near.conformed.end).toBe(true);
  });
});

describe("a word-by-word line is exactly what is said, from one natural break to the next", () => {
  const W4 = (s: string, start: number, step = 0.3): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.26 }));
  // Dale, job 386 at 0:25: "And hang on for the Etsy fee that can more than double what comes out of a single sale."
  const dale = [...W4("well.", 24.6), ...W4("And hang on for the Etsy fee that can more than double what comes out of a single sale.", 25.33), ...W4("I'm Dale", 30.7)];
  const cap = (text: string, start = "And hang") => ({ id: "c", template: "DimCaption", start, props: { phrase: { text, words: true } } });

  it("refuses a caption that leaves words out, and names what he really says", () => {
    expect(() => resolveCues([cap("And the Etsy fee can more than double")], dale)).toThrow(/leaves out words he says \("And hang on for the Etsy fee that can more than double"\)/);
  });
  it("refuses a caption that stops mid-sentence, and one that starts mid-sentence", () => {
    expect(() => resolveCues([cap("And hang on for the Etsy fee that can more than double")], dale)).toThrow(/ends mid-sentence/);
    expect(() => resolveCues([cap("can more than double what comes out of a single sale.", "can more")], dale)).toThrow(/starts mid-sentence/);
  });
  it("takes a whole sentence, or two lines split before a clause word", () => {
    expect(() => resolveCues([cap("And hang on for the Etsy fee")], dale)).not.toThrow();
    expect(() => resolveCues([cap("that can more than double what comes out of a single sale.", "that can")], dale)).not.toThrow();
  });
  it("a pause is a break, and a line may stop where its graphic's own number takes over", () => {
    const paused = [...W4("Put the items along the front edge", 1), ...W4("of the table.", 4)];
    expect(() => resolveCues([{ id: "p", template: "DimCaption", start: "Put the", props: { phrase: { text: "Put the items along the front edge", words: true } } }], paused)).not.toThrow();
    const fee = W4("That order carries an extra fee of 15% on one board.", 10);
    expect(() => resolveCues([{ id: "n", template: "BigNumber", start: "That order", props: { value: 15, unit: "%", at: "@15%", line: { text: "That order carries an extra fee of", words: true } } }], fee)).not.toThrow();
  });
  it("forgives ONE misheard word inside a line, never a missing one", () => {
    const heard = W4("A plastic disk doing absolutely nothing.", 1);
    expect(findVerbatim(indexWords(heard), "A plastic disc doing absolutely nothing.")).not.toBeNull();
    expect(findVerbatim(indexWords(heard), "A plastic thing doing absolutely nothing.")).not.toBeNull();
    expect(findVerbatim(indexWords(heard), "A plastic doing absolutely nothing.")).toBeNull();
  });
});

describe("a card never leaves a blink of footage beside it (Dale 1:30, Scarlett 0:57, Hank 1:29)", () => {
  const W5 = (s: string, start: number, step = 0.35): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.3 }));
  // Dale job 386: the Statement's words end 90.61, the host comes in at the cut 91.19 and speaks at 91.31.
  const words = [...W5("That's why the personalized pile belongs on Etsy first.", 87.2), ...W5("Let me set the list down.", 91.31)];
  const statement = { id: "s", template: "Statement", start: "That's why", end: "Etsy first.", props: { headline: { text: "That's why the personalized pile belongs on Etsy first.", words: true } } };
  const opts = { cuts: [87.12, 91.19], cards: new Set(["Statement"]) };
  it("holds through the pause and leaves with the picture", () => {
    const [c] = resolveCues([statement], words, opts);
    expect(c.end).toBeCloseTo(91.19, 1);
    expect(c.conformed).toMatchObject({ end: true, held: true });
    expect(c.props.exit).toBe("cut");
  });
  it("does not hold past CARD_HOLD_MAX_SEC, or over a new line", () => {
    const [far] = resolveCues([statement], words, { ...opts, cuts: [87.12, 89.94 + 0.3 + 2.4] });
    expect(far.conformed.held).toBeUndefined();
    const talk = [...W5("That's why the personalized pile belongs on Etsy first.", 87.2), ...W5("Let me set the list down.", 90.75)];
    const [over] = resolveCues([statement], talk, opts);
    expect(over.conformed.held).toBeUndefined();
  });
  it("a caption over footage is not held (only graphics that replace the picture)", () => {
    const [c] = resolveCues([{ ...statement, template: "DimCaption" }], words, opts);
    expect(c.conformed.held).toBeUndefined();
  });
});

describe("a list item appears on its first spoken word, with its picture (Hank 0:33)", () => {
  const W6 = (s: string, start: number, step = 0.3): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.26 }));
  const words = W6("with a saw, a drill, and a stack of sandpaper, wondering if", 30.9);
  const sandpaper = words.find(w => w.text.startsWith("sandpaper"))!;
  const stack = words.find(w => w.text === "a" && words[words.indexOf(w) + 1]?.text === "stack")!;
  const spec = {
    id: "l",
    template: "ListWindow",
    start: "a saw",
    props: { title: "In the garage", items: [{ text: "A saw", at: "@saw", say: "a saw" }, { text: "Sandpaper", at: "@sandpaper", say: "a stack of sandpaper" }] },
  };
  it("waits for 'a stack of', not for 'sandpaper'", () => {
    const [c] = resolveCues([spec], words, { fullFrame: new Set(["ListWindow"]) });
    const item = (c.props.items as { at: number }[])[1];
    expect(c.start + item.at).toBeCloseTo(stack.start, 2);
    expect(stack.start).toBeLessThan(sandpaper.start - 0.5);
  });
  it("lands with its picture when the picture changes just before", () => {
    const cut = stack.start - 0.2;
    const [c] = resolveCues([spec], words, { cuts: [cut], fullFrame: new Set(["ListWindow"]) });
    const item = (c.props.items as { at: number }[])[1];
    expect(c.start + item.at).toBeCloseTo(cut, 2);
    expect(c.sync.find(x => x.element.includes("items[1]"))?.onCut).toBe(true);
  });
});

describe("a card stays while its own sentence finishes (Scarlett, job 392)", () => {
  const W7 = (s: string, start: number, step = 0.3): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.26 }));
  // "...hold the piece up near your face | by a window." — the steps card ends on "face", the shot runs on 1.1 s.
  const words = [...W7("Match the length to the neckline, and hold the piece up near your face by a window.", 185.5), ...W7("Then wear it.", 192.4)];
  const face = words.find(w => w.text === "face")!;
  const steps = { id: "s", template: "StepCards", start: "Match the length", end: "near your face", props: { steps: [{ text: "Match length", at: "@Match the length" }, { text: "Hold by a window", at: "@hold the piece up" }] } };
  it("holds to the cut through the rest of its sentence", () => {
    const cut = face.end + 1.1;
    const [c] = resolveCues([steps], words, { cuts: [185.4, cut], cards: new Set(["StepCards"]) });
    expect(c.conformed.held).toBe(true);
    // the hold is measured from where the sentence finished ("window."), not from "face"
    expect(c.spokenEnd).toBeCloseTo(words.find(w => w.text === "window.")!.end, 2);
    expect(c.end).toBeCloseTo(Math.round(cut * 30) / 30, 2);
  });
  it("still leaves before a NEW sentence that starts well before the cut", () => {
    const talk = [...W7("Match the length to the neckline, and hold the piece up near your face.", 185.5), ...W7("Then wear it often.", 190.6)];
    const f2 = talk.find(w => w.text === "face.")!;
    const [c] = resolveCues([{ ...steps, end: "near your face." }], talk, { cuts: [185.4, 191.9], cards: new Set(["StepCards"]) });
    expect(f2.end).toBeLessThan(190);
    expect(c.conformed.held).toBeUndefined();
  });
});

describe("a number stays readable (Hank's '6 hours', job 390 at 0:20)", () => {
  // "...of, a lattice panel that ate six hours of my Saturday," — the shot changes at 20.50, between "six" and "hours".
  const words: Word[] = [
    { text: "of,", start: 16.93, end: 17.05 }, { text: "a", start: 18.01, end: 18.05 }, { text: "lattice", start: 18.13, end: 18.61 },
    { text: "panel", start: 18.77, end: 19.23 }, { text: "that", start: 19.71, end: 19.91 }, { text: "ate", start: 19.97, end: 20.13 },
    { text: "six", start: 20.27, end: 20.53 }, { text: "hours", start: 20.57, end: 20.95 }, { text: "of", start: 21.03, end: 21.09 },
    { text: "my", start: 21.15, end: 21.27 }, { text: "Saturday,", start: 21.35, end: 21.87 }, { text: "finished", start: 22.37, end: 22.75 },
  ];
  const spec = { id: "n", template: "BigNumberOverlay", start: "a lattice panel", end: "six", props: { kicker: "Lattice panel", value: 6, unit: "hours", at: "@6", countSec: 0.6 } };
  const [c] = resolveCues([spec], words, { cuts: [15.28, 20.5, 26.4] });
  it("opens near its number, not seconds before with only its label", () => {
    expect(20.27 - c.start).toBeLessThanOrEqual(CARD_MAX_WAIT_SEC + 1e-6);
  });
  it("counts the number as said once its unit is said, and is not cut off at the shot change", () => {
    expect(c.contentEnd).toBeCloseTo(20.95, 2);
    expect(c.end - 20.27).toBeGreaterThan(1);
  });
});

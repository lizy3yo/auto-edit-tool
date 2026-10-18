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
  closeSpelling,
  VERDICT_SEC,
  TAIL_SPILL_SEC,
  endWithFilm,
  blinkBeside,
  stillUpAfterWords,
  ownSentenceEnd,
  readAlongSec,
  type CueSpec,
  type ResolvedCue,
  type Word,
} from "./cueResolve";
import { countUpValue, pageStarts, splitWords, wordFrames } from "./timing";
import { replacesPicture, resolveSets, templateById } from "./registry";

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

  // Walter's job 411 (1:47) as the transcriber heard it: the script's "migratorius" is
  // "migratorious", one letter LONGER — refused as 'start words "ends in the word migratorius" not
  // found', and the repair round put the transcript's spelling on the term card.
  const robin = indexWords([
    { text: "ends", start: 106.322, end: 106.482 },
    { text: "in", start: 106.562, end: 106.622 },
    { text: "the", start: 106.662, end: 106.742 },
    { text: "word", start: 106.782, end: 107.042 },
    { text: "migratorious,", start: 107.263, end: 108.223 },
    { text: "which", start: 108.663, end: 108.823 },
  ]);
  it("forgives a letter added or dropped in a word of seven letters or more (job 411's 'migratorious')", () => {
    expect(findPhrase(robin, "ends in the word migratorius")).toEqual([0, 1, 2, 3, 4]);
    expect(findPhrase(robin, "migratorius")).toEqual([4]);
    expect(findVerbatim(robin, "migratorius, which")).toEqual([4, 5]);
    expect(closeSpelling("migratorius", "migratorious")).toBe(true);
    expect(closeSpelling("migratorius", "migratories")).toBe(true);
    expect(closeSpelling("disc", "disk")).toBe(true);
  });
  it("never under seven letters, never two edits under fourteen, never a number, never an article joined to its word", () => {
    // one letter added to a short word usually makes another word
    expect(closeSpelling("though", "through")).toBe(false);
    expect(closeSpelling("plane", "planet")).toBe(false);
    expect(findPhrase(indexWords(W("it went though the wall", 0)), "went through the wall")).toBeNull();
    // two letters off in an 11-letter word is another word
    expect(closeSpelling("migratorius", "migrations")).toBe(false);
    expect(findPhrase(robin, "ends in the word migrations")).toBeNull();
    expect(closeSpelling("1500000", "15000000")).toBe(false);
    // "a seasoned" joined is one letter from "seasoned": two words joined keep the old measure, so
    // an article is never read as part of the next word (job 407's Versus sub)
    expect(findPhrase(indexWords(W("than a seasoned one.", 0)), "a seasoned one")).toEqual([1, 2, 3]);
    expect(findPhrase(indexWords(W("than seasoned one.", 0)), "a seasoned one")).toBeNull();
  });
  it("forgives an apostrophe one side writes and the other leaves out, from four letters", () => {
    expect(findPhrase(indexWords(W("the robins own scientific name", 0)), "the robin’s own scientific name")).not.toBeNull();
    expect(findPhrase(indexWords(W("and its lid", 0)), "and it's lid")).toBeNull();
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
      [{ id: "s", template: "DimCaption", start: "Ionization", durationSec: 4, props: { headline: { text: "Ionization is quick on open flame,", words: true } } }],
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
      [{ id: "s", template: "DimCaption", start: "Ionization", end: "read the label", props: { headline: { text: "Ionization is quick on open flame,", words: true } } }],
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

  // (only where nothing ends it sooner: the next-sentence cap and a snap back onto a cut can — the
  // planner and QA hold the floor, planner.test.ts / qa.test.ts)
  it("holds a short line for MIN_ON_SCREEN_SEC, and a title keeps its planned length", () => {
    const [short] = resolveCues([{ id: "h", template: "TitleOverFootage", start: "take one alarm", end: "read the label", props: { phrase: { text: "take one alarm down,", words: true } } }], words);
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
        { id: "a", template: "TitleOverFootage", start: "keep it simple", durationSec: 2, props: { phrase: { text: "keep it simple", words: true } } },
        { id: "b", template: "ChapterLabel", start: "now the label", durationSec: 3, props: {} },
      ],
      ws,
      { structural: new Set(["ChapterLabel"]) }
    );
    expect(b.start - a.end).toBeLessThan(HANDOFF_GAP_SEC);
    expect(a.end).toBeGreaterThanOrEqual(a.start + MIN_ON_SCREEN_SEC - 0.04);
    const [a2] = resolveCues(
      [
        { id: "a", template: "TitleOverFootage", start: "keep it", durationSec: 2, props: { phrase: { text: "keep it", words: true } } },
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
        { id: "a", template: "TitleOverFootage", start: "keep it simple", props: { phrase: { text: "keep it simple", words: true } } },
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
    const spec = { id: "h", template: "TitleOverFootage", start: "a bedroom", props: { phrase: { text: "a bedroom goes up in about 3 minutes", words: true } } };
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
  const cap = (text: string, start = "And hang") => ({ id: "c", template: "TitleOverFootage", start, props: { phrase: { text, words: true } } });

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
    expect(() => resolveCues([{ id: "p", template: "TitleOverFootage", start: "Put the", props: { phrase: { text: "Put the items along the front edge", words: true } } }], paused)).not.toThrow();
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
    expect(c.conformed.end).toBe(true); // held, or snapped onto the cut by its reading time
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

describe("a list window opens on its first item's picture (Dale 0:18)", () => {
  const W8 = (s: string, start: number, step = 0.3): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.26 }));
  // "Today I'm ranking | Etsy, | Facebook Marketplace…" — the cutting-board shot runs to the Etsy cut.
  const words = W8("Today I'm ranking Etsy, Facebook Marketplace, and craft fairs.", 18.3);
  const etsy = words.find(w => w.text === "Etsy,")!;
  const etsyCut = etsy.start - 0.1;
  const spec = {
    id: "w",
    template: "ListWindow",
    start: "Today I'm ranking",
    props: { title: "Where to sell", items: [{ text: "Etsy", at: "@Etsy", say: "Etsy" }, { text: "Facebook Marketplace", at: "@Facebook Marketplace", say: "Facebook Marketplace" }] },
  };
  it("starts on the cut to the first item's picture, never over the shot before", () => {
    const [c] = resolveCues([spec], words, { cuts: [14.5, etsyCut], fullFrame: new Set(["ListWindow"]) });
    expect(c.start).toBeCloseTo(Math.round(etsyCut * 30) / 30, 2);
    expect((c.props.items as { at: number }[])[0].at).toBe(0);
  });
  it("keeps its start when the picture does not change at the first item", () => {
    const [c] = resolveCues([spec], words, { cuts: [14.5], fullFrame: new Set(["ListWindow"]) });
    expect(c.start).toBeCloseTo(18.3, 1);
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
    // it leaves WITH the picture: since round 11 the end snaps onto the cut by itself (the cut comes
    // within MAX_LINGER_SEC of where its sentence finished), so the hold has nothing left to do — and
    // the hold's verdict on that cut is still what QA reads
    expect(c.conformed.end).toBe(true);
    expect(c.hold).toEqual({ cut: c.end, max: 3.5 }); // nothing more is said before the cut
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

describe("statement cards show a whole sentence; every graphic is up long enough to read (2026-10-17)", () => {
  const W8 = (s: string, start: number, step = 0.3): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.26 }));
  it("refuses Dale's quote stopped at a comma, and takes the whole sentence (job 389, 3:56)", () => {
    const words = [...W8("where you live.", 234.8), ...W8("Build it well, price it honest, and let every piece find its lane.", 236.04)];
    const quote = (text: string) => ({ id: "q", template: "Quote", start: "Build it", props: { quote: { text, words: true }, author: "Dale Oakfield" } });
    expect(() => resolveCues([quote("Build it well, price it honest,")], words)).toThrow(/not a whole sentence/);
    expect(() => resolveCues([quote("Build it well, price it honest, and let every piece find its lane.")], words)).not.toThrow();
  });
  it("keeps Scarlett's '2 inches lower' up long enough to read, and leaves it in a pause (job 392, 0:13)", () => {
    // "Land two inches lower, and that same necklace drags | your chin…" — a pause after "drags"
    const words = [...W8("Land two inches lower, and that same necklace drags", 12.44), ...W8("your chin and your jawline down with it.", 15.6)];
    const [c] = resolveCues(
      [{ id: "n", template: "BigNumberOverlay", start: "Land two", props: { kicker: "Too low", value: 2, unit: "inches lower", at: "@two inches", line: { text: "Land two inches lower,", words: true } } }],
      words
    );
    expect(c.readSec).toBeGreaterThanOrEqual(3.5);
    // It does not end as soon as its words do (the complaint: 1.8 s): once "…, and that same necklace
    // drags" begins — a new clause it does not show — its line counts as read when it was said, and
    // "Too low / 2 inches lower" is still given its time (round 13, job 408's "9 things").
    expect(c.newClauseAt).toBeCloseTo(words.find(w => w.text === "and")!.start, 3);
    expect(c.readAlongSec).toBeCloseTo(2.5, 3);
    expect(c.end - c.start).toBeGreaterThanOrEqual(c.readAlongSec! - 0.05);
    expect(c.end - words.find(w => w.text === "lower,")!.end).toBeGreaterThan(1.5);
    // it leaves in the pause before "your", not inside a word
    expect(words.some(w => w.start < c.end - 0.01 && w.end > c.end + 0.01)).toBe(false);
    expect(c.end).toBeGreaterThan(words.find(w => w.text === "drags")!.end);
    expect(c.end).toBeLessThan(words.find(w => w.text === "your")!.start);
  });
  it("a Versus side is not judged before it has been said (Scarlett's 'Polished metal', job 392, 0:54)", () => {
    const words = W8("A pearl doesn't bounce light back at you the way a polished metal does. It scatters it.", 51.82);
    const [c] = resolveCues(
      [{ id: "v", template: "Versus", start: "A pearl", props: { winner: "left", left: { title: "Pearl", at: "@A pearl", say: "A pearl doesn't bounce light back" }, right: { title: "Polished metal", at: "@a polished metal", say: "the way a polished metal does" } } }],
      words,
      { cards: new Set(["Versus"]) }
    );
    const right = c.props.right as { at: number; saidUntil: number };
    const does = words.find(w => w.text === "does.")!;
    expect(c.start + right.saidUntil).toBeCloseTo(does.end, 2);
    expect(c.contentEnd!).toBeGreaterThanOrEqual(does.end + VERDICT_SEC - 0.01);
  });
});

describe("a graphic that crosses a shot change stays a second on the new shot (Scarlett's dark beads, job 395)", () => {
  const W9 = (s: string, start: number, step = 0.3): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.26 }));
  it("is held a full second past the cut instead of leaving a sliver on it", () => {
    const words = [...W9("Chunky black or very dark beads.", 151.24), ...W9("Those beads absorb light.", 154.0)];
    const beads = words.find(w => w.text === "beads.")!;
    const cut = beads.start + 0.3; // too close after the last word to end there
    const [c] = resolveCues([{ id: "w", template: "WarningLabel", start: "Chunky black", props: { text: { text: "Chunky black or very dark beads.", words: true } } }], words, { cuts: [cut] });
    expect(c.end - cut).toBeGreaterThanOrEqual(TAIL_SPILL_SEC - 0.04);
  });
});

describe("a caption shows the whole sentence, paging a long one (Dale's closing line, job 397)", () => {
  const W10 = (t: string, start: number, step = 0.3): Word[] => t.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.26 }));
  const words = [...W10("where you live.", 234.8), ...W10("Build it well, price it honest, and let every piece find its lane.", 236.04)];
  const cap = (text: string) => ({ id: "h", template: "HostCaption", start: "Build it", props: { phrase: { text, words: true } } });
  it("refuses a caption stopped at a comma, and takes the whole sentence", () => {
    expect(() => resolveCues([cap("Build it well, price it honest,")], words)).toThrow(/not a whole sentence/);
    expect(() => resolveCues([cap("Build it well, price it honest, and let every piece find its lane.")], words)).not.toThrow();
  });
  it("pages a long line at a comma, never leaving one or two words alone", () => {
    const w = "Build it well, price it honest, and let every piece find its lane.".split(" ");
    expect(pageStarts(w, 8)).toEqual([0, 6]);
    expect(pageStarts(w.slice(0, 7), 8)).toEqual([0]);
    expect(pageStarts("one two three four five six seven eight nine".split(" "), 8)).toEqual([0]);
  });
});

describe("a title label is never left on the next shot for a moment (Frederick's chapter 3, job 396)", () => {
  it("stays a second past a cut that falls inside its planned length", () => {
    const words: Word[] = [{ text: "Third", start: 160.34, end: 160.56 }, { text: "thing,", start: 160.6, end: 160.9 }, { text: "interconnection.", start: 161.86, end: 162.6 }];
    const [c] = resolveCues([{ id: "c", template: "ChapterLabel", start: "Third thing", durationSec: 2, props: { title: "Interconnection", number: 3 } }], words, { cuts: [160.23, 161.6], structural: new Set(["ChapterLabel"]) });
    expect(c.end - 161.6).toBeGreaterThanOrEqual(TAIL_SPILL_SEC - 0.04);
  });
});

describe("a card holds through silence until the picture changes (Dale's '$10 in fees', job 397)", () => {
  it("holds 2.2 s after its last word when nothing is said before the cut", () => {
    const words: Word[] = [
      { text: "roughly", start: 140.0, end: 140.32 }, { text: "$10", start: 140.34, end: 140.62 }, { text: "off", start: 140.64, end: 140.72 },
      { text: "a", start: 140.74, end: 140.76 }, { text: "$100", start: 140.78, end: 140.94 }, { text: "board.", start: 141.0, end: 141.18 },
      { text: "But", start: 143.56, end: 143.79 },
    ];
    const [c] = resolveCues([{ id: "n", template: "BigNumber", start: "roughly", props: { value: 10, prefix: "$", unit: "in fees", at: "@$10" } }], words, { cuts: [138.2, 143.37], cards: new Set(["BigNumber"]) });
    expect(c.end).toBeCloseTo(143.37, 1);
    expect(c.conformed.held).toBe(true);
  });
});

describe("nothing outlasts the film, and the film's end never leaves a graphic too short to read", () => {
  const FPS = 30;
  const cue = (id: string, template: string, startFrame: number, endFrame: number) =>
    ({ id, template, start: startFrame / FPS, end: endFrame / FPS, startFrame, endFrame, props: { durationSec: (endFrame - startFrame) / FPS }, sync: [], conformed: { start: false, end: false } }) as ResolvedCue;
  const lastFrame = 5399; // a 3-minute film

  it("a graphic the end cuts to 1.2 s is left out (it used to ship at a second, and QA failed the film for it)", () => {
    const cues = [cue("outro-line", "TitleOverFootage", 5363, 5420)];
    expect(endWithFilm(cues, lastFrame, FPS)).toEqual(["outro-line"]);
    expect(cues).toEqual([]);
  });

  it("one the end leaves at 1.5 s — or a frame under it — ends on the last frame and stays", () => {
    const cues = [cue("exact", "TitleOverFootage", 5354, 5420), cue("frame-short", "BigNumberOverlay", 5355, 5430)];
    expect(endWithFilm(cues, lastFrame, FPS)).toEqual([]);
    expect(cues.map(c => [c.endFrame, c.props.durationSec])).toEqual([
      [lastFrame, 45 / FPS],
      [lastFrame, 44 / FPS],
    ]);
    expect(cues[0].end).toBeCloseTo(lastFrame / FPS, 6);
  });

  it("a graphic the end does not touch keeps its length: Dale's approved 1.27 s '3 piles' is QA's to report (job 397); under a second is still left out", () => {
    const cues = [cue("three-piles", "BigNumberOverlay", 1446, 1484), cue("chapter-3-ad-fee", "ChapterLabel", 4067, 4109), cue("edited-away", "BigNumberOverlay", 2000, 2025)];
    expect(endWithFilm(cues, lastFrame, FPS)).toEqual(["edited-away"]);
    expect(cues.map(c => [c.id, c.endFrame - c.startFrame])).toEqual([
      ["three-piles", 38],
      ["chapter-3-ad-fee", 42],
    ]);
  });
});

/** Words as the transcriber timed them: "text@start-end …" (round 11's practice films, as heard). */
const heard = (s: string): Word[] =>
  s.split(" ").map(t => {
    const [text, range] = t.split("@");
    const [start, end] = range.split("-").map(Number);
    return { text, start, end };
  });

describe("a graphic leaves WITH the picture instead of fading out into the cut (Walter Wren, job 404: 'flicker before a cut at 10.40 s, 42.63 s')", () => {
  const FPS = 30;
  // Its first two graphics, with the film's picture cuts (frames 171, 312, 1159, 1279). Each was carried
  // through the rest of its own sentence by its reading time and the pause, and ended 2 frames before
  // the cut: the snap onto it was refused, measured from its own last word ("quiet," 7.88; "seven" /
  // "things" 40.07), and its darkening faded out over those frames, lifting the old shot right before
  // the cut.
  const words = heard(
    "Florida.@4.62-5.12 The@5.82-5.92 song@5.98-6.30 at@6.36-6.44 first@6.50-6.76 light@6.84-7.08 goes@7.12-7.36 quiet,@7.46-7.88 the@8.34-8.44 grass@8.48-8.84 sits@8.88-9.12 empty@9.28-9.58 in@9.62-9.68 the@9.72-9.78 mornings,@9.84-10.24 and@10.66-10.78 nobody@10.90-11.28 " +
      "one's@37.43-37.61 for@37.67-37.81 you.@37.85-38.07 We're@38.73-38.91 going@38.93-39.11 through@39.15-39.37 seven@39.49-39.77 things@39.83-40.07 about@40.15-40.35 the@40.39-40.47 robin@40.53-40.87 that@40.89-41.03 hardly@41.09-41.41 anybody@41.65-42.07 knows,@42.11-42.47 and@42.81-42.89 by@42.93-43.05 the@43.09-43.17 end,@43.31-43.49"
  );
  const title: CueSpec = { id: "title-song-goes-quiet", template: "TitleOverFootage", start: "The song at first light goes", startPad: -0.15, end: "at first light goes quiet", endPad: 0.3, props: { kicker: "Winter robins", phrase: { text: "The song at first light goes quiet", words: true }, emphasis: ["quiet"] } };
  const seven: CueSpec = { id: "seven-things", template: "BigNumberOverlay", start: "We’re going through seven things about", startPad: -0.15, end: "seven things about the robin", endPad: 0.3, props: { at: "@seven", line: { text: "We’re going through", words: true }, unit: "things", value: 7, kicker: "Robin facts", countSec: 0.6 } };
  const cuts = [171, 312, 1159, 1279].map(f => f / FPS);

  it("both end ON their cut, with no fade: the snap is measured from where the sentence finished ('mornings,' 10.24; 'knows,' 42.47)", () => {
    const [t, s] = resolveCues([title, seven], words, { cuts, fps: FPS, ...resolveSets() });
    expect([t.startFrame, t.endFrame, s.startFrame, s.endFrame]).toEqual([171, 312, 1159, 1279]);
    for (const c of [t, s]) {
      expect(c.conformed.end, c.id).toBe(true);
      expect(c.props.exit, c.id).toBe("cut");
      // QA measures from the same point and does not call it lingering
      expect(stillUpAfterWords(c, FPS), c.id).toBe(false);
    }
    expect([t.spokenEnd, s.spokenEnd]).toEqual([10.24, 42.47]);
  });

  it("reading time alone still earns no snap: the same title with its sentence ending on 'quiet.' stays off a cut 2.1 s after it", () => {
    const short = heard("Florida.@4.62-5.12 The@5.82-5.92 song@5.98-6.30 at@6.36-6.44 first@6.50-6.76 light@6.84-7.08 goes@7.12-7.36 quiet.@7.46-7.88");
    const [t] = resolveCues([title], short, { cuts: [5.7, 10.0], fps: FPS, ...resolveSets() });
    expect(t.end).toBeCloseTo(9.7, 3); // its reading time (4 s), then it leaves
    expect(t.conformed.end).toBe(false);
  });
});

describe("a quote over the blurred picture is held to the cut like a card (Sawdust Sam, job 407 at 2:45)", () => {
  const FPS = 30;
  // The Quote blurs the whole picture. It ended on "tire." + its tail, 0.54 s before the cut to the host
  // (frames 4814, 4973), and the sharp picture — a drawn face — blinked up for 16 frames.
  const words = heard(
    "year.@159.04-159.34 Keep@160.58-160.78 your@160.82-160.98 boots@161.02-161.30 clear@161.40-161.64 of@161.68-161.74 the@161.78-161.88 swing@161.96-162.42 and@162.90-163.00 stop@163.14-163.58 when@163.72-163.86 your@163.88-164.08 arms@164.24-164.48 tire.@164.58-164.94 The@165.88-166.00 logs@166.08-166.50 still@166.66-166.98"
  );
  const quote: CueSpec = { id: "boots-clear-quote", template: "Quote", start: "Keep your boots clear of", startPad: -0.15, end: "when your arms tire", endPad: 0.3, props: { quote: { text: "Keep your boots clear of the swing, and stop when your arms tire.", words: true }, author: "Sam", emphasis: ["boots"] } };
  const cuts = [4814, 4973].map(f => f / FPS);
  const sets = resolveSets();

  it("replaces the picture by the registry, and is no window", () => {
    expect(replacesPicture(templateById("Quote"))).toBe(true);
    expect(sets.fullFrame.has("Quote")).toBe(true);
    expect(sets.windows.has("Quote")).toBe(false);
    expect(sets.windows).toEqual(new Set(["TermWindow", "ListWindow", "HostListWindow"]));
    // a darkening alone leaves the picture in view
    for (const id of ["DimCaption", "TitleOverFootage", "BigNumberOverlay", "ArrowCaption", "BarChart"]) expect(replacesPicture(templateById(id)), id).toBe(false);
  });

  it("held through the silence to the cut — the shipped film had it end 0.54 s short", () => {
    const [q] = resolveCues([quote], words, { cuts, fps: FPS, ...sets });
    expect([q.startFrame, q.endFrame]).toEqual([4814, 4973]);
    expect(q.conformed).toEqual({ start: true, end: true, held: true });
    expect(blinkBeside(q, [4814, 4973], FPS)).toBeUndefined();
    expect(stillUpAfterWords(q, FPS)).toBe(false);
    const [old] = resolveCues([quote], words, { cuts, fps: FPS, ...sets, fullFrame: new Set(["Statement"]), windows: new Set() });
    expect([old.startFrame, old.endFrame]).toEqual([4814, 4957]);
    expect(blinkBeside(old, [4814, 4973], FPS)).toEqual({ side: "after", cutFrame: 4973, sec: 16 / FPS });
  });
});

describe("a blink of footage is one test, on frames (blinkBeside)", () => {
  const FPS = 30;
  const at = (startFrame: number, endFrame: number) => ({ startFrame, endFrame });
  it("the shot after the graphic, under 1.5 s: job 404's Versus (0.80 s) and job 403's Statement (1.23 s)", () => {
    expect(blinkBeside(at(2492, 2640), [2411, 2664, 2936], FPS)).toEqual({ side: "after", cutFrame: 2664, sec: 24 / FPS });
    expect(blinkBeside(at(3727, 3785), [3542, 3727, 3822], FPS)).toEqual({ side: "after", cutFrame: 3822, sec: 37 / FPS });
  });
  it("the shot before it, under 1.5 s", () => {
    expect(blinkBeside(at(3020, 3200), [3000, 3400], FPS)).toEqual({ side: "before", cutFrame: 3000, sec: 20 / FPS });
  });
  it("none when it leaves with the picture, opens on it, or leaves 1.5 s of the shot either side", () => {
    expect(blinkBeside(at(2492, 2664), [2411, 2664, 2936], FPS)).toBeUndefined();
    expect(blinkBeside(at(2411, 2600), [2411, 2664, 2936], FPS)).toBeUndefined();
    expect(blinkBeside(at(2456, 2619), [2411, 2664], FPS)).toBeUndefined();
    expect(blinkBeside(at(2492, 2640), [], FPS)).toBeUndefined();
  });
});

describe("a graphic's own words end where a new clause begins (job 408's '9 things', round 13)", () => {
  const FPS = 30;
  // Werner's job 408, 21.5-30.3 s as heard, and its picture cuts (scene 5 starts at 22.27, scene 6 at 30.03).
  const toilet = heard(
    "can.@21.495-21.775 Nine@22.456-22.696 things@22.776-23.056 stay@23.116-23.356 out@23.456-23.576 of@23.616-23.656 the@23.696-23.776 toilet@23.836-24.216 there,@24.236-24.476 and@24.916-25.016 in@25.056-25.116 plenty@25.236-25.596 of@25.636-25.696 American@25.756-26.156 homes,@26.196-26.516 most@26.937-27.157 of@27.177-27.237 them@27.277-27.437 go@27.477-27.637 down@27.697-27.937 it@27.997-28.077 in@28.157-28.217 an@28.257-28.317 ordinary@28.457-28.897 week.@28.957-29.217 One@30.199-30.319"
  );
  const cuts = [13.75, 22.27, 30.03];
  // The plan as stored on the job.
  const nine: CueSpec = { id: "nine-things-out", template: "BigNumberOverlay", start: "Nine things stay out of", startPad: -0.15, end: "the toilet there,", endPad: 0.3, props: { at: "@Nine", line: { text: "Nine things stay out of the toilet there", words: true }, unit: "things", value: 9, kicker: "Out of the toilet", countSec: 0.6 } };

  it("its own words stop at 'there,': '…, and in plenty of American homes,' is a new clause, the contrast it sets up", () => {
    const there = toilet.find(w => w.text === "there,")!;
    const own = ownSentenceEnd(toilet, there.end, 31);
    expect(own.spoken).toBe(there.end);
    expect(own.newClauseAt).toBe(24.916);
    // the whole sentence still runs to "week.", and the next one starts at "One"
    expect([own.sentenceSpoken, own.newLineAt]).toEqual([29.217, 30.199]);
  });

  it("the rest of a clause is still its own: job 404's '7 things | about the robin that hardly anybody knows,', its title's 'quiet, the grass…', and a relative clause after a comma", () => {
    const robin = heard("seven@39.49-39.77 things@39.83-40.07 about@40.15-40.35 the@40.39-40.47 robin@40.53-40.87 that@40.89-41.03 hardly@41.09-41.41 anybody@41.65-42.07 knows,@42.11-42.47 and@42.81-42.89 by@42.93-43.05");
    expect(ownSentenceEnd(robin, 40.07, 44)).toMatchObject({ spoken: 42.47, newClauseAt: 42.81 });
    const quiet = heard("goes@7.12-7.36 quiet,@7.46-7.88 the@8.34-8.44 grass@8.48-8.84 sits@8.88-9.12 empty@9.28-9.58 in@9.62-9.68 the@9.72-9.78 mornings,@9.84-10.24");
    expect(ownSentenceEnd(quiet, 7.88, 10.4)).toEqual({ spoken: 10.24, sentenceSpoken: 10.24 });
    const which = heard("things@39.83-40.07 about@40.15-40.35 the@40.39-40.47 robin,@40.53-40.87 which@40.99-41.13 hardly@41.19-41.51 anybody@41.65-42.07 knows.@42.11-42.47");
    expect(ownSentenceEnd(which, 40.07, 43).spoken).toBe(42.47);
  });

  it("leaves 0.6 s after 'there,' instead of 2.1 s into the new clause: its line was read as he said it", () => {
    const [c] = resolveCues([nine], toilet, { cuts, fps: FPS, ...resolveSets() });
    // shipped: 22.267-26.600, carried by its 4 s reading time (14 words) and the pause after "homes,"
    expect([c.start, c.end]).toEqual([22.267, 25.1]);
    expect(c.readSec).toBe(4);
    // still to read once "and…" began: "Out of the toilet / 9 things", 6 words
    expect(c.readAlongSec).toBeCloseTo(readAlongSec(nine.props), 3);
    expect(readAlongSec(nine.props)).toBeCloseTo(2.8, 6);
    expect(c.spokenEnd).toBe(24.476);
    expect(c.newClauseAt).toBe(24.916);
    // up long enough for what it shows, and gone before "plenty"
    expect(c.end - c.start).toBeGreaterThanOrEqual(MIN_ON_SCREEN_SEC);
    expect(c.end).toBeLessThan(toilet.find(w => w.text === "plenty")!.start);
    expect(stillUpAfterWords(c, FPS)).toBe(false);
  });

  it("the same card as it shipped is still up after its words", () => {
    const [c] = resolveCues([nine], toilet, { cuts, fps: FPS, ...resolveSets() });
    const shipped = { ...c, end: 26.6, endFrame: 798, leftInPause: true };
    expect(stillUpAfterWords(shipped, FPS)).toBe(true);
  });

  it("a graphic with no word-by-word line keeps its whole reading time over a new clause: Dale's 'Shop open at / 2 a.m.' (job 397, 1:20)", () => {
    const shop = heard(
      "Your@79.338-79.518 shop@79.578-79.818 is@79.899-79.979 open@80.059-80.259 at@80.299-80.379 two@80.499-80.719 in@80.759-80.839 the@80.859-80.959 morning,@81.019-81.38 and@81.58-81.68 a@81.72-81.76 buyer@81.82-82.18 three@82.3-82.58 states@82.641-82.941 away,@83.021-83.401 hunting@83.561-83.901"
    );
    const spec: CueSpec = { id: "shop-open-2am", template: "BigNumberOverlay", start: "Your shop is open at two", startPad: -0.15, end: "two in the morning,", endPad: 0.3, props: { at: "@two in the morning,", unit: "a.m.", value: 2, kicker: "Shop open at", countSec: 0.6 } };
    const [c] = resolveCues([spec], shop, { cuts: [75.26, 79.21, 89.39], fps: FPS, ...resolveSets() });
    expect([c.start, c.end]).toEqual([80.2, 82.933]); // as the film had it
    expect(c.readAlongSec).toBe(c.readSec);
    expect(stillUpAfterWords(c, FPS)).toBe(false);
  });
});

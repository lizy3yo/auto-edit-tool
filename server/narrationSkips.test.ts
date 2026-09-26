import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WhisperWord } from "./_core/voiceTranscription";
import {
  findSkippedWords,
  paragraphSpan,
  repairSkippedNarration,
  SkippedNarrationError,
  splicedWords,
  type RepairDeps,
} from "./narrationSkips";

/** Hank's real master (job 162), 24.8–35.5 s, as whisperx heard it: the voice read "…and a stack."
 * and went straight on to "Folks will tell you", skipping the rest of the sentence. */
const HEARD: [number, number, string][] = [
  [24.79, 24.93, "over"], [24.99, 25.15, "for"], [25.19, 25.27, "it."],
  [26.13, 26.25, "I'm"], [26.29, 26.47, "Hank"], [26.49, 26.91, "Hardwood"],
  [27.05, 27.15, "and"], [27.19, 27.33, "this"], [27.41, 27.55, "one's"],
  [27.61, 27.73, "for"], [27.85, 28.21, "anybody"], [28.25, 28.57, "standing"],
  [28.61, 28.67, "in"], [28.69, 28.71, "a"], [28.75, 29.13, "garage"],
  [29.17, 29.29, "with"], [29.35, 29.37, "a"], [29.45, 29.81, "saw,"],
  [29.91, 29.95, "a"], [30.02, 30.34, "drill,"], [30.38, 30.45, "and"],
  [30.48, 30.5, "a"], [30.55, 30.88, "stack."], [31.09, 31.3, "Folks"],
  [31.32, 31.45, "will"], [31.48, 31.62, "tell"], [31.63, 31.74, "you"],
  [31.8, 32.22, "Japanese"], [32.24, 32.72, "woodworking"], [32.78, 32.98, "takes"],
  [33.04, 33.06, "a"], [33.12, 33.56, "master's"], [33.58, 33.88, "hands"],
  [33.96, 34.04, "and"], [34.08, 34.1, "a"], [34.16, 34.42, "wall"],
  [34.46, 34.62, "full"], [34.66, 34.72, "of"], [34.78, 35.16, "fancy"],
  [35.2, 35.54, "saws."],
];
const words = (rows = HEARD): WhisperWord[] =>
  rows.map(([start, end, word]) => ({ word, start, end }));

const PARAS = [
  "and what people actually handed over for it.",
  "I'm Hank Hardwood, and this one's for anybody standing in a garage with a saw, a drill, and a stack of sandpaper, wondering if that clean Japanese look is really worth anything on a market table. Folks will tell you Japanese woodworking takes a master's hands and a wall full of fancy saws.",
];
const SAID = [
  PARAS[0],
  "I'm Hank Hardwood, and this one's for anybody standing in a garage with a saw, a drill, and a stack. Folks will tell you Japanese woodworking takes a master's hands and a wall full of fancy saws.",
];

describe("findSkippedWords", () => {
  it("finds the words Hank's voice skipped, in the right paragraph and place", () => {
    const skips = findSkippedWords(PARAS, words(), 36);
    expect(skips).toHaveLength(1);
    expect(skips[0].paragraphs).toEqual([1]);
    expect(skips[0].missing).toBe(
      "of sandpaper wondering if that clean japanese look is really worth anything on a market table"
    );
    expect(skips[0].atSec).toBeCloseTo(30.88);
    expect(skips[0].toSec).toBeCloseTo(31.09);
  });

  it("passes a read that says every word", () => {
    expect(findSkippedWords(SAID, words(), 36)).toEqual([]);
  });

  it("does not call a transcript HOLE a skip — the time for the words is there", () => {
    // whisper missed "Folks will tell you Japanese woodworking", but the audio has room for it.
    const hole = HEARD.filter(([s]) => s < 31 || s > 32.7);
    expect(findSkippedWords(SAID, words(hole), 36)).toEqual([]);
  });

  it("does not call misheard words a skip", () => {
    const misheard = HEARD.map(r =>
      r[2] === "Japanese" ? ([r[0], r[1], "Japan-knees"] as typeof r) : r
    );
    expect(findSkippedWords(SAID, words(misheard), 36)).toEqual([]);
  });

  it("does not call a price written as digits a skip", () => {
    // Hannah (job 167) says "a dollar and thirty cents"; whisper writes "$1.30".
    const said = ["It sold for about a dollar and thirty cents an hour, which is not much."];
    const heard: [number, number, string][] = [
      [0, 0.1, "It"], [0.15, 0.3, "sold"], [0.35, 0.45, "for"], [0.5, 0.8, "about"],
      [0.85, 2.0, "$1.30"], [2.05, 2.2, "an"], [2.25, 2.5, "hour,"], [2.6, 2.8, "which"],
      [2.85, 2.95, "is"], [3.0, 3.2, "not"], [3.25, 3.6, "much."],
    ];
    expect(findSkippedWords(said, words(heard), 4)).toEqual([]);
  });

  it("finds a whole paragraph the voice left out", () => {
    const three = [PARAS[0], "Number ten. The lattice panel, the one I was proudest of.", SAID[1]];
    const skips = findSkippedWords(three, words(), 36);
    expect(skips).toHaveLength(1);
    expect(skips[0].paragraphs).toEqual([1]);
  });
});

describe("paragraphSpan", () => {
  it("covers every sound of the paragraph and none of its neighbours", () => {
    const span = paragraphSpan(PARAS, words(), 1, 36);
    expect(span.fromSec).toBeGreaterThan(25.27);
    expect(span.fromSec).toBeLessThanOrEqual(26.13);
    expect(span.toSec).toBeGreaterThanOrEqual(35.54);
  });
});

describe("splicedWords", () => {
  it("places the new read's words and moves everything after by the difference", () => {
    const master: WhisperWord[] = [
      { word: "one", start: 0, end: 0.5 },
      { word: "old", start: 1, end: 1.5 },
      { word: "three", start: 3, end: 3.5 },
    ];
    const { words: out, shiftSec } = splicedWords(master, [
      {
        fromSec: 0.9,
        toSec: 1.6,
        keepFromSec: 0.2,
        keepToSec: 2.2, // 2 s of new read replacing 0.7 s of old
        words: [
          { word: "new", start: 0.3, end: 0.8 },
          { word: "read", start: 1.2, end: 2.1 },
        ],
      },
    ]);
    expect(shiftSec).toBeCloseTo(1.3);
    expect(out.map(w => w.word)).toEqual(["one", "new", "read", "three"]);
    expect(out[1].start).toBeCloseTo(1.0);
    expect(out[3].start).toBeCloseTo(4.3);
  });
});

describe("repairSkippedNarration", () => {
  const fixedRead = words(
    SAID[1]
      .replace("a stack.", "a stack of sandpaper, wondering if that clean Japanese look is really worth anything on a market table.")
      .split(" ")
      .map((w, k) => [0.2 + k * 0.3, 0.45 + k * 0.3, w] as [number, number, string])
  );
  const deps = (heard: WhisperWord[]): RepairDeps & { args: string[][]; voiced: number } => {
    const d = {
      args: [] as string[][],
      voiced: 0,
      voice: async () => {
        d.voiced++;
        return Buffer.from("take");
      },
      transcribe: async () => ({ words: heard, duration: heard[heard.length - 1].end + 0.3 }),
      matchLevel: async (b: Buffer) => b,
      durationOf: async () => 10,
      runFfmpeg: async (a: string[]) => {
        d.args.push(a);
        writeFileSync(a[a.length - 1], "spliced");
      },
      log: () => {},
    };
    return d;
  };

  it("re-reads the paragraph that skipped and splices it in place", async () => {
    const d = deps(fixedRead);
    const r = await repairSkippedNarration(
      { paragraphs: PARAS, words: words(), durationSec: 36, master: Buffer.from("m") },
      d
    );
    expect(r?.fixed).toEqual([1]);
    expect(d.voiced).toBe(1);
    expect(r?.master.toString()).toBe("spliced");
    // The new timeline says every word, so the check now passes on it.
    expect(findSkippedWords(PARAS, r!.words, r!.durationSec)).toEqual([]);
    expect(d.args[0].join(" ")).toContain("concat=n=3");
  });

  it("does nothing when every word was said", async () => {
    const d = deps(fixedRead);
    expect(
      await repairSkippedNarration(
        { paragraphs: SAID, words: words(), durationSec: 36, master: Buffer.from("m") },
        d
      )
    ).toBeNull();
    expect(d.voiced).toBe(0);
  });

  it("stops the job when the re-reads keep skipping", async () => {
    const d = deps(words());
    await expect(
      repairSkippedNarration(
        { paragraphs: PARAS, words: words(), durationSec: 36, master: Buffer.from("m") },
        { ...d, transcribe: async () => ({ words: words().map(w => ({ ...w, start: w.start - 24, end: w.end - 24 })), duration: 12 }) }
      )
    ).rejects.toBeInstanceOf(SkippedNarrationError);
  });
});

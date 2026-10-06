import { describe, expect, it } from "vitest";
import type { WhisperWord } from "./_core/voiceTranscription";
import type { StoryboardScene } from "../shared/types";
import {
  CONTEXT_MAX_WORDS,
  bodyRangeInRead,
  contextReadText,
  firstSentence,
  lastSentence,
  voiceContextFor,
} from "./voiceRedo";

const scenes = [
  {
    index: 1,
    narration: "Welcome back to the shop. Today we build a small shelf.",
  },
  { index: 2, narration: "It takes one board and about an hour," },
  { index: 3, narration: "and it sells well at a market. Here is how it goes." },
] as StoryboardScene[];

/** A transcript of `text` with every word `wordSec` long and `gapSec` of silence after it. */
function read(text: string, wordSec = 0.3, gapSec = 0.05): WhisperWord[] {
  let t = 0;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map(word => {
      const w = { word, start: t, end: t + wordSec };
      t += wordSec + gapSec;
      return w;
    });
}

describe("what is read for a voice redo", () => {
  it("reads the scene between the line before and the line after", () => {
    const ctx = voiceContextFor(scenes, scenes[1]);
    expect(ctx).toEqual({
      lead: "Today we build a small shelf.",
      body: "It takes one board and about an hour,",
      tail: "and it sells well at a market.",
    });
    expect(contextReadText(ctx)).toBe(
      "Today we build a small shelf. It takes one board and about an hour, and it sells well at a market."
    );
  });

  it("has no lead on the first scene and no tail on the last", () => {
    expect(voiceContextFor(scenes, scenes[0]).lead).toBe("");
    expect(voiceContextFor(scenes, scenes[2]).tail).toBe("");
    expect(voiceContextFor(scenes, scenes[0]).tail).toBe(
      "It takes one board and about an hour,"
    );
  });

  it("caps the context so a long neighbour does not triple the read", () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    expect(lastSentence(long).split(" ")).toHaveLength(CONTEXT_MAX_WORDS);
    expect(firstSentence(long).split(" ")).toHaveLength(CONTEXT_MAX_WORDS);
    expect(lastSentence(long).endsWith("word79")).toBe(true);
    expect(firstSentence(long).startsWith("word0 ")).toBe(true);
  });
});

describe("where the scene's words sit in the read", () => {
  const ctx = voiceContextFor(scenes, scenes[1]);
  const words = read(contextReadText(ctx));
  const durationSec = words[words.length - 1].end;

  it("keeps exactly the scene's own words", () => {
    const range = bodyRangeInRead(ctx, words, durationSec);
    expect(range).not.toBeNull();
    // 6 lead words, 8 body words: the body starts on its first word and ends on its last.
    const first = words[6];
    const last = words[13];
    expect(range!.startSec).toBeGreaterThan(words[5].end - 0.01);
    expect(range!.startSec).toBeLessThanOrEqual(first.start + 0.01);
    expect(range!.endSec).toBeGreaterThanOrEqual(last.end - 0.01);
    expect(range!.endSec).toBeLessThanOrEqual(words[14].start + 0.01);
  });

  it("works with no lead (the film's first scene)", () => {
    const first = voiceContextFor(scenes, scenes[0]);
    const w = read(contextReadText(first));
    const range = bodyRangeInRead(first, w, w[w.length - 1].end);
    expect(range?.startSec).toBe(0);
    expect(range!.endSec).toBeLessThanOrEqual(w[11].start + 0.01);
  });

  it("gives nothing without a transcript, so the scene is voiced on its own", () => {
    expect(bodyRangeInRead(ctx, null, durationSec)).toBeNull();
    expect(bodyRangeInRead(ctx, [], durationSec)).toBeNull();
  });

  it("refuses a cut no real read of those words could have", () => {
    // The provider read only the lead and stopped: the body's words have no time of their own.
    const cutOff = read("Today we build a small shelf.");
    expect(
      bodyRangeInRead(ctx, cutOff, cutOff[cutOff.length - 1].end)
    ).toBeNull();
  });
});

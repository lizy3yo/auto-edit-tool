/**
 * AN INITIAL OR A SHORT FORM NEVER ENDS A SENTENCE (2026-10-20, job 417 scenes 16-17). The script
 * spelt "U. S." with a space; the storyboard's sentence units ended on "U.", the beat closed there
 * ("Number one. The whole can. On a lot of U." | "S. airlines, the flight attendant pours…"), and the
 * cut landed inside the spoken "U.S." (58.78-59.06) — the host's take stopped mid-word. Every splitter
 * and sentence-end test that cuts beats, pictures or host takes now asks `shared/sentenceEnds.ts`.
 */
import { describe, expect, it } from "vitest";
import type { LongformInputParams, StoryboardScene } from "@shared/types";
import {
  endsSentence,
  moveHostLeadIns,
  segmentScriptByDuration,
  splitIntoUnits,
  splitScriptForNarration,
  startsSentence,
} from "./longformVideo";
import { breakBetween, checkPlan } from "./planGate";
import { planSentencePauses, scriptSentenceEnds } from "./sentencePauses";
import { applyShotPlan, spokenListItems } from "./shotList";
import { splitSentences } from "./spokenLists";

/** Job 417's paragraph, word for word. */
const WHOLE_CAN =
  "Number one. The whole can. On a lot of U. S. airlines, the flight attendant pours your soda into a plastic cup packed with ice, fills it about halfway, and the rest of the can rolls off down the aisle on the cart. On many of those carriers, you can have the whole thing just by asking.";
/** Job 417's beats 16 and 17 as the storyboard cut them. */
const HOST_LINE = "Number one. The whole can. On a lot of U.";
const NEXT_LINE =
  "S. airlines, the flight attendant pours your soda into a plastic cup packed with ice, fills it about halfway, and the rest of the can rolls off down the aisle on the cart.";
/** Two stored scripts (jobs 310 and 351) that end a sentence on a letter said as a letter — they still end there. */
const SMALL_X =
  "Then give every peg one full circle of yarn, clockwise, that crosses over itself in a small X. Snug, but loose enough to slide your hook underneath.";
const THE_V =
  "A valley is just the low spot between two points, the bottom of the V. Every round, the tips get the add, the valleys get the take-away.";

describe("the storyboard's sentence units and beats (job 417)", () => {
  it("a unit never ends on an initial, and the units still tile the script", () => {
    const units = splitIntoUnits(WHOLE_CAN);
    expect(units.map(u => u.text)).toEqual([
      "Number one.",
      "The whole can.",
      "On a lot of U. S. airlines, the flight attendant pours your soda into a plastic cup packed with ice, fills it about halfway, and the rest of the can rolls off down the aisle on the cart.",
      "On many of those carriers, you can have the whole thing just by asking.",
    ]);
    expect(units.map(u => WHOLE_CAN.slice(u.start, u.end)).join("")).toBe(WHOLE_CAN);
  });

  it("no beat closes on 'U.' or 'S.' — the cut lands after 'airlines,'", () => {
    const chunks = segmentScriptByDuration(splitIntoUnits(WHOLE_CAN), WHOLE_CAN).map(c =>
      WHOLE_CAN.slice(c.start, c.end).trim()
    );
    expect(chunks.some(c => /\b[US]\.$/.test(c))).toBe(false);
    expect(chunks.some(c => /^S\./.test(c))).toBe(false);
    expect(chunks[0]).toBe("Number one. The whole can. On a lot of U. S. airlines,");
  });

  it("negative: real sentence ends still split, a letter said as a letter among them", () => {
    expect(splitIntoUnits(SMALL_X).map(u => u.text)).toEqual([
      "Then give every peg one full circle of yarn, clockwise, that crosses over itself in a small X.",
      "Snug, but loose enough to slide your hook underneath.",
    ]);
    expect(splitIntoUnits(THE_V)).toHaveLength(2);
    expect(splitIntoUnits("Is it worth asking? No. Not on that airline.")).toHaveLength(3);
    expect(splitIntoUnits("Ask Dr. Hale about it. Then ask again.").map(u => u.text)).toEqual([
      "Ask Dr. Hale about it.",
      "Then ask again.",
    ]);
  });

  it("a TTS request is never split between 'U.' and 'S.'", () => {
    const segments = splitScriptForNarration(WHOLE_CAN, 60);
    expect(segments.some(s => /\bU\.$/.test(s))).toBe(false);
    expect(segments.join(" ")).toBe(WHOLE_CAN);
  });
});

describe("endsSentence / startsSentence on job 417's stored beats", () => {
  it("the host line ending 'On a lot of U.' does not end a sentence; the next does not start one", () => {
    expect(endsSentence(HOST_LINE, NEXT_LINE)).toBe(false);
    expect(endsSentence(HOST_LINE)).toBe(false);
    const scenes = [
      { index: 1, scriptText: HOST_LINE, hostPresent: true },
      { index: 2, scriptText: NEXT_LINE },
    ] as StoryboardScene[];
    expect(startsSentence(scenes, 1)).toBe(false);
  });

  it("negative: 'The whole can.', 'So did I.' and 'a small X.' still end their sentences", () => {
    expect(endsSentence("Number one. The whole can.", "On a lot of U. S. airlines,")).toBe(true);
    expect(endsSentence("I figured that out late, and so did I.")).toBe(true);
    expect(endsSentence("clockwise, that crosses over itself in a small X.", "Snug, but loose enough to slide your hook underneath.")).toBe(true);
    expect(endsSentence("Is it worth asking? No.", "Not on that airline.")).toBe(true);
  });

  it("a host take that starts mid-sentence hands back up to a REAL sentence end, never 'U.'", () => {
    const scenes = [
      { index: 1, scriptText: "Today you're getting fourteen things, and the first is about the drinks on" },
      {
        index: 2,
        hostPresent: true,
        scriptText: "U. S. airlines, where the attendant pours half your soda. On many of those carriers, you can have the whole thing just by asking.",
      },
    ] as StoryboardScene[];
    expect(moveHostLeadIns(scenes)).toEqual([2]);
    expect(scenes[0].scriptText).toBe(
      "Today you're getting fourteen things, and the first is about the drinks on U. S. airlines, where the attendant pours half your soda."
    );
    expect(scenes[1].scriptText).toBe("On many of those carriers, you can have the whole thing just by asking.");
  });
});

/** A film laid end to end from [kind, seconds, text] rows, every piece cut on its words. */
function film(rows: ["H" | "P", number, string][]): StoryboardScene[] {
  let t = 0;
  return rows.map(([kind, sec, text], k) => {
    const s = {
      index: k + 1,
      scriptText: text,
      narration: text,
      visualPrompt: `picture ${k + 1}`,
      showSubject: `thing ${k + 1}`,
      hostPresent: kind === "H" ? true : undefined,
      stillImage: kind === "P" ? true : undefined,
      wordCut: true,
      narrationStartSec: t,
      narrationEndSec: t + sec,
      audioDuration: sec,
      audioUrl: `https://example.com/${k}.mp3`,
    } as StoryboardScene;
    t += sec;
    return s;
  });
}

describe("the plan gate (job 417, 0:55-1:09)", () => {
  const params = { faceImageUrl: "https://example.com/host.jpg", hostName: "Helena Hart" } as LongformInputParams;
  const lead = "Today you're getting fourteen things flight attendants will quietly hand over for free.";
  const tail = "On many of those carriers, you can have the whole thing just by asking.";

  it("a host take that stops on 'U.' stops mid-sentence, at no natural break", () => {
    expect(breakBetween(HOST_LINE, NEXT_LINE)).toBe(false);
    const scenes = film([
      ["P", 6, lead],
      ["H", 4, HOST_LINE],
      ["P", 10, NEXT_LINE],
      ["P", 4, tail],
    ]);
    const ends = checkPlan(scenes, params).findings.filter(f => f.rule === 7 && f.scene === 2);
    expect(ends.map(f => f.detail).join(" ")).toMatch(/ends mid-sentence/);
  });

  it("negative: a take that stops on a real sentence end, or before a name, still breaks", () => {
    expect(breakBetween("Number one. The whole can.", "On a lot of U. S. airlines,")).toBe(true);
    expect(breakBetween("clockwise, that crosses over itself in a small X.", "Snug, but loose enough to slide your hook underneath.")).toBe(true);
    const scenes = film([
      ["P", 6, lead],
      ["H", 4, "Number one. The whole can."],
      ["P", 10, `On a lot of U. S. airlines, ${NEXT_LINE.slice(NEXT_LINE.indexOf("the flight"))}`],
      ["P", 4, tail],
    ]);
    expect(checkPlan(scenes, params).findings.filter(f => f.rule === 7 && f.scene === 2)).toEqual([]);
  });
});

describe("the shot list never cuts between the letters of 'U. S.'", () => {
  const beat = {
    index: 1,
    scriptText: "On a lot of U. S. airlines, the flight attendant pours your soda into a plastic cup packed with ice.",
    narration: "On a lot of U. S. airlines",
    visualPrompt: "old picture",
  } as StoryboardScene;
  const after = { index: 2, scriptText: "And that is the next part of the story.", visualPrompt: "x" } as StoryboardScene;

  it("a shot that would start on 'S. airlines' is dropped", () => {
    const { scenes } = applyShotPlan(
      [beat, after],
      [{ scene: 1, shots: [{ from: "On a lot", show: "a jet on the runway" }, { from: "S. airlines", show: "an airline cabin" }] }]
    );
    expect(scenes[0].scriptText).toBe(beat.scriptText);
  });

  it("a host hand-off right after 'U.' is refused", () => {
    const host = { ...beat, hostPresent: true } as StoryboardScene;
    const { scenes } = applyShotPlan(
      [host, after],
      [{ scene: 1, hostUntil: "On a lot of U.", shots: [{ from: "S. airlines", show: "an airline cabin" }] }]
    );
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[0].scriptText).toBe(beat.scriptText);
  });

  it("negative: a shot starting on a whole word after 'U. S.' still cuts", () => {
    const { scenes } = applyShotPlan(
      [beat, after],
      [{ scene: 1, shots: [{ from: "On a lot", show: "a jet on the runway" }, { from: "the flight attendant", show: "a flight attendant pouring soda" }] }]
    );
    expect(scenes.slice(0, 2).map(s => s.scriptText)).toEqual([
      "On a lot of U. S. airlines,",
      "the flight attendant pours your soda into a plastic cup packed with ice.",
    ]);
  });
});

describe("the voice's sentence pauses", () => {
  const w = (word: string, start: number, end: number) => ({ word, start, end });

  it("no pause after 'U.S.' heard as one word, nor after 'U.' and 'S.' heard apart", () => {
    const heard = [w("of", 58.5, 58.7), w("U.S.", 58.78, 59.06), w("airlines,", 59.08, 59.6), w("the", 59.62, 59.7)];
    expect(planSentencePauses(heard, 0.5)).toEqual([]);
    const apart = [w("of", 58.5, 58.7), w("U.", 58.78, 58.9), w("S.", 58.92, 59.06), w("airlines,", 59.08, 59.6)];
    expect(planSentencePauses(apart, 0.5)).toEqual([]);
    expect([...scriptSentenceEnds(apart, WHOLE_CAN)]).toEqual([]);
  });

  it("negative: 'The whole can.' still gets its pause", () => {
    const heard = [w("whole", 57.6, 57.9), w("can.", 57.9, 58.2), w("On", 58.22, 58.3), w("a", 58.3, 58.35)];
    expect(planSentencePauses(heard, 0.5).map(p => p.atSec)).toEqual([58.21]);
    expect([...scriptSentenceEnds(heard, WHOLE_CAN)]).toEqual([1]);
  });
});

describe("the lists' sentences", () => {
  it("splitSentences keeps 'U. S.' inside its sentence", () => {
    expect(splitSentences(WHOLE_CAN)).toHaveLength(4);
    expect(splitSentences(SMALL_X)).toHaveLength(2);
  });

  it("a host line that is only a list is one sentence even with 'U. S.' in it", () => {
    expect(spokenListItems("A pillow, a blanket, and a U. S. flag.")).toEqual([
      "A pillow",
      "a blanket",
      "a U. S. flag",
    ]);
    // Negative: two sentences are no one-sentence list.
    expect(spokenListItems("A pillow, a blanket. And a can of soda.")).toBeNull();
  });
});


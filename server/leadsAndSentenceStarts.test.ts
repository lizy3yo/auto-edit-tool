/**
 * WHERE A PICTURE STARTS AND ENDS AGAINST THE SENTENCES (round 14, 2026-10-20, the review of the
 * verification films 413 and 414). Three seams where the picture and the words came apart:
 *  - job 413 scene 33: the check's split at a new subject was refused because the words before it,
 *    the end of a step ("nowhere near a spark."), ran under 3 s — so the gas can stayed up 8 s over
 *    a line about dead mowers. A short lead that only FINISHES the sentence before goes back to that
 *    picture (`applyPictureSplits`).
 *  - job 414 scenes 28-29: a beat ended three words into a sentence, and the cracked wall came up
 *    1.2 s after "Green wood splits" began (`carrySentenceStarts`).
 *  - job 413 scenes 10/15: a lead-in line lost the thing it names to the next line's picture, and the
 *    stool was drawn 9 s before "Pull up a stool." (`losesNamedThing`, the planning prompts).
 * The lines, lengths and word timings are the jobs' own rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import {
  applyPictureFixes,
  applyPictureSplits,
  atWork,
  carrySentenceStarts,
  contextRuns,
  FIT_SYSTEM,
  fitPicturesToLines,
  lastWordsSec,
  losesNamedThing,
  markSameContext,
  namesSomethingElse,
  parseContextGroups,
  parsePictureFixes,
  SENTENCE_START_MAX_SEC,
  SENTENCE_START_MAX_WORDS,
  SHOT_LIST_SYSTEM,
} from "./shotList";

beforeEach(() => mockInvoke.mockReset());

const pic = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, showSubject: show, visualPrompt: show, wordCut: true, ...over }) as StoryboardScene;
const host = (index: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, hostPresent: true, showSubject: "the host", ...over }) as StoryboardScene;

/** What the cases came from — never in a rulebook (the rules must fit any channel). */
const CASE_OBJECTS = /stool|gas can|gasoline|mower|spark|city office|license|tulip|poplar|green wood|cracks?\b|felling/i;

// ─── (a) A short lead that finishes the sentence before ─────────────────────────────────────

/** Job 413 scenes 31-34 as stored: the steps "drain it outside, | store it sealed," then the line. */
const SPARK = "nowhere near a spark.";
const DOWNSIDE =
  "The downside is real: some mowers are just done, and you’ll eat a couple of corpses learning to tell the difference.";
const CAN_SHELF = "the red gas can with its black cap screwed tight on a shelf in an outdoor shed";
const DEAD_MOWER = "a dead push mower with a seized engine pushed into the back corner of a garage beside a second junk mower";
const steps413 = () => [
  pic(31, "drain it outside,", "the host's hands draining gasoline from the mower into the red gas can outdoors on the driveway", {
    listCut: true,
    listKind: "steps",
    keyThing: "gas can",
    humanPresent: true,
    stillImage: true,
    shotGroup: 23,
    audioDuration: 1.165,
  }),
  pic(32, "store it sealed,", CAN_SHELF, {
    listCut: true,
    listKind: "steps",
    keyThing: "gas can",
    stillImage: true,
    shotGroup: 23,
    audioDuration: 1.167,
  }),
  pic(33, `${SPARK} ${DOWNSIDE}`, "the sealed red gas can standing alone on a shelf in an outdoor shed", {
    keyThing: "gas can",
    stillImage: true,
    shotGroup: 24,
    audioDuration: 9.73,
  }),
  host(34, "Three businesses in, and you can already see the pattern: the money lives in the math, not the hype.", {
    cta: true,
    audioDuration: 6.542,
  }),
];
/** The check's answer for scene 33: the line opens on gas safety, then the dead mowers. */
const split33 = (id: number) => ({
  id,
  about: "keeping the stored gasoline away from sparks; then mowers that are beyond saving",
  shows_it: true,
  split: [{ from: "The downside is real", show: DEAD_MOWER, thing: null, stage: null, other: null }],
});

describe("a short lead that finishes the sentence before goes back to its picture (job 413 scene 33)", () => {
  it("the step keeps the words that finish it, and the dead mowers get their own picture", () => {
    const scenes = steps413();
    const fixes = parsePictureFixes(JSON.stringify({ pictures: [split33(2)] }), scenes);
    expect(applyPictureFixes(scenes, fixes, [])).toBe(0);
    const r = applyPictureSplits(scenes, fixes, [], s => s.audioDuration ?? 0, () => 10.5);
    expect(r.split).toBe(1);
    // As many pictures as before: the lead joined the step, the rest replaced the can.
    expect(r.scenes.map(s => s.scriptText)).toEqual([
      "drain it outside,",
      `store it sealed, ${SPARK}`,
      DOWNSIDE,
      scenes[3].scriptText,
    ]);
    const [, step, mowers] = r.scenes;
    expect(step.showSubject).toBe(CAN_SHELF);
    expect(step.listCut).toBe(true);
    expect(step.keyThing).toBe("gas can");
    // Re-cut by the caller: no stale length or range is carried.
    expect(step.audioDuration).toBeUndefined();
    expect(step.narrationStartSec).toBeUndefined();
    expect(mowers.showSubject).toBe(DEAD_MOWER);
    expect(mowers.keyThing).toBeUndefined();
    expect(mowers.wordCut).toBe(true);
    expect(mowers.stillImage).toBe(true);
    expect(r.scenes.map(s => s.index)).toEqual([1, 2, 3, 4]);
  });

  it("unchanged: a lead that is a sentence of its own does not go back (job 413 scene 15, 'Pull up a stool.')", () => {
    // "and the catch stated flat." ends its sentence; "Pull up a stool." starts the next one — those
    // words are not the catch's, and the split stays refused as before.
    const scenes = [
      pic(14, "and the catch stated flat.", "the host leaning on the workbench looking at a worn tool in his hand", {
        listCut: true,
        humanPresent: true,
        audioDuration: 2.034,
      }),
      pic(
        15,
        "Pull up a stool. One piece of housekeeping first: license rules change town by town,",
        "the host on the phone at the workbench calling the city office",
        { humanPresent: true, audioDuration: 5.792 }
      ),
    ];
    const fixes = [{ id: 1, split: [{ from: "One piece of housekeeping", show: "a town clerk's counter with permit forms" }] }];
    const r = applyPictureSplits(scenes, fixes, [], s => s.audioDuration ?? 0, () => 10.5);
    expect(r.split).toBe(0);
    expect(r.scenes).toEqual(scenes);
  });

  it("unchanged: never past the picture before's limit, never to the host, never with the rest still short", () => {
    const fixes = () => parsePictureFixes(JSON.stringify({ pictures: [split33(2)] }), steps413());
    // The step's picture may stay only 2 s where it sits: 1.17 s + the lead's ~1.5 s is past it.
    const tight = steps413();
    expect(applyPictureSplits(tight, fixes(), [], s => s.audioDuration ?? 0, () => 2).scenes).toEqual(tight);
    // A host take before the line never takes its words (its render and minutes are planned).
    const onHost = steps413();
    onHost[1] = host(32, "store it sealed,", { audioDuration: 1.167 });
    expect(applyPictureSplits(onHost, fixes(), [], s => s.audioDuration ?? 0, () => 10.5).split).toBe(0);
    // The same line read in 3.5 s: the mowers' share is under 3 s too — the line keeps its picture.
    const quick = steps413();
    expect(applyPictureSplits(quick, fixes(), [], s => (s === quick[2] ? 3.5 : s.audioDuration ?? 0), () => 10.5).split).toBe(0);
  });

  it("through the line check: the hand-back lands, held to the picture's limit", async () => {
    mockInvoke.mockResolvedValue({
      text: JSON.stringify({
        pictures: [
          { id: 0, about: "draining the gas outside", shows_it: true, who: "host" },
          { id: 1, about: "storing the can sealed", shows_it: true },
          split33(2),
        ],
      }),
    });
    const r = await fitPicturesToLines(steps413(), { maxAt: () => 10.5 });
    expect(r.split).toBe(1);
    expect(r.scenes.map(s => s.scriptText)).toEqual(["drain it outside,", `store it sealed, ${SPARK}`, DOWNSIDE, steps413()[3].scriptText]);
    // A limit the step cannot take the words under: nothing moves.
    mockInvoke.mockResolvedValue({ text: JSON.stringify({ pictures: [split33(2)] }) });
    const held = await fitPicturesToLines(steps413(), { maxAt: () => 2 });
    expect(held.split).toBe(0);
    expect(held.scenes[2].scriptText).toBe(`${SPARK} ${DOWNSIDE}`);
  });

  it("the line check is told such a split is still wanted", () => {
    expect(FIT_SYSTEM).toMatch(/at least 3 seconds/);
    expect(FIT_SYSTEM).toMatch(/except the words\s+BEFORE the split when they only FINISH a sentence the picture before started/);
    expect(FIT_SYSTEM).toMatch(/they go back to that picture,\s+so split there all the same/);
    expect(FIT_SYSTEM).not.toMatch(CASE_OBJECTS);
  });
});

// ─── (b) A sentence starts on its own picture ──────────────────────────────────────────────

/** Job 414's transcript from 143.7 s to 162.8 s, as the review pack holds it. */
const WORDS_414 =
  "Because@143.767-144.047 a@144.107-144.147 fresh@144.207-144.507 log@144.607-144.968 gives@145.028-145.268 up@145.348-145.448 its@145.508-145.628 chips@145.728-146.108 far@146.668-147.008 easier@147.208-147.588 than@147.628-147.768 a@147.808-147.828 seasoned@147.929-148.389 one.@148.549-148.669 And@149.389-149.489 tall,@149.589-150.049 straight@150.509-150.91 tulip@151.03-151.41 poplar@151.49-152.01 was@152.47-152.63 a@152.69-152.71 favorite.@152.79-153.27 Green@154.091-154.391 wood@154.431-154.711 splits@154.791-155.271 and@155.371-155.491 shifts@155.671-156.051 as@156.151-156.251 it@156.331-156.411 dries,@156.471-157.032 so@157.732-157.912 a@157.952-157.992 new@158.092-158.272 wall@158.372-158.752 opens@158.832-159.132 small@159.252-159.653 cracks@159.813-160.333 its@160.433-160.553 first@160.633-160.973 year.@161.033-161.333 Keep@162.573-162.774 your@162.814-162.974"
    .split(" ")
    .map(tok => {
      const [, word, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
      return { word, start: Number(start), end: Number(end) };
    });
const TREES = "because a fresh log gives up its chips far easier than a seasoned one, and tall, straight tulip poplar was a favorite.";
const CRACKS = "and shifts as it dries, so a new wall opens small cracks its first year.";
/** Job 414 scenes 27-30 as stored, with their ranges on the master. */
const walls414 = () => [
  host(27, "They hewed green, right after felling,", { shotGroup: 22, narrationStartSec: 140.1185, narrationEndSec: 143.655, audioDuration: 3.5365 }),
  pic(28, `${TREES} Green wood splits`, "tall straight tulip poplar trees in the wooded felling area", {
    shotGroup: 23,
    keyThing: "wooded felling area",
    stillImage: true,
    narrationStartSec: 143.655,
    narrationEndSec: 155.304,
    audioDuration: 11.649,
  }),
  pic(29, CRACKS, "a close-up of a hewn poplar log wall with scalloped axe marks, where small thin drying cracks run along the grain", {
    shotGroup: 24,
    keyThing: "green poplar log",
    stillImage: true,
    narrationStartSec: 155.304,
    narrationEndSec: 162.446,
    audioDuration: 7.142,
  }),
  pic(30, "Keep your boots clear of the swing, and stop when your arms tire.", "host standing back, broadaxe idle on a chopping block in clearing", {
    shotGroup: 25,
    humanPresent: true,
    stillImage: true,
    narrationStartSec: 162.446,
    narrationEndSec: 167.756,
    audioDuration: 5.31,
  }),
];
const heard = (s: StoryboardScene, n: number) =>
  lastWordsSec(WORDS_414, { startSec: s.narrationStartSec!, endSec: s.narrationEndSec! }, n);
const len = (s: StoryboardScene) => s.audioDuration ?? 0;

describe("a sentence starts on its own picture (job 414 scenes 28-29)", () => {
  it("'Green wood splits' goes on to the cracked wall, which now comes up as its sentence begins", () => {
    const scenes = walls414();
    const r = carrySentenceStarts(scenes, len, () => 21, heard);
    expect(r.moved).toBe(1);
    expect(r.scenes.map(s => s.scriptText)).toEqual([scenes[0].scriptText, TREES, `Green wood splits ${CRACKS}`, scenes[3].scriptText]);
    // Each keeps its own picture; both are re-cut by the caller.
    expect(r.scenes[1].showSubject).toBe(scenes[1].showSubject);
    expect(r.scenes[2].showSubject).toBe(scenes[2].showSubject);
    expect(r.scenes[1].audioDuration).toBeUndefined();
    expect(r.scenes[2].narrationStartSec).toBeUndefined();
    // The host take and the line after the wall are untouched objects.
    expect(r.scenes[0]).toBe(scenes[0]);
    expect(r.scenes[3]).toBe(scenes[3]);
  });

  it("the words are timed on the voice when the timeline knows them, else by their share", () => {
    const scenes = walls414();
    expect(heard(scenes[1], 3)).toBeCloseTo(1.213, 3);
    expect(SENTENCE_START_MAX_SEC).toBe(1.5);
    expect(SENTENCE_START_MAX_WORDS).toBe(4);
    // No timeline: 3 of the picture's 25 words of 11.6 s is 1.4 s — moved all the same.
    expect(carrySentenceStarts(walls414(), len, () => 21).moved).toBe(1);
    // Words the voice draws out past 1.5 s stay, whatever their share says.
    expect(carrySentenceStarts(walls414(), len, () => 21, () => 1.6).moved).toBe(0);
  });

  it("unchanged: a cut the shot list placed inside one beat, a sentence that ends, a host take or a list", () => {
    // The shot list's own cut (one beat) is its choice.
    const oneBeat = walls414();
    oneBeat[2] = { ...oneBeat[2], shotGroup: 23 };
    expect(carrySentenceStarts(oneBeat, len, () => 21, heard).moved).toBe(0);
    // "…its first year." | "Keep your boots…": the picture already changes on the sentence.
    expect(carrySentenceStarts(walls414().slice(2), len, () => 21, heard).moved).toBe(0);
    // A host take after it starts mid-sentence on purpose or is the plan gate's to fix.
    const toHost = walls414();
    toHost[2] = host(29, CRACKS, { shotGroup: 24, audioDuration: 7.142 });
    expect(carrySentenceStarts(toHost, len, () => 21, heard).moved).toBe(0);
    // A list keeps its own cuts.
    const toList = walls414();
    toList[2] = { ...toList[2], listCut: true };
    expect(carrySentenceStarts(toList, len, () => 21, heard).moved).toBe(0);
  });

  it("unchanged: more than four words, past the next picture's limit, or a picture before left too short", () => {
    const five = walls414();
    five[1] = { ...five[1], scriptText: `${TREES} Green wood, as it ages, splits` };
    expect(carrySentenceStarts(five, len, () => 21, heard).moved).toBe(0);
    // The wall may stay only 8 s where it sits: 7.1 s + 1.2 s is past it.
    expect(carrySentenceStarts(walls414(), len, () => 8, heard).moved).toBe(0);
    // A picture of "Yes. Green wood splits" would be left a flash.
    const short = walls414();
    short[1] = { ...short[1], scriptText: "It was a favorite. Green wood splits", audioDuration: 3.2 };
    expect(carrySentenceStarts(short, len, () => 21, () => 1.2).moved).toBe(0);
  });

  it("unchanged: an abbreviation's full stop starts no sentence", () => {
    const scenes = [
      pic(1, "The old recipe used flour, salt and water, about approx. two", "a bowl of flour on a kitchen table", { shotGroup: 1, audioDuration: 6 }),
      pic(2, "cups of each, mixed by hand.", "hands mixing dough in a bowl", { shotGroup: 2, audioDuration: 3 }),
    ];
    expect(carrySentenceStarts(scenes, len, () => 21, () => 0.6).moved).toBe(0);
  });

  it("lastWordsSec: too few words heard tells nothing; a number heard as one word reads longer, never shorter", () => {
    expect(lastWordsSec(WORDS_414, { startSec: 154, endSec: 155.304 }, 3)).toBeUndefined();
    expect(lastWordsSec(null, { startSec: 143.655, endSec: 155.304 }, 3)).toBeUndefined();
    // "It cost fifteen hundred dollars" said, "$1,500" heard: three words back reach "cost".
    const priced = [
      { start: 10, end: 10.2 },
      { start: 10.3, end: 10.6 },
      { start: 10.7, end: 11.5 },
    ];
    expect(lastWordsSec(priced, { startSec: 10, endSec: 11.6 }, 2)).toBeCloseTo(1.3, 3);
  });
});

// ─── (c) A thing a line names stays with that line ─────────────────────────────────────────

/** Job 413 scenes 14-16: the last list item, the lead-in line, and the phone call's line. */
const STOOL_LINE = "Pull up a stool. One piece of housekeeping first: license rules change town by town,";
const PHONE_LINE = "so before you charge a stranger a dime, spend two minutes on the phone with your city office.";
const PHONE = "the host on the phone at the workbench calling the city office";
/** The lead-in line's own picture, of the thing it names. */
const STOOL = "the host on a stool at the garage workbench, settling in";
const housekeeping413 = (own15: string) => [
  pic(14, "and the catch stated flat.", "the host leaning on the workbench looking at a worn tool in his hand", {
    listCut: true,
    humanPresent: true,
  }),
  pic(15, STOOL_LINE, own15, { humanPresent: true }),
  pic(16, PHONE_LINE, PHONE, { humanPresent: true }),
  host(17, "Cheap insurance. Now — number one."),
];
const groupAnswer = JSON.stringify({ groups: [{ ids: [1, 2], show: PHONE }] });
const parse = (scenes: StoryboardScene[]) =>
  parseContextGroups(
    groupAnswer,
    contextRuns(scenes),
    i => scenes[i].showSubject,
    i => atWork(scenes[i]),
    i => scenes[i].scriptText
  );

describe("a thing a line names stays with that line (job 413 scenes 10 and 15)", () => {
  it("the lead-in line's stool is not given up for the next line's phone call", () => {
    // The stool drawn for the line that says it; the same-topic answer folds it into the phone call.
    const scenes = housekeeping413(STOOL);
    expect(parse(scenes)).toEqual([]);
    expect(losesNamedThing(STOOL, STOOL_LINE, PHONE)).toBe(true);
    // The older check reads only "the host" — before "on a stool" — and lets the group stand.
    expect(namesSomethingElse(STOOL, PHONE)).toBe(false);
  });

  it("through the same-topic call: each line keeps its own picture", async () => {
    const scenes = housekeeping413(STOOL);
    mockInvoke.mockResolvedValue({ text: groupAnswer });
    expect(await markSameContext(scenes, { sec: () => 5.7 })).toBe(0);
    expect(scenes[1].showSubject).toBe(STOOL);
    expect(scenes[2].sameShot).toBeUndefined();
    const system = String(mockInvoke.mock.calls[0][0].systemPrompt);
    expect(system).toMatch(/A thing a line names stays with that line/);
    expect(system).toMatch(/is never given the picture of the line after it/);
    expect(system).not.toMatch(CASE_OBJECTS);
  });

  it("unchanged: a line whose own picture shows nothing it names still joins the group (as stored)", () => {
    // The film as shipped: the shot list gave the lead-in line the phone call itself.
    const scenes = housekeeping413(PHONE);
    expect(parse(scenes)).toEqual([{ ids: [1, 2], show: PHONE }]);
    // The phone call's own line names the phone and the office — the group's picture shows both.
    expect(losesNamedThing(PHONE, PHONE_LINE, PHONE)).toBe(false);
  });

  it("only a thing's own name counts — never a describing word, a person, or a thing the group shows mostly", () => {
    // "old" is said and drawn, but the jar is in the group's picture.
    expect(losesNamedThing("an old glass jar on the shelf", "I found an old jar.", "a jar of jam on a kitchen counter")).toBe(false);
    // The host is in every picture; that is not a thing the line names.
    expect(losesNamedThing("the host's hands at the bench", "Put your hands on the bench.", "a bench in a garage")).toBe(false);
    // Two named, one shown: the group's picture still has the thing.
    expect(losesNamedThing("a lattice panel of pine strips", "This lattice panel took a week.", "the pine panel on the bench")).toBe(false);
    // A place the line names counts too: the group's picture puts the jars somewhere else.
    expect(losesNamedThing("jars of jam on a garage shelf", "I keep jars in the garage.", "jars of jam on a pantry shelf")).toBe(true);
    expect(losesNamedThing("jars of jam on a garage shelf", "I keep jars in the garage.", "jars of jam on a garage shelf, close")).toBe(false);
    // A word said that names no thing ("put it down") is no thing.
    expect(losesNamedThing("a board laid down on the bench", "Put it down.", "the board")).toBe(false);
    // A thing named and drawn that the group drops entirely.
    expect(losesNamedThing("a kettle on the stove", "Put the kettle on.", "a teapot and two cups on a table")).toBe(true);
    // No line, nothing to judge.
    expect(losesNamedThing("a kettle on the stove", undefined, "a teapot")).toBe(false);
  });

  it("the planners are told a thing is never shown before the line that names it", () => {
    expect(FIT_SYSTEM).toMatch(/A THING BEFORE ITS WORDS/);
    expect(FIT_SYSTEM).toMatch(/which\s+a LATER line names, shows it too early/);
    expect(FIT_SYSTEM).toMatch(/Not when that later line's picture is marked "continues"/);
    expect(SHOT_LIST_SYSTEM).toMatch(/Never a thing a LATER line names/);
    expect(SHOT_LIST_SYSTEM).not.toMatch(CASE_OBJECTS);
  });
});

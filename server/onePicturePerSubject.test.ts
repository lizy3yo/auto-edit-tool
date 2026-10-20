/**
 * ONE PICTURE, ONE SUBJECT (round 11, 2026-10-18, the review of job 407 scene 20). One still ran
 * 16.6 s over two sentences about different things: "The oldest cabins held long boards down with
 * heavy poles laid across each course, so the roof went on without a nail." (the weight-pole roof,
 * ~8.5 s) and "When you rive, the bolt sits in a fork or against a stump, never in your hand." — and
 * the picture, hands steadying a log bolt in a forked stump, fitted only the second. The roof
 * sentence's two short pieces had been joined into one picture (`joinShortSplits`, `joinedLine`), the
 * riving sentence joined on as the same topic, and the line check could split a picture only at a
 * comparison, never a joined one — so the roof was never shown. Now the check splits a line where a
 * sentence about a different visible thing starts, keeping every part at 3 s or more. The lines and
 * key things are job 407's real rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import { applyPictureFixes, applyPictureSplits, FIT_SYSTEM, fitPicturesToLines, parsePictureFixes } from "./shotList";

const pic = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, showSubject: show, visualPrompt: show, wordCut: true, ...over }) as StoryboardScene;
const host = (index: number, scriptText: string) =>
  ({ index, narration: scriptText, scriptText, hostPresent: true, showSubject: "the host" }) as StoryboardScene;

/** What the case came from — never in the rulebook (the rule must fit any channel). */
const CHANNEL_OBJECTS = /cabin|\briv(?:e|en|ing)\b|log bolt|froe|woodlot|\bstump|broadaxe|drawknife|shingle/i;

/** Job 407's key things, as written (the ones these lines touch). */
const CABIN: KeyThing[] = [
  { main: true, name: "axe", look: "a mid-size steel-headed felling axe with a curved hickory handle, hanging on the cabin's back wall" },
  { name: "split-oak roof boards", look: "long flat boards riven from white oak, pale tan with straight grain lines, laid in overlapping courses" },
  { name: "heavy roof poles", look: "long round timber poles laid across the roof boards to weigh them down without nails" },
  { name: "log bolts", look: "short round sections cut from a white oak or chestnut log, pale grey bark with cream-colored inner wood" },
  { name: "tree stump", look: "a low wide stump of cut wood used as a brace to hold log bolts steady while riving" },
];

const ROOF = "The oldest cabins held long boards down with heavy poles laid across each course, so the roof went on without a nail.";
const RIVE = "When you rive, the bolt sits in a fork or against a stump, never in your hand.";
/** Scene 20 as the line check saw it: one joined picture of both sentences, drawn from the second. */
const BOLT =
  "a log bolt wedged into a forked stump in the woodlot, hands steadying it from the side, a close-up of one detail of it filling the frame";
const scene20 = (over: Partial<StoryboardScene> = {}) =>
  pic(20, `${ROOF} ${RIVE}`, BOLT, {
    joinedLine: true,
    keyThing: "log bolts",
    humanPresent: true,
    audioDuration: 16.55,
    forbids: "a log bolt held in a hand while riving",
    ...over,
  });

/** What the check answers for scene 20 under the new rule: the roof first, the bolt where "When you rive" starts. */
const ANSWER = {
  pictures: [
    {
      id: 0,
      about: "heavy poles holding the roof boards down; then where the bolt sits while riving",
      shows_it: false,
      show: "long round timber poles laid across overlapping courses of pale split-oak roof boards on an old cabin roof",
      thing: "heavy roof poles",
      stage: null,
      split: [
        {
          from: "When you rive",
          show: "a log bolt wedged upright in a forked stump in the woodlot, hands steadying it from the side",
          thing: "log bolts",
          stage: null,
        },
      ],
      forbids: "a log bolt held in a hand while riving",
    },
  ],
};

beforeEach(() => mockInvoke.mockReset());

describe("one picture, one subject: a line of two sentences about different things is split (job 407 scene 20)", () => {
  it("the line check splits where a sentence about a different thing starts, at 3 s a part", () => {
    expect(FIT_SYSTEM).toMatch(/ONE PICTURE, ONE SUBJECT/);
    expect(FIT_SYSTEM).toMatch(/TWO OR MORE SENTENCES, where a later sentence\s+is about a different thing you can see/);
    expect(FIT_SYSTEM).toMatch(/about, shows_it and show answer for the words\s+BEFORE the split only/);
    expect(FIT_SYSTEM).toMatch(/when the picture fits only\s+the later sentence, write show\s+for the earlier words/);
    expect(FIT_SYSTEM).toMatch(/at least 3 seconds/);
    expect(FIT_SYSTEM).toMatch(/Never split\s+sentences that stay on the same thing/);
    // A joined picture may be split at a sentence start — never inside its sentence.
    expect(FIT_SYSTEM).toMatch(/A picture marked "joined" may be split this way, where a sentence starts/);
    expect(FIT_SYSTEM).toMatch(/Never split a picture marked "joined" inside a\s+sentence/);
    expect(FIT_SYSTEM).not.toMatch(/Never split a picture marked "joined"\.(?!\S)/);
    expect(FIT_SYSTEM).not.toMatch(CHANNEL_OBJECTS);
  });

  it("scene 20 becomes the roof over the roof sentence and the bolt over the riving sentence", () => {
    const s = scene20();
    const fixes = parsePictureFixes(JSON.stringify(ANSWER), [s]);
    expect(applyPictureFixes([s], fixes, CABIN)).toBe(1);
    const r = applyPictureSplits([s], fixes, CABIN, x => x.audioDuration ?? 0);
    expect(r.split).toBe(1);
    expect(r.scenes.map(x => x.scriptText)).toEqual([ROOF, RIVE]);
    const [roof, rive] = r.scenes;
    expect(roof.showSubject).toMatch(/timber poles laid across overlapping courses/);
    expect(roof.keyThing).toBe("heavy roof poles");
    expect(roof.humanPresent).toBeUndefined();
    expect(rive.showSubject).toMatch(/^a log bolt wedged upright in a forked stump/);
    expect(rive.keyThing).toBe("log bolts");
    expect(rive.humanPresent).toBe(true);
    // The new picture is its own sentence's, not a join; the line's ban rides both parts.
    expect(rive.joinedLine).toBeUndefined();
    expect(rive.forbids).toBe("a log bolt held in a hand while riving");
    expect(rive.wordCut).toBe(true);
    expect(r.scenes.map(x => x.index)).toEqual([1, 2]);
  });

  it("through the line check: the split lands, and the film gains one picture", async () => {
    mockInvoke.mockResolvedValue({ text: JSON.stringify({ pictures: [{ id: 0, about: "x", shows_it: true }, { ...ANSWER.pictures[0], id: 1 }] }) });
    const scenes = [
      pic(19, "so every board runs from bark toward heart and stays flat in the weather.", "a freshly riven oak board laid flat", { audioDuration: 5.76 }),
      scene20(),
      host(21, "Number two squared the walls with a broadaxe."),
    ];
    const r = await fitPicturesToLines(scenes, { keyThings: CABIN });
    expect(r.split).toBe(1);
    expect(r.scenes.map(x => x.scriptText)).toEqual([scenes[0].scriptText, ROOF, RIVE, scenes[2].scriptText]);
    expect(r.scenes[1].keyThing).toBe("heavy roof poles");
    expect(r.scenes[2].keyThing).toBe("log bolts");
    // The check is shown the picture as joined, with its seconds.
    const sent = String(mockInvoke.mock.calls[0][0].userMessage);
    expect(sent).toMatch(/#1 PICTURE \(16\.6 s\) \(joined\)/);
  });

  it("a picture the check joins and splits in one pass is held to 3 s a part by its parts' seconds", async () => {
    // The roof sentence's two pieces, as the storyboard cut them, and the riving sentence on the second.
    const first = "The oldest cabins held long boards down with";
    const rest = `heavy poles laid across each course, so the roof went on without a nail. ${RIVE}`;
    const answer = (id: number) => ({
      text: JSON.stringify({ pictures: [{ ...ANSWER.pictures[0], id, join: true }] }),
    });
    const run = async (a: number, b: number) => {
      mockInvoke.mockResolvedValueOnce(answer(1));
      const scenes = [
        pic(1, first, "split-oak roof boards on a cabin roof", { audioDuration: a }),
        pic(2, rest, BOLT, { audioDuration: b, keyThing: "log bolts", humanPresent: true }),
      ];
      return fitPicturesToLines(scenes, { keyThings: CABIN, maxAt: () => 21 });
    };
    // 16.6 s in all: the riving sentence's share is ~7 s — split.
    const long = await run(2.4, 14.15);
    expect(long.joined).toBe(1);
    expect(long.split).toBe(1);
    expect(long.scenes.map(x => x.scriptText)).toEqual([ROOF, RIVE]);
    // 5 s in all: its share is ~2.2 s — the joined picture has no measured length of its own, and its
    // parts' seconds still keep the split out.
    const short = await run(1, 4);
    expect(short.joined).toBe(1);
    expect(short.split).toBe(0);
    expect(short.scenes).toHaveLength(1);
  });

  it("a joined picture is never cut inside its sentence — a price's full stop is no sentence end", () => {
    // Dale's job 288: "Sell your furniture | on Facebook Marketplace" was made one picture on purpose.
    const sell = pic(1, "Number five. Sell your furniture on Facebook Marketplace today.", "the bookcase", { joinedLine: true });
    const inside = [{ id: 0, split: [{ from: "on Facebook Marketplace", show: "a phone showing a buy-and-sell app" }] }];
    expect(applyPictureSplits([sell], inside, undefined, () => 9).split).toBe(0);
    // The same cut on a picture nobody joined still splits (a comparison or a new thing named).
    expect(applyPictureSplits([{ ...sell, joinedLine: undefined }], inside, undefined, () => 9).split).toBe(1);
    const price = pic(2, "A good froe cost about $1.50 at the store then, and nobody minded paying it either.", "an old froe", {
      joinedLine: true,
    });
    const atCents = [{ id: 0, split: [{ from: "50 at the store", show: "a general store counter" }] }];
    expect(applyPictureSplits([price], atCents, undefined, () => 9).split).toBe(0);
  });

  it("never leaves a part under 3 s or 4 words", () => {
    const fixes = parsePictureFixes(JSON.stringify(ANSWER), [scene20()]);
    // The same line read in 5 s: the riving sentence's share is ~2.2 s.
    expect(applyPictureSplits([scene20()], fixes, CABIN, () => 5).split).toBe(0);
    // A sentence of three words is no picture of its own.
    const tiny = pic(3, `${ROOF} Never by hand.`, BOLT, { joinedLine: true });
    const cut = [{ id: 0, split: [{ from: "Never by hand", show: "a bolt braced in a forked stump" }] }];
    expect(applyPictureSplits([tiny], cut, CABIN, () => 12).split).toBe(0);
  });

  it("a split that draws the picture before it again shows nothing new, and is dropped", () => {
    // The check calling the bolt right for the whole line and copying it into the split would give two
    // bolt pictures and still no roof: the line keeps its one picture, as before.
    const s = scene20();
    const copied = {
      pictures: [
        {
          id: 0,
          about: "where the bolt sits while riving",
          shows_it: true,
          split: [{ from: "When you rive", show: "a log bolt wedged into a forked stump, hands steadying it from the side" }],
        },
      ],
    };
    const fixes = parsePictureFixes(JSON.stringify(copied), [s]);
    expect(applyPictureFixes([s], fixes, CABIN)).toBe(0);
    const r = applyPictureSplits([s], fixes, CABIN, () => 16.55);
    expect(r.split).toBe(0);
    expect(r.scenes).toEqual([s]);
  });
});

describe("a split where a new sentence starts takes the check's answer for who is in it (job 399 scene 16)", () => {
  // Job 399 scene 16, as stored: one joined picture, 14.5 s, of two sentences — the crew member pouring,
  // then what the viewer can ask for. The person changes where the sentence does.
  const POUR =
    "airlines, the flight attendant pours your soda into a plastic cup packed with ice, fills it about halfway, and the rest of the can rolls off down the aisle on the cart.";
  const ASK = "On many of those carriers, you can have the whole thing just by asking.";
  const scene16 = () =>
    pic(16, `${POUR} ${ASK}`, "hands pouring soda into an ice-filled plastic cup at the cart", {
      joinedLine: true,
      humanPresent: true,
      audioDuration: 14.45,
    });
  const answer = (split: Record<string, unknown>) =>
    JSON.stringify({
      pictures: [
        {
          id: 0,
          about: "the flight attendant pouring the soda at the cart",
          shows_it: true,
          who: "a flight attendant",
          split: [{ from: "On many of those carriers", show: "hands holding a full unopened soda can on a tray table", ...split }],
        },
      ],
    });
  const run = (json: string) => {
    const s = scene16();
    const fixes = parsePictureFixes(json, [s]);
    applyPictureFixes([s], fixes, []);
    return applyPictureSplits([s], fixes, [], () => 14.45);
  };

  it("an answer of nobody else keeps the crew member out of the viewer's picture", () => {
    const r = run(answer({ thing: null, stage: null, other: null }));
    expect(r.split).toBe(1);
    expect(r.scenes.map(x => x.scriptText)).toEqual([POUR, ASK]);
    expect(r.scenes[0].otherPerson).toBe("a flight attendant");
    expect(r.scenes[1].otherPerson).toBeUndefined();
    expect(r.scenes[1].humanPresent).toBe(true);
    // "you" is the viewer, never someone else.
    expect(run(answer({ other: "you" })).scenes[1].otherPerson).toBeUndefined();
  });

  it("a named person is drawn as that person; no answer at all still keeps the line's (as before)", () => {
    expect(run(answer({ other: "an older passenger" })).scenes[1].otherPerson).toBe("an older passenger");
    expect(run(answer({})).scenes[1].otherPerson).toBe("a flight attendant");
  });
});

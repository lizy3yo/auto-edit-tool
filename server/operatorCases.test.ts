/**
 * THE OPERATOR'S CASES, side by side (2026-10-02). Every case the operator found in a practice film
 * lives here together, so a fix for one cannot quietly undo another — which is exactly what happened
 * when "a list item is never a part" (for Dale's engraved board / house sign) drew Ruth's "a bear paw
 * there" as the whole quilt. The rules under test are general; these lines are only the examples
 * that proved each one.
 */
import { describe, it, expect, vi } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  BACKGROUND_VIEW,
  BLUR_PRINT_VIEW,
  isSubject,
  keyThingLookFor,
  memorySourcesFor,
  memoryViewFor,
  ownKeyThing,
  requiredThingsFor,
  SCREEN_ITEM_VIEW,
  shotFraming,
} from "./pictureMemory";
import {
  applyNamedLooks,
  namedLookClause,
  parseShownFacts,
  PART_VIEW,
  scriptWords,
  SUBJECT_OVER_LOOK,
} from "./namedLooks";
import { applySpokenLists, findSpokenLists, spokenListsByShape, splitSentences } from "./spokenLists";
import {
  applyShotPlan,
  atWork,
  CONTINUITY_SYSTEM,
  foldSnappedFlashes,
  foldUnseenBeats,
  joinShortSplits,
  otherPersonOf,
  parseContextGroups,
} from "./shotList";
import { keepOwnWords } from "./narrationAlignment";
import {
  ANON_PERSON_SUFFIX,
  APP_SCREEN_CLAUSE,
  appScreenClause,
  DESCRIBED_SCREEN_CLAUSE,
  DEVICE_RESTS,
  REAL_APP_SCREEN_CLAUSE,
  BLURRED_PRINT_CLAUSE,
  buildSplitRightScene,
  blurUnsaidPrint,
  brollDepictsBook,
  buildClipChain,
  buildStillPrompt,
  guardPitchVisuals,
  hostBrollClause,
  HOST_FRAMING_CLAUSE,
  HOST_LIPS_CUT_CLAUSE,
  HOST_LIPS_CUT_ONLY_SUFFIX,
  NO_OTHER_FIGURES_SUFFIX,
  keepBodyPartsOnBody,
  markMemoryFit,
  memoryClause,
  NO_FIGURES_SUFFIX,
  ONE_OTHER_PERSON_SUFFIX,
  otherPersonClause,
  SCREEN_TEXT_AS_BARS,
  subjectLead,
  markCtaQrBlock,
  ONE_BODY_CLAUSE,
  personClauseFor,
  TOOL_POSITION_CLAUSE,
  withAllowedText,
  planGlitchRerender,
} from "./longformVideo";
import {
  exactLookQuestion,
  requiredThingsQuestion,
  SOFT_PRINT_QUESTION,
  STAGED_QUESTION,
  STAGED_RULE,
  STILL_DEFECT_SYSTEM,
} from "./overlayTextScan";
import {
  DETACHED_BODY_PART,
  hostLipsCut,
  looksCutOff,
  markHostBroll,
  onTheBody,
  SHOWS_PERSON,
  withoutFaceAsks,
  WORN_ON_BODY,
} from "./hostLook";
import { tooShortToRead, type ResolvedCue, type Word } from "../graphics/src/cueResolve";
import { wordsSaidOver } from "../graphics/src/plan/planner";
import { plannerForJob } from "./graphics/apply";
import { makeReadable, type Reading } from "./graphics/readable";
import { checkScript } from "@shared/scriptCheck";
import { pictureKindOf } from "./pictureCheckLog";
import { splitPanelFor } from "./splitPanel";
import { splitPanelsMissing } from "@shared/splitPanel";
import { clipGlitchMessage, parseClipGlitchVerdict } from "./clipGlitchScan";

const pic = (index: number, scriptText: string, showSubject: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, scriptText, showSubject, visualPrompt: showSubject, ...over }) as StoryboardScene;
const host = (index: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, scriptText, hostPresent: true, showSubject: "the host", ...over }) as StoryboardScene;
const lists = (scenes: StoryboardScene[]) =>
  spokenListsByShape(splitSentences(scenes.map(s => s.scriptText).join(" ")));

describe("parts of one thing vs separate things (Ruth's job 298 vs Dale's job 290)", () => {
  const QUILT: KeyThing[] = [{ name: "sampler quilt", look: "a lap quilt of twelve different blocks", main: false }];
  const ruth = () => [
    pic(1, "A sampler quilt is where you make a bunch of different blocks,", "the sampler quilt laid flat", { keyThing: "sampler quilt" }),
    pic(2, "a churn dash here,", "close view of a single churn dash block", { listCut: true, keyThing: "sampler quilt" }),
    pic(3, "a bear paw there,", "close view of a single bear paw block", { listCut: true, keyThing: "sampler quilt" }),
    pic(4, "a flying geese row across the middle,", "close view of a flying geese row", { listCut: true, keyThing: "sampler quilt" }),
  ];

  it("Ruth: each named block is a close-up of that block, drawn from the quilt's memory", () => {
    // the named-looks step marks each block a part of the quilt (next case)
    const scenes = ruth().map((s, k) => (k ? { ...s, partOf: "sampler quilt" } : s));
    for (const s of scenes.slice(1)) {
      expect(shotFraming(s)).toBe("close");
      expect(memoryViewFor(scenes, s)).toBe(PART_VIEW);
      expect(memorySourcesFor(scenes, s)).toEqual([scenes[0]]);
    }
  });

  it("Ruth: a list item may be a part of one thing", () => {
    const scenes = ruth();
    applyNamedLooks(scenes, [2], { kinds: [], pictures: [{ id: 2, partOf: "sampler quilt" }] }, QUILT);
    expect(scenes[2].partOf).toBe("sampler quilt");
  });

  it("Dale: separate list items are never drawn from each other", () => {
    const scenes = [
      pic(1, "Engraved boards,", "an engraved board", { listCut: true, keyThing: "personalized pile" }),
      pic(2, "house signs,", "a house sign", { listCut: true, keyThing: "personalized pile" }),
      pic(3, "keepsake boxes.", "a keepsake box", { listCut: true, keyThing: "personalized pile" }),
    ];
    expect(memorySourcesFor(scenes, scenes[1])).toEqual([]);
    expect(memorySourcesFor(scenes, scenes[2])).toEqual([]);
  });

  it("Dale's job 397: list items that are not parts are never drawn from the group's pile", () => {
    const scenes = [
      pic(1, "Smalls, about $10 to $40.", "a pile of coasters and ornaments", { keyThing: "small wood pieces pile" }),
      pic(2, "Coasters,", "close-up of round coasters", { listCut: true, keyThing: "small wood pieces pile" }),
      pic(3, "ornaments,", "close-up of wood ornaments", { listCut: true, keyThing: "small wood pieces pile" }),
    ];
    expect(memorySourcesFor(scenes, scenes[1])).toEqual([]);
    expect(memorySourcesFor(scenes, scenes[2])).toEqual([]);
  });

  it("a picture that is not a close-up still rotates its camera", () => {
    const scenes = [
      pic(1, "x", "the cutting board on the bench", { keyThing: "board" }),
      pic(2, "y", "the cutting board leaning on the wall", { keyThing: "board" }),
    ];
    expect(memoryViewFor(scenes, scenes[1])).not.toBe(PART_VIEW);
  });
});

describe("screens (Dale's job 295: an Etsy page framed by the cutting board)", () => {
  it("a screen shows its item's memory only inside the listing, and is never a memory itself", () => {
    const scenes = [
      pic(1, "x", "the cutting board on the bench", { keyThing: "board" }),
      pic(2, "y", "a laptop screen showing the shop page with the board listed", { keyThing: "board" }),
      pic(3, "z", "the cutting board by the door", { keyThing: "board" }),
    ];
    expect(memorySourcesFor(scenes, scenes[1])).toEqual([scenes[0]]);
    expect(memoryViewFor(scenes, scenes[1])).toBe(SCREEN_ITEM_VIEW);
    expect(memorySourcesFor(scenes, scenes[2])).toEqual([scenes[0]]);
  });
});

describe("Dale's job 306: the bookcase listing, the said price, the box for a bookcase", () => {
  it("a screen about one listing shows that item's own page, and a said price is shown exactly", async () => {
    const one = { showSubject: "a phone showing a listing of the walnut bookcase" } as StoryboardScene;
    expect(appScreenClause(one)).toMatch(/ONE item's own listing page/);
    const grid = { showSubject: "a phone showing a buy-and-sell app with handmade listings" } as StoryboardScene;
    expect(appScreenClause(grid)).not.toMatch(/ONE item's own listing page/);
    const priced = { showSubject: "a phone showing the bookcase listing", pictureText: "$140" } as StoryboardScene;
    expect(appScreenClause(priced)).toMatch(/nothing readable on the screen except "\$140", spelled exactly/);
    expect(appScreenClause({ ...priced, namedLook: "an app: white" } as StoryboardScene)).toMatch(/"\$140" readable and spelled exactly/);
  });
  it("the stronger checker asks for every key thing, and counts a swapped object as missing", async () => {
    const q = requiredThingsQuestion(["house sign", "coasters", "bookcase"]);
    expect(q).toMatch(/"house sign", "coasters", "bookcase"/);
    expect(q).toMatch(/a different object stands where it should/);
  });
});

describe("lists (Ruth's job 281, Hank's job 275, Dale's jobs 292-293)", () => {
  it("Ruth: the host hands over at the first item; 'the one' is not a list", () => {
    const scenes = [
      host(1, "Out of 10 projects you can piece together from", { hostOpener: true }),
      pic(2, "a bin of leftover fabric,", "a bin", { listCut: true }),
      pic(3, "the one", "a bowl", { listCut: true }),
      pic(4, "that paid me best came out of a coffee tin.", "a bowl and a tin"),
      host(5, "I'm Granny Ruth, and this one's for anybody sitting at a kitchen table with a straight-stitch machine,", { hostIntro: true }),
      pic(6, "a rotary cutter, and", "a rotary cutter"),
      pic(7, "a mountain of scraps too pretty to throw out,", "scraps", { listCut: true }),
      pic(8, "wondering if it is worth anything.", "a market table"),
      host(9, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists(scenes), { hostName: "Granny Ruth" });
    const texts = r.scenes.map(s => [s.scriptText, !!s.listCut]);
    expect(texts).toContainEqual(["a straight-stitch machine,", true]);
    expect(texts).toContainEqual(["a rotary cutter,", true]);
    expect(texts).toContainEqual(["the one", false]);
  });

  it("Dale: a list in the opening line hands over too", () => {
    const scenes = [
      host(1, "The place just wasn't built for that piece. Today I'm ranking Etsy,", { hostOpener: true }),
      pic(2, "craft fairs,", "a fair", { listCut: true }),
      pic(3, "and Facebook Marketplace", "an app", { listCut: true }),
      pic(4, "by what each one does well.", "pieces"),
      host(5, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists(scenes));
    expect(r.scenes.map(s => s.scriptText)).toContain("Etsy,");
  });

  it("Dale: a short lead-in is never folded into a list item", () => {
    const scenes = [
      pic(1, "The place just wasn't built for that piece.", "a", { wordCut: true, shotGroup: 2 }),
      pic(2, "Today I'm ranking", "b", { wordCut: true, shotGroup: 4 }),
      pic(3, "Etsy,", "c", { wordCut: true, shotGroup: 4, listCut: true }),
    ];
    const secs = new Map([[scenes[0], 4], [scenes[1], 1], [scenes[2], 0.33]]);
    const r = foldSnappedFlashes(scenes, s => secs.get(s) ?? 5);
    expect(r.scenes.find(s => s.scriptText === "Etsy,")?.listCut).toBe(true);
  });

  it("the audit's production job 200 #184: a lead-in BETWEEN two items leads into the next one, which keeps its picture", () => {
    const scenes = [
      pic(1, "check the lock on the back window,", "a window latch", { wordCut: true, listCut: true }),
      pic(2, "So tonight,", "a dark porch", { wordCut: true }),
      pic(3, "walk over to that front door,", "a front door from the hallway", { wordCut: true, listCut: true }),
    ];
    const secs = new Map([[scenes[0], 2.1], [scenes[1], 0.8], [scenes[2], 1.6]]);
    const r = foldSnappedFlashes(scenes, s => secs.get(s) ?? 5);
    expect(r.scenes.map(s => [s.scriptText, s.showSubject, !!s.listCut])).toEqual([
      ["check the lock on the back window,", "a window latch", true],
      ["So tonight, walk over to that front door,", "a front door from the hallway", true],
    ]);
  });

  it("the audit's production job 236 #79-#81: a word said three times and heard once is one item, never two unseen ones", () => {
    const wren = "a wren with its beak wide open on the fence post";
    const scenes = [
      pic(1, "which birders remember as", "a wren on a fence", { audioDuration: 3.9 }),
      pic(2, "teakettle,", wren, { listCut: true, audioDuration: 0 }),
      pic(3, "teakettle,", wren, { listCut: true, audioDuration: 0 }),
      pic(4, "teakettle.", wren, { listCut: true, audioDuration: 1.3 }),
      pic(5, "If you hear that by the feeder, you know who it is.", "a feeder", { audioDuration: 5.6 }),
    ];
    const r = foldUnseenBeats(scenes, s => s.audioDuration);
    expect(r.scenes.map(s => [s.scriptText, s.audioDuration])).toEqual([
      ["which birders remember as", 3.9],
      ["teakettle, teakettle, teakettle.", 1.3],
      ["If you hear that by the feeder, you know who it is.", 5.6],
    ]);
  });

  it("Dale: the pause-snap never takes a one-word item's word away", () => {
    const aligned = [0, 10.02, 10.6, 12];
    const meets: ([number, number] | null)[] = [null, [10.0, 10.05], [10.45, 10.8], null];
    expect(keepOwnWords(aligned, [0, 10.5, 10.6, 12], meets)).toEqual(aligned);
  });
});

describe("one idea, one picture (Dale's job 288)", () => {
  it("'Sell your furniture | on Facebook Marketplace.' is one picture; list items never join", () => {
    const sec = (s: StoryboardScene) => (s.listCut ? 0.8 : 2);
    const line = [pic(1, "Sell your furniture", "a bookcase", { wordCut: true }), pic(2, "on Facebook Marketplace.", "an app", { wordCut: true })];
    expect(joinShortSplits(line, sec).scenes).toHaveLength(1);
    const items = [pic(1, "a saw,", "a saw", { listCut: true }), pic(2, "a drill,", "a drill", { listCut: true })];
    expect(joinShortSplits(items, sec).scenes).toHaveLength(2);
  });
});

describe("the bridge into a list (Ruth's job 302: an empty kitchen table)", () => {
  const items = () => [
    pic(4, "a straight-stitch machine,", "a sewing machine", { listCut: true }),
    pic(5, "a rotary cutter,", "a rotary cutter", { listCut: true }),
    pic(6, "and a mountain of scraps too pretty to throw out,", "scraps", { listCut: true }),
    pic(7, "wondering if it is worth anything.", "a market table"),
    host(8, "Bye."),
  ];

  it("Ruth: the bridge is ONE picture of the table with all the items, never the empty table — and never more host time", () => {
    const scenes = [
      host(1, "Hello there.", { hostOpener: true }),
      host(2, "It paid about $4 an hour. I'm Granny Ruth,", { hostIntro: true }),
      pic(3, "and this one's for anybody sitting at a kitchen table with", "a kitchen table"),
      ...items(),
    ];
    const r = applySpokenLists(scenes, lists(scenes), { hostName: "Granny Ruth" });
    // The host's line is unchanged (job 304: a host who said the bridge used a check-in's time).
    expect(r.scenes.find(s => s.hostIntro)?.scriptText).toBe("It paid about $4 an hour. I'm Granny Ruth,");
    const set = r.scenes.find(s => s.listSet);
    expect(set?.showSubject).toMatch(/together at a kitchen table/);
    expect(r.scenes.some(s => s.showSubject === "a kitchen table")).toBe(false);
  });

  it("the group picture is the memory every item is drawn from", () => {
    const scenes = [
      host(1, "Hello there.", { hostOpener: true }),
      host(2, "So here is the thing I want you to picture before we go any further today,"),
      pic(3, "anybody sitting at a kitchen table with", "a kitchen table"),
      ...items(),
    ];
    const r = applySpokenLists(scenes, lists(scenes));
    const set = r.scenes.find(s => s.listSet);
    expect(set?.scriptText).toBe("anybody sitting at a kitchen table with");
    expect(set?.showSubject).toMatch(/straight-stitch machine.*rotary cutter.*mountain of scraps.*together at a kitchen table/);
    // Each item is then drawn from the group picture — the same machine, the same cutter.
    const machine = r.scenes.find(s => s.scriptText === "a straight-stitch machine,")!;
    const cutter = r.scenes.find(s => s.scriptText === "a rotary cutter,")!;
    expect(memorySourcesFor(r.scenes, machine)).toEqual([set]);
    expect(memorySourcesFor(r.scenes, cutter)).toEqual([set]);
    expect(memoryViewFor(r.scenes, cutter)).toMatch(/this one item/);
  });
});

describe("Diane's job 309, Lance's job 311, Pearl's job 310", () => {
  it("Diane: hair, a scalp or skin is always on a person; a hair dryer is a thing", async () => {
    expect(SHOWS_PERSON.test("dry hair at the clean, bare sink counter")).toBe(true);
    expect(SHOWS_PERSON.test("a brush spreading cool-toned gloss through silver hair")).toBe(true);
    expect(SHOWS_PERSON.test("oil building up at the scalp")).toBe(true);
    expect(SHOWS_PERSON.test("a hair dryer and a round brush on the counter")).toBe(false);
  });

  it("Diane & Lance: a person picture keeps body parts on the body, and worn things on the front", async () => {
    const lamp = { humanPresent: true, brollHostLook: "a man in a grey fleece" } as StoryboardScene;
    const c = personClauseFor(lamp, "a person seen from behind wearing the headlamp glowing red");
    expect(c).toMatch(/never looking cut off/);
    expect(c).toMatch(/headlamp is worn where it really sits, on the FRONT/);
    expect(personClauseFor({ ...lamp, humanPresent: undefined } as StoryboardScene, "x")).toBe("");
  });

  it("Lance: a host line that is only a list goes to one picture per item", () => {
    const scenes = [
      host(1, "Somewhere in your house there's probably a kit.", { hostOpener: true }),
      host(2, "A bin in the hall closet, a bag in the garage, maybe a box under the bed."),
      pic(3, "Most of them are missing something.", "an open kit"),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists(scenes));
    expect(r.scenes.map(s => [s.scriptText, !!s.hostPresent, !!s.listCut])).toEqual([
      ["Somewhere in your house there's probably a kit.", true, false],
      ["A bin in the hall closet,", false, true],
      ["a bag in the garage,", false, true],
      ["maybe a box under the bed.", false, true],
      ["Most of them are missing something.", false, false],
      ["Bye.", true, false],
    ]);
  });

  it("Pearl: 'use the link in the description' is the how-to-get-it line", async () => {
    const cta = (index: number, scriptText: string) =>
      ({ index, scriptText, hostPresent: true, cta: true, ctaIndex: 0, showSubject: "x" }) as StoryboardScene;
    const scenes = [
      host(1, "Hello.", { hostOpener: true }),
      cta(2, "Before the brim, I want to tell you about somewhere to turn when you're ready for more than hats."),
      cta(3, "It's the know-how knitters have always passed across kitchen tables, and I put it together in a digital book called Pearl's Knitting Companion. Each chapter teaches one thing and hands you something real to make with it."),
      cta(4, "To get it, use the link in the description below this video. A book keeps as well as yarn in a drawer."),
      host(5, "Bye."),
    ];
    const out = markCtaQrBlock(scenes, { qrImageUrl: "q.png", bookTitle: "Pearl's Knitting Companion", bookCoverImageUrl: "c.png" } as any, true);
    const order = out.filter(s => s.cta).map(s => (s.qrHero ? "Q" : s.coverHero ? "B" : "H")).join("");
    expect(order).toBe("HBHQ");
    expect(out.find(s => s.qrHero)?.scriptText).toMatch(/^To get it, use the link/);
  });
});

describe("Lance's job 314 and Diane's job 313", () => {
  it("Lance: a list at the start of a host line becomes pictures, and the host comes back after it", () => {
    const scenes = [
      host(1, "Somewhere in your house there's probably a kit.", { hostOpener: true }),
      host(2, "A bin in the hall closet, a bag in the garage, maybe a box under the bed. And there's a decent chance nobody has opened it since the day it got packed."),
      pic(3, "So open it.", "an open bin"),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists(scenes));
    expect(r.scenes.map(s => [s.scriptText, !!s.hostPresent, !!s.listCut])).toEqual([
      ["Somewhere in your house there's probably a kit.", true, false],
      ["A bin in the hall closet,", false, true],
      ["a bag in the garage,", false, true],
      ["maybe a box under the bed.", false, true],
      ["And there's a decent chance nobody has opened it since the day it got packed.", true, false],
      ["So open it.", false, false],
      ["Bye.", true, false],
    ]);
  });

  it("Diane: hands on her own hair are a natural side view; the body is one a real person makes", async () => {
    const s = { humanPresent: true, brollHostLook: "a woman in a black blouse" } as StoryboardScene;
    expect(personClauseFor(s, "hands brushing silver hair at the sink")).toMatch(/Seen from the side, the head and shoulders turned the same way/);
    expect(personClauseFor(s, "a stack of towels on the counter")).not.toMatch(/Seen from the side/);
    expect(ONE_BODY_CLAUSE).toMatch(/never\s+twisted round/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/more than two arms or hands on one person/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/a mirror that does not reflect/);
  });
});

describe("Diane's job 315: any part of the body stays on the body", () => {
  it("a lock of hair laid on a towel is put back on the person's head", () => {
    const lock = "A lock of hair dyed one flat dark brown from root to tip, laid across a white towel on a bathroom counter.";
    expect(DETACHED_BODY_PART.test(lock)).toBe(true);
    const fixed = onTheBody(lock);
    expect(fixed).not.toMatch(/lock of|laid across/);
    expect(fixed).toMatch(/on the person's own head/);
    expect(onTheBody("a hair dryer on the counter")).toBe("a hair dryer on the counter");
  });

  it("every picture and split panel asking for loose hair is fixed, and the picture becomes the host's", () => {
    const scenes = [
      pic(1, "Root to tip, one flat color.", "A lock of hair dyed one flat dark brown, laid across a white towel."),
      host(2, "A woman notices the gray arriving at her part.", { splitVisual: "Hair with gray roots and dyed lengths lying on a white towel in a bathroom." }),
      pic(3, "x", "a towel folded on the counter"),
    ];
    expect(keepBodyPartsOnBody(scenes)).toBe(2);
    expect(scenes[0].humanPresent).toBe(true);
    expect(scenes[0].showSubject).not.toMatch(/laid across/);
    expect(scenes[1].splitVisual).not.toMatch(/lying on a white towel/);
    expect(scenes[2].showSubject).toBe("a towel folded on the counter");
  });

  it("a split panel about hair gets the host's look, so it is drawn on her, never loose", () => {
    const scenes = [host(1, "x", { splitVisual: "gray hair coming in at her part" })];
    markHostBroll(scenes, { hostLook: "a woman in a black blouse" } as any, "host.png");
    expect(scenes[0].brollHostLook).toBe("a woman in a black blouse");
  });
});

describe("a body part never looks cut off — but real loose bits are fine (the operator, 2026-10-02)", () => {
  it("what looks cut off is fixed; what really happens is left alone — any body part", () => {
    // Cut off: put back on the person.
    expect(looksCutOff("A lock of hair dyed flat brown, laid across a white towel.")).toBe(true);
    expect(looksCutOff("Hair with gray roots lying on a white towel in a bathroom.")).toBe(true);
    // Real: a few fallen strands, a wig on its stand, extensions in a packet.
    expect(looksCutOff("A few strands of gray hair caught in a round brush on the counter.")).toBe(false);
    expect(looksCutOff("A lock of hair from a wig on a mannequin head on the counter.")).toBe(false);
    expect(looksCutOff("Strands of hair extensions laid out on the counter in their packet.")).toBe(false);
    expect(onTheBody("A few strands of hair in the sink drain.")).toBe("A few strands of hair in the sink drain.");
  });
});

describe("lists: the model and the sentence rules together (Diane's job 319)", () => {
  it("a list the model misses is still found by the sentence rules", async () => {
    const r = await findSpokenLists("Number two. The daily blow dry. Wash, towel, dryer, brush, every single morning.", {
      ask: async () => '{"lists":[]}',
    });
    expect(r.fromModel).toBe(true);
    expect(r.lists.map(l => l.items)).toEqual([["Wash", "towel", "dryer", "brush"]]);
  });
});

describe("a list item is a thing (the audit's jobs 351, 352, 357, 362)", () => {
  it("job 351: numbers, labels and rates are not items — the pictures lose their list mark and may join", () => {
    const scenes = [
      host(1, "Here is how the sides grow.", { hostOpener: true }),
      pic(2, "Round three,", "the small star blanket after round three", { listCut: true }),
      pic(3, "three a side,", "three stitches along one side", { listCut: true }),
      pic(4, "round ten,", "the growing star blanket", { listCut: true }),
      pic(5, "ten a side,", "ten stitches along one side", { listCut: true }),
      pic(6, "and round twenty,", "a much larger star blanket", { listCut: true }),
      pic(7, "twenty.", "one long side of the blanket", { listCut: true }),
      host(8, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists(scenes));
    expect(r.applied).toBe(0);
    expect(r.scenes.filter(s => s.listCut)).toEqual([]);
  });

  it("jobs 352, 357 and 362: no list of a number, of a clause, or of the model's 'as rest'", async () => {
    const text =
      "Mostly four, six, and eight inch widths. A whole lot of folks wonder if that's rude, or nosy, or some kind of jealousy thing. " +
      "The eye reads light near the face as health, as rest, as a good night's sleep. Wash, towel, dryer, brush, every single morning.";
    const r = await findSpokenLists(text, {
      ask: async () => '{"lists":[{"sentence":2,"kind":"things","items":["as health","as rest","as a good night\'s sleep"]}]}',
    });
    // The real list in the same script is still found.
    expect(r.lists.map(l => l.items)).toEqual([["Wash", "towel", "dryer", "brush"]]);
  });
});

describe("Lance's job 321: a list split across two host shots", () => {
  it("becomes one picture per item; the first shot keeps its words, the host comes back after", () => {
    const scenes = [
      host(1, "Somewhere in your house there's probably a kit. A bin in the hall closet,", { hostOpener: true }),
      host(2, "a bag in the garage, maybe a box under the bed. And there's a decent chance nobody has opened it.", { hostOpener: true }),
      pic(3, "So open it.", "an open bin"),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists(scenes));
    expect(r.skipped).toEqual([]);
    expect(r.scenes.map(s => [s.scriptText, !!s.hostPresent, !!s.listCut])).toEqual([
      ["Somewhere in your house there's probably a kit.", true, false],
      ["A bin in the hall closet,", false, true],
      ["a bag in the garage,", false, true],
      ["maybe a box under the bed.", false, true],
      ["And there's a decent chance nobody has opened it.", true, false],
      ["So open it.", false, false],
      ["Bye.", true, false],
    ]);
  });
});

describe("show exactly what the line points at (Frederick's job 329)", () => {
  const script =
    "By the end of this you'll know three things printed on the box. First thing on the label. The type. " +
    "Photoelectric sees the slow fire. Second thing on the label. Power. What you want is a sealed 10-year unit. " +
    "Third thing. Interconnection.";
  it("keeps only label words that are the script's own — never invented", () => {
    const facts = parseShownFacts(
      '{"facts":[{"thing":"the box label","words":["Photoelectric","Sealed 10-Year","Interconnected","UL Listed"]}]}',
      script
    );
    expect(facts).toEqual([{ thing: "the box label", words: ["Photoelectric", "Sealed 10-Year", "Interconnected"] }]);
    expect(scriptWords(script)("Interconnected")).toBe(true);
    expect(scriptWords(script)("Kidde")).toBe(false);
  });
  it("puts the script's label words on the picture of that label, and drops invented ones", () => {
    const scenes = [
      pic(1, "three things printed on the box", "a smoke alarm on the ceiling"),
      pic(2, "First thing on the label.", "plain white boxes"),
    ];
    applyNamedLooks(
      scenes,
      [0, 1],
      {
        kinds: [],
        pictures: [
          { id: 0, show: "close-up of the box's label", text: "Photoelectric, Sealed 10-Year, Interconnected" },
          { id: 1, show: "close-up of the label", text: "Photoelectric 4827" },
        ],
      },
      undefined,
      script
    );
    expect(scenes[0].showSubject).toBe("close-up of the box's label");
    expect(scenes[0].pictureText).toBe("Photoelectric, Sealed 10-Year, Interconnected");
    expect(scenes[1].showSubject).toBe("close-up of the label");
    expect(scenes[1].pictureText).toBeUndefined();
  });
});

describe("a line bringing up something new gets its own picture (Frederick's job 329, 0:09)", () => {
  it("the line check and the same-topic step both say so", async () => {
    const { FIT_SYSTEM } = await import("./shotList");
    expect(FIT_SYSTEM).toMatch(/ONLY when its line names nothing new you can see/);
    const src = (await import("node:fs")).readFileSync("server/shotList.ts", "utf8");
    expect(src).toMatch(/or a new kind of\s+event or situation — "the fire that starts while the house is asleep"/);
  });
});

describe("Hank's job 326: a list of STEPS (the operator, 2026-10-02)", () => {
  const line =
    "Square up the scrap with a couple of saw cuts, give it a quick brush, drill the hole about halfway through at a slight angle, oil it, and put a felt dot on the bottom.";

  it("a sequence of steps is a list; each step is the host's hands doing it, as a photo", () => {
    const scenes = [
      pic(1, "That's where the money is.", "a market table"),
      host(2, "Square up the scrap with a couple of saw cuts, give it a quick brush,"),
      pic(3, "drill the hole about halfway through at a slight angle, oil it, and put a felt dot on the bottom. That's the whole build.", "the holder"),
      host(4, "Bye."),
    ];
    const found = lists(scenes);
    expect(found).toEqual([
      {
        sentence: 1,
        kind: "steps",
        items: [
          "Square up the scrap with a couple of saw cuts",
          "give it a quick brush",
          "drill the hole about halfway through at a slight angle",
          "oil it",
          "put a felt dot on the bottom",
        ],
      },
    ]);
    const r = applySpokenLists(scenes, found, { main: "incense holder" });
    const steps = r.scenes.filter(s => s.listCut);
    expect(steps.map(s => s.scriptText)).toEqual([
      "Square up the scrap with a couple of saw cuts,",
      "give it a quick brush,",
      "drill the hole about halfway through at a slight angle,",
      "oil it,",
      "and put a felt dot on the bottom.",
    ]);
    for (const s of steps) {
      expect(s.hostPresent).toBeFalsy();
      expect(s.humanPresent).toBe(true);
      expect(s.showSubject).toMatch(/^the host's hands, mid-step: [a-z].+, while making the incense holder$/);
    }
    expect(r.scenes.map(s => s.scriptText)).toContain("That's the whole build.");
  });

  it("not steps: a story, a statement, things, an aside", () => {
    for (const s of [
      "I went home, made dinner, and slept.",
      "Back in 1985, money was tight, and nobody had cash.",
      "Honestly, it works, and that's fine.",
      "Cut it, sanded it, and oiled it.",
    ])
      expect(spokenListsByShape([s]).filter(l => l.kind === "steps")).toEqual([]);
    // a things-list is still a things-list
    expect(spokenListsByShape(["You need a saw, a drill, and a stack of sandpaper."])[0].kind).toBeUndefined();
    expect(spokenListsByShape([line])[0].kind).toBe("steps");
  });

  it("each step is the holder being made: drawn from its earlier stages, never the finished one (job 269)", () => {
    const scenes = [
      pic(1, "That's the winner.", "A finished charred cedar incense holder on the market table", {
        keyThing: "incense holder",
        buildStage: "done",
      }),
      host(2, "Square up the scrap with a couple of saw cuts, give it a quick brush,"),
      pic(3, "drill the hole about halfway through at a slight angle, oil it, and put a felt dot on the bottom. That's the whole build.", "the holder"),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists(scenes), { main: "incense holder" });
    const steps = r.scenes.filter(s => s.listCut);
    for (const s of steps) {
      expect(s.buildStage).toBe("making");
      expect(ownKeyThing(s)).toBe("incense holder"); // "oil it," too
      expect(memorySourcesFor(r.scenes, s)).toEqual([]); // the finished holder is further along
      expect(requiredThingsFor(s)[0]).toMatch(/^incense holder — when it is what is being made: as it is at this stage of being made/);
    }
  });

  it("steps that build nothing stay as they were (Frederick's job 359)", () => {
    // The real rows: a video that makes nothing has no picture with a stage, so its steps get none —
    // a smoke alarm told "NOT finished: raw pieces or partly built" would be drawn in pieces.
    const scenes = [
      pic(14, "Earlier in a way that decides whether anybody wakes up on their own. So", "a bedroom at night with the ceiling smoke alarm visible above the bed", { keyThing: "smoke alarm" }),
      pic(15, "get a stepladder,", "an aluminum stepladder standing open beneath the ceiling alarm", { keyThing: "stepladder", listCut: true }),
      pic(16, "take one alarm down,", "the host's hands taking the smoke alarm down from the ceiling", { keyThing: "smoke alarm", listCut: true }),
      pic(17, "and read the label.", "close-up of the label on the back of a white round smoke alarm, held in the host's hands", { keyThing: "smoke alarm", listCut: true }),
      host(18, "If it carries a notice about radioactive material, that's ionization."),
    ];
    const found = [{ sentence: 1, kind: "steps" as const, items: ["get a stepladder", "take one alarm down", "read the label"] }];
    const r = applySpokenLists(scenes, found, { main: "smoke alarm" });
    const steps = r.scenes.filter(s => s.listCut);
    expect(steps.map(s => s.scriptText)).toEqual(["get a stepladder,", "take one alarm down,", "and read the label."]);
    expect(steps.map(s => s.buildStage)).toEqual([undefined, undefined, undefined]);
    expect(steps.map(s => s.keyThing)).toEqual(["stepladder", "smoke alarm", "smoke alarm"]);
    // The list-item rule as before: "read the label" names no alarm, so it is not drawn from one.
    expect(steps.map(ownKeyThing)).toEqual(["stepladder", "smoke alarm", undefined]);
    expect(requiredThingsFor(steps[1])).toEqual(["smoke alarm"]);
    expect(memoryClause({ ...steps[1], memoryRefUrls: ["https://x/alarm.png"] })).toMatch(/identical shape, size, colours/);
  });
});

describe("a thing being made is never drawn from its finished picture (stored films, 2026-10-18)", () => {
  // Hank's job 268 #17 was drawn from #14, the hook's finished holder; a video that makes nothing
  // (Frederick's smoke alarm, job 262 #30) carries no stage and is drawn exactly as before.
  const finished = pic(14, "I sold a dozen.", "Closeup of a charred cedar incense holder on the workbench, finished and oiled", {
    keyThing: "incense holder",
    buildStage: "done",
  });
  const drilling = pic(17, "why not drill a hole in one and see?", "hands drilling a hole into a charred cedar block on the workbench", {
    keyThing: "incense holder",
    buildStage: "making",
  });

  it("memory skips the finished picture; a video that makes nothing is unchanged", () => {
    expect(memorySourcesFor([finished, drilling], drilling)).toEqual([]);
    const alarm = pic(1, "This is it.", "a round white smoke alarm on the hallway ceiling", { keyThing: "smoke alarm" });
    const back = pic(30, "Turn it over.", "a hand turning over the round white smoke alarm to view its back", { keyThing: "smoke alarm" });
    expect(memorySourcesFor([alarm, back], back)).toEqual([alarm]);
  });

  it("the prompt says not finished and drops 'identical shape, size'; the check asks for it at this stage", () => {
    const withMemory = { ...drilling, memoryRefUrls: ["https://x/raw.png"] } as StoryboardScene;
    const clause = memoryClause(withMemory);
    expect(clause).toMatch(/at the same or an earlier point in the making than this picture/);
    expect(clause).toMatch(/What is being made is shown exactly as far along as the words say — NOT finished: raw pieces or partly built/);
    expect(clause).not.toMatch(/identical shape, size/);
    expect(clause).not.toMatch(/the reference is how it looked before/);
    // A finished or unlabelled picture keeps the old clause word for word.
    for (const s of [{ ...withMemory, buildStage: "done" as const }, { ...withMemory, buildStage: undefined }])
      expect(memoryClause(s)).toMatch(/identical shape, size, colours/);
    expect(memoryClause(drilling)).toBe(""); // no memory, nothing said
    expect(requiredThingsQuestion(requiredThingsFor(drilling))).toMatch(
      /"incense holder — when it is what is being made: as it is at this stage of being made \(raw pieces or partly built, not yet finished\)"/
    );
  });

  it("a step filed under the bench is still a moment of the making, and the bench is never called unfinished (job 361)", () => {
    // Job 361's "give it a quick brush," was filed under the workbench. The stage is the picture's,
    // so the prompt and the check speak of "what is being made", never of an unfinished workbench.
    const brush = pic(25, "give it a quick brush,", "hands brushing sawdust off the squared cedar block on workbench", {
      keyThing: "workbench",
      buildStage: "making",
      memoryRefUrls: ["https://x/bench.png"],
    });
    const clause = memoryClause(brush);
    expect(clause).not.toMatch(/workbench, at the same or an earlier stage of being made/);
    expect(clause).toMatch(/this exact workbench, at the same or an earlier point in the making/);
    expect(requiredThingsFor(brush)[0]).toMatch(/^workbench — when it is what is being made:/);
  });
});

describe("a key thing's first picture is worth copying (stored films, 2026-10-18)", () => {
  // The first picture of a key thing is the one every later picture of it is drawn from.
  it("Ruth's job 305: the first machine is drawn by its look, without the table the look puts it on", () => {
    const first = pic(3, "at a kitchen table with", "a straight-stitch machine, a rotary cutter and a mountain of scraps at a kitchen table", {
      keyThing: "straight-stitch machine",
    });
    const things: KeyThing[] = [
      { name: "straight-stitch machine", look: "small black and chrome sewing machine, compact size, sits centered on work table" },
    ];
    const prompt = buildStillPrompt({ ...first, keyThingLook: keyThingLookFor(first, things) });
    expect(prompt).toMatch(/black and chrome/);
    expect(prompt).not.toMatch(/sits centered on work table/);
  });

  it("Dale's job 352: the planer's memory is the first picture about the planer, not the wide workshop shot", () => {
    const wide = pic(8, "my garage", "garage workshop with table saw and benchtop planer along back wall", { keyThing: "benchtop planer" });
    const feeding = pic(10, "through the planer", "man's hands feeding a rough-sawn board into a benchtop planer in a garage, pale shavings curling out", {
      keyThing: "benchtop planer",
    });
    const later = pic(13, "another pass", "man's hands running a board face through benchtop planer in garage", { keyThing: "benchtop planer" });
    expect(memorySourcesFor([wide, feeding, later], later)).toEqual([feeding]);
  });

  it("Dale's job 369: a group shot flagged only for writing is still the box's memory; one that missed the box is not", () => {
    const group = pic(14, "Personalized mid-tier work.", "a walnut engraved board, a maple house sign and a small walnut keepsake box grouped together on a shelf", {
      keyThing: "Engraved Board",
      otherKeyThings: ["Keepsake Box"],
    });
    const box = pic(25, "a keepsake box", "Close-up of a finished walnut keepsake box sitting on the garage workbench", { keyThing: "Keepsake Box" });
    markMemoryFit(group, false);
    expect(memorySourcesFor([group, box], box)).toEqual([group]);
    markMemoryFit(group, true);
    expect(memorySourcesFor([group, box], box)).toEqual([]);
  });
});

describe("Hank's job 332: a story is different moments; a tool in its real position (2026-10-02)", () => {
  const scenes = [
    pic(0, "Now the winner. Charred cedar incense holders,", "a charred cedar incense holder with a lit stick, smoke rising"),
    pic(1, "made from the scraps in that coffee can.", "a coffee can full of charred cedar scraps"),
    pic(2, "That can was sitting right next to the trash bin.", "the coffee can of scraps beside a trash bin"),
    pic(3, "why not drill a hole in one and see?", "the host's hands drilling into a charred cedar scrap", { humanPresent: true }),
  ];
  const runs = [[0, 1, 2, 3]];
  const answer = JSON.stringify({
    groups: [{ ids: [0, 1, 2, 3], show: "hands drilling into a charred cedar block, a can of charred cedar scraps beside it" }],
  });

  it("the drilling never takes over the lines before it", () => {
    const groups = parseContextGroups(answer, runs, i => scenes[i].showSubject, i => atWork(scenes[i]));
    // The drilling picture is cut off, and the lines before it never take the drilling picture:
    // each keeps its own (the holder, the can, the can by the trash bin).
    expect(groups).toEqual([]);
    // Lines about the thing on its own still join when the group picture is the thing.
    const things = parseContextGroups(
      JSON.stringify({ groups: [{ ids: [1, 2], show: "a coffee can of charred cedar scraps beside a trash bin" }] }),
      runs,
      i => scenes[i].showSubject,
      i => atWork(scenes[i])
    );
    expect(things.map(g => g.ids)).toEqual([[1, 2]]);
  });

  it("a group that really is one picture still joins", () => {
    const scarf = [
      pic(0, "This striped scarf took me two evenings.", "a striped scarf on a chair"),
      pic(1, "It sold for twenty-five dollars at the fair.", "a striped scarf on a chair"),
    ];
    const g = parseContextGroups(
      JSON.stringify({ groups: [{ ids: [0, 1], show: "a striped scarf on a chair" }] }),
      [[0, 1]],
      i => scarf[i].showSubject,
      i => atWork(scarf[i])
    );
    expect(g).toEqual([{ ids: [0, 1], show: "a striped scarf on a chair" }]);
  });

  it("every picture of hands or the host at work carries the real tool position", () => {
    expect(ONE_BODY_CLAUSE).toContain(TOOL_POSITION_CLAUSE);
    expect(ANON_PERSON_SUFFIX).toContain(TOOL_POSITION_CLAUSE);
    expect(TOOL_POSITION_CLAUSE).toMatch(/overhangs the bench edge/);
    expect(TOOL_POSITION_CLAUSE).toMatch(/never in front of it, in its path/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/fingers in front of or right beside a blade/);
  });
});

describe("Frederick's job 335: what the line is about stays the subject; unread print from a step back", () => {
  const alarm = "smoke alarm unit";
  const first = pic(0, "There's a smoke alarm on your hallway ceiling.", "a white smoke alarm on a hallway ceiling", { keyThing: alarm });

  it("a remembered thing named BESIDE the subject is kept small (0:07, the night fire)", () => {
    const fire = pic(1, "the one kind of fire that likes to start while the house is asleep",
      "thin smoke slowly rising from a smoldering mattress in a dark bedroom at night, a smoke alarm unit on the ceiling above",
      { keyThing: alarm });
    expect(isSubject(fire, alarm)).toBe(false);
    expect(memoryViewFor([first, fire], fire)).toBe(BACKGROUND_VIEW);
    // still remembered: it is drawn from the first alarm picture
    expect(memorySourcesFor([first, fire], fire)).toEqual([first]);
  });

  it("the same thing as the subject keeps today's framing", () => {
    for (const show of [
      "the host's hands taking a smoke alarm down from the ceiling",
      "a ceiling smoke alarm with an open flame flickering below it",
      "two matching smoke alarms mounted on ceilings in different rooms",
    ]) {
      const s = pic(1, "line", show, { keyThing: alarm });
      expect(isSubject(s, alarm)).toBe(true);
      expect(memoryViewFor([first, s], s)).not.toBe(BACKGROUND_VIEW);
    }
    // other channels: the quilt is the subject, the scrap tin beside it
    const quilt = pic(1, "line", "the finished scrap quilt on a bed, the coffee tin of scraps on the chair beside it", { keyThing: "scrap quilt" });
    expect(isSubject(quilt, "scrap quilt")).toBe(true);
    expect(isSubject(quilt, "coffee tin of scraps")).toBe(false);
  });

  it("a part with unread print is never a close-up of the print (1:05, the label)", () => {
    const label = pic(1, "First thing on the label.",
      "Close-up of the small printed label on the rim of a round white plastic smoke alarm, the fine print soft and blurred",
      { keyThing: alarm, partOf: alarm, blurPrint: true });
    expect(memoryViewFor([first, label], label)).toBe(BLUR_PRINT_VIEW);
    const prompt = withAllowedText("Close-up of the label. No readable text.", undefined, true);
    expect(prompt).toMatch(/^arm's-length view of the label/);
    expect(prompt).toMatch(/arm's length away/);
    // a part whose words the script SAYS keeps the close-up and the exact words (0:18, the box)
    const box = pic(1, "three things printed on the box", "Close-up of the front of the smoke alarm box",
      { keyThing: alarm, partOf: alarm, pictureText: "Photoelectric, Sealed 10-Year, Interconnected" });
    expect(memoryViewFor([first, box], box)).toBe(PART_VIEW);
    expect(withAllowedText("Close-up of the box.", box.pictureText)).toMatch(/Close-up/);
  });
});

/**
 * ONE PICTURE, ONE INSTRUCTION (2026-10-05). A picture is described by up to four steps — what the
 * line needs, the prompt writer's rewrite, the named kind's general look, the memory picture — and
 * on Dale's job 344 they disagreed: three said "a plain board", one said "engraved"; the app's look
 * said "a grid of product cards" under a line about its settings page; a split panel that may show
 * no person was checked for hands. The picture maker drew the general version and the check failed
 * it for the particular one. These are the rules for which description wins — none names a channel.
 */
describe("one picture, one instruction (Dale's job 344)", () => {
  const engraved = pic(
    16,
    "Engraved boards,",
    "a rectangular board of maple and walnut strips with a name engraved into its surface",
    {
      visualPrompt:
        "Rectangular board with alternating pale maple and dark walnut strips, leaning against a garage wall.",
      blurPrint: true,
    }
  );

  it("what the line needs leads the prompt when the rewrite dropped part of it", () => {
    const lead = subjectLead(engraved.showSubject, engraved.visualPrompt);
    expect(lead).toMatch(/^THE PICTURE MUST SHOW: /);
    expect(lead).toContain("engraved");
    expect(buildStillPrompt(engraved).startsWith(lead)).toBe(true);
    // A rewrite that already says all of it is left alone — no doubled sentence.
    expect(subjectLead("a walnut board on a bench", "A walnut board lying on a bench.")).toBe("");
    expect(subjectLead(undefined, "anything")).toBe("");
  });

  it("an engraving is soft print: drawn as unreadable carved lines, and the check accepts that", () => {
    expect(BLURRED_PRINT_CLAUSE).toMatch(/engraved or carved/i);
    expect(buildStillPrompt(engraved)).toContain("shallow carved lines");
    expect(SOFT_PRINT_QUESTION).toMatch(/engraving/);
    expect(SOFT_PRINT_QUESTION).toMatch(/Never answer missing because its words cannot be read/);
  });

  it("a named kind's general look gives way to what this picture shows of it", () => {
    const settings = pic(
      30,
      "you can opt out in your shop settings.",
      "a phone showing the shop settings screen, a white page with toggle rows",
      { namedLook: "the shop app: a grid of product listing cards under a search bar" }
    );
    const clause = namedLookClause(settings);
    expect(clause).toContain(SUBJECT_OVER_LOOK);
    expect(clause).toMatch(/particular part, page or screen/);
    // The checker is told the same thing, or it fails the settings page for not being the grid.
    expect(exactLookQuestion(settings.namedLook!)).toMatch(/never answer true only because the frame is not the general view/);
  });

  it("a remembered thing is the same piece WITH what this picture adds to it", () => {
    const withMemory = { ...engraved, keyThing: "the board", memoryRefUrls: ["https://x/1.png"] } as StoryboardScene;
    expect(memoryClause(withMemory)).toMatch(/done or added to it/);
    expect(memoryClause(withMemory)).toMatch(/the reference is how it looked before/);
  });

  it("a split panel is drawn from, and checked against, its own description", () => {
    const beat = host(10, "Number one. Sort your finished pieces by size.", {
      showSubject: "hands sorting finished pieces into three piles",
      splitVisual: "Three piles of finished wooden pieces on a workbench.",
    });
    const panel = buildSplitRightScene(beat);
    expect(panel.showSubject).toBe(beat.splitVisual);
    expect(buildStillPrompt(panel, false, undefined, undefined, true)).not.toMatch(/hands sorting/);
    // The host beat itself is untouched.
    expect(beat.showSubject).toBe("hands sorting finished pieces into three piles");
  });

  it("words on a screen are drawn as soft bars — unless the line says them", () => {
    const listing = pic(40, "furniture on the app.", "a phone showing a listing of a bookcase", {
      visualPrompt: "A phone on a workbench showing an app listing of a bookcase.",
    });
    expect(appScreenClause(listing)).toContain(SCREEN_TEXT_AS_BARS);
    expect(SCREEN_TEXT_AS_BARS).toMatch(/never actual letters or digits/);
    // A price the line SAYS stays readable (Dale's job 306 showed a said price as a grey bar).
    expect(appScreenClause({ ...listing, pictureText: "$240" } as StoryboardScene)).not.toContain(
      SCREEN_TEXT_AS_BARS
    );
  });
});

/**
 * "STAGED" IS THE LIGHT AND THE FINISH, NEVER THE CONTENT (2026-10-05, the operator: a rule about
 * Dale's stacks "only does that for Dale"). What is in a picture comes from the script; a subject
 * that is tidy because the line is about it being sorted, folded, laid out or displayed is the
 * right picture on any channel. The rule names no object and no channel.
 */
describe("staged judges how the photo was taken, not what is in it (Dale's job 345)", () => {
  it("keeps the fake-light and advert-finish cases", () => {
    expect(STAGED_RULE).toMatch(/glowing lamp, candle or golden glow/);
    expect(STAGED_RULE).toMatch(/dramatic or moody light/);
    expect(STAGED_RULE).toMatch(/advertising finish/);
  });

  it("never fails a picture for its content or arrangement, and names no channel's things", () => {
    expect(STAGED_RULE).toMatch(/NEVER say true because of what is in the picture or how it is arranged/);
    expect(STAGED_RULE).not.toMatch(/props neatly arranged around the subject/);
    expect(STAGED_RULE).not.toMatch(/board|coaster|quilt|workbench|workshop/i);
    expect(STAGED_QUESTION).toContain(STAGED_RULE);
  });
});

/**
 * SOMEONE ELSE IS DRAWN AS SOMEONE ELSE (2026-10-05, the operator chose this over leaving people
 * out). The only person b-roll could show was the host, so a line about a customer — Dale's "a
 * buyer three states away, hunting for a board with her parents' last name on it" — came back as
 * Dale at his own bench, run after run, and the audit said "shows a man, not a woman". The shot
 * list now names the other person in the line's words; they are drawn from behind, face never
 * shown, without the host's look or photo. Any channel, any kind of person.
 */
describe("a line about someone else shows that person, not the host", () => {
  const buyer = pic(
    22,
    "a buyer three states away, hunting for a board with her parents' last name on it,",
    "a woman seen from behind on a sofa at night, scrolling a shopping app on her phone",
    { otherPerson: "a woman customer", humanPresent: true }
  );

  it("takes the person from the planner, and never the host or the viewer", () => {
    expect(otherPersonOf(" a woman customer. ")).toBe("a woman customer");
    expect(otherPersonOf("an older neighbour")).toBe("an older neighbour");
    for (const no of ["the host", "host", "you", "the viewer", "null", "", null, undefined, 3])
      expect(otherPersonOf(no)).toBeUndefined();
    // A sentence is not a description.
    expect(otherPersonOf("a woman who lives three states away and wants a board with a name")).toBeUndefined();
  });

  it("the planned shot carries the person onto its picture, as a photo with a person in it", () => {
    const beat = pic(5, "A buyer three states away can find yours while you sleep.", "x");
    const { scenes } = applyShotPlan(
      [beat],
      [
        {
          scene: 5,
          hostUntil: null,
          shots: [
            {
              from: "A buyer three",
              show: "a woman seen from behind scrolling a shopping app on her phone",
              motion: "object",
              other: "a woman customer",
            },
          ],
        },
      ]
    );
    expect(scenes[0].otherPerson).toBe("a woman customer");
    expect(scenes[0].humanPresent).toBe(true);
    expect(scenes[0].stillImage).toBe(true);
  });

  it("is never given the host's look or photo", () => {
    const scenes = [{ ...buyer }, pic(23, "Sand it smooth.", "hands sanding a board", { humanPresent: true })];
    markHostBroll(scenes, { hostLook: "a man with short white hair in a plaid shirt" }, "https://x/host.png");
    expect(scenes[0].brollHostLook).toBeUndefined();
    expect(scenes[0].brollHostRef).toBeUndefined();
    expect(scenes[0].humanPresent).toBe(true);
    // The host stays the host wherever the work is the video's own.
    expect(scenes[1].brollHostLook).toMatch(/plaid shirt/);
    expect(scenes[1].brollHostRef).toBe("https://x/host.png");
  });

  it("is drawn from behind, face never shown, one body — and told apart from the host", () => {
    const prompt = buildStillPrompt(buyer);
    expect(prompt).toContain(otherPersonClause("a woman customer"));
    expect(prompt).toMatch(/NOT the video's host/);
    expect(prompt).toMatch(/face turned away or out of frame so it is never shown/);
    expect(prompt).toMatch(/This person has exactly two arms/);
    expect(prompt).toContain(ONE_OTHER_PERSON_SUFFIX);
    expect(prompt).not.toContain(NO_FIGURES_SUFFIX);
    expect(prompt).not.toMatch(/The only person in this shot is the host/);
    // The person stays in the words that lead the prompt.
    expect(prompt).toMatch(/^(THE PICTURE MUST SHOW: )?a woman seen from behind/);
  });

  // The audit of 336 jobs (2026-10-18): the picture's OWN words decide too, not only the planner.
  it("reads someone else off the picture's own words — a role, the other sex, two people — never the host photo", () => {
    const man = "A man in his late sixties with fair skin, short grey hair, wire-rimmed glasses";
    const scenes = [
      pic(16, "grief,", "an older woman's hand resting on a framed photograph on a table", { humanPresent: true }), // job 400
      pic(35, "Coasters and ornaments are impulse buys.", "a shopper's hand picking up a coaster from a market table of coasters and ornaments"), // job 341
      pic(8, "or some kind of jealousy thing.", "medium-sized short-haired tan and white dog squeezing his nose between two people hugging in the entryway"), // job 370
      pic(17, "A hen will stick her head in the feeder", "a hen with head in the feeder tossing pellets over her shoulder", { otherPerson: "a hen", humanPresent: true }), // job 371
      pic(2, "buying his third sympathy card since spring,", "a man standing in a narrow pharmacy aisle holding a greeting card"), // job 400
    ];
    markHostBroll(scenes, { hostLook: man }, "https://x/host.png");
    expect(scenes.map(s => s.otherPerson)).toEqual(["an older woman", "a shopper", "two people", undefined, undefined]);
    expect(scenes.slice(0, 4).every(s => !s.brollHostRef)).toBe(true);
    expect(scenes[2].otherPeople).toBe(2);
    expect(scenes[3].humanPresent).toBeUndefined(); // a hen is no person
    // A plain man on a man's channel is left to the planner and the line check: the host.
    expect(scenes[4].brollHostRef).toBe("https://x/host.png");
    expect(otherPersonOf("a hen")).toBeUndefined();
  });
});

// 2026-10-11, practice runs of six channels (jobs 358-363). Every rule here names no channel.
describe("a worn thing has its wearer", () => {
  it("reads clothing, shoes and jewellery shown as worn or in use as a picture of a person", () => {
    // Job 358: an empty sleeve in a grocery aisle, and empty shoes on a car park.
    expect(
      SHOWS_PERSON.test(
        "Close-up of the sleeve and front of a heavy wool coat brushing past grocery shelves"
      )
    ).toBe(true);
    expect(
      SHOWS_PERSON.test(
        "brown leather lace-up shoes with worn soles stepping on grey asphalt"
      )
    ).toBe(true);
    // Job 362: a sweater holding a body's shape with nothing in its collar.
    expect(
      SHOWS_PERSON.test("dark beaded necklace sitting high on the chest")
    ).toBe(true);
    expect(
      SHOWS_PERSON.test("chunky round beads worn over a plain sweater")
    ).toBe(true);
    expect(SHOWS_PERSON.test("a soft shadow under the chin")).toBe(true);
  });

  it("leaves a thing that hangs, lies or stands by itself person-free", () => {
    for (const thing of [
      "a wool coat hanging on a hook by the door",
      "brown leather shoes with worn soles on a doormat",
      "a navy sweater folded on the bed",
      "a pearl necklace on a dress form",
      "an old chest of drawers by the window",
      "a tool chest resting on the bench",
      "a dog walking across the wooden floor",
    ])
      expect(WORN_ON_BODY.test(thing), thing).toBe(false);
  });

  it("marks such a picture as the host's, and tells a person-free one where clothes belong", () => {
    const scenes = [
      pic(
        1,
        "The grocery store clings to your coat.",
        "a coat sleeve brushing past grocery shelves"
      ),
    ];
    markHostBroll(
      scenes,
      { hostLook: "a man in a denim shirt" },
      "https://x/host.png"
    );
    expect(scenes[0].humanPresent).toBe(true);
    expect(scenes[0].brollHostLook).toMatch(/denim shirt/);
    expect(NO_FIGURES_SUFFIX).toMatch(
      /never filled out, standing up, stepping or moving as if someone unseen were wearing them/
    );
  });
});

describe("the host's face is never drawn", () => {
  it("takes the face out of a description of the host", () => {
    // Job 362: this description drew a full face that was not the host's.
    const asked =
      "dark beaded necklace high on the chest of an older woman, shadows under her chin, face looking tired, photographed from the shoulders up";
    const out = withoutFaceAsks(asked);
    expect(out).not.toMatch(/face looking/);
    expect(out).not.toMatch(/shoulders up/);
    expect(out).toMatch(/framed from the chin down/);
    expect(out).toMatch(/dark beaded necklace high on the chest/);
    expect(withoutFaceAsks("hands sanding a board")).toBe(
      "hands sanding a board"
    );
  });

  it("is scrubbed when the picture is marked as the host's, and the prompt says so", () => {
    const scenes = [
      pic(
        1,
        "The face looks tired.",
        "a necklace on her chest, face looking tired",
        { humanPresent: true }
      ),
    ];
    markHostBroll(
      scenes,
      { hostLook: "a woman with silver hair" },
      "https://x/host.png"
    );
    expect(scenes[0].showSubject).not.toMatch(/face/);
    expect(hostBrollClause("a woman with silver hair")).toMatch(/the face is never shown/);
  });

  it("frames a host facing the camera at the lips or chin, never a body forward with the head twisted away (Scarlett's job 395, 2:22 / 2:41)", () => {
    const clause = hostBrollClause("a woman with silver hair");
    expect(clause).toMatch(/head always faces the same way as the body/);
    expect(clause).toMatch(/cuts across the lower face, at the lips or the chin/);
    expect(clause).toMatch(/Never a body facing the camera with the head turned away/);
    expect(clause).toMatch(/same hair colour and cut, the same skin and the same clothes/);
  });
});

describe("one body at the work, and the work on its bench", () => {
  it("asks for both arms from the host's own side, and a workpiece that is a separate thing", () => {
    // Job 361: the saw hand came in from the far edge of the frame, and the block passed through the bench.
    expect(ONE_BODY_CLAUSE).toMatch(
      /never one from the opposite edge of the frame/
    );
    expect(TOOL_POSITION_CLAUSE).toMatch(
      /never sunk into, passing through or grown out of the table or bench/
    );
  });
});

describe("blurred print is never asked to be read", () => {
  it("drops 'clearly showing' and the figure from a blurred-print prompt, and only there", () => {
    // Job 359: a blurred-print picture described this way came back twice with a sharp, made-up label.
    const asked =
      "a white smoke alarm's back held steady, its printed label clearly showing the year 2009.";
    const prompt = withAllowedText(asked, undefined, true);
    expect(prompt).not.toMatch(/clearly showing/);
    expect(prompt).not.toMatch(/2009/);
    expect(prompt).toContain(BLURRED_PRINT_CLAUSE);
    // Print the line SAYS stays exact, and a picture with no print rule is untouched.
    expect(withAllowedText(asked, "2009")).toMatch(
      /clearly showing the year 2009/
    );
    expect(withAllowedText(asked, undefined)).toBe(asked);
  });
});

describe("a phone rests on something", () => {
  it("is held in a hand or lies flat — never standing upright by itself", () => {
    // Jobs 363 and 369: six pictures showed a phone standing upright on a table or a floor with nothing holding it.
    expect(appScreenClause(pic(1, "Etsy,", "a phone showing an app"))).toMatch(
      /lies flat on its back on a surface[^]*never stands upright by itself/
    );
    expect(
      appScreenClause(
        pic(2, "Etsy,", "a phone showing the app", {
          namedLook: "an app: a white screen",
        })
      )
    ).toMatch(/lies flat on its back on a surface[^]*never stands upright by itself/);
  });
});

describe("a part belongs to one whole", () => {
  it("has the props list describe the whole a listed part belongs to", () => {
    // Job 366: the list held only "dog's nose", so the one picture of the whole dog drew another dog.
    expect(CONTINUITY_SYSTEM).toMatch(/its look STARTS with the whole it belongs to/);
    expect(CONTINUITY_SYSTEM).toMatch(/every picture of the whole shows the same one/);
  });
});

describe("a remembered thing is one thing", () => {
  it("is shown open, filled or in use as itself — never with a second copy fused on", () => {
    // Job 368: "a scoop pouring pellets into the feeder", drawn from the feeder's memory, came back as
    // the closed feeder with a second open drum standing in its tray to take the pour.
    const pour = pic(7, "All of it, every time.", "a metal scoop pouring pellets into the round feeder", {
      keyThing: "feeder",
      memoryRefUrls: ["https://x/feeder.png"],
    });
    expect(memoryClause(pour)).toMatch(/never a second copy or a spare part of it beside, on or inside the first/);
  });
});

describe("the picture behind the scan card", () => {
  it("never leads with a description asking for a phone or a QR code", () => {
    // Job 370: the prompt was clean, the description was not — the picture drew a phone, a made-up
    // QR code and hands behind the real card.
    const scan = pic(24, "Pick up your phone, point it at the code.", "A smartphone held in bare hands, its camera pointed at a square black-and-white QR code", {
      cta: true,
      qrHero: true,
      humanPresent: true,
      visualPrompt: "a dog resting on the entryway mat",
    });
    expect(guardPitchVisuals([scan])).toEqual([24]);
    expect(scan.showSubject).toBeUndefined();
    expect(scan.humanPresent).toBeUndefined();
    expect(scan.visualPrompt).toBe("a dog resting on the entryway mat");
    expect(buildStillPrompt(scan)).not.toMatch(/QR|smartphone/i);
    // A clean description is left alone, and so is every picture outside a pitch.
    const plain = pic(3, "He reads your shoes.", "a phone on the hall table");
    expect(guardPitchVisuals([plain])).toEqual([]);
    expect(plain.showSubject).toBe("a phone on the hall table");
  });
});

describe("the review's persona fixes (2026-10-15)", () => {
  it("Scarlett: a make-up step on her own face is HER, drawn from her photo with the face shown", () => {
    // Over 60 STOP Applying Concealer Like This — "a different woman" at 1:44, 1:53, 7:49…
    for (const line of [
      "concealer dabbed under the eyes with a fingertip",
      "lipstick on the lips, a soft rose shade",
      "her hand blending foundation along her jawline",
    ]) {
      const scenes = [pic(1, "Dab it, don't drag it.", line)];
      markHostBroll(scenes, { hostLook: "a slim woman in her sixties with fair skin and a silver bob" }, "https://x/host.png");
      expect(scenes[0].humanPresent).toBe(true);
      expect(scenes[0].brollHostRef).toBe("https://x/host.png");
      expect(scenes[0].hostFaceShown).toBe(true);
      const prompt = buildStillPrompt(scenes[0]);
      expect(prompt).toMatch(/the SAME person as in the reference photo/);
      expect(prompt).not.toMatch(/never shown/);
    }
  });

  it("Scarlett: anything that is not a step on the face keeps the face out, as before", () => {
    const scenes = [pic(1, "Wear it high.", "a pearl strand at her collarbone over a navy sweater", { humanPresent: true })];
    markHostBroll(scenes, { hostLook: "a woman with silver hair" }, "https://x/host.png");
    expect(scenes[0].hostFaceShown).toBeUndefined();
    expect(personClauseFor(scenes[0], scenes[0].showSubject!)).toMatch(/never shown/);
  });

  it("a product on its own, or the face of a board, is never a person", () => {
    for (const thing of ["a tube of concealer on the bathroom counter", "the face of the board planed smooth", "a clock face on the wall"]) {
      const scenes = [pic(1, "Here it is.", thing)];
      markHostBroll(scenes, { hostLook: "a man with a grey beard" }, "https://x/host.png");
      expect(scenes[0].humanPresent).toBeFalsy();
    }
  });
});

describe("only a make-up step shows the face (Dale's job 372 test, 2026-10-15)", () => {
  it("'her face lit by the glow of a phone' is the host, face kept out", () => {
    const scenes = [pic(1, "She scrolls at night.", "seen from the side, her face lit by the glow of a phone showing a buy-and-sell app")];
    markHostBroll(scenes, { hostLook: "a man with a grey beard" }, "https://x/host.png");
    expect(scenes[0].humanPresent).toBe(true);
    expect(scenes[0].hostFaceShown).toBeUndefined();
  });
});

describe("a graphic is up long enough to read (Dale's job 397, found by the audit)", () => {
  it("'3 piles' at 1.27 s and the 1.4 s chapter label are too short; 1.5 s is not", () => {
    expect(tooShortToRead({ startFrame: 1446, endFrame: 1484 }, 30)).toBe(true);
    expect(tooShortToRead({ startFrame: 4067, endFrame: 4109 }, 30)).toBe(true);
    expect(tooShortToRead({ startFrame: 4067, endFrame: 4112 }, 30)).toBe(false);
  });
});

describe("the graphics planner reads what the film says over each picture (Dale's job 397, found by the audit)", () => {
  const W = (s: string): Word[] =>
    s.split(" ").map(t => {
      const [text, range] = t.split("@");
      const [start, end] = range.split("-").map(Number);
      return { text, start, end };
    });
  const at = (index: number, a: number, b: number, scriptText: string, hostPresent = false) => ({ index, narrationStartSec: a, narrationEndSec: b, scriptText, hostPresent });
  it("'$500 to $1,500. Number five' is said over host scene 36, so it is read there, not under b-roll scene 35", () => {
    const heard = W("One@186.35-186.45 Good@186.49-186.69 Saturday@186.73-187.15 market@187.21-187.55 can@187.61-187.75 gross@187.79-188.03 $500@188.35-189.21 to@189.29-189.74 $1,500.@190.25-191.42 Number@192.06-192.30 five,@192.38-192.74 sell@193.36-193.56 your@193.60-193.76 furniture@193.82-194.30 on@194.48-194.56 Facebook@194.66-195.16 Marketplace.@195.20-195.86");
    const film = { scenes: [at(35, 185.9, 188.733, "One good Saturday market can gross $500 to $1,500. Number five."), at(36, 188.733, 196.437, "Sell your furniture on Facebook Marketplace.", true)] };
    expect(wordsSaidOver(film, heard)).toEqual(["One Good Saturday market can gross", "$500 to $1,500. Number five, sell your furniture on Facebook Marketplace."]);
  });
  it("a line the film says as written keeps the script's own words (Hank's job 398: 'out of square' heard 'out a square')", () => {
    const heard = W("the@70.25-70.37 whole@70.41-70.63 grid@70.69-70.99 twists@71.05-71.39 out@71.47-71.59 a@71.63-71.67 square.@71.73-72.09");
    expect(wordsSaidOver({ scenes: [at(14, 70, 72.5, "the whole grid twists out of square.")] }, heard)).toEqual(["the whole grid twists out of square."]);
  });
});

describe("a bare moment can be explained from the job (Dale's job 397, found by the audit)", () => {
  it("'Smalls, about $10 to $40.' offered and passed over is kept as offered with no cue; a refused sentence keeps its cue and reason", () => {
    const kept = plannerForJob(
      {
        model: "claude-opus-5-5",
        rounds: [
          {
            step: "fill",
            asked: 1,
            kept: 0,
            problems: [{ cue: "front-edge-price", problem: "waits 5.4 s between its own words (most 5 s) — start it nearer its point" }],
            offered: [
              { from: 49.68, to: 52.48, text: "Smalls, about $10 to $40.", asked: [], placed: false },
              { from: 179.99, to: 185.59, text: "Put the $10 to $40 items along the front edge of the table, where hands reach first.", asked: ["front-edge-price"], placed: false },
            ],
          },
        ],
      },
      "2026-10-17T12:00:00.000Z"
    )!;
    const [smalls, frontEdge] = kept.rounds[0].offered!;
    expect(smalls).toEqual({ at: 49.68, text: "Smalls, about $10 to $40.", asked: [], placed: false });
    expect(frontEdge.asked).toEqual(["front-edge-price"]);
    expect(kept.rounds[0].problems).toEqual([{ cue: "front-edge-price", problem: "waits 5.4 s between its own words (most 5 s) — start it nearer its point" }]);
  });
});

describe("an unreadable number gets one more try in the plain text colour (Hank's job 390, found by the audit)", () => {
  // "a lattice panel that ate 6 hours of my Saturday": left out as "colour 4.0:1" after every fix.
  const cue = (): ResolvedCue => ({
    id: "lattice-six-hours",
    template: "BigNumberOverlay",
    start: 19.4,
    end: 22.6,
    startFrame: 582,
    endFrame: 678,
    props: { durationSec: 3.2, kicker: "Lattice panel", value: 6, unit: "hours", at: 0.9, theme: { bg: "#221710", accent: "#eb9046" } },
    sync: [],
    conformed: { start: false, end: true, held: true },
  });
  const run = async (plain: Reading) => {
    const c = cue();
    let n = 0;
    const made = await makeReadable(
      c,
      false,
      "designed.mov",
      {
        render: async () => `gfx-${++n}.mov`,
        measure: async x => (x.props.plain === true ? plain : { colour: x.props.lift ? 4.0 : 3.6, pass: false }),
        calmest: async () => ({ h: "left", v: "top" }),
      },
      []
    );
    return { c, made };
  };
  it("the number drawn white over the same dimmed footage is kept when it reads, at the same moment", async () => {
    const { c, made } = await run({ white: 8.4, pass: true });
    expect(made.r.pass).toBe(true);
    expect(c.props.plain).toBe(true);
    expect(made.steps.at(-1)).toBe("coloured words in the plain text colour: white 8.4:1");
    expect([c.start, c.end, c.startFrame, c.endFrame]).toEqual([19.4, 22.6, 582, 678]);
  });
  it("it stays left out when the white number does not read either", async () => {
    const { made } = await run({ white: 5.5, pass: false });
    expect(made.r.pass).toBe(false);
  });
});

describe("only narration is voiced (the audit's jobs 204/205)", () => {
  it("the writer's QA notes and the script's second copy are refused at Generate, by line", () => {
    const narration = [
      "Picture this. You're walking home just after sunset, and a black cat slips out from under a parked car, looks straight at you, and trots across the road like he owns it. And somewhere in the back of your head, a very old voice suggests that maybe you should take the long way around tonight.",
      "I'm Luca, and this one is for anyone who shares a couch with a black cat, or has ever walked past one at a shelter without quite knowing why. We're going to take the old stories apart one at a time, keep what's true, and gently set down what isn't.",
    ];
    const pasted = [...narration, "VERDICT: PASS", "VO COPY — ELEVENLABS V4", `[warm] ${narration[0]}`, narration[1]].join("\n");
    const { problems } = checkScript(pasted);
    expect(problems.map(p => [p.kind, p.line])).toEqual([["note", 3], ["note", 4], ["repeat", 1]]);
    expect(problems[2].againLine).toBe(5);
  });

  it("a narration line that says 'verdict' (job 46) is narration", () => {
    expect(checkScript("So today, twelve things about plain white vinegar, and an honest verdict on every one.").problems).toEqual([]);
  });
});

describe("a screen shows what its own description says (the audit's grid screens, 2026-10-18)", () => {
  const GRID = /buy-and-sell app: a grid of small photos/;

  it("a screen not about selling is drawn as described, never as a grid of items for sale", () => {
    const screens = [
      // Job 393: "Subscribe to Frederick Barnes," — a hand tapping a phone.
      pic(39, "Subscribe to Frederick Barnes,", "a hand tapping a phone screen in a hallway beneath a ceiling smoke alarm", {
        visualPrompt:
          "Suburban hallway at night, a round white smoke alarm mounted on the painted ceiling above, a single bare hand tapping a phone screen held at chest level.",
        humanPresent: true,
      }),
      // Job 294: the same "Subscribe" tap at a café table.
      pic(34, "Subscribe to Diane De Chambray if you want the rest…", "A woman's hand tapping a phone screen beside a white coffee cup", {
        visualPrompt: "A bare hand tapping a phone screen beside a white coffee cup on a marble café table near a window in soft morning light.",
        humanPresent: true,
      }),
      // Job 103: the tutorial video that went too fast.
      pic(3, "and the video you were following went too fast to show you.", "", {
        showSubject: undefined,
        visualPrompt:
          "A smartphone resting on a kitchen table beside yarn balls and a crochet hook, its screen showing blurred hands moving quickly through stitches. The phone screen tilts slightly, framing the rushed tutorial against the calm workspace around it.",
      }),
      // Production job 235 (Helena): an airline app; job 310: a seat map with a price on it.
      pic(11, "Fee number one is basic economy, and it finds you before you've packed a thing.", "mobile phone on the kitchen table showing an airline app screen", {
        visualPrompt:
          "Slim black smartphone with glass screen resting on a round honey-toned wood kitchen table displaying an airline app interface, shot in a sunlit home kitchen.",
      }),
      pic(102, "On a lot of airlines and a lot of fares, choosing your seat ahead of time costs extra.", "close-up of a phone screen showing a seat map with a price on a chosen seat", {
        visualPrompt: "A phone screen showing an airline seat map with colored seats and one seat highlighted on the map.",
      }),
      // Production job 260 (Lance): a camera app's password page.
      pic(126, "Start in the camera's app tonight and give the account a brand new password…", "hands holding black smartphone changing password in camera app settings", {
        visualPrompt: "Bare hands holding black smartphone upright, fingers adjusting password field in the camera app security settings screen.",
        humanPresent: true,
      }),
      // Production job 271 (Dale): a buyer's message INSIDE the selling app is still a message.
      pic(80, "Answer every message and every quote request before the night's over.", "a smartphone in hand showing a buy-and-sell app message screen", {
        visualPrompt:
          "Smartphone held at chest height displaying an open messaging app with incoming customer inquiries, bare hands visible from forearms down.",
      }),
      // Production job 332 (Lance): the scanner app "listing manufacturer names" (a verb, not a
      // listing for sale), and the rental listing that came back as a grid of bags and flashlights.
      pic(119, "a good one shows a plain list, names each manufacturer, and asks you to configure nothing.", "phone screen close on the scanner app listing manufacturer names, with the host's hands at work on it", {
        visualPrompt:
          "Close view of a smartphone screen showing a network scanner app list with manufacturer names and device types, held in bare hands in the rental bedroom.",
        humanPresent: true,
      }),
      pic(154, "Fifth, screenshot the listing again before anything about it changes,", "phone held showing rental listing photos on screen", {
        visualPrompt:
          "Close view of bare hands holding a slim black smartphone, the dark glass screen displaying a rental listing with photos, fingers visible on the sides of the phone.",
        humanPresent: true,
      }),
    ];
    for (const s of screens) {
      const prompt = buildStillPrompt(s);
      expect(prompt).toContain(DESCRIBED_SCREEN_CLAUSE);
      expect(prompt).not.toMatch(GRID);
      expect(prompt).toMatch(/never stands upright by itself/);
      expect(prompt).toContain(SCREEN_TEXT_AS_BARS.trim());
    }
    // Words the line SAYS stay readable on a described screen too (production job 338: the buyer's
    // message that her wall is exactly 41 inches).
    const said = appScreenClause(
      pic(145, "When a buyer messages that her wall is exactly 41 inches,", "a phone held up showing a buy-and-sell app message screen", {
        pictureText: "41 inches",
      })
    );
    expect(said).toContain('nothing readable on the screen except "41 inches"');
    expect(said).not.toMatch(GRID);
  });

  it("a screen word with no device in the picture adds no screen at all", () => {
    const noDevice = [
      // Job 151: the afghan "listing" to one side; job 122: the lantern "showing why the listing photo sells".
      pic(38, "or the whole thing leans off to one side,", "the afghan lying crooked, leaning off to one side on the kitchen table", {
        visualPrompt:
          "Finished lace shell afghan in soft neutral yarn, its scalloped edge draping unevenly off the wooden kitchen table, the afghan angled and listing to one side of the table's center.",
      }),
      pic(42, "Take your listing photo with the lantern lit and the room dark…", "", {
        showSubject: undefined,
        visualPrompt:
          "A finished andon lantern with warm paper panels and wooden frame sits lit on a low table in a darkened room, a settled moment showing why the listing photo sells.",
      }),
      // Job 230: the picture behind the scan card, "ready for listing or sale".
      pic(26, "Or look at the top of the description under this video…", "", {
        showSubject: undefined,
        cta: true,
        qrHero: true,
        visualPrompt:
          "Workbench in the garage workshop, a few finished wooden cutting boards and coasters arranged in a calm, orderly pile, soft daylight from a side window, ready for listing or sale.",
      }),
    ];
    // Job 342: a split panel of a board "ready for an online shop photograph", under its host beat's
    // real-app look — it was told the phone's screen shows that app.
    const panel = buildSplitRightScene(
      host(22, "Number two. Use Etsy for the thing it does best, which is reach.", {
        splitVisual:
          "Walnut cutting board with a small carved motif displayed flat on a plain background, ready for an online shop photograph.",
        namedLook: "a buy-and-sell app: white background, a grid of square product photos in two columns",
      })
    );
    for (const s of noDevice) {
      const prompt = buildStillPrompt(s);
      expect(prompt).not.toContain(DEVICE_RESTS);
      expect(prompt).not.toMatch(/screen shows/);
    }
    const panelPrompt = buildStillPrompt(panel, false, undefined, undefined, true);
    expect(panelPrompt).not.toContain(REAL_APP_SCREEN_CLAUSE);
    expect(panelPrompt).not.toContain(DEVICE_RESTS);
    // …and neither the memory step nor the check log takes the afghan for a screen.
    const first = pic(37, "Here is the afghan.", "the finished lace shell afghan on the table", { keyThing: "afghan" });
    const crooked = { ...noDevice[0], keyThing: "afghan" } as StoryboardScene;
    expect(memoryViewFor([first, crooked], crooked)).not.toBe(SCREEN_ITEM_VIEW);
    expect(pictureKindOf(crooked, crooked.visualPrompt!)).not.toBe("screen");
  });

  it("a selling screen keeps the buy-and-sell grid, and a named app its real look", () => {
    // Job 221: the bookcase's listing screen; a plain buy-and-sell app with listings.
    const listing = pic(42, "Put the measurements in the very first line, and", "A finished wooden furniture piece being noted for its dimensions in the workshop", {
      visualPrompt:
        "Tall wooden bookcase standing upright in the garage workshop near the sliding door, a smartphone resting on the workbench edge nearby showing a listing screen with dimensions noted.",
    });
    expect(buildStillPrompt(listing)).toMatch(GRID);
    expect(buildStillPrompt(pic(1, "x", "a phone showing a buy-and-sell app with handmade listings"))).toContain(APP_SCREEN_CLAUSE);
    // Production job 244: a marketplace SEARCH is a grid of things for sale — the described clause's
    // "never a grid of items for sale" would have contradicted its own description.
    const search = pic(27, "dresser,", "phone search bar listing results of wooden dressers", {
      visualPrompt: "Phone screen showing a marketplace search results grid, listings of wooden dressers displayed in thumbnail photos.",
    });
    expect(buildStillPrompt(search)).toMatch(GRID);
    expect(buildStillPrompt(search)).not.toContain(DESCRIBED_SCREEN_CLAUSE);
    expect(appScreenClause(pic(1, "x", "a phone showing a listing of the walnut bookcase"))).toMatch(/ONE item's own listing page/);
    // Job 338: "Etsy," with the real app's look stays the real app.
    const etsy = pic(5, "Etsy,", "A phone showing a white shopping app screen with a two-column grid of product photos", {
      visualPrompt:
        "A smartphone held near the workbench, its screen showing a white shopping app with a two-column grid of small product photos, words unreadable.",
      namedLook: "a shopping app: a white screen, a small orange logo at the top left, a two-column grid of product photos",
    });
    expect(buildStillPrompt(etsy)).toContain(REAL_APP_SCREEN_CLAUSE);
    // A screen not about selling never gets the one-listing page either.
    expect(appScreenClause(pic(1, "x", "a phone showing a message from the buyer about her listing"))).not.toMatch(
      /ONE item's own listing page/
    );
  });
});

describe("print the line never says is drawn soft, never asked for (the audit's writing pictures, 2026-10-18)", () => {
  it("a picture that asks for print to read takes the blurred-print road; the thing carrying it stays", () => {
    // Job 352 scene 106: the moisture meter "reading 7%" failed for writing twice and shipped.
    const meter = pic(106, "For furniture that lives indoors, you want boards reading somewhere between six and nine percent.", "close-up of the black meter's two pins pressed into a rough oak board, its small grey display reading 7%", {
      visualPrompt:
        "Close view of a black handheld moisture meter's two metal pins pressed into a rough oak board, showing a small grey display reading 7%.",
    });
    // Job 383 scene 31: six checks, writing every time — the label was asked for in the description.
    const box = pic(31, "If your house isn't wired for it, there are wireless models that pair out of the box.", "two white smoke detectors lying side by side on a counter beside their open box", {
      visualPrompt:
        "Two white round smoke detectors lying side by side on a kitchen counter next to an open cardboard box with its printed label facing forward.",
    });
    for (const s of [meter, box]) {
      expect(blurUnsaidPrint(s)).toBe(true);
      expect(buildStillPrompt(s)).toContain(BLURRED_PRINT_CLAUSE);
    }
    expect(buildStillPrompt(meter)).not.toMatch(/7%/);
    expect(buildStillPrompt(box)).toMatch(/cardboard box/);
    // Frederick's job 329: words the line SAYS stay readable and exact.
    const label = pic(30, "First thing on the label. The type.", "the alarm box's printed label facing forward", {
      pictureText: "Photoelectric",
    });
    expect(blurUnsaidPrint(label)).toBe(false);
    expect(buildStillPrompt(label)).toMatch(/exactly "Photoelectric"/);
  });

  it("'Facebook' is a brand, not a book: its screen keeps its own picture (Dale's jobs 343, 363, 372)", () => {
    const screen =
      "a phone screen showing Facebook Marketplace: a white screen with a soft blue top bar, a two-column grid of item photos with soft grey bars below them, and a small logo that cannot be read";
    expect(brollDepictsBook(screen)).toBe(false);
    // A split panel is swapped for ANY book (`guardPitchVisuals`) — this one is no book, so it stays.
    const split = host(7, "and Facebook Marketplace", { splitVisual: screen });
    expect(guardPitchVisuals([split])).toEqual([]);
    expect(split.splitVisual).toBe(screen);
    // Job 145 scene 12: a stack of books is still a book.
    expect(brollDepictsBook("a stack of closed stitch pattern books on the kitchen table")).toBe(true);
  });
});

describe("a line about the chin shows the chin, framed from the lips down (the audit, 2026-10-18)", () => {
  const LOOK = "a slender woman in her early sixties with fair skin and shoulder-length silver hair, a navy crewneck sweater";

  it("job 244 scene 3: a host picture of 'drags your chin and your jawline down' faces the camera, cut at the lips", () => {
    const scenes = [
      pic(
        3,
        "Land two inches lower, and that same necklace drags your chin and your jawline down with it.",
        "Host standing, fingertips adjusting a gold chain necklace resting at her collarbone, its pendant catching the window light",
        { humanPresent: true }
      ),
    ];
    markHostBroll(scenes, { hostLook: LOOK }, "https://x/host.png");
    expect(hostLipsCut(scenes[0])).toBe(true);
    const prompt = buildStillPrompt(scenes[0]);
    expect(prompt).toContain(HOST_LIPS_CUT_CLAUSE);
    expect(prompt).toContain(HOST_LIPS_CUT_ONLY_SUFFIX);
    // Only the first framing: never turned away, never from behind.
    expect(prompt).not.toContain(HOST_FRAMING_CLAUSE);
    expect(prompt).not.toContain(NO_OTHER_FIGURES_SUFFIX);
    expect(prompt).not.toMatch(/seen from the side so it shows there/);
    expect(HOST_LIPS_CUT_CLAUSE).toMatch(/top edge of the frame cuts across the lower face at the lips/);
    expect(HOST_LIPS_CUT_CLAUSE).toMatch(/chin, the jaw, the neck and the collarbone are in plain view/);
    expect(personClauseFor(scenes[0], scenes[0].showSubject!)).toMatch(/necklace is worn where it really sits, on the FRONT of the head or body, and the body faces the camera/);
    // The clip lane says the same.
    const clip = buildClipChain(scenes[0], { script: "x", lockMode: "ingredients", channelKey: "demo", voiceId: "v1" })[0].prompt;
    expect(clip).toContain(HOST_LIPS_CUT_CLAUSE);
    expect(clip).toContain(HOST_LIPS_CUT_ONLY_SUFFIX);
    expect(clip).not.toContain(NO_OTHER_FIGURES_SUFFIX);
  });

  it("job 378 scene 28 and job 395 scene 25: 'the skin under your chin', 'the soft shadows under the chin'", () => {
    for (const [line, shows] of [
      ["Does it brighten the skin under your chin, or does it put a shadow there?", "chunky light beads held near the chin at the window for daylight"],
      [
        "The eye reads it together with the soft shadows under the chin, and the face looks tired.",
        "woman wearing dark beaded necklace at collarbone, soft shadow under the chin above the dark beads, face turned away",
      ],
    ]) {
      const scenes = [pic(1, line, shows)];
      markHostBroll(scenes, { hostLook: LOOK }, "https://x/host.png");
      expect(scenes[0].brollHostLook, line).toBe(LOOK);
      expect(hostLipsCut(scenes[0]), line).toBe(true);
      expect(buildStillPrompt(scenes[0])).toContain(HOST_LIPS_CUT_CLAUSE);
      // The description no longer asks for the opposite framing — the picture check reads it too.
      expect(scenes[0].showSubject).not.toMatch(/turned away/);
      expect(buildStillPrompt(scenes[0])).not.toMatch(/face turned away/);
    }
  });

  it("job 395 scene 25 on a film drawn before the rule: its stored 'face turned away' never reaches the prompt", () => {
    const stored = pic(
      25,
      "The eye reads it together with the soft shadows under the chin, and the face looks tired.",
      "woman wearing dark beaded necklace at collarbone, soft shadow under the chin above the dark beads, face turned away",
      {
        humanPresent: true,
        brollHostLook: LOOK,
        brollHostRef: "https://x/host.png",
        visualPrompt: "A woman seen from behind wearing a dark beaded necklace at the collarbone, face turned away from the camera.",
      }
    );
    const still = buildStillPrompt(stored);
    expect(still).toContain(HOST_LIPS_CUT_CLAUSE);
    expect(still).not.toMatch(/face turned away|woman seen from behind/);
    const clip = buildClipChain(stored, { script: "x", lockMode: "ingredients", channelKey: "demo", voiceId: "v1" })[0].prompt;
    expect(clip).not.toMatch(/face turned away|woman seen from behind/);
    // Any other host picture keeps its own words.
    const other = pic(3, "Sand with the grain, never across it.", "host seen from behind sanding a board", {
      humanPresent: true,
      brollHostLook: LOOK,
      brollHostRef: "https://x/host.png",
    });
    expect(buildStillPrompt(other)).toMatch(/seen from behind sanding/);
  });

  it("job 223 scene 5: the pendant drawn on a dressing table under 'your jawline down with it' is worn by the host", () => {
    const scenes = [
      pic(
        5,
        "and your jawline down with it. The pendant is almost never the problem.",
        "fine gold chain necklace with small pendant draped over dressing table close up",
        {
          visualPrompt:
            "Fine gold chain necklace with small round pendant draped across the wooden dressing table near the mirror, in soft natural window light.",
        }
      ),
    ];
    markHostBroll(scenes, { hostLook: LOOK }, "https://x/host.png");
    expect(scenes[0].humanPresent).toBe(true);
    expect(scenes[0].brollHostRef).toBe("https://x/host.png");
    expect(scenes[0].showSubject).toBe(
      "fine gold chain necklace with small pendant, worn at the host's own neck, the chin and jaw in view above it — never set down."
    );
    expect(scenes[0].visualPrompt).not.toMatch(/dressing table/);
    expect(buildStillPrompt(scenes[0])).toContain(HOST_LIPS_CUT_CLAUSE);
  });

  it("job 354 scene 13 and job 392 scene 23: a chain alone, or beads laid on a cloth, under a chin line", () => {
    const line = "That thin line of gold puts a moving highlight right under your chin, and the eye reads light near the face as health.";
    const alone = [pic(13, line, "close-up of a short length of thin polished gold chain with a glint of light running along it, filling the frame")];
    markHostBroll(alone, { hostLook: LOOK }, "https://x/host.png");
    expect(alone[0].humanPresent).toBe(true);
    expect(alone[0].showSubject).toMatch(/worn at the host's own neck/);
    const laid = [
      pic(23, "Now the one that's aging you. Those beads put a shadow right under your chin.", "a chunky dark bead necklace laid on the soft cloth surface", {
        humanPresent: true,
      }),
    ];
    markHostBroll(laid, { hostLook: LOOK }, "https://x/host.png");
    expect(laid[0].showSubject).toBe("a chunky dark bead necklace, worn at the host's own neck, the chin and jaw in view above it — never set down.");
    expect(hostLipsCut(laid[0])).toBe(true);
  });

  it("the overview and every other line keep their pictures (job 223 scene 8, Scarlett's 'Wear it high', a cream on the counter)", () => {
    const scenes = [
      pic(
        8,
        "Three necklaces today that read expensive on a woman over sixty, and one that is aging you.",
        "open jewelry box on dressing table with pearls, gold chain, and bead necklaces arranged in rows"
      ),
      pic(9, "Wear it high.", "a pearl strand at her collarbone over a navy sweater", { humanPresent: true }),
      pic(10, "Does it brighten the skin under your chin?", "a jar of cream on the bathroom counter"),
      pic(11, "Three necklaces today, each sitting at a different spot under your chin.", "a pearl necklace on the dresser"),
    ];
    markHostBroll(scenes, { hostLook: LOOK }, "https://x/host.png");
    expect(scenes[0].humanPresent).toBeFalsy();
    expect(scenes[0].showSubject).toMatch(/arranged in rows$/);
    expect(hostLipsCut(scenes[1])).toBe(false);
    expect(buildStillPrompt(scenes[1])).toContain(HOST_FRAMING_CLAUSE);
    expect(scenes[2].humanPresent).toBeFalsy();
    expect(scenes[3].humanPresent).toBeFalsy();
    expect(scenes[3].showSubject).toBe("a pearl necklace on the dresser");
  });

  it("a make-up step on the jawline still shows the face; with no host a chin picture stays as it is", () => {
    const face = [pic(1, "Blend it down past your jawline.", "her hand blending foundation along her jawline")];
    markHostBroll(face, { hostLook: LOOK }, "https://x/host.png");
    expect(face[0].hostFaceShown).toBe(true);
    expect(hostLipsCut(face[0])).toBe(false);
    expect(buildStillPrompt(face[0])).toMatch(/the SAME person as in the reference photo/);
    const noHost = [pic(5, "and your jawline down with it.", "fine gold chain necklace draped over dressing table")];
    markHostBroll(noHost, { hostLook: "" }, undefined);
    expect(noHost[0].humanPresent).toBeFalsy();
    expect(noHost[0].showSubject).toBe("fine gold chain necklace draped over dressing table");
  });

  it("a line about a dog's neck, hair at the collarbone or someone else is never framed for the chin", () => {
    const scenes = [
      pic(31, "Then say hello. Soft voice, calm pat on the chest or the side of the neck.", "host's hand giving a calm pat on the dog's chest"),
      pic(2, "Shoulder-length hair that grazes your collarbone reads younger.", "host from behind brushing her shoulder-length silver hair"),
      pic(3, "Her necklace sat right under her chin.", "an older woman customer wearing a pearl necklace at the market stall", { humanPresent: true }),
    ];
    markHostBroll(scenes, { hostLook: LOOK }, "https://x/host.png");
    expect(scenes.map(s => hostLipsCut(s))).toEqual([false, false, false]);
    expect(buildStillPrompt(scenes[1])).toContain(HOST_FRAMING_CLAUSE);
  });
});

describe("a split ships with both halves, or the job says so (the audit's host-only splits, 2026-10-18)", () => {
  it("job 226: the splits that shipped as the host take alone are found from their clips", () => {
    const take = (i: number) => `https://r2/longform/226/clip-${i}-0-a.mp4`;
    const board = [
      host(3, "But the one I loved the most, a", {
        splitVisual: "A finished twelve-block sampler quilt folded over a wooden rocker in a sewing room",
        sceneStatus: "completed",
        hostClipUrls: [take(3)],
        clipUrls: [take(3)],
      }),
      // A split that got its panel: the clip is the composite, never the host take.
      host(4, "and a stack of fabric on the table", {
        splitVisual: "A stack of folded fabric on a sewing table",
        sceneStatus: "completed",
        hostClipUrls: [take(4)],
        clipUrls: ["https://r2/longform/226/split-4-0-a.mp4"],
      }),
      host(133, "The scraps cost about nothing, the batting and", {
        splitVisual: "Fabric scraps, batting, and binding strip laid out on a sewing table",
        sceneStatus: "completed",
        hostClipUrls: [take(133)],
        clipUrls: [take(133)],
      }),
    ];
    expect(splitPanelsMissing(board)).toEqual([3, 133]);
  });

  it("the production snapshot's scene 102: its last panel draw PASSED and it still shipped as the host alone", () => {
    const take = "https://r2/longform/226/clip-102-0-a.mp4";
    const board = [
      host(102, "So how do you choose well when you're standing in front of a", {
        splitVisual: "A wall of eyeglass frames in an optician's shop",
        sceneStatus: "completed",
        hostClipUrls: [take],
        clipUrl: take,
      }),
    ];
    expect(splitPanelsMissing(board)).toEqual([102]);
  });

  it("job 400 scene 3: a panel that passed on its third draw, after 300 s, is put beside the host", async () => {
    vi.useFakeTimers();
    try {
      const deadlineAt = Date.now() + 25 * 60_000;
      const started = new Promise<{ url: string }>(resolve =>
        setTimeout(() => resolve({ url: "https://r2/still-3.mp4" }), 301_000)
      );
      const result = splitPanelFor({
        started,
        still: () => Promise.reject(new Error("must not draw again")),
        deadlineAt,
      });
      await vi.advanceTimersByTimeAsync(301_000);
      await expect(result).resolves.toEqual({ url: "https://r2/still-3.mp4" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a video that moves as asked is kept (the audit's thrown-away videos, 2026-10-18)", () => {
  const ALARM = "main smoke alarm mounted on hallway ceiling with a thin curl of smoke rising beneath it";
  const answer = (changes: { what: string; meant: boolean }[]) =>
    JSON.stringify({ changes, cover: [], hands_visible: false, untouched_moved: false, morph: false, vanished: false });

  it("job 262 scene 16: the smoke changing is the shot; the alarm sliding is a glitch", () => {
    expect(clipGlitchMessage(ALARM, true)).toContain("Whatever moves by itself in that description is MEANT to move");
    expect(parseClipGlitchVerdict(answer([{ what: "smoke slightly denser/shifted on right", meant: true }]), true).glitch).toBe(false);
    expect(parseClipGlitchVerdict(answer([{ what: "the smoke alarm slid along the ceiling", meant: false }]), true).glitch).toBe(true);
  });

  it("production job 182 #40: curtains stirring from moving air — no fixed list leaves them out", () => {
    const windows = "both open windows in the house with curtains stirring from moving air";
    expect(clipGlitchMessage(windows, true)).toContain(windows);
    expect(parseClipGlitchVerdict(answer([{ what: "curtains billowed further into the room", meant: true }]), true).glitch).toBe(false);
  });

  it("job 262 scene 16: a clip that does move wrong renders once more from the same frame, then the still is that frame", () => {
    const kf = "https://r2/longform/262/broll-kf-16-0-a.png";
    const scene = pic(16, "Photoelectric sees the slow, smoldering fire substantially earlier.", ALARM, {
      selfMoving: true,
      pictureUrl: kf,
      clipUrls: ["https://r2/longform/262/clip-16-0-a.mp4"],
      submits: [{ provider: "sixtynine_labs", at: "2026-10-01T00:00:00.000Z", reason: "first" }],
    });
    expect(planGlitchRerender(scene)).toEqual({ next: "rerender", keyframe: kf });
    expect(scene.nextSubmitReason).toBe("glitch");
    scene.nextSubmitReason = undefined; // the re-render's submit consumes it
    expect(planGlitchRerender(scene)).toEqual({ next: "still", keyframe: kf });
  });
});

/**
 * THE PICTURE AND ITS LINE (2026-10-18, the audit's picture-vs-line rows). A picture of the right
 * thing can still miss what the line says about it — who is doing what, the state, the count — and a
 * picture the operator types again is its own, not the planner's. None of the rules names a channel.
 */
describe("the picture shows what its line and its typed words say (the audit, 2026-10-18)", () => {
  const SMOKE: KeyThing[] = [
    { name: "smoke alarm", look: "round white ceiling alarm", main: true },
    { name: "smoke detector box", look: "small rectangular cardboard box" },
  ];

  it("job 383 scene 20: a typed redo is led and checked by the typed words, not the planner's box", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const old = "close-up of the front label of a small rectangular cardboard smoke detector box held in one hand";
    const s = pic(20, "First thing on the label.", old, { keyThing: "smoke detector box", blurPrint: true });
    const typed =
      "A quick ordinary phone photo: one round white smoke alarm lying face up on a wooden kitchen counter in plain daylight, no box, no packaging";
    // Before: the old subject leads the typed prompt (what job 383 shipped).
    expect(buildStillPrompt({ ...s, visualPrompt: typed })).toMatch(/^THE PICTURE MUST SHOW: [^.]*front label of a small rectangular cardboard smoke detector box/);
    ownTypedPicture(s, typed, SMOKE);
    s.visualPrompt = typed; // as `prepareSceneEdit` lands it
    const prompt = buildStillPrompt(s);
    expect(prompt).not.toMatch(/THE PICTURE MUST SHOW/);
    expect(prompt).not.toMatch(/front label of a small rectangular cardboard/);
    expect(prompt).not.toContain(BLURRED_PRINT_CLAUSE);
    // The check is held to the alarm, never to the box the operator said to leave out.
    expect(requiredThingsFor(s)).toEqual(["smoke alarm"]);
  });

  it("job 383 scene 20 as stored: 'no hands, no readable writing' is drawn with nobody and no words", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const look = "A sturdy man in his fifties with a short grey-flecked beard, in a navy crew-neck t-shirt";
    const old = "close-up of the front label of a small rectangular cardboard smoke detector box held in one hand";
    const s = pic(20, "or dual sensor,", old, {
      keyThing: "smoke detector box",
      pictureText: "Dual Sensor",
      humanPresent: true,
      brollHostLook: look,
      brollHostRef: "https://x/host.png",
    });
    const typed =
      "A quick ordinary phone photo: one round white smoke alarm lying face up on a wooden kitchen counter in plain " +
      "daylight, a second small grey sensor window beside its vents, no box, no packaging, no hands, no readable " +
      "writing anywhere";
    // Before: the host at work from the planner's "held in one hand", and the label's words allowed.
    const before = buildStillPrompt({ ...s, visualPrompt: typed });
    expect(before).toContain(hostBrollClause(look));
    expect(before).toMatch(/Dual Sensor/);
    ownTypedPicture(
      s,
      typed,
      [
        { name: "smoke detector", look: "round white plastic disc", main: true },
        { name: "smoke detector box", look: "small rectangular cardboard box with a printed label" },
      ]
    );
    s.visualPrompt = typed;
    const prompt = buildStillPrompt(s);
    expect(prompt).not.toContain(hostBrollClause(look));
    expect(prompt).toContain(NO_FIGURES_SUFFIX);
    expect(prompt).not.toMatch(/Dual Sensor/);
    expect(prompt).not.toMatch(/THE PICTURE MUST SHOW/);
    expect(requiredThingsFor(s)).toEqual([]);
  });

  it("job 383 scene 40: 'no writing of any kind' is no soft print and no old back panel", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const s = pic(40, "That number surprises people more than anything else I've mentioned tonight. That's the job.",
      "detector back panel close up showing battery compartment and date area", { keyThing: "smoke alarm", blurPrint: true });
    const typed = "his hand holding a pen over a small BLANK yellow sticky note on the counter, no writing of any kind anywhere";
    ownTypedPicture(s, typed, SMOKE);
    s.visualPrompt = typed;
    const prompt = buildStillPrompt(s);
    expect(prompt).not.toMatch(/back panel|battery compartment/);
    expect(prompt).not.toContain(BLURRED_PRINT_CLAUSE);
    expect(requiredThingsFor(s)).toEqual([]);
  });

  it("job 171 scene 248: the neighbour a line check adds is that neighbour, never the host", async () => {
    const { applyPictureFixes } = await import("./shotList");
    const scenes = [
      pic(248, "That changes right here, and my neighbor across the street watched the whole thing from his driveway.",
        "an empty driveway across the street from the workshop garage"),
    ];
    applyPictureFixes(scenes, [{ id: 0, show: "an older neighbour standing in the driveway across the street, watching", other: "an older neighbour" }], undefined);
    markHostBroll(scenes, { hostLook: "a man with a grey beard in a plaid shirt" }, "https://x/host.png");
    expect(scenes[0].brollHostLook).toBeUndefined();
    const prompt = buildStillPrompt(scenes[0]);
    expect(prompt).toContain(otherPersonClause("an older neighbour"));
    expect(prompt).toContain(ONE_OTHER_PERSON_SUFFIX);
    expect(prompt).not.toContain(NO_FIGURES_SUFFIX);
  });

  it("job 305 scene 118: a description's state is checked apart from whether the thing is there", async () => {
    const { detailQuestion, missingQuestion } = await import("./overlayTextScan");
    const open = "padlock hanging open on a mesh gate latch";
    expect(detailQuestion(open)).toContain(open);
    expect(detailQuestion(open)).toMatch(/shut where it says open/);
    // `missing` keeps its meaning — the thing itself absent, swapped or small — and its wording.
    expect(missingQuestion(open)).not.toMatch(/STATE|detail/);
    // The cached rulebook is untouched: the question rides the per-picture part.
    expect(STILL_DEFECT_SYSTEM).not.toMatch(/QUESTION 4b/);
  });
});

describe("what a line rules out is never drawn (the audit, 2026-10-18)", () => {
  // Production labels "shows what the line rules out": the stack beside the furnace under "and away
  // from the furnace" (203-143, 211-135), a steel vault door under "I don't mean a steel vault"
  // (224-22), a hand at the cat's belly under "isn't an invitation to rub it" (205-292).
  it("203-143, 224-22, 205-292: the line check's mark reaches the picture check, whether or not it rewrote", async () => {
    const { parsePictureFixes, applyPictureFixes } = await import("./shotList");
    const { forbiddenQuestion } = await import("./overlayTextScan");
    const scenes = [
      pic(143, "and away from the furnace.", "a gas furnace with its burner flame glowing in a basement, a stickered board stack standing far across the room"),
      pic(22, "Number two. A safe room, and no, I don't mean a steel vault like in the movies.", "a thick round steel vault door standing open"),
      pic(292, "A belly on display isn't an invitation to rub it.", "The host's hand hovering near the belly-up tabby cat's tummy without touching it"),
    ];
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          { id: 0, about: "where the stack is kept", shows_it: false, show: "a stickered board stack on a dry garage floor", forbids: "the board stack near the furnace" },
          { id: 1, about: "a safe room", shows_it: false, show: "a small windowless interior room with a solid door", forbids: "a steel vault door" },
          { id: 2, about: "leaving the belly alone", shows_it: true, forbids: "a hand rubbing or touching the cat's belly" },
        ],
      }),
      scenes
    );
    expect(applyPictureFixes(scenes, fixes, undefined)).toBe(2);
    expect(scenes.map(s => s.forbids)).toEqual([
      "the board stack near the furnace",
      "a steel vault door",
      "a hand rubbing or touching the cat's belly",
    ]);
    // The rewrites name only what is in the frame; the third keeps its picture and its mark.
    expect(scenes[0].showSubject).not.toMatch(/furnace/);
    expect(scenes[1].showSubject).not.toMatch(/vault/);
    expect(forbiddenQuestion(scenes[2].forbids!)).toContain("a hand rubbing or touching the cat's belly");
  });

  // 225-79..83: "Never in | the garage, | the basement, | the shed, | or on the porch," — the place
  // question read "or on the porch," as where the picture belongs, so a picture drawn the right way
  // (out in the open) was "the wrong place" and its redraw pulled toward the porch.
  it("225-83: a marked picture is never held to the place its sentence rules out", async () => {
    const { placeQuestion } = await import("./overlayTextScan");
    expect(placeQuestion("or on the porch,", true)).toMatch(/is NOT where the frame must be/);
    // Every other picture is asked exactly as before ("sold at the fair" is where it belongs).
    expect(placeQuestion("sold at the fair", false)).not.toMatch(/NOT where the frame must be/);
  });

  it("the prompt writer carries the same rule, in neutral words", async () => {
    const { RULED_OUT_RULE, STILL_BROLL_ENHANCER_SYSTEM } = await import("./longformVideo");
    expect(STILL_BROLL_ENHANCER_SYSTEM).toContain(RULED_OUT_RULE);
    expect(RULED_OUT_RULE).toMatch(/never the ruled-out act, thing or\s+placement/);
    expect(RULED_OUT_RULE).toMatch(/'away from' or 'across the room from'/);
    expect(RULED_OUT_RULE).not.toMatch(/furnace|vault|shampoo|fence|belly|generator|risers/i);
  });
});

describe("a picture never ships a known fault in silence (the audit, 2026-10-18)", () => {
  // The replay of 54 practice films: 240 of 1,810 checked pictures shipped with a fault on their last
  // check, 217 of them kept the moment the same fault came back twice.
  const plain = {};
  const once = { broken: 1, writing: 1 };
  const none = new Set<"at rest" | "soft print">();
  it("352-147 broken → broken: one draw of the things at rest — never on the first broken, which a reroll clears", async () => {
    const { faultRedrawFor } = await import("./longformVideo");
    expect(faultRedrawFor(plain, { broken: true }, once, none, true)).toBe("at rest");
    expect(faultRedrawFor(plain, { broken: true }, { broken: 0, writing: 0 }, none, true)).toBeUndefined();
    expect(faultRedrawFor(plain, { broken: true }, once, new Set(["at rest" as const]), true)).toBeUndefined();
    // Over a content-policy rung the prompt is not rebuilt: that would undo the softening.
    expect(faultRedrawFor(plain, { broken: true }, once, none, false)).toBeUndefined();
  });

  it("343-17 a plain sign with writing on three of four draws: one draw with the print soft", async () => {
    const { faultRedrawFor } = await import("./longformVideo");
    expect(faultRedrawFor(plain, { writing: true }, once, none, true)).toBe("soft print");
    // it may be on a softened prompt too: it only edits the text rule, never rebuilds
    expect(faultRedrawFor(plain, { writing: true }, once, none, false)).toBe("soft print");
    expect(faultRedrawFor(plain, { writing: true }, { broken: 0, writing: 0 }, none, true)).toBeUndefined();
  });

  it("383-33 a blurred-print picture (writing ten times), print the line says, a stamped caption: no soft-print draw", async () => {
    const { faultRedrawFor } = await import("./longformVideo");
    expect(faultRedrawFor({ blurPrint: true }, { writing: true }, once, none, true)).toBeUndefined();
    expect(faultRedrawFor({ pictureText: "Photoelectric" }, { writing: true }, once, none, true)).toBeUndefined();
    expect(faultRedrawFor(plain, { writing: true, overlay: true }, once, none, true)).toBeUndefined();
  });

  it("344-11 staged, 343-30 missing, and a check that could not run: kept as before, no changed draw", async () => {
    const { faultRedrawFor } = await import("./longformVideo");
    for (const v of [{ staged: true }, { missing: true }, { messy: true }, { wrongPlace: true }] as any[])
      expect(faultRedrawFor(plain, v, once, none, true)).toBeUndefined();
    expect(faultRedrawFor(plain, { broken: true, unchecked: true }, once, none, true)).toBeUndefined();
  });

  it("the changed prompts name no channel's things", async () => {
    const { THINGS_AT_REST_CLAUSE, PERSON_FREE_FALLBACK, UNASKED_PRINT_CLAUSE } = await import("./longformVideo");
    for (const clause of [THINGS_AT_REST_CLAUSE, PERSON_FREE_FALLBACK, UNASKED_PRINT_CLAUSE])
      expect(clause).not.toMatch(/table saw|oak|vise|board|quilt|smoke alarm|house/i);
  });

  it("the at-rest redraw puts the TOOLS down, never what a picture shows lit, steaming or running", async () => {
    // Rule (n): a main thing naturally used with a flame, steam or water is shown in use, and a
    // self-moving shot's smoke moves by itself — "nothing in the frame is being used" put both out.
    const { THINGS_AT_REST_CLAUSE } = await import("./longformVideo");
    expect(THINGS_AT_REST_CLAUSE).toMatch(/\btool\b/i);
    expect(THINGS_AT_REST_CLAUSE).not.toMatch(/nothing in the frame|being used|\bstill\b|unlit|no smoke|no steam/i);
  });

  it("343-17 the soft-print redraw of a plain picture asks for no print it never had", async () => {
    const { softPrintRedraw, BLURRED_PRINT_CLAUSE, NO_READABLE_TEXT } = await import("./longformVideo");
    const out = softPrintRedraw(`Carved wooden house sign with leaf design along its edge. ${NO_READABLE_TEXT}`);
    expect(out).not.toContain(BLURRED_PRINT_CLAUSE); // "an engraved name … is there too, never left off"
    expect(out).not.toMatch(/engrav|never left off/i);
    expect(out).toContain("house sign");
  });
});

describe("a myth card's strike-through crosses every line of the myth (round 10 graphics, 2026-10-18)", () => {
  // 399 crew-myth-truth (25.1-26.5 s): "He figures she must know somebody on the crew." wrapped as it
  // shrank for the truth; the ONE bar at half the block's height fell in the gap between the two
  // lines, ran ~100 px past the words, and "somebody on the crew." was never struck.
  const myth = "He figures she must know somebody on the crew.";

  it("399 crew-myth-truth: when the stroke is done every word and every space between two is struck, the second line too", async () => {
    const { splitWords, strikeSweep } = await import("../graphics/src/timing");
    const words = splitWords(myth);
    const done = strikeSweep(words, 1);
    expect(done.words).toEqual(words.map(() => 1));
    expect(done.gaps).toEqual(words.slice(1).map(() => 1));
    // it is drawn left to right over the words in reading order, never all at once
    const half = strikeSweep(words, 0.5);
    expect(half.words[0]).toBe(1);
    expect(half.words[words.length - 1]).toBe(0);
    // and nothing before the truth comes
    expect(strikeSweep(words, 0).words.every(a => a === 0)).toBe(true);
  });

  it("399: the myth keeps its line breaks while it shrinks, so 'know' no longer jumps up a line mid-strike", async () => {
    const { mythType } = await import("../graphics/src/cards");
    const full = mythType(0);
    for (const p of [0.3, 0.6, 1]) {
      const m = mythType(p);
      expect(m.maxWidth / m.fontSize).toBeCloseTo(full.maxWidth / full.fontSize, 9);
      expect(m.fontSize).toBeLessThan(full.fontSize);
    }
    expect(full).toEqual({ fontSize: 112, maxWidth: 1240 }); // the myth before the turn is as it was
  });
});

describe("an arrow shows nothing before it draws (round 10 graphics, 2026-10-18)", () => {
  // 400 clock-before-after (62.77-67.77 s): the Before → After card's arrow drew with "now" (~65.0 s);
  // until then its shaft was a line of length 0, and the round cap painted a stray orange dot alone
  // at the middle of the screen from the card's first frame.
  it("400 clock-before-after: from the card's start to the arrow's start the shaft is not drawn at all, then it draws", async () => {
    const { appearFrame, drawnTo, fadeIn } = await import("../graphics/src/timing");
    const shaft = 180 - 8 * 3.2; // the card's arrow: 180 wide, 8 thick
    const drawsAt = appearFrame(65.167 - 62.767, 30) - 6; // "now", as the card times it
    for (let f = 0; f <= drawsAt; f++) expect(drawnTo(fadeIn(f, drawsAt, 10), shaft)).toBeNull();
    expect(drawnTo(fadeIn(drawsAt + 1, drawsAt, 10), shaft)).toBeGreaterThan(0); // drawing, not a dot
    expect(drawnTo(fadeIn(drawsAt + 10, drawsAt, 10), shaft)).toBe(shaft);
  });
});

describe("a caption on a split stays beside the host (round 10 graphics, 2026-10-18)", () => {
  // 400 host-chair-closer (138.20-143.13 s, scene 27: host left, a blank scroll right): the caption
  // was drawn for the full frame and its dark box ran across the seam, half over the scroll. The
  // lab's composite gave it the host's panel; the app's finishing step never did.
  const R2 = "https://pub-x.r2.dev/longform";
  const split = (job: number, index: number, start: number, end: number, joined = true) =>
    ({
      index,
      narrationStartSec: start,
      narrationEndSec: end,
      hostPresent: true,
      sceneStatus: "completed",
      splitVisual: "the picture beside the host",
      ...(joined ? { splitRightUrl: `${R2}/${job}/still-${index}-a.mp4` } : {}),
      clipUrls: [`${R2}/${job}/${joined ? "split" : "clip"}-${index}-0.mp4`],
      hostClipUrls: [`${R2}/${job}/clip-${index}-0.mp4`],
    }) as unknown as StoryboardScene;

  it("400 host-chair-closer over split scene 27 is drawn inside the host's 840 px; 397 impulse-buys over split scene 34 too", async () => {
    const { filmLayoutOf } = await import("./graphics/apply");
    const { hostPanelFor } = await import("../graphics/src/plan/rules");
    const { templateById } = await import("../graphics/src/registry");
    expect(templateById("HostCaption").panel).toBe(true);
    expect(hostPanelFor({ start: 138.2, end: 143.133 }, filmLayoutOf([split(400, 27, 138.19, 144.12)]))).toEqual({ x: 0, w: 840 });
    expect(hostPanelFor({ start: 173.433, end: 176.533 }, filmLayoutOf([split(397, 34, 173.43, 179.89)]))).toEqual({ x: 0, w: 840 });
  });

  it("400 host-sixty-four over scene 3, a split whose picture never came (the host take plays full frame), keeps the full frame", async () => {
    const { filmLayoutOf } = await import("./graphics/apply");
    const { hostPanelFor } = await import("../graphics/src/plan/rules");
    expect(hostPanelFor({ start: 15.267, end: 17.333 }, filmLayoutOf([split(400, 3, 12.88, 17.32, false)]))).toBeUndefined();
  });
});

describe("a warning card says what to avoid, never the thing to avoid as advice (round 10 graphics, 2026-10-18)", () => {
  // 399 dont-ask-too-early (2:13.1-2:16.1, over scene 24): under the red WARNING header the card read
  // "Ask while the cart is still working its way back," — the first ten words of "…, and you're asking
  // the crew to guess whether the last few rows will come up short", which warns NOT to ask then. On
  // screen it told the viewer to do it, and left just as the consequence began.
  it("399: the 'do X' half of a 'do X, and [bad result]' warning is refused; the right way goes in another template", async () => {
    const { namesTheDanger } = await import("../graphics/src/plan/planner");
    expect(namesTheDanger("Ask while the cart is still working its way back,")).toBe(false);
    expect(namesTheDanger("So wait until everyone's been served,")).toBe(false);
  });

  it("every warning card the planner placed in earlier films still passes (Ruth 350, Frederick 376/384/385, Hank 382, job 387)", async () => {
    const { namesTheDanger } = await import("../graphics/src/plan/planner");
    for (const real of [
      "These bowls are not for hot food or the microwave",
      "Keep all ten fingers away from that rotary cutter",
      "No date at all? It's old enough.",
      "Every notch has to be dead on",
      "Smoke alarms expire. At 10 years the unit is finished.",
      "The old 9-volt battery starts chirping, somebody yanks it out, and that alarm is now doing absolutely nothing.",
      "The mistake with pearls is saving them.",
    ])
      expect(namesTheDanger(real), real).toBe(true);
  });
});

describe("a warning card may simply name the thing to avoid (round 10 graphics review, 2026-10-18)", () => {
  // 395 dark-beads-warning: "Now the one that's aging you. Chunky black or very dark beads." — the card
  // showed the second sentence under WARNING. It has no danger word, but a thing named on its own
  // cannot tell the viewer to do anything, so it stays a warning. 389 leave-room-in-price ("Either way,
  // leave enough room in the price") is the right way, a command, and goes to another template.
  it("395's named thing passes; 389's command and 399's 'do X' half are still refused", async () => {
    const { namesTheDanger } = await import("../graphics/src/plan/planner");
    expect(namesTheDanger("Chunky black or very dark beads.")).toBe(true);
    expect(namesTheDanger("Either way, leave enough room in the price")).toBe(false);
    expect(namesTheDanger("Ask while the cart is still working its way back,")).toBe(false);
    expect(namesTheDanger("Ask while the cart is still working its way back.")).toBe(false);
  });
});

describe("a quote card signed with the host's name is the host's own words (round 10 graphics review, 2026-10-18)", () => {
  // 399 keep-the-can-quote (1:23.6-1:25.9, over scene 17): "So when the cart reaches your row, speak up.
  // "Could I keep the rest of the can, please?"" — the card showed the second sentence signed
  // "— HELENA HART". Those are the words the host tells the VIEWER to say to the crew; signed by the
  // host, a flight attendant, it read as her asking for the can. Such a line goes to a caption with no name.
  it("399: the line the viewer is told to say is refused as a quote, by its lead-in and as a request", async () => {
    const { notTheHostsWords } = await import("../graphics/src/plan/planner");
    expect(notTheHostsWords("Could I keep the rest of the can, please?", "So when the cart reaches your row, speak up.")).toBeDefined();
    expect(notTheHostsWords("Could I keep the whole can?", "So when the cart comes, speak up.")).toBeDefined();
  });

  it("every quote the planner signed in earlier films still passes, with the words said before it (Frederick 376/383, Dale 389)", async () => {
    const { notTheHostsWords } = await import("../graphics/src/plan/planner");
    expect(notTheHostsWords("Close the bedroom doors at night.", "One more, and it's free.")).toBeUndefined();
    expect(notTheHostsWords("Its job is catching the slow part.", "So the alarm's real job was never the flame.")).toBeUndefined();
    expect(
      notTheHostsWords(
        "Build it well, price it honest, and let every piece find its lane.",
        "For more shop-tested fixes like these, subscribe to Dale Oakfield's Workshop, and tell me in the comments which of the three sells best where you live."
      )
    ).toBeUndefined();
  });
});

describe("a quote the host introduces as her own saying stays a quote (round 10 graphics review, 2026-10-18)", () => {
  // The A5 check above first read "always"/"just" as a command wherever it stood, so "Like I always
  // say," — the host introducing her OWN saying — read as handing the viewer a line, and "please" as a
  // verb read as a request. Both refused the very line a Quote is for; job 399 stays refused.
  it("'Like I always say, \"…\"' and 'You can't please everyone, so why try?' pass; job 399 is still refused", async () => {
    const { notTheHostsWords } = await import("../graphics/src/plan/planner");
    expect(notTheHostsWords("Measure twice, cut once.", "Like I always say,", true)).toBeUndefined();
    expect(notTheHostsWords("Slow is smooth, and smooth is fast.", "As I always tell them:", true)).toBeUndefined();
    expect(notTheHostsWords("You can't please everyone, so why try?")).toBeUndefined();
    expect(notTheHostsWords("Could I keep the rest of the can, please?", "So when the cart reaches your row, speak up.", true)).toBeDefined();
    expect(notTheHostsWords("Could I see the one in the window?", "So always ask:")).toBeDefined();
  });
});

describe("a step chain shows steps done in order; a choice is not the next step (round 10 graphics review, 2026-10-18)", () => {
  // 399 snack-ask-steps (2:19.8-2:28.6, over scenes 25-26): "So wait until everyone's been served, then
  // catch a flight attendant as they pass, or step back to the galley, and phrase it as an offer." The
  // StepLabels chain read "1 Wait until served → 2 Catch an attendant → 3 Or step to galley → 4 Phrase it
  // as offer"; the galley is another way to reach the crew, and the arrows told the viewer to do both.
  it("399: the chain with the choice as step 3 is refused; the step chains placed before (385, 386, 397) pass", async () => {
    const { choiceSteps } = await import("../graphics/src/plan/planner");
    expect(
      choiceSteps([
        { at: "@wait until everyone's", text: "Wait until served" },
        { at: "@then catch a flight attendant", text: "Catch an attendant" },
        { at: "@or step back", text: "Or step to galley" },
        { at: "@and phrase it", text: "Phrase it as offer" },
      ])
    ).toEqual([2]);
    expect(choiceSteps([{ text: "Get a stepladder" }, { text: "Take one alarm down" }, { text: "Read the label" }], k => [undefined, "a stepladder,", "down, and"][k])).toEqual([]);
    expect(choiceSteps([{ text: "Measurements first line" }, { text: "Piece to driveway" }], k => [undefined, "line, and"][k])).toEqual([]);
    expect(choiceSteps([{ text: "Build it well" }, { text: "Price it honest" }, { text: "Find its lane" }], k => [undefined, "it well,", "honest, and"][k])).toEqual([]);
  });

  it("399: the spoken-list finder joins the choice to the step before it; the same film's 'Or look underneath…' steps stay", async () => {
    const { parseSpokenLists } = await import("./spokenLists");
    const steps = (sentence: string, items: string[]) => parseSpokenLists(JSON.stringify({ lists: [{ sentence: 0, kind: "steps", items }] }), [sentence]);
    expect(
      steps("So wait until everyone's been served, then catch a flight attendant as they pass, or step back to the galley, and phrase it as an offer.", [
        "wait until everyone's been served",
        "catch a flight attendant as they pass",
        "step back to the galley",
        "phrase it as an offer",
      ])?.[0].items
    ).toEqual(["wait until everyone's been served", "catch a flight attendant as they pass, or step back to the galley", "phrase it as an offer"]);
    const scan = ["look underneath this video", "open the description", "tap the link at the top"];
    expect(steps("Or look underneath this video, open the description, and tap the link at the top.", scan)?.[0].items).toEqual(scan);
  });
});

describe("a list window is a list the narrator says, its rows in his own words (round 10 graphics review, 2026-10-18)", () => {
  // 400 seneca-essay-list (1:41-1:48, over scenes 21-24): the planner's own ListWindow "Seneca's essay"
  // numbered "1 Two thousand years ago / 2 Seneca wrote a short / 3 Furious / 4 Loving essay" on one
  // sentence. 400 who-seneca-was (2:03-2:16): rows clipped into headlines, "One step from throne" and
  // "Ordered to end life".
  const essay =
    "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus, the official in charge of Rome’s grain supply — busy, important, and worn down to the rims.";
  const who =
    "He was one of the richest men in the empire, an advisor standing one step from the throne, buried under exactly the kind of obligations we are about to talk about — and a man who, years later, would be ordered to end his own life by the very emperor he had served.";

  it("400: 'Seneca's essay' is not a list; 'Who Seneca was' and the lists placed before (397, 399, 400) are", async () => {
    const { notAListAsSaid } = await import("./spokenLists");
    expect(notAListAsSaid(essay, ["Two thousand years ago", "wrote a short", "furious", "loving essay"])).toMatch(/a length of time/);
    expect(notAListAsSaid(essay, ["a man named Lucius Annaeus Seneca", "a man named Paulinus"])).toMatch(/not said as a list/);
    expect(
      notAListAsSaid(who, [
        "an advisor standing one step from the throne",
        "buried under exactly the kind of obligations we are about to talk about",
        "and a man who, years later, would be ordered to end his own life",
      ])
    ).toBeUndefined();
    expect(notAListAsSaid("Run all three, and let each one carry its own lane. Smalls to the markets, personalized work on Etsy, furniture on Marketplace.", ["Smalls to the markets", "personalized work on Etsy", "furniture on Marketplace"])).toBeUndefined();
    expect(
      notAListAsSaid("one of them was sitting in an empty row closer to the front, holding the whole can of ginger ale, a second bag of pretzels, and a bottle of water for later.", [
        "the whole can of ginger ale",
        "a second bag of pretzels",
        "a bottle of water for later",
      ])
    ).toBeUndefined();
    expect(notAListAsSaid("The farmer complains, the senator complains, the old complain, and the young are already rehearsing the complaint.", ["The farmer complains", "the senator complains", "the old complain"])).toBeUndefined();
  });

  it("400: the clipped rows get their 'the' and 'his own' back; a row in the planner's own words stays", async () => {
    const { restoreRowGrammar } = await import("../graphics/src/plan/planner");
    expect(restoreRowGrammar("One step from throne", "an advisor standing one step from the throne")).toBe("One step from the throne");
    expect(restoreRowGrammar("Ordered to end life", "and a man who, years later, would be ordered to end his own life")).toBe("Ordered to end his own life");
    expect(restoreRowGrammar("Buried under obligations", "buried under exactly the kind of obligations we are about to talk about")).toBe("Buried under obligations");
    expect(restoreRowGrammar("Smalls → markets", "Smalls to the markets")).toBe("Smalls → markets");
  });
});

describe("QA never fails a card the resolver held to the cut through a pause (round 10 graphics review, 2026-10-18)", () => {
  // 400 seven-thieves (1:35-1:41): the "7 thieves" card left on the cut at 100.63, in the silence after
  // "…name all seven of the thieves.", and the film's QA said "still up after its words" — it kept its
  // own, looser copy of the resolver's rules and measured from "seven" with a caption's 1.2 s.
  it("400: the stored plan, its word times and cuts resolve the card where the film had it, and QA passes it", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolveCues, stillUpAfterWords } = await import("../graphics/src/cueResolve");
    const { TEMPLATES } = await import("../graphics/src/registry");
    const job = JSON.parse(readFileSync("graphics/src/plan/__fixtures__/job400-graphics.json", "utf8"));
    const cues = resolveCues(job.plan, job.words, {
      cuts: job.cutFrames.map((f: number) => f / 30),
      fps: 30,
      structural: new Set(TEMPLATES.filter(t => t.structural).map(t => t.id)),
      cards: new Set(TEMPLATES.filter(t => t.kind === "card").map(t => t.id)),
      fullFrame: new Set(TEMPLATES.filter(t => t.kind === "card" || t.underlay === "window").map(t => t.id)),
    });
    const card = cues.find(c => c.id === "seven-thieves")!;
    expect([card.start, card.end, card.spokenEnd]).toEqual([95.3, 100.633, 100.905]);
    expect(stillUpAfterWords(card, 30)).toBe(false);
    // kept 2 s into the next sentence, it is still failed
    expect(stillUpAfterWords({ ...card, end: 103 }, 30)).toBe(true);
  });
});

describe("an icon is the object its words name, or none (round 10 graphics review, 2026-10-18)", () => {
  // 399 whole-can-fact (1:09.5-1:13.7): the FactCard's icon was 1f96b "canned food", a food tin, on a
  // fact about the rest of a drink can — Unicode has no drink can, and the catalogue asked for an icon
  // on every card. 400 clock-before-after (1:02.8-1:07.8): an alarm clock for "Background noise at
  // thirty" and a megaphone for "The loudest thing". The repo has no table of emoji names, so whether
  // an emoji IS the object is the prompt's rule alone; what the code holds is that an icon may be left out.
  const words = (s: string) =>
    s.split(" ").map(t => {
      const [text, range] = t.split("@");
      const [start, end] = range.split("-").map(Number);
      return { text, start, end };
    });
  const scene = (index: number, a: number, b: number, scriptText: string, hostPresent = false) => ({ index, narrationStartSec: a, narrationEndSec: b, scriptText, hostPresent, cta: false, split: false, hostOpener: false });
  const answering = (cue: object) => async () => JSON.stringify({ cues: [cue] });

  it("the planner is told: the object itself, or leave the icon out", async () => {
    const { systemPrompt } = await import("../graphics/src/plan/planner");
    const prompt = systemPrompt({ kept: false });
    expect(prompt).toContain(`"icon" is OPTIONAL everywhere but IconCallout`);
    expect(prompt).toContain("the nearest emoji of another");
    expect(prompt).not.toContain("a plain, literal object");
  });

  it("399: the fact card is kept with no icon — an icon written blank is no longer refused as a missing emoji", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    const heard = words(
      "On@69.628-69.708 many@69.768-69.968 of@70.008-70.048 those@70.088-70.288 carriers,@70.328-70.828 you@71.008-71.108 can@71.149-71.249 have@71.289-71.409 the@71.449-71.529 whole@71.589-71.829 thing@71.909-72.189 just@72.329-72.489 by@72.529-72.649 asking.@72.769-73.13 I@73.87-73.97"
    );
    const film = { scenes: [scene(16, 59.25, 73.71, "On many of those carriers, you can have the whole thing just by asking."), scene(17, 73.71, 85.87, "I figured that out much too late,")] };
    const fact = { id: "whole-can-fact", template: "FactCard", start: "On many of those carriers,", startPad: -0.15, end: "just by asking.", endPad: 0.3, props: { kicker: "Fact", fact: { text: "On many of those carriers, you can have the whole thing just by asking.", words: true }, emphasis: ["asking."], icon: "" } };
    const out = await planGraphics({ words: heard, film, ask: answering(fact), ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([]);
    expect(out.cues.map(c => c.id)).toEqual(["whole-can-fact"]);
    expect(out.cues[0].props).not.toHaveProperty("icon");
  });

  it("400: with the after side's icon left out, the clock card is kept and shows no icon on either side", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    const heard = words(
      "and@62.065-62.165 a@62.205-62.225 clock@62.305-62.625 that@62.665-62.805 was@62.825-62.965 background@63.065-63.546 noise@63.606-63.866 at@63.926-63.986 30@64.226-64.527 is@65.027-65.107 now@65.167-65.327 the@65.367-65.487 loudest@65.607-66.048 thing@66.108-66.288 in@66.328-66.368 the@66.408-66.508 room.@66.568-66.848 My@67.889-68.049"
    );
    const film = { scenes: [scene(12, 59.26, 67.76, "and a clock that was background noise at thirty is now the loudest thing in the room."), scene(13, 67.76, 70.93, "My name is", true)] };
    const clock = {
      id: "clock-before-after",
      template: "BeforeAfter",
      start: "and a clock that was background",
      startPad: -0.15,
      end: "loudest thing in the room.",
      endPad: 0,
      props: { kicker: "The clock", before: { at: "@background noise at thirty", icon: "23f0", label: "Background noise at thirty" }, after: { at: "@now the loudest thing", label: "The loudest thing" } },
    };
    const out = await planGraphics({ words: heard, cuts: [59.26, 67.76, 70.93], film, ask: answering(clock), ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([]);
    const props = out.cues[0].props as { before: object; after: object };
    expect(props.before).not.toHaveProperty("icon");
    expect(props.after).not.toHaveProperty("icon");
  });
});

describe("a general head before its examples is no list item (job 400 at 0:47, 'some ordinary place')", () => {
  // The list graphic numbered "1 Some ordinary place" under the title "Ordinary places", and the head
  // got its own picture (scene 8, a woman at a sink): the voice names three places, the film showed four.
  const LINE =
    "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet.";

  it("the model's head is dropped and the film is cut on the examples only", async () => {
    const r = await findSpokenLists(`Maybe you have done that arithmetic. ${LINE}`, {
      ask: async () => '{"lists":[{"sentence":1,"kind":"things","items":["some ordinary place","a waiting room","a church pew"]}]}',
    });
    expect(r.lists).toEqual([{ sentence: 1, items: ["a waiting room", "a church pew"] }]);
    const scenes = [
      pic(1, "Maybe you have done that arithmetic.", "an older man at a pharmacy counter"),
      pic(2, "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew,", "an older man alone on a grey padded chair"),
      pic(3, "the kitchen table at two in the morning when the house is too quiet.", "a kitchen table at night"),
      host(4, "And the math always presents itself as the problem."),
    ];
    const cut = applySpokenLists(scenes, r.lists);
    expect(cut.scenes.map(s => [s.scriptText, !!s.listCut])).toEqual([
      ["Maybe you have done that arithmetic.", false],
      ["Most people past sixty have — usually in silence, usually in some ordinary place,", false],
      ["a waiting room,", true],
      ["a church pew,", true],
      ["the kitchen table at two in the morning when the house is too quiet.", false],
      ["And the math always presents itself as the problem.", false],
    ]);
    // The shape rules agree when the call fails.
    expect(spokenListsByShape([LINE])).toEqual([{ sentence: 0, items: ["a waiting room", "a church pew"] }]);
  });

  it("a real first thing stays item 1: job 110's porch, and 'some glue'", () => {
    expect(
      spokenListsByShape(["…and they go for $38 to $60 to anybody with a porch, a patio, or a houseplant habit."]).map(l => l.items)
    ).toEqual([["a porch", "a patio", "a houseplant habit"]]);
    expect(spokenListsByShape(["You'll need some glue, a clamp, and a rag."]).map(l => l.items)).toEqual([["some glue", "a clamp", "a rag"]]);
  });
});

describe("the head's picture of its own is gone, not turned into a group picture (job 400 scene 8)", () => {
  it("right after the host, the head the planner cut leads the waiting room's picture", () => {
    const scenes = [
      host(7, "Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in"),
      pic(8, "some ordinary place,", "an older woman standing alone at a sink by a window", { listCut: true }),
      pic(9, "a waiting room,", "a row of grey padded waiting room chairs against a pale wall", { listCut: true }),
      pic(10, "a church pew,", "a long empty dark polished wooden church pew", { listCut: true }),
      pic(11, "the kitchen table at two in the morning when the house is too quiet.", "a wooden kitchen table at night"),
      host(12, "And the math always presents itself as the problem."),
    ];
    // The list as job 400 saved it, head and all.
    const r = applySpokenLists(scenes, [{ sentence: 1, items: ["some ordinary place", "a waiting room", "a church pew"] }]);
    // The bridge rule had made it "a waiting room and a church pew together, laid out side by side".
    expect(r.scenes.some(s => s.listSet)).toBe(false);
    expect(r.scenes.map(s => [s.scriptText, s.showSubject])).toEqual([
      ["Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in", "the host"],
      ["some ordinary place, a waiting room,", "a row of grey padded waiting room chairs against a pale wall"],
      ["a church pew,", "a long empty dark polished wooden church pew"],
      ["the kitchen table at two in the morning when the house is too quiet.", "a wooden kitchen table at night"],
      ["And the math always presents itself as the problem.", "the host"],
    ]);
  });
});

describe("one essay is not a list (job 400 at 1:41, 'a short, furious, loving essay')", () => {
  // The voice says one sentence; the film cut it into a forum (1.5 s), a quill (3.7 s) and the host
  // writing as Seneca (0.8 s, "furious,"), under a list graphic "Seneca's essay: 1 Two thousand years
  // ago / 2 Seneca wrote a short / 3 Furious / 4 Loving essay".
  const CUT = [
    host(19, "Today, with the help of a Roman who wrote the sharpest essay on time ever put to paper, I want to show you that the arithmetic"),
    pic(20, "was never your problem. Your problem is theft, and by the end of this video you will be able to name all seven of the thieves.", "a papyrus scroll tied with a cord"),
    pic(21, "Two thousand years ago,", "ancient Roman stone columns and a forum under a clear sky", { listCut: true }),
    pic(22, "a man named Lucius Annaeus Seneca wrote a short,", "a dark feather quill in a round glass inkwell", { listCut: true }),
    pic(23, "furious,", "a hand gripping a feather quill, pressing it hard to papyrus", { listCut: true }),
    pic(24, "loving essay to a man named Paulinus, the official in charge of Rome’s grain supply — busy, important, and worn down to the rims.", "Roman grain sacks in a stone warehouse"),
    pic(25, "Seneca was no monk on a hillside.", "a Roman palace hall with an empty throne"),
  ];
  const text = CUT.map(s => s.scriptText).join(" ");
  const essay = splitSentences(text).findIndex(s => s.startsWith("Two thousand years ago"));

  it("no list is kept in the sentence — job 400's own answer, the adjectives, or 'busy, important, worn down'", async () => {
    expect(essay).toBe(2);
    for (const items of [
      ["Two thousand years ago", "a man named Lucius Annaeus Seneca wrote a short", "furious"], // as job 400 saved it
      ["a short", "furious", "loving essay"],
      ["busy", "important", "worn down to the rims"],
    ]) {
      const r = await findSpokenLists(text, { ask: async () => JSON.stringify({ lists: [{ sentence: essay, kind: "things", items }] }) });
      expect([items, r.lists]).toEqual([items, []]);
    }
    expect(lists(CUT)).toEqual([]); // the sentence shape agrees when the call fails
  });

  it("the film's cut loses its list marks, so its pieces join like any pictures of one sentence", () => {
    const r = applySpokenLists(CUT, []);
    expect(r.cleared).toBe(3);
    expect(r.scenes.map(s => !!s.listCut)).toEqual([false, false, false, false, false, false, false]);
  });

  it("a real list in the same film is still cut, one picture per item", () => {
    expect(spokenListsByShape(["You'll want a penny, a nickel, a dime, and a quarter."]).map(l => l.items)).toEqual([
      ["a penny", "a nickel", "a dime", "a quarter"],
    ]);
  });
});

describe("a series keeps its last member (job 400 at 2:36, 'everyone complains')", () => {
  // The voice says "The farmer complains, the senator complains, the old complain, and the young are
  // already rehearsing the complaint." The list graphic "Everyone complains" read 1 The farmer / 2 The
  // senator / 3 The old and closed at 160.97 s, just as "and the young" — the line's point — began on a
  // full-frame watch picture outside the list. The list was saved with three items.
  const CUT = [
    pic(29, "Everyone complains that life is too short, Seneca says.", "a crowd of people in a Roman street gesturing and complaining to each other", { narrationStartSec: 151.76, narrationEndSec: 156.29 }),
    pic(30, "The farmer complains,", "a farmer leaning on a hoe in a dry field, shaking his head", { listCut: true, narrationStartSec: 156.29, narrationEndSec: 157.78 }),
    pic(31, "the senator complains,", "a Roman senator in an off-white draped toga gesturing in frustration in a marble hall", { listCut: true, narrationStartSec: 157.78, narrationEndSec: 159.45 }),
    pic(32, "the old complain,", "an old man sitting on a bench, sighing, hands on his cane", { listCut: true, narrationStartSec: 159.45, narrationEndSec: 160.96 }),
    pic(33, "and the young are already rehearsing the complaint.", "a young man checking a wristwatch impatiently on a street corner", { narrationStartSec: 160.96, narrationEndSec: 164.23 }),
    pic(34, "Then he turns the whole thing over in a single motion: life is not short.", "an aged papyrus scroll unrolled open on a heavy carved dark desk", { narrationStartSec: 164.23, narrationEndSec: 170.62 }),
  ];
  const SAVED = ["The farmer complains", "the senator complains", "the old complain"]; // as job 400 saved it
  const FOUR = [...SAVED, "the young are already rehearsing the complaint"];
  const text = CUT.map(s => s.scriptText).join(" ");

  it("found either way, the list has all four — the model's three get the fourth back", async () => {
    expect(lists(CUT)).toEqual([{ sentence: 1, items: FOUR }]);
    const r = await findSpokenLists(text, { ask: async () => JSON.stringify({ lists: [{ sentence: 1, kind: "things", items: SAVED }] }) });
    expect(r.lists).toEqual([{ sentence: 1, items: FOUR }]);
  });

  it("'and the young…' is the fourth item's picture, and the list graphic runs to 'complaint'", async () => {
    const r = applySpokenLists(CUT, lists(CUT));
    expect(r.scenes.map(s => [s.scriptText, !!s.listCut])).toEqual(CUT.map((s, k) => [s.scriptText, k >= 1 && k <= 4]));
    // The fallback list window (built when the planner leaves a list without one) has a fourth row,
    // said from "the young" to the end of the clause.
    const { missingListCues } = await import("../graphics/src/plan/planner");
    const words = CUT.flatMap(s => {
      const w = (s.scriptText ?? "").split(" ");
      const a = s.narrationStartSec!;
      const step = (s.narrationEndSec! - a) / w.length;
      return w.map((t, k) => ({ text: t, start: a + k * step, end: a + (k + 0.9) * step }));
    });
    const film = { scenes: CUT.map(s => ({ index: s.index, narrationStartSec: s.narrationStartSec!, narrationEndSec: s.narrationEndSec! })) };
    const [cue] = missingListCues([], words, film, [{ items: FOUR }]);
    const rows = cue.props.items as { text: string; at: string; say: string }[];
    expect(rows.map(x => x.say)).toEqual(FOUR);
    expect(rows[3].at).toBe("@the young");
  });

  it("a series ended by a clause about something else stays three; a list of things is untouched", () => {
    expect(spokenListsByShape(["The farmer complains, the senator complains, the old complain, and the truth is nobody listens."]).map(l => l.items)).toEqual([SAVED]);
    expect(spokenListsByShape(["Get a saw, a drill, a plane, and the whole thing cost me forty dollars."]).map(l => l.items)).toEqual([["a saw", "a drill", "a plane"]]);
  });
});

describe("the big QR starts on the scan line, however it is worded (jobs 399 and 400)", () => {
  // Neither block carries the fixed trigger line, so the card starts on the first sentence that
  // tells the viewer to scan. Job 399 said "Hold your phone up to the screen…" and job 400 "lift
  // your phone toward the pattern in the corner of the screen…"; neither was recognised, so 399's
  // card came on the later "tap the link" sentence and 400's on the block's last words — 7-8 s of
  // scan instruction spoken over the host with only the small corner code.
  const cta = (index: number, scriptText: string) =>
    ({ index, scriptText, hostPresent: true, cta: true, ctaIndex: 0, showSubject: "x" }) as StoryboardScene;
  const order = (out: StoryboardScene[]) =>
    out.filter(s => s.cta).map(s => (s.qrHero ? "Q" : s.coverHero ? "B" : "H")).join("");

  it("job 399: the card starts on 'Hold your phone up to the screen…', not on the backup line after it", () => {
    const scenes = [
      host(1, "So wait until everyone's been served, then catch a flight attendant as they pass.", { hostOpener: true }),
      cta(2, "Two asks in, you might wonder how anyone keeps this straight. I read what nobody else bothers to, the federal rules airlines must honor and the policies they never mention, and I gathered it into one digital book."),
      cta(3, "It's called A Hundred Air Hostess Secrets, a four hundred eighty-five page PDF, and every secret gives you the exact words,"),
      cta(4, "who to say them to, and the moment in the trip when they work. Chapter four covers in-flight requests, so when the right sentence won't come to you at the galley, it's already in your pocket. Hold your phone up to the screen with its camera on, and aim it at the little black and white code. A link appears, and you tap it."),
      cta(5, "Or look underneath this video, open the description, and tap the link at the top. None of that needs doing today, and it'll keep just fine. Back in row fourteen, the next ask skips the cart entirely."),
      host(6, "Bye."),
    ];
    const out = markCtaQrBlock(scenes, { qrImageUrl: "q.png", bookTitle: "100 Air Hostess Secrets", bookCoverImageUrl: "c.png" } as any, true);
    expect(order(out)).toBe("HBHQQ");
    expect(out.find(s => s.coverHero)?.scriptText).toMatch(/^It's called A Hundred Air Hostess Secrets/);
    expect(out.find(s => s.qrHero)?.scriptText).toMatch(/^Hold your phone up to the screen with its camera on/);
    // The pitch before it stays the host's.
    expect(out.find(s => /it's already in your pocket\.$/.test(s.scriptText ?? ""))?.hostPresent).toBe(true);
  });

  it("job 400: the card starts on 'Getting there is one small motion: lift your phone…', not on the block's last words", () => {
    const scenes = [
      host(1, "Then he turns the whole thing over in a single motion: life is not short.", { hostOpener: true }),
      cta(2, "Some of you are already a page ahead of me, wondering where all of this lives in one place."),
      cta(3, "The thinking belongs to Seneca and the Stoics after him;"),
      cta(4, "my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more. Thirteen chapters, each lesson built the same way: the real struggle, the principle underneath it, a boxed exercise to run before the day ends, and an honest note on where the advice breaks down. Chapter twelve stands on today’s exact ground — time, legacy, and what the remaining years are for. Getting there is one small motion: lift your phone toward the pattern in the corner of the screen and tap what rises, or find the first line of the description below."),
      cta(5, "No timer on this — a lesson about hurry is a poor place to hurry you. Now, back to that door you have been holding open."),
      host(6, "Bye."),
    ];
    const out = markCtaQrBlock(scenes, { qrImageUrl: "q.png", bookTitle: "The Stoic Way", bookCoverImageUrl: "c.png" } as any, true);
    expect(order(out)).toMatch(/^H*BH+QQ$/);
    expect(out.find(s => s.qrHero)?.scriptText).toMatch(/^Getting there is one small motion: lift your phone/);
    expect(out.filter(s => s.qrHero).map(s => s.scriptText).join(" ")).toMatch(/holding open\.$/);
  });

  it("a CTA block that only mentions a phone before its scan line still opens on the host and the book", () => {
    // The pitch's "it lands on your phone or your tablet" is not the scan line; the card waits for
    // the line about the code on the screen.
    const scenes = [
      host(1, "Hello.", { hostOpener: true }),
      cta(2, "I gathered the ones that still hold up into a book of my own."),
      cta(3, "It's called Three Hundred Budget-Friendly Ways to Look Expensive, and it's a digital download, so it lands on your phone or your tablet."),
      cta(4, "The chapter called The Jewelry Rules is where the necklace lengths live, set by neckline."),
      cta(5, "There's a small patterned square on your screen right now. Lift your phone, point the camera at that square, and hold it steady for a second or two."),
      cta(6, "Whenever you get to it is fine."),
      host(7, "Bye."),
    ];
    const out = markCtaQrBlock(scenes, { qrImageUrl: "q.png", bookTitle: "300 Budget-Friendly Ways to Look Expensive", bookCoverImageUrl: "c.png" } as any, true);
    expect(order(out)).toBe("HBHQQ");
    expect(out.find(s => s.qrHero)?.scriptText).toMatch(/^There's a small patterned square on your screen/);
  });
});

describe("the big QR waits for the scan line and never starts on the pitch before it (jobs 391 and 399)", () => {
  const cta = (index: number, scriptText: string) =>
    ({ index, scriptText, hostPresent: true, cta: true, ctaIndex: 0, showSubject: "x" }) as StoryboardScene;
  const order = (out: StoryboardScene[]) =>
    out.filter(s => s.cta).map(s => (s.qrHero ? "Q" : s.coverHero ? "B" : "H")).join("");

  it("job 391: a scan line cut over two beats is all under the card, 'point the camera at that square' included", () => {
    const scenes = [
      host(1, "Hello.", { hostOpener: true }),
      cta(2, "These length rules aren't mine originally. They come out of the way jewelers and dressmakers have always matched a piece to a neckline,"),
      cta(3, "and I gathered the ones that still hold up into a book of my own."),
      cta(4, "It's called Three Hundred Budget-Friendly Ways to Look Expensive, and it's a digital download."),
      cta(5, "The chapter called The Jewelry Rules is where the necklace lengths live, set by neckline."),
      cta(6, "There's a small patterned square on your screen right now. Lift your phone,"),
      cta(7, "point the camera at that square, and hold it steady for a second or two."),
      cta(8, "A little bar slides up along the top of your screen."),
      cta(9, "Touch that bar and the book opens. If the phone feels like a nuisance, the very first line in the description under this video goes to the same place."),
      cta(10, "Whenever you get to it is fine."),
      host(11, "Bye."),
    ];
    const out = markCtaQrBlock(scenes, { qrImageUrl: "q.png", bookTitle: "300 Budget-Friendly Ways to Look Expensive", bookCoverImageUrl: "c.png" } as any, true);
    expect(order(out)).toBe("HHBHQQQQQ");
    expect(out.find(s => s.qrHero)?.scriptText).toMatch(/^There's a small patterned square/);
  });

  it("a pitch about the book's description or download stays the host's; the card starts on the scan line", () => {
    // Job 399's block with two pitch lines a script could as easily have written: "a full
    // description of every" lesson and "easy to download it to any phone" are the book, not the way
    // to it.
    const scenes = [
      host(1, "So wait until everyone's been served, then catch a flight attendant as they pass.", { hostOpener: true }),
      cta(2, "Two asks in, you might wonder how anyone keeps this straight. I gathered it into one digital book."),
      cta(3, "It's called A Hundred Air Hostess Secrets, a four hundred eighty-five page PDF, and every secret gives you the exact words,"),
      cta(4, "who to say them to, and the moment in the trip when they work. Inside you'll find a full description of every request, and it's easy to download it to any phone. Hold your phone up to the screen with its camera on, and aim it at the little black and white code. A link appears, and you tap it."),
      cta(5, "Or look underneath this video, open the description, and tap the link at the top. None of that needs doing today."),
      host(6, "Bye."),
    ];
    const out = markCtaQrBlock(scenes, { qrImageUrl: "q.png", bookTitle: "100 Air Hostess Secrets", bookCoverImageUrl: "c.png" } as any, true);
    expect(order(out)).toBe("HBHQQ");
    expect(out.find(s => s.qrHero)?.scriptText).toMatch(/^Hold your phone up to the screen/);
    expect(out.find(s => /easy to download it to any phone\.$/.test(s.scriptText ?? ""))?.hostPresent).toBe(true);
  });
});

describe("the book cover lands on the line that says the title, never on one word of it (job 400)", () => {
  // "The Stoic Way" is two words, and half of two is one: "the Stoics after him" passed as naming
  // the book, so the cover played under the clause before the title and was gone when the host
  // said "a digital book called The Stoic Way".
  const cta = (index: number, scriptText: string) =>
    ({ index, scriptText, hostPresent: true, cta: true, ctaIndex: 0, showSubject: "x" }) as StoryboardScene;
  const block = () => [
    host(1, "Then he turns the whole thing over in a single motion: life is not short.", { hostOpener: true }),
    cta(2, "Some of you are already a page ahead of me, wondering where all of this lives in one place."),
    cta(3, "The thinking belongs to Seneca and the Stoics after him;"),
    cta(4, "my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more. Thirteen chapters, each lesson built the same way: the real struggle, the principle underneath it, a boxed exercise to run before the day ends, and an honest note on where the advice breaks down. Getting there is one small motion: lift your phone toward the pattern in the corner of the screen and tap what rises, or find the first line of the description below."),
    cta(5, "No timer on this — a lesson about hurry is a poor place to hurry you. Now, back to that door you have been holding open."),
    host(6, "Bye."),
  ];
  const params = { qrImageUrl: "q.png", bookTitle: "The Stoic Way", bookCoverImageUrl: "c.png" } as any;

  it("the scan-window pass puts the cover on 'called The Stoic Way' and keeps 'the Stoics after him' on the host", () => {
    const out = markCtaQrBlock(block(), params, true);
    expect(out.find(s => s.coverHero)?.scriptText).toMatch(/^my work was gathering it into a digital book called The Stoic Way/);
    expect(out.find(s => /Stoics after him;$/.test(s.scriptText ?? ""))?.coverHero).toBeFalsy();
    const order = out.filter(s => s.cta).map(s => (s.qrHero ? "Q" : s.coverHero ? "B" : "H")).join("");
    expect(order).toBe("HHBHQQ");
  });

  it("the cover reveal does the same on a run that has no scan window yet", async () => {
    const { markCoverReveal } = await import("./longformVideo");
    const out = markCoverReveal(block(), params);
    expect(out.filter(s => s.coverHero).map(s => s.index)).toEqual([4]);
  });

  it("a two-word title said in full still gets the cover (Norbert's 'The Locksmith Way')", async () => {
    const { markCoverReveal } = await import("./longformVideo");
    const scenes = [
      cta(1, "A heavy strike with long screws is everyday locksmith work,"),
      cta(2, "and I collected a hundred and one fixes like it into a digital book called The Locksmith Way."),
    ];
    const out = markCoverReveal(scenes, { bookTitle: "The Locksmith Way", bookCoverImageUrl: "c.png" } as any);
    expect(out.filter(s => s.coverHero).map(s => s.index)).toEqual([2]);
  });
});

describe("after the book cover the host comes back on a sentence (job 399)", () => {
  // Helena's 3-min test at 2:50: the cover ended on the storyboard's word count, "…every secret
  // gives you the exact words,", and the host came back mid-list: "who to say them to, and the
  // moment in the trip when they work." The cover now says the rest of that sentence.
  const at = (index: number, from: number, to: number, scriptText: string, over: Partial<StoryboardScene>) =>
    ({
      index,
      scriptText,
      showSubject: "x",
      narrationStartSec: from,
      narrationEndSec: to,
      audioDuration: to - from,
      audioUrl: `https://example.com/${index}.mp3`,
      cta: true,
      ctaIndex: 0,
      ...over,
    }) as StoryboardScene;
  const pitch = { hostPresent: true, qrCorner: true, hostProtected: true };
  const cover = { coverHero: true, stillImage: true };
  const card = { qrHero: true, qrTail: true, stillImage: true };
  const block = (coverAt: [number, number, string], hostAt: [number, number, string]) => [
    at(1, coverAt[0] - 6, coverAt[0], "Some of you are wondering where all of this lives in one place.", pitch),
    at(2, ...coverAt, cover),
    at(3, ...hostAt, pitch),
    at(4, hostAt[1], hostAt[1] + 8, "Hold your phone up to the screen. A link appears, and you tap it.", card),
  ];
  const params = { faceImageUrl: "https://example.com/host.jpg" } as any;
  const order = (scenes: StoryboardScene[]) =>
    scenes.map(s => (s.qrHero ? "Q" : s.coverHero ? "B" : "H")).join("");

  it("job 399: the cover runs on to 'when they work.' and the host comes back on 'Chapter four'", async () => {
    const { enforcePlanRules } = await import("./planGate");
    const scenes = block(
      [
        162.649,
        170.752,
        "It's called A Hundred Air Hostess Secrets, a four hundred eighty-five page PDF, and every secret gives you the exact words,",
      ],
      [
        170.752,
        181.8,
        "who to say them to, and the moment in the trip when they work. Chapter four covers in-flight requests, so when the right sentence won't come to you at the galley, it's already in your pocket.",
      ]
    );
    // The host take as the job's own transcript heard it, and the pause between "work." and "Chapter".
    const words = (
      "who@170.86-171.02 to@171.04-171.14 say@171.16-171.32 them@171.36-171.48 to,@171.54-171.78 " +
      "and@172.12-172.20 the@172.24-172.32 moment@172.40-172.68 in@172.74-172.80 the@172.82-172.90 " +
      "trip@172.96-173.20 when@173.26-173.38 they@173.40-173.54 work.@173.58-173.84 " +
      "Chapter@174.48-174.82 4@175.10-175.18 covers@175.26-175.58 in-flight@175.76-176.18 " +
      "requests,@176.24-176.76 so@177.20-177.44 when@177.70-177.84 the@177.86-177.94 right@178.00-178.18 " +
      "sentence@178.24-178.54 won't@178.58-178.76 come@178.82-178.98 to@179.02-179.08 you@179.12-179.20 " +
      "at@179.26-179.32 the@179.36-179.44 galley,@179.48-179.88 it's@180.12-180.28 already@180.42-180.78 " +
      "in@180.84-180.90 your@180.94-181.08 pocket.@181.10-181.48"
    )
      .split(" ")
      .map(tok => {
        const [, word, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
        return { word, start: Number(start), end: Number(end) };
      });
    const r = enforcePlanRules(scenes, params, { words, silences: [{ start: 173.85, end: 174.47 }] });
    const b = r.scenes.find(s => s.coverHero)!;
    const h = r.scenes[r.scenes.indexOf(b) + 1];
    expect(b.scriptText).toMatch(/gives you the exact words, who to say them to, and the moment in the trip when they work\.$/);
    expect(h.scriptText).toMatch(/^Chapter four covers in-flight requests,/);
    expect(h.hostPresent).toBe(true);
    expect(b.narrationEndSec).toBeCloseTo(174.16, 5);
    expect(order(r.scenes)).toBe("HBHQ");
  });

  it("jobs 397 and 398: a cover that ends its own sentence keeps its line", async () => {
    const { checkPlan, enforcePlanRules } = await import("./planGate");
    const films = [
      block(
        [103.8655, 109.497, "and I gathered it into a digital book called The Ultimate DIY Woodworking Guide."],
        [
          109.497,
          117.54,
          "It covers finishing and shop safety done right, and after every technique there's a breakdown of the common mistake that goes with it.",
        ]
      ),
      block(
        [
          95.9197,
          105.209,
          "The projects that actually sell are gathered in my digital book, A Hundred Ways to Make Your First Thousand Dollars with Woodworking.",
        ],
        [
          105.209,
          121.614,
          "That's a hundred of them, with what to make each one from and a fair price to ask, listed right beside it. So when a big fancy build starts calling your name, flip to one that sells and make that instead.",
        ]
      ),
    ];
    for (const scenes of films) {
      const end = scenes[1].narrationEndSec;
      expect(checkPlan(scenes, params).findings.filter(f => /after the book cover/.test(f.detail))).toEqual([]);
      const r = enforcePlanRules(scenes, params);
      expect(r.scenes.find(s => s.coverHero)?.narrationEndSec).toBe(end);
    }
  });
});

describe("a host take stops mid-sentence only at a natural break (job 400)", () => {
  // Gideon's 3-min test at 1:31: the host stopped between subject and verb — "…I want to show you
  // that the arithmetic | was never your problem." — and a scroll played under the rest. The first
  // half of a picture split for length had been made a check-in, and two word-cut pieces passed as
  // a shot-list hand-off. The same film opened on "There is a man standing in the greeting card |
  // aisle of a pharmacy…". Scenes, words and pauses are the job's own.
  const at = (index: number, from: number, to: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
    ({
      index,
      scriptText,
      showSubject: "x",
      narrationStartSec: from,
      narrationEndSec: to,
      audioDuration: to - from,
      audioUrl: `https://example.com/${index}.mp3`,
      wordCut: true,
      stillImage: over.hostPresent ? undefined : true,
      ...over,
    }) as StoryboardScene;
  const heard = (line: string) =>
    line.split(" ").map(tok => {
      const [, word, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
      return { word, start: Number(start), end: Number(end) };
    });
  const params = { faceImageUrl: "https://example.com/host.jpg", hostName: "Gideon Grant" } as any;

  const minute = () => [
    at(18, 79.885, 83.2955, "and what the remaining years are actually for.", { listCut: true }),
    at(
      19,
      83.2955,
      91.169,
      "Today, with the help of a Roman who wrote the sharpest essay on time ever put to paper, I want to show you that the arithmetic",
      { hostPresent: true }
    ),
    at(
      20,
      91.169,
      100.63,
      "was never your problem. Your problem is theft, and by the end of this video you will be able to name all seven of the thieves."
    ),
    at(21, 100.63, 102.133, "Two thousand years ago,", { listCut: true }),
  ];
  const minuteWords = heard(
    "Today,@83.42-83.82 with@84.141-84.281 the@84.301-84.381 help@84.441-84.641 of@84.681-84.761 " +
      "a@84.821-84.861 Roman@84.921-85.341 who@85.402-85.522 wrote@85.582-85.762 the@85.802-85.922 " +
      "sharpest@86.042-86.542 essay@86.702-86.983 on@87.063-87.163 time@87.223-87.543 ever@87.803-87.983 " +
      "put@88.043-88.204 to@88.264-88.344 paper,@88.384-88.744 I@89.242-89.282 want@89.322-89.462 " +
      "to@89.502-89.562 show@89.622-89.842 you@89.882-90.042 that@90.122-90.242 the@90.282-90.382 " +
      "arithmetic@90.442-91.142 was@91.342-91.503 never@91.703-91.983 your@92.043-92.203 " +
      "problem.@92.243-92.703 Your@93.243-93.443 problem@93.503-93.963 is@94.243-94.343 " +
      "theft.@94.503-94.903 And@95.343-95.423 by@95.463-95.563 the@95.603-95.703 end@95.743-95.863 " +
      "of@95.883-95.944 this@95.984-96.124 video,@96.184-96.624 you@96.884-97.004 will@97.044-97.184 " +
      "be@97.224-97.304 able@97.364-97.544 to@97.584-97.664 name@97.724-97.964 all@98.284-98.464 " +
      "seven@98.604-98.944 of@98.984-99.044 the@99.104-99.204 thieves.@99.244-100.905"
  );
  const minutePauses = [
    { start: 88.68, end: 89.1286 },
    { start: 90.9832, end: 91.2883 },
    { start: 92.4921, end: 93.1914 },
    { start: 93.8825, end: 94.1527 },
  ];

  it("rule 7 names the take: two word-cut pieces at no break are not a hand-off", async () => {
    const { checkPlan } = await import("./planGate");
    const found = checkPlan(minute(), params).findings.filter(f => f.rule === 7);
    expect(found.map(f => [f.scene, f.detail])).toEqual([
      [19, expect.stringMatching(/^host take ends mid-sentence, at no natural break/)],
    ]);
  });

  it("with host minutes to spare the host finishes the sentence, cut in the pause after 'problem.'", async () => {
    const { enforcePlanRules } = await import("./planGate");
    const r = enforcePlanRules(minute(), params, { words: minuteWords, silences: minutePauses });
    const host = r.scenes.find(s => s.hostPresent)!;
    const pic = r.scenes[r.scenes.indexOf(host) + 1];
    expect(host.scriptText).toMatch(/I want to show you that the arithmetic was never your problem\.$/);
    expect(pic.scriptText).toMatch(/^Your problem is theft, and by the end of this video/);
    expect(host.narrationEndSec!).toBeGreaterThanOrEqual(92.703); // "problem." has ended
    expect(host.narrationEndSec!).toBeLessThanOrEqual(93.243); // "Your" has not begun
    expect(pic.narrationStartSec).toBe(host.narrationEndSec);
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
  });

  it("with the host minutes spent (the job's own state) the host hands over at 'put to paper,'", async () => {
    const { enforcePlanRules } = await import("./planGate");
    const r = enforcePlanRules(minute(), params, {
      words: minuteWords,
      silences: minutePauses,
      budgetSec: 91.169 - 83.2955,
    });
    const host = r.scenes.find(s => s.hostPresent)!;
    const pic = r.scenes[r.scenes.indexOf(host) + 1];
    expect(host.scriptText).toBe(
      "Today, with the help of a Roman who wrote the sharpest essay on time ever put to paper,"
    );
    expect(pic.scriptText).toMatch(/^I want to show you that the arithmetic was never your problem\. Your problem/);
    expect(host.narrationEndSec!).toBeGreaterThanOrEqual(88.744); // "paper," has ended
    expect(host.narrationEndSec!).toBeLessThanOrEqual(89.242); // "I" has not begun
    expect(pic.narrationStartSec).toBe(host.narrationEndSec);
    expect(host.wordCut && pic.wordCut).toBe(true);
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
  });

  it("the opening hands over after 'aisle of', right before 'a pharmacy' — never inside 'greeting card aisle'", async () => {
    const { checkPlan, enforcePlanRules } = await import("./planGate");
    const opening = () => [
      at(1, 0, 2.50044, "There is a man standing in the greeting card", {
        hostPresent: true,
        hostOpener: true,
        hostProtected: true,
      }),
      at(
        2,
        2.50044,
        12.88,
        "aisle of a pharmacy on a Tuesday morning, buying his third sympathy card since spring, and doing a kind of arithmetic nobody ever taught him."
      ),
      at(3, 12.88, 17.3236, "He is counting backward. He is sixty-four.", { hostPresent: true, hostProtected: true }),
    ];
    expect(checkPlan(opening(), params).findings.filter(f => f.rule === 7).map(f => f.scene)).toEqual([1]);
    const words = heard(
      "There@0.22-0.38 is@0.44-0.54 a@0.58-0.62 man@0.7-1.04 standing@1.18-1.601 in@1.621-1.681 " +
        "the@1.721-1.801 greeting@1.861-2.181 card@2.241-2.521 aisle@2.721-2.921 of@2.981-3.021 " +
        "a@3.041-3.061 pharmacy@3.221-3.862 on@4.022-4.102 a@4.142-4.162 Tuesday@4.242-4.682 " +
        "morning,@4.742-5.122 buying@5.643-5.983 his@6.063-6.203 third@6.343-6.643 " +
        "sympathy@6.743-7.163 card@7.223-7.564 since@7.604-7.824 spring@7.904-8.344 and@8.944-9.024 " +
        "doing@9.064-9.324 a@9.365-9.425 kind@9.485-9.705 of@9.745-9.805 arithmetic@9.885-10.605 " +
        "nobody@10.785-11.185 ever@11.285-11.486 taught@11.546-11.826 him.@11.886-12.046"
    );
    // The whole sentence would make a 12.9 s opening — past the hook's 8 s, which the shot list
    // makes hand over — and 2.5 s of host has nothing to give back.
    const r = enforcePlanRules(opening(), params, { words });
    const [host, pic] = r.scenes;
    expect(host.scriptText).toBe("There is a man standing in the greeting card aisle of");
    expect(pic.scriptText).toMatch(/^a pharmacy on a Tuesday morning,/);
    expect(host.narrationEndSec!).toBeGreaterThanOrEqual(3.021); // "of" has ended
    expect(host.narrationEndSec!).toBeLessThanOrEqual(3.041); // "a" has not begun
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
  });

  it("the hand-offs these films made at a break stay exactly as they were (jobs 398, 399, 400)", async () => {
    const { checkPlan, enforcePlanRules } = await import("./planGate");
    const pairs: [StoryboardScene, StoryboardScene][] = [
      [
        at(1, 0, 9.786905, "Out of 10 Japanese woodworking projects you can build from cheap box-store lumber, the one that paid me best for my time came out of", { hostPresent: true, hostOpener: true }),
        at(2, 9.786905, 14.8299, "a coffee can of burnt scraps I almost threw in the trash."),
      ],
      [
        at(1, 5.96425, 12.173, "By the time the beverage cart had come and gone, one of them was sitting in an empty row closer to the front, holding", { hostPresent: true }),
        at(2, 12.173, 13.8031, "the whole can of ginger ale,", { listCut: true }),
      ],
      [
        at(1, 39.9348, 47.253, "Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in", { hostPresent: true }),
        at(2, 47.253, 49.2444, "some ordinary place,", { listCut: true }),
      ],
      [
        at(1, 67.7626, 70.934, "My name is Gideon Grant, and this channel is for", { hostPresent: true, hostIntro: true }),
        at(2, 70.934, 76.935, "men and women in their fifties, sixties, and beyond — people carrying real questions about"),
      ],
    ];
    for (const pair of pairs) {
      expect(checkPlan(pair, params).findings.filter(f => f.rule === 7)).toEqual([]);
      const end = pair[0].narrationEndSec;
      const r = enforcePlanRules(pair, params);
      expect(r.scenes[0].narrationEndSec).toBe(end);
    }
  });
});

describe("a host take that finishes its sentence never leaves a blink before the next take (job 352)", () => {
  // Dale's opening: "You drive to the big box store for four boards of oak, and you spend twenty
  // minutes | digging through the rack. Half the boards are bowed. | A couple have a split…" (host |
  // picture | host). Finishing the sentence took "digging through the rack." and left "Half the
  // boards are bowed." for 1.8 s between the two takes: rule 7b gave it to the host, the takes stood
  // back to back, and a check-in at 9:30 went to a picture to pay for it. Ranges and pauses are the
  // job's own.
  const at = (index: number, from: number, to: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
    ({
      index,
      scriptText,
      showSubject: "x",
      narrationStartSec: from,
      narrationEndSec: to,
      audioDuration: to - from,
      audioUrl: `https://example.com/${index}.mp3`,
      wordCut: true,
      stillImage: over.hostPresent ? undefined : true,
      ...over,
    }) as StoryboardScene;
  const opening = () => [
    at(1, 0, 4.791905, "You drive to the big box store for four boards of oak, and you spend twenty minutes", {
      hostPresent: true,
      hostOpener: true,
      hostProtected: true,
      minHoldSec: 2,
    }),
    at(2, 4.791905, 7.95719, "digging through the rack. Half the boards are bowed.", { minHoldSec: 1.2 }),
    at(3, 7.95719, 10.7867, "A couple have a split running off the end.", { hostPresent: true, hostProtected: true, minHoldSec: 2 }),
    at(4, 10.7867, 15.3756, "The one straight board in the pile is too narrow for your tabletop.", { minHoldSec: 1.2 }),
  ];
  const silences = [
    { start: 5.86919, end: 6.36844 },
    { start: 7.80037, end: 7.99719 },
    { start: 10.2676, end: 10.8267 },
    { start: 14.8376, end: 15.4156 },
  ];
  const params = { faceImageUrl: "https://example.com/host.jpg", hostName: "Dale Oakfield" } as any;

  it("hands over at the take's own comma instead: the picture keeps both of its sentences", async () => {
    const { enforcePlanRules } = await import("./planGate");
    const r = enforcePlanRules(opening(), params, { silences });
    const [host, pic, next] = r.scenes;
    expect(host.hostPresent).toBe(true);
    expect(host.scriptText).toBe("You drive to the big box store for four boards of oak,");
    expect(pic.hostPresent).toBeFalsy();
    expect(pic.scriptText).toBe(
      "and you spend twenty minutes digging through the rack. Half the boards are bowed."
    );
    expect(pic.narrationStartSec).toBe(host.narrationEndSec);
    expect(next.hostPresent).toBe(true);
    expect([next.narrationStartSec, next.narrationEndSec]).toEqual([7.95719, 10.7867]);
    expect(r.fixes.some(f => /picture blink/.test(f))).toBe(false);
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
  });

  it("a picture after the take that runs on past the next take's floor is still taken, as before", async () => {
    const { enforcePlanRules } = await import("./planGate");
    // The same opening with a longer second sentence: what is left reads for 2 s and more.
    const scenes = opening();
    scenes[1] = at(2, 4.791905, 9.5, "digging through the rack. Half the boards are bowed and the rest are cupped.");
    scenes[2] = at(3, 9.5, 12.3, "A couple have a split running off the end.", { hostPresent: true, hostProtected: true });
    scenes[3] = at(4, 12.3, 16, "The one straight board in the pile is too narrow for your tabletop.");
    const r = enforcePlanRules(scenes, params, { silences: [{ start: 5.86919, end: 6.36844 }] });
    expect(r.scenes[0].scriptText).toMatch(/twenty minutes digging through the rack\.$/);
    expect(r.scenes[1].scriptText).toBe("Half the boards are bowed and the rest are cupped.");
    expect(r.scenes[1].hostPresent).toBeFalsy();
  });
});

describe("one topic past its limit is never the same picture twice (job 399 scenes 20-21)", () => {
  // The review of job 399: two shots planned with the identical description, unmarked, 11.7 s + 6.3 s
  // past the second quarter's 15 s — the second came back a tighter crop of the first (18 s of one bag).
  const BAG = "several closed small liquor bottles tucked inside an open carry-on bag on a seat";
  const at = (index: number, scriptText: string, audioDuration: number, showSubject = BAG) =>
    pic(index, scriptText, showSubject, { wordCut: true, audioDuration, keyThing: "small liquor bottle" });

  it("399-21: the repeat gets a view of its own; the first keeps its look", async () => {
    const { joinSameContext, OTHER_VIEWS } = await import("./shotList");
    const r = joinSameContext(
      [
        at(20, "so the little bottles tucked in your carry-on stay closed. That's in the federal aviation rules,", 11.6667),
        at(21, "section one twenty-one point five seventy-five, and it doesn't care how good your intentions were.", 6.332),
      ],
      s => s.audioDuration ?? 0,
      () => 15
    );
    expect(r.scenes.map(s => s.showSubject)).toEqual([BAG, `${BAG}${OTHER_VIEWS[0]}`]);
    expect(r.scenes[1].visualPrompt).toBe(`${BAG}${OTHER_VIEWS[0]}`);
  });

  it("within the limit the same words are still one picture, and different words are left alone", async () => {
    const { joinSameContext } = await import("./shotList");
    const fits = joinSameContext([at(20, "a", 11.6667), at(21, "b", 6.332)], s => s.audioDuration ?? 0, () => 18);
    expect(fits.scenes).toHaveLength(1);
    const apart = joinSameContext(
      [at(20, "a", 11.6667), at(21, "b", 6.332, "the pretzel basket sitting on the beverage cart in the cabin aisle")],
      s => s.audioDuration ?? 0,
      () => 15
    );
    expect(apart.changed).toBe(false);
  });
});

describe("a picture that already has a view, split in two, never says that view twice (job 341 scenes 3-4)", () => {
  // The plan gate split the cutting board's 12.2 s close-up after the join, and the second part was
  // given "a close-up" again — the same picture twice under "The place you tried to sell it…".
  const BOARD = "two-tone walnut and maple cutting board leaning against the garage wall, unsold";
  const LINE =
    "That happens to everybody who sells what they build, and it's fixable, because the board usually isn't the problem. The place you tried to sell it just wasn't built for that piece. Today I'm ranking";

  it("341-4: the second part is seen from further back, not a second close-up", async () => {
    const { splitPicture, OTHER_VIEWS } = await import("./shotList");
    const parts = splitPicture(pic(3, LINE, `${BOARD}${OTHER_VIEWS[0]}`, { wordCut: true }), 2);
    expect(parts.map(p => p.showSubject)).toEqual([`${BOARD}${OTHER_VIEWS[0]}`, `${BOARD}${OTHER_VIEWS[1]}`]);
  });

  it("a picture with no view still gets the close-up first, as before", async () => {
    const { splitPicture, OTHER_VIEWS } = await import("./shotList");
    const parts = splitPicture(pic(3, LINE, BOARD, { wordCut: true }), 2);
    expect(parts.map(p => p.showSubject)).toEqual([BOARD, `${BOARD}${OTHER_VIEWS[0]}`]);
  });
});

describe("a picture drawn from the one right before it is a new photo, not that one again (job 399 scenes 16-17)", () => {
  // "a small plastic cup barely filled with ginger ale on a tray table" came back as the picture just
  // shown — the same hands tipping the same can into the same cup — with only the background new, and
  // the same-thing check let it through as a new view.
  const LINE_16 =
    "airlines, the flight attendant pours your soda into a plastic cup packed with ice, fills it about halfway, and the rest of the can rolls off down the aisle on the cart.";
  const LINE_17 =
    "I figured that out much too late, after more flights than I care to count spent nursing a thimble of ginger ale. So when the cart reaches your row, speak up.";
  const pouring = () =>
    pic(16, LINE_16, "hands pouring soda into an ice-filled plastic cup at the cart", { keyThing: "plastic cup", humanPresent: true });
  const thimble = () =>
    pic(17, LINE_17, "a small plastic cup barely filled with ginger ale on a tray table", { keyThing: "plastic cup", humanPresent: true });

  it("399-17: told the picture right before lends only the cup's look — another camera, framing and pose", async () => {
    const { rightBeforeToRecompose } = await import("./pictureMemory");
    const board = [pouring(), thimble()];
    expect(rightBeforeToRecompose(board, board[1])).toBe(board[0]);
    const clause = memoryClause({
      ...board[1],
      memoryRefUrls: ["https://r2/still-src-16.png"],
      memoryView: "a close view of one part of it, filling most of the frame",
      memoryRightBefore: 0,
    });
    expect(clause).toMatch(/RIGHT BEFORE this one in the video: take ONLY/);
    expect(clause).toMatch(/take ONLY how the plastic cup looks from it/);
    expect(clause).toMatch(/never the same pose, the same hand positions or the same things at the same angles/);
  });

  it("399-17: a copy that survives its redraw is drawn from words with the cup's written look", async () => {
    const { sameThingMove } = await import("./pictureMemory");
    const { memoryToWords } = await import("./longformVideo");
    const copy = { same: true, copy: true };
    expect(sameThingMove(copy, undefined)).toBe("redraw");
    expect(sameThingMove(copy, "copy")).toBe("words");
    const LOOK = "clear hard plastic, filled with ice cubes, half-filled with soda, no markings";
    const words = memoryToWords({ ...thimble(), memoryRefUrls: ["https://r2/still-src-16.png"], memoryWordsLook: LOOK });
    expect(words).toMatchObject({ memoryRefUrls: undefined, keyThingLook: LOOK });
    expect(buildStillPrompt({ ...thimble(), ...words })).toContain(`HOW THE PLASTIC CUP LOOKS in every picture of this video: ${LOOK}`);
  });

  it("399-20/21 and a far memory are untouched: a continuation keeps its view, scene 22 its ordinary memory", async () => {
    const { rightBeforeToRecompose } = await import("./pictureMemory");
    const BAG = "several closed small liquor bottles tucked inside an open carry-on bag on a seat";
    const pair = [pic(20, "n", BAG, { keyThing: "small liquor bottle" }), pic(21, "n", `${BAG}, a close-up`, { keyThing: "small liquor bottle" })];
    expect(rightBeforeToRecompose(pair, pair[1])).toBeUndefined();
    const far = [
      pic(5, "and a second bag of pretzels", "a second pretzel bag held in a passenger's hand", { keyThing: "pretzel basket" }),
      pair[1],
      pic(22, "n", "the pretzel basket sitting on the beverage cart in the cabin aisle", { keyThing: "pretzel basket" }),
    ];
    expect(memorySourcesFor(far, far[2])).toEqual([far[0]]);
    expect(rightBeforeToRecompose(far, far[2])).toBeUndefined();
  });
});

describe("a picture drawn from the one right before it is told only to differ, never that it is about something else (job 397 scenes 28-29)", () => {
  // The rule picks the picture before by its WORDS, and different words are as often the same thing
  // described anew: the walnut and maple board close up on the bench, then leaning against the garage
  // wall. A new photo is right for both; "it is about something else" was a false claim, and "never
  // the same hands" beside the host photo asked for someone else's hands.
  it("397-29: a new photo of the same board, by its own words, with no false claim and no other hands", async () => {
    const { rightBeforeToRecompose } = await import("./pictureMemory");
    const { SAME_THING_SYSTEM } = await import("./overlayTextScan");
    const BOARD = "walnut and maple cutting board";
    const closeUp = pic(28, "n", "", {
      showSubject: undefined,
      visualPrompt:
        "Close-up of a striped cutting board—alternating dark walnut and pale maple—resting on the workshop bench, soft natural light catching the grain, with a few hand tools blurred at the edge.",
      keyThing: BOARD,
    });
    const wall = pic(29, "n", "the walnut and maple cutting board leaning against the garage wall", { keyThing: BOARD });
    expect(rightBeforeToRecompose([closeUp, wall], wall)).toBe(closeUp);
    const clause = memoryClause({ ...wall, memoryRefUrls: ["https://r2/still-src-28.png"], memoryRightBefore: 0 });
    expect(clause).toMatch(/RIGHT BEFORE this one in the video: take ONLY how the walnut and maple cutting board looks/);
    expect(clause).toMatch(/the same hand positions/);
    expect(clause).not.toMatch(/something else|same hands/);
    expect(SAME_THING_SYSTEM).toMatch(/the hands in the same positions/);
    expect(SAME_THING_SYSTEM).not.toMatch(/same hands/);
  });
});

describe("someone the story comes back to keeps one look (job 399 scenes 2, 5, 7)", () => {
  // The passenger the story follows ("she") was three different women in 13 s, and the man beside
  // her changed too: each picture was drawn from "a woman passenger" alone. The props-list call now
  // writes a PERSON line for anyone the story comes back to, and each picture of them carries it.
  const SHE = "a woman in her late sixties, short silver hair in a neat bob, a lilac cardigan over a white blouse, grey slacks";
  const HE = "a man in his late sixties, thinning grey hair, a navy quarter-zip sweater over a collared shirt, khaki trousers";
  const SHEET = [
    "aircraft cabin interior: narrow rows of blue upholstered seats, grey plastic overhead bins, dim carpeted aisle",
    "MAIN beverage cart: metal trolley with two tiers, rows of soda cans lined on top",
    `PERSON the woman passenger: ${SHE}`,
    `PERSON the other passenger: ${HE}`,
  ].join("\n");

  it("399-2/5/7: her look on both her pictures, his on his; a passenger who could be either gets none", async () => {
    const { parseRecurringPeople } = await import("./shotList");
    const { markHostBroll: mark } = await import("./hostLook");
    const { buildStillPrompt: still } = await import("./longformVideo");
    const people = parseRecurringPeople(SHEET, { hostName: "Helena Hart" });
    expect(people.map(p => p.name)).toEqual(["the woman passenger", "the other passenger"]);
    const scenes = [
      pic(2, "boarded the same flight, and sat in the same row.", "two passengers seated in the same cabin row", { humanPresent: true, otherPerson: "two airline passengers" }),
      pic(5, "a second bag of pretzels,", "a second pretzel bag held in a passenger's hand", { humanPresent: true, otherPerson: "a woman passenger" }),
      pic(7, "The other was still in row fourteen with a few inches of soda over ice.", "a passenger in row fourteen holding a cup with a little soda over ice", { humanPresent: true, otherPerson: "a male passenger" }),
      pic(14, "None of them is an upgrade,", "a flight attendant speaking politely to a seated passenger", { humanPresent: true, otherPerson: "a seated passenger" }),
    ];
    mark(scenes, { hostLook: "a slender woman in her late thirties in a navy blazer", recurringPeople: people }, "https://x/host.png");
    const [two, her, him, either] = scenes.map(s => still(s));
    expect(two).toContain(SHE);
    expect(two).toContain(HE);
    expect(her).toContain(SHE);
    expect(her).not.toContain(HE);
    expect(him).toContain(HE);
    expect(him).not.toContain(SHE);
    expect(either).not.toContain(SHE);
    expect(either).not.toContain(HE);
  });
});

describe("a recurring look goes only where the label can mean that person (job 399, the review)", () => {
  // The props call is now asked for names that say what each person is ("the woman passenger", "the
  // man passenger" — the script itself only says "one of them" and "the other"). A label that could
  // be either, says it is someone else, or is a crowd gets no one's look.
  const SHE = "a woman in her late sixties, short silver hair in a neat bob, a lilac cardigan over a white blouse, grey slacks";
  const HE = "a man in his late sixties, thinning grey hair, a navy quarter-zip sweater over a collared shirt, khaki trousers";

  it("399-5/7 find her and him by role and sex; 399-23's 'a passenger', a crowd and 'another passenger' find nobody", async () => {
    const { parseRecurringPeople } = await import("./shotList");
    const { matchRecurringPeople } = await import("./hostLook");
    const people = parseRecurringPeople(`PERSON the woman passenger: ${SHE}\nPERSON the man passenger: ${HE}`);
    expect(matchRecurringPeople("a woman passenger", 1, people).map(p => p.look)).toEqual([SHE]); // 399-5
    expect(matchRecurringPeople("a male passenger", 1, people).map(p => p.look)).toEqual([HE]); // 399-7
    expect(matchRecurringPeople("a passenger", 1, people)).toEqual([]); // 399-23, a line to "you"
    expect(matchRecurringPeople("several passengers", 3, people)).toEqual([]);
    expect(matchRecurringPeople("another passenger", 1, people.slice(0, 1))).toEqual([]);
  });
});

describe("a picture of two people asks for both, faces hidden (job 399 scenes 8 and 14, the review)", () => {
  // Both described "a flight attendant" with "a passenger", the planner named only the passenger,
  // and the prompt said "the only person … no face anywhere": the flight attendant was drawn by no
  // rule — in profile, face shown (scene 8), and as a different smiling woman (scene 14).
  const LOOK = "A slender woman in her late thirties with fair skin and dark hair pinned back, wearing a white blouse, navy blazer with gold pin, and striped scarf";
  const scenes = () => [
    host(9, "I'm Helena Hart, and I read the fine print so travelers like us can stop learning these things the hard way.", { hostIntro: true }),
    pic(8, "He figures she must know somebody on the crew. She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them.", "a flight attendant speaking quietly with a passenger in the aisle", {
      visualPrompt: "Bare weathered hands of a flight attendant and a passenger meeting in the narrow aisle between rows, speaking quietly, blue seats and grey carpet visible.",
      humanPresent: true,
      otherPerson: "a male passenger",
      stillImage: true,
    }),
    pic(14, "along with the exact words that get each one. None of them is an upgrade, and each of them starts with a single polite sentence.", "a flight attendant speaking politely to a seated passenger", {
      visualPrompt: "Bare hands from the forearms down, adjusting a beverage cup on the cart tray in the aircraft aisle galley during service.",
      humanPresent: true,
      otherPerson: "a seated passenger",
      stillImage: true,
    }),
  ];

  it("399-8/14: the flight attendant and the passenger are both in the clause, no one-person wording", () => {
    const s = scenes();
    markHostBroll(s, { hostLook: LOOK, hostName: "Helena Hart" }, "https://x/host.png");
    for (const [scene, passenger] of [[s[1], "a male passenger"], [s[2], "a seated passenger"]] as const) {
      const prompt = buildStillPrompt(scene);
      expect(prompt).toContain(`The people in this shot are a flight attendant and ${passenger} — two different, ordinary people`);
      expect(prompt).toMatch(/faces turned away or out of frame so no face is ever shown/);
      expect(prompt).not.toMatch(/The only person in this shot|Apart from that one person/);
      expect(prompt).not.toContain(ONE_OTHER_PERSON_SUFFIX);
      expect(scene.brollHostRef).toBeUndefined();
    }
  });

  it("on a channel whose host IS a flight attendant, she is the host from her look, the passenger someone else", () => {
    const s = scenes();
    markHostBroll(s, { hostLook: LOOK, hostName: "Helena Hart", hostTitle: "Flight Attendant" }, "https://x/host.png");
    const prompt = buildStillPrompt(s[1]);
    expect(s[1].hostAmongOthers?.who).toBe("a flight attendant");
    expect(s[1].brollHostRef).toBeUndefined();
    expect(prompt).toContain(`The flight attendant is the video's host — ${LOOK} —`);
    expect(prompt).toContain("The other person is a male passenger — NOT the video's host");
    expect(prompt).not.toMatch(/The only person in this shot/);
    // A picture of one passenger stays one passenger (399-7).
    const seven = pic(7, "The other was still in row fourteen with a few inches of soda over ice.", "a passenger in row fourteen holding a cup with a little soda over ice", {
      humanPresent: true,
      otherPerson: "a male passenger",
    });
    markHostBroll([seven], { hostLook: LOOK, hostTitle: "Flight Attendant" }, "https://x/host.png");
    expect(seven.hostAmongOthers).toBeUndefined();
    expect(buildStillPrompt(seven)).toContain(otherPersonClause("a male passenger"));
  });
});

describe("the bridge into a list is a group picture only when one photograph can hold it (job 400 scene 14, the review)", () => {
  // "…people carrying real questions about | money, grief, difficult people, and what the remaining
  // years are actually for." The bridge asked for all four "together, laid out side by side" and came
  // back as paper cut-outs on a kitchen table (a rain cloud, paper figures, an hourglass), and the
  // "money" picture after it was drawn from that pile.
  const gideon = () => [
    host(13, "My name is Gideon Grant, and this channel is for", { hostIntro: true }),
    pic(14, "men and women in their fifties, sixties, and beyond — people carrying real questions about", "older men and women reading at a kitchen table"),
    pic(15, "money, grief, difficult people, and what the remaining years are actually for.", "bills on a table"),
    host(19, "Today, with the help of a Roman who wrote the sharpest essay on time ever put to paper, I want to show you that the arithmetic"),
  ];
  const GIDEON_LIST = [{ sentence: 0, items: ["money", "grief", "difficult people", "what the remaining years are actually for"] }];

  it("400-14: no group picture — the bridge keeps its own picture for the line check, and each item is its own picture", () => {
    const r = applySpokenLists(gideon(), GIDEON_LIST, { hostName: "Gideon Grant" });
    expect(r.applied).toBe(1);
    expect(r.scenes.some(s => s.listSet)).toBe(false);
    const bridge = r.scenes.find(s => s.scriptText?.startsWith("men and women"))!;
    expect(bridge.showSubject).toBe("older men and women reading at a kitchen table");
    expect(bridge.showSubject).not.toMatch(/together|side by side/);
    expect(bridge.hostPresent).toBeFalsy();
    expect(r.scenes.filter(s => s.listCut).map(s => s.scriptText)).toEqual([
      "money,",
      "grief,",
      "difficult people,",
      "and what the remaining years are actually for.",
    ]);
    // "money" is no longer drawn as one item picked out of a pile of all four.
    const money = r.scenes.find(s => s.scriptText === "money,")!;
    expect(memoryViewFor(r.scenes, money) ?? "").not.toMatch(/this one item/);
    expect(r.apart).toEqual(['"men and women in their fifties,…": "grief" is an idea, a feeling, a time or a place']);
    // The final check re-applies the lists on the final lengths: the same cut, still no group picture.
    const again = applySpokenLists(r.scenes, GIDEON_LIST, { hostName: "Gideon Grant" });
    expect(again.scenes.map(s => s.scriptText)).toEqual(r.scenes.map(s => s.scriptText));
    expect(again.scenes.some(s => s.listSet)).toBe(false);
  });

  it("399-10: 'the airline, the flight, and what's left in the galley' gets no group picture either", () => {
    const scenes = [
      host(9, "I'm Helena Hart, and I read the fine print so travelers like us can stop learning these things the hard way.", { hostIntro: true }),
      pic(10, "Today you're getting fourteen things flight attendants will quietly hand over for free, depending on", "a beverage cart in the aisle"),
      pic(11, "the airline,", "a passenger jet parked at an airport gate", { listCut: true }),
      pic(12, "the flight,", "a passenger jet flying above white clouds", { listCut: true }),
      pic(13, "and what's left in the galley,", "small drawers in a galley counter", { listCut: true }),
      pic(14, "along with the exact words that get each one.", "a flight attendant speaking politely to a seated passenger"),
    ];
    const r = applySpokenLists(scenes, [{ sentence: 1, items: ["the airline", "the flight", "what's left"] }], { hostName: "Helena Hart" });
    expect(r.scenes.some(s => s.listSet)).toBe(false);
    expect(r.scenes.find(s => s.scriptText?.startsWith("Today you're getting"))?.showSubject).toBe("a beverage cart in the aisle");
    expect(r.apart.join(" ")).toMatch(/"what's left in the galley" is a question or a clause/);
  });

  it("a list of things still gets its group picture (Hank's job 398 words, Ruth's job 302 rule)", () => {
    const scenes = [
      host(3, "But the one I was proudest of finished dead last at about $14 an hour. I'm Hank Hardwood,", { hostIntro: true }),
      pic(4, "and this one's for anybody standing in a garage with", "an empty garage"),
      pic(5, "a saw,", "a hand saw", { listCut: true }),
      pic(6, "a drill,", "a cordless drill", { listCut: true }),
      pic(7, "and a stack of sandpaper,", "sandpaper sheets", { listCut: true }),
      pic(8, "wondering if that clean Japanese look is really worth anything on a market table.", "a kumiko panel on a market table"),
    ];
    const r = applySpokenLists(scenes, lists(scenes), { hostName: "Hank Hardwood" });
    const set = r.scenes.find(s => s.listSet);
    expect(set?.showSubject).toBe("a saw, a drill and a stack of sandpaper together in a garage");
    expect(r.apart).toEqual([]);
    const drill = r.scenes.find(s => s.scriptText === "a drill,")!;
    expect(memoryViewFor(r.scenes, drill)).toMatch(/this one item/);
  });
});

describe("job 400: the style bible keeps its world when it mentions books", async () => {
  const { bibleWithoutPrintedMatter, brollDepictsBook } = await import("./longformVideo");
  it("the home base and the Rome places stay in the bible, only the clause about books goes", () => {
    // The film's warning was "Style bible depicted printed matter — dropped": the whole world went,
    // and the Rome pictures came back as glossy costume-drama stills. This is its real bible, as
    // the server logged it on the rehearsal run (the job never stored it).
    const bible =
      "Home base: a quiet home office or study in a temperate climate during autumn or early winter, where a man in his sixties sits with books and notes about Stoic philosophy. " +
      "The video travels to: a pharmacy greeting card aisle on a Tuesday morning, a parking lot, a kitchen table at two in the morning, a Roman senator's study two thousand years ago (imagined through period objects and spaces), and a weekend or evening moment where a phone is held toward a screen corner. " +
      "Recurring materials: sympathy cards, birthday cards,";
    const r = bibleWithoutPrintedMatter(bible);
    expect(r.bible).toMatch(/^Home base: a quiet home office or study in a temperate climate during autumn or early winter\. /);
    expect(r.bible).toContain("a Roman senator's study two thousand years ago (imagined through period objects and spaces)");
    expect(r.bible).not.toMatch(/books|Stoic/);
    expect(brollDepictsBook(r.bible!)).toBe(false);
    expect(r.warning).toBe(
      "Style bible: printed matter left out, the rest kept " +
        "(where a man in his sixties sits with books and notes about Stoic philosophy)"
    );
    // A bible with no printed matter (job 399's flight cabin) is untouched and says nothing.
    const cabin =
      "Home base: the interior cabin of a commercial aircraft in flight. Time of year is unspecified; the flight crosses U.S. airspace mid-continent.";
    expect(bibleWithoutPrintedMatter(cabin)).toEqual({ bible: cabin });
  });
});

describe("job 400 scene 27: a split panel of a key thing looks like that thing's other pictures", async () => {
  const { attachMemory, panelNamedLook } = await import("./pictureMemory");
  const { withSplitMemory } = await import("./longformVideo");
  // The named-things step wrote this onto scenes 20, 28 and 34; it never reads a split's panel.
  const PAPYRUS =
    "papyrus scroll: a long strip of pale tan-beige reed paper with faint crisscross fibre texture, rolled into a cylinder about a forearm long, with ragged slightly darker edges and a thin brown cord tied around its middle; when partly unrolled, rows of small faded dark-brown script run in narrow columns, soft and unreadable";
  const scene = (o: Partial<StoryboardScene>) => ({ narration: "n", scriptText: "n", ...o }) as StoryboardScene;
  const board = () => [
    scene({
      index: 20,
      keyThing: "scroll",
      namedLook: PAPYRUS,
      pictureUrl: "https://r2.test/longform/400/still-src-20.png",
      showSubject: "an aged pale tan papyrus scroll rolled and tied with a thin brown cord, lying on a heavy carved dark wooden desk, a close-up of one detail of it filling the frame",
      visualPrompt: "an aged pale tan papyrus scroll rolled and tied with a thin brown cord, lying on a heavy carved dark wooden desk",
    }),
    scene({
      index: 27,
      hostPresent: true,
      keyThing: "scroll",
      visualPrompt: "the channel's host, seated in a chair talking directly to the camera",
      splitVisual: "An aged papyrus scroll laid flat on a wooden desk, the surface worn and darkened by age and use.",
    }),
    scene({
      index: 34,
      keyThing: "scroll",
      namedLook: PAPYRUS,
      showSubject: "an aged pale tan papyrus scroll unrolled open on a heavy carved dark desk, faded unreadable script in narrow columns, beside a round glass inkwell and dark feather quill",
      visualPrompt: "an aged pale tan papyrus scroll unrolled open on a heavy carved dark desk",
    }),
  ];

  it("the scroll panel is drawn from scene 20's picture, in the same papyrus look as 20 and 34", async () => {
    const b = board();
    attachMemory(b, [], [{ name: "scroll", look: "an aged papyrus scroll, rolled and tied with a thin cord, resting on a wooden desk" }]);
    const panel = await withSplitMemory(b[1], buildSplitRightScene(b[1]), 0);
    expect(panel.memoryRefUrls).toEqual(["https://r2.test/longform/400/still-src-20.png"]);
    const prompt = buildStillPrompt(panel, false, undefined, undefined, true);
    expect(prompt).toContain(`EXACT LOOK — ${PAPYRUS}.`);
    // Two dark rollers came from the panel's own words alone; the look now says one tied roll.
    expect(prompt).toContain("rolled into a cylinder");
  });

  it("a panel whose thing's pictures carry no look, or another thing's, gets none (job 397 scene 3)", () => {
    const b = board();
    for (const s of b) if (!s.hostPresent) s.namedLook = undefined;
    expect(panelNamedLook(b, b[1])).toBeUndefined();
    // The board's phone-screen pictures carry the app's look: never the board's own.
    const thing = "walnut and maple cutting board";
    const panel = scene({ index: 3, hostPresent: true, keyThing: thing, splitVisual: "Finished walnut and maple cutting boards leaning against the wall of a workshop garage." });
    const screen = scene({ index: 8, keyThing: thing, showSubject: "cutting board shown on a phone screen as an online listing", namedLook: "Etsy: phone screen with a white background, a thin top bar with a small soft orange logo shape" });
    expect(panelNamedLook([panel, screen], panel)).toBeUndefined();
  });
});

describe("job 400 scene 27: a typed panel is drawn from its own words, not the scroll it replaced", async () => {
  const { attachMemory } = await import("./pictureMemory");
  const { withSplitMemory } = await import("./longformVideo");
  const { ownTypedPanel } = await import("./shotList");
  const PAPYRUS =
    "papyrus scroll: a long strip of pale tan-beige reed paper with faint crisscross fibre texture, rolled into a cylinder about a forearm long, with ragged slightly darker edges and a thin brown cord tied around its middle";
  const things: KeyThing[] = [
    { name: "scroll", look: "an aged papyrus scroll, rolled and tied with a thin cord, resting on a wooden desk" },
    { name: "inkwell and quill", look: "a small round glass inkwell with a dark feather quill resting against it" },
  ];
  const scene = (o: Partial<StoryboardScene>) => ({ narration: "n", scriptText: "n", ...o }) as StoryboardScene;
  const board = () => [
    scene({
      index: 20,
      keyThing: "scroll",
      namedLook: PAPYRUS,
      pictureUrl: "https://r2.test/longform/400/still-src-20.png",
      showSubject: "an aged pale tan papyrus scroll rolled and tied with a thin brown cord, lying on a heavy carved dark wooden desk",
    }),
    scene({
      index: 27,
      hostPresent: true,
      keyThing: "scroll",
      visualPrompt: "the channel's host, seated in a chair talking directly to the camera",
      splitVisual: "An aged papyrus scroll laid flat on a wooden desk, the surface worn and darkened by age and use.",
    }),
    scene({ index: 34, keyThing: "scroll", namedLook: PAPYRUS, showSubject: "an aged pale tan papyrus scroll unrolled open on a heavy carved dark desk" }),
  ];
  const redraw = async (typed: string) => {
    const b = board();
    ownTypedPanel(b[1], typed, things);
    b[1].splitVisual = typed;
    attachMemory(b, [b[1]], things);
    return withSplitMemory(b[1], buildSplitRightScene(b[1]), 0);
  };

  it("typed as a cup of tea: no scroll picture, no papyrus look, nothing held to a scroll", async () => {
    const panel = await redraw("A steaming cup of tea on a plain desk, morning light.");
    expect(panel.keyThing).toBeUndefined();
    expect(panel.memoryRefUrls).toBeUndefined();
    expect(buildStillPrompt(panel, false, undefined, undefined, true)).not.toMatch(/papyrus|scroll/i);
  });

  it("typed words that still name the scroll keep its picture and its look", async () => {
    const panel = await redraw("The papyrus scroll rolled and tied with its cord on the desk, seen from above.");
    expect(panel.memoryRefUrls).toEqual(["https://r2.test/longform/400/still-src-20.png"]);
    expect(buildStillPrompt(panel, false, undefined, undefined, true)).toContain(`EXACT LOOK — ${PAPYRUS}.`);
  });
});

describe("a pearl strand on a dresser is a necklace, not the host (round 9's review, 2026-10-18)", () => {
  // "strand" alone counted as a person (it was meant for hair), so the necklace films drew the host
  // into pictures of a necklace set down, under lines about anything at all: job 392 scenes 26-28,
  // the beads of "oat, / a warm coral, / mother of pearl." each lying on a cloth, were host pictures.
  it("a strand of pearls or beads is never a person; a strand of hair still is", () => {
    for (const thing of [
      "a pearl strand on the dresser",
      "pearl strand necklace resting unused inside the open jewelry box", // job 223 scene 12
      "single strand pearl necklace with round ivory pearls laid on the dressing room table", // job 234 scene 7
      "chunky strand of large oat-toned matte beads on a soft cloth, close view", // job 392 scene 26
      "a loose strand of pearls caught in the bathroom drain",
      "a pearl strand caught in the drain",
    ])
      expect(SHOWS_PERSON.test(thing), thing).toBe(false);
    for (const hair of ["A few strands of gray hair caught in a round brush on the counter.", "stray gray strands catching the window light"])
      expect(SHOWS_PERSON.test(hair), hair).toBe(true);
  });

  it("the necklace picture under a line not about the neck keeps nobody in it", () => {
    const box = "pearl strand necklace resting unused inside the open jewelry box";
    const scenes = [
      pic(12, "The mistake with pearls is saving them.", box), // job 223 scene 12
      pic(26, "oat,", "chunky strand of large oat-toned matte beads on a soft cloth, close view"), // job 392 scene 26
      pic(12, "A single strand sitting right at the collarbone.", box), // job 325 scene 12's line
    ];
    expect(markHostBroll(scenes, { hostLook: "a woman with silver hair" }, "https://x/host.png")).toBe(1);
    for (const s of scenes.slice(0, 2)) {
      expect(s.humanPresent, s.showSubject).toBeFalsy();
      expect(s.brollHostLook, s.showSubject).toBeUndefined();
    }
    // Under a line about the collarbone the piece is still worn by the host (`wornAtTheNeck`).
    expect(scenes[2].brollHostLook).toBe("a woman with silver hair");
    expect(scenes[2].showSubject).toMatch(/worn at the host's own neck/);
  });
});

describe("the host's face is never drawn in a host picture (round 11's review, jobs 401, 406, 407)", () => {
  // The rule lived only in the prompt, and the same-host check passed a well-matched drawn face:
  // job 401 scene 20 drew the host reading at a desk face on for 10 s, job 406 scene 14 smiling into
  // the lens with a phone at the ear, job 407 scene 27 a full-body axe swing with the face in
  // three-quarter view — each right beside the real host take.
  const READER = "A man in his sixties with fair skin, short gray hair, wire-rimmed glasses, wearing a light gray sweater over a white collared shirt";
  const GARAGE = "A lean man in his late fifties with fair, weathered skin, graying hair under a woven straw cowboy hat, wearing a light blue denim button-up shirt";
  const HEWER = "A lean man in his sixties with fair, weathered skin, short gray hair, a gray beard, wearing a faded olive-green button-up shirt over a dark gray t-shirt";
  const reader = () =>
    pic(
      20,
      "Today, with the help of a Roman who wrote the sharpest essay on time ever put to paper, I want to show you that the arithmetic was never your problem.",
      "man seated at wooden desk in study reading by the window",
      { humanPresent: true, brollHostLook: READER, brollHostRef: "https://x/host.png" }
    );
  const phoneCall = () =>
    pic(14, "Pull up a stool. One piece of housekeeping first: license rules change town by town,", "the host on a phone call beside the garage workbench", {
      visualPrompt: "A telephone resting on a garage workbench beside hand tools, in a single-car garage workshop.",
    });
  const axeSwing = () =>
    pic(27, "Keep your boots clear of the swing, and stop when your arms tire.", "the host swinging a wide flat-headed broadaxe at a log in a clearing, boots planted well back from the swing", {
      visualPrompt:
        "Bare feet in work boots planted well back from a wide flat-headed broadaxe held at rest beside a felled poplar log in a clearing.",
    });

  it("the same-host check also answers whether the face shows — both eyes, never a profile — and fails open", async () => {
    const { parseSameHostVerdict, SAME_HOST_SYSTEM } = await import("./overlayTextScan");
    expect(SAME_HOST_SYSTEM).toMatch(/face: true when the RIGHT picture shows a person's FACE — the nose and both eyes/);
    expect(SAME_HOST_SYSTEM).toMatch(/profile with only one eye showing/);
    expect(SAME_HOST_SYSTEM).toContain('"face":true|false');
    expect(parseSameHostVerdict('{"same":true,"face":true,"what":"face on, reading at the desk"}')).toEqual({
      same: true,
      face: true,
      what: "face on, reading at the desk",
    });
    expect(parseSameHostVerdict('{"same":true,"face":true}').what).toBe("the face is shown");
    expect(parseSameHostVerdict('{"same":true,"face":false,"what":"seen from behind"}')).toEqual({ same: true, face: false, what: "" });
    // An answer from before the question, a "yes", a cut-off answer or none: no face.
    expect(parseSameHostVerdict('{"same":true}').face).toBe(false);
    expect(parseSameHostVerdict('{"same":true,"face":"yes"}').face).toBe(false);
    expect(parseSameHostVerdict('{"same":true,"face":true}', "max_tokens")).toEqual({ same: true, face: false, what: "" });
    expect(parseSameHostVerdict("nonsense")).toEqual({ same: true, face: false, what: "" });
  });

  it("a shown face is a miss outside a step on the host's own face, counted with the identity misses", async () => {
    const { hostPictureMove, HOST_IDENTITY_REDRAWS } = await import("./longformVideo");
    expect(HOST_IDENTITY_REDRAWS).toBe(2);
    expect(hostPictureMove({ same: true, face: false }, false, 0, false)).toEqual({ move: "keep" });
    expect(hostPictureMove({ same: true }, false, 0, false)).toEqual({ move: "keep" });
    // A concealer step on her own face shows the face by design.
    expect(hostPictureMove({ same: true, face: true }, true, 0, false)).toEqual({ move: "keep" });
    // Jobs 401 / 406 / 407: the host, face on — drawn again from behind or the side.
    expect(hostPictureMove({ same: true, face: true }, false, 0, false)).toEqual({ move: "redraw", why: "face", turnAway: true });
    expect(hostPictureMove({ same: true, face: true }, false, 1, false)).toEqual({ move: "redraw", why: "face", turnAway: true });
    // The third miss, of either kind, is drawn with nobody in it.
    expect(hostPictureMove({ same: true, face: true }, false, 2, false)).toEqual({ move: "nobody", why: "face", turnAway: true });
    expect(hostPictureMove({ same: false, face: false }, false, 2, false)).toEqual({ move: "nobody", why: "someone else", turnAway: false });
    // A stranger from behind is drawn again from the host photo; a stranger's face is turned away too.
    expect(hostPictureMove({ same: false, face: false }, false, 0, false)).toEqual({ move: "redraw", why: "someone else", turnAway: false });
    expect(hostPictureMove({ same: false, face: true }, false, 0, false)).toEqual({ move: "redraw", why: "someone else", turnAway: true });
    // No attempt left for a redraw: nobody in it, never a face or a stranger shipped.
    expect(hostPictureMove({ same: true, face: true }, false, 0, true)).toEqual({ move: "nobody", why: "face", turnAway: true });
    expect(hostPictureMove({ same: true, face: false }, false, 0, true)).toEqual({ move: "keep" });
  });

  it("a whole-body action or a call at the ear is a pose drawn face-on; a thing or a measure is not", async () => {
    const { turnAwayPose } = await import("./hostLook");
    for (const pose of [
      axeSwing().showSubject!, // job 407 scene 27
      axeSwing().visualPrompt, // its rewrite: "boots planted well back"
      phoneCall().showSubject!, // job 406 scene 14
      "the host holding the phone pressed to her ear by the kitchen window",
      "the host answering the phone at the counter",
      "the host splitting firewood with a maul on a chopping block",
      "the host climbing a ladder to the gutter",
      "the host walking down the garden path with a basket",
      "the host in a wide stance at the bench",
      "a full-body view of the host at the potting bench",
    ])
      expect(turnAwayPose(pose), pose).toBe(true);
    for (const not of [
      reader().showSubject!, // job 401 scene 20: a seated reader is no pose — the check catches the face
      phoneCall().visualPrompt, // a telephone resting on the bench
      "the host's hands holding a phone, a listing on the phone screen",
      "tomato plants spaced two feet apart along the bed",
      "six feet of rope coiled on the bench",
      "a porch swing on the veranda",
      "the swing of the gate",
      "hiking boots drying by the door",
      "the host leaning on a walking stick",
      "a cottage within walking distance of the market",
      "a walk-in closet with shelves",
      "climbing roses on a trellis",
      "a full-length mirror",
      "the host making a judgment call",
      "hands sawing a small square notch in a thin strip held in a bench vise",
    ])
      expect(turnAwayPose(not), not).toBe(false);
  });

  it("jobs 406 and 407: the phone call and the axe swing are drawn from behind or the side only", async () => {
    const { HOST_TURNED_AWAY_CLAUSE } = await import("./longformVideo");
    const call = phoneCall();
    const swing = axeSwing();
    expect(markHostBroll([call], { hostLook: GARAGE }, "https://x/host.png")).toBe(1);
    expect(markHostBroll([swing], { hostLook: HEWER }, "https://x/host.png")).toBe(1);
    for (const s of [call, swing]) {
      const prompt = buildStillPrompt(s);
      expect(prompt, s.showSubject).toContain(HOST_TURNED_AWAY_CLAUSE);
      expect(prompt, s.showSubject).not.toContain(HOST_FRAMING_CLAUSE);
      expect(prompt, s.showSubject).not.toContain(HOST_LIPS_CUT_CLAUSE);
    }
    expect(HOST_TURNED_AWAY_CLAUSE).toMatch(/seen from behind, or from the side and a little behind/);
    expect(HOST_TURNED_AWAY_CLAUSE).toMatch(/never in front/);
    expect(hostBrollClause(GARAGE, false, true)).toContain(HOST_TURNED_AWAY_CLAUSE);
    // The lips cut wins when both are asked for: a chin line is about the chin.
    expect(hostBrollClause(GARAGE, true, true)).toContain(HOST_LIPS_CUT_CLAUSE);
    expect(hostBrollClause(GARAGE, true, true)).not.toContain(HOST_TURNED_AWAY_CLAUSE);
  });

  it("job 401 scene 20: a seated reader keeps the two framings until a drawing shows the face, then turns away", async () => {
    const { HOST_TURNED_AWAY_CLAUSE, turnHostAway } = await import("./longformVideo");
    const { hostTurnedAway } = await import("./hostLook");
    const s = reader();
    const before = buildStillPrompt(s);
    expect(before).toContain(HOST_FRAMING_CLAUSE);
    expect(hostTurnedAway(s)).toBe(false);
    // The redraw swaps the framing in place — the same prompt a Regenerate writes from the mark.
    const turned = turnHostAway(before);
    expect(turned).toContain(HOST_TURNED_AWAY_CLAUSE);
    expect(turned).not.toContain(HOST_FRAMING_CLAUSE);
    expect(turnHostAway(turned)).toBe(turned);
    s.hostTurnedAway = true;
    expect(hostTurnedAway(s)).toBe(true);
    expect(buildStillPrompt(s)).toBe(turned);
    // Whatever a redraw added to the prompt stays.
    expect(turnHostAway(`${before} DRAW IT DIFFERENT.`)).toBe(`${turned} DRAW IT DIFFERENT.`);
  });

  it("the turn never touches a chin line's lips cut, a face step, someone else, or a prompt with no host in it", async () => {
    const { turnHostAway } = await import("./longformVideo");
    const { hostTurnedAway } = await import("./hostLook");
    // Job 244 scene 3: a chin line keeps its lips cut, even marked.
    const chin = pic(3, "That same necklace drags your chin and your jawline down with it.", "a gold chain worn at the host's own neck", {
      humanPresent: true,
      brollHostLook: "a woman with silver hair",
      brollHostRef: "https://x/host.png",
      hostTurnedAway: true,
    });
    expect(hostLipsCut(chin)).toBe(true);
    expect(hostTurnedAway(chin)).toBe(false);
    const lips = buildStillPrompt(chin);
    expect(lips).toContain(HOST_LIPS_CUT_CLAUSE);
    expect(turnHostAway(lips)).toBe(lips);
    expect(hostTurnedAway({ ...axeSwing(), brollHostLook: HEWER, hostFaceShown: true })).toBe(false);
    expect(hostTurnedAway({ ...axeSwing(), brollHostLook: HEWER, otherPerson: "a neighbour" })).toBe(false);
    expect(hostTurnedAway(axeSwing())).toBe(false); // no host look: no host picture
    // A content-policy rung draws no person, so there is nothing to turn.
    const aggressive = buildStillPrompt(reader(), true);
    expect(turnHostAway(aggressive)).toBe(aggressive);
  });

  it("the mark stays while the picture is the host's, and goes when it is not", () => {
    const s = { ...reader(), hostTurnedAway: true as const };
    markHostBroll([s], { hostLook: READER }, "https://x/host.png");
    expect(s.brollHostLook).toBe(READER);
    expect(s.hostTurnedAway).toBe(true);
    const thing = { ...pic(14, "license rules change town by town,", "a corded telephone mounted on the garage wall"), hostTurnedAway: true as const };
    markHostBroll([thing], { hostLook: GARAGE }, "https://x/host.png");
    expect(thing.brollHostLook).toBeUndefined();
    expect(thing.hostTurnedAway).toBeUndefined();
  });
});

describe("a pose turns the host away only when it is one: a screen, a ladder and a worn piece are not (round 11's review of the face check)", () => {
  // The turn-away words read on every host picture of the local films (345 jobs, 1,459 host pictures)
  // turned 21 of them; 14 were not poses at all — a phone used as a SCREEN, a stepladder's feet, a
  // pearl strand or a long chain the picture is about. Each would have been told to show the body
  // from behind: a hands-at-the-glass close-up drawn with the head in it, the necklace hidden.
  const LOOK = "A woman over sixty with fair skin, short silver hair, wearing a plain navy crewneck sweater";
  const hostPic = (index: number, scriptText: string, showSubject: string, visualPrompt: string) =>
    pic(index, scriptText, showSubject, {
      visualPrompt,
      humanPresent: true,
      brollHostLook: LOOK,
      brollHostRef: "https://x/host.png",
    });

  it("a phone in use as a screen is not a call; a person on it, or a phone at the ear, is", async () => {
    const { turnAwayPose } = await import("./hostLook");
    for (const screen of [
      // job 376 scene 36
      "hands typing on a phone beside a removed round white smoke alarm lying face down on a table",
      // job 306 scene 26
      "a finger tapping an ad picture of the cutting board on a web page on a phone",
      // job 306 scene 27
      "A finger switching off a toggle on a white shop settings screen on a phone with orange accents.",
      // job 349 scene 6
      "Bare hands holding a phone with a blue header bar. Screen displays a marketplace listing page with a photo of a warm walnut bookcase, grey text bars below. Hands already in frame, fingers visible on the phone.",
      // job 372 scene 8
      "Phone resting flat on a wooden workbench showing a buy-and-sell app screen, bare weathered hands visible at forearms only, fingers positioned on the phone as if scrolling or tapping.",
      "the photo of the quilt on the phone screen",
    ])
      expect(turnAwayPose(screen), screen).toBe(false);
    for (const call of [
      "the host on a phone call beside the garage workbench", // job 406 scene 14
      // job 352 scene 70
      "A phone held in bare weathered hands, pressed to the ear making a call. Rough lumber racks and stacked boards visible beside and behind.",
      "the host on the phone beside the workbench",
      "the host talking quietly on the phone by the kitchen window",
      "she is on the phone at the counter",
      "the handset tucked against her ear while she writes",
    ])
      expect(turnAwayPose(call), call).toBe(true);
  });

  it("a stepladder's feet are not a stance; a person's planted feet or boots are", async () => {
    const { turnAwayPose } = await import("./hostLook");
    for (const ladder of [
      // job 276 scene 17
      "Bare weathered hands gripping a round white plastic smoke alarm mounted on a pale ceiling, fingers positioned to unscrew or twist it free, stepladder visible below with its aluminum frame and black rubber feet planted on beige hallway carpet.",
      // job 367 scene 16
      "Bare hands in frame positioning an aluminum stepladder with three rungs beneath a hallway ceiling at night, feet planted on pale flooring.",
      "a camera tripod with spread legs on the lawn",
    ])
      expect(turnAwayPose(ladder), ladder).toBe(false);
    for (const stance of [
      "Bare feet in work boots planted well back from a wide flat-headed broadaxe held at rest beside a felled poplar log in a clearing.", // job 407 scene 27
      "the host at the bench, her feet planted shoulder-width apart",
      "the host with planted boots at the edge of the woodpile",
    ])
      expect(turnAwayPose(stance), stance).toBe(true);
  });

  it("a picture of a piece worn at the neck faces the camera, whatever the pose; any other host pose turns away", async () => {
    const { hostTurnedAway, mayTurnHostAway } = await import("./hostLook");
    // Job 362 scene 9: the pearls are what the picture is about, and they sit on the front.
    const pearls = hostPic(
      9,
      "It scatters it, and soft even light is the kindest thing you can put near mature skin.",
      "a woman in a plain navy crewneck sweater with a cream pearl strand at her collarbone, walking down a bright grocery aisle carrying a basket",
      "A person in a plain navy crewneck sweater wearing a cream pearl strand at the collarbone and flat brown loafers, walking past bright grocery store shelves with a basket."
    );
    // Job 378 scene 17: the long chain down the front of the body.
    const chain = hostPic(
      17,
      "Number three is the long chain, twenty-eight to thirty-two inches. A long unbroken vertical line makes a body look longer.",
      "full-length view of a woman with a long gold chain hanging past her chest in an unbroken vertical line",
      "Bare hands adjusting a long thin gold chain down the front of a neutral turtleneck sweater in a bright dressing room, the chain hanging in an unbroken vertical line past the chest."
    );
    for (const s of [pearls, chain]) {
      expect(mayTurnHostAway(s), s.showSubject).toBe(false);
      expect(hostTurnedAway(s), s.showSubject).toBe(false);
      // Not even after a drawing showed the face: the redraw keeps the front the piece sits on.
      expect(hostTurnedAway({ ...s, hostTurnedAway: true }), s.showSubject).toBe(false);
      const prompt = buildStillPrompt(s);
      expect(prompt, s.showSubject).toContain(HOST_FRAMING_CLAUSE);
    }
    // The same walk with no piece worn at the neck turns away (job 373 scene 17's coat in an aisle).
    const coat = hostPic(
      17,
      "and a good coat does the rest.",
      "a dark wool knee-length coat worn by someone walking down a softly lit grocery aisle past steel shelving and produce",
      "A dark wool knee-length coat moving down a softly lit grocery aisle past steel shelving with plain boxes and produce."
    );
    expect(mayTurnHostAway(coat)).toBe(true);
    expect(hostTurnedAway(coat)).toBe(true);
    // A phone used as a screen keeps the two framings (job 376 scene 36).
    const typing = hostPic(
      36,
      "Then you write the date down.",
      "hands typing on a phone beside a removed round white smoke alarm lying face down on a table",
      "Bare hands typing on a smartphone beside a round white smoke alarm lying face down on a table."
    );
    expect(hostTurnedAway(typing)).toBe(false);
    expect(buildStillPrompt(typing)).toContain(HOST_FRAMING_CLAUSE);
  });
});

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
  pictureLook,
  placeLook,
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
  contrastAcross,
  foldSnappedFlashes,
  foldUnseenBeats,
  joinShortSplits,
  otherPersonOf,
  parseContextGroups,
} from "./shotList";
import { assignSceneRanges, keepOwnWords } from "./narrationAlignment";
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
  TOOL_CONTACT_CLAUSE,
  TOOL_POSITION_CLAUSE,
  withAllowedText,
  planGlitchRerender,
  ctaPlacementJobWarnings,
} from "./longformVideo";
import {
  exactLookQuestion,
  namedLight,
  namedLightQuestion,
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
import { missingListCues, wordsSaidOver } from "../graphics/src/plan/planner";
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
    steps.forEach((s, k) => {
      expect(s.buildStage).toBe("making");
      expect(ownKeyThing(s)).toBe("incense holder"); // "oil it," too
      // The finished holder is further along, never a source. Round 14: steps are done to one block, so
      // each is drawn from the steps before it in its list (job 413 scenes 31-32) — the first from none.
      const from = memorySourcesFor(r.scenes, s);
      expect(from.some(x => x.buildStage === "done")).toBe(false);
      expect(from.length > 0).toBe(k > 0);
      expect(from.every(x => steps.indexOf(x) >= 0 && steps.indexOf(x) < k)).toBe(true);
      expect(requiredThingsFor(s)[0]).toMatch(/^incense holder — when it is what is being made: as it is at this stage of being made/);
    });
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
    // Round 14: steps are done to one thing — "read the label" is the label of the alarm just taken down,
    // so it is the alarm's picture, drawn from that step's alarm (job 413 scenes 31-32's gas can).
    expect(steps.map(ownKeyThing)).toEqual(["stepladder", "smoke alarm", "smoke alarm"]);
    expect(memorySourcesFor(r.scenes, steps[2]).map(x => x.scriptText)).toEqual(["take one alarm down,"]);
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
    // A cut that "reads younger" is a look on the face: since the operator's decision on the audit's
    // cause 9 (2026-10-18) it shows the host's own face — never framed for the chin, never from behind.
    expect(scenes[1].hostFaceShown).toBe(true);
    expect(scenes[1].showSubject).toBe("host brushing her shoulder-length silver hair");
    expect(buildStillPrompt(scenes[1])).not.toContain(HOST_FRAMING_CLAUSE);
    expect(buildStillPrompt(scenes[1])).toMatch(/the SAME person as in the reference photo/);
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

  it("job 262 scene 16, with CLIP_GLITCH_RERENDER=1: a clip that does move wrong renders once more from the same frame, then the still is that frame", () => {
    // Since 2026-10-18 the default is ONE render (the case at the end of this file); the switch
    // keeps the old second render exactly as it was.
    const kf = "https://r2/longform/262/broll-kf-16-0-a.png";
    const scene = pic(16, "Photoelectric sees the slow, smoldering fire substantially earlier.", ALARM, {
      selfMoving: true,
      pictureUrl: kf,
      clipUrls: ["https://r2/longform/262/clip-16-0-a.mp4"],
      submits: [{ provider: "sixtynine_labs", at: "2026-10-01T00:00:00.000Z", reason: "first" }],
    });
    expect(planGlitchRerender(scene, { rerender: true })).toEqual({ next: "rerender", keyframe: kf });
    expect(scene.nextSubmitReason).toBe("glitch");
    scene.nextSubmitReason = undefined; // the re-render's submit consumes it
    expect(planGlitchRerender(scene, { rerender: true })).toEqual({ next: "still", keyframe: kf });
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
    // The model left out the third place; the sentence shape holds it (job 401), so the list is three.
    const PLACES = ["a waiting room", "a church pew", "the kitchen table at two in the morning"];
    expect(r.lists).toEqual([{ sentence: 1, items: PLACES }]);
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
      ["the kitchen table at two in the morning when the house is too quiet.", true],
      ["And the math always presents itself as the problem.", false],
    ]);
    // The shape rules agree when the call fails.
    expect(spokenListsByShape([LINE])).toEqual([{ sentence: 0, items: PLACES }]);
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
      // The introduction's "…this channel is for | men and women in their fifties" was here too: a
      // preposition's bare object is no break since job 408 (the case at the end of this file).
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

  it("399-20/21 and a far memory: a continuation is the continuation rule's (jobs 401-405), scene 22 keeps its ordinary memory", async () => {
    const { rightBeforeToRecompose, continuedPicture } = await import("./pictureMemory");
    const BAG = "several closed small liquor bottles tucked inside an open carry-on bag on a seat";
    const pair = [pic(20, "n", BAG, { keyThing: "small liquor bottle" }), pic(21, "n", `${BAG}, a close-up`, { keyThing: "small liquor bottle" })];
    expect(rightBeforeToRecompose(pair, pair[1])).toBeUndefined();
    // Its view alone did not move the camera (the review of jobs 401-405), so it is a new photo of
    // scene 20 now too — by the continuation rule (see the cases at the end of this file).
    expect(continuedPicture(pair, pair[1])).toBe(pair[0]);
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

describe("a graphic that hides the picture leaves no blink of footage, and none fades out into a cut (round 11 graphics review, 2026-10-18)", () => {
  const heard = (s: string) =>
    s.split(" ").map(t => {
      const [text, range] = t.split("@");
      const [start, end] = range.split("-").map(Number);
      return { text, start, end };
    });
  const scene = (index: number, a: number, b: number, hostPresent = false) => ({ index, narrationStartSec: a, narrationEndSec: b, scriptText: "", hostPresent, cta: false, split: false, hostOpener: false });
  const frames = (f: number[]) => f.map(x => x / 30);

  // 404 versus-january-robin (1:23-1:28): the Versus card left 0.80 s of the robin before the next shot,
  // "And if you live…" starting a new sentence in that sliver; the film's QA reported the blink and the
  // film shipped. The planner now asks QA's own test and sends the card back.
  it("404: the planner refuses the Versus card that leaves 0.80 s of the shot, and says why", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    const words = heard(
      "so@80.80-81.00 the@81.14-81.24 robin@81.28-81.56 you@81.60-81.74 see@81.78-81.92 in@81.96-82.04 January@82.12-82.80 could@82.94-83.14 be@83.20-83.32 a@83.36-83.40 traveler@83.48-83.92 from@83.96-84.12 up@84.20-84.28 north@84.36-84.70 instead@84.98-85.38 of@85.40-85.46 the@85.50-85.58 one@85.68-85.78 that@85.80-85.92 raised@85.96-86.22 a@86.28-86.32 family@86.36-86.74 on@86.84-86.90 your@86.94-87.08 porch@87.14-87.42 light.@87.484-87.684 And@88.33-88.41 if@88.45-88.51 you@88.55-88.67 live@88.71-88.85 along@88.91-89.15"
    );
    const versus = {
      id: "versus-january-robin",
      template: "Versus",
      start: "so the robin you see in January",
      startPad: -0.15,
      end: "family on your porch light",
      endPad: 0.3,
      props: {
        kicker: "Your January robin",
        left: { at: "@a traveler from up north", say: "a traveler from up north", sub: "A traveler from up north", title: "Northern traveler" },
        right: { at: "@the one that raised a family", say: "the one that raised a family on your porch light", sub: "Raised a family here", title: "Your porch robin" },
        winner: "none",
      },
    };
    const out = await planGraphics({ words, cuts: frames([2411, 2664]), film: { scenes: [scene(14, 80.3578, 88.803), scene(15, 88.803, 97.8576)] }, ask: async () => JSON.stringify({ cues: [versus] }), ensureIcon: async () => true });
    expect(out.cues).toEqual([]);
    expect(out.rounds[0].problems[0].problem).toMatch(/^Versus hides the picture, and it leaves 0\.80 s of the shot alone .*"And if you live…" starts a new sentence first/);
  });

  // 407 boots-clear-quote (2:40-2:45): the Quote blurs the whole picture, but only cards and windows
  // were held to the cut and counted by QA — it ended 0.54 s before the cut to the host, the sharp
  // picture (a drawn face) blinked up, and QA said "Blinks: 0".
  it("407: the Quote over the blurred picture is held to the cut, and QA would have failed the shipped one", async () => {
    const { resolveCues } = await import("../graphics/src/cueResolve");
    const { resolveSets } = await import("../graphics/src/registry");
    const { judgeFilm } = await import("../graphics/src/plan/qa");
    const words = heard("year.@159.04-159.34 Keep@160.58-160.78 your@160.82-160.98 boots@161.02-161.30 clear@161.40-161.64 of@161.68-161.74 the@161.78-161.88 swing@161.96-162.42 and@162.90-163.00 stop@163.14-163.58 when@163.72-163.86 your@163.88-164.08 arms@164.24-164.48 tire.@164.58-164.94 The@165.88-166.00 logs@166.08-166.50");
    const quote = { id: "boots-clear-quote", template: "Quote", start: "Keep your boots clear of", startPad: -0.15, end: "when your arms tire", endPad: 0.3, props: { quote: { text: "Keep your boots clear of the swing, and stop when your arms tire.", words: true }, author: "Sam", emphasis: ["boots"] } };
    const [q] = resolveCues([quote], words, { cuts: frames([4814, 4973]), fps: 30, ...resolveSets() });
    expect([q.startFrame, q.endFrame]).toEqual([4814, 4973]);
    const d = new Array(5100).fill(0.5);
    d[4814] = d[4973] = 60;
    const shipped = { ...q, endFrame: 4957, end: 4957 / 30 };
    expect(judgeFilm({ fps: 30, cues: [shipped], filmDiffs: d, reelDiffs: d, rules: [], readability: [] }).failures).toContain("a blink of footage beside boots-clear-quote");
  });

  // 404 title-song-goes-quiet and seven-things: each ended 2 frames before its cut (10.33 for 10.40,
  // 42.57 for 42.63) because the snap onto the cut was measured from its own last word, not from where
  // its sentence finished; its darkening faded out over those frames — QA's "flicker before a cut".
  it("404: the opening title leaves on its cut with no fade", async () => {
    const { resolveCues } = await import("../graphics/src/cueResolve");
    const { resolveSets } = await import("../graphics/src/registry");
    const words = heard(
      "Florida.@4.62-5.12 The@5.82-5.92 song@5.98-6.30 at@6.36-6.44 first@6.50-6.76 light@6.84-7.08 goes@7.12-7.36 quiet,@7.46-7.88 the@8.34-8.44 grass@8.48-8.84 sits@8.88-9.12 empty@9.28-9.58 in@9.62-9.68 the@9.72-9.78 mornings,@9.84-10.24 and@10.66-10.78 nobody@10.90-11.28"
    );
    const title = { id: "title-song-goes-quiet", template: "TitleOverFootage", start: "The song at first light goes", startPad: -0.15, end: "at first light goes quiet", endPad: 0.3, props: { kicker: "Winter robins", phrase: { text: "The song at first light goes quiet", words: true }, emphasis: ["quiet"] } };
    const [t] = resolveCues([title], words, { cuts: frames([171, 312]), fps: 30, ...resolveSets() });
    expect([t.startFrame, t.endFrame, t.props.exit]).toEqual([171, 312, "cut"]);
  });
});

describe("the host name card: on the self-introduction, in Inter, in the graphics' look (round 11 review, 2026-10-18)", () => {
  // Each film's host takes at their real positions and lengths (seconds on screen); every other
  // scene a 3 s picture. Real script text where the introduction is found from it.
  const filmOf = (n: number, hosts: ({ at: number; sec: number } & Partial<StoryboardScene>)[]) => {
    const scenes: StoryboardScene[] = Array.from({ length: n }, (_, i) => ({ index: i + 1, scriptText: "" }) as StoryboardScene);
    const secs: number[] = Array.from({ length: n }, () => 3);
    for (const { at, sec, ...over } of hosts) {
      scenes[at] = { ...scenes[at], hostPresent: true, ...over } as StoryboardScene;
      secs[at] = sec;
    }
    return { scenes, secs };
  };

  // 406 (Gary): the 2.56 s cold open could not hold the card, so it drew none, and "…I'm Gary," at
  // 28.5 s closed a 10.4 s take with no name on screen. The whole film had no card.
  it("406: the card goes on the take that ends '…I'm Gary,'", async () => {
    const { markHostIntroductions, nameCardSceneIndices } = await import("./longformVideo");
    const { scenes, secs } = filmOf(34, [
      { at: 0, sec: 2.56, hostOpener: true, scriptText: "Somewhere along the line, everybody agreed" },
      {
        at: 7,
        sec: 10.44,
        scriptText:
          "Tonight we’re taking it apart: seventeen real businesses that start for under five hundred dollars, most of them with gear you already own. I’m Gary,",
      },
      { at: 15, sec: 7.56, splitRightUrl: "https://r2.example/406-16.jpg" },
    ]);
    markHostIntroductions(scenes, "Gary", true);
    expect(scenes[7].hostIntro).toBe(true);
    expect(nameCardSceneIndices(scenes, secs)).toEqual([7]);
  });

  // 401 (Gideon Grant): the card showed on the opening line, more than a minute before "My name is
  // Gideon Grant…", and the introduction itself had none.
  it("401: the card goes on 'My name is Gideon Grant…', not the opening line", async () => {
    const { markHostIntroductions, nameCardSceneIndices } = await import("./longformVideo");
    const { scenes, secs } = filmOf(37, [
      { at: 0, sec: 3.03, hostOpener: true, scriptText: "There is a man standing in the greeting card aisle of" },
      { at: 13, sec: 6.51, scriptText: "My name is Gideon Grant, and this channel is for men and women in their fifties, sixties, and beyond —" },
    ]);
    markHostIntroductions(scenes, "Gideon Grant", true);
    expect(nameCardSceneIndices(scenes, secs)).toEqual([13]);
  });

  // 403 (Werner): the same short cold open (2.33 s) — and "I am Werner Finkbeiner." opens a 4.8 s take.
  it("403: the card goes on 'I am Werner Finkbeiner.'", async () => {
    const { markHostIntroductions, nameCardSceneIndices } = await import("./longformVideo");
    const { scenes, secs } = filmOf(27, [
      { at: 0, sec: 2.33, hostOpener: true, scriptText: "Look at the floor beside your toilet." },
      { at: 8, sec: 4.82, scriptText: "I am Werner Finkbeiner. This channel is for people in older houses and apartments" },
    ]);
    markHostIntroductions(scenes, "Werner Finkbeiner", true);
    expect(nameCardSceneIndices(scenes, secs)).toEqual([8]);
  });

  // 405 ("Luca Marino / Cat Trainer") and 407 ("Sawdust Sam"): the card was a Times-style serif in a
  // grey box, the only serif in the film — librsvg on the Windows machine never found Inter.
  it("405, 407: the card is drawn in Inter, with the role as the graphics' accent kicker", async () => {
    const { renderNameCardPng } = await import("./nameCard");
    const { interFontReady } = await import("./fontConfig");
    const png = await renderNameCardPng({ name: "Luca Marino", title: "Cat Trainer", accent: "#E8A13A", width: 1920, height: 1080 });
    expect(png).not.toBeNull();
    expect(await interFontReady()).toBe(true);
  });
});

describe("the host name card is judged on the take's real length (round 11 review, 2026-10-18)", () => {
  // Assembly handed the card's placement `audioDurationSec`, which `sceneHoldPlan` leaves unset on
  // every scene — so every take read as long enough to hold the card, and a take that could not show
  // it still took it. Scarlett's job 387: "I'm Scarlett Sterling, and this channel is for" is 2.98 s
  // on screen, too short for the card with its fixed 0.5 s wait and fades, which then went to the
  // 7.1 s cold open. Since round 13 a short take's edges shrink and the 1.5 s hold stays, so the
  // introduction holds the card itself (the round-13 cases at the end of this file).
  const scarlett = (introEnd: number) => {
    const rows: [number, number, Partial<StoryboardScene>][] = [
      [0, 7.14569, { hostPresent: true, hostOpener: true }],
      [7.14569, 11.3309, {}],
      [11.3309, 16.597, { hostPresent: true, splitRightUrl: "https://r2.example/387-3.jpg" }],
      [16.597, 27.1868, {}],
      [27.1868, introEnd, { hostPresent: true, hostIntro: true }],
      [introEnd, 35.54, {}],
    ];
    return {
      scenes: rows.map(([, , f]) => f as StoryboardScene),
      // As assembly builds its entries: the slice set, `audioDurationSec` unset.
      entries: rows.map(([a, b]) => ({ sliceStartSec: a, sliceEndSec: b, audioDurationSec: undefined })),
    };
  };

  it("387: the 2.98 s introduction holds the card, judged on its real on-screen length", async () => {
    const { assembledSceneSecs, nameCardSceneIndices } = await import("./longformVideo");
    const { scenes, entries } = scarlett(30.216);
    expect(nameCardSceneIndices(scenes, assembledSceneSecs(entries))).toEqual([4]);
  });

  it("387 with an introduction too short even for that (1.8 s): no card — the unset lengths would have put it there", async () => {
    const { assembledSceneSecs, nameCardSceneIndices } = await import("./longformVideo");
    const { scenes, entries } = scarlett(28.9868);
    // Never the cold open 20 s before the name, and no full-frame host take follows it.
    expect(nameCardSceneIndices(scenes, assembledSceneSecs(entries))).toEqual([]);
    expect(nameCardSceneIndices(scenes, entries.map(e => e.audioDurationSec))).toEqual([4]);
  });
});

describe("a chapter label over the host sits clear of the face (round 11 review, 2026-10-18)", () => {
  // 407 chapter-walls ("Number two squared the walls with a broadaxe.", 115.33-118.33 s over host
  // scene 21, full frame): the label was drawn where it sits over b-roll, a band from y 660 to 925,
  // and its top edge cut across the centred host's lower beard (it ends at ~690 px) for 3 s.
  const R2 = "https://pub-x.r2.dev/longform/407";
  const sam = [
    { index: 20, narrationStartSec: 98.7739, narrationEndSec: 115.328, clipUrls: [`${R2}/still-20-0.mp4`] },
    { index: 21, narrationStartSec: 115.328, narrationEndSec: 119.416, hostPresent: true, clipUrls: [`${R2}/clip-21-0.mp4`] },
    { index: 22, narrationStartSec: 119.416, narrationEndSec: 127.451, clipUrls: [`${R2}/still-22-0.mp4`] },
  ] as unknown as StoryboardScene[];

  it("407 chapter-walls: drawn low over the host take, its plate starting 100 px below the beard", async () => {
    const { filmLayoutOf } = await import("./graphics/apply");
    const { placementFor } = await import("../graphics/src/plan/rules");
    const { chapterBox } = await import("../graphics/src/overlays");
    const placed = placementFor("ChapterLabel", { start: 115.333, end: 118.333 }, filmLayoutOf(sam, []));
    expect(placed).toEqual({ low: true });
    expect(chapterBox({}).top).toBeLessThan(690);
    expect(chapterBox(placed).top).toBeGreaterThanOrEqual(790);
  });

  // 407 chapter-roof (67.87-72.37 s) is over b-roll: it keeps the designed place (what it covered
  // there is the picture's subject — a separate matter, not the host).
  it("407 chapter-roof over b-roll keeps the designed place", async () => {
    const { placementFor } = await import("../graphics/src/plan/rules");
    const layout = { scenes: [{ index: 14, narrationStartSec: 67.8766, narrationEndSec: 78.065 }], nameCardScenes: [] };
    expect(placementFor("ChapterLabel", { start: 67.867, end: 72.367 }, layout)).toEqual({});
  });
});

describe("two values get 'vs' only when they are compared (round 11 review, 2026-10-18)", () => {
  /** Words as the transcriber timed them: "text@start-end …". */
  const heard = (s: string) =>
    s.split(" ").map(t => {
      const [text, range] = t.split("@");
      const [start, end] = range.split("-").map(Number);
      return { text, start, end };
    });
  const drawnCompare = async (props: Record<string, unknown>, start: string, end: string, words: { text: string; start: number; end: number }[]) => {
    const { resolveCues } = await import("../graphics/src/cueResolve");
    return resolveCues([{ id: "pair", template: "NumberLabel", start, startPad: -0.15, end, endPad: 0.3, props }], words)[0].props.compare;
  };

  // 406 sharpening-prices (1:22): "A KNIFE $5 to $10 vs A MOWER BLADE $10 to $20" for a price for
  // each of two services — "vs" made it a contest. Joined by "and": no "vs", even if the plan marks it.
  it("406: '$5 to $10 a knife and $10 to $20 a mower blade' is drawn without 'vs'", async () => {
    const words = heard(
      "You@82.138-82.278 charge@82.318-82.618 $5@82.718-82.978 to@83.138-83.318 $10@83.358-83.659 a@83.699-83.719 knife@83.779-84.059 and@84.239-84.359 $10@84.459-84.679 to@84.719-84.799 $20@84.859-85.179 a@85.239-85.279 mower@85.319-85.579 blade,@85.599-85.899 and@86.28-86.36"
    );
    const props = { kicker: "You charge", a: { label: "A knife", value: "$5 to $10", at: "@$5 to $10 a knife" }, b: { label: "A mower blade", value: "$10 to $20", at: "@$10 to $20 a mower" }, compare: true };
    expect(await drawnCompare(props, "You charge $5 to $10", "a mower blade,", words)).toBe(false);
  });

  // 397 furniture-price-range (1:04): "FROM $150 vs UP TO $600" for a range.
  it("397: 'And furniture, $150 to $600.' is drawn without 'vs'", async () => {
    const words = heard("And@64.628-64.788 furniture,@64.928-65.408 $150@65.849-66.229 to@66.449-66.989 $600.@67.41-68.23 Once@68.891-69.091");
    const props = { kicker: "Furniture", a: { label: "From", value: "$150", at: "@$150" }, b: { label: "Up to", value: "$600", at: "@$600." }, compare: true };
    expect(await drawnCompare(props, "And furniture, $150 to $600.", "$150 to $600.", words)).toBe(false);
  });

  // 401 age-vs-father (0:15): a real comparison keeps its "vs" when the plan marks it — and the "vs"
  // now enters with "81" instead of standing alone beside "HIS AGE 64" for 3.5 s.
  it("401: 'He is 64. His father made it to 81.' keeps 'vs' when marked compared", async () => {
    const words = heard("He@15.427-15.528 is@15.608-15.688 64.@15.868-16.528 His@17.428-17.569 father@17.649-18.049 made@18.289-18.489 it@18.529-18.589 to@18.629-19.049 81.@19.289-19.409");
    const props = { kicker: "Counting backward", a: { label: "His age", value: "64", at: "@sixty-four" }, b: { label: "His father", value: "81", at: "@eighty-one" }, compare: true };
    expect(await drawnCompare(props, "He is 64.", "made it to 81.", words)).toBe(true);
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

describe("'you' is the host's customer, not the host: one ordinary viewer with one look (round 11's review, jobs 402 and 405)", () => {
  // Job 402's host wears a crew blazer, scarf and wings pin; her viewer is a passenger. Every
  // picture of "you" was the host, so the crew sat in a passenger's seat taking the can for herself
  // (scenes 17 and 20). Job 405's "you" the cat walks across was "a sleeping person" — a different
  // stranger in every picture (scenes 3-8). The props call now names the viewer when the host's job
  // serves them (`viewerPerson`); a how-to's "you" stays the host.
  const CREW = "A slender woman in her forties with fair skin and brown hair pinned back, wearing a white blouse, navy blazer with gold pin, and striped scarf";
  const FLYER = "a woman in her seventies, short silver hair, a cream knit cardigan over a pale blue blouse, grey slacks";
  const passenger = { name: "the passenger", look: FLYER };

  it("job 402 scenes 17 and 20: the passenger in her own clothes, never the host's uniform", () => {
    const scenes = [
      pic(17, "On many of those carriers, you can have the whole thing just by asking.", "a full soda can held upright near a passenger's tray", {
        visualPrompt: "Bare hands holding a slim aluminum soda can upright, positioned near a passenger's lap tray in an aircraft seat. Aircraft cabin interior visible in background.",
        humanPresent: true,
      }),
      pic(20, "Juice works the same way. If they're running short, they'll tell you, and you're no worse off for trying. One more thing about drinks, because it catches good people off guard.", "plastic cup filled with juice-colored drink on a lap tray", {
        visualPrompt: "Clear plastic cup filled with juice-colored drink sitting on a passenger's lap tray in an aircraft seat. Aircraft cabin interior visible in background.",
        humanPresent: true,
      }),
    ];
    markHostBroll(scenes, { hostLook: CREW, hostName: "Helena Hart", viewerPerson: passenger }, "https://x/host.png");
    for (const s of scenes) {
      expect(s.brollHostRef, `scene ${s.index}`).toBeUndefined();
      const prompt = buildStillPrompt(s);
      expect(prompt, `scene ${s.index}`).toContain(FLYER);
      expect(prompt, `scene ${s.index}`).not.toMatch(/navy blazer|gold pin|striped scarf/);
    }
  });

  it("job 405 scenes 3-8: the sleeper the cat walks across is one person in every picture", () => {
    const owner = { name: "the cat owner", look: "a woman in her thirties, shoulder-length brown hair, a plain grey sleep shirt" };
    const sleeper = (index: number, scriptText: string, showSubject: string, over: Partial<StoryboardScene> = {}) =>
      pic(index, scriptText, showSubject, { humanPresent: true, otherPerson: "a sleeping person", ...over });
    const scenes = [
      host(1, "Three in the morning. The house is dark, the street outside has gone quiet, and somewhere in that quiet,"),
      pic(2, "a small set of paws has just landed on the foot of your bed. She doesn’t hurry. She walks the full length of you,", "a tabby cat with white-socked paws walking slowly across the bed sheets at night"),
      sleeper(3, "ankle,", "a small short-haired tabby cat stepping onto the ankle of a sleeping person under pale grey sheets at night", { listCut: true }),
      sleeper(5, "hip,", "a small tabby cat balancing on the hip of a person sleeping on their side under pale grey sheets at night", { listCut: true }),
      sleeper(6, "ribs,", "a tabby cat's white-socked paws stepping across the blanketed ribs of a sleeping person at night", { listCut: true }),
      sleeper(7, "steady as a tightrope walker, because she has made this crossing a hundred times before.", "a small tabby cat standing on a sleeping person's chest in the dark bedroom, head lowered close to their face, waiting"),
      sleeper(8, "Then she stops on your chest, lowers her face to yours, and waits.", "a small tabby cat standing on a sleeping person's chest in the dark bedroom, head lowered close to their face, waiting"),
    ];
    markHostBroll(scenes, { hostLook: "A man in his forties with olive skin, dark wavy hair and a full beard", hostName: "Luca Marino", viewerPerson: owner }, "https://x/host.png");
    const sleepers = scenes.filter(s => s.index >= 3);
    expect(sleepers.every(s => s.otherPerson === "the cat owner")).toBe(true);
    expect(new Set(sleepers.map(s => buildStillPrompt(s).includes(owner.look))).size).toBe(1);
    expect(buildStillPrompt(sleepers[0])).toContain(owner.look);
  });

  it("a how-to's 'you' is still the host (job 406 scene 20)", () => {
    const GARAGE = "A lean man in his late fifties with fair, weathered skin, graying hair under a woven straw cowboy hat, wearing a light blue denim button-up shirt";
    const s = pic(20, "You charge five to ten dollars a knife and ten to twenty a mower blade, and the work takes minutes once your hands learn it.", "the host sharpening a mower blade on a benchtop belt sharpening setup", {
      visualPrompt: "Bare weathered hands guiding a dull mower blade against a spinning abrasive belt on a benchtop belt sharpening setup bolted to a garage workbench.",
      humanPresent: true,
    });
    markHostBroll([s], { hostLook: GARAGE, hostName: "Gary" }, "https://x/host.png");
    expect(s.brollHostLook).toBe(GARAGE);
    expect(s.otherPerson).toBeUndefined();
  });

  it("with one passenger in the story, a shot named as the viewer is the viewer, not her (job 402)", () => {
    // The planner writes the viewer's name in every shot of "you". With the story's ONE recurring
    // passenger that name fitted her by role, and every picture of "you" was drawn as her.
    const storyWoman = { name: "the woman passenger", look: "a woman in her sixties, long grey hair in a low ponytail, a red wool coat, black trousers" };
    const story = pic(3, "the whole can of ginger ale,", "a woman passenger in an empty row holding a whole soda can upright", {
      humanPresent: true,
      otherPerson: "a woman passenger",
    });
    const ask = pic(17, "On many of those carriers, you can have the whole thing just by asking.", "a passenger holding a full soda can over the tray", {
      humanPresent: true,
      otherPerson: "the passenger",
    });
    markHostBroll([story, ask], { hostLook: CREW, hostName: "Helena Hart", recurringPeople: [storyWoman], viewerPerson: passenger }, "https://x/host.png");
    expect(buildStillPrompt(ask)).toContain(FLYER);
    expect(buildStillPrompt(ask)).not.toContain(storyWoman.look);
    expect(buildStillPrompt(story)).toContain(storyWoman.look);
    expect(buildStillPrompt(story)).not.toContain(FLYER);
  });
});

describe("'hand tools' are tools, not hands (round 11's review, job 406 scene 7)", () => {
  // "That one belief keeps more good tools hanging silent on more garage walls than rust ever has."
  // The shot list asked for "hand tools hanging silent on a pegboard wall in the garage"; "hand" read
  // as a person, so the host was drawn reaching up and gripping the hammer for 9.4 s — tools in use
  // under a line about tools nobody uses.
  const GARAGE = "A lean man in his late fifties with fair, weathered skin, graying hair under a woven straw cowboy hat, wearing a light blue denim button-up shirt";
  const line = "That one belief keeps more good tools hanging silent on more garage walls than rust ever has.";

  it("the planned picture of hand tools on a wall is drawn with nobody in it", () => {
    const { scenes } = applyShotPlan(
      [pic(7, line, "x")],
      [{ scene: 7, hostUntil: null, shots: [{ from: "That one belief", show: "hand tools hanging silent on a pegboard wall in the garage" }] }]
    );
    markHostBroll(scenes, { hostLook: GARAGE, hostName: "Gary" }, "https://x/host.png");
    const wall = scenes[0];
    expect(wall.humanPresent).toBeFalsy();
    expect(wall.brollHostLook).toBeUndefined();
    expect(wall.brollHostRef).toBeUndefined();
    const prompt = buildStillPrompt(wall);
    expect(prompt).toContain(NO_FIGURES_SUFFIX);
    expect(prompt).not.toContain(GARAGE);
  });

  it("a hand at work, or the host using hand tools, is still the host (job 406 scenes 9 and 20)", () => {
    const scenes = [
      pic(9, "This channel is about the work.", "the host working quietly at the garage workbench with simple hand tools", {
        visualPrompt: "Bare weathered hands from the forearms down working with a simple hand tool at a wooden garage workbench",
      }),
      pic(10, "Grab the hammer.", "a hand lifting the hammer off the pegboard wall"),
      pic(20, "the work takes minutes once your hands learn it.", "the host sharpening a mower blade on a benchtop belt sharpening setup", {
        visualPrompt: "Bare weathered hands guiding a dull mower blade against a spinning abrasive belt on a benchtop belt sharpening setup bolted to a garage workbench.",
      }),
    ];
    markHostBroll(scenes, { hostLook: GARAGE, hostName: "Gary" }, "https://x/host.png");
    for (const s of scenes) {
      expect(s.brollHostLook, s.showSubject).toBe(GARAGE);
      expect(s.humanPresent, s.showSubject).toBe(true);
    }
  });

  it("made by hand, second-hand and a clock's hands name no person; a hand in hand still does", () => {
    for (const thing of [
      "a hand-stitched quilt folded over the chair",
      "a second-hand drill press in the corner of the garage",
      "a basket woven by hand on the porch step",
      "a hand saw and a hand plane on the bench",
      "a tube of hand cream on the nightstand",
      "Round analog clock on a wooden nightstand, white face and black hands pointing near three o'clock, cream lamp beside it glowing softly.", // job 405 scene 28
    ])
      expect(SHOWS_PERSON.test(thing), thing).toBe(false);
    for (const hand of [
      "two figures walking hand in hand along a sunny park path", // job 401 scene 19
      "a hand reaching for the hammer on the pegboard",
    ])
      expect(SHOWS_PERSON.test(hand), hand).toBe(true);
  });

  it("a hand tool at work, or work being done by hand, keeps the host's hands on it", () => {
    // "hand" alone carried these before the fix, and nothing else in their words names a person: a
    // drill boring by itself, a quilt piecing itself.
    const scenes = [
      pic(36, "drill the hole for the incense stick", "a hand drill boring a hole into a small charred cedar block"), // job 189 scene 36
      pic(3, "a crib quilt pieced at the kitchen table", "nine-patch crib quilt being pieced by hand at the work table under lamp light"), // job 144 scene 3
      pic(7, line, "hand tools hanging silent on a pegboard wall in the garage"),
    ];
    markHostBroll(scenes, { hostLook: GARAGE, hostName: "Gary" }, "https://x/host.png");
    expect(scenes[0].brollHostLook).toBe(GARAGE);
    expect(scenes[1].brollHostLook).toBe(GARAGE);
    expect(scenes[2].brollHostLook).toBeUndefined();
    expect(buildStillPrompt(scenes[2])).toContain(NO_FIGURES_SUFFIX);
  });
});

describe("a splitting tool works in the end grain, and no hand is in an edge's path (jobs 406, 407)", () => {
  const SAWYER = "A broad man in his sixties with a short white beard, wearing a sage green work shirt with rolled sleeves";
  const SPLIT_RULE = /splitting tool is driven into its END grain/;

  it("every host-at-work picture of a froe asks for its edge in the end grain, along the split", () => {
    const scenes = [
      // Job 407 scene 14: the blade came back resting on top, across a split already open.
      pic(14, "Number one is the roof, split by hand from white oak or chestnut with a froe, and the direction of the split mattered most.",
        "hands holding a froe's upright wooden handle, its flat steel blade driven into the top of a short white oak log section along the grain", {
          visualPrompt:
            "Bare weathered hands gripping a froe's wooden handle, its flat steel blade pressed into the top of a white oak log bolt along the grain, inside a log cabin with the split-oak roof visible above.",
          humanPresent: true,
        }),
      // Job 407 scene 17: the blade out in mid-air, a board peeling away with no blade in its split.
      pic(17, "and rived the boards along those same lines,", "a froe splitting a wedge into a board on a tree stump", {
        visualPrompt:
          "A froe with its flat steel blade driven into a white oak wedge on a tree stump, a freshly split board starting to separate along the grain.",
        humanPresent: true,
      }),
    ];
    markHostBroll(scenes, { hostLook: SAWYER, hostName: "Sam" }, "https://x/host.png");
    for (const s of scenes) {
      const prompt = buildStillPrompt(s);
      expect(prompt, s.showSubject).toMatch(SPLIT_RULE);
      expect(prompt, s.showSubject).toMatch(/split opens along the line of the blade/);
      expect(prompt, s.showSubject).toMatch(/never pushed into the side of the piece/);
      expect(prompt, s.showSubject).toMatch(/sticking out into the air with no wood under its edge/);
      expect(prompt, s.showSubject).toMatch(/lying across a split already open/);
    }
    expect(TOOL_CONTACT_CLAUSE).toMatch(/a froe, wedge, maul or axe that is SPLITTING wood driven edge-down into the end grain/);
    expect(TOOL_CONTACT_CLAUSE).toContain(TOOL_POSITION_CLAUSE);
  });

  it("people splitting together keep the rule, and no hand grips a piece where it splits (job 407 scene 10)", () => {
    // A froe pushed into the SIDE of an upright bolt, a second bare hand gripping it where it would open.
    const s = pic(10, "since folk schools still teach plenty of these", "students at a folk school workshop splitting oak bolts with froes beside a stump", {
      visualPrompt: "Bare weathered hands at a woodlot workshop holding a froe against a log bolt braced on a tree stump, splitting oak.",
      humanPresent: true,
      otherPerson: "folk school students",
      otherPeople: 2,
    });
    const clause = personClauseFor(s, s.visualPrompt!);
    expect(clause).toMatch(SPLIT_RULE);
    expect(clause).toMatch(/never by a hand where it splits open/);
    // The one-person wording reaches a lone other person too.
    expect(otherPersonClause("a folk school student")).toMatch(SPLIT_RULE);
  });

  it("an edge tool is pushed away from the other hand (job 406 scene 9)", () => {
    // A chisel pushed straight at the other hand lying flat on the board, under a vague description.
    const scenes = [
      pic(9, "and this channel is for working people who want extra income", "the host working quietly at the garage workbench with simple hand tools", {
        visualPrompt:
          "Bare weathered hands from the forearms down working with a simple hand tool at a wooden garage workbench, fingers already gripping and adjusting, pegboard and window in the background.",
        humanPresent: true,
      }),
    ];
    markHostBroll(scenes, { hostLook: SAWYER, hostName: "Gary" }, "https://x/host.png");
    const prompt = buildStillPrompt(scenes[0]);
    expect(prompt).toMatch(/A chisel, gouge, plane or a knife carving wood is pushed AWAY from the other hand/);
    expect(prompt).toMatch(/no hand ever lies on the work ahead of where the edge points/);
    // The hands-only lane carries both as well.
    expect(ANON_PERSON_SUFFIX).toMatch(/pushed AWAY from the other hand/);
    expect(ANON_PERSON_SUFFIX).toMatch(SPLIT_RULE);
  });

  it("a tool at rest, with nobody in the picture, is not told how to work", () => {
    const scenes = [pic(3, "The froe is the tool that made those roofs.", "a froe hanging from a peg on a log cabin wall")];
    markHostBroll(scenes, { hostLook: SAWYER, hostName: "Sam" }, "https://x/host.png");
    expect(scenes[0].humanPresent).toBeFalsy();
    const prompt = buildStillPrompt(scenes[0]);
    expect(prompt).toContain(NO_FIGURES_SUFFIX);
    expect(prompt).not.toMatch(SPLIT_RULE);
    expect(prompt).not.toMatch(/pushed AWAY from the other hand/);
  });

  it("the still check names a splitting tool out of the end grain and a hand ahead of an edge", () => {
    expect(STILL_DEFECT_SYSTEM).toMatch(/a tool SPLITTING wood \(a froe, wedge, maul or axe splitting a piece\) whose edge is not in the wood's end grain/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/pushed into the SIDE of an upright piece/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/its edge resting on the wood but not in it/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/sticking out into the air with no wood under its edge/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/lying ACROSS a split already open/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/a hand gripping a piece where it is splitting open/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/a hand or fingers AHEAD of a chisel, gouge, plane or a knife carving wood/);
    // Both sit inside QUESTION 2 (broken), before QUESTION 3, and the question still leans to false.
    const q2 = STILL_DEFECT_SYSTEM.slice(
      STILL_DEFECT_SYSTEM.indexOf("QUESTION 2"),
      STILL_DEFECT_SYSTEM.indexOf("QUESTION 3")
    );
    expect(q2).toMatch(/a tool SPLITTING wood/);
    expect(q2).toMatch(/AHEAD of a chisel/);
    expect(q2).toMatch(/When unsure, answer false/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/fingers in front of or right beside a blade/);
  });
});

describe("only a tool that is SPLITTING goes into the end grain; a kitchen knife is not an edge tool pushed along (jobs 406, 407)", () => {
  const SAWYER = "A broad man in his sixties with a short white beard, wearing a sage green work shirt with rolled sleeves";

  it("a broadaxe hewing the side of a log is told it bites into the side, not the end grain (job 407 scene 25)", () => {
    // The same film's hewing picture was right: the broadaxe in the side of a green poplar log. Told
    // every axe is a splitting tool, it would be drawn in the log's end and refused by the checker.
    const scenes = [
      pic(25, "because a fresh log gives up its chips far easier than a seasoned one, and tall, straight tulip poplar was a favorite.",
        "hands gripping a broadaxe as its wide flat blade bites into a fresh green poplar log, wood chips flying", {
          visualPrompt:
            "Bare weathered hands gripping a broadaxe, its wide flat blade pressing into a fresh green poplar log in a woodlot clearing, wood chips visible at the blade's edge.",
          humanPresent: true,
        }),
    ];
    markHostBroll(scenes, { hostLook: SAWYER, hostName: "Sam" }, "https://x/host.png");
    const prompt = buildStillPrompt(scenes[0]);
    expect(prompt).toMatch(/An axe that is chopping, felling or hewing rather than splitting bites into the side of the log or trunk/);
    expect(prompt).toMatch(/an axe chopping or hewing bitten into the side of the log/);
    // Every axe is no longer a splitting tool by name: the end-grain rule asks for a tool that IS splitting.
    expect(TOOL_CONTACT_CLAUSE).not.toMatch(/a splitting tool \(a froe, wedge, maul or axe\)/);
    expect(TOOL_POSITION_CLAUSE).toMatch(/a piece being SPLIT \(riven with a froe, or split with a wedge, a maul or an axe\)/);
  });

  it("the still check refuses only a tool that is splitting, never a hewing axe or a tool at rest", () => {
    const q2 = STILL_DEFECT_SYSTEM.slice(
      STILL_DEFECT_SYSTEM.indexOf("QUESTION 2"),
      STILL_DEFECT_SYSTEM.indexOf("QUESTION 3")
    );
    expect(q2).toMatch(/An axe chopping, felling or hewing into the side of a log or trunk is right/);
    // Job 407 scenes 4-8: the axe, froe and drawknife hanging on the cabin wall.
    expect(q2).toMatch(/a tool hanging, lying or resting unused is splitting nothing/);
    expect(q2).not.toMatch(/a splitting tool \(a froe, wedge, maul or axe\) that is not driven/);
  });

  it("the edge rule names a carving knife, not every knife (job 406's kitchen knives)", () => {
    // Job 406 sharpens kitchen knives: a knife held up to the light (scene 13), sharpened on a guided
    // sharpener (scene 16). A kitchen knife cuts down beside the guide hand and is sharpened with
    // fingers on its flat; "fingers right beside a blade" still covers a hand in its way.
    expect(TOOL_POSITION_CLAUSE).not.toMatch(/A chisel, knife, gouge or plane/);
    expect(STILL_DEFECT_SYSTEM).not.toMatch(/AHEAD of a chisel, knife, gouge or plane/);
    expect(STILL_DEFECT_SYSTEM).toMatch(/fingers in front of or right beside a blade, saw, bit or cutting edge/);
    expect(TOOL_POSITION_CLAUSE).toMatch(/food on a cutting board/);
    // A plane's front hand is on the tool, ahead of its iron: the rule asks for the hand ON the tool.
    expect(TOOL_POSITION_CLAUSE).toMatch(/that hand is on the tool itself or holds the work behind the edge/);
  });
});

/**
 * LIGHT THE WORDS NAME IS NOT STAGED (2026-10-18, the review of jobs 401-407). The night and the
 * lamplight a line or a picture's own description asks for were called "staged" on both draws and
 * shipped with the warning — job 405's night bedroom, job 401's "kitchen table at two in the
 * morning" and its writer "by lamplight". The check is now told the words that name the light;
 * what they do not name (a glossy finish, a golden glow nobody asked for) is judged as before.
 */
describe("light the line or the description names is never staged (jobs 401, 405)", () => {
  const noteFor = (s: StoryboardScene) => namedLightQuestion(namedLight(s.scriptText, s.showSubject));

  it("the night and lamplight pictures are told their light was asked for", () => {
    const named = [
      // Job 401 scene 11 and scene 22.
      pic(11, "the kitchen table at two in the morning when the house is too quiet.", "round wooden kitchen table with two chairs and a dim lamp at night"),
      pic(22, "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus,", "a Roman man in a toga writing on a scroll at a wooden desk by lamplight"),
      // Job 405 scenes 13, 18, 21 and 26.
      pic(13, "So tonight we’re treating that scene like footage. We’ll", "wide view of bedroom at night with cat on the bed"),
      pic(18, "And by the end, you’ll have the one evening change that quietly takes the appointment off the books.", "a quiet bedroom at evening with the lamp glowing softly on the nightstand"),
      pic(21, "There’s a stubborn old myth that cats are nocturnal,", "a small tabby cat sitting alert on a windowsill, dim dawn light glowing through the bedroom window"),
      pic(26, "Think of her as a shift worker who moved into your home.", "an open grassy wild landscape at dusk, low golden light over scattered brush and distant hills"),
    ];
    for (const s of named) {
      expect(noteFor(s)).toMatch(/QUESTION 7 NOTE — staged/);
      expect(noteFor(s)).toMatch(/NEVER staged on its own/);
    }
    expect(noteFor(named[0])).toContain('"two in the morning"');
    expect(noteFor(named[1])).toContain('"lamplight"');
    expect(noteFor(named[2])).toContain('"night"');
    expect(noteFor(named[2])).not.toContain("tonight");
  });

  it("pictures whose words name no light are judged by the rule alone", () => {
    // Job 401 scenes 24 (the sunlit villa), 30 (the polished marble hall) and 15 (the bills): their
    // staged flags were about the finish, not a light anyone asked for.
    const unnamed = [
      pic(24, "Seneca was no monk on a hillside. He was one of the richest men in the empire,", "a well dressed man standing near a grand desk in a study"),
      pic(30, "the senator complains,", "a senator in robes standing in a stone hall"),
      pic(15, "people carrying real questions about", "an older man at a kitchen table looking over a stack of household bills, seen from the side"),
      // Dale's job 345: stacks in plain daylight — still never staged for content, and no note.
      pic(1, "and every piece gets stacked and sorted by size,", "stacks of cutting boards and coasters sorted on a workbench"),
    ];
    for (const s of unnamed) expect(noteFor(s)).toBe("");
    // The rule the check and the audit share is unchanged: an unnamed glowing lamp is still staged.
    expect(STAGED_RULE).toMatch(/glowing lamp, candle or golden glow/);
    expect(STAGED_QUESTION).toContain(STAGED_RULE);
  });
});

describe("split panels are checked against their lines and name one thing (round 11, jobs 401 and 406)", async () => {
  // The line check ran before any split existed and never read a panel, so a split's picture half
  // shipped whatever its old cutaway or the panel rewrite said: job 401 scene 26 an empty chair for
  // "I pull my chair in closer", job 406 scene 19 "a guided sharpening system or belt sander setup".
  const { applyPanelFixes, oneThingPanels, parsePanelFixes, parsePictureFixes } = await import("./shotList");
  const HOST = "the channel's host, exactly as in their host photo, seated in a chair talking directly to the camera";
  const split = (index: number, line: string, panelWords: string, o: Partial<StoryboardScene> = {}) =>
    ({ index, narration: line, scriptText: line, hostPresent: true, visualPrompt: HOST, splitVisual: panelWords, ...o }) as StoryboardScene;
  const garage: KeyThing[] = [
    { main: true, name: "sharpening system", look: "a tabletop guided knife sharpener, black plastic base with metal guide rods, clamps to bench edge" },
    { name: "belt sharpening setup", look: "a benchtop machine with a spinning abrasive belt, metal frame, bolted to the garage workbench" },
  ];

  it("job 406 scene 19: the panel draws one thing, and is drawn from that thing's pictures", () => {
    const s = split(
      19,
      "A guided sharpening system or a belt setup runs a hundred to three hundred dollars, and that’s the whole buy-in.",
      "A guided sharpening system or belt sander setup sitting on a garage workshop bench, viewed from a step back, with hand tools and wall storage visible at the edges.",
      { keyThing: "belt sharpening setup", otherKeyThings: ["sharpening system"] }
    );
    expect(oneThingPanels([s], garage)).toBe(1);
    const drawn = buildSplitRightScene(s);
    expect(drawn.showSubject).not.toMatch(/\bor\b/);
    expect(drawn.showSubject).toMatch(/^A guided sharpening system sitting on a garage workshop bench/);
    expect(s.keyThing).toBe("sharpening system");
    expect(s.visualPrompt).toBe(HOST);
  });

  it("job 401 scene 26: a figure of speech the check rewrote is the panel; the host take is untouched", () => {
    const line = "When a man like that sits down to write about time, I pull my chair in closer.";
    const s = split(26, line, "A wooden chair pulled close to a desk in a quiet study, positioned as if just moved nearer.", { keyThing: "chair" });
    const scenes = [s];
    const answer = JSON.stringify({
      pictures: [{ id: 0, about: "a man writing about time", shows_it: false, show: "a half-unrolled scroll and a reed pen on a wooden desk", thing: null }],
    });
    // The line check proper still never reads a panel; the panel pass does.
    expect(parsePictureFixes(answer, scenes)).toEqual([]);
    expect(applyPanelFixes(scenes, parsePanelFixes(answer, scenes), [{ name: "chair", look: "a wooden chair with a curved back" }])).toBe(1);
    expect(buildSplitRightScene(s).showSubject).toBe("a half-unrolled scroll and a reed pen on a wooden desk");
    expect(s.keyThing).toBeUndefined();
    expect(s.visualPrompt).toBe(HOST);
    expect(s.scriptText).toBe(line);
  });

  it("a panel the check says is right, and a panel with one thing, stay exactly as they were", () => {
    const words = "A tabletop knife sharpener clamped to a garage workbench, a dull kitchen knife laid in its guide slot.";
    const s = split(16, "Number one: knife and tool sharpening.", words, { keyThing: "sharpening system" });
    const fixes = parsePanelFixes(JSON.stringify({ pictures: [{ id: 0, about: "knife sharpening", shows_it: true }] }), [s]);
    expect(applyPanelFixes([s], fixes, garage)).toBe(0);
    expect(oneThingPanels([s], garage)).toBe(0);
    expect(s.splitVisual).toBe(words);
    expect(s.keyThing).toBe("sharpening system");
  });

  it("a panel offering a choice is cut to one thing without gluing the halves together (job 150, a split panel)", () => {
    // The first cut read "lined" as where the pouch sits and drew "a pot holder lined pouch" beside the host.
    const s = split(
      97,
      "that code on your screen. Or look just below this video, and you'll find it right at the top.",
      "A finished quilted pot holder or small lined pouch resting flat on the wooden sewing table by the window, morning light soft across its stitched surface, empty and at rest."
    );
    expect(oneThingPanels([s], undefined)).toBe(1);
    expect(buildSplitRightScene(s).showSubject).toBe(
      "A finished quilted pot holder resting flat on the wooden sewing table by the window, morning light soft across its stitched surface, empty and at rest."
    );
    // A describing word gives way to the other one, never leaving the name behind (job 154 scene 32's
    // description, the same shape: "a simple wooden in a modest room").
    const rail = split(32, "and now and again an English lady who wants a bit of handwork to hang over a rail.", "A small hand-pieced quilt draped over a simple wooden or metal rail in a modest room.");
    oneThingPanels([rail], undefined);
    expect(rail.splitVisual).toBe("A small hand-pieced quilt draped over a simple metal rail in a modest room.");
  });
});

describe("a line with nothing to see never falls back to the main thing; a sound shows what makes it (round 11, jobs 401 and 404)", async () => {
  // Job 401: the opening story's sympathy card (the main thing) came back under "Your problem is
  // theft…" and "Then he turns the whole thing over in a single motion: life is not short" — the
  // same blank card each time. Job 404 scene 20: 15 s of an empty storm window under the winter
  // robin's soft clucking. The rules go to the shot list and the line check; these are the rewrites.
  const { applyPictureFixes, FIT_SYSTEM, parsePictureFixes } = await import("./shotList");
  const essay: KeyThing[] = [
    { main: true, name: "sympathy card", look: "a plain cream card with a simple embossed border, held or resting on the desk" },
    { name: "kitchen table", look: "a round wooden table with two chairs, a single dim lamp" },
  ];
  const birds: KeyThing[] = [
    { main: true, name: "robin", look: "a plump songbird, brown-grey back, bright orange-red breast, white eye ring" },
    { name: "storm window", look: "a clear glass pane in a white aluminum frame, closed tight through winter" },
  ];

  it("the line check holds an idea and a sound to what they are about", () => {
    expect(FIT_SYSTEM).toMatch(/A LINE WITH NOTHING TO SEE/);
    expect(FIT_SYSTEM).toMatch(/"The whole thing",\s+"all of it" or "that", summing up what was just said, point at the idea/);
    expect(FIT_SYSTEM).toMatch(/Two lines\s+with nothing to see never share a picture/);
    expect(FIT_SYSTEM).toMatch(/A SOUND\. A line about a sound/);
    // The cases' own words never reach the rulebook.
    expect(FIT_SYSTEM).not.toMatch(/sympathy|robin|storm window|clucking|theft/i);
  });

  it("job 401 scene 33: the card under an idea becomes a moment that carries it", () => {
    const s = pic(33, "Then he turns the whole thing over in a single motion: life is not short.", "a cream sympathy card resting on the wooden desk in the study", { keyThing: "sympathy card" });
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          {
            id: 0,
            about: "the writer reversing the claim that life is short",
            shows_it: false,
            show: "a man in a toga at a lamplit desk, turning a papyrus scroll over in his hands, seen from the side",
            thing: null,
            other: "a Roman writer",
          },
        ],
      }),
      [s]
    );
    expect(applyPictureFixes([s], fixes, essay)).toBe(1);
    expect(s.showSubject).not.toMatch(/card/);
    expect(s.keyThing).toBeUndefined();
    expect(s.otherPerson).toBe("a Roman writer");
  });

  it("job 404 scene 20: the robin the line is about, the window only where it is seen from", () => {
    const line =
      "Once nesting season is over, that job is done, and through the winter a robin hardly sings at all. Mostly you’ll hear a low, soft clucking, a bit like somebody tutting under their breath, and that’s easy to miss with the storm windows shut.";
    const s = pic(20, line, "a closed storm window pane viewed from inside the kitchen", { keyThing: "storm window" });
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          {
            id: 0,
            about: "the robin, quiet in winter",
            shows_it: false,
            show: "a robin puffed up on the snowy lawn, beak closed, seen through the closed storm window from the kitchen",
            thing: "robin",
          },
        ],
      }),
      [s]
    );
    expect(applyPictureFixes([s], fixes, birds)).toBe(1);
    expect(s.keyThing).toBe("robin");
    expect(s.otherKeyThings).toEqual(["storm window"]);
  });
});

describe("one picture, one subject: two sentences about different things are two pictures (round 11, job 407 scene 20)", async () => {
  // Job 407 scene 20: one still of hands steadying a log bolt in a forked stump ran 16.6 s, and for
  // its first 8.5 s the voice talked about cabin roofs held down with heavy poles — the roof was never
  // shown. The roof sentence's pieces had been joined, the riving sentence joined on as the same
  // topic, and the line check could only split at a comparison and never a joined picture. It now
  // splits where a sentence about a different thing starts, every part 3 s or more.
  const { applyPictureFixes, applyPictureSplits, FIT_SYSTEM, parsePictureFixes } = await import("./shotList");
  const cabin: KeyThing[] = [
    { name: "heavy roof poles", look: "long round timber poles laid across the roof boards to weigh them down without nails" },
    { name: "log bolts", look: "short round sections cut from a white oak or chestnut log, pale grey bark with cream-colored inner wood" },
  ];
  const roof = "The oldest cabins held long boards down with heavy poles laid across each course, so the roof went on without a nail.";
  const rive = "When you rive, the bolt sits in a fork or against a stump, never in your hand.";
  const bolt = "a log bolt wedged into a forked stump in the woodlot, hands steadying it from the side, a close-up of one detail of it filling the frame";

  it("the line check is told to split there, and never a joined sentence inside", () => {
    expect(FIT_SYSTEM).toMatch(/ONE PICTURE, ONE SUBJECT/);
    expect(FIT_SYSTEM).toMatch(/A picture marked "joined" may be split this way, where a sentence starts/);
    expect(FIT_SYSTEM).not.toMatch(/cabin|log bolt|woodlot|\bstump/i);
  });

  it("scene 20: the roof over the roof sentence, the bolt over the riving one", () => {
    const s = pic(20, `${roof} ${rive}`, bolt, { joinedLine: true, keyThing: "log bolts", humanPresent: true, wordCut: true });
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          {
            id: 0,
            about: "heavy poles holding the roof boards down",
            shows_it: false,
            show: "long round timber poles laid across overlapping courses of pale oak boards on an old cabin roof",
            thing: "heavy roof poles",
            split: [{ from: "When you rive", show: "a log bolt wedged upright in a forked stump, hands steadying it from the side", thing: "log bolts" }],
          },
        ],
      }),
      [s]
    );
    applyPictureFixes([s], fixes, cabin);
    const r = applyPictureSplits([s], fixes, cabin, () => 16.55);
    expect(r.scenes.map(x => [x.scriptText, x.keyThing])).toEqual([
      [roof, "heavy roof poles"],
      [rive, "log bolts"],
    ]);
    // Read in 5 s, the riving sentence would be a ~2 s flash: the line stays one picture.
    const quick = pic(20, `${roof} ${rive}`, bolt, { joinedLine: true });
    expect(applyPictureSplits([quick], fixes, cabin, () => 5).split).toBe(0);
  });

  it("job 399 scene 16: the viewer's half of a split is never drawn as the crew member who pours", () => {
    // The person changes where the sentence does: the check answering nobody else for the new picture
    // is kept, not replaced by the line's someone-else.
    const pour =
      "airlines, the flight attendant pours your soda into a plastic cup packed with ice, fills it about halfway, and the rest of the can rolls off down the aisle on the cart.";
    const ask = "On many of those carriers, you can have the whole thing just by asking.";
    const s = pic(16, `${pour} ${ask}`, "hands pouring soda into an ice-filled plastic cup at the cart", {
      joinedLine: true,
      humanPresent: true,
    });
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          {
            id: 0,
            about: "the flight attendant pouring",
            shows_it: true,
            who: "a flight attendant",
            split: [{ from: "On many of those carriers", show: "hands holding a full unopened soda can on a tray table", other: null }],
          },
        ],
      }),
      [s]
    );
    applyPictureFixes([s], fixes, []);
    const r = applyPictureSplits([s], fixes, [], () => 14.45);
    expect(r.scenes.map(x => x.otherPerson)).toEqual(["a flight attendant", undefined]);
  });
});

describe("the host introduced by one word of a two-word channel name (job 407)", () => {
  // Sawdust Sam's "I am Sam, and this one is for anybody…" played as a split screen, with no name
  // card, and the audit counted no introduction: only "Sawdust Sam" and "Sawdust" were looked for.
  // "I'm Brenda" on Backyard Brenda's channel would have missed the same way.
  const params = { faceImageUrl: "https://example.com/host.jpg", hostName: "Sawdust Sam" } as any;
  const film = () => [
    pic(8, "That steel is why the last skill on this list held the other twenty-four together.", "an axe head on a stump", {
      stillImage: true,
    }),
    host(
      9,
      "I am Sam, and this one is for anybody who has wondered how a family got through a mountain winter on a woodlot and very little cash.",
      { splitVisual: "a woodlot at the edge of a clearing" }
    ),
    pic(10, "The title says lost, which is too strong, since folk schools still teach plenty of these", "a folk school bench", {
      stillImage: true,
    }),
  ];

  it("the introduction is found, put on camera full frame, and counted by the audit", async () => {
    const { markHostIntroductions } = await import("./longformVideo");
    const { checkPlan } = await import("./planGate");
    const scenes = film();
    expect(checkPlan(scenes, params).stats.introductions).toBe(1);
    expect(checkPlan(scenes, params).findings.filter(f => f.rule === 6).map(f => f.scene)).toEqual([9]);
    markHostIntroductions(scenes, params.hostName, true);
    expect(scenes[1]).toMatchObject({ hostPresent: true, hostIntro: true });
    expect(scenes[1].splitVisual).toBeUndefined();
    expect(checkPlan(scenes, params).findings.filter(f => f.rule === 6)).toEqual([]);
    expect(scenes[0].hostIntro || scenes[2].hostIntro).toBeFalsy();
  });

  it("the same for 'I'm Brenda' — and a name's ordinary-word half is never the host", async () => {
    const { introducesHost } = await import("./longformVideo");
    expect(introducesHost("I'm Brenda, and if you keep a small yard, this one's for you.", "Backyard Brenda")).toBe(true);
    expect(introducesHost("Look at the backyard here, after the rain.", "Backyard Brenda")).toBe(false);
    expect(introducesHost("Sweep up the sawdust here, before it spreads.", "Sawdust Sam")).toBe(false);
    expect(introducesHost("It's sterling silver, not plate.", "Scarlett Sterling")).toBe(false);
    expect(introducesHost("You can see the Carolina Wren here, on the feeder.", "Walter Wren")).toBe(false);
    // A sign-on after a greeting's comma or a dash is found however it goes on.
    expect(introducesHost("Hi folks, Hank here in the shop today.", "Hank Hardwood")).toBe(true);
    expect(introducesHost("Howdy — Sam here, back at the bench.", "Sawdust Sam")).toBe(true);
  });

  it("the plan gate never hands the introduction over between the two words of the name", async () => {
    // With the host minutes spent, the gate walked back from a cut at no break and asked only the
    // kept words whether they named the host — "…I'm Sawdust" did, so the take ended there and
    // "Sam talking to you…" went under a picture. The name is now asked of the whole line.
    const { enforcePlanRules } = await import("./planGate");
    let t = 0;
    const timed = (s: StoryboardScene, sec: number) => {
      Object.assign(s, { narrationStartSec: t, narrationEndSec: t + sec, audioDuration: sec });
      t += sec;
      return s;
    };
    const scenes = [
      timed(pic(1, "That steel is why the last skill held the other twenty-four together.", "an axe head", { stillImage: true }), 5),
      timed(host(2, "So before we get going on any of it, I'm Sawdust Sam", { hostIntro: true, wordCut: true }), 6),
      timed(pic(3, "talking to you from my shop today about a winter.", "a woodlot", { stillImage: true, wordCut: true }), 6),
      timed(host(4, "Now, back to the cabin."), 5),
    ];
    const r = enforcePlanRules(scenes, params, { budgetSec: 11 });
    expect(r.scenes[1].scriptText).toBe("So before we get going on any of it, I'm Sawdust Sam");
    expect(r.scenes[2].scriptText).toMatch(/^talking to you/);
  });
});

describe("the host comes back after the book cover on the whole number, never inside it (job 406)", () => {
  // Gary's practice film at 3:00: the voice says "…working people actually run." — a 0.74 s pause
  // (179.42-180.16) — "Three hundred seventy pages", and the picture changed from the book cover to
  // the host at 180.69, after "Three hundred". The transcript heard the number as one late token,
  // "370", and the word before it running on over the pause, and the cut was placed between those
  // two heard edges. A cut made from text now lands in the pause before a sentence, and before a
  // number its sound's start, not the transcriber's guess.
  const HEARD =
    "working@178.027-178.347 people@178.387-178.688 actually@178.888-179.308 run.@179.368-180.619 370@180.768-181.0 pages,@181.269-181.689 101@182.209-182.61 numbered@182.77-183.27 hustles@183.31-183.69 across@183.791-184.111 13@184.351-184.671 chapters,@184.731-185.212";
  const words = HEARD.split(" ").map(tok => {
    const [, word, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
    return { word, start: Number(start), end: Number(end) };
  });
  const silences = [
    [174.458, 174.783], [177.95, 178.0], [178.597, 178.719], [178.85, 179.028], [179.423, 180.162],
    [181.513, 181.944], [184.013, 184.173], [185.25, 185.6],
  ].map(([start, end]) => ({ start, end }));
  const NUMBER = "Three hundred seventy pages, a hundred and one numbered hustles across thirteen chapters.";
  const cta = (s: StoryboardScene, from: number, to: number) =>
    Object.assign(s, { cta: true, ctaIndex: 0, narrationStartSec: from, narrationEndSec: to, audioDuration: to - from });

  it("the cover finishes its sentence and the host comes back in the pause, before 'Three hundred'", async () => {
    const { enforcePlanRules } = await import("./planGate");
    const scenes = [
      cta(host(1, "Three businesses in, and you can already see the pattern.", { qrCorner: true, hostProtected: true }), 165, 171.023),
      cta(
        pic(2, "That pattern fills a digital book called The Garage to Profit Bible, put together under this channel’s name from the honest arithmetic", "the book", { coverHero: true, stillImage: true }),
        171.023,
        177.975
      ),
      cta(host(3, `working people actually run. ${NUMBER}`, { qrCorner: true, hostProtected: true }), 177.975, 185.4),
      cta(pic(4, "There’s a QR code on your screen — aim your phone’s camera at it, and the page opens on its own.", "a garage bench", { qrHero: true, qrTail: true, stillImage: true }), 185.4, 199),
    ];
    const r = enforcePlanRules(scenes, { faceImageUrl: "https://example.com/host.jpg" } as any, { words, silences });
    const cover = r.scenes.find(s => s.coverHero)!;
    const back = r.scenes[r.scenes.indexOf(cover) + 1];
    expect(cover.scriptText).toMatch(/working people actually run\.$/);
    expect(back.scriptText).toBe(NUMBER);
    expect(cover.narrationEndSec!).toBeGreaterThanOrEqual(179.423);
    expect(cover.narrationEndSec!).toBeLessThanOrEqual(180.162);
    expect(back.narrationStartSec).toBeCloseTo(cover.narrationEndSec!, 5);
  });

  it("the cut the aligner places from the scene text lands in the same pause, even with the number heard late", () => {
    const late = words.map(x => (x.word === "run." ? { ...x, end: 179.528 } : x.word === "370" ? { ...x, start: 180.95, end: 181.19 } : x));
    const fine = [...silences, { start: 180.665, end: 180.722 }].sort((a, b) => a.start - b.start);
    const scenes = [pic(1, "working people actually run.", "the book", { coverHero: true }), host(2, NUMBER)];
    const ranges = assignSceneRanges(scenes, late, 185.4, silences, fine);
    expect(ranges[0].endSec).toBeGreaterThanOrEqual(179.423);
    expect(ranges[0].endSec).toBeLessThanOrEqual(180.162);
  });
});

describe("the list graphic shows every place the voice names, the last one too (job 401 at 0:49)", () => {
  // Gideon's practice film: the voice says "…a waiting room, a church pew, the kitchen table at two in
  // the morning when the house is too quiet." The list window "Some ordinary place" showed only
  // "1 A waiting room / 2 A church pew" and closed as the table was said; the table played as a picture
  // outside the list. The last item runs on into the sentence's closing clause with no comma or "and".
  const SCRIPT =
    "Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet. And the math always presents itself as the problem.";
  const PLACES = ["a waiting room", "a church pew", "the kitchen table at two in the morning"];
  // What the voice was heard saying (job 401's transcript, 49.4-55.3 s).
  const HEARD =
    "A@49.395-49.435 waiting@49.475-49.775 room.@49.835-50.115 A@50.475-50.515 church@50.595-50.895 pew.@50.975-51.315 The@51.775-51.875 kitchen@51.915-52.215 table@52.275-52.636 at@52.696-52.776 2@52.936-53.016 in@53.056-53.116 the@53.136-53.216 morning@53.276-53.636 when@53.796-53.936 the@53.956-54.056 house@54.096-54.376 is@54.456-54.536 too@54.596-54.776 quiet.@54.876-55.276";
  const heard: Word[] = HEARD.split(" ").map(tok => {
    const [, text, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
    return { text, start: Number(start), end: Number(end) };
  });

  it("the list found is three places, whether the model left the third out or the call failed", async () => {
    // The model's answer as job 400 gave it: the head and two places.
    const r = await findSpokenLists(SCRIPT, {
      ask: async () => '{"lists":[{"sentence":1,"kind":"things","items":["some ordinary place","a waiting room","a church pew"]}]}',
    });
    expect(r.lists).toEqual([{ sentence: 1, items: PLACES }]);
    const failed = await findSpokenLists(SCRIPT, { ask: async () => "not json" });
    expect(failed.lists).toEqual([{ sentence: 1, items: PLACES }]);
  });

  it("the table is the list's third picture and its graphic's third row", async () => {
    const { lists: found } = await findSpokenLists(SCRIPT, { ask: async () => '{"lists":[]}' });
    const scenes = [
      pic(8, "Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in some ordinary place,", "an older man sitting alone on a bench"),
      pic(9, "a waiting room,", "empty waiting room with cushioned chairs under fluorescent light", { listCut: true }),
      pic(10, "a church pew,", "empty polished wooden church pew with light through tall windows", { listCut: true }),
      pic(11, "the kitchen table at two in the morning when the house is too quiet.", "round wooden kitchen table with two chairs and a dim lamp at night"),
      host(12, "And the math always presents itself as the problem.", { splitVisual: "a desk in a study" }),
    ];
    const cut = applySpokenLists(scenes, found);
    expect(cut.scenes.map(s => [s.scriptText, !!s.listCut])).toEqual([
      ["Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in some ordinary place,", false],
      ["a waiting room,", true],
      ["a church pew,", true],
      // Before: no list mark, and the list window closed as these words began.
      ["the kitchen table at two in the morning when the house is too quiet.", true],
      ["And the math always presents itself as the problem.", false],
    ]);
    const film = {
      scenes: [
        { index: 9, narrationStartSec: 49.25, narrationEndSec: 50.35, scriptText: "a waiting room,", hostPresent: false, cta: false },
        { index: 10, narrationStartSec: 50.35, narrationEndSec: 51.69, scriptText: "a church pew,", hostPresent: false, cta: false },
        { index: 11, narrationStartSec: 51.69, narrationEndSec: 55.8, scriptText: "the kitchen table at two in the morning when the house is too quiet.", hostPresent: false, cta: false },
      ],
    };
    const [graphic] = missingListCues([], heard, film as never, found);
    expect((graphic.props.items as { say: string }[]).map(i => i.say)).toEqual(PLACES);
  });
});

describe("a later view of one topic is a new photo, never the picture it continues (round 11, jobs 401-405)", () => {
  // The review of the seven practice films found 15 near-copies. A topic past its limit or a split
  // picture's later part was drawn as "the same words + a view" from the picture it continued, and
  // came back as that picture again: job 405 scene 22 (the cat at the window, "a close-up of one
  // detail of it") was scene 21 a little tighter; scene 24, after the host's "The honest word is
  // crepuscular,", was scene 22 again; job 401 scene 3 kept scene 2's over-the-shoulder card shot;
  // job 403 scene 14 was scene 10's pipe run a little closer.
  const WINDOW = "a small tabby cat sitting alert on a windowsill, dim dawn light glowing through the bedroom window";
  const window = async () => {
    const { OTHER_VIEWS } = await import("./shotList");
    return [
      pic(7, "steady as a tightrope walker,", "a small tabby cat standing on a sleeping person's chest in the dark bedroom", { keyThing: "cat" }),
      pic(21, "There's a stubborn old myth that cats are nocturnal,", WINDOW, { keyThing: "cat", otherKeyThings: ["window"] }),
      pic(22, "creatures of the deep night, and that's mostly a costume they wear in cartoons.", `${WINDOW}${OTHER_VIEWS[0]}`, {
        keyThing: "cat",
        otherKeyThings: ["window"],
      }),
      host(23, "The honest word is crepuscular,"),
      pic(24, "which is just a fancy way of saying dawn and dusk.", `${WINDOW}${OTHER_VIEWS[0]}`, {
        keyThing: "cat",
        otherKeyThings: ["window"],
      }),
    ];
  };

  it("405-22: drawn from scene 21 as the picture it continues, from a concrete close-up, and compared with 21", async () => {
    const { continuedPicture, memoryViewFor } = await import("./pictureMemory");
    const { REDRAW_CAMERAS } = await import("./pictureVariety");
    const { sameThingReference } = await import("./longformVideo");
    const w = await window();
    expect(continuedPicture(w, w[2])).toBe(w[1]);
    expect(memoryViewFor(w, w[2])).toBe(REDRAW_CAMERAS[0]);
    const s = {
      ...w[2],
      memoryRefUrls: ["https://r2/still-src-7.png", "https://r2/still-src-21.png"],
      memoryView: REDRAW_CAMERAS[0],
      memoryRightBefore: 1,
      memoryContinues: true as const,
    };
    expect(sameThingReference(s)).toBe("https://r2/still-src-21.png");
    expect(memoryClause(s)).toMatch(/the earlier picture this one CONTINUES/);
    expect(memoryClause(s)).toMatch(/never that picture's angle with the subject only a little closer or further away/);
  });

  it("405-24: the host take the gate placed inside the topic ends it — 24 is seen from much further back", async () => {
    const { breakTopicsAtHostTakes, OTHER_VIEWS } = await import("./shotList");
    const { memoryViewFor } = await import("./pictureMemory");
    const { REDRAW_CAMERAS } = await import("./pictureVariety");
    const w = await window();
    w[4].sameShot = true;
    expect(breakTopicsAtHostTakes(w)).toBe(1);
    expect(w[4].sameShot).toBeUndefined();
    expect(w[4].showSubject).toBe(`${WINDOW}${OTHER_VIEWS[1]}`);
    expect(w[2].showSubject).toBe(`${WINDOW}${OTHER_VIEWS[0]}`);
    expect(memoryViewFor(w, w[4])).toBe(REDRAW_CAMERAS[1]);
  });

  it("401-3 and 401-5: both continue scene 2 — 5 by its words, not scene 4 right before it", async () => {
    const { continuedPicture, memoryViewFor } = await import("./pictureMemory");
    const { OTHER_VIEWS } = await import("./shotList");
    const { REDRAW_CAMERAS } = await import("./pictureVariety");
    const AISLE = "man standing in pharmacy card aisle holding a sympathy and birthday card together";
    const things = { keyThing: "sympathy card", otherKeyThings: ["pharmacy card aisle", "birthday card"], humanPresent: true };
    const b = [
      pic(2, "a pharmacy on a Tuesday morning, buying his third sympathy card since spring,", AISLE, things),
      pic(3, "He is counting backward. He is sixty-four.", `${AISLE}${OTHER_VIEWS[0]}`, { ...things, sameShot: true }),
      pic(4, "His father made it to eighty-one.", "a man's hand hovering between a row of cream sympathy cards and a row of pastel new-baby cards on a white pharmacy rack", {
        keyThing: "pharmacy card aisle",
        otherKeyThings: ["sympathy card"],
        humanPresent: true,
      }),
      pic(5, "he has about seventeen summers left.", `${AISLE}${OTHER_VIEWS[2]}`, { ...things, sameShot: true }),
    ];
    expect(continuedPicture(b, b[1])).toBe(b[0]);
    expect(continuedPicture(b, b[3])).toBe(b[0]);
    expect([memoryViewFor(b, b[1]), memoryViewFor(b, b[3])]).toEqual([REDRAW_CAMERAS[0], REDRAW_CAMERAS[2]]);
  });

  it("403-14 repeats scene 10 three pictures later; 404-7 follows the robin before the host's introduction", async () => {
    const { recomposeFrom } = await import("./pictureMemory");
    const pipes = [
      pic(10, "who would rather understand the cause than pay for the visit.", "grey PVC pipe network running beneath a house toward the street", { keyThing: "pipe network" }),
      pic(11, "So. We will go the way the water goes.", "close view of the toilet's internal porcelain S-shaped trapway channel with water rushing through it", { keyThing: "toilet trapway" }),
      pic(14, "Each of the nine stops somewhere,", "grey PVC pipe network running beneath the house toward the street", { keyThing: "pipe network" }),
    ];
    expect(recomposeFrom(pipes, pipes[2])).toEqual({ from: pipes[0], continues: true });
    const robins = [
      pic(5, "And that first robin of spring you'll be so happy to see in March?", "a robin standing on a green lawn in early spring with patches of melting snow", { keyThing: "robin" }),
      host(6, "I'm Walter, and if you keep an eye on the yard from the kitchen window, this one's for you."),
      pic(7, "We're going through seven things about the robin that hardly anybody knows,", "a robin standing on the snowy lawn near the fence", { keyThing: "robin" }),
    ];
    expect(recomposeFrom(robins, robins[2])).toEqual({ from: robins[0], continues: false });
  });

  it("the near-copy check always looks at the picture a continuation repeats; different pictures it leaves to the fingerprint", async () => {
    const { nearCopyPartnerFor } = await import("./pictureMemory");
    const w = await window();
    expect(nearCopyPartnerFor(w, w[2])).toBe(w[1]);
    const apart = [
      pic(1, "n", "a dog asleep on the porch steps"),
      pic(2, "n", "a red barn under a grey sky"),
    ];
    expect(nearCopyPartnerFor(apart, apart[1])).toBeUndefined();
  });

  it("398-10 keeps the close view its own words ask for: marked to continue, never told 'much further back'", async () => {
    const { continuedPicture, memoryViewFor } = await import("./pictureMemory");
    const { REDRAW_CAMERAS } = await import("./pictureVariety");
    const { PART_VIEW } = await import("./namedLooks");
    const LATTICE = "a one-foot-square kumiko lattice of thin pale pine strips in an even square grid, lying flat on a pale wooden workbench";
    const k = [
      pic(3, "But the one I was proudest of, a lattice panel that ate 6 hours of my Saturday,", LATTICE.replace("strips in", "strips crossing in"), {
        keyThing: "lattice panel",
      }),
      pic(9, "Start with the one that lost.", LATTICE, { keyThing: "lattice panel" }),
      pic(10, "Kumiko is the Japanese craft of fitting thin strips of wood together into patterns,", "close view of hands pressing a thin pale pine strip into the half-depth notches of a crossing strip, building a square kumiko grid on a workbench", {
        keyThing: "lattice panel",
        sameShot: true,
      }),
    ];
    // Scene 9 repeats scene 3 and takes the concrete close-up; scene 10 continues 9 with words of its own.
    expect(memoryViewFor(k, k[1])).toBe(REDRAW_CAMERAS[0]);
    expect(continuedPicture(k, k[2])).toBe(k[1]);
    expect(memoryViewFor(k, k[2])).toBe(PART_VIEW);
  });
});

describe("a split panel is checked for near-copies like any picture (round 11, job 405 scene 9)", () => {
  // A seeded "photo": light and dark patches smoothly enlarged, so the fingerprints are real ones.
  const photo = async (seed: number, w: number, h: number) => {
    const sharp = (await import("sharp")).default;
    let a = seed >>> 0;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const cols = Math.round((w / h) * 9);
    const px = Buffer.alloc(cols * 9 * 3);
    for (let i = 0; i < cols * 9; i++) px.fill(Math.floor(rnd() * 256), i * 3, i * 3 + 3);
    return sharp(px, { raw: { width: cols, height: 9, channels: 3 } }).resize(w, h, { kernel: "cubic", fit: "fill" }).png().toBuffer();
  };

  it("405-9 (scene 2 cut square) and 403-15 (scene 11 drawn square) are each looked at beside the picture they repeat; a panel of something else is not", async () => {
    const sharp = (await import("sharp")).default;
    const { pictureFingerprint, pictureThumb, rememberPicture, nearCopyCandidates } = await import("./pictureVariety");
    // 405: the walking tabby of scene 2, and the panel at scene 9 — the same picture cut square.
    const cat = await photo(2, 1536, 864);
    const catPanel = await sharp(cat).extract({ left: 336, top: 0, width: 864, height: 864 }).resize(1024, 1024).png().toBuffer();
    rememberPicture(94050, 2, await pictureFingerprint(cat), await pictureThumb(cat));
    expect(nearCopyCandidates(94050, 9, await pictureFingerprint(catPanel, true)).map(c => c.index)).toEqual([2]);
    // 403: the cut-open toilet of scene 11, and the swab panel at scene 15 — its whole composition squeezed square.
    const toilet = await photo(4, 1536, 864);
    const swabPanel = await sharp(toilet).resize(1024, 1024, { fit: "fill" }).png().toBuffer();
    rememberPicture(94030, 11, await pictureFingerprint(toilet), await pictureThumb(toilet));
    expect(nearCopyCandidates(94030, 15, await pictureFingerprint(swabPanel, true)).map(c => c.index)).toEqual([11]);
    // A panel of another thing (405's clock panel) is laid beside neither.
    const clock = await pictureFingerprint(await photo(52, 1024, 1024), true);
    expect(nearCopyCandidates(94050, 12, clock)).toEqual([]);
    expect(nearCopyCandidates(94030, 12, clock)).toEqual([]);
  });
});

describe("a memory picture takes only the thing from its references, never their weather or hour (round 11, jobs 404-405)", () => {
  // Job 404 scenes 14-15, "a robin standing in a mild gulf coast yard with palm trees", were drawn
  // from the robin's first pictures on a snowy northern lawn, told "the SAME robin … in the same
  // place", and came back with snow and frost on the grass under the palms.
  const robin = (index: number, show: string, refs: string[], memoryView: string) =>
    pic(index, "n", show, { keyThing: "robin", otherKeyThings: ["gulf coast yard"], memoryRefUrls: refs, memoryView });

  it("404-14 and 404-15: the references lend the robin's look; the yard, the season and the weather are the words'", async () => {
    const { MEMORY_SETTING_CLAUSE } = await import("./longformVideo");
    const { MEMORY_VIEWS } = await import("./pictureMemory");
    const s14 = robin(14, "a robin standing in a mild gulf coast yard with palm trees", ["https://r2/404/5.png", "https://r2/404/12.png"], MEMORY_VIEWS[3]);
    const s15 = robin(15, "a robin standing in a mild gulf coast yard with palm trees, a close-up of one detail of it filling the frame", ["https://r2/404/5.png", "https://r2/404/14.png"], PART_VIEW);
    for (const s of [s14, s15]) {
      const clause = memoryClause(s);
      expect(clause).toContain("in the same place unless this picture's own words put it somewhere else");
      expect(clause).not.toContain("in the same place —");
      expect(clause.endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
    }
    expect(MEMORY_SETTING_CLAUSE).toMatch(/never its season, weather, light or time of day/);
  });

  it("405-28: the clock under 'three in the morning' is told its hour is its own words' — a remembered stove with no place named stays put", async () => {
    const { MEMORY_SETTING_CLAUSE } = await import("./longformVideo");
    const { MEMORY_VIEWS } = await import("./pictureMemory");
    const clock = pic(28, "And three in the morning sits close enough to her pre-dawn window", "the round analog clock on the nightstand pointing near three", {
      keyThing: "clock",
      otherKeyThings: ["nightstand"],
      memoryRefUrls: ["https://r2/405/11.png"],
      memoryView: MEMORY_VIEWS[0],
    });
    expect(memoryClause(clock)).toContain(MEMORY_SETTING_CLAUSE);
    expect(MEMORY_SETTING_CLAUSE).toMatch(/those are what this picture's own words say/);
    // The place yields only to a place the words name: never sent somewhere new by itself.
    expect(MEMORY_SETTING_CLAUSE).toMatch(/never its place when THIS picture's words name another/);
    const stove = pic(7, "n", "the wood stove's door open with the fire inside", {
      keyThing: "wood stove",
      memoryRefUrls: ["https://r2/stove-1.png"],
      memoryView: MEMORY_VIEWS[1],
    });
    expect(memoryClause(stove)).toContain("in the same place unless this picture's own words put it somewhere else");
  });

  it("404-14: the robin's two lawn pictures are not called 'this exact gulf coast yard' — 404-15, drawn from 14's yard, still is", async () => {
    // Told its references showed "this exact robin and gulf coast yard", 404-14 had only the snowy
    // northern lawn to copy as its yard. The yard has no earlier picture, so render now says so.
    const { attachMemory, memoryFor, MEMORY_VIEWS, pictureSettled } = await import("./pictureMemory");
    const { memoryFields } = await import("./longformVideo");
    const yard = "a robin standing in a mild gulf coast yard with palm trees";
    const b = [
      pic(5, "n", "a robin standing on a green lawn in early spring with patches of melting snow", { keyThing: "robin", pictureUrl: "https://r2/404/5.png" }),
      pic(12, "n", "a robin standing on frost dusted brown grass in winter", { keyThing: "robin", pictureUrl: "https://r2/404/12.png" }),
      host(13, "The ones that nest up in Canada and across the far north do head south,", {
        splitVisual: "A flock of robins in flight above a snow-covered landscape, heading south, bare trees and white ground below.",
        keyThing: "robin",
      }),
      pic(14, "so the robin you see in January could be a traveler from up north", yard, { keyThing: "robin", otherKeyThings: ["gulf coast yard"] }),
      pic(15, "along the Gulf Coast or down in Florida", `${yard}, a close-up of one detail of it filling the frame`, {
        keyThing: "robin",
        otherKeyThings: ["gulf coast yard"],
      }),
    ];
    attachMemory(b, [b[3]]);
    const s14 = { ...b[3], ...memoryFields(await memoryFor(b[3], 0), MEMORY_VIEWS[3]) } as StoryboardScene;
    expect(memoryClause(s14)).toMatch(/show this exact robin. Draw the SAME robin — /);
    expect(memoryClause(s14)).toContain("The gulf coast yard is drawn as this picture's own words describe it.");
    b[3].pictureUrl = "https://r2/404/14.png";
    attachMemory(b, [b[4]]);
    pictureSettled(b[3]);
    const s15 = { ...b[4], ...memoryFields(await memoryFor(b[4], 0), MEMORY_VIEWS[0]) } as StoryboardScene;
    // Round 14: a PLACE is never "this exact" one of the references, even where one stands in it — job
    // 411's robin references stood on the northern lawn, and "the SAME robin and lawn" copied the yard.
    // 15 is drawn from 14 for the robin; the yard is its own words'.
    expect(memoryClause(s15)).toMatch(/show this exact robin\. Draw the SAME robin — /);
    expect(memoryClause(s15)).toContain("The gulf coast yard is drawn as this picture's own words describe it.");
  });
});

describe("a living thing is drawn as its exact kind (job 404 scene 4)", () => {
  // The film's first robin, a split panel "on a holly bush … snow", came back as the European robin
  // on a channel about the American one: its written look never said which robin, and ran on into
  // the place's list ("seen on grass, bare branches, and holly shrubs").
  const STORED =
    "a plump songbird about ten inches long, brown-grey back, bright orange-red breast, white eye ring, dark head, " +
    "seen on grass, bare branches, and holly shrubs";
  const EXACT = "an American robin, dark grey head, yellow bill, broken white ring around the eye, brick-orange breast";
  const film = (look: string) => {
    const b = [
      pic(3, "Plenty of folks figure the robins took off months ago,", "the lawn under patches of melting snow", {
        keyThing: "lawn",
        pictureUrl: "https://r2/404/3.png",
      }),
      host(4, "Across a good part of the country, plenty of those robins never leave at all,", {
        splitVisual: "A robin perched on a holly bush, its branches laden with bright red berries, snow on the ground nearby in winter.",
        keyThing: "robin",
      }),
    ];
    const things: KeyThing[] = [
      { name: "robin", main: true, look },
      { name: "lawn", look: "a flat suburban backyard lawn" },
    ];
    return { b, things };
  };

  it("the props list names the exact kind as the script's region says it, with what sets it apart", async () => {
    const { EXACT_KIND_RULE } = await import("./shotList");
    expect(CONTINUITY_SYSTEM).toContain(EXACT_KIND_RULE);
    expect(EXACT_KIND_RULE).toMatch(/its look STARTS with that exact kind/);
    expect(EXACT_KIND_RULE).toMatch(/the script's own country or region/);
    expect(EXACT_KIND_RULE).toMatch(/each said as what it HAS, never naming the look-alike/);
  });

  it("the split panel is drawn by that look — still or moving — and never by the place's list", async () => {
    const { attachMemory } = await import("./pictureMemory");
    const { attachKeyframeMemory, withSplitMemory } = await import("./longformVideo");
    const exact = film(EXACT);
    attachMemory(exact.b, [], exact.things);
    const panel = await withSplitMemory(exact.b[1], buildSplitRightScene(exact.b[1]), 0);
    expect(buildStillPrompt(panel, false, undefined, undefined, true)).toContain(
      `HOW THE ROBIN LOOKS in every picture of this video: ${EXACT}`
    );
    await attachKeyframeMemory(panel, 0); // a moving panel's start frame
    expect(panel.keyThingLook).toBe(EXACT);
    const stored = film(STORED);
    attachMemory(stored.b, [], stored.things);
    const old = await withSplitMemory(stored.b[1], buildSplitRightScene(stored.b[1]), 0);
    expect(old.keyThingLook).toMatch(/dark head$/);
    expect(buildStillPrompt(old, false, undefined, undefined, true)).not.toContain("holly shrubs");
  });
});

describe("a picture never cuts a solid thing open (job 403, the review of 2026-10-18)", () => {
  // "Here is the part nobody sees. Inside the porcelain…" — five pictures in 45 s were the same sawn-
  // open fixture, and memory carried the cut into the host lifting a sliced toilet (scene 23).
  const TRAPWAY_LOOK =
    "the toilet's internal porcelain passage behind the bowl, a smooth curved S-shaped channel molded white, climbing upward before descending";
  const things: KeyThing[] = [
    { name: "toilet trapway", main: true, look: TRAPWAY_LOOK },
    { name: "plunger", look: "red rubber cup on a wooden handle, standing upright in a corner" },
  ];
  const film = () => [
    pic(
      11,
      "Today we go through all nine, one at a time, and look at what the German habit does instead. So. We will go the way the water goes.",
      "close view of the toilet's internal porcelain S-shaped trapway channel with water rushing through it",
      { keyThing: "toilet trapway" }
    ),
    pic(12, "Flush,", "water swirling down the white toilet bowl mid-flush", { listCut: true }),
    pic(13, "and follow.", "close-up of the smooth white curved S-shaped porcelain channel, water flowing up and over its curve", {
      keyThing: "toilet trapway",
      partOf: "toilet trapway",
      listCut: true,
    }),
    pic(
      16,
      "Here is the part nobody sees. Inside the porcelain, the water does not fall straight down.",
      "cutaway close-up of the white porcelain S-shaped channel behind the bowl, water climbing up and over the curve before descending",
      {
        keyThing: "toilet trapway",
        partOf: "toilet trapway",
        visualPrompt:
          "Cutaway view of the white porcelain S-shaped trapway channel behind a toilet bowl, water climbing up and over the curve before descending.",
      }
    ),
    pic(
      23,
      "If it will not come, the toilet has to come up off the floor, and that is a fair place to stop and call someone.",
      "toilet lifted off the floor in the small German bathroom, pipe opening exposed",
      { keyThing: "toilet trapway", humanPresent: true }
    ),
  ];

  it("scene 16: the prompt never says cutaway, and says to show it from outside", async () => {
    const { SEEN_FROM_OUTSIDE_CLAUSE } = await import("./cutOpen");
    const p = buildStillPrompt(film()[3]);
    expect(p).toContain("View of the white porcelain S-shaped trapway channel behind a toilet bowl");
    expect(p).not.toMatch(/cutaway (?:view|close-up)/i);
    expect(p).toContain(SEEN_FROM_OUTSIDE_CLAUSE);
  });

  it("scene 23: the lifted toilet is drawn from outside, by no inside look and from no cutaway", async () => {
    const { SEEN_FROM_OUTSIDE_CLAUSE } = await import("./cutOpen");
    const { attachMemory } = await import("./pictureMemory");
    const b = film();
    attachMemory(b, [], things);
    expect(keyThingLookFor(b[4], things, false)).toBeUndefined();
    expect(memorySourcesFor(b, b[4])).not.toContain(b[0]);
    expect(memorySourcesFor(b, b[4])).not.toContain(b[3]);
    const p = buildStillPrompt(b[4]);
    expect(p).toContain(SEEN_FROM_OUTSIDE_CLAUSE);
    expect(p).not.toContain("internal porcelain passage");
  });

  it("scene 12: the bowl looked into is an ordinary photo — no clause", async () => {
    const { SEEN_FROM_OUTSIDE_CLAUSE } = await import("./cutOpen");
    expect(buildStillPrompt(film()[1])).not.toContain(SEEN_FROM_OUTSIDE_CLAUSE);
  });

  it("the door frames too: Norbert's \"cutaway view of the pine door frame\" (job 232 scene 9)", async () => {
    const { SEEN_FROM_OUTSIDE_CLAUSE } = await import("./cutOpen");
    const door = pic(
      9,
      "Those little factory screws only reach the soft pine.",
      "a cutaway view of the pine door frame showing the gap and wooden stud behind it, with the short factory screws falling short",
      {
        visualPrompt:
          "Cutaway view of pale pine door frame, exposing the gap behind it and the squared wooden stud set back in that gap.",
      }
    );
    const p = buildStillPrompt(door);
    expect(p).toContain("View of pale pine door frame, exposing the gap behind it");
    expect(p).toContain(SEEN_FROM_OUTSIDE_CLAUSE);
  });

  it("the still check calls a cut-open thing broken, and the prompt writer is told the rule", async () => {
    const { CUT_OPEN_BROKEN, NOTHING_CUT_OPEN_RULE } = await import("./cutOpen");
    const { STILL_BROLL_ENHANCER_SYSTEM } = await import("./longformVideo");
    expect(STILL_DEFECT_SYSTEM).toContain(CUT_OPEN_BROKEN);
    expect(STILL_DEFECT_SYSTEM).toMatch(/QUESTION 2 — broken[\s\S]*shown CUT OPEN[\s\S]*QUESTION 3/);
    expect(STILL_BROLL_ENHANCER_SYSTEM).toContain(NOTHING_CUT_OPEN_RULE);
  });

  it("job 225: a door frame cut away in cross-section is asked for whole; a real repair cut stays the work", async () => {
    const { SEEN_FROM_OUTSIDE_CLAUSE, CUT_OPEN_BROKEN } = await import("./cutOpen");
    const frame = pic(16, "That gap is where the screws give up.", "pine door frame cross-section showing a shallow gap and thicker stud behind board", {
      visualPrompt:
        "Pine door frame cut away in cross-section, pale soft wood showing a shallow gap between the visible face board and a thicker stud set behind it, resting on a workbench.",
    });
    const p = buildStillPrompt(frame);
    // Only the clause that forbids it may still say the word.
    expect(p.replace(SEEN_FROM_OUTSIDE_CLAUSE, "")).not.toMatch(/cross[- ]?section|cut away/i);
    expect(p).toContain("Pine door frame, pale soft wood showing a shallow gap");
    expect(p).toContain(SEEN_FROM_OUTSIDE_CLAUSE);
    // A pipe cut to length or a wall opened to reach a valve is what a repair film shows: never broken.
    expect(CUT_OPEN_BROKEN).toMatch(/Fine:.*a pipe cut to length.*access hole cut in a wall/);
    const cutting = pic(30, "Cut the new pipe to length.", "a hacksaw cutting a length of grey PVC pipe on a bench", {
      humanPresent: true,
    });
    expect(buildStillPrompt(cutting)).not.toContain(SEEN_FROM_OUTSIDE_CLAUSE);
  });
});

describe("job 402 scene 33: nobody behind the big QR card", () => {
  // Helena Hart's flight-attendant film (183.56-203.15): the scan window's picture was "A flight
  // attendant's hands holding a small packet of crackers or cookies, offering it downward toward a
  // seated passenger in the cabin row", drawn from scene 29's packet passed hand to hand. The card
  // covered the packet, the fingers wrapped its lower-left edge, and for 19.6 s a hand held the QR code.
  const SHIPPED =
    "A flight attendant's hands holding a small packet of crackers or cookies, offering it downward toward a seated passenger in the cabin row, soft cabin light on the materials, the seat back and armrest visible at the edges.";
  const film = (): StoryboardScene[] => [
    pic(26, "Ask while the cart is still working its way back,", "a fully stocked beverage cart in the galley", {
      visualPrompt: "Overhead view of a fully stocked beverage cart parked in the galley, rows of cans and a snack basket",
    }),
    pic(29, "and phrase it as an offer.", "a flight attendant smiling as she hands a cookie packet to an older passenger, seen from the side", {
      visualPrompt:
        "Bare hands holding a small foil-lined paper packet of cookies sealed, one hand extending it toward another hand reaching to receive it at a stainless steel galley counter, aircraft interior blurred behind.",
      keyThing: "cookie packet",
      humanPresent: true,
      otherPerson: "a flight attendant and an older passenger",
    }),
    host(32, "Chapter four covers in-flight requests, so when the right sentence won't come to you at the galley, it's already in your pocket.", { cta: true }),
    {
      index: 33,
      scriptText:
        "Hold your phone up to the screen with its camera on, and aim it at the little black and white code. A link appears, and you tap it.",
      cta: true,
      qrHero: true,
      qrTail: true,
      stillImage: true,
      keyThing: "cookie packet",
      namedLook: "QR code: A small square pattern of black and white made of many tiny square dots.",
      visualPrompt: SHIPPED,
    } as StoryboardScene,
  ];

  it("its words name nobody: the hands prompt is swapped for a picture of nobody, its key thing and QR look go", () => {
    const scenes = film();
    expect(guardPitchVisuals(scenes)).toEqual([33]);
    expect(scenes[3].visualPrompt).toBe(scenes[0].visualPrompt);
    expect(SHOWS_PERSON.test(scenes[3].visualPrompt)).toBe(false);
    expect(scenes[3].keyThing).toBeUndefined();
    expect(scenes[3].namedLook).toBeUndefined();
  });

  it("its prompt says nobody is in it, not even a hand, and it is never drawn from the hands picture", async () => {
    const { NO_PEOPLE_SUFFIX, QR_BACKDROP_CLAUSE } = await import("./longformVideo");
    const scenes = film();
    // Before the guard, with the packet still its key thing: the hands picture is no memory for it.
    expect(memorySourcesFor(scenes, scenes[3])).toEqual([]);
    guardPitchVisuals(scenes);
    const p = buildStillPrompt(scenes[3]);
    expect(p).toContain(QR_BACKDROP_CLAUSE);
    expect(p).toContain(NO_PEOPLE_SUFFIX);
    expect(p).not.toContain(NO_FIGURES_SUFFIX);
    expect(p).not.toMatch(/hands holding|passenger/);
  });

  it("the picture check asks it — and only it — whether anyone is in the frame", async () => {
    const { QR_BACKDROP_PERSON_QUESTION } = await import("./overlayTextScan");
    expect(QR_BACKDROP_PERSON_QUESTION).toMatch(/must show NOBODY/);
    expect(QR_BACKDROP_PERSON_QUESTION).toMatch(/even small, partly, or at an edge/);
    // The rulebook every picture is asked never bans hands: a cutaway's hands at work are fine.
    expect(STILL_DEFECT_SYSTEM).not.toContain(QR_BACKDROP_PERSON_QUESTION);
  });

  it("jobs 401 and 404: a backdrop of nobody keeps its picture", () => {
    const card = film();
    card[3] = { ...card[3], keyThing: "sympathy card", namedLook: undefined, visualPrompt: "Plain cream sympathy card with simple embossed border resting on a wooden desk in a quiet study, late-spring light from a nearby window." };
    expect(guardPitchVisuals(card)).toEqual([]);
    expect(card[3].keyThing).toBe("sympathy card");
    const robin = film();
    robin[3] = { ...robin[3], keyThing: "robin", namedLook: undefined, visualPrompt: "A robin perched on frost-covered grass in a suburban winter yard at dawn, with bare shrubs and the fence line softly visible behind, early morning light gentle and pale." };
    expect(guardPitchVisuals(robin)).toEqual([]);
    expect(robin[3].visualPrompt).toMatch(/^A robin perched/);
  });
});

describe("job 405 scene 33: a sleeper's shoulder asked for behind the big QR card", () => {
  // Luca Marino's cat film: the scan window's words put "the sleeping person's shoulder barely
  // visible at frame edge" beside the cat. The cat stays; only the person leaves the words.
  it("keeps the cat and takes the shoulder out", async () => {
    const { withoutSomeone } = await import("./longformVideo");
    const qr = {
      index: 33,
      cta: true,
      qrHero: true,
      stillImage: true,
      keyThing: "tabby cat",
      visualPrompt:
        "A small tabby cat standing on the bed at 3 a.m., one front paw extended mid-step across grey bedding, ears alert, the sleeping person's shoulder barely visible at frame edge, bedroom dark and still.",
    } as StoryboardScene;
    expect(guardPitchVisuals([qr])).toEqual([33]);
    expect(qr.visualPrompt).toBe(
      "A small tabby cat standing on the bed at 3 a.m., one front paw extended mid-step across grey bedding, ears alert, bedroom dark and still."
    );
    expect(qr.keyThing).toBe("tabby cat");
    expect(withoutSomeone(qr.visualPrompt)).toBe(qr.visualPrompt);
  });
});

describe("the picture behind the big QR card: a worn thing off the body, the words never a fragment", () => {
  // The review of M6 on the stored films. Job 380's jewellery scan window asked for a chain "resting on
  // bare collarbone and skin"; job 357's dog film for "A dog's dark, damp nose inches from a person's
  // pant leg", which the first cut left as "A dog's dark, late afternoon light …".
  const qr = (visualPrompt: string): StoryboardScene =>
    ({ index: 16, cta: true, qrHero: true, stillImage: true, visualPrompt }) as StoryboardScene;

  it("job 380: the chain stays, the bare collarbone goes, and the prompt puts it on a stand", async () => {
    const { QR_BACKDROP_CLAUSE } = await import("./longformVideo");
    const chain = qr(
      "A slim gold chain, twenty-eight to thirty-two inches, hanging past the chest in one unbroken vertical line, resting on bare collarbone and skin in a bright airy dressing room with a large mirror and soft sheer-curtained window."
    );
    expect(guardPitchVisuals([chain])).toEqual([16]);
    expect(chain.visualPrompt).toBe(
      "A slim gold chain, twenty-eight to thirty-two inches, hanging past the chest in one unbroken vertical line."
    );
    expect(QR_BACKDROP_CLAUSE).toMatch(/jewellery, clothing, shoes — lies flat, hangs, or sits on a stand or dress form/);
    expect(buildStillPrompt(chain)).toContain(QR_BACKDROP_CLAUSE);
  });

  it("job 357: a picture of a person's leg is swapped whole, never cut to a fragment", async () => {
    const { withoutSomeone } = await import("./longformVideo");
    const words =
      "A dog's dark, damp nose inches from a person's pant leg at the entry threshold, late afternoon light soft across worn fabric, the dog's breathing steady and unhurried, the moment suspended in calm attention.";
    expect(withoutSomeone(words)).toBeUndefined();
    const nose = qr(words);
    const scenes = [{ index: 15, narration: "n", stillImage: true, visualPrompt: "A dog's water bowl by the back door" } as StoryboardScene, nose];
    guardPitchVisuals(scenes);
    expect(nose.visualPrompt).toBe("A dog's water bowl by the back door");
  });

  it("a woodwork backdrop that only names a joint or a way of making keeps its picture", () => {
    const box = qr("Close-up of a walnut box with tight finger joints at the corner, dovetails cut by hand, resting on the bench.");
    expect(guardPitchVisuals([box])).toEqual([]);
  });
});

describe("job 402 scene 26: the detail check is on, and never raises what a video costs", () => {
  // The practice films of 2026-10-18: "beverage cart in the rear rows with a nearly empty snack
  // basket" came back well stocked, and only the `detail` question — then off — saw it. The operator
  // turned it on with one condition: its redraws are capped per video, and past the cap the picture
  // ships with the fault on its card instead of costing another picture.
  const BASKET = "beverage cart in the rear rows with a nearly empty snack basket";

  it("is asked by default, of the picture's own description, and PICTURE_DETAIL_CHECK=0 turns it off", async () => {
    const { detailCheckOn, detailQuestion } = await import("./overlayTextScan");
    const was = process.env.PICTURE_DETAIL_CHECK;
    try {
      delete process.env.PICTURE_DETAIL_CHECK;
      expect(detailCheckOn()).toBe(true);
      expect(detailQuestion(BASKET)).toContain("nearly empty snack basket");
      process.env.PICTURE_DETAIL_CHECK = "0";
      expect(detailCheckOn()).toBe(false);
    } finally {
      if (was === undefined) delete process.env.PICTURE_DETAIL_CHECK;
      else process.env.PICTURE_DETAIL_CHECK = was;
    }
  });

  it("a video takes three detail redraws; a fourth flagged picture ships and its card says why", async () => {
    const { takeDetailRedraw, detailRedrawsTaken } = await import("./detailRedraws");
    const { checkFlags } = await import("./pictureCheckLog");
    const { pictureFlawWarning, sceneShippedFlaws, shippedFlaws } = await import("@shared/pictureFlaws");
    const video = 40226;
    expect([1, 2, 3, 4].map(() => takeDetailRedraw(video))).toEqual([true, true, true, false]);
    expect(detailRedrawsTaken(video)).toBe(3);
    // The flag the check put on the frame is what ships on the scene.
    const flaws = shippedFlaws(checkFlags({ detail: true }));
    expect(flaws).toEqual(["detail"]);
    const scene = pic(26, "Ask while the cart is still working its way back,", BASKET, { pictureFlaws: flaws });
    expect(sceneShippedFlaws(scene)).toEqual({ flaws: ["detail"], panel: false });
    expect(pictureFlawWarning(26, flaws, false)).toBe(
      "Scene 26: picture shipped with its subject not as described — its redraws did not clear it"
    );
    // Another video's redraws are its own.
    expect(takeDetailRedraw(40227)).toBe(true);
  });
});

describe("a look on the face shows the host's own face (the operator's decision on the audit's cause 9, 2026-10-18)", () => {
  // Diane's host look as job 309 stored it.
  const DIANE = "A slender woman with shoulder-length blonde hair pinned back, wearing a black blazer over a white top";
  const PHOTO = "https://x/host.png";

  it("Diane: a hair colour that 'will read younger' is her face, from her photo — no longer the back of a head", async () => {
    const { HOST_FACE_ONLY_SUFFIX } = await import("./longformVideo");
    const { hairLookOnFace, hostFaceLook } = await import("./hostLook");
    const scenes = [
      // job 309 scene 2
      pic(2, "The woman who spends the most money and the most time on her hair is usually the one who reads oldest in the room.", "Host's hair being styled elaborately at the bathroom counter with hair-care products nearby."),
      // job 282 scene 34
      pic(34, "A woman with gray hair that catches the light will read younger than a woman with flawlessly dyed brown hair", "host from behind, gray-blended hair catching light near the wall"),
      // job 245 scene 30
      pic(30, "A woman with gray hair that catches the light will read younger", "a strand of gray hair catching light, silver-white roots visible, held close in hand"),
    ];
    markHostBroll(scenes, { hostLook: DIANE }, PHOTO);
    for (const s of scenes) {
      expect(s.humanPresent, s.scriptText).toBe(true);
      expect(s.brollHostRef).toBe(PHOTO);
      expect(s.hostFaceShown).toBe(true);
      expect(hostFaceLook(s)).toBe(true);
      // The look is the hair, so the hair is drawn as the words give it — on her face, checked as hers.
      expect(hairLookOnFace(s)).toBe(true);
      const prompt = buildStillPrompt(s);
      expect(prompt).toMatch(/the SAME person as in the reference photo/);
      expect(prompt).toMatch(/with the look this line is about ON them/);
      expect(prompt).toMatch(/with the hair exactly as the picture's own description above gives it/);
      expect(prompt).toContain(HOST_FACE_ONLY_SUFFIX);
      expect(prompt).not.toContain(HOST_FRAMING_CLAUSE);
      expect(prompt).not.toMatch(/never shown|from behind/);
    }
    expect(scenes[1].showSubject).toBe("host, gray-blended hair catching light near the wall");
  });

  it("a lipstick shade, glasses, earrings: her face, her own hair, the piece worn at the front", async () => {
    const { hairLookOnFace } = await import("./hostLook");
    const scenes = [
      pic(1, "A blue-red lipstick brightens the whole face.", "the host wearing a blue-red lipstick, close view"),
      pic(2, "Thin wire-rimmed glasses soften the face.", "the host in thin wire-rimmed glasses at the kitchen table"),
      pic(3, "Small pearl earrings bring out your eyes.", "the host wearing small pearl stud earrings by the window"),
    ];
    markHostBroll(scenes, { hostLook: DIANE }, PHOTO);
    for (const s of scenes) {
      expect(s.hostFaceShown, s.scriptText).toBe(true);
      expect(hairLookOnFace(s)).toBe(false);
      const prompt = buildStillPrompt(s);
      expect(prompt).toMatch(/the same hair colour and hairstyle/);
      expect(prompt).not.toMatch(/doing this to their own face/);
    }
    expect(personClauseFor(scenes[1], scenes[1].showSubject!)).toMatch(/the body faces the camera so it shows there/);
    expect(personClauseFor(scenes[1], scenes[1].showSubject!)).not.toMatch(/seen from the side so it shows there/);
  });

  it("what stays as it was: a chin line, a piece at the neck, a thing's own look, a routine, someone else, a split panel", async () => {
    const { hostFaceLook } = await import("./hostLook");
    const scenes = [
      // job 354 scene 23: "the face looks tired", but a chin line — framed at the lips as round 9 made it
      pic(23, "The eye reads it together with the soft shadows under the chin, and the face looks tired.", "dark bead necklace on the chest over a navy sweater in a mirror, with shadows under the chin above it"),
      // job 240 scene 2: a necklace "flattering you" is the piece worn at the neck
      pic(2, "decides whether a necklace is flattering you or working against you.", "A long gold chain hanging low on the host's chest, catching window light, with a navy sweater nearby in the dressing room."),
      // job 309 scene 11: the hair's own look, seen as before
      pic(11, "A dye job carries one. The hair looks applied.", "close view of dyed hair with a single flat uniform tone near the mirror"),
      // a step of a routine keeps the routine's framing, hand at the face
      pic(4, "Dab it under the eyes and it brightens the whole face.", "the host dabbing concealer under her eyes"),
      // someone else with the look is someone else — never the host photo, never a face
      pic(5, "A silver bob reads younger on any woman.", "an older woman customer with a silver bob at the market stall"),
    ];
    markHostBroll(scenes, { hostLook: DIANE }, PHOTO);
    expect(scenes[0].hostFaceShown).toBeUndefined();
    expect(hostLipsCut(scenes[0])).toBe(true);
    expect(buildStillPrompt(scenes[0])).toContain(HOST_LIPS_CUT_CLAUSE);
    expect(scenes[1].hostFaceShown).toBeUndefined();
    expect(buildStillPrompt(scenes[1])).toContain(HOST_FRAMING_CLAUSE);
    expect(scenes[2].humanPresent).toBe(true);
    expect(scenes[2].hostFaceShown).toBeUndefined();
    expect(buildStillPrompt(scenes[2])).toContain(HOST_FRAMING_CLAUSE);
    expect(scenes[3].hostFaceShown).toBe(true);
    expect(hostFaceLook(scenes[3])).toBe(false);
    expect(buildStillPrompt(scenes[3])).toMatch(/doing this to their own face/);
    expect(scenes[4].otherPerson).toBeTruthy();
    expect(scenes[4].brollHostRef).toBeUndefined();
    expect(scenes[4].hostFaceShown).toBeUndefined();

    // Job 309 scene 29 was a split: its panel never draws her face beside her own talking head, and a
    // mark left from an earlier pass is taken off.
    const split = host(29, "A woman with gray hair that catches the light will read younger than a woman with flawlessly dyed brown hair that goes flat under a restaurant lamp.", {
      splitVisual: "Host's gray hair catching warm lamp light at the restaurant table",
      hostFaceShown: true,
    });
    markHostBroll([split], { hostLook: DIANE }, PHOTO);
    expect(split.brollHostRef).toBe(PHOTO);
    expect(split.hostFaceShown).toBeUndefined();
    expect(buildSplitRightScene(split).visualPrompt).toMatch(/the face not shown/);
  });

  it("the mark lives and dies with the line: a re-cut line that judges no look keeps the face out again", () => {
    const s = pic(7, "A blue-red lipstick brightens the whole face.", "the host wearing a blue-red lipstick, close view");
    markHostBroll([s], { hostLook: DIANE }, PHOTO);
    expect(s.hostFaceShown).toBe(true);
    s.scriptText = "Keep one tube in your bag.";
    markHostBroll([s], { hostLook: DIANE }, PHOTO);
    expect(s.hostFaceShown).toBeUndefined();
    expect(personClauseFor(s, s.showSubject!)).toMatch(/never shown/);
  });
});

describe("a line about the person alone is no look on the face — the face stays out (review of the cause 9 rule, 2026-10-18)", () => {
  const SCARLETT = "A slim woman in her sixties with a silver bob, wearing a navy crewneck sweater";
  const PHOTO = "https://x/host.png";

  it("Scarlett's bridge 'the three that are aging you' and a plain 'you look tired' keep the face out; the same judgement of a worn colour shows it", async () => {
    const scenes = [
      // Scarlett's full script: a bridge to the next section, about money — nothing worn named in it.
      pic(
        12,
        "Before we turn to the three that are aging you, I want to say something about money, because I know what happens the moment a woman hears the word expensive.",
        "the host at a jewelry counter looking at price tags"
      ),
      // Any channel: how the person looks, nothing put on them.
      pic(13, "Stress ages you faster than anything.", "the host rubbing her temples at the kitchen table"),
      pic(14, "You look tired.", "the host sitting at the kitchen table with a cup of coffee"),
      // The same judgement, of a colour worn near the face: a look.
      pic(15, "Navy right under the face ages you faster than anything.", "the host in a navy blouse by the window"),
    ];
    markHostBroll(scenes, { hostLook: SCARLETT }, PHOTO);
    for (const s of scenes.slice(0, 3)) {
      expect(s.brollHostRef, s.scriptText).toBe(PHOTO);
      expect(s.hostFaceShown, s.scriptText).toBeUndefined();
      expect(buildStillPrompt(s)).toContain(HOST_FRAMING_CLAUSE);
      expect(buildStillPrompt(s)).not.toMatch(/the SAME person as in the reference photo/);
    }
    expect(scenes[3].hostFaceShown).toBe(true);
    expect(buildStillPrompt(scenes[3])).toMatch(/the SAME person as in the reference photo/);
    // The prompt names no look the description does not: no glasses, earrings or lip colour on a blouse picture.
    expect(buildStillPrompt(scenes[3])).not.toMatch(/glasses|earrings|lips or cheeks/);
  });
});

describe("each paid video is rendered once (the operator, 2026-10-18)", () => {
  // Job 262 scene 16 was paid for twice and drew three images for the one still it shipped; on the
  // local renders 35 clips in 20 videos moved wrong, each was rendered again, and 11 of the second
  // clips moved wrong too. Now a clip that moves wrong becomes the still made from the frame
  // it started from, and the ledger keeps its one render. `CLIP_GLITCH_RERENDER=1` is the old way.
  const ALARM = "main smoke alarm mounted on hallway ceiling with a thin curl of smoke rising beneath it";
  const kf = "https://r2/longform/262/broll-kf-16-0-a.png";
  const scene = () =>
    pic(16, "Photoelectric sees the slow, smoldering fire substantially earlier.", ALARM, {
      hostPresent: false,
      selfMoving: true,
      audioDuration: 4.2,
      pictureUrl: kf,
    });
  // The check's own answer for the clip, decided by the real verdict code with what the loop
  // tells it (the picture moves by itself): the job 262 answers from the earlier case above.
  const SMOKE = { what: "smoke slightly denser/shifted on right", meant: true };
  const SLID = { what: "the smoke alarm slid along the ceiling", meant: false };
  const answer = (c: { what: string; meant: boolean }) =>
    JSON.stringify({ changes: [c], cover: [], hands_visible: false, untouched_moved: false, morph: false, vanished: false });
  const run = async (s: StoryboardScene, change: { what: string; meant: boolean }) => {
    const { renderSceneClip } = await import("./longformVideo");
    const renders: (string | undefined)[] = [];
    const stills: (string | undefined)[] = [];
    await renderSceneClip(s, 262, {} as any, {} as any, null, "instruction", async () => {}, undefined, {
      clips: async keyframe => {
        renders.push(keyframe);
        (s.submits ??= []).push({
          provider: "sixtynine_labs",
          at: "2026-10-18T00:00:00.000Z",
          reason: s.nextSubmitReason ?? (s.submits?.length ? "resume" : "first"),
        });
        s.nextSubmitReason = undefined;
        return [`https://r2/longform/262/clip-16-${renders.length}.mp4`];
      },
      scan: async (_url, _about, selfMoving) => parseClipGlitchVerdict(answer(change), selfMoving),
      still: async keyframe => {
        stills.push(keyframe);
        s.stillImage = true;
        s.sceneStatus = "completed";
      },
    });
    return { renders, stills };
  };

  it("job 262 scene 16: the alarm sliding makes it the still of its own start frame — one paid render, no new image", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "");
    try {
      const s = scene();
      const { renders, stills } = await run(s, SLID);
      expect(renders).toHaveLength(1);
      expect(stills).toEqual([kf]);
      expect(s.submits?.map(x => x.reason)).toEqual(["first"]);
      expect(s.submits?.[0].movedWrong).toBe("the smoke alarm slid along the ceiling");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a clip whose smoke is all that changes is kept — the check knows what is meant to move", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "");
    try {
      const s = scene();
      const { renders, stills } = await run(s, SMOKE);
      expect(renders).toHaveLength(1);
      expect(stills).toEqual([]);
      expect(s.clipUrls).toEqual(["https://r2/longform/262/clip-16-1.mp4"]);
      expect(s.stillImage).toBeFalsy();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("CLIP_GLITCH_RERENDER=1: the second render from the same frame comes back, ledgered as a glitch re-render", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "1");
    try {
      const s = scene();
      const { renders, stills } = await run(s, SLID);
      expect(renders).toEqual([undefined, kf]);
      expect(stills).toEqual([kf]); // it moved wrong again: the still, never a third render
      expect(s.submits?.map(x => x.reason)).toEqual(["first", "glitch"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the film never ends on a host shot under a second (the audit, 2026-10-18)", () => {
  // A goodbye on the host under a second goes to the beat before it, so what was on screen runs to
  // the end (practice jobs 45 and 297). The audit's 21 production films all had it right after the
  // end CTA's big QR card, which it never joins (last case). Scenes and ranges are the jobs' own.
  const at = (index: number, kind: "H" | "P", from: number, to: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
    ({
      index,
      scriptText,
      narration: scriptText,
      visualPrompt: `picture ${index}`,
      showSubject: kind === "P" ? `picture ${index}` : undefined,
      hostPresent: kind === "H" ? true : undefined,
      stillImage: kind === "P" ? true : undefined,
      narrationStartSec: from,
      narrationEndSec: to,
      audioDuration: to - from,
      audioUrl: `https://example.com/${index}.mp3`,
      ...over,
    }) as StoryboardScene;

  it("job 45: Hannah's 'not at the beginning.' (0.80 s on the host) ends on the picture of its sentence", async () => {
    const { enforcePlanRules } = await import("./planGate");
    const scenes = [
      at(1, "H", 0, 6.00025, "There is a bag somewhere in your house that holds the end of every project you have ever finished.", { hostOpener: true }),
      at(2, "P", 6.00025, 9.94406, "A yard of green in one corner, half a ball of rust in another,"),
      at(3, "P", 9.94406, 13.0785, "and not one of them long enough to make anything on its own."),
      at(4, "P", 13.0785, 15.8982, "So the bag sits, and it grows,"),
      at(5, "P", 15.8982, 20.9164, "and every so often you look at it and close it again. But there is a blanket"),
      at(6, "P", 20.9164, 22.8738, "that was built for exactly that bag,"),
      at(7, "P", 22.8738, 27.5443, "and the whole thing turns on one decision you make at the end of every square,"),
      at(8, "H", 27.5443, 28.342, "not at the beginning."),
    ];
    const r = enforcePlanRules(scenes, { faceImageUrl: "https://example.com/hannah.jpg", hostName: "Hannah Yoder" } as any);
    const last = r.scenes.at(-1)!;
    expect(last.hostPresent).toBeFalsy();
    expect(last).toMatchObject({
      showSubject: "picture 7",
      scriptText: "and the whole thing turns on one decision you make at the end of every square, not at the beginning.",
      narrationStartSec: 22.8738,
      narrationEndSec: 28.342,
    });
    // It used to become an 8.9 s host take that took "But there is a blanket that was built for
    // exactly that bag," away from the pictures.
    expect(r.scenes.at(-2)?.scriptText).toBe("that was built for exactly that bag,");
    expect(r.unresolved.filter(f => /closing host shot/.test(f.detail))).toEqual([]);
  });

  it("job 297: Pearl's 'This is Pearl Parker.' (0.90 s) joins the line before it, and the name stays on camera", async () => {
    const { checkPlan, closingFoldTarget, enforcePlanRules } = await import("./planGate");
    const params = { faceImageUrl: "https://example.com/pearl.jpg", hostName: "Pearl Parker" } as any;
    const scenes = [
      at(1, "P", 177.495, 182.009, "Knot it on the inside, weave the ends away, and turn it right side out.", { wordCut: true }),
      at(2, "P", 182.009, 185.352, "Every stitch in that hat is a knit or a purl,", { wordCut: true, shotGroup: 37 }),
      at(
        3,
        "P",
        185.352,
        198.135,
        "and on a cold morning, your ears won't have the faintest idea it came off a loom. For a new slow, beginner friendly lesson every week, subscribe to Pearl Parker, then tell me in the comments whose head your first hat is going on.",
        { wordCut: true, shotGroup: 37 }
      ),
      at(4, "H", 198.135, 199.035, "This is Pearl Parker.", { hostIntro: true }),
    ];
    expect(checkPlan(scenes, params).findings).toContainEqual(
      expect.objectContaining({ rule: 7, scene: 4, detail: expect.stringMatching(/^closing host shot under 1 s \(0\.90s\)/) })
    );
    expect(closingFoldTarget(scenes, 3)).toBe(2);
    const r = enforcePlanRules(scenes, params);
    const last = r.scenes.at(-1)!;
    expect(r.scenes).toHaveLength(3);
    // The words go to the picture first; the line then names the host, so it is the host's take
    // (the self-introduction rule), never a 0.9 s blink.
    expect(r.fixes.slice(0, 2)).toEqual([
      "closing host shot at scene 4 (0.90s) folded into the picture before it, which runs to the end",
      "introduction put on camera at scene 3",
    ]);
    expect(last).toMatchObject({ hostPresent: true, hostIntro: true, narrationStartSec: 185.352, narrationEndSec: 199.035 });
    expect(last.scriptText).toMatch(/whose head your first hat is going on\. This is Pearl Parker\.$/);
  });

  it("job 179 (the audit's shape): 'See you at the bench.' (0.78 s) after the end QR card joins the card, which runs to the end", async () => {
    // 25 of 141 production films end this way: the scan window under the big card, then a goodbye
    // under a second on the host. The operator chose the card running to the end under the goodbye
    // (no paid render, no flash of a face, the CTA's order unchanged).
    const { closingFoldTarget, enforcePlanRules } = await import("./planGate");
    const cta = { cta: true, ctaIndex: 0 } as const;
    const scanWindow =
      "Point your phone's camera at the QR code on the screen, or tap the link down in the description. And if turning cheap lumber into real money is your kind of weekend, subscribe to Hank Hardwood and tell me in the comments which stain you'd reach for first.";
    const scenes = [
      at(192, "H", 988.12625, 993.122063, "every one built from cheap box-store lumber and the basic tools already on your bench.", { ...cta, qrCorner: true }),
      at(193, "P", 993.122063, 1005.399875, scanWindow, { ...cta, qrHero: true, qrTail: true }),
      at(194, "H", 1005.399875, 1006.184, "See you at the bench."),
    ];
    expect(closingFoldTarget(scenes, 2)).toBe(1);
    const r = enforcePlanRules(scenes, { faceImageUrl: "https://example.com/hank.jpg", hostName: "Hank Hardwood" } as any);
    const last = r.scenes.at(-1)!;
    expect(last).toMatchObject({ qrHero: true, qrTail: true, narrationEndSec: 1006.184 });
    expect(last.hostPresent).toBeFalsy();
    expect(last.scriptText).toMatch(/See you at the bench\.$/);
    expect(r.unresolved.some(u => /^closing host shot/.test(u.detail))).toBe(false);
  });

  it("only the end card's own release beat takes the goodbye: a host take or a long goodbye does not", async () => {
    const { closingFoldTarget } = await import("./planGate");
    const cta = { cta: true, ctaIndex: 0 } as const;
    // the card is a corner over the host (no release beat): never folded into
    const corner = [
      at(1, "P", 0, 10, "A plain picture line here.", {}),
      at(2, "H", 10, 20, "Grab it with the link below.", { ...cta, qrCorner: true }),
      at(3, "H", 20, 20.8, "Bye now."),
    ];
    expect(closingFoldTarget(corner, 2)).not.toBe(1);
    // a QR beat that is not the block's release beat does not take it either
    const notTail = [
      at(1, "P", 0, 10, "Point your phone at the code.", { ...cta, qrHero: true }),
      at(2, "H", 10, 10.8, "Bye now."),
    ];
    expect(closingFoldTarget(notTail, 1)).toBe(-1);
  });
});

describe("job 409 scene 28: a picture of the host is never kept past the host check (round 13)", () => {
  // Gideon's job 409: "The essay is called On the Shortness of Life…" drew the host reading face on at
  // the study desk for 11.6 s — job 401 scene 20's picture again, the one the face check was built
  // for. Its two draws came back "staged", "staged", and "the same faults twice in a row" kept the
  // second before the host check ran. Scene 19 of the same film shows the check works when reached:
  // its first draw was refused "face shown" and drawn again turned away.
  const PHOTO = "https://x/host.png";
  const reader = () =>
    pic(
      28,
      "The essay is called On the Shortness of Life, and it opens by picking a fight with its own title. Everyone complains that life is too short, Seneca says.",
      "the host reading a book at the desk in the study",
      {
        humanPresent: true,
        brollHostRef: PHOTO,
        brollHostLook:
          "A man in his sixties with fair skin, short gray hair, wire-rimmed glasses, wearing a gray sweater over a white collared shirt",
      }
    );

  it("scene 28 is a picture the host check must pass; a picture of nobody or of someone else is not", async () => {
    const { hostCheckDue } = await import("./longformVideo");
    expect(hostCheckDue(reader(), false)).toBe(true);
    // A look on the host's own face is one too: its face is allowed, never a stranger's.
    expect(hostCheckDue({ ...reader(), hostFaceShown: true }, false)).toBe(true);
    // Drawn with nobody in it (no host photo sent), someone else's picture, a thing alone.
    expect(hostCheckDue(reader(), true)).toBe(false);
    expect(hostCheckDue({ ...reader(), otherPerson: "a passenger" }, false)).toBe(false);
    expect(hostCheckDue({ ...reader(), humanPresent: false }, false)).toBe(false);
    expect(hostCheckDue({ ...reader(), brollHostRef: undefined }, false)).toBe(false);
  });

  it("'staged' twice on it is kept only after the host check; the same repeat on a picture of no one is kept as before", async () => {
    const { repeatedFaultsMove } = await import("./longformVideo");
    const host = { unchecked: false, hostUnchecked: true };
    const thing = { unchecked: false, hostUnchecked: false };
    expect(repeatedFaultsMove("staged", "staged", host)).toBe("check the host");
    expect(repeatedFaultsMove("staged", "staged", thing)).toBe("keep");
    // Job 343's phone screen, "writing, brand, staged" each time: kept on the spot, as before.
    expect(repeatedFaultsMove("writing+brand or clutter+staged", "writing+brand or clutter+staged", thing)).toBe("keep");
    // Not a repeat, a detail alone, a check that could not run, a clean frame: on to the checks below.
    expect(repeatedFaultsMove("staged", "wrong place", host)).toBe("go on");
    expect(repeatedFaultsMove("detail", "detail", thing)).toBe("go on");
    expect(repeatedFaultsMove("staged", "staged", { unchecked: true, hostUnchecked: true })).toBe("go on");
    expect(repeatedFaultsMove("", "", host)).toBe("go on");
  });

  it("refused there, it takes the host check's own moves: turned away, then nobody — never kept", async () => {
    const { hostPictureMove } = await import("./longformVideo");
    const faceOn = { same: true, face: true };
    expect(hostPictureMove(faceOn, false, 0, false)).toEqual({ move: "redraw", why: "face", turnAway: true });
    // A fallback refused when the draws ran out: drawn with nobody in it, one draw past the budget.
    expect(hostPictureMove(faceOn, false, 0, true)).toEqual({ move: "nobody", why: "face", turnAway: true });
    expect(hostPictureMove({ same: true, face: false }, false, 0, true)).toEqual({ move: "keep" });
  });
});
describe("a redraw drops what caused its fault (round 13, jobs 408 and 410)", () => {
  // The panels and pictures as stored on jobs 408 and 410. Their redraws were sent exactly what had
  // made them miss: the same memory pictures, the same memory camera, the far near-copy camera.
  const TOILET_LOOK =
    "a white porcelain toilet, oval bowl, curved trapway inside its base visible as a smooth porcelain contour at the bowl's rear, closed lid often up";
  const S10 = "https://r2/longform/408/still-src-10.png";
  const S14 = "https://r2/longform/408/still-src-14.png";
  const S18 = "https://r2/longform/408/still-src-18.png";
  const SWAB_PANEL =
    "close view of a single white cotton swab with cotton tufts on both ends lying on pale beige tile floor beside the base of a white porcelain toilet";
  const SWAB_IN_BOWL =
    "looking down into the toilet bowl: a single white cotton swab lying sideways across the dark drain opening at the bottom, under clear water";
  const s19 = (over: Partial<StoryboardScene> = {}) =>
    pic(19, "Good design. But a stiff stick does not always follow a curve. It can turn sideways and catch across the passage, like a bar across a doorway.", SWAB_IN_BOWL, {
      keyThing: "toilet",
      partOf: "toilet",
      memoryRefUrls: [S14, S18],
      memoryRefScenes: [{ index: 14, own: true }, { index: 18, own: true }],
      memoryRightBefore: 1,
      memoryView: PART_VIEW,
      memoryWordsLook: TOILET_LOOK,
      ...over,
    });

  it("408-16 and 408-19 are pictures a far camera would lose; a wide view is not", async () => {
    const { smallSubject } = await import("./pictureMemory");
    expect(smallSubject(host(16, "Cotton swabs. The little stick with cotton on both ends.", { splitVisual: SWAB_PANEL }))).toBe(true);
    expect(smallSubject(s19())).toBe(true); // a part close-up
    // Job 410 scene 20: "a small plastic cup of orange juice beside a juice can on the beverage cart".
    expect(smallSubject(pic(20, "Juice works the same way.", "a small plastic cup of orange juice beside a juice can on the beverage cart"))).toBe(true);
    expect(smallSubject(pic(1, "n", "a little bird on the feeder"))).toBe(true);
    // Job 403 scene 14's pipe run, a garden, and "a little" that is no size.
    expect(smallSubject(pic(14, "n", "grey PVC pipe network running beneath the house toward the street"))).toBe(false);
    expect(smallSubject(pic(2, "n", "the whole backyard garden with raised beds along the fence"))).toBe(false);
    expect(smallSubject(pic(3, "n", "a red barn seen a little to one side under a grey sky"))).toBe(false);
  });

  it("408-16: a small subject's near-copy redraws never take the far camera; any other keeps its turn", async () => {
    const { nearCopyCameraIndex, FAR_CAMERA, REDRAW_CAMERAS } = await import("./pictureVariety");
    expect(REDRAW_CAMERAS[FAR_CAMERA]).toMatch(/much further back, the whole place around it and the subject small in it/);
    // The swab panel (no camera of its own): a close-up, then the other side — never "much further back".
    expect([nearCopyCameraIndex(1, -1, true), nearCopyCameraIndex(2, -1, true)]).toEqual([0, 2]);
    // A continuation drawn close up: the other side, and never its own camera.
    expect([nearCopyCameraIndex(1, 0, true), nearCopyCameraIndex(2, 0, true)]).toEqual([2, 2]);
    // Any other picture: exactly the turn it had (`own` + k), the far camera included.
    for (const own of [-1, 0, 1, 2]) for (const k of [1, 2]) expect(nearCopyCameraIndex(k, own, false)).toBe((own + k + 3) % 3);
  });

  it("408-16: a redraw for a subject the check could not find swaps the far camera for a near one", async () => {
    const { withoutFarCamera, differentPictureClause, DIFFERENT_PICTURE_CLAUSE, REDRAW_VIEWS, FAR_CAMERA } = await import("./pictureVariety");
    const far = `${SWAB_PANEL}. ${differentPictureClause(FAR_CAMERA)}`;
    const near = withoutFarCamera(far, 2);
    expect(near).not.toContain(REDRAW_VIEWS[FAR_CAMERA]);
    expect(near).toContain(REDRAW_VIEWS[2]);
    expect(near).toContain(DIFFERENT_PICTURE_CLAUSE); // still told to differ from the copy
    // A continuation drawn from words with the far camera says it the same way.
    expect(withoutFarCamera(`${SWAB_PANEL} ${REDRAW_VIEWS[FAR_CAMERA]}`, 0)).toBe(`${SWAB_PANEL} ${REDRAW_VIEWS[0]}`);
    // No far camera: unchanged.
    const close = `${SWAB_PANEL}. ${differentPictureClause(0)}`;
    expect(withoutFarCamera(close, 2)).toBe(close);
  });

  it("410-18, 410-20, 408-5: a missing or detail redraw drops the memory pictures — never a screen's item photo", async () => {
    const { memoryDropsOnRedraw, memoryToWords } = await import("./longformVideo");
    const { BACKGROUND_VIEW, SCREEN_ITEM_VIEW } = await import("./pictureMemory");
    const panel = {
      ...buildSplitRightScene(
        host(18, "spent nursing a thimble of ginger ale.", {
          splitVisual: "A plastic cup half-filled with ice and ginger ale sits on an airplane tray table, the cup tilted slightly as if just set down mid-sip.",
          keyThing: "soda cup",
        })
      ),
      memoryRefUrls: ["https://r2/longform/410/still-src-7.png"],
      memoryWordsLook: "a clear plastic cup packed with ice, filled about halfway with soda",
    } as StoryboardScene;
    expect(memoryDropsOnRedraw(panel)).toBe(true);
    expect(memoryToWords(panel)).toMatchObject({ memoryRefUrls: undefined, memoryView: undefined, keyThingLook: panel.memoryWordsLook });
    const juice = pic(20, "Juice works the same way.", "a small plastic cup of orange juice beside a juice can on the beverage cart", {
      keyThing: "beverage cart",
      memoryRefUrls: ["https://r2/longform/410/still-src-3.png"],
      memoryView: BACKGROUND_VIEW,
    });
    expect(memoryDropsOnRedraw(juice)).toBe(true);
    // A screen's reference is only the photo inside its listing (Dale's job 306); nothing to drop otherwise.
    expect(memoryDropsOnRedraw({ ...juice, memoryView: SCREEN_ITEM_VIEW })).toBe(false);
    expect(memoryDropsOnRedraw({ ...juice, memoryRefUrls: undefined })).toBe(false);
  });

  it("a continuation keeps its near camera when its memory is dropped; any other view goes with the memory", async () => {
    const { redrawCameraClause } = await import("./longformVideo");
    const { REDRAW_CAMERAS, REDRAW_VIEWS } = await import("./pictureVariety");
    const { BACKGROUND_VIEW } = await import("./pictureMemory");
    const cont = (view: string) => s19({ partOf: undefined, memoryView: view, memoryContinues: true });
    // Job 405 scene 8's lesson: drawn from nearly the words it continues and no camera, it is that picture again.
    expect(redrawCameraClause(cont(REDRAW_CAMERAS[0]))).toBe(` ${REDRAW_VIEWS[0]}`);
    expect(redrawCameraClause(cont(REDRAW_CAMERAS[2]))).toBe(` ${REDRAW_VIEWS[2]}`);
    // …but never the far one: the next near camera instead.
    expect(redrawCameraClause(cont(REDRAW_CAMERAS[1]))).toBe(` ${REDRAW_VIEWS[2]}`);
    expect(redrawCameraClause(cont(BACKGROUND_VIEW))).toBe("");
    expect(redrawCameraClause(cont(PART_VIEW))).toBe("");
    expect(redrawCameraClause(s19())).toBe("");
  });

  it("408-19: the near copy of scene 18 drops scene 18 and keeps the toilet's first picture", async () => {
    const { withoutMemoryRef, memoryClause: clauseOf } = await import("./longformVideo");
    const before = s19();
    expect(clauseOf(before)).toMatch(/Reference image 2 is the picture shown RIGHT BEFORE this one/);
    const fields = withoutMemoryRef(before, 18)!;
    expect(fields).toMatchObject({
      memoryRefUrls: [S14],
      memoryRefScenes: [{ index: 14, own: true }],
      memoryRightBefore: undefined,
      memoryContinues: undefined,
      memoryView: PART_VIEW,
      memoryOthersOnly: undefined,
      memoryWordsLook: TOILET_LOOK,
      keyThingLook: undefined,
    });
    const after = { ...before, ...fields };
    expect(clauseOf(after)).toMatch(/^ The first reference image shows the whole toilet\. This picture is a CLOSE-UP/);
    expect(clauseOf(after)).not.toMatch(/RIGHT BEFORE/);
    // Dropping the other one moves the picture just shown to the first place.
    expect(withoutMemoryRef(before, 14)).toMatchObject({ memoryRefUrls: [S18], memoryRightBefore: 0 });
    // Not one of its references, or references that say nothing of what they are: nothing changes.
    expect(withoutMemoryRef(before, 12)).toBeUndefined();
    expect(withoutMemoryRef({ ...before, memoryRefScenes: undefined }, 18)).toBeUndefined();
  });

  it("dropping the last picture of its own thing draws it by its written look; dropping the last one draws it from words", async () => {
    const { withoutMemoryRef, memoryToWords, memoryClause: clauseOf } = await import("./longformVideo");
    // A soda can drawn from its own first picture and the cart's picture that also shows the cup.
    const can = pic(16, "n", "a soda can on the beverage cart beside a cup of soda", {
      keyThing: "soda can",
      otherKeyThings: ["beverage cart", "soda cup"],
      memoryRefUrls: ["https://r2/4.png", "https://r2/3.png"],
      memoryRefScenes: [{ index: 4, own: true }, { index: 3, shows: ["beverage cart"] }],
      memoryView: "a close view of one part of it, filling most of the frame",
      memoryNotShown: ["soda cup"],
      memoryWordsLook: "a slim aluminum can, silver and red body, small pull tab on top",
    });
    const others = withoutMemoryRef(can, 4)!;
    expect(others).toMatchObject({
      memoryRefUrls: ["https://r2/3.png"],
      memoryOthersOnly: true,
      keyThingLook: "a slim aluminum can, silver and red body, small pull tab on top",
      memoryWordsLook: undefined,
      memoryNotShown: ["soda cup"],
    });
    expect(clauseOf({ ...can, ...others })).toMatch(/this exact beverage cart, seen earlier in this video/);
    expect(clauseOf({ ...can, ...others })).toMatch(/does NOT show the soda can: draw it from this picture's own words/);
    // Without the cart's picture the cart is no longer shown by any reference.
    expect(withoutMemoryRef(can, 3)).toMatchObject({ memoryRefUrls: ["https://r2/4.png"], memoryNotShown: ["beverage cart", "soda cup"] });
    const one = { ...can, memoryRefUrls: ["https://r2/4.png"], memoryRefScenes: [{ index: 4, own: true as const }] };
    expect(withoutMemoryRef(one, 4)).toEqual(memoryToWords(one));
    // A continuation whose continued picture is dropped loses the camera it took to stand apart from it.
    const { REDRAW_CAMERAS } = await import("./pictureVariety");
    const cont = s19({ partOf: undefined, memoryView: REDRAW_CAMERAS[0], memoryContinues: true });
    expect(withoutMemoryRef(cont, 18)).toMatchObject({ memoryView: undefined, memoryContinues: undefined, memoryRightBefore: undefined });
    expect(withoutMemoryRef(cont, 14)).toMatchObject({ memoryView: REDRAW_CAMERAS[0], memoryContinues: true, memoryRightBefore: 0 });
  });

  it("at render each reference says which scene it is, whether it is of its own thing, and what else it shows", async () => {
    const { attachMemory, memoryFor, memoryView } = await import("./pictureMemory");
    const { memoryFields } = await import("./longformVideo");
    const b = [
      pic(10, "n", "white porcelain toilet seen from the side beside the small white bin", {
        keyThing: "toilet",
        otherKeyThings: ["bin"],
        pictureUrl: S10,
      }),
      pic(18, "That curve is called the trapway.", "looking down into the white porcelain toilet bowl at still clear water sitting over the dark rear drain opening at the bottom", {
        keyThing: "toilet",
        partOf: "toilet",
        pictureUrl: S18,
      }),
      pic(19, "Good design.", SWAB_IN_BOWL, { keyThing: "toilet", partOf: "toilet", otherKeyThings: ["bin"] }),
    ];
    attachMemory(b, [b[2]]);
    const m = await memoryFor(b[2], 0);
    expect(m.urls).toEqual([S10, S18]);
    expect(m.refs).toEqual([{ index: 10, own: true, shows: ["bin"] }, { index: 18, own: true }]);
    const fields = memoryFields(m, memoryView(b[2]));
    expect(fields.memoryRefScenes).toEqual(m.refs);
    // References that do not each say what they are are not described at all.
    expect(memoryFields({ ...m, refs: m.refs!.slice(0, 1) }, undefined).memoryRefScenes).toBeUndefined();
  });
});

/**
 * THE STAGED REDRAW IS DRAWN PLAINER (round 13, the review of jobs 409 and 410). Its one redraw resent
 * the same prompt, so a picture whose own words ask for the staged look came back staged and shipped
 * flagged: 409-25's glossy marble throne hall, 409-22's golden oil-lamp glow, 410-13's air-to-air
 * airliner, 410-10's advert pose at the galley. `plainLookRedraw` changes the prompt on that redraw.
 */
describe("a staged redraw changes what the line never asked for (jobs 409, 410)", () => {
  const ADVISOR_LINE =
    "He was one of the richest men in the empire, an advisor standing one step from the throne, buried under exactly the kind of obligations we are about to talk about —";
  const advisor = () =>
    pic(25, ADVISOR_LINE, "a wealthy man in a fine off-white toga draped over his left shoulder, standing beside a marble throne in a grand hall, seen from behind", {
      visualPrompt:
        "A wealthy man in a fine off-white toga draped over his left shoulder, standing beside a marble throne in a grand hall, viewed from behind.",
      otherPerson: "Seneca, an imperial advisor",
      humanPresent: true,
    });
  const redraw = async (s: StoryboardScene, prompt: string, o: Record<string, unknown> = {}) => {
    const { plainLookRedraw } = await import("./longformVideo");
    return plainLookRedraw(s, prompt, { line: s.scriptText, ordinaryPrompt: true, ...o });
  };

  it("409-25: the marble and the grand hall leave the prompt where they sit; the throne the line says, and every other clause, stay", async () => {
    const { PLAIN_LOOK_START } = await import("./plainLook");
    const s = advisor();
    const before = buildStillPrompt(s);
    const r = await redraw(s, before);
    expect(before).toContain("marble throne in a grand hall");
    expect(r.prompt).not.toMatch(/\bmarble\b|\bgrand\b/);
    expect(r.prompt).toContain("standing beside a throne in a hall");
    expect(r.fields).toEqual({
      showSubject:
        "a wealthy man in a fine off-white toga draped over his left shoulder, standing beside a throne in a hall, seen from behind",
      visualPrompt:
        "A wealthy man in a fine off-white toga draped over his left shoulder, standing beside a throne in a hall, viewed from behind.",
    });
    // Built fresh from the new words, the prompt is the one swapped in place — plus the clause.
    expect(r.prompt).toBe(`${buildStillPrompt({ ...s, ...r.fields })} ${r.prompt.slice(r.prompt.indexOf(PLAIN_LOOK_START))}`);
    // Asked twice, the clause is never added twice.
    const again = await redraw({ ...s, ...r.fields }, r.prompt);
    expect(again.prompt.split(PLAIN_LOOK_START)).toHaveLength(2);
  });

  it("410-13: 'the flight' — the airliner seen from beside it is drawn as a passenger sees it, its wing through the window", async () => {
    const { WINDOW_VIEW } = await import("./plainLook");
    const s = pic(13, "the flight,", "a passenger jet flying above the clouds", {
      visualPrompt: "A commercial passenger jet flying above a layer of white clouds, seen from the side against blue sky.",
      listCut: true,
    });
    const r = await redraw(s, buildStillPrompt(s));
    expect(r.fields.showSubject).toBe(`the wing of a passenger jet, ${WINDOW_VIEW}, flying above the clouds`);
    expect(r.prompt).toContain(`The wing of a commercial passenger jet, ${WINDOW_VIEW}`);
    expect(r.prompt).not.toContain("seen from the side");
  });

  it("410-10: nothing in the galley picture's words asks for the look — they stay word for word, the clause alone is added", async () => {
    const { plainLookClause } = await import("./plainLook");
    const s = pic(10, "so travelers like us can stop learning these things the hard way.", "host at galley counter reviewing notes on a clipboard", {
      visualPrompt: "Bare weathered hands at a galley metal counter holding and reviewing a clipboard with papers.",
      humanPresent: true,
      brollHostLook: "a woman in her forties in a navy blazer",
    });
    const before = buildStillPrompt(s);
    const r = await redraw(s, before);
    expect(r.fields).toEqual({});
    expect(r.prompt).toBe(`${before} ${plainLookClause([])}`);
  });

  it("light the line names stays, the clause names it; a lamp only the picture added goes (409-22)", async () => {
    const candle = pic(7, "We ate dinner by candlelight that night.", "a kitchen table set for two, lit by a single candle");
    const kept = await redraw(candle, buildStillPrompt(candle));
    expect(kept.fields).toEqual({});
    expect(kept.prompt).toMatch(/the light the words name \("candlelight", "night"\)/);
    const seneca = pic(
      22,
      "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus,",
      "a man in an off-white wool toga draped over his left shoulder in deep folds, writing on a scroll with a reed pen by lamplight, seen from the side",
      {
        visualPrompt:
          "An off-white wool toga draped over a left shoulder in deep folds, a reed pen in hand writing on a scroll, lamplight on the face of the scroll, seen from the side.",
        otherPerson: "Seneca, a Roman writer",
        humanPresent: true,
        blurPrint: true,
      }
    );
    const gone = await redraw(seneca, buildStillPrompt(seneca));
    expect(gone.prompt).not.toMatch(/lamplight/);
    expect(gone.prompt).toMatch(/no glow from a lamp, candle or fire/);
  });

  it("job 412 scene 25: the key thing's written look loses its golden light in the prompt, never its wilderness", async () => {
    const s = pic(25, "when small prey is out moving around", "a wild cat stalking low through scattered brush across the dawn-lit wild landscape toward a small mouse", {
      visualPrompt:
        "Wild cat crouched low and moving through scattered dry brush across an open dawn-lit wilderness, golden low light on distant hills, a small mouse ahead on the ground",
      keyThing: "wild landscape",
      keyThingLook: "an open dawn-lit wilderness with low golden light, scattered brush and distant hills, calm and empty of people",
    });
    const before = buildStillPrompt(s);
    expect(before).toContain("HOW THE WILD LANDSCAPE LOOKS in every picture of this video: an open dawn-lit wilderness with low golden light");
    const r = await redraw(s, before);
    // ("no golden glow" stays: the fixed look clause and the redraw's own clause refuse it.)
    expect(r.prompt).not.toMatch(/golden low light|low golden light/i);
    expect(r.prompt).toContain("HOW THE WILD LANDSCAPE LOOKS in every picture of this video: an open dawn-lit wilderness with low light, scattered brush");
    // The look itself is not rewritten on the scene: other pictures of the thing keep it.
    expect(r.fields).not.toHaveProperty("keyThingLook");
  });

  it("every other clause a redraw added stays: drawn with nobody in it, from a caller's own visual, or reworded past finding", async () => {
    const { PERSON_FREE_FALLBACK } = await import("./longformVideo");
    const { PLAIN_LOOK_START } = await import("./plainLook");
    const s = advisor();
    const nobody = `${buildStillPrompt({ ...s, humanPresent: false })} ${PERSON_FREE_FALLBACK}`;
    const r1 = await redraw(s, nobody, { personFree: true });
    expect(r1.prompt).toContain(PERSON_FREE_FALLBACK);
    expect(r1.prompt).toContain("standing beside a throne in a hall");
    // A caller's own visual (a keyframe's softened clip text) changes with it; the scene's own stays.
    const own = "A man in a toga beside a marble throne in a grand hall.";
    const r2 = await redraw(s, buildStillPrompt(s, false, own), { visualOverride: own });
    expect(r2.visualOverride).toBe("A man in a toga beside a throne in a hall.");
    expect(r2.fields).not.toHaveProperty("visualPrompt");
    expect(r2.prompt).toContain("A man in a toga beside a throne in a hall.");
    // Words nowhere to be found: built again from the new ones.
    const r3 = await redraw(s, "a prompt reworded past finding its words");
    expect(r3.prompt.startsWith(buildStillPrompt({ ...s, ...r3.fields }))).toBe(true);
    expect(r3.prompt).toContain(PLAIN_LOOK_START);
  });

  it("on a softened content-policy prompt only the clause is added — its words are never rebuilt", async () => {
    const { plainLookClause } = await import("./plainLook");
    const s = advisor();
    const softened = "A man standing in a hall, seen from behind.";
    const r = await redraw(s, softened, { ordinaryPrompt: false });
    expect(r.prompt).toBe(`${softened} ${plainLookClause([])}`);
    expect(r.fields).toEqual({});
  });
});

/**
 * THE STAGED REDRAW TAKES OUT ONLY WHAT ITS LINE NEVER ASKED FOR — AND NOTHING THE PICTURE IS (review of
 * round 13's staged redraw, over every stored description): its first rules took "glowing" off a lit
 * lantern and a wood-burning pen's tip, turned "no golden light" into "no light", made "a shoji lantern
 * lit from within" "a shoji from within", stripped a velvet jewellery box, a marbled roast and a whole
 * film's marble bathroom counter, and would have rewritten an operator's verbatim prompt. Each case is
 * a stored picture as it was written.
 */
describe("a staged redraw never takes what the picture is (the stored films, round 13 review)", () => {
  const redraw = async (s: StoryboardScene) => {
    const { plainLookRedraw } = await import("./longformVideo");
    return plainLookRedraw(s, buildStillPrompt(s), { line: s.scriptText, ordinaryPrompt: true });
  };

  it("job 146 scene 71: the lit lantern a channel makes keeps its glow, and the clause names its light", async () => {
    const s = pic(71, "and it only beat the panel by about 4 bucks an hour.", "shoji-style lantern glowing warm on the nightstand, closer detail", {
      keyThing: "shoji lantern",
    });
    const r = await redraw(s);
    expect(r.fields).toEqual({});
    expect(r.prompt).toContain("shoji-style lantern glowing warm on the nightstand");
    expect(r.prompt).toMatch(/the light the words name \("lantern"\)/);
    expect(r.prompt).not.toMatch(/no glow from a lamp, candle or fire/);
  });

  it("job 110 scene 111 and job 146 scene 140: a tool's glowing tip and a 'no golden light' stay word for word", async () => {
    const pen = pic(
      111,
      "because every wobble from a wood-burning pen stays right there in the wood.",
      "hands burning a line into pale pine with a wood-burning pen",
      {
        visualPrompt:
          "Weathered bare hands grip a wood-burning pen with glowing copper tip pressed against pale pine, scorching a dark line into the grain.",
      }
    );
    expect((await redraw(pen)).fields).toEqual({});
    const saw = pic(140, "I cut all of it with the same pull saw from the lattice panel.", "hands cutting a pine board with a pull saw", {
      visualPrompt: "Weathered bare hands grip a thin-bladed pull saw. Flat indoor daylight, neutral gray-white tone, no golden light.",
    });
    expect((await redraw(saw)).fields).toEqual({});
  });

  it("jobs 222 and 395: a marble bathroom counter and a velvet jewellery box are what those things are", async () => {
    const counter = pic(12, "Root to tip, one flat color, refreshed every four weeks, forever.", "hair dyed one flat dark tone, in the vanity mirror", {
      visualPrompt:
        "Hair dyed in a single flat dark tone from root to tip, reflected in the oval vanity mirror above the white marble bathroom counter, the color uniform and even throughout.",
    });
    expect((await redraw(counter)).fields).toEqual({});
    const pearls = pic(10, "The mistake with pearls is saving them.", "pearl strand necklace tucked away in a closed velvet jewelry box in a drawer");
    expect((await redraw(pearls)).fields).toEqual({});
  });

  it("an operator's verbatim prompt renders as typed — only the clause is added", async () => {
    const typed = "A writing desk by candlelight beside a marble throne in a grand hall.";
    const s = pic(25, "He was one of the richest men in the empire, an advisor standing one step from the throne,", typed, {
      visualPromptSeed: typed,
    });
    const before = buildStillPrompt(s);
    const r = await redraw(s);
    expect(r.fields).toEqual({});
    expect(r.prompt.startsWith(before)).toBe(true);
    expect(r.prompt).toMatch(/the light the words name \("candlelight"\)/);
  });

  it("409-25 as before: the pipeline's own grand words still go", async () => {
    const s = pic(
      25,
      "He was one of the richest men in the empire, an advisor standing one step from the throne,",
      "a wealthy man in a fine off-white toga, standing beside a marble throne in a grand hall, seen from behind"
    );
    expect((await redraw(s)).fields.showSubject).toBe("a wealthy man in a fine off-white toga, standing beside a throne in a hall, seen from behind");
  });
});

describe("no near copy of the picture a picture was drawn from (round 13, jobs 408-410)", () => {
  // The rows as the films stored them (local jobs 408-410), and hashes as strings of 64 bits.
  const ones = (n: number, from = 0) =>
    Array.from({ length: 64 }, (_, i) => (i >= from && i < from + n ? "1" : "0")).join("");
  const ref = (index: number, own = true) => ({ index, ...(own ? { own: true as const } : {}) });
  const thumbOf = async () => {
    const sharp = (await import("sharp")).default;
    return sharp({ create: { width: 64, height: 36, channels: 3, background: "#777" } }).jpeg().toBuffer();
  };

  it("410-23 and 410-28: a punch-in on the picture just shown, or the same handout with one more passenger, is a copy to both checks", async () => {
    const { NEAR_COPY_SYSTEM, JUST_SHOWN_COPY_NOTE, SAME_LAYOUT_RULE, sameThingQuestion } = await import("./overlayTextScan");
    expect(SAME_LAYOUT_RULE).toMatch(/only closer or further back .* is a copy/);
    expect(SAME_LAYOUT_RULE).toMatch(/a person or a hand taken out or put in/);
    expect(sameThingQuestion("carry-on bag", true)).toContain(SAME_LAYOUT_RULE);
    expect(JUST_SHOWN_COPY_NOTE).not.toMatch(/only a little closer/);
    // 410-20: scene 3's seat row with the woman gone is not "another subject".
    expect(NEAR_COPY_SYSTEM).toContain(SAME_LAYOUT_RULE);
    expect(NEAR_COPY_SYSTEM).toMatch(/a person added or taken away does not make another subject/);
    // A picture not shown right before keeps the same-thing check's own rule: a new distance is fine.
    expect(sameThingQuestion("carry-on bag")).not.toContain(SAME_LAYOUT_RULE);
  });

  it("410-20 and 409-5: kept small beside the subject, each is laid beside the closest picture it was drawn from", async () => {
    const { nearCopyRelatives, looksAtClosestRelative } = await import("./longformVideo");
    const { nearCopyCandidates, rememberPicture } = await import("./pictureVariety");
    // 410-20: "a small clear plastic cup of orange juice … on a metal beverage cart", drawn from scenes 3 and 16.
    const juice = {
      index: 20,
      keyThing: "beverage cart",
      memoryView: BACKGROUND_VIEW,
      memoryRefUrls: ["https://r2/still-src-3.png", "https://r2/still-src-16.png"],
      memoryRefScenes: [ref(3), ref(16)],
    } as StoryboardScene;
    const relatives = nearCopyRelatives(juice);
    expect(relatives).toEqual({ drawnFrom: [3, 16], keptSmall: true, groupItem: false });
    expect(looksAtClosestRelative(relatives, juice, false)).toBe(true);
    const thumb = await thumbOf();
    rememberPicture(94100, 3, ones(30), thumb);
    rememberPicture(94100, 16, ones(38, 20), thumb);
    const zero = ones(0);
    expect(nearCopyCandidates(94100, 20, zero, undefined, { drawnFrom: [3, 16], lookAtClosest: true })[0].index).toBe(3);
    // 409-5: "viewed from behind among the rows of cards", drawn from scene 3 (22 bits on the frames).
    rememberPicture(94090, 3, ones(22), thumb);
    rememberPicture(94090, 2, ones(33, 20), thumb);
    expect(nearCopyCandidates(94090, 5, zero, undefined, { drawnFrom: [3, 2] }).map(c => c.index)).toEqual([3]);
    // A picture drawn from nothing it is near keeps the 20-bit line: neither is looked at.
    expect(nearCopyCandidates(94090, 5, zero)).toEqual([]);
  });

  it("the extra look is only the one a picture was owed: none beside a same-thing look, a screen's item photo or a list item's group picture", async () => {
    const { nearCopyRelatives, looksAtClosestRelative } = await import("./longformVideo");
    const { SET_ITEM_VIEW, MEMORY_VIEWS } = await import("./pictureMemory");
    const urls = ["https://r2/still-src-2.png"];
    // An ordinary memory picture: the same-thing check laid its memory beside it — no second look.
    const bin = { index: 5, keyThing: "bin", memoryView: MEMORY_VIEWS[1], memoryRefUrls: urls, memoryRefScenes: [ref(2)] } as StoryboardScene;
    expect(looksAtClosestRelative(nearCopyRelatives(bin), bin, true)).toBe(false);
    // …but once a redraw took its memory away (drawn from words), the look is owed again.
    expect(looksAtClosestRelative(nearCopyRelatives(bin), { memoryRefUrls: undefined }, false)).toBe(true);
    // References of other things only keep the wider line, with no forced look.
    const others = { ...bin, memoryView: undefined, memoryOthersOnly: true } as StoryboardScene;
    expect(looksAtClosestRelative(nearCopyRelatives(others), others, false)).toBe(false);
    const screen = { index: 9, memoryView: SCREEN_ITEM_VIEW, memoryRefUrls: urls, memoryRefScenes: [ref(4)] } as StoryboardScene;
    expect(nearCopyRelatives(screen).drawnFrom).toEqual([]);
    expect(looksAtClosestRelative(nearCopyRelatives(screen), screen, false)).toBe(false);
    const item = { index: 7, listCut: true, memoryView: SET_ITEM_VIEW, memoryRefUrls: urls, memoryRefScenes: [ref(5)] } as StoryboardScene;
    // Still related to the list's other items (412: "ribs" and "knee" came back alike), never forced.
    expect(nearCopyRelatives(item)).toEqual({ drawnFrom: [5], keptSmall: false, groupItem: true });
    expect(looksAtClosestRelative(nearCopyRelatives(item), { memoryRefUrls: undefined }, false)).toBe(false);
  });

  it("408-4/5: the toilet's panel and the bin, both drawn from scene 2, share one lane; pictures of other memories do not", async () => {
    const { varietyLanes } = await import("./pictureVariety");
    const shareLane = (a: StoryboardScene, b: StoryboardScene) => varietyLanes(a).some(l => varietyLanes(b).includes(l));
    const panel = { index: 4, hostPresent: true, keyThing: "toilet", memoryRefScenes: [ref(2)] } as StoryboardScene;
    const bin = { index: 5, keyThing: "bin", memoryRefScenes: [ref(2), ref(3)] } as StoryboardScene;
    expect(shareLane(panel, bin)).toBe(true);
    // 409: the sympathy card's first picture and the aisle drawn from scene 3 are not one memory.
    expect(shareLane({ index: 2, keyThing: "sympathy card" } as StoryboardScene, bin)).toBe(false);
    // 408-21: drawn from scene 8's toilet paper, it still waits for the toilet's other pictures (scene
    // 15, drawn from scene 2) — the thing's lane is kept beside the memory lane, never swapped for it.
    const fifteen = { index: 15, keyThing: "toilet", memoryRefScenes: [ref(2, false)] } as StoryboardScene;
    const twentyOne = { index: 21, keyThing: "toilet", memoryRefScenes: [ref(8, false)] } as StoryboardScene;
    expect(shareLane(fifteen, twentyOne)).toBe(true);
  });

  it("409-3: a fallback that shipped is remembered, so the next picture drawn from it meets it", async () => {
    const sharp = (await import("sharp")).default;
    const { nearCopyCandidates, pictureHash, rememberShippedPicture } = await import("./pictureVariety");
    const frame = await sharp({ create: { width: 320, height: 180, channels: 3, background: "#5a3c1e" } })
      .composite([{ input: Buffer.from(`<svg width="320" height="180"><rect x="200" y="0" width="120" height="180" fill="white"/></svg>`), left: 0, top: 0 }])
      .png()
      .toBuffer();
    await rememberShippedPicture(94091, 3, frame, false, undefined, [2]);
    const far = (await pictureHash(frame)).replace(/./g, (b, i) => (i < 30 ? (b === "1" ? "0" : "1") : b));
    expect(nearCopyCandidates(94091, 5, far, undefined, { drawnFrom: [3], lookAtClosest: true }).map(c => c.index)).toEqual([3]);
  });
});

describe("every key thing its words name keeps its look when a picture is drawn from words (round 13, jobs 404, 408 and 409)", () => {
  const CARD = "a plain cream greeting card with a muted gray ribbon print on the front, blank inside, small and rectangular";
  const BIN = "a small white plastic bin with a hinged lid, round shape";

  it("409-3: the aisle drawn from words after copying scene 2 twice still holds the cream card with the grey ribbon", async () => {
    const { attachMemory, memoryFor, memoryView, keyThingLookClause } = await import("./pictureMemory");
    const { memoryFields, memoryToWords, promptAfterMemoryChange, buildStillPrompt } = await import("./longformVideo");
    const things: KeyThing[] = [
      { name: "sympathy card", look: CARD, main: true },
      { name: "pharmacy aisle", look: "a narrow aisle lined with low wooden shelves holding neat rows of greeting cards, bright overhead lighting" },
    ];
    const b = [
      pic(2, "a pharmacy on a Tuesday morning, buying his third sympathy card since spring,", "a man holding a sympathy card in a pharmacy aisle lined with shelves", {
        keyThing: "sympathy card",
        humanPresent: true,
        pictureUrl: "https://r2/409/still-src-2.png",
      }),
      pic(3, "He is counting backward. He is sixty-four.", "a man in his sixties standing still in the pharmacy aisle, holding the sympathy card, seen from the side", {
        keyThing: "pharmacy aisle",
        humanPresent: true,
      }),
    ];
    attachMemory(b, [b[1]], things);
    const s3 = { ...b[1], ...memoryFields(await memoryFor(b[1], 0), memoryView(b[1])) } as StoryboardScene;
    const fields = memoryToWords(s3);
    expect(keyThingLookClause({ ...s3, ...fields })).toContain(`the sympathy card: ${CARD}`);
    const prompt = promptAfterMemoryChange(s3, buildStillPrompt(s3), fields);
    expect(prompt.split(CARD).length - 1).toBe(1);
    // Before, the redraw carried the aisle's look alone and the card came back with a lily spray.
    expect(prompt).not.toContain("reference image");
  });

  it("404-14 / 408-12: a thing that only stood in a reference picture is never written into the prompt", async () => {
    const { attachMemory, memoryFor, memoryView } = await import("./pictureMemory");
    const { buildSplitRightScene, buildStillPrompt, memoryFields, memoryToWords, promptAfterMemoryChange, withSplitMemory } =
      await import("./longformVideo");
    // The gulf coast yard drawn from the robin's pictures on the northern lawn: handed the lawn's look
    // ("frost-dusted"), it would bring back the snow under palms the setting rule took out.
    const robin: KeyThing[] = [
      { name: "robin", look: "a plump songbird about ten inches long, bright orange-red breast", main: true },
      { name: "lawn", look: "a flat suburban backyard lawn, green fading to frost-dusted brown, bordered by a low wooden fence" },
      { name: "gulf coast yard", look: "a flat grassy winter yard in a mild southern climate" },
    ];
    const r = [
      pic(5, "In spring they come back,", "a robin standing on a green lawn in early spring with patches of melting snow", {
        keyThing: "robin",
        pictureUrl: "https://r2/404/still-src-5.png",
      }),
      pic(14, "Down on the Gulf Coast, they winter in the yards.", "a robin standing in a mild gulf coast yard with palm trees", { keyThing: "robin" }),
    ];
    attachMemory(r, [r[1]], robin);
    const s14 = { ...r[1], ...memoryFields(await memoryFor(r[1], 0), memoryView(r[1])) } as StoryboardScene;
    // Round 14: the yard is a PLACE — its look is where the picture is set (`placeLooks`), cut to what
    // the yard is made of; it is no longer lent as another thing's look.
    expect(s14.otherThingLooks).toBeUndefined();
    expect(s14.placeLooks).toEqual([{ name: "gulf coast yard", look: "a flat grassy yard" }]);
    expect(promptAfterMemoryChange(s14, buildStillPrompt(s14), memoryToWords(s14))).not.toContain("frost");
    // The toilet's panel names no bin; the toilet's first picture has one beside it. Nothing about the
    // bin is added — what is in a picture is up to its own words.
    const things: KeyThing[] = [
      { name: "toilet", look: "a white porcelain toilet, oval bowl, closed lid often up", main: true },
      { name: "bin", look: `${BIN}, sitting on tile floor beside the toilet base` },
    ];
    const b = [
      pic(2, "That little stretch of tile between the bowl and the wall.", "a small white plastic bin with a closed hinged lid on pale beige tile floor beside the base of a white porcelain toilet", {
        keyThing: "bin",
        pictureUrl: "https://r2/408/still-src-2.png",
      }),
      host(12, "So. We will go the way the water goes.", {
        keyThing: "toilet",
        splitVisual: "White porcelain toilet bowl with water draining downward into the trapway opening, viewed from above at a settled moment as the bowl empties.",
      }),
    ];
    attachMemory(b, [], things);
    const panel = await withSplitMemory(b[1], buildSplitRightScene(b[1]), 0);
    expect(panel.otherThingLooks).toBeUndefined();
    const prompt = buildStillPrompt(panel, false, undefined, undefined, true);
    expect(prompt).not.toContain(BIN);
    expect(promptAfterMemoryChange(panel, prompt, memoryToWords(panel), { square: true })).not.toContain(BIN);
  });

  it("a first picture with nothing earlier keeps only its own look: nothing is added where no memory was", async () => {
    const { attachMemory, memoryFor, memoryView, keyThingLookClause } = await import("./pictureMemory");
    const { memoryFields } = await import("./longformVideo");
    const first = pic(2, "a pharmacy on a Tuesday morning,", "a man holding a sympathy card in a pharmacy aisle lined with shelves", {
      keyThing: "sympathy card",
    });
    attachMemory([first], [first], [
      { name: "sympathy card", look: CARD, main: true },
      { name: "pharmacy aisle", look: "a narrow aisle lined with low wooden shelves" },
    ]);
    const s = { ...first, ...memoryFields(await memoryFor(first, 0), memoryView(first)) } as StoryboardScene;
    expect(s.otherThingLooks).toBeUndefined();
    expect(keyThingLookClause(s)).not.toContain("OTHER THING");
    expect(keyThingLookClause(s)).toContain(CARD);
  });
});

describe("the cutaway book guard keeps out the CTA's book only, and never borrows a neighbour's picture (job 409)", () => {
  const STOIC = ["The Stoic Way"];
  const pic = (extra: Partial<StoryboardScene>): StoryboardScene =>
    ({ index: 0, narration: "n", visualPrompt: "vp", hostPresent: false, ...extra }) as StoryboardScene;

  it("job 409 scene 28: the essay line keeps its reader — no farmer from the next line through the window", async () => {
    const { unwantedCutawayBook, dropUnwantedBook } = await import("./longformVideo");
    const line =
      "The essay is called On the Shortness of Life, and it opens by picking a fight with its own title. Everyone complains that life is too short, Seneca says.";
    const rewrite = "An older man seen from behind reading an open hardback book at a wooden desk by a window.";
    expect(unwantedCutawayBook(rewrite, line, STOIC)).toBe(false);
    expect(unwantedCutawayBook("the host reading a book at the desk in the study", line, STOIC)).toBe(false);
    // even if a later step calls the guard's rewrite, nothing of the scene is lost
    const s = pic({ index: 28, scriptText: line, narration: line, showSubject: "the host reading a book at the desk in the study", visualPrompt: rewrite });
    dropUnwantedBook(s, 27, STOIC, "You're Not Running Out of Time After 60");
    expect(s.visualPrompt).toBe(rewrite);
    expect(s.showSubject).toBe("the host reading a book at the desk in the study");
  });

  it("job 409 scene 15: 'money,' keeps its bills and checkbook — not the next item's sympathy card", async () => {
    const { unwantedCutawayBook } = await import("./longformVideo");
    expect(
      unwantedCutawayBook("a few folded bills and an open checkbook on the wooden desk by the window", "money,", STOIC)
    ).toBe(false);
  });

  it("jobs 404/411: the field guide's page stays under 'the one printed in the field guides'", async () => {
    const { unwantedCutawayBook } = await import("./longformVideo");
    expect(
      unwantedCutawayBook(
        "Close-up of an open field guide page: a painted robin illustration beside short soft grey text bars, with the robin's scientific name printed beneath the illustration",
        "The funny part is that the robin’s own scientific name, the one printed in the field guides, ends in the word migratorius.",
        ["The Backyard Birder"]
      )
    ).toBe(false);
  });

  it("the CTA's own book is still taken out of a cutaway — from the scene's own words, never a neighbour's", async () => {
    const { unwantedCutawayBook, dropUnwantedBook } = await import("./longformVideo");
    const line = "As I lay out in The Stoic Way, the days are not short.";
    const s = pic({
      index: 30,
      scriptText: line,
      narration: line,
      visualPromptSeed: "the wooden desk by the window in the morning",
      showSubject: "a copy of The Stoic Way on the desk",
      visualPrompt: "A hardback copy of The Stoic Way on a wooden desk by a window, a mug beside it.",
    });
    expect(unwantedCutawayBook(s.visualPrompt, line, STOIC)).toBe(true);
    dropUnwantedBook(s, 29, STOIC, "You're Not Running Out of Time After 60");
    expect(s.visualPrompt).toBe("the wooden desk by the window in the morning");
    expect(s.showSubject).toBeUndefined();
    // a made-up book under a line that never speaks of one goes too, the rest of the picture kept
    const card = pic({ scriptText: "grief,", narration: "grief,", visualPrompt: "a plain cream sympathy card on a wooden desk, a stack of hardback books beside it" });
    dropUnwantedBook(card, 16, STOIC);
    expect(card.visualPrompt).toBe("a plain cream sympathy card on a wooden desk");
  });

  it("job 242: a strike plate with 'matchbook-like proportions' keeps them — a word ending in 'book' is no book", async () => {
    const { unwantedCutawayBook, dropUnwantedBook } = await import("./longformVideo");
    const line = "and the flat piece of metal around that hole is the strike plate.";
    const plate =
      "A factory-standard strike plate removed and laid flat on a wooden work surface in natural light, the small metal plate shown at close range, its flat face and the hole for the bolt visible, the matchbook-like proportions clear, approximately 2 inches by 1 inch.";
    expect(unwantedCutawayBook(plate, line, ["The Locksmith Way"])).toBe(false);
    const s = pic({ index: 12, scriptText: line, narration: line, visualPrompt: plate });
    dropUnwantedBook(s, 12, ["The Locksmith Way"]);
    expect(s.visualPrompt).toBe(plate);
  });
});

describe("a thing only the CTA names is no prop of the film (job 409)", () => {
  // The closing CTA's "lift your phone toward the pattern in the corner of the screen" was the
  // script's only phone. Read with the rest of the script, it became the style bible's "Props recur:
  // … a phone" and a key thing on the study desk, and filled the split panel under "Maybe you have
  // done that arithmetic" (scene 7) and the study shots 14 and 19.
  it("the world and the props read the content; the CTA's phone is dropped, a content phone stays", async () => {
    const { parseCtaMarkers, splitCtaFromContent } = await import("./longformVideo");
    const { parseKeyThings, withoutCtaOnlyProps } = await import("./shotList");
    const raw = [
      "Seventeen. He pays, he walks out to the parking lot, and the number rides home with him in the passenger seat. Maybe you have done that arithmetic.",
      "===START CTA(The Stoic Way)===",
      "Getting there is one small motion: lift your phone toward the pattern in the corner of the screen and tap what rises, or find the first line of the description below.",
      "===END CTA===",
    ].join("\n");
    const { script, spans } = parseCtaMarkers(raw);
    const { content, cta } = splitCtaFromContent(script, spans);
    expect(content).toBe(
      "Seventeen. He pays, he walks out to the parking lot, and the number rides home with him in the passenger seat. Maybe you have done that arithmetic."
    );
    const sheet = [
      "HOME: a quiet home study, pale cream walls, a wooden desk by a window, soft gray morning light",
      "MAIN sympathy card: a plain cream greeting card with a muted gray ribbon print on the front",
      "phone: a black smartphone with a glass screen and thin silver edges, resting face-up on the desk",
      "parking lot: a flat paved lot with faint lane lines, a few parked cars, gray overcast sky",
    ].join("\n");
    expect(parseKeyThings(withoutCtaOnlyProps(sheet, content, cta).sheet).map(t => t.name)).toEqual([
      "sympathy card",
      "parking lot",
    ]);
    // A phone the film's own content talks about is still a key thing.
    const told = `${content} He keeps the phone face-down on the desk so the number cannot reach him.`;
    expect(parseKeyThings(withoutCtaOnlyProps(sheet, told, cta).sheet).map(t => t.name)).toContain("phone");
  });
});

describe("the people the story follows keep one look, and 'you' is read from what the host does (jobs 410, 412)", () => {
  // Job 410 follows two passengers ("The other was still in row fourteen… He figures she must know
  // somebody on the crew. She doesn't.") and the props call wrote no PERSON line: the man changed
  // clothes between scenes 2 and 7. It echoed the host block back as the prop "THE HOST", and with no
  // host title and a look that never named the job it wrote no VIEWER line, so "you" asking the crew
  // politely (scene 15) was the host in uniform talking to a colleague. Job 412's VIEWER look gave
  // no man or woman, age or hair, and the sleeper changed from shot to shot.
  const script410 =
    "Two people paid the same fare, boarded the same flight, and sat in the same row. By the time the beverage cart had come and gone, one of them was sitting in an empty row closer to the front, holding the whole can of ginger ale, a second bag of pretzels, and a bottle of water for later. The other was still in row fourteen with a few inches of soda over ice. He figures she must know somebody on the crew. She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them. I'm Helena Hart, and I read the fine print so travelers like us can stop learning these things the hard way.";

  it("job 410: the she and the he are owed a PERSON line each; the host's own words reach the props call", async () => {
    const { peopleOwed, hostBlockFor } = await import("./shotList");
    const { hostOwnWords } = await import("./followedPeople");
    expect(peopleOwed(script410, { people: [], viewer: [] }, { hostName: "Helena Hart" }).uncovered.map(f => f.cue)).toEqual(["she", "he"]);
    expect(hostBlockFor("a slender woman in her forties, navy blazer with gold pin, striped scarf", undefined, hostOwnWords(script410, { hostName: "Helena Hart" }))).toContain(
      'in their own words — "I\'m Helena Hart, and I read the fine print so travelers like us can stop learning these things the hard way."'
    );
  });

  it("job 410: the host block echoed back is never a key thing", async () => {
    const { parseKeyThings } = await import("./shotList");
    const sheet = [
      "aircraft cabin: narrow rows of blue upholstered seats, a center aisle",
      "MAIN beverage cart: a metal service cart with wheels",
      "THE HOST: a slender woman in her forties, fair skin, brown hair pinned back, white blouse, navy blazer with gold pin, striped scarf",
    ].join("\n");
    expect(parseKeyThings(sheet).map(k => k.name)).toEqual(["beverage cart"]);
  });

  it("job 412: the viewer's 'adult of average build, wearing plain pajamas' is owed a whole look", async () => {
    const { peopleOwed } = await import("./shotList");
    const viewer = "VIEWER the cat owner: an adult of average build, wearing plain pajamas, lying in the unmade bed in the dim pre-dawn bedroom";
    expect(peopleOwed("Three in the morning. The house is dark.", { people: [], viewer: [viewer] }).incomplete.map(x => x.gaps)).toEqual([
      ["man or woman", "an age range", "hair"],
    ]);
  });

  it("clean: job 411's robins follow nobody, and a whole look owes nothing", async () => {
    const { peopleOwed } = await import("./shotList");
    const robins =
      "Every fall, the robins that worked your lawn all summer pack up and head for Florida. The song at first light goes quiet, the grass sits empty in the mornings, and nobody sees another robin until spring. I’m Walter, and if you keep an eye on the yard from the kitchen window, this one’s for you.";
    const sleeper = "VIEWER the cat owner: a woman in her thirties, shoulder-length brown hair, a plain grey sleep shirt";
    expect(peopleOwed(robins, { people: [], viewer: [sleeper] }, { hostName: "Walter Wren" })).toEqual({ uncovered: [], incomplete: [] });
  });
});

describe("the repair keeps job 410's man beside the woman passenger, and adds no one it was not asked for (review)", () => {
  const woman = "a woman in her seventies, short white hair, a cream cardigan over a blue floral blouse, grey slacks";
  const man = "a man in his seventies, balding grey hair, an olive-green jacket over a checked shirt, khaki trousers";

  it("job 410: 'the passenger in row fourteen', a man, is added though his name matches her role", async () => {
    const { mergeRepairedPeople } = await import("./shotList");
    const merged = mergeRepairedPeople(
      { people: [`PERSON the passenger in the empty row: ${woman}`], viewer: [] },
      [],
      `PERSON the passenger in row fourteen: ${man}`,
      { uncovered: [{ cue: "he", sex: "m", sentences: [2, 3] }] }
    );
    expect(merged.added).toEqual(["the passenger in row fourteen"]);
  });

  it("clean: a line for someone the check did not find missing is never added", async () => {
    const { mergeRepairedPeople } = await import("./shotList");
    const merged = mergeRepairedPeople(
      { people: [`PERSON the woman passenger: ${woman}`, `PERSON the man passenger: ${man}`], viewer: [] },
      [],
      "PERSON the flight attendant: a woman in her thirties, dark hair in a low bun, a navy dress",
      { uncovered: [] }
    );
    expect(merged.added).toEqual([]);
  });
});

describe("someone else shows no face: no smile in the words, and the check asks (job 410 scene 8)", () => {
  // Job 410 scene 8, under "She doesn't. What she knows is which questions flight attendants like
  // hearing": the shot list wrote "smiling politely up at a flight attendant" into a picture of
  // another passenger. A smile is drawn on a face, so she came back in profile — eye, glasses, nose
  // and a smiling mouth — beside a clause saying no face is ever shown, and no check looked.
  const LOOK =
    "A slender woman in her late thirties with fair skin and dark hair pinned back, wearing a white blouse, navy blazer with gold pin, and striped scarf";
  const scene8 = () =>
    pic(
      8,
      "She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them.",
      "an older woman seen from the side smiling politely up at a flight attendant standing in the aisle",
      {
        visualPrompt:
          "An older woman sitting in her seat seen from the side, looking up and smiling politely at a flight attendant standing in the aisle.",
        humanPresent: true,
        otherPerson: "an older woman passenger and a flight attendant",
        stillImage: true,
      }
    );

  it("410-8: the words say it with the body, the prompt asks for no smile, and the still check asks about a face", async () => {
    const { othersFaceAsked } = await import("./longformVideo");
    const s = [scene8()];
    markHostBroll(s, { hostLook: LOOK, hostName: "Helena Hart" }, "https://x/host.png");
    expect(s[0].otherPerson).toBeTruthy();
    expect(s[0].showSubject).toBe("an older woman seen from the side nodding politely up at a flight attendant standing in the aisle");
    expect(s[0].visualPrompt).toBe(
      "An older woman sitting in her seat seen from the side, looking up and nodding politely at a flight attendant standing in the aisle."
    );
    const prompt = buildStillPrompt(s[0]);
    expect(prompt).not.toMatch(/smil/i);
    expect(prompt).toMatch(/faces turned away or out of frame so no face is ever shown/);
    expect(othersFaceAsked(s[0], false, false)).toBe(true);
  });

  it("410-8 as stored before the rule: a Regenerate's prompt and check words drop the smile too", async () => {
    const { expressionAsBody } = await import("./hostLook");
    // The stored scene was marked before this rule, so its words still say "smiling".
    const stored = scene8();
    expect(buildStillPrompt(stored)).not.toMatch(/smil/i);
    expect(expressionAsBody(stored.showSubject!)).toContain("nodding politely up at a flight attendant");
  });

  it("402-29, 410-31, 405-10: a smile is a nod, a frown at the cat is leaning toward it", async () => {
    const { expressionAsBody } = await import("./hostLook");
    expect(expressionAsBody("a flight attendant smiling as she hands a cookie packet to an older passenger, seen from the side")).toBe(
      "a flight attendant nodding as she hands a cookie packet to an older passenger, seen from the side"
    );
    expect(expressionAsBody("a flight attendant smiling and handing a cookie to an older passenger at the galley")).toBe(
      "a flight attendant nodding and handing a cookie to an older passenger at the galley"
    );
    expect(
      expressionAsBody(
        "A person half sitting up in bed at night viewed from the side, frowning at a grey and brown tabby cat sitting on the pale blanket beside them."
      )
    ).toBe(
      "A person half sitting up in bed at night viewed from the side, leaning toward a grey and brown tabby cat sitting on the pale blanket beside them."
    );
  });

  it("clean: the host tearing cloth, the man planting a tree from behind and the cat at its owner's face keep their words", () => {
    const tearing = pic(55, "Tear it into strips two fingers wide.", "hands tearing cloth into strips two fingers wide on the work table", {
      humanPresent: true,
    }); // job 144 scene 55
    const planting = pic(18, "He plants it anyway.", "an older man planting a young tree in a backyard on a sunny morning, seen from behind", {
      humanPresent: true,
      otherPerson: "an older man",
    }); // job 409 scene 18
    const cat = pic(9, "Then it comes up to your face.", "cat lowering face close to owner's face in bed", {
      humanPresent: true,
      otherPerson: "the cat owner",
    }); // job 412 scene 9
    const words = [tearing, planting, cat].map(s => [s.showSubject, s.visualPrompt]);
    markHostBroll([tearing, planting, cat], { hostLook: "a man in his sixties with a grey beard" }, "https://x/host.png");
    expect([tearing, planting, cat].map(s => [s.showSubject, s.visualPrompt])).toEqual(words);
    expect(buildStillPrompt(tearing)).toContain("hands tearing cloth into strips two fingers wide on the work table");
    expect(planting.othersTurnedAway).toBeUndefined();
  });
});

describe("a list inside a passage of another time is set there; a 'he' of the story is never the host (job 409)", () => {
  // Job 409, 156-164 s: "The farmer complains, the senator complains, the old complain, and the young
  // are already rehearsing the complaint" — said inside the passage about a writer of ancient times —
  // came back as a farmer in overalls, an old man on a park bench and a young man in a hoodie; only
  // the senator was dressed for the time. Scene 33, "Then he turns the whole thing over in a single
  // motion: life is not short" (the writer reversing his argument), was the HOST turning a page.
  const ROME = "ancient Rome, first century AD";
  const FOUR = ["The farmer complains", "the senator complains", "the old complain", "the young are already rehearsing the complaint"];
  const TURN = "Then he turns the whole thing over in a single motion: life is not short.";
  const film = () => [
    pic(29, "The farmer complains,", "a farmer standing in a field, seen from behind", { humanPresent: true, otherPerson: "a farmer", listCut: true }),
    pic(30, "the senator complains,", "a senator in robes standing in a hall, seen from the side", { humanPresent: true, otherPerson: "a senator", listCut: true }),
    pic(31, "the old complain,", "an old man sitting on a bench, seen from behind", { humanPresent: true, otherPerson: "an old man", listCut: true }),
    pic(32, "and the young are already rehearsing the complaint.", "a young man standing alone in a courtyard, seen from the side", {
      humanPresent: true,
      otherPerson: "a young man",
      listCut: true,
    }),
    pic(33, TURN, "the host turning a page slowly at the desk", { humanPresent: true }),
  ];

  it("409-29..32: every item's prompt is set in the passage's time and place, the planner's picture kept", () => {
    const r = applySpokenLists(film(), [{ sentence: 20, items: FOUR, setting: ROME }]);
    const items = r.scenes.filter(s => s.listCut);
    expect(items).toHaveLength(4);
    for (const s of items) expect(buildStillPrompt(s)).toContain(`this picture is set in ${ROME}: anyone in it is dressed as people were there and then`);
    expect(items.map(s => s.showSubject)).toEqual(film().slice(0, 4).map(s => s.showSubject));
  });

  it("409-33: the line check is told its he/she is not the host", async () => {
    const { fitPictureNotes } = await import("./shotList");
    expect(fitPictureNotes(film()[4])).toBe(" (its he/she is not the host)");
  });

  it("clean: Dale's list of today and a how-to that really turns a board over are left as they were", async () => {
    const { fitPictureNotes } = await import("./shotList");
    const dale = [
      pic(4, "Coasters,", "a stack of round wooden coasters", { listCut: true }),
      pic(5, "ornaments,", "a few small wooden ornaments", { listCut: true }),
      pic(6, "small cutting boards.", "small cutting boards leaning on the bench", { listCut: true }),
    ]; // job 397
    const r = applySpokenLists(dale, [{ sentence: 0, items: ["Coasters", "ornaments", "small cutting boards"] }]);
    for (const s of r.scenes) {
      expect(s.listSetting).toBeUndefined();
      expect(buildStillPrompt(s)).not.toMatch(/Like the sentence it is said in/);
    }
    expect(
      fitPictureNotes(pic(9, "Turn it over and sand the other side.", "the host's hands turning a board over on the workbench", { humanPresent: true }))
    ).toBe("");
  });
});

describe("Werner's job 408 scenes 2-3: lines that compare are never one picture (round 13)", () => {
  // The same-topic pass joined the set-up, "it is empty" and the reveal into one topic and drew the
  // reveal for all of it: the bin stood beside the toilet under "In most American bathrooms, it is
  // empty", and the Versus card then said the American side is empty (job 403 the same).
  const setUp = "That little stretch of tile between the bowl and the wall. In most American bathrooms,";
  const reveal = "it is empty. In a German bathroom, usually, a small bin stands there, with a lid.";
  const binShow =
    "a small white plastic bin with a closed hinged lid on pale beige tile floor beside the base of a white porcelain toilet, water swirling in the bowl as it flushes";

  it("the set-up and the reveal each keep their own picture", () => {
    const scenes = [
      pic(0, setUp, "the narrow stretch of tile floor between a white toilet and the wall"),
      pic(1, reveal, "a small white plastic bin with a closed hinged lid on tile beside a toilet"),
    ];
    const groups = parseContextGroups(
      JSON.stringify({ groups: [{ ids: [0, 1], show: binShow }] }),
      [[0, 1]],
      i => scenes[i].showSubject,
      i => atWork(scenes[i]),
      i => scenes[i].scriptText
    );
    expect(contrastAcross([setUp, reveal])).toBe(true);
    expect(groups).toEqual([]);
  });

  it("two lines about the one bin still share a picture", () => {
    const show = "a small white bin with a lid beside a toilet";
    const scenes = [
      pic(0, "In a German bathroom, usually, a small bin stands there, with a lid.", show),
      pic(1, "It has a lid, and it is emptied once a week.", show),
    ];
    const groups = parseContextGroups(
      JSON.stringify({ groups: [{ ids: [0, 1], show }] }),
      [[0, 1]],
      i => scenes[i].showSubject,
      i => atWork(scenes[i]),
      i => scenes[i].scriptText
    );
    expect(groups).toEqual([{ ids: [0, 1], show }]);
  });
});

describe("the line's own subject is the picture's (round 13: jobs 410 and 408)", () => {
  it("410 scene 20: the juice on the beverage cart is the picture, not the cart kept small at the back", async () => {
    const { attachMemory, memoryView } = await import("./pictureMemory");
    const things: KeyThing[] = [
      { name: "beverage cart", main: true, look: "a metal service cart with wheels, a flat top holding plastic cups, ice, aluminum cans" },
      { name: "empty row", look: "a row of three blue seats near the front of the cabin, unoccupied" },
    ];
    const row = pic(3, "one of them was sitting in an empty row closer to the front, holding", "an older woman seen from the side sitting alone in an empty row of three blue seats, the beverage cart rolling away down the aisle behind her", {
      keyThing: "empty row",
      otherKeyThings: ["beverage cart"],
    });
    const juice = pic(20, "Juice works the same way. If they're running short, they'll tell you, and you're no worse off for trying.", "a small plastic cup of orange juice beside a juice can on the beverage cart", {
      keyThing: "beverage cart",
    });
    const board = [row, juice];
    attachMemory(board, board, things);
    expect(juice.keyThing).toBeUndefined();
    expect(juice.otherKeyThings).toEqual(["beverage cart"]);
    expect(memorySourcesFor(board, juice)).toEqual([]);
    expect(memoryView(juice)).not.toBe(BACKGROUND_VIEW);
    expect(row.keyThing).toBe("empty row");
  });

  it("410 scene 6: the bottle of water she was holding is in her hand; a tray that holds things has no hand", async () => {
    const { keepListHolders } = await import("./spokenLists");
    const scenes = [
      pic(3, "one of them was sitting in an empty row closer to the front, holding", "an older woman seen from the side sitting alone in an empty row", {
        otherPerson: "an older woman passenger",
        humanPresent: true,
      }),
      pic(4, "the whole can of ginger ale,", "an older woman's hand holding a full soda can in the empty row", { listCut: true, otherPerson: "an older woman passenger", humanPresent: true }),
      pic(6, "and a bottle of water for later.", "small water bottle resting on the tray table in the empty row", { listCut: true }),
    ];
    expect(keepListHolders(scenes)).toBe(1);
    expect(scenes[2]).toMatchObject({
      showSubject: "small water bottle in the empty row, held in the hand of an older woman passenger",
      otherPerson: "an older woman passenger",
      humanPresent: true,
    });
    const tray = [
      pic(236, "Cut the pockets a little bigger, and the same tray holds", "hands cutting wider pockets into a wooden tray", { humanPresent: true }),
      pic(237, "a small teapot", "a small teapot sitting inside a tray pocket on the workbench", { listCut: true }),
    ];
    expect(keepListHolders(tray)).toBe(0);
  });

  it("408 scene 21: the line check is told the line ends on the stick the picture left out", async () => {
    const { closingThing } = await import("./shotList");
    const line = "Then the next. The toilet starts flushing slow, and you decide the toilet is getting old. The toilet is fine. There is a stick in it.";
    expect(closingThing(line, "toilet bowl with water draining slowly, paper piling near the bend")).toBe("There is a stick in it.");
    expect(closingThing(line, "a toilet bowl with high standing water, paper caught on a stick across the drain")).toBeUndefined();
  });

  it("399 scene 18 on a retry: the carton on the cart is never filed under the cup beside it", async () => {
    const { attachMemory, memoryView } = await import("./pictureMemory");
    const things: KeyThing[] = [
      { name: "beverage cart", main: true, look: "metal trolley with two tiers" },
      { name: "plastic cup", look: "clear hard plastic, filled with ice cubes" },
    ];
    const board = [
      pic(16, "Number one. The whole can.", "hands pouring soda into an ice-filled plastic cup at the cart", { keyThing: "plastic cup", humanPresent: true }),
      pic(18, "Juice works the same way.", "a small juice carton on the beverage cart tray beside an ice-filled plastic cup", {
        keyThing: "beverage cart",
        otherKeyThings: ["plastic cup"],
      }),
    ];
    attachMemory(board, board, things);
    // "Retry failed scenes" reads the board back with the first pass's filing on it.
    const retry = JSON.parse(JSON.stringify(board)) as StoryboardScene[];
    attachMemory(retry, retry, things);
    expect(retry[1].keyThing).toBeUndefined();
    expect(memoryView(retry[1])).not.toBe(BACKGROUND_VIEW);
    expect(memorySourcesFor(retry, retry[1])).toEqual([]);
  });
});

describe("Werner's job 408 scenes 23-24: a tool made for one job is drawn by its parts (round 13)", () => {
  // "A toilet auger, the short kind made for toilets, can sometimes hook it out" was a bent rod on a
  // screwdriver handle under a label naming the tool: the props list wrote "a slim metal rod with a
  // curved tip and plastic handle", and the named-things step left the tool out as an everyday thing.
  const AUGER =
    "a closet auger about 1 m long, a steel tube bent into a J at its lower end, a black rubber sleeve over the bend, " +
    "a coiled steel cable running through the tube to a small spring tip, a crank handle with a wooden grip at the top of the tube";

  it("the props list and the named-things step both write a specialised tool as it is really built", async () => {
    const { SPECIALISED_TOOL_RULE, TOOL_SHAPE_NOT_VERB } = await import("./shotList");
    const { NAMED_LOOKS_SYSTEM } = await import("./namedLooks");
    expect(CONTINUITY_SYSTEM).toContain(SPECIALISED_TOOL_RULE);
    expect(SPECIALISED_TOOL_RULE).toMatch(/the 2-4 PARTS that make it that tool/);
    expect(NAMED_LOOKS_SYSTEM).toMatch(/A SPECIALISED TOOL OR PIECE OF EQUIPMENT a picture is about/);
    expect(NAMED_LOOKS_SYSTEM.replace(/\s+/g, " ")).toContain(TOOL_SHAPE_NOT_VERB);
  });

  it("scene 23 carries the auger's parts and keeps the hands; scene 24, with the tool only beside the toilet, is untouched", async () => {
    const { parseNamedLooks } = await import("./namedLooks");
    const { keyThingLookClause } = await import("./pictureMemory");
    const scenes = [
      pic(23, "A toilet auger, the short kind made for toilets, can sometimes hook it out.", "toilet auger hooked tip inserted into toilet bowl trapway opening", {
        keyThing: "toilet auger",
        humanPresent: true,
        keyThingLook: "a slim metal rod with a curved tip and plastic handle, short household size",
      }),
      pic(24, "If it will not come, the toilet has to come up off the floor, and that is a fair place to stop and call someone.", "the white porcelain toilet standing on the pale beige tile floor with a toilet auger resting idle beside its base", {
        keyThing: "toilet",
        otherKeyThings: ["toilet auger"],
      }),
    ];
    const before = JSON.stringify(scenes[1]);
    const answer = parseNamedLooks(
      JSON.stringify({
        kinds: [{ name: "toilet auger", look: AUGER }],
        pictures: [{ id: 0, kind: "toilet auger", show: "hands turning the crank handle of a closet auger, its rubber-sleeved bend resting in the toilet bowl's drain opening" }],
      })
    )!;
    expect(applyNamedLooks(scenes, [0, 1], answer, [{ name: "toilet auger", look: "a slim metal rod with a curved tip and plastic handle" }])).toBe(1);
    expect(scenes[0].namedLook).toBe(`toilet auger: ${AUGER}`);
    expect(scenes[0].humanPresent).toBe(true);
    expect(namedLookClause(scenes[0])).toContain("a coiled steel cable running through the tube");
    expect(keyThingLookClause(scenes[0])).toBe("");
    expect(JSON.stringify(scenes[1])).toBe(before);
  });
});

describe("Werner's job 408 scene 23: a props look by its parts reaches the first picture whole (round 13)", () => {
  // The auger's first picture is drawn by its props look. A look by parts says how each sits ("a
  // black rubber sleeve where the tube bends"), and the place cut dropped every clause holding
  // "where" — the sleeve that tells a closet auger from a bent rod went with it.
  it("keeps the part before 'where', and a 'where' naming a place still goes", () => {
    const things = [
      {
        name: "toilet auger",
        look: "a closet auger, a J-bent steel tube, a black rubber sleeve where the tube bends, a crank handle joined to the top of the tube",
      },
      { name: "driveway", look: "paved slope in front of the garage, dusted with light frost, where furniture waits before pickup" },
    ];
    const auger = pic(23, "A toilet auger, the short kind made for toilets, can sometimes hook it out.", "hands turning a closet auger's crank handle", {
      keyThing: "toilet auger",
      humanPresent: true,
    });
    expect(keyThingLookFor(auger, things)).toBe(
      "a closet auger, a J-bent steel tube, a black rubber sleeve, a crank handle joined to the top of the tube"
    );
    // A "where" naming a place still goes in the place cut — and the frost, the weather, with it
    // (round 14, `lookWithoutLight`).
    expect(pictureLook(things[1].look)).toBe("paved slope in front of the garage");
    // Round 14: a driveway is a PLACE — its look is no own-thing look but where a picture is set
    // (`placeLook`), the frost and what happens there left to each picture's own words.
    const drive = pic(5, "It waits by the road.", "a paved driveway", { keyThing: "driveway" });
    expect(keyThingLookFor(drive, things)).toBeUndefined();
    expect(placeLook(things[1].look)).toBe("paved slope in front of the garage");
  });
});

describe("Werner's job 408 at 0:54 and 1:08: no host take ends on a preposition, and 'Flush, and follow.' is no list (round 13)", () => {
  // At 0:54 the introduction ended "…This channel is for people in" and the picture began "older houses
  // and apartments…" — the host's last word on camera was "in". At 1:08 "So. We will go the way the
  // water goes. Flush, and follow." — how the video will run — played as two flash pictures under a
  // numbered "1 Flush → 2 Follow". Sentences and scene ranges are the job's own.
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
      minHoldSec: over.hostPresent ? 2 : 1.2,
      stillImage: over.hostPresent ? undefined : true,
      ...over,
    }) as StoryboardScene;

  it("the introduction hands over before 'in', so the picture opens on 'in older houses and apartments'", async () => {
    const { enforcePlanRules } = await import("./planGate");
    const params = { faceImageUrl: "https://example.com/host.jpg", hostName: "Werner Finkbeiner" } as any;
    const scenes = [
      at(7, 34.38, 41.85, "One is a thread so thin you would never think it could stop anything, and it can stop a pump a long way from your house."),
      at(8, 41.8467, 50.9829, "And besides what your own body sends there, exactly one thing is allowed in the bowl. It was built on purpose to do something the nine cannot."),
      at(9, 50.9829, 54.39365, "I am Werner Finkbeiner. This channel is for people in", { hostPresent: true, hostIntro: true, hostProtected: true }),
      at(10, 54.39365, 59.4103, "older houses and apartments who would rather understand the cause than pay for the visit."),
      at(11, 59.4103, 65.482, "Today we go through all nine, one at a time, and look at what the German habit does instead."),
      at(12, 65.482, 68.6937, "So. We will go the way the water goes.", { hostPresent: true }),
    ];
    const r = enforcePlanRules(scenes, params, { budgetSec: 72.16 });
    const k = r.scenes.findIndex(s => s.hostIntro);
    expect(r.scenes[k].scriptText).toBe("I am Werner Finkbeiner. This channel is for people");
    expect(r.scenes[k + 1].scriptText).toMatch(/^in older houses and apartments who would rather/);
    expect(r.scenes[k + 1].narrationStartSec).toBe(r.scenes[k].narrationEndSec);
  });

  it("job 400's introduction, which stopped on 'for', now hands over before it", async () => {
    const { enforcePlanRules } = await import("./planGate");
    const params = { faceImageUrl: "https://example.com/host.jpg", hostName: "Gideon Grant" } as any;
    const r = enforcePlanRules(
      [
        at(1, 67.7626, 70.934, "My name is Gideon Grant, and this channel is for", { hostPresent: true, hostIntro: true }),
        at(2, 70.934, 76.935, "men and women in their fifties, sixties, and beyond — people carrying real questions about"),
      ],
      params
    );
    expect(r.scenes[0].scriptText).toBe("My name is Gideon Grant, and this channel is");
    expect(r.scenes[1].scriptText).toMatch(/^for men and women in their fifties/);
  });

  const sentences = [
    "Today we go through all nine, one at a time, and look at what the German habit does instead.",
    "So.",
    "We will go the way the water goes.",
    "Flush, and follow.",
    "And treat gasoline like it’s actively looking for a reason — drain it outside, store it sealed, nowhere near a spark.",
    "Hold your phone up to the screen with its camera on, and aim it at the little black and white code.",
  ];
  const answer = (kind: string) =>
    JSON.stringify({
      lists: [
        { sentence: 3, kind, items: ["Flush", "follow"] },
        { sentence: 4, kind: "steps", items: ["drain it outside", "store it sealed"] },
        { sentence: 5, kind: "steps", items: ["Hold your phone up to the screen with its camera on", "aim it at the little black and white code"] },
      ],
    });

  it("'Flush, and follow.' is found by neither the model (as steps or as things) nor the sentence shape", async () => {
    for (const kind of ["steps", "things"]) {
      const { lists } = await findSpokenLists(sentences.join(" "), { ask: async () => answer(kind) });
      expect(lists.map(l => l.sentence)).toEqual([4, 5]);
    }
    expect(spokenListsByShape(sentences).filter(l => l.sentence === 3)).toEqual([]);
  });

  it("two steps that each do something to a thing they name stay a list (jobs 410, 413)", async () => {
    const { lists } = await findSpokenLists(sentences.join(" "), { ask: async () => answer("steps") });
    expect(lists).toEqual([
      { sentence: 4, items: ["drain it outside", "store it sealed"], kind: "steps" },
      { sentence: 5, items: ["Hold your phone up to the screen with its camera on", "aim it at the little black and white code"], kind: "steps" },
    ]);
  });

  it("a shot-list hand-off right after a preposition keeps its picture — job 189's kumiko patterns are not said by the host instead", async () => {
    // Job 189 (0:30): the shot list handed over "…fitting thin strips of wood together into | patterns,
    // the kind of lattice you see in Japanese sliding doors." The sentence fits a host take, and
    // finishing it came before handing over at the preposition: replayed, the host said the patterns
    // and their picture was gone. Scene ranges are the job's own.
    const { enforcePlanRules } = await import("./planGate");
    const params = { faceImageUrl: "https://example.com/host.jpg", hostName: "Hank Hardwood" } as any;
    const r = enforcePlanRules(
      [
        at(11, 26.7643, 28.4797, "on a market table."),
        at(12, 28.4797, 30.5545, "Start with the one that lost."),
        at(13, 30.5545, 34.2148, "Kumiko is the Japanese craft of fitting thin strips of wood together into", { hostPresent: true }),
        at(14, 34.2148, 38.0545, "patterns, the kind of lattice you see in Japanese sliding doors."),
        at(15, 38.0545, 40.5216, "Mine was a plain grid about a foot square,"),
        at(16, 40.5216, 43.9902, "made from pine screen molding at about $3 a stick."),
      ],
      params
    );
    expect(r.scenes.map(s => [!!s.hostPresent, s.scriptText])).toEqual([
      [false, "on a market table."],
      [false, "Start with the one that lost."],
      [true, "Kumiko is the Japanese craft of fitting thin strips of wood together"],
      [false, "into patterns, the kind of lattice you see in Japanese sliding doors."],
      [false, "Mine was a plain grid about a foot square,"],
      [false, "made from pine screen molding at about $3 a stick."],
    ]);
  });
});

describe("round 13: a line under the big QR card never sends the viewer to the corner unwarned (job 409 scene 37)", () => {
  // Job 409 (212.16-218.07): the QR went big and centred on the scan sentence, and five seconds later
  // the voice said "lift your phone toward the pattern in the corner of the screen". Nothing compared
  // the script's placement words with the layout. The Generate dialog now warns on that line, and the
  // voicing stage records the same line on the job — never a refusal. The script is the job's own.
  const SCRIPT_409 = [
    "Then he turns the whole thing over in a single motion: life is not short.", // 1
    "===START CTA(The Stoic Way)===", // 2
    "Some of you are already a page ahead of me, wondering where all of this lives in one place. The thinking belongs to Seneca and the Stoics after him; my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more.", // 3
    "", // 4
    "Chapter twelve stands on today’s exact ground — time, legacy, and what the remaining years are for. Getting there is one small motion: lift your phone toward the pattern in the corner of the screen and tap what rises, or find the first line of the description below. No timer on this — a lesson about hurry is a poor place to hurry you.", // 5
    "", // 6
    "Now, back to that door you have been holding open.", // 7
    "===END CTA===", // 8
    "Bye.", // 9
  ].join("\n");
  const cta = (index: number, scriptText: string) =>
    ({ index, scriptText, hostPresent: true, cta: true, ctaIndex: 0, showSubject: "x" }) as StoryboardScene;
  const scenesOf = (scanLine: string) => [
    host(1, "Then he turns the whole thing over in a single motion: life is not short.", { hostOpener: true }),
    cta(2, "Some of you are already a page ahead of me, wondering where all of this lives in one place. The thinking belongs to Seneca and the Stoics after him; my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more."),
    cta(3, `Chapter twelve stands on today’s exact ground — time, legacy, and what the remaining years are for. ${scanLine}`),
    cta(4, "No timer on this — a lesson about hurry is a poor place to hurry you. Now, back to that door you have been holding open."),
    host(5, "Bye."),
  ];
  const SCAN_409 =
    "Getting there is one small motion: lift your phone toward the pattern in the corner of the screen and tap what rises, or find the first line of the description below.";
  const params = { qrImageUrl: "q.png", bookTitle: "The Stoic Way", bookCoverImageUrl: "c.png" } as any;

  it("the job records the line the card contradicts, in the Generate dialog's own words", () => {
    const out = markCtaQrBlock(scenesOf(SCAN_409), params, true);
    expect(out.find(s => s.qrHero)?.scriptText).toMatch(/^Getting there is one small motion/);
    const warnings = ctaPlacementJobWarnings(SCRIPT_409, out);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Line 5 says the code is at "the corner of the screen"/);
    expect(checkScript(SCRIPT_409).warnings.map(w => w.message)).toEqual(warnings);
    expect(checkScript(SCRIPT_409).problems).toEqual([]);
  });

  it("with no QR or book there is no big card to contradict, so the job records nothing", () => {
    const out = markCtaQrBlock(scenesOf(SCAN_409), {} as any, true);
    expect(out.some(s => s.qrHero)).toBe(false);
    expect(ctaPlacementJobWarnings(SCRIPT_409, out)).toEqual([]);
  });

  it("a scan line that says 'on your screen' and 'below' for the link is left alone", () => {
    const clean =
      "Getting there is one small motion: lift your phone toward the code on your screen and tap what rises, or find the first line of the description below.";
    const script = SCRIPT_409.replace(SCAN_409, clean);
    const out = markCtaQrBlock(scenesOf(clean), params, true);
    expect(out.some(s => s.qrHero)).toBe(true);
    expect(ctaPlacementJobWarnings(script, out)).toEqual([]);
    expect(checkScript(script)).toEqual({ problems: [], warnings: [] });
  });

  it("job 400's card started after the corner line, so the corner was right and the job records nothing", () => {
    // Job 400, the same script: the pipeline of its day missed the scan sentence and the card took
    // only the block's last words (scene 38), so "the pattern in the corner" was spoken over the host
    // with the small corner card (scene 37). The Generate dialog cannot know the cuts and still
    // warns; the job records only a line the film speaks under the big card. The scenes as stored.
    const stored = [
      cta(35, "Some of you are already a page ahead of me, wondering where all of this lives in one place."),
      { ...cta(36, "The thinking belongs to Seneca and the Stoics after him;"), hostPresent: false, coverHero: true },
      cta(37, `my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more. Chapter twelve stands on today’s exact ground — time, legacy, and what the remaining years are for. ${SCAN_409}`),
      { ...cta(38, "No timer on this — a lesson about hurry is a poor place to hurry you. Now, back to that door you have been holding open."), hostPresent: false, qrHero: true, qrTail: true },
    ] as StoryboardScene[];
    expect(checkScript(SCRIPT_409).warnings).toHaveLength(1);
    expect(ctaPlacementJobWarnings(SCRIPT_409, stored)).toEqual([]);
    // Job 409's storyboard of the same block: the card from the scan sentence on — recorded.
    const s409 = [
      ...stored.slice(0, 2),
      cta(37, "my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more. Chapter twelve stands on today’s exact ground — time, legacy, and what the remaining years are for."),
      { ...cta(38, `${SCAN_409} No timer on this — a lesson about hurry is a poor place to hurry you. Now, back to that door you have been holding open.`), hostPresent: false, qrHero: true, qrTail: true },
    ] as StoryboardScene[];
    expect(ctaPlacementJobWarnings(SCRIPT_409, s409)).toHaveLength(1);
  });
});

describe("the graphics planner sees the picture (round 13 verification films, 2026-10-18)", () => {
  // The planner read each scene as "#22 1:40.7-1:49.9 B-ROLL: <words>": time, kind and words, never
  // what the picture shows. 409: "Paulinus" (the man the essay was written TO, named over the picture)
  // went on the still of Seneca writing, labelled "Seneca" 2 s earlier. 408: a full-screen Versus card
  // hid the whole of scene 3, a paid video in production. 410: a full-screen StepCards card hid all
  // three step pictures for 8.3 s. Plans, words and scenes are the stored ones (local DB, read only).
  const words = (s: string) =>
    s.split(" ").map(t => {
      const [text, range] = t.split("@");
      const [start, end] = range.split("-").map(Number);
      return { text, start, end };
    });
  /** The model answers `first`, then repairs to `repaired` (the cues that passed — a repair returns
   * the whole list), then adds nothing; what it was told is kept. */
  const asking = (first: object[], repaired: object[] = []) => {
    const told: string[] = [];
    const ask = async (_system: string, messages: { content: string }[]) => {
      told.push(messages[messages.length - 1].content);
      return JSON.stringify({ cues: told.length === 1 ? first : told.length === 2 ? repaired : [] });
    };
    return { ask, told };
  };
  /** A storyboard scene as `filmLayoutOf` reads it, its picture through `pictureOf`. */
  const shot = async (index: number, a: number, b: number, s: Record<string, unknown> = {}) => {
    const { pictureOf } = await import("../graphics/src/plan/pictures");
    return { index, narrationStartSec: a, narrationEndSec: b, hostPresent: !!s.hostPresent, cta: !!s.cta, split: false, hostOpener: false, ...pictureOf(s) };
  };
  /** The same film as the planner read it before: no picture fields. */
  const blind = (film: { scenes: object[] }) => ({
    scenes: film.scenes.map(s => {
      const { shows: _a, person: _b, things: _c, video: _d, listItem: _e, ...rest } = s as Record<string, unknown>;
      return rest as unknown as { index: number; narrationStartSec: number; narrationEndSec: number };
    }),
  });

  // 409, 1:40.9-1:57.8, as heard.
  const seneca = words(
    "2,000@100.895-101.175 years@101.215-101.455 ago,@101.535-101.835 a@102.175-102.215 man@102.275-102.516 named@102.576-102.816 Lucius@102.916-103.456 Anaeus@103.616-104.036 Seneca@104.096-104.616 wrote@104.836-105.056 a@105.076-105.116 short,@105.256-105.596 furious,@105.976-106.597 loving@106.917-107.257 essay@107.417-107.797 to@107.877-107.997 a@108.057-108.097 man@108.157-108.377 named@108.437-108.677 Paulinus,@108.757-109.437 the@109.977-110.077 official@110.117-110.538 in@110.618-110.678 charge@110.738-111.038 of@111.078-111.138 Rome's@111.218-111.538 grain@111.598-111.918 supply,@111.958-112.438 busy,@112.978-113.358 important,@113.698-114.278 and@114.679-114.779 worn@114.859-115.219 down@115.279-115.539 to@115.599-115.719 the@115.739-115.839 rims.@115.959-116.299 Seneca@117.415-117.835"
  );
  const senecaFilm = async () => ({
    scenes: [
      await shot(21, 94.7266, 100.675, { stillImage: true, showSubject: "the host writing a short numbered list of seven lines on a notepad at his desk" }),
      await shot(22, 100.675, 109.896, { stillImage: true, showSubject: "a man in an off-white wool toga draped over his left shoulder in deep folds, writing on a scroll with a reed pen by lamplight, seen from the side", otherPerson: "Seneca, a Roman writer" }),
      await shot(23, 109.896, 117.23, { stillImage: true, showSubject: "a tired official in an off-white draped toga sitting among stacked scrolls beside sacks of grain, seen from the side", otherPerson: "a Roman grain official" }),
      await shot(24, 117.23, 119.963, { hostPresent: true }),
    ],
  });
  const senecaCuts = [94.7266, 100.675, 109.896, 117.23];
  const senecaName = { id: "seneca-name", end: "Seneca wrote a short,", props: { at: "@Seneca", text: "Seneca" }, start: "Seneca wrote a short, furious, loving", endPad: 0.3, startPad: -0.15, template: "SmallLabel" };
  const paulinus = { id: "paulinus-label", end: "a man named Paulinus,", props: { at: "@Paulinus", text: "Paulinus" }, start: "to a man named Paulinus,", endPad: 0.3, startPad: -0.15, template: "SmallLabel" };

  it("409: the planner is told who the picture shows; 'Seneca' on Seneca is kept, 'Paulinus' on him is refused and the repair told why", async () => {
    const { planGraphics, userPrompt } = await import("../graphics/src/plan/planner");
    const film = await senecaFilm();
    expect(userPrompt(film, [], seneca)).toContain(
      "#22 1:40.7-1:49.9 B-ROLL STILL {shows: a man in an off-white wool toga draped over his left shoulder in deep folds, writing on a scroll with a reed pen by lamplight, seen from…; person: Seneca, a Roman writer}: "
    );
    const { ask, told } = asking([senecaName, paulinus], [senecaName]);
    const out = await planGraphics({ words: seneca, cuts: senecaCuts, film, ask, ensureIcon: async () => true });
    expect(out.cues.map(c => c.id)).toEqual(["seneca-name"]);
    expect(out.rounds[0].problems).toEqual([{ cue: "paulinus-label", problem: expect.stringMatching(/^"Paulinus" is not what the picture under it shows — scene #22 shows "Seneca, a Roman writer"/) }]);
    expect(told[1]).toContain('paulinus-label: "Paulinus" is not what the picture under it shows');
  });

  it("409 as the planner read it before (no picture fields): 'Paulinus' is still refused — one picture, one name", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    const { ask } = asking([senecaName, paulinus], [senecaName]);
    const out = await planGraphics({ words: seneca, cuts: senecaCuts, film: blind(await senecaFilm()), ask, ensureIcon: async () => true });
    expect(out.cues.map(c => c.id)).toEqual(["seneca-name"]);
    expect(out.rounds[0].problems).toEqual([{ cue: "paulinus-label", problem: expect.stringMatching(/^the picture of scene #22 is already labelled "Seneca" \(seneca-name\) — one picture, one name/) }]);
  });

  // 408, 0:02.4-0:21.8, as heard.
  const bathroom = words(
    "that@2.431-2.572 little@2.652-2.872 stretch@2.932-3.212 of@3.232-3.292 tile@3.392-3.752 between@3.812-4.092 the@4.132-4.212 bowl@4.272-4.572 and@4.652-4.752 the@4.772-4.852 wall.@4.892-5.192 In@5.832-5.912 most@5.972-6.172 American@6.232-6.632 bathrooms,@6.672-7.212 it@7.453-7.513 is@7.573-7.653 empty.@7.813-8.173 In@8.793-8.873 a@8.913-8.953 German@9.053-9.413 bathroom,@9.453-9.953 usually,@10.313-10.653 a@11.113-11.153 small@11.233-11.493 bin@11.573-11.833 stands@11.893-12.173 there,@12.233-12.454 with@12.714-12.834 a@12.894-12.934 lid.@12.974-13.234 It@13.894-13.954 is@13.994-14.054 the@14.094-14.194 answer@14.314-14.574 to@14.614-14.734 one@14.934-15.054 plain@15.154-15.474 sentence@15.554-16.014 the@16.054-16.174 water@16.214-16.514 utilities@16.594-17.074 in@17.155-17.215 Germany@17.255-17.675 have@17.715-17.855 repeated@17.895-18.375 for@18.455-18.575 years.@18.655-19.035 The@19.675-19.775 toilet@19.855-20.255 is@20.435-20.515 not@20.675-20.955 a@21.075-21.115 trash@21.175-21.475 can.@21.495-21.775"
  );
  const bin = "a small white plastic bin with a closed hinged lid on pale beige tile floor beside the base of a white porcelain toilet, water swirling in the bowl as it flushes";
  const bathroomFilm = async (thirdIsStill = false) => ({
    scenes: [
      await shot(1, 0, 2.1165, { hostPresent: true }),
      await shot(2, 2.1165, 7.28991, { objectMotion: true, showSubject: bin, keyThing: "bin", otherKeyThings: ["toilet"] }),
      await shot(3, 7.28991, 13.7519, { objectMotion: true, stillImage: thirdIsStill, showSubject: `${bin}, a close-up of one detail of it filling the frame`, keyThing: "bin", otherKeyThings: ["toilet"] }),
      await shot(4, 13.7519, 22.2734, { hostPresent: true }),
    ],
  });
  const bathroomCuts = [2.1165, 7.28991, 13.7519];
  const versus = {
    id: "american-vs-german-floor",
    end: "stands there, with a lid.",
    props: {
      left: { at: "@In most American bathrooms", say: "In most American bathrooms, it is empty", sub: "It is empty", title: "American bathroom" },
      right: { at: "@In a German bathroom", say: "a small bin stands there, with a lid", sub: "A small bin, with a lid", title: "German bathroom" },
      kicker: "Beside the toilet",
      winner: "none",
    },
    start: "In most American bathrooms, it",
    endPad: 0.3,
    startPad: -0.15,
    template: "Versus",
  };

  it("408: the Versus card that hid the whole of video scene 3 is refused; told it is a VIDEO, the repair is pointed over the footage", async () => {
    const { planGraphics, userPrompt } = await import("../graphics/src/plan/planner");
    const film = await bathroomFilm();
    expect(userPrompt(film, [], bathroom)).toMatch(/#3 0:07\.3-0:13\.8 B-ROLL VIDEO \{shows: a small white plastic bin/);
    const { ask, told } = asking([versus]);
    const out = await planGraphics({ words: bathroom, cuts: bathroomCuts, film, ask, ensureIcon: async () => true });
    expect(out.cues).toEqual([]);
    expect(out.rounds[0].problems).toEqual([
      { cue: "american-vs-german-floor", problem: expect.stringMatching(/^Versus hides the picture, and scene #3 is a moving VIDEO: it would be in view only 0\.00 s of its 6\.46 s \(at least 1\.5 s\)/) },
    ]);
    expect(told[1]).toContain("show the line over the footage");
  });

  it("408: the same card over the same words is kept when scene 3 is a still, and when the film does not say (as before)", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    for (const film of [await bathroomFilm(true), blind(await bathroomFilm())]) {
      const out = await planGraphics({ words: bathroom, cuts: bathroomCuts, film, ask: asking([versus]).ask, ensureIcon: async () => true });
      expect(out.cues.map(c => c.id)).toEqual(["american-vs-german-floor"]);
      expect(out.rounds[0].problems).toEqual([]);
    }
  });

  // 410, 2:21.1-2:29.1, as heard: "So wait until everyone's been served, then catch a flight attendant
  // as they pass or step back to the galley and phrase it as an offer." — one picture per step.
  const snack = words(
    "So@141.115-141.275 wait@141.355-141.555 until@141.595-141.875 everyone's@142.015-142.415 been@142.455-142.615 served,@142.675-143.115 then@143.496-143.716 catch@143.756-143.996 a@144.036-144.056 flight@144.096-144.336 attendant@144.356-144.736 as@144.796-144.876 they@144.916-145.056 pass@145.116-145.556 or@146.076-146.276 step@146.356-146.596 back@146.636-146.796 to@146.836-146.936 the@146.956-147.016 galley@147.056-147.477 and@147.757-147.857 phrase@147.917-148.197 it@148.257-148.317 as@148.417-148.497 an@148.537-148.597 offer.@148.737-149.057"
  );
  const snackFilm = async (steps = true) => ({
    scenes: [
      await shot(28, 128.869, 141.288, { stillImage: true, showSubject: "a flight attendant handing pretzel bags to passengers in the last rows of the cabin", otherPerson: "a flight attendant and passengers", keyThing: "pretzel bag" }),
      await shot(29, 141.288, 143.286, { stillImage: true, listCut: steps, listKind: "steps", showSubject: "rows of passengers each holding a snack and a drink" }),
      await shot(30, 143.286, 147.619, { stillImage: true, listCut: steps, listKind: "steps", showSubject: "an older passenger seen from behind standing at the galley speaking to a flight attendant", otherPerson: "an older passenger and a flight attendant" }),
      await shot(31, 147.619, 149.553, { stillImage: true, listCut: steps, listKind: "steps", showSubject: "a flight attendant smiling and handing a cookie to an older passenger at the galley", otherPerson: "a flight attendant and an older passenger", keyThing: "cookie" }),
      await shot(32, 149.553, 163.498, { hostPresent: true, cta: true }),
    ],
  });
  const snackCuts = [128.869, 141.288, 143.286, 147.619, 149.553];
  const stepCards = {
    id: "snack-steps",
    end: "phrase it as an offer.",
    props: {
      steps: [
        { at: "@wait until everyone's been served", text: "Wait until all served" },
        { at: "@then catch a flight attendant", text: "Ask in aisle or galley" },
        { at: "@and phrase it as an offer", text: "Phrase it as offer" },
      ],
      kicker: "The second snack",
    },
    start: "wait until everyone's been served,",
    endPad: 0.1,
    startPad: -0.15,
    template: "StepCards",
  };

  it("410: the step card over the three step pictures is refused, and the repair is pointed to StepLabels over the footage", async () => {
    const { planGraphics, userPrompt } = await import("../graphics/src/plan/planner");
    const film = await snackFilm();
    expect(userPrompt(film, [], snack)).toContain(
      "#30 2:23.3-2:27.6 B-ROLL STILL, STEP PICTURE {shows: an older passenger seen from behind standing at the galley speaking to a flight attendant; person: an older passenger and a flight attendant}: "
    );
    const { ask, told } = asking([stepCards]);
    const out = await planGraphics({ words: snack, cuts: snackCuts, film, ask, ensureIcon: async () => true });
    expect(out.cues).toEqual([]);
    // Its steps are not all his words either ("all", "ask", "aisle"): a cue has one repair round, so it
    // is told both at once (see the step-wording cases at the end of this file).
    expect(out.rounds[0].problems).toEqual([
      {
        cue: "snack-steps",
        problem: expect.stringMatching(
          /^step 1 \("Wait until all served"\) shows "all", which the narrator does not say.* Also: StepCards hides the pictures of 3 spoken steps \(scenes #29, #30, #31\), each drawn for its own step\. Show them over the footage, which leaves every picture in view — StepLabels for the steps, a DimCaption for a line — or drop it$/
        ),
      },
    ]);
    expect(told[1]).toContain("StepLabels");
  });

  it("410: the same steps as StepLabels over those pictures are kept; the card is kept where the steps have no pictures of their own", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    // the steps in the narrator's own words, as the repair now writes them
    const steps = [
      { at: "@wait until everyone's been served", text: "Wait until everyone's been served" },
      { at: "@then catch a flight attendant", text: "Catch a flight attendant" },
      { at: "@and phrase it as an offer", text: "Phrase it as an offer" },
    ];
    const labels = { ...stepCards, id: "snack-step-labels", template: "StepLabels", props: { steps } };
    const over = await planGraphics({ words: snack, cuts: snackCuts, film: await snackFilm(), ask: asking([labels]).ask, ensureIcon: async () => true });
    expect(over.rounds[0].problems).toEqual([]);
    expect(over.cues.map(c => c.id)).toEqual(["snack-step-labels"]);
    const card = await planGraphics({ words: snack, cuts: snackCuts, film: await snackFilm(false), ask: asking([{ ...stepCards, props: { ...stepCards.props, steps } }]).ask, ensureIcon: async () => true });
    expect(card.cues.map(c => c.id)).toEqual(["snack-steps"]);
  });
});

describe("a list row and a step are the narrator's words, whole (round 13 verification films, 2026-10-18)", () => {
  // 409 (2:36-2:44): the "Everyone complains" window's last row read "The young are already rehearsing"
  // for "and the young are already rehearsing the complaint" — cut to fit, it stopped on a verb with
  // what it takes cut off. 410 (2:21-2:29): the step card read "Wait until all served → Ask in aisle or
  // galley → Phrase it as offer" for "…wait until everyone's been served, then catch a flight attendant
  // as they pass or step back to the galley and phrase it as an offer". Plans and words as stored.
  const words = (s: string) =>
    s.split(" ").map(t => {
      const [text, range] = t.split("@");
      const [start, end] = range.split("-").map(Number);
      return { text, start, end };
    });
  const scene = (index: number, a: number, b: number, extra: Record<string, unknown> = {}) => ({ index, narrationStartSec: a, narrationEndSec: b, scriptText: "", hostPresent: false, cta: false, split: false, hostOpener: false, ...extra });
  const asking = (answers: object[][]) => {
    const told: string[] = [];
    const ask = async (_system: string, messages: { content: string }[]) => {
      told.push(messages[messages.length - 1].content);
      return JSON.stringify({ cues: answers[told.length - 1] ?? [] });
    };
    return { ask, told };
  };

  const complaints = words(
    "says.@155.259-155.519 The@156.2-156.3 farmer@156.38-156.72 complains,@156.76-157.38 the@157.68-157.8 senator@157.88-158.3 complains,@158.36-158.98 the@159.36-159.48 old@159.681-159.881 complain,@159.981-160.561 and@160.941-161.041 the@161.081-161.161 young@161.221-161.561 are@161.721-161.821 already@161.941-162.321 rehearsing@162.381-162.961 the@163.001-163.081 complaint.@163.121-163.582 Then@164.282-164.462 he@164.522-164.622 turns@164.682-164.982 the@165.042-165.162 whole@165.282-165.522"
  );
  const complaintsFilm = {
    scenes: [
      scene(28, 144.48, 156.11, { scriptText: "Everyone complains that life is too short, Seneca says." }),
      scene(29, 156.11, 157.59, { scriptText: "The farmer complains,", listItem: "item" }),
      scene(30, 157.59, 159.28, { scriptText: "the senator complains,", listItem: "item" }),
      scene(31, 159.28, 160.85, { scriptText: "the old complain,", listItem: "item" }),
      scene(32, 160.85, 164.13, { scriptText: "and the young are already rehearsing the complaint.", listItem: "item" }),
      scene(33, 164.13, 170.51, { scriptText: "Then he turns the whole thing over in a single motion: life is not short." }),
    ],
  };
  const everyone = {
    id: "everyone-complains",
    end: "already rehearsing the complaint.",
    props: {
      items: [
        { at: "@The farmer complains", say: "The farmer complains", text: "The farmer complains" },
        { at: "@the senator complains", say: "the senator complains", text: "The senator complains" },
        { at: "@the old complain", say: "the old complain", text: "The old complain" },
        { at: "@the young are already", say: "the young are already rehearsing the complaint", text: "The young are already rehearsing" },
      ],
      title: "Everyone complains",
    },
    start: "The farmer complains, the senator complains,",
    endPad: 0.3,
    startPad: 0,
    template: "ListWindow",
  };

  it("409: the last row keeps 'the complaint' and leaves out 'already' to fit; the other rows are untouched", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    const out = await planGraphics({ words: complaints, cuts: [144.48, 156.11, 157.59, 159.28, 160.85, 164.13], film: complaintsFilm, ask: asking([[everyone]]).ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([]);
    expect((out.cues[0].props.items as { text: string }[]).map(i => i.text)).toEqual(["The farmer complains", "The senator complains", "The old complain", "The young are rehearsing the complaint"]);
  });

  it("409: a row the planner shortened in its own words, ending where the item may end, stays as written ('The kitchen table', 'What the remaining years are for')", async () => {
    const { keepObject, objectCutOff } = await import("../graphics/src/plan/planner");
    for (const [row, say] of [
      ["The kitchen table", "the kitchen table at two in the morning"],
      ["What the remaining years are for", "what the remaining years are actually for"],
    ]) {
      expect(objectCutOff(row, say)).toBeUndefined();
      expect(keepObject(row, say, 6)).toBe(row);
    }
  });

  const snack = words(
    "So@141.115-141.275 wait@141.355-141.555 until@141.595-141.875 everyone's@142.015-142.415 been@142.455-142.615 served,@142.675-143.115 then@143.496-143.716 catch@143.756-143.996 a@144.036-144.056 flight@144.096-144.336 attendant@144.356-144.736 as@144.796-144.876 they@144.916-145.056 pass@145.116-145.556 or@146.076-146.276 step@146.356-146.596 back@146.636-146.796 to@146.836-146.936 the@146.956-147.016 galley@147.056-147.477 and@147.757-147.857 phrase@147.917-148.197 it@148.257-148.317 as@148.417-148.497 an@148.537-148.597 offer.@148.737-149.057"
  );
  const snackFilm = {
    scenes: [
      scene(28, 128.87, 141.29, { scriptText: "…and you're asking the crew to guess whether the last few rows will come up short. So" }),
      scene(29, 141.29, 143.29, { scriptText: "wait until everyone's been served,", listItem: "step" }),
      scene(30, 143.29, 147.62, { scriptText: "then catch a flight attendant as they pass, or step back to the galley,", listItem: "step" }),
      scene(31, 147.62, 149.55, { scriptText: "and phrase it as an offer.", listItem: "step" }),
      scene(32, 149.55, 163.5, { hostPresent: true, scriptText: "Two asks in, you might wonder how anyone keeps this straight." }),
    ],
  };
  const snackCuts = [128.87, 141.29, 143.29, 147.62, 149.55];
  const snackSteps = {
    id: "snack-steps",
    end: "phrase it as an offer.",
    props: {
      steps: [
        { at: "@wait until everyone's been served", text: "Wait until all served" },
        { at: "@then catch a flight attendant", text: "Ask in aisle or galley" },
        { at: "@and phrase it as an offer", text: "Phrase it as offer" },
      ],
      kicker: "The second snack",
    },
    start: "wait until everyone's been served,",
    endPad: 0.1,
    startPad: -0.15,
    template: "StepCards",
  };

  it("410: the card is told in one round that its steps are not his words AND that it hides the step pictures; the repair, StepLabels in his words, is kept with 'an offer'", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    const repaired = {
      ...snackSteps,
      id: "snack-step-labels",
      template: "StepLabels",
      props: {
        steps: [
          { at: "@wait until everyone's been served", text: "Wait until everyone's been served" },
          { at: "@then catch a flight attendant", text: "Catch a flight attendant" },
          { at: "@and phrase it as an offer", text: "Phrase it as offer" },
        ],
      },
    };
    const { ask, told } = asking([[snackSteps], [repaired]]);
    const out = await planGraphics({ words: snack, cuts: snackCuts, film: snackFilm, ask, ensureIcon: async () => true });
    const [p] = out.rounds[0].problems;
    expect(p.cue).toBe("snack-steps");
    expect(p.problem).toContain(`step 1 ("Wait until all served") shows "all", which the narrator does not say — a step is his own words, shortened (he says "wait until everyone's been served")`);
    expect(p.problem).toContain(`step 2 ("Ask in aisle or galley") shows "ask", "in", "aisle", which the narrator does not say`);
    expect(p.problem).toContain("Also: StepCards hides the pictures of 3 spoken steps (scenes #29, #30, #31)");
    // "Phrase it as offer" is no problem: its "an" is put back, never sent for repair
    expect(p.problem).not.toContain("Phrase it as offer");
    expect(told[1]).toContain(`he says "wait until everyone's been served"`);
    expect(out.rounds[1].problems).toEqual([]);
    expect(out.cues.map(c => c.id)).toEqual(["snack-step-labels"]);
    expect((out.cues[0].props.steps as { text: string }[]).map(s => s.text)).toEqual(["Wait until everyone's been served", "Catch a flight attendant", "Phrase it as an offer"]);
  });

  it("a chain of steps on the narrator's words is kept exactly as written (Frederick's job 385)", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    const said = "So get a stepladder, take one alarm down, and read the label.".split(" ").map((text, i) => ({ text, start: 60 + i * 0.3, end: 60 + i * 0.3 + 0.26 }));
    const steps = {
      id: "07-step-labels",
      template: "StepLabels",
      start: "So get a stepladder",
      startPad: -0.15,
      end: "read the label.",
      endPad: 0.3,
      props: { steps: [{ text: "Get a stepladder", at: "@get a stepladder" }, { text: "Take one alarm down", at: "@take one alarm down" }, { text: "Read the label", at: "@read the label" }] },
    };
    const out = await planGraphics({ words: said, film: { scenes: [scene(12, 59, 65, { scriptText: said.map(w => w.text).join(" ") })] }, ask: asking([[steps]]).ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([]);
    expect((out.cues[0].props.steps as { text: string }[]).map(s => s.text)).toEqual(["Get a stepladder", "Take one alarm down", "Read the label"]);
  });

  it("410: the steps given back their words are the steps placed and timed — the placed graphic shows 'an offer' and holds for its words", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    const { readingSec } = await import("../graphics/src/cueResolve");
    const labels = {
      ...snackSteps,
      id: "snack-step-labels",
      template: "StepLabels",
      start: "then catch a flight attendant",
      props: { steps: [{ at: "@then catch a flight attendant", text: "Catch" }, { at: "@and phrase it as an offer", text: "Phrase it as offer" }] },
    };
    const out = await planGraphics({ words: snack, cuts: snackCuts, film: snackFilm, ask: asking([[labels]]).ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([]);
    const placed = out.resolved.find(r => r.id === "snack-step-labels")!;
    expect((placed.props.steps as { text: string }[]).map(s => s.text)).toEqual(["Catch a flight attendant", "Phrase it as an offer"]);
    // read for the 9 words drawn (3.7 s), not the 5 the planner wrote (2.5 s)
    expect(placed.readSec).toBe(Math.round(readingSec(out.cues[0].props) * 1000) / 1000);
    expect(placed.readSec).toBeGreaterThan(readingSec(labels.props));
  });
});

describe("a comparison's sub comes with its words, and a number leaves with its own (round 13 verification films, 2026-10-18)", () => {
  // 408 (0:05-0:13): the Versus card showed "It is empty" 1.6 s before it was said and "A small bin, with
  // a lid" 2.3 s early, under "In a German bathroom, usually," — the reveal given away — and its VS
  // badge pointed at an empty half for 2.8 s. 408 (0:22-0:26): the "9 things" overlay stood 2.1 s over
  // "…, and in plenty of American homes," — the contrast to its line — and QA said nothing. Plans and
  // words as stored.
  const words = (s: string) =>
    s.split(" ").map(t => {
      const [text, range] = t.split("@");
      const [start, end] = range.split("-").map(Number);
      return { text, start, end };
    });
  const said = words(
    "In@5.832-5.912 most@5.972-6.172 American@6.232-6.632 bathrooms,@6.672-7.212 it@7.453-7.513 is@7.573-7.653 empty.@7.813-8.173 In@8.793-8.873 a@8.913-8.953 German@9.053-9.413 bathroom,@9.453-9.953 usually,@10.313-10.653 a@11.113-11.153 small@11.233-11.493 bin@11.573-11.833 stands@11.893-12.173 there,@12.233-12.454 with@12.714-12.834 a@12.894-12.934 lid.@12.974-13.234 It@13.894-13.954 " +
      "can.@21.495-21.775 Nine@22.456-22.696 things@22.776-23.056 stay@23.116-23.356 out@23.456-23.576 of@23.616-23.656 the@23.696-23.776 toilet@23.836-24.216 there,@24.236-24.476 and@24.916-25.016 in@25.056-25.116 plenty@25.236-25.596 of@25.636-25.696 American@25.756-26.156 homes,@26.196-26.516 most@26.937-27.157 of@27.177-27.237"
  );
  const cuts = [2.12, 7.29, 13.75, 22.27, 30.03];
  const versus = {
    id: "american-vs-german-floor",
    template: "Versus",
    start: "In most American bathrooms, it",
    startPad: -0.15,
    end: "stands there, with a lid.",
    endPad: 0.3,
    props: {
      kicker: "Beside the toilet",
      winner: "none",
      left: { at: "@In most American bathrooms", say: "In most American bathrooms, it is empty", sub: "It is empty", title: "American bathroom" },
      right: { at: "@In a German bathroom", say: "a small bin stands there, with a lid", sub: "A small bin, with a lid", title: "German bathroom" },
    },
  };
  const nine = { id: "nine-things-out", template: "BigNumberOverlay", start: "Nine things stay out of", startPad: -0.15, end: "the toilet there,", endPad: 0.3, props: { at: "@Nine", line: { text: "Nine things stay out of the toilet there", words: true }, unit: "things", value: 9, kicker: "Out of the toilet", countSec: 0.6 } };

  it("408: each sub is timed to its own words, and QA reads it there", async () => {
    const { resolveCues } = await import("../graphics/src/cueResolve");
    const { resolveSets } = await import("../graphics/src/registry");
    const [c] = resolveCues([versus], said, { cuts, fps: 30, ...resolveSets() });
    const [left, right] = [c.props.left, c.props.right] as { at: number; subAt: number }[];
    // "It is empty" on "it" (7.45), "A small bin, with a lid" on "a small bin" (11.11)
    expect([c.start + left.subAt, c.start + right.subAt].map(t => Math.round(t * 1000) / 1000)).toEqual([7.453, 11.113]);
    expect(right.subAt - right.at).toBeGreaterThan(2.2);
    expect(c.sync.filter(s => s.prop).map(s => s.prop)).toEqual(["left.subAt", "right.subAt"]);
  });

  it("408: the '9 things' overlay leaves 0.6 s after 'there,', and as shipped QA reports it", async () => {
    const { resolveCues, stillUpAfterWords } = await import("../graphics/src/cueResolve");
    const { resolveSets } = await import("../graphics/src/registry");
    const placed = resolveCues([versus, nine], said, { cuts, fps: 30, ...resolveSets() }).find(c => c.id === "nine-things-out")!;
    expect([placed.start, placed.end, placed.spokenEnd]).toEqual([22.267, 25.1, 24.476]);
    expect(stillUpAfterWords(placed, 30)).toBe(false);
    expect(stillUpAfterWords({ ...placed, end: 26.6, endFrame: 798, leftInPause: true }, 30)).toBe(true);
  });
});

describe("the host's name card sits on the introduction (round 13 verification films, 2026-10-18)", () => {
  // Self-introduction takes are short by design — the host hands over to a picture a few words after
  // the name — and the card asked for 3 s (a fixed 0.5 s wait, 0.5 s fades and a 1.5 s hold) plus a
  // 0.1 s margin. 409's "My name is Gideon Grant, and this channel is for" (3.07 s) missed by 0.025 s
  // and the card went to the first host take from the START of the film, 11 s before the name; 410's
  // "I'm Helena Hart, and I read the fine print" (2.51 s) sent it a minute later, onto "One more thing
  // about drinks…"; 411's "I'm Walter, …" (2.62 s) sent it to the opening line, 30 s before the name.
  // Each film's scenes as stored (their slices of the master), as assembly measures them.
  const H = { hostPresent: true } as const;
  const SPLIT = { hostPresent: true, splitRightUrl: "https://r2.example/split.jpg" } as const;
  type Row = [number, number, Partial<StoryboardScene>?];
  const filmOf = async (rows: Row[]) => {
    const { assembledSceneSecs } = await import("./longformVideo");
    return {
      scenes: rows.map(([, , f]) => ({ ...(f ?? {}) }) as StoryboardScene),
      secs: assembledSceneSecs(rows.map(([a, b]) => ({ sliceStartSec: a, sliceEndSec: b, audioDurationSec: undefined }))),
    };
  };
  const gideon = (intro: [number, number] = [67.3134, 70.388]): Row[] => [
    [0, 3.01075, { ...H, hostOpener: true }],
    [3.01075, 12.937],
    [12.937, 17.2378],
    [17.2378, 24.901, SPLIT],
    [24.901, 31.7654],
    [31.7654, 39.8564],
    [39.8564, 49.106, SPLIT],
    [49.106, 50.2075],
    [50.2075, 51.5511],
    [51.5511, 55.6569],
    [55.6569, 61.7232, H], // "And the math always presents itself as the problem. …" — the card went here
    [61.7232, intro[0]],
    [intro[0], intro[1], { ...H, hostIntro: true }], // "My name is Gideon Grant, and this channel is for"
    [intro[1], 76.0756],
    [76.0756, 76.8483],
    [76.8483, 77.6837],
    [77.6837, 79.0389],
    [79.0389, 82.1842],
    [82.1842, 92.10735],
    [92.10735, 94.7266, H], // "Your problem is theft,"
    [94.7266, 100.675],
  ];
  const helena: Row[] = [
    [0, 2.20081, { ...H, hostOpener: true }],
    [2.20081, 5.75244],
    [5.75244, 12.1],
    [12.1, 13.7468],
    [13.7468, 15.4539],
    [15.4539, 17.8119],
    [17.8119, 25.1146],
    [25.1146, 31.473],
    [31.473, 33.983, { ...H, hostIntro: true }], // "I'm Helena Hart, and I read the fine print"
    [33.983, 37.8661],
    [37.8661, 43.59, SPLIT],
    [43.59, 44.37],
    [44.37, 44.93955],
    [44.93955, 46.5846],
    [46.5846, 55.0921],
    [55.0921, 69.6498],
    [69.6498, 74.0742],
    [74.0742, 81.0643, SPLIT],
    [81.0643, 86.1486],
    [86.1486, 92.3571],
    [92.3571, 96.509, H], // "One more thing about drinks, …" — the card went here
    [96.509, 108.695],
  ];
  const walter = (intro: [number, number] = [34.1683, 36.792]): Row[] => [
    [0, 6.08119, { ...H, hostOpener: true }], // "Every fall, the robins …" — the card went here
    [6.08119, 10.614],
    [10.614, 17.6771],
    [17.6771, 26.7464, SPLIT],
    [26.7464, intro[0]],
    [intro[0], intro[1], { ...H, hostIntro: true }], // "I'm Walter, and if you keep an eye on the yard from"
    [intro[1], 39.7349],
    [39.7349, 44.4649, H], // "We're going through seven things about the robin …"
    [44.4649, 50.9824],
    [50.9824, 54.9814, SPLIT],
  ];

  it("409: on 'My name is Gideon Grant, and this channel is for', not the take 11 s before it", async () => {
    const { nameCardSceneIndices } = await import("./longformVideo");
    const { nameCardOnWindow } = await import("./videoAssembly");
    const { scenes, secs } = await filmOf(gideon());
    expect(nameCardSceneIndices(scenes, secs)).toEqual([12]);
    // Assembly draws it there, held 1.5 s or more.
    const w = nameCardOnWindow(secs[12]!, true, true)!;
    expect(w.off - w.on).toBeGreaterThanOrEqual(1.5);
  });

  it("410: on 'I'm Helena Hart, and I read the fine print' (2.51 s), the wait cut and the 1.5 s hold kept", async () => {
    const { nameCardSceneIndices } = await import("./longformVideo");
    const { nameCardOnWindow } = await import("./videoAssembly");
    const { scenes, secs } = await filmOf(helena);
    expect(nameCardSceneIndices(scenes, secs)).toEqual([8]);
    const w = nameCardOnWindow(secs[8]!, true, true)!;
    expect(w.delay).toBeLessThan(0.1);
    expect(w.off - w.on).toBeCloseTo(1.5, 6);
    // The graphics are told the same scene, so nothing is planned under the card there.
    const { nameTagRange } = await import("../graphics/src/plan/rules");
    const layout = { scenes: helena.map(([a, b, f], i) => ({ index: i + 1, narrationStartSec: a, narrationEndSec: b, hostPresent: !!f?.hostPresent })), nameCardScenes: [9] };
    expect(nameTagRange(layout)).toEqual([31.473, 33.983]);
  });

  it("411: on 'I'm Walter, …' (2.62 s), not the opening line 30 s before it", async () => {
    const { nameCardSceneIndices } = await import("./longformVideo");
    const { scenes, secs } = await filmOf(walter());
    expect(nameCardSceneIndices(scenes, secs)).toEqual([5]);
  });

  it("an introduction too short even for the shorter edges: the host take right after it, never one before it", async () => {
    const { nameCardSceneIndices } = await import("./longformVideo");
    // Walter's introduction cut to 1.8 s: his next take starts 3.8 s after it — the card goes there.
    const short = await filmOf(walter([34.1683, 35.9683]));
    expect(nameCardSceneIndices(short.scenes, short.secs)).toEqual([7]);
    // Gideon's cut to 1.8 s: his next full-frame take is 23 s after it, too far to be read as his
    // introduction — no card, rather than the take 11 s before the name or the cold open.
    const far = await filmOf(gideon([67.3134, 69.1134]));
    expect(nameCardSceneIndices(far.scenes, far.secs)).toEqual([]);
  });
});

describe("a dimming caption is a glance, and two never come back to back (round 13 verification films, 2026-10-18)", () => {
  // 408 (2:04-2:12): "The toilet is fine." as a caption, the picture back for 1.2 s under "There is a
  // stick in it.", then "If you think one is already in there, the plunger is the wrong tool." — 14
  // words built word by word over two pages, the second opening on a lowercase "the". The catalogue
  // asked for 10 words, the hard limit was 24, and nothing kept two captions apart beyond 1 s. Plans,
  // words and scenes as stored.
  const words = (s: string) =>
    s.split(" ").map(t => {
      const [text, range] = t.split("@");
      const [start, end] = range.split("-").map(Number);
      return { text, start, end };
    });
  const said = words(
    "you@121.996-122.136 decide@122.156-122.556 the@122.797-122.897 toilet@122.957-123.317 is@123.357-123.417 getting@123.457-123.737 old.@123.837-124.017 The@124.717-124.817 toilet@124.857-125.157 is@125.217-125.277 fine.@125.377-125.697 There@126.377-126.497 is@126.557-126.617 a@126.657-126.697 stick@126.777-127.038 in@127.078-127.138 it.@127.198-127.298 " +
      "If@127.898-127.978 you@127.998-128.098 think@128.138-128.318 one@128.438-128.518 is@128.578-128.638 already@128.698-129.018 in@129.078-129.198 there,@129.238-129.478 the@129.778-129.878 plunger@129.958-130.398 is@130.478-130.558 the@130.598-130.678 wrong@130.718-130.938 tool.@130.998-131.319 " +
      "It@131.979-132.039 can@132.059-132.199 push@132.239-132.459 the@132.499-132.599 stick@132.639-132.879 deeper@133.019-133.359 into@133.439-133.599 the@133.639-133.719 curve.@133.779-134.159 A@134.839-134.899 toilet@134.959-135.36"
  );
  const cuts = [118.375, 127.76, 134.693];
  const scene = (index: number, a: number, b: number, extra: Record<string, unknown> = {}) => ({ index, narrationStartSec: a, narrationEndSec: b, scriptText: "", hostPresent: false, cta: false, split: false, hostOpener: false, ...extra });
  const film = {
    scenes: [
      scene(21, 118.375, 127.76, { video: true, scriptText: "Then the next. The toilet starts flushing slow, and you decide the toilet is getting old. The toilet is fine. There is a stick in it." }),
      scene(22, 127.76, 134.693, { scriptText: "If you think one is already in there, the plunger is the wrong tool. It can push the stick deeper into the curve." }),
      scene(23, 134.693, 139.444, { scriptText: "A toilet auger, the short kind made for toilets, can sometimes hook it out." }),
    ],
  };
  const fine = { id: "toilet-is-fine", template: "DimCaption", start: "The toilet is fine. There", startPad: -0.15, end: "The toilet is fine.", endPad: 0.3, props: { phrase: { text: "The toilet is fine.", words: true }, emphasis: ["fine."] } };
  const plunger = {
    id: "plunger-wrong-tool-caption",
    template: "DimCaption",
    start: "If you think one is already",
    startPad: -0.15,
    end: "is the wrong tool.",
    endPad: 0.3,
    props: { phrase: { text: "If you think one is already in there, the plunger is the wrong tool.", words: true }, emphasis: ["wrong"] },
  };
  const asking = (answers: object[][]) => {
    const told: string[] = [];
    const ask = async (_system: string, messages: { content: string }[]) => {
      told.push(messages[messages.length - 1].content);
      return JSON.stringify({ cues: answers[told.length - 1] ?? [] });
    };
    return { ask, told };
  };

  it("408: the 14-word plunger caption is refused for its length, and the planner is told why", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    // The repair answer keeps the one that passed and leaves the long one out.
    const { ask, told } = asking([[fine, plunger], [fine]]);
    const out = await planGraphics({ words: said, cuts, film, ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toContainEqual({
      cue: "plunger-wrong-tool-caption",
      problem: `"If you think one is already in there, the plunger is the wrong tool." is 14 words — DimCaption takes at most 10`,
    });
    expect(told[1]).toContain("DimCaption takes at most 10");
    expect(out.cues.map(c => c.id)).toEqual(["toilet-is-fine"]);
  });

  it("408: as shipped, the pair is refused by the spacing too, so a Reassemble from the saved plan drops the second", async () => {
    const { resolveCues } = await import("../graphics/src/cueResolve");
    const { resolveSets } = await import("../graphics/src/registry");
    const { checkRules } = await import("../graphics/src/plan/rules");
    const resolved = resolveCues([fine, plunger], said, { cuts, fps: 30, ...resolveSets() });
    expect(resolved.map(c => [c.id, c.start, c.end])).toEqual([
      ["toilet-is-fine", 124.567, 126.533],
      ["plunger-wrong-tool-caption", 127.767, 131.767],
    ]);
    expect(checkRules(resolved, film)).toEqual([
      expect.objectContaining({ cue: "plunger-wrong-tool-caption", problem: expect.stringMatching(/^darkens the frame again 1\.2 s after toilet-is-fine — two graphics that darken the picture need 3 s between them/) }),
    ]);
  });

  it("a short caption 3 s or more after the last one is placed (the next sentence on the same picture)", async () => {
    const { planGraphics } = await import("../graphics/src/plan/planner");
    const deeper = { id: "stick-deeper", template: "DimCaption", start: "It can push the stick", startPad: -0.15, end: "deeper into the curve.", endPad: 0.3, props: { phrase: { text: "It can push the stick deeper into the curve.", words: true }, emphasis: ["deeper"] } };
    const out = await planGraphics({ words: said, cuts, film, ask: asking([[fine, deeper]]).ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([]);
    expect(out.cues.map(c => c.id)).toEqual(["toilet-is-fine", "stick-deeper"]);
  });
});

describe("a place lends no picture; a place set again keeps one written look (round 14, jobs 411 and 412)", () => {
  // 411: "lawn" (the northern backyard's) was a key thing, so every picture naming a lawn was drawn
  // from the first empty-yard picture — one yard framing five times in two minutes — and the Gulf Coast
  // panel was drawn from that snowy lawn. 412: the "ankle" list item, drawn from nothing, came back in
  // another bedroom. Rows as stored; the full cases are in placeMemory.test.ts.
  const LAWN = "a wide stretch of short green-to-brown grass covering the backyard";
  const robinThings: KeyThing[] = [
    { name: "robin", look: "an American robin, a reddish-orange breast, a dark gray-brown back, a white lower belly, a white eye ring", main: true },
    { name: "kitchen window", look: "a rectangular window with white wooden frame, clear glass panes, looking out over the lawn" },
    { name: "lawn", look: LAWN },
  ];
  const yard = (): StoryboardScene[] =>
    [
      { index: 2, showSubject: "an empty frosty backyard lawn at dawn under a pale sky", keyThing: "lawn", pictureUrl: "https://r2/411/still-src-2.png" },
      {
        index: 5,
        showSubject: "an American robin standing on a patchy green-to-brown lawn in early spring with the last snow melting",
        keyThing: "robin",
        otherKeyThings: ["lawn"],
        pictureUrl: "https://r2/411/still-src-5.png",
      },
      { index: 7, showSubject: "the kitchen window with the backyard lawn visible beyond it", keyThing: "kitchen window", otherKeyThings: ["lawn"] },
      { index: 12, showSubject: "a robin standing on a snow-covered lawn in the backyard", keyThing: "robin", otherKeyThings: ["lawn"] },
      {
        index: 16,
        showSubject: "a flock of American robins on a sunny green lawn under palm trees",
        hostPresent: true,
        splitVisual: "Several American robins scattered across a green lawn in a Gulf Coast yard under palmetto trees on a sunny winter day",
        keyThing: "robin",
        otherKeyThings: ["lawn"],
      },
      { index: 18, showSubject: "the empty backyard lawn in late November light", keyThing: "lawn" },
    ].map(s => ({ narration: "n", scriptText: "n", visualPrompt: s.showSubject, ...s }) as StoryboardScene);
  const HOME_411 = "backyard: a suburban yard with a mowed lawn, holly bushes with red berries along the border, a porch light fixture, storm windows on the house, late fall to winter light";

  it("411: no picture is drawn from the first yard picture — the robin is still drawn from its own", async () => {
    const { attachMemory, homePlaceOf, memorySourcesFor } = await import("./pictureMemory");
    const b = yard();
    attachMemory(b, b, robinThings, homePlaceOf(HOME_411));
    const from = (i: number) => memorySourcesFor(b, b.find(s => s.index === i)!).map(s => s.index);
    expect(from(7)).toEqual([]);
    expect(from(18)).toEqual([]);
    expect(from(12)).toEqual([5]);
  });

  it("411 scene 16: the Gulf Coast panel is the robin's pictures and its own words — no northern lawn, no 'SAME lawn'", async () => {
    const { attachMemory, homePlaceOf } = await import("./pictureMemory");
    const { buildSplitRightScene, buildStillPrompt, memoryClause, withSplitMemory } = await import("./longformVideo");
    const b = yard();
    const host = b.find(s => s.index === 16)!;
    attachMemory(b, [host], robinThings, homePlaceOf(HOME_411));
    const panel = await withSplitMemory(host, buildSplitRightScene(host), 0);
    expect(panel.memoryRefUrls).toEqual(["https://r2/411/still-src-5.png"]);
    expect(memoryClause(panel)).not.toMatch(/robin and lawn/);
    expect(memoryClause(panel)).toContain("The lawn is drawn as this picture's own words describe it.");
    expect(buildStillPrompt(panel, false, undefined, undefined, true)).not.toContain(LAWN);
  });

  it("411 scene 12: set in the backyard, it carries the lawn's and the backyard's look, without the home line's season", async () => {
    const { attachMemory, homePlaceOf, memoryFor, memoryView } = await import("./pictureMemory");
    const { buildStillPrompt, memoryFields } = await import("./longformVideo");
    const b = yard();
    const s12 = b.find(s => s.index === 12)!;
    attachMemory(b, [s12], robinThings, homePlaceOf(HOME_411));
    const s = { ...s12, ...memoryFields(await memoryFor(s12, 0), memoryView(s12)) } as StoryboardScene;
    const prompt = buildStillPrompt(s);
    expect(prompt).toContain(`the lawn: ${LAWN}; the backyard: a suburban yard with a mowed lawn, holly bushes`);
    expect(prompt).not.toContain("winter light");
  });

  it("412 scene 4: the 'ankle' list item is in the video's bedroom, on its bed; scene 3, drawn from a picture of the bed, keeps that reference", async () => {
    const { attachMemory, homePlaceOf, memoryFor, memoryView } = await import("./pictureMemory");
    const { buildStillPrompt, memoryFields } = await import("./longformVideo");
    const things: KeyThing[] = [
      { name: "cat", look: "a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail held low, pale green eyes", main: true },
      { name: "bed", look: "a low wooden-framed bed with white rumpled sheets and a dark grey blanket pushed to one side, positioned centrally in the bedroom" },
    ];
    const HOME_412 = "bedroom: a quiet bedroom at pre-dawn hours, soft dim blue-grey light, an unmade bed as the central feature, calm and tidy surroundings";
    const b = [
      {
        index: 2,
        showSubject: "cat paws stepping silently onto the foot of the bed",
        visualPrompt: "A grey-and-white cat's small white-tipped paws land silently on the foot of a low wooden bed with white rumpled sheets in a quiet bedroom at pre-dawn, soft dim blue-grey light.",
        keyThing: "cat paws",
        otherKeyThings: ["bed"],
        pictureUrl: "https://r2/412/still-src-2.png",
      },
      {
        index: 3,
        showSubject: "cat walking across sleeping owner's legs in bed",
        visualPrompt: "A grey-and-white domestic shorthair cat walks slowly across the length of a bed with white rumpled sheets and dark grey blanket, moving over the legs and lower body in a quiet bedroom at pre-dawn.",
        keyThing: "cat",
        otherKeyThings: ["bed"],
      },
      {
        index: 4,
        scriptText: "ankle,",
        listCut: true,
        showSubject: "cat stepping along owner's body from ankle toward ribs in bed",
        visualPrompt: "Close-up of a grey-and-white cat's small white-tipped paws stepping deliberately along fabric-covered legs and lower torso toward the ribs, moving across a bed in a quiet bedroom at pre-dawn.",
        keyThing: "cat",
        otherKeyThings: ["bed"],
      },
    ].map(s => ({ narration: "n", scriptText: "n", ...s }) as StoryboardScene);
    attachMemory(b, b.slice(1), things, homePlaceOf(HOME_412));
    const ankle = { ...b[2], ...memoryFields(await memoryFor(b[2], 0), memoryView(b[2])) } as StoryboardScene;
    expect(ankle.memoryRefUrls).toBeUndefined();
    expect(buildStillPrompt(ankle)).toContain(
      "the bedroom: a quiet bedroom, an unmade bed as the central feature, calm and tidy surroundings; the bed in the bedroom: a low wooden-framed bed with white rumpled sheets and a dark grey blanket."
    );
    const s3 = { ...b[1], ...memoryFields(await memoryFor(b[1], 0), memoryView(b[1])) } as StoryboardScene;
    expect(s3.memoryRefUrls).toEqual(["https://r2/412/still-src-2.png"]);
    expect(s3.placeLooks?.map(p => p.name)).toEqual(["bedroom"]);
  });
});
describe("another of the same kind is not the key thing (round 14, job 412 scenes 23, 25 and 26)", () => {
  // "Her wild relatives do their serious hunting in the low light at the edges of the day" was drawn as
  // "a wild cat stalking …" and came back as the video's own house cat — the same coat, bib, socks and
  // eyes — because the word "cat" filed the picture under the MAIN key thing and the pet's first picture
  // was handed over as "this exact cat". The full cases are in anotherOfItsKind.test.ts.
  const WILD = "a wild cat stalking low through scattered brush across the dawn-lit wild landscape toward a small mouse";
  const things: KeyThing[] = [
    { name: "cat", look: "a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail held low, pale green eyes", main: true },
    { name: "wild landscape", look: "an open dawn-lit wilderness with low golden light, scattered brush and distant hills, calm and empty of people" },
  ];
  const board = (): StoryboardScene[] =>
    [
      {
        index: 2,
        showSubject: "cat walking across sleeping owner's legs in bed",
        keyThing: "cat",
        pictureUrl: "https://r2/412/still-src-2.png",
      },
      { index: 21, showSubject: "the grey-and-white cat resting calmly at the foot of the bed in the dim bedroom at night", keyThing: "cat" },
      { index: 22, showSubject: WILD, keyThing: "wild landscape", otherKeyThings: ["cat"] },
    ].map(s => ({ narration: "n", scriptText: "n", visualPrompt: s.showSubject, ...s }) as StoryboardScene);

  it("412: the wild cat is drawn from no picture of the pet, with none of her look, and told it is another one", async () => {
    const { attachMemory, memoryFor, memorySourcesFor, memoryView } = await import("./pictureMemory");
    const { buildStillPrompt, memoryFields } = await import("./longformVideo");
    const b = board();
    attachMemory(b, b, things);
    expect(memorySourcesFor(b, b[2])).toEqual([]);
    const wild = { ...b[2], ...memoryFields(await memoryFor(b[2], 0), memoryView(b[2])) } as StoryboardScene;
    const prompt = buildStillPrompt(wild);
    expect(prompt).toContain("this picture shows a wild cat — not the cat shown in this video's other pictures, nor a copy of it.");
    expect(prompt).not.toContain("soft grey-and-white coat");
  });

  it("412: the pet on the bed is still the cat — drawn from her first picture, with no such line", async () => {
    const { attachMemory, memorySourcesFor } = await import("./pictureMemory");
    const { buildStillPrompt } = await import("./longformVideo");
    const b = board();
    attachMemory(b, b, things);
    expect(memorySourcesFor(b, b[1]).map(s => s.index)).toEqual([2]);
    expect(buildStillPrompt(b[1])).not.toContain("ANOTHER ONE OF ITS KIND");
  });

  it("411: in a video about a WILD kind, 'another robin' is still the robin — the species' look and picture kept", async () => {
    // Job 411's key thing is the species ("an American robin, a reddish-orange breast…") and its script
    // says "nobody sees another robin until spring": the words that tell a pet apart from a wild cat
    // must not strip the regional kind's look off a robin.
    const { attachMemory, memorySourcesFor } = await import("./pictureMemory");
    const { buildStillPrompt } = await import("./longformVideo");
    const robin: KeyThing[] = [
      { name: "robin", look: "an American robin, a reddish-orange breast, a dark gray-brown back, a white lower belly, a white eye ring", main: true },
    ];
    const b = [
      { index: 5, showSubject: "a robin standing on the grass with its head tilted", keyThing: "robin", pictureUrl: "https://r2/411/still-src-5.png" },
      { index: 9, showSubject: "another robin pulling a worm from the wet grass" },
    ].map(s => ({ narration: "n", scriptText: "n", visualPrompt: s.showSubject, ...s }) as StoryboardScene);
    attachMemory(b, b, robin);
    expect(b[1].keyThing).toBe("robin");
    expect(b[1].othersOfKind).toBeUndefined();
    expect(memorySourcesFor(b, b[1]).map(s => s.index)).toEqual([5]);
    expect(buildStillPrompt(b[1])).not.toContain("ANOTHER ONE OF ITS KIND");
  });
});

describe("round 14: a continuation knows what it continues (jobs 413 and 412)", () => {
  // Job 413 scenes 15-16: two views of one phone call, 11.4 s, came back as the same over-the-shoulder
  // shot, the phone a corded desk phone in one and a smartphone in the other. The call names no key
  // thing, so the second view had no reference to the first, no concrete camera, and was drawn at the
  // same moment. Job 412 scene 8 was scene 3's shot again: the list cut out of its beat ("ankle, knee,
  // hip, ribs") left the "ribs" close-up right before it, and its camera and its near-copy partner were
  // read off that close-up. The full cases are in continuationChain.test.ts.
  const look =
    "A lean man in his late fifties with fair, weathered skin, graying hair under a woven straw cowboy hat, wearing a light blue denim button-up shirt";
  const row = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
    ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
  const CALL = "the host on the phone at the workbench calling the city office";

  it("413: the call's second view waits for the first, is drawn from it for the phone and the clothes, from a concrete camera", async () => {
    const { attachMemory, memoryFor, memoryView, nearCopyPartner, pictureSettled } = await import("./pictureMemory");
    const { memoryClause, memoryFields } = await import("./longformVideo");
    const { REDRAW_CAMERAS } = await import("./pictureVariety");
    const { OTHER_VIEWS } = await import("./shotList");
    const host = { humanPresent: true, brollHostLook: look, brollHostRef: "https://r2/host-photos/phone-v4-413.jpg" };
    const b = [row(15, CALL, host), row(16, `${CALL}${OTHER_VIEWS[0]}`, host)];
    attachMemory(b, b);
    expect(nearCopyPartner(b[1])).toBe(b[0]);
    let done = false;
    const waiting = memoryFor(b[1], 5_000).then(m => ((done = true), m));
    await new Promise(r => setTimeout(r, 20));
    expect(done).toBe(false);
    b[0].pictureUrl = "https://r2/413/still-src-15.png";
    pictureSettled(b[0]);
    const s = { ...b[1], ...memoryFields(await waiting, memoryView(b[1])) } as StoryboardScene;
    expect(s.memoryRefUrls).toEqual(["https://r2/413/still-src-15.png"]);
    expect(s.memoryView).toBe(REDRAW_CAMERAS[0]);
    const clause = memoryClause(s);
    expect(clause).toContain("this one CONTINUES — the same moment");
    expect(clause).toContain("a thing in someone's hand the same thing");
  });

  it("412: scene 8 continues scene 3 past the list, and is compared with it — never the 'ribs' close-up", async () => {
    const { continuedPicture, memorySourcesFor, nearCopyPartnerFor } = await import("./pictureMemory");
    const b = [
      row(3, "cat walking across sleeping owner's legs in bed", { keyThing: "cat" }),
      row(4, "cat stepping along owner's body from ankle toward ribs in bed", { keyThing: "cat", listCut: true }),
      row(5, "close-up of the cat's white-tipped paw pressing onto the sleeping owner's knee", { keyThing: "cat paws", listCut: true }),
      row(7, "close-up of the cat's white-tipped paw pressing on the sleeping owner's ribs", { keyThing: "cat paws", listCut: true }),
      row(8, "cat continuing steady walk across owner's body in bed", { keyThing: "cat", sameShot: true }),
    ];
    expect(continuedPicture(b, b[4])?.index).toBe(3);
    expect(nearCopyPartnerFor(b, b[4])?.index).toBe(3);
    expect(memorySourcesFor(b, b[4]).map(s => s.index)).toEqual([3]);
  });

  it("409: the host marked to continue past a list is never drawn from someone else's picture", async () => {
    const { keylessContinued, memorySourcesFor } = await import("./pictureMemory");
    const b = [
      row(14, "a person in their sixties sitting alone in the quiet study", { humanPresent: true, otherPerson: "a person in their sixties" }),
      row(18, "an older man planting a young tree in a backyard on a sunny morning, seen from behind", {
        listCut: true,
        humanPresent: true,
        otherPerson: "an older man",
      }),
      row(19, "the host speaking thoughtfully at his desk in the study", { sameShot: true, humanPresent: true, brollHostLook: look }),
    ];
    expect(keylessContinued(b, b[2])).toBeUndefined();
    expect(memorySourcesFor(b, b[2])).toEqual([]);
  });

  it("352: a continuation about the list's last item carries on from it — the bark edge after 'or a little wane,'", async () => {
    // The other side of the 412 case: "which is bark edge left along the side" is described as nearly the
    // same close-up as the wane item before it is. Paired with the cull bins before the list, a copy
    // would go unchecked; its words share more with the item than with the bins.
    const { continuedPicture, nearCopyPartnerFor } = await import("./pictureMemory");
    const board = "rough-sawn board";
    const b = [
      row(165, "culls and shorts bins at the end of the lumber yard racks", { keyThing: "culls and shorts bins" }),
      row(169, "close-up of one long edge of a rough oak board where a strip of rough brown-grey bark replaces the square corner", {
        keyThing: board,
        partOf: board,
        listCut: true,
      }),
      row(170, "close-up of a rough oak board's side edge with a strip of rough brown-grey bark and rounded log surface left along it in place of a square corner", {
        keyThing: board,
        partOf: board,
        sameShot: true,
      }),
    ];
    expect(continuedPicture(b, b[2])?.index).toBe(169);
    expect(nearCopyPartnerFor(b, b[2])?.index).toBe(169);
  });
});

describe("round 14: every thing a picture shows keeps its memory (the verification films 413 and 414)", () => {
  const row = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
    ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
  const src = (i: number) => `https://r2/still-src-${i}.png`;

  it("413: 'drain it outside, | store it sealed,' — the drain step keeps the red mower, the store step the drain step's can", async () => {
    const { memorySourcesFor } = await import("./pictureMemory");
    const b = [
      row(28, "clean push mower sitting finished in the driveway", { keyThing: "mower", buildStage: "done", pictureUrl: src(28) }),
      row(31, "the host's hands draining gasoline from the mower into the red gas can outdoors on the driveway", {
        scriptText: "drain it outside,",
        keyThing: "gas can",
        otherKeyThings: ["mower"],
        listCut: true,
        listKind: "steps",
        pictureUrl: src(31),
      }),
      row(32, "the red gas can with its black cap screwed tight on a shelf in an outdoor shed", {
        scriptText: "store it sealed,",
        keyThing: "gas can",
        listCut: true,
        listKind: "steps",
      }),
    ];
    // It was drawn from nothing: a black-deck mower and, step to step, two different cans.
    expect(memorySourcesFor(b, b[1]).map(s => s.index)).toEqual([28]);
    expect(memorySourcesFor(b, b[2]).map(s => s.index)).toEqual([31]);
  });

  it("414: the picture under 'those three' is drawn from the axe's, the froe's and the drawknife's own pictures", async () => {
    const { attachMemory, memorySourcesFor, memoryViewFor, LIST_GROUP_VIEW } = await import("./pictureMemory");
    const steel: KeyThing[] = [
      { name: "steel tools", look: "an axe, a froe, and a drawknife hanging together on the cabin's back interior wall", main: true },
      { name: "white oak bolt", look: "a short pale log section with straight grain" },
    ];
    const b = [
      row(5, "an axe (for the steel tools)", { scriptText: "an axe,", keyThing: "steel tools", listCut: true, pictureUrl: src(5) }),
      row(6, "a close-up of a froe hanging on the cabin's back log wall: its straight flat steel blade with a wooden handle set upright", {
        scriptText: "a froe,",
        keyThing: "steel tools",
        partOf: "steel tools",
        listCut: true,
        pictureUrl: src(6),
      }),
      row(7, "a close-up of a drawknife hanging on the cabin's back log wall", {
        scriptText: "and a drawknife,",
        keyThing: "steel tools",
        partOf: "steel tools",
        listCut: true,
        pictureUrl: src(7),
      }),
      row(8, "a closer view of the steel tools hanging on the cabin wall", {
        scriptText: "and the steel in those three was the one thing that homestead could not grow.",
        keyThing: "steel tools",
      }),
      row(17, "the host's hands holding a froe upright by its wooden handle, its flat blade driven into the end of a short pale white oak bolt", {
        keyThing: "white oak bolt",
      }),
    ];
    attachMemory(b, [], steel);
    // The froe came back a flat bar under "those three" — its memory was the drawknife close-up alone.
    expect(memorySourcesFor(b, b[3]).map(s => s.index)).toEqual([5, 6, 7]);
    expect(memoryViewFor(b, b[3])).toBe(LIST_GROUP_VIEW);
    // The froe ten seconds later, filed under the oak bolt, is drawn from the froe the viewer saw.
    expect(b[4].otherKeyThings).toEqual(["froe"]);
    expect(memorySourcesFor(b, b[4]).map(s => s.index)).toEqual([6]);
  });

  it("Dale's 'Coasters, | ornaments,' stay separate things: never drawn from the pile they inherited, nor from each other", async () => {
    const { memorySourcesFor } = await import("./pictureMemory");
    const b = [
      row(9, "The host's hands sorting small wood coasters and ornaments into neat stacks on the workbench.", {
        keyThing: "small wood pieces",
        otherKeyThings: ["workbench"],
        pictureUrl: src(9),
      }),
      row(12, "a close stack of round maple and walnut coasters on the workbench", {
        scriptText: "Coasters,",
        keyThing: "small wood pieces",
        otherKeyThings: ["workbench"],
        listCut: true,
        pictureUrl: src(12),
      }),
      row(13, "small carved wooden ornaments grouped on the workbench", {
        scriptText: "ornaments,",
        keyThing: "small wood pieces",
        otherKeyThings: ["workbench"],
        listCut: true,
      }),
    ];
    expect(memorySourcesFor(b, b[2])).toEqual([]);
  });
});

describe("round 14 review: a list item on a device, and a step after a failed picture (jobs 295, 412, 414)", () => {
  const row = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
    ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
  const src = (i: number) => `https://r2/still-src-${i}.png`;

  it("295: 'Etsy,' on the tablet is never handed the cutting board as an object to copy — the tablet was built out of it", async () => {
    const { memorySourcesFor } = await import("./pictureMemory");
    const b = [
      row(2, "The walnut and maple cutting board leaning against the garage wall.", { keyThing: "cutting board", pictureUrl: src(2) }),
      row(4, "The wood-grain tablet propped on the workbench, its glowing screen showing an Etsy-style white page: a grid of square product photos with the walnut and maple striped cutting board in the first tile", {
        scriptText: "Etsy,",
        keyThing: "digital device",
        otherKeyThings: ["cutting board", "workbench"],
        listCut: true,
      }),
    ];
    expect(memorySourcesFor(b, b[1])).toEqual([]);
  });

  it("412: 'run it back,' on the phone's screen is handed no nightstand, cat or bed as 'the item for sale'", async () => {
    const { memorySourcesFor } = await import("./pictureMemory");
    const b = [
      row(3, "cat walking across sleeping owner's legs in bed", { keyThing: "cat", otherKeyThings: ["bed"], pictureUrl: src(3) }),
      row(12, "quiet bedroom at pre-dawn with unmade bed and nightstand", { keyThing: "nightstand", otherKeyThings: ["bed"], pictureUrl: src(12) }),
      row(15, "the host's thumb dragging back along a cat-on-bed video playing on the phone screen beside the nightstand", {
        scriptText: "run it back,",
        keyThing: "phone",
        otherKeyThings: ["nightstand", "cat", "bed"],
        listCut: true,
        listKind: "steps",
      }),
    ];
    expect(memorySourcesFor(b, b[2])).toEqual([]);
  });

  it("414: 'and rived the boards…' keeps the froe the viewer saw at 'a froe,' when the froe's next picture failed its check", async () => {
    const { attachMemory, memorySourcesFor } = await import("./pictureMemory");
    const steel: KeyThing[] = [
      { name: "steel tools", look: "an axe, a froe, and a drawknife hanging together on the cabin's back interior wall", main: true },
      { name: "white oak bolt", look: "a short pale log section with straight grain" },
      { name: "split shingle", look: "a thin pale wood board, one end shaved thinner" },
    ];
    const b = [
      row(5, "an axe (for the steel tools)", { scriptText: "an axe,", keyThing: "steel tools", listCut: true, pictureUrl: src(5) }),
      row(6, "a close-up of a froe hanging on the cabin's back log wall: its straight flat steel blade with a wooden handle set upright", {
        scriptText: "a froe,",
        keyThing: "steel tools",
        partOf: "steel tools",
        listCut: true,
        pictureUrl: src(6),
      }),
      row(7, "a close-up of a drawknife hanging on the cabin's back log wall", {
        scriptText: "and a drawknife,",
        keyThing: "steel tools",
        partOf: "steel tools",
        listCut: true,
        pictureUrl: src(7),
      }),
      row(17, "the host's hands holding a froe upright by its wooden handle, its flat blade driven into the end of a short pale white oak bolt", {
        keyThing: "white oak bolt",
        buildStage: "making",
        memoryUnfit: true,
        pictureUrl: src(17),
      }),
      row(19, "a white oak bolt being split into pie-shaped wedges", { scriptText: "split each bolt into pie wedges,", keyThing: "white oak bolt", listCut: true, listKind: "steps", buildStage: "making", pictureUrl: src(19) }),
      row(20, "the host's hands levering a froe's handle sideways as its blade splits a thin board off a pale oak wedge", {
        scriptText: "and rived the boards along those same lines,",
        keyThing: "split shingle",
        listCut: true,
        listKind: "steps",
        buildStage: "making",
      }),
    ];
    attachMemory(b, [], steel);
    // It was drawn from no picture of the froe and came back an all-metal L.
    expect(memorySourcesFor(b, b[5]).map(s => s.index)).toEqual([6]);
  });
});

describe("the season and the light are each picture's own (round 14, job 411 scene 20 and job 412 scene 25)", () => {
  // 411-20: "That bright song at first light … belongs to spring and summer" was planned with no season,
  // filled from the channel's winter home base and drawn from two snowy robin pictures — the robin
  // singing over snow in the season the next line says it is quiet. 412-25: the props list wrote the
  // wilderness "dawn-lit … with low golden light", so every picture of it asked for golden light and the
  // check called it staged on every draw. The full cases are in lineSeason.test.ts and lookLight.test.ts.
  const LINE =
    "Start with the singing. That bright song at first light, the one birders have long remembered as cheer up, cheerily, belongs to spring and summer.";

  it("411-20: the song is held in spring, told so beside its snowy references; the quiet winter robin is left alone", async () => {
    const { holdLineSeasons } = await import("./lineSeason");
    const { buildStillPrompt, MEMORY_SETTING_CLAUSE, memoryClause } = await import("./longformVideo");
    const { MEMORY_VIEWS } = await import("./pictureMemory");
    const song = {
      index: 20,
      narration: LINE,
      scriptText: LINE,
      showSubject: "a robin singing on a branch at first light in the backyard",
      visualPrompt: "a robin singing on a branch at first light in the backyard",
      keyThing: "robin",
    } as StoryboardScene;
    const quiet = {
      index: 22,
      narration: "n",
      scriptText: "Once nesting season is over, that job is done, and through the winter a robin hardly sings at all.",
      showSubject: "a quiet robin perched silently on a bare branch in winter",
      visualPrompt: "a quiet robin perched silently on a bare branch in winter",
      keyThing: "robin",
    } as StoryboardScene;
    expect(holdLineSeasons([song, quiet])).toBe(1);
    expect(song.showSubject).toBe("a robin singing on a branch at first light in the backyard, in spring");
    expect(quiet.showSubject).toBe("a quiet robin perched silently on a bare branch in winter");
    const refs = { memoryView: MEMORY_VIEWS[0], memoryRefUrls: ["https://r2/411/still-src-12.png", "https://r2/411/still-src-14.png"] };
    const clause = memoryClause({ ...song, ...refs });
    expect(clause).toContain("THIS PICTURE IS IN SPRING (no snow, frost or ice on anything), AT FIRST LIGHT");
    expect(clause.endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
    expect(buildStillPrompt({ ...quiet, ...refs })).not.toContain("THIS PICTURE IS");
  });

  it("412-25: the wilderness the writers read has no dawn or golden light; a thing's light it HAS stays", async () => {
    const { lookWithoutLight, sheetWithoutLight } = await import("./pictureMemory");
    const sheet = [
      "bedroom: a quiet bedroom at pre-dawn hours, soft dim blue-grey light, an unmade bed as the central feature, calm and tidy surroundings",
      "MAIN cat: a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail held low, pale green eyes",
      "wild landscape: an open dawn-lit wilderness with low golden light, scattered brush and distant hills, calm and empty of people",
    ].join("\n");
    const read = sheetWithoutLight(sheet);
    expect(read).not.toMatch(/golden|dawn|blue-grey light/);
    expect(read).toContain("wild landscape: an open wilderness, scattered brush and distant hills, calm and empty of people");
    expect(read).toContain("MAIN cat: a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail held low, pale green eyes");
    const alarm = "round white plastic disc like the main alarm but slightly thicker, with a small blinking indicator light on its face";
    expect(lookWithoutLight(alarm)).toBe(alarm);
  });
});

describe("allowed words and soft print go together; a word the line says is not made-up writing (round 13 verification films, 2026-10-19)", () => {
  // 411 scene 17, as stored: the line allows one word, and the picture came back twice as a sharp
  // field-guide page — heading and two readable paragraphs of made-up entry text beside it.
  const ROBIN_LINE =
    "The funny part is that the robin’s own scientific name, the one printed in the field guides, ends in the word migratorius, which means just about what it sounds like. Seems somebody should have checked with the robins first.";
  const fieldGuide = () =>
    pic(17, ROBIN_LINE, "close-up of an open bird field guide page showing a painted American robin with its entry text", {
      visualPrompt: "the empty backyard lawn in late November light",
      keyThing: "robin",
      pictureText: "migratorius",
    });

  it("411 scene 17: the one said word stays exact and sharp, the rest of the page is asked soft, and its ask for the entry text too", async () => {
    const { ALLOWED_TEXT_REST_CLAUSE, NO_READABLE_TEXT } = await import("./longformVideo");
    const s = fieldGuide();
    const prompt = buildStillPrompt(s);
    expect(prompt).toMatch(/ONLY readable writing anywhere in the frame is exactly "migratorius"/);
    expect(prompt).toContain(ALLOWED_TEXT_REST_CLAUSE);
    expect(prompt).toMatch(/with its entry text soft and unreadable/);
    expect(prompt).not.toMatch(/entry text(?! soft and unreadable)/);
    expect(prompt).not.toContain(NO_READABLE_TEXT);
    // Not the blurred-print road: its arm's length and step back would shrink the said word past
    // reading, and its "an engraved name is there too" asks for print nobody said.
    expect(prompt).not.toContain(BLURRED_PRINT_CLAUSE);
    expect(prompt).not.toMatch(/arm's-length view/);
    expect(blurUnsaidPrint(s)).toBe(false);
    expect(s.blurPrint).toBeUndefined();
  });

  it("411 scene 17: a redraw for writing goes closer on the said word, once, in the draw it already gets", async () => {
    const { allowedTextRedraw, ALLOWED_TEXT_REDRAW_START, faultRedrawFor, STEP_BACK_CLAUSE } = await import("./longformVideo");
    const prompt = buildStillPrompt(fieldGuide());
    const once = allowedTextRedraw(prompt, "migratorius");
    expect(once.startsWith(prompt)).toBe(true);
    expect(once).toContain(`${ALLOWED_TEXT_REDRAW_START} the camera is closer on "migratorius"`);
    expect(once).not.toContain(STEP_BACK_CLAUSE);
    expect(allowedTextRedraw(once, "migratorius")).toBe(once);
    // No extra draw: the changed-prompt fault redraw stays for plain pictures only.
    expect(
      faultRedrawFor({ pictureText: "migratorius" }, { writing: true }, { broken: 0, writing: 1 }, new Set(), true)
    ).toBeUndefined();
  });

  it("an ask for print that IS the said words, and a picture with no allowed words, are left as they were", () => {
    // The said words follow the ask: that text is the allowed text, not more print.
    expect(withAllowedText("a page with the text migratorius in italics", "migratorius")).toMatch(
      /^a page with the text migratorius in italics The ONLY/
    );
    expect(withAllowedText("a label with its text reading 2009", "2009")).toMatch(/^a label with its text reading 2009 The ONLY/);
    // A pattern is not print: "with its print" is never touched; nor is print already asked soft.
    expect(withAllowedText("a cushion with its floral print", "HOME")).toMatch(/^a cushion with its floral print The ONLY/);
    expect(withAllowedText("a page with its text soft and blurred", "HOME")).toMatch(/^a page with its text soft and blurred The ONLY/);
    // No allowed words, no soft print: byte for byte.
    const plain = "close-up of an open bird field guide page showing a painted American robin with its entry text";
    expect(withAllowedText(plain, undefined)).toBe(plain);
  });

  it("413 scene 2: the heading LOAN under the line \"A loan,\" is the line's own word, not made-up writing", async () => {
    const { writingTheLineSays } = await import("./longformVideo");
    expect(writingTheLineSays("LOAN", "A loan,")).toBe(true);
    expect(writingTheLineSays("'LOAN'", "A loan,")).toBe(true);
    expect(writingTheLineSays("“LOAN”", "A loan,")).toBe(true);
    // The other list items of that opening, each with its own word.
    expect(writingTheLineSays("LEASE", "a lease,")).toBe(true);
  });

  it("made-up writing is still refused: a word the line never says, a cut-short read, a brand, no line", async () => {
    const { writingTheLineSays } = await import("./longformVideo");
    // 411's page, had it carried no allowed word: "American" is nowhere in the line.
    expect(writingTheLineSays("American Robin", ROBIN_LINE)).toBe(false);
    expect(writingTheLineSays("LOAN AGREEMENT", "A loan,")).toBe(false);
    expect(writingTheLineSays("LOAN Borrower Lender Amount", "A loan,")).toBe(false);
    expect(writingTheLineSays("LOAN …", "A loan,")).toBe(false);
    expect(writingTheLineSays("$10,000", "starting a business costs ten thousand dollars.")).toBe(false);
    // A brand the line names is still never drawn readable (`scrubLegibleWriting`).
    expect(writingTheLineSays("Etsy", "Sell it on Etsy")).toBe(false);
    expect(writingTheLineSays(undefined, "A loan,")).toBe(false);
    expect(writingTheLineSays("LOAN", undefined)).toBe(false);
    // More than six words is a page of text, not a heading.
    expect(
      writingTheLineSays("the one printed in the field guides", ROBIN_LINE)
    ).toBe(false);
  });

  it("the check reports what it read only where it can excuse it, and never beside an allowed word", async () => {
    const { READ_WORDS_QUESTION, verdictShape, parseStillDefectVerdict } = await import("./overlayTextScan");
    expect(READ_WORDS_QUESTION).toMatch(/EVERY word, number or letter a viewer can read/);
    expect(verdictShape(undefined, "A loan,", false, false, false, false, true)).toContain('"read":"..."');
    expect(verdictShape(undefined, "A loan,")).not.toContain('"read"');
    expect(parseStillDefectVerdict('{"writing":true,"read":"LOAN","what":"heading on the papers"}').read).toBe("LOAN");
    // A "read" beside no writing is no answer.
    expect("read" in parseStillDefectVerdict('{"writing":false,"read":"LOAN"}')).toBe(false);
  });

  // Review of the fix: a name the scrubber does not know, a read longer than 60 characters, and asks
  // for print that are no ask at all.
  it("a name the line says is not passed, though the scrubber does not know it (413 scene 26's line)", async () => {
    const { writingTheLineSays } = await import("./longformVideo");
    const line =
      "Every spring, Marketplace fills up with mowers listed as ran-last-season, priced twenty-five to seventy-five dollars.";
    expect(writingTheLineSays("Marketplace", line)).toBe(false);
    // …while an ordinary word of the same line still is.
    expect(writingTheLineSays("MOWERS", line)).toBe(true);
    // A capital where the line's sentence starts is no name.
    expect(writingTheLineSays("EVERY SPRING", line)).toBe(true);
    expect(writingTheLineSays("LOAN", "Somewhere along the line, everybody agreed. A loan, a lease")).toBe(true);
  });

  it("every word of a long read is counted, not only its first 60 characters", async () => {
    const { writingTheLineSays } = await import("./longformVideo");
    const line = "the agricultural department certification requirements overview";
    expect(writingTheLineSays("Agricultural Department Certification Requirements Overview", line)).toBe(true);
    expect(writingTheLineSays("Agricultural Department Certification Requirements Overview Fabricated", line)).toBe(false);
  });

  it("print already soft, a thing named after print, and long allowed words after the ask are left as written", () => {
    // Stored descriptions (jobs 303 scene 18, 343 scene 4), had they carried allowed words.
    expect(withAllowedText("a tablet with icons and boxes, and the text is unreadable.", "4")).toMatch(
      /^a tablet with icons and boxes, and the text is unreadable\. The ONLY/
    );
    expect(withAllowedText("A small orange logo and the text are soft and unreadable.", "4")).toMatch(
      /^A small orange logo and the text are soft and unreadable\. The ONLY/
    );
    expect(withAllowedText("a lamp beside the writing desk", "4")).toMatch(/^a lamp beside the writing desk The ONLY/);
    expect(withAllowedText("a phone with the text message open", "4")).toMatch(/^a phone with the text message open The ONLY/);
    // The label's three said things (job 335 scene 5) follow the ask: not softened, however long.
    const said = "Photoelectric, Sealed 10-Year, Interconnected";
    expect(withAllowedText(`a smoke alarm box with its printed text ${said} on the front`, said)).toMatch(
      new RegExp(`^a smoke alarm box with its printed text ${said} on the front The ONLY`)
    );
    // …and an ask that is followed by nothing said is still softened.
    expect(withAllowedText("a smoke alarm box with its printed text in sharp black ink", said)).toMatch(
      /^a smoke alarm box with its printed text soft and unreadable in sharp black ink/
    );
  });
});

// Job 413 scenes 9-10 (2026-10-20): both pictures shipped the hands-at-work VIDEO directive they were
// given, reworded, as their description — scene 9, under the channel's own introduction, came out as
// someone hand-planing a board on a channel about garage businesses. The shots were moving when the
// prompt writer saw them (the balancer had flipped them) and photos when they shipped.
describe("a cutaway is written for the shot it will be, and an answer that is not its picture is refused (job 413 scenes 9-10)", () => {
  const ANSWER =
    "Bare weathered hands with fingers already on a tool or workbench task, pressing or adjusting what " +
    "they work on. Wooden workbench, pegboard wall, and tools visible in the background. No face, head, " +
    "shoulders, or body visible.";
  const scene9 = pic(
    9,
    "and Gary’s Garage Secrets is for working people who want extra income with numbers a neighbor would believe — no apps, no coins, no course-sellers.",
    "the host working at his garage workbench with tools around him",
    { humanPresent: true, stillImage: false }
  );
  const scene10 = pic(10, "Here’s tonight’s deal:", "the host pulling a stool up to the garage workbench and opening a notebook", {
    humanPresent: true,
    stillImage: false,
  });

  it("a shot of the host at work is written as a photo, never with a video directive", async () => {
    const { cutawayPromptLane } = await import("./brollRewrite");
    expect(cutawayPromptLane(scene9)).toBe("still");
    expect(cutawayPromptLane(scene10)).toBe("still");
  });

  it("scene 10's answer leaves out its stool and notebook and goes back to its own words; scene 11's stands", async () => {
    const { rewriteFault, rewriteFallback } = await import("./brollRewrite");
    const { CUTAWAY_STOCK_DIRECTIVES } = await import("./longformVideo");
    expect(rewriteFault(ANSWER, scene10, scene10.showSubject!, CUTAWAY_STOCK_DIRECTIVES)).toBe("subject");
    expect(rewriteFallback(scene10, scene10.showSubject!)).toBe(scene10.showSubject);
    const scene11 = pic(
      11,
      "seventeen businesses,",
      "the guided knife-sharpening unit on the workbench with a kitchen knife clamped in its guide and the host's hands drawing a stone along the edge",
      { listCut: true, humanPresent: true }
    );
    expect(
      rewriteFault(
        "A guided knife-sharpening unit clamped to a garage workbench with a kitchen knife held in its metal guide, bare weathered hands pressing an abrasive stone along the blade edge, concrete floor and tool pegboard in the background.",
        scene11,
        scene11.showSubject!,
        CUTAWAY_STOCK_DIRECTIVES
      )
    ).toBeUndefined();
  });

  it("a shot written for motion that the gate makes a photo is written again; one still moving is not", async () => {
    const { leftMotionLane } = await import("./brollRewrite");
    const door = pic(4, "and the sliding door at the back.", "a sliding door at the back of a quiet room", {
      promptLane: "video",
      objectMotion: undefined,
      stillImage: true,
      selfMoving: false,
    });
    expect(leftMotionLane(door)).toBe(true);
    const steam = pic(3, "and the kettle is already going.", "steam rising from a kettle on the stove", {
      promptLane: "video",
      objectMotion: true,
      stillImage: false,
    });
    expect(leftMotionLane(steam)).toBe(false);
    // Made a photo only to keep the video share down: the steam still rises, the photo catches it, and
    // the wording stays — no second call, and no "settled instant" rewrite to put the kettle out.
    const sharedOut = pic(3, "and the kettle is already going.", "steam rising from a kettle on the stove", {
      promptLane: "video",
      objectMotion: undefined,
      stillImage: true,
      selfMoving: true,
    });
    expect(leftMotionLane(sharedOut)).toBe(false);
  });
});

/**
 * A TOOL WORKS THE WAY IT REALLY DOES, AND A LINE ENDS AT THE PART IT SERVES (round 14, the review of
 * jobs 413 and 414 made on the round-12 code). Job 413 scene 29: "pull the spark plug wire first" drew
 * the plug lead looping into the carburetor's fuel inlet. Job 414 scene 13: a drawknife laid along the
 * board, its stroke across the narrow width. Job 414 scene 17: the froe flat on top of the bolt, both
 * hands pressing, no club — broken on all four draws, and every redraw went out without a word changed.
 */
describe("a tool works the way it really does, and a line ends at the part it serves (round 14, jobs 413 and 414)", () => {
  const WOODWORKER = "A broad man in his sixties with a short white beard, wearing a sage green work shirt with rolled sleeves";
  const froe17 = () =>
    pic(
      17,
      "Number one is the roof, split by hand from white oak or chestnut with a froe, and the direction of the split mattered most. They",
      "the host's hands holding a froe upright by its wooden handle, its flat blade driven into the end of a short pale white oak bolt",
      {
        visualPrompt:
          "Bare hands holding a froe upright by its wooden handle, the flat blade driven into the end grain of a short pale white oak bolt.",
        keyThing: "white oak bolt",
        humanPresent: true,
      }
    );
  const drawknife13 = () =>
    pic(
      13,
      "since folk schools still teach plenty of these",
      "a student at a workbench pulling a drawknife toward themself with both hands on its two bent end handles, shaving a pale board, seen from the side",
      {
        visualPrompt:
          "Bare weathered hands on a workbench, fingers gripping both bent handles of a drawknife, pulling it toward the body across a pale tapered wooden board, shaved surface visible, seen from the side.",
        humanPresent: true,
        otherPerson: "a folk school student",
      }
    );
  const plugWire29 = (over: Partial<StoryboardScene> = {}) =>
    pic(
      29,
      "Two rules before your hands go near one: pull the spark plug wire first, every time, because a mower that turns over with your fingers under the deck will not apologize.",
      "close-up of the host's fingers pulling the grey metal boot cap of a black rubber-coated spark plug wire off the spark plug on the mower engine.",
      {
        visualPrompt:
          "Bare weathered hands, fingers pulling the grey metal boot cap off the end of a black rubber-coated spark plug wire connected to a mower engine.",
        keyThing: "spark plug wire",
        humanPresent: true,
        ...over,
      }
    );

  it("414-17 a froe goes in under a club, never pressed by hand — in every picture of someone at work", async () => {
    const { SPLIT_STRIKE_CLAUSE } = await import("./longformVideo");
    expect(SPLIT_STRIKE_CLAUSE).toMatch(/never goes in by hand pressure/);
    expect(SPLIT_STRIKE_CLAUSE).toMatch(/STRUCK down into the end grain with a wooden club, mallet or sledge/);
    expect(SPLIT_STRIKE_CLAUSE).toMatch(/brings the club down on the back of its blade/);
    // A froe already in is levered, with no club: the rule never makes that picture wrong.
    expect(SPLIT_STRIKE_CLAUSE).toMatch(/once a froe is sunk in the wood, its handle is pulled sideways to lever the split open/);
    // A maul or an axe that splits is swung: it is never told to be struck with a club.
    expect(SPLIT_STRIKE_CLAUSE).not.toMatch(/\bmaul\b|\baxe\b/);
    expect(TOOL_POSITION_CLAUSE).toContain(SPLIT_STRIKE_CLAUSE);
    const scenes = [froe17()];
    markHostBroll(scenes, { hostLook: WOODWORKER, hostName: "Sam" }, "https://x/host.png");
    expect(buildStillPrompt(scenes[0])).toContain(SPLIT_STRIKE_CLAUSE);
    expect(ANON_PERSON_SUFFIX).toContain(SPLIT_STRIKE_CLAUSE);
    expect(otherPersonClause("a folk school student")).toContain(SPLIT_STRIKE_CLAUSE);
  });

  it("414-13 a drawknife lies across the board and strokes along it, the piece held", async () => {
    const { SHAVING_STROKE_CLAUSE } = await import("./longformVideo");
    expect(SHAVING_STROKE_CLAUSE).toMatch(/edge lying ACROSS the piece and travels ALONG the piece's length, with the grain/);
    expect(SHAVING_STROKE_CLAUSE).toMatch(/a drawknife is pulled toward the user's body/);
    // Which way a plane goes is never said: a Japanese plane is pulled (job 161 scene 117 holds one).
    expect(SHAVING_STROKE_CLAUSE).not.toMatch(/pushed away|plane (?:is )?pushed/);
    expect(SHAVING_STROKE_CLAUSE).toMatch(/never sideways across the piece's narrow width/);
    expect(SHAVING_STROKE_CLAUSE).toMatch(/held still in a vise, on a shaving horse, against a bench stop or clamped down/);
    expect(TOOL_POSITION_CLAUSE).toContain(SHAVING_STROKE_CLAUSE);
    expect(buildStillPrompt(drawknife13())).toContain(SHAVING_STROKE_CLAUSE);
    // The rules before it are all still there (jobs 406 and 407).
    expect(TOOL_POSITION_CLAUSE).toMatch(/An axe that is chopping, felling or hewing rather than splitting bites into the side of the log or trunk/);
    expect(TOOL_POSITION_CLAUSE).toMatch(/that hand is on the tool itself or holds the work behind the edge/);
  });

  it("a tool at rest, with nobody in the picture, is told neither how to strike nor how to stroke", async () => {
    const { SPLIT_STRIKE_CLAUSE, SHAVING_STROKE_CLAUSE } = await import("./longformVideo");
    const scenes = [pic(3, "The froe is the tool that made those roofs.", "a froe and a drawknife hanging from pegs on a log cabin wall")];
    markHostBroll(scenes, { hostLook: WOODWORKER, hostName: "Sam" }, "https://x/host.png");
    expect(scenes[0].humanPresent).toBeFalsy();
    const prompt = buildStillPrompt(scenes[0]);
    expect(prompt).not.toContain(SPLIT_STRIKE_CLAUSE);
    expect(prompt).not.toContain(SHAVING_STROKE_CLAUSE);
  });

  it("413-29 the spark plug wire runs to the one part it serves — with people in the picture or not", async () => {
    const { CONNECTING_LINES_CLAUSE } = await import("./longformVideo");
    expect(CONNECTING_LINES_CLAUSE).toMatch(/runs unbroken from where it really starts to the part it really serves/);
    expect(CONNECTING_LINES_CLAUSE).toMatch(
      /never runs into a different part's fitting, never swaps with or turns into a different line \(an electrical lead never becomes a fuel or water line\)/
    );
    // A pipe is several pieces and a branch joins its run at a tee (job 11's P-trap, job 403's PVC
    // pipework "with visible joints and bends"): lines may meet at a real fitting.
    expect(CONNECTING_LINES_CLAUSE).toMatch(/a pipe through its own real joints and bends/);
    expect(CONNECTING_LINES_CLAUSE).toMatch(/lines meet only where a real fitting joins them/);
    expect(CONNECTING_LINES_CLAUSE).not.toMatch(/ONE continuous piece|never joins/);
    expect(CONNECTING_LINES_CLAUSE).toMatch(/two lines that run side by side stay two separate lines/);
    const scenes = [plugWire29()];
    markHostBroll(scenes, { hostLook: WOODWORKER, hostName: "Gary" }, "https://x/host.png");
    expect(buildStillPrompt(scenes[0])).toContain(CONNECTING_LINES_CLAUSE);
    // The same engine with nobody at it.
    expect(buildStillPrompt(plugWire29({ humanPresent: false }))).toContain(CONNECTING_LINES_CLAUSE);
    // Not on a content-policy fallback, which softens the picture's words away.
    expect(buildStillPrompt(plugWire29({ humanPresent: false }), true)).not.toContain(CONNECTING_LINES_CLAUSE);
  });

  it("only a picture naming a line that connects things is told about lines", async () => {
    const { connectingLinesClause, CONNECTING_LINES_CLAUSE } = await import("./longformVideo");
    for (const words of [
      "a garden hose coiled beside an outdoor tap",
      "an extension cord running from the wall socket to the saw",
      "jumper cables clamped onto the battery terminals",
      "the fuel line from the tank to the carburetor",
      "copper pipes under the kitchen sink",
      "a tangle of wiring behind the dashboard",
      "a green hosepipe running from the tap to the sprinkler",
      // The replay's own: jobs 270 and 403.
      "an electrical cord running under a rug on the floor",
      "grey PVC pipe network running beneath the house toward the street",
    ])
      expect(connectingLinesClause(words), words).toBe(` ${CONNECTING_LINES_CLAUSE}`);
    for (const words of [
      "a wire brush resting on the workbench",
      "a cord of split firewood stacked by the shed",
      "chicken wire fence around the garden bed",
      "a pipe wrench on the bench",
      "a cordless drill on the bench",
      "a cable-knit sweater folded on the bed",
      "wire-rimmed glasses resting on an open book",
      // The replay's smoke alarms (jobs 229, 259, 381, 394) and space heater (job 229): no line to run.
      "a rounded white replacement alarm unit held in an open hand, no visible wiring",
      "round white smoke alarm held in a hand near the ceiling, no wires visible",
      "The unit displays no wires or connections, only the plain white face",
      "A black space heater with a metal wire grille sitting on the floor near a low bed",
      "a stack of folded quilts on a bed",
      "the froe and the drawknife hanging on the back wall",
    ])
      expect(connectingLinesClause(words), words).toBe("");
    // 414-17's froe names no line, and is not told about one.
    const scenes = [froe17()];
    markHostBroll(scenes, { hostLook: WOODWORKER, hostName: "Sam" }, "https://x/host.png");
    expect(buildStillPrompt(scenes[0])).not.toContain(CONNECTING_LINES_CLAUSE);
  });

  it("the still check names a line in the wrong part, a drawknife along the board, and a froe pressed by hand", () => {
    const q2 = STILL_DEFECT_SYSTEM.slice(STILL_DEFECT_SYSTEM.indexOf("QUESTION 2"), STILL_DEFECT_SYSTEM.indexOf("QUESTION 3"));
    expect(q2).toMatch(/a cable, wire, cord, hose or pipe that runs into a part it does not serve or into another part's fitting/);
    expect(q2).toMatch(/one line turning into a different one with no fitting between them/);
    expect(q2).toMatch(/lines meeting at a real fitting \(a pipe tee, a coupler, a plug in its socket\) are right/);
    expect(q2).not.toMatch(/two different lines joined into one/);
    expect(q2).toMatch(/a drawknife or spokeshave whose blade lies ALONG the length of the piece it is shaving/);
    expect(q2).toMatch(/stroke would run sideways across the piece's narrow width instead of along its length/);
    expect(q2).toMatch(
      /A froe or wedge pressed down on top of the wood by the hands alone, its edge not in it and no club, mallet or sledge to strike it in, is this fault/
    );
    // …never a froe already in and levered, nor a hewing axe or a tool at rest (job 407).
    expect(q2).toMatch(/a froe already sunk in the wood and levered by its handle needs no club in the frame/);
    expect(q2).toMatch(/An axe chopping, felling or hewing into the side of a log or trunk is right/);
    expect(q2).toMatch(/a tool hanging, lying or resting unused is splitting nothing/);
    expect(q2).toMatch(/When unsure, answer false/);
    // The check's own words name the tool or the line, so the redraw can be told which rule it broke.
    expect(STILL_DEFECT_SYSTEM).toMatch(/a fault in a tool, cable, wire or hose names it/);
  });

  it("414-17 the first broken draw of a tool at work, or of a line in any picture, is redrawn told what was wrong", async () => {
    const { faultRedrawFor } = await import("./longformVideo");
    type R = "at rest" | "soft print" | "named fault";
    const none = new Set<R>();
    const first = { broken: 0, writing: 0 };
    const once = { broken: 1, writing: 0 };
    const froe = { broken: true, what: "froe blade lying flat on top of the bolt, no club" };
    expect(faultRedrawFor({}, froe, first, none, true, true)).toBe("named fault");
    // A tool with nobody at it cannot be put to work: its plain reroll, then the at-rest draw, as before.
    expect(faultRedrawFor({}, froe, first, none, true, false)).toBeUndefined();
    // A line is wrong in any picture (413-29, the engine with nobody at it too).
    const wire = { broken: true, what: "spark plug wire runs into the carburetor fuel inlet" };
    expect(faultRedrawFor({}, wire, first, none, true, false)).toBe("named fault");
    // A fault in no tool and no line keeps its plain reroll (7 of 9 cleared, job 352).
    for (const what of ["cutting board floating above the table", "hand with six fingers", "shelf edge fails to line up", ""])
      expect(faultRedrawFor({}, { broken: true, what }, first, none, true, true), what).toBeUndefined();
    // The second broken still gets the one at-rest draw, the named fault tried or not.
    expect(faultRedrawFor({}, froe, once, new Set<R>(["named fault"]), true, true)).toBe("at rest");
    // Once only; never over a content-policy rung; never on a check that could not run.
    expect(faultRedrawFor({}, froe, first, new Set<R>(["named fault"]), true, true)).toBeUndefined();
    expect(faultRedrawFor({}, froe, first, none, false, true)).toBeUndefined();
    expect(faultRedrawFor({}, { ...froe, unchecked: true }, first, none, true, true)).toBeUndefined();
  });

  it("the redraw names the fault and the rule of the tool's own kind — from the fault, else from the picture's words", async () => {
    const {
      namedFaultRedraw,
      NAMED_FAULT_START,
      SPLIT_STRIKE_CLAUSE,
      SHAVING_STROKE_CLAUSE,
      CONNECTING_LINES_CLAUSE,
      TOOL_AT_WORK_FIX,
    } = await import("./longformVideo");
    const P = "Bare hands holding a froe upright.";
    const words17 = `${froe17().showSubject} ${froe17().visualPrompt}`;
    const out = namedFaultRedraw(P, "froe blade lying flat on top of the bolt, no club.", words17, true);
    expect(out.startsWith(`${P} `)).toBe(true);
    expect(out).toContain(
      `${NAMED_FAULT_START} froe blade lying flat on top of the bolt, no club. This time draw it the way it really is.`
    );
    expect(out).toContain(SPLIT_STRIKE_CLAUSE);
    expect(out).not.toContain(SHAVING_STROKE_CLAUSE);
    // Never twice.
    expect(namedFaultRedraw(out, "froe still on top of the bolt", words17, true)).toBe(out);
    // A fault naming only the blade takes its kind from the picture's own words.
    expect(namedFaultRedraw(P, "blade resting on top of the wood", words17, true)).toContain(SPLIT_STRIKE_CLAUSE);
    // 414-13.
    const words13 = `${drawknife13().showSubject} ${drawknife13().visualPrompt}`;
    const stroke = namedFaultRedraw(P, "drawknife lying along the board's length", words13, true);
    expect(stroke).toContain(SHAVING_STROKE_CLAUSE);
    expect(stroke).not.toContain(SPLIT_STRIKE_CLAUSE);
    // 413-29: the line's rule, in a picture of someone at work or not.
    const words29 = `${plugWire29().showSubject} ${plugWire29().visualPrompt}`;
    for (const atWork of [true, false]) {
      const line = namedFaultRedraw(P, "plug wire loops into the carburetor fuel inlet", words29, atWork);
      expect(line).toContain(CONNECTING_LINES_CLAUSE);
      expect(line).not.toContain(TOOL_AT_WORK_FIX);
    }
    // A tool of no named kind gets the plain tool rule.
    const chisel = namedFaultRedraw(P, "chisel edge in the air beside the wood", "hands chopping a mortise with a chisel", true);
    expect(chisel).toContain(TOOL_AT_WORK_FIX);
    expect(chisel).not.toContain(SPLIT_STRIKE_CLAUSE);
    // A fault in no tool and no line leaves the prompt as it was.
    expect(namedFaultRedraw(P, "cutting board floating above the table", words17, true)).toBe(P);
    expect(namedFaultRedraw(P, undefined, words17, true)).toBe(P);
  });

  // The replay over the stored storyboards (the review of this fix): the kind of tool was read off words
  // that name no such tool, and would have put a froe and a club into pictures with none.
  it("a tool's kind is read only off a tool of that kind: end grain, a riving knife, a slice, an aircraft", async () => {
    const { namedFaultClause, SPLIT_STRIKE_CLAUSE, SHAVING_STROKE_CLAUSE, TOOL_AT_WORK_FIX } = await import(
      "./longformVideo"
    );
    // Jobs 131 scene 68 and 171 scene 326: a wood-burning pen and tool on a tray's END GRAIN — no split.
    for (const words of [
      "Weathered bare hands grip a wood-burning pen, its metal tip glowing orange, positioned over the pale pine end grain of a clamped tea tray in a garage workshop under flat daylight",
      "hands using a woodburning tool on the end grain of a wooden tray, close up",
    ]) {
      const c = namedFaultClause("woodburning tool tip in the air above the tray", words, true);
      expect(c, words).toContain(TOOL_AT_WORK_FIX);
      expect(c, words).not.toContain(SPLIT_STRIKE_CLAUSE);
      expect(namedFaultClause("tool tip sunk through the end grain", words, true), words).not.toContain(SPLIT_STRIKE_CLAUSE);
    }
    // A table saw's riving knife is no riving tool.
    const saw = namedFaultClause("saw blade passing through the riving knife", "hands feeding a board past a table saw's riving knife", true);
    expect(saw).toContain(TOOL_AT_WORK_FIX);
    expect(saw).not.toContain(SPLIT_STRIKE_CLAUSE);
    // A wedge of food is no splitting wedge, and is no tool at all.
    expect(namedFaultClause("lemon wedges floating above the plate", "hands squeezing lemon wedges over a plate", true)).toBeUndefined();
    const knife = namedFaultClause("knife blade passing through the board", "hands cutting a lemon into wedges on a cutting board", true);
    expect(knife).toContain(TOOL_AT_WORK_FIX);
    expect(knife).not.toContain(SPLIT_STRIKE_CLAUSE);
    // …while a wedge splitting a log, and a froe, still get the strike.
    expect(namedFaultClause("steel wedge resting on top of the log", "hands driving a steel wedge into a log", true)).toContain(SPLIT_STRIKE_CLAUSE);
    expect(namedFaultClause("wedge lying on top, not in the wood", "splitting a round with a wedge and a sledge", true)).toContain(SPLIT_STRIKE_CLAUSE);
    expect(namedFaultClause("froe resting on top of the bolt", "", true)).toContain(SPLIT_STRIKE_CLAUSE);
    // Job 410 scenes 2 and 24: passengers in "plane seats", at a "plane window" — no plane that shaves.
    const seats = "two older passengers seated side by side in the same row of plane seats, seen from behind";
    expect(namedFaultClause("plane seat back merging into the window", seats, true)).toBeUndefined();
    expect(namedFaultClause("plane wing bent through the window", "a plane window view of farmland far below", true)).toBeUndefined();
    // …while a woodworker's plane still does (job 352 scene 140).
    const jack =
      "host's hands pushing a long grey metal jack plane with a wooden rear handle and front knob across a rough oak board face";
    expect(namedFaultClause("plane lying sideways across the board's width", jack, true)).toContain(SHAVING_STROKE_CLAUSE);
    expect(namedFaultClause("blade lifted off the board", jack, true)).toContain(SHAVING_STROKE_CLAUSE);
    // A workshop's own words never read as an aircraft: a pilot hole, chips flying, jet-black handles.
    expect(
      namedFaultClause(
        "plane lying sideways, chips flying",
        "hands pushing a jet-black hand plane along a board beside a drilled pilot hole",
        true
      )
    ).toContain(SHAVING_STROKE_CLAUSE);
  });

  it("a finger or a hand too many keeps its plain reroll, even beside a tool: naming it could draw it again", async () => {
    const { namedFaultClause, faultRedrawFor } = await import("./longformVideo");
    const words = `${froe17().showSubject} ${froe17().visualPrompt}`;
    for (const what of [
      "six fingers on the froe handle",
      "hand with too many fingers gripping the saw",
      "extra hand on the drill",
      "a third arm holding the chisel",
      "six-fingered hand on the hammer",
    ]) {
      expect(namedFaultClause(what, words, true), what).toBeUndefined();
      expect(faultRedrawFor({}, { broken: true, what }, { broken: 0, writing: 0 }, new Set(), true, true), what).toBeUndefined();
    }
    // Two hands pressing a froe down is the very fault of job 414 scene 17, never a body count.
    expect(namedFaultClause("froe pressed down by two hands, no club", words, true)).toBeDefined();
  });

  it("the new rules name no channel's things", async () => {
    const { SPLIT_STRIKE_CLAUSE, SHAVING_STROKE_CLAUSE, CONNECTING_LINES_CLAUSE, TOOL_AT_WORK_FIX } = await import(
      "./longformVideo"
    );
    for (const clause of [SPLIT_STRIKE_CLAUSE, SHAVING_STROKE_CLAUSE, CONNECTING_LINES_CLAUSE, TOOL_AT_WORK_FIX])
      expect(clause).not.toMatch(/spark plug|carburet|mower|engine|oak|chestnut|bolt|shingle|roof|cabin|folk school|Foxfire/i);
  });
});

/**
 * NOTHING THE LINE DOES NOT NAME (2026-10-20, the review of job 414, an old-cabin film): the back wall
 * with the axe, froe and drawknife a line reveals at 21 s ("But on the back wall hung an axe, a froe,
 * and a drawknife") filled the pictures from 2.6 s on, and "you will come up nearly empty-handed" was
 * drawn as a cabin crowded with goods.
 */
describe("job 414: what a later line reveals is not shown early; a search that finds nothing finds nothing", () => {
  const lines = [
    "Go through an old mountain cabin looking for anything",
    "a store sold, and you will come up nearly empty-handed.",
    "A log restorer in Grayson County, Virginia, let me try it.",
    "The roof was split oak, the walls were hewn poplar, and the door hung on wooden pins with a string for a lock. But on the back wall hung",
    "an axe,",
    "a froe,",
    "and a drawknife,",
    "and the steel in those three was the one thing that homestead could not grow.",
  ];
  const tools = {
    name: "steel tools",
    look: "an axe, a froe, and a drawknife hanging together on the cabin's back interior wall",
  };

  it("before the reveal the tools are taken out of the picture; under 'those three' they stay", async () => {
    const { notYetSaid, ownWordsOf, withoutAddedKeyThings } = await import("./brollRewrite");
    const scene2 = { scriptText: lines[1], showSubject: "the old log cabin interior, looking for store-bought goods" };
    const before = withoutAddedKeyThings(
      "Interior of a historic log cabin in Grayson County, Virginia, with hewn poplar walls. The back wall shows an axe, a froe, and a drawknife hanging together. Scattered salvage and old objects rest on surfaces around the cabin's dim interior.",
      ownWordsOf(scene2, scene2.showSubject),
      notYetSaid(lines, 1, [tools])
    );
    expect(before.text).not.toMatch(/axe|froe|drawknife/);
    expect(before.text).toMatch(/^Interior of a historic log cabin/);
    const scene8 = { scriptText: lines[7], showSubject: "a closer view of the steel tools hanging on the cabin wall" };
    const group =
      "The axe, froe, and drawknife hanging together on the cabin's back interior wall, all three steel tools visible in one view against the dark hewn poplar.";
    expect(notYetSaid(lines, 7, [tools])).toEqual([]);
    expect(withoutAddedKeyThings(group, ownWordsOf(scene8, scene8.showSubject), [tools]).text).toBe(group);
  });

  it("the empty-handed search is a line about nothing being there; a line naming a bare surface is not", async () => {
    const { saysNothingThere } = await import("./brollRewrite");
    expect(saysNothingThere(lines[1])).toBe(true);
    expect(saysNothingThere(lines[3])).toBe(false);
    expect(saysNothingThere("Keep the stack off bare concrete,")).toBe(false);
  });
});

/**
 * THE CHECK NEVER EMPTIES A PICTURE (2026-10-20, the review of the job 414 fix, replayed over the local
 * storyboards): taking out a key thing a later line names took the part of the rewrite it sat in, and
 * on "is that clean Japanese look really worth anything on a market table" (job 264 scene 7) the part
 * was the work itself — the EMPTY market table the operator refused on job 269 came back. A part that
 * carries the scene's own words is the picture: the scene keeps its own words instead.
 */
describe("the later-line check: a market table keeps its finished pieces (job 264 scene 7, the job 269 case)", () => {
  it("the trim that would leave an empty table is refused for the scene's own words", async () => {
    const { ownWordsOf, rewriteFallback, withoutAddedKeyThings } = await import("./brollRewrite");
    const scene = {
      scriptText: "wondering if that clean Japanese look is really worth anything on a market table.",
      showSubject: "market table outdoors holding finished wood pieces set in rows",
    };
    const holder = {
      name: "charred cedar incense holder",
      look: "small blackened cedar block, square-edged, single angled hole drilled halfway, oiled matte-black finish, felt dot on underside, sits on workbench",
    };
    const r = withoutAddedKeyThings(
      "Fold-out wooden table outdoors draped with plain cloth, holding finished charred cedar incense holders and kumiko lattice panels arranged in rows.",
      ownWordsOf(scene, scene.showSubject),
      [holder]
    );
    expect(r.added).toEqual(["charred cedar incense holder"]);
    expect(r.text).toBeUndefined();
    expect(r.left).toBe("Fold-out wooden table outdoors draped with plain cloth.");
    expect(rewriteFallback(scene, scene.showSubject)).toBe("market table outdoors holding finished wood pieces set in rows");
  });
});

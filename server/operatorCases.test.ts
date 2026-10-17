/**
 * THE OPERATOR'S CASES, side by side (2026-10-02). Every case the operator found in a practice film
 * lives here together, so a fix for one cannot quietly undo another — which is exactly what happened
 * when "a list item is never a part" (for Dale's engraved board / house sign) drew Ruth's "a bear paw
 * there" as the whole quilt. The rules under test are general; these lines are only the examples
 * that proved each one.
 */
import { describe, it, expect } from "vitest";
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
  joinShortSplits,
  otherPersonOf,
  parseContextGroups,
} from "./shotList";
import { keepOwnWords } from "./narrationAlignment";
import {
  ANON_PERSON_SUFFIX,
  appScreenClause,
  BLURRED_PRINT_CLAUSE,
  buildSplitRightScene,
  buildStillPrompt,
  guardPitchVisuals,
  hostBrollClause,
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
  looksCutOff,
  markHostBroll,
  onTheBody,
  SHOWS_PERSON,
  withoutFaceAsks,
  WORN_ON_BODY,
} from "./hostLook";

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

  it("the prompt writer carries the same rule, in neutral words", async () => {
    const { RULED_OUT_RULE, STILL_BROLL_ENHANCER_SYSTEM } = await import("./longformVideo");
    expect(STILL_BROLL_ENHANCER_SYSTEM).toContain(RULED_OUT_RULE);
    expect(RULED_OUT_RULE).toMatch(/never the ruled-out act, thing or\s+placement/);
    expect(RULED_OUT_RULE).toMatch(/'away from' or 'across the room from'/);
    expect(RULED_OUT_RULE).not.toMatch(/furnace|vault|shampoo|fence|belly|generator|risers/i);
  });
});

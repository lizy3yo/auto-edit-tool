/**
 * EVERY THING A PICTURE SHOWS KEEPS ITS MEMORY (round 14, the review of the verification films 413 and
 * 414, made on the round-12 code).
 * (a) Job 413 scenes 31-32, the steps "drain it outside, | store it sealed," — both filed under the gas
 *     can, neither naming it — were drawn from no picture at all: a list item whose own words do not
 *     name its key thing gave up every memory, the mower's with it, and the drain step came back with a
 *     black-deck mower where every other mower picture had the faded red deck, the can a different can
 *     in each step. Steps are done to ONE thing: a step is about its key thing and is drawn from the
 *     steps before it; and a list item whose inherited key thing lends nothing still keeps the memory
 *     of the other key things its own description names.
 * (b) Job 414 scene 8, "and the steel in those three…", right after "an axe, | a froe, | and a
 *     drawknife," was drawn from the drawknife close-up alone — the froe came back a flat bar. A picture
 *     that gathers the items of the list just said is drawn from each item's own picture.
 * (c) Job 414: the froe was no key thing (the props list wrote one "steel tools" for all three), so the
 *     froe of scenes 17 and 20, filed under the oak bolt and the shingle, was never drawn from the froe
 *     the viewer had seen; and scene 26, a close-up drawn from scene 25, was never told the broadaxe in
 *     its reference was the same broadaxe.
 * The rows are the stored ones; the rules name no channel's things.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  attachMemory,
  groupMembersOf,
  itemThingName,
  LIST_GROUP_VIEW,
  listGroupFor,
  memoryFor,
  memorySourcesFor,
  memoryView,
  memoryViewFor,
  namesItemThing,
  ownKeyThing,
  requiredThingsFor,
  SCREEN_ITEM_VIEW,
} from "./pictureMemory";
import { buildStillPrompt, listItemClause, memoryClause, memoryFields, rightBeforeClause } from "./longformVideo";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
const url = (job: number, i: number) => `https://r2/${job}/still-src-${i}.png`;
const rendered = async (s: StoryboardScene) => ({ ...s, ...memoryFields(await memoryFor(s, 0), memoryView(s)) });
const at = (board: StoryboardScene[], i: number) => board.find(s => s.index === i)!;
const sources = (board: StoryboardScene[], i: number) => memorySourcesFor(board, at(board, i)).map(s => s.index);

// ─── (a) Job 413: the mower and the gas can ─────────────────────────────────────────────────────

const K413: KeyThing[] = [
  { name: "mower", look: "a push lawn mower, faded red metal deck, black plastic handle bar, rubber wheels, sitting in a residential driveway or shed" },
  { name: "carburetor", look: "a small engine carburetor, dull aluminum housing, round bowl base, metal fuel line fitting, mounted on the mower's engine block" },
  { name: "spark plug wire", look: "a black rubber-coated spark plug wire with a grey metal boot cap, running from the mower engine to the spark plug" },
  { name: "gas can", look: "a red plastic gasoline can with a black spout and cap, stored sealed away from the garage workbench" },
];
const hands = { humanPresent: true } as const;
const job413 = () => [
  pic(27, "close-up of the dull aluminum carburetor with its round bowl base on the mower engine. The host's hand points the thin straw of a red and silver aerosol can at it and sprays.", {
    keyThing: "carburetor",
    otherKeyThings: ["mower"],
    buildStage: "making",
    pictureUrl: url(413, 27),
    ...hands,
  }),
  pic(28, "clean push mower sitting finished in the driveway", {
    scriptText: "Fixed and washed, that same machine sells for a hundred fifty to three hundred.",
    visualPrompt: "A clean faded red push lawn mower with black plastic handle bar and rubber wheels sitting finished in a residential driveway.",
    keyThing: "mower",
    buildStage: "done",
    pictureUrl: url(413, 28),
  }),
  pic(29, "close-up of the host's fingers pulling the grey metal boot cap of a black rubber-coated spark plug wire off the spark plug on the mower engine.", {
    keyThing: "spark plug wire",
    otherKeyThings: ["mower"],
    pictureUrl: url(413, 29),
    ...hands,
  }),
  pic(30, "red gas can sealed and stored away from the garage workbench", {
    scriptText: "And treat gasoline like it’s actively looking for a reason —",
    keyThing: "gas can",
    hostPresent: true,
  }),
  pic(31, "the host's hands draining gasoline from the mower into the red gas can outdoors on the driveway", {
    scriptText: "drain it outside,",
    keyThing: "gas can",
    otherKeyThings: ["mower"],
    listCut: true,
    listKind: "steps",
    ...hands,
  }),
  pic(32, "the red gas can with its black cap screwed tight on a shelf in an outdoor shed", {
    scriptText: "store it sealed,",
    keyThing: "gas can",
    listCut: true,
    listKind: "steps",
  }),
  pic(33, "the sealed red gas can standing alone on a shelf in an outdoor shed", {
    scriptText: "nowhere near a spark. The downside is real: some mowers are just done, and you’ll eat a couple of corpses learning to tell the difference.",
    keyThing: "gas can",
  }),
];

describe("413: steps are done to one thing — the drain step keeps the red mower, the store step the same can", () => {
  it("a step is about the thing it is done to, whatever its words call it", () => {
    const board = job413();
    expect(ownKeyThing(at(board, 31))).toBe("gas can");
    expect(ownKeyThing(at(board, 32))).toBe("gas can");
  });

  it("scene 31 is drawn from the red mower's own picture (scene 28), and by the gas can's written look", async () => {
    const board = job413();
    attachMemory(board, [at(board, 31)], K413);
    expect(sources(board, 31)).toEqual([28]);
    const s = await rendered(at(board, 31));
    expect(s.memoryRefUrls).toEqual([url(413, 28)]);
    expect(s.memoryOthersOnly).toBe(true);
    expect(s.keyThingLook).toBe("a red plastic gasoline can with a black spout and cap");
    const clause = memoryClause(s);
    expect(clause).toMatch(/this exact mower, seen earlier in this video: draw the SAME mower/);
    expect(clause).toContain("It does NOT show the gas can: draw it from this picture's own words.");
    expect(buildStillPrompt(s)).toContain("HOW THE GAS CAN LOOKS in every picture of this video: a red plastic gasoline can with a black spout and cap");
  });

  it("scene 32 is drawn from scene 31's can, the step right before it, and told the can is the very same one", async () => {
    const board = job413();
    board[4].pictureUrl = url(413, 31);
    attachMemory(board, [at(board, 32)], K413);
    expect(sources(board, 32)).toEqual([31]);
    const s = await rendered(at(board, 32));
    expect(s.memoryRefUrls).toEqual([url(413, 31)]);
    expect(s.memoryOthersOnly).toBeUndefined();
    expect(memoryClause(s)).toMatch(/this exact gas can\. Draw the SAME gas can/);
    expect(rightBeforeClause(s)).toMatch(/shown RIGHT BEFORE this one in the video: take ONLY how the gas can looks/);
    // Told it is one of a sequence on the same can — never "could never be taken for the other items".
    expect(listItemClause(s)).toBe(
      ` This picture is one step of a sequence said one after another — it shows "store it sealed", and the other steps ("drain it outside") each get their own picture. Whatever the steps are done to is the very same one in every step.`
    );
    expect(buildStillPrompt(s)).not.toContain("could never be taken for");
  });

  it("the picture after the steps is drawn as it was: the can's first picture and the latest one", () => {
    const board = job413();
    attachMemory(board, [], K413);
    expect(sources(board, 33)).toEqual([31, 32]);
  });
});

// ─── (a) the clean side: a list of THINGS stays a list of separate things ───────────────────────

// Job 295's rows as stored: "Coasters, | ornaments, | small cutting boards." under the pile of pieces.
const K295: KeyThing[] = [
  { name: "cutting board", look: "walnut and maple strips glued in alternating stripes, rectangular, sanded smooth, oiled finish, leaning against garage wall", main: true },
  { name: "workbench", look: "thick maple top on sturdy wood legs, scattered sawdust and offcuts, vise clamped to front edge" },
  { name: "small wood pieces", look: "round coasters and little ornaments in light maple and dark walnut, stacked neatly" },
];
const job295 = () => [
  pic(2, "The walnut and maple cutting board leaning against the garage wall.", { keyThing: "cutting board", pictureUrl: url(295, 2) }),
  pic(9, "The host's hands sorting small wood coasters and ornaments into neat stacks on the workbench.", {
    keyThing: "small wood pieces",
    otherKeyThings: ["workbench"],
    pictureUrl: url(295, 9),
    ...hands,
  }),
  pic(11, "A neat pile of small wood pieces on the workbench: round maple and walnut coasters, little ornaments and a few small cutting boards stacked together", {
    keyThing: "small wood pieces",
    otherKeyThings: ["cutting board", "workbench"],
    pictureUrl: url(295, 11),
  }),
  pic(12, "a close stack of round maple and walnut coasters on the workbench", {
    scriptText: "Coasters,",
    keyThing: "small wood pieces",
    otherKeyThings: ["workbench"],
    listCut: true,
    pictureUrl: url(295, 12),
  }),
  pic(13, "small carved wooden ornaments grouped on the workbench", {
    scriptText: "ornaments,",
    keyThing: "small wood pieces",
    otherKeyThings: ["workbench"],
    listCut: true,
  }),
  pic(14, "a few small cutting boards resting among the stacked wood pieces", {
    scriptText: "small cutting boards.",
    keyThing: "small wood pieces",
    otherKeyThings: ["cutting board"],
    listCut: true,
  }),
];

describe("a list of things: an item never takes the pile it only inherited, nor another item", () => {
  it("295-13: 'ornaments,' is drawn from nothing — every workbench picture before it shows the pile, the coasters are another item", () => {
    const board = job295();
    attachMemory(board, [], K295);
    expect(ownKeyThing(at(board, 13))).toBeUndefined();
    expect(sources(board, 13)).toEqual([]);
    expect(memoryViewFor(board, at(board, 13))).toBeUndefined();
  });

  it("295-14: 'small cutting boards.' is drawn from the cutting board its own words name, for that board alone", async () => {
    const board = job295();
    attachMemory(board, [at(board, 14)], K295);
    expect(sources(board, 14)).toEqual([2]);
    const s = await rendered(at(board, 14));
    expect(s.memoryOthersOnly).toBe(true);
    expect(s.memoryView).toBeUndefined();
    const clause = memoryClause(s);
    expect(clause).toMatch(/this exact cutting board, seen earlier in this video/);
    expect(clause).toContain("It is there only for the cutting board: everything else in this picture is drawn from its own words.");
    expect(clause).not.toMatch(/NOT show the small wood pieces/);
  });

  it("a list item's other things never make it a screen's 'item for sale'", () => {
    // Job 306 scene 4 ("Etsy," filed under the cutting board, beside a phone) — no camera of its own thing.
    const board = [
      pic(1, "a phone lying on the workbench, its screen dark", { keyThing: "phone", pictureUrl: url(306, 1) }),
      pic(4, "A hand holds up a phone showing a white Etsy shop page with a two-column grid of product photos", {
        scriptText: "Etsy,",
        keyThing: "cutting board",
        otherKeyThings: ["phone"],
        listCut: true,
      }),
    ];
    expect(sources(board, 4)).toEqual([1]);
    expect(memoryViewFor(board, at(board, 4))).toBeUndefined();
  });
});

// ─── (b) Job 414: the group after the list ──────────────────────────────────────────────────────

const STEEL_LOOK = "an axe, a froe, and a drawknife hanging together on the cabin's back interior wall";
const K414: KeyThing[] = [
  { name: "steel tools", look: STEEL_LOOK, main: true },
  { name: "white oak bolt", look: "a short pale log section with straight grain, split from a larger white oak log" },
  { name: "green poplar log", look: "a long straight tulip poplar log, pale greenish-white bark, two faces freshly hewn flat" },
  { name: "split shingle", look: "a thin pale wood board, one end shaved thinner by a drawknife, tapered edge" },
  { name: "broadaxe", look: "a heavy steel axe with a wide flat blade and a short curved wooden handle" },
];
const job414 = () => [
  pic(5, "an axe (for the steel tools)", {
    scriptText: "an axe,",
    visualPrompt: "An axe hanging on the cabin's back interior wall, its wide flat steel blade and short curved wooden handle clearly visible against the dark wood.",
    keyThing: "steel tools",
    listCut: true,
    pictureUrl: url(414, 5),
  }),
  pic(6, "a close-up of a froe hanging on the cabin's back log wall: its straight flat steel blade with a wooden handle set upright at a right angle at one end", {
    scriptText: "a froe,",
    keyThing: "steel tools",
    partOf: "steel tools",
    listCut: true,
    pictureUrl: url(414, 6),
  }),
  pic(7, "a close-up of a drawknife hanging on the cabin's back log wall: a long straight blade with a short wooden handle bent at a right angle at each end", {
    scriptText: "and a drawknife,",
    keyThing: "steel tools",
    partOf: "steel tools",
    listCut: true,
    pictureUrl: url(414, 7),
  }),
  pic(8, "a closer view of the steel tools hanging on the cabin wall", {
    scriptText: "and the steel in those three was the one thing that homestead could not grow.",
    visualPrompt: "The axe, froe, and drawknife hanging together on the cabin's back interior wall, all three steel tools visible in one view against the dark hewn poplar.",
    keyThing: "steel tools",
  }),
  pic(9, "a closer view of the steel tools hanging on the cabin wall, a close-up of one detail of it filling the frame", {
    scriptText: "That steel is why the last skill on this list held the other twenty-four together.",
    keyThing: "steel tools",
    sameShot: true,
    pictureUrl: url(414, 9),
  }),
  pic(13, "a student at a workbench pulling a drawknife toward themself with both hands on its two bent end handles, shaving a pale board, seen from the side", {
    scriptText: "since folk schools still teach plenty of these",
    ...hands,
  }),
  pic(17, "the host's hands holding a froe upright by its wooden handle, its flat blade driven into the end of a short pale white oak bolt", {
    keyThing: "white oak bolt",
    buildStage: "making",
    pictureUrl: url(414, 17),
    ...hands,
  }),
  pic(18, "the host sawing a white oak log into short bolts outside the cabin", {
    scriptText: "cut the log into short bolts,",
    keyThing: "white oak bolt",
    listCut: true,
    listKind: "steps",
    buildStage: "material",
    pictureUrl: url(414, 18),
    ...hands,
  }),
  pic(19, "a white oak bolt being split into pie-shaped wedges near cabin", {
    scriptText: "split each bolt into pie wedges,",
    keyThing: "white oak bolt",
    listCut: true,
    listKind: "steps",
    buildStage: "making",
    pictureUrl: url(414, 19),
    ...hands,
  }),
  pic(20, "the host's hands levering a froe's handle sideways as its blade splits a thin board off a pale oak wedge", {
    scriptText: "and rived the boards along those same lines,",
    keyThing: "split shingle",
    listCut: true,
    listKind: "steps",
    buildStage: "making",
    ...hands,
  }),
  pic(25, "the host's hands swinging a broadaxe with a wide flat blade down along the side of a long greenish-white poplar log, chips flying from a flat hewn face", {
    keyThing: "green poplar log",
    otherKeyThings: ["broadaxe"],
    buildStage: "making",
    pictureUrl: url(414, 25),
    ...hands,
  }),
  pic(26, "a close-up of a wide flat broadaxe blade slicing a pale layer of wood from the log's side, with darker heartwood showing beneath", {
    keyThing: "green poplar log",
    otherKeyThings: ["broadaxe"],
    partOf: "green poplar log",
    buildStage: "making",
  }),
  pic(29, "a close-up of a hewn poplar log wall with scalloped axe marks, where small thin drying cracks run along the grain", {
    keyThing: "green poplar log",
    buildStage: "done",
    pictureUrl: url(414, 29),
  }),
];

describe("414-8: the picture under 'those three' is drawn from each item's own picture", () => {
  it("its memory is the axe, the froe and the drawknife — it was the drawknife close-up alone", () => {
    const board = job414();
    attachMemory(board, [], K414);
    expect(listGroupFor(board, at(board, 8))?.map(s => s.index)).toEqual([5, 6, 7]);
    expect(sources(board, 8)).toEqual([5, 6, 7]);
    expect(memoryViewFor(board, at(board, 8))).toBe(LIST_GROUP_VIEW);
    expect(at(board, 8).groupItems).toEqual(["an axe", "a froe", "a drawknife"]);
  });

  it("each item is named, and none of the item pictures is a template to repeat", async () => {
    const board = job414();
    attachMemory(board, [at(board, 8)], K414);
    const s = await rendered(at(board, 8));
    expect(s.memoryRefUrls).toEqual([url(414, 5), url(414, 6), url(414, 7)]);
    expect(s.memoryOthersOnly).toBeUndefined();
    expect(s.keyThingLook).toBeUndefined();
    expect(memoryClause(s)).toContain(
      ` The 3 reference images are the pictures of the items of the list just said ("an axe", "a froe" and "a drawknife"), one item in each. This picture shows them together: draw every item a reference shows as the very same one — identical shape, size, colours, materials and wear — where this picture's own words put them, from a new camera position; never copy any reference's framing.`
    );
    expect(rightBeforeClause(s)).toBe("");
  });

  it("407-7: the same words where each tool was a key thing of its own — gathered by its own words naming them", () => {
    const board = [
      pic(4, "an axe (for the axe)", { scriptText: "an axe,", keyThing: "axe", listCut: true, pictureUrl: url(407, 4) }),
      pic(5, "an L-shaped tool with a long flat steel blade and a short upright wooden handle, hanging on a log cabin wall beside an axe", {
        scriptText: "a froe,",
        keyThing: "froe",
        otherKeyThings: ["axe"],
        listCut: true,
        pictureUrl: url(407, 5),
      }),
      pic(6, "a straight steel blade with a bent wooden handle at each end, hanging on a log cabin wall", {
        scriptText: "and a drawknife,",
        keyThing: "drawknife",
        listCut: true,
        pictureUrl: url(407, 6),
      }),
      pic(7, "close-up of the steel blades of the axe, the froe and the drawknife hanging together on the cabin back wall", {
        scriptText: "and the steel in those three was the one thing that homestead could not grow.",
        keyThing: "drawknife",
        otherKeyThings: ["froe", "axe"],
      }),
    ];
    expect(listGroupFor(board, board[3])?.map(s => s.index)).toEqual([4, 5, 6]);
    expect(memoryViewFor(board, board[3])).toBe(LIST_GROUP_VIEW);
  });

  it("414-9, the next picture, gathers nothing: drawn as before", () => {
    const board = job414();
    attachMemory(board, [], K414);
    expect(listGroupFor(board, at(board, 9))).toBeUndefined();
    expect(memoryViewFor(board, at(board, 9))).not.toBe(LIST_GROUP_VIEW);
  });

  it("147-342: 'all of them ran up on the treadle' over a picture of the machine is no group of the items", () => {
    const board = [
      pic(338, "zippered pouches piled in a basket on the sewing room table", { scriptText: "the pouches,", listCut: true, pictureUrl: url(147, 338) }),
      pic(339, "dish towels tied in bundles of three with twine", { scriptText: "the towels,", listCut: true, pictureUrl: url(147, 339) }),
      pic(340, "stuffed scrap pillows stacked in a basket", { scriptText: "the pillows,", listCut: true, pictureUrl: url(147, 340) }),
      pic(341, "feed sack tote bags stacked and tied on the roadside market table", { scriptText: "and the tote bags,", listCut: true, pictureUrl: url(147, 341) }),
      pic(342, "hands stitching cloth quickly at the treadle sewing machine", {
        scriptText: "near about all of them ran up on the treadle, quick and plain,",
        ...hands,
      }),
    ];
    expect(listGroupFor(board, board[4])).toBeUndefined();
  });

  it("357-9: 'It's none of those.' gathers nothing", () => {
    const board = [
      pic(6, "dog's nose pressed against a visitor's knee in the entryway", { scriptText: "A whole lot of folks wonder if that's rude,", keyThing: "dog's nose", listCut: true }),
      pic(7, "dog's nose poking toward a person's hand", { scriptText: "or nosy,", keyThing: "dog's nose", listCut: true }),
      pic(8, "dog's nose sniffing a person's hand near another dog", { scriptText: "or some kind of jealousy thing.", keyThing: "dog's nose", listCut: true }),
      pic(9, "dog's nose sniffing a person's shoes at the entry", { scriptText: "And here's the thing. It's none of those.", keyThing: "dog's nose" }),
    ];
    expect(listGroupFor(board, board[3])).toBeUndefined();
  });

  it("a list of steps is never gathered: its steps are one thing already", () => {
    const board = [
      pic(18, "the host sawing a white oak log into short bolts", { scriptText: "cut the log into short bolts,", keyThing: "white oak bolt", listCut: true, listKind: "steps" }),
      pic(19, "a white oak bolt split into pie-shaped wedges", { scriptText: "split each bolt into pie wedges,", keyThing: "white oak bolt", listCut: true, listKind: "steps" }),
      pic(21, "split oak boards stacked by the cabin", { scriptText: "and all three take an afternoon.", keyThing: "white oak bolt" }),
    ];
    expect(listGroupFor(board, board[2])).toBeUndefined();
  });
});

// ─── (c) Job 414: the members of a group, and the other things in a close-up ────────────────────

describe("414: the axe, the froe and the drawknife are things of their own after their list", () => {
  it("the list's three items are the members of the 'steel tools' group its props look names", () => {
    const board = job414();
    expect(groupMembersOf(board, K414).map(m => [m.name, m.item.index, m.of])).toEqual([
      ["axe", 5, "steel tools"],
      ["froe", 6, "steel tools"],
      ["drawknife", 7, "steel tools"],
    ]);
  });

  it("17 and 20 are drawn from the froe the viewer saw; the check holds them to it", () => {
    const board = job414();
    attachMemory(board, [], K414);
    expect(at(board, 6).otherKeyThings).toEqual(["froe"]);
    expect(at(board, 17).otherKeyThings).toEqual(["froe"]);
    expect(sources(board, 17)).toEqual([6]);
    // 20 is a step: never drawn from another list's item, so from the froe's next picture (scene 17).
    expect(at(board, 20).otherKeyThings).toEqual(["froe"]);
    expect(sources(board, 20)).toEqual([17]);
    expect(requiredThingsFor(at(board, 17))).toContain("froe");
  });

  it("17's prompt names the froe in its reference as the very same one", async () => {
    const board = job414();
    board[6].pictureUrl = undefined;
    attachMemory(board, [at(board, 17)], K414);
    const s = await rendered(at(board, 17));
    expect(s.memoryRefUrls).toEqual([url(414, 6)]);
    const clause = memoryClause(s);
    expect(clause).toMatch(/this exact froe, seen earlier in this video: draw the SAME froe/);
    expect(clause).toContain("It does NOT show the white oak bolt: draw it from this picture's own words.");
  });

  it("13, filed under nothing, is filed under the drawknife and drawn from its item", () => {
    const board = job414();
    attachMemory(board, [], K414);
    expect(at(board, 13).keyThing).toBe("drawknife");
    expect(sources(board, 13)).toEqual([7]);
  });

  it("'scalloped axe marks' are no axe, and a broadaxe is no axe", () => {
    const board = job414();
    attachMemory(board, [], K414);
    expect(at(board, 29).otherKeyThings).toBeUndefined();
    expect(at(board, 25).otherKeyThings).toEqual(["broadaxe"]);
    expect(namesItemThing("a hewn poplar log wall with scalloped axe marks", "axe")).toBe(false);
    expect(namesItemThing("Bare hands levering the froe's handle sideways", "froe")).toBe(true);
    expect(namesItemThing("chips flying from the axe, axe marks along the face", "axe")).toBe(true);
  });

  it("a member is the thing an item's words name, singular", () => {
    expect(itemThingName("and a drawknife,")).toBe("drawknife");
    expect(itemThingName("Coasters,")).toBe("coaster");
    expect(itemThingName("keepsake boxes.")).toBe("keepsake box");
    expect(itemThingName("the star looks fine before you notice")).toBeUndefined();
    expect(itemThingName("about $10 to $40.")).toBeUndefined();
  });
});

describe("no members where the items are no separate things", () => {
  it("354: 'Ivory, | oat, | a warm coral,' are the beads of ONE necklace, whose look lists its colours", () => {
    const things: KeyThing[] = [
      { name: "light bead necklace", look: "chunky beads in ivory, oat, and warm coral tones, round and matte, same large scale as the dark version" },
    ];
    const board = [
      pic(25, "close-up of a few chunky round matte ivory beads on the strand, filling the frame", {
        scriptText: "Ivory,", keyThing: "light bead necklace", partOf: "light bead necklace", listCut: true,
      }),
      pic(26, "close-up of a few chunky round matte oat-colored beads on the strand, filling the frame", {
        scriptText: "oat,", keyThing: "light bead necklace", partOf: "light bead necklace", listCut: true,
      }),
      pic(27, "close-up of a few chunky round matte warm coral beads on the strand, filling the frame", {
        scriptText: "a warm coral,", keyThing: "light bead necklace", partOf: "light bead necklace", listCut: true,
      }),
    ];
    expect(groupMembersOf(board, things)).toEqual([]);
  });

  it("378: under 'chunky light beads', every item's picture shows those beads — one thing in its finishes", () => {
    const things: KeyThing[] = [
      { name: "chunky light beads", look: "large round beads in ivory, oat, or warm coral finish, matte or soft mother-of-pearl sheen" },
    ];
    const board = [
      pic(22, "chunky light beads in ivory finish worn close to the woman's neck", { scriptText: "Ivory,", keyThing: "chunky light beads", listCut: true }),
      pic(23, "chunky light beads in oat finish worn close to the woman's neck", { scriptText: "oat,", keyThing: "chunky light beads", listCut: true }),
      pic(24, "chunky light beads in warm coral finish worn on the woman's neck", { scriptText: "a warm coral,", keyThing: "chunky light beads", listCut: true }),
    ];
    expect(groupMembersOf(board, things)).toEqual([]);
  });

  it("295: a key thing of its own ('small cutting boards' for the cutting board) is never a member", () => {
    const board = job295();
    expect(groupMembersOf(board, K295).map(m => m.name)).toEqual(["coaster", "ornament"]);
  });

  it("one item alone under a group makes no member", () => {
    const board = job414().filter(s => s.index !== 5 && s.index !== 7);
    expect(groupMembersOf(board, K414)).toEqual([]);
  });
});

describe("414-26: a close-up drawn from a picture with the broadaxe in it is told it is the same broadaxe", () => {
  it("the part clause names the other things its reference shows", async () => {
    const board = job414();
    attachMemory(board, [at(board, 26)], K414);
    const s = await rendered(at(board, 26));
    expect(s.memoryRefUrls).toEqual([url(414, 25)]);
    expect(memoryClause(s)).toContain(
      " The broadaxe in it is this exact broadaxe: draw the very same one — identical shape, size, colours, materials and wear."
    );
  });

  it("a part close-up with no other thing reads exactly as before", () => {
    const s = pic(30, "close-up of the knot on the board's face", {
      keyThing: "rough-sawn board",
      partOf: "rough-sawn board",
      memoryRefUrls: [url(352, 6)],
      memoryView: "a close-up that fills the whole frame with just the part this picture is about — the rest of it barely shows",
    });
    expect(memoryClause(s).startsWith(
      " The first reference image shows the whole rough-sawn board. This picture is a CLOSE-UP of just the part of it the words are about, filling the frame — never the whole rough-sawn board again. Keep the same fabrics, colours, materials and wear as the reference. "
    )).toBe(true);
    expect(memoryClause(s)).not.toContain("this exact");
  });
});

describe("a screen filed under its own device is never handed the device as 'the item for sale'", () => {
  it("336-21: the laptop's own picture is no reference of the laptop's screen", () => {
    const board = [
      pic(8, "A slim silver laptop open on the workbench, showing a white web shop order page with soft orange accents and a small product photo.", {
        keyThing: "laptop",
        otherKeyThings: ["workbench"],
        pictureUrl: url(336, 8),
      }),
      pic(21, "", {
        hostPresent: true,
        splitVisual: "Workshop bench with a laptop open showing an Etsy shop page displaying thumbnail photos of handmade wooden items arranged in a grid, the text kept unreadable.",
        keyThing: "laptop",
      }),
    ];
    expect(memoryViewFor(board, board[1])).toBe(SCREEN_ITEM_VIEW);
    expect(sources(board, 21)).toEqual([]);
  });

  it("a screen filed under the item it shows keeps the item's picture", () => {
    const board = [
      pic(4, "a tall maple bookcase standing in the driveway", { keyThing: "bookcase", pictureUrl: url(306, 4) }),
      pic(35, "A phone held up showing a Facebook Marketplace listing on a white screen with a large square photo of a wooden bookcase", {
        keyThing: "bookcase",
      }),
    ];
    expect(memoryViewFor(board, board[1])).toBe(SCREEN_ITEM_VIEW);
    expect(sources(board, 35)).toEqual([4]);
  });
});

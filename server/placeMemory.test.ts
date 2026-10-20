/**
 * A PLACE LENDS NO PICTURE (round 14, the verification films on the round-12 code).
 * - Job 411 (robins): "lawn", the northern backyard's, was a key thing. Every picture whose words named
 *   a lawn was drawn from its first picture (scene 2, the empty frosty yard): scenes 5, 7, 12, 18, 21
 *   and 28 reused that yard's framing — the same tree, fence and house, five times in two minutes — and
 *   the Gulf Coast panel (scene 16), "a green lawn in a Gulf Coast yard", was matched to that lawn by its
 *   word and drawn with snow under the palms. The setting rule (`MEMORY_SETTING_CLAUSE`) and
 *   `memoryNotShown` never applied: the references DID show "a lawn".
 * - Job 412 (cats): "wild landscape" lent its first wilderness to the pictures after it (scene 26 was
 *   drawn from 23 and 25), and the "ankle" list item (scene 4), drawn from nothing as every list item
 *   is, came back in another bedroom with a black metal bed and cream bedding.
 * A place, a setting or the weather now lends no reference picture; a place keeps a WRITTEN look, cut to
 * what it is made of, used only where a picture's own words set it in that same place — the props
 * list's home setting too — with the looks of the key things standing in it. Things keep their memory.
 * The rows are the stored ones; the rule names no channel's places.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  attachMemory,
  homePlaceOf,
  isPlaceName,
  isWeatherName,
  lendsNoPicture,
  memoryFor,
  memorySourcesFor,
  memoryView,
  placeLook,
  placeLookClause,
  placeLooksFor,
  placesSetIn,
} from "./pictureMemory";
import {
  buildSplitRightScene,
  buildStillPrompt,
  MEMORY_SETTING_CLAUSE,
  memoryClause,
  memoryFields,
  memoryToWords,
  promptAfterMemoryChange,
  withSplitMemory,
} from "./longformVideo";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
const url = (job: number, i: number) => `https://r2/${job}/still-src-${i}.png`;
const rendered = async (s: StoryboardScene) =>
  ({ ...s, ...memoryFields(await memoryFor(s, 0), memoryView(s)) }) as StoryboardScene;

// Job 411's props list as stored.
const SHEET_411 = [
  "backyard: a suburban yard with a mowed lawn, holly bushes with red berries along the border, a porch light fixture, storm windows on the house, late fall to winter light",
  "MAIN robin: an American robin, a reddish-orange breast, a dark gray-brown back, a white lower belly, a white eye ring",
  "kitchen window: a rectangular window with white wooden frame, clear glass panes, looking out over the lawn",
  "holly bush: a dense evergreen shrub with glossy pointed dark green leaves and clusters of bright red berries",
  "porch light: a small wall-mounted light fixture with a frosted glass globe and dark metal base, beside the back door",
  "storm window: a clear glass pane in a white aluminum frame mounted over the main window",
  "lawn: a wide stretch of short green-to-brown grass covering the backyard",
  "snow: a thin even layer of white snow covering the lawn and holly leaves in late winter",
].join("\n");
const LAWN_LOOK = "a wide stretch of short green-to-brown grass covering the backyard";
const K411: KeyThing[] = [
  { name: "robin", look: "an American robin, a reddish-orange breast, a dark gray-brown back, a white lower belly, a white eye ring", main: true },
  { name: "kitchen window", look: "a rectangular window with white wooden frame, clear glass panes, looking out over the lawn" },
  { name: "holly bush", look: "a dense evergreen shrub with glossy pointed dark green leaves and clusters of bright red berries" },
  { name: "porch light", look: "a small wall-mounted light fixture with a frosted glass globe and dark metal base, beside the back door" },
  { name: "storm window", look: "a clear glass pane in a white aluminum frame mounted over the main window" },
  { name: "lawn", look: LAWN_LOOK },
  { name: "snow", look: "a thin even layer of white snow covering the lawn and holly leaves in late winter" },
];
const BACKYARD_CUT =
  "a suburban yard with a mowed lawn, holly bushes with red berries along the border, a porch light fixture, storm windows on the house";

// Job 411's scenes 2-21 as stored (the ones these cases touch), pictures drawn.
const job411 = () => [
  pic(2, "an empty frosty backyard lawn at dawn under a pale sky", {
    visualPrompt:
      "Empty suburban backyard lawn, patchy green and brown, frosted and still at dawn under a pale overcast sky, with a house and storm windows visible at the edge.",
    keyThing: "lawn",
    pictureUrl: url(411, 2),
  }),
  pic(5, "an American robin standing on a patchy green-to-brown lawn in early spring with the last snow melting", {
    visualPrompt: "An American robin standing on a lawn that is patchy brown and green with patches of melting snow, in early spring light.",
    keyThing: "robin",
    otherKeyThings: ["lawn", "snow"],
    pictureUrl: url(411, 5),
  }),
  pic(7, "the kitchen window with the backyard lawn visible beyond it", {
    visualPrompt:
      "A rectangular kitchen window with white wooden frame and clear glass panes, viewed from inside looking out over the backyard lawn and house exterior in fall light.",
    keyThing: "kitchen window",
    otherKeyThings: ["lawn"],
    pictureUrl: url(411, 7),
  }),
  pic(9, "an American robin with a reddish-orange breast, partly hidden among glossy spiny dark green holly leaves and clusters of bright red berries", {
    visualPrompt:
      "An American robin with reddish-orange breast tucked among glossy dark green holly leaves with bright red berry clusters, the bird partly concealed among the spiny foliage.",
    keyThing: "robin",
    pictureUrl: url(411, 9),
  }),
  pic(12, "a robin standing on a snow-covered lawn in the backyard", {
    visualPrompt:
      "An American robin standing on white snow covering the suburban backyard lawn, with a house and storm windows visible in the background.",
    keyThing: "robin",
    otherKeyThings: ["lawn", "snow"],
    pictureUrl: url(411, 12),
  }),
  pic(15, "close-up of the small wall-mounted porch light with a frosted glass globe and dark metal base, with an American robin perched on top of it in winter", {
    visualPrompt:
      "A small wall-mounted porch light with a frosted glass globe and dark metal base, an American robin with reddish-orange breast and dark gray-brown back perched on top, winter backyard behind.",
    keyThing: "porch light",
    otherKeyThings: ["robin"],
    pictureUrl: url(411, 15),
  }),
  pic(16, "a flock of American robins on a sunny green lawn under palm trees", {
    hostPresent: true,
    visualPrompt: "the channel's host, exactly as in their host photo, seated in a chair talking directly to the camera",
    splitVisual: "Several American robins scattered across a green lawn in a Gulf Coast yard under palmetto trees on a sunny winter day",
    keyThing: "robin",
    otherKeyThings: ["lawn"],
  }),
  pic(17, "close-up of an open bird field guide page showing a painted American robin with its entry text", {
    // As stored: the prompt writer's words are scene 18's, left behind.
    visualPrompt: "the empty backyard lawn in late November light",
    keyThing: "robin",
    pictureUrl: url(411, 17),
  }),
  pic(18, "the empty backyard lawn in late November light", {
    visualPrompt:
      "The suburban backyard lawn in late November, short brown grass stretching empty, holly bushes along the border, no birds visible, late fall light.",
    keyThing: "lawn",
    pictureUrl: url(411, 18),
  }),
  pic(21, "a male American robin singing from the top of a fence post above a green summer lawn", {
    visualPrompt:
      "A male American robin with bright orange-red breast perched on top of a wooden fence post, singing with beak open, green summer lawn stretching below.",
    keyThing: "robin",
    otherKeyThings: ["lawn"],
    pictureUrl: url(411, 21),
  }),
];
const at = (board: StoryboardScene[], index: number) => board.find(s => s.index === index)!;
const sources = (board: StoryboardScene[], index: number) =>
  memorySourcesFor(board, at(board, index)).map(s => s.index);

// Job 412's props list as stored.
const SHEET_412 = [
  "bedroom: a quiet bedroom at pre-dawn hours, soft dim blue-grey light, an unmade bed as the central feature, calm and tidy surroundings",
  "MAIN cat: a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail held low, pale green eyes",
  "bed: a low wooden-framed bed with white rumpled sheets and a dark grey blanket pushed to one side, positioned centrally in the bedroom",
  "cat paws: belonging to the same grey-and-white domestic shorthair cat, small white-tipped paws with pink pads, moving silently across fabric",
  "wild landscape: an open dawn-lit wilderness with low golden light, scattered brush and distant hills, calm and empty of people",
].join("\n");
const BED_CUT = "a low wooden-framed bed with white rumpled sheets and a dark grey blanket";
const BEDROOM_CUT = "a quiet bedroom, an unmade bed as the central feature, calm and tidy surroundings";
const K412: KeyThing[] = [
  { name: "cat", look: "a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail held low, pale green eyes", main: true },
  { name: "bed", look: `${BED_CUT} pushed to one side, positioned centrally in the bedroom` },
  { name: "cat paws", look: "belonging to the same grey-and-white domestic shorthair cat, small white-tipped paws with pink pads, moving silently across fabric" },
  { name: "wild landscape", look: "an open dawn-lit wilderness with low golden light, scattered brush and distant hills, calm and empty of people" },
];

// Job 412's scenes 2-26 as stored (the ones these cases touch). Scene 4 is the "ankle" list item.
const job412 = () => [
  pic(2, "cat paws stepping silently onto the foot of the bed", {
    visualPrompt:
      "A grey-and-white domestic shorthair cat's small white-tipped paws land silently on the foot of a low wooden bed with white rumpled sheets in a quiet bedroom at pre-dawn, soft dim blue-grey light.",
    keyThing: "cat paws",
    otherKeyThings: ["bed"],
    pictureUrl: url(412, 2),
  }),
  pic(3, "cat walking across sleeping owner's legs in bed", {
    visualPrompt:
      "A grey-and-white domestic shorthair cat walks slowly across the length of a bed with white rumpled sheets and dark grey blanket, moving over the legs and lower body in a quiet bedroom at pre-dawn.",
    keyThing: "cat",
    otherKeyThings: ["bed"],
    pictureUrl: url(412, 3),
  }),
  pic(4, "cat stepping along owner's body from ankle toward ribs in bed", {
    scriptText: "ankle,",
    listCut: true,
    visualPrompt:
      "Close-up of a grey-and-white cat's small white-tipped paws stepping deliberately along fabric-covered legs and lower torso toward the ribs, moving across a bed in a quiet bedroom at pre-dawn.",
    keyThing: "cat",
    otherKeyThings: ["bed"],
  }),
  pic(5, "close-up of the cat's white-tipped paw pressing onto the sleeping owner's knee under the dark grey blanket", {
    scriptText: "knee,",
    listCut: true,
    visualPrompt:
      "Close-up of a grey-and-white cat's small white-tipped paw pressing down on the knee beneath a dark grey blanket on a bed in a quiet bedroom at pre-dawn.",
    keyThing: "cat paws",
    otherKeyThings: ["cat"],
  }),
  pic(13, "owner lying in bed under grey blanket at pre-dawn", {
    visualPrompt:
      "Bare weathered hands lying still under a dark grey blanket on white rumpled sheets in pre-dawn light, the bedding casual and unmade around them.",
    keyThing: "bed",
    pictureUrl: url(412, 13),
  }),
  pic(21, "the grey-and-white cat resting calmly in the dim bedroom at night", {
    visualPrompt:
      "Grey-and-white domestic shorthair cat resting on the rumpled bed in the dim pre-dawn bedroom, pale green eyes open and calm, the quiet room barely lit.",
    keyThing: "cat",
    pictureUrl: url(412, 21),
  }),
  pic(23, "a wild cat stalking low through scattered brush across the dawn-lit wild landscape toward a small mouse", {
    visualPrompt:
      "Wild cat crouched low and moving through scattered dry brush across an open dawn-lit wilderness, golden low light on distant hills, a small mouse ahead on the ground.",
    keyThing: "wild landscape",
    otherKeyThings: ["cat"],
    pictureUrl: url(412, 23),
  }),
  pic(25, "a wild cat stalking low through scattered brush across the dawn-lit wild landscape toward a small mouse, a close-up of one detail of it filling the frame", {
    keyThing: "wild landscape",
    otherKeyThings: ["cat"],
    pictureUrl: url(412, 25),
  }),
  pic(26, "a wild cat stalking low through scattered brush across the dawn-lit wild landscape toward a small mouse, a close-up of one detail of it filling the frame", {
    keyThing: "wild landscape",
    otherKeyThings: ["cat"],
  }),
];

describe("which key things are places (isPlaceName, isWeatherName)", () => {
  it("names whose head word is a place, setting or surroundings — the stored films' lawns, landscapes, aisles, rooms and lots", () => {
    for (const n of [
      "lawn",
      "wild landscape",
      "gulf coast yard",
      "pharmacy aisle",
      "buyer's driveway",
      "bedroom at night",
      "kitchen with stove",
      "parking lot (recalled)",
      "Garage interior",
      "woodlot",
    ])
      expect(isPlaceName(n), n).toBe(true);
  });

  it("never a thing named after where it is, nor a part of the body", () => {
    for (const n of [
      "kitchen window",
      "porch light",
      "storm window",
      "holly bush",
      "garage door",
      "market table",
      "hallway ceiling",
      "space heater",
      "area rug with cord",
      "collarbone area",
      "robin",
      "bed",
      "cat paws",
      "nightstand",
    ])
      expect(isPlaceName(n), n).toBe(false);
  });

  it("the weather lends nothing either — but a thing named for it is a thing", () => {
    expect(isWeatherName("snow")).toBe(true);
    expect(lendsNoPicture("snow")).toBe(true);
    expect(isWeatherName("snow globe")).toBe(false);
    expect(isWeatherName("storm window")).toBe(false);
    expect(lendsNoPicture("robin")).toBe(false);
  });
});

describe("the props list's home setting (homePlaceOf)", () => {
  it("411 and 412: the first line names a place", () => {
    expect(homePlaceOf(SHEET_411)).toEqual({ name: "backyard", look: SHEET_411.split("\n")[0].slice("backyard: ".length) });
    expect(homePlaceOf(SHEET_412)?.name).toBe("bedroom");
  });

  it("a line labelled only HOME is named by its description's lead (jobs 299 and 327)", () => {
    expect(
      homePlaceOf("HOME: one-car garage workshop: uncluttered concrete-floor space with a wood workbench, pegboard tool wall")
    ).toEqual({
      name: "one-car garage workshop",
      look: "one-car garage workshop, uncluttered concrete-floor space with a wood workbench, pegboard tool wall",
    });
    expect(
      homePlaceOf("HOME: a modest kitchen with an adjoining living room, warm lamp light, a worn rocking chair near a window")?.name
    ).toBe("modest kitchen");
  });

  it("a home written as a thing is no place (jobs 262, 307, 279)", () => {
    expect(homePlaceOf("HOME: hallway ceiling — pale flat-painted plaster ceiling in a carpeted hallway")).toBeUndefined();
    expect(homePlaceOf("KITCHEN TABLE: wide wooden farmhouse table, worn honey-brown finish")).toBeUndefined();
    expect(homePlaceOf("kitchen table: round wooden table with a smooth worn finish")).toBeUndefined();
    expect(homePlaceOf(undefined)).toBeUndefined();
  });
});

describe("a place's written look is what it is made of (placeLook)", () => {
  it("drops the season, the light and the hour — 411's backyard and 412's bedroom and wilderness", () => {
    expect(placeLook(SHEET_411.split("\n")[0].slice("backyard: ".length))).toBe(BACKYARD_CUT);
    expect(placeLook(SHEET_412.split("\n")[0].slice("bedroom: ".length))).toBe(BEDROOM_CUT);
    expect(placeLook(K412[3].look)).toBe("an open wilderness, scattered brush and distant hills, calm and empty of people");
  });

  it("drops what lights it and what is put there for one moment (jobs 302, 283, 263, 327)", () => {
    expect(placeLook("small room with a wooden work table, wood-paneled walls, lit by a warm desk lamp in the evenings")).toBe(
      "small room with a wooden work table, wood-paneled walls"
    );
    expect(placeLook("pale concrete driveway beside the garage, furniture staged near the curb for pickup")).toBe(
      "pale concrete driveway beside the garage"
    );
    expect(placeLook("pale carpet runner, white walls, flat ceiling, a stretch that the story keeps returning to")).toBe(
      "pale carpet runner, white walls, flat ceiling"
    );
    expect(placeLook("a worn rocking chair near a window, evening television glow, late-autumn calm throughout")).toBe(
      "a worn rocking chair near a window, calm throughout"
    );
  });

  it("keeps 'light' that describes something (job 266's bench, job 342's concrete, job 411's porch light)", () => {
    expect(placeLook("sturdy wood-topped bench with a vise, light wear on the surface")).toBe(
      "sturdy wood-topped bench with a vise, light wear on the surface"
    );
    expect(placeLook("paved residential driveway, light grey concrete")).toBe("paved residential driveway, light grey concrete");
    expect(placeLook("a porch light fixture")).toBe("a porch light fixture");
  });
});

describe("411: the lawn lends no picture — the robin still does", () => {
  it("the pictures that named a lawn are no longer drawn from the empty yard (scene 2)", () => {
    const board = job411();
    attachMemory(board, board, K411, homePlaceOf(SHEET_411));
    // As stored: 5, 7, 12, 18 and 21 were all drawn from scene 2's yard.
    expect(sources(board, 5)).toEqual([]);
    expect(sources(board, 7)).toEqual([]);
    expect(sources(board, 18)).toEqual([]);
    // The robin keeps its memory: its first picture and the latest one before.
    expect(sources(board, 12)).toEqual([5, 9]);
    expect(sources(board, 21)).toEqual([5, 17]);
    expect(memoryView(at(board, 18))).toBeUndefined();
  });

  it("scene 12: drawn from the robin's pictures, the lawn and the backyard held in words — no snow or hour from the home line", async () => {
    const board = job411();
    attachMemory(board, [at(board, 12)], K411, homePlaceOf(SHEET_411));
    const s = await rendered(at(board, 12));
    expect(s.memoryRefUrls).toEqual([url(411, 5), url(411, 9)]);
    expect(s.memoryNotShown).toEqual(["lawn", "snow"]);
    expect(memoryClause(s)).toMatch(/show this exact robin\. Draw the SAME robin — /);
    expect(memoryClause(s)).toContain(" The lawn and snow are drawn as this picture's own words describe them.");
    expect(s.placeLooks).toEqual([
      { name: "lawn", look: LAWN_LOOK },
      { name: "backyard", look: BACKYARD_CUT },
    ]);
    const prompt = buildStillPrompt(s);
    expect(prompt).toContain(`WHERE THIS PICTURE IS SET, the same place in every picture of this video set there — the lawn: ${LAWN_LOOK}; the backyard: ${BACKYARD_CUT}.`);
    expect(prompt).not.toContain("winter light");
  });

  it("scene 16, the Gulf Coast panel: drawn from the robin only, the lawn its own words', and no northern look", async () => {
    const board = job411();
    const host = at(board, 16);
    attachMemory(board, [host], K411, homePlaceOf(SHEET_411));
    const panel = await withSplitMemory(host, buildSplitRightScene(host), 0);
    expect(panel.memoryRefUrls).toEqual([url(411, 5), url(411, 15)]);
    expect(panel.memoryNotShown).toEqual(["lawn"]);
    expect(panel.placeLooks).toBeUndefined();
    const clause = memoryClause(panel);
    expect(clause).toMatch(/this exact robin\. Draw the SAME robin — /);
    expect(clause).not.toMatch(/robin and lawn/);
    expect(clause).toContain(" The lawn is drawn as this picture's own words describe it.");
    expect(clause.endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
    const prompt = buildStillPrompt(panel, false, undefined, undefined, true);
    expect(prompt).not.toContain(LAWN_LOOK);
    expect(prompt).not.toContain("backyard");
    expect(placesSetIn(panel, [K411[5]], homePlaceOf(SHEET_411))).toEqual([]);
  });

  it("scene 17: a prompt left from another picture sets nothing (the field guide page is not on the lawn)", () => {
    const board = job411();
    attachMemory(board, board, K411, homePlaceOf(SHEET_411));
    expect(placeLooksFor(at(board, 17), K411, homePlaceOf(SHEET_411))).toEqual([]);
  });

  it("a picture whose words set it in no place reads exactly as before (scene 9, the robin in the holly)", async () => {
    const board = job411();
    attachMemory(board, [at(board, 9)], K411, homePlaceOf(SHEET_411));
    const s = await rendered(at(board, 9));
    expect(s.memoryRefUrls).toEqual([url(411, 5)]);
    expect(s.placeLooks).toBeUndefined();
    expect(placeLookClause(s)).toBe("");
    expect(buildStillPrompt(s)).not.toContain("WHERE THIS PICTURE IS SET");
  });
});

describe("412: the wilderness lends no picture; the bedroom keeps one look, list items included", () => {
  it("the wild landscape's pictures are drawn from no earlier landscape (scene 26 was drawn from 23 and 25)", () => {
    const board = job412();
    attachMemory(board, board, K412, homePlaceOf(SHEET_412));
    expect(sources(board, 25)).not.toContain(23);
    expect(sources(board, 26)).not.toContain(23);
    expect(sources(board, 26)).not.toContain(25);
  });

  it("scene 23: no reference at all — the wild cat is not the video's cat — and the landscape is drawn by its words and written look", async () => {
    const board = job412();
    attachMemory(board, [at(board, 23)], K412, homePlaceOf(SHEET_412));
    const s = await rendered(at(board, 23));
    // It used to be drawn from the pet's picture (scene 3) for "the other thing in it": the pet in the
    // desert. "A wild cat" is another one of its kind (`anotherOfItsKind`, anotherOfItsKind.test.ts).
    expect(s.memoryRefUrls).toBeUndefined();
    expect(s.otherKeyThings).toBeUndefined();
    expect(s.othersOfKind).toEqual([{ name: "cat", said: "a wild cat" }]);
    expect(s.keyThingLook).toBeUndefined();
    expect(memoryClause(s)).toBe("");
    // Who is in it is each picture's own too (round 16, `lookWithoutState`): "empty of people" goes.
    expect(s.placeLooks).toEqual([{ name: "wild landscape", look: "an open wilderness, scattered brush and distant hills, calm" }]);
    expect(placeLookClause(s)).not.toMatch(/golden|dawn/);
  });

  it("scene 4, the 'ankle' list item: the bed from the bed's picture, the bedroom's look in words", async () => {
    const board = job412();
    attachMemory(board, [at(board, 4)], K412, homePlaceOf(SHEET_412));
    const s = await rendered(at(board, 4));
    // Round 14: a list item keeps the memory of the other key things its words name — only the cat it
    // inherited lends nothing (scene 3, the cat's picture, is never its reference). The bed comes from
    // scene 2, so it is no longer written in beside the reference.
    expect(s.memoryRefUrls).toEqual([url(412, 2)]);
    expect(s.memoryOthersOnly).toBe(true);
    expect(s.placeLooks).toEqual([{ name: "bedroom", look: BEDROOM_CUT }]);
    const prompt = buildStillPrompt(s);
    expect(prompt).toContain(`the bedroom: ${BEDROOM_CUT}.`);
    expect(prompt).toMatch(/this exact bed, seen earlier in this video/);
    expect(prompt).toContain("It is there only for the bed: everything else in this picture is drawn from its own words.");
    expect(prompt).not.toMatch(/NOT show the cat/);
    expect(prompt).not.toContain("blue-grey light");
  });

  it("scene 3: drawn from scene 2, which shows the bed — the bed is the reference's, the bedroom still in words", async () => {
    const board = job412();
    attachMemory(board, [at(board, 3)], K412, homePlaceOf(SHEET_412));
    const s = await rendered(at(board, 3));
    expect(s.memoryRefUrls).toEqual([url(412, 2)]);
    expect(s.placeLooks).toEqual([{ name: "bedroom", look: BEDROOM_CUT }]);
    // Drawn from words after copying its reference, the bed's look comes back as a thing beside it,
    // said once.
    const words = { ...s, ...memoryToWords(s) };
    const prompt = promptAfterMemoryChange(s, buildStillPrompt(s), memoryToWords(s));
    expect(words.otherThingLooks).toEqual([{ name: "bed", look: BED_CUT }]);
    expect(prompt.split(BED_CUT).length - 1).toBe(1);
    expect(prompt.split(BEDROOM_CUT).length - 1).toBe(1);
  });

  it("scene 21: 'the quiet room' is the bedroom, never somewhere else", () => {
    const board = job412();
    expect(placesSetIn(at(board, 21), [], homePlaceOf(SHEET_412)).map(p => p.name)).toEqual(["bedroom"]);
  });

  it("the bed is still remembered: scene 13 is drawn from the bed's first picture", () => {
    const board = job412();
    attachMemory(board, board, K412, homePlaceOf(SHEET_412));
    expect(sources(board, 13)[0]).toBe(2);
  });
});

describe("a split panel of no key thing still wears where it is set (withSplitMemory)", () => {
  it("412's bedroom on a panel naming no key thing; a look its scene carried from before goes", async () => {
    const host = pic(10, "host talking", {
      hostPresent: true,
      splitVisual: "A closed curtain in the bedroom, a thin line of grey light at its edge",
      placeLooks: [{ name: "garage", look: "a single-car garage" }],
    });
    const board = [...job412().slice(0, 2), host];
    attachMemory(board, [host], K412, homePlaceOf(SHEET_412));
    expect(host.keyThing).toBeUndefined();
    const panel = await withSplitMemory(host, buildSplitRightScene(host), 0);
    expect(panel.placeLooks).toEqual([{ name: "bedroom", look: BEDROOM_CUT }]);
    expect(buildStillPrompt(panel, false, undefined, undefined, true)).toContain(`the bedroom: ${BEDROOM_CUT}`);
  });
});

describe("review: a home's name and a place's look carry no hour, light or cut-off word (stored props lists)", () => {
  it("a HOME label after an en dash is named without the dash or its hour (jobs 167 and 252)", () => {
    expect(
      homePlaceOf(
        "HOME – Farmhouse sewing room: wide-plank wood floor, whitewashed walls, treadle sewing machine by the window, wicker baskets along one wall, soft natural daylight."
      )?.name
    ).toBe("farmhouse sewing room");
    const h252 = homePlaceOf(
      "HOME – single-family house interior at night: pale hallway ceiling and walls, closed bedroom doors along the corridor, a kitchen with a stove, and an unfinished basement with exposed pipes overhead."
    );
    expect(h252?.name).toBe("single-family house interior");
    expect(placeLookClause({ index: 1, placeLooks: [{ name: h252!.name, look: placeLook(h252!.look) }] } as StoryboardScene)).not.toMatch(
      /night|–/
    );
  });

  it("a house's storeys are no story about the video (job 259) — the story one still goes (job 263)", () => {
    expect(
      placeLook(
        "single-story house interior with hallway, bedroom, kitchen, and basement, pale walls, smooth ceilings, warm daylight through windows by day and soft lamp glow at night"
      )
    ).toBe("single-story house interior with hallway, bedroom, kitchen, basement, pale walls, smooth ceilings");
    expect(placeLook("pale carpet runner, white walls, flat ceiling, a stretch that the story keeps returning to")).toBe(
      "pale carpet runner, white walls, flat ceiling"
    );
    // A waiting room is a room, not something waiting for the next moment.
    expect(placeLook("a small waiting room with a row of cushioned chairs along a plain wall")).toBe(
      "a small waiting room with a row of cushioned chairs along a plain wall"
    );
  });

  it("light said after its source, the chill and a part that only says how it is lit all go (jobs 400, 184, 207, 198)", () => {
    expect(placeLook("a narrow shelf lined with rows of plain cream envelopes and cards, soft fluorescent light overhead")).toBe(
      "a narrow shelf lined with rows of plain cream envelopes and cards"
    );
    expect(
      placeLook(
        "concrete-floored space with a single frosted window, cold-weather light, wood dust settled evenly across the floor, autumn/winter chill visible in a faint window frost."
      )
    ).toBe("concrete-floored space with a single window, wood dust settled evenly across the floor");
    expect(
      placeLook(
        "farmhouse room with weathered wood-plank floor and walls, one frost-paned window, a treadle sewing machine and low work table set beneath it, dim and orderly, lit warm at evening."
      )
    ).toBe("farmhouse room with weathered wood-plank floor and walls, one window, a treadle sewing machine and low work table set beneath it, orderly");
    expect(placeLook("plain plank walls and worn wood floor, adjoining rooms warmed by lamplight, home base for all evening sewing")).toBe(
      "plain plank walls and worn wood floor, adjoining rooms"
    );
    // A light that is a fixture stays (job 249's "warm ceiling light fixtures").
    expect(placeLook("pale hallway with matte off-white walls, warm ceiling light fixtures")).toBe(
      "pale hallway with matte off-white walls, warm ceiling light fixtures"
    );
  });

  it("a home the props list also lists as a key thing is said once", () => {
    const board = job412();
    const bedroom: KeyThing = { name: "bedroom", look: "a quiet bedroom, a low wooden bed by the window" };
    const set = placesSetIn(at(board, 21), [bedroom], homePlaceOf(SHEET_412));
    expect(set).toEqual([bedroom]);
  });
});

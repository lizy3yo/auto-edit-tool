/**
 * A THING THE PICTURE SAYS IS NOT THERE IS NOT IN IT (round 15, the verification film 416 on the
 * round-14 code). "…the grass sits empty in the mornings, and nobody sees another robin until spring."
 * was drawn as "empty backyard lawn at quiet morning, no robins visible" (scene 2). `keyThingsIn` read
 * the robin as named by the word in "no robins visible", so the empty lawn was filed with the robin
 * beside it; its first check held it to a robin ("missing"); and, no earlier picture being about the
 * robin, `memoryOf` fell back to the earliest picture filed with it — the empty lawn — as the robin's
 * MEMORY. Scene 5 was drawn from it as "this exact robin" (`memoryRefScenes` [{index 2, own}]) and every
 * later robin picture from scene 5: the same yard from the same camera spot in scenes 2, 5, 13 and 16.
 * Round 14's "a place lends no picture" did not cover it — the yard came in under the ROBIN's name.
 * Job 368 scene 23 is the same fault in another film: "dim coop interior with hens roosted and no feeder
 * present", under "bring the feeder inside for the night", was filed with the feeder and drawn from the
 * feeder's first picture. The rows are the stored ones; the rule names no channel's things.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import { keyThingsIn, othersOfKindIn, plannedKeyThing, saysAbsent } from "./shotList";
import {
  attachMemory,
  memoryFor,
  memorySourcesFor,
  memoryView,
  memoryViewFor,
  ownKeyThing,
  requiredThingsFor,
  tagKeyThings,
} from "./pictureMemory";

const url = (job: number, i: number) => `https://r2/${job}/still-src-${i}.png`;

// Job 416's key things, as stored.
const ROBIN_LOOK =
  "an American robin, a brick-orange breast, a dark gray-brown back, a blackish head with broken white eye ring, a yellow bill";
const K416: KeyThing[] = [
  { name: "robin", look: ROBIN_LOOK, main: true },
  { name: "porch light", look: "a black metal wall-mounted porch light fixture with a frosted glass globe, fixed beside a back door" },
  { name: "backyard lawn", look: "a wide residential backyard with bare and snow-patched grass, a few fallen leaves, bordered by a low wooden fence" },
  { name: "storm windows", look: "white-framed aluminum storm windows fitted over kitchen and living room windows, closed panes, a thin latch on each side" },
];

const EMPTY_LAWN_SUBJECT = "empty backyard lawn at quiet morning, no robins visible";
const EMPTY_LAWN_PROMPT =
  "Empty backyard lawn in early morning light, no robins visible, bare grass with patches of snow, low wooden fence at the edge, quiet residential yard.";

// Job 416's scenes 1-7 as stored, with the filing they were rendered with.
const job416 = (): StoryboardScene[] =>
  [
    { index: 1, hostPresent: true, scriptText: "Every fall, the robins that worked your lawn all summer pack up and head for" },
    {
      index: 2,
      scriptText:
        "Florida. The song at first light goes quiet, the grass sits empty in the mornings, and nobody sees another robin until spring.",
      showSubject: EMPTY_LAWN_SUBJECT,
      visualPrompt: EMPTY_LAWN_PROMPT,
      keyThing: "backyard lawn",
      otherKeyThings: ["robin"],
      pictureUrl: url(416, 2),
    },
    {
      index: 3,
      scriptText: "At least, that’s what just about everybody figures.",
      showSubject:
        "a neighbor raking fallen leaves on a bare fall backyard lawn bordered by a low wooden fence, seen from the side",
      visualPrompt: "Bare fall backyard lawn bordered by a low wooden fence, fallen leaves scattered across the grass, seen from the side.",
      keyThing: "backyard lawn",
      pictureUrl: url(416, 3),
    },
    {
      index: 4,
      hostPresent: true,
      scriptText:
        "Across a good part of the country, plenty of those robins never leave at all, and some will spend the whole winter within a short walk of your back door.",
      showSubject: "an American robin standing on a snow-patched backyard lawn a few steps from a back door in winter",
      splitVisual:
        "American robin standing on snow-patched lawn a few paces from a back door, winter backyard, bare grass and melted patches visible, residential setting.",
      keyThing: "robin",
      otherKeyThings: ["backyard lawn"],
    },
    {
      index: 5,
      scriptText:
        "And that first robin of spring you’ll be so happy to see in March? There’s a fair chance it was around the whole time.",
      showSubject: "an American robin on a thawing, snow-patched backyard lawn in early March",
      visualPrompt: "American robin standing on a thawing backyard lawn with bare patches and melting snow in early March.",
      keyThing: "robin",
      otherKeyThings: ["backyard lawn"],
      pictureUrl: url(416, 5),
    },
    { index: 6, hostPresent: true, scriptText: "I’m Walter, and if you keep an eye on the yard from the kitchen window, this one’s for you." },
    {
      index: 7,
      scriptText: "We’re going through seven things about the robin that hardly anybody knows,",
      showSubject: "a robin perched in the backyard, close view, alert",
      visualPrompt:
        "American robin perched alert in the backyard, brick-orange breast and dark gray-brown back with blackish head and yellow bill, close view.",
      keyThing: "robin",
      pictureUrl: url(416, 7),
    },
  ].map(s => ({ narration: "n", ...s }) as StoryboardScene);
const at = (board: StoryboardScene[], index: number) => board.find(s => s.index === index)!;
const sources = (board: StoryboardScene[], index: number) =>
  memorySourcesFor(board, at(board, index)).map(s => s.index);

describe("saysAbsent: a name the picture's words say only as NOT THERE", () => {
  it("reads job 416 scene 2 and job 368 scene 23 as not showing their thing", () => {
    expect(saysAbsent(EMPTY_LAWN_SUBJECT, "robin")).toBe(true);
    expect(saysAbsent(EMPTY_LAWN_PROMPT, "robin")).toBe(true);
    expect(saysAbsent("dim coop interior with hens roosted and no feeder present", "feeder")).toBe(true);
    expect(
      saysAbsent(
        "Dim interior of the small wooden coop at dusk. Brown and white hens settled on roosting bars for the night. No feeder present. Bare wooden walls and floor visible.",
        "feeder"
      )
    ).toBe(true);
    // Job 355 scene 29, the feeder taken in for the night.
    expect(
      saysAbsent(
        "A wooden henhouse with wire run at dusk, blue evening light fading. The round galvanized metal feeder is gone from its blocks on the ground. The coop sits empty and still.",
        "chicken feeder"
      )
    ).toBe(true);
    // Job 383 scene 20, typed by the operator.
    expect(
      saysAbsent(
        "one round white smoke alarm lying face up on a wooden kitchen counter in plain daylight, no box, no packaging, no hands",
        "smoke detector box"
      )
    ).toBe(true);
  });

  it("reads every way of saying a thing is not there, before or after its name", () => {
    const absent: [string, string][] = [
      ["a quiet porch at dusk, not a single robin on the rail", "robin"],
      ["a mason jar on the shelf without its lid", "lid"],
      ["the kitchen counter, there isn't a cup anywhere", "cup"],
      ["none of the jars on the windowsill", "jar"],
      ["the hallway at night, no sign of the cat", "cat"],
      ["a pantry shelf empty of jars", "jar"],
      ["a crow on the fence instead of a robin", "robin"],
      ["a crow on the fence rather than a robin", "robin"],
      ["the lawn in November with the robins gone", "robin"],
      ["the workbench, the lid nowhere in sight", "lid"],
      ["the stove top with the kettle not visible", "kettle"],
      ["the counter with the cup out of frame", "cup"],
      ["the empty branch, the bird no longer there", "bird"],
      ["a dog bed by the stove, no puppies in it", "puppy"],
    ];
    for (const [text, name] of absent) expect(saysAbsent(text, name), `${name}: ${text}`).toBe(true);
  });

  it("never reads a thing that IS there as absent", () => {
    const there: [string, string][] = [
      // Once said plainly, it is in the picture whatever else the words rule out.
      ["a robin on the fence post, no other robins around", "robin"],
      ["not only robins but a cardinal at the feeder", "robin"],
      ["no more than three robins on the lawn", "robin"],
      // "Empty" describes the thing it is said of.
      ["an empty bird feeder hanging from a bare branch", "feeder"],
      // Some are left (job 260 scene 24, job 360 scene 22).
      [
        "Outdoor craft fair market table draped in dark cloth, nearly empty of charred cedar incense holders after selling out — a few finished black blocks remain scattered across the surface, the rest of the table bare.",
        "charred cedar incense holder",
      ],
      [
        "Close view of the pale galvanized lip of a round feeder at the height of a brown hen's back, the hen's red-combed head dipped in to eat, almost no crumbs scattered on the dirt below.",
        "Scattered feed crumbs",
      ],
      // "Clear of" is not "without" (job 387 scene 22: the chain rests over the sweater).
      [
        "Bare weathered hands positioned at the chest, fingers already settling a thin gold chain so it rests over and clear of a cream turtleneck sweater with high folded collar, the chain visible against the neck.",
        "turtleneck sweater",
      ],
      ["a robin missing its tail feathers on the lawn", "robin"],
      ["the robin gone quiet on its branch", "robin"],
      ["a robin nowhere near the feeder", "robin"],
      // The negation is about something else, never across a preposition or a comma.
      ["a lawn with no snow on the porch light", "porch light"],
      ["a board that is not sanded, the cup beside it", "cup"],
      ["a cozy no-sew fleece blanket on the couch", "blanket"],
      // A name the words never say is not "absent" either.
      ["an empty backyard lawn at dawn", "robin"],
    ];
    for (const [text, name] of there) expect(saysAbsent(text, name), `${name}: ${text}`).toBe(false);
  });
});

describe("a thing the words say is not there is never filed under it (job 416 scene 2)", () => {
  it("keyThingsIn and plannedKeyThing leave it out; a thing said plainly is kept", () => {
    expect(keyThingsIn(EMPTY_LAWN_SUBJECT, K416).map(t => t.name)).toEqual(["backyard lawn"]);
    expect(keyThingsIn(EMPTY_LAWN_PROMPT, K416).map(t => t.name)).toEqual(["backyard lawn"]);
    expect(plannedKeyThing("robin", EMPTY_LAWN_SUBJECT, K416)).toBeNull();
    // Scene 5: the robin on the lawn is both.
    expect(
      keyThingsIn("an American robin on a thawing, snow-patched backyard lawn in early March", K416)
        .map(t => t.name)
        .sort()
    ).toEqual(["backyard lawn", "robin"]);
    expect(plannedKeyThing("robin", "an American robin on a thawing, snow-patched backyard lawn", K416)?.name).toBe("robin");
  });

  it("a thing said only as not there is no other one of its kind either", () => {
    const cat: KeyThing[] = [{ name: "cat", look: "a grey-and-white domestic shorthair cat", main: true }];
    expect(othersOfKindIn("the bedroom at dawn, no other cats in the room", cat)).toEqual([]);
    // …while one said as another is still told apart.
    expect(othersOfKindIn("a stray cat on the fence", cat)).toEqual([{ name: "cat", said: "a stray cat" }]);
  });

  it("tagKeyThings takes the robin off the empty lawn, and a planner's filing under it is given up", () => {
    const board = job416();
    tagKeyThings(board, K416);
    expect(at(board, 2).keyThing).toBe("backyard lawn");
    expect(at(board, 2).otherKeyThings).toBeUndefined();
    expect(requiredThingsFor(at(board, 2))).toEqual(["backyard lawn"]);
    expect(at(board, 5).keyThing).toBe("robin");
    expect(at(board, 5).otherKeyThings).toEqual(["backyard lawn"]);

    // Filed under the robin by a planner: filed anew under what it shows.
    const filed = job416();
    Object.assign(at(filed, 2), { keyThing: "robin", otherKeyThings: undefined, buildStage: "done" });
    expect(ownKeyThing(at(filed, 2))).toBeUndefined();
    tagKeyThings(filed, K416);
    expect(at(filed, 2).keyThing).toBe("backyard lawn");
    expect(at(filed, 2).buildStage).toBeUndefined();
  });

  it("a later picture filed under the robin whose words rule it out is neither drawn from the robin nor given its camera", () => {
    // Scene 17's line in the same film, "why does the yard feel so empty come November?", as such a
    // filing would leave it — on a board as stored, before any pass files it again.
    const board = job416();
    board.push({
      index: 17,
      narration: "n",
      scriptText: "If so many of them stay, then why does the yard feel so empty come November?",
      showSubject: "an empty backyard lawn in late autumn, bare branches, no robins visible",
      keyThing: "robin",
    } as StoryboardScene);
    const late = at(board, 17);
    expect(ownKeyThing(late)).toBeUndefined();
    expect(sources(board, 17)).toEqual([]);
    expect(memoryViewFor(board, late)).toBeUndefined();
    expect(requiredThingsFor(late)).toEqual([]);
    // Said plainly, the same filing is drawn from the robin's pictures as before.
    late.showSubject = "an American robin on the bare backyard lawn in late autumn";
    expect(sources(board, 17)).toEqual([5, 7]);
    expect(memoryViewFor(board, late)).toBeDefined();
  });
});

describe("the memory is never a picture that does not show its thing (job 416 scenes 2, 5, 13, 16)", () => {
  it("as rendered, scene 5 was drawn from the empty lawn; now it is the robin's first picture", () => {
    // The filing the board was rendered with (no re-tagging): the guard holds on it as it stands.
    const board = job416();
    expect(sources(board, 5)).toEqual([]);
    expect(memoryViewFor(board, at(board, 5))).toBeUndefined();
    // The split panel before it (scene 4) has no robin picture to follow either.
    expect(sources(board, 4)).toEqual([]);
    // The robin's later pictures are drawn from scene 5 — a picture OF the robin.
    expect(sources(board, 7)).toEqual([5]);
    expect(memoryViewFor(board, at(board, 7))).toBeDefined();
    // The empty lawn is held to the lawn alone by the check.
    expect(requiredThingsFor(at(board, 2))).toEqual(["backyard lawn"]);
  });

  it("with no picture that shows the robin it is drawn from the robin's written look", async () => {
    const board = job416();
    attachMemory(board, [], K416);
    const five = await memoryFor(at(board, 5), 0);
    expect(five.urls).toEqual([]);
    expect(five.own).toBe(false);
    expect(five.look).toContain("brick-orange breast");
    expect(memoryView(at(board, 5))).toBeUndefined();
    const seven = await memoryFor(at(board, 7), 0);
    expect(seven.urls).toEqual([url(416, 5)]);
    expect(seven.own).toBe(true);
  });

  it("a picture that shows the thing beside its subject is still its memory when none is about it", () => {
    // The heater beside the mattress (Frederick's job 259): a thing said plainly beside the subject
    // is in the picture, so it lends — only a thing said as NOT there never does.
    const board = job416();
    Object.assign(at(board, 2), {
      showSubject: "a quiet backyard lawn at morning, one robin at the far edge by the fence",
      visualPrompt: "A quiet backyard lawn in morning light, one robin at the far edge by the fence, patches of snow.",
    });
    expect(sources(board, 5)).toEqual([2]);
  });

  it("job 368 scene 23: the coop with no feeder present is neither drawn from the feeder nor held to it", () => {
    const show = "dim coop interior with hens roosted and no feeder present";
    const board = [
      {
        index: 2,
        showSubject: "hens gathering to eat at the gravity feeder with pellets scattered on the dirt below",
        keyThing: "feeder",
        otherKeyThings: ["scattered pellets", "hens"],
        pictureUrl: url(368, 2),
      },
      {
        index: 11,
        showSubject: "hens pecking at greens and kitchen scraps on the grass of a backyard garden",
        keyThing: "hens",
        pictureUrl: url(368, 11),
      },
      {
        index: 22,
        showSubject: "the round metal gravity feeder being carried up the ramp into the small wooden coop at dusk",
        keyThing: "feeder",
        otherKeyThings: ["coop"],
        pictureUrl: url(368, 22),
      },
      {
        index: 23,
        showSubject: show,
        keyThing: "dusk coop interior",
        otherKeyThings: ["feeder", "coop", "hens"],
      },
    ].map(s => ({ narration: "n", visualPrompt: s.showSubject, ...s }) as StoryboardScene);
    // Before: [2, 22, 11] — the feeder's first picture led.
    expect(sources(board, 23)).toEqual([22, 11]);
    expect(requiredThingsFor(at(board, 23))).toEqual(["dusk coop interior", "coop", "hens"]);
  });
});

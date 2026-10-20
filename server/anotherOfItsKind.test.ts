/**
 * ANOTHER OF THE SAME KIND IS NOT THE KEY THING (round 14, the verification film 412 on the round-12
 * code). "Her wild relatives do their serious hunting in the low light at the edges of the day" was drawn
 * as "a wild cat stalking low through scattered brush across the dawn-lit wild landscape toward a small
 * mouse" (scenes 23, 25 and 26) and came back as the video's own house cat in the desert — the same
 * grey-and-white coat, white bib, white socks and green eyes as the pet on the bed. `keyThingsIn` counted
 * the MAIN key thing "cat" as named by the word in "a wild cat", `tagKeyThings` filed it beside the
 * picture's "wild landscape", and the pet's first picture was handed over as "this exact cat". A word that
 * makes it a different one — someone else's (of anything), or wild, stray, feral, another, other,
 * different, a second, every, most, all, many, plenty of (of an animal) — now keeps it from the key thing:
 * never filed under it, never given its pictures or its look, and the prompt says it is not the one shown
 * before. The rows are the stored ones (job 412's props list and pictures; the things' words from jobs
 * 261, 263, 298, 302, 357, 371, 399 and 402); the rule names no channel's things.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  animalName,
  anotherOfItsKind,
  applyPictureFixes,
  keyThingsIn,
  othersOfKindIn,
  plannedKeyThing,
} from "./shotList";
import {
  anotherOfItsKindClause,
  attachMemory,
  homePlaceOf,
  memoryFor,
  memorySourcesFor,
  memoryView,
  placeLooksFor,
  tagKeyThings,
} from "./pictureMemory";
import { buildStillPrompt, memoryFields } from "./longformVideo";

// Job 412's props list, as stored.
const CAT_LOOK = "a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail held low, pale green eyes";
const THINGS_412: KeyThing[] = [
  { name: "cat", look: CAT_LOOK, main: true },
  { name: "bed", look: "a low wooden-framed bed with white rumpled sheets and a dark grey blanket pushed to one side, positioned centrally in the bedroom" },
  { name: "phone", look: "a slim black smartphone with a glass screen and rear camera lens, usually held or resting on the nightstand" },
  { name: "cat paws", look: "belonging to the same grey-and-white domestic shorthair cat, small white-tipped paws with pink pads, moving silently across fabric" },
  { name: "wild landscape", look: "an open dawn-lit wilderness with low golden light, scattered brush and distant hills, calm and empty of people" },
  { name: "nightstand", look: "a small wooden bedside table beside the bed, bare wooden surface, one shallow drawer, dark honey-brown finish" },
];
const HOME_412 =
  "bedroom: a quiet bedroom at pre-dawn hours, soft dim blue-grey light, an unmade bed as the central feature, calm and tidy surroundings";

// Scenes 23 / 25 / 26 (indexes 22, 24, 25) as stored.
const WILD = "a wild cat stalking low through scattered brush across the dawn-lit wild landscape toward a small mouse";
const WILD_PROMPT =
  "Wild cat crouched low and moving through scattered dry brush across an open dawn-lit wilderness, golden low light on distant hills, a small mouse ahead on the ground.";
const CLOSE = `${WILD}, a close-up of one detail of it filling the frame`;

const names = (text: string, things: KeyThing[] = THINGS_412) => keyThingsIn(text, things).map(t => t.name);
const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

/** Job 412's board around the passage, as stored (filings included). */
const board412 = () => [
  pic(2, "cat walking across sleeping owner's legs in bed", {
    visualPrompt:
      "A grey-and-white domestic shorthair cat walks slowly across the length of a bed with white rumpled sheets and dark grey blanket, moving over the legs and lower body in a quiet bedroom at pre-dawn.",
    keyThing: "cat",
    otherKeyThings: ["bed"],
    pictureUrl: "https://r2/412/still-src-2.png",
  }),
  pic(21, "the grey-and-white cat resting calmly at the foot of the bed in the dim bedroom at night", {
    visualPrompt:
      "Grey-and-white domestic shorthair cat sitting at the foot of the bed on the dark grey blanket in the dim bedroom at night, ears alert, the room in soft pre-dawn light.",
    keyThing: "cat",
    otherKeyThings: ["bed"],
  }),
  pic(22, WILD, { visualPrompt: WILD_PROMPT, keyThing: "wild landscape", otherKeyThings: ["cat"], pictureUrl: "https://r2/412/still-src-22.png" }),
  pic(24, CLOSE, { visualPrompt: `${WILD_PROMPT.replace(/\.$/, "")}, a close-up of one detail of it filling the frame`, keyThing: "wild landscape", otherKeyThings: ["cat"] }),
  pic(25, CLOSE, { keyThing: "wild landscape", otherKeyThings: ["cat"] }),
  pic(26, "the grey-and-white cat sitting up alert at the foot of the bed in pre-dawn dark while the owner sleeps deeply under the blanket", {
    keyThing: "cat",
    otherKeyThings: ["bed"],
  }),
];

describe("another of the same kind is not the key thing (round 14, job 412 scenes 23-26)", () => {
  it("412: 'a wild cat' does not name the video's cat; the landscape is still named", () => {
    expect(names(WILD)).toEqual(["wild landscape"]);
    expect(names(CLOSE)).toEqual(["wild landscape"]);
    expect(names(WILD_PROMPT)).toEqual([]);
    expect(anotherOfItsKind(WILD, THINGS_412[0])).toBe("a wild cat");
    expect(anotherOfItsKind(WILD_PROMPT, THINGS_412[0])).toBe("wild cat");
    expect(othersOfKindIn(WILD, THINGS_412)).toEqual([{ name: "cat", said: "a wild cat" }]);
  });

  it("the video's own cat is still named: 'the cat', 'my cat', 'her paws', and a wild one beside her", () => {
    expect(names("the grey-and-white cat resting calmly at the foot of the bed in the dim bedroom at night")).toEqual(["cat", "bed"]);
    expect(names("my cat curled on the windowsill")).toEqual(["cat"]);
    // "the most …" is her at her most, not most cats.
    expect(names("the most stubborn cat stretched across the pillow")).toEqual(["cat"]);
    // "her" is the cat's own: no word for another one.
    expect(names("her paws kneading the dark grey blanket beside the cat")).toEqual(["cat paws"]);
    expect(anotherOfItsKind("her paws on the white sheet", { name: "paws", look: "" })).toBeUndefined();
    // Once said plainly, it is the cat, whatever else is in the picture.
    expect(names("the cat watching a stray cat through the bedroom window")).toEqual(["cat"]);
    // An article and a preposition stand between: "wild" is the landscape's.
    expect(names("a wild landscape with a cat crouched in the grass")).toEqual(["wild landscape", "cat"]);
    expect(othersOfKindIn("the cat on the bed", THINGS_412)).toEqual([]);
  });

  it("an animal: wild, stray, feral, another, a second, someone else's, and the kind in general", () => {
    const cat = THINGS_412[0];
    expect(anotherOfItsKind("a stray cat on the porch railing", cat)).toBe("a stray cat");
    expect(anotherOfItsKind("a feral grey cat behind a barn", cat)).toBe("a feral grey cat");
    expect(anotherOfItsKind("another cat asleep on a sofa", cat)).toBe("another cat");
    expect(anotherOfItsKind("a second cat on the windowsill", cat)).toBe("a second cat");
    expect(anotherOfItsKind("a different cat in a shelter cage", cat)).toBe("a different cat");
    expect(anotherOfItsKind("the other cat by the door", cat)).toBe("the other cat");
    expect(anotherOfItsKind("someone else's cat on a fence", cat)).toBe("someone else's cat");
    expect(anotherOfItsKind("plenty of house cats dozing in sunny windows", cat)).toBe("plenty of house cats");
    expect(anotherOfItsKind("most cats asleep at noon", cat)).toBe("most cats");
    expect(anotherOfItsKind("every cat in the shelter", cat)).toBe("every cat");
    expect(anotherOfItsKind("the neighbour's dog at the gate", { name: "dog", look: "" })).toBe("the neighbour's dog");
    // "all the cats" are this video's cats; "all cats" is the kind.
    expect(anotherOfItsKind("all the cats on the bed", cat)).toBeUndefined();
    expect(anotherOfItsKind("all cats", cat)).toBe("all cats");
    // Job 357 scene 7's rewrite: the second dog's body is not the video's dog's body.
    const things357: KeyThing[] = [
      { name: "dog's nose", look: "dark, damp, black leather-textured, low to the ground", main: true },
      { name: "Dog's body", look: "medium build, short tan coat, calm stance, tail relaxed at rest" },
    ];
    expect(
      names(
        "Dog's nose sniffing a bare hand at ankle height, second dog's tan body visible at the edge, hardwood foyer with pale walls and warm late-afternoon light.",
        things357
      )
    ).toEqual(["dog's nose"]);
  });

  it("a THING keeps its name under those words — the stored pictures where they meant the thing itself", () => {
    const thing = (name: string) => ({ name, look: "" });
    expect(names("a new smoke alarm box with its label facing the camera", [thing("smoke alarm box")])).toEqual(["smoke alarm box"]);
    expect(names("several different charred incense holders lined up on the table", [thing("charred incense holder")])).toEqual([
      "charred incense holder",
    ]);
    expect(names("several different fabric bowls displayed together", [thing("fabric bowl")])).toEqual(["fabric bowl"]);
    expect(names("rows of fabric bowls displayed. most bowls gone, only a few left", [thing("fabric bowl")])).toEqual(["fabric bowl"]);
    expect(names("feeder scattered with stray brown feed pellets", [thing("feed pellets")])).toEqual(["feed pellets"]);
    expect(names("asking the attendant for another cookie packet near the cart", [thing("cookie packet")])).toEqual(["cookie packet"]);
    expect(names("a hand reaching for a second pretzel bag from a basket", [thing("pretzel bag")])).toEqual(["pretzel bag"]);
    // …but someone else's is someone else's, of anything.
    expect(names("the neighbour's fence across the yard", [thing("fence")])).toEqual([]);
  });

  it("which key things are animals: the animal or its part, never a thing named after one", () => {
    expect(["cat", "hens", "robin", "dog's nose", "cat paws", "Dog's body", "puppies"].map(animalName)).toEqual([
      true, true, true, true, true, true, true,
    ]);
    expect(["chicken feeder", "chicken coop", "dog bed", "wild landscape", "owner's legs", "bear paw block"].map(animalName)).toEqual([
      false, false, false, false, false, false,
    ]);
  });

  it("a planner's or a check's 'thing' is not taken for a picture of another one", () => {
    expect(plannedKeyThing("cat", "a stray cat on the porch railing", THINGS_412)).toBeNull();
    expect(plannedKeyThing("cat", "the cat on the porch railing", THINGS_412)?.name).toBe("cat");
    expect(plannedKeyThing("MAIN cat", undefined, THINGS_412)?.name).toBe("cat");
    const b = [pic(5, "the cat on the bed", { keyThing: "cat" })];
    applyPictureFixes(b, [{ id: 0, show: WILD, thing: "cat" } as never], THINGS_412);
    expect(b[0].keyThing).toBe("wild landscape");
    expect(b[0].otherKeyThings).toBeUndefined();
  });

  it("412: filed again on every pass, the wild cat loses the cat and gets no picture of her; the pet keeps hers", () => {
    const b = board412();
    attachMemory(b, b, THINGS_412, homePlaceOf(HOME_412));
    const at = (i: number) => b.find(s => s.index === i)!;
    for (const i of [22, 24, 25]) {
      expect(at(i).keyThing).toBe("wild landscape");
      expect(at(i).otherKeyThings).toBeUndefined();
      expect(at(i).othersOfKind).toEqual([{ name: "cat", said: "a wild cat" }]);
      expect(memorySourcesFor(b, at(i))).toEqual([]);
    }
    expect(memorySourcesFor(b, at(21)).map(s => s.index)).toEqual([2]);
    expect(at(21).othersOfKind).toBeUndefined();
    // A planner that filed a stray under the cat gives it up.
    const stray = [b[0], pic(30, "a stray cat on the porch railing", { keyThing: "cat", buildStage: "done" })];
    expect(tagKeyThings(stray, THINGS_412)).toBe(0);
    expect(stray[1].keyThing).toBeUndefined();
    expect(stray[1].buildStage).toBeUndefined();
    expect(memorySourcesFor(stray, stray[1])).toEqual([]);
  });

  it("412 scene 23: the prompt carries no cat look and says this is not the video's cat; the pet's prompt is unchanged", async () => {
    const b = board412();
    attachMemory(b, b, THINGS_412, homePlaceOf(HOME_412));
    const wild = { ...b[2], ...memoryFields(await memoryFor(b[2], 0), memoryView(b[2])) } as StoryboardScene;
    expect(wild.memoryRefUrls).toBeUndefined();
    const prompt = buildStillPrompt(wild);
    expect(prompt).toContain(
      "ANOTHER ONE OF ITS KIND: this picture shows a wild cat — not the cat shown in this video's other pictures, nor a copy of it."
    );
    expect(prompt).not.toContain("soft grey-and-white coat");
    expect(prompt).not.toMatch(/this exact cat/i);
    const pet = { ...b[1], ...memoryFields(await memoryFor(b[1], 0), memoryView(b[1])) } as StoryboardScene;
    expect(pet.memoryRefUrls).toEqual(["https://r2/412/still-src-2.png"]);
    expect(buildStillPrompt(pet)).not.toContain("ANOTHER ONE OF ITS KIND");
    expect(anotherOfItsKindClause(pet)).toBe("");
  });

  it("a stray on the bed is not lent the bed-room's cat: only the video's own things stand in its place", () => {
    const things: KeyThing[] = [
      { name: "cat", look: "a grey-and-white cat curled in the bedroom" },
      THINGS_412[1],
    ];
    const home = homePlaceOf(HOME_412);
    const own = pic(40, "the cat curled on the bed in the bedroom", { keyThing: "bed" });
    const stray = pic(41, "a stray cat curled on the bed in the bedroom", { keyThing: "bed" });
    expect(placeLooksFor(own, things, home).map(p => p.name)).toContain("cat");
    expect(placeLooksFor(stray, things, home).map(p => p.name)).not.toContain("cat");
  });
});

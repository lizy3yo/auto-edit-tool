/**
 * ONE LOOK PER KEY THING, AND A MEMORY WORTH COPYING (2026-10-18). A key thing's first picture is
 * the one every later picture of it is drawn from, so: the memory is the earliest picture ABOUT the
 * thing (not a wide shot with it small); a picture with no picture of its own thing to follow is drawn
 * by the thing's written look — without its place, and without its finish while it is being made;
 * such a picture that later ones copy is held to that look on the check it already gets; and a
 * picture whose last check said its thing is missing is never copied. The cases are real rows from
 * stored films; the rules are general.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  attachMemory,
  copiedLater,
  keyThingLookClause,
  keyThingLookFor,
  lookToHold,
  memoryFor,
  memorySourcesFor,
  pictureLook,
  pictureSettled,
} from "./pictureMemory";
import { buildStillPrompt, markMemoryFit, memoryClause, memoryFields } from "./longformVideo";
import { requiredThingsQuestion } from "./overlayTextScan";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

// Ruth's job 305 props list (two lines of it).
const RUTH: KeyThing[] = [
  {
    name: "scrappy fabric bowl",
    main: true,
    look: "coiled fabric-wrapped cord bowl, roughly six inches across, zigzag stitched rings in mixed scrap colors, smooth rounded shape",
  },
  { name: "straight-stitch machine", look: "small black and chrome sewing machine, compact size, sits centered on work table" },
];
// Hank's job 258 MAIN line.
const HOLDER = "charred cedar incense holder";
const HANK: KeyThing[] = [
  {
    name: HOLDER,
    main: true,
    look:
      "small square cedar block, blackened and brushed surface, single angled hole drilled halfway through, thin coat " +
      "of oil giving a soft sheen, round felt dot centered on the bottom, sits upright on the bench",
  },
];

describe("a key thing's look, cut down for the picture", () => {
  it("Ruth's job 305 #3: the first machine is drawn black and chrome, never with the work table the look puts it on", () => {
    const first = pic(3, "a straight-stitch machine, a rotary cutter and a mountain of scraps too pretty to throw out together at a kitchen table", {
      keyThing: "straight-stitch machine",
      otherKeyThings: ["rotary cutter"],
    });
    const look = keyThingLookFor(first, RUTH);
    expect(look).toBe("small black and chrome sewing machine, compact size");
    const prompt = buildStillPrompt({ ...first, keyThingLook: look });
    expect(prompt).toContain("black and chrome");
    expect(prompt).not.toContain("sits centered on work table");
    expect(prompt).not.toMatch(/work table/);
  });

  it("drops the place from every look, keeps what the thing is (Dale's job 352, Norbert's job 280)", () => {
    const planer = pictureLook("compact tabletop power tool, metal housing, feed rollers, dust port, set on a stand in the garage");
    expect(planer).toContain("metal housing");
    expect(planer).not.toContain("set on a stand in the garage");
    const plate = pictureLook("small steel plate, matchbook-sized, dull silver finish, two screw holes, mounted in painted frame cutout");
    expect(plate).toContain("dull silver finish");
    expect(plate).not.toContain("mounted in painted frame cutout");
    // A part of the thing itself is its look, not its place.
    expect(pictureLook("small round button set into the center of the alarm's face, slightly raised, matching white plastic")).toContain(
      "set into the center of the alarm's face"
    );
    // …and what sits beside it, the light around it, what it is for and writing on it all go.
    expect(pictureLook("coiled white cotton cord, medium thickness, kept in a small basket near the machine")).toBe(
      "coiled white cotton cord, medium thickness"
    );
    expect(pictureLook("tall metal shelving packed tightly with smooth surfaced boards, indoor warehouse lighting")).toBe(
      "tall metal shelving packed tightly with smooth surfaced boards"
    );
    expect(pictureLook("handheld tool with plastic grip handle, metal shaft, used for final hand-tightening of screws")).toBe(
      "handheld tool with plastic grip handle, metal shaft"
    );
    expect(pictureLook("5.5mm aluminum hook marked with letter I, smooth silver finish, rests on the table")).toBe("smooth silver finish");
  });

  it("Hank's job 258: the MAIN thing's finished look never reaches a picture of it being made", () => {
    const drilling = pic(18, "hands drilling an angled hole into a charred cedar scrap", { keyThing: HOLDER, buildStage: "making" });
    const look = keyThingLookFor(drilling, HANK)!;
    expect(look).toBe("small square cedar block");
    expect(look).not.toMatch(/felt dot|oil|drilled|sheen|blackened/);
    // The prompt says colours and materials only, and leaves how far along it is to the words.
    expect(keyThingLookClause({ ...drilling, keyThingLook: look })).toMatch(/COLOURS AND MATERIALS/);
    // Not marked finished: its finish and added parts go too.
    expect(keyThingLookFor(pic(2, "a charred cedar incense holder", { keyThing: HOLDER }), HANK)).toBe("small square cedar block");
    // Marked finished: the whole look, still without where it sits.
    const done = keyThingLookFor(pic(1, "a charred cedar incense holder, finished", { keyThing: HOLDER, buildStage: "done" }), HANK)!;
    expect(done).toContain("round felt dot centered on the bottom");
    expect(done).not.toContain("sits upright on the bench");
  });

  it("Ruth's job 305: a bowl being coiled keeps its fabric and colours, never the finished bowl's size or shape", () => {
    const coiling = pic(12, "hands coiling a fabric-wrapped strip round its cord", { keyThing: "scrappy fabric bowl", buildStage: "making" });
    expect(keyThingLookFor(coiling, RUTH)).toBe("fabric, cord, mixed scrap colors");
    expect(pictureLook("round felt dot centered on the bottom", "colourMaterial")).toBe(""); // a felt DOT is not a felt thing
  });

  it("a named kind's exact look wins, and a list item that only inherited a key thing gets no look", () => {
    const named = pic(4, "a churn dash block", { keyThing: "straight-stitch machine", namedLook: "a 3x3 block…", keyThingLook: "black" });
    expect(keyThingLookClause(named)).toBe("");
    // Dale's job 397: "Coasters," inherited the pile as its key thing — its words do not name it.
    const coasters = pic(3, "coasters", { keyThing: "straight-stitch machine", listCut: true, scriptText: "Coasters," });
    expect(keyThingLookFor(coasters, RUTH)).toBeUndefined();
  });
});

describe("the memory is a picture ABOUT the thing (Dale's job 352)", () => {
  const PLANER = "benchtop planer";
  const wide = pic(8, "garage workshop with table saw and benchtop planer along back wall", { keyThing: PLANER, otherKeyThings: ["table saw"] });
  const feeding = pic(10, "man's hands feeding a rough-sawn board into a benchtop planer in a garage, pale shavings curling out", {
    keyThing: PLANER,
  });
  const running = pic(13, "man's hands running a board face through benchtop planer in garage", { keyThing: PLANER });

  it("draws later planers from the first picture of the planer itself, not the wide workshop shot", () => {
    const board = [wide, feeding, running];
    expect(memorySourcesFor(board, running)[0]).toBe(feeding);
    expect(memorySourcesFor(board, running)).not.toContain(wide);
    // With no picture about it before, the first picture of it is still the memory.
    expect(memorySourcesFor(board, feeding)).toEqual([wide]);
  });

  it("never takes a picture filed under ANOTHER thing as the memory, even when that thing fills it", () => {
    const boardShot = pic(48, "rough-sawn board being measured and fed through benchtop planer, with the host's hands at work on it", {
      keyThing: "rough-sawn board",
      otherKeyThings: [PLANER],
    });
    const later = pic(98, "compact benchtop planer with metal housing and feed rollers on a stand in the garage", { keyThing: PLANER });
    expect(memorySourcesFor([wide, boardShot, later], later)[0]).toBe(wide);
  });
});

describe("a first picture that missed is never copied", () => {
  const BOX = "Keepsake Box";
  // Dale's job 369 #14: the group shot that first shows the box, its last check "writing".
  const group = pic(14, "a walnut engraved board, a maple house sign and a small walnut keepsake box grouped together on a shelf", {
    keyThing: "Engraved Board",
    otherKeyThings: [BOX, "House Sign"],
  });
  const item = pic(17, "a small walnut keepsake box with hinged lid sitting on a shelf", { keyThing: BOX, listCut: true, scriptText: "keepsake boxes." });

  it("keeps a picture whose last check said only 'writing' as the memory", () => {
    markMemoryFit(group, false);
    expect(group.memoryUnfit).toBeUndefined();
    expect(memorySourcesFor([group, item], item)).toEqual([group]);
  });

  it("drops a picture whose last check said its thing is missing", () => {
    const missed = { ...group };
    markMemoryFit(missed, true);
    expect(memorySourcesFor([missed, item], item)).toEqual([]);
    markMemoryFit(missed, false); // drawn again and passed: a memory once more
    expect(memorySourcesFor([missed, item], item)).toEqual([missed]);
  });

  it("skips a memory that settled unfit in the same pass, and gives the picture its look instead", async () => {
    const first = pic(3, "a straight-stitch machine at a kitchen table", { keyThing: "straight-stitch machine" });
    const later = pic(5, "a straight-stitch sewing machine on the wooden work table", { keyThing: "straight-stitch machine" });
    const board = [first, later];
    attachMemory(board, board, RUTH);
    const waiting = memoryFor(later, 5_000);
    first.pictureUrl = "https://r2/first.png";
    markMemoryFit(first, true);
    pictureSettled(first);
    expect(await waiting).toEqual({ urls: [], own: false, look: "small black and chrome sewing machine, compact size" });
  });
});

describe("the look goes only where nothing of the thing is there to follow", () => {
  it("Ruth's job 305: the first machine is drawn by its look and held to it; the copy follows its memory", async () => {
    const first = pic(3, "a straight-stitch machine, a rotary cutter and a mountain of scraps together at a kitchen table", {
      keyThing: "straight-stitch machine",
    });
    const item = pic(4, "a straight-stitch sewing machine", { keyThing: "straight-stitch machine", listCut: true, scriptText: "a straight-stitch machine," });
    const board = [first, item];
    attachMemory(board, board, RUTH);
    expect(copiedLater(first)).toBe(true);
    expect(copiedLater(item)).toBe(false);

    const m1 = await memoryFor(first);
    Object.assign(first, memoryFields(m1, undefined));
    expect(first.keyThingLook).toBe("small black and chrome sewing machine, compact size");
    expect(lookToHold(first)).toEqual({ thing: "straight-stitch machine", look: "small black and chrome sewing machine, compact size" });

    first.pictureUrl = "https://r2/machine.png";
    pictureSettled(first);
    const m2 = await memoryFor(item);
    Object.assign(item, memoryFields(m2, undefined));
    expect(item.memoryRefUrls).toEqual(["https://r2/machine.png"]);
    expect(item.keyThingLook).toBeUndefined(); // the reference carries the look, no text beside it
    expect(lookToHold(item)).toBeUndefined();
  });

  it("a picture lent only for a thing beside it is not held to its own look (the heater beside the mattress)", () => {
    const mattress = pic(1, "a plain white mattress on a low bed frame, a small space heater beside it", {
      keyThing: "mattress",
      otherKeyThings: ["space heater"],
    });
    const heater = pic(2, "a small beige space heater", { keyThing: "space heater" });
    attachMemory([mattress, heater], [mattress, heater], [
      { name: "mattress", look: "plain white mattress with quilted top" },
      { name: "space heater", look: "small boxy beige metal heater" },
    ]);
    expect(memorySourcesFor([mattress, heater], heater)).toEqual([mattress]);
    expect(copiedLater(mattress)).toBe(false);
  });

  it("references of only the other things are named as such, and the look still goes in", () => {
    const fields = memoryFields({ urls: ["https://r2/heater.png"], own: false, look: "plain white mattress with quilted top" }, undefined);
    expect(fields).toMatchObject({ memoryOthersOnly: true, keyThingLook: "plain white mattress with quilted top" });
    const scene = pic(5, "a mattress with a heater beside it", { keyThing: "mattress", otherKeyThings: ["space heater"], ...fields });
    const clause = memoryClause(scene);
    expect(clause).toContain("this exact space heater");
    expect(clause).toContain("NOT show the mattress");
    expect(clause).not.toContain("this exact mattress");
    // With a picture of its own thing among them, nothing changes.
    expect(memoryFields({ urls: ["https://r2/m.png"], own: true, look: "x" }, undefined)).toMatchObject({
      memoryOthersOnly: undefined,
      keyThingLook: undefined,
    });
  });

  it("the check holds a copied first picture to the look, and never to where it is", () => {
    const q = requiredThingsQuestion(["straight-stitch machine"], {
      thing: "straight-stitch machine",
      look: "small black and chrome sewing machine, compact size",
    });
    expect(q).toContain("small black and chrome sewing machine, compact size");
    expect(q).toMatch(/another colour, material, size or shape/);
    expect(q).toMatch(/never answer true for those/);
    expect(requiredThingsQuestion(["straight-stitch machine"])).not.toContain("drawn from this one");
  });
});

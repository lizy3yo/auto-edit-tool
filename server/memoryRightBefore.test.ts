/**
 * THE PICTURE RIGHT BEFORE IS A MEMORY, NEVER A TEMPLATE (2026-10-18, job 399 scenes 16-17). Scene 17
 * ("a small plastic cup barely filled with ginger ale on a tray table") was drawn from scene 16
 * ("hands pouring soda into an ice-filled plastic cup at the cart") and came back as scene 16 on a new
 * background: the same hands, the same can at the same angle, the same cup. A picture drawn from the
 * picture shown right before it, about something else, now takes only the thing's look from it; the
 * same-thing check compares it with that picture and calls a new background alone a copy; and a copy
 * that survives its redraw is drawn from words with the thing's written look. The cases are job 399's
 * rows; the rules are general.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  attachMemory,
  continuedPicture,
  keyThingLookClause,
  keyThingLookFor,
  memoryFor,
  memorySourcesFor,
  MEMORY_VIEWS,
  pictureSettled,
  rightBeforeToRecompose,
  SCREEN_ITEM_VIEW,
  SET_ITEM_VIEW,
  sameThingMove,
} from "./pictureMemory";
import {
  buildStillPrompt,
  memoryClause,
  memoryFields,
  memoryToWords,
  promptFromWords,
  rightBeforeClause,
  sameThingReference,
} from "./longformVideo";
import { SAME_THING_SYSTEM } from "./overlayTextScan";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

// Job 399's props list, the lines these scenes use.
const KT: KeyThing[] = [
  {
    name: "beverage cart",
    main: true,
    look: "metal trolley with two tiers, rows of soda cans and small liquor bottles lined on top, stocked with ice-filled plastic cups",
  },
  { name: "plastic cup", look: "clear hard plastic, filled with ice cubes, half-filled with soda, no markings" },
  { name: "soda can", look: "aluminum can, plain silver body, condensation beads, sits upright on cart tray" },
  { name: "small liquor bottle", look: "miniature glass bottle, clear glass, metal cap, short and stout shape" },
];

// Job 399 scenes 15-18 as stored.
const job399 = () => [
  pic(15, "close-up of a full plain silver soda can with condensation beads standing upright on the top tray of a metal beverage cart", {
    hostPresent: true,
    splitVisual: "A full unopened soda can sitting upright on the top tray of a metal beverage cart in an aircraft cabin during service.",
    keyThing: "beverage cart",
    otherKeyThings: ["soda can"],
  }),
  pic(16, "hands pouring soda into an ice-filled plastic cup at the cart", { keyThing: "plastic cup", humanPresent: true }),
  pic(17, "a small plastic cup barely filled with ginger ale on a tray table", { keyThing: "plastic cup", humanPresent: true }),
  pic(18, "a small juice carton on the beverage cart tray beside an ice-filled plastic cup", {
    keyThing: "beverage cart",
    otherKeyThings: ["plastic cup"],
  }),
];

describe("which memory picture is the one shown right before (rightBeforeToRecompose)", () => {
  it("399-17: the cup on the tray table is drawn from the pouring picture right before it", () => {
    const board = job399();
    expect(rightBeforeToRecompose(board, board[2])).toBe(board[1]);
    // The pouring picture is the cup's first: no memory, nothing to recompose from.
    expect(rightBeforeToRecompose(board, board[1])).toBeUndefined();
    // 18 is drawn from 16 for the cup beside the cart, and 16 is not the picture right before it.
    expect(memorySourcesFor(board, board[3])).toEqual([board[1]]);
    expect(rightBeforeToRecompose(board, board[3])).toBeUndefined();
  });

  it("399-20/21: a picture that continues the one before (the same words, or with its own view) is the continuation rule's, not this one's", () => {
    const BAG = "several closed small liquor bottles tucked inside an open carry-on bag on a seat";
    const same = [pic(20, BAG, { keyThing: "small liquor bottle" }), pic(21, BAG, { keyThing: "small liquor bottle" })];
    expect(memorySourcesFor(same, same[1])).toEqual([same[0]]);
    expect(rightBeforeToRecompose(same, same[1])).toBeUndefined();
    const viewed = [same[0], pic(21, `${BAG}, a close-up`, { keyThing: "small liquor bottle" })];
    expect(rightBeforeToRecompose(viewed, viewed[1])).toBeUndefined();
    const marked = [same[0], pic(21, "the carry-on bag on the seat", { keyThing: "small liquor bottle", sameShot: true })];
    expect(rightBeforeToRecompose(marked, marked[1])).toBeUndefined();
    // Each of them is drawn from scene 20 as the picture it continues (continuationViews.test.ts).
    for (const b of [same, viewed, marked]) expect(continuedPicture(b, b[1])).toBe(b[0]);
  });

  it("a memory from further back keeps its ordinary clause (job 399 scene 22, drawn from scene 5)", () => {
    const board = [
      pic(5, "a second pretzel bag held in a passenger's hand", { keyThing: "pretzel basket" }),
      pic(21, "several closed small liquor bottles tucked inside an open carry-on bag on a seat", { keyThing: "small liquor bottle" }),
      pic(22, "the pretzel basket sitting on the beverage cart in the cabin aisle", { keyThing: "pretzel basket" }),
    ];
    expect(memorySourcesFor(board, board[2])).toEqual([board[0]]);
    expect(rightBeforeToRecompose(board, board[2])).toBeUndefined();
  });

  it("a list item cut from its group picture and a screen keep their own framing", () => {
    const set = pic(1, "a straight-stitch machine, a rotary cutter and a pile of scraps together on a kitchen table", {
      keyThing: "straight-stitch machine",
      listSet: true,
    });
    const item = pic(2, "a straight-stitch machine", { keyThing: "straight-stitch machine", listCut: true, scriptText: "a straight-stitch machine," });
    expect(memorySourcesFor([set, item], item)).toEqual([set]);
    expect(rightBeforeToRecompose([set, item], item)).toBeUndefined();
    const board = pic(1, "a walnut cutting board on a market table", { keyThing: "cutting board" });
    const screen = pic(2, "a phone screen showing the cutting board listing", { keyThing: "cutting board" });
    expect(memorySourcesFor([board, screen], screen)).toEqual([board]);
    expect(rightBeforeToRecompose([board, screen], screen)).toBeUndefined();
  });

  it("397-28/29: the same board described anew right after its close-up is a new photo too, never told it is about something else", () => {
    const board = [
      pic(28, "", {
        showSubject: undefined,
        visualPrompt:
          "Close-up of a striped cutting board—alternating dark walnut and pale maple—resting on the workshop bench, soft natural light catching the grain, with a few hand tools blurred at the edge.",
        keyThing: "walnut and maple cutting board",
      }),
      pic(29, "the walnut and maple cutting board leaning against the garage wall", { keyThing: "walnut and maple cutting board" }),
    ];
    expect(rightBeforeToRecompose(board, board[1])).toBe(board[0]);
    const clause = memoryClause({
      ...board[1],
      memoryRefUrls: ["https://r2/first.png", "https://r2/still-src-28.png"],
      memoryView: MEMORY_VIEWS[0],
      memoryRightBefore: 1,
    });
    expect(clause).toMatch(/Reference image 2 is the picture shown RIGHT BEFORE this one in the video: take ONLY how the walnut and maple cutting board looks/);
    expect(clause).not.toMatch(/something else/);
    // On the garage wall, where its words put it — not on the bench where the close-up had it.
    expect(clause).toContain("in the same place unless this picture's own words put it somewhere else");
  });

  it("a split's panel right after its memory picture, about something else, recomposes too", () => {
    const roll = pic(20, "a pale tan papyrus scroll rolled and tied with a thin brown cord", { keyThing: "scroll" });
    const split = pic(21, "the host speaking", {
      hostPresent: true,
      splitVisual: "An aged papyrus scroll laid flat and open on a wooden desk by a window",
      keyThing: "scroll",
    });
    expect(rightBeforeToRecompose([roll, split], split)).toBe(roll);
  });
});

describe("the memory says the picture right before lends only the look", () => {
  it("399-17 at render: its memory is 16, at position 0, with the cup's written look kept for words", async () => {
    const board = job399();
    attachMemory(board, board, KT);
    board[1].pictureUrl = "https://r2/still-src-16.png";
    pictureSettled(board[1]);
    const m = await memoryFor(board[2], 0);
    expect(m).toMatchObject({ urls: ["https://r2/still-src-16.png"], own: true, before: 0 });
    expect(m.look).toBeUndefined();
    expect(m.wordsLook).toBe(keyThingLookFor(board[2], KT, false));
    expect(m.wordsLook).toContain("clear hard plastic");
    const fields = memoryFields(m, MEMORY_VIEWS[0]);
    expect(fields).toMatchObject({ memoryRightBefore: 0, memoryWordsLook: m.wordsLook, keyThingLook: undefined });
    // 18 is the juice carton ON the cart (round 13, job 410 scene 20 the same line): the cart is only
    // its surface, so 18 is filed under no key thing and drawn from its words — no references at all,
    // never the cart's memory with the carton pushed to the back with it (`onlyItsSurface`).
    const m18 = await memoryFor(board[3], 0);
    expect(board[3].keyThing).toBeUndefined();
    expect(board[3].otherKeyThings).toEqual(expect.arrayContaining(["beverage cart", "plastic cup"]));
    expect(m18).toMatchObject({ urls: [], own: false });
    // A picture ABOUT the cart, with the cup beside it: references of another thing, and not the
    // picture before.
    const cart = job399();
    cart[3].showSubject = cart[3].visualPrompt = "the beverage cart's top tray holding a small juice carton, beside an ice-filled plastic cup";
    attachMemory(cart, cart, KT);
    cart[1].pictureUrl = "https://r2/still-src-16.png";
    pictureSettled(cart[1]);
    expect(cart[3].keyThing).toBe("beverage cart");
    const mCart = await memoryFor(cart[3], 0);
    expect(mCart).toMatchObject({ urls: ["https://r2/still-src-16.png"], own: false });
    expect(mCart.before).toBeUndefined();
    expect(memoryFields(mCart, undefined)).toMatchObject({ memoryRightBefore: undefined, memoryWordsLook: undefined });
  });

  const s17 = () =>
    pic(17, "a small plastic cup barely filled with ginger ale on a tray table", {
      keyThing: "plastic cup",
      humanPresent: true,
      brollHostLook: "a woman in her late fifties, shoulder-length grey-blonde hair, navy uniform",
      brollHostRef: "https://r2/host.jpg",
      memoryRefUrls: ["https://r2/still-src-16.png"],
      memoryView: MEMORY_VIEWS[0],
      memoryRightBefore: 0,
    });

  it("399-17: a clearly different photo — another camera and framing, never the same pose or hands — the cup where its words put it", () => {
    const clause = memoryClause(s17());
    expect(clause).toMatch(/The first reference image is the picture shown RIGHT BEFORE this one in the video/);
    expect(clause).toMatch(/take ONLY how the plastic cup looks from it, never the picture itself/);
    expect(clause).toMatch(/never the same pose, the same hand positions or the same things at the same angles/);
    expect(clause).toMatch(/what THIS picture's own words are about fills the frame/);
    expect(clause).toContain("in the same place unless this picture's own words put it somewhere else");
    expect(clause).toMatch(/The last reference image is the host/);
    // Other hand POSITIONS, never other hands: beside the host photo that would ask for someone else's.
    expect(clause).not.toMatch(/same hands/);
    expect(buildStillPrompt(s17())).toContain(clause);
  });

  it("a memory picture that is not right after its memory is told nothing of the picture before, and goes where its words put it too", () => {
    const far = { ...s17(), memoryRightBefore: undefined };
    const clause = memoryClause(far);
    expect(clause).not.toMatch(/RIGHT BEFORE/);
    // Job 404 scene 14 followed a split, not its memory, and "in the same place" kept the snowy lawn
    // under "a mild gulf coast yard": the words decide the place for every memory picture.
    expect(clause).toContain(
      "identical shape, size, colours, materials and wear, in the same place unless this picture's own words put it somewhere else — from a different camera position"
    );
    expect(rightBeforeClause(far)).toBe("");
    // While the thing is being made, too.
    const making = { ...far, buildStage: "making" as const };
    for (const s of [making, { ...making, memoryRightBefore: 0 }])
      expect(memoryClause(s)).toContain(
        "the same colours, materials and wear, in the same place unless this picture's own words put it somewhere else — "
      );
  });

  it("names the reference by its place among several, and the other things when only they are remembered", () => {
    const two = { ...s17(), memoryRefUrls: ["https://r2/first.png", "https://r2/prev.png"], memoryRightBefore: 1 };
    expect(rightBeforeClause(two)).toMatch(/^ Reference image 2 is the picture shown RIGHT BEFORE/);
    const others = {
      ...s17(),
      keyThing: "beverage cart",
      otherKeyThings: ["plastic cup", "soda can"],
      memoryOthersOnly: true as const,
    };
    expect(rightBeforeClause(others)).toMatch(/take ONLY how the plastic cup and soda can look from it/);
  });

  it("says nothing for a screen, a list item from its group, or a position that is not a reference", () => {
    expect(rightBeforeClause({ ...s17(), memoryView: SCREEN_ITEM_VIEW })).toBe("");
    expect(rightBeforeClause({ ...s17(), memoryView: SET_ITEM_VIEW })).toBe("");
    expect(rightBeforeClause({ ...s17(), memoryRightBefore: 1 })).toBe("");
    expect(rightBeforeClause({ ...s17(), memoryRefUrls: undefined })).toBe("");
    expect(memoryClause({ ...s17(), memoryRefUrls: undefined })).toBe("");
  });
});

describe("what the same-thing check's answer does (sameThingMove)", () => {
  const same = { same: true, copy: false };
  const copy = { same: true, copy: true };
  const different = { same: false, copy: false };

  it("the first answer: a copy or a different thing is drawn again from memory", () => {
    expect(sameThingMove(copy, undefined)).toBe("redraw");
    expect(sameThingMove(different, undefined)).toBe("redraw");
    expect(sameThingMove(same, undefined)).toBe("pass");
  });

  it("399-17: a copy again after its redraw is drawn from words; a new view is kept", () => {
    expect(sameThingMove(copy, "copy")).toBe("words");
    expect(sameThingMove(same, "copy")).toBe("pass");
    expect(sameThingMove(different, "copy")).toBe("flag");
  });

  it("sameness beats the angle: after a different thing the redraw is kept whatever it is (job 259)", () => {
    expect(sameThingMove(copy, "different")).toBe("pass");
    expect(sameThingMove(different, "different")).toBe("pass");
  });

  it("a close-up of one part is held only to not copying", () => {
    expect(sameThingMove(different, undefined, true)).toBe("pass");
    expect(sameThingMove(copy, undefined, true)).toBe("redraw");
    expect(sameThingMove(copy, "copy", true)).toBe("words");
    expect(sameThingMove(different, "copy", true)).toBe("pass");
  });
});

describe("a copy drawn from words, and the picture it is compared with", () => {
  const CUP_LOOK = "clear hard plastic, filled with ice cubes, half-filled with soda, no markings";
  const s17 = () =>
    pic(17, "a small plastic cup barely filled with ginger ale on a tray table", {
      keyThing: "plastic cup",
      memoryRefUrls: ["https://r2/still-src-16.png"],
      memoryView: MEMORY_VIEWS[0],
      memoryRightBefore: 0,
      memoryWordsLook: CUP_LOOK,
    });

  it("399-17: no references, no memory camera, and the cup's written look in their place", () => {
    const words = { ...s17(), ...memoryToWords(s17()) };
    expect(words).toMatchObject({ memoryRefUrls: undefined, memoryView: undefined, memoryRightBefore: undefined, keyThingLook: CUP_LOOK });
    expect(keyThingLookClause(words)).toContain(`HOW THE PLASTIC CUP LOOKS in every picture of this video: ${CUP_LOOK}`);
    expect(memoryClause(words)).toBe("");
    // A first picture of its thing beside another one keeps the look it already had.
    expect(memoryToWords({ ...s17(), memoryWordsLook: undefined, keyThingLook: "a look" }).keyThingLook).toBe("a look");
    expect(memoryToWords({ ...s17(), memoryWordsLook: undefined }).keyThingLook).toBeUndefined();
  });

  it("the memory clause is swapped for the look in the prompt as written, every other clause kept", () => {
    const scene = s17();
    const memory = memoryClause(scene);
    const look = keyThingLookClause({ ...scene, ...memoryToWords(scene) });
    const prompt = `${buildStillPrompt(scene)} SOFT PRINT ADDED BY A REDRAW.`;
    const next = promptFromWords(prompt, memory, look)!;
    expect(next).toContain(look);
    expect(next).not.toContain(memory);
    expect(next).not.toMatch(/RIGHT BEFORE|reference image/);
    expect(next.endsWith(" SOFT PRINT ADDED BY A REDRAW.")).toBe(true);
    // A look with "$&" in it goes in as written.
    expect(promptFromWords("a [M] b", "[M]", " $& ")).toBe("a  $&  b");
    // Not in the prompt as written (a blurred-print rewrite reworded it): the caller builds it again.
    expect(promptFromWords("a prompt with no memory", memory, look)).toBeUndefined();
    expect(promptFromWords("anything", "", look)).toBeUndefined();
  });

  it("the check lays the new picture beside the one shown right before it, else beside its memory", () => {
    expect(sameThingReference(s17())).toBe("https://r2/still-src-16.png");
    const two = { ...s17(), memoryRefUrls: ["https://r2/first.png", "https://r2/prev.png"], memoryRightBefore: 1 };
    expect(sameThingReference(two)).toBe("https://r2/prev.png");
    expect(sameThingReference({ ...two, memoryRightBefore: undefined })).toBe("https://r2/first.png");
    expect(sameThingReference({ ...two, memoryRightBefore: 5 })).toBe("https://r2/first.png");
    expect(sameThingReference({ ...two, memoryRefUrls: undefined })).toBeUndefined();
  });

  it("the same-thing check calls a new background with the same pose and hands a copy", () => {
    expect(SAME_THING_SYSTEM).toMatch(/A new background or setting alone does NOT make a new view/);
    expect(SAME_THING_SYSTEM).toMatch(/the same pose, the hands in the same positions and the same things at the same angles/);
    // …and still lets a real new view of the same thing pass — the host's own hands in both is no copy.
    expect(SAME_THING_SYSTEM).toMatch(/A different camera position, distance, crop or light is fine/);
    expect(SAME_THING_SYSTEM).not.toMatch(/same hands/);
  });
});

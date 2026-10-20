/**
 * THE LINE'S OWN SUBJECT IS THE PICTURE'S (round 13, 2026-10-18, the review of jobs 408-410). Three
 * pictures left out the very thing their line was about:
 * - job 410 scene 20, "Juice works the same way…": the juice sat ON the beverage cart, the picture was
 *   filed under the cart, and the view for a thing beside the subject (`BACKGROUND_VIEW`) kept the cart
 *   small — with the juice on it. It shipped "subject missing", a speck on a far cart.
 * - job 410 scene 6, "…holding | the whole can of ginger ale, | a second bag of pretzels, | and a bottle
 *   of water for later.": the third item was planned with nobody in it and drawn from the empty row's
 *   look ("unoccupied"), so the woman holding it vanished from her seat.
 * - job 408 scene 21, "…The toilet is fine. There is a stick in it.": the shot list dropped the stick
 *   the line ends on and asked for "draining slowly", a speed no still can show.
 * The rows are the real ones; the rules are general.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import {
  attachMemory,
  BACKGROUND_VIEW,
  holdsSubject,
  memorySourcesFor,
  memoryView,
  memoryViewFor,
  onlyItsSurface,
  SCREEN_ITEM_VIEW,
  tagKeyThings,
} from "./pictureMemory";
import { keepListHolders } from "./spokenLists";
import { markHostBroll } from "./hostLook";
import { closingThing, FIT_SYSTEM, fitPicturesToLines } from "./shotList";

const pic = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

/** Job 410's props list, the lines these scenes use. */
const KT_410: KeyThing[] = [
  {
    name: "beverage cart",
    main: true,
    look: "a metal service cart with wheels, a flat top holding plastic cups, ice, aluminum cans, and small bottles, pushed down the aisle",
  },
  { name: "soda cup", look: "a clear plastic cup packed with ice, filled about halfway with soda" },
  { name: "soda can", look: "a slim aluminum can, silver and red body, small pull tab on top" },
  { name: "water bottle", look: "a small clear plastic bottle with a blue cap, filled with water" },
  { name: "empty row", look: "a row of three blue seats near the front of the cabin, unoccupied, tray tables closed" },
];

const JUICE = "Juice works the same way. If they're running short, they'll tell you, and you're no worse off for trying.";
const JUICE_SHOW = "a small plastic cup of orange juice beside a juice can on the beverage cart";

/** Job 410 scenes 3, 16 and 20 as stored. */
const job410 = () => [
  pic(
    3,
    "By the time the beverage cart had come and gone, one of them was sitting in an empty row closer to the front, holding",
    "an older woman seen from the side sitting alone in an empty row of three blue seats near the front of the cabin, the beverage cart rolling away down the aisle behind her",
    { keyThing: "empty row", otherKeyThings: ["beverage cart"], otherPerson: "an older woman passenger", humanPresent: true }
  ),
  pic(
    16,
    "Number one. The whole can. On a lot of airlines the default is a small cup.",
    "a flight attendant's hands pouring soda from a soda can into a plastic cup packed with ice on top of the beverage cart",
    { keyThing: "soda can", otherKeyThings: ["beverage cart", "soda cup"], otherPerson: "a flight attendant", humanPresent: true }
  ),
  pic(20, JUICE, JUICE_SHOW, { keyThing: "beverage cart" }),
];

describe("the item, not what it sits on (job 410 scene 20)", () => {
  it("the cart is only the surface the juice sits on, and the line never names it", () => {
    const [, , juice] = job410();
    expect(holdsSubject(juice, "beverage cart")).toBe(true);
    expect(onlyItsSurface(juice, "beverage cart")).toBe(true);
    // Never the view that keeps the remembered thing small: the juice on it went small with it.
    expect(memoryViewFor(job410(), job410()[2])).not.toBe(BACKGROUND_VIEW);
  });

  it("at render the juice picture gives the cart up: no key thing of its own, drawn from its words", () => {
    const board = job410();
    attachMemory(board, board, KT_410);
    const juice = board[2];
    expect(juice.keyThing).toBeUndefined();
    expect(juice.otherKeyThings).toEqual(["beverage cart"]);
    expect(memorySourcesFor(board, juice)).toEqual([]);
    expect(memoryView(juice)).toBeUndefined();
    // Settled: a second pass leaves it as it is.
    attachMemory(board, board, KT_410);
    expect(juice.keyThing).toBeUndefined();
    expect(juice.otherKeyThings).toEqual(["beverage cart"]);
    // The pictures about other things keep theirs.
    expect(board[0].keyThing).toBe("empty row");
    expect(board[1].keyThing).toBe("soda can");
  });

  it("every pass files it the same way, as a retry reads the board back (job 399 scene 18: the carton on the cart, beside a cup)", () => {
    const KT_399: KeyThing[] = [
      { name: "beverage cart", main: true, look: "metal trolley with two tiers" },
      { name: "plastic cup", look: "clear hard plastic, filled with ice cubes" },
    ];
    const board = [
      pic(16, "Number one. The whole can.", "hands pouring soda into an ice-filled plastic cup at the cart", { keyThing: "plastic cup", humanPresent: true }),
      pic(17, "a few inches of soda over ice.", "a small plastic cup barely filled with ginger ale on a tray table", { keyThing: "plastic cup", humanPresent: true }),
      pic(18, JUICE, "a small juice carton on the beverage cart tray beside an ice-filled plastic cup", {
        keyThing: "beverage cart",
        otherKeyThings: ["plastic cup"],
      }),
    ];
    attachMemory(board, board, KT_399);
    const first = { keyThing: board[2].keyThing, others: board[2].otherKeyThings, view: memoryView(board[2]) };
    expect(first.keyThing).toBeUndefined();
    expect(first.others).toEqual(expect.arrayContaining(["beverage cart", "plastic cup"]));
    expect(first.view).toBeUndefined();
    // A retry, regenerate or resume starts from the stored board, this pass's filing on it. Asked only
    // of the key thing, the second pass filed the carton under the cup BESIDE it and kept it small.
    const again = JSON.parse(JSON.stringify(board)) as StoryboardScene[];
    attachMemory(again, again, KT_399);
    expect(again[2].keyThing).toBeUndefined();
    expect(again[2].otherKeyThings).toEqual(first.others);
    expect(memoryView(again[2])).toBeUndefined();
    expect(memorySourcesFor(again, again[2])).toEqual([]);
    // The pictures about the cup keep it on every pass.
    expect(again[0].keyThing).toBe("plastic cup");
    expect(again[1].keyThing).toBe("plastic cup");
    // The same when the shot list never filed it: the cup beside the carton is not what it is about.
    const untagged = JSON.parse(JSON.stringify(board)) as StoryboardScene[];
    delete untagged[2].keyThing;
    delete untagged[2].otherKeyThings;
    attachMemory(untagged, untagged, KT_399);
    expect(untagged[2].keyThing).toBeUndefined();
    expect(memoryView(untagged[2])).toBeUndefined();
    // With no props list a surface given up stays given up, pass after pass.
    const bare = job410();
    tagKeyThings(bare, undefined);
    tagKeyThings(bare, undefined);
    expect(bare[2].keyThing).toBeUndefined();
    expect(bare[2].otherKeyThings).toEqual(["beverage cart"]);
  });

  it("a line that names the surface is about it: the picture keeps it, and never as a thing kept small", () => {
    const board = job410();
    board[2] = pic(20, "The beverage cart comes back around with juice on it.", JUICE_SHOW, { keyThing: "beverage cart" });
    expect(onlyItsSurface(board[2], "beverage cart")).toBe(false);
    attachMemory(board, board, KT_410);
    expect(board[2].keyThing).toBe("beverage cart");
    expect(memoryView(board[2])).toBeTruthy();
    expect(memoryView(board[2])).not.toBe(BACKGROUND_VIEW);
  });

  it("a key thing beside the subject is still kept small (job 335's alarm over the night fire)", () => {
    const fire = pic(
      7,
      "the one kind of fire that likes to start while the house is asleep",
      "thin smoke rising from a smouldering mattress in a dark bedroom, a smoke alarm on the ceiling above",
      { keyThing: "smoke alarm" }
    );
    const alarm = pic(5, "That little disc on the ceiling.", "a round white smoke alarm on the hallway ceiling", { keyThing: "smoke alarm" });
    expect(holdsSubject(fire, "smoke alarm")).toBe(false);
    expect(memoryViewFor([alarm, fire], fire)).toBe(BACKGROUND_VIEW);
  });

  it("filed under the item when the item is a key thing (job 376 scene 24, job 360 scene 27)", () => {
    const alarm = pic(
      24,
      "There's a code on your screen. Lift your phone, point it like you're taking a picture of the screen.",
      "A white round smoke alarm mounted on a hallway ceiling, viewed from directly below, showing its perforated sensor grille",
      { keyThing: "hallway ceiling", otherKeyThings: ["smoke alarm"] }
    );
    const things: KeyThing[] = [
      { name: "smoke alarm", look: "a round white plastic disc" },
      { name: "hallway ceiling", look: "a flat white ceiling" },
    ];
    tagKeyThings([alarm], things);
    expect(alarm.keyThing).toBe("smoke alarm");
    expect(alarm.otherKeyThings).toEqual(["hallway ceiling"]);
  });

  it("a phone lying on the workbench is never a listing of the workbench (job 288 scene 19)", () => {
    const things: KeyThing[] = [
      { name: "workbench", look: "a scarred maple bench" },
      { name: "furniture piece", look: "a small pine bookcase" },
    ];
    const bench = pic(5, "My bench is where all of it happens.", "the scarred maple workbench in the garage", { keyThing: "workbench" });
    const phone = pic(19, "can find yours while you're sound asleep.", "a phone lying on the workbench showing a buy-and-sell app grid", {
      keyThing: "workbench",
    });
    // As filed, the screen took the bench as the item in its listing.
    expect(memoryViewFor([bench, phone], phone)).toBe(SCREEN_ITEM_VIEW);
    tagKeyThings([bench, phone], things);
    expect(phone.keyThing).toBeUndefined();
    expect(memoryViewFor([bench, phone], phone)).toBeUndefined();
    expect(bench.keyThing).toBe("workbench");
  });

  it("the boards on the rack are the boards (job 352 scene 23)", () => {
    const oak = pic(23, "oak,", "smooth oak boards stacked on the big-box lumber rack", { keyThing: "big-box lumber rack", listCut: true });
    expect(onlyItsSurface(oak, "big-box lumber rack")).toBe(true);
  });

  it("never a thing being worked on, a part of the thing, or a place word in between", () => {
    // job 258 scene 19: a step of making the holder is about the holder
    const oil = pic(19, "oil it,", "hands brushing finishing oil onto the charred cedar incense holder with the oil brush", {
      keyThing: "charred cedar incense holder",
      listCut: true,
      humanPresent: true,
    });
    expect(holdsSubject(oil, "charred cedar incense holder")).toBe(false);
    // job 262 scene 28: the button is the alarm's own
    const button = pic(
      28,
      "The test button still works. The part that detects the fire is the part that quit.",
      "a hand pressing the test button on the round white smoke alarm, held close",
      { keyThing: "smoke alarm" }
    );
    expect(holdsSubject(button, "smoke alarm")).toBe(false);
    // job 351 scene 4: a close-up of one point OF the blanket
    const point = pic(4, "At each point we add stitches, in each valley we take two away,", "close-up of a point on the star blanket where stitches are added", {
      keyThing: "star blanket",
    });
    expect(holdsSubject(point, "star blanket")).toBe(false);
    // job 263 scene 10: the heater is on the floor, beside the bed — nothing is on the bed
    const heater = pic(
      10,
      "A space heater quietly cooking the side of a mattress at 2 in the morning.",
      "Small black space heater on the floor beside a bed, with thick smoke beginning to rise from the mattress edge in a dark bedroom at night.",
      { keyThing: "bed", otherKeyThings: ["space heater"] }
    );
    expect(holdsSubject(heater, "bed")).toBe(false);
    // a close-up of one part (`partOf`) is about its part, whatever its words put on what
    const part = pic(12, "a churn dash here,", "a churn dash pattern stitched on the quilt", { keyThing: "sampler quilt", partOf: "sampler quilt" });
    expect(holdsSubject(part, "sampler quilt")).toBe(true);
    expect(onlyItsSurface(part, "sampler quilt")).toBe(false);
  });
});

/** Job 410 scenes 3-7 as stored: the list of what she was holding. */
const held410 = () => [
  pic(
    3,
    "By the time the beverage cart had come and gone, one of them was sitting in an empty row closer to the front, holding",
    "an older woman seen from the side sitting alone in an empty row of three blue seats near the front of the cabin, the beverage cart rolling away down the aisle behind her",
    { keyThing: "empty row", otherKeyThings: ["beverage cart"], otherPerson: "an older woman passenger", humanPresent: true }
  ),
  pic(4, "the whole can of ginger ale,", "an older woman's hand holding a full soda can in the empty row of blue seats", {
    keyThing: "soda can",
    listCut: true,
    otherPerson: "an older woman passenger",
    humanPresent: true,
  }),
  pic(5, "a second bag of pretzels,", "two pretzel bags held in an older woman's hands in the empty row", {
    keyThing: "pretzel bag",
    listCut: true,
    otherPerson: "an older woman passenger",
    humanPresent: true,
  }),
  pic(6, "and a bottle of water for later.", "small water bottle resting on the tray table in the empty row", {
    keyThing: "water bottle",
    otherKeyThings: ["empty row"],
    listCut: true,
    visualPrompt: "A small clear plastic water bottle with a blue cap resting on a closed tray table in the empty row of blue seats.",
  }),
  pic(
    7,
    "The other was still in row fourteen with a few inches of soda over ice. He figures she must know somebody on the crew.",
    "an older man seen from the side in a seat in row fourteen, holding a soda cup with ice half full",
    { keyThing: "soda cup", otherPerson: "an older man passenger", humanPresent: true }
  ),
];

describe("a list of what someone holds keeps the one holding it (job 410 scene 6)", () => {
  it("the bottle of water is in her hand, not on an empty seat", () => {
    const scenes = held410();
    expect(keepListHolders(scenes)).toBe(1);
    const water = scenes[3];
    expect(water.showSubject).toBe("small water bottle in the empty row, held in the hand of an older woman passenger");
    expect(water.visualPrompt).toBe(
      "A small clear plastic water bottle with a blue cap in the empty row of blue seats, held in the hand of an older woman passenger."
    );
    expect(water).toMatchObject({ humanPresent: true, otherPerson: "an older woman passenger" });
    // The items that already showed her, and the line after the list, are left as they were.
    expect(scenes[1].showSubject).toBe(held410()[1].showSubject);
    expect(scenes[2].showSubject).toBe(held410()[2].showSubject);
    expect(scenes[4].showSubject).toBe(held410()[4].showSubject);
  });

  it("she is still in the picture after the person pass, drawn as herself, never the host", () => {
    const scenes = held410();
    keepListHolders(scenes);
    markHostBroll(scenes, { hostLook: "a slender woman in her forties, navy blazer", hostName: "the host" }, "https://r2/host.jpg");
    expect(scenes[3]).toMatchObject({ humanPresent: true, otherPerson: "an older woman passenger" });
    expect(scenes[3].brollHostLook).toBeUndefined();
    expect(scenes[3].brollHostRef).toBeUndefined();
  });

  it("the host's own list, said of their own hands, is held in the host's hand", () => {
    const scenes = [
      { index: 1, scriptText: "I walked into my first craft fair carrying", hostPresent: true, showSubject: "the host" } as StoryboardScene,
      pic(2, "a folding table,", "a folding table", { listCut: true }),
      pic(3, "a cash box,", "a small metal cash box", { listCut: true }),
      pic(4, "and a tub of coasters.", "a plastic tub of coasters", { listCut: true }),
    ];
    expect(keepListHolders(scenes)).toBe(3);
    expect(scenes[2].showSubject).toBe("a small metal cash box, held in the host's hand");
    expect(scenes[2].humanPresent).toBe(true);
    expect(scenes[2].otherPerson).toBeUndefined();
    // …and the host stays in the picture after the person pass, as the host at work.
    markHostBroll(scenes, { hostLook: "a man in his sixties, grey beard", hostName: "the host" }, "https://r2/host.jpg");
    expect(scenes[2]).toMatchObject({ humanPresent: true });
    expect(scenes[2].brollHostLook).toBeTruthy();
  });

  it("the holder is named the way English names a phrase, and taken from the items before the lead-in", () => {
    // A holder written as a phrase ("a man in his sixties" on stored films) has no possessive.
    const phrase = [
      pic(1, "He came back to his seat holding", "a man in his sixties walking down the aisle", { otherPerson: "a man in his sixties", humanPresent: true }),
      pic(2, "a paper cup,", "a paper cup of coffee", { listCut: true }),
      pic(3, "and a folded newspaper.", "a folded newspaper lying on the seat", { listCut: true }),
    ];
    expect(keepListHolders(phrase)).toBe(2);
    expect(phrase[1].showSubject).toBe("a paper cup of coffee, held in the hand of a man in his sixties");
    expect(phrase[2].showSubject).toBe("a folded newspaper, held in the hand of a man in his sixties");
    // The lead-in shows someone beside the holder; the items show whose hands the things are in.
    const beside = [
      pic(1, "The flight attendant smiled, and she sat back down holding", "a flight attendant smiling down the aisle", {
        otherPerson: "a flight attendant",
        humanPresent: true,
      }),
      pic(2, "the whole can,", "an older woman's hand holding a full soda can", { listCut: true, otherPerson: "an older woman passenger", humanPresent: true }),
      pic(3, "and a bottle of water.", "a small water bottle standing on the tray table", { listCut: true }),
    ];
    expect(keepListHolders(beside)).toBe(1);
    expect(beside[2]).toMatchObject({
      showSubject: "a small water bottle, held in the hand of an older woman passenger",
      otherPerson: "an older woman passenger",
    });
  });

  it("never a thing holding things, a list after 'with', a list of steps, or a holder nobody knows", () => {
    // job 143 scenes 236-238: the tray holds the teapot
    const tray = [
      pic(236, "Cut the pockets a little bigger, and the same tray holds", "hands cutting wider pockets into a wooden tray on the workbench", {
        humanPresent: true,
      }),
      pic(237, "a small teapot", "a small teapot sitting inside a tray pocket on the workbench", { listCut: true }),
      pic(238, "and tea cups for the folks who'd rather have tea.", "tea cups sitting inside tray pockets on the workbench", { listCut: true }),
    ];
    expect(keepListHolders(tray)).toBe(0);
    expect(tray[1].showSubject).toBe("a small teapot sitting inside a tray pocket on the workbench");
    // a table WITH things on it
    const table = [
      pic(1, "this one's for anybody sitting at a kitchen table with", "a kitchen table by a window"),
      pic(2, "a straight-stitch machine,", "a small black straight-stitch sewing machine", { listCut: true }),
      pic(3, "and a mountain of scraps.", "a mountain of fabric scraps", { listCut: true }),
    ];
    expect(keepListHolders(table)).toBe(0);
    // holding, but nobody is shown anywhere and the line is not the host's own
    const nobody = [
      pic(1, "She came back holding", "an airport gate seen from the jet bridge"),
      pic(2, "a ticket,", "a paper boarding pass", { listCut: true }),
      pic(3, "and a coffee.", "a paper coffee cup", { listCut: true }),
    ];
    expect(keepListHolders(nobody)).toBe(0);
    expect(nobody[1].humanPresent).toBeUndefined();
    // a list of steps is the host's hands already
    const steps = [
      pic(1, "Then she was holding", "a woman in a kitchen", { otherPerson: "a woman", humanPresent: true }),
      pic(2, "stir it,", "a pot on the stove", { listCut: true, listKind: "steps" }),
      pic(3, "and taste it.", "a wooden spoon over the pot", { listCut: true, listKind: "steps" }),
    ];
    expect(keepListHolders(steps)).toBe(0);
  });
});

describe("the line's last word, and a state a photo cannot show (job 408 scene 21)", () => {
  const LINE = "Then the next. The toilet starts flushing slow, and you decide the toilet is getting old. The toilet is fine. There is a stick in it.";
  const SHOW = "toilet bowl with water draining slowly, paper piling near the bend";

  it("the stick the line closes on is named to the line check when the picture's words leave it out", () => {
    expect(closingThing(LINE, SHOW)).toBe("There is a stick in it.");
    // the picture already shows it
    expect(closingThing(LINE, "toilet bowl with a white stick caught across the drain under high water")).toBeUndefined();
    // a closing line that reveals nothing you can see, or a line of one sentence
    expect(closingThing("Check it once a year. That's the job.", "a smoke alarm turned over in a hand")).toBeUndefined();
    expect(closingThing("There is a stick in it.", SHOW)).toBeUndefined();
    // a long closing sentence is not a reveal
    expect(
      closingThing("It held up. There was a little more paper than usual in the bin by the door that week.", "a bathroom bin")
    ).toBeUndefined();
    // a closing sentence that names an idea, not a thing a camera can see
    for (const end of ["There's a reason for that.", "There is a better way.", "There's one more thing.", "There's the catch."])
      expect(closingThing(`It looked fine for a year. ${end}`, "a smoke alarm on a hallway ceiling")).toBeUndefined();
    // …while a thing named after "the problem was" is one
    expect(closingThing("It kept tripping. The problem was a loose wire.", "a breaker panel with its door open")).toBe(
      "The problem was a loose wire."
    );
  });

  it("the rulebook keeps a line's last thing and draws what a speed leaves, in neutral words", () => {
    expect(FIT_SYSTEM).toMatch(/THE LINE'S LAST WORD\. A line that closes on a short sentence revealing the thing it was building to/);
    expect(FIT_SYSTEM).toMatch(/a picture without it is WRONG, however right the rest is/);
    expect(FIT_SYSTEM).toMatch(/A picture marked ends on "…" closes on such a sentence/);
    expect(FIT_SYSTEM).toMatch(/A STATE A PHOTO CANNOT SHOW\. A still picture shows no speed and no change over time/);
    expect(FIT_SYSTEM).toMatch(/Write what the state leaves\s+for the eye/);
    expect(FIT_SYSTEM).not.toMatch(/toilet|\bstick\b|swab|plunger|juice|beverage|\bcart\b|passenger|flight|pretzel|ginger/i);
  });

  beforeEach(() => mockInvoke.mockReset());

  it("the check is shown the closing sentence, and its rewrite keeps the stick and draws standing water", async () => {
    const scenes = [
      pic(
        19,
        "Good design. But a stiff stick does not always follow a curve. It can turn sideways and catch across the passage, like a bar across a doorway.",
        "looking down into the toilet bowl: a single white cotton swab lying sideways across the dark drain opening at the bottom, under clear water",
        { keyThing: "toilet", partOf: "toilet" }
      ),
      { index: 20, scriptText: "One swab, maybe nothing happens. But now there is a bar in the doorway. The next piece of paper catches on it.", hostPresent: true } as StoryboardScene,
      pic(21, LINE, SHOW, { keyThing: "toilet", otherKeyThings: ["toilet paper"], selfMoving: true }),
      pic(22, "If you think one is already in there, the plunger is the wrong tool. It can push the stick deeper into the curve.", "a wooden-handled plunger standing upright beside the toilet, unused", {
        keyThing: "plunger",
        otherKeyThings: ["toilet"],
      }),
    ];
    const rewrite =
      "looking down into a toilet bowl: the water standing high and still, a sheet of toilet paper caught on a white cotton swab lying across the drain";
    mockInvoke.mockResolvedValue({
      text: JSON.stringify({
        pictures: [
          { id: 0, about: "the stick catching across the passage", shows_it: true },
          { id: 2, about: "the stick in the toilet that makes it flush slow", shows_it: false, show: rewrite, thing: "toilet", stage: null, other: null },
          { id: 3, about: "the plunger is the wrong tool", shows_it: true, forbids: "a plunger pushed into the toilet bowl" },
        ],
      }),
    });
    const things: KeyThing[] = [
      { name: "toilet", look: "a white porcelain toilet", main: true },
      { name: "plunger", look: "a wooden-handled plunger with a black rubber cup" },
    ];
    const r = await fitPicturesToLines(scenes, { keyThings: things });
    const sent = String(mockInvoke.mock.calls[0][0].userMessage);
    expect(sent).toContain(`#2 PICTURE (ends on "There is a stick in it.")`);
    // the swab picture shows its stick already, and the plunger's line ends on no reveal
    expect(sent).not.toMatch(/#0 PICTURE[^\n]*ends on/);
    expect(sent).not.toMatch(/#3 PICTURE[^\n]*ends on/);
    expect(r.fixed).toBe(1);
    expect(r.scenes[2].showSubject).toBe(rewrite);
    expect(r.scenes[2].keyThing).toBe("toilet");
    // judged again on the new words (`judgeSelfMoving`): standing water is not a moving clip by default
    expect(r.scenes[2].selfMoving).toBeUndefined();
  });
});

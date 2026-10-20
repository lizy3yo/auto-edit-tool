/**
 * A WRITTEN LOOK CARRIES NO PASSING STATE (round 16; the practice film 421 scene 2, job 417 scene 17).
 * The props list writes a thing as it was when the script first named it, and its look is sent to every
 * picture of it. Job 421's "empty row: …, tray tables stowed, no passengers seated" reached a picture of
 * a woman sitting in that row as HOW THE EMPTY ROW LOOKS, and the check held the frame to it: the empty
 * row was drawn front-on beside her and flagged missing twice. Job 417's cup "filled partway with ice
 * cubes" and its can "unopened … condensation beads" reached the picture of the soda being poured. Now
 * a look says how the thing is BUILT (`lookWithoutState`), wherever it reaches a prompt or the check, a
 * thing named for a state is called by what it is (`stateFreeName`), and the props call is told the
 * rule. The cases are stored rows; the negatives are looks that are built that way and must not change.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  attachMemory,
  keyThingLookClause,
  keyThingLookFor,
  lookToHold,
  lookWithoutState,
  memoryFor,
  otherThingLookFor,
  placeLookClause,
  placeLooksFor,
  requiredThingsFor,
  sheetWithoutLight,
  stateFreeName,
} from "./pictureMemory";
import { CONTINUITY_SYSTEM, parseKeyThings } from "./shotList";
import { buildStillPrompt, memoryFields } from "./longformVideo";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

// Job 421's props list as stored (the round-15 practice film).
const SHEET_421 = [
  "aircraft cabin: a commercial airliner interior, narrow aisle, blue upholstered seats in rows of three, overhead bins along both sides",
  "MAIN beverage cart: a metal airline service cart about 1 meter tall, a flat top shelf, two side handles, small wheels at the base, stocked with cans and cups",
  "plastic cup: a clear plastic cup, about 200 ml, filled partway with ice cubes, used for serving soda",
  "beverage can: a slim aluminum soda can, about 355 ml, condensation on the metal, unopened or partly poured",
  "snack basket: a round woven basket, about 25 cm wide, holding small foil pretzel bags and wrapped cookies",
  "water bottle: a clear plastic bottle, about 500 ml, sealed cap, filled with water",
  "carry-on bag: a black soft-sided rolling bag, about 50 cm tall, zippered front pocket, fabric handle on top",
  "airline seat row fourteen: a blue upholstered airline seat, reclining back, fold-down tray table, armrests on both sides",
  "empty row: a set of three blue upholstered airline seats near the front of the cabin, tray tables stowed, no passengers seated",
  "galley: a narrow stainless steel kitchen area at the front of the cabin, overhead compartments, a counter with latched cabinet doors",
].join("\n");
const K421 = parseKeyThings(SHEET_421);
const ROW_BUILT = "a set of three blue upholstered airline seats near the front of the cabin";

// Job 417's lines for the cart, the cup and the can, as stored.
const K417: KeyThing[] = [
  {
    name: "beverage cart",
    main: true,
    look: "a stainless-steel airline beverage cart about 1 meter tall, a flat top surface holding drinks, a hinged lower panel concealing storage, small rubber wheels, two side handles for pushing",
  },
  { name: "plastic cup", look: "a clear plastic cup about 10 cm tall, filled partway with ice cubes, used for pouring soda or juice" },
  { name: "soda can", look: "an unopened aluminum can about 12 cm tall, rounded top with a pull tab, condensation beads on the sides" },
];

/** Job 421 scene 2 (5.80-11.95 s) as stored. */
const scene2 = () =>
  pic(2, "a woman passenger sitting alone in a set of three blue upholstered airline seats near the front of the cabin, tray tables stowed, the beverage cart passing in the aisle beside her", {
    scriptText: "By the time the beverage cart had come and gone, one of them was sitting in an empty row closer to the front, holding",
    visualPrompt:
      "Empty row of three blue upholstered airline seats near the front of the cabin, tray tables stowed, a metal service cart with small wheels visible in the aisle beside the row.",
    keyThing: "empty row",
    otherKeyThings: ["beverage cart"],
    stillImage: true,
  });

describe("421 #2: the row a woman sits in is drawn by how it is built", () => {
  it("its look loses the stowed tray tables and the passengers that are not there; its name is kept", () => {
    expect(lookWithoutState(K421.find(k => k.name === "empty row")!.look, "empty row")).toBe(ROW_BUILT);
    expect(keyThingLookFor(scene2(), K421, false)).toBe(ROW_BUILT);
    // Pictures are filed and matched by the name: the list keeps it, and every name, as written.
    expect(parseKeyThings(sheetWithoutLight(SHEET_421)).map(k => k.name)).toEqual(K421.map(k => k.name));
    expect(sheetWithoutLight(SHEET_421).split("\n")).toContain(`empty row: ${ROW_BUILT}`);
  });

  it("the prompt calls it the row, and the check asks for the row and holds it to how it is built", async () => {
    const s = scene2();
    const later = pic(9, "the empty row of three seats near the front, seen from the aisle", { keyThing: "empty row" });
    attachMemory([s, later], [s, later], K421);
    Object.assign(s, memoryFields(await memoryFor(s, 0), undefined));
    expect(s.keyThingLook).toBe(ROW_BUILT);
    const clause = keyThingLookClause(s);
    expect(clause).toContain(`HOW THE ROW LOOKS in every picture of this video: ${ROW_BUILT}.`);
    expect(clause).not.toMatch(/EMPTY ROW|no passengers|seated|stowed/);
    expect(lookToHold(s)).toEqual({ thing: "row", look: ROW_BUILT });
    expect(requiredThingsFor(s)).toEqual(["row", "beverage cart"]);
    // The picture's own words still say what it shows: her, in that row.
    const prompt = buildStillPrompt(s);
    expect(prompt).toContain("a woman passenger sitting alone in a set of three blue upholstered airline seats");
    expect(prompt).not.toContain("no passengers seated");
  });

  it("a picture whose own words say the row is empty still draws it empty", () => {
    const empty = pic(5, "an empty row of three blue seats near the front of the cabin, nobody sitting in it", {
      keyThing: "empty row",
      keyThingLook: ROW_BUILT,
    });
    const prompt = buildStillPrompt(empty);
    expect(prompt).toContain("an empty row of three blue seats near the front of the cabin, nobody sitting in it");
    expect(prompt).toContain(`HOW THE ROW LOOKS in every picture of this video: ${ROW_BUILT}.`);
  });
});

describe("417 #17 and 421 #22: the cup, the can and the cart the attendant pours from", () => {
  const s17 = () =>
    pic(17, "a flight attendant setting a half-poured soda can back on the beverage cart beside a plastic cup of ice", {
      keyThing: "soda can",
      otherKeyThings: ["beverage cart", "plastic cup"],
    });

  it("417 #17: no ice the cup was first named with, no unopened can, no drinks on the cart", () => {
    expect(keyThingLookFor(s17(), K417, false)).toBe("an aluminum can about 12 cm tall, rounded top with a pull tab");
    expect(otherThingLookFor(s17(), "plastic cup", K417, false)).toBe("a clear plastic cup about 10 cm tall");
    expect(otherThingLookFor(s17(), "beverage cart", K417, false)).toBe(
      "a stainless-steel airline beverage cart about 1 meter tall, a flat top surface, a hinged lower panel concealing storage, small rubber wheels, two side handles for pushing"
    );
  });

  it("421 #22: the drink handed over is no cup of ice by its look", () => {
    const s22 = pic(22, "a flight attendant at the beverage cart handing a passenger a drink in a plastic cup", {
      keyThing: "beverage cart",
      otherKeyThings: ["plastic cup"],
    });
    expect(otherThingLookFor(s22, "plastic cup", K421, false)).toBe("a clear plastic cup, about 200 ml");
    expect(keyThingLookFor(s22, K421, false)).toBe(
      "a metal airline service cart about 1 meter tall, a flat top shelf, two side handles, small wheels at the base"
    );
  });

  it("421's other lines: what a basket holds and a can's condensation go; a look of nothing but a state leaves nothing", () => {
    const read = sheetWithoutLight(SHEET_421).split("\n");
    expect(read).toContain("plastic cup: a clear plastic cup, about 200 ml, used for serving soda");
    expect(read).toContain("beverage can: a slim aluminum soda can, about 355 ml");
    expect(read).toContain("snack basket: a round woven basket, about 25 cm wide");
    // A line that was only a state keeps its name, with nothing to draw it by.
    expect(lookWithoutState("closed")).toBe("");
    expect(sheetWithoutLight("garage workshop: a one-car garage\nbedroom door: closed")).toBe("garage workshop: a one-car garage\nbedroom door:");
  });
});

describe("what is built that way stays, byte for byte", () => {
  it("open tops, glass fronts, fold-down tables, missing parts, a lit screen and a clean design", () => {
    const same = [
      "a glass-fronted cabinet, dark oak frame",
      "an open-top crate of rough pine slats",
      "a wooden crate, open at the top, rope handles",
      "a narrow tube closed at one end",
      "tall wooden bookcase with open shelves, clean joinery",
      // Job 421's own seat and galley.
      "a blue upholstered airline seat, reclining back, fold-down tray table, armrests on both sides",
      "a narrow stainless steel kitchen area at the front of the cabin, overhead compartments, a counter with latched cabinet doors",
      // Jobs 267, 343: a sealed alarm made with no battery door; a lit screen is the thing's own light.
      "matte white alarm unit with a smooth unbroken back plate and no battery door",
      "laptop with a plain lit screen showing a soft-focus photo of a wooden board",
      "a clean and simple shape, open and airy",
      "a cast-iron wood burning stove with a glass door",
      "a white porcelain basin, a rim blackened from burning",
      "shoulder-length dirty blonde hair",
    ];
    for (const look of same) expect(lookWithoutState(look, "thing"), look).toBe(look);
  });

  it("what a thing holds stays when its name says so; a place keeps what it is furnished with", () => {
    for (const [name, look] of [
      ["coffee can of burnt scraps", "a dented metal can filled with charred cedar ends and corner cutoffs"], // job 258
      ["fabric scrap bins", "woven baskets filled with folded fabric pieces"], // job 281
      ["water bottle", "a clear plastic bottle, about 500 ml, sealed cap, filled with water"], // job 421
      ["battery bag", "clear zip-top plastic bag holding a few cylindrical batteries"], // job 322
      ["pharmacy aisle", "a narrow aisle lined with low wooden shelves holding neat rows of greeting cards"], // job 409
    ])
      expect(lookWithoutState(look, name), name).toBe(look);
    // How full it is still goes (job 410's "soda cup").
    expect(lookWithoutState("a clear plastic cup packed with ice, filled about halfway with soda", "soda cup")).toBe(
      "a clear plastic cup, filled with soda"
    );
  });

  it("a held list runs to its end; a describing word that was a state leaves its noun to the one before it", () => {
    expect(lookWithoutState("wall-mounted rack holding a hand sander, clamps, and a square, hung above the workbench.", "tool rack")).toBe(
      "wall-mounted rack, hung above the workbench."
    ); // job 328
    expect(lookWithoutState("a medium-sized tan and white dog with a short coat, floppy ears, and a dark, damp nose that leads every greeting", "dog")).toBe(
      "a medium-sized tan and white dog with a short coat, floppy ears, and a dark nose that leads every greeting"
    ); // job 373
    expect(lookWithoutState("a dim still bedroom, bed with plain neutral bedding, closed door, a single nightstand lamp off", "bedroom")).toBe(
      "a dim still bedroom, bed with plain neutral bedding, door"
    ); // job 376
  });
});

describe("a place a picture is set in", () => {
  it("who is in it and whether it is open is the picture's own (job 288's driveway)", () => {
    const things: KeyThing[] = [
      { name: "driveway", look: "light grey paved surface in front of garage door, open and empty except for the furniture piece" },
    ];
    const s = pic(4, "a bookcase standing on the driveway, a buyer walking up to it", { keyThing: "bookcase" });
    const looks = placeLooksFor(s, things, things[0]);
    expect(looks).toEqual([{ name: "driveway", look: "light grey paved surface in front of garage door" }]);
    expect(placeLookClause({ ...s, placeLooks: looks })).not.toMatch(/empty|open and/);
  });
});

describe("a thing named for a state is called by what it is (stateFreeName)", () => {
  it("the state goes from the name in the prompt and the check; a name that is no state stays", () => {
    expect(stateFreeName("empty row")).toBe("row");
    expect(stateFreeName("full basket")).toBe("basket");
    expect(stateFreeName("open laptop")).toBe("laptop");
    expect(stateFreeName("lit candle")).toBe("candle");
    for (const name of ["vacant lot", "full set of chisels", "beverage cart", "airline seat row fourteen", "backyard lawn", "wet bar"])
      expect(stateFreeName(name)).toBe(name);
  });
});

describe("the props call is told the rule", () => {
  it("a look says how the thing is built — never a state or what is not there — with neutral examples", () => {
    expect(CONTINUITY_SYSTEM).toContain("Nor a STATE it is in for a moment");
    expect(CONTINUITY_SYSTEM).toContain("a look says how the thing is BUILT, and each picture's own words say its state");
    expect(CONTINUITY_SYSTEM).toContain("Only a thing whose name says what it holds (a jar of buttons) keeps that in its look");
    expect(CONTINUITY_SYSTEM).not.toMatch(/passenger|flight|cabin|airline|ice cube|soda|tray table/i);
  });
});

import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  CUT_OPEN_BROKEN,
  cutOpenFault,
  drawnFromOutside,
  INSIDE_PART_NOTE,
  insideView,
  NOTHING_CUT_OPEN_RULE,
  SEEN_FROM_OUTSIDE_CLAUSE,
  withoutCutaway,
} from "./cutOpen";
import { attachMemory, hiddenInside, keyThingLookFor, memorySourcesFor } from "./pictureMemory";
import { CONTINUITY_SYSTEM, FIT_SYSTEM, SHOT_LIST_SYSTEM } from "./shotList";
import { NAMED_LOOKS_SYSTEM, namedLookClause } from "./namedLooks";

// Job 403 (household repairs), the pictures as they were stored.
const S11 = {
  show: "close view of the toilet's internal porcelain S-shaped trapway channel with water rushing through it",
  vp: "Close view of the toilet's internal white porcelain S-shaped trapway channel, the smooth curved passage climbing upward then descending.",
};
const S12 = {
  show: "water swirling down the white toilet bowl mid-flush",
  vp: "Water swirling down inside the white ceramic toilet bowl during a flush.",
};
const S13 = {
  show: "close-up of the smooth white curved S-shaped porcelain channel, water flowing up and over its curve",
  vp: "Close-up of the smooth white curved S-shaped porcelain trapway channel inside a toilet bowl, water flowing up and over the curve.",
};
const S15_PANEL =
  "A single cotton swab lying straight on white tile beside a toilet, positioned to show the toilet's internal trapway curve behind it.";
const S16 = {
  show: "cutaway close-up of the white porcelain S-shaped channel behind the bowl, water climbing up and over the curve before descending",
  vp: "Cutaway view of the white porcelain S-shaped trapway channel behind a toilet bowl, water climbing up and over the curve before descending.",
};
const S18 =
  "close-up inside the curved white porcelain passage, a cotton swab wedged sideways across it like a bar, a scrap of white toilet paper caught on it";
const S22 = {
  show: "host's hands guiding a toilet auger's curved tip into the trapway",
  vp: "Bare weathered hands guiding the curved metal tip of a toilet auger into the white porcelain trapway channel, the red plunger visible standing in the corner of the small tiled bathroom.",
};
const S23 = {
  show: "toilet lifted off the floor in the small German bathroom, pipe opening exposed",
  vp: "A white ceramic toilet lifted off the pale beige floor tiles in a small German bathroom, exposing the open pipe connection at the base.",
};
const TRAPWAY_LOOK =
  "the toilet's internal porcelain passage behind the bowl, a smooth curved S-shaped channel molded white, climbing upward before descending";
const THINGS: KeyThing[] = [
  { name: "toilet trapway", main: true, look: TRAPWAY_LOOK },
  { name: "toilet auger", look: "slim metal rod with a curved tip and a plastic crank handle, short household size" },
  { name: "plunger", look: "red rubber cup on a wooden handle, standing upright in a corner" },
];

const pic = (index: number, d: { show: string; vp: string }, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", showSubject: d.show, visualPrompt: d.vp, ...over }) as StoryboardScene;

describe("a description that asks to see inside a solid thing (insideView)", () => {
  it("job 403: the internal channel, the cutaway, the camera inside the passage, the panel's internal curve", () => {
    for (const t of [S11.show, S11.vp, S16.show, S16.vp, S18, S15_PANEL, TRAPWAY_LOOK]) expect(insideView(t)).toBe(true);
  });

  it("the stored door-frame cutaways and the wall cavity (jobs 232, 225, 236, 12)", () => {
    expect(insideView("a cutaway view of the pine door frame showing the gap and wooden stud behind it")).toBe(true);
    expect(insideView("long steel screw driven through the frame into the stud behind it, cross-section view")).toBe(true);
    expect(insideView("a cross-section view showing a long screw passing through the strike plate")).toBe(true);
    expect(insideView("Cross-section of a house wall cavity showing thick white insulation batts")).toBe(true);
    expect(insideView("pine door frame cross-section showing a shallow gap and thicker stud behind board")).toBe(true);
  });

  it("never a real photo: the bowl looked into, the lifted toilet, a stick's profile, an open lantern, a door in its wall", () => {
    for (const t of [
      S12.show,
      S12.vp,
      S23.show,
      S23.vp,
      S13.show, // no inside in its own words — its key thing's look says it (`hiddenInside`)
      "grey PVC pipe network running beneath a house toward the street",
      "Six pre-milled pine screen-molding strips laid parallel on a worn wooden workbench, their uniform cross-section and light grain visible up close",
      "A small battery-powered LED puck light glowing softly inside the hollow frame cavity of a tabletop lantern",
      "Bare weathered hands grip a wooden chisel angled flat inside a half-lap joint cavity",
      "bedroom door: a plain white paneled interior door, rectangular brass handle, shown closed within the bedroom wall",
      "Most folks run a thin trickle and hope. — a calm, photoreal cutaway of that subject, no people in the frame",
      "A wooden shelf component showing a half-lap cutaway where material has been removed from one board",
      "an x-ray image clipped to a light box beside the dentist's chair",
      "an avocado sliced in half on a cutting board showing the pit",
      "a cutaway shot of hands sanding a board", // an editor's b-roll
      "a sheer see-through look on a mannequin",
      "a see-through plastic tub of buttons",
      "the dairy section photographed from the aisle",
      "a grey sectional sofa in the living room",
      "the inner curve of the bowl, glazed white",
      "",
    ])
      expect(insideView(t)).toBe(false);
  });
});

describe("no prompt ever asks for a cut view (withoutCutaway)", () => {
  it("job 403 scene 16: the cutaway words go, the thing and its place stay", () => {
    expect(withoutCutaway(S16.vp)).toBe(
      "View of the white porcelain S-shaped trapway channel behind a toilet bowl, water climbing up and over the curve before descending."
    );
    expect(withoutCutaway(S16.show)).toBe(
      "close-up of the white porcelain S-shaped channel behind the bowl, water climbing up and over the curve before descending"
    );
  });

  it("the stored door frames: a trailing tag, a cross-section of, a cutaway diagram", () => {
    expect(withoutCutaway("long steel screw driven through the frame into the stud behind it, cross-section view")).toBe(
      "long steel screw driven through the frame into the stud behind it"
    );
    expect(withoutCutaway("Cross-section of a house wall cavity showing thick white insulation batts")).toBe(
      "View of a house wall cavity showing thick white insulation batts"
    );
    expect(withoutCutaway("A cross-section or cutaway view diagram showing the interior of a door frame")).toBe(
      "A photo showing the interior of a door frame"
    );
    expect(withoutCutaway("an x-ray view of the wall behind the outlet")).toBe("a view of the wall behind the outlet");
  });

  it("an untouched prompt stays byte-identical", () => {
    for (const t of [S12.vp, S23.vp, S11.vp, "their uniform cross-section and light grain", "a half-lap cutaway where material was removed"])
      expect(withoutCutaway(t)).toBe(t);
  });
});

describe("the still check names a thing cut open (cutOpenFault)", () => {
  it("reads the check's own words for a cut-open thing", () => {
    expect(CUT_OPEN_BROKEN).toMatch(/say "cut open" in what/);
    for (const w of ["toilet cut open, inner channel exposed", "porcelain sawn in half", "cutaway of the fixture", "cross-section of a wall", "insides exposed"])
      expect(cutOpenFault(w)).toBe(true);
  });

  it("never another broken frame: a blade through a fence, a board floating, a saw cutting through a clamp", () => {
    for (const w of ["blade through the fence", "board passes through blade", "cutting board floating above the table", "saw cuts through clamp", "", undefined])
      expect(cutOpenFault(w)).toBe(false);
  });
});

describe("a picture of a part hidden inside is drawn from outside (job 403)", () => {
  it("a key thing whose look is an inside has no look a camera can hold, and marks its pictures", () => {
    const lifted = pic(23, S23, { keyThing: "toilet trapway", humanPresent: true });
    const auger = pic(22, S22, { keyThing: "toilet auger", otherKeyThings: ["toilet trapway"], humanPresent: true });
    const plunger = pic(21, { show: "a red rubber plunger standing idle in the corner", vp: "A red rubber plunger standing idle in the corner." }, { keyThing: "plunger" });
    expect(keyThingLookFor(lifted, THINGS, false)).toBeUndefined();
    expect(keyThingLookFor(auger, THINGS, false)).toMatch(/crank handle/);
    expect(hiddenInside(lifted, THINGS)).toBe(true);
    expect(hiddenInside(auger, THINGS)).toBe(true); // the trapway beside the auger
    expect(hiddenInside(plunger, THINGS)).toBe(false);
  });

  it("attachMemory marks scene 13 drawn from outside; the bowl with no key thing is left alone", () => {
    const board = [pic(12, S12), pic(13, S13, { keyThing: "toilet trapway", partOf: "toilet trapway" })];
    attachMemory(board, [], THINGS);
    expect(board[1].seenFromOutside).toBe(true);
    expect(board[0].seenFromOutside).toBeUndefined();
    expect(drawnFromOutside(board[1])).toBe(true);
    expect(drawnFromOutside(board[0])).toBe(false);
    expect(drawnFromOutside(pic(11, S11))).toBe(true); // by its own words
  });

  it("memory never copies a picture described as a cutaway or an inside: scene 23 and the auger skip 11, 16 and 18", () => {
    const tr = { keyThing: "toilet trapway" };
    const board = [
      pic(11, S11, tr),
      pic(12, S12),
      pic(13, S13, { ...tr, partOf: "toilet trapway" }),
      pic(16, S16, { ...tr, partOf: "toilet trapway" }),
      pic(18, { show: S18, vp: S18 }, { ...tr, partOf: "toilet trapway" }),
      pic(22, S22, { keyThing: "toilet auger", otherKeyThings: ["toilet trapway"], humanPresent: true }),
      pic(23, S23, { ...tr, humanPresent: true }),
    ];
    const lifted = memorySourcesFor(board, board[6]);
    expect(lifted).toContain(board[2]); // scene 13, described as the outside of a channel
    for (const cut of [board[0], board[3], board[4]]) expect(lifted).not.toContain(cut);
    expect(memorySourcesFor(board, board[5])).toEqual([board[2]]);
    // Before the rule, the lifted toilet's memory was scene 11, the first picture of its key thing.
    expect(memorySourcesFor(board.slice(0, 1).concat(board[6]), board[6])).toEqual([]);
  });
});

describe("every place a picture is written carries the rule", () => {
  it("the shot list, the line check, the props list and the named-things step", () => {
    expect(SHOT_LIST_SYSTEM).toContain(`5f. ${NOTHING_CUT_OPEN_RULE}`);
    expect(SHOT_LIST_SYSTEM).toMatch(/It holds over rule 5e/);
    expect(FIT_SYSTEM).toContain(NOTHING_CUT_OPEN_RULE);
    expect(FIT_SYSTEM).toMatch(/It is WRONG when it shows a solid thing cut open/);
    expect(NAMED_LOOKS_SYSTEM).toContain(NOTHING_CUT_OPEN_RULE);
    expect(CONTINUITY_SYSTEM).toMatch(/A part HIDDEN INSIDE something .* is never a line of its own, and never the MAIN thing/);
  });

  it("the rule is general: no channel's object in it, and it leaves food, wood and cloth cut as work alone", () => {
    for (const t of [NOTHING_CUT_OPEN_RULE, SEEN_FROM_OUTSIDE_CLAUSE, CUT_OPEN_BROKEN, INSIDE_PART_NOTE])
      expect(t).not.toMatch(/toilet|trapway|porcelain|door frame/i);
    expect(NOTHING_CUT_OPEN_RULE).toMatch(/Food, wood or cloth cut as part of the work, and a real repair cut/);
    expect(CUT_OPEN_BROKEN).toMatch(/Fine: food, wood or cloth cut as part of the work/);
    expect(NOTHING_CUT_OPEN_RULE).toMatch(/graphics' job/);
  });

  it("a real repair cut is the work, never a cut-open picture: the rule and the check both say so", () => {
    // A household-repair film cuts pipes to length and opens a wall to reach a valve; the check is
    // asked of every picture, so refusing those would send the right picture back whole.
    for (const t of [NOTHING_CUT_OPEN_RULE, CUT_OPEN_BROKEN]) {
      expect(t).toMatch(/a pipe cut to length/);
      expect(t).toMatch(/access hole cut in a wall/);
    }
    // …but the sawn fixture with hands on it is still broken (job 403 scene 22, the auger).
    expect(CUT_OPEN_BROKEN).toMatch(/even when hands are working on it/);
  });
});

describe("the cut words leave every form a stored prompt used (withoutCutaway)", () => {
  it("a cross-section after its thing, a cut in cross-section, a cross-sectioned thing (stored films 225, 176)", () => {
    expect(withoutCutaway("a pine door frame cross section showing a shallow gap behind the board")).toBe(
      "a pine door frame showing a shallow gap behind the board"
    );
    expect(
      withoutCutaway(
        "Pine door frame cut away in cross-section, pale soft wood showing a shallow gap between the visible face board and a thicker stud set behind it, resting on a workbench."
      )
    ).toBe(
      "Pine door frame, pale soft wood showing a shallow gap between the visible face board and a thicker stud set behind it, resting on a workbench."
    );
    expect(withoutCutaway("Pot holder cross-section with old blanket padding visible between two layers")).toBe(
      "Pot holder with old blanket padding visible between two layers"
    );
    expect(withoutCutaway("a cross-section showing a long screw through the frame")).toBe(
      "a view showing a long screw through the frame"
    );
    expect(withoutCutaway("Cross-section showing the pipe behind the wall")).toBe("View showing the pipe behind the wall");
    expect(withoutCutaway("a cross-sectioned pipe on the bench")).toBe("a pipe on the bench");
  });

  it("no word that asks for a cut view is left on any stored description it reads", () => {
    for (const t of [
      "a pine door frame cross section showing a shallow gap behind the board",
      "pine door frame cross-section showing a shallow gap and thicker stud behind board",
      "Pine door frame cut away in cross-section, pale soft wood showing a shallow gap",
      "long steel screw driven through the frame into the stud behind it, cross-section view",
      "Cross-section of soft pine door frame: weathered wood layers visible",
      "a cutaway view of the pine door frame showing the gap and wooden stud behind it",
      "A cross-section or cutaway view diagram displayed in a technical illustration",
      "Stacked pieced fabric squares on a strip of batting, showing layered fabric sandwich in cross-section—pieced tops",
      S16.show,
      S16.vp,
    ])
      expect(withoutCutaway(t)).not.toMatch(/cross[- ]?section|cut-?away|cut away|x-?ray/i);
  });
});

describe("only an inside a camera cannot reach (insideView)", () => {
  it("a hidden bend or curve is a place; hidden workings and an internal curve are an inside", () => {
    for (const t of ["a robin on a branch at a hidden bend in the creek", "the hidden curve of the garden path at dusk"])
      expect(insideView(t)).toBe(false);
    for (const t of ["the clock's hidden workings", "the toilet's internal trapway curve", "a hidden chamber inside the box"])
      expect(insideView(t)).toBe(true);
  });
});

describe("a named kind's exact look never asks for a cut view (namedLookClause)", () => {
  it("the cut words go from the look; an ordinary look is carried as written", () => {
    const cut = namedLookClause({
      index: 1,
      narration: "n",
      namedLook: "door frame: a cutaway view of a pale pine door frame showing the gap and stud behind it",
    } as StoryboardScene);
    expect(cut).toContain("door frame: a view of a pale pine door frame showing the gap and stud behind it");
    expect(cut).not.toMatch(/cutaway/i);
    const plain = "churn dash block: a 3×3 block, a centre square, four triangles at the corners";
    expect(namedLookClause({ index: 2, narration: "n", namedLook: plain } as StoryboardScene)).toContain(plain);
  });
});

describe("another broken frame is not read as a cut (cutOpenFault)", () => {
  it("a board split in two, fingers see-through: other faults, never a cut-open thing", () => {
    for (const w of ["board split in two, floating above the bench", "fingers see-through where they cross the handle"])
      expect(cutOpenFault(w)).toBe(false);
  });
});

/**
 * THE BUILD STAGE (R2): a picture of the thing a video MAKES is drawn only from pictures of it at the
 * same or an EARLIER stage. Build videos open on the finished piece, and picture memory drew every
 * later step from that finished picture (stored films: 80 such pictures in 40 jobs). The cases are
 * real rows from those films; the rule is general — no stage, memory exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import {
  laterStage,
  memorySourcesFor,
  ownKeyThing,
  requiredThingsFor,
  UNFINISHED_THING,
} from "./pictureMemory";
import {
  applyContextGroups,
  applyPictureFixes,
  applyPictureJoins,
  applyPictureSplits,
  applyShotPlan,
  buildStageOf,
  fitPicturesToLines,
  groupStage,
  parsePictureFixes,
  planShotList,
} from "./shotList";
import { applySpokenLists } from "./spokenLists";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
const host = (index: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, hostPresent: true, visualPrompt: "the host", ...over }) as StoryboardScene;

const HOLDER = "charred cedar incense holder";

describe("memory: never drawn from a picture further along than this one", () => {
  it("Hank's job 268 #17: the drilling is not drawn from the finished, oiled holder", () => {
    const board = [
      pic(14, "Closeup of a charred cedar incense holder on the workbench, finished and oiled, angled to show its drilled top", {
        keyThing: HOLDER,
        buildStage: "done",
      }),
      pic(17, "hands drilling a hole into a charred cedar block on the workbench", { keyThing: HOLDER, buildStage: "making" }),
    ];
    expect(memorySourcesFor(board, board[1])).toEqual([]);
    expect(laterStage(board[0], board[1])).toBe(true);
    expect(laterStage(board[1], board[0])).toBe(false);
  });

  it("Granny Mae's job 351 #58: the round in progress is drawn from the round before, not the baby-shower blanket", () => {
    const blanket = "six-pointed star blanket";
    const board = [
      pic(1, "a woman at a baby shower holding up a flat six-pointed crocheted star blanket in zigzag color stripes", {
        keyThing: blanket,
        buildStage: "done",
      }),
      pic(57, "hands joining the first round of the star blanket with a slip stitch", { keyThing: blanket, buildStage: "making" }),
      pic(58, "hands crocheting chain three and a double crochet into the joined stitch", { keyThing: blanket, buildStage: "making" }),
    ];
    expect(memorySourcesFor(board, board[2])).toEqual([board[1]]);
  });

  it("Hank's job 398 #13: a notch in a strip is not drawn from the finished lattice; an unlabelled strip still is", () => {
    const panel = "kumiko lattice panel";
    const board = [
      pic(1, "pale pine strips laid out on the bench", { keyThing: panel }), // no stage: kept, as before
      pic(2, "a one-foot-square kumiko lattice of thin pale pine strips crossing in an even square grid", {
        keyThing: panel,
        buildStage: "done",
      }),
      pic(10, "a thin pale pine strip marked for its notches", { keyThing: panel, buildStage: "material" }),
      pic(13, "hands cutting a half-depth notch into a thin pale pine strip with a wood-handled hand saw", {
        keyThing: panel,
        buildStage: "making",
      }),
    ];
    expect(memorySourcesFor(board, board[3])).toEqual([board[0], board[2]]);
    // The raw strip is drawn from neither the finished panel nor anything partly made.
    expect(memorySourcesFor(board, board[2])).toEqual([board[0]]);
  });

  it("Ruth's job 281 #28: coiling the strip is not drawn from the finished bowl on the table", () => {
    const bowl = "coiled fabric bowl";
    const board = [
      pic(2, "a coiled fabric strip bowl with a scrappy mixed-print finish sitting on the kitchen table", {
        keyThing: bowl,
        buildStage: "done",
      }),
      pic(28, "hands zigzag stitching the strip while coiling it into a bowl shape", { keyThing: bowl, buildStage: "making" }),
    ];
    expect(memorySourcesFor(board, board[1])).toEqual([]);
  });

  it("Ruth's job 348 #24: a finished bowl filed under ANOTHER key thing is dropped too", () => {
    const board = [
      pic(19, "Finished fabric bowl coiled from clothesline cord and wrapped scrap strips", {
        keyThing: "coffee tin of squares",
        otherKeyThings: ["clothesline cord"],
        buildStage: "done",
      }),
      pic(24, "the host's hands folding a fabric strip around the coiled clothesline cord", {
        keyThing: "clothesline cord",
        buildStage: "making",
      }),
    ];
    expect(memorySourcesFor(board, board[1])).toEqual([]);
    // Without the stage the same pair is drawn as before.
    const plain = board.map(s => ({ ...s, buildStage: undefined }));
    expect(memorySourcesFor(plain, plain[1])).toEqual([plain[0]]);
  });

  it("Hank's job 258 #27: a finishing step (oil) is done, and keeps the finished holder", () => {
    const board = [
      pic(1, "the charred cedar incense holder sitting upright on the workshop bench", { keyThing: HOLDER, buildStage: "done" }),
      pic(27, "hands brushing oil onto the charred cedar incense holder", { keyThing: HOLDER, buildStage: "done" }),
    ];
    expect(memorySourcesFor(board, board[1])).toEqual([board[0]]);
  });

  it("Frederick's job 262 #30: a video that makes nothing is untouched", () => {
    const board = [
      pic(1, "a round white smoke alarm on the hallway ceiling", { keyThing: "smoke alarm" }),
      pic(30, "a hand turning over the round white smoke alarm to view its back", { keyThing: "smoke alarm" }),
    ];
    expect(memorySourcesFor(board, board[1])).toEqual([board[0]]);
  });

  it("a stage on only one side never filters", () => {
    const done = pic(1, "the finished holder on the bench", { keyThing: HOLDER, buildStage: "done" });
    const unlabelled = pic(2, "the holder on a shelf", { keyThing: HOLDER });
    expect(memorySourcesFor([done, unlabelled], unlabelled)).toEqual([done]);
    const plain = pic(1, "the holder on the bench", { keyThing: HOLDER });
    const making = pic(2, "hands drilling the block", { keyThing: HOLDER, buildStage: "making" });
    expect(memorySourcesFor([plain, making], making)).toEqual([plain]);
  });
});

describe("a step of a spoken list is the main thing, being made (Hank's job 269 #20)", () => {
  const line =
    "Square up the scrap with a couple of saw cuts, give it a quick brush, drill the hole about halfway through at a slight angle, oil it, and put a felt dot on the bottom.";
  const lists = [
    {
      sentence: 1,
      kind: "steps" as const,
      items: [
        "Square up the scrap with a couple of saw cuts",
        "give it a quick brush",
        "drill the hole about halfway through at a slight angle",
        "oil it",
        "put a felt dot on the bottom",
      ],
    },
  ];

  it("each step keeps the main thing as its own, at 'making', and is never drawn from the finished holder", () => {
    const scenes = [
      pic(1, "a coffee can of charred cedar scraps by the trash bin", { scriptText: "I kept the scraps.", keyThing: HOLDER, buildStage: "material" }),
      pic(2, "A finished charred cedar incense holder on the market table", { scriptText: "That's the winner.", keyThing: HOLDER, buildStage: "done" }),
      host(3, "Here is the whole build, start to finish."),
      pic(4, "the holder", { scriptText: line }),
      host(5, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists, { main: HOLDER });
    const steps = r.scenes.filter(s => s.listCut);
    expect(steps).toHaveLength(5);
    for (const s of steps) {
      expect(s.listKind).toBe("steps");
      expect(s.buildStage).toBe("making");
      expect(ownKeyThing(s)).toBe(HOLDER); // "oil it," names nothing, and still is the holder
    }
    const square = steps[0];
    expect(square.scriptText).toBe("Square up the scrap with a couple of saw cuts,");
    const sources = memorySourcesFor(r.scenes, square);
    expect(sources.map(s => s.showSubject)).toEqual(["a coffee can of charred cedar scraps by the trash bin"]);
    expect(sources.some(s => s.buildStage === "done")).toBe(false);
  });

  it("a planner picture already labelled keeps its stage (a finishing step it called done)", () => {
    const scenes = [
      host(1, "Here is the whole build, start to finish."),
      pic(2, "hands squaring up a cedar scrap with a saw", { scriptText: "Square up the scrap with a couple of saw cuts, give it a quick brush, drill the hole about halfway through at a slight angle,", keyThing: HOLDER, buildStage: "making" }),
      pic(3, "hands pressing a felt dot onto the bottom of the charred cedar incense holder", { scriptText: "oil it, and put a felt dot on the bottom.", keyThing: HOLDER, buildStage: "done" }),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists, { main: HOLDER });
    const felt = r.scenes.find(s => s.scriptText === "and put a felt dot on the bottom.")!;
    expect(felt.showSubject).toMatch(/felt dot/); // the planner's own picture of this step
    expect(felt.buildStage).toBe("done");
    // A step with no planner picture of its own is making.
    expect(r.scenes.find(s => s.scriptText === "oil it,")!.buildStage).toBe("making");
  });

  it("a step the planner filed under the bench or a tool is still making (job 361), keeping its key thing", () => {
    const scenes = [
      pic(1, "A finished charred cedar incense holder on the market table", { scriptText: "That's the winner.", keyThing: HOLDER, buildStage: "done" }),
      pic(24, "hands using hand saw to square a charred cedar scrap on workbench", { scriptText: "Square up the scrap with a couple of saw cuts,", keyThing: "workbench", listCut: true }),
      pic(25, "hands brushing sawdust off the squared cedar block on workbench", { scriptText: "give it a quick brush,", keyThing: "workbench", listCut: true }),
      pic(26, "hands drilling an angled hole halfway into cedar block on workbench", { scriptText: "drill the hole about halfway through at a slight angle,", keyThing: "workbench", listCut: true }),
      pic(27, "hands wiping oil onto the charred cedar block with an oil finish rag on workbench", { scriptText: "oil it,", keyThing: "oil finish rag", listCut: true }),
      pic(28, "hands pressing a small round black felt dot onto the bottom of a small brushed black charred cedar cube", { scriptText: "and put a felt dot on the bottom.", keyThing: HOLDER, listCut: true }),
      host(29, "Bye."),
    ];
    const r = applySpokenLists(scenes, lists, { main: HOLDER });
    const steps = r.scenes.filter(s => s.listCut);
    expect(steps.map(s => s.keyThing)).toEqual(["workbench", "workbench", "workbench", "oil finish rag", HOLDER]);
    expect(steps.every(s => s.buildStage === "making" && s.listKind === "steps")).toBe(true);
    // The finished holder is further along than every one of them.
    for (const s of steps) expect(memorySourcesFor(r.scenes, s)).not.toContain(r.scenes[0]);
  });

  it("a video that does not make its main thing: steps get no stage and no main thing (Scarlett's job 354)", () => {
    const scenes = [
      pic(1, "a strand of pearls on a velvet tray", { scriptText: "Here's the test.", keyThing: "pearl necklace" }),
      pic(2, "pearls by the window", { scriptText: "hold the piece up near your face by a window, and look at what it gives back." }),
      host(3, "Bye."),
    ];
    const r = applySpokenLists(
      scenes,
      [{ sentence: 1, kind: "steps" as const, items: ["hold the piece up near your face by a window", "look at what it gives back"] }],
      { main: "pearl necklace" }
    );
    const steps = r.scenes.filter(s => s.listCut);
    expect(steps).toHaveLength(2);
    for (const s of steps) {
      expect(s.buildStage).toBeUndefined();
      expect(s.keyThing).toBeUndefined(); // tagged later from its own words, as before
      expect(ownKeyThing({ ...s, keyThing: "pearl necklace" })).toBeUndefined(); // "the piece" names no necklace
    }
  });

  it("a list of things carries no stage and stays its own thing", () => {
    const scenes = [
      host(1, "Before you start the build you need a saw, a drill, and a stack of sandpaper."),
      host(2, "Bye."),
    ];
    const r = applySpokenLists(
      scenes,
      [{ sentence: 0, items: ["a saw", "a drill", "a stack of sandpaper"] }],
      { main: HOLDER }
    );
    expect(r.scenes.filter(x => x.listCut)).toHaveLength(3);
    for (const s of r.scenes.filter(x => x.listCut)) {
      expect(s.listKind).toBeUndefined();
      expect(s.buildStage).toBeUndefined();
    }
  });
});

describe("the picture check asks for the thing at its stage", () => {
  it("a making picture asks for the holder as it is now; a finished or unlabelled one by name", () => {
    const making = pic(17, "hands drilling a hole into a charred cedar block", { keyThing: HOLDER, buildStage: "making", otherKeyThings: ["workbench"] });
    expect(requiredThingsFor(making)).toEqual([`${HOLDER} ${UNFINISHED_THING}`, "workbench"]);
    expect(requiredThingsFor({ ...making, buildStage: "material" })[0]).toMatch(/not yet finished/);
    expect(requiredThingsFor({ ...making, buildStage: "done" })).toEqual([HOLDER, "workbench"]);
    expect(requiredThingsFor({ ...making, buildStage: undefined })).toEqual([HOLDER, "workbench"]);
    // A list item whose words name another thing is still held only to what is its own.
    const coasters = pic(3, "coasters", { keyThing: "small wood pieces pile", listCut: true, scriptText: "Coasters," });
    expect(requiredThingsFor(coasters)).toEqual([]);
  });
});

describe("the shot list sets the stage, and every later step carries it", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("reads only the three stage words", () => {
    expect(buildStageOf("making")).toBe("making");
    expect(buildStageOf(" Done ")).toBe("done");
    expect(buildStageOf("material")).toBe("material");
    for (const x of ["finished", "in progress", null, undefined, 3, ""]) expect(buildStageOf(x)).toBeUndefined();
  });

  it("a planned shot's stage lands on its picture; an unknown one leaves none", async () => {
    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        beats: [
          {
            beat: 1,
            hostUntil: null,
            shots: [
              { from: "Every place two", show: "hands cutting a half-depth notch into a thin pale pine strip", thing: "kumiko lattice panel", stage: "making" },
              { from: "so they lock", show: "two pine strips locked together in a cross", thing: "kumiko lattice panel", stage: "half-done" },
            ],
          },
        ],
      }),
    });
    const scenes = [
      pic(1, "old picture", {
        scriptText: "Every place two strips cross needs a notch cut halfway through each one, so they lock together flush.",
      }),
    ];
    const plans = await planShotList(scenes, { sheet: "SETTING: a garage workshop\nMAIN kumiko lattice panel: a square grid of pale pine strips" });
    expect(plans[0].shots.map(s => s.stage)).toEqual(["making", undefined]);
    const { scenes: cut } = applyShotPlan(scenes, plans);
    expect(cut.map(s => s.buildStage)).toEqual(["making", undefined]);
    expect(cut[0].keyThing).toBe("kumiko lattice panel");
  });

  it("a piece never inherits its beat's stage", () => {
    const beat = pic(1, "old picture", { scriptText: "Square it up and drill the hole.", buildStage: "done" });
    const { scenes } = applyShotPlan([beat], [{ scene: 1, shots: [{ from: "Square", show: "hands squaring a cedar scrap" }] }]);
    expect(scenes[0].buildStage).toBeUndefined();
  });

  it("the line check: its answer replaces the stage, a missing answer keeps it while the key thing stays", () => {
    const things = [{ name: HOLDER, look: "a charred cedar block with one angled hole", main: true as const }];
    const film = () => [
      pic(1, "a finished charred cedar incense holder on the bench", { scriptText: "why not drill a hole in one and see?", keyThing: HOLDER, buildStage: "done" }),
      pic(2, "the charred cedar incense holder on the bench", { scriptText: "It smoked like a chimney.", keyThing: HOLDER, buildStage: "done" }),
      pic(3, "a charred cedar block on the bench", { scriptText: "Then I sanded it.", keyThing: HOLDER, buildStage: "making" }),
    ];
    const scenes = film();
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          { id: 0, about: "drilling", shows_it: false, show: "hands drilling a hole into a charred cedar block", thing: HOLDER, stage: "making" },
          { id: 1, about: "the smoke", shows_it: false, show: "the charred cedar incense holder smoking on the bench", thing: HOLDER },
          { id: 2, about: "sanding", shows_it: false, show: "sandpaper on the bench", thing: null, stage: null },
        ],
      }),
      scenes
    );
    expect(fixes.map(f => f.stage)).toEqual(["making", undefined, null]);
    applyPictureFixes(scenes, fixes, things);
    expect(scenes.map(s => s.buildStage)).toEqual(["making", "done", undefined]);
    // A rewrite onto another key thing does not keep the old stage.
    const moved = film();
    applyPictureFixes(moved, [{ id: 0, show: "a coffee can by the trash bin" }], things);
    expect(moved[0].buildStage).toBeUndefined();
  });

  it("a split's new picture takes only its own stage; the first part keeps the line's", () => {
    const scenes = [
      pic(1, "hands drilling a hole into a charred cedar block", {
        scriptText: "I drilled the first hole the kind you see in an old temple incense burner",
        keyThing: HOLDER,
        buildStage: "making",
      }),
    ];
    const r = applyPictureSplits(scenes, [{ id: 0, split: [{ from: "the kind you see", show: "an old temple incense burner" }] }], []);
    expect(r.split).toBe(1);
    expect(r.scenes.map(s => s.buildStage)).toEqual(["making", undefined]);
  });

  it("a joined picture keeps the first's stage unless the check gives one", () => {
    const scenes = [
      pic(1, "hands squaring a cedar scrap with a saw", { scriptText: "Square up the scrap", keyThing: HOLDER, buildStage: "making" }),
      pic(2, "the bench", { scriptText: "on the bench hook.", buildStage: undefined }),
    ];
    const things = [{ name: HOLDER, look: "a charred cedar block", main: true as const }];
    const r = applyPictureJoins(scenes, [{ id: 1, join: true, show: "hands squaring a cedar scrap on a bench hook", thing: HOLDER }], things, () => 2);
    expect(r.joined).toBe(1);
    expect(r.scenes[0].buildStage).toBe("making");
  });

  it("the check reads the stage end to end", async () => {
    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        pictures: [{ id: 0, about: "drilling", shows_it: false, show: "hands drilling a hole into a charred cedar block", thing: HOLDER, stage: "making" }],
      }),
    });
    const scenes = [pic(1, "a finished charred cedar incense holder", { scriptText: "why not drill a hole in one and see?", keyThing: HOLDER, buildStage: "done" })];
    const r = await fitPicturesToLines(scenes, { keyThings: [{ name: HOLDER, look: "a block", main: true }] });
    expect(r.fixed).toBe(1);
    expect(r.scenes[0].buildStage).toBe("making");
  });

  it("a same-topic group takes the stage most of it has, the later one on a tie", () => {
    const at = (buildStage?: StoryboardScene["buildStage"]) => pic(1, "x", { buildStage });
    expect(groupStage([at("making"), at("making"), at("done")])).toBe("making");
    expect(groupStage([at("making"), at("done")])).toBe("done");
    expect(groupStage([at(), at()])).toBeUndefined();
    expect(groupStage([at(), at("material")])).toBe("material");
    const scenes = [
      pic(1, "hands coiling the strip", { keyThing: "coiled fabric bowl", buildStage: "making", humanPresent: true }),
      pic(2, "hands stitching the coil", { keyThing: "coiled fabric bowl", buildStage: "making", humanPresent: true }),
      pic(3, "the coil on the table", { keyThing: "coiled fabric bowl" }),
    ];
    applyContextGroups(scenes, [{ ids: [0, 1, 2], show: "hands coiling and stitching the strip into a bowl" }]);
    expect(scenes.map(s => s.buildStage)).toEqual(["making", "making", "making"]);
  });
});

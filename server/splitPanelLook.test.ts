/**
 * A SPLIT PANEL OF A KEY THING LOOKS LIKE THAT THING'S OTHER PICTURES (2026-10-18, job 400 scene 27).
 * The essay scroll was one tied papyrus roll at scenes 20, 28 and 34 and, in the split panel at 27
 * between them, a blank parchment on two dark rollers. The full-frame pictures carried the named
 * kind's exact look ("papyrus scroll: …"); the named-things step never reads a panel, so the panel had
 * only its own words. And a panel the operator regenerates was drawn with no memory and no written
 * look at all: those are read off the last pass over the board, and an edit reads the board back from
 * the database. The cases are real rows from stored films; the rules are general.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import { attachMemory, panelLook, panelNamedLook } from "./pictureMemory";
import { buildSplitRightScene, buildStillPrompt, withSplitMemory } from "./longformVideo";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
const split = (index: number, panel: string, over: Partial<StoryboardScene> = {}) =>
  ({
    index,
    narration: "n",
    scriptText: "n",
    hostPresent: true,
    splitVisual: panel,
    visualPrompt: "the channel's host, exactly as in their host photo, seated in a chair talking directly to the camera",
    ...over,
  }) as StoryboardScene;

// Job 400's named look, as the named-things step wrote it onto scenes 20, 28 and 34.
const PAPYRUS =
  "papyrus scroll: a long strip of pale tan-beige reed paper with faint crisscross fibre texture, rolled into a cylinder " +
  "about a forearm long, with ragged slightly darker edges and a thin brown cord tied around its middle; when partly " +
  "unrolled, rows of small faded dark-brown script run in narrow columns, soft and unreadable";
// Job 400's props list (four lines of it).
const GIDEON: KeyThing[] = [
  { name: "greeting card", look: "a small rectangular card with a plain cream envelope, no visible writing, held in one hand" },
  { name: "scroll", look: "an aged papyrus scroll, rolled and tied with a thin cord, resting on a wooden desk" },
  { name: "wooden desk", look: "a heavy carved desk with a smooth dark surface, home to the scroll and an inkwell" },
  { name: "inkwell and quill", look: "a small round glass inkwell with a dark feather quill resting against it" },
];
const SCROLL_PANEL = "An aged papyrus scroll laid flat on a wooden desk, the surface worn and darkened by age and use.";

/** Job 400 scenes 20, 27 (the split), 28 and 34 — every picture of the scroll. */
function scrollPictures(): StoryboardScene[] {
  return [
    pic(
      20,
      "an aged pale tan papyrus scroll rolled and tied with a thin brown cord, lying on a heavy carved dark wooden desk, a close-up of one detail of it filling the frame",
      { keyThing: "scroll", namedLook: PAPYRUS, pictureUrl: "https://r2.test/longform/400/still-src-20.png" }
    ),
    split(27, SCROLL_PANEL, {
      keyThing: "scroll",
      scriptText: "When a man like that sits down to write about time, I pull my chair in closer.",
    }),
    pic(
      28,
      "close-up of a partly unrolled pale tan papyrus scroll, its top rows of faded dark-brown handwriting soft and unreadable, except the title line at the top",
      { keyThing: "scroll", partOf: "scroll", namedLook: PAPYRUS, pictureText: "On the Shortness of Life" }
    ),
    pic(
      34,
      "an aged pale tan papyrus scroll unrolled open on a heavy carved dark desk, faded unreadable script in narrow columns, beside a round glass inkwell and dark feather quill",
      { keyThing: "scroll", namedLook: PAPYRUS }
    ),
  ];
}

// Job 398's named looks, as stored.
const KUMIKO =
  "kumiko lattice: a flat square grid of thin pale unfinished pine strips, each about a quarter inch wide, crossing at " +
  "right angles to make evenly spaced small square openings; at every crossing the two strips sit flush in each " +
  "other's half-depth notches, so both lie level; plain square pattern with no diagonal pieces, the strips pale and " +
  "the open squares showing the surface behind";
const SLIDING_DOOR =
  "Japanese sliding door lattice: tall sliding door panels in a light wooden frame, filled with a fine grid of thin " +
  "pale wood strips making small rectangles, with translucent white paper behind the grid so the light glows softly through";
const lattice = {
  p3: () =>
    pic(3, "a one-foot-square kumiko lattice of thin pale pine strips crossing in an even square grid, lying flat on a pale wooden workbench", {
      keyThing: "lattice panel",
      namedLook: KUMIKO,
    }),
  p9: () =>
    pic(9, "a one-foot-square kumiko lattice of thin pale pine strips in an even square grid, lying flat on a pale wooden workbench", {
      keyThing: "lattice panel",
      namedLook: KUMIKO,
    }),
  p10: () =>
    pic(10, "close view of hands pressing a thin pale pine strip into the half-depth notches of a crossing strip, building a square kumiko grid on a workbench", {
      keyThing: "lattice panel",
      namedLook: KUMIKO,
      humanPresent: true,
    }),
  p11: () =>
    pic(11, "Japanese sliding doors with a fine grid of thin pale wood strips over glowing white paper panels in a quiet room", {
      keyThing: "lattice panel",
      namedLook: SLIDING_DOOR,
    }),
  p14: () =>
    pic(14, "hands cutting a half-depth notch into a thin pale pine strip with a wood-handled hand saw, other notched strips nearby on the workbench", {
      keyThing: "lattice panel",
      namedLook: KUMIKO,
      humanPresent: true,
    }),
  split12: (over: Partial<StoryboardScene> = {}) =>
    split(12, "A plain one-foot-square grid of thin pale pine strips with flush notched joints, lying flat on a workbench.", {
      keyThing: "lattice panel",
      ...over,
    }),
};

describe("a split panel takes the named look of the thing its pictures show (panelNamedLook)", () => {
  it("job 400 scene 27: the scroll panel takes the papyrus look scenes 20 and 34 are drawn by", () => {
    const board = scrollPictures();
    expect(panelNamedLook(board, board[1])).toBe(PAPYRUS);
  });

  it("job 398 scene 12: a lattice panel takes the kumiko look its pictures carry, never the sliding doors' it is compared with", () => {
    const board = [lattice.p3(), lattice.p9(), lattice.p10(), lattice.p11(), lattice.split12(), lattice.p14()];
    expect(panelNamedLook(board, board[4])).toBe(KUMIKO);
  });

  it("keeps a panel's own look: job 398's split already carried the kumiko look", async () => {
    const board = [lattice.p3(), lattice.p9(), lattice.split12({ namedLook: KUMIKO })];
    expect(panelNamedLook(board, board[2])).toBeUndefined();
    attachMemory(board, [], []);
    const panel = await withSplitMemory(board[2], buildSplitRightScene(board[2]), 0);
    expect(panel.namedLook).toBe(KUMIKO);
  });

  it("job 398 scene 11: a picture the thing is only compared with (the sliding doors) does not count", () => {
    const board = [lattice.p11(), lattice.split12()];
    expect(panelNamedLook(board, board[1])).toBeUndefined();
  });

  it("no look when the pictures about the thing disagree", () => {
    const board = scrollPictures();
    board[3].namedLook =
      "rolled parchment scroll: a wide sheet of cream parchment wound at both ends on two dark turned wooden rollers with knobbed ends";
    expect(panelNamedLook(board, board[1])).toBeUndefined();
  });

  it("a close-up of one part does not count: its look may be the part's kind", () => {
    const board = scrollPictures();
    delete board[0].namedLook;
    delete board[3].namedLook;
    // Only scene 28, a part close-up, still carries it.
    expect(panelNamedLook(board, board[1])).toBeUndefined();
  });

  it("job 397 scene 3: the app look on the board's phone screens never reaches a panel of the board itself", () => {
    const ETSY =
      "Etsy: phone screen with a white background, a thin top bar with a small soft orange logo shape, a large square product photo filling the upper half, beneath it a few soft grey text bars and a small rounded orange button; all words small, soft and unreadable";
    const thing = "walnut and maple cutting board";
    const board = [
      pic(2, "walnut and maple cutting board leaning against garage wall", { keyThing: thing }),
      split(3, "Finished walnut and maple cutting boards leaning against the wall of a workshop garage, several boards at rest, showing the inventory as it sits.", {
        keyThing: thing,
      }),
      pic(4, "cutting board leaning against garage wall near workbench", { keyThing: thing }),
      pic(8, "cutting board shown on a phone screen as an online listing", { keyThing: thing, namedLook: ETSY, humanPresent: true }),
    ];
    expect(panelNamedLook(board, board[1])).toBeUndefined();
    // Even when the screen is the only picture of the board: a screen is the app's look.
    expect(panelNamedLook([board[1], board[3]], board[1])).toBeUndefined();
  });

  it("job 397 scene 11: a kind beside the pile (the craft fair) is not the pile's look", () => {
    const FAIR =
      "craft fair: outdoor market with rows of white pop-up canopy tents over folding tables covered in cloth, handmade goods laid out along the table edges, shoppers strolling between booths";
    const thing = "small wood pieces pile";
    const panel = split(
      11,
      "Three piles of finished wood pieces on a workshop bench, sorted by size: small coasters and ornaments on the left, mid-size boards and boxes in the centre, larger furniture pieces on the right, each pile clearly separated and visible from above.",
      { keyThing: thing }
    );
    const fair = pic(
      33,
      "a canopy-covered outdoor market table with a light tan cloth, small round maple and walnut coasters and ornaments lined up along its front edge, other white canopy booths behind",
      { keyThing: thing, namedLook: FAIR }
    );
    expect(panelNamedLook([panel, fair], panel)).toBeUndefined();
    // …and when the pile leads the words, the kind still names neither the pile nor the panel.
    const onTable = pic(35, "small wood pieces pile on a craft fair table", { keyThing: thing, namedLook: FAIR });
    expect(panelNamedLook([panel, onTable], panel)).toBeUndefined();
  });

  it("a screen panel never takes a thing's look (job 397 scene 36, without its own app look)", () => {
    const thing = "furniture pile";
    const panel = split(36, "A smartphone screen displaying a furniture listing for a wooden bookcase, resting on a workshop table.", {
      keyThing: thing,
    });
    const look = "Shaker bookcase: a tall plain maple bookcase with straight square legs, flat panels and no carving, honey-toned";
    const shelf = pic(21, "furniture pile of bookcase and side table against garage wall", { keyThing: thing, namedLook: look });
    expect(panelNamedLook([shelf, panel], panel)).toBeUndefined();
  });

  it("only a split's panel: a full-frame picture keeps what the named-things step gave it", () => {
    const board = scrollPictures();
    const fresh = pic(40, "an aged papyrus scroll on the desk", { keyThing: "scroll" });
    expect(panelNamedLook([...board, fresh], fresh)).toBeUndefined();
  });
});

describe("the panel is drawn like the b-roll of its thing (withSplitMemory)", () => {
  it("job 400 scene 27: drawn from scene 20's picture, in the papyrus look", async () => {
    const board = scrollPictures();
    attachMemory(board, [], GIDEON);
    expect(panelLook(board[1])).toBe(PAPYRUS);
    const panel = await withSplitMemory(board[1], buildSplitRightScene(board[1]), 0);
    expect(panel.memoryRefUrls).toContain("https://r2.test/longform/400/still-src-20.png");
    expect(panel.namedLook).toBe(PAPYRUS);
    const prompt = buildStillPrompt(panel, false, undefined, undefined, true);
    expect(prompt).toContain("EXACT LOOK — papyrus scroll:");
    expect(prompt).toContain("a thin brown cord tied around its middle");
    // The look is the panel's: the host take beside it is not touched.
    expect(board[1].namedLook).toBeUndefined();
  });

  it("job 400 scene 3: a panel with no picture of its thing yet is drawn by the thing's written look", async () => {
    const board = [
      pic(2, "a man standing in a narrow pharmacy aisle holding a greeting card in a plain cream envelope, shelves of cards around him", {
        keyThing: "greeting card",
        humanPresent: true,
      }),
      split(3, "A sympathy card in a plain cream envelope lying on a pharmacy counter, beside a receipt and shopping bag.", {
        keyThing: "greeting card",
        scriptText: "He is counting backward. He is sixty-four.",
      }),
    ];
    attachMemory(board, [], GIDEON);
    const panel = await withSplitMemory(board[1], buildSplitRightScene(board[1]), 0);
    expect(panel.memoryRefUrls).toBeUndefined();
    expect(panel.namedLook).toBeUndefined();
    expect(panel.keyThingLook).toBe("a small rectangular card with a plain cream envelope");
    expect(buildStillPrompt(panel, false, undefined, undefined, true)).toContain(
      "HOW THE GREETING CARD LOOKS in every picture of this video: a small rectangular card with a plain cream envelope"
    );
  });

  it("a panel regenerated on a board read back from the database gets its memory and look only once the board is attached", async () => {
    const stored = scrollPictures();
    attachMemory(stored, [], GIDEON);
    // An edit session reads the storyboard back: new objects, which no pass has seen.
    const board = JSON.parse(JSON.stringify(stored)) as StoryboardScene[];
    const before = await withSplitMemory(board[1], buildSplitRightScene(board[1]), 0);
    expect(before.memoryRefUrls).toBeUndefined();
    expect(before.namedLook).toBeUndefined();
    expect(before.keyThingLook).toBeUndefined();
    attachMemory(board, [board[1]], GIDEON);
    const after = await withSplitMemory(board[1], buildSplitRightScene(board[1]), 0);
    expect(after.memoryRefUrls).toContain("https://r2.test/longform/400/still-src-20.png");
    expect(after.namedLook).toBe(PAPYRUS);
  });

  it("every split-panel regenerate attaches its board before the panel is drawn", () => {
    const src = readFileSync(new URL("./longformVideo.ts", import.meta.url), "utf8");
    const start = src.indexOf("async function regenerateSplitRight(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    const attach = body.indexOf("attachMemory(scenes, [scene], params.keyThings)");
    expect(attach).toBeGreaterThan(0);
    expect(attach).toBeLessThan(body.indexOf("renderSplitRightClip("));
    expect(attach).toBeLessThan(body.indexOf("renderSplitRightMotionClip("));
  });
});

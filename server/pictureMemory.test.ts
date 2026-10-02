import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  attachMemory,
  MEMORY_VIEWS,
  memoryPicturesFor,
  memorySourcesFor,
  memoryViewFor,
  pictureSettled,
  tagKeyThings,
} from "./pictureMemory";
import { matchKeyThing, parseKeyThings } from "./shotList";
import { allowedTextQuestion, parseSameThingVerdict } from "./overlayTextScan";

const pic = (index: number, keyThing?: string, extra: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", visualPrompt: `picture ${index}`, keyThing, ...extra }) as StoryboardScene;

describe("picture memory: the same thing is drawn from its earlier pictures", () => {
  it("draws a later picture of a key thing from its first picture and the latest one before it", () => {
    const board = [
      pic(1, "wood stove"),
      pic(2, "woodpile"),
      pic(3, "wood stove"),
      pic(4, undefined, { hostPresent: true }),
      pic(5, "wood stove"),
    ];
    expect(memorySourcesFor(board, board[0])).toEqual([]); // the first picture IS the memory
    expect(memorySourcesFor(board, board[2])).toEqual([board[0]]);
    expect(memorySourcesFor(board, board[4])).toEqual([board[0], board[2]]);
    expect(memorySourcesFor(board, board[1])).toEqual([]);
  });

  it("draws a split's panel and the QR background from memory; a split is never a memory itself", () => {
    const board = [
      pic(1, "wood stove", { hostPresent: true, splitVisual: "the stove" }),
      pic(2, "wood stove", { qrHero: true }),
      pic(3, "wood stove"),
      pic(4, "wood stove", { hostPresent: true, splitVisual: "the finished stove" }),
      pic(5, "wood stove", { coverHero: true }),
    ];
    expect(memorySourcesFor(board, board[0])).toEqual([]); // nothing before it
    expect(memorySourcesFor(board, board[2])).toEqual([board[1]]); // the QR background is a memory
    // Hank's job 258: "that's the whole build" split draws the same holder as the pictures before it.
    expect(memorySourcesFor(board, board[3])).toEqual([board[1], board[2]]);
    expect(memorySourcesFor(board, board[4])).toEqual([]); // the book cover is the book
  });

  it("gives every memory picture its own new camera position, two in a row never the same", () => {
    const board = [pic(1, "holder"), pic(2, "holder"), pic(3, "holder"), pic(4, "can"), pic(5, "holder")];
    expect(memoryViewFor(board, board[0])).toBeUndefined(); // the memory is drawn as described
    const views = [1, 2, 4].map(i => memoryViewFor(board, board[i]));
    expect(views).toEqual([MEMORY_VIEWS[0], MEMORY_VIEWS[1], MEMORY_VIEWS[2]]);
    expect(memoryViewFor(board, board[3])).toBeUndefined(); // the can's first picture
  });

  it("tags a split panel and the QR background with the key thing they name", () => {
    const things = [{ name: "charred cedar incense holder", look: "black block", main: true as const }];
    const board = [
      pic(1, undefined, { hostPresent: true, splitVisual: "A finished charred cedar incense holder upright on the bench" }),
      pic(2, undefined, { qrHero: true, visualPrompt: "the charred cedar incense holder beside a can of oil" }),
      pic(3, undefined, { hostPresent: true }), // a plain host take is never tagged
    ];
    expect(tagKeyThings(board, things)).toBe(2);
    expect(board.map(s => s.keyThing)).toEqual(["charred cedar incense holder", "charred cedar incense holder", undefined]);
  });

  it("waits for a memory still being made, then uses it", async () => {
    const board = [pic(1, "afghan"), pic(2, "afghan")];
    attachMemory(board);
    const later = memoryPicturesFor(board[1], 5_000);
    board[0].pictureUrl = "https://r2/afghan-1.png";
    pictureSettled(board[0]);
    expect(await later).toEqual(["https://r2/afghan-1.png"]);
  });

  it("does not wait on a memory that is not being made, and gives up after the timeout", async () => {
    const done = [pic(1, "afghan", { pictureUrl: "https://r2/a.png" }), pic(2, "afghan")];
    attachMemory(done, [done[1]]);
    expect(await memoryPicturesFor(done[1], 5_000)).toEqual(["https://r2/a.png"]);

    const stuck = [pic(1, "kumiko panel"), pic(2, "kumiko panel")];
    attachMemory(stuck);
    const t = Date.now();
    expect(await memoryPicturesFor(stuck[1], 50)).toEqual([]); // drawn from words instead
    expect(Date.now() - t).toBeLessThan(2_000);
  });

  it("goes on at once when the memory's render ended without a picture", async () => {
    const board = [pic(1, "truck"), pic(2, "truck")];
    attachMemory(board);
    const later = memoryPicturesFor(board[1], 60_000);
    pictureSettled(board[0]); // failed — no pictureUrl
    expect(await later).toEqual([]);
  });
});

describe("key things from the props list", () => {
  const sheet = [
    "home: a small farmhouse living room with pine floors",
    "MAIN wood stove fire: flames behind the glass door of a black cast-iron stove",
    "woodpile: split oak stacked under the porch roof",
    "kindling box: a wooden crate of dry sticks",
  ].join("\n");

  it("reads every thing after the home line, the MAIN one marked", () => {
    expect(parseKeyThings(sheet)).toEqual([
      { name: "wood stove fire", look: "flames behind the glass door of a black cast-iron stove", main: true },
      { name: "woodpile", look: "split oak stacked under the porch roof" },
      { name: "kindling box", look: "a wooden crate of dry sticks" },
    ]);
  });

  it("has no main thing on an older list without a MAIN line", () => {
    expect(parseKeyThings("home: a workshop\nsaw: a Japanese pull saw").some(k => k.main)).toBe(false);
    expect(parseKeyThings(undefined)).toEqual([]);
  });

  it("matches the planner's name to the list, loosely", () => {
    const things = parseKeyThings(sheet);
    expect(matchKeyThing("Wood Stove Fire", things)?.name).toBe("wood stove fire");
    expect(matchKeyThing("the woodpile", things)?.name).toBe("woodpile");
    expect(matchKeyThing("MAIN wood stove fire", things)?.name).toBe("wood stove fire");
    expect(matchKeyThing("a teapot", things)).toBeNull();
  });
});

describe("is it the same thing?", () => {
  it("reads the verdict, and passes anything unreadable", () => {
    expect(parseSameThingVerdict('{"same":false,"copy":false,"what":"a different, green stove"}')).toEqual({
      same: false,
      copy: false,
      what: "a different, green stove",
    });
    expect(parseSameThingVerdict('{"same":true,"copy":false,"what":""}')).toEqual({ same: true, copy: false, what: "" });
    expect(parseSameThingVerdict("no idea")).toEqual({ same: true, copy: false, what: "" });
  });
  it("calls a near-copy of the memory picture (same spot, same framing) a copy", () => {
    // Frederick's job 257: four pictures of the alarm from one framing.
    expect(parseSameThingVerdict('{"same":true,"copy":true,"what":""}')).toEqual({
      same: true,
      copy: true,
      what: "the same framing",
    });
  });
});

describe("every key thing in a picture is remembered (Frederick's job 259: the heater changed)", () => {
  it("draws the heater from ITS first picture when the picture is linked by the mattress", () => {
    const board = [
      pic(1, "space heater"),
      pic(2, "bedroom mattress"),
      pic(3, "bedroom mattress", { otherKeyThings: ["space heater"] }),
    ];
    expect(memorySourcesFor(board, board[2])).toEqual([board[1], board[0]]);
  });
  it("tags every key thing a description names, a shorter name inside a longer one dropped", () => {
    const things = [
      { name: "space heater", look: "" },
      { name: "bedroom mattress", look: "" },
      { name: "smoke alarm", look: "", main: true as const },
      { name: "alarm", look: "" },
    ];
    const board = [pic(1, undefined, { showSubject: "a space heater close to the bedroom mattress under the smoke alarm" })];
    tagKeyThings(board, things);
    expect(board[0].keyThing).toBe("bedroom mattress");
    expect(board[0].otherKeyThings).toEqual(["space heater", "smoke alarm"]);
  });
});

describe("the checker judges allowed writing for exact spelling", () => {
  it("fails anything else readable, or the words missing or misspelled", () => {
    const q = allowedTextQuestion("PHOTOELECTRIC");
    expect(q).toMatch(/ALLOWED exactly one piece of readable writing: "PHOTOELECTRIC"/);
    expect(q).toMatch(/missing or not spelled exactly/);
  });
});

describe("a screen picture never gets an object memory (Dale's job 295)", () => {
  it("gives a screen its item's memory for the screen only, and never uses a screen as a memory", async () => {
    const { memorySourcesFor } = await import("./pictureMemory");
    const board = { index: 1, scriptText: "x", showSubject: "the walnut and maple cutting board on the bench", keyThing: "cutting board" } as any;
    const screen = { index: 2, scriptText: "y", showSubject: "a laptop screen showing the shop page with the cutting board listed", keyThing: "cutting board" } as any;
    const again = { index: 3, scriptText: "z", showSubject: "the cutting board leaning on the wall", keyThing: "cutting board" } as any;
    const scenes = [board, screen, again];
    // The screen gets the board's memory for what is ON it; it is never a memory for anything else.
    expect(memorySourcesFor(scenes, screen)).toEqual([board]);
    expect(memorySourcesFor(scenes, again)).toEqual([board]);
  });
});

describe("brand words never reach the picture prompt", () => {
  it("takes quoted and brand words out of a real-look description", async () => {
    const { scrubLegibleWriting } = await import("./longformVideo");
    const out = scrubLegibleWriting("A white page with a small orange 'Etsy' wordmark, it's tidy.");
    expect(out).not.toMatch(/Etsy/);
    expect(out).toMatch(/it's tidy/);
  });
});

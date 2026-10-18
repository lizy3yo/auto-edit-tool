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
  wordsName,
  listItemsAround,
  ownKeyThing,
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

  it("draws a list item from a key thing's memory only when the item's own words name it", () => {
    // Dale's job 397: "Smalls, about $10 to $40. Coasters, ornaments, small cutting boards." — both
    // items inherited the pile as their key thing and came back as the pile picture twice.
    const board = [
      pic(1, "walnut and maple cutting board", { scriptText: "the cutting board" }),
      pic(2, "small wood pieces pile", { scriptText: "Smalls, about $10 to $40." }),
      pic(3, "small wood pieces pile", { listCut: true, scriptText: "Coasters," }),
      pic(4, "small wood pieces pile", { listCut: true, scriptText: "ornaments," }),
      pic(5, "walnut and maple cutting board", { listCut: true, scriptText: "small cutting boards." }),
      pic(6, "quilt", { listCut: true, partOf: "quilt", scriptText: "a churn dash here," }),
    ];
    expect(memorySourcesFor(board, board[2])).toEqual([]);
    expect(memorySourcesFor(board, board[3])).toEqual([]);
    expect(memorySourcesFor(board, board[4])).toEqual([board[0]]); // its words name the board
    expect(memorySourcesFor([pic(0, "quilt"), board[5]], board[5]).length).toBe(1); // a part keeps it
    expect([2, 3, 4, 5].map(k => ownKeyThing(board[k]))).toEqual([undefined, undefined, "walnut and maple cutting board", "quilt"]);
    expect(wordsName("small cutting boards.", "small wood pieces pile")).toBe(false); // size words never match
    expect(wordsName("two boxes of matches", "matchbox")).toBe(false);
    expect(wordsName("the boxes", "cardboard box")).toBe(true);
  });

  it("names a list item's neighbours so it is told apart from them", () => {
    const board = [
      pic(1, undefined, { scriptText: "Smalls, about $10 to $40." }),
      pic(2, undefined, { listCut: true, scriptText: "Coasters," }),
      pic(3, undefined, { listCut: true, scriptText: "ornaments," }),
      pic(4, undefined, { listCut: true, scriptText: "and small cutting boards." }),
    ];
    expect(listItemsAround(board, board[0])).toBeUndefined();
    expect(listItemsAround(board, board[2])).toEqual({ own: "ornaments", others: ["Coasters", "small cutting boards"] });
    expect(listItemsAround([board[1]], board[1])).toBeUndefined(); // a lone item has nothing to differ from
  });

  it("draws the picture behind the big QR card only from pictures of nobody (job 402 scene 33)", () => {
    // The scan window's cookie packet was drawn from scene 29's — a hand passing the packet to a
    // passenger — and the hand came along under the card: a hand "held" the QR code for 19.6 s.
    const board = [
      pic(26, "cookie packet", { visualPrompt: "a sealed foil-lined paper packet of cookies on a galley tray" }),
      pic(29, "cookie packet", {
        visualPrompt:
          "Bare hands holding a small foil-lined paper packet of cookies sealed, one hand extending it toward another hand reaching to receive it at a stainless steel galley counter",
        humanPresent: true,
        otherPerson: "a flight attendant and an older passenger",
      }),
      pic(31, "cookie packet", { visualPrompt: "the cookie packet, one hand tearing it open" }),
      pic(33, "cookie packet", { qrHero: true, cta: true, stillImage: true }),
    ];
    expect(memorySourcesFor(board, board[3])).toEqual([board[0]]);
    // Every other picture keeps a hands picture as its memory, as before (hands at work are fine there).
    const cutaway = pic(34, "cookie packet");
    expect(memorySourcesFor([...board.slice(0, 3), cutaway], cutaway)).toEqual([board[0], board[2]]);
    // With only pictures in someone's hands to follow, it is drawn from its words.
    expect(memorySourcesFor([board[1], board[2], board[3]], board[3])).toEqual([]);
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
    // The first import of longformVideo in this file: ~4.5 s alone, past the 5 s default in a busy
    // parallel run of the whole suite (5.3 s once continuationViews.test.ts joined it).
  }, 30_000);
});

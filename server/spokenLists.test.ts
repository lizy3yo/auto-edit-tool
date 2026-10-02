import { describe, it, expect } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  applySpokenLists,
  findSpokenLists,
  listsByShape,
  parseSpokenLists,
  splitSentences,
  spokenListsByShape,
  validateSpokenList,
  type SpokenList,
} from "./spokenLists";

const scene = (index: number, scriptText: string, over: Partial<StoryboardScene> = {}): StoryboardScene =>
  ({ index, scriptText, narration: scriptText, showSubject: `picture ${index}`, ...over }) as StoryboardScene;
const host = (index: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
  scene(index, scriptText, { hostPresent: true, ...over });

/** The lists the shape rules find in a film's running text — what the pipeline falls back to. */
const shapeLists = (scenes: StoryboardScene[]): SpokenList[] =>
  spokenListsByShape(splitSentences(scenes.map(s => s.scriptText).join(" ")));
const rows = (scenes: StoryboardScene[]) =>
  scenes.map(s => [s.scriptText, !!s.hostPresent, !!s.listCut]);

describe("lists by sentence shape", () => {
  it("finds a list as X, Y, and Z — with its first item at the end of a clause", () => {
    expect(
      listsByShape(
        "I'm Granny Ruth, and this one's for anybody sitting at a kitchen table with a straight-stitch machine, a rotary cutter, and a mountain of scraps too pretty to throw out, wondering if all that piecing is really worth anything on a market table."
      )
    ).toEqual([["a straight-stitch machine", "a rotary cutter", "a mountain of scraps too pretty to throw out"]]);
    expect(listsByShape("a churn dash here, a bear paw there, a flying geese row across the middle, all the classic patterns stitched into one big top.")).toEqual([
      ["a churn dash here", "a bear paw there", "a flying geese row across the middle"],
    ]);
    // Any channel: no articles, any craft.
    expect(listsByShape("You need flour, sugar, and butter.")[0]).toEqual(["flour", "sugar", "butter"]);
    expect(listsByShape("standing in a garage with a saw, a drill, and a stack of sandpaper,")[0]).toEqual([
      "a saw",
      "a drill",
      "a stack of sandpaper",
    ]);
  });

  it("is not fooled by one thing being talked about, or by two things joined by a bare 'and'", () => {
    expect(listsByShape("the one that paid me best for my time came out of a coffee tin of two-inch squares.")).toEqual([]);
    expect(listsByShape("By the time the potholders and the coasters were done, that tin was packed tight.")).toEqual([]);
    expect(listsByShape("Mine was lap-sized, twelve blocks, each one a different pattern.")).toEqual([]);
    expect(listsByShape("Honestly, it sold, and I was glad.")).toEqual([]);
  });
});

describe("the double-check every list passes", () => {
  const s = "anybody sitting at a kitchen table with a straight-stitch machine, a rotary cutter, and a mountain of scraps,";
  it("keeps items that are there, in order, joined like a list", () => {
    expect(validateSpokenList(s, ["a straight-stitch machine", "a rotary cutter", "a mountain of scraps"])).toBe(true);
    expect(validateSpokenList("a churn dash here, a bear paw there", ["a churn dash", "a bear paw"])).toBe(true);
  });
  it("drops items that are not there, out of order, or not joined like a list", () => {
    expect(validateSpokenList(s, ["a rotary cutter", "a straight-stitch machine"])).toBe(false);
    expect(validateSpokenList(s, ["a sewing machine", "a rotary cutter"])).toBe(false);
    expect(validateSpokenList("By the time the potholders and the coasters were done", ["the potholders", "the coasters"])).toBe(false);
    expect(validateSpokenList(s, ["a rotary cutter"])).toBe(false);
  });
  it("reads the model's answer, whatever way it numbers the sentences", () => {
    const sentences = ["Hello there.", "Get a saw, a drill, and some glue."];
    expect(parseSpokenLists('{"lists":[{"sentence":"#1","items":["a saw","a drill","some glue"]}]}', sentences)).toEqual([
      { sentence: 1, items: ["a saw", "a drill", "some glue"] },
    ]);
    // An item the model made up drops the whole list.
    expect(parseSpokenLists('{"lists":[{"sentence":1,"items":["a saw","a hammer"]}]}', sentences)).toEqual([]);
    expect(parseSpokenLists("not json", sentences)).toBeNull();
  });
  it("falls back to the shape rules when the call fails", async () => {
    const r = await findSpokenLists("Hello there. Get a saw, a drill, and some glue.", {
      ask: async () => {
        throw new Error("down");
      },
    });
    expect(r.fromModel).toBe(false);
    expect(r.lists).toEqual([{ sentence: 1, items: ["a saw", "a drill", "some glue"] }]);
  });
});

describe("the film is cut to fit its lists", () => {
  it("Granny Ruth (job 281): the host hands over at the first item, one picture each, the rest goes on", () => {
    const scenes = [
      host(1, "Out of 10 scrap-quilting projects you can piece together,", { hostOpener: true }),
      host(2, "I'm Granny Ruth, and this one's for anybody sitting at a kitchen table with a straight-stitch machine,", { hostIntro: true }),
      scene(3, "a rotary cutter, and", { showSubject: "a rotary cutter beside the cutting mat" }),
      scene(4, "a mountain of scraps too pretty to throw out, wondering if all", { listCut: true, showSubject: "round fabric scrap bins" }),
      scene(5, "that piecing is really worth anything on a market table.", { showSubject: "quilts on a market table" }),
      host(6, "Goodbye now."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes), { hostName: "Granny Ruth", main: "fabric bowl" });
    expect(r.applied).toBe(1);
    expect(r.handed).toBe(1);
    expect(rows(r.scenes)).toEqual([
      ["Out of 10 scrap-quilting projects you can piece together,", true, false],
      ["I'm Granny Ruth, and this one's for anybody sitting at a kitchen table with", true, false],
      ["a straight-stitch machine,", false, true],
      ["a rotary cutter,", false, true],
      ["and a mountain of scraps too pretty to throw out,", false, true],
      ["wondering if all that piecing is really worth anything on a market table.", false, false],
      ["Goodbye now.", true, false],
    ]);
    // The planner's own pictures are kept where they already showed the item.
    expect(r.scenes[3].showSubject).toBe("a rotary cutter beside the cutting mat");
    expect(r.scenes[4].showSubject).toBe("round fabric scrap bins");
    expect(r.scenes[2].showSubject).toBe("a straight-stitch machine (for the fabric bowl)");
    // The words after the list keep the next picture.
    expect(r.scenes[5].showSubject).toBe("quilts on a market table");
  });

  it("Granny Ruth (job 281): 'the one' is not a list item, so it loses the mark and can join", () => {
    const scenes = [
      host(1, "Out of 10 projects you can piece together from", { hostOpener: true }),
      scene(2, "a bin of leftover fabric,", { listCut: true }),
      scene(3, "the one", { listCut: true }),
      scene(4, "that paid me best for my time came out of a coffee tin."),
      host(5, "Goodbye now."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes));
    expect(r.applied).toBe(0);
    expect(r.cleared).toBe(2);
    expect(r.scenes.filter(s => s.listCut)).toEqual([]);
  });

  it("Hank (job 275): a host line that ends in its list hands over to it", () => {
    const scenes = [
      host(1, "Out of ten projects, one paid best.", { hostOpener: true }),
      host(2, "I'm Hank Hardwood, and this one's for anybody standing in a garage with a saw, a drill, and a stack of sandpaper,", { hostIntro: true }),
      scene(3, "wondering if it is worth anything.", { showSubject: "a market table" }),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes), { hostName: "Hank Hardwood" });
    expect(rows(r.scenes)).toEqual([
      ["Out of ten projects, one paid best.", true, false],
      ["I'm Hank Hardwood, and this one's for anybody standing in a garage with", true, false],
      ["a saw,", false, true],
      ["a drill,", false, true],
      ["and a stack of sandpaper,", false, true],
      ["wondering if it is worth anything.", false, false],
      ["Bye.", true, false],
    ]);
  });

  it("Granny Mae (job 231): a list split across two beats is one list", () => {
    const scenes = [
      host(1, "Hello.", { hostOpener: true }),
      host(2, "I'm Granny Mae, and this one's for anybody sitting at a kitchen table with a hook,", { hostIntro: true }),
      scene(3, "a skein of yarn, and a stack of stitch books,", { showSubject: "yarn and books" }),
      scene(4, "wondering what sells."),
      host(5, "Bye."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes), { hostName: "Granny Mae" });
    expect(rows(r.scenes).slice(1, 6)).toEqual([
      ["I'm Granny Mae, and this one's for anybody sitting at a kitchen table with", true, false],
      ["a hook,", false, true],
      ["a skein of yarn,", false, true],
      ["and a stack of stitch books,", false, true],
      ["wondering what sells.", false, false],
    ]);
  });

  it("leaves the host the list when the host would keep too little, lose the name, or speak on", () => {
    // A host line that is ONLY the list goes to the pictures (Lance's job 311); a host line that
    // keeps a few words before it does not hand over.
    const only = [host(1, "Hi.", { hostOpener: true }), host(2, "A saw, a drill, and some sandpaper,"), scene(3, "x."), host(4, "Bye.")];
    expect(applySpokenLists(only, shapeLists(only)).applied).toBe(1);
    // A few words before the list lead the first item ("Get a saw,"), never a blink of host.
    const short = [host(1, "Hi.", { hostOpener: true }), host(2, "Get a saw, a drill, and some sandpaper,"), scene(3, "x."), host(4, "Bye.")];
    const r = applySpokenLists(short, shapeLists(short));
    expect(r.scenes.map(s => s.scriptText)).toContain("Get a saw,");
    const noName = [
      host(1, "Hi.", { hostOpener: true }),
      host(2, "I'm Hank, and you'll need a saw, a drill, and some sandpaper,", { hostIntro: true }),
      scene(3, "x."),
      host(4, "Bye."),
    ];
    // "I'm Hank, and you'll need" keeps the name: it hands over.
    expect(applySpokenLists(noName, shapeLists(noName), { hostName: "Hank" }).handed).toBe(1);
    const speaksOn = [
      host(1, "Hi.", { hostOpener: true }),
      host(2, "In my truck I keep a saw, a drill, and some sandpaper. That is all I ever carry around."),
      scene(3, "x."),
      host(4, "Bye."),
    ];
    // A host who speaks on after the list comes back for the rest (Lance's job 314).
    const on = applySpokenLists(speaksOn, shapeLists(speaksOn));
    expect(on.scenes.map(s => [s.scriptText, !!s.hostPresent])).toContainEqual(["That is all I ever carry around.", true]);
  });

  it("never re-cuts a CTA, cover or split beat", () => {
    const cta = [
      host(1, "Hi.", { hostOpener: true }),
      host(2, "The book covers pricing, packaging, and selling online.", { cta: true }),
      host(3, "Bye."),
    ];
    expect(applySpokenLists(cta, shapeLists(cta)).applied).toBe(0);
  });

  it("keeps a picture the planner already cut exactly on an item", () => {
    const scenes = [
      host(1, "Hi there, this is for anybody with", { hostOpener: true }),
      scene(2, "a saw,", { listCut: true, showSubject: "a handsaw on the bench" }),
      scene(3, "a drill,", { listCut: true, showSubject: "a cordless drill" }),
      scene(4, "and some glue.", { listCut: true, showSubject: "a bottle of wood glue" }),
      host(5, "Bye."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes));
    expect(r.scenes.map(s => s.showSubject)).toEqual([
      "picture 1",
      "a handsaw on the bench",
      "a cordless drill",
      "a bottle of wood glue",
      "picture 5",
    ]);
  });
});

describe("the opening line hands its list over too (Dale's job 292)", () => {
  it("cuts a list that starts in the film's first host line", () => {
    const scenes = [
      host(1, "The place you tried to sell it just wasn't built for that piece. Today I'm ranking Etsy,", { hostOpener: true }),
      scene(2, "craft fairs,", { listCut: true }),
      scene(3, "and Facebook Marketplace", { listCut: true }),
      scene(4, "by what each one actually does well."),
      host(5, "Bye."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes));
    expect(rows(r.scenes).slice(0, 4)).toEqual([
      ["The place you tried to sell it just wasn't built for that piece. Today I'm ranking", true, false],
      ["Etsy,", false, true],
      ["craft fairs,", false, true],
      ["and Facebook Marketplace", false, true],
    ]);
  });
  it("puts an item back when a later step folded it into the picture before", () => {
    const scenes = [
      host(1, "Hi there.", { hostOpener: true }),
      scene(2, "The place just wasn't built for it. Today I'm ranking Etsy,"),
      scene(3, "craft fairs,", { listCut: true }),
      scene(4, "and Facebook Marketplace", { listCut: true }),
      scene(5, "by what each one does well."),
      host(6, "Bye."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes));
    expect(r.scenes.map(s => s.scriptText).slice(1, 5)).toEqual([
      "The place just wasn't built for it. Today I'm ranking",
      "Etsy,",
      "craft fairs,",
      "and Facebook Marketplace",
    ]);
  });
});

describe("a list left alone says why", () => {
  it("names the reason instead of failing", () => {
    const scenes = [
      host(1, "Hi there.", { hostOpener: true }),
      host(2, "The book comes with a pattern, a needle, and a skein of yarn.", { cta: true }),
      host(3, "Bye."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes));
    expect(r.applied).toBe(0);
    expect(r.skipped.join(" ")).toMatch(/CTA/);
  });
});

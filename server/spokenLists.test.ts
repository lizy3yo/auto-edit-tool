import { describe, it, expect } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  applySpokenLists,
  findSpokenLists,
  itemsInOnePhoto,
  listsByShape,
  notInOnePhoto,
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

describe("a list item is a thing (the audit's replay of 336 jobs)", () => {
  const things = (s: string) => spokenListsByShape([s]).filter(l => l.kind !== "steps").map(l => l.items);

  it("finds no list where the items name nothing — the false lists that were cut", () => {
    for (const s of [
      "One, two, three, four, all the way up to twelve.", // job 351
      "Round three, three a side, round ten, ten a side, and round twenty, twenty.",
      "Trouble is, the star looks fine right afterward, and the round after that too.",
      "The rounds get long out past the middle, and if yours takes a few weeks of evenings, or a couple of months, that still counts.",
      "Mostly four, six, and eight inch widths.", // job 352
      "A whole lot of folks wonder if that's rude, or nosy, or some kind of jealousy thing.", // job 357
      "Hit subscribe and make Backyard Brenda your neighbor over the fence for thrifty, old-fashioned chicken keeping, and tell me in the comments which leak your girls are guilty of.", // job 355
      "Hello, friend, and welcome to Pearl Parker.", // job 220
      "The word lives in your head and theirs, and nowhere else.", // job 322
      "It runs six, six and a half hours, give or take, start to finish.", // the audit's own phrases
      "It's cheap, simple, quick and quiet.",
      "It looks clean, bright, and calm.",
    ])
      expect([s, things(s)]).toEqual([s, []]);
  });

  it("documented change: a list with one item that is not a thing goes whole (job 11)", () => {
    // "five minutes" is not a thing, and the two things left are not joined like a list.
    expect(things("Two slip nuts, one bucket, five minutes, and that is where nearly every kitchen clog actually lives.")).toEqual([]);
  });

  it("leaves lists of things exactly as they were", () => {
    // Job 352 (the model's answer, with "small tables", is kept below).
    expect(
      things("Drawer fronts, boxes, frame parts, shelf brackets, legs, and small tables all come out of short stock, and a knot you'd cut around anyway costs you nothing.")
    ).toEqual([["Drawer fronts", "boxes", "frame parts", "shelf brackets", "legs"]]);
    expect(things("Wash, towel, dryer, brush, every single morning.")).toEqual([["Wash", "towel", "dryer", "brush"]]); // job 222
    expect(
      things("A feed sack, a curtain that came down years ago, the good half of a canvas drop cloth, any of those will do, and all of them are already yours.")
    ).toEqual([["A feed sack", "a curtain that came down years ago", "the good half of a canvas drop cloth"]]); // job 106
    // Jobs 159/174/178: three real making stages, not describing words.
    expect(
      things("A coaster mat is a tiny quilted square about four inches across, pieced from a few scraps, quilted, and bound, and one bin of leftovers gives you enough for a dozen sets.")
    ).toEqual([["scraps", "quilted", "bound"]]);
    // A trailing "too" is not what is named — and the item stays as spoken, so the cut keeps its word.
    expect(things("Get a saw, a drill, and some glue too.")).toEqual([["a saw", "a drill", "some glue too"]]);
    // "be" after a THING is followed by things; only a pronoun's "it's" or a word like "looks" describes.
    expect(things("The woods I use are oak, maple, and cherry.")).toEqual([["oak", "maple", "cherry"]]);
    expect(things("You'll want a penny, a nickel, a dime, and a quarter.")).toEqual([["a penny", "a nickel", "a dime", "a quarter"]]);
  });

  it("a sequence of steps is not asked to be things (job 351)", () => {
    expect(spokenListsByShape(["Down the side, skip the two at the bottom, back up, and add at the tip."])).toEqual([
      { sentence: 0, items: ["Down the side", "skip the two at the bottom", "back up", "add at the tip"], kind: "steps" },
    ]);
  });

  it("drops the model's list of things when an item names nothing (jobs 362, 392, 400)", () => {
    const gold =
      "That thin line of gold puts a moving highlight right under your chin, and the eye reads light near the face as health, as rest, as a good night's sleep you may or may not have had.";
    const answer = (items: string[], kind = "things") => JSON.stringify({ lists: [{ sentence: 0, kind, items }] });
    expect(parseSpokenLists(answer(["as health", "as rest", "as a good night's sleep you may or may not have had"]), [gold])).toEqual([]);
    expect(parseSpokenLists(answer(["health", "as rest", "as a good night's sleep you may or may not have had"]), [gold])).toEqual([]);
    const essay =
      "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus, the official in charge of Rome’s grain supply — busy, important, and worn down to the rims.";
    expect(parseSpokenLists(answer(["Two thousand years ago", "a man named Lucius Annaeus Seneca wrote a short", "furious"]), [essay])).toEqual([]);
    // Documented change (job 359): a topic list whose item opens on "when" goes too.
    expect(parseSpokenLists(answer(["Detectors", "where they go", "when to retire one"]), ["Detectors, where they go, and when to retire one."])).toEqual([]);
  });

  it("keeps the model's lists of things and of steps as they were", () => {
    const keep = (sentence: string, items: string[], kind = "things") =>
      expect(parseSpokenLists(JSON.stringify({ lists: [{ sentence: 0, kind, items }] }), [sentence])).toEqual([
        { sentence: 0, items, ...(kind === "steps" ? { kind } : {}) },
      ]);
    keep("Ivory, oat, a warm coral, mother of pearl.", ["Ivory", "oat", "a warm coral", "mother of pearl"]); // job 362
    keep(
      "Drawer fronts, boxes, frame parts, shelf brackets, legs, and small tables all come out of short stock, and a knot you'd cut around anyway costs you nothing.",
      ["Drawer fronts", "boxes", "frame parts", "shelf brackets", "legs", "small tables"]
    ); // job 352
    keep("But a good chunk gets flicked into the dirt, carried off by a rat after dark, or shared with every sparrow on the block.", [
      "flicked into the dirt",
      "carried off by a rat after dark",
      "shared with every sparrow on the block",
    ]); // job 355
    keep("Smalls to the markets, personalized work on Etsy, furniture on Marketplace.", [
      "Smalls to the markets",
      "personalized work on Etsy",
      "furniture on Marketplace",
    ]); // job 293 and 24 more
    keep("Square up the scrap with a couple of saw cuts, give it a quick brush, drill the hole, oil it, and put a felt dot on the bottom.", [
      "Square up the scrap with a couple of saw cuts",
      "give it a quick brush",
      "drill the hole",
      "oil it",
      "put a felt dot on the bottom",
    ], "steps"); // job 326
    // Lists of things whose items open on a quantity word or end in a clause with no "that": the
    // shape rules cannot rebuild either, so refusing one item would lose every picture.
    keep("Grab a tape measure, a pencil, and all the scraps you can find.", ["a tape measure", "a pencil", "all the scraps you can find"]);
    keep("You need the quilt, the pattern, and the box it came in.", ["the quilt", "the pattern", "the box it came in"]);
  });

  it("a refused model list leaves the sentence to the shape rules, which still find the real list", async () => {
    const r = await findSpokenLists("Number two. The daily blow dry. Wash, towel, dryer, brush, every single morning.", {
      ask: async () => '{"lists":[{"sentence":2,"items":["Wash","towel","dryer","brush","every single morning"]}]}',
    });
    expect(r.fromModel).toBe(true);
    expect(r.lists).toEqual([{ sentence: 2, items: ["Wash", "towel", "dryer", "brush"] }]);
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

describe("the bridge's group picture only when one photograph can hold the list (job 400 at 1:11, the review)", () => {
  // Job 400 asked for "money, grief, difficult people and what the remaining years are actually for
  // together, laid out side by side" and got paper cut-outs on a kitchen table.
  it("refuses items no photograph can lay beside other things — every real case of jobs 397, 399 and 400", () => {
    const refused = [
      // job 400
      "grief", "difficult people", "what the remaining years are actually for", "time", "legacy",
      "people", "the real struggle", "the principle underneath it", "some ordinary place", "a waiting room",
      // job 399
      "what's left in the galley", "who to say them to", "the moment in the trip when they work",
      // job 397
      "old shop habits", "craft fairs",
      // a last word that can be a preposition is still the head; a closing "too" is not
      "the past", "some grief too",
    ];
    for (const item of refused) expect(notInOnePhoto(item), item).not.toBeNull();
    expect(notInOnePhoto("what the remaining years are actually for")).toBe("a question or a clause");
    expect(notInOnePhoto("difficult people")).toBe("a person");
    expect(notInOnePhoto("loneliness")).toBe("an idea or a quality");
    expect(notInOnePhoto("childhood")).toBe("an idea or a quality");
  });

  it("keeps every real list of things a thing, by its head word, not its describing words", () => {
    const kept = [
      // Ruth's job 281, Hank's job 398, Mae's job 231, Lance's job 311
      "a straight-stitch machine", "a rotary cutter", "and a mountain of scraps too pretty to throw out",
      "a saw", "a drill", "and a stack of sandpaper", "a hook", "a skein of yarn", "a stack of stitch books",
      "a bin in the hall closet", "a bag in the garage", "maybe a box under the bed",
      // Helena's job 399, Dale's job 397
      "the whole can of ginger ale", "a second bag of pretzels", "and a bottle of water for later",
      "Coasters", "ornaments", "small cutting boards", "Engraved boards", "house signs", "keepsake boxes",
      "a fair pile of my own spoiled boards",
      // any channel
      "flour", "sugar", "and butter", "a tape measure", "a pencil", "and all the scraps you can find",
      "money", "a church pew", "a kitchen table", "a garden hose", "a harness", "a hood", "a remote control",
    ];
    for (const item of kept) expect(notInOnePhoto(item), item).toBeNull();
  });

  it("a list of steps is never one group picture; a list of things is when every item passes", () => {
    expect(itemsInOnePhoto(["a saw", "a drill", "a stack of sandpaper"])).toBe(true);
    expect(itemsInOnePhoto(["a saw", "a drill", "a stack of sandpaper"], "steps")).toBe(false);
    expect(itemsInOnePhoto(["money", "grief", "difficult people", "what the remaining years are actually for"])).toBe(false);
    expect(itemsInOnePhoto([])).toBe(false);
  });

  it("a bridge into steps stays an ordinary picture (Hank's job 326 steps)", () => {
    const steps = [
      "Square up the scrap with a couple of saw cuts",
      "give it a quick brush",
      "drill the hole",
      "oil it",
      "put a felt dot on the bottom",
    ];
    const scenes = [
      host(1, "Here is the whole build, and it takes one evening."),
      scene(2, "and once the cedar is charred you just", { showSubject: "a charred cedar scrap on the bench" }),
      scene(3, "Square up the scrap with a couple of saw cuts, give it a quick brush, drill the hole, oil it, and put a felt dot on the bottom."),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(scenes, [{ sentence: 1, items: steps, kind: "steps" }]);
    expect(r.applied).toBe(1);
    expect(r.scenes.some(s => s.listSet)).toBe(false);
    const bridge = r.scenes.find(s => s.scriptText === "and once the cedar is charred you just")!;
    expect(bridge.showSubject).toBe("a charred cedar scrap on the bench");
    expect(r.apart).toEqual(['"and once the cedar is charred…": a list of steps']);
  });
});

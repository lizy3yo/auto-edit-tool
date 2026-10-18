import { describe, it, expect } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  applySpokenLists,
  endsEarly,
  findSpokenLists,
  itemBeforeClause,
  itemsInOnePhoto,
  joinChoiceSteps,
  listsByShape,
  notAListAsSaid,
  notInOnePhoto,
  parseSpokenLists,
  splitSentences,
  spokenListsByShape,
  stepsByShape,
  validateSpokenList,
  withLastItemCut,
  withLastSeriesMember,
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

  it("Sawdust Sam (job 407): an introduction by one word of the name hands its list over after the name", () => {
    // Matched as the whole name only, "I am Sam" never said "Sawdust Sam", so the list stayed on the host.
    const scenes = [
      host(1, "Hello.", { hostOpener: true }),
      host(2, "I am Sam, and this one is for anybody standing at a chopping block with an axe, a froe, and a drawknife,", {
        hostIntro: true,
      }),
      scene(3, "wondering how the cabin got built."),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes), { hostName: "Sawdust Sam" });
    expect(r.handed).toBe(1);
    expect(rows(r.scenes).slice(1, 5)).toEqual([
      ["I am Sam, and this one is for anybody standing at a chopping block with", true, false],
      ["an axe,", false, true],
      ["a froe,", false, true],
      ["and a drawknife,", false, true],
    ]);
    // A list that comes before the name still stays with the host.
    const before = [
      host(1, "Hello.", { hostOpener: true }),
      host(2, "With an axe, a froe, and a drawknife, I am Sam, and I build cabins.", { hostIntro: true }),
      scene(3, "x."),
      host(4, "Bye."),
    ];
    const kept = applySpokenLists(before, shapeLists(before), { hostName: "Sawdust Sam" });
    expect(kept.handed).toBe(0);
    expect(kept.skipped.join(" ")).toContain("would take the host's name off the introduction");
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

describe("a step offered as a choice is part of the step before it (A6, Helena's job 399)", () => {
  // Job 399's sentence 32. Stepping back to the galley is another way to reach the crew, not a step done
  // after catching one; the film's step graphic chained it as step 3 of 4.
  const ask399 =
    "So wait until everyone's been served, then catch a flight attendant as they pass, or step back to the galley, and phrase it as an offer.";
  const steps = (sentence: string, items: string[]) =>
    parseSpokenLists(JSON.stringify({ lists: [{ sentence: 0, kind: "steps", items }] }), [sentence]);
  const joined = ["wait until everyone's been served", "catch a flight attendant as they pass, or step back to the galley", "phrase it as an offer"];

  it("the model's four steps become three: the choice joins the step before it, in the sentence's own words", () => {
    // the model leaves the joining "or" out of its items, or keeps it
    expect(steps(ask399, ["wait until everyone's been served", "catch a flight attendant as they pass", "step back to the galley", "phrase it as an offer"])).toEqual([
      { sentence: 0, items: joined, kind: "steps" },
    ]);
    expect(steps(ask399, ["wait until everyone's been served", "catch a flight attendant as they pass", "or step back to the galley", "phrase it as an offer"])).toEqual([
      { sentence: 0, items: joined, kind: "steps" },
    ]);
    // the joined step is 13 words — each way is held to the item limit, not the two together
    expect(joinChoiceSteps("Rinse it, scrub it, alternatively soak it overnight, then dry it.", ["Rinse it", "scrub it", "soak it overnight", "dry it"])).toEqual([
      "Rinse it",
      "scrub it, alternatively soak it overnight",
      "dry it",
    ]);
  });

  it("by sentence shape, a choice piece joins its step instead of sinking the sentence", () => {
    // the real sentence opens on "So", which the shape rules never take as a step — as before
    expect(stepsByShape(ask399)).toBeNull();
    expect(stepsByShape(ask399.replace(/^So w/, "W"))).toEqual(["Wait until everyone's been served", joined[1], "phrase it as an offer"]);
    expect(spokenListsByShape(["Rinse the jar, dry it, or leave it on the rack, and fill it to the top."])).toEqual([
      { sentence: 0, items: ["Rinse the jar", "dry it, or leave it on the rack", "fill it to the top"], kind: "steps" },
    ]);
  });

  it("a choice step's picture shows its first way: a picture draws one thing, never 'X or Y'", () => {
    const found = steps(ask399, ["wait until everyone's been served", "catch a flight attendant as they pass", "step back to the galley", "phrase it as an offer"])!;
    const scenes = [
      scene(24, "Ask while the cart is still working its way back, and you're asking the crew to guess whether the last few rows will come up short."),
      host(25, "So wait until everyone's been served, then catch a flight attendant as they pass,"),
      scene(26, "or step back to the galley, and phrase it as an offer."),
      host(27, "Two asks in, you might wonder how anyone keeps this straight."),
    ];
    const r = applySpokenLists(scenes, found);
    const made = r.scenes.filter(s => s.listCut);
    expect(made.map(s => s.scriptText)).toEqual([
      "So wait until everyone's been served,",
      "then catch a flight attendant as they pass, or step back to the galley,",
      "and phrase it as an offer.",
    ]);
    expect(made[1].showSubject).toBe("the host's hands, mid-step: catch a flight attendant as they pass");
  });

  it("real step lists with an 'or' INSIDE a step are kept exactly as they were (jobs 351, 354-395, 399)", () => {
    for (const [sentence, items] of [
      ["It means getting the fabric damp or warm, pinning it into shape, and letting it dry that way so it remembers.", ["getting the fabric damp or warm", "pinning it into shape", "letting it dry that way so it remembers"]], // 351
      ["Lift your phone, point the camera at that square, and hold it steady for a second or two.", ["Lift your phone", "point the camera at that square", "hold it steady for a second or two"]], // 354…395
      // the first step after a sentence-opening "Or" is not joined to anything: the steps are still done in order
      ["Or look underneath this video, open the description, and tap the link at the top.", ["look underneath this video", "open the description", "tap the link at the top"]], // 399
    ] as [string, string[]][])
      expect(steps(sentence, items)).toEqual([{ sentence: 0, items, kind: "steps" }]);
    // a list of THINGS keeps its "or": three things to show (job 355)
    const sparrow = "But a good chunk gets flicked into the dirt, carried off by a rat after dark, or shared with every sparrow on the block.";
    const things = ["flicked into the dirt", "carried off by a rat after dark", "shared with every sparrow on the block"];
    expect(parseSpokenLists(JSON.stringify({ lists: [{ sentence: 0, kind: "things", items: things }] }), [sparrow])).toEqual([{ sentence: 0, items: things }]);
  });

  it("two ways of doing one thing are no sequence of steps; a subject in a contraction is no step", () => {
    expect(steps("Call the office, or send an email.", ["Call the office", "send an email"])).toEqual([]);
    // the "or" piece used to sink this sentence; joined, its "and you'll know" must still not be a step
    expect(stepsByShape("Pick one up, look it over, or ask the seller, and you'll know.")).toBeNull();
    expect(stepsByShape("Pick one up, look it over, or ask the seller, and I'll explain the rest.")).toBeNull();
  });

  it("only an 'or' that leads into the step makes it a choice; one the model left off the step before does not", () => {
    // said right before the step, "or else", or opening the comma piece ("…, or you can step back"): a choice
    const ask = (lead: string) => ask399.replace(", or step back", lead);
    const ways = ["wait until everyone's been served", "catch a flight attendant as they pass", "step back to the galley", "phrase it as an offer"];
    expect(steps(ask(", or else step back"), ways)?.[0].items[1]).toBe("catch a flight attendant as they pass, or else step back to the galley");
    expect(steps(ask(", or you can step back"), ways)?.[0].items[1]).toBe("catch a flight attendant as they pass, or you can step back to the galley");
    // the gap may hold words the model trimmed off a real step ("or two", "or so"): those steps stay apart
    expect(steps("Let it sit a minute or two, then wipe it off, and buff it dry.", ["let it sit a minute", "wipe it off", "buff it dry"])).toEqual([
      { sentence: 0, items: ["let it sit a minute", "wipe it off", "buff it dry"], kind: "steps" },
    ]);
    expect(joinChoiceSteps("Sand it for an hour or so, then wipe it down, and oil it.", ["Sand it for an hour", "wipe it down", "oil it"])).toEqual([
      "Sand it for an hour",
      "wipe it down",
      "oil it",
    ]);
  });
});

describe("a general head before its examples is never an item (job 400 at 0:47)", () => {
  // The list graphic read "1 Some ordinary place / 2 A waiting room / 3 A church pew", and the head
  // got a picture of its own (a woman at a sink): three places, introduced, read as four.
  const LINE =
    "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet.";
  const answer = (items: string[]) => JSON.stringify({ lists: [{ sentence: 0, kind: "things", items }] });

  // Since job 401 the third place, which runs on into "when the house is too quiet", is an item too.
  const PLACES = ["a waiting room", "a church pew", "the kitchen table at two in the morning"];

  it("the shape rules list the examples, not the head that ends the clause before them", () => {
    expect(listsByShape(LINE)).toEqual([PLACES]);
    expect(spokenListsByShape([LINE])).toEqual([{ sentence: 0, items: PLACES }]);
    // Any wording: a head that opens the sentence, an indefinite pronoun, a "certain kind of".
    expect(listsByShape("Some quiet spot, a porch swing, a park bench, and the front seat of a parked car.")).toEqual([
      ["a porch swing", "a park bench", "the front seat of a parked car"],
    ]);
    expect(listsByShape("I looked everywhere, the attic, the barn, the truck.")).toEqual([["the attic", "the barn", "the truck"]]);
    // The head's last word is never the first of a bare list either ("…kind of WOOD, oak, …").
    expect(listsByShape("You want a certain kind of wood, oak, walnut, and cherry.")).toEqual([["oak", "walnut", "cherry"]]);
  });

  it("leaves a list whose first item is a real thing exactly as it was", () => {
    // Job 110: the porch is item 1 — "anybody" is who it is for, not a head of porches.
    expect(
      listsByShape(
        "Two pickets and a handful of screws come to about $11, it takes 50 minutes counting the burning and brushing, and they go for $38 to $60 to anybody with a porch, a patio, or a houseplant habit."
      )
    ).toEqual([["a porch", "a patio", "a houseplant habit"]]);
    expect(listsByShape("You'll need some glue, a clamp, and a rag.")).toEqual([["some glue", "a clamp", "a rag"]]);
    expect(listsByShape("You need some kind of glue, a clamp, and a rag.")).toEqual([["some kind of glue", "a clamp", "a rag"]]);
    expect(listsByShape("Get some scrap pine, a saw, and a drill.")).toEqual([["some scrap pine", "a saw", "a drill"]]);
  });

  it("the model's head is dropped, never the list; a head with one example is no list", () => {
    expect(parseSpokenLists(answer(["some ordinary place", "a waiting room", "a church pew", "the kitchen table at two in the morning"]), [LINE])).toEqual([
      { sentence: 0, items: ["a waiting room", "a church pew", "the kitchen table at two in the morning"] },
    ]);
    expect(parseSpokenLists(answer(["some ordinary place", "a waiting room"]), [LINE])).toEqual([]);
    // A head that names nothing no longer costs the whole list (`notAThing` refuses "anything").
    expect(parseSpokenLists(answer(["anything", "a mouse", "a snake", "a raccoon"]), ["If you hear anything, a mouse, a snake, a raccoon, check the coop."])).toEqual([
      { sentence: 0, items: ["a mouse", "a snake", "a raccoon"] },
    ]);
    // Heads one after another are the list itself.
    const treats = ["Something sweet", "something salty", "something to drink"];
    expect(parseSpokenLists(answer(treats), ["Bring something sweet, something salty, and something to drink."])).toEqual([
      { sentence: 0, items: treats },
    ]);
    expect(validateSpokenList(LINE, ["some ordinary place", "a waiting room", "a church pew"])).toBe(false);
    expect(validateSpokenList(LINE, ["a waiting room", "a church pew"])).toBe(true);
  });

  const film = () => [
    scene(1, "Seventeen. He pays, he walks out to the parking lot, and the number rides home with him in the passenger seat."),
    scene(2, "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew,", {
      showSubject: "an older man sitting alone on a grey padded chair against a pale wall",
    }),
    scene(3, "the kitchen table at two in the morning when the house is too quiet.", { showSubject: "a kitchen table at night" }),
    host(4, "And the math always presents itself as the problem."),
  ];
  // `table`: whether the list holds the third place (found today, job 401; job 400 saved only two).
  const cut = (table: boolean) => [
    ["Seventeen. He pays, he walks out to the parking lot, and the number rides home with him in the passenger seat.", false, false],
    ["Most people past sixty have — usually in silence, usually in some ordinary place,", false, false],
    ["a waiting room,", false, true],
    ["a church pew,", false, true],
    ["the kitchen table at two in the morning when the house is too quiet.", false, table],
    ["And the math always presents itself as the problem.", true, false],
  ];

  it("the film is cut on the examples: the head's words stay with their beat", () => {
    const r = applySpokenLists(film(), shapeLists(film()));
    expect(r.applied).toBe(1);
    expect(rows(r.scenes)).toEqual(cut(true));
    expect(r.scenes[1].showSubject).toBe("an older man sitting alone on a grey padded chair against a pale wall");
  });

  it("a list saved before the rule, head and all, is cut the same way on a resume", () => {
    const saved: SpokenList[] = [{ sentence: 2, items: ["some ordinary place", "a waiting room", "a church pew"] }];
    expect(rows(applySpokenLists(film(), saved).scenes)).toEqual(cut(false));
  });

  it("a head the planner cut as a picture of its own leads the first example's picture instead", () => {
    const scenes = [
      scene(1, "Most people past sixty have — usually in silence, usually in"),
      scene(2, "some ordinary place,", { listCut: true, showSubject: "an older woman at a sink by a window" }),
      scene(3, "a waiting room,", { listCut: true, showSubject: "a row of grey padded waiting room chairs" }),
      scene(4, "a church pew,", { listCut: true }),
      scene(5, "the kitchen table at two in the morning when the house is too quiet."),
      host(6, "Bye."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes));
    expect(r.cleared).toBe(1);
    expect(rows(r.scenes).map(([t, , l]) => [t, l])).toEqual([
      ["Most people past sixty have — usually in silence, usually in", false],
      ["some ordinary place, a waiting room,", true],
      ["a church pew,", true],
      ["the kitchen table at two in the morning when the house is too quiet.", true],
      ["Bye.", false],
    ]);
    expect(r.scenes[1].showSubject).toBe("a row of grey padded waiting room chairs");
    expect(r.scenes.some(s => /sink/.test(s.showSubject ?? ""))).toBe(false);
  });

  // Job 400 as it was cut: the host line before the list (scene 7, later a split), then the head the
  // planner cut on its own (scene 8, "an older woman at a sink"), then the examples.
  const job400 = () => [
    host(7, "Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in"),
    scene(8, "some ordinary place,", { listCut: true, showSubject: "an older woman standing alone at a sink by a window" }),
    scene(9, "a waiting room,", { listCut: true, showSubject: "a row of grey padded waiting room chairs against a pale wall" }),
    scene(10, "a church pew,", { listCut: true, showSubject: "a long empty dark polished wooden church pew" }),
    scene(11, "the kitchen table at two in the morning when the house is too quiet.", { showSubject: "a wooden kitchen table at night" }),
    host(12, "And the math always presents itself as the problem."),
  ];

  it("right after the host, the head is never the bridge's picture of the examples 'together'", () => {
    const saved: SpokenList[] = [{ sentence: 1, items: ["some ordinary place", "a waiting room", "a church pew"] }];
    for (const lists of [saved, shapeLists(job400())]) {
      const r = applySpokenLists(job400(), lists);
      // Before: scene 8 became "a waiting room and a church pew together, laid out side by side".
      expect(r.scenes.some(s => s.listSet)).toBe(false);
      expect(rows(r.scenes)).toEqual([
        ["Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in", true, false],
        ["some ordinary place, a waiting room,", false, true],
        ["a church pew,", false, true],
        // The shape rules find the third place too (job 401); the list job 400 saved has two.
        ["the kitchen table at two in the morning when the house is too quiet.", false, lists !== saved],
        ["And the math always presents itself as the problem.", true, false],
      ]);
      expect(r.scenes[1].showSubject).toBe("a row of grey padded waiting room chairs against a pale wall");
      // The pass on the final lengths changes nothing more.
      const again = applySpokenLists(r.scenes, lists);
      expect(rows(again.scenes)).toEqual(rows(r.scenes));
      expect(again.scenes.some(s => s.listSet)).toBe(false);
    }
  });

  it("a head that opens the beat after the host leads its first example too; a longer lead-in keeps its own picture", () => {
    const opens = [
      host(1, "Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in"),
      scene(2, "some ordinary place, a waiting room, a church pew,", { showSubject: "an older man alone on a grey chair" }),
      scene(3, "the kitchen table at two in the morning when the house is too quiet."),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(opens, shapeLists(opens));
    expect(r.scenes.some(s => s.listSet)).toBe(false);
    expect(rows(r.scenes).slice(1, 3)).toEqual([
      ["some ordinary place, a waiting room,", false, true],
      ["a church pew,", false, true],
    ]);
    const longer = [
      host(1, "Maybe you have done that arithmetic."),
      scene(2, "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew,", {
        showSubject: "an older man alone on a grey chair",
      }),
      scene(3, "the kitchen table at two in the morning when the house is too quiet."),
      host(4, "Bye."),
    ];
    const l = applySpokenLists(longer, shapeLists(longer));
    expect(l.scenes.some(s => s.listSet)).toBe(false);
    expect(rows(l.scenes).slice(1, 4)).toEqual([
      ["Most people past sixty have — usually in silence, usually in some ordinary place,", false, false],
      ["a waiting room,", false, true],
      ["a church pew,", false, true],
    ]);
    expect(l.scenes[1].showSubject).toBe("an older man alone on a grey chair");
  });

  it("a picture before a list that is not a head, or a head that IS the first item, keeps its own beat", () => {
    // "some glue," is a thing, and the list's own first item here: never folded into the next one.
    const glue = [
      host(1, "Here is the whole kit."),
      scene(2, "some glue,", { showSubject: "a bottle of glue" }),
      scene(3, "a clamp,", { showSubject: "a clamp" }),
      scene(4, "and a rag.", { showSubject: "a rag" }),
      host(5, "Bye."),
    ];
    expect(rows(applySpokenLists(glue, shapeLists(glue)).scenes).map(([t]) => t)).toEqual([
      "Here is the whole kit.",
      "some glue,",
      "a clamp,",
      "and a rag.",
      "Bye.",
    ]);
    // Heads one after another are the list: "Something sweet," is its item 1, never a lead-in.
    const treats = [
      host(1, "Bring three things."),
      scene(2, "Something sweet,"),
      scene(3, "something salty,"),
      scene(4, "and something to drink."),
      host(5, "Bye."),
    ];
    const lists: SpokenList[] = [{ sentence: 1, items: ["Something sweet", "something salty", "something to drink"] }];
    expect(rows(applySpokenLists(treats, lists).scenes).map(([t, , l]) => [t, l])).toEqual([
      ["Bring three things.", false],
      ["Something sweet,", true],
      ["something salty,", true],
      ["and something to drink.", true],
      ["Bye.", false],
    ]);
    // …even when an answer left it out: a head before a head is no lead-in.
    const partial: SpokenList[] = [{ sentence: 1, items: ["something salty", "something to drink"] }];
    expect(rows(applySpokenLists(treats, partial).scenes).map(([t]) => t)).toEqual([
      "Bring three things.",
      "Something sweet,",
      "something salty,",
      "and something to drink.",
      "Bye.",
    ]);
  });
});

describe("a list graphic is a list the narrator says (round 10 graphics review, 2026-10-18)", () => {
  // Gideon's job 400 (1:41): the planner's own ListWindow "Seneca's essay" numbered pieces of one
  // sentence — a time, a broken clause and describing words.
  const seneca =
    "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus, the official in charge of Rome’s grain supply — busy, important, and worn down to the rims.";
  const whoHeWas =
    "Seneca was no monk on a hillside. He was one of the richest men in the empire, an advisor standing one step from the throne, buried under exactly the kind of obligations we are about to talk about — and a man who, years later, would be ordered to end his own life by the very emperor he had served.";

  it("job 400's 'Seneca's essay' rows are refused for the time row; the stored list it came from is too", () => {
    expect(notAListAsSaid(seneca, ["Two thousand years ago", "wrote a short", "furious", "loving essay"])).toBe(
      'row 1 ("Two thousand years ago") names no thing (a length of time)'
    );
    expect(notAListAsSaid(seneca, ["Two thousand years ago", "a man named Lucius Annaeus Seneca wrote a short", "furious"])).toMatch(/^row 1 .*a length of time/);
  });

  it("rows of one sentence that are not said one after another as a list are refused", () => {
    // the two men of job 400's sentence are 7 words apart: not a list
    expect(notAListAsSaid(seneca, ["a man named Lucius Annaeus Seneca", "a man named Paulinus"])).toMatch(/^"a man named Lucius Annaeus Seneca", "a man named Paulinus" are not said as a list/);
    // joined only by "and" (the finder's own example): not a list
    expect(notAListAsSaid("By the time the potholders and the coasters were done, it was dark.", ["the potholders", "the coasters"])).toMatch(/are not said as a list/);
    // describing words after a linking verb
    expect(notAListAsSaid("It looks clean, bright, and calm.", ["clean", "bright", "calm"])).toMatch(/describing word/);
  });

  it("a list the narrator says passes — however long its rows are said (job 400's 'Who Seneca was'), across sentences (job 393), or with a number said as digits", () => {
    expect(
      notAListAsSaid(whoHeWas, [
        "an advisor standing one step from the throne",
        "buried under exactly the kind of obligations we are about to talk about",
        "and a man who, years later, would be ordered to end his own life",
      ])
    ).toBeUndefined();
    expect(
      notAListAsSaid("The other one is the slow one. A cord under a rug. A space heater quietly cooking the side of a mattress at 2 in the morning. It smolders.", [
        "A cord under a rug",
        "A space heater quietly cooking the side of a mattress",
      ])
    ).toBeUndefined();
    const places = "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet.";
    // the general head is no row (job 400 at 0:47, the lists rule): its examples are the list
    expect(notAListAsSaid(places, ["a waiting room", "a church pew", "the kitchen table at two in the morning"])).toBeUndefined();
    expect(notAListAsSaid(places, ["some ordinary place", "a waiting room", "a church pew", "the kitchen table at two in the morning"])).toMatch(/are not said as a list/);
    expect(notAListAsSaid("Smalls to the markets, personalized work on Etsy, furniture on Marketplace.", ["Smalls to the markets", "personalized work on Etsy", "furniture on Marketplace"])).toBeUndefined();
    // rows the script holds nowhere are held to the item rule alone
    expect(notAListAsSaid("Coasters run $10 to $40.", ["10 coasters", "40 ornaments"])).toBeUndefined();
  });

  it("a host's agenda may list topics (Frederick's 'Detectors, where they go, and when to retire one', jobs 385/393/396); a list of things may not", () => {
    const agenda = "Chapter 9 is tonight's chapter. Detectors, where they go, and when to retire one. There's a code on your screen.";
    const rows = ["Detectors", "where they go", "when to retire one"];
    expect(notAListAsSaid(agenda, rows, { points: true })).toBeUndefined();
    expect(notAListAsSaid(agenda, rows)).toMatch(/^row 3 \("when to retire one"\) names no thing/);
    // a topic row never excuses a time
    expect(notAListAsSaid(seneca, ["Two thousand years ago", "wrote a short", "furious"], { points: true })).toMatch(/a length of time/);
  });

  it("validateSpokenList keeps its 12-word item limit unless told otherwise", () => {
    const rows = ["an advisor standing one step from the throne", "buried under exactly the kind of obligations we are about to talk about"];
    const sentence = whoHeWas.split(". ")[1];
    expect(validateSpokenList(sentence, rows)).toBe(false);
    expect(validateSpokenList(sentence, rows, false, Infinity)).toBe(true);
  });
});

describe("describing words in front of ONE thing are no list (job 400 at 1:41, 'a short, furious, loving essay')", () => {
  // The voice says one sentence; the film cut it into "Two thousand years ago," / "…wrote a short," /
  // "furious," and numbered it "1 Two thousand years ago / 2 Seneca wrote a short / 3 Furious / 4 Loving
  // essay" under the title "Seneca's essay".
  const ESSAY =
    "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus, the official in charge of Rome’s grain supply — busy, important, and worn down to the rims.";
  const answer = (items: string[], kind = "things") => JSON.stringify({ lists: [{ sentence: 0, kind, items }] });

  it("the sentence shape finds nothing in it — documented change: 'busy, important, worn down' was a list too", () => {
    expect(listsByShape(ESSAY)).toEqual([]);
    expect(spokenListsByShape([ESSAY])).toEqual([]);
  });

  it("drops every way the model could cut it: job 400's own list, the adjectives, the clause", () => {
    for (const items of [
      ["Two thousand years ago", "a man named Lucius Annaeus Seneca wrote a short", "furious"], // as job 400 saved it
      ["a man named Lucius Annaeus Seneca wrote a short", "furious", "loving essay to a man named Paulinus"],
      ["a short", "furious", "loving essay"],
      ["short", "furious", "loving essay"],
      ["a short", "loving essay"],
      ["busy", "important", "worn down to the rims"],
    ])
      expect([items, parseSpokenLists(answer(items), [ESSAY])]).toEqual([items, []]);
    // An item may not end inside the run either (Hank's tea tray: one tray, "a plain, low serving tray").
    const tray = "The tea tray, a plain, low serving tray, and it only moved up this list once I started putting names on it.";
    expect(validateSpokenList(tray, ["The tea tray", "a plain"])).toBe(false);
    expect(validateSpokenList(ESSAY, ["a short", "loving essay"])).toBe(false);
  });

  it("the other real describing runs: Hank's tea tray, Scarlett's 'Simple, warm', Norbert's 'snug' (documented change)", () => {
    // Shape lists until now: "The tea tray / a plain / low serving tray" (Hank's script, jobs 110-216),
    // "Simple / warm / impossible", and "Pilot holes / long screws / snug" — snug names nothing, and the
    // two things left are not joined like a list.
    for (const s of [
      "The tea tray, a plain, low serving tray, and it only moved up this list once I started putting names on it.",
      "Simple, warm, and impossible to argue with.",
      "Pilot holes, long screws, snug.",
      "She wrote a short, angry, bitter letter.",
    ])
      expect([s, spokenListsByShape([s])]).toEqual([s, []]);
  });

  it("real lists stay exactly as they were — even where a describing run sits in the same sentence", () => {
    expect(spokenListsByShape(["I'm Granny Ruth, and this one's for anybody sitting at a kitchen table with a straight-stitch machine, a rotary cutter, and a mountain of scraps too pretty to throw out, wondering if all that piecing is really worth anything on a market table."]).map(l => l.items)).toEqual([
      ["a straight-stitch machine", "a rotary cutter", "a mountain of scraps too pretty to throw out"],
    ]);
    expect(spokenListsByShape(["Matte black, dull tarnish, heavy dark wood, all of those take it away."]).map(l => l.items)).toEqual([
      ["Matte black", "dull tarnish", "heavy dark wood"],
    ]); // Scarlett's script
    expect(spokenListsByShape(["You need flour, sugar, and butter."]).map(l => l.items)).toEqual([["flour", "sugar", "butter"]]);
    const keep = (sentence: string, items: string[]) =>
      expect(parseSpokenLists(answer(items), [sentence])).toEqual([{ sentence: 0, items }]);
    // Ruth's: the list of things, then "a real, honest quilt" further on.
    keep(
      "The batting, backing, and thread run about $28 since the tops came from scraps, it takes about eight hours, and it sells for $120 to $170, mostly to folks who want a real, honest quilt without paying heirloom prices.",
      ["The batting", "backing", "thread"]
    );
    // The same shape as "a short, furious, loving essay", but a hammer is a thing.
    keep("You need a hammer, nails, and wood glue.", ["a hammer", "nails", "wood glue"]);
    keep("Ivory, oat, a warm coral, mother of pearl.", ["Ivory", "oat", "a warm coral", "mother of pearl"]); // job 362
  });

  it("a thing with describing words of its own is ONE item, whole", () => {
    expect(spokenListsByShape(["I packed a warm, waterproof jacket, a hat, and gloves."]).map(l => l.items)).toEqual([
      ["a warm, waterproof jacket", "a hat", "gloves"],
    ]);
    expect(spokenListsByShape(["A big, heavy, and sturdy table, two chairs, and a lamp."]).map(l => l.items)).toEqual([
      ["A big, heavy, and sturdy table", "two chairs", "a lamp"],
    ]);
    // A step keeps its strip whole: three steps, not four.
    expect(spokenListsByShape(["Cut a long, thin strip, glue it down, and clamp it."])).toEqual([
      { sentence: 0, items: ["Cut a long, thin strip", "glue it down", "clamp it"], kind: "steps" },
    ]);
  });

  it("a time a sentence opens on is never an item", async () => {
    const r = await findSpokenLists(`Your problem is theft. ${ESSAY}`, {
      ask: async () => answer(["Two thousand years ago", "a man named Lucius Annaeus Seneca wrote a short", "furious"]).replace('"sentence":0', '"sentence":1'),
    });
    expect(r.lists).toEqual([]);
    // "Years ago" used to name a thing, and its last word "ago" would have led the list.
    expect(spokenListsByShape(["Years ago, flour, sugar, and butter cost pennies."])).toEqual([]);
  });
});

describe("describing-run review: the lists around a run stay whole", () => {
  it("'and warm, dry socks' is the last item of three, whole", () => {
    expect(spokenListsByShape(["Pack a flashlight, a blanket, and warm, dry socks."]).map(l => l.items)).toEqual([
      ["a flashlight", "a blanket", "warm, dry socks"],
    ]);
    const answer = (items: string[]) => JSON.stringify({ lists: [{ sentence: 0, kind: "things", items }] });
    const s = "Pack a flashlight, a blanket, and warm, dry socks.";
    expect(parseSpokenLists(answer(["a flashlight", "a blanket", "warm, dry socks"]), [s])).toEqual([
      { sentence: 0, items: ["a flashlight", "a blanket", "warm, dry socks"] },
    ]);
    // Cut inside the socks' describing words, it is no list.
    expect(parseSpokenLists(answer(["a flashlight", "a blanket", "warm", "dry socks"]), [s])).toEqual([]);
  });

  it("a food ending in -ous keeps its list", () => {
    expect(spokenListsByShape(["You can serve it with rice, couscous, or quinoa."]).map(l => l.items)).toEqual([
      ["rice", "couscous", "quinoa"],
    ]);
  });

  it("a list after 'is too small,' is not swallowed as describing words (like 'life is too short, Seneca says' in job 400's script)", () => {
    // "too" after a verb used to start a run, so every comma up to "wood screws" read as inside one thing.
    const s = "Honestly the kit is too small, glue, sandpaper, and wood screws.";
    expect(spokenListsByShape([s]).map(l => l.items)).toEqual([["glue", "sandpaper", "wood screws"]]);
    expect(validateSpokenList(s, ["glue", "sandpaper", "wood screws"])).toBe(true);
    expect(listsByShape("Everyone complains that life is too short, Seneca says.")).toEqual([]);
  });
});

describe("a parallel series keeps its last member (job 400 at 2:36, 'everyone complains')", () => {
  // The list graphic read "1 The farmer / 2 The senator / 3 The old" and closed as "and the young" began,
  // the series' point, which played outside the list on a picture of its own.
  const SERIES = "The farmer complains, the senator complains, the old complain, and the young are already rehearsing the complaint.";
  const THREE = ["The farmer complains", "the senator complains", "the old complain"];
  const FOUR = [...THREE, "the young are already rehearsing the complaint"];
  const answer = (items: string[], kind = "things") => JSON.stringify({ lists: [{ sentence: 0, kind, items }] });

  it("the sentence shape keeps 'the young…' whole, as the fourth item (job 400 saved three)", () => {
    expect(listsByShape(SERIES)).toEqual([FOUR]);
    expect(spokenListsByShape([SERIES])).toEqual([{ sentence: 0, items: FOUR }]);
    // Two members before it are a series too: a list of three, where there was none.
    expect(listsByShape("The farmer complains, the senator complains, and the young are already rehearsing the complaint.")).toEqual([
      ["The farmer complains", "the senator complains", "the young are already rehearsing the complaint"],
    ]);
    // The member stops at its own comma.
    expect(listsByShape(SERIES.replace(/\.$/, ", Seneca says."))).toEqual([FOUR]);
  });

  it("the model's list that stopped one member early gets it back; its full answer is unchanged", async () => {
    expect(parseSpokenLists(answer(THREE), [SERIES])).toEqual([{ sentence: 0, items: FOUR }]);
    expect(parseSpokenLists(answer(FOUR), [SERIES])).toEqual([{ sentence: 0, items: FOUR }]);
    // With no comma before "and", too.
    const plain = SERIES.replace("complain, and", "complain and");
    expect(parseSpokenLists(answer(THREE), [plain])).toEqual([{ sentence: 0, items: FOUR }]);
    // In the whole script, as the pipeline asks it.
    const text = `Everyone complains that life is too short, Seneca says. ${SERIES} Then he turns the whole thing over in a single motion: life is not short.`;
    const r = await findSpokenLists(text, { ask: async () => answer(THREE).replace('"sentence":0', '"sentence":1') });
    expect(r.lists).toEqual([{ sentence: 1, items: FOUR }]);
    // Steps are never given a member.
    expect(parseSpokenLists(answer(THREE, "steps"), [SERIES])).toEqual([{ sentence: 0, items: THREE, kind: "steps" }]);
  });

  it("nothing is added without the echo, a like opening, a member that names something, or room", () => {
    // A clause about something else ends the series: no echo of "complain".
    expect(listsByShape("The farmer complains, the senator complains, the old complain, and the truth is nobody listens.")).toEqual([THREE]);
    expect(listsByShape("The farmer complains, the senator complains, and the truth is nobody listens.")).toEqual([]);
    // A member that names nothing (`itemsAreThings`) never costs the list its three.
    expect(spokenListsByShape(["The farmer complains, the senator complains, the old complain, and the young just complains."])).toEqual([
      { sentence: 0, items: THREE },
    ]);
    // Too long to be one item.
    expect(
      listsByShape("The farmer complains, the senator complains, the old complain, and the young are already rehearsing the complaint they will make forty years from now.")
    ).toEqual([THREE]);
    // A list of things that do not end on one word is never touched.
    expect(listsByShape("Get a saw, a drill, a plane, and the whole thing cost me forty dollars.")).toEqual([["a saw", "a drill", "a plane"]]);
    // The helper itself: a summing-up whose subject IS the shared word, an unlike opening, a list of things.
    for (const [s, items] of [
      ["The farmer complains, the senator complains, the old complain, and the complaints never end.", THREE],
      ["The farmer complains, the senator complains, the old complain, and nobody listens to a complaint.", THREE],
      ["Get a saw, a drill, a plane, and the whole thing cost me forty dollars.", ["a saw", "a drill", "a plane"]],
      ["You need flour, sugar, and butter.", ["flour", "sugar", "butter"]],
    ] as [string, string[]][])
      expect(withLastSeriesMember(s, items)).toBe(items);
  });

  it("a summing-up that says the word again inside a clause of its own is not a member; 'is' alone does not stop one", () => {
    // Review of the fix: "the truth is everyone complains" echoes "complain" after its own two words,
    // so it had become item three of a list that was never there.
    expect(listsByShape("The farmer complains, the senator complains, and the truth is everyone complains.")).toEqual([]);
    expect(listsByShape("The farmer complains, the senator complains, the old complain, and the point was that everyone complains.")).toEqual([THREE]);
    expect(withLastSeriesMember("The farmer complains, the senator complains, the old complain, and the truth is we all complain.", THREE)).toBe(THREE);
    // A member whose own verb is "is" stays a member.
    expect(listsByShape("The farmer complains, the senator complains, and the child is already learning to complain.")).toEqual([
      ["The farmer complains", "the senator complains", "the child is already learning to complain"],
    ]);
  });

  it("the film is cut on all four: 'and the young…' is an item's picture", () => {
    const CUT = [
      scene(29, "Everyone complains that life is too short, Seneca says."),
      scene(30, "The farmer complains,", { listCut: true }),
      scene(31, "the senator complains,", { listCut: true }),
      scene(32, "the old complain,", { listCut: true }),
      scene(33, "and the young are already rehearsing the complaint."),
      scene(34, "Then he turns the whole thing over in a single motion: life is not short."),
    ];
    const r = applySpokenLists(CUT, shapeLists(CUT));
    expect(rows(r.scenes)).toEqual([
      ["Everyone complains that life is too short, Seneca says.", false, false],
      ["The farmer complains,", false, true],
      ["the senator complains,", false, true],
      ["the old complain,", false, true],
      ["and the young are already rehearsing the complaint.", false, true],
      ["Then he turns the whole thing over in a single motion: life is not short.", false, false],
    ]);
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
      // a yard nothing counts is still the place
      "the back yard of the house",
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
      // a counted length is what it measures, never the place "yard" names
      "a yard of fabric", "two yards of denim", "half a yard of muslin", "2 yards of fleece", "a few feet of rope",
    ];
    for (const item of kept) expect(notInOnePhoto(item), item).toBeNull();
  });

  it("a list of steps is never one group picture; a list of things is when every item passes", () => {
    expect(itemsInOnePhoto(["a saw", "a drill", "a stack of sandpaper"])).toBe(true);
    expect(itemsInOnePhoto(["a saw", "a drill", "a stack of sandpaper"], "steps")).toBe(false);
    // Job 355 scene 9 got a real one: "find every leak in that bag, plug them one at a time and fill
    // the gaps with cheaper food together, laid out side by side".
    expect(itemsInOnePhoto(["find every leak in that bag", "plug them one at a time", "then fill the gaps with cheaper food"], "steps")).toBe(false);
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

describe("a last item that runs on into a clause is kept (Gideon's job 401 at 0:49)", () => {
  // The voice names three places — "…a waiting room, a church pew, the kitchen table at two in the
  // morning when the house is too quiet." — and the list graphic showed "1 A waiting room / 2 A church
  // pew", closing as the table was said. The third item, with no comma and no "and" before the clause
  // it runs into, was 14 words: the shape rules stopped before it, and the model left it out.
  const LINE =
    "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet.";
  const PLACES = ["a waiting room", "a church pew", "the kitchen table at two in the morning"];
  const answer = (items: string[], kind = "things") => JSON.stringify({ lists: [{ sentence: 0, kind, items }] });

  it("an item is its words up to a clause of when, where or why — its own describing words kept", () => {
    expect(itemBeforeClause("the kitchen table at two in the morning when the house is too quiet.")).toBe(
      "the kitchen table at two in the morning"
    );
    expect(itemBeforeClause("and the kitchen table at two in the morning when the house is too quiet")).toBe(
      "and the kitchen table at two in the morning"
    );
    expect(itemBeforeClause("the glove box of the car when you finally clean it out")).toBe("the glove box of the car");
    expect(itemBeforeClause("the dryer vent because it stays warm")).toBe("the dryer vent");
    expect(itemBeforeClause("the shed out back where the mower lives")).toBe("the shed out back");
  });

  it("no item when there is no such clause, it is a word or two, or the words before it are no thing", () => {
    expect(itemBeforeClause("the kitchen table at two in the morning")).toBeNull();
    expect(itemBeforeClause("the kitchen table when needed")).toBeNull();
    // A preposition before the clause: the item's own words are not finished.
    expect(itemBeforeClause("a plane for when you need one")).toBeNull();
    // A clause, never an item; and words that sum the list up rather than add to it.
    expect(itemBeforeClause("the whole kit cost forty dollars when I bought it")).toBeNull();
    expect(itemBeforeClause("the kind of thing people buy when they visit")).toBeNull();
    expect(itemBeforeClause("the moment the phone rings while you are out")).toBeNull();
    expect(itemBeforeClause("honestly the money when it matters most")).toBeNull();
    // "a while" is a length of time, not the start of a clause.
    expect(itemBeforeClause("the porch swing for a while after supper")).toBeNull();
    expect(itemBeforeClause("the porch swing for a while when the sun goes down")).toBeNull();
    // Longer than an item may be.
    expect(itemBeforeClause("the big old rocking chair my grandfather built out of oak and pine when he retired")).toBeNull();
    // A clause with a verb between its subject and what follows: what happens, not a thing.
    expect(itemBeforeClause("the house gets quiet when the kids go to bed")).toBeNull();
    expect(itemBeforeClause("the job gets done when you stop rushing it")).toBeNull();
  });

  it("a plural that names the thing is no verb", () => {
    expect(itemBeforeClause("the eggs getting cold while he read the paper")).toBe("the eggs getting cold");
    expect(itemBeforeClause("the sales rack by the door when the store opens")).toBe("the sales rack by the door");
    expect(itemBeforeClause("the old work boots by the door where they always sit")).toBe("the old work boots by the door");
  });

  it("the shape rules keep the third place, with or without 'and', and in any wording", () => {
    expect(listsByShape(LINE)).toEqual([PLACES]);
    expect(listsByShape(LINE.replace("a church pew, the", "a church pew, and the"))).toEqual([PLACES]);
    expect(spokenListsByShape([LINE])).toEqual([{ sentence: 0, items: PLACES }]);
    // A first item that ends the clause before the run counts toward the two.
    expect(listsByShape("You'll find them in a coat pocket, a kitchen drawer, the glove box of the car when you finally clean it out.")).toEqual([
      ["a coat pocket", "a kitchen drawer", "the glove box of the car"],
    ]);
    expect(listsByShape("They hide in a shoe, a glove, the dryer vent because it stays warm.")).toEqual([["a shoe", "a glove", "the dryer vent"]]);
    expect(listsByShape("You need flour, sugar, butter when it is soft.")).toEqual([["flour", "sugar", "butter"]]);
  });

  it("the shape rules add nothing that is not clearly one more item", () => {
    // Only one item before it: no list to keep.
    expect(listsByShape("I sat on a bench, the kitchen table at two in the morning when the house is too quiet.")).toEqual([]);
    // A clause, not a thing; a summing-up; a different kind of item (a bare name after "a/the …" items).
    expect(listsByShape("I grabbed a saw, a drill, the whole kit cost forty dollars when I bought it.")).toEqual([]);
    expect(listsByShape("We sold a quilt, a table runner, the kind of thing people buy when they visit.")).toEqual([]);
    expect(listsByShape("I packed a saw, a drill, sandpaper when the store had it.")).toEqual([]);
    // Two things, then what happens: no third item, and no list (two with no "and" are none).
    expect(listsByShape("A warm coat, a hot meal, the house gets quiet when the kids go to bed.")).toEqual([]);
    expect(listsByShape("A little patience, a steady hand, the job gets done when you stop rushing it.")).toEqual([]);
    // ...while the same shape ending on one more thing is still a list of three.
    expect(listsByShape("The coffee, the toast, the eggs getting cold while he read the paper.")).toEqual([
      ["The coffee", "the toast", "the eggs getting cold"],
    ]);
    // A clause that is not when, where or why still stops the run (Dale's job 292 needs its "and").
    expect(listsByShape("Today I'm ranking Etsy, craft fairs, Facebook Marketplace by what each one does well.")).toEqual([]);
  });

  it("the model's last item over the limit loses its clause, not the list", () => {
    expect(withLastItemCut(["a waiting room", "a church pew", "the kitchen table at two in the morning when the house is too quiet"])).toEqual(PLACES);
    expect(parseSpokenLists(answer(["some ordinary place", "a waiting room", "a church pew", "the kitchen table at two in the morning when the house is too quiet"]), [LINE])).toEqual([
      { sentence: 0, items: PLACES },
    ]);
  });

  it("the model's list is cut only when the item is too long, and only after two items named the same way", () => {
    // Job 399: within the limit, a clause is part of what the item names.
    const points = ["the exact words", "who to say them to", "the moment in the trip when they work"];
    expect(withLastItemCut(points)).toBe(points);
    const pitch =
      "It's called A Hundred Air Hostess Secrets, a four hundred eighty-five page PDF, and every secret gives you the exact words, who to say them to, and the moment in the trip when they work.";
    expect(parseSpokenLists(answer(points), [pitch])).toEqual([{ sentence: 0, items: points }]);
    // Two items only, or a bare name before the cut "the …" item: left as they were (and refused).
    const two = ["a church pew", "the kitchen table at two in the morning when the house is too quiet"];
    expect(withLastItemCut(two)).toBe(two);
    const mixed = ["flour", "sugar", "the butter from the fridge out in the garage when it has gone soft enough"];
    expect(withLastItemCut(mixed)).toBe(mixed);
    // Too long with no clause to cut: nothing to keep.
    const long = ["a saw", "a drill", "the big old rocking chair my grandfather built out of oak and pine in the shed"];
    expect(withLastItemCut(long)).toBe(long);
  });

  it("a list the model ended one item early takes the sentence shape's longer list", async () => {
    const r = await findSpokenLists(`Maybe you have done that arithmetic. ${LINE}`, {
      ask: async () => '{"lists":[{"sentence":1,"kind":"things","items":["a waiting room","a church pew"]}]}',
    });
    expect(r.fromModel).toBe(true);
    expect(r.lists).toEqual([{ sentence: 1, items: PLACES }]);
    // The model's list stands when the shape agrees, or holds more that is no item of it (job 407).
    const same = await findSpokenLists("Get a saw, a drill, and a plane.", {
      ask: async () => '{"lists":[{"sentence":0,"kind":"things","items":["a saw","a drill","a plane"]}]}',
    });
    expect(same.lists).toEqual([{ sentence: 0, items: ["a saw", "a drill", "a plane"] }]);
    const tools = await findSpokenLists(
      "But on the back wall hung an axe, a froe, and a drawknife, and the steel in those three was the one thing that homestead could not grow.",
      { ask: async () => '{"lists":[{"sentence":0,"kind":"things","items":["an axe","a froe","a drawknife"]}]}' }
    );
    expect(tools.lists).toEqual([{ sentence: 0, items: ["an axe", "a froe", "a drawknife"] }]);
  });

  it("only the one item left out before a clause of when, where or why lengthens the model's list", () => {
    const shape: SpokenList = { sentence: 1, items: PLACES };
    expect(endsEarly({ sentence: 1, items: ["a waiting room", "a church pew"] }, shape, LINE)).toBe(true);
    expect(endsEarly({ sentence: 1, items: ["A waiting room,", "a church pew."] }, shape, LINE)).toBe(true);
    expect(endsEarly({ sentence: 1, items: PLACES }, shape, LINE)).toBe(false);
    expect(endsEarly({ sentence: 1, items: ["a waiting room"] }, shape, LINE)).toBe(false);
    expect(endsEarly({ sentence: 1, items: ["a church pew", "the kitchen table at two in the morning"] }, shape, LINE)).toBe(false);
    expect(endsEarly({ sentence: 2, items: ["a waiting room", "a church pew"] }, shape, LINE)).toBe(false);
    expect(endsEarly({ sentence: 1, items: ["a waiting room", "a church pew"], kind: "steps" }, shape, LINE)).toBe(false);
    // Sam's job 407: the model's three tools closed on "and"; the shape's "and the steel" opens a new
    // clause ("…was the one thing that homestead could not grow") — the model's list stands.
    const tools = "But on the back wall hung an axe, a froe, and a drawknife, and the steel in those three was the one thing that homestead could not grow.";
    expect(spokenListsByShape([tools])).toEqual([{ sentence: 0, items: ["an axe", "a froe", "a drawknife", "the steel"] }]);
    expect(endsEarly({ sentence: 0, items: ["an axe", "a froe", "a drawknife"] }, { sentence: 0, items: ["an axe", "a froe", "a drawknife", "the steel"] }, tools)).toBe(false);
    // An item the model left out that runs into nothing is the model's call ("…, the whole thing for forty bucks").
    const kit = "Get a saw, a drill, a plane, the whole thing for forty bucks.";
    expect(endsEarly({ sentence: 0, items: ["a saw", "a drill", "a plane"] }, { sentence: 0, items: ["a saw", "a drill", "a plane", "the whole thing for forty bucks"] }, kit)).toBe(false);
  });

  // Job 401 as it was cut (review pack scenes 7-12): the planner gave the table its own beat, clause
  // and all, and the split after it is a fixed beat.
  const job401 = () => [
    scene(7, "and the number rides home with him in the passenger seat.", { showSubject: "man walking across a quiet parking lot toward his car" }),
    scene(8, "Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in some ordinary place,", {
      showSubject: "an older man sitting alone and still on a bench, seen from the side, lost in thought",
    }),
    scene(9, "a waiting room,", { listCut: true, showSubject: "empty waiting room with cushioned chairs under fluorescent light" }),
    scene(10, "a church pew,", { listCut: true, showSubject: "empty polished wooden church pew with light through tall windows" }),
    scene(11, "the kitchen table at two in the morning when the house is too quiet.", {
      showSubject: "round wooden kitchen table with two chairs and a dim lamp at night",
    }),
    host(12, "And the math always presents itself as the problem. Fewer years ahead than behind,", { splitVisual: "a desk in a study" }),
  ];

  it("the table is the third list picture, its own beat and picture kept", () => {
    const r = applySpokenLists(job401(), shapeLists(job401()));
    expect(r.applied).toBe(1);
    expect(r.scenes.map(s => [s.scriptText, !!s.listCut, s.showSubject])).toEqual([
      ["and the number rides home with him in the passenger seat.", false, "man walking across a quiet parking lot toward his car"],
      [
        "Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in some ordinary place,",
        false,
        "an older man sitting alone and still on a bench, seen from the side, lost in thought",
      ],
      ["a waiting room,", true, "empty waiting room with cushioned chairs under fluorescent light"],
      ["a church pew,", true, "empty polished wooden church pew with light through tall windows"],
      ["the kitchen table at two in the morning when the house is too quiet.", true, "round wooden kitchen table with two chairs and a dim lamp at night"],
      ["And the math always presents itself as the problem. Fewer years ahead than behind,", false, "picture 12"],
    ]);
  });

  it("in one beat with the item, the clause keeps the item's picture to its full stop", () => {
    const scenes = [
      host(1, "Hi there."),
      scene(2, "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room,"),
      scene(3, "a church pew, the kitchen table at two in the morning when the house is too quiet."),
      host(4, "Bye."),
    ];
    const r = applySpokenLists(scenes, shapeLists(scenes));
    expect(rows(r.scenes).slice(2, 5)).toEqual([
      ["a waiting room,", false, true],
      ["a church pew,", false, true],
      // Before: "the kitchen table at two in the morning" and a picture of its own for "when the house is too quiet."
      ["the kitchen table at two in the morning when the house is too quiet.", false, true],
    ]);
    // Named by the item's own words, never the clause's.
    expect(r.scenes[4].showSubject).toBe("the kitchen table at two in the morning");
    const plane = [host(1, "Hi there."), scene(2, "You need a saw, a drill, and a plane when the boards come in rough and twisted."), host(3, "Bye.")];
    const p = applySpokenLists(plane, shapeLists(plane));
    expect(p.scenes.map(s => [s.scriptText, s.showSubject]).slice(4, 5)).toEqual([["and a plane when the boards come in rough and twisted.", "a plane"]]);
  });

  it("a clause that runs on into the next beat, or is not when, where or why, is left where it was", () => {
    const split = [
      host(1, "Hi there."),
      scene(2, "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room,"),
      scene(3, "a church pew, the kitchen table at two in the morning when the house"),
      scene(4, "is too quiet."),
      host(5, "Bye."),
    ];
    expect(rows(applySpokenLists(split, shapeLists(split)).scenes).slice(4, 6)).toEqual([
      ["the kitchen table at two in the morning", false, true],
      ["when the house is too quiet.", false, false],
    ]);
    const ranking = [host(1, "Hi there."), scene(2, "Today I'm ranking Etsy, craft fairs, and Facebook Marketplace by what each one actually does well."), host(3, "Bye.")];
    expect(rows(applySpokenLists(ranking, shapeLists(ranking)).scenes).slice(4, 6)).toEqual([
      ["and Facebook Marketplace", false, true],
      ["by what each one actually does well.", false, false],
    ]);
  });
});

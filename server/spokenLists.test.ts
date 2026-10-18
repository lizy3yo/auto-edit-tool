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

describe("a general head before its examples is never an item (job 400 at 0:47)", () => {
  // The list graphic read "1 Some ordinary place / 2 A waiting room / 3 A church pew", and the head
  // got a picture of its own (a woman at a sink): three places, introduced, read as four.
  const LINE =
    "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet.";
  const answer = (items: string[]) => JSON.stringify({ lists: [{ sentence: 0, kind: "things", items }] });

  it("the shape rules list the examples, not the head that ends the clause before them", () => {
    expect(listsByShape(LINE)).toEqual([["a waiting room", "a church pew"]]);
    expect(spokenListsByShape([LINE])).toEqual([{ sentence: 0, items: ["a waiting room", "a church pew"] }]);
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
  const cut = [
    ["Seventeen. He pays, he walks out to the parking lot, and the number rides home with him in the passenger seat.", false, false],
    ["Most people past sixty have — usually in silence, usually in some ordinary place,", false, false],
    ["a waiting room,", false, true],
    ["a church pew,", false, true],
    ["the kitchen table at two in the morning when the house is too quiet.", false, false],
    ["And the math always presents itself as the problem.", true, false],
  ];

  it("the film is cut on the examples: the head's words stay with their beat", () => {
    const r = applySpokenLists(film(), shapeLists(film()));
    expect(r.applied).toBe(1);
    expect(rows(r.scenes)).toEqual(cut);
    expect(r.scenes[1].showSubject).toBe("an older man sitting alone on a grey padded chair against a pale wall");
  });

  it("a list saved before the rule, head and all, is cut the same way on a resume", () => {
    const saved: SpokenList[] = [{ sentence: 2, items: ["some ordinary place", "a waiting room", "a church pew"] }];
    expect(rows(applySpokenLists(film(), saved).scenes)).toEqual(cut);
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
      ["the kitchen table at two in the morning when the house is too quiet.", false],
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
        ["the kitchen table at two in the morning when the house is too quiet.", false, false],
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

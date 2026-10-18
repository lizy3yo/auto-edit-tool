import { describe, expect, it } from "vitest";
import { resolveCues, type CueSpec, type ResolvedCue, type Word } from "../cueResolve";
import { TEMPLATES } from "../registry";
import { FPS } from "../theme";
import { notAListAsSaid } from "../../../server/spokenLists";
import { ICON_REQUIRED, ROW_MAX_WORDS, choiceSteps, fromAFoundList, iconsAsASet, listsWhereGraphicsGo, malformedPhrase, missingListCues, namesTheDanger, noIcon, normalizePhrases, notTheHostsWords, planGraphics, quotedInScript, restoreRowGrammar, systemPrompt, uncoveredMoments, userPrompt, wordsSaidOver, type PlanMessage } from "./planner";

const W = (s: string, start: number, step = 0.3): Word[] => s.split(" ").map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.26 }));
const scene = (index: number, a: number, b: number, extra: Record<string, unknown> = {}) => ({ index, narrationStartSec: a, narrationEndSec: b, scriptText: "", hostPresent: false, cta: false, split: false, hostOpener: false, ...extra });
const cue = (start: number, end: number) => ({ id: `c${start}`, template: "DimCaption", start, end }) as unknown as ResolvedCue;

describe("the fill round goes by the SCRIPT, not the clock (2026-10-17)", () => {
  const words = [...W("I figured two hours on it.", 0), ...W("The wood came from a yard sale nearby.", 3), ...W("It took six hours in the end.", 7)];
  const film = { scenes: [scene(1, 0, 20)] };
  it("offers each sentence with a moment and no graphic — and nothing else", () => {
    const out = uncoveredMoments([], words, film);
    expect(out.map(o => o.text)).toEqual(["I figured two hours on it.", "It took six hours in the end."]);
  });
  it("skips a sentence a graphic already covers, and anything in the call to action", () => {
    expect(uncoveredMoments([cue(0, 1.9)], words, film).map(o => o.text)).toEqual(["It took six hours in the end."]);
    expect(uncoveredMoments([], words, { scenes: [scene(1, 0, 20, { cta: true })] })).toEqual([]);
  });
});

describe("every spoken list has its list graphic (Dale's 'Coasters, ornaments, small cutting boards', job 397)", () => {
  const words = [...W("Smalls, about $10 to $40.", 49.5), ...W("Coasters, ornaments, small cutting boards.", 53.16)];
  const list = { items: ["Coasters", "ornaments", "small cutting boards"] };
  it("builds a ListWindow from the list's own words when no graphic covers it", () => {
    const [c] = missingListCues([], words, { scenes: [scene(13, 49.46, 60)] }, [list]);
    expect(c.template).toBe("ListWindow");
    expect((c.props.items as { text: string; at: string; say: string }[]).map(i => i.text)).toEqual(["Coasters", "Ornaments", "Small cutting boards"]);
    expect(c.start).toBe("Coasters");
  });
  it("uses the host's list window over the host, and leaves a covered list alone", () => {
    const [h] = missingListCues([], words, { scenes: [scene(13, 49.46, 60, { hostPresent: true })] }, [list]);
    expect(h.template).toBe("HostListWindow");
    expect(missingListCues([cue(53, 55)], words, { scenes: [scene(13, 49.46, 60)] }, [list])).toEqual([]);
  });
});

/** Words as the transcriber timed them: "text@start-end …". */
const T = (s: string): Word[] =>
  s.split(" ").map(t => {
    const [text, range] = t.split("@");
    const [start, end] = range.split("-").map(Number);
    return { text, start, end };
  });

describe("a list in the call to action is never put to the planner as a must-have (12 films: 15 of 49 lists)", () => {
  // Dale's job 397, as heard: a list in a b-roll stretch, then one inside the book pitch (a CTA).
  const coasters = T("Smalls,@49.68-50.14 about@50.50-50.74 $10@50.94-51.54 to@51.62-51.70 $40.@51.78-52.48 Coasters,@53.16-53.72 ornaments,@54.00-54.42 small@54.70-54.96 cutting@55.00-55.28 boards.@55.32-55.62");
  const pitch = T(
    "Let@93.65-93.77 me@93.79-93.87 set@93.93-94.09 the@94.11-94.21 list@94.25-94.47 down@94.51-94.71 for@94.77-94.89 a@94.95-94.97 minute.@95.01-95.27 Everything@96.13-96.49 I@96.55-96.63 lean@96.71-96.93 on@97.03-97.11 at@97.17-97.23 the@97.27-97.35 bench@97.41-97.73 came@97.81-98.05 from@98.13-98.29 other@98.47-98.65 woodworkers,@98.69-99.33 old@99.69-99.83 shop@99.91-100.17 habits,@100.23-100.59 and@100.89-101.05 a@101.11-101.15 fair@101.25-101.49 pile@101.57-101.89 of@101.93-101.97 my@102.03-102.19 own@102.25-102.41 spoiled@102.49-102.95 boards,@103.03-103.41"
  );
  const words = [...coasters, ...pitch];
  const smalls = { items: ["Coasters", "ornaments", "small cutting boards"] };
  const learned = { items: ["other woodworkers", "old shop habits", "a fair pile of my own spoiled boards"] };
  const film = {
    scenes: [
      scene(13, 49.46, 60, { scriptText: "Smalls, about $10 to $40. Coasters, ornaments, small cutting boards." }),
      scene(24, 89.39, 93.54, { scriptText: "That's why the personalized pile belongs on Etsy first." }),
      scene(25, 93.54, 103.87, { hostPresent: true, cta: true, scriptText: "Let me set the list down for a minute. Everything I lean on at the bench came from other woodworkers, old shop habits, and a fair pile of my own spoiled boards," }),
      scene(26, 103.87, 109.5, { cta: true, scriptText: "and I gathered it into a digital book called The Ultimate DIY Woodworking Guide." }),
    ],
  };

  it("Dale's job 397: the b-roll list is offered, the one in the book pitch is not", () => {
    expect(listsWhereGraphicsGo(words, film, [smalls, learned])).toEqual([smalls]);
  });

  it("Hank's job 398: the scan steps in the CTA leave, the list in the opening stays", () => {
    const opening = T("in@28.72-28.80 a@28.82-28.84 garage@28.90-29.38 with@29.42-29.58 a@29.62-29.64 saw,@29.74-30.08 a@30.38-30.40 drill,@30.46-30.84 and@30.92-31.00 a@31.04-31.06 stack@31.12-31.42 of@31.46-31.52 sandpaper,@31.58-32.22");
    const scan = T(
      "Point@121.73-121.95 your@121.97-122.13 phone's@122.17-122.59 camera@122.87-123.35 at@123.53-123.61 the@123.67-123.77 QR@123.83-124.29 code@124.37-124.64 on@124.69-124.78 the@124.81-124.89 screen,@124.94-125.31 hold@125.97-126.22 it@126.28-126.36 steady@126.44-126.86 a@126.92-126.96 second@127.04-127.44 and@127.82-127.92 tap@127.98-128.28 the@128.32-128.42 link@128.48-128.70 that@128.76-128.92 pops@128.98-129.36 up.@129.50-129.60"
    );
    const tools = { items: ["a saw", "a drill", "a stack of sandpaper"] };
    const steps = { kind: "steps" as const, items: ["Point your phone's camera at the QR code on the screen", "hold it steady a second", "tap the link that pops up"] };
    const hank = { scenes: [scene(5, 29.46, 32.3), scene(18, 105.21, 121.61, { hostPresent: true, cta: true }), scene(19, 121.61, 136.46, { cta: true })] };
    expect(listsWhereGraphicsGo([...opening, ...scan], hank, [tools, steps])).toEqual([tools]);
  });

  it("agrees with the list graphics built afterwards: a list running into the CTA is out of both, one ending where it starts is in both", () => {
    // The CTA starting between "old shop habits," and "a fair pile…": the list straddles its edge.
    const straddle = { scenes: [scene(24, 89.39, 100.7), scene(25, 100.7, 103.87, { cta: true })] };
    expect(listsWhereGraphicsGo(pitch, straddle, [learned])).toEqual([]);
    expect(missingListCues([], pitch, straddle, [learned])).toEqual([]);
    // The CTA starting right as "boards," ends: touching is not running into it.
    const before = { scenes: [scene(24, 89.39, 103.41), scene(25, 103.41, 109.5, { cta: true })] };
    expect(listsWhereGraphicsGo(pitch, before, [learned])).toEqual([learned]);
    expect(missingListCues([], pitch, before, [learned]).map(c => c.template)).toEqual(["ListWindow"]);
  });

  it("still offers a list it cannot find word for word (the planner may place it on the words it finds)", () => {
    const misheard = { items: ["Coasters", "ornaments", "big cutting boards"] };
    expect(listsWhereGraphicsGo(words, film, [misheard, learned])).toEqual([misheard]);
  });

  it("a list said again after a mid-roll CTA is still located after it, past the CTA's own list", () => {
    const recap = T("Coasters,@150.00-150.50 ornaments,@150.80-151.20 small@151.50-151.80 cutting@151.85-152.10 boards.@152.15-152.50");
    const later = { scenes: [...film.scenes, scene(30, 149.5, 160, { hostPresent: true })] };
    const all = [...words, ...recap];
    expect(listsWhereGraphicsGo(all, later, [smalls, learned, smalls])).toEqual([smalls, smalls]);
    // the first is covered by a graphic; the second, over the host, gets its own
    const built = missingListCues([cue(53, 56)], all, later, [smalls, learned, smalls]);
    expect(built.map(c => [c.id, c.template])).toEqual([["spoken-list-3", "HostListWindow"]]);
  });

  it("the planner's message names only the lists a graphic may cover, and no list note when every list is in a CTA", async () => {
    const asked: string[] = [];
    const ask = async (_system: string, messages: PlanMessage[]) => {
      asked.push(messages[0].content);
      return '{"cues": []}';
    };
    await planGraphics({ words, film, ask, ensureIcon: async () => true, lists: [smalls, learned] });
    const note = asked[0].split("SPOKEN LISTS IN THIS SCRIPT")[1] ?? "";
    expect(note).toContain('1. "Coasters", "ornaments", "small cutting boards"');
    expect(note).not.toContain("other woodworkers");
    expect(note).not.toMatch(/^2\. /m);

    asked.length = 0;
    await planGraphics({ words: pitch, film, ask, ensureIcon: async () => true, lists: [learned] });
    expect(asked[0]).not.toContain("SPOKEN LISTS IN THIS SCRIPT");
    // the scene text is still there: the list is only left out of the must-have note
    expect(asked[0]).toContain("other woodworkers, old shop habits");
  });
});

describe("a timed line written as plain text is repaired, never crashes the graphics (job 395)", () => {
  it("turns a bare string into a timed line, and names one that cannot be drawn", () => {
    const spec = { id: "s", template: "Statement", start: "x", props: { headline: "The pendant is almost never the problem." } } as unknown as CueSpec;
    normalizePhrases(spec);
    expect(spec.props.headline).toEqual({ text: "The pendant is almost never the problem.", words: true });
    expect(malformedPhrase(spec)).toBeUndefined();
    const bad = { id: "b", template: "Statement", start: "x", props: { headline: { words: true } } } as unknown as CueSpec;
    expect(malformedPhrase(bad)).toBe("headline");
  });
});

describe("no graphic is up too short to read (Dale's job 397: 1.27 s and 1.40 s, QA said pass)", () => {
  const opts = {
    fps: FPS,
    structural: new Set(TEMPLATES.filter(t => t.structural).map(t => t.id)),
    cards: new Set(TEMPLATES.filter(t => t.kind === "card").map(t => t.id)),
    fullFrame: new Set(TEMPLATES.filter(t => t.kind === "card" || t.underlay === "window").map(t => t.id)),
  };
  /** The model answers `first` once, then adds nothing (repair, fill). */
  const asking = (first: CueSpec[]) => {
    const asked: string[] = [];
    const ask = async (_system: string, messages: PlanMessage[]) => {
      asked.push(messages[messages.length - 1].content);
      return asked.length === 1 ? JSON.stringify({ cues: first }) : '{"cues": []}';
    };
    return { ask, asked };
  };

  // "…before you pick a place to sell them. | Three piles. | Smalls, about $10…": the two-word line
  // has a shot of its own, 48.21-49.46.
  const piles = T("them.@47.52-47.68 Three@48.38-48.64 piles.@48.70-49.12 Smalls,@49.68-50.14 about@50.50-50.74 $10@50.94-51.54 to@51.62-51.70 $40.@51.78-52.48");
  const threePiles: CueSpec = { id: "three-piles", template: "BigNumberOverlay", start: "Three piles.", startPad: -0.15, end: "Three piles.", endPad: 0.3, props: { at: "@Three piles.", unit: "piles", value: 3, kicker: "Sort into", countSec: 0.6 } };
  const shots = { scenes: [scene(11, 41.1439, 48.2104, { hostPresent: true, split: true }), scene(12, 48.2104, 49.4569, { scriptText: "Three piles." }), scene(13, 49.4569, 53.0381, { scriptText: "Smalls, about $10 to $40." })] };
  const cuts = [41.1439, 48.2104, 49.4569, 53.0381];

  it("Dale's '3 piles': capped at 'Smalls,' then snapped back to the cut, 1.27 s — refused and sent for repair", async () => {
    // the resolver alone still makes it 1.27 s: the floor is held by the planner, not there
    const [alone] = resolveCues([structuredClone(threePiles)], piles, { ...opts, cuts });
    expect([alone.startFrame, alone.endFrame]).toEqual([1446, 1484]);
    const { ask, asked } = asking([threePiles]);
    const out = await planGraphics({ words: piles, cuts, film: shots, ask, ensureIcon: async () => true });
    expect(out.cues.map(c => c.id)).not.toContain("three-piles");
    expect(out.rounds[0].problems).toContainEqual({ cue: "three-piles", problem: expect.stringMatching(/^on screen 1\.27 s — too short to read \(at least 1\.5 s\)/) });
    expect(asked[1]).toContain("three-piles: on screen 1.27 s — too short to read");
  });

  it("the same graphic on a shot that runs on through 'Smalls' is up 1.6 s and kept", async () => {
    const oneShot = { scenes: [shots.scenes[0], scene(12, 48.2104, 53.0381, { scriptText: "Three piles. Smalls, about $10 to $40." })] };
    const { ask } = asking([threePiles]);
    const out = await planGraphics({ words: piles, cuts: [41.1439, 48.2104, 53.0381], film: oneShot, ask, ensureIcon: async () => true });
    const r = out.resolved.find(c => c.id === "three-piles")!;
    expect(r.endFrame - r.startFrame).toBeGreaterThanOrEqual(45);
    expect(out.rounds[0].problems).toEqual([]);
  });

  // Dale's five counted places to sell (job 397), as heard, with his own picture cuts.
  const counted = [
    ...T("Number@41.30-41.58 one.@41.76-41.90 Sort@42.78-43.04 your@43.08-43.26 finished@43.32-43.66 pieces@43.74-44.16 by@44.24-44.40 size@44.52-44.90 and@45.00-45.10 price@45.24-45.64"),
    ...T("Number@74.28-74.52 two,@74.58-74.83 use@75.50-75.70 Etsy@75.82-76.18 for@76.22-76.34 the@76.38-76.48 thing@76.52-76.70 it@76.76-76.82 does@76.88-77.10 best,@77.26-77.62"),
    ...T(
      "Number@135.72-135.96 three,@136.00-136.29 the@136.66-136.74 one@136.80-136.90 I@136.94-137.02 promised@137.06-137.46 you.@137.48-137.64 Etsy's@138.34-138.72 regular@138.84-139.26 fees@139.32-139.66 take@139.74-139.94 roughly@140.00-140.32 $10@140.34-140.62 off@140.64-140.72 a@140.74-140.76 $100@140.78-140.94 board.@141.00-141.18"
    ),
    ...T("Number@168.58-168.82 four,@168.90-169.16 take@169.90-170.06 your@170.10-170.26 smalls@170.30-170.68 to@170.74-170.84 craft@170.92-171.28 fairs@171.34-171.70"),
    ...T("Number@192.06-192.30 five,@192.38-192.74 sell@193.36-193.56 your@193.60-193.76 furniture@193.82-194.30 on@194.48-194.56 Facebook@194.66-195.16 Marketplace.@195.20-195.86"),
  ];
  const places = {
    scenes: [
      scene(10, 34.6801, 41.1439),
      scene(11, 41.1439, 48.2104, { hostPresent: true, split: true }),
      scene(21, 64.4178, 75.2581),
      scene(22, 75.2581, 80),
      scene(29, 135.567, 143.367),
      scene(30, 143.367, 153.654),
      scene(32, 158.189, 168.437),
      scene(33, 168.437, 175),
      scene(36, 188.733, 196.437, { hostPresent: true, split: true }),
    ],
  };
  const placeCuts = places.scenes.map(s => s.narrationStartSec);
  const chapter = (n: number, title: string, start: string, durationSec: number): CueSpec => ({ id: `chapter-${n}`, template: "ChapterLabel", start, startPad: -0.15, durationSec, props: { title, kicker: `Where to sell · ${n} of 5`, number: n } });
  const series = [
    chapter(1, "Sort by size", "Number one. Sort your finished", 4.5),
    chapter(2, "Etsy for reach", "Number two. Use Etsy for", 3.5),
    chapter(3, "The ad fee", "Number three, the one I promised", 1.4),
    chapter(4, "Craft fairs", "Number four. Take your smalls", 3.5),
    chapter(5, "Marketplace", "Number five. Sell your furniture", 4.5),
  ];
  const fee: CueSpec = { id: "regular-fee-10", template: "BigNumber", start: "Etsy's regular fees take roughly $10", startPad: -0.15, end: "off a $100 board.", endPad: 0.3, props: { at: "@$10", line: { text: "Etsy's regular fees take roughly", words: true }, unit: "in fees", value: 10, kicker: "On a $100 board", prefix: "$", countSec: 0.6 } };

  it("a chapter planned at 1.4 s is raised to 1.5 s, never refused, and the fee card after it still fits", async () => {
    const { ask } = asking([...series, fee]);
    const out = await planGraphics({ words: counted, cuts: placeCuts, film: places, ask, ensureIcon: async () => true });
    // only the short one moves: 4.5 and 3.5 (and job 395's 3.2) are already long enough to read
    expect(out.cues.filter(c => c.template === "ChapterLabel").map(c => c.durationSec)).toEqual([4.5, 3.5, 1.5, 3.5, 4.5]);
    const three = out.resolved.find(c => c.id === "chapter-3")!;
    expect(three.endFrame - three.startFrame).toBe(45);
    const card = out.resolved.find(c => c.id === "regular-fee-10")!;
    expect(card.start - three.end).toBeGreaterThanOrEqual(1);
    expect(out.rounds[0].problems).toEqual([]);
  });

  it("an APPROVED chapter keeps the length it was approved with (QA reports it, the planner does not change it)", async () => {
    const { ask } = asking([]);
    const out = await planGraphics({ words: counted, cuts: placeCuts, film: places, kept: series, ask, ensureIcon: async () => true });
    expect(out.cues.find(c => c.id === "chapter-3")!.durationSec).toBe(1.4);
    expect(out.lostKept).toEqual([]);
  });
});

describe("the planner reads what the FILM says over each picture, on the resolver's clock (Dale's job 397, found by the audit)", () => {
  // Job 397 scenes 34-37 as laid out, and the film's own words over them. The storyboard put
  // "…$500 to $1,500. Number five." under b-roll scene 35; the film says it over host scene 36.
  const heard = T(
    "Coasters@173.56-174.04 and@174.10-174.20 ornaments@174.30-174.72 are@174.84-174.96 impulse@175.12-175.54 buys.@175.60-175.97 People@176.66-176.93 decide@176.97-177.39 on@177.45-177.53 them@177.57-177.73 because@177.79-178.13 they're@178.17-178.41 already@178.45-178.77 holding@178.85-179.17 one.@179.29-179.41 " +
      "Put@179.99-180.15 the@180.17-180.57 $10@180.61-181.01 to@181.07-181.57 $40@181.69-181.95 items@182.07-182.35 along@182.47-182.71 the@182.75-182.83 front@182.97-183.21 edge@183.29-183.43 of@183.47-183.53 the@183.57-183.65 table,@183.71-184.07 where@184.23-184.41 hands@184.47-184.83 reach@184.93-185.15 first.@185.23-185.59 " +
      "One@186.35-186.45 Good@186.49-186.69 Saturday@186.73-187.15 market@187.21-187.55 can@187.61-187.75 gross@187.79-188.03 $500@188.35-189.21 to@189.29-189.74 $1,500.@190.25-191.42 Number@192.06-192.30 five,@192.38-192.74 " +
      "sell@193.36-193.56 your@193.60-193.76 furniture@193.82-194.30 on@194.48-194.56 Facebook@194.66-195.16 Marketplace.@195.20-195.86 " +
      "Shipping@196.62-196.94 a@196.98-197.02 bookcase@197.10-197.66 eats@197.80-198.00 the@198.06-198.14 profit,@198.20-198.70 and@199.06-199.18 hauling@199.26-199.58 one@199.66-199.76 to@199.80-199.92 a@199.98-200.00 fair@200.12-200.46 eats@200.60-200.78 the@200.84-200.94 booth.@200.98-201.28"
  );
  const film = {
    scenes: [
      scene(34, 173.429, 179.89, { hostPresent: true, split: true, scriptText: "Coasters and ornaments are impulse buys. People decide on them because they're already holding one." }),
      scene(35, 179.89, 188.733, { scriptText: "Put the $10 to $40 items along the front edge of the table where hands reach first. One good Saturday market can gross $500 to $1,500. Number five." }),
      scene(36, 188.733, 196.437, { hostPresent: true, split: true, scriptText: "Sell your furniture on Facebook Marketplace." }),
      scene(37, 196.437, 201.838, { scriptText: "Shipping a bookcase eats the profit, and hauling one to a fair eats the booth." }),
    ],
  };

  it("scene 35's line stops where the film cuts to the host; the rest of its sentence is read under host scene 36", () => {
    const said = wordsSaidOver(film, heard);
    expect(said[1]).toBe("Put the $10 to $40 items along the front edge of the table, where hands reach first. One Good Saturday market can gross");
    // "$500" (188.35-189.21) is said mostly after the cut at 188.73: it goes with the host
    expect(said[2]).toBe("$500 to $1,500. Number five, sell your furniture on Facebook Marketplace.");
  });

  it("a scene whose words the film says under it keeps its script text, as written", () => {
    const said = wordsSaidOver(film, heard);
    expect(said[0]).toBe(film.scenes[0].scriptText);
    expect(said[3]).toBe(film.scenes[3].scriptText);
  });

  it("the scene list and the b-roll stretches read the same words", () => {
    const msg = userPrompt(film, [], heard);
    expect(msg).toContain("#35 2:59.9-3:08.7 B-ROLL: Put the $10 to $40 items along the front edge of the table, where hands reach first. One Good Saturday market can gross\n");
    expect(msg).toContain("#36 3:08.7-3:16.4 SPLIT (host left, picture right): $500 to $1,500. Number five, sell your furniture on Facebook Marketplace.");
    const stretches = msg.split("B-ROLL STRETCHES")[1];
    expect(stretches).toContain("2:59.9-3:08.7 (8.8 s): Put the $10 to $40 items");
    expect(stretches).not.toContain("$1,500");
  });

  it("with no transcript (a test that passes no words) every scene reads its script text, as before", () => {
    expect(wordsSaidOver(film, [])).toEqual(film.scenes.map(s => s.scriptText));
    expect(userPrompt(film, [])).toContain("#35 2:59.9-3:08.7 B-ROLL: Put the $10 to $40 items along the front edge of the table where hands reach first. One good Saturday market can gross $500 to $1,500. Number five.");
  });

  it("the rules still refuse a number label over the host there — the planner now reads those words under the host", async () => {
    const saturday: CueSpec = { id: "saturday-gross", template: "NumberLabel", start: "One good Saturday market can", startPad: -0.15, end: "$500 to $1,500.", endPad: 0.3, props: { kicker: "Price", a: { label: "From", value: "$500", at: "@$500" }, b: { label: "To", value: "$1,500", at: "@$1,500" } } };
    const asked: string[] = [];
    const ask = async (_system: string, messages: PlanMessage[]) => {
      asked.push(messages[messages.length - 1].content);
      return asked.length === 1 ? JSON.stringify({ cues: [saturday] }) : '{"cues": []}';
    };
    const out = await planGraphics({ words: heard, cuts: film.scenes.map(s => s.narrationStartSec), film, ask, ensureIcon: async () => true });
    expect(asked[0]).toContain("SPLIT (host left, picture right): $500 to $1,500. Number five,");
    expect(out.cues.map(c => c.id)).not.toContain("saturday-gross");
    expect(out.rounds[0].problems).toContainEqual({ cue: "saturday-gross", problem: "points at the picture over host scene 36 — only over b-roll" });
  });
});

describe("what is said over a picture comes from the film's sound only where it differs from the script", () => {
  it("Hank's job 398: 'with' is said after the cut, so it is read under the saw, not under the host", () => {
    const heard = T("I'm@25.07-25.21 Hank@25.25-25.47 Hardwood.@25.51-25.95 And@26.94-27.04 this@27.08-27.22 one's@27.36-27.50 for@27.56-27.68 anybody@27.74-28.18 standing@28.24-28.68 in@28.72-28.80 a@28.82-28.84 garage@28.90-29.38 with@29.42-29.58 a@29.62-29.64 saw,@29.74-30.08 a@30.38-30.40 drill,@30.46-30.84");
    const film = {
      scenes: [
        scene(4, 24.8807, 29.45955, { hostPresent: true, scriptText: "I'm Hank Hardwood, and this one's for anybody standing in a garage with" }),
        scene(5, 29.45955, 30.2002, { scriptText: "a saw," }),
        scene(6, 30.2002, 30.849, { scriptText: "a drill," }),
      ],
    };
    expect(wordsSaidOver(film, heard)).toEqual(["I'm Hank Hardwood. And this one's for anybody standing in a garage", "with a saw,", "a drill,"]);
  });

  it("Dale's job 397, 0:14-0:31: a word that runs a little past a cut stays with the scene holding its middle, so clean list shots keep their script", () => {
    // "ranking" (19.05-19.39) crosses the cut at 19.37 and "Marketplace" (21.81-22.45) the one at
    // 22.44: both are said mostly before the cut, so nothing moves and no line changes.
    const heard = T(
      "The@14.63-14.71 place@14.74-14.96 you@14.98-15.13 tried@15.15-15.37 to@15.39-15.47 sell@15.55-15.79 it@15.85-15.93 just@16.15-16.39 wasn't@16.45-16.75 built@16.85-17.11 for@17.17-17.27 that@17.31-17.47 piece.@17.55-17.85 Today,@18.45-18.75 I'm@18.87-18.99 ranking@19.05-19.39 " +
        "Etsy,@19.55-19.93 craft@20.11-20.43 fairs,@20.49-20.85 and@21.05-21.19 Facebook@21.27-21.73 Marketplace@21.81-22.45 " +
        "by@22.55-22.67 what@22.71-22.87 each@23.01-23.19 one@23.35-23.45 actually@23.71-24.17 does@24.23-24.49 well.@24.61-24.91 And@25.67-25.81 hang@25.95-26.19 on@26.31-26.41 for@26.45-26.57 the@26.61-26.69 Etsy@26.87-27.19 fee@27.27-27.51 that@27.57-27.69 can@27.73-27.87 more@27.95-28.13 than@28.17-28.33 double@28.55-28.91 what@28.97-29.11 comes@29.17-29.39 out@29.47-29.57 of@29.61-29.67 a@29.71-29.73 single@29.85-30.21 sale.@30.29-30.61"
    );
    const film = {
      scenes: [
        scene(4, 14.5177, 19.37115, { scriptText: "The place you tried to sell it just wasn't built for that piece. Today I'm ranking" }),
        scene(5, 19.37115, 19.9447, { scriptText: "Etsy," }),
        scene(6, 19.9447, 20.986, { scriptText: "craft fairs," }),
        scene(7, 20.986, 22.4422, { scriptText: "and Facebook Marketplace" }),
        scene(8, 22.4422, 31.1802, { scriptText: "by what each one actually does well. And hang on for the Etsy fee that can more than double what comes out of a single sale." }),
      ],
    };
    expect(wordsSaidOver(film, heard)).toEqual(film.scenes.map(s => s.scriptText));
  });

  it("Hank's job 398: a line the film says word for word keeps the script's spelling ('out of square' heard 'out a square', '2 hours' heard 'two hours')", () => {
    const heard = T(
      "Every@62.17-62.41 place@62.47-62.79 two@62.87-63.11 strips@63.15-63.49 cross@63.59-63.99 needs@64.09-64.31 a@64.37-64.39 notch@64.47-64.75 cut@64.81-65.07 halfway@65.69-66.11 through@66.15-66.47 each@66.69-66.87 one.@67.09-67.23 And@68.05-68.15 every@68.21-68.41 notch@68.47-68.73 has@68.77-68.97 to@69.01-69.09 be@69.13-69.25 dead@69.29-69.53 on@69.71-69.83 or@69.91-70.03 the@70.25-70.37 whole@70.41-70.63 grid@70.69-70.99 twists@71.05-71.39 out@71.47-71.59 a@71.63-71.67 square.@71.73-72.09 I@72.93-73.01 figured@73.07-73.41 two@73.47-73.65 hours.@73.71-74.11 It@74.91-74.99 took@75.03-75.25 six.@75.33-75.69"
    );
    const text = "Every place two strips cross needs a notch cut halfway through each one, and every notch has to be dead on or the whole grid twists out of square. I figured 2 hours. It took 6.";
    expect(wordsSaidOver({ scenes: [scene(14, 61.9612, 76.5018, { scriptText: text })] }, heard)).toEqual([text]);
  });

  it("Dale's job 397 scene 1: words the film's transcript does not hear are not offered (no cue could be placed on them)", () => {
    const heard = T("and@1.32-1.44 maple@1.52-1.86 cutting@1.94-2.26 board@2.30-2.52 a@2.54-2.58 few@2.62-2.76 weeks@2.80-3.02 back.@3.08-3.36 It's@3.90-4.06 still@4.14-4.40");
    const film = { scenes: [scene(1, 0, 3.6785, { hostPresent: true, hostOpener: true, scriptText: "You finished a walnut and maple cutting board a few weeks back." }), scene(2, 3.6785, 6.87225, { scriptText: "It's still leaning against the wall in your garage." })] };
    expect(wordsSaidOver(film, heard)[0]).toBe("and maple cutting board a few weeks back.");
  });

  it("a span with no words heard keeps its script text", () => {
    const heard = T("Number@168.58-168.82 four,@168.90-169.16");
    const film = { scenes: [scene(33, 168.437, 173.429, { scriptText: "Number four." }), scene(34, 173.429, 179.89, { hostPresent: true, scriptText: "Coasters and ornaments are impulse buys." })] };
    expect(wordsSaidOver(film, heard)).toEqual(["Number four.", "Coasters and ornaments are impulse buys."]);
  });
});

describe("every round of the plan says what it asked, and the fill round what it offered (G1, Dale's job 397, found by the audit)", () => {
  // Dale's job 397, 0:47-0:56 as heard: "Smalls, about $10 to $40." has no graphic in the film, and
  // the rules accept a number label on it — nothing on the job said whether it was offered, asked
  // for and refused, or passed over.
  const heard = T(
    "them.@47.52-47.68 Three@48.38-48.64 piles.@48.70-49.12 Smalls,@49.68-50.14 about@50.50-50.74 $10@50.94-51.54 to@51.62-51.70 $40.@51.78-52.48 Coasters,@53.16-53.72 ornaments,@54.00-54.42 small@54.70-54.96 cutting@55.00-55.28 boards.@55.32-55.62"
  );
  const film = (host = false) => ({
    scenes: [
      scene(12, 48.2104, 49.4569, { scriptText: "Three piles." }),
      scene(13, 49.4569, 53.0381, { hostPresent: host, scriptText: "Smalls, about $10 to $40." }),
      scene(14, 53.0381, 56.2, { scriptText: "Coasters, ornaments, small cutting boards." }),
    ],
  });
  const cuts = [48.2104, 49.4569, 53.0381, 56.2];
  const smallsPrice: CueSpec = { id: "probe-smalls-price", template: "NumberLabel", start: "Smalls, about $10", startPad: -0.15, end: "to $40.", endPad: 0.3, props: { kicker: "Smalls", a: { label: "From", value: "$10", at: "@$10" }, b: { label: "To", value: "$40", at: "@$40" } } };
  /** The model plans nothing at first, then answers the fill round (and its repair) in turn. */
  const answering = (...later: (CueSpec[] | Error)[]) => {
    let n = 0;
    return async () => {
      const a = n++ === 0 ? [] : (later.shift() ?? []);
      if (a instanceof Error) throw a;
      return JSON.stringify({ cues: a });
    };
  };

  it("a sentence the model passed over is recorded as offered, with no cue asked for it", async () => {
    const out = await planGraphics({ words: heard, cuts, film: film(), ask: answering([]), ensureIcon: async () => true });
    expect(out.rounds.map(r => r.step)).toEqual(["first", "fill"]);
    const fill = out.rounds[1];
    expect(fill).toMatchObject({ asked: 0, kept: 0, problems: [] });
    // only the sentence with a moment: "Three piles." is too short, the list names no number
    expect(fill.offered).toEqual([{ from: 49.68, to: 52.48, text: "Smalls, about $10 to $40.", asked: [], placed: false }]);
  });

  it("a cue asked for it and kept: the sentence is placed, with the cue's id", async () => {
    const out = await planGraphics({ words: heard, cuts, film: film(), ask: answering([smallsPrice]), ensureIcon: async () => true });
    expect(out.cues.map(c => c.id)).toEqual(["probe-smalls-price"]);
    const fill = out.rounds.find(r => r.step === "fill")!;
    expect(fill).toMatchObject({ asked: 1, kept: 1, problems: [] });
    expect(fill.offered).toEqual([expect.objectContaining({ text: "Smalls, about $10 to $40.", asked: ["probe-smalls-price"], placed: true })]);
  });

  it("a cue asked for it and refused: the id is on the sentence and the reason in the round's problems", async () => {
    // The same line over the host: a number label points at the picture, so the rules refuse it.
    const out = await planGraphics({ words: heard, cuts, film: film(true), ask: answering([smallsPrice], []), ensureIcon: async () => true });
    expect(out.cues).toEqual([]);
    expect(out.rounds.map(r => r.step)).toEqual(["first", "fill", "fill repair"]);
    const fill = out.rounds[1];
    expect(fill.problems).toContainEqual({ cue: "probe-smalls-price", problem: "points at the picture over host scene 13 — only over b-roll" });
    expect(fill.offered).toEqual([expect.objectContaining({ asked: ["probe-smalls-price"], placed: false })]);
    expect(out.rounds[2]).toMatchObject({ asked: 0, kept: 0, problems: [] });
  });

  it("a fill call that fails is recorded with its reason, the sentences still listed", async () => {
    const out = await planGraphics({ words: heard, cuts, film: film(), ask: answering(new Error("overloaded")), ensureIcon: async () => true });
    const fill = out.rounds.find(r => r.step === "fill")!;
    expect(fill.error).toBe("overloaded");
    expect(fill.offered?.map(o => [o.text, o.asked.length, o.placed])).toEqual([["Smalls, about $10 to $40.", 0, false]]);
  });

  it("no fill round when nothing is offered (the moment is in the call to action)", async () => {
    const cta = { scenes: film().scenes.map(s => (s.index === 13 ? { ...s, cta: true } : s)) };
    const out = await planGraphics({ words: heard, cuts, film: cta, ask: answering([smallsPrice]), ensureIcon: async () => true });
    expect(out.rounds.map(r => r.step)).toEqual(["first"]);
    expect(out.rounds[0].offered).toBeUndefined();
  });

  it("a cue is put on the sentence it starts in, not the one before (a lead-in pad before the first word still counts)", async () => {
    const later = T("Put@179.99-180.15 the@180.17-180.57 $10@180.61-181.01 to@181.07-181.57 $40@181.69-181.95 items@182.07-182.35 along@182.47-182.71 the@182.75-182.83 front@182.97-183.21 edge.@183.29-183.43");
    const twice = { scenes: [...film().scenes, scene(35, 179.89, 188.733, { scriptText: "Put the $10 to $40 items along the front edge." })] };
    const putItems: CueSpec = { id: "front-edge-price", template: "NumberLabel", start: "Put the $10 to $40", startPad: -0.15, end: "items along the front edge.", endPad: 0.3, props: { kicker: "Front edge", a: { label: "From", value: "$10", at: "@$10" }, b: { label: "To", value: "$40", at: "@$40" } } };
    const out = await planGraphics({ words: [...heard, ...later], cuts: [...cuts, 179.89, 188.733], film: twice, ask: answering([putItems]), ensureIcon: async () => true });
    const offered = out.rounds.find(r => r.step === "fill")!.offered!;
    expect(offered.map(o => [o.text, o.asked, o.placed])).toEqual([
      ["Smalls, about $10 to $40.", [], false],
      ["Put the $10 to $40 items along the front edge.", ["front-edge-price"], true],
    ]);
  });

  it("a cue whose start snapped back onto the picture cut in the pause before its sentence is still asked for that sentence", async () => {
    // The shot changes 0.43 s before "Smalls," (in the pause after "piles."): the cue's padded start
    // snaps back onto that cut, more than a lead-in pad before the first word. Refused over the host,
    // it must read "asked and refused", not "passed over".
    const early = {
      scenes: [
        scene(12, 48.2104, 49.25, { scriptText: "Three piles." }),
        scene(13, 49.25, 53.0381, { hostPresent: true, scriptText: "Smalls, about $10 to $40." }),
        scene(14, 53.0381, 56.2, { scriptText: "Coasters, ornaments, small cutting boards." }),
      ],
    };
    const out = await planGraphics({ words: heard, cuts: [48.2104, 49.25, 53.0381, 56.2], film: early, ask: answering([smallsPrice], []), ensureIcon: async () => true });
    const fill = out.rounds.find(r => r.step === "fill")!;
    expect(fill.problems.map(p => p.cue)).toEqual(["probe-smalls-price"]);
    expect(fill.offered).toEqual([expect.objectContaining({ text: "Smalls, about $10 to $40.", asked: ["probe-smalls-price"], placed: false })]);
  });

  it("a cue that starts on a sentence that was not offered is not put on the offered one after it", async () => {
    // "Three piles." is not offered (too short to be a moment); a cue on it belongs to no offered sentence.
    const piles: CueSpec = { id: "three-piles", template: "BigNumberOverlay", start: "Three piles.", startPad: -0.15, end: "Three piles.", endPad: 0.3, props: { at: "@Three piles.", unit: "piles", value: 3, kicker: "Sort into", countSec: 0.6 } };
    const out = await planGraphics({ words: heard, cuts, film: film(), ask: answering([piles], []), ensureIcon: async () => true });
    const fill = out.rounds.find(r => r.step === "fill")!;
    expect(fill.asked).toBe(1);
    expect(fill.offered).toEqual([expect.objectContaining({ text: "Smalls, about $10 to $40.", asked: [], placed: false })]);
  });
});

describe("a warning says what to avoid, never advises doing it (A4, Helena's job 399 'dont-ask-too-early')", () => {
  // Job 399, 2:08-2:21 as heard. The script: "Ask while the cart is still working its way back, and
  // you're asking the crew to guess whether the last few rows will come up short. So wait until
  // everyone's been served, …" — the card showed only the first ten words under WARNING.
  const heard = T(
    "You're@128.19-128.39 also@128.45-128.71 welcome@128.77-129.07 to@129.09-129.15 ask@129.25-129.41 for@129.45-129.59 another.@129.65-130.03 And@130.47-130.57 the@130.59-130.67 only@130.79-131.01 real@131.17-131.41 trick@131.49-131.77 is@132.01-132.11 when.@132.23-132.51 " +
      "Ask@133.33-133.51 while@133.55-133.69 the@133.73-133.81 cart@133.85-134.09 is@134.17-134.25 still@134.33-134.61 working@134.67-134.97 its@135.03-135.16 way@135.22-135.34 back.@135.41-135.63 And@135.98-136.04 you're@136.06-136.22 asking@136.26-136.56 the@136.58-136.66 crew@136.74-137.02 to@137.10-137.18 guess@137.24-137.50 whether@137.54-137.78 the@137.84-137.92 last@137.98-138.22 few@138.28-138.46 rows@138.52-138.82 will@138.84-139.00 come@139.04-139.16 up@139.22-139.30 short.@139.38-139.70 " +
      "So@139.98-140.21 wait@140.38-140.59 until@140.63-140.88 everyone's@141.03-141.43 been@141.47-141.63"
  );
  const film = {
    scenes: [
      scene(23, 128.09, 133.11, { hostPresent: true, split: true, scriptText: "You're also welcome to ask for another, and the only real trick is when." }),
      scene(24, 133.11, 139.81, { scriptText: "Ask while the cart is still working its way back, and you're asking the crew to guess whether the last few rows will come up short." }),
      scene(25, 139.81, 144.66, { hostPresent: true, scriptText: "So wait until everyone's been served, then catch a flight attendant as they pass," }),
    ],
  };
  const cuts = [128.09, 133.11, 139.81, 144.66];
  const dontAsk: CueSpec = { id: "dont-ask-too-early", template: "WarningLabel", start: "Ask while the cart is still", startPad: -0.15, end: "working its way back,", endPad: 0.3, props: { text: { text: "Ask while the cart is still working its way back,", words: true }, emphasis: ["back,"] } };
  const asking = (first: CueSpec[]) => {
    const asked: string[] = [];
    const ask = async (_system: string, messages: PlanMessage[]) => {
      asked.push(messages[messages.length - 1].content);
      return asked.length === 1 ? JSON.stringify({ cues: first }) : '{"cues": []}';
    };
    return { ask, asked };
  };

  it("the half of a 'do X, and [bad result]' warning that says 'do X' is not a warning; nor is the right way, or any instruction", () => {
    expect(namesTheDanger("Ask while the cart is still working its way back,")).toBe(false);
    expect(namesTheDanger("So wait until everyone's been served,")).toBe(false); // the right way: another template
    expect(namesTheDanger("Sort your finished pieces by size and price")).toBe(false); // Dale's job 397
    // a word that only CONTAINS a cue is not one
    expect(namesTheDanger("Take a note of the date now")).toBe(false);
  });

  it("every warning the planner placed before still passes (jobs 350, 376, 382, 384, 385, 387) — and the template's own example", () => {
    for (const real of [
      "These bowls are not for hot food or the microwave",
      "Keep all ten fingers away from that rotary cutter",
      "No date at all? It's old enough.",
      "Every notch has to be dead on",
      "Smoke alarms expire. At 10 years the unit is finished.",
      "It happens to be slow at the one kind of fire that likes to start while the house is asleep.",
      "The old 9-volt battery starts chirping, somebody yanks it out, and that alarm is now doing absolutely nothing.",
      "The mistake with pearls is saving them.",
      String((TEMPLATES.find(t => t.id === "WarningLabel")!.defaultProps as { text: { text: string } }).text.text),
    ])
      expect(namesTheDanger(real), real).toBe(true);
    // curly apostrophes, as a script may be typed
    expect(namesTheDanger("Don’t sand past 220")).toBe(true);
    expect(namesTheDanger("Ask too early and the cart is empty")).toBe(true);
  });

  it("a sentence of its own that only names the thing to avoid is a warning (Scarlett's job 395); a command or advice dressed as one is not", () => {
    // job 395: "Now the one that's aging you. Chunky black or very dark beads." — placed as dark-beads-warning
    expect(namesTheDanger("Chunky black or very dark beads.")).toBe(true);
    expect(namesTheDanger("Sanding past 220 grit.")).toBe(true);
    expect(namesTheDanger("A neighbour’s ladder against the wall.")).toBe(true); // a possessive is a thing
    // …but never a line that commands, speaks to someone, or stops before its sentence ends
    expect(namesTheDanger("Chunky black or very dark beads")).toBe(false); // said as part of a longer sentence
    expect(namesTheDanger("Either way, leave enough room in the price")).toBe(false); // Dale's job 389: the right way
    expect(namesTheDanger("Either way, leave enough room in the price.")).toBe(false);
    expect(namesTheDanger("Use the cheapest glue.")).toBe(false); // a command, whole sentence
    expect(namesTheDanger("Ask while the cart is still working its way back.")).toBe(false); // job 399 with a full stop
    expect(namesTheDanger("Your finished pieces by size and price.")).toBe(false); // speaks to the viewer
    expect(namesTheDanger("The glue is fine indoors,")).toBe(false); // the safe half of a contrast
    expect(namesTheDanger("The glue is fine indoors.")).toBe(false);
    expect(namesTheDanger("So wait until everyone’s been served.")).toBe(false);
  });

  it("the prompt's own examples agree with the check: its warnings pass, its 'do X' half does not", () => {
    const prompt = systemPrompt({ kept: false });
    for (const ok of ["Never leave it plugged in overnight", "The glue fails in the cold", "Cheap plastic hinges."]) {
      expect(prompt).toContain(ok);
      expect(namesTheDanger(ok)).toBe(true);
    }
    expect(prompt).toContain("Open it while it's hot, and the jar cracks");
    expect(namesTheDanger("Open it while it's hot,")).toBe(false);
  });

  it("job 399's card is refused, and the repair is told to name the danger or show the right way with another template", async () => {
    const { ask, asked } = asking([dontAsk]);
    const out = await planGraphics({ words: heard, cuts, film, ask, ensureIcon: async () => true });
    expect(out.cues.map(c => c.id)).not.toContain("dont-ask-too-early");
    expect(out.rounds[0].problems).toEqual([
      { cue: "dont-ask-too-early", problem: expect.stringMatching(/^"Ask while the cart is still working its way back," does not say what to avoid or what goes wrong — read alone under WARNING it tells the viewer to DO it\. .*another template/) },
    ]);
    expect(asked[1]).toContain('dont-ask-too-early: "Ask while the cart is still working its way back," does not say what to avoid');
  });

  it("a real warning on the narrator's words is kept as before (Ruth's job 350)", async () => {
    const words = W("These bowls are not for hot food or the microwave.", 10);
    const bowls: CueSpec = { id: "no-hot-food", template: "WarningLabel", start: "These bowls are not for", startPad: -0.15, end: "or the microwave.", endPad: 0.3, props: { text: { text: "These bowls are not for hot food or the microwave", words: true }, emphasis: ["hot"] } };
    const { ask } = asking([bowls]);
    const out = await planGraphics({ words, film: { scenes: [scene(9, 9, 16, { scriptText: "These bowls are not for hot food or the microwave." })] }, ask, ensureIcon: async () => true });
    expect(out.cues.map(c => c.id)).toEqual(["no-hot-food"]);
    expect(out.rounds[0].problems).toEqual([]);
  });
});

describe("a quote is the host's own words, never a line the viewer is told to say (A5, Helena's job 399 'keep-the-can-quote')", () => {
  // Job 399, 1:18-1:28 as heard. The script (scene 17): "…spent nursing a thimble of ginger ale. So when
  // the cart reaches your row, speak up. "Could I keep the rest of the can, please?"" — the card showed
  // the last sentence signed "— HELENA HART": the host, a flight attendant, asking for the can.
  const heard = T(
    "nursing@78.55-78.89 a@78.93-78.97 thimble@79.11-79.47 of@79.51-79.57 ginger@79.61-79.91 ale.@80.01-80.23 So@80.89-80.99 when@81.01-81.13 the@81.15-81.23 cart@81.27-81.51 reaches@81.55-81.83 your@81.87-82.01 row,@82.07-82.36 speak@82.72-82.97 up.@83.11-83.17 " +
      "Could@83.77-83.91 I@83.93-84.01 keep@84.05-84.21 the@84.25-84.33 rest@84.37-84.51 of@84.53-84.59 the@84.61-84.69 can,@84.71-84.99 please?@85.01-85.31 " +
      "Juice@86.05-86.31 works@86.37-86.59 the@86.65-86.73 same@86.77-86.99 way.@87.05-87.29 If@87.97-88.03 they're@88.07-88.25 running@88.27-88.49"
  );
  const s17 = 'I figured that out much too late, after more flights than I care to count spent nursing a thimble of ginger ale. So when the cart reaches your row, speak up. "Could I keep the rest of the can, please?"';
  const film = {
    scenes: [
      scene(17, 73.71, 85.87, { scriptText: s17 }),
      scene(18, 85.87, 92.12, { scriptText: "Juice works the same way. If they're running short, they'll tell you, and you're no worse off for trying." }),
    ],
  };
  const cuts = [73.71, 85.87, 92.12];
  // the planner's own cue, as saved on job 399
  const keepTheCan: CueSpec = { id: "keep-the-can-quote", template: "Quote", start: "Could I keep the rest of", startPad: -0.15, end: "of the can, please", endPad: 0.2, props: { quote: { text: "Could I keep the rest of the can, please?", words: true }, author: "Helena Hart", emphasis: ["can,"] } };
  const asking = (answers: CueSpec[][]) => {
    const asked: string[] = [];
    const ask = async (_system: string, messages: PlanMessage[]) => {
      asked.push(messages[messages.length - 1].content);
      return JSON.stringify({ cues: answers[asked.length - 1] ?? [] });
    };
    return { ask, asked };
  };

  it("the line the viewer is told to say is not the host's: refused with its lead-in, and as a request on its own", () => {
    expect(notTheHostsWords("Could I keep the rest of the can, please?", "So when the cart reaches your row, speak up.")).toMatch(/request to someone/);
    expect(notTheHostsWords("Could I keep the rest of the can, please?")).toMatch(/request to someone/);
    // other shapes of a line handed to the viewer, or of a request to someone (neutral)
    expect(notTheHostsWords("Can we get the bigger one?", "Then ask the clerk.")).toMatch(/hands it to the viewer to say \("…ask the clerk"\)/);
    expect(notTheHostsWords("Could I see the one in the window?", "So when they come by, speak up.")).toMatch(/hands it to the viewer to say \("…by, speak up"\)/);
    expect(notTheHostsWords("I'll take the whole jar.", "Just say it:")).toMatch(/hands it to the viewer/);
    expect(notTheHostsWords("The price is the price.", "So say it plainly.", true)).toMatch(/hands it to the viewer/); // in quotation marks
    expect(notTheHostsWords("“The price is the price.”", "So say it plainly.")).toMatch(/hands it to the viewer/);
    expect(notTheHostsWords("Thanks, I'll keep the receipt.", "And tell them.")).toMatch(/hands it to the viewer/);
    expect(notTheHostsWords("Would you mind holding it for a day?")).toMatch(/request/);
    expect(notTheHostsWords("Excuse me, is this seat taken?")).toMatch(/request/);
    expect(notTheHostsWords("I'd like the aisle seat, please.")).toMatch(/request/);
  });

  it("the host's own sayings still pass — every Quote placed in earlier films, with the words really said before it (jobs 376, 383, 389)", () => {
    expect(notTheHostsWords("Close the bedroom doors at night.", "One more, and it's free.")).toBeUndefined();
    expect(notTheHostsWords("Its job is catching the slow part.", "So the alarm's real job was never the flame.")).toBeUndefined();
    // Dale's lead-in tells the viewer to say something — and what about, so it hands no line over
    expect(
      notTheHostsWords(
        "Build it well, price it honest, and let every piece find its lane.",
        "For more shop-tested fixes like these, subscribe to Dale Oakfield's Workshop, and tell me in the comments which of the three sells best where you live."
      )
    ).toBeUndefined();
    const template = TEMPLATES.find(t => t.id === "Quote")!.defaultProps as { quote: { text: string } };
    expect(notTheHostsWords(template.quote.text)).toBeUndefined();
  });

  it("after 'speak up' or 'ask', the host's own advice or question is still the host's; a speech verb with a subject is the host speaking", () => {
    expect(notTheHostsWords("Nobody minds being asked twice.", "So speak up.")).toBeUndefined();
    expect(notTheHostsWords("What's the worst they can say?", "Just ask.")).toBeUndefined();
    expect(notTheHostsWords("I never sell anything I wouldn't use myself.", "Here's what I tell everyone who asks.")).toBeUndefined();
    expect(notTheHostsWords("Cheap pine warps in a year.", "Ask the seller about the wood.")).toBeUndefined();
    expect(notTheHostsWords("Never stop asking for the receipt.", "Don't ask.")).toBeUndefined();
    // a quoted line with no lead-in handing it over is not refused here
    expect(notTheHostsWords("Slow is smooth.", "I tell myself the same thing every morning.", true)).toBeUndefined();
    // "please" in the host's own advice to the viewer, said as a statement
    expect(notTheHostsWords("Please check your alarms tonight.")).toBeUndefined();
  });

  it("reads the quotation marks off the script, never a closing mark of the speech before", () => {
    expect(quotedInScript(film, 83.77, 85.31, "Could I keep the rest of the can, please?")).toBe(true);
    const curly = { scenes: [scene(1, 0, 10, { scriptText: "So when the cart reaches your row, speak up. “Could I keep the rest of the can, please?”" })] };
    expect(quotedInScript(curly, 2, 4, "Could I keep the rest of the can, please?")).toBe(true);
    const closing = { scenes: [scene(1, 0, 10, { scriptText: 'She just said "No." Could I have done more?' })] };
    expect(quotedInScript(closing, 2, 4, "Could I have done more?")).toBe(false);
    expect(quotedInScript({ scenes: [scene(1, 0, 10, { scriptText: "One more, and it's free. Close the bedroom doors at night." })] }, 2, 4, "Close the bedroom doors at night.")).toBe(false);
  });

  it("the prompt's own example agrees with the check", () => {
    const prompt = systemPrompt({ kept: false });
    expect(prompt).toContain('"Just ask: Could I get that in writing, please?"');
    expect(notTheHostsWords("Could I get that in writing, please?", "Just ask:")).toBeDefined();
  });

  it("job 399's quote is refused and the repair is steered to a caption with no name, which is kept", async () => {
    const caption: CueSpec = { id: "keep-the-can-caption", template: "DimCaption", start: "Could I keep the rest of", startPad: -0.15, end: "of the can, please", endPad: 0.2, props: { phrase: { text: "Could I keep the rest of the can, please?", words: true }, emphasis: ["please?"] } };
    const { ask, asked } = asking([[keepTheCan], [caption]]);
    const out = await planGraphics({ words: heard, cuts, film, ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([
      {
        cue: "keep-the-can-quote",
        problem: expect.stringMatching(/^"Could I keep the rest of the can, please\?" is not the host's own words — .*Signed with the host's name it reads as if the host said it\. Show it as a caption with no name \(DimCaption over b-roll\), or drop it$/),
      },
    ]);
    expect(asked[1]).toContain("keep-the-can-quote: \"Could I keep the rest of the can, please?\" is not the host's own words");
    expect(out.cues.map(c => c.id)).toEqual(["keep-the-can-caption"]);
  });

  it("the same line, unquoted in the script and with no 'please', is still refused by its lead-in", async () => {
    const plain = T("So@80.89-80.99 when@81.01-81.13 the@81.15-81.23 cart@81.27-81.51 comes,@81.55-81.83 speak@82.72-82.97 up.@83.11-83.17 Could@83.77-83.91 I@83.93-84.01 keep@84.05-84.21 the@84.25-84.33 whole@84.37-84.51 can?@84.53-84.99 Juice@86.05-86.31 works@86.37-86.59 the@86.65-86.73 same@86.77-86.99 way.@87.05-87.29");
    const plainFilm = { scenes: [scene(17, 73.71, 85.87, { scriptText: "So when the cart comes, speak up. Could I keep the whole can?" }), scene(18, 85.87, 92.12, { scriptText: "Juice works the same way." })] };
    const quote: CueSpec = { id: "q", template: "Quote", start: "Could I keep the whole", startPad: -0.15, end: "the whole can?", endPad: 0.2, props: { quote: { text: "Could I keep the whole can?", words: true }, author: "The Host" } };
    const { ask } = asking([[quote]]);
    const out = await planGraphics({ words: plain, cuts, film: plainFilm, ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([{ cue: "q", problem: expect.stringContaining('the narrator hands it to the viewer to say ("…comes, speak up")') }]);
  });

  it("a host's own closing saying on the narrator's words is kept as before (Dale's job 389)", async () => {
    const words = [
      ...W("For more shop-tested fixes like these, subscribe to Dale Oakfield's Workshop, and tell me in the comments which of the three sells best where you live.", 220),
      ...W("Build it well, price it honest, and let every piece find its lane.", 228),
    ];
    const closing: CueSpec = { id: "closing-quote", template: "Quote", start: "Build it well, price it", startPad: -0.15, end: "find its lane.", endPad: 0.3, props: { quote: { text: "Build it well, price it honest, and let every piece find its lane.", words: true }, author: "Dale Oakfield", emphasis: ["honest,"] } };
    const { ask } = asking([[closing]]);
    const out = await planGraphics({ words, film: { scenes: [scene(50, 219, 233, { scriptText: words.map(w => w.text).join(" ") })] }, ask, ensureIcon: async () => true });
    expect(out.cues.map(c => c.id)).toEqual(["closing-quote"]);
    expect(out.rounds[0].problems).toEqual([]);
  });
});

describe("a quote led in by the host's own 'I always say' is the host's; 'please' as a verb asks nothing (A5 review)", () => {
  // The first build read "always"/"just" as a command wherever it stood, so "Like I always say," — the
  // host introducing her OWN saying, the line a Quote is for — read as handing the viewer a line, and a
  // saying the script puts in quotation marks after it was refused. And any "please" before a "?" read
  // as a request, so a maxim with the VERB ("You can't please everyone, so why try?") was refused too.
  it("a speech verb after the host as its subject, adverb or not, hands nothing over", () => {
    expect(notTheHostsWords("Measure twice, cut once.", "Like I always say,", true)).toBeUndefined();
    expect(notTheHostsWords("Measure twice, cut once.", "Here's what I always say:", true)).toBeUndefined();
    expect(notTheHostsWords("Slow is smooth, and smooth is fast.", "As I always tell them:", true)).toBeUndefined();
    expect(notTheHostsWords("Why would I rush a good board?", "And I always ask:")).toBeUndefined();
    expect(notTheHostsWords("Thanks for the reminder, but I'll wait.", "And then I just say:", true)).toBeUndefined();
  });

  it("the same adverbs on a command at the start of a clause still hand the viewer a line", () => {
    expect(notTheHostsWords("Could I see the one in the window?", "So always ask:")).toMatch(/hands it to the viewer/);
    expect(notTheHostsWords("Could I see the one in the window?", "When they come by, just ask.")).toMatch(/hands it to the viewer/);
    expect(notTheHostsWords("Could I see the one in the window?", "Why not just ask?")).toMatch(/hands it to the viewer/);
    expect(notTheHostsWords("Could I see the one in the window?", "You can simply ask the clerk.")).toMatch(/hands it to the viewer/);
    expect(notTheHostsWords("Can we get the bigger one?", "And then ask.")).toMatch(/hands it to the viewer/);
  });

  it("'please' as a verb is no request; the courtesy word still is", () => {
    expect(notTheHostsWords("You can't please everyone, so why try?")).toBeUndefined();
    expect(notTheHostsWords("We want to please everyone, and that is the trap.")).toBeUndefined();
    expect(notTheHostsWords("Can you please everyone and still keep yourself?")).toBeUndefined();
    expect(notTheHostsWords("You cannot please everyone.", "So tell them.")).toBeUndefined();
    expect(notTheHostsWords("Could you please hold it for a day?")).toMatch(/request to someone/);
    expect(notTheHostsWords("We'd like the window seats, please.")).toMatch(/request to someone/);
    expect(notTheHostsWords("Please check your alarms tonight.", "So tell them.")).toMatch(/hands it to the viewer/);
  });

  it("planGraphics keeps a quoted saying after 'Like I always say,' — the script's quotation marks are the host's own", async () => {
    const words = [...W("Like I always say,", 10), ...W("Measure twice, cut once.", 11.6), ...W("Then the board is ready.", 14)];
    const film = { scenes: [scene(4, 9.5, 16, { scriptText: 'Like I always say, "Measure twice, cut once." Then the board is ready.' })] };
    expect(quotedInScript(film, 11.6, 12.5, "Measure twice, cut once.")).toBe(true);
    const quote: CueSpec = { id: "measure-quote", template: "Quote", start: "Measure twice, cut once", startPad: -0.15, end: "cut once.", endPad: 0.3, props: { quote: { text: "Measure twice, cut once.", words: true }, author: "The Host" } };
    const ask = async () => JSON.stringify({ cues: [quote] });
    const out = await planGraphics({ words, film, ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([]);
    expect(out.cues.map(c => c.id)).toEqual(["measure-quote"]);
  });
});

describe("steps are done one after another; a choice is not the next step (A6, Helena's job 399 'snack-ask-steps')", () => {
  // Job 399, 2:19.8-2:28.6 as heard. The script (sentence 32): "So wait until everyone's been served,
  // then catch a flight attendant as they pass, or step back to the galley, and phrase it as an offer."
  // The StepLabels chain read "1 Wait until served → 2 Catch an attendant → 3 Or step to galley → 4
  // Phrase it as offer": stepping back to the galley is another way to reach the crew, and the arrows
  // told the viewer to do both.
  const heard = T(
    "short.@139.38-139.70 So@139.98-140.21 wait@140.38-140.59 until@140.63-140.88 everyone's@141.03-141.43 been@141.47-141.63 served,@141.69-142.11 then@142.51-142.73 catch@142.79-143.01 a@143.05-143.07 flight@143.11-143.35 attendant@143.37-143.75 as@143.83-143.89 they@143.93-144.07 pass,@144.11-145.23 " +
      "or@145.25-145.29 step@145.43-145.67 back@145.71-145.85 to@145.91-145.99 the@146.01-146.09 galley@146.13-146.51 and@146.79-146.93 phrase@147.09-147.35 it@147.39-147.45 as@147.51-147.59 an@147.63-147.69 offer.@147.81-148.13 Two@148.77-148.97 asks@149.13-149.39 in,@149.57-149.71"
  );
  const film = {
    scenes: [
      scene(24, 133.11, 139.81, { scriptText: "Ask while the cart is still working its way back, and you're asking the crew to guess whether the last few rows will come up short." }),
      scene(25, 139.81, 144.66, { hostPresent: true, scriptText: "So wait until everyone's been served, then catch a flight attendant as they pass," }),
      scene(26, 144.66, 148.65, { scriptText: "or step back to the galley, and phrase it as an offer." }),
      scene(27, 148.65, 162.65, { hostPresent: true, scriptText: "Two asks in, you might wonder how anyone keeps this straight." }),
    ],
  };
  const cuts = [133.11, 139.81, 144.66, 148.65];
  // The real cue, as the planner wrote it (job 399's graphics.plan[11]).
  const snackAsk: CueSpec = {
    id: "snack-ask-steps",
    template: "StepLabels",
    start: "So wait until everyone's been served",
    startPad: -0.15,
    end: "and phrase it as an offer",
    endPad: 0.3,
    props: {
      steps: [
        { at: "@wait until everyone's", text: "Wait until served" },
        { at: "@then catch a flight attendant", text: "Catch an attendant" },
        { at: "@or step back", text: "Or step to galley" },
        { at: "@and phrase it", text: "Phrase it as offer" },
      ],
    },
  };
  const asking = (answers: CueSpec[][]) => {
    const asked: string[] = [];
    const ask = async (_system: string, messages: PlanMessage[]) => {
      asked.push(messages[messages.length - 1].content);
      return JSON.stringify({ cues: answers[asked.length - 1] ?? [] });
    };
    return { ask, asked };
  };

  it("job 399's third step opens on 'or': it is a choice, not the next step", () => {
    expect(choiceSteps(snackAsk.props.steps)).toEqual([2]);
    // …and so is a step the narrator leads into with "or", "or else" or "alternatively", whatever its own words
    const quiet = [{ at: "@wait until everyone's", text: "Wait until served" }, { at: "@then catch a flight attendant", text: "Catch an attendant" }, { at: "@step back", text: "Step to galley" }];
    expect(choiceSteps(quiet, k => [undefined, "been served,", "they pass, or"][k])).toEqual([2]);
    expect(choiceSteps(quiet, k => [undefined, "been served,", "or else"][k])).toEqual([2]);
    expect(choiceSteps(quiet, k => [undefined, "been served,", "pass. Alternatively,"][k])).toEqual([2]);
    expect(choiceSteps([{ text: "Rinse it" }, { text: "Alternatively, soak it" }])).toEqual([1]);
  });

  it("every step graphic placed in earlier films still passes, with the words said before each step (jobs 385-397)", () => {
    const placed: [string, string, string | undefined][][] = [
      [["Get a stepladder", "@get a stepladder", "own. So"], ["Take one alarm down", "@take one alarm down", "a stepladder,"], ["Read the label", "@read the label", "down, and"]], // 385, 393, 396
      [["Turn one over", "@turn one over", "up there,"], ["Look for the date", "@look for the date", "over and"]], // 385
      [["Subscribe", "@Subscribe", "you're standing."], ["Turn one alarm over", "@turn one alarm over", "then go"], ["Put the year", "@put the year", "over and"]], // 385
      [["Measurements first line", "@Put the measurements", "a truck."], ["Piece to driveway", "@move the piece out", "line, and"]], // 386, 389, 397
      [["Match length to neckline", "@Match the length", "two things."], ["Hold by a window", "@hold the piece up", "neckline. And"]], // 387, 392 (StepCards)
      [["Hold it by a window", "@hold the piece up", "neckline. And"], ["See what it returns", "@look at what it", "window, and"]], // 395 (StepCards)
      [["Build it well", "@Build it well,", "you live."], ["Price it honest", "@price it honest,", "it well,"], ["Find its lane", "@let every piece find", "honest, and"]], // 397
    ];
    for (const steps of placed) expect(choiceSteps(steps.map(([text, at]) => ({ text, at })), k => steps[k][2])).toEqual([]);
    // the first step is never a choice: "Or look underneath this video, open the description, and tap the
    // link at the top." (the same film) is a sequence done in order, offered as a whole
    expect(choiceSteps([{ text: "Look under the video", at: "@Or look underneath" }, { text: "Open the description", at: "@open the description" }], k => ["the code.", "video,"][k])).toEqual([]);
    // an "or" inside a step is part of it; a word that only starts with the letters is not one
    expect(choiceSteps([{ text: "Lift your phone" }, { text: "Hold it a second or two", at: "@hold it steady" }], k => [undefined, "square, and"][k])).toEqual([]);
    expect(choiceSteps([{ text: "Measure it" }, { text: "Order the wood", at: "@order the wood" }])).toEqual([]);
  });

  it("the prompt's own example agrees with the check: the choice as a step is refused, as one step it passes", () => {
    const prompt = systemPrompt({ kept: false });
    expect(prompt).toContain('"Call the office, or send an email" is ONE step, "Call or email"');
    expect(choiceSteps([{ text: "Call the office" }, { text: "Send an email", at: "@send an email" }], k => [undefined, "office, or"][k])).toEqual([1]);
    expect(choiceSteps([{ text: "Call or email", at: "@Call the office" }, { text: "Wait a day", at: "@then wait a day" }], k => [undefined, "an email,"][k])).toEqual([]);
  });

  it("job 399's chain is refused, the repair is told to put the choice inside the step before it, and the merged chain is kept", async () => {
    const merged: CueSpec = {
      ...snackAsk,
      props: {
        steps: [
          { at: "@wait until everyone's", text: "Wait until served" },
          { at: "@then catch a flight attendant", text: "Catch attendant or galley" },
          { at: "@and phrase it", text: "Phrase it as offer" },
        ],
      },
    };
    const { ask, asked } = asking([[snackAsk], [merged]]);
    const out = await planGraphics({ words: heard, cuts, film, ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([
      {
        cue: "snack-ask-steps",
        problem: expect.stringMatching(/^step 3 \("Or step to galley"\) is a choice instead of the step before, not the next step .*Put the choice inside the step before it, as ONE step \("Call or email"\), or drop it; or show the choice with Versus$/),
      },
    ]);
    expect(asked[1]).toContain('snack-ask-steps: step 3 ("Or step to galley") is a choice');
    expect(out.cues.map(c => c.id)).toEqual(["snack-ask-steps"]);
    expect((out.cues[0].props.steps as { text: string }[]).map(s => s.text)).toEqual(["Wait until served", "Catch attendant or galley", "Phrase it as offer"]);
  });

  it("the same chain with the 'Or' left off the step is still refused: the narrator says it right before the step's words", async () => {
    const quiet: CueSpec = {
      ...snackAsk,
      props: {
        steps: [
          { at: "@wait until everyone's", text: "Wait until served" },
          { at: "@then catch a flight attendant", text: "Catch an attendant" },
          { at: "@step back to", text: "Step back to galley" },
          { at: "@and phrase it", text: "Phrase it as offer" },
        ],
      },
    };
    const { ask } = asking([[quiet]]);
    const out = await planGraphics({ words: heard, cuts, film, ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([{ cue: "snack-ask-steps", problem: expect.stringMatching(/^step 3 \("Step back to galley"\) is a choice instead of the step before/) }]);
    expect(out.cues).toEqual([]);
  });

  it("a real chain of steps on the narrator's words is kept as before (Frederick's job 385)", async () => {
    const words = W("So get a stepladder, take one alarm down, and read the label.", 60);
    const steps: CueSpec = { id: "07-step-labels", template: "StepLabels", start: "So get a stepladder", startPad: -0.15, end: "read the label.", endPad: 0.3, props: { steps: [{ text: "Get a stepladder", at: "@get a stepladder" }, { text: "Take one alarm down", at: "@take one alarm down" }, { text: "Read the label", at: "@read the label" }] } };
    const { ask } = asking([[steps]]);
    const out = await planGraphics({ words, film: { scenes: [scene(12, 59, 65, { scriptText: words.map(w => w.text).join(" ") })] }, ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([]);
    expect(out.cues.map(c => c.id)).toEqual(["07-step-labels"]);
  });
});

describe("a list window is a list the narrator says, in his own words (round 10 graphics review, Gideon's job 400)", () => {
  // Job 400 as heard, 1:40-2:19: the "Seneca's essay" window (1:41) and the "Who Seneca was" window (2:03).
  const heard = T(
    "thieves.@99.24-100.91 2,000@101.08-101.34 years@101.36-101.63 ago,@101.69-101.97 a@102.28-102.33 man@102.39-102.58 named@102.64-102.89 Lucius@102.98-103.48" +
      " " + "Anaeus@103.63-104.06 Seneca@104.11-104.63 wrote@104.78-104.99 a@105.01-105.05 short,@105.17-105.51 furious,@105.91-106.51 loving@106.85-107.21" +
      " " + "essay@107.33-107.67 to@107.75-107.89 a@107.95-107.97 man@108.03-108.25 named@108.31-108.53 Paulinus,@108.63-109.27 the@109.67-109.77" +
      " " + "official@109.81-110.23 in@110.27-110.35 charge@110.41-110.77 of@110.83-110.89 Rome's@110.99-111.37 grain@111.41-111.73 supply,@111.77-112.25" +
      " " + "busy,@112.67-113.05 important,@113.43-114.01 and@114.37-114.47 worn@114.55-114.85 down@114.93-115.15 to@115.23-115.31 the@115.35-115.47" +
      " " + "rims.@115.57-115.93 Seneca@117.06-117.52 was@117.58-117.74 no@117.88-118.06 monk@118.18-118.44 on@118.52-118.58 a@118.62-118.66" +
      " " + "hillside.@118.72-119.28 He@119.92-120.02 was@120.04-120.18 one@120.26-120.36 of@120.40-120.46 the@120.50-120.60 richest@120.72-121.10" +
      " " + "men@121.20-121.44 in@121.60-121.68 the@121.70-121.80 empire,@122.00-122.50 an@123.04-123.14 advisor@123.18-123.78 standing@123.90-124.28" +
      " " + "one@124.54-124.68 step@124.84-125.18 from@125.24-125.38 the@125.42-125.52 throne,@125.58-125.98 buried@126.52-126.89 under@126.98-127.17" +
      " " + "exactly@127.27-127.86 the@127.92-128.00 kind@128.04-128.23 of@128.27-128.33 obligations@128.43-129.09 we@129.15-129.25 are@129.31-129.43" +
      " " + "about@129.47-129.67 to@129.73-129.79 talk@129.85-130.07 about,@130.15-130.41 and@131.11-131.21 a@131.25-131.27 man@131.33-131.57 who,@131.65-131.87" +
      " " + "years@132.17-132.45 later,@132.53-132.85 would@133.29-133.45 be@133.47-133.57 ordered@133.69-133.95 to@133.99-134.07 end@134.25-134.41" +
      " " + "his@134.47-134.61 own@134.81-134.95 life@135.05-135.35 by@135.51-135.63 the@135.67-135.77 very@135.89-136.21 emperor@136.39-136.77 he@136.87-136.95" +
      " " + "had@136.99-137.11 served.@137.21-137.63 When@138.31-138.45 a@138.47-138.51 man@138.55-138.73 like@138.81-138.99 that@139.11-139.41"
  );
  const film = {
    scenes: [
      scene(20, 91.17, 100.63, { scriptText: "was never your problem. Your problem is theft, and by the end of this video you will be able to name all seven of the thieves." }),
      scene(21, 100.63, 102.13, { scriptText: "Two thousand years ago," }),
      scene(22, 102.13, 105.8, { scriptText: "a man named Lucius Annaeus Seneca wrote a short," }),
      scene(23, 105.8, 106.59, { scriptText: "furious," }),
      scene(24, 106.59, 116.89, { scriptText: "loving essay to a man named Paulinus, the official in charge of Rome’s grain supply — busy, important, and worn down to the rims." }),
      scene(25, 116.89, 130.97, { scriptText: "Seneca was no monk on a hillside. He was one of the richest men in the empire, an advisor standing one step from the throne, buried under exactly the kind of obligations we are about to talk about —" }),
      scene(26, 130.97, 138.19, { scriptText: "and a man who, years later, would be ordered to end his own life by the very emperor he had served." }),
      scene(27, 138.19, 144.12, { hostPresent: true, split: true, scriptText: "When a man like that sits down to write about time, I pull my chair in closer." }),
    ],
  };
  const cuts = [100.63, 102.13, 105.8, 106.59, 116.89, 130.97, 138.19];
  // The two windows exactly as the planner wrote them (the job's saved plan).
  const essay: CueSpec = {
    id: "seneca-essay-list",
    template: "ListWindow",
    start: "Two thousand years ago, a man",
    startPad: -0.15,
    end: "furious, loving essay",
    endPad: 0.3,
    props: {
      title: "Seneca's essay",
      items: [
        { at: "@Two thousand years ago", say: "Two thousand years ago", text: "Two thousand years ago" },
        { at: "@a man named Lucius", say: "wrote a short", text: "Seneca wrote a short" },
        { at: "@furious", say: "furious", text: "Furious" },
        { at: "@loving essay", say: "loving essay", text: "Loving essay" },
      ],
    },
  };
  const whoHeWas: CueSpec = {
    id: "who-seneca-was",
    template: "ListWindow",
    start: "an advisor standing one step from",
    startPad: -0.15,
    end: "emperor he had served.",
    endPad: 0.3,
    props: {
      title: "Who Seneca was",
      items: [
        { at: "@an advisor standing one step", say: "an advisor standing one step from the throne", text: "One step from throne" },
        { at: "@buried under exactly the kind", say: "buried under exactly the kind of obligations we are about to talk about", text: "Buried under obligations" },
        { at: "@and a man who", say: "and a man who, years later, would be ordered to end his own life", text: "Ordered to end life" },
      ],
    },
  };
  // The list the job kept from before the item rules: the false one, found in the essay's sentence.
  const stored = [{ items: ["Two thousand years ago", "a man named Lucius Annaeus Seneca wrote a short", "furious"] }];
  /** The first answer, then the repair's: the model keeps the cues that passed (`repair`). */
  const asking = (first: CueSpec[], repair: CueSpec[] = []) => {
    const asked: string[] = [];
    const ask = async (_system: string, messages: PlanMessage[]) => {
      asked.push(messages[messages.length - 1].content);
      return JSON.stringify({ cues: asked.length === 1 ? first : asked.length === 2 ? repair : [] });
    };
    return { ask, asked };
  };

  it("job 400: 'Seneca's essay' is refused and the repair told why; 'Who Seneca was' is kept, its rows in the spoken words", async () => {
    const { ask, asked } = asking([essay, whoHeWas], [whoHeWas]);
    const out = await planGraphics({ words: heard, cuts, film, ask, ensureIcon: async () => true, listCheck: notAListAsSaid });
    expect(out.cues.map(c => c.id)).toEqual(["who-seneca-was"]);
    const refused = out.rounds[0].problems.find(p => p.cue === "seneca-essay-list");
    expect(refused?.problem).toMatch(
      /^"Seneca's essay" is not a list the narrator says: row 1 \("Two thousand years ago"\) names no thing \(a length of time\)\. A list window numbers separate things he names/
    );
    expect(asked[1]).toContain(`seneca-essay-list: "Seneca's essay" is not a list the narrator says`);
    expect((out.cues[0].props.items as { text: string }[]).map(i => i.text)).toEqual(["One step from the throne", "Buried under obligations", "Ordered to end his own life"]);
  });

  it("job 400: the stored list from before the rules is put to the planner as no list, gets no list graphic, and is named with the first round", async () => {
    const { ask, asked } = asking([]);
    const out = await planGraphics({ words: heard, cuts, film, ask, ensureIcon: async () => true, lists: stored, listCheck: notAListAsSaid });
    expect(asked[0]).not.toContain("SPOKEN LISTS IN THIS SCRIPT");
    expect(out.cues).toEqual([]);
    expect(out.rounds.map(r => r.step)).not.toContain("lists");
    expect(out.rounds[0].problems).toEqual([
      { cue: expect.stringMatching(/^spoken list "Two thousand years ago, /), problem: expect.stringMatching(/a length of time\); it gets no list graphic$/) },
    ]);
    // …and the window the planner built on it is not excused as a list the pipeline found
    const again = await planGraphics({ words: heard, cuts, film, ask: asking([essay]).ask, ensureIcon: async () => true, lists: stored, listCheck: notAListAsSaid });
    expect(again.cues).toEqual([]);
  });

  it("a list the pipeline found is not asked again, and a planner's window on it is kept; without the check nothing changes", async () => {
    // as if the pipeline had found the "Who Seneca was" list (its 13-word items are past the finder's limit)
    const found = [
      { items: ["an advisor standing one step from the throne", "buried under exactly the kind of obligations we are about to talk about", "and a man who, years later, would be ordered to end his own life"] },
    ];
    const calls: string[][] = [];
    const listCheck = (script: string, rows: string[]) => {
      calls.push(rows);
      return notAListAsSaid(script, rows);
    };
    const out = await planGraphics({ words: heard, cuts, film, ask: asking([whoHeWas]).ask, ensureIcon: async () => true, lists: found, listCheck });
    expect(out.cues.map(c => c.id)).toEqual(["who-seneca-was"]);
    expect(calls).toEqual([found[0].items]); // the stored list, once; never the window built on it
    const bare = await planGraphics({ words: heard, cuts, film, ask: asking([essay]).ask, ensureIcon: async () => true });
    expect(bare.cues.map(c => c.id)).toEqual(["seneca-essay-list"]);
  });

  it("which windows are a found list: each row one item in order, its words inside the item's or holding them", () => {
    const complains = [{ items: ["The farmer complains", "the senator complains", "the old complain"] }];
    expect(fromAFoundList(["The farmer complains", "the senator complains", "the old complain"], complains)).toBe(true);
    expect(fromAFoundList(["The farmer", "The senator", "The old"], complains)).toBe(true);
    expect(fromAFoundList(["the senator complains", "The farmer complains"], complains)).toBe(false); // out of order
    // job 400's "Ordinary places" added a fourth row the found list does not hold
    const places = [{ items: ["some ordinary place", "a waiting room", "a church pew"] }];
    expect(fromAFoundList(["some ordinary place", "a waiting room", "a church pew", "the kitchen table at two in the morning"], places)).toBe(false);
    expect(fromAFoundList([], places)).toBe(false);
  });

  it("a row clipped into a headline gets its articles and possessives back; a row in the planner's own words is kept", () => {
    expect(restoreRowGrammar("One step from throne", "an advisor standing one step from the throne")).toBe("One step from the throne");
    expect(restoreRowGrammar("Ordered to end life", "and a man who, years later, would be ordered to end his own life")).toBe("Ordered to end his own life");
    expect(restoreRowGrammar("Smalls to markets", "Smalls to the markets")).toBe("Smalls to the markets"); // Dale's job 397
    expect(restoreRowGrammar("Second bag of pretzels", "a second bag of pretzels")).toBe("A second bag of pretzels"); // Helena's job 399
    // the planner's own short version: a word that is not grammar left out, a word added, a symbol, digits
    expect(restoreRowGrammar("Buried under obligations", "buried under exactly the kind of obligations we are about to talk about")).toBe("Buried under obligations");
    expect(restoreRowGrammar("Seneca wrote a short", "wrote a short")).toBe("Seneca wrote a short");
    expect(restoreRowGrammar("Smalls → markets", "Smalls to the markets")).toBe("Smalls → markets");
    expect(restoreRowGrammar("Water for later", "a bottle of water for later")).toBe("Water for later");
    expect(restoreRowGrammar("Sandpaper", "a stack of sandpaper")).toBe("Sandpaper");
    expect(restoreRowGrammar("3 piles", "three piles")).toBe("3 piles");
    // …and never past the row limit
    expect(restoreRowGrammar("Kept rest of can for later", "kept the rest of the can for later")).toBe("Kept rest of can for later");
    expect(ROW_MAX_WORDS).toBe(6);
  });

  it("a row over the limit is refused; a list built from the found words keeps their grammar and never ends on a hanging word", async () => {
    const rows = whoHeWas.props.items as object[];
    const long: CueSpec = {
      ...whoHeWas,
      props: { ...whoHeWas.props, items: [{ at: "@an advisor standing one step", say: "an advisor standing one step from the throne", text: "An advisor standing one step from the throne" }, ...rows.slice(1)] },
    };
    const out = await planGraphics({ words: heard, cuts, film, ask: asking([long]).ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([
      { cue: "who-seneca-was", problem: 'row "An advisor standing one step from the throne" is 8 words — a list row takes at most 6: the item in its own spoken words, shortened' },
    ]);
    const words = W("usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet.", 40);
    const [c] = missingListCues([], words, { scenes: [scene(8, 39, 60)] }, [{ items: ["a waiting room", "a church pew", "the kitchen table at two in the morning"] }]);
    expect((c.props.items as { text: string }[]).map(i => i.text)).toEqual(["A waiting room", "A church pew", "The kitchen table at two"]);
  });

  it("the prompt asks for a list he names, rows in his own words, at the new limit", () => {
    const prompt = systemPrompt({ kept: false });
    expect(prompt).toContain(`"text" (≤${ROW_MAX_WORDS} words)`);
    expect(prompt).toContain("never a sentence chopped at its commas");
    expect(prompt).toContain(`never clipped like a headline, "Seat by window"`);
  });
});

describe("a row takes back only the article or possessive that opens its own noun phrase (review of A7)", () => {
  // restoreRowGrammar used to take back EVERY article, possessive or "own" said before a row's first
  // word, so a "say" with the verb before it came back broken: "tell her the truth" made "Her the
  // truth", "if you own a truck" made "Own a truck".
  it("the words before the row open its noun phrase: one article or possessive, or a possessive and its 'own'", () => {
    expect(restoreRowGrammar("Second bag of pretzels", "a second bag of pretzels")).toBe("A second bag of pretzels"); // Helena's job 399
    expect(restoreRowGrammar("Rest of the can", "ask her for the rest of the can")).toBe("The rest of the can");
    expect(restoreRowGrammar("Life", "would be ordered to end his own life")).toBe("His own life");
    expect(restoreRowGrammar("Terms", "on her own terms")).toBe("Her own terms");
    expect(restoreRowGrammar("Grandmother's sewing box", "her grandmother's sewing box")).toBe("Her grandmother's sewing box");
    expect(restoreRowGrammar("Sewing box", "a quilt, and her sewing box")).toBe("Her sewing box");
    expect(restoreRowGrammar("Coffee", "pour her a coffee")).toBe("A coffee");
  });

  it("never a second article or possessive, never 'own' the verb, never 'her' the object", () => {
    expect(restoreRowGrammar("The truth", "tell her the truth")).toBe("The truth");
    expect(restoreRowGrammar("A truck", "if you own a truck")).toBe("A truck");
    expect(restoreRowGrammar("Flowers", "give her flowers")).toBe("Flowers");
    expect(restoreRowGrammar("The price", "ask her the price")).toBe("The price");
    // between the row's own words, the spoken words always go back in: they are said in a row
    expect(restoreRowGrammar("Ask the price", "ask her the price")).toBe("Ask her the price");
  });
});

describe("an icon is the object its words name, or none (A9, round 10 graphics review)", () => {
  // 399 whole-can-fact (1:09.5-1:13.7, over b-roll scene 16): the FactCard carried 1f96b "canned
  // food", a food tin, for the rest of a drink can. 400 clock-before-after (1:02.8-1:07.8, over b-roll
  // scene 12): an alarm clock for "Background noise at thirty" and a megaphone for "The loudest thing".
  const heard399 = T(
    "and@66.026-66.126 the@66.166-66.246 rest@66.306-66.526 of@66.566-66.626 the@66.666-66.726 can@66.766-67.046 rolls@67.146-67.467 off@67.567-67.687 down@67.747-67.907 the@67.947-68.027 aisle@68.167-68.327 on@68.387-68.467 the@68.487-68.567 cart.@68.607-68.907 " +
      "On@69.628-69.708 many@69.768-69.968 of@70.008-70.048 those@70.088-70.288 carriers,@70.328-70.828 you@71.008-71.108 can@71.149-71.249 have@71.289-71.409 the@71.449-71.529 whole@71.589-71.829 thing@71.909-72.189 just@72.329-72.489 by@72.529-72.649 asking.@72.769-73.13 " +
      "I@73.87-73.97 figured@74.01-74.29"
  );
  const film399 = {
    scenes: [
      scene(16, 59.25, 73.71, { scriptText: "…and the rest of the can rolls off down the aisle on the cart. On many of those carriers, you can have the whole thing just by asking." }),
      scene(17, 73.71, 85.87, { scriptText: "I figured that out much too late," }),
    ],
  };
  const fact = (icon?: unknown): CueSpec => ({
    id: "whole-can-fact",
    template: "FactCard",
    start: "On many of those carriers,",
    startPad: -0.15,
    end: "just by asking.",
    endPad: 0.3,
    props: { kicker: "Fact", fact: { text: "On many of those carriers, you can have the whole thing just by asking.", words: true }, emphasis: ["asking."], ...(icon === undefined ? {} : { icon }) },
  });
  const heard400 = T(
    "Fewer@59.663-59.983 years@60.023-60.304 ahead@60.384-60.784 than@60.884-61.044 behind,@61.084-61.624 and@62.065-62.165 a@62.205-62.225 clock@62.305-62.625 that@62.665-62.805 was@62.825-62.965 " +
      "background@63.065-63.546 noise@63.606-63.866 at@63.926-63.986 30@64.226-64.527 is@65.027-65.107 now@65.167-65.327 the@65.367-65.487 loudest@65.607-66.048 thing@66.108-66.288 in@66.328-66.368 the@66.408-66.508 room.@66.568-66.848 " +
      "My@67.889-68.049 name@68.089-68.349 is@68.529-68.609"
  );
  const film400 = {
    scenes: [
      scene(12, 59.26, 67.76, { scriptText: "Fewer years ahead than behind, and a clock that was background noise at thirty is now the loudest thing in the room." }),
      scene(13, 67.76, 70.93, { hostPresent: true, scriptText: "My name is" }),
    ],
  };
  const cuts400 = [59.26, 67.76, 70.93];
  const clock = (before: unknown, after: unknown): CueSpec => ({
    id: "clock-before-after",
    template: "BeforeAfter",
    start: "and a clock that was background",
    startPad: -0.15,
    end: "loudest thing in the room.",
    endPad: 0,
    props: {
      kicker: "The clock",
      before: { at: "@background noise at thirty", label: "Background noise at thirty", ...(before === undefined ? {} : { icon: before }) },
      after: { at: "@now the loudest thing", label: "The loudest thing", ...(after === undefined ? {} : { icon: after }) },
    },
  });
  const asking = (answers: CueSpec[][]) => {
    const asked: string[] = [];
    const ask = async (_system: string, messages: PlanMessage[]) => {
      asked.push(messages[messages.length - 1].content);
      return JSON.stringify({ cues: answers[asked.length - 1] ?? [] });
    };
    return { ask, asked };
  };
  type Slot = { icon?: unknown } & Record<string, unknown>;
  const props = (out: { cues: CueSpec[] }, id: string) => out.cues.find(c => c.id === id)?.props as (Slot & Record<string, Slot>) | undefined;

  it("the prompt asks for the object itself or no icon, and marks the icon optional on every template but IconCallout", () => {
    const prompt = systemPrompt({ kept: false });
    expect(prompt).toContain(`"icon" is OPTIONAL everywhere but IconCallout`);
    expect(prompt).toContain(`Leave "icon" out when those words name no`);
    expect(prompt).toContain("the nearest emoji of another");
    expect(prompt).toContain("When one thing changes state, both sides show that same thing.");
    expect(prompt).not.toContain("a plain, literal object");
    // every template's props say whether its icon is optional — a bare "icon" reads as one to fill
    const templateLines = prompt.split("\n").filter(l => l.startsWith("- ") && l.includes('"icon"'));
    expect(templateLines.length).toBe(6);
    for (const l of templateLines) for (const m of Array.from(l.matchAll(/"icon"(.{0,11})/g))) expect(m[1], l).toMatch(/^ \((optional|required)\)/);
    // IconCallout's own line wraps: its "required" icon is on the line after
    expect(prompt).toMatch(/- IconCallout — [^\n]*\n[^\n]*\{"icon" \(required\)/);
    expect(Array.from(ICON_REQUIRED)).toEqual(["IconCallout"]);
  });

  it("job 399: the fact card with no icon is complete, and an icon written blank is no icon — never refused as a missing emoji", async () => {
    const bare = await planGraphics({ words: heard399, film: film399, ask: asking([[fact()]]).ask, ensureIcon: async () => true });
    expect(bare.cues.map(c => c.id)).toEqual(["whole-can-fact"]);
    expect(bare.rounds[0].problems).toEqual([]);
    for (const blank of ["", "none", null]) {
      const seen: string[] = [];
      const out = await planGraphics({ words: heard399, film: film399, ask: asking([[fact(blank)]]).ask, ensureIcon: async code => (seen.push(code), true) });
      expect(out.rounds[0].problems, String(blank)).toEqual([]); // was: 'no Noto emoji for  — pick another'
      expect(props(out, "whole-can-fact")).not.toHaveProperty("icon");
      expect(seen).toEqual([]);
    }
    // an icon Noto has the image for is still converted and kept: the rule takes nothing that is asked for
    const kept = await planGraphics({ words: heard399, film: film399, ask: asking([[fact("\u{1F964}")]]).ask, ensureIcon: async () => true });
    expect(props(kept, "whole-can-fact")?.icon).toBe("1f964");
  });

  it("job 400: a pair with one side left out (it names no object) loses the other icon too, and the card stays", async () => {
    const out = await planGraphics({ words: heard400, cuts: cuts400, film: film400, ask: asking([[clock("23f0", undefined)]]).ask, ensureIcon: async () => true });
    expect(out.cues.map(c => c.id)).toEqual(["clock-before-after"]);
    expect(out.rounds[0].problems).toEqual([]);
    expect(props(out, "clock-before-after")?.before).not.toHaveProperty("icon");
    expect(props(out, "clock-before-after")?.after).not.toHaveProperty("icon");
  });

  it("an emoji Noto has no image for is taken off, not sent back for another (the nearest one is the wrong kind)", async () => {
    const { ask, asked } = asking([[clock("23f0", "1f4e2")]]);
    const out = await planGraphics({ words: heard400, cuts: cuts400, film: film400, ask, ensureIcon: async code => code !== "1f4e2" });
    expect(out.cues.map(c => c.id)).toEqual(["clock-before-after"]);
    expect(out.rounds[0].problems).toEqual([]); // was: 'no Noto emoji for 1f4e2 — pick another', and a repair round
    expect(asked).toHaveLength(1);
    expect(props(out, "clock-before-after")?.before).not.toHaveProperty("icon");
  });

  it("a pair that shows one thing on both sides is kept as written (the rule never takes a whole set)", async () => {
    const mantel = "\u{1F570}\u{FE0F}";
    const out = await planGraphics({ words: heard400, cuts: cuts400, film: film400, ask: asking([[clock(mantel, mantel)]]).ask, ensureIcon: async () => true });
    expect(out.rounds[0].problems).toEqual([]);
    expect(props(out, "clock-before-after")?.before.icon).toBe("1f570");
    expect(props(out, "clock-before-after")?.after.icon).toBe("1f570");
  });

  it("IconCallout is its icon: refused without one and steered to a caption, kept with one", async () => {
    const words = W("The battery was pulled.", 10);
    const film = { scenes: [scene(9, 9, 16, { scriptText: "The battery was pulled." })] };
    const battery = "\u{1F50B}";
    const callout = (icon?: string): CueSpec => ({
      id: "battery-callout",
      template: "IconCallout",
      start: "The battery was pulled.",
      startPad: -0.15,
      end: "was pulled.",
      endPad: 0.3,
      props: { phrase: { text: "The battery was pulled.", words: true }, emphasis: ["pulled."], ...(icon === undefined ? {} : { icon }) },
    });
    const { ask, asked } = asking([[callout()]]);
    const out = await planGraphics({ words, film, ask, ensureIcon: async () => true });
    expect(out.cues).toEqual([]);
    expect(out.rounds[0].problems).toEqual([{ cue: "battery-callout", problem: expect.stringMatching(/^no icon — IconCallout makes its point with its icon: ONE emoji that IS the object .*DimCaption/) }]);
    expect(asked[1]).toContain("show the line as a DimCaption");
    const unknown = await planGraphics({ words, film, ask: asking([[callout(battery)]]).ask, ensureIcon: async () => false });
    expect(unknown.rounds[0].problems[0].problem).toMatch(new RegExp(`^no Noto emoji for ${battery} — IconCallout makes its point`, "u"));
    const ok = await planGraphics({ words, film, ask: asking([[callout(battery)]]).ask, ensureIcon: async () => true });
    expect(ok.cues.map(c => c.id)).toEqual(["battery-callout"]);
    expect(props(ok, "battery-callout")?.icon).toBe("1f50b");
  });

  it("icons side by side come as a set: a half set loses the rest; a whole set, no set or a single icon is left alone", () => {
    const versus: Record<string, unknown> = { left: { icon: "1f525", title: "Ionization" }, right: { title: "Photoelectric" } };
    iconsAsASet(versus);
    expect(versus).toEqual({ left: { title: "Ionization" }, right: { title: "Photoelectric" } });
    const steps: Record<string, unknown> = { steps: [{ text: "Get a stepladder", icon: "1fa9c" }, { text: "Phrase it as an offer" }, { text: "Read the label", icon: "1f3f7" }] };
    iconsAsASet(steps);
    expect((steps.steps as object[]).every(s => !("icon" in s))).toBe(true);
    const whole: Record<string, unknown> = { items: [{ text: "Not broken", icon: "1f527" }, { text: "Not dead", icon: "1f50b" }] };
    iconsAsASet(whole);
    expect((whole.items as { icon?: string }[]).map(i => i.icon)).toEqual(["1f527", "1f50b"]);
    const single: Record<string, unknown> = { icon: "1f50b", phrase: { text: "The battery was pulled.", words: true }, before: { label: "Old" } };
    iconsAsASet(single);
    expect(single.icon).toBe("1f50b");
    const rows: Record<string, unknown> = { items: [{ text: "A seat by the window" }, { text: "Her sewing box" }] };
    iconsAsASet(rows);
    expect(rows).toEqual({ items: [{ text: "A seat by the window" }, { text: "Her sewing box" }] });
  });

  it("an empty slot is no icon; an emoji, a code or any other word is one to look up", () => {
    for (const none of ["", "  ", "none", "None", "null", "no icon", "N/A", "-", null, undefined, 0, {}]) expect(noIcon(none), String(none)).toBe(true);
    for (const some of ["\u{1F570}\u{FE0F}", "1f570", "23f0", "clock"]) expect(noIcon(some), some).toBe(false);
  });
});

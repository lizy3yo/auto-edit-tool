import { describe, expect, it } from "vitest";
import { resolveCues, type CueSpec, type ResolvedCue, type Word } from "../cueResolve";
import { TEMPLATES } from "../registry";
import { FPS } from "../theme";
import { listsWhereGraphicsGo, malformedPhrase, missingListCues, namesTheDanger, normalizePhrases, notTheHostsWords, planGraphics, quotedInScript, systemPrompt, uncoveredMoments, userPrompt, wordsSaidOver, type PlanMessage } from "./planner";

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

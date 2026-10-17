import { describe, expect, it } from "vitest";
import type { CueSpec, ResolvedCue, Word } from "../cueResolve";
import { listsWhereGraphicsGo, malformedPhrase, missingListCues, normalizePhrases, planGraphics, uncoveredMoments, type PlanMessage } from "./planner";

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

import { describe, expect, it } from "vitest";
import type { LongformInputParams, StoryboardScene } from "@shared/types";
import { checkPlan, enforcePlanRules, len } from "./planGate";

const params = {
  faceImageUrl: "https://example.com/host.jpg",
  hostName: "Hank Hardwood",
} as LongformInputParams;

/** A film laid end to end from [kind, seconds, text] rows. */
function film(rows: [("H" | "P" | "M"), number, string][]): StoryboardScene[] {
  let t = 0;
  return rows.map(([kind, sec, text], k) => {
    const s = {
      index: k + 1,
      scriptText: text,
      narration: text,
      visualPrompt: `picture ${k + 1}`,
      showSubject: `thing ${k + 1}`,
      hostPresent: kind === "H" ? true : undefined,
      stillImage: kind === "P" ? true : kind === "M" ? false : undefined,
      objectMotion: kind === "M" ? true : undefined,
      narrationStartSec: t,
      narrationEndSec: t + sec,
      audioDuration: sec,
      audioUrl: `https://example.com/${k}.mp3`,
    } as StoryboardScene;
    t += sec;
    return s;
  });
}

const sentence = (n: number) => `Line number ${n} says a thing.`;

describe("enforcePlanRules", () => {
  it("joins a flash shot to the shot beside it and re-cuts only what moved", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["M", 3, "The saw goes back and forth"],
      ["P", 0.5, "slowly,"],
      ["M", 3, "until the board splits cleanly."],
      ["H", 5, sentence(2)],
    ]);
    expect(checkPlan(scenes, params).findings.some(f => f.rule === 7)).toBe(true);
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
    expect(r.scenes).toHaveLength(4);
    expect(r.scenes[1].scriptText).toBe("The saw goes back and forth slowly,");
    expect(r.scenes[1].audioUrl).toBeUndefined();
    expect(r.scenes[2].audioUrl).toBeDefined();
  });

  it("splits a lingering picture on a pause in the voice", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      [
        "M",
        9,
        "Japanese carpenters are famous for joints that lock wood together, and the shelf uses the simplest one of all.",
      ],
      ["H", 5, sentence(2)],
    ]);
    const r = enforcePlanRules(scenes, params, { silences: [{ start: 9.6, end: 9.8 }] });
    expect(r.unresolved.filter(f => f.rule === 9)).toEqual([]);
    const parts = r.scenes.filter(s => !s.hostPresent);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(s => len(s) <= 6.5)).toBe(true);
    expect(parts[0].narrationEndSec).toBeCloseTo(9.7);
    expect(parts.map(s => s.scriptText).join(" ")).toBe(scenes[1].scriptText);
  });

  it("brings the host back in a long stretch, paying for it with a spare check-in", () => {
    const rows: [("H" | "P" | "M"), number, string][] = [["H", 5, sentence(0)]];
    let t = 5;
    let n = 1;
    // The first 3 minutes: the host every ~30 s.
    while (t < 200) {
      for (let k = 0; k < 4; k++) rows.push(["M", 6, sentence(n++)]);
      rows.push(["H", 4, sentence(n++)]);
      t += 28;
    }
    // Then 84 s with no host — over the 75 s late limit.
    for (let k = 0; k < 14; k++) rows.push(["M", 6, sentence(n++)]);
    rows.push(["H", 4, sentence(n++)]);
    rows.push(["M", 6, sentence(n++)]);
    rows.push(["H", 8, sentence(n++)]); // a spare check-in: removing it leaves a short gap
    rows.push(["M", 6, sentence(n++)]);
    rows.push(["H", 6, sentence(n++)]);
    const scenes = film(rows);
    const host = (xs: StoryboardScene[]) => xs.filter(s => s.hostPresent).reduce((a, s) => a + len(s), 0);
    const budget = host(scenes);
    const r = enforcePlanRules(scenes, params, { budgetSec: budget });
    expect(r.unresolved.filter(f => f.rule === 8)).toEqual([]);
    expect(host(r.scenes)).toBeLessThanOrEqual(budget + 0.5);
  });

  it("does nothing to the host when no clean candidate exists", () => {
    const rows: [("H" | "P" | "M"), number, string][] = [["H", 6, sentence(0)]];
    for (let k = 1; k <= 30; k++) rows.push(["P", 3, `and then part ${k}`]); // never a sentence
    rows.push(["H", 6, sentence(99)]);
    const scenes = film(rows);
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved.some(f => f.rule === 8)).toBe(true);
    expect(r.scenes.filter(s => s.hostPresent)).toHaveLength(2);
  });

  it("turns the longest stills into moving shots until 30% of the cutaways move", () => {
    const rows: [("H" | "P" | "M"), number, string][] = [["H", 5, sentence(0)]];
    for (let k = 1; k <= 8; k++) rows.push(["P", k === 3 ? 5 : 3, sentence(k)]);
    rows.push(["H", 5, sentence(9)]);
    const scenes = film(rows);
    // Hands at work can move for real; the plain objects stay still.
    for (const s of scenes) if (s.index % 2 === 0) s.showSubject = `hands working on thing ${s.index}`;
    scenes[3].showSubject = "hands sanding a board";
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved.filter(f => f.rule === 11)).toEqual([]);
    expect(r.scenes.filter(s => !s.hostPresent && !s.stillImage).every(s => /hands/.test(s.showSubject ?? ""))).toBe(true);
    const pics = r.scenes.filter(s => !s.hostPresent);
    const moving = pics.filter(s => !s.stillImage).reduce((a, s) => a + len(s), 0);
    expect(moving / pics.reduce((a, s) => a + len(s), 0)).toBeGreaterThanOrEqual(0.3);
    // The longest still went first.
    expect(r.scenes[3].stillImage).toBe(false);
  });

  it("puts the self-introduction on camera", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["M", 4, "I'm Hank Hardwood, and this one is for you."],
      ["H", 5, sentence(2)],
    ]);
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes[1].hostPresent).toBe(true);
    expect(r.scenes[1].hostIntro).toBe(true);
  });
});

describe("nothing moves on its own", () => {
  it("makes a moving shot of an ordinary object a still, keeps fire and hands moving", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["M", 3, sentence(2)],
      ["M", 3, sentence(3)],
      ["M", 3, sentence(4)],
      ["H", 5, sentence(5)],
    ]);
    scenes[1].showSubject = "scattered kumiko strips on the workbench";
    scenes[2].showSubject = "a propane torch flame moving across a cedar board";
    scenes[3].showSubject = "hands sanding the edge of a pine board";
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes[1].stillImage).toBe(true);
    expect(r.scenes[2].stillImage).toBe(false);
    expect(r.scenes[3].stillImage).toBe(false);
    expect(r.scenes[3].humanPresent).toBe(true);
  });

  it("stops a split panel of plain objects from moving", () => {
    const scenes = film([["H", 5, sentence(1)], ["H", 5, sentence(2)], ["H", 5, sentence(3)]]);
    scenes[1].splitVisual = "scattered lattice strips on the workbench" as any;
    scenes[1].splitMotion = true;
    enforcePlanRules(scenes, params);
    expect(scenes[1].splitMotion).toBeUndefined();
  });
});

describe("Ruth's job 178", () => {
  it("turns stills of THINGS into hands shots when no still has hands, never a place", () => {
    const rows: [("H" | "P" | "M"), number, string][] = [["H", 5, sentence(0)]];
    for (let k = 1; k <= 8; k++) rows.push(["P", 4, sentence(k)]);
    rows.push(["H", 5, sentence(9)]);
    const scenes = film(rows);
    scenes.forEach((s, k) => (s.showSubject = k === 2 ? "a craft booth table at the market" : `a spool of thread ${k}`));
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved.filter(f => f.rule === 11)).toEqual([]);
    const moving = r.scenes.filter(s => !s.hostPresent && !s.stillImage);
    expect(moving.every(s => s.humanPresent && /^hands gently working with/.test(s.showSubject ?? ""))).toBe(true);
    expect(r.scenes[2].stillImage).toBe(true); // the market booth stays a still
  });

  it("gives back a crowded opening beat, never a paid one, to stay within the host minutes", () => {
    const scenes = film([
      ["H", 3, sentence(0)],
      ["P", 2, sentence(1)],
      ["H", 4, sentence(2)], // crowded: 2 s after the opener
      ["P", 2, sentence(3)],
      ["H", 4, sentence(4)], // crowded too, but already sent to HeyGen
      ["P", 3, sentence(5)],
      ["H", 5, sentence(6)],
    ]);
    scenes[4].submits = [{ provider: "heygen", at: "x", reason: "first", sec: 4 }] as any;
    const r = enforcePlanRules(scenes, params, { budgetSec: 13, sectionSec: 20 });
    expect(r.scenes[2].hostPresent).toBe(false);
    expect(r.scenes[4].hostPresent).toBe(true);
  });
});

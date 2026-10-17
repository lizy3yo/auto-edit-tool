import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import type { JobGraphics, LongformInputParams } from "@shared/types";
import type { AddGraphicsInput, GraphicsRecord } from "./finish";

/**
 * What the graphics step keeps on the job (G1). The planner's refusals and the readability fixes
 * used to reach only the render log: across the 12 films made with graphics (jobs 385-398) the rows
 * held one left-out graphic and no refusal, so a bare moment of Dale's job 397 ("Smalls, about $10
 * to $40.") could not be explained from the job.
 */

let record: Partial<GraphicsRecord> | Error = {};
vi.mock("../db", () => ({ getChannelConfig: vi.fn(async () => undefined) }));
vi.mock("./finish", () => ({
  addGraphics: vi.fn(async (input: AddGraphicsInput) => {
    if (record instanceof Error) throw record;
    writeFileSync(input.outPath, "film with graphics");
    return record;
  }),
}));

const { withGraphics, plannerForJob, readabilityForJob, MAX_KEPT_PER_ROUND } = await import("./apply");
const finish = await import("./finish");

const hooks = { phase: () => {}, warn: vi.fn(), log: () => {} };
const qa = { pass: true, lines: ["all good"], failures: [] } as unknown as GraphicsRecord["qa"];
const base = (over: Partial<GraphicsRecord> = {}): Partial<GraphicsRecord> => ({ at: "2026-10-18T10:00:00.000Z", plan: [], placed: [], dropped: [], qa, readability: [], ...over });
const params = (graphics?: JobGraphics) => ({ script: "", graphics }) as unknown as LongformInputParams;
const run = async (p: LongformInputParams) => {
  await withGraphics(397, Buffer.from("film"), [], p, hooks);
  return p.graphics!;
};

const refusal = { cue: "probe-smalls-price", problem: "starts 0.4 s after three-piles ends (needs 1 s)" };
const rounds = [{ step: "first" as const, asked: 21, kept: 20, problems: [refusal] }];
const lattice = { id: "lattice-six-hours", pass: false, summary: "colour 4.0:1", steps: ["as designed: colour 3.1:1", "darker behind the words (0.5): colour 3.6:1", "darker behind the words (1): colour 4.0:1"] };

beforeEach(() => {
  delete process.env.GRAPHICS;
  record = {};
  vi.mocked(finish.addGraphics).mockClear();
});
afterEach(() => {
  delete process.env.GRAPHICS;
});

describe("the planner's rounds are kept on the job", () => {
  it("a fresh plan keeps each round's asked, kept and refusals, with the model and when it was written", async () => {
    record = base({ planner: { model: "claude-opus-5-5", rounds } });
    const g = await run(params());
    expect(g.planner?.rounds[0].problems[0].cue).toBe("probe-smalls-price");
    expect(g.planner).toEqual({ model: "claude-opus-5-5", at: "2026-10-18T10:00:00.000Z", rounds: [{ step: "first", asked: 21, kept: 20, problems: [refusal] }] });
  });

  it("a Reassemble that reuses the saved plan (no model call, no rounds) carries the rounds that wrote it", async () => {
    const prior = plannerForJob({ model: "claude-opus-5-5", rounds }, "2026-10-17T09:00:00.000Z");
    record = base({ planner: undefined, plan: [{ id: "probe-smalls-price" }] as GraphicsRecord["plan"] });
    const g = await run(params({ plan: [{ id: "probe-smalls-price" }], planner: prior }));
    expect(g.planner).toEqual(prior);
    expect(vi.mocked(finish.addGraphics).mock.calls[0][0].savedPlan).toEqual([{ id: "probe-smalls-price" }]);
  });

  it("a re-plan replaces the old rounds with its own", async () => {
    const prior = plannerForJob({ model: "claude-opus-5-5", rounds }, "2026-10-17T09:00:00.000Z");
    record = base({ planner: { model: "claude-opus-5-5", rounds: [{ step: "first", asked: 5, kept: 5, problems: [] }] } });
    const g = await run(params({ plan: [], planner: prior, replan: true }));
    expect(g.planner?.at).toBe("2026-10-18T10:00:00.000Z");
    expect(g.planner?.rounds).toEqual([{ step: "first", asked: 5, kept: 5, problems: [] }]);
  });

  it("graphics off, or a step that failed, leaves the kept rounds and readability as they were", async () => {
    const prior: JobGraphics = { plan: [], planner: plannerForJob({ model: "m", rounds }, "t"), readability: readabilityForJob([lattice]) };
    process.env.GRAPHICS = "0";
    const off = await run(params(structuredClone(prior)));
    expect(off).toMatchObject({ planner: prior.planner, readability: prior.readability, skipped: "motion graphics are off (GRAPHICS=0)" });
    delete process.env.GRAPHICS;
    record = new Error("ffmpeg died");
    const failed = await run(params(structuredClone(prior)));
    expect(failed).toMatchObject({ planner: prior.planner, readability: prior.readability, skipped: "ffmpeg died" });
  });
});

describe("the readability fixes are kept beside what was left out", () => {
  it("a graphic left out as unreadable keeps the steps tried; one that read as designed is not kept", async () => {
    const asDesigned = { id: "three-piles", pass: true, summary: "contrast 9.2:1", steps: ["as designed: contrast 9.2:1"] };
    const shaded = { id: "smalls-label", pass: true, summary: "contrast 6.1:1", steps: ["as designed: contrast 3.9:1", "darker behind the words (0.5): contrast 6.1:1"] };
    record = base({ readability: [asDesigned, lattice, shaded], dropped: [{ id: "lattice-six-hours", why: "text not readable on the picture (colour 4.0:1)" }] });
    const g = await run(params());
    expect(g.dropped).toEqual([{ id: "lattice-six-hours", why: "text not readable on the picture (colour 4.0:1)" }]);
    expect(g.readability).toEqual([lattice, shaded]);
  });

  it("nothing kept when every graphic read as designed — and the last film's fixes do not linger", async () => {
    record = base({ readability: [{ id: "three-piles", pass: true, summary: "contrast 9.2:1", steps: ["as designed: contrast 9.2:1"] }] });
    const g = await run(params({ plan: [], readability: readabilityForJob([lattice]) }));
    expect(g.readability).toBeUndefined();
  });
});

describe("what is kept is capped (it rides every save of the job)", () => {
  it("200 refusals keep 60, each at most 200 characters, and say how many were left out", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ cue: `cue-${i}-${"x".repeat(100)}`, problem: `refused ${"because ".repeat(60)}` }));
    const kept = plannerForJob({ model: "m", rounds: [{ step: "first", asked: 200, kept: 0, problems: many }] }, "t")!;
    const r = kept.rounds[0];
    expect(r.problems).toHaveLength(MAX_KEPT_PER_ROUND);
    expect(r.truncated).toBe(140);
    expect(r.problems.every(p => p.problem.length <= 200 && p.cue.length <= 80)).toBe(true);
    expect(r.problems[0].problem.endsWith("…")).toBe(true);
  });

  it("the fill round's offered sentences are kept short, their start rounded, the passed-over ones visible", () => {
    const offered = Array.from({ length: 70 }, (_, i) => ({ from: 49.6812 + i, to: 52.48 + i, text: i ? `Sentence ${i} ${"word ".repeat(30)}` : "Smalls, about $10 to $40.", asked: [], placed: false }));
    const kept = plannerForJob({ model: "m", rounds: [{ step: "fill", asked: 0, kept: 0, problems: [], offered }] }, "t")!;
    const r = kept.rounds[0];
    expect(r.offered?.[0]).toEqual({ at: 49.68, text: "Smalls, about $10 to $40.", asked: [], placed: false });
    expect(r.offered).toHaveLength(MAX_KEPT_PER_ROUND);
    expect(r.offeredTruncated).toBe(10);
    expect(r.offered!.every(o => o.text.length <= 80)).toBe(true);
    expect(r.truncated).toBeUndefined();
  });

  it("a round with nothing to cut carries no truncation counts and no error", () => {
    const kept = plannerForJob({ model: "m", rounds }, "t")!;
    expect(Object.keys(kept.rounds[0]).sort()).toEqual(["asked", "kept", "problems", "step"]);
    const failed = plannerForJob({ model: "m", rounds: [{ step: "fill", asked: 0, kept: 0, problems: [], offered: [], error: "overloaded" }] }, "t")!;
    expect(failed.rounds[0]).toEqual({ step: "fill", asked: 0, kept: 0, problems: [], offered: [], error: "overloaded" });
  });
});

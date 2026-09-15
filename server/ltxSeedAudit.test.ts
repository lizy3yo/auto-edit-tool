import { describe, it, expect, vi } from "vitest";

vi.mock("./db", () => ({ getAppSetting: vi.fn(), setAppSetting: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./videoAssembly", () => ({ downloadToTemp: vi.fn() }));
vi.mock("./ffmpegPath", () => ({ getFFmpegPath: () => "ffmpeg" }));

import {
  rankTrials,
  passes,
  pickAuditedSeed,
  readingsFrom,
  auditKeyFor,
  EYE_WIDE_RATIO,
  LIVENESS_FLOOR,
  AUDIT_VERSION,
  type SeedTrial,
} from "./ltxSeedAudit";

const trial = (
  seed: number,
  eyeRatio: number | null,
  liveness: number | null = 20,
  body: { score?: number | null; frozen?: boolean | null } = {},
  strength: number | null = 1
): SeedTrial => ({
  seed,
  strength,
  eyeRatio,
  liveness,
  wideFrac: null,
  bodyScore: body.score ?? null,
  handsScore: null,
  bodyFrozen: body.frozen ?? null,
});

describe("passes / rankTrials (the audit's decision)", () => {
  it("keeps the seeds whose eyes stay the photo's size, calmest first, and drops the wide ones", () => {
    // Granny's measured spread: 1.23-1.44 wide, and a HeyGen-like 1.05.
    const r = rankTrials([trial(7, 1.23), trial(11, 1.05), trial(23, 1.44), trial(42, 1.31)]);
    expect(r.seeds).toEqual([11]);
    expect(r.passing).toBe(1);
    expect(r.noneCalm).toBe(false);
    expect(EYE_WIDE_RATIO).toBe(1.2);
  });

  it("drops a frozen mouth even when the eyes are calm", () => {
    expect(rankTrials([trial(7, 1.0, 3), trial(11, 1.1, 21)]).seeds).toEqual([11]);
    expect(LIVENESS_FLOOR).toBe(10);
  });

  it("drops a frozen BODY even when the eyes and mouth are fine (Granny Mae's still cardigan)", () => {
    const frozen = trial(7, 1.05, 21, { score: 0.11, frozen: true });
    const moving = trial(11, 1.1, 20, { score: 0.31, frozen: false });
    expect(passes(frozen)).toBe(false);
    expect(passes(moving)).toBe(true);
    expect(rankTrials([frozen, moving]).seeds).toEqual([11]);
  });

  it("prefers more body movement between two equally calm passes", () => {
    const r = rankTrials([trial(7, 1.1, 20, { score: 0.2, frozen: false }), trial(11, 1.1, 20, { score: 0.6, frozen: false })]);
    expect(r.ranked.map(p => p.seed)).toEqual([11, 7]);
  });

  it("orders the failures least-bad first: wide eyes before a frozen body before a frozen mouth", () => {
    const r = rankTrials([
      trial(7, 1.0, 3), // frozen mouth
      trial(11, 1.0, 20, { frozen: true }), // frozen body
      trial(23, 1.4, 20, { frozen: false }), // wide eyes
    ]);
    expect(r.noneCalm).toBe(true);
    expect(r.ranked.map(p => p.seed)).toEqual([23, 11, 7]);
  });

  it("does not fail a candidate an older worker gave no reading for, and never ranks an errored one", () => {
    expect(passes(trial(7, null, null))).toBe(true);
    const r = rankTrials([{ ...trial(7, 1.0), error: "boom" }, trial(11, 1.1)]);
    expect(r.ranked.map(p => p.seed)).toEqual([11]);
  });

  it("carries each pick's adapter strength", () => {
    const r = rankTrials([trial(101, 1.0, 20, { frozen: false }, 0.7), trial(7, 1.3, 20, {}, 1)]);
    expect(r.ranked[0]).toEqual({ seed: 101, strength: 0.7 });
  });
});

describe("pickAuditedSeed", () => {
  const audit = {
    ranked: [
      { seed: 11, strength: 1 },
      { seed: 7, strength: 1 },
      { seed: 101, strength: 0.7 },
      { seed: 42, strength: 1 },
    ],
    passing: 2,
  };
  it("is stable per scene among the passing picks", () => {
    expect(pickAuditedSeed(audit, { index: 0 })?.seed).toBe(11);
    expect(pickAuditedSeed(audit, { index: 1 })?.seed).toBe(7);
    expect(pickAuditedSeed(audit, { index: 2 })?.seed).toBe(11);
  });
  it("steps DOWN the whole ranking on a retry, never repeating a seed, and ends in null", () => {
    expect(pickAuditedSeed(audit, { index: 0 }, 1)?.seed).toBe(7);
    expect(pickAuditedSeed(audit, { index: 0 }, 2)).toEqual({ seed: 101, strength: 0.7 });
    expect(pickAuditedSeed(audit, { index: 1 }, 3)).toBeNull();
    expect(pickAuditedSeed({ ranked: [], passing: 0 }, { index: 0 })).toBeNull();
  });
});

describe("readingsFrom (the worker's timings)", () => {
  it("reads liveness, the expression and the body objects, and tolerates an older worker", () => {
    expect(
      readingsFrom({
        liveness: 21.7,
        expression: { eye_ratio: 1.27, wide_frac: 0.67 },
        body: { body_score: 0.113, hands_score: null, frozen: true },
      })
    ).toEqual({ liveness: 21.7, eyeRatio: 1.27, wideFrac: 0.67, bodyScore: 0.113, handsScore: null, bodyFrozen: true });
    expect(readingsFrom({ total: 120 })).toEqual({
      liveness: null, eyeRatio: null, wideFrac: null, bodyScore: null, handsScore: null, bodyFrozen: null,
    });
  });
});

describe("auditKeyFor", () => {
  it("is a short stable key per photo, versioned so a stricter rule re-audits every photo", () => {
    const k = auditKeyFor("https://cdn/x/host.jpg");
    expect(k).toMatch(new RegExp(`^ltx_seed_audit_v${AUDIT_VERSION}:[0-9a-f]{16}$`));
    expect(auditKeyFor("https://cdn/x/host.jpg")).toBe(k);
    expect(auditKeyFor("https://cdn/x/other.jpg")).not.toBe(k);
  });
});

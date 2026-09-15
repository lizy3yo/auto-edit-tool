import { describe, it, expect, vi } from "vitest";

vi.mock("./db", () => ({ getAppSetting: vi.fn(), setAppSetting: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./videoAssembly", () => ({ downloadToTemp: vi.fn() }));
vi.mock("./ffmpegPath", () => ({ getFFmpegPath: () => "ffmpeg" }));

import {
  selectSeeds,
  pickAuditedSeed,
  readingsFrom,
  auditKeyFor,
  EYE_WIDE_RATIO,
  LIVENESS_FLOOR,
  type SeedTrial,
} from "./ltxSeedAudit";

const trial = (seed: number, eyeRatio: number | null, liveness: number | null = 20): SeedTrial => ({
  seed,
  eyeRatio,
  liveness,
  wideFrac: null,
});

describe("selectSeeds (the audit's decision)", () => {
  it("keeps the seeds whose eyes stay the photo's size, calmest first, and drops the wide ones", () => {
    // Granny's measured spread: 1.23-1.44 wide, and a HeyGen-like 1.05.
    const r = selectSeeds([trial(7, 1.23), trial(11, 1.05), trial(23, 1.44), trial(42, 1.31)]);
    expect(r.seeds).toEqual([11]);
    expect(r.noneCalm).toBe(false);
    expect(EYE_WIDE_RATIO).toBe(1.2);
  });

  it("drops a frozen mouth even when the eyes are calm", () => {
    const r = selectSeeds([trial(7, 1.0, 3), trial(11, 1.1, 21)]);
    expect(r.seeds).toEqual([11]);
    expect(LIVENESS_FLOOR).toBe(10);
  });

  it("falls back to the least-wide living seeds when none passed, and says so", () => {
    const r = selectSeeds([trial(7, 1.3), trial(11, 1.25), trial(23, 1.4, 2)]);
    expect(r.noneCalm).toBe(true);
    expect(r.seeds).toEqual([11, 7]); // 23's mouth was frozen
  });

  it("does not fail a seed an older worker gave no reading for", () => {
    const r = selectSeeds([trial(7, null, null), trial(11, 1.5)]);
    expect(r.seeds).toEqual([7]);
    expect(r.noneCalm).toBe(false);
  });

  it("never picks a seed whose render errored", () => {
    const r = selectSeeds([{ ...trial(7, 1.0), error: "boom" }, trial(11, 1.1)]);
    expect(r.seeds).toEqual([11]);
  });
});

describe("pickAuditedSeed", () => {
  it("is stable per scene and steps through the list on retry", () => {
    const audit = { seeds: [11, 7, 42] };
    expect(pickAuditedSeed(audit, { index: 0 })).toBe(11);
    expect(pickAuditedSeed(audit, { index: 1 })).toBe(7);
    expect(pickAuditedSeed(audit, { index: 0 }, 1)).toBe(7);
    expect(pickAuditedSeed(audit, { index: 0 }, 3)).toBe(11);
    expect(pickAuditedSeed({ seeds: [] }, { index: 0 })).toBeNull();
  });
});

describe("readingsFrom (the worker's timings)", () => {
  it("reads liveness and the expression object, and tolerates an older worker", () => {
    expect(readingsFrom({ liveness: 21.7, expression: { eye_ratio: 1.27, wide_frac: 0.67 } })).toEqual({
      liveness: 21.7,
      eyeRatio: 1.27,
      wideFrac: 0.67,
    });
    expect(readingsFrom({ total: 120 })).toEqual({ liveness: null, eyeRatio: null, wideFrac: null });
    expect(readingsFrom(undefined).eyeRatio).toBeNull();
  });
});

describe("auditKeyFor", () => {
  it("is a short stable app_settings key per photo URL", () => {
    const k = auditKeyFor("https://cdn/x/host.jpg");
    expect(k).toMatch(/^ltx_seed_audit:[0-9a-f]{16}$/);
    expect(auditKeyFor("https://cdn/x/host.jpg")).toBe(k);
    expect(auditKeyFor("https://cdn/x/other.jpg")).not.toBe(k);
  });
});

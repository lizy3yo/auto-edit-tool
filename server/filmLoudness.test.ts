import { describe, it, expect } from "vitest";
import {
  buildFilmLoudnessArgs,
  filmLoudnessTarget,
  parseLoudnessSummary,
  planFilmLoudness,
  FILM_LIMITER_CEILING_DB,
  FILM_LOUDNESS_TARGET_LUFS,
  FILM_MAX_GAIN_DB,
  FILM_MAX_LIMITING_DB,
  FILM_TRUE_PEAK_MAX_DBTP,
} from "./filmLoudness";

/** What `ebur128=peak=true` prints: a running line per frame, then the summary. */
const report = (i: string, peak: string) => `
[Parsed_ebur128_0 @ 000001] t: 203.9  TARGET:-23 LUFS    M: -40.1 S: -38.2     I: -11.0 LUFS       LRA:   3.4 LU  FTPK: -17.1 -17.1 dBFS  TPK: -16.0 -16.0 dBFS
[Parsed_ebur128_0 @ 000001] Summary:

  Integrated loudness:
    I:         ${i} LUFS
    Threshold: -44.3 LUFS

  Loudness range:
    LRA:         3.5 LU
    Threshold: -54.2 LUFS
    LRA low:   -36.4 LUFS
    LRA high:  -32.9 LUFS

  True peak:
    Peak:      ${peak} dBFS
`;

describe("parseLoudnessSummary", () => {
  it("reads the summary, not the running per-frame line above it", () => {
    expect(parseLoudnessSummary(report("-34.0", "-16.0"))).toEqual({
      integratedLufs: -34,
      truePeakDb: -16,
    });
  });

  it("refuses a report with no summary, and digital silence", () => {
    expect(() => parseLoudnessSummary("Conversion failed!")).toThrow(
      /no summary/
    );
    expect(() => parseLoudnessSummary(report("-70.0", "-91.0"))).toThrow(
      /implausible/
    );
  });
});

describe("planFilmLoudness", () => {
  it("lifts the two measured films to YouTube's level inside the limiter's allowance", () => {
    // Granny Ruth, job 255.
    expect(planFilmLoudness({ integratedLufs: -23.1, truePeakDb: -5 })).toEqual(
      { gainDb: 9.1, limitingDb: 5.6, capped: false, needed: true }
    );
    // Beau Carter, job 357: 20 dB under, the film that prompted this.
    const beau = planFilmLoudness({ integratedLufs: -34, truePeakDb: -16 });
    expect(beau).toEqual({
      gainDb: 20,
      limitingDb: 5.5,
      capped: false,
      needed: true,
    });
  });

  it("holds the gain back rather than limit harder than allowed", () => {
    const plan = planFilmLoudness({ integratedLufs: -26, truePeakDb: -3 });
    expect(plan.capped).toBe(true);
    expect(plan.limitingDb).toBe(FILM_MAX_LIMITING_DB);
    // -3 + gain - (-1.5) === 6  ⇒  gain 7.5, landing at -18.5 instead of -14.
    expect(plan.gainDb).toBe(7.5);
  });

  it("needs no limiting when the peaks have room", () => {
    const plan = planFilmLoudness({ integratedLufs: -18, truePeakDb: -12 });
    expect(plan).toMatchObject({ gainDb: 4, limitingDb: 0, capped: false });
  });

  it("turns a film over the target down, and leaves one on target alone", () => {
    expect(
      planFilmLoudness({ integratedLufs: -10, truePeakDb: -0.5 })
    ).toMatchObject({ gainDb: -4, limitingDb: 0, needed: true });
    expect(
      planFilmLoudness({ integratedLufs: -14.3, truePeakDb: -2 }).needed
    ).toBe(false);
  });

  it("never lifts a near-silent track by more than the cap", () => {
    const plan = planFilmLoudness({ integratedLufs: -60, truePeakDb: -45 });
    expect(plan.gainDb).toBe(FILM_MAX_GAIN_DB);
    expect(plan.capped).toBe(true);
  });

  it("aims at the target it is given", () => {
    expect(
      planFilmLoudness({ integratedLufs: -23.1, truePeakDb: -5 }, -16).gainDb
    ).toBe(7.1);
  });
});

describe("filmLoudnessTarget", () => {
  it("is YouTube's level unless told otherwise", () => {
    expect(FILM_LOUDNESS_TARGET_LUFS).toBe(-14);
    expect(filmLoudnessTarget({})).toBe(-14);
  });

  it("is switched off by FILM_LOUDNESS=0", () => {
    expect(filmLoudnessTarget({ FILM_LOUDNESS: "0" })).toBeNull();
  });

  it("honours FILM_LOUDNESS_LUFS only inside the sane band", () => {
    expect(filmLoudnessTarget({ FILM_LOUDNESS_LUFS: "-16" })).toBe(-16);
    expect(filmLoudnessTarget({ FILM_LOUDNESS_LUFS: "-3" })).toBe(-14);
    expect(filmLoudnessTarget({ FILM_LOUDNESS_LUFS: "loud" })).toBe(-14);
  });
});

describe("buildFilmLoudnessArgs", () => {
  const args = buildFilmLoudnessArgs({
    inputPath: "/tmp/mix.m4a",
    outputPath: "/tmp/master.m4a",
    gainDb: 20,
  });
  const filter = args[args.indexOf("-af") + 1];

  it("applies one fixed gain, never a dynamic normaliser", () => {
    expect(filter.startsWith("volume=20.00dB:precision=float,")).toBe(true);
    expect(filter).not.toContain("loudnorm");
    expect(filter).not.toContain("dynaudnorm");
  });

  it("limits at 4x the sample rate, under the file's true-peak ceiling", () => {
    expect(FILM_LIMITER_CEILING_DB).toBeLessThan(FILM_TRUE_PEAK_MAX_DBTP);
    expect(filter).toContain(
      "aresample=192000,alimiter=limit=0.8414:attack=5:release=50:level=false,aresample=48000"
    );
  });

  it("writes the film's own audio shape and no video", () => {
    expect(args).toContain("-vn");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    expect(args[args.indexOf("-ar") + 1]).toBe("48000");
    expect(args[args.indexOf("-ac") + 1]).toBe("2");
    expect(args[args.length - 1]).toBe("/tmp/master.m4a");
  });
});

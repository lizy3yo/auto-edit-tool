import { describe, it, expect } from "vitest";
import {
  planLevelGains,
  envelopeSamples,
  parseLevelFrames,
  speechLevelDb,
  matchGainDb,
  buildLevelApplyArgs,
  buildLevelMeasureArgs,
  buildMatchGainArgs,
  describeLevelPlan,
  LEVEL_FRAME_SEC,
  LEVEL_ENVELOPE_PAD_SEC,
  LEVEL_GAIN_MAX_DB,
  LEVEL_GAIN_MIN_DB,
  LEVEL_PEAK_CEILING_DBFS,
  type LevelFrame,
} from "./narrationLevel";

/**
 * A synthetic read: `levelsBySec` gives the speech level for each second; every second is
 * three speech frames and one pause frame (-70 dB), the way a sentence alternates with breath.
 */
function read(levelsBySec: number[], peakAbove = 12): LevelFrame[] {
  const frames: LevelFrame[] = [];
  levelsBySec.forEach((lvl, s) => {
    for (let k = 0; k < 4; k++) {
      const pause = k === 3;
      frames.push({
        tSec: s + k * LEVEL_FRAME_SEC,
        rmsDb: pause ? -70 : lvl,
        peakDb: pause ? -60 : lvl + peakAbove,
      });
    }
  });
  return frames;
}

const spread = (v: number[]) => Math.max(...v) - Math.min(...v);

describe("planLevelGains", () => {
  it("lifts a stretch that drifted quiet and pulls a loud one down, toward the film's own median", () => {
    // 60 s at -26, then 40 s that slid to -32, then back: the shape of a TTS generation that
    // trailed off and a new one that began at full energy.
    const levels = [
      ...Array(60).fill(-26),
      ...Array(40).fill(-32),
      ...Array(60).fill(-26),
    ];
    const plan = planLevelGains(read(levels));
    expect(plan.needed).toBe(true);
    expect(plan.targetDb).toBe(-26);
    expect(plan.spreadBeforeDb).toBeCloseTo(6, 0);
    // Deep inside the quiet stretch the gain is the full +6; deep inside the loud ones it is 0.
    const midQuiet = plan.gainsDb[Math.floor(80 / plan.binSec)];
    expect(midQuiet).toBeCloseTo(6, 1);
    expect(plan.gainsDb[Math.floor(30 / plan.binSec)]).toBeCloseTo(0, 1);
    expect(plan.gainsDb[Math.floor(140 / plan.binSec)]).toBeCloseTo(0, 1);
    expect(plan.spreadAfterDb).toBeLessThan(plan.spreadBeforeDb / 2);
  });

  it("never moves the gain by more than a fraction of a dB between neighbouring bins (no pumping)", () => {
    const levels = [
      ...Array(30).fill(-24),
      ...Array(30).fill(-34),
      ...Array(30).fill(-24),
    ];
    const plan = planLevelGains(read(levels));
    for (let i = 1; i < plan.gainsDb.length; i++) {
      expect(
        Math.abs(plan.gainsDb[i] - plan.gainsDb[i - 1])
      ).toBeLessThanOrEqual(2.1);
    }
    // The 10 dB step is corrected over the smoothing window, not in one bin.
    expect(spread(plan.gainsDb)).toBeGreaterThan(8);
  });

  it("clamps the gain to the allowed band so a whisper or a shout is not chased", () => {
    const levels = [
      ...Array(40).fill(-26),
      ...Array(40).fill(-50),
      ...Array(40).fill(-10),
    ];
    const plan = planLevelGains(read(levels));
    expect(Math.max(...plan.gainsDb)).toBeLessThanOrEqual(LEVEL_GAIN_MAX_DB);
    expect(Math.min(...plan.gainsDb)).toBeGreaterThanOrEqual(LEVEL_GAIN_MIN_DB);
  });

  it("caps a bin's gain so its loudest sample stays under the ceiling", () => {
    // A quiet stretch whose peaks already sit 3 dB under the ceiling can only be lifted ~3 dB.
    const frames = read([
      ...Array(40).fill(-26),
      ...Array(40).fill(-34),
      ...Array(40).fill(-26),
    ]);
    for (const f of frames)
      if (f.rmsDb === -34) f.peakDb = LEVEL_PEAK_CEILING_DBFS - 3;
    const plan = planLevelGains(frames);
    const midQuiet = plan.gainsDb[Math.floor(60 / plan.binSec)];
    expect(midQuiet).toBeLessThanOrEqual(3);
    expect(midQuiet).toBeGreaterThan(2);
  });

  it("holds level across a pause instead of chasing the silence", () => {
    // Ten seconds of no speech in the middle of a steady read: the gain there must stay ~0.
    const frames = read(Array(60).fill(-26));
    for (const f of frames) if (f.tSec >= 25 && f.tSec < 35) f.rmsDb = -70;
    const plan = planLevelGains(frames);
    expect(plan.needed).toBe(false);
    expect(plan.gainsDb.every(g => Math.abs(g) < 0.01)).toBe(true);
  });

  it("leaves an already steady read alone", () => {
    const levels = Array.from({ length: 120 }, (_, i) => -26 + (i % 3) * 0.3);
    const plan = planLevelGains(read(levels));
    expect(plan.needed).toBe(false);
    expect(describeLevelPlan(plan)).toContain("already steady");
  });

  it("copes with no frames and with frames that never reach speech", () => {
    expect(planLevelGains([]).needed).toBe(false);
    const silent = planLevelGains(
      Array.from({ length: 40 }, (_, i) => ({
        tSec: i * 0.25,
        rmsDb: -120,
        peakDb: -120,
      }))
    );
    expect(silent.needed).toBe(false);
  });
});

describe("envelopeSamples", () => {
  it("interpolates linearly between bin centres, holds flat at the ends and runs past the audio", () => {
    const plan = planLevelGains(
      read([...Array(20).fill(-26), ...Array(20).fill(-32)]),
      {
        smoothBins: 1,
      }
    );
    const rate = 100;
    const env = envelopeSamples(plan, 40, rate);
    expect(env.length).toBe((40 + LEVEL_ENVELOPE_PAD_SEC) * rate);
    // First bin's gain is held from t=0 to its centre.
    expect(env[0]).toBeCloseTo(Math.pow(10, plan.gainsDb[0] / 20), 5);
    // The last value is the last bin's gain, held through the pad.
    expect(env[env.length - 1]).toBeCloseTo(
      Math.pow(10, plan.gainsDb[plan.gainsDb.length - 1] / 20),
      5
    );
    // Midway between two bin centres the value is the mean of their (dB) gains.
    const i = 10;
    const tMid = (i + 1) * plan.binSec;
    const expectDb = (plan.gainsDb[i] + plan.gainsDb[i + 1]) / 2;
    expect(20 * Math.log10(env[Math.round(tMid * rate)])).toBeCloseTo(
      expectDb,
      2
    );
  });

  it("is unity when there is no plan", () => {
    const env = envelopeSamples(planLevelGains([]), 3, 100);
    expect(env.every(v => v === 1)).toBe(true);
  });
});

describe("parseLevelFrames + speechLevelDb", () => {
  const print = [
    "frame:0    pts:0       pts_time:0",
    "lavfi.astats.1.Peak_level=-12.5",
    "lavfi.astats.1.RMS_level=-20.1",
    "lavfi.astats.2.Peak_level=-15.0",
    "lavfi.astats.2.RMS_level=-26.0",
    "lavfi.astats.Overall.RMS_level=-23",
    "frame:1    pts:12000   pts_time:0.25",
    "lavfi.astats.1.Peak_level=-inf",
    "lavfi.astats.1.RMS_level=-inf",
    "lavfi.astats.2.Peak_level=-inf",
    "lavfi.astats.2.RMS_level=-inf",
    "",
    "frame:2    pts:24000   pts_time:0.5",
    "lavfi.astats.2.RMS_level=-28.0",
    "lavfi.astats.1.Peak_level=-14.0",
  ].join("\n");

  it("reads channel 1's peak and channel 2's RMS per frame, whatever the order, and keeps -inf finite", () => {
    const frames = parseLevelFrames(print);
    expect(frames).toEqual([
      { tSec: 0, peakDb: -12.5, rmsDb: -26 },
      { tSec: 0.25, peakDb: -120, rmsDb: -120 },
      { tSec: 0.5, peakDb: -14, rmsDb: -28 },
    ]);
  });

  it("gates on the loud frames and averages energy, not dB", () => {
    const frames = read([...Array(10).fill(-24), ...Array(10).fill(-30)]);
    // Energy mean of -24 and -30 is -26.0, not the -27 a dB mean would give.
    expect(speechLevelDb(frames)).toBeCloseTo(-26.0, 1);
    expect(speechLevelDb([])).toBeNaN();
  });
});

describe("matchGainDb", () => {
  it("returns the gain to the target, 0 inside the deadband and 0 past the sanity limit", () => {
    expect(matchGainDb(-30, -26)).toBe(4);
    expect(matchGainDb(-23.04, -26)).toBe(-3);
    expect(matchGainDb(-26.3, -26)).toBe(0);
    expect(matchGainDb(-40, -26)).toBe(0);
    expect(matchGainDb(NaN, -26)).toBe(0);
  });
});

describe("ffmpeg args", () => {
  it("measures full-band peak on channel 1 and the voice band on channel 2, one frame per 250 ms", () => {
    const args = buildLevelMeasureArgs("in.mp3");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("asetnsamples=n=12000");
    expect(graph).toContain("[b]highpass=f=300,lowpass=f=3000[bb]");
    expect(graph).toContain("[f][bb]amerge=inputs=2,astats=metadata=1:reset=1");
    expect(args.slice(-3)).toEqual(["-f", "null", "-"]);
  });

  it("pins the envelope leg to float so gains above 1.0 survive, and multiplies into the audio", () => {
    const args = buildLevelApplyArgs({
      audioPath: "in.mp3",
      envelopePath: "env.f32",
      outputPath: "out.mp3",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(args.slice(args.indexOf("-f"), args.indexOf("-f") + 7)).toEqual([
      "-f",
      "f32le",
      "-ar",
      "100",
      "-ac",
      "1",
      "-i",
    ]);
    expect(graph).toContain(
      "[1:a]aresample=osr=48000:osf=fltp,pan=stereo|c0=c0|c1=c0[g]"
    );
    expect(graph).toContain("[a][g]amultiply[o]");
    expect(args.slice(-5)).toEqual([
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "out.mp3",
    ]);
  });

  it("applies a match gain as one static volume in the pipeline's mp3 shape", () => {
    const args = buildMatchGainArgs({
      audioPath: "in.mp3",
      gainDb: -3,
      outputPath: "out.mp3",
    });
    expect(args).toContain("volume=-3dB");
    expect(args.join(" ")).toContain("-ar 48000 -ac 2 out.mp3");
  });
});

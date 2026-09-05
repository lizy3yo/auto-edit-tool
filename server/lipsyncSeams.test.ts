import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync } from "fs";

/**
 * ffmpeg is mocked at the module seam: the per-frame jump series is what the mock "measures",
 * and the repair call records the filter graph it was handed. The arithmetic — where the
 * seams fall, which stand out, what gets replaced — is the subject.
 */
let jumps: number[] = [];
let failRepair = false;
const ffmpegCalls: string[][] = [];
vi.mock("./videoAssembly", () => ({
  runFfmpeg: async (args: string[]) => {
    ffmpegCalls.push(args);
    if (failRepair) throw new Error("ffmpeg exploded");
    writeFileSync(args[args.length - 1], "repaired-video");
  },
}));
vi.mock("./ffmpegPath", () => ({ getFFmpegPath: () => "ffmpeg" }));
vi.mock("child_process", () => ({
  spawn: () => {
    const handlers: Record<string, (...a: any[]) => void> = {};
    const stderr = {
      on: (_ev: string, cb: (d: string) => void) => {
        setTimeout(
          () =>
            cb(jumps.map(j => `lavfi.scene_score=${j.toFixed(6)}\n`).join("")),
          0
        );
      },
    };
    const proc = {
      stderr,
      on: (ev: string, cb: (...a: any[]) => void) => {
        handlers[ev] = cb;
        if (ev === "close") setTimeout(() => cb(0), 1);
        return proc;
      },
    };
    return proc;
  },
}));

import {
  predictSeamFrames,
  seamsNeedingRepair,
  seamRepairFilter,
  smoothWindowSeams,
  SEAM_JUMP_RATIO,
} from "./lipsyncSeams";

/** A flat series with one spike, `ratio` times the floor, at `at`. */
const seriesWithSpike = (n: number, at: number, ratio: number, floor = 0.01) =>
  Array.from({ length: n }, (_, i) =>
    i === 0 ? 0 : i === at ? floor * ratio : floor
  );

beforeEach(() => {
  jumps = [];
  failRepair = false;
  ffmpegCalls.length = 0;
});

describe("predictSeamFrames", () => {
  it("places a handoff every 81 - motionFrame frames after the first, minus the trimmed lead", () => {
    // The clip that motivated this: 118 delivered frames, 2 s lead (50 frames), overlap 37.
    // Raw handoffs 81, 125, 169 → delivered 31, 75, 119; 119 is past the end.
    expect(
      predictSeamFrames({ totalFrames: 118, leadSec: 2, motionFrame: 37 })
    ).toEqual([31, 75]);
  });

  it("uses the worker's default overlap when the app sent none, and no lead", () => {
    // 81 - 25 = 56: raw 81, 137 → delivered the same.
    expect(predictSeamFrames({ totalFrames: 150 })).toEqual([81, 137]);
  });

  it("drops a handoff too close to either edge to repair around", () => {
    // Lead of 80 frames, step 56: raw 81 → delivered 1 (no b-3 anchor), 137 → 57, 193 → 113
    // (needs frame 116 as look-ahead, and a 116-frame clip ends at 115).
    expect(
      predictSeamFrames({ totalFrames: 116, leadSec: 3.2, motionFrame: 25 })
    ).toEqual([57]);
  });

  it("is empty when the overlap swallows the window", () => {
    expect(predictSeamFrames({ totalFrames: 300, motionFrame: 81 })).toEqual(
      []
    );
  });
});

describe("seamsNeedingRepair", () => {
  it("flags a handoff whose jump stands out from its neighbours", () => {
    const j = seriesWithSpike(118, 75, 2.8);
    expect(seamsNeedingRepair(j, [31, 75])).toEqual([
      { frame: 75, ratio: expect.closeTo(2.8, 5) },
    ]);
  });

  it("leaves an ordinary handoff alone — a mouth closing on a b is speech, not a seam", () => {
    const j = seriesWithSpike(118, 75, SEAM_JUMP_RATIO - 0.1);
    expect(seamsNeedingRepair(j, [75])).toEqual([]);
  });

  it("ignores a spike that is tiny in absolute terms, however large the ratio", () => {
    // A near-static clip: floor 0.0005, spike 10x but still 0.005 < nothing visible… the
    // absolute floor is 0.004, so 0.0035 must not flag.
    const j = seriesWithSpike(118, 75, 7, 0.0005);
    expect(seamsNeedingRepair(j, [75])).toEqual([]);
  });

  it("judges each seam against ITS OWN neighbourhood, excluding the seam frames themselves", () => {
    // Loud first half, quiet second: the seam at 75 is a spike relative to the quiet frames.
    const j = Array.from({ length: 118 }, (_, i) => (i < 50 ? 0.03 : 0.01));
    j[75] = 0.025;
    j[76] = 0.02; // the frame after the seam also jumps — it must not lift the baseline
    expect(seamsNeedingRepair(j, [75]).map(s => s.frame)).toEqual([75]);
  });
});

describe("seamRepairFilter", () => {
  it("copies around each seam and interpolates the four frames across it", () => {
    const f = seamRepairFilter([75], 118);
    // Frames 0-72 copied, 73-76 interpolated between 72 and 77 (with 78 as look-ahead), 77-end copied.
    expect(f).toContain("trim=start_frame=0:end_frame=73");
    expect(f).toContain("eq(n\\,72)+eq(n\\,77)+eq(n\\,78)");
    expect(f).toContain("minterpolate=fps=25");
    expect(f).toContain("trim=start_frame=1:end_frame=5");
    expect(f).toContain("trim=start_frame=77:end_frame=118");
    expect(f).toContain("concat=n=3:v=1:a=0");
    // Frame count is preserved: 73 + 4 + 41 = 118.
  });

  it("chains several seams in order", () => {
    const f = seamRepairFilter([75, 31], 118);
    expect(f).toContain("split=5");
    expect(f).toContain("trim=start_frame=0:end_frame=29");
    expect(f).toContain("trim=start_frame=33:end_frame=73");
    expect(f).toContain("trim=start_frame=77:end_frame=118");
    expect(f).toContain("concat=n=5");
  });
});

describe("smoothWindowSeams", () => {
  it("repairs only the handoffs that stand out and keeps the audio untouched", async () => {
    jumps = seriesWithSpike(118, 75, 2.8);
    const r = await smoothWindowSeams(Buffer.from("mp4"), {
      leadSec: 2,
      motionFrame: 37,
    });
    expect(r.checked).toEqual([31, 75]);
    expect(r.repaired).toEqual([75]);
    expect(r.video.toString()).toBe("repaired-video");
    const args = ffmpegCalls[0];
    expect(args).toContain("-filter_complex");
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
  });

  it("returns the clip as rendered when no handoff stands out", async () => {
    jumps = seriesWithSpike(118, 75, 1.2);
    const r = await smoothWindowSeams(Buffer.from("mp4"), {
      leadSec: 2,
      motionFrame: 37,
    });
    expect(r.repaired).toEqual([]);
    expect(r.video.toString()).toBe("mp4");
    expect(ffmpegCalls).toEqual([]);
  });

  it("fails open: a broken repair hands back the original clip", async () => {
    jumps = seriesWithSpike(118, 75, 2.8);
    failRepair = true;
    const r = await smoothWindowSeams(Buffer.from("mp4"), {
      leadSec: 2,
      motionFrame: 37,
    });
    expect(r.video.toString()).toBe("mp4");
    expect(r.repaired).toEqual([]);
  });
});

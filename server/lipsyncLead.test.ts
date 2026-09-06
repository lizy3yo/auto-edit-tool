import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync } from "fs";
import path from "path";

/**
 * ffmpeg, the master slicer and R2 are mocked at the module seam. The mocks record what they
 * were asked for — the lead arithmetic (how much real narration vs silence) is the subject.
 */
const sliceCalls: { url: string; startSec: number; lenSec: number }[] = [];
const ffmpegCalls: string[][] = [];
let failSlice = false;
vi.mock("./videoAssembly", () => ({
  sliceAudioSegments: async (
    url: string,
    segs: { startSec: number; lenSec: number }[]
  ) => {
    if (failSlice) throw new Error("master unreachable");
    for (const seg of segs) sliceCalls.push({ url, ...seg });
    return segs.map((_, i) => Buffer.from(`master-slice-${i}`));
  },
  downloadToTemp: async (_url: string, dir: string, name: string) => {
    const p = path.join(dir, name);
    writeFileSync(p, "scene-track");
    return p;
  },
  runFfmpeg: async (args: string[]) => {
    ffmpegCalls.push(args);
    writeFileSync(args[args.length - 1], "ffmpeg-out");
  },
}));
const puts: string[] = [];
vi.mock("./storage", () => ({
  storagePut: async (key: string) => {
    puts.push(key);
    return { url: `https://cdn.example/${key}` };
  },
}));

import {
  buildLipsyncLeadTrack,
  trimClipHead,
  fitLeadToWindowGrid,
  windowsFor,
  MIN_LEAD_SEC,
} from "./lipsyncLead";

/** The `-t <sec>` a silence-prepend call generated, if any. */
const silenceSecOf = (call: string[]) =>
  call.includes("anullsrc=r=48000:cl=stereo")
    ? Number(call[call.indexOf("-t") + 1])
    : null;

beforeEach(() => {
  sliceCalls.length = 0;
  ffmpegCalls.length = 0;
  puts.length = 0;
  failSlice = false;
});

describe("buildLipsyncLeadTrack", () => {
  it("prepends the two seconds of narration that really precede the scene", async () => {
    const r = await buildLipsyncLeadTrack({
      jobId: 7,
      scene: {
        index: 4,
        audioUrl: "https://r2/scene-4.mp3",
        narrationStartSec: 30,
        narrationEndSec: 36,
      },
      masterAudioUrl: "https://r2/master.mp3",
      leadSec: 2,
    });
    expect(r).toEqual({
      url: expect.stringMatching(/scene-4-lipsync-vo-/),
      leadSec: 2,
      // The clip's own narration: the plain [30, 36) slice of the MASTER, not the stored
      // file — cut-room edits leave that file stale against the range the film plays.
      narrationUrl: expect.stringMatching(/scene-4-lipsync-narration-/),
    });
    // [28, 36): the lead plus the scene's words in one piece; [30, 36): the plain slice.
    expect(sliceCalls).toEqual([
      { url: "https://r2/master.mp3", startSec: 28, lenSec: 8 },
      { url: "https://r2/master.mp3", startSec: 30, lenSec: 6 },
    ]);
    // The master had the full two seconds — no silence needed.
    expect(ffmpegCalls.map(silenceSecOf).filter(Boolean)).toEqual([]);
  });

  it("pads with silence when the master has less than the lead before the scene", async () => {
    // First scene of the film: 0.5s of master before it, so 1.5s of silence makes up the lead.
    const r = await buildLipsyncLeadTrack({
      jobId: 7,
      scene: {
        index: 0,
        audioUrl: "https://r2/scene-0.mp3",
        narrationStartSec: 0.5,
        narrationEndSec: 6,
      },
      masterAudioUrl: "https://r2/master.mp3",
      leadSec: 2,
    });
    expect(r?.leadSec).toBe(2); // the trim is always the full lead
    expect(sliceCalls[0]).toMatchObject({ startSec: 0, lenSec: 6 });
    expect(ffmpegCalls.map(silenceSecOf).filter(Boolean)).toEqual([1.5]);
  });

  it("pins the sample format to float on both legs of the silence concat", async () => {
    // Regression guard for the 8-bit bug: anullsrc emits pcm_u8, and a concat that only
    // matched rate and layout quantized the narration to 8 bits (a "buzzing" noise floor
    // that also degraded the lip-sync it drove).
    await buildLipsyncLeadTrack({
      jobId: 7,
      scene: { index: 2, audioUrl: "https://r2/scene-2.mp3" },
      masterAudioUrl: null,
      leadSec: 2,
    });
    const call = ffmpegCalls.find(c => silenceSecOf(c) != null)!;
    const graph = call[call.indexOf("-filter_complex") + 1];
    const legs = graph.split(";").filter(p => p.includes("aformat"));
    expect(legs).toHaveLength(2);
    for (const leg of legs) expect(leg).toContain("sample_fmts=fltp");
  });

  it("uses silence for the whole lead on a scene voiced off the master", async () => {
    const r = await buildLipsyncLeadTrack({
      jobId: 7,
      scene: { index: 2, audioUrl: "https://r2/scene-2-regen.mp3" },
      masterAudioUrl: "https://r2/master.mp3",
      leadSec: 2,
    });
    expect(r?.leadSec).toBe(2);
    expect(sliceCalls).toEqual([]); // never touches the master without a range
    expect(ffmpegCalls.map(silenceSecOf).filter(Boolean)).toEqual([2]);
    // Off-master the stored file is the only narration there is.
    expect(r?.narrationUrl).toBe("https://r2/scene-2-regen.mp3");
  });

  it("is off at lead 0 and fails open on any error", async () => {
    const scene = {
      index: 1,
      audioUrl: "https://r2/s.mp3",
      narrationStartSec: 10,
      narrationEndSec: 15,
    };
    expect(
      await buildLipsyncLeadTrack({
        jobId: 7,
        scene,
        masterAudioUrl: "https://r2/master.mp3",
        leadSec: 0,
      })
    ).toBeNull();
    failSlice = true;
    // A worse render beats no render: the caller sends the plain track instead.
    expect(
      await buildLipsyncLeadTrack({
        jobId: 7,
        scene,
        masterAudioUrl: "https://r2/master.mp3",
        leadSec: 2,
      })
    ).toBeNull();
    expect(puts).toEqual([]);
  });
});

describe("trimClipHead", () => {
  it("seeks BEFORE the input and re-encodes, so the cut is frame-accurate", async () => {
    await trimClipHead(Buffer.from("mp4"), 2);
    const args = ffmpegCalls[0];
    const ss = args.indexOf("-ss");
    const i = args.indexOf("-i");
    expect(args[ss + 1]).toBe("2.000");
    expect(ss).toBeLessThan(i); // input-side seek
    expect(args).toContain("libx264"); // a stream copy would snap to a keyframe
    // No narration given: keep whatever audio the clip has.
    expect(args.join(" ")).toContain("-map 0:a?");
  });

  it("muxes the scene's own narration in place of the worker's audio when given", async () => {
    await trimClipHead(Buffer.from("mp4"), 2, {
      narrationUrl: "https://r2/scene-1-vo.mp3",
    });
    const args = ffmpegCalls[0];
    const joined = args.join(" ");
    // Video from the trimmed worker clip, audio from the narration file, from time 0.
    expect(joined).toContain("-map 0:v");
    expect(joined).toContain("-map 1:a");
    expect(joined).not.toContain("0:a");
    // `-shortest` truncated a 5.4 s clip to 3.4 s in testing — must stay out.
    expect(joined).not.toContain("-shortest");
    // One AAC encode from the mp3 the film uses — never the worker's re-encode.
    expect(args[args.indexOf("-b:a") + 1]).toBe("192k");
    // The narration is the SECOND input; the seek applies only to the first.
    const inputs = args.reduce<number[]>(
      (acc, a, i) => (a === "-i" ? [...acc, i] : acc),
      []
    );
    expect(inputs).toHaveLength(2);
    expect(args.indexOf("-ss")).toBeLessThan(inputs[0]);
  });
});

describe("fitLeadToWindowGrid", () => {
  // Render cost is a STEP function: 81 frames for the first window, then 81-motion_frame new
  // ones each. A run-up that pushes a beat a few frames past a boundary buys a whole extra
  // window for warm-up nobody sees.
  it("shrinks the run-up when that saves a whole window, keeping as much of it as it can", () => {
    // The measured case: 6.9 s beat, overlap 37 (step 44). 2 s → 222 frames → 5 windows.
    expect(windowsFor(222, 37)).toBe(5);
    const fitted = fitLeadToWindowGrid({
      narrationSec: 6.897,
      leadSec: 2,
      motionFrame: 37,
    });
    expect(fitted).toBeLessThan(2);
    expect(fitted).toBeGreaterThanOrEqual(MIN_LEAD_SEC);
    // Same delivered picture, one window cheaper.
    expect(windowsFor(Math.round((6.897 + fitted) * 25), 37)).toBe(4);
    // And it keeps the LONGEST run-up that fits, not the shortest that works.
    expect(fitted).toBeGreaterThan(1.5);
  });

  it("leaves a beat alone when shrinking would not save a window", () => {
    // 3 s + 2 s = 125 frames, the last frame of the 2nd window at step 44; 3 s + 1 s = 100 is
    // inside the same window. Nothing to buy, so the full run-up is kept.
    const fitted = fitLeadToWindowGrid({
      narrationSec: 3,
      leadSec: 2,
      motionFrame: 37,
    });
    expect(fitted).toBe(2);
    expect(windowsFor(125, 37)).toBe(windowsFor(100, 37));
  });

  it("never trims below the floor, and never grows a lead", () => {
    // Even where a shorter run-up would save a window, the cold-start cure wins below 1 s.
    const fitted = fitLeadToWindowGrid({
      narrationSec: 3.2,
      leadSec: 1,
      motionFrame: 37,
    });
    expect(fitted).toBe(1);
    expect(
      fitLeadToWindowGrid({ narrationSec: 5, leadSec: 0, motionFrame: 37 })
    ).toBe(0);
  });

  it("counts windows the way the worker does", () => {
    expect(windowsFor(81, 37)).toBe(1);
    expect(windowsFor(82, 37)).toBe(2);
    expect(windowsFor(125, 37)).toBe(2); // 81 + 44
    expect(windowsFor(126, 37)).toBe(3);
    // A wider overlap carries more context across each join and so needs MORE windows for the
    // same length — that is what restoring 37 costs, and why it is worth spending elsewhere.
    expect(windowsFor(180, 25)).toBe(3);
    expect(windowsFor(180, 37)).toBe(4);
    expect(windowsFor(250, 25)).toBe(5);
    expect(windowsFor(250, 37)).toBe(5);
  });
});

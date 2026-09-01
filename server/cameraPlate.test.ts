import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync } from "fs";
import path from "path";

/**
 * ffmpeg and R2 are mocked at the module seam; the temp-dir plumbing runs for real so the
 * readFileSync(out) path is exercised. The runFfmpeg mock writes the output file the real
 * encoder would have, keyed off the final arg — same contract, no encoder.
 */
const ffmpegCalls: string[][] = [];
let failNextEncode = false;
vi.mock("./videoAssembly", () => ({
  downloadToTemp: async (_url: string, dir: string, name: string) => {
    const p = path.join(dir, name);
    writeFileSync(p, "img-bytes");
    return p;
  },
  runFfmpeg: async (args: string[]) => {
    ffmpegCalls.push(args);
    if (failNextEncode) {
      failNextEncode = false;
      throw new Error("ffmpeg exploded");
    }
    writeFileSync(args[args.length - 1], "mp4-bytes");
  },
}));

const putKeys: string[] = [];
vi.mock("./storage", () => ({
  storagePut: async (key: string) => {
    putKeys.push(key);
    return { url: `https://cdn.example/${key}` };
  },
}));

import { buildCameraPlate, __resetCameraPlateCache } from "./cameraPlate";

/** The `-t <seconds>` value a call encoded at. */
const encodedSeconds = (call: string[]) => call[call.indexOf("-t") + 1];

beforeEach(() => {
  __resetCameraPlateCache();
  ffmpegCalls.length = 0;
  putKeys.length = 0;
  failNextEncode = false;
});

describe("buildCameraPlate", () => {
  it("rounds durations up into buckets so scenes sharing a photo share one encode", async () => {
    // 3s and 12s host scenes both fit the 15s bucket — one ffmpeg run, one upload, one URL.
    const a = await buildCameraPlate("https://r2/host.jpg", 3);
    const b = await buildCameraPlate("https://r2/host.jpg", 12);
    expect(a).toBe(b);
    expect(ffmpegCalls).toHaveLength(1);
    expect(encodedSeconds(ffmpegCalls[0])).toBe("15");

    // 16s spills into the next bucket: a longer plate is a different artifact.
    const c = await buildCameraPlate("https://r2/host.jpg", 16);
    expect(c).not.toBe(a);
    expect(ffmpegCalls).toHaveLength(2);
    expect(encodedSeconds(ffmpegCalls[1])).toBe("30");
  });

  it("dedupes concurrent builds of the same plate", async () => {
    // Five host scenes submit at once (the lane runs them concurrently) — the cache must
    // hand them the same in-flight promise, not race five identical encodes.
    const urls = await Promise.all(
      Array.from({ length: 5 }, () =>
        buildCameraPlate("https://r2/host.jpg", 5)
      )
    );
    expect(new Set(urls).size).toBe(1);
    expect(ffmpegCalls).toHaveLength(1);
  });

  it("evicts a failed build so the next scene retries instead of inheriting the failure", async () => {
    failNextEncode = true;
    await expect(buildCameraPlate("https://r2/host.jpg", 5)).rejects.toThrow(
      "ffmpeg exploded"
    );
    // Same key, fresh attempt — a cached rejection would fail every later host scene too.
    const url = await buildCameraPlate("https://r2/host.jpg", 5);
    expect(url).toMatch(/^https:\/\/cdn\.example\/lipsync\/plates\//);
    expect(ffmpegCalls).toHaveLength(2);
  });
});

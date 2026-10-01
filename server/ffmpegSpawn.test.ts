import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audioInput,
  ffmpegNeverStarted,
  isMp3File,
  retryUnstarted,
  withInputFormats,
} from "./ffmpegSpawn";
import { isTransientFfmpegError } from "./videoAssembly";

const dir = mkdtempSync(join(tmpdir(), "ffmpeg-spawn-"));
const file = (name: string, bytes: Buffer) => {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};
const tagged = file("tagged.mp3", Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]));
const bare = file("bare.mp3", Buffer.from([0xff, 0xfb, 0x90, 0x00]));
const adts = file("voice.aac", Buffer.from([0xff, 0xf1, 0x50, 0x80]));
const wav = file("voice.wav", Buffer.from("RIFF0000WAVE"));
const mp4 = file("clip.mp4", Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]));

describe("isMp3File", () => {
  it("knows an mp3 by its first bytes, whatever its size", () => {
    expect(isMp3File(tagged)).toBe(true);
    expect(isMp3File(bare)).toBe(true);
  });
  it("does not take AAC, WAV, MP4, a URL, a filter source or a missing file for one", () => {
    expect(isMp3File(adts)).toBe(false);
    expect(isMp3File(wav)).toBe(false);
    expect(isMp3File(mp4)).toBe(false);
    expect(isMp3File("https://example.com/a.mp3")).toBe(false);
    expect(isMp3File("anullsrc=r=48000:cl=stereo")).toBe(false);
    expect(isMp3File(join(dir, "missing.mp3"))).toBe(false);
  });
});

describe("withInputFormats", () => {
  it("names every mp3 input and leaves everything else as it was", () => {
    const args = ["-y", "-i", mp4, "-i", tagged, "-i", wav, "-map", "1:a", "out.mp4"];
    expect(withInputFormats(args)).toEqual([
      "-y", "-i", mp4, "-f", "mp3", "-i", tagged, "-i", wav, "-map", "1:a", "out.mp4",
    ]);
  });
  it("never doubles a format the caller already named", () => {
    const args = ["-f", "lavfi", "-i", "anullsrc", ...audioInput(tagged)];
    expect(withInputFormats(args)).toEqual(args);
  });
  it("never overrides a format named further back among the input's own options (a raw mask of 255s)", () => {
    const mask = file("room.gray", Buffer.alloc(64, 0xff));
    const args = ["-i", mp4, "-f", "rawvideo", "-pix_fmt", "gray", "-s", "480x270", "-r", "25", "-i", mask];
    expect(withInputFormats(args)).toEqual(args);
    // ...but the NEXT input is judged on its own.
    expect(withInputFormats([...args, "-i", tagged])).toEqual([...args, "-f", "mp3", "-i", tagged]);
  });
});

describe("ffmpeg that never started", () => {
  it("is told apart from ffmpeg refusing the job", () => {
    expect(ffmpegNeverStarted("spawn UNKNOWN")).toBe(true);
    expect(ffmpegNeverStarted("FFmpeg process error: spawn EAGAIN")).toBe(true);
    expect(ffmpegNeverStarted("FFmpeg failed (exit 3221225794): ")).toBe(true);
    expect(ffmpegNeverStarted("Cannot allocate memory")).toBe(true);
    expect(ffmpegNeverStarted("FFmpeg failed (exit 1): Stream map '1:a' matches no streams")).toBe(false);
    expect(ffmpegNeverStarted("FFmpeg timed out after 1800000ms")).toBe(false);
  });
  it("counts as a busy-machine blip for the scene retry too", () => {
    expect(isTransientFfmpegError("FFmpeg failed (exit 3221225794): ")).toBe(true);
    expect(isTransientFfmpegError("spawn UNKNOWN")).toBe(true);
  });
  it("is tried again, and a real failure is not", async () => {
    let calls = 0;
    const ok = await retryUnstarted(async () => {
      if (++calls < 3) throw new Error("spawn UNKNOWN");
      return "done";
    }, [0, 0, 0]);
    expect([ok, calls]).toEqual(["done", 3]);

    calls = 0;
    await expect(
      retryUnstarted(async () => {
        calls++;
        throw new Error("FFmpeg failed (exit 1): bad filter");
      }, [0, 0])
    ).rejects.toThrow("bad filter");
    expect(calls).toBe(1);

    calls = 0;
    await expect(
      retryUnstarted(async () => {
        calls++;
        throw new Error("spawn UNKNOWN");
      }, [0, 0])
    ).rejects.toThrow("spawn UNKNOWN");
    expect(calls).toBe(3);
  });
});

/**
 * TRIPWIRE: every ffmpeg call must go through ffmpegSpawn.ts, or the next one written will guess
 * a tiny mp3 is video, or fail a film the first time the machine is busy. Only the startup check
 * that ffmpeg exists (ffmpegPath.ts) and the ffprobe duration probe (mediaProbe.ts, which names
 * the format and retries itself) may start a process directly.
 */
describe("every ffmpeg call goes through ffmpegSpawn", () => {
  const MAY_SPAWN = new Set(["ffmpegPath.ts", "ffmpegSpawn.ts", "mediaProbe.ts"]);
  const sources: [string, string][] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) sources.push([p, readFileSync(p, "utf8")]);
    }
  };
  walk(join(__dirname));
  walk(join(__dirname, "..", "shared"));

  it("no other file starts a process itself", () => {
    const offenders = sources
      .filter(([p]) => !MAY_SPAWN.has(p.split(/[\\/]/).pop()!))
      .filter(([, src]) => /from ["'](node:)?child_process["']/.test(src))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it("every ffmpeg call waits out a busy machine", () => {
    const offenders = sources
      .filter(([p]) => !p.endsWith("ffmpegSpawn.ts"))
      .filter(([, src]) => src.includes("spawnFfmpeg(") && !src.includes("retryUnstarted("))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });
});

describe("waitForFreeMemory — ffmpeg waits for the MACHINE to have room", () => {
  it("waits while memory is short, then goes", async () => {
    const { waitForFreeMemory } = await import("./ffmpegSpawn");
    const readings = [400, 600, 900, 1500];
    let k = 0;
    const waited = await waitForFreeMemory(1024, 60_000, () => readings[Math.min(k++, readings.length - 1)], () => 1);
    expect(k).toBe(4); // three short readings waited out, the fourth let it start
    expect(waited).toBeLessThan(1000);
  });
  it("never waits forever", async () => {
    const { waitForFreeMemory } = await import("./ffmpegSpawn");
    const waited = await waitForFreeMemory(1024, 30, () => 100, () => 5);
    expect(waited).toBeGreaterThanOrEqual(30);
  });
  it("counts an encoder that could not get memory as never started", () => {
    expect(ffmpegNeverStarted("FFmpeg failed (exit 3752568763): x264 [error]: malloc of size 11619264 failed")).toBe(true);
  });
});

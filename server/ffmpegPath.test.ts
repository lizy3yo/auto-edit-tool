/**
 * server/ffmpegPath.test.ts
 *
 * Tests for resolveFFmpegPath() — the auto-detecting FFmpeg resolver that prefers
 * a binary compiled with drawtext (libfreetype) support.
 *
 * Each test calls vi.resetModules() (via beforeEach) so the module-level _resolved
 * cache is cleared and we get a fresh import each time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const savedFFmpegPath = process.env.FFMPEG_PATH;

beforeEach(() => {
  vi.resetModules();
  delete process.env.FFMPEG_PATH;
});

afterEach(() => {
  // Un-register any doMock factories so they don't bleed into integration tests.
  vi.doUnmock("child_process");
  // Restore the env var that was in place before the test suite ran.
  if (savedFFmpegPath === undefined) {
    delete process.env.FFMPEG_PATH;
  } else {
    process.env.FFMPEG_PATH = savedFFmpegPath;
  }
});

// ---------------------------------------------------------------------------
// getFFmpegPath (sync) — sanity-check the env-var override path
// ---------------------------------------------------------------------------

describe("getFFmpegPath", () => {
  it("returns the FFMPEG_PATH env override when it exists on disk", async () => {
    process.env.FFMPEG_PATH = "/usr/bin/ffmpeg";
    const { getFFmpegPath } = await import("./ffmpegPath");
    expect(getFFmpegPath()).toBe("/usr/bin/ffmpeg");
  });
});

// ---------------------------------------------------------------------------
// resolveFFmpegPath — integration tests (real binaries, no spawn mocking)
// ---------------------------------------------------------------------------

describe("resolveFFmpegPath — integration", () => {
  it("finds a drawtext-capable FFmpeg on this system", async () => {
    const { resolveFFmpegPath } = await import("./ffmpegPath");
    const result = await resolveFFmpegPath();
    expect(result.drawtext).toBe(true);
    // The bundled ffmpeg-static lacks freetype; /usr/bin/ffmpeg 6.1.1 has it.
    expect(result.path).toBe("/usr/bin/ffmpeg");
  });

  it("pins the winning path in FFMPEG_PATH so getFFmpegPath() picks it up", async () => {
    const { resolveFFmpegPath, getFFmpegPath } = await import("./ffmpegPath");
    await resolveFFmpegPath();
    expect(process.env.FFMPEG_PATH).toBe("/usr/bin/ffmpeg");
    expect(getFFmpegPath()).toBe("/usr/bin/ffmpeg");
  });

  it("returns the same object reference on repeat calls (cached per process)", async () => {
    const { resolveFFmpegPath } = await import("./ffmpegPath");
    const a = await resolveFFmpegPath();
    const b = await resolveFFmpegPath();
    expect(b).toBe(a);
  });

  it("respects an explicit FFMPEG_PATH and probes it directly", async () => {
    process.env.FFMPEG_PATH = "/usr/bin/ffmpeg";
    const { resolveFFmpegPath } = await import("./ffmpegPath");
    const result = await resolveFFmpegPath();
    expect(result.path).toBe("/usr/bin/ffmpeg");
    expect(result.drawtext).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveFFmpegPath — mocked probe results (edge-case behavior)
// ---------------------------------------------------------------------------

/** Minimal EventEmitter-like object that fires the "close" event with the given code
 *  and optionally emits stdoutContent on the stdout stream (needed for the -filters probe). */
function fakeProc(exitCode: number, stdoutContent = "") {
  return {
    stdout: {
      on: (ev: string, cb: Function) => {
        if (ev === "data" && stdoutContent)
          setTimeout(() => cb(Buffer.from(stdoutContent)), 0);
      },
    },
    on: (ev: string, cb: Function) => {
      if (ev === "close") setTimeout(() => cb(exitCode), 0);
    },
  };
}

describe("resolveFFmpegPath — mocked probe behavior", () => {
  it("reports drawtext:false when an explicit FFMPEG_PATH override fails the probe", async () => {
    vi.doMock("child_process", () => ({
      spawn: vi.fn(() => fakeProc(1)),
    }));
    process.env.FFMPEG_PATH = "/usr/bin/ffmpeg";
    const { resolveFFmpegPath } = await import("./ffmpegPath");
    const result = await resolveFFmpegPath();
    expect(result.path).toBe("/usr/bin/ffmpeg");
    expect(result.drawtext).toBe(false);
    // Override is honored as-is; FFMPEG_PATH stays at the user-specified value.
    expect(process.env.FFMPEG_PATH).toBe("/usr/bin/ffmpeg");
  });

  it("returns drawtext:false and leaves FFMPEG_PATH unset when no candidate passes", async () => {
    vi.doMock("child_process", () => ({
      spawn: vi.fn(() => fakeProc(1)),
    }));
    const { resolveFFmpegPath } = await import("./ffmpegPath");
    const result = await resolveFFmpegPath();
    expect(result.drawtext).toBe(false);
    // Nothing was pinned because no binary passed the probe.
    expect(process.env.FFMPEG_PATH).toBeUndefined();
  });

  it("skips a failing candidate and pins the next one that passes", async () => {
    let callCount = 0;
    vi.doMock("child_process", () => ({
      // First spawn call (bundled static) fails; subsequent calls pass and emit "drawtext".
      spawn: vi.fn(() => {
        const i = callCount++;
        return fakeProc(i === 0 ? 1 : 0, i > 0 ? " drawtext " : "");
      }),
    }));
    const { resolveFFmpegPath } = await import("./ffmpegPath");
    const result = await resolveFFmpegPath();
    expect(result.drawtext).toBe(true);
    // The second candidate that passed should be pinned.
    expect(process.env.FFMPEG_PATH).toBeTruthy();
  });
});

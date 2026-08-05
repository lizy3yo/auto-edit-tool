import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Cap at 1 slot BEFORE videoAssembly's module-level Semaphore is constructed, so the
// "second call still spawns" assertion below actually proves the slot was released
// rather than just finding a spare slot in the default pool.
vi.hoisted(() => {
  process.env.FFMPEG_CONCURRENCY = "1";
});

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("child_process", () => ({ spawn: spawnMock }));
vi.mock("./ffmpegPath", () => ({ getFFmpegPath: () => "/usr/bin/ffmpeg" }));

import {
  runFfmpeg,
  FFMPEG_MAX_MS,
  isTransientFfmpegError,
} from "./videoAssembly";

/** A spawned ffmpeg that never exits — the wedge FFMPEG_MAX_MS exists to break. */
function wedgedProc() {
  const proc = new EventEmitter() as any;
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe("runFfmpeg wall clock + concurrency cap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("SIGKILLs a wedged ffmpeg, and releases its slot so the next call still runs", async () => {
    const first = wedgedProc();
    spawnMock.mockReturnValueOnce(first);

    // Assert before advancing: the rejection must have a handler attached when the timer fires,
    // or vitest reports it as an unhandled rejection.
    const wedged = expect(
      runFfmpeg(["-i", "a.mp4", "out.mp4"])
    ).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(FFMPEG_MAX_MS + 1_000);
    await wedged;
    expect(first.kill).toHaveBeenCalledWith("SIGKILL");

    // Never retried: a 30-min hang retried 3× is 90 minutes.
    expect(
      isTransientFfmpegError(`FFmpeg timed out after ${FFMPEG_MAX_MS}ms`)
    ).toBe(false);

    // The load-bearing half. With one slot and no release on the timeout path, this would
    // block forever — i.e. the new cap would be strictly worse than having no cap at all.
    const second = wedgedProc();
    spawnMock.mockReturnValueOnce(second);
    const next = runFfmpeg(["-i", "b.mp4", "out.mp4"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(spawnMock).toHaveBeenCalledTimes(2);

    second.emit("close", 0);
    await expect(next).resolves.toBeUndefined();
  });
});

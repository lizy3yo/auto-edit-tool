import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";

import { downloadToTemp } from "./videoAssembly";

/**
 * downloadToTemp retries transient download failures (a film is ~2 downloads per scene,
 * so one blip at 183 scenes drops a scene and fails the assembly) but must NOT burn its
 * budget on a permanent 4xx.
 */

const ok = (body: string) =>
  ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  }) as any;

const notOk = (status: number) =>
  ({ ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) }) as any;

let dir: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "dl-test-"));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Run a download to completion, driving the retry backoff on fake timers.
 * The outcome is captured immediately so the timer advance below never sees an
 * unhandled rejection.
 */
async function run(name: string): Promise<string> {
  const settled = downloadToTemp("https://example.test/asset", dir, name).then(
    value => ({ value, err: undefined }),
    (err: unknown) => ({ value: undefined, err })
  );
  await vi.advanceTimersByTimeAsync(10_000);
  const { value, err } = await settled;
  if (err) throw err;
  return value!;
}

describe("downloadToTemp", () => {
  it("does not retry a 404 — the object is gone, more attempts just delay the failure", async () => {
    fetchMock.mockResolvedValue(notOk(404));

    await expect(run("gone.mp4")).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient network error and keeps the recovered bytes", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(ok("scene-bytes"));

    const filePath = await run("clip.mp4");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFileSync(filePath, "utf8")).toBe("scene-bytes");
  });

  it("retries a 5xx up to three attempts, then gives up", async () => {
    fetchMock.mockResolvedValue(notOk(503));

    await expect(run("flaky.mp4")).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("passes an abort signal so a stalled socket cannot park the assembly", async () => {
    fetchMock.mockResolvedValue(ok("x"));

    await run("timed.mp4");

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

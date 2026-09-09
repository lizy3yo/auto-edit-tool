import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import {
  sliceAudioSegments,
  sliceAudioSegmentsBestEffort,
} from "./videoAssembly";
import { getFFmpegPath } from "./ffmpegPath";

/**
 * The master narration is cut back into per-scene tracks by ONE call over every scene that needs
 * repairing — up to a couple of hundred at a time. That made the whole batch hostage to its worst
 * segment: one range ffmpeg refused threw before any buffer was returned, so ZERO scenes were
 * repaired and every one of them fell through to fresh, paid TTS (which then met 69Labs'
 * duplicate guard and wedged the render). The two forms below are the fix and the contract it
 * must not break: strict where every cut is needed, best-effort where the cuts are independent.
 *
 * Real ffmpeg, real mp3 — the failure being tested is ffmpeg rejecting an argument, which a
 * mocked runner would only assert about itself.
 */

let dir: string;
let master: string;
let masterBytes: Buffer;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "slice-test-"));
  master = path.join(dir, "master.mp3");
  const r = spawnSync(getFFmpegPath(), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    "3",
    "-c:a",
    "libmp3lame",
    master,
  ]);
  if (r.status !== 0) throw new Error(`fixture ffmpeg failed: ${r.stderr}`);
  masterBytes = readFileSync(master);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

/** Serve the fixture mp3 to `downloadToTemp` from any URL. */
const serveMaster = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        masterBytes.buffer.slice(
          masterBytes.byteOffset,
          masterBytes.byteOffset + masterBytes.byteLength
        ),
    }))
  );

// `NaN.toFixed(3)` reaches ffmpeg as the literal "-t NaN", which it rejects outright — a
// deterministic stand-in for whatever makes one segment of a real batch unencodable.
const BAD = { startSec: 0, lenSec: NaN };

describe("sliceAudioSegmentsBestEffort", () => {
  it("returns the cuts it could make and null for the one it could not", async () => {
    serveMaster();
    const failures: number[] = [];
    const cuts = await sliceAudioSegmentsBestEffort(
      "https://example.test/master.mp3",
      [{ startSec: 0, lenSec: 1 }, BAD, { startSec: 2, lenSec: 1 }],
      i => failures.push(i)
    );

    expect(cuts).toHaveLength(3);
    expect(cuts[0]?.length).toBeGreaterThan(0);
    expect(cuts[1]).toBeNull();
    expect(cuts[2]?.length).toBeGreaterThan(0);
    // The caller has to know WHICH scene it could not repair — a silent null would be reported
    // as a missing slice with no cause.
    expect(failures).toEqual([1]);
  });

  it("still throws when the master itself cannot be fetched — nothing is repairable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
      }))
    );
    await expect(
      sliceAudioSegmentsBestEffort("https://example.test/gone.mp3", [
        { startSec: 0, lenSec: 1 },
      ])
    ).rejects.toThrow();
  });
});

describe("sliceAudioSegments (strict)", () => {
  it("still fails the whole call on a bad segment", async () => {
    serveMaster();
    await expect(
      sliceAudioSegments("https://example.test/master.mp3", [
        { startSec: 0, lenSec: 1 },
        BAD,
      ])
    ).rejects.toThrow();
  });

  it("cuts every segment when they are all good", async () => {
    serveMaster();
    const cuts = await sliceAudioSegments("https://example.test/master.mp3", [
      { startSec: 0, lenSec: 1 },
      { startSec: 1, lenSec: 1 },
    ]);
    expect(cuts).toHaveLength(2);
    expect(cuts.every(c => c.length > 0)).toBe(true);
  });
});

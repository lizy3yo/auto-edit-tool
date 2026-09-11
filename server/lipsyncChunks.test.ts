import { describe, it, expect, vi } from "vitest";

vi.mock("./videoAssembly", () => ({
  sliceAudioSegments: vi.fn(),
  detectSilencesFromBuffer: vi.fn(),
  downloadToTemp: vi.fn(),
}));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));

import { planLipsyncChunks, scenePauses, MIN_CHUNK_SEC } from "./lipsyncChunks";

const total = (chunks: { lenSec: number }[]) =>
  chunks.reduce((a, c) => a + c.lenSec, 0);

describe("planLipsyncChunks", () => {
  it("leaves a beat within the cap as one piece", () => {
    expect(planLipsyncChunks(12.4, 20)).toEqual([
      { startSec: 0, lenSec: 12.4 },
    ]);
    expect(planLipsyncChunks(20, 20)).toEqual([{ startSec: 0, lenSec: 20 }]);
    expect(planLipsyncChunks(0, 20)).toEqual([]);
  });

  it("cuts a long beat into the fewest pieces, none over the cap, covering it exactly", () => {
    for (const dur of [20.1, 27, 39.9, 40, 41, 75.5]) {
      const chunks = planLipsyncChunks(dur, 20);
      expect(chunks.length).toBe(Math.ceil(dur / 20));
      expect(total(chunks)).toBeCloseTo(dur, 3);
      for (const c of chunks) {
        expect(c.lenSec).toBeLessThanOrEqual(20 + 1e-6);
        expect(c.lenSec).toBeGreaterThanOrEqual(MIN_CHUNK_SEC - 1e-6);
      }
      // Contiguous: each piece starts where the last ended.
      for (let i = 1; i < chunks.length; i++)
        expect(chunks[i].startSec).toBeCloseTo(
          chunks[i - 1].startSec + chunks[i - 1].lenSec,
          3
        );
    }
  });

  it("puts the cut in the pause nearest the even split", () => {
    // 30 s beat, ideal cut at 15; a pause at 13.0-13.6 is nearer than one at 18.0-18.4.
    const chunks = planLipsyncChunks(30, 20, [
      { start: 13.0, end: 13.6 },
      { start: 18.0, end: 18.4 },
    ]);
    expect(chunks).toHaveLength(2);
    // Clamped to the pause's inside edge, off the next word's onset.
    expect(chunks[0].lenSec).toBeCloseTo(13.56, 2);
  });

  it("ignores a pause that would leave a piece over the cap or under the minimum", () => {
    // 30 s: a pause at 24 would leave 24 s in the first piece — over the cap — so the
    // planner falls back to the even split.
    expect(
      planLipsyncChunks(30, 20, [{ start: 24, end: 24.5 }])[0].lenSec
    ).toBe(15);
    // A pause at 0.5 s would make a half-second first piece.
    expect(
      planLipsyncChunks(30, 20, [{ start: 0.4, end: 0.9 }])[0].lenSec
    ).toBe(15);
  });

  it("never lets a late first cut starve the pieces after it", () => {
    // 41 s → 3 pieces. Pauses only late in the beat: the first cut may sit at most where 2
    // more pieces of 20 s still cover the rest (41 - 40 = 1 → clamped up to MIN).
    const chunks = planLipsyncChunks(41, 20, [{ start: 19.5, end: 19.9 }]);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.lenSec).toBeLessThanOrEqual(20 + 1e-6);
    expect(total(chunks)).toBeCloseTo(41, 3);
  });
});

describe("scenePauses", () => {
  it("maps the master's silences into the scene's own time and clips them to its range", async () => {
    const pauses = await scenePauses(
      { index: 4, narrationStartSec: 100, narrationEndSec: 130 },
      [
        { start: 90, end: 101 }, // straddles the start → clipped to 0-1
        { start: 112.5, end: 113.1 },
        { start: 129.8, end: 131 }, // straddles the end → clipped to 29.8-30
        { start: 140, end: 141 }, // outside
      ]
    );
    expect(pauses).toEqual([
      { start: 0, end: 1 },
      { start: 12.5, end: 13.1 },
      { start: 29.8, end: 30 },
    ]);
  });

  it("returns no pauses for a scene with neither a master range nor a file", async () => {
    expect(await scenePauses({ index: 1 }, null)).toEqual([]);
  });
});

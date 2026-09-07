import { describe, it, expect } from "vitest";
import { assignSceneRanges, type BeatGrid } from "./narrationAlignment";
import { longcatSegmentsFor } from "./providers/longcat-lipsync";
import type { SilenceInterval } from "./videoAssembly";

/**
 * The grid is a TIE-BREAK inside the pause snapper, never a new constraint: it may only pick a
 * pause the snapper would already have accepted. So the properties worth pinning are the ones
 * that keep an EDIT safe — a cut that moved somewhere illegal to save GPU would be a bad trade
 * however much it saved.
 */
const scenes = (n: number, hostAll = true) =>
  Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    scriptText: `Sentence number ${i + 1} spoken by the host on camera here now.`,
    hostPresent: hostAll,
  })) as any[];

const gridFor = (hosts: boolean[]): BeatGrid => ({
  segmentsFor: longcatSegmentsFor,
  isHost: i => !!hosts[i],
});

const totalSegments = (ranges: { startSec: number; endSec: number }[]) =>
  ranges.reduce((a, r) => a + longcatSegmentsFor(r.endSec - r.startSec), 0);

/**
 * Boundaries land at 7.0 / 14.0. The NEAREST pause to 7.0 leaves scene 1 at ~7.0s — just past
 * the 6.92s step, so three segments. A pause 0.14s further away keeps it inside two.
 */
const STRADDLING: SilenceInterval[] = [
  { start: 6.98, end: 7.06 },
  { start: 6.84, end: 6.92 },
  { start: 13.98, end: 14.06 },
];

describe("beat-grid snapping", () => {
  it("prefers a legal pause that keeps a host beat inside its segment", () => {
    const withoutGrid = assignSceneRanges(scenes(3), null, 21, STRADDLING, []);
    const withGrid = assignSceneRanges(
      scenes(3),
      null,
      21,
      STRADDLING,
      [],
      gridFor([true, true, true])
    );
    expect(totalSegments(withoutGrid)).toBe(9);
    expect(totalSegments(withGrid)).toBe(8);
    // It moved to the OTHER detected pause, not to an arbitrary cheaper point.
    expect(withGrid[0].endSec).toBeGreaterThanOrEqual(6.84);
    expect(withGrid[0].endSec).toBeLessThanOrEqual(6.92);
  });

  it("only ever lands inside a detected silence", () => {
    const ranges = assignSceneRanges(
      scenes(3),
      null,
      21,
      STRADDLING,
      [],
      gridFor([true, true, true])
    );
    for (let i = 1; i < ranges.length; i++) {
      const cut = ranges[i].startSec;
      expect(
        STRADDLING.some(s => cut >= s.start - 1e-6 && cut <= s.end + 1e-6)
      ).toBe(true);
    }
  });

  it("is a no-op when no grid is supplied", () => {
    expect(
      assignSceneRanges(scenes(3), null, 21, STRADDLING, [], null)
    ).toEqual(assignSceneRanges(scenes(3), null, 21, STRADDLING, []));
  });

  it("leaves b-roll boundaries to the nearest-pause rule", () => {
    // Nothing renders on the host lane, so there is no cost to minimise and every cut must
    // land exactly where it always did.
    expect(
      assignSceneRanges(
        scenes(3, false),
        null,
        21,
        STRADDLING,
        [],
        gridFor([false, false, false])
      )
    ).toEqual(assignSceneRanges(scenes(3, false), null, 21, STRADDLING, []));
  });

  it("keeps ranges contiguous and ordered", () => {
    const ranges = assignSceneRanges(
      scenes(3),
      null,
      21,
      STRADDLING,
      [],
      gridFor([true, true, true])
    );
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].startSec).toBeCloseTo(ranges[i - 1].endSec, 6);
      expect(ranges[i].endSec).toBeGreaterThan(ranges[i].startSec);
    }
  });

  it("never moves a cut further than the snap tolerance allows", () => {
    const withoutGrid = assignSceneRanges(scenes(3), null, 21, STRADDLING, []);
    const withGrid = assignSceneRanges(
      scenes(3),
      null,
      21,
      STRADDLING,
      [],
      gridFor([true, true, true])
    );
    for (let i = 0; i < withGrid.length; i++) {
      expect(
        Math.abs(withGrid[i].startSec - withoutGrid[i].startSec)
      ).toBeLessThanOrEqual(0.75);
    }
  });
});

import { describe, expect, it } from "vitest";
import type { ResolvedCue } from "../cueResolve";
import { judgeFilm } from "./qa";

const FPS = 30;
/** A placed graphic by its frames, with nothing else for the other checks to find. */
const placed = (id: string, template: string, startFrame: number, endFrame: number) =>
  ({ id, template, start: startFrame / FPS, end: endFrame / FPS, startFrame, endFrame, props: { durationSec: (endFrame - startFrame) / FPS }, sync: [], conformed: { start: false, end: false } }) as ResolvedCue;
/** QA over a still film (no cuts, no flashes): only the graphics' own lengths can fail it. */
const judge = (cues: ResolvedCue[]) => {
  const still = new Array(4400).fill(0);
  return judgeFilm({ fps: FPS, cues, filmDiffs: still, reelDiffs: still, rules: [], readability: [] });
};

describe("QA reports a graphic up too short to read (Dale's job 397 stored 'pass' with 1.27 s and 1.40 s)", () => {
  it("Dale's '3 piles', frames 1446-1484 (48.20-49.47 s), fails", () => {
    const qa = judge([placed("three-piles", "BigNumberOverlay", 1446, 1484)]);
    expect(qa.pass).toBe(false);
    expect(qa.lines).toContain("Shorter than 1.5 s: 1");
    expect(qa.failures).toEqual(["up too short to read (under 1.5 s): three-piles (1.27 s)"]);
  });

  it("a title and an approved graphic are reported too: his saved 1.4 s chapter label", () => {
    const qa = judge([placed("chapter-3-ad-fee", "ChapterLabel", 4067, 4109)]);
    expect(qa.failures).toEqual(["up too short to read (under 1.5 s): chapter-3-ad-fee (1.40 s)"]);
  });

  it("1.5 s exactly passes, and so does one frame under it (edges rounded onto the frame grid); two frames under fails", () => {
    expect(judge([placed("exact", "BigNumberOverlay", 1446, 1491)]).pass).toBe(true);
    expect(judge([placed("frame-short", "BigNumberOverlay", 1446, 1490)]).pass).toBe(true);
    expect(judge([placed("two-short", "BigNumberOverlay", 1446, 1489)]).failures).toEqual(["up too short to read (under 1.5 s): two-short (1.43 s)"]);
    const ok = judge([placed("chapter-1-sort", "ChapterLabel", 1234, 1369), placed("smalls-list", "ListWindow", 1591, 1682)]);
    expect(ok.pass).toBe(true);
    expect(ok.lines).toContain("Shorter than 1.5 s: 0");
  });
});

import { describe, it, expect } from "vitest";
import { syncTargetTime, MAX_DRIFT_SEC } from "./LongformScenePreview";

describe("syncTargetTime", () => {
  // Deliberately inside the tolerance rather than exactly on it: `5 + MAX_DRIFT_SEC - 5` is
  // 0.20000000000000018 in binary floating point, so an on-the-boundary assertion tests the
  // FPU, not the sync rule.
  it("leaves the narration alone while it is in step", () => {
    expect(syncTargetTime(5, 5, 30, false)).toBeNull();
    expect(syncTargetTime(5, 5 + MAX_DRIFT_SEC * 0.75, 30, false)).toBeNull();
    expect(syncTargetTime(5, 5 - MAX_DRIFT_SEC * 0.75, 30, false)).toBeNull();
  });

  it("corrects once the two have drifted past the tolerance", () => {
    expect(syncTargetTime(5, 5 + MAX_DRIFT_SEC * 2, 30, false)).toBe(5);
    expect(syncTargetTime(5, 5 - MAX_DRIFT_SEC * 2, 30, false)).toBe(5);
    expect(syncTargetTime(5, 5.5, 30, false)).toBe(5);
    expect(syncTargetTime(5, 4.4, 30, false)).toBe(5);
  });

  it("always corrects on a hard sync, however small the gap", () => {
    expect(syncTargetTime(5, 5, 30, true)).toBe(5);
    expect(syncTargetTime(0, 0, 30, true)).toBe(0);
  });

  // With preload="none" the duration is NaN until metadata arrives, which is the state on the
  // very first play. Treating that as 0 would clamp every pre-load seek to the start of the line.
  it("does not clamp while the duration is still unknown", () => {
    expect(syncTargetTime(7, 0, NaN, true)).toBe(7);
    expect(syncTargetTime(7, 0, Infinity, true)).toBe(7);
  });

  // A scene held to its on-screen floor has picture running past the last word; seeking an audio
  // element past its end pauses it, which desyncs everything after.
  it("clamps to the end of the narration when the picture outruns it", () => {
    expect(syncTargetTime(9, 0, 6.5, true)).toBe(6.5);
  });

  it("ignores a nonsensical video time rather than seeking to it", () => {
    expect(syncTargetTime(NaN, 0, 30, true)).toBeNull();
    expect(syncTargetTime(-1, 0, 30, true)).toBeNull();
  });
});

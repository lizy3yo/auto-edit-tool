import { afterEach, describe, expect, it } from "vitest";
import {
  DETAIL_REDRAWS_PER_VIDEO,
  detailRedrawsPerVideo,
  detailRedrawsTaken,
  takeDetailRedraw,
} from "./detailRedraws";

// The operator turned the picture check's `detail` question on (2026-10-18) only if it does not raise
// what a video costs: a video may spend at most this many redraws on the detail alone.
describe("the detail check's redraws, capped per video", () => {
  afterEach(() => {
    delete process.env.DETAIL_REDRAWS_PER_VIDEO;
  });

  it("three per video by default; the fourth is refused and nothing more is counted", () => {
    expect(DETAIL_REDRAWS_PER_VIDEO).toBe(3);
    expect(detailRedrawsPerVideo()).toBe(3);
    const job = 7101;
    expect([takeDetailRedraw(job), takeDetailRedraw(job), takeDetailRedraw(job)]).toEqual([true, true, true]);
    expect(takeDetailRedraw(job)).toBe(false);
    expect(takeDetailRedraw(job)).toBe(false);
    expect(detailRedrawsTaken(job)).toBe(3);
  });

  it("each video has its own cap — one video's flagged pictures never take another's redraws", () => {
    for (let k = 0; k < 3; k++) takeDetailRedraw(7102);
    expect(takeDetailRedraw(7102)).toBe(false);
    expect(takeDetailRedraw(7103)).toBe(true);
    expect(detailRedrawsTaken(7103)).toBe(1);
    expect(detailRedrawsTaken(7104)).toBe(0);
  });

  it("pictures checked together cannot both take the last redraw", async () => {
    const job = 7105;
    takeDetailRedraw(job);
    takeDetailRedraw(job);
    const answers = await Promise.all(Array.from({ length: 6 }, async () => takeDetailRedraw(job)));
    expect(answers.filter(Boolean)).toHaveLength(1);
    expect(detailRedrawsTaken(job)).toBe(3);
  });

  it("outside a video (a bench, a test) nothing is counted or capped", () => {
    for (let k = 0; k < 10; k++) {
      expect(takeDetailRedraw(null)).toBe(true);
      expect(takeDetailRedraw(undefined)).toBe(true);
    }
  });

  it("DETAIL_REDRAWS_PER_VIDEO moves the cap; 0 means flagged only; nonsense keeps the default", () => {
    process.env.DETAIL_REDRAWS_PER_VIDEO = "0";
    expect(detailRedrawsPerVideo()).toBe(0);
    expect(takeDetailRedraw(7106)).toBe(false);
    expect(detailRedrawsTaken(7106)).toBe(0);
    process.env.DETAIL_REDRAWS_PER_VIDEO = " 5 ";
    expect(detailRedrawsPerVideo()).toBe(5);
    for (const bad of ["", "  ", "-1", "2.5", "lots"]) {
      process.env.DETAIL_REDRAWS_PER_VIDEO = bad;
      expect(detailRedrawsPerVideo()).toBe(3);
    }
  });
});

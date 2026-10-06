import { describe, expect, it } from "vitest";
import {
  BOX_MAX,
  BOX_MIN,
  CORNER_H,
  CORNER_W,
  USUAL_MARK,
  delogoFilter,
  markBox,
  parseCornerMarkVerdict,
} from "./cornerMark";

const W = 1920;
const H = 1080;

describe("reading the corner check's answer", () => {
  it("takes a mark with its position and size", () => {
    expect(
      parseCornerMarkVerdict(
        '{"mark":true,"cx":76,"cy":60,"size":13,"what":"white four-point sparkle"}'
      )
    ).toEqual({
      mark: true,
      cx: 0.76,
      cy: 0.6,
      size: 0.13,
      what: "white four-point sparkle",
    });
  });

  it("reads anything else as no mark — a clean clip is never patched on a bad answer", () => {
    expect(parseCornerMarkVerdict('{"mark":false,"what":""}').mark).toBe(false);
    expect(parseCornerMarkVerdict("I think there may be one").mark).toBe(false);
    expect(parseCornerMarkVerdict('{"mark":"yes"}').mark).toBe(false);
    expect(parseCornerMarkVerdict("").mark).toBe(false);
  });

  it("keeps the mark but drops a position it cannot use", () => {
    const v = parseCornerMarkVerdict('{"mark":true,"cx":140,"cy":"low","what":"logo"}');
    expect(v.mark).toBe(true);
    expect(v.cx).toBeUndefined();
    expect(v.cy).toBeUndefined();
  });
});

describe("the patch that is rebuilt", () => {
  // The clip this was built for: the sparkle sat about (1791, 944) and was ~70 px wide.
  const seen = {
    cx: (1791 - W * (1 - CORNER_W)) / (W * CORNER_W),
    cy: (944 - H * (1 - CORNER_H)) / (H * CORNER_H),
    size: 70 / (W * CORNER_W),
  };

  it("covers the whole mark with clean pixels round it", () => {
    const b = markBox(W, H, seen);
    expect(b.x).toBeLessThan(1791 - 35);
    expect(b.y).toBeLessThan(944 - 35);
    expect(b.x + b.w).toBeGreaterThan(1791 + 35);
    expect(b.y + b.h).toBeGreaterThan(944 + 35);
  });

  it("stays a small patch, never a slab of the picture", () => {
    const huge = markBox(W, H, { cx: 0.5, cy: 0.5, size: 0.9 });
    expect(huge.w).toBeLessThanOrEqual(Math.ceil(BOX_MAX * W) + 1);
    const tiny = markBox(W, H, { cx: 0.5, cy: 0.5, size: 0.01 });
    expect(tiny.w).toBeGreaterThanOrEqual(Math.floor(BOX_MIN * W) - 1);
  });

  it("never touches the frame's edge, which delogo refuses", () => {
    const b = markBox(W, H, { cx: 1, cy: 1, size: 0.3 });
    expect(b.x).toBeGreaterThanOrEqual(1);
    expect(b.y).toBeGreaterThanOrEqual(1);
    expect(b.x + b.w).toBeLessThanOrEqual(W - 1);
    expect(b.y + b.h).toBeLessThanOrEqual(H - 1);
  });

  it("falls back to where the mark usually sits when the check gave no position", () => {
    const b = markBox(W, H, {});
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    expect(Math.abs(cx - USUAL_MARK.cx * W)).toBeLessThan(3);
    expect(Math.abs(cy - USUAL_MARK.cy * H)).toBeLessThan(3);
  });

  it("the second, wider pass covers both where it was seen and where it usually sits", () => {
    const off = markBox(W, H, { cx: 0.2, cy: 0.2, size: 0.1 });
    const wide = markBox(W, H, { cx: 0.2, cy: 0.2, size: 0.1 }, true);
    expect(wide.x).toBeLessThanOrEqual(off.x);
    expect(wide.y).toBeLessThanOrEqual(off.y);
    expect(wide.x + wide.w).toBeGreaterThanOrEqual(USUAL_MARK.cx * W + 30);
    expect(wide.y + wide.h).toBeGreaterThanOrEqual(USUAL_MARK.cy * H + 30);
  });

  it("scales with the frame — a 720p clip gets a 720p patch", () => {
    const b = markBox(1280, 720, seen);
    expect(b.x + b.w).toBeLessThanOrEqual(1279);
    expect(b.w).toBeLessThanOrEqual(Math.ceil(BOX_MAX * 1280) + 1);
  });

  it("writes the filter ffmpeg is given", () => {
    expect(delogoFilter({ x: 1730, y: 884, w: 120, h: 120 })).toBe(
      "delogo=x=1730:y=884:w=120:h=120"
    );
  });
});

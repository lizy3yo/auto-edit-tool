import { describe, expect, it } from "vitest";
import {
  BOX_MAX,
  BOX_MIN,
  CORNER_H,
  CORNER_W,
  STAR_SURE,
  isSparkle,
  USUAL_MARK,
  bestStar,
  boxAround,
  delogoFilter,
  markBox,
  markStartSec,
  parseCornerMarkVerdict,
  starScoreAt,
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
      onFirst: false,
      cx: 0.76,
      cy: 0.6,
      size: 0.13,
      what: "white four-point sparkle",
    });
  });

  it("notes a mark that is on the first frame too — it is there for the whole clip", () => {
    expect(
      parseCornerMarkVerdict('{"mark":true,"on_first":true,"what":"logo"}').onFirst
    ).toBe(true);
    expect(
      parseCornerMarkVerdict('{"mark":true,"on_first":false,"what":"logo"}').onFirst
    ).toBe(false);
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

describe("finding the sparkle by its shape", () => {
  const SIZE = 160;
  /** A dim, gently uneven background — a bench in shadow. */
  const scene = () => {
    const g = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        g[y * SIZE + x] = 40 + 10 * Math.sin(x / 9) + 8 * Math.cos(y / 7);
    return g;
  };
  /** A pale, partly see-through four-pointed star of radius `r` centred at (cx, cy). */
  const stamp = (g: Float32Array, cx: number, cy: number, r: number) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const dx = Math.abs(x - cx) / r;
        const dy = Math.abs(y - cy) / r;
        if (Math.sqrt(dx) + Math.sqrt(dy) <= 1) g[y * SIZE + x] += 45;
      }
    return g;
  };

  it("finds a pale star and says exactly where it is", () => {
    const b = bestStar(stamp(scene(), 96, 70, 22), SIZE, SIZE);
    expect(b.score).toBeGreaterThanOrEqual(STAR_SURE);
    expect(isSparkle(b)).toBe(true);
    expect(Math.abs(b.x - 96)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.y - 70)).toBeLessThanOrEqual(2);
    expect(b.r).toBeGreaterThanOrEqual(20);
    expect(b.r).toBeLessThanOrEqual(24);
  });

  it("does not call a softly uneven scene a sparkle", () => {
    // Its bumps are soft blobs: they match the star's plump rival as well as the star.
    expect(isSparkle(bestStar(scene(), SIZE, SIZE))).toBe(false);
  });

  it("does not call a bright square, a round light or a soft glow a sparkle", () => {
    const square = scene();
    for (let y = 50; y < 94; y++)
      for (let x = 70; x < 114; x++) square[y * SIZE + x] += 45;
    expect(isSparkle(bestStar(square, SIZE, SIZE))).toBe(false);
    const disc = scene();
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        if ((x - 92) ** 2 + (y - 72) ** 2 <= 22 * 22) disc[y * SIZE + x] += 45;
    expect(isSparkle(bestStar(disc, SIZE, SIZE))).toBe(false);
    const glow = scene();
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        glow[y * SIZE + x] +=
          60 * Math.exp(-((x - 92) ** 2 + (y - 72) ** 2) / (2 * 14 * 14));
    expect(isSparkle(bestStar(glow, SIZE, SIZE))).toBe(false);
  });

  it("skips a flat image instead of dividing noise into a perfect match", () => {
    expect(bestStar(new Float32Array(SIZE * SIZE).fill(30), SIZE, SIZE).score).toBe(-1);
  });

  it("cuts a measured mark's patch close, so what sits beside it is not dragged in", () => {
    const at = { cx: 0.933, cy: 0.874, w: 0.05 };
    const close = boxAround(W, H, at, false, 1.25);
    const loose = boxAround(W, H, at);
    expect(close.w).toBeLessThan(loose.w);
    expect(close.y + close.h).toBeLessThan(H * 0.94);
  });
});

describe("a see-through mark over a busy background", () => {
  // The first real clip's faintest marked frame, still fading in: 0.71, under the sure mark.
  const faint = { score: 0.71, rival: 0.31 };

  it("is the mark when it sits exactly where the mark always sits", () => {
    expect(isSparkle({ ...faint, cx: 0.932, cy: 0.869 })).toBe(true);
  });

  it("is not the mark anywhere else in the corner — a clean frame's best match is elsewhere", () => {
    // What a clean frame of that same clip reads: 0.69, a little below and left of the spot.
    expect(isSparkle({ score: 0.69, rival: 0.51, cx: 0.922, cy: 0.909 })).toBe(false);
    expect(isSparkle({ ...faint, cx: 0.878, cy: 0.928 })).toBe(false);
    expect(isSparkle(faint)).toBe(false);
  });

  it("is not the mark when it is more blob than star, even at the usual spot", () => {
    expect(isSparkle({ score: 0.7, rival: 0.72, cx: 0.932, cy: 0.869 })).toBe(false);
  });

  it("is the mark anywhere in the corner when the match is strong", () => {
    // The real clip's last frame, and a clip carrying the mark throughout: 0.86 against 0.40.
    expect(isSparkle({ score: 0.86, rival: 0.4, cx: 0.8, cy: 0.75 })).toBe(true);
  });
});

describe("a mark that only comes in at the end of the clip", () => {
  const fps = 25;
  // A 2.93 s clip, as the provider sent it: 73 frames, the sparkle fading in over the last three.
  const tail = [...Array(70).fill(0.1), 0.2, 0.4, 0.55];

  it("is rebuilt from just before it appears, not over the whole clip", () => {
    const from = markStartSec(tail, fps, 2.93);
    // First shown on frame 71 (2.85 s); the patch starts a little earlier for its faintest frames.
    expect(from).toBeGreaterThan(2.4);
    expect(from).toBeLessThan(2.85);
  });

  it("treats a flat frame as not showing it", () => {
    expect(markStartSec([null, null, 0.6], fps, 0.12)).toBe(0);
    expect(markStartSec([...Array(50).fill(null), 0.6], fps, 2.04)).toBeGreaterThan(1.6);
  });

  it("is the whole clip when it was there before the stretch that was looked at", () => {
    // The last 4 s of a 30 s clip, the mark on every frame of it.
    expect(markStartSec(Array(100).fill(0.7), fps, 30)).toBe(0);
  });

  it("is the whole clip when nothing can be told", () => {
    expect(markStartSec([], fps, 3)).toBe(0);
    expect(markStartSec([0.1, 0.1], fps, 3)).toBe(0);
    expect(markStartSec([0.6], 0, 3)).toBe(0);
  });

  it("writes a filter that only runs from that moment", () => {
    const box = { x: 1730, y: 884, w: 120, h: 120 };
    expect(delogoFilter(box, 2.55)).toBe(
      "delogo=x=1730:y=884:w=120:h=120:enable='gte(t,2.550)'"
    );
    expect(delogoFilter(box, 0)).toBe("delogo=x=1730:y=884:w=120:h=120");
  });

  it("measures one known spot, for following the mark back through the frames", () => {
    const SIZE = 120;
    const g = new Float32Array(SIZE * SIZE).fill(40);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        g[y * SIZE + x] += 6 * Math.sin(x / 5);
        const dx = Math.abs(x - 60) / 20;
        const dy = Math.abs(y - 60) / 20;
        if (Math.sqrt(dx) + Math.sqrt(dy) <= 1) g[y * SIZE + x] += 50;
      }
    expect(starScoreAt(g, SIZE, SIZE, 60, 60, 20)).toBeGreaterThan(0.8);
    // Off the image: nothing to measure.
    expect(starScoreAt(g, SIZE, SIZE, 5, 5, 20)).toBeNull();
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

import { describe, expect, it } from "vitest";
import {
  ALREADY_FRAMED,
  MIN_RATIO,
  correlate,
  cut,
  faceAgrees,
  framingCrop,
  framingFilter,
  locateFace,
  resample,
  type Gray,
} from "./hostFraming";

/** A picture with enough texture to match on: a "room" of bands with a "head" drawn at (cx, cy). */
function picture(
  width: number,
  height: number,
  head: { cx: number; cy: number; r: number }
): Gray {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = 90 + 30 * Math.sin(x / 23) + 20 * Math.cos(y / 17);
      const dx = (x - head.cx) / head.r;
      const dy = (y - head.cy) / head.r;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 1) {
        // A face: a bright oval with two dark eyes and a dark mouth, so it has a way up.
        v = 190 - 40 * d;
        if (Math.hypot(dx + 0.35, dy + 0.25) < 0.16) v = 40;
        if (Math.hypot(dx - 0.35, dy + 0.25) < 0.16) v = 40;
        if (Math.abs(dy - 0.45) < 0.08 && Math.abs(dx) < 0.4) v = 60;
      }
      data[y * width + x] = v;
    }
  return { data, width, height };
}

const W = 480;
const H = 270;

describe("finding the photo's face in a clip", () => {
  const photo = picture(W, H, { cx: 240, cy: 110, r: 60 });
  const face = { x: 240, y: 110, size: 110 };

  it("reads a host drawn at three-quarters the size, and where the face is", () => {
    // The clip: the same face, smaller and a little lower, as a redraw from a step back gives.
    const clip = picture(W, H, { cx: 244, cy: 96, r: 45 });
    const m = locateFace(clip, photo, face);
    expect(m.ratio).toBeGreaterThan(0.7);
    expect(m.ratio).toBeLessThan(0.8);
    expect(Math.abs(m.x - 244 / W)).toBeLessThan(0.02);
    expect(Math.abs(m.y - 96 / H)).toBeLessThan(0.03);
    expect(m.score).toBeGreaterThan(0.6);
  });

  it("reads a clip already framed like the photo as the same size", () => {
    const m = locateFace(photo, photo, face);
    expect(m.ratio).toBeGreaterThanOrEqual(ALREADY_FRAMED);
    expect(m.score).toBeGreaterThan(0.95);
  });

  it("never reads the host as smaller than the limit", () => {
    const tiny = picture(W, H, { cx: 240, cy: 110, r: 18 });
    expect(locateFace(tiny, photo, face).ratio).toBeGreaterThanOrEqual(
      MIN_RATIO - 0.03
    );
  });
});

describe("the face finder's second opinion", () => {
  const match = { ratio: 0.71, x: 0.5, y: 0.36 };

  it("agrees when it reads the same size in the same place", () => {
    expect(faceAgrees(match, { ratio: 0.74, x: 0.51, y: 0.38 })).toBe(true);
  });

  it("disagrees on a different size or a different place", () => {
    expect(faceAgrees(match, { ratio: 1.0, x: 0.5, y: 0.36 })).toBe(false);
    expect(faceAgrees(match, { ratio: 0.71, x: 0.8, y: 0.36 })).toBe(false);
    expect(faceAgrees(match, { ratio: 0.71, x: 0.5, y: 0.6 })).toBe(false);
  });
});

describe("the part of the clip that is kept", () => {
  const FW = 1920;
  const FH = 1080;
  // The real clip: the host 71% of the photo's size, face a little above the middle.
  const match = { ratio: 0.71, x: 0.5, y: 0.36 };
  const inPhoto = { x: 0.5, y: 0.42 };

  it("is the frame's own shape, sized so the host becomes the photo's size", () => {
    const c = framingCrop(FW, FH, match, inPhoto)!;
    expect(c.w / c.h).toBeCloseTo(FW / FH, 2);
    expect(c.w).toBeCloseTo(FW * 0.71, -1);
  });

  it("puts the face where it sits in the photo", () => {
    const c = framingCrop(FW, FH, match, inPhoto)!;
    expect((match.x * FW - c.x) / c.w).toBeCloseTo(inPhoto.x, 1);
    expect((match.y * FH - c.y) / c.h).toBeCloseTo(inPhoto.y, 1);
  });

  it("cuts the wide frame's lower-right corner off, where the stamped mark sat", () => {
    const c = framingCrop(FW, FH, match, inPhoto)!;
    expect(c.x + c.w).toBeLessThan(0.933 * FW);
    expect(c.y + c.h).toBeLessThan(0.874 * FH);
  });

  it("stays inside the frame and on even pixels, whatever the face's place", () => {
    for (const m of [
      { ratio: 0.7, x: 0.05, y: 0.05 },
      { ratio: 0.7, x: 0.95, y: 0.95 },
      { ratio: 0.63, x: 0.5, y: 0.1 },
    ]) {
      const c = framingCrop(FW, FH, m, inPhoto)!;
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(FW);
      expect(c.y + c.h).toBeLessThanOrEqual(FH);
      for (const v of [c.x, c.y, c.w, c.h]) expect(v % 2).toBe(0);
    }
  });

  it("is nothing at all for a clip already framed like its photo", () => {
    expect(framingCrop(FW, FH, { ratio: 1, x: 0.5, y: 0.42 }, inPhoto)).toBeNull();
    expect(
      framingCrop(FW, FH, { ratio: ALREADY_FRAMED, x: 0.5, y: 0.42 }, inPhoto)
    ).toBeNull();
  });

  it("writes the filter ffmpeg is given: crop, enlarge back, sharpen", () => {
    expect(framingFilter({ x: 278, y: 0, w: 1362, h: 766 }, FW, FH)).toBe(
      "crop=1362:766:278:0,scale=1920:1080:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,setsar=1"
    );
  });
});

describe("the picture arithmetic underneath", () => {
  it("resamples by averaging, keeping a flat picture flat", () => {
    const flat: Gray = { data: new Float32Array(40 * 30).fill(77), width: 40, height: 30 };
    const small = resample(flat, 13, 9);
    expect(small.width).toBe(13);
    expect(Array.from(small.data).every(v => Math.abs(v - 77) < 1e-3)).toBe(true);
  });

  it("matches a cut-out exactly where it was cut from, and nowhere near as well elsewhere", () => {
    const p = picture(W, H, { cx: 240, cy: 110, r: 60 });
    const piece = cut(p, 180, 50, 120, 120);
    expect(correlate(p, piece, 180, 50)).toBeCloseTo(1, 5);
    expect(correlate(p, piece, 40, 120)).toBeLessThan(0.6);
  });

  it("gives no match on a flat patch rather than dividing by nothing", () => {
    const flat: Gray = { data: new Float32Array(50 * 50).fill(10), width: 50, height: 50 };
    const piece = cut(picture(W, H, { cx: 240, cy: 110, r: 60 }), 200, 70, 20, 20);
    expect(correlate(flat, piece, 5, 5)).toBe(-1);
  });
});

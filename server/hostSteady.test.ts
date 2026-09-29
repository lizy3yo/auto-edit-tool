import { describe, it, expect } from "vitest";
import { hostArea, solidHost, knotExpr, needsSteadying, steadyFilter, trackPose, type CameraPose } from "./hostSteady";

const still = (n: number): CameraPose[] => Array.from({ length: n }, () => ({ s: 1, dx: 0, dy: 0 }));

describe("host steadying", () => {
  it("leaves a still camera alone and corrects a breathing one", () => {
    expect(needsSteadying(still(50))).toBe(false);
    // Ruth's job 182: ~1% zoom in and out every few seconds.
    const breathing = still(100).map((p, i) => ({ ...p, s: 1 + 0.005 * Math.sin(i / 8) }));
    expect(needsSteadying(breathing)).toBe(true);
    const sliding = still(100).map((p, i) => ({ ...p, dx: i / 20 }));
    expect(needsSteadying(sliding)).toBe(true);
  });

  it("builds a piecewise-linear curve that hits every knot", () => {
    const expr = knotExpr([
      { at: 0, v: 1 },
      { at: 5, v: 2 },
      { at: 10, v: 0 },
    ]);
    const at = (n: number) =>
      // eslint-disable-next-line no-new-func
      Function(
        "gte", "lt", "lte", "gt", "n",
        `return ${expr.replace(/\bin\b/g, "n")};`
      )(
        (a: number, b: number) => +(a >= b),
        (a: number, b: number) => +(a < b),
        (a: number, b: number) => +(a <= b),
        (a: number, b: number) => +(a > b),
        n
      );
    expect(at(0)).toBeCloseTo(1);
    expect(at(2.5)).toBeCloseTo(1.5);
    expect(at(5)).toBeCloseTo(2);
    expect(at(10)).toBeCloseTo(0);
    expect(at(12)).toBeCloseTo(0);
  });

  it("zooms in just enough that no frame shows an edge, and never adds motion of its own", () => {
    const f = steadyFilter(still(30), 1920, 1080);
    expect(f).toContain("perspective=");
    expect(f).toContain("sense=source");
    expect(f).not.toMatch(/zoompan|rotate/);
  });

  it("finds a known zoom between two frames", () => {
    const W = 480, H = 270;
    const f0 = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f0[y * W + x] = ((x >> 3) + (y >> 3)) % 2 ? 200 : 40;
    // frame k = frame 0 zoomed out by 1% about the centre: f_k(q) = f_0((q - c)/0.99 + c)
    const s = 0.99;
    const fk = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const sx = Math.round((x - W / 2) / s + W / 2);
        const sy = Math.round((y - H / 2) / s + H / 2);
        fk[y * W + x] = sx >= 0 && sy >= 0 && sx < W && sy < H ? f0[sy * W + sx] : 0;
      }
    const p = trackPose(f0, fk, { s: 1, dx: 0, dy: 0 });
    expect(p.s).toBeCloseTo(s, 2);
  });
});

describe("freezing the room", () => {
  const W = 480, H = 270;
  it("finds the host's body and ignores a room edge that only flickers", () => {
    // Ruth, job 206: shelf lines flicker by a pixel under HeyGen's redraw; grown by the margin
    // they covered her whole room and the freeze was skipped.
    const frames = Array.from({ length: 30 }, (_, k) => {
      const f = new Uint8Array(W * H).fill(100);
      // The host: a body-sized block whose texture changes every frame.
      for (let y = 80; y < H; y++) for (let x = 170; x < 310; x++) f[y * W + x] = (x + y + k * 7) % 2 ? 180 : 60;
      // A one-pixel shelf line at x = 40 that flickers.
      for (let y = 20; y < 200; y++) f[y * W + 40] = k % 2 ? 160 : 100;
      return f;
    });
    const area = hostArea(frames)!;
    expect(area).not.toBeNull();
    expect(area[150 * W + 240]).toBe(1); // the body
    expect(area[150 * W + 165]).toBe(1); // the margin around it
    expect(area[100 * W + 40]).toBe(0); // the shelf line stays frozen room
    expect(area[20 * W + 400]).toBe(0); // the far room
  });

  it("does not freeze around a host who fills the frame", () => {
    const frames = Array.from({ length: 10 }, (_, k) => new Uint8Array(W * H).map((_, i) => (i + k * 3) % 2 ? 200 : 40));
    expect(hostArea(frames)).toBeNull();
  });
});

describe("the host is a solid shape — a plain shirt is never frozen (2026-09-30)", () => {
  const W = 480, H = 270;
  // A seated host in a plain dark tee: only the OUTLINE changes frame to frame (shoulders, arms,
  // collar); the flat middle of the shirt reads the same in every frame, like the real clip where
  // 68% of the shirt was frozen while the arms moved around it.
  const frames = Array.from({ length: 30 }, (_, k) => {
    const f = new Uint8Array(W * H).fill(120); // the room
    for (let y = 90; y < H; y++)
      for (let x = 130; x < 350; x++) {
        const edge = x < 142 || x >= 338 || y < 102;
        f[y * W + x] = edge ? ((x + y + k * 5) % 2 ? 200 : 30) : 40; // moving outline, still chest
      }
    return f;
  });

  it("keeps the whole body live, the chest included", () => {
    const area = hostArea(frames)!;
    expect(area).not.toBeNull();
    expect(area[200 * W + 240]).toBe(1); // the middle of the chest
    expect(area[150 * W + 300]).toBe(1);
    expect(area[20 * W + 40]).toBe(0); // the room is still frozen
    expect(area[200 * W + 440]).toBe(0);
  });

  it("fills a still pocket that is open only at the bottom, never the room around the body", () => {
    const w = 10, h = 6;
    // An outline shaped like shoulders and arms: the middle columns are still, open at the bottom.
    const m = new Uint8Array(w * h);
    for (let y = 1; y < h; y++) { m[y * w + 2] = 1; m[y * w + 7] = 1; }
    for (let x = 2; x <= 7; x++) m[1 * w + x] = 1;
    const solid = solidHost(m, w, h);
    expect(solid[4 * w + 4]).toBe(1); // inside the body
    expect(solid[4 * w + 0]).toBe(0); // the room beside it
    expect(solid[0 * w + 4]).toBe(0); // the room above it
  });
});

import { describe, expect, it } from "vitest";
import { MIN_WHITE, findSubject, measureContrast } from "./legibility";

const W = 200, H = 100;
/** A film frame of one grey level, with an optional bright rectangle. */
function film(level: number, bright?: { x0: number; y0: number; x1: number; y1: number }): Uint8Array {
  const f = new Uint8Array(W * H * 3).fill(level);
  if (bright) for (let y = bright.y0; y <= bright.y1; y++) for (let x = bright.x0; x <= bright.x1; x++) f.set([250, 250, 250], (y * W + x) * 3);
  return f;
}
/** A graphic frame: white "letters" (a bar) on a translucent dark scrim of `scrim` alpha. */
function graphic(scrim: number, colour = [255, 255, 255]): Uint8Array {
  const g = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) g.set([5, 10, 18, Math.round(scrim * 255)], i * 4);
  for (let y = 40; y < 60; y++) for (let x = 40; x < 160; x++) g.set([...colour, 255], (y * W + x) * 4);
  return g;
}

describe("readability on the real picture", () => {
  it("white text over a dark picture passes", () => {
    const c = measureContrast(graphic(0.3), film(30), W, H);
    expect(c.white!).toBeGreaterThan(MIN_WHITE);
    expect(c.pass).toBe(true);
  });

  it("a letter's own soft edges are part of the letter, not the background behind it", () => {
    const g = graphic(0.3);
    // Anti-aliased rim: white at partial opacity around the letters, as a real renderer draws them.
    for (let y = 37; y < 63; y++) for (let x = 37; x < 163; x++) if (y < 40 || y >= 60 || x < 40 || x >= 160) g.set([255, 255, 255, 120], (y * W + x) * 4);
    const c = measureContrast(g, film(30), W, H);
    expect(c.white!).toBeGreaterThan(MIN_WHITE);
  });

  it("a label's accent edge against the picture outside its plate is not reading", () => {
    // A dark plate (x 30-170) on a white picture, white letters inside, an accent bar on its left edge.
    const g = new Uint8Array(W * H * 4);
    for (let y = 30; y < 70; y++) for (let x = 30; x < 170; x++) g.set([12, 16, 22, 235], (y * W + x) * 4);
    for (let y = 30; y < 70; y++) for (let x = 30; x < 36; x++) g.set([124, 166, 245, 255], (y * W + x) * 4);
    for (let y = 45; y < 55; y++) for (let x = 60; x < 150; x++) g.set([255, 255, 255, 255], (y * W + x) * 4);
    const c = measureContrast(g, film(250), W, H);
    expect(c.white!).toBeGreaterThan(MIN_WHITE);
    expect(c.pass).toBe(true);
  });

  it("white text over a white box fails when the scrim is light, and passes when it is dark", () => {
    const light = measureContrast(graphic(0.45), film(250), W, H);
    expect(light.pass).toBe(false);
    const dark = measureContrast(graphic(0.9), film(250), W, H);
    expect(dark.pass).toBe(true);
  });

  it("is only as readable as the brightest patch behind the words", () => {
    const patch = measureContrast(graphic(0.45), film(30, { x0: 30, y0: 30, x1: 70, y1: 70 }), W, H);
    expect(patch.pass).toBe(false);
  });

  it("holds coloured words to their own minimum", () => {
    const c = measureContrast(graphic(0.5, [124, 166, 245]), film(30), W, H);
    expect(c.white).toBeUndefined();
    expect(c.colour).toBeDefined();
  });

  it("an icon beside the words is not what they are read against", () => {
    // Dark plate on a white picture, white letters, and an opaque grey-blue icon right next to them.
    const g = new Uint8Array(W * H * 4);
    for (let y = 30; y < 70; y++) for (let x = 10; x < 190; x++) g.set([12, 16, 22, 235], (y * W + x) * 4);
    for (let y = 38; y < 62; y++) for (let x = 20; x < 44; x++) g.set([80, 108, 121, 250], (y * W + x) * 4);
    for (let y = 45; y < 55; y++) for (let x = 48; x < 180; x++) g.set([255, 255, 255, 255], (y * W + x) * 4);
    expect(measureContrast(g, film(250), W, H, [[124, 166, 245]]).pass).toBe(true);
  });

  it("an emoji is not text: only the theme's own text colours are judged", () => {
    const g = graphic(0.3, [255, 200, 40]); // a yellow icon-like block, not an ink
    const c = measureContrast(g, film(250), W, H, [[124, 166, 245]]);
    expect(c.white).toBeUndefined();
    expect(c.colour).toBeUndefined();
    expect(c.pass).toBe(true);
  });

  it("no text on screen passes", () => {
    const g = new Uint8Array(W * H * 4);
    expect(measureContrast(g, film(250), W, H).pass).toBe(true);
  });
});

describe("the picture's subject", () => {
  it("is where the detail is", () => {
    const f = film(120);
    // A checkerboard object in the right half.
    for (let y = 30; y < 70; y++) for (let x = 130; x < 180; x++) if (((x >> 2) + (y >> 2)) % 2) f.set([250, 250, 250], (y * W + x) * 3);
    const s = findSubject(f, W, H);
    expect(s.x).toBeGreaterThan(120);
    expect(s.box.x0).toBeGreaterThan(90);
  });
});

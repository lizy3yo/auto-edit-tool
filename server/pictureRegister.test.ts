import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { registerCopy, registerFrames, resample, type Gray } from "./pictureRegister";

const W = 960;
const H = 540;

/** A stand-in for a host photo: a head and shoulders on a wall with a few things on it. */
function scene(opts: { dx?: number; dy?: number; scale?: number; gain?: number } = {}): Promise<Buffer> {
  const { dx = 0, dy = 0, scale = 1, gain = 1 } = opts;
  const cx = W / 2 + dx * W;
  const cy = H / 2 + dy * H;
  const p = (x: number, y: number) => `${cx + (x - W / 2) * scale},${cy + (y - H / 2) * scale}`;
  const shade = (v: number) => {
    const g = Math.round(Math.min(255, v * gain));
    return `rgb(${g},${g},${g})`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${shade(150)}"/>
    <polygon points="${p(60, 60)} ${p(300, 60)} ${p(300, 200)} ${p(60, 200)}" fill="${shade(90)}"/>
    <polygon points="${p(700, 90)} ${p(900, 90)} ${p(900, 330)} ${p(700, 330)}" fill="${shade(200)}"/>
    <polygon points="${p(250, 540)} ${p(330, 380)} ${p(630, 380)} ${p(710, 540)}" fill="${shade(40)}"/>
    <ellipse cx="${cx}" cy="${cy - 60 * scale}" rx="${95 * scale}" ry="${125 * scale}" fill="${shade(215)}"/>
    <ellipse cx="${cx - 35 * scale}" cy="${cy - 85 * scale}" rx="${12 * scale}" ry="${8 * scale}" fill="${shade(30)}"/>
    <ellipse cx="${cx + 35 * scale}" cy="${cy - 85 * scale}" rx="${12 * scale}" ry="${8 * scale}" fill="${shade(30)}"/>
    <ellipse cx="${cx}" cy="${cy - 5 * scale}" rx="${30 * scale}" ry="${9 * scale}" fill="${shade(110)}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Where the registration puts the middle of the copy, against the middle of the frame. */
const centre = (r: { scale: number; left: number; top: number }) => ({
  dx: r.left + r.scale / 2 - 0.5,
  dy: r.top + r.scale / 2 - 0.5,
});

describe("laying a copy over its photo", () => {
  it("reads the same picture as exactly in place", async () => {
    const a = await scene();
    const r = await registerCopy(a, a);
    expect(r.scale).toBeCloseTo(1, 3);
    expect(centre(r).dx).toBeCloseTo(0, 2);
    expect(centre(r).dy).toBeCloseTo(0, 2);
    expect(r.score).toBeGreaterThan(0.99);
  });

  it("finds a host drawn bigger, and the resize that puts them back", async () => {
    const r = await registerCopy(await scene(), await scene({ scale: 1.05 }));
    // Drawn 5% bigger ⇒ shrink the copy to 1/1.05.
    expect(r.scale).toBeCloseTo(1 / 1.05, 2);
    expect(Math.abs(centre(r).dx)).toBeLessThan(0.006);
    expect(Math.abs(centre(r).dy)).toBeLessThan(0.006);
    expect(r.score).toBeGreaterThan(0.95);
  });

  it("finds a host drawn smaller", async () => {
    const r = await registerCopy(await scene(), await scene({ scale: 0.96 }));
    expect(r.scale).toBeCloseTo(1 / 0.96, 2);
  });

  it("finds a host who moved, and the shift that puts them back", async () => {
    // Drawn 3% to the right and 2% down ⇒ move the copy 3% left and 2% up.
    const r = await registerCopy(await scene(), await scene({ dx: 0.03, dy: 0.02 }));
    expect(r.scale).toBeCloseTo(1, 2);
    expect(centre(r).dx).toBeCloseTo(-0.03, 2);
    expect(centre(r).dy).toBeCloseTo(-0.02, 2);
  });

  it("is not thrown by the light: a darker, flatter copy lines up the same", async () => {
    const r = await registerCopy(await scene(), await scene({ scale: 1.03, dx: 0.01, gain: 0.6 }));
    expect(r.scale).toBeCloseTo(1 / 1.03, 2);
    expect(centre(r).dx).toBeCloseTo(-0.01, 2);
    expect(r.score).toBeGreaterThan(0.95);
  });

  it("scores a different picture low", async () => {
    const noise = Buffer.alloc(W * H * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (Math.imul(i, 2654435761) >>> 24) & 255;
    const other = await sharp(noise, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    expect((await registerCopy(await scene(), other)).score).toBeLessThan(0.4);
  });
});

describe("the resize the search uses", () => {
  const ramp: Gray = {
    width: 8,
    height: 2,
    data: Float32Array.from([0, 10, 20, 30, 40, 50, 60, 70, 0, 10, 20, 30, 40, 50, 60, 70]),
  };
  it("keeps the frame as it is at scale 1", () => {
    expect(Array.from(resample(ramp, 1).data)).toEqual(Array.from(ramp.data));
  });
  it("doubles the frame and keeps the ramp a ramp", () => {
    const big = resample(ramp, 2);
    expect(big.width).toBe(16);
    expect(big.height).toBe(4);
    for (let x = 1; x < 16; x++) expect(big.data[x]).toBeGreaterThanOrEqual(big.data[x - 1]);
  });
  it("registers two flat frames as unrelated rather than dividing by zero", () => {
    const flat: Gray = { width: 40, height: 24, data: new Float32Array(40 * 24).fill(100) };
    const r = registerFrames({ original: flat, copy: flat }, { original: flat, copy: flat });
    expect(r.score).toBe(0);
  });
});

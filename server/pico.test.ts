import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import sharp from "sharp";
import {
  loadFaceCascade,
  clusterDetections,
  detectFaces,
  PICO_DEFAULTS,
} from "./pico";

/** Grayscale pixels of an image file, downscaled the way `faceAlign` does it. */
async function grayOf(file: string, width = 640) {
  const { data, info } = await sharp(file)
    .resize({ width, withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

describe("loadFaceCascade", () => {
  // The shipped `facefinder` is 468 trees of depth 6; the decoder asserts it consumed exactly
  // the file, so a truncated or swapped asset fails here rather than returning garbage scores.
  it("decodes the bundled facefinder cascade", () => {
    const c = loadFaceCascade();
    expect(c.tdepth).toBe(6);
    expect(c.ntrees).toBe(468);
    expect(typeof c.classify).toBe("function");
  });
});

describe("clusterDetections", () => {
  it("merges overlapping windows into one box with summed score", () => {
    const out = clusterDetections(
      [
        [100, 100, 50, 2],
        [102, 101, 52, 3],
        [98, 99, 48, 1],
      ],
      0.2
    );
    expect(out).toHaveLength(1);
    expect(out[0].q).toBe(6);
    expect(out[0].x).toBeCloseTo(100, 10);
    expect(out[0].y).toBeCloseTo(100, 10);
  });

  it("keeps far-apart windows separate", () => {
    const out = clusterDetections(
      [
        [100, 100, 50, 2],
        [400, 400, 50, 3],
      ],
      0.2
    );
    expect(out).toHaveLength(2);
  });

  it("is empty for no detections", () => {
    expect(clusterDetections([], 0.2)).toEqual([]);
  });
});

describe("detectFaces", () => {
  // No face ⇒ no detection. A false positive here would pan a split panel onto a shelf.
  it("finds nothing in a flat image", () => {
    const w = 320,
      h = 180;
    expect(detectFaces(new Uint8Array(w * h).fill(128), w, h)).toEqual([]);
  });

  it("finds nothing in the bundled (face-free) cover reference", async () => {
    const file = fileURLToPath(
      new URL("./assets/cover-style-reference.png", import.meta.url)
    );
    const g = await grayOf(file);
    const faces = detectFaces(g.pixels, g.width, g.height);
    expect(faces).toEqual([]);
  });

  // Real-face check, opt-in: point FACE_IMAGE_PATH at any frontal portrait and (optionally)
  // FACE_X_FRAC at the face's known horizontal centre as a 0..1 fraction to assert position.
  const facePath = process.env.FACE_IMAGE_PATH;
  const hasFace = !!facePath && existsSync(facePath);
  it.skipIf(!hasFace)("finds the face in FACE_IMAGE_PATH", async () => {
    const g = await grayOf(facePath!);
    const faces = detectFaces(g.pixels, g.width, g.height);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces[0].q).toBeGreaterThanOrEqual(PICO_DEFAULTS.minQ);
    const expected = Number(process.env.FACE_X_FRAC);
    if (Number.isFinite(expected)) {
      expect(faces[0].x / g.width).toBeCloseTo(expected, 1);
    }
  });
});

/**
 * server/pico.ts
 *
 * A frontal-face detector with no model download, no native build and no network: the pico
 * ("Pixel Intensity Comparison-based Object detection") runtime, vendored from
 * https://github.com/nenadmarkus/pico (MIT) and typed, plus its `facefinder` cascade shipped in
 * `server/assets/` (copied to `dist/assets/` by the build, like the fonts).
 *
 * Why this and not a vision LLM: `faceAlign.ts` used to ask Claude Haiku for the face's x as a
 * fraction of frame width, and a language model is a coarse, 0.5-biased ruler — a host at 0.58
 * reads as "centred" and the split-screen crop leaves them against the divider. A cascade
 * returns a pixel box, the same one every time, in ~50 ms per frame on the CPU.
 *
 * How it works, in one paragraph: the cascade is an ensemble of `ntrees` decision trees of depth
 * `tdepth`. Each internal node compares two pixels at positions relative to the candidate
 * window's centre and scale (`tcodes`, fixed-point int8 offsets), each leaf adds a vote
 * (`tpreds`), and every tree has an early-exit `thresh` — most background windows die within a
 * handful of trees, which is what makes a dense multi-scale scan cheap. Windows that survive all
 * trees are detections with score `q`; overlapping ones are averaged into clusters.
 *
 * Resolution-independent: it scans a window from `minSize` to `maxSize` pixels in `scaleFactor`
 * steps, so a tight headshot, a waist-up plate and a small host in a wide room are all found.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

/** One detected face: centre + side of a square box, in the pixels it was given. */
export interface FaceBox {
  /** Centre x, px. */
  x: number;
  /** Centre y, px. */
  y: number;
  /** Box side, px. */
  size: number;
  /** Detection score — summed over the clustered windows; higher is more confident. */
  q: number;
}

/** Classifier closure: score of the window centred at (row, col) with side `scale`. */
type ClassifyRegion = (
  r: number,
  c: number,
  s: number,
  pixels: Uint8Array,
  ldim: number
) => number;

/**
 * Decode the cascade binary into a classifier. Layout (little-endian): 8 header bytes, int32
 * tree depth, int32 tree count, then per tree `(2^depth - 1) * 4` int8 pixel-pair codes,
 * `2^depth` float32 leaf predictions and one float32 threshold. Pure — unit-tested against the
 * shipped cascade's known dimensions.
 */
export function unpackCascade(bytes: Uint8Array): {
  classify: ClassifyRegion;
  tdepth: number;
  ntrees: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  const tdepth = view.getInt32(p, true);
  p += 4;
  const ntrees = view.getInt32(p, true);
  p += 4;
  const pow2 = 1 << tdepth;
  // Each tree's codes are prefixed with 4 zero bytes so node indices can start at 1.
  const tcodes = new Int8Array(ntrees * 4 * pow2);
  const tpreds = new Float32Array(ntrees * pow2);
  const thresh = new Float32Array(ntrees);
  for (let t = 0; t < ntrees; t++) {
    const codeBytes = 4 * pow2 - 4;
    tcodes.set(
      new Int8Array(bytes.buffer, bytes.byteOffset + p, codeBytes),
      t * 4 * pow2 + 4
    );
    p += codeBytes;
    for (let i = 0; i < pow2; i++) {
      tpreds[t * pow2 + i] = view.getFloat32(p, true);
      p += 4;
    }
    thresh[t] = view.getFloat32(p, true);
    p += 4;
  }
  if (p !== bytes.byteLength) {
    throw new Error(
      `pico cascade: expected ${p} bytes for depth ${tdepth} × ${ntrees} trees, got ${bytes.byteLength}`
    );
  }

  const classify: ClassifyRegion = (r, c, s, pixels, ldim) => {
    r = 256 * r;
    c = 256 * c;
    let root = 0;
    let o = 0.0;
    for (let i = 0; i < ntrees; i++) {
      let idx = 1;
      for (let j = 0; j < tdepth; j++) {
        const a =
          pixels[
            ((r + tcodes[root + 4 * idx + 0] * s) >> 8) * ldim +
              ((c + tcodes[root + 4 * idx + 1] * s) >> 8)
          ];
        const b =
          pixels[
            ((r + tcodes[root + 4 * idx + 2] * s) >> 8) * ldim +
              ((c + tcodes[root + 4 * idx + 3] * s) >> 8)
          ];
        idx = 2 * idx + (a <= b ? 1 : 0);
      }
      o += tpreds[pow2 * i + idx - pow2];
      if (o <= thresh[i]) return -1;
      root += 4 * pow2;
    }
    return o - thresh[ntrees - 1];
  };
  return { classify, tdepth, ntrees };
}

/** Dense multi-scale scan. Returns raw, un-clustered [row, col, scale, q] windows with q > 0. */
export function runCascade(
  classify: ClassifyRegion,
  pixels: Uint8Array,
  ncols: number,
  nrows: number,
  params: {
    shiftFactor: number;
    minSize: number;
    maxSize: number;
    scaleFactor: number;
  }
): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  let scale = params.minSize;
  while (scale <= params.maxSize) {
    const step = Math.max(params.shiftFactor * scale, 1) >> 0;
    const offset = (scale / 2 + 1) >> 0;
    for (let r = offset; r <= nrows - offset; r += step) {
      for (let c = offset; c <= ncols - offset; c += step) {
        const q = classify(r, c, scale, pixels, ncols);
        if (q > 0.0) out.push([r, c, scale, q]);
      }
    }
    scale *= params.scaleFactor;
  }
  return out;
}

/**
 * Merge overlapping windows (IoU above `iouThreshold`) into one box each, averaging position
 * and size and SUMMING score — a real face is hit by many neighbouring windows and scales, a
 * false positive by one or two, so the summed `q` separates them. Pure — unit-tested.
 */
export function clusterDetections(
  dets: Array<[number, number, number, number]>,
  iouThreshold: number
): FaceBox[] {
  const sorted = [...dets].sort((a, b) => b[3] - a[3]);
  const iou = (
    d1: [number, number, number, number],
    d2: [number, number, number, number]
  ) => {
    const [r1, c1, s1] = d1;
    const [r2, c2, s2] = d2;
    const overR = Math.max(
      0,
      Math.min(r1 + s1 / 2, r2 + s2 / 2) - Math.max(r1 - s1 / 2, r2 - s2 / 2)
    );
    const overC = Math.max(
      0,
      Math.min(c1 + s1 / 2, c2 + s2 / 2) - Math.max(c1 - s1 / 2, c2 - s2 / 2)
    );
    return (overR * overC) / (s1 * s1 + s2 * s2 - overR * overC);
  };
  const assigned = new Array<boolean>(sorted.length).fill(false);
  const clusters: FaceBox[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (assigned[i]) continue;
    let r = 0,
      c = 0,
      s = 0,
      q = 0,
      n = 0;
    for (let j = i; j < sorted.length; j++) {
      if (!assigned[j] && iou(sorted[i], sorted[j]) > iouThreshold) {
        assigned[j] = true;
        r += sorted[j][0];
        c += sorted[j][1];
        s += sorted[j][2];
        q += sorted[j][3];
        n += 1;
      }
    }
    clusters.push({ x: c / n, y: r / n, size: s / n, q });
  }
  return clusters;
}

let cascadePromise: ReturnType<typeof unpackCascade> | null = null;

/** The shipped `facefinder` cascade, decoded once per process. Throws if the asset is missing. */
export function loadFaceCascade(): ReturnType<typeof unpackCascade> {
  if (!cascadePromise) {
    // server/assets/facefinder in dev, dist/assets/facefinder in prod (the build copies it).
    const file = fileURLToPath(new URL("./assets/facefinder", import.meta.url));
    const bytes = readFileSync(file);
    cascadePromise = unpackCascade(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    );
  }
  return cascadePromise;
}

/**
 * Detection thresholds. `minQ` is the clustered score a face must reach: the upstream C
 * implementation defaults to 5.0 for single images, and the webcam demo uses 50 only because it
 * accumulates five frames. `minSize` is a fraction of the shorter image side so the scan adapts
 * to whatever resolution it is handed.
 */
export const PICO_DEFAULTS = {
  minQ: 5.0,
  shiftFactor: 0.1,
  scaleFactor: 1.1,
  minSizeFrac: 0.06,
  iou: 0.2,
};

/**
 * Every face in an 8-bit grayscale image (`pixels.length === width*height`, row-major), best
 * first. Synchronous and CPU-only; ~50 ms for a 640-wide frame.
 */
export function detectFaces(
  pixels: Uint8Array,
  width: number,
  height: number,
  opts: Partial<typeof PICO_DEFAULTS> = {}
): FaceBox[] {
  const p = { ...PICO_DEFAULTS, ...opts };
  const { classify } = loadFaceCascade();
  const minSize = Math.max(
    20,
    Math.round(Math.min(width, height) * p.minSizeFrac)
  );
  const raw = runCascade(classify, pixels, width, height, {
    shiftFactor: p.shiftFactor,
    scaleFactor: p.scaleFactor,
    minSize,
    maxSize: Math.min(width, height),
  });
  return clusterDetections(raw, p.iou)
    .filter(d => d.q >= p.minQ)
    .sort((a, b) => b.q - a.q);
}

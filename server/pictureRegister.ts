/**
 * server/pictureRegister.ts — where one picture sits against another of the same scene.
 *
 * A host photo's phone look (server/hostPhoneLook.ts) must keep the host exactly where the photo
 * puts them, and the image model drifts by a few percent, so every copy is measured against its
 * original and moved back. This is the measurement.
 *
 * NOT A FACE DETECTOR. The first build found the face in both pictures (`pico.ts`) and moved the
 * copy's box onto the original's. That detector says WHERE a face is, not how big: on one photo
 * it returned a box of 371, 406 or 419 px depending only on the size it was scanned at, read a
 * copy that visibly matched as "22% bigger", and could not find a bearded host in glasses in his
 * own copy at all — so two good copies were refused, twice each (Brenda and Dale, 2026-10-11).
 *
 * A copy is the SAME picture re-recorded, so the two can be laid over each other: the copy is
 * tried at every size from 85% to 115% and every nearby position, and where the middle of the
 * frame (the host) matches the original best is how far it drifted. Matching runs on small
 * blurred greyscale frames with the brightness and contrast taken out, so the light, colour and
 * detail the recipe changes on purpose do not matter — only where the big shapes are.
 */
import sharp from "sharp";

/** A greyscale frame, row-major. */
export interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

export interface Registration {
  /** The factor to resize the copy by so it matches the original. */
  scale: number;
  /** Where the resized copy's top-left then sits, as a fraction of the frame's width / height. */
  left: number;
  top: number;
  /** How well they match there: 1 = the same picture, 0 = unrelated. */
  score: number;
}

/** How far the search looks: a copy further out than this is a different framing, not a drift. */
export const REGISTER_SCALE_REACH = 0.15;
export const REGISTER_SHIFT_REACH = 0.1;

/** `g` resized by `scale` (bilinear), as its own frame. Pure. */
export function resample(g: Gray, scale: number): Gray {
  const width = Math.max(2, Math.round(g.width * scale));
  const height = Math.max(2, Math.round(g.height * scale));
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(g.height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(g.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(g.width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(g.width - 1, x0 + 1);
      const fx = sx - x0;
      const top = g.data[y0 * g.width + x0] * (1 - fx) + g.data[y0 * g.width + x1] * fx;
      const bottom = g.data[y1 * g.width + x0] * (1 - fx) + g.data[y1 * g.width + x1] * fx;
      data[y * width + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return { data, width, height };
}

/**
 * How alike the middle of `original` (where the host is) and `copy` are with the copy's top-left
 * at (tx, ty): zero-mean normalised correlation, so a darker or flatter copy scores the same as a
 * bright one. The copy's edge is repeated where the window runs off it.
 */
function matchAt(original: Gray, copy: Gray, tx: number, ty: number): number {
  const x0 = Math.round(original.width * 0.22);
  const x1 = Math.round(original.width * 0.78);
  const y0 = Math.round(original.height * 0.12);
  const y1 = Math.round(original.height * 0.88);
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = y0; y < y1; y++) {
    const row = Math.min(copy.height - 1, Math.max(0, y - ty)) * copy.width;
    for (let x = x0; x < x1; x++) {
      const a = original.data[y * original.width + x];
      const b = copy.data[row + Math.min(copy.width - 1, Math.max(0, x - tx))];
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
  }
  const n = (x1 - x0) * (y1 - y0);
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? (sab - (sa * sb) / n) / Math.sqrt(va * vb) : 0;
}

/** The best match of `copy` to `original` over these sizes and the positions round `centre`. */
function search(
  original: Gray,
  copy: Gray,
  scales: number[],
  centre: (scale: number) => { tx: number; ty: number },
  reach: { x: number; y: number }
) {
  let best = { scale: 1, tx: 0, ty: 0, score: -Infinity };
  for (const scale of scales) {
    const resized = resample(copy, scale);
    const c = centre(scale);
    for (let ty = c.ty - reach.y; ty <= c.ty + reach.y; ty++) {
      for (let tx = c.tx - reach.x; tx <= c.tx + reach.x; tx++) {
        const score = matchAt(original, resized, tx, ty);
        if (score > best.score) best = { scale, tx, ty, score };
      }
    }
  }
  return best;
}

const steps = (from: number, to: number, step: number): number[] =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

/**
 * Where and how big the copy is against the original. `coarse` and `fine` are the same two
 * pictures at a small and a larger size: the small pair finds the neighbourhood cheaply, the
 * larger one settles it to about a quarter of a percent. Pure.
 */
export function registerFrames(
  coarse: { original: Gray; copy: Gray },
  fine: { original: Gray; copy: Gray }
): Registration {
  const a = coarse.original;
  const rough = search(
    a,
    coarse.copy,
    steps(1 - REGISTER_SCALE_REACH, 1 + REGISTER_SCALE_REACH, 0.0125),
    // A copy that only changed size stays centred: start each size from there.
    s => ({ tx: Math.round((a.width * (1 - s)) / 2), ty: Math.round((a.height * (1 - s)) / 2) }),
    {
      x: Math.round(a.width * REGISTER_SHIFT_REACH),
      y: Math.round(a.height * REGISTER_SHIFT_REACH),
    }
  );
  const b = fine.original;
  const k = b.width / a.width;
  // Where the rough answer puts the copy's CENTRE, which stays put as the size is refined.
  const cx = (rough.tx + (a.width * rough.scale) / 2) * k;
  const cy = (rough.ty + (a.height * rough.scale) / 2) * k;
  const exact = search(
    b,
    fine.copy,
    steps(rough.scale - 0.0125, rough.scale + 0.0125, 0.0025),
    s => ({ tx: Math.round(cx - (b.width * s) / 2), ty: Math.round(cy - (b.height * s) / 2) }),
    { x: Math.ceil(k) + 1, y: Math.ceil(k) + 1 }
  );
  return {
    scale: exact.scale,
    left: exact.tx / b.width,
    top: exact.ty / b.height,
    score: exact.score,
  };
}

const COARSE_WIDTH = 160;
const FINE_WIDTH = 480;

/** A picture as a small, blurred greyscale frame: the big shapes, none of the finish. */
async function grayFrame(image: Buffer, width: number): Promise<Gray> {
  const { data, info } = await sharp(image)
    .resize({ width })
    .grayscale()
    .blur(1.2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: Float32Array.from(data), width: info.width, height: info.height };
}

/** Where and how big `copy` is against `original` — two pictures of the same shape. */
export async function registerCopy(original: Buffer, copy: Buffer): Promise<Registration> {
  const [ca, cb, fa, fb] = await Promise.all([
    grayFrame(original, COARSE_WIDTH),
    grayFrame(copy, COARSE_WIDTH),
    grayFrame(original, FINE_WIDTH),
    grayFrame(copy, FINE_WIDTH),
  ]);
  return registerFrames({ original: ca, copy: cb }, { original: fa, copy: fb });
}

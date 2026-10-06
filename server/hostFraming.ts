/**
 * A host clip brought back to the framing of the photo it was made from — "Clean host clips" only.
 *
 * Until 2026-10-05 a video's host was lip-synced from a "phone look" COPY of each library photo:
 * the same person and room, redrawn by an image model from a step further back. Videos made then
 * show the host SMALLER than in the photo the operator uploaded (more table, the apron's bib),
 * and the redrawn copy is where a stamped corner mark came from. Photos are used as uploaded
 * now, so new videos have neither — but the older ones keep the clips they were rendered with.
 *
 * The redraw is not a plain zoom-out: measured on a real clip the ROOM sits where it does in the
 * photo while the PERSON is three-quarters the size. So the clip is matched to the photo by the
 * HOST'S FACE — how big it is and where it sits — and cropped until the face is the photo's size
 * in the photo's place. The host is framed as uploaded again, and the lower-right of the wide
 * frame, mark included, is simply out of the picture. Nothing is redrawn and nothing is erased.
 *
 * Deliberately not run on clips as they arrive: it is a repair for a video the operator picks,
 * and a clip already framed like its photo comes back as the SAME buffer.
 *
 * Never throws: no face, no confident match, or any failure, keeps the clip as it was.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { execFfmpeg } from "./ffmpegSpawn";
import { detectFaces } from "./pico";

/** A grey image: one byte or float a pixel, row by row. */
export interface Gray {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** A face in a picture: its centre and its box side, in that picture's pixels. */
export interface Face {
  x: number;
  y: number;
  size: number;
}

/** How the host in a clip's frame compares with the host in a photo. */
export interface FaceMatch {
  /** Host size in the frame ÷ host size in the photo. 1 = the same; 0.75 = drawn smaller. */
  ratio: number;
  /** The face's centre in the frame, as shares of its width and height. */
  x: number;
  y: number;
  /** How well the photo's face matches the frame there, -1..1. */
  score: number;
}

/** Width both pictures are compared at. */
const WORK_W = 480;
/** The face is matched with this much of the head round it, as a multiple of the face box. */
const HEAD_REACH = 1.5;
/** The host may be this much smaller in the clip than in the photo, and no smaller. */
export const MIN_RATIO = 0.62;
/** ...or a little larger, which is read as "already framed". */
const MAX_RATIO = 1.08;
/** At or above this the face is the photo's face on the match alone. */
export const MATCH_SURE = 0.62;
/** ...and at or above this when the face finder, reading the clip itself, agrees (`faceAgrees`). */
export const MATCH_WITH_FACE = 0.42;

/**
 * Does the face finder's own reading of the clip — the face's size against the photo's, and
 * where it sits — agree with the match? Sizes within a fifth, centres within a tenth of the
 * frame. Pure.
 */
export function faceAgrees(
  match: Pick<FaceMatch, "ratio" | "x" | "y">,
  seen: { ratio: number; x: number; y: number }
): boolean {
  return (
    Math.abs(seen.ratio / match.ratio - 1) <= 0.2 &&
    Math.abs(seen.x - match.x) <= 0.1 &&
    Math.abs(seen.y - match.y) <= 0.1
  );
}
/** A host within this of the photo's size already IS framed like the photo: nothing to zoom. */
export const ALREADY_FRAMED = 0.96;

/** `g` resampled to `width × height` by area averaging. Pure. */
export function resample(g: Gray, width: number, height: number): Gray {
  const out = new Float32Array(width * height);
  const sx = g.width / width;
  const sy = g.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(g.height, Math.round((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(g.width, Math.round((x + 1) * sx)));
      let sum = 0;
      for (let j = y0; j < y1; j++)
        for (let i = x0; i < x1; i++) sum += g.data[j * g.width + i];
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { data: out, width, height };
}

/** The `w × h` part of `g` whose top-left is (x, y). Pure. */
export function cut(g: Gray, x: number, y: number, w: number, h: number): Gray {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) out[j * w + i] = g.data[(y + j) * g.width + x + i];
  return { data: out, width: w, height: h };
}

/** Normalised correlation of `t` with the same-sized window of `f` at (x, y), -1..1. Pure. */
export function correlate(f: Gray, t: Gray, x: number, y: number): number {
  const n = t.width * t.height;
  let sf = 0;
  let st = 0;
  let sff = 0;
  let stt = 0;
  let sft = 0;
  for (let j = 0; j < t.height; j++) {
    const fr = (y + j) * f.width + x;
    const tr = j * t.width;
    for (let i = 0; i < t.width; i++) {
      const a = f.data[fr + i];
      const b = t.data[tr + i];
      sf += a;
      st += b;
      sff += a * a;
      stt += b * b;
      sft += a * b;
    }
  }
  const vf = sff - (sf * sf) / n;
  const vt = stt - (st * st) / n;
  if (vf <= 0 || vt <= 0) return -1;
  return (sft - (sf * st) / n) / Math.sqrt(vf * vt);
}

/**
 * Find the photo's face in the frame: the head round `face` is cut out of the photo and searched
 * for in the frame at every size from `MIN_RATIO` of its own up to a little over, and at every
 * position. Both pictures must be the same width (`WORK_W`), so one pixel means the same share
 * of each. Pure.
 */
export function locateFace(frame: Gray, photo: Gray, face: Face): FaceMatch {
  const half = Math.round((face.size * HEAD_REACH) / 2);
  const x0 = Math.max(0, Math.round(face.x) - half);
  const y0 = Math.max(0, Math.round(face.y) - half);
  const x1 = Math.min(photo.width, Math.round(face.x) + half);
  const y1 = Math.min(photo.height, Math.round(face.y) + half);
  const head = cut(photo, x0, y0, x1 - x0, y1 - y0);
  // Where the face's centre sits inside the cut-out, so a match gives the face, not a corner.
  const inX = (face.x - x0) / head.width;
  const inY = (face.y - y0) / head.height;

  /** Every size in `ratios` at every position (or only near `near`), on pictures shrunk by `by`. */
  const scan = (by: number, ratios: number[], near?: FaceMatch): FaceMatch => {
    const f =
      by === 1
        ? frame
        : resample(frame, Math.round(frame.width / by), Math.round(frame.height / by));
    let best: FaceMatch = { ratio: 1, x: 0.5, y: 0.5, score: -1 };
    for (const ratio of ratios) {
      const tw = Math.round((head.width * ratio) / by);
      const th = Math.round((head.height * ratio) / by);
      if (tw < 8 || th < 8 || tw > f.width || th > f.height) continue;
      const t = resample(head, tw, th);
      const reach = 3;
      const nx = near ? Math.round(near.x * f.width - inX * tw) : 0;
      const ny = near ? Math.round(near.y * f.height - inY * th) : 0;
      const xa = near ? Math.max(0, nx - reach) : 0;
      const xb = near ? Math.min(f.width - tw, nx + reach) : f.width - tw;
      const ya = near ? Math.max(0, ny - reach) : 0;
      const yb = near ? Math.min(f.height - th, ny + reach) : f.height - th;
      for (let y = ya; y <= yb; y++)
        for (let x = xa; x <= xb; x++) {
          const score = correlate(f, t, x, y);
          if (score > best.score)
            best = {
              ratio,
              x: (x + inX * tw) / f.width,
              y: (y + inY * th) / f.height,
              score,
            };
        }
    }
    return best;
  };

  // A quick pass over everything at a third of the size, then an exact one round the winner:
  // the full-size search alone took nine seconds a photo, and a video has dozens of host clips.
  const all: number[] = [];
  for (let r = MIN_RATIO; r <= MAX_RATIO + 1e-6; r += 0.03) all.push(r);
  const rough = scan(3, all);
  const close: number[] = [];
  for (let r = rough.ratio - 0.03; r <= rough.ratio + 0.0301; r += 0.01)
    if (r >= MIN_RATIO - 0.02 && r <= MAX_RATIO + 0.02) close.push(r);
  return scan(1, close, rough);
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The part of a `frameW × frameH` clip to keep so the host is framed as in the photo: a box
 * `ratio` of the frame's size (enlarged back, that makes the host the photo's size), placed so
 * the face lands where it sits in the photo — `inPhoto`, its centre as shares of the photo —
 * then nudged to stay inside the frame, on even pixels. Null when the host is already the
 * photo's size. Pure.
 */
export function framingCrop(
  frameW: number,
  frameH: number,
  match: Pick<FaceMatch, "ratio" | "x" | "y">,
  inPhoto: { x: number; y: number }
): Crop | null {
  if (match.ratio >= ALREADY_FRAMED) return null;
  const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2);
  const w = even(frameW * match.ratio);
  const h = even(frameH * match.ratio);
  const x = match.x * frameW - inPhoto.x * w;
  const y = match.y * frameH - inPhoto.y * h;
  const clamp = (v: number, max: number) =>
    Math.floor(Math.min(max, Math.max(0, Math.round(v))) / 2) * 2;
  return { x: clamp(x, frameW - w), y: clamp(y, frameH - h), w, h };
}

/** Enlarged back to the frame's size, with the sharpening an upscaled host clip gets. Pure. */
export const framingFilter = (
  crop: Crop,
  frameW: number,
  frameH: number
): string =>
  `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` +
  `scale=${frameW}:${frameH}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,setsar=1`;

/** A picture as a grey image `WORK_W` wide, with the bytes the face finder reads. */
async function grayOf(
  input: Buffer
): Promise<Gray & { bytes: Uint8Array }> {
  const { data, info } = await sharp(input)
    .resize({ width: WORK_W })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bytes = new Uint8Array(info.width * info.height);
  for (let i = 0; i < bytes.length; i++) bytes[i] = data[i * info.channels];
  return { data: bytes, bytes, width: info.width, height: info.height };
}

/**
 * The clip framed like whichever of `photos` it was made from, or the SAME buffer when it
 * already is, when no photo's face can be found in it with confidence, or on any failure.
 * `label` names the clip in the log.
 */
export async function matchPhotoFraming(
  clip: Buffer,
  photos: Buffer[],
  label = "host clip"
): Promise<Buffer> {
  if (process.env.HOST_MATCH_PHOTO === "0" || photos.length === 0) return clip;
  const dir = await mkdtemp(path.join(tmpdir(), "host-framing-"));
  try {
    const src = path.join(dir, "in.mp4");
    await writeFile(src, clip);
    const still = path.join(dir, "first.png");
    await execFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-frames:v", "1", still],
      { maxBuffer: 1 << 26 }
    );
    const png = await readFile(still);
    const meta = await sharp(png).metadata();
    if (!meta.width || !meta.height) throw new Error("frame has no size");
    const frame = await grayOf(png);
    let best:
      | (FaceMatch & { inPhoto: { x: number; y: number }; faceSize: number })
      | null = null;
    for (const photo of photos) {
      const g = await grayOf(photo).catch(() => null);
      if (!g) continue;
      const face = detectFaces(g.bytes, g.width, g.height)[0];
      if (!face) continue;
      const m = locateFace(frame, g, face);
      if (!best || m.score > best.score)
        best = {
          ...m,
          inPhoto: { x: face.x / g.width, y: face.y / g.height },
          faceSize: face.size,
        };
    }
    // A second opinion on the frame itself: the face finder's own reading of where the face is
    // and how big. The copy the clip was made from is a REDRAW of the photo, so the face is the
    // same person but not the same pixels, and the match alone reads only ~0.56 on a true pair.
    const seen = detectFaces(frame.bytes, frame.width, frame.height)[0];
    const agrees =
      !!best &&
      !!seen &&
      faceAgrees(best, {
        ratio: seen.size / best.faceSize,
        x: seen.x / frame.width,
        y: seen.y / frame.height,
      });
    if (!best || !(best.score >= MATCH_SURE || (agrees && best.score >= MATCH_WITH_FACE))) {
      console.log(
        `[HostFraming] ${label}: no host photo's face matched ` +
          `(best ${best ? best.score.toFixed(2) : "none"}${seen ? "" : ", no face found in the clip"}) — left as it is`
      );
      return clip;
    }
    const crop = framingCrop(meta.width, meta.height, best, best.inPhoto);
    if (!crop) return clip;
    const out = path.join(dir, "out.mp4");
    await execFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf",
        framingFilter(crop, meta.width, meta.height),
        "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", out],
      { maxBuffer: 1 << 26 }
    );
    console.log(
      `[HostFraming] ${label}: framed like its photo — face match ${best.score.toFixed(2)}, ` +
        `host was ${Math.round(best.ratio * 100)}% of the photo's size, zoomed ${(meta.width / crop.w).toFixed(2)}×`
    );
    return await readFile(out);
  } catch (err: any) {
    console.warn(
      `[HostFraming] ${label}: kept as it was — ${err?.message ?? err}`
    );
    return clip;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

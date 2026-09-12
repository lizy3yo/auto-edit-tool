/**
 * server/ltxFraming.ts — decide, per host photo, whether the LTX lane should render a crop
 * around the face and paste it back, and exactly which crop.
 *
 * Why this exists: LTX articulates the mouth at its working resolution (stage 1 renders at
 * 960x544 and the picture is upscaled from there), so the face's SIZE in the frame decides
 * whether there is a mouth to animate at all. Measured on 2026-09-12 with the lip-sync judge:
 * a host whose face is 39% of the photo's height (Granny Mae, a medium close-up) tracks the
 * words at r 0.3-0.5 with lips meeting; a host at 24% (the workshop wide shot) rendered a
 * mouth that did not move — motion 1.15 against 5-8, articulation at the floor — because at
 * that size the mouth is ~8 px tall, inside a single 32 px latent cell. No wording fixes
 * that: the words that woke his mouth ("articulates every word clearly") made hers shout.
 *
 * So a photo whose face is too small gets a 16:9 window cut around the face at the
 * proportion that is known to work, the window is rendered, and the worker pastes the clip
 * back into the still photo at full size with a feathered edge — the camera is locked by
 * construction, the face gets ~1.6x the pixels, and one mouth direction fits every host.
 *
 * Every decision here is deliberate about the photos it will meet — wide shots, close-ups,
 * portrait phone photos, a face at the edge, two faces, none — and is recorded on the scene
 * (`scene.ltxFraming`) and logged, so what it did to a given photo is never a guess.
 * `planLtxCrop` is pure arithmetic and unit-tested; `analyzeHostPhoto` is the detector.
 */
import sharp from "sharp";
import { detectFaces } from "./pico";
import { presignOwnBucketUrl } from "./storage";
import { invokeClaude, type ClaudeImage } from "./claude";
import type { LtxFraming, LtxCrop, LtxFace } from "../shared/types";

/** Face height as a fraction of the crop's height that is known to articulate (Granny Mae). */
export const TARGET_FACE_FRAC = 0.38;
/** A photo whose face is already at least this much of its height is left alone. */
export const SKIP_ABOVE_FACE_FRAC = 0.33;
/** A 16:9 window shorter than this would be UPSCALED by the model: trade a smaller face for it. */
export const MIN_CROP_H = 544;
/** The film's aspect; the crop is always this shape so the model never stretches it. */
export const ASPECT = 16 / 9;
/**
 * A photo shorter than this cannot supply a window worth rendering: the crop would be a
 * thumbnail the model upscales into mush (a 160x160 channel avatar produced a 160x90 window
 * with the face at 80% of it). Such a photo is rendered as is — and is a photo to replace.
 */
export const MIN_PHOTO_H = 360;
/** Photos within this of 16:9 count as 16:9 (a 1376x768 export is 1.79). */
const ASPECT_TOLERANCE = 0.05;
/** Where the eye line sits in the window: the upper third, the standard headroom rule. */
const EYE_LINE_FRAC = 1 / 3;
/** Eyes sit about this far above the detector's box centre, in box sizes. */
const EYES_ABOVE_CENTRE = 0.1;
/**
 * Below this pico confidence a "face" is noise. 8, not 20: a clear frontal portrait (channel
 * 6's) scored 20.8 at one scan width and 14.7 at another, and a bar of 20 missed it outright
 * — which on this lane means a dead mouth, silently. Spurious boxes at 8-12 do occur; the
 * multi-scale scan below keeps the strongest one, and the planner records whatever it chose.
 */
const MIN_FACE_Q = 8;
/**
 * Widths the photo is scanned at. pico's cascade is scale-sensitive: the same portrait read
 * q 20.8 at 640 and nothing at 960, so two scans and the best box beat one scan and a prayer.
 */
const SCAN_WIDTHS = [640, 1280];
/** The LLM fallback, for a photo the cascade cannot read at any scale. */
const FACE_BOX_MODEL = "claude-haiku-4-5-20251001";
const FACE_BOX_SYSTEM =
  "You are given ONE photo of a person who will present a video. Locate the main person's " +
  "FACE and report its bounding box as fractions of the image: 0.0 is the left/top edge, " +
  "1.0 the right/bottom edge. The box covers the skin of the face — forehead to chin, ear to " +
  "ear — not the hair, not the shoulders.\n\n" +
  "If several people are visible, use the largest, most central face. If no human face is " +
  "visible, say so instead of guessing.\n\n" +
  'Return ONLY this JSON, no prose: {"found":true|false,"left":0.00,"top":0.00,"right":0.00,"bottom":0.00}\n' +
  "Fractions to 2 decimals; left < right, top < bottom. Use 0 for all four when found is false.";

const even = (n: number) => 2 * Math.round(n / 2);

/**
 * The crop for a photo of `photoW`x`photoH` whose host face is `face` (full-resolution
 * pixels, box centre + side), or `null` when the photo should be rendered as it is. Pure.
 */
export function planLtxCrop(
  photoW: number,
  photoH: number,
  face: LtxFace | null,
  facesFound = face ? 1 : 0
): LtxFraming {
  const base = {
    photoW,
    photoH,
    faces: facesFound,
    face,
    crop: null,
    cropFaceFrac: null,
  };
  if (!face) {
    return {
      ...base,
      faceFrac: null,
      reason: "no face found — rendered as is",
    };
  }
  const faceFrac = face.size / photoH;
  if (photoH < MIN_PHOTO_H || photoW < MIN_PHOTO_H * ASPECT) {
    return {
      ...base,
      faceFrac,
      reason: `photo ${photoW}x${photoH} is too small to crop (under ${MIN_PHOTO_H} px tall) — rendered as is; use a larger photo`,
    };
  }
  const is169 = Math.abs(photoW / photoH - ASPECT) <= ASPECT * ASPECT_TOLERANCE;
  if (faceFrac >= SKIP_ABOVE_FACE_FRAC && is169) {
    return {
      ...base,
      faceFrac,
      reason: `face already ${pct(faceFrac)} of a 16:9 photo — rendered as is`,
    };
  }

  // Size: the window that puts the face at the target proportion, never so small that the
  // model would be upscaling it, then shrunk to what the photo can actually supply.
  let h = Math.max(face.size / TARGET_FACE_FRAC, MIN_CROP_H);
  let w = h * ASPECT;
  let note = "";
  if (w > photoW) {
    w = photoW;
    h = w / ASPECT;
    note = " (full width — the photo is too narrow for a wider window)";
  }
  if (h > photoH) {
    h = photoH;
    w = h * ASPECT;
    note = " (full height)";
  }
  w = even(w);
  h = even(h);
  if (w >= photoW - 1 && h >= photoH - 1) {
    return {
      ...base,
      faceFrac,
      reason: `face ${pct(faceFrac)} but the photo is already the tightest 16:9 window it allows — rendered as is`,
    };
  }

  // Place: face centred, eye line at the upper third, clamped inside the photo — a face at
  // the edge gets an off-centre but valid window rather than a window that leaves the photo.
  const eyeY = face.y - EYES_ABOVE_CENTRE * face.size;
  const x = even(clamp(face.x - w / 2, 0, photoW - w));
  const y = even(clamp(eyeY - h * EYE_LINE_FRAC, 0, photoH - h));
  const crop: LtxCrop = { x, y, w, h };
  const cropFaceFrac = face.size / h;
  return {
    ...base,
    faceFrac,
    crop,
    cropFaceFrac,
    reason: `face ${pct(faceFrac)} of the photo → crop ${w}x${h} at (${x},${y}), face ${pct(cropFaceFrac)} of the window${note}`,
  };
}

/**
 * Detect the host's face in a photo and plan its crop. EXIF orientation is applied first
 * (phone photos are stored sideways with a rotation tag; a box on the raw pixels would land on
 * the wrong spot). The LARGEST face is the host — a second person or a face on a poster does
 * not get to choose the framing — and the count is kept so that case is visible.
 */
export async function analyzeHostPhoto(buffer: Buffer): Promise<LtxFraming> {
  const oriented = await sharp(buffer)
    .rotate()
    .toBuffer({ resolveWithObject: true });
  const photoW = oriented.info.width;
  const photoH = oriented.info.height;

  // Every scan's boxes in full-resolution pixels, strongest first.
  const found: (LtxFace & { source: "pico" | "haiku" })[] = [];
  for (const width of SCAN_WIDTHS) {
    const scan = await sharp(oriented.data)
      .resize({ width, withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const scale = photoW / scan.info.width;
    for (const f of detectFaces(
      new Uint8Array(
        scan.data.buffer,
        scan.data.byteOffset,
        scan.data.byteLength
      ),
      scan.info.width,
      scan.info.height,
      { minQ: MIN_FACE_Q }
    )) {
      found.push({
        x: f.x * scale,
        y: f.y * scale,
        size: f.size * scale,
        q: f.q,
        source: "pico",
      });
    }
  }
  found.sort((a, b) => b.q - a.q || b.size - a.size);
  const distinct = dedupe(found);

  let face: (LtxFace & { source: "pico" | "haiku" }) | null =
    distinct[0] ?? null;
  if (!face) {
    // The cascade saw nothing at any scale. Ask the LLM for a box before giving up: a
    // missed face here is not a cosmetic miss, it is a host whose mouth will not move.
    face = await haikuFaceBox(oriented.data, photoW, photoH);
  }
  const rounded = face
    ? {
        x: Math.round(face.x),
        y: Math.round(face.y),
        size: Math.round(face.size),
        q: Math.round(face.q * 10) / 10,
        source: face.source,
      }
    : null;
  return planLtxCrop(
    photoW,
    photoH,
    rounded,
    face ? Math.max(1, distinct.length) : 0
  );
}

/** Collapse the same face seen at two scan widths (or twice at one) into one entry. */
function dedupe<T extends LtxFace>(faces: T[]): T[] {
  const out: T[] = [];
  for (const f of faces) {
    const dup = out.some(
      o =>
        Math.hypot(o.x - f.x, o.y - f.y) < 0.5 * Math.max(o.size, f.size) &&
        Math.max(o.size, f.size) / Math.min(o.size, f.size) < 1.8
    );
    if (!dup) out.push(f);
  }
  return out;
}

/** Read the fallback's verdict into a face box, or null. Pure — unit-tested. */
export function parseFaceBox(
  text: string,
  photoW: number,
  photoH: number
): (LtxFace & { source: "haiku" }) | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!j?.found) return null;
  const [l, t, r, b] = [j.left, j.top, j.right, j.bottom].map(Number);
  if (![l, t, r, b].every(v => Number.isFinite(v) && v >= 0 && v <= 1))
    return null;
  if (r - l < 0.02 || b - t < 0.02) return null;
  // pico's "size" is the side of a square box on the face; the LLM's box is the face's
  // extent, so its height is the like-for-like measure.
  return {
    x: ((l + r) / 2) * photoW,
    y: ((t + b) / 2) * photoH,
    size: (b - t) * photoH,
    q: 0,
    source: "haiku",
  };
}

async function haikuFaceBox(
  oriented: Buffer,
  photoW: number,
  photoH: number
): Promise<(LtxFace & { source: "haiku" }) | null> {
  try {
    const small = await sharp(oriented)
      .resize({ width: 768, withoutEnlargement: true })
      .png()
      .toBuffer();
    const image: ClaudeImage = {
      base64: small.toString("base64"),
      mediaType: "image/png",
    };
    const result = await invokeClaude({
      systemPrompt: FACE_BOX_SYSTEM,
      userMessage: "Where is the face in this photo?",
      imageInput: image,
      maxTokens: 96,
      model: FACE_BOX_MODEL,
    });
    return parseFaceBox(result.text, photoW, photoH);
  } catch (err: any) {
    console.warn(`[LTX framing] haiku fallback failed: ${err?.message ?? err}`);
    return null;
  }
}

/** One analysis per photo per process: 200 host scenes of one channel share one photo. */
const cache = new Map<string, Promise<LtxFraming>>();

/**
 * The framing for a photo URL, cached. Fails OPEN: an unreachable photo or a detector error
 * means "render as is" with the failure in `reason`, never a failed scene — the crop is a
 * quality improvement, the render is the job.
 */
export async function ltxFramingForUrl(url: string): Promise<LtxFraming> {
  let pending = cache.get(url);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(await presignOwnBucketUrl(url), {
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const framing = await analyzeHostPhoto(
          Buffer.from(await res.arrayBuffer())
        );
        console.log(
          `[LTX framing] ${url.split("/").pop()}: ${describe(framing)}`
        );
        return framing;
      } catch (err: any) {
        const framing: LtxFraming = {
          photoW: 0,
          photoH: 0,
          faces: 0,
          face: null,
          faceFrac: null,
          crop: null,
          cropFaceFrac: null,
          reason: `analysis failed (${err?.message ?? err}) — rendered as is`,
        };
        console.warn(
          `[LTX framing] ${url.split("/").pop()}: ${framing.reason}`
        );
        return framing;
      }
    })();
    cache.set(url, pending);
  }
  return pending;
}

/** One line a person can read: what was seen and what was decided. */
export function describe(f: LtxFraming): string {
  const seen = f.face
    ? `${f.faces} face${f.faces === 1 ? "" : "s"}, host ${f.face.size} px (${f.face.source ?? "pico"}, q ${f.face.q})`
    : "no face";
  return `photo ${f.photoW}x${f.photoH}, ${seen} — ${f.reason}`;
}

/** Test-only. */
export function __resetLtxFramingCache(): void {
  cache.clear();
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));

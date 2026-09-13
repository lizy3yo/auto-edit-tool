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
  "You are given ONE photo of a person who will present a video. Report TWO bounding boxes " +
  "as fractions of the image: 0.0 is the left/top edge, 1.0 the right/bottom edge.\n" +
  "1. face: the skin of the main person's face — forehead to chin, ear to ear — not the " +
  "hair, not the shoulders.\n" +
  "2. person: the whole visible person — top of the hair to the hands or lap (or the bottom " +
  "edge if they are cut off), shoulder to shoulder including the arms and hands. Not the " +
  "furniture, not the room.\n\n" +
  "If several people are visible, use the largest, most central one. If no human is visible, " +
  "say so instead of guessing.\n\n" +
  'Return ONLY this JSON, no prose: {"found":true|false,"left":0.00,"top":0.00,"right":0.00,"bottom":0.00,' +
  '"person":{"left":0.00,"top":0.00,"right":0.00,"bottom":0.00}}\n' +
  "Fractions to 2 decimals; left < right, top < bottom. Use 0 for every value when found is false.";

/** Breathing room around the avatar's box before the 16:9 window is fitted, per side. */
export const PERSON_MARGIN = 0.05;
/** A person window at or above this share of the photo (both sides) is the photo itself. */
export const PERSON_FILLS_PHOTO = 0.9;
/**
 * The proportional guess when Haiku has no answer, in face sizes from the face box's centre:
 * hair above, lap or resting hands below, arms out to the sides. A seated or standing host
 * framed by a photographer sits inside these; a wider box only costs some face size.
 */
export const PERSON_GUESS = { up: 0.9, down: 4.0, side: 2.25 };

const even = (n: number) => 2 * Math.round(n / 2);

/** The model's base passes: stage-1 height, and the output size that asks for it (2x). */
export const BASES = [
  { name: "544p", h: 544, width: 1920, height: 1088 },
  { name: "720p", h: 736, width: 2560, height: 1440 },
  { name: "1080p", h: 1088, width: 3840, height: 2176 },
] as const;
export type BaseName = (typeof BASES)[number]["name"];
/**
 * Host face height, in stage-1 pixels, below which the mouth does not articulate. Set from
 * the renders: 136 px (the workshop wide shot at 544p) was dead, 212 px (Granny at 544p) and
 * 194 px (the man cropped to 36% of a 544p window) were alive. The 720p / 1080p test on the
 * man (180 / 272 px) pins the floor; until then it sits between the measured dead and alive.
 */
// Pinned by the 720p/1080p test: 180 px (the man at a 720p base) articulated, 136 did not.
export const FACE_MIN_PX = Number(process.env.LTX_FACE_MIN_PX ?? 170);

/**
 * Pick the smallest base pass at which this photo's face reaches `FACE_MIN_PX`, capped at
 * `maxBase`. Pure. A photo that needs more than the cap gets the cap and `capped: true` —
 * the report names it as one to re-frame.
 */
export function planLtxBase(
  faceFrac: number | null,
  maxBase: BaseName = "1080p"
): NonNullable<LtxFraming["base"]> {
  const cap = BASES.findIndex(b => b.name === maxBase);
  const allowed = BASES.slice(0, cap + 1);
  if (faceFrac == null) {
    return { name: "544p", facePx: 0, sizeToSend: null, capped: false };
  }
  const fits = allowed.find(b => faceFrac * b.h >= FACE_MIN_PX);
  const pick = fits ?? allowed[allowed.length - 1];
  return {
    name: pick.name,
    facePx: Math.round(faceFrac * pick.h),
    // The default base needs no size at all — the graph's own — so nothing is sent.
    sizeToSend:
      pick.name === "544p" ? null : { width: pick.width, height: pick.height },
    capped: !fits,
  };
}

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

/** The avatar's box guessed from the face alone, clamped to the photo. Pure. */
export function personFromFace(
  photoW: number,
  photoH: number,
  face: LtxFace
): LtxCrop & { source: "proportional" } {
  const l = clamp(face.x - PERSON_GUESS.side * face.size, 0, photoW);
  const r = clamp(face.x + PERSON_GUESS.side * face.size, 0, photoW);
  const t = clamp(face.y - PERSON_GUESS.up * face.size, 0, photoH);
  const b = clamp(face.y + PERSON_GUESS.down * face.size, 0, photoH);
  return {
    x: Math.round(l),
    y: Math.round(t),
    w: Math.round(r - l),
    h: Math.round(b - t),
    source: "proportional",
  };
}

/**
 * The `person` window: the smallest 16:9 box that holds the whole avatar (plus a margin)
 * from above the head to the photo's bottom edge, never shorter than the model's own 544 px,
 * clamped inside the photo. Pure. On a 16:9 photo whose head sits near the top that box IS
 * the photo, and the render is `whole`; the window earns its keep on photos with headroom
 * or a person small in a big room. The face's
 * share of that window is what decides whether the mouth will articulate — it is reported
 * and saved, never enforced: the point of this mode is the body and hands, and a face that
 * ends up under a third of the window is a photo to reframe, said so in the reason.
 */
export function planLtxPersonCrop(
  photoW: number,
  photoH: number,
  face: LtxFace | null,
  person: LtxCrop | null
): Pick<LtxFraming, "personCrop" | "personFaceFrac" | "personReason"> {
  if (!face) {
    return {
      personCrop: null,
      personFaceFrac: null,
      personReason: "no face found — rendered as is",
    };
  }
  if (photoH < MIN_PHOTO_H || photoW < MIN_PHOTO_H * ASPECT) {
    return {
      personCrop: null,
      personFaceFrac: face.size / photoH,
      personReason: `photo ${photoW}x${photoH} is too small to crop — rendered as is; use a larger photo`,
    };
  }
  const box = person ?? personFromFace(photoW, photoH, face);
  const mx = box.w * PERSON_MARGIN;
  const my = box.h * PERSON_MARGIN;
  const bl = clamp(box.x - mx, 0, photoW);
  const br = clamp(box.x + box.w + mx, 0, photoW);
  const bt = clamp(box.y - my, 0, photoH);
  // The window always runs to the photo's BOTTOM edge. A host's lower body runs out of the
  // frame at the bottom of any photo a photographer framed, and Haiku's box stops at the
  // lap (833x549 of a 768-tall photo on the workshop shot, hands cut off) — the operator's
  // requirement is the person seen from the top of the head all the way down, with room.
  const bb = photoH;
  const bw = br - bl;
  const bh = bb - bt;

  // Fit 16:9 around the box: whichever side is short grows; then the model's floor; then
  // the photo's own edges.
  let w = Math.max(bw, bh * ASPECT, MIN_CROP_H * ASPECT);
  let h = w / ASPECT;
  let note = "";
  if (w > photoW) {
    w = photoW;
    h = w / ASPECT;
    note = " (full width)";
  }
  if (h > photoH) {
    h = photoH;
    w = h * ASPECT;
    note = " (full height)";
  }
  w = even(w);
  h = even(h);
  const share = `person ${Math.round(bw)}x${Math.round(bh)} (${person ? "haiku" : "guessed from the face"})`;
  if (w >= PERSON_FILLS_PHOTO * photoW && h >= PERSON_FILLS_PHOTO * photoH) {
    return {
      personCrop: null,
      personFaceFrac: face.size / photoH,
      personReason: `${share} fills the ${photoW}x${photoH} photo — rendered whole`,
    };
  }
  // Place: centred on the avatar, clamped inside the photo.
  const cx = (bl + br) / 2;
  const cy = (bt + bb) / 2;
  const x = even(clamp(cx - w / 2, 0, photoW - w));
  const y = even(clamp(cy - h / 2, 0, photoH - h));
  const personFaceFrac = face.size / h;
  const small =
    personFaceFrac < SKIP_ABOVE_FACE_FRAC
      ? ` — face only ${pct(personFaceFrac)} of it, the mouth may be soft; a waist-up photo would fix that`
      : "";
  return {
    personCrop: { x, y, w, h },
    personFaceFrac,
    personReason: `${share} → window ${w}x${h} at (${x},${y}), face ${pct(personFaceFrac)} of the window${note}${small}`,
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
  // Haiku is asked once per photo either way: for the avatar's extent (the `person` window
  // needs it; the cascade only finds faces), and — when the cascade saw nothing at any
  // scale — for the face too, because a missed face here is not a cosmetic miss, it is a
  // host whose mouth will not move.
  const boxes = await haikuBoxes(oriented.data, photoW, photoH);
  if (!face) face = boxes.face;
  const rounded = face
    ? {
        x: Math.round(face.x),
        y: Math.round(face.y),
        size: Math.round(face.size),
        q: Math.round(face.q * 10) / 10,
        source: face.source,
      }
    : null;
  const person = rounded
    ? (boxes.person ?? personFromFace(photoW, photoH, rounded))
    : null;
  return {
    ...planLtxCrop(
      photoW,
      photoH,
      rounded,
      face ? Math.max(1, distinct.length) : 0
    ),
    person,
    ...planLtxPersonCrop(photoW, photoH, rounded, person),
  };
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

/** Read the fallback's person box, or null. Pure — unit-tested. */
export function parsePersonBox(
  text: string,
  photoW: number,
  photoH: number
): (LtxCrop & { source: "haiku" }) | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const p = j?.person;
  if (!j?.found || !p) return null;
  const [l, t, r, b] = [p.left, p.top, p.right, p.bottom].map(Number);
  if (![l, t, r, b].every(v => Number.isFinite(v) && v >= 0 && v <= 1))
    return null;
  if (r - l < 0.05 || b - t < 0.05) return null;
  return {
    x: Math.round(l * photoW),
    y: Math.round(t * photoH),
    w: Math.round((r - l) * photoW),
    h: Math.round((b - t) * photoH),
    source: "haiku",
  };
}

async function haikuBoxes(
  oriented: Buffer,
  photoW: number,
  photoH: number
): Promise<{
  face: (LtxFace & { source: "haiku" }) | null;
  person: (LtxCrop & { source: "haiku" }) | null;
}> {
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
      userMessage: "Where are the face and the whole person in this photo?",
      imageInput: image,
      maxTokens: 160,
      model: FACE_BOX_MODEL,
    });
    return {
      face: parseFaceBox(result.text, photoW, photoH),
      person: parsePersonBox(result.text, photoW, photoH),
    };
  } catch (err: any) {
    console.warn(`[LTX framing] haiku boxes failed: ${err?.message ?? err}`);
    return { face: null, person: null };
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
  const person = f.personReason ? `; person: ${f.personReason}` : "";
  return `photo ${f.photoW}x${f.photoH}, ${seen} — face crop: ${f.reason}${person}`;
}

/** Test-only. */
export function __resetLtxFramingCache(): void {
  cache.clear();
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));

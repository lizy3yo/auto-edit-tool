/**
 * server/hostPhotoScore.ts — how good a host photo is for a talking head, as a number.
 *
 * A channel renders its host from ONE photo (2026-10-15, the operator: "reduce to 1 photo per
 * channel; the system should automatically pick the best image"). The competitor review found
 * that every competitor keeps one host photo for the whole channel while five of our six changed
 * it between videos, so a channel's films now all use the same photo, and the system picks which.
 *
 * The pick is measured, not asked of a model: deterministic, free, offline, the same answer on
 * every run. What a lip-sync model (HeyGen Avatar IV) needs from a still, in the order it matters:
 *   - ONE clear, front-facing face (the vendored `pico.ts` cascade; its confidence is the score's
 *     "front-facing and unobstructed" signal — it is a frontal-face detector);
 *   - enough pixels on the face: the face a healthy share of the frame and the photo itself large;
 *   - the face lit — neither in shadow nor blown out;
 *   - the face sharp (eyes band detail), so the eyes and brows stay crisp after the 1080p render;
 *   - REAL SKIN: fine texture on the cheeks. An airbrushed face reads as AI on screen (the review's
 *     "Scarlett's skin is too smooth"), and the lip-sync model keeps whatever skin it is handed;
 *   - a VISIBLE MOUTH: contrast in the mouth box. Lips lost in a beard or a moustache leave the
 *     model nothing to animate from and it invents the lips and teeth — the review's "Frederick's
 *     lower teeth smear when his mouth is wide open".
 *
 * Regions are read on the face CROPPED AND SCALED to `FACE_PX`, so a number means the same thing on
 * a 4K portrait and a 1080p phone frame. `measureHostPhoto` reads pixels; `scoreHostPhoto` is pure.
 *
 * SKIN and MOUTH are perceptual, so they are JUDGED (`judgeHostPhoto`, one vision call per photo,
 * saved on the row): measured on the library (2026-10-15), no pixel statistic told Brenda's freckled,
 * unretouched face from Scarlett's airbrushed one — cheek detail, band-pass energy and cheek/eye
 * ratios all read the two within noise of each other, because a generated portrait carries the
 * same fine grain either way. The pixel readings stay as the fallback when the judge cannot answer.
 */
import sharp from "sharp";
import { invokeClaude } from "./claude";
import { detectFaces } from "./pico";

/** The face is judged at this many pixels wide, whatever the photo's size. */
const FACE_PX = 256;
/** The detector's scan width (as `faceAlign.ts`): small enough to be fast, big enough to find a face. */
const SCAN_W = 640;

export interface HostPhotoMeasure {
  width: number;
  height: number;
  /** Faces the detector found (after its own clustering). */
  faces: number;
  /** The best face's detector confidence — higher is a clearer, more frontal face. */
  faceQ: number;
  /** The best face's box width as a share of the photo's width. */
  faceWidth: number;
  /** The face centre as a share of width / height. */
  faceX: number;
  faceY: number;
  /** Mean brightness of the face, 0-255. */
  faceLuma: number;
  /** Mean |Laplacian| over the eyes band at FACE_PX — the face's own sharpness. */
  faceDetail: number;
  /** Mean |Laplacian| over both cheeks at FACE_PX — real skin texture; airbrushed reads low. */
  skinTexture: number;
  /** Std-dev of brightness in the mouth box at FACE_PX — a mouth you can see. */
  mouthContrast: number;
}

export interface HostPhotoScore {
  /** 0-100, higher is better. 0 = no usable face. */
  score: number;
  /** Plain-words reasons the photo lost points, worst first. Empty = nothing to fix. */
  notes: string[];
}

/** Where the regions sit on the face crop, as fractions of the face box (centre = 0,0). */
const REGIONS = {
  eyes: { x0: -0.32, x1: 0.32, y0: -0.24, y1: -0.06 },
  cheekL: { x0: -0.32, x1: -0.14, y0: 0.0, y1: 0.16 },
  cheekR: { x0: 0.14, x1: 0.32, y0: 0.0, y1: 0.16 },
  mouth: { x0: -0.18, x1: 0.18, y0: 0.22, y1: 0.44 },
  face: { x0: -0.3, x1: 0.3, y0: -0.3, y1: 0.4 },
} as const;
type Region = (typeof REGIONS)[keyof typeof REGIONS];

/** Pixel rows/cols of a region on the FACE_PX crop (crop = 2× the face box, face centred). */
function box(r: Region) {
  const c = FACE_PX; // crop is 2*FACE_PX wide; the face box (FACE_PX wide) is centred at (c, c)
  return {
    x0: Math.round(c + r.x0 * FACE_PX),
    x1: Math.round(c + r.x1 * FACE_PX),
    y0: Math.round(c + r.y0 * FACE_PX),
    y1: Math.round(c + r.y1 * FACE_PX),
  };
}

function laplacian(px: Uint8Array, w: number, r: Region): number {
  const b = box(r);
  let s = 0;
  let n = 0;
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * w + x;
      s += Math.abs(4 * px[i] - px[i - 1] - px[i + 1] - px[i - w] - px[i + w]);
      n++;
    }
  return n ? s / n : 0;
}

function stats(px: Uint8Array, w: number, r: Region): { mean: number; sd: number } {
  const b = box(r);
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) {
      const v = px[y * w + x];
      s += v;
      s2 += v * v;
      n++;
    }
  const mean = n ? s / n : 0;
  return { mean, sd: n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : 0 };
}

/** Read a photo. Never throws on a photo with no face — it reports `faces: 0`. */
export async function measureHostPhoto(image: Buffer): Promise<HostPhotoMeasure> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const empty: HostPhotoMeasure = {
    width, height, faces: 0, faceQ: 0, faceWidth: 0, faceX: 0, faceY: 0,
    faceLuma: 0, faceDetail: 0, skinTexture: 0, mouthContrast: 0,
  };
  if (!width || !height) return empty;
  const scan = await sharp(image)
    .rotate()
    .resize({ width: SCAN_W, withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sw = scan.info.width;
  const sh = scan.info.height;
  const found = detectFaces(new Uint8Array(scan.data.buffer, scan.data.byteOffset, scan.data.byteLength), sw, sh)
    .filter(f => f.size >= sw * 0.05)
    .sort((a, b) => b.q - a.q);
  if (!found.length) return empty;
  const best = found[0];
  // a second face only counts when it is a real one, not a weak echo of the same face
  const faces = found.filter(f => f === best || (f.q >= best.q * 0.5 && Math.hypot(f.x - best.x, f.y - best.y) > best.size)).length;

  // crop 2× the face box around the face, scaled so the face box is FACE_PX wide
  const k = width / sw;
  const side = best.size * 2 * k;
  const left = Math.round(best.x * k - side / 2);
  const top = Math.round(best.y * k - side / 2);
  // Two pipelines: sharp applies `extract` BEFORE `extend` whatever the call order, so padding a
  // face near the edge and cutting it in one chain asks for an area outside the image.
  const s = Math.round(side);
  const padded = await sharp(await sharp(image).rotate().toBuffer())
    .extend({
      top: Math.max(0, -top), left: Math.max(0, -left),
      bottom: Math.max(0, top + s - height), right: Math.max(0, left + s - width),
      extendWith: "mirror",
    })
    .toBuffer({ resolveWithObject: true });
  const crop = await sharp(padded.data)
    .extract({
      left: Math.min(Math.max(0, left), padded.info.width - Math.min(s, padded.info.width)),
      top: Math.min(Math.max(0, top), padded.info.height - Math.min(s, padded.info.height)),
      width: Math.min(s, padded.info.width),
      height: Math.min(s, padded.info.height),
    })
    .resize(2 * FACE_PX, 2 * FACE_PX)
    .grayscale()
    .raw()
    .toBuffer();
  const px = new Uint8Array(crop.buffer, crop.byteOffset, crop.byteLength);
  const w = 2 * FACE_PX;
  return {
    width,
    height,
    faces,
    faceQ: +best.q.toFixed(1),
    faceWidth: +(best.size / sw).toFixed(3),
    faceX: +(best.x / sw).toFixed(3),
    faceY: +(best.y / sh).toFixed(3),
    faceLuma: Math.round(stats(px, w, REGIONS.face).mean),
    faceDetail: +laplacian(px, w, REGIONS.eyes).toFixed(2),
    skinTexture: +((laplacian(px, w, REGIONS.cheekL) + laplacian(px, w, REGIONS.cheekR)) / 2).toFixed(2),
    mouthContrast: +stats(px, w, REGIONS.mouth).sd.toFixed(2),
  };
}

/**
 * The thresholds, calibrated on the channel library and the review's photos (2026-10-15): every
 * originally-airbrushed portrait read skin under `skinSmooth`; its phone-look copy and the casual
 * photos above `skinReal`. Pure data, so a re-calibration is one edit and the tests say what moved.
 */
export const PHOTO_LIMITS = {
  minEdgeGood: 720,
  minEdgeOk: 480,
  faceWidthMin: 0.12,
  faceWidthMax: 0.34,
  centreGood: 0.12,
  centreOk: 0.2,
  lumaMin: 80,
  lumaMax: 190,
  detailSoft: 6,
  detailSharp: 12,
  skinSmooth: 3.0,
  skinReal: 5.0,
  mouthHidden: 18,
  mouthClear: 30,
  qClear: 12,
} as const;

/** A 0..1 ramp from `lo` to `hi`. */
const ramp = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

/**
 * The judged half: how real the skin looks and how clearly the lips can be seen, 1 (worst) to 5.
 * Null fields when the judge could not answer.
 */
export interface HostPhotoJudgement {
  skin: number | null;
  mouth: number | null;
  /**
   * The photo caught the host MID-WORD, mouth open in speech, not smiling (2026-10-16). A lip-sync
   * model returns to the photo's mouth whenever the voice stops, so such a photo reads as a mouth
   * that never closes. A SMILE is not open: resting a smile closed hid the teeth HeyGen copies, and
   * Ruth's lower mouth got worse with no gain in her pauses. Absent = no verdict.
   */
  open?: boolean;
}

/** Score a measured photo, with the judged skin and mouth when there is a verdict. Pure. */
export function scoreHostPhoto(m: HostPhotoMeasure, judged?: HostPhotoJudgement | null): HostPhotoScore {
  const L = PHOTO_LIMITS;
  if (!m.faces) return { score: 0, notes: ["no clear face found"] };
  const notes: { pts: number; why: string }[] = [];
  let score = 10; // a face was found

  const edge = Math.min(m.width, m.height);
  const res = edge >= L.minEdgeGood ? 10 : edge >= L.minEdgeOk ? 6 : 0;
  score += res;
  if (res < 10) notes.push({ pts: 10 - res, why: `small photo (${m.width}×${m.height})` });

  if (m.faces > 1) {
    score -= 15;
    notes.push({ pts: 15, why: "more than one face" });
  }

  const sizeOk =
    m.faceWidth < L.faceWidthMin
      ? ramp(m.faceWidth, L.faceWidthMin * 0.5, L.faceWidthMin)
      : m.faceWidth > L.faceWidthMax
        ? 1 - ramp(m.faceWidth, L.faceWidthMax, L.faceWidthMax * 1.6)
        : 1;
  score += 15 * sizeOk;
  if (sizeOk < 1) notes.push({ pts: 15 * (1 - sizeOk), why: m.faceWidth < L.faceWidthMin ? "face small in the frame" : "face too close to the camera" });

  const off = Math.abs(m.faceX - 0.5);
  const centre = off <= L.centreGood ? 10 : off <= L.centreOk ? 5 : 0;
  score += centre;
  if (centre < 10) notes.push({ pts: 10 - centre, why: "host off centre" });

  const light = m.faceLuma < L.lumaMin ? ramp(m.faceLuma, L.lumaMin * 0.6, L.lumaMin) : m.faceLuma > L.lumaMax ? 1 - ramp(m.faceLuma, L.lumaMax, 245) : 1;
  score += 10 * light;
  if (light < 1) notes.push({ pts: 10 * (1 - light), why: m.faceLuma < L.lumaMin ? "face too dark" : "face too bright" });

  const sharp = ramp(m.faceDetail, L.detailSoft, L.detailSharp);
  score += 10 * sharp;
  if (sharp < 1) notes.push({ pts: 10 * (1 - sharp), why: "face soft or out of focus" });

  // judged when a verdict exists (1 = worst, 5 = best), else the pixel fallback
  const skin = judged?.skin != null ? ramp(judged.skin, 1, 5) : ramp(m.skinTexture, L.skinSmooth, L.skinReal);
  score += 15 * skin;
  if (skin < 1) notes.push({ pts: 15 * (1 - skin), why: "skin looks airbrushed" });

  const mouth = judged?.mouth != null ? ramp(judged.mouth, 1, 5) : ramp(m.mouthContrast, L.mouthHidden, L.mouthClear);
  score += 15 * mouth;
  if (mouth < 1) notes.push({ pts: 15 * (1 - mouth), why: "lips hard to see (beard, shadow or a closed smile)" });

  const clear = ramp(m.faceQ, 5, L.qClear);
  score += 5 * clear;
  if (clear < 0.5) notes.push({ pts: 5 * (1 - clear), why: "face not square to the camera" });

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    notes: notes.filter(n => n.pts >= 1.5).sort((a, b) => b.pts - a.pts).map(n => n.why),
  };
}

const PHOTO_JUDGE_MODEL = () => process.env.HOST_PHOTO_JUDGE_MODEL || "claude-sonnet-5";

/**
 * The rubric. Anchored at both ends so two runs on one photo land on the same number, and it names
 * what a LIP-SYNC model needs, since that is what the photo is for. No channel or person named.
 */
export const PHOTO_JUDGE_SYSTEM =
  "You are shown a close crop of a person's face from a photo that will be animated into a " +
  "talking-head video by a lip-sync model. Be strict: most AI-generated and studio portraits are " +
  "retouched, and a viewer notices. Rate two things, each 1 to 5.\n" +
  "skin — how REAL the skin looks. Look at the cheeks, forehead and around the nose: are PORES " +
  "visible, is the tone slightly uneven (a little redness, small marks, freckles), is there a " +
  "little natural shine? 5 = yes to all, an unretouched phone photo of real skin; 4 = real skin, a " +
  "little smoothed; 3 = noticeably smoothed, pores mostly gone; 2 = airbrushed — even, poreless, " +
  "matte skin like a beauty advert or an AI portrait, even if wrinkles are drawn on; 1 = plastic or " +
  "waxy. Wrinkles alone do NOT make skin real. Judge the skin only — not age, make-up or light.\n" +
  "mouth — how clearly the LIPS can be seen for animating speech: 5 = both lips fully visible with " +
  "clear edges, relaxed, nothing over them; 4 = both lips visible, a little hair or shadow at an " +
  "edge; 3 = partly covered (a moustache over the upper lip, a beard close round the lower lip) or " +
  "a wide open grin; 2 = mostly covered; 1 = the lips are hidden or cannot be told apart from the " +
  "hair or shadow around them.\n" +
  "open — is the person caught MID-WORD: the mouth open in the shape of speech, lips apart and the " +
  "jaw dropped or the lips pushed into a sound, with the mouth CORNERS NOT RAISED? true or false. " +
  "Look at the corners first: corners lifted into the cheeks = a smile = false, even with the teeth " +
  "showing or apart. Closed lips or lips only slightly parted are false.\n" +
  'Return ONLY JSON: {"skin":1-5,"mouth":1-5,"open":true|false}';

/** Read the judge's answer; anything unreadable is "no verdict" (the pixel fallback scores). Pure. */
export function parsePhotoJudgement(raw: string): HostPhotoJudgement {
  const m = /\{[\s\S]*\}/.exec(raw ?? "");
  const grade = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null;
  };
  if (!m) return { skin: null, mouth: null };
  try {
    const d = JSON.parse(m[0]);
    return {
      skin: grade(d?.skin),
      mouth: grade(d?.mouth),
      ...(typeof d?.open === "boolean" ? { open: d.open } : {}),
    };
  } catch {
    return { skin: null, mouth: null };
  }
}

/** Judge a photo's skin and lips. Never throws — a failed call is "no verdict". */
export async function judgeHostPhoto(image: Buffer, m?: HostPhotoMeasure): Promise<HostPhotoJudgement> {
  try {
    // the FACE, close: shrunk whole, a face is ~200 px and no pore can show
    let src = sharp(image).rotate();
    if (m?.faceWidth) {
      const side = Math.round(Math.min(m.width, m.height, m.faceWidth * m.width * 1.5));
      const left = Math.max(0, Math.min(m.width - side, Math.round(m.faceX * m.width - side / 2)));
      const top = Math.max(0, Math.min(m.height - side, Math.round(m.faceY * m.height - side * 0.45)));
      src = sharp(await src.extract({ left, top, width: side, height: side }).toBuffer());
    }
    const small = await src.resize(768, 768, { fit: "inside" }).png().toBuffer();
    const r = await invokeClaude({
      systemPrompt: PHOTO_JUDGE_SYSTEM,
      userMessage: "Rate this photo.",
      imageInput: { base64: small.toString("base64"), mediaType: "image/png" },
      maxTokens: 200,
      model: PHOTO_JUDGE_MODEL(),
      thinking: "off",
      step: "Host photo check",
    });
    return parsePhotoJudgement(r.text);
  } catch (err: any) {
    console.warn(`[HostPhotoScore] judge failed: ${err?.message ?? err}`);
    return { skin: null, mouth: null };
  }
}

/**
 * The LOWER MOUTH of a rendered talking head (2026-10-16, the review: "Frederick's lower teeth smear
 * a little when his mouth is wide open"). Judged on the six widest-open frames side by side: two
 * pixel measures of tooth edges were tried and both failed on beards — a white beard read as a
 * flat "lower row" of teeth, and the second version scored Dale's clean teeth below Hank's smear.
 */
export const LOWER_MOUTH_SYSTEM =
  "You are shown six close-ups of the same person's mouth while talking, frames from an " +
  "AI-animated talking-head video, at the moments the mouth is most open. Rate the LOWER MOUTH " +
  "only — the lower lip and the lower teeth — from 1 to 5. 5 = the lower lip has a crisp, stable " +
  "edge and the lower teeth, where they show, are distinct individual teeth; 4 = slightly soft " +
  "but clearly real; 3 = in some frames the lower teeth are a soft white band or the lower lip " +
  "edge blurs into the beard or chin; 2 = the lower teeth are a smeared white band and the lower " +
  "lip edge is blurred or warps; 1 = the mouth melts or morphs, teeth merge into the lips. A beard " +
  "around the mouth is fine; judge only whether the lip and teeth look real and sharp. Upper teeth " +
  "do not count.\n" +
  'Return ONLY JSON: {"lower":1-5,"what":"<the main fault in a few words, or empty>"}';

/** Judge a contact sheet of open-mouth frames. Never throws — no verdict is `lower: null`. */
export async function judgeLowerMouth(sheet: Buffer): Promise<{ lower: number | null; what: string }> {
  try {
    const img = await sharp(sheet).resize({ width: 1800, withoutEnlargement: true }).png().toBuffer();
    const r = await invokeClaude({
      systemPrompt: LOWER_MOUTH_SYSTEM,
      userMessage: "Rate the lower mouth.",
      imageInput: { base64: img.toString("base64"), mediaType: "image/png" },
      maxTokens: 200,
      model: PHOTO_JUDGE_MODEL(),
      thinking: "off",
      step: "Lower mouth check",
    });
    const m = /\{[\s\S]*\}/.exec(r.text ?? "");
    if (!m) return { lower: null, what: "" };
    const d = JSON.parse(m[0]);
    const n = Number(d?.lower);
    return {
      lower: Number.isFinite(n) && n >= 1 && n <= 5 ? Math.round(n) : null,
      what: String(d?.what ?? "").slice(0, 80),
    };
  } catch (err: any) {
    console.warn(`[HostPhotoScore] lower-mouth judge failed: ${err?.message ?? err}`);
    return { lower: null, what: "" };
  }
}

/**
 * Our host's lower mouth AGAINST THE BENCHMARK (2026-10-16). An absolute 1-5 grade called every
 * HeyGen mouth "2", Brenda's included, so the question became the brief's own: "BERTHA is the
 * quality benchmark". TOP row: six of Bertha's widest-open frames; BOTTOM row: six of ours.
 */
export const LOWER_MOUTH_VS_SYSTEM =
  "You compare two rows of close-ups of a talking person's mouth, at the moments it is most open. " +
  "TOP row: the BENCHMARK, a host whose mouth looks right. BOTTOM row: the host being checked. " +
  "Compare ONLY the lower mouth — the lower lip and the lower teeth: are the lower teeth individual " +
  "teeth or a smeared white band, is the lower lip edge crisp and stable or blurred and warping " +
  "into the chin or beard. Ignore beards, skin, lighting, colour, the upper teeth and how wide the " +
  "mouth opens. Different people have different mouths; judge only how REAL and SHARP the lower " +
  "mouth is drawn.\n" +
  'Return ONLY JSON: {"verdict":"better"|"same"|"slightly worse"|"clearly worse","what":"<the main difference in a few words>"}';

const VERDICTS = ["clearly worse", "slightly worse", "same", "better"] as const;
export type MouthVerdict = (typeof VERDICTS)[number];

/** Read the comparison; anything unreadable is no verdict. Pure. */
export function parseMouthVerdict(raw: string): { verdict: MouthVerdict | null; what: string } {
  const m = /\{[\s\S]*\}/.exec(raw ?? "");
  if (!m) return { verdict: null, what: "" };
  try {
    const d = JSON.parse(m[0]);
    const v = String(d?.verdict ?? "").toLowerCase().trim() as MouthVerdict;
    return { verdict: VERDICTS.includes(v) ? v : null, what: String(d?.what ?? "").slice(0, 100) };
  } catch {
    return { verdict: null, what: "" };
  }
}

/** Passes when the lower mouth is at least as good as the benchmark's, or only slightly worse. */
export const mouthVerdictPasses = (v: MouthVerdict | null): boolean | null =>
  v == null ? null : v !== "clearly worse";

/**
 * Three independent comparisons, the middle verdict kept: one call wobbles a step either way (Bertha
 * against another clip of herself read "slightly worse" once and "same" once). Never throws.
 */
export async function compareLowerMouth(
  benchmark: Buffer,
  ours: Buffer,
  votes = 3
): Promise<{ verdict: MouthVerdict | null; what: string; votes: (MouthVerdict | null)[] }> {
  const all = await Promise.all(Array.from({ length: votes }, () => compareLowerMouthOnce(benchmark, ours)));
  const ranked = all.filter(v => v.verdict).sort((a, b) => VERDICTS.indexOf(a.verdict!) - VERDICTS.indexOf(b.verdict!));
  const mid = ranked[ranked.length >> 1];
  return { verdict: mid?.verdict ?? null, what: mid?.what ?? "", votes: all.map(v => v.verdict) };
}

/** Our sheet against the benchmark sheet, stacked. Never throws — no verdict is null. */
async function compareLowerMouthOnce(
  benchmark: Buffer,
  ours: Buffer
): Promise<{ verdict: MouthVerdict | null; what: string }> {
  try {
    const W = 1800;
    const top = await sharp(benchmark).resize({ width: W }).png().toBuffer();
    const bottom = await sharp(ours).resize({ width: W }).png().toBuffer();
    const [ht, hb] = [(await sharp(top).metadata()).height!, (await sharp(bottom).metadata()).height!];
    const pair = await sharp({ create: { width: W, height: ht + hb + 12, channels: 3, background: "#000" } })
      .composite([
        { input: top, left: 0, top: 0 },
        { input: bottom, left: 0, top: ht + 12 },
      ])
      .png()
      .toBuffer();
    const r = await invokeClaude({
      systemPrompt: LOWER_MOUTH_VS_SYSTEM,
      userMessage: "Is the bottom row's lower mouth as real and sharp as the benchmark's?",
      imageInput: { base64: pair.toString("base64"), mediaType: "image/png" },
      maxTokens: 200,
      model: PHOTO_JUDGE_MODEL(),
      thinking: "off",
      step: "Lower mouth vs benchmark",
    });
    return parseMouthVerdict(r.text);
  } catch (err: any) {
    console.warn(`[HostPhotoScore] mouth comparison failed: ${err?.message ?? err}`);
    return { verdict: null, what: "" };
  }
}

/** Measure, judge and score in one call. */
export async function rateHostPhoto(
  image: Buffer,
  opts: { judge?: boolean } = {}
): Promise<HostPhotoScore & { measure: HostPhotoMeasure; judged: HostPhotoJudgement | null }> {
  const measure = await measureHostPhoto(image);
  const judged = opts.judge === false || !measure.faces ? null : await judgeHostPhoto(image, measure);
  return { ...scoreHostPhoto(measure, judged), measure, judged };
}

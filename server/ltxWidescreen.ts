/**
 * server/ltxWidescreen.ts — a host photo that is not 16:9 becomes 16:9 BEFORE the LTX lane
 * frames or renders it, the way HeyGen does: the room is painted wider, the person is untouched.
 *
 * Why: the lane's worker cover-scales any photo onto its 1920x1080 plate, and for a 4:3 photo
 * that means zooming in until 16:9 fits — a quarter of the height is thrown away, top and
 * bottom. The first two 4:3 host photos through the lane (2026-09-15, jobs 99 and 100) came
 * back with the top of the head cut off and the picture pushed in; HeyGen's clips of the same
 * photos show MORE room than the photo on both sides. The lane's whole design (whole photo,
 * head to hands, the avatar window = the picture) assumes a 16:9 input, and this makes one.
 *
 * Two ways, in order:
 *   1. OUTPAINT — the photo is placed at full height on a 16:9 canvas and gpt-image-2 paints
 *      the empty side bands (`outpaintImage`, a masked edit). Then VERIFIED: the face detector
 *      must find the host's face where the placement put it, at the same size — a result that
 *      moved, shrank or lost the face is rejected. Each side band is a strip of the photo's
 *      room; the model is told to change nothing on the person.
 *   2. BLUR-PAD — the deterministic fallback: the photo fitted by height, over a blurred and
 *      darkened cover-scaled copy of itself. Nothing is invented and nothing is cut off; the
 *      sides read as out-of-focus room.
 * Either result is re-hosted on R2 and remembered in `app_settings` under the photo's key, so a
 * photo is widened once. Any failure returns the ORIGINAL url and says so: a cut-off head is a
 * regression, a render is the job.
 */
import { createHash } from "crypto";
import sharp from "sharp";
import { detectFaces } from "./pico";
import { getAppSetting, setAppSetting } from "./db";
import { storagePut, presignOwnBucketUrl } from "./storage";
import { outpaintImage } from "./providers/openai-image";

export const ASPECT = 16 / 9;
/** Within this of 16:9 a photo is left alone (a 1376x768 export is 1.79). */
export const ASPECT_TOLERANCE = 0.05;
/** The widened canvas: 16:9, both dims /16 for the image API; the worker scales to 1080. */
export const CANVAS_W = 1920;
export const CANVAS_H = 1088;
/** The verified face may differ from the placed one by this much of its size. */
export const FACE_TOLERANCE = 0.25;

export type WidescreenMethod = "as-is" | "outpaint" | "blur-pad" | "failed";
export interface WidescreenResult {
  url: string;
  method: WidescreenMethod;
  photoW: number;
  photoH: number;
  /** Where the original photo sits on the widened canvas (canvas pixels). */
  placed?: { x: number; y: number; w: number; h: number };
  reason: string;
}

export const isWidescreen = (w: number, h: number): boolean =>
  Math.abs(w / h - ASPECT) <= ASPECT * ASPECT_TOLERANCE;

export function widescreenKeyFor(imageUrl: string): string {
  return `ltx_widescreen:${createHash("sha1").update(imageUrl).digest("hex").slice(0, 16)}`;
}

/** Where a photo lands on the canvas when fitted by HEIGHT and centred. Pure. */
export function planPlacement(
  photoW: number,
  photoH: number,
  canvasW = CANVAS_W,
  canvasH = CANVAS_H
): { x: number; y: number; w: number; h: number } {
  const s = canvasH / photoH;
  const w = Math.min(canvasW, Math.round(photoW * s));
  const h = canvasH;
  return { x: Math.round((canvasW - w) / 2), y: 0, w, h };
}

/**
 * Does the widened image still show the host's face where the placement put it? Pure. `face`
 * is the photo's face (photo pixels); `found` the boxes seen on the widened image (canvas
 * pixels). The face must be found, at the placed position, at the placed size.
 */
export function acceptOutpaint(
  face: { x: number; y: number; size: number } | null,
  placed: { x: number; y: number; w: number; h: number },
  photoW: number,
  photoH: number,
  found: { x: number; y: number; size: number }[]
): { ok: boolean; reason: string } {
  if (!face) return { ok: found.length > 0, reason: found.length ? "a face is present" : "no face on the result" };
  const s = placed.h / photoH;
  const ex = placed.x + face.x * s;
  const ey = placed.y + face.y * s;
  const es = face.size * s;
  const hit = found.find(
    f => Math.hypot(f.x - ex, f.y - ey) <= FACE_TOLERANCE * es && Math.abs(f.size - es) <= FACE_TOLERANCE * es
  );
  return hit
    ? { ok: true, reason: `face verified at (${Math.round(hit.x)},${Math.round(hit.y)}) ${Math.round(hit.size)} px` }
    : { ok: false, reason: `face not where it was placed (expected (${Math.round(ex)},${Math.round(ey)}) ${Math.round(es)} px; saw ${found.length})` };
}

const OUTPAINT_PROMPT =
  "Extend this photograph to the sides so the frame becomes wider. Continue the same room, " +
  "the same furniture, walls, window light and colour grading naturally into the empty areas " +
  "on the left and right. Do not change the person in any way: same face, pose, clothing, " +
  "position and size. Photorealistic, seamless, no borders, no text.";

async function facesOn(buffer: Buffer): Promise<{ x: number; y: number; size: number }[]> {
  const out: { x: number; y: number; size: number }[] = [];
  for (const width of [640, 1280]) {
    const scan = await sharp(buffer).resize({ width, withoutEnlargement: true }).grayscale().raw().toBuffer({ resolveWithObject: true });
    const meta = await sharp(buffer).metadata();
    const scale = (meta.width ?? width) / scan.info.width;
    for (const f of detectFaces(new Uint8Array(scan.data.buffer, scan.data.byteOffset, scan.data.byteLength), scan.info.width, scan.info.height, { minQ: 8 }))
      out.push({ x: f.x * scale, y: f.y * scale, size: f.size * scale });
  }
  return out;
}

async function blurPad(oriented: Buffer, photoW: number, photoH: number): Promise<{ png: Buffer; placed: WidescreenResult["placed"] }> {
  const placed = planPlacement(photoW, photoH);
  const background = await sharp(oriented)
    .resize({ width: CANVAS_W, height: CANVAS_H, fit: "cover" })
    .blur(40)
    .modulate({ brightness: 0.85 })
    .toBuffer();
  const foreground = await sharp(oriented).resize({ width: placed.w, height: placed.h, fit: "fill" }).toBuffer();
  const png = await sharp(background)
    .composite([{ input: foreground, left: placed.x, top: placed.y }])
    .jpeg({ quality: 92 })
    .toBuffer();
  return { png, placed };
}

async function outpaint(oriented: Buffer, photoW: number, photoH: number): Promise<{ png: Buffer; placed: WidescreenResult["placed"] } | { error: string }> {
  const placed = planPlacement(photoW, photoH);
  const photo = await sharp(oriented).resize({ width: placed.w, height: placed.h, fit: "fill" }).png().toBuffer();
  // The canvas: transparent everywhere, the photo where it sits. The mask: opaque where the
  // photo is (keep), transparent in the bands (paint) — the API's convention.
  const canvas = await sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: photo, left: placed.x, top: placed.y }])
    .png()
    .toBuffer();
  const keep = await sharp({ create: { width: placed.w, height: placed.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const mask = await sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: keep, left: placed.x, top: placed.y }])
    .png()
    .toBuffer();
  const res = await outpaintImage({ png: canvas, mask, prompt: OUTPAINT_PROMPT, size: `${CANVAS_W}x${CANVAS_H}` });
  if (!res.success || !res.fileData) return { error: res.error ?? "outpaint failed" };
  const out = await sharp(Buffer.from(res.fileData)).resize({ width: CANVAS_W, height: CANVAS_H, fit: "fill" }).jpeg({ quality: 92 }).toBuffer();
  return { png: out, placed };
}

const inFlight = new Map<string, Promise<WidescreenResult>>();

/**
 * The 16:9 version of a host photo's URL — the same URL when it already is, the widened copy
 * otherwise. `face` (photo pixels, from the framing analysis of the ORIGINAL) makes the
 * outpaint verifiable; without it any face on the result passes.
 */
export async function ensureWidescreenPhoto(
  imageUrl: string,
  opts: { face?: { x: number; y: number; size: number } | null; mode?: "outpaint" | "blur" | "off"; log?: (l: string) => void } = {}
): Promise<WidescreenResult> {
  const log = opts.log ?? ((l: string) => console.log(`[LTX widescreen] ${l}`));
  const mode = opts.mode ?? "outpaint";
  const key = widescreenKeyFor(imageUrl);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async (): Promise<WidescreenResult> => {
      const name = imageUrl.split("/").pop();
      try {
        const stored = await getAppSetting(key);
        if (stored) {
          const r = JSON.parse(stored) as WidescreenResult;
          if (r?.url && r.method !== "failed") return r;
        }
      } catch {
        /* re-run */
      }
      try {
        const res = await fetch(await presignOwnBucketUrl(imageUrl), { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const oriented = await sharp(Buffer.from(await res.arrayBuffer())).rotate().toBuffer({ resolveWithObject: true });
        const photoW = oriented.info.width;
        const photoH = oriented.info.height;
        if (mode === "off" || isWidescreen(photoW, photoH)) {
          const r: WidescreenResult = { url: imageUrl, method: "as-is", photoW, photoH, reason: mode === "off" ? "widening off" : `${photoW}x${photoH} is 16:9` };
          return r;
        }
        let png: Buffer | null = null;
        let placed: WidescreenResult["placed"];
        let method: WidescreenMethod = "blur-pad";
        let reason = "";
        if (mode === "outpaint") {
          const o = await outpaint(oriented.data, photoW, photoH);
          if ("error" in o) {
            reason = `outpaint failed (${o.error}) — `;
          } else {
            const verdict = acceptOutpaint(opts.face ?? null, o.placed!, photoW, photoH, await facesOn(o.png));
            if (verdict.ok) {
              png = o.png;
              placed = o.placed;
              method = "outpaint";
              reason = `outpainted ${photoW}x${photoH} → ${CANVAS_W}x${CANVAS_H}; ${verdict.reason}`;
            } else reason = `outpaint rejected (${verdict.reason}) — `;
          }
        }
        if (!png) {
          const b = await blurPad(oriented.data, photoW, photoH);
          png = b.png;
          placed = b.placed;
          reason += `blur-padded ${photoW}x${photoH} → ${CANVAS_W}x${CANVAS_H}`;
        }
        const put = await storagePut(`ltx-widescreen/${key.split(":")[1]}-${method}.jpg`, png, "image/jpeg");
        const r: WidescreenResult = { url: put.url, method, photoW, photoH, placed, reason };
        await setAppSetting(key, JSON.stringify(r));
        log(`${name}: ${reason} → ${put.url.split("/").pop()}`);
        return r;
      } catch (err: any) {
        const r: WidescreenResult = { url: imageUrl, method: "failed", photoW: 0, photoH: 0, reason: `widening failed (${err?.message ?? err}) — rendered from the original` };
        log(`${name}: ${r.reason}`);
        return r;
      }
    })();
    inFlight.set(key, pending);
    pending.then(r => {
      if (r.method === "failed") inFlight.delete(key);
    });
  }
  return pending;
}

/** Test-only. */
export function __resetLtxWidescreenCache(): void {
  inFlight.clear();
}

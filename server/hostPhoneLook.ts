/**
 * server/hostPhoneLook.ts — the PHONE-LOOK copy of a host photo (v2, 2026-10-11).
 *
 * HeyGen keeps the look of the photo it animates, so a studio-lit, retouched, blurred-background
 * portrait stays "AI" under any finish laid over the film. The review of the competitors' hosts
 * (Steve Cooper, Elias Yoder, Bertha Ramirez) showed what theirs have instead: flat room light,
 * weak colour, soft phone-video detail, the whole room in focus, and plain unretouched skin.
 *
 * The copy is that — and ONLY that. The first phone look (2026-09-28, removed 2026-10-05) re-shot
 * the host from a propped-up phone: "from a little below eye level, a little off-centre, with
 * plenty of the room", which moved and shrank the host (Frederick: 4% off, 13% smaller) and is what
 * the operator refused. This one keeps the person, age, make-up, clothes, room and FRAMING and
 * changes how it was recorded — the operator's "in between" pick of three samples: real skin and
 * dull light, but not older and not stripped of make-up.
 *
 * The image model follows that to within a few percent, not exactly, so nothing is taken on
 * trust. Each draw is (1) LINED UP to the original — the two pictures are laid over each other
 * (server/pictureRegister.ts) and the copy is scaled and shifted until it sits on the photo —
 * then (2) RE-MEASURED, and (3) held to
 * QUALITY limits taken from the competitors' frames. A draw that fails any of it is drawn once
 * more; when that fails too the photo keeps its original and the tile says why. Whether the face
 * still LOOKS like the host is not something this measures — a person sees both versions on the
 * tile, with "Make phone look again" and the switch back to the original.
 *
 * Made ONCE per photo, in the background, the first time the photo is listed or saved
 * (`ensurePhoneLook`); a generate that finds one missing waits for it briefly
 * (`phoneLookWithin`) and otherwise renders the original. Never blocks anything.
 */
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { ApimartAdapter } from "./providers/apimart";
import { storagePut, presignOwnBucketUrl } from "./storage";
import { registerCopy, type Registration } from "./pictureRegister";
import { getAppSetting, setAppSetting, updateChannelHostPhoto } from "./db";
import { getApimartEditKey, getApimartSlotKey } from "./longformVideo";
import { PROVIDER_ACCOUNT_MAX } from "../shared/accountPool";
import {
  PHONE_LOOK_KEY_PREFIX,
  PHONE_LOOK_VERSION,
  phoneLookFailure,
  usablePhoneLook,
} from "../shared/hostPhotoLook";
import type { ImageAspectRatio } from "../shared/types";
import type { ChannelHostPhoto } from "../drizzle/schema";

/**
 * The recipe — word for word the one behind the samples the operator chose on 2026-10-11. It names
 * no channel, room or person: everything it must keep is "as in the photo". Three things earlier
 * drafts got wrong are spelled out. Asked only to "re-record on a phone", the model un-blurred
 * the room and left the face glossy (detail went UP, 349 → 819). Asked for "an ordinary person,
 * no make-up look", it aged Scarlett and removed her lipstick. And without "do not make the
 * person bigger or smaller" a copy came back 6.8% larger. Pure.
 */
export const PHONE_LOOK_PROMPT =
  "Turn this photo into one paused frame of a video that the same person recorded of themselves on the FRONT camera of an " +
  "ordinary, few-years-old phone leaning on the table in front of them. " +
  "KEEP EVERYTHING WHERE IT IS: the head, face and shoulders at exactly the same position and exactly the same size in the " +
  "frame as in the photo — do not make the person bigger or smaller, closer or further; the same room and the same objects " +
  "in the same places; the same camera position, angle and crop. Do not move, zoom, reframe, add or remove anything. " +
  "KEEP THE PERSON EXACTLY WHO THEY ARE: the same face and features, the SAME AGE — not older, not younger, no added " +
  "wrinkles — the same hair colour and hairstyle, the same make-up if they wear any (the same lipstick), the same " +
  "jewellery, clothes and pose. " +
  "ONLY MAKE THE SKIN AND FINISH REAL instead of retouched: natural skin texture with slightly uneven tone and a little " +
  "shine on the forehead and nose, no airbrushing, no glow, no beauty smoothing; a few stray hairs. The expression is " +
  "relaxed and natural — a soft, easy look at the phone, not a posed camera smile. " +
  "PICTURE QUALITY OF ORDINARY PHONE VIDEO, not a photograph: flat, dull indoor light from an ordinary ceiling light and a " +
  "window, with no flattering light on the face, no warm or golden tone; the face a little dim. Muted, slightly washed-out " +
  "colours with a faint grey-green indoor cast, as when a phone gets the white balance slightly wrong. Low contrast, " +
  "greyish shadows. Any window or lamp is blown out to plain white. Moderately soft like 720p phone video with mild " +
  "compression — eyes, eyebrows, hair and beard still clearly readable, but no razor-sharp micro detail and no sparkle. " +
  "The whole room is in focus, nothing blurred behind the person. " +
  "Not cinematic, not a portrait, not professional. No text, logos or watermarks.";

// ─── Framing: the copy is lined up to the original ───────────────────────────────────────────

/** The canvas a copy is made on: the ORIGINAL's own shape, `LOOK_LONG_EDGE` on its long side. */
export interface Canvas {
  width: number;
  height: number;
}

const LOOK_LONG_EDGE = 1920;
/** Below this there is too little picture to line anything up to (one library photo is 160 px). */
export const MIN_SOURCE_EDGE = 480;

/** The shapes the image model draws; a photo gets the one nearest its own. */
const SHAPES: { ratio: ImageAspectRatio; value: number }[] = [
  { ratio: "16:9", value: 16 / 9 },
  { ratio: "4:3", value: 4 / 3 },
  { ratio: "1:1", value: 1 },
  { ratio: "3:4", value: 3 / 4 },
  { ratio: "9:16", value: 9 / 16 },
];

/** The shape to ask the image model for: the nearest to the photo's own. Pure. */
export function nearestShape(width: number, height: number): ImageAspectRatio {
  const a = Math.log(width / height);
  return SHAPES.reduce((best, s) =>
    Math.abs(Math.log(s.value) - a) < Math.abs(Math.log(best.value) - a) ? s : best
  ).ratio;
}

/** The canvas for a photo of this size: its own shape, even dimensions. Pure. */
export function canvasFor(width: number, height: number): Canvas {
  const k = LOOK_LONG_EDGE / Math.max(width, height);
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * How far a lined-up copy may fall short of the frame before it is refused. Shrinking a copy that
 * came back too big uncovers a strip along one or two edges, filled by mirroring the copy's own
 * border. A thin strip of wall or bench mirrored is invisible; a wide one starts repeating objects.
 * Summed over both axes, as a fraction of the frame.
 */
export const MAX_MIRRORED_EDGE = 0.06;

/**
 * Below this the copy is not the photo's picture in the photo's place. Measured on the first real
 * copies (`registerCopy`, the middle of the frame): every copy that visibly matched its original
 * read 0.95-0.98; the first phone look's re-shot copies 0.77 and 0.78; the draft that aged
 * Scarlett and took her make-up 0.79; two different hosts 0.51.
 */
export const MIN_MATCH = 0.87;

/** After lining up, the copy must sit on the photo: these are the measurement's own grain. */
export const FRAMING_MAX_SHIFT = 0.01;
export const FRAMING_MAX_SIZE = 0.015;

export interface FramingLock {
  /** Factor the copy is resized by. */
  scale: number;
  /** Where the resized copy's top-left lands on the canvas, in px (negative = cropped off). */
  left: number;
  top: number;
  /** Strip left uncovered on each side, in px — filled by mirroring. */
  pad: { left: number; top: number; right: number; bottom: number };
  /** The uncovered strips as a fraction of the frame, both axes summed. */
  edge: number;
}

/** The resize and shift that put the copy where `drift` says the photo is. Pure. */
export function planFramingLock(drift: Registration, canvas: Canvas): FramingLock {
  const w = Math.round(canvas.width * drift.scale);
  const h = Math.round(canvas.height * drift.scale);
  const left = Math.round(drift.left * canvas.width);
  const top = Math.round(drift.top * canvas.height);
  const pad = {
    left: Math.max(0, left),
    top: Math.max(0, top),
    right: Math.max(0, canvas.width - (left + w)),
    bottom: Math.max(0, canvas.height - (top + h)),
  };
  const edge =
    Math.max(pad.left, pad.right) / canvas.width + Math.max(pad.top, pad.bottom) / canvas.height;
  return { scale: drift.scale, left, top, pad, edge };
}

/**
 * Why a copy is not the photo's picture in the photo's place, or null when it is. The shift is
 * judged at the CENTRE of the frame — what a viewer sees move — not at its corner. Pure.
 */
export function framingFault(drift: Registration): string | null {
  if (drift.score < MIN_MATCH)
    return `it does not match the photo — the host or the room was redrawn (match ${drift.score.toFixed(2)})`;
  const dx = Math.abs(drift.left + drift.scale / 2 - 0.5);
  const dy = Math.abs(drift.top + drift.scale / 2 - 0.5);
  if (dx > FRAMING_MAX_SHIFT || dy > FRAMING_MAX_SHIFT)
    return `the host moved in the frame (${(Math.max(dx, dy) * 100).toFixed(1)}% off)`;
  const ds = Math.abs(drift.scale - 1);
  if (ds > FRAMING_MAX_SIZE)
    return `the host came back a different size (${(ds * 100).toFixed(1)}% off)`;
  return null;
}

// ─── Quality: held to what the competitors' hosts measure ───────────────────────────────────

/**
 * How a frame reads: colour strength (0-100), fine detail over the middle of the frame (the
 * host), and fine detail down both sides (the room behind them).
 */
export interface LookMeasure {
  colour: number;
  detail: number;
  room: number;
}

/**
 * The limits, from the three competitor host frames of the 2026-10 review measured by
 * `measureLook` (colour 20 / 24 / 23, detail 360 / 318 / 115) against our photos as uploaded
 * (colour 30-38, detail 349-849).
 *
 * Both numbers depend on WHAT is in the frame as well as how it was recorded — a navy tee and a
 * pegboard of tools carry more colour than a grey room, a striped top more "detail" than a plain
 * one — so a copy passes at the competitors' ceiling OR clearly under its own original, whichever
 * is higher. Frederick's chosen sample reads colour 30 from 38; Scarlett's detail 556 from 849.
 * The floors catch the opposite failure: a draft recipe returned Frederick at detail 37, a smear.
 */
export const LOOK_LIMITS = {
  colourMax: 26,
  colourOfOriginal: 0.85,
  colourMin: 8,
  detailMax: 360,
  detailOfOriginal: 0.75,
  detailMin: 60,
  /**
   * A room reading under this is a blurred, portrait-lens background (Frederick 10, Scarlett 12,
   * Brenda 7). It is the room's OWN reading, not its share of the host's: Dale's barn wall reads
   * 25 beside a bearded face at 1146, which a ratio called blurred — and refused two good copies.
   */
  blurredRoomBelow: 15,
  /** …and its copy must bring the room this much back into focus. */
  roomOfOriginal: 1.3,
};

/** Why a copy does not read as phone video beside its original, or null when it does. Pure. */
export function qualityFault(copy: LookMeasure, original: LookMeasure): string | null {
  const L = LOOK_LIMITS;
  if (copy.colour > Math.max(L.colourMax, original.colour * L.colourOfOriginal))
    return `the colours are still too strong (${copy.colour}, the original is ${original.colour})`;
  if (copy.detail > Math.max(L.detailMax, original.detail * L.detailOfOriginal))
    return `it is still too sharp (${copy.detail}, the original is ${original.detail})`;
  if (copy.colour < L.colourMin) return `the colour is washed out (${copy.colour})`;
  if (copy.detail < L.detailMin) return `it is too blurry (${copy.detail})`;
  // A phone has no portrait lens. The first real run returned Frederick's garage as blurred as it
  // went in (room 11 from 10) while the chosen sample of the same photo read 22, and passed every
  // other check. Only asked of a photo whose room IS blurred: one already in focus has nothing to
  // gain, and the softer phone finish rightly takes a little off it.
  if (
    original.room < L.blurredRoomBelow &&
    copy.room < original.room * L.roomOfOriginal
  )
    return `the room behind the host is still blurred (${copy.room}, the original is ${original.room})`;
  return null;
}

const MEASURE_W = 960;
const MEASURE_H = 540;

/**
 * Measure a frame. Colour is the mean HSV saturation; detail is the energy of a 4-neighbour
 * Laplacian over the middle of the frame, where the host is. Read at 960×540 whatever the source,
 * so a number means the same thing on every photo and on the competitor frames it is held to.
 */
export async function measureLook(image: Buffer): Promise<LookMeasure> {
  const { data } = await sharp(image)
    .resize(MEASURE_W, MEASURE_H, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = MEASURE_W * MEASURE_H;
  const luma = new Float32Array(n);
  let sat = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    sat += max ? (max - Math.min(r, g, b)) / max : 0;
  }
  let energy = 0;
  let count = 0;
  for (let y = MEASURE_H / 4; y < (MEASURE_H * 3) / 4; y++) {
    for (let x = 300; x < 660; x++) {
      const i = y * MEASURE_W + x;
      const v = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - MEASURE_W] - luma[i + MEASURE_W];
      energy += v * v;
      count++;
    }
  }
  // The room: both sides of the frame, from just under the top to below the shoulders' line.
  let roomEnergy = 0;
  let roomCount = 0;
  for (let y = 54; y < 324; y++) {
    for (const [x0, x1] of [
      [20, 220],
      [740, 940],
    ]) {
      for (let x = x0; x < x1; x++) {
        const i = y * MEASURE_W + x;
        const v = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - MEASURE_W] - luma[i + MEASURE_W];
        roomEnergy += v * v;
        roomCount++;
      }
    }
  }
  return {
    colour: Math.round((sat / n) * 100),
    detail: Math.round(energy / count),
    room: Math.round(roomEnergy / roomCount),
  };
}

// ─── Making a copy ───────────────────────────────────────────────────────────────────────────

/** Resize and shift a canvas-sized copy by `lock`, mirroring its border over any uncovered strip. */
async function applyFramingLock(copy: Buffer, lock: FramingLock, canvas: Canvas): Promise<Buffer> {
  const resized = await sharp(copy)
    .resize(Math.round(canvas.width * lock.scale), Math.round(canvas.height * lock.scale))
    .png()
    .toBuffer();
  const padded = await sharp(resized).extend({ ...lock.pad, extendWith: "mirror" }).png().toBuffer();
  return sharp(padded)
    .extract({
      left: lock.pad.left - lock.left,
      top: lock.pad.top - lock.top,
      width: canvas.width,
      height: canvas.height,
    })
    .png()
    .toBuffer();
}

/** The APIMART key for a job-less image: the Edit key, else the first account that has one. */
async function apimartKey(): Promise<string> {
  const edit = await getApimartEditKey();
  if (edit) return edit;
  for (let slot = 0; slot < PROVIDER_ACCOUNT_MAX; slot++) {
    const key = await getApimartSlotKey(slot);
    if (key) return key;
  }
  throw new Error("no APIMART key — add one in Admin → Provider Keys");
}

/** One draw of the recipe from the photo at `sourceUrl`, as the image model returned it. */
async function drawPhoneLook(sourceUrl: string, shape: ImageAspectRatio): Promise<Buffer> {
  const adapter = new ApimartAdapter(await apimartKey());
  const [r] = await adapter.generateImage({
    prompt: PHONE_LOOK_PROMPT,
    model: "gpt-image-2",
    aspectRatio: shape,
    count: 1,
    // Providers get the PUBLIC url (CLAUDE.md: server-side READS presign, providers never do).
    imageUrls: [sourceUrl],
  } as any);
  if (!r?.success || !r.fileData?.length)
    throw new Error(r?.error || "the image model returned nothing");
  return Buffer.from(r.fileData);
}

/** A draw that could not be used, and why — the next draw may still pass. */
class RejectedDraw extends Error {}

/** How many times one photo is drawn before it keeps its original. Each draw is a paid image. */
export const PHONE_LOOK_DRAWS = 2;

/**
 * Line one draw up to the original and hold it to the checks. Returns the finished copy, or
 * throws `RejectedDraw` naming the check it failed.
 */
async function finishDraw(
  drawn: Buffer,
  original: { image: Buffer; look: LookMeasure },
  canvas: Canvas
): Promise<Buffer> {
  // The model draws its nearest shape, not the photo's exact one (1376×768 is 1.79, not 16:9):
  // cover-fit loses under 1% of an edge, and the lock below puts the host back regardless.
  const fitted = await sharp(drawn)
    .resize(canvas.width, canvas.height, { fit: "cover" })
    .png()
    .toBuffer();
  const drift = await registerCopy(original.image, fitted);
  if (drift.score < MIN_MATCH) throw new RejectedDraw(framingFault(drift)!);
  const lock = planFramingLock(drift, canvas);
  if (lock.edge > MAX_MIRRORED_EDGE)
    throw new RejectedDraw(
      `the host came back too far from where the photo puts them (${(lock.edge * 100).toFixed(1)}% of the frame)`
    );
  const locked = await applyFramingLock(fitted, lock, canvas);
  // Measured, not assumed: a second comparison says the lined-up copy really sits on the photo.
  const moved = framingFault(await registerCopy(original.image, locked));
  if (moved) throw new RejectedDraw(moved);
  const poor = qualityFault(await measureLook(locked), original.look);
  if (poor) throw new RejectedDraw(poor);
  return sharp(locked).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}

/** Two at a time across the process: a channel's whole library is listed at once. */
let making = 0;
const waiting: (() => void)[] = [];
async function withMakeSlot<T>(run: () => Promise<T>): Promise<T> {
  if (making >= 2) await new Promise<void>(res => waiting.push(res));
  making++;
  try {
    return await run();
  } finally {
    making--;
    waiting.shift()?.();
  }
}

/**
 * Make the phone-look copy of the photo at `sourceUrl` and store it. Throws — with the reason in
 * words an operator can act on — when the photo cannot be used or no draw passed the checks.
 */
export async function makePhoneLookPhoto(sourceUrl: string): Promise<string> {
  return withMakeSlot(async () => {
    const resp = await fetch(await presignOwnBucketUrl(sourceUrl), {
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`the photo could not be read (${resp.status})`);
    const source = Buffer.from(await resp.arrayBuffer());
    const meta = await sharp(source).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (Math.min(width, height) < MIN_SOURCE_EDGE)
      throw new Error(`the photo is too small (${width}×${height}) — upload a larger one`);
    const canvas = canvasFor(width, height);
    const image = await sharp(source).resize(canvas.width, canvas.height).png().toBuffer();
    const original = { image, look: await measureLook(image) };

    let why = "";
    for (let draw = 1; draw <= PHONE_LOOK_DRAWS; draw++) {
      try {
        const copy = await finishDraw(
          await drawPhoneLook(sourceUrl, nearestShape(width, height)),
          original,
          canvas
        );
        const { url } = await storagePut(
          `${PHONE_LOOK_KEY_PREFIX}v${PHONE_LOOK_VERSION}-${nanoid(10)}.jpg`,
          copy,
          "image/jpeg"
        );
        return url;
      } catch (err: any) {
        // Only a draw that failed a CHECK earns another: the provider, the key and the storage
        // fail the same way twice, and a second paid image would prove nothing.
        if (!(err instanceof RejectedDraw)) throw err;
        why = err.message;
        console.warn(`[HostPhoneLook] draw ${draw}/${PHONE_LOOK_DRAWS} refused: ${why}`);
      }
    }
    throw new Error(why);
  });
}

/** One make per photo at a time — a second list call joins the first. */
const inflight = new Map<number, Promise<string | null>>();

/**
 * Make a library photo's phone look if the CURRENT recipe has not made (or failed) it yet, and
 * the photo was not switched to the original. Returns the phone-look URL, or null when there is
 * none to use. Records the outcome on the row. Never throws.
 *
 * A failure leaves an earlier copy on the row untouched — `hostPhotoUrl` stops reading it the
 * moment the error is recorded — so a remake that fails never destroys the copy it replaced.
 */
export function ensurePhoneLook(row: ChannelHostPhoto): Promise<string | null> {
  const ready = usablePhoneLook(row);
  if (ready) return Promise.resolve(ready);
  if (row.useOriginal || phoneLookFailure(row)) return Promise.resolve(null);
  const running = inflight.get(row.id);
  if (running) return running;
  const job = (async () => {
    try {
      const url = await makePhoneLookPhoto(row.imageUrl);
      await updateChannelHostPhoto(row.id, {
        phoneImageUrl: url,
        phoneLookError: null,
        phoneLookVersion: PHONE_LOOK_VERSION,
      });
      console.log(`[HostPhoneLook] photo ${row.id} (${row.channelKey}): phone look made`);
      return url;
    } catch (err: any) {
      const why = String(err?.message ?? err).slice(0, 250);
      await updateChannelHostPhoto(row.id, {
        phoneLookError: why,
        phoneLookVersion: PHONE_LOOK_VERSION,
      }).catch(() => {});
      console.warn(`[HostPhoneLook] photo ${row.id} (${row.channelKey}): kept the original — ${why}`);
      return null;
    } finally {
      inflight.delete(row.id);
    }
  })();
  inflight.set(row.id, job);
  return job;
}

/** Start the phone look for every listed photo that still needs one — fire and forget. */
export function ensurePhoneLooks(rows: ChannelHostPhoto[]): void {
  for (const r of rows) if (r.isActive) void ensurePhoneLook(r);
}

/**
 * The phone look for a video that is starting now: wait up to `ms` for it, else null (the
 * caller renders the original and says so).
 */
export async function phoneLookWithin(row: ChannelHostPhoto, ms: number): Promise<string | null> {
  return Promise.race([
    ensurePhoneLook(row),
    new Promise<null>(res => setTimeout(() => res(null), ms)),
  ]);
}

/**
 * The phone look for ANY photo URL — the HeyGen test's and the VSL's uploads, which are not in a
 * library. Cached by the source URL and the recipe in `app_settings`, so a photo is remade only
 * once however many runs test it, and an older recipe's copy is never handed back.
 */
export async function phoneLookForUrl(sourceUrl: string): Promise<string> {
  const hash = createHash("sha1").update(sourceUrl).digest("hex");
  const key = `phone_look_v${PHONE_LOOK_VERSION}:${hash}`;
  const cached = await getAppSetting(key);
  if (cached) return cached;
  const url = await makePhoneLookPhoto(sourceUrl);
  await setAppSetting(key, url);
  return url;
}

/**
 * server/pictureVariety.ts — no picture in a video is a near-copy of another (2026-10-15).
 *
 * The competitor review: "Dale repeats phone-screen pictures that look almost the same". His
 * practice job 372 had ~13 phone screens in 47 scenes, nearly all "a phone lying on the workbench
 * showing a buy-and-sell app", one Etsy listing twice almost word for word. Two causes, both here:
 *
 *   1. Every app picture was given the SAME fixed setting (`DEVICE_RESTS`: held, or flat on a
 *      surface) and the same close framing, so the code itself produced the copies. Each screen
 *      picture in a film now gets the NEXT of several distinct settings (`assignScreenSetups`) —
 *      a phone beside the real item, a laptop on a kitchen table, a tablet by a window… — in film
 *      order, so no two screens in a row share one and a film cycles through all of them.
 *   2. Nothing compared a picture with the rest of the film — only with the picture right before
 *      it. Every drawn still is now fingerprinted (a 64-bit difference hash, the standard
 *      perceptual near-duplicate test) and compared with every earlier picture of the same video;
 *      a near-copy is drawn once more, told to differ (`nearCopyOf`).
 *
 * Applies to every channel; nothing here names one.
 */
import sharp from "sharp";
import type { StoryboardScene } from "@shared/types";
import { namesDevice, sellingScreen } from "./shotList";

/**
 * Where a screen sits, one per screen picture in turn. Every one keeps the rule that a device is
 * held or lies flat (never standing on its edge — practice jobs 363/369), and every one is a real,
 * ordinary place, not a styled one. PERSON-FREE settings for a picture with nobody in it; the
 * HELD ones for a picture of the host's hands.
 */
export const SCREEN_SETUPS = [
  "a phone lying flat on its back on the work surface right beside the real item it shows, photographed looking down at both",
  "a laptop open on its base on a kitchen table, its screen showing the page, a mug and a few papers beside it",
  "a tablet lying flat on a wooden table by a window, photographed from above at a slight angle",
  "a phone lying flat on a porch or patio table outdoors in daylight, photographed looking down at it",
  "a laptop open on its base on a plain desk next to a notebook and a pen, seen from a little to one side",
  "a phone lying flat on the arm of a sofa, photographed looking down at it",
] as const;
/**
 * Held screens are each a different COMPOSITION, not only a different room: four "man holding a
 * phone" pictures in four rooms still read as one picture shown four times (Dale's job 372 test).
 */
export const HELD_SCREEN_SETUPS = [
  "a close-up of just one hand holding a phone, the screen filling most of the frame, the room soft and far behind",
  "seen over the shoulder from behind, a tablet held in both hands on the lap in an armchair",
  "a phone held out at arm's length beside a market stall table outdoors, the stall and its items in view",
  "a phone held low in one hand at a kitchen counter, seen from the side at counter height",
] as const;

/**
 * The settings that put things for sale in the frame — the real item beside the phone, a market
 * stall and its items. Only a screen about selling sits in one (`screenSells`): an airline app or a
 * "Subscribe" tap beside an item for sale is a picture of something the line never said.
 */
const SELLING_SETUPS: ReadonlySet<string> = new Set<string>([SCREEN_SETUPS[0], HELD_SCREEN_SETUPS[2]]);

/** The words of a screen picture (an app, a website, a listing), before the device gate. */
export const SCREEN_PICTURE =
  /\b(?:apps?|buy-and-sell|online (?:craft )?(?:shop|store)|website|phone screen|listings?)\b/i;

/**
 * A screen picture: its screen words AND a device or screen named (`namesDevice`) — "listing to one
 * side" (job 151) or "ready for an online listing" (job 372's split panel) has no screen in it. The
 * ONE test of the prompt's screen clause (`buildStillPrompt`) and of the screen settings here, so
 * the two cannot drift. Pure.
 */
export const screenPicture = (text: string): boolean => SCREEN_PICTURE.test(text) && namesDevice(text);

/**
 * Whether a screen picture is about selling, read off its OWN words (`sellingScreen`): its subject
 * and its description (`visual` when the prompt draws a softened one). Pure.
 */
export function screenSells(scene: Pick<StoryboardScene, "showSubject" | "visualPrompt">, visual?: string): boolean {
  return sellingScreen(`${scene.showSubject ?? ""} ${visual ?? scene.visualPrompt ?? ""}`);
}

/**
 * Give each screen picture of the film its own setting, in film order (`scene.screenSetup`). Host
 * takes, split screens, the book cover, operator assets and the QR card are left alone; a screen not
 * about selling skips the selling settings. Returns how many screens were set. Pure apart from
 * mutating `scenes`.
 */
export function assignScreenSetups(scenes: StoryboardScene[]): number {
  let free = 0;
  let held = 0;
  let screens = 0;
  for (const s of scenes) {
    const eligible = !s.hostPresent && !s.splitVisual && !s.coverHero && !s.assetImageUrl && !s.qrHero && !s.showsBook;
    const screen = eligible && screenPicture(`${s.showSubject ?? ""} ${s.visualPrompt ?? ""}`);
    if (!screen) {
      s.screenSetup = undefined;
      continue;
    }
    const sells = screenSells(s);
    let setup: string;
    do {
      setup = s.humanPresent
        ? HELD_SCREEN_SETUPS[held++ % HELD_SCREEN_SETUPS.length]
        : SCREEN_SETUPS[free++ % SCREEN_SETUPS.length];
    } while (!sells && SELLING_SETUPS.has(setup));
    s.screenSetup = setup;
    screens++;
  }
  return screens;
}

/**
 * A screen setting for a redraw that came back a near-copy: never `current`, never the setting of
 * the picture it copied (`avoid`) — Dale's job 372 test redrew a copy of the "held outdoors" screen
 * straight back into "held outdoors" — and a selling setting only for a screen about selling. Pure.
 */
export function nextScreenSetup(
  current: string | undefined,
  held: boolean,
  avoid?: string,
  selling = false
): string {
  const list: readonly string[] = held ? HELD_SCREEN_SETUPS : SCREEN_SETUPS;
  const allowed = (x: string) => selling || !SELLING_SETUPS.has(x);
  const i = current ? list.indexOf(current) : -1;
  for (let step = 1 + Math.floor(list.length / 2), n = 0; n < list.length; n++, step++) {
    const next = list[(i + step + list.length) % list.length];
    if (next !== current && next !== avoid && allowed(next)) return next;
  }
  return list.find(allowed) ?? list[0];
}

// ─── Near-copies across the film ─────────────────────────────────────────────────────────────

/** 64-bit difference hash as a string of 64 "0"/"1": 9×8 greyscale, one bit per left-right step. */
export async function pictureHash(image: Buffer): Promise<string> {
  const px = await sharp(image).greyscale().blur(0.5).resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) h += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  return h;
}

/** Bits that differ between two hashes. Pure. */
export function hashDistance(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * Pictures at or under this many differing bits (of 64) are CANDIDATE near-copies, confirmed by a
 * side-by-side look (`scanNearCopy`). The hash alone cannot decide: on Dale's job 372 (2026-10-15)
 * the real near-copies — two piles of the same boards, two Etsy-listing screens, two "phone on
 * the bench" screens — read 16-18 apart, and different pictures of the same workshop from 19 up, so
 * a hash-only line would either miss copies or redraw good pictures. 20 catches every copy there
 * and sends ~6 of 496 pairs to the look.
 */
export const NEAR_COPY_BITS = 20;
/** At most this many candidates are looked at per picture, closest first. */
const MAX_CANDIDATES = 2;

interface Drawn {
  hash: string;
  /** A small JPEG of the picture, for the side-by-side look. */
  thumb: Buffer;
  /** The screen setting it was drawn in, if it is a screen. */
  setup?: string;
}
const drawn = new Map<number, Map<number, Drawn>>();
const MAX_JOBS = 12;

/** A video's pictures so far (the oldest video is forgotten past `MAX_JOBS`). */
function jobPictures(jobId: number): Map<number, Drawn> {
  let m = drawn.get(jobId);
  if (!m) {
    if (drawn.size >= MAX_JOBS) drawn.delete(Array.from(drawn.keys())[0]);
    m = new Map();
    drawn.set(jobId, m);
  }
  return m;
}

/** The thumbnail a picture is remembered by. */
export async function pictureThumb(image: Buffer): Promise<Buffer> {
  return sharp(image).resize(640, 360, { fit: "cover" }).jpeg({ quality: 75 }).toBuffer();
}

/**
 * Earlier pictures of this video close enough to `hash` to be looked at, closest first (scene
 * index and its thumbnail). A scene is never compared with its own earlier draw.
 */
export function nearCopyCandidates(
  jobId: number,
  sceneIndex: number,
  hash: string
): { index: number; thumb: Buffer; bits: number; setup?: string }[] {
  const out: { index: number; thumb: Buffer; bits: number; setup?: string }[] = [];
  jobPictures(jobId).forEach((d, index) => {
    const bits = hashDistance(d.hash, hash);
    if (index !== sceneIndex && bits <= NEAR_COPY_BITS) out.push({ index, thumb: d.thumb, bits, setup: d.setup });
  });
  return out.sort((a, b) => a.bits - b.bits).slice(0, MAX_CANDIDATES);
}

/** Remember the picture a scene kept. */
export function rememberPicture(jobId: number, sceneIndex: number, hash: string, thumb: Buffer, setup?: string): void {
  jobPictures(jobId).set(sceneIndex, { hash, thumb, setup });
}

/** Redraws a picture gets when it nearly copies another of the same video. */
export const MAX_VARIETY_REDRAWS = 2;

const screenTurns = new Map<string, Promise<unknown>>();
/**
 * Run `fn` after every earlier draw in the same LANE of the same video has finished, so each picture
 * is compared with all the pictures before it in that lane (drawn together, two never see each
 * other). Lanes: "screen" for screen pictures, "thing:<name>" for pictures of one key thing —
 * Frederick's job 375 test drew three near-identical "smoke alarm held, back label facing viewer"
 * pictures at the same moment. Other pictures stay parallel.
 */
export function withScreenTurn<T>(jobId: number, fn: () => Promise<T>, lane = "screen"): Promise<T> {
  const key = `${jobId}|${lane}`;
  const before = screenTurns.get(key) ?? Promise.resolve();
  const mine = before.then(fn, fn);
  const settled = mine.catch(() => undefined);
  screenTurns.set(key, settled);
  void settled.then(() => {
    if (screenTurns.get(key) === settled) screenTurns.delete(key);
  });
  return mine;
}

/** The lane a picture is drawn in (`withScreenTurn`), or null for a picture drawn in parallel. Pure. */
export function varietyLane(scene: Pick<StoryboardScene, "screenSetup" | "keyThing">): string | null {
  if (scene.screenSetup) return "screen";
  const thing = scene.keyThing?.trim().toLowerCase();
  return thing ? `thing:${thing}` : null;
}

/** Added to a picture redrawn because it nearly copied another picture of the video. */
export const DIFFERENT_PICTURE_CLAUSE =
  "This picture must look clearly DIFFERENT from the other pictures in this video: a different " +
  "spot in the room or another place, a different distance and a different angle, other things " +
  "around the subject.";

/**
 * The camera view a near-copy is redrawn from, in turn: the shot list's own views for a long topic
 * (`OTHER_VIEWS` in shotList.ts). "Look different" alone came back as the same shelf of boxes four
 * times in Frederick's practice job 376 — a picture of a key thing is drawn from its memory picture,
 * which pulls the framing back; a named view does not.
 */
export const REDRAW_VIEWS = [
  "Camera for THIS picture: a close-up of one small detail of the subject filling the frame.",
  "Camera for THIS picture: seen from much further back, the whole place around it and the subject small in it.",
  "Camera for THIS picture: seen from the other side, from low down.",
] as const;

/** The redraw clause for the k-th redraw (0-based). Pure. */
export function differentPictureClause(k: number): string {
  return `${DIFFERENT_PICTURE_CLAUSE} ${REDRAW_VIEWS[k % REDRAW_VIEWS.length]} Never the reference picture's framing.`;
}

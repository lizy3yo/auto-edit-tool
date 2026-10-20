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
 *   3. (2026-10-18) A split screen's panel was left out as "square and composited", so job 405's
 *      panel at scene 9 was scene 2's walking cat again, 14 s later, never compared. A panel is now
 *      fingerprinted as the square it shows and compared with every picture of the video
 *      (`pictureFingerprint`, `fingerprintDistance`), and a copy is redrawn told to differ.
 *   4. (round 13, the review of jobs 408-410) Copies of the picture a picture was DRAWN FROM still
 *      shipped: a fallback was never remembered, so nothing later was compared with it
 *      (`rememberShippedPicture`); a thing kept small beside the subject met no side-by-side check;
 *      a relative read past the 20-bit line; and two pictures drawn from one memory picture were drawn
 *      at once in two lanes. A picture's relatives — what it was drawn from, and what else was drawn
 *      from that — are now candidates on a wider line, the closest looked at when no other check laid
 *      one beside it (`NearCopyRelated`), and they share a lane (`varietyLanes`).
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

/**
 * The 64 bits of a difference hash of `img`: 9×8 greyscale, one bit per left-right step. Greyscale
 * HERE, on every input: a one-channel raw input comes back as three channels unless told, and the
 * bits would be read off every third value.
 */
async function dhashOf(img: sharp.Sharp): Promise<string> {
  const px = await img.greyscale().blur(0.5).resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = "";
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) h += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  return h;
}

/** 64-bit difference hash as a string of 64 "0"/"1": 9×8 greyscale, one bit per left-right step. */
export async function pictureHash(image: Buffer): Promise<string> {
  return dhashOf(sharp(image));
}

/** Bits that differ between two hashes. Pure. */
export function hashDistance(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * A picture's fingerprint for the near-copy check. `square`: a split screen's panel, fingerprinted
 * as the square it shows. A full-frame picture also carries `windows`, the hashes of square windows
 * across it, so a panel can be laid over the part of it a square would show (`fingerprintDistance`).
 * A bare hash (a string) stands for a full-frame picture with no windows.
 */
export interface PictureFingerprint {
  hash: string;
  square?: boolean;
  windows?: string[];
}

/** Full-height square windows taken across a full-frame picture, from its left edge to its right. */
export const SQUARE_WINDOWS = 5;

/**
 * Fingerprint a drawn picture (`PictureFingerprint`). A split panel (`square`) is hashed as the
 * centre square its slot shows — the whole picture when it came back square, as asked. A full-frame
 * picture keeps its ordinary hash and adds the hashes of `SQUARE_WINDOWS` square windows across it,
 * decoded once. On a PNG — every still of jobs 401-407 — that hash is `pictureHash`'s bit for bit, so
 * full-frame pairs read as before. A JPEG (the image fallback's) is decoded whole here, where
 * `pictureHash` lets sharp shrink it on load, and reads up to ~10 bits differently on the review
 * frames: the same way for every picture, so pictures are still compared like with like.
 */
export async function pictureFingerprint(image: Buffer, square = false): Promise<PictureFingerprint> {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const raw = () => sharp(data, { raw: { width, height, channels } });
  if (square) {
    const side = Math.min(width, height);
    const centre = { left: Math.floor((width - side) / 2), top: Math.floor((height - side) / 2), width: side, height: side };
    return { hash: await dhashOf(raw().extract(centre)), square: true };
  }
  const hash = await dhashOf(raw());
  if (width <= height) return { hash };
  const windows = await Promise.all(
    Array.from({ length: SQUARE_WINDOWS }, (_, k) =>
      dhashOf(
        raw().extract({ left: Math.round(((width - height) * k) / (SQUARE_WINDOWS - 1)), top: 0, width: height, height })
      )
    )
  );
  return { hash, windows };
}

const asPrint = (p: string | PictureFingerprint): PictureFingerprint => (typeof p === "string" ? { hash: p } : p);

/**
 * How far apart two fingerprints read, in bits. Two pictures of one shape: their hashes, as always.
 * A panel against a full-frame picture: the closest of the two hashes stretched over each other and
 * the panel over each square window of the other — an image model redrawing a picture square keeps
 * either its composition (stretched) or a square part of it (a window). Job 403's cotton-swab panel
 * (scene 15) is scene 11's cut-open toilet again with more floor: 20 bits stretched, 27 at the best
 * window. Job 405's cat panel (scene 9) is scene 2's walking tabby cut square: 32 stretched, 23 at a
 * window (both read off the films' frames). Pure.
 */
export function fingerprintDistance(a: string | PictureFingerprint, b: string | PictureFingerprint): number {
  const [p, q] = [asPrint(a), asPrint(b)];
  const d = hashDistance(p.hash, q.hash);
  if (!!p.square === !!q.square) return d;
  const [panel, wide] = p.square ? [p, q] : [q, p];
  return Math.min(d, ...(wide.windows ?? []).map(w => hashDistance(w, panel.hash)));
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
/**
 * A SPLIT PANEL against a full-frame picture: candidates up to this many bits, the closest
 * `PANEL_CANDIDATES` of them looked at. Across the two shapes the fingerprint can rank but cannot
 * decide: on the frames of the seven practice films of 2026-10-18 (jobs 401-407, 22 panels) the
 * panels' real copies read 20 (job 403 scene 15 against scene 11) and 23 (job 405 scene 9 against
 * scene 2), while different pictures read from 16 up (job 401's card panel against a wall clock in
 * the same study) — at 20 or 22 the cat panel would never have been looked at, and a close-up of a
 * paw (scene 17) read closer than its copy. A panel is a few pictures per video, so it can afford
 * three looks; a full-frame picture keeps the measured 20-bit line, against panels too (on those
 * films that added 10 looks over 148 pictures).
 */
export const PANEL_NEAR_COPY_BITS = 24;
export const PANEL_CANDIDATES = 3;
/**
 * A picture against one it is RELATED to — a picture it was drawn from (a memory reference), or one
 * drawn from the same reference — is a candidate up to this many bits, whatever the two shapes: the
 * picture maker copies the composition of the picture it is handed, so a copy of a relative is far
 * likelier than of any other picture, and the 20-bit line, measured on unrelated pairs, missed the
 * copies of relatives the round-13 review found. On the films' frames: job 409 scene 5 read 22 bits
 * from scene 3, the picture it was drawn from (the same man holding the same card at the same rack);
 * job 408 scene 5 read 24 from scene 4's panel, both drawn from scene 2 (the same bin beside the same
 * toilet, the panel a little closer). A picture has a few relatives, and the looks per draw stay
 * capped (`MAX_CANDIDATES`, `PANEL_CANDIDATES`).
 */
export const RELATED_NEAR_COPY_BITS = 24;

interface Drawn {
  print: PictureFingerprint;
  /** A small JPEG of the picture, for the side-by-side look. */
  thumb: Buffer;
  /** The screen setting it was drawn in, if it is a screen. */
  setup?: string;
  /** The scenes whose pictures it was drawn from (its memory references), if any. */
  sources?: number[];
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

/**
 * The thumbnail a picture is remembered by. A split panel (`square`) keeps the whole square it
 * shows: cut to 16:9 like a full-frame picture, the side-by-side look would see only its middle.
 */
export async function pictureThumb(image: Buffer, square = false): Promise<Buffer> {
  return sharp(image)
    .resize(square ? 360 : 640, 360, { fit: "cover" })
    .jpeg({ quality: 75 })
    .toBuffer();
}

/**
 * The pictures a picture is RELATED to, for `nearCopyCandidates` (round 13, the review of jobs
 * 408-410). Words name one partner at most (`nearCopyPartner` in pictureMemory.ts: the picture it
 * continues, or the one right before it), and the copies the review found were of pictures no words
 * named — the ones they were DRAWN FROM: job 410 scene 20 was scene 3's seat row with the woman taken
 * out, 80 s later, drawn from scene 3 as the beverage cart's memory; job 409 scene 5 was scene 3's man
 * at the card rack again, drawn from it as the aisle's memory; job 408's panel at scene 4 and scene 5
 * were one bathroom shot twice, both drawn from scene 2.
 */
export interface NearCopyRelated {
  /** The scenes whose pictures this one was drawn from (its memory references, `memoryRefScenes`). */
  drawnFrom?: number[];
  /**
   * The side-by-side look a memory picture gets from the same-thing check did not happen on this draw
   * and was owed — it skips a thing kept small beside the subject (`BACKGROUND_VIEW`), and a picture a
   * redraw left with no memory has none to be laid beside (`looksAtClosestRelative` in
   * longformVideo.ts): the CLOSEST related picture is then looked at whatever its distance, the look it
   * did not get. Job 409 scene 5 and job 410 scene 20 were both kept-small pictures, never laid beside
   * anything.
   */
  lookAtClosest?: boolean;
}

type Candidate = { index: number; thumb: Buffer; bits: number; setup?: string };

/**
 * Earlier pictures of this video close enough to `print` to be looked at, closest first (scene
 * index and its thumbnail). A scene is never compared with its own earlier draw.
 *
 * `always`: the scene index of the picture this one continues or is drawn from as the picture just
 * shown (`nearCopyPartner` in pictureMemory.ts) — looked at FIRST, however far apart the
 * fingerprints are. The fingerprint misses exactly those copies: job 403 scene 14, the pipe run
 * under the house again a little closer, read 23 bits from scene 10; job 405 scene 8, the cat on
 * the sleeper again at the same distance, shipped unflagged after its redraw from words.
 *
 * `related` (`NearCopyRelated`): a picture this one was drawn from, or one drawn from the same
 * picture, is a candidate up to `RELATED_NEAR_COPY_BITS`; with `lookAtClosest` and no `always`
 * partner, the closest of them is looked at first however far it reads — the fingerprint decides the
 * partner the words did not name.
 *
 * A split panel (`print.square`) is compared with every earlier picture too — a full-frame one by
 * `fingerprintDistance` up to `PANEL_NEAR_COPY_BITS`, another panel by the ordinary line — and its
 * `PANEL_CANDIDATES` closest are looked at. The looks per draw stay capped however many qualify.
 */
export function nearCopyCandidates(
  jobId: number,
  sceneIndex: number,
  print: string | PictureFingerprint,
  always?: number,
  related: NearCopyRelated = {}
): Candidate[] {
  const p = asPrint(print);
  const from = new Set(related.drawnFrom ?? []);
  const out: Candidate[] = [];
  const kin: Candidate[] = [];
  let partner: Candidate | undefined;
  jobPictures(jobId).forEach((d, index) => {
    if (index === sceneIndex) return;
    const c: Candidate = { index, thumb: d.thumb, bits: fingerprintDistance(d.print, p), setup: d.setup };
    const isKin = from.has(index) || !!d.sources?.some(x => from.has(x));
    if (isKin) kin.push(c);
    const limit = isKin ? RELATED_NEAR_COPY_BITS : p.square && !d.print.square ? PANEL_NEAR_COPY_BITS : NEAR_COPY_BITS;
    if (index === always) partner = c;
    else if (c.bits <= limit) out.push(c);
  });
  const byBits = (a: Candidate, b: Candidate) => a.bits - b.bits;
  if (!partner && related.lookAtClosest) partner = kin.sort(byBits)[0];
  const closest = out.filter(c => c !== partner).sort(byBits);
  return (partner ? [partner, ...closest] : closest).slice(0, p.square ? PANEL_CANDIDATES : MAX_CANDIDATES);
}

/**
 * Remember the picture a scene kept — a split screen's panel under its scene's number — with the
 * scenes it was drawn from (`sources`), so a later picture drawn from one of them is compared with it
 * (`NearCopyRelated`).
 */
export function rememberPicture(
  jobId: number,
  sceneIndex: number,
  print: string | PictureFingerprint,
  thumb: Buffer,
  setup?: string,
  sources?: number[]
): void {
  jobPictures(jobId).set(sceneIndex, { print: asPrint(print), thumb, setup, ...(sources?.length ? { sources } : {}) });
}

/**
 * Remember a picture that SHIPPED without passing the near-copy check — a fallback when the draws ran
 * out, or a frame kept for coming back with the same faults twice. Only a passing picture used to be
 * remembered, so no later picture was ever compared with one of these: job 409 scene 3 spent its
 * draws on near copies and shipped a fallback, and scene 5, drawn from it seven seconds later, came
 * back as the same man at the same card rack with nothing there to compare it with. Never throws: a
 * fingerprint that cannot be taken costs nothing.
 */
export async function rememberShippedPicture(
  jobId: number,
  sceneIndex: number,
  image: Buffer,
  square = false,
  setup?: string,
  sources?: number[]
): Promise<void> {
  try {
    const [print, thumb] = await Promise.all([pictureFingerprint(image, square), pictureThumb(image, square)]);
    rememberPicture(jobId, sceneIndex, print, thumb, setup, sources);
  } catch {
    /* a fingerprint that cannot be taken never costs the picture */
  }
}

/** Redraws a picture gets when it nearly copies another of the same video. */
export const MAX_VARIETY_REDRAWS = 2;

const screenTurns = new Map<string, Promise<unknown>>();
/**
 * Run `fn` after every earlier draw in the same LANE of the same video has finished, so each picture
 * is compared with all the pictures before it in that lane (drawn together, two never see each
 * other). Lanes (`varietyLanes`): "screen" for screen pictures, "thing:<name>" for the pictures of one
 * key thing — Frederick's job 375 test drew three near-identical "smoke alarm held, back label facing
 * viewer" pictures at the same moment — and "from:<scene>" for pictures drawn from the same memory
 * picture. Other pictures stay parallel.
 *
 * A draw may be in SEVERAL lanes (`lane` a list): it waits for the draws before it in every one, and
 * every later draw in any of them waits for it. Never a deadlock: a draw only ever waits for draws
 * queued before it.
 *
 * `maxWaitMs`: wait at most this long for the draws before, then draw anyway — a split panel, which is
 * awaited against its host scene's own clock (`PANEL_LANE_WAIT_MS`). Every later draw in the lane
 * still waits for this one AND every draw before it, so none overtakes a draw it was queued behind.
 */
export function withScreenTurn<T>(
  jobId: number,
  fn: () => Promise<T>,
  lane: string | readonly string[] = "screen",
  maxWaitMs?: number
): Promise<T> {
  const keys = (typeof lane === "string" ? [lane] : lane).filter((l, i, all) => all.indexOf(l) === i).map(l => `${jobId}|${l}`);
  const befores = keys.map(key => screenTurns.get(key) ?? Promise.resolve());
  const before = Promise.all(befores);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const turn =
    maxWaitMs == null
      ? before
      : Promise.race([before, new Promise<void>(r => (timer = setTimeout(r, maxWaitMs)))]).finally(() =>
          clearTimeout(timer)
        );
  const mine = turn.then(fn, fn);
  const done = mine.catch(() => undefined);
  keys.forEach((key, i) => {
    const settled = Promise.all([befores[i], done]).then(() => undefined);
    screenTurns.set(key, settled);
    void settled.then(() => {
      if (screenTurns.get(key) === settled) screenTurns.delete(key);
    });
  });
  return mine;
}

/**
 * The longest a split panel waits for the draws before it in its lane (`withScreenTurn`). Panels never
 * waited in a lane: one is awaited against its host scene's own clock (`server/splitPanel.ts`), and
 * queued behind every picture of its thing — each up to several minutes — it would ship its scene as
 * the host take alone. So it never saw a picture drawn from the same memory at the same moment: job
 * 408's panel at scene 4 and scene 5, both drawn from scene 2 once it was made, came back as one
 * bathroom shot twice. Three minutes lets the draw in front of it — one image and its checks, about
 * one to two minutes — finish and be remembered, and costs the host clock (25 min, less 3 for the
 * composite) at most that.
 */
export const PANEL_LANE_WAIT_MS = 3 * 60_000;

/**
 * The lanes a picture is drawn in (`withScreenTurn`), none for a picture drawn in parallel. A screen
 * is drawn in the screen lane. Any other picture of a key thing is drawn in its thing's lane, AND — drawn
 * from memory — in the lane of the picture its memory starts from (the earliest of its references of
 * its OWN thing, else the earliest of them), so pictures drawn from the same memory are drawn one after
 * another and each is compared with the others: job 408's toilet panel at scene 4 and its bin at scene
 * 5, two key things, were both drawn from scene 2 and drawn at once, in two lanes.
 * BOTH, NEVER ONE FOR THE OTHER (round 13, the review of that fix): the pictures of one key thing do not
 * all start from one picture — job 408's toilet pictures were drawn from scenes 2, 8, 14 and 15 — so a
 * memory lane in place of the thing's lane let two pictures of the toilet be drawn at once again
 * (scene 21, drawn from scene 8's toilet paper, beside scenes 10, 14 and 15, drawn from scene 2). On
 * jobs 401-414 the extra lane lengthens a film's longest chain of draws by three at most (job 412: 12 to
 * 15), since each picture of a thing already waits for the one before it (`memoryFor`). Pure.
 */
export function varietyLanes(scene: Pick<StoryboardScene, "screenSetup" | "keyThing" | "memoryRefScenes">): string[] {
  if (scene.screenSetup) return ["screen"];
  const lanes: string[] = [];
  const thing = scene.keyThing?.trim().toLowerCase();
  if (thing) lanes.push(`thing:${thing}`);
  const refs = scene.memoryRefScenes ?? [];
  const own = refs.filter(r => r.own);
  const root = (own.length ? own : refs).map(r => r.index).sort((a, b) => a - b)[0];
  if (root != null) lanes.push(`from:${root}`);
  return lanes;
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
 * The bare cameras (`REDRAW_CAMERAS`, one per `OTHER_VIEWS` entry, in the same order) are also the
 * camera a same-topic continuation is drawn from (`memoryViewFor` in pictureMemory.ts).
 */
export const REDRAW_CAMERAS = [
  "a close-up of one small detail of the subject filling the frame",
  "seen from much further back, the whole place around it and the subject small in it",
  "seen from the other side, from low down",
] as const;
export const REDRAW_VIEWS = REDRAW_CAMERAS.map(c => `Camera for THIS picture: ${c}.`);

/** The redraw clause for the k-th redraw (0-based). Pure. */
export function differentPictureClause(k: number): string {
  return `${DIFFERENT_PICTURE_CLAUSE} ${REDRAW_VIEWS[k % REDRAW_VIEWS.length]} Never the reference picture's framing.`;
}

/** Where the camera that shrinks the subject ("seen from much further back …") is in `REDRAW_CAMERAS`. */
export const FAR_CAMERA = 1;

/**
 * The camera the `k`-th near-copy redraw (1-based) of a picture is drawn from, as an index into
 * `REDRAW_CAMERAS`: in turn from the one after `own` (the camera a continuation was drawn from, -1 for
 * any other picture), never `own` itself — and never the far camera when `small`: a picture of one
 * small thing, or one its own words frame close (`smallSubject` in pictureMemory.ts).
 * THE FAR CAMERA ERASES A SMALL SUBJECT (job 408 scene 16): the split panel "close view of a single
 * white cotton swab … on pale beige tile floor" was a near copy twice, and its second redraw was told
 * "seen from much further back, the whole place around it and the subject small in it" — the swab came
 * back a 30 px speck on a wide bathroom floor and shipped "subject missing". Any other picture keeps
 * the turn it always had (`own` + k). Pure.
 */
export function nearCopyCameraIndex(k: number, own: number, small: boolean): number {
  const n = REDRAW_CAMERAS.length;
  const turn = Array.from({ length: n }, (_, i) => (own + 1 + i + n) % n).filter(
    c => c !== own && !(small && c === FAR_CAMERA)
  );
  return turn[(Math.max(1, k) - 1) % turn.length];
}

/**
 * `prompt` with the far camera (`REDRAW_VIEWS[FAR_CAMERA]`, written the same way by a near-copy redraw
 * and by a continuation drawn from words) swapped for camera `instead`: a redraw for a subject the
 * check could not find never keeps the camera that made it small (job 408 scene 16: after the
 * near-copy redraws, the "missing" redraw only changed the seed, kept "the subject small in it", and
 * came back missing again). Unchanged when there is none. Pure.
 */
export function withoutFarCamera(prompt: string, instead: number): string {
  return prompt.split(REDRAW_VIEWS[FAR_CAMERA]).join(REDRAW_VIEWS[instead]);
}

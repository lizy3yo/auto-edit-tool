/**
 * server/overlayTextScan.ts
 *
 * Pre-render DEFECT gate for long-form b-roll stills: ONE vision call, three narrow verdicts.
 *
 * 1. OVERLAY TEXT — every b-roll prompt already bans stamped-on text (`NO_OVERLAY_TEXT_SUFFIX`)
 *    and gpt-image-2 stamps captions/titles/watermarks anyway. The judgement is narrow on
 *    purpose: text STAMPED OVER the frame, told apart from writing IN the scene (question 3).
 *
 * 2. BROKEN GEOMETRY — the still lane's other stochastic failure: objects floating unsupported,
 *    surfaces whose edges disagree with each other, structures merging into one another, rigid
 *    things bent like wax. A split-screen RIGHT PANEL is where this hurts most — it sits
 *    full-height beside a real face for the whole beat — but the same frame becomes a Ken Burns
 *    still or a grok keyframe, so the gate runs at the shared choke point for all of them.
 *    Deliberately MACRO-scale only: at scan resolution fine detail (garbled lettering, warped
 *    hands) is gone, so the brief asks about structure a thumbnail still shows, and the judge is
 *    told to pass anything it isn't sure about.
 *
 * 3. READABLE WRITING in the scene — chalkboard sums, price tags, signs, big labels. The b-roll
 *    prompts used to ALLOW real-world text and the model wrote the narration onto chalkboards
 *    ("$93/hour" under the line that said it). They now ban it (`NO_READABLE_TEXT`); this catches
 *    the renders that ignore that. Tiny or unreadable marks pass.
 *
 * `generateValidatedStill` is the single choke point for every b-roll pixel (the still lane's
 * Ken Burns source, the split right panel, AND the motion lane's grok keyframe), so a defective
 * frame is caught there and re-rolled on a fresh seed before it costs a 30-180s video render
 * that would have inherited it.
 *
 * This GATES: a true verdict re-rolls the still, so it is on the critical path for every b-roll
 * image. It is also the pipeline's ONLY automated look at what a b-roll frame actually contains —
 * nothing inspects the finished render.
 *
 * ponytail: one image, one call, two bits — no severity, no location; a re-roll is the only
 * thing the caller can do with either answer. NEVER THROWS: a dead check returns all-false and
 * the still ships. Blocking a render on a QC call that can 529 is not worth it — but note that a
 * dead check is now silent apart from the warn below, so watch for `[StillDefects] check failed`
 * in bulk.
 */
import sharp from "sharp";
import { invokeClaude, type ClaudeImage } from "./claude";
import { safeParseJSON } from "./jsonRepair";

/**
 * Haiku, and the reason is latency as much as cost: `invokeClaude` sends NO `thinking` param on
 * its non-thinking branch (claude.ts:256), and on sonnet-5 an omitted `thinking` runs ADAPTIVE
 * THINKING — seconds of reasoning per b-roll image, on the critical path, for a yes/no. Haiku 4.5
 * predates adaptive thinking, so the same call is a plain fast completion with zero changes to
 * claude.ts.
 * ponytail: upgrade path is a `thinking: {type:"disabled"}` field on ClaudeParams + sonnet — do
 * that only if review shows haiku confusing a stamped caption for a product label.
 */
const STILL_DEFECT_MODEL = "claude-haiku-4-5-20251001";

/**
 * Downscale before the call. Vision tokens are ~(w*h)/750, so at gpt-image-2's native 1280x720
 * (~1230 tok) the PIXELS are ~72% of this call's cost — the prompt is not where the money is.
 * 768x432 is ~442 (a square split panel resizes inside the same box).
 * ponytail: this is the floor for reading a caption or seeing a floating object, not for fine
 * detail. If a check ever needs warped hands or garbled lettering, raise this — don't drop the
 * resize; the geometry brief below is macro-scale BECAUSE of this resolution.
 */
const DEFECT_SCAN_WIDTH = 768;
const DEFECT_SCAN_HEIGHT = 432;

/** The judge's brief. A module constant so it reads as one block. */
const STILL_DEFECT_SYSTEM =
  "You are a quality-control reviewer for AI-generated b-roll photography. You are shown ONE " +
  "still frame. Answer three independent questions.\n\n" +
  "QUESTION 1 — overlay: is any text STAMPED OVER this frame, as if it were added afterwards " +
  "in a video editor?\n" +
  "Answer true ONLY for text that is not physically part of the photographed scene:\n" +
  "- captions, subtitles, or lower-third bars\n" +
  "- titles, headlines, or large words laid across the shot\n" +
  "- watermarks, channel logos, corner bugs, or signatures\n" +
  "- timestamps, counters, or camera-UI text burned into the frame\n" +
  "- callout labels, arrows, or meme-style text\n" +
  "Answer false for text that is REAL and physically in the scene — that is question 3's, not " +
  "this one's: printing on product labels, packaging, jars, bottles, bags, boxes, or seed packets; " +
  "signage, posters, or notices that exist in the location; words on a book cover, a screen, a " +
  "tag, or handwriting on paper.\n" +
  "The test is WHERE the text sits, not what it says. Text lying on a surface in the scene — " +
  "following that surface's angle, blurred where the surface is out of focus, lit by the " +
  "scene's own light — is real: answer false. Text that floats flat and crisp on top of the " +
  "picture, square to the frame edges, ignoring the scene's perspective, focus, and lighting, " +
  "was stamped on: answer true.\n" +
  "Never judge spelling or language: misspelled, gibberish, or foreign lettering on a real " +
  "label is still real label text — answer false. A frame with no text at all is false.\n\n" +
  "QUESTION 2 — broken: does the frame contain OBVIOUSLY IMPOSSIBLE physical structure that an " +
  "ordinary viewer would notice at a glance?\n" +
  "Answer true ONLY for clear, large-scale breakage:\n" +
  "- an object floating in midair, resting on nothing, or detached from its support\n" +
  "- a surface or edge (table, shelf, wall, counter) that changes direction, splits, or fails " +
  "to line up with itself across the frame\n" +
  "- two objects merging into each other, or an object growing out of a surface\n" +
  "- a rigid object that is bent, melted, or warped as if made of wax\n" +
  "- structure that cannot exist: stairs to nowhere, a handle attached to nothing, a shadow " +
  "or reflection that contradicts the object casting it\n" +
  "- a tool doing something no real tool can: a blade passing through a clamp, a hand or a " +
  "solid object; a saw or knife said to be cutting that sits on top of the material or cuts " +
  "where it does not touch; a needle through a finger; scissors cutting where the blades do not " +
  "meet; a tool held in a way no hand could hold it; a hand with too many or too few fingers\n" +
  "Answer false for everything else: unusual but possible products or craftsmanship, odd " +
  "compositions, shallow depth of field, soft focus, plain or boring frames, imperfect " +
  "staging, and any small detail you cannot clearly resolve at this size. This is AI-generated " +
  "photography — mild strangeness is normal and ships; only unmistakable physical impossibility " +
  "fails. When unsure, answer false.\n\n" +
  "QUESTION 3 — writing: is there READABLE writing physically IN the scene that a viewer would " +
  "read at a glance?\n" +
  "Answer true for words, numbers, prices, or sums a viewer can make out: writing on a " +
  "chalkboard or whiteboard, a sign, a poster, a price tag, a note or receipt, a screen, a " +
  "slogan on a mug or shirt, or a brand name or label printed large on a can, bottle, box, or " +
  "tool — and tally marks, sums or sketches drawn on a chalkboard, whiteboard or wall. Answer " +
  "false for tiny, blurred, or unreadable marks, a ruler's or tape's scale " +
  "markings, and a frame with no writing. Question 1's stamped-over text is NOT counted here. " +
  "When unsure, answer false.\n\n" +
  'Return ONLY this JSON, no prose: {"overlay":true|false,"broken":true|false,"writing":true|false,"what":"..."}\n' +
  'what: 3-8 words naming the worst defect and where it sits (e.g. "white caption bar across ' +
  'the bottom", "cutting board floating above the table"); "" when both are false.';

export interface StillDefectVerdict {
  overlay: boolean;
  broken: boolean;
  /** Readable writing IN the scene (a chalkboard sum, a price tag, a big label). Every b-roll
   *  prompt bans it (`NO_READABLE_TEXT`); a true verdict re-rolls the still like `overlay`. */
  writing: boolean;
  /**
   * The frame does not show the thing its line names (`scene.showSubject`) — "a stack of
   * sandpaper" drawn as a sanding block, or not there at all. Only asked when the caller passes
   * what the frame must show; re-rolls the still like `writing`.
   */
  missing: boolean;
  /** A legible brand name or logo, or a subject lost in busy unrelated clutter (rule 4). */
  messy: boolean;
  /** The line names a place (a market, a fair, a church hall) and the frame is clearly somewhere
   *  else (rule 3). Only asked when the caller passes the line. */
  wrongPlace: boolean;
  what: string;
}

const CLEAN_VERDICT: StillDefectVerdict = {
  overlay: false,
  broken: false,
  writing: false,
  missing: false,
  messy: false,
  wrongPlace: false,
  what: "",
};

/**
 * Parse the verdict. Anything off-shape reads as "no defect" — a re-roll costs an image and
 * possibly a grok render, so an unparseable answer must not trigger one. Each bit is typed
 * independently: a verdict carrying only one boolean still counts for that bit.
 *
 * Pure — unit-tested.
 */
export function parseStillDefectVerdict(
  raw: string,
  stopReason?: string
): StillDefectVerdict {
  const parsed = safeParseJSON<any>(raw, stopReason);
  if (!parsed.success) return { ...CLEAN_VERDICT };
  const overlay = parsed.data?.overlay === true;
  const broken = parsed.data?.broken === true;
  const writing = parsed.data?.writing === true;
  const missing = parsed.data?.missing === true;
  const messy = parsed.data?.messy === true;
  const wrongPlace = parsed.data?.wrong_place === true;
  const what = parsed.data?.what;
  return {
    overlay,
    broken,
    writing,
    missing,
    messy,
    wrongPlace,
    what:
      (overlay || broken || writing || missing || messy || wrongPlace) &&
      typeof what === "string"
        ? what.slice(0, 80)
        : "",
  };
}

/**
 * Back-compat shape of the original overlay-only parser — same behaviour on every old input.
 * Pure — unit-tested.
 */
export function parseOverlayVerdict(
  raw: string,
  stopReason?: string
): { overlay: boolean; what: string } {
  const v = parseStillDefectVerdict(raw, stopReason);
  return { overlay: v.overlay, what: v.overlay ? v.what : "" };
}

/**
 * Scan one still for both defect classes in a single vision call. Fails open (all-false) on any
 * error.
 *
 * Takes no mimeType: sharp sniffs the input format from the bytes and always re-encodes png, so
 * the media_type below cannot drift from what is actually sent. That drift was a real bug —
 * declaring jpeg over gpt-image-2's png 400s, which fails open and ships the defect SILENTLY.
 */
/** QUESTION 4, asked only when the caller knows what the frame must show. */
export function missingQuestion(expect: string): string {
  return (
    "\n\nQUESTION 4 — missing: this frame plays while the narrator names: " +
    `"${expect.replace(/"/g, "'")}". Is that thing clearly NOT the centre of attention — a ` +
    "different object in its place, absent altogether, or there but small, pushed to an edge, or " +
    "outweighed by something else that takes most of the frame? Answer false when it is the main " +
    "thing the eye lands on, even from an unusual angle. When unsure, answer false."
  );
}

/** QUESTION 5, always asked: the clean-frame rule every b-roll prompt carries (`CLEAN_FRAME_RULE`). */
export const MESSY_QUESTION =
  "\n\nQUESTION 5 — messy: is a real brand name or logo legible anywhere (even small, on a tool " +
  "or product), OR is the main subject small, crowded or lost among busy unrelated objects so a " +
  "viewer cannot tell what the shot is about at a glance? A heap or stack of the very material the " +
  "shot is about (fabric scraps, yarn, lumber offcuts) IS the subject, not clutter. When unsure, " +
  "answer false.";

/** QUESTION 6, asked only with the narration line: the frame is set where the line says. */
export function placeQuestion(line: string): string {
  return (
    "\n\nQUESTION 6 — wrong_place: this frame plays under the narration line: " +
    `"${line.replace(/"/g, "'").slice(0, 400)}". ONLY about the SETTING, never which object is ` +
    "shown. If the line names a specific kind of PLACE where something is used, sold or comes " +
    "from — a home or a room in one, a market stall or fair, a church or hall, a store, a porch " +
    "or patio, a garden or field, a hospital, a particular country's buildings — is the frame " +
    "clearly somewhere else, or showing that place only as a picture or poster on a wall? A " +
    "workshop, garage, shed, sewing room, kitchen table or work bench all count as the same home " +
    "base and never make it wrong. If the line names no such place, or you are unsure, answer false."
  );
}

/** The JSON shape, listing every question asked. */
export function verdictShape(expect?: string, line?: string): string {
  return (
    '\n\nReturn ONLY this JSON, no prose: {"overlay":true|false,"broken":true|false,' +
    '"writing":true|false' +
    (expect ? ',"missing":true|false' : "") +
    ',"messy":true|false' +
    (line ? ',"wrong_place":true|false' : "") +
    ',"what":"..."}'
  );
}

export async function scanStillDefects(
  buffer: Buffer,
  /** What the frame must show (`scene.showSubject`) — adds the `missing` question. */
  expect?: string,
  /** The narration line the frame plays under — adds the `wrong_place` question. */
  line?: string
): Promise<StillDefectVerdict> {
  try {
    const small = await sharp(buffer)
      .resize(DEFECT_SCAN_WIDTH, DEFECT_SCAN_HEIGHT, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const image: ClaudeImage = {
      base64: small.toString("base64"),
      mediaType: "image/png",
    };
    const result = await invokeClaude({
      systemPrompt:
        STILL_DEFECT_SYSTEM +
        (expect ? missingQuestion(expect) : "") +
        MESSY_QUESTION +
        (line ? placeQuestion(line) : "") +
        verdictShape(expect, line),
      userMessage:
        "Is any text stamped over this frame, does it contain obviously impossible structure, " +
        "is there readable writing in the scene, and is it messy or branded?" +
        (expect ? ` Does it show "${expect.replace(/"/g, "'")}"?` : "") +
        (line ? " Is it set where the line says?" : ""),
      imageInput: image,
      maxTokens: 250,
      model: STILL_DEFECT_MODEL,
    });
    const verdict = parseStillDefectVerdict(result.text, result.stopReason);
    if (!expect) verdict.missing = false;
    if (!line) verdict.wrongPlace = false;
    if (
      verdict.overlay ||
      verdict.broken ||
      verdict.writing ||
      verdict.missing ||
      verdict.messy ||
      verdict.wrongPlace
    )
      console.log(
        `[StillDefects] ${verdict.overlay ? "stamped text" : verdict.broken ? "broken geometry" : verdict.writing ? "readable writing" : verdict.missing ? "named thing missing" : verdict.messy ? "brand or clutter" : "wrong place"} detected: ${verdict.what}`
      );
    return verdict;
  } catch (err: any) {
    // Fail open — a QC check must never cost a render. Nothing catches it downstream, so this
    // warn is the only trace; a defective still ships.
    console.warn(
      `[StillDefects] check failed: ${err.message} — passing the still`
    );
    return { ...CLEAN_VERDICT };
  }
}

/** True when the still has text stamped over it. Fails open (false) on any error. */
export async function hasOverlayText(buffer: Buffer): Promise<boolean> {
  return (await scanStillDefects(buffer)).overlay;
}

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
export const STILL_DEFECT_SYSTEM =
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
  "where it does not touch; a drill bit or screw said to be going in that is not in the material; " +
  "a hand tool (a drill, saw, iron, hair dryer) posed as if in use — held up or pressed to the " +
  "work — with no hand holding it; " +
  "a needle through a finger; scissors cutting where the blades do not " +
  "meet; a tool held in a way no hand could hold it; a hand with too many or too few fingers\n" +
  "- a hand, finger or arm inside, through, behind or merged into a vise, clamp, machine or tool " +
  "body (a hand in a vise's jaws)\n" +
  "- a tool held or angled in a way no real user holds it, or whose path runs into the table, the " +
  "bench or a hand; fingers in front of or right beside a blade, saw, bit or cutting edge\n" +
  "- a phone, tablet or laptop built into, framed by or made of another object (a tablet whose " +
  "frame is a cutting board, a screen set inside a quilt or a shelf)\n" +
  "- a body part that looks CUT OFF: hair still shaped like a head or hairstyle with no head " +
  "inside it, or a hand, foot or face on its own, lying on a surface, floating or hanging from " +
  "nothing (a few loose strands in a brush, comb or drain are fine; so is a wig on a mannequin " +
  "head or stand)\n" +
  "- something worn on the wrong side of the body (a headlamp or glasses on the back of the " +
  "head, an apron tied on the back)\n" +
  "- a head turned further round than a neck can turn, or facing a different way from the " +
  "shoulders; more than two arms or hands on one person\n" +
  "- a mirror that does not reflect what is in front of it\n" +
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
  "tool, or a date, model number or printed label on a product that a viewer can read — and " +
  "tally marks, sums or sketches drawn on a chalkboard, whiteboard or wall. Answer " +
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
  /** Reads as a styled, staged or AI-rendered image rather than an ordinary phone photo (the
   *  operator's 2026-09-28 call: "the b-rolls still don't look like someone shot them on an iPhone").
   *  Re-rolls once, like `messy`. */
  staged: boolean;
  /**
   * The check could not run, on either model (2026-10-02, Frederick's job 335: the checker that
   * had just refused the night-fire picture failed on the redraw, and a failed check passed it).
   * The caller draws once more rather than counting this as a pass.
   */
  unchecked?: boolean;
  what: string;
}

const CLEAN_VERDICT: StillDefectVerdict = {
  overlay: false,
  broken: false,
  writing: false,
  missing: false,
  messy: false,
  wrongPlace: false,
  staged: false,
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
  const staged = parsed.data?.staged === true;
  const what = parsed.data?.what;
  return {
    overlay,
    broken,
    writing,
    missing,
    messy,
    wrongPlace,
    staged,
    what:
      (overlay || broken || writing || missing || messy || wrongPlace || staged) &&
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
    "outweighed by something else that takes most of the frame? When it names a SPECIFIC kind, " +
    "pattern or design (a herringbone path, a dovetail joint, a French seam), " +
    "that exact kind must be recognisable — a generic version (a plain checkered or random " +
    "brick path for a herringbone one) counts as missing. Answer false when it is the main " +
    "thing the eye lands on, even from an unusual angle. When unsure, answer false."
  );
}

/** The stronger checker a picture with an exact look is judged by (`scanStillDefects`' `exactLook`). */
const EXACT_LOOK_MODEL = () => process.env.EXACT_LOOK_MODEL || "claude-sonnet-5-5";

/**
 * QUESTION 4 sharpened for a picture of a NAMED KIND (`scene.namedLook`): the thing must be drawn
 * the way its exact look describes — shapes, counts, arrangement — not a generic or different one.
 */
export function exactLookQuestion(look: string): string {
  return (
    "\n\nQUESTION 4, SHARPER FOR THIS PICTURE — missing: the frame must show this named kind exactly: " +
    `"${look.replace(/"/g, "'").slice(0, 600)}". Answer true if it is not clearly there as the main ` +
    "thing, OR if what is drawn does not match that look (other shapes, another arrangement, a " +
    "generic or different pattern), OR if the frame mostly shows something bigger it belongs to " +
    "instead of the thing itself up close. Answer false only when it clearly matches. That look " +
    "is how the kind looks IN GENERAL: when the narrator's words above name a particular part, " +
    "page or screen of it, a stage of the work, or something done or added to it, the frame must " +
    "show THAT, in this look's colours and style — never answer true only because the frame is " +
    "not the general view the look describes."
  );
}

/**
 * QUESTION 4 for a picture whose printing is shown soft on purpose (`scene.blurPrint`): the label,
 * date or engraving the line talks about is drawn too soft to read, and that IS it being shown —
 * Dale's job 344 failed an engraved board twice for "no visible engraving" the no-writing rule had
 * told the picture maker to keep unreadable.
 */
export const SOFT_PRINT_QUESTION =
  "\n\nQUESTION 4 NOTE — printing, a label, a date or an engraving on the named thing is drawn " +
  "SOFT on purpose in this picture: a blurred patch of print, or shallow carved lines too soft " +
  "to read, counts as that printing or engraving being shown. Never answer missing because its " +
  "words cannot be read. Answer missing only when there is no sign of it at all.";

/**
 * QUESTION 4 widened for a picture about KEY THINGS: every one of them must really be there, and a
 * different object drawn in one's place counts as missing.
 */
export function requiredThingsQuestion(things: string[]): string {
  const list = things.map(t => `"${t.replace(/"/g, "'")}"`).join(", ");
  return (
    "\n\nQUESTION 4, ALSO FOR THIS PICTURE — missing: each of these must be clearly in the frame: " +
    `${list}. Answer true if any of them is absent, or if a different object stands where it should ` +
    "be (a small box where a bookcase was asked for, a bowl where a quilt was), or if it is so small " +
    "or hidden that a viewer would not notice it."
  );
}

/** QUESTION 5, always asked: the clean-frame rule every b-roll prompt carries (`CLEAN_FRAME_RULE`). */
export const MESSY_QUESTION =
  "\n\nQUESTION 5 — messy: is a real brand name or logo legible anywhere (even small, on a tool " +
  "or product), OR is the main subject small, crowded or lost among busy unrelated objects so a " +
  "viewer cannot tell what the shot is about at a glance? A heap or stack of the very material the " +
  "shot is about (fabric scraps, yarn, lumber offcuts) IS the subject, not clutter, and a real, " +
  "used room with a few everyday things at the edges is fine — the shots are meant to look like " +
  "a person's own phone photos. When unsure, answer false.";

/**
 * What "staged" means, for the picture check AND the practice-film audit (one wording, so the two
 * cannot disagree): HOW the photo was taken — its light and its finish — never WHAT is in it.
 *
 * It used to count "props neatly arranged around the subject" and "a perfectly composed product
 * close-up" too, and on Dale's job 345 that was named 27 times: stacks of boards and coasters on a
 * workbench in plain daylight, under lines about pieces being stacked and sorted. What is in a
 * picture and how it is laid out comes from the script and is held by the other questions
 * (missing, wrong place); judged here as well, a tidy subject failed for being what the line asked
 * for — a quilt folded, tools laid out, hair styled would all do the same on their channels. And
 * the redraw did not change it: 7 of the 9 pictures came back "staged" again.
 */
export const STAGED_RULE =
  "would a viewer take this for a styled or AI-rendered image rather than an ordinary photo " +
  "someone took on their phone, judging ONLY its light and its finish? Say true for: a glowing " +
  "lamp, candle or golden glow lighting the scene, dramatic or moody light with dark corners, or " +
  "a glossy, polished advertising finish. NEVER say true because of what is in the picture or " +
  "how it is arranged: things that are neat, sorted, stacked, lined up, laid out or displayed " +
  "are what the script asked for, and close framing on the subject is asked for too. Plain " +
  "daylight, an ordinary used room and casual framing are false. When unsure, answer false.";

/** QUESTION 7, always asked: an ordinary phone photo, not a styled or AI-looking render. */
export const STAGED_QUESTION = `\n\nQUESTION 7 — staged: ${STAGED_RULE}`;

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
    ',"staged":true|false' +
    ',"what":"..."}'
  );
}

/**
 * QUESTION 3 changed for a picture ALLOWED one piece of writing (`scene.pictureText`, spoken in its
 * line): the writing verdict is then "anything else readable, or the allowed words missing or not
 * spelled exactly" — so a picture shows the script's words, accurately, or is drawn again.
 */
export function allowedTextQuestion(text: string): string {
  return (
    "\n\nQUESTION 3 CHANGED FOR THIS PICTURE — writing: this picture is ALLOWED exactly one piece of " +
    `readable writing: "${text.replace(/"/g, "'")}". Answer true if ANY other writing a viewer can ` +
    `read appears, OR if "${text.replace(/"/g, "'")}" is missing or not spelled exactly like that. ` +
    "Answer false only when it is there, spelled exactly, and nothing else is readable. Judge " +
    "spelling here."
  );
}

export async function scanStillDefects(
  buffer: Buffer,
  /** What the frame must show (`scene.showSubject`) — adds the `missing` question. */
  expect?: string,
  /** The narration line the frame plays under — adds the `wrong_place` question. */
  line?: string,
  /** The only writing the picture may show (`scene.pictureText`) — judged for exact spelling. */
  allowedText?: string,
  /**
   * The exact look of the named kind the picture shows (`scene.namedLook`): the `missing` question
   * holds the frame to it, judged on the larger frame by a stronger model — the quick checker
   * passed three quilt pictures that showed none of the blocks they named (Ruth's job 281).
   */
  exactLook?: string,
  /**
   * The key things the picture is about: each must really be there, not swapped for something
   * else (a box drawn where a bookcase was asked for). Judged by the stronger checker.
   */
  required?: string[],
  /** The picture's printing is shown soft on purpose (`scene.blurPrint`) — `SOFT_PRINT_QUESTION`. */
  softPrint?: boolean
): Promise<StillDefectVerdict> {
  try {
    const mustShow = expect && required?.length ? required : undefined;
    // Spelling and a named pattern need the larger frame.
    const [w, h] = allowedText || exactLook ? [1280, 720] : [DEFECT_SCAN_WIDTH, DEFECT_SCAN_HEIGHT];
    const small = await sharp(buffer)
      .resize(w, h, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    const image: ClaudeImage = {
      base64: small.toString("base64"),
      mediaType: "image/png",
    };
    const carefulThinks = process.env.CAREFUL_CHECK_THINKING === "1";
    const ask = (model: string) => invokeClaude({
      // The rulebook is the same on every check and is cached; the questions about THIS picture
      // follow it uncached, in the same order — glued together, every check re-paid the cache.
      // The two questions asked of EVERY picture ride in the cached part with the rulebook.
      systemPrompt: STILL_DEFECT_SYSTEM + MESSY_QUESTION + STAGED_QUESTION,
      systemSuffix:
        (expect ? missingQuestion(expect) : "") +
        (expect && exactLook ? exactLookQuestion(exactLook) : "") +
        (mustShow ? requiredThingsQuestion(mustShow) : "") +
        (expect && softPrint ? SOFT_PRINT_QUESTION : "") +
        (line ? placeQuestion(line) : "") +
        (allowedText ? allowedTextQuestion(allowedText) : "") +
        verdictShape(expect, line),
      userMessage:
        "Is any text stamped over this frame, does it contain obviously impossible structure, " +
        "is there readable writing in the scene, and is it messy or branded?" +
        (expect ? ` Does it show "${expect.replace(/"/g, "'")}"?` : "") +
        (line ? " Is it set where the line says?" : "") +
        " Does it look like an ordinary phone photo?",
      imageInput: image,
      // The verdict is ~40 tokens. The careful model THINKS unless told not to, and thinking
      // counts against this cap: on job 338 it used the whole 250 on 14 of 61 checks and wrote no
      // verdict, so the check was paid for and then redone on the quick model — the picture that
      // needed the careful check got the quick one. `CAREFUL_CHECK_THINKING=1` gives it its
      // thinking back, with room to finish.
      maxTokens: carefulThinks && model !== STILL_DEFECT_MODEL ? 1500 : 250,
      model,
      ...(carefulThinks ? {} : { thinking: "off" as const }),
      step: model === STILL_DEFECT_MODEL ? "Picture check (quick)" : "Picture check (careful)",
    });
    // A failed call is asked once more on the other checker before it counts as unchecked.
    const first = exactLook || mustShow ? EXACT_LOOK_MODEL() : STILL_DEFECT_MODEL;
    const second = first === STILL_DEFECT_MODEL ? EXACT_LOOK_MODEL() : STILL_DEFECT_MODEL;
    let result: Awaited<ReturnType<typeof invokeClaude>>;
    try {
      result = await ask(first);
    } catch (err: any) {
      console.warn(`[StillDefects] check failed on ${first}: ${err.message} — asking ${second}`);
      result = await ask(second);
    }
    const verdict = parseStillDefectVerdict(result.text, result.stopReason);
    if (!expect) verdict.missing = false;
    if (!line) verdict.wrongPlace = false;
    if (
      verdict.overlay ||
      verdict.broken ||
      verdict.writing ||
      verdict.missing ||
      verdict.messy ||
      verdict.wrongPlace ||
      verdict.staged
    )
      console.log(
        `[StillDefects] ${verdict.overlay ? "stamped text" : verdict.broken ? "broken geometry" : verdict.writing ? "readable writing" : verdict.missing ? "named thing missing" : verdict.messy ? "brand or clutter" : verdict.wrongPlace ? "wrong place" : "staged look"} detected: ${verdict.what}`
      );
    return verdict;
  } catch (err: any) {
    // Fail open — a QC check must never cost a render. Nothing catches it downstream, so this
    // warn is the only trace; a defective still ships.
    console.warn(
      `[StillDefects] check failed: ${err.message} — the still is unchecked`
    );
    return { ...CLEAN_VERDICT, unchecked: true };
  }
}

/** True when the still has text stamped over it. Fails open (false) on any error. */
export async function hasOverlayText(buffer: Buffer): Promise<boolean> {
  return (await scanStillDefects(buffer)).overlay;
}

// ─── The same thing, from another angle (picture memory) ─────────────────────────────

/**
 * Sonnet: telling one heater from a similar heater at another angle is a fine judgement, and it
 * runs only on pictures of a key thing that already has a memory — a handful per film.
 */
const SAME_THING_MODEL = () => process.env.SAME_THING_MODEL || "claude-sonnet-5";

export const SAME_THING_SYSTEM =
  "You compare two photos. LEFT: an earlier photo of a thing. RIGHT: a new photo that must show " +
  "the SAME thing — the very same object, not just the same kind — usually from another spot, " +
  "closer, further back or at a later stage of being made. A different camera position, distance, " +
  "crop or light is fine, and so is the piece being further along. What is NOT fine: a different " +
  "shape, colour, material, size or design, or a different object of the same kind.\n" +
  "copy: true when the RIGHT photo is taken from nearly the same spot, distance and framing as the " +
  "LEFT — a near-copy of it rather than a new view.\n" +
  'Return ONLY JSON: {"same":true|false,"copy":true|false,"what":"<what differs, a few words, or empty>"}';

/** Decide from the model's answer; anything unreadable passes (a check never costs a render). Pure. */
export function parseSameThingVerdict(
  raw: string,
  stopReason?: string
): { same: boolean; copy: boolean; what: string } {
  const m = /\{[\s\S]*\}/.exec(raw ?? "");
  if (!m || stopReason === "max_tokens") return { same: true, copy: false, what: "" };
  try {
    const d = JSON.parse(m[0]);
    const same = d?.same !== false;
    const copy = same && d?.copy === true;
    return {
      same,
      copy,
      what: !same ? String(d?.what ?? "a different one").slice(0, 80) : copy ? "the same framing" : "",
    };
  } catch {
    return { same: true, copy: false, what: "" };
  }
}

/**
 * Is the `thing` in the new picture the same one as in its memory picture (`memoryUrl`)? The two are
 * laid SIDE BY SIDE, memory on the left. Never throws: a dead check passes the picture.
 */
export async function scanSameThing(
  memoryUrl: string,
  buffer: Buffer,
  thing: string
): Promise<{ same: boolean; copy: boolean; what: string }> {
  try {
    const { presignOwnBucketUrl } = await import("./storage");
    const res = await fetch(await presignOwnBucketUrl(memoryUrl), {
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`memory picture ${res.status}`);
    const side = (b: Buffer) =>
      sharp(b).resize(640, 360, { fit: "cover" }).png().toBuffer();
    const [left, right] = await Promise.all([
      side(Buffer.from(await res.arrayBuffer())),
      side(buffer),
    ]);
    const pair = await sharp({
      create: { width: 1280, height: 360, channels: 3, background: "#000" },
    })
      .composite([
        { input: left, left: 0, top: 0 },
        { input: right, left: 640, top: 0 },
      ])
      .png()
      .toBuffer();
    const result = await invokeClaude({
      systemPrompt: SAME_THING_SYSTEM,
      userMessage: `The thing: ${thing.replace(/"/g, "'").slice(0, 120)}. Is it the same one on the right, and is the right a new view of it or a near-copy?`,
      imageInput: { base64: pair.toString("base64"), mediaType: "image/png" },
      maxTokens: 200,
      model: SAME_THING_MODEL(),
      thinking: "off",
      step: "Same-object check",
    });
    const v = parseSameThingVerdict(result.text, result.stopReason);
    if (!v.same || v.copy) console.log(`[SameThing] ${thing}: ${v.what}`);
    return v;
  } catch (err: any) {
    console.warn(`[SameThing] check failed: ${err?.message ?? err} — passing the picture`);
    return { same: true, copy: false, what: "" };
  }
}

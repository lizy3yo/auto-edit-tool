/**
 * server/overlayTextScan.ts
 *
 * Pre-render DEFECT gate for long-form b-roll stills: ONE vision call, two narrow verdicts.
 *
 * 1. OVERLAY TEXT — every b-roll prompt already bans stamped-on text (`NO_OVERLAY_TEXT_SUFFIX`)
 *    and gpt-image-2 stamps captions/titles/watermarks anyway. The judgement is narrow on
 *    purpose, and it is why this is a vision call and not OCR: the pipeline DELIBERATELY allows
 *    incidental real-world text (`ENGLISH_TEXT_ONLY` wants readable product labels, packaging,
 *    signage) while banning text STAMPED OVER the frame. Those two live one clause apart in the
 *    same prompt tail, so telling them apart IS the job. OCR fires on every jar label.
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
  "still frame. Answer two independent questions.\n\n" +
  "QUESTION 1 — overlay: is any text STAMPED OVER this frame, as if it were added afterwards " +
  "in a video editor?\n" +
  "Answer true ONLY for text that is not physically part of the photographed scene:\n" +
  "- captions, subtitles, or lower-third bars\n" +
  "- titles, headlines, or large words laid across the shot\n" +
  "- watermarks, channel logos, corner bugs, or signatures\n" +
  "- timestamps, counters, or camera-UI text burned into the frame\n" +
  "- callout labels, arrows, or meme-style text\n" +
  "Answer false for text that is REAL and physically in the scene — it belongs there and is " +
  "wanted: printing on product labels, packaging, jars, bottles, bags, boxes, or seed packets; " +
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
  "Answer false for everything else: unusual but possible products or craftsmanship, odd " +
  "compositions, shallow depth of field, soft focus, plain or boring frames, imperfect " +
  "staging, and any small detail you cannot clearly resolve at this size. This is AI-generated " +
  "photography — mild strangeness is normal and ships; only unmistakable physical impossibility " +
  "fails. When unsure, answer false.\n\n" +
  'Return ONLY this JSON, no prose: {"overlay":true|false,"broken":true|false,"what":"..."}\n' +
  'what: 3-8 words naming the worst defect and where it sits (e.g. "white caption bar across ' +
  'the bottom", "cutting board floating above the table"); "" when both are false.';

export interface StillDefectVerdict {
  overlay: boolean;
  broken: boolean;
  what: string;
}

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
  if (!parsed.success) return { overlay: false, broken: false, what: "" };
  const overlay = parsed.data?.overlay === true;
  const broken = parsed.data?.broken === true;
  const what = parsed.data?.what;
  return {
    overlay,
    broken,
    what:
      (overlay || broken) && typeof what === "string" ? what.slice(0, 80) : "",
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
export async function scanStillDefects(
  buffer: Buffer
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
      systemPrompt: STILL_DEFECT_SYSTEM,
      userMessage:
        "Is any text stamped over this frame, and does it contain obviously impossible structure?",
      imageInput: image,
      maxTokens: 128,
      model: STILL_DEFECT_MODEL,
    });
    const verdict = parseStillDefectVerdict(result.text, result.stopReason);
    if (verdict.overlay || verdict.broken)
      console.log(
        `[StillDefects] ${verdict.overlay ? "stamped text" : "broken geometry"} detected: ${verdict.what}`
      );
    return verdict;
  } catch (err: any) {
    // Fail open — a QC check must never cost a render. Nothing catches it downstream, so this
    // warn is the only trace; a defective still ships.
    console.warn(
      `[StillDefects] check failed: ${err.message} — passing the still`
    );
    return { overlay: false, broken: false, what: "" };
  }
}

/** True when the still has text stamped over it. Fails open (false) on any error. */
export async function hasOverlayText(buffer: Buffer): Promise<boolean> {
  return (await scanStillDefects(buffer)).overlay;
}

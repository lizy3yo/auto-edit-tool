/**
 * server/overlayTextScan.ts
 *
 * Pre-render OVERLAY-TEXT gate for long-form b-roll stills.
 *
 * Every b-roll prompt already bans stamped-on text (`NO_OVERLAY_TEXT_SUFFIX`) and gpt-image-2
 * stamps captions/titles/watermarks anyway. This asks Claude one narrow question about a finished
 * still — is there text composited OVER the photo? — so `generateValidatedStill` can re-roll it on
 * a fresh seed. That function is the single choke point for every b-roll pixel (the still lane's
 * Ken Burns source AND the motion lane's grok keyframe), so a texty frame is caught there before
 * it costs a 30-180s video render that would have inherited it.
 *
 * The judgement is narrow on purpose, and it is why this is a vision call and not OCR: the
 * pipeline DELIBERATELY allows incidental real-world text (`ENGLISH_TEXT_ONLY` wants readable
 * product labels, packaging, signage) while banning text STAMPED OVER the frame. Those two live
 * one clause apart in the same prompt tail, so telling them apart IS the job. OCR fires on every
 * jar label.
 *
 * This GATES: a true verdict re-rolls the still, so it is on the critical path for every b-roll
 * image. It is also the pipeline's ONLY automated look at what a b-roll frame actually contains —
 * nothing inspects the finished render.
 *
 * ponytail: one image, one call, one bit — no severity, no location; a re-roll is the only thing
 * the caller can do with the answer. NEVER THROWS: a dead check returns false and the still ships.
 * Blocking a render on a QC call that can 529 is not worth it — but note that a dead check is now
 * silent apart from the warn below, so watch for `[OverlayText] check failed` in bulk.
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
const OVERLAY_TEXT_MODEL = "claude-haiku-4-5-20251001";

/**
 * Downscale before the call. Vision tokens are ~(w*h)/750, so at gpt-image-2's native 1280x720
 * (~1230 tok) the PIXELS are ~72% of this call's cost — the prompt is not where the money is.
 * 768x432 is ~442.
 * ponytail: this is the floor for reading a caption, not for reading a jar label. If review shows
 * the judge calling real label text an overlay because it went illegible, raise this — don't drop
 * the resize.
 */
const OVERLAY_SCAN_WIDTH = 768;
const OVERLAY_SCAN_HEIGHT = 432;

/** The judge's brief. A module constant so it reads as one block. */
const OVERLAY_TEXT_SYSTEM =
  "You are a quality-control reviewer for AI-generated b-roll photography. You are shown ONE " +
  "still frame. Answer one question: is any text STAMPED OVER this frame, as if it were added " +
  "afterwards in a video editor?\n\n" +
  "Answer true ONLY for text that is not physically part of the photographed scene:\n" +
  "- captions, subtitles, or lower-third bars\n" +
  "- titles, headlines, or large words laid across the shot\n" +
  "- watermarks, channel logos, corner bugs, or signatures\n" +
  "- timestamps, counters, or camera-UI text burned into the frame\n" +
  "- callout labels, arrows, or meme-style text\n\n" +
  "Answer false for text that is REAL and physically in the scene — it belongs there and is " +
  "wanted:\n" +
  "- printing on product labels, packaging, jars, bottles, bags, boxes, or seed packets\n" +
  "- signage, posters, or notices that exist in the location\n" +
  "- words on a book cover, a screen, a tag, or handwriting on paper\n\n" +
  "The test is WHERE the text sits, not what it says. Text lying on a surface in the scene — " +
  "following that surface's angle, blurred where the surface is out of focus, lit by the " +
  "scene's own light — is real: answer false. Text that floats flat and crisp on top of the " +
  "picture, square to the frame edges, ignoring the scene's perspective, focus, and lighting, " +
  "was stamped on: answer true.\n\n" +
  "Never judge spelling or language: misspelled, gibberish, or foreign lettering on a real " +
  "label is still real label text — answer false. A frame with no text at all is false. When " +
  "unsure, answer false.\n\n" +
  'Return ONLY this JSON, no prose: {"overlay":true|false,"what":"..."}\n' +
  'what: 3-8 words naming the stamped text and where it sits (e.g. "white caption bar across ' +
  'the bottom"); "" when overlay is false.';

/**
 * Parse the verdict. Anything off-shape reads as "no overlay": a re-roll costs an image and
 * possibly a grok render, so an unparseable answer must not trigger one.
 *
 * Pure — unit-tested.
 */
export function parseOverlayVerdict(
  raw: string,
  stopReason?: string
): { overlay: boolean; what: string } {
  const parsed = safeParseJSON<any>(raw, stopReason);
  if (!parsed.success || typeof parsed.data?.overlay !== "boolean")
    return { overlay: false, what: "" };
  const what = parsed.data.what;
  return {
    overlay: parsed.data.overlay,
    what: typeof what === "string" ? what.slice(0, 80) : "",
  };
}

/**
 * True when the still has text stamped over it. Fails open (false) on any error.
 *
 * Takes no mimeType: sharp sniffs the input format from the bytes and always re-encodes png, so
 * the media_type below cannot drift from what is actually sent. That drift was a real bug —
 * declaring jpeg over gpt-image-2's png 400s, which fails open and ships the text SILENTLY.
 */
export async function hasOverlayText(buffer: Buffer): Promise<boolean> {
  try {
    // Downscale: at native 1280x720 the pixels are ~72% of this call's cost (see OVERLAY_SCAN_*).
    // Safe for THIS question only: a caption bar, title, or watermark spans the frame and reads
    // fine downscaled. Don't reuse this resize for a check that hunts fine detail (warped hands,
    // garbled lettering) — that is exactly what it destroys.
    const small = await sharp(buffer)
      .resize(OVERLAY_SCAN_WIDTH, OVERLAY_SCAN_HEIGHT, {
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
      systemPrompt: OVERLAY_TEXT_SYSTEM,
      userMessage: "Is any text stamped over this frame?",
      imageInput: image,
      maxTokens: 128,
      model: OVERLAY_TEXT_MODEL,
    });
    const verdict = parseOverlayVerdict(result.text, result.stopReason);
    if (verdict.overlay)
      console.log(`[OverlayText] stamped text detected: ${verdict.what}`);
    return verdict.overlay;
  } catch (err: any) {
    // Fail open — a QC check must never cost a render. Nothing catches it downstream, so this
    // warn is the only trace; a texty still ships.
    console.warn(
      `[OverlayText] check failed: ${err.message} — passing the still`
    );
    return false;
  }
}

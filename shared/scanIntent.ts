/**
 * shared/scanIntent.ts
 *
 * WHERE THE BIG QR CARD STARTS, in one place both sides import. `markCtaQrBlock` (server) starts
 * the big centred card on a marked block's `CTA_QR_TRIGGER` line, else on its first sentence that
 * tells the viewer to scan (`SCAN_INTENT`), and holds it to ===END CTA===. The Generate-time script
 * check (`shared/scriptCheck.ts`) reads the same window to warn when a line spoken under the big
 * card puts the code somewhere else ("the pattern in the corner of the screen", job 409 scene 37) —
 * so it must find the scan sentence exactly as the pipeline does, and the rule lives here, not in
 * server/longformVideo.ts, which re-exports it.
 *
 * Pure string work — bundles into the client for free.
 */
import { CTA_QR_TRIGGER } from "./ctaMarkers";

// The scan line is worded afresh in every script, and a fixed phrase list kept missing it: job 399
// said "Hold your phone up to the screen with its camera on, and aim it at the little black and
// white code", job 400 "lift your phone toward the pattern in the corner of the screen and tap what
// rises" — neither matched, so the card started on a later "tap the link" sentence (399) or fell
// back to the block's last words (400), 7-8 s late, the scan instruction spoken over the host with
// only the small corner code. So the parts below say what a scan line DOES: a phone or camera held,
// lifted or aimed AT the screen or the code, a code shown ON the screen, a link that appears to be
// tapped, the description opened. Those parts need their target in the same sentence, so a line
// that only mentions a phone ("keep your phone by the bed", "it lands on your phone or your
// tablet", "hold your phone up to your ear") is not one.
/** One word between the parts of a scan phrase. Never a joining word, so the target is in the same
 *  phrase as the phone ("hold your phone up to the window and you'll see the screen go dark" is
 *  not a scan line); "black and white" is one word here. */
const SCAN_WORD = String.raw`(?:black[- ]and[- ]white|(?!(?:and|or|but|so|then|while|when|if|because|until)\b)[\w'’-]+)`;
/** "your phone", "the camera", "its camera", "your phone's camera", "your phone camera". */
const SCAN_DEVICE = String.raw`(?:(?:your|the|a|its|that) )?(?:(?:cell ?)?phone['’]?s? )?(?:phone|camera|cell ?phone|smartphone)`;
/** What it is aimed at. A bare "square" or "pattern" is a woodworker's tool or a knitting chart,
 *  so those count only when they are said to be the scannable one. */
const SCAN_TARGET = String.raw`(?:screen|code|qr|(?:patterned|black[- ]and[- ]white|scannable) (?:square|box|pattern))`;
/** What a phone or camera NAMED in the phrase is aimed at: the targets above, or a square or
 *  pattern pointed out as the small one on screen ("point the camera at that square" — the job 391
 *  scan line; "toward the pattern in the corner"). Still never "the square" alone ("aim the camera
 *  at the square so buyers can see it's true" is the woodworker's tool), and never after "it"
 *  (any tool). */
const SCAN_AIM_TARGET = String.raw`(?:${SCAN_TARGET}|(?:that|this|little|small|tiny) (?:square|pattern|box)|(?:square|pattern|box) in the (?:[\w-]+ ){0,2}corner)`;
const SCAN_PREP = String.raw`(?:at|toward|towards|to|over|on|upon)`;
/** Words that only say where the code sits: "the code is right there on your screen". Any word
 *  there read a pitch as a scan line ("the code book opens right on your screen"). */
const SCAN_LINKING = String.raw`(?:is|are|sits|sitting|showing|shown|up|down|right|there|here|now|just|still|already)`;
const SCAN_INTENT_PARTS = [
  String.raw`\bscan\b`,
  String.raw`\bgrab (?:your|a) phone\b`,
  String.raw`\bpoint (?:your (?:phone|camera)|it) at\b`,
  String.raw`\bpoint your (?:phone|camera)\b`,
  String.raw`\bphone['’]?s camera\b`,
  String.raw`\byour camera\b`,
  String.raw`\bqr\b`,
  // A phone or camera held, lifted or aimed at the screen or the code, a few words apart at most:
  // "hold your phone up to the screen", "lift your phone toward the pattern in the corner of the
  // screen", "point its camera at the code".
  String.raw`\b(?:hold|lift|raise|point|aim|turn|tilt|bring|move|hover)(?: up)? ${SCAN_DEVICE}\b(?:[\s,]+${SCAN_WORD}){0,4}?\s+${SCAN_PREP}\b(?:\s+${SCAN_WORD}){0,7}?\s+${SCAN_AIM_TARGET}\b`,
  // ...or "it" once the phone is named: "and aim it at the little black and white code".
  String.raw`\b(?:point|aim)(?: up)? (?:it|that|this)(?: up)? ${SCAN_PREP}\b(?:\s+${SCAN_WORD}){0,7}?\s+${SCAN_TARGET}\b`,
  // Held or turned, "it" goes UP TO, toward or at the code: "hold it up to the screen". A bare
  // "to" is a standard there ("hold it to the same code" is a building code, not the QR).
  String.raw`\b(?:hold|turn|tilt|lift|raise|bring) (?:it|that|this)(?: up)? (?:toward|towards|at|over|up to)\b(?:\s+${SCAN_WORD}){0,7}?\s+${SCAN_TARGET}\b`,
  // A code shown on the screen: "the code is on the screen", "that code is right there on your
  // screen", "a small patterned square on your screen", "the code in the corner of your screen".
  String.raw`\b(?:code(?:['’]s)?|(?:patterned|black[- ]and[- ]white|scannable) (?:square|box|pattern))(?:\s+${SCAN_LINKING}){0,3}\s+(?:on|in the (?:[\w-]+ ){0,2}corner of) (?:your|the|this) (?:tv |television )?screen\b`,
  // The link the scan brings up: "a link appears, and you tap it", "when a little link pops up".
  String.raw`\blink\b(?:\s+${SCAN_WORD}){0,3}?\s+(?:appears|pops up|shows up|comes up|shows on)\b`,
  String.raw`\b(?:use|tap|click|hit|follow|touch|press) (?:on )?(?:the|that|my|this) (?:(?:little|small|first|top|blue) )?link\b`,
  String.raw`\b(?:the |a )?link (?:is )?(?:in|below|under|down in) (?:the |this )?(?:description|video|comments?)\b`,
  // The description as the other way in, with or without the word "link": "find the first line of
  // the description below", "open the description below this video". THE description (or the
  // video's), never "a description of": a pitch says "you'll find a full description of every
  // lesson", and that is the book, not the way to it.
  String.raw`\b(?:open|find|check|scroll(?: down)? to|look (?:at|in|under|below|underneath)|go to|head to)\b(?:\s+${SCAN_WORD}){0,5}?\s+(?:the|video['’]s) description\b(?!\s+of\s+(?!(?:this|the) video\b))`,
  String.raw`\bpinned comment\b`,
  // "To get it" is how to get the book — never "how to get it right the first time", a line of
  // ordinary narration this used to catch.
  String.raw`\bto get (?:it|a copy|your copy|the book)\b(?!\s+(?:right|wrong|done|back|working|fixed)\b)`,
  // "To download it," opens the instruction; a pitch calls the book easy "to download it to any
  // phone", which is the book, not the way to it.
  String.raw`\bto download (?:it|a copy|your copy|the book),`,
  String.raw`\b(?:grab|get|order|pick up) (?:your|a) copy\b`,
];
/**
 * A line telling the viewer to scan — where the big QR card takes over when a marked CTA block
 * does not carry the verbatim `CTA_QR_TRIGGER`. Matched per sentence, so the card starts on the
 * sentence that says it rather than on a scene that merely ends with it.
 */
export const SCAN_INTENT = new RegExp(SCAN_INTENT_PARTS.join("|"), "i");
// "To get it, use the link in the description below this video." is the same instruction as
// "scan the code" (Pearl's job 310 said only that, the window fell back to the block's last ~90
// words, and the QR swallowed the book's title and the host's part: book → QR, no host between).

/** `anchorRegex(CTA_QR_TRIGGER)` as server/longformVideo.ts builds it: the exact words, case kept,
 *  any run of whitespace between them. */
const TRIGGER = new RegExp(
  CTA_QR_TRIGGER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
);

/**
 * Which of a marked block's sentences the big card starts on, as `markCtaQrBlock` decides it: the
 * sentence holding `CTA_QR_TRIGGER` when the block has one, else the first that tells the viewer to
 * scan (`SCAN_INTENT`), else -1 (the pipeline then falls back to the block's last line or two).
 * Every sentence from there to ===END CTA=== is spoken under the big centred card. Pure.
 */
export function scanWindowStart(sentences: readonly string[]): number {
  const trigger = sentences.findIndex(s => TRIGGER.test(s));
  return trigger >= 0 ? trigger : sentences.findIndex(s => SCAN_INTENT.test(s));
}

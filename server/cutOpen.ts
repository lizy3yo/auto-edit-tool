/**
 * NOTHING IS CUT OPEN (2026-10-18, the review of job 403 scenes 11, 13, 15-18, 22 and 23). A line
 * about a part hidden inside something — "Here is the part nobody sees. Inside the porcelain, the
 * water does not fall straight down" — was planned as a picture no camera can take: "close view of the
 * toilet's internal porcelain S-shaped trapway channel", "cutaway close-up of the white porcelain
 * S-shaped channel". The picture maker drew it the only way it could, by sawing the fixture open, and
 * 45 s of the film became the same glossy cross-section. Picture memory then carried the cut into
 * real-world shots: the host lifting a toilet sliced down its side off the flange (scene 23, severe),
 * an auger pushed through the cut wall (scene 22). Older door-frame films asked the same in words: "a
 * cutaway view of the pine door frame showing the gap and wooden stud behind it" (jobs 232, 243).
 *
 * One rule, said in every place a picture is written or drawn: an inside part is shown the way a
 * person can see it — the thing from outside, where that part opens or comes out, or a tool going in
 * there. Explaining the inside is the narration's and the graphics' job. Food, wood or cloth cut as
 * part of the work is a real photo and is never this rule. Pure — unit-tested.
 */
import type { StoryboardScene } from "@shared/types";

/**
 * The rule as the planners read it: the shot list, the line check, the props list, the same-topic
 * groups, the named-things step and the prompt writer — one wording, so they cannot disagree.
 */
export const NOTHING_CUT_OPEN_RULE =
  "NOTHING CUT OPEN: a camera only sees the OUTSIDE of a solid thing. When a line is about a part " +
  "hidden INSIDE something — a channel inside a fixture, the pipes or wires inside a wall, the works " +
  "inside a machine or an appliance — the picture shows it the way a person can really see it: the " +
  "whole thing from the outside, the place where that part opens or comes out (an opening, an " +
  "outlet, a cover taken off the way it normally comes off), or a tool going in through that " +
  "opening. Never a cutaway, cross-section, x-ray or see-through view, never the thing sawn or " +
  "sliced open to show its inside, and never a view from inside a solid thing (\"the pipe inside " +
  "the wall\" = the wall with the pipe coming out of it under the sink; \"the gears inside the " +
  "clock\" = the clock with its back taken off). Explaining what happens inside is the narration's " +
  "and the on-screen graphics' job, not the picture's. Food, wood or cloth cut as part of the work " +
  "is not this rule.";

/**
 * Added to a picture's prompt when its words, or a key thing in it, name a part hidden inside
 * something (`drawnFromOutside`). The words "cutaway" and "cross-section" are scrubbed from every
 * prompt (`withoutCutaway`), but "the internal channel" still asks for an inside no camera sees.
 */
export const SEEN_FROM_OUTSIDE_CLAUSE =
  "SEEN FROM OUTSIDE: a camera only sees the outside of a solid thing. Every fixture, appliance, " +
  "machine, pipe and wall in the frame is whole, as it really stands: a part hidden inside one is " +
  "shown from the outside, where it opens or comes out (its opening or outlet, or a cover taken off " +
  "the way it normally comes off), or with a tool going in there — never cut open, sawn or sliced " +
  "in half, sectioned, see-through, or drawn as a cutaway or cross-section.";

/**
 * QUESTION 2's line for it (`STILL_DEFECT_SYSTEM`): nothing checked for a cut-open object, so the
 * sawn toilet passed as "key thing, no flags" five times. It asks for "cut open" in `what` so the
 * redraw can tell this fault from another (`cutOpenFault`).
 */
export const CUT_OPEN_BROKEN =
  "- a solid made thing or building part (a fixture, an appliance, a machine, a pipe, a wall, a " +
  "piece of furniture) shown CUT OPEN — sawn or sliced through, sectioned, see-through or drawn as a " +
  "cutaway — so the inside it hides is on show where a real one is closed (a fixture sawn in half " +
  'with its inner channel exposed); say "cut open" in what. Food, wood or cloth cut as part of the ' +
  "work, and a thing opened the way it normally opens (a lid lifted, a door, cover or panel taken " +
  "off), are fine\n";

/**
 * QUESTION 4's note on a picture drawn from outside on purpose (`drawnFromOutside`): asked to find
 * "the internal channel" in a whole fixture, the check would call the right picture missing and send
 * it back toward the cut.
 */
export const INSIDE_PART_NOTE =
  "\n\nQUESTION 4 NOTE — a thing named for this picture is a part hidden inside something solid, so " +
  "it is drawn on purpose from the OUTSIDE: the whole thing it is in, the place where that part " +
  "opens or comes out, or a tool going in there. That counts as it being shown: never answer missing " +
  "because its inside cannot be seen.";

/**
 * Words that name a view no camera has: a cutaway, cross-section, see-through or exploded one, or an
 * x-ray or section VIEW — never an x-ray image itself, a real film a dentist holds up to a light box,
 * nor "the dairy section photographed from the aisle". No "shot" and no "look" after them: "a
 * cutaway shot" is an editor's b-roll, "a see-through look" is a sheer top.
 */
const CUT_VIEW_WORD = String.raw`(?:cut-?away|cross[- ]?section(?:al)?|sectional|see-?through|ghosted|exploded|(?:x-?ray|section)(?=\s+views?\b))`;
const CAMERA_NOUN = String.raw`(?:view|close-?up|photo|picture|image)s?`;
const DIAGRAM_NOUN = String.raw`(?:diagram|illustration|drawing|render(?:ing)?)s?`;
const CUT_VIEW = new RegExp(String.raw`\b${CUT_VIEW_WORD}\s+(?:${CAMERA_NOUN}|${DIAGRAM_NOUN})\b`, "i");
/**
 * A cross-section AS A VIEW ("a cross-section of a house wall cavity", "a door frame cross section
 * showing the gap behind it", "in cross-section") — never a stick's profile ("their uniform
 * cross-section and light grain", stored film 133).
 */
const CROSS_SECTION =
  /\bcross[- ]?section(?:al|ed|s)?\b(?=\s+(?:of|showing|revealing|exposing|through|with)\b)|\bin\s+cross[- ]?section\b|\bcross[- ]?sectioned\b/i;
/** Passage-like insides that only a cut can show. */
const INSIDE_NOUN = String.raw`(?:channels?|passages?|passageways?|ducts?|bores?|cavit(?:y|ies)|chambers?|workings|mechanisms?|wiring|plumbing)`;
/**
 * "the toilet's internal porcelain S-shaped trapway channel", "the toilet's internal trapway curve"
 * (job 403 scenes 11 and 15), "its hidden workings". "inner" asks less — "the inner curve of the
 * bowl", "the inner bend of the elbow" are in plain view — so it counts only before a passage.
 */
const INNER_PART = new RegExp(
  String.raw`\b(?:internal|hidden)\s+(?:[a-z-]+\s+){0,4}(?:${INSIDE_NOUN}|curves?|bends?)\b|\binner\s+(?:[a-z-]+\s+){0,3}${INSIDE_NOUN}\b`,
  "i"
);
/**
 * A camera inside a closed passage or a wall: "close-up inside the curved white porcelain passage"
 * (job 403 scene 18). Never inside an open thing a person looks into — "water swirling down inside
 * the white ceramic toilet bowl" is a real photo, and so are a light "inside the hollow frame cavity"
 * of an open lattice lantern and a chisel "inside a half-lap joint cavity" (stored films 111, 114).
 * Never "within" either: a door "shown closed within the bedroom wall" stands in it (stored film 376).
 */
const INSIDE_SOLID =
  /\binside\s+(?:the|a|an|its|their)\s+(?:[a-z-]+\s+){0,3}(?:channels?|passages?|passageways?|ducts?|bores?|pipes?|walls?|wiring|plumbing)\b/i;

/**
 * Whether a description asks to see a solid thing from inside: a cut view, or a passage only a cut
 * could show. "Sliced in half" is never read here — "an avocado sliced in half showing the pit" is a
 * real photo, and no stored description sawed a fixture open in words; the check sees that one
 * (`CUT_OPEN_BROKEN`). Over the 345 stored films it reads 29 descriptions: the door frames, the wall
 * cavity and the trapway, plus a few quilt and pot-holder layers and two opened smoke alarms, which
 * it costs nothing to draw whole. Pure.
 */
export function insideView(text: string | undefined): boolean {
  const t = text ?? "";
  if (!t.trim()) return false;
  return CUT_VIEW.test(t) || CROSS_SECTION.test(t) || INNER_PART.test(t) || INSIDE_SOLID.test(t);
}

/**
 * A picture drawn from the OUTSIDE on purpose: its own words ask for an inside view, or a key thing in
 * it is a part hidden inside something (`scene.seenFromOutside`, set by `attachMemory` from the props
 * list's look — job 403's main thing was written "the toilet's internal porcelain passage behind the
 * bowl", so "close-up of the smooth white curved S-shaped porcelain channel" needed the rule too).
 * Pure.
 */
export function drawnFromOutside(
  s: Pick<StoryboardScene, "seenFromOutside" | "showSubject" | "visualPrompt" | "namedLook">
): boolean {
  return !!s.seenFromOutside || insideView(s.showSubject) || insideView(s.visualPrompt) || insideView(s.namedLook);
}

/** A cut view as a tag on its own: "…into the stud behind it, cross-section view" (stored film 225). */
const CUT_VIEW_TAG = new RegExp(String.raw`,\s*(?:an?\s+)?${CUT_VIEW_WORD}\s+${CAMERA_NOUN}(?=\s*(?:[.;,]|$))`, "gi");
const CUT_VIEW_THEN_CAMERA = new RegExp(String.raw`\b${CUT_VIEW_WORD}\s+(${CAMERA_NOUN})\b`, "gi");
const CUT_VIEW_THEN_DIAGRAM = new RegExp(String.raw`\b${CUT_VIEW_WORD}(?:\s+view)?\s+${DIAGRAM_NOUN}\b`, "gi");
/** "A cross-section or cutaway view diagram …" (stored film 242): the first choice goes with the second. */
const CUT_VIEW_OR = /\b(?:cut-?away|cross[- ]?section(?:al)?)\s+or\s+/gi;
const CROSS_SECTION_OF = /\bcross[- ]?section(?:al)?\s+(?=of\b)/gi;
const IN_CROSS_SECTION = /\s*\bin\s+cross[- ]?section\b/gi;

/**
 * The prompt with the words that ASK for a cut view taken out, so the picture maker is never told to
 * draw one: "Cutaway view of the white porcelain S-shaped channel" → "View of the white porcelain
 * S-shaped channel", "a cutaway diagram" → "a photo", "a cross-section of a house wall cavity" → "a
 * view of a house wall cavity". The place and the thing stay; `SEEN_FROM_OUTSIDE_CLAUSE` says how to
 * show them. Untouched prompts stay byte-identical. Pure.
 */
export function withoutCutaway(text: string): string {
  if (!text || !insideView(text)) return text;
  let out = text
    .replace(CUT_VIEW_TAG, "")
    .replace(CUT_VIEW_OR, "")
    .replace(CUT_VIEW_THEN_DIAGRAM, "photo")
    .replace(CUT_VIEW_THEN_CAMERA, "$1")
    .replace(CROSS_SECTION_OF, "view ")
    .replace(IN_CROSS_SECTION, "");
  if (out === text) return text;
  out = out
    // "an x-ray view" → "a view", "a cutaway image" → "an image"
    .replace(/\b([Aa])n\s+(view|close-?up|photo|picture)/g, "$1 $2")
    .replace(/\b([Aa])\s+(image)/g, "$1n $2")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
  return /^[A-Z]/.test(text) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

/** What the check named when it saw a thing cut open (`CUT_OPEN_BROKEN` asks for "cut open"). */
const CUT_OPEN_FAULT =
  /\b(?:cut|sawn|sliced|split)\s+(?:open|in half|in two|away)\b|\bcross[- ]?section|\bcut-?away\b|\bsectioned\b|\bsee-?through\b|\bx-?ray\b|\binsides?\s+exposed\b|\bexposed\s+(?:inner|internal|interior|inside)\b/i;

/** Whether the still check's `what` names a thing cut open (`CUT_OPEN_BROKEN`). Pure. */
export function cutOpenFault(what: string | undefined): boolean {
  return CUT_OPEN_FAULT.test(what ?? "");
}

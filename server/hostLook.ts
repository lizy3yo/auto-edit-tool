/**
 * The host at work in their own b-roll (2026-09-28, the operator: "if we have b-roll image doing
 * something it should be our character"; "everything should be adaptable to every channel").
 *
 * `deriveHostLook` reads ONE plain description off the host's own photo — hair, head covering,
 * clothes and colours, build — once per video, so any channel (and any channel added later) gets
 * its host into b-roll with no setup. `markHostBroll` then marks every picture that shows someone
 * doing the work as the host (`brollHostLook` for the prompt, `brollHostRef` for the image
 * reference); `buildStillPrompt` draws them from behind or the side with the face never shown —
 * the picture model draws a face a little differently every time, and a b-roll face that did not
 * match the talking host would read as someone else. A split's picture half stays person-free
 * (the host is already on the other half).
 */
import sharp from "sharp";
import type { LongformInputParams, StoryboardScene } from "@shared/types";
import { invokeClaude } from "./claude";
import { presignOwnBucketUrl } from "./storage";

const HOST_LOOK_MODEL = () => process.env.HOST_LOOK_MODEL || "claude-sonnet-5";

const HOST_LOOK_SYSTEM =
  "You describe a person's visible appearance for a picture generator that will draw them from " +
  "BEHIND or from the SIDE doing a task, with the face never shown. Write ONE line of 15-30 " +
  "plain words: build, hair (colour, length, style) and any head covering, every piece of " +
  "clothing with its colour, anything worn over it (an apron, a shawl). Never the face, eyes or " +
  "expression; never an age, a name, an ethnicity or a guess about who they are; never the " +
  "background. Example: a slim woman with auburn hair under a sheer white head covering, a plain " +
  "blue dress with elbow sleeves and a black apron. Output only the line.";

/** One line describing the host in `photoUrl`, or "" when it cannot be read (the film goes on). */
export async function deriveHostLook(photoUrl: string): Promise<string> {
  try {
    const resp = await fetch(await presignOwnBucketUrl(photoUrl), {
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`photo ${resp.status}`);
    const small = await sharp(Buffer.from(await resp.arrayBuffer()))
      .resize(768, 768, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const r = await invokeClaude({
      systemPrompt: HOST_LOOK_SYSTEM,
      userMessage: "Describe this person for the picture generator.",
      imageInput: { base64: small.toString("base64"), mediaType: "image/png" },
      maxTokens: 4000,
      model: HOST_LOOK_MODEL(),
    });
    return cleanHostLook(r.text);
  } catch (err: any) {
    console.warn(`[HostLook] could not read the host's look: ${err?.message ?? err}`);
    return "";
  }
}

/** The first plain line of the model's answer, no quotes or trailing full stop, ≤ 40 words. Pure. */
export function cleanHostLook(raw: string): string {
  const line = (raw ?? "")
    .split("\n")
    .map(l => l.trim())
    .find(l => l.length > 0) ?? "";
  return line
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\.$/, "")
    .split(/\s+/)
    .slice(0, 40)
    .join(" ");
}

/**
 * A shot description with its MIRRORS taken out. A picture of the host must never show the face,
 * and a mirror in front of them has to: Scarlett's 3-min test (job 234) asked for "her neck and
 * chin catching light in the dressing room mirror" and got a reflection of her BACK (0:19) and a
 * reflection sliced off at the chin (1:14). "…in the mirror" goes; any other mirror becomes a
 * plain wall. Pure — unit-tested.
 */
export function withoutMirrors(text: string): string {
  return text
    .replace(
      /,?\s*(?:reflected\s+)?\b(?:in|into|at|before|facing|toward|towards)\s+(?:(?:a|an|the|her|his|their)\s+)?(?:[\w-]+\s+){0,3}mirrors?\b/gi,
      ""
    )
    .replace(/\b(?:a|an|the)\s+(?:[\w-]+\s+){0,3}mirrors?\b/gi, "the wall")
    .replace(/\bmirrors?\b/gi, "wall")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

/** Words in a shot description that mean a person is in it, doing something. */
export const SHOWS_PERSON =
  /\b(hands?|fingers?|fingertips?|host|she|he|her|his|herself|himself|someone|a person|a woman|a man|wearing|worn by|collarbone|neck|wrists?|earlobes?|held (?:up|out|near|against|over|to|above|beside|in front)|hold(?:s|ing) (?:up|out)|in use|scalp|skin|nails|fingernails|forehead|cheeks?|eyelashes|eyebrows?|hairline|strands?|hair(?!\s*(?:dryer|brush|clip|tie|spray|band|pin|comb|product|net|cut(?:ting)? scissors)))\b/i;
// A BODY PART is always on a person (2026-10-02, Diane's job 309: "dry hair at the bare sink counter"
// drew a head of hair lying on the counter, and "a brush spreading gloss through silver hair" drew
// hair hanging from nothing — read as person-free, those pictures got NO_FIGURES_SUFFIX, which bans
// hair, so the picture maker drew the hair loose). Hair, a scalp, skin, nails or a face now make the
// picture the host's, from behind or the side. A hair dryer, brush or clip is a thing, not hair.
// "Host wearing a long chain" and "a necklace resting at the collarbone" are the host too:
// Scarlett's job 244 knew only "the host", so those pictures got no host look, no one-body rule
// and kept their mirror. ("neck" is whole-word only, so a crewneck or a neckline is not a person.)
// "held near the doorframe" needs a holder: Norbert's 3-min test (job 238, 0:32) asked for a
// "cordless drill … held near the doorframe", read it as person-free, and got a drill floating
// against the frame with no hand on it.

/** Words naming a part of the body (not a thing used on it — a hair dryer is a thing). */
export const BODY_PART_WORDS =
  /\b(?:scalp|skin|nails|fingernails|forehead|cheeks?|eyelashes|eyebrows?|hairline|strands?|hair(?!\s*(?:dryer|brush|clip|tie|spray|band|pin|comb|product|net)))\b/i;

/** A description asking for a body part OFF the body: "a lock of hair laid across a towel". */
export const DETACHED_BODY_PART =
  /\b(?:locks?|strands?|swatch(?:es)?|hanks?|tress(?:es)?|clumps?|sections?|pieces?|tufts?)\s+of\s+(?:[a-z-]+\s+){0,2}hair\b|\b(?:hair|nails?|fingernails?)\b[^.;]{0,60}?\b(?:lying|laid|lies|spread|draped|resting|rests|placed|arranged)\s+(?:flat\s+)?(?:on|across|over|out on)\b/i;

/** What really holds a loose body part: a wig stand, a mannequin head, a practice hand, a packet. */
export const REAL_HOLDER =
  /\b(?:wigs?|mannequin|wig stand|wig head|practice (?:hand|head)|training head|extensions?|swatch (?:ring|book|card)|packet|package|packaging)\b/i;
/** A few strands that really fall loose: in a brush, on a comb, in a drain, on a towel or a floor. */
const FALLEN_STRANDS =
  /\b(?:a few|some|stray|loose|fallen|shed)?\s*(?:strands?|hairs)\b[^.;]{0,40}\b(?:in|on|caught in|stuck in|around)\s+(?:a|an|the|her|his|their)?\s*(?:[a-z-]+\s+){0,2}(?:brush|hairbrush|comb|drain|sink|towel|pillow|floor|shower)/i;

/**
 * Whether a description asks for a body part that would look CUT OFF: a loose lock or hair lying on a
 * surface, with neither a real holder (wig stand, mannequin head, practice hand, packet) nor the few
 * fallen strands that really happen (the operator, 2026-10-02: "strands of hair can be not in the
 * mannequin … just don't generate hair that looks like it has no head"). Pure.
 */
export function looksCutOff(text: string): boolean {
  if (!DETACHED_BODY_PART.test(text)) return false;
  return !REAL_HOLDER.test(text) && !FALLEN_STRANDS.test(text);
}

/**
 * Put a loose body part back on the body (2026-10-02, the operator on Diane's job 315: "any part of
 * the body should stay on the body" — "a lock of hair dyed one flat dark brown … laid across a white
 * towel" and "hair with gray roots … lying on a white towel" came back as hair with no head). The
 * lock/strand words and the "lying on the towel" placement are taken out and the hair is put on the
 * person's own head. Unchanged when nothing asks for a loose body part. Pure.
 */
export function onTheBody(text: string): string {
  if (!looksCutOff(text)) return text;
  const out = text
    .replace(/\b(?:a|an|the|one|some)?\s*(?:locks?|strands?|swatch(?:es)?|hanks?|tress(?:es)?|clumps?|sections?|pieces?|tufts?)\s+of\s+/gi, " ")
    .replace(/,?\s*\b(?:lying|laid|lies|spread|draped|resting|rests|placed|arranged)\s+(?:flat\s+)?(?:on|across|over|out on)\s+(?:a|an|the|her|his|their)\s+[^,.;]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[.,;]?\s*$/, "");
  return `${out}, on the person's own head and body — never loose or lying on a surface.`;
}

/**
 * Mark the pictures that show someone doing the work as the HOST (see the file comment). Pictures
 * that show no one are cleared, so a re-run never leaves a stale mark. With no host look, no host
 * photo, or a b-roll-only film, nothing is marked and the anonymous-hands lane is used as before.
 * Returns how many pictures now show the host. Pure apart from mutating `scenes`.
 */
export function markHostBroll(
  scenes: StoryboardScene[],
  params: Pick<LongformInputParams, "hostLook" | "brollOnly">,
  hostPhotoUrl: string | undefined
): number {
  const look = params.hostLook?.trim();
  const on = !!look && !!hostPhotoUrl && !params.brollOnly;
  let n = 0;
  for (const s of scenes) {
    const eligible =
      !s.hostPresent &&
      !s.splitVisual &&
      !s.coverHero &&
      !s.assetImageUrl &&
      !s.qrHero &&
      !s.showsBook;
    const person =
      !!s.humanPresent || SHOWS_PERSON.test(s.showSubject ?? s.visualPrompt ?? "");
    if (on && eligible && person) {
      s.humanPresent = true;
      s.brollHostLook = look;
      if (s.showSubject) s.showSubject = withoutMirrors(s.showSubject);
      if (s.visualPrompt) s.visualPrompt = withoutMirrors(s.visualPrompt);
      s.brollHostRef = hostPhotoUrl;
      n++;
    } else if (on && s.hostPresent && s.splitVisual && BODY_PART_WORDS.test(s.splitVisual) && !REAL_HOLDER.test(s.splitVisual)) {
      // A split panel about a body part (hair, nails, skin) shows it on the host: it gets the host's
      // look for the panel (`buildSplitRightScene`); the take on the left is untouched.
      s.brollHostLook = look;
      s.brollHostRef = hostPhotoUrl;
    } else {
      s.brollHostLook = undefined;
      s.brollHostRef = undefined;
    }
  }
  return n;
}

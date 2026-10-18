// THE PICTURE UNDER A GRAPHIC — what each b-roll picture shows, told to the planner, and the checks
// that hold a NEW graphic to it. One copy, read by the planner (./planner.ts) and filled in by the
// app (server/graphics/apply.ts `filmLayoutOf`) and the lab (graphics-lab/scripts/job.mts).
//
// The planner used to read each scene as "#22 1:40.7-1:49.9 B-ROLL: <words>" and nothing more, so
// three things it could not see shipped on the round-13 verification films:
//   - job 409: the SmallLabel "Paulinus" (the man the essay was written TO, named over the picture)
//     went on the picture of Seneca writing by lamplight, labelled "Seneca" 2 s earlier — one man,
//     two names;
//   - job 408: a full-screen Versus card hid the whole of scene 3, a paid VIDEO in production;
//   - job 410: a full-screen StepCards card hid all three per-step pictures for 8.3 s.
// Now each b-roll scene says whether it is a still or a video, whether it is one list item's or
// one step's own picture, and what it shows; and the planner refuses (for its repair round) a label
// that does not name its picture or names a picture already named, a card that hides a video whole,
// and a card that hides the pictures of a spoken list's items.
//
// Only NEW graphics are held to these: they are not placement rules (./rules.ts), which a saved
// plan is re-checked against at every assembly, and an approved graphic is never dropped by a rule
// added after it was approved. Pure.
import { MIN_SHOT_SEC, tokens, type ResolvedCue, type Word } from "../cueResolve";
import { templateById, type TemplateDef } from "../registry";
import type { FilmLayout, LayoutScene } from "./rules";

/** What the planner is told about a scene's picture (the picture fields of `LayoutScene`). */
export type ScenePicture = Pick<LayoutScene, "shows" | "person" | "things" | "video" | "listItem">;

/** The storyboard fields a picture is read from — the app's `StoryboardScene`, or the lab's cached job. */
export type PictureSource = {
  hostPresent?: boolean;
  cta?: boolean;
  coverHero?: boolean;
  qrHero?: boolean;
  assetImageUrl?: string;
  stillImage?: boolean;
  objectMotion?: boolean;
  humanPresent?: boolean;
  showSubject?: string;
  visualPrompt?: string;
  otherPerson?: string;
  keyThing?: string;
  partOf?: string;
  otherKeyThings?: string[];
  listCut?: boolean;
  listKind?: string;
};

/**
 * What a scene's picture shows, for the planner. Only a b-roll picture outside the call to action
 * has one: a host take, a split (the host is on it), a CTA beat, the book cover and an operator's
 * asset get nothing (no graphic about the picture goes there). `shows` is the shot list's subject
 * (`showSubject` — what the picture is drawn and checked to show), else its own description; a
 * picture is a VIDEO when it is off the still lane and carries the motion that earned it a clip (the
 * storyboard's invariant, `!hostPresent && !stillImage` ⟹ `humanPresent || objectMotion`; a clip
 * that glitched is made a still). Both are asked, so a storyboard that predates the still lane is
 * never taken for a film of videos. Pure.
 */
export function pictureOf(s: PictureSource): ScenePicture {
  if (s.hostPresent || s.cta || s.coverHero || s.qrHero || s.assetImageUrl) return {};
  const clean = (t: string | undefined) => (t ?? "").trim();
  const shows = clean(s.showSubject) || clean(s.visualPrompt);
  const things = Array.from(new Set([s.keyThing, s.partOf, ...(s.otherKeyThings ?? [])].map(clean).filter(Boolean)));
  return {
    ...(shows ? { shows } : {}),
    ...(clean(s.otherPerson) ? { person: clean(s.otherPerson) } : {}),
    ...(things.length ? { things } : {}),
    video: !s.stillImage && !!(s.objectMotion || s.humanPresent),
    ...(s.listCut ? { listItem: s.listKind === "steps" ? ("step" as const) : ("item" as const) } : {}),
  };
}

/** The longest a picture's description runs in the planner's scene list: a glance at what it shows. */
export const SHOWS_MAX_CHARS = 140;

/**
 * How the planner's scene list names a b-roll picture, after "B-ROLL": " STILL", " VIDEO", a list
 * item's or a step's own picture, and what it shows — "" when the film does not say (the line then
 * reads as it always did). Pure.
 */
export function pictureNote(s: LayoutScene): string {
  const kind = [s.video === undefined ? "" : s.video ? "VIDEO" : "STILL", s.listItem === "step" ? "STEP PICTURE" : s.listItem === "item" ? "LIST ITEM PICTURE" : ""].filter(Boolean).join(", ");
  const shows = s.shows && s.shows.length > SHOWS_MAX_CHARS ? `${s.shows.slice(0, SHOWS_MAX_CHARS).replace(/\s+\S*$/, "")}…` : s.shows;
  const what = [shows ? `shows: ${shows}` : "", s.person ? `person: ${s.person}` : "", s.things?.length ? `thing: ${s.things.join(", ")}` : ""].filter(Boolean).join("; ");
  return `${kind ? ` ${kind}` : ""}${what ? ` {${what}}` : ""}`;
}

/* ───────────── A label names its picture ───────────── */

/** Words a label's head is never: articles, possessives, prepositions and the like. */
const STOP = new Set(
  "a an the this that these those his her its their my your our of for from with in on at by to into onto up out off over under about and or but as is are was were be".split(" ")
);
/** A preposition after a label's first content word ends its head phrase ("Shortness | of Life", "Bottle | of water"). */
const PREPOSITION = /^(?:of|for|from|with|in|on|at|by|to|into|onto|under|over|beside|near|behind|inside|about)$/;

/** A word as compared: no possessive, a plural as its singular ("swabs" is "swab", "glasses" is
 * "glass", "batteries" is "battery") — the same on both sides, so it only has to agree with itself. */
function stem(w: string): string {
  const t = w.replace(/'s$/, "").replace(/'$/, "");
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !/(?:ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/**
 * The word a label NAMES its thing by: the last content word of its opening noun phrase ("A toilet
 * auger" → "auger", "Lucius Annaeus Seneca" → "seneca", "On the Shortness of Life" → "shortness"),
 * as compared (`stem`). Undefined when it has no content word. Pure.
 */
export function labelHead(text: string): string | undefined {
  const t = tokens(text);
  let end = t.length;
  for (let i = 1; i < t.length; i++)
    if (PREPOSITION.test(t[i]) && t.slice(0, i).some(w => !STOP.has(w))) {
      end = i;
      break;
    }
  const content = t.slice(0, end).filter(w => !STOP.has(w));
  return content.length ? stem(content[content.length - 1]) : undefined;
}

/** Every word of what a picture shows — its subject, the person in it, its key things — as compared. */
function pictureWords(s: LayoutScene): Set<string> {
  return new Set([s.shows ?? "", s.person ?? "", ...(s.things ?? [])].flatMap(t => tokens(t)).map(stem));
}

/** Words naming people in general: "a man named Paulinus" names the man as a person, and any
 * picture of a man would pass for him. */
const PERSON_NOUN = /^(?:man|men|woman|women|person|people|guy|guys|lady|ladies|gentleman|gentlemen|boy|boys|girl|girls|child|children|kid|kids|fellow|someone|somebody)$/;

/**
 * The noun the narrator NAMES a label by, said right before it: "The essay is called | On the
 * Shortness of Life" → "essay", "a man named | Paulinus" → "man". Undefined when the words before
 * it name nothing. `lead`: the spoken words before the label's first word, in order. Pure.
 */
export function namedAs(lead: string[]): string | undefined {
  const w = lead.flatMap(x => tokens(x));
  let i = w.length - 1;
  if (i >= 1 && w[i] === "as" && w[i - 1] === "known") i -= 2;
  else if (i >= 0 && /^(?:called|named|titled|nicknamed|dubbed)$/.test(w[i])) i -= 1;
  else return undefined;
  while (i >= 0 && /^(?:is|was|are|were|be|been|being|it's|that's|simply|just|often|usually|actually|also|sometimes|commonly|now)$/.test(w[i])) i--;
  return i >= 0 && !STOP.has(w[i]) ? w[i] : undefined;
}

/**
 * Does a label name what its picture shows? Its head word (`labelHead`) is among the words of the
 * picture's subject, person or key things — or, for a name the narrator gives a THING ("The essay
 * is called On the Shortness of Life" over a page of the essay, job 401), the noun he names it by
 * is. Never that for a person: "a man named Paulinus" would pass on any picture of a man, so a
 * person's name must be the picture's own. A picture the film says nothing about passes: the check
 * cannot judge it. Pure.
 */
export function namesThePicture(label: string, s: LayoutScene, namedBy?: string): boolean {
  const seen = pictureWords(s);
  if (!seen.size) return true;
  const head = labelHead(label);
  if (!head || seen.has(head)) return true;
  return !!namedBy && !s.person && !PERSON_NOUN.test(namedBy) && seen.has(stem(namedBy));
}

/** A graphic up for less than this over a picture is an edge on the cut into or out of it (a frame
 * or two of snap), not a graphic on it — the resolver keeps a graphic that crosses a cut at least a
 * second on the new shot. */
const ON_PICTURE_SEC = 0.3;

const overlap = (c: { start: number; end: number }, s: LayoutScene) => Math.min(c.end, s.narrationEndSec) - Math.max(c.start, s.narrationStartSec);

/** The b-roll pictures (no host take, no CTA) a graphic is up over, in film order. Pure. */
export function picturesUnder(c: { start: number; end: number }, film: FilmLayout): LayoutScene[] {
  return film.scenes.filter(s => !s.hostPresent && !s.cta && overlap(c, s) >= ON_PICTURE_SEC);
}

/** What a picture is said to show, for a refusal the repair round reads. */
function described(s: LayoutScene): string {
  const parts = [s.person, s.things?.join(", "), s.shows].filter((x): x is string => !!x);
  return parts.length ? `"${parts[0].length > 80 ? `${parts[0].slice(0, 80)}…` : parts[0]}"` : "something else";
}

/** A SmallLabel's own text. */
const labelText = (c: ResolvedCue): string => (typeof c.props.text === "string" ? c.props.text.trim() : "");

/** The spoken words before a cue's first timed word (up to six). */
function leadOf(c: ResolvedCue, words: Word[]): string[] {
  const first = c.sync.length ? Math.min(...c.sync.map(x => x.wordStart)) : c.start;
  const i = words.findIndex(w => w.start >= first - 1e-6);
  return i > 0 ? words.slice(Math.max(0, i - 6), i).map(w => w.text) : [];
}

/**
 * Why a new SmallLabel may not go where it resolved, or undefined. A label NAMES THE THING IN ITS
 * PICTURE (the catalogue's own condition), so the viewer reads it as the name of what is on screen:
 *   - it must name what every picture it is up over shows (`namesThePicture`) — job 409's "Paulinus"
 *     on the picture of Seneca is refused, and so is job 410's "Federal Aviation Rules" on a picture
 *     of a carry-on bag; job 408's "A toilet auger" on the auger and job 409's "Seneca" on Seneca pass;
 *   - one picture, one name: a label on a picture another label already names by a different word
 *     is refused (job 409's "Paulinus" again, 2 s after "Seneca" on the same still — it stands even
 *     where the film says nothing about the picture). The same name said twice ("Seneca", "Lucius
 *     Annaeus Seneca") is one name.
 * `placed`: every graphic placed with it, resolved. Pure.
 */
export function labelProblem(c: ResolvedCue, placed: ResolvedCue[], film: FilmLayout, words: Word[]): string | undefined {
  if (c.template !== "SmallLabel") return undefined;
  const text = labelText(c);
  if (!text) return undefined;
  const under = picturesUnder(c, film);
  const namedBy = namedAs(leadOf(c, words));
  const wrong = under.find(s => !namesThePicture(text, s, namedBy));
  if (wrong)
    return (
      `"${text}" is not what the picture under it shows — scene #${wrong.index} shows ${described(wrong)}. A SmallLabel names the thing ` +
      `or person IN its picture, so the viewer reads it as the name of what is on screen. Put it on words said over the picture that ` +
      `shows "${text}", show the line as a caption with no name, or drop it`
    );
  const head = labelHead(text);
  for (const other of placed) {
    if (other.id === c.id || other.template !== "SmallLabel" || labelHead(labelText(other)) === head) continue;
    const shared = picturesUnder(other, film).find(s => under.includes(s));
    if (shared)
      return (
        `the picture of scene #${shared.index} is already labelled "${labelText(other)}" (${other.id}) — one picture, one name: a ` +
        `second name on it reads as the name of the same thing. Put it on the picture that shows "${text}", or drop it`
      );
  }
  return undefined;
}

/* ───────────── A card never hides a video, or a list's own pictures ───────────── */

/** A graphic that leaves NOTHING of the footage in view while it is up: a full-screen card, or an
 * overlay over the footage blurred (the Quote). A window graphic still plays the footage in its
 * frame, and a darkening leaves it in view. */
export const hidesTheFootage = (t: TemplateDef): boolean => t.kind === "card" || t.underlay === "blur";

/** The length of the union of intervals. */
function unionLength(spans: [number, number][]): number {
  let sum = 0;
  let reach = -Infinity;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const from = Math.max(a, reach);
    if (b > from) sum += b - from;
    reach = Math.max(reach, b);
  }
  return sum;
}

/** A video in view less than this (or half its length, when that is shorter) is a video nobody sees:
 * under MIN_SHOT_SEC a sliver of a shot reads as a glitch. */
export const VIDEO_MIN_SEEN_SEC = MIN_SHOT_SEC;

/**
 * The first VIDEO picture this graphic leaves nearly unseen, with every graphic placed beside it that
 * hides the footage: in view less than VIDEO_MIN_SEEN_SEC, or half its length when shorter — or
 * undefined. A video is a paid moving clip, and job 408's Versus card (5.67-13.77 s) hid ALL of
 * scene 3 (7.29-13.75, the lidded bin beside the flushing toilet), one of the film's three. A card
 * over part of one is fine: job 396's "3 minutes" card left 2.6 s of its 7.3 s video in view. Only a
 * video this graphic is up over counts against it. Pure.
 */
export function videoHidden(c: ResolvedCue, placed: ResolvedCue[], film: FilmLayout): { scene: LayoutScene; seen: number } | undefined {
  if (!hidesTheFootage(templateById(c.template))) return undefined;
  const hiders = [c, ...placed.filter(p => p.id !== c.id && hidesTheFootage(templateById(p.template)))];
  for (const s of film.scenes) {
    if (!s.video || s.hostPresent || s.cta || overlap(c, s) <= 0.1) continue;
    const a = s.narrationStartSec;
    const b = s.narrationEndSec;
    const covered = unionLength(hiders.map(h => [Math.max(a, h.start), Math.min(b, h.end)] as [number, number]).filter(([x, y]) => y > x));
    const seen = Math.max(0, b - a - covered);
    if (seen < Math.min(VIDEO_MIN_SEEN_SEC, (b - a) / 2) - 1e-3) return { scene: s, seen };
  }
  return undefined;
}

/**
 * The pictures of spoken list items or steps — each drawn for its own item (`listItem`) — that this
 * graphic hides for at least half their length, in film order. Two or more is a list whose every
 * item has its picture, hidden behind one card: job 410's StepCards (141.30-149.57 s) covered the
 * three step pictures (rows of passengers each with a snack; a passenger at the galley; a cookie
 * handed over) for 8.3 s. Over the footage, StepLabels or a list window leave each picture in view.
 * Pure.
 */
export function listPicturesHidden(c: ResolvedCue, film: FilmLayout): LayoutScene[] {
  if (!hidesTheFootage(templateById(c.template))) return [];
  return film.scenes.filter(s => s.listItem && !s.hostPresent && !s.cta && overlap(c, s) >= (s.narrationEndSec - s.narrationStartSec) / 2 - 1e-3);
}

/**
 * Why a NEW graphic may not go where it resolved because of the picture under it — a label that
 * does not name its picture or names one already named (`labelProblem`), a card that hides a video
 * whole (`videoHidden`), or one that hides two or more of a spoken list's own pictures
 * (`listPicturesHidden`) — in words the repair round can act on; undefined when it may. Pure.
 */
export function pictureProblem(c: ResolvedCue, placed: ResolvedCue[], film: FilmLayout, words: Word[]): string | undefined {
  const label = labelProblem(c, placed, film, words);
  if (label) return label;
  const video = videoHidden(c, placed, film);
  if (video) {
    const len = video.scene.narrationEndSec - video.scene.narrationStartSec;
    return (
      `${c.template} hides the picture, and scene #${video.scene.index} is a moving VIDEO: it would be in view only ${video.seen.toFixed(2)} s ` +
      `of its ${len.toFixed(2)} s (at least ${Math.min(VIDEO_MIN_SEEN_SEC, len / 2).toFixed(1)} s). A video is never hidden whole — show the line ` +
      `over the footage (DimCaption, BigNumberOverlay, NumberLabel, SmallLabel), put the card on words said over a still, or drop it`
    );
  }
  const items = listPicturesHidden(c, film);
  if (items.length >= 2) {
    const steps = items.every(s => s.listItem === "step");
    // Steps shown as steps keep their numbering over the footage (job 395's StepCards stood on two
    // list pictures the list finder called things, not steps).
    const asSteps = steps || c.template === "StepCards";
    return (
      `${c.template} hides the pictures of ${items.length} spoken ${steps ? "steps" : "list items"} (scenes ${items.map(s => `#${s.index}`).join(", ")}), ` +
      `each drawn for its own ${steps ? "step" : "item"}. Show them over the footage, which leaves every picture in view — ` +
      `${asSteps ? "StepLabels for the steps" : "a ListWindow, Checklist or IconLabels for the items"}, a DimCaption for a line — or drop it`
    );
  }
  return undefined;
}

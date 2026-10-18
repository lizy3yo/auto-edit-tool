/**
 * PICTURE MEMORY (2026-09-30, the operator: "if we are going scene to scene like a different pov,
 * we can show the same one, like it can have a memory, just a different angle … the same heater").
 * Every picture is drawn from words alone, so Frederick's heater at 0:45 was a different heater
 * from the one at 0:20. A picture of a KEY THING (`scene.keyThing`, from the shot list) is now
 * drawn FROM the earlier pictures of that thing: the first one (its memory) and the latest one
 * before it (so a before → during → after is the same piece further along). Film order is not build
 * order — a build video opens on the finished piece — so a picture of a thing being made
 * (`buildStage`) is drawn only from pictures of it at the same or an earlier stage. Pictures are made in
 * parallel, so a picture whose memory is still being made in this pass waits for it —
 * `MEMORY_WAIT_MS` at most, then it is drawn from words as before. Waits only ever point to an
 * EARLIER scene, and the dispatcher hands scenes out in film order, so the earliest waiting scene's
 * memory is always already running: nothing can wait on itself.
 */
import { PART_VIEW } from "./namedLooks";
import type { KeyThing, StoryboardScene } from "@shared/types";
import { REDRAW_CAMERAS } from "./pictureVariety";
import {
  BUILD_STAGES,
  keyThingsIn,
  nearlySameSubject,
  repeatsTopic,
  sameSubject,
  showsScreen,
  viewIndexOf,
} from "./shotList";

/** The longest a picture waits for its memory before it is drawn from words alone. */
export const MEMORY_WAIT_MS = 8 * 60_000;

/** A picture others are drawn FROM: any drawn cutaway, the QR background included. */
const source = (s: StoryboardScene) => !s.hostPresent && !s.coverHero && !s.assetImageUrl;
/**
 * A picture drawn from memory: any source, and a split screen's panel too (Hank's job 258: the
 * "that's the whole build" split showed a square holder unlike the one built). A split is never a
 * SOURCE — its panel is drawn after the host take, far later than the b-roll that would wait on it.
 */
const drawn = (s: StoryboardScene) => source(s) || (!!s.hostPresent && !!s.splitVisual);

/**
 * The camera positions a memory picture is drawn from, in turn — never the memory picture's own
 * (that one is drawn as described): Frederick's job 257 came back with the same framing four times.
 */
export const MEMORY_VIEWS = [
  "a close view of one part of it, filling most of the frame",
  "seen from a few steps further back, with the place around it in view",
  "seen from the other side",
  "seen from above, looking down on it",
  "seen from low down, close to its own level",
] as const;

/**
 * The earlier cutaways `s` is drawn from: the first picture of its key thing (the memory) and the
 * latest one before `s` when that is a different picture. Empty when `s` shows no key thing or is
 * its first picture. Pure — unit-tested.
 */
export function memorySourcesFor(
  scenes: StoryboardScene[],
  s: StoryboardScene
): StoryboardScene[] {
  // A list item after a group picture of its list is drawn FROM that group picture, so the
  // close-up is the same machine, cutter or pile as in the group (`listSetFor`).
  const set = listSetFor(scenes, s);
  if (set) return [set];
  if (!s.keyThing || !drawn(s)) return [];
  // A LIST ITEM is its own thing: it is drawn from a key thing's memory only when its OWN words name
  // that thing, or it is a part of it (`partOf`). Dale's job 397: "Smalls, about $10 to $40.
  // Coasters, ornaments, small cutting boards." — the coasters and the ornaments both inherited the
  // pile of small pieces as their key thing, were drawn from that pile picture, and came back as the
  // same picture twice.
  if (!ownKeyThing(s)) return [];
  // A SCREEN picture gets its item's memory for what is ON the screen only (`SCREEN_ITEM_VIEW`): with
  // none, Dale's bookcase listing showed four random items (job 306); told to draw "the SAME" board
  // as an object, the picture maker built the tablet out of it (job 295). A screen is still never a
  // memory SOURCE (below).
  const i = scenes.indexOf(s);
  if (i <= 0) return [];
  // A list item is never drawn from another item's picture: each item is its own thing.
  // …nor is a screen ever a memory SOURCE: the thing on it is a small photo, not the thing.
  // …nor a picture FURTHER ALONG than this one (`laterStage`): build videos open on the finished
  // piece, and Hank's job 268 drew "hands drilling a hole into a charred cedar block" from the hook's
  // "charred cedar incense holder …, finished and oiled". That holds for every source, whatever key
  // thing it was filed under — Ruth's job 348 drew a strip being folded round its cord (key thing:
  // the cord) from a finished bowl filed under the tin of squares.
  // …nor a picture whose own check said the thing is not in it (`memoryUnfit`): stored films had 22
  // first pictures copied after failing their last check, 122 later pictures drawn from them.
  const before = scenes
    .slice(0, i)
    .filter(
      x => source(x) && !isScreen(x) && !(s.listCut && x.listCut) && !laterStage(x, s) && !x.memoryUnfit
    );
  const out: StoryboardScene[] = [];
  const add = (x: StoryboardScene | undefined) => {
    if (x && !out.includes(x) && out.length < MAX_MEMORY_REFS) out.push(x);
  };
  // Its own thing: the memory (`memoryOf`) and the latest picture before it.
  const same = before.filter(x => shows(x, s.keyThing!));
  add(memoryOf(same, s.keyThing));
  add(same[same.length - 1]);
  // Every other key thing in it: that thing's memory (the heater beside the mattress).
  for (const t of s.otherKeyThings ?? []) add(memoryOf(before.filter(x => shows(x, t)), t));
  return out;
}

/** The words a picture is drawn by: a split's panel description, else its own. */
const pictureWords = (s: StoryboardScene) =>
  s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "";

/**
 * THE PICTURE RIGHT BEFORE IS A MEMORY, NEVER A TEMPLATE (2026-10-18, job 399 scenes 16-17): "hands
 * pouring soda into an ice-filled plastic cup at the cart" was the memory of the next picture, "a
 * small plastic cup barely filled with ginger ale on a tray table". Handed the picture just shown, the
 * picture maker came back with the same hands tipping the same can into the same cup at the same
 * angle — only the background changed, one picture for 27 s. Told "the same cup, from another spot",
 * it kept everything but the spot. So when the picture shown right before `s` is one of `s`'s memory
 * pictures and is about something else, `s` is told to take only the thing's look from it
 * (`rightBeforeClause`), and the same-thing check compares `s` with THAT picture. "Something else" is
 * told by the words alone, so it also takes the same thing described anew (job 397 scenes 28-29: the
 * board close up on the bench, then leaning against the wall) — where a new photo is right too.
 *
 * "Right before" skips full-frame host takes (`lastPictureBefore`): picture, host, picture reads as
 * the same picture twice just the same (job 404 scenes 5-7: the robin on the lawn, the host's
 * introduction, the robin on the lawn again a little closer).
 *
 * Returns that picture, or undefined: when the picture before is not one of its memories, when `s`
 * continues it (that is `continuedPicture`'s), and for a list item drawn from its list's group
 * picture or a screen, whose framing is set apart already (`SET_ITEM_VIEW`, `SCREEN_ITEM_VIEW`).
 * Pure.
 */
export function rightBeforeToRecompose(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): StoryboardScene | undefined {
  const i = scenes.indexOf(s);
  if (i <= 0 || s.sameShot || listSetFor(scenes, s) || isScreen(s)) return undefined;
  const before = lastPictureBefore(scenes, s);
  if (!before || !sources.includes(before)) return undefined;
  const [a, b] = [pictureWords(before), pictureWords(s)];
  if (!a.trim() || !b.trim() || sameSubject(a, b) || nearlySameSubject(a, b) || repeatsTopic(a, b)) return undefined;
  return before;
}

/**
 * The picture a viewer saw last before `s`: the one right before it, or — when full-frame host takes
 * sit between — the last picture before them. A split screen stops the walk: its panel is a picture
 * the viewer sees. Undefined when that is not a drawn full-frame picture. Pure.
 */
export function lastPictureBefore(scenes: StoryboardScene[], s: StoryboardScene): StoryboardScene | undefined {
  let i = scenes.indexOf(s) - 1;
  while (i >= 0 && scenes[i].hostPresent && !scenes[i].splitVisual) i--;
  const p = i >= 0 ? scenes[i] : undefined;
  return p && source(p) ? p : undefined;
}

/**
 * A CONTINUATION IS A NEW PHOTO OF THE SAME THING (2026-10-18, the review of jobs 401-405: 15
 * near-copies). A topic that runs past its limit, a split picture's later part, or the planner
 * repeating its own words is drawn as "the same words + a view" (`OTHER_VIEWS`) FROM the picture
 * it continues — and the reference pinned the composition while the stock view phrase moved
 * nothing: job 405 scene 8 (the cat lowering its face to the sleeper, "a close-up of one detail of
 * it") came back at scene 7's distance and framing, scene 22 (the cat at the window, close up) was
 * scene 21 a little tighter, job 401 scene 3 was scene 2's over-the-shoulder card shot with other
 * cards in the hands, and job 403 scene 14 was scene 10's pipe run under the house a little closer.
 * So a continuation is told what a picture drawn from the one just shown is told (`rightBeforeClause`):
 * the picture it continues lends only the thing's look, with a concrete camera (`REDRAW_CAMERAS`,
 * `memoryViewFor`), and the same-thing check lays it beside THAT picture (`sameThingReference`),
 * where it used to be laid beside the thing's first picture (scene 22 was compared with scene 7, the
 * cat on the sleeper's chest, and passed).
 *
 * Returns the latest of `s`'s memory pictures whose words `s` repeats once any view is taken off
 * (`repeatsTopic` — job 403 scene 14 repeats scene 10, 11 s and three pictures later), else, for a
 * picture marked to continue (`sameShot`) whose words were rewritten, the picture right before it.
 * Undefined for a list item drawn from its group picture and a screen, whose framing is set apart
 * already. Pure.
 */
export function continuedPicture(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): StoryboardScene | undefined {
  const i = scenes.indexOf(s);
  if (i <= 0 || listSetFor(scenes, s) || isScreen(s)) return undefined;
  const words = pictureWords(s);
  const byWords = sources
    .filter(x => repeatsTopic(pictureWords(x), words))
    .sort((a, b) => scenes.indexOf(b) - scenes.indexOf(a))[0];
  if (byWords) return byWords;
  const before = scenes[i - 1];
  return s.sameShot && sources.includes(before) ? before : undefined;
}

/**
 * What `s` is drawn FROM as the picture it must not repeat: the picture it continues
 * (`continuedPicture`, `continues: true`), else the one shown right before it about something else
 * (`rightBeforeToRecompose`). Pure.
 */
export function recomposeFrom(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): { from: StoryboardScene; continues: boolean } | undefined {
  const cont = continuedPicture(scenes, s, sources);
  if (cont) return { from: cont, continues: true };
  const before = rightBeforeToRecompose(scenes, s, sources);
  return before ? { from: before, continues: false } : undefined;
}

/**
 * The picture the near-copy check ALWAYS lays beside `s`, whatever the fingerprints say
 * (`nearCopyCandidates`' `always`): what it is drawn from as the picture it must not repeat
 * (`recomposeFrom`), else — a picture with no memory link — the latest earlier picture whose words it
 * repeats, else, marked to continue (`sameShot`), the picture right before it. That is the check a
 * copy drawn from WORDS still meets: job 405 scene 8 and job 401 scenes 3 and 5 copied their memory
 * twice, were drawn from words with no reference, and shipped as the same composition unchecked.
 * Never a split panel: a split is never a memory source, and panels meet the near-copy check through
 * their fingerprints (`nearCopyCandidates`). Pure.
 */
export function nearCopyPartnerFor(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): StoryboardScene | undefined {
  const i = scenes.indexOf(s);
  if (i <= 0 || !source(s) || listSetFor(scenes, s) || isScreen(s)) return undefined;
  const re = recomposeFrom(scenes, s, sources);
  if (re) return re.from;
  const words = pictureWords(s);
  for (let j = i - 1; j >= 0; j--) {
    const x = scenes[j];
    if (source(x) && !isScreen(x) && repeatsTopic(pictureWords(x), words)) return x;
  }
  const before = scenes[i - 1];
  return s.sameShot && source(before) ? before : undefined;
}

/**
 * Of `continuedPicture`, the picture `s` continues by REPEATING its words, any view aside: nothing in
 * its words sets it apart, so only a concrete camera can (`continuationCameraIndex`). A picture
 * marked to continue (`sameShot`) whose words were rewritten keeps the framing its own words ask for:
 * job 398 scene 10, "close view of hands pressing a thin pale pine strip into the half-depth notches
 * of a crossing strip", marked to continue scene 9's lattice lying flat on the bench, was drawn close
 * up and would have been told "seen from much further back … the subject small in it". It is still
 * drawn from the picture it continues as one (`memoryContinues`) and compared with it. Pure.
 */
export function repeatedPicture(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): StoryboardScene | undefined {
  const from = continuedPicture(scenes, s, sources);
  return from && repeatsTopic(pictureWords(from), pictureWords(s)) ? from : undefined;
}

/**
 * The camera a continuation that repeats its picture's words (`repeatedPicture`) is drawn from, as
 * an index into `REDRAW_CAMERAS` (one per `OTHER_VIEWS` entry, same order): the one its own words'
 * view names, else the next after the camera of the picture it repeats — and never that picture's
 * own. Job 405 scenes 22 and 24 both said "a close-up of one detail of it" (a host glimpse cut one
 * picture in two), were both drawn close up from the same reference, and came back as one picture
 * twice. Any other picture reads its own view (-1 for none). Pure.
 */
export function continuationCameraIndex(scenes: StoryboardScene[], s: StoryboardScene, depth = 0): number {
  const own = viewIndexOf(pictureWords(s).replace(/[\s.]+$/, ""));
  const from = depth < 8 ? repeatedPicture(scenes, s) : undefined;
  if (!from) return own - 1;
  const prev = continuationCameraIndex(scenes, from, depth + 1);
  const n = REDRAW_CAMERAS.length;
  let k = own > 0 ? own - 1 : (prev + 1) % n;
  if (k === prev) k = (k + 1) % n;
  return k;
}

/** What the still loop does with the same-thing check's answer on a memory picture (`sameThingMove`). */
export type SameThingMove = "pass" | "redraw" | "words" | "flag";

/**
 * WHAT THE SAME-THING CHECK'S ANSWER DOES (`scanSameThing`). `before`: what it refused the draw
 * before this one for, if anything.
 * - The first answer: a different thing, or a copy of the reference's framing → "redraw" from memory.
 * - After a DIFFERENT thing it is not asked again (the caller skips it): SAMENESS BEATS THE ANGLE —
 *   the one redraw from memory is kept, since a fallback drawn from words gave Frederick's job 259 a
 *   different heater and mattress.
 * - After a COPY, still a copy → "words": a copy repeats a picture the viewer has just seen, so it is
 *   drawn from words with the thing's written look rather than kept (job 399 scene 17). Now a
 *   different thing → "flag": kept, as before, but on the record — the check said so.
 * A close-up of one part (`partOf`) is a different view of the whole by design: only a copy counts.
 * Pure.
 */
export function sameThingMove(
  verdict: { same: boolean; copy: boolean },
  before: "copy" | "different" | undefined,
  partOf = false
): SameThingMove {
  if (before === "different") return "pass";
  const different = !verdict.same && !partOf;
  if (verdict.copy) return before === "copy" ? "words" : "redraw";
  if (different) return before === "copy" ? "flag" : "redraw";
  return "pass";
}

/**
 * THE MEMORY IS A PICTURE ABOUT THE THING: the earliest of `pictures` whose own key thing is `thing`
 * and that is about it (`isSubject`), else the earliest. The first picture to show a thing is often
 * a wide shot with it small — Dale's job 352 drew every later benchtop planer from "garage workshop
 * with table saw and benchtop planer along back wall", while the very next picture was "man's hands
 * feeding a rough-sawn board into a benchtop planer" (stored films: 123 of 467 memories were not
 * about their thing, copied 390 times). Pure.
 */
function memoryOf(pictures: StoryboardScene[], thing: string): StoryboardScene | undefined {
  return pictures.find(x => ownKeyThing(x) === thing && isSubject(x, thing)) ?? pictures[0];
}

/** Size and amount words: they say nothing about WHICH thing is meant. */
const NOT_A_NAME_WORD = new Set([
  "small", "smaller", "little", "big", "bigger", "large", "larger", "tiny", "huge", "few", "many",
  "some", "one", "two", "three", "four", "five", "old", "new", "the", "and", "with", "for",
]);

/**
 * Whether a line's own words name key thing `thing`: a word of its name (not a size or amount word),
 * singular or plural, appears in the line. "small cutting boards" names "walnut and maple cutting
 * board"; "Coasters," does not name "small wood pieces pile". Pure.
 */
export function wordsName(line: string, thing: string): boolean {
  const base = (w: string) => w.replace(/(?:es|s)$/, "");
  const have = new Set(nameWords(line).map(base));
  return nameWords(thing).some(w => !NOT_A_NAME_WORD.has(w) && have.has(base(w)));
}

/** A list item as said: "and a stack of sandpaper." → "a stack of sandpaper". */
const itemWords = (t: string) =>
  t.trim().replace(/^(?:and|or|plus|then)\s+/i, "").replace(/[\s,.;:!?—–-]+$/, "").trim();

/**
 * A list item's own words and the other items of its list (the run of list items around it), or
 * undefined for a picture that is not one of two or more items. Pure.
 */
export function listItemsAround(
  scenes: StoryboardScene[],
  s: StoryboardScene
): { own: string; others: string[] } | undefined {
  if (!s.listCut) return undefined;
  const i = scenes.indexOf(s);
  let a = i;
  let b = i;
  while (a > 0 && scenes[a - 1].listCut) a--;
  while (b < scenes.length - 1 && scenes[b + 1].listCut) b++;
  const own = itemWords(s.scriptText ?? "");
  const others = scenes
    .slice(a, b + 1)
    .filter(x => x !== s)
    .map(x => itemWords(x.scriptText ?? ""))
    .filter(t => t && t.toLowerCase() !== own.toLowerCase());
  return own && others.length ? { own, others } : undefined;
}

/**
 * The key thing picture `s` is about, by the rule above: a list item's inherited key thing counts
 * only when the item's own words name it or it is a part of it. The memory step and the picture
 * check both read it, so a coasters picture is neither drawn from nor held to the pile. Pure.
 */
export function ownKeyThing(s: StoryboardScene): string | undefined {
  if (!s.keyThing) return undefined;
  // A STEP of making the thing is about that thing whatever its words call it ("oil it,"): it is
  // drawn from the thing's memory, and only at the same or an earlier stage (`laterStage`). A step
  // with no stage builds nothing ("and read the label.") and keeps the list-item rule below.
  if (s.listCut && s.listKind === "steps" && s.buildStage) return s.keyThing;
  if (s.listCut && !s.partOf && !wordsName(s.scriptText ?? s.narration ?? "", s.keyThing)) return undefined;
  return s.keyThing;
}

/** Where a stage sits, earliest first; undefined for a picture with no stage. */
const stageRank = (s: StoryboardScene) =>
  s.buildStage ? BUILD_STAGES.indexOf(s.buildStage) : undefined;

/**
 * Whether picture `x` shows the thing being made FURTHER ALONG than picture `s` does — both must
 * carry a stage; a picture without one is never judged, so its memory is exactly as before. Pure.
 */
export function laterStage(x: StoryboardScene, s: StoryboardScene): boolean {
  const [a, b] = [stageRank(x), stageRank(s)];
  return a !== undefined && b !== undefined && a > b;
}

/** A picture of the thing being made before it is finished: the raw material, or partly made. */
export const beforeFinished = (s: StoryboardScene) =>
  s.buildStage === "material" || s.buildStage === "making";

/**
 * How a key thing is named to the picture check while something is still being made. Conditional,
 * because the stage belongs to the PICTURE and its key thing may be the bench or a tool it is made
 * with (stored step pictures were filed under "workbench", "oil finish rag", the sewing machine):
 * a workbench "not yet finished" would be failed for being a whole workbench.
 */
export const UNFINISHED_THING =
  "— when it is what is being made: as it is at this stage of being made (raw pieces or partly built, not yet finished)";

/**
 * The key things the picture check holds a picture to (`requiredThingsQuestion`): its own and every
 * other one in it. Before the thing is finished its own is named at that stage — told only "incense
 * holder", the check could fail a correct raw block being drilled as a different object where the
 * holder should be, and push the step back toward the finished piece (on stored films, step
 * pictures drawn from the finished piece were flagged "missing" 5 times in 31, every other
 * key-thing picture 92 in 1,396). Pure.
 */
export function requiredThingsFor(s: StoryboardScene): string[] {
  const own = ownKeyThing(s);
  return [own && beforeFinished(s) ? `${own} ${UNFINISHED_THING}` : own, ...(s.otherKeyThings ?? [])].filter(
    (t): t is string => !!t
  );
}

/*
 * ONE LOOK PER KEY THING (2026-10-18). Every key thing has a look written from the script before
 * anything is drawn (`KeyThing.look`, the props list), but it reached the picture maker only through
 * the prompt writer: Ruth's job 305 drew its first straight-stitch machine from "a straight-stitch
 * machine, a rotary cutter and a mountain of scraps … at a kitchen table" — no colour, no material —
 * while the look said "small black and chrome sewing machine", and 5 later pictures were drawn from
 * that one. A picture drawn FROM memory has its thing's own earlier picture to follow, and a text
 * look beside that reference only sets up a conflict, so the look goes ONLY into a picture with no
 * picture of its own thing to follow (`keyThingLookFor`, `memoryFor`). It is cut down first: where
 * the thing sits belongs to the picture (581 of 1229 stored looks name a place — "sits centered on
 * work table" would put a work table into every picture of the machine), and so does how far along
 * it is.
 */

/** Verbs that say where a thing is kept or left: with a place word after them, always its place. */
const STORING =
  "sitting|sat|resting|rested|placed|kept|stored|stacked|piled|hanging|hung|leaning|leaned|propped|" +
  "standing|lying|laid|displayed|positioned|tucked|perched|parked|located|pushed|staged|grouped|" +
  "left|lined";
/** Verbs that also say how a part sits on the thing itself ("a felt dot centered on the bottom"). */
const ATTACHING =
  "set|mounted|centered|centred|fixed|pinned|tacked|nailed|tied|clipped|held|arranged|spread|" +
  "scattered|draped|folded|pressed";
/** Verbs that say where it is with no place word after them ("sits upright", "resting open"). */
const ALWAYS_PLACE = "sits|rests|hangs|stands|lies|leans|lives|waits|perches";
const STARTS_RESTING = `${ALWAYS_PLACE}|sitting|resting|hanging|standing|lying|leaning|propped|perched|parked|positioned|displayed|located`;
/** What follows a placing verb when it places ("set apart on", "clipped to", "lies flat under"). */
const PLACE_PREPS =
  "on|onto|in|inside|into|at|by|near|nearby|beside|next to|against|along|across|over|under|" +
  "underneath|beneath|below|above|behind|in front of|among|amid|within|around|outside|off|atop|" +
  "upon|to|from|up|down|together|apart|upright|flat|flush|evenly|loosely|neatly|tightly|closely|" +
  "directly|away|out|open|closed|ready|high|low";
/** The places a look puts its thing ("on the work table", "in the garage", "by the table leg"). */
const PLACE_NOUNS =
  "tables?|bench(?:es)?|workbench(?:es)?|shel(?:f|ves)|counters?|countertops?|desks?|floors?|walls?|" +
  "garage|kitchen|workshop|shop|studio|room|corner|porch|yard|garden|barn|shed|stands?|sawhorses?|" +
  "windows?|windowsills?|sills?|doors?|doorways?|driveway|pegboard|racks?|stalls?|fair|market|" +
  "trays?|baskets?|hooks?|ceiling|mantel|hearth|chairs?|beds?|couch|sofa|steps|stairs|lawn|" +
  "field|street|road|curb|belt|station|area|spot|mat|vise|pockets?";
/**
 * A part of the thing itself, not followed by a place: "a felt dot centered on the bottom", "a
 * button set into the center of its face" are its look — "the front door" is a place.
 */
const OWN_PART =
  `(?!\\s+(?:(?:the|its|a|an|one)\\s+)?(?:(?:front|back|top|bottom)\\s+)?(?:bottom|top|underside|front|back|sides?|ends?|edges?|faces?|lid|base|middle|cent(?:er|re)|rim|surface|handle)\\b(?!(?:\\s+[\\w'-]+){0,3}\\s+(?:${PLACE_NOUNS})\\b))`;
const ADVERB = `(?:\\s+(?:[a-z]+ly|just|right))?`;
const PLACING =
  `(?:(?:${STORING})${ADVERB}\\s+(?:${PLACE_PREPS})\\b` + `|(?:${ATTACHING})${ADVERB}\\s+(?:${PLACE_PREPS})\\b${OWN_PART})`;
const PLACE_CLAUSE = new RegExp(
  `^(?:[a-z]+ly\\s+)?(?:` +
    `(?:[a-z]+-)?(?:(?:${STARTS_RESTING})\\b|${PLACING})` +
    `|(?:[a-z]+-)?(?:${STORING}|${ATTACHING})\\b.*\\b(?:${PLACE_NOUNS})\\b` +
    `|(?:beside|near|nearby|next to|against|under|underneath|beneath|behind|above|below|outside|` +
    `inside|outdoors?|indoors?|atop|within reach)\\b` +
    `|(?:on|in|at|by|along|off)\\s+(?:the|a|an|its|his|her|their)?\\s*(?:[\\w'-]+\\s+){0,3}(?:${PLACE_NOUNS}|hands?)\\b` +
    `|(?:cent(?:er|re)|middle|corner|edge|end|side|top) of (?:the|a|an)\\s+(?:[\\w'-]+\\s+){0,2}(?:${PLACE_NOUNS})\\b)`,
  "i"
);
/** Where a place starts INSIDE a clause ("neatly folded quilts stacked in a row"). */
const PLACE_INSIDE = new RegExp(
  `\\s(?:(?:${ALWAYS_PLACE})\\b|(?:[a-z]+-)?${PLACING}` +
    `|(?:near|nearby|beside|next to|against|behind)\\b${OWN_PART}` +
    `|(?:on|in|at|by|under|beneath|underneath|outside|inside|along|above|below|atop)\\s+` +
    `(?:the|a|an|its|his|her|their)?\\s*(?:[\\w'-]+\\s+){0,2}(?:${PLACE_NOUNS})\\b)`,
  "i"
);
/** A clause about the light, the time or the scene around the thing, what it is for, or another thing. */
const NOT_ITS_LOOK =
  /\b(?:outdoors?|indoors?|setting|lighting|daylight|sunlight|lamplight|sky|casting|glow(?:ing)?|in the (?:evening|morning|afternoon|night)|at night|visible beyond|in the background|backdrop|shown|seen|used (?:for|to|as)|for comparison|where|than)\b/i;
/** What a cut leaves dangling: a placing word with nothing after it ("furniture piece sitting ready"). */
const DANGLING = new RegExp(
  `(?:\\s+(?:${STORING}|${ATTACHING}|${ALWAYS_PLACE})(?:\\s+(?:or|and)\\s+[a-z]+)*(?:\\s+(?:[a-z]+ly|together|ready|open|closed))*)+$`,
  "i"
);
/** A clause left starting on a placing word ("hanging or grouped together") says only where it is. */
const PLACING_START = new RegExp(`^(?:${STORING}|${ATTACHING}|${STARTS_RESTING})\\b`, "i");

/**
 * Words of how far along a thing is — what has been done or added to it. A first picture of a thing
 * being made has no picture of it to follow (`memorySourcesFor` drops the finished ones), and the
 * MAIN thing's look describes it finished: Hank's job 258 — "single angled hole drilled halfway
 * through, thin coat of oil giving a soft sheen, round felt dot centered on the bottom" — put onto
 * "hands drilling an angled hole into a charred cedar scrap" would draw the finished holder again.
 * SURFACE work changes the colour as well (charred black, oiled, painted), so its colours are not the
 * raw thing's; SHAPE work (coiled, stitched, drilled, a felt dot added) leaves the material's colour
 * as it was.
 */
const SURFACE_STAGE =
  /\b(?:(?:un)?finish(?:ed|es|ing)?|oil(?:ed|s|y)?|coat(?:ed|ing|s)?|sheen|glossy|sanded|polish\w*|paint(?:ed)?|stain(?:ed)?|dyed|bleached|varnish\w*|lacquer\w*|waxed|glazed|fired|baked|charred|scorched|blackened|burn(?:t|ed)|brushed|sealed|cured)\b/i;
const SHAPE_STAGE =
  /\b(?:drill(?:ed|ing)|holes?|felt (?:dots?|pads?)|dots?|carv\w*|routed|glue[ds]?|quilt(?:ed|ing)|stitch(?:ed|es|ing)?|sewn|seams?|hemmed|binding|coil(?:ed|s)?|wrapped|crochet\w*|knit(?:ted)?|woven|pieced|braided|assembled|joined|joints?|fitted|attached|installed|upholstered|trimmed|completed?|framed|mounted)\b/i;
/** A part added to the thing: its material is the part's, not the thing's ("a felt dot"). */
const ADDED_PART = /^(?:dots?|pads?|patch(?:es)?|trim|binding|edging|backing|lining|tassels?|fringe|buttons?|tags?)$/;
/**
 * Writing on the thing: a picture carries none unless its line says it (`pictureText`), and the
 * props list is told to list nothing with marks — yet "marked with letter I" and "routed lettering"
 * are stored looks, and would ask for writing in every picture of the thing.
 */
const WRITING =
  /\b(?:letter(?:s|ing|ed)?|labell?ed|labels?|text|words?|numbers?|numbered|writing|written|handwritten|logo|brand(?:ed)?|monogram\w*|initials?|date code|marked with|engrav\w*|last-name|names?)\b/i;

/** Colour and material words: the part of a look that holds at every stage of making. */
const COLOUR_MATERIAL = new Set(
  (
    "black white grey gray silver chrome gold golden brass bronze copper red orange yellow green blue " +
    "navy teal turquoise purple violet pink brown tan beige cream ivory khaki olive maroon burgundy " +
    "rust amber charcoal two-tone multicolored multicoloured colour colours color colors coloured " +
    "colored colorful colourful striped stripes plaid checked floral print prints patterned " +
    "wood wooden timber oak walnut maple cedar pine cherry ash birch beech mahogany teak poplar " +
    "plywood mdf melamine bamboo cork metal metallic steel iron cast-iron aluminium aluminum tin " +
    "zinc plastic vinyl rubber silicone glass ceramic porcelain clay stone marble granite slate " +
    "concrete brick leather suede fabric cloth cotton wool woollen woolen yarn linen denim felt " +
    "canvas burlap silk velvet fleece flannel paper cardboard wicker rattan straw cord rope twine " +
    "string thread wire mesh resin acrylic"
  ).split(" ")
);
/** Words that shade a colour or material ("dark walnut", "mixed scrap colors") — never alone. */
const SHADES = new Set(
  "dark pale light deep bright soft muted mixed varied assorted natural warm cool dull matte scrap and".split(" ")
);
const lookWords = (clause: string) =>
  clause
    .toLowerCase()
    .split(/\s+/)
    .flatMap(w => {
      const bare = w.replace(/[^a-z-]/g, "");
      return COLOUR_MATERIAL.has(bare) ? [bare] : bare.split("-");
    })
    .filter(Boolean);
const hasColourMaterial = (clause: string) => lookWords(clause).some(w => COLOUR_MATERIAL.has(w));

/**
 * The colour and material words of one clause, in their own runs ("dark walnut and pale maple"),
 * leaving out a material that belongs to an added part ("round felt dot" is not felt all over).
 */
function colourMaterialRuns(clause: string): string[] {
  const runs: string[] = [];
  let run: string[] = [];
  const close = (next?: string) => {
    while (run.length && SHADES.has(run[run.length - 1])) run.pop();
    if (run.some(w => COLOUR_MATERIAL.has(w)) && !(next && ADDED_PART.test(next))) runs.push(run.join(" "));
    run = [];
  };
  for (const w of lookWords(clause)) {
    if (COLOUR_MATERIAL.has(w) || (SHADES.has(w) && (w !== "and" || run.length))) run.push(w);
    else close(w);
  }
  close();
  return runs;
}

/**
 * A key thing's look cut down for ONE picture. Every mode drops where it sits, the light and
 * setting around it, what it is used for, comparisons with other things and any writing on it.
 * "noStage" also drops every clause about what has been done or added to it. "colourMaterial" keeps
 * only its colours and materials, the one part of a look that holds at every stage of making — Ruth's
 * coiled bowl, "roughly six inches across, smooth rounded shape", is not the strip it starts as: a
 * clause of plain colour or material stays whole ("striped in rounds of color"), a clause about
 * shaping keeps only its colour and material words, a clause about the surface keeps nothing. Pure.
 */
export function pictureLook(look: string, mode: "full" | "noStage" | "colourMaterial" = "full"): string {
  const clauses = look
    .replace(/[.\s]+$/, "")
    .split(/\s*[,;]\s*|\s+[—–]\s+/)
    .map(c => c.trim())
    .filter(c => c && !PLACE_CLAUSE.test(c) && !NOT_ITS_LOOK.test(c) && !WRITING.test(c))
    .map(c => {
      const m = PLACE_INSIDE.exec(c);
      if (!m) return c;
      // What is left before the place, minus a placing word left dangling ("hanging or grouped
      // together near the coasters" leaves nothing of the look) and an article left hanging ("knit
      // sweater with a folded high neck" read "folded high" as a place and left "… with a").
      const left = c
        .slice(0, m.index)
        .replace(DANGLING, "")
        .replace(/(?:\s+(?:a|an|the|its|his|her|their))+$/i, "")
        .replace(/\s+(?:or|and|with)$/i, "")
        .trim();
      return PLACING_START.test(left) ? "" : left;
    })
    .filter(c => c && !/^(?:and|or|with)$/i.test(c));
  if (mode === "full") return clauses.join(", ");
  if (mode === "noStage") return clauses.filter(c => !SURFACE_STAGE.test(c) && !SHAPE_STAGE.test(c)).join(", ");
  const kept = clauses.flatMap(c =>
    SURFACE_STAGE.test(c) ? [] : SHAPE_STAGE.test(c) ? colourMaterialRuns(c) : hasColourMaterial(c) ? [c] : []
  );
  return Array.from(new Set(kept)).join(", ");
}

/**
 * The look picture `s` is drawn by when nothing earlier of its own thing is there to follow, or
 * undefined: its own key thing's look (`ownKeyThing` — a list item that only inherited a key thing
 * gets none), cut down by its stage. Before the thing is finished, only colours and materials. In a
 * video that MAKES something (`makes`: some picture of it carries a stage), the MAIN thing's look
 * describes the finished piece, so on a picture not marked finished ("done") its finish and added
 * parts go too. A video that makes nothing has no stage to protect, so its MAIN look is kept whole:
 * stripping it took the colours off job 373's dog ("a medium-sized tan and white dog with a short
 * coat" — the coat read as a coat of oil) and left job 397's board only "rounded corners, medium
 * size"; 48 of 113 stored MAIN looks lost colour or material words that way. Pure.
 */
export function keyThingLookFor(
  s: StoryboardScene,
  things: KeyThing[] | undefined,
  makes = true
): string | undefined {
  const own = ownKeyThing(s);
  const thing = own ? things?.find(k => k.name === own) : undefined;
  if (!thing?.look?.trim()) return undefined;
  const mode = beforeFinished(s)
    ? "colourMaterial"
    : makes && thing.main && s.buildStage !== "done"
      ? "noStage"
      : "full";
  return pictureLook(thing.look, mode) || undefined;
}

/**
 * The image-prompt line that carries a key thing's look (`scene.keyThingLook`, set only on a picture
 * with no picture of its own thing to follow). A named kind's exact look (`namedLook`) wins. The
 * picture's own words still decide where it is, which part shows and how far along it is. Pure.
 */
export function keyThingLookClause(scene: StoryboardScene): string {
  if (scene.namedLook || !scene.keyThingLook || !scene.keyThing) return "";
  const own = " — where it is, which part of it shows and how far along it is are as this picture's own words say.";
  return beforeFinished(scene)
    ? ` THE ${scene.keyThing.toUpperCase()}'S COLOURS AND MATERIALS, the same in every picture of this video: ${scene.keyThingLook}${own}`
    : ` HOW THE ${scene.keyThing.toUpperCase()} LOOKS in every picture of this video: ${scene.keyThingLook}. Draw this same one${own}`;
}

/**
 * A SPLIT PANEL WEARS ITS THING'S NAMED LOOK (2026-10-18, job 400 scene 27). The named-things step
 * (`describeNamedLooks`) reads only full-frame pictures, so a panel never carried the exact look of
 * the kind its key thing is: the essay scroll at scenes 20, 28 and 34 was drawn by "papyrus scroll:
 * … rolled into a cylinder … a thin brown cord tied around its middle", while the panel at 27, six
 * seconds before 28, had only its own words ("an aged papyrus scroll laid flat on a wooden desk, the
 * surface worn and darkened") and came back a blank parchment on two dark rollers — another object.
 * So a panel takes the look the pictures ABOUT its key thing carry — the one more than half of them
 * carry — when that kind is a kind of the thing (its name names the thing, or the panel's own words
 * name the kind). Counted from pictures whose own thing it is and that are about it (`isSubject`):
 * never a close-up of one part (a block on a quilt is a kind of its own), a screen (an app's look),
 * or a picture with the thing beside its subject. Never onto a panel that has a look of its own, or
 * a screen panel. Undefined for anything that is not a split. Pure.
 */
export function panelNamedLook(scenes: StoryboardScene[], s: StoryboardScene): string | undefined {
  if (!s.hostPresent || !s.splitVisual || s.namedLook || isScreen(s)) return undefined;
  const thing = ownKeyThing(s);
  if (!thing) return undefined;
  const about = scenes.filter(
    x => x !== s && source(x) && ownKeyThing(x) === thing && !x.partOf && !isScreen(x) && isSubject(x, thing)
  );
  const carried = new Map<string, number>();
  for (const x of about) if (x.namedLook) carried.set(x.namedLook, (carried.get(x.namedLook) ?? 0) + 1);
  for (const [look, n] of Array.from(carried)) {
    const kind = look.split(":")[0];
    if (n * 2 > about.length && (wordsName(thing, kind) || wordsName(s.splitVisual, kind))) return look;
  }
  return undefined;
}

/** How a SCREEN picture uses its item's memory: only as the photo inside the listing. */
export const SCREEN_ITEM_VIEW =
  "the item appears only as the photo inside the listing on the screen";

/** The camera position of a list item drawn from its list's group picture. */
export const SET_ITEM_VIEW =
  "a close-up that fills the frame with just this one item, the very one from the group in the reference";

/**
 * The group picture a list item is drawn from: the `listSet` picture right before its list (walking
 * back over the other items). Undefined for anything else. Pure.
 */
export function listSetFor(scenes: StoryboardScene[], s: StoryboardScene): StoryboardScene | undefined {
  if (!s.listCut) return undefined;
  let i = scenes.indexOf(s) - 1;
  while (i >= 0 && scenes[i].listCut) i--;
  return i >= 0 && scenes[i].listSet ? scenes[i] : undefined;
}

/**
 * How a remembered thing is drawn when it is NOT what the picture is about (2026-10-02, Frederick's
 * job 335 at 0:07: "the one kind of fire that likes to start while the house is asleep" drew the
 * smoke alarm on the ceiling filling the frame, the smouldering bed a dark corner — the alarm was the
 * picture's key thing only because the description named it last, and memory's camera rotation gave
 * it "a close view … filling most of the frame").
 */
export const BACKGROUND_VIEW =
  "kept where the description puts it, at its natural size beside what the picture is about — never close up and never the centre of the picture";

/**
 * A picture about printing the line talks about without saying the words (`blurPrint`): near enough
 * to see it is printing, too far to read a word. A close-up of print is drawn sharp whatever the
 * prompt says (job 335's label at 1:05, refused for readable writing four times, then shipped).
 */
export const BLUR_PRINT_VIEW =
  "the part this picture is about turned toward the camera, in the middle of the frame and clearly its subject, seen from about an arm's length away — near enough to see there is printing on it, too far for any word to be read";

/** Where a description's LEAD ends: what it names first is what the picture is about. */
const LEAD_END =
  /[,;:]|\s[—–-]\s|\b(?:with|beside|next to|behind|above|below|beneath|underneath|in the background|in front of|while|near|nearby)\b/i;

const nameWords = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 2);

/**
 * Whether key thing `thing` is what picture `s` is ABOUT rather than something beside it: its name
 * is matched in the description's lead (up to the first comma or "with / beside / above …") and in
 * the rest, and it is in the background only when the rest names it more fully than the lead ("thin
 * smoke rising from a smouldering mattress …, a smoke alarm on the ceiling above"). Any picture,
 * any thing, any channel — no word list of things. Pure.
 */
export function isSubject(s: StoryboardScene, thing: string): boolean {
  const text = s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "";
  const m = LEAD_END.exec(text);
  if (!m) return true;
  const name = nameWords(thing);
  if (!name.length) return true;
  const hits = (part: string) => {
    const have = new Set(nameWords(part));
    return name.filter(w => have.has(w) || have.has(`${w}s`) || have.has(w.replace(/s$/, ""))).length;
  };
  return hits(text.slice(m.index)) <= hits(text.slice(0, m.index));
}

/** Words that ask for a close view: "close-up", "close view", "detail", "filling the frame", "macro". */
const CLOSE_WORDS = /\bclose[- ]?(?:up|view|shot)\b|\bdetail\b|\bfilling (?:most of )?the (?:whole )?frame\b|\bmacro\b/i;

/**
 * The ONE place a memory picture's framing is decided, from the picture itself: "close" for a part
 * of its key thing (`partOf`) or a picture whose own words ask for a close view, otherwise
 * undefined (memory rotates through its views). Pure.
 */
export function shotFraming(s: StoryboardScene): "close" | undefined {
  if (s.partOf) return "close";
  const words = s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "";
  return CLOSE_WORDS.test(words) ? "close" : undefined;
}

/** A picture of a phone, tablet or laptop screen (its own words, or a split panel's). */
const isScreen = (s: StoryboardScene) =>
  showsScreen(s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "");

/** At most this many memory pictures go with one picture (the host photo may follow them). */
export const MAX_MEMORY_REFS = 3;

/** Whether a picture shows key thing `t` — as its own thing, or beside it. */
const shows = (x: StoryboardScene, t: string) =>
  x.keyThing === t || !!x.otherKeyThings?.includes(t);

/**
 * The camera position of `s` when it is drawn from memory: the next of `MEMORY_VIEWS` after the
 * pictures of its key thing before it, so two in a row never share one. Undefined for the memory
 * picture itself, and for a picture of no key thing. Pure.
 */
export function memoryViewFor(scenes: StoryboardScene[], s: StoryboardScene): string | undefined {
  if (listSetFor(scenes, s)) return SET_ITEM_VIEW;
  if (isScreen(s) && s.keyThing && drawn(s)) return SCREEN_ITEM_VIEW;
  if (!s.keyThing || !drawn(s)) return undefined;
  const i = scenes.indexOf(s);
  const before = scenes.slice(0, Math.max(0, i)).filter(x => source(x) && shows(x, s.keyThing!)).length;
  if (before === 0) return undefined;
  // A remembered thing beside what the picture is about stays beside it (`isSubject`): the same
  // thing, at its natural size — never the close view the rotation would give the subject.
  // A picture of one PART of it (`partOf`) is about that part, whatever order the words name them in.
  if (!s.partOf && !isSubject(s, s.keyThing)) return BACKGROUND_VIEW;
  // A CONTINUATION that repeats the words of the picture it is drawn from gets a concrete camera
  // (`REDRAW_CAMERAS`), never the stock memory views: told "a close view of one part of it", job 403
  // scene 14 came back as scene 10 a little closer, and job 405 scene 22 as scene 21 a little tighter
  // (`repeatedPicture`). One whose own words were rewritten keeps the framing they ask for, below.
  // Printing that must stay unreadable is never a close-up of the print here either.
  if (!s.partOf && repeatedPicture(scenes, s)) {
    const camera = REDRAW_CAMERAS[continuationCameraIndex(scenes, s)];
    return s.blurPrint && camera === REDRAW_CAMERAS[0] ? BLUR_PRINT_VIEW : camera;
  }
  // The picture's OWN framing decides first (`shotFraming`): one part of the thing, or a close view
  // its words ask for, is a close-up — never "a few steps further back" or "the other side", which
  // drew Ruth's "a bear paw there" as the whole quilt (job 298) while its words said "close view".
  // Printing that must stay unreadable is never a close-up of the print (`BLUR_PRINT_VIEW`).
  if (shotFraming(s) === "close") return s.blurPrint ? BLUR_PRINT_VIEW : PART_VIEW;
  return MEMORY_VIEWS[(before - 1) % MEMORY_VIEWS.length];
}

/**
 * Tag every drawn picture the shot list did not tag with the key thing its description names —
 * a split's panel (`splitVisual`), the QR background, a storyboard picture (`keyThingIn`). Returns
 * how many it tagged. Pure apart from mutating `scenes`.
 */
export function tagKeyThings(scenes: StoryboardScene[], things: KeyThing[] | undefined): number {
  if (!things?.length) return 0;
  let n = 0;
  for (const s of scenes) {
    if (!drawn(s)) continue;
    const text = s.hostPresent ? s.splitVisual : (s.showSubject ?? s.visualPrompt);
    const named = keyThingsIn(text, things).map(t => t.name);
    if (!s.keyThing && named[0]) {
      s.keyThing = named[0];
      n++;
    }
    // Every other key thing the picture names is remembered too.
    const others = named.filter(name => name !== s.keyThing);
    s.otherKeyThings = others.length ? others : undefined;
  }
  return n;
}

const sourcesOf = new WeakMap<StoryboardScene, StoryboardScene[]>();
const viewOf = new WeakMap<StoryboardScene, string | undefined>();
/** Of `sourcesOf`, the pictures of the scene's OWN thing — its key thing's, or its list's group picture. */
const ownSourcesOf = new WeakMap<StoryboardScene, StoryboardScene[]>();
/** The look a scene is drawn by when no picture of its own thing comes (`keyThingLookFor`). */
const lookOf = new WeakMap<StoryboardScene, string | undefined>();
/** The named kind's look a split's panel takes from the pictures of its thing (`panelNamedLook`). */
const panelLookOf = new WeakMap<StoryboardScene, string | undefined>();
/**
 * Of `sourcesOf`, the picture the scene must not repeat (`recomposeFrom`): the one it continues, or
 * the one shown right before it about something else.
 */
const rightBeforeOf = new WeakMap<StoryboardScene, StoryboardScene | undefined>();
/** Scenes whose `rightBeforeOf` picture is one they CONTINUE as the same topic (`continuedPicture`). */
const continuesOf = new WeakSet<StoryboardScene>();
/** The picture the near-copy check always lays beside the scene (`nearCopyPartnerFor`). */
const partnerOf = new WeakMap<StoryboardScene, StoryboardScene | undefined>();
/** Pictures a later picture is drawn from for their OWN key thing (`copiedLater`). */
const copied = new WeakSet<StoryboardScene>();
/** Scenes whose picture is being made in the current pass — only those are worth waiting for. */
const pending = new WeakSet<StoryboardScene>();
const gates = new WeakMap<StoryboardScene, { promise: Promise<void>; open: () => void }>();

function gate(s: StoryboardScene) {
  let g = gates.get(s);
  if (!g) {
    let open!: () => void;
    const promise = new Promise<void>(r => (open = r));
    g = { promise, open };
    gates.set(s, g);
  }
  return g;
}

/**
 * Before a pass renders `rendering` out of the film `board`: remember each scene's memory, the look
 * it is drawn by when it has none, which pictures later ones copy, and which scenes' pictures are
 * about to be made.
 */
export function attachMemory(
  board: StoryboardScene[],
  rendering: StoryboardScene[] = board,
  keyThings?: KeyThing[]
): void {
  tagKeyThings(board, keyThings);
  // Whether the video makes something: the shot list stages only pictures of a thing being made.
  const makes = board.some(x => !!x.buildStage);
  for (const s of board) {
    const items = listItemsAround(board, s);
    if (items) s.listItems = items;
    else delete s.listItems;
    const sources = memorySourcesFor(board, s);
    const set = listSetFor(board, s);
    sourcesOf.set(s, sources);
    ownSourcesOf.set(s, sources.filter(x => x === set || (!!s.keyThing && shows(x, s.keyThing))));
    viewOf.set(s, memoryViewFor(board, s));
    lookOf.set(s, keyThingLookFor(s, keyThings, makes));
    panelLookOf.set(s, panelNamedLook(board, s));
    const re = recomposeFrom(board, s, sources);
    rightBeforeOf.set(s, re?.from);
    if (re?.continues) continuesOf.add(s);
    else continuesOf.delete(s);
    partnerOf.set(s, nearCopyPartnerFor(board, s, sources));
    copied.delete(s);
  }
  // A picture is COPIED when a later picture is drawn from it for the thing it is itself about — not
  // a list's group picture its items are cut from, and not a picture lent only for a thing beside it.
  for (const s of board) {
    if (listSetFor(board, s)) continue;
    const things = [s.keyThing, ...(s.otherKeyThings ?? [])];
    for (const src of sourcesOf.get(s) ?? []) {
      const own = ownKeyThing(src);
      if (own && things.includes(own)) copied.add(src);
    }
  }
  for (const s of rendering) {
    if (!source(s) || s.pictureUrl) continue;
    pending.add(s);
    gates.delete(s); // a fresh gate for this pass
  }
}

/** The camera position `s` is drawn from when it has a memory (`memoryViewFor`). */
export function memoryView(s: StoryboardScene): string | undefined {
  return viewOf.get(s);
}

/**
 * The named kind's look the panel of split `s` is drawn by (`panelNamedLook`), as the last
 * `attachMemory` over its film found it; undefined for a scene no pass has seen.
 */
export function panelLook(s: StoryboardScene): string | undefined {
  return panelLookOf.get(s);
}

/**
 * The picture the near-copy check always lays beside `s` (`nearCopyPartnerFor`), as the last
 * `attachMemory` over its film found it; undefined for a scene no pass has seen.
 */
export function nearCopyPartner(s: StoryboardScene): StoryboardScene | undefined {
  return partnerOf.get(s);
}

/** Whether a later picture is drawn from `s` for the key thing `s` is about (`attachMemory`). */
export function copiedLater(s: StoryboardScene): boolean {
  return copied.has(s);
}

/**
 * The look the picture CHECK holds `s` to, or undefined: only a picture that later pictures copy and
 * that had no picture of its own thing to follow (`scene.keyThingLook` set at render) — the look is
 * then the only thing that decides how every copy looks, so a first picture that misses it is drawn
 * again on the check it already gets (`requiredThingsQuestion`), not copied into every later one.
 * Never a named kind's picture: its exact look wins in the prompt (`keyThingLookClause`), and a
 * check holding it to a look its prompt never carried would fail it for not drawing what was not
 * asked (the exact-look question holds it instead).
 */
export function lookToHold(s: StoryboardScene): { thing: string; look: string } | undefined {
  const own = ownKeyThing(s);
  return own && s.keyThingLook && !s.namedLook && copied.has(s)
    ? { thing: own, look: s.keyThingLook }
    : undefined;
}

/** `s`'s picture is made — or its render ended without one: anything drawn from it may go on. */
export function pictureSettled(s: StoryboardScene): void {
  pending.delete(s);
  gate(s).open();
}

/**
 * The pictures `s` is drawn from, waiting (at most `timeoutMs`) for one still being made in this
 * pass. A memory that never came is skipped — the picture is then drawn from words, as before — and
 * so is one whose own check said its thing is not in it (`memoryUnfit`, set when it settled in this
 * same pass). `own` says whether any of them is a picture of `s`'s own thing; when none is, `look`
 * is the look it is drawn by instead (`keyThingLookFor`). When one is, `wordsLook` is that same look,
 * kept for a redraw from words should the picture copy its memory (`memoryToWords`). `before` is
 * where in `urls` the picture `s` must not repeat is (`recomposeFrom`): the one shown right before
 * it about something else, or — `continues` — the one it continues as the same topic.
 */
export async function memoryFor(
  s: StoryboardScene,
  timeoutMs = MEMORY_WAIT_MS
): Promise<{
  urls: string[];
  own: boolean;
  look?: string;
  wordsLook?: string;
  before?: number;
  continues?: boolean;
}> {
  const urls: string[] = [];
  const mine = ownSourcesOf.get(s) ?? [];
  const prev = rightBeforeOf.get(s);
  let own = false;
  let before: number | undefined;
  for (const src of sourcesOf.get(s) ?? []) {
    if (!src.pictureUrl && pending.has(src)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        gate(src).promise,
        new Promise<void>(r => (timer = setTimeout(r, timeoutMs))),
      ]);
      if (timer) clearTimeout(timer);
    }
    if (!src.pictureUrl || src.memoryUnfit || urls.includes(src.pictureUrl)) continue;
    urls.push(src.pictureUrl);
    if (mine.includes(src)) own = true;
    if (src === prev) before = urls.length - 1;
  }
  const look = lookOf.get(s);
  return {
    urls,
    own,
    look: own ? undefined : look,
    wordsLook: own ? look : undefined,
    before,
    ...(before != null && continuesOf.has(s) ? { continues: true } : {}),
  };
}

/** The pictures `s` is drawn from (`memoryFor`). */
export async function memoryPicturesFor(
  s: StoryboardScene,
  timeoutMs = MEMORY_WAIT_MS
): Promise<string[]> {
  return (await memoryFor(s, timeoutMs)).urls;
}

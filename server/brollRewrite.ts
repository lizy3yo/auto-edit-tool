/**
 * WHAT A CUTAWAY'S PROMPT IS WRITTEN FOR, AND WHEN THE PROMPT WRITER'S ANSWER IS NOT THE PICTURE
 * (2026-10-20, job 413 scenes 9-10).
 *
 * The prompt writer (`enhanceBrollPrompts`) is handed each cutaway with a few instruction blocks in
 * front of it — the person-free rule, and for a moving shot a motion directive — and writes ONE
 * picture description back. Job 413 shipped two pictures whose description was the old hands-at-work
 * VIDEO directive handed back, lightly reworded: "Bare weathered hands with fingers already on a tool
 * or workbench task, pressing or adjusting what they work on. Wooden workbench, pegboard wall…" —
 * the same words for both, nothing of either shot's own subject. Scene 9 (9.4 s, under the channel's
 * own introduction) came out as someone hand-planing a board on a channel about garage businesses;
 * scene 10 was drawn right only because its subject led the image prompt, and still paid for a redraw.
 *
 * Three things went wrong, and each is closed here:
 *   1. The shots were written as VIDEOS although nothing with a person in it is ever a video any more
 *      (`videoKind`, 2026-09-30): the still/motion balancer had flipped them to motion, the writer got
 *      the motion directive, and the plan gate made them photos again afterwards. A prompt is now
 *      written for what the video rule WILL make the shot (`cutawayPromptLane`).
 *   2. Nothing looked at the answer. A rewrite that repeats a stock directive, or leaves out the
 *      thing its line needs shown (`showSubject`), is now refused for the scene's own words
 *      (`rewriteFault`, `rewriteFallback`) — free, no second call.
 *   3. A shot written as a moving one that the gate later makes a photo because nothing in it moves by
 *      itself kept its motion wording; it is now written again (`leftMotionLane`), in the call that
 *      already re-writes the host beats the gate sent to the pictures.
 *
 * Pure.
 */
import type { StoryboardScene } from "@shared/types";
import { videoKind } from "./shotList";

/**
 * What a cutaway's prompt is written for:
 * - "video": a clip of something that moves by itself — written with the motion directive;
 * - "moving-thing": a photo catching such a thing mid-motion (`STILL_OBJECT_MOTION_CLAUSE`) — the
 *   same directive, written as a still;
 * - "still": an ordinary photo, a person or hands at rest in it.
 */
export type CutawayPromptLane = "video" | "moving-thing" | "still";

type LaneFields = Pick<
  StoryboardScene,
  | "hostPresent"
  | "stillImage"
  | "objectMotion"
  | "humanPresent"
  | "toolContact"
  | "selfMoving"
  | "showSubject"
  | "visualPrompt"
>;

/**
 * The lane a cutaway's prompt is written in, judged by the SAME video rule the plan gate applies
 * afterwards (`settleVideoKind` reads `showSubject ?? visualPrompt` with the person, contact and
 * self-moving flags), so a shot that will be a photo is never written as a video. Job 413 scenes 9-10
 * were moving shots of the host at the bench when the writer saw them — the balancer had flipped
 * them — and became photos at the gate. Pure.
 */
export function cutawayPromptLane(s: LaneFields): CutawayPromptLane {
  if (s.hostPresent) return "still";
  const moves =
    !s.stillImage &&
    videoKind(s.showSubject ?? s.visualPrompt ?? "", "object", {
      person: !!s.humanPresent,
      contact: !!s.toolContact,
      selfMoving: s.selfMoving,
    }) !== "none";
  if (moves && s.objectMotion) return "video";
  if (s.stillImage && s.objectMotion && !s.humanPresent) return "moving-thing";
  return "still";
}

/**
 * The prompt was written for a moving thing (`promptLane`) and the video rule now says nothing in the
 * shot moves by itself: the self-moving judge said no (a door, a drawer), or the words name a person,
 * hands or a tool biting in. Its "motion in progress" wording describes something that does not
 * happen, so it is written again. A shot made a photo only to keep the video SHARE down
 * (`removeMotion`, the length caps) is NOT: its flame or steam still moves by itself, a photo of it
 * catches that mid-motion, and the plain-photo rewrite's "settled instant" rule would put the kettle
 * out — the wording it has is the right one, and leaving it costs no call. Never a host take, a CTA
 * picture or a shot no rewrite was recorded for. Pure.
 */
export function leftMotionLane(
  s: LaneFields & Pick<StoryboardScene, "promptLane" | "cta">
): boolean {
  if (s.hostPresent || s.cta || !s.promptLane || s.promptLane === "still") return false;
  if (cutawayPromptLane(s) !== "still") return false;
  return (
    videoKind(s.showSubject ?? s.visualPrompt ?? "", "object", {
      person: !!s.humanPresent,
      contact: !!s.toolContact,
      selfMoving: s.selfMoving,
    }) === "none"
  );
}

// Words that say nothing about WHAT is in a picture: grammar, and how it is framed.
const STOP = new Set(
  (
    "the and for nor but yet its his her hers him she they them their theirs our ours your you " +
    "who whom whose what which that this these those there here then than with without from into onto " +
    "over under upon about above below beside besides near next along across around behind between " +
    "through while where when each every some any other another again just only also very much more " +
    "most still being been have has had having was were are will would could should can may might " +
    "does did not out off own too all both one two way like such same set sits sitting seen shown " +
    "show shows showing view close closeup frame framed framing filling shot picture photo image " +
    "detail visible background foreground clearly plain simple already done nothing everything " +
    "something anything else"
  )
    .trim()
    .split(/\s+/)
);

// A person, or what the person-free rule makes of one ("a pair of bare weathered hands … no face,
// head or body"): the stand-in changes from rewrite to rewrite and is never what the picture is
// ABOUT, so it is not counted. Hair and legs stay words of the picture — the styled hair of a beauty
// line, the legs of a stool.
const STAND_IN = new Set(
  (
    "host hosts person people someone somebody anyone man men woman women hand hands finger fingers " +
    "thumb thumbs palm palms wrist wrists arm arms forearm forearms face head heads shoulder " +
    "shoulders body torso pair bare weathered adult older"
  )
    .trim()
    .split(/\s+/)
);

/** One word's stem, so "tools"/"tool", "pressing"/"pressed"/"press", "boxes"/"box" meet. */
function stem(word: string): string {
  let w = word;
  if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + "y";
  else if (/(?:ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (/[^s]s$/.test(w) && w.length > 3) w = w.slice(0, -1);
  if (/ing$/.test(w) && w.length > 5) w = w.slice(0, -3);
  else if (/ed$/.test(w) && w.length > 4) w = w.slice(0, -2);
  return w.length > 3 ? w.replace(/e$/, "") : w;
}

/** Every word of `text`, lower case, apostrophes and possessives gone, in order. */
function tokens(text: string | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .match(/[a-z0-9]+/g) ?? [];
}

/** The stems of the words in `text` that say what is in a picture. */
function pictureStems(text: string | undefined): string[] {
  return tokens(text)
    .filter(w => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w) && !STAND_IN.has(w))
    .map(stem);
}

/** The longest run of consecutive words `a` shares with `b`. */
function longestSharedRun(a: string[], b: string[]): string[] {
  let best = 0;
  let end = 0;
  const row: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (row[j] > best) {
        best = row[j];
        end = i;
      }
      diag = keep;
    }
  }
  return a.slice(end - best, end);
}

/**
 * Five words in a row from a directive is a phrase lifted from it — but the person-free rule's own
 * stand-in ("a pair of bare hands at the work", "no face, head or body") is what that rule ASKS the
 * writer to write, and on the 20,856 stored cutaway rewrites it was the only run that long. So a
 * run counts only when two or more of its words say what is in a picture and the scene's own words
 * never say them: the old hands directive's "pressing or adjusting what they work on" (job 413)
 * does; no rewrite of the person-free rule or the moving-thing directive did, so on those rewrites
 * the two directives still sent refuse none.
 */
const DIRECTIVE_RUN_WORDS = 5;
const DIRECTIVE_RUN_PICTURE_WORDS = 2;

/** A subject needs this many of its own picture words before a rewrite can be judged against it. */
const SUBJECT_MIN_WORDS = 2;

/**
 * Does `rewrite` show the thing its line needs (`showSubject`)? With two or three picture words, at
 * least one must be there; with four or more, at least a quarter. A rewrite paraphrases freely — "a
 * rat carrying a pellet away from the scattered pellets" comes back as "mouth open around a tan feed
 * pellet, more scattered pellets nearby" — so only one that has left the subject behind falls under
 * it (job 413 scene 10: "the host pulling a stool up to the garage workbench and opening a notebook"
 * → one word of six, "workbench"). Replayed over the 20,856 stored cutaway rewrites: 42 refused,
 * mostly a picture of something else (job 409 scene 28, "the host reading a book at the desk in the
 * study" drawn as a farmer in a field). Pure.
 */
export function leavesOutSubject(rewrite: string, showSubject: string | undefined): boolean {
  const need = Array.from(new Set(pictureStems(showSubject)));
  if (need.length < SUBJECT_MIN_WORDS) return false;
  const have = new Set(pictureStems(rewrite));
  const hit = need.filter(w => have.has(w)).length;
  return need.length <= 3 ? hit === 0 : hit * 4 < need.length;
}

/**
 * Does `rewrite` hand back one of the instruction blocks it was given (`stock`) instead of a picture?
 * A run of `DIRECTIVE_RUN_WORDS` or more words copied from a directive, at least
 * `DIRECTIVE_RUN_PICTURE_WORDS` of which say what is in a picture and are not the scene's own words
 * (`own`: its seed, subject and line). Pure.
 */
export function repeatsDirective(rewrite: string, stock: readonly string[], own: string): boolean {
  const said = tokens(rewrite);
  const mine = new Set(pictureStems(own));
  for (const directive of stock) {
    const run = longestSharedRun(said, tokens(directive));
    if (run.length < DIRECTIVE_RUN_WORDS) continue;
    const lifted = pictureStems(run.join(" ")).filter(w => !mine.has(w));
    if (new Set(lifted).size >= DIRECTIVE_RUN_PICTURE_WORDS) return true;
  }
  return false;
}

/**
 * A subject made of what the line SAYS rather than of a thing to see: a spoken list's item, a step, or
 * the group picture before a list, built from the script's own words (job 355: "find every leak in
 * that bag, plug them one at a time and fill the gaps with cheaper food together, laid out side by
 * side"; job 338: "the host's hands, mid-step: let every piece find its lane"), or any subject most
 * of whose words are its line's. Turning those into something to see is the rewrite's whole job — a
 * feed sack, a tin and a bowl on the bench — so its words are not held against it. Pure.
 */
function sayingNotSeeing(
  scene: Pick<StoryboardScene, "showSubject" | "scriptText" | "narration" | "listCut" | "listSet">
): boolean {
  if (scene.listCut || scene.listSet) return true;
  const subject = Array.from(new Set(pictureStems(scene.showSubject)));
  const line = new Set(pictureStems(scene.scriptText ?? scene.narration));
  return subject.length > 0 && subject.filter(w => line.has(w)).length * 2 >= subject.length;
}

/**
 * Why a cutaway's rewrite is not its picture, or undefined when it is: it repeats a stock directive
 * ("directive"), or it leaves out what its line needs shown ("subject"). `seed` is what the writer was
 * asked to rewrite. Pure.
 */
export function rewriteFault(
  rewrite: string,
  scene: Pick<StoryboardScene, "showSubject" | "scriptText" | "narration" | "listCut" | "listSet">,
  seed: string,
  stock: readonly string[]
): "directive" | "subject" | undefined {
  const own = [seed, scene.showSubject, scene.scriptText ?? scene.narration].filter(Boolean).join(" ");
  if (repeatsDirective(rewrite, stock, own)) return "directive";
  if (!sayingNotSeeing(scene) && leavesOutSubject(rewrite, scene.showSubject)) return "subject";
  return undefined;
}

/**
 * The scene's own words, for a rewrite that was refused: the prompt the writer was asked to rewrite,
 * or — when that has itself left the subject behind (a seed from an earlier storyboard, a subject the
 * line check changed since) — the subject. Pure.
 */
export function rewriteFallback(scene: Pick<StoryboardScene, "showSubject">, seed: string): string {
  const own = seed.trim();
  const subject = scene.showSubject?.trim();
  if (own && !leavesOutSubject(own, subject)) return own;
  return subject || own;
}

// ─── A key thing the line does not name ──────────────────────────────────────────────────

/*
 * NOTHING THE LINE DOES NOT NAME (2026-10-20, job 414 scenes 2-8, an old-cabin film whose reveal at
 * 21 s is "But on the back wall hung an axe, a froe, and a drawknife"). The back wall with those three
 * tools filled seven pictures in a row from 2.6 s and gave the reveal away. Neither scene 2's subject
 * ("the old log cabin interior, looking for store-bought goods") nor scene 3's ("a log restorer
 * working at the cabin's log wall") names a tool; the prompt writer put them in — "The back wall shows
 * an axe, a froe, and a drawknife hanging together", "The back wall with the three hung steel tools is
 * visible behind" — from the props list (where they are the MAIN thing), the stretch line (which
 * covers the coming reveal) and "continue from the previous shots", all of which outweighed its own
 * "no future events". Scene 4's split panel came back the same way from a seed of the cabin seen from
 * outside. The writer's prompt now says so; this is the check on its answer, free, no call: a key
 * thing a later line reveals (`notYetSaid`), or under a line saying nothing is there any key thing,
 * that the rewrite shows and the scene's own words (what it was asked to rewrite, its subject, its
 * line, the shot list's tag) do not name is taken out — the sentence about it, or the part of a
 * sentence it sits in beside the subject — and when that leaves too little, the scene keeps its own
 * words.
 */

/** Grammar, size and amount words: they say nothing about WHICH thing a key thing is. */
const NOT_A_NAME = new Set(
  (
    "the and for with from its his her their our your small little big large tiny huge few many " +
    "some main old new one two three four five six"
  ).split(" ")
);

/**
 * The stems of every word of a key thing's name that says which thing it is: "steel tools" → steel,
 * tool; "chisel set" → chisel, set (so "fresh chisel marks" is not the set). Pure.
 */
function nameStems(name: string): string[] {
  return Array.from(
    new Set(
      tokens(name.replace(/^MAIN\b/i, ""))
        .filter(w => w.length >= 3 && !NOT_A_NAME.has(w))
        .map(stem)
    )
  );
}

/** Every word of `text`, stemmed — grammar words too, so a name is looked up as written. */
function allStems(text: string | undefined): Set<string> {
  return new Set(tokens(text).map(stem));
}

/**
 * A word as it SHOWS a thing: its stem, but a "-ed"/"-ing" form kept apart from the plain word, so
 * "an angled drilled hole" shows no drill and "brushing the surface clean" no brush (job 261 scene 2,
 * job 264 scene 17 — both lost a part of the picture to a key thing that was never in it). A name that
 * is itself such a word ("cutting mat", "sewing machine") meets the same word. Read only where a
 * rewrite is judged to SHOW a thing; the scene's own words and the lines are read loosely, so "I
 * drilled the hole" still names the drill.
 */
function shownKey(word: string): string {
  return word.length > 4 && /(?:ed|ing)$/.test(word) ? `~${stem(word)}` : stem(word);
}

/** Every word of `text` as it shows a thing (`shownKey`). */
function shownKeys(text: string | undefined): Set<string> {
  return new Set(tokens(text).map(shownKey));
}

// A word that ends a list item's noun phrase: a preposition, a joining word, a word of placing.
const ITEM_END =
  /^(?:on|in|at|by|of|to|for|from|with|into|onto|over|under|above|below|beside|near|against|along|across|behind|inside|outside|around|atop|hung|set|laid|that|which|where|while|all|together)$/;

/**
 * The things a key thing's look opens by listing, by their head words: "an axe, a froe, and a
 * drawknife hanging together on the cabin's back interior wall" → axe, froe, drawknife. A group key
 * thing ("steel tools") is written by its items far more often than by its name. Every item but the
 * last is a bare "a/an …" phrase, the last comes after "and"/"or" and may run on ("hanging
 * together…"). None for a single thing's look: its parts ("a heavy steel axe with a wide flat blade
 * and a short curved wooden handle") or its features one after another ("an American robin, a
 * reddish-orange breast, a dark gray-brown back…", job 411) are no list of things. Pure.
 */
export function listedItems(look: string | undefined): string[] {
  return Array.from(new Set(listedHeads(look).map(stem)));
}

/** `listedItems` as the words were written, before stemming. Pure. */
function listedHeads(look: string | undefined): string[] {
  const chunks = (look ?? "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/\s*[,;]\s*|\s+(?=(?:and|or)\s+an?\s)/);
  const heads: string[] = [];
  let closed = false;
  for (const chunk of chunks) {
    const joined = /^\s*(?:and|or)\s+/.test(chunk);
    const words = chunk.trim().replace(/^(?:and|or)\s+/, "").match(/[a-z][a-z-]*/g) ?? [];
    if (words[0] !== "a" && words[0] !== "an") break;
    const phrase: string[] = [];
    let ranOn = false;
    for (const w of words.slice(1)) {
      if (ITEM_END.test(w) || /ing$/.test(w)) {
        ranOn = true;
        break;
      }
      phrase.push(w);
    }
    if (!phrase.length || phrase.length > 4) break;
    heads.push(phrase[phrase.length - 1]);
    closed = joined;
    if (ranOn || joined) break;
  }
  return heads.length >= 2 && closed ? heads : [];
}

/**
 * A key thing as it can be named: its name's words and the items its look lists, as stems (read
 * loosely, in the scene's own words and the lines) and as `shownKey`s (read in a rewrite).
 */
interface ThingWords {
  name: string;
  stems: string[];
  items: string[];
  keys: string[];
  itemKeys: string[];
}

function thingWords(t: { name: string; look?: string }): ThingWords {
  const named = tokens(t.name.replace(/^MAIN\b/i, "")).filter(w => w.length >= 3 && !NOT_A_NAME.has(w));
  // Each item once, its stem and its key side by side (`ownWordsName` reads one by the other).
  const items = new Map(listedHeads(t.look).map(w => [shownKey(w), stem(w)] as const));
  return {
    name: t.name,
    stems: nameStems(t.name),
    items: Array.from(items.values()),
    keys: Array.from(new Set(named.map(shownKey))),
    itemKeys: Array.from(items.keys()),
  };
}

/** A rewrite's words (`shownKeys`) name the thing for sure: every word of its name, or two of its listed items. */
function namesForSure(keys: Set<string>, t: ThingWords): boolean {
  if (t.keys.length && t.keys.every(w => keys.has(w))) return true;
  return t.itemKeys.filter(w => keys.has(w)).length >= 2;
}

/**
 * `stems` holds `word` in any form, read loosely: the word itself, or a longer form of one of four
 * letters or more ("snowy" for "snow", "woodworking" for "wood").
 */
function holdsLoosely(stems: Set<string>, word: string): boolean {
  if (stems.has(word)) return true;
  if (word.length < 4) return false;
  for (const s of Array.from(stems)) if (s.startsWith(word)) return true;
  return false;
}

/**
 * The scene's own words name the thing, read loosely — kept when unsure: one word of its name in
 * any form ("a log restorer" names "green poplar log", "a snowy park" names "snow"), or every listed
 * item the rewrite named. One item alone does not name a group: scene 4's seed had "axe marks", and
 * its panel came back with all three tools.
 */
function ownWordsName(own: Set<string>, t: ThingWords, rewrite: Set<string>): boolean {
  if (t.stems.some(w => holdsLoosely(own, w))) return true;
  const named = t.items.filter((_, k) => rewrite.has(t.itemKeys[k]));
  return named.length > 0 && named.every(w => holdsLoosely(own, w));
}

// Where a thing SITS rather than a thing shown: "on the workbench", "in the hearth". A picture of a
// can on the bench is the can's; the bench is only its place.
const SURFACE_PREP = /^(?:on|onto|in|into|inside|atop|across|at)$/;
const DETERMINER = /^(?:the|its|his|her|their|our|your|this|that|these|those|my)$/;

/** A sentence's parts, between commas, semicolons and dashes. */
const PART_BREAK = /(\s*[,;]\s*|\s*[—–]\s*|\s+-\s+)/;

/**
 * Whether `sentence` names the thing only as the place something sits: every time its name comes,
 * right after "on", "in", "at"… in the same part of the sentence, with at most four describing words
 * between ("on the old scarred workbench") — and never by two of its items. "…into alignment, oil
 * lamp glowing softly" is the lamp shown, not a place. Pure.
 */
function onlyAsPlace(sentence: string, t: ThingWords): boolean {
  if (!t.keys.length) return false;
  if (t.itemKeys.filter(w => shownKeys(sentence).has(w)).length >= 2) return false;
  let found = false;
  for (const part of sentence.split(PART_BREAK)) {
    const words = tokens(part);
    const keys = words.map(shownKey);
    for (let k = 0; k < keys.length; k++) {
      // The first word of each mention of the name.
      if (!t.keys.includes(keys[k]) || (k > 0 && t.keys.includes(keys[k - 1]))) continue;
      found = true;
      let place = false;
      for (let j = k - 1; j >= Math.max(0, k - 5); j--) {
        if (SURFACE_PREP.test(words[j])) {
          place = true;
          break;
        }
        if (ITEM_END.test(words[j]) || (STOP.has(words[j]) && !DETERMINER.test(words[j]))) break;
      }
      if (!place) return false;
    }
  }
  return found;
}

/**
 * The key things `rewrite` shows that its scene's own words (`own`: the seed it was asked to rewrite,
 * its subject, its line, its tag) do not name, by name. Pure.
 */
export function addedKeyThings(
  rewrite: string,
  own: string,
  things: readonly { name: string; look?: string }[] | undefined
): string[] {
  if (!things?.length) return [];
  const said = shownKeys(rewrite);
  const mine = allStems(own);
  return things
    .map(thingWords)
    .filter(t => namesForSure(said, t) && !ownWordsName(mine, t, said))
    .map(t => t.name);
}

/** A rewrite's sentences (a semicolon ends one too), each with its own closing mark. */
function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?;]+(?:[.!?;]+["')\]]*|$)/g) ?? []).map(s => s.trim()).filter(Boolean);
}

/**
 * A part of a sentence speaks of the thing: its whole name, the last word of its name ("lamp" of
 * "oil lamp", "tools" of "steel tools"), or one of the items its look lists. Pure.
 */
function speaksOf(part: string, t: ThingWords): boolean {
  const keys = shownKeys(part);
  if (namesForSure(keys, t)) return true;
  const head = t.keys[t.keys.length - 1];
  return (!!head && keys.has(head)) || t.itemKeys.some(w => keys.has(w));
}

/**
 * `sentence` without its parts (between commas, semicolons and dashes) that speak of `shown`, or
 * undefined when its first part does — the sentence is then about the thing, and goes whole ("The
 * back wall shows an axe, a froe, and a drawknife hanging together."). A thing in a later part is
 * only beside the subject: "…on the work table in the sewing room, under soft daylight from the oil
 * lamp, positioned slightly angled…" loses only the lamp. Pure.
 */
function withoutParts(sentence: string, shown: ThingWords[]): string | undefined {
  const pieces = sentence.split(PART_BREAK);
  const parts = pieces.filter((_, k) => k % 2 === 0);
  const joins = pieces.filter((_, k) => k % 2 === 1);
  const about = (part: string) => shown.some(t => speaksOf(part, t));
  if (about(parts[0])) return undefined;
  let out = parts[0];
  parts.slice(1).forEach((part, k) => {
    if (!about(part)) out += joins[k] + part;
  });
  const end = /[.!?]["')\]]*$/.exec(sentence.trim())?.[0];
  out = out.trim();
  return end && !out.endsWith(end) ? out.replace(/[\s,;:—–-]+$/, "") + end : out;
}

/** Below this share of its words, what is left of a rewrite is no longer the rewrite: own words instead. */
const MIN_KEPT_SHARE = 0.4;

/**
 * A part taken out with this many of the scene's own picture words in it carried the picture, not
 * only the thing beside it (job 293 scene 5, "craft fairs,": "…long folding table with plain cloth,
 * small wood coasters, ornaments, and house signs arranged along the front edge" lost its subject's
 * "small wood … arranged along the front edge" with the coasters, and an EMPTY market table — the
 * picture the operator refused on job 269 — still passed the subject check; job 264 scene 7 the same).
 * The scene keeps its own words instead. One word lost is a detail (job 411 scene 24's "wintry").
 */
const MAX_OWN_WORDS_LOST = 2;

/**
 * `rewrite` with every key thing its scene's own words do not name taken out (`addedKeyThings`;
 * a thing named only as where something sits stays): a sentence about it goes whole, a thing beside
 * the subject goes with its part of the sentence (`withoutParts`). `text` is the rewrite as it may be
 * adopted — the same string when nothing was taken out — or undefined when what is left is under
 * `MIN_KEPT_SHARE` of it, says none of the scene's own words (the added thing was the picture), or
 * lost `MAX_OWN_WORDS_LOST` of them with what went (the part carried the picture): the scene then
 * keeps its own words. `added` names what was taken out or refused, and `left` is what was left
 * either way. Pure.
 */
export function withoutAddedKeyThings(
  rewrite: string,
  own: string,
  things: readonly { name: string; look?: string }[] | undefined
): { text?: string; added: string[]; left?: string } {
  const found = addedKeyThings(rewrite, own, things);
  if (!found.length) return { text: rewrite, added: [] };
  const words = (things ?? []).filter(t => found.includes(t.name)).map(thingWords);
  const added = new Set<string>();
  const kept: string[] = [];
  for (const sentence of sentencesOf(rewrite)) {
    const keys = shownKeys(sentence);
    const shown = words.filter(t => namesForSure(keys, t) && !onlyAsPlace(sentence, t));
    shown.forEach(t => added.add(t.name));
    const left = shown.length ? withoutParts(sentence, shown) : sentence;
    if (left) kept.push(left);
  }
  if (!added.size) return { text: rewrite, added: [] };
  // A sentence cut short by its last part going (";" ends a sentence here) ends in a full stop.
  const text = kept.join(" ").trim().replace(/\s*[,;:—–-]+$/, ".");
  const mine = new Set(pictureStems(own));
  const share = tokens(text).length / Math.max(1, tokens(rewrite).length);
  // The scene's own words that went out with the thing — never the thing's own words, which are
  // meant to go.
  const thingStems = new Set(words.flatMap(t => [...t.stems, ...t.items]));
  const still = new Set(pictureStems(text));
  const lost = new Set(
    pictureStems(rewrite).filter(w => mine.has(w) && !still.has(w) && !thingStems.has(w))
  );
  if (
    !text ||
    share < MIN_KEPT_SHARE ||
    !pictureStems(text).some(w => mine.has(w)) ||
    lost.size >= MAX_OWN_WORDS_LOST
  )
    return { added: Array.from(added), left: text };
  return { text, added: Array.from(added), left: text };
}

/** The words a cutaway's rewrite answers to: what it was asked to rewrite, its subject, its line, its tags. */
export function ownWordsOf(
  scene: Partial<Pick<StoryboardScene, "showSubject" | "scriptText" | "narration" | "keyThing" | "partOf">>,
  seed: string | undefined
): string {
  return [seed, scene.showSubject, scene.scriptText ?? scene.narration, scene.keyThing, scene.partOf]
    .filter(Boolean)
    .join("\n");
}

/** A line names the thing at all: one word of its name, or one of the items its look lists. */
function lineNames(line: string | undefined, t: ThingWords): boolean {
  const stems = allStems(line);
  return [...t.stems, ...t.items].some(w => holdsLoosely(stems, w));
}

/**
 * The key things the narration has NOT YET SAID at picture `i` — not in its own line, not in any
 * line before it — and says in a later one: what a later line reveals. Job 414's axe, froe and
 * drawknife, first said at 21 s, are not yet said under every picture before it; a thing no line
 * ever says (a workbench the props list gave the setting) reveals nothing, and neither does one an
 * earlier line already said. Only these are taken out of a rewrite in code (`withoutAddedKeyThings`):
 * replayed over the 129 local films that have key things (3,279 cutaway rewrites, 508 panels),
 * holding every rewrite to every key thing its line does not name would have changed one rewrite in
 * six (552) — mostly a workbench or a finished piece in the background of a picture about something
 * said before — which the prompt writer is told instead; held to these, 166 cutaway rewrites (5%)
 * change, 60 of them back to their own words, and 23 panels. Pure.
 */
export function notYetSaid<T extends { name: string; look?: string }>(
  lines: readonly (string | undefined)[],
  i: number,
  things: readonly T[] | undefined
): T[] {
  return notYetSaidAt(lines, things)(i);
}

/** `notYetSaid` for every picture of one film, each thing's first line found once. Pure. */
export function notYetSaidAt<T extends { name: string; look?: string }>(
  lines: readonly (string | undefined)[],
  things: readonly T[] | undefined
): (i: number) => T[] {
  const first = (things ?? []).map(thing => {
    const t = thingWords(thing);
    return lines.findIndex(line => lineNames(line, t));
  });
  return i => (things ?? []).filter((_, k) => first[k] > i);
}

// ─── A line about nothing being there ────────────────────────────────────────────────────

/** What is said to be empty is said so plainly: the word ends the clause, or a place or time follows. */
const EMPTY_ENDS = String.raw`(?=\s*(?:[.,;:!?]|$)|\s+(?:in|on|at|for|all|again|now|most|come|by|when|until|except|of|and|but|after|before|from)\b)`;

/**
 * A line saying a place is EMPTY or a search finds (nearly) NOTHING: "you will come up nearly
 * empty-handed" (job 414 scene 2), "why does the yard feel so empty come November?" (job 411 scene
 * 18), "the grass sits empty in the mornings" (job 404), "it tells them when the house is empty",
 * "I found nothing there". "Empty" or "bare" before a thing is only how it looks ("keep the stack
 * off bare concrete"), and "nothing" that goes on ("nothing in there that can unravel on you",
 * "nothing there is going anywhere", "there is nothing like…") is a figure of speech: over the 25,571
 * local storyboard lines these read 13 lines, all of them a place or search said to be empty.
 */
const SAYS_EMPTY = [
  /\bempty[- ]handed\b/i,
  /\b(?:come|comes|came|coming|turn|turns|turned|end|ends|ended|wind|winds|wound)\s+up\s+(?:(?:nearly|almost|mostly|completely|totally|just about|pretty much)\s+)?(?:empty|with nothing)\b/i,
  new RegExp(
    String.raw`(?:\b(?:is|are|was|were|be|been|being|stands?|stood|sits?|sat|stays?|stayed|remains?|remained|lies?|lay|looks?|looked|feels?|felt|seems?|seemed|goes|went|gone|left|leaves?)|'s|'re)\s+` +
      String.raw`(?:(?:so|very|usually|often|mostly|always|still|just|completely|totally|entirely|almost|nearly|simply|quite|again|strangely|oddly)\s+)*(?:empty|bare|vacant|deserted)` +
      EMPTY_ENDS,
    "i"
  ),
  /\b(?:find|finds|found|turn up|turns up|turned up)\s+(?:(?:almost|next to|virtually|practically|absolutely)\s+)?nothing(?=\s*(?:[.,;:!?]|$)|\s+(?:there|here|at all|inside)\b)/i,
  /\b(?:nothing|none)\s+(?:there|here|left)(?=\s*(?:[.,;:!?]|$))/i,
];

/**
 * Said NOT to happen in the same clause: "nobody leaves the market empty-handed", "you'll never come
 * up empty" mean the place is full. A bare "no" is not one ("with no list you come up empty").
 */
const NOT_SO = /\b(?:never|not|nobody|no one|hardly|rarely|seldom)\b|n't\b/i;

/** `r` matches `t` in a clause that does not say it is not so (`NOT_SO`). */
function saysPlainly(r: RegExp, t: string): boolean {
  const every = new RegExp(r.source, r.flags.includes("g") ? r.flags : `${r.flags}g`);
  for (const m of Array.from(t.matchAll(every))) {
    const before = t.slice(0, m.index ?? 0);
    const clause = before.slice(before.search(/[^.,;:!?—–]*$/));
    if (!NOT_SO.test(clause)) return true;
  }
  return false;
}

/**
 * NOTHING THERE (2026-10-20, job 414 scene 2): under "a store sold, and you will come up nearly
 * empty-handed" the cabin was crowded with crocks, a tin pail, bowls, chests and a barrel, and read
 * as well stocked — the stretch line's "scattered salvage" and the props list filled a picture of
 * nothing. When a line says a place is empty or a search finds (nearly) nothing, the prompt writer is
 * told to show it bare and is not handed the stretch line, and every key thing the scene's own words
 * do not name is taken out of the rewrite. Pure.
 */
export function saysNothingThere(line: string | undefined): boolean {
  const t = (line ?? "").replace(/[’‘]/g, "'");
  return !!t.trim() && SAYS_EMPTY.some(r => saysPlainly(r, t));
}

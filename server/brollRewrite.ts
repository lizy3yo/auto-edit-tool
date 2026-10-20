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

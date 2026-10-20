/**
 * THE SHOT LIST — pictures cut on the words.
 *
 * The storyboard is written over fixed, word-count chunks (≤8 s), one picture each, so a picture
 * changed every 2–13 s whatever was being said: on Hank's film "a saw, a drill, and a stack of
 * sandpaper" played under an 11-second talking head, and "Folks will tell you Japanese
 * woodworking takes a master's hands and a wall full of fancy saws" sat on one still of a wall of
 * saws for 10 s. An editor cuts b-roll on the NOUN: the shot changes on the word that names the
 * next thing, a spoken list gets one quick shot per item, and the person on camera hands over to
 * the pictures at a natural break instead of finishing every sentence.
 *
 * This runs after voicing, when every word's time is known, so a cut lands on the word itself. One
 * LLM call per batch of beats returns, per beat, the words each shot starts on and what it must
 * show; this module anchors those words in the beat's verbatim text (`applyShotPlan`), and after
 * the caller measures the pieces against the word timeline, `settleShots` folds anything too
 * short to read and splits any picture that would sit longer than `MAX_PICTURE_SEC`. Everything
 * here but `planShotList`/`deriveContinuitySheet` is pure and unit-tested.
 *
 * Not touched: the CTA (its host → book → host → big QR layout is fixed), the cover, operator
 * assets, split screens and the cold open (the hook stays on camera).
 */
import type { BuildStage, KeyThing, RecurringPerson, StoryboardScene } from "@shared/types";
import { invokeClaude } from "./claude";
import { NOTHING_CUT_OPEN_RULE } from "./cutOpen";
import { safeParseJSON } from "./jsonRepair";
import {
  BODY_HAND,
  BODY_PART_WORDS,
  REAL_HOLDER,
  SHOWS_PERSON,
  showsPerson,
  showsSomeoneElse,
  namesAnAnimal,
  namedPeople,
  matchRecurringPeople,
  namesOnlyAnimal,
  personKey,
  sexOfLook,
} from "./hostLook";
import { hostNameRanges, namesHostBefore } from "./hostIntro";
import {
  followedPeople,
  hostOwnWords,
  lookGaps,
  sameRole,
  scriptSentences,
  uncoveredPeople,
  type FollowedPerson,
  type LookGap,
} from "./followedPeople";

/** A picture shorter than this is a flash and folds into a neighbour. */
export const SHOT_MIN_SEC = 1.2;
/**
 * One item of a spoken list may be this short. Hank reads "a saw, a drill, and a stack of
 * sandpaper" in 2.1 s — at 0.6 the items folded into one picture of a saw, which is exactly the cut
 * the operator asked for undone. 0.4 s is ten frames: a quick cut, still readable as a thing.
 * (2026-09-27: a slight pause after each item, and a reading wait after short lines, were built
 * and tried the same day, then dropped at the operator's call — each item keeps its own picture at
 * the pace it is spoken.) Since 2026-09-30
 * the floor is 0.25 s — a blink, six frames: Hank's "a saw, a drill," (0.9 s for both) was joined
 * into one picture at 0.4, which the operator had already rejected. Each item keeps its picture.
 */
export const LIST_SHOT_MIN_SEC = 0.25;
/**
 * In the hook (everything before the host introduces themself) a picture is joined with its
 * neighbour until it runs at least this long — Mae's and Hannah's first 10 s went through five
 * pictures. No pauses here: the hook keeps its pace, it just shows fewer pictures.
 */
export const HOOK_PICTURE_MIN_SEC = 2.2;
/** Headroom `settleShots` keeps over each floor for the final snap onto real pauses. */
export const SNAP_MARGIN_SEC = 0.2;
/** The host says at least this many words on camera before handing over to the pictures. */
export const HOST_HANDOFF_MIN_WORDS = 5;
/** The host's part of a hand-off must run at least this long, or the host keeps the whole line. */
export const HOST_HANDOFF_MIN_SEC = 2;
/**
 * The longest a picture may stay, by where it sits in the film (2026-09-28, the operator: "in the
 * beginning images can be 7 seconds max … as the video progresses … split the video into 4
 * quarters: every 7, 10, 12, 14 seconds"). A picture changes sooner whenever the CONTEXT changes;
 * past its limit one subject gets another view of itself, not a new subject. Replaced a flat
 * 5.5 s cap that changed the picture every few seconds whatever was said.
 */
export const PICTURE_MAX_BY_QUARTER = [7, 10, 12, 14] as const;
/** The limit at `atSec` into a film of `filmSec` (the first quarter's when the length is unknown). Pure. */
export function pictureMaxSecAt(atSec: number, filmSec: number): number {
  if (!(filmSec > 0)) return PICTURE_MAX_BY_QUARTER[0] * SAME_TOPIC_SLACK;
  const q = Math.min(3, Math.max(0, Math.floor((atSec / filmSec) * 4)));
  return PICTURE_MAX_BY_QUARTER[q] * SAME_TOPIC_SLACK;
}
/**
 * The quarter limits are the rhythm; ONE topic may run this much past them before its picture is
 * split (2026-09-28, the operator on Hannah's 0:02-0:10: "it doesn't need to change, since it is
 * just the same photo … it has the same context" — an 8.1 s feed-sack shot had been split at the
 * 7 s limit into two near-identical pictures; and "even if it is 10 seconds, as long as there is
 * no context change"). 7 → 10.5, 10 → 15, 12 → 18, 14 → 21 s.
 */
export const SAME_TOPIC_SLACK = 1.5;
/** The tightest limit — what a caller that does not know the film's timeline falls back to. */
export const MAX_PICTURE_SEC = PICTURE_MAX_BY_QUARTER[0] * SAME_TOPIC_SLACK;
/** Under this a moving shot is not worth a video render: the clip would be cut to a blink. */
export const MOTION_MIN_SEC = 2;
/**
 * Beats per shot-list call. The model thinks before it answers, and on 24 beats its thinking ate
 * the whole reply budget and returned no text at all (job 140's opening batch) — 12 with a wide
 * budget, and a batch that still fails is retried as two halves.
 */
/**
 * How hard a planning step thinks. LOW unless its own setting says otherwise (`medium`, `high`,
 * or `default` for the model's own level): most of a planning call's cost is what the model
 * writes back, thinking included — the shot list wrote 30k tokens for a 3-minute film at the
 * model's default (job 338) and 5k at low (jobs 339, 340), $0.34 → $0.09, with the audit no worse
 * on either run. Settings: `SHOT_LIST_EFFORT`, `CONTEXT_EFFORT`, `PROPS_EFFORT`, `FIT_EFFORT`,
 * `NAMED_LOOK_EFFORT`.
 */
export function planningEffort(name: string): "low" | "medium" | "high" | undefined {
  const v = process.env[name];
  if (v === "default") return undefined;
  return v === "medium" || v === "high" ? v : "low";
}

const SHOT_BATCH = 12;
/** Batches in flight at once: continuity comes from the props list and the storyboard's own
 *  preceding pictures, not from the previous batch's answer, so they need not wait on each other. */
const SHOT_CONCURRENCY = 4;
const SHOT_MAX_TOKENS = 32000;
const SHOT_LIST_MODEL = () => process.env.SHOT_LIST_MODEL || "claude-sonnet-5";
/**
 * The line check (`fitPicturesToLines`) runs on Opus: on the same Frederick storyboard Sonnet found
 * "the kind of fire that starts while the house is asleep" 1 time in 3, Opus 3 in 3 (2026-10-01). One
 * call per ~80 lines, the film's last word on what each picture shows before money is spent.
 */
const FIT_MODEL = () => process.env.FIT_MODEL || "claude-opus-5-5";

/**
 * What a moving shot is (2026-09-30, the operator): "object" — something in the moment the words
 * describe moves BY ITSELF (smoke rising off a lit incense stick, fire, steam, water, a car driving
 * by, a door opening), everything else in the frame holding still; "none" — a photo with the slow
 * zoom. Never hands ("never do the videos with fingers"), and no camera moves ("no more b-roll
 * zoom and zoom in" — the camera-move kind was built and removed the same day).
 */
export type ShotMotion = "object" | "none";

export interface PlannedShot {
  /** The first 1–4 words of the shot, verbatim from the beat's text. */
  from: string;
  /** What the picture shows — literal, concrete. */
  show: string;
  motion?: ShotMotion;
  /** The KEY THING (props list name) this shot shows, when it shows one — its pictures share a look. */
  thing?: string;
  /** The exact words or number the picture must show printed, when the line itself says them. */
  text?: string;
  /** "blurred": the line talks about printing on the thing without saying it — shown unreadable. */
  print?: "blurred";
  /** One item of a spoken list. */
  list?: boolean;
  /** Shows the same thing as the shot before it — the context did not change. */
  same?: boolean;
  /** A tool cuts into, goes through or joins the material in this shot — always a photo. */
  contact?: boolean;
  /** Someone has to be holding or using the thing in this shot — the host's hands are in it. */
  held?: boolean;
  /** The person shown when the line is about someone other than the host (`otherPersonOf`). */
  other?: string;
  /** How far along the thing the video makes is in this shot — only on a shot of that thing. */
  stage?: BuildStage;
}

/** The build stages, earliest first (`scene.buildStage`). */
export const BUILD_STAGES: readonly BuildStage[] = ["material", "making", "done"];

/**
 * The build stage a model wrote, or undefined: only the three stage words count, any case — a null,
 * a missing field or anything else is "no stage", so the picture keeps the memory it had. Pure.
 */
export function buildStageOf(raw: unknown): BuildStage | undefined {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (BUILD_STAGES as readonly string[]).includes(v) ? (v as BuildStage) : undefined;
}

/**
 * Who a planner's `other` names, or undefined: a few plain words for a person who is NOT the host.
 * The host and the viewer ("you") are never "someone else" — their pictures stay the host's — and
 * an answer too long to be a description is dropped. An ANIMAL is no person (job 371: the planner
 * named "a hen" for "A hen will stick her head in the feeder", and the hen was forced into a picture
 * of a person). Any other answer stands — a story's people are too many for a list ("a scribe", a
 * name) — and the picture's own words decide again before it is drawn (`markHostBroll`). Pure.
 */
export function otherPersonOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const who = raw.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
  if (!who || who.split(" ").length > 8) return undefined;
  if (/\b(?:the )?(?:host|narrator|presenter|viewer)\b|^(?:you|me|i|null|none|no one|nobody)$/i.test(who))
    return undefined;
  if (namesOnlyAnimal(who)) return undefined;
  return who;
}

/** A model's words for the person a line speaks to: "you", "yourself", "the viewer", "you (the viewer)". */
const VIEWER_ANSWER = /^(?:(?:the\s+)?viewer|you|yourself)(?:\s*\((?:you|the viewer)\))?$/i;

/**
 * `otherPersonOf`, with THE VIEWER (`inputParams.viewerPerson`) when the video has one: "you" or
 * "the viewer" is then that person by their name, so every picture of them finds the same look
 * (`matchRecurringPeople`) — job 405 had its sleeping "you" written as "a sleeping person" in one
 * shot and as the host in another. Without a viewer, "you" is the host as before. Pure.
 */
export function otherPersonFor(raw: unknown, viewer?: RecurringPerson): string | undefined {
  if (viewer && typeof raw === "string") {
    const said = raw.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
    if (VIEWER_ANSWER.test(said)) return viewer.name;
  }
  return otherPersonOf(raw);
}

/**
 * How many people a "someone else" names, when more than one: "two airline passengers" is 2, "a
 * crowd" 3 (several). Undefined for one person. Pure.
 */
export function otherPeopleOf(who: string | undefined): number | undefined {
  const n = namedPeople(who)?.count ?? 1;
  return n > 1 ? n : undefined;
}

export interface ShotPlan {
  /** The beat's 1-based index. */
  scene: number;
  /** HOST beats only: the last words the host says on camera before the pictures take over. */
  hostUntil?: string | null;
  shots: PlannedShot[];
}

/**
 * The host's part of the HOOK (the video's opening line) runs at least this long before it may hand
 * over — the viewer has to see who is talking before the pictures take over. The same 2 s as any
 * hand-off (the operator's 2026-09-26 call: 2 s minimum, 5 s maximum, the script's first named
 * thing deciding where in between): at 3 s, Mae's "Out of 10 crochet projects I've made from"
 * (2.7 s) was too short and the host took the whole next picture, 5.4 s on camera.
 */
export const HOOK_HANDOFF_MIN_SEC = 2;
/**
 * The longest a host talks on camera before a hand-off's first picture. Hank's practice opening
 * ran 6.8 s — "Out of 10 Japanese woodworking projects you can build from cheap box-store lumber,
 * the one that paid me best for my time came out of" — past two things worth showing, because the
 * plan handed over before the LAST named thing instead of the first. The number is only a safety
 * limit — WHERE the host hands over is the script's call (the first thing it names), anywhere
 * between the 2 s minimum and this. 3.5 s left the window too narrow for a slow opening; the
 * operator set 5 (2026-09-26). Past it the beat is asked for again with the hand-off at the first
 * named thing.
 */
export const HOST_PART_MAX_SEC = 5;

/**
 * Words the host says after their own name in `text` — the self-introduction may run long to
 * reach the name, and only what comes AFTER it counts against `HOST_PART_MAX_SEC`. The name is
 * found the way the introduction was (`hostNameRanges`): looked for as the WHOLE name only, "I am
 * Sam" on Sawdust Sam's channel (job 407), or "I am Mae" on Granny Mae's, counted every word of the
 * line. Pure.
 */
export function wordsAfterName(text: string, hostName?: string): number {
  const toks = tokenSpans(text);
  const named = hostNameRanges(text, hostName);
  if (!named.length) return toks.length;
  const end = named[named.length - 1][1];
  return toks.filter(t => t.start >= end).length;
}

/**
 * Which beats the shot list may cut. The CTA, the cover, assets and splits are fixed. The hook is cut
 * too — it STARTS on the host and hands over at a natural break, like any host line — on BOTH
 * angles of a two-angle cold open: kept whole, the first angle held Granny Mae on camera for a 14 s
 * opening line. `next` is the beat after `s`: the film's last host line never hands over.
 */
/** Words a listed THING starts with — "a bin…", "the old drill…", "two spools…". */
const LIST_ITEM_START =
  /^(?:a|an|the|some|one|two|three|four|five|six|your|my|his|her|their|our|this|that|these|those|old|new)\b/i;

/**
 * The items when a line is JUST a spoken list of things, else null: one sentence of three or more
 * short pieces, split on commas / semicolons / "and" / "or", each naming a thing ("A bin in the
 * hall closet, a bag in the garage, maybe a box under the bed."). Built from the sentence's shape,
 * not its words, so it works for any channel and script. A line where the list is only PART of
 * the sentence ("I'm sitting at a table with a hook, a skein of yarn…") is not one — the host
 * hand-off already handles that shape. Pure — unit-tested.
 */
export function spokenListItems(text: string | undefined): string[] | null {
  const t = (text ?? "").trim().replace(/[.!?…]["'”’)\]]*$/, "");
  if (!t || /[.!?…]\s/.test(t)) return null; // one sentence only
  const items = t
    .split(/\s*[,;]\s*/)
    .flatMap(p => p.split(/\s+(?:and|or)\s+(?=(?:a|an|the|some|your|my|his|her|their|our)\b)/i))
    .map(p => p.replace(/^(?:and|or|maybe|plus|then|also|even)\s+/i, "").trim())
    .filter(Boolean);
  if (items.length < 3) return null;
  // A general head in front of its examples is not one of them (`withoutGeneralHead`, job 400's "some
  // ordinary place, a waiting room, a church pew"): the line still is a list — of the examples.
  const things = withoutGeneralHead(items);
  // "the hem went around once, the straps were four short seams, and the four squares finished it."
  // (job 106) is three clauses, not three things (`notAThing`).
  return things.every(p => LIST_ITEM_START.test(p) && p.split(/\s+/).length <= 8 && !notAThing(p)) ? things : null;
}

export function shotListEligible(
  s: StoryboardScene,
  next?: StoryboardScene
): boolean {
  const text = (s.scriptText ?? "").trim();
  return (
    text.split(/\s+/).length >= 3 &&
    s.cta !== true &&
    !s.qrHero &&
    !s.qrCorner &&
    !s.qrTail &&
    !s.coverHero &&
    !s.showsBook &&
    !s.assetImageUrl &&
    // The film's last line is the host's goodbye — it closes on the host, never on a picture.
    !(s.hostPresent && !next) &&
    !s.splitVisual
  );
}

interface TokenSpan {
  tok: string;
  start: number;
  end: number;
}

/**
 * Word tokens of `text` with their character offsets. Lowercased, curly apostrophes folded. A
 * hyphenated word is ONE token ("nine-patch", "box-store"): split, a hand-off could land inside it —
 * Hannah's real render cut from the host to the quilt between "a nine-" and "patch crib quilt".
 */
export function tokenSpans(text: string): TokenSpan[] {
  const out: TokenSpan[] = [];
  const re = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)))
    out.push({
      tok: m[0].toLowerCase().replace(/’/g, "'"),
      start: m.index,
      end: m.index + m[0].length,
    });
  return out;
}

/** Index of the first token of `phrase` in `spans` at or after `from`, or -1. */
export function findPhraseAt(
  spans: TokenSpan[],
  phrase: string,
  from: number
): number {
  const want = tokenSpans(phrase).map(t => t.tok);
  if (!want.length) return -1;
  for (let i = Math.max(0, from); i + want.length <= spans.length; i++) {
    if (want.every((w, k) => spans[i + k].tok === w)) return i;
  }
  return -1;
}

const ANGLES: NonNullable<StoryboardScene["shotAngle"]>[] = [
  "mid",
  "pov",
  "overhead",
  "wide",
  "low",
];

/**
 * The shot shows hands (or fingers) — never allowed to move in a video. A hand on a body only
 * (`BODY_HAND`): "hand tools on a pegboard" (job 406 scene 7) or "the hands of the wall clock" show
 * no one.
 */
export const SHOWS_HANDS = new RegExp(String.raw`\b(${BODY_HAND}|fingers?|thumbs?|palms?|wrists?)\b`, "i");
/**
 * Work where a tool must BITE into the material — drilling, sawing, driving a screw, hammering,
 * chiselling, cutting, carving. The video model cannot fake that contact: Norbert's 3-min test
 * (job 236, 2:19) drilled for 10 s with the bit never going in and splintering appearing somewhere
 * else. Such a shot is a PHOTO, never a video. "Cutting board" is a thing, not the work.
 */
const CONTACT_TOOL_WORK =
  /\b(drill(?:ing|ed)|drills? (?:a |the |into |through )|saw(?:ing|ed)|saws? (?:into|through)|hammer(?:ing|ed)|hammers? (?:a |the |in )|screw(?:ing|ed)|driv(?:e|es|ing) (?:a |the |in )?(?:screws?|nails?)|nail(?:ing|ed)|chisel(?:ing|ed|ling|led)|chisels? (?:into|out)|cut(?:ting|s (?:into|through))|slic(?:es|ed|ing)|chop(?:s|ped|ping)|carv(?:es|ed|ing)|whittl(?:es|ed|ing)|grind(?:s|ing)|planing)\b/i;
/** The ACTION of a tool biting in — a tool merely held or lying there ("holding a chisel") is not. */
export const contactToolWork = (show: string): boolean =>
  CONTACT_TOOL_WORK.test(show.replace(/\bcutting (?:boards?|mats?|tables?)\b/gi, "board"));

/**
 * What kind of VIDEO a shot of `show` may be — the one rule every path that makes a moving shot
 * goes through (the shot list, the context groups, the storyboard parser, the plan gate's top-up
 * and fixes, and the dispatcher right before a clip is paid for). A video is only ever of something
 * in the moment that MOVES BY ITSELF, with no person moving it — judged per picture on its own
 * description (`judgeSelfMoving`, `selfMoving`), not from a list of words: a list let "a sliding
 * door" and "a smoke alarm" through, and anything a person has to move (a door, a drawer, a tool)
 * never counts. Before that judgement a planner's request stands provisionally. Never hands, a
 * person, or a tool biting in. There is no camera-move kind (2026-09-30, the operator: "no more
 * b-roll zoom and zoom in"): an old "camera" request is read as "object". Pure.
 */
export function videoKind(
  show: string,
  wanted: "camera" | "object" | "hands" | "none" | undefined,
  opts: { person?: boolean; contact?: boolean; selfMoving?: boolean } = {}
): ShotMotion {
  if (!wanted || wanted === "none" || wanted === "hands") return "none";
  if (
    opts.person ||
    opts.contact ||
    contactToolWork(show) ||
    SHOWS_HANDS.test(show) ||
    // A person anywhere in the words (`showsPerson`: "an older couple walking"); the raw person
    // words too, so a pronoun read as an animal's never turns a picture into a video.
    SHOWS_PERSON.test(show) ||
    showsPerson(show)
  )
    return "none";
  return opts.selfMoving === false ? "none" : "object";
}

/**
 * The THING a shot description shows — the words before where it is or what it is doing ("the wood
 * stove" in "the wood stove in the corner of the living room"). Pure.
 */
export function shownThing(show: string): string {
  const m =
    /\s(?:on|in|at|beside|by|next to|near|under|against|inside|with|from|sitting|resting|standing|lying|leaning|hanging|set|placed|propped|atop|across|behind|between)\b|[,;—–(]/i.exec(
      show
    );
  return (m ? show.slice(0, m.index) : show).trim();
}

/** The earlier name of `videoKind`. */
export const safeMotion = (
  show: string,
  wanted: "camera" | "object" | "hands" | "none" | undefined
): ShotMotion => videoKind(show, wanted);

/**
 * A picture description that is about printing on a thing — a label, a date, the words on a box, a
 * tag, a stamp — which is then SHOWN, blurred and unreadable, unless its line says the words. Pure.
 */
export function blurredPrint(show: string | undefined): boolean {
  return /\b(labels?|printed|printing|print|dates?|tags?|lettering|writing|stamp(?:ed)?|markings?|specs|specifications|engrav(?:ed|ing)|monogram(?:med)?|inscri(?:bed|ption)|initials)\b/i.test(
    show ?? ""
  );
}

/**
 * The writing a picture may show: `text` exactly as the planner gave it, kept only when every one of
 * its words is in the spoken `line` — so nothing the script does not say can ever be printed in a
 * picture ("look for the date" with no date said leaves no date to print). Undefined otherwise. Pure.
 */
export function saidText(text: string | undefined, line: string): string | undefined {
  const t = (text ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "").slice(0, 60);
  const want = tokenSpans(t).map(x => x.tok);
  if (!want.length || want.length > 6) return undefined;
  const have = new Set(tokenSpans(line).map(x => x.tok));
  return want.every(w => have.has(w)) ? t : undefined;
}

/**
 * Hold one cutaway to the video rule: a moving shot that may not move becomes a photo (a person in
 * it stays in the photo — the host at work, from behind), one that may gets its kind. Returns
 * whether anything changed. The caller decides whether a clip already paid for is left alone.
 */
export function settleVideoKind(s: StoryboardScene): boolean {
  if (s.hostPresent || s.stillImage) return false;
  const kind = videoKind(s.showSubject ?? s.visualPrompt ?? "", "object", {
    person: !!s.humanPresent,
    contact: !!s.toolContact,
    selfMoving: s.selfMoving,
  });
  if (kind === "none") {
    s.stillImage = true;
    s.objectMotion = undefined;
    s.cameraMove = undefined;
    return true;
  }
  if (s.objectMotion === true && !s.cameraMove) return false;
  s.objectMotion = true;
  s.cameraMove = undefined;
  return true;
}

export const firstWords = (text: string, n: number) =>
  text.trim().split(/\s+/).slice(0, n).join(" ");

/** Everything a fresh piece of a beat must NOT inherit: its audio and any render of the parent. */
/**
 * How a later picture of the SAME thing is made to look different from the one before: a split
 * topic, or one topic that runs past its quarter's limit, must never show the same photo twice.
 */
/** `text` with `view` added — any full stop or trailing space taken off first. Pure. */
export const withView = (text: string, view: string) => {
  // An angle already on the text is REPLACED, never stacked: Scarlett's job 244 got "…, a close-up
  // of one detail of it filling the frame, a close-up of one detail of it filling the frame".
  let base = text.replace(/[\s.]+$/, "");
  for (let again = true; again; ) {
    again = false;
    for (const v of OTHER_VIEWS)
      if (base.endsWith(v)) {
        base = base.slice(0, -v.length).replace(/[\s.]+$/, "");
        again = true;
      }
  }
  return `${base}${view}`;
};
/** Which of `OTHER_VIEWS` a description ends with, 1-based; 0 for none. Pure. */
export const viewIndexOf = (text: string | undefined): number =>
  OTHER_VIEWS.findIndex(v => (text ?? "").endsWith(v)) + 1;

export const OTHER_VIEWS = [
  ", a close-up of one detail of it filling the frame",
  ", seen from much further back with the whole place around it",
  ", seen from the other side",
] as const;

export const FRESH = {
  sceneStatus: "pending",
  audioUrl: undefined,
  audioDuration: undefined,
  clipUrls: undefined,
  clipUrl: undefined,
  renderTaskIds: undefined,
  renderModelIndex: undefined,
  error: undefined,
  narrationStartSec: undefined,
  narrationEndSec: undefined,
} as const;

function hostPiece(
  parent: StoryboardScene,
  text: string
): StoryboardScene {
  return {
    ...parent,
    ...FRESH,
    scriptText: text,
    narration: firstWords(text, 8),
    wordCut: true,
    shotGroup: parent.index,
  } as StoryboardScene;
}

function picturePiece(
  parent: StoryboardScene,
  text: string,
  shot: Pick<PlannedShot, "show" | "motion" | "list" | "same" | "contact" | "held" | "other" | "thing" | "text" | "print" | "stage">,
  k: number
): StoryboardScene {
  // A video only of a big thing (`videoKind`): never hands, a held thing, or a tool going in.
  const motion = videoKind(shot.show, shot.motion, {
    person: !!shot.held || !!shot.other,
    contact: !!shot.contact,
  });
  const moving = motion !== "none";
  return {
    ...parent,
    ...FRESH,
    scriptText: text,
    narration: firstWords(text, 8),
    hostPresent: false,
    hostOpener: undefined,
    hostIntro: undefined,
    splitVisual: undefined,
    lipsynced: undefined,
    stillImage: !moving,
    // Someone holding or using the thing — moving or still — has hands in the picture, so a tool
    // is never drawn held up by nobody (Norbert's job 238: a drill "held near the doorframe"
    // floated). A person in a still is the host from behind (`markHostBroll`).
    // Hands in the photo, or someone holding the thing: the host at work (`markHostBroll`).
    humanPresent: shot.held || shot.other || showsPerson(shot.show) ? true : undefined,
    // A line about someone else shows THAT person, never the host in their place (`markHostBroll`).
    otherPerson: shot.other || undefined,
    otherPeople: otherPeopleOf(shot.other),
    objectMotion: moving ? true : undefined,
    cameraMove: undefined,
    keyThing: shot.thing || undefined,
    // How far along the thing being made is in THIS picture — never the beat's, so a re-planned
    // piece does not keep a stage its new picture may not have (`memorySourcesFor`).
    buildStage: shot.stage,
    // Writing only when this piece's own words say it, exactly (`saidText`); printing it only talks
    // about is shown blurred (`blurredPrint`).
    pictureText: saidText(shot.text, text),
    blurPrint: !saidText(shot.text, text) && (shot.print === "blurred" || blurredPrint(shot.show)) ? true : undefined,
    toolContact: shot.contact || contactToolWork(shot.show) ? true : undefined,
    visualPrompt: shot.show,
    visualPromptSeed: undefined,
    brollVisual: undefined,
    showSubject: shot.show,
    listCut: shot.list ? true : undefined,
    sameShot: shot.same && !shot.list ? true : undefined,
    // Every still zooms slowly (the operator, 2026-09-30: "no static images").
    staticShot: undefined,
    // Only the piece that starts the beat can be where the host comes in.
    hostCandidate: k === 0 ? parent.hostCandidate : undefined,
    wordCut: true,
    shotGroup: parent.index,
    shotAngle: ANGLES[k % ANGLES.length],
  } as StoryboardScene;
}

/**
 * Cut every planned beat into its shots. The words each shot starts on are found IN ORDER in the
 * beat's own text — a `from` that is not there (or is out of order) is dropped and its words stay
 * with the shot before, so the pieces always tile the beat verbatim. A host hand-off is dropped
 * when its words are not found, when nothing is left for the pictures, or on the self-introduction
 * when the host's part would not include the host's name.
 *
 * Returns the new list (renumbered) and each cut beat's ORIGINAL object by its old index, for
 * `settleShots` to restore when a cut does not survive measuring.
 */
export function applyShotPlan(
  scenes: StoryboardScene[],
  plans: ShotPlan[],
  opts: { hostName?: string } = {}
): { scenes: StoryboardScene[]; originals: Map<number, StoryboardScene> } {
  const byScene = new Map(plans.map(p => [p.scene, p]));
  const originals = new Map<number, StoryboardScene>();
  const out: StoryboardScene[] = [];
  for (let si = 0; si < scenes.length; si++) {
    const s = scenes[si];
    let plan = byScene.get(s.index);
    const text = s.scriptText ?? "";
    if (!plan || !shotListEligible(s, scenes[si + 1]) || !plan.shots?.length) {
      out.push(s);
      continue;
    }
    const spans = tokenSpans(text);
    let cursor = 0;
    const pieces: { at: number; host: boolean; shot?: PlannedShot }[] = [];
    if (s.hostPresent) {
      if (!plan.hostUntil) {
        out.push(s);
        continue;
      }
      const at = findPhraseAt(spans, plan.hostUntil, 0);
      if (at < 0) {
        out.push(s);
        continue;
      }
      let hostEnd = at + tokenSpans(plan.hostUntil).length; // first token the pictures own
      // The host says at least `HOST_HANDOFF_MIN_WORDS` before handing over — the model once handed
      // over after "I'm Granny Mae," (3 words, a 1.2 s flash of the host). Too early ⇒ the hand-off
      // moves on to the next shot's first word, that shot's picture dropped; none left ⇒ no hand-off.
      let shotsLeft = [...plan.shots];
      while (hostEnd < HOST_HANDOFF_MIN_WORDS && shotsLeft.length > 1) {
        const nextAt = findPhraseAt(spans, shotsLeft[1].from, hostEnd);
        if (nextAt < 0) break;
        hostEnd = nextAt;
        shotsLeft = shotsLeft.slice(1);
      }
      if (hostEnd < HOST_HANDOFF_MIN_WORDS || hostEnd >= spans.length) {
        out.push(s);
        continue;
      }
      plan = { ...plan, shots: shotsLeft };
      // The introduction keeps the name on the host — found as the introduction was found
      // (`namesHostBefore`), so "I am Sam" (Sawdust Sam, job 407) may hand over after the name too;
      // matched as the whole name only, every hand-off on such an introduction was refused.
      if (
        s.hostIntro &&
        opts.hostName?.trim() &&
        !namesHostBefore(text, opts.hostName, spans[hostEnd - 1].end)
      ) {
        out.push(s);
        continue;
      }
      pieces.push({ at: 0, host: true });
      cursor = hostEnd;
      // The first picture starts where the host stops, whatever its `from` says.
      let first = true;
      for (const shot of plan.shots) {
        if (first) {
          pieces.push({ at: hostEnd, host: false, shot });
          first = false;
          continue;
        }
        const at = findPhraseAt(spans, shot.from, cursor + 1);
        if (at < 0) continue;
        pieces.push({ at, host: false, shot });
        cursor = at;
      }
    } else {
      plan.shots.forEach((shot, k) => {
        if (k === 0) {
          pieces.push({ at: 0, host: false, shot });
          return;
        }
        const at = findPhraseAt(spans, shot.from, cursor + 1);
        if (at < 0) return;
        pieces.push({ at, host: false, shot });
        cursor = at;
      });
    }
    if (pieces.length < 2) {
      // One picture for a b-roll beat: no cut, but the literal picture still replaces the old one.
      if (!s.hostPresent && pieces.length === 1 && pieces[0].shot) {
        originals.set(s.index, s);
        out.push(picturePiece(s, text, pieces[0].shot, 0));
      } else out.push(s);
      continue;
    }
    originals.set(s.index, s);
    pieces.forEach((p, k) => {
      const from = spans[p.at].start;
      const to = k + 1 < pieces.length ? spans[pieces[k + 1].at].start : text.length;
      const slice = text.slice(from, to).trim();
      out.push(
        p.host ? hostPiece(s, slice) : picturePiece(s, slice, p.shot!, k)
      );
    });
  }
  // A spoken list is recognised from its words, not only from the planner's `list` mark: Hank's job
  // 268 had "and a stack of sandpaper," marked and "a saw," not, and the unmarked item folded away.
  // A picture the planner gave two items ("a saw, a drill,") becomes one picture per item.
  const listed = splitListPieces(out);
  markListPieces(listed);
  listed.forEach((s, i) => (s.index = i + 1));
  return { scenes: listed, originals };
}

/**
 * A picture whose words are two or more list items ("a saw, a drill,") becomes one picture per item,
 * each showing its own item in the place the planner's picture was ("… on the workbench"). Only a
 * non-host picture whose every comma piece (past a general head) reads as a list item. Pure — returns
 * a new list.
 */
export function splitListPieces(scenes: StoryboardScene[]): StoryboardScene[] {
  const out: StoryboardScene[] = [];
  for (const s of scenes) {
    const text = (s.scriptText ?? "").trim();
    // Never at a comma between describing words: "a short, heartfelt, loving essay" is one essay
    // (`seriesCommas`, job 400).
    const items =
      maskSeriesCommas(text)
        .match(/[^,;]+[,;]?/g)
        ?.map(x => unmaskSeriesCommas(x).trim())
        .filter(Boolean) ?? [];
    // A general head in front of its examples ("some ordinary place, a waiting room, a church pew,",
    // job 400) is not an item: its words lead the first example's picture, and with ONE example after
    // it the picture is no list at all (`ledByGeneralHead`).
    const headed = ledByGeneralHead(items);
    const examples = headed ? items.slice(1) : items;
    if (s.hostPresent || examples.length < 2 || !examples.every(anyListItem)) {
      out.push(s);
      continue;
    }
    const where = /\b(?:on|in|at|beside|by|near) the [^,]+$/i.exec(s.showSubject ?? "")?.[0];
    examples.forEach((item, k) => {
      const bare = item.replace(/^(?:and|or|plus|maybe|then|also)\s+/i, "").replace(/[,.;]$/, "");
      const show = `${bare}${where ? ` ${where}` : ""}`;
      const said = headed && k === 0 ? `${items[0]} ${item}` : item;
      out.push({
        ...s,
        ...FRESH,
        scriptText: said,
        narration: said,
        showSubject: show,
        visualPrompt: show,
        visualPromptSeed: undefined,
        stillImage: true,
        objectMotion: undefined,
        humanPresent: undefined,
        keyThing: undefined,
        otherKeyThings: undefined,
        buildStage: undefined,
        pictureText: undefined,
        sameShot: undefined,
        listCut: true,
        hostCandidate: k === 0 ? s.hostCandidate : undefined,
      } as StoryboardScene);
    });
  }
  return out;
}

/** A subject or a verb — the words that make a piece a clause rather than a named thing. */
export const LIST_ITEM_CLAUSE =
  /\b(i|you|he|she|we|they|it|is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|can|could|should|won|lost|sold|made|went|took|got|said|loved|liked|paid|cost|costs|sells|makes|takes)\b/i;

/**
 * A piece whose words are one item of a spoken list: a few words naming a thing — "a saw,", "a
 * drill,", "and a stack of sandpaper,", "two spools of thread." — any channel, any list. Pure.
 */
export function looksLikeListItem(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t || t.split(/\s+/).length > 7) return false;
  // A clause is not an item: "the cheapest fabric won," and "the one I loved most" say something
  // about a thing — a list item only names one.
  if (LIST_ITEM_CLAUSE.test(t)) return false;
  // "six and a half," and "three a side," open on a number but name nothing (`notAThing`).
  if (notAThing(t)) return false;
  return /^(?:(?:and|or|plus|maybe|then|also)\s+)?(?:a|an|the|some|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple of|your|my|his|her|their|our|this|that|these|those|old|new)\b[^.;:!?]*[,.;]?$/i.test(
    t
  );
}

/** Words that open a short aside, never a named thing ("Honestly," "Right," "Next,"). */
export const NOT_A_LIST_ITEM = new Set([
  "so", "then", "now", "well", "right", "okay", "ok", "honestly", "first", "next", "finally",
  "also", "yes", "no", "sure", "still", "anyway", "again", "here", "there", "today", "tonight",
  "after", "before", "because", "but", "if", "when", "while", "once", "until", "every", "each",
  // A piece that opens on these says where, how much or which — it does not name a new thing
  // ("all on one wall", "just for fun", "on the bench").
  "all", "just", "only", "even", "not", "most", "more", "less", "on", "in", "at", "for", "with",
  "from", "by", "to", "into", "onto", "over", "under", "about", "around", "like", "as", "of",
]);

/** A number word or figure ("six", "twenty", "half", "$20"). "quarter" is left out: a quarter is a coin. */
const NUMBER_WORD =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen|half|halves|third|thirds|\\$?\\d+(?:[.,]\\d+)?%?)";
const IS_NUMBER = new RegExp(`^${NUMBER_WORD}$`);
/** "thirty-five" is one number. */
const isNumber = (w: string) => w.split("-").every(p => IS_NUMBER.test(p));
/** Words that sit between number words without naming anything ("six AND A half", "two OR three"). */
const NUMBER_FILLER = new Set(["a", "an", "and", "or", "to", "point", "about", "maybe", "nearly", "almost", "roughly", "around"]);
/** A unit of time: a number of them is a length of time, not a thing. */
const TIME_UNIT = /^(?:seconds?|minutes?|hours?|days?|nights?|evenings?|mornings?|afternoons?|weeks?|weekends?|months?|years?|decades?|century|centuries|millennium|millennia)$/;
/**
 * What may lead a length of time besides number words ("A FEW weeks", "A COUPLE OF months", "A
 * century ago", "SOME years back").
 */
const TIME_QUANTITY = /^(?:a few|a couple|a couple of|several|another|many|a|an|some|a good many|so many)$/;
/** One word that may follow it and keep it a length of time ("… AGO"); "of …" may too ("… OF evenings"). */
const AFTER_TIME = /^(?:ago|later|earlier|back)$/;
/**
 * A time a sentence opens on, said in set words ("Long ago,", "Once upon a time,", "Back then,") —
 * the time a story starts at, never a thing in it. Closed list of ordinary English.
 */
const TIME_PHRASE = new Set([
  "long ago", "long long ago", "a long time ago", "a while ago", "a while back", "once upon a time",
  "back then", "back in the day", "way back when", "way back", "these days", "those days", "nowadays",
  "someday", "some day", "ever since", "since then",
]);
/** What leads a time said by when it was ("THAT night", "LAST summer", "THE NEXT morning", "ONE time"). */
const WHEN_LEAD = /^(?:that|this|last|next|the next|the following|the other|the same|one|early one|late one|early that|late that|later that|earlier that)$/;
/** Times named by "that / last / the next …" besides the units ("that SUMMER", "the same TIME"). Never "spring" or "fall": a coil spring and a fall are things too. */
const WHEN_WORD = /^(?:summer|winter|autumn|season|time|era)s?$/;
/** Set phrases, greetings and pronouns: said, never drawn. Closed list of ordinary English. */
const NOT_A_THING_PHRASE = new Set([
  "give or take", "more or less", "sooner or later", "and so on", "so on", "etc", "et cetera", "or so",
  "as well", "too", "either", "neither", "you know", "i mean", "of course", "at least", "at most",
  "for sure", "no doubt", "back up", "hello", "hi", "hey", "welcome", "thanks", "thank you",
  "goodbye", "bye", "please", "tell me", "nowhere else", "somewhere else", "anywhere", "everywhere",
  "anybody", "anyone", "everybody", "everyone", "nobody", "no one", "somebody", "someone", "anything",
  "everything", "something", "nothing", "whatever", "whoever", "that", "this", "it", "them", "those", "these",
]);
/** Prepositions `NOT_A_LIST_ITEM` does not hold: a piece opening on one says where ("through the pine"). */
const MORE_PREPOSITIONS = new Set([
  "through", "across", "along", "past", "behind", "between", "toward", "towards", "without", "within",
  "upon", "against", "beneath", "beyond", "than",
]);
/**
 * `NOT_A_LIST_ITEM` words that also lead a counted or chosen thing ("ALL the scraps you can find",
 * "EVERY spool of thread", "MORE glue", "JUST a pencil"): an item opening on one is judged on the
 * words after it, and is never a time ("every single morning", "all day long"). Only the model's
 * items reach this — the sentence-shape and piece tests refuse these openers themselves — and one
 * refused item drops the model's WHOLE list, which the shape rules cannot rebuild around it, so
 * refusing the opener lost "a tape measure, a pencil, and all the scraps you can find" outright.
 */
const LEADS_A_THING = new Set(["all", "every", "each", "most", "more", "less", "first", "next", "just", "only"]);
/** Words skipped when asking whether what follows such an opener is a time ("every SINGLE morning"). */
const TIME_FILLER = /^(?:the|a|an|single|other|whole|last|this)$/;
/** Nouns a number labels ("round ten", "chapter two", "step three"). */
const LABEL_NOUN = new Set([
  "round", "row", "chapter", "step", "part", "day", "week", "number", "page", "level", "size",
  "volume", "lesson", "rule", "tip", "stage", "phase", "item", "section",
]);
/** "three a side", "two per row". */
const RATE = new RegExp(`^${NUMBER_WORD}\\s+(?:a|an|per)\\s+\\S+$`);
/** "two or three rounds apiece", "three at once". */
const RATE_END = /\s(?:apiece|each|at once|at a time)$/;
/**
 * A contracted IS ("that's rude", "this one's for…"): the piece says something, it names nothing.
 * Not "everyone's", which is far more often whose ("everyone's favorite pie") than a verb.
 */
const CONTRACTED_IS = /\b(?:that|it|this|there|here|who|one|he|she|nobody|everything)'s\b/;
/** An adverb then a verb ("just looks", "still counts"). Never "even"/"only", which also lead a plural noun ("even stitches"). */
const ADVERB_VERB = /\b(?:just|still|already|never|always|actually|really|also)\s+[a-z]+s\b/;
/**
 * A thing, then a common linking or motion verb, then more ("the star LOOKS fine", "the word LIVES
 * in your head"). At least one word between the article and the verb, and never "… of" after it, so
 * "the sounds of the market" and "the wonders of the sea" stay things; never across "that/which/who"
 * or the subject of a clause with no "that" ("a curtain that came down years ago", "the box it came
 * in" and "the jar they live in" are things).
 */
const THING_THEN_VERB =
  /^(?:a|an|the|this|that|my|your|our|his|her|their|some)\s+(?:(?!(?:that|which|who|i|you|he|she|it|we|they)\b)[a-z'-]+\s+){1,5}?(?:looks|lives|seems|feels|sounds|counts|wonder|wonders|belongs|means|stays|happens|started|starts|ended|came|comes|went|goes)\s+(?!of\b)\S/;

/**
 * A number of time units: "five minutes", "six and a half hours", "a few weeks of evenings", "two
 * thousand years ago", "a century ago" — and bare units that say how long ago ("years ago", "months
 * later"), which a sentence opens on as often as on a counted one.
 */
function lengthOfTime(words: string[]): boolean {
  const u = words.findIndex(w => TIME_UNIT.test(w));
  if (u < 0) return false;
  const after = words.slice(u + 1);
  const ago = after.length === 1 && AFTER_TIME.test(after[0]);
  if (u === 0) return ago;
  const lead = words.slice(0, u);
  const counted =
    TIME_QUANTITY.test(lead.join(" ")) ||
    (lead.some(isNumber) && lead.every(w => isNumber(w) || NUMBER_FILLER.has(w)));
  return counted && (!after.length || after[0] === "of" || ago);
}

/**
 * A time said in other words than a length of it (2026-10-18, job 400 at 1:41: "Two thousand years
 * ago," was cut as item 1 of "Seneca's essay"; a counted time like it is `lengthOfTime`): a set
 * phrase ("long ago", "once upon a time", "back then"), "back in …" ("back in 1850"), a time named by
 * when it was ("that night", "last summer", "the next morning", "one time"), or "ago / later /
 * earlier" said on its own. Pure.
 */
function whenSaid(words: string[]): boolean {
  const core = words.join(" ");
  if (TIME_PHRASE.has(core)) return true;
  if (words.length === 1) return /^(?:ago|later|earlier)$/.test(core);
  if (words[0] === "back" && /^(?:in|then|when|around)$/.test(words[1])) return true;
  const last = words[words.length - 1];
  return WHEN_LEAD.test(words.slice(0, -1).join(" ")) && (TIME_UNIT.test(last) || WHEN_WORD.test(last));
}

/**
 * A LIST ITEM IS A THING (2026-10-18, the audit's replay of 336 jobs): why a spoken-list item names
 * nothing a picture could show, or null when it may. A list gets one picture per item, and nothing
 * asked what an item named — so "Round three, three a side, round ten, ten a side, and round twenty,
 * twenty." (job 351) became five pictures of one blanket, "six," (job 352) a stack of boards of its
 * own, "or nosy," (job 357) a dog's nose, and the model's "as health, as rest" (job 362) a chain on a
 * throat. Refused: numbers alone ("six and a half"), lengths of time ("five minutes", "a few weeks of
 * evenings", "two thousand years ago"), numbered labels ("round ten"), rates ("three a side", "…
 * apiece"), set phrases, greetings and pronouns ("give or take", "welcome", "nobody"), an aside or a
 * preposition first ("as rest", "through the pine"; "all/every/more…" are judged on what follows,
 * `LEADS_A_THING`), and a clause ("…if that's rude", "that still counts", "the star looks fine right
 * afterward"). A trailing "too / as well / either" is not part of what is named ("some glue too" is
 * glue). A describing word ending in -ed is NOT refused: "pieced from a few scraps, quilted, and
 * bound" (jobs 159, 174, 178) is three real stages. Closed lists of ordinary English, no channel's
 * words. Pure.
 */
export function notAThing(item: string): string | null {
  const core = item
    .trim()
    .replace(/’/g, "'")
    .replace(/[.!?;:,]+$/, "")
    .replace(/^(?:(?:and|or|plus|maybe|then|also|even|nor)\s+)+/i, "")
    .replace(/\s+(?:too|as well|either)$/i, "")
    .trim()
    .toLowerCase();
  const words = core.split(/\s+/).filter(Boolean);
  if (!words.length) return "no words";
  if (NOT_A_THING_PHRASE.has(core)) return "a set phrase or a pronoun";
  const first = words[0].replace(/[^a-z]/g, "");
  if (LEADS_A_THING.has(first) && words.length > 1) {
    const rest = words.slice(1).filter(w => !TIME_FILLER.test(w));
    if (rest.length <= 3 && (TIME_UNIT.test(rest[0] ?? "") || TIME_UNIT.test(rest[rest.length - 1] ?? ""))) return "a time";
    return notAThing(words.slice(1).join(" "));
  }
  if (NOT_A_LIST_ITEM.has(first) || MORE_PREPOSITIONS.has(first)) return "an aside or a preposition first";
  if (words.some(isNumber) && words.every(w => isNumber(w) || NUMBER_FILLER.has(w))) return "only a number";
  if (words.length === 2 && LABEL_NOUN.has(words[0]) && isNumber(words[1])) return "a numbered label";
  if (RATE.test(core) || RATE_END.test(core)) return "a rate";
  if (lengthOfTime(words)) return "a length of time";
  if (whenSaid(words)) return "a time";
  if (CONTRACTED_IS.test(core) || ADVERB_VERB.test(core) || THING_THEN_VERB.test(core)) return "a clause";
  // One describing word on its own names nothing (job 400: "furious," between "a short," and "loving
  // essay" was a picture of its own; "busy, important, and worn down" a list of three) — only when
  // the word is one whatever it stands beside (`describingWord`): "oak", "flour" and "quilted" stay.
  if (words.length === 1 && describingWord(words[0])) return "a describing word";
  return null;
}

/** Nouns that name a whole KIND of thing rather than one a picture could show ("some ordinary PLACE"). */
const GENERAL_NOUN = new Set([
  "place", "places", "spot", "spots", "location", "locations", "setting", "settings", "thing", "things",
  "stuff", "item", "items", "object", "objects", "way", "ways", "situation", "situations", "moment",
  "moments", "occasion", "occasions",
]);
/** "some KIND of …", "any SORT of …": a general noun whose kind is named after "of". */
const KIND_NOUN = new Set(["kind", "kinds", "sort", "sorts", "type", "types"]);
/** A head on its own: "somewhere", "something", "someone", "anything", "everywhere", "someplace"… */
const INDEFINITE_PRONOUN = /^(?:some|any|every)(?:thing|where|one|body|place)$/;
/** Words that start a thing of its own after a pronoun ("anybody with A porch"). */
const NEW_THING_WORD = new Set(["a", "an", "the", "my", "your", "his", "her", "our", "their", "this", "that", "these", "those"]);

/**
 * A GENERAL HEAD, never a list item (2026-10-18, job 400 at 0:47): in "…usually in some ordinary
 * place, a waiting room, a church pew, the kitchen table at two in the morning…" the first piece only
 * says what KIND of place the pieces after it are examples of, and it was cut as item 1 — a picture
 * of its own (a woman at a sink, scene 8) and row 1 of the list graphic, under a title that only
 * repeated it, so three places read as four. A head is an indefinite pronoun with at most four words
 * after it and no thing of their own ("somewhere", "something small", "someone you trust" — never
 * "anybody with a porch", whose porch is job 110's first item before "a patio, or a houseplant
 * habit"), or "some / any / a certain" with at most three describing words before a general noun
 * ("some ordinary place", "any old thing", "some other way"). "kind / sort / type of …" is a head
 * only after "a certain" or before a general noun ("a certain kind of wood", "any sort of place"):
 * "some kind of glue, a clamp, and a rag" is three things to get. "some glue", "some scrap pine" and
 * "somebody's barn" name real things and are not heads. Only ever asked of a list's FIRST item, with
 * examples after it (`ledByGeneralHead`). Closed lists of ordinary English. Pure.
 */
export function generalHead(item: string): boolean {
  const words = item
    .trim()
    .replace(/’/g, "'")
    .replace(/[.!?;:,]+$/, "")
    .replace(/^(?:(?:and|or|plus|maybe|then|also|even|nor)\s+)+/i, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return false;
  if (INDEFINITE_PRONOUN.test(words[0])) return words.length <= 5 && !words.slice(1).some(w => NEW_THING_WORD.has(w));
  const opener =
    words[0] === "some" || words[0] === "any" || words[0] === "certain" ? 1 : words[0] === "a" && words[1] === "certain" ? 2 : 0;
  if (!opener) return false;
  const rest = words.slice(opener);
  const kind = rest.findIndex(w => KIND_NOUN.has(w));
  if (kind >= 0 && kind <= 2 && rest[kind + 1] === "of")
    return rest.length <= kind + 5 && (words.includes("certain") || GENERAL_NOUN.has(rest[rest.length - 1]));
  return rest.length >= 1 && rest.length <= 4 && GENERAL_NOUN.has(rest[rest.length - 1]);
}

/**
 * Whether a list's first item is a general head the items after it are examples of (`generalHead`)
 * — never when the next item is a head too: "something sweet, something salty, and something to
 * drink" is three things. Pure.
 */
export function ledByGeneralHead(items: readonly (string | undefined)[]): boolean {
  return items.length >= 2 && generalHead(String(items[0] ?? "")) && !generalHead(String(items[1] ?? ""));
}

/**
 * A list's items without the general head in front of its examples (`ledByGeneralHead`): "some
 * ordinary place, a waiting room, a church pew" is two places. Only when two or more items follow the
 * head — a head with ONE example ("some quiet spot, a porch") is no list, and is left for the list
 * check to refuse. Returns the same array when there is nothing to drop. Pure.
 */
export function withoutGeneralHead<T extends string>(items: T[]): T[] {
  return items.length >= 3 && ledByGeneralHead(items) ? items.slice(1) : items;
}

/**
 * Words that only say what something is LIKE, whatever they stand beside — never a word that is as
 * often a thing ("light", "cold", "flat", "square", "fine", "crisp", "firm", "safe", "special", a
 * colour, a material) or an "-ed" stage ("quilted", "bound": jobs 159, 174, 178 are real stages).
 * Closed list of ordinary English.
 */
const DESCRIBING_WORD = new Set([
  "short", "long", "tall", "big", "small", "little", "tiny", "huge", "large", "vast", "great", "old",
  "young", "new", "good", "bad", "nice", "hard", "soft", "quick", "slow", "cheap", "rich", "poor",
  "bright", "dim", "simple", "plain", "clean", "dirty", "rough", "smooth", "warm", "hot", "cool", "loud",
  "thick", "thin", "heavy", "wide", "narrow", "deep", "shallow", "high", "low", "fresh", "sour", "bitter",
  "sharp", "dull", "busy", "angry", "happy", "sad", "glad", "tired", "weary", "proud", "brave", "gentle",
  "cruel", "honest", "humble", "strong", "weak", "sudden", "steady", "tidy", "messy", "ugly", "pretty",
  "strange", "odd", "rare", "common", "ordinary", "perfect", "stubborn", "bold", "fierce", "harsh",
  "tender", "loving", "caring", "worn", "important", "quiet", "calm", "lonely", "lovely", "friendly",
  "silly", "easy", "empty", "full", "lucky", "crazy", "afraid", "alive", "alone", "awake", "aware",
  "ready", "real", "true", "false", "sick", "ill", "dry", "wet", "damp", "raw", "ripe", "rotten",
  "broken", "sorry", "clever", "wise", "smart", "stupid", "polite", "rude", "patient", "tough",
  "fragile", "sturdy", "solid", "hollow", "bare", "dead", "brisk", "eager", "keen", "modest", "grand",
  "noble", "sacred", "holy", "ancient", "modern", "costly", "expensive", "inexpensive", "idle", "lazy",
  "cozy", "cosy", "shiny", "rusty", "dusty", "sticky", "chunky", "sleepy", "hungry", "thirsty",
  "filthy", "muddy", "dreary", "gloomy", "dark", "wild", "matte", "snug", "fuzzy", "homey", "scrappy",
  "stretchy", "soggy", "crispy", "crunchy", "creamy", "juicy", "salty", "spicy", "tasty", "greasy",
  "oily", "shabby", "sloppy", "grumpy", "quirky", "sleek", "plump", "skinny", "slim", "stiff", "loose",
  "tight", "neat", "fancy", "handy", "sunny", "rainy", "windy", "cloudy", "foggy", "stormy", "icy",
  "chilly", "frosty", "misty", "pricey", "typical", "normal", "elegant", "pleasant", "distant",
  "silent", "violent", "decent", "brilliant", "beautiful", "terrible", "horrible", "incredible",
  "impossible", "possible", "adorable", "comfortable", "durable", "affordable", "reliable", "washable",
  "reusable", "flexible", "sensible", "visible", "invisible",
]);
/** "-ful" words that are an amount, not a describing word ("a handful", "a spoonful"). */
const AMOUNT_FUL =
  /(?:hand|cup|spoon|mouth|arm|bucket|pocket|room|house|tank|truck|boat|basket|bowl|plate|jar|fist|lung|scoop|bag|box|car|pail|shovel|barrel|belly|eye|skin|tea|table|fork|glass|pot|pan|sack|cart|ship|bus|van|bed|head|lap|tub)ful$/;
/**
 * Things that end in "-ous" like a describing word: "rice, couscous, and quinoa" is three foods, and
 * one refused item drops a whole list of things (`itemsAreThings`).
 */
const OUS_THING = new Set(["couscous", "rendezvous", "bayous", "caribous"]);

/**
 * Whether a word only describes (2026-10-18, job 400: "a short, furious, loving essay" was cut into
 * three list items): one of `DESCRIBING_WORD`, a word with an ending that makes nothing else
 * ("furious", "careless", "cheerful" — never an amount, "a handful"), or the "-est" of one
 * ("biggest", "coziest"; "forest" and "harvest" end in -est too, so only when the rest is one). Pure.
 */
export function describingWord(word: string): boolean {
  const w = word.toLowerCase().replace(/’/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (!/^[a-z][a-z'-]*$/.test(w)) return false;
  if (DESCRIBING_WORD.has(w)) return true;
  if (OUS_THING.has(w)) return false;
  if (/^[a-z]{2,}ous$/.test(w) || /^[a-z]{3,}less$/.test(w)) return true;
  if (/^[a-z]{2,}ful$/.test(w)) return !AMOUNT_FUL.test(w);
  if (w.length > 5 && w.endsWith("est")) {
    const base = w.slice(0, -3);
    return [base, `${base}e`, base.replace(/i$/, "y"), base.replace(/([bdglmnpt])\1$/, "$1")].some(b => DESCRIBING_WORD.has(b));
  }
  return false;
}

/** Words a run of describing words follows: "A short, …", "HIS old, …", "TWO slowest, …". */
const SERIES_LEAD = new Set([
  "a", "an", "the", "my", "your", "his", "her", "its", "our", "their", "this", "that", "these", "those",
  "some", "any", "no", "such", "another", "every", "each",
]);
/** Words that may stand before a describing word without ending the run ("a REALLY long, …", "the MOST careful …"). */
const DEGREE_WORD = new Set(["very", "really", "so", "too", "quite", "rather", "pretty", "fairly", "most", "more", "less", "least", "extra", "super", "truly"]);
/** Words that are never one of a run of describing words, nor the thing it describes. */
const FUNCTION_WORD = new Set([
  ...Array.from(NOT_A_LIST_ITEM), ...Array.from(MORE_PREPOSITIONS), ...Array.from(SERIES_LEAD),
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "us", "them", "who", "whom", "whose", "which",
  "what", "where", "why", "how", "and", "or", "nor", "but", "yet", "is", "are", "was", "were", "be",
  "been", "am", "do", "does", "did", "has", "have", "had", "will", "would", "can", "could", "should",
  "may", "might", "must", "shall", "to", "than", "up", "down", "out", "off", "away", "back", "please",
  "ago", "later", "earlier", "too", "either", "though", "although", "since", "unless", "whereas",
  "whether", "except", "till", "lest",
]);
/**
 * A pronoun and a contracted IS ("that's", "it's"): what follows says what something IS, it does not
 * describe a thing in front of it — "that's too short, my doctor says" is no run, though "Grandma's"
 * leads one like "his" does ("Grandma's old, worn quilt").
 */
const PRONOUN_IS = /^(?:it|that|this|there|here|he|she|what|who|where|how|everything|nothing|something|everyone|everybody|nobody|someone)'s$/;

/**
 * Whether a run of describing words may start at `words[i]` (the last word of a comma piece): right
 * after "a / the / his / two…", a possessive or another describing word, at the start of a sentence,
 * or after a degree word that itself stands there ("a REALLY long, very slow walk"). Never after a
 * verb: "…complains that life is too short, Seneca says" (job 400's own script) and "which is too
 * strong, since folk schools…" say what something IS, and their commas separate nothing in front of
 * a thing. Pure.
 */
function runMayStart(words: string[], i: number, sentenceStart: boolean): boolean {
  if (i === 0) return sentenceStart;
  const before = words[i - 1];
  if (/[.!?]["'’”)\]]*$/.test(before)) return true;
  if (!PLAIN_WORD.test(before)) return false;
  const lb = lowerWord(before).replace(/^[^a-z0-9]+|[^a-z0-9']+$/g, "");
  if (DEGREE_WORD.has(lb)) return runMayStart(words, i - 1, sentenceStart);
  return SERIES_LEAD.has(lb) || isNumber(lb) || describingWord(lb) || (/'s$/.test(lb) && !PRONOUN_IS.test(lb));
}
/** One word with nothing after it — no full stop, comma or dash. */
const PLAIN_WORD = /^[A-Za-z][A-Za-z'’-]*$/;
const lowerWord = (w: string) => w.toLowerCase().replace(/’/g, "'");
/** A word that names or describes (not a function word, not a number). */
const contentWord = (w: string | undefined) =>
  !!w && PLAIN_WORD.test(w) && !FUNCTION_WORD.has(lowerWord(w)) && !isNumber(lowerWord(w));
/** A comma piece's words without its joiner and degree word ("and very loving essay" → "loving essay"). */
function seriesWords(words: string[]): string[] {
  let k = 0;
  if (/^(?:and|or)$/i.test(words[k] ?? "")) k++;
  // Only with a word after it: "pretty," on its own is one of the run's describing words.
  if (words.length - k > 1 && DEGREE_WORD.has(lowerWord(words[k] ?? ""))) k++;
  return words.slice(k);
}

/**
 * The commas INSIDE a run of describing words before one thing (2026-10-18, job 400 at 1:41): in
 * "…wrote a short, furious, loving essay to a man named Paulinus" the commas only separate the words
 * that describe ONE essay, and the shape rules cut them as list items ("Seneca wrote a short /
 * Furious / Loving essay"): three pictures, and a list graphic of nonsense. A run is: a piece ending
 * on a word where a run may start (`runMayStart`: right after "a / the / his / two…", a describing
 * word, or at the start of a sentence — never after a verb, "life is too short, he says"), or a
 * piece that is one describing word ("and warm,"); then pieces of ONE word each ("furious,"), none
 * after "and"; then a piece that is a word and the thing it describes ("loving essay…") — with at
 * least one word before that piece a describing word whatever it stands beside (`describingWord`),
 * so "a hammer, nails, and wood glue" stays three things, and "bring something warm, dry socks" (no
 * "a / the" before "warm") is no run. Returns each such comma's offset in `text`. Pure.
 */
export function seriesCommas(text: string): Set<number> {
  const out = new Set<number>();
  const pieces: { words: string[]; comma: number }[] = [];
  let from = 0;
  for (let k = 0; k <= text.length; k++) {
    if (k < text.length && text[k] !== ",") continue;
    pieces.push({ words: text.slice(from, k).trim().split(/\s+/).filter(Boolean), comma: k });
    from = k + 1;
  }
  for (let s = 0; s + 1 < pieces.length; s++) {
    const ws = pieces[s].words;
    const w1 = ws[ws.length - 1];
    if (!contentWord(w1)) continue;
    // A describing word that is a whole piece ("…a blanket, and WARM, dry socks") starts a run of its
    // own: one describing word is never a list item (`notAThing`), so it belongs to the thing after it.
    const lone = ws.length === 1 || (ws.length === 2 && /^(?:and|or)$/i.test(ws[0]));
    if (!runMayStart(ws, ws.length - 1, s === 0) && !(s > 0 && lone && describingWord(w1))) continue;
    const run = [w1];
    let e = s + 1;
    for (; e < pieces.length; e++) {
      // Only the LAST describing word follows "and" ("a big, heavy, and sturdy table"): "and warm,"
      // after a thing begins the NEXT thing ("a flashlight, a blanket, and warm, dry socks" is three).
      if (/^(?:and|or)$/i.test(pieces[e].words[0] ?? "")) break;
      const one = seriesWords(pieces[e].words);
      if (one.length !== 1 || !contentWord(one[0])) break;
      run.push(one[0]);
    }
    if (e >= pieces.length) continue;
    const [w, noun] = seriesWords(pieces[e].words);
    if (!contentWord(w) || !noun || FUNCTION_WORD.has(lowerWord(noun).replace(/[^a-z']+$/, "")) || !/^[A-Za-z]/.test(noun)) continue;
    if (!run.some(describingWord)) continue;
    for (let k = s; k < e; k++) out.add(pieces[k].comma);
    s = e - 1;
  }
  return out;
}

/** What stands in for a comma inside a run of describing words while a sentence is cut at its commas. */
const SERIES_MARK = "\u2063";
/**
 * `text` with every comma inside a run of describing words (`seriesCommas`) hidden, so a split at
 * commas keeps "a short, furious, loving essay" one piece; `unmaskSeriesCommas` puts them back. Pure.
 */
export function maskSeriesCommas(text: string): string {
  const inner = seriesCommas(text);
  if (!inner.size) return text;
  let out = "";
  for (let k = 0; k < text.length; k++) out += inner.has(k) ? SERIES_MARK : text[k];
  return out;
}
/** The commas `maskSeriesCommas` hid, back. Pure. */
export const unmaskSeriesCommas = (text: string): string => text.split(SERIES_MARK).join(",");

/**
 * A list item with no article — "flour,", "sugar,", "and butter." — a bare name of one to four
 * words: no subject or verb (`LIST_ITEM_CLAUSE`), no "-ly" word, not an aside ("Honestly,"). Only
 * ever counted inside a run of two or more (`markListPieces`), never alone. Pure.
 */
export function looksLikeBareListItem(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t || LIST_ITEM_CLAUSE.test(t)) return false;
  const core = t.replace(/^(?:and|or|plus)\s+/i, "");
  const words = core.split(/\s+/);
  if (words.length > 4) return false;
  if (!/^[a-z0-9][a-z0-9' -]*[,.;]?$/i.test(core)) return false;
  if (words.some(w => /ly[,.;]?$/i.test(w))) return false;
  if (NOT_A_LIST_ITEM.has(words[0].replace(/[^a-z]/gi, "").toLowerCase())) return false;
  // "twenty.", "give or take," and "too." are short and bare, and name nothing (`notAThing`).
  return !notAThing(t);
}

/** Either shape of list item. */
const anyListItem = (t: string | undefined) => looksLikeListItem(t) || looksLikeBareListItem(t);

/**
 * The pieces ONE thing was cut into at the commas of its describing words ("a man wrote a short," |
 * "heartfelt," | "loving essay…" — job 400's "a short, furious, loving essay" was cut this way):
 * each piece a run of describing words crosses at its last comma, and the piece after it
 * (`seriesCommas` over the film's running text). Never list items of their own. Pure.
 */
function piecesOfOneThing(scenes: StoryboardScene[]): Set<number> {
  const texts = scenes.map(s => (s.scriptText ?? "").trim());
  const ends: number[] = [];
  let at = 0;
  for (const t of texts) {
    at += t.length;
    ends.push(at - 1);
    at += 1;
  }
  const out = new Set<number>();
  const commas = seriesCommas(texts.join(" "));
  ends.forEach((end, k) => {
    if (k + 1 < scenes.length && commas.has(end)) {
      out.add(k);
      out.add(k + 1);
    }
  });
  return out;
}

/**
 * Mark every run of two or more consecutive pictures of one beat that each read as a list item
 * (`looksLikeListItem`), or one such picture beside a piece the planner already marked, as
 * `listCut` — so no fold, join or flash rule ever merges one item into another, whatever the
 * planner remembered to mark. Returns how many it newly marked. Pure apart from mutating `scenes`.
 */
export function markListPieces(scenes: StoryboardScene[]): number {
  let n = 0;
  const oneThing = piecesOfOneThing(scenes);
  const item = (k: number) => {
    const s = scenes[k];
    return !!s && !s.hostPresent && (s.listCut === true || (anyListItem(s.scriptText) && !oneThing.has(k)));
  };
  for (let i = 0; i < scenes.length; ) {
    if (!item(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < scenes.length && item(j + 1) && scenes[j + 1].shotGroup === scenes[i].shotGroup) j++;
    let run = scenes.slice(i, j + 1);
    // A general head at the front of the run ("some ordinary place," before "a waiting room,", job
    // 400) leads the examples and never counts as one of them, so it is never marked here.
    if (ledByGeneralHead(run.map(s => s.scriptText))) run = run.slice(1);
    if (run.length >= 2 || run.some(s => s.listCut))
      for (const s of run)
        if (!s.listCut) {
          s.listCut = true;
          s.sameShot = undefined;
          n++;
        }
    i = j + 1;
  }
  return n;
}

/** Words of a phone, tablet or laptop SCREEN picture (an app, a website, a listing). */
const SCREEN_WORDS =
  /\b(?:apps?|buy-and-sell|website|web\s?page|shop page|listings?|online (?:craft )?(?:shop|store)|(?:phone|tablet|laptop|computer)\s+screen|screen of (?:a|the|her|his) (?:phone|tablet|laptop))\b/i;

/**
 * A device or its screen, named in a picture's own words. A "screen picture" used to be any picture
 * whose words held "listing", "online shop" or "app", device or not: a crooked afghan "listing to
 * one side of the table" (job 151), a lit lantern "showing why the listing photo sells" (job 122)
 * and a split panel of a board "ready for an online shop photograph" (job 342) were each told what
 * a phone's screen shows — and, with a key thing, drawn as the photo inside a listing. A
 * screen-printed shirt and a screen door are not devices, and neither is a thing MADE FOR one: a
 * phone stand, a tablet holder or a computer desk ready for its listing photo has no screen in it.
 */
const NAMES_DEVICE =
  /\b(?:(?:smart|i)?phones?|tablets?|ipads?|laptops?|computers?|monitors?|screens?(?![-\s](?:print|door))|devices?|apps?|websites?|web\s?pages?|browsers?)\b(?![-\s](?:stands?|holders?|cases?|desks?|risers?|docks?|mounts?|cradles?|chargers?|cabinets?|carts?|shel(?:f|ves))\b)/i;

/** Whether a picture's words name a device or its screen (`NAMES_DEVICE`). Pure. */
export const namesDevice = (text: string): boolean => NAMES_DEVICE.test(text);

/**
 * A picture of a phone, tablet or laptop SCREEN (an app, a website, a listing) — only when its words
 * also name the device or the screen (`namesDevice`). The screen test of the memory step and the
 * picture-check log; `screenPicture` (server/pictureVariety.ts) is the same gate on the prompt's
 * screen words. Pure.
 */
export const showsScreen = (text: string): boolean => SCREEN_WORDS.test(text) && namesDevice(text);

/**
 * A screen that asks, in its own words, for things for sale. Not "listed" ("the three checks
 * listed", "morning flights listed at the top"): a thing listed for sale says so in other words.
 */
const SELLING_SCREEN =
  /\b(?:buy-and-sell|listings?|marketplace|online (?:craft )?(?:shop|store)|shop page|web-?shop|shopping (?:app|site|page)|for sale|storefront|product (?:photos?|pages?|listings?)|etsy|ebay|craigslist|offerup|mercari|poshmark|kijiji|gumtree)\b/i;
/**
 * "listing" as a VERB — an app, a menu or a chart listing what it lists — is no listing for sale:
 * "the scanner app listing manufacturer names" (production job 332) kept the grid of items for sale
 * while its neighbours, worded "app list", were drawn as described. Only the word goes, never the
 * noun before it ("the shop page listing the board" still sells), and the noun "listing" stays: "a
 * buy-and-sell app listing screen", "app listing with a price field", "app listing, a close-up".
 */
const LISTING_VERB =
  /(?<=\b(?:apps?|menus?|charts?|pages?|sheets?|lists?|panels?|windows?|screens?|displays?|logs?|forms?|bars?|columns?|rows?)\s+)listing(?=\s+(?!(?:photo\w*|pictures?|images?|pages?|screens?|titles?|texts?|grids?|details?|descriptions?|renewals?|prices?|fields?|feeds?|fees?|drafts?|previews?|thumbnails?|cards?|with|of|for|on|in|at|and|or|from|that|which|is|was|showing|open|visible)\b)[a-z])/gi;
/**
 * Screen content that is not a page of things for sale, even inside a selling app ("a buy-and-sell
 * app message screen"). "Setting" alone is a place ("a kitchen setting"); "settings" is the page. A
 * listing of a place to stay is a listing but not of things for sale (production job 332's rental
 * listing came back as a grid of bags and flashlights). A marketplace SEARCH is still a page of
 * things for sale — "a marketplace search results grid, listings of wooden dressers" (production
 * job 244) — so search results are left to the selling words.
 */
const OTHER_SCREEN_CONTENT =
  /\b(?:messag(?:e|es|ing)|chats?|text messages?|e-?mails?|inbox|maps?|booking|itinerar(?:y|ies)|calendar|reminders?|alarms?|camera|settings|setting (?:page|screen|menu)|passwords?|log-?in|sign-?in|forum|videos?|weather|bank(?:ing)?|payments?|receipts?|notifications?|cloud (?:storage|backup|account|app)|rentals?|propert(?:y|ies)|real estate|hotels?)\b/i;

/**
 * WHAT A SCREEN SHOWS IS WHAT ITS PICTURE SAYS. Every screen used to get one clause, "a simple
 * buy-and-sell app: a grid of small photos of items for sale" — over an airline seat map, a camera
 * app's password page and a buyer's message (production jobs 310, 260, 271), a tutorial video (job
 * 103) and a hand tapping "Subscribe" (job 393). The shot list had written what was on each screen;
 * the prompt builder then overrode it with the grid. The grid is now only for a picture whose OWN
 * words — never the line's: a selling line can show a message — ask for a selling screen and name
 * nothing else on it. Pure.
 */
export const sellingScreen = (text: string): boolean => {
  const own = text.replace(LISTING_VERB, " ");
  return SELLING_SCREEN.test(own) && !OTHER_SCREEN_CONTENT.test(own);
};

/**
 * A piece another may be merged INTO: never a list item (unless the piece merged is itself a list
 * item squeezed to a blink), whose own picture the join would lose
 * (Dale's job 293: a 1 s "Today I'm ranking" folded into "Etsy," and Etsy's picture was gone).
 * Every step that folds a too-short piece into a neighbour asks this — the shot list's settle, the
 * pause-snap fold and the plan gate. The one way in: a lead-in BETWEEN two items is said at the head
 * of the item after it, which keeps its own picture (`leadIntoItem`). Pure.
 */
export const mergeable = (
  n: StoryboardScene | undefined,
  /** The piece being merged: a list item squeezed to a blink may still join its neighbour item. */
  from?: StoryboardScene
): boolean => !!n && (!n.listCut || !!from?.listCut);

/** Join two adjacent pieces of one beat; the longer one's picture wins. */
function joinPieces(
  a: StoryboardScene,
  b: StoryboardScene,
  secA: number,
  secB: number
): StoryboardScene {
  const keep = secB > secA ? b : a;
  // The longer one's picture, never a picture of both ("a saw, together with a drill" — joining two
  // list items into one shot was rejected on 2026-09-27 and came back through here on Hank's job
  // 258). List items are no longer folded at all unless one is a blink (`LIST_SHOT_MIN_SEC`).
  return {
    ...keep,
    ...FRESH,
    scriptText: `${(a.scriptText ?? "").trim()} ${(b.scriptText ?? "").trim()}`.trim(),
    narration: firstWords(`${a.scriptText ?? ""} ${b.scriptText ?? ""}`, 8),
    listCut: undefined,
    hostCandidate: a.hostCandidate,
  } as StoryboardScene;
}

/** Split `s` into `n` pieces at word boundaries, preferring a comma/clause break near each cut. */
export function splitPicture(s: StoryboardScene, n: number): StoryboardScene[] {
  const text = s.scriptText ?? "";
  const spans = tokenSpans(text);
  if (n < 2 || spans.length < n * 2) return [s];
  const cuts: number[] = [];
  for (let k = 1; k < n; k++) {
    const ideal = Math.round((k * spans.length) / n);
    let best = ideal;
    // A token right after punctuation is a natural break — look a few words either side for one.
    for (let d = 0; d <= 3; d++) {
      for (const i of [ideal - d, ideal + d]) {
        if (i <= (cuts[cuts.length - 1] ?? 0) + 1 || i >= spans.length - 1) continue;
        const between = text.slice(spans[i - 1].end, spans[i].start);
        if (/[,;:.!?—–-]/.test(between)) {
          best = i;
          d = 99;
          break;
        }
      }
    }
    cuts.push(best);
  }
  const bounds = [0, ...cuts, spans.length];
  const out: StoryboardScene[] = [];
  const subject = s.showSubject ?? s.visualPrompt;
  // The view the picture already has (one `joinSameContext` gave a continuation): the parts count on
  // from it. Counted from the first view instead, a picture that was already "a close-up" gave its
  // second part "a close-up" again — the same words twice in a row, drawn as one photo twice. The
  // plan gate splits such pictures AFTER the join, so nothing caught it: jobs 302, 307, 310, 341 and
  // 352 each shipped a pair (job 341 scenes 3-4, the cutting board "unsold, a close-up" twice).
  const own = viewIndexOf((subject ?? "").replace(/[\s.]+$/, ""));
  for (let k = 0; k < n; k++) {
    const from = spans[bounds[k]].start;
    const to = k + 1 < n ? spans[bounds[k + 1]].start : text.length;
    const slice = text.slice(from, to).trim();
    // A split of ONE topic must not look like the same photo twice: each later part is a clearly
    // different VIEW of the same thing, named in its own subject so `joinSameContext` never folds
    // it back into the first.
    const variant = own ? OTHER_VIEWS[(own - 1 + k) % OTHER_VIEWS.length] : ["", ...OTHER_VIEWS][k % 4];
    out.push({
      ...s,
      ...FRESH,
      scriptText: slice,
      narration: firstWords(slice, 8),
      visualPrompt: k === 0 ? s.visualPrompt : withView(subject ?? "", variant),
      showSubject: k === 0 || !s.showSubject ? s.showSubject : withView(s.showSubject, variant),
      sameShot: undefined,
      hostCandidate: k === 0 ? s.hostCandidate : undefined,
      visualPromptSeed: undefined,
      shotAngle: ANGLES[(ANGLES.indexOf(s.shotAngle as any) + k + 1) % ANGLES.length],
      listCut: undefined,
    } as StoryboardScene);
  }
  return out;
}

/**
 * Make the measured pieces playable. `sec` is each scene's length as measured on the word
 * timeline (the caller has just run `assignSceneRanges`). Per beat that was cut:
 *  - the host's part of a hand-off under `HOST_HANDOFF_MIN_SEC` ⇒ the host keeps the whole line;
 *  - a picture under its floor folds into the picture before it (else after it); a hand-off left
 *    with no picture at all goes back to the host;
 *  - a picture over `MAX_PICTURE_SEC` is split into enough shots to get under it;
 *  - a moving picture under `MOTION_MIN_SEC` becomes a still (a video render cut to a blink).
 * Returns the new list (renumbered) and whether anything changed, so the caller re-measures and
 * calls again until it settles.
 */
export function settleShots(
  scenes: StoryboardScene[],
  originals: Map<number, StoryboardScene>,
  sec: (s: StoryboardScene) => number,
  /** The longest this picture may stay (`pictureMaxSecAt` for where it sits); flat limit otherwise. */
  maxAt: (s: StoryboardScene) => number = () => MAX_PICTURE_SEC
): { scenes: StoryboardScene[]; changed: boolean } {
  let changed = false;
  const out: StoryboardScene[] = [];
  for (let i = 0; i < scenes.length; ) {
    const g = scenes[i].shotGroup;
    if (g == null || !originals.has(g)) {
      // A picture the shot list never planned (its answer skipped the beat) keeps its storyboard
      // length — Granny Ruth's real render held one still for 8.1 s. Split it like any other.
      const s = scenes[i];
      const d = sec(s);
      if (
        !s.hostPresent &&
        d > maxAt(s) &&
        shotListEligible(s, scenes[i + 1])
      ) {
        const parts = splitPicture(s, Math.ceil(d / (maxAt(s) - 0.5)));
        if (parts.length > 1) changed = true;
        out.push(...parts);
      } else out.push(s);
      i++;
      continue;
    }
    let j = i;
    while (j < scenes.length && scenes[j].shotGroup === g) j++;
    let run = scenes.slice(i, j);
    i = j;
    const original = originals.get(g)!;
    const hostLed = run[0].hostPresent === true;
    // With the same snap margin the pictures keep, so the final cut cannot shrink it to a flash.
    const hostMin =
      (run[0].hostOpener ? HOOK_HANDOFF_MIN_SEC : HOST_HANDOFF_MIN_SEC) + SNAP_MARGIN_SEC;
    const lens = new Map(run.map(s => [s, sec(s)]));
    const len = (s: StoryboardScene) => lens.get(s) ?? sec(s);
    // A host part too short to be a shot hands over one picture LATER (on that picture's end, a word
    // the plan already chose as a cut) — reverting the whole beat kept a 15 s hook on camera when
    // only its first 2 s were short. With a single picture left there is nothing later to move to.
    // First, only as many words of the next shot as it needs (by that shot's own pace): Mae's host
    // took a whole 2.7 s picture to cover 0.3 s. The shot keeps its picture and starts later.
    if (hostLed && len(run[0]) < hostMin && run.length > 1 && !run[1].hostPresent) {
      const [h, p] = run;
      const text = p.scriptText ?? "";
      const spans = tokenSpans(text);
      const perWord = spans.length ? len(p) / spans.length : 0;
      const need = perWord > 0 ? Math.ceil((hostMin - len(h)) / perWord) : spans.length;
      const pMin = p.listCut ? LIST_SHOT_MIN_SEC : SHOT_MIN_SEC + SNAP_MARGIN_SEC;
      if (need > 0 && need < spans.length && len(p) - need * perWord >= pMin) {
        const cut = spans[need].start;
        const grown = {
          ...h,
          scriptText: `${(h.scriptText ?? "").trim()} ${text.slice(0, cut).trim()}`.trim(),
        } as StoryboardScene;
        const rest = {
          ...p,
          scriptText: text.slice(cut).trim(),
          narration: firstWords(text.slice(cut), 8),
        } as StoryboardScene;
        lens.set(grown, len(h) + need * perWord);
        lens.set(rest, len(p) - need * perWord);
        run = [grown, rest, ...run.slice(2)];
        changed = true;
      }
    }
    while (hostLed && len(run[0]) < hostMin && run.length > 2) {
      const [h, p] = run;
      const grown = {
        ...h,
        scriptText: `${(h.scriptText ?? "").trim()} ${(p.scriptText ?? "").trim()}`.trim(),
      } as StoryboardScene;
      lens.set(grown, len(h) + len(p));
      run = [grown, ...run.slice(2)];
      changed = true;
    }
    if (hostLed && len(run[0]) < hostMin) {
      out.push(original);
      changed = true;
      continue;
    }
    // Fold short pictures into a neighbouring picture of the same beat.
    let folded = true;
    while (folded) {
      folded = false;
      for (let k = 0; k < run.length; k++) {
        const s = run[k];
        if (s.hostPresent) continue;
        // A margin over the floor: the final cut snaps onto real pauses AFTER this measures, which
        // moves an edge by up to ~0.2 s — a shot measured at exactly the floor left as a 0.98 s flash.
        // (List items keep their exact floor — a real "a saw," is ~0.5 s and must stay its own shot.)
        const floor = s.listCut ? LIST_SHOT_MIN_SEC : SHOT_MIN_SEC + SNAP_MARGIN_SEC;
        if (len(s) >= floor || run.length === 1) continue;
        // Never INTO a list item: the joined piece would lose the item's own picture (`mergeable`).
        const prev = k > 0 && !run[k - 1].hostPresent && mergeable(run[k - 1], s) ? k - 1 : -1;
        const next = k + 1 < run.length && mergeable(run[k + 1], s) ? k + 1 : -1;
        const into = prev >= 0 ? prev : next;
        if (into < 0) continue;
        const [a, b] = into < k ? [run[into], s] : [s, run[into]];
        const joined = joinPieces(a, b, len(a), len(b));
        lens.set(joined, len(a) + len(b));
        run = [...run.slice(0, Math.min(k, into)), joined, ...run.slice(Math.max(k, into) + 1)];
        folded = true;
        changed = true;
        break;
      }
    }
    if (hostLed && run.length < 2) {
      out.push(original);
      changed = true;
      continue;
    }
    for (const s of run) {
      const d = len(s);
      if (!s.hostPresent && d > maxAt(s)) {
        const parts = splitPicture(s, Math.ceil(d / (maxAt(s) - 0.5)));
        if (parts.length > 1) changed = true;
        out.push(...parts);
        continue;
      }
      if (!s.hostPresent && !s.stillImage && d > 0 && d < MOTION_MIN_SEC) {
        s.stillImage = true;
        s.objectMotion = undefined;
        s.cameraMove = undefined;
      }
      out.push(s);
    }
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, changed };
}

// ─── The two LLM calls ──────────────────────────────────────────────────────────────

export const SHOT_LIST_SYSTEM =
  "You are the editor of a YouTube documentary, cutting b-roll to a narration that is already " +
  "recorded. For each numbered BEAT you get its exact words. Return the shots that play under it.\n\n" +
  "RULES\n" +
  "The examples below come from different kinds of videos; apply the rules to whatever THIS " +
  "script is about.\n" +
  "1. SAY IT, SHOW IT. Each shot shows exactly the concrete thing or action its words are about, " +
  'literally: "a basket of apples" is a basket of apples; "I lined the jars up on the shelf" is ' +
  "jars lined up on a shelf. Show the SUBJECT of the line, not its last noun: a place or surface the " +
  "line names (a market table, a shelf, a porch, a counter) is WHERE the subject is shown, never the " +
  "picture by itself or empty — \"will anyone pay for these at a craft fair?\" is the pieces laid out " +
  "on a craft-fair table. When a line refers to the work by a quality (\"that clean look\", \"this " +
  "style\", \"the good ones\"), show the work that has it. Use the PROPS LIST for how a recurring thing looks, so it looks the " +
  "same every time, and keep the story moving (what was being made is further along now).\n" +
  "1b. KEY THINGS. Every props-list line after the first is a KEY THING; the one marked MAIN is what " +
  "the whole video is about. Whenever a line is about a key thing — even when it only says \"it\", " +
  "\"this one\", \"the winner\" or \"the one that sold best\" — the shot shows THAT thing (when a " +
  "line only refers to the MAIN thing, the MAIN thing), with what else the line names beside it, " +
  "and sets thing to its name exactly as the props list writes it (without MAIN). But a key thing " +
  "appears ONLY when the line is about it: a line about something else shows that, never the main " +
  "thing out of habit (a line about the weather shows the weather; a line with nothing to see " +
  "follows rule 1f). A later shot of a key thing " +
  "shows the SAME thing from another " +
  "spot — closer on one part, further back with the room around it, the other side, from above or " +
  "low down — the view the words point at, never the same view as the shot of it just before. A " +
  "before / during / after of one piece is the SAME piece each time, further along.\n" +
  "1e. STAGE. Only for a shot that shows something the video MAKES (or shows being made), or what " +
  "it is made from, set stage to how far along that thing is IN THIS SHOT: \"material\" — the raw " +
  "stock or pieces before any work (a stack of rough boards, a pile of fabric scraps, a ball of " +
  "dough); \"making\" — being made or partly built (cut, drilled, half-sewn, glued up, partly " +
  "assembled); \"done\" — finished. " +
  "Finishing touches (oil, wax, polish, a felt pad, a last brush) count as done. Many videos open " +
  "on the finished piece and then go back to the start: a making shot shows the piece only as far " +
  "along as its words say, never already finished. The stage is about the piece in the shot, " +
  "whatever its thing is (a shot filed under the bench or a tool with the piece on it still has " +
  "one). stage is null for every other shot — a thing nobody makes in the video, a tool on its " +
  "own, a place, the weather.\n" +
  "1d. DON'T REPEAT. When a line's subject is already on screen from the picture before (the line " +
  "says \"it\", \"this\", \"that one\") and the line names something NEW you can see — a thing, or a " +
  "kind of event or situation (\"the storms that roll in at night\") — the shot shows the new thing " +
  "(\"It also works on a cast-iron pan\" after a picture of a spatula = the cast-iron pan).\n" +
  "1c. SHOW WHAT IT IS ABOUT, THEN WHAT IS NEW. A line that names or explains a key thing shows " +
  "THAT thing first — the main thing whenever the line is about it. When the same line goes on to " +
  "name something new you can see (\"… the kind you'd find in an old farmhouse kitchen\"), a new " +
  "shot starts on those words and shows it — but only when each part is a good few seconds long. " +
  "A SHORT line stays ONE shot: when it names a thing and where or how it is used, sold or kept " +
  "(\"sell your quilts at the county fair\", \"list it on a buy-and-sell app\"), the one shot shows " +
  "them together — the thing in that place, or as a listing on a phone.\n" +
  "1f. A LINE WITH NOTHING TO SEE. When a line carries an idea rather than a thing — an argument, " +
  "a turn in the reasoning, a claim, a lesson, a feeling, a promise of what the video will show " +
  "(\"then she turns the whole question around\", \"the money was never the real problem\", \"by " +
  "the end you'll know why\") — the shot is an everyday moment that carries what it means: a person " +
  "or a place the script already has, caught doing something that fits the thought (the neighbour " +
  "from the story back at her own kitchen sink, a writer the script names at work), or the host at " +
  "work. Someone who is not the host is shown as rule 6a says, with other set to who they are. " +
  // Job 413 scene 10: "Here's tonight's deal:" was planned as the host pulling a stool up to the
  // bench — the stool of "Pull up a stool." 9 s later, which then played over another picture.
  "Never a thing a LATER line names (\"Here's the plan:\" before \"Put the kettle on.\" is not the " +
  "kettle): shown before its words, it is gone by the time it is said. " +
  // Job 409 scene 33: "Then he turns the whole thing over in a single motion: life is not short" —
  // the writer of the story reversing his argument — was planned as "the host turning a page slowly
  // at the desk": the wrong person, and the idiom drawn as its literal verb.
  "When the line tells what someone in the story thinks, says or does — \"he\" or \"she\" for a " +
  "person the script is talking about (a writer, a figure from history, a neighbour) — the moment is " +
  "THAT person's, never the host's: the host only ever speaks of themself as \"I\". A FIGURE OF " +
  "SPEECH is shown by what it means, never by its literal words: \"he turns the argument on its " +
  "head\" is that person at the moment the thought turns — nobody upside down, no page or object " +
  "turned over; \"she closed the book on it\", said of a part of her life, is no book. Only a how-to " +
  "that really turns, opens or lifts a thing (\"turn the board over and sand the other side\") is " +
  "shown literally. " +
  "Never the MAIN thing because nothing else came to mind: it appears only when the line " +
  "names it or clearly points back at it, and \"the whole thing\", \"all of it\" or \"that\", summing " +
  "up what was just said, point at the idea, never at a thing. Each such line gets its own moment: " +
  "a later one never repeats a picture an earlier one already had — though one thought running on " +
  "across sentences is still ONE shot (rule 2). A line that speaks of a thing by its quality, price, " +
  "count or time is not one of these: it shows the thing (rules 1 and 5).\n" +
  "1g. A SOUND. A line about a sound — a song, a call, a noise, a hum, a sound that has stopped — " +
  "shows what makes it (an animal, a machine, a person, the weather) in the moment the line " +
  "describes, where it is, and quiet when the line says it has gone quiet (\"the dog has stopped " +
  "barking\" = the dog lying still by the gate). Never only the window, door or room the sound is " +
  "heard through, even when the line names it — that is where the picture may be seen from, with " +
  "the source in it — and never an empty place the line does not say is empty.\n" +
  // Job 409 (156-164 s): inside a passage about a writer of ancient times, the shots of "the farmer
  // complains, … the old complain, and the young …" named no time and came back as today's people —
  // overalls, a park bench, a hoodie — because rule 11 sent a shot with no place of its own home.
  "1h. ANOTHER TIME OR PLACE. When the words are inside a passage set in another time or a faraway " +
  "place, away from the video's own here and now — history, a story of long ago, what a writer of another age wrote or saw, how things are " +
  "done in another country — every shot until the words come back to today or to the host's own " +
  "life names that time and place in show and dresses its people, tools and buildings for it: the " +
  "shots of a spoken list and a shot of a bare word too (\"the baker\" in a passage about a medieval " +
  "town = a medieval baker in a linen tunic at a brick oven, never a baker of today). A line inside " +
  "it about today is today.\n" +
  "2. CHANGE THE PICTURE ONLY WHEN THE CONTEXT CHANGES. A new shot starts only where the words move " +
  "on to a DIFFERENT thing, place or action. While the words stay on the same thing — even across " +
  'several sentences — it is ONE shot: "a pile of old crates the neighbour set out by the curb" ' +
  "is one shot of the crates by the curb, not the crates and then the curb. Fewer, " +
  "longer shots are better than many quick ones; a shot may run 10 seconds or more when nothing " +
  'new is named. The ONE exception is a spoken list: one quick shot per item ("a needle, a spool ' +
  'of thread, and a pair of shears" = three shots, list: true).\n' +
  "3. SAME AS BEFORE. When a beat's FIRST shot shows the same thing as the shot before it (the " +
  "previous beat is still on that subject), set same: true — it continues that picture instead of " +
  "starting a new one. Use it whenever the context has not changed.\n" +
  "4. A COMPARISON IS NOT A SHOT. When a line compares the subject to something else to say how " +
  'much it costs or what it is like ("yarn that costs more than a good roast"), show the subject.\n' +
  "5. NO WRITING. Never a shot of words, numbers, prices, signs, labels, notes, tally " +
  "marks, chalkboards, calendars or clocks — show the thing the number is about (\"six dollars " +
  'for those coasters" = the coasters; "how long it took" = the work in progress; "the tally I ' +
  'keep" = the finished pieces).\n' +
  "5d. A BODY PART NEVER LOOKS CUT OFF: hair, a hand, a foot or a face is shown on the person, or on what really holds it — a wig on a mannequin head or wig stand, a practice hand, extensions in their packet. A few loose strands that really fall (in a brush, on a comb or towel, in a drain) are fine. Never hair still shaped like a head or a hairstyle with no head inside it, and never a hand, foot or face on its own. To show a colour or texture, show it on the person's own head or hands.\n" +
  "5e. SHOW EXACTLY WHAT THE LINE POINTS AT: when a line points at a specific thing, or a specific part, side or detail of a thing (the box it comes in, its label, the battery door on the back, the dial, the date on the bottom, the hem), the picture is a close-up of exactly that — never the video's main thing somewhere else, never a plain version without it. What the script says that part shows (the words printed on it, a number, a setting) is shown exactly as the script says it.\n" +
  // Job 403: "Here is the part nobody sees. Inside the porcelain…" was planned as a cutaway close-up
  // of the channel inside the fixture, and the picture maker sawed the fixture open to draw it.
  `5f. ${NOTHING_CUT_OPEN_RULE} It holds over rule 5e: a close-up of a hidden part is a close-up of where it opens or comes out.\n` +
  "5c. WRITING ONLY WHEN SAID. A picture may show readable writing ONLY when the line itself says " +
  "the exact words or number printed on a thing (\"the tag says HANDMADE\" = the tag with HANDMADE " +
  "on it): set text to exactly those words, spelled as spoken. Never invent any: when a line talks " +
  "about printing on a thing without saying it (\"check the date on it\", \"three things printed on " +
  "the box\"), show the thing WITH its printing and set print: \"blurred\" — the print is there, soft " +
  "and out of focus, unreadable.\n" +
  "5b. APPS. A screen is shown ONLY when the line is about the app, the website or the act of " +
  "listing or selling online itself (\"I listed it on a buy-and-sell app\", \"open the app\"). When " +
  "the line only MENTIONS where something sold and is about the thing, the buyer, the sale or the " +
  "money, show THAT instead — the piece itself, it being packed, handed over or shipped. Never two " +
  "screens in a row. A screen shows what the line says is on it (a listing, a message, a search, " +
  "a sale) — not always the same grid — on a phone, tablet or laptop, in a different place each " +
  "time. Never a brand or app name in show: any named app or site is written as what it is (\"a " +
  "buy-and-sell app\", \"an online shop\").\n" +
  "6. PEOPLE. The only person who may ever appear is THE HOST (described below, when given), and " +
  "only DOING the work — seen from behind or from the side, over the shoulder, hands at the task, " +
  "face turned away or out of frame. Never a face. With no host given, only bare hands at the " +
  "work.\n" +
  "6a. SOMEONE ELSE. When a line is about ANOTHER person doing something — a customer, a buyer, " +
  "a neighbour, a relative, a stranger, a person of the story the line calls \"he\" or \"she\" " +
  "(rule 1f); never the host, and never \"you\" (the viewer's work is " +
  "shown as the host's) unless THE VIEWER is given below — the picture may show THAT person, the " +
  "same way: from behind or from the side, the face never shown. Write them into show, and set " +
  "other to who they are in 2-6 plain words from the line (\"a woman customer\", \"an older " +
  "neighbour\"). One person only. When that person is one of the PEOPLE WHO COME BACK (listed " +
  "below, when given), other is their name exactly as written there. When THE VIEWER is given " +
  "below, \"you\" is that person and never the host: every shot of \"you\" — doing, holding, " +
  "having or feeling something, or something happening to them, the list shots that go on from a " +
  "sentence about \"you\" too — shows them the same way, with other set to the viewer's name " +
  "exactly as written there. other is null in every other shot.\n" +
  "6b. WHAT NOT TO DO. When a line — or the sentence it is part of — says not to do something " +
  "(\"never…\", \"don't…\"), says what something is NOT (\"I don't mean…\"), what to use INSTEAD, " +
  "what to keep away or out, that a job is for someone else (a licensed pro), or warns that doing " +
  "something goes wrong (\"…is how people get hurt\", \"…only sets things back\"), the shot shows " +
  "ONE of: the same task done the RIGHT way (the guard in place, a push stick, hands well back, " +
  "the iron set down on its heel, the extinguisher by the bench), the alternative the line names, " +
  "or the subject on its own and idle. Never the ruled-out act, the denied thing or the forbidden " +
  "placement — no fingers near a blade or a needle, no open flame on the work, nobody hurt. show " +
  "names only what IS in the frame: never the ruled-out thing, not even with \"without\", \"no\", " +
  "\"not\", \"away from\" or \"across the room from\" — the picture generator draws everything it " +
  "is told about (\"keep the paint tins away from the stove\" = the paint tins on a shelf in a cool " +
  "cupboard; the stove is not named). Every shot of that sentence follows it (\"Never store it in | the " +
  "attic | or the garage\": no shot puts it in the attic or the garage). A thing named only to be " +
  "ruled out is never the new shot of rules 1c and 1d. A figure of speech that rules out nothing " +
  "you can see (\"don't count on it\", \"you'll never look at it the same way\") is not this rule.\n" +
  "7. HOST BEATS are the host talking on camera. If, after the host has said at least 5 words, the " +
  "line goes on to NAME concrete things worth showing, hand over to pictures at the FIRST such " +
  "thing — not a later one: the host never talks past a thing worth showing — at a natural break " +
  'right before it, or at a comma or "and", by setting hostUntil to the last 1-4 ' +
  "words the host says on camera, copied exactly, then list the shots for the rest (\"Of all the " +
  'things I made for the market, | the one that sold first | was a plain wooden bowl," — not on to ' +
  'a thing named three phrases later). If the line ' +
  "names nothing to show, hostUntil is null and shots is []. On a HOOK beat (the video's opening " +
  "line) the host says at least the first 6 words on camera, then hands over the same way — to ONE " +
  "picture for the rest of that thought, not a run of quick ones. On an " +
  "INTRO beat the host must say " +
  "their own name on camera first — and once they have, a line that goes on to name things MUST " +
  "hand over (\"I'm Pat, and this is for anybody with | a garden bed, | a bag of seed, | and a free " +
  'Saturday").\n' +
  "8. motion — MOST SHOTS ARE PHOTOS (\"none\"); every photo gets a slow zoom. SHOW IT HAPPENING in " +
  "a photo: when the words are about making, using or fixing something, the photo shows the host's " +
  "hands doing it. A shot is a VIDEO (\"object\") when, in the moment the words describe, something " +
  "MOVES BY ITSELF, with no person moving it — a flame, smoke, steam, running or falling water, " +
  "rain, leaves in the wind, traffic going by. What moves is that; everything else in the frame " +
  "holds still. Anything a person has to move (a door, a drawer, a tool, a page) is a photo. Show " +
  "it happening in show (\"a candle burning on the table, its flame flickering\"). NEVER a video with " +
  "hands, fingers or a person in it, and never a camera move. When the line is about the MAIN thing " +
  "and something with it can move by itself, that shot is the one to make a video — and the FIRST " +
  "time the MAIN thing appears, if it is something naturally used with smoke, steam, a flame or " +
  "water, show it in use — lit, steaming, burning, running. A thing with nothing that moves by " +
  "itself stays a photo. About one shot " +
  "in six moves, never more than one in four.\n" +
  "9b. contact: true when the shot shows a tool CUTTING INTO, GOING THROUGH or JOINING the " +
  "material — in ANY craft or wording: drilling, sawing, a screw or nail going in, stapling, " +
  "punching holes, welding or soldering, piercing, engraving, carving, chiselling, cutting cloth " +
  'or paper. Such a shot is ALWAYS motion "none": a video cannot show a tool really going in. ' +
  "Holding a tool, a tool lying there, and gentle work (sewing, knitting, crocheting, sanding, " +
  "painting, wiping) are false.\n" +
  "9c. held: true when someone must be HOLDING or USING the thing in this shot for it to make " +
  "sense — in any wording: a drill raised to the frame, a hair dryer aimed at the curls, scissors " +
  "poised over the cloth, a phone held up to the screen, a cup lifted to drink. The picture then " +
  "shows the host's hands on it, and it is a photo. True as well when the thing is being WORN or " +
  "is on a body in this shot — clothing, shoes or jewellery shown on someone, moving the way a " +
  "worn thing moves, or sitting where it sits on a body: say who is wearing it in show, because " +
  "a worn thing with nobody in it is drawn as an empty shape. False when the thing simply lies, " +
  "stands or hangs there, or sits on a hanger, a hook or a stand.\n" +
  "10. from: the first 1-4 words of the shot, copied EXACTLY from the beat, in order. The first " +
  "shot of a non-host beat starts at the beat's first word.\n" +
  "11. show: 8-20 plain words saying what is in the frame, the way a person would caption their " +
  "own phone snapshot: the thing, where it is, and how far away the photo was taken from — vary " +
  "it, often a step or two back, sometimes closer; never a close-up of every thing. The place is " +
  "the one the line names, else the time and place of the passage it is in (rule 1h), else the " +
  "props list's home setting. No light, mood, texture or style " +
  "words, and no decorative extras the words do not mention (\"the old crates stacked by the " +
  'curb in front of the house"). ONE picture: never "or" ("an engraved board or a ' +
  'keepsake box" — pick one), never two places.\n' +
  "12. NAME IT EXACTLY. When the words name a SPECIFIC kind, pattern or design — a herringbone " +
  "path, a dovetail joint, a French seam — keep that exact name in show " +
  "and add, in plain words, what it LOOKS like, because the picture generator may not know the " +
  'term: "a herringbone brick path — bricks laid in a zigzag of short rows", never just "a brick ' +
  'path".\n\n' +
  "Return ONLY JSON: " +
  '{"beats":[{"beat":N,"hostUntil":null|"...","shots":[{"from":"...","show":"...","motion":"none","thing":null,"stage":null,"text":null,"print":null,"list":false,"same":false,"contact":false,"held":false,"other":null}]}]}';

/**
 * Ask for the shot list, `SHOT_BATCH` beats per call, `SHOT_CONCURRENCY` calls at once. Each call
 * carries the props list and the storyboard's pictures just before its batch, so the story keeps
 * moving across batches. A batch that fails is retried as two halves; one that still fails plans
 * nothing — its beats keep the storyboard's pictures — rather than failing the film.
 */
export async function planShotList(
  scenes: StoryboardScene[],
  opts: {
    sheet?: string;
    hostName?: string;
    /** How the host looks (`inputParams.hostLook`) — the only person b-roll may show, from behind. */
    hostLook?: string;
    /**
     * The people other than the host who come back in the story (`inputParams.recurringPeople`) —
     * NAMES only, so a shot of one names them the same way every time (`matchRecurringPeople`
     * finds their look by it). Their looks stay out of `show`, which the picture check holds the
     * frame to.
     */
    people?: RecurringPerson[];
    /**
     * WHO "YOU" IS when the viewer is someone the host's job serves (`inputParams.viewerPerson`) —
     * the NAME only, like `people`: every shot of "you" names them, never the host (job 402 scenes
     * 17 and 20 drew a passenger's "you" as the host in her crew uniform).
     */
    viewer?: RecurringPerson;
    subject?: string;
    log?: (m: string) => void;
    /** Plan only these beats (their eligibility is still judged in the full list). */
    only?: Set<number>;
    /** Beats that MUST hand over after their first phrase — a long hook the first answer kept whole. */
    mustHandOff?: Set<number>;
  } = {}
): Promise<ShotPlan[]> {
  const keyThings = parseKeyThings(opts.sheet);
  const eligible = scenes.filter(
    (s, i) =>
      shotListEligible(s, scenes[i + 1]) && (!opts.only || opts.only.has(s.index))
  );
  const before = (first: StoryboardScene): string[] => {
    const at = scenes.indexOf(first);
    return scenes
      .slice(Math.max(0, at - 6), at)
      .filter(s => !s.hostPresent && s.visualPrompt)
      .slice(-4)
      .map(s => s.visualPrompt.split(/\s+/).slice(0, 14).join(" "));
  };
  const ask = async (batch: StoryboardScene[]): Promise<ShotPlan[]> => {
    const lines = batch.map(s => {
      const kind = s.hostPresent
        ? s.hostOpener
          ? "HOST HOOK"
          : s.hostIntro
          ? `HOST INTRO${opts.hostName ? ` (name: ${opts.hostName})` : ""}`
          : "HOST"
        : "B-ROLL";
      const must = opts.mustHandOff?.has(s.index)
        ? " — the host talks too long before the first picture: it MUST hand over at the FIRST thing it names after its first 5-6 words (hostUntil = the last 1-4 words before that thing, at most 12 words in), with shots for the rest"
        : "";
      return `BEAT ${s.index} [${kind}]${must}: "${(s.scriptText ?? "").trim()}"`;
    });
    const prior = before(batch[0]);
    const userMessage =
      (opts.subject ? `VIDEO SUBJECT: ${opts.subject}\n` : "") +
      (opts.hostLook
        ? `THE HOST (shown from behind or the side whenever a picture is of someone doing the work): ${opts.hostLook}\n`
        : "") +
      (opts.sheet ? `PROPS LIST:\n${opts.sheet}\n` : "") +
      // Scoped to rule 6a's someone-else: the list must never make the planner set `other` on a
      // picture of the host at work (a name may share the host's own trade).
      (opts.people?.length
        ? `PEOPLE WHO COME BACK (never the host; when a shot's other person under rule 6a is one of them, other is this name exactly): ${opts.people.map(p => p.name).join(" | ")}\n`
        : "") +
      (opts.viewer
        ? `THE VIEWER ("you" in this script — someone the host's work serves, never the host; rule 6a: in every shot of "you", other is this name exactly): ${opts.viewer.name}\n`
        : "") +
      (prior.length ? `SHOTS JUST BEFORE THIS BATCH: ${prior.join(" | ")}\n` : "") +
      `\n${lines.join("\n")}\n\nJSON:`;
    const r = await invokeClaude({
      systemPrompt: SHOT_LIST_SYSTEM,
      userMessage,
      maxTokens: SHOT_MAX_TOKENS,
      model: SHOT_LIST_MODEL(),
      effort: planningEffort("SHOT_LIST_EFFORT"),
      step: "Shot list",
    });
    const parsed = safeParseJSON<any>(r.text, r.stopReason);
    if (!parsed.success) throw new Error("unparseable shot list");
    const out: ShotPlan[] = [];
    for (const beat of parsed.data?.beats ?? []) {
      const scene = Number(beat?.beat);
      if (!batch.some(s => s.index === scene)) continue;
      const shots: PlannedShot[] = (Array.isArray(beat.shots) ? beat.shots : [])
        .filter((x: any) => typeof x?.from === "string" && typeof x?.show === "string")
        .map((x: any) => ({
          from: x.from,
          show: x.show.trim(),
          // An old "camera" answer is read as "object" and held to the rule like any other.
          motion: x.motion === "object" || x.motion === "camera" ? "object" : "none",
          thing:
            typeof x.thing === "string" ? matchKeyThing(x.thing, keyThings)?.name : undefined,
          stage: buildStageOf(x.stage),
          text: typeof x.text === "string" ? x.text : undefined,
          print: x.print === "blurred" ? "blurred" : undefined,
          list: x.list === true,
          same: x.same === true,
          contact: x.contact === true,
          held: x.held === true,
          other: otherPersonFor(x.other, opts.viewer),
        }));
      out.push({
        scene,
        hostUntil: typeof beat.hostUntil === "string" ? beat.hostUntil : null,
        shots,
      });
    }
    return out;
  };
  const plan = async (batch: StoryboardScene[]): Promise<ShotPlan[]> => {
    try {
      return await ask(batch);
    } catch (e: any) {
      if (batch.length >= 4) {
        const half = Math.ceil(batch.length / 2);
        const [a, b] = await Promise.all([
          plan(batch.slice(0, half)),
          plan(batch.slice(half)),
        ]);
        return [...a, ...b];
      }
      opts.log?.(
        `shot list for beats ${batch[0].index}–${batch[batch.length - 1].index} failed ` +
          `(${e?.message ?? e}) — they keep the storyboard's pictures`
      );
      return [];
    }
  };
  const batches: StoryboardScene[][] = [];
  for (let b = 0; b < eligible.length; b += SHOT_BATCH)
    batches.push(eligible.slice(b, b + SHOT_BATCH));
  const results: ShotPlan[][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const k = next++;
      results[k] = await plan(batches[k]);
    }
  };
  await Promise.all(Array.from({ length: SHOT_CONCURRENCY }, worker));
  return results.flat();
}

/**
 * A LIVING THING OR A NAMED KIND IS WRITTEN AS THAT EXACT KIND (2026-10-18, job 404 scene 4). The
 * look is all a first picture of a key thing is drawn by, and job 404's said "a plump songbird about
 * ten inches long, brown-grey back, bright orange-red breast, white eye ring, dark head" — never
 * which robin. On a channel about the North American bird, the split panel "a robin perched on a
 * holly bush … snow" came back as the European Christmas-card robin (orange face, olive back, thin
 * dark bill), the film's first robin, while every robin after it was the American one. One common
 * name can mean different kinds in different countries, and look-alikes share most of a plain
 * description, so the look names the kind the way the script's own region does and the few features
 * that set it apart. Said as what it HAS, never "not a …": a picture generator draws what it reads,
 * the look-alike included. Its name stays the script's own word — the shot list and the pictures
 * find a key thing by it. And never where it is seen: "seen on grass, bare branches, and holly
 * shrubs" was the rest of that same look.
 */
export const EXACT_KIND_RULE =
  "A LIVING THING (an animal, bird, fish, insect, plant, tree or flower) or anything the script " +
  "names by its KIND (a species, breed, variety or type): its name stays the word the script uses, " +
  "and its look STARTS with that exact kind — its full name as people in the script's own country " +
  "or region say it (one common name can mean different kinds in different countries; the script's " +
  "places, spellings and money say where it is set) — then the 2-3 features a viewer tells it " +
  "apart from its look-alikes by (the colour of its head, beak or tail, a stripe or band, the shape " +
  "of its ears or leaves), each said as what it HAS, never naming the look-alike: a picture " +
  "generator draws whatever it reads. Its look says how it looks, never where it is seen. Example: " +
  "`deer: a white-tailed deer, reddish-brown coat, a broad tail brown on top and bright white " +
  "underneath, a white patch on the throat`. ";

/**
 * What a PERSON (and VIEWER) look says, shared by the props call and the people repair
 * (`repairPeopleLines`) so the two can never ask for different things. Man or woman, an age range
 * and hair are what keep one person the same from picture to picture (`lookGaps` checks them).
 */
export const PERSON_LOOK_RULE =
  "look is 12-30 " +
  "plain words a picture generator can draw from behind or the side: man or woman, an age range, " +
  "build, hair (colour, length, style) and the clothes they wear in every picture, with colours — " +
  "fitting everything the script says about them (age, work, place, time). ";

/**
 * What a line says a tool DOES is never its shape — one wording for the props list and the
 * named-things step (`SPECIALISED_TOOL_RULE`, `NAMED_LOOKS_SYSTEM`). Job 408 scene 23: "A toilet
 * auger … can sometimes hook it out" was planned as a "hooked tip" and drawn as a hook on a handle.
 */
export const TOOL_SHAPE_NOT_VERB =
  "a line that says a tool hooks, grabs, clears or lifts something says what it does, never what " +
  "shape it is";

/**
 * A TOOL MADE FOR ONE JOB IS WRITTEN BY ITS PARTS (2026-10-18, job 408 scenes 23-24). "A toilet
 * auger, the short kind made for toilets, can sometimes hook it out" was drawn as a plain bent steel
 * rod with a screwdriver handle — a hex key, a hook — under an on-screen label naming the tool, and
 * scene 24 copied it lying on the tile. The props list had written "a slim metal rod with a curved
 * tip and plastic handle, short household size": a shape taken from what the line says it does, not
 * from how the tool is built (a crank, a bent tube, a coiled cable, a rubber sleeve), and the look is
 * all a first picture of a key thing is drawn by. Job 413's "a guided knife-sharpening unit, metal
 * clamp guide and angled slots" mixed two kinds of sharpener into one look, and a picture drawn by it
 * pushed a second knife down through the clamped one. So a specialised tool's look names its ONE
 * kind and the parts that make it that tool, as it is really built. The example is neutral. Each part
 * says "what it is joined to", never "where it joins": the look reaches a picture through the place
 * cut (`pictureLook`), which reads "where" as a place unless the clause opens on a part.
 */
export const SPECIALISED_TOOL_RULE =
  "A TOOL OR PIECE OF EQUIPMENT MADE FOR ONE JOB — a hand tool, gauge, jig, gadget or machine a " +
  "picture generator would draw from its name alone as a plain rod, handle or box: its look STARTS " +
  "with its one exact kind (when the tool comes in several kinds, the one the script means, else " +
  "the most common one for that job — never two kinds mixed into one look), then the 2-4 PARTS " +
  "that make it that tool, each with its shape, material and what it is joined to, as the tool " +
  `is really built — ${TOOL_SHAPE_NOT_VERB}. Example: \`pipe wrench: a heavy steel pipe wrench ` +
  "about 35 cm long, a straight red-painted handle, a fixed lower jaw and an adjustable upper jaw, " +
  "both with angled teeth, a knurled round nut between them that sets the opening`. ";

// A PERSON name says WHAT the person is (job 399's script calls its two passengers only "one of
// them", "the other", "she" and "he"): the pictures and the line check label them "a woman
// passenger" / "a male passenger", and `matchRecurringPeople` finds a look by that role and sex —
// a name like "the other" would match no label but its own words.
const PERSON_NAME_RULE =
  "name is 1-5 plain words " +
  "saying WHAT they are — the role or relation the script or its setting gives them, with man or " +
  "woman when two share one (the woman customer, the older neighbour, my sister) — never only a " +
  "pronoun, \"one of them\" or \"the other\"; ";

export const CONTINUITY_SYSTEM =
  "You read a narration script for a faceless YouTube video and write its PROPS LIST: every " +
  "physical thing that is shown more than once — the things being made, the key tools and " +
  "materials, the recurring places — and exactly how each looks, so a picture generator draws " +
  "it the same way in every shot. One line each: `name: look` (material, colour, size, finish, " +
  "where it usually sits) — always tidy: never describe anything as cluttered, messy or crowded. " +
  "The first line is the HOME setting (the workshop, kitchen, sewing room) " +
  "the video returns to. The SECOND line is the MAIN thing — the one physical thing the whole video " +
  "is about (what is made, used, sold or shown most) — written `MAIN name: look`. " +
  "When a listed thing is a PART of something bigger that the pictures will also show — an " +
  "animal's paw, a machine's dial, a garment's collar — its look STARTS with the whole it belongs " +
  "to (what kind it is, its colour, size and markings) and then describes the part, so every " +
  "picture of the whole shows the same one. " +
  // Job 403's MAIN line was "toilet trapway: the toilet's internal porcelain passage behind the
  // bowl": a look no camera can see, so every picture drawn by it cut the fixture open.
  "A part HIDDEN INSIDE something — a channel inside a fixture, the pipes or wires inside a wall, " +
  "the works inside a machine — is never a line of its own, and never the MAIN thing: list the " +
  "whole thing it is inside, with how it looks from the OUTSIDE, because no picture can show the " +
  "inside. " +
  EXACT_KIND_RULE +
  SPECIALISED_TOOL_RULE +
  "6-14 lines. Plain words, no brands, no people in these lines. NOTHING WITH MARKS ON IT: " +
  "never list a chalk tally, a chalkboard, a sign, a price tag, a label, a calendar, a notebook, a " +
  "ledger or anything written or counted on — the pictures carry no writing, so such a prop would " +
  "put writing in every shot that shows it. " +
  "PEOPLE WHO COME BACK: after the props, one more line for each person other than the narrator " +
  "whom the story shows or talks about in two or more different sentences — the same \"she\" or " +
  "\"he\" a story follows, a customer who comes back, a neighbour seen again — written " +
  "`PERSON name: look`, so every picture of them shows the same person. " +
  PERSON_NAME_RULE +
  PERSON_LOOK_RULE +
  "Two people the story " +
  "tells apart get two lines that look clearly different. Never the narrator, the host or \"you\"; " +
  "never a crowd or a group; never a face, an expression or a name the script does not give; never " +
  "someone in only one sentence. No PERSON line when nobody comes back; at most 4. Example: " +
  "`PERSON the neighbour: a tall man in his seventies, thin white hair combed back, a faded green " +
  "zip-up jacket over a grey shirt, dark trousers`. " +
  // Job 410 (2026-10-18): no host title, and a look that never names the job ("a white blouse, navy
  // blazer with gold pin, and striped scarf"), so the call could not see that the host's work serves
  // the "you" who asks, wrote no VIEWER line, and "you" asking politely was drawn as the host in
  // uniform talking to a colleague. THE HOST block now carries the host's own words about themself,
  // and their clothes are read against the work the video is about.
  "WHO \"YOU\" IS: THE HOST block (never a line of the list) says how the host looks and, when " +
  "known, their title and their own words about themself. The host's JOB is the one their title " +
  "or own words name; when neither names one and the video is about a kind of work whose uniform " +
  "or work clothes THE HOST's clothes could be (scrubs in a video about what nurses notice, a " +
  "chef's jacket in one about restaurant kitchens), the host does that work. When the script " +
  "speaks to \"you\" as someone the HOST'S OWN JOB SERVES — a nurse's " +
  "patient, a hairdresser's client, a waiter's diner, a tax adviser's client — add ONE last line " +
  "`VIEWER name: look`, so every picture of \"you\" shows that same ordinary person and never the " +
  "host. Also when the host calls themself one of \"you\" but THE HOST block dresses them for the " +
  "job that serves \"you\": the host in work clothes drawn as \"you\" reads as the worker. name is " +
  "1-4 plain words for the role the script gives \"you\" (the patient, the client, the diner); look " +
  // Job 412: the VIEWER look came back as "an adult of average build, wearing plain pajamas" — no
  // man or woman, age or hair — and the sleeper changed sex and hair from shot to shot.
  "is written like a PERSON look — man or woman, an age range, build, hair (colour, length, style) " +
  "and clothes with colours — in everyday clothes that fit that role — never the host's " +
  "uniform, badge or work clothes — and clearly different from every PERSON line. No VIEWER line " +
  "when \"you\" does the host's own kind of work (a how-to: \"you\" sand, sew, fix, cook or plant " +
  "the way the host does), when there is no host, or when no picture will show \"you\". " +
  "Output ONLY the list, no headings.";

/** Recurring people a props list may name (`PERSON name: look` lines) — beyond these, none. */
export const MAX_RECURRING_PEOPLE = 4;

// "PERSON " or "PERSON:" only — a prop like "person-sized crate: …" stays a prop.
const PERSON_LINE = /^PERSON(?=[\s:])[\s:]*/i;
/** Whether a props-list line is a `PERSON name: look` line (bullets and numbering aside). Pure. */
export function isPersonLine(line: string): boolean {
  return PERSON_LINE.test(line.replace(/^[-*•\d.)\s]+/, "").trim());
}

// "VIEWER " or "VIEWER:" in capitals, or "Viewer:" — a prop like "viewer-facing shelf: …" or "Viewer
// seat: …" stays a prop (a viewer named "seat" would take every picture of "you").
const VIEWER_LINE = /^(?:VIEWER(?=[\s:])|[Vv]iewer(?=\s*:))[\s:]*/;
/** Whether a props-list line is the `VIEWER name: look` line (bullets and numbering aside). Pure. */
export function isViewerLine(line: string): boolean {
  return VIEWER_LINE.test(line.replace(/^[-*•\d.)\s]+/, "").trim());
}

/** Words that only ever name the host, the narrator or "you" — never a prop. */
const HOST_ECHO_WORDS = new Set(
  "host narrator presenter look looks appearance you yourself viewer me myself".split(" ")
);

/**
 * Whether a props line is THE HOST block echoed back as a prop (job 410: "THE HOST: a slender woman
 * in her forties… navy blazer with gold pin, striped scarf" came back as the last line of the list,
 * became the key thing "THE HOST", and nothing caught it), or a line named "you", the viewer, or the
 * host by their WHOLE name. A thing the host owns ("host's desk: …") stays, and so does a thing
 * that shares one word of the host's name — a channel's name is often "<thing> <name>", and its
 * home or main thing is that thing (a backyard, hardwood, a wren). Pure.
 */
export function isHostEchoLine(line: string, hostName?: string): boolean {
  const at = line.indexOf(":");
  if (at <= 0) return false;
  const name = line.slice(0, at).replace(/^[-*•\d.)\s]+/, "").replace(/^MAIN\b[\s:-]*/i, "");
  // "THE HOST (the narrator, on camera)" is the host; a prop named "camera" is a camera.
  const words = personKey(name.replace(/\([^)]*\)/g, " ")).split(" ").filter(Boolean);
  if (!words.length) return false;
  const hostWords = personKey(hostName).split(" ").filter(Boolean);
  const echo = words.filter(w => !HOST_ECHO_WORDS.has(w));
  return (
    echo.length === 0 ||
    (hostWords.length > 0 && hostWords.every(w => echo.includes(w)) && echo.every(w => hostWords.includes(w)))
  );
}

/**
 * A props reply read into its three parts: the props (at most 16, the host block's echo dropped),
 * the `PERSON` lines (at most `MAX_RECURRING_PEOPLE`) and the one `VIEWER` line. A line with
 * nothing after its colon is a heading ("PEOPLE:"), never a prop: kept, it became the home line or
 * a key thing with no look. Pure.
 */
export function splitPropsReply(
  text: string,
  opts: { hostName?: string } = {}
): { props: string[]; people: string[]; viewer: string[] } {
  const lines = text
    .split("\n")
    .map(l => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(l => l.includes(":") && l.slice(l.indexOf(":") + 1).trim() !== "");
  return {
    props: lines.filter(l => !isPersonLine(l) && !isViewerLine(l) && !isHostEchoLine(l, opts.hostName)).slice(0, 16),
    people: lines.filter(isPersonLine).slice(0, MAX_RECURRING_PEOPLE),
    viewer: lines.filter(isViewerLine).slice(0, 1),
  };
}

/**
 * THE HOST block of the props call: how the host looks, their title and their own words about
 * themself (`hostOwnWords`) — what tells the call what the host does, and so whether "you" is the
 * host or someone their job serves. Written with dashes, never as a `name: look` line: job 410's
 * "THE HOST (the narrator, on camera): …" came back as a prop. "" with nothing to say. Pure.
 */
export function hostBlockFor(look?: string, title?: string, ownWords: string[] = []): string {
  const parts = [
    look?.trim() ? `looks — ${look.trim()}` : "",
    title?.trim() ? `title — ${title.trim()}` : "",
    ownWords.length ? `in their own words — ${ownWords.map(s => `"${s}"`).join(" ")}` : "",
  ].filter(Boolean);
  return parts.length ? `THE HOST (the narrator, on camera; never a line of the list) ${parts.join("; ")}\n` : "";
}

/** A people line whose look leaves out something a picture needs (`lookGaps`). */
export interface IncompletePeopleLine {
  line: string;
  kind: "PERSON" | "VIEWER";
  person: RecurringPerson;
  gaps: LookGap[];
}

/**
 * What the people lines of a props reply still owe (2026-10-18, jobs 410 and 412): a person the
 * script follows over two or more sentences with no `PERSON` line (`followedPeople`,
 * `uncoveredPeople` — job 410's she and he, none written), and a `PERSON`/`VIEWER` look with no man
 * or woman, age or hair (`lookGaps` — job 412's "an adult of average build, wearing plain
 * pajamas"). Lines the parsers drop (the host, a group, an animal) owe nothing. Pure.
 */
export function peopleOwed(
  script: string,
  lines: { people: string[]; viewer: string[] },
  opts: { hostName?: string; hostTitle?: string } = {}
): { uncovered: FollowedPerson[]; incomplete: IncompletePeopleLine[] } {
  const people = parseRecurringPeople(lines.people.join("\n"), opts);
  const viewer = parseViewerPerson(lines.viewer.join("\n"), opts);
  const incomplete: IncompletePeopleLine[] = [];
  for (const line of lines.people) {
    const person = parseRecurringPeople(line, opts)[0];
    const gaps = person ? lookGaps(person.look) : [];
    if (person && gaps.length) incomplete.push({ line, kind: "PERSON", person, gaps });
  }
  if (viewer) {
    const gaps = lookGaps(viewer.look);
    if (gaps.length) incomplete.push({ line: lines.viewer[0], kind: "VIEWER", person: viewer, gaps });
  }
  return { uncovered: uncoveredPeople(followedPeople(script, opts), people, viewer), incomplete };
}

/**
 * The people repair (`repairPeopleLines`): ONE small call, made only when `peopleOwed` finds
 * something, that writes the missing `PERSON` lines and rewrites the incomplete looks. A "she" can
 * be a cat or a hen, so who is a person is the model's to say, and NONE is a fine answer.
 */
export const PEOPLE_REPAIR_SYSTEM =
  "You finish the PEOPLE lines of a faceless YouTube video's props list, so every picture of one " +
  "person shows the same person. You are given the host (never a line of yours), the people lines " +
  "already written, any line whose look leaves something out, and numbered sentences of the " +
  "script where the story may follow someone. Write, one per line: (1) `PERSON name: look` for " +
  "each person those sentences follow — the same person talked about in two or more sentences, a " +
  "pronoun, \"one of them\", \"the other\" and a name all counting as them — who has no line yet. " +
  "Never the narrator, the host or \"you\"; never an animal, a thing or a place (a \"she\" or \"he\" " +
  "may be a pet, a bird or a boat: then no line); never a crowd or a group; never people met once " +
  "each (any customer, a doctor in general). " +
  PERSON_NAME_RULE +
  "(2) each line to rewrite, with the SAME kind (PERSON or VIEWER) and the SAME name, its look " +
  "written again whole: keep everything it says and add what it leaves out. " +
  PERSON_LOOK_RULE +
  "A VIEWER is \"you\", someone the host's work serves, in everyday clothes — never the host's " +
  "uniform, badge or work clothes. Two people the story tells apart look clearly different, and " +
  "every line you write looks clearly different from the lines already written and from the host. " +
  "Never a face, an expression or a name the script does not give. Output ONLY those lines, no " +
  "headings; NONE when there is nothing to write.";

/** The most script sentences the people repair is shown — the followed ones and their neighbours. */
const REPAIR_MAX_SENTENCES = 40;

/**
 * The people repair's question: the host, the lines already written, the lines to rewrite with
 * what each leaves out, the script's opening (its place and time) and the sentences that follow
 * someone, each with its neighbours. Pure.
 */
export function peopleRepairMessage(
  script: string,
  lines: { people: string[]; viewer: string[] },
  owed: { uncovered: FollowedPerson[]; incomplete: IncompletePeopleLine[] },
  opts: { subject?: string; hostBlock?: string } = {}
): string {
  const sentences = scriptSentences(script);
  const wanted = new Set<number>();
  for (const f of owed.uncovered)
    for (const i of f.sentences) for (const k of [i - 1, i, i + 1]) if (k >= 0 && k < sentences.length) wanted.add(k);
  const shown = Array.from(wanted)
    .sort((a, b) => a - b)
    .slice(0, REPAIR_MAX_SENTENCES);
  const rewrite = new Set(owed.incomplete.map(x => x.line));
  const written = [...lines.people, ...lines.viewer].filter(l => !rewrite.has(l));
  return (
    (opts.subject ? `Video subject: ${opts.subject}\n` : "") +
    (opts.hostBlock ?? "") +
    `\nPEOPLE LINES ALREADY WRITTEN:\n${written.length ? written.join("\n") : "none"}\n` +
    (owed.incomplete.length
      ? `\nLINES TO REWRITE WHOLE:\n${owed.incomplete.map(x => `${x.line}  (leaves out: ${x.gaps.join(", ")})`).join("\n")}\n`
      : "") +
    `\nTHE SCRIPT'S OPENING:\n${sentences.slice(0, 6).join(" ")}\n` +
    (shown.length
      ? `\nSENTENCES WHERE THE STORY MAY FOLLOW SOMEONE (numbered, with their neighbours):\n${shown.map(i => `#${i + 1} ${sentences[i]}`).join("\n")}\n`
      : "") +
    `\nPEOPLE LINES:`
  );
}

/**
 * The people lines after the repair's answer: an incomplete line takes the rewrite of the same
 * person (same name, or the one VIEWER line for the viewer) only when it leaves out less, keeping
 * its own kind and name, which every shot already uses; a new `PERSON` is added when it is nobody
 * already written (by name, or by the same role or relation — "my mom" is "my mother" — unless the
 * two looks are a man and a woman) and says at least two of man or woman, age and hair, up to
 * `MAX_RECURRING_PEOPLE`. Given `uncovered` (what `peopleOwed` found missing), a new line must
 * cover one of those people: the repair is asked for them, not for anyone it can think of. A
 * `VIEWER` line is never added here — whether "you" is someone the host serves is the props call's
 * to say. Pure.
 */
export function mergeRepairedPeople(
  lines: { people: string[]; viewer: string[] },
  incomplete: IncompletePeopleLine[],
  reply: string,
  opts: { hostName?: string; uncovered?: FollowedPerson[] } = {}
): { people: string[]; viewer: string[]; added: string[]; rewritten: string[] } {
  const replyLines = reply.split("\n").map(l => l.replace(/^[-*•\d.)\s]+/, "").trim());
  const newPeople = parseRecurringPeople(replyLines.filter(isPersonLine).join("\n"), opts);
  const newViewers = replyLines.filter(isViewerLine);
  const newViewer = parseViewerPerson(newViewers.join("\n"), opts);
  const people = [...lines.people];
  const viewer = [...lines.viewer];
  const added: string[] = [];
  const rewritten: string[] = [];
  const used = new Set<RecurringPerson>();
  for (const x of incomplete) {
    const key = personKey(x.person.name);
    const candidates = [...newPeople, ...(newViewer ? [newViewer] : [])];
    const same =
      candidates.find(c => personKey(c.name) === key) ??
      (x.kind === "VIEWER" && newViewers.length === 1 ? newViewer : undefined);
    if (!same || used.has(same) || lookGaps(same.look).length >= x.gaps.length) continue;
    used.add(same);
    const line = `${x.kind} ${x.person.name}: ${same.look}`;
    if (x.kind === "VIEWER") viewer[0] = line;
    else people[people.indexOf(x.line)] = line;
    rewritten.push(x.person.name);
  }
  const have = parseRecurringPeople(people.join("\n"), opts);
  const viewerNow = parseViewerPerson(viewer.join("\n"), opts);
  // A person's sex as their name gives it, else their look; their roles in one spelling each.
  const sexOf = (r: RecurringPerson) => namedPeople(r.name)?.sex ?? sexOfLook(r.look);
  const rolesOf = (r: RecurringPerson) =>
    (namedPeople(r.name)?.people ?? []).filter(x => x.kind === "role").map(x => sameRole(x.noun));
  let owedNow = opts.uncovered;
  for (const p of newPeople) {
    if (used.has(p) || people.length >= MAX_RECURRING_PEOPLE || lookGaps(p.look).length > 1) continue;
    const key = personKey(p.name);
    if (have.some(h => personKey(h.name) === key) || (viewerNow && personKey(viewerNow.name) === key)) continue;
    // Someone already written, renamed, is never a second person: matched the way a picture's
    // label is, or the same role or relation in another word ("my mom" for "my mother"). But a
    // look that says the other sex is someone else — "the passenger in row fourteen", a man, is
    // not "the passenger in the empty row", a woman, though a sexless name matches by role alone.
    const sex = sexOf(p);
    const fits = (h: RecurringPerson) => {
      const s = sexOf(h);
      return !s || !sex || s === sex;
    };
    if (matchRecurringPeople(p.name, 1, have).some(fits)) continue;
    const roles = rolesOf(p);
    if (roles.length && have.some(h => fits(h) && rolesOf(h).some(r => roles.includes(r)))) continue;
    // Only the people the check found missing — not a padded cast. A role is owed once; a "he" or
    // "she" run is one person each, so a second run of "he" may still take a second man (job 400:
    // the man in the card aisle, then the essay's author fourteen sentences on).
    if (owedNow) {
      const covers = owedNow.filter(f => !uncoveredPeople([f], [p]).length);
      if (!covers.length) continue;
      const pronoun = covers.find(f => f.cue === "she" || f.cue === "he");
      owedNow = owedNow.filter(f => !covers.includes(f) || ((f.cue === "she" || f.cue === "he") && f !== pronoun));
    }
    people.push(`PERSON ${p.name}: ${p.look}`);
    have.push(p);
    added.push(p.name);
  }
  return { people, viewer, added, rewritten };
}

/**
 * Asks once for the people lines the props reply still owes (`peopleOwed`) and merges the answer
 * (`mergeRepairedPeople`). Never throws: a failed call keeps the lines as they were.
 */
async function repairPeopleLines(
  script: string,
  lines: { people: string[]; viewer: string[] },
  owed: { uncovered: FollowedPerson[]; incomplete: IncompletePeopleLine[] },
  opts: { subject?: string; hostBlock?: string; hostName?: string; onNote?: (m: string) => void }
): Promise<{ people: string[]; viewer: string[] }> {
  try {
    const r = await invokeClaude({
      systemPrompt: PEOPLE_REPAIR_SYSTEM,
      userMessage: peopleRepairMessage(script, lines, owed, opts),
      maxTokens: 6000,
      model: SHOT_LIST_MODEL(),
      effort: planningEffort("PROPS_EFFORT"),
      step: "Props list (people)",
    });
    const merged = mergeRepairedPeople(lines, owed.incomplete, r.text, { ...opts, uncovered: owed.uncovered });
    opts.onNote?.(
      `people lines asked for again (${[
        owed.uncovered.length ? `followed with no line: ${owed.uncovered.map(f => f.cue).join(", ")}` : "",
        owed.incomplete.length ? `incomplete look: ${owed.incomplete.map(x => x.person.name).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ")}) — ` +
        (merged.added.length || merged.rewritten.length
          ? [
              merged.added.length ? `added ${merged.added.join(", ")}` : "",
              merged.rewritten.length ? `rewrote ${merged.rewritten.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("; ")
          : "nothing changed")
    );
    return { people: merged.people, viewer: merged.viewer };
  } catch (err: any) {
    opts.onNote?.(`people lines repair failed (${err?.message ?? err}) — kept as written`);
    return lines;
  }
}

/**
 * The props list for one script (`LongformInputParams.continuitySheet`), with its `PERSON` lines
 * (the people who come back, `parseRecurringPeople`) and its one `VIEWER` line (who "you" is when
 * the host's job serves them, `parseViewerPerson`) at the end. "" on any failure. `host` is how the
 * host looks, `hostTitle` their title, and the host's own words about themself are read off the
 * script (`hostOwnWords`) — what tells the call whether "you" is the host or their customer. Then,
 * only when the reply owes a person the script follows or a look that cannot keep one person
 * (`peopleOwed`), ONE more small call asks for just those lines (`repairPeopleLines`).
 */
export async function deriveContinuitySheet(
  script: string,
  opts: {
    subject?: string;
    styleBible?: string;
    host?: string;
    hostTitle?: string;
    hostName?: string;
    onNote?: (m: string) => void;
  } = {}
): Promise<string> {
  const hasHost = opts.host != null || opts.hostTitle != null || opts.hostName != null;
  const hostBlock = hasHost
    ? hostBlockFor(opts.host, opts.hostTitle, hostOwnWords(script, { hostName: opts.hostName }))
    : "";
  // Room for the model's own thinking ahead of the list: at 1200 the thinking could spend the whole
  // budget and the call came back with no text (Hannah's real render, job 163) — and one retry.
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reply: ReturnType<typeof splitPropsReply>;
    try {
      const r = await invokeClaude({
        systemPrompt: CONTINUITY_SYSTEM,
        userMessage:
          (opts.subject ? `Video subject: ${opts.subject}\n` : "") +
          (opts.styleBible ? `Visual direction: ${opts.styleBible}\n` : "") +
          hostBlock +
          `\nScript:\n${script.slice(0, 60000)}\n\nPROPS LIST:`,
        maxTokens: 16000,
        model: SHOT_LIST_MODEL(),
        effort: planningEffort("PROPS_EFFORT"),
        step: "Props list",
      });
      // The PERSON lines go last and are capped on their own, so they never push a prop out or take
      // the home line's place.
      reply = splitPropsReply(r.text, opts);
    } catch {
      continue; // try once more
    }
    if (!reply.props.length) continue;
    let { people, viewer } = reply;
    const owed = peopleOwed(script, { people, viewer }, opts);
    if (owed.uncovered.length || owed.incomplete.length)
      ({ people, viewer } = await repairPeopleLines(script, { people, viewer }, owed, { ...opts, hostBlock }));
    return [...reply.props, ...people, ...viewer].join("\n");
  }
  return "";
}

/**
 * The KEY THINGS of a props list (`deriveContinuitySheet`): every line after the first (the home
 * setting), `name: look`, the one written `MAIN name: look` being what the whole video is about.
 * An older list with no MAIN line has no main thing. Pure — unit-tested.
 */
export function parseKeyThings(sheet: string | undefined): KeyThing[] {
  const out: KeyThing[] = [];
  const lines = withoutPersonLines(sheet).split("\n").map(l => l.trim()).filter(l => l.includes(":"));
  for (const line of lines.slice(1)) {
    const at = line.indexOf(":");
    let name = line.slice(0, at).trim();
    const look = line.slice(at + 1).trim();
    const main = /^MAIN\b/i.test(name);
    name = name.replace(/^MAIN\b[\s:-]*/i, "").trim();
    if (!name || out.some(t => keyName(t.name) === keyName(name))) continue;
    // The host is never a key thing (job 410's list ended "THE HOST: a slender woman in her forties…").
    if (isHostEchoLine(line)) continue;
    out.push({ name, look, ...(main && !out.some(t => t.main) ? { main: true as const } : {}) });
  }
  return out;
}

/**
 * A props list with its `PERSON` and `VIEWER` lines taken out — the list every shot and picture
 * writer reads, things only. Pure.
 */
export function withoutPersonLines(sheet: string | undefined): string {
  return (sheet ?? "")
    .split("\n")
    .filter(l => !isPersonLine(l) && !isViewerLine(l))
    .join("\n")
    .trim();
}

/** Words that say nothing about WHICH thing a prop is ("MAIN", sizes, amounts, joiners). */
const NOT_A_PROP_NAME_WORD = new Set([
  "main", "the", "and", "with", "for", "small", "large", "big", "little", "tiny", "old", "new",
  "one", "two", "three", "few", "some",
]);

/**
 * A props list without the things only a marked CTA names (job 409: the closing CTA's "lift your
 * phone" made "phone: a black smartphone … resting face-up on the desk" a key thing, and it filled a
 * split panel and two study shots whose lines never speak of a phone). The props call reads the
 * content alone (`splitCtaFromContent`), so this guards what reaches it another way — a style bible
 * written before the call, kept on a resume — and costs nothing. A prop line (never the first, the
 * home setting; never a PERSON or VIEWER line) is dropped only when EVERY word of its name is said
 * in a CTA block and none is said anywhere in the content, in any form: "phone" said only in the
 * CTA goes, while a phone the content talks about — as "phone", "phones" or "smartphone" — stays.
 * Built to keep when unsure, because a CTA's own words are ordinary ones: over the stored films a
 * looser rule dropped job 413's "gas can" for the CTA's "you can already see" and job 368's chicken
 * "run" for "it runs eight chapters", while their content says "gasoline" and "come running". As
 * written, over the 225 stored films with a marked CTA it takes something from 12, every one the
 * CTA's own (a phone, a phone screen, a camera phone, the CTA's digital book), and nothing else. With no CTA words the list comes back as it was. Pure — unit-tested.
 */
export function withoutCtaOnlyProps(
  sheet: string,
  content: string,
  cta: string
): { sheet: string; dropped: string[] } {
  if (!cta.trim()) return { sheet, dropped: [] };
  const base = (w: string) => w.replace(/(?:es|s)$/, "");
  const wordsOf = (t: string) => t.toLowerCase().match(/[a-z]+/g) ?? [];
  const ctaWords = new Set(wordsOf(cta).map(base));
  const contentWords = wordsOf(content);
  const contentBases = new Set(contentWords.map(base));
  // In the content in any form: the word itself, a longer form of it ("running" for "run"), or
  // inside a longer word ("phone" in "smartphone").
  const saidInContent = (w: string) =>
    contentBases.has(w) ||
    contentWords.some(c => c.startsWith(w) || (w.length >= 4 && c.includes(w)));
  const dropped: string[] = [];
  let props = 0;
  const kept = sheet.split("\n").filter(line => {
    if (isPersonLine(line) || isViewerLine(line) || !line.includes(":")) return true;
    if (props++ === 0) return true;
    const name = line.slice(0, line.indexOf(":")).replace(/^[-*•\d.)\s]+/, "").replace(/^MAIN\b[\s:-]*/i, "");
    const words = wordsOf(name).filter(w => w.length >= 3 && !NOT_A_PROP_NAME_WORD.has(w)).map(base);
    if (!words.length || !words.every(w => ctaWords.has(w)) || words.some(saidInContent)) return true;
    dropped.push(name.trim());
    return false;
  });
  return { sheet: kept.join("\n"), dropped };
}

/**
 * WHO "YOU" IS, when the props list says the viewer is someone the host's own job serves (its one
 * `VIEWER name: look` line, 2026-10-18, the review of job 402): every picture of "you" was the host,
 * so a passenger's "you can have the whole thing just by asking" (scene 17) and "they'll tell you,
 * and you're no worse off for trying" (scene 20) were the host in her crew blazer, scarf and wings
 * pin in a passenger's seat — the crew playing the passenger who asks. The name is the role the
 * script gives "you" (an owner or a homeowner too, which a picture otherwise reads as the host);
 * the look is the one every picture of them keeps. Undefined — "you" stays the host — with no such
 * line, a name that is the host, "you" or "the viewer", a group, an animal, or a look too short to
 * draw. Pure — unit-tested.
 */
export function parseViewerPerson(
  sheet: string | undefined,
  opts: { hostName?: string } = {}
): RecurringPerson | undefined {
  const hostWords = personKey(opts.hostName).split(" ").filter(w => w.length >= 3);
  const raw = (sheet ?? "").split("\n").find(isViewerLine);
  if (!raw) return undefined;
  const rest = raw.replace(/^[-*•\d.)\s]+/, "").trim().replace(VIEWER_LINE, "");
  const at = rest.indexOf(":");
  if (at <= 0) return undefined;
  const name = otherPersonOf(rest.slice(0, at).replace(/[*_`]/g, ""));
  const words = rest.slice(at + 1).replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "").split(" ");
  if (!name || words.length < 3) return undefined;
  if ((namedPeople(name)?.count ?? 1) > 1) return undefined;
  const key = personKey(name);
  if (!key || (hostWords.length && key.split(" ").every(w => hostWords.includes(w)))) return undefined;
  return { name, look: words.slice(0, 45).join(" ").replace(/[.;,]+$/, "") };
}

/**
 * The PEOPLE WHO COME BACK in a props list (`deriveContinuitySheet`'s `PERSON name: look` lines):
 * someone other than the host whom the story follows over several sentences, with the one look
 * every picture of them keeps (job 399: the woman passenger the story follows was three different
 * women in scenes 2, 4 and 5, drawn each time from "a woman passenger" alone). Read only from those
 * lines, so a props list written before has none. Dropped: the host (by role or by `hostName`), the
 * viewer, an animal, a group ("the passengers" — no one look fits a crowd), a name too long to be
 * one, a look too short to draw, and a second line for the same name. At most
 * `MAX_RECURRING_PEOPLE`. Pure — unit-tested.
 */
export function parseRecurringPeople(
  sheet: string | undefined,
  opts: { hostName?: string } = {}
): RecurringPerson[] {
  const out: RecurringPerson[] = [];
  const hostWords = personKey(opts.hostName).split(" ").filter(w => w.length >= 3);
  for (const raw of (sheet ?? "").split("\n")) {
    if (!isPersonLine(raw)) continue;
    const rest = raw.replace(/^[-*•\d.)\s]+/, "").trim().replace(PERSON_LINE, "");
    const at = rest.indexOf(":");
    if (at <= 0) continue;
    const name = otherPersonOf(rest.slice(0, at).replace(/[*_`]/g, ""));
    const words = rest.slice(at + 1).replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "").split(" ");
    if (!name || words.length < 3) continue;
    const look = words.slice(0, 45).join(" ").replace(/[.;,]+$/, "");
    const named = namedPeople(name);
    if (named && (named.count > 1 || named.self)) continue;
    const key = personKey(name);
    if (hostWords.length && key.split(" ").every(w => hostWords.includes(w))) continue;
    if (out.some(p => personKey(p.name) === key)) continue;
    out.push({ name, look });
    if (out.length >= MAX_RECURRING_PEOPLE) break;
  }
  return out;
}

const keyName = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The key thing a planner's `thing` names: the same name (case and punctuation aside), else the one
 * whose name contains it or is contained in it — the longest such. Null when none. Pure.
 */
export function matchKeyThing(name: string, things: KeyThing[]): KeyThing | null {
  const n = keyName(name.replace(/^MAIN\b/i, ""));
  if (!n) return null;
  const exact = things.find(t => keyName(t.name) === n);
  if (exact) return exact;
  const near = things
    .filter(t => {
      const k = keyName(t.name);
      return k.length >= 3 && (n.includes(k) || k.includes(n));
    })
    .sort((a, b) => b.name.length - a.name.length);
  return near[0] ?? null;
}

/**
 * The key thing a picture description names: every meaningful word of a key thing's name appears
 * in `text` — the longest such name wins. Null when none. For the pictures the shot list did not
 * tag (a split screen's panel, the QR background, a storyboard picture). Pure.
 */
export function keyThingIn(text: string | undefined, things: KeyThing[] | undefined): KeyThing | null {
  return keyThingsIn(text, things)[0] ?? null;
}

/**
 * Every key thing a picture description names, the longest names first; a name whose words all sit
 * inside a longer match ("alarm" inside "smoke alarm") is dropped. Pure.
 */
export function keyThingsIn(text: string | undefined, things: KeyThing[] | undefined): KeyThing[] {
  const have = new Set(keyName(text ?? "").split(" "));
  const hits = (things ?? [])
    .filter(t => {
      const ws = keyName(t.name).split(" ").filter(w => w.length > 2);
      return ws.length > 0 && ws.every(w => have.has(w) || have.has(`${w}s`));
    })
    .sort((a, b) => b.name.length - a.name.length);
  const words = (t: KeyThing) => keyName(t.name).split(" ");
  return hits.filter(
    (t, k) => !hits.slice(0, k).some(longer => words(t).every(w => words(longer).includes(w)))
  );
}

// ─── Does each picture show what its line is about? ─────────────────────────────────────

// A FIGURE OF SPEECH, ANOTHER TIME OR PLACE and the "he"/"she" sentence of WHO IS IN THE PICTURE are
// job 409's (round 13): "Then he turns the whole thing over in a single motion: life is not short" —
// a writer of ancient times reversing his argument — passed the check as the host turning a page, and
// the list said inside that passage passed as today's farmer, old man and young man. `fitPictureNotes`
// marks the pictures the code can tell are such. ANOTHER TIME OR PLACE is a stretch AWAY from the
// video's own here and now: read without that, a video whose whole subject is how things are done in
// another country (a host showing a household of their own country) would have every picture that
// does not name the country called WRONG and rewritten.
export const FIT_SYSTEM = `You check a video's pictures against what is said under them. Between the host's
on-camera lines the viewer sees one picture at a time. You get every line in film order: HOST lines
for context, and PICTURE lines with what the picture shows.

A picture is WRONG when its main subject is not what its line talks about: the line is about the
weather and the picture is the video's main thing; the line names a new place and the picture is
the workbench. It is also WRONG when the line is about a key thing it only refers to ("the one that
sold best came out of that old crate") and the picture shows something else the line names instead
— the picture is then the key thing, with the other thing beside it. And it is WRONG when the picture
shows only a PLACE or SURFACE the line names while the line is about something there: "will anyone
pay for these at a craft fair?" over an empty table — the picture is the pieces laid out on it. When
the line refers to the work by a quality ("that clean look", "this style"), the picture is the work
that has it. But a picture of something NEW the line names — a line comparing the thing to something
else you can see ("the kind you'd find in an old farmhouse kitchen" = that kitchen) — is RIGHT: never
change it back to the key thing. And it is WRONG when the picture repeats what the picture before
already shows while its line names something new you can see: after a picture of a spatula, "It
also works on a cast-iron pan" is the cast-iron pan, not the spatula again. Something new you can see
is not only an object: a kind of event or situation the line describes counts too — "it only
struggles with the storms that roll in at night" after a picture of a roof is that night storm. If a
picture would look like the one right before it and its line says anything new you can see, it is
WRONG.
A picture of the right thing is still WRONG when it leaves out what the line makes its point with:
WHO is doing WHAT ("my sister watched the whole thing from her porch" over an empty porch — the
picture is the sister watching from the porch), the STATE the line describes (a gate left hanging
open, a jar with its lid off, a shirt soaked through, a tent half put up, a coat zipped to the
chin), or a COUNT the line makes the point of ("one bowl for every guest, plus a spare" over a
single bowl). Rewrite it with the same thing, and that in it. Never for: a comparison that only says what
something costs or is like (show the subject); a bare number, price or length of time (show the
thing it is about); someone the line only sells to, tells, helps or mentions, who does nothing in
it (show the thing); a warning about a danger (show the safe way, never the danger); something the
line says does NOT happen or is NOT there (never draw it happening).
THE LINE'S LAST WORD. A line that closes on a short sentence revealing the thing it was building to —
the cause, the catch, the answer ("The printer is fine. There is a paper clip in the tray.") — makes
its point with that thing: a picture without it is WRONG, however right the rest is. Rewrite it with
that thing in it, where the line puts it. A picture marked ends on "…" closes on such a sentence.
A STATE A PHOTO CANNOT SHOW. A still picture shows no speed and no change over time. When the line's
point is how fast or slow something happens, or that it keeps getting worse (a queue that barely
moves, dough that rose fast, a tyre slowly losing air), a picture that only names that speed is
drawn as the ordinary everyday version and says nothing: it is WRONG. Write what the state leaves
for the eye — a long line of people standing still, the dough domed high over the rim of its bowl,
the tyre sagging flat at the bottom — with the cause the line names in view.
It is WRONG when it does not show what the line points at. SHOW EXACTLY WHAT THE LINE POINTS AT: when a line points at a specific thing, or a specific part, side or detail of a thing (the box it comes in, its label, the battery door on the back, the dial, the date on the bottom, the hem), the picture is a close-up of exactly that — never the video's main thing somewhere else, never a plain version without it. What the script says that part shows (the words printed on it, a number, a setting) is shown exactly as the script says it.
It is WRONG when a body part looks cut off. A BODY PART NEVER LOOKS CUT OFF: hair, a hand, a foot or a face is shown on the person, or on what really holds it — a wig on a mannequin head or wig stand, a practice hand, extensions in their packet. A few loose strands that really fall (in a brush, on a comb or towel, in a drain) are fine. Never hair still shaped like a head or a hairstyle with no head inside it, and never a hand, foot or face on its own. To show a colour or texture, show it on the person's own head or hands.
It is WRONG when it shows a solid thing cut open, as a cutaway or see-through view, or from inside it — even as the close-up a line points at. ${NOTHING_CUT_OPEN_RULE}
A picture marked "FIRST of the MAIN thing" must show the main thing IN USE when it is naturally used
with smoke, steam, a flame or water (lit, steaming, burning, running) — otherwise it is WRONG. A picture is RIGHT when it shows the thing the line is
about — even when the line only says "it", "this one" or "the one that…" (use the KEY THINGS and the
lines around it to know what that is) — or shows the thing being done, or (marked "continues") keeps
showing the topic of the line before it ONLY when its line names nothing new you can see. A
"continues" picture whose line brings up a new thing, or a new kind of event or situation ("the one
kind of fire that likes to start while the house is asleep"), is WRONG: it gets its own picture of
that new thing.

A LINE WITH NOTHING TO SEE. When a line carries an idea rather than a thing — an argument, a turn
in the reasoning, a claim, a lesson, a feeling, a promise of what the video will show — its picture
is an everyday moment that carries what the line means: a person or a place the script already has,
doing something that fits the thought, or the host at work. It is WRONG when it shows the video's
MAIN thing only because nothing else fits: the main thing is right only when the line names it or
clearly points back at it ("it", "this one", "the winner" after lines about it). "The whole thing",
"all of it" or "that", summing up what was just said, point at the idea, never at a thing. Two lines
with nothing to see never share a picture: when one shows again what an earlier such line's own
picture showed (the same thing in the same place), the later one is WRONG — give it its own moment.
A picture marked "continues" keeps the moment of the line right before it going and is not a repeat.
A line that speaks of a thing by its quality, price, count or time is not one of these: it shows the
thing.
A THING BEFORE ITS WORDS. A picture that shows a thing its own line does not name or point at, which
a LATER line names, shows it too early: by the time it is said, the picture is gone. It is WRONG —
give it what its own line is about (A LINE WITH NOTHING TO SEE), and the thing is shown on the line
that names it. Not when that later line's picture is marked "continues": the same picture plays on
under it.
A SOUND. A line about a sound — a song, a call, a noise, a hum, a sound that has stopped — is about
what makes it: the picture shows that source in the moment the line describes, where it is, quiet
when the line says it has gone quiet. It is WRONG when it shows only a window, a door or a room the
sound is heard through, or an empty place the line does not say is empty — even when the line names
that window or room.
A FIGURE OF SPEECH is about what it means, never its literal words: "he turns the argument on its
head" is about him reversing his argument — nobody upside down, no page or object turned over; "she
closed the book on it", said of a part of her life, is no book. A picture that draws a figure of
speech literally is WRONG: give it the moment that carries what the line means (A LINE WITH NOTHING
TO SEE). A how-to that really turns, opens or lifts a thing ("turn the board over and sand the other
side") is literal, and so is its picture.
ANOTHER TIME OR PLACE. A stretch of lines may be set in another time or a faraway place, away from the
video's own here and now — history, a story of long ago, what a writer of another age wrote or saw, how
things are done in another country. A video whose own world is that time or place has no such stretch.
Every picture inside that stretch shows that time and place: its people dressed for it, its tools,
buildings and land of it — a spoken list's pictures and a picture of a bare word ("the baker", "the
young") too. A picture there whose words give no sign of that time or place, so it would be drawn as
today, is WRONG: rewrite it naming the time and place, its people dressed for it ("the baker" in a
passage about a medieval town = a medieval baker in a linen tunic at a brick oven, never a baker of
today). A picture marked "inside a passage set in …" is in such a stretch. The stretch ends where the
words come back to today or to the host's own life; a line inside it about today is today.

WHAT NOT TO DO. A sentence RULES SOMETHING OUT when it says not to do something ("never…", "don't…"),
says what something is NOT ("I don't mean…", "no, not the…"), what to use INSTEAD ("…instead of the
plastic one"), what to keep away or out ("well away from the stove", "keep any flame out of the
room"), that a job is for someone else ("that part is a job for a licensed electrician"), or that
doing something goes wrong ("…is exactly how people get hurt", "…only sets things back"). Read the
whole sentence: those words may sit in a neighbouring line of it, and every picture of that sentence
follows them. Such a picture shows the same task done the RIGHT way, the alternative, or the subject
on its own and idle. It is WRONG when it shows OR NAMES the ruled-out act, the denied thing or the
forbidden placement — even with "without", "no", "not", "away from" or "across the room from",
because the picture generator draws everything it is told about. Rewrite it naming only what IS in
the frame ("keep the paint tins away from the stove" = the paint tins on a shelf in a cool cupboard;
the stove is not named). A thing named only to be ruled out is never "something new you can see".
For EVERY picture whose sentence rules something out, right or wrong, set forbids to what must NOT be
seen in it, in 3-12 plain words: the act being done ("hands lifting the full pot off the stove"),
the thing in the place it must be kept from ("the paint tins beside the stove"), or the thing itself
only when the line says that thing is not meant or is used instead of ("a plastic bucket"). A thing
the line only keeps away from something, or says you will not need, may still be shown on its own:
forbids then names it WITH that place or act, never the thing alone. Leave forbids out when nothing
you could see is ruled out: a figure of speech ("just don't count on it to pay the rent", "you'll
never look at it the same way"), a step that says what to skip or when to stop ("skip one stitch and
make a loop", "stop the moment it feels snug"), and a count ("two coats instead of three" is the
COUNT: two coats).

Go through EVERY picture, one at a time, never skipping: first write what its line is about — its
subject, not its last noun; for a line that only refers to a key thing, name the key thing; for a
sound, what makes it; for an idea, the idea; for a figure of speech, what it MEANS, never its literal
verb — then whether the picture shows that, where the line puts it. Only then decide.

"The one that…", "the winner", "the one I was proudest of" is one of the THINGS the video counts or
compares (a project, a product, a choice) — work out which from the whole script, usually named in
a later line. What it "came out of", was "made from" or "started as" is its material, never its
subject: "the one that sold best came out of a box of scraps" is about that winning thing, shown with
the box of scraps beside it.

A line that compares to something ELSE you can see — "the kind you see in …", "like the ones at …",
"the kind you'd find in …" — ALWAYS gets that other thing as its own picture: SPLIT the line there.
Give the exact first 2-5 words where the new picture starts, copied from the line, and what it shows.
Split only when both parts are at least 4 words. Never split a picture marked "joined" inside a
sentence. A comparison the sentence rules out ("no, I don't mean the kind you see in the movies")
is never split off or drawn.

ONE PICTURE, ONE SUBJECT. A picture whose line holds TWO OR MORE SENTENCES, where a later sentence
is about a different thing you can see — another object, place, person or moment ("The town square
has an old stone fountain. On Saturdays the farmers park their trucks along the edge to sell." = the
fountain, then the farmers' trucks) — gets a new picture where that sentence starts: SPLIT there,
from = the exact first 2-5 words of that sentence. Then about, shows_it and show answer for the words
BEFORE the split only, and the split's show for the sentence it starts: when the picture fits only
the later sentence, write show for the earlier words and give the split the picture as it already is. Split only when each part
runs at least 3 seconds (its share of the picture's seconds) and is at least 4 words — except the words
BEFORE the split when they only FINISH a sentence the picture before started (the line opens in the
middle of a sentence, as right after a list): those may be short, and they go back to that picture,
so split there all the same. Never split
sentences that stay on the same thing — more said about it, the same thing from another side, an
idea about it. A picture marked "joined" may be split this way, where a sentence starts.

ONE IDEA, ONE PICTURE. A picture marked "same sentence" continues a sentence the picture before it
started. When the two parts are ONE idea about one thing — the thing and where, how or what it is
used, sold or kept ("Sell your furniture | on Facebook Marketplace", "I hang them in the hallway, |
next to the mirror") — set join: true and write show: the ONE picture for the whole sentence. Keep
them apart only when the second part moves on to a genuinely different thing worth its own picture.

A picture marked "joined", or one you join, shows the WHOLE line in ONE picture (unless a later
sentence of it moves on to a different thing, split as above) — what the line is
really pointing at: the new thing it names when that is its point (a comparison: "it's the same wood
they make baseball bats from" = the baseball bats), the main thing when the line is about it (never
for a line with nothing to see), or the things together when they belong together (the bookcase as a
listing on a phone's buy-and-sell app).
For a "joined" picture shows_it is false unless it already shows that.

For each WRONG picture write the picture that fits: plain words, what is literally in the frame, one
moment, one place, like a snapshot caption. When the line is about a key thing, name it exactly as
the KEY THINGS list writes it and set thing to that name. When the picture shows something the video
MAKES (or shows being made), or what it is made from, set stage to how far along it is in that
picture: "material" (the raw stock or pieces before any work), "making" (being made, partly built)
or "done" (finished — oil, wax, polish or a felt pad count as done); a line about a step shows the
piece only as far along as that step, never already finished. stage is null otherwise. When
something in that moment moves by itself with no person moving it (a flame, smoke, steam, water),
say it is happening. When the
picture is the MAIN thing and it is something naturally in use with smoke, steam, a flame or water,
show it in use — lit, steaming, burning, running — because that is the moment worth a video. The
FIRST picture of the MAIN thing that
shows it idle when it is naturally in use that way is WRONG too: rewrite it in use. No writing, no logos,
no faces, never "or".
When the picture you write shows SOMEONE ELSE doing something — a customer, a buyer, a neighbour, a
relative; never the host, never "you" unless THE VIEWER is given (then "you" is that person, and
other is the viewer's name) — write them into show, seen from behind or from the side, and
set other to who they are in 2-6 plain words from the line ("an older neighbour"). One person only.
other is null otherwise.

WHO IS IN THE PICTURE. For every picture that shows a person (or hands), say who: "host" when it is
the host — their own work, or the viewer the line speaks to ("you") — or a few plain words for
ANYONE ELSE the line is about: a customer at a counter, a child, a stranger in a story, two
neighbours. A line about someone else is never shown as the host or the host's hands. "He" or "she"
in a line is never the host, who speaks of themself as "I": it is a person of the story — a writer,
a figure from history, a neighbour — or an animal the script is about. A picture of the host or the
host's hands doing what that person or animal does is WRONG; rewrite it with them, other set to who
the person is. A picture marked "its he/she is not the host" has such a line. When THE
VIEWER is given, the viewer the line speaks to is never the host: who is the viewer's name for every
picture of "you", the list pictures that go on from a sentence about "you" too. Leave who out of a
picture of things alone.

Answer with JSON only, one entry for EVERY picture:
{"pictures":[{"id":7,"about":"...","shows_it":true,"who":"host"},
{"id":8,"about":"...","shows_it":false,"show":"...","thing":null,"stage":null,"other":null,"split":[{"from":"exact words","show":"...","thing":null,"stage":null,"other":null}]},
{"id":9,"about":"...","shows_it":false,"join":true,"show":"...","thing":null,"stage":null,"other":null,"who":"a customer at a counter"},
{"id":10,"about":"...","shows_it":true,"forbids":"..."}]}
show, thing, stage and other only when shows_it is false or join is true; split only when a new picture must start;
join only on a picture marked "same sentence"; who only on a picture of a person (as it will be drawn);
forbids only when the picture's sentence rules something out.`;

/**
 * A new picture starting inside a line, at `from` (its first words, verbatim). `other`: the person
 * who is not the host it shows (`otherPersonOf`) when the check named one, `null` when it answered
 * that nobody else is in it (the host, the viewer, or no one), unset when it did not answer.
 */
export type PictureSplit = { from: string; show: string; thing?: string; stage?: BuildStage; other?: string | null };
export type PictureFix = {
  id: number;
  show?: string;
  thing?: string;
  /**
   * How far along the thing being made is in the rewrite: a stage, `null` when the check answered
   * that the new picture shows no made thing, unset when it did not answer (`applyPictureFixes`).
   */
  stage?: BuildStage | null;
  /**
   * Who the rewrite shows when it is SOMEONE ELSE than the host (`otherPersonOf`): a person, `null`
   * when the check answered that nobody else is in it, unset when it did not answer.
   */
  other?: string | null;
  split?: PictureSplit[];
  /** This picture and the one before it are ONE idea of one sentence: make them one picture. */
  join?: boolean;
  /**
   * Who the picture's person is, by the line (`WHO IS IN THE PICTURE`): null for the host or the
   * viewer, else the words for someone else (`applyWho`). Absent when the check said nothing.
   */
  who?: string | null;
  /**
   * What the picture's sentence rules out, so the picture must not show it (`scene.forbids`) —
   * answered for a right picture as much as a wrong one, so it can come with no rewrite at all.
   */
  forbids?: string;
};

/**
 * The check's `who`: null for the host or the viewer, someone else's words, or undefined. "host",
 * "you" and "your hands" are the host; "your customer" and "the host's neighbour" name someone else
 * (a viewer's customer is not the viewer). With THE VIEWER (`inputParams.viewerPerson`, a video
 * whose "you" the host's job serves), "you", "your hands" and "the viewer" are that person by name,
 * never the host — job 402 scenes 17 and 20 — and "you and a flight attendant" keeps them beside the
 * other person (the host words of a "host and …" answer are found again in the description; the
 * viewer's are not). Pure.
 */
export function whoOf(raw: unknown, viewer?: RecurringPerson): string | null | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const host = /^\s*(?:the\s+)?(?:host|narrator|presenter)(?:['’]s)?\b|^\s*(?:me|my|i)\b/i.test(raw);
  const you = /^\s*(?:the\s+)?viewer(?:['’]s)?\b|^\s*(?:you|your|yours|yourself)\b/i.test(raw);
  if (!host && !you) return otherPersonOf(raw);
  const others = namedPeople(raw)?.people.filter(p => p.kind !== "self") ?? [];
  if (!others.length) return you && !host && viewer ? viewer.name : null;
  const alongside = you && !host && !!viewer && /^\s*(?:you|yourself|(?:the\s+)?viewer)\s*(?:,|&|\band\b|\bwith\b)/i.test(raw);
  return otherPersonOf(
    [...(alongside ? [viewer!.name] : []), ...others.map(p => p.phrase.replace(/^(?:your|my|our)\s+/i, "the "))].join(" and ")
  );
}

/**
 * WHO IS IN THE PICTURE, by the line (the line check's `who`, 2026-10-18). Only a model reading the
 * line can tell whose hands a plain "hands holding a glowing phone" are: job 369 scene 22 drew a
 * buyer's line as the host's hands, job 399 scene 16 drew "the flight attendant pours your soda" as
 * the host's hands. The host (or the viewer) clears any "someone else"; anyone else is drawn as that
 * person, never the host. A picture of things stays a picture of things. Pure apart from mutating `s`.
 */
export function applyWho(s: StoryboardScene, who: string | null): void {
  if (who === null) {
    s.otherPerson = undefined;
    s.otherPeople = undefined;
    return;
  }
  if (!s.humanPresent && !showsPerson(s.showSubject ?? s.visualPrompt)) return;
  s.otherPerson = who;
  s.otherPeople = otherPeopleOf(who);
  s.humanPresent = true;
}

/**
 * The check's `forbids`, cleaned: a short phrase, or nothing for an empty answer or one that only
 * says "none" — also with a reason after it ("none — a figure of speech", "nothing visible"), which
 * would otherwise be asked of the frame as the thing it must not show. Pure.
 */
export function forbidsOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const text = v.replace(/\s+/g, " ").replace(/^["'“”‘’\s]+|["'“”‘’\s.]+$/g, "").trim();
  if (!/[a-z]{2}/i.test(text) || /^(?:no|na|-)$|^(?:null|none|nothing|n\/a|nil)\b/i.test(text)) return undefined;
  return text.slice(0, 160);
}

/** "he" or "she" as a word, in any contraction ("he's", "she'd", "he'll"). */
const THIRD_PERSON = /\b(?:he|she)(?:['’](?:s|d|ll))?\b/i;
/** The host speaking of themself, alone or with someone ("I", "my", "we", "us", …). */
const FIRST_PERSON = /\b(?:i|i['’](?:m|ve|d|ll)|me|my|mine|myself|we|we['’](?:re|ve|d|ll)|us|our|ours|ourselves)\b/i;

/**
 * Whether a line is told about someone in the story: it says "he" or "she" and nothing in the first
 * person. The host speaks of themself as "I", so such a line's person is never the host — job 409
 * scene 33, "Then he turns the whole thing over in a single motion: life is not short" (the writer
 * of the story reversing his argument), was drawn as the host turning a page at the desk. A line with
 * "I", "my" or "we" in it ("He told me to wait", "I turn it over every morning") is not one, and
 * neither is a how-to said to the viewer ("Turn it over and sand the other side"). Pure.
 */
export function storyPersonLine(line: string | undefined): boolean {
  const text = (line ?? "").replace(/[“”"]/g, " ");
  return THIRD_PERSON.test(text) && !FIRST_PERSON.test(text);
}

/**
 * What the line check is told about one picture beyond its line and its words: that its line's
 * "he"/"she" is someone in the story, when the picture shows a person that nothing marks as anyone
 * else (so it would be drawn as the host — job 409 scene 33), and the time and place its list's
 * sentence is set in (`scene.listSetting`, job 409's farmer, old man and young man drawn as today's).
 * The rules that use them are in `FIT_SYSTEM` (WHO IS IN THE PICTURE, ANOTHER TIME OR PLACE).
 *
 * The note says only what is known for sure — the "he"/"she" is not the host — since it may be an
 * animal the script is about. Replayed over the 352 local storyboards: 20 of 22,500 pictures get it —
 * 409 scene 33, job 400's man in the pharmacy (scenes 5 and 6, "He pays, he walks out to the parking
 * lot"), a hair channel's "a woman notices the gray … and she reaches for the shade she wore at forty"
 * drawn as the host (16, jobs 222-320), and one dog line over its owner's coat (358 scene 19). Eight
 * more were a dog the picture or the line names ("He can smell every bit of it", jobs 357-373): such
 * a picture gets no note, and neither does one whose words already name someone else. Pure.
 */
export function fitPictureNotes(s: StoryboardScene): string {
  const words = s.showSubject ?? s.visualPrompt ?? "";
  const story =
    storyPersonLine(s.scriptText) &&
    !showsSomeoneElse(s) &&
    showsPerson(words) &&
    !namesAnAnimal(words) &&
    !namesAnAnimal(s.scriptText)
      ? " (its he/she is not the host)"
      : "";
  const setting = s.listSetting?.trim() ? ` (inside a passage set in ${s.listSetting.trim()})` : "";
  return `${story}${setting}`;
}

/** "There is a stick in it.", "The problem was a loose wire.": a short sentence that reveals a thing. */
const REVEALS_A_THING =
  /^(?:(?:and|but|so)\s+)?(?:there(?:'s|’s|\s+is|\s+are|\s+was|\s+were)|the\s+(?:problem|culprit|cause|answer|catch|reason)\s+(?:is|was))\s+(?:(?:just|only|simply|actually|really|still)\s+)?(?:a|an|the|one|some|two|three|your|its|their)\s+(.+?)[.!?…"”’]*$/i;
/** The last word of what such a sentence names, when it names an idea rather than a thing. */
const NOT_A_SEEN_THING =
  /^(?:reasons?|ways?|things?|catch|answers?|problems?|point|difference|trick|secret|rules?|lessons?|chance|time|ideas?|questions?|truth|fix|part|steps?|options?|choices?|deal|issues?|risks?|cost|price|story|solutions?|method|plan|need|limit|lot|bit|more|better|upside|downside|benefit|bonus)$/i;

/**
 * THE LINE'S LAST WORD (2026-10-18, job 408 scene 21): the short closing sentence a picture's line
 * builds to, when it reveals a thing the picture's words never name — "…you decide the toilet is
 * getting old. The toilet is fine. There is a stick in it." over "toilet bowl with water draining
 * slowly, paper piling near the bend": the stick the whole line was about was left out, and the
 * picture shipped as a strong flush. The line check is told the sentence (`ends on "…"`), and holds
 * the picture to it. Only "there is a …" and "the problem was a …" sentences of eight words or fewer,
 * after another sentence — replayed over 22,500 local pictures it marks five: this stick, job 403's
 * (drawn as the swab it is, which the check can tell), and one script's "But there is a blanket" over
 * a bag of scraps, three times. Undefined otherwise. Pure.
 */
export function closingThing(line: string | undefined, show: string | undefined): string | undefined {
  const sentences = (line ?? "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return undefined;
  const last = sentences[sentences.length - 1];
  const m = REVEALS_A_THING.exec(last);
  if (!m || last.split(/\s+/).length > 8) return undefined;
  const thing = m[1].split(/\s+(?:in|on|at|inside|under|behind|stuck|caught|of|with|for|from|that|which|to|left)\b/i)[0];
  const words = thing.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/).filter(w => w.length >= 3);
  // "There's a reason for that.", "There is a better way.", "There's one more thing." reveal nothing a
  // camera can see: no mark for the check to chase.
  if (NOT_A_SEEN_THING.test(words[words.length - 1] ?? "")) return undefined;
  const have = new Set((show ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/));
  const named = (w: string) => have.has(w) || have.has(`${w}s`) || have.has(w.replace(/(?:es|s)$/, ""));
  return words.length && !words.some(named) ? last : undefined;
}

/** The pictures the fit check reads and may fix — drawn cutaways, never the CTA, cover or assets. */
// A list's group picture (`listSet`) is right by construction — the line check never rewrites it.
const fitCandidate = (s: StoryboardScene) =>
  !s.hostPresent && !s.cta && !s.qrHero && !s.coverHero && !s.assetImageUrl && !s.showsBook && !s.splitVisual && !s.listSet;

/**
 * The split panels the panel pass reads and may rewrite (`fitSplitPanelsToLines`): a host beat's
 * picture half, never a CTA beat's (its panel shows calm b-roll, not the pitch it sits beside).
 */
export const panelCandidate = (s: StoryboardScene) =>
  !!s.hostPresent && !!s.splitVisual?.trim() && !s.cta && !s.qrHero && !s.coverHero && !s.assetImageUrl && !s.showsBook;

/**
 * The model's fixes, kept only for candidate pictures: a rewrite where it said the picture does not
 * show what its line is about, and any split. Reads the per-picture answer (`pictures`) and the older
 * list of fixes (`fix`). With THE VIEWER, "you" in `who` or `other` is the viewer by name. Pure.
 */
export function parsePictureFixes(
  text: string,
  scenes: StoryboardScene[],
  viewer?: RecurringPerson
): PictureFix[] {
  return readPictureFixes(text, scenes, false, viewer);
}

/**
 * The panel pass's answer (`fitSplitPanelsToLines`), kept only for split panels: a rewrite, its key
 * thing and stage, and what the sentence rules out. A panel is never split or joined and shows
 * nobody, so a split, a join, `who` and `other` are dropped. Pure.
 */
export function parsePanelFixes(text: string, scenes: StoryboardScene[]): PictureFix[] {
  return readPictureFixes(text, scenes, true);
}

function readPictureFixes(
  text: string,
  scenes: StoryboardScene[],
  panel: boolean,
  viewer?: RecurringPerson
): PictureFix[] {
  const isCandidate = panel ? panelCandidate : fitCandidate;
  const parsed = safeParseJSON<any>(text);
  const data = parsed.success ? parsed.data : undefined;
  const entries: any[] = Array.isArray(data?.pictures)
    ? data.pictures
    : Array.isArray(data?.fix)
      ? data.fix.map((f: any) => ({ ...f, shows_it: false }))
      : [];
  const out: PictureFix[] = [];
  const clean = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 400) : "");
  for (const f of entries) {
    const id = pictureId(f?.id);
    if (id == null || !scenes[id] || !isCandidate(scenes[id])) continue;
    if (out.some(x => x.id === id)) continue;
    // A panel sits beside a host take whose timing is fixed: never joined or split, nobody in it.
    const join = !panel && f?.join === true;
    const show = f?.shows_it === false || join ? clean(f?.show) : "";
    const split: PictureSplit[] = (!panel && Array.isArray(f?.split) ? f.split : [])
      .map((x: any) => ({
        from: clean(x?.from),
        show: clean(x?.show),
        thing: clean(x?.thing) || undefined,
        stage: buildStageOf(x?.stage),
        // Read like a rewrite's `other`: an answer of nobody else (null, "the host") is kept as null, so
        // the new picture does not take the line's someone-else (`applyPictureSplits`); with THE VIEWER,
        // "you" is the viewer by name (`otherPersonFor`).
        other: !!x && typeof x === "object" && "other" in x ? otherPersonFor(x.other, viewer) ?? null : undefined,
      }))
      .filter((x: PictureSplit) => x.from && x.show);
    const who = panel ? undefined : whoOf(f?.who, viewer);
    // WHAT THE SENTENCE RULES OUT rides even a picture the check left as it is: a right picture can
    // still come out of the picture model showing it.
    const forbids = forbidsOf(f?.forbids);
    if (!show && !split.length && !join && who === undefined && !forbids) continue;
    // A stage the check answered (a stage word, or null for "no made thing") replaces the old one;
    // a missing field keeps it (`applyPictureFixes`). The person is read the same way.
    const answered = !!f && typeof f === "object" && "stage" in f;
    const saidWho = !panel && !!f && typeof f === "object" && "other" in f;
    out.push({
      id,
      ...(join ? { join } : {}),
      ...(show ? { show } : {}),
      ...(show && typeof f?.thing === "string" && f.thing ? { thing: f.thing } : {}),
      ...(show && answered ? { stage: buildStageOf(f.stage) ?? null } : {}),
      ...(show && saidWho ? { other: otherPersonFor(f.other, viewer) ?? null } : {}),
      ...(split.length ? { split } : {}),
      ...(who !== undefined ? { who } : {}),
      ...(forbids ? { forbids } : {}),
    });
  }
  return out;
}

/**
 * Put each fix on its picture: the new description, its key thing (the planner's name matched to
 * the list, else the ones the description names), a person only if one is in it, the video rule
 * applied again, and who the person is (`applyWho`). Returns how many pictures were rewritten. Pure
 * apart from mutating `scenes`.
 */
export function applyPictureFixes(
  scenes: StoryboardScene[],
  fixes: PictureFix[],
  things: KeyThing[] | undefined
): number {
  let n = 0;
  for (const f of fixes) {
    const s = scenes[f.id];
    // WHAT THE SENTENCE RULES OUT (2026-10-18, the audit): kept on the picture whether or not it is
    // rewritten — the check is told it, and asks whether the drawn frame shows it.
    if (s && f.forbids) s.forbids = f.forbids;
    if (!s || !f.show) continue;
    const named = keyThingsIn(f.show, things);
    const primary = (f.thing ? matchKeyThing(f.thing, things ?? []) : null) ?? named[0] ?? null;
    s.showSubject = f.show;
    s.visualPrompt = f.show;
    s.visualPromptSeed = undefined;
    s.brollVisual = undefined;
    // The build stage: the check's own answer when it gave one; else the old stage while the picture
    // is still of the same key thing — a rewrite onto something else has no stage it can vouch for.
    s.buildStage =
      f.stage !== undefined ? f.stage ?? undefined : s.keyThing === primary?.name ? s.buildStage : undefined;
    s.keyThing = primary?.name;
    const others = named.map(t => t.name).filter(name => name !== primary?.name);
    s.otherKeyThings = others.length ? others : undefined;
    // SOMEONE ELSE IS DRAWN AS SOMEONE ELSE in a rewrite too (2026-10-18): the check now rewrites a
    // picture that leaves out WHO does WHAT (Hank's job 171 scene 248, "my neighbor across the street
    // watched the whole thing from his driveway" over an empty driveway), and the person it puts in
    // used to reach `markHostBroll` with no `otherPerson` — drawn as the HOST. The check's answer
    // replaces the old person (`null`: nobody else, so any person in it is the host); no answer keeps
    // the old one while someone is still in the picture.
    s.humanPresent = showsPerson(f.show) || f.other ? true : undefined;
    if (f.other !== undefined) {
      s.otherPerson = f.other ?? undefined;
      s.otherPeople = f.other ? otherPeopleOf(f.other) : undefined;
    }
    // A rewrite with no person in it has nobody to be "someone else".
    if (!s.humanPresent) s.otherPerson = s.otherPeople = undefined;
    s.sameShot = undefined;
    s.toolContact = contactToolWork(f.show) ? true : undefined;
    s.blurPrint = !s.pictureText && blurredPrint(f.show) ? true : undefined;
    // Judged again on the new description (`judgeSelfMoving`); the plan gate then makes the ones
    // that move videos within the share, the main thing's first (`addMotion`).
    s.selfMoving = undefined;
    settleVideoKind(s);
    n++;
  }
  // Who is in each picture, on the descriptions as they now are (rewritten or not).
  for (const f of fixes) if (f.who !== undefined && scenes[f.id]) applyWho(scenes[f.id], f.who);
  return n;
}

/**
 * A description with what it says is NOT there taken out: "a smoke alarm on the counter, no box, no
 * packaging" names an alarm, not a box. From "no", "not", "without", "never" or an "-n't" word to the
 * end of its phrase, or to an "and" / "but" that starts the next one; "no more than three" is a count
 * and stays, and so does a hyphened name ("a no-sew fleece blanket", "a never-ending scarf"), which
 * is a kind of thing, not its absence. Pure.
 */
export function withoutNegatedPhrases(text: string): string {
  return text
    .replace(
      /\b(?:no|not|cannot|without|never|nor|[a-z]+n['’]t)\b(?![-‐‑])(?!\s+(?:more|less|fewer)\s+than\b)(?:(?!\b(?:and|but)\b)[^,;.!?:()…])*/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Typed words that say NOBODY is in the picture: "no hands", "without any people", "no one in the
 * room", "nobody". Read on the words as typed — `withoutNegatedPhrases` takes exactly these out.
 */
const NOBODY_IN_IT =
  /\b(?:no|without(?:\s+(?:a|any))?)\s+(?:other\s+)?(?:hands?|fingers?|arms?|people|persons?|figures?)\b|\bno(?:body|[- ]one)\b(?!\s+(?:of|thing|piece|part|more)\b)/i;

/**
 * A TYPED PICTURE OWNS THE PICTURE (2026-10-18, job 383 scenes 20, 33 and 40). An operator's typed
 * prompt replaced only `visualPrompt`: `showSubject` stayed the planner's, so `subjectLead` still led
 * every redo with it and the picture check still held the redo to it — scene 20 was typed "one round
 * white smoke alarm lying face up on a wooden kitchen counter … no box, no packaging" and was led and
 * judged by "close-up of the front label of a small rectangular cardboard smoke detector box held in
 * one hand", its key thing still the box; scene 40's "blank yellow sticky note … no writing of any
 * kind" kept soft print and the detector's back panel, and all 8 of its checks said writing. Now the
 * typed words are what the picture must show, and what the planner tied to the OLD picture goes
 * unless the typed words still name it: its key thing (so the memory it is drawn from and the things
 * the check requires), the part and the named kind it was about, the words it may print, soft print,
 * and a person the typed words say is not in it. What the typed words say is NOT there names nothing
 * (`withoutNegatedPhrases`). Called BEFORE the typed words land on `visualPrompt`: the card sends its
 * prompt on every regenerate, typed or not, and the prompt the picture already has is not typed — a
 * plain regenerate keeps the planner's subject. Returns whether it took the picture over. Pure apart
 * from mutating `s`.
 */
export function ownTypedPicture(s: StoryboardScene, typed: string, things: KeyThing[] | undefined): boolean {
  const text = typed.trim();
  if (!text || text === (s.visualPrompt ?? "").trim()) return false;
  const said = withoutNegatedPhrases(text);
  tieToTypedWords(s, said, things);
  // NOBODY WHEN THE TYPED WORDS SAY SO: scene 20 was typed "… no hands, no readable writing anywhere"
  // and still carried the person of the planner's "… box held in one hand", so its prompt asked for
  // the host at work, with the host's photo attached, beside the operator's "no hands". Taken out
  // only when the typed words also show no one themselves; a person they add is left as it was
  // (who draws them — the host or someone else — is decided before the pictures, `markHostBroll`).
  if (NOBODY_IN_IT.test(text) && !SHOWS_PERSON.test(said)) {
    s.humanPresent = undefined;
    s.otherPerson = undefined;
    s.hostFaceShown = undefined;
  }
  s.showSubject = text;
  return true;
}

/**
 * What the planner tied to a picture's OLD words stays only while typed words `said` (negations
 * already taken out) still name it: its key thing, the other key things in it, the stage, the part
 * and the named kind it was about, the words it may print, and soft print. Shared by a typed cutaway
 * (`ownTypedPicture`) and a typed split panel (`ownTypedPanel`). Pure apart from mutating `s`.
 */
function tieToTypedWords(s: StoryboardScene, said: string, things: KeyThing[] | undefined): void {
  const names = (name: string | undefined) => !!name?.trim() && keyThingsIn(said, [{ name, look: "" }]).length > 0;
  const named = keyThingsIn(said, things);
  const primary = names(s.keyThing) ? s.keyThing : named[0]?.name;
  // A stage belongs to the picture of ITS thing; another thing has no stage the typed words vouch for.
  if (primary !== s.keyThing) s.buildStage = undefined;
  s.keyThing = primary;
  const others = named.map(t => t.name).filter(name => name !== primary);
  s.otherKeyThings = others.length ? others : undefined;
  if (s.partOf && !names(s.partOf)) s.partOf = undefined;
  if (s.namedLook && !names(s.namedLook.split(":")[0])) s.namedLook = undefined;
  if (s.pictureText && !saidText(s.pictureText, said)) s.pictureText = undefined;
  s.blurPrint = !s.pictureText && blurredPrint(said) ? true : undefined;
}

/**
 * A TYPED PANEL OWNS THE PANEL (2026-10-18, job 400 scene 27). A split's panel is drawn from its key
 * thing's pictures and in their named kind's look (`withSplitMemory`), and an operator's panel redraw
 * now gets both — but the key thing sits on the HOST scene, tagged from the panel's OLD words, and
 * typed panel words left it there. Typed "a steaming cup of tea on the desk" over job 400's scroll
 * panel, the redraw would have been handed the scroll's pictures, "the same scroll as in the
 * reference" and the papyrus scroll's exact look, and held to a scroll by the check. So typed panel
 * words keep what the old panel was tied to only while they still name it, as a typed cutaway does
 * (`ownTypedPicture`); the host take beside it is never touched (no person or subject field changes).
 * Called BEFORE the typed words land on `splitVisual`: a plain regenerate sends the panel's own words
 * back, and those are not typed. Returns whether it took the panel over. Pure apart from mutating `s`.
 */
export function ownTypedPanel(s: StoryboardScene, typed: string, things: KeyThing[] | undefined): boolean {
  const text = typed.trim();
  if (!s.hostPresent || !text || text === (s.splitVisual ?? "").trim()) return false;
  tieToTypedWords(s, withoutNegatedPhrases(text), things);
  return true;
}

/** A line that ends a sentence (so the next picture starts a new one). */
const endsSentence = (t: string | undefined) => /[.!?]["')\]]?\s*$/.test((t ?? "").trim());
/** A sentence's end at the end of a trimmed text, a closing quote or bracket of any kind allowed. */
const SENTENCE_END = /[.!?]["'’”)\]]*$/;

/**
 * ONE IDEA, ONE PICTURE (2026-10-02, the operator: whether two pictures of one sentence become one
 * "should still be based on the script — if they have the same context or object"). The line check
 * marks a picture `join` when it and the picture before are one idea of one sentence ("Sell your
 * furniture | on Facebook Marketplace"); they become one picture (`joinedLine`), showing what the
 * check wrote for the whole line. Never a list item, never across a sentence end, never past the
 * picture's limit (`maxAt`). Returns the new film, how many joined, and where each old picture went
 * (`remap`, for the splits that follow). Pure apart from the fixes' own rewrite of the joined picture.
 */
export function applyPictureJoins(
  scenes: StoryboardScene[],
  fixes: PictureFix[],
  things: KeyThing[] | undefined,
  sec: (s: StoryboardScene) => number,
  maxAt: (s: StoryboardScene) => number = () => MAX_PICTURE_SEC
): { scenes: StoryboardScene[]; joined: number; remap: Map<number, number> } {
  const joins = new Map(fixes.filter(f => f.join).map(f => [f.id, f]));
  const out: StoryboardScene[] = [];
  const lens: number[] = [];
  const remap = new Map<number, number>();
  let joined = 0;
  scenes.forEach((s, id) => {
    const f = joins.get(id);
    const k = out.length - 1;
    const prev = out[k];
    const ok =
      !!f &&
      !!prev &&
      remap.get(id - 1) === k &&
      fitCandidate(prev) &&
      fitCandidate(s) &&
      !prev.listCut &&
      !s.listCut &&
      !endsSentence(prev.scriptText) &&
      lens[k] + sec(s) <= maxAt(prev);
    if (!ok) {
      remap.set(id, out.length);
      out.push(s);
      lens.push(sec(s));
      return;
    }
    const merged = {
      ...prev,
      ...FRESH,
      scriptText: `${(prev.scriptText ?? "").trim()} ${(s.scriptText ?? "").trim()}`.trim(),
      narration: firstWords(`${prev.scriptText ?? ""} ${s.scriptText ?? ""}`, 8),
      joinedLine: true,
      wordCut: prev.wordCut || s.wordCut,
      humanPresent: prev.humanPresent || s.humanPresent || undefined,
      // Someone else in either half is still in the one picture (cleared below if it shows no one).
      otherPerson: prev.otherPerson ?? s.otherPerson,
      otherPeople: prev.otherPerson ? prev.otherPeople : s.otherPeople,
      // One picture for the whole sentence must not show what either part of it rules out.
      forbids:
        [prev.forbids, s.forbids]
          .filter((x, k, all): x is string => !!x && all.indexOf(x) === k)
          .join("; ") || undefined,
    } as StoryboardScene;
    if (f!.show || f!.who !== undefined)
      applyPictureFixes(
        [merged],
        [{ id: 0, show: f!.show, thing: f!.thing, stage: f!.stage, other: f!.other, who: f!.who }],
        things
      );
    out[k] = merged;
    lens[k] += sec(s);
    remap.set(id, k);
    joined++;
  });
  out.forEach((s, i) => (s.index = i + 1));
  return { scenes: out, joined, remap };
}

/**
 * The token at `at` starts a new sentence: the words before it end on ".", "!" or "?" (a closing
 * quote or bracket allowed) and a space — "$1.50" is one price, not two sentences. Pure.
 */
function startsSentenceAt(text: string, spans: TokenSpan[], at: number): boolean {
  return at > 0 && /[.!?]["'’”)\]]*\s/.test(text.slice(spans[at - 1].end, spans[at].start));
}

/**
 * Split pictures where the check says a line names something NEW partway through: the words from
 * `from` on become their own picture showing it (`show`), the part before keeps its picture. A split
 * whose words are not in the line, or that would leave either part under 4 words, is skipped. The
 * new pieces have no timing yet — the caller re-cuts the film's ranges. Pure — returns a new list.
 *
 * ONE PICTURE, ONE SUBJECT (2026-10-18, job 407 scene 20): a split may also come where a SENTENCE
 * starts that is about a different thing. One still ran 16.6 s over "The oldest cabins held long
 * boards down with heavy poles laid across each course, so the roof went on without a nail. When you
 * rive, the bolt sits in a fork or against a stump, never in your hand." — the roof sentence's two
 * pieces had been joined for being short (`joinShortSplits`, `joinedLine`), the riving sentence
 * joined on as the same topic (`joinSameContext`), and the check only ever split at a comparison and
 * never a joined picture, so the roof was never shown. A joined picture is still never cut INSIDE a
 * sentence — only where a new one starts — and a split that draws the picture before it again (the
 * check writing the old picture into the split without rewriting the part before) shows nothing new
 * and is dropped.
 *
 * A SHORT LEAD GOES BACK (2026-10-20, job 413 scene 33). After the steps "drain it outside, | store
 * it sealed," the picture of the sealed can ran 9.7 s over "nowhere near a spark. The downside is
 * real: some mowers are just done, and you'll eat a couple of corpses learning to tell the
 * difference." — 8 s about dead mowers that never showed one. The split at "The downside is real"
 * was refused because the part before it, the step's last 4 words, ran ~1.5 s, under
 * `SPLIT_PART_MIN_SEC`; the whole line then kept the can. When only that LEADING part is too short,
 * and it only FINISHES the sentence the picture before it was saying (that picture ends mid-sentence,
 * the split starts the next sentence), those words go to the picture before — the step's own picture
 * ("store it sealed, nowhere near a spark.") — and the rest gets its own picture. Never when the
 * lead is a sentence of its own ("Pull up a stool." after a sentence ended, job 413 scene 15: its
 * words do not belong to the picture before), never to the host, a CTA, cover, asset, split or a
 * list's group picture (`fitCandidate`), and never past the picture before's limit (`maxAt`).
 */
export function applyPictureSplits(
  scenes: StoryboardScene[],
  fixes: PictureFix[],
  things: KeyThing[] | undefined,
  /** A picture's length, when known — no part may run under `SPLIT_PART_MIN_SEC`. */
  sec?: (s: StoryboardScene) => number,
  /** The longest a picture may stay where it sits — a lead handed back never takes it past. */
  maxAt?: (s: StoryboardScene) => number
): { scenes: StoryboardScene[]; split: number } {
  const byId = new Map(fixes.filter(f => f.split?.length).map(f => [f.id, f.split!]));
  if (!byId.size) return { scenes, split: 0 };
  const out: StoryboardScene[] = [];
  // The seconds of each picture this pass makes (its share of the line it came from), so a lead
  // handed back to one of them is held to its limit too.
  const madeSec = new Map<StoryboardScene, number>();
  const secOf = (x: StoryboardScene) => madeSec.get(x) ?? sec?.(x) ?? 0;
  let split = 0;
  scenes.forEach((s, id) => {
    const cuts = byId.get(id);
    const text = s.scriptText ?? "";
    const spans = tokenSpans(text);
    if (!cuts || !fitCandidate(s)) {
      out.push(s);
      return;
    }
    const starts: { at: number; cut: PictureSplit }[] = [];
    let cursor = 0;
    for (const cut of cuts) {
      const at = findPhraseAt(spans, cut.from, cursor + 1);
      if (at < 0) continue;
      // A joined picture is one sentence made one picture on purpose ("Sell your furniture | on
      // Facebook Marketplace"): it is cut again only where a new sentence starts.
      if (s.joinedLine && !startsSentenceAt(text, spans, at)) continue;
      // A split drawing the part before it again would be two copies of one picture and still leave
      // the earlier words unshown: the line keeps the picture it had.
      const before = starts.length ? starts[starts.length - 1].cut.show : s.showSubject ?? s.visualPrompt ?? "";
      if (sameSubject(before, cut.show) || nearlySameSubject(before, cut.show)) continue;
      starts.push({ at, cut });
      cursor = at;
    }
    const bounds = [0, ...starts.map(x => x.at), spans.length];
    // Each part must run long enough to be its own picture (`SPLIT_PART_MIN_SEC`), judged by its
    // share of the words when the picture's length is known.
    const total = sec?.(s) ?? 0;
    const shareSec = (words: number) => (total > 0 ? (words / spans.length) * total : 0);
    const tooShort = (b: number, k: number) =>
      k > 0 &&
      (b - bounds[k - 1] < 4 || (total > 0 && shareSec(b - bounds[k - 1]) < SPLIT_PART_MIN_SEC));
    if (starts.length === 0 || bounds.some((b, k) => k > 1 && tooShort(b, k))) {
      out.push(s);
      return;
    }
    // Only the leading part is too short: it goes back to the picture before when it finishes that
    // picture's sentence (see above); else the line keeps its picture, as before.
    let handBack = false;
    if (tooShort(bounds[1], 1)) {
      const prev = out[out.length - 1];
      const lead = text.slice(0, spans[bounds[1]].start).trim();
      const leadSec = shareSec(bounds[1]);
      const limit = prev && maxAt ? (movingPicture(prev) ? Math.min(maxAt(prev), MOVING_PICTURE_MAX_SEC) : maxAt(prev)) : Infinity;
      handBack =
        !!prev &&
        fitCandidate(prev) &&
        !!(prev.scriptText ?? "").trim() &&
        !SENTENCE_END.test((prev.scriptText ?? "").trim()) &&
        startsSentenceAt(text, spans, bounds[1]) &&
        secOf(prev) + leadSec <= limit;
      if (!handBack) {
        out.push(s);
        return;
      }
      const joined = `${(prev.scriptText ?? "").trim()} ${lead}`;
      const back = { ...prev, ...FRESH, scriptText: joined, narration: firstWords(joined, 8) } as StoryboardScene;
      out[out.length - 1] = back;
      madeSec.set(back, secOf(prev) + leadSec);
    }
    bounds.slice(0, -1).forEach((b, k) => {
      const from = spans[b].start;
      const to = k + 1 < bounds.length - 1 ? spans[bounds[k + 1]].start : text.length;
      const slice = text.slice(from, to).trim();
      if (k === 0) {
        if (handBack) return;
        out.push({ ...s, ...FRESH, scriptText: slice, narration: firstWords(slice, 8) } as StoryboardScene);
        if (total > 0) madeSec.set(out[out.length - 1], shareSec(bounds[k + 1] - b));
        return;
      }
      const cut = starts[k - 1].cut;
      const named = keyThingsIn(cut.show, things);
      const primary = (cut.thing ? matchKeyThing(cut.thing, things ?? []) : null) ?? named[0] ?? null;
      const others = named.map(t => t.name).filter(n => n !== primary?.name);
      out.push({
        ...s,
        ...FRESH,
        scriptText: slice,
        narration: firstWords(slice, 8),
        showSubject: cut.show,
        visualPrompt: cut.show,
        visualPromptSeed: undefined,
        brollVisual: undefined,
        keyThing: primary?.name,
        otherKeyThings: others.length ? others : undefined,
        // A new picture: only the stage the check gave it, never the line's old one.
        buildStage: cut.stage,
        humanPresent: showsPerson(cut.show) || cut.other ? true : undefined,
        // The person the check put in this new picture; else the line's, but only while the new part
        // still shows a person (the audit found "a woman customer" left on an incense holder, job 361
        // scene 32) — `markHostBroll` would otherwise draw them into a picture of something else.
        // An answer of NOBODY ELSE is kept: a split where a new sentence starts is where the person
        // changes (job 399 scene 16: "the flight attendant pours your soda…" then "you can have the
        // whole thing just by asking" — the viewer's hands, which the line's someone-else would draw
        // as the crew member).
        otherPerson: cut.other !== undefined ? cut.other ?? undefined : showsPerson(cut.show) ? s.otherPerson : undefined,
        otherPeople: cut.other
          ? otherPeopleOf(cut.other)
          : cut.other === undefined && showsPerson(cut.show)
            ? s.otherPeople
            : undefined,
        // What the line rules out (answered for the whole line) stays out of this part too.
        forbids: s.forbids,
        stillImage: true,
        objectMotion: undefined,
        selfMoving: undefined,
        toolContact: contactToolWork(cut.show) ? true : undefined,
        pictureText: undefined,
        // Soft print by the new picture's own words, as a rewrite reads it (`applyPictureFixes`).
        blurPrint: blurredPrint(cut.show) ? true : undefined,
        sameShot: undefined,
        listCut: undefined,
        hostCandidate: undefined,
        // Its own sentence's picture, not a join: a picture cut from a joined one is not joined.
        joinedLine: undefined,
        wordCut: true,
      } as StoryboardScene);
      if (total > 0) madeSec.set(out[out.length - 1], shareSec(bounds[k + 1] - b));
      split++;
    });
  });
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, split };
}

/**
 * SAY IT, SHOW IT, checked (2026-09-30, the operator on Frederick's job 259: "Fires don't all behave
 * the same way" showed the smoke alarm). Nothing checked a picture against its LINE — the picture
 * checker only asks whether the frame shows its own description. One call per ~80 lines reads every
 * line beside its planned picture, before anything is paid for, and rewrites the pictures that do
 * not show what their line is about. Returns how many it fixed; any failure changes nothing.
 *
 * WHAT NOT TO DO (2026-10-18, the audit): it is also the gate for a sentence that rules something
 * out. Only danger warnings had a rule, so "and away from the furnace" was drawn with the lumber
 * stack beside the furnace (production 203-143, 211-135; practice job 352 #127 named the furnace
 * "across the room"), "never use the rip fence as a stop" with the fence as a stop (352 #154).
 * Opus reads every picture with the lines around it, so it — not a word list, which fired on "just
 * don't count on it" in five channels — says what each such picture must not show (`forbids`); the
 * picture check then asks only those pictures about it.
 */
export async function fitPicturesToLines(
  scenes: StoryboardScene[],
  opts: {
    sheet?: string;
    keyThings?: KeyThing[];
    subject?: string;
    /** The longest a picture may stay where it sits (`pictureMaxSecAt`) — a join never passes it. */
    maxAt?: (s: StoryboardScene) => number;
    /** WHO "YOU" IS when the host's job serves the viewer (`inputParams.viewerPerson`): never "host". */
    viewer?: RecurringPerson;
  } = {}
): Promise<{ scenes: StoryboardScene[]; fixed: number; split: number; joined: number }> {
  const BATCH = 80;
  const fixes: PictureFix[] = [];
  // The main thing's first picture is named to the check: it is shown in use when it naturally is.
  const main = opts.keyThings?.find(k => k.main)?.name;
  const firstMain = main
    ? scenes.findIndex(
        s =>
          fitCandidate(s) &&
          (s.keyThing === main || keyThingsIn(s.showSubject ?? s.visualPrompt, opts.keyThings).some(k => k.name === main))
      )
    : -1;
  for (let from = 0; from < scenes.length; from += BATCH) {
    const lines: string[] = [];
    let any = false;
    for (let i = Math.max(0, from - 4); i < Math.min(scenes.length, from + BATCH); i++) {
      const s = scenes[i];
      const said = (s.scriptText ?? "").trim().replace(/\s+/g, " ");
      const prev = scenes[i - 1];
      const sameSentence =
        !!prev && fitCandidate(prev) && !prev.listCut && !s.listCut && !endsSentence(prev.scriptText);
      const secs = s.audioDuration ? ` (${s.audioDuration.toFixed(1)} s)` : "";
      if (s.hostPresent || !fitCandidate(s) || i < from) {
        lines.push(`HOST/OTHER: "${said}"`);
        continue;
      }
      any = true;
      // The thing the line closes on, when the picture's words leave it out (`closingThing`).
      const closing = closingThing(said, s.showSubject ?? s.visualPrompt);
      lines.push(
        `#${i} PICTURE${secs}${s.sameShot ? " (continues)" : ""}${s.joinedLine ? " (joined)" : ""}${sameSentence ? " (same sentence)" : ""}${i === firstMain ? " (FIRST of the MAIN thing)" : ""}${fitPictureNotes(s)}${closing ? ` (ends on "${closing}")` : ""}: said "${said}" | shows: ${s.showSubject ?? s.visualPrompt ?? ""}`
      );
    }
    if (!any) continue;
    try {
      const r = await invokeClaude({
        systemPrompt: FIT_SYSTEM,
        userMessage:
          (opts.subject ? `VIDEO SUBJECT: ${opts.subject}\n` : "") +
          (opts.keyThings?.length
            ? `KEY THINGS: ${opts.keyThings.map(k => `${k.main ? "MAIN " : ""}${k.name}: ${k.look}`).join(" | ")}\n`
            : "") +
          (opts.viewer
            ? `THE VIEWER ("you" in this script — someone the host's work serves, never "host"): ${opts.viewer.name}\n`
            : "") +
          `\n${lines.join("\n")}\n\nJSON:`,
        maxTokens: 24000,
        model: FIT_MODEL(),
        effort: planningEffort("FIT_EFFORT"),
        step: "Line check",
      });
      fixes.push(...parsePictureFixes(r.text, scenes, opts.viewer));
    } catch {
      /* a failed check changes nothing */
    }
  }
  // Rewrites first (by position, before anything moves), then the splits.
  const fixed = applyPictureFixes(scenes, fixes, opts.keyThings);
  const merged = applyPictureJoins(scenes, fixes, opts.keyThings, s => s.audioDuration ?? 0, opts.maxAt);
  const moved = fixes
    .filter(f => f.split?.length && merged.remap.has(f.id))
    .map(f => ({ ...f, id: merged.remap.get(f.id)! }));
  // A picture a join just made has no measured length (`FRESH`): its seconds are its parts', so a
  // split of it — now allowed where a new sentence starts — still leaves no part under 3 s.
  const lenOf = new Map<StoryboardScene, number>();
  scenes.forEach((s, id) => {
    const into = merged.scenes[merged.remap.get(id) ?? -1];
    if (into) lenOf.set(into, (lenOf.get(into) ?? 0) + (s.audioDuration ?? 0));
  });
  const cut = applyPictureSplits(
    merged.scenes,
    moved,
    opts.keyThings,
    s => lenOf.get(s) ?? s.audioDuration ?? 0,
    opts.maxAt
  );
  return { scenes: cut.scenes, fixed, split: cut.split, joined: merged.joined };
}

// ─── One picture, one thing: never "X or Y" ─────────────────────────────────────────────

/**
 * A word that says where a thing is or what state it is in — so the end of the thing's own name, and
 * of the second alternative: "… or belt sander setup | sitting on a garage workshop bench". A doing
 * word (`DOING_WORD`) closes it too.
 */
const AFTER_A_THING =
  /^(?:on|in|at|by|beside|next|near|with|under|over|against|from|of|for|inside|behind|below|above|across|along|around|atop|into|onto|through|between|among|beneath|underneath|that|which|where|while|whose|and|or|but|so|to|as|like|during|after|before|until|when|if|because|since|sitting|resting|lying|standing|hanging|leaning|propped|placed|laid|set|left|stacked|spread|perched|mounted|clamped|bolted|parked|tucked|displayed|arranged|scattered|piled|lined|waiting|glowing|burning|steaming|running|showing|displaying|holding|containing|filled|covered|marked|labeled|labelled|printed|made|used|related|attached|wrapped|facing|shown|seen|viewed|visible|nearby|still|rests|sits|lies|stands|hangs|leans|waits|shows|is|are|was|were)$/i;
/**
 * A word that opens a thing's name — so the start of the first alternative: "a | white or
 * cream-colored smoke alarm", "a small packet of | crackers or cookies".
 */
const BEFORE_A_THING =
  /^(?:a|an|the|its|their|his|her|my|your|our|this|that|these|those|some|each|every|another|either|on|in|at|by|beside|next|near|with|under|over|against|from|of|for|inside|behind|below|above|across|along|around|atop|into|onto|through|between|among|beneath|underneath|to|like|and|or|but|while|as|is|are|was|were|be)$/i;
const DETERMINER = /^(?:a|an|the|its|their|his|her|my|your|our|this|that|these|those|some|each|every|another)$/i;
/** A doing word, not a thing: a choice of verbs ("adjusting or pointing at", "stacked or fanned") is left alone. */
const DOING_WORD = /^[a-z]{3,}(?:ing|ed)$/i;
/**
 * A THING whose name ends like a doing word. Read as one, it closed the second choice inside its own
 * name and the cut glued the two halves together: "an old worn blanket or plain batting beneath it"
 * came out "an old worn blanket batting beneath it" (job 154), "a table runner or small pieced wall
 * hanging" came out "a table runner hanging" (job 166), "autumn foliage or market setting softly
 * behind" came out "autumn foliage setting softly behind" (job 261). Read as a thing when it is a
 * doing word, the doing word only goes with the dropped choice ("a large white cup or plate setting on
 * the table" → "a large white cup on the table"), which still reads. "Hanging" is a thing only after
 * "wall": as a doing word it is everywhere ("a pot holder hanging from a peg").
 */
const THING_ENDING_IN_ING =
  /^(?:batting|bedding|building|ceiling|clothing|frosting|icing|railing|siding|stuffing|string|spring|topping|tubing|wedding|awning|shelving|decking|flooring|roofing|fencing|tiling|paneling|panelling|carpeting|plumbing|housing|lining|padding|molding|moulding|sapling|seedling|duckling|earring|pudding|wiring|setting)$/i;
const isThingName = (word: string, before: string) =>
  THING_ENDING_IN_ING.test(word) || (/^hanging$/i.test(word) && /^wall$/i.test(before));
/**
 * A word a picture writer puts after a doing word to say how it is done, so the thing's name has
 * ended before the doing word: "a small square | folded neatly", "a bar | sliding up".
 */
const AFTER_A_DOING = /^(?:up|down|out|off|away|back|open|shut|flat|upright|[a-z]{3,}ly)$/i;
/**
 * A word that says what a thing does, so the first choice starts after it: "the shelf holds | jars or
 * small glass spice tins" (cutting back past it would drop "shelf holds" with the first choice).
 */
const SAYS_WHAT_IT_DOES =
  /^(?:holds|has|have|shows|sits|rests|lies|stands|hangs|leans|waits|contains|carries|keeps|needs|gets|makes|looks|seems|becomes|reads|wears)$/i;
/** A describing word: a colour, a tone, a kind ("very dark | or black beads", "a different floral | or check print"). */
const DESCRIBING =
  /^(?:[a-z]{3,}(?:ful|ous|ive|ish|less|ral)|black|white|grey|gray|brown|red|blue|green|yellow|orange|pink|purple|cream|ivory|beige|tan|navy|dark|light|pale|bright|deep|plain)$/i;
/**
 * A word that describes the NAME after it rather than being the name: a describing word, a material,
 * a pattern, a size or shape ("a simple wooden | or metal rail", "faded geometric | or floral print",
 * "a small | or large bowl"). A choice that ends on one shares the name the second choice carries.
 */
const describesTheName = (w: string) =>
  DESCRIBING.test(w) ||
  /^[a-z]{4,}ic$|-(?:colou?red|toned|tone)$/i.test(w) ||
  /^(?:wooden|wood|metal|plastic|glass|steel|iron|copper|brass|tin|cotton|wool|woollen|woolen|linen|leather|paper|stone|ceramic|porcelain|silver|gold|golden|velvet|silk|denim|rubber|vinyl|bamboo|wicker|cardboard|concrete|marble|clay|terracotta|stainless|aluminum|aluminium|oak|pine|maple|walnut|cedar|birch|teak|mahogany|check|checked|checkered|plaid|striped|patterned|spotted|dotted|tartan|small|large|big|tiny|little|tall|short|long|wide|narrow|thick|thin|old|new|worn|soft|heavy|round|square|simple|clean|smooth|rough|shiny|matte|indoor|outdoor|handmade|homemade|vintage|antique|modern)$/i.test(
    w
  );
/** The word before an "or" that is no choice between two things: a count, "more or less", "with or without". */
const NO_CHOICE_BEFORE =
  /^(?:\d[\d.,/]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|fifty|hundred|few|several|more|less|sooner|later|with|whether|rather)$/i;
/** The word after one: a count, "or so", "or similar", "or else", or a new clause ("… or it cracks", "… or is about to"). */
const NO_CHOICE_AFTER =
  /^(?:\d[\d.,/]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|fifty|hundred|few|several|so|not|more|less|fewer|else|other|another|any|anything|something|whatever|similar|nothing|never|without|it|they|you|we|he|she|i|this|that|these|those|there|its|their|is|are|was|were|be|has|have|had|will|can|could|would)$/i;
/** A sentence saying what is NOT there bans every thing it names: "no writing or logos", "no face, head, or body". */
const NEGATED_SENTENCE = /\b(?:no|not|without|never|neither|nor|none|nothing|nobody|any|whether)\b|n['’]t\b/i;

/**
 * A description naming ONE thing where it offered a choice: "A guided sharpening system or belt
 * sander setup sitting on a garage workshop bench" → "A guided sharpening system sitting on a garage
 * workshop bench" (job 406 scene 19's split panel, 2026-10-18 — the line offered the choice, every
 * picture writer is told "never X or Y", and the panel path let it through: the picture model drew
 * one of them, the cheap one its memory held, under "a belt setup runs $100 to $300"). The first
 * thing is kept, unless the second is the longer and so carries the thing's name ("a coaster or small
 * ornament" → "a small ornament"); a first choice that is only a word describing the name gives way
 * to the second's ("a simple wooden or metal rail" → "a simple metal rail"). Cut only where both are
 * clear: the first runs back to a word that opens a name (`BEFORE_A_THING`), the second ends within
 * five words at a comma, the end, or a word saying where it is or what it is doing (`AFTER_A_THING`).
 * Left exactly as written: a count ("one or two"), "or so", "more or less", "with or without", a
 * sentence that says what is NOT there ("no face, head, or body"), a list closed by ", or", "A, B or
 * C", a choice of doing words, and anything less clear. Replayed over the local storyboards (jobs
 * 150-407): 30 of 1,277 split panels changed, each to one clean thing; run over the 15,554 full-frame
 * descriptions as a harder test, the first version glued halves together ("a pot holder lined pouch",
 * "a simple wooden in a modest room") and the rules above came from those rows. Pure.
 */
export function oneThingOnly(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = cutOneChoice(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

function cutOneChoice(text: string): string {
  const bareOf = (w: string) => w.replace(/[^A-Za-z0-9'’-]+$/, "");
  const lastOf = (s: string, marks: string[]) => Math.max(...marks.map(c => s.lastIndexOf(c))) + 1;
  // ", or" closes a list ("no face, head, or body") or opens a new clause: never a cut.
  const re = /(?<!,)\s+or\s+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index);
    if (NEGATED_SENTENCE.test(before.slice(lastOf(before, [".", ";", ":", "!", "?", "("])))) continue;
    const clauseAt = lastOf(before, [",", ";", ":", ".", "!", "?", "(", "—", "–"]);
    // The first alternative: back to the word that opens its name, or says what the thing does.
    const xs = Array.from(before.slice(clauseAt).matchAll(/\S+/g));
    let from = xs.length;
    while (from > 0 && !BEFORE_A_THING.test(bareOf(xs[from - 1][0])) && !SAYS_WHAT_IT_DOES.test(bareOf(xs[from - 1][0])))
      from--;
    const x = xs.slice(from);
    if (!x.length) continue;
    const prev = bareOf(x[x.length - 1][0]);
    const prevPrev = x.length >= 2 ? bareOf(x[x.length - 2][0]) : "";
    if (NO_CHOICE_BEFORE.test(prev) || (DOING_WORD.test(prev) && !isThingName(prev, prevPrev))) continue;
    // "chisels, planes or saws" is a list of three, not a choice of two.
    if (from === 0 && x.length <= 2 && before[clauseAt - 1] === ",") continue;
    // The second alternative: on to where its name ends, within five words.
    const rest = text.slice(m.index + m[0].length);
    const ys = Array.from(rest.matchAll(/[^\s—–]+/g));
    const lead = ys[0]?.[0] ?? "";
    if (!lead || ys[0].index !== 0 || /^[(\[“"]/.test(lead)) continue;
    const leadBare = bareOf(lead);
    // "wet or freshly styled", "ready or just stitched": a choice of states.
    const howWord = /^(?:[a-z]{2,}ly|just|already|almost|newly|barely|half)$/i.test(leadBare);
    if (NO_CHOICE_AFTER.test(leadBare) || DOING_WORD.test(leadBare) || howWord) continue;
    // "… outdoors or in a covered market": a choice of places or of clauses, not of things.
    if (AFTER_A_THING.test(leadBare) || (BEFORE_A_THING.test(leadBare) && !DETERMINER.test(leadBare))) continue;
    let end = -1;
    let words = 0;
    let closedByWord = false;
    for (let k = 0; k < Math.min(ys.length, 6); k++) {
      const w = ys[k][0];
      const bare = bareOf(w);
      // A doing word after the name ("a guide | opened to a page", "a bar | sliding up"), never one in
      // front of it ("a very old rusty dented metal tin", "a small lined pouch", job 150: "a pot holder
      // or small | lined pouch" came out "a pot holder lined pouch") and never a thing's own name
      // ("plain batting", `THING_ENDING_IN_ING`). The same holds for the doing words that say where a
      // thing is: they end the name only when what follows says so.
      const next = bareOf(ys[k + 1]?.[0] ?? "");
      const doingShape = DOING_WORD.test(bare) && !/^during$/i.test(bare);
      const ends = doingShape
        ? !isThingName(bare, k > 0 ? bareOf(ys[k - 1][0]) : "") &&
          (!next || bare !== w || AFTER_A_THING.test(next) || DETERMINER.test(next) || AFTER_A_DOING.test(next))
        : AFTER_A_THING.test(bare);
      if (k > 0 && (ends || /^[(\[“"]/.test(w))) {
        end = ys[k - 1].index! + bareOf(ys[k - 1][0]).length;
        words = k;
        closedByWord = true;
        break;
      }
      if (k === 5) break;
      const dash = /^[—–]/.test(rest.slice(ys[k].index! + w.length));
      if (bare !== w || dash || k === ys.length - 1) {
        end = ys[k].index! + bare.length;
        words = k + 1;
        break;
      }
    }
    if (end < 0) continue;
    // A second choice that stops on a describing word stopped inside its name ("a bag or small | set
    // of tools"): not clear, left as written. One that runs to a comma or the end is whole ("in
    // cream or pale grey,").
    const lastOfSecond = bareOf(ys[words - 1][0]);
    if (closedByWord && describesTheName(lastOfSecond)) continue;
    // ONE DESCRIBING WORD FOR ANOTHER: a first choice that ends on a word describing the name ("a
    // simple wooden | or metal rail", "faded geometric | or floral print") shares the name the second
    // choice carries, so only that word and the "or" go — keeping the first and dropping the second
    // left "a simple wooden in a modest room" (job 154), "faded geometric in muted tones" (job 163).
    // A second choice opening on "a" or "the" names a whole new thing: not clear, left as written.
    // A second choice ENDING on a describing word is a whole choice like the first, and the usual rule
    // below decides ("in light maple | or dark walnut." — swapping one word left "in light dark
    // walnut", job 295).
    if (describesTheName(prev) && DETERMINER.test(leadBare)) continue;
    const swapOneWord = describesTheName(prev) && words >= 2 && !describesTheName(lastOfSecond);
    // How much of `before` is kept (up to `keep`), the first word it drops, and what follows it.
    let keep = before.length;
    let dropped = x[0];
    let tail: string;
    if (swapOneWord) {
      // An intensifier goes with its word ("very dark | or black beads" → "black beads").
      const intensified =
        x.length >= 2 && /^(?:very|quite|rather|fairly|slightly|really)$/i.test(bareOf(x[x.length - 2][0]));
      dropped = intensified ? x[x.length - 2] : x[x.length - 1];
      keep = clauseAt + dropped.index!;
      tail = rest;
    } else {
      // The longer of the two carries the thing's name ("a coaster | or small ornament", "late autumn
      // | or winter evening light"), and so does the second when the first is one describing word
      // ("a white | or cream,"). A second opening on "a" or "the" would leave two: the first.
      const keepSecond =
        !DETERMINER.test(leadBare) && (words > x.length || (words === x.length && DESCRIBING.test(prev)));
      if (keepSecond) keep = clauseAt + x[0].index!;
      tail = keepSecond ? rest : rest.slice(end);
    }
    let head = before.slice(0, keep);
    if (keep < before.length) {
      // "a white or ivory smoke alarm" → "an ivory smoke alarm"; a sentence keeps its capital.
      head = head.replace(/\b(a|an)(\s+)$/i, (_, art: string, gap: string) => {
        const an = /^[aeiou]/i.test(tail) ? "an" : "a";
        return (/^A/.test(art) ? an.charAt(0).toUpperCase() + an.slice(1) : an) + gap;
      });
      if (/^\s*$|[.!?:;]\s*$/.test(head) && /^[A-Z]/.test(dropped[0])) tail = tail.charAt(0).toUpperCase() + tail.slice(1);
    }
    // "either a stand mixer or a hand whisk" keeps one of them, without its "either".
    const either = /\beither\s+/gi;
    let at = -1;
    for (let e = either.exec(head); e; e = either.exec(head)) if (e.index >= clauseAt) at = e.index;
    if (at >= 0) {
      const after = head.slice(at).replace(/^either\s+/i, "");
      head = head.slice(0, at) + (/^E/.test(head.charAt(at)) ? after.charAt(0).toUpperCase() + after.slice(1) : after);
    }
    return head + tail;
  }
  return text;
}

/**
 * Every split panel named as ONE thing (`oneThingOnly`). A key thing only the dropped choice named
 * is no longer the panel's: the panel is drawn from its thing's pictures (`withSplitMemory`), and
 * those must be of what the panel now shows. `only` limits it to the panels just written. Returns
 * how many changed. Pure apart from mutating `scenes`.
 */
export function oneThingPanels(
  scenes: StoryboardScene[],
  things: KeyThing[] | undefined,
  only?: (s: StoryboardScene) => boolean
): number {
  let n = 0;
  for (const s of scenes) {
    if (!s.hostPresent || !s.splitVisual || (only && !only(s))) continue;
    const one = oneThingOnly(s.splitVisual);
    if (one === s.splitVisual) continue;
    const was = keyThingsIn(s.splitVisual, things).map(t => t.name);
    const now = keyThingsIn(one, things).map(t => t.name);
    s.splitVisual = one;
    if (s.keyThing && was.includes(s.keyThing) && !now.includes(s.keyThing)) {
      s.keyThing = now[0];
      s.buildStage = undefined;
    }
    const others = s.otherKeyThings?.filter(name => name !== s.keyThing && (now.includes(name) || !was.includes(name)));
    s.otherKeyThings = others?.length ? others : undefined;
    n++;
  }
  return n;
}

// ─── Does each split panel show what its line is about? ─────────────────────────────────

/**
 * The panel pass's own rules, sent after `FIT_SYSTEM` (`systemSuffix`, so the line check's rulebook
 * stays one cached block). Neutral examples only: the cases are in the tests.
 */
export const PANEL_FIT_RULES = `

SPLIT PANELS — THIS PASS. Here the only pictures to check are the PANEL lines: a square picture shown
BESIDE the host while the host says the line on camera. CONTEXT lines are pictures already checked
and HOST/OTHER lines are said with nothing beside the host: read both for context, never answer for
them. Judge every PANEL by all the rules above, and also:
- A panel shows NO person: no face, body, hands or arms. When its line is about someone doing
  something, the panel shows the thing it is done to or leaves behind, at rest. A rewrite never puts
  a person or hands in it, so who and other are never set on a panel. The one exception is a body
  part the line is about (hair, skin, nails): it is drawn on the host, close, the face not shown — a
  panel showing it that way is RIGHT; never rewrite it into a product or a part lying on its own.
- A FIGURE OF SPEECH about what the host does or feels ("I lean in a little closer", "that one
  stopped me in my tracks") is never drawn as the empty prop of that action: the panel shows what
  the line is really about.
- A line about an idea with nothing literal to see shows what the idea points at, never the video's
  MAIN thing unless the line names it or clearly refers to it. On a panel the everyday moment that
  carries it is a place or a thing from the script, never a person.
- A panel names ONE thing. A panel that says "X or Y" ("a stand mixer or a hand whisk on the
  counter") is WRONG even when the line itself offers the choice: rewrite it as the one thing the
  line and the pictures around it point at — the one a nearby picture shows, else the first the line
  names.
- A panel shows what ITS line is about: a thing only a neighbouring line talks about, added beside
  or behind the subject, is WRONG — rewrite it without.
- A panel is a real photograph: never a diagram, a cut-open or see-through view, a cross-section or
  a view no camera could take.
A panel is never split or joined. Answer one entry for EVERY PANEL line, with the same JSON.`;

/**
 * Put each panel rewrite on its panel, and ONLY the panel: the host take beside it (its prompt, its
 * angle, its timing) is never touched. The panel's words, the seed a later redraw rewrites from, its
 * key thing (the check's name, else the first the words name — the panel is drawn from that thing's
 * pictures, `withSplitMemory`), the part, named look and words it was tied to while the new words
 * still name them (`tieToTypedWords`), and its stage while it is still of the same thing. A rewrite
 * with a person or hands in it is not used: a panel is person-free beside the host (a body part is
 * drawn on the host by `buildSplitRightScene`, so that one is kept). Returns how many were rewritten.
 * Pure apart from mutating `scenes`.
 */
export function applyPanelFixes(scenes: StoryboardScene[], fixes: PictureFix[], things: KeyThing[] | undefined): number {
  let n = 0;
  for (const f of fixes) {
    const s = scenes[f.id];
    if (!s || !panelCandidate(s)) continue;
    if (f.forbids) s.forbids = f.forbids;
    if (!f.show) continue;
    const bodyPart = BODY_PART_WORDS.test(f.show) && !REAL_HOLDER.test(f.show);
    if (showsPerson(f.show) && !bodyPart) continue;
    const said = withoutNegatedPhrases(f.show);
    const named = keyThingsIn(said, things);
    const primary = (f.thing ? matchKeyThing(f.thing, things ?? []) : null) ?? named[0] ?? null;
    const was = { thing: s.keyThing, stage: s.buildStage };
    tieToTypedWords(s, said, things);
    s.keyThing = primary?.name;
    const others = named.map(t => t.name).filter(name => name !== primary?.name);
    s.otherKeyThings = others.length ? others : undefined;
    s.buildStage = f.stage !== undefined ? f.stage ?? undefined : was.thing === primary?.name ? was.stage : undefined;
    s.splitVisual = f.show;
    s.splitVisualSeed = f.show;
    // Judged again on the new words (`judgeSelfMoving`) before any panel is made to move.
    s.splitSelfMoving = undefined;
    n++;
  }
  return n;
}

/**
 * SPLIT PANELS ARE CHECKED AGAINST THEIR LINES (2026-10-18, the review of jobs 401-407). The line
 * check (`fitPicturesToLines`) runs at voicing, before the host plan, and never read a split's
 * picture half: the panels only exist once `enforceHostSplitMix` has picked them, from each host
 * beat's old cutaway, and the panel rewrite after it (`enhanceBrollPrompts`) answers to the line's
 * words, not to what the line is about. So job 401 scene 26, "When a man like that sits down to
 * write about time, I pull my chair in closer", shipped an empty office chair beside the host — a
 * figure of speech drawn literally, and with no person allowed in a panel, the action became a
 * prop; scene 21, "Your problem is theft…", the video's main prop with no tie to the line; job 406
 * scene 19, "A guided sharpening system or belt sander setup …", two things, one drawn; job 403
 * scene 15 added the next line's subject behind its own. One pass, after the panels are written:
 * every line in order, the panels marked, the same rulebook as the line check plus the panel's own
 * rules (`PANEL_FIT_RULES`), on the same model. Only the panel is rewritten (`applyPanelFixes`),
 * never the host half and never the timing. A batch with no panel costs nothing; any failure
 * changes nothing. Returns how many panels were read and how many rewritten.
 */
export async function fitSplitPanelsToLines(
  scenes: StoryboardScene[],
  opts: { keyThings?: KeyThing[]; subject?: string } = {}
): Promise<{ checked: number; fixed: number }> {
  const BATCH = 80;
  const fixes: PictureFix[] = [];
  let checked = 0;
  for (let from = 0; from < scenes.length; from += BATCH) {
    const lines: string[] = [];
    let panels = 0;
    for (let i = Math.max(0, from - 4); i < Math.min(scenes.length, from + BATCH); i++) {
      const s = scenes[i];
      const said = (s.scriptText ?? "").trim().replace(/\s+/g, " ");
      if (i >= from && panelCandidate(s)) {
        panels++;
        const secs = s.audioDuration ? ` (${s.audioDuration.toFixed(1)} s)` : "";
        lines.push(`#${i} PANEL${secs}: said "${said}" | shows: ${s.splitVisual!.trim()}`);
      } else if (fitCandidate(s)) {
        lines.push(`CONTEXT: said "${said}" | shows: ${s.showSubject ?? s.visualPrompt ?? ""}`);
      } else {
        lines.push(`HOST/OTHER: "${said}"`);
      }
    }
    if (!panels) continue;
    try {
      const r = await invokeClaude({
        systemPrompt: FIT_SYSTEM,
        systemSuffix: PANEL_FIT_RULES,
        userMessage:
          (opts.subject ? `VIDEO SUBJECT: ${opts.subject}\n` : "") +
          (opts.keyThings?.length
            ? `KEY THINGS: ${opts.keyThings.map(k => `${k.main ? "MAIN " : ""}${k.name}: ${k.look}`).join(" | ")}\n`
            : "") +
          `\n${lines.join("\n")}\n\nJSON:`,
        maxTokens: 12000,
        model: FIT_MODEL(),
        effort: planningEffort("FIT_EFFORT"),
        step: "Line check (split panels)",
      });
      fixes.push(...parsePanelFixes(r.text, scenes));
      checked += panels;
    } catch {
      /* a failed check changes nothing */
    }
  }
  return { checked, fixed: applyPanelFixes(scenes, fixes, opts.keyThings) };
}

// ─── Does something in each picture move by itself? ─────────────────────────────────────

/** A yes/no per picture from its own words — the quick model's job. `SELF_MOVING_MODEL` overrides. */
const SELF_MOVING_MODEL = () =>
  process.env.SELF_MOVING_MODEL || "claude-haiku-4-5-20251001";

const SELF_MOVING_SYSTEM = `You read the pictures planned for a video, one per line, and decide for
each whether something in it MOVES BY ITSELF in the moment it shows — movement a camera would catch
over a few seconds with no person causing it: a flame, smoke, steam, flowing or falling water, rain
or snow falling, leaves or grass in the wind, traffic going past.

Say NO when a person would have to move it (a door, a gate, a drawer, a lid, a tool, a pot being
stirred, a page turned), when something that can move is shown still (a parked car, a closed tap, an
unlit stove, a calm pond, a device that only detects or displays), and when nothing moves at all.
When unsure, NO.

Answer with JSON only: {"moving":[the ids that move by themselves]}`;

/** What the judgement reads: every drawn cutaway, and each split screen's right panel. */
function selfMovingCandidates(scenes: StoryboardScene[]): { id: number; text: string; split: boolean }[] {
  const out: { id: number; text: string; split: boolean }[] = [];
  scenes.forEach((s, id) => {
    if (s.hostPresent) {
      if (s.splitVisual) out.push({ id, text: s.splitVisual, split: true });
      return;
    }
    if (s.coverHero || s.assetImageUrl || s.qrHero) return;
    const text = s.showSubject ?? s.visualPrompt;
    if (text) out.push({ id, text, split: false });
  });
  return out;
}

/** Put the answer on the pictures that were asked about (the others keep theirs). Pure. */
export function applySelfMoving(scenes: StoryboardScene[], asked: number[], moving: number[]): void {
  const yes = new Set(moving);
  for (const id of asked) {
    const s = scenes[id];
    if (!s) continue;
    if (s.hostPresent) s.splitSelfMoving = yes.has(id);
    else s.selfMoving = yes.has(id);
  }
}

/** The ids the model says move, kept only when they were asked about. Pure. */
export function parseSelfMoving(text: string, asked: number[]): number[] {
  const parsed = safeParseJSON<any>(text);
  const raw: unknown[] = parsed.success && Array.isArray(parsed.data?.moving) ? parsed.data.moving : [];
  const ok = new Set(asked);
  return raw.map(pictureId).filter((n): n is number => n != null && ok.has(n));
}

/**
 * A picture number as a model writes it back: 12, "12" or "#12" (the lines it read are written
 * "#12:" and it copies that about half the time — every "#" id used to be dropped, so a whole
 * film's moving shots vanished on Hank's and Frederick's jobs 265/266). Null otherwise. Pure.
 */
export function pictureId(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string") {
    const m = /^\s*#?\s*(\d+)\s*$/.exec(v);
    return m ? Number(m[1]) : null;
  }
  return null;
}

/**
 * Judge, for every picture and split panel, whether something in it moves by itself (2026-10-01,
 * the operator: "a door needs hand so it should not move … i much prefer not [specific]"). It
 * replaced a fixed word list. One call per ~150 pictures; a batch that fails leaves its pictures
 * unjudged — the plan gate then turns none of them into a video and keeps a split panel still.
 * Returns how many were judged and how many move.
 */
export async function judgeSelfMoving(
  scenes: StoryboardScene[]
): Promise<{ judged: number; moving: number }> {
  const all = selfMovingCandidates(scenes);
  let judged = 0;
  let moving = 0;
  for (let from = 0; from < all.length; from += 150) {
    const batch = all.slice(from, from + 150);
    const asked = batch.map(c => c.id);
    try {
      const r = await invokeClaude({
        systemPrompt: SELF_MOVING_SYSTEM,
        userMessage: batch
          .map(c => `#${c.id}: ${c.text.replace(/\s+/g, " ").slice(0, 300)}`)
          .join("\n") + "\n\nJSON:",
        maxTokens: 8000,
        model: SELF_MOVING_MODEL(),
        step: "What may be a video",
      });
      const yes = parseSelfMoving(r.text, asked);
      applySelfMoving(scenes, asked, yes);
      judged += asked.length;
      moving += yes.length;
    } catch {
      /* unjudged: nothing in this batch becomes a video */
    }
  }
  return { judged, moving };
}

/**
 * The hook's pictures, joined until each runs at least `HOOK_PICTURE_MIN_SEC` — run on the FINAL
 * lengths, beside `foldSnappedFlashes`. The hook is everything before the host introduces themself
 * (`hostIntro`; with no intro, the first 20 s). Only shot-list pictures that sit next to each other
 * join — never across a host take, a cover or a CTA beat — each into its SHORTER neighbour, and
 * never past `MAX_PICTURE_SEC`. Pure — unit-tested.
 */
export function joinHookPictures(
  scenes: StoryboardScene[],
  sec: (s: StoryboardScene) => number
): { scenes: StoryboardScene[]; changed: boolean } {
  const out = [...scenes];
  // Lengths tracked here: a joined piece has no measured length until the caller re-cuts.
  const len = out.map(sec);
  let introAt = out.findIndex(s => s.hostIntro);
  let hookLen = introAt;
  if (hookLen < 0) {
    hookLen = 0;
    for (let t = 0; hookLen < out.length && t < 20; hookLen++) t += len[hookLen];
  }
  // A list keeps one picture per item even in the hook — it is held, not joined.
  const joinable = (s: StoryboardScene | undefined) =>
    !!s && !s.hostPresent && !!s.wordCut && !s.listCut && !s.coverHero && !s.assetImageUrl && !s.cta && !s.qrHero;
  let changed = false;
  for (let i = 0; i < hookLen; i++) {
    const s = out[i];
    if (!joinable(s) || len[i] <= 0 || len[i] >= HOOK_PICTURE_MIN_SEC) continue;
    const options = [i - 1, i + 1].filter(
      j => j >= 0 && j < hookLen && joinable(out[j]) && len[j] + len[i] <= MAX_PICTURE_SEC
    );
    if (options.length === 0) continue;
    const into = options.sort((a, b) => len[a] - len[b])[0];
    const lo = Math.min(i, into);
    out.splice(lo, 2, joinPieces(out[lo], out[lo + 1], len[lo], len[lo + 1]));
    len.splice(lo, 2, len[lo] + len[lo + 1]);
    hookLen--;
    if (introAt >= 0) introAt--;
    changed = true;
    // Look at the joined picture again: it may still be under the minimum.
    i = lo - 1;
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, changed };
}

/**
 * Pictures the shot list marked `sameShot` (the context did not change) play as ONE picture with
 * the picture before them — across beats too, since the storyboard cut the script into beats by
 * length, not by topic — as long as the joined picture stays within `maxAt` for where it starts
 * (`pictureMaxSecAt`). The first picture's look is kept: it is the one being continued. Past the
 * limit the later picture is a different VIEW of the topic (`OTHER_VIEWS`), whether it was marked
 * `sameShot` or only repeats the words before it. Never a host take, a list item, a CTA/cover/asset
 * beat or a split. Run on the FINAL lengths beside `foldSnappedFlashes`. Pure — unit-tested.
 */
/** Two shot descriptions of the same thing (case, punctuation and spacing aside). Pure. */
/**
 * Two descriptions of nearly the same picture: nearly every meaningful word of the shorter one is
 * in the longer one (≥ 85%, 4+ words), or it says outright "same view/shot/picture". Pure.
 */
export const nearlySameSubject = (a: string, b: string): boolean => {
  if (/\bsame (?:view|shot|picture|angle|frame)\b/i.test(b)) return true;
  const stop = new Set(["a", "an", "the", "of", "in", "on", "at", "with", "and", "its", "it", "to", "by", "same", "view"]);
  const words = (t: string) =>
    new Set(t.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w && !stop.has(w)));
  const [x, y] = [words(a), words(b)];
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (small.size < 4) return false;
  let hit = 0;
  small.forEach(w => big.has(w) && hit++);
  return hit / small.size >= 0.85;
};

export const sameSubject = (a: string, b: string): boolean => {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return !!norm(a) && norm(a) === norm(b);
};

/** A description's own topic: any view `withView` added (`OTHER_VIEWS`) taken off. Pure. */
export const topicWords = (text: string | undefined): string => withView(text ?? "", "");

/**
 * `b` describes the same topic as `a`: the same or nearly the same words once any view is taken off
 * — a topic past its limit ("…, a close-up of one detail of it filling the frame"), a split
 * picture's later part, or the planner repeating its own words. Pure.
 */
export const repeatsTopic = (a: string | undefined, b: string | undefined): boolean => {
  const [x, y] = [topicWords(a), topicWords(b)];
  return !!x.trim() && !!y.trim() && (sameSubject(x, y) || nearlySameSubject(x, y));
};

export function joinSameContext(
  scenes: StoryboardScene[],
  sec: (s: StoryboardScene) => number,
  maxAt: (s: StoryboardScene) => number = () => MAX_PICTURE_SEC
): { scenes: StoryboardScene[]; changed: boolean } {
  const out = [...scenes];
  const len = out.map(sec);
  const joinable = (s: StoryboardScene | undefined) =>
    !!s &&
    !s.hostPresent &&
    !!s.wordCut &&
    !s.listCut &&
    !s.splitVisual &&
    !s.coverHero &&
    !s.assetImageUrl &&
    !s.cta &&
    !s.qrHero;
  let changed = false;
  // How many views of one topic have been shown so far along a chain of same-topic pictures.
  const views = new Map<StoryboardScene, number>();
  // The words a picture had before this pass gave it a view: a third picture repeating them is still
  // the same topic as the second, and takes the NEXT view instead of going back to the first's.
  const wordsBefore = new Map<StoryboardScene, string>();
  // `b` says exactly what `a` says — as `a` reads now, or as it read before this pass changed it.
  const repeats = (a: StoryboardScene, b: StoryboardScene) =>
    !!b.showSubject && [a.showSubject, wordsBefore.get(a)].some(t => !!t && sameSubject(t, b.showSubject!));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    // The planner repeating the SAME subject for the next shot is the same context too.
    const same = b.sameShot || repeats(a, b);
    // A list's last item and a line right after it that shows the SAME thing are one picture —
    // the list keeps its pace, the picture just stays (Dale's 3-min test, job 230: "furniture on
    // Marketplace" then the identical driveway picture again, 1.8 s + 3.9 s).
    // NEARLY the same wording counts too: Dale's job 248 had "The honey-stained bookcase standing
    // alone in the concrete driveway" then "The honey-stained bookcase standing alone in the
    // driveway, same view" — one word apart, so the exact test missed it.
    const listRunsOn =
      !!a.listCut &&
      !b.listCut &&
      joinable({ ...a, listCut: undefined }) &&
      joinable(b) &&
      !!a.showSubject &&
      (sameSubject(a.showSubject, b.showSubject ?? "") ||
        nearlySameSubject(a.showSubject, b.showSubject ?? ""));
    if (!listRunsOn && (!same || !joinable(a) || !joinable(b))) continue;
    const limit = movingPicture(a) ? Math.min(maxAt(a), MOVING_PICTURE_MAX_SEC) : maxAt(a);
    if (len[i - 1] + len[i] > limit) {
      // Past the limit the topic gets a new picture — a clearly different VIEW of it, never a
      // near-copy of the last one (Mae 12:15: "scarf on a chair" twice in a row).
      // Counted from the picture before's OWN angle when this pass has not seen it, so the
      // rotation keeps its place across passes (job 244 showed "a close-up" twice in a row).
      const view = (views.get(a) ?? viewIndexOf(a.showSubject)) + 1;
      views.set(b, view);
      const seen = viewIndexOf(b.showSubject) > 0;
      // A picture that only REPEATS the words before it needs its view as much as one marked to
      // continue it (job 399 scenes 20-21: two beats' shots planned with the identical description,
      // 11.7 s + 6.3 s past the quarter's 15 s, unmarked — both went to the picture model with the
      // same words and the second came back a tighter crop of the first, one picture for 18 s).
      // Words the picture before shows too are a copy even when they already name a view.
      if (b.showSubject && ((b.sameShot && !seen) || repeats(a, b))) {
        const v = OTHER_VIEWS[(view - 1) % OTHER_VIEWS.length];
        const next = withView(b.showSubject, v);
        if (next !== b.showSubject) {
          if (!wordsBefore.has(b)) wordsBefore.set(b, b.showSubject);
          b.showSubject = next;
          if (b.visualPrompt && !b.visualPrompt.endsWith(v)) b.visualPrompt = withView(b.visualPrompt, v);
          changed = true;
        }
      }
      continue;
    }
    const joined = {
      ...a,
      ...FRESH,
      scriptText: `${(a.scriptText ?? "").trim()} ${(b.scriptText ?? "").trim()}`.trim(),
      narration: firstWords(`${a.scriptText ?? ""} ${b.scriptText ?? ""}`, 8),
      // A longer picture drifts slowly rather than sitting frozen.
      staticShot: len[i - 1] + len[i] >= 8 ? undefined : a.staticShot,
      hostCandidate: a.hostCandidate,
      // Someone at work in either picture stays in the joined one (the host from behind).
      humanPresent: a.humanPresent || b.humanPresent || undefined,
    } as StoryboardScene;
    out.splice(i - 1, 2, joined);
    len.splice(i - 1, 2, len[i - 1] + len[i]);
    // The joined picture is the same view as the one it continues, so the next view rotates on.
    if (views.has(a)) views.set(joined, views.get(a)!);
    if (wordsBefore.has(a)) wordsBefore.set(joined, wordsBefore.get(a)!);
    changed = true;
    i--; // the joined picture may continue into the next one too
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, changed };
}

/**
 * A SAME-TOPIC CHAIN ENDS AT A HOST TAKE (2026-10-18, job 405 scenes 22-24). The same-topic join runs
 * before the host check-ins and the plan gate place their host takes, so a take can land INSIDE a
 * topic: the gate's last-resort glimpse cut the cat-at-the-window close-up in two around "The honest
 * word is crepuscular," and both halves kept the identical words ("…, a close-up of one detail of it
 * filling the frame") — the viewer saw the close-up, the host for 2.6 s, then the same close-up
 * again. Re-checked on the final plan: a picture right after a host take no longer continues the
 * picture before it (`sameShot` dropped — what the viewer saw last is the host), and when its words
 * still repeat the last picture before the take (`repeatsTopic`) it takes the next view after that
 * picture's (`OTHER_VIEWS`), so the two are never drawn from the same words. A picture whose words
 * already name a different view keeps them. Never a list item, split, CTA, cover, asset or QR beat.
 * Returns how many pictures changed. Pure apart from mutating `scenes`.
 */
export function breakTopicsAtHostTakes(scenes: StoryboardScene[]): number {
  const trim = (t: string) => t.replace(/[\s.]+$/, "");
  let changed = 0;
  for (let i = 1; i < scenes.length; i++) {
    const b = scenes[i];
    if (!scenes[i - 1].hostPresent) continue;
    if (b.hostPresent || b.splitVisual || b.listCut || b.coverHero || b.assetImageUrl || b.cta || b.qrHero) continue;
    let did = false;
    if (b.sameShot) {
      b.sameShot = undefined;
      did = true;
    }
    // The last picture the viewer saw: back over full-frame host takes (a split's panel is a picture).
    let j = i - 1;
    while (j >= 0 && scenes[j].hostPresent && !scenes[j].splitVisual) j--;
    const a = j >= 0 && !scenes[j].hostPresent ? scenes[j] : undefined;
    const aWords = a ? a.showSubject ?? a.visualPrompt : undefined;
    const bWords = b.showSubject ?? b.visualPrompt;
    if (aWords && bWords && repeatsTopic(aWords, bWords)) {
      const was = viewIndexOf(trim(aWords));
      const own = viewIndexOf(trim(bWords));
      if (own === 0 || own === was) {
        const v = OTHER_VIEWS[was % OTHER_VIEWS.length];
        if (b.showSubject) b.showSubject = withView(b.showSubject, v);
        if (b.visualPrompt) b.visualPrompt = withView(b.visualPrompt, v);
        did = true;
      }
    }
    if (did) changed++;
  }
  return changed;
}

/**
 * The shortest a picture cut out of one line may run (2026-10-02, the operator on Dale's job 288:
 * "Number five. Sell your furniture | on Facebook Marketplace." came out as 2.1 s of the bookcase and
 * 1.9 s of a phone — "rather than splitting it, it is best to just make it one b-roll").
 */
export const SPLIT_PART_MIN_SEC = 3;

/**
 * Two pictures that split ONE sentence, either of them under `SPLIT_PART_MIN_SEC`, become one picture
 * (`joinedLine`) — the line check then writes it to show what the whole line is about, the things it
 * names together. Never a list item (each item keeps its own picture however short), the host, a
 * CTA, cover, asset, QR or split beat, and never past the picture's limit (`maxAt`). Run on the final
 * lengths. Pure — returns a new list.
 */
export function joinShortSplits(
  scenes: StoryboardScene[],
  sec: (s: StoryboardScene) => number,
  maxAt: (s: StoryboardScene) => number = () => MAX_PICTURE_SEC
): { scenes: StoryboardScene[]; changed: boolean } {
  const out = [...scenes];
  const len = out.map(sec);
  const joinable = (s: StoryboardScene | undefined) =>
    !!s &&
    !s.hostPresent &&
    !s.listCut &&
    !s.splitVisual &&
    !s.coverHero &&
    !s.assetImageUrl &&
    !s.cta &&
    !s.qrHero;
  const endsSentence = (t: string | undefined) => /[.!?]["')\]]?\s*$/.test((t ?? "").trim());
  let changed = false;
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    if (!joinable(a) || !joinable(b) || endsSentence(a.scriptText)) continue;
    if (Math.min(len[i - 1], len[i]) >= SPLIT_PART_MIN_SEC) continue;
    const limit =
      movingPicture(a) || movingPicture(b) ? Math.min(maxAt(a), MOVING_PICTURE_MAX_SEC) : maxAt(a);
    if (len[i - 1] + len[i] > limit) continue;
    // The longer part's picture until the line check writes the joined one.
    const keep = len[i] > len[i - 1] ? b : a;
    const joined = {
      ...keep,
      ...FRESH,
      scriptText: `${(a.scriptText ?? "").trim()} ${(b.scriptText ?? "").trim()}`.trim(),
      narration: firstWords(`${a.scriptText ?? ""} ${b.scriptText ?? ""}`, 8),
      joinedLine: true,
      sameShot: a.sameShot,
      wordCut: a.wordCut || b.wordCut,
      hostCandidate: a.hostCandidate,
      humanPresent: a.humanPresent || b.humanPresent || undefined,
    } as StoryboardScene;
    out.splice(i - 1, 2, joined);
    len.splice(i - 1, 2, len[i - 1] + len[i]);
    changed = true;
    i--;
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, changed };
}

/** The most words of a sentence's start that move on to the picture of that sentence. */
export const SENTENCE_START_MAX_WORDS = 4;
/** …and the longest they may run: on the voice when the word timeline knows, else their share of the picture. */
export const SENTENCE_START_MAX_SEC = 1.5;

/**
 * A SENTENCE STARTS ON ITS OWN PICTURE (2026-10-20, job 414 scenes 28-29). The storyboard cuts the
 * script into beats by word count, and one beat ended three words into a sentence: "…and tall,
 * straight tulip poplar was a favorite. Green wood splits | and shifts as it dries, so a new wall
 * opens small cracks its first year." — "Green wood splits" (1.2 s) played over the standing trees and
 * the cracked wall arrived on "and shifts", late, partway into its sentence. The shot list cuts pieces
 * only inside a beat, and the joins move only whole pieces, so nothing moved a beat's cut onto the
 * sentence start. When a picture ends on the first words of a sentence the next picture goes on with —
 * at most `SENTENCE_START_MAX_WORDS` words and `SENTENCE_START_MAX_SEC` — those words go to the next
 * picture, so it comes up as the sentence begins. Only between two drawn pictures of DIFFERENT beats:
 * a cut the shot list placed inside one beat is its choice (a shot starts on the word that names its
 * thing). Never the host (a host take hands over mid-sentence on purpose, and a take that starts
 * mid-sentence is the plan gate's), a list item or a list's group picture (the lists keep their own
 * cuts), a split, CTA, cover, asset or QR beat; never when the picture before would be left under
 * `SPLIT_PART_MIN_SEC` or 4 words, and never past the next picture's limit (`maxAt`). Run on the final
 * lengths; the caller re-cuts the ranges. Pure — returns a new list and how many moved.
 */
export function carrySentenceStarts(
  scenes: StoryboardScene[],
  sec: (s: StoryboardScene) => number,
  maxAt: (s: StoryboardScene) => number = () => MAX_PICTURE_SEC,
  /**
   * How long a picture's last `n` words run on the voice, when the word timeline knows
   * (`lastWordsSec`). A share of the picture's seconds spreads its pauses over every word: job 414's
   * "Green wood splits" ran 1.21 s on the voice and its share of the 11.6 s picture reads 1.40 s,
   * while a few words drawn out read shorter by share than they run.
   */
  tailSecOf?: (s: StoryboardScene, n: number) => number | undefined
): { scenes: StoryboardScene[]; moved: number } {
  const out = [...scenes];
  const movable = (s: StoryboardScene | undefined): s is StoryboardScene =>
    !!s &&
    !s.hostPresent &&
    !s.listCut &&
    !s.listSet &&
    !s.splitVisual &&
    !s.coverHero &&
    !s.assetImageUrl &&
    !s.showsBook &&
    !s.cta &&
    !s.qrHero;
  const len = out.map(sec);
  let moved = 0;
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    if (!movable(a) || !movable(b)) continue;
    // The shot list's own cut inside one beat.
    if (a.shotGroup !== undefined && a.shotGroup === b.shotGroup) continue;
    const text = (a.scriptText ?? "").trim();
    if (!text || SENTENCE_END.test(text)) continue;
    const spans = tokenSpans(text);
    let at = -1;
    for (let k = spans.length - 1; k > 0 && spans.length - k <= SENTENCE_START_MAX_WORDS; k--)
      if (startsSentenceAt(text, spans, k)) {
        at = k;
        break;
      }
    if (at < 0) continue;
    // The sentence's words from the space after its full stop (an opening quote goes with them).
    const gap = text.slice(spans[at - 1].end, spans[at].start);
    const from = spans[at - 1].end + gap.search(/\s/);
    const lead = text.slice(from).trim();
    // A sentence opens on a capital or a number — "approx. two" is no new one.
    if (!/^[^A-Za-z0-9]*[A-Z0-9]/.test(lead)) continue;
    const aSec = len[i - 1];
    if (!(aSec > 0)) continue;
    const heard = a === scenes[i - 1] ? tailSecOf?.(a, spans.length - at) : undefined;
    const leadSec = heard !== undefined && heard > 0 ? heard : ((spans.length - at) / spans.length) * aSec;
    if (leadSec > SENTENCE_START_MAX_SEC) continue;
    if (at < 4 || aSec - leadSec < SPLIT_PART_MIN_SEC) continue;
    const limit = movingPicture(b) ? Math.min(maxAt(b), MOVING_PICTURE_MAX_SEC) : maxAt(b);
    if (len[i] + leadSec > limit) continue;
    const head = text.slice(0, from).trim();
    const tail = `${lead} ${(b.scriptText ?? "").trim()}`.trim();
    out[i - 1] = { ...a, ...FRESH, scriptText: head, narration: firstWords(head, 8) } as StoryboardScene;
    out[i] = { ...b, ...FRESH, scriptText: tail, narration: firstWords(tail, 8) } as StoryboardScene;
    len[i - 1] = aSec - leadSec;
    len[i] += leadSec;
    moved++;
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, moved };
}

/**
 * How long a range's last `n` words run on the voice: from where the `n`-th word from its end begins
 * (of the words heard starting inside it) to the range's end. Undefined when the timeline holds no
 * more than `n` words there — too few to tell which are the last. A number written in digits is one
 * word heard for several said ("$1,500"), which only reaches further back and reads longer: never a
 * lead let through for being shorter than it is. Pure.
 */
export function lastWordsSec(
  words: readonly { start: number; end: number }[] | null | undefined,
  range: { startSec: number; endSec: number } | undefined,
  n: number
): number | undefined {
  if (!words?.length || !range || n < 1) return undefined;
  const inside = words.filter(w => w.start >= range.startSec - 0.05 && w.start < range.endSec);
  if (inside.length <= n) return undefined;
  return range.endSec - inside[inside.length - n].start;
}

/**
 * SAME TOPIC, SAME PICTURE (2026-09-28, the operator: "if the context is still the same no need to
 * change the shots"). The shot list plans 12 beats at a time and only JOINS two pictures when it
 * marked them `same` or wrote the identical description, so a run of lines about one thing still
 * changed picture every few seconds whenever the wording differed — Mae's scarf section (job 219,
 * 12:00-13:40) was 12 pictures of one scarf, "scarf on a chair" twice in a row among them, and
 * Hannah's nine-patch 6 pictures with 2 s and 3 s flashes. After the final lengths are known, ONE
 * call reads every picture in order and marks where the thing being talked about actually changes;
 * a run of lines on one topic becomes one picture (`show`, written to cover all of them), marked
 * `sameShot` so `joinSameContext` joins it within the quarter's limit — past the limit the next
 * line keeps its own picture, which is a different view of the same thing. Lists, the host, CTAs,
 * the cover, assets and splits are never in a run. Any failure changes nothing.
 */
const CONTEXT_SYSTEM = `You are the picture editor of a talking-head video. Between the host's
on-camera moments the viewer sees one PICTURE at a time while the narrator talks. You get the
pictures in film order: what is said under each, how long it runs, and what it currently shows.

Mark where the CONTEXT changes. The context is the one thing being talked about — an object, a
project, an activity, a place. Consecutive lines are ONE picture only when one still photo can
honestly show every line at the same moment: what the thing is, what it looks like, why it sells,
what it earns. A new context starts when the talk moves to a different thing. A story that moves on
— one moment, then the next ("the box sat by the door for a week… then I thought, why not paint
it") — is different moments: each keeps its own picture, even when they are about the same thing.
A picture of someone DOING something (cutting, painting, sewing) belongs only to the lines that say
it is being done.

Keep lines separate when they are about different things (worn bedsheets, then a spool of thread),
and when a line is a clear new point about something else. A line that names something you can SEE
that the group's picture would not show (a different place, a different object, or a new kind of
event or situation — "the fire that starts while the house is asleep", "the storms that roll in at
night") is NOT in the group — it keeps its own picture, even in the middle of a topic. Never group
across a "----" line. A line that rules something out ("never…", "don't…", "instead of…", "I don't
mean…", "keep it away from…") is grouped only when the group's picture shows the right way, and that
picture never shows or names what any of its lines rules out — not even with "without" or "away from".
Lines that COMPARE are never one group: one place, time or way set against another ("in most
kitchens… in a camper…", "whereas", "unlike", "instead,", "while in…"), or a line saying a place is
empty or has none next to a line where the thing is there ("the shelf is bare… a jar stands there").
One still shows only one side, and that side under the other side's words gives the point away.

The group's picture must fit the FIRST line of the group above all: it is what plays when the
picture appears. A thing a line names stays with that line: a short lead-in line that names a thing
you can see ("Grab a pencil.", "Put the kettle on.") is never given the picture of the line after it —
when the group's picture would not show what a line names, that line is not in the group.

For each group of 2 or more consecutive pictures that share a context, write ONE picture that fits
every line in it: plain words, what is literally in the frame, like a snapshot caption. It is ONE
still moment from ONE spot: the main thing being done or shown, plus at most one other thing in the
background. Never "or", never a sequence of actions ("painting, then hanging it"), never two
places. If every
picture in the group shows the host doing the work, the new picture shows that work too. Keep exact names of kinds (a herringbone path, a dovetail joint).
${NOTHING_CUT_OPEN_RULE}

Answer with JSON only:
{"groups":[{"ids":[12,13,14],"show":"..."}]}
Only list groups of 2+. Ids must be consecutive. No group: {"groups":[]}.`;

/** A cutaway rendered as a VIDEO rather than a photo (the pipeline's own test). */
const movingPicture = (s: StoryboardScene) =>
  !s.hostPresent && !s.stillImage && (!!s.humanPresent || !!s.objectMotion);
/**
 * The longest a VIDEO picture may run: the video model renders at most 15 s (APIMART grok's cap,
 * `BROLL_CLIP_MAX_SEC`), and a longer one would freeze on its last frame. Past it, a topic
 * continues from another view, like any picture past its quarter's limit.
 */
export const MOVING_PICTURE_MAX_SEC = 15;

/** A picture that may share a context with its neighbours (not the host, a list item or a CTA). */
const contextCandidate = (s: StoryboardScene | undefined) =>
  !!s &&
  !s.hostPresent &&
  !s.listCut &&
  !s.splitVisual &&
  !s.coverHero &&
  !s.assetImageUrl &&
  !s.cta &&
  !s.qrHero &&
  !s.showsBook;

/** Whether a picture shows someone at work (the host, their hands) rather than a thing on its own. */
export const atWork = (s: StoryboardScene | undefined) =>
  !!s && (!!s.humanPresent || showsPerson(s.showSubject ?? s.visualPrompt ?? ""));

/** The runs of consecutive candidate pictures (2+), as scene indexes. Pure. */
export function contextRuns(scenes: StoryboardScene[]): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  scenes.forEach((s, i) => {
    if (contextCandidate(s)) cur.push(i);
    else {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    }
  });
  if (cur.length > 1) runs.push(cur);
  return runs;
}

export type ContextGroup = { ids: number[]; show: string };

/**
 * The model's groups, kept only when they are real: 2+ consecutive ids inside ONE run, not
 * overlapping another group, with a picture description, and not spanning a comparison
 * (`contrastAcross`). Anything else is dropped. Pure.
 */
export function parseContextGroups(
  text: string,
  runs: number[][],
  /** Each candidate picture's own description, by scene position — see `namesSomethingElse`. */
  showOf?: (i: number) => string | undefined,
  /** Whether a candidate picture shows someone at work, by scene position — see below. */
  atWorkOf?: (i: number) => boolean,
  /** What is said under each candidate picture, by scene position — see `contrastAcross`. */
  saidOf?: (i: number) => string | undefined
): ContextGroup[] {
  const parsed = safeParseJSON<any>(text);
  const raw: unknown[] =
    parsed.success && Array.isArray(parsed.data?.groups) ? parsed.data.groups : [];
  const runOf = new Map<number, number>();
  runs.forEach((r, k) => r.forEach(i => runOf.set(i, k)));
  const used = new Set<number>();
  const out: ContextGroup[] = [];
  for (const g of raw as { ids?: unknown; show?: unknown }[]) {
    const ids = Array.isArray(g?.ids)
      ? g.ids.map(pictureId).filter((n): n is number => n != null)
      : [];
    const show = typeof g?.show === "string" ? g.show.trim().slice(0, 400) : "";
    if (ids.length < 2 || !show) continue;
    const run = runOf.get(ids[0]);
    const ok = ids.every(
      (id, k) =>
        run !== undefined &&
        runOf.get(id) === run &&
        !used.has(id) &&
        (k === 0 || id === ids[k - 1] + 1)
    );
    if (!ok) continue;
    // A picture that names something the group's picture does not show keeps its own picture: the
    // group is cut there, and each side of the cut that is still 2+ pictures stays a group
    // (Hank's job 258: "…the lattice you see in Japanese sliding doors" was swallowed by a group of
    // notch-cutting shots).
    // And a picture of someone DOING something never shares a picture with a thing on its own: the
    // group is cut where the two meet (Hank's job 332: "Now the winner. Charred cedar incense
    // holders… the can by the trash bin… why not drill a hole in one" became ONE 17 s picture of the
    // drilling, because the last line's hands had to stay in the group's picture).
    // And a picture of a thing its own line names keeps it when the group's picture leaves it out
    // (`losesNamedThing`, job 413: "Pull up a stool." under the phone call of the line after it).
    const runsOf: number[][] = [[]];
    ids.forEach((id, k) => {
      const turns = !!atWorkOf && k > 0 && atWorkOf(id) !== atWorkOf(ids[k - 1]);
      if (
        showOf &&
        (namesSomethingElse(showOf(id), show) || (!!saidOf && losesNamedThing(showOf(id), saidOf(id), show)))
      )
        runsOf.push([]);
      else if (turns) runsOf.push([id]);
      else runsOf[runsOf.length - 1].push(id);
    });
    for (const part of runsOf) {
      if (part.length < 2) continue;
      // Pictures of a thing on its own never take a group picture of someone at work: that is a
      // later line's moment, and each keeps its own picture instead.
      if (atWorkOf && !part.some(atWorkOf) && showsPerson(show)) continue;
      // Lines that compare are never one picture, and the whole part goes: the model wrote ONE
      // picture across both sides and nothing says which side it shows (job 408, scenes 2-3: the
      // reveal's bin, under "In most American bathrooms, it is empty"). Each line keeps its own
      // picture, which the line check then holds to its line.
      if (saidOf && contrastAcross(part.map(id => saidOf(id) ?? ""))) continue;
      part.forEach(id => used.add(id));
      out.push({ ids: part, show });
    }
  }
  return out;
}

/**
 * Whether a picture's own description names a THING the group's picture does not show: most of the
 * meaningful words of what it shows (`shownThing`) are missing from the group's description. Pure.
 */
export function namesSomethingElse(own: string | undefined, group: string): boolean {
  const stop = new Set(["a", "an", "the", "of", "and", "with", "its", "it", "her", "his", "their", "some", "one", "two", "three"]);
  const words = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 2 && !stop.has(w));
  const thing = words(shownThing(own ?? ""));
  if (thing.length === 0) return false;
  const inGroup = new Set(words(group));
  const missing = thing.filter(w => !inGroup.has(w) && !inGroup.has(w.replace(/s$/, ""))).length;
  return missing / thing.length > 0.5;
}

/** Words that name no thing of the line's own: people, and the words every picture shares. */
const NOT_A_NAMED_THING = new Set([
  "the", "and", "with", "its", "his", "her", "their", "some", "one", "two", "three", "this", "that", "these", "those",
  "your", "our", "out", "off", "over", "into", "onto", "from", "for", "about", "just", "very", "all", "each", "every",
  "down", "back", "around", "away", "here", "there", "now", "then", "still", "under", "first", "last", "next",
  "more", "most", "less", "much", "many", "few", "other", "same", "whole", "good", "best", "you", "they", "them",
  "host", "hand", "hands", "man", "woman", "person", "people", "someone", "fingers", "arm", "arms",
  "thing", "things", "way", "kind", "lot", "bit", "part", "piece", "time", "day", "year", "place", "side", "view",
  "close", "detail", "frame", "picture", "shot", "photo",
]);
/** A word that opens a thing's name in a spoken line: "a stool", "the kettle", "your city office". */
const THING_OPENER = /^(?:a|an|the|this|that|these|those|my|your|our|his|her|their|its|some|each|every|another)$/;

/**
 * A THING A LINE NAMES STAYS WITH THAT LINE (2026-10-20, job 413 scenes 10 and 15). The same-topic
 * call can hand a short lead-in line the NEXT line's picture: "Pull up a stool. One piece of
 * housekeeping first: license rules change town by town," played over the phone call of "…spend two
 * minutes on the phone with your city office.", while the stool was drawn 9 s earlier over "Here's
 * tonight's deal:". `namesSomethingElse` reads only the words before where a thing is or what it does
 * (`shownThing`), so "the host on a stool at the workbench" reads as "the host" — in every picture of
 * the host at work, the phone call's too. So: when the picture's own words draw a thing its LINE names
 * (said there in a noun phrase — "a stool", "the kettle", "your city office" — never a describing or
 * doing word, never a person) and more than half of those things are missing from the group's
 * picture, the line keeps its own picture. Pure.
 */
export function losesNamedThing(own: string | undefined, said: string | undefined, group: string): boolean {
  const words = (t: string) =>
    t
      .toLowerCase()
      .replace(/[’']s\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(w => w.length > 2 && !NOT_A_NAMED_THING.has(w));
  const stem = (w: string) => w.replace(/(?:es|s)$/, "");
  // The things the line names: the two words after "a", "the", "your"… ("Pull up a stool" = stool).
  const toks = tokenSpans(said ?? "").map(t => t.tok);
  const inLine = new Set<string>();
  toks.forEach((t, k) => {
    if (!THING_OPENER.test(t)) return;
    for (const w of toks.slice(k + 1, k + 3)) if (w.length > 2 && !NOT_A_NAMED_THING.has(w)) inLine.add(stem(w));
  });
  // A thing's own name: never a describing word (a colour, a material, a size) or a doing word.
  const named = words(topicWords(own)).filter(
    w => inLine.has(stem(w)) && !describesTheName(w) && !/(?:ing|ed|ly)$/.test(w)
  );
  if (named.length === 0) return false;
  const inGroup = new Set(words(group).map(stem));
  const missing = named.filter(w => !inGroup.has(stem(w))).length;
  return missing / named.length > 0.5;
}

/**
 * A clause opening on a word that sets it against what came before. Bare "but" is not one ("it
 * looks simple, but it took a week" is one picture); "but in …" is a second setting, unless it is
 * only a figure of speech. "instead of …" holds both sides itself, and a line that rules something
 * out has its own rule in CONTEXT_SYSTEM.
 */
const CONTRAST_OPENER =
  /^(?:whereas|unlike|by contrast|in contrast|on the other hand|compared (?:to|with)|as opposed to|while (?:in|at|on|across|over)\b|instead\b(?!\s+of)|but (?:in|across|throughout) (?!(?:the end|fact|time|truth|short|general|practice|theory|a way|any case|the meantime)\b))/i;
/** A clause opening on a turn: counts only when it then says the place is empty. */
const TURN_OPENER = /^(?:but|yet|instead|however|though)\b/i;
/**
 * A place said to be EMPTY ("it is empty", "stands bare", "nothing there", "there are none",
 * "Empty."). Never a figure of speech — on the local films "there's nothing a farmhouse kitchen goes
 * through faster", "the cost is nothing at all" and "make it do, or do without" were not empty places.
 */
const SAID_EMPTY = [
  /(?:\b(?:is|are|was|were|be|been|stands?|stood|sits?|sat|stays?|stayed|remains?|remained|lies?|lay|looks?|looked|goes|went|left|leaves?|kept|keeps?|it|them)|'s|'re)\s+(?:(?:usually|often|mostly|always|still|just|completely|totally|entirely|almost|nearly|simply|quite|again)\s+)*(?:empty|bare|vacant)\b/i,
  /\bnothing\s+(?:\w+\s+)?(?:there|here|in it|on it)\b|\bthere(?:'s| is| was| are| were)\s+(?:nothing|none)(?=\s*(?:[.,;:!?]|$|there\b|here\b|left\b|in it\b|on it\b))|\bnone (?:there|at all)\b/i,
  /\b(?:leave|leaves|left|keep|keeps|kept)\s+(?:(?:that|this|the|their|its|our|your|my)\s+)?(?:[\w-]+\s+){1,2}(?:empty|bare|vacant)\b/i,
  /\b(?:go|goes|went|gone)\s+without\s+(?:a|an|one|any|it|them)\b/i,
  /^(?:empty|bare|nothing|none)\W*$/i,
];
/**
 * A clause that still says something is NOT there, in any words ("and nobody sees another robin
 * until spring", job 404): after an empty place it continues the absence, it does not show the thing.
 */
const SAYS_NONE = /\b(?:no|nobody|none|nothing|never|not|without|empty|bare|vacant)\b|n't\b/i;
/**
 * A clause that puts a thing THERE ("a small bin stands there", "there is a basket", "you'll find a
 * hook"). After an empty place only that is the other side: "At least, that's what just about
 * everybody figures" after "the grass sits empty" (job 404) is a comment, not the thing.
 */
const SAYS_THERE =
  /\bthere(?:'s| is| are| was| were)\s+(?:a|an|one|some|always|usually|often)\b|\b(?:you(?:'ll| will)?|we|they|people)\s+(?:find|see|keep|put)\s+(?:a|an|one|some)\b|\b(?:a|an|one|some)\s+(?:[\w-]+\s+){0,4}?(?:stands?|stood|sits?|sat|hangs?|hung|lies?|lay|waits?|rests?|is|are|was|were)\s+(?:right\s+)?(?:there|here|on|in|by|beside|next to|against|under|beneath|behind)\b/i;
/**
 * A named place or time after "in…": "in most American homes", "in a German bathroom", "in March".
 * Never someone's place ("in Ann's kitchen" names a person, not where the comparison is).
 */
const PLACE_IN =
  /\b(?:[Ii]n|[Aa]cross|[Tt]hroughout)\s+(?:(?:most|many|some|all|plenty of|lots of|a lot of|nearly all|almost every|every|a|an|the|our|your|their|these|those|this|that)\s+)*([A-Z][A-Za-z]*(?:\.[A-Z][A-Za-z]*)*\.?)(?!['A-Za-z])/g;
/**
 * A month or a weekday is a TIME, compared only with another time: "the robin you see in January"
 * then "down in Florida" (job 404) is not one place set against another. Read with the full stop
 * `PLACE_IN` keeps for "U.S.": a month that ends its sentence ("I start them in March.") is a time too.
 */
const TIME_NAME =
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\.?$/;
/**
 * Names of one country that do not start alike, so the shared-start rule below cannot see they are
 * one side: "in the U.S." then "in most American homes" is one side, as is "in France" then "in a
 * French kitchen". Only the irregular ones — "Germany"/"German", "Japan"/"Japanese" share a start.
 */
const ONE_COUNTRY: Record<string, string> = {
  us: "america", usa: "america", america: "america", american: "america", americans: "america",
  uk: "britain", britain: "britain", british: "britain",
  france: "france", french: "france",
  spain: "spain", spanish: "spain",
  netherlands: "dutch", holland: "dutch", dutch: "dutch",
  ireland: "ireland", irish: "ireland",
  denmark: "denmark", danish: "denmark",
  finland: "finland", finnish: "finland",
  poland: "poland", polish: "poland",
  wales: "wales", welsh: "wales",
  switzerland: "swiss", swiss: "swiss",
  philippines: "philippines", filipino: "philippines",
};
/** Two names of one place ("America", "American"; "Germany", "German"): one starts the other. */
const samePlace = (a: string, b: string) => {
  const x = a.toLowerCase().replace(/\./g, "");
  const y = b.toLowerCase().replace(/\./g, "");
  if (ONE_COUNTRY[x] && ONE_COUNTRY[x] === ONE_COUNTRY[y]) return true;
  let k = 0;
  while (k < x.length && k < y.length && x[k] === y[k]) k++;
  return k >= Math.min(4, x.length, y.length);
};

/**
 * A CONTRAST IS NOT ONE TOPIC (2026-10-18, job 408 scenes 2-3). The same-topic pass joined
 * "That little stretch of tile between the bowl and the wall. In most American bathrooms," and "it
 * is empty. In a German bathroom, usually, a small bin stands there, with a lid." into one topic and
 * drew the reveal for both, so the bin stood on the floor under the words saying the floor is empty
 * (the same spoiler job 403 had). CONTEXT_SYSTEM asks for a picture that fits the first line, and the
 * model drew the more visual side anyway — so it is held here, in code.
 *
 * Whether these lines, in order, set one side against another ACROSS a line boundary: two different
 * places or times named after "in…" ("in most American homes" … "in a German one"), a clause opening
 * on a contrast ("whereas", "unlike", "by contrast", "on the other hand", "compared to", "while in",
 * "instead", "but in …"), a clause saying a place is empty followed by one that puts a thing there,
 * or a "but / yet / instead / however" clause saying it is empty after one that does not. A
 * comparison wholly inside ONE line is that line's own: its picture faces it joined or not. On the
 * 232 local films' 9,530 neighbouring pictures it fires only on jobs 403 and 408's opening. Pure.
 */
export function contrastAcross(lines: string[]): boolean {
  const texts = lines.map(l => (l ?? "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim());
  let joined = "";
  const lineStarts: number[] = [];
  texts.forEach((t, k) => {
    if (k > 0) joined += " ";
    lineStarts.push(joined.length);
    joined += t;
  });
  const lineAt = (pos: number) => {
    let k = 0;
    while (k + 1 < lineStarts.length && lineStarts[k + 1] <= pos) k++;
    return k;
  };
  // Sentences, then clauses inside them — cut before a turn or contrast word after a comma.
  type Piece = { text: string; start: number; end: number; sentence: number };
  const sentences: Piece[] = [];
  const clauses: Piece[] = [];
  const add = (into: Piece[], from: number, to: number, sentence: number) => {
    const raw = joined.slice(from, to);
    const text = raw.trim();
    if (!text) return;
    const start = from + raw.indexOf(text);
    into.push({ text, start, end: start + text.length, sentence });
  };
  const sentenceEnd = /[.!?;:]["')\]]*\s+|\s*[—–]\s*/g;
  let from = 0;
  Array.from(joined.matchAll(sentenceEnd)).forEach(m => {
    add(sentences, from, m.index! + m[0].length, sentences.length);
    from = m.index! + m[0].length;
  });
  add(sentences, from, joined.length, sentences.length);
  const clauseCut =
    /,\s+(?=(?:but|yet|whereas|while|unlike|instead|however|though|compared|as opposed|by contrast|in contrast|on the other hand)\b)/gi;
  sentences.forEach((s, n) => {
    let at = s.start;
    Array.from(joined.slice(s.start, s.end).matchAll(clauseCut)).forEach(m => {
      add(clauses, at, s.start + m.index! + m[0].length, n);
      at = s.start + m.index! + m[0].length;
    });
    add(clauses, at, s.end, n);
  });
  // A contrast counts when what it compares — from the sentence holding the one side to the end of
  // the sentence holding the other — runs over more than one line.
  const across = (n: number, m: number) =>
    lineAt(sentences[n].start) !== lineAt(sentences[m].end - 1);
  const saysEmpty = (t: string) => SAID_EMPTY.some(r => r.test(t));
  for (let k = 1; k < clauses.length; k++) {
    const a = clauses[k - 1];
    const b = clauses[k];
    // The thing may come after one short aside ("…leave that shelf bare. Mine? A row of jars…").
    const c = clauses[k + 1];
    const there = (x: Piece | undefined) =>
      !!x && across(a.sentence, x.sentence) && !SAYS_NONE.test(x.text) && SAYS_THERE.test(x.text);
    const aside = b.text.split(/\s+/).length <= 3 && !SAYS_THERE.test(b.text);
    if (saysEmpty(a.text) && (there(b) || (aside && there(c)))) return true;
    if (!across(a.sentence, b.sentence)) continue;
    const opens = b.text.replace(/^[^A-Za-z]+/, "");
    if (CONTRAST_OPENER.test(opens)) return true;
    if (!saysEmpty(a.text) && saysEmpty(b.text) && TURN_OPENER.test(opens)) return true;
  }
  const sentenceAt = (pos: number) => {
    const n = sentences.findIndex(s => pos >= s.start && pos < s.end);
    return n < 0 ? sentences.length - 1 : n;
  };
  const named = Array.from(joined.matchAll(PLACE_IN), m => ({
    name: m[1],
    sentence: sentenceAt(m.index! + m[0].length - m[1].length),
  }));
  for (const time of [true, false]) {
    const marks = named.filter(p => TIME_NAME.test(p.name) === time);
    for (let k = 1; k < marks.length; k++) {
      const a = marks[k - 1];
      const b = marks[k];
      if (!samePlace(a.name, b.name) && across(a.sentence, b.sentence)) return true;
    }
  }
  return false;
}

/**
 * Mark each group as one picture: its first picture shows `show`, the rest are `sameShot`, so
 * `joinSameContext` joins them within the quarter's limit. A person in any of them stays in the
 * picture (the host from behind, `markHostBroll`) even if the description lost them — and someone
 * else stays THAT person, never "the host's hands" (2026-10-18, the audit), unless the host is at work
 * in another of the group's pictures. Returns how many pictures were marked to join another. Pure
 * apart from mutating `scenes`.
 */
export function applyContextGroups(scenes: StoryboardScene[], groups: ContextGroup[]): number {
  let marked = 0;
  for (const g of groups) {
    const members = g.ids.map(i => scenes[i]);
    const shows = (s: StoryboardScene) => !!s.humanPresent || showsPerson(s.showSubject ?? "");
    const person = members.some(shows);
    const other = members.find(s => s.otherPerson);
    const theirs = person && !!other && !members.some(s => shows(s) && !s.otherPerson);
    const show =
      person && !showsPerson(g.show)
        ? theirs
          ? `${g.show}, with ${other!.otherPerson} in the picture`
          : `${g.show}, with the host's hands at work on it`
        : g.show;
    // ONE TOPIC, ONE SHOT (the operator: "1 topic/context 1 video or 1 photo"): a VIDEO when
    // anything in the topic is being done, else a PHOTO — never a photo then a video of one thing.
    // The kind still passes the rule every shot follows (`safeMotion`: only hands at work or a
    // thing that moves by itself may move). Every member carries it, so a topic that runs past
    // its limit continues as the same kind, from another view.
    const doing = members.filter(movingPicture);
    // A topic with a tool going into the material in it is a photo, every view of it — and so is
    // one with a person in it: a video never shows hands (`videoKind`).
    const contact = members.some(s => s.toolContact);
    const motion =
      doing.length === 0 ? "none" : videoKind(show, "object", { person, contact });
    // The key thing most of the group shows is the group's.
    const counts = new Map<string, number>();
    for (const s of members) if (s.keyThing) counts.set(s.keyThing, (counts.get(s.keyThing) ?? 0) + 1);
    const thing = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    const stage = groupStage(members);
    members.forEach((s, k) => {
      s.showSubject = show;
      s.visualPrompt = show;
      s.stillImage = motion === "none";
      s.humanPresent = person ? true : undefined;
      s.otherPerson = theirs ? other!.otherPerson : undefined;
      s.otherPeople = theirs ? other!.otherPeople : undefined;
      s.objectMotion = motion !== "none" ? true : undefined;
      s.cameraMove = undefined;
      s.keyThing = thing;
      s.buildStage = stage;
      s.toolContact = contact ? true : undefined;
      if (k > 0) {
        s.sameShot = true;
        marked++;
      }
    });
  }
  return marked;
}

/**
 * The build stage of a same-topic group's ONE picture: the stage most of its pictures carry, the
 * later one on a tie — a later stage keeps the memory a picture had before stages existed, so a
 * group the planner labelled unevenly never loses a reference it would have had. No member with a
 * stage ⇒ none. Pure.
 */
export function groupStage(members: StoryboardScene[]): BuildStage | undefined {
  const counts = new Map<BuildStage, number>();
  for (const s of members) if (s.buildStage) counts.set(s.buildStage, (counts.get(s.buildStage) ?? 0) + 1);
  let best: BuildStage | undefined;
  for (const st of BUILD_STAGES) {
    const n = counts.get(st) ?? 0;
    if (n > 0 && n >= (best ? counts.get(best)! : 0)) best = st;
  }
  return best;
}

/**
 * The one call (see CONTEXT_SYSTEM). `sec` is each scene's final length. Returns how many pictures
 * were marked to join the one before; 0 on any failure, which changes nothing.
 */
export async function markSameContext(
  scenes: StoryboardScene[],
  opts: { sec: (s: StoryboardScene) => number; subject?: string }
): Promise<number> {
  const runs = contextRuns(scenes);
  if (runs.length === 0) return 0;
  const lines: string[] = [];
  runs.forEach((run, k) => {
    if (k > 0) lines.push("----");
    for (const i of run) {
      const s = scenes[i];
      lines.push(
        `#${i} [${opts.sec(s).toFixed(1)}s] said: "${(s.scriptText ?? "").trim()}" | shows: ${s.showSubject ?? s.visualPrompt ?? ""}`
      );
    }
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await invokeClaude({
        systemPrompt: CONTEXT_SYSTEM,
        userMessage:
          (opts.subject ? `Video subject: ${opts.subject}\n\n` : "") +
          `Pictures:\n${lines.join("\n")}`,
        maxTokens: 16000,
        model: SHOT_LIST_MODEL(),
        effort: planningEffort("CONTEXT_EFFORT"),
        step: "Same-topic groups",
      });
      return applyContextGroups(
        scenes,
        parseContextGroups(
          r.text,
          runs,
          i => scenes[i]?.showSubject ?? scenes[i]?.visualPrompt,
          i => atWork(scenes[i]),
          i => scenes[i]?.scriptText
        )
      );
    } catch {
      /* try once more */
    }
  }
  return 0;
}

/**
 * After the final snap onto real pauses, a shot-list piece under its OWN floor is folded into a
 * neighbour — a list item under `LIST_SHOT_MIN_SEC`, any other picture under `SHOT_MIN_SEC`. The
 * guard used to fold only blinks under 0.3 s, so Hannah's "that's about a dollar and thirty cents"
 * shipped at 0.99 s (settled at 1.4, snapped down) and the pipeline froze it to its 1.2 s floor.
 */
const snappedFloor = (s: StoryboardScene) =>
  s.listCut ? LIST_SHOT_MIN_SEC : SHOT_MIN_SEC;

/**
 * The last guard, run on the FINAL (pause-snapped) lengths: `settleShots` measured every piece
 * before the snap, and the snap can still squeeze a quick list item to nothing — Granny Ruth's
 * "and thread" came out 0.14 s. Such a piece joins the picture before it (else after it), keeping
 * the longer one's picture. Returns the new list (renumbered) and whether anything changed, so the
 * caller measures once more. Pure — unit-tested.
 */
export function foldSnappedFlashes(
  scenes: StoryboardScene[],
  sec: (s: StoryboardScene) => number
): { scenes: StoryboardScene[]; changed: boolean } {
  const out = [...scenes];
  let changed = false;
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (!s.wordCut || s.hostPresent || sec(s) <= 0 || sec(s) >= snappedFloor(s)) continue;
    const prev = out[i - 1];
    const next = out[i + 1];
    // Never INTO a list item (`mergeable`); the beat's own neighbour first, then the picture before
    // or after it from another beat — Dale's job 293 folded "Today I'm ranking" into "Etsy," and
    // the joined piece lost Etsy's own picture.
    const fits = (n: StoryboardScene | undefined, sameBeat: boolean) =>
      !!n && !n.hostPresent && mergeable(n, s) && (!sameBeat || n.shotGroup === s.shotGroup);
    const into = fits(prev, true)
      ? i - 1
      : fits(next, true)
        ? i + 1
        : fits(prev, false)
          ? i - 1
          : fits(next, false)
            ? i + 1
            : -1;
    if (into < 0) {
      // Between two list items neither neighbour takes it — but the item after it can lead with it
      // and keep its own picture (`leadIntoItem`).
      if (leadInBetweenItems(out, i)) {
        out.splice(i, 2, leadIntoItem(s, out[i + 1]));
        changed = true;
        i = Math.max(-1, i - 1);
      }
      continue;
    }
    const [a, b] = into < i ? [out[into], s] : [s, out[into]];
    out.splice(Math.min(i, into), 2, joinPieces(a, b, sec(a), sec(b)));
    changed = true;
    i = Math.max(-1, Math.min(i, into) - 1);
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, changed };
}

/** The CTA's fixed frames: the big QR, the book cover, an operator's asset. Never folded, never a fold's target. */
const fixedFrame = (s: StoryboardScene | undefined) =>
  !!s && (!!s.qrHero || !!s.coverHero || !!s.assetImageUrl);

/** Two beats on the same side of every CTA edge (a fold never carries words across one). */
const sameSide = (a: StoryboardScene, b: StoryboardScene) =>
  (a.cta === true) === (b.cta === true) && a.ctaIndex === b.ctaIndex;

/**
 * A short lead-in BETWEEN two items of a spoken list: "So tonight," | "If" | "Then" between one item
 * and the next (production job 200 #184, "So tonight," 0.80 s before "walk over to that front door,";
 * of the 16 sub-second non-list pictures in the audit's production snapshot, 14 sat strictly between
 * two items). Nothing may be merged INTO a list item (`mergeable` — the joined piece would lose the
 * item's picture), so the folds left it as a sub-second picture of its own. Only BETWEEN two items:
 * a lead-in before a list's first item still joins the picture before it (Dale's job 293, "Today
 * I'm ranking"). The caller decides it is under its floor. Pure.
 */
export function leadInBetweenItems(scenes: StoryboardScene[], i: number): boolean {
  const s = scenes[i];
  const item = (n: StoryboardScene | undefined) =>
    !!n && !!n.listCut && !n.hostPresent && !fixedFrame(n);
  return (
    !!s &&
    !s.hostPresent &&
    !s.listCut &&
    !fixedFrame(s) &&
    item(scenes[i - 1]) &&
    item(scenes[i + 1]) &&
    sameSide(s, scenes[i + 1])
  );
}

/**
 * The lead-in spoken at the head of the item after it: the item keeps its OWN picture, subject and
 * list mark — never `joinPieces`' longer-wins rule, under which a 0.8 s lead-in in front of a 0.5 s
 * item would take the item's picture (the Dale job 293 failure again). The words lead into the item
 * ("So tonight, walk over to that front door,"), so its picture arrives with them. Pure.
 */
export function leadIntoItem(lead: StoryboardScene, item: StoryboardScene): StoryboardScene {
  const text = `${(lead.scriptText ?? "").trim()} ${(item.scriptText ?? "").trim()}`.trim();
  return {
    ...item,
    ...FRESH,
    scriptText: text,
    narration: firstWords(text, 8),
    listCut: true,
  } as StoryboardScene;
}

/**
 * A beat the voice gives NO time at all: its range is measured and is this long or shorter. The
 * aligner allows a scene whose end equals its start when the transcript hears its words inside a
 * neighbour's — a repeated word heard once (production job 236 #79-#81: "teakettle," "teakettle,"
 * "teakettle." each 0.000 s), a digit group, a word the transcriber dropped — and every guard after
 * it skipped zero as "not measured yet", so the paid picture played as one frame.
 */
export const UNSEEN_BEAT_SEC = 0.01;

/** A beat's length on the master narration's clock, or undefined while it has no range. Pure. */
export const rangeSec = (s: StoryboardScene): number | undefined =>
  Number.isFinite(s.narrationStartSec) && Number.isFinite(s.narrationEndSec)
    ? (s.narrationEndSec as number) - (s.narrationStartSec as number)
    : undefined;

const wordSet = (t: string | undefined) => new Set(tokenSpans(t ?? "").map(x => x.tok));

/**
 * Where an unseen beat's words go: a neighbour saying the SAME words first (the repeat the
 * transcript heard once — production job 215: "piano," 0.054 s then "piano," 0.000 s), else the
 * neighbour of its own kind before it (a picture or list item for a picture, a host take for a host
 * take), else the one after, else the other kind, else any neighbour (a lead-in between two items
 * leads into the one after). Never a QR, cover or asset beat, never the QR block's release beat (its
 * last words pin the block's end on the voice), and never across a CTA edge. The target keeps its
 * own picture, so a list item may take it. -1 when nothing may. Pure.
 */
export function unseenFoldTarget(scenes: StoryboardScene[], i: number): number {
  const s = scenes[i];
  if (!s || fixedFrame(s)) return -1;
  const can = (n: StoryboardScene | undefined): n is StoryboardScene =>
    !!n && !fixedFrame(n) && !n.qrTail && sameSide(s, n);
  const own = wordSet(s.scriptText ?? s.narration);
  const same = (n: StoryboardScene | undefined) => {
    if (!can(n) || !own.size) return false;
    const theirs = wordSet(n.scriptText ?? n.narration);
    return theirs.size === own.size && Array.from(own).every(t => theirs.has(t));
  };
  // A picture is joined into the way every fold joins one (`mergeable`); a host take always may be.
  const takes = (n: StoryboardScene) => !!n.hostPresent || mergeable(n, s);
  const ownKind = (n: StoryboardScene | undefined) =>
    can(n) && !!n.hostPresent === !!s.hostPresent && takes(n);
  const otherKind = (n: StoryboardScene | undefined) =>
    can(n) && !!n.hostPresent !== !!s.hostPresent && takes(n);
  const order: [(n: StoryboardScene | undefined) => boolean, number][] = [
    [same, -1],
    [same, 1],
    [ownKind, -1],
    [ownKind, 1],
    [otherKind, -1],
    [otherKind, 1],
    [can, 1],
    [can, -1],
  ];
  for (const [ok, d] of order) if (ok(scenes[i + d])) return i + d;
  return -1;
}

/**
 * EVERY BEAT CAN BE SEEN (2026-10-18, the audit's production snapshot: 11 beats of 0.000 s in 6
 * jobs, 9 of them list items). A beat whose measured length is `UNSEEN_BEAT_SEC` or less has its
 * words joined into a neighbour (`unseenFoldTarget`), which keeps its own picture, list mark and
 * timing — those words had no time of their own, so nothing seen changes and a picture nobody would
 * see is not paid for. A host take that takes an unseen host beat keeps its intro/anchor roles.
 * `measured` is the beat's length, or undefined while it has none (a piece just joined): only a
 * MEASURED zero is folded. Run on the final lengths at voicing; `unplaced` are the unseen beats left
 * (a QR, cover or asset beat, or one with no neighbour that may take it) — the plan gate names them
 * on the job. Pure — returns a new list, renumbered.
 */
export function foldUnseenBeats(
  scenes: StoryboardScene[],
  measured: (s: StoryboardScene) => number | undefined
): { scenes: StoryboardScene[]; changed: boolean; joined: number; unplaced: StoryboardScene[] } {
  const out = [...scenes];
  const unseen = (s: StoryboardScene) => {
    const m = measured(s);
    return m != null && m <= UNSEEN_BEAT_SEC;
  };
  let joined = 0;
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (!unseen(s)) continue;
    const into = unseenFoldTarget(out, i);
    if (into < 0) continue;
    const t = out[into];
    const [a, b] = into < i ? [t, s] : [s, t];
    const text = `${(a.scriptText ?? "").trim()} ${(b.scriptText ?? "").trim()}`.trim();
    const host = !!t.hostPresent;
    out.splice(Math.min(i, into), 2, {
      ...t,
      scriptText: text,
      narration: firstWords(text, 8),
      hostIntro: t.hostIntro || (host && s.hostIntro) || undefined,
      hostProtected: t.hostProtected || (host && s.hostProtected) || undefined,
    } as StoryboardScene);
    joined++;
    // Looked at again: the same-words neighbour may have had no time either (two of three repeats).
    i = Math.max(-1, Math.min(i, into) - 1);
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, changed: joined > 0, joined, unplaced: out.filter(unseen) };
}

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
import type { KeyThing, StoryboardScene } from "@shared/types";
import { invokeClaude } from "./claude";
import { safeParseJSON } from "./jsonRepair";
import { SHOWS_PERSON } from "./hostLook";

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
 * reach the name, and only what comes AFTER it counts against `HOST_PART_MAX_SEC`. Pure.
 */
export function wordsAfterName(text: string, hostName?: string): number {
  const toks = tokenSpans(text).map(t => t.tok);
  const name = tokenSpans(hostName ?? "").map(t => t.tok);
  if (!name.length) return toks.length;
  for (let i = toks.length - name.length; i >= 0; i--) {
    if (name.every((w, k) => toks[i + k] === w)) return toks.length - (i + name.length);
  }
  return toks.length;
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
  return items.every(p => LIST_ITEM_START.test(p) && p.split(/\s+/).length <= 8) ? items : null;
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

/** The shot shows hands (or fingers) — never allowed to move in a video. */
export const SHOWS_HANDS = /\b(hands?|fingers?|thumbs?|palms?|wrists?)\b/i;
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
    SHOWS_PERSON.test(show)
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
  shot: Pick<PlannedShot, "show" | "motion" | "list" | "same" | "contact" | "held" | "thing" | "text" | "print">,
  k: number
): StoryboardScene {
  // A video only of a big thing (`videoKind`): never hands, a held thing, or a tool going in.
  const motion = videoKind(shot.show, shot.motion, {
    person: !!shot.held,
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
    humanPresent: shot.held || SHOWS_PERSON.test(shot.show) ? true : undefined,
    objectMotion: moving ? true : undefined,
    cameraMove: undefined,
    keyThing: shot.thing || undefined,
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
  const nameToks = tokenSpans(opts.hostName ?? "").map(t => t.tok);
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
      if (s.hostIntro && nameToks.length) {
        const said = spans.slice(0, hostEnd).map(t => t.tok);
        const hasName = said.some(
          (_, i) =>
            i + nameToks.length <= said.length &&
            nameToks.every((w, k) => said[i + k] === w)
        );
        if (!hasName) {
          out.push(s);
          continue;
        }
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
 * non-host picture whose every comma piece reads as a list item. Pure — returns a new list.
 */
export function splitListPieces(scenes: StoryboardScene[]): StoryboardScene[] {
  const out: StoryboardScene[] = [];
  for (const s of scenes) {
    const text = (s.scriptText ?? "").trim();
    const items = text.match(/[^,;]+[,;]?/g)?.map(x => x.trim()).filter(Boolean) ?? [];
    if (s.hostPresent || items.length < 2 || !items.every(anyListItem)) {
      out.push(s);
      continue;
    }
    const where = /\b(?:on|in|at|beside|by|near) the [^,]+$/i.exec(s.showSubject ?? "")?.[0];
    items.forEach((item, k) => {
      const bare = item.replace(/^(?:and|or|plus|maybe|then|also)\s+/i, "").replace(/[,.;]$/, "");
      const show = `${bare}${where ? ` ${where}` : ""}`;
      out.push({
        ...s,
        ...FRESH,
        scriptText: item,
        narration: item,
        showSubject: show,
        visualPrompt: show,
        visualPromptSeed: undefined,
        stillImage: true,
        objectMotion: undefined,
        humanPresent: undefined,
        keyThing: undefined,
        otherKeyThings: undefined,
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
  return !NOT_A_LIST_ITEM.has(words[0].replace(/[^a-z]/gi, "").toLowerCase());
}

/** Either shape of list item. */
const anyListItem = (t: string | undefined) => looksLikeListItem(t) || looksLikeBareListItem(t);

/**
 * Mark every run of two or more consecutive pictures of one beat that each read as a list item
 * (`looksLikeListItem`), or one such picture beside a piece the planner already marked, as
 * `listCut` — so no fold, join or flash rule ever merges one item into another, whatever the
 * planner remembered to mark. Returns how many it newly marked. Pure apart from mutating `scenes`.
 */
export function markListPieces(scenes: StoryboardScene[]): number {
  let n = 0;
  const item = (s: StoryboardScene | undefined) =>
    !!s && !s.hostPresent && (s.listCut === true || anyListItem(s.scriptText));
  for (let i = 0; i < scenes.length; ) {
    if (!item(scenes[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < scenes.length && item(scenes[j + 1]) && scenes[j + 1].shotGroup === scenes[i].shotGroup) j++;
    const run = scenes.slice(i, j + 1);
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

/**
 * A piece another may be merged INTO: never a list item (unless the piece merged is itself a list
 * item squeezed to a blink), whose own picture the join would lose
 * (Dale's job 293: a 1 s "Today I'm ranking" folded into "Etsy," and Etsy's picture was gone).
 * Every step that folds a too-short piece into a neighbour asks this — the shot list's settle, the
 * pause-snap fold and the plan gate. Pure.
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
  for (let k = 0; k < n; k++) {
    const from = spans[bounds[k]].start;
    const to = k + 1 < n ? spans[bounds[k + 1]].start : text.length;
    const slice = text.slice(from, to).trim();
    // A split of ONE topic must not look like the same photo twice: each later part is a clearly
    // different VIEW of the same thing, named in its own subject so `joinSameContext` never folds
    // it back into the first.
    const variant = ["", ...OTHER_VIEWS][k % 4];
    const subject = s.showSubject ?? s.visualPrompt;
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

const SHOT_LIST_SYSTEM =
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
  "thing out of habit (a line about the weather shows the weather). A later shot of a key thing " +
  "shows the SAME thing from another " +
  "spot — closer on one part, further back with the room around it, the other side, from above or " +
  "low down — the view the words point at, never the same view as the shot of it just before. A " +
  "before / during / after of one piece is the SAME piece each time, further along.\n" +
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
  "5c. WRITING ONLY WHEN SAID. A picture may show readable writing ONLY when the line itself says " +
  "the exact words or number printed on a thing (\"the tag says HANDMADE\" = the tag with HANDMADE " +
  "on it): set text to exactly those words, spelled as spoken. Never invent any: when a line talks " +
  "about printing on a thing without saying it (\"check the date on it\", \"three things printed on " +
  "the box\"), show the thing WITH its printing and set print: \"blurred\" — the print is there, soft " +
  "and out of focus, unreadable.\n" +
  "5b. APPS. When the words name an app, a website or selling online, the shot is a phone lying on " +
  "a table (or in the host's hands) with its screen showing a simple buy-and-sell app — a grid of " +
  "small photos of items. Never a brand or app name in show: any named app or site is written as " +
  "what it is (\"a buy-and-sell app\", \"an online shop\").\n" +
  "6. PEOPLE. The only person who may ever appear is THE HOST (described below, when given), and " +
  "only DOING the work — seen from behind or from the side, over the shoulder, hands at the task, " +
  "face turned away or out of frame. Never a face, never anyone else. With no host given, only " +
  "bare hands at the work.\n" +
  "6b. SAFETY. A line that warns about a danger shows the SAFE way — the guard in place, a push " +
  "stick, hands well back, the iron set down on its heel, the extinguisher by the bench — never " +
  "the danger itself (no fingers near a blade or a needle, no open flame on the work, nobody hurt).\n" +
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
  "shows the host's hands on it, and it is a photo. False when the thing simply lies, stands or " +
  "hangs there.\n" +
  "10. from: the first 1-4 words of the shot, copied EXACTLY from the beat, in order. The first " +
  "shot of a non-host beat starts at the beat's first word.\n" +
  "11. show: 8-20 plain words saying what is in the frame, the way a person would caption their " +
  "own phone snapshot: the thing, where it is, and how far away the photo was taken from — vary " +
  "it, often a step or two back, sometimes closer; never a close-up of every thing. The place is " +
  "the one the line names, else the props list's home setting. No light, mood, texture or style " +
  "words, and no decorative extras the words do not mention (\"the old crates stacked by the " +
  'curb in front of the house"). ONE picture: never "or" ("an engraved board or a ' +
  'keepsake box" — pick one), never two places.\n' +
  "12. NAME IT EXACTLY. When the words name a SPECIFIC kind, pattern or design — a herringbone " +
  "path, a dovetail joint, a French seam — keep that exact name in show " +
  "and add, in plain words, what it LOOKS like, because the picture generator may not know the " +
  'term: "a herringbone brick path — bricks laid in a zigzag of short rows", never just "a brick ' +
  'path".\n\n' +
  "Return ONLY JSON: " +
  '{"beats":[{"beat":N,"hostUntil":null|"...","shots":[{"from":"...","show":"...","motion":"none","thing":null,"text":null,"print":null,"list":false,"same":false,"contact":false,"held":false}]}]}';

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
        ? `THE HOST (the only person b-roll may show, from behind or the side): ${opts.hostLook}\n`
        : "") +
      (opts.sheet ? `PROPS LIST:\n${opts.sheet}\n` : "") +
      (prior.length ? `SHOTS JUST BEFORE THIS BATCH: ${prior.join(" | ")}\n` : "") +
      `\n${lines.join("\n")}\n\nJSON:`;
    const r = await invokeClaude({
      systemPrompt: SHOT_LIST_SYSTEM,
      userMessage,
      maxTokens: SHOT_MAX_TOKENS,
      model: SHOT_LIST_MODEL(),
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
          text: typeof x.text === "string" ? x.text : undefined,
          print: x.print === "blurred" ? "blurred" : undefined,
          list: x.list === true,
          same: x.same === true,
          contact: x.contact === true,
          held: x.held === true,
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

const CONTINUITY_SYSTEM =
  "You read a narration script for a faceless YouTube video and write its PROPS LIST: every " +
  "physical thing that is shown more than once — the things being made, the key tools and " +
  "materials, the recurring places — and exactly how each looks, so a picture generator draws " +
  "it the same way in every shot. One line each: `name: look` (material, colour, size, finish, " +
  "where it usually sits) — always tidy: never describe anything as cluttered, messy or crowded. " +
  "The first line is the HOME setting (the workshop, kitchen, sewing room) " +
  "the video returns to. The SECOND line is the MAIN thing — the one physical thing the whole video " +
  "is about (what is made, used, sold or shown most) — written `MAIN name: look`. 6-14 lines. Plain words, no brands, no people. NOTHING WITH MARKS ON IT: " +
  "never list a chalk tally, a chalkboard, a sign, a price tag, a label, a calendar, a notebook, a " +
  "ledger or anything written or counted on — the pictures carry no writing, so such a prop would " +
  "put writing in every shot that shows it. Output ONLY the list.";

/** The props list for one script (`LongformInputParams.continuitySheet`). "" on any failure. */
export async function deriveContinuitySheet(
  script: string,
  opts: { subject?: string; styleBible?: string } = {}
): Promise<string> {
  // Room for the model's own thinking ahead of the list: at 1200 the thinking could spend the whole
  // budget and the call came back with no text (Hannah's real render, job 163) — and one retry.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await invokeClaude({
        systemPrompt: CONTINUITY_SYSTEM,
        userMessage:
          (opts.subject ? `Video subject: ${opts.subject}\n` : "") +
          (opts.styleBible ? `Visual direction: ${opts.styleBible}\n` : "") +
          `\nScript:\n${script.slice(0, 60000)}\n\nPROPS LIST:`,
        maxTokens: 16000,
        model: SHOT_LIST_MODEL(),
      });
      const sheet = r.text
        .split("\n")
        .map(l => l.replace(/^[-*•\d.)\s]+/, "").trim())
        .filter(l => l.includes(":"))
        .slice(0, 16)
        .join("\n");
      if (sheet) return sheet;
    } catch {
      /* try once more */
    }
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
  const lines = (sheet ?? "").split("\n").map(l => l.trim()).filter(l => l.includes(":"));
  for (const line of lines.slice(1)) {
    const at = line.indexOf(":");
    let name = line.slice(0, at).trim();
    const look = line.slice(at + 1).trim();
    const main = /^MAIN\b/i.test(name);
    name = name.replace(/^MAIN\b[\s:-]*/i, "").trim();
    if (!name || out.some(t => keyName(t.name) === keyName(name))) continue;
    out.push({ name, look, ...(main && !out.some(t => t.main) ? { main: true as const } : {}) });
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
A picture marked "FIRST of the MAIN thing" must show the main thing IN USE when it is naturally used
with smoke, steam, a flame or water (lit, steaming, burning, running) — otherwise it is WRONG. A picture is RIGHT when it shows the thing the line is
about — even when the line only says "it", "this one" or "the one that…" (use the KEY THINGS and the
lines around it to know what that is) — or shows the thing being done, or (marked "continues") keeps
showing the topic of the line before it.

Go through EVERY picture, one at a time, never skipping: first write what its line is about — its
subject, not its last noun; for a line that only refers to a key thing, name the key thing — then
whether the picture shows that, where the line puts it. Only then decide.

"The one that…", "the winner", "the one I was proudest of" is one of the THINGS the video counts or
compares (a project, a product, a choice) — work out which from the whole script, usually named in
a later line. What it "came out of", was "made from" or "started as" is its material, never its
subject: "the one that sold best came out of a box of scraps" is about that winning thing, shown with
the box of scraps beside it.

A line that compares to something ELSE you can see — "the kind you see in …", "like the ones at …",
"the kind you'd find in …" — ALWAYS gets that other thing as its own picture: SPLIT the line there.
Give the exact first 2-5 words where the new picture starts, copied from the line, and what it shows.
Split only when both parts are at least 4 words. Never split a picture marked "joined".

ONE IDEA, ONE PICTURE. A picture marked "same sentence" continues a sentence the picture before it
started. When the two parts are ONE idea about one thing — the thing and where, how or what it is
used, sold or kept ("Sell your furniture | on Facebook Marketplace", "I hang them in the hallway, |
next to the mirror") — set join: true and write show: the ONE picture for the whole sentence. Keep
them apart only when the second part moves on to a genuinely different thing worth its own picture.

A picture marked "joined", or one you join, shows the WHOLE line in ONE picture — what the line is
really pointing at: the new thing it names when that is its point (a comparison: "it's the same wood
they make baseball bats from" = the baseball bats), the main thing when the line is about it, or the
things together when they belong together (the bookcase as a listing on a phone's buy-and-sell app).
For a "joined" picture shows_it is false unless it already shows that.

For each WRONG picture write the picture that fits: plain words, what is literally in the frame, one
moment, one place, like a snapshot caption. When the line is about a key thing, name it exactly as
the KEY THINGS list writes it and set thing to that name. When something in that moment moves by
itself with no person moving it (a flame, smoke, steam, water), say it is happening. When the
picture is the MAIN thing and it is something naturally in use with smoke, steam, a flame or water,
show it in use — lit, steaming, burning, running — because that is the moment worth a video. The
FIRST picture of the MAIN thing that
shows it idle when it is naturally in use that way is WRONG too: rewrite it in use. No writing, no logos,
no faces, never "or".

Answer with JSON only, one entry for EVERY picture:
{"pictures":[{"id":7,"about":"...","shows_it":true},
{"id":8,"about":"...","shows_it":false,"show":"...","thing":null,"split":[{"from":"exact words","show":"...","thing":null}]},
{"id":9,"about":"...","shows_it":false,"join":true,"show":"...","thing":null}]}
show and thing only when shows_it is false or join is true; split only when a new picture must start;
join only on a picture marked "same sentence".`;

/** A new picture starting inside a line, at `from` (its first words, verbatim). */
export type PictureSplit = { from: string; show: string; thing?: string };
export type PictureFix = {
  id: number;
  show?: string;
  thing?: string;
  split?: PictureSplit[];
  /** This picture and the one before it are ONE idea of one sentence: make them one picture. */
  join?: boolean;
};

/** The pictures the fit check reads and may fix — drawn cutaways, never the CTA, cover or assets. */
const fitCandidate = (s: StoryboardScene) =>
  !s.hostPresent && !s.cta && !s.qrHero && !s.coverHero && !s.assetImageUrl && !s.showsBook && !s.splitVisual;

/**
 * The model's fixes, kept only for candidate pictures: a rewrite where it said the picture does not
 * show what its line is about, and any split. Reads the per-picture answer (`pictures`) and the older
 * list of fixes (`fix`). Pure.
 */
export function parsePictureFixes(text: string, scenes: StoryboardScene[]): PictureFix[] {
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
    if (id == null || !scenes[id] || !fitCandidate(scenes[id])) continue;
    if (out.some(x => x.id === id)) continue;
    const join = f?.join === true;
    const show = f?.shows_it === false || join ? clean(f?.show) : "";
    const split: PictureSplit[] = (Array.isArray(f?.split) ? f.split : [])
      .map((x: any) => ({ from: clean(x?.from), show: clean(x?.show), thing: clean(x?.thing) || undefined }))
      .filter((x: PictureSplit) => x.from && x.show);
    if (!show && !split.length && !join) continue;
    out.push({
      id,
      ...(join ? { join } : {}),
      ...(show ? { show } : {}),
      ...(show && typeof f?.thing === "string" && f.thing ? { thing: f.thing } : {}),
      ...(split.length ? { split } : {}),
    });
  }
  return out;
}

/**
 * Put each fix on its picture: the new description, its key thing (the planner's name matched to
 * the list, else the ones the description names), a person only if one is in it, and the video rule
 * applied again. Returns how many pictures changed. Pure apart from mutating `scenes`.
 */
export function applyPictureFixes(
  scenes: StoryboardScene[],
  fixes: PictureFix[],
  things: KeyThing[] | undefined
): number {
  let n = 0;
  for (const f of fixes) {
    const s = scenes[f.id];
    if (!s || !f.show) continue;
    const named = keyThingsIn(f.show, things);
    const primary = (f.thing ? matchKeyThing(f.thing, things ?? []) : null) ?? named[0] ?? null;
    s.showSubject = f.show;
    s.visualPrompt = f.show;
    s.visualPromptSeed = undefined;
    s.brollVisual = undefined;
    s.keyThing = primary?.name;
    const others = named.map(t => t.name).filter(name => name !== primary?.name);
    s.otherKeyThings = others.length ? others : undefined;
    s.humanPresent = SHOWS_PERSON.test(f.show) ? true : undefined;
    s.sameShot = undefined;
    s.toolContact = contactToolWork(f.show) ? true : undefined;
    s.blurPrint = !s.pictureText && blurredPrint(f.show) ? true : undefined;
    // Judged again on the new description (`judgeSelfMoving`); the plan gate then makes the ones
    // that move videos within the share, the main thing's first (`addMotion`).
    s.selfMoving = undefined;
    settleVideoKind(s);
    n++;
  }
  return n;
}

/** A line that ends a sentence (so the next picture starts a new one). */
const endsSentence = (t: string | undefined) => /[.!?]["')\]]?\s*$/.test((t ?? "").trim());

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
    } as StoryboardScene;
    if (f!.show) applyPictureFixes([merged], [{ id: 0, show: f!.show, thing: f!.thing }], things);
    out[k] = merged;
    lens[k] += sec(s);
    remap.set(id, k);
    joined++;
  });
  out.forEach((s, i) => (s.index = i + 1));
  return { scenes: out, joined, remap };
}

/**
 * Split pictures where the check says a line names something NEW partway through: the words from
 * `from` on become their own picture showing it (`show`), the part before keeps its picture. A split
 * whose words are not in the line, or that would leave either part under 4 words, is skipped. The
 * new pieces have no timing yet — the caller re-cuts the film's ranges. Pure — returns a new list.
 */
export function applyPictureSplits(
  scenes: StoryboardScene[],
  fixes: PictureFix[],
  things: KeyThing[] | undefined,
  /** A picture's length, when known — no part may run under `SPLIT_PART_MIN_SEC`. */
  sec?: (s: StoryboardScene) => number
): { scenes: StoryboardScene[]; split: number } {
  const byId = new Map(fixes.filter(f => f.split?.length).map(f => [f.id, f.split!]));
  if (!byId.size) return { scenes, split: 0 };
  const out: StoryboardScene[] = [];
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
      starts.push({ at, cut });
      cursor = at;
    }
    const bounds = [0, ...starts.map(x => x.at), spans.length];
    // Each part must run long enough to be its own picture (`SPLIT_PART_MIN_SEC`), judged by its
    // share of the words when the picture's length is known.
    const total = sec?.(s) ?? 0;
    const tooShort = (b: number, k: number) =>
      k > 0 &&
      (b - bounds[k - 1] < 4 ||
        (total > 0 && ((b - bounds[k - 1]) / spans.length) * total < SPLIT_PART_MIN_SEC));
    if (starts.length === 0 || s.joinedLine || bounds.some(tooShort)) {
      out.push(s);
      return;
    }
    bounds.slice(0, -1).forEach((b, k) => {
      const from = spans[b].start;
      const to = k + 1 < bounds.length - 1 ? spans[bounds[k + 1]].start : text.length;
      const slice = text.slice(from, to).trim();
      if (k === 0) {
        out.push({ ...s, ...FRESH, scriptText: slice, narration: firstWords(slice, 8) } as StoryboardScene);
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
        humanPresent: SHOWS_PERSON.test(cut.show) ? true : undefined,
        stillImage: true,
        objectMotion: undefined,
        selfMoving: undefined,
        toolContact: contactToolWork(cut.show) ? true : undefined,
        pictureText: undefined,
        sameShot: undefined,
        listCut: undefined,
        hostCandidate: undefined,
        wordCut: true,
      } as StoryboardScene);
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
 */
export async function fitPicturesToLines(
  scenes: StoryboardScene[],
  opts: {
    sheet?: string;
    keyThings?: KeyThing[];
    subject?: string;
    /** The longest a picture may stay where it sits (`pictureMaxSecAt`) — a join never passes it. */
    maxAt?: (s: StoryboardScene) => number;
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
      lines.push(
        `#${i} PICTURE${secs}${s.sameShot ? " (continues)" : ""}${s.joinedLine ? " (joined)" : ""}${sameSentence ? " (same sentence)" : ""}${i === firstMain ? " (FIRST of the MAIN thing)" : ""}: said "${said}" | shows: ${s.showSubject ?? s.visualPrompt ?? ""}`
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
          `\n${lines.join("\n")}\n\nJSON:`,
        maxTokens: 24000,
        model: FIT_MODEL(),
      });
      fixes.push(...parsePictureFixes(r.text, scenes));
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
  const cut = applyPictureSplits(merged.scenes, moved, opts.keyThings, s => s.audioDuration ?? 0);
  return { scenes: cut.scenes, fixed, split: cut.split, joined: merged.joined };
}

// ─── Does something in each picture move by itself? ─────────────────────────────────────

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
        model: SHOT_LIST_MODEL(),
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
 * (`pictureMaxSecAt`). The first picture's look is kept: it is the one being continued. Never a
 * host take, a list item, a CTA/cover/asset beat or a split. Run on the FINAL lengths beside
 * `foldSnappedFlashes`. Pure — unit-tested.
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
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    // The planner repeating the SAME subject for the next shot is the same context too.
    const same =
      b.sameShot ||
      (!!a.showSubject && sameSubject(a.showSubject, b.showSubject ?? ""));
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
      const seen = OTHER_VIEWS.some(v => (b.showSubject ?? "").endsWith(v));
      if (b.sameShot && b.showSubject && !seen) {
        const v = OTHER_VIEWS[(view - 1) % OTHER_VIEWS.length];
        b.showSubject = withView(b.showSubject, v);
        if (b.visualPrompt && !b.visualPrompt.endsWith(v)) b.visualPrompt = withView(b.visualPrompt, v);
        changed = true;
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
    changed = true;
    i--; // the joined picture may continue into the next one too
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, changed };
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
project, an activity, a place. Consecutive lines about the same thing are ONE context and should be
ONE picture, even when each line mentions a different detail of it (what it is, how it is made, why
it sells, what it earns). A new context starts only when the talk moves to a different thing.

Keep lines separate when they are about different things (worn bedsheets, then a spool of thread),
and when a line is a clear new point about something else. A line that names something you can SEE
that the group's picture would not show (a different place, a different object) is NOT in the group —
it keeps its own picture. Never group across a "----" line.

The group's picture must fit the FIRST line of the group above all: it is what plays when the
picture appears.

For each group of 2 or more consecutive pictures that share a context, write ONE picture that fits
every line in it: plain words, what is literally in the frame, like a snapshot caption. It is ONE
still moment from ONE spot: the main thing being done or shown, plus at most one other thing in the
background. Never "or", never a sequence of actions ("painting, then hanging it"), never two
places. If any
picture in the group shows hands or the host doing something, the new picture MUST show the host's
hands doing that work (a person is never dropped). Keep exact names of kinds (a herringbone path, a dovetail joint).

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
 * overlapping another group, with a picture description. Anything else is dropped. Pure.
 */
export function parseContextGroups(
  text: string,
  runs: number[][],
  /** Each candidate picture's own description, by scene position — see `namesSomethingElse`. */
  showOf?: (i: number) => string | undefined
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
    const runsOf: number[][] = [[]];
    for (const id of ids) {
      if (showOf && namesSomethingElse(showOf(id), show)) runsOf.push([]);
      else runsOf[runsOf.length - 1].push(id);
    }
    for (const part of runsOf) {
      if (part.length < 2) continue;
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

/**
 * Mark each group as one picture: its first picture shows `show`, the rest are `sameShot`, so
 * `joinSameContext` joins them within the quarter's limit. A person in any of them stays in the
 * picture (the host from behind, `markHostBroll`) even if the description lost them. Returns how
 * many pictures were marked to join another. Pure apart from mutating `scenes`.
 */
export function applyContextGroups(scenes: StoryboardScene[], groups: ContextGroup[]): number {
  let marked = 0;
  for (const g of groups) {
    const members = g.ids.map(i => scenes[i]);
    const person = members.some(
      s => s.humanPresent || SHOWS_PERSON.test(s.showSubject ?? "")
    );
    const show =
      person && !SHOWS_PERSON.test(g.show)
        ? `${g.show}, with the host's hands at work on it`
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
    members.forEach((s, k) => {
      s.showSubject = show;
      s.visualPrompt = show;
      s.stillImage = motion === "none";
      s.humanPresent = person ? true : undefined;
      s.objectMotion = motion !== "none" ? true : undefined;
      s.cameraMove = undefined;
      s.keyThing = thing;
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
      });
      return applyContextGroups(
        scenes,
        parseContextGroups(r.text, runs, i => scenes[i]?.showSubject ?? scenes[i]?.visualPrompt)
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
    if (into < 0) continue;
    const [a, b] = into < i ? [out[into], s] : [s, out[into]];
    out.splice(Math.min(i, into), 2, joinPieces(a, b, sec(a), sec(b)));
    changed = true;
    i = Math.max(-1, Math.min(i, into) - 1);
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, changed };
}

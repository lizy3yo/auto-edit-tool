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
import type { StoryboardScene } from "@shared/types";
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
 * the pace it is spoken.)
 */
export const LIST_SHOT_MIN_SEC = 0.4;
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

export type ShotMotion = "hands" | "object" | "none";

export interface PlannedShot {
  /** The first 1–4 words of the shot, verbatim from the beat's text. */
  from: string;
  /** What the picture shows — literal, concrete. */
  show: string;
  motion?: ShotMotion;
  /** One item of a spoken list. */
  list?: boolean;
  /** Shows the same thing as the shot before it — the context did not change. */
  same?: boolean;
  /** A still that stays completely still (no slow zoom). */
  still?: boolean;
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

/**
 * Things that move BY THEMSELVES in real life — the only objects a video may set moving with no
 * hand on them. Anything else, animated, slides and shuffles on its own (Hank's kumiko strips
 * crept across the bench in a split panel), which no viewer believes.
 */
export const MOVES_ON_ITS_OWN =
  /\b(flames?|fire|burning|torch|candles?|smoke|smoking|steam|steaming|water|pour(?:s|ing|ed)?|drip(?:s|ping)?|boil(?:s|ing)?|simmer(?:s|ing)?|splash\w*|rain|wind|breeze|sparks?|ash|embers?|flicker\w*|spinning|spins|lathe|fan|flowing|bubbl\w*|running (?:sewing )?machine|machine needle)\b/i;
/** The shot shows hands (or fingers) — the other thing that may move in a video. */
export const SHOWS_HANDS = /\b(hands?|fingers?|thumbs?)\b/i;

/**
 * Work where a tool must BITE into the material — drilling, sawing, driving a screw, hammering,
 * chiselling, cutting, carving. The video model cannot fake that contact: Norbert's 3-min test
 * (job 236, 2:19) drilled for 10 s with the bit never going in and splintering appearing somewhere
 * else. Gentle hand work (sewing, crocheting, sanding, wiping, folding) comes out fine and stays
 * allowed. Such a shot is a PHOTO, never a video. "Cutting board" is a thing, not the work.
 */
const CONTACT_TOOL_WORK =
  /\b(drill(?:ing|ed)|drills? (?:a |the |into |through )|saw(?:ing|ed)|saws? (?:into|through)|hammer(?:ing|ed)|hammers? (?:a |the |in )|screw(?:ing|ed)|driv(?:e|es|ing) (?:a |the |in )?(?:screws?|nails?)|nail(?:ing|ed)|chisel(?:ing|ed|ling|led)|chisels? (?:into|out)|cut(?:ting|s (?:into|through))|slic(?:es|ed|ing)|chop(?:s|ped|ping)|carv(?:es|ed|ing)|whittl(?:es|ed|ing)|grind(?:s|ing)|planing)\b/i;
/** The ACTION of a tool biting in — a tool merely held or lying there ("holding a chisel") is not. */
export const contactToolWork = (show: string): boolean =>
  CONTACT_TOOL_WORK.test(show.replace(/\bcutting (?:boards?|mats?|tables?)\b/gi, "board"));

/**
 * What may move in a shot of `show`: hands doing the work, or a thing that moves by itself —
 * never an ordinary object on its own. An "object" shot of something that does not move by
 * itself becomes a hands shot when hands are in it, else a still.
 */
export function safeMotion(
  show: string,
  wanted: "hands" | "object" | "none" | undefined
): "hands" | "object" | "none" {
  // A tool biting into material is a photo: the video model drills air (see `contactToolWork`).
  if (wanted && wanted !== "none" && contactToolWork(show)) return "none";
  // A "hands" shot must SHOW hands or a person: Ruth's job 239 got a moving clip of "the dented
  // coffee tin … next to a wastebasket" because the planner said "hands" and nothing checked.
  if (wanted === "hands" && !SHOWS_HANDS.test(show) && !SHOWS_PERSON.test(show)) return "none";
  if (wanted === "object")
    return MOVES_ON_ITS_OWN.test(show) ? "object" : SHOWS_HANDS.test(show) ? "hands" : "none";
  return wanted ?? "none";
}

const firstWords = (text: string, n: number) =>
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

const FRESH = {
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
  shot: Pick<PlannedShot, "show" | "motion" | "list" | "same" | "still" | "contact" | "held">,
  k: number
): StoryboardScene {
  // A tool going into the material is a photo, whatever the motion asked for (see `toolContact`).
  const motion = shot.contact ? "none" : safeMotion(shot.show, shot.motion);
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
    humanPresent: motion === "hands" || shot.held ? true : undefined,
    objectMotion: motion === "object" ? true : undefined,
    toolContact: shot.contact || contactToolWork(shot.show) ? true : undefined,
    visualPrompt: shot.show,
    visualPromptSeed: undefined,
    brollVisual: undefined,
    showSubject: shot.show,
    listCut: shot.list ? true : undefined,
    sameShot: shot.same && !shot.list ? true : undefined,
    // Whether a still zooms is decided by its LENGTH at render (`stillZooms`), not by the planner.
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
  out.forEach((s, i) => (s.index = i + 1));
  return { scenes: out, originals };
}

/** Join two adjacent pieces of one beat; the longer one's picture wins. */
function joinPieces(
  a: StoryboardScene,
  b: StoryboardScene,
  secA: number,
  secB: number
): StoryboardScene {
  const keep = secB > secA ? b : a;
  // Two list items too quick to cut apart become ONE shot of both ("a saw and a drill"), not a
  // picture of whichever was longer — the words still name both.
  const both =
    a.listCut && b.listCut && a.showSubject && b.showSubject
      ? `${a.showSubject}, together with ${b.showSubject}`
      : undefined;
  return {
    ...keep,
    ...FRESH,
    ...(both
      ? { showSubject: both, visualPrompt: both, visualPromptSeed: undefined }
      : {}),
    scriptText: `${(a.scriptText ?? "").trim()} ${(b.scriptText ?? "").trim()}`.trim(),
    narration: firstWords(`${a.scriptText ?? ""} ${b.scriptText ?? ""}`, 8),
    // Two list items joined are still a quick list shot; a list item folded into a longer shot is not.
    listCut: both ? true : undefined,
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
        const prev = k > 0 && !run[k - 1].hostPresent ? k - 1 : -1;
        const next = k + 1 < run.length ? k + 1 : -1;
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
        s.humanPresent = undefined;
        s.objectMotion = undefined;
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
  'literally: "a stack of sandpaper" is a stack of sandpaper; "I pinned the squares into rows" is ' +
  "quilt squares pinned in rows. Use the PROPS LIST for how a recurring thing looks, so it looks the " +
  "same every time, and keep the story moving (what was being made is further along now).\n" +
  "2. CHANGE THE PICTURE ONLY WHEN THE CONTEXT CHANGES. A new shot starts only where the words move " +
  "on to a DIFFERENT thing, place or action. While the words stay on the same thing — even across " +
  'several sentences — it is ONE shot: "a stack of feed sacks my husband set aside for the burn ' +
  'barrel" is one shot of the sacks by the barrel, not the sacks and then the barrel. Fewer, ' +
  "longer shots are better than many quick ones; a shot may run 10 seconds or more when nothing " +
  'new is named. The ONE exception is a spoken list: one quick shot per item ("a needle, a spool ' +
  'of thread, and a pair of shears" = three shots, list: true).\n' +
  "3. SAME AS BEFORE. When a beat's FIRST shot shows the same thing as the shot before it (the " +
  "previous beat is still on that subject), set same: true — it continues that picture instead of " +
  "starting a new one. Use it whenever the context has not changed.\n" +
  "4. A COMPARISON IS NOT A SHOT. When a line compares the subject to something else to say how " +
  'much it costs or what it is like ("yarn that costs more than a good roast"), show the subject.\n' +
  "5. NO WRITING. Never a shot of words, numbers, prices, signs, labels, notes, screens, tally " +
  "marks, chalkboards, calendars or clocks — show the thing the number is about (\"six dollars " +
  'for those coasters" = the coasters; "how long it took" = the work in progress; "the tally I ' +
  'keep" = the finished pieces).\n' +
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
  "words the host says on camera, copied exactly, then list the shots for the rest (\"Out of 10 " +
  'Japanese woodworking projects | you can build from | cheap box-store lumber," — not on to "the ' +
  'coffee can" three phrases later). If the line ' +
  "names nothing to show, hostUntil is null and shots is []. On a HOOK beat (the video's opening " +
  "line) the host says at least the first 6 words on camera, then hands over the same way — to ONE " +
  "picture for the rest of that thought, not a run of quick ones. On an " +
  "INTRO beat the host must say " +
  "their own name on camera first — and once they have, a line that goes on to name things MUST " +
  "hand over (\"I'm Rose Miller, and this is for anybody sitting at a kitchen table with | a " +
  'hook, | a skein of yarn, | and a free evening").\n' +
  "8. motion — MOST SHOTS ARE STILL PICTURES (\"none\"). SHOW IT HAPPENING: when the words are " +
  "about making, using or fixing something, the picture shows the host (or hands) doing it — but " +
  'as a still unless the physical doing is the point of the line right now. Use "hands" (moving ' +
  'hands at gentle work — stitching, crocheting, sanding, oiling) sparingly, and "object" only for a thing ' +
  "that moves by itself (a flame, pouring water, a running machine). About one shot in six moves, " +
  "never more than one in four.\n" +
  "9. static: always false — whether a still zooms is decided later by how long it is on screen.\n" +
  "9b. contact: true when the shot shows a tool CUTTING INTO, GOING THROUGH or JOINING the " +
  "material — in ANY craft or wording: drilling, sawing, a screw or nail going in, stapling, " +
  "punching holes, welding or soldering, piercing, engraving, carving, chiselling, cutting cloth " +
  'or paper. Such a shot is ALWAYS motion "none": a video cannot show a tool really going in. ' +
  "Holding a tool, a tool lying there, and gentle work (sewing, knitting, crocheting, sanding, " +
  "painting, wiping) are false.\n" +
  "9c. held: true when someone must be HOLDING or USING the thing in this shot for it to make " +
  "sense — in any wording: a drill raised to the frame, a hair dryer aimed at the curls, scissors " +
  "poised over the cloth, a phone held up to the screen, a cup lifted to drink. The picture then " +
  "shows the host's hands on it. False when the thing simply lies, stands or hangs there.\n" +
  "10. from: the first 1-4 words of the shot, copied EXACTLY from the beat, in order. The first " +
  "shot of a non-host beat starts at the beat's first word.\n" +
  "11. show: 8-20 plain words saying what is in the frame, the way a person would caption their " +
  "own phone snapshot: the thing, where it is, and how far away the photo was taken from — vary " +
  "it, often a step or two back, sometimes closer; never a close-up of every thing. The place is " +
  "the one the line names, else the props list's home setting. No light, mood, texture or style " +
  "words, and no decorative extras the words do not mention (\"the feed sacks piled beside the " +
  'rusty burn barrel behind the house"). ONE picture: never "or" ("an engraved board or a ' +
  'keepsake box" — pick one), never two places.\n' +
  "12. NAME IT EXACTLY. When the words name a SPECIFIC kind, pattern or design — a nine-patch " +
  "quilt, a granny square, kumiko, a dovetail joint, a French seam — keep that exact name in show " +
  "and add, in plain words, what it LOOKS like, because the picture generator may not know the " +
  'term: "a nine-patch crib quilt — blocks each made of nine small squares, three by three, light ' +
  'and dark alternating", never just "a patchwork quilt".\n\n' +
  "Return ONLY JSON: " +
  '{"beats":[{"beat":N,"hostUntil":null|"...","shots":[{"from":"...","show":"...","motion":"none","list":false,"same":false,"static":false,"contact":false,"held":false}]}]}';

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
          motion: ["hands", "object", "none"].includes(x.motion) ? x.motion : "none",
          list: x.list === true,
          same: x.same === true,
          still: x.static === true,
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
  "the video returns to. 6-14 lines. Plain words, no brands, no people. NOTHING WITH MARKS ON IT: " +
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
 * The last clause of a line when it is a short list item — "…at a kitchen table with a hook," →
 * keep "…at a kitchen table with", item "a hook,". Null when the line does not end on one. Pure.
 */
export function trailingListItem(text: string): { keep: string; item: string } | null {
  const m = /^(.*\S)\s+((?:a|an|the|some|one|two|three|your|my|our|his|her)\s+[^,.;:!?]{1,40}),\s*$/i.exec(
    text.trim()
  );
  if (!m) return null;
  if (m[2].split(/\s+/).length > 5) return null;
  if (m[1].split(/\s+/).length < HOST_HANDOFF_MIN_WORDS) return null;
  return { keep: m[1], item: `${m[2]},` };
}

/**
 * A spoken list's FIRST item left at the end of the line before it goes to the list. The storyboard
 * cuts the script into beats by length, so a list can start in one beat and go on in the next: Granny
 * Mae's "…for anybody sitting at a kitchen table with a hook, | a skein of yarn, and a stack of
 * stitch books" (3-min test, job 231) kept "a hook" on the host while the other two items each got a
 * picture — the shot list only ever sees one beat's words. When a line ends on a short item and the
 * very next shot is a list item, the item becomes a list shot of its own; the line before hands
 * over right there (`wordCut`). Never a CTA, cover, asset, split or list line. Returns the new list
 * and how many moved. Pure — unit-tested.
 */
export function pullListLeadIns(
  scenes: StoryboardScene[],
  subject?: string
): { scenes: StoryboardScene[]; moved: number } {
  const out = [...scenes];
  let moved = 0;
  for (let i = 0; i + 1 < out.length; i++) {
    const s = out[i];
    const list = out[i + 1];
    if (!list.listCut || s.listCut || s.cta || s.qrHero || s.coverHero || s.assetImageUrl) continue;
    if (s.splitVisual) continue;
    const cut = trailingListItem(s.scriptText ?? "");
    if (!cut) continue;
    const bare = cut.item.replace(/,$/, "");
    const where = /\b(?:on|in|at|beside|by) the [^,]+$/i.exec(list.showSubject ?? "")?.[0];
    const show = `${bare}${subject ? ` (as used for ${subject})` : ""}${where ? ` ${where}` : ""}`;
    const piece: StoryboardScene = {
      ...list,
      ...FRESH,
      scriptText: cut.item,
      narration: cut.item,
      showSubject: show,
      visualPrompt: show,
      visualPromptSeed: undefined,
      stillImage: true,
      humanPresent: undefined,
      objectMotion: undefined,
      sameShot: undefined,
      listCut: true,
      wordCut: true,
    };
    s.scriptText = cut.keep;
    s.narration = firstWords(cut.keep, 8);
    s.audioUrl = undefined;
    s.audioDuration = undefined;
    // The line before now hands over to the list mid-sentence, on purpose.
    s.wordCut = true;
    s.shotGroup ??= list.shotGroup;
    out.splice(i + 1, 0, piece);
    moved++;
    i++;
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, moved };
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
    const listRunsOn =
      !!a.listCut &&
      !b.listCut &&
      joinable({ ...a, listCut: undefined }) &&
      joinable(b) &&
      !!a.showSubject &&
      sameSubject(a.showSubject, b.showSubject ?? "");
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
and when a line is a clear new point about something else. Never group across a "----" line.

For each group of 2 or more consecutive pictures that share a context, write ONE picture that fits
every line in it: plain words, what is literally in the frame, like a snapshot caption. It is ONE
still moment from ONE spot: the main thing being done or shown, plus at most one other thing in the
background. Never "or", never a sequence of actions ("crocheting, then tying fringe"), never two
places. If any
picture in the group shows hands or the host doing something, the new picture MUST show the host's
hands doing that work (a person is never dropped). Keep exact names of kinds (nine-patch, kumiko).

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
export function parseContextGroups(text: string, runs: number[][]): ContextGroup[] {
  const parsed = safeParseJSON<any>(text);
  const raw: unknown[] =
    parsed.success && Array.isArray(parsed.data?.groups) ? parsed.data.groups : [];
  const runOf = new Map<number, number>();
  runs.forEach((r, k) => r.forEach(i => runOf.set(i, k)));
  const used = new Set<number>();
  const out: ContextGroup[] = [];
  for (const g of raw as { ids?: unknown; show?: unknown }[]) {
    const ids = Array.isArray(g?.ids) ? g.ids.map(Number).filter(Number.isInteger) : [];
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
    ids.forEach(id => used.add(id));
    out.push({ ids, show });
  }
  return out;
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
    // A topic with a tool going into the material in it is a photo, every view of it.
    const contact = members.some(s => s.toolContact);
    const motion =
      doing.length === 0 || contact
        ? "none"
        : safeMotion(show, doing.some(s => s.humanPresent) ? "hands" : "object");
    members.forEach((s, k) => {
      s.showSubject = show;
      s.visualPrompt = show;
      s.stillImage = motion === "none";
      s.humanPresent = motion === "hands" || person ? true : undefined;
      s.objectMotion = motion === "object" ? true : undefined;
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
      return applyContextGroups(scenes, parseContextGroups(r.text, runs));
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
    const into =
      prev && !prev.hostPresent && prev.shotGroup === s.shotGroup
        ? i - 1
        : next && !next.hostPresent && next.shotGroup === s.shotGroup
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

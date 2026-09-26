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

/** A picture shorter than this is a flash and folds into a neighbour. */
export const SHOT_MIN_SEC = 1.2;
/**
 * One item of a spoken list may be this short. Hank reads "a saw, a drill, and a stack of
 * sandpaper" in 2.1 s — at 0.6 the items folded into one picture of a saw, which is exactly the cut
 * the operator asked for undone. 0.4 s is ten frames: a quick cut, still readable as a thing.
 */
export const LIST_SHOT_MIN_SEC = 0.4;
/** Headroom `settleShots` keeps over each floor for the final snap onto real pauses. */
export const SNAP_MARGIN_SEC = 0.2;
/** The host says at least this many words on camera before handing over to the pictures. */
export const HOST_HANDOFF_MIN_WORDS = 5;
/** The host's part of a hand-off must run at least this long, or the host keeps the whole line. */
export const HOST_HANDOFF_MIN_SEC = 2;
/** No picture sits on screen longer than this — a longer stretch gets another shot. */
export const MAX_PICTURE_SEC = 5.5;
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
 * What may move in a shot of `show`: hands doing the work, or a thing that moves by itself —
 * never an ordinary object on its own. An "object" shot of something that does not move by
 * itself becomes a hands shot when hands are in it, else a still.
 */
export function safeMotion(
  show: string,
  wanted: "hands" | "object" | "none" | undefined
): "hands" | "object" | "none" {
  if (wanted === "object")
    return MOVES_ON_ITS_OWN.test(show) ? "object" : SHOWS_HANDS.test(show) ? "hands" : "none";
  return wanted ?? "none";
}

const firstWords = (text: string, n: number) =>
  text.trim().split(/\s+/).slice(0, n).join(" ");

/** Everything a fresh piece of a beat must NOT inherit: its audio and any render of the parent. */
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
  shot: Pick<PlannedShot, "show" | "motion" | "list">,
  k: number
): StoryboardScene {
  const motion = safeMotion(shot.show, shot.motion);
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
    humanPresent: motion === "hands" ? true : undefined,
    objectMotion: motion === "object" ? true : undefined,
    visualPrompt: shot.show,
    visualPromptSeed: undefined,
    brollVisual: undefined,
    showSubject: shot.show,
    listCut: shot.list ? true : undefined,
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
    const variant = ["", " — a closer detail", " — from another angle", " — a wider view"][k % 4];
    out.push({
      ...s,
      ...FRESH,
      scriptText: slice,
      narration: firstWords(slice, 8),
      visualPrompt: k === 0 ? s.visualPrompt : `${s.showSubject ?? s.visualPrompt}${variant}`,
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
  sec: (s: StoryboardScene) => number
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
        d > MAX_PICTURE_SEC &&
        shotListEligible(s, scenes[i + 1])
      ) {
        const parts = splitPicture(s, Math.ceil(d / (MAX_PICTURE_SEC - 0.5)));
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
      if (!s.hostPresent && d > MAX_PICTURE_SEC) {
        const parts = splitPicture(s, Math.ceil(d / (MAX_PICTURE_SEC - 0.5)));
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
  "1. SAY IT, SHOW IT. Each shot shows exactly the concrete thing or action its words name, " +
  'literally: "a stack of sandpaper" is a stack of sandpaper; "a basket of yarn ends" is a basket ' +
  'of yarn ends; "I pinned the squares into rows" is quilt squares pinned in rows. Use the PROPS ' +
  "LIST for how a recurring thing looks, so it looks the same every time, and keep the story " +
  "moving (what was being made in the shots before is further along now, not back at the start).\n" +
  "2. CUT ON THE WORD. A new shot starts on the exact word where a new showable thing is named. A " +
  'spoken list gets one quick shot per item ("a needle, a spool of thread, and a pair of shears" = ' +
  "three shots, list: true). Otherwise a shot runs at least 4-5 words.\n" +
  "3. NOTHING LINGERS. No shot runs longer than about 12 words; a longer stretch gets another shot " +
  "that follows what is being said (a closer detail, the next step, the result).\n" +
  "4. A COMPARISON IS NOT A SHOT. When a line compares the subject to something else to say how " +
  'much it costs or what it is like ("yarn that costs more than a good roast"), show the subject.\n' +
  "5. NO WRITING. Never a shot of words, numbers, prices, signs, labels, notes, screens, tally " +
  "marks, chalkboards, calendars or clocks — show the thing the number is about (\"six dollars " +
  'for those coasters" = the coasters; "how long it took" = the work in progress; "the tally I ' +
  'keep" = the finished pieces).\n' +
  "6. PEOPLE. Pictures are person-free, except hands doing the work. Never a face.\n" +
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
  "line) the host says at least the first 6 words on camera, then hands over the same way. On an " +
  "INTRO beat the host must say " +
  "their own name on camera first — and once they have, a line that goes on to name things MUST " +
  "hand over (\"I'm Rose Miller, and this is for anybody sitting at a kitchen table with | a " +
  'hook, | a skein of yarn, | and a free evening").\n' +
  '8. motion: "hands" (hands doing the action — cutting, stitching, sanding, kneading, planting), ' +
  '"object" (a thing moving on its own — a machine needle running, a candle flickering), "none" ' +
  "(a thing that just sits there). SHOW IT HAPPENING: when the words are about making, using, " +
  "handling, fixing, selling or checking something, the shot is hands doing it (\"I pressed every " +
  'seam" = hands pressing a seam, motion "hands"); a thing that is only NAMED stays still ("a ' +
  'stack of fat quarters" = the stack, motion "none"). Most shots of a how-it-was-made story are hands.\n' +
  "9. from: the first 1-4 words of the shot, copied EXACTLY from the beat, in order. The first " +
  "shot of a non-host beat starts at the beat's first word.\n" +
  "10. show: 8-20 words naming what the picture shows — the named thing FIRST and framed close, " +
  "so it is the centre of attention and fills most of the frame; then only a few words of simple " +
  "background for the place (the place the line names, else the props list's home setting): " +
  '"a Japanese pull saw, close up, against a plain workshop wall" — not "the saw hanging on the ' +
  'pegboard above the workbench", which makes the bench the picture. Plain, concrete, no mood words.\n\n' +
  "Return ONLY JSON: " +
  '{"beats":[{"beat":N,"hostUntil":null|"...","shots":[{"from":"...","show":"...","motion":"none","list":false}]}]}';

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

/**
 * The plan rules every film must pass — checked, and FIXED, inside the pipeline before a single
 * clip is paid for, instead of found afterwards by `scripts/stress/audit.mts`. The audit imports
 * `checkPlan` from here, so the rehearsal's verdict and the pipeline's gate are the same code.
 *
 *  1. No pause after a CTA            — no automatic hold anywhere.
 *  2. CTA order                       — host → book → host → big QR, the QR moves once.
 *  6. Self-introduction on camera     — "I'm <host>" is the host, full frame.
 *  7. Clean host switches             — host takes start on a sentence (never after a comma, nor
 *                                       inside one after the CTA's book cover; a take that does takes
 *                                       its sentence back, or starts on its next one,
 *                                       `finishSentenceBeforeHost`)
 *                                       and end on one (or hand over at a natural break — a comma,
 *                                       before a joining word or a named thing, `naturalBreak`; a
 *                                       take that stops anywhere else finishes its sentence or hands
 *                                       over at its own last break, `finishSentenceAfterHost`); no
 *                                       flash shots, and no beat the voice gives no time at all.
 *  8. Host often                      — ≤40 s without the host in the first 3 min, ≤75 s after.
 *  9. Pictures don't linger           — a picture outside the CTA runs ≤6.5 s.
 * 11. Real video                      — 10-25% of cutaway time moves.
 * 15. A video only of what moves by itself (`judgeSelfMoving`) — never hands, never a person moving it.
 * (Rules 3-5 and 10 are judged on the pictures as they are made; 12 on the voice at voicing.)
 */
import type { StoryboardScene, LongformInputParams } from "../shared/types";
import { sceneHoldPlan } from "../shared/filmTimeline";
import type { SilenceInterval } from "./videoAssembly";
import { retimeSpokenNumbers } from "./narrationAlignment";
import { SHOWS_PERSON, showsSomeoneElse } from "./hostLook";
import { namesHostBefore } from "./hostIntro";
import {
  demoteHostToStill,
  promoteCutawayToHost,
  introducesHost,
  endsSentence,
  startsSentence,
  qrPlacementFor,
  HOST_SENTENCE_MAX_SEC,
  FLASH_SHOT_SEC,
  HOST_CHECKIN_MIN_SEC,
  HOST_JOIN_MAX_SEC,
  HOOK_MAX_WHOLE_SEC,
  inMarkedCta,
} from "./longformVideo";
import {
  HOST_HANDOFF_MIN_SEC,
  HOST_HANDOFF_MIN_WORDS,
  HOST_PART_MAX_SEC,
  LIST_ITEM_CLAUSE,
  NOT_A_LIST_ITEM,
  LIST_SHOT_MIN_SEC,
  MAX_PICTURE_SEC,
  pictureMaxSecAt,
  MOTION_MIN_SEC,
  MOVING_PICTURE_MAX_SEC,
  contactToolWork,
  SHOT_MIN_SEC,
  splitPicture,
  settleVideoKind,
  videoKind,
  mergeable,
  leadInBetweenItems,
  rangeSec,
  unseenFoldTarget,
  UNSEEN_BEAT_SEC,
  breakTopicsAtHostTakes,
} from "./shotList";

export type PlanFinding = { rule: number; scene?: number; detail: string };
type Finding = PlanFinding;

/** Rule 8: the longest stretch without the host — early (gap mostly in the first 3 min), late. */
export const HOST_GAP_EARLY_ZONE_SEC = 180;
export const HOST_GAP_EARLY_MAX_SEC = 40;
export const HOST_GAP_LATE_MAX_SEC = 75;
/**
 * Rule 9: the longest a picture outside the CTA may stay on screen — `pictureMaxSecAt` for where
 * it starts (7 / 10 / 12 / 14 s by quarter of the film, the operator's 2026-09-28 call) plus this
 * much slack for the final snap onto real pauses.
 */
export const PICTURE_MAX_SLACK_SEC = 0.5;
/** Kept for callers that have no timeline: the first quarter's limit. */
export const PICTURE_MAX_SEC = pictureMaxSecAt(0, 0) + PICTURE_MAX_SLACK_SEC;
/**
 * Rule 7 inside a CTA: the longest the book cover may run while it finishes the sentence the host
 * would otherwise come back into — the ceiling a host take stretches to for the same reason
 * (`HOST_SENTENCE_MAX_SEC`, 15; a test holds the two equal). Past it the host comes back inside
 * the sentence, the ordinary L-cut. A NUMBER, never `= HOST_SENTENCE_MAX_SEC`: longformVideo
 * imports this file, so the server runs this file's top level before longformVideo's own — that
 * import is not set yet here, and node stopped at boot on it ("Cannot access
 * 'HOST_SENTENCE_MAX_SEC' before initialization"; vitest read it as undefined).
 */
export const COVER_SENTENCE_MAX_SEC = 15;
/**
 * Rule 11: the share of cutaway time that moves — between these (2026-09-28, the operator: "less
 * video b-roll than the image"; it used to demand at least 30%). Below the floor the gate adds
 * motion up to `MOTION_SHARE_TARGET`; above the ceiling it turns the shortest moving shots back
 * into stills.
 */
export const MOTION_SHARE_MIN = 0.1;
export const MOTION_SHARE_MAX = 0.25;

export const fmt = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export const len = (s: StoryboardScene) =>
  Math.max(0, (s.narrationEndSec ?? 0) - (s.narrationStartSec ?? 0)) ||
  s.audioDuration ||
  0;
export const textOf = (s: StoryboardScene) => s.scriptText ?? s.narration ?? "";
export const fixed = (s: StoryboardScene | undefined) =>
  !!s && (!!s.qrHero || !!s.coverHero || !!s.assetImageUrl);

/** Rule 2: one token per beat of a marked CTA block. */
function ctaToken(s: StoryboardScene): string {
  if (s.qrHero) return "Q";
  if (s.coverHero) return "B";
  if (s.assetImageUrl) return "A";
  if (s.hostPresent && s.splitVisual) return "S";
  if (s.hostPresent) return "H";
  return "P";
}

export function checkPlan(
  scenes: StoryboardScene[],
  params: LongformInputParams
): { findings: Finding[]; stats: Record<string, unknown> } {
  const findings: Finding[] = [];
  const canHost = !!params.faceImageUrl && !params.brollOnly;

  // 1. No automatic hold anywhere.
  for (const s of scenes) {
    const hold = sceneHoldPlan(s).tailHoldSec ?? 0;
    if (hold > 0 && s.tailHoldSec == null)
      findings.push({ rule: 1, scene: s.index, detail: `automatic ${hold}s hold` });
  }

  // 2. CTA order, per marked block.
  const blocks = new Map<number, StoryboardScene[]>();
  for (const s of scenes)
    if (inMarkedCta(s)) blocks.set(s.ctaIndex!, [...(blocks.get(s.ctaIndex!) ?? []), s]);
  const ctaPatterns: string[] = [];
  blocks.forEach((run, idx) => {
    const tokens = run.map(ctaToken).join("");
    ctaPatterns.push(`block ${idx}: ${tokens}`);
    const where = `block ${idx} (${tokens})`;
    if (!/Q+$/.test(tokens)) findings.push({ rule: 2, detail: `${where}: does not END on the big QR` });
    if (/Q[^Q]/.test(tokens)) findings.push({ rule: 2, detail: `${where}: big QR is not one run to the end` });
    if (!tokens.includes("B")) findings.push({ rule: 2, detail: `${where}: no book cover` });
    const afterBook = tokens.slice(tokens.indexOf("B") + 1).replace(/Q+$/, "");
    if (tokens.includes("B") && canHost && !/H/.test(afterBook))
      findings.push({ rule: 2, detail: `${where}: host does not come back after the book` });
    if (tokens.includes("S")) findings.push({ rule: 2, detail: `${where}: split screen in the CTA` });
    if (canHost && tokens.includes("P")) findings.push({ rule: 2, detail: `${where}: b-roll in the pitch` });
    const places = run.map(s => qrPlacementFor(s));
    const moves = places.filter((p, i) => i > 0 && p !== places[i - 1]).length;
    if (moves > 1) findings.push({ rule: 2, detail: `${where}: QR moves ${moves} times` });
  });
  if (blocks.size === 0) findings.push({ rule: 2, detail: "no marked CTA block in the film" });

  // 6. Self-introduction on camera.
  let intros = 0;
  for (const s of scenes) {
    if (!introducesHost(textOf(s), params.hostName)) continue;
    intros++;
    if (canHost && (!s.hostPresent || s.splitVisual))
      findings.push({ rule: 6, scene: s.index, detail: `introduction not on camera: "${textOf(s).slice(0, 70)}"` });
  }

  // 7. Clean host switches, no flash shots.
  let midTakes = 0;
  scenes.forEach((s, i) => {
    // A beat the voice gives no time at all is not "unmeasured": it plays as one frame of a picture
    // that was paid for (production job 236 #79-#81, three "teakettle," items at 0.000 s). `len`
    // reads a zero range as missing, so the range itself is asked here.
    const measured = rangeSec(s);
    if (measured != null && measured <= UNSEEN_BEAT_SEC) {
      findings.push({
        rule: 7,
        scene: s.index,
        detail: `unseen beat (${Math.max(0, measured).toFixed(2)}s, no narration under it): "${textOf(s).slice(0, 70)}"`,
      });
      return;
    }
    const flash = s.listCut ? LIST_SHOT_MIN_SEC : s.wordCut ? SHOT_MIN_SEC : FLASH_SHOT_SEC;
    // The final snap onto real pauses moves a cut by up to ~0.2 s after the shot list measured it.
    if (len(s) > 0 && len(s) < flash - 0.2)
      findings.push({ rule: 7, scene: s.index, detail: `flash shot ${len(s).toFixed(2)}s` });
    if (!s.hostPresent || fixed(s)) return;
    if (len(s) > 0 && len(s) < HOST_HANDOFF_MIN_SEC - 0.05)
      findings.push({ rule: 7, scene: s.index, detail: `host take only ${len(s).toFixed(2)}s` });
    const prev = scenes[i - 1];
    const next = scenes[i + 1];
    const edge = (n: StoryboardScene | undefined) =>
      !n || fixed(n) || n.hostPresent || (n.cta === true) !== (s.cta === true) || n.ctaIndex !== s.ctaIndex;
    // A take that stops mid-sentence stops at a natural break or not at all. Two word-cut pieces
    // used to be enough for a "hand-off", but a picture split for LENGTH is word-cut too and lands
    // on whatever pause is nearest — job 400 (1:31) made the first half of one a check-in and the
    // host stopped between subject and verb: "…I want to show you that the arithmetic | was never
    // your problem."
    const breakEnd = naturalBreak(s, next);
    // A hand-off: the shot list cut the rest of the line into pictures at a natural break.
    const handsOff = !!next && !next.hostPresent && !!next.wordCut && !!s.wordCut && breakEnd;
    // The sentence is too long to finish inside one take (same ceiling the pipeline stretched to;
    // final alignment moves lengths a little): the ordinary L-cut, at a break. Measured on what is
    // left of the SENTENCE, not the whole scene after — job 400's 9.5 s picture held 1.5 s of it,
    // and read as "too long" excused the take above.
    const capped = breakEnd && len(s) + sentenceRestSec(scenes, i) > HOST_SENTENCE_MAX_SEC - 0.5;
    // The host comes in only once the sentence before has finished — never after a comma (allowed
    // until 2026-09-28; the operator saw it as the host cutting in mid-sentence). Excused only when
    // the sentence's OWN start is too far back to take whole — not the whole picture before: Mae's
    // 13.7 s picture held just 4 s of the sentence her host cut into.
    const leadTooLong = len(s) + sentenceLeadSec(scenes, i) > HOST_SENTENCE_MAX_SEC - 0.5;
    // The book cover is a fixed frame, an edge for every other check here, but not a licence for
    // the host to come back mid-sentence: the cover says the rest of the sentence instead
    // (`finishSentenceBeforeHost`), unless that runs it past `COVER_SENTENCE_MAX_SEC`. Job 399
    // (2:50) came back mid-list: "…gives you the exact words, | who to say them to, and the moment…".
    const afterCover = coverBeforeHost(scenes, i);
    const coverFull =
      afterCover && len(prev) + sentenceTailSec(s) > COVER_SENTENCE_MAX_SEC - 0.5;
    const badStart =
      !startsSentence(scenes, i) && (afterCover ? !coverFull : !edge(prev) && !leadTooLong);
    const badEnd = !endsSentence(textOf(s)) && !edge(next) && !capped && !handsOff;
    if (badStart || badEnd) {
      midTakes++;
      findings.push({
        rule: 7,
        scene: s.index,
        detail:
          `host take ${badStart ? "starts" : "ends"} mid-sentence` +
          `${badStart && afterCover ? " after the book cover" : ""}` +
          `${!badStart && !breakEnd ? ", at no natural break" : ""}: "${textOf(s).slice(0, 70)}"`,
      });
    }
  });

  // 7b. No blink of pictures between two host takes.
  for (let i = 1; i < scenes.length - 1; i++) {
    if (!scenes[i - 1].hostPresent || !plainPicture(scenes[i])) continue;
    let j = i;
    let sec = 0;
    while (j < scenes.length && plainPicture(scenes[j])) sec += len(scenes[j++]);
    if (j < scenes.length && scenes[j].hostPresent && sec > 0 && sec < PICTURE_RUN_MIN_SEC)
      findings.push({
        rule: 7,
        scene: scenes[i].index,
        detail: `picture blink ${sec.toFixed(1)}s between host takes`,
      });
    i = j - 1;
  }

  // 8. The host shows up often: the longest faceless stretch, early and late.
  let t = 0;
  let lastHost = 0;
  let maxEarly = 0;
  let maxLate = 0;
  for (const s of scenes) {
    const d = len(s);
    if (s.hostPresent) {
      const gap = t - lastHost;
      // A gap straddling the 3-minute mark is early or late by where most of it sits.
      const early = (lastHost + t) / 2 < HOST_GAP_EARLY_ZONE_SEC;
      if (early) maxEarly = Math.max(maxEarly, gap);
      else maxLate = Math.max(maxLate, gap);
      if (early && gap > HOST_GAP_EARLY_MAX_SEC)
        findings.push({ rule: 8, scene: s.index, detail: `${gap.toFixed(0)}s without the host before ${fmt(t)} (early)` });
      if (!early && gap > HOST_GAP_LATE_MAX_SEC)
        findings.push({ rule: 8, scene: s.index, detail: `${gap.toFixed(0)}s without the host before ${fmt(t)}` });
      lastHost = t + d;
    }
    t += d;
  }

  // 9. No lingering picture outside the CTA — the limit grows through the film by quarter.
  const pictures = scenes.filter(s => !s.hostPresent && !s.cta && !fixed(s) && !s.qrHero);
  const at = starts(scenes);
  const filmSec = scenes.reduce((a, s) => a + len(s), 0);
  let longest = 0;
  for (const s of pictures) {
    longest = Math.max(longest, len(s));
    const limit = pictureMaxSecAt(at[scenes.indexOf(s)], filmSec) + PICTURE_MAX_SLACK_SEC;
    if (len(s) > limit)
      findings.push({ rule: 9, scene: s.index, detail: `picture on screen ${len(s).toFixed(1)}s (limit ${limit.toFixed(1)}s here): "${textOf(s).slice(0, 60)}"` });
  }

  // 11. Real video: share of cutaway time that is a moving shot.
  const cutSec = pictures.reduce((a, s) => a + len(s), 0);
  const motionSec = pictures.filter(s => !s.stillImage).reduce((a, s) => a + len(s), 0);
  const motionShare = cutSec > 0 ? motionSec / cutSec : 0;
  if (motionShare < MOTION_SHARE_MIN)
    findings.push({ rule: 11, detail: `only ${(motionShare * 100).toFixed(0)}% of cutaway time is moving` });
  if (motionShare > MOTION_SHARE_MAX)
    findings.push({ rule: 11, detail: `too much video: ${(motionShare * 100).toFixed(0)}% of cutaway time is moving` });

  // 15. A video only of what moves by itself, never hands or a person (`videoKind`). A clip already
  // paid for is not counted — it is kept.
  for (const s of pictures) {
    if (s.stillImage || s.submits?.length) continue;
    const kind = videoKind(subjectOf(s), "object", {
      person: !!s.humanPresent,
      contact: !!s.toolContact,
      selfMoving: s.selfMoving,
    });
    if (kind === "none" || s.cameraMove)
      findings.push({ rule: 15, scene: s.index, detail: `video with nothing moving by itself, or with hands: "${subjectOf(s).slice(0, 60)}"` });
  }

  const host = scenes.filter(s => s.hostPresent);
  return {
    findings,
    stats: {
      scenes: scenes.length,
      hostTakes: host.length,
      hostSec: Math.round(host.reduce((a, s) => a + len(s), 0)),
      ctaPatterns,
      introductions: intros,
      midSentenceHostTakes: midTakes,
      listCuts: scenes.filter(s => s.listCut).length,
      handOffs: scenes.filter(
        (s, i) =>
          s.hostPresent &&
          s.wordCut &&
          scenes[i + 1]?.wordCut &&
          !scenes[i + 1]?.hostPresent &&
          naturalBreak(s, scenes[i + 1])
      ).length,
      longestFacelessEarlySec: Math.round(maxEarly),
      longestFacelessLateSec: Math.round(maxLate),
      longestPictureSec: Math.round(longest * 10) / 10,
      motionSharePct: Math.round(motionShare * 100),
    },
  };
}

// ── The gate: fix the plan until it passes ───────────────────────────────────────────────────

export type PlanGateOptions = {
  /** The host minutes' budget in seconds — a promotion past it must pay for itself elsewhere. */
  budgetSec?: number;
  /** The intro/outro sections (seconds at each end) whose host beats are never demoted. */
  sectionSec?: number;
  /** Real pauses in the master, so a split picture changes on a pause, not inside a word. */
  silences?: SilenceInterval[];
  /**
   * When every word of the master is spoken (the voicing transcript). With it, a cut the gate
   * makes lands in the real gap between two words; without it (a job resumed with no transcript)
   * the gate falls back to the word-share guess moved onto a pause, which can land inside a word —
   * Mae's job 209 cut "a- | piece" that way.
   */
  words?: TimedWord[];
};

export type PlanGateResult = {
  scenes: StoryboardScene[];
  /** What was changed, in plain words, for the render log. */
  fixes: string[];
  /** What could not be fixed (the job warns with these). */
  unresolved: PlanFinding[];
};

/** Rules fixed first: the structure before the rhythm, the rhythm before the video share. */
const RULE_ORDER = [1, 2, 6, 7, 9, 8, 15, 11];

/**
 * The shortest run of pictures between two host takes. Shorter, the host leaves and comes straight
 * back — a blink, not a cutaway (Norbert's 3-min test, job 232: host → 0.6 s "the drill" → 1.3 s
 * "or the handyman" → host, in the goodbye). The host keeps those words instead.
 */
export const PICTURE_RUN_MIN_SEC = 2; // the same floor as a host part (`HOST_HANDOFF_MIN_SEC`)
/**
 * The motion share the gate aims for — over the rule by enough that the clip stage's own swaps
 * cannot sink it: the glitch check turns a clip that moves wrong into its still (on the first
 * glitch since 2026-10-18 — a video is paid for once), and on Hank's first real render (job 175)
 * four of those took a 31% plan to 29.8%.
 */
const MOTION_SHARE_TARGET = 0.15;

const wordsOf = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const firstWords = (t: string, n: number) => wordsOf(t).slice(0, n).join(" ");
const canHostFor = (p: LongformInputParams) => !!p.faceImageUrl && !p.brollOnly;

/** A picture the gate may change: not a host, not the CTA's fixed frames, not a pitch beat. */
const plainPicture = (s: StoryboardScene | undefined): s is StoryboardScene =>
  !!s &&
  !s.hostPresent &&
  !fixed(s) &&
  s.cta !== true &&
  !s.qrCorner &&
  !s.coverHero &&
  !s.showsBook;

/** Two neighbours that may become one scene: same side of every CTA edge. */
const sameRegister = (a: StoryboardScene, b: StoryboardScene) =>
  (a.cta === true) === (b.cta === true) &&
  a.ctaIndex === b.ctaIndex &&
  !fixed(a) &&
  !fixed(b);

/**
 * Host take `i` comes back right after its CTA block's book cover. The cover may say the rest of
 * the sentence the host would otherwise come back into — never the other way round, since the
 * cover has to keep the title. Job 399 (2:50): the cover ended on the storyboard's word count,
 * "…every secret gives you the exact words,", and the host came back on "who to say them to, and
 * the moment in the trip when they work." The QR card and an operator's asset are not covers.
 */
function coverBeforeHost(scenes: StoryboardScene[], i: number): boolean {
  const cover = scenes[i - 1];
  const host = scenes[i];
  return (
    !!cover?.coverHero &&
    !cover.qrHero &&
    !cover.assetImageUrl &&
    !!host?.hostPresent &&
    cover.cta === true &&
    host.cta === true &&
    cover.ctaIndex === host.ctaIndex
  );
}

/**
 * Seconds of scene `s` spoken before its first sentence ends (by word share), all of it when no
 * sentence ends inside it — what the scene before it would have to say to finish that sentence.
 */
function sentenceTailSec(s: StoryboardScene): number {
  const at = sentenceStarts(textOf(s));
  if (!at.length) return len(s);
  return (len(s) * at[0]) / Math.max(1, wordsOf(textOf(s)).length);
}

function starts(scenes: StoryboardScene[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of scenes) {
    out.push(t);
    t += len(s);
  }
  return out;
}

/** A host beat the gate never demotes: the start, the intro, the CTAs, the end, the sections. */
function isProtectedHost(
  scenes: StoryboardScene[],
  i: number,
  sectionSec: number
): boolean {
  const s = scenes[i];
  if (!s.hostPresent) return false;
  if (i === 0 || i === scenes.length - 1) return true;
  if (
    s.hostOpener ||
    s.hostIntro ||
    s.hostProtected ||
    s.cta === true ||
    s.qrCorner ||
    fixed(s)
  )
    return true;
  if (sectionSec > 0) {
    const t = starts(scenes);
    const total = t[t.length - 1] + len(scenes[scenes.length - 1]);
    if (t[i] < sectionSec || t[i] >= total - sectionSec) return true;
  }
  return false;
}

/** `drop` joins `keep` (neighbours); `keep`'s picture and role win. Returns the new list. */
function mergeInto(
  scenes: StoryboardScene[],
  keepAt: number,
  dropAt: number
): StoryboardScene[] {
  const keep = scenes[keepAt];
  const drop = scenes[dropAt];
  const [a, b] = keepAt < dropAt ? [keep, drop] : [drop, keep];
  keep.narrationStartSec = a.narrationStartSec;
  keep.narrationEndSec = b.narrationEndSec;
  keep.scriptText =
    `${(a.scriptText ?? "").trim()} ${(b.scriptText ?? "").trim()}`.trim();
  keep.narration = firstWords(keep.scriptText, 8);
  keep.audioUrl = undefined;
  keep.audioDuration = Math.max(
    0,
    (keep.narrationEndSec ?? 0) - (keep.narrationStartSec ?? 0)
  );
  if (!keep.hostPresent && keep.listCut && !drop.listCut) keep.listCut = undefined;
  // A shot-list piece joined on keeps its word-cut nature: a short intro that took the picture
  // after it ("…sitting at a kitchen table with") still hands over to the list that follows —
  // without this the joined take read as a host cut off mid-sentence (Ruth, job 178).
  if (drop.wordCut && !keep.wordCut) {
    keep.wordCut = true;
    keep.shotGroup ??= drop.shotGroup;
  }
  return scenes.filter((_, k) => k !== dropAt);
}

/** The pause nearest `t` (its middle), when one is within `within` seconds. */
function snapToPause(
  t: number,
  silences: SilenceInterval[] | undefined,
  within = 0.5
): number {
  let best = t;
  let bestD = within;
  for (const p of silences ?? []) {
    const mid = (p.start + p.end) / 2;
    const d = Math.abs(mid - t);
    if (d < bestD) {
      best = mid;
      bestD = d;
    }
  }
  return best;
}

/** A word that ends a sentence — the same test `endsSentence` makes on a whole scene. */
const ENDS_SENTENCE_WORD = /[.!?…]["'”’)\]]*$/;

/** Word offsets inside `t` where a new sentence begins (never 0). */
function sentenceStarts(t: string): number[] {
  const w = wordsOf(t);
  const out: number[] = [];
  for (let k = 1; k < w.length; k++) if (ENDS_SENTENCE_WORD.test(w[k - 1])) out.push(k);
  return out;
}

/** One spoken word of the master, in seconds (the voicing transcript's shape), and what was heard. */
export type TimedWord = { start: number; end: number; word?: string };

/** A word as the script and the transcript can both spell it: lower case, letters and digits. */
const bare = (w: string | undefined) =>
  (w ?? "").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, "");
/** The kind of break a word ends on: a sentence, a clause, or none. */
const endMark = (w: string | undefined) =>
  /[.!?…]["'”’)\]]*$/.test(w ?? "") ? "." : /[,;:—–]["'”’)\]]*$/.test(w ?? "") ? "," : "";
/**
 * How far the transcript's word count may drift from the script's around a cut: a number the
 * script spells out is one heard word ("a hundred and one" ⇄ "101"), and a dash is none. On job
 * 400's pitch that put the share three words past "…people, and more." — inside the next sentence.
 */
const ANCHOR_WINDOW_WORDS = 6;

/**
 * The cut before the word `share` of the way through the span [from, to], placed in the REAL gap
 * between two spoken words: the transcript's words inside the span are counted, the one at that
 * share is found, and the cut goes in a pause inside the gap before it when there is one, else in
 * the middle of the gap. When the script word the cut follows (`after`) was HEARD nearby, the cut
 * goes right after it instead — the nearest one, preferring the one heard ending the same way (a
 * full stop for a sentence). After a sentence end with no pause in the heard gap, the cut goes in
 * the longest real pause the two heard words reach, even one the transcript stretched a word over.
 * Null without enough words to go on. Pure — unit-tested via the gate.
 */
function gapBeforeWord(
  from: number,
  to: number,
  share: number,
  silences: SilenceInterval[] | undefined,
  words: TimedWord[] | undefined,
  after?: string
): number | null {
  if (!words?.length) return null;
  const inSpan = words.filter(w => w.start >= from - 0.05 && w.end <= to + 0.05);
  if (inSpan.length < 2) return null;
  let k = Math.min(inSpan.length - 1, Math.max(1, Math.round(share * inSpan.length)));
  const said = bare(after);
  if (said) {
    let best = -1;
    let bestScore = 0;
    for (
      let j = Math.max(1, k - ANCHOR_WINDOW_WORDS);
      j <= Math.min(inSpan.length - 1, k + ANCHOR_WINDOW_WORDS);
      j++
    ) {
      if (bare(inSpan[j - 1].word) !== said) continue;
      // Same word, same break first; then the one nearest the share.
      const score = (endMark(inSpan[j - 1].word) === endMark(after) ? 100 : 0) - Math.abs(j - k);
      if (best < 0 || score > bestScore) {
        best = j;
        bestScore = score;
      }
    }
    if (best > 0) k = best;
  }
  const before = inSpan[k - 1];
  const next = inSpan[k];
  const a = before.end;
  const b = Math.max(a, next.start);
  const clamp = (t: number) => Math.min(to - 0.05, Math.max(from + 0.05, t));
  // A pause inside the heard gap takes the cut, the first one: right after the heard word. Never
  // the longest pause within reach in its place — job 404's "…tap it. | Or scroll down": the
  // transcript lost "Or", and the longest pause in reach was the one AFTER it (193.55-194.06), which
  // would have handed "Or" to the sentence before; the first is the sentence's own (192.77-193.12).
  const pause = (silences ?? []).find(p => p.end > a && p.start < b);
  if (pause) return clamp((Math.max(pause.start, a) + Math.min(pause.end, b)) / 2);
  // No pause in the heard gap, at a SENTENCE break: the real pause between the two sentences sits
  // under one of the heard words. Job 406: the book cover finished its sentence on "…actually run."
  // and the host came back on "Three hundred seventy pages" — and the cut came out at 180.69, inside
  // the spoken number, the middle of a transcript gap that sat wholly AFTER the 0.74 s pause
  // (179.42-180.16): the word before heard running on over the pause, the number heard late (one
  // short token, "370"). The longest real pause the two heard words' spans reach is taken — the
  // window the aligner's own snap allows (`Gap` in narrationAlignment.ts). After a comma or inside a
  // sentence the heard gap stands: a silence inside a heard word may be its own closure.
  const reach = endMark(after) === "." ? longestPause(silences, before.start, next.end) : null;
  if (reach) return clamp((Math.max(reach.start, before.start) + Math.min(reach.end, next.end)) / 2);
  return clamp((a + b) / 2);
}

/** The pause with the most of itself inside [from, to], or null when none reaches in. */
function longestPause(
  silences: SilenceInterval[] | undefined,
  from: number,
  to: number
): SilenceInterval | null {
  let best: SilenceInterval | null = null;
  let bestIn = 0;
  for (const p of silences ?? []) {
    const inside = Math.min(p.end, to) - Math.max(p.start, from);
    if (inside > bestIn) {
      best = p;
      bestIn = inside;
    }
  }
  return best;
}

/**
 * When word `k` of scene `s` is spoken, with no word timings at this stage: its share of the
 * scene's words, moved onto the LONGEST pause within 0.8 s — the break between two sentences is
 * the longest pause around it, where a comma's is shorter and a closure inside a word shorter
 * still. Never onto the scene's own edges.
 */
function timeAtWord(
  s: StoryboardScene,
  k: number,
  silences: SilenceInterval[] | undefined,
  words?: TimedWord[]
): number {
  const from = s.narrationStartSec ?? 0;
  const to = s.narrationEndSec ?? from;
  const said = wordsOf(textOf(s));
  const n = Math.max(1, said.length);
  const exact = gapBeforeWord(from, to, k / n, silences, words, said[k - 1]);
  if (exact != null) return exact;
  const ideal = from + ((to - from) * k) / n;
  let best = ideal;
  let bestLen = 0;
  for (const p of silences ?? []) {
    const mid = (p.start + p.end) / 2;
    if (Math.abs(mid - ideal) > 0.8 || mid <= from + 0.1 || mid >= to - 0.1) continue;
    if (p.end - p.start > bestLen) {
      best = mid;
      bestLen = p.end - p.start;
    }
  }
  return best;
}

/**
 * Seconds of the sentence scene `i` starts inside that were spoken before it — by word share of
 * each scene back to where the sentence began (0 when `i` starts a sentence).
 */
function sentenceLeadSec(scenes: StoryboardScene[], i: number): number {
  let lead = 0;
  for (let k = i - 1; k >= 0; k--) {
    const p = scenes[k];
    const starts = sentenceStarts(textOf(p));
    if (starts.length) {
      const n = wordsOf(textOf(p)).length;
      return lead + (len(p) * (n - starts[starts.length - 1])) / Math.max(1, n);
    }
    if (endsSentence(textOf(p)) && k < i - 1) return lead;
    lead += len(p);
    if (startsSentence(scenes, k)) return lead;
  }
  return lead;
}

/**
 * Seconds of the sentence scene `i` stops inside that are spoken after it — by word share of each
 * scene up to the word that ends the sentence (all that follows when none does). The mirror of
 * `sentenceLeadSec`.
 */
function sentenceRestSec(scenes: StoryboardScene[], i: number): number {
  let rest = 0;
  for (let k = i + 1; k < scenes.length; k++) {
    const p = scenes[k];
    const w = wordsOf(textOf(p));
    const end = w.findIndex(x => ENDS_SENTENCE_WORD.test(x));
    if (end >= 0) return rest + (len(p) * (end + 1)) / Math.max(1, w.length);
    rest += len(p);
  }
  return rest;
}

// ── Where a host take may stop mid-sentence ──────────────────────────────────────────────────

/** A word as written: lower case, outer punctuation off, an inner apostrophe kept ("it's" ≠ "its"). */
const plainWord = (w: string | undefined) =>
  (w ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[^a-z0-9$À-ɏ]+|[^a-z0-9%À-ɏ]+$/g, "");

/**
 * Words a host part never stops on mid-sentence, whatever follows: the phrase is still open — an
 * article or possessive waits for its noun, a subject pronoun for its verb, a joining word for what
 * it joins. "…show you that | the arithmetic was never your problem" is no break although an
 * article follows.
 */
const OPEN_ENDING = new Set([
  "a", "an", "the", "my", "your", "our", "their", "its",
  "i", "we", "they", "he", "she",
  "and", "or", "but", "nor", "that", "which", "who", "whom", "whose", "because", "if", "unless",
  "although", "though", "whether",
  // A clause word waits for its clause as "that" does: "…the stall where | the buyers stop".
  "when", "where", "while", "until", "how", "why", "what", "so",
]);
/**
 * A host part that stops on one of these hands over right before what it is about: the words after
 * a preposition are its object, the thing the picture shows ("…this channel is for | men and women
 * in their fifties", job 400's introduction; "…build from | cheap box-store lumber,").
 */
const PREPOSITION = new Set([
  "with", "from", "of", "for", "about", "in", "into", "on", "onto", "at", "by", "over", "under",
  "through", "like", "between", "behind", "beside", "inside", "outside", "without", "toward",
  "towards", "across", "around", "among", "near",
]);
/**
 * Words the picture after a host part may open on when the host stops on no punctuation: a joining
 * word (a new clause, the next item) or the start of a noun phrase — the thing the picture shows.
 */
const BREAK_START = new Set([
  "and", "but", "or", "nor", "yet", "plus", "then", "because", "while", "whereas", "although",
  "though", "unless", "until", "which", "who", "whose", "where", "when", "if",
  "a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our",
  "their", "some", "any", "every", "each", "another", "no",
]);
/**
 * More words a picture may open on — without them ~40 hand-offs the shot list made at exactly such
 * a break in jobs 146-361 read as no break and would have been re-cut. A preposition with its object
 * (`PREP_START`: "…pay real money for one good piece | on a bare wall", job 153; "…nothing that
 * sits on a bed | in a farmhouse guest room", job 167) — never one left stranded before a verb
 * ("…the sacks that flour and feed came | in were printed", job 163), never "of" (inside a noun
 * phrase: "nine little squares | of cloth", job 163), "like" (a verb as often: "folks | like the
 * colour") or "to" (a verb's own: "every notch has | to be dead on").
 */
const PREP_START = new Set([
  ...Array.from(PREPOSITION).filter(w => w !== "of" && w !== "like"),
  "during", "against", "along", "within", "beyond", "upon", "despite", "throughout", "beneath",
  "underneath", "above", "below",
]);
/**
 * …or a clause word ("…the number that tells you | whether your evening earned its keep", job 172;
 * "…a little single-crochet edge | so they lie flat", job 151; "…will read younger | than a woman",
 * job 320; "…bought it off me | before I'd even woven in the ends", job 170), or a clause's own
 * subject ("…for every hour | I sat at that machine", job 159; "…a crowd | I didn't know lived in
 * my town", job 153). Never "you" or "it", objects as often ("…and bought | it off me", job 173).
 */
const CLAUSE_START = new Set([
  "whether", "so", "as", "than", "since", "once", "how", "why", "before", "after", "till",
  "i", "i'm", "i'll", "i'd", "i've", "we", "we're", "we'll", "we'd", "we've", "they", "they're",
  "they'll", "they'd", "they've", "he", "he's", "he'll", "he'd", "she", "she's", "she'll", "she'd",
]);
/** A verb or a subject pronoun — what never follows a preposition as its object. */
const verbOrSubject = (w: string) => LIST_ITEM_CLAUSE.test(w) || /n't$/.test(w);
/** A count or an amount opens a noun phrase too ("…name all | seven of the thieves", "…for | $40"). */
const COUNT_WORD =
  /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|dozen|half|\$?\d[\d,.]*%?)$/;
/**
 * …but not a count that names its noun: "…the jump from number two to number | one is the biggest
 * jump" (jobs 153-178) cut inside "number one".
 */
const NUMBERED = new Set([
  "number", "no", "chapter", "page", "step", "part", "size", "row", "round", "level", "item",
  "episode", "volume", "section", "lesson", "rule", "room", "aisle", "gate", "exit", "route",
]);
/**
 * Is the cut between `before` and `after` a natural break — a place a host may stop mid-sentence
 * and hand over (the shot list's own shape: right before a named thing, at a comma, before "and")?
 * Yes when `before` ends on clause punctuation, or `after` is a list item (`list` — the list
 * hand-off) or opens on a dash. Otherwise only when `before` leaves no phrase open (`OPEN_ENDING`)
 * and `after` opens on a joining word, an article, possessive or count, a preposition with its
 * object, a clause word, or a name — or `before` ends on a preposition and `after` on its object.
 * Job 400 (1:31) stopped "…that the arithmetic | was never your problem." — subject | verb, no
 * break. Words alone decide, never the picture's
 * description: job 400's opening "…in the greeting card | aisle of a pharmacy" split a compound
 * noun, and its picture said "aisle". Pure.
 */
export function breakBetween(before: string, after: string, opts: { list?: boolean } = {}): boolean {
  const b = wordsOf(before);
  const a = wordsOf(after);
  if (!b.length || !a.length) return true;
  const last = b[b.length - 1];
  if (endMark(last) || /^[-—–]+$/.test(last)) return true;
  if (opts.list) return true;
  const first = a[0];
  if (/^[-—–]/.test(first)) return true;
  const l = plainWord(last);
  if (OPEN_ENDING.has(l)) return false;
  const w = plainWord(first);
  if (!w) return false;
  if (BREAK_START.has(w) || CLAUSE_START.has(w)) return true;
  if (COUNT_WORD.test(w) && !NUMBERED.has(l)) return true;
  if (PREP_START.has(w) && a.length > 1 && !verbOrSubject(plainWord(a[1]))) return true;
  // A name — a capital inside a sentence ("…a man named | Lucius Annaeus Seneca") — never "I".
  if (/^[A-ZÀ-ÖØ-Þ]/.test(first.replace(/^["'“‘(]+/, "")) && !/^i(?:'[a-z]+)?$/.test(w))
    return true;
  // A preposition's object — never a verb or pronoun ("…what it is made of | was a mystery"), a
  // negated verb (`LIST_ITEM_CLAUSE` reads "was", not "wasn't": "…the homemade quilt folks paid me
  // best for | wasn't the precision piecing.", jobs 159 and 166), an "-ly" word or an aside.
  return PREPOSITION.has(l) && !verbOrSubject(w) && !/ly$/.test(w) && !NOT_A_LIST_ITEM.has(w);
}

/** Host take `s` stops where scene `next` starts at a natural break (`breakBetween`). Pure. */
export function naturalBreak(s: StoryboardScene, next: StoryboardScene | undefined): boolean {
  if (!next) return true;
  return breakBetween(textOf(s), textOf(next), { list: !!next.listCut });
}

/** Mark a scene's range as moved so the caller re-cuts its slice from the master. */
function reslice(s: StoryboardScene, from: number, to: number, text: string) {
  s.narrationStartSec = from;
  s.narrationEndSec = to;
  s.scriptText = text;
  s.narration = firstWords(text, 8);
  s.audioUrl = undefined;
  s.audioDuration = Math.max(0, to - from);
}

/**
 * A host take that starts mid-sentence gets the whole sentence (the operator, 2026-09-28: a new
 * part never starts before the sentence is finished). BACK first: the host takes the words since
 * the sentence began off the pictures before it, as long as those are plain pictures on the same
 * side of every CTA edge and the take stays under `HOST_SENTENCE_MAX_SEC`. Else FORWARD: the host
 * starts at its own next sentence and the picture before — or the CTA's book cover — keeps saying
 * the rest of this one, as long as the host keeps a readable part. Null when neither fits (the
 * caller demotes the take, or leaves a protected one and reports it). Pure — unit-tested through
 * `enforcePlanRules`.
 */
function finishSentenceBeforeHost(
  scenes: StoryboardScene[],
  i: number,
  silences: SilenceInterval[] | undefined,
  timed?: TimedWord[]
): { scenes: StoryboardScene[]; how: string } | null {
  const host = scenes[i];
  if (!host.hostPresent || host.narrationStartSec == null) return null;

  // BACK — walk the pictures before the host to where its sentence begins.
  let add = 0;
  for (let k = i - 1; k >= 0; k--) {
    const p = scenes[k];
    if (!plainPicture(p) || !sameRegister(p, host) || p.narrationStartSec == null) break;
    const starts = sentenceStarts(textOf(p));
    const whole = starts.length === 0 && startsSentence(scenes, k);
    if (starts.length === 0 && !whole) {
      add += len(p); // the sentence began further back — this whole picture is inside it
      continue;
    }
    const cutAt = whole ? p.narrationStartSec : timeAtWord(p, starts[starts.length - 1], silences, timed);
    const moved = (p.narrationEndSec ?? cutAt) - cutAt + add;
    if (len(host) + moved > HOST_SENTENCE_MAX_SEC) break;
    const tailWords = whole ? wordsOf(textOf(p)) : wordsOf(textOf(p)).slice(starts[starts.length - 1]);
    const between = scenes.slice(k + 1, i);
    const text = [tailWords.join(" "), ...between.map(textOf), textOf(host)].join(" ").trim();
    reslice(host, cutAt, host.narrationEndSec ?? cutAt, text);
    if (whole) {
      return {
        scenes: scenes.filter((_, j) => j < k || j >= i),
        how: `took its sentence back from the picture(s) before it`,
      };
    }
    reslice(
      p,
      p.narrationStartSec,
      cutAt,
      wordsOf(textOf(p)).slice(0, starts[starts.length - 1]).join(" ")
    );
    return {
      scenes: scenes.filter((_, j) => j <= k || j >= i),
      how: `took its sentence back from the picture(s) before it`,
    };
  }

  // FORWARD — the host starts at its next sentence; the picture before finishes this one. So does
  // the book cover the host comes back after (`coverBeforeHost`), up to `COVER_SENTENCE_MAX_SEC`:
  // job 399's cover runs on through "…who to say them to, and the moment in the trip when they
  // work." and the host comes back on "Chapter four covers…". Never past the host's last sentence —
  // the host must still come back between the cover and the card.
  const prev = scenes[i - 1];
  const starts = sentenceStarts(textOf(host));
  const cover = coverBeforeHost(scenes, i);
  if (!(cover || (plainPicture(prev) && sameRegister(prev, host))) || starts.length === 0) return null;
  const at = timeAtWord(host, starts[0], silences, timed);
  if ((host.narrationEndSec ?? at) - at < HOST_HANDOFF_MIN_SEC) return null;
  if (cover && len(prev) + (at - host.narrationStartSec) > COVER_SENTENCE_MAX_SEC) return null;
  const words = wordsOf(textOf(host));
  reslice(
    prev,
    prev.narrationStartSec ?? 0,
    at,
    `${textOf(prev).trim()} ${words.slice(0, starts[0]).join(" ")}`.trim()
  );
  reslice(host, at, host.narrationEndSec ?? at, words.slice(starts[0]).join(" "));
  return {
    scenes,
    how: cover
      ? `now starts on its next sentence (the book cover finishes this one)`
      : `now starts on its next sentence`,
  };
}

/**
 * A host take that stops mid-sentence where it may not (`naturalBreak`) — job 400 (1:31): "…I want
 * to show you that the arithmetic | was never your problem.", the first half of a picture split for
 * length, made a check-in. Four ways out, in order:
 *  1. The host FINISHES THE SENTENCE, taking its words off the plain pictures after it (never a list
 *     item's), while the take stays under its ceiling — `HOST_SENTENCE_MAX_SEC`, or
 *     `HOOK_MAX_WHOLE_SEC` on the opening and the introduction, which the shot list makes hand over
 *     — and inside the host minutes, and what is left of the picture still reads (else that picture
 *     goes too, when it ends a sentence itself) without blinking before the next take, and never
 *     ending up against it.
 *  2. Only when the cut is at no break: the host hands over at ITS OWN LAST clause punctuation (the
 *     voice already pauses there), keeping `HOST_HANDOFF_MIN_WORDS`, its own floor, and its name on
 *     the introduction.
 *  3. Or it says the picture's words up to THE NEXT natural break and hands over there — job 400's
 *     opening, 2.5 s of "There is a man standing in the greeting card | aisle of a pharmacy…",
 *     too short to give anything back and too long a sentence to finish as a hook.
 *  4. Or, with no room to go on, it hands over at its own last word break (the same floor).
 * 2-4 mark both pieces as the hand-off they now are. Null when nothing fits (the caller demotes the
 * take, or leaves a protected one and reports it). Pure — unit-tested through `enforcePlanRules`.
 */
function finishSentenceAfterHost(
  scenes: StoryboardScene[],
  i: number,
  params: LongformInputParams,
  opts: PlanGateOptions
): { scenes: StoryboardScene[]; how: string } | null {
  const host = scenes[i];
  const from = host.narrationStartSec;
  const to = host.narrationEndSec;
  if (!host.hostPresent || from == null || to == null) return null;
  const room = opts.budgetSec == null ? Infinity : opts.budgetSec + 0.5 - hostSeconds(scenes);
  const ceiling = host.hostOpener || host.hostIntro ? HOOK_MAX_WHOLE_SEC : HOST_SENTENCE_MAX_SEC;

  // 1. FORWARD — walk the pictures after the host to where its sentence ends.
  let add = 0;
  for (let k = i + 1; k < scenes.length; k++) {
    const p = scenes[k];
    const pFrom = p?.narrationStartSec;
    const pTo = p?.narrationEndSec;
    if (!plainPicture(p) || p.listCut || !sameRegister(p, host) || pFrom == null || pTo == null) break;
    const w = wordsOf(textOf(p));
    const end = w.findIndex(x => ENDS_SENTENCE_WORD.test(x)) + 1; // words through the sentence end
    if (end <= 0) {
      add += len(p); // the sentence runs on past this whole picture
      continue;
    }
    let whole = end >= w.length;
    let cutAt = whole ? pTo : timeAtWord(p, end, opts.silences, opts.words);
    // With another take right after this picture, what is left of it is the whole run of pictures
    // between two takes, and under `PICTURE_RUN_MIN_SEC` rule 7b hands it to the host too — past the
    // room counted here. Job 352's opening took "digging through the rack." and left "Half the
    // boards are bowed." for 1.8 s before the next take: it went to the host, two takes stood back
    // to back, and a check-in at 9:30 was demoted to pay for it.
    const hostAfter = !!scenes[k + 1]?.hostPresent;
    const minLeft = Math.max(SHOT_MIN_SEC, p.minHoldSec ?? 0, hostAfter ? PICTURE_RUN_MIN_SEC : 0);
    if (!whole && pTo - cutAt < minLeft) {
      // What is left would blink past (or freeze to its floor): all of it, when it ends a sentence.
      if (!endsSentence(textOf(p))) break;
      whole = true;
      cutAt = pTo;
    }
    // Never up against the next take: two takes back to back jump at the join.
    if (whole && hostAfter) break;
    const moved = add + (cutAt - pFrom);
    if (len(host) + moved > ceiling || moved > room) break;
    const between = scenes.slice(i + 1, k).map(textOf);
    const said = whole ? w : w.slice(0, end);
    reslice(host, from, cutAt, [textOf(host), ...between, said.join(" ")].join(" ").trim());
    if (!whole) reslice(p, cutAt, pTo, w.slice(end).join(" "));
    return {
      scenes: scenes.filter((_, j) => j <= i || j > k || (j === k && !whole)),
      how: `now finishes its sentence (the words came off the picture(s) after it)`,
    };
  }

  // Already at a break — what it lacks is its sentence, which moving the cut does not give it.
  const next = scenes[i + 1];
  const nFrom = next?.narrationStartSec;
  const nTo = next?.narrationEndSec;
  if (!plainPicture(next) || !sameRegister(next, host) || nFrom == null || nTo == null) return null;
  if (naturalBreak(host, next)) return null;
  const hw = wordsOf(textOf(host));
  const handOff = (t: number, hostText: string, picText: string, after: string) => {
    reslice(next, t, nTo, picText);
    reslice(host, from, t, hostText);
    host.wordCut = true;
    next.wordCut = true;
    return { scenes, how: `now hands over at a natural break, after "${after}"` };
  };

  // 2. BACK — the host hands over at its own last clause punctuation (the voice pauses there).
  const floor = Math.max(HOST_HANDOFF_MIN_SEC, host.minHoldSec ?? 0);
  const at = (b: number) => timeAtWord(host, b, opts.silences, opts.words);
  // The introduction keeps the WHOLE name on the host, asked the way the shot list asks it
  // (`namesHostBefore`): asked of the kept words alone, "I'm Hank" counted as an introduction and a
  // walk back from a cut at no break handed over between the two words — "…I'm Hank | Hardwood
  // talking to you…", "…I'm Sawdust | Sam…". With no host name there is no name to keep whole.
  const keepsName = (b: number) => {
    const said = hw.slice(0, b).join(" ");
    return params.hostName?.trim()
      ? namesHostBefore(hw.join(" "), params.hostName, said.length)
      : introducesHost(said, params.hostName);
  };
  const keeps = (b: number) =>
    b >= HOST_HANDOFF_MIN_WORDS && at(b) - from >= floor && (!host.hostIntro || keepsName(b));
  const back = (b: number) =>
    handOff(
      at(b),
      hw.slice(0, b).join(" "),
      `${hw.slice(b).join(" ")} ${textOf(next)}`.trim(),
      hw.slice(Math.max(0, b - 3), b).join(" ")
    );
  for (let b = hw.length - 1; b >= 1; b--) if (endMark(hw[b - 1]) && keeps(b)) return back(b);

  // 3. ON — the host says the picture's words up to the next break, and hands over there. What is
  // left of the picture must read, and must not blink between two takes (`PICTURE_RUN_MIN_SEC`).
  const pw = wordsOf(textOf(next));
  const minLeft = Math.max(
    SHOT_MIN_SEC,
    next.minHoldSec ?? 0,
    scenes[i + 2]?.hostPresent ? PICTURE_RUN_MIN_SEC : 0
  );
  for (let m = 1; m < pw.length; m++) {
    const said = [...hw, ...pw.slice(0, m)];
    if (!breakBetween(said.join(" "), pw.slice(m).join(" "))) continue;
    const t = timeAtWord(next, m, opts.silences, opts.words);
    const fits = len(host) + (t - nFrom) <= ceiling && t - nFrom <= room && nTo - t >= minLeft;
    if (fits) return handOff(t, said.join(" "), pw.slice(m).join(" "), said.slice(-3).join(" "));
    break; // the first break is the nearest; a later one only takes more of the picture
  }

  // 4. BACK at a word break — last, for a host with no room to go on: walking back from a subject |
  // verb cut stays inside the subject, where going on reaches the predicate's own breaks. Never
  // where a joining or relative word, a count or a clause's own subject opens a part of the subject:
  // "…the sacks that flour | and feed came in were printed" (job 163), "…the two biggest, coziest
  // things | I made are sitting right at the bottom" (job 168), "…from number two to number | one
  // is the biggest jump" (jobs 153-178).
  for (let b = hw.length - 1; b >= 1; b--) {
    const opens = plainWord(hw[b]);
    if (INSIDE_A_SUBJECT.has(opens) || CLAUSE_START.has(opens) || COUNT_WORD.test(opens)) continue;
    if (breakBetween(hw.slice(0, b).join(" "), hw.slice(b).join(" ")) && keeps(b)) return back(b);
  }
  return null;
}

/** Words that, walking back from a subject | verb cut, open a part of the subject (step 4 above). */
const INSIDE_A_SUBJECT = new Set([
  "and", "or", "nor", "but", "yet", "plus", "then", "that", "which", "who", "whom", "whose",
]);

/** Split a lingering picture into shots at clause breaks, cutting on pauses in the voice. */
function splitLingering(
  scenes: StoryboardScene[],
  i: number,
  silences: SilenceInterval[] | undefined,
  words?: TimedWord[]
): StoryboardScene[] | null {
  const s = scenes[i];
  const from = s.narrationStartSec;
  const to = s.narrationEndSec;
  if (from == null || to == null) return null;
  const filmSec = scenes.reduce((a, x) => a + len(x), 0);
  const limit = pictureMaxSecAt(starts(scenes)[i], filmSec);
  const parts = splitPicture(s, Math.ceil(len(s) / (limit - 0.5)));
  if (parts.length < 2) return null;
  const counts = parts.map(p => wordsOf(p.scriptText ?? "").length);
  const total = counts.reduce((a, b) => a + b, 0);
  let acc = 0;
  let prev = from;
  parts.forEach((p, k) => {
    acc += counts[k];
    const ideal = from + ((to - from) * acc) / total;
    const end =
      k === parts.length - 1
        ? to
        : gapBeforeWord(from, to, acc / total, silences, words) ?? snapToPause(ideal, silences);
    p.narrationStartSec = prev;
    p.narrationEndSec = Math.max(prev + 0.1, Math.min(to, end));
    p.audioDuration = p.narrationEndSec - p.narrationStartSec;
    p.audioUrl = undefined;
    if (!p.stillImage && p.audioDuration < MOTION_MIN_SEC) {
      p.stillImage = true;
      p.objectMotion = undefined;
      p.cameraMove = undefined;
    }
    prev = p.narrationEndSec;
  });
  return [...scenes.slice(0, i), ...parts, ...scenes.slice(i + 1)];
}

/** Longest early/late stretch without the host, measured exactly as rule 8 measures it. */
function worstGaps(scenes: StoryboardScene[]): { early: number; late: number } {
  let t = 0;
  let last = 0;
  let early = 0;
  let late = 0;
  for (const s of scenes) {
    if (s.hostPresent) {
      const gap = t - last;
      if ((last + t) / 2 < HOST_GAP_EARLY_ZONE_SEC) early = Math.max(early, gap);
      else late = Math.max(late, gap);
      last = t + len(s);
    }
    t += len(s);
  }
  return { early, late };
}

const gapsOk = (g: { early: number; late: number }) =>
  g.early <= HOST_GAP_EARLY_MAX_SEC && g.late <= HOST_GAP_LATE_MAX_SEC;

/**
 * A picture that can become a clean host take: in at the start of a sentence, out at its end or
 * at a shot-list break that is a natural one (`naturalBreak`) — the same shapes rule 7 accepts. A
 * picture split for length is word-cut too, so word-cut alone is not a break (job 400, 1:31:
 * "…that the arithmetic | was never your problem."). Never next to another host take, and never
 * a picture of someone else (`showsSomeoneElse`, as `checkInShaped`): that line shows the person.
 */
function cleanHostCandidate(scenes: StoryboardScene[], k: number): boolean {
  const s = scenes[k];
  if (!plainPicture(s) || showsSomeoneElse(s)) return false;
  const d = len(s);
  if (d < 2.5 || d > 9) return false;
  const prev = scenes[k - 1];
  const next = scenes[k + 1];
  if (prev?.hostPresent || next?.hostPresent) return false;
  const inClean = startsSentence(scenes, k);
  const outClean =
    endsSentence(textOf(s)) ||
    (!!s.wordCut && !!next?.wordCut && !next.hostPresent && naturalBreak(s, next));
  return inClean && outClean;
}

const hostSeconds = (scenes: StoryboardScene[]) =>
  scenes.filter(s => s.hostPresent).reduce((a, s) => a + len(s), 0);

/**
 * The stretch without the host that removing host beat `j` would leave — its two neighbouring
 * gaps joined — measured against rule 8's limit for where it sits (early or late).
 */
function gapWithout(scenes: StoryboardScene[], j: number): number {
  const t = starts(scenes);
  let p = j - 1;
  while (p >= 0 && !scenes[p].hostPresent) p--;
  let n = j + 1;
  while (n < scenes.length && !scenes[n].hostPresent) n++;
  const from = p >= 0 ? t[p] + len(scenes[p]) : 0;
  const to = n < scenes.length ? t[n] : t[t.length - 1] + len(scenes[scenes.length - 1]);
  const limit =
    (from + to) / 2 < HOST_GAP_EARLY_ZONE_SEC ? HOST_GAP_EARLY_MAX_SEC : HOST_GAP_LATE_MAX_SEC;
  return (to - from) / limit;
}

/** Margin the gate keeps under rule 8's limits, so the final cut cannot tip a gap over. */
const GAP_MARGIN = 0.92;
/**
 * An intro/outro SECTION host beat may be given back only when it sits this tight against its
 * neighbours (the stretch it leaves is under half the limit): the sections cut host and b-roll
 * back and forth, and Ruth's opening had the host at 0, 5 and 13 s while 2:19 went 49 s without
 * her — a budget spent where it was least needed.
 */
const SECTION_SPARE_GAP = 0.5;

/**
 * The host beat that can be given back to the pictures at least cost to the rhythm, or -1. Never
 * the start, the intro, a CTA, the end, or a beat already sent to the lip-sync lane (its render
 * is paid for); a section beat only when it is crowded (`SECTION_SPARE_GAP`).
 */
function findSpare(scenes: StoryboardScene[], sectionSec: number, except: number[]): number {
  let spare = -1;
  let spareGap = Infinity;
  scenes.forEach((h, j) => {
    if (except.includes(j) || !h.hostPresent || (h.submits?.length ?? 0) > 0) return;
    if (
      j === 0 ||
      j === scenes.length - 1 ||
      h.hostOpener ||
      h.hostIntro ||
      h.cta === true ||
      h.qrCorner ||
      fixed(h)
    )
      return;
    const limit =
      h.hostProtected || isProtectedHost(scenes, j, sectionSec) ? SECTION_SPARE_GAP : GAP_MARGIN;
    const g = gapWithout(scenes, j);
    if (g <= limit && g < spareGap) {
      spare = j;
      spareGap = g;
    }
  });
  return spare;
}

/**
 * Bring the host back inside a stretch that ran too long without them. Candidates are tried from
 * the one that best halves the stretch; past the host minutes, a check-in elsewhere whose removal
 * leaves its own stretch comfortably inside the limit goes back to a picture, and when none can,
 * the next candidate is tried. Nothing changes when no candidate fits.
 */
function fillHostGap(
  scenes: StoryboardScene[],
  at: number,
  opts: PlanGateOptions
): string | null {
  let p = at - 1;
  while (p >= 0 && !scenes[p].hostPresent) p--;
  const t = starts(scenes);
  const gapFrom = p >= 0 ? t[p] + len(scenes[p]) : 0;
  const gapTo = t[at];
  const candidates: { k: number; worst: number }[] = [];
  for (let k = p + 1; k < at; k++) {
    if (!cleanHostCandidate(scenes, k)) continue;
    candidates.push({
      k,
      worst: Math.max(t[k] - gapFrom, gapTo - (t[k] + len(scenes[k]))),
    });
  }
  candidates.sort((a, b) => a.worst - b.worst);
  for (const { k } of candidates) {
    const s = scenes[k];
    const before = { ...s };
    promoteCutawayToHost(s);
    if (opts.budgetSec == null || hostSeconds(scenes) <= opts.budgetSec + 0.5) {
      return `host brought in at ${fmt(t[k])}`;
    }
    // Pay for it with the check-in the rhythm misses least. Never the take that closes this very
    // stretch.
    const spare = findSpare(scenes, opts.sectionSec ?? 0, [k, at]);
    // One spare may not free enough — take a second if it keeps the rhythm too.
    const spares = spare >= 0 ? [spare] : [];
    for (const j of spares) scenes[j].hostPresent = false;
    while (spares.length && spares.length < 2 && hostSeconds(scenes) > opts.budgetSec + 0.5) {
      const more = findSpare(scenes, opts.sectionSec ?? 0, [k, at, ...spares]);
      if (more < 0) break;
      spares.push(more);
      scenes[more].hostPresent = false;
    }
    for (const j of spares) scenes[j].hostPresent = true;
    if (spares.length && hostSeconds(scenes) - spares.reduce((a, j) => a + len(scenes[j]), 0) <= opts.budgetSec + 0.5) {
      for (const j of spares) demoteHostToStill(scenes[j]);
      return (
        `host brought in at ${fmt(t[k])} (${spares.map(j => fmt(t[j])).join(" and ")} ` +
        `went to pictures to stay within the host minutes)`
      );
    }
    for (const key of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[key];
    Object.assign(s, before);
  }
  return hostGlimpse(scenes, p, at, opts);
}

/** A glimpse is a hand-off's host part: at most as long as the shot list lets one run. */
const GLIMPSE_MAX_SEC = HOST_PART_MAX_SEC;

/**
 * The last way into a stretch without the host: a GLIMPSE — the host says just the opening clause
 * of a sentence, then hands over to the picture at the comma. Used when no whole picture fits the
 * host minutes left: Mae's job 205 went 43 s without her because the one clean candidate was 7.4 s
 * with 6.5 s of budget left, and coming in after a comma is no longer allowed. The sentence may
 * start INSIDE a picture (Ruth's job 206: "…see what happens? | Sew your scraps into one long
 * strip, | fold it…" — no picture in her 42 s gap started on a sentence): the picture plays up to
 * it, the host says the clause, the picture carries on. The host still starts on a sentence (rule
 * 7) and hands over at a clause break (the shot list's own shape). Picks the glimpse that best
 * halves the stretch.
 */
function hostGlimpse(
  scenes: StoryboardScene[],
  p: number,
  at: number,
  opts: PlanGateOptions
): string | null {
  const room =
    opts.budgetSec == null ? Infinity : opts.budgetSec + 0.5 - hostSeconds(scenes);
  if (room < HOST_CHECKIN_MIN_SEC) return null;
  const t = starts(scenes);
  const gapFrom = p >= 0 ? t[p] + len(scenes[p]) : 0;
  const gapTo = t[at];
  type Pick = { k: number; from: number; to: number; tFrom: number; tTo: number; worst: number };
  let best: Pick | null = null;
  for (let k = p + 1; k < at; k++) {
    const s = scenes[k];
    if (!plainPicture(s) || s.narrationStartSec == null || s.narrationEndSec == null) continue;
    const words = wordsOf(textOf(s));
    const n = words.length;
    const next = scenes[k + 1];
    const timeAt = (w: number) =>
      w <= 0 ? s.narrationStartSec! : w >= n ? s.narrationEndSec! : timeAtWord(s, w, opts.silences, opts.words);
    // Where a sentence starts in this picture: its first word (unless a host take is right before
    // it — two takes back to back), and after every word that ends a sentence.
    const froms = [
      ...(startsSentence(scenes, k) && !scenes[k - 1]?.hostPresent ? [0] : []),
      ...sentenceStarts(textOf(s)),
    ];
    for (const from of froms) {
      const tFrom = timeAt(from);
      if (from > 0 && tFrom - s.narrationStartSec < SHOT_MIN_SEC) continue;
      for (let to = from + 1; to <= n; to++) {
        const breakHere =
          to < n
            ? /[,;:—–.!?…]["'”’)\]]*$/.test(words[to - 1])
            : !!next &&
              !next.hostPresent &&
              (endsSentence(textOf(s)) || (!!next.wordCut && naturalBreak(s, next)));
        if (!breakHere) continue;
        const tTo = timeAt(to);
        const head = tTo - tFrom;
        if (head < HOST_CHECKIN_MIN_SEC) continue;
        if (head <= Math.min(room, GLIMPSE_MAX_SEC) && (to === n || s.narrationEndSec - tTo >= SHOT_MIN_SEC)) {
          const worst = Math.max(t[k] + (tFrom - s.narrationStartSec) - gapFrom, gapTo - (t[k] + (tTo - s.narrationStartSec)));
          if (!best || worst < best.worst) best = { k, from, to, tFrom, tTo, worst };
        }
        break; // the first clause that is long enough — a glimpse, not a monologue
      }
    }
  }
  if (!best) return null;
  const pic = scenes[best.k];
  const words = wordsOf(textOf(pic));
  const start = pic.narrationStartSec ?? 0;
  const end = pic.narrationEndSec ?? best.tTo;
  const pieces: StoryboardScene[] = [];
  if (best.from > 0) {
    const before = { ...pic };
    reslice(before, start, best.tFrom, words.slice(0, best.from).join(" "));
    pieces.push(before);
  }
  const host: StoryboardScene = { ...pic };
  reslice(host, best.tFrom, best.tTo, words.slice(best.from, best.to).join(" "));
  promoteCutawayToHost(host);
  pieces.push(host);
  if (best.to < words.length) {
    const after = { ...pic };
    reslice(after, best.tTo, end, words.slice(best.to).join(" "));
    pieces.push(after);
  }
  // A hand-off at a clause break, the shape rule 7 accepts.
  for (const x of pieces) {
    x.wordCut = true;
    x.shotGroup = pic.shotGroup;
  }
  scenes.splice(best.k, 1, ...pieces);
  return `host brought in for a glimpse at ${fmt(t[best.k] + (best.tFrom - start))}`;
}

/**
 * Turn still pictures into moving shots until the share is met — only pictures whose own words
 * describe something moving by itself (`videoKind`: smoke, fire, steam, water, a car, a door), the
 * MAIN thing's first (2026-09-30, the operator: its moment is the one to make a video), then the
 * longest. Never hands, a person, or a camera move — the old top-up that wrote "hands gently
 * working with" a thing onto a still is gone ("never do the videos with fingers").
 */
function addMotion(scenes: StoryboardScene[], main?: string): number {
  const pics = scenes.filter(
    s => !s.hostPresent && !s.cta && !fixed(s) && !s.qrHero
  );
  const cut = pics.reduce((a, s) => a + len(s), 0);
  if (cut <= 0) return 0;
  let moving = pics.filter(s => !s.stillImage).reduce((a, s) => a + len(s), 0);
  let flipped = 0;
  // Only a picture JUDGED to move by itself (`judgeSelfMoving`) — never one merely not judged.
  const kindOf = (s: StoryboardScene) =>
    s.selfMoving === true
      ? videoKind(subjectOf(s), "object", { person: !!s.humanPresent, contact: !!s.toolContact })
      : "none";
  const isMain = (s: StoryboardScene) => (main && s.keyThing === main ? 0 : 1);
  const stills = pics
    .filter(
      s =>
        s.stillImage &&
        plainPicture(s) &&
        !s.listCut &&
        len(s) >= MOTION_MIN_SEC &&
        len(s) <= MOVING_PICTURE_MAX_SEC &&
        kindOf(s) !== "none"
    )
    .sort((a, b) => isMain(a) - isMain(b) || len(b) - len(a));
  for (const s of stills) {
    if (moving / cut >= MOTION_SHARE_TARGET) break;
    if (!s.stillImage) continue; // already turned with its topic
    // The whole topic moves together (one topic, one kind) — only when every view of it may.
    const topic = topicOf(scenes, s).filter(t => t.stillImage && !t.submits?.length);
    if (topic.some(t => len(t) > MOVING_PICTURE_MAX_SEC || kindOf(t) === "none")) continue;
    for (const t of topic) {
      t.stillImage = false;
      t.objectMotion = true;
      t.cameraMove = undefined;
      moving += len(t);
      flipped++;
    }
  }
  return flipped;
}

/**
 * Turn moving shots back into stills — the shortest first, the ones whose movement matters least —
 * until the share is back to `MOTION_SHARE_TARGET`. A clip already paid for (`submits`) is kept.
 */
function removeMotion(scenes: StoryboardScene[], main?: string): number {
  const pics = scenes.filter(s => !s.hostPresent && !s.cta && !fixed(s) && !s.qrHero);
  const cut = pics.reduce((a, s) => a + len(s), 0);
  if (cut <= 0) return 0;
  let moving = pics.filter(s => !s.stillImage).reduce((a, s) => a + len(s), 0);
  let flipped = 0;
  // The main thing's videos go last (its moment is the one worth a video), its FIRST one last of all;
  // else the shortest first.
  const firstMain = main ? scenes.find(s => s.keyThing === main && !s.hostPresent) : undefined;
  const isMain = (s: StoryboardScene) => (s === firstMain ? 2 : main && s.keyThing === main ? 1 : 0);
  const clips = pics
    .filter(s => !s.stillImage && plainPicture(s) && !s.submits?.length)
    .sort((a, b) => isMain(a) - isMain(b) || len(a) - len(b));
  for (const s of clips) {
    if (moving / cut <= MOTION_SHARE_TARGET) break;
    if (s.stillImage) continue; // already turned with its topic
    // ONE TOPIC, ONE KIND: the whole topic goes still together, never one view of it (Dale's
    // 3-min test, job 230: "coasters at the market" was a video, then its close-up a photo).
    const topic = topicOf(scenes, s).filter(t => !t.stillImage);
    if (topic.some(t => t.submits?.length)) continue;
    const sec = topic.reduce((a, t) => a + len(t), 0);
    // Never below the floor: a film with a few long clips keeps one rather than none.
    if ((moving - sec) / cut < MOTION_SHARE_MIN) continue;
    for (const t of topic) {
      t.stillImage = true;
      t.objectMotion = undefined;
      t.cameraMove = undefined;
      // A person stays in the picture (the host at work); only the movement goes.
    }
    moving -= sec;
    flipped += topic.length;
  }
  return flipped;
}

/**
 * The pictures of `s`'s TOPIC: `s` and its neighbours joined to it as the same context
 * (`sameShot` — a topic that ran past its limit continues from another view). Pure.
 */
export function topicOf(scenes: StoryboardScene[], s: StoryboardScene): StoryboardScene[] {
  const i = scenes.indexOf(s);
  if (i < 0) return [s];
  let from = i;
  while (from > 0 && scenes[from].sameShot && plainPicture(scenes[from - 1])) from--;
  let to = i;
  while (to + 1 < scenes.length && scenes[to + 1].sameShot && plainPicture(scenes[to + 1])) to++;
  return scenes.slice(from, to + 1);
}

/**
 * Any moving cutaway longer than `MOVING_PICTURE_MAX_SEC` becomes a still (never a paid clip or a
 * host take). Returns how many. Pure apart from mutating `scenes` — unit-tested.
 */
export function capMovingLength(scenes: StoryboardScene[]): number {
  let n = 0;
  for (const s of scenes) {
    if (s.hostPresent || s.stillImage || s.submits?.length) continue;
    if (!(s.humanPresent || s.objectMotion)) continue;
    if (len(s) <= MOVING_PICTURE_MAX_SEC) continue;
    s.stillImage = true;
    s.objectMotion = undefined;
    s.cameraMove = undefined;
    n++;
  }
  return n;
}

const subjectOf = (s: StoryboardScene) => s.showSubject ?? s.visualPrompt ?? "";

/**
 * Every moving shot follows the video rule (`videoKind`): a moving cutaway with hands, a person, a
 * tool biting in or a small or intricate subject becomes a photo (a person in it stays, as the host
 * at work); one of a big thing gets its kind — moving by itself, or the camera moving. A split
 * screen's right half (person-free) moves only when it shows a thing that moves by itself. A clip
 * already paid for is left alone. Returns how many shots it changed.
 */
export function settleMotion(scenes: StoryboardScene[]): number {
  let changed = 0;
  for (const s of scenes) {
    if (s.hostPresent) {
      if (s.splitMotion && s.splitSelfMoving !== true) {
        s.splitMotion = undefined;
        changed++;
      }
      continue;
    }
    if (s.submits?.length) continue;
    if (!s.stillImage && !s.toolContact && contactToolWork(subjectOf(s))) s.toolContact = true;
    if (settleVideoKind(s)) changed++;
  }
  return changed;
}

/**
 * Check the plan against every plan rule and fix what fails, before anything is paid for. One fix
 * per round, re-checked after each, so a fix that breaks another rule is caught the next round. A
 * finding the gate cannot fix (or that comes straight back) is returned in `unresolved` — the
 * film still renders, and the job says what is left. Mutates scenes where it can and returns the
 * (renumbered) list; any scene whose narration range moved has its `audioUrl` cleared for the
 * caller to re-cut from the master.
 */
export function enforcePlanRules(
  input: StoryboardScene[],
  params: LongformInputParams,
  options: PlanGateOptions = {}
): PlanGateResult {
  // Every cut below is placed from the transcript's word times, and a number's is a guess, usually
  // late — put back where its sound begins first (job 406: "Three hundred | seventy pages").
  const opts: PlanGateOptions =
    options.words?.length && options.silences?.length
      ? { ...options, words: retimeSpokenNumbers(options.words, options.silences) }
      : options;
  let scenes = input;
  const fixes: string[] = [];
  const given = new Set<string>();
  const renumber = () => scenes.forEach((s, k) => (s.index = k + 1));
  const canHost = canHostFor(params);
  const mainThing = params.keyThings?.find(k => k.main)?.name;
  const calmed = settleMotion(scenes);
  if (calmed) {
    fixes.push(`${calmed} moving shot(s) held to the video rule (only what moves by itself, never hands)`);
  }
  for (let round = 0; round < 200; round++) {
    const open = checkPlan(scenes, params)
      .findings.filter(f => !given.has(`${f.rule}|${f.detail}`))
      .sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
    const f = open[0];
    if (!f) break;
    const i = f.scene != null ? scenes.findIndex(s => s.index === f.scene) : -1;
    const s = i >= 0 ? scenes[i] : undefined;
    let did: string | null = null;

    if (f.rule === 2) {
      const block = Number(/^block (\d+)/.exec(f.detail)?.[1]);
      const run = scenes.filter(x => inMarkedCta(x) && x.ctaIndex === block);
      if (/split screen/.test(f.detail)) {
        run.forEach(x => (x.splitVisual = undefined));
        did = `CTA ${block + 1}: split screen removed`;
      } else if (/b-roll in the pitch/.test(f.detail) && canHost) {
        const firstQr = run.findIndex(x => x.qrHero);
        const pitch = run.slice(0, firstQr < 0 ? run.length : firstQr);
        const pic = pitch.find(x => !x.hostPresent && !fixed(x));
        if (pic) {
          promoteCutawayToHost(pic);
          did = `CTA ${block + 1}: pitch picture handed to the host`;
        }
      }
    } else if (f.rule === 6 && s) {
      if (s.hostPresent) s.splitVisual = undefined;
      else promoteCutawayToHost(s);
      s.hostIntro = true;
      did = `introduction put on camera at scene ${s.index}`;
    } else if (f.rule === 7 && s && i > 0 && /picture blink/.test(f.detail)) {
      const host = i - 1;
      let n = 0;
      while (
        plainPicture(scenes[host + 1]) &&
        sameRegister(scenes[host], scenes[host + 1])
      ) {
        scenes = mergeInto(scenes, host, host + 1);
        n++;
      }
      const after = scenes[host + 1];
      if (
        n > 0 &&
        after?.hostPresent &&
        !after.splitVisual &&
        !scenes[host].splitVisual &&
        sameRegister(scenes[host], after) &&
        len(scenes[host]) + len(after) <= HOST_JOIN_MAX_SEC
      ) {
        // One take, so no angle change mid-thought; the later take's roles come along.
        scenes[host].hostProtected ||= after.hostProtected;
        if (after.hostIntro) scenes[host].hostIntro = true;
        scenes = mergeInto(scenes, host, host + 1);
      }
      if (n > 0) did = `picture blink at scene ${s.index} given back to the host (${n} picture(s))`;
    } else if (f.rule === 7 && s && i >= 0 && /^unseen beat/.test(f.detail)) {
      // Its words join a neighbour (the same words first), which keeps its own picture, list mark
      // and roles; a QR, cover or asset beat is never folded and stays named on the job.
      const into = unseenFoldTarget(scenes, i);
      if (into >= 0) {
        const keep = scenes[into];
        const was = {
          listCut: keep.listCut,
          start: keep.narrationStartSec,
          end: keep.narrationEndSec,
          audioUrl: keep.audioUrl,
        };
        const host = !!keep.hostPresent;
        const roles = { intro: host && !!s.hostIntro, anchor: host && !!s.hostProtected };
        scenes = mergeInto(scenes, into, i);
        keep.listCut = was.listCut;
        if (roles.intro) keep.hostIntro = true;
        if (roles.anchor) keep.hostProtected = true;
        // Nothing was said in the unseen beat: a range that did not move keeps its slice.
        if (keep.narrationStartSec === was.start && keep.narrationEndSec === was.end)
          keep.audioUrl = was.audioUrl;
        did = `unseen beat at scene ${s.index} joined scene ${keep.index}`;
      }
    } else if (f.rule === 7 && s && i >= 0) {
      const protectedHost = isProtectedHost(scenes, i, opts.sectionSec ?? 0);
      const prev = scenes[i - 1];
      const next = scenes[i + 1];
      const finished = /starts mid-sentence/.test(f.detail)
        ? finishSentenceBeforeHost(scenes, i, opts.silences, opts.words)
        : /ends mid-sentence/.test(f.detail)
          ? finishSentenceAfterHost(scenes, i, params, opts)
          : null;
      if (finished) {
        scenes = finished.scenes;
        did = `host take at scene ${s.index} ${finished.how}`;
      } else if (
        /mid-sentence|host take only/.test(f.detail) &&
        s.hostPresent &&
        !protectedHost
      ) {
        demoteHostToStill(s);
        did =
          `host take at scene ${s.index} made a picture ` +
          `(${/only/.test(f.detail) ? "too short" : "cut mid-sentence"})`;
      } else if (s.hostPresent && /flash shot|host take only/.test(f.detail)) {
        // A protected host too short to read keeps the picture beside it.
        // Never a list item's picture (`mergeable`): the item would lose it.
        const into =
          plainPicture(next) && mergeable(next, s) && sameRegister(s, next)
            ? i + 1
            : plainPicture(prev) && mergeable(prev, s) && sameRegister(s, prev)
              ? i - 1
              : -1;
        if (into >= 0) {
          scenes = mergeInto(scenes, i, into);
          did = `short host take at scene ${s.index} kept the picture beside it`;
        }
      } else if (!s.hostPresent && /flash shot/.test(f.detail)) {
        const group = (n: StoryboardScene | undefined) =>
          !!n && n.shotGroup != null && n.shotGroup === s.shotGroup;
        // Never INTO a list item (`mergeable`): the joined shot would lose the item's own picture.
        const ok = (n: StoryboardScene | undefined) =>
          !!n && mergeable(n, s) && sameRegister(s, n) && (n.hostPresent === true || plainPicture(n));
        const into =
          plainPicture(prev) && group(prev) && ok(prev)
            ? i - 1
            : plainPicture(next) && group(next) && ok(next)
              ? i + 1
              : plainPicture(prev) && ok(prev)
                ? i - 1
                : plainPicture(next) && ok(next)
                  ? i + 1
                  : ok(prev)
                    ? i - 1
                    : ok(next)
                      ? i + 1
                      : -1;
        if (into >= 0) {
          scenes = mergeInto(scenes, into, i);
          did = `flash shot at scene ${s.index} joined the shot beside it`;
        } else if (
          leadInBetweenItems(scenes, i) &&
          plainPicture(s) &&
          plainPicture(next) &&
          sameRegister(s, next)
        ) {
          // A lead-in between two list items ("So tonight," — production job 200 #184) leads into
          // the item after it, which keeps its own picture and its list mark.
          scenes = mergeInto(scenes, i + 1, i);
          next.listCut = true;
          did = `lead-in at scene ${s.index} joined the list item after it`;
        }
      }
    } else if (f.rule === 9 && s && i >= 0) {
      const split = splitLingering(scenes, i, opts.silences, opts.words);
      if (split) {
        scenes = split;
        did = `picture at scene ${s.index} (${len(s).toFixed(1)}s) split into shots`;
      }
    } else if (f.rule === 8 && i >= 0) {
      did = fillHostGap(scenes, i, opts);
    } else if (f.rule === 15 && s) {
      if (settleVideoKind(s)) did = `video at scene ${s.index} made a photo (nothing moves by itself, or hands)`;
    } else if (f.rule === 11 && /too much video/.test(f.detail)) {
      const n = removeMotion(scenes, mainThing);
      if (n) did = `${n} moving shot(s) made still pictures — fewer video clips`;
    } else if (f.rule === 11) {
      const n = addMotion(scenes, mainThing);
      if (n) did = `${n} still picture(s) made moving shots for the real-video share`;
    }

    if (did) {
      fixes.push(did);
      renumber();
    } else {
      given.add(`${f.rule}|${f.detail}`);
    }
  }
  // The host minutes are a promise: a plan that came in over them (joins and CTA passes add a few
  // seconds late) gives back crowded beats until it fits — never a start, intro, CTA, end or paid
  // render, and never one whose removal breaks the rhythm.
  if (opts.budgetSec != null) {
    while (hostSeconds(scenes) > opts.budgetSec + 0.5) {
      const j = findSpare(scenes, opts.sectionSec ?? 0, []);
      if (j < 0) break;
      const at = starts(scenes)[j];
      demoteHostToStill(scenes[j]);
      fixes.push(`host beat at ${fmt(at)} went to a picture to stay within the host minutes`);
    }
  }
  // A video can only be as long as the video model renders (15 s); longer, it freezes on its last
  // frame for the rest (Hank's 3-min test, job 227: an 18 s "video" the motion top-up had picked as
  // the LONGEST still). Whatever made it moving, a picture past the cap is a photo — the person in
  // it stays, only the movement goes. A clip already paid for is left alone.
  const tooLong = capMovingLength(scenes);
  if (tooLong) fixes.push(`${tooLong} video(s) longer than ${MOVING_PICTURE_MAX_SEC} s made a photo`);
  // A host take the gate (or a host pass before it) placed inside a same-topic run ends that topic
  // there (`breakTopicsAtHostTakes`): job 405's glimpse left the cat's close-up on both sides of "The
  // honest word is crepuscular," with identical words, and it was drawn twice.
  const broken = breakTopicsAtHostTakes(scenes);
  if (broken) fixes.push(`${broken} picture(s) after a host take no longer continue the picture before it`);
  renumber();
  const unresolved = checkPlan(scenes, params).findings;
  return { scenes, fixes, unresolved };
}

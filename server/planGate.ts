/**
 * The plan rules every film must pass — checked, and FIXED, inside the pipeline before a single
 * clip is paid for, instead of found afterwards by `scripts/stress/audit.mts`. The audit imports
 * `checkPlan` from here, so the rehearsal's verdict and the pipeline's gate are the same code.
 *
 *  1. No pause after a CTA            — no automatic hold anywhere.
 *  2. CTA order                       — host → book → host → big QR, the QR moves once.
 *  6. Self-introduction on camera     — "I'm <host>" is the host, full frame.
 *  7. Clean host switches             — host takes start on a sentence and end on one (or hand over
 *                                       at a shot-list break); no flash shots.
 *  8. Host often                      — ≤40 s without the host in the first 3 min, ≤75 s after.
 *  9. Pictures don't linger           — a picture outside the CTA runs ≤6.5 s.
 * 11. Real video                      — ≥30% of cutaway time moves.
 * (Rules 3-5 and 10 are judged on the pictures as they are made; 12 on the voice at voicing.)
 */
import type { StoryboardScene, LongformInputParams } from "../shared/types";
import { sceneHoldPlan } from "../shared/filmTimeline";
import type { SilenceInterval } from "./videoAssembly";
import {
  demoteHostToStill,
  promoteCutawayToHost,
  introducesHost,
  endsSentence,
  startsSentence,
  qrPlacementFor,
  HOST_SENTENCE_MAX_SEC,
  FLASH_SHOT_SEC,
  inMarkedCta,
} from "./longformVideo";
import {
  HOST_HANDOFF_MIN_SEC,
  LIST_SHOT_MIN_SEC,
  MAX_PICTURE_SEC,
  MOTION_MIN_SEC,
  MOVES_ON_ITS_OWN,
  SHOWS_HANDS,
  SHOT_MIN_SEC,
  splitPicture,
} from "./shotList";

export type PlanFinding = { rule: number; scene?: number; detail: string };
type Finding = PlanFinding;

/** Rule 8: the longest stretch without the host — early (gap mostly in the first 3 min), late. */
export const HOST_GAP_EARLY_ZONE_SEC = 180;
export const HOST_GAP_EARLY_MAX_SEC = 40;
export const HOST_GAP_LATE_MAX_SEC = 75;
/** Rule 9: the longest a picture outside the CTA may stay on screen. */
export const PICTURE_MAX_SEC = 6.5;
/** Rule 11: the share of cutaway time that must move. */
export const MOTION_SHARE_MIN = 0.3;

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
    const flash = s.listCut ? LIST_SHOT_MIN_SEC : s.wordCut ? SHOT_MIN_SEC : FLASH_SHOT_SEC;
    // The final snap onto real pauses moves a cut by up to ~0.2 s after the shot list measured it.
    if (len(s) > 0 && len(s) < flash - 0.2)
      findings.push({ rule: 7, scene: s.index, detail: `flash shot ${len(s).toFixed(2)}s` });
    if (!s.hostPresent || fixed(s)) return;
    if (len(s) > 0 && len(s) < HOST_HANDOFF_MIN_SEC - 0.05)
      findings.push({ rule: 7, scene: s.index, detail: `host take only ${len(s).toFixed(2)}s` });
    const prev = scenes[i - 1];
    const next = scenes[i + 1];
    const capped = (n: StoryboardScene | undefined) =>
      // Same ceiling the pipeline stretched to; final alignment moves lengths a little.
      !!n && len(s) + len(n) > HOST_SENTENCE_MAX_SEC - 0.5;
    const edge = (n: StoryboardScene | undefined) =>
      !n || fixed(n) || n.hostPresent || (n.cta === true) !== (s.cta === true) || n.ctaIndex !== s.ctaIndex;
    // A hand-off: the shot list cut the rest of the line into pictures at a natural break.
    const handsOff = !!next && !next.hostPresent && !!next.wordCut && !!s.wordCut;
    // A host may come in at a clean break inside a sentence — after a comma/dash the shot list cut on.
    const cleanIn =
      !!s.wordCut && !!prev?.wordCut && !prev.listCut && /[,;:—–-]["'”’)\]]*$/.test(textOf(prev).trim());
    const badStart = !startsSentence(scenes, i) && !edge(prev) && !capped(prev) && !cleanIn;
    const badEnd = !endsSentence(textOf(s)) && !edge(next) && !capped(next) && !handsOff;
    if (badStart || badEnd) {
      midTakes++;
      findings.push({
        rule: 7,
        scene: s.index,
        detail: `host take ${badStart ? "starts" : "ends"} mid-sentence: "${textOf(s).slice(0, 70)}"`,
      });
    }
  });

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

  // 9. No lingering picture outside the CTA.
  const pictures = scenes.filter(s => !s.hostPresent && !s.cta && !fixed(s) && !s.qrHero);
  let longest = 0;
  for (const s of pictures) {
    longest = Math.max(longest, len(s));
    if (len(s) > PICTURE_MAX_SEC)
      findings.push({ rule: 9, scene: s.index, detail: `picture on screen ${len(s).toFixed(1)}s: "${textOf(s).slice(0, 60)}"` });
  }

  // 11. Real video: share of cutaway time that is a moving shot.
  const cutSec = pictures.reduce((a, s) => a + len(s), 0);
  const motionSec = pictures.filter(s => !s.stillImage).reduce((a, s) => a + len(s), 0);
  const motionShare = cutSec > 0 ? motionSec / cutSec : 0;
  if (motionShare < MOTION_SHARE_MIN)
    findings.push({ rule: 11, detail: `only ${(motionShare * 100).toFixed(0)}% of cutaway time is moving` });

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
      handOffs: scenes.filter((s, i) => s.hostPresent && s.wordCut && scenes[i + 1]?.wordCut && !scenes[i + 1]?.hostPresent).length,
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
};

export type PlanGateResult = {
  scenes: StoryboardScene[];
  /** What was changed, in plain words, for the render log. */
  fixes: string[];
  /** What could not be fixed (the job warns with these). */
  unresolved: PlanFinding[];
};

/** Rules fixed first: the structure before the rhythm, the rhythm before the video share. */
const RULE_ORDER = [1, 2, 6, 7, 9, 8, 11];
/**
 * The motion share the gate aims for — over the rule by enough that the clip stage's own swaps
 * cannot sink it: the glitch check turns a clip that moves wrong twice into its still, and on
 * Hank's first real render (job 175) four of those took a 31% plan to 29.8%.
 */
const MOTION_SHARE_TARGET = MOTION_SHARE_MIN + 0.03;

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

/** Split a lingering picture into shots at clause breaks, cutting on pauses in the voice. */
function splitLingering(
  scenes: StoryboardScene[],
  i: number,
  silences: SilenceInterval[] | undefined
): StoryboardScene[] | null {
  const s = scenes[i];
  const from = s.narrationStartSec;
  const to = s.narrationEndSec;
  if (from == null || to == null) return null;
  const parts = splitPicture(s, Math.ceil(len(s) / (MAX_PICTURE_SEC - 0.5)));
  if (parts.length < 2) return null;
  const counts = parts.map(p => wordsOf(p.scriptText ?? "").length);
  const total = counts.reduce((a, b) => a + b, 0);
  let acc = 0;
  let prev = from;
  parts.forEach((p, k) => {
    acc += counts[k];
    const ideal = from + ((to - from) * acc) / total;
    const end = k === parts.length - 1 ? to : snapToPause(ideal, silences);
    p.narrationStartSec = prev;
    p.narrationEndSec = Math.max(prev + 0.1, Math.min(to, end));
    p.audioDuration = p.narrationEndSec - p.narrationStartSec;
    p.audioUrl = undefined;
    if (!p.stillImage && p.audioDuration < MOTION_MIN_SEC) {
      p.stillImage = true;
      p.humanPresent = undefined;
      p.objectMotion = undefined;
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
 * A picture that can become a clean host take: whole sentences, or in at a comma and out at a
 * shot-list break — the same shapes rule 7 accepts. Never next to another host take.
 */
function cleanHostCandidate(scenes: StoryboardScene[], k: number): boolean {
  const s = scenes[k];
  if (!plainPicture(s)) return false;
  const d = len(s);
  if (d < 2.5 || d > 9) return false;
  const prev = scenes[k - 1];
  const next = scenes[k + 1];
  if (prev?.hostPresent || next?.hostPresent) return false;
  const inClean =
    startsSentence(scenes, k) ||
    (!!s.wordCut &&
      !!prev?.wordCut &&
      !prev.listCut &&
      /[,;:—–-]["'”’)\]]*$/.test(textOf(prev).trim()));
  const outClean =
    endsSentence(textOf(s)) ||
    (!!s.wordCut && !!next?.wordCut && !next.hostPresent);
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
  return null;
}

/** Turn the longest still pictures into moving shots until the share is met. */
function addMotion(scenes: StoryboardScene[]): number {
  const pics = scenes.filter(
    s => !s.hostPresent && !s.cta && !fixed(s) && !s.qrHero
  );
  const cut = pics.reduce((a, s) => a + len(s), 0);
  if (cut <= 0) return 0;
  let moving = pics.filter(s => !s.stillImage).reduce((a, s) => a + len(s), 0);
  let flipped = 0;
  // Only a shot that CAN move for real: hands at work, or a thing that moves by itself. An
  // ordinary object set moving slides around on its own, which is worse than a still.
  const stills = pics
    .filter(
      s =>
        s.stillImage &&
        plainPicture(s) &&
        len(s) >= MOTION_MIN_SEC &&
        (SHOWS_HANDS.test(subjectOf(s)) || MOVES_ON_ITS_OWN.test(subjectOf(s)))
    )
    .sort((a, b) => len(b) - len(a));
  for (const s of stills) {
    if (moving / cut >= MOTION_SHARE_TARGET) break;
    const hands = SHOWS_HANDS.test(subjectOf(s));
    s.stillImage = false;
    s.humanPresent = hands ? true : undefined;
    s.objectMotion = hands ? undefined : true;
    moving += len(s);
    flipped++;
  }
  // Still short (Ruth's plan had NO still with hands in it): a still of a THING becomes hands
  // working with that thing — real movement with a hand on it, the thing still the centre. Never
  // a place or a wide scene, where hands would be a guess.
  if (moving / cut < MOTION_SHARE_TARGET) {
    const things = pics
      .filter(
        s =>
          s.stillImage &&
          plainPicture(s) &&
          !s.listCut &&
          len(s) >= MOTION_MIN_SEC &&
          !NOT_A_THING.test(subjectOf(s))
      )
      .sort((a, b) => len(b) - len(a));
    for (const s of things) {
      if (moving / cut >= MOTION_SHARE_TARGET) break;
      const subject = subjectOf(s);
      s.showSubject = `hands gently working with ${subject}`;
      s.visualPrompt = `Hands gently working with the subject, which stays the centre of the frame: ${s.visualPrompt ?? subject}`;
      s.visualPromptSeed = undefined;
      s.stillImage = false;
      s.humanPresent = true;
      s.objectMotion = undefined;
      moving += len(s);
      flipped++;
    }
  }
  return flipped;
}

/** Subjects that are a place or a wide scene, not a thing a hand could work with. */
const NOT_A_THING =
  /\b(booth|stall|market|fair|store|shop|aisle|porch|patio|garden|field|yard|room|kitchen|house|home|church|hall|hospital|street|town|wall|shelf|shelves|display|crowd|people|wide|landscape|window)\b/i;

const subjectOf = (s: StoryboardScene) => s.showSubject ?? s.visualPrompt ?? "";

/**
 * Nothing moves on its own: a moving cutaway of an ordinary object becomes a hands shot when
 * hands are in it, else a still; a split screen's right half (never hands — it is person-free)
 * moves only when it shows a thing that moves by itself. Returns how many shots it changed.
 */
export function settleMotion(scenes: StoryboardScene[]): number {
  let changed = 0;
  for (const s of scenes) {
    if (s.hostPresent) {
      if (s.splitMotion && !MOVES_ON_ITS_OWN.test(String(s.splitVisual ?? ""))) {
        s.splitMotion = undefined;
        changed++;
      }
      continue;
    }
    if (s.stillImage || !s.objectMotion || MOVES_ON_ITS_OWN.test(subjectOf(s))) continue;
    if (SHOWS_HANDS.test(subjectOf(s))) {
      s.objectMotion = undefined;
      s.humanPresent = true;
    } else {
      s.stillImage = true;
      s.objectMotion = undefined;
    }
    changed++;
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
  opts: PlanGateOptions = {}
): PlanGateResult {
  let scenes = input;
  const fixes: string[] = [];
  const given = new Set<string>();
  const renumber = () => scenes.forEach((s, k) => (s.index = k + 1));
  const canHost = canHostFor(params);
  const calmed = settleMotion(scenes);
  if (calmed) {
    fixes.push(`${calmed} shot(s) that would have moved on their own made still or hands`);
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
    } else if (f.rule === 7 && s && i >= 0) {
      const protectedHost = isProtectedHost(scenes, i, opts.sectionSec ?? 0);
      const prev = scenes[i - 1];
      const next = scenes[i + 1];
      if (
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
        const into =
          plainPicture(next) && sameRegister(s, next)
            ? i + 1
            : plainPicture(prev) && sameRegister(s, prev)
              ? i - 1
              : -1;
        if (into >= 0) {
          scenes = mergeInto(scenes, i, into);
          did = `short host take at scene ${s.index} kept the picture beside it`;
        }
      } else if (!s.hostPresent && /flash shot/.test(f.detail)) {
        const group = (n: StoryboardScene | undefined) =>
          !!n && n.shotGroup != null && n.shotGroup === s.shotGroup;
        const ok = (n: StoryboardScene | undefined) =>
          !!n && sameRegister(s, n) && (n.hostPresent === true || plainPicture(n));
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
        }
      }
    } else if (f.rule === 9 && s && i >= 0) {
      const split = splitLingering(scenes, i, opts.silences);
      if (split) {
        scenes = split;
        did = `picture at scene ${s.index} (${len(s).toFixed(1)}s) split into shots`;
      }
    } else if (f.rule === 8 && i >= 0) {
      did = fillHostGap(scenes, i, opts);
    } else if (f.rule === 11) {
      const n = addMotion(scenes);
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
  renumber();
  const unresolved = checkPlan(scenes, params).findings;
  return { scenes, fixes, unresolved };
}

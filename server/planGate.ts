/**
 * The plan rules every film must pass — checked, and FIXED, inside the pipeline before a single
 * clip is paid for, instead of found afterwards by `scripts/stress/audit.mts`. The audit imports
 * `checkPlan` from here, so the rehearsal's verdict and the pipeline's gate are the same code.
 *
 *  1. No pause after a CTA            — no automatic hold anywhere.
 *  2. CTA order                       — host → book → host → big QR, the QR moves once.
 *  6. Self-introduction on camera     — "I'm <host>" is the host, full frame.
 *  7. Clean host switches             — host takes start on a sentence (never after a comma; a take
 *                                       that does takes its sentence back, `finishSentenceBeforeHost`)
 *                                       and end on one (or hand over at a shot-list break); no flash
 *                                       shots.
 *  8. Host often                      — ≤40 s without the host in the first 3 min, ≤75 s after.
 *  9. Pictures don't linger           — a picture outside the CTA runs ≤6.5 s.
 * 11. Real video                      — ≥30% of cutaway time moves.
 * (Rules 3-5 and 10 are judged on the pictures as they are made; 12 on the voice at voicing.)
 */
import type { StoryboardScene, LongformInputParams } from "../shared/types";
import { sceneHoldPlan } from "../shared/filmTimeline";
import type { SilenceInterval } from "./videoAssembly";
import { SHOWS_PERSON } from "./hostLook";
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
  inMarkedCta,
} from "./longformVideo";
import {
  HOST_HANDOFF_MIN_SEC,
  HOST_PART_MAX_SEC,
  LIST_SHOT_MIN_SEC,
  MAX_PICTURE_SEC,
  pictureMaxSecAt,
  MOTION_MIN_SEC,
  MOVING_PICTURE_MAX_SEC,
  MOVES_ON_ITS_OWN,
  SHOWS_HANDS,
  contactToolWork,
  SHOT_MIN_SEC,
  splitPicture,
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
    // The host comes in only once the sentence before has finished — never after a comma (allowed
    // until 2026-09-28; the operator saw it as the host cutting in mid-sentence). Excused only when
    // the sentence's OWN start is too far back to take whole — not the whole picture before: Mae's
    // 13.7 s picture held just 4 s of the sentence her host cut into.
    const leadTooLong = len(s) + sentenceLeadSec(scenes, i) > HOST_SENTENCE_MAX_SEC - 0.5;
    const badStart = !startsSentence(scenes, i) && !edge(prev) && !leadTooLong;
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
const RULE_ORDER = [1, 2, 6, 7, 9, 8, 11];
/**
 * The shortest run of pictures between two host takes. Shorter, the host leaves and comes straight
 * back — a blink, not a cutaway (Norbert's 3-min test, job 232: host → 0.6 s "the drill" → 1.3 s
 * "or the handyman" → host, in the goodbye). The host keeps those words instead.
 */
export const PICTURE_RUN_MIN_SEC = 2; // the same floor as a host part (`HOST_HANDOFF_MIN_SEC`)
/**
 * The motion share the gate aims for — over the rule by enough that the clip stage's own swaps
 * cannot sink it: the glitch check turns a clip that moves wrong twice into its still, and on
 * Hank's first real render (job 175) four of those took a 31% plan to 29.8%.
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

/** One spoken word of the master, in seconds (the voicing transcript's shape). */
export type TimedWord = { start: number; end: number };

/**
 * The cut before the word `share` of the way through the span [from, to], placed in the REAL gap
 * between two spoken words: the transcript's words inside the span are counted, the one at that
 * share is found, and the cut goes in a pause inside the gap before it when there is one, else in
 * the middle of the gap. Null without enough words to go on. Pure — unit-tested via the gate.
 */
function gapBeforeWord(
  from: number,
  to: number,
  share: number,
  silences: SilenceInterval[] | undefined,
  words: TimedWord[] | undefined
): number | null {
  if (!words?.length) return null;
  const inSpan = words.filter(w => w.start >= from - 0.05 && w.end <= to + 0.05);
  if (inSpan.length < 2) return null;
  const k = Math.min(inSpan.length - 1, Math.max(1, Math.round(share * inSpan.length)));
  const a = inSpan[k - 1].end;
  const b = Math.max(a, inSpan[k].start);
  const pause = (silences ?? []).find(p => p.end > a && p.start < b);
  const cut = pause ? (Math.max(pause.start, a) + Math.min(pause.end, b)) / 2 : (a + b) / 2;
  return Math.min(to - 0.05, Math.max(from + 0.05, cut));
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
  const n = Math.max(1, wordsOf(textOf(s)).length);
  const exact = gapBeforeWord(from, to, k / n, silences, words);
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
 * starts at its own next sentence and the picture before keeps saying the rest of this one — as
 * long as the host keeps a readable part. Null when neither fits (the caller demotes the take, or
 * leaves a protected one and reports it). Pure — unit-tested through `enforcePlanRules`.
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

  // FORWARD — the host starts at its next sentence; the picture before finishes this one.
  const prev = scenes[i - 1];
  const starts = sentenceStarts(textOf(host));
  if (!plainPicture(prev) || !sameRegister(prev, host) || starts.length === 0) return null;
  const at = timeAtWord(host, starts[0], silences, timed);
  if ((host.narrationEndSec ?? at) - at < HOST_HANDOFF_MIN_SEC) return null;
  const words = wordsOf(textOf(host));
  reslice(
    prev,
    prev.narrationStartSec ?? 0,
    at,
    `${textOf(prev).trim()} ${words.slice(0, starts[0]).join(" ")}`.trim()
  );
  reslice(host, at, host.narrationEndSec ?? at, words.slice(starts[0]).join(" "));
  return { scenes, how: `now starts on its next sentence` };
}

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
 * A picture that can become a clean host take: in at the start of a sentence, out at its end or
 * at a shot-list break — the same shapes rule 7 accepts. Never next to another host take.
 */
function cleanHostCandidate(scenes: StoryboardScene[], k: number): boolean {
  const s = scenes[k];
  if (!plainPicture(s)) return false;
  const d = len(s);
  if (d < 2.5 || d > 9) return false;
  const prev = scenes[k - 1];
  const next = scenes[k + 1];
  if (prev?.hostPresent || next?.hostPresent) return false;
  const inClean = startsSentence(scenes, k);
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
            : !!next && !next.hostPresent && (endsSentence(textOf(s)) || !!next.wordCut);
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
        len(s) <= MOVING_PICTURE_MAX_SEC &&
        !s.toolContact &&
          !contactToolWork(subjectOf(s)) &&
        (SHOWS_HANDS.test(subjectOf(s)) || MOVES_ON_ITS_OWN.test(subjectOf(s)))
    )
    .sort((a, b) => len(b) - len(a));
  for (const s of stills) {
    if (moving / cut >= MOTION_SHARE_TARGET) break;
    if (!s.stillImage) continue; // already turned with its topic
    const hands = SHOWS_HANDS.test(subjectOf(s));
    // The whole topic moves together (one topic, one kind) — each view that a video can carry.
    const topic = topicOf(scenes, s).filter(
      t => t.stillImage && !t.submits?.length && len(t) <= MOVING_PICTURE_MAX_SEC
    );
    for (const t of topic) {
      t.stillImage = false;
      t.humanPresent = hands ? true : undefined;
      t.objectMotion = hands ? undefined : true;
      moving += len(t);
      flipped++;
    }
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
          len(s) <= MOVING_PICTURE_MAX_SEC &&
          !s.toolContact &&
          !contactToolWork(subjectOf(s)) &&
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

/**
 * Turn moving shots back into stills — the shortest first, the ones whose movement matters least —
 * until the share is back to `MOTION_SHARE_TARGET`. A clip already paid for (`submits`) is kept.
 */
function removeMotion(scenes: StoryboardScene[]): number {
  const pics = scenes.filter(s => !s.hostPresent && !s.cta && !fixed(s) && !s.qrHero);
  const cut = pics.reduce((a, s) => a + len(s), 0);
  if (cut <= 0) return 0;
  let moving = pics.filter(s => !s.stillImage).reduce((a, s) => a + len(s), 0);
  let flipped = 0;
  const clips = pics
    .filter(s => !s.stillImage && plainPicture(s) && !s.submits?.length)
    .sort((a, b) => len(a) - len(b));
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
    n++;
  }
  return n;
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
    // A tool biting into material is a photo, however it became moving (`contactToolWork`).
    if (
      !s.stillImage &&
      !s.submits?.length &&
      (s.toolContact || contactToolWork(subjectOf(s)))
    ) {
      s.stillImage = true;
      s.objectMotion = undefined;
      changed++;
      continue;
    }
    // A hands video must show hands or a person (Ruth's job 239: a moving coffee tin).
    if (
      !s.stillImage &&
      !s.objectMotion &&
      !s.submits?.length &&
      !SHOWS_HANDS.test(subjectOf(s)) &&
      !SHOWS_PERSON.test(subjectOf(s))
    ) {
      s.stillImage = true;
      changed++;
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
    } else if (f.rule === 7 && s && i >= 0) {
      const protectedHost = isProtectedHost(scenes, i, opts.sectionSec ?? 0);
      const prev = scenes[i - 1];
      const next = scenes[i + 1];
      const finished = /starts mid-sentence/.test(f.detail)
        ? finishSentenceBeforeHost(scenes, i, opts.silences, opts.words)
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
      const split = splitLingering(scenes, i, opts.silences, opts.words);
      if (split) {
        scenes = split;
        did = `picture at scene ${s.index} (${len(s).toFixed(1)}s) split into shots`;
      }
    } else if (f.rule === 8 && i >= 0) {
      did = fillHostGap(scenes, i, opts);
    } else if (f.rule === 11 && /too much video/.test(f.detail)) {
      const n = removeMotion(scenes);
      if (n) did = `${n} moving shot(s) made still pictures — fewer video clips`;
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
  // A video can only be as long as the video model renders (15 s); longer, it freezes on its last
  // frame for the rest (Hank's 3-min test, job 227: an 18 s "video" the motion top-up had picked as
  // the LONGEST still). Whatever made it moving, a picture past the cap is a photo — the person in
  // it stays, only the movement goes. A clip already paid for is left alone.
  const tooLong = capMovingLength(scenes);
  if (tooLong) fixes.push(`${tooLong} video(s) longer than ${MOVING_PICTURE_MAX_SEC} s made a photo`);
  renumber();
  const unresolved = checkPlan(scenes, params).findings;
  return { scenes, fixes, unresolved };
}

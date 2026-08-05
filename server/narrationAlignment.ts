/**
 * server/narrationAlignment.ts
 *
 * Align ONE continuous master narration (the full script voiced in a single TTS call) back to
 * per-scene time ranges, so the master can be sliced into per-scene tracks and the rest of the
 * long-form pipeline keeps seeing a per-scene `audioUrl` + `audioDuration`.
 *
 * Every scene's `scriptText` is a verbatim slice of the spoken script, and concatenating them in
 * index order reproduces it — so the scenes' tokens ARE the spoken words in order. The scene
 * tokens are matched to the Whisper word list (each word carrying start/end seconds) by GLOBAL
 * edit-distance alignment (digits spelled out on both sides), so local transcription noise —
 * contractions, misheard words, numeric vs spoken prices — stays local instead of desyncing the
 * rest of the film. The CTA QR block additionally pins its trigger/release lines to their exact
 * spoken occurrences (see `ctaAnchors`). Scene boundaries are placed at the next scene's first
 * word onset (then snapped onto a detected pause inside the true inter-word gap), and the
 * returned ranges tile `[0, masterDurationSec]` with no gap or overlap (no narration is dropped
 * between scenes).
 *
 * `words == null`/empty (transcription failed) → a proportional fallback splits the master by each
 * scene's share of the total word count. Pure (no IO) — unit-tested.
 */
import type { StoryboardScene } from "../shared/types";
import type { WhisperWord } from "./_core/voiceTranscription";
import type { SilenceInterval } from "./videoAssembly";

export type SceneRange = { startSec: number; endSec: number };

/** The snap window an interior boundary may move in: `[prevWord.start, nextWord.end]` — the full
 * spans of its neighbor words, not just the gap between them. Whisper word edges are sloppy (ends
 * run late through pauses, onsets land inside words — measured up to ~250ms on production job
 * 75), so a real pause often sits "inside" a neighbor word's claimed span; a cut may land there,
 * but never beyond the neighbor words, so a genuinely separate word can't change scenes.
 * null = no word timings. */
type Gap = readonly [number, number] | null;
type BoundaryPlan = { boundaries: number[]; gaps: Gap[] };

/** Leading/trailing token counts used to fingerprint a CTA anchor phrase in the word stream. */
const ANCHOR_HEAD_TOKENS = 7;
const ANCHOR_TAIL_TOKENS = 5;
/** An anchor phrase must have at least this many tokens to be distinctive enough to pin. */
const ANCHOR_MIN_TOKENS = 3;
/** Below this matched-token ratio the word alignment is treated as noise → proportional split. */
const MIN_MATCH_RATIO = 0.5;
/** A boundary within this of a real silence gap is snapped onto it so cuts never land mid-word. */
const SNAP_TOLERANCE_SEC = 0.75;
/** A qrTail range with less real speech than this is dead air — the release phrase isn't in it. */
const QR_TAIL_MIN_SPEECH_SEC = 0.35;
/** How far past a silent qrTail range to hunt for the release phrase's actual speech burst. */
const QR_TAIL_RESCUE_WINDOW_SEC = 4;
/** Keep the cut at least this far inside a silence — same clean-lead convention as assembly's
 * `sanitizeInsertBoundaries`, so the next word keeps ≥40ms of true silence before it. */
const SNAP_CUT_MARGIN_SEC = 0.04;

/** Lowercased alphanumeric word tokens (digits kept so "2024" is one token; edge apostrophes dropped). */
export function tokenizeNarration(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .map(t => t.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

const normWord = (w: string): string =>
  w.toLowerCase().replace(/[^a-z0-9]/g, "");

const ONES =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " "
  );
const TENS =
  "zero ten twenty thirty forty fifty sixty seventy eighty ninety".split(" ");

/** Spoken-word expansion of an integer ("120" → one hundred twenty); >9999 spells digits. */
export function numberWords(n: number): string[] {
  if (n < 20) return [ONES[n]];
  if (n < 100)
    return n % 10 ? [TENS[(n / 10) | 0], ONES[n % 10]] : [TENS[(n / 10) | 0]];
  if (n < 1000)
    return [
      ONES[(n / 100) | 0],
      "hundred",
      ...(n % 100 ? numberWords(n % 100) : []),
    ];
  if (n < 10000)
    return [
      ONES[(n / 1000) | 0],
      "thousand",
      ...(n % 1000 ? numberWords(n % 1000) : []),
    ];
  return String(n)
    .split("")
    .map(d => ONES[+d]);
}

/**
 * Normalized MATCH tokens for one word: pure digits expand to their spoken form so a numeric
 * transcript aligns with a spelled-out script and vice versa ("$17" ⇄ "seventeen dollars",
 * "120 pages" ⇄ "one hundred and twenty pages"). Without this every price/quantity costs the
 * cursor several misses in a row — past what RESYNC_BACK can recover — and one sales pitch is
 * enough to desync the rest of the film (job 70).
 */
function matchTokens(w: string): string[] {
  const n = normWord(w);
  if (!n) return [];
  return /^\d+$/.test(n) ? numberWords(Number(n)) : [n];
}

/**
 * A hard synchronization point for the boundary walk: scene `scene` must START (edge "start") or
 * END (edge "end") exactly where `tokens` are spoken in the master. Derived from the CTA QR block
 * flags — the QR must appear ON "Now go ahead and grab your phone" and hold through "I'll wait
 * right here.", so those boundaries may not drift with the greedy cursor.
 */
type SceneAnchor = { scene: number; edge: "start" | "end"; tokens: string[] };

/**
 * CTA anchors from the storyboard flags: each contiguous `qrHero` run pins its first scene's START
 * to the scene's leading tokens (the trigger line — `markCtaQrBlock` splits scenes so the trigger
 * IS the scene head) and the `qrTail` scene's END to its trailing tokens (the release line ends the
 * scene the same way). Scene order = anchor order, which `alignBoundaries` relies on to match the
 * k-th block to the k-th spoken occurrence of the (verbatim-repeated) phrase.
 */
function ctaAnchors(scenes: StoryboardScene[]): SceneAnchor[] {
  const anchors: SceneAnchor[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const toks = tokenizeNarration(
      scenes[i].scriptText ?? scenes[i].narration ?? ""
    );
    if (toks.length < ANCHOR_MIN_TOKENS) continue;
    if (scenes[i].qrHero && !scenes[i - 1]?.qrHero) {
      anchors.push({
        scene: i,
        edge: "start",
        tokens: toks.slice(0, ANCHOR_HEAD_TOKENS),
      });
    }
    if (scenes[i].qrTail) {
      anchors.push({
        scene: i,
        edge: "end",
        tokens: toks.slice(-ANCHOR_TAIL_TOKENS),
      });
    }
  }
  return anchors;
}

/**
 * First occurrence of `tokens` (normalized) as a consecutive run in `W` at or after `from`,
 * tolerating one misheard word. Returns `[start, endExclusive]` word indexes, or null.
 */
function findPhrase(
  W: string[],
  tokens: string[],
  from: number
): [number, number] | null {
  const T = tokens.flatMap(matchTokens);
  if (T.length < ANCHOR_MIN_TOKENS) return null;
  for (let i = Math.max(0, from); i + T.length <= W.length; i++) {
    let miss = 0;
    for (let j = 0; j < T.length; j++) {
      if (W[i + j] !== T[j] && ++miss > 1) break;
    }
    if (miss <= 1) return [i, i + T.length];
  }
  return null;
}

/**
 * Assign each scene its `[startSec, endSec]` slice of the master narration. Mutates
 * `scene.audioDuration` (the band-enforcement helpers read it) and returns the ranges parallel to
 * `scenes` (used to physically slice the master). Ranges tile `[0, masterDurationSec]`.
 */
export function assignSceneRanges(
  scenes: StoryboardScene[],
  words: WhisperWord[] | null,
  masterDurationSec: number,
  silences?: SilenceInterval[] | null,
  shortSilences?: SilenceInterval[] | null
): SceneRange[] {
  const n = scenes.length;
  if (n === 0) return [];
  const dur = masterDurationSec > 0 ? masterDurationSec : 0;
  const sceneTokens = scenes.map(s =>
    tokenizeNarration(s.scriptText ?? s.narration ?? "")
  );

  const plan: BoundaryPlan =
    words && words.length > 0
      ? alignBoundaries(sceneTokens, words, dur, ctaAnchors(scenes))
      : { boundaries: proportionalByTokens(sceneTokens, dur), gaps: [] };
  let boundaries = plan.boundaries;
  // Snap each cut onto a real pause so it never lands inside a word — a physical guarantee that
  // also rescues the proportional (Whisper-less) path, whose boundaries ignore audio. On the
  // word-aligned path each snap is clamped to the boundary's snap window (`plan.gaps` — the
  // neighbor words' spans), so a mid-sentence breath can never pull a whole word into an
  // adjacent scene.
  if (silences && silences.length > 0) {
    boundaries = snapBoundariesToSilence(
      boundaries,
      silences,
      plan.gaps,
      shortSilences ?? []
    );
    rescueSilentQrTails(scenes, boundaries, silences);
  }

  const ranges: SceneRange[] = [];
  for (let i = 0; i < n; i++) {
    const startSec = boundaries[i];
    const endSec = Math.max(startSec, boundaries[i + 1]);
    ranges.push({ startSec, endSec });
    scenes[i].audioDuration = endSec - startSec;
  }
  return ranges;
}

/**
 * Globally align the scenes' tokens to the Whisper words, giving each scene its run, then place
 * each scene boundary at the next scene's first word start. CTA anchors pin the QR block's
 * trigger/release boundaries to their exact spoken occurrences. Falls back to a
 * token-proportional split when almost nothing matched (alignment is noise). Returns `n + 1`
 * monotonic boundaries tiling `[0, masterDurationSec]`.
 */
function alignBoundaries(
  sceneTokens: string[][],
  words: WhisperWord[],
  masterDurationSec: number,
  anchors: SceneAnchor[] = []
): BoundaryPlan {
  // The walk runs over EXPANDED match tokens (digits spelled out, see `matchTokens`) so numeric
  // and spelled-out forms align; `wordIdx` maps every expanded token back to its Whisper word
  // for timing. Scene boundaries stay expressed in ORIGINAL word indexes.
  const exp: { tok: string; wordIdx: number }[] = [];
  words.forEach((w, i) => {
    for (const t of matchTokens(w.word)) exp.push({ tok: t, wordIdx: i });
  });
  const E = exp.map(e => e.tok);
  /** Original word index the expanded cursor position `p` points AT (words.length past the end). */
  const wordAt = (p: number): number =>
    p >= exp.length ? words.length : exp[Math.max(0, p)].wordIdx;
  /** Exclusive original word index for expanded cursor `p` (the word before `p` is consumed). */
  const wordEndAt = (p: number): number =>
    p <= 0 ? 0 : exp[Math.min(p, exp.length) - 1].wordIdx + 1;

  const n = sceneTokens.length;
  const firstIdx: number[] = new Array(n).fill(0);
  const lastIdx: number[] = new Array(n).fill(0); // exclusive
  let matched = 0;
  let total = 0;

  // Resolve each anchor phrase to its position, consuming occurrences in order (a CTA block
  // repeats verbatim mid-roll + close, so block k must bind to spoken occurrence k). An unfound
  // phrase is skipped — the walk below then behaves exactly as without that anchor.
  const startCk = new Map<number, number>(); // scene → expanded-token start index
  const endCk = new Map<number, number>(); // scene → exclusive expanded-token end index
  let searchFrom = 0;
  for (const a of anchors) {
    const m = findPhrase(E, a.tokens, searchFrom);
    if (!m) continue;
    if (a.edge === "start") startCk.set(a.scene, m[0]);
    else endCk.set(a.scene, m[1]);
    searchFrom = m[1];
  }

  // ── Global alignment (edit distance with traceback) between the script's expanded tokens and
  // the transcript's. A greedy forward cursor is unfixable here: one local paraphrase desyncs it,
  // and once desynced, common words false-match ahead and the drift RUNS AWAY (job 70 lost 130 of
  // 185 scenes to one contraction + a price paragraph). Global DP is immune by construction —
  // an insertion/substitution stays a local cost instead of propagating. ~3k×3k tokens ≈ 100ms.
  const sTok: { tok: string; scene: number }[] = [];
  sceneTokens.forEach((toks, s) => {
    for (const t of toks.flatMap(matchTokens)) sTok.push({ tok: t, scene: s });
  });
  const N = sTok.length;
  const M = E.length;
  total = N;
  if (N > 0 && M > 0) {
    const stride = M + 1;
    const cost = new Int32Array((N + 1) * stride);
    const bp = new Uint8Array((N + 1) * stride); // 0=diag, 1=up (script token unspoken), 2=left (extra spoken word)
    for (let j = 0; j <= M; j++) {
      cost[j] = j;
      bp[j] = 2;
    }
    for (let i = 1; i <= N; i++) {
      cost[i * stride] = i;
      bp[i * stride] = 1;
      const si = sTok[i - 1].tok;
      for (let j = 1; j <= M; j++) {
        const idx = i * stride + j;
        const diag = cost[idx - stride - 1] + (si === E[j - 1] ? 0 : 1);
        const up = cost[idx - stride] + 1;
        const left = cost[idx - 1] + 1;
        // Prefer diagonal on ties so equal tokens pair up instead of drifting through gaps.
        if (diag <= up && diag <= left) {
          cost[idx] = diag;
          bp[idx] = 0;
        } else if (up <= left) {
          cost[idx] = up;
          bp[idx] = 1;
        } else {
          cost[idx] = left;
          bp[idx] = 2;
        }
      }
    }
    // Traceback: expanded-token position each script token matched (in exp space), or -1.
    const matchAt = new Int32Array(N).fill(-1);
    let i = N;
    let j = M;
    while (i > 0 || j > 0) {
      const b = bp[i * stride + j];
      if (b === 0 && i > 0 && j > 0) {
        if (sTok[i - 1].tok === E[j - 1]) {
          matchAt[i - 1] = j - 1;
          matched++;
        }
        i--;
        j--;
      } else if (b === 1 && i > 0) {
        i--;
      } else if (j > 0) {
        j--;
      } else {
        i--;
      }
    }
    // Per-scene word runs from the matched tokens; a scene with no match collapses onto the
    // running cursor (its boundary then sits in its neighbors' gap).
    let cursor = 0; // exclusive word index reached so far
    let t = 0;
    for (let s = 0; s < n; s++) {
      let first = -1;
      let last = -1;
      for (; t < N && sTok[t].scene === s; t++) {
        if (matchAt[t] >= 0) {
          if (first < 0) first = matchAt[t];
          last = matchAt[t];
        }
      }
      firstIdx[s] = first >= 0 ? wordAt(first) : cursor;
      lastIdx[s] = last >= 0 ? wordEndAt(last + 1) : firstIdx[s];
      if (lastIdx[s] < firstIdx[s]) lastIdx[s] = firstIdx[s];
      cursor = Math.max(cursor, lastIdx[s]);
    }
  }
  // The last scene owns any trailing words Whisper heard past the final matched token.
  lastIdx[n - 1] = words.length;

  // Alignment is noise (e.g. wrong-language audio) → don't cut on garbage boundaries. The gaps
  // would be garbage too, so return none (downstream snapping falls back to tolerance-only).
  if (total > 0 && matched / total < MIN_MATCH_RATIO) {
    return {
      boundaries: proportionalByTokens(sceneTokens, masterDurationSec),
      gaps: [],
    };
  }

  // Boundaries pinned by an anchor are authoritative: they are NOT clamped up to a drifted
  // predecessor — instead any preceding boundary that overshot them is pulled back down, so
  // residual drift right before a CTA block can never squeeze the block itself (the price pitch
  // directly before the trigger is exactly where numbers used to desync the cursor).
  // boundary index → the word it must directly precede. The cut is placed in the TRUE inter-word
  // gap before that word — never derived from a (possibly drifted) neighbor's walk indexes, which
  // can invert the gap and land the midpoint inside later speech.
  const anchoredBoundary = new Map<number, number>();
  startCk.forEach((ck, s) => {
    if (s >= 1 && s < n) anchoredBoundary.set(s, wordAt(ck));
  });
  endCk.forEach((ck, s) => {
    if (s + 1 >= 1 && s + 1 < n) anchoredBoundary.set(s + 1, wordEndAt(ck));
  });

  const boundaries: number[] = new Array(n + 1);
  const gaps: Gap[] = new Array(n + 1).fill(null);
  boundaries[0] = 0;
  boundaries[n] = masterDurationSec;
  for (let s = 1; s < n; s++) {
    const aw = anchoredBoundary.get(s);
    const prevEndIdx = aw !== undefined ? aw - 1 : lastIdx[s - 1] - 1; // previous scene's last word
    const nextStartIdx = aw !== undefined ? aw : firstIdx[s]; // this scene's first word
    const prevEnd =
      prevEndIdx >= 0 && prevEndIdx < words.length
        ? words[prevEndIdx].end
        : boundaries[s - 1];
    const nextStart =
      nextStartIdx < words.length ? words[nextStartIdx].start : prevEnd;
    // Every cut lands at the TOP of the inter-word gap (the next scene's first word onset), so
    // each scene keeps its full trailing word plus the following pause. Whisper word `end`
    // timestamps run early (they miss the decaying consonant/breath tail), so the old
    // midpoint-of-gap cut audibly chopped scene endings wherever the gap was tight.
    const target = nextStart;
    boundaries[s] =
      aw !== undefined
        ? Math.min(target, masterDurationSec)
        : Math.max(boundaries[s - 1], Math.min(target, masterDurationSec));
    // The snap window this cut may move in: the neighbor words' full spans (see `Gap`). A real
    // pause reported by silencedetect frequently pokes into a neighbor's sloppy Whisper span
    // (production job 75: 14/169 cuts stranded mid-word by the old [prevEnd, nextStart] clamp),
    // but a cut past these spans would move a whole word into the wrong scene. ANCHORED
    // boundaries keep the narrow inter-word gap: the QR trigger/release was found verbatim, so
    // its onset is trustworthy, and a nearby pause must not pull the pinned QR cut off it.
    const prevStart =
      prevEndIdx >= 0 && prevEndIdx < words.length
        ? words[prevEndIdx].start
        : prevEnd;
    const nextEnd =
      nextStartIdx < words.length ? words[nextStartIdx].end : nextStart;
    gaps[s] = aw !== undefined ? [prevEnd, nextStart] : [prevStart, nextEnd];
  }
  // Anchor authority: predecessors that overshot a pinned boundary are pulled back and spread
  // evenly over the stretch before it — residual drift can neither squeeze the CTA block nor
  // leave a run of zero-width (single-frame) scenes at the pin.
  const anchorIdxs: number[] = [];
  anchoredBoundary.forEach((_, b) => anchorIdxs.push(b));
  for (const b of anchorIdxs.sort((x, y) => x - y)) {
    let j = b - 1;
    while (j >= 1 && boundaries[j] >= boundaries[b]) j--;
    if (j === b - 1) continue; // nothing overshot
    for (let k = j + 1; k < b; k++) {
      boundaries[k] =
        boundaries[j] + ((boundaries[b] - boundaries[j]) * (k - j)) / (b - j);
      gaps[k] = null; // walk indexes here are drift garbage — snap tolerance-only
    }
  }
  // Guarantee non-decreasing even if a degenerate scene produced an inverted midpoint.
  for (let s = 1; s <= n; s++) {
    if (boundaries[s] < boundaries[s - 1]) boundaries[s] = boundaries[s - 1];
  }
  return { boundaries, gaps };
}

/** Split `[0, masterDurationSec]` by each scene's share of the total word (token) count. */
function proportionalByTokens(
  sceneTokens: string[][],
  masterDurationSec: number
): number[] {
  const counts = sceneTokens.map(t => Math.max(1, t.length));
  const total = counts.reduce((a, b) => a + b, 0);
  const boundaries: number[] = new Array(sceneTokens.length + 1);
  boundaries[0] = 0;
  let acc = 0;
  for (let s = 0; s < sceneTokens.length; s++) {
    acc += counts[s];
    boundaries[s + 1] = (acc / total) * masterDurationSec;
  }
  boundaries[sceneTokens.length] = masterDurationSec;
  return boundaries;
}

/** Seconds of non-silent audio inside `[a, b]`. */
function speechInRange(
  a: number,
  b: number,
  silences: SilenceInterval[]
): number {
  let silent = 0;
  for (const s of silences) {
    const lo = Math.max(a, s.start);
    const hi = Math.min(b, s.end);
    if (hi > lo) silent += hi - lo;
  }
  return Math.max(0, b - a - silent);
}

/**
 * A qrTail scene owns the CTA release line ("I'll wait right here.") and the 3s QR hold is
 * inserted at its END — so if its assigned range is dead air, the hold fires BEFORE the phrase
 * and the QR leaves the screen while it plays. That exact failure shipped on staging job 204:
 * whisperx word timestamps drifted ~1s early around the block, the release anchor faithfully
 * pinned to them, and both snapped boundaries landed inside the pause BEFORE the phrase.
 * Timestamps can lie; the waveform can't: a qrTail range with (near-)zero real speech is advanced
 * onto the next speech burst — the release line is by construction the last speech before its
 * trailing pause. Mutates `boundaries` in place (start and end of each rescued qrTail). Pure
 * logic, unit-tested.
 * ponytail: rescues only the qrTail (the insert point — the user-visible break); a content-level
 * "is this burst really the release phrase" check needs re-transcription, add if drift recurs.
 */
function rescueSilentQrTails(
  scenes: StoryboardScene[],
  boundaries: number[],
  silences: SilenceInterval[]
): void {
  const n = scenes.length;
  for (let i = 0; i < n; i++) {
    if (!scenes[i].qrTail) continue;
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (speechInRange(start, end, silences) >= QR_TAIL_MIN_SPEECH_SEC) continue;

    // Next speech burst = the gap between the silence covering/preceding `start` and the one
    // after it. Silences are sorted; find the first silence ending after `start`.
    let k = silences.findIndex(s => s.end > start);
    if (k < 0) continue; // speech runs to the end of the master — nothing to hunt
    if (silences[k].start > start) k -= 1; // `start` sits in speech (sub-threshold sliver)
    const burstStart = k >= 0 ? silences[k].end : 0;
    const burstEnd =
      k + 1 < silences.length
        ? silences[k + 1].start
        : boundaries[boundaries.length - 1];
    if (burstEnd - end > QR_TAIL_RESCUE_WINDOW_SEC) continue; // too far — don't guess
    if (burstEnd <= burstStart) continue;

    const newStart = Math.max(
      boundaries[Math.max(0, i - 1)],
      burstStart - SNAP_CUT_MARGIN_SEC
    );
    const newEnd = Math.min(
      i + 2 <= n ? boundaries[i + 2] : boundaries[n],
      burstEnd + SNAP_CUT_MARGIN_SEC
    );
    if (newEnd <= newStart) continue; // would invert against a neighbor — leave as-is
    boundaries[i] = newStart;
    boundaries[i + 1] = newEnd;
  }
}

/** Where a cut lands inside one silence: the point of `[start+margin, end−margin]` nearest the
 * boundary (sub-2×margin silences use their center). A boundary already inside the pause stays
 * put; one just past it moves only as far as the pause edge — never all the way to the center,
 * which rejected long pauses ending right before the cut (center >0.75s away, production job 75). */
function cutPointInSilence(boundary: number, sil: SilenceInterval): number {
  const lo = sil.start + SNAP_CUT_MARGIN_SEC;
  const hi = sil.end - SNAP_CUT_MARGIN_SEC;
  if (lo >= hi) return (sil.start + sil.end) / 2;
  return Math.min(Math.max(boundary, lo), hi);
}

/**
 * Move each interior scene boundary onto the nearest usable point of a detected silence within
 * `SNAP_TOLERANCE_SEC`, so the physical cut lands in a real pause (not mid-word) with ≥40ms of
 * clean lead on both sides. When two boundaries want the same pause only the closest snaps (the
 * other keeps its computed spot); a snap that wouldn't stay strictly between its neighbors is
 * skipped. When `gaps[s]` is known (word-aligned path) the cut must stay strictly inside the
 * boundary's snap window — the neighbor words' spans, see `Gap` — so a real pause hiding inside a
 * sloppy Whisper word edge is usable, but a mid-sentence breath before a genuinely separate word
 * can't drag that word into the adjacent scene; a boundary with no gap (proportional path) keeps
 * tolerance-only snapping. Boundaries with no qualifying silence in `silences` get a second
 * chance against `shortSilences` (a finer scan that sees sub-120ms inter-word gaps). Keeps
 * `boundaries` monotonic and tiling `[0, dur]`. Pure — unit-tested.
 */
function snapBoundariesToSilence(
  boundaries: number[],
  silences: SilenceInterval[],
  gaps: Gap[] = [],
  shortSilences: SilenceInterval[] = []
): number[] {
  const n = boundaries.length - 1; // scene count
  const pick: { cut: number; interval: number; dist: number }[] = new Array(
    n + 1
  );
  for (let s = 1; s < n; s++)
    pick[s] = { cut: boundaries[s], interval: -1, dist: Infinity };

  // Tier 1: real pauses; tier 2 (only for boundaries tier 1 left unsnapped): short-gap scan.
  for (const tier of [silences, shortSilences]) {
    for (let s = 1; s < n; s++) {
      if (pick[s].interval >= 0) continue;
      const gap = gaps[s] ?? null;
      for (let c = 0; c < tier.length; c++) {
        const cut = cutPointInSilence(boundaries[s], tier[c]);
        if (gap && (cut <= gap[0] || cut >= gap[1])) continue;
        const d = Math.abs(cut - boundaries[s]);
        if (d <= SNAP_TOLERANCE_SEC && d < pick[s].dist) {
          pick[s] = { cut, interval: c, dist: d };
        }
      }
    }
    // One pause can host at most one cut: keep the closest boundary, demote the rest. Scoped per
    // tier so a tier-2 pick never collides with a tier-1 interval index.
    const winnerForInterval = new Map<number, number>();
    for (let s = 1; s < n; s++) {
      const { interval, dist } = pick[s];
      if (interval < 0 || !tier[interval]) continue;
      const cur = winnerForInterval.get(interval);
      if (cur === undefined || dist < pick[cur].dist)
        winnerForInterval.set(interval, s);
    }
    for (let s = 1; s < n; s++) {
      const iv = pick[s].interval;
      if (iv < 0 || !tier[iv]) continue; // not picked in THIS tier
      if (winnerForInterval.get(iv) !== s)
        pick[s] = { cut: boundaries[s], interval: -1, dist: Infinity };
    }
    // Park survivors on an out-of-range index so the next tier neither re-picks nor demotes them.
    for (let s = 1; s < n; s++) {
      if (pick[s].interval >= 0) pick[s].interval = Number.MAX_SAFE_INTEGER;
    }
  }

  // Apply, but only where the snapped cut stays strictly between its neighbors.
  const out = boundaries.slice();
  for (let s = 1; s < n; s++) {
    const c = pick[s].cut;
    if (c > out[s - 1] && c < boundaries[s + 1]) out[s] = c;
  }
  // Safety net: never let a boundary regress (matches alignBoundaries).
  for (let s = 1; s <= n; s++) {
    if (out[s] < out[s - 1]) out[s] = out[s - 1];
  }
  return out;
}

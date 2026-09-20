/**
 * server/alignmentHeal.ts — repair a transcript that came back with a HOLE in it.
 *
 * Every scene cut in a film is recovered from whisperx word timings, and whisperx can return a
 * transcript that is simply missing a stretch: production job 94 got no words at all for
 * 9:23–14:37 of a clean, continuously spoken 14:45 master (the same audio transcribes perfectly
 * on a second try, so it is intermittent on the worker side and cannot be fixed at its source).
 * The aligner's plausibility gate (`repairImplausibleRuns`) spots the damage and can re-split the
 * stretch by word count, but that lands cuts a median ~2.6 s off the words — fine as a last
 * resort, poor as the answer. The better repair is to ask again, for THAT STRETCH ONLY: a few
 * minutes of audio instead of the whole film, and a short request is the case that works.
 *
 * `healTranscriptHoles` does that and splices the fresh words into the transcript;
 * `mergePatchedWords` is the pure half. A patch that fails, or comes back as empty as the hole
 * it was meant to fill, changes nothing — the caller keeps the proportional repair it already has.
 */
import type { WhisperWord } from "./_core/voiceTranscription";
import { transcribeWordsFromBuffer } from "./_core/voiceTranscription";
import type { StoryboardScene } from "../shared/types";
import { operatorSetLength } from "../shared/filmTimeline";
import type { SceneRun } from "./narrationAlignment";
import { implausibleScenes, tokenizeNarration } from "./narrationAlignment";
import { sliceMonoAudioBuffer } from "./videoAssembly";

/** Audio taken either side of a damaged stretch, so its first and last words arrive whole. */
const PATCH_PAD_SEC = 1;
/** A patch with fewer words per second than this did not hear the stretch either. */
const PATCH_MIN_WORDS_PER_SEC = 0.5;

const mid = (w: WhisperWord) => (w.start + w.end) / 2;

/**
 * Replace the words inside `[fromSec, toSec]` with `patch` (timed from 0 at `fromSec`). Words
 * are assigned by MIDPOINT on both sides, so a word straddling an edge is kept exactly once.
 * Returns a new, start-ordered list. Pure — unit-tested.
 */
export function mergePatchedWords(
  words: WhisperWord[],
  patch: WhisperWord[],
  fromSec: number,
  toSec: number
): WhisperWord[] {
  const inside = (t: number) => t >= fromSec && t <= toSec;
  const kept = words.filter(w => !inside(mid(w)));
  const added = patch
    .map(w => ({
      word: w.word,
      start: w.start + fromSec,
      end: w.end + fromSec,
    }))
    .filter(w => inside(mid(w)));
  return [...kept, ...added].sort((a, b) => a.start - b.start);
}

/** Overlapping / touching runs folded into one span each, padded and clamped to the master. */
export function patchSpans(
  runs: SceneRun[],
  masterDurationSec: number
): { fromSec: number; toSec: number }[] {
  const spans = runs
    .map(r => ({
      fromSec: Math.max(0, r.startSec - PATCH_PAD_SEC),
      toSec: Math.min(masterDurationSec, r.endSec + PATCH_PAD_SEC),
    }))
    .filter(s => s.toSec - s.fromSec > 0.5)
    .sort((a, b) => a.fromSec - b.fromSec);
  const out: { fromSec: number; toSec: number }[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.fromSec <= last.toSec)
      last.toSec = Math.max(last.toSec, s.toSec);
    else out.push({ ...s });
  }
  return out;
}

/**
 * Re-transcribe each damaged stretch and splice the result into `words`. Returns the (possibly
 * unchanged) word list and how many stretches were actually patched. Never throws: a failed
 * patch leaves that stretch as it was.
 */
export async function healTranscriptHoles(opts: {
  /** The mono 16 kHz copy of the master the first transcription was made from. */
  monoAudio: Buffer;
  words: WhisperWord[];
  runs: SceneRun[];
  masterDurationSec: number;
  log?: (msg: string) => void;
  /** Injected in tests. */
  transcribe?: typeof transcribeWordsFromBuffer;
  slice?: typeof sliceMonoAudioBuffer;
}): Promise<{ words: WhisperWord[]; patched: number }> {
  const transcribe = opts.transcribe ?? transcribeWordsFromBuffer;
  const slice = opts.slice ?? sliceMonoAudioBuffer;
  let words = opts.words;
  let patched = 0;
  for (const span of patchSpans(opts.runs, opts.masterDurationSec)) {
    const label = `${span.fromSec.toFixed(1)}s–${span.toSec.toFixed(1)}s`;
    try {
      const audio = await slice(
        opts.monoAudio,
        span.fromSec,
        span.toSec - span.fromSec
      );
      const out = await transcribe(audio);
      if ("error" in out) {
        opts.log?.(`re-transcription of ${label} failed (${out.error})`);
        continue;
      }
      const had = words.filter(
        w => mid(w) >= span.fromSec && mid(w) <= span.toSec
      );
      const floor = (span.toSec - span.fromSec) * PATCH_MIN_WORDS_PER_SEC;
      if (out.words.length < floor || out.words.length <= had.length) {
        opts.log?.(
          `re-transcription of ${label} heard ${out.words.length} word(s) ` +
            `(had ${had.length}) — not an improvement, keeping the original`
        );
        continue;
      }
      words = mergePatchedWords(words, out.words, span.fromSec, span.toSec);
      patched++;
      opts.log?.(
        `re-transcribed ${label}: ${had.length} → ${out.words.length} word timing(s)`
      );
    } catch (e: any) {
      opts.log?.(`re-transcription of ${label} threw (${e?.message ?? e})`);
    }
  }
  return { words, patched };
}

/** A stretch of a STORED storyboard whose narration slices its words cannot explain. */
export type TimelineIssue = {
  /** `scene.index` of the first and last scene in the stretch. */
  fromIndex: number;
  toIndex: number;
  startSec: number;
  endSec: number;
};

/**
 * The aligner's plausibility gate, run over a storyboard that has ALREADY been voiced — so a
 * film rendered before the gate existed can say what is wrong with it. Without this a broken
 * timeline is invisible: every scene has a clip and narration, nothing is "failed", and the only
 * control on offer is Regenerate, which re-renders the same broken slice (job 94 was regenerated
 * repeatedly for exactly that reason). Scenes whose length an operator set by hand are exempt —
 * a beat cut to 0.8 s in the cut room is a decision. Pure — unit-tested.
 */
export function auditStoryboardTimeline(
  scenes: StoryboardScene[]
): TimelineIssue[] {
  const ranged = scenes.filter(
    s =>
      Number.isFinite(s.narrationStartSec) && Number.isFinite(s.narrationEndSec)
  );
  // Per-scene-voiced films (no master ranges) are sized by their own audio — nothing to audit.
  if (ranged.length < scenes.length || scenes.length === 0) return [];
  const flags = implausibleScenes(
    scenes.map(
      s => tokenizeNarration(s.scriptText ?? s.narration ?? "").length
    ),
    scenes.map(
      s => (s.narrationEndSec as number) - (s.narrationStartSec as number)
    ),
    scenes.map(s => operatorSetLength(s))
  );
  const issues: TimelineIssue[] = [];
  for (let i = 0; i < scenes.length; i++) {
    if (!flags[i]) continue;
    let j = i;
    while (j + 1 < scenes.length && flags[j + 1]) j++;
    issues.push({
      fromIndex: scenes[i].index,
      toIndex: scenes[j].index,
      startSec: scenes[i].narrationStartSec as number,
      endSec: scenes[j].narrationEndSec as number,
    });
    i = j;
  }
  return issues;
}

/** "scenes 108–115 (9:23–14:37)" — one issue, for a message. */
export function describeIssue(i: TimelineIssue): string {
  const who =
    i.fromIndex === i.toIndex
      ? `scene ${i.fromIndex}`
      : `scenes ${i.fromIndex}–${i.toIndex}`;
  return `${who} (${clockTime(i.startSec)}–${clockTime(i.endSec)})`;
}

/** `563.2` → `9:23` — for messages an operator reads against the film's own clock. */
export function clockTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "9:23–14:37, 2:10–2:31" for a list of runs. */
export function describeRuns(runs: SceneRun[]): string {
  return runs
    .map(r => `${clockTime(r.startSec)}–${clockTime(r.endSec)}`)
    .join(", ");
}

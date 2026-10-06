/**
 * "Redo voice" on one scene — the pure half.
 *
 * A scene voiced on its own is a separate provider generation: it starts cold, with its own
 * energy and pitch, and sits apart from the takes either side of it. So the redo is READ IN
 * CONTEXT: the line before, the scene's own words and the line after are voiced as one request,
 * and only the scene's words are kept. The voice comes into them and leaves them in the flow of
 * its neighbours, on any vendor — no provider "continue from the previous take" feature needed.
 *
 * This file decides WHAT is read (`voiceContextFor`) and WHERE the scene's words sit in the take
 * that comes back (`bodyRangeInRead`). The provider call, the cut and the level match are in
 * `longformVideo.ts` (`redoSceneVoiceAudio`).
 */
import { assignSceneRanges, tokenizeNarration } from "./narrationAlignment";
import type { WhisperWord } from "./_core/voiceTranscription";
import type { StoryboardScene } from "../shared/types";

/** The three parts of one context read. `lead` / `tail` are empty at the film's two ends. */
export interface VoiceContext {
  lead: string;
  body: string;
  tail: string;
}

/** The most context read either side — enough to carry the flow, little enough to stay cheap. */
export const CONTEXT_MAX_WORDS = 30;

const sceneText = (s: StoryboardScene | undefined) =>
  (s?.scriptText ?? s?.narration ?? "").replace(/\s+/g, " ").trim();

const SENTENCE_END = /[.!?]["')\]]*$/;

/** The last sentence of `text` (or its last `CONTEXT_MAX_WORDS` words, whichever is shorter). */
export function lastSentence(text: string): string {
  const words = text.split(" ").filter(Boolean);
  let from = 0;
  // Walk back from the word before the last: a sentence starts right after a sentence end.
  for (let i = words.length - 2; i >= 0; i--) {
    if (SENTENCE_END.test(words[i])) {
      from = i + 1;
      break;
    }
  }
  return words.slice(Math.max(from, words.length - CONTEXT_MAX_WORDS)).join(" ");
}

/** The first sentence of `text` (or its first `CONTEXT_MAX_WORDS` words, whichever is shorter). */
export function firstSentence(text: string): string {
  const words = text.split(" ").filter(Boolean);
  let to = words.length;
  for (let i = 0; i < words.length; i++) {
    if (SENTENCE_END.test(words[i])) {
      to = i + 1;
      break;
    }
  }
  return words.slice(0, Math.min(to, CONTEXT_MAX_WORDS)).join(" ");
}

/** What to read for `scene`: its own words between the line before and the line after. */
export function voiceContextFor(
  scenes: StoryboardScene[],
  scene: StoryboardScene
): VoiceContext {
  const at = scenes.findIndex(s => s.index === scene.index);
  return {
    lead: at > 0 ? lastSentence(sceneText(scenes[at - 1])) : "",
    body: sceneText(scene),
    tail: at >= 0 && at < scenes.length - 1 ? firstSentence(sceneText(scenes[at + 1])) : "",
  };
}

/** The one text sent to the voice for a context read. */
export function contextReadText(ctx: VoiceContext): string {
  return [ctx.lead, ctx.body, ctx.tail].filter(Boolean).join(" ");
}

/** Seconds a spoken word may plausibly take — outside it the cut is not the scene's words. */
const WORD_SEC_MIN = 0.12;
const WORD_SEC_MAX = 1.5;

/**
 * Where the scene's own words sit in a context read, or null when they cannot be placed with
 * confidence (no transcript, or a range no real read of those words could have) — the caller
 * then voices the scene on its own rather than keep a cut it cannot trust.
 *
 * The three parts are aligned exactly as a film's scenes are aligned to its master
 * (`assignSceneRanges`): matched word by word against the transcript, then snapped onto the real
 * pauses, so the cut never lands inside a word.
 */
export function bodyRangeInRead(
  ctx: VoiceContext,
  words: WhisperWord[] | null,
  durationSec: number,
  silences?: { start: number; end: number }[] | null,
  shortSilences?: { start: number; end: number }[] | null
): { startSec: number; endSec: number } | null {
  if (!words?.length || durationSec <= 0) return null;
  const parts = [ctx.lead, ctx.body, ctx.tail];
  const present = parts
    .map((text, part) => ({ text, part }))
    .filter(p => p.text.trim());
  const bodyAt = present.findIndex(p => p.part === 1);
  if (bodyAt < 0) return null;
  const pseudo = present.map(
    (p, i) => ({ index: i + 1, scriptText: p.text }) as StoryboardScene
  );
  const ranges = assignSceneRanges(
    pseudo,
    words,
    durationSec,
    silences,
    shortSilences
  );
  const range = ranges[bodyAt];
  if (!range) return null;
  const lenSec = range.endSec - range.startSec;
  const wordCount = tokenizeNarration(ctx.body).length;
  if (wordCount === 0) return null;
  if (lenSec < wordCount * WORD_SEC_MIN || lenSec > wordCount * WORD_SEC_MAX + 1)
    return null;
  return range;
}

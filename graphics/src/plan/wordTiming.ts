// Word times the transcriber gets wrong, put right from the sound itself. Pure.
//
// The aligner times words by their letters, and a word written in digits ("$40", "15%", "1,500")
// has none it can use, so its time is guessed — usually late. Dale's job 386 at 2:57: the voice
// runs straight on from "to" into "forty dollars" at ~177.1 s, the transcript put "$40" at
// 177.62, and the caption's "$40" came up half a second after it was heard. On-screen words may
// lead the voice a little but never lag it (subtitle practice), so a number is moved EARLIER to
// where the sound says it began — never later, and never across a pause.
import type { Word } from "../cueResolve";

/** Loudness frames the caller measures the film's sound in (dBFS). */
export const LEVEL_FRAME_SEC = 0.02;
/** A frame this far under the narration's speech level is a pause, not a word. */
const QUIET_BELOW_DB = 25;
/** That quiet for this long is a pause the number must not be moved across. */
const PAUSE_SEC = 0.12;
/** How long a word of n letters takes, roughly (a slow narrator's ~15 letters a second). */
const wordSec = (text: string) => 0.05 + 0.065 * text.replace(/[^a-z]/gi, "").length;

function speechDb(levels: number[]): number {
  const voiced = levels.filter(db => db > -50).sort((a, b) => a - b);
  return voiced.length ? voiced[Math.floor(voiced.length / 2)] : -20;
}

/** Whether the sound from `a` to `b` (seconds) runs on with no pause in it. */
function continuous(levels: number[], a: number, b: number, quiet: number): boolean {
  const need = Math.round(PAUSE_SEC / LEVEL_FRAME_SEC);
  let run = 0;
  for (let i = Math.max(0, Math.floor(a / LEVEL_FRAME_SEC)); i < Math.min(levels.length, Math.ceil(b / LEVEL_FRAME_SEC)); i++) {
    run = levels[i] < quiet ? run + 1 : 0;
    if (run >= need) return false;
  }
  return true;
}

/**
 * The words with each number's start moved back to where it was really said: right after the
 * word before it when the voice runs straight on, or inside that word when the aligner stretched
 * it over the number ("the" timed 0.4 s long, swallowing "ten"). Returns new objects.
 */
export function retimeNumbers(words: Word[], levels: number[]): Word[] {
  const out = words.map(w => ({ ...w }));
  if (!levels.length) return out;
  const quiet = speechDb(levels) - QUIET_BELOW_DB;
  for (let i = 1; i < out.length; i++) {
    const w = out[i];
    const prev = out[i - 1];
    if (!/\d/.test(w.text)) continue;
    let start = w.start;
    const expected = wordSec(prev.text);
    if (prev.end - prev.start > expected + 0.12 && continuous(levels, prev.start + expected, w.start, quiet)) {
      start = prev.start + expected;
    } else if (w.start - prev.end > 0.06 && continuous(levels, prev.end, w.start, quiet)) {
      start = prev.end + 0.02;
    }
    if (start < w.start - 0.01) {
      w.start = +start.toFixed(3);
      prev.end = Math.min(prev.end, w.start);
    }
  }
  return out;
}

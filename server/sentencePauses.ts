/**
 * server/sentencePauses.ts — every sentence of a voiced narration ends with a real pause
 * (2026-10-16).
 *
 * A lip-sync model closes the mouth only when the voice stops. The competitor review found Dale
 * "almost never pauses" and his mouth "does not keep time with the voice"; the render tests then
 * showed why: his 10-second takes held one or two silences, his mouth never had a reason to close,
 * and lip-sync failed on 0 of 4 takes whatever the photo. A pause after each sentence passed. The
 * voice session gave the CLONE voices (MiniMax) a 0.3 s pause mark after every sentence; ElevenLabs
 * v3/v4 take no break tag, and an ellipsis made the model pause only when it chose to (Dale: 3
 * pauses on one line, 1 on another). So the pause is made the standard way instead: after voicing,
 * the narration is transcribed, and wherever a sentence ends with less than `MIN_GAP_SEC` of quiet
 * before the next word, silence is inserted up to `PAUSE_SEC`. Any voice, any model, any channel.
 *
 * `planSentencePauses` is pure (word timings in, insertions out); `padSentenceEnds` reads and writes
 * the audio. Every failure keeps the narration as voiced.
 *
 * THE TRANSCRIPT IS NOT TRUSTED WITH THE SCISSORS (2026-10-17). Where the transcriber misses words
 * — prices most of all ("$150 to $600", "to $1,500", "to $130") — or hears a full stop that is not
 * there ("a hundred ways." for "a hundred of them,"), a "gap" between two sentences is really
 * speech, and quieting it erased what was said: Dale's and Hank's finals (jobs 386, 388) held
 * 2.5-3.3 s of digital silence where the prices were. So a gap is only touched when the AUDIO
 * agrees it is quiet (`holdsSpeech`): any stretch in it as loud as the narration's own speech
 * leaves the gap exactly as voiced.
 *
 * A PAUSE IS MADE, NEVER CUT (2026-10-17). Frederick's "The type." (job 393, 1:10) sounded chopped:
 * the provider's own pause mark spliced dead digital silence in and cut each sentence's last word to
 * fit (-38 dB to nothing in 0.1 s), and this step did the same in long gaps — quieting from the
 * TRANSCRIPT's end time, which lands before a word's sound has died away, to absolute zero with a
 * 20 ms fade. Now every edge comes from the sound: a gap starts where the word has decayed into the
 * take's own quiet (`soundEnd`) and ends where the next word's sound begins (`soundStart`), the
 * fades are `FADE_SEC`, a breath is quieted by `QUIET_GAIN` instead of muted, and silence is
 * inserted at the quietest moment between the words, eased in and out. The clone voices no longer
 * get the provider's pause mark (`CLONE_SENTENCE_PAUSE_SEC` 0): this step makes the pause for every
 * voice, so the mouth still closes.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFfmpeg } from "./ffmpegSpawn";
import { transcribeWordsFromBuffer, type WhisperWord } from "./_core/voiceTranscription";

/** The pause every sentence ends with (the clone voices' pause mark, `CLONE_SENTENCE_PAUSE_SEC`). */
/**
 * The quiet every sentence ends with. 0.5 s since 2026-10-17: once the provider's pause mark was
 * retired, 0.3 s was too short for Scarlett — over three HeyGen rounds her mouth moved in the
 * pauses 0.62 against 0.44 with the mark, and followed the voice 0.31 against 0.46. Bertha Ramirez
 * leaves 0.40 s between sentences, Steve Cooper 0.72 s.
 */
export const PAUSE_SEC = () => Number(process.env.SENTENCE_PAUSE_SEC ?? 0.5);
/** A sentence end already followed by this much quiet is left alone. */
export const MIN_GAP_SEC = 0.25;

/** Abbreviations whose full stop does not end a sentence. */
const NOT_A_SENTENCE_END = /^(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|vs|etc|e\.g|i\.e|No|Fig|approx)\.$/i;

/** Kept clear of a word's tail and the next word's head when a gap is quieted. */
export const EDGE_SEC = 0.04;

/** How long a pause eases in and out (dialogue editing uses 50-100 ms; 20 ms read as a click-off). */
export const FADE_SEC = 0.08;
/** A quieted breath keeps this much of its level (-30 dB): inaudible, but the pause is not dead air. */
export const QUIET_GAIN = 0.03;
/** A word's sound has died away once it is this far under the narration's speech level. */
export const DECAYED_DB = 35;
/** Kept after a word's sound has died away, and before the next one's begins. */
export const SOUND_MARGIN_SEC = 0.03;

/** Loudness frames (dBFS) used to check that a gap is really quiet. */
export const LEVEL_FRAME_SEC = 0.02;
/** A frame within this many dB of the narration's typical speech level is speech, not breath. */
export const SPEECH_WITHIN_DB = 15;
/** That loud for this long is a word (shorter is a click or a breath's peak). */
export const SPEECH_MIN_SEC = 0.08;

/** The narration's typical speech level: the median of the frames that carry sound. */
export function speechLevelDb(levels: number[]): number {
  const voiced = levels.filter(db => db > -50).sort((a, b) => a - b);
  return voiced.length ? voiced[Math.floor(voiced.length / 2)] : -20;
}

/**
 * Whether `from`..`to` (seconds) holds speech: a run of at least `SPEECH_MIN_SEC` within
 * `SPEECH_WITHIN_DB` of the narration's speech level (pure; `levels` are `LEVEL_FRAME_SEC` frames).
 */
export function holdsSpeech(levels: number[], from: number, to: number, speechDb = speechLevelDb(levels)): boolean {
  const need = Math.max(1, Math.round(SPEECH_MIN_SEC / LEVEL_FRAME_SEC));
  let run = 0;
  for (let i = Math.max(0, Math.floor(from / LEVEL_FRAME_SEC)); i < Math.min(levels.length, Math.ceil(to / LEVEL_FRAME_SEC)); i++) {
    run = levels[i] >= speechDb - SPEECH_WITHIN_DB ? run + 1 : 0;
    if (run >= need) return true;
  }
  return false;
}

/** Where a word's SOUND ends: from its transcript end, forward to the first frame decayed into the
 * take's quiet (never past `limit`). Pure. */
export function soundEnd(levels: number[], from: number, limit: number, speechDb: number): number {
  const quiet = speechDb - DECAYED_DB;
  let i = Math.floor(from / LEVEL_FRAME_SEC);
  const last = Math.floor(limit / LEVEL_FRAME_SEC);
  while (i < last && i < levels.length && levels[i] > quiet) i++;
  return Math.min(limit, i * LEVEL_FRAME_SEC + SOUND_MARGIN_SEC);
}

/** Where the next word's SOUND begins: from its transcript start, back to the last quiet frame
 * (never before `limit`). Pure. */
export function soundStart(levels: number[], to: number, limit: number, speechDb: number): number {
  const quiet = speechDb - DECAYED_DB;
  let i = Math.ceil(to / LEVEL_FRAME_SEC) - 1;
  const first = Math.ceil(limit / LEVEL_FRAME_SEC);
  while (i > first && i < levels.length && levels[i] > quiet) i--;
  return Math.max(limit, (i + 1) * LEVEL_FRAME_SEC - SOUND_MARGIN_SEC);
}

/** The quietest moment between `a` and `b` (seconds) — where inserted silence cuts nothing. */
function quietest(levels: number[], a: number, b: number): number {
  let best = Math.round((a + b) / 2 / LEVEL_FRAME_SEC);
  for (let i = Math.floor(a / LEVEL_FRAME_SEC); i <= Math.ceil(b / LEVEL_FRAME_SEC) && i < levels.length; i++)
    if (levels[i] < (levels[best] ?? Infinity)) best = i;
  return Math.min(b, Math.max(a, (best + 0.5) * LEVEL_FRAME_SEC));
}

const tokenOf = (x: string) => x.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']/g, "");

/**
 * Which transcript words end a sentence in the SCRIPT. The transcriber's punctuation misses some —
 * Frederick's "First thing on the label. The type." came back "label, the type", so no pause went
 * in where the script has one. The two are walked in order, each word matched to the next script
 * word within a few (a misheard or extra word is skipped, never matched out of order). Pure.
 */
export function scriptSentenceEnds(words: Pick<WhisperWord, "word">[], script: string): Set<number> {
  const raw = script.split(/\s+/).filter(Boolean);
  const toks = raw.map(tokenOf);
  const ends = raw.map(x => {
    const t = x.replace(/["'”’)\]]+$/, "");
    return /[.?!]$/.test(t) && !NOT_A_SENTENCE_END.test(t) && !/^\d+\.$/.test(t);
  });
  const out = new Set<number>();
  let j = 0;
  words.forEach((w, i) => {
    const t = tokenOf(w.word);
    if (!t) return;
    for (let k = j; k < Math.min(toks.length, j + 4); k++) {
      if (toks[k] !== t) continue;
      if (ends[k]) out.add(i);
      j = k + 1;
      return;
    }
  });
  return out;
}

export interface SentencePause {
  /** Where silence is inserted (the middle of the gap). */
  atSec: number;
  /** How much silence is inserted; 0 when the gap is long enough and only quieted. */
  addSec: number;
  /** A long gap's middle, quieted (the voices fill it with breath). */
  muteFrom?: number;
  muteTo?: number;
}

/**
 * What each sentence end needs (pure): a gap shorter than `MIN_GAP_SEC` gets silence INSERTED up to
 * `pauseSec` (in the middle of the gap, so no word is cut); a longer gap is QUIETED in its middle,
 * clear of both words by `EDGE_SEC` — the voices fill a sentence gap with breath, and the lip-sync
 * model moves the mouth on a breath as if it were a word (Dale's takes: 0.58 s gaps by the
 * transcript, one real silence by the meter). Only sentence ends: quieting every pause ("debreath",
 * tried by the voice session) cost lip-sync and clipped words.
 *
 * With `levels` (the narration's loudness, `LEVEL_FRAME_SEC` frames), a gap that holds speech the
 * transcript did not write down is left alone — never quieted, never split by an insertion.
 */
export function planSentencePauses(
  words: Pick<WhisperWord, "word" | "start" | "end">[],
  pauseSec = PAUSE_SEC(),
  levels?: number[],
  /** Words that end a sentence in the SCRIPT (`scriptSentenceEnds`), besides the transcript's own. */
  scriptEnds?: Set<number>
): SentencePause[] {
  const speechDb = levels ? speechLevelDb(levels) : 0;
  const out: SentencePause[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i].word.trim().replace(/["'”’)\]]+$/, "");
    const heardEnd = /[.?!]$/.test(w) && !NOT_A_SENTENCE_END.test(w) && !/^\d+\.$/.test(w);
    if (!heardEnd && !scriptEnds?.has(i)) continue;
    const gap = words[i + 1].start - words[i].end;
    const mid = +(words[i].end + Math.max(0, gap) / 2).toFixed(3);
    if (levels && gap > 0 && holdsSpeech(levels, words[i].end + EDGE_SEC, words[i + 1].start - EDGE_SEC, speechDb)) continue;
    // The gap as the SOUND has it: from where the word died away to where the next one begins.
    const a = levels ? soundEnd(levels, words[i].end, words[i + 1].start, speechDb) : words[i].end + EDGE_SEC;
    const b = levels ? soundStart(levels, words[i + 1].start, a, speechDb) : words[i + 1].start - EDGE_SEC;
    const quietGap = Math.max(0, b - a);
    // With the sound measured, any sentence end with less quiet than the pause gets the rest added.
    if (levels ? quietGap < pauseSec - 0.05 : gap < MIN_GAP_SEC) {
      const add = +(pauseSec - Math.max(0, levels ? quietGap : gap)).toFixed(3);
      const at = levels ? quietest(levels, words[i].end, Math.max(words[i].end, words[i + 1].start)) : mid;
      if (add > 0.02) out.push({ atSec: +at.toFixed(3), addSec: add });
    } else {
      out.push({ atSec: mid, addSec: 0, muteFrom: +a.toFixed(3), muteTo: +b.toFixed(3) });
    }
  }
  return out;
}

const RATE = 48000;
const CH = 2;

/** Loudness per `LEVEL_FRAME_SEC` frame (dBFS, both channels) of interleaved s16le PCM. */
export function pcmLevels(pcm: Buffer, rate = RATE, ch = CH): number[] {
  const per = Math.round(LEVEL_FRAME_SEC * rate) * ch;
  const n = pcm.length >> 1;
  const out: number[] = [];
  for (let i = 0; i + per <= n; i += per) {
    let e = 0;
    for (let j = i; j < i + per; j++) {
      const v = pcm.readInt16LE(j * 2) / 32768;
      e += v * v;
    }
    out.push(10 * Math.log10(e / per + 1e-12));
  }
  return out;
}

/**
 * The narration with a real pause after every sentence. Transcribes it (WhisperX), plans the
 * insertions, splices silence in, re-encodes as the master's own shape (mp3, 48 kHz, stereo).
 * Returns the input unchanged when nothing needs a pause, on `SENTENCE_PAUSES=0`, or on any failure.
 */
export async function padSentenceEnds(
  buf: Buffer,
  log: (msg: string) => void = () => {},
  /** The script as voiced: its sentence ends are trusted over the transcript's punctuation. */
  script?: string
): Promise<Buffer> {
  if (process.env.SENTENCE_PAUSES === "0") return buf;
  const dir = await mkdtemp(path.join(tmpdir(), "pauses-")).catch(() => null);
  if (!dir) return buf;
  try {
    const t = await transcribeWordsFromBuffer(buf);
    if (!("words" in t) || t.words.length < 4) return buf;
    const src = path.join(dir, "in.mp3"), raw = path.join(dir, "in.pcm"), outRaw = path.join(dir, "out.pcm"), out = path.join(dir, "out.mp3");
    await writeFile(src, buf);
    await execFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "mp3", "-i", src, "-f", "s16le", "-ac", String(CH), "-ar", String(RATE), raw]);
    const pcm = await readFile(raw);
    const levels = pcmLevels(pcm);
    const ends = script ? scriptSentenceEnds(t.words, script) : undefined;
    const plan = planSentencePauses(t.words, PAUSE_SEC(), levels, ends);
    const spared = planSentencePauses(t.words, PAUSE_SEC(), undefined, ends).length - plan.length;
    if (spared > 0) log(`sentence pauses: ${spared} gap(s) left as voiced — they hold speech the transcript missed`);
    if (!plan.length) return buf;
    // quiet the breath in each long sentence gap — eased in and out, never down to dead air
    const FADE = Math.round(FADE_SEC * RATE);
    for (const p of plan) {
      if (p.muteFrom == null || p.muteTo == null) continue;
      const a = Math.round(p.muteFrom * RATE), b = Math.min(pcm.length / (2 * CH), Math.round(p.muteTo * RATE));
      for (let n = a; n < b; n++) {
        const k = Math.max(0, Math.min(1, (n - a) / FADE, (b - n) / FADE));
        const gain = 1 - (1 - QUIET_GAIN) * (0.5 - 0.5 * Math.cos(Math.PI * k));
        for (let c = 0; c < CH; c++) {
          const o = (n * CH + c) * 2;
          pcm.writeInt16LE(Math.round(pcm.readInt16LE(o) * gain), o);
        }
      }
    }
    const frame = 2 * CH;
    const parts: Buffer[] = [];
    let from = 0;
    // silence goes in at the quietest moment between the words, with the sound either side eased
    // down into it and up out of it, so the join is never heard
    // a word running straight into the pause gets a natural-length decay; the next word's onset
    // is only softened, never swallowed
    const EASE_OUT = Math.round(0.06 * RATE);
    const EASE = Math.round(0.03 * RATE);
    const ease = (start: number, len: number, down: boolean) => {
      for (let n = 0; n < len; n++) {
        const at = start + n;
        if (at < 0 || at >= pcm.length / frame) continue;
        const g = down ? 1 - n / len : n / len;
        for (let c = 0; c < CH; c++) {
          const o = (at * CH + c) * 2;
          pcm.writeInt16LE(Math.round(pcm.readInt16LE(o) * g), o);
        }
      }
    };
    for (const p of plan.filter(x => x.addSec > 0)) {
      const sample = Math.round(p.atSec * RATE);
      const at = Math.min(pcm.length, sample * frame);
      if (at < from) continue;
      ease(sample - EASE_OUT, EASE_OUT, true);
      ease(sample, EASE, false);
      parts.push(pcm.subarray(from, at), Buffer.alloc(Math.round(p.addSec * RATE) * frame));
      from = at;
    }
    parts.push(pcm.subarray(from));
    await writeFile(outRaw, Buffer.concat(parts));
    await execFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ac", String(CH), "-ar", String(RATE), "-i", outRaw, "-c:a", "libmp3lame", "-b:a", "192k", out]);
    const mp3 = await readFile(out);
    const added = plan.reduce((s, p) => s + p.addSec, 0);
    log(`sentence pauses: ${plan.filter(p => p.addSec > 0).length} sentence end(s) given a pause (+${added.toFixed(1)} s), ${plan.filter(p => p.muteFrom != null).length} quieted`);
    return mp3;
  } catch (e: any) {
    log(`sentence pauses failed (${e?.message ?? e}); keeping the narration as voiced`);
    return buf;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

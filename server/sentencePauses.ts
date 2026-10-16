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
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFfmpeg } from "./ffmpegSpawn";
import { transcribeWordsFromBuffer, type WhisperWord } from "./_core/voiceTranscription";

/** The pause every sentence ends with (the clone voices' pause mark, `CLONE_SENTENCE_PAUSE_SEC`). */
export const PAUSE_SEC = () => Number(process.env.SENTENCE_PAUSE_SEC ?? 0.3);
/** A sentence end already followed by this much quiet is left alone. */
export const MIN_GAP_SEC = 0.25;

/** Abbreviations whose full stop does not end a sentence. */
const NOT_A_SENTENCE_END = /^(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|vs|etc|e\.g|i\.e|No|Fig|approx)\.$/i;

/** Kept clear of a word's tail and the next word's head when a gap is quieted. */
export const EDGE_SEC = 0.04;

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
 */
export function planSentencePauses(
  words: Pick<WhisperWord, "word" | "start" | "end">[],
  pauseSec = PAUSE_SEC()
): SentencePause[] {
  const out: SentencePause[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i].word.trim().replace(/["'”’)\]]+$/, "");
    if (!/[.?!]$/.test(w) || NOT_A_SENTENCE_END.test(w) || /^\d+\.$/.test(w)) continue;
    const gap = words[i + 1].start - words[i].end;
    const mid = +(words[i].end + Math.max(0, gap) / 2).toFixed(3);
    if (gap < MIN_GAP_SEC) {
      const add = +(pauseSec - Math.max(0, gap)).toFixed(3);
      if (add > 0.02) out.push({ atSec: mid, addSec: add });
    } else {
      out.push({
        atSec: mid,
        addSec: 0,
        muteFrom: +(words[i].end + EDGE_SEC).toFixed(3),
        muteTo: +(words[i + 1].start - EDGE_SEC).toFixed(3),
      });
    }
  }
  return out;
}

const RATE = 48000;
const CH = 2;

/**
 * The narration with a real pause after every sentence. Transcribes it (WhisperX), plans the
 * insertions, splices silence in, re-encodes as the master's own shape (mp3, 48 kHz, stereo).
 * Returns the input unchanged when nothing needs a pause, on `SENTENCE_PAUSES=0`, or on any failure.
 */
export async function padSentenceEnds(
  buf: Buffer,
  log: (msg: string) => void = () => {}
): Promise<Buffer> {
  if (process.env.SENTENCE_PAUSES === "0") return buf;
  const dir = await mkdtemp(path.join(tmpdir(), "pauses-")).catch(() => null);
  if (!dir) return buf;
  try {
    const t = await transcribeWordsFromBuffer(buf);
    if (!("words" in t) || t.words.length < 4) return buf;
    const plan = planSentencePauses(t.words);
    if (!plan.length) return buf;
    const src = path.join(dir, "in.mp3"), raw = path.join(dir, "in.pcm"), outRaw = path.join(dir, "out.pcm"), out = path.join(dir, "out.mp3");
    await writeFile(src, buf);
    await execFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "mp3", "-i", src, "-f", "s16le", "-ac", String(CH), "-ar", String(RATE), raw]);
    const pcm = await readFile(raw);
    // quiet the breath in each long sentence gap, with 20 ms fades so nothing clicks
    const FADE = Math.round(0.02 * RATE);
    for (const p of plan) {
      if (p.muteFrom == null || p.muteTo == null) continue;
      const a = Math.round(p.muteFrom * RATE), b = Math.min(pcm.length / (2 * CH), Math.round(p.muteTo * RATE));
      for (let n = a; n < b; n++) {
        const k = Math.min(1, (n - a) / FADE, (b - n) / FADE);
        const gain = 1 - Math.max(0, k);
        for (let c = 0; c < CH; c++) {
          const o = (n * CH + c) * 2;
          pcm.writeInt16LE(Math.round(pcm.readInt16LE(o) * gain), o);
        }
      }
    }
    const frame = 2 * CH;
    const parts: Buffer[] = [];
    let from = 0;
    for (const p of plan.filter(x => x.addSec > 0)) {
      const at = Math.min(pcm.length, Math.round(p.atSec * RATE) * frame);
      if (at < from) continue;
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

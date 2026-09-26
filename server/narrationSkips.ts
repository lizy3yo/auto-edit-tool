/**
 * The voice must say every word of the script.
 *
 * 69Labs (ElevenLabs underneath) occasionally DROPS text from a generation: Hank's real render
 * (job 162) read "…a saw, a drill, and a stack." and went straight on to "Folks will tell you…",
 * losing "of sandpaper, wondering if that clean Japanese look is really worth anything on a market
 * table" — and near the end lost two whole sentences. Nothing noticed: the plausibility gate saw a
 * stretch of script with too little time, re-transcribed it, heard the same words, and cut the
 * scenes there by word count, so the film shipped with pictures of sentences nobody said.
 *
 * `findSkippedWords` tells a SKIP from a transcript HOLE by the clock. A hole is time with no words
 * in it (the audio is there, whisper missed it — `alignmentHeal.ts` handles that); a skip is script
 * words with no TIME for them — the words either side of the gap sit a pause apart. A misheard
 * word is neither: whisper still hears something in its place.
 *
 * `repairSkippedNarration` re-voices each paragraph that skipped, checks the new take says every
 * word (twice at most), and splices it into the master in place of the old read — the rest of the
 * master, and every pause in it, is untouched. A paragraph that skips twice STOPS the job at
 * voicing, before any picture or host clip is paid for.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { WhisperWord } from "./_core/voiceTranscription";
import { tokenizeNarration } from "./narrationAlignment";
import { downloadToTemp } from "./videoAssembly";

/** A gap of fewer script words than this is whisper noise, never a skip worth a re-read. */
export const SKIP_MIN_WORDS = 4;
/** Re-reads per paragraph before the job is stopped. */
export const SKIP_REVOICE_ATTEMPTS = 2;
/** How far ahead in the transcript a script word may be found (whisper splits/inserts words). */
const LOOK_AHEAD = 8;

export type SkippedStretch = {
  /** 0-based paragraphs the missing words belong to. */
  paragraphs: number[];
  /** The script words that were not said. */
  missing: string;
  /** Where in the audio they should have been (end of the word before, start of the word after). */
  atSec: number;
  toSec: number;
};

type ScriptTok = { tok: string; para: number };
type HeardTok = { tok: string; word: number };

/**
 * Match script tokens to transcript tokens, in order. A match needs its neighbour to agree too
 * (the next script word on the next heard word, or the previous on the previous) so a "the" or an
 * "a" inside a skipped stretch cannot latch onto the next sentence and split the stretch into
 * pieces too short to see. Returns, per script token, the heard token it matched or -1.
 */
export function matchScriptToHeard(want: string[], got: string[]): number[] {
  const hit: number[] = new Array(want.length).fill(-1);
  let g = 0;
  let sinceHit = 0;
  for (let w = 0; w < want.length; w++) {
    const limit = Math.min(got.length, g + LOOK_AHEAD);
    let found = -1;
    for (let i = g; i < limit; i++) {
      if (got[i] !== want[w]) continue;
      const nextAgrees =
        w + 1 >= want.length || i + 1 >= got.length || got[i + 1] === want[w + 1];
      const prevAgrees = w > 0 && i > 0 && hit[w - 1] === i - 1;
      if (nextAgrees || prevAgrees) {
        found = i;
        break;
      }
    }
    // Lost the thread (a long stretch of whisper noise): find the next three script words
    // together further on and carry on from there.
    if (found < 0 && ++sinceHit >= 20 && w + 2 < want.length) {
      for (let i = g; i + 2 < got.length && i < g + 400; i++) {
        if (got[i] === want[w] && got[i + 1] === want[w + 1] && got[i + 2] === want[w + 2]) {
          found = i;
          break;
        }
      }
    }
    if (found >= 0) {
      hit[w] = found;
      g = found + 1;
      sinceHit = 0;
    }
  }
  return hit;
}

function scriptTokens(paragraphs: string[]): ScriptTok[] {
  return paragraphs.flatMap((p, para) => tokenizeNarration(p).map(tok => ({ tok, para })));
}

function heardTokens(words: WhisperWord[]): HeardTok[] {
  return words.flatMap((w, word) => tokenizeNarration(w.word).map(tok => ({ tok, word })));
}

/**
 * Script words the voice did not say. A run of unmatched script words is a SKIP when almost
 * nothing was heard in its place AND the clock has no room for it: less than a third of the time
 * those words take to say, plus a pause. `durationSec` bounds a skip at the very end.
 */
export function findSkippedWords(
  paragraphs: string[],
  words: WhisperWord[],
  durationSec: number
): SkippedStretch[] {
  const want = scriptTokens(paragraphs);
  const got = heardTokens(words);
  const hit = matchScriptToHeard(
    want.map(t => t.tok),
    got.map(t => t.tok)
  );
  const out: SkippedStretch[] = [];
  let w = 0;
  while (w < want.length) {
    if (hit[w] >= 0) {
      w++;
      continue;
    }
    let end = w;
    while (end < want.length && hit[end] < 0) end++;
    const n = end - w;
    if (n >= SKIP_MIN_WORDS) {
      const prevHeard = w > 0 ? hit[w - 1] : -1;
      const nextHeard = end < want.length ? hit[end] : got.length;
      const heardBetween = nextHeard - prevHeard - 1;
      const atSec = prevHeard >= 0 ? words[got[prevHeard].word].end : 0;
      const toSec =
        nextHeard < got.length ? words[got[nextHeard].word].start : durationSec;
      const roomSec = toSec - atSec;
      // Nothing (or next to nothing) heard in their place: a price or a count the transcript
      // writes as digits ("a dollar and thirty cents" → "$1.30", "a hundred and one" → "101")
      // leaves a token or two there, and is not a skip.
      if (heardBetween <= Math.floor(n * 0.15) && roomSec < 1 + n * 0.12) {
        out.push({
          paragraphs: Array.from(new Set(want.slice(w, end).map(t => t.para))),
          missing: want
            .slice(w, end)
            .map(t => t.tok)
            .join(" "),
          atSec,
          toSec,
        });
      }
    }
    w = end;
  }
  return out;
}

/**
 * Where paragraph `para` sits in the audio: from just before its first heard word to just after
 * its last, never reaching into a neighbour's words. A paragraph with nothing heard at all sits
 * at a point between its neighbours. Words that were skipped have no audio, so this span holds
 * every sound the paragraph made.
 */
export function paragraphSpan(
  paragraphs: string[],
  words: WhisperWord[],
  para: number,
  durationSec: number
): { fromSec: number; toSec: number } {
  const want = scriptTokens(paragraphs);
  const got = heardTokens(words);
  const hit = matchScriptToHeard(
    want.map(t => t.tok),
    got.map(t => t.tok)
  );
  const mine = want.map((t, k) => (t.para === para ? hit[k] : -1)).filter(h => h >= 0);
  const before = want
    .map((t, k) => (t.para < para ? hit[k] : -1))
    .filter(h => h >= 0);
  const after = want
    .map((t, k) => (t.para > para ? hit[k] : -1))
    .filter(h => h >= 0);
  const prevEnd = before.length ? words[got[Math.max(...before)].word].end : 0;
  const nextStart = after.length ? words[got[Math.min(...after)].word].start : durationSec;
  if (!mine.length) {
    const mid = (prevEnd + nextStart) / 2;
    return { fromSec: mid, toSec: mid };
  }
  const first = words[got[Math.min(...mine)].word];
  const last = words[got[Math.max(...mine)].word];
  return {
    fromSec: Math.max(prevEnd, first.start - Math.min(0.08, (first.start - prevEnd) / 2)),
    toSec: Math.min(nextStart, last.end + Math.min(0.12, (nextStart - last.end) / 2)),
  };
}

export type SpliceTake = {
  /** The span of the master the take replaces. */
  fromSec: number;
  toSec: number;
  /** The part of the take to keep, and its words (relative to the take's own start). */
  keepFromSec: number;
  keepToSec: number;
  words: WhisperWord[];
};

/**
 * The master's words after splicing `takes` in: words before a replaced span are unchanged, the
 * take's own words are placed where it now sits, and everything after moves by how much longer
 * or shorter the new read is. Pure — the timeline the scene cuts are made from.
 */
export function splicedWords(
  words: WhisperWord[],
  takes: SpliceTake[]
): { words: WhisperWord[]; shiftSec: number } {
  const sorted = [...takes].sort((a, b) => a.fromSec - b.fromSec);
  const out: WhisperWord[] = [];
  let shift = 0;
  let k = 0;
  for (const w of words) {
    while (k < sorted.length && w.start >= sorted[k].fromSec) {
      const t = sorted[k];
      for (const tw of t.words) {
        if (tw.end <= t.keepFromSec || tw.start >= t.keepToSec) continue;
        const at = t.fromSec + shift - t.keepFromSec;
        out.push({ word: tw.word, start: tw.start + at, end: tw.end + at });
      }
      shift += t.keepToSec - t.keepFromSec - (t.toSec - t.fromSec);
      k++;
    }
    const t = k > 0 ? sorted[k - 1] : null;
    if (t && w.start < t.toSec) continue; // part of the old read that was replaced
    out.push({ word: w.word, start: w.start + shift, end: w.end + shift });
  }
  for (; k < sorted.length; k++) {
    const t = sorted[k];
    for (const tw of t.words) {
      if (tw.end <= t.keepFromSec || tw.start >= t.keepToSec) continue;
      const at = t.fromSec + shift - t.keepFromSec;
      out.push({ word: tw.word, start: tw.start + at, end: tw.end + at });
    }
    shift += t.keepToSec - t.keepFromSec - (t.toSec - t.fromSec);
  }
  return { words: out, shiftSec: shift };
}

/** Thrown at voicing when a paragraph keeps skipping words — nothing after voicing has run. */
export class SkippedNarrationError extends Error {}

export type RepairDeps = {
  /** Voice paragraph `para` again; returns the mp3 bytes. */
  voice: (text: string, para: number) => Promise<Buffer>;
  /** Word timings of an mp3, or null when transcription failed. */
  transcribe: (audio: Buffer) => Promise<{ words: WhisperWord[]; duration: number } | null>;
  /** Bring a take to the master's level. */
  matchLevel: (take: Buffer, master: Buffer) => Promise<Buffer>;
  runFfmpeg: (args: string[]) => Promise<void>;
  /** Length of an mp3 in seconds. */
  durationOf: (audio: Buffer) => Promise<number>;
  log: (msg: string) => void;
};

/**
 * Re-voice every paragraph that skipped words and splice the new reads into the master. Returns
 * null when nothing was skipped. Throws `SkippedNarrationError` when a paragraph still skips after
 * `SKIP_REVOICE_ATTEMPTS` re-reads. A take that cannot be transcribed is used unchecked — a
 * transcription outage says nothing about the read, and the old read is known to be wrong.
 */
export async function repairSkippedNarration(
  opts: {
    paragraphs: string[];
    words: WhisperWord[];
    durationSec: number;
    master: Buffer;
  },
  deps: RepairDeps
): Promise<{
  master: Buffer;
  words: WhisperWord[];
  durationSec: number;
  fixed: number[];
} | null> {
  const { paragraphs, words, durationSec, master } = opts;
  const skips = findSkippedWords(paragraphs, words, durationSec);
  if (!skips.length) return null;
  const paras = Array.from(new Set(skips.flatMap(s => s.paragraphs))).sort((a, b) => a - b);
  for (const s of skips) {
    deps.log(
      `voice skipped ${s.missing.split(" ").length} word(s) at ${s.atSec.toFixed(1)}s: "${s.missing.slice(0, 120)}"`
    );
  }
  const takes: (SpliceTake & { audio: Buffer })[] = [];
  for (const para of paras) {
    const text = paragraphs[para];
    let chosen: (SpliceTake & { audio: Buffer }) | null = null;
    for (let attempt = 1; attempt <= SKIP_REVOICE_ATTEMPTS && !chosen; attempt++) {
      const audio = await deps.matchLevel(await deps.voice(text, para), master);
      const heard = await deps.transcribe(audio);
      const span = paragraphSpan(paragraphs, words, para, durationSec);
      if (!heard) {
        deps.log(`paragraph ${para + 1}: re-read ${attempt} could not be checked — using it`);
        chosen = { ...span, keepFromSec: 0, keepToSec: await deps.durationOf(audio), words: [], audio };
        break;
      }
      const still = findSkippedWords([text], heard.words, heard.duration);
      if (still.length) {
        deps.log(
          `paragraph ${para + 1}: re-read ${attempt} skipped "${still[0].missing.slice(0, 80)}" too`
        );
        continue;
      }
      const first = heard.words[0];
      const last = heard.words[heard.words.length - 1];
      chosen = {
        ...span,
        keepFromSec: first ? Math.max(0, first.start - 0.06) : 0,
        keepToSec: last ? Math.min(heard.duration, last.end + 0.1) : heard.duration,
        words: heard.words,
        audio,
      };
      deps.log(`paragraph ${para + 1}: re-read ${attempt} says every word`);
    }
    if (!chosen) {
      const opening = text.split(/\s+/).slice(0, 12).join(" ");
      throw new SkippedNarrationError(
        `The voice kept skipping words in paragraph ${para + 1} ("${opening}…") after ` +
          `${SKIP_REVOICE_ATTEMPTS} re-recordings, so the video was stopped before any picture or ` +
          `host clip was paid for. Retry the video, or reword that paragraph.`
      );
    }
    takes.push(chosen);
  }

  const dir = join(tmpdir(), `narration-skip-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "master.mp3"), master);
    const ins = ["-i", join(dir, "master.mp3")];
    const legs: string[] = [];
    const order: string[] = [];
    const fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
    let cursor = 0;
    takes.sort((a, b) => a.fromSec - b.fromSec);
    takes.forEach((t, k) => {
      const path = join(dir, `take-${k}.mp3`);
      writeFileSync(path, t.audio);
      ins.push("-i", path);
      if (t.fromSec > cursor) {
        legs.push(`[0:a]atrim=${cursor.toFixed(3)}:${t.fromSec.toFixed(3)},asetpts=N/SR/TB,${fmt}[m${k}]`);
        order.push(`[m${k}]`);
      }
      legs.push(
        `[${k + 1}:a]atrim=${t.keepFromSec.toFixed(3)}:${t.keepToSec.toFixed(3)},asetpts=N/SR/TB,${fmt}[t${k}]`
      );
      order.push(`[t${k}]`);
      cursor = t.toSec;
    });
    legs.push(`[0:a]atrim=start=${cursor.toFixed(3)},asetpts=N/SR/TB,${fmt}[tail]`);
    order.push("[tail]");
    const out = join(dir, "spliced.mp3");
    await deps.runFfmpeg([
      "-y",
      ...ins,
      "-filter_complex",
      `${legs.join(";")};${order.join("")}concat=n=${order.length}:v=0:a=1[a]`,
      "-map",
      "[a]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      out,
    ]);
    const spliced = readFileSync(out);
    const { words: next, shiftSec } = splicedWords(words, takes);
    return { master: spliced, words: next, durationSec: durationSec + shiftSec, fixed: paras };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The bytes of an audio file — our own R2 objects through the S3 endpoint (see `downloadToTemp`). */
export async function fetchAudioBuffer(url: string): Promise<Buffer> {
  const dir = join(tmpdir(), `audio-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    return readFileSync(await downloadToTemp(url, dir, "audio.mp3"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

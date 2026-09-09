/**
 * Normalize and VERIFY an operator-supplied master narration.
 *
 * Two jobs, deliberately separate:
 *
 *  - `normalizeNarrationAudio` makes an arbitrary upload look exactly like a voiced master, so
 *    nothing downstream can tell them apart. A provider master arrives as 48k stereo mp3 with
 *    the channel's volume gain and the dead-air cap already applied (`pollUnifiedTTSTask`);
 *    an operator's export could be 44.1k mono, or a WAV. Every ffmpeg stage after this point
 *    was written against the former, and a mismatched sample rate surfaces as a subtly wrong
 *    film rather than as an error.
 *
 *  - `verifyNarrationRead` decides whether the upload is a read of THIS script. This is the
 *    gate that makes the whole hatch safe. Scene boundaries are recovered by locating each
 *    scene's text inside the transcript (`findPhrase`), so a wrong file, an older draft or an
 *    ad-libbed read does not fail — it silently falls through to the proportional split, which
 *    loses CTA and QR keyword alignment. That damage is invisible until someone watches the
 *    finished film, hours and a full render of paid clips later. One whisperx call here is the
 *    cheapest possible place to catch it.
 */

import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, readFile, unlink } from "fs/promises";
import { nanoid } from "nanoid";
import { getFFmpegPath } from "./ffmpegPath";
import { getMediaDuration } from "./mediaProbe";
import { capDeadAirPauses } from "./ttsUnified";
import { transcribeWordsFromBuffer } from "./_core/voiceTranscription";
import { tokenizeNarration } from "./narrationAlignment";

/** Ceiling on one normalize pass. A long narration re-encodes in well under this. */
const NORMALIZE_MAX_MS = 10 * 60 * 1000;

/** Run one ffmpeg invocation over a temp file and return the output bytes. */
async function ffmpegToBuffer(
  input: Buffer,
  args: (inPath: string, outPath: string) => string[],
  label: string
): Promise<Buffer> {
  const base = join(tmpdir(), `narr-${nanoid(8)}`);
  const inPath = `${base}-in`;
  const outPath = `${base}-out.mp3`;
  try {
    await writeFile(inPath, input);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(getFFmpegPath(), args(inPath, outPath));
      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`ffmpeg ${label} timed out`));
      }, NORMALIZE_MAX_MS);
      let stderr = "";
      proc.stderr.on("data", d => {
        stderr += d.toString();
      });
      proc.on("error", err => {
        clearTimeout(killTimer);
        reject(new Error(`ffmpeg process error: ${err.message}`));
      });
      proc.on("close", code => {
        clearTimeout(killTimer);
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `ffmpeg ${label} failed (exit ${code}): ${stderr.trim().slice(-400)}`
            )
          );
      });
    });
    return Buffer.from(await readFile(outPath));
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

/**
 * Re-encode any accepted upload to the exact shape a voiced master has: mp3, 48 kHz, stereo,
 * 192 kbps, with the channel's volume gain folded in and over-long dead air capped.
 *
 * `capDeadAirPauses` is self-targeting — it only strips silence below -60 dBFS, which is the
 * signature of a noise-gated TTS clone rather than of a room. A human recording has real room
 * tone above that floor and comes back byte-identical, which is correct: a person's pauses are
 * part of the read, not an artifact to remove.
 */
export async function normalizeNarrationAudio(
  raw: Buffer,
  volume?: number
): Promise<Buffer> {
  const filters = ["aresample=48000"];
  // Same 0.5-2 band the channel's stored multiplier is parsed against; a neutral value is
  // skipped so an already-correct file is not re-gained.
  if (volume && volume >= 0.5 && volume <= 2 && Math.abs(volume - 1) >= 0.001) {
    filters.push(`volume=${volume}`);
  }
  const mp3 = await ffmpegToBuffer(
    raw,
    (inPath, outPath) => [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inPath,
      // Drop any video stream: cover art in an m4a/mp3 would otherwise be carried into the
      // "audio" file and confuse every later probe.
      "-vn",
      "-af",
      filters.join(","),
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      outPath,
    ],
    "narration normalize"
  );
  return Buffer.from(await capDeadAirPauses(mp3));
}

/** Duration of an in-memory audio buffer, in seconds (0 when it cannot be read). */
export async function probeAudioDurationSec(audio: Buffer): Promise<number> {
  const path = join(tmpdir(), `narrdur-${nanoid(8)}.mp3`);
  try {
    await writeFile(path, audio);
    return await getMediaDuration(path);
  } catch {
    return 0;
  } finally {
    await unlink(path).catch(() => {});
  }
}

export type NarrationVerdict = {
  ok: boolean;
  /** Fraction of the script's words found, in order, in the transcript (0-1). */
  coverage: number;
  /** Transcribed length, seconds. */
  durationSec: number;
  /** Human-readable reason when `ok` is false. */
  reason?: string;
  /** First divergence: what the script says there, and what was heard instead. */
  expected?: string;
  heard?: string;
  /** True when transcription itself failed — the read is UNKNOWN, not wrong. */
  unverified?: boolean;
};

/**
 * Fraction of `script`'s words that appear, in order, in `heard`.
 *
 * Greedy rather than a full LCS on purpose: the transcript is supposed to be a read of this
 * script, so the two sequences are near-identical and a forward scan finds the same alignment an
 * O(n*m) table would, on inputs of 3,000+ words where that table is 9M cells. A genuinely
 * different recording scores near zero under either.
 *
 * Also returns the first position where the two diverge, which is what an operator actually
 * needs — "it stopped matching at 'the entire material cost'" localizes a truncated file or a
 * skipped paragraph instantly, where a bare percentage does not.
 */
export function readCoverage(
  script: string,
  heard: string
): { coverage: number; firstMissIndex: number } {
  const want = tokenizeNarration(script);
  const got = tokenizeNarration(heard);
  if (want.length === 0) return { coverage: 1, firstMissIndex: -1 };
  let g = 0;
  let matched = 0;
  let firstMiss = -1;
  for (let w = 0; w < want.length; w++) {
    // Bounded look-ahead: whisper drops or splits the occasional word, and an unbounded scan
    // would happily match the script's next word 900 words later and call the gap "covered".
    const limit = Math.min(got.length, g + 8);
    let hit = -1;
    for (let i = g; i < limit; i++) {
      if (got[i] === want[w]) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) {
      matched++;
      g = hit + 1;
    } else if (firstMiss < 0) {
      firstMiss = w;
    }
  }
  return { coverage: matched / want.length, firstMissIndex: firstMiss };
}

/**
 * Coverage below which an upload is refused.
 *
 * Not 1.0, and not close to it: whisper mishears proper nouns, splits hyphenates and writes
 * numerals as digits, so a perfect read of the right script lands around 0.93-0.98. The 69Labs
 * masters this replaces are transcribed by the same model and score in that same band. 0.85 sits
 * clearly below honest transcription noise and clearly above a different recording, which scores
 * near zero — there is no realistic input in between.
 */
export const MIN_READ_COVERAGE = 0.85;

/** Widest accepted gap between the supplied audio's length and the script's expected length. */
const MAX_DURATION_RATIO = 1.6;
const MIN_DURATION_RATIO = 0.5;

const mmss = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * Decide whether a supplied recording is a faithful read of `spokenScript`.
 *
 * The duration check runs FIRST because it costs nothing: a file half or double the expected
 * length is the wrong file, and catching that before the whisperx call saves a paid GPU second
 * on the commonest operator mistake.
 */
export async function verifyNarrationRead(opts: {
  audio: Buffer;
  spokenScript: string;
  durationSec: number;
  expectedSec?: number;
}): Promise<NarrationVerdict> {
  const { audio, spokenScript, durationSec, expectedSec } = opts;

  if (expectedSec && expectedSec > 0) {
    const ratio = durationSec / expectedSec;
    if (ratio > MAX_DURATION_RATIO || ratio < MIN_DURATION_RATIO) {
      return {
        ok: false,
        coverage: 0,
        durationSec,
        reason:
          `That file is ${mmss(durationSec)} long but this script should read about ` +
          `${mmss(expectedSec)}. It looks like the wrong file, or a partial export.`,
      };
    }
  }

  const transcript = await transcribeWordsFromBuffer(audio);
  if ("error" in transcript) {
    // Transcription failing says nothing about the READ. Refusing here would block a correct
    // upload on an unrelated outage; accepting silently would defeat the gate. Report it as
    // unverified and let the caller decide — the UI asks the operator to confirm.
    return {
      ok: false,
      coverage: 0,
      durationSec,
      unverified: true,
      reason: `Could not transcribe the upload to check it (${transcript.error}).`,
    };
  }

  const heard = transcript.words.map(w => w.word).join(" ");
  const { coverage, firstMissIndex } = readCoverage(spokenScript, heard);
  if (coverage >= MIN_READ_COVERAGE) {
    return {
      ok: true,
      coverage,
      durationSec: transcript.duration || durationSec,
    };
  }

  const at = Math.max(0, firstMissIndex);
  const context = (arr: string[]) => arr.slice(at, at + 12).join(" ");
  return {
    ok: false,
    coverage,
    durationSec: transcript.duration || durationSec,
    reason:
      `Only ${Math.round(coverage * 100)}% of the script was heard in that recording ` +
      `(needs ${Math.round(MIN_READ_COVERAGE * 100)}%). It reads as a different script, an ` +
      `older draft, or a partial file.`,
    expected: context(tokenizeNarration(spokenScript)),
    heard: context(tokenizeNarration(heard)),
  };
}

/**
 * Film LOUDNESS — every finished film leaves assembly at one loudness, YouTube's.
 *
 * Nothing set a film's loudness: the narration leveller only evens the voice out WITHIN a film
 * (its target is the film's own median), the music bed is set relative to the voice, and the last
 * step stream-copied whatever that made into the file. So a film was as loud as its voice
 * happened to come back from the provider. Measured on two finished films (2026-10-10): Granny
 * Ruth's job 255 at -23.1 LUFS and Beau Carter's job 357 at -34.0 LUFS (peak -16 dBTP), against
 * the -14 LUFS YouTube plays at — and YouTube turns a loud video DOWN but never a quiet one up,
 * so Beau's film played 20 dB under everything around it. The per-channel Volume multiplier is a
 * plain gain capped at 2.0 (+6 dB) with no limiter, so it could not close that gap.
 *
 * The fix is the standard one for delivery: measure the finished track (EBU R128 integrated
 * loudness and true peak), apply ONE fixed gain to reach the target — voice and music together,
 * so their balance is untouched and nothing pumps — and hold the peaks under a ceiling with a
 * look-ahead limiter. ffmpeg's `loudnorm` was not used for the lift: its linear mode refuses when
 * the peaks would pass the ceiling (both films: 18 dB between loudness and peak, 13 allowed at
 * -14/-1) and silently falls back to its DYNAMIC mode, which rides the gain and pumps.
 *
 * `alimiter` limits SAMPLE peaks, so it runs at 4x the sample rate (192 kHz), where sample peaks
 * are true peaks to within a fraction of a dB. The ceiling it is given sits under the one the
 * file must hold, because the AAC encode after it adds a little back: with the limiter at -1 the
 * encoded file measured -0.7 dBTP, at -1.5 it measured -1.2.
 *
 * Everything that decides is pure and here; the two ffmpeg calls live in `videoAssembly.ts`.
 * A failure there ships the film exactly as it was mixed.
 */

/** YouTube's playback reference, LUFS integrated. */
export const FILM_LOUDNESS_TARGET_LUFS = -14;
/** The finished file's true peak must stay under this, dBTP. */
export const FILM_TRUE_PEAK_MAX_DBTP = -1;
/** What the limiter is set to: under the file's ceiling by what the AAC encode adds back. */
export const FILM_LIMITER_CEILING_DB = -1.5;
/**
 * The most the limiter may take off the loudest peak. Past this the gain is held back and the
 * film lands under the target instead — a quieter film beats a squashed voice. Both measured
 * films needed 5-6 dB.
 */
export const FILM_MAX_LIMITING_DB = 6;
/** A film already this close to the target is left byte-identical. */
export const FILM_LOUDNESS_DEADBAND_LU = 0.5;
/** A lift past this is a measurement gone wrong (a near-silent track), not a quiet voice. */
export const FILM_MAX_GAIN_DB = 30;
/** `FILM_LOUDNESS_LUFS` is honoured inside this band only. */
const TARGET_MIN_LUFS = -24;
const TARGET_MAX_LUFS = -9;

export interface LoudnessReading {
  /** Integrated loudness, LUFS. */
  integratedLufs: number;
  /** True peak, dBTP. */
  truePeakDb: number;
}

export interface FilmLoudnessPlan {
  /** The one gain applied to the whole track, dB (negative for a film over the target). */
  gainDb: number;
  /** What the limiter takes off the loudest peak, dB. */
  limitingDb: number;
  /** True when the gain was held back so the limiter stays inside `FILM_MAX_LIMITING_DB`. */
  capped: boolean;
  /** False when the film is already on target: the caller keeps the track as mixed. */
  needed: boolean;
}

/**
 * The target for this process, or null when the step is switched off (`FILM_LOUDNESS=0`).
 * `FILM_LOUDNESS_LUFS` moves the target; a value outside -24..-9 is ignored, not obeyed.
 */
export function filmLoudnessTarget(
  env: Record<string, string | undefined> = process.env
): number | null {
  if (env.FILM_LOUDNESS === "0") return null;
  const raw = Number(env.FILM_LOUDNESS_LUFS);
  if (
    env.FILM_LOUDNESS_LUFS &&
    Number.isFinite(raw) &&
    raw >= TARGET_MIN_LUFS &&
    raw <= TARGET_MAX_LUFS
  )
    return raw;
  return FILM_LOUDNESS_TARGET_LUFS;
}

/**
 * Read integrated loudness and true peak out of an `ebur128=peak=true` run's stderr. The filter
 * also prints a running "I:" on every frame, so only the text after the final "Summary:" counts.
 * Throws on a report with no summary, and on digital silence (-70 LUFS is the meter's floor) —
 * a "measurement" there means the track did not decode.
 */
export function parseLoudnessSummary(stderr: string): LoudnessReading {
  const at = stderr.lastIndexOf("Summary:");
  if (at < 0) throw new Error("ebur128 produced no summary");
  const summary = stderr.slice(at);
  const i = summary.match(/\bI:\s*(-?[\d.]+)\s*LUFS/);
  const peak = summary.match(/\bPeak:\s*(-?[\d.]+)\s*dBFS/);
  if (!i || !peak) throw new Error("ebur128 summary has no loudness or peak");
  const integratedLufs = Number(i[1]);
  const truePeakDb = Number(peak[1]);
  if (!Number.isFinite(integratedLufs) || integratedLufs <= -70)
    throw new Error(`implausible film loudness ${i[1]} LUFS`);
  if (!Number.isFinite(truePeakDb))
    throw new Error(`implausible film true peak ${peak[1]} dBTP`);
  return { integratedLufs, truePeakDb };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The gain that brings a measured track to `targetLufs`, and what the limiter must then do. */
export function planFilmLoudness(
  measured: LoudnessReading,
  targetLufs: number = FILM_LOUDNESS_TARGET_LUFS
): FilmLoudnessPlan {
  let gainDb = Math.min(targetLufs - measured.integratedLufs, FILM_MAX_GAIN_DB);
  let limitingDb = Math.max(
    0,
    measured.truePeakDb + gainDb - FILM_LIMITER_CEILING_DB
  );
  let capped = gainDb === FILM_MAX_GAIN_DB;
  if (limitingDb > FILM_MAX_LIMITING_DB) {
    gainDb -= limitingDb - FILM_MAX_LIMITING_DB;
    limitingDb = FILM_MAX_LIMITING_DB;
    capped = true;
  }
  return {
    gainDb: round2(gainDb),
    limitingDb: round2(limitingDb),
    capped,
    needed: Math.abs(gainDb) >= FILM_LOUDNESS_DEADBAND_LU,
  };
}

/**
 * Build args to apply a loudness plan to a film's finished audio track: one gain, then the
 * limiter at 4x the sample rate, then back to the film's 48 kHz stereo AAC. `precision=float`
 * keeps the lifted samples above full scale intact for the limiter instead of clipping them
 * first, and `level=false` stops `alimiter` normalising its own output back up. Pure — no IO.
 */
export function buildFilmLoudnessArgs(opts: {
  inputPath: string;
  outputPath: string;
  gainDb: number;
}): string[] {
  const limit = Math.pow(10, FILM_LIMITER_CEILING_DB / 20).toFixed(4);
  const filter =
    `volume=${opts.gainDb.toFixed(2)}dB:precision=float,` +
    `aresample=192000,` +
    `alimiter=limit=${limit}:attack=5:release=50:level=false,` +
    `aresample=48000`;
  return [
    "-y",
    "-i",
    opts.inputPath,
    "-vn",
    "-af",
    filter,
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    opts.outputPath,
  ];
}

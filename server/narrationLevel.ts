/**
 * Narration LEVELLING — keeps the voice at one volume across a film.
 *
 * The master is voiced by 69Labs (ElevenLabs underneath), which chops a long script into
 * chunks it generates separately and joins (`splitType: "smart"`), and our own delivery plan
 * voices it as several runs joined in `concatWithPauses`. Each generation comes back at its
 * own energy, and inside a long one the voice trails off. Measured on a hosted 16-minute film
 * (2026-09-22): the voice while speaking swung 14 dB across the film — a slow slide, then a
 * jump back up at 0:40, 4:50, 6:00, 12:20, 12:50 and 14:50 where a new generation began —
 * and the operator heard it as "her voice gets really low in parts". Nothing downstream
 * evened it out: the only volume step was a fixed per-channel multiplier, the pause cap only
 * trims silence, and assembly measures the master's loudness once, only to set the music bed.
 *
 * ffmpeg's stock levellers were tried first and rejected on the same film: `dynaudnorm` is
 * peak-driven and TTS peaks are already uniform while its LOUDNESS is not (11 dB spread went to
 * 9.5), and `speechnorm` either did nothing (11.0) or lifted the whole file 9 dB (5.0). So the
 * curve is MEASURED instead: the voice-band level of every 250 ms frame, gated to the frames
 * that carry speech, averaged per 2 s bin, and the gain that brings each bin to the film's own
 * median — smoothed over ~10 s so it never pumps on a word, clamped (-6..+10 dB) so it never
 * chases a pause or a shout, and capped per bin so no peak can clip. On the same film: spread
 * 11.0 → 3.1 dB with the second-to-second wobble unchanged (2.9 → 2.8 dB). The target is the
 * film's OWN median, so the overall loudness is untouched and every channel keeps its level.
 *
 * The curve is applied as a gain ENVELOPE: a 100 Hz float track written from the plan, upsampled
 * inside the graph and multiplied into the audio (`amultiply`). Two ffmpeg traps that cost an
 * afternoon: the envelope leg must pin `osf=fltp`, or format negotiation feeds the resampler
 * 16-bit and silently clips every gain above 1.0 to exactly 1.0; and `amultiply` ends at its
 * SHORTER input, so the envelope is padded past the audio, never cut to it.
 *
 * Everything that decides is pure and tested (`planLevelGains`, `envelopeSamples`,
 * `buildLevelApplyArgs`, `parseLevelFrames`); the two ffmpeg calls are thin. Every caller treats
 * a failure as "keep the audio as rendered" — a steadier read is never worth losing a film over.
 */

import { spawn } from "child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { getFFmpegPath } from "./ffmpegPath";
import { downloadToTemp } from "./videoAssembly";

/** Analysis frame: short enough to gate out a pause, long enough to hold a syllable. */
export const LEVEL_FRAME_SEC = 0.25;
/** The gain curve's resolution — one value per bin, interpolated between bin centres. */
export const LEVEL_BIN_SEC = 2;
/** Moving average over this many bins (odd): ~10 s, so a word never moves the gain. */
export const LEVEL_SMOOTH_BINS = 5;
/** Gains are clamped here so a pause, a whisper or a shout is never "corrected". */
export const LEVEL_GAIN_MIN_DB = -6;
export const LEVEL_GAIN_MAX_DB = 10;
/** A frame counts as speech when its voice-band level is within this of the loud frames. */
export const LEVEL_GATE_BELOW_PEAK_DB = 20;
/** No bin may be lifted so its loudest sample passes this (a margin under the interpolation). */
export const LEVEL_PEAK_CEILING_DBFS = -1.5;
/** A read whose p5..p95 bin spread is already under this is left byte-identical. */
export const LEVEL_MIN_SPREAD_DB = 1.5;
/** Envelope sample rate. The curve moves over seconds; 100 Hz upsamples with no edge ramp. */
export const LEVEL_ENVELOPE_RATE = 100;
/** Envelope run-out past the audio: `amultiply` stops at the shorter input. */
export const LEVEL_ENVELOPE_PAD_SEC = 10;
/** When matching one clip to another, gains inside this are not worth a re-encode. */
export const LEVEL_MATCH_DEADBAND_DB = 0.5;
/** ...and gains past this are a measurement gone wrong, not a quiet take. */
export const LEVEL_MATCH_MAX_DB = 8;

const FFMPEG_MAX_MS = 10 * 60 * 1000;
/** astats prints `-inf` for digital silence; keep it finite so sums and sorts stay sane. */
const SILENCE_DB = -120;

export interface LevelFrame {
  /** Seconds from the start of the file. */
  tSec: number;
  /** Voice-band (300–3000 Hz) RMS, dBFS. */
  rmsDb: number;
  /** Full-band sample peak, dBFS. */
  peakDb: number;
}

export interface LevelPlan {
  binSec: number;
  /** One gain per bin, dB, already smoothed and capped. */
  gainsDb: number[];
  /** The film's own median speech level — what every bin is pulled toward. */
  targetDb: number;
  /** p95 − p5 of the gated bin levels before / after the gains. */
  spreadBeforeDb: number;
  spreadAfterDb: number;
  /** False when the read is already steady: the caller keeps the original bytes. */
  needed: boolean;
}

/** p-th percentile (0..100) by linear interpolation; NaN on empty. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = ((s.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Energy mean of dB values (mean of 10^(x/10) in dB) — how loudness averages, not a dB mean. */
function energyMeanDb(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += Math.pow(10, v / 10);
  return 10 * Math.log10(sum / values.length);
}

/**
 * The frames that carry speech: within `LEVEL_GATE_BELOW_PEAK_DB` of the loud frames (the 95th
 * percentile, so one clipped consonant cannot set the bar). Relative rather than an absolute
 * dBFS threshold, so a channel with a quiet clone or a 0.5 volume dial gates the same way.
 */
function speechGateDb(frames: LevelFrame[]): number {
  return (
    percentile(
      frames.map(f => f.rmsDb),
      95
    ) - LEVEL_GATE_BELOW_PEAK_DB
  );
}

/**
 * One number for a whole clip: its speech level. Used to match one clip to another (a delivery
 * run to its siblings, a re-voiced scene to the master). NaN when nothing in it reads as speech.
 */
export function speechLevelDb(frames: LevelFrame[]): number {
  if (frames.length === 0) return NaN;
  const gate = speechGateDb(frames);
  const sp = frames.filter(f => f.rmsDb > gate).map(f => f.rmsDb);
  return sp.length ? energyMeanDb(sp) : NaN;
}

/**
 * The gain curve. Pure: frames in, one gain per `binSec` bin out.
 *
 * Per bin, the energy mean of its speech frames; a bin with no speech (a pause, a room-tone
 * beat) borrows the nearest measured neighbour so the curve holds level across it rather than
 * chasing the silence. The gain is the distance to the median bin, clamped, then a moving
 * average over `LEVEL_SMOOTH_BINS`, then capped per bin so `peak + gain` stays under the
 * ceiling. `spreadAfterDb` is the prediction the log prints beside the measurement.
 */
export function planLevelGains(
  frames: LevelFrame[],
  opts: {
    binSec?: number;
    smoothBins?: number;
    minGainDb?: number;
    maxGainDb?: number;
    peakCeilingDb?: number;
    minSpreadDb?: number;
  } = {}
): LevelPlan {
  const binSec = opts.binSec ?? LEVEL_BIN_SEC;
  const smoothBins = Math.max(1, opts.smoothBins ?? LEVEL_SMOOTH_BINS);
  const minGain = opts.minGainDb ?? LEVEL_GAIN_MIN_DB;
  const maxGain = opts.maxGainDb ?? LEVEL_GAIN_MAX_DB;
  const ceiling = opts.peakCeilingDb ?? LEVEL_PEAK_CEILING_DBFS;
  const minSpread = opts.minSpreadDb ?? LEVEL_MIN_SPREAD_DB;

  const empty: LevelPlan = {
    binSec,
    gainsDb: [],
    targetDb: NaN,
    spreadBeforeDb: 0,
    spreadAfterDb: 0,
    needed: false,
  };
  if (frames.length === 0) return empty;

  const gate = speechGateDb(frames);
  const lastT = frames[frames.length - 1].tSec;
  const nBins = Math.max(1, Math.ceil((lastT + LEVEL_FRAME_SEC) / binSec));
  const speech: number[][] = Array.from({ length: nBins }, () => []);
  const peaks: number[] = new Array(nBins).fill(SILENCE_DB);
  for (const f of frames) {
    const b = Math.min(nBins - 1, Math.floor(f.tSec / binSec));
    if (f.rmsDb > gate) speech[b].push(f.rmsDb);
    if (f.peakDb > peaks[b]) peaks[b] = f.peakDb;
  }
  // Two frames (half a second of voice) before a bin is trusted to speak for itself.
  const measured: (number | null)[] = speech.map(s =>
    s.length >= 2 ? energyMeanDb(s) : null
  );
  const known = measured.filter((v): v is number => v != null);
  if (known.length === 0) return empty;

  // Fill unmeasured bins from the nearest measured one (ties go to the earlier bin).
  const level: number[] = new Array(nBins);
  let prevIdx = -1;
  const nextIdx: number[] = new Array(nBins).fill(-1);
  for (let i = nBins - 1, n = -1; i >= 0; i--) {
    if (measured[i] != null) n = i;
    nextIdx[i] = n;
  }
  for (let i = 0; i < nBins; i++) {
    if (measured[i] != null) {
      prevIdx = i;
      level[i] = measured[i] as number;
      continue;
    }
    const n = nextIdx[i];
    if (prevIdx < 0) level[i] = measured[n] as number;
    else if (n < 0) level[i] = measured[prevIdx] as number;
    else
      level[i] =
        i - prevIdx <= n - i
          ? (measured[prevIdx] as number)
          : (measured[n] as number);
  }

  const targetDb = percentile(known, 50);
  const spreadBeforeDb = percentile(known, 95) - percentile(known, 5);

  const raw = level.map(l =>
    Math.min(maxGain, Math.max(minGain, targetDb - l))
  );
  const half = Math.floor(smoothBins / 2);
  const gainsDb = raw.map((_, i) => {
    let sum = 0;
    for (let k = -half; k <= half; k++) {
      // Edge bins repeat their end value rather than averaging with nothing.
      const j = Math.min(nBins - 1, Math.max(0, i + k));
      sum += raw[j];
    }
    const g = sum / (2 * half + 1);
    const cap = ceiling - peaks[i];
    return Math.round(Math.min(g, Math.max(cap, minGain)) * 100) / 100;
  });

  const after: number[] = [];
  for (let i = 0; i < nBins; i++) {
    if (measured[i] != null) after.push((measured[i] as number) + gainsDb[i]);
  }
  const spreadAfterDb = percentile(after, 95) - percentile(after, 5);

  return {
    binSec,
    gainsDb,
    targetDb: Math.round(targetDb * 10) / 10,
    spreadBeforeDb: Math.round(spreadBeforeDb * 10) / 10,
    spreadAfterDb: Math.round(spreadAfterDb * 10) / 10,
    needed:
      spreadBeforeDb >= minSpread && gainsDb.some(g => Math.abs(g) >= 0.5),
  };
}

/**
 * The gain envelope as LINEAR factors at `rate` Hz: piecewise-linear between bin centres, held
 * flat before the first and after the last, and run `LEVEL_ENVELOPE_PAD_SEC` past the audio.
 */
export function envelopeSamples(
  plan: LevelPlan,
  audioDurationSec: number,
  rate: number = LEVEL_ENVELOPE_RATE
): Float32Array {
  const n = Math.max(
    1,
    Math.ceil((audioDurationSec + LEVEL_ENVELOPE_PAD_SEC) * rate)
  );
  const out = new Float32Array(n);
  const g = plan.gainsDb;
  if (g.length === 0) {
    out.fill(1);
    return out;
  }
  const centre = (i: number) => (i + 0.5) * plan.binSec;
  for (let s = 0; s < n; s++) {
    const t = s / rate;
    let db: number;
    if (t <= centre(0)) db = g[0];
    else if (t >= centre(g.length - 1)) db = g[g.length - 1];
    else {
      const i = Math.min(g.length - 2, Math.floor(t / plan.binSec - 0.5));
      const f = (t - centre(i)) / plan.binSec;
      db = g[i] + (g[i + 1] - g[i]) * f;
    }
    out[s] = Math.pow(10, db / 20);
  }
  return out;
}

/** Frames-per-analysis-window in samples at 48 kHz. */
const FRAME_SAMPLES = Math.round(LEVEL_FRAME_SEC * 48000);

/**
 * ffmpeg args that print one line-pair per 250 ms frame: channel 1 is the full-band signal
 * (its peak guards the ceiling), channel 2 the voice band (its RMS is the level). Pure.
 */
export function buildLevelMeasureArgs(inputPath: string): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-filter_complex",
    `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono,` +
      `asetnsamples=n=${FRAME_SAMPLES}:p=0,asplit[f][b];` +
      `[b]highpass=f=300,lowpass=f=3000[bb];` +
      `[f][bb]amerge=inputs=2,astats=metadata=1:reset=1,` +
      `ametadata=print:file=-[o]`,
    "-map",
    "[o]",
    "-f",
    "null",
    "-",
  ];
}

/** Parse the metadata print into frames. Tolerates `-inf`, blank lines and reordering. */
export function parseLevelFrames(text: string): LevelFrame[] {
  const frames: LevelFrame[] = [];
  let cur: Partial<LevelFrame> | null = null;
  const num = (s: string) => {
    const v = Number(s);
    return Number.isFinite(v) ? v : SILENCE_DB;
  };
  const flush = () => {
    if (cur && cur.tSec != null && cur.rmsDb != null && cur.peakDb != null)
      frames.push(cur as LevelFrame);
    cur = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const t = line.match(/pts_time:\s*([-\d.eE+]+)/);
    if (t) {
      flush();
      cur = { tSec: Number(t[1]) };
      continue;
    }
    if (!cur) continue;
    const peak = line.match(/lavfi\.astats\.1\.Peak_level=(\S+)/);
    if (peak) cur.peakDb = num(peak[1]);
    const rms = line.match(/lavfi\.astats\.2\.RMS_level=(\S+)/);
    if (rms) cur.rmsDb = num(rms[1]);
  }
  flush();
  return frames;
}

/**
 * ffmpeg args that multiply the audio by the envelope and write a 48k/stereo/192k mp3 — the
 * shape every voiced master and slice already has. Pure.
 */
export function buildLevelApplyArgs(opts: {
  audioPath: string;
  envelopePath: string;
  envelopeRate?: number;
  outputPath: string;
}): string[] {
  const rate = opts.envelopeRate ?? LEVEL_ENVELOPE_RATE;
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "error",
    "-y",
    "-i",
    opts.audioPath,
    "-f",
    "f32le",
    "-ar",
    String(rate),
    "-ac",
    "1",
    "-i",
    opts.envelopePath,
    "-filter_complex",
    // osf=fltp on the envelope leg is load-bearing: without it the graph negotiates the
    // resampler's output as 16-bit and every gain above 1.0 becomes exactly 1.0.
    `[1:a]aresample=osr=48000:osf=fltp,pan=stereo|c0=c0|c1=c0[g];` +
      `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a];` +
      `[a][g]amultiply[o]`,
    "-map",
    "[o]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    opts.outputPath,
  ];
}

/** Run ffmpeg, capturing stdout; stderr is folded into the error on a non-zero exit. */
function runFfmpeg(args: string[], label: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(getFFmpegPath(), args);
    let out = "";
    let err = "";
    const killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${label} timed out after ${FFMPEG_MAX_MS}ms`));
    }, FFMPEG_MAX_MS);
    proc.stdout.on("data", d => {
      out += d.toString();
    });
    proc.stderr.on("data", d => {
      err += d.toString();
    });
    proc.on("close", code => {
      clearTimeout(killTimer);
      if (code !== 0)
        reject(new Error(`${label} failed (exit ${code}): ${err.trim()}`));
      else resolve(out);
    });
    proc.on("error", e => {
      clearTimeout(killTimer);
      reject(new Error(`${label}: ${e.message}`));
    });
  });
}

/** Per-frame levels of an audio file on disk. */
export async function measureLevelFrames(
  filePath: string
): Promise<LevelFrame[]> {
  const out = await runFfmpeg(buildLevelMeasureArgs(filePath), "level measure");
  const frames = parseLevelFrames(out);
  if (frames.length === 0) throw new Error("level measure printed no frames");
  return frames;
}

/** Speech level of one file on disk, dBFS. Throws when nothing in it reads as speech. */
export async function measureSpeechLevelDb(filePath: string): Promise<number> {
  const level = speechLevelDb(await measureLevelFrames(filePath));
  if (!Number.isFinite(level)) throw new Error("no speech found to measure");
  return level;
}

/** Speech level of a stored narration (our own R2 object or a provider URL), dBFS. */
export async function measureSpeechLevelOfUrl(url: string): Promise<number> {
  const dir = join(tmpdir(), `narration-level-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    return await measureSpeechLevelDb(await downloadToTemp(url, dir, "in.mp3"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** ffmpeg args for one static gain, re-encoded to the pipeline's mp3 shape. Pure. */
export function buildMatchGainArgs(opts: {
  audioPath: string;
  gainDb: number;
  outputPath: string;
}): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "error",
    "-y",
    "-i",
    opts.audioPath,
    "-af",
    `volume=${opts.gainDb}dB`,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    opts.outputPath,
  ];
}

/**
 * Bring one clip to `targetDb` (another clip's speech level) with a single static gain. Returns
 * the input untouched with `gainDb` 0 when it is already within the deadband, or when the
 * distance is past the sanity limit. Throws on any ffmpeg failure.
 */
export async function matchNarrationLevel(
  audio: Buffer,
  targetDb: number
): Promise<{ buffer: Buffer; levelDb: number; gainDb: number }> {
  const dir = join(tmpdir(), `narration-match-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const inPath = join(dir, "in.mp3");
    writeFileSync(inPath, audio);
    const levelDb = await measureSpeechLevelDb(inPath);
    const gainDb = matchGainDb(levelDb, targetDb);
    if (gainDb === 0) return { buffer: audio, levelDb, gainDb };
    const outPath = join(dir, "out.mp3");
    await runFfmpeg(
      buildMatchGainArgs({ audioPath: inPath, gainDb, outputPath: outPath }),
      "level match"
    );
    return { buffer: readFileSync(outPath), levelDb, gainDb };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The gain that brings `level` to `target`, or 0 when it is inside the deadband or past the
 * sanity limit (a measurement that far off is a wrong file, not a quiet take). Pure.
 */
export function matchGainDb(level: number, target: number): number {
  if (!Number.isFinite(level) || !Number.isFinite(target)) return 0;
  const g = target - level;
  if (Math.abs(g) < LEVEL_MATCH_DEADBAND_DB) return 0;
  if (Math.abs(g) > LEVEL_MATCH_MAX_DB) return 0;
  return Math.round(g * 10) / 10;
}

/**
 * Level a narration mp3. Returns the original buffer untouched (and `plan.needed === false`)
 * when the read is already steady; otherwise the re-encoded buffer and the plan behind it.
 * Throws on any ffmpeg failure — callers decide that the un-levelled audio ships.
 */
export async function levelNarrationAudio(
  audio: Buffer
): Promise<{ buffer: Buffer; plan: LevelPlan }> {
  const dir = join(tmpdir(), `narration-level-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const inPath = join(dir, "in.mp3");
    writeFileSync(inPath, audio);
    const frames = await measureLevelFrames(inPath);
    const plan = planLevelGains(frames);
    if (!plan.needed) return { buffer: audio, plan };
    const durationSec = frames[frames.length - 1].tSec + LEVEL_FRAME_SEC;
    const env = envelopeSamples(plan, durationSec);
    const envPath = join(dir, "env.f32");
    writeFileSync(
      envPath,
      Buffer.from(env.buffer, env.byteOffset, env.byteLength)
    );
    const outPath = join(dir, "out.mp3");
    await runFfmpeg(
      buildLevelApplyArgs({
        audioPath: inPath,
        envelopePath: envPath,
        outputPath: outPath,
      }),
      "level apply"
    );
    return { buffer: readFileSync(outPath), plan };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `levelNarrationAudio` for a stored narration (our own R2 object): download, level, return. */
export async function levelNarrationUrl(
  url: string
): Promise<{ buffer: Buffer; plan: LevelPlan }> {
  const dir = join(tmpdir(), `narration-level-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const local = await downloadToTemp(url, dir, "in.mp3");
    return await levelNarrationAudio(readFileSync(local));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `matchNarrationLevel` for a stored clip: download, match to `targetDb`, return. */
export async function matchNarrationUrlToLevel(
  url: string,
  targetDb: number
): Promise<{ buffer: Buffer; levelDb: number; gainDb: number }> {
  const dir = join(tmpdir(), `narration-match-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const local = await downloadToTemp(url, dir, "in.mp3");
    return await matchNarrationLevel(readFileSync(local), targetDb);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One line for the render log. */
export function describeLevelPlan(plan: LevelPlan): string {
  if (!plan.needed)
    return `narration level already steady (p5..p95 spread ${plan.spreadBeforeDb} dB) — kept as voiced`;
  const min = Math.min(...plan.gainsDb);
  const max = Math.max(...plan.gainsDb);
  return (
    `narration levelled: p5..p95 spread ${plan.spreadBeforeDb} → ~${plan.spreadAfterDb} dB ` +
    `around ${plan.targetDb} dBFS (gain ${min >= 0 ? "+" : ""}${min.toFixed(1)}..` +
    `${max >= 0 ? "+" : ""}${max.toFixed(1)} dB over ${plan.gainsDb.length} × ${plan.binSec}s bins)`
  );
}

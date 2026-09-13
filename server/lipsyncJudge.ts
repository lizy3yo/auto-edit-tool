/**
 * server/lipsyncJudge.ts — does the mouth SAY the words? The judge behind
 * `scripts/measure-lipsync.mts`, as a module the pipeline can run on every host clip.
 *
 * Every word is looked up in the CMU Pronouncing Dictionary (135k English words → the sounds
 * actually spoken: "blanket" → B L AE NG K AH T), each sound is given the mouth opening speech
 * REQUIRES for it (p/b/m shut, "ah" wide, "oo" small, t/d/s parted, silence shut), and the
 * sounds are spread over the word's timing. That is a PREDICTED opening curve for the clip —
 * how a mouth saying these words should move. It is correlated with the MEASURED opening
 * (the dark fraction of a window over the mouth, inside the face tracked frame by frame with
 * `server/pico.ts`) at every lag from -600 to +600 ms: a mouth saying the words peaks near
 * lag 0 and the correlation falls to nothing a few hundred ms away; a mouth merely flapping,
 * or saying them late, does not. The peak is how well the mouth tracks the words, its
 * position is the sync offset, and the far-lag level is what "out of sync" scores on this
 * very clip — the built-in control. Scale-free, so a small mouth and a large one are judged
 * alike; script-driven, so no reference clip of the sentence is needed.
 *
 * Word timings come from the pipeline's own whisperx alignment of the master narration
 * (kept per scene as `scene.words`), so judging a render costs ~5 s of CPU and nothing else;
 * a clip with no saved words is transcribed (`wordsFromClip`), as the script does.
 *
 * Calibration (accepted HeyGen renders through this judge): peak r 0.21 at -80 ms against a
 * far level of 0.05; a mouth normally LEADS its sound by 40-120 ms, so a small negative lag is
 * how speech looks, not an error. The same constants, and the same arithmetic, feed the
 * script's printed report — one implementation, so the numbers you read are the numbers the
 * gate acts on.
 */
import { spawnSync } from "child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { getFFmpegPath } from "./ffmpegPath";
import { detectFaces } from "./pico";
import { transcribeWordsFromBuffer } from "./_core/voiceTranscription";
import * as cmuModule from "cmu-pronouncing-dictionary";

const CMU: Record<string, string> = ((cmuModule as any).dictionary ??
  (cmuModule as any).default ??
  cmuModule) as Record<string, string>;

/**
 * The DEFAULT frame rate for callers that pass none (the older script behaviour). The judge
 * itself reads every clip at its NATIVE rate (`probeFps`) and maps word times at that same
 * rate: mapping 24 fps frames at 25 fps — which the script did until 2026-09-14 — drifts
 * 4% across the clip, ~250 ms by the end of a 6 s beat, and that drift was inside every
 * lag figure measured with it.
 */
export const FPS = 25;
/** Whole-clip limits, calibrated to an accepted HeyGen reference. */
export const CLOSURE_LIMIT = 0.068;
export const RANGE_FLOOR = 0.045;
/** ±600 ms scanned; ≥320 ms away counts as "out of sync". */
export const SYNC_MAX_FRAMES = 15;
export const FAR_LAG_FRAMES = 8;
/** "Tracks the words" = the peak clears the out-of-sync level by this. */
export const SYNC_MARGIN = 0.1;
/** "In sync" = the peak sits within this of zero. */
export const SYNC_OFFSET_MAX_MS = 200;

export type Word = { word: string; start: number; end: number };
/** open: dark fraction of the mouth window; aspect: dark-region w/h; width: lip line span / face size. */
export type Frame = { open: number; aspect: number; width: number };

export type LagScan = {
  /** Pearson r between predicted and measured opening at the best lag within ±SYNC_MAX. */
  peakR: number;
  /** Where that peak sits, ms; negative = the mouth moves BEFORE the sound. */
  peakLagMs: number;
  /** Median |r| at lags ≥ 320 ms away — what "out of sync" scores on this clip. */
  farR: number;
  /** r at every lag, for the curve. */
  curve: { lagMs: number; r: number }[];
};

export type ClassName =
  "closed" | "lip-teeth" | "rounded" | "spread" | "open" | "neutral" | "rest";
export type PhoneScore = { n: number; right: number; missed: string[] };
export type Phonetic = {
  /** The verdict: predicted-vs-measured OPENING over lag. */
  open: LagScan;
  /** Predicted-vs-measured LIP WIDTH (rounded narrow, spread wide) — informational. */
  width: LagScan;
  perClass: Partial<Record<ClassName, PhoneScore>>;
  overall: { n: number; right: number };
  /** The per-sound table re-run with every word shifted 400 ms: its own out-of-sync control. */
  controlPct: number;
  unknownWords: string[];
};

const ff = (args: string[]) => {
  const r = spawnSync(
    getFFmpegPath(),
    ["-hide_banner", "-loglevel", "error", ...args],
    { encoding: "utf8", maxBuffer: 64 << 20 }
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-400)}`);
};

// ── viseme classes from spelling (the dictionary's fallback) ─────────────────
export const clean = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "");
const CLASS_RULES: [ClassName, RegExp][] = [
  ["closed", /[pbm]/],
  ["lip-teeth", /[fv]/],
  ["rounded", /(oo|ou|ow|^w|u|o$)/],
  ["spread", /(ee|ea|^i[^aeiou]|y$|ie)/],
  ["open", /(^i$|ai|igh|ar|aw|ay|a[^eiouy]|o[^ouw])/],
];
export const CLASS_ORDER: ClassName[] = [
  "closed",
  "lip-teeth",
  "rounded",
  "spread",
  "open",
  "neutral",
  "rest",
];
export const classesOf = (w: string): ClassName[] => {
  const c = clean(w);
  const hits = CLASS_RULES.filter(([, re]) => re.test(c)).map(([n]) => n);
  return hits.length ? hits : ["neutral"];
};

// ── the rule of speech: sound → mouth shape (ARPAbet → viseme class) ──────────
export const PHONE_CLASS: Record<string, ClassName> = {
  P: "closed",
  B: "closed",
  M: "closed",
  F: "lip-teeth",
  V: "lip-teeth",
  UW: "rounded",
  UH: "rounded",
  OW: "rounded",
  AO: "rounded",
  OY: "rounded",
  W: "rounded",
  IY: "spread",
  IH: "spread",
  EY: "spread",
  Y: "spread",
  AA: "open",
  AE: "open",
  AH: "open",
  AY: "open",
  AW: "open",
  // parted with little lip commitment — tallied for information, never scored
  T: "neutral",
  D: "neutral",
  S: "neutral",
  Z: "neutral",
  N: "neutral",
  L: "neutral",
  K: "neutral",
  G: "neutral",
  NG: "neutral",
  TH: "neutral",
  DH: "neutral",
  SH: "neutral",
  ZH: "neutral",
  CH: "neutral",
  JH: "neutral",
  HH: "neutral",
  R: "neutral",
  ER: "neutral",
  EH: "neutral",
};
const CLASS_STANDIN: Record<ClassName, string> = {
  closed: "M",
  "lip-teeth": "F",
  rounded: "UW",
  spread: "IY",
  open: "AA",
  neutral: "T",
  rest: "T",
};
const cmuKey = (w: string) => clean(w).replace(/[‘’]/g, "'");
export const inDictionary = (w: string) =>
  !!(CMU[cmuKey(w)] ?? CMU[cmuKey(w).replace(/'/g, "")]);
/** A word's sounds from the dictionary; a word it lacks falls back to its spelling classes. */
export function phonesOf(word: string): string[] {
  const k = cmuKey(word);
  const entry = CMU[k] ?? CMU[k.replace(/'/g, "")];
  if (entry) return entry.split(/\s+/).map(p => p.replace(/[0-9]/g, ""));
  return classesOf(word).map(cls => CLASS_STANDIN[cls]);
}

/**
 * How open the mouth is for each sound, 0 (shut) to 1 (jaw dropped), and how wide the lips
 * are, -1 (pursed) to +1 (corners pulled). Standard viseme targets; a sound not listed is
 * parted-neutral. Only the ORDER matters much — the correlation is scale-free.
 */
export const PHONE_OPEN: Record<string, number> = {
  P: 0,
  B: 0,
  M: 0,
  F: 0.1,
  V: 0.1,
  UW: 0.45,
  UH: 0.5,
  OW: 0.6,
  AO: 0.7,
  OY: 0.6,
  W: 0.3,
  IY: 0.4,
  IH: 0.45,
  EY: 0.5,
  Y: 0.35,
  EH: 0.6,
  ER: 0.5,
  AA: 1,
  AE: 0.9,
  AH: 0.8,
  AY: 0.9,
  AW: 0.9,
  T: 0.35,
  D: 0.35,
  S: 0.3,
  Z: 0.3,
  N: 0.35,
  L: 0.45,
  K: 0.45,
  G: 0.45,
  NG: 0.4,
  TH: 0.3,
  DH: 0.3,
  SH: 0.35,
  ZH: 0.35,
  CH: 0.35,
  JH: 0.35,
  HH: 0.5,
  R: 0.45,
};
export const PHONE_WIDTH: Record<string, number> = {
  UW: -1,
  UH: -0.6,
  OW: -0.8,
  AO: -0.6,
  OY: -0.6,
  W: -1,
  IY: 1,
  IH: 0.6,
  EY: 0.8,
  Y: 0.6,
  AE: 0.4,
  EH: 0.3,
};

/** The curve a mouth saying these words should trace, one value per frame, lightly smoothed. */
export function predictedTrack(
  ws: Word[],
  n: number,
  table: Record<string, number>,
  fill: number,
  fps: number = FPS
): number[] {
  const p = new Array<number>(n).fill(fill);
  for (const w of ws) {
    const phones = phonesOf(w.word);
    const per = Math.max(0.04, w.end - w.start) / phones.length;
    phones.forEach((ph, i) => {
      const lo = Math.round((w.start + i * per) * fps);
      const hi = Math.round((w.start + (i + 1) * per) * fps);
      for (let f = Math.max(0, lo); f <= hi && f < n; f++)
        p[f] = table[ph] ?? fill;
    });
  }
  // Three-frame smoothing: lips glide between sounds (co-articulation), they do not step.
  return p.map(
    (_, i) => (p[Math.max(0, i - 1)] + p[i] + p[Math.min(n - 1, i + 1)]) / 3
  );
}

export function pearson(a: number[], b: number[], lag: number): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const j = i + lag;
    if (j >= 0 && j < b.length) {
      xs.push(a[i]);
      ys.push(b[j]);
    }
  }
  if (xs.length < 8) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Correlate predicted against measured at every lag; report the peak, its offset and the far level. */
export function lagScan(
  pred: number[],
  meas: number[],
  fps: number = FPS
): LagScan {
  const curve: LagScan["curve"] = [];
  let peak = { r: -Infinity, lag: 0 };
  const far: number[] = [];
  // The scan is defined in TIME (±600 ms, ≥320 ms = far), so the frame counts follow the rate.
  const maxFrames = Math.round((SYNC_MAX_FRAMES / FPS) * fps);
  const farFrames = Math.round((FAR_LAG_FRAMES / FPS) * fps);
  for (let lag = -maxFrames; lag <= maxFrames; lag++) {
    const r = pearson(pred, meas, lag);
    curve.push({ lagMs: (lag * 1000) / fps, r });
    if (r > peak.r) peak = { r, lag };
    if (Math.abs(lag) >= farFrames) far.push(Math.abs(r));
  }
  far.sort((a, b) => a - b);
  return {
    peakR: peak.r,
    peakLagMs: (peak.lag * 1000) / fps,
    farR: far.length ? far[Math.floor(far.length / 2)] : 0,
    curve,
  };
}

/**
 * Per-sound pass/fail against the clip's own median, kept for the WHERE: closed, lip-teeth
 * and rest want the opening below the median, open sounds above; rounded want the lip width
 * below, spread above. Each sound is looked for one frame either side of its slot.
 * Informational only — see the header.
 */
const PHONE_PAD = 1;
export function perSoundTable(
  ws: Word[],
  fr: Frame[],
  fps: number = FPS
): Pick<Phonetic, "perClass" | "overall" | "unknownWords"> {
  const median = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : 0;
  };
  const openMed = median(fr.map(f => f.open));
  const widthMed = median(fr.filter(f => f.width > 0).map(f => f.width));
  const perClass: Phonetic["perClass"] = {};
  const overall = { n: 0, right: 0 };
  const unknownWords: string[] = [];
  const tally = (cls: ClassName, ok: boolean, where: string) => {
    const p = (perClass[cls] ??= { n: 0, right: 0, missed: [] });
    p.n++;
    if (ok) p.right++;
    else if (p.missed.length < 6) p.missed.push(where);
    if (cls !== "neutral") {
      overall.n++;
      if (ok) overall.right++;
    }
  };
  for (const w of ws) {
    if (!inDictionary(w.word)) unknownWords.push(w.word);
    const phones = phonesOf(w.word);
    const per = Math.max(0.04, w.end - w.start) / phones.length;
    phones.forEach((ph, i) => {
      const cls = PHONE_CLASS[ph];
      if (!cls) return;
      const t0 = w.start + i * per;
      const lo = Math.max(0, Math.round(t0 * fps) - PHONE_PAD);
      const hi = Math.min(
        fr.length - 1,
        Math.round((t0 + per) * fps) + PHONE_PAD
      );
      if (lo > hi) return;
      const seg = fr.slice(lo, hi + 1);
      const opens = seg.map(f => f.open);
      const widths = seg.map(f => f.width).filter(v => v > 0);
      const where = `${w.word}:${ph.toLowerCase()}`;
      if (cls === "closed" || cls === "lip-teeth")
        tally(cls, Math.min(...opens) < openMed, where);
      else if (cls === "open") tally(cls, Math.max(...opens) > openMed, where);
      else if (cls === "rounded")
        tally(cls, widths.length > 0 && Math.min(...widths) < widthMed, where);
      else if (cls === "spread")
        tally(cls, widths.length > 0 && Math.max(...widths) > widthMed, where);
      else tally(cls, true, where);
    });
  }
  for (let i = 1; i < ws.length; i++) {
    const gap = ws[i].start - ws[i - 1].end;
    if (gap < 0.12) continue;
    const lo = Math.round(ws[i - 1].end * fps);
    const hi = Math.min(fr.length - 1, Math.round(ws[i].start * fps));
    if (lo > hi) continue;
    const opens = fr.slice(lo, hi + 1).map(f => f.open);
    tally(
      "rest",
      opens.reduce((a, b) => a + b, 0) / opens.length < openMed,
      `(pause ${Math.round(gap * 1000)}ms)`
    );
  }
  return { perClass, overall, unknownWords };
}

export function phoneticScore(
  ws: Word[],
  fr: Frame[],
  fps: number = FPS
): Phonetic {
  const n = fr.length;
  const open = lagScan(
    predictedTrack(ws, n, PHONE_OPEN, 0, fps),
    fr.map(f => f.open),
    fps
  );
  const width = lagScan(
    predictedTrack(ws, n, PHONE_WIDTH, 0, fps),
    fr.map(f => f.width),
    fps
  );
  const table = perSoundTable(ws, fr, fps);
  const ctl = perSoundTable(
    ws.map(w => ({ ...w, start: w.start + 0.4, end: w.end + 0.4 })),
    fr,
    fps
  ).overall;
  return {
    open,
    width,
    ...table,
    controlPct: ctl.n ? ctl.right / ctl.n : 0,
  };
}

/**
 * Per-frame mouth openness, aspect and lip width inside the tracked face, read at `FPS`.
 * A frame where the detector loses the face inherits the previous face box (and, with no
 * face yet, the previous measurement).
 */
export async function extractMouthFrames(
  clip: string,
  work: string
): Promise<Frame[]> {
  const dir = path.join(work, "frames");
  mkdirSync(dir, { recursive: true });
  // Every frame at the clip's NATIVE rate — the caller maps time with `probeFps(clip)`.
  ff(["-y", "-i", clip, "-vf", "scale=1280:-2", path.join(dir, "%04d.png")]);
  const files = readdirSync(dir).sort();
  const out: Frame[] = [];
  let last: { x: number; y: number; size: number } | null = null;
  for (const f of files) {
    const img = sharp(path.join(dir, f));
    const { data, info } = await img
      .clone()
      .resize({ width: 640 })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const faces = detectFaces(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height
    );
    const s = 1280 / info.width;
    const face: { x: number; y: number; size: number } | null = faces.length
      ? { x: faces[0].x * s, y: faces[0].y * s, size: faces[0].size * s }
      : last;
    if (face) last = face;
    if (!face) {
      out.push(
        out.length ? out[out.length - 1] : { open: 0, aspect: 0, width: 0 }
      );
      continue;
    }
    const mw = Math.round(face.size * 0.42);
    const mh = Math.round(face.size * 0.26);
    const m = await img
      .clone()
      .extract({
        left: Math.max(0, Math.round(face.x - mw / 2)),
        top: Math.max(0, Math.round(face.y + face.size * 0.22)),
        width: mw,
        height: mh,
      })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = m.info.width;
    const H = m.info.height;
    const cols = new Array<number>(W).fill(0);
    const rows = new Array<number>(H).fill(0);
    let dark = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (m.data[y * W + x] < 60) {
          dark++;
          cols[x]++;
          rows[y]++;
        }
    const minRun = Math.max(2, Math.round(H * 0.06));
    const width = cols.filter(c => c >= minRun).length;
    const height = rows.filter(r => r >= minRun).length;
    const colMin = new Array<number>(W).fill(255);
    const lumas = new Array<number>(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = m.data[y * W + x];
        lumas[y * W + x] = v;
        if (v < colMin[x]) colMin[x] = v;
      }
    lumas.sort((a, b) => a - b);
    const medLuma = lumas[Math.floor(lumas.length / 2)];
    let first = -1;
    let lastCol = -1;
    for (let x = 0; x < W; x++)
      if (colMin[x] < medLuma - 25) {
        if (first < 0) first = x;
        lastCol = x;
      }
    out.push({
      open: dark / m.data.length,
      aspect: height >= 2 ? width / height : 0,
      width: first >= 0 ? (lastCol - first + 1) / face.size : 0,
    });
  }
  return out;
}

/** The clip's frame rate, from its stream header. 25 when it cannot be read. */
export function probeFps(clip: string): number {
  const r = spawnSync(getFFmpegPath(), ["-hide_banner", "-i", clip], {
    encoding: "utf8",
    maxBuffer: 4 << 20,
  });
  const m = /(\d+(?:\.\d+)?) fps/.exec(r.stderr ?? "");
  const fps = m ? Number(m[1]) : NaN;
  return Number.isFinite(fps) && fps > 0 ? fps : FPS;
}

/**
 * The clip's loudness per frame — the SECOND WITNESS. Mouth opening correlates with speech
 * energy with no dictionary, no transcription and no word timings involved, so it fails in
 * different ways from the phonetic track. Neither alone is reliable at the correlations these
 * renders produce (r 0.2-0.4 over far levels of 0.1-0.25; on 12 clips the two disagreed by
 * hundreds of ms half the time), so the gate acts only where both agree.
 */
export function audioEnvelope(clip: string, work: string, fps: number, n: number): number[] {
  const pcm = path.join(work, "env.pcm");
  ff(["-y", "-i", clip, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", pcm]);
  const buf = readFileSync(pcm);
  const s = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  const per = 16000 / fps;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * per);
    const b = Math.min(s.length, Math.floor((i + 1) * per));
    let e = 0;
    for (let k = a; k < b; k++) e += s[k] * s[k];
    out.push(Math.sqrt(e / Math.max(1, b - a)));
  }
  return out.map(
    (_, i) => (out[Math.max(0, i - 1)] + out[i] + out[Math.min(n - 1, i + 1)]) / 3
  );
}

/** Word timings from a clip's own audio (whisperx). The fallback when a scene kept none. */
export async function wordsFromClip(
  clip: string,
  work: string
): Promise<Word[]> {
  const mp3 = path.join(work, "audio.mp3");
  ff([
    "-y",
    "-i",
    clip,
    "-vn",
    "-ac",
    "1",
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    mp3,
  ]);
  const { readFileSync } = await import("fs");
  const r = await transcribeWordsFromBuffer(readFileSync(mp3));
  if ("error" in r)
    throw new Error(`transcription failed: ${JSON.stringify(r).slice(0, 200)}`);
  return r.words.map(w => ({
    word: String((w as any).word ?? (w as any).text ?? ""),
    start: w.start,
    end: w.end,
  }));
}

/** What the gate reads: the verdict numbers of one clip, plus whole-clip closure/range. */
export interface JudgeResult {
  peakR: number;
  lagMs: number;
  farR: number;
  /** Fraction of scored sounds on the right side of the clip's own median. */
  soundsPct: number;
  /** Min openness over p/b/m words (lower = lips meet) and the open-minus-closed range. */
  closure: number;
  range: number;
  frames: number;
  words: number;
  /** Where the words came from. */
  wordsSource: "scene" | "transcribed";
  /** The clip's native frame rate the judge mapped time at. */
  fps?: number;
  /** The audio-envelope witness: mouth opening against loudness, same scan. */
  env?: { peakR: number; lagMs: number; farR: number };
}

/**
 * Judge one clip. `words` are the clip's own timings (seconds from ITS first frame); null =
 * transcribe it. Never throws for a measurement problem: a result with `frames: 0` says it
 * could not look, and the caller ships the clip as rendered.
 */
export async function judgeClip(
  clip: Buffer,
  words: Word[] | null,
  label = "clip"
): Promise<JudgeResult> {
  const work = path.join(
    os.tmpdir(),
    `lipsync-judge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  mkdirSync(work, { recursive: true });
  try {
    const clipPath = path.join(work, "clip.mp4");
    writeFileSync(clipPath, clip);
    const fps = probeFps(clipPath);
    const [ws, fr] = await Promise.all([
      words ?? wordsFromClip(clipPath, work),
      extractMouthFrames(clipPath, work),
    ]);
    if (!ws.length || fr.length < 8) {
      return {
        peakR: 0,
        lagMs: 0,
        farR: 0,
        soundsPct: 0,
        closure: NaN,
        range: NaN,
        frames: fr.length,
        words: ws.length,
        wordsSource: words ? "scene" : "transcribed",
      };
    }
    const ph = phoneticScore(ws, fr, fps);
    let env: JudgeResult["env"];
    try {
      const e = lagScan(audioEnvelope(clipPath, work, fps, fr.length), fr.map(f => f.open), fps);
      env = { peakR: e.peakR, lagMs: e.peakLagMs, farR: e.farR };
    } catch (err: any) {
      console.warn(`[LipsyncJudge] ${label}: envelope witness failed (${err?.message ?? err})`);
    }
    // Whole-clip closure/range the way the script's profile computes them: min openness in
    // each p/b/m word, max in each open-vowel word, averaged across words.
    const per = (cls: ClassName, pick: (o: number[]) => number) => {
      const vals: number[] = [];
      for (const w of ws) {
        if (!classesOf(w.word).includes(cls)) continue;
        const lo = Math.max(0, Math.round(w.start * fps));
        const hi = Math.min(fr.length - 1, Math.round(w.end * fps));
        if (lo > hi) continue;
        vals.push(pick(fr.slice(lo, hi + 1).map(f => f.open)));
      }
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
    };
    const closure = per("closed", o => Math.min(...o));
    const opening = per("open", o => Math.max(...o));
    return {
      peakR: ph.open.peakR,
      lagMs: ph.open.peakLagMs,
      farR: ph.open.farR,
      soundsPct: ph.overall.n ? ph.overall.right / ph.overall.n : 0,
      closure,
      range: opening - closure,
      frames: fr.length,
      words: ws.length,
      wordsSource: words ? "scene" : "transcribed",
      fps,
      env,
    };
  } catch (err: any) {
    console.warn(
      `[LipsyncJudge] ${label}: could not judge (${err?.message ?? err})`
    );
    return {
      peakR: 0,
      lagMs: 0,
      farR: 0,
      soundsPct: 0,
      closure: NaN,
      range: NaN,
      frames: 0,
      words: 0,
      wordsSource: words ? "scene" : "transcribed",
    };
  } finally {
    // Best-effort: on Windows a handle can still be closing; a failed cleanup must never
    // turn a judged clip into a failed render.
    try {
      rmSync(work, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch {
      /* leave the temp dir */
    }
  }
}

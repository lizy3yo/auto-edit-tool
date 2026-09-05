/**
 * scripts/measure-lipsync.mts
 *
 * Does the mouth actually SAY the words? A viseme audit for a lip-synced host clip.
 *
 *   npx tsx scripts/measure-lipsync.mts clip.mp4                      # whole-clip numbers only
 *   npx tsx scripts/measure-lipsync.mts clip.mp4 reference.mp4        # + A-Z classes vs a clip
 *   npx tsx scripts/measure-lipsync.mts clip.mp4 --reference NAME     # + A-Z classes vs a saved profile
 *   npx tsx scripts/measure-lipsync.mts heygen.mp4 --save-reference NAME
 *
 * `measure-host-motion.mjs` scores how much the mouth MOVES; this scores whether it forms the
 * right SHAPES. It transcribes the clip's audio with word timings (the app's own whisperx
 * service — a few cents per clip, cached by file hash), tracks the face frame by frame with
 * the app's own detector (`server/pico.ts`), and measures two things about the mouth inside
 * the tracked face:
 *
 * - OPENNESS — the dark fraction of a window over the mouth (the oral cavity reads dark;
 *   closed lips and teeth do not).
 * - ASPECT — width over height of that dark region, meant to separate a ROUNDED "oo" (tall,
 *   narrow) from a SPREAD "ee" (wide, low). It does not, much — HeyGen reads 1.73 vs 1.74.
 * - LIP WIDTH — the corner-to-corner span of the lip line, over face size; the thing "oo"
 *   narrows and "ee" widens. Reported for information until it proves itself.
 *
 * Every word from the transcription is mapped by spelling onto the standard VISEME classes —
 * the alphabet of mouth shapes speech decomposes into — and each class is judged by the
 * statistic it implies:
 *
 *   closed     p b m        lips pressed together        → min openness (lower = lips meet)
 *   lip-teeth  f v          lower lip under the teeth    → min openness
 *   rounded    oo w o u     pursed, tall narrow opening  → aspect at the word's widest instant
 *   spread     ee i y       corners pulled wide          → aspect at the widest instant
 *   open       ah ai aw     jaw dropped                  → max openness
 *   neutral    t d s n l k  slightly parted              → mean openness
 *   rest       pauses       settled between phrases      → mean openness
 *
 * A word can belong to several classes ("blanket" is closed AND open); the report lists which
 * words landed where so nothing is hidden. Spelling rules are English-only, and identical for
 * both clips, so the comparison is fair even where a rule is crude.
 *
 * THE UNIVERSAL JUDGE (needs no reference at all): every word is looked up in the CMU
 * Pronouncing Dictionary (135k English words → the sounds actually spoken: "blanket" →
 * B L AE NG K AH T), each sound is given the mouth opening speech REQUIRES for it (p/b/m shut,
 * "ah" wide, "oo" small, t/d/s parted, silence shut), and the sounds are spread over the
 * word's whisperx timing. That yields a PREDICTED opening curve for the whole clip — how a
 * mouth saying these words should move. It is correlated with the MEASURED opening at every
 * lag from -600 to +600 ms: a mouth saying the words peaks near lag 0 and the correlation
 * falls to nothing a few hundred ms away; a mouth merely flapping, or saying them late, does
 * not. The report gives the peak (how well the mouth tracks the words), where it sits (the
 * sync offset), and the far-lag level (what "out of sync" scores on this very clip — the
 * built-in control). This is the same idea as the SyncNet offset/confidence pair the
 * industry uses, driven by the script instead of a learned audio model, so it needs no HeyGen
 * clip of the sentence and is host-independent: the correlation is scale-free, so a small
 * mouth and a large one are judged alike. The bar was set by running an accepted HeyGen
 * render through the same judge.
 *
 * A per-sound pass/fail table (was the mouth on the right side of its own median for each
 * sound?) is printed for information — it names which sounds went wrong — but does NOT decide
 * the verdict: tested against a 400 ms shift of the same clip it barely separated in-sync from
 * out-of-sync at 25 fps, and it says so on its own line.
 *
 * A REFERENCE PROFILE is the per-class shape of an accepted HeyGen render of the same host,
 * saved once with --save-reference and reused for every later render of that host —
 * different sentences compare by class, not by instant. It is optional now: the phonetic
 * judge is the headline, and a reference only adds the side-by-side calibration column and
 * the spelling-class A-Z table. The two whole-clip limits below (closure, range) predate the
 * classes and stay for continuity; they were calibrated on this host's reference.
 *
 * Alongside the report, a contact sheet `<clip>.visemes.png` shows one exemplar word per
 * class, reference over render, at the instant the statistic was taken.
 */
import "dotenv/config";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { detectFaces } from "../server/pico";
import { transcribeWordsFromBuffer } from "../server/_core/voiceTranscription";
// The CMU Pronouncing Dictionary: word → ARPAbet sounds. This is what turns "how it should
// be" from a HeyGen clip into a rule of speech.
import * as cmuModule from "cmu-pronouncing-dictionary";
const CMU: Record<string, string> = ((cmuModule as any).dictionary ??
  (cmuModule as any).default ??
  cmuModule) as Record<string, string>;

const FPS = 25;
const FFMPEG = process.env.FFMPEG_PATH || (ffmpegPath as unknown as string);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = path.join(HERE, "lipsync-reference");

/** Whole-clip limits, calibrated to the accepted HeyGen reference of this host. */
const CLOSURE_LIMIT = 0.068;
const RANGE_FLOOR = 0.045;

type Word = { word: string; start: number; end: number };
/** open: dark fraction of the mouth window; aspect: dark-region w/h; width: lip line span / face size. */
type Frame = { open: number; aspect: number; width: number };

const ff = (args: string[]) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-400)}`);
};

/** Word timings, cached per clip so a re-measure never re-pays the transcription. */
async function words(clip: string, work: string): Promise<Word[]> {
  const hash = createHash("sha1")
    .update(readFileSync(clip))
    .digest("hex")
    .slice(0, 16);
  const cacheDir = path.join(os.tmpdir(), "lipsync-words");
  mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${hash}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
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
  const r = await transcribeWordsFromBuffer(readFileSync(mp3));
  if ("error" in r)
    throw new Error(`transcription failed: ${JSON.stringify(r).slice(0, 200)}`);
  const out = r.words.map(w => ({
    word: String((w as any).word ?? (w as any).text ?? ""),
    start: w.start,
    end: w.end,
  }));
  writeFileSync(cached, JSON.stringify(out));
  return out;
}

/** Per-frame mouth openness, aspect and lip width inside the tracked face — cached per clip. */
const FRAMES_VERSION = 2; // bump when Frame or its measurement changes
async function mouthFrames(clip: string, work: string): Promise<Frame[]> {
  const hash = createHash("sha1")
    .update(readFileSync(clip))
    .digest("hex")
    .slice(0, 16);
  const cacheDir = path.join(os.tmpdir(), "lipsync-frames");
  mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${hash}-v${FRAMES_VERSION}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const out = await extractMouthFrames(clip, work);
  writeFileSync(cached, JSON.stringify(out));
  return out;
}
async function extractMouthFrames(
  clip: string,
  work: string
): Promise<Frame[]> {
  const dir = path.join(work, "frames");
  mkdirSync(dir, { recursive: true });
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
    const face = faces.length
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
    // Openness: dark fraction. Aspect: extent of the dark region — columns and rows that
    // hold at least a few dark pixels — width over height.
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
    // Lip width, corner to corner. The lip line is the darkest thing in each column whether
    // the mouth is shut or teeth split the cavity, so the span of columns whose darkest pixel
    // sits well below the window's median luma is the mouth's width — the thing "oo" narrows
    // and "ee" widens, which the cavity aspect could not separate. Divided by the face size
    // so hosts of different scale compare.
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

// ── viseme classes from spelling ────────────────────────────────────────────
const clean = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "");
type ClassName =
  "closed" | "lip-teeth" | "rounded" | "spread" | "open" | "neutral" | "rest";
const CLASS_RULES: [ClassName, RegExp][] = [
  ["closed", /[pbm]/],
  ["lip-teeth", /[fv]/],
  ["rounded", /(oo|ou|ow|^w|u|o$)/],
  ["spread", /(ee|ea|^i[^aeiou]|y$|ie)/],
  ["open", /(^i$|ai|igh|ar|aw|ay|a[^eiouy]|o[^ouw])/],
];
const CLASS_ORDER: ClassName[] = [
  "closed",
  "lip-teeth",
  "rounded",
  "spread",
  "open",
  "neutral",
  "rest",
];
/** What each class expects, how it is read, and which direction is "good". */
const CLASS_META: Record<
  ClassName,
  {
    stat: string;
    better: "lower" | "higher";
    tolerance: number;
    expects: string;
  }
> = {
  closed: {
    stat: "min openness",
    better: "lower",
    tolerance: 1.15,
    expects: "lips meet",
  },
  "lip-teeth": {
    stat: "min openness",
    better: "lower",
    tolerance: 1.2,
    expects: "lip under teeth",
  },
  rounded: {
    stat: "aspect @ widest",
    better: "lower",
    tolerance: 1.25,
    expects: "tall, narrow",
  },
  spread: {
    stat: "aspect @ widest",
    better: "higher",
    tolerance: 0.8,
    expects: "wide, low",
  },
  open: {
    stat: "max openness",
    better: "higher",
    tolerance: 0.85,
    expects: "jaw drops",
  },
  neutral: {
    stat: "mean openness",
    better: "higher",
    tolerance: 0.7,
    expects: "slightly parted",
  },
  rest: {
    stat: "mean openness",
    better: "lower",
    tolerance: 1.2,
    expects: "settled",
  },
};
const classesOf = (w: string): ClassName[] => {
  const c = clean(w);
  const hits = CLASS_RULES.filter(([, re]) => re.test(c)).map(([n]) => n);
  return hits.length ? hits : ["neutral"];
};

// ── the rule of speech: sound → mouth shape (ARPAbet → viseme class) ──────────
const PHONE_CLASS: Record<string, ClassName> = {
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
const cmuKey = (w: string) => clean(w).replace(/[\u2018\u2019]/g, "'");
const inDictionary = (w: string) =>
  !!(CMU[cmuKey(w)] ?? CMU[cmuKey(w).replace(/'/g, "")]);
/** A word's sounds from the dictionary; a word it lacks falls back to its spelling classes. */
function phonesOf(word: string): string[] {
  const k = cmuKey(word);
  const entry = CMU[k] ?? CMU[k.replace(/'/g, "")];
  if (entry) return entry.split(/\s+/).map(p => p.replace(/[0-9]/g, ""));
  return classesOf(word).map(cls => CLASS_STANDIN[cls]);
}

type PhoneScore = { n: number; right: number; missed: string[] };
type LagScan = {
  /** Pearson r between predicted and measured opening at the best lag within ±SYNC_MAX. */
  peakR: number;
  /** Where that peak sits, ms; negative = the mouth moves BEFORE the sound. */
  peakLagMs: number;
  /** Median |r| at lags ≥ 320 ms away — what "out of sync" scores on this clip. */
  farR: number;
  /** r at every lag, for the curve. */
  curve: { lagMs: number; r: number }[];
};
type Phonetic = {
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

/**
 * How open the mouth is for each sound, 0 (shut) to 1 (jaw dropped), and how wide the lips
 * are, -1 (pursed) to +1 (corners pulled). Standard viseme targets; a sound not listed is
 * parted-neutral. Only the ORDER matters much — the correlation is scale-free.
 */
const PHONE_OPEN: Record<string, number> = {
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
const PHONE_WIDTH: Record<string, number> = {
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
const SYNC_MAX_FRAMES = 15; // ±600 ms scanned
const FAR_LAG_FRAMES = 8; // ≥320 ms away counts as "out of sync"

/** The curve a mouth saying these words should trace, one value per frame, lightly smoothed. */
function predictedTrack(
  ws: Word[],
  n: number,
  table: Record<string, number>,
  fill: number
): number[] {
  const p = new Array<number>(n).fill(fill);
  for (const w of ws) {
    const phones = phonesOf(w.word);
    const per = Math.max(0.04, w.end - w.start) / phones.length;
    phones.forEach((ph, i) => {
      const lo = Math.round((w.start + i * per) * FPS);
      const hi = Math.round((w.start + (i + 1) * per) * FPS);
      for (let f = Math.max(0, lo); f <= hi && f < n; f++)
        p[f] = table[ph] ?? fill;
    });
  }
  // Three-frame smoothing: lips glide between sounds (co-articulation), they do not step.
  return p.map(
    (_, i) => (p[Math.max(0, i - 1)] + p[i] + p[Math.min(n - 1, i + 1)]) / 3
  );
}

function pearson(a: number[], b: number[], lag: number): number {
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
function lagScan(pred: number[], meas: number[]): LagScan {
  const curve: LagScan["curve"] = [];
  let peak = { r: -Infinity, lag: 0 };
  const far: number[] = [];
  for (let lag = -SYNC_MAX_FRAMES; lag <= SYNC_MAX_FRAMES; lag++) {
    const r = pearson(pred, meas, lag);
    curve.push({ lagMs: (lag * 1000) / FPS, r });
    if (r > peak.r) peak = { r, lag };
    if (Math.abs(lag) >= FAR_LAG_FRAMES) far.push(Math.abs(r));
  }
  far.sort((a, b) => a - b);
  return {
    peakR: peak.r,
    peakLagMs: (peak.lag * 1000) / FPS,
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
function perSoundTable(
  ws: Word[],
  fr: Frame[]
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
      const lo = Math.max(0, Math.round(t0 * FPS) - PHONE_PAD);
      const hi = Math.min(
        fr.length - 1,
        Math.round((t0 + per) * FPS) + PHONE_PAD
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
    const lo = Math.round(ws[i - 1].end * FPS);
    const hi = Math.min(fr.length - 1, Math.round(ws[i].start * FPS));
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

function phoneticScore(ws: Word[], fr: Frame[]): Phonetic {
  const n = fr.length;
  const open = lagScan(
    predictedTrack(ws, n, PHONE_OPEN, 0),
    fr.map(f => f.open)
  );
  const width = lagScan(
    predictedTrack(ws, n, PHONE_WIDTH, 0),
    fr.map(f => f.width)
  );
  const table = perSoundTable(ws, fr);
  const ctl = perSoundTable(
    ws.map(w => ({ ...w, start: w.start + 0.4, end: w.end + 0.4 })),
    fr
  ).overall;
  return {
    open,
    width,
    ...table,
    controlPct: ctl.n ? ctl.right / ctl.n : 0,
  };
}

/**
 * The universal bar, calibrated by running an accepted HeyGen render of this host through the
 * same judge (it scored peak r 0.21 at -80 ms against a far-lag level of 0.05; the render
 * that prompted this scored 0.46 at -80 ms against 0.03). "Tracks the words" means the peak
 * clears the out-of-sync level by SYNC_MARGIN; "in sync" means the peak sits within
 * SYNC_OFFSET_MAX_MS of zero — a mouth normally LEADS its sound by 40-100 ms (lips close
 * before the "b" is heard), so a small negative lag is how speech looks, not an error.
 */
const SYNC_MARGIN = 0.1;
const SYNC_OFFSET_MAX_MS = 200;

type ClassStat = {
  value: number;
  n: number;
  words: string[];
  exemplar?: { word: string; frame: number };
};
type Profile = {
  text: string;
  closure: number;
  opening: number;
  range: number;
  classes: Partial<Record<ClassName, ClassStat>>;
  phonetic?: Phonetic;
};

function profileOf(ws: Word[], fr: Frame[]): Profile {
  const win = (a: number, b: number) => {
    const lo = Math.max(0, Math.round(a * FPS));
    const hi = Math.min(fr.length - 1, Math.round(b * FPS));
    return lo <= hi ? { lo, hi, s: fr.slice(lo, hi + 1) } : null;
  };
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  const per: Record<
    ClassName,
    {
      vals: number[];
      words: string[];
      best?: { v: number; word: string; frame: number };
    }
  > = {
    closed: { vals: [], words: [] },
    "lip-teeth": { vals: [], words: [] },
    rounded: { vals: [], words: [] },
    spread: { vals: [], words: [] },
    open: { vals: [], words: [] },
    neutral: { vals: [], words: [] },
    rest: { vals: [], words: [] },
  };
  const note = (
    cls: ClassName,
    v: number,
    word: string,
    frame: number,
    extreme: "lower" | "higher"
  ) => {
    if (!Number.isFinite(v)) return;
    const p = per[cls];
    p.vals.push(v);
    p.words.push(word);
    const better =
      !p.best || (extreme === "lower" ? v < p.best.v : v > p.best.v);
    if (better) p.best = { v, word, frame };
  };
  for (const w of ws) {
    const r = win(w.start, w.end);
    if (!r) continue;
    const opens = r.s.map(f => f.open);
    const iMin = opens.indexOf(Math.min(...opens));
    const iMax = opens.indexOf(Math.max(...opens));
    for (const cls of classesOf(w.word)) {
      if (cls === "closed" || cls === "lip-teeth")
        note(cls, opens[iMin], w.word, r.lo + iMin, "lower");
      else if (cls === "open")
        note(cls, opens[iMax], w.word, r.lo + iMax, "higher");
      else if (cls === "rounded")
        note(cls, r.s[iMax].aspect, w.word, r.lo + iMax, "lower");
      else if (cls === "spread")
        note(cls, r.s[iMax].aspect, w.word, r.lo + iMax, "higher");
      else
        note(
          cls,
          mean(opens),
          w.word,
          r.lo + Math.floor(opens.length / 2),
          "higher"
        );
    }
  }
  // Rest: pauses of 120 ms or more between words.
  for (let i = 1; i < ws.length; i++) {
    const gap = ws[i].start - ws[i - 1].end;
    if (gap < 0.12) continue;
    const r = win(ws[i - 1].end, ws[i].start);
    if (!r) continue;
    const opens = r.s.map(f => f.open);
    note(
      "rest",
      mean(opens),
      `(pause ${Math.round(gap * 1000)}ms)`,
      r.lo + Math.floor(opens.length / 2),
      "lower"
    );
  }
  const classes: Profile["classes"] = {};
  for (const cls of CLASS_ORDER) {
    const p = per[cls];
    if (!p.vals.length) continue;
    classes[cls] = {
      value: mean(p.vals),
      n: p.vals.length,
      words: [...new Set(p.words)],
      exemplar: p.best ? { word: p.best.word, frame: p.best.frame } : undefined,
    };
  }
  const closure = classes.closed?.value ?? NaN;
  const opening = classes.open?.value ?? NaN;
  return {
    text: ws.map(w => w.word).join(" "),
    closure,
    opening,
    range: opening - closure,
    classes,
    phonetic: phoneticScore(ws, fr),
  };
}

async function measure(clip: string): Promise<Profile> {
  const work = path.join(
    os.tmpdir(),
    `lipsync-audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  mkdirSync(work, { recursive: true });
  try {
    const [ws, fr] = await Promise.all([
      words(clip, work),
      mouthFrames(clip, work),
    ]);
    return profileOf(ws, fr);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** One exemplar word per class, reference over render, at the instant each statistic was taken. */
function contactSheet(
  render: string,
  renderP: Profile,
  ref: { clip: string; profile: Profile } | null,
  out: string
) {
  const crop = "crop=iw*0.30:ih*0.34:iw*0.36:ih*0.20,scale=240:-2";
  const cols = CLASS_ORDER.filter(c => renderP.classes[c]?.exemplar);
  if (!cols.length) return;
  const ins: string[] = [];
  const fl: string[] = [];
  const idx: string[][] = [[], []];
  let n = 0;
  const label = (t: string) => t.replace(/[':]/g, "");
  for (const cls of cols) {
    const rows: [string, Profile, string][] = ref?.clip
      ? [
          [ref.clip, ref.profile, "REF"],
          [render, renderP, "RENDER"],
        ]
      : [[render, renderP, "RENDER"]];
    rows.forEach(([clip, p, tag], row) => {
      const ex = p.classes[cls]?.exemplar;
      const frame = ex ? ex.frame : 0;
      ins.push("-ss", (frame / FPS).toFixed(3), "-i", clip);
      fl.push(
        `[${n}:v]${crop},drawtext=text='${label(`${tag} ${cls} ${ex?.word ?? ""}`)}':fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:x=4:y=4[v${n}]`
      );
      idx[row].push(`[v${n}]`);
      n++;
    });
  }
  const stacks = idx
    .filter(r => r.length)
    .map((r, i) => `${r.join("")}hstack=inputs=${r.length}[r${i}]`);
  const rowsOut = idx.filter(r => r.length).map((_, i) => `[r${i}]`);
  const fc =
    fl.join(";") +
    ";" +
    stacks.join(";") +
    (rowsOut.length > 1
      ? `;${rowsOut.join("")}vstack[out]`
      : `;${rowsOut[0]}copy[out]`);
  const r = spawnSync(
    FFMPEG,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      ...ins,
      "-filter_complex",
      fc,
      "-map",
      "[out]",
      "-frames:v",
      "1",
      "-y",
      out,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0)
    console.log(`  (contact sheet failed: ${r.stderr.slice(-200)})`);
  else console.log(`  contact sheet: ${out}`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))
);
const [clip, referenceClip] = positional;
if (!clip) {
  console.error(
    "usage: npx tsx scripts/measure-lipsync.mts <clip.mp4> [reference.mp4] [--reference NAME] [--save-reference NAME]"
  );
  process.exit(2);
}

const saveAs = opt("--save-reference");
const renderP = await measure(clip);

if (saveAs) {
  mkdirSync(REFERENCE_DIR, { recursive: true });
  const file = path.join(REFERENCE_DIR, `${saveAs}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        name: saveAs,
        source: path.basename(clip),
        savedAt: new Date().toISOString(),
        profile: renderP,
      },
      null,
      2
    )
  );
  console.log(
    `\n  saved reference profile "${saveAs}" → ${file}\n  "${renderP.text}"\n`
  );
  for (const cls of CLASS_ORDER) {
    const c = renderP.classes[cls];
    if (c)
      console.log(
        `  ${cls.padEnd(10)} ${CLASS_META[cls].stat.padEnd(18)} ${c.value.toFixed(3)}   n=${c.n}  ${c.words.slice(0, 6).join(", ")}${c.words.length > 6 ? ", …" : ""}`
      );
  }
  const sc = renderP.phonetic!.open;
  console.log(
    `\n  on the universal judge this reference tracks the words at r ${sc.peakR.toFixed(2)} (peak at ${sc.peakLagMs} ms; out-of-sync level ${sc.farR.toFixed(2)})`
  );
  process.exit(0);
}

let ref: { clip: string; profile: Profile; label: string } | null = null;
const refName = opt("--reference");
if (refName) {
  const file = path.join(REFERENCE_DIR, `${refName}.json`);
  if (!existsSync(file)) {
    console.error(
      `no saved reference "${refName}" (${file}) — create one with --save-reference`
    );
    process.exit(2);
  }
  const saved = JSON.parse(readFileSync(file, "utf8"));
  ref = {
    clip: "",
    profile: saved.profile,
    label: `profile "${refName}" (${saved.source})`,
  };
} else if (referenceClip) {
  ref = {
    clip: referenceClip,
    profile: await measure(referenceClip),
    label: path.basename(referenceClip),
  };
}

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "  n/a");
console.log(`\n  ${clip}\n  "${renderP.text}"\n`);
const row = (label: string, v: number, r?: number, note = "") =>
  console.log(
    `  ${label.padEnd(22)} ${fmt(v).padStart(7)}${r != null ? `   ref ${fmt(r)}` : ""}   ${note}`
  );
row(
  "lips-closed (p/b/m)",
  renderP.closure,
  ref?.profile.closure,
  `lower = lips meet   limit ${CLOSURE_LIMIT}`
);
row(
  "open vowels",
  renderP.opening,
  ref?.profile.opening,
  "higher = mouth opens"
);
row(
  "articulation range",
  renderP.range,
  ref?.profile.range,
  `open minus closed   floor ${RANGE_FLOOR}`
);

const failures: string[] = [];

// ── the universal judge: does the mouth trace the words? ──
{
  const ph = renderP.phonetic!;
  const refPh = ref?.profile.phonetic;
  const r2 = (v: number) => v.toFixed(2).padStart(5);
  const ms = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)} ms`;
  console.log(
    `\n  Does the mouth trace the words?  (predicted opening from the script's sounds vs the measured mouth, over lag)${refPh ? "   [HeyGen through the same judge]" : ""}\n`
  );
  const line = (label: string, a: LagScan, b?: LagScan, note = "") =>
    console.log(
      `  ${label.padEnd(12)} peak r ${r2(a.peakR)} at ${ms(a.peakLagMs).padStart(8)}   out-of-sync level ${r2(a.farR)}` +
        (b
          ? `   | HeyGen ${r2(b.peakR)} at ${ms(b.peakLagMs).padStart(8)}, level ${r2(b.farR)}`
          : "") +
        `   ${note}`
    );
  line("opening", ph.open, refPh?.open, "← the verdict");
  line(
    "lip width",
    ph.width,
    refPh?.width,
    "(rounded vs spread; informational)"
  );
  // The curve, so a reader sees the peak rather than trusting a number.
  const pick = [
    -600, -400, -240, -160, -80, -40, 0, 40, 80, 160, 240, 400, 600,
  ];
  const at = (sc: LagScan, lagMs: number) =>
    sc.curve.find(c => Math.round(c.lagMs) === lagMs)?.r ?? NaN;
  console.log(
    `  ${"lag ms".padEnd(12)}${pick.map(l => String(l).padStart(6)).join("")}   (negative = mouth before sound)`
  );
  console.log(
    `  ${"r render".padEnd(12)}${pick.map(l => at(ph.open, l).toFixed(2).padStart(6)).join("")}`
  );
  if (refPh)
    console.log(
      `  ${"r HeyGen".padEnd(12)}${pick.map(l => at(refPh.open, l).toFixed(2).padStart(6)).join("")}`
    );
  if (ph.open.peakR - ph.open.farR < SYNC_MARGIN)
    failures.push(
      `the mouth does not trace the words: peak r ${ph.open.peakR.toFixed(2)} is within ${SYNC_MARGIN} of the out-of-sync level ${ph.open.farR.toFixed(2)}`
    );
  else if (Math.abs(ph.open.peakLagMs) > SYNC_OFFSET_MAX_MS)
    failures.push(
      `the mouth is out of sync: it tracks the words best ${ms(ph.open.peakLagMs)} away (limit ±${SYNC_OFFSET_MAX_MS} ms)`
    );

  // Per-sound detail: WHERE it missed. Informational — see the header.
  const pct = (p?: { n: number; right: number }) =>
    (p && p.n
      ? `${Math.round((100 * p.right) / p.n)}% (${p.right}/${p.n})`
      : "n/a"
    ).padStart(12);
  const SOUNDS: Record<ClassName, string> = {
    closed: "p b m",
    "lip-teeth": "f v",
    rounded: "oo uh oh aw oy w",
    spread: "ee ih ay y",
    open: "ah a uh ai ow",
    neutral: "t d s n l k …",
    rest: "pauses ≥120ms",
  };
  console.log(
    `\n  Sound by sound, for information — was the mouth on the right side of its usual for each sound?\n`
  );
  console.log(
    `  ${"shape".padEnd(10)} ${"sounds".padEnd(18)} ${"render".padStart(12)}${refPh ? `   ${"HeyGen".padStart(12)}` : ""}   where it missed`
  );
  for (const cls of CLASS_ORDER) {
    const p = ph.perClass[cls];
    if (!p) continue;
    console.log(
      `  ${cls.padEnd(10)} ${SOUNDS[cls].padEnd(18)} ${pct(p)}${refPh ? `   ${pct(refPh.perClass[cls])}  ` : ""}   ${p.missed.join(", ")}`
    );
  }
  console.log(
    `  ${"overall".padEnd(10)} ${"".padEnd(18)} ${pct(ph.overall)}${refPh ? `   ${pct(refPh.overall)}  ` : ""}`
  );
  console.log(
    `  ${"shifted".padEnd(10)} ${"same clip, +400 ms".padEnd(18)} ${`${Math.round(100 * ph.controlPct)}%`.padStart(12)}${refPh ? `   ${`${Math.round(100 * refPh.controlPct)}%`.padStart(12)}  ` : ""}   what this table gives a mouth out of sync — read it against that`
  );
  const unknown = [...new Set(ph.unknownWords)];
  if (unknown.length)
    console.log(
      `  (not in the dictionary, judged by spelling: ${unknown.join(", ")})`
    );
}

if (renderP.closure > CLOSURE_LIMIT)
  failures.push(
    `lips do not meet on p/b/m (${fmt(renderP.closure)} > ${CLOSURE_LIMIT}) — consonants blurred`
  );
if (renderP.range < RANGE_FLOOR)
  failures.push(
    `articulation range ${fmt(renderP.range)} < ${RANGE_FLOOR} — the mouth moves in time but not far enough`
  );

if (ref) {
  console.log(`\n  A-Z mouth shapes vs ${ref.label}\n`);
  console.log(
    `  ${"class".padEnd(10)} ${"reads".padEnd(18)} ${"render".padStart(7)} ${"ref".padStart(7)}   verdict`
  );
  for (const cls of CLASS_ORDER) {
    const a = renderP.classes[cls];
    const b = ref.profile.classes[cls];
    const meta = CLASS_META[cls];
    if (!a || !b) {
      console.log(
        `  ${cls.padEnd(10)} ${meta.stat.padEnd(18)} ${fmt(a?.value ?? NaN).padStart(7)} ${fmt(b?.value ?? NaN).padStart(7)}   — (no words in ${!a ? "render" : "reference"})`
      );
      continue;
    }
    const ok =
      meta.better === "lower"
        ? a.value <= b.value * meta.tolerance + 0.005
        : a.value >= b.value * meta.tolerance - 0.005;
    const verdict = cls === "neutral" ? "info" : ok ? "PASS" : "FAIL";
    console.log(
      `  ${cls.padEnd(10)} ${meta.stat.padEnd(18)} ${fmt(a.value).padStart(7)} ${fmt(b.value).padStart(7)}   ${verdict}  ${meta.expects}  [${a.words.slice(0, 4).join(", ")}${a.words.length > 4 ? ", …" : ""}]`
    );
    if (verdict === "FAIL")
      failures.push(
        `${cls}: ${meta.stat} ${fmt(a.value)} vs reference ${fmt(b.value)} — ${meta.expects} not matched`
      );
  }
  if (!argv.includes("--no-sheet") && ref.clip)
    contactSheet(
      clip,
      renderP,
      { clip: ref.clip, profile: ref.profile },
      clip.replace(/\.[^.]+$/, "") + ".visemes.png"
    );
}

console.log("");
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("  PASS  the mouth makes the shape each sound requires\n");
}

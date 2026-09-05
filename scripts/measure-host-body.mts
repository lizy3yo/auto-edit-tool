/**
 * scripts/measure-host-body.mts
 *
 * Does the rest of the host behave like a person? Eyes, head, shoulders and brows of a
 * lip-synced clip, judged against how a HUMAN body behaves while speaking — not against a
 * reference clip of one host.
 *
 *   npx tsx scripts/measure-host-body.mts clip.mp4                     # judge on the human rules
 *   npx tsx scripts/measure-host-body.mts clip.mp4 --photo host.jpg    # + eyes vs the host's own photo
 *   npx tsx scripts/measure-host-body.mts clip.mp4 --beside other.mp4  # + a second clip in a side column
 *
 * `measure-host-motion.mjs` is a before/after comparator with fixed regions and pass marks
 * copied from an accepted HeyGen clip of one host; `measure-lipsync.mts` judges the mouth
 * against the script. This does for the body what that does for the mouth: every region
 * follows the tracked face (`server/pico.ts`), so the framing can be anything, and every
 * verdict is a rule of human behaviour that holds for any host, any script, any channel:
 *
 *   EYES      people blink 10-30 times a minute while talking, each 100-400 ms; none in a
 *             clip over 8 s is dead eyes, a one-frame dip is flicker. Between blinks the eyes
 *             hold still (no flutter). Their SIZE against the host's own photo (--photo) is
 *             printed for information only: the eye band is cut from a detector box, not
 *             from landmarks, and a box a few percent off on the photo drags brow or rim
 *             into the band — the accepted HeyGen clip reads 25% "wider" than the photo by
 *             this measure, so it cannot fail a render. Compare it against the side column.
 *   HEAD      a head moves slowly: its motion lives below ~2 Hz, and energy above 4 Hz is
 *             sampler jitter, not a person. It moves a little — a few percent of its own size
 *             over a sentence — not nothing (a statue) and not a lot (swaying). And it moves
 *             WITH the speech — people nod and tilt on stressed syllables — so head motion is
 *             correlated with the narration's loudness over lag, the mouth judge's scan. That
 *             one is INFORMATIONAL: over a 5 s beat even the accepted HeyGen clip shows no
 *             correlation (its head barely moves), so it is not a rule a short clip can be
 *             failed on. The cold-start check stays in `measure-host-motion.mjs`.
 *   SHOULDERS follow the head and move less than it — the head sits on the spine.
 *   BROWS     move in short bursts on emphasis, not continuously (informational).
 *
 * Camera, background morph, window seams and subject cuts are NOT here — those already had
 * a universal bar (a locked camera's expected value is zero) in `measure-host-motion.mjs`.
 * Gaze direction is not here either, and the eyes-vs-photo verdict above waits on the same
 * thing: the detector gives an eye band, not a pupil or an eyelid; a landmark model is the
 * separate step that unlocks both.
 *
 * Human ranges below are from the blink and head-motion literature (Bentivoglio 1997 on
 * blink rate; Munhall 2004 / McClave 2000 on head motion tracking speech), rounded to be
 * generous; an accepted HeyGen clip is run through the SAME judge once to confirm they are
 * sane, never to set them.
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
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { detectFaces } from "../server/pico";

const FPS = 25;
const FFMPEG = process.env.FFMPEG_PATH || (ffmpegPath as unknown as string);

// ── the human rules ──────────────────────────────────────────────────────────
const BLINK_RATE_MIN = 8; // per minute of clip; 10-30 is typical, 8 leaves room for a short clip
const BLINK_RATE_MAX = 40;
const NO_BLINK_CLIP_SEC = 8; // people do not go this long without blinking
const BLINK_MIN_FRAMES = 2; // 80 ms — shorter is a flicker
const BLINK_MAX_FRAMES = 10; // 400 ms — longer is eyes closing
const EYE_FLUTTER_MAX = 0.08; // median frame-to-frame eye change between blinks, over resting size
const HEAD_HF_MAX = 0.35; // fraction of head-velocity energy above HEAD_HF_HZ
const HEAD_HF_HZ = 4;
const HEAD_RANGE_MIN = 0.01; // head travel over the clip, as a fraction of face size
const HEAD_RANGE_MAX = 0.4;
const SHOULDER_RATIO_MAX = 1.0; // shoulders move less than the head
const SHOULDER_COUPLING_MIN = 0.3; // and with it
const SYNC_MAX_FRAMES = 15;
const FAR_LAG_FRAMES = 8;

type Box = { x: number; y: number; size: number };
type BodyFrame = {
  face: Box | null;
  /** Visible-eye area: fraction of the eye band that is not skin (iris, pupil, sclera). */
  eye: number;
  /** Mean luma of the eye band — rises when the lids (skin) cover the eye. */
  eyeLuma: number;
  /** Head displacement vs the previous frame, in pixels, from a blurred face template match. */
  dx: number;
  dy: number;
  /** Real (blurred) frame-to-frame change per region, mean |Δluma|. */
  head: number;
  shoulders: number;
  brows: number;
};

const ff = (args: string[]) => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-400)}`);
};
const fileHash = (p: string) =>
  createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 16);
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** Grayscale crop of a region of the frame, blurred, as a small raw buffer. */
async function crop(
  img: sharp.Sharp,
  box: { left: number; top: number; width: number; height: number },
  frameW: number,
  frameH: number,
  blur = 0,
  width?: number
) {
  const left = Math.max(0, Math.min(frameW - 2, Math.round(box.left)));
  const top = Math.max(0, Math.min(frameH - 2, Math.round(box.top)));
  const w = Math.max(2, Math.min(frameW - left, Math.round(box.width)));
  const h = Math.max(2, Math.min(frameH - top, Math.round(box.height)));
  let s = img.clone().extract({ left, top, width: w, height: h }).grayscale();
  if (width) s = s.resize({ width });
  if (blur) s = s.blur(blur);
  return s.raw().toBuffer({ resolveWithObject: true });
}

const meanAbsDiff = (a: Buffer, b: Buffer) => {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return n ? s / n : 0;
};

/** Best (dx, dy) shift of `cur` against `prev`, ±R px, parabolic sub-pixel refinement. */
function shift(
  prev: Buffer,
  cur: Buffer,
  w: number,
  h: number,
  R = 4
): { dx: number; dy: number } {
  const sad = (dx: number, dy: number) => {
    let s = 0;
    let n = 0;
    for (let y = R; y < h - R; y++)
      for (let x = R; x < w - R; x++) {
        s += Math.abs(cur[y * w + x] - prev[(y + dy) * w + (x + dx)]);
        n++;
      }
    return n ? s / n : Infinity;
  };
  let best = { dx: 0, dy: 0, v: Infinity };
  const grid: number[][] = [];
  for (let dy = -R; dy <= R; dy++) {
    grid[dy + R] = [];
    for (let dx = -R; dx <= R; dx++) {
      const v = sad(dx, dy);
      grid[dy + R][dx + R] = v;
      if (v < best.v) best = { dx, dy, v };
    }
  }
  const refine = (m: number, l: number, r: number) => {
    const d = l - 2 * m + r;
    return d > 0 ? (l - r) / (2 * d) : 0;
  };
  const gx = best.dx + R;
  const gy = best.dy + R;
  const sx =
    gx > 0 && gx < 2 * R
      ? refine(grid[gy][gx], grid[gy][gx - 1], grid[gy][gx + 1])
      : 0;
  const sy =
    gy > 0 && gy < 2 * R
      ? refine(grid[gy][gx], grid[gy - 1][gx], grid[gy + 1][gx])
      : 0;
  return { dx: best.dx + sx, dy: best.dy + sy };
}

/** Eye-band statistics: visible-eye fraction (non-skin pixels) and mean luma. */
function eyeStats(data: Buffer): { eye: number; luma: number } {
  const med = median(Array.from(data));
  let nonSkin = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (Math.abs(data[i] - med) > 35) nonSkin++;
  }
  return { eye: nonSkin / data.length, luma: sum / data.length };
}

const BODY_VERSION = 2;
async function bodyFrames(clip: string, work: string): Promise<BodyFrame[]> {
  const cacheDir = path.join(os.tmpdir(), "lipsync-body");
  mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${fileHash(clip)}-v${BODY_VERSION}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  const out = await extractBodyFrames(clip, work);
  writeFileSync(cached, JSON.stringify(out));
  return out;
}

/** The regions, relative to the detector's face box (centre x,y and size ≈ face width). */
const eyeBand = (f: Box) => ({
  left: f.x - f.size * 0.3,
  top: f.y - f.size * 0.2,
  width: f.size * 0.6,
  height: f.size * 0.18,
});
const browBand = (f: Box) => ({
  left: f.x - f.size * 0.3,
  top: f.y - f.size * 0.4,
  width: f.size * 0.6,
  height: f.size * 0.18,
});
const headBox = (f: Box) => ({
  left: f.x - f.size * 0.5,
  top: f.y - f.size * 0.6,
  width: f.size,
  height: f.size * 1.2,
});
const shoulderBox = (f: Box, frameH: number) => ({
  left: f.x - f.size * 1.1,
  top: Math.min(frameH - 2, f.y + f.size * 0.85),
  width: f.size * 2.2,
  height: f.size * 0.6,
});

async function extractBodyFrames(
  clip: string,
  work: string
): Promise<BodyFrame[]> {
  const dir = path.join(work, "frames");
  mkdirSync(dir, { recursive: true });
  ff(["-y", "-i", clip, "-vf", "scale=1280:-2", path.join(dir, "%04d.png")]);
  const files = readdirSync(dir).sort();
  const out: BodyFrame[] = [];
  // ONE box for the whole clip — the median of every frame's detection. Every region is cut
  // relative to the box, so a box that followed the detector's frame-to-frame wobble (or
  // re-framed mid-clip) would manufacture motion: a re-frame showed up as an 11 px head
  // "jump" and a one-frame eye "flicker". A talking head in a pinned shot stays within a
  // fraction of its own size, and the bands are cut generously enough to hold it.
  const dets: Box[] = [];
  const frameW = 1280;
  let frameH = 720;
  for (const f of files) {
    const { data, info } = await sharp(path.join(dir, f))
      .resize({ width: 640 })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const s = 1280 / info.width;
    frameH = Math.round(info.height * s);
    const faces = detectFaces(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height
    );
    if (faces.length)
      dets.push({
        x: faces[0].x * s,
        y: faces[0].y * s,
        size: faces[0].size * s,
      });
  }
  const face: Box | null = dets.length
    ? {
        x: median(dets.map(d => d.x)),
        y: median(dets.map(d => d.y)),
        size: median(dets.map(d => d.size)),
      }
    : null;
  let prev: {
    head: Buffer;
    headT: Buffer;
    sh: Buffer;
    br: Buffer;
  } | null = null;
  for (const f of files) {
    const img = sharp(path.join(dir, f));
    if (!face) {
      out.push({
        face: null,
        eye: 0,
        eyeLuma: 0,
        dx: 0,
        dy: 0,
        head: 0,
        shoulders: 0,
        brows: 0,
      });
      continue;
    }
    const eyes = await crop(img, eyeBand(face), frameW, frameH);
    const { eye, luma } = eyeStats(eyes.data);
    const head = await crop(img, headBox(face), frameW, frameH, 3, 96);
    const headT = await crop(img, headBox(face), frameW, frameH, 1.5, 96);
    const sh = await crop(
      img,
      shoulderBox(face, frameH),
      frameW,
      frameH,
      3,
      96
    );
    const br = await crop(img, browBand(face), frameW, frameH, 2, 96);
    let d = { dx: 0, dy: 0 };
    let headM = 0;
    let shM = 0;
    let brM = 0;
    if (prev) {
      d = shift(prev.headT, headT.data, headT.info.width, headT.info.height);
      headM = meanAbsDiff(prev.head, head.data);
      shM = meanAbsDiff(prev.sh, sh.data);
      brM = meanAbsDiff(prev.br, br.data);
    }
    // Template pixels → frame pixels: the head crop is `face.size` wide, resized to 96.
    const px = face.size / headT.info.width;
    out.push({
      face,
      eye,
      eyeLuma: luma,
      dx: d.dx * px,
      dy: d.dy * px,
      head: headM,
      shoulders: shM,
      brows: brM,
    });
    prev = { head: head.data, headT: headT.data, sh: sh.data, br: br.data };
  }
  return out;
}

/** Loudness per frame: RMS of the narration in 1/FPS blocks. */
function loudness(clip: string, work: string, n: number): number[] {
  const raw = path.join(work, "audio.raw");
  ff(["-y", "-i", clip, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", raw]);
  const buf = readFileSync(raw);
  const per = Math.round(8000 / FPS);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = i * per; k < (i + 1) * per; k++) {
      const off = k * 2;
      if (off + 1 >= buf.length) break;
      const v = buf.readInt16LE(off) / 32768;
      s += v * v;
      c++;
    }
    out.push(c ? Math.sqrt(s / c) : 0);
  }
  return out;
}

/**
 * The photo's own visible-eye fraction, measured the same way as a frame AT THE SAME SCALE:
 * the photo is resized so its face is the clip's face size, since the non-skin fraction of a
 * band depends on how many pixels an eye edge occupies.
 */
async function photoEye(
  photo: string,
  faceSize: number
): Promise<number | null> {
  // The cascade has a largest face it will find, and a portrait photo's face fills the
  // frame — so detect on progressively smaller copies and map the box back up.
  const detect = async (buf: Buffer) => {
    const meta = await sharp(buf).metadata();
    const W = meta.width ?? 640;
    for (const dw of [640, 480, 320, 240, 160]) {
      const { data, info } = await sharp(buf)
        .resize({ width: dw })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const s = W / info.width;
      const faces = detectFaces(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        info.width,
        info.height
      );
      if (faces.length)
        return {
          x: faces[0].x * s,
          y: faces[0].y * s,
          size: faces[0].size * s,
          W,
          H: meta.height ?? 0,
        };
    }
    return null;
  };
  const first = await detect(
    await sharp(photo).resize({ width: 1280 }).png().toBuffer()
  );
  if (!first) return null;
  const buf = await sharp(photo)
    .resize({ width: Math.round((1280 * faceSize) / first.size) })
    .png()
    .toBuffer();
  const face = await detect(buf);
  if (!face) return null;
  const eyes = await crop(sharp(buf), eyeBand(face), face.W, face.H);
  return eyeStats(eyes.data).eye;
}

// ── analysis ─────────────────────────────────────────────────────────────────
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
  const mx = mean(xs);
  const my = mean(ys);
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
type LagScan = { peakR: number; peakLagMs: number; farR: number };
function lagScan(a: number[], b: number[]): LagScan {
  let peak = { r: -Infinity, lag: 0 };
  const far: number[] = [];
  for (let lag = -SYNC_MAX_FRAMES; lag <= SYNC_MAX_FRAMES; lag++) {
    const r = pearson(a, b, lag);
    if (r > peak.r) peak = { r, lag };
    if (Math.abs(lag) >= FAR_LAG_FRAMES) far.push(Math.abs(r));
  }
  return {
    peakR: peak.r,
    peakLagMs: (peak.lag * 1000) / FPS,
    farR: median(far),
  };
}
const smooth = (xs: number[], k = 2) =>
  xs.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = i - k; j <= i + k; j++)
      if (j >= 0 && j < xs.length) {
        s += xs[j];
        c++;
      }
    return s / c;
  });

/** Fraction of a series' energy (mean removed) above `hz`, by a plain DFT. */
function highFrequencyFraction(xs: number[], hz: number): number {
  const n = xs.length;
  if (n < 16) return 0;
  const m = mean(xs);
  const x = xs.map(v => v - m);
  let total = 0;
  let high = 0;
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const a = (2 * Math.PI * k * t) / n;
      re += x[t] * Math.cos(a);
      im -= x[t] * Math.sin(a);
    }
    const p = re * re + im * im;
    total += p;
    if ((k * FPS) / n > hz) high += p;
  }
  return total > 0 ? high / total : 0;
}

type Blink = { start: number; len: number };
/**
 * Blinks: short bumps in the eye band's mean luma — the lids are skin, brighter than the
 * eye — above a 1 s rolling median, at least 3× the band's own noise and lasting
 * BLINK_MIN..MAX frames. Longer bumps are reported as the eyes closing; one-frame bumps as
 * flicker.
 */
function findBlinks(luma: number[]): {
  blinks: Blink[];
  flicker: number;
  droops: number;
} {
  const n = luma.length;
  const base = luma.map((_, i) =>
    median(luma.slice(Math.max(0, i - 12), Math.min(n, i + 13)))
  );
  const dev = luma.map((v, i) => v - base[i]);
  const noise = median(dev.map(Math.abs)) * 1.4826 || 0.5; // MAD → σ
  const thr = Math.max(1.5, 3 * noise);
  const bumps: { start: number; len: number; peak: number }[] = [];
  let i = 0;
  while (i < n) {
    if (dev[i] > thr) {
      let j = i;
      let peak = 0;
      while (j < n && dev[j] > thr) peak = Math.max(peak, dev[j++]);
      bumps.push({ start: i, len: j - i, peak });
      i = j;
    } else i++;
  }
  const blinks = bumps.filter(
    b => b.len >= BLINK_MIN_FRAMES && b.len <= BLINK_MAX_FRAMES
  );
  // A flicker is a blink-sized event squeezed into one frame; a one-frame wobble of half a
  // blink's amplitude is the baseline breathing, and the accepted clip has those too.
  const ampFloor = blinks.length
    ? 0.6 * median(blinks.map(b => b.peak))
    : 2 * thr;
  const flicker = bumps.filter(
    b => b.len < BLINK_MIN_FRAMES && b.peak >= ampFloor
  ).length;
  const droops = bumps.filter(b => b.len > BLINK_MAX_FRAMES).length;
  return { blinks, flicker, droops };
}

type Report = {
  clip: string;
  seconds: number;
  blinks: number;
  blinkRate: number;
  blinkMs: number;
  flicker: number;
  droops: number;
  eyeRest: number;
  eyeRestVsPhoto: number | null;
  eyeFlutter: number;
  headHf: number;
  headRange: number;
  headSpeech: LagScan;
  shoulderRatio: number;
  shoulderCoupling: number;
  browBurst: number;
};

async function analyse(clip: string, photo?: string): Promise<Report> {
  const work = path.join(
    os.tmpdir(),
    `body-audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  mkdirSync(work, { recursive: true });
  try {
    const fr = await bodyFrames(clip, work);
    const n = fr.length;
    const seconds = n / FPS;
    const loud = smooth(loudness(clip, work, n), 1);

    // eyes
    const { blinks, flicker, droops } = findBlinks(fr.map(f => f.eyeLuma));
    const inBlink = new Array(n).fill(false);
    for (const b of blinks)
      for (let k = b.start - 1; k <= b.start + b.len; k++)
        if (k >= 0 && k < n) inBlink[k] = true;
    const openEyes = fr
      .map((f, i) => (inBlink[i] ? NaN : f.eye))
      .filter(v => !Number.isNaN(v));
    const eyeRest = median(openEyes);
    const eyeSteps: number[] = [];
    for (let i = 1; i < n; i++)
      if (!inBlink[i] && !inBlink[i - 1])
        eyeSteps.push(Math.abs(fr[i].eye - fr[i - 1].eye));
    const eyeFlutter = eyeRest > 0 ? median(eyeSteps) / eyeRest : 0;
    const photoEyeV = photo
      ? await photoEye(photo, median(fr.map(f => f.face?.size ?? 0)) || 1)
      : null;

    // head
    const vel = fr.map(f => Math.hypot(f.dx, f.dy));
    const faceSize = median(fr.map(f => f.face?.size ?? 0)) || 1;
    const hfx = highFrequencyFraction(
      fr.map(f => f.dx),
      HEAD_HF_HZ
    );
    const hfy = highFrequencyFraction(
      fr.map(f => f.dy),
      HEAD_HF_HZ
    );
    const headHf = (hfx + hfy) / 2;
    let px = 0;
    let py = 0;
    const posx: number[] = [];
    const posy: number[] = [];
    for (const f of fr) {
      px += f.dx;
      py += f.dy;
      posx.push(px);
      posy.push(py);
    }
    const range = (xs: number[]) => {
      const a = [...xs].sort((x, y) => x - y);
      return a[Math.floor(a.length * 0.95)] - a[Math.floor(a.length * 0.05)];
    };
    const headRange = Math.hypot(range(posx), range(posy)) / faceSize;
    const headSpeech = lagScan(loud, smooth(vel, 2));

    // shoulders, brows
    const headM = fr.map(f => f.head);
    const shM = fr.map(f => f.shoulders);
    const shoulderRatio = mean(headM) > 0 ? mean(shM) / mean(headM) : 0;
    const shoulderCoupling = pearson(smooth(headM, 3), smooth(shM, 3), 0);
    const brM = fr.map(f => f.brows);
    const brMed = median(brM);
    const browBurst =
      brM.filter(v => v > 2 * brMed + 0.5).length / Math.max(1, n);

    return {
      clip,
      seconds,
      blinks: blinks.length,
      blinkRate: (blinks.length * 60) / seconds,
      blinkMs: blinks.length ? (mean(blinks.map(b => b.len)) * 1000) / FPS : 0,
      flicker,
      droops,
      eyeRest,
      eyeRestVsPhoto: photoEyeV ? eyeRest / photoEyeV : null,
      eyeFlutter,
      headHf,
      headRange,
      headSpeech,
      shoulderRatio,
      shoulderCoupling,
      browBurst,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const clip = argv.filter(
  (a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))
)[0];
if (!clip) {
  console.error(
    "usage: npx tsx scripts/measure-host-body.mts <clip.mp4> [--photo host.jpg] [--beside other.mp4]"
  );
  process.exit(2);
}
const photo = opt("--photo");
const besideClip = opt("--beside");
const R = await analyse(clip, photo);
const B = besideClip ? await analyse(besideClip, photo) : null;

const failures: string[] = [];
const f2 = (v: number) => v.toFixed(2);
const pctS = (v: number) => `${Math.round(100 * v)}%`;
console.log(
  `\n  ${clip}   (${R.seconds.toFixed(1)} s)${B ? `\n  beside: ${besideClip}` : ""}\n`
);
console.log(
  `  ${"part".padEnd(10)} ${"measure".padEnd(30)} ${"render".padStart(14)}${B ? `   ${"beside".padStart(14)}` : ""}   human rule`
);
const line = (
  part: string,
  what: string,
  a: string,
  b: string | null,
  rule: string,
  ok: boolean | null,
  fail?: string
) => {
  const mark = ok == null ? "info" : ok ? "PASS" : "FAIL";
  console.log(
    `  ${part.padEnd(10)} ${what.padEnd(30)} ${a.padStart(14)}${B ? `   ${(b ?? "").padStart(14)}` : ""}   ${mark}  ${rule}`
  );
  if (ok === false && fail) failures.push(fail);
};

// eyes
line(
  "eyes",
  "blinks per minute",
  `${R.blinks} (${f2(R.blinkRate)}/min)`,
  B && `${B.blinks} (${f2(B.blinkRate)}/min)`,
  `${BLINK_RATE_MIN}-${BLINK_RATE_MAX}/min while talking; none in ${NO_BLINK_CLIP_SEC}s+ is dead eyes`,
  R.seconds >= NO_BLINK_CLIP_SEC
    ? R.blinkRate >= BLINK_RATE_MIN && R.blinkRate <= BLINK_RATE_MAX
    : R.blinkRate <= BLINK_RATE_MAX,
  R.blinks === 0
    ? `no blink in ${R.seconds.toFixed(1)} s — dead eyes`
    : `blink rate ${f2(R.blinkRate)}/min outside ${BLINK_RATE_MIN}-${BLINK_RATE_MAX}`
);
if (R.blinks)
  line(
    "eyes",
    "blink length",
    `${Math.round(R.blinkMs)} ms`,
    B && (B.blinks ? `${Math.round(B.blinkMs)} ms` : "—"),
    "100-400 ms",
    null
  );
line(
  "eyes",
  "flicker / long closures",
  `${R.flicker} / ${R.droops}`,
  B && `${B.flicker} / ${B.droops}`,
  "one-frame dips are flicker; >400 ms is the eyes closing",
  R.flicker === 0 && R.droops === 0,
  `${R.flicker} one-frame eye flickers, ${R.droops} closures over 400 ms`
);
line(
  "eyes",
  "resting size vs the photo",
  R.eyeRestVsPhoto != null ? pctS(R.eyeRestVsPhoto) : "(no --photo)",
  B && (B.eyeRestVsPhoto != null ? pctS(B.eyeRestVsPhoto) : "—"),
  "the host's own eyes are the target; box-cut bands read the photo ~25% narrower than an accepted clip, so: info until landmarks",
  null
);
line(
  "eyes",
  "flutter between blinks",
  f2(R.eyeFlutter),
  B && f2(B.eyeFlutter),
  `eyes hold still: under ${EYE_FLUTTER_MAX}`,
  R.eyeFlutter <= EYE_FLUTTER_MAX,
  `eyes flutter between blinks (${f2(R.eyeFlutter)} > ${EYE_FLUTTER_MAX})`
);

// head
line(
  "head",
  `energy above ${HEAD_HF_HZ} Hz`,
  pctS(R.headHf),
  B && pctS(B.headHf),
  `a head moves below ~2 Hz; over ${pctS(HEAD_HF_MAX)} up here is jitter`,
  R.headHf <= HEAD_HF_MAX,
  `head jitters: ${pctS(R.headHf)} of its motion is above ${HEAD_HF_HZ} Hz`
);
line(
  "head",
  "travel over the clip / face size",
  pctS(R.headRange),
  B && pctS(B.headRange),
  `${pctS(HEAD_RANGE_MIN)}-${pctS(HEAD_RANGE_MAX)}: not a statue, not swaying`,
  R.headRange >= HEAD_RANGE_MIN && R.headRange <= HEAD_RANGE_MAX,
  R.headRange < HEAD_RANGE_MIN
    ? `head does not move (${pctS(R.headRange)} of face size)`
    : `head sways (${pctS(R.headRange)} of face size)`
);
const hs = R.headSpeech;
line(
  "head",
  "moves with the speech",
  `r ${f2(hs.peakR)} @ ${Math.round(hs.peakLagMs)}ms (far ${f2(hs.farR)})`,
  B &&
    `r ${f2(B.headSpeech.peakR)} @ ${Math.round(B.headSpeech.peakLagMs)}ms (far ${f2(B.headSpeech.farR)})`,
  "people nod on stressed syllables, but not in every 5 s beat — info",
  null
);

// shoulders, brows
line(
  "shoulders",
  "motion relative to the head",
  f2(R.shoulderRatio),
  B && f2(B.shoulderRatio),
  `under ${SHOULDER_RATIO_MAX}: the head sits on the spine`,
  R.shoulderRatio <= SHOULDER_RATIO_MAX,
  `shoulders move more than the head (${f2(R.shoulderRatio)}×)`
);
line(
  "shoulders",
  "follow the head (r)",
  f2(R.shoulderCoupling),
  B && f2(B.shoulderCoupling),
  `over ${SHOULDER_COUPLING_MIN}`,
  R.shoulderCoupling >= SHOULDER_COUPLING_MIN,
  `shoulders move independently of the head (r ${f2(R.shoulderCoupling)})`
);
line(
  "brows",
  "frames in a brow burst",
  pctS(R.browBurst),
  B && pctS(B.browBurst),
  "short bursts on emphasis, not continuous",
  null
);

console.log("");
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("  PASS  eyes, head and shoulders behave like a person's\n");
}

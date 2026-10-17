// scripts/measure-mouth-smear.mts — does the LOWER MOUTH smear when the host opens wide?
//
//   npx tsx scripts/measure-mouth-smear.mts out.jsonl clip1.mp4 [clip2.mp4 ...] [--sheet DIR]
//
// The competitor review (2026-10) noted Frederick's lower teeth "smear a little when his mouth is
// wide open": a lip-sync model has to INVENT the lower lip and teeth when the photo shows a closed
// mouth, and an invented band renders soft and mushy exactly on the open syllables. This puts a
// number on it, with no reference clip needed:
//
//   - the face is tracked (pico, one median box per clip) and two bands are cut each frame: the
//     LOWER MOUTH (lower lip, lower teeth, the top of the chin) and the EYES (a part of the same face
//     the lip-sync model leaves alone, so it carries the clip's own sharpness, focus and compression);
//   - detail = mean |Laplacian| of a band; the per-frame RATIO lower / eyes takes the clip's overall
//     sharpness out, so a soft phone-look photo and a crisp studio photo are judged alike;
//   - "open" frames are the loudest 20% of the voice (the mouth is widest on loud syllables),
//     "closed" frames the quiet ones between words;
//   - smear = median ratio on OPEN frames / median ratio on CLOSED frames. A mouth that keeps its
//     edges when it opens (real teeth and lip lines appear) reads ≥ 1; one that turns to mush reads
//     under 1. `flicker` is how much the lower band changes frame to frame on open frames against
//     the eyes band — invented teeth are redrawn every frame and shimmer.
//
// PASS: smear ≥ SMEAR_MIN (0.90) and flicker ≤ FLICKER_MAX (3.0). Judge a photo on the median of
// several clips (HeyGen renders of one input vary). --sheet writes a contact sheet of the six
// widest-open mouths per clip, 3x, so a person can see what the number says.

import "dotenv/config";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { detectFaces } from "../server/pico";
import { readFileSync } from "node:fs";
import { compareLowerMouth, mouthVerdictPasses } from "../server/hostPhotoScore";
const require = createRequire(import.meta.url);
const FF: string = require("ffmpeg-static");

export const SMEAR_MIN = 0.9;
export const TEETH_MIN = 0.85;
/** The judged lower mouth (1-5) a clip must reach. */
export const LOWER_MOUTH_MIN = 4;
export const FLICKER_MAX = 3.0;

const FPS = 25, W = 1280, H = 720;
const args = process.argv.slice(2);
const si = args.indexOf("--sheet");
const SHEET = si >= 0 ? args.splice(si, 2)[1] : undefined;
const nj = args.indexOf("--no-judge");
const NO_JUDGE = nj >= 0 ? !!args.splice(nj, 1) : false;
// --reference SHEET.jpg: the BENCHMARK's mouth sheet (Bertha) each clip is compared with
const ri = args.indexOf("--reference");
const REFERENCE = ri >= 0 ? readFileSync(args.splice(ri, 2)[1]) : undefined;
const [OUT, ...clips] = args;

const run = (a: string[]) => new Promise<Buffer>((res, rej) => {
  const p = spawn(FF, ["-hide_banner", "-loglevel", "error", ...a]);
  const chunks: Buffer[] = []; let err = "";
  p.stdout.on("data", d => chunks.push(d)); p.stderr.on("data", d => (err += d));
  p.on("close", c => (c ? rej(new Error(err.slice(-300))) : res(Buffer.concat(chunks))));
});
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

interface Band { x0: number; y0: number; x1: number; y1: number }
const clampBand = (b: Band): Band => ({
  x0: Math.max(1, Math.round(b.x0)), y0: Math.max(1, Math.round(b.y0)),
  x1: Math.min(W - 2, Math.round(b.x1)), y1: Math.min(H - 2, Math.round(b.y1)),
});
/** Mean |4-neighbour Laplacian| over a band of one frame. */
function detail(raw: Buffer, f: number, b: Band): number {
  const o = f * W * H; let s = 0, n = 0;
  for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
    const p = o + y * W + x;
    s += Math.abs(4 * raw[p] - raw[p - 1] - raw[p + 1] - raw[p - W] - raw[p + W]); n++;
  }
  return n ? s / n : 0;
}
/** Mean |frame f − frame f−1| over a band. */
function change(raw: Buffer, f: number, b: Band): number {
  if (!f) return 0;
  const o = f * W * H, q = (f - 1) * W * H; let s = 0, n = 0;
  for (let y = b.y0; y < b.y1; y += 2) for (let x = b.x0; x < b.x1; x += 2) { s += Math.abs(raw[o + y * W + x] - raw[q + y * W + x]); n++; }
  return n ? s / n : 0;
}

/**
 * Teeth edges in one open-mouth frame. The teeth are found FROM THE MOUTH OPENING, not from the
 * brightest pixels of the box: on a white or grey beard (Dale, Hank) the brightest pixels are beard
 * hair, which read as a flat "lower row" and scored every photo of theirs as smeared (2026-10-16).
 * The opening is the dark interior (the darkest pixels in the middle of the box); the teeth are the
 * bright pixels just above it (upper row) and just below it (lower row), within the opening's own
 * width. Real teeth have a gap between each tooth — strong left-right edges; a smeared row is a
 * flat white band. Returns lower / upper mean horizontal gradient, or null when the mouth is not
 * open with both rows showing.
 */
function teethRatio(raw: Buffer, f: number, b: Band): number | null {
  const o = f * W * H, w = b.x1 - b.x0, h = b.y1 - b.y0;
  const at = (x: number, y: number) => raw[o + (b.y0 + y) * W + b.x0 + x];
  const vals: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) vals.push(at(x, y));
  const sorted = [...vals].sort((p, q) => p - q);
  const dark = Math.min(sorted[Math.floor(sorted.length * 0.1)], 70);
  // the opening: dark pixels in the middle 70% of the box
  const cx0 = Math.floor(w * 0.15), cx1 = Math.ceil(w * 0.85);
  let top = h, bottom = -1, left = w, right = -1, count = 0;
  for (let y = 0; y < h; y++)
    for (let x = cx0; x < cx1; x++)
      if (at(x, y) <= dark) {
        count++;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
  if (count < 30 || bottom - top < 3 || right - left < 10) return null;
  const mid = (top + bottom) >> 1;
  const reach = Math.max(4, Math.round((bottom - top) * 0.9));
  const bright = Math.max(sorted[Math.floor(sorted.length * 0.85)], sorted[sorted.length >> 1] + 30);
  const grad = (y0: number, y1: number) => {
    let s2 = 0, n = 0;
    for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++)
      for (let x = Math.max(1, left); x < Math.min(w - 1, right + 1); x++) {
        if (at(x, y) < bright) continue;
        s2 += Math.abs(at(x + 1, y) - at(x - 1, y));
        n++;
      }
    return n >= 15 ? s2 / n : null;
  };
  const up = grad(top - reach, mid);
  const lo = grad(mid + 1, bottom + reach + 1);
  return up && lo ? lo / up : null;
}

async function measure(clip: string) {
  const pcm = await run(["-i", clip, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]);
  const sm = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1);
  const hop = 16000 / FPS; const db: number[] = [];
  for (let i = 0; i + hop <= sm.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += sm[i + j] * sm[i + j]; db.push(20 * Math.log10(Math.sqrt(s / hop) + 1)); }

  const raw = await run(["-i", clip, "-an", "-vf", `fps=${FPS},scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"]);
  const n = Math.floor(raw.length / (W * H));
  const hw = W / 2, hh = H / 2, half = new Uint8Array(hw * hh);
  const boxes: { x: number; y: number; size: number }[] = [];
  for (let f = 0; f < n; f += 5) {
    const o = f * W * H;
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const p = o + 2 * y * W + 2 * x;
      half[y * hw + x] = (raw[p] + raw[p + 1] + raw[p + W] + raw[p + W + 1]) >> 2;
    }
    const faces = detectFaces(half, hw, hh).filter(b => b.size >= 50).sort((a, b) => b.q - a.q);
    if (faces.length) boxes.push({ x: faces[0].x * 2, y: faces[0].y * 2, size: faces[0].size * 2 });
  }
  if (boxes.length < 3) return { clip: path.basename(clip), ok: false, why: "face not found" };
  const cx = median(boxes.map(b => b.x)), cy = median(boxes.map(b => b.y)), s = median(boxes.map(b => b.size));
  const lower = clampBand({ x0: cx - 0.2 * s, x1: cx + 0.2 * s, y0: cy + 0.3 * s, y1: cy + 0.5 * s });
  const eyes = clampBand({ x0: cx - 0.32 * s, x1: cx + 0.32 * s, y0: cy - 0.22 * s, y1: cy - 0.06 * s });

  const L = Math.min(n, db.length);
  const order = [...Array(L).keys()].sort((a, b) => db[a] - db[b]);
  const loudFloor = db[order[Math.floor(L * 0.8)]];
  const top = db[order[Math.floor(L * 0.97)]];
  const open = order.filter(f => db[f] >= loudFloor);
  const closed = order.filter(f => db[f] < top - 30 || db[f] <= db[order[Math.floor(L * 0.15)]]);
  const ratio = (f: number) => detail(raw, f, lower) / Math.max(1e-6, detail(raw, f, eyes));
  const rOpen = median(open.map(ratio)), rClosed = median(closed.map(ratio));
  const flick = median(open.filter(f => f > 0).map(f => change(raw, f, lower) / Math.max(0.5, change(raw, f, eyes))));
  const mouthBox = clampBand({ x0: cx - 0.17 * s, x1: cx + 0.17 * s, y0: cy + 0.24 * s, y1: cy + 0.47 * s });
  const teeth = open.map(f => teethRatio(raw, f, mouthBox)).filter((r): r is number => r != null);
  const teethEdges = teeth.length >= 4 ? median(teeth) : null;
  const smear = rClosed ? rOpen / rClosed : 0;

  // the six WIDEST-OPEN frames among the loud ones (the most dark mouth opening), for the judge and
  // the contact sheet — loudness alone also picks frames on a closed "m"
  const openness = (fr: number) => {
    const o = fr * W * H; let n2 = 0;
    for (let y = mouthBox.y0; y < mouthBox.y1; y++) for (let x = mouthBox.x0; x < mouthBox.x1; x++) if (raw[o + y * W + x] < 60) n2++;
    return n2;
  };
  const loud = order.filter(fr => db[fr] >= db[order[Math.floor(L * 0.6)]]);
  const widest = loud.map(fr => [fr, openness(fr)] as const).sort((a2, b2) => b2[1] - a2[1]);
  const pickFrames: number[] = [];
  for (const [fr] of widest) {
    if (pickFrames.every(p2 => Math.abs(p2 - fr) >= 8)) pickFrames.push(fr);
    if (pickFrames.length === 6) break;
  }
  let verdict: { verdict: string | null; what: string } = { verdict: null, what: "" };
  {
    const pick = pickFrames.sort((a, b) => a - b);
    const cw = Math.round(0.7 * s), ch = Math.round(0.55 * s);
    const left = Math.max(0, Math.round(cx - cw / 2)), topY = Math.max(0, Math.round(cy + 0.05 * s));
    // in COLOUR, at 2x: the judge compares lips and teeth, which grey upscales flatten
    const tiles = await Promise.all(pick.map(async fr => {
      const png = await run(["-ss", (fr / FPS).toFixed(3), "-i", clip, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-f", "image2pipe", "-vcodec", "png", "-"]);
      return sharp(png)
        .extract({ left, top: topY, width: Math.min(cw, W - left), height: Math.min(ch, H - topY) })
        .resize({ width: cw * 2 }).png().toBuffer();
    }));
    const meta = await sharp(tiles[0]).metadata();
    const sheet = await sharp({ create: { width: meta.width! * tiles.length, height: meta.height!, channels: 3, background: "#000" } })
      .composite(tiles.map((t, i) => ({ input: t, left: i * meta.width!, top: 0 })))
      .jpeg({ quality: 88 }).toBuffer();
    if (SHEET) {
      mkdirSync(SHEET, { recursive: true });
      await sharp(sheet).toFile(path.join(SHEET, path.basename(clip).replace(/.mp4$/i, "-mouth.jpg")));
    }
    if (!NO_JUDGE && REFERENCE && tiles.length) verdict = await compareLowerMouth(REFERENCE, sheet);
  }
  return {
    clip: path.basename(clip), ok: true, frames: n, faceSize: Math.round(s),
    lowerMouth: verdict.verdict, lowerMouthWhat: verdict.what,
    teethEdges: teethEdges == null ? null : +teethEdges.toFixed(3), teethFrames: teeth.length,
    smear: +smear.toFixed(3), flicker: +flick.toFixed(2),
    openRatio: +rOpen.toFixed(3), closedRatio: +rClosed.toFixed(3),
    // the judged lower mouth decides; the tooth-edge reading is reported but fails on beards
    pass: verdict.verdict != null ? mouthVerdictPasses(verdict.verdict as any) : (teethEdges == null || teethEdges >= TEETH_MIN) && flick <= FLICKER_MAX,
  };
}

for (const c of clips) {
  let r: any;
  try { r = await measure(c); } catch (e: any) { r = { clip: path.basename(c), ok: false, why: String(e?.message ?? e).slice(0, 200) }; }
  appendFileSync(OUT, JSON.stringify(r) + "\n");
  console.log(JSON.stringify(r));
}

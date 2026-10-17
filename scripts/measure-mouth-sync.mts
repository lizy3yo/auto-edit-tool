// scripts/measure-mouth-sync.mts — does the host's mouth move WITH the voice?
//
//   npx tsx scripts/measure-mouth-sync.mts out.jsonl clip1.mp4 [clip2.mp4 ...]   (--shift 1 delays the audio, a control)
//
// The measure used on the competitor review (2026-10, Bertha Ramirez / Steve Cooper / Wes
// Kingfisher against our channels), kept so a voice or lip-sync change is judged on the same
// ruler. Works on any face (beard or not): it tracks the face, reads how the mouth region changes
// frame to frame minus what the cheeks share, and correlates that with the voice's loudness over
// ±1 s of lag. peakR (within ±240 ms) is how well the mouth follows the voice, peakLagMs is the
// offset (positive = the mouth moves AFTER the sound), farR (≥ 560 ms away) is the out-of-sync
// control, and moveSilent / moveTalking is how much the mouth moves while nothing is said.
// A clip PASSES at peakR ≥ 0.15, peakR − farR ≥ 0.08 and |lag| ≤ 160 ms — the rule the review
// scored Bertha by (14 of 24 of her clips pass).

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { detectFaces } from "../server/pico";
const require = createRequire(import.meta.url);
const FF: string = require("ffmpeg-static");

const FPS = 25, W = 1280, H = 720, CW = 48, CH = 30;
const args = process.argv.slice(2);
const si = args.indexOf("--shift");
const SHIFT = si >= 0 ? +args.splice(si, 2)[1] : 0;
const [OUT, ...clips] = args;

const run = (a: string[]) => new Promise<Buffer>((res, rej) => {
  const p = spawn(FF, ["-hide_banner", "-loglevel", "error", ...a]);
  const chunks: Buffer[] = []; let err = "";
  p.stdout.on("data", d => chunks.push(d)); p.stderr.on("data", d => (err += d));
  p.on("close", c => (c ? rej(new Error(err.slice(-300))) : res(Buffer.concat(chunks))));
});
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pearson = (a: number[], b: number[]) => {
  const n = a.length; if (n < 20) return 0;
  let sa = 0, sb = 0; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n; let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
};
/** r between mouth[t] and voice[t - lag]: positive lag = the mouth moves after the sound. */
const scan = (mouth: number[], voice: number[]) => {
  const out: { lagMs: number; r: number }[] = [];
  for (let lag = -25; lag <= 25; lag++) {
    const a: number[] = [], b: number[] = [];
    for (let t = 0; t < mouth.length; t++) { const u = t - lag; if (u >= 0 && u < voice.length) { a.push(mouth[t]); b.push(voice[u]); } }
    out.push({ lagMs: lag * 40, r: pearson(a, b) });
  }
  return out;
};
const smooth = (a: number[], k: number) => a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) { s += a[j]; n++; } return s / n; });

async function measure(clip: string) {
  // voice: loudness per video frame
  const pcm = await run(["-i", clip, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]);
  const sm = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1);
  const hop = 16000 / FPS; const rms: number[] = [];
  for (let i = 0; i + hop <= sm.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += sm[i + j] * sm[i + j]; rms.push(Math.sqrt(s / hop)); }
  const top = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.95)] || 1;
  let voice = rms.map(v => Math.max(0, 20 * Math.log10((v + 1) / top) + 30)); // 0 = 30 dB under the loud parts
  if (SHIFT) voice = [...new Array(Math.round(SHIFT * FPS)).fill(0), ...voice];

  // picture: face track, then a small mouth crop and a nose/cheek crop per frame
  const raw = await run(["-i", clip, "-an", "-vf", `fps=${FPS},scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"]);
  const n = Math.floor(raw.length / (W * H));
  const boxes: ({ x: number; y: number; size: number } | null)[] = [];
  const hw = W / 2, hh = H / 2, half = new Uint8Array(hw * hh);
  for (let f = 0; f < n; f++) {
    const o = f * W * H;
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const p = o + 2 * y * W + 2 * x;
      half[y * hw + x] = (raw[p] + raw[p + 1] + raw[p + W] + raw[p + W + 1]) >> 2;
    }
    if (f % 3) { boxes.push(null); continue; }
    const faces = detectFaces(half, hw, hh).filter(b => b.size >= 60).sort((a, b) => b.q - a.q);
    boxes.push(faces.length ? { x: faces[0].x * 2, y: faces[0].y * 2, size: faces[0].size * 2 } : null);
  }
  const found = boxes.filter(Boolean).length;
  if (found < (n / 3) * 0.6 && process.env.BOX) {
    // The detector misses some faces (a full beard under glasses). BOX="x,y,size" (1280x720) places
    // the face on frame 0, and the box then FOLLOWS the head: the upper face (eyes, brows — no
    // mouth in it, so speech does not drag it) is matched frame to frame within ±30 px. A box held
    // still reads the head's own movement as mouth movement and invents a lag.
    const [bx, by, bs] = process.env.BOX.split(",").map(Number);
    const G = 24, patch = (f: number, cx: number, cy: number) => {
      const out = new Float32Array(G * G); const o = f * W * H; let sum = 0;
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
        const px = Math.min(W - 1, Math.max(0, Math.round(cx - bs * 0.35 + (x * bs * 0.7) / G)));
        const py = Math.min(H - 1, Math.max(0, Math.round(cy - bs * 0.45 + (y * bs * 0.4) / G)));
        sum += out[y * G + x] = raw[o + py * W + px];
      }
      const m = sum / out.length; for (let i = 0; i < out.length; i++) out[i] -= m;
      return out;
    };
    const ref = patch(0, bx, by);
    let cx = bx, cy = by;
    for (let f = 0; f < n; f++) {
      let best = Infinity, bxx = cx, byy = cy;
      for (let dy = -9; dy <= 9; dy += 3) for (let dx = -9; dx <= 9; dx += 3) {
        const x = Math.min(bx + 30, Math.max(bx - 30, cx + dx)), y = Math.min(by + 30, Math.max(by - 30, cy + dy));
        const p = patch(f, x, y); let d = 0;
        for (let i = 0; i < p.length; i++) d += Math.abs(p[i] - ref[i]);
        if (d < best) { best = d; bxx = x; byy = y; }
      }
      cx = bxx; cy = byy;
      boxes[f] = { x: cx, y: cy, size: bs };
    }
  }
  else if (found < (n / 3) * 0.6) return { clip: path.basename(clip), ok: false, why: "face not found", found, frames: n };
  const sizeMed = median(boxes.filter(Boolean).map(b => b!.size));
  // keep one face (drop boxes of a very different size), fill gaps, smooth the track
  let last = boxes.find(b => b && Math.abs(b.size - sizeMed) < sizeMed * 0.3)!;
  const tr = boxes.map(b => (last = b && Math.abs(b.size - sizeMed) < sizeMed * 0.3 ? b : last));
  const med = (k: "x" | "y", i: number) => median(tr.slice(Math.max(0, i - 6), i + 7).map(b => b[k]));
  const crop = (f: number, cx: number, top: number, w: number, h: number) => {
    const out = new Float32Array(CW * CH); const o = f * W * H; let sum = 0;
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const px = Math.min(W - 1, Math.max(0, Math.round(cx - w / 2 + ((x + 0.5) * w) / CW)));
      const py = Math.min(H - 1, Math.max(0, Math.round(top + ((y + 0.5) * h) / CH)));
      const v = (raw[o + py * W + px] + raw[o + py * W + Math.min(W - 1, px + 1)] + raw[o + Math.min(H - 1, py + 1) * W + px]) / 3;
      out[y * CW + x] = v; sum += v;
    }
    const m = sum / out.length; for (let i = 0; i < out.length; i++) out[i] -= m; // lighting changes out
    return out;
  };
  const mouthCrops: Float32Array[] = [], cheekCrops: Float32Array[] = [];
  for (let f = 0; f < n; f++) {
    const x = med("x", f), y = med("y", f), s = sizeMed;
    mouthCrops.push(crop(f, x, y + s * 0.2, s * 0.46, s * 0.3));
    cheekCrops.push(crop(f, x, y - s * 0.12, s * 0.46, s * 0.3));
  }
  const diff = (c: Float32Array[]) => c.map((v, i) => { if (!i) return 0; let s = 0; for (let k = 0; k < v.length; k++) s += Math.abs(v[k] - c[i - 1][k]); return s / v.length; });
  const mm = diff(mouthCrops), cm = diff(cheekCrops);
  // mouth movement that the rest of the face does not share
  const motion = smooth(mm.map((v, i) => Math.max(0, v - cm[i])), 1);
  // the main way the mouth picture changes over the clip (opening and closing)
  const T = n, D = CW * CH; const mean = new Float32Array(D);
  for (const c of mouthCrops) for (let k = 0; k < D; k++) mean[k] += c[k] / T;
  let pc = new Float32Array(D).map((_, k) => Math.sin(k * 12.9898) * 0.5);
  for (let it = 0; it < 0; it++) {
    const next = new Float32Array(D);
    for (const c of mouthCrops) { let d = 0; for (let k = 0; k < D; k++) d += (c[k] - mean[k]) * pc[k]; for (let k = 0; k < D; k++) next[k] += d * (c[k] - mean[k]); }
    let nn = 0; for (let k = 0; k < D; k++) nn += next[k] * next[k]; nn = Math.sqrt(nn) || 1;
    for (let k = 0; k < D; k++) next[k] /= nn; pc = next;
  }
  const shape = mouthCrops.map(c => { let d = 0; for (let k = 0; k < D; k++) d += (c[k] - mean[k]) * pc[k]; return d; });

  const L = Math.min(n, voice.length);
  const v = smooth(voice.slice(0, L), 1);
  const read = (sig: number[], signed: boolean) => {
    const sc = scan(sig.slice(0, L), v).map(p => ({ lagMs: p.lagMs, r: signed ? p.r : Math.abs(p.r) }));
    const near = sc.filter(p => Math.abs(p.lagMs) <= 240), far = sc.filter(p => Math.abs(p.lagMs) >= 560);
    const peak = near.reduce((a, b) => (b.r > a.r ? b : a));
    const best = sc.reduce((a, b) => (b.r > a.r ? b : a));
    return { curve: signed ? sc.map(p => +p.r.toFixed(3)) : undefined, peakR: +peak.r.toFixed(3), peakLagMs: peak.lagMs, farR: +Math.max(...far.map(p => p.r)).toFixed(3), bestLagMs: best.lagMs, bestR: +best.r.toFixed(3) };
  };
  const talk = v.filter(x => x > 8).length / L;
  // how much the mouth moves while talking against while silent
  const mt = motion.slice(0, L).filter((_, i) => v[i] > 8), ms = motion.slice(0, L).filter((_, i) => v[i] <= 2);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    clip: path.basename(clip), ok: true, frames: n, found, box: [Math.round(median(tr.map(b => b.x))), Math.round(median(tr.map(b => b.y)))], faceSize: Math.round(sizeMed), talkShare: +talk.toFixed(2),
    motion: read(motion, true), shape: read(shape, false),
    moveTalking: +avg(mt).toFixed(3), moveSilent: ms.length >= 5 ? +avg(ms).toFixed(3) : null,
  };
}

const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).clip + "|" + (JSON.parse(l).shift ?? 0)) : []);
for (const c of clips) {
  if (done.has(path.basename(c) + "|" + SHIFT)) continue;
  let r: any;
  try { r = await measure(c); } catch (e: any) { r = { clip: path.basename(c), ok: false, why: String(e?.message ?? e).slice(0, 200) }; }
  r.shift = SHIFT;
  appendFileSync(OUT, JSON.stringify(r) + "\n");
  console.log(JSON.stringify(r));
}

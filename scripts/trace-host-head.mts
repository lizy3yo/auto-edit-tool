/**
 * scripts/trace-host-head.mts — HOW a talking head moves, not only how much (2026-10-16).
 *
 *   npx tsx scripts/trace-host-head.mts out.png clip1.mp4 [clip2.mp4 ...]   (BOX="x,y,size" for a face the detector misses)
 *
 * `measure-host-body.mts` gives a head's total travel and its share of fast (>4 Hz) jitter; two
 * clips can score alike there and still move very differently — a slow nod, a continuous sway, or
 * a jerky start-stop. This follows the head every frame (the upper face matched against its first
 * frame, as `measure-mouth-open.mts` does, so a beard or a moving mouth cannot drag it) and:
 *   - prints, per clip, side-to-side and up-down travel (% of face size), how much of the motion is
 *     slow (under 1.5 Hz: nods, tilts, settling) versus quicker, and JERK — how abruptly the head
 *     speeds up and slows down, the measure a person reads as "not smooth";
 *   - draws each clip's x and y over time, one row per clip, on the same scale, into out.png.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { detectFaces } from "../server/pico";

const FF: string = createRequire(import.meta.url)("ffmpeg-static");
const FPS = 25, W = 640, H = 360, G = 20;
const [OUT, ...clips] = process.argv.slice(2);

function frames(clip: string): { buf: Buffer; n: number } {
  const r = spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-i", clip, "-an", "-vf", `fps=${FPS},scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 });
  return { buf: r.stdout, n: Math.floor(r.stdout.length / (W * H)) };
}

/** The head's centre on every frame, in pixels, and its size. */
function track(clip: string) {
  const { buf, n } = frames(clip);
  let face: { x: number; y: number; size: number } | undefined;
  for (let f = 0; f < Math.min(n, 75) && !face; f += 5) {
    const d = detectFaces(new Uint8Array(buf.subarray(f * W * H, (f + 1) * W * H)), W, H).filter(b => b.size >= 30).sort((a, b) => b.q - a.q)[0];
    if (d) face = { x: d.x, y: d.y, size: d.size };
  }
  if (!face && process.env.BOX) {
    const [x, y, s] = process.env.BOX.split(",").map(Number);
    face = { x: x / 2, y: y / 2, size: s / 2 }; // BOX is given at 1280x720
  }
  if (!face) throw new Error("no face found (set BOX)");
  const bs = face.size;
  // the upper face (eyes and brows, no mouth), mean-removed
  const patch = (f: number, cx: number, cy: number) => {
    const out = new Float32Array(G * G); const o = f * W * H; let sum = 0;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const px = Math.min(W - 1, Math.max(0, Math.round(cx - bs * 0.4 + (x * bs * 0.8) / G)));
      const py = Math.min(H - 1, Math.max(0, Math.round(cy - bs * 0.45 + (y * bs * 0.4) / G)));
      sum += out[y * G + x] = buf[o + py * W + px];
    }
    const m = sum / out.length; for (let i = 0; i < out.length; i++) out[i] -= m;
    return out;
  };
  const ref = patch(0, face.x, face.y);
  const xs: number[] = [], ys: number[] = [];
  let tx = face.x, ty = face.y;
  for (let f = 0; f < n; f++) {
    let best = Infinity, bx = tx, by = ty;
    // half-pixel search around the last position
    for (let dy = -6; dy <= 6; dy += 0.5) for (let dx = -6; dx <= 6; dx += 0.5) {
      const p = patch(f, tx + dx, ty + dy); let d = 0;
      for (let k = 0; k < p.length; k++) d += Math.abs(p[k] - ref[k]);
      if (d < best) { best = d; bx = tx + dx; by = ty + dy; }
    }
    tx = bx; ty = by; xs.push(tx); ys.push(ty);
  }
  return { xs, ys, size: bs, n };
}

const smooth = (a: number[], r: number) => a.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) { s += a[j]; c++; } return s / c; });
const sd = (a: number[]) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

function stats(t: ReturnType<typeof track>) {
  const pct = (v: number) => +((100 * v) / t.size).toFixed(1);
  const range = (a: number[]) => Math.max(...a) - Math.min(...a);
  // a 0.33 s running mean keeps what is under ~1.5 Hz; the rest is the quicker motion
  const slowX = smooth(t.xs, 4), slowY = smooth(t.ys, 4);
  const fastE = sd(t.xs.map((v, i) => v - slowX[i])) ** 2 + sd(t.ys.map((v, i) => v - slowY[i])) ** 2;
  const allE = sd(t.xs) ** 2 + sd(t.ys) ** 2 || 1;
  // jerk on the lightly smoothed path (tracker noise out): third difference, per second cubed, % of face
  const jx = smooth(t.xs, 1), jy = smooth(t.ys, 1);
  let jerk = 0;
  for (let i = 3; i < jx.length; i++) {
    const a = jx[i] - 3 * jx[i - 1] + 3 * jx[i - 2] - jx[i - 3], b = jy[i] - 3 * jy[i - 1] + 3 * jy[i - 2] - jy[i - 3];
    jerk += Math.hypot(a, b);
  }
  jerk = (jerk / Math.max(1, jx.length - 3)) * FPS ** 3 / t.size;
  return {
    sideToSide: pct(range(slowX)),
    upDown: pct(range(slowY)),
    slowShare: +(100 * Math.max(0, 1 - fastE / allE)).toFixed(0),
    jerk: +jerk.toFixed(1),
  };
}

const rows: { name: string; t: ReturnType<typeof track> }[] = [];
for (const c of clips) {
  try {
    const t = track(c);
    rows.push({ name: path.basename(c, ".mp4"), t });
    const s = stats(t);
    console.log(`${path.basename(c, ".mp4").padEnd(30)} side-to-side ${String(s.sideToSide).padStart(5)}% | up-down ${String(s.upDown).padStart(5)}% | slow motion ${String(s.slowShare).padStart(3)}% | jerk ${s.jerk}`);
  } catch (e: any) {
    console.log(`${path.basename(c, ".mp4").padEnd(30)} ${e.message}`);
  }
}

// the plot: one row per clip, x (blue) and y (orange) as % of face size around their mean, 6 s
const PW = 900, PH = 110, SEC = 6, SCALE = 40; // ±40% of face size fills the row
const lines = rows.map((r, i) => {
  const top = i * PH;
  const pts = (a: number[]) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return a.slice(0, SEC * FPS).map((v, k) => `${((k / (SEC * FPS)) * PW).toFixed(1)},${(top + PH / 2 - (((v - m) / r.t.size) * 100 * (PH / 2)) / SCALE).toFixed(1)}`).join(" ");
  };
  return `<rect x="0" y="${top}" width="${PW}" height="${PH - 2}" fill="${i % 2 ? "#f4f4f0" : "#fff"}"/>` +
    `<line x1="0" x2="${PW}" y1="${top + PH / 2}" y2="${top + PH / 2}" stroke="#ccc"/>` +
    `<polyline fill="none" stroke="#2563eb" stroke-width="1.6" points="${pts(r.t.xs)}"/>` +
    `<polyline fill="none" stroke="#ea580c" stroke-width="1.6" points="${pts(r.t.ys)}"/>` +
    `<text x="6" y="${top + 16}" font-family="Arial" font-size="13" fill="#111">${r.name}</text>`;
}).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${rows.length * PH + 22}"><rect width="100%" height="100%" fill="#fff"/>${lines}` +
  `<text x="6" y="${rows.length * PH + 16}" font-family="Arial" font-size="12" fill="#333">blue = side to side, orange = up and down; ±40% of face size per row; first ${SEC} s</text></svg>`;
await sharp(Buffer.from(svg)).png().toFile(OUT);
console.log(`plot: ${OUT}`);
process.exit(0);

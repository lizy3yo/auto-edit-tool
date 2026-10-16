// scripts/measure-mouth-open.mts — is the mouth open when the voice speaks, and closed when it is
// silent? A blind visual check of lip-sync (2026-10-16).
//
//   npx tsx scripts/measure-mouth-open.mts out.jsonl clip1.mp4 [clip2.mp4 ...]    (BOX="x,y,size" for a face the detector misses)
//
// The pixel measures of lip-sync (frame-to-frame change in the mouth box, or the dark opening's
// size) are fooled by a white beard and by head movement: on Dale they swung from take to take in a
// way no mouth does, and the dark-pixel version even failed Bertha. This asks what a person checks
// by eye. Six mouth close-ups from the LOUDEST spoken moments and six from real SILENCES (≥ 240 ms
// of quiet, taken from the middle) are laid out in two rows, the order of the rows SHUFFLED per clip,
// and a vision model is asked which row shows the open, speaking mouth. Three votes. A clip passes
// when every vote picks the speaking row — the mouth opens with the words and closes when they stop.
import "dotenv/config";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { detectFaces } from "../server/pico";
import { invokeClaude } from "../server/claude";
const require = createRequire(import.meta.url);
const FF: string = require("ffmpeg-static");

const FPS = 25, W = 1280, H = 720;
const [OUT, ...clips] = process.argv.slice(2);
const run = (a: string[]) => new Promise<Buffer>((res, rej) => {
  const p = spawn(FF, ["-hide_banner", "-loglevel", "error", ...a]);
  const c: Buffer[] = []; let e = "";
  p.stdout.on("data", d => c.push(d)); p.stderr.on("data", d => (e += d));
  p.on("close", code => (code ? rej(new Error(e.slice(-300))) : res(Buffer.concat(c))));
});

export const OPEN_ROW_SYSTEM =
  "You see two rows of close-ups of one person's mouth from a talking-head video. In one row the " +
  "person is speaking out loud; in the other the person is silent between sentences. Which row is " +
  "the SPEAKING row — the one where the mouth is open, lips apart, mid-word? If the mouth looks the " +
  "same in both rows, say so.\n" +
  'Return ONLY JSON: {"speaking":"A"|"B"|"same","what":"<a few words>"}';

async function measure(clip: string) {
  const pcm = await run(["-i", clip, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]);
  const sm = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1);
  const hop = 16000 / FPS; const voice: number[] = [];
  for (let i = 0; i + hop <= sm.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += sm[i + j] * sm[i + j]; voice.push(Math.sqrt(s / hop)); }
  const top = [...voice].sort((a, b) => a - b)[Math.floor(voice.length * 0.95)] || 1;
  const v = voice.map(x => 20 * Math.log10((x + 1) / top));
  const n = v.length;
  // silences: runs of ≥ 6 frames (240 ms) at least 30 dB under the loud parts; their middle frame
  const silent: number[] = [];
  for (let i = 0; i < n; ) {
    if (v[i] > -30) { i++; continue; }
    let j = i; while (j < n && v[j] <= -30) j++;
    if (j - i >= 6 && i > 3) silent.push((i + j) >> 1);
    i = j;
  }
  // loud: the loudest frames, at least 8 frames apart
  const loud: number[] = [];
  for (const f of [...v.keys()].sort((a, b) => v[b] - v[a])) {
    if (loud.every(g => Math.abs(g - f) >= 8)) loud.push(f);
    if (loud.length === 6) break;
  }
  if (silent.length < 3) return { clip: path.basename(clip), ok: false, why: "fewer than 3 silences" };
  const quiet = silent.length > 6 ? silent.filter((_, i) => i % Math.ceil(silent.length / 6) === 0).slice(0, 6) : silent;

  // the face on each picked frame: the detector, else BOX followed by the upper-face template
  const frame = async (f: number) => run(["-ss", (f / FPS).toFixed(3), "-i", clip, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-f", "image2pipe", "-vcodec", "png", "-"]);
  // the first frame (of the first three seconds, every half second) the detector sees a face on —
  // frame 0 alone missed Granny Ruth on two of three takes (2026-10-16)
  let f0: ReturnType<typeof detectFaces>[number] | undefined, refFrame = 0;
  for (let t = 0; t <= 3 && !f0; t += 0.5) {
    const g = await sharp(await frame(Math.round(t * FPS))).greyscale().resize(640, 360).raw().toBuffer();
    f0 = detectFaces(new Uint8Array(g), 640, 360).filter(b => b.size >= 30).sort((a, b) => b.q - a.q)[0];
    if (f0) refFrame = Math.round(t * FPS);
  }
  const [bx0, by0, bs] = f0 ? [f0.x * 2, f0.y * 2, f0.size * 2] : (process.env.BOX ?? "").split(",").map(Number);
  if (!bs) return { clip: path.basename(clip), ok: false, why: "face not found (set BOX)" };
  // the face on every frame: the detector where it sees it, else the upper face (eyes, brows — no
  // mouth in it) FOLLOWED from frame 0 by template matching, as measure-mouth-sync does — a box
  // held still slid onto the beard when Dale moved his head (2026-10-16)
  const raw = await run(["-i", clip, "-an", "-vf", `fps=${FPS},scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"]);
  const nf = Math.floor(raw.length / (W * H));
  const G = 24;
  const patch = (f: number, cx: number, cy: number) => {
    const out = new Float32Array(G * G); const o = f * W * H; let sum = 0;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const px = Math.min(W - 1, Math.max(0, Math.round(cx - bs * 0.35 + (x * bs * 0.7) / G)));
      const py = Math.min(H - 1, Math.max(0, Math.round(cy - bs * 0.45 + (y * bs * 0.4) / G)));
      sum += out[y * G + x] = raw[o + py * W + px];
    }
    const m = sum / out.length; for (let i = 0; i < out.length; i++) out[i] -= m;
    return out;
  };
  const ref = patch(Math.min(refFrame, nf - 1), bx0, by0);
  const track: [number, number][] = [];
  let tx = bx0, ty = by0;
  for (let f = 0; f < nf; f++) {
    let best = Infinity, bx = tx, by = ty;
    for (let dy = -10; dy <= 10; dy += 2) for (let dx = -10; dx <= 10; dx += 2) {
      const x = Math.min(bx0 + 70, Math.max(bx0 - 70, tx + dx)), y = Math.min(by0 + 70, Math.max(by0 - 70, ty + dy));
      const p = patch(f, x, y); let d = 0; for (let k = 0; k < p.length; k++) d += Math.abs(p[k] - ref[k]);
      if (d < best) { best = d; bx = x; by = y; }
    }
    tx = bx; ty = by; track.push([tx, ty]);
  }
  const crop = async (f: number) => {
    const png = await frame(f);
    const g = await sharp(png).greyscale().resize(640, 360).raw().toBuffer();
    const faces = detectFaces(new Uint8Array(g), 640, 360).filter(b => b.size >= 30).sort((a, b) => b.q - a.q);
    const t = track[Math.min(f, track.length - 1)] ?? [bx0, by0];
    const near = faces.find(b => Math.hypot(b.x * 2 - t[0], b.y * 2 - t[1]) < bs * 0.4);
    const [cx, cy] = near ? [near.x * 2, near.y * 2] : t;
    const cw = Math.round(bs * 0.7), ch = Math.round(bs * 0.5);
    const left = Math.max(0, Math.min(W - cw, Math.round(cx - cw / 2)));
    const topY = Math.max(0, Math.min(H - ch, Math.round(cy + bs * 0.08)));
    return sharp(png).extract({ left, top: topY, width: cw, height: ch }).resize(300, Math.round((300 * ch) / cw)).png().toBuffer();
  };
  const rowOf = async (frames: number[]) => {
    const tiles = await Promise.all(frames.map(crop));
    const h = (await sharp(tiles[0]).metadata()).height!;
    return sharp({ create: { width: 300 * tiles.length, height: h, channels: 3, background: "#000" } })
      .composite(tiles.map((t, i) => ({ input: t, left: i * 300, top: 0 })))
      .png().toBuffer();
  };
  const [speakRow, quietRow] = await Promise.all([rowOf(loud), rowOf(quiet)]);
  if (process.env.SAVE_SHEET) {
    const h1 = (await sharp(speakRow).metadata()).height!, h2 = (await sharp(quietRow).metadata()).height!, wd = Math.max((await sharp(speakRow).metadata()).width!, (await sharp(quietRow).metadata()).width!);
    await sharp({ create: { width: wd, height: h1 + h2 + 10, channels: 3, background: "#000" } }).composite([{ input: speakRow, left: 0, top: 0 }, { input: quietRow, left: 0, top: h1 + 10 }]).jpeg().toFile(path.join(process.env.SAVE_SHEET, path.basename(clip).replace(/.mp4$/, "-speak-vs-silent.jpg")));
  }
  const votes: string[] = [];
  for (let k = 0; k < 3; k++) {
    const speakFirst = Math.random() < 0.5;
    const [a, b] = speakFirst ? [speakRow, quietRow] : [quietRow, speakRow];
    const wA = (await sharp(a).metadata()).width!, wB = (await sharp(b).metadata()).width!;
    const hA = (await sharp(a).metadata()).height!, hB = (await sharp(b).metadata()).height!;
    const sheet = await sharp({ create: { width: Math.max(wA, wB) + 40, height: hA + hB + 20, channels: 3, background: "#222" } })
      .composite([
        { input: Buffer.from(`<svg width="40" height="${hA}"><text x="8" y="${hA / 2}" font-size="26" fill="white" font-family="Arial">A</text></svg>`), left: 0, top: 0 },
        { input: a, left: 40, top: 0 },
        { input: Buffer.from(`<svg width="40" height="${hB}"><text x="8" y="${hB / 2}" font-size="26" fill="white" font-family="Arial">B</text></svg>`), left: 0, top: hA + 20 },
        { input: b, left: 40, top: hA + 20 },
      ]).png().toBuffer();
    try {
      const r = await invokeClaude({
        systemPrompt: OPEN_ROW_SYSTEM,
        userMessage: "Which row is the person speaking?",
        imageInput: { base64: sheet.toString("base64"), mediaType: "image/png" },
        maxTokens: 150,
        model: process.env.HOST_PHOTO_JUDGE_MODEL || "claude-sonnet-5",
        thinking: "off",
        step: "Mouth open vs silent",
      });
      const m = /\{[\s\S]*\}/.exec(r.text ?? "");
      const said = m ? String(JSON.parse(m[0]).speaking ?? "").toUpperCase() : "";
      votes.push(said === "SAME" ? "same" : said === (speakFirst ? "A" : "B") ? "right" : said ? "wrong" : "none");
    } catch {
      votes.push("none");
    }
  }
  const right = votes.filter(x => x === "right").length;
  return { clip: path.basename(clip), ok: true, votes, right, pass: right === 3, silences: silent.length };
}

for (const c of clips) {
  let r: any;
  try { r = await measure(c); } catch (e: any) { r = { clip: path.basename(c), ok: false, why: String(e?.message ?? e).slice(0, 200) }; }
  appendFileSync(OUT, JSON.stringify(r) + "\n");
  console.log(JSON.stringify(r));
}

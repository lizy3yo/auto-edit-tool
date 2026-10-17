// Every SHOT of a film (between two measured cuts) with the words spoken under it and a frame from
// its middle, laid out as review sheets — the picture-by-picture audit of the b-roll.
//   tsx scripts/shots.mts --job 383
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { detectCuts, frameDiffs } from "./qa-lib.mts";
import { ffmpegPath, outDir, run } from "./lib.mts";
import { loadJob } from "./job.mts";
import type { Word } from "../../graphics/src/cueResolve.ts";

const jobId = Number(process.argv[process.argv.indexOf("--job") + 1]);
const job = loadJob(jobId);
const dir = outDir("jobs", String(jobId));
const film = path.join(dir, "film.mp4");
const ff = ffmpegPath();
const FPS = 30;
const d = await frameDiffs(ff, film);
const cuts = [0, ...detectCuts(d), d.length];
const words = JSON.parse(readFileSync(path.join(dir, "words.json"), "utf8")) as Word[];
const shotDir = outDir("jobs", String(jobId), "shots");
type Shot = { n: number; start: number; end: number; scene: number; host: boolean; split: boolean; text: string; frame: string };
const shots: Shot[] = [];
for (let i = 0; i + 1 < cuts.length; i++) {
  const start = cuts[i] / FPS;
  const end = cuts[i + 1] / FPS;
  if (end - start < 0.2) continue;
  const mid = (start + end) / 2;
  const scene = job.scenes.find(s => mid >= s.narrationStartSec && mid < s.narrationEndSec) ?? job.scenes[job.scenes.length - 1];
  const text = words.filter(w => w.start >= start - 0.05 && w.start < end - 0.05).map(w => w.text.replace(/"/g, "")).join(" ");
  const frame = path.join(shotDir, `shot-${String(shots.length + 1).padStart(3, "0")}.jpg`);
  await run(ff, ["-hide_banner", "-loglevel", "error", "-ss", mid.toFixed(3), "-i", film, "-frames:v", "1", "-vf", "scale=480:-2", "-y", frame]);
  shots.push({ n: shots.length + 1, start, end, scene: scene.index, host: !!scene.hostPresent, split: !!scene.split, text, frame });
}
writeFileSync(path.join(dir, "shots.json"), JSON.stringify(shots, null, 1));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const wrap = (s: string, n: number) => {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(" ")) {
    if ((line + " " + w).trim().length > n) {
      out.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) out.push(line.trim());
  return out.slice(0, 4);
};
const W = 480, H = 270, T = 80, COLS = 4, PER = 20;
for (let p = 0; p * PER < shots.length; p++) {
  const page = shots.slice(p * PER, (p + 1) * PER);
  const comps: sharp.OverlayOptions[] = [];
  page.forEach((s, k) => {
    const x = (k % COLS) * W, y = Math.floor(k / COLS) * (H + T);
    comps.push({ input: s.frame, left: x, top: y });
    const head = `#${s.n} ${s.start.toFixed(1)}s sc${s.scene}${s.host ? " HOST" : ""}${s.split ? " SPLIT" : ""}: `;
    const lines = wrap(head + s.text, 60);
    comps.push({
      input: Buffer.from(`<svg width="${W}" height="${T}"><rect width="100%" height="100%" fill="#111"/>${lines.map((l, i) => `<text x="6" y="${16 + i * 17}" font-family="Arial" font-size="14" fill="#ffd400">${esc(l)}</text>`).join("")}</svg>`),
      left: x,
      top: y + H,
    });
  });
  const rows = Math.ceil(page.length / COLS);
  await sharp({ create: { width: W * COLS, height: rows * (H + T), channels: 3, background: "#000" } })
    .composite(comps)
    .jpeg({ quality: 80 })
    .toFile(path.join(dir, `shots-${p + 1}.jpg`));
}
console.log(`${shots.length} shots → ${dir}/shots-*.jpg`);

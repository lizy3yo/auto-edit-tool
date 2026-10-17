// Repeatability: render every template N times (default 3), time each run, and check that the
// same props always give the SAME frames (decoded-frame MD5s, so encoder container metadata
// cannot hide or fake a difference). A graphic that renders differently twice cannot be cached
// and cannot be trusted to look in the film the way it looked in review.
//   tsx scripts/bench.mts [--runs 3] [--concurrency 4]
import path from "node:path";
import { writeFileSync } from "node:fs";
import { TEMPLATES } from "../../graphics/src/registry.ts";
import { ffmpegPath, outDir, renderGraphic, run } from "./lib.mts";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const runs = Number(arg("--runs", "3"));
const concurrency = Number(arg("--concurrency", "4"));
const dir = outDir("bench");
const ff = ffmpegPath();

async function frameHashes(file: string): Promise<string> {
  // Hash every decoded frame; alpha included for overlays.
  const out = await run(ff, ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0:v", "-f", "framemd5", "-"]);
  return out
    .split("\n")
    .filter(l => l && !l.startsWith("#"))
    .map(l => l.split(",").pop()!.trim())
    .join("|");
}

/** Lowest per-frame PSNR (dB) of `b` against `a` over the RGBA pixels; Infinity = identical. */
async function minPsnr(a: string, b: string): Promise<number> {
  const out = await run(ff, ["-hide_banner", "-i", a, "-i", b, "-lavfi", "[0:v]format=rgba[x];[1:v]format=rgba[y];[x][y]psnr", "-f", "null", "-"]);
  const m = /min:(inf|[\d.]+)/.exec(out);
  return !m || m[1] === "inf" ? Infinity : Number(m[1]);
}

type Row = { id: string; kind: string; frames: number; ms: number[]; identical: boolean; psnr: number };
const rows: Row[] = [];
for (const t of TEMPLATES) {
  const ms: number[] = [];
  const hashes: string[] = [];
  const files: string[] = [];
  let frames = 0;
  for (let r = 0; r < runs; r++) {
    const file = path.join(dir, `${t.id}-run${r + 1}.${t.kind === "card" ? "mp4" : "mov"}`);
    const res = await renderGraphic({ id: t.id, props: t.defaultProps, output: file }, { concurrency });
    ms.push(res.ms);
    frames = res.frames;
    hashes.push(await frameHashes(file));
    files.push(file);
  }
  let psnr = Infinity;
  for (const f of files.slice(1)) psnr = Math.min(psnr, await minPsnr(files[0], f));
  const identical = hashes.every(h => h === hashes[0]);
  rows.push({ id: t.id, kind: t.kind, frames, ms, identical, psnr });
  console.log(`${t.id.padEnd(14)} ${frames} frames  ${ms.map(m => (m / 1000).toFixed(1) + "s").join(" / ")}  ${verdict(identical, psnr)}`);
}

/** 50 dB is the usual threshold for "no visible difference" on 8-bit video. */
function verdict(identical: boolean, psnr: number): string {
  if (identical) return "bit-identical";
  return psnr >= 50 ? `visually identical (min ${psnr.toFixed(1)} dB)` : `VISIBLY DIFFERENT (min ${psnr.toFixed(1)} dB)`;
}

const fps = (r: Row) => r.frames / (r.ms.reduce((a, b) => a + b, 0) / r.ms.length / 1000);
const lines = [
  `# Render bench — ${runs} runs per template, concurrency ${concurrency}`,
  "",
  "| Template | Kind | Frames | Run times | Avg fps | Same picture every run |",
  "|---|---|---|---|---|---|",
  ...rows.map(
    r => `| ${r.id} | ${r.kind} | ${r.frames} | ${r.ms.map(m => (m / 1000).toFixed(1) + " s").join(" / ")} | ${fps(r).toFixed(1)} | ${verdict(r.identical, r.psnr)} |`
  ),
  "",
  `Bit-identical: ${rows.filter(r => r.identical).length}/${rows.length}; visibly the same (≥ 50 dB PSNR, every frame): ${rows.filter(r => r.identical || r.psnr >= 50).length}/${rows.length}. Mean speed: ${(rows.reduce((a, r) => a + fps(r), 0) / rows.length).toFixed(1)} frames/s (${((rows.reduce((a, r) => a + fps(r), 0) / rows.length) / 30).toFixed(2)}x real time at 30 fps).`,
];
writeFileSync(path.join(dir, "bench.md"), lines.join("\n"));
console.log(lines.slice(-1)[0]);

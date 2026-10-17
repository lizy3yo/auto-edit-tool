// A short review cut of a composited reel: each graphic with a little of the film either side
// (sound included), joined. Also a side-by-side sheet: the reference frame for each kind of
// graphic next to ours, taken from the reel at the cue's settled moment.
//   tsx scripts/highlights.mts --job 376 --tag round6 [--ref out/reference]
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import type { ResolvedCue } from "../../graphics/src/cueResolve.ts";
import { ffmpegPath, outDir, run } from "./lib.mts";
import { audioOffsetMs } from "./qa-lib.mts";
import { FPS } from "../../graphics/src/theme.ts";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const job = arg("--job", "376");
const tag = arg("--tag", "latest");
const refDir = arg("--ref", path.join("out", "reference"));
const dir = outDir("jobs", job, tag);
const reel = path.join(dir, "reel.mp4");
const cues = JSON.parse(readFileSync(path.join(dir, "cues.resolved.json"), "utf8")) as ResolvedCue[];
const ff = ffmpegPath();

// 1. Segments around each cue, merged when they touch.
const PRE = 1.2;
const POST = 0.9;
const segs: [number, number][] = [];
for (const c of cues) {
  const s = Math.max(0, c.start - PRE);
  const e = c.end + POST;
  const last = segs[segs.length - 1];
  if (last && s <= last[1] + 0.5) last[1] = Math.max(last[1], e);
  else segs.push([s, e]);
}
// ONE pass: every piece is trimmed out of the reel inside a single filter graph and joined there,
// sample-accurate, then encoded once. Encoding pieces separately and joining the files (the
// first version) left each AAC piece's encoder priming in the joined file: the sound slipped
// ~15 ms later at every join, 140 ms by the end of the 83 s clip — past the ~125 ms at which a
// viewer sees lips move before the voice. Piece edges sit on frame boundaries.
const onFrame = (t: number) => Math.round(t * FPS) / FPS;
const pieces = segs.map(([s, e]) => [onFrame(s), onFrame(e)] as const);
const FADE = 0.2;
const graph: string[] = [];
// Picture by whole FRAMES, sound by the exact matching SAMPLES (48 kHz / 30 fps = 1600 per frame):
// trimming each by seconds let a piece's picture come out a frame short of its sound, and the
// next piece started that much early against the voice.
const SR = 48000;
pieces.forEach(([s, e], i) => {
  const f0 = Math.round(s * FPS);
  const f1 = Math.round(e * FPS);
  const frames = f1 - f0;
  const fadeOutAt = (frames / FPS - FADE).toFixed(4);
  graph.push(
    `[0:v]trim=start_frame=${f0}:end_frame=${f1},setpts=PTS-STARTPTS,` +
      `fade=t=in:st=0:d=${FADE},fade=t=out:st=${fadeOutAt}:d=${FADE}[v${i}]`
  );
  graph.push(
    `[0:a]aresample=${SR},atrim=start_sample=${(f0 * SR) / FPS}:end_sample=${(f1 * SR) / FPS},asetpts=PTS-STARTPTS,` +
      `afade=t=in:st=0:d=${FADE},afade=t=out:st=${fadeOutAt}:d=${FADE}[a${i}]`
  );
});
graph.push(`${pieces.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${pieces.length}:v=1:a=1[v][a]`);
const out = path.join(dir, "highlights.mp4");
await run(ff, [
  "-hide_banner", "-loglevel", "error", "-i", reel, "-filter_complex", graph.join(";"), "-map", "[v]", "-map", "[a]",
  "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", out,
]);
const total = pieces.reduce((a, [s, e]) => a + (e - s), 0);
console.log(`highlights: ${pieces.length} pieces, ${total.toFixed(1)} s → ${out}`);

// Sound against picture, piece by piece: each piece's audio is matched against the reel's own
// audio at the same moment. Must sit within one frame (±33 ms; broadcast tolerance is +40/-60).
let at = 0;
const drift: number[] = [];
for (const [s, e] of pieces) {
  const len = e - s;
  drift.push(await audioOffsetMs(ff, out, at + 0.4, reel, s + 0.4, Math.max(1, len - 0.8)));
  at += len;
}
const worst = drift.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const syncLine = `audio vs picture per piece (ms, + = sound late): ${drift.join(", ")} — worst ${worst} ms ${worst <= 33 ? "PASS" : "FAIL"}`;
writeFileSync(path.join(dir, "highlights-sync.txt"), syncLine);
console.log(syncLine);

// 2. Reference vs ours, one row per kind of graphic.
const PAIRS: [string, string, string][] = [
  ["Statement card", "told", "02-statement-slow"],
  ["Big number", "bignum", "12-number-10-years"],
  ["This vs that", "vs", "05-versus-type"],
  ["Chapter label", "chapter", "04-chapter-1"],
  ["Step labels", "steps", "06-step-labels"],
  ["Caption over host", "hostcap", "04a-host-caption"],
  ["Warning label", "warning", "13-warning"],
  ["Icon labels", "icons", "07-icon-labels"],
  ["Two points", "twopoint", "11-two-point"],
  ["Caption over dimmed footage", "dimcap", "09-dim-caption"],
  ["Quote card", "quote", "14-quote"],
];
const W = 800;
const H = 450;
const LAB = 40;
const rows = PAIRS.filter(([, ref, id]) => existsSync(path.join(refDir, `${ref}.png`)) && cues.some(c => c.id === id));
if (!rows.length) {
  console.log("comparison: no matching cue ids for this sheet — skipped");
  process.exit(0);
}
const comps: sharp.OverlayOptions[] = [];
const label = (text: string, w: number) =>
  Buffer.from(`<svg width="${w}" height="${LAB}"><rect width="100%" height="100%" fill="#0d0d0d"/><text x="14" y="27" font-family="Arial" font-size="22" fill="#ffd400">${text}</text></svg>`);
for (let i = 0; i < rows.length; i++) {
  const [name, ref, id] = rows[i];
  const c = cues.find(x => x.id === id)!;
  const ours = path.join(dir, `cmp-${id}.png`);
  const t = c.start + (c.end - c.start) * 0.88;
  await run(ff, ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(3), "-i", reel, "-frames:v", "1", "-y", ours]);
  const top = i * (H + LAB);
  comps.push({ input: await sharp(label(`${name} — Steve Cooper`, W)).png().toBuffer(), left: 0, top });
  comps.push({ input: await sharp(label(`${name} — ours (Frederick, job ${job})`, W)).png().toBuffer(), left: W + 10, top });
  comps.push({ input: await sharp(path.join(refDir, `${ref}.png`)).resize(W, H).toBuffer(), left: 0, top: top + LAB });
  comps.push({ input: await sharp(ours).resize(W, H).toBuffer(), left: W + 10, top: top + LAB });
}
const sheet = path.join(dir, "steve-vs-ours.jpg");
await sharp({ create: { width: W * 2 + 10, height: rows.length * (H + LAB), channels: 3, background: "#000" } })
  .composite(comps)
  .jpeg({ quality: 84 })
  .toFile(sheet);
console.log(`comparison: ${rows.length} rows → ${sheet}`);

// Lays a cue sheet's graphics onto a FINISHED film of ours, the way assembly would in Phase 2:
// cards replace the picture for their seconds, overlays (ProRes 4444 alpha) sit on top, a quote's
// footage is blurred under it, the film's own sound is untouched.
//   tsx scripts/composite.mts --cues cues/frederick-376.json [--tag round3] [--clips]
// Writes out/jobs/<job>/<tag>/: cues.resolved.json, sync.txt, reel.mp4, review/<cue>.jpg
import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { MAX_LINGER_SEC, resolveCues, type CueSpec, type Word } from "../src/cueResolve.ts";
import { TEMPLATES, templateById } from "../src/registry.ts";
import { FPS } from "../src/theme.ts";
import { loadJob } from "./job.mts";
import { checkRules } from "./rules.mts";
import { ffmpegPath, outDir, renderGraphic, run } from "./lib.mts";
import { appearFrame } from "../src/timing.ts";
import { detectCuts, flashes, frameDiffs, preCutPumps } from "./qa-lib.mts";

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const sheet = JSON.parse(readFileSync(arg("--cues", "cues/frederick-376.json")!, "utf8")) as { job: number; cues: CueSpec[] };
const tag = arg("--tag", "latest")!;
const job = loadJob(sheet.job);
const jobDir = outDir("jobs", String(job.id));
const dir = outDir("jobs", String(job.id), tag);
const gfxDir = outDir("jobs", String(job.id), "gfx");
const ff = ffmpegPath();

/** Host panel of a split scene in the film (measured off job 376: the seam is at 840 px). */
const SPLIT_HOST_PANEL = { x: 0, w: 840 };

// 1. The film's REAL picture cuts, measured off the rendered file (the plan's scene ranges and the
// edit disagree by a frame or two, and a frame is all a flash needs).
const film = path.join(jobDir, "film.mp4");
if (!existsSync(film)) await run(ff, ["-hide_banner", "-loglevel", "error", "-i", job.finalVideoUrl, "-c", "copy", "-y", film]);
const filmDiffs = await frameDiffs(ff, film);
const filmCutFrames = detectCuts(filmDiffs);
writeFileSync(path.join(jobDir, "cuts.json"), JSON.stringify(filmCutFrames.map(f => f / FPS)));

// 2. Words → exact cue times, every edge near a cut conformed onto it.
const words = JSON.parse(readFileSync(path.join(jobDir, "words.json"), "utf8")) as Word[];
const structural = new Set(TEMPLATES.filter(t => t.structural).map(t => t.id));
const cards = new Set(TEMPLATES.filter(t => t.kind === "card").map(t => t.id));
const cues = resolveCues(sheet.cues, words, { cuts: filmCutFrames.map(f => f / FPS), fps: FPS, structural, cards });
// A host caption on a split scene stays in the host panel.
for (const c of cues) {
  if (c.template !== "HostCaption") continue;
  const scene = job.scenes.find(s => s.hostPresent && c.start >= s.narrationStartSec - 0.2 && c.start < s.narrationEndSec);
  if (scene?.split) c.props.panel = SPLIT_HOST_PANEL;
}
// The video's colours, from its own host photo (scripts/theme.mts). Carried in every cue's props,
// so it is part of each graphic's cache key: a new photo re-renders, the same one is reused.
const themeFile = path.join(jobDir, "theme.json");
if (existsSync(themeFile)) {
  const { theme, report } = JSON.parse(readFileSync(themeFile, "utf8"));
  for (const c of cues) c.props.theme = theme;
  console.log(`theme: accent ${theme.accent} on ${theme.bg} (${report.note})`);
} else console.log("theme: none for this job — default navy and blue (run scripts/theme.mts)");
writeFileSync(path.join(dir, "cues.resolved.json"), JSON.stringify(cues, null, 1));

// 3. Rules the planner must keep, checked on the RESOLVED times (scripts/rules.mts — the same
// copy the planner is held to): no overlap, nothing in the CTA, cards and darkening overlays only
// over b-roll, no host caption while the name tag is up.
const problems = checkRules(cues, job).map(p => `${p.cue} ${p.problem}`);

// 4. The sync report: every word-timed element, the frame it appears on vs. the word it waits for.
const lines: string[] = [];
for (const c of cues) {
  lines.push(`${c.id}  ${c.template}  ${c.start.toFixed(2)}–${c.end.toFixed(2)} s (${(c.end - c.start).toFixed(1)} s)`);
  for (const s of c.sync) lines.push(`    ${s.element.padEnd(52)} on "${s.word}" @ ${s.wordStart.toFixed(2)} s`);
}
lines.push("", problems.length ? `RULE PROBLEMS:\n  ${problems.join("\n  ")}` : "Rules: no overlaps, nothing in the CTA, every card over b-roll, no caption under the name tag.");
writeFileSync(path.join(dir, "sync.txt"), lines.join("\n"));
console.log(lines.slice(-2).join("\n"));

// 5. Render each graphic once (cached by template + props).
// Any change to the templates re-renders every graphic: the cache key carries a hash of src/.
const SOURCE_HASH = createHash("sha1")
  .update(
    readdirSync("src")
      .filter(f => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
      .sort()
      .map(f => readFileSync(path.join("src", f), "utf8"))
      .join("\n")
  )
  .digest("hex");
const rendered: { cue: (typeof cues)[number]; file: string; kind: string; underlay?: string }[] = [];
for (const c of cues) {
  const def = templateById(c.template);
  const hash = createHash("sha1").update(JSON.stringify([c.template, c.props, SOURCE_HASH])).digest("hex").slice(0, 12);
  const file = path.join(gfxDir, `${c.id}-${hash}.${def.kind === "card" ? "mp4" : "mov"}`);
  if (!existsSync(file)) {
    const r = await renderGraphic({ id: c.template, props: c.props, output: file });
    console.log(`rendered ${c.id} in ${(r.ms / 1000).toFixed(1)} s (${r.frames} frames)`);
  }
  rendered.push({ cue: c, file, kind: def.kind, underlay: def.underlay });
}

// 6. One ffmpeg pass: blur under quotes, then every graphic shifted to its start and enabled
// only for its window. Each boundary is placed HALF A FRAME before the frame it applies to, so
// rounding can never put it on the wrong side: on from startFrame, off from endFrame. (Gating on
// the frame counter n instead showed each card for ONE frame inside the overlay chain.)
const frameWindow = (c: { startFrame: number; endFrame: number }) =>
  `gte(t,${((c.startFrame - 0.5) / FPS).toFixed(5)})*lt(t,${((c.endFrame - 0.5) / FPS).toFixed(5)})`;
const inputs = ["-i", film];
const chain: string[] = [];
let cur = "[0:v]";
let n = 0;
for (const r of rendered) {
  if (r.underlay === "blur") {
    const a = `[u${n}a]`, b = `[u${n}b]`, bl = `[u${n}bl]`, o = `[u${n}]`;
    chain.push(`${cur}split${a}${b}`, `${b}gblur=sigma=26${bl}`, `${a}${bl}overlay=enable='${frameWindow(r.cue)}'${o}`);
    cur = o;
  }
  n++;
}
rendered.forEach((r, i) => {
  inputs.push("-i", r.file);
  const g = `[g${i}]`;
  const o = `[v${i}]`;
  const fmt = r.kind === "overlay" ? "format=yuva420p," : "";
  chain.push(`[${i + 1}:v]${fmt}setpts=PTS-STARTPTS+${r.cue.startFrame}/${FPS}/TB${g}`);
  chain.push(`${cur}${g}overlay=enable='${frameWindow(r.cue)}':eof_action=pass:format=auto${o}`);
  cur = o;
});
const reel = path.join(dir, "reel.mp4");
const t0 = Date.now();
await run(ff, [
  "-hide_banner", "-loglevel", "error", ...inputs,
  "-filter_complex", chain.join(";"),
  "-map", cur, "-map", "0:a",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-c:a", "copy", "-movflags", "+faststart", "-y", reel,
]);
console.log(`composited ${reel} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// 7. QA on the RENDERED reel against the film it was laid on.
const reelDiffs = await frameDiffs(ff, reel);
const reelCuts = detectCuts(reelDiffs);
const filmFlashes = new Set(flashes(filmDiffs, filmCutFrames).map(([a]) => a));
const newFlashes = flashes(reelDiffs, reelCuts).filter(([a]) => !filmFlashes.has(a));
const pumps = preCutPumps(reelDiffs, filmDiffs, filmCutFrames);
// Every word-timed element: the frame it starts appearing on vs. the frame its word is heard on.
const syncRows: { cue: string; element: string; offsetMs: number }[] = [];
for (const c of cues) {
  for (const s of c.sync) {
    const shown = c.startFrame + appearFrame(s.wordStart - c.start, FPS);
    syncRows.push({ cue: c.id, element: s.element, offsetMs: Math.round(((shown / FPS) - s.wordStart) * 1000) });
  }
}
const worstSync = syncRows.reduce((m, r) => Math.max(m, Math.abs(r.offsetMs)), 0);
// A card that opens and then waits for its words reads as a delay: the first moment ANY of its
// content (a timed word, or an element shown from the start) is on screen, in seconds.
function firstContentSec(props: unknown): number {
  let best = Infinity;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "at" && typeof x === "number") best = Math.min(best, x);
      else if (k === "wordTimes" && Array.isArray(x) && typeof x[0] === "number") best = Math.min(best, x[0]);
      else walk(x);
    }
  };
  walk(props);
  return Number.isFinite(best) ? Math.max(0, best) : 0;
}
const deadAir = cues
  .filter(c => templateById(c.template).kind === "card" && c.sync.length)
  .map(c => ({ id: c.id, sec: firstContentSec(c.props) }))
  .filter(x => x.sec > 0.7);
// A graphic carrying a tail of less than a second onto the next shot (one that ENDS on a cut
// covers its last shot whole, which is not a spill).
const spills = cues.filter(c => !c.conformed.end && filmCutFrames.some(k => k > c.startFrame + 3 && k < c.endFrame && c.endFrame - k < FPS));
// A caption-like graphic still up well after its own words are done (job 384, 0:10-0:13).
const LINGER_LIMIT_SEC = MAX_LINGER_SEC;
const lingering = cues
  .filter(c => !structural.has(c.template) && c.contentEnd !== undefined && c.end - c.contentEnd > LINGER_LIMIT_SEC)
  .map(c => ({ id: c.id, sec: c.end - (c.contentEnd as number) }));
const qa = [
  `# QA — job ${job.id}, ${tag}`,
  "",
  `- Picture cuts in the film: ${filmCutFrames.length}; graphic edges snapped onto a cut: ${cues.filter(c => c.conformed.start).length} starts, ${cues.filter(c => c.conformed.end).length} ends`,
  `- Flashes (a shot of 3 frames or fewer) the graphics ADDED: ${newFlashes.length}${newFlashes.length ? " — at " + newFlashes.map(([a]) => (a / FPS).toFixed(2) + " s").join(", ") : ""}`,
  `- Flicker before a cut (graphic change in the 5 frames before a cut, film's own change removed): ${pumps.length}${pumps.length ? " — at " + pumps.map(p => `${(p.frame / FPS).toFixed(2)} s (+${p.added})`).join(", ") : ""}`,
  `- Words on screen vs. heard: worst ${worstSync} ms over ${syncRows.length} elements (a frame is ${Math.round(1000 / FPS)} ms)`,
  `- Graphics still up more than ${LINGER_LIMIT_SEC} s after their own words: ${lingering.length}${lingering.length ? " — " + lingering.map(l => `${l.id} ${l.sec.toFixed(1)} s`).join(", ") : ""}`,
  `- Graphics spilling under 1 s onto the next shot: ${spills.length}${spills.length ? " — " + spills.map(s => s.id).join(", ") : ""}`,
  `- Cards waiting more than 0.7 s before showing anything: ${deadAir.length}${deadAir.length ? " — " + deadAir.map(d => `${d.id} ${d.sec.toFixed(1)} s`).join(", ") : ""}`,
  `- Rules: ${problems.length ? problems.join("; ") : "pass"}`,
  "",
  `RESULT: ${lingering.length || spills.length || newFlashes.length || pumps.length || problems.length || worstSync > 100 || deadAir.length ? "FAIL" : "PASS"}`,
];
writeFileSync(path.join(dir, "qa.md"), qa.join("\n"));
console.log(qa.join("\n"));

// 8. Review frames: for each cue, a strip of 4 moments (just in, two mid, settled) from the reel.
const review = outDir("jobs", String(job.id), tag, "review");
for (const c of cues) {
  const ts = [0.15, 0.4, 0.65, 0.92].map(p => c.start + (c.end - c.start) * p);
  const frames = await Promise.all(
    ts.map(async (t, k) => {
      const f = path.join(review, `${c.id}-${k}.png`);
      await run(ff, ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(3), "-i", reel, "-frames:v", "1", "-vf", "scale=640:-2", "-y", f]);
      return f;
    })
  );
  await sharp({ create: { width: 640 * 4, height: 360, channels: 3, background: "#000" } })
    .composite(await Promise.all(frames.map(async (f, k) => ({ input: await sharp(f).toBuffer(), left: k * 640, top: 0 }))))
    .jpeg({ quality: 82 })
    .toFile(path.join(review, `${c.id}.jpg`));
}
console.log(`review strips in ${review}`);

// Lays a cue sheet's graphics onto a FINISHED film of ours, the way assembly would in Phase 2:
// cards replace the picture for their seconds, overlays (ProRes 4444 alpha) sit on top, a quote's
// footage is blurred under it, the film's own sound is untouched.
//   tsx scripts/composite.mts --cues cues/frederick-376.json [--tag round3] [--clips]
// Writes out/jobs/<job>/<tag>/: cues.resolved.json, sync.txt, reel.mp4, review/<cue>.jpg
import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { CUT_SNAP_SEC, resolveCues, stillUpAfterWords, type CueSpec, type Word } from "../../graphics/src/cueResolve.ts";
import { resolveSets, templateById } from "../../graphics/src/registry.ts";
import { FPS } from "../../graphics/src/theme.ts";
import { loadJob } from "./job.mts";
import { checkRules, placementFor } from "./rules.mts";
import { GRAPHICS_SRC, ffmpegPath, outDir, renderGraphic, run } from "./lib.mts";
import { appearFrame } from "../../graphics/src/timing.ts";
import { drawnSec } from "../../graphics/src/plan/qa.ts";
import { detectCuts, flashes, frameDiffs, preCutPumps } from "./qa-lib.mts";
import { calmestPlace, describe, measureCue, subjectOf, type Reading } from "./legibility.mts";
import { WINDOW } from "../../graphics/src/more.tsx";

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

// 1. The film's REAL picture cuts, measured off the rendered file (the plan's scene ranges and the
// edit disagree by a frame or two, and a frame is all a flash needs).
const film = path.join(jobDir, "film.mp4");
if (!existsSync(film)) await run(ff, ["-hide_banner", "-loglevel", "error", "-i", job.finalVideoUrl, "-c", "copy", "-y", film]);
const filmDiffs = await frameDiffs(ff, film);
const filmCutFrames = detectCuts(filmDiffs);
writeFileSync(path.join(jobDir, "cuts.json"), JSON.stringify(filmCutFrames.map(f => f / FPS)));

// 2. Words → exact cue times, every edge near a cut conformed onto it.
const words = JSON.parse(readFileSync(path.join(jobDir, "words.json"), "utf8")) as Word[];
// The resolver's template sets from the one definition the app uses (a quote over the blurred
// picture is held to the cut like a card).
const sets = resolveSets();
const { structural } = sets;
const cues = resolveCues(sheet.cues, words, { cuts: filmCutFrames.map(f => f / FPS), fps: FPS, ...sets });
// A caption on a split scene stays in the host panel, and a chapter label over a host take goes
// below the chin — the app's finishing step decides it the same way (graphics/src/plan/rules.ts
// `placementFor`; the lab's jobs carry the default layout).
for (const c of cues) Object.assign(c.props, placementFor(c.template, c, job));
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
    readdirSync(GRAPHICS_SRC)
      .filter(f => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
      .sort()
      .map(f => readFileSync(path.join(GRAPHICS_SRC, f), "utf8"))
      .join("\n")
  )
  .digest("hex");
const rendered: { cue: (typeof cues)[number]; file: string; kind: string; underlay?: string }[] = [];
const cutsSec = filmCutFrames.map(f => f / FPS);
async function renderCue(c: (typeof cues)[number]): Promise<string> {
  const def = templateById(c.template);
  const hash = createHash("sha1").update(JSON.stringify([c.template, c.props, SOURCE_HASH])).digest("hex").slice(0, 12);
  const file = path.join(gfxDir, `${c.id}-${hash}.${def.kind === "card" ? "mp4" : "mov"}`);
  if (!existsSync(file)) {
    const r = await renderGraphic({ id: c.template, props: c.props, output: file });
    console.log(`rendered ${c.id} in ${(r.ms / 1000).toFixed(1)} s (${r.frames} frames)`);
  }
  return file;
}
// Text over footage must be readable on the frames it actually lands on (scripts/legibility.mts):
// measured on every shot it spans; if it fails, darker behind the words, then (if it can move)
// the calmest part of the picture. Each step is re-rendered and re-measured, never assumed.
const readability: { id: string; steps: string[]; final: Reading }[] = [];
for (const c of cues) {
  const def = templateById(c.template);
  if (c.template === "ArrowCaption" && !c.props.target) {
    const s = await subjectOf(ff, film, (c.start + c.end) / 2);
    c.props.target = { x: s.x, y: s.y };
  }
  let file = await renderCue(c);
  if (def.kind === "overlay" && def.underlay !== "window") {
    const steps: string[] = [];
    let r = await measureCue(ff, film, file, c, cutsSec);
    steps.push(`as designed: ${describe(r)}`);
    let best = { r, file, props: { ...c.props } };
    const better = (a: Reading, b: Reading) => Math.min((a.white ?? 99) / 7, (a.colour ?? 99) / 4.5) > Math.min((b.white ?? 99) / 7, (b.colour ?? 99) / 4.5);
    for (const shade of [0.5, 1]) {
      if (r.pass) break;
      c.props.shade = shade;
      file = await renderCue(c);
      r = await measureCue(ff, film, file, c, cutsSec);
      steps.push(`darker behind the words (${shade}): ${describe(r)}`);
      if (better(r, best.r) || r.pass) best = { r, file, props: { ...c.props } };
    }
    // Coloured words still too dark on the picture: the same colour, a lighter shade.
    if (!r.pass && r.colour !== undefined && r.colour < 4.5) {
      c.props.lift = 1;
      file = await renderCue(c);
      r = await measureCue(ff, film, file, c, cutsSec);
      steps.push(`lighter shade of the coloured words: ${describe(r)}`);
      if (better(r, best.r) || r.pass) best = { r, file, props: { ...c.props } };
    }
    if (!r.pass && def.movable && r.box) {
      const { place } = await calmestPlace(ff, film, c, cutsSec, { w: r.box.x1 - r.box.x0, h: r.box.y1 - r.box.y0 });
      c.props.place = place;
      file = await renderCue(c);
      r = await measureCue(ff, film, file, c, cutsSec);
      steps.push(`moved to ${place.v} ${place.h}: ${describe(r)}`);
      if (better(r, best.r) || r.pass) best = { r, file, props: { ...c.props } };
    }
    c.props = best.props as typeof c.props;
    file = best.file;
    readability.push({ id: c.id, steps, final: best.r });
  }
  rendered.push({ cue: c, file, kind: def.kind, underlay: def.underlay });
}
writeFileSync(path.join(dir, "cues.resolved.json"), JSON.stringify(cues, null, 1));

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
  if (r.underlay === "window") {
    // The picture under the window graphic, scaled into its window (the graphic covers the rest).
    const a = `[u${n}a]`, b = `[u${n}b]`, wv = `[u${n}w]`, o = `[u${n}]`;
    chain.push(
      `${cur}split${a}${b}`,
      `${b}scale=${WINDOW.w}:${WINDOW.h},pad=1920:1080:${WINDOW.x}:${WINDOW.y}:black${wv}`,
      `${a}${wv}overlay=enable='${frameWindow(r.cue)}'${o}`
    );
    cur = o;
  }
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
// A flash is a graphic edge landing a few frames off a PICTURE cut. Two steep frames inside a
// graphic's own fade (a full-frame darkening easing out over 12 frames), with no film cut within
// 3 frames, are that fade, not a flash: listed, not failed.
const nearFilmCut = (f: number) => filmCutFrames.some(k => Math.abs(k - f) <= 3);
const inOwnFade = (f: number) => cues.some(c => (f >= c.startFrame - 1 && f <= c.startFrame + 13) || (f >= c.endFrame - 13 && f <= c.endFrame + 1));
const allFlashes = flashes(reelDiffs, reelCuts).filter(([a]) => !filmFlashes.has(a));
const fades = allFlashes.filter(([a, b]) => inOwnFade(a) && inOwnFade(b) && !nearFilmCut(a) && !nearFilmCut(b));
const newFlashes = allFlashes.filter(f => !fades.includes(f));
const pumps = preCutPumps(reelDiffs, filmDiffs, filmCutFrames);
// Every word-timed element: the frame it starts appearing on vs. the frame its word is heard on.
// Text that would start just before a shot change starts ON it (the subtitling shot-change rule,
// BBC subtitle guidelines): an element shown on its graphic's first frame, whose start was moved
// onto a picture cut within CUT_SNAP_SEC, is aligned to the cut — listed, not out of sync. An element
// drawn at a time of its own (a Versus side's sub) is read where it is drawn (`drawnSec`, the app's QA).
const syncRows: { cue: string; element: string; offsetMs: number; onCut: boolean }[] = [];
for (const c of cues) {
  for (const s of c.sync) {
    const rel = appearFrame(drawnSec(c, s), FPS);
    const shown = c.startFrame + rel;
    const offsetMs = Math.round(((shown / FPS) - s.wordStart) * 1000);
    syncRows.push({ cue: c.id, element: s.element, offsetMs, onCut: rel === 0 && c.conformed.start && Math.abs(offsetMs) <= CUT_SNAP_SEC * 1000 });
  }
}
const worstSync = syncRows.filter(r => !r.onCut).reduce((m, r) => Math.max(m, Math.abs(r.offsetMs)), 0);
const onCutRows = syncRows.filter(r => r.onCut && Math.abs(r.offsetMs) > 100);
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
// A graphic still up well after its own words are done (job 384, 0:10-0:13) — by the resolver's own
// rules, the ones the app's QA asks (`stillUpAfterWords`), so the lab cannot fail what the app passes.
const lingering = cues
  .filter(c => !structural.has(c.template) && stillUpAfterWords(c, FPS))
  .map(c => ({ id: c.id, sec: c.end - (c.spokenEnd ?? (c.contentEnd as number)) }));
const unreadable = readability.filter(r => !r.final.pass);
const qa = [
  `# QA — job ${job.id}, ${tag}`,
  "",
  `- Picture cuts in the film: ${filmCutFrames.length}; graphic edges snapped onto a cut: ${cues.filter(c => c.conformed.start).length} starts, ${cues.filter(c => c.conformed.end).length} ends`,
  `- Flashes (a shot of 3 frames or fewer) the graphics ADDED: ${newFlashes.length}${newFlashes.length ? " — at " + newFlashes.map(([a]) => (a / FPS).toFixed(2) + " s").join(", ") : ""}${fades.length ? ` (${fades.length} steep step${fades.length > 1 ? "s" : ""} inside a graphic's own fade, no picture cut near: ${fades.map(([a]) => (a / FPS).toFixed(2) + " s").join(", ")})` : ""}`,
  `- Flicker before a cut (graphic change in the 5 frames before a cut, film's own change removed): ${pumps.length}${pumps.length ? " — at " + pumps.map(p => `${(p.frame / FPS).toFixed(2)} s (+${p.added})`).join(", ") : ""}`,
  `- Words on screen vs. heard: worst ${worstSync} ms over ${syncRows.length - onCutRows.length} elements (a frame is ${Math.round(1000 / FPS)} ms)${onCutRows.length ? `; ${onCutRows.length} moved onto a shot change (subtitling rule): ${onCutRows.map(r => `${r.cue} ${r.offsetMs > 0 ? "+" : ""}${r.offsetMs} ms`).join(", ")}` : ""}`,
  `- Graphics still up after their own words: ${lingering.length}${lingering.length ? " — " + lingering.map(l => `${l.id} ${l.sec.toFixed(1)} s`).join(", ") : ""}`,
  `- Graphics spilling under 1 s onto the next shot: ${spills.length}${spills.length ? " — " + spills.map(s => s.id).join(", ") : ""}`,
  `- Cards waiting more than 0.7 s before showing anything: ${deadAir.length}${deadAir.length ? " — " + deadAir.map(d => `${d.id} ${d.sec.toFixed(1)} s`).join(", ") : ""}`,
  `- Rules: ${problems.length ? problems.join("; ") : "pass"}`,
  `- Text readable on every shot it crosses (white 7:1, coloured 4.5:1): ${readability.length - unreadable.length}/${readability.length}${unreadable.length ? " — FAIL: " + unreadable.map(r => `${r.id} (${describe(r.final)})`).join(", ") : ""}`,
  ...readability.filter(r => r.steps.length > 1).map(r => `    ${r.id}: ${r.steps.join(" → ")}`),
  "",
  `RESULT: ${lingering.length || spills.length || newFlashes.length || pumps.length || problems.length || worstSync > 100 || deadAir.length || unreadable.length ? "FAIL" : "PASS"}`,
];
writeFileSync(path.join(dir, "qa.md"), qa.join("\n"));
console.log(qa.join("\n"));

// 8. Review frames: for each cue, a strip of 4 moments (just in, two mid, settled) from the reel.
const review = outDir("jobs", String(job.id), tag, "review");
// A fresh folder per run: strips left from an earlier plan of the same tag read as graphics that
// are not in this film.
for (const f of readdirSync(review)) rmSync(path.join(review, f), { force: true });
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

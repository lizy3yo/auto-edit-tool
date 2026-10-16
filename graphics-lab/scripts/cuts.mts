// A finished film's picture cuts, measured off the file (frame differences), for the planner:
//   tsx scripts/cuts.mts 385   → out/jobs/385/film.mp4 + cuts.json
import path from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { FPS } from "../src/theme.ts";
import { loadJob } from "./job.mts";
import { ffmpegPath, outDir, run } from "./lib.mts";
import { detectCuts, frameDiffs } from "./qa-lib.mts";
const id = Number(process.argv[2]);
if (!id) throw new Error("usage: tsx scripts/cuts.mts <job>");
const job = loadJob(id);
const dir = outDir("jobs", String(id));
const film = path.join(dir, "film.mp4");
const ff = ffmpegPath();
if (!existsSync(film)) await run(ff, ["-hide_banner", "-loglevel", "error", "-i", job.finalVideoUrl, "-c", "copy", "-y", film]);
const cuts = detectCuts(await frameDiffs(ff, film));
writeFileSync(path.join(dir, "cuts.json"), JSON.stringify(cuts.map(f => f / FPS)));
console.log(`${cuts.length} cuts; scenes ${job.scenes.length}, host ${job.scenes.filter(s => s.hostPresent).length}, split ${job.scenes.filter(s => s.split).length}, cta ${job.scenes.filter(s => s.cta).length}`);

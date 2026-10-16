// Resolve a cue sheet against a job's words and print every cue and its word anchors.
//   tsx scripts/resolve.mts [cues/frederick-376.json]
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveCues, type CueSpec, type Word } from "../src/cueResolve.ts";
import { OUT } from "./lib.mts";

const sheet = JSON.parse(readFileSync(process.argv[2] ?? "cues/frederick-376.json", "utf8")) as { job: number; cues: CueSpec[] };
const words = JSON.parse(readFileSync(path.join(OUT, "jobs", String(sheet.job), "words.json"), "utf8")) as Word[];
for (const c of resolveCues(sheet.cues, words)) {
  console.log(`${c.id.padEnd(22)} ${c.start.toFixed(2).padStart(7)}–${c.end.toFixed(2).padEnd(7)} ${c.sync.map(x => `${x.word.replace(/"/g, "")}@${x.wordStart.toFixed(2)}`).join("  ")}`);
}

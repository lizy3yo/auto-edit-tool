/**
 * scripts/remeasure-mouths.mts â€” re-judge every photo-bench clip's lower mouth against Bertha,
 * and write it back onto each run's row (2026-10-16).
 *
 *   npx tsx scripts/remeasure-mouths.mts [--root bench/host-fix] [--reference SHEET.jpg]
 *
 * The first two teeth measures did not hold on beards; the benchmark comparison does
 * (`compareLowerMouth`). Runs scripts/measure-mouth-smear.mts on each clip with the reference and
 * writes the verdict (better / same / slightly worse / clearly worse) to
 * <persona>/mouth-vs-bertha.jsonl â€” never into results.jsonl, which a running bench appends to; the
 * report merges the two by clip. Already-judged clips are skipped.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = opt("--root") ?? "bench/host-fix";
const REF = opt("--reference") ?? path.join(ROOT, "bertha", "berthara-diykitchen-0051-mouth.jpg");
const tsx = path.resolve("node_modules/.bin/tsx" + (process.platform === "win32" ? ".cmd" : ""));

const ONLY = opt("--persona");
for (const persona of ["scarlett", "frederick", "dale", "hank"].filter(p => !ONLY || p === ONLY)) {
  const file = path.join(ROOT, persona, "results.jsonl");
  if (!existsSync(file)) continue;
  const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const out = path.join(ROOT, persona, "mouth-vs-bertha.jsonl");
  const already = new Set(
    existsSync(out) ? readFileSync(out, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(o => o.lowerMouth).map(o => o.clip) : []
  );
  const todo = rows.filter(r => !already.has(`${r.run.replace(/[#@]/, "-")}.mp4`));
  const clips = todo.map(r => path.join(ROOT, persona, `${r.run.replace(/[#@]/, "-")}.mp4`)).filter(existsSync);
  if (!clips.length) continue;
  // four clips per process, several processes at once
  const groups: string[][] = [];
  for (let i = 0; i < clips.length; i += 4) groups.push(clips.slice(i, i + 4));
  await Promise.all(
    groups.map(
      g =>
        new Promise<void>(res => {
          const r = spawnSync(tsx, ["scripts/measure-mouth-smear.mts", out, ...g, "--reference", REF, "--sheet", path.join(ROOT, persona)], {
            shell: process.platform === "win32",
            maxBuffer: 1 << 26,
          });
          if (r.status !== 0) console.error(String(r.stderr).slice(-300));
          res();
        })
    )
  );
  for (const l of readFileSync(out, "utf8").split("\n").filter(Boolean)) {
    const o = JSON.parse(l);
    console.log(`${persona} ${o.clip}: ${o.lowerMouth ?? "â€”"}`);
  }
}
process.exit(0);

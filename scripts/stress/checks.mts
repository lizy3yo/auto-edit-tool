/**
 * scripts/stress/checks.mts — which kinds of picture pass the check the first time.
 *
 *   npx tsx scripts/stress/checks.mts --jobs 343,344,345
 *
 * Reads `scene.pictureChecks` (`server/pictureCheckLog.ts`) off the jobs' storyboards. A kind
 * that passes nearly always is where the check can be skipped; a kind that fails often is where
 * the prompt needs work. Films made before 2026-10-05 carry no record and print nothing.
 */
import "dotenv/config";
import type { StoryboardScene } from "../../shared/types";
import { getLongformVideoJobById } from "../../server/db";
import { tallyPictureChecks } from "../../server/pictureCheckLog";

const at = process.argv.indexOf("--jobs");
const ids = (at >= 0 ? process.argv[at + 1] : "").split(",").map(Number).filter(Number.isFinite);
if (!ids.length) {
  console.error("usage: --jobs 343,344");
  process.exit(2);
}
const scenes: StoryboardScene[] = [];
for (const id of ids) {
  const job = await getLongformVideoJobById(id);
  if (Array.isArray(job?.storyboard)) scenes.push(...(job!.storyboard as StoryboardScene[]));
}
const rows = tallyPictureChecks(scenes);
console.log(`jobs ${ids.join(", ")}`);
console.log("kind              pictures  passed 1st  rate   checks  named");
for (const r of rows) {
  const named = Object.entries(r.flags)
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${f} ${n}`)
    .join(", ");
  console.log(
    `${r.kind.padEnd(17)} ${String(r.pictures).padStart(8)}  ${String(r.passedFirst).padStart(10)}  ` +
      `${(r.pictures ? Math.round((100 * r.passedFirst) / r.pictures) : 0).toString().padStart(3)}%  ` +
      `${String(r.checks).padStart(6)}  ${named}`
  );
}
if (!rows.length) console.log("(no picture checks recorded on these jobs)");
process.exit(0);

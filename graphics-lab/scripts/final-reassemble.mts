// Reassemble a finished film THROUGH THE APP (the real `reassembleFinal` route, as the bootstrap
// admin), optionally seeding its motion-graphics plan first with an approved cue sheet — so the
// app's own graphics step lays exactly those graphics (nothing lost) instead of planning afresh.
//   (from the repo root) npx tsx graphics-lab/scripts/final-reassemble.mts --job 385 \
//     [--plan graphics-lab/cues/frederick-385-all.json]
// Exits when the job settles.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ensureFontConfig } from "../../server/fontConfig";
import { resolveFFmpegPath } from "../../server/ffmpegPath";
import { appRouter } from "../../server/routers";
import { getLongformVideoJobById, updateLongformVideoJob } from "../../server/db";
import type { LongformInputParams } from "../../shared/types";

ensureFontConfig();
await resolveFFmpegPath();

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const jobId = Number(arg("job"));
if (!jobId) throw new Error("usage: --job <id> [--plan cues.json]");
const planFile = arg("plan");

if (planFile) {
  const job = await getLongformVideoJobById(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const params = { ...(job.inputParams as LongformInputParams) };
  const cues = (JSON.parse(readFileSync(planFile, "utf8")) as { cues: unknown[] }).cues;
  params.graphics = { plan: cues, replan: false };
  await updateLongformVideoJob(jobId, { inputParams: params });
  console.log(`[reassemble] job ${jobId}: graphics plan seeded with ${cues.length} approved graphics`);
}

const caller = appRouter.createCaller({
  req: { headers: {} } as never,
  res: {} as never,
  user: { id: 1, openId: "user:1", name: "Admin", email: "", role: "admin", status: "active" } as never,
});
const started = Date.now();
await caller.longformVideo.reassembleFinal({ jobId });
console.log(`[reassemble] job ${jobId} started`);
let status = "processing";
await new Promise(r => setTimeout(r, 5_000));
while (status === "processing" || status === "pending") {
  await new Promise(r => setTimeout(r, 15_000));
  status = (await getLongformVideoJobById(jobId))?.status ?? "failed";
}
const job = await getLongformVideoJobById(jobId);
const g = (job?.inputParams as LongformInputParams | null)?.graphics;
console.log(`[reassemble] job ${jobId} ${status} after ${((Date.now() - started) / 60_000).toFixed(1)} min${job?.errorMessage ? ` — ${job.errorMessage}` : ""}`);
console.log(`[reassemble] graphics: ${g?.skipped ? "none — " + g.skipped : `${g?.placed?.length ?? 0} placed, ${g?.dropped?.length ?? 0} left out, QA ${g?.qa?.pass ? "PASS" : "FAIL"}`}`);
if (g?.qa) console.log(g.qa.lines.join("\n"));
if (g?.dropped?.length) console.log("left out:\n" + g.dropped.map(d => `  ${d.id}: ${d.why}`).join("\n"));
process.exit(status === "completed" ? 0 : 1);

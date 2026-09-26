/**
 * scripts/stress/resume.mts — continue an interrupted stress run instead of starting it over.
 *
 *   npx tsx scripts/stress/resume.mts --job 157
 *
 * Presses "Retry failed scenes" on the job as the bootstrap admin (the same route the button
 * calls), so only the scenes that never got a clip are rendered — every picture already made is
 * kept — then waits for the film and audits it like `run.mts` does. The pipeline runs in THIS
 * process, so keep it alive until it prints the audit.
 */
import "dotenv/config";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { appRouter } from "../../server/routers";
import { getLongformVideoJobById } from "../../server/db";
import { auditJob, summarize } from "./audit.mts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const jobId = Number(arg("job"));
if (!jobId) {
  console.error("usage: --job <id>");
  process.exit(1);
}

const caller = appRouter.createCaller({
  req: { headers: {} } as any,
  res: {} as any,
  user: {
    id: 1,
    openId: "user:1",
    name: "Admin",
    email: "",
    role: "admin",
    status: "active",
  } as any,
});

const started = Date.now();
const before = await getLongformVideoJobById(jobId);
if (before?.stage === "voiceover" || before?.stage === "storyboard") {
  // Cut off before any clip existed: continue the pipeline from the top, which reuses the
  // narration already voiced (`inputParams.voicedMasterUrl`) — the same path a restart takes.
  const { runLongformPipeline } = await import("../../server/longformVideo");
  const { updateLongformVideoJob } = await import("../../server/db");
  await updateLongformVideoJob(jobId, { status: "processing", errorMessage: null } as any);
  console.log(`[stress] job ${jobId}: continuing from the recorded narration`);
  runLongformPipeline(jobId).catch(e => console.error(`[stress] job ${jobId} pipeline error:`, e));
} else {
  await caller.longformVideo.retryFailedScenes({ jobId });
  console.log(`[stress] job ${jobId}: retrying failed scenes`);
}

let status = "processing";
let lastStage = "";
// Give the retry a moment to flip the job to processing before the first read.
await new Promise(r => setTimeout(r, 15_000));
while (status === "processing" || status === "pending") {
  const job = await getLongformVideoJobById(jobId);
  status = job?.status ?? "failed";
  if (job?.stage && job.stage !== lastStage) {
    lastStage = job.stage;
    console.log(`[stress] job ${jobId} → ${lastStage}`);
  }
  if (status === "processing" || status === "pending")
    await new Promise(r => setTimeout(r, 20_000));
}
const minutes = ((Date.now() - started) / 60_000).toFixed(0);
const job = await getLongformVideoJobById(jobId);
const summaryFile = path.join("scripts", "stress", "reports", "summary.md");
if (status !== "completed") {
  const line = `\n### resume job ${jobId}: ${status.toUpperCase()} after ${minutes} min\n    ${job?.errorMessage ?? ""}`;
  console.log(line);
  appendFileSync(summaryFile, line + "\n");
  process.exit(0);
}
console.log(`[stress] job ${jobId} → done`);
const report = await auditJob(jobId);
const text = `\n### resume job ${jobId} — ${minutes} min\n\`\`\`\n${summarize(report)}\n\`\`\``;
console.log(text);
appendFileSync(summaryFile, text + "\n");
process.exit(0);

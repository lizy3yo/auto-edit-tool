// Render one film through the app's REAL Generate route (as the bootstrap admin), exactly as the
// form would, so it uses whatever look and voice the app's working copy has right now. Unlike
// scripts/stress/run.mts it writes no report file and does not assign the job to a Video tab;
// the job only appears in the Library.
//   (from the repo root) npx tsx graphics-lab/scripts/render-job.mts --channel frederick_barnes \
//     --script scripts/stress/scripts/frederick_barnes_3min.txt --title "…" [--host-minutes 3] [--rehearsal]
// Prints the job id at once, then each stage, and exits when the job settles.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ensureFontConfig } from "../../server/fontConfig";
import { resolveFFmpegPath } from "../../server/ffmpegPath";
import { appRouter } from "../../server/routers";
import { getLongformVideoJobById } from "../../server/db";

ensureFontConfig();
await resolveFFmpegPath();

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const channelKey = arg("channel");
const scriptFile = arg("script");
const title = arg("title");
if (!channelKey || !scriptFile || !title) {
  console.error("usage: --channel <key> --script <file> --title <title> [--host-minutes N] [--rehearsal]");
  process.exit(2);
}

const caller = appRouter.createCaller({
  req: { headers: {} } as never,
  res: {} as never,
  user: { id: 1, openId: "user:1", name: "Admin", email: "", role: "admin", status: "active" } as never,
});

const started = Date.now();
const { jobId } = await caller.longformVideo.generate({
  script: readFileSync(scriptFile, "utf8"),
  channelKey,
  title,
  slotIndex: Number(arg("slot") ?? 4),
  hostMinutes: Number(arg("host-minutes") ?? 3),
  rehearsal: process.argv.includes("--rehearsal"),
});
console.log(`[render] job ${jobId} started`);

let status = "processing";
let lastStage = "";
while (status === "processing" || status === "pending") {
  await new Promise(r => setTimeout(r, 20_000));
  const job = await getLongformVideoJobById(jobId);
  status = job?.status ?? "failed";
  if (job?.stage && job.stage !== lastStage) {
    lastStage = job.stage;
    console.log(`[render] job ${jobId} → ${lastStage} (${((Date.now() - started) / 60_000).toFixed(1)} min)`);
  }
}
const job = await getLongformVideoJobById(jobId);
console.log(`[render] job ${jobId} ${status} after ${((Date.now() - started) / 60_000).toFixed(1)} min${job?.errorMessage ? ` — ${job.errorMessage}` : ""}`);
process.exit(status === "completed" ? 0 : 1);

/**
 * scripts/stress/run.mts — render a script on a channel N times in Video 1 tab, audit each film
 * against the seven rules (`audit.mts`), and log the verdicts.
 *
 *   npx tsx scripts/stress/run.mts --channel hank_hardwood --script scripts/stress/scripts/hank_hardwood.txt \
 *       --title "Stress: Hank" [--runs 3] [--rehearsal] [--books scripts/stress/books/x.json] [--host-minutes 3]
 *
 * Goes through the REAL `longformVideo.generate` route (as the bootstrap admin, user 1), so a
 * test job is built exactly like one from the form — channel photos, voice, books, QR — and
 * shows up in that account's Video tab `--slot` (0-4, default 0 = Video 1). The pipeline runs in THIS process, one job at
 * a time. Do not save server files while a job runs: a `tsx watch` dev server reloads and its
 * restart-resume would pick the job up a second time.
 */
import "dotenv/config";
import { ensureFontConfig } from "../../server/fontConfig";
import { resolveFFmpegPath } from "../../server/ffmpegPath";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { appRouter } from "../../server/routers";
import { getLongformVideoJobById, setLongformSlot } from "../../server/db";
import { auditJob, summarize } from "./audit.mts";

ensureFontConfig();
await resolveFFmpegPath();

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const channelKey = arg("channel");
const scriptFile = arg("script");
if (!channelKey || !scriptFile) {
  console.error("usage: --channel <key> --script <file> [--title T] [--runs N] [--rehearsal] [--books file.json]");
  process.exit(2);
}
const runs = Number(arg("runs") ?? 3);
const rehearsal = process.argv.includes("--rehearsal");
const title = arg("title") ?? `Stress: ${channelKey}`;
const hostMinutes = Number(arg("host-minutes") ?? 3);
/** Which Video tab (0-4) runs the job — each tab has its own APIMART / HeyGen keys. */
const slot = Number(arg("slot") ?? 0);
const booksFile = arg("books");
const ctaBooks = booksFile ? JSON.parse(readFileSync(booksFile, "utf8")) : undefined;
const script = readFileSync(scriptFile, "utf8");

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

const reportDir = path.join("scripts", "stress", "reports");
mkdirSync(reportDir, { recursive: true });
const log = (line: string) => {
  console.log(line);
  appendFileSync(path.join(reportDir, "summary.md"), line + "\n");
};

for (let k = 1; k <= runs; k++) {
  const started = Date.now();
  const { jobId } = await caller.longformVideo.generate({
    script,
    channelKey,
    // The real video title, as an operator would type it — it is the video's subject for every
    // picture, so a test label here would test the wrong thing. The run number rides after a dash.
    title: runs > 1 ? `${title} — run ${k}` : title,
    slotIndex: slot,
    ctaBooks,
    hostMinutes,
    rehearsal,
  });
  await setLongformSlot(1, slot, { jobId });
  console.log(`[stress] ${channelKey} run ${k}/${runs}: job ${jobId} started`);

  let status = "processing";
  let lastStage = "";
  while (status === "processing" || status === "pending") {
    await new Promise(r => setTimeout(r, 20_000));
    const job = await getLongformVideoJobById(jobId);
    status = job?.status ?? "failed";
    if (job?.stage && job.stage !== lastStage) {
      lastStage = job.stage;
      console.log(`[stress] job ${jobId} → ${lastStage}`);
    }
    if (Date.now() - started > 5 * 3600_000) {
      status = "timeout";
      break;
    }
  }
  const minutes = ((Date.now() - started) / 60_000).toFixed(0);
  const job = await getLongformVideoJobById(jobId);
  if (status !== "completed") {
    log(`\n### ${channelKey} run ${k} — job ${jobId}: ${status.toUpperCase()} after ${minutes} min\n    ${job?.errorMessage ?? ""}`);
    continue;
  }
  const report = await auditJob(jobId);
  log(`\n### ${channelKey} run ${k} — ${minutes} min\n\`\`\`\n${summarize(report)}\n\`\`\``);
}
process.exit(0);

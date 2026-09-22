// Trial of the delivery-run path: the script is voiced as N separate 69Labs generations (the
// shape a delivery plan produces), joined three ways — naive concat, `concatWithPauses` (which
// now matches run levels), and that join levelled — and each is measured.
// Usage: npx tsx scripts/_level-trial-runs.mts <outDir> <voiceId> <runs>
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  createTTSTask69Labs,
  pollTTSTask69Labs,
  downloadTTSAudio69Labs,
  DuplicateTTSError,
} from "../server/tts69labs";
import { storagePut } from "../server/storage";
import { concatWithPauses } from "../server/delivery";
import { runFfmpeg } from "../server/videoAssembly";
import {
  levelNarrationAudio,
  describeLevelPlan,
  measureLevelFrames,
  planLevelGains,
  speechLevelDb,
} from "../server/narrationLevel";

const [outDir, voiceId, runsArg] = process.argv.slice(2);
if (!outDir || !voiceId) {
  console.error(
    "Usage: npx tsx scripts/_level-trial-runs.mts <outDir> <voiceId> <runs>"
  );
  process.exit(1);
}
const nRuns = Number(runsArg ?? 4);
const apiKey = process.env.SIXTYNINE_LABS_API_KEY;
if (!apiKey) throw new Error("SIXTYNINE_LABS_API_KEY is not set");
mkdirSync(outDir, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  tries = 8
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const transport =
        e?.name === "TypeError" ||
        /fetch failed|ECONN|timeout|ETIMEDOUT/i.test(e?.message ?? "");
      if (!transport || i >= tries) throw e;
      console.warn(`  ${label}: ${e?.message} — retry ${i}/${tries} in 10s`);
      await sleep(10_000);
    }
  }
}

async function voice(text: string, taskFile: string): Promise<Buffer> {
  let taskId = existsSync(taskFile)
    ? readFileSync(taskFile, "utf8").trim()
    : "";
  if (taskId) console.log(`  resuming task ${taskId}`);
  else {
    try {
      taskId = await withRetry("submit", () =>
        createTTSTask69Labs(apiKey!, {
          text,
          voiceId,
          stability: 0.5,
          style: 0.3,
          similarity: 0.8,
        })
      );
    } catch (e: any) {
      if (e instanceof DuplicateTTSError && e.taskId) taskId = e.taskId;
      else throw e;
    }
    writeFileSync(taskFile, taskId);
    console.log(`  task ${taskId} submitted`);
  }
  const start = Date.now();
  for (;;) {
    await sleep(5000);
    const r = await withRetry("poll", () => pollTTSTask69Labs(apiKey!, taskId));
    if (r.status === "completed") break;
    if (r.status === "failed" || r.status === "censored")
      throw new Error(`TTS ${r.status}: ${r.error ?? ""}`);
    if (Date.now() - start > 25 * 60_000) throw new Error("TTS timed out");
  }
  const url = await withRetry("download-url", () =>
    downloadTTSAudio69Labs(apiKey!, taskId)
  );
  const resp = await withRetry("download", () => fetch(url));
  if (!resp.ok) throw new Error(`download HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/** Split at sentence ends into `n` runs of roughly equal length. */
function splitRuns(text: string, n: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)/g) ?? [text];
  const per = text.length / n;
  const runs: string[] = [];
  let cur = "";
  for (const s of sentences) {
    cur += s;
    if (cur.length >= per && runs.length < n - 1) {
      runs.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) runs.push(cur.trim());
  return runs;
}

async function report(label: string, path: string) {
  const frames = await measureLevelFrames(path);
  const p = planLevelGains(frames);
  console.log(
    `  ${label.padEnd(26)} speech ${speechLevelDb(frames).toFixed(1)} dBFS, ` +
      `2s-bin spread ${p.spreadBeforeDb} dB`
  );
}

const text = readFileSync(join(outDir, "script.txt"), "utf8");
const runs = splitRuns(text, nRuns);
console.log(
  `script ${text.length} chars → ${runs.length} runs: ${runs.map(r => r.length).join(" / ")} chars`
);

const runPaths: string[] = [];
const runUrls: string[] = [];
for (let i = 0; i < runs.length; i++) {
  const p = join(outDir, `run${i + 1}.mp3`);
  if (!existsSync(p)) {
    console.log(`run ${i + 1}: voicing…`);
    writeFileSync(p, await voice(runs[i], join(outDir, `run${i + 1}.task`)));
  }
  runPaths.push(p);
  // concatWithPauses downloads by URL exactly as the pipeline does — stage the runs on R2.
  const { url } = await storagePut(
    `trial/level-runs/${voiceId}/run${i + 1}.mp3`,
    readFileSync(p),
    "audio/mpeg"
  );
  runUrls.push(url);
  const frames = await measureLevelFrames(p);
  console.log(
    `  run ${i + 1}: speech level ${speechLevelDb(frames).toFixed(1)} dBFS`
  );
}

// A: the naive join — what the delivery path produced before this change.
const naive = join(outDir, "runs-A-naive-join.mp3");
await runFfmpeg([
  "-y",
  ...runPaths.flatMap(p => ["-i", p]),
  "-filter_complex",
  runPaths
    .map(
      (_, i) =>
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[r${i}]`
    )
    .join(";") +
    `;${runPaths.map((_, i) => `[r${i}]`).join("")}concat=n=${runPaths.length}:v=0:a=1[a]`,
  "-map",
  "[a]",
  "-c:a",
  "libmp3lame",
  "-b:a",
  "192k",
  naive,
]);
// B: the pipeline's join, with run matching (a 300 ms beat after run 1, 600 ms after run 3).
const pauses = runPaths.map((_, i) => (i === 0 ? 300 : i === 2 ? 600 : 0));
const matchedBuf = await concatWithPauses(runUrls, pauses);
const matched = join(outDir, "runs-B-matched-join.mp3");
writeFileSync(matched, matchedBuf);
// C: that join levelled — what a new render's master now is.
const { buffer, plan } = await levelNarrationAudio(matchedBuf);
const levelled = join(outDir, "runs-C-matched-and-levelled.mp3");
writeFileSync(levelled, buffer);
console.log(`  ${describeLevelPlan(plan)}`);

console.log("results:");
await report("A naive join (old)", naive);
await report("B matched join", matched);
await report("C matched + levelled (new)", levelled);
console.log("done");

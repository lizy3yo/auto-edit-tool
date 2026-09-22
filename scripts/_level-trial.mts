// One-off trial for the narration leveller: voice a script with a given 69Labs voice several
// times, level each take, and write raw + levelled mp3s beside their measurements.
// Usage: npx tsx scripts/_level-trial.mts <outDir> <voiceId> <takes> [scriptFile]
// If no scriptFile is given, <outDir>/source-audio.mp3 is transcribed (RunPod whisperx) and the
// text cached at <outDir>/script.txt. Takes already on disk are skipped, so it resumes.
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  createTTSTask69Labs,
  pollTTSTask69Labs,
  downloadTTSAudio69Labs,
  DuplicateTTSError,
} from "../server/tts69labs";
import { storagePut } from "../server/storage";
import { transcribeAudio } from "../server/_core/voiceTranscription";
import {
  levelNarrationAudio,
  describeLevelPlan,
  measureLevelFrames,
  planLevelGains,
} from "../server/narrationLevel";

const [outDir, voiceId, takesArg, scriptFile] = process.argv.slice(2);
if (!outDir || !voiceId) {
  console.error(
    "Usage: npx tsx scripts/_level-trial.mts <outDir> <voiceId> <takes> [scriptFile]"
  );
  process.exit(1);
}
const takes = Number(takesArg ?? 1);
const apiKey = process.env.SIXTYNINE_LABS_API_KEY;
if (!apiKey) throw new Error("SIXTYNINE_LABS_API_KEY is not set");
mkdirSync(outDir, { recursive: true });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getScript(): Promise<string> {
  const cached = join(outDir, "script.txt");
  if (scriptFile) return readFileSync(scriptFile, "utf8");
  if (existsSync(cached)) return readFileSync(cached, "utf8");
  const src = join(outDir, "source-audio.mp3");
  if (!existsSync(src))
    throw new Error(`no script file and no ${src} to transcribe`);
  console.log("transcribing source audio via whisperx…");
  const { url } = await storagePut(
    `transcription/temp-audio/${randomUUID()}.mp3`,
    readFileSync(src),
    "audio/mpeg"
  );
  const res = await transcribeAudio({ audioUrl: url } as any);
  if ("error" in res)
    throw new Error(`transcription failed: ${res.error} ${res.details ?? ""}`);
  writeFileSync(cached, res.text, "utf8");
  console.log(
    `transcript: ${res.text.length} chars, ${res.text.split(/\s+/).length} words`
  );
  return res.text;
}

/** The network to 69labs.vip drops intermittently here: retry a call on a transport error. */
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
  // A task id is persisted the moment it exists, so a dropped connection resumes the same job
  // instead of resubmitting (which 69Labs refuses as a duplicate and which would bill twice).
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
      if (e instanceof DuplicateTTSError && e.taskId) {
        console.log(`  duplicate names running task ${e.taskId} — adopting it`);
        taskId = e.taskId;
      } else throw e;
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

async function spreadOf(path: string): Promise<string> {
  const p = planLevelGains(await measureLevelFrames(path));
  return `${p.spreadBeforeDb} dB (p5..p95 of 2 s bins, level ${p.targetDb} dBFS)`;
}

const text = await getScript();
console.log(`script: ${text.length} chars`);
for (let t = 1; t <= takes; t++) {
  const raw = join(outDir, `take${t}-raw.mp3`);
  const lev = join(outDir, `take${t}-levelled.mp3`);
  if (existsSync(raw) && existsSync(lev)) {
    console.log(`take ${t}: already on disk`);
  } else {
    console.log(`take ${t}: voicing…`);
    const t0 = Date.now();
    const buf = await voice(text, join(outDir, `take${t}.task`));
    writeFileSync(raw, buf);
    console.log(
      `  raw ${buf.length} bytes in ${((Date.now() - t0) / 1000).toFixed(0)}s`
    );
    const { buffer, plan } = await levelNarrationAudio(buf);
    writeFileSync(lev, buffer);
    console.log(`  ${describeLevelPlan(plan)}`);
  }
  console.log(`  raw spread      : ${await spreadOf(raw)}`);
  console.log(`  levelled spread : ${await spreadOf(lev)}`);
}
console.log("done");

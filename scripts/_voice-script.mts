// Voice a script file as the pipeline voices a master narration — CTA marker lines stripped,
// one 69Labs request, dead-air pause cap, then the narration leveller — and write the mp3s.
// Usage: npx tsx scripts/_voice-script.mts <scriptFile> <outBase> <voiceId> [speed] [volume]
//   writes <outBase>-raw.mp3 (as the provider returned it) and <outBase>.mp3 (pause-capped +
//   levelled, i.e. what a new render's master is). The task id is persisted at <outBase>.task
//   so a dropped connection resumes the same job instead of paying for it twice.
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  createTTSTask69Labs,
  pollTTSTask69Labs,
  downloadTTSAudio69Labs,
  DuplicateTTSError,
} from "../server/tts69labs";
import { capDeadAirPauses } from "../server/ttsUnified";
import { stripCtaMarkerLines } from "../shared/ctaMarkers";
import {
  levelNarrationAudio,
  describeLevelPlan,
  measureLevelFrames,
  planLevelGains,
} from "../server/narrationLevel";

const [scriptFile, outBase, voiceId, speedArg, volumeArg] = process.argv.slice(2);
if (!scriptFile || !outBase || !voiceId) {
  console.error(
    "Usage: npx tsx scripts/_voice-script.mts <scriptFile> <outBase> <voiceId> [speed] [volume]"
  );
  process.exit(1);
}
const apiKey = process.env.SIXTYNINE_LABS_API_KEY;
if (!apiKey) throw new Error("SIXTYNINE_LABS_API_KEY is not set");
const speed = speedArg ? Number(speedArg) : undefined;
const volume = volumeArg ? Number(volumeArg) : undefined;
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

const text = stripCtaMarkerLines(readFileSync(scriptFile, "utf8"));
console.log(
  `spoken script: ${text.length} chars, ${text.split(/\s+/).length} words` +
    (speed ? `, speed ${speed}` : "") +
    (volume ? `, volume ${volume}` : "")
);

const taskFile = `${outBase}.task`;
let taskId = existsSync(taskFile) ? readFileSync(taskFile, "utf8").trim() : "";
if (taskId) console.log(`resuming task ${taskId}`);
else {
  try {
    taskId = await withRetry("submit", () =>
      createTTSTask69Labs(apiKey!, {
        text,
        voiceId,
        modelId: "eleven_multilingual_v2",
        speed,
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
  console.log(`task ${taskId} submitted`);
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
let raw = Buffer.from(await resp.arrayBuffer());
writeFileSync(`${outBase}-raw.mp3`, raw);
console.log(`raw ${raw.length} bytes → ${outBase}-raw.mp3`);

// The pipeline's own completion tail: the channel's volume gain would run here too, but this
// channel has none set.
if (volume !== undefined) {
  // Kept simple: the same static gain `applyVolumeGain` would apply.
  const { spawnSync } = await import("child_process");
  const { getFFmpegPath } = await import("../server/ffmpegPath");
  const inP = `${outBase}-vol-in.mp3`;
  const outP = `${outBase}-vol-out.mp3`;
  writeFileSync(inP, raw);
  const r = spawnSync(getFFmpegPath(), [
    "-y", "-i", inP, "-af", `volume=${volume}`, "-c:a", "libmp3lame", "-b:a", "192k",
    "-ar", "48000", "-ac", "2", outP,
  ]);
  if (r.status !== 0) throw new Error(`volume gain failed: ${r.stderr}`);
  raw = readFileSync(outP);
}
const capped = await capDeadAirPauses(raw);
const { buffer, plan } = await levelNarrationAudio(capped);
writeFileSync(`${outBase}.mp3`, buffer);
console.log(describeLevelPlan(plan));
const after = planLevelGains(await measureLevelFrames(`${outBase}.mp3`));
console.log(
  `levelled ${buffer.length} bytes → ${outBase}.mp3 (2s-bin spread now ${after.spreadBeforeDb} dB)`
);

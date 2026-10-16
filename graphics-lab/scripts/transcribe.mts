// Word-level timings for a job's master narration, from whisper.cpp running LOCALLY (Remotion's
// own captions toolchain) — no provider call, no cost. The app persists scene ranges but not
// word times, and a word-timed graphic is only as good as its clock.
//   tsx scripts/transcribe.mts --job 376 [--model medium.en]
// Writes out/jobs/<job>/words.json: [{ text, start, end }] in seconds of FILM time.
import path from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
  type WhisperModel,
} from "@remotion/install-whisper-cpp";
import { ffmpegPath, outDir, ROOT, run } from "./lib.mts";
import { loadJob } from "./job.mts";

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const jobId = Number(arg("--job", "376"));
const model = arg("--model", "medium.en") as WhisperModel;

const job = loadJob(jobId);
const dir = outDir("jobs", String(jobId));
const wav = path.join(dir, "master-16k.wav");
if (!existsSync(wav)) {
  // whisper.cpp wants 16 kHz mono PCM.
  await run(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-i", job.masterAudioUrl, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-y", wav]);
}

const whisperDir = path.join(ROOT, ".whisper");
await installWhisperCpp({ to: whisperDir, version: "1.7.6" });
await downloadWhisperModel({ folder: whisperDir, model });

const t0 = Date.now();
const out = await transcribe({
  inputPath: wav,
  whisperPath: whisperDir,
  whisperCppVersion: "1.7.6",
  model,
  tokenLevelTimestamps: true,
  splitOnWord: true,
  printOutput: false,
});
const { captions } = toCaptions({ whisperCppOutput: out });
const words = captions
  .map(c => ({ text: c.text.trim(), start: c.startMs / 1000, end: c.endMs / 1000 }))
  .filter(w => w.text.length > 0);
writeFileSync(path.join(dir, "words.json"), JSON.stringify(words, null, 1));
console.log(`${words.length} words in ${((Date.now() - t0) / 1000).toFixed(1)} s (${model})`);
console.log(words.slice(0, 12).map(w => `${w.start.toFixed(2)} ${w.text}`).join("\n"));

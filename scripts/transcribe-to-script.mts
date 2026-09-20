/**
 * Recover a SCRIPT from a finished film's audio, for `voice-read-test.mts --script-file` when
 * the job that made the film is not in this database (a production render).
 *
 *   npx tsx scripts/transcribe-to-script.mts --audio narration.mp3 --out script.txt
 *
 * A transcript has no paragraph breaks, so they are recovered from the PAUSES: the film's own
 * delivery plan spliced a beat after its paragraphs, so the longest gaps between whisperx
 * segments are where the author's paragraphs ended. An approximation, and the transcriber
 * mishears proper nouns and numerals — good enough to compare read modes on, not a substitute
 * for the real script when that is available.
 */
import "dotenv/config";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { getFFmpegPath } from "../server/ffmpegPath";
import { storagePut } from "../server/storage";
import { transcribeAudio } from "../server/_core/voiceTranscription";
import { buildMonoDownsampleArgs } from "../server/videoAssembly";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const audio = arg("audio");
const out = arg("out");
if (!audio || !out) {
  console.error("usage: --audio <file> --out <script.txt>");
  process.exit(1);
}

/** A gap this long between segments ends a paragraph, once it has some body to it. */
const PARAGRAPH_GAP_SEC = 0.6;
const MIN_PARAGRAPH_WORDS = 30;
/** Past this a paragraph ends at the next sentence end, gap or not. */
const MAX_PARAGRAPH_WORDS = 110;

const dir = mkdtempSync(path.join(os.tmpdir(), "transcribe-"));
const mono = path.join(dir, "mono16k.mp3");
execFileSync(
  getFFmpegPath(),
  buildMonoDownsampleArgs({ inputPath: audio, outputPath: mono }),
  { stdio: "ignore" }
);
const { url } = await storagePut(
  `transcription/temp-audio/voice-read-test-${Date.now()}.mp3`,
  readFileSync(mono),
  "audio/mpeg"
);
console.log(`transcribing ${path.basename(path.dirname(audio))} …`);
const r = await transcribeAudio({ audioUrl: url });
if ("error" in r) throw new Error(`${r.error}: ${r.details ?? ""}`);

const paragraphs: string[] = [];
let cur: string[] = [];
const words = () => cur.join(" ").split(/\s+/).filter(Boolean).length;
const flush = () => {
  if (cur.length) paragraphs.push(cur.join(" ").replace(/\s+/g, " ").trim());
  cur = [];
};
r.segments.forEach((s, i) => {
  cur.push(s.text.trim());
  const next = r.segments[i + 1];
  const gap = next ? next.start - s.end : 0;
  const endsSentence = /[.!?]["']?$/.test(s.text.trim());
  if (
    (gap >= PARAGRAPH_GAP_SEC && words() >= MIN_PARAGRAPH_WORDS) ||
    (endsSentence && words() >= MAX_PARAGRAPH_WORDS)
  )
    flush();
});
flush();

writeFileSync(out, paragraphs.join("\n\n") + "\n");
console.log(
  `${paragraphs.length} paragraph(s), ${r.text.split(/\s+/).length} words → ${out}`
);
process.exit(0);

/**
 * scripts/voice-bench-advise.mts — the "ask Claude" step of the voice-settings loop.
 *
 *   npx tsx scripts/voice-bench-advise.mts --results DIR/results.jsonl --round round1.json --out round2.json [--notes "..."]
 *
 * Hands Opus one round of scripts/voice-bench.mts results — every variant's dials and every
 * measure, beside the Bertha benchmark — and asks for the NEXT round: a diagnosis per channel and
 * the variants worth testing, as a variants file voice-bench.mts runs as is. The photos and face
 * boxes are carried over from the round given. Prints Claude's reasoning; writes the file.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { invokeClaude } from "../server/claude";

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const resultsFile = opt("--results");
const roundFile = opt("--round");
const out = opt("--out");
if (!resultsFile || !roundFile || !out) {
  console.error("usage: npx tsx scripts/voice-bench-advise.mts --results FILE --round FILE --out FILE [--notes TEXT]");
  process.exit(2);
}
const round = JSON.parse(readFileSync(roundFile, "utf8"));
const rows = readFileSync(resultsFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(l => {
    const { words, heard, at, ...r } = JSON.parse(l);
    return r;
  });

const SYSTEM = `You are a senior voice and lip-sync engineer tuning text-to-speech for AI talking-head YouTube hosts.
The pipeline: 69Labs TTS (a reseller of ElevenLabs; account voice CLONES run on MiniMax instead) -> HeyGen Avatar IV lip-sync from one host photo.
The goal is the benchmark competitor, Bertha Ramirez: a calm, even read and a mouth that moves with the words and rests in the pauses.

What can be set:
- ElevenLabs voices (ids like "XK2D1dLhRyHHPpQiW5WK"): model (eleven_multilingual_v2, eleven_turbo_v2_5, eleven_flash_v2_5, eleven_v3, eleven_v4), speed 0.7-1.2 ONLY (69Labs refuses anything else), stability 0-1, similarity 0-1, style 0-1, boost (speaker boost) true/false. ElevenLabs' own default is 0.5 / 0.75 / style 0 / boost on, and it advises style 0.
- Clone voices (MiniMax): model speech-02-hd (today) or speech-2.8-hd / speech-2.8-turbo, speed 0.5-2, pitch -12..12. Stability/style/similarity do not exist for them.
Today's production settings: stability 0.5, style 0.3, similarity 0.8, no speaker boost; Dale on eleven_v4, Hank at speed 0.8, Frederick and Scarlett are clones on speech-02-hd at their default speed.

Measures, per ~15 s take of the same line:
- dur, wps (words a second; Bertha's calm read is roughly 2.4-2.7), pauses (stops >= 150 ms), longestPause
- wer (0 = every word said), gapDb (loudest pause between words against the speech level; above -35 dB means a breath or mouth noise is audible in it), noisyGaps/gaps
- f0 (median pitch Hz), pitchRangeSt (10-90% pitch range in semitones; Bertha reads 6.2 - a wider range is a more "performed", sing-song read)
- lufs (loudness of the take; the film is normalised later, so only a guide)
- syncR (how well the mouth follows the voice, Bertha 0.30), syncLagMs (negative = mouth leads the sound, natural is -40..-120), syncFarR (out-of-sync control, should be well under syncR), silentMouth (mouth movement in pauses / in speech; lower is better), syncPass (the review's pass rule).
Measurement notes: one take each, and HeyGen renders of one input vary by up to +-40%, so a single number is weak evidence. Dale's mouth is under a full beard and the mouth measure reads him poorly (low r for every take) - judge Dale on the voice measures and do not chase his sync number. 69Labs refuses an identical line for the same voice while one is in flight, and the bench then reused audio: two variants with byte-identical numbers were the SAME take (dale-d-v2-stable is a copy of dale-c-v2 and was never really tested).

Answer with ONE JSON object and nothing else:
{"diagnosis": {"<channel>": "<two or three plain sentences>"}, "generalRule": "<the settings rule you would apply to EVERY channel, if the evidence supports one, and what is still unproven>", "variants": [{"id": "<short-kebab, unique, prefix with the channel's first name>", "ch": "<channelKey>", "model"?: "...", "speed"?: n, "stability"?: n, "style"?: n, "similarity"?: n, "boost"?: bool, "pitch"?: n, "why": "<one line>"}]}
Plan at most 14 takes. Include repeats (same settings, new id) where a winner rests on one take, and the current settings once per channel as the control. Leave out what the evidence already rules out.`;

const user =
  `Round results (JSON lines):\n${rows.map(r => JSON.stringify(r)).join("\n")}\n\n` +
  (opt("--notes") ? `Operator / engineer notes: ${opt("--notes")}\n` : "");

const res = await invokeClaude({
  systemPrompt: SYSTEM,
  userMessage: user,
  maxTokens: 6000,
  extendedThinking: true,
  step: "Voice bench advice",
});
const text = (res as any).text ?? (res as any).content ?? "";
const json = JSON.parse(String(text).slice(String(text).indexOf("{"), String(text).lastIndexOf("}") + 1));
console.log(JSON.stringify({ diagnosis: json.diagnosis, generalRule: json.generalRule }, null, 2));
for (const v of json.variants) console.log(`  ${v.id.padEnd(22)} ${v.why}`);
writeFileSync(
  out,
  JSON.stringify({ photos: round.photos, boxes: round.boxes, advice: { diagnosis: json.diagnosis, generalRule: json.generalRule }, variants: json.variants }, null, 1)
);
process.exit(0);

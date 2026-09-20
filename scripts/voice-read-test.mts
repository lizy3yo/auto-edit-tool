/**
 * Voice-read A/B — the narration lane in isolation.
 *
 * Voices one job's script through the REAL `voiceMasterNarration` in a chosen read mode
 * (`shared/voiceRead.ts`) and writes the master mp3 to disk. No storyboard, no clips, no
 * assembly, no job-row writes — so it costs one narration instead of a film, and the only thing
 * that differs between two runs is how the script was cut up before it was sent.
 *
 *   npx tsx scripts/voice-read-test.mts --job 106 --mode paragraphs --out ./out
 *   npx tsx scripts/voice-read-test.mts --job 106 --mode oneTake    --out ./out
 *
 * For a film whose job is not in this database (a production render), pass the script recovered
 * by `transcribe-to-script.mts` and the channel whose voice should read it:
 *
 *   npx tsx scripts/voice-read-test.mts --script-file script.txt --channel hank_hardwood  *     --mode paragraphs --out ./out
 *
 * The script, voice and dials come from the job's own `inputParams` (or, with `--channel`, from
 * the channel row the way the generate route reads it), i.e. exactly what a render would use. The delivery plan is non-deterministic, so the first run saves it to
 * `<out>/delivery-plan.json` and later runs reuse it — otherwise an A/B would compare two
 * different plans as well as two read modes.
 *
 * Nothing here is mocked: it spends real TTS credits (and one Claude call for the plan).
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { getChannelConfig, getLongformVideoJobById } from "../server/db";
import {
  parseCtaMarkers,
  resolveTTSVendor,
  voiceMasterNarration,
} from "../server/longformVideo";
import { planDelivery, paragraphRuns, deliveryRuns } from "../server/delivery";
import { presignOwnBucketUrl } from "../server/storage";
import { parseVolumeMultiplier } from "../server/ttsUnified";
import { extractSpokenScript } from "../shared/ctaMarkers";
import { VOICE_READ_MODES, type VoiceReadMode } from "../shared/voiceRead";
import type { LongformInputParams } from "../shared/types";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const jobId = Number(arg("job")) || 0;
const scriptFile = arg("script-file");
const channelKey = arg("channel");
const mode = arg("mode") as VoiceReadMode;
const outDir = path.resolve(arg("out") ?? "./voice-read-test");
if (
  (!jobId && !(scriptFile && channelKey)) ||
  !VOICE_READ_MODES.includes(mode)
) {
  console.error(
    `usage: (--job <id> | --script-file <txt> --channel <channelKey>) ` +
      `--mode <${VOICE_READ_MODES.join("|")}> [--out dir]`
  );
  process.exit(1);
}

let params: LongformInputParams;
if (jobId) {
  const job = await getLongformVideoJobById(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  params = { ...(job.inputParams as LongformInputParams) };
} else {
  const channel = await getChannelConfig(channelKey!);
  if (!channel) throw new Error(`channel ${channelKey} not found`);
  if (!channel.voiceId) throw new Error(`channel ${channelKey} has no voice`);
  // The same reads the generate route does, so the dials match a render's.
  const speed = parseFloat(channel.ttsSpeed ?? "");
  params = {
    script: readFileSync(scriptFile!, "utf8"),
    voiceId: channel.voiceId,
    ttsModel: channel.ttsModel || "eleven_multilingual_v2",
    ttsSpeed: speed >= 0.7 && speed <= 1.2 ? speed : undefined,
    ttsVolume: parseVolumeMultiplier(channel.ttsVolume),
    hostName: channel.hostName ?? undefined,
  } as LongformInputParams;
}
// Voice it, whatever the source job did.
delete params.manualNarrationUrl;
params.ttsReadMode = mode;

const { script: spokenScript } = parseCtaMarkers(
  extractSpokenScript(params.script)
);

mkdirSync(outDir, { recursive: true });
const planPath = path.join(outDir, "delivery-plan.json");
if (existsSync(planPath)) {
  params.deliveryPlan = JSON.parse(readFileSync(planPath, "utf8"));
  console.log(`delivery plan: reused ${planPath}`);
} else {
  const plan = await planDelivery(spokenScript, {
    hostName: params.hostName,
    log: m => console.log(m),
  });
  if (plan) {
    params.deliveryPlan = plan;
    writeFileSync(planPath, JSON.stringify(plan, null, 2));
  }
}

const requests =
  mode === "paragraphs"
    ? paragraphRuns(spokenScript, params.deliveryPlan).length
    : mode === "auto" && params.deliveryPlan
      ? deliveryRuns(spokenScript, params.deliveryPlan).length
      : 1;
console.log(
  `voicing ${jobId ? `job ${jobId}'s script` : scriptFile} (${spokenScript.length} chars) as "${mode}" — ` +
    `about ${requests} TTS request(s)`
);

const started = Date.now();
const { providerType, apiKey } = await resolveTTSVendor(params);
// A fake job id far from any real row: it only names the R2 key and the log lines.
const { url } = await voiceMasterNarration(
  900000 + jobId,
  providerType,
  apiKey,
  spokenScript,
  params
);

// `*.r2.dev` is blocked on a lot of networks — read our own object through the S3 endpoint.
const resp = await fetch(await presignOwnBucketUrl(url));
if (!resp.ok) throw new Error(`download failed: HTTP ${resp.status}`);
const file = path.join(outDir, `narration-${mode}.mp3`);
writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
console.log(
  `done in ${Math.round((Date.now() - started) / 1000)}s → ${file}\n   (${url})`
);
process.exit(0);

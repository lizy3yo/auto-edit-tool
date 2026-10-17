/**
 * scripts/host-photo-bench.mts — which BASE PHOTO gives a host the best talking head? (2026-10-15)
 *
 *   npx tsx scripts/host-photo-bench.mts --channel KEY --variants FILE.json --out DIR [--only id,id]
 *
 * The review found two host problems that live in the photo HeyGen animates: Frederick's lower
 * teeth smear when his mouth opens wide (his lips sit inside a beard, so the lip-sync model invents
 * the lower teeth), and Scarlett's skin is too smooth (an airbrushed photo stays airbrushed). This
 * bench holds everything else still and changes only the photo:
 *
 *   1. ONE ~10 s line is voiced once in the channel's own voice and reused for every variant.
 *   2. Each variant is a photo: "original" (the channel's photo as uploaded), "phone" (its phone
 *      look), or an INSTRUCTION — a new base photo made from the channel's photo by the phone-look
 *      recipe plus that instruction (`makePhoneLookPhoto(url, extra)`: same draw, the same framing
 *      lock, quality and real-skin checks a film's photo gets).
 *   3. Each photo is scored as the picker scores it (`rateHostPhoto`).
 *   4. Each is lip-synced on HeyGen's TEST account (never a film's account) with the production
 *      call, steadied like a film's host take.
 *   5. The clip is measured: lower-teeth edges and flicker on the widest-open frames
 *      (`measure-mouth-smear.mts`, pass ≥ 0.85), and the SKIN judged on frames of the rendered
 *      video itself (what a viewer sees, not the photo).
 *
 * Variants file: [{ "id": "f2", "photo": "original" | "phone" | "<instruction>" }]
 * Results append to <out>/results.jsonl; a variant already there is skipped, so a run can resume.
 * --repeat N renders a variant N times (renders of one input vary; judge on the median).
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { getChannelConfig, getChannelHostPhotos } from "../server/db";
import { createUnifiedTTSTask, parseVolumeMultiplier, pollUnifiedTTSTask } from "../server/ttsUnified";
import { getHeygenTestKey, heygenKeyForJob, NARRATION_DENOISE_FILTER, resolveTTSVendor } from "../server/longformVideo";
import { HeygenLipsyncAdapter } from "../server/providers/heygen-lipsync";
import { steadyHostClip } from "../server/hostSteady";
import { presignOwnBucketUrl, storagePut } from "../server/storage";
import { makePhoneLookPhoto } from "../server/hostPhoneLook";
import { judgeHostPhoto, measureHostPhoto, rateHostPhoto } from "../server/hostPhotoScore";
import { pickHostPhoto } from "../server/hostPhotoSelection";
import { syncChannelHostPhoto } from "../server/hostPhotoChoice";
import { usablePhoneLook } from "../shared/hostPhotoLook";
import type { LongformInputParams } from "../shared/types";

const require = createRequire(import.meta.url);
const FF: string = require("ffmpeg-static");

/** ~10 s, rich in wide-open vowels and "f/v/th" sounds, where a smeared lower mouth shows. */
export const PHOTO_BENCH_LINE =
  "Hi, it's good to see you again. Today I want to talk about one simple habit that makes a real " +
  "difference, and why so many of us have been doing it the hard way for years.";
/**
 * Repeat k speaks line k: HeyGen hands back the SAME video for the same photo and audio (two
 * "repeats" measured identically to three decimals), so a repeat on one line proves nothing.
 * Different words also test more mouth shapes. Each ~10 s, open vowels and lip sounds.
 */
export const PHOTO_BENCH_LINES = [
  PHOTO_BENCH_LINE,
  "Now here's what I wish somebody had told me sooner. Watch what happens when you slow down, " +
    "pay attention to the small details, and give it one more honest try.",
  "So try it this week, on your own, at your own pace. Then come back and tell me how it went, " +
    "because I really do read every one of your comments.",
];

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const CH = opt("--channel");
const FILE = opt("--variants");
const OUT = opt("--out") ?? `bench/host-fix/${CH}`;
const ONLY = opt("--only")?.split(",");
const REPEAT = +(opt("--repeat") ?? 1);
if (!CH || !FILE) {
  console.error("usage: npx tsx scripts/host-photo-bench.mts --channel KEY --variants FILE --out DIR");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const RESULTS = path.join(OUT, "results.jsonl");
const done = new Set(
  existsSync(RESULTS) ? readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).run) : []
);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ff = (args: string[]) => {
  const r = spawnSync(FF, ["-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error(String(r.stderr).slice(-300));
  return r;
};
const load = async (url: string) => {
  const r = await fetch(await presignOwnBucketUrl(url), { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

/** The line in the channel's own voice — the request a film makes, the film's own clean-up. */
async function voiceLine(li = 0): Promise<string> {
  const urlFile = path.join(OUT, li ? `voice-${li + 1}.url` : "voice.url");
  if (existsSync(urlFile)) return readFileSync(urlFile, "utf8").trim();
  const channel = await getChannelConfig(CH!);
  if (!channel?.voiceId) throw new Error(`${CH}: no voice`);
  const { providerType, apiKey } = await resolveTTSVendor({ ttsVendor: "sixtynine_labs", voiceId: channel.voiceId } as LongformInputParams);
  const speed = channel.ttsSpeed ? parseFloat(channel.ttsSpeed) : undefined;
  const taskId = await createUnifiedTTSTask(providerType, apiKey, {
    text: PHOTO_BENCH_LINES[li],
    voiceId: channel.voiceId,
    ...(/^[0-9a-f-]{36}$/i.test(channel.voiceId) ? { speed } : { modelId: channel.ttsModel ?? "eleven_multilingual_v2", speed }),
  } as any);
  const started = Date.now();
  let raw: Buffer | undefined;
  while (!raw && Date.now() - started < 10 * 60_000) {
    await sleep(4000);
    const r = await pollUnifiedTTSTask(providerType, apiKey, taskId, parseVolumeMultiplier(channel.ttsVolume));
    if (r.status === "completed" && r.audioUrl) raw = Buffer.from(await (await fetch(r.audioUrl)).arrayBuffer());
    else if (r.status === "failed" || r.status === "censored") throw new Error(r.error ?? r.status);
  }
  if (!raw) throw new Error("TTS timed out");
  const tag = li ? `-${li + 1}` : "";
  writeFileSync(path.join(OUT, `voice${tag}.raw.mp3`), raw);
  const mp3 = path.join(OUT, `voice${tag}.mp3`);
  ff(["-y", "-i", path.join(OUT, `voice${tag}.raw.mp3`), "-af", NARRATION_DENOISE_FILTER, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", "-ac", "2", mp3]);
  const { url } = await storagePut(`host-photo-bench/${CH}/voice-${Date.now()}.mp3`, readFileSync(mp3), "audio/mpeg");
  writeFileSync(urlFile, url);
  return url;
}

/** The skin as a viewer sees it: three frames of the rendered clip, judged, the median kept. */
async function clipSkin(mp4: string): Promise<number | null> {
  const grades: number[] = [];
  for (const t of [1.5, 4, 7]) {
    const r = spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { maxBuffer: 1 << 27 });
    if (r.status !== 0 || !r.stdout?.length) continue;
    const frame = Buffer.from(r.stdout);
    const j = await judgeHostPhoto(frame, await measureHostPhoto(frame));
    if (j.skin != null) grades.push(j.skin);
  }
  grades.sort();
  return grades.length ? grades[grades.length >> 1] : null;
}

/** One photo per variant, shared by all its renders (renders start together — without this each drew its own). */
const photoJobs = new Map<string, Promise<string>>();
function photoFor(v: { id: string; photo: string; from?: string }): Promise<string> {
  let job = photoJobs.get(v.id);
  if (!job) {
    job = makePhotoFor(v);
    photoJobs.set(v.id, job);
    job.catch(() => photoJobs.delete(v.id));
  }
  return job;
}
async function makePhotoFor(v: { id: string; photo: string; from?: string }): Promise<string> {
  const cached = path.join(OUT, `${v.id}.photo.url`);
  if (existsSync(cached)) return readFileSync(cached, "utf8").trim();
  // the channel's ONE photo, exactly as the app picks it (scores any photo not scored yet)
  await syncChannelHostPhoto(CH!);
  const rows = await getChannelHostPhotos(CH!, true);
  const base = pickHostPhoto(rows) ?? rows[0];
  if (!base) throw new Error(`${CH}: no host photo`);
  // `from`: build on an earlier variant's photo (round 2 starts from round 1's best)
  const start = v.from ? readFileSync(path.join(OUT, `${v.from}.photo.url`), "utf8").trim() : base.imageUrl;
  const url =
    v.photo === "original"
      ? base.imageUrl
      : v.photo === "phone"
        ? usablePhoneLook(base) ?? (await makePhoneLookPhoto(base.imageUrl))
        : await makePhoneLookPhoto(start, v.photo);
  writeFileSync(cached, url);
  await sharp(await load(url)).resize(960).jpeg({ quality: 88 }).toFile(path.join(OUT, `${v.id}.photo.jpg`));
  return url;
}

async function run(v: { id: string; photo: string; from?: string }, take: number, audioUrl: string) {
  const runId = REPEAT > 1 ? `${v.id}${argv.includes("--lines-mode") ? "@L" : "#"}${take}` : v.id;
  if (done.has(runId)) return;
  try {
    const photoUrl = await photoFor(v);
    const rated = await rateHostPhoto(await load(photoUrl));
    // the HeyGen TEST account first; with none set, pool account 1 (as the HeyGen test page does
    // when there is no test key), then the shared fallback key
    const key =
      (await getHeygenTestKey()) ??
      (await heygenKeyForJob({ heygenAccount: 1 } as any)) ??
      process.env.HEYGEN_API_KEY ??
      null;
    if (!key) throw new Error("no HeyGen key");
    const heygen = new HeygenLipsyncAdapter(key);
    const sub = await heygen.submitLipsync({ imageUrl: photoUrl, audioUrl });
    if (!sub.taskId) throw new Error(sub.error ?? "HeyGen refused");
    const r = await heygen.pollVideo(sub.taskId);
    if (!r.success || !r.fileData?.length) throw new Error(r.error ?? "HeyGen failed");
    const mp4 = path.join(OUT, `${runId.replace(/[#@]/, "-")}.mp4`);
    writeFileSync(mp4, await steadyHostClip(Buffer.from(r.fileData), `photo bench ${runId}`));
    const jsonl = path.join(OUT, "smear.jsonl");
    const tsx = path.resolve("node_modules/.bin/tsx" + (process.platform === "win32" ? ".cmd" : ""));
    spawnSync(tsx, ["scripts/measure-mouth-smear.mts", jsonl, mp4, "--sheet", OUT], { shell: process.platform === "win32" });
    const smear = JSON.parse(readFileSync(jsonl, "utf8").trim().split("\n").pop()!);
    const row = {
      run: runId,
      id: v.id,
      photo: v.photo.length > 60 ? `${v.photo.slice(0, 60)}…` : v.photo,
      photoUrl,
      photoScore: rated.score,
      photoSkin: rated.judged?.skin ?? null,
      photoMouth: rated.judged?.mouth ?? null,
      photoNotes: rated.notes,
      clipSkin: await clipSkin(mp4),
      teethEdges: smear.teethEdges ?? null,
      teethFrames: smear.teethFrames ?? 0,
      flicker: smear.flicker ?? null,
      mouthPass: smear.pass ?? null,
      at: new Date().toISOString(),
    };
    appendFileSync(RESULTS, JSON.stringify(row) + "\n");
    console.log(JSON.stringify(row));
  } catch (e: any) {
    console.error(`${runId}: ${e?.message ?? e}`);
  }
}

const variants = (JSON.parse(readFileSync(FILE, "utf8")) as { id: string; photo: string; from?: string }[]).filter(
  v => !ONLY || ONLY.includes(v.id)
);
/** --lines-mode: repeat k speaks line k (independent renders); without it every take speaks line 1. */
const MULTI = argv.includes("--lines-mode");
const audio: string[] = [];
for (let li = 0; li < (MULTI ? Math.min(REPEAT, PHOTO_BENCH_LINES.length) : 1); li++) audio.push(await voiceLine(li));
console.log(`[bench] ${CH}: ${audio.length} line(s) voiced`);
const jobs = variants.flatMap(v =>
  Array.from({ length: REPEAT }, (_, i) => () => run(v, i + 1, audio[MULTI ? i % audio.length : 0]))
);
// three at a time keeps the HeyGen test account well inside its concurrency cap
for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3).map(j => j()));
process.exit(0);

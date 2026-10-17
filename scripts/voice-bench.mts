/**
 * scripts/voice-bench.mts — voice settings A/B for host channels, judged on the mouth.
 *
 *   npx tsx scripts/voice-bench.mts --variants round1.json --out bench/round1 [--heygen] [--only id,id]
 *
 * One fixed ~15 s line is voiced through 69Labs for every variant (same request a film makes,
 * with the dials the variant names), cleaned with the film's own hiss filter, and measured:
 *   words   — every word of the line said (WhisperX), as a word error rate
 *   pace    — words per second over the take
 *   pauses  — how many stops ≥ 150 ms, and the longest
 *   gap     — the loudest pause between words (its middle half), against the speech level, and how
 *             many pauses carry an audible sound (breaths, mouth noise —
 *             what makes a lip-sync model move a mouth while nothing is said)
 *   pitch   — median and the 10-90% range in semitones (a "performed" read swings wider)
 *   LUFS    — loudness of the take
 * With --heygen each take is also lip-synced on the account the HeyGen test page would pick (the
 * Test account, else the least busy one), from the channel photo the variant names, steadied like
 * a film's host take, and scored by
 * scripts/measure-mouth-sync.mts — the ruler the competitor review scored Bertha by.
 *
 * Variants file: { "photos": { channelKey: url }, "boxes"?: { channelKey: "x,y,size" }, "line"?: text,
 *   "variants": [{ id, ch, model?, speed?,
 *   stability?, style?, similarity?, boost?, pitch?, line?, debreath? }] } — anything left out is what a film
 *   sends today (the channel's model/speed/volume, the TTS_* dials and speaker boost for ElevenLabs
 *   voices, the sentence pause for clones). To compare with the settings before 2026-10-16 pass
 *   style 0.3, similarity 0.8, boost false (ElevenLabs) or pauseMark 0 (clones).
 * Results append to <out>/results.jsonl; a variant already there is skipped, so a run can resume.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getChannelConfig } from "../server/db";
import {
  createUnifiedTTSTask,
  parseVolumeMultiplier,
  pollUnifiedTTSTask,
} from "../server/ttsUnified";
import {
  getHeygenSlotKey,
  getHeygenTestKey,
  NARRATION_DENOISE_FILTER,
  resolveTTSVendor,
  TTS_SIMILARITY,
  TTS_SPEAKER_BOOST,
  TTS_STABILITY,
  TTS_STYLE,
} from "../server/longformVideo";
import { HeygenLipsyncAdapter } from "../server/providers/heygen-lipsync";
import { steadyHostClip } from "../server/hostSteady";
import { storagePut } from "../server/storage";
import { padSentenceEnds } from "../server/sentencePauses";
import { transcribeWordsFromBuffer } from "../server/_core/voiceTranscription";
import { accountLoad, configuredAccounts } from "../server/accountPool";
import { ENV } from "../server/_core/env";
import { heygenAccountLabel, pickHeygenTestAccount } from "../shared/heygenTest";
import type { LongformInputParams } from "../shared/types";

const require = createRequire(import.meta.url);
const FF: string = require("ffmpeg-static");

export const BENCH_LINE =
  "Here's the thing most people get wrong. You don't need a big budget, fancy tools, " +
  "or a whole free weekend. Start with one small project, give it twenty minutes, and " +
  "see how it feels. Simple, right? That's exactly how I started.";

interface Variant {
  id: string;
  ch: string;
  model?: string;
  speed?: number;
  stability?: number;
  style?: number;
  similarity?: number;
  boost?: boolean;
  pitch?: number;
  /** Another line to voice instead of the file's (or BENCH_LINE) — a winner must hold on new words. */
  line?: string;
  /** false: skip the film's sentence-pause step (server/sentencePauses.ts) — on by default, as in a film. */
  sentencePauses?: boolean;
  /** Turn the pauses between words down (see `debreath`) before HeyGen hears the take. */
  debreath?: boolean;
  /** Reuse another variant's voiced take (listed earlier, same channel) — an A/B of one take. */
  from?: string;
  /** Clone voices: the pause after each sentence, seconds (unset = the film's CLONE_SENTENCE_PAUSE_SEC, 0 = none). */
  pauseMark?: number;
}

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const file = opt("--variants");
const OUT = opt("--out") ?? "bench/voice";
const HEYGEN = argv.includes("--heygen");
const ONLY = opt("--only")?.split(",");
if (!file) {
  console.error("usage: npx tsx scripts/voice-bench.mts --variants FILE --out DIR [--heygen] [--only id,id]");
  process.exit(2);
}
const spec = JSON.parse(readFileSync(file, "utf8")) as {
  photos: Record<string, string>;
  boxes?: Record<string, string>;
  /** The line every variant voices unless it names its own. */
  line?: string;
  variants: Variant[];
};
mkdirSync(OUT, { recursive: true });
const RESULTS = path.join(OUT, "results.jsonl");
const lineFor = (v: Variant) => v.line ?? spec.line ?? BENCH_LINE;
const done = new Set(
  existsSync(RESULTS)
    ? readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).id)
    : []
);

const ff = (args: string[]) => {
  const r = spawnSync(FF, ["-hide_banner", ...args], { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error(String(r.stderr).slice(-300));
  return r;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "  twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
/** The transcript writes "20" for "twenty"; spell numbers under 100 so that is not a missed word. */
const spell = (t: string) => {
  const n = /^\d+$/.test(t) ? +t : NaN;
  if (!(n < 100)) return [t];
  return n < 20 ? [ONES[n]] : [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
};
const norm = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).flatMap(spell);
function wordErrorRate(ref: string[], hyp: string[]): number {
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
  for (let j = 1; j <= hyp.length; j++) d[0][j] = j;
  for (let i = 1; i <= ref.length; i++)
    for (let j = 1; j <= hyp.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return d[ref.length][hyp.length] / ref.length;
}

/** Voice one variant exactly as a film would ask for it, plus the variant's dials. */
async function voice(v: Variant): Promise<Buffer> {
  const channel = await getChannelConfig(v.ch);
  if (!channel?.voiceId) throw new Error(`${v.ch}: no voice`);
  const { providerType, apiKey } = await resolveTTSVendor({
    ttsVendor: "sixtynine_labs",
    voiceId: channel.voiceId,
  } as LongformInputParams);
  const isClone = /^[0-9a-f-]{36}$/i.test(channel.voiceId);
  const channelSpeed = channel.ttsSpeed ? parseFloat(channel.ttsSpeed) : undefined;
  const speed = v.speed ?? channelSpeed;
  const taskId = await createUnifiedTTSTask(providerType, apiKey, {
    text: lineFor(v),
    voiceId: channel.voiceId,
    ...(isClone
      ? {
          // the clone lane only honours a model when voiceProvider says minimax
          ...(v.model ? { voiceProvider: "minimax" as const, modelId: v.model } : {}),
          speed,
          // the adapter adds the film's sentence pause (CLONE_SENTENCE_PAUSE_SEC); 0 = without
          ...(v.pauseMark !== undefined ? { sentencePauseSec: v.pauseMark } : {}),
          ...(v.pitch !== undefined ? { minimaxSettings: { pitch: v.pitch } } : {}),
        }
      : {
          modelId: v.model ?? channel.ttsModel ?? "eleven_multilingual_v2",
          speed,
          stability: v.stability ?? TTS_STABILITY,
          style: v.style ?? TTS_STYLE,
          similarity: v.similarity ?? TTS_SIMILARITY,
          speakerBoost: v.boost ?? TTS_SPEAKER_BOOST,
        }),
  });
  const started = Date.now();
  while (Date.now() - started < 10 * 60_000) {
    await sleep(4000);
    const r = await pollUnifiedTTSTask(providerType, apiKey, taskId, parseVolumeMultiplier(channel.ttsVolume));
    if (r.status === "completed" && r.audioUrl) {
      const res = await fetch(r.audioUrl);
      if (!res.ok) throw new Error(`download ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    if (r.status === "failed" || r.status === "censored") throw new Error(r.error ?? r.status);
  }
  throw new Error("TTS timed out");
}

/** Pitch per 20 ms voiced frame (autocorrelation, 50-400 Hz). */
function pitchOf(pcm: Int16Array): { median: number; rangeSt: number } {
  const f0: number[] = [];
  const N = 640;
  for (let i = 0; i + N <= pcm.length; i += 320) {
    let e0 = 0;
    for (let j = 0; j < N; j++) e0 += pcm[i + j] * pcm[i + j];
    if (e0 / N < 4e5) continue;
    let best = 0, lag = 0;
    for (let L = 40; L <= 320; L++) {
      let c = 0;
      for (let j = 0; j < N - L; j++) c += pcm[i + j] * pcm[i + j + L];
      c /= e0;
      if (c > best) { best = c; lag = L; }
    }
    if (best > 0.5) f0.push(16000 / lag);
  }
  f0.sort((a, b) => a - b);
  if (!f0.length) return { median: 0, rangeSt: 0 };
  const q = (p: number) => f0[Math.floor(f0.length * p)];
  return { median: Math.round(q(0.5)), rangeSt: +(12 * Math.log2(q(0.9) / q(0.1))).toFixed(1) };
}

async function measureVoice(mp3: string, line: string) {
  const e = String(ff(["-i", mp3, "-af", "ebur128,silencedetect=n=-40dB:d=0.15", "-f", "null", "-"]).stderr);
  const lufs = +((e.match(/I:\s+(-?[\d.]+) LUFS/g) ?? []).pop()?.match(/-?[\d.]+/)?.[0] ?? NaN);
  const pauses = [...e.matchAll(/silence_duration: ([\d.]+)/g)].map(m => +m[1]);
  const pcm = ff(["-i", mp3, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]).stdout as Buffer;
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1);
  const dur = s.length / 16000;
  const t = await transcribeWordsFromBuffer(readFileSync(mp3));
  const words = "words" in t ? t.words : [];
  const wer = words.length ? wordErrorRate(norm(line), norm(words.map(w => w.word).join(" "))) : NaN;
  // Speech level: median 20 ms frame inside words. Gap level: each pause between two words of
  // 250 ms or more, read over its MIDDLE half only (word timings are ±50 ms, and a pause's edges
  // hold the end of one word and the start of the next). A breath or mouth noise lands there.
  const db = (a: number, b: number) => {
    let x = 0;
    for (let i = a; i < b; i++) x += s[i] * s[i];
    return 10 * Math.log10(x / Math.max(1, b - a) / 32768 ** 2 + 1e-12);
  };
  const speech: number[] = [];
  for (let i = 0; i + 320 <= s.length; i += 320) {
    const ts = i / 16000 + 0.01;
    if (words.some(w => ts >= w.start && ts <= w.end)) speech.push(db(i, i + 320));
  }
  speech.sort((a, b) => a - b);
  const speechDb = speech[speech.length >> 1] ?? NaN;
  const gapLevels = words.slice(1).flatMap((w, k) => {
    const a = words[k].end, b = w.start;
    if (b - a < 0.25) return [];
    const q = (b - a) / 4;
    return [db(Math.round((a + q) * 16000), Math.round((b - q) * 16000)) - speechDb];
  });
  const gapDb = gapLevels.length ? Math.max(...gapLevels) : NaN;
  // a pause where something is heard: within 35 dB of the voice (a clean pause reads -50 or lower)
  const noisyGaps = gapLevels.filter(g => g > -35).length;
  return {
    dur: +dur.toFixed(2),
    wps: +(norm(line).length / dur).toFixed(2),
    wer: +wer.toFixed(3),
    heard: words.map(w => w.word).join(" "),
    pauses: pauses.length,
    longestPause: +Math.max(0, ...pauses).toFixed(2),
    gapDb: +gapDb.toFixed(1),
    gaps: gapLevels.length,
    noisyGaps,
    words: words.map(w => [w.word, +w.start.toFixed(2), +w.end.toFixed(2)]),
    ...(() => { const p = pitchOf(s); return { f0: p.median, pitchRangeSt: p.rangeSt }; })(),
    lufs,
  };
}

/**
 * The account the HeyGen test page would use: the Test account, else the pool account with the
 * fewest videos rendering (lowest number on a tie), else the shared key — `pickHeygenTestAccount`.
 */
let heygenKey: Promise<{ key: string; label: string }> | undefined;
function benchHeygenKey() {
  return (heygenKey ??= (async () => {
    const [test, pool, load] = await Promise.all([
      getHeygenTestKey(),
      configuredAccounts("heygen"),
      accountLoad(),
    ]);
    const busy = [...load.heygen].flatMap(([a, n]) => Array<number>(n).fill(a));
    const account = pickHeygenTestAccount({
      testKey: !!test,
      pool,
      sharedKey: !!ENV.heygenApiKey,
      busy,
    });
    const key =
      account === "test" ? test
      : account === "shared" ? ENV.heygenApiKey
      : account != null ? await getHeygenSlotKey(account)
      : null;
    if (!key || account == null) throw new Error("no HeyGen key is set");
    const label = heygenAccountLabel(account);
    console.log(`[voice bench] HeyGen: ${label}`);
    return { key, label };
  })());
}

async function lipsync(v: Variant, audioUrl: string, outMp4: string) {
  // A clip already rendered is measured again, never paid for twice.
  if (!existsSync(outMp4)) {
    const { key } = await benchHeygenKey();
    const photo = spec.photos[v.ch];
    if (!photo) throw new Error(`${v.ch}: no photo in the variants file`);
    const heygen = new HeygenLipsyncAdapter(key);
    const sub = await heygen.submitLipsync({ imageUrl: photo, audioUrl });
    if (!sub.taskId) throw new Error(sub.error ?? "HeyGen refused");
    const r = await heygen.pollVideo(sub.taskId);
    if (!r.success || !r.fileData?.length) throw new Error(r.error ?? "HeyGen failed");
    writeFileSync(outMp4, await steadyHostClip(Buffer.from(r.fileData), `voice bench ${v.id}`));
  }
  const jsonl = outMp4.replace(/\.mp4$/, ".sync.jsonl");
  rmSync(jsonl, { force: true });
  const tsx = path.resolve("node_modules/.bin/tsx" + (process.platform === "win32" ? ".cmd" : ""));
  // A face the detector misses (a full beard with glasses) is measured from the channel's fixed
  // box instead — "x,y,size" at 1280x720, the face's centre and side. Every take of a channel is
  // the same photo, so one box serves them all.
  const box = spec.boxes?.[v.ch];
  spawnSync(tsx, ["scripts/measure-mouth-sync.mts", jsonl, outMp4], {
    shell: process.platform === "win32",
    env: { ...process.env, ...(box ? { BOX: box } : {}) },
  });
  const m = JSON.parse(readFileSync(jsonl, "utf8").trim().split("\n").pop()!);
  if (!m.ok) return { syncOk: false, why: m.why };
  const pass = m.motion.peakR >= 0.15 && m.motion.peakR - m.motion.farR >= 0.08 && Math.abs(m.motion.peakLagMs) <= 160;
  return {
    syncR: m.motion.peakR,
    syncLagMs: m.motion.peakLagMs,
    syncFarR: m.motion.farR,
    silentMouth: m.moveSilent != null ? +(m.moveSilent / m.moveTalking).toFixed(2) : null,
    syncPass: pass,
  };
}

/**
 * DE-BREATH: turn each pause between two words down by DEBREATH_DB, words untouched. A breath or
 * mouth click in a pause is sound, and the lip-sync model opens the mouth for it — round 1/2 takes
 * with audible pauses kept the mouth moving through them (silentMouth ~1.0), clean ones did not.
 * Pauses of 200 ms or more, 40 ms kept at each word edge, 30 ms fades so nothing clicks.
 */
const DEBREATH_DB = -24;
async function debreath(mp3: string) {
  const t = await transcribeWordsFromBuffer(readFileSync(mp3));
  if (!("words" in t) || t.words.length < 2) throw new Error("de-breath: no transcript");
  const SR = 48000;
  const pcm = ff(["-i", mp3, "-ac", "2", "-ar", String(SR), "-f", "f32le", "-"]).stdout as Buffer;
  const s = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  const floor = 10 ** (DEBREATH_DB / 20), fade = 0.03;
  const w = t.words;
  for (let k = 1; k < w.length; k++) {
    const a = w[k - 1].end + 0.04, b = w[k].start - 0.04;
    if (b - a < 0.12) continue;
    for (let i = Math.floor(a * SR); i < Math.min(s.length / 2, Math.ceil(b * SR)); i++) {
      const x = i / SR, edge = Math.min(x - a, b - x);
      const g = edge >= fade ? floor : 1 - (1 - floor) * (edge / fade);
      s[2 * i] *= g;
      s[2 * i + 1] *= g;
    }
  }
  const r = spawnSync(FF, ["-hide_banner", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "2", "-i", "-", "-c:a", "libmp3lame", "-b:a", "192k", mp3], { input: Buffer.from(s.buffer), maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error(String(r.stderr).slice(-300));
}

async function run(v: Variant) {
  const mp3 = path.join(OUT, `${v.id}.mp3`);
  try {
    if (!existsSync(mp3) && v.from) {
      const src = path.join(OUT, `${v.from}.mp3`);
      if (!existsSync(src)) throw new Error(`${v.from} has no take to reuse`);
      copyFileSync(src, mp3);
      if (v.debreath) await debreath(mp3);
    } else if (!existsSync(mp3)) {
      const raw = path.join(OUT, `${v.id}.raw.mp3`);
      writeFileSync(raw, await voice(v));
      // the film's own clean-up and shape: hiss filter, mp3 48k stereo
      ff(["-y", "-i", raw, "-af", NARRATION_DENOISE_FILTER, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", "-ac", "2", mp3]);
      if (v.debreath) await debreath(mp3);
      // the film's master step: every sentence ends with a real pause (server/sentencePauses.ts);
      // sentencePauses: false measures the voice as it came from the provider
      if (v.sentencePauses !== false) writeFileSync(mp3, await padSentenceEnds(readFileSync(mp3), m => console.log(`[bench] ${v.id}: ${m}`), lineFor(v)));
    }
    const voiceM = await measureVoice(mp3, lineFor(v));
    let syncM = {};
    if (HEYGEN) {
      const { url } = await storagePut(`voice-bench/${path.basename(OUT)}/${v.id}.mp3`, readFileSync(mp3), "audio/mpeg");
      syncM = await lipsync(v, url, path.join(OUT, `${v.id}.mp4`));
    }
    const row = { ...v, ...voiceM, ...syncM, at: new Date().toISOString() };
    appendFileSync(RESULTS, JSON.stringify(row) + "\n");
    console.log(JSON.stringify(row));
  } catch (e: any) {
    console.error(`${v.id}: ${e?.message ?? e}`);
  }
}

const todo = spec.variants.filter(v => !done.has(v.id) && (!ONLY || ONLY.includes(v.id)));
// One channel's takes go ONE AT A TIME: 69Labs refuses the same line in the same voice while one
// is in flight, and the adapter then adopts the running job — a "variant" that is a copy of
// another (round 1's dale-d was byte-identical to dale-c). Channels run side by side.
const byChannel = new Map<string, Variant[]>();
for (const v of todo) byChannel.set(v.ch, [...(byChannel.get(v.ch) ?? []), v]);
await Promise.all([...byChannel.values()].map(async vs => { for (const v of vs) await run(v); }));
process.exit(0);

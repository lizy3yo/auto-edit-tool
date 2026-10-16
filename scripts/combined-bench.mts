/**
 * scripts/combined-bench.mts — the WHOLE talking head per persona: the winning voice on the winning
 * photo, rendered several times, every check at once (2026-10-16).
 *
 *   npx tsx scripts/combined-bench.mts --spec FILE.json --out DIR [--repeat 3]
 *
 * The two halves of the review's host problems were fixed apart — the photo (one best photo per
 * channel, Scarlett's skin, Frederick's lower mouth: scripts/host-photo-bench.mts) and the voice
 * (volume, lip-sync: scripts/voice-bench.mts, its own session). This runs them TOGETHER, so a
 * persona passes only when its voice and its photo pass in the same clip:
 *
 *   1. writes a voice-bench spec — each persona's winning photo URL and winning voice dials, every
 *      line × repeat as its own take — and runs `scripts/voice-bench.mts --heygen`, which voices,
 *      measures the voice (every word, pace, pauses, noise in pauses, pitch, loudness), lip-syncs on
 *      HeyGen and scores the mouth against the voice (the ruler Bertha was scored by);
 *   2. measures the same clips for the photo: the lower mouth on the widest-open frames, compared
 *      side by side with Bertha's (the brief's benchmark; `measure-mouth-smear.mts --reference`),
 *      and the skin judged on frames of the rendered video;
 *   3. applies one pass line per check (`CHECKS`) and says, for every failure, which HALF failed —
 *      voice or photo — so the next round changes the right thing.
 *
 * Spec: { "lines": ["…", "…"], "personas": [{ "ch": KEY, "photo": URL, "voice": { model?, speed?,
 *   stability?, style?, similarity?, boost?, pitch? } }] }
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { judgeHostPhoto, measureHostPhoto } from "../server/hostPhotoScore";

const require = createRequire(import.meta.url);
const FF: string = require("ffmpeg-static");

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SPEC = opt("--spec");
const OUT = opt("--out") ?? "bench/host-fix/combined";
const REPEAT = +(opt("--repeat") ?? 3);
/** Bertha's mouth sheet — the brief's quality benchmark the lower mouth is compared with. */
const BERTHA = opt("--reference") ?? "bench/host-fix/bertha/berthara-diykitchen-0051-mouth.jpg";
if (!SPEC) {
  console.error("usage: npx tsx scripts/combined-bench.mts --spec FILE.json --out DIR [--repeat 3]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const spec = JSON.parse(readFileSync(SPEC, "utf8")) as {
  lines: string[];
  personas: { ch: string; photo: string; voice?: Record<string, unknown>; tag?: string; lines?: string[] }[];
  /** A face box per channel for the mouth tracker where its face finder misses (Dale's glasses). */
  boxes?: Record<string, string>;
};

/** One pass line per check, and which half of the talking head it belongs to. */
export const CHECKS = {
  words: { half: "voice", pass: (r: any) => r.wer != null && r.wer <= 0.05, show: (r: any) => `${Math.round((1 - r.wer) * 100)}% of words` },
  // information only: every finished film is levelled to -14 LUFS at assembly (server/filmLoudness.ts), so a quiet raw take never reaches a viewer
  loudness: { half: "voice", pass: (_r: any) => true, show: (r: any) => `${r.lufs} LUFS` },
  // information only: the loudest sound in ANY pause between words — natural breaths inside a sentence.
  // Lip-sync passes with them, and quieting them ("debreath") cost lip-sync; sentence ends are made
  // silent by server/sentencePauses.ts
  noiseInPauses: { half: "voice", pass: (_r: any) => true, show: (r: any) => `${r.gapDb} dB in pauses` },
  mouthOpens: { half: "voice", pass: (r: any) => r.openRight != null && r.openRight >= 2, show: (r: any) => r.openRight == null ? `too few pauses to see the mouth close (${r.silences} in the take)` : `mouth opens on speech, closes in silence: ${r.openRight}/3 votes` },
  mouthSync: { half: "voice", pass: (r: any) => r.syncPass === true && r.syncR >= 0.25, show: (r: any) => `r ${r.syncR}, ${r.syncLagMs} ms` },
  lowerMouth: { half: "photo", pass: (r: any) => r.mouthVsBertha != null && r.mouthVsBertha !== "clearly worse", show: (r: any) => `lower mouth vs Bertha: ${r.mouthVsBertha}` },
  skin: { half: "photo", pass: (r: any) => r.clipSkin == null || r.clipSkin >= 4, show: (r: any) => `skin ${r.clipSkin}/5` },
} as const;

const REVERDICT = argv.includes("--reverdict");
// 1. voice + mouth, through the voice session's own bench
const vbSpec = {
  photos: Object.fromEntries(spec.personas.map(p => [p.ch, p.photo])),
  ...(spec.boxes ? { boxes: spec.boxes } : {}),
  variants: spec.personas.flatMap(p =>
    (p.lines ?? spec.lines).flatMap((line, li) =>
      Array.from({ length: REPEAT }, (_, k) => ({
        id: `${p.ch}${p.tag ? "-" + p.tag : ""}-L${li + 1}-r${k + 1}`,
        ch: p.ch,
        tag: p.tag,
        line,
        // a string dial may name the take: "from": "dale-src-r{r}" reuses a different saved voice
        // clip per take, so a PHOTO is tested on the very takes it failed on (and HeyGen, which
        // returns the same video for the same photo and audio, still renders three)
        ...Object.fromEntries(Object.entries(p.voice ?? {}).map(([key, val]) => [key, typeof val === "string" ? val.replace("{r}", String(k + 1)) : val])),
      }))
    )
  ),
};
const vbFile = path.join(OUT, "voice-bench-spec.json");
writeFileSync(vbFile, JSON.stringify(vbSpec, null, 2));
const tsx = path.resolve("node_modules/.bin/tsx" + (process.platform === "win32" ? ".cmd" : ""));
console.log(`[combined] ${vbSpec.variants.length} takes → voice-bench`);
// One repeat at a time: 69Labs refuses a request while an IDENTICAL one (same words, same voice) is
// still running ("DUPLICATE_TTS_IN_PROGRESS"), so two takes of one line voiced together fail.
for (let k = 1; k <= (REVERDICT ? 0 : REPEAT); k++) {
  const ids = vbSpec.variants.filter(v => v.id.endsWith(`-r${k}`)).map(v => v.id);
  spawnSync(tsx, ["scripts/voice-bench.mts", "--variants", vbFile, "--out", OUT, "--heygen", "--only", ids.join(",")], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

// 2. the photo half on the same clips
const voiceRows = existsSync(path.join(OUT, "results.jsonl"))
  ? readFileSync(path.join(OUT, "results.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))
  : [];
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
const rows: any[] = REVERDICT && existsSync(path.join(OUT, "combined.json"))
  ? JSON.parse(readFileSync(path.join(OUT, "combined.json"), "utf8")).rows.map((r: any) => ({ ...r, failed: Object.entries(CHECKS).filter(([, c]) => !c.pass(r)).map(([k, c]) => `${k} (${c.half}: ${c.show(r)})`) }))
  : [];
for (const v of REVERDICT ? [] : voiceRows) {
  const mp4 = path.join(OUT, `${v.id}.mp4`);
  if (!existsSync(mp4)) continue;
  const smearFile = path.join(OUT, "smear.jsonl");
  spawnSync(tsx, ["scripts/measure-mouth-smear.mts", smearFile, mp4, "--sheet", OUT, "--reference", BERTHA], { shell: process.platform === "win32" });
  const smear = JSON.parse(readFileSync(smearFile, "utf8").trim().split("\n").pop()!);
  // the blind open-vs-silent check (scripts/measure-mouth-open.mts): beard- and head-movement-proof
  const openFile = path.join(OUT, "open.jsonl");
  spawnSync(tsx, ["scripts/measure-mouth-open.mts", openFile, mp4], {
    shell: process.platform === "win32",
    env: { ...process.env, ...(spec.boxes?.[v.ch] ? { BOX: spec.boxes[v.ch] } : {}) },
  });
  const open = JSON.parse(readFileSync(openFile, "utf8").trim().split("\n").pop()!);
  const row = { ...v, mouthVsBertha: smear.lowerMouth ?? null, mouthWhat: smear.lowerMouthWhat ?? "", flicker: smear.flicker ?? null, clipSkin: await clipSkin(mp4), openRight: open.ok ? open.right : null, silences: open.silences ?? 0 };
  row.failed = Object.entries(CHECKS).filter(([, c]) => !c.pass(row)).map(([k, c]) => `${k} (${c.half}: ${c.show(row)})`);
  rows.push(row);
}

// 3. per persona: a check passes when it passes in at least two thirds of the takes
const median = (a: number[]) => { const s = a.filter(n => n != null && !isNaN(n)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const verdict = spec.personas.map(p => {
  const mine = rows.filter(r => r.ch === p.ch && (r.tag ?? undefined) === p.tag);
  const checks = Object.fromEntries(
    Object.entries(CHECKS).map(([k, c]) => {
      const passed = mine.filter(r => c.pass(r)).length;
      return [k, { half: c.half, passed, of: mine.length, ok: mine.length > 0 && passed / mine.length >= 2 / 3 }];
    })
  );
  const failing = Object.entries(checks).filter(([, c]: any) => !c.ok).map(([k, c]: any) => `${k} (${c.half})`);
  return {
    ch: p.ch,
    tag: p.tag,
    voice: p.voice ?? "the channel's current settings",
    takes: mine.length,
    pass: mine.length > 0 && failing.length === 0,
    failing,
    medians: {
      syncR: median(mine.map(r => r.syncR)),
      syncLagMs: median(mine.map(r => r.syncLagMs)),
      wer: median(mine.map(r => r.wer)),
      lufs: median(mine.map(r => r.lufs)),
      lowerMouth: mine.map(r => r.mouthVsBertha),
      clipSkin: median(mine.map(r => r.clipSkin)),
    },
    checks,
  };
});
writeFileSync(path.join(OUT, "combined.json"), JSON.stringify({ rows, verdict }, null, 2));
for (const v of verdict)
  console.log(`[combined] ${v.ch}${v.tag ? " (" + v.tag + ")" : ""}: ${v.pass ? "PASS" : "FAIL"} (${v.takes} takes) ${v.failing.length ? "— failing: " + v.failing.join(", ") : ""} | medians ${JSON.stringify(v.medians)}`);
process.exit(0);

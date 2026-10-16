/**
 * scripts/master-clip-loudness.mts — a finished clip at YouTube's loudness, exactly as a film gets
 * it (2026-10-16).
 *
 *   npx tsx scripts/master-clip-loudness.mts in.mp4 out.mp4 [in2.mp4 out2.mp4 ...]
 *
 * Every film's audio leaves assembly at -14 LUFS with its true peak under -1 dBTP
 * (`server/filmLoudness.ts`), but a HeyGen test clip never goes through assembly, so it plays at
 * whatever level its voice came back at — Beau Carter's -34.9 LUFS, Backyard Brenda's -27.5. This
 * runs the film's own step on a clip: the same EBU R128 measurement, the same plan (one gain,
 * limiting capped at 6 dB) and the same filter (gain, then a limiter at 4x the sample rate, AAC
 * 192k at 48 kHz). The picture is copied untouched. It prints the reading before and after.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  buildFilmLoudnessArgs,
  FILM_LOUDNESS_TARGET_LUFS,
  FILM_TRUE_PEAK_MAX_DBTP,
  parseLoudnessSummary,
  planFilmLoudness,
} from "../server/filmLoudness";

const FF: string = createRequire(import.meta.url)("ffmpeg-static");
const ff = (args: string[]) => {
  const r = spawnSync(FF, ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr.slice(-400));
  return r.stderr;
};
const measure = (file: string) =>
  parseLoudnessSummary(ff(["-nostats", "-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"]));

const argv = process.argv.slice(2);
if (argv.length < 2 || argv.length % 2) {
  console.error("usage: npx tsx scripts/master-clip-loudness.mts in.mp4 out.mp4 [...]");
  process.exit(2);
}
let failed = false;
for (let i = 0; i < argv.length; i += 2) {
  const [input, output] = [argv[i], argv[i + 1]];
  const work = mkdtempSync(path.join(tmpdir(), "clip-loudness-"));
  try {
    const before = measure(input);
    const plan = planFilmLoudness(before);
    const audio = path.join(work, "mastered.m4a");
    ff(buildFilmLoudnessArgs({ inputPath: input, outputPath: audio, gainDb: plan.needed ? plan.gainDb : 0 }));
    // the picture exactly as it was, the mastered audio under it
    ff(["-y", "-i", input, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", output]);
    const after = measure(output);
    const ok = Math.abs(after.integratedLufs - FILM_LOUDNESS_TARGET_LUFS) <= 1 && after.truePeakDb <= FILM_TRUE_PEAK_MAX_DBTP;
    if (!ok) failed = true;
    console.log(
      `${path.basename(output)}: ${before.integratedLufs.toFixed(1)} → ${after.integratedLufs.toFixed(1)} LUFS, ` +
        `peak ${before.truePeakDb.toFixed(1)} → ${after.truePeakDb.toFixed(1)} dBTP ` +
        `(gain +${plan.gainDb} dB, limiting ${plan.limitingDb} dB${plan.capped ? ", held back" : ""}) ${ok ? "OK" : "OFF TARGET"}`
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);

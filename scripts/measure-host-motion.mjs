#!/usr/bin/env node
/**
 * scripts/measure-host-motion.mjs
 *
 * How much does the host MOVE in a rendered lip-sync clip?
 *
 *   node scripts/measure-host-motion.mjs path/to/clip.mp4
 *
 * Why this exists: "she moves around too much" is not something you can diff. This turns it
 * into five numbers by measuring mean frame-to-frame luma change inside fixed regions of the
 * frame, so a worker/prompt change can be judged against the render that prompted it instead
 * of by eye.
 *
 * Reading the output:
 *
 * - BACKGROUND is the control. Near zero means the camera is locked and everything else is
 *   the subject; a large value means the whole frame is drifting and the region numbers below
 *   it say nothing on their own.
 * - MOUTH is the lip-sync working. It SHOULD be high — a low mouth number with calm everything
 *   else is not a win, it is a clip that stopped talking.
 * - HAIR and TORSO are the complaint. They should be a small fraction of MOUTH. On the clip
 *   that motivated this (a 5.4s 1280x720 host scene) they measured 6.25 and 5.86 against a
 *   mouth of 14.05 — 44% and 42%, i.e. the body moving nearly as much as the jaw.
 *
 * THE THRESHOLDS ARE CALIBRATED TO A HEYGEN AVATAR IV CLIP the operator accepted as the
 * target look ("smooth"): background 0.11, hair 2.69, eyes 6.59, mouth 7.02, torso 3.39,
 * bg morph 0.99. Two lessons priced in below: HeyGen is NOT frozen — gentle body motion is
 * part of reading as alive, so an over-anchored render that "wins" on stillness (hair 0.89,
 *  mouth 2.0) reads as a mannequin and FAILS the mouth floor; and its mouth articulates at
 * ~7, not the ~13 of an unanchored InfiniteTalk render — 13 is over-animation, not quality.
 * PASS therefore means "moves like the accepted HeyGen example", nothing more.
 *
 * Regions are fractions of the frame, so they hold at any resolution, and assume the framing
 * `LIPSYNC_HOST_DIRECTION` asks for: a centred medium close-up. They are deliberately crude —
 * this is a before/after comparator, not a face tracker.
 *
 * BACKGROUND MORPH is the second failure mode and needs a second instrument: the model slowly
 * re-hallucinates background objects (a chair widens, a lamp slides) with almost no
 * frame-to-frame change, so the jitter metric above never sees it. It shows up only against
 * FRAME 0: each frame is diffed against the first, in the top-left background corner, and the
 * mean is the accumulated drift. Real locked-off footage sits ~0.1–0.3; the clips that
 * motivated this measured ~1.8–2.0. Honest only when the camera-jitter check also passes —
 * a moving camera inflates it for free.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FFMPEG = process.env.FFMPEG_PATH || require("ffmpeg-static");

/** [x, y, w, h] as fractions of the frame. */
const REGIONS = {
  background: [0.0, 0.0, 0.2, 0.36],
  "hair/head": [0.38, 0.05, 0.24, 0.16],
  "eyes/glasses": [0.38, 0.2, 0.24, 0.12],
  mouth: [0.42, 0.34, 0.18, 0.13],
  "torso/shoulders": [0.33, 0.72, 0.36, 0.21],
};

/** Pass/fail thresholds — calibrated to the accepted HeyGen reference (see header). */
const LIMITS = { "hair/head": 3.0, "torso/shoulders": 3.5 };
// 4.5, not the 5.5 first set from one reference clip at 7.0: the second accepted reference
// articulates at 4.9, and the floor must clear every accepted clip while still failing the
// over-anchored render that measured 2.0.
const MOUTH_FLOOR = 4.5;
/** Accumulated background drift vs frame 0. Baseline clips: ~1.9. Real tripod footage: ~0.2. */
const MORPH_LIMIT = 1.0;
/**
 * Window-seam pop: InfiniteTalk renders in 81-frame windows and the background can jump at
 * each handoff — a static corner that changes ~0.07/frame spiked to 1.46 at frame 81 on the
 * clip that motivated this. Reported as the worst single-frame background change divided by
 * the clip's median. HeyGen has no windows and measured 0 spikes; anything over the ratio
 * below (plus an absolute floor so a near-zero median cannot flag noise) is a visible hitch.
 */
const SEAM_RATIO_LIMIT = 8;
const SEAM_ABS_FLOOR = 0.3;
/** Head-torso motion correlation. Reference clips: 0.66-0.68. Bobblehead renders: 0.46-0.48. */
const COUPLING_FLOOR = 0.55;
/**
 * SMOOTHNESS, in two numbers the eye reads as "smooth like HeyGen":
 * - cheek texture flicker: raw frame-to-frame change on a cheek MINUS the same after blur —
 *   i.e. how much the skin surface shimmers beyond its real movement. A photo-warping engine
 *   pins texture to the pixels (reference 3.0); a re-painting sampler jitters it (4.8 on the
 *   render that motivated this, with real cheek motion identical at ~2.1).
 * - motion roughness: RMS second difference of the blurred face-motion curve over its mean —
 *   how abruptly movement starts and stops. Reference 0.49; the same render 0.77.
 */
// The two accepted references measure 3.5 and 4.9 here — they vary more than expected — so
// the limit clears both; the shimmering render measured 5.4, i.e. ~10% past the worse
// reference and ~50% past the better one.
const CHEEK_FLICKER_LIMIT = 5.0;
const ROUGHNESS_LIMIT = 0.7; // references 0.50 and 0.67; the jerky render 0.77
const CHEEK_REGION = [0.4, 0.3, 0.07, 0.1];
/**
 * SUBJECT CUT: a hard jump on the PERSON at a window handoff while the background stays
 * flat — the seam check above cannot see it, because it watches a background corner precisely
 * so subject motion does not pollute it. Measured on the render that motivated this: face and
 * torso both jumped ~4-5x their own typical frame change at frame 82 (an 81-frame window
 * boundary) with both background corners flat. Same spike rule as the seam check.
 */
const SUBJECT_REGION = [0.33, 0.05, 0.36, 0.88];
/**
 * COLD START: real body motion (blurred head + torso) in the FIRST second as a fraction of the
 * clip's average. The render that motivated this sat at 0.17/0.38 for two seconds and reached
 * 0.4-0.7 only from the third — a talking statue that wakes up — while the reference engine is
 * flat from frame 0. Below the floor, the clip opens stiff however good its average is.
 */
const COLD_START_FLOOR = 0.75; // motivating clip 0.66; references 0.82 (RunPod 8-step) and 1.15 (HeyGen)
const CUT_RATIO_LIMIT = 3.5;
/**
 * WINDOW HANDOFFS, by arithmetic rather than by hunting for spikes: InfiniteTalk renders
 * 81-frame windows overlapping by `motion_frame`, so a new window begins every 81-motion_frame
 * frames after the first, less the run-up the app trims (`--lead`, `--motion-frame`; defaults
 * from the same env the app reads). At those exact frames a much smaller jump is a seam — the
 * 3.5x rule above needs a jump that big to be sure a spike anywhere is a cut; a 1.8x jump AT a
 * predicted handoff is one (measured 2.9x on the clip that motivated this, invisible to the
 * rule above). Same threshold the app's own repair uses (`server/lipsyncSeams.ts`).
 */
const HANDOFF_RATIO_LIMIT = 1.8;
const HANDOFF_ABS_FLOOR = 0.3;
const WINDOW_FRAMES = 81;
const FACE_REGION = [0.38, 0.15, 0.24, 0.3];
/** Blur radius that removes fabric/knit texture, leaving only real displacement. */
const TEXTURE_BLUR_SIGMA = 6;

/**
 * Per-frame series for one region (same filter as `probe`, unaveraged). With `blur`, the region
 * is softened BEFORE differencing, so fine texture (a knit sweater, generative shimmer) drops
 * out and only genuine displacement survives.
 */
const probeSeries = (file, region, blur = false) =>
  new Promise((resolve, reject) => {
    const [x, y, w, h] = region;
    const crop =
      `crop=iw*${w}:ih*${h}:iw*${x}:ih*${y}` +
      (blur ? `,gblur=sigma=${TEXTURE_BLUR_SIGMA}` : "");
    const p = spawn(FFMPEG, [
      "-hide_banner",
      "-i",
      file,
      "-vf",
      `${crop},tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
      "-f",
      "null",
      "-",
    ]);
    let err = "";
    p.stderr.on("data", d => (err += d));
    p.on("error", reject);
    p.on("close", code => {
      if (code !== 0)
        return reject(
          new Error(`ffmpeg exited ${code}
${err.slice(-800)}`)
        );
      resolve([...err.matchAll(/YAVG=([0-9.]+)/g)].map(m => Number(m[1])));
    });
  });

const probe = (file, region) =>
  new Promise((resolve, reject) => {
    const [x, y, w, h] = region;
    const crop = `crop=iw*${w}:ih*${h}:iw*${x}:ih*${y}`;
    const p = spawn(FFMPEG, [
      "-hide_banner",
      "-i",
      file,
      // tblend=difference turns "how much changed since the previous frame" into pixel
      // values; signalstats' YAVG then averages them over the cropped region.
      "-vf",
      `${crop},tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
      "-f",
      "null",
      "-",
    ]);
    let err = "";
    p.stderr.on("data", d => (err += d));
    p.on("error", reject);
    p.on("close", code => {
      if (code !== 0)
        return reject(new Error(`ffmpeg exited ${code}\n${err.slice(-800)}`));
      const vals = [...err.matchAll(/YAVG=([0-9.]+)/g)].map(m => Number(m[1]));
      if (!vals.length)
        return reject(new Error("no frames measured — is this a video file?"));
      resolve(vals.reduce((a, b) => a + b, 0) / vals.length);
    });
  });

/** Mean luma difference of every frame against FRAME 0, in the top-left background corner. */
const probeMorph = file =>
  new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, [
      "-hide_banner",
      // The clip twice: input 0 trimmed to frame 0 and looped as the reference layer;
      // shortest=1 ends the diff at the real clip's end.
      "-i",
      file,
      "-i",
      file,
      "-filter_complex",
      "[0:v]trim=start_frame=0:end_frame=1,loop=loop=-1:size=1:start=0[ref];" +
        "[1:v][ref]blend=all_mode=difference:shortest=1," +
        "crop=iw*0.18:ih*0.30:0:0,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
      "-f",
      "null",
      "-",
    ]);
    let err = "";
    p.stderr.on("data", d => (err += d));
    p.on("error", reject);
    p.on("close", code => {
      if (code !== 0)
        return reject(
          new Error(`ffmpeg exited ${code}
${err.slice(-800)}`)
        );
      const vals = [...err.matchAll(/YAVG=([0-9.]+)/g)].map(m => Number(m[1]));
      if (!vals.length) return reject(new Error("no frames measured"));
      resolve(vals.reduce((a, b) => a + b, 0) / vals.length);
    });
  });

const argv = process.argv.slice(2);
const file = argv.find(
  a => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--")
);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
};
if (!file) {
  console.error(
    "usage: node scripts/measure-host-motion.mjs <clip.mp4> [--lead SEC] [--motion-frame N]"
  );
  process.exit(2);
}
const leadSec = flag(
  "--lead",
  Number(process.env.RUNPOD_LIPSYNC_LEAD_SEC ?? 2)
);
const motionFrame = flag(
  "--motion-frame",
  Number(process.env.RUNPOD_LIPSYNC_MOTION_FRAME ?? 25)
);

const means = {};
for (const [name, region] of Object.entries(REGIONS)) {
  means[name] = await probe(file, region);
}

const morph = await probeMorph(file);
// Seam check on the background corner: worst frame vs the median frame (frame 1 excluded — the
// first diff is against nothing).
const bgSeries = (await probeSeries(file, REGIONS.background)).slice(1);
const sortedBg = [...bgSeries].sort((a, b) => a - b);
const bgMedian = sortedBg[Math.floor(sortedBg.length / 2)] ?? 0;
const seamFrames = bgSeries
  .map((v, i) => ({ frame: i + 1, v }))
  .filter(({ v }) => v > SEAM_RATIO_LIMIT * bgMedian + SEAM_ABS_FLOOR);

// Subject cut: whole-person jump vs its own median (a pose/expression snap at a handoff).
const subjSeries = (await probeSeries(file, SUBJECT_REGION)).slice(1);
const subjSorted = [...subjSeries].sort((a, b) => a - b);
const subjMedian = subjSorted[Math.floor(subjSorted.length / 2)] ?? 0;
const cutFrames = subjSeries
  .map((v, i) => ({ frame: i + 1, v }))
  .filter(({ v }) => v > CUT_RATIO_LIMIT * subjMedian + SEAM_ABS_FLOOR);

// Predicted window handoffs, each judged against its own neighbourhood (±10 frames, the seam
// frames themselves excluded) on the whole-person series.
const handoffs = [];
{
  const step = WINDOW_FRAMES - motionFrame;
  const lead = Math.round(leadSec * 25);
  const total = subjSeries.length + 1;
  for (let raw = WINDOW_FRAMES; step > 0 && raw < total + lead; raw += step) {
    const b = raw - lead; // delivered frame index; subjSeries[i-1] is the jump INTO frame i
    if (b < 3 || b > total - 4) continue;
    const near = [];
    for (let i = b - 10; i <= b + 10; i++)
      if (i > 0 && i < total && Math.abs(i - b) > 1)
        near.push(subjSeries[i - 1]);
    near.sort((x, y) => x - y);
    const med = near[Math.floor(near.length / 2)] ?? 0;
    const v = subjSeries[b - 1];
    handoffs.push({ frame: b, ratio: med > 0 ? v / med : Infinity, v });
  }
}
const badHandoffs = handoffs.filter(
  h => h.ratio >= HANDOFF_RATIO_LIMIT && h.v >= HANDOFF_ABS_FLOOR
);

// Does the body move WITH the head? Both series blurred — see TEXTURE_BLUR_SIGMA.
const [headSeries, torsoSeries] = await Promise.all([
  probeSeries(file, REGIONS["hair/head"], true),
  probeSeries(file, REGIONS["torso/shoulders"], true),
]);
const pearson = (a, b) => {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
};
const coupling = pearson(headSeries, torsoSeries);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const bodySeries = headSeries.map((h, i) => h + (torsoSeries[i] ?? 0));
const coldStart =
  bodySeries.length > 25
    ? mean(bodySeries.slice(0, 25)) / (mean(bodySeries) || 1)
    : 1;

// Smoothness: cheek shimmer beyond real motion, and how jerky the face's motion curve is.
const [cheekRaw, cheekBlur, faceBlur] = await Promise.all([
  probeSeries(file, CHEEK_REGION),
  probeSeries(file, CHEEK_REGION, true),
  probeSeries(file, FACE_REGION, true),
]);
const cheekFlicker = mean(cheekRaw) - mean(cheekBlur);
const roughness = (() => {
  const m = mean(faceBlur);
  if (faceBlur.length < 3 || !m) return 0;
  let acc = 0;
  for (let i = 2; i < faceBlur.length; i++) {
    const d = faceBlur[i] - 2 * faceBlur[i - 1] + faceBlur[i - 2];
    acc += d * d;
  }
  return Math.sqrt(acc / (faceBlur.length - 2)) / m;
})();

const mouth = means.mouth;
console.log(`\n  ${file}\n`);
for (const [name, mean] of Object.entries(means)) {
  const share =
    mouth > 0 ? `${Math.round((mean / mouth) * 100)}% of mouth` : "";
  console.log(`  ${name.padEnd(18)} ${mean.toFixed(2).padStart(7)}   ${share}`);
}
console.log(
  `  ${"bg morph (vs f0)".padEnd(18)} ${morph.toFixed(2).padStart(7)}   limit ${MORPH_LIMIT}`
);
console.log(
  `  ${"window seams".padEnd(18)} ${String(seamFrames.length).padStart(7)}   ` +
    (seamFrames.length
      ? `at frame ${seamFrames.map(f => `${f.frame} (${f.v.toFixed(2)})`).join(", ")}`
      : "none")
);
console.log(
  `  ${"subject cuts".padEnd(18)} ${String(cutFrames.length).padStart(7)}   ` +
    (cutFrames.length
      ? `at frame ${cutFrames.map(f => `${f.frame} (${(f.v / subjMedian).toFixed(1)}x)`).join(", ")}`
      : "none")
);
console.log(
  `  ${"window handoffs".padEnd(18)} ${String(badHandoffs.length).padStart(7)}   ` +
    (handoffs.length
      ? `at frame ${handoffs.map(h => `${h.frame} (${h.ratio.toFixed(1)}x${badHandoffs.includes(h) ? " SEAM" : ""})`).join(", ")}   (lead ${leadSec}s, overlap ${motionFrame}; seam ≥ ${HANDOFF_RATIO_LIMIT}x)`
      : "none predicted")
);
console.log(
  `  ${"body follows head".padEnd(18)} ${coupling.toFixed(2).padStart(7)}   floor ${COUPLING_FLOOR}`
);
console.log(
  `  ${"cold start".padEnd(18)} ${coldStart.toFixed(2).padStart(7)}   floor ${COLD_START_FLOOR} (first-second body motion / average)`
);
console.log(
  `  ${"cheek flicker".padEnd(18)} ${cheekFlicker.toFixed(2).padStart(7)}   limit ${CHEEK_FLICKER_LIMIT}`
);
console.log(
  `  ${"motion roughness".padEnd(18)} ${roughness.toFixed(2).padStart(7)}   limit ${ROUGHNESS_LIMIT}`
);

const failures = [];
if (means.background > 1.0)
  failures.push(
    `background ${means.background.toFixed(2)} — camera is not locked, other numbers are unreliable`
  );
for (const [name, limit] of Object.entries(LIMITS))
  if (means[name] > limit)
    failures.push(
      `${name} ${means[name].toFixed(2)} > ${limit} — host still moving too much`
    );
if (mouth < MOUTH_FLOOR)
  failures.push(
    `mouth ${mouth.toFixed(2)} < ${MOUTH_FLOOR} — lip-sync was damaged, not just calmed`
  );
if (morph > MORPH_LIMIT)
  failures.push(
    `bg morph ${morph.toFixed(2)} > ${MORPH_LIMIT} — background objects still being re-hallucinated`
  );
if (seamFrames.length)
  failures.push(
    `${seamFrames.length} window seam(s) — background pops at a render-window handoff (motion_frame / colormatch)`
  );
if (cutFrames.length)
  failures.push(
    `${cutFrames.length} subject cut(s) — the person jumps at a window handoff while the background holds (motion_frame / feta_weight)`
  );
if (badHandoffs.length)
  failures.push(
    `${badHandoffs.length} window handoff seam(s) at frame ${badHandoffs.map(h => h.frame).join(", ")} — the person jumps where one render window hands off to the next (app repair: server/lipsyncSeams.ts; source: motion_frame)`
  );
if (coldStart < COLD_START_FLOOR)
  failures.push(
    `cold start ${coldStart.toFixed(2)} < ${COLD_START_FLOOR} — the body is still for the opening second (run-up / RUNPOD_LIPSYNC_LEAD_SEC)`
  );
if (coupling < COUPLING_FLOOR)
  failures.push(
    `body follows head ${coupling.toFixed(2)} < ${COUPLING_FLOOR} — head moves but the torso does not go with it (reads as stiff)`
  );
if (cheekFlicker > CHEEK_FLICKER_LIMIT)
  failures.push(
    `cheek flicker ${cheekFlicker.toFixed(2)} > ${CHEEK_FLICKER_LIMIT} — skin shimmers frame to frame (sampler noise; scheduler / steps)`
  );
if (roughness > ROUGHNESS_LIMIT)
  failures.push(
    `motion roughness ${roughness.toFixed(2)} > ${ROUGHNESS_LIMIT} — movement starts and stops abruptly`
  );

console.log("");
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log("  PASS  host is calm and the mouth still articulates\n");

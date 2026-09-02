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
const MOUTH_FLOOR = 5.5;
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

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/measure-host-motion.mjs <clip.mp4>");
  process.exit(2);
}

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
  `  ${"body follows head".padEnd(18)} ${coupling.toFixed(2).padStart(7)}   floor ${COUPLING_FLOOR}`
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
if (coupling < COUPLING_FLOOR)
  failures.push(
    `body follows head ${coupling.toFixed(2)} < ${COUPLING_FLOOR} — head moves but the torso does not go with it (reads as stiff)`
  );

console.log("");
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log("  PASS  host is calm and the mouth still articulates\n");

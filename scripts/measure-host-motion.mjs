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

/** Pass/fail thresholds — see the header for where these came from. */
const LIMITS = { "hair/head": 3.0, "torso/shoulders": 3.0 };
const MOUTH_FLOOR = 10.0;
/** Accumulated background drift vs frame 0. Baseline clips: ~1.9. Real tripod footage: ~0.2. */
const MORPH_LIMIT = 1.0;

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

console.log("");
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log("  PASS  host is calm and the mouth still articulates\n");

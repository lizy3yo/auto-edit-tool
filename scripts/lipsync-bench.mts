/**
 * scripts/lipsync-bench.mts — one row of the cost/quality benchmark.
 *
 *   npx tsx scripts/lipsync-bench.mts clip.mp4 --baseline accepted.mp4 [--job RUNPOD_JOB_ID] [--label "steps 8"] [--lead 2]
 *
 * The protocol behind every cost dial: same scene, one variable changed, and the render is
 * judged by the three instruments against the accepted clip BEFORE the dial becomes a default.
 * This prints the row: GPU-seconds per finished second (RunPod's `executionTime` for the job
 * over the delivered clip's length, run-up already trimmed), the cost at the endpoint's rate,
 * and the three verdicts with the numbers that matter — mouth tracking (peak r, and the
 * out-of-sync level), body (head jitter, blinks), motion (cheek flicker, roughness, handoffs).
 *
 * The bar is HeyGen's measured quality, not today's over-delivery: mouth r ≥ 0.21 with the lips
 * meeting on p/b/m (closure ≤ 0.068), flicker ≤ 5, roughness ≤ 0.7, head jitter ≤ 35%. With
 * --baseline (the accepted clip) a number may also match the baseline within 5% — the accepted
 * clip itself reads flicker 5.04 — and the handoff-seam count may not exceed the baseline's.
 *
 * Without --job the GPU column reads from RunPod's recent-requests list: the most recent
 * COMPLETED job is assumed to be this clip's (run one render at a time when benchmarking).
 */
import "dotenv/config";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import ffmpegPath from "ffmpeg-static";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const clip = argv.find(
  (a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--"))
);
if (!clip) {
  console.error(
    "usage: npx tsx scripts/lipsync-bench.mts <clip.mp4> [--baseline accepted.mp4] [--job ID | --gpu-sec N] [--label TEXT] [--lead SEC]"
  );
  process.exit(2);
}
const label = opt("--label") ?? path.basename(clip);
const jobId = opt("--job");
/** GPU seconds the app recorded on the scene (`scene.renderGpuSec`) — skips the RunPod lookup. */
const gpuSecArg = opt("--gpu-sec");
const RATE = Number(process.env.COST_RUNPOD_LIPSYNC_PER_GPU_SEC ?? 0.00097);
const FFMPEG = process.env.FFMPEG_PATH || (ffmpegPath as unknown as string);

function clipSeconds(file: string): number {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file, "-f", "null", "-"], {
    encoding: "utf8",
  });
  const m = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function gpuSeconds(): Promise<{ sec: number; id: string } | null> {
  const key = process.env.RUN_POD_KEY;
  const ep = (process.env.RUNPOD_INFINITETALK_ENDPOINT ?? "")
    .replace(/^https?:\/\/api\.runpod\.ai\/v2\//, "")
    .split("/")[0];
  if (gpuSecArg) return { sec: Number(gpuSecArg), id: "scene" };
  if (!key || !ep) return null;
  const h = { Authorization: `Bearer ${key}` };
  if (jobId) {
    const r = await fetch(`https://api.runpod.ai/v2/${ep}/status/${jobId}`, {
      headers: h,
    });
    const j: any = await r.json();
    return j.executionTime ? { sec: j.executionTime / 1000, id: jobId } : null;
  }
  const r = await fetch(`https://api.runpod.ai/v2/${ep}/requests`, {
    headers: h,
  });
  const j: any = await r.json();
  const jobs: any[] = j.jobs ?? j.requests ?? [];
  const done = jobs.find(x => x.status === "COMPLETED" && x.executionTime);
  return done ? { sec: done.executionTime / 1000, id: done.id } : null;
}

/** Run one judge and pull the numbers out of its report. */
// The judges are tsx scripts: run them through tsx's CLI under this same node binary — no
// shell, so paths with spaces and Windows .cmd shims are never an issue.
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
function judge(cmd: string[], picks: [string, RegExp][]) {
  const r = spawnSync(process.execPath, [TSX_CLI, ...cmd], {
    encoding: "utf8",
    maxBuffer: 16 << 20,
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const vals: Record<string, string> = {};
  for (const [k, re] of picks) vals[k] = out.match(re)?.[1] ?? "?";
  const verdict = /\n\s*PASS/.test(out)
    ? "PASS"
    : /FAIL/.test(out)
      ? "FAIL"
      : "?";
  return { vals, verdict, out };
}

const seconds = clipSeconds(clip);
const gpu = await gpuSeconds();
console.log(`\n  ${label}\n  ${clip}  (${seconds.toFixed(2)} s delivered)\n`);
if (gpu) {
  const perSec = gpu.sec / seconds;
  console.log(
    `  GPU  ${gpu.sec.toFixed(0)} s on job ${gpu.id.slice(0, 8)}  →  ${perSec.toFixed(0)} GPU-s per finished second  →  $${(perSec * RATE).toFixed(3)} / s   (target < 60 GPU-s; HeyGen $0.06)`
  );
} else {
  console.log("  GPU  (no RunPod job found — pass --job ID)");
}

type Row = {
  r: number;
  lag: string;
  far: string;
  closure: number;
  jitter: number;
  blinks: string;
  travel: string;
  flicker: number;
  rough: number;
  handoffs: number;
  mouthVerdict: string;
  bodyVerdict: string;
  motionVerdict: string;
};
function measure(file: string): Row {
  const mouth = judge(
    [
      "scripts/measure-lipsync.mts",
      file,
      "--reference",
      "granny_mae",
      "--no-sheet",
    ],
    [
      ["r", /opening\s+peak r\s+([\d.]+)/],
      ["lag", /opening\s+peak r\s+[\d.]+ at\s+([-+\d]+ ms)/],
      ["far", /out-of-sync level\s+([\d.]+)/],
      ["closure", /lips-closed \(p\/b\/m\)\s+([\d.]+)/],
    ]
  );
  const body = judge(
    ["scripts/measure-host-body.mts", file],
    [
      ["jitter", /energy above 4 Hz\s+(\d+)%/],
      ["blinks", /blinks per minute\s+\d+ \(([\d.]+)\/min\)/],
      ["travel", /travel over the clip \/ face size\s+(\d+%)/],
    ]
  );
  const motionR = spawnSync(
    process.execPath,
    ["scripts/measure-host-motion.mjs", file, "--lead", opt("--lead") ?? "2"],
    { encoding: "utf8", maxBuffer: 16 << 20 }
  );
  const mo = (motionR.stdout ?? "") + (motionR.stderr ?? "");
  const pick = (re: RegExp) => mo.match(re)?.[1] ?? "NaN";
  return {
    r: Number(mouth.vals.r),
    lag: mouth.vals.lag,
    far: mouth.vals.far,
    closure: Number(mouth.vals.closure),
    jitter: Number(body.vals.jitter),
    blinks: body.vals.blinks,
    travel: body.vals.travel,
    flicker: Number(pick(/cheek flicker\s+([\d.]+)/)),
    rough: Number(pick(/motion roughness\s+([\d.]+)/)),
    handoffs: Number(pick(/window handoffs\s+(\d+)/)),
    mouthVerdict: mouth.verdict,
    bodyVerdict: body.verdict,
    motionVerdict: /FAIL/.test(mo) ? "FAIL" : "PASS",
  };
}

const row = measure(clip);
const baselineClip = opt("--baseline");
const base = baselineClip ? measure(baselineClip) : null;
// A number passes on HeyGen's bar, or by matching the accepted clip within 5%.
const within = (v: number, bar: number, b?: number) =>
  v <= bar || (b != null && v <= b * 1.05);

const vs = (v: number | string, b?: number | string) =>
  base ? `${v} (base ${b})` : `${v}`;
console.log(
  `  MOUTH   r ${vs(row.r, base?.r)} @ ${row.lag} (far ${row.far})  closure ${vs(row.closure, base?.closure)}   bar r ≥ 0.21, closure ≤ 0.068`
);
console.log(
  `  BODY    head jitter ${vs(row.jitter, base?.jitter)}%  blinks ${row.blinks}/min  travel ${row.travel}   bar jitter ≤ 35%`
);
console.log(
  `  MOTION  cheek flicker ${vs(row.flicker, base?.flicker)}  roughness ${vs(row.rough, base?.rough)}  handoff seams ${vs(row.handoffs, base?.handoffs)}   bar ≤ 5 / ≤ 0.7 / ≤ baseline`
);
const ok =
  row.r >= 0.21 &&
  row.closure <= 0.068 &&
  within(row.flicker, 5, base?.flicker) &&
  within(row.rough, 0.7, base?.rough) &&
  row.handoffs <= (base ? base.handoffs : 0) &&
  row.jitter <= 35;
console.log(
  `\n  ${ok ? "KEEP" : "REVERT"}  ${label}${ok ? " — holds HeyGen's measured quality" : " — a judge number moved; do not bake this dial"}\n`
);
process.exitCode = ok ? 0 : 1;

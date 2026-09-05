// One benchmark round: regenerate one host scene through the running app, wait for the clip,
// find the RunPod job that paid for it, download the clip, and run the bench against the
// accepted clip. Usage: node round.mjs "<label>" <jobId> <sceneIndex>
import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import path from "path";

const [label, jobIdArg, sceneArg] = process.argv.slice(2);
const jobId = Number(jobIdArg);
const sceneIndex = Number(sceneArg);
const BASE = "http://localhost:3000";
const OUT = path.join(process.env.SCRATCH, "rounds");
const BASELINE = "C:/Users/User/Downloads/clip-1-0-5Jf8nN.mp4";
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

// 1. Sign in as the admin (credentials from .env; never printed).
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
});
if (!login.ok) throw new Error(`login ${login.status}`);
const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie")])
  .filter(Boolean)
  .map(c => c.split(";")[0])
  .join("; ");
const H = { cookie, "content-type": "application/json" };

const trpcGet = async (proc, input) => {
  const r = await fetch(
    `${BASE}/api/trpc/${proc}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: input } }))}`,
    { headers: H }
  );
  const j = await r.json();
  if (j[0]?.error) throw new Error(JSON.stringify(j[0].error).slice(0, 300));
  return j[0].result.data.json;
};
const trpcPost = async (proc, input) => {
  const r = await fetch(`${BASE}/api/trpc/${proc}?batch=1`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ 0: { json: input } }),
  });
  const j = await r.json();
  if (j[0]?.error) throw new Error(JSON.stringify(j[0].error).slice(0, 300));
  return j[0].result.data.json;
};

// 2. Remember the scene's current clip, then queue the regenerate.
const before = await trpcGet("longformVideo.pollJob", { jobId });
const sceneOf = job => (job.storyboard ?? job.scenes ?? []).find(s => s.index === sceneIndex);
const prevUrl = sceneOf(before)?.clipUrl;
console.log(`${stamp()} ${label}: job ${jobId} scene ${sceneIndex}, current clip ${String(prevUrl).split("/").pop()}`);
const started = Date.now();
// WAIT_FOR=<old clip name>: a render is already running (queued earlier) — just wait for it.
const waitFor = process.env.WAIT_FOR;
if (!waitFor) {
  const res = await trpcPost("longformVideo.regenerateScene", { jobId, sceneIndex });
  console.log(`${stamp()} queued: ${JSON.stringify(res)}`);
} else console.log(`${stamp()} waiting for a clip other than ${waitFor}`);

// 3. Poll until the scene carries a NEW clip.
let scene;
for (;;) {
  await sleep(20_000);
  const job = await trpcGet("longformVideo.pollJob", { jobId });
  scene = sceneOf(job);
  const url = scene?.clipUrl;
  if (scene?.sceneStatus === "failed") throw new Error(`scene failed: ${scene.error}`);
  const changed = waitFor ? !String(url).endsWith(waitFor) : url !== prevUrl;
  if (url && changed && scene.sceneStatus === "completed") break;
  if (Date.now() - started > 50 * 60_000) throw new Error("timed out waiting for the render");
  process.stdout.write(`${stamp()} ${scene?.sceneStatus ?? "?"} ${scene?.renderTaskIds?.[0]?.slice(0, 8) ?? ""}\r`);
}
const wall = Math.round((Date.now() - started) / 1000);
console.log(`\n${stamp()} new clip ${scene.clipUrl.split("/").pop()} after ${wall}s wall clock`);

// 4. What it cost, as recorded on the scene by the app (survives RunPod's short job history).
console.log(`${stamp()} GPU ${scene.renderGpuSec ?? "?"} s | worker timings ${JSON.stringify(scene.renderTimings ?? {})}`);

// 5. Download the clip and run the bench.
const clipPath = path.join(OUT, `${label.replace(/[^a-z0-9]+/gi, "-")}.mp4`);
const buf = Buffer.from(await (await fetch(scene.clipUrl)).arrayBuffer());
writeFileSync(clipPath, buf);
console.log(`${stamp()} saved ${clipPath} (${buf.length} bytes)`);
const bench = spawnSync(process.execPath, [
  createRequire(import.meta.url).resolve("tsx/cli"),
  "scripts/lipsync-bench.mts", clipPath, "--baseline", BASELINE, "--label", label,
  ...(scene.renderGpuSec ? ["--gpu-sec", String(scene.renderGpuSec)] : []),
], { encoding: "utf8", maxBuffer: 16 << 20 });
console.log(bench.stdout);
if (bench.stderr) console.log(bench.stderr.split("\n").filter(l => !/Deprecation|trace-deprecation/.test(l)).join("\n"));

// The lab's way into the graphics PLANNER (graphics/src/plan/planner.ts — the same code the app's
// finishing step runs): one model call writes the cue sheet for a finished film, every cue
// checked against its real word times and the placement rules.
//   tsx scripts/plan.mts --job 385 [--keep cues/frederick-385-full.json] [--out cues/x.json]
// Needs out/jobs/<job>/words.json (scripts/transcribe.mts) and, for exact edges, cuts.json
// (scripts/cuts.mts; without it edges are conformed at composite time instead).
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { CueSpec, Word } from "../../graphics/src/cueResolve.ts";
import { NOTO_PNG, planGraphics, type PlanMessage } from "../../graphics/src/plan/planner.ts";
import { loadJob } from "./job.mts";
import { GRAPHICS_PUBLIC, outDir } from "./lib.mts";

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const jobId = Number(arg("--job"));
if (!jobId) throw new Error("usage: tsx scripts/plan.mts --job <id> [--keep sheet.json] [--out out.json]");
const outFile = arg("--out", `cues/auto-${jobId}.json`)!;
const keepFile = arg("--keep");
const MODEL = arg("--model", process.env.PLAN_MODEL ?? "claude-opus-5-5")!;

const job = loadJob(jobId);
const jobDir = outDir("jobs", String(jobId));
const words = JSON.parse(readFileSync(path.join(jobDir, "words.json"), "utf8")) as Word[];
const cutsFile = path.join(jobDir, "cuts.json");
const cuts = existsSync(cutsFile) ? (JSON.parse(readFileSync(cutsFile, "utf8")) as number[]) : undefined;
const kept: CueSpec[] = keepFile ? (JSON.parse(readFileSync(keepFile, "utf8")) as { cues: CueSpec[] }).cues : [];
const filmSec = words[words.length - 1].end;

function apiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const env = readFileSync(path.join("..", ".env"), "utf8");
  const m = /^ANTHROPIC_API_KEY=(.*)$/m.exec(env);
  if (!m) throw new Error("ANTHROPIC_API_KEY is not set (env or ../.env)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}
const usage = { input: 0, output: 0 };
async function ask(system: string, messages: PlanMessage[]): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 32000, system, messages }),
  });
  const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number }; error?: { message: string } };
  if (!res.ok) throw new Error(`Claude ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  usage.input += body.usage?.input_tokens ?? 0;
  usage.output += body.usage?.output_tokens ?? 0;
  return (body.content ?? []).filter(c => c.type === "text").map(c => c.text).join("");
}
async function ensureIcon(code: string): Promise<boolean> {
  const file = path.join(GRAPHICS_PUBLIC, "icons", `${code}.png`);
  if (existsSync(file)) return true;
  const res = await fetch(`${NOTO_PNG}/emoji_u${code}.png`);
  if (!res.ok) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

const t0 = Date.now();
const plan = await planGraphics({ words, cuts, film: job, kept, ask, ensureIcon });
const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const keptIds = new Set(kept.map(c => c.id));
const byType = new Map<string, number>();
for (const c of plan.cues) byType.set(c.template, (byType.get(c.template) ?? 0) + 1);
writeFileSync(
  outFile,
  JSON.stringify(
    {
      job: jobId,
      notes: `Written by graphics/src/plan/planner.ts (${MODEL}) on ${new Date().toISOString().slice(0, 10)}: ${plan.cues.length} graphics for a ${(filmSec / 60).toFixed(1)}-min film${kept.length ? `, ${kept.length - plan.lostKept.length} of them kept from ${keepFile}` : ""}.`,
      cues: plan.cues,
    },
    null,
    1
  )
);
const report = [
  `# Planner — job ${jobId}`,
  `model ${MODEL}, ${((Date.now() - t0) / 1000).toFixed(0)} s, ${usage.input} in / ${usage.output} out tokens`,
  ...plan.rounds.map((r, i) => `round ${i + 1}: ${r.asked} new written, ${r.kept} graphics pass in all${r.problems.length ? "\n  " + r.problems.map(p => `${p.cue}: ${p.problem}`).join("\n  ") : ""}`),
  kept.length ? `kept graphics: ${kept.length - plan.lostKept.length}/${kept.length}${plan.lostKept.length ? " — LOST: " + plan.lostKept.join(", ") : ""}` : "",
  `${plan.cues.length} graphics, ${(plan.cues.length / (filmSec / 60)).toFixed(1)} a minute: ${Array.from(byType).map(([t, n]) => `${t} ${n}`).join(", ")}`,
  "",
  ...plan.resolved.map(c => `${mmss(c.start)}-${mmss(c.end)}  ${c.template.padEnd(17)} ${c.id}${keptIds.has(c.id) ? "  (kept)" : ""}`),
].join("\n");
writeFileSync(path.join(jobDir, "plan.md"), report);
console.log(report);
console.log(`\nwrote ${outFile}`);

// The AUTOMATIC graphics planner: one Claude call reads a finished film's script, its layout (host,
// split, b-roll, call to action) and the template catalogue, and writes the cue sheet — which
// graphic goes on which words. What it writes is never trusted: every cue is resolved against the
// real word times and held to the same rules the composite checks (scripts/rules.mts) plus Steve's
// density; anything that fails goes back for ONE repair round, and whatever still fails is dropped.
//   tsx scripts/plan.mts --job 385 [--out cues/frederick-385.json] [--model claude-opus-5-5]
// Needs out/jobs/<job>/words.json (scripts/transcribe.mts) and, for exact edges, cuts.json
// (scripts/cuts.mts; without it edges are conformed at composite time instead).
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CueError, resolveCues, type CueSpec, type ResolvedCue, type Word } from "../src/cueResolve.ts";
import { TEMPLATES, templateById } from "../src/registry.ts";
import { FPS } from "../src/theme.ts";
import { loadJob, nameTagRange, type Job } from "./job.mts";
import { outDir } from "./lib.mts";
import { MIN_GAP_SEC, checkRules, densityLimits } from "./rules.mts";

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const jobId = Number(arg("--job"));
if (!jobId) throw new Error("usage: tsx scripts/plan.mts --job <id>");
const outFile = arg("--out", `cues/auto-${jobId}.json`)!;
const MODEL = arg("--model", process.env.PLAN_MODEL ?? "claude-opus-5-5")!;

const job = loadJob(jobId);
const jobDir = outDir("jobs", String(jobId));
const words = JSON.parse(readFileSync(path.join(jobDir, "words.json"), "utf8")) as Word[];
const cutsFile = path.join(jobDir, "cuts.json");
const cuts = existsSync(cutsFile) ? (JSON.parse(readFileSync(cutsFile, "utf8")) as number[]) : undefined;
const structural = new Set(TEMPLATES.filter(t => t.structural).map(t => t.id));
const cards = new Set(TEMPLATES.filter(t => t.kind === "card").map(t => t.id));
const filmSec = words[words.length - 1].end;
const limits = densityLimits(filmSec);

/* ───────────── What the model is shown ───────────── */

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const kindOf = (s: Job["scenes"][number]) => (s.cta ? "CTA" : s.split ? "SPLIT (host left, picture right)" : s.hostPresent ? "HOST" : "B-ROLL");
const nameTag = nameTagRange(job);
const layout = job.scenes
  .map(s => {
    const tagUp = nameTag && s.narrationStartSec < nameTag[1] && s.narrationEndSec > nameTag[0] ? " [NAME TAG UP]" : "";
    return `#${s.index} ${mmss(s.narrationStartSec)}-${mmss(s.narrationEndSec)} ${kindOf(s)}${tagUp}: ${s.scriptText.trim()}`;
  })
  .join("\n");

/** Stretches of consecutive b-roll (no host, no CTA): the only places a card or a darkening
 * overlay may go. */
const brollStretches: { from: number; to: number; text: string }[] = [];
for (const s of job.scenes) {
  if (s.hostPresent || s.cta) continue;
  const last = brollStretches[brollStretches.length - 1];
  if (last && Math.abs(last.to - s.narrationStartSec) < 0.1) {
    last.to = s.narrationEndSec;
    last.text += " " + s.scriptText.trim();
  } else brollStretches.push({ from: s.narrationStartSec, to: s.narrationEndSec, text: s.scriptText.trim() });
}
const stretchList = brollStretches
  .filter(b => b.to - b.from >= 2.5)
  .map(b => `${mmss(b.from)}-${mmss(b.to)} (${(b.to - b.from).toFixed(1)} s): ${b.text}`)
  .join("\n");

const CATALOGUE = `
A "phrase" is {"text": "...", "words": true}: shown word by word as the narrator says each word.
Its words must be the narrator's own, in order (you may leave words out, never change or reorder them).
"at": "@words" makes an element appear on those spoken words; "at": 0 makes it appear at the cue start.
Fixed text (titles, labels, subs) is shown whole. If it stands for words the narrator says, add
"say": "those exact spoken words" next to it, so the graphic knows when they are done.
"emphasis": ["word."] = ONE word of the shown text, copied exactly as written there (with its punctuation), drawn in the accent colour.
"icon" = ONE emoji character (it is drawn as a 3D Noto emoji). Choose plain, literal objects.

FULL-SCREEN CARDS (replace the picture; ONLY inside a b-roll stretch):
- Statement: {"kicker": "2-4 word label", "headline": phrase (4-10 words), "emphasis": [...]}. The one line that sums up a point.
- MythTruth: {"myth": phrase, "truth": phrase, "emphasis": [...]}. The script says what people believe, then what is true.
- Versus: {"kicker", "left": {"icon","title" (1-3 words),"sub" (≤6 words),"say","at"}, "right": {same}, "winner": "left"|"right"|"none"}. Two kinds of a thing compared.
- BigNumber: {"kicker", "value": number, "unit": "1-2 words", "at": "@the spoken number", "line": phrase}. A number the narrator SAYS that matters. Set "countSec": 0.6 for small numbers.
- StepCards: {"kicker", "steps": [{"text" (≤4 words), "icon", "at": "@words"}] (2-4)}. Steps the viewer should do.
- BeforeAfter: {"kicker", "before": {"icon","label","at"}, "after": {"icon","label","at"}}. An old way replaced by a new one.
- TwoPoint: {"title": phrase, "a": {"label","sub","at"}, "b": {"label","sub","at"}}. Two places or things linked.

OVERLAYS (on top of the picture):
- ChapterLabel: {"kicker": "Topic · 1 of 3", "number": 1, "title": "1-3 words"} — ONLY where the script counts its parts aloud ("First thing…", "Second…"), and then on EVERY counted part (all or none). Use "durationSec": 4.5 instead of "end". Any picture, not on the name tag. Chapter labels do not count toward the overlay limit.
- StepLabels: {"steps": [{"text" (≤4 words), "at": "@words"}] (2-4)} — a spoken sequence of actions, on b-roll.
- WarningLabel: {"text": phrase (≤10 words), "emphasis"} — a danger or a mistake to avoid, said as one. On b-roll.
- IconLabels: {"items": [{"icon","text" (1-3 words),"say","at"}] (1-3)} — the right things to look for or buy. On b-roll.
- HostCaption: {"phrase": phrase (≤8 words), "emphasis"} — the host's punchline while the HOST is on camera (HOST or SPLIT scene), never under the name tag.
- DimCaption: {"phrase": phrase (≤10 words), "emphasis"} — darkens a b-roll picture for a striking line. ONLY inside a b-roll stretch.
- Quote: {"quote": phrase (the host's advice, ≤12 words), "author": "the host's name", "emphasis"} — blurs and darkens a b-roll picture. ONLY inside a b-roll stretch. At most one per film.
`;

const SYSTEM = `You place motion graphics on a finished faceless/talking-head YouTube film, in the style of
Steve Cooper's channel: dark cards and clean labels that land exactly on the words that make a point.

What makes it work, and what you must keep:
- RESTRAINT. A graphic marks a real point: the counted parts of the video, a number that matters, a
  comparison, the one-line takeaway, a warning, the steps to do. Never decoration, never every line.
- SHORT. A label is read at a glance, not followed like a subtitle: keep the point, leave out the
  rest of the sentence (word limits below are hard). It must make sense on its own — do not open
  on "It" or "This" when what it refers to is not on screen.
- A SHOWN LINE READS AS A WHOLE THOUGHT on its own: it starts where a sentence or clause starts
  (capital letter), and keeps every word its meaning needs — "while the house is asleep", never
  "while asleep". Leave out only filler ("you know", "really", "just").
- EVERY WORD ON SCREEN IS THE NARRATOR'S. No fact, number or claim the script does not say.
  Fixed labels may be a short plain version of what is said (a title for a side, a step).
- A graphic stays only while its words are spoken (it leaves ~0.8 s after its last word by itself),
  so start it on the words that open the point and let its last word be the last word of the point.
- Variety: do not use the same template twice in a row; spread the graphics over the whole film.
- The opening minute decides whether a viewer stays: if a b-roll stretch there carries a strong line
  (the hook, the problem stated), mark it.
- Cards and darkening overlays go ONLY inside a b-roll stretch — never over the host, never in the
  call to action (CTA scenes), and the cue's words must all fall inside that one stretch.
- Nothing in the CTA. No host caption while the name tag is up. Leave at least ${MIN_GAP_SEC} s between graphics.

DENSITY for this ${(filmSec / 60).toFixed(1)}-minute film — hard limits:
at most ${limits.cards} full-screen cards, at most ${limits.overlays} overlays, at most ${limits.hostCaptions} host captions (counted in the overlays).
Fewer is fine when the script has fewer points worth marking.

Answer with JSON only: {"cues": [ ... ]} in film order. Each cue:
{"id": "01-statement-short-name", "template": "...", "start": "the exact spoken words it starts on (3-6 words)",
 "startPad": -0.15, "end": "the exact spoken words it ends on (2-6 words)", "endPad": 0.3, "props": {...}}
"start" and "end" are copied word for word from the script.
${CATALOGUE}`;

const user = `THE FILM, scene by scene (time, what is on screen, what is said):
${layout}

B-ROLL STRETCHES (the only places for cards, DimCaption and Quote):
${stretchList}

Write the cue sheet.`;

/* ───────────── The call ───────────── */

function apiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const env = readFileSync(path.join("..", ".env"), "utf8");
  const m = /^ANTHROPIC_API_KEY=(.*)$/m.exec(env);
  if (!m) throw new Error("ANTHROPIC_API_KEY is not set (env or ../.env)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

type Msg = { role: "user" | "assistant"; content: string };
let usage = { input: 0, output: 0 };
async function ask(messages: Msg[]): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, system: SYSTEM, messages }),
  });
  const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number }; error?: { message: string } };
  if (!res.ok) throw new Error(`Claude ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  usage.input += body.usage?.input_tokens ?? 0;
  usage.output += body.usage?.output_tokens ?? 0;
  return (body.content ?? []).filter(c => c.type === "text").map(c => c.text).join("");
}

function parseSheet(text: string): CueSpec[] {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error(`no JSON in the answer: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text.slice(a, b + 1)) as { cues?: CueSpec[] };
  if (!Array.isArray(parsed.cues)) throw new Error("answer has no cues array");
  return parsed.cues;
}

/* ───────────── Icons: an emoji character → its Noto file, fetched once ───────────── */

const NOTO = "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/png/512";
/** Noto names a file by its code points, lower-case hex joined by "_", without FE0F. */
export function notoCode(icon: string): string {
  if (/^[0-9a-f]{4,6}(_[0-9a-f]{4,6})*$/i.test(icon)) return icon.toLowerCase();
  return [...icon]
    .map(ch => ch.codePointAt(0)!)
    .filter(cp => cp !== 0xfe0f)
    .map(cp => cp.toString(16))
    .join("_");
}
async function ensureIcon(code: string): Promise<boolean> {
  const file = path.join("public", "icons", `${code}.png`);
  if (existsSync(file)) return true;
  const res = await fetch(`${NOTO}/emoji_u${code}.png`);
  if (!res.ok) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}
/** Converts every `icon` in a cue's props in place; returns the icons Noto does not have. */
async function fixIcons(node: unknown, missing: string[]): Promise<void> {
  if (Array.isArray(node)) {
    for (const x of node) await fixIcons(x, missing);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (k === "icon" && typeof v === "string") {
      const code = notoCode(v);
      if (await ensureIcon(code)) o.icon = code;
      else missing.push(v);
    } else await fixIcons(v, missing);
  }
}

/* ───────────── Validation: every cue resolved and held to the rules ───────────── */

/** The lines a viewer reads as SENTENCES (a BigNumber's line runs on from its number and is exempt). */
const LINE_KEYS = ["headline", "phrase", "quote", "myth", "truth", "title", "text"] as const;

/** Hard word limits on a template's shown line (Steve's labels are a glance, not a subtitle:
 * job 385's 19-word warning stayed 11.5 s). */
const MAX_WORDS: Record<string, number> = { Statement: 10, MythTruth: 10, TwoPoint: 12, WarningLabel: 10, HostCaption: 8, DimCaption: 10, Quote: 12 };

type Verdict = { kept: CueSpec[]; resolved: ResolvedCue[]; problems: { cue: string; problem: string }[] };

async function validate(specs: CueSpec[], final = false): Promise<Verdict> {
  const problems: Verdict["problems"] = [];
  const kept: CueSpec[] = [];
  let resolved: ResolvedCue[] = [];
  const ids = new Set<string>();
  const counts = { cards: 0, overlays: 0, hostCaptions: 0 };
  for (const spec of specs) {
    const bad = (problem: string) => problems.push({ cue: spec.id ?? "?", problem });
    if (!spec.id || ids.has(spec.id)) {
      bad("missing or repeated id");
      continue;
    }
    ids.add(spec.id);
    let def;
    try {
      def = templateById(spec.template);
    } catch {
      bad(`unknown template "${spec.template}"`);
      continue;
    }
    const cap = MAX_WORDS[spec.template];
    const wordCount = (t: string) => t.trim().split(" ").filter(Boolean).length;
    const long = cap && LINE_KEYS.map(k => (spec.props?.[k] as { text?: unknown } | undefined)?.text).find(
      t => typeof t === "string" && wordCount(t) > cap
    );
    if (long) {
      bad(`"${long}" is ${wordCount(String(long))} words — ${spec.template} takes at most ${cap}`);
      continue;
    }
    const fragment = LINE_KEYS.map(k => [k, (spec.props?.[k] as { text?: unknown } | undefined)?.text] as const).find(
      ([, text]) => typeof text === "string" && !/^[\p{Lu}\d"“'‘]/u.test(text.trim())
    );
    if (fragment) {
      bad(`"${fragment[1]}" (${fragment[0]}) starts mid-sentence — a shown line must read as a whole thought`);
      continue;
    }
    const missing: string[] = [];
    await fixIcons(spec.props, missing);
    if (missing.length) {
      bad(`no Noto emoji for ${missing.join(" ")} — pick another`);
      continue;
    }
    // Resolve with every cue kept so far, so a repeated phrase binds after the previous cue.
    let next: ResolvedCue[];
    try {
      next = resolveCues([...kept, spec], words, { cuts, fps: FPS, structural, cards });
    } catch (e) {
      bad(e instanceof CueError ? e.message.replace(/^cue \S+: /, "") : String(e));
      continue;
    }
    const mine = next[next.length - 1];
    const rule = checkRules(next.slice(-2), job, { gap: MIN_GAP_SEC }).filter(p => p.cue === spec.id);
    if (rule.length) {
      for (const r of rule) bad(r.problem);
      continue;
    }
    const kind = def.kind === "card" ? "cards" : "overlays";
    if (!def.structural && counts[kind] + 1 > limits[kind]) {
      bad(`one ${kind === "cards" ? "card" : "overlay"} too many (limit ${limits[kind]})`);
      continue;
    }
    if (spec.template === "HostCaption" && counts.hostCaptions + 1 > limits.hostCaptions) {
      bad(`one host caption too many (limit ${limits.hostCaptions})`);
      continue;
    }
    if (!def.structural) counts[kind]++;
    if (spec.template === "HostCaption") counts.hostCaptions++;
    kept.push(spec);
    resolved = next;
    void mine;
  }
  // Chapter labels are a SERIES: "2 of 3" with no 1 or 3 is a broken promise on screen.
  const chapters = kept.filter(c => c.template === "ChapterLabel");
  const total = Math.max(0, ...chapters.map(c => Number(/ofs+(d+)/i.exec(String(c.props.kicker ?? ""))?.[1] ?? 0)));
  const have = new Set(chapters.map(c => Number(c.props.number)));
  const lost = Array.from({ length: total }, (_, i) => i + 1).filter(n => !have.has(n));
  if (chapters.length && lost.length) {
    for (const n of lost) problems.push({ cue: `chapter ${n}`, problem: `chapter ${n} of ${total} is missing — label every counted part or none` });
    if (final) {
      for (const c of chapters) problems.push({ cue: c.id, problem: "dropped with its incomplete chapter series" });
      const rest = kept.filter(c => c.template !== "ChapterLabel");
      return { kept: rest, resolved: resolveCues(rest, words, { cuts, fps: FPS, structural, cards }), problems };
    }
  }
  return { kept, resolved, problems };
}

/* ───────────── Run ───────────── */

const t0 = Date.now();
const first = await ask([{ role: "user", content: user }]);
let specs = parseSheet(first);
let verdict = await validate(structuredClone(specs));
const rounds = [{ asked: specs.length, kept: verdict.kept.length, problems: verdict.problems }];
if (verdict.problems.length) {
  const fix = `These cues failed the checks (resolved against the real word times and the film's layout):
${verdict.problems.map(p => `- ${p.cue}: ${p.problem}`).join("\n")}

Return the WHOLE corrected cue sheet (JSON only). Fix each failed cue — use words the narrator really
says, move it into a b-roll stretch, or drop it. Do not change the cues that passed.`;
  specs = parseSheet(await ask([{ role: "user", content: user }, { role: "assistant", content: first }, { role: "user", content: fix }]));
  verdict = await validate(structuredClone(specs), true);
  rounds.push({ asked: specs.length, kept: verdict.kept.length, problems: verdict.problems });
}

const sheet = {
  job: jobId,
  notes: `Written by scripts/plan.mts (${MODEL}) on ${new Date().toISOString().slice(0, 10)}: ${verdict.kept.length} graphics for a ${(filmSec / 60).toFixed(1)}-min film (limits: ${limits.cards} cards, ${limits.overlays} overlays). Every cue resolved against the word times and checked by scripts/rules.mts; ${verdict.problems.length} dropped after one repair round.`,
  cues: verdict.kept,
};
writeFileSync(outFile, JSON.stringify(sheet, null, 1));
const report = [
  `# Planner — job ${jobId}`,
  `model ${MODEL}, ${((Date.now() - t0) / 1000).toFixed(0)} s, ${usage.input} in / ${usage.output} out tokens`,
  ...rounds.map((r, i) => `round ${i + 1}: ${r.asked} written, ${r.kept} pass${r.problems.length ? "\n  " + r.problems.map(p => `${p.cue}: ${p.problem}`).join("\n  ") : ""}`),
  "",
  ...verdict.resolved.map(c => `${mmss(c.start)}-${mmss(c.end)}  ${c.template.padEnd(12)} ${c.id}`),
].join("\n");
writeFileSync(path.join(jobDir, "plan.md"), report);
console.log(report);
console.log(`\nwrote ${outFile}`);

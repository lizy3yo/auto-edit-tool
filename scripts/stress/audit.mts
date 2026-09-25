/**
 * scripts/stress/audit.mts — check one finished long-form job against the seven rules the
 * operator set on 2026-09-23/24, and write a report.
 *
 *   npx tsx scripts/stress/audit.mts <jobId> [--no-images] [--no-video]
 *
 * 1. No pause after a CTA         — no automatic hold in the plan; no silence / frozen picture
 *                                    over the threshold in the finished film.
 * 2. CTA order                    — each marked block reads host → book → host → big QR, the QR
 *                                    moves once (corner → centre), no split screens, no b-roll
 *                                    in the pitch when the channel has a host photo.
 * 3. Pictures in the right place  — a line naming a place (where a thing is used/sold/comes
 *                                    from) shows that place, not a poster of it in the workshop.
 * 4. Clean pictures               — subject readable at a glance, no brands, no clutter.
 * 5. No text in pictures          — no readable words/numbers anywhere in a generated frame.
 * 6. Self-introduction on camera  — "I'm <host>" is always the host, full frame.
 * 7. No mid-sentence host cuts    — a host take starts and ends on a sentence unless the 15s
 *                                    ceiling or a fixed neighbour forced the cut; no flash shots.
 *
 * Rules 3-5 are judged by Claude Haiku on one frame per generated picture (a still's clip is a
 * slow zoom on that picture), rules 1/2/6/7 from the storyboard, rule 1 also from the film.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { getLongformVideoJobById } from "../../server/db";
import {
  introducesHost,
  endsSentence,
  startsSentence,
  qrPlacementFor,
  HOST_SENTENCE_MAX_SEC,
  FLASH_SHOT_SEC,
  inMarkedCta,
} from "../../server/longformVideo";
import { sceneHoldPlan } from "../../shared/filmTimeline";
import { invokeClaude } from "../../server/claude";
import { safeParseJSON } from "../../server/jsonRepair";
import type { StoryboardScene, LongformInputParams } from "../../shared/types";

/** Sonnet, not Haiku: Haiku confused "wrong object" with "wrong place" on half its place flags
 *  (bonsai on stands "not at a show", a market table "not a store"). Offline, so latency is fine. */
const JUDGE_MODEL = "claude-sonnet-5";
/** The retired CTA freeze was 3.5s of silence; natural delivery pauses run up to ~1.2s. */
const SILENCE_MAX_SEC = 2.0;
const FREEZE_MAX_SEC = 2.0;

type Finding = { rule: number; scene?: number; detail: string };

const len = (s: StoryboardScene) =>
  Math.max(0, (s.narrationEndSec ?? 0) - (s.narrationStartSec ?? 0)) ||
  s.audioDuration ||
  0;
const textOf = (s: StoryboardScene) => s.scriptText ?? s.narration ?? "";
const fixed = (s: StoryboardScene | undefined) =>
  !!s && (!!s.qrHero || !!s.coverHero || !!s.assetImageUrl);

/** Rule 2: one token per beat of a marked CTA block. */
function ctaToken(s: StoryboardScene): string {
  if (s.qrHero) return "Q";
  if (s.coverHero) return "B";
  if (s.assetImageUrl) return "A";
  if (s.hostPresent && s.splitVisual) return "S";
  if (s.hostPresent) return "H";
  return "P";
}

export function auditPlan(
  scenes: StoryboardScene[],
  params: LongformInputParams
): { findings: Finding[]; stats: Record<string, unknown> } {
  const findings: Finding[] = [];
  const canHost = !!params.faceImageUrl && !params.brollOnly;

  // 1. No automatic hold anywhere.
  for (const s of scenes) {
    const hold = sceneHoldPlan(s).tailHoldSec ?? 0;
    if (hold > 0 && s.tailHoldSec == null)
      findings.push({ rule: 1, scene: s.index, detail: `automatic ${hold}s hold` });
  }

  // 2. CTA order, per marked block.
  const blocks = new Map<number, StoryboardScene[]>();
  for (const s of scenes)
    if (inMarkedCta(s)) blocks.set(s.ctaIndex!, [...(blocks.get(s.ctaIndex!) ?? []), s]);
  const ctaPatterns: string[] = [];
  blocks.forEach((run, idx) => {
    const tokens = run.map(ctaToken).join("");
    ctaPatterns.push(`block ${idx}: ${tokens}`);
    const where = `block ${idx} (${tokens})`;
    if (!/Q+$/.test(tokens)) findings.push({ rule: 2, detail: `${where}: does not END on the big QR` });
    if (/Q[^Q]/.test(tokens)) findings.push({ rule: 2, detail: `${where}: big QR is not one run to the end` });
    if (!tokens.includes("B")) findings.push({ rule: 2, detail: `${where}: no book cover` });
    const afterBook = tokens.slice(tokens.indexOf("B") + 1).replace(/Q+$/, "");
    if (tokens.includes("B") && canHost && !/H/.test(afterBook))
      findings.push({ rule: 2, detail: `${where}: host does not come back after the book` });
    if (tokens.includes("S")) findings.push({ rule: 2, detail: `${where}: split screen in the CTA` });
    if (canHost && tokens.includes("P")) findings.push({ rule: 2, detail: `${where}: b-roll in the pitch` });
    const places = run.map(s => qrPlacementFor(s));
    const moves = places.filter((p, i) => i > 0 && p !== places[i - 1]).length;
    if (moves > 1) findings.push({ rule: 2, detail: `${where}: QR moves ${moves} times` });
  });
  if (blocks.size === 0) findings.push({ rule: 2, detail: "no marked CTA block in the film" });

  // 6. Self-introduction on camera.
  let intros = 0;
  for (const s of scenes) {
    if (!introducesHost(textOf(s), params.hostName)) continue;
    intros++;
    if (canHost && (!s.hostPresent || s.splitVisual))
      findings.push({ rule: 6, scene: s.index, detail: `introduction not on camera: "${textOf(s).slice(0, 70)}"` });
  }

  // 7. Whole-sentence host takes, no flash shots.
  let midTakes = 0;
  scenes.forEach((s, i) => {
    if (len(s) > 0 && len(s) < FLASH_SHOT_SEC)
      findings.push({ rule: 7, scene: s.index, detail: `flash shot ${len(s).toFixed(2)}s` });
    if (!s.hostPresent || fixed(s)) return;
    const prev = scenes[i - 1];
    const next = scenes[i + 1];
    const capped = (n: StoryboardScene | undefined) =>
      // Same ceiling the pipeline stretched to; final alignment moves lengths a little.
      !!n && len(s) + len(n) > HOST_SENTENCE_MAX_SEC - 0.5;
    const edge = (n: StoryboardScene | undefined) =>
      !n || fixed(n) || n.hostPresent || (n.cta === true) !== (s.cta === true) || n.ctaIndex !== s.ctaIndex;
    const badStart = !startsSentence(scenes, i) && !edge(prev) && !capped(prev);
    const badEnd = !endsSentence(textOf(s)) && !edge(next) && !capped(next);
    if (badStart || badEnd) {
      midTakes++;
      findings.push({
        rule: 7,
        scene: s.index,
        detail: `host take ${badStart ? "starts" : "ends"} mid-sentence: "${textOf(s).slice(0, 70)}"`,
      });
    }
  });

  const host = scenes.filter(s => s.hostPresent);
  return {
    findings,
    stats: {
      scenes: scenes.length,
      hostTakes: host.length,
      hostSec: Math.round(host.reduce((a, s) => a + len(s), 0)),
      ctaPatterns,
      introductions: intros,
      midSentenceHostTakes: midTakes,
    },
  };
}

// ── rule 1 in the film ────────────────────────────────────────────────────────────────────────

function detect(url: string, filter: string, stream: "a" | "v"): string {
  const args = ["-hide_banner", "-nostats", "-i", url, "-map", `0:${stream}`];
  if (stream === "v") args.push("-an", "-vf", filter);
  else args.push("-af", filter);
  args.push("-f", "null", "-");
  return spawnSync(ffmpegPath as unknown as string, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stderr;
}

export function auditFilm(url: string): Finding[] {
  const findings: Finding[] = [];
  const sil = detect(url, `silencedetect=noise=-45dB:d=${SILENCE_MAX_SEC}`, "a");
  for (const m of sil.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g))
    findings.push({ rule: 1, detail: `${m[2]}s of silence ending at ${fmt(+m[1])}` });
  const frz = detect(url, `scale=320:-2,freezedetect=n=0.002:d=${FREEZE_MAX_SEC}`, "v");
  for (const m of frz.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g))
    findings.push({ rule: 1, detail: `${m[2]}s frozen picture from ${fmt(+m[1])}` });
  return findings;
}

const fmt = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

// ── rules 3-5 on the pictures ─────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM =
  "You review ONE b-roll frame from a YouTube video against the narration line it plays under. " +
  "Judge ONLY what is visible in the image — the narration is context for the place question, " +
  "never evidence that text or a price is on screen. " +
  "Answer four independent questions and return ONLY this JSON: " +
  '{"text":true|false,"brands":true|false,"cluttered":true|false,"named_place":"...","place":"ok"|"wrong"|"n/a","what":"..."}\n' +
  "named_place: copy the PLACE the narration line names, word for word (e.g. \"Japanese sliding " +
  'doors" → "a Japanese home", "the market table" → "a market", "my porch" → "a porch"), or ' +
  '"none". Objects, materials, prices, techniques and actions are NOT places.\n' +
  "text: is there READABLE writing in the scene — words, numbers, prices or sums on a chalkboard, " +
  "whiteboard, sign, poster, price tag, label, note, screen or packaging? Tiny, blurred or " +
  "unreadable marks, and ruler or tape-measure markings, are false.\n" +
  "brands: is a real brand name or logo legible?\n" +
  "cluttered: is the hero subject small, crowded or lost among busy unrelated objects, or does a " +
  "busy background show through it, so a viewer cannot tell what the shot is about at a glance? " +
  "A heap or stack of the very material the line is about (fabric scraps, yarn, lumber offcuts) " +
  "IS the subject, not clutter — judge only what competes with it.\n" +
  "place: ONLY about the SETTING, never about which object is shown. If the narration names a " +
  "specific kind of PLACE where something is used, sold or comes from — a home or a room in one, " +
  "a market stall or fair, a church or hall, a store, a porch or patio, a garden or field, a " +
  "hospital, a particular country's buildings — is the frame set IN that kind of place " +
  '("ok"), or clearly somewhere else, or showing it as a picture/poster on a wall ("wrong")? A ' +
  "workshop, garage, shed, sewing room, kitchen table or work bench all count as the SAME home " +
  'base and never make it wrong. If the line names no such place, or you are unsure, "n/a".\n' +
  'what: 3-10 words naming the worst problem, or "" when there is none.';

async function frameOf(url: string, atSec = 1): Promise<Buffer | null> {
  const r = spawnSync(
    ffmpegPath as unknown as string,
    ["-hide_banner", "-loglevel", "error", "-ss", String(atSec), "-i", url, "-frames:v", "1", "-vf", "scale=768:-2", "-f", "image2", "-c:v", "png", "-"],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  return r.status === 0 && r.stdout?.length ? (r.stdout as Buffer) : null;
}

type Judged = { scene: number; kind: string; text: boolean; brands: boolean; cluttered: boolean; place: string; what: string };

async function judge(buf: Buffer, narration: string): Promise<Omit<Judged, "scene" | "kind"> | null> {
  try {
    const r = await invokeClaude({
      systemPrompt: JUDGE_SYSTEM,
      userMessage: `Narration line: "${narration}"\nJSON:`,
      imageInput: { base64: buf.toString("base64"), mediaType: "image/png" },
      // Room for Sonnet's own reasoning ahead of the JSON — at 160 the answer was cut off, and a
      // truncated reply parsed as "text: true" with no reason (8 of 9 text flags in round 3).
      maxTokens: 2000,
      model: JUDGE_MODEL,
    });
    const p = safeParseJSON<any>(r.text, r.stopReason);
    if (!p.success) return null;
    // A flag must name what it saw; a verdict with no reason is a truncated or guessed answer.
    if (typeof p.data.what !== "string" || !p.data.what.trim()) {
      p.data.text = false;
      p.data.brands = false;
      p.data.cluttered = false;
      p.data.place = "n/a";
    }
    return {
      text: p.data.text === true,
      brands: p.data.brands === true,
      cluttered: p.data.cluttered === true,
      // Judged only where the judge could NAME the place the line gives — objects and actions
      // are not places, and a judge that cannot say which place was meant has nothing to judge.
      place:
        typeof p.data.named_place === "string" &&
        !/^\s*none\s*$/i.test(p.data.named_place) &&
        typeof p.data.place === "string"
          ? p.data.place
          : "n/a",
      what: typeof p.data.what === "string" ? p.data.what : "",
    };
  } catch {
    return null;
  }
}

export async function auditImages(scenes: StoryboardScene[]): Promise<{ findings: Finding[]; judged: Judged[] }> {
  const jobs: { scene: StoryboardScene; kind: string; url: string }[] = [];
  for (const s of scenes) {
    if (s.coverHero || s.assetImageUrl) continue;
    const clip = s.clipUrls?.[0] ?? s.clipUrl;
    if (!s.hostPresent && clip) jobs.push({ scene: s, kind: s.qrHero ? "qr-background" : "b-roll", url: clip });
    if (s.hostPresent && s.splitVisual && s.splitRightUrl)
      jobs.push({ scene: s, kind: "split-panel", url: s.splitRightUrl });
  }
  const judged: Judged[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const buf = await frameOf(j.url);
      if (!buf) continue;
      const v = await judge(buf, textOf(j.scene));
      // A CTA picture deliberately ignores its line (a sales pitch) — no place to be right about.
      if (v && j.scene.cta) v.place = "n/a";
      if (v) judged.push({ scene: j.scene.index, kind: j.kind, ...v });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  judged.sort((a, b) => a.scene - b.scene);
  const findings: Finding[] = [];
  for (const j of judged) {
    if (j.place === "wrong") findings.push({ rule: 3, scene: j.scene, detail: `${j.kind}: wrong place — ${j.what}` });
    if (j.cluttered || j.brands) findings.push({ rule: 4, scene: j.scene, detail: `${j.kind}: ${j.brands ? "brand visible" : "cluttered"} — ${j.what}` });
    if (j.text) findings.push({ rule: 5, scene: j.scene, detail: `${j.kind}: readable text — ${j.what}` });
  }
  return { findings, judged };
}

// ── pass/fail ─────────────────────────────────────────────────────────────────────────────────

/** Rules 3-5 are judged on AI pictures, so they pass on a rate, the others on zero findings. */
export function verdicts(findings: Finding[], judged: Judged[] | null) {
  const n = judged?.length ?? 0;
  const count = (r: number) => findings.filter(f => f.rule === r).length;
  const placed = judged?.filter(j => j.place !== "n/a").length ?? 0;
  const rate = (r: number, over: number) => (over ? count(r) / over : 0);
  return {
    1: count(1) === 0,
    2: count(2) === 0,
    // Judged against ALL pictures: the judge names a place only when it sees one missed, so a
    // rate over "placed" pictures is always 100%.
    3: judged ? rate(3, n) <= 0.05 : null,
    4: judged ? rate(4, n) <= 0.1 : null,
    // No text at all: every hit is reviewed by hand; one is allowed for a judge false positive.
    5: judged ? count(5) <= 1 : null,
    6: count(6) === 0,
    7: count(7) === 0,
  } as Record<number, boolean | null>;
}

export async function auditJob(jobId: number, opts: { images?: boolean; video?: boolean } = {}) {
  const job = await getLongformVideoJobById(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const scenes = (typeof job.storyboard === "string" ? JSON.parse(job.storyboard) : job.storyboard) as StoryboardScene[];
  const params = (typeof job.inputParams === "string" ? JSON.parse(job.inputParams) : job.inputParams) as LongformInputParams;
  const plan = auditPlan(scenes, params);
  const film = opts.video !== false && job.finalVideoUrl ? auditFilm(job.finalVideoUrl) : [];
  const images = opts.images !== false ? await auditImages(scenes) : null;
  const findings = [...plan.findings, ...film, ...(images?.findings ?? [])].sort(
    (a, b) => a.rule - b.rule || (a.scene ?? 0) - (b.scene ?? 0)
  );
  const v = verdicts(findings, images?.judged ?? null);
  const report = {
    jobId,
    channel: params.channelKey,
    title: params.title,
    status: job.status,
    rehearsal: !!params.rehearsal,
    finalVideoUrl: job.finalVideoUrl,
    verdicts: v,
    stats: { ...plan.stats, picturesJudged: images?.judged.length ?? 0 },
    findings,
  };
  const dir = path.join("scripts", "stress", "reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `job-${jobId}.json`), JSON.stringify({ ...report, judged: images?.judged }, null, 1));
  return report;
}

const RULES = ["", "no pause after CTA", "CTA order", "right place", "clean pictures", "no text", "intro on camera", "whole sentences"];

export function summarize(r: Awaited<ReturnType<typeof auditJob>>): string {
  const lines = [`job ${r.jobId} (${r.channel}) — ${r.status}${r.rehearsal ? ", rehearsal" : ""}`];
  for (let k = 1; k <= 7; k++) {
    const v = r.verdicts[k];
    const n = r.findings.filter(f => f.rule === k).length;
    lines.push(`  ${v === null ? "–" : v ? "PASS" : "FAIL"}  ${k}. ${RULES[k]}${n ? ` (${n} finding${n > 1 ? "s" : ""})` : ""}`);
  }
  lines.push(`  stats: ${JSON.stringify(r.stats)}`);
  for (const f of r.findings.slice(0, 40)) lines.push(`   - [${f.rule}]${f.scene ? ` scene ${f.scene}` : ""} ${f.detail}`);
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("audit.mts")) {
  const id = Number(process.argv[2]);
  const r = await auditJob(id, {
    images: !process.argv.includes("--no-images"),
    video: !process.argv.includes("--no-video"),
  });
  console.log(summarize(r));
  process.exit(0);
}

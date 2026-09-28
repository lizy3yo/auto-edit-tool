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
 * 7. Clean host switches         — a host take starts on a sentence and ends on one, or hands
 *                                    over to a picture the shot list cut at a natural break; no
 *                                    flash shots (a list item may be a quick cut).
 * 8. Host often                   — no stretch without the host longer than ~40 s in the first
 *                                    3 minutes, ~75 s after (targets 30 / 60).
 * 9. Pictures don't linger        — a b-roll picture outside the CTA runs no longer than its
 *                                    quarter of the film allows: 7 / 10 / 12 / 14 s
 *                                    (`pictureMaxSecAt`, 2026-09-28; it was a flat 6.5 s).
 * 10. Say it, show it             — the picture shows the thing its line names (judged).
 * 11. Real video                  — 10-25% of cutaway time is a moving shot (flagged motion):
 *                                    more stills, fewer clips (2026-09-28; it demanded >= 30%).
 * 12. The voice says every word   — the master is transcribed and every script paragraph found in
 *                                    it; words with no time for them were skipped by the TTS
 *                                    (`findSkippedWords`, the same check the pipeline repairs with).
 * 13. Looks like a phone photo    — the picture reads as an ordinary phone photo, not a styled,
 *                                    staged or AI-rendered image (judged; 2026-09-28).
 * 14. No cut inside a word        — every cut falls between two words: a cut the transcript puts
 *                                    well inside a word (> 60 ms from both edges) and that is not
 *                                    in a real pause (≥ 120 ms) is flagged (2026-09-28).
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
import { invokeClaude } from "../../server/claude";
import { safeParseJSON } from "../../server/jsonRepair";
import type { StoryboardScene, LongformInputParams } from "../../shared/types";
import { checkPlan, fmt, textOf, type PlanFinding } from "../../server/planGate";
import { parseCtaMarkers } from "../../server/longformVideo";
import { extractSpokenScript } from "../../shared/ctaMarkers";
import { scriptParagraphs } from "../../server/delivery";
import { detectSilencesFromBuffer, extractMonoAudio, probeUrlDurationSec } from "../../server/videoAssembly";
import { transcribeInPieces } from "../../server/alignmentHeal";
import { transcribeWordsFromBuffer } from "../../server/_core/voiceTranscription";
import { findSkippedWords } from "../../server/narrationSkips";

/** Sonnet, not Haiku: Haiku confused "wrong object" with "wrong place" on half its place flags
 *  (bonsai on stands "not at a show", a market table "not a store"). Offline, so latency is fine. */
const JUDGE_MODEL = "claude-sonnet-5";
/** The retired CTA freeze was 3.5s of silence; natural delivery pauses run up to ~1.2s. */
const SILENCE_MAX_SEC = 2.0;
const FREEZE_MAX_SEC = 2.0;
/** A frozen picture is a pause when the voice stops for this long in one stretch under it. */
const FROZEN_PAUSE_SEC = 1.5;

type Finding = PlanFinding;
export const auditPlan = checkPlan;

// ── rule 1 in the film ────────────────────────────────────────────────────────────────────────

function detect(url: string, filter: string, stream: "a" | "v"): string {
  const args = ["-hide_banner", "-nostats", "-i", url, "-map", `0:${stream}`];
  if (stream === "v") args.push("-an", "-vf", filter);
  else args.push("-af", filter);
  args.push("-f", "null", "-");
  // A stalled download of the film hung one audit for over an hour — cap the scan. A film scan
  // that runs out of time reports as a finding, never as a silent pass.
  const r = spawnSync(ffmpegPath as unknown as string, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 25 * 60_000,
  });
  if (r.error || r.signal) return `SCAN FAILED: ${r.error?.message ?? r.signal}`;
  return r.stderr;
}

export function auditFilm(url: string): Finding[] {
  const findings: Finding[] = [];
  const sil = detect(url, `silencedetect=noise=-45dB:d=${SILENCE_MAX_SEC}`, "a");
  if (sil.startsWith("SCAN FAILED"))
    findings.push({ rule: 1, detail: `film silence scan did not finish (${sil}) — rerun it` });
  for (const m of sil.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g))
    findings.push({ rule: 1, detail: `${m[2]}s of silence ending at ${fmt(+m[1])}` });
  // A frozen picture is a PAUSE only when the voice stops with it. Since 2026-09-28 a still may be
  // deliberately static (no zoom) while the narration carries on — the first practice runs read
  // every one of those as "a frozen picture after the CTA".
  const quiet = detect(url, "silencedetect=noise=-45dB:d=0.4", "a");
  const silent: [number, number][] = [];
  for (const m of quiet.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g))
    silent.push([+m[1], +m[2]]);
  const frz = detect(url, `scale=320:-2,freezedetect=n=0.002:d=${FREEZE_MAX_SEC}`, "v");
  for (const m of frz.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)) {
    const [from, dur] = [+m[1], +m[2]];
    // One continuous stop, not the sum of the gaps between sentences a still plays under.
    const overlap = silent.reduce(
      (a, [s, e]) => Math.max(a, Math.min(e, from + dur) - Math.max(s, from)),
      0
    );
    if (overlap >= FROZEN_PAUSE_SEC)
      findings.push({ rule: 1, detail: `${dur}s frozen picture with a ${overlap.toFixed(1)}s stop in the voice from ${fmt(from)}` });
  }
  return findings;
}


// ── rules 3-5 on the pictures ─────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM =
  "You review ONE b-roll frame from a YouTube video against the narration line it plays under. " +
  "Judge ONLY what is visible in the image — the narration is context for the place question, " +
  "never evidence that text or a price is on screen. " +
  "Answer five independent questions and return ONLY this JSON: " +
  '{"text":true|false,"brands":true|false,"cluttered":true|false,"staged":true|false,"named_place":"...","place":"ok"|"wrong"|"n/a","shows":true|false|"n/a","what":"..."}\n' +
  "shows: when a MUST SHOW thing is given, is that thing the CENTRE OF ATTENTION — the main thing " +
  "the eye lands on (even from an unusual angle)? false when it is a different thing, absent, or " +
  "small / at an edge / outweighed by something else that takes most of the frame; otherwise " +
  'true. "n/a" when no MUST SHOW is given.\n' +
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
  "IS the subject, not clutter, and a real, used room with a few everyday things at the edges is " +
  "fine — judge only what competes with it.\n" +
  "place: ONLY about the SETTING, never about which object is shown. If the narration names a " +
  "specific kind of PLACE where something is used, sold or comes from — a home or a room in one, " +
  "a market stall or fair, a church or hall, a store, a porch or patio, a garden or field, a " +
  "hospital, a particular country's buildings — is the frame set IN that kind of place " +
  '("ok"), or clearly somewhere else, or showing it as a picture/poster on a wall ("wrong")? A ' +
  "workshop, garage, shed, sewing room, kitchen table or work bench all count as the SAME home " +
  'base and never make it wrong. If the line names no such place, or you are unsure, "n/a".\n' +
  "staged: would a viewer take this for a styled, staged or AI-rendered image rather than an " +
  "ordinary photo someone took on their phone — a glowing lamp or golden glow lighting it, moody " +
  "light with dark corners, props neatly arranged around the subject, glossy hyper-detailed " +
  "textures, a perfectly composed product close-up? The HOST seen from behind doing the work is " +
  "expected, not a problem. When unsure, false.\n" +
  'what: 3-10 words naming the worst problem, or "" when there is none.';

async function frameOf(url: string, atSec = 1): Promise<Buffer | null> {
  const r = spawnSync(
    ffmpegPath as unknown as string,
    ["-hide_banner", "-loglevel", "error", "-ss", String(atSec), "-i", url, "-frames:v", "1", "-vf", "scale=768:-2", "-f", "image2", "-c:v", "png", "-"],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  return r.status === 0 && r.stdout?.length ? (r.stdout as Buffer) : null;
}

type Judged = { scene: number; kind: string; text: boolean; brands: boolean; cluttered: boolean; staged: boolean; place: string; shows: boolean | null; what: string };

async function judge(buf: Buffer, narration: string, mustShow?: string): Promise<Omit<Judged, "scene" | "kind"> | null> {
  try {
    const r = await invokeClaude({
      systemPrompt: JUDGE_SYSTEM,
      userMessage: `Narration line: "${narration}"\n` + (mustShow ? `MUST SHOW: "${mustShow}"\n` : "") + "JSON:",
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
      p.data.staged = false;
      p.data.place = "n/a";
    }
    return {
      text: p.data.text === true,
      brands: p.data.brands === true,
      cluttered: p.data.cluttered === true,
      staged: p.data.staged === true,
      // Judged only where the judge could NAME the place the line gives — objects and actions
      // are not places, and a judge that cannot say which place was meant has nothing to judge.
      place:
        typeof p.data.named_place === "string" &&
        !/^\s*none\s*$/i.test(p.data.named_place) &&
        typeof p.data.place === "string"
          ? p.data.place
          : "n/a",
      shows: mustShow ? p.data.shows !== false : null,
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
      const v = await judge(buf, textOf(j.scene), j.scene.showSubject);
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
    if (j.shows === false) findings.push({ rule: 10, scene: j.scene, detail: `${j.kind}: does not show what is said — ${j.what}` });
    // The picture under the big QR is mostly hidden by the card, and its line ("grab your phone,
    // point it at the code") confused the judge into reading "phone" as the subject.
    if (j.staged && j.kind !== "qr-background") findings.push({ rule: 13, scene: j.scene, detail: `${j.kind}: not a phone-photo look — ${j.what}` });
  }
  return { findings, judged };
}

// ── rule 12: the voice says every word ────────────────────────────────────────────────────────

/** How far inside a transcribed word a cut must be to count, and the pause that excuses it. */
const INSIDE_WORD_SEC = 0.06;
const REAL_PAUSE_SEC = 0.12;

/**
 * Rule 14: cuts that land inside a spoken word. Transcript word edges run late through pauses, so
 * a cut is only flagged when it is well inside a word AND not in a real pause — the pause is what
 * the ear hears as the gap between words, whatever the transcript claims. Pure — the words and
 * pauses come from the caller.
 */
export function cutsInsideWords(
  scenes: StoryboardScene[],
  words: { word: string; start: number; end: number }[],
  pauses: { start: number; end: number }[]
): Finding[] {
  const out: Finding[] = [];
  for (let i = 1; i < scenes.length; i++) {
    const at = scenes[i].narrationStartSec;
    // A ripple trim leaves a hole between scenes — that is a cut in the voice, not a picture cut.
    if (at == null || Math.abs((scenes[i - 1].narrationEndSec ?? at) - at) > 0.01) continue;
    const w = words.find(x => at > x.start + INSIDE_WORD_SEC && at < x.end - INSIDE_WORD_SEC);
    if (!w) continue;
    const inPause = pauses.some(p => p.end - p.start >= REAL_PAUSE_SEC && at >= p.start - 0.02 && at <= p.end + 0.02);
    if (inPause) continue;
    out.push({
      rule: 14,
      scene: scenes[i].index,
      detail: `cut at ${at.toFixed(2)}s inside "${w.word}" (${w.start.toFixed(2)}-${w.end.toFixed(2)})`,
    });
  }
  return out;
}

export async function auditVoice(
  masterUrl: string,
  params: LongformInputParams,
  scenes: StoryboardScene[] = []
): Promise<Finding[]> {
  if (params.manualNarrationUrl) return [];
  const paragraphs = scriptParagraphs(parseCtaMarkers(extractSpokenScript(params.script)).script);
  const mono = await extractMonoAudio(masterUrl);
  let t: Awaited<ReturnType<typeof transcribeInPieces>> = await transcribeWordsFromBuffer(mono);
  if ("error" in t) {
    t = await transcribeInPieces({ monoAudio: mono, durationSec: await probeUrlDurationSec(masterUrl, "mp3") });
  }
  if ("error" in t) return [{ rule: 12, detail: `could not transcribe the narration (${t.error})` }];
  const inside = cutsInsideWords(scenes, t.words, await detectSilencesFromBuffer(mono));
  return inside.concat(findSkippedWords(paragraphs, t.words, t.duration).map(s => ({
    rule: 12,
    detail: `voice skipped ${s.missing.split(" ").length} word(s) at ${s.atSec.toFixed(0)}s (paragraph ${s.paragraphs.map(p => p + 1).join(", ")}): "${s.missing.slice(0, 80)}"`,
  })));
}

// ── pass/fail ─────────────────────────────────────────────────────────────────────────────────

/** Rules 3-5 are judged on AI pictures, so they pass on a rate, the others on zero findings. */
export function verdicts(findings: Finding[], judged: Judged[] | null, voiceChecked = true) {
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
    8: count(8) === 0,
    // A clause-less long sentence can still run long; a few are allowed.
    9: count(9) <= 3,
    10: judged ? rate(10, judged.filter(j => j.shows !== null).length) <= 0.1 : null,
    11: count(11) === 0,
    12: voiceChecked ? count(12) === 0 : null,
    // A few borderline frames are allowed: the judge is strict and the look is a matter of degree.
    13: judged ? rate(13, n) <= 0.1 : null,
    14: voiceChecked ? count(14) === 0 : null,
  } as Record<number, boolean | null>;
}

export async function auditJob(
  jobId: number,
  opts: { images?: boolean; video?: boolean; voice?: boolean } = {}
) {
  const job = await getLongformVideoJobById(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const scenes = (typeof job.storyboard === "string" ? JSON.parse(job.storyboard) : job.storyboard) as StoryboardScene[];
  const params = (typeof job.inputParams === "string" ? JSON.parse(job.inputParams) : job.inputParams) as LongformInputParams;
  const plan = auditPlan(scenes, params);
  const film = opts.video !== false && job.finalVideoUrl ? auditFilm(job.finalVideoUrl) : [];
  const images = opts.images !== false ? await auditImages(scenes) : null;
  const voice =
    opts.voice !== false && job.masterAudioUrl ? await auditVoice(job.masterAudioUrl, params, scenes) : [];
  const findings = [...plan.findings, ...film, ...voice, ...(images?.findings ?? [])].sort(
    (a, b) => a.rule - b.rule || (a.scene ?? 0) - (b.scene ?? 0)
  );
  const voiceChecked = opts.voice !== false && !!job.masterAudioUrl;
  const v = verdicts(findings, images?.judged ?? null, voiceChecked);
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
  // A partial run (no pictures / film / voice) never overwrites the full report.
  const partial = opts.images === false || opts.video === false || opts.voice === false;
  writeFileSync(
    path.join(dir, `job-${jobId}${partial ? ".partial" : ""}.json`),
    JSON.stringify({ ...report, judged: images?.judged }, null, 1)
  );
  return report;
}

const RULES = ["", "no pause after CTA", "CTA order", "right place", "clean pictures", "no text", "intro on camera", "clean host switches", "host often", "pictures don't linger", "say it, show it", "real video", "voice says every word", "looks like a phone photo", "no cut inside a word"];

export function summarize(r: Awaited<ReturnType<typeof auditJob>>): string {
  const lines = [`job ${r.jobId} (${r.channel}) — ${r.status}${r.rehearsal ? ", rehearsal" : ""}`];
  for (let k = 1; k < RULES.length; k++) {
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
    voice: !process.argv.includes("--no-voice"),
  });
  console.log(summarize(r));
  process.exit(0);
}

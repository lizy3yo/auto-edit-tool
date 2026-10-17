// MOTION GRAPHICS — the finishing step of assembly (Steve Cooper-style cards, labels and captions).
// Runs on the ASSEMBLED film, after its loudness is set and before it is uploaded, so the saved
// film carries its graphics. General for any channel and any script: words from the film's own
// narration, cuts from its own picture, colours from its own host photo, graphics wherever the
// script calls for them (graphics/src/plan/planner.ts), every one held to the same rules.
//
//   1. word times: the film's narration, transcribed (cached by the sound itself)
//   2. picture cuts: measured off the film
//   3. colours: from the video's host photo (graphics/src/palette.ts)
//   4. plan: the SAVED plan when there is one (a Reassemble brings back the same graphics, no model
//      call), else one model call ("Graphics plan" on the Cost dialog)
//   5. render each graphic; text on footage measured on the real frames and fixed until readable —
//      one that still cannot be read is left out, never shipped
//   6. one ffmpeg pass lays them on the film; the sound is copied untouched
//   7. QA on the finished film (flashes, flicker, sync, lingering, placement, readability)
//
// Never fails a film: the caller ships the film without graphics, with a warning, on any error.
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { argbFromRgb } from "@material/material-color-utilities";
import { invokeClaude } from "../claude";
import { presignOwnBucketUrl } from "../storage";
import { transcribeWordsFromBuffer } from "../_core/voiceTranscription";
import { CueError, resolveCues, type CueSpec, type ResolvedCue, type Word } from "../../graphics/src/cueResolve";
import { TEMPLATES, templateById } from "../../graphics/src/registry";
import { FPS, type Theme } from "../../graphics/src/theme";
import { themeFromPixels } from "../../graphics/src/palette";
import { WINDOW } from "../../graphics/src/more";
import { NOTO_PNG, planGraphics, type PlanMessage } from "../../graphics/src/plan/planner";
import { checkRules, type FilmLayout } from "../../graphics/src/plan/rules";
import { detectCuts, judgeFilm, type QaResult, type Readability } from "../../graphics/src/plan/qa";
import { getMediaDuration } from "../mediaProbe";
import { ffmpeg, frameDiffs, narrationOf } from "./media";
import { calmestPlace, describe, measureCue, score, subjectOf } from "./readable";
import { GRAPHICS_DIR, renderGraphic } from "./render";

/** The model that writes the plan (the lab measured Opus best at following the moments). */
export const GRAPHICS_PLAN_MODEL = process.env.GRAPHICS_PLAN_MODEL ?? "claude-opus-5-5";

const CACHE = process.env.GRAPHICS_CACHE_DIR ?? path.join(os.tmpdir(), "longform-graphics-cache");
/** Rendered graphics kept for a Reassemble to reuse, oldest dropped first past this size. */
const CACHE_MAX_BYTES = Number(process.env.GRAPHICS_CACHE_MAX_GB ?? 8) * 1e9;

/** What a film's graphics were, kept on the job: the plan (reused by a Reassemble), what was
 * placed, and the QA. */
export type GraphicsRecord = {
  at: string;
  plan: CueSpec[];
  placed: { id: string; template: string; start: number; end: number }[];
  /** Graphics left out of this film, and why. */
  dropped: { id: string; why: string }[];
  theme?: { accent: string; bg: string };
  qa: QaResult;
  readability: Readability[];
  planner?: { model: string; rounds: number };
};

export type AddGraphicsInput = {
  jobId: number;
  /** The assembled film (mp4) and where to write it with graphics. */
  filmPath: string;
  outPath: string;
  film: FilmLayout;
  hostPhotoUrl?: string;
  /** The plan saved on the job (reused as it is unless `replan`). */
  savedPlan?: CueSpec[];
  replan?: boolean;
  /** Progress, 0-100, for the job card. */
  onProgress?: (label: string, pct: number) => void;
  log?: (m: string) => void;
};

/** Templates whose decorations (not words) carry the theme's colours: measured without them. */
const MEASURE_WITHOUT_DECORATION = new Set(["CrossedList"]);
const structural = new Set(TEMPLATES.filter(t => t.structural).map(t => t.id));
const cards = new Set(TEMPLATES.filter(t => t.kind === "card").map(t => t.id));
const sha = (x: Buffer | string) => createHash("sha1").update(x).digest("hex");

function ensureDir(d: string): string {
  mkdirSync(d, { recursive: true });
  return d;
}

/* ───────────── inputs ───────────── */

/** The film's narration, word by word on the film's own clock. Cached by the sound itself, so a
 * Reassemble that did not change the sound does not transcribe again. */
async function wordsOf(filmPath: string): Promise<Word[]> {
  const audio = await narrationOf(filmPath);
  const file = path.join(ensureDir(path.join(CACHE, "words")), `${sha(audio)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Word[];
  const t = await transcribeWordsFromBuffer(audio);
  if ("error" in t) throw new Error(`the narration could not be transcribed (${t.error})`);
  const words: Word[] = t.words.map(w => ({ text: w.word, start: w.start, end: w.end }));
  writeFileSync(file, JSON.stringify(words));
  return words;
}

/** The video's colours, from its host photo; none (the default navy) when it cannot be read. */
async function themeOf(photoUrl: string | undefined): Promise<Theme | undefined> {
  if (!photoUrl) return undefined;
  try {
    // Our own photo read over the storage endpoint, never the public r2.dev address: that one is
    // blocked on many networks, and the read then failed silently into the default colours
    // (Dale, job 386).
    const res = await fetch(await presignOwnBucketUrl(photoUrl));
    if (!res.ok) return undefined;
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).resize(160).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels: number[] = [];
    for (let i = 0; i < data.length; i += info.channels) pixels.push(argbFromRgb(data[i], data[i + 1], data[i + 2]));
    return themeFromPixels(pixels).theme;
  } catch {
    return undefined;
  }
}

/** An emoji's image (pinned Noto), fetched once into the cache. */
async function iconFile(code: string): Promise<string | null> {
  const file = path.join(ensureDir(path.join(CACHE, "icons")), `${code}.png`);
  if (existsSync(file)) return file;
  const res = await fetch(`${NOTO_PNG}/emoji_u${code}.png`);
  if (!res.ok) return null;
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Every icon code in a graphic's props becomes its image INLINE (a data: URL), so the bundled
 * templates never need a file added after they were bundled. */
async function inlineIcons(node: unknown): Promise<void> {
  if (Array.isArray(node)) {
    for (const x of node) await inlineIcons(x);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (k === "icon" && typeof v === "string" && !v.startsWith("data:")) {
      const f = await iconFile(v);
      if (f) o.icon = `data:image/png;base64,${readFileSync(f).toString("base64")}`;
      else delete o.icon;
    } else await inlineIcons(v);
  }
}

/* ───────────── the plan ───────────── */

async function plan(input: AddGraphicsInput, words: Word[], cuts: number[]): Promise<{ cues: CueSpec[]; rounds?: number }> {
  if (input.savedPlan?.length && !input.replan) return { cues: input.savedPlan };
  const ask = async (system: string, messages: PlanMessage[]): Promise<string> => {
    // The repair round is one message carrying the first answer, on the same metered call.
    const userMessage =
      messages.length === 1
        ? messages[0].content
        : `${messages[0].content}\n\nYOUR FIRST ANSWER WAS:\n${messages[1].content}\n\n${messages[2].content}`;
    const r = await invokeClaude({
      systemPrompt: system,
      userMessage,
      model: GRAPHICS_PLAN_MODEL,
      maxTokens: 32000,
      step: messages.length === 1 ? "Graphics plan" : "Graphics plan (repair)",
    });
    return r.text;
  };
  const p = await planGraphics({ words, cuts, film: input.film, ask, ensureIcon: async code => !!(await iconFile(code)) });
  return { cues: p.cues, rounds: p.rounds.length };
}

/** Resolve a plan cue by cue (film order), leaving out any that no longer resolve or break a
 * placement rule — a saved plan on a film that was edited since must not bring a broken graphic. */
function resolveKeeping(specs: CueSpec[], words: Word[], cuts: number[], film: FilmLayout, dropped: GraphicsRecord["dropped"]): { specs: CueSpec[]; cues: ResolvedCue[] } {
  const opts = { cuts, fps: FPS, structural, cards };
  const kept: CueSpec[] = [];
  let resolved: ResolvedCue[] = [];
  for (const spec of specs) {
    try {
      const next = resolveCues([...kept, spec], words, opts);
      const rule = checkRules(next, film).filter(p => p.cue === spec.id);
      if (rule.length) {
        dropped.push({ id: spec.id, why: rule.map(r => r.problem).join("; ") });
        continue;
      }
      kept.push(spec);
      resolved = next;
    } catch (e) {
      dropped.push({ id: spec.id, why: e instanceof CueError ? e.message : String(e) });
    }
  }
  return { specs: kept, cues: resolved };
}

/** A hash of the templates' own code: any change to them renders every graphic again (a cached
 * render is only reused while the code that drew it is the same). */
let _version: string | undefined;
function templatesVersion(): string {
  if (_version) return _version;
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      const full = path.join(d, f);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(f) && !f.endsWith(".test.ts")) files.push(readFileSync(full, "utf8"));
    }
  };
  walk(path.join(GRAPHICS_DIR, "src"));
  return (_version = sha(files.join("\n")));
}

/* ───────────── the step ───────────── */

export async function addGraphics(input: AddGraphicsInput): Promise<GraphicsRecord> {
  const log = input.log ?? (() => {});
  const progress = input.onProgress ?? (() => {});
  const gfxDir = ensureDir(path.join(CACHE, "gfx"));
  const dropped: GraphicsRecord["dropped"] = [];

  progress("Reading the narration", 2);
  const words = await wordsOf(input.filmPath);
  progress("Measuring the picture cuts", 8);
  const filmDiffs = await frameDiffs(input.filmPath);
  // The graphics are drawn at FPS; on a film at another rate every edge would land off its frame.
  const fps = filmDiffs.length / Math.max(0.001, await getMediaDuration(input.filmPath));
  if (Math.abs(fps - FPS) > 0.5) throw new Error(`the film runs at ${fps.toFixed(2)} fps; graphics are drawn at ${FPS}`);
  const cuts = detectCuts(filmDiffs).map(f => f / FPS);
  const theme = await themeOf(input.hostPhotoUrl);
  progress(input.savedPlan?.length && !input.replan ? "Using the saved graphics plan" : "Planning the graphics", 12);
  const planned = await plan(input, words, cuts);
  const { specs, cues } = resolveKeeping(planned.cues, words, cuts, input.film, dropped);
  log(`graphics: ${cues.length} placed${dropped.length ? `, ${dropped.length} left out` : ""}${theme ? `, accent ${theme.accent}` : ""}`);

  // Render each graphic (cached by what it is), text on footage held to readability.
  const SOURCE = templatesVersion();
  const renderCue = async (c: ResolvedCue): Promise<string> => {
    const def = templateById(c.template);
    const file = path.join(gfxDir, `${sha(JSON.stringify([c.template, c.props, SOURCE])).slice(0, 16)}.${def.kind === "card" ? "mp4" : "mov"}`);
    if (!existsSync(file)) await renderGraphic(c.template, c.props, file);
    return file;
  };
  // Readability is about WORDS: a graphic carrying icons or decorative marks is measured on a copy
  // drawn without them (each one's box left blank, so every word sits where it does), and the real
  // one is shipped — an emoji close to the accent's colour, or a red strike line across grey words,
  // would otherwise read as unreadable coloured text (Scarlett, job 387).
  const measuringCopies: string[] = [];
  const hasIcon = (node: unknown): boolean =>
    Array.isArray(node) ? node.some(hasIcon) : !!node && typeof node === "object" && Object.entries(node).some(([k, v]) => (k === "icon" && typeof v === "string") || hasIcon(v));
  const measure = async (c: ResolvedCue, file: string) => {
    if (!hasIcon(c.props) && !MEASURE_WITHOUT_DECORATION.has(c.template)) return measureCue(input.filmPath, file, c, cuts);
    const copy = await renderCue({ ...c, props: { ...c.props, measuring: true } });
    measuringCopies.push(copy);
    return measureCue(input.filmPath, copy, c, cuts);
  };
  const rendered: { cue: ResolvedCue; file: string }[] = [];
  const readability: Readability[] = [];
  const attempts: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    progress(`Rendering graphics ${i + 1}/${cues.length}`, 15 + Math.round((70 * i) / Math.max(1, cues.length)));
    const def = templateById(c.template);
    if (theme) c.props.theme = theme;
    await inlineIcons(c.props);
    if (c.template === "ArrowCaption" && !c.props.target) {
      const s = await subjectOf(input.filmPath, (c.start + c.end) / 2);
      c.props.target = { x: s.x, y: s.y };
    }
    let file = await renderCue(c);
    if (def.kind === "overlay" && def.underlay !== "window") {
      const steps: string[] = [];
      let r = await measure(c, file);
      steps.push(`as designed: ${describe(r)}`);
      let best = { r, file, props: { ...c.props } };
      const keep = () => {
        attempts.push(file);
        if (r.pass || score(r) > score(best.r)) best = { r, file, props: { ...c.props } };
      };
      for (const shade of [0.5, 1]) {
        if (r.pass) break;
        c.props.shade = shade;
        file = await renderCue(c);
        r = await measure(c, file);
        steps.push(`darker behind the words (${shade}): ${describe(r)}`);
        keep();
      }
      if (!r.pass && r.colour !== undefined && r.colour < 4.5) {
        c.props.lift = 1;
        file = await renderCue(c);
        r = await measure(c, file);
        steps.push(`lighter shade of the coloured words: ${describe(r)}`);
        keep();
      }
      if (!r.pass && def.movable && r.box) {
        c.props.place = await calmestPlace(input.filmPath, c, cuts, { w: r.box.x1 - r.box.x0, h: r.box.y1 - r.box.y0 });
        file = await renderCue(c);
        r = await measure(c, file);
        steps.push(`moved to the calmest part of the picture: ${describe(r)}`);
        keep();
      }
      c.props = best.props as typeof c.props;
      file = best.file;
      readability.push({ id: c.id, pass: best.r.pass, summary: describe(best.r), steps });
      // Text that cannot be read is left out, never shipped.
      if (!best.r.pass) {
        dropped.push({ id: c.id, why: `text not readable on the picture (${describe(best.r)})` });
        continue;
      }
    }
    rendered.push({ cue: c, file });
  }
  // Attempts the readability check turned down are not kept.
  const shipped = new Set(rendered.map(r => r.file));
  for (const f of attempts) if (!shipped.has(f)) rmSync(f, { force: true });
  for (const f of measuringCopies) if (!shipped.has(f)) rmSync(f, { force: true });

  // One ffmpeg pass: the picture scaled into window graphics, blurred under quotes, then every
  // graphic shifted to its start and enabled only for its frames (half-frame guards, so rounding
  // can never put an edge on the wrong frame).
  progress("Laying the graphics on the film", 87);
  const win = (c: ResolvedCue) => `gte(t,${((c.startFrame - 0.5) / FPS).toFixed(5)})*lt(t,${((c.endFrame - 0.5) / FPS).toFixed(5)})`;
  const inputs = ["-i", input.filmPath];
  const chain: string[] = [];
  let cur = "[0:v]";
  rendered.forEach(({ cue }, n) => {
    const u = templateById(cue.template).underlay;
    if (u === "window") {
      chain.push(`${cur}split[u${n}a][u${n}b]`, `[u${n}b]scale=${WINDOW.w}:${WINDOW.h},pad=1920:1080:${WINDOW.x}:${WINDOW.y}:black[u${n}w]`, `[u${n}a][u${n}w]overlay=enable='${win(cue)}'[u${n}]`);
      cur = `[u${n}]`;
    } else if (u === "blur") {
      chain.push(`${cur}split[u${n}a][u${n}b]`, `[u${n}b]gblur=sigma=26[u${n}bl]`, `[u${n}a][u${n}bl]overlay=enable='${win(cue)}'[u${n}]`);
      cur = `[u${n}]`;
    }
  });
  rendered.forEach(({ cue, file }, i) => {
    inputs.push("-i", file);
    const fmt = templateById(cue.template).kind === "overlay" ? "format=yuva420p," : "";
    chain.push(`[${i + 1}:v]${fmt}setpts=PTS-STARTPTS+${cue.startFrame}/${FPS}/TB[g${i}]`);
    chain.push(`${cur}[g${i}]overlay=enable='${win(cue)}':eof_action=pass:format=auto[v${i}]`);
    cur = `[v${i}]`;
  });
  if (!rendered.length) throw new Error("no graphic could be placed on this film");
  await ffmpeg([
    ...inputs,
    "-filter_complex", chain.join(";"),
    "-map", cur, "-map", "0:a?",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "copy", "-movflags", "+faststart", "-y", input.outPath,
  ]);

  progress("Checking the finished film", 95);
  const placedCues = rendered.map(r => r.cue);
  // QA judges what is IN the film. A graphic left out as unreadable was handled (never shipped),
  // so it is listed with the left-out ones, not counted as a fault of the film.
  const shippedIds = new Set(placedCues.map(c => c.id));
  const qa = judgeFilm({
    fps: FPS,
    cues: placedCues,
    filmDiffs,
    reelDiffs: await frameDiffs(input.outPath),
    rules: checkRules(placedCues, input.film),
    readability: readability.filter(r => shippedIds.has(r.id)),
  });
  if (dropped.length) qa.lines.push(`Left out: ${dropped.length} (${dropped.map(d => d.id).join(", ")})`);
  sweepCache();
  return {
    at: new Date().toISOString(),
    plan: specs,
    placed: placedCues.map(c => ({ id: c.id, template: c.template, start: c.start, end: c.end })),
    dropped,
    theme: theme ? { accent: theme.accent, bg: theme.bg } : undefined,
    qa,
    readability,
    planner: planned.rounds ? { model: GRAPHICS_PLAN_MODEL, rounds: planned.rounds } : undefined,
  };
}

/** Keeps the cache under its size, oldest files first. Never fails. */
function sweepCache(): void {
  try {
    const files = ["gfx", "words", "icons"].flatMap(d => {
      const dir = path.join(CACHE, d);
      return existsSync(dir) ? readdirSync(dir).map(f => path.join(dir, f)) : [];
    });
    const stats = files.map(f => ({ f, s: statSync(f) })).sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
    let total = stats.reduce((n, x) => n + x.s.size, 0);
    for (const x of stats) {
      if (total <= CACHE_MAX_BYTES) break;
      rmSync(x.f, { force: true });
      total -= x.s.size;
    }
  } catch {
    /* a full or missing cache never stops a film */
  }
}

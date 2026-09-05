/**
 * server/delivery.ts — how the script should be DELIVERED, decided from the script itself.
 *
 * The narration was voiced at one speed for the whole film (the channel's dial, or the voice's
 * native pace — measured at 260-280 words a minute on one host, against 150-170 for
 * conversational English), and the host's face was given one fixed direction for every scene.
 * Neither knew what the words were about. This pass has Claude read the script paragraph by
 * paragraph and return, for each one, a PACE, a PAUSE to leave after it, and a MOOD:
 *
 *   pace   → the voice. Each paragraph's speed multiplier layers on the channel's base speed
 *            (`deliverySpeedFor`), and consecutive paragraphs at the same pace are voiced as
 *            one run (`deliveryRuns`) so a read is only broken where the pace actually changes.
 *   pause  → the voice. A beat of room-tone between runs, spliced in by the caller.
 *   mood   → the face. Three to five words appended to the lip-sync prompt of every host scene
 *            drawn from that paragraph (`applyDeliveryToScenes` → `scene.deliveryCue`), kept
 *            that short because InfiniteTalk degrades on long prompts.
 *
 * One Claude call per script. Fail-open everywhere: no plan means the film is voiced and
 * directed exactly as before this file existed.
 */
import path from "path";
import os from "os";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { invokeClaude } from "./claude";
import { runFfmpeg, downloadToTemp } from "./videoAssembly";
import type { StoryboardScene } from "../shared/types";

export type DeliveryPace = "slow" | "measured" | "natural" | "brisk";
export const DELIVERY_PACES: DeliveryPace[] = [
  "slow",
  "measured",
  "natural",
  "brisk",
];
/**
 * Speed multiplier per pace, applied ON TOP of the channel's base speed. Kept within ±15%:
 * the base dial is where a fast voice is brought to a human pace; this only shades it.
 */
export const PACE_SPEED: Record<DeliveryPace, number> = {
  slow: 0.85,
  measured: 0.92,
  natural: 1,
  brisk: 1.08,
};
/** Pauses Claude may ask for, ms. Anything else is snapped to the nearest. */
export const PAUSE_STEPS_MS = [0, 300, 600];
/** Final speed sent to TTS is clamped here — the provider accepts far more, the ear does not. */
export const SPEED_MIN = 0.6;
export const SPEED_MAX = 1.3;
const MOOD_MAX_WORDS = 5;

export interface DeliveryParagraph {
  /** 1-based paragraph number in `scriptParagraphs` order. */
  index: number;
  pace: DeliveryPace;
  pauseAfterMs: number;
  /** Facial expression while speaking, ≤5 words; "" = no cue. */
  mood: string;
}
export interface DeliveryPlan {
  paragraphs: DeliveryParagraph[];
}
export interface DeliveryRun {
  text: string;
  pace: DeliveryPace;
  /** Room-tone beat to leave AFTER this run, ms. */
  pauseAfterMs: number;
  paragraphIndices: number[];
}

/** The script's paragraphs, whitespace-normalized — the same split the narration chunker uses. */
export function scriptParagraphs(script: string): string[] {
  return script
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export const DELIVERY_SYSTEM_PROMPT =
  "You are a voice director for a long-form YouTube talking-head video. The host reads the " +
  "script verbatim to camera. Decide how each paragraph should be DELIVERED — never rewrite " +
  "a word. Reply with JSON only.";

export function deliveryUserPrompt(
  paragraphs: string[],
  ctx: { hostName?: string; persona?: string }
): string {
  const who = ctx.hostName ? `The host is ${ctx.hostName}.` : "";
  const persona = ctx.persona ? ` Persona: ${ctx.persona.slice(0, 600)}` : "";
  return (
    `${who}${persona}\n\n` +
    `For EVERY paragraph below return one object: {"index": n, "pace": "slow" | "measured" | ` +
    `"natural" | "brisk", "pauseAfterMs": 0 | 300 | 600, "mood": "<3-5 words>"}.\n` +
    `- pace: how fast this paragraph should be spoken relative to the host's normal read. ` +
    `"slow" for instructions, warnings, numbers or anything the viewer must catch; "measured" ` +
    `for explanation; "natural" for ordinary narration; "brisk" only for asides and lists the ` +
    `viewer already expects. Most paragraphs are "natural" or "measured".\n` +
    `- pauseAfterMs: a beat AFTER the paragraph — 600 before a new section or a big reveal, ` +
    `300 after a point that should land, otherwise 0.\n` +
    `- mood: the host's facial expression WHILE speaking this paragraph, as a director would ` +
    `say it to the actor — e.g. "warm gentle smile", "serious and concerned", "amused, playful", ` +
    `"calm and reassuring", "matter-of-fact". Modest, on-camera expressions only; never ` +
    `"laughing", "shouting", "crying" or anything that would move the head or hands.\n\n` +
    `Return {"paragraphs":[...]} with exactly ${paragraphs.length} entries, index 1..${paragraphs.length}.\n\n` +
    paragraphs.map((p, i) => `[${i + 1}] ${p}`).join("\n\n")
  );
}

/** Lenient parse of Claude's reply: the first {...} block, defaults for anything missing. */
export function parseDeliveryPlan(
  text: string,
  paragraphCount: number
): DeliveryPlan | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let raw: any;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const list: any[] = Array.isArray(raw?.paragraphs) ? raw.paragraphs : [];
  if (!list.length) return null;
  const byIndex = new Map<number, any>();
  for (const e of list) {
    const i = Number(e?.index);
    if (Number.isInteger(i) && i >= 1 && i <= paragraphCount) byIndex.set(i, e);
  }
  const snapPause = (v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return PAUSE_STEPS_MS.reduce((best, s) =>
      Math.abs(s - n) < Math.abs(best - n) ? s : best
    );
  };
  const paragraphs: DeliveryParagraph[] = [];
  for (let i = 1; i <= paragraphCount; i++) {
    const e = byIndex.get(i);
    const pace = DELIVERY_PACES.includes(e?.pace)
      ? (e.pace as DeliveryPace)
      : "natural";
    const mood =
      typeof e?.mood === "string"
        ? e.mood
            .replace(/[^A-Za-z0-9 ,'-]/g, "")
            .trim()
            .split(/\s+/)
            .slice(0, MOOD_MAX_WORDS)
            .join(" ")
        : "";
    paragraphs.push({
      index: i,
      pace,
      pauseAfterMs: snapPause(e?.pauseAfterMs),
      mood,
    });
  }
  return { paragraphs };
}

/**
 * Ask Claude for the plan. Null on any failure — the caller voices and directs as before.
 */
export async function planDelivery(
  script: string,
  ctx: { hostName?: string; persona?: string; log?: (m: string) => void } = {}
): Promise<DeliveryPlan | null> {
  const paragraphs = scriptParagraphs(script);
  if (!paragraphs.length) return null;
  try {
    const r = await invokeClaude({
      systemPrompt: DELIVERY_SYSTEM_PROMPT,
      userMessage: deliveryUserPrompt(paragraphs, ctx),
      maxTokens: Math.min(8000, 200 + paragraphs.length * 60),
    });
    const plan = parseDeliveryPlan(r.text, paragraphs.length);
    if (!plan) {
      ctx.log?.(
        `delivery plan: unparseable reply — voicing at the channel's one speed`
      );
      return null;
    }
    const paces = plan.paragraphs.map(p => p.pace);
    const counts = DELIVERY_PACES.map(
      p => `${p} ${paces.filter(x => x === p).length}`
    ).join(", ");
    ctx.log?.(
      `delivery plan: ${paragraphs.length} paragraph(s) — ${counts}; ` +
        `${plan.paragraphs.filter(p => p.pauseAfterMs).length} pause(s); ` +
        `${plan.paragraphs.filter(p => p.mood).length} mood cue(s)`
    );
    return plan;
  } catch (err: any) {
    ctx.log?.(
      `delivery plan failed (${err?.message ?? err}) — voicing at the channel's one speed`
    );
    return null;
  }
}

/** The speed sent to TTS for a pace: the channel's base dial shaded by the pace, clamped. */
export function deliverySpeedFor(
  base: number | undefined,
  pace: DeliveryPace | undefined
): number | undefined {
  if (!pace || pace === "natural") return base;
  const v = (base ?? 1) * PACE_SPEED[pace];
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, v)) * 100) / 100;
}

/** True when the plan asks for anything a single-speed read would not give. */
export function planChangesTheRead(
  plan: DeliveryPlan | null | undefined
): boolean {
  if (!plan) return false;
  const paces = new Set(plan.paragraphs.map(p => p.pace));
  return paces.size > 1 || plan.paragraphs.some(p => p.pauseAfterMs > 0);
}

/**
 * Consecutive paragraphs at the same pace become ONE run, voiced in one TTS call, so the read
 * breaks only where the pace changes or a pause is asked for. A paragraph carrying a pause
 * ends its run (the pause is spliced after it).
 */
export function deliveryRuns(
  script: string,
  plan: DeliveryPlan
): DeliveryRun[] {
  const paragraphs = scriptParagraphs(script);
  const runs: DeliveryRun[] = [];
  let cur: DeliveryRun | null = null;
  paragraphs.forEach((text, i) => {
    const p = plan.paragraphs[i] ?? {
      index: i + 1,
      pace: "natural" as DeliveryPace,
      pauseAfterMs: 0,
      mood: "",
    };
    if (cur && cur.pace === p.pace && cur.pauseAfterMs === 0) {
      cur.text += "\n\n" + text;
      cur.paragraphIndices.push(i + 1);
      cur.pauseAfterMs = p.pauseAfterMs;
    } else {
      cur = {
        text,
        pace: p.pace,
        pauseAfterMs: p.pauseAfterMs,
        paragraphIndices: [i + 1],
      };
      runs.push(cur);
    }
  });
  // No beat after the last run: the film ends where the narration does.
  if (runs.length) runs[runs.length - 1].pauseAfterMs = 0;
  return runs;
}

/**
 * Join voiced runs with a beat of ROOM TONE (not digital silence) after each one where asked.
 * Digital silence is what the pause cap (`capDeadAirPauses`, -60 dB) strips and what a
 * listener hears as the audio dropping out; a -56 dBFS noise floor is a breath. The runs'
 * own TTS-baked edge silence is kept, as everywhere else in the pipeline.
 */
// Measured with astats: pink noise at this amplitude sits at ≈ -56 dBFS RMS — inside the
// -52..-58 dBFS a normally trained clone's own pauses occupy, and above the -60 dB floor the
// pause cap treats as dead air (0.0018 measured -72 dBFS and would have been stripped).
export const ROOM_TONE_AMPLITUDE = 0.008;
export async function concatWithPauses(
  urls: string[],
  pausesAfterMs: number[]
): Promise<Buffer> {
  if (!urls.length) throw new Error("concatWithPauses: no runs");
  const dir = path.join(os.tmpdir(), `delivery-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const ins: string[] = [];
    const legs: string[] = [];
    const order: string[] = [];
    let n = 0;
    for (let i = 0; i < urls.length; i++) {
      const p = await downloadToTemp(urls[i], dir, `run-${i}.mp3`);
      ins.push("-i", p);
      legs.push(
        `[${n}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[r${i}]`
      );
      order.push(`[r${i}]`);
      n++;
      const pause = pausesAfterMs[i] ?? 0;
      if (pause > 0 && i < urls.length - 1) {
        legs.push(
          `anoisesrc=r=48000:a=${ROOM_TONE_AMPLITUDE}:c=pink:s=${i + 1},` +
            `atrim=end=${(pause / 1000).toFixed(3)},` +
            `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[p${i}]`
        );
        order.push(`[p${i}]`);
      }
    }
    const out = path.join(dir, "master.mp3");
    await runFfmpeg([
      "-y",
      ...ins,
      "-filter_complex",
      `${legs.join(";")};${order.join("")}concat=n=${order.length}:v=0:a=1[a]`,
      "-map",
      "[a]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      out,
    ]);
    return readFileSync(out);
  } finally {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}

/**
 * Which paragraph a scene's verbatim text comes from: scenes tile the script in order, so the
 * text is searched from a moving cursor and the paragraph holding its midpoint wins.
 */
export function applyDeliveryToScenes(
  scenes: StoryboardScene[],
  plan: DeliveryPlan,
  script: string
): number {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const paragraphs = scriptParagraphs(script);
  const flat = paragraphs.join(" ");
  // Paragraph spans in the flattened script.
  const spans: { start: number; end: number }[] = [];
  let pos = 0;
  for (const p of paragraphs) {
    spans.push({ start: pos, end: pos + p.length });
    pos += p.length + 1;
  }
  let cursor = 0;
  let applied = 0;
  for (const scene of scenes) {
    const text = norm(scene.scriptText ?? "");
    if (!text) continue;
    let at = flat.indexOf(text, cursor);
    if (at < 0) at = flat.indexOf(text);
    if (at < 0) continue;
    cursor = at + text.length;
    const mid = at + text.length / 2;
    const pi = spans.findIndex(s => mid >= s.start && mid <= s.end);
    const p = plan.paragraphs[pi >= 0 ? pi : spans.length - 1];
    if (!p) continue;
    scene.deliveryPace = p.pace;
    scene.deliveryCue = p.mood || undefined;
    applied++;
  }
  return applied;
}

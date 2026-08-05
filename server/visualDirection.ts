/**
 * server/visualDirection.ts
 *
 * Whole-video visual direction for long-form B-ROLL, derived once per job.
 *
 * Reads the channel's personality profile (the same one that drives script generation) plus the
 * full narration script, and asks Claude for two things: a STYLE BIBLE describing the one
 * physical world the video lives in, and BEATS — the script's arc split into consecutive scene
 * ranges. `enhanceBrollPrompts` then carries both into every cutaway's rewrite, so ~200 shots
 * read as one video from THIS channel instead of 200 unrelated ones.
 *
 * CONTENT ONLY. The bible describes WHAT IS SHOWN (place, season, props, tone) and never HOW IT
 * IS FILMED. The look is owned by `amateurIphoneLook()` / `SHOT_ANGLE_SUFFIX` / `cameraCue`, and a
 * bible that says "golden hour" or "shallow depth" lands in the SAME prompt as those — the render
 * gets a glossy brief and an amateur-phone brief at once and splits the difference, which is the
 * stock-footage look the pipeline exists to avoid. Nothing in code enforces this: it is
 * VISUAL_DIRECTION_SYSTEM's ban list and the smoke-bait test in visualDirection.test.ts. Keep
 * both — and note nothing inspects renders any more, so a drifting bible now shows up only in
 * review.
 *
 * TWO PASSES. `deriveStyleBible` runs BEFORE storyboarding (persona + raw script → the one world)
 * so the same world seeds every scene instead of only re-converging them at the enhancer;
 * `deriveVisualDirection` runs after the balancers for the per-scene beats, and re-emits the
 * pinned bible so the two agree. Both are ADVISORY: neither throws and both return null on any
 * surprise; with no direction every prompt is byte-identical to the pre-feature pipeline. That is
 * also the kill switch — always on, no feature flag.
 *
 * ponytail: one blocking call at the top of the enhance stage, ranges instead of per-scene
 * entries. Scenes are ~4s, so a real script is ~200-500 of them; per-scene beats would be ~30k
 * output worst case and `safeParseJSON` hard-fails the WHOLE payload on max_tokens, so one token
 * of overflow would cost the bible too. Ranges land at ~2k. Upgrade path if a range proves too
 * coarse: narrow the range cap below, not the schema — resolveBeats already denormalizes onto
 * each scene, so nothing downstream knows the difference.
 */
import type { LongformInputParams, StoryboardScene } from "../shared/types";
import { invokeGemini } from "./gemini";
import { getChannelLayer } from "./composer";
import { safeParseJSON } from "./jsonRepair";

/**
 * Ceiling on the derived direction. Enforced by truncation in `parseVisualDirection`, not just
 * asked for in the prompt — the bible and beat are INPUT context for the enhancer's rewrite, and
 * a model that runs long would drown the instruction. The prompts below ask under these caps so
 * truncation stays a backstop, not the norm.
 */
export const STYLE_BIBLE_MAX_WORDS = 90;
export const BEAT_MAX_WORDS = 25;

/** A slice of the script's arc. `from`/`to` are inclusive 1-based `scene.index` values. */
export interface BeatRange {
  from: number;
  to: number;
  beat: string;
}

/** Claude's raw contract: one bible + the arc as ranges. */
export interface VisualDirection {
  styleBible: string;
  beats: BeatRange[];
}

/** Ranges resolved down to per-scene beats, keyed by `scene.index`. What the caller applies. */
export interface ResolvedDirection {
  styleBible: string;
  beats: Record<number, string>;
}

/**
 * The rules every direction pass shares, factored so the style-bible call and the combined beats
 * call can never drift apart. Module constants keep the system prompt a stable prefix so Gemini
 * 2.5 Flash's implicit prefix caching can kick in. The ban list is load-bearing — see the header.
 */
const DIRECTION_INTRO =
  "You are the visual director for a YouTube channel whose viewers are mostly 50–70 years " +
  "old. You read the channel's personality profile and the full narration script for one " +
  "video, and produce direction that makes every b-roll cutaway in it feel like one coherent " +
  "piece of work from THIS channel — not 200 unrelated stock shots.\n\n";

const STYLE_BIBLE_SECTION =
  "STYLE BIBLE — one short paragraph, UNDER 80 WORDS, naming the ONE physical world this " +
  "whole video lives in:\n" +
  '- The concrete place, specifically ("a cramped Zone 6b suburban backyard", "a chest ' +
  'freezer in an unfinished basement") — a real location a viewer could stand in, not a mood ' +
  "or a quality of space.\n" +
  "- The season and time of year, when the script implies one.\n" +
  "- Two or three recurring physical props or materials that genuinely belong in that place " +
  "and that the script keeps returning to.\n" +
  "- The tone of the work being shown (unhurried, methodical, salvaging, making-do).\n\n";

const BEATS_SECTION =
  "BEATS — split the script into 8–25 CONSECUTIVE, NON-OVERLAPPING ranges of scene " +
  "numbers, covering the video start to finish. Each range is one movement of the argument " +
  "(the problem being set up, the method being worked through, the payoff being shown). For " +
  "each, write UNDER 25 WORDS naming what that stretch of the video should physically show, " +
  "and how it differs from the stretches around it. A single scene is 4 seconds — do NOT " +
  "write a range per scene; a range is roughly 45–60 seconds of video.\n\n";

const DIRECTION_BANS =
  "CONTENT ONLY — THE HARD RULE. You say WHAT IS SHOWN. You never say HOW IT IS FILMED. The " +
  "camera, lens, framing, lighting, colour, and grade are chosen elsewhere and your text is " +
  "appended to theirs — anything you write about them fights it and corrupts the shot. So " +
  "NEVER write:\n" +
  "- any camera, lens, shot type, angle, framing, focal length, or depth-of-field wording " +
  "(no close-up, wide, macro, overhead, pov, tracking, push-in, shallow depth, bokeh, 35mm)\n" +
  "- any lighting, colour, palette, grade, or film-stock wording (no golden hour, backlit, " +
  "warm amber, moody, filmic, desaturated, high contrast)\n" +
  '- any quality or production wording (no "cinematic", "8k", "ultra-realistic", ' +
  '"professional", "stunning", "beautiful", "breathtaking") or saturation-pushing words ' +
  '("vivid", "vibrant", "saturated", "richly colored")\n\n' +
  "ALSO NEVER:\n" +
  "- Name or describe a book, book cover, booklet, magazine, manual, handbook, handout, " +
  "printed guide, printed page, product packaging, website, or URL — even when the script " +
  "is largely about one, and even when the channel profile is largely about selling one. " +
  "Direct the real-world thing the writing is ABOUT, never the printed object.\n" +
  "- Write any person's proper name, or the channel's or host's name, or describe a specific " +
  "or recurring host. Cutaways show hands at a manual task at most — never a standing, " +
  "walking, or full-figure person. Beats name physical results, tools, materials, and settings; " +
  "hands only when the beat is a manual action.\n" +
  '- Use violent or harm wording — image and video providers reject it. Never "kill", ' +
  '"poison", "pesticide", "exterminate", "destroy", "dead", "dying", "rotting", ' +
  '"infestation", or "chemicals". Use neutral alternatives ("repel", "remove", "treatment", ' +
  '"wilted", "insects").\n\n';

const DIRECTION_TIE_BREAKER =
  "Your direction is a TIE-BREAKER, never an addition. Each shot is written from its own " +
  "narration line, and that line wins. Your job is only to settle what the narration leaves " +
  "open — which backyard, which season, which of the props already in this world. Never name " +
  "something so specific that a shot would have to introduce an object its own narration " +
  "does not state.\n\n";

/**
 * The combined bible+beats brief, over the numbered scene list — the BEATS pass. When the caller
 * passes a known bible it is pinned in the user message and this prompt just re-emits it, so the
 * beats key off the SAME world the storyboard was seeded with.
 */
export const VISUAL_DIRECTION_SYSTEM =
  DIRECTION_INTRO +
  "Produce TWO things.\n\n" +
  "1. " +
  STYLE_BIBLE_SECTION +
  "2. " +
  BEATS_SECTION +
  DIRECTION_BANS +
  DIRECTION_TIE_BREAKER +
  "Return ONLY this JSON, no prose, no markdown fence:\n" +
  '{"styleBible":"...","beats":[{"from":1,"to":18,"beat":"..."}]}';

/**
 * The style-bible-only brief, over the RAW script — the WORLD pass. Runs before storyboarding (the
 * world is a whole-video property that needs no scene numbers), so the same world seeds every
 * scene. Smaller output budget: it returns one field.
 */
export const STYLE_BIBLE_SYSTEM =
  DIRECTION_INTRO +
  "Produce a STYLE BIBLE — nothing else.\n\n" +
  STYLE_BIBLE_SECTION +
  DIRECTION_BANS +
  DIRECTION_TIE_BREAKER +
  "Return ONLY this JSON, no prose, no markdown fence:\n" +
  '{"styleBible":"..."}';

/**
 * The scene list IS the script: `scriptText` is a verbatim slice and concatenating the scenes in
 * order reproduces the whole narration. So we send it once, numbered — which also gives Claude
 * the scene numbers its ranges have to key off. Sending `spokenScript` separately would just
 * pay for the same words twice.
 *
 * Host scenes are included: they are part of the arc, and a range spans whatever it spans. Only
 * cutaways ever read a beat back.
 *
 * Pure — exported for unit testing.
 */
export function buildVisualDirectionUserMessage(
  persona: string | null,
  scenes: StoryboardScene[],
  subject?: string,
  knownBible?: string
): string {
  const personaBlock = persona?.trim()
    ? `Channel personality profile:\n${persona.trim()}\n\n`
    : "";
  const subjectBlock = subject?.trim()
    ? `Video subject: ${subject.trim()}\n\n`
    : "";
  // Pin the world already used to seed the storyboard so the beats agree with it — the model
  // re-emits it verbatim as `styleBible` and spends its budget on the beats.
  const bibleBlock = knownBible?.trim()
    ? `The STYLE BIBLE is already fixed. Return it VERBATIM as "styleBible" (change nothing) ` +
      `and produce only the BEATS:\n${knownBible.trim()}\n\n`
    : "";
  const list = scenes
    .map(s => `${s.index}: ${(s.scriptText ?? s.narration ?? "").trim()}`)
    .join("\n");
  return (
    personaBlock +
    subjectBlock +
    bibleBlock +
    `The full narration script, as ${scenes.length} numbered scenes in order ` +
    `(scene ${scenes[0]?.index ?? 1} to ${scenes[scenes.length - 1]?.index ?? 1}):\n` +
    `${list}\n\n` +
    `JSON:`
  );
}

/**
 * The style-bible pass's user message: persona + subject + the RAW script (no scene numbers — the
 * world is a whole-video property). Sent once, before storyboarding. Pure — exported for testing.
 */
export function buildStyleBibleUserMessage(
  persona: string | null,
  spokenScript: string,
  subject?: string
): string {
  const personaBlock = persona?.trim()
    ? `Channel personality profile:\n${persona.trim()}\n\n`
    : "";
  const subjectBlock = subject?.trim()
    ? `Video subject: ${subject.trim()}\n\n`
    : "";
  return (
    personaBlock +
    subjectBlock +
    `The full narration script:\n${spokenScript.trim()}\n\nJSON:`
  );
}

/** Cut to `max` words. The prompt asks for a cap; this is what actually enforces it. */
export function truncateWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : words.slice(0, max).join(" ");
}

/**
 * Parse Claude's direction, rejecting anything off-shape. Hand-rolled guard rather than zod —
 * matches the house convention (`safeParseJSON` + shape check).
 *
 * The bible is the load-bearing half, so a missing or blank one fails the whole payload. Beats
 * are filtered PER ITEM — one malformed range must not cost the bible and the other 20 ranges.
 *
 * Pure — unit-tested.
 */
export function parseVisualDirection(
  raw: string,
  stopReason?: string
): VisualDirection | null {
  const parsed = safeParseJSON<any>(raw, stopReason);
  if (!parsed.success || !parsed.data) return null;
  const d = parsed.data;
  if (typeof d.styleBible !== "string" || !d.styleBible.trim()) return null;
  const beats: BeatRange[] = (Array.isArray(d.beats) ? d.beats : [])
    .filter(
      (b: any) =>
        b &&
        typeof b === "object" &&
        Number.isInteger(b.from) &&
        Number.isInteger(b.to) &&
        b.from >= 1 &&
        b.to >= b.from &&
        typeof b.beat === "string" &&
        b.beat.trim() !== ""
    )
    .map((b: any) => ({
      from: b.from,
      to: b.to,
      beat: truncateWords(b.beat, BEAT_MAX_WORDS),
    }));
  return {
    styleBible: truncateWords(d.styleBible, STYLE_BIBLE_MAX_WORDS),
    beats,
  };
}

/**
 * Denormalize ranges onto individual scenes, so every consumer just reads one scene's beat and
 * never knows ranges existed. A scene no range covers simply gets none — it still gets the
 * bible, which does most of the work.
 *
 * First matching range wins, so overlapping ranges resolve deterministically instead of throwing.
 *
 * Pure — unit-tested.
 */
export function resolveBeats(
  beats: BeatRange[],
  scenes: StoryboardScene[]
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const scene of scenes) {
    const hit = beats.find(b => scene.index >= b.from && scene.index <= b.to);
    if (hit) out[scene.index] = hit.beat;
  }
  return out;
}

/**
 * Derive JUST the style bible, from persona + the raw script, BEFORE any scenes exist — so the one
 * world can seed every storyboard scene. NEVER THROWS: two attempts, then null (the caller then
 * storyboards with only the subject, exactly as the pre-feature pipeline did). The book sweep
 * (`brollDepictsBook`) lives at the call site — it can't import here without a cycle.
 *
 * No channel layer (no authored persona anywhere) is not a failure: the script alone yields a
 * usable world, so the persona block is simply omitted.
 */
export async function deriveStyleBible(
  params: LongformInputParams,
  spokenScript: string
): Promise<string | null> {
  if (!spokenScript.trim()) return null;
  const layer = await getChannelLayer(params.channelKey).catch(() => null);
  const userMessage = buildStyleBibleUserMessage(
    layer?.layerContent ?? null,
    spokenScript,
    params.videoSubject
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await invokeGemini({
        systemPrompt: STYLE_BIBLE_SYSTEM,
        userMessage,
        maxTokens: 500, // one ≤80-word field — well clear of the truncation cliff
      });
      const parsed = parseVisualDirection(result.text, result.stopReason);
      if (parsed?.styleBible) {
        console.log(
          `[VisualDirection] style bible (pre-storyboard): ${parsed.styleBible}`
        );
        return parsed.styleBible;
      }
      console.warn(
        `[VisualDirection] style bible unparseable (attempt ${attempt + 1}/2)`
      );
    } catch (err: any) {
      console.warn(
        `[VisualDirection] style bible derive failed (attempt ${attempt + 1}/2): ${err.message}`
      );
    }
  }
  return null;
}

/**
 * Derive the whole-video direction. NEVER THROWS — returns null on a missing script, an LLM
 * failure, or an unparseable payload, and the caller then leaves every prompt exactly as the
 * pre-feature pipeline built it.
 *
 * No channel layer (a channel with no authored persona anywhere) is not a failure: the script
 * alone still yields a usable bible, so the persona block is simply omitted.
 */
export async function deriveVisualDirection(
  params: LongformInputParams,
  scenes: StoryboardScene[],
  knownBible?: string
): Promise<ResolvedDirection | null> {
  if (!scenes.length) return null;
  // getChannelLayer resolves channel_layers → channel_configs.personaProfile → null. Reusing it
  // is what keeps the visuals agreeing with the script, which is composed from the same layer.
  const layer = await getChannelLayer(params.channelKey).catch(() => null);
  const userMessage = buildVisualDirectionUserMessage(
    layer?.layerContent ?? null,
    scenes,
    params.videoSubject,
    knownBible
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await invokeGemini({
        systemPrompt: VISUAL_DIRECTION_SYSTEM,
        userMessage,
        maxTokens: 5000, // 25 ranges × ≤25 words + a ≤90-word bible + JSON overhead, with margin
      });
      const direction = parseVisualDirection(result.text, result.stopReason);
      if (direction) {
        console.log(
          `[VisualDirection] style bible + ${direction.beats.length} beat range(s) ` +
            `over ${scenes.length} scenes: ${direction.styleBible}`
        );
        return {
          styleBible: direction.styleBible,
          beats: resolveBeats(direction.beats, scenes),
        };
      }
      console.warn(
        `[VisualDirection] unparseable direction (attempt ${attempt + 1}/2)`
      );
    } catch (err: any) {
      // Fail open — direction is an enhancement, and a job must never die for want of one.
      console.warn(
        `[VisualDirection] derive failed (attempt ${attempt + 1}/2): ${err.message}`
      );
    }
  }
  console.warn(
    "[VisualDirection] direction unavailable after 2 attempts — b-roll falls back to per-scene prompts"
  );
  return null;
}

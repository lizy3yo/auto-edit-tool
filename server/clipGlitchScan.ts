/**
 * Motion glitches in a moving b-roll clip. The video model animates the still it is handed, and
 * with nothing to anchor it, it moves what should not move: Hank's kumiko strips slid across the
 * bench on their own, and a stack of bills grew and shrank. None of that is a defect of the still,
 * so the still checker never sees it.
 *
 * Asked as SPOT THE DIFFERENCE on the first and last frame, large and stacked: "does anything move
 * wrong?" over a small sheet of frames passed the kumiko clip with both Haiku and Sonnet, while
 * "list what moved" named the strips at once. The verdict is then decided HERE from the list,
 * not left to the model's own yes/no: a change with no hand in the shot is a glitch unless the
 * shot is of something that moves by itself (fire, water, smoke).
 *
 * Fails open (no glitch) on any error: a check must never cost a render.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { downloadToTemp, probeBufferDurationSec, runFfmpeg } from "./videoAssembly";
import { invokeClaude } from "./claude";
import { safeParseJSON } from "./jsonRepair";

/** Sonnet by default: Haiku listed the moved strips but called them fine. ~150 clips a film. */
const CLIP_GLITCH_MODEL = () => process.env.CLIP_GLITCH_MODEL || "claude-sonnet-5";

export const CLIP_GLITCH_SYSTEM =
  "You compare two frames of ONE short AI-generated video clip: the FIRST frame on top, the LAST " +
  "frame below. The camera may have zoomed or panned, so ignore framing: compare where each " +
  "object sits and which way it points RELATIVE TO THE SURFACE AND THE OBJECTS AROUND IT.\n" +
  "changes: every object that moved, turned, appeared, disappeared, multiplied or changed shape " +
  "or size between the two frames (short phrases; [] when nothing did).\n" +
  "hands_visible: are hands in either frame?\n" +
  "untouched_moved: did anything in `changes` move without a hand touching it — other than " +
  "things that move by themselves in real life (fire, water, smoke, steam, a running machine)?\n" +
  "morph: did anything melt, bend, stretch, change size or shape, merge into something else, or " +
  "grow or lose fingers? Hands moving, a tool changing angle in a hand, or work progressing " +
  "(a cut deepening, paper peeling where the hand pulls it) is NOT a morph.\n" +
  'Return ONLY this JSON, no prose: {"changes":["..."],"hands_visible":true|false,' +
  '"untouched_moved":true|false,"morph":true|false}';

export type ClipGlitchVerdict = { glitch: boolean; what: string };

/**
 * Decide from the model's spot-the-difference answer. `selfMoving` is a shot of something that
 * moves by itself, where change is the point. Pure — unit-tested.
 */
export function parseClipGlitchVerdict(
  raw: string,
  selfMoving = false,
  stopReason?: string
): ClipGlitchVerdict {
  const parsed = safeParseJSON<any>(raw, stopReason);
  if (!parsed.success) return { glitch: false, what: "" };
  const d = parsed.data ?? {};
  const changes: string[] = Array.isArray(d.changes)
    ? d.changes.filter((c: unknown): c is string => typeof c === "string" && c.trim() !== "")
    : [];
  const morph = d.morph === true;
  const hands = d.hands_visible === true;
  // With hands in the shot, things moving is the point — "hands repositioned lower on the paper"
  // and "chisel angle shifted" were flagged as untouched motion on Hank's real render (job 175),
  // four re-renders of good clips in the first minutes. Only a morph counts there.
  const untouched = d.untouched_moved === true && !hands;
  // With no hands in the shot and nothing that moves by itself, ANY change is something moving
  // on its own — the model's own "untouched" call is not needed (and was wrong on the kumiko).
  const unexplained = !selfMoving && d.hands_visible === false && changes.length > 0;
  // A self-moving shot (fire spreading a burn, water pouring) changes shape by nature: only an
  // untouched move of something ELSE would count, and the model cannot tell us which — pass it.
  const glitch = selfMoving ? false : morph || untouched || unexplained;
  return {
    glitch,
    what: glitch ? (changes[0] ?? (morph ? "shape changes" : "something moves on its own")).slice(0, 80) : "",
  };
}

/** The first and last frame of `clipUrl`, 640 wide, stacked, as a png. */
async function firstAndLast(clipUrl: string): Promise<Buffer> {
  const dir = join(tmpdir(), `glitch-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const clip = await downloadToTemp(clipUrl, dir, "clip.mp4");
    const dur = await probeBufferDurationSec(readFileSync(clip), "mp4").catch(() => 0);
    const frames: string[] = [];
    const times = [0, Math.max(0, dur - 0.15)];
    for (let k = 0; k < times.length; k++) {
      const at = times[k];
      const f = join(dir, `f${k}.png`);
      await runFfmpeg([
        "-y",
        "-ss",
        at.toFixed(3),
        "-i",
        clip,
        "-map",
        "0:v:0",
        "-vf",
        "scale=640:-2",
        "-frames:v",
        "1",
        f,
      ]);
      frames.push(f);
    }
    const out = join(dir, "pair.png");
    await runFfmpeg([
      "-y",
      "-i",
      frames[0],
      "-i",
      frames[1],
      "-filter_complex",
      "[0:v][1:v]vstack=inputs=2",
      "-frames:v",
      "1",
      out,
    ]);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Does this moving clip move something the way nothing moves in real life? `about` is what the
 * clip should show (context only); `selfMoving` when that is a thing that moves by itself.
 */
export async function scanClipGlitch(
  clipUrl: string,
  about?: string,
  selfMoving = false
): Promise<ClipGlitchVerdict> {
  try {
    const pair = await firstAndLast(clipUrl);
    const result = await invokeClaude({
      systemPrompt: CLIP_GLITCH_SYSTEM,
      userMessage:
        "First frame on top, last frame below." +
        (about ? ` The clip should show: ${about.replace(/"/g, "'").slice(0, 200)}.` : "") +
        " What changed?",
      imageInput: { base64: pair.toString("base64"), mediaType: "image/png" },
      maxTokens: 500,
      model: CLIP_GLITCH_MODEL(),
    });
    const v = parseClipGlitchVerdict(result.text, selfMoving, result.stopReason);
    if (v.glitch) console.log(`[ClipGlitch] ${v.what}`);
    return v;
  } catch (err: any) {
    console.warn(`[ClipGlitch] check failed: ${err?.message} — passing the clip`);
    return { glitch: false, what: "" };
  }
}

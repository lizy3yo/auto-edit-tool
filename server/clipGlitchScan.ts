/**
 * Motion glitches in a moving b-roll clip. The video model animates the still it is handed, and
 * with nothing to anchor it, it moves what should not move: Hank's kumiko strips slid across the
 * bench on their own, and a stack of bills grew and shrank. None of that is a defect of the still,
 * so the still checker never sees it.
 *
 * Asked as SPOT THE DIFFERENCE on the first and last frame, large and stacked: "does anything move
 * wrong?" over a small sheet of frames passed the kumiko clip with both Haiku and Sonnet, while
 * "list what moved" named the strips at once. The verdict is then decided HERE from the list,
 * not left to the model's own yes/no: a change is a glitch unless the shot is of something that
 * moves by itself (fire, water, smoke, traffic). Since 2026-09-30 a video never has hands in
 * it (`videoKind`), so hands appearing in a clip are a glitch too — and in a shot of something that
 * moves by itself, anything ELSE moving (the incense holder sliding while its smoke rises) is.
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
  "You compare two frames of ONE short AI-generated video clip: the FIRST frame on the LEFT, the " +
  "LAST frame on the RIGHT. The camera may have zoomed or panned, so ignore framing: compare where each " +
  "object sits and which way it points RELATIVE TO THE SURFACE AND THE OBJECTS AROUND IT.\n" +
  "changes: every object that moved, turned, appeared, disappeared, multiplied or changed shape " +
  "or size between the two frames (short phrases; [] when nothing did).\n" +
  "hands_visible: are hands in either frame?\n" +
  "untouched_moved: did anything in `changes` move without a hand touching it — other than " +
  "things that move by themselves in real life (fire, water, smoke, steam, traffic)?\n" +
  "morph: did anything melt, bend, stretch, change size or shape, merge into something else, or " +
  "grow or lose fingers? Hands moving, a tool changing angle in a hand, or work progressing " +
  "(a cut deepening, paper peeling where the hand pulls it) is NOT a morph.\n" +
  "hands_visible counts any hand, finger or arm, even partly in frame.\n" +
  "cover: for each LARGE item (a quilt, cloth, sheet of fabric, board, rug, piece of work) say " +
  "where its edges are and what surface shows around it, LEFT frame then RIGHT frame — look at " +
  "the front edge of the table in both.\n" +
  "vanished: is an item GONE, clearly SMALLER or clearly BIGGER on the right than on the left, " +
  "or did something appear from nowhere — with no hand plainly lifting it away, bringing it in, " +
  "cutting or folding it? Only sliding or turning a little is NOT vanished.\n" +
  'Return ONLY this JSON, no prose: {"changes":["..."],"cover":["..."],"hands_visible":true|false,' +
  '"untouched_moved":true|false,"morph":true|false,"vanished":true|false}';

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
  // Something that disappears, appears or changes size with no hand doing it is a glitch EVEN
  // with hands in the shot: Granny Ruth's 3-min test (job 233, 1:00-1:03) — the quilt draped over
  // the table front shrank away to bare table while her hands sewed, and "hands repositioned" let
  // it through. Asked on the frames SIDE BY SIDE: stacked, Sonnet called the same pair "slight
  // shifts" at 640 and at 1024 px; side by side it named it, and passed five good hands clips.
  const vanished = d.vanished === true;
  // With hands in the shot, things moving is the point — "hands repositioned lower on the paper"
  // and "chisel angle shifted" were flagged as untouched motion on Hank's real render (job 175),
  // four re-renders of good clips in the first minutes. Only a morph counts there.
  const untouched = d.untouched_moved === true && !hands;
  // With no hands in the shot and nothing that moves by itself, ANY change is something moving
  // on its own — the model's own "untouched" call is not needed (and was wrong on the kumiko).
  const unexplained = !selfMoving && d.hands_visible === false && changes.length > 0;
  // A self-moving shot (fire spreading a burn, water pouring) changes shape by nature: only an
  // untouched move of something ELSE would count, and the model cannot tell us which — pass it.
  // No video may show hands any more (2026-09-30, the operator: "never do the videos with
  // fingers"): a hand that turns up in a clip is a glitch, whatever the clip is of.
  if (hands)
    return { glitch: true, what: "hands appear in the video" };
  // A shot of something that moves by itself changes by nature (a burn spreading, smoke drifting):
  // only something ELSE moving on its own counts — the model's `untouched_moved` already leaves the
  // smoke, fire and water out.
  if (selfMoving) {
    const glitch = d.untouched_moved === true && changes.length > 0;
    return { glitch, what: glitch ? (changes[0] ?? "something moves on its own").slice(0, 80) : "" };
  }
  const glitch = morph || untouched || unexplained || vanished;
  return {
    glitch,
    what: glitch
      ? (vanished && !morph
          ? "something disappears or changes size"
          : (changes[0] ?? (morph ? "shape changes" : "something moves on its own"))
        ).slice(0, 80)
      : "",
  };
}

/** The first and last frame of `clipUrl`, 768 wide each, SIDE BY SIDE, as a png. */
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
        "scale=768:-2",
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
      "[0:v][1:v]hstack=inputs=2",
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
        "First frame on the left, last frame on the right." +
        (about ? ` The clip should show: ${about.replace(/"/g, "'").slice(0, 200)}.` : "") +

        " What changed?",
      imageInput: { base64: pair.toString("base64"), mediaType: "image/png" },
      maxTokens: 500,
      model: CLIP_GLITCH_MODEL(),
      thinking: "off",
      step: "Clip glitch check",
    });
    const v = parseClipGlitchVerdict(result.text, selfMoving, result.stopReason);
    if (v.glitch) console.log(`[ClipGlitch] ${v.what}`);
    return v;
  } catch (err: any) {
    console.warn(`[ClipGlitch] check failed: ${err?.message} — passing the clip`);
    return { glitch: false, what: "" };
  }
}

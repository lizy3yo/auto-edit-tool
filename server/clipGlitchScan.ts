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
 * moves by itself. Since 2026-09-30 a video never has hands in it (`videoKind`), so hands
 * appearing in a clip are a glitch too — and in a shot of something that moves by itself, anything
 * ELSE moving (the incense holder sliding while its smoke rises) is.
 *
 * THE THING MEANT TO MOVE IS NAMED (2026-10-18, the audit's thrown-away videos). Every glitch on
 * record was judged on a self-moving shot, and the model was told what may move by a fixed list
 * ("fire, water, smoke, steam, traffic") that disagreed with `judgeSelfMoving`, which decides what
 * may be a video from the picture's own words (curtains in a breeze, a tumbling drum): six of the
 * seven reasons logged on Frederick's renders named the moving thing itself — "smoke slightly
 * denser/shifted on right", "flames height decreased" (job 262 scene 16, "a thin curl of smoke
 * rising" under a ceiling alarm, was paid for twice and shipped as a still) — and the production
 * snapshot threw 169 paid videos away for a still. Now the message names the shot
 * (`clipGlitchMessage`), each change says whether it IS that thing or comes from it (`meant`), and
 * only a change in something else counts.
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
  "The message may say what in the clip is MEANT to move by itself. That thing, and what comes from it — " +
  "what it gives off, carries or pushes along, and its light on what is near it — may change in any " +
  "way. Everything else should hold still.\n" +
  "changes: every object that moved, turned, appeared, disappeared, multiplied or changed shape " +
  'or size between the two frames, each as {"what":"a short phrase","meant":true|false} ([] when ' +
  "nothing did). meant is true ONLY when the change is the thing meant to move by itself, or comes " +
  "from it; false for anything else, and false for every change when the message does not say " +
  "anything is meant to move.\n" +
  "hands_visible: are hands in either frame?\n" +
  "untouched_moved: did anything in `changes` that is not meant move without a hand touching it?\n" +
  "morph: did anything that is not meant melt, bend, stretch, change size or shape, merge into " +
  "something else, or grow or lose fingers? Hands moving, a tool changing angle in a hand, or work " +
  "progressing (a cut deepening, paper peeling where the hand pulls it) is NOT a morph.\n" +
  "hands_visible counts any hand, finger or arm, even partly in frame.\n" +
  "cover: for each LARGE item (a quilt, cloth, sheet of fabric, board, rug, piece of work) say " +
  "where its edges are and what surface shows around it, LEFT frame then RIGHT frame — look at " +
  "the front edge of the table in both.\n" +
  "vanished: is an item that is not meant GONE, clearly SMALLER or clearly BIGGER on the right than " +
  "on the left, or did something appear from nowhere — with no hand plainly lifting it away, " +
  "bringing it in, cutting or folding it? Only sliding or turning a little is NOT vanished.\n" +
  'Return ONLY this JSON, no prose: {"changes":[{"what":"...","meant":true|false}],"cover":["..."],' +
  '"hands_visible":true|false,"untouched_moved":true|false,"morph":true|false,"vanished":true|false}';

/**
 * The question for one clip. `about` is what it should show; on a self-moving shot it is ALSO what
 * is meant to move — the model picks the moving thing out of the description the same way
 * `judgeSelfMoving` judged it ("a thin curl of smoke rising" under a ceiling alarm: the smoke moves,
 * the alarm holds still). Pure — unit-tested.
 */
export function clipGlitchMessage(about: string | undefined, selfMoving: boolean): string {
  // As much of the description as `judgeSelfMoving` read (300 characters). On a self-moving shot
  // it is now the only word on what may move: a moving thing named past a shorter cut would read
  // as something ELSE moving and fail a good clip — the fixed list used to cover that.
  const shows = about?.trim()
    ? about.replace(/"/g, "'").replace(/\s+/g, " ").trim().slice(0, 300)
    : "";
  const meant = !selfMoving
    ? ""
    : shows
      ? " Whatever moves by itself in that description is MEANT to move; everything else should hold still."
      : " ONE thing in it is meant to move by itself — decide from the frames which; everything else should hold still.";
  return (
    "First frame on the left, last frame on the right." +
    (shows ? ` The clip should show: ${shows}.` : "") +
    meant +
    " What changed?"
  );
}

/** One entry of the model's `changes`: what changed and whether it is the thing meant to move. */
type ClipChange = { what: string; meant?: boolean };

/**
 * The model's `changes`, read in either shape: `{what, meant}` objects, or the plain phrases of an
 * answer that ignored the shape (`meant` then unknown). Pure.
 */
function readChanges(raw: unknown): ClipChange[] {
  if (!Array.isArray(raw)) return [];
  const out: ClipChange[] = [];
  for (const c of raw) {
    if (typeof c === "string") {
      if (c.trim()) out.push({ what: c.trim() });
      continue;
    }
    if (!c || typeof c !== "object") continue;
    const what = typeof (c as any).what === "string" ? (c as any).what.trim() : "";
    const meant = typeof (c as any).meant === "boolean" ? ((c as any).meant as boolean) : undefined;
    if (what || meant !== undefined) out.push({ what, meant });
  }
  return out;
}

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
  const changes = readChanges(d.changes);
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
  // No video may show hands any more (2026-09-30, the operator: "never do the videos with
  // fingers"): a hand that turns up in a clip is a glitch, whatever the clip is of.
  if (hands)
    return { glitch: true, what: "hands appear in the video" };
  // A shot of something that moves by itself changes by nature (a burn spreading, smoke drifting):
  // only a change in something ELSE counts — the camera moving, an object sliding, appearing,
  // vanishing or changing shape beside it. Each change says which it is (`meant`), and a
  // morph/vanished answer is trusted only through those: a flat morph/vanished flag cannot say
  // WHAT, and on these shots it was the flame or smoke itself ("flames height decreased",
  // Frederick's renders). An answer in the old shape (plain phrases) falls back to the model's
  // own untouched call, which now asks only about what is not meant.
  if (selfMoving) {
    const other = changes.find(c => c.meant === false);
    const unsorted = changes.filter(c => c.meant === undefined);
    const glitch = !!other || (unsorted.length > 0 && d.untouched_moved === true);
    const what = other?.what || unsorted[0]?.what || "something moves on its own";
    return { glitch, what: glitch ? what.slice(0, 80) : "" };
  }
  const glitch = morph || untouched || unexplained || vanished;
  return {
    glitch,
    what: glitch
      ? (vanished && !morph
          ? "something disappears or changes size"
          : (changes[0]?.what || (morph ? "shape changes" : "something moves on its own"))
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
 * clip should show; `selfMoving` when that is a thing that moves by itself — `about` then also
 * names what may move (`clipGlitchMessage`).
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
      userMessage: clipGlitchMessage(about, selfMoving),
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

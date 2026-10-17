/**
 * A SPLIT SHIPS WITH BOTH HALVES, OR THE JOB SAYS SO (2026-10-18). A split screen is two clips —
 * the lip-synced host and a still beside it — and the panel used to be drawn only AFTER the host
 * render came back, raced against a fixed 300 s timer. A still is allowed four draws, each with
 * its picture checks, and one draw alone may take 480 s, so a panel with a redraw or two lost the
 * race: the timer threw it away (the draw ran on, paid for, and landed unused — job 400
 * scene 3 logged "still image OK on retry 3" after its timeout), and the scene shipped as the host
 * take alone with one console line and nothing on the job. 49 of 1,801 production splits; 24 of
 * them had ended on a PASSING panel check.
 *
 * So:
 *  - the panel needs only its own words, never the host clip, so it is drawn BESIDE the host
 *    render — started the moment the lip-sync provider accepts the render (`startSplitPanelDraw`)
 *    and kept per scene — and gets the render's minutes for free;
 *  - it is awaited up to the host scene's OWN wall clock (`withSceneDeadline`), less the room the
 *    composite needs, never a constant shorter than what the still lane needs;
 *  - a draw that FAILS is drawn once more; a draw still running when the time is up is not —
 *    a second draw beside a live one only doubles the cost and the image lane's queue;
 *  - when the panel still does not come, the scene keeps its host take (paid for and on the
 *    words) and the job says which scene lost its panel, with `scene.splitPanelMissing`.
 *
 * Provider-free: the draws are handed in, so the rules are tested without one.
 */
import type { StoryboardScene } from "../shared/types";

/** One finished panel draw: its clip, or why there is none. Never a rejection. */
export type SplitPanelOutcome = { url: string } | { error: Error };

/** The panel to put beside the host, or why the scene ships without one. */
export type SplitPanelResult =
  { url: string; reason?: undefined } | { url?: undefined; reason: string };

/**
 * Room kept back from the host scene's wall clock for the composite itself: an ffmpeg encode that
 * may first wait up to 3 min for free memory (`waitForFreeMemory`), the face read, and an upload.
 * A panel that lands later than this would be thrown away by the deadline anyway — with the host
 * take, which is worse.
 */
export const SPLIT_COMPOSITE_MARGIN_MS = 3 * 60_000;

const asError = (e: unknown): Error =>
  e instanceof Error ? e : new Error(String(e ?? "split panel failed"));

/**
 * Run one draw to an outcome that never rejects. A draw started beside the host render may have
 * nobody waiting on it (the host render failed, or was given up on), and an unhandled rejection
 * would take the whole process down with every other job in it.
 */
function settle(draw: () => Promise<string>): Promise<SplitPanelOutcome> {
  try {
    return draw().then(
      url => ({ url }),
      e => ({ error: asError(e) })
    );
  } catch (e) {
    return Promise.resolve({ error: asError(e) });
  }
}

/** Panel draws started beside a host render, per scene, with the words they were drawn from. */
const startedDraws = new WeakMap<
  StoryboardScene,
  { visual: string; outcome: Promise<SplitPanelOutcome> }
>();

/**
 * Start this split scene's panel now, beside its host render. Once per scene and panel wording: a
 * host render retried on the spot (or polled again) reuses the draw already running instead of
 * paying for another. Returns whether a draw was started.
 */
export function startSplitPanelDraw(
  scene: StoryboardScene,
  draw: () => Promise<string>
): boolean {
  const visual = scene.splitVisual;
  if (!scene.hostPresent || !visual) return false;
  const have = startedDraws.get(scene);
  if (have && have.visual === visual) return false;
  startedDraws.set(scene, { visual, outcome: settle(draw) });
  return true;
}

/**
 * The panel draw started for this scene, handed over once. A draw for other words (the panel's
 * description changed since it started) is dropped, never composited beside the wrong line.
 */
export function takeSplitPanelDraw(
  scene: StoryboardScene
): Promise<SplitPanelOutcome> | undefined {
  const have = startedDraws.get(scene);
  startedDraws.delete(scene);
  return have && have.visual === scene.splitVisual ? have.outcome : undefined;
}

/** How long a panel may still be waited for: the scene's time left, less the composite's room. */
export function splitPanelWaitMs(deadlineAt: number, now = Date.now()): number {
  return Math.max(0, deadlineAt - now - SPLIT_COMPOSITE_MARGIN_MS);
}

/** The outcome, or "late" when it has not come by `ms`. A finished draw always wins, even at 0. */
async function within(
  outcome: Promise<SplitPanelOutcome>,
  ms: number
): Promise<SplitPanelOutcome | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">(resolve => {
    timer = setTimeout(() => resolve("late"), ms);
  });
  try {
    return await Promise.race([outcome, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the job says when a split ships as its host take alone. One line per scene. */
export function splitPanelMissingWarning(
  index: number,
  reason: string
): string {
  return (
    `Scene ${index}: the split screen shows the host alone — the picture beside the host could ` +
    `not be made (${reason}). Regenerate the scene to draw it: the host take is kept and the ` +
    `host is not rendered again.`
  );
}

/**
 * The panel for a split scene whose host take is in hand. The MOVING panel first when the scene
 * has one (once; any failure falls to the still, which never moves wrong), then the still: the
 * draw started beside the host render when there is one, else one now. Everything is awaited up
 * to `deadlineAt` less the composite's room. A still that fails is drawn once more; one still
 * running when the time is up is not.
 */
export async function splitPanelFor(opts: {
  /** The moving panel's render, when the scene has one and a video lane is available. */
  moving?: () => Promise<string>;
  /** One still panel draw. */
  still: () => Promise<string>;
  /** The still draw started beside the host render (`takeSplitPanelDraw`), if any. */
  started?: Promise<SplitPanelOutcome>;
  /** When the host scene's own wall clock runs out (epoch ms). */
  deadlineAt: number;
  log?: (line: string) => void;
}): Promise<SplitPanelResult> {
  const log = opts.log ?? (() => {});
  const late: SplitPanelResult = {
    reason: "it was still being drawn when the scene's time ran out",
  };
  if (opts.moving) {
    const got = await within(
      settle(opts.moving),
      splitPanelWaitMs(opts.deadlineAt)
    );
    if (got === "late") return late;
    if ("url" in got) return { url: got.url };
    log(
      `moving split panel failed (${got.error.message}) — falling back to the still panel`
    );
  }
  let outcome = opts.started ?? settle(opts.still);
  for (let attempt = 1; ; attempt++) {
    const got = await within(outcome, splitPanelWaitMs(opts.deadlineAt));
    if (got === "late") return late;
    if ("url" in got) return { url: got.url };
    if (attempt >= 2) return { reason: got.error.message };
    log(`split panel failed (${got.error.message}) — drawing it once more`);
    outcome = settle(opts.still);
  }
}

/**
 * Record that this split ships as its host take alone: the flag on the scene for the card, and
 * one warning on the job naming the scene (`warn` is `appendJobWarning` for the job).
 */
export function markSplitPanelMissing(
  scene: StoryboardScene,
  reason: string,
  warn: (line: string) => void,
  at: Date = new Date()
): void {
  scene.splitPanelMissing = { reason, at: at.toISOString() };
  warn(splitPanelMissingWarning(scene.index, reason));
}

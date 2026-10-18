// Assembly's hook into the motion graphics (./finish.ts): honours the switches, runs the step on a
// temporary copy of the assembled film, and records what happened on the job's `graphics`. It
// NEVER fails a film — any error ships the film as assembled, with a job warning saying why.
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { JobGraphics, LongformInputParams, StoryboardScene } from "@shared/types";
import type { CueSpec } from "../../graphics/src/cueResolve";
import type { FilmLayout, HostPanel } from "../../graphics/src/plan/rules";
import type { Readability } from "../../graphics/src/plan/qa";
import { HEIGHT, WIDTH } from "../../graphics/src/theme";
import { splitPanelMissing } from "@shared/splitPanel";
import { getChannelConfig } from "../db";
import { resolveSplitLayout } from "../videoAssembly";
import { addGraphics, type GraphicsRecord } from "./finish";

/** App-wide off switch: GRAPHICS=0. */
export const graphicsEnabled = () => process.env.GRAPHICS !== "0";

/** At most this many problems (and offered sentences) per round, and readability fixes, are kept on
 * the job — it rides inputParams on every save; the render log still prints them all. */
export const MAX_KEPT_PER_ROUND = 60;
const MAX_PROBLEM_CHARS = 200;
const MAX_ID_CHARS = 80;
const MAX_OFFERED_CHARS = 80;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The planner's rounds as kept on the job. Before this, every refusal went only to the render log:
 * across the 12 films made with graphics (jobs 385-398) the rows held one left-out graphic and no
 * refusal, so three bare moments of Dale's job 397 ("Smalls, about $10 to $40." at 0:49, which the
 * rules accept a graphic on) could not be explained. The fill round's offered sentences ride along
 * (cut short), so "offered, never asked" shows apart from "asked and refused". Pure.
 */
export function plannerForJob(planner: GraphicsRecord["planner"], at: string): JobGraphics["planner"] {
  if (!planner) return undefined;
  return {
    model: planner.model,
    at,
    rounds: planner.rounds.map(r => {
      const problems = r.problems.slice(0, MAX_KEPT_PER_ROUND).map(p => ({ cue: clip(p.cue, MAX_ID_CHARS), problem: clip(p.problem, MAX_PROBLEM_CHARS) }));
      const offered = r.offered?.slice(0, MAX_KEPT_PER_ROUND).map(o => ({
        at: Math.round(o.from * 100) / 100,
        text: clip(o.text, MAX_OFFERED_CHARS),
        asked: o.asked.map(id => clip(id, MAX_ID_CHARS)),
        placed: o.placed,
      }));
      return {
        step: r.step,
        asked: r.asked,
        kept: r.kept,
        problems,
        ...(r.problems.length > problems.length ? { truncated: r.problems.length - problems.length } : {}),
        ...(offered ? { offered } : {}),
        ...(r.offered && offered && r.offered.length > offered.length ? { offeredTruncated: r.offered.length - offered.length } : {}),
        ...(r.error ? { error: clip(r.error, MAX_PROBLEM_CHARS) } : {}),
      };
    }),
  };
}

/**
 * The readability results worth keeping: only the graphics the check had to work on (their first
 * measure failed). One that passed as designed has nothing to explain, and one that never passed is
 * also in `dropped` — its steps say what was tried (job 390: "colour 4.0:1" after every fix). Pure.
 */
export function readabilityForJob(readability: Readability[]): JobGraphics["readability"] {
  const fixed = readability
    .filter(r => !r.pass || r.steps.length > 1)
    .slice(0, MAX_KEPT_PER_ROUND)
    .map(r => ({ id: clip(r.id, MAX_ID_CHARS), pass: r.pass, summary: clip(r.summary, MAX_PROBLEM_CHARS), steps: r.steps.map(s => clip(s, MAX_PROBLEM_CHARS)) }));
  return fixed.length ? fixed : undefined;
}

/**
 * Whether a scene plays as a split in the film. A split whose picture was never put beside the host
 * plays the bare host take full frame (`splitPanelMissing`): a caption squeezed into a panel that is
 * not there would sit off to one side of the host for nothing.
 */
const playsSplit = (s: StoryboardScene) => !!s.splitRightUrl && !splitPanelMissing(s);

/** Where a split's host panel is on the graphics' frame — resolved by the same function the
 * compositor drew it with, so a seam the operator dragged, or the host turned to the right, is
 * where the caption goes. */
export const splitHostPanel = (s: StoryboardScene): HostPanel =>
  (({ hostX, hostW }) => ({ x: hostX, w: hostW }))(resolveSplitLayout(WIDTH, HEIGHT, s.splitLayout));

/** The film's layout for the rules: each scene's span on the film, and what is on screen. */
export function filmLayoutOf(scenes: StoryboardScene[]): FilmLayout {
  return {
    scenes: scenes
      .filter(s => typeof s.narrationStartSec === "number" && typeof s.narrationEndSec === "number")
      .map(s => {
        const split = playsSplit(s);
        return {
          index: s.index,
          narrationStartSec: s.narrationStartSec as number,
          narrationEndSec: s.narrationEndSec as number,
          scriptText: s.scriptText,
          hostPresent: !!s.hostPresent,
          cta: !!s.cta,
          split,
          // The split's layout passed through: a caption over this scene is drawn inside the host's
          // panel (`hostPanelFor`), as the lab's composite always did — job 400 scene 27 had none.
          ...(split ? { hostPanel: splitHostPanel(s) } : {}),
          hostOpener: !!s.hostOpener,
        };
      }),
  };
}

export type GraphicsHooks = {
  phase: (label: string, pct: number) => void;
  warn: (message: string) => void;
  log: (message: string) => void;
};

/**
 * The assembled film WITH its graphics (or as it was, when they are off or fail). Updates
 * `params.graphics` in place; the caller saves `params` with the film.
 */
export async function withGraphics(jobId: number, film: Buffer, scenes: StoryboardScene[], params: LongformInputParams, hooks: GraphicsHooks): Promise<Buffer> {
  const prior: JobGraphics = params.graphics ?? {};
  const skip = (why: string): Buffer => {
    params.graphics = { ...prior, skipped: why, replan: false };
    return film;
  };
  if (!graphicsEnabled()) return skip("motion graphics are off (GRAPHICS=0)");
  try {
    const channel = params.channelKey ? await getChannelConfig(params.channelKey) : undefined;
    if (channel && channel.motionGraphics === false) return skip("motion graphics are off for this channel");
  } catch {
    /* a channel lookup failure is not a reason to drop the graphics */
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "longform-graphics-"));
  try {
    const filmPath = path.join(dir, "film.mp4");
    const outPath = path.join(dir, "film-graphics.mp4");
    writeFileSync(filmPath, film);
    const record = await addGraphics({
      jobId,
      filmPath,
      outPath,
      film: filmLayoutOf(scenes),
      hostPhotoUrl: params.faceImageUrl,
      savedPlan: (prior.plan as CueSpec[] | undefined) ?? undefined,
      replan: !!prior.replan,
      lists: params.spokenLists,
      onProgress: hooks.phase,
      log: hooks.log,
    });
    params.graphics = {
      at: record.at,
      plan: record.plan,
      placed: record.placed,
      dropped: record.dropped,
      theme: record.theme,
      qa: { pass: record.qa.pass, lines: record.qa.lines, failures: record.qa.failures },
      replan: false,
      // A Reassemble that reuses the saved plan makes no model call and has no rounds of its own:
      // the rounds that wrote that plan are carried over, or the first Reassemble would wipe them.
      planner: record.planner ? plannerForJob(record.planner, record.at) : prior.planner,
      // Measured again on every assembly, so this film's own.
      readability: readabilityForJob(record.readability),
    };
    hooks.log(`graphics QA: ${record.qa.pass ? "PASS" : "FAIL"} — ${record.qa.lines.join(" | ")}`);
    if (!record.qa.pass) hooks.warn(`Motion graphics: ${record.qa.failures.join("; ")}`);
    return readFileSync(outPath);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    hooks.warn(`Motion graphics were not added: ${why}`);
    return skip(why);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

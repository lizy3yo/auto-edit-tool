// Assembly's hook into the motion graphics (./finish.ts): honours the switches, runs the step on a
// temporary copy of the assembled film, and records what happened on the job's `graphics`. It
// NEVER fails a film — any error ships the film as assembled, with a job warning saying why.
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { JobGraphics, LongformInputParams, StoryboardScene } from "@shared/types";
import type { CueSpec } from "../../graphics/src/cueResolve";
import type { FilmLayout } from "../../graphics/src/plan/rules";
import { getChannelConfig } from "../db";
import { addGraphics } from "./finish";

/** App-wide off switch: GRAPHICS=0. */
export const graphicsEnabled = () => process.env.GRAPHICS !== "0";

/** The film's layout for the rules: each scene's span on the film, and what is on screen. */
export function filmLayoutOf(scenes: StoryboardScene[]): FilmLayout {
  return {
    scenes: scenes
      .filter(s => typeof s.narrationStartSec === "number" && typeof s.narrationEndSec === "number")
      .map(s => ({
        index: s.index,
        narrationStartSec: s.narrationStartSec as number,
        narrationEndSec: s.narrationEndSec as number,
        scriptText: s.scriptText,
        hostPresent: !!s.hostPresent,
        cta: !!s.cta,
        split: !!s.splitRightUrl,
        hostOpener: !!s.hostOpener,
      })),
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

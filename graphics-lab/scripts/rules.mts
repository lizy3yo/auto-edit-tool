// The placement rules every cue sheet is held to, on RESOLVED times — one copy, read by the
// planner (to reject and repair what it wrote) and by the composite (as its final check), so the
// two can never disagree about what is allowed.
import type { ResolvedCue } from "../src/cueResolve.ts";
import { templateById } from "../src/registry.ts";
import { FPS } from "../src/theme.ts";
import { nameTagRange, type Job } from "./job.mts";

export type RuleProblem = { cue: string; problem: string };

/** Steve's restraint, measured on his films: ~1 full-screen card per 1.6-2 min, ~1 label a
 * minute, and only a few captions on the host. Never fewer than two cards. */
export function densityLimits(filmSec: number) {
  const min = filmSec / 60;
  return { cards: Math.max(2, Math.round(min / 1.6)), overlays: Math.max(3, Math.round(min * 1.2)), hostCaptions: 3 };
}

/** Breathing room between two graphics, so one never reads as the tail of the other. */
export const MIN_GAP_SEC = 1.0;

export function checkRules(cues: ResolvedCue[], job: Job, opts: { gap?: number } = {}): RuleProblem[] {
  const out: RuleProblem[] = [];
  const gap = opts.gap ?? 0;
  const tol = 1 / FPS;
  const cta = job.scenes.filter(s => s.cta).map(s => [s.narrationStartSec, s.narrationEndSec] as const);
  const nameTag = nameTagRange(job);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const def = templateById(c.template);
    const add = (problem: string) => out.push({ cue: c.id, problem });
    if (i > 0 && c.start < cues[i - 1].end + gap - tol)
      add(gap ? `starts ${(c.start - cues[i - 1].end).toFixed(1)} s after ${cues[i - 1].id} ends (needs ${gap} s)` : `starts before ${cues[i - 1].id} ends`);
    // A frame of tolerance: an edge snapped onto the cut that STARTS the CTA touches it, not overlaps.
    if (cta.some(([a, b]) => c.start < b - tol && c.end > a + tol)) add("runs into the call to action");
    const host = job.scenes.filter(s => s.hostPresent && c.start < s.narrationEndSec - 0.05 && c.end > s.narrationStartSec + 0.05);
    if ((def.kind === "card" || def.dims) && host.length)
      add(`${def.kind === "card" ? "full-screen card" : "darkens the frame"} over host scene ${host.map(s => s.index).join(",")} — only over b-roll`);
    if (c.template === "HostCaption") {
      if (!host.length) add("host caption with no host on screen");
      if (nameTag && c.start < nameTag[1] - tol && c.end > nameTag[0] + tol) add("host caption while the name tag is up");
    }
  }
  return out;
}

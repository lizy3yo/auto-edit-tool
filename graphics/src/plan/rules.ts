// The placement rules every graphic is held to, on RESOLVED times — ONE copy, read by the planner
// (to reject and repair what it wrote) and by the finishing step and the lab's composite (as their
// final check), so nothing can disagree about what is allowed. Pure: the film's layout comes in.
import type { ResolvedCue } from "../cueResolve";
import { templateById } from "../registry";
import { FPS } from "../theme";

/** What the rules need to know about each scene of the finished film (its time on the film's
 * own clock, and what is on screen). */
export type LayoutScene = {
  index: number;
  narrationStartSec: number;
  narrationEndSec: number;
  scriptText?: string;
  hostPresent?: boolean;
  cta?: boolean;
  /** A split host scene: host panel on the left, a picture on the right. */
  split?: boolean;
  /** The locked cold open: the host's name tag (lower third) is up over its leading run. */
  hostOpener?: boolean;
};
export type FilmLayout = { scenes: LayoutScene[] };

export type RuleProblem = { cue: string; problem: string };

/** Breathing room between two graphics, so one never reads as the tail of the other. */
export const MIN_GAP_SEC = 1.0;

/** Where the host's name tag is up — the app's `nameCardSceneIndices`: the leading run of
 * `hostOpener` host scenes, else the first host scene. */
export function nameTagRange(film: FilmLayout): [number, number] | undefined {
  const run: LayoutScene[] = [];
  for (const s of film.scenes) {
    if (!s.hostOpener) break;
    if (s.hostPresent) run.push(s);
  }
  const scenes = run.length ? run : film.scenes.filter(s => s.hostPresent).slice(0, 1);
  return scenes.length ? [scenes[0].narrationStartSec, scenes[scenes.length - 1].narrationEndSec] : undefined;
}

export function checkRules(cues: ResolvedCue[], film: FilmLayout, opts: { gap?: number } = {}): RuleProblem[] {
  const out: RuleProblem[] = [];
  const gap = opts.gap ?? 0;
  const tol = 1 / FPS;
  const cta = film.scenes.filter(s => s.cta).map(s => [s.narrationStartSec, s.narrationEndSec] as const);
  const nameTag = nameTagRange(film);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const def = templateById(c.template);
    const add = (problem: string) => out.push({ cue: c.id, problem });
    if (i > 0 && c.start < cues[i - 1].end + gap - tol)
      add(gap ? `starts ${(c.start - cues[i - 1].end).toFixed(1)} s after ${cues[i - 1].id} ends (needs ${gap} s)` : `starts before ${cues[i - 1].id} ends`);
    // A frame of tolerance: an edge snapped onto the cut that STARTS the CTA touches it, not overlaps.
    if (cta.some(([a, b]) => c.start < b - tol && c.end > a + tol)) add("runs into the call to action");
    const host = film.scenes.filter(s => s.hostPresent && c.start < s.narrationEndSec - 0.05 && c.end > s.narrationStartSec + 0.05);
    const what = def.kind === "card" ? "full-screen card" : def.dims ? "darkens the frame" : def.underlay === "window" ? "replaces the picture" : "points at the picture";
    if ((def.kind === "card" || def.dims || def.on === "broll") && host.length)
      add(`${what} over host scene ${host.map(s => s.index).join(",")} — only over b-roll`);
    // A graphic that SHOWS the host (the list beside the host's window) needs the host on screen
    // for its whole length, and never while the name tag is up.
    if (def.on === "host") {
      const covered = film.scenes
        .filter(s => s.hostPresent)
        .reduce((sum, s) => sum + Math.max(0, Math.min(c.end, s.narrationEndSec) - Math.max(c.start, s.narrationStartSec)), 0);
      if (covered < c.end - c.start - 0.1) add("shows the host, but the host is not on screen for all of it");
      if (nameTag && c.start < nameTag[1] - tol && c.end > nameTag[0] + tol) add("shows the host while the name tag is up");
    }
    if (c.template === "HostCaption") {
      if (!host.length) add("host caption with no host on screen");
      if (nameTag && c.start < nameTag[1] - tol && c.end > nameTag[0] + tol) add("host caption while the name tag is up");
    }
  }
  return out;
}

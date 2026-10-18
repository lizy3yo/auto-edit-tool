// The placement rules every graphic is held to, on RESOLVED times — ONE copy, read by the planner
// (to reject and repair what it wrote) and by the finishing step and the lab's composite (as their
// final check), so nothing can disagree about what is allowed. Pure: the film's layout comes in.
import type { ResolvedCue } from "../cueResolve";
import { templateById } from "../registry";
import { FPS, HEIGHT, WIDTH } from "../theme";

/** A host panel on the frame: its left edge and width, px. */
export type HostPanel = { x: number; w: number };

/** What the rules need to know about each scene of the finished film (its time on the film's
 * own clock, and what is on screen). */
export type LayoutScene = {
  index: number;
  narrationStartSec: number;
  narrationEndSec: number;
  scriptText?: string;
  hostPresent?: boolean;
  cta?: boolean;
  /** A split host scene: the host in one panel, a picture in the other (`hostPanel` says where). */
  split?: boolean;
  /** On a split, where the host's panel sits on the frame (px), as assembly composited it — a seam
   * the operator dragged, or the host on the right, included. Unset on a split ⇒ the default
   * layout (`DEFAULT_SPLIT_HOST_PANEL`). */
  hostPanel?: HostPanel;
  /** The locked cold open: the host's name tag (lower third) is up over its leading run. */
  hostOpener?: boolean;
};
export type FilmLayout = { scenes: LayoutScene[] };

/** The default split: the picture in a full-height square on the right, the host in the rest on
 * the left (assembly's `splitPanelWidths` — 840 px on 1920×1080). */
export const DEFAULT_SPLIT_HOST_PANEL: HostPanel = { x: 0, w: WIDTH - HEIGHT };

/** A graphic that touches a split for less than this does not take its panel: an edge snapped onto
 * the cut into or out of the split, whose time and the scene's range disagree by a frame or two. */
const PANEL_MIN_OVERLAP_SEC = 0.1;
/** The narrowest host panel assembly makes (its seam is clamped to 0.2-0.8 of the width): two
 * panels sharing less room than this have no common place for a caption. */
const MIN_PANEL_W = Math.round(0.2 * WIDTH);

/**
 * The host's panel a graphic that takes one (`TemplateDef.panel`) must stay inside, or undefined
 * when it is over no split. Job 400 at 2:18 ("…I pull my chair in closer.", scene 27): with no
 * panel the caption was drawn for the full frame and its dark box ran across the seam, half over
 * the host and half over the scroll beside the host — the lab's composite set the panel, the app's
 * finishing step never did.
 *
 * A graphic is ONE drawing, so it cannot leave the panel halfway: one that runs on from a split
 * onto a full-frame host take keeps the panel there too (off centre, never across a seam onto the
 * picture). Over two splits it sits where both host panels are (a seam dragged on one of them),
 * and over the longer one when the host changes side. Pure.
 */
export function hostPanelFor(cue: { start: number; end: number }, film: FilmLayout): HostPanel | undefined {
  const over = film.scenes
    .filter(s => s.split)
    .map(s => ({ panel: s.hostPanel ?? DEFAULT_SPLIT_HOST_PANEL, sec: Math.min(cue.end, s.narrationEndSec) - Math.max(cue.start, s.narrationStartSec) }))
    .filter(o => o.sec >= PANEL_MIN_OVERLAP_SEC);
  if (!over.length) return undefined;
  const x0 = Math.max(...over.map(o => o.panel.x));
  const x1 = Math.min(...over.map(o => o.panel.x + o.panel.w));
  if (x1 - x0 >= MIN_PANEL_W) return { x: x0, w: x1 - x0 };
  return over.reduce((a, b) => (b.sec > a.sec ? b : a)).panel;
}

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
    // Two graphics may follow each other straight away ACROSS a shot change: the change of picture
    // already separates them (the breathing room is for two on one shot).
    const acrossCut = i > 0 && cues[i - 1].conformed.end && c.start >= cues[i - 1].end - tol;
    if (i > 0 && !acrossCut && c.start < cues[i - 1].end + gap - tol)
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

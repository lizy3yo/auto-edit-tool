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
  /** The locked cold open. Where the name tag goes when the film does not say (`nameTagRange`). */
  hostOpener?: boolean;
  /**
   * WHAT A B-ROLL PICTURE SHOWS (`pictureOf` in ./pictures.ts; unset on a host take, a CTA beat, and
   * wherever the film does not say — the lab's older cached jobs, a test). The planner used to see
   * only "B-ROLL" and the words, so job 409 put the label "Paulinus" — the man the essay was written
   * TO, spoken over the picture — on the picture of Seneca writing, labelled "Seneca" 2 s earlier.
   * `shows`: the shot list's subject (the picture's own description when it has none); `person`:
   * the someone-else it shows; `things`: the key things it shows.
   */
  shows?: string;
  person?: string;
  things?: string[];
  /** A MOVING clip (a paid video in production), not a still with a slow zoom: job 408's Versus card
   * hid the whole of one. Unset where the film does not say. */
  video?: boolean;
  /** The picture of ONE item ("item") or ONE step ("step") of a spoken list, drawn for it alone:
   * job 410's full-screen step card hid all three for 8.3 s. */
  listItem?: "item" | "step";
};
export type FilmLayout = {
  scenes: LayoutScene[];
  /** The scenes (`index`) the app drew the host's name tag on — its self-introduction take, else
   * the first host take that can hold it (`nameCardSceneIndices`). `[]` = the film has no tag.
   * Unset (the lab, an old caller) ⇒ the tag is assumed on the cold open. */
  nameCardScenes?: number[];
};

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

/**
 * Breathing room between two graphics that DARKEN the frame (`TemplateDef.dims`: a caption, a quote,
 * a number over the footage), whatever is between them and a cut included. Job 408 (2:04-2:12): "The
 * toilet is fine." as a caption, the picture back for 1.2 s under "There is a stick in it.", then the
 * next caption — the frame dimmed, lifted and dimmed again, and with two more captions in the 25 s
 * before, the stretch read as running subtitles, not a line to glance at. The 1 s between any two
 * graphics allowed it; the same pair, ~1.9 s apart, came back in jobs 399, 402 and 410. One of the
 * two is kept — the first placed.
 */
export const DIM_GAP_SEC = 3.0;

/** Where the host's name tag is up: the scenes the app says it drew it on (`nameCardScenes`) — the
 * self-introduction take since jobs 401 and 406, which a rule guessing "the cold open" would have
 * left open to a host caption under the card — else the leading run of `hostOpener` host scenes,
 * else the first host scene. */
export function nameTagRange(film: FilmLayout): [number, number] | undefined {
  if (film.nameCardScenes) {
    const tagged = film.scenes.filter(s => film.nameCardScenes!.includes(s.index));
    return tagged.length ? [tagged[0].narrationStartSec, tagged[tagged.length - 1].narrationEndSec] : undefined;
  }
  const run: LayoutScene[] = [];
  for (const s of film.scenes) {
    if (!s.hostOpener) break;
    if (s.hostPresent) run.push(s);
  }
  const scenes = run.length ? run : film.scenes.filter(s => s.hostPresent).slice(0, 1);
  return scenes.length ? [scenes[0].narrationStartSec, scenes[scenes.length - 1].narrationEndSec] : undefined;
}

/** Whether a graphic is up, by more than a frame, while the name tag is (a frame of tolerance: an
 * edge snapped onto the tag's cut touches it, not overlaps). */
const overlapsTag = (cue: { start: number; end: number }, tag: [number, number] | undefined): boolean =>
  !!tag && cue.start < tag[1] - 1 / FPS && cue.end > tag[0] + 1 / FPS;

/** Whether a graphic is up while the host's name tag is (`nameTagRange`). Pure. */
export const underNameTag = (cue: { start: number; end: number }, film: FilmLayout): boolean => overlapsTag(cue, nameTagRange(film));

/** Whether a graphic is over a host take — full frame or a split — for more than an edge snapped
 * onto the cut into or out of it (`PANEL_MIN_OVERLAP_SEC`). Pure. */
export function overHostTake(cue: { start: number; end: number }, film: FilmLayout): boolean {
  return film.scenes.some(s => s.hostPresent && Math.min(cue.end, s.narrationEndSec) - Math.max(cue.start, s.narrationStartSec) >= PANEL_MIN_OVERLAP_SEC);
}

/** Where a graphic's drawing goes on this film, as props for its template: the host's panel on a
 * split (`TemplateDef.panel`), and below the host's chin over a host take (`TemplateDef.belowChin`),
 * on the right while the name tag holds the bottom-left. */
export type Placement = { panel?: HostPanel; low?: true; side?: "right" };

/**
 * The props that put a graphic where it belongs on THIS film's frame — set by the finishing step (and
 * the lab's composite) before the first drawing, so every readability measure reads it where it
 * ships, and decided again at every assembly from the film as it is (never saved in the plan).
 *
 * Job 407, "Number two squared the walls with a broadaxe." (115.33-118.33 s over host scene 21): the
 * chapter label was drawn where it sits over b-roll, a band from y 660 to 925, and its top edge cut
 * across the centred host's beard for 3 s. Over a host take it now goes low, below the chin; on a
 * split also inside the host's panel (job 402's, on scene 14, crossed the seam onto the picture).
 * While the name tag is up the bottom-left is the tag's, so a low label takes the right (a panel
 * keeps its own side). One drawing that only partly covers a host take is low for all of it. Pure.
 */
export function placementFor(template: string, cue: { start: number; end: number }, film: FilmLayout): Placement {
  const def = templateById(template);
  const out: Placement = {};
  const panel = def.panel ? hostPanelFor(cue, film) : undefined;
  if (panel) out.panel = panel;
  if (def.belowChin && overHostTake(cue, film)) {
    out.low = true;
    if (!panel && underNameTag(cue, film)) out.side = "right";
  }
  return out;
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
    const tooClose = i > 0 && !acrossCut && c.start < cues[i - 1].end + gap - tol;
    if (tooClose)
      add(gap ? `starts ${(c.start - cues[i - 1].end).toFixed(1)} s after ${cues[i - 1].id} ends (needs ${gap} s)` : `starts before ${cues[i - 1].id} ends`);
    // Two that darken the frame keep DIM_GAP_SEC apart, across a cut too: dimmed, lifted and dimmed
    // again reads as running subtitles (job 408's two captions 1.2 s apart).
    if (def.dims) {
      const dimmed = cues.slice(0, i).filter(p => templateById(p.template).dims);
      const last = dimmed.reduce<ResolvedCue | undefined>((a, p) => (!a || p.end > a.end ? p : a), undefined);
      if (last && c.start < last.end + DIM_GAP_SEC - tol && !(tooClose && last === cues[i - 1]))
        add(`darkens the frame again ${Math.max(0, c.start - last.end).toFixed(1)} s after ${last.id} — two graphics that darken the picture need ${DIM_GAP_SEC} s between them: keep the stronger one, or show this one another way`);
    }
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
      if (overlapsTag(c, nameTag)) add("shows the host while the name tag is up");
    }
    if (c.template === "HostCaption") {
      if (!host.length) add("host caption with no host on screen");
      if (overlapsTag(c, nameTag)) add("host caption while the name tag is up");
    }
  }
  return out;
}

// The one look every graphic shares. Colours were SAMPLED from Steve Cooper's own frames
// (2026-10 competitor review: "Your Dog Doesn't See You as Human" 7:33 / 3:23, "Before You
// Leave Your Dog Alone" 0:38), not picked by eye, so the prototype is judged against the
// real thing rather than a memory of it. A channel changes `accent` only — everything else is
// the system, and a system is what makes it read as one designer's work.

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export type Theme = {
  /** Card background — measured #0B192B in every corner of every card. */
  bg: string;
  /** Centre glow — measured #1C283A at the middle of the card. */
  glow: string;
  /** Faint grid lines, every `gridStep` px — measured #0F1D2F. */
  grid: string;
  gridStep: number;
  /** The one highlight colour (numbers, VS badge, step numbers, kicker, key word). */
  accent: string;
  /** Warnings only. */
  danger: string;
  text: string;
  textSecondary: string;
  /** The "other" side of a comparison, deliberately quiet. */
  textMuted: string;
  /** Translucent plate behind labels laid over footage. */
  plate: string;
  font: string;
};

export const THEME: Theme = {
  bg: "#0B192B",
  glow: "#1C283A",
  grid: "rgba(255,255,255,0.022)",
  gridStep: 120,
  accent: "#44A3FF",
  danger: "#FF5A4E",
  text: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.86)",
  textMuted: "#5B6878",
  plate: "rgba(12,16,22,0.62)",
  font: "Inter",
};

/**
 * Layout grid, in px at 1920x1080. Steve keeps a 160 px left margin on every card and the
 * kicker at y≈190; everything here sits inside the 5% action-safe area (96 / 54 px), and every
 * line of text inside the 10% title-safe area.
 */
export const LAYOUT = {
  marginX: 160,
  kickerY: 170,
  titleSafeX: 192,
  titleSafeY: 108,
  actionSafeX: 96,
  actionSafeY: 54,
  /**
   * The highest a graphic over a host take may start: below the chin. Our hosts are framed closer
   * than the reference's (chins at ~0.61-0.66 of the height, Steve's ~0.5), so a label at the
   * reference's chest height lands on the beard — job 407's chapter label (scene 21) cut across the
   * host's beard, which ends at ~690 px. 790 clears every host photo we have, the seven new
   * channels' (jobs 401-407) included. A split's host panel is the host take cropped, not scaled,
   * so the chin is at the same height there.
   */
  belowChinY: 790,
};

/** Type scale (px). Measured off the 1080p reference frames. */
export const TYPE = {
  kicker: 30,
  kickerTracking: "0.24em",
  headline: 112,
  headlineSmall: 88,
  sideTitle: 64,
  sideSub: 34,
  bigNumber: 300,
  bigUnit: 72,
  caption: 64,
  labelTitle: 40,
  pill: 30,
};

/** Motion, in frames at 30 fps. One set of timings for every template. */
export const MOTION = {
  /** A word fades in over this many frames once it is spoken (~0.17 s — the reference reads
   * "NOT · THE · BOWL" landing within two frames of each word). */
  wordIn: 5,
  /** Words appear this many seconds BEFORE the transcript says they start — the eye reads
   * ahead of the ear, and broadcast captioning puts text up a frame or two early. */
  wordLeadSec: 0.05,
  /** Element entrance (spring-based). */
  enter: 12,
  /** Overlays fade out over this many frames before their cue ends. */
  overlayOut: 8,
  /** Count-up duration for a big number. */
  countUpSec: 1.1,
};

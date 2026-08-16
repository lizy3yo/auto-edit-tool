/**
 * shared/pacing.ts
 *
 * The long-form PACING CONFIG — the operator-facing dials for the four things the storyboard
 * balancers used to hard-code: the visual mix (host / motion b-roll / stills), the split-screen
 * lane, the fast opening, and asset captions.
 *
 * Two invariants make this safe to ship:
 *
 *  1. **Every feature has its own `enabled` switch, and `enabled: false` is EXACTLY the
 *     pre-config pipeline.** A disabled feature is bypassed, not zeroed — the balancers fall
 *     back to the module constants they always used (`HOST_SCREEN_FRACTION`, `MOTION_RAMP`,
 *     `HOST_SPLITVISUAL_FRACTION`, `SCENE_MIN_HOLD_SEC`, `LONG_SCENE_MAX_SEC`). So one dial can
 *     be turned on at a time and the delta in the finished film is attributable to it alone.
 *  2. **The resolved config is snapshotted into `LongformInputParams.pacing`** at job start, so
 *     a resume, a retry or a regenerate months later reproduces the film that was actually
 *     rendered rather than whatever the admin page says today.
 *
 * Shared (not server-only) because the admin UI renders the same bounds it validates against —
 * one source of truth for defaults, ranges and clamping.
 */

/** Visual mix: how the film's runtime divides between the three registers. */
export interface VisualMixPacing {
  enabled: boolean;
  /** Share of TOTAL runtime with the host on camera. Replaces `HOST_SCREEN_FRACTION` (0.35). */
  hostShare: number;
  /** Share of TOTAL runtime rendered as MOTION b-roll video. Replaces `MOTION_RAMP`'s mean (0.15). */
  motionShare: number;
}

/** Split-screen: host on the left, a generated visual on the right. */
export interface SplitScreenPacing {
  enabled: boolean;
  /** Share of HOST runtime rendered as a split frame. Replaces `HOST_SPLITVISUAL_FRACTION` (7.5/35). */
  hostShare: number;
  /** The right panel as a moving b-roll clip instead of a Ken Burns still. */
  motion: {
    enabled: boolean;
    /** Share of SPLIT beats whose right panel is video. The rest stay stills. */
    share: number;
  };
}

/** Fast opening: tighter shot lengths across a leading window of the film. */
export interface FastOpenPacing {
  enabled: boolean;
  /** Length of the fast window, seconds of narration measured from the start of the film. */
  zoneSec: number;
  /** On-screen FLOOR inside the window. Replaces `SCENE_MIN_HOLD_SEC` (3) for those beats. */
  minShotSec: number;
  /** On-screen CEILING inside the window. Replaces `LONG_SCENE_MAX_SEC` (8) for those beats. */
  maxShotSec: number;
}

/** Burned-in caption text on operator-supplied asset beats. */
export interface CaptionPacing {
  enabled: boolean;
}

export interface LongformPacing {
  visualMix: VisualMixPacing;
  splitScreen: SplitScreenPacing;
  fastOpen: FastOpenPacing;
  captions: CaptionPacing;
}

/**
 * The pre-config pipeline, expressed as config. Used as the fallback whenever a feature is
 * DISABLED, so `enabled: false` and "the code before this file existed" are the same render.
 *
 * These mirror the module constants in `server/longformVideo.ts`; the unit tests assert they
 * stay in step, because a silent drift here would change every film with no dial moved.
 */
export const LEGACY_PACING: LongformPacing = {
  visualMix: { enabled: false, hostShare: 0.35, motionShare: 0.15 },
  // Split screen is the one switch whose OFF is a REMOVAL, not a revert: the legacy pipeline had
  // splits (at 7.5% of the film), so "disabled" has to mean the operator wants none — a
  // zero-target converge would leave whatever splits the storyboard authored. Legacy is therefore
  // expressed as ENABLED at the shipped fraction, with a still right panel.
  splitScreen: {
    enabled: true,
    hostShare: 7.5 / 35,
    motion: { enabled: false, share: 0 },
  },
  fastOpen: { enabled: false, zoneSec: 45, minShotSec: 3, maxShotSec: 8 },
  captions: { enabled: false },
};

/**
 * Shipping defaults — every feature ON at the values these were introduced for. An operator who
 * never opens the settings page gets the intended look; one who wants the old film sets
 * `enabled: false` on the feature they want reverted (see `LEGACY_PACING`).
 */
export const DEFAULT_LONGFORM_PACING: LongformPacing = {
  visualMix: { enabled: true, hostShare: 0.35, motionShare: 0.38 },
  splitScreen: {
    enabled: true,
    hostShare: 20 / 35,
    motion: { enabled: true, share: 0.5 },
  },
  fastOpen: { enabled: true, zoneSec: 45, minShotSec: 2, maxShotSec: 5 },
  captions: { enabled: true },
};

/** Inclusive bounds for every numeric dial — enforced server-side AND rendered by the admin UI. */
export const PACING_BOUNDS = {
  hostShare: { min: 0.15, max: 0.55, step: 0.01 },
  motionShare: { min: 0.1, max: 0.6, step: 0.01 },
  splitHostShare: { min: 0, max: 0.8, step: 0.01 },
  splitMotionShare: { min: 0, max: 1, step: 0.05 },
  zoneSec: { min: 10, max: 120, step: 5 },
  minShotSec: { min: 1.5, max: 3, step: 0.1 },
  maxShotSec: { min: 3, max: 8, step: 0.5 },
} as const;

/**
 * Ceiling on host + motion in ANY runtime quarter, so stills always keep a share of every
 * quarter. Stills are the derived remainder everywhere in the pipeline
 * (`enforceStillMotionRatio`); without this a front-loaded ramp at high shares could ask a
 * quarter for more than 100% of itself and the balancers would silently saturate.
 */
export const MAX_QUARTER_LOAD = 0.92;

/**
 * Most assets one job may carry. `placeAssetBeats` needs one person-free CTA beat per asset, and
 * a two-block pitch has only so many; past this they would be accepted, uploaded, and silently
 * dropped. Enforced by the router AND rendered as the uploader's cap, so the limit is refused at
 * the point of upload rather than discovered mid-render.
 */
export const MAX_JOB_ASSETS = 8;

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

/**
 * Coerce an arbitrary parsed-JSON value (an `app_settings` row, a tRPC input, a snapshot on an
 * old job row) into a complete, in-bounds `LongformPacing`. Unknown/missing fields fall back to
 * `DEFAULT_LONGFORM_PACING` field by field, so adding a dial later never invalidates a stored
 * config and a partially-written row can't crash a render.
 *
 * `hostShare + motionShare` is additionally capped at `MAX_QUARTER_LOAD` — motion yields, since
 * host is the register the operator is most deliberate about. Pure — unit-tested.
 */
export function resolveLongformPacing(raw: unknown): LongformPacing {
  const src = (raw ?? {}) as Partial<Record<keyof LongformPacing, any>>;
  const d = DEFAULT_LONGFORM_PACING;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === "boolean" ? v : fallback;

  const mix = src.visualMix ?? {};
  const hostShare = clamp(
    Number(mix.hostShare ?? d.visualMix.hostShare),
    PACING_BOUNDS.hostShare.min,
    PACING_BOUNDS.hostShare.max
  );
  const motionShare = Math.min(
    clamp(
      Number(mix.motionShare ?? d.visualMix.motionShare),
      PACING_BOUNDS.motionShare.min,
      PACING_BOUNDS.motionShare.max
    ),
    Math.max(0, MAX_QUARTER_LOAD - hostShare)
  );

  const split = src.splitScreen ?? {};
  const splitMotion = split.motion ?? {};

  const fast = src.fastOpen ?? {};
  const minShotSec = clamp(
    Number(fast.minShotSec ?? d.fastOpen.minShotSec),
    PACING_BOUNDS.minShotSec.min,
    PACING_BOUNDS.minShotSec.max
  );

  return {
    visualMix: {
      enabled: bool(mix.enabled, d.visualMix.enabled),
      hostShare,
      motionShare,
    },
    splitScreen: {
      enabled: bool(split.enabled, d.splitScreen.enabled),
      hostShare: clamp(
        Number(split.hostShare ?? d.splitScreen.hostShare),
        PACING_BOUNDS.splitHostShare.min,
        PACING_BOUNDS.splitHostShare.max
      ),
      motion: {
        enabled: bool(splitMotion.enabled, d.splitScreen.motion.enabled),
        share: clamp(
          Number(splitMotion.share ?? d.splitScreen.motion.share),
          PACING_BOUNDS.splitMotionShare.min,
          PACING_BOUNDS.splitMotionShare.max
        ),
      },
    },
    fastOpen: {
      enabled: bool(fast.enabled, d.fastOpen.enabled),
      zoneSec: clamp(
        Number(fast.zoneSec ?? d.fastOpen.zoneSec),
        PACING_BOUNDS.zoneSec.min,
        PACING_BOUNDS.zoneSec.max
      ),
      minShotSec,
      // The ceiling can never fall to/below the floor, or a fast-zone beat would be
      // simultaneously too long and too short and the split/merge passes would fight.
      maxShotSec: Math.max(
        minShotSec + 1,
        clamp(
          Number(fast.maxShotSec ?? d.fastOpen.maxShotSec),
          PACING_BOUNDS.maxShotSec.min,
          PACING_BOUNDS.maxShotSec.max
        )
      ),
    },
    captions: {
      enabled: bool((src.captions ?? {}).enabled, d.captions.enabled),
    },
  };
}

/**
 * Rescale a per-quarter ramp SHAPE to a new whole-film mean, preserving the front-loading while
 * respecting a per-quarter ceiling.
 *
 * The shipped ramps are steep (motion runs 26% of Q1 down to 6% of Q4 — a 4.3× spread), so
 * multiplying them by a higher mean overflows the early quarters long before the late ones fill:
 * at a 38% mean, Q1 would ask for 67% of its own runtime ON TOP of a 48% host share. Instead this
 * water-fills — clip whatever exceeds each quarter's ceiling, redistribute the clipped seconds
 * across the quarters that still have headroom in proportion to their share of the shape, repeat
 * — so the requested MEAN is honored exactly whenever the ceilings allow it at all, and the
 * front-loading survives as far as it can.
 *
 * `shape` and `caps` must be the same length. Returns a ramp whose mean is `targetMean` (or the
 * highest achievable mean when the caps make that impossible). Pure — unit-tested.
 */
export function scaleRamp(
  shape: number[],
  targetMean: number,
  caps: number[]
): number[] {
  const n = shape.length;
  if (n === 0) return [];
  const shapeMean = shape.reduce((a, b) => a + b, 0) / n;
  if (shapeMean <= 0) return shape.map((_, q) => Math.min(targetMean, caps[q]));

  // Start from the shape scaled to the target mean, then water-fill the overflow.
  const out = shape.map(v => (v / shapeMean) * targetMean);
  // At most `n` rounds: each round either converges or saturates one more quarter.
  for (let round = 0; round < n; round++) {
    let overflow = 0;
    const openQuarters: number[] = [];
    for (let q = 0; q < n; q++) {
      const cap = Math.max(0, caps[q]);
      if (out[q] > cap) {
        overflow += out[q] - cap;
        out[q] = cap;
      } else if (out[q] < cap) {
        openQuarters.push(q);
      }
    }
    if (overflow <= 1e-9 || openQuarters.length === 0) break;
    // Redistribute in proportion to the shape, so the ramp keeps its slope among the quarters
    // that still have room rather than flattening to a uniform top-up.
    const weight = openQuarters.reduce((sum, q) => sum + shape[q], 0);
    for (const q of openQuarters) {
      out[q] +=
        weight > 0
          ? (overflow * shape[q]) / weight
          : overflow / openQuarters.length;
    }
  }
  return out;
}

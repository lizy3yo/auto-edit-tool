/**
 * shared/hostMinutes.ts
 *
 * The per-video HOST MINUTES budget — "minutes of talking head", chosen on the generate form.
 *
 * Host lip-sync is billed per second of rendered host video, so the old percentage mix (35% of
 * runtime) made a film's single biggest cost grow with its length: 7 minutes of HeyGen on a
 * 20-minute film, 10.5 on a 30. A budget in MINUTES makes that cost a fixed, chosen number
 * instead — 3 minutes by default, raised a minute at a time as a channel earns it.
 *
 * The rule, applied twice with the same function so the dialog and the render cannot disagree:
 *
 *  - Within the GUIDE (the percentage mix, `guideFraction` of the film) → the selected minutes.
 *  - Over the guide, and the operator OVERRODE the warning → the selected minutes, capped at
 *    `HOST_MINUTES_MAX_FRACTION` of the film so a short video never turns into mostly face.
 *  - Over the guide, and not overridden → the guide.
 *
 * The form runs it on an ESTIMATED length (word count) to decide whether to warn; the pipeline
 * runs it again on the MEASURED narration. Shared so both read the same numbers.
 */

import { LEGACY_PACING, type LongformPacing } from "./pacing";

/**
 * The GUIDE: the percentage mix's share of runtime for the host — the admin's visual-mix dial,
 * or the legacy 35% when that dial is off. Same answer as the server's `hostFractionFor`, which
 * the balancers read; this copy exists so the form can compute the warning without the server.
 */
export const hostGuideFraction = (p: LongformPacing): number =>
  p.visualMix.enabled
    ? p.visualMix.hostShare
    : LEGACY_PACING.visualMix.hostShare;

/** The choices on the generate form, in minutes. */
export const HOST_MINUTES_OPTIONS = [3, 4, 5, 6, 7] as const;

/** Preselected on the form — the entry point of the growth plan. */
export const DEFAULT_HOST_MINUTES = 3;

/**
 * INTRO and OUTRO host sections. The first and the last stretch of the film cut back and forth
 * between the host and b-roll (`shapeHostSections`), so the host carries the open and the close
 * instead of one cold-open shot and one closing shot. The stretch is 20 s at the default 3 minutes
 * and grows 15 s per extra minute (3 → 20, 4 → 35, 5 → 50, 6 → 65, 7 → 80) — the section's
 * LENGTH, with roughly half of it on the host. It spends the same budget: the more of it the
 * sections take, the less the mid-film check-ins get.
 */
export const HOST_SECTION_BASE_SEC = 20;
export const HOST_SECTION_STEP_SEC = 15;
/** Each section is at most this share of the film, so on a short film intro and outro never meet. */
export const HOST_SECTION_MAX_FRACTION = 0.2;

/**
 * Length of the intro section, and of the outro section, for a host budget in minutes. With
 * `filmSec`, capped at `HOST_SECTION_MAX_FRACTION` of the film. Pure — unit-tested.
 */
export function hostSectionSecFor(minutes: number, filmSec?: number): number {
  const sec =
    HOST_SECTION_BASE_SEC +
    HOST_SECTION_STEP_SEC * Math.max(0, minutes - DEFAULT_HOST_MINUTES);
  return filmSec == null
    ? sec
    : Math.min(sec, HOST_SECTION_MAX_FRACTION * Math.max(0, filmSec));
}

/**
 * Hard ceiling on host screen time even after an override: half the film. Past it a "faceless"
 * video is mostly face, and the b-roll the format is built around becomes the minority.
 */
export const HOST_MINUTES_MAX_FRACTION = 0.5;

/**
 * Narration pace used to ESTIMATE a film's length from its script before it is voiced. Mirrors
 * the pipeline's calibrated `WORDS_PER_SEC` (server/longformVideo.ts re-exports this value), so
 * the form's estimate and the server's word↔second arithmetic are one number.
 */
export const ESTIMATE_WORDS_PER_SEC = 2.8;

/**
 * How many host CAMERA ANGLES a host budget can carry before the extra ones read as random
 * cuts. Angles rotate evenly across the host beats (`assignHostShots`), so every photo ticked
 * takes an equal share of a fixed number of shots: at 3 minutes a film has ~25 host beats, and
 * four angles leaves each one ~6 appearances scattered over 17 minutes — a camera that turns
 * up every few minutes reads as a mistake, not a set-up. Two angles at 3 minutes gives each
 * ~12, which reads as a two-camera interview. The rule behind the table: an angle should carry
 * about 1.5 minutes of host time to feel established.
 *
 * A GUIDE, not a cap: the picker warns past it and the job records the warning, but nothing
 * is unticked — an operator may want the variety on purpose.
 */
export const HOST_ANGLE_GUIDE: Readonly<Record<number, number>> = {
  3: 2,
  4: 3,
  5: 3,
  6: 4,
  7: 4,
};

/** Seconds of host time an angle should carry — what the table above is derived from. */
const HOST_ANGLE_MIN_SEC = 90;

/** Recommended maximum angle count for a host budget in minutes (never below 1). */
export function recommendedAngleCount(minutes: number): number {
  const fromTable = HOST_ANGLE_GUIDE[minutes];
  if (fromTable) return fromTable;
  return Math.max(
    1,
    Math.floor((Math.max(0, minutes) * 60) / HOST_ANGLE_MIN_SEC)
  );
}

/**
 * The warning shown when more angles are selected than the guide allows, or null when the
 * selection fits. One copy for the picker and the job warning, so the film says the same thing
 * the form said.
 */
export function hostAngleGuideWarning(
  minutes: number,
  selectedAngles: number
): string | null {
  const max = recommendedAngleCount(minutes);
  if (selectedAngles <= max) return null;
  return (
    `${minutes} min of talking head is best with up to ${max} angle${max === 1 ? "" : "s"}. ` +
    `${selectedAngles} selected: each one gets fewer shots and can read as random cuts.`
  );
}

/** Which branch of the rule decided the budget. */
export type HostBudgetBasis = "selected" | "override" | "guide";

export interface HostBudget {
  /** Host seconds the film may use. */
  budgetSec: number;
  /** What the operator picked, in seconds. */
  requestedSec: number;
  /** The percentage mix's host seconds for this length. */
  guideSec: number;
  /** The absolute ceiling for this length (`HOST_MINUTES_MAX_FRACTION`, or the guide if higher). */
  maxSec: number;
  /** The pick exceeds the guide — the case the form warns about. */
  overGuide: boolean;
  basis: HostBudgetBasis;
  /** An override that still hit the half-film ceiling. */
  clampedToMax: boolean;
}

/**
 * Resolve the host budget for one film. `override` is the operator's answer to the warning:
 * true = "use my minutes anyway", false/undefined = the guide. Pure — unit-tested.
 */
export function resolveHostBudget(opts: {
  minutes: number;
  override?: boolean;
  filmSec: number;
  guideFraction: number;
}): HostBudget {
  const filmSec = Math.max(0, opts.filmSec);
  const requestedSec = Math.max(0, opts.minutes) * 60;
  const guideSec = Math.max(0, opts.guideFraction) * filmSec;
  // An admin guide above half the film (the pacing page allows 55%) must not make an override
  // CHEAPER than declining it.
  const maxSec = Math.max(guideSec, HOST_MINUTES_MAX_FRACTION * filmSec);
  const overGuide = requestedSec > guideSec;

  if (!overGuide) {
    return {
      budgetSec: requestedSec,
      requestedSec,
      guideSec,
      maxSec,
      overGuide,
      basis: "selected",
      clampedToMax: false,
    };
  }
  if (opts.override) {
    return {
      budgetSec: Math.min(requestedSec, maxSec),
      requestedSec,
      guideSec,
      maxSec,
      overGuide,
      basis: "override",
      clampedToMax: requestedSec > maxSec,
    };
  }
  return {
    budgetSec: guideSec,
    requestedSec,
    guideSec,
    maxSec,
    overGuide,
    basis: "guide",
    clampedToMax: false,
  };
}

/** `m:ss` for a number of seconds — how budgets are shown on the form and in the logs. */
export function formatMinSec(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

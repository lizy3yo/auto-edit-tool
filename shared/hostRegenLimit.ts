/**
 * How many times one host beat may be paid for.
 *
 * A lip-synced host scene is the film's dearest beat: every render is a full HeyGen render,
 * billed per second of output, kept or not. A 3-minute pick once metered 11:44 of host — 3.9×
 * — almost all of it "Retry failed scenes" clicks, because a click could pay up to three times
 * per beat and nothing counted clicks across a beat's life. The rules, per beat, for its whole
 * life:
 *
 * - AUTOMATIC renders (first, resume, transient/infra resubmits, "Retry failed scenes"): the
 *   first render plus ONE retry — or TWO retries on the start, a CTA or the end
 *   (`scene.hostProtected`), which are the beats the film cannot lose. Past that a check-in is
 *   made b-roll and a protected beat is flagged "Host needed" for a person to decide.
 * - OPERATOR regenerates: ONE. It keeps the take it replaces (`shared/hostTakes.ts`), so the
 *   operator picks between old and new instead of rolling again. Past it the editor's only way
 *   forward is "Make b-roll"; an admin or manager may override with a confirm that names the
 *   cost, since a hard wall with no exit ships the one genuinely broken scene broken.
 * - A HeyGen ACCOUNT failure (credits, key, outage) is never an attempt: HeyGen accepted
 *   nothing, billed nothing, and the beat was not at fault.
 *
 * Counted from the scene's ledger (`StoryboardScene.submits`), host lanes only, so a film made
 * before these rules follows them from now on. A split scene is exempt from the regenerate
 * limit — its regenerate re-renders the b-roll panel only and never touches the lip-sync lane.
 * Pure and shared, so the card, the router, the render gate and the tests answer from one rule.
 */
import type { Role } from "./roles";
import type { SceneSubmitReason, StoryboardScene } from "./types";

/** Operator regenerations allowed per host beat on top of its first render. */
export const MAX_HOST_REGENERATIONS = 1;
/** Automatic retries after a failed first render — a check-in. */
export const HOST_AUTO_RETRIES = 1;
/** Automatic retries after a failed first render — the start, a CTA or the end. */
export const HOST_AUTO_RETRIES_PROTECTED = 2;

const isHostProvider = (p: string) => p === "heygen" || p === "runpod";

/** Renders the pipeline (or "Retry failed scenes") made on its own — not a regenerate/merge. */
const AUTOMATIC: ReadonlySet<SceneSubmitReason> = new Set<SceneSubmitReason>([
  "first",
  "resume",
  "transient",
  "infra",
  "retry",
]);

export const isAutomaticSubmit = (reason: SceneSubmitReason | undefined) =>
  AUTOMATIC.has(reason ?? "first");

/** A full-frame lip-synced host beat — the only shape the regenerate limit applies to. */
export function isLimitedHostScene(scene: StoryboardScene): boolean {
  return !!scene.hostPresent && !scene.splitVisual;
}

/** How many of this scene's paid host renders were operator regenerations. */
export function hostRegenerationsUsed(scene: StoryboardScene): number {
  return (scene.submits ?? []).filter(
    s => s.reason === "regenerate" && isHostProvider(s.provider)
  ).length;
}

/** How many of this scene's paid host renders were automatic (first + retries). */
export function hostAutoRendersUsed(scene: StoryboardScene): number {
  return (scene.submits ?? []).filter(
    s => isAutomaticSubmit(s.reason) && isHostProvider(s.provider)
  ).length;
}

/** Automatic renders this beat is allowed in its life: the first plus its retries. */
export function hostAutoRenderCap(scene: StoryboardScene): number {
  return (
    1 + (scene.hostProtected ? HOST_AUTO_RETRIES_PROTECTED : HOST_AUTO_RETRIES)
  );
}

/** True when the scene is a host beat that has spent its regenerations. */
export function hostRegenerationLocked(scene: StoryboardScene): boolean {
  return (
    isLimitedHostScene(scene) &&
    hostRegenerationsUsed(scene) >= MAX_HOST_REGENERATIONS
  );
}

export type HostRenderDecision =
  | { ok: true; pastLimit: boolean }
  | { ok: false; why: "retries" | "regenerate"; used: number; cap: number };

/**
 * May this host render be paid for? Asked at the one seam every paid host submit crosses
 * (`runChunkTasks`), so every path — first pass, resume, retry click, regenerate — is bounded
 * by the same numbers. `override` is an admin/manager's confirm, which lifts the regenerate
 * limit for one render; automatic retries have no override (a person would click Regenerate).
 */
export function decideHostRender(
  scene: StoryboardScene,
  reason: SceneSubmitReason | undefined,
  override = false
): HostRenderDecision {
  if (isAutomaticSubmit(reason)) {
    const used = hostAutoRendersUsed(scene);
    const cap = hostAutoRenderCap(scene);
    return used < cap
      ? { ok: true, pastLimit: false }
      : { ok: false, why: "retries", used, cap };
  }
  // A merge renders a NEW clip over a new, longer slice — a different beat, never a re-roll.
  if (reason !== "regenerate") return { ok: true, pastLimit: false };
  const used = hostRegenerationsUsed(scene);
  if (!isLimitedHostScene(scene) || used < MAX_HOST_REGENERATIONS)
    return { ok: true, pastLimit: false };
  return override
    ? { ok: true, pastLimit: true }
    : { ok: false, why: "regenerate", used, cap: MAX_HOST_REGENERATIONS };
}

/** Who may regenerate a locked beat anyway (after a confirm that names the cost). */
export function canOverrideHostRegenLimit(role: Role): boolean {
  return role === "admin" || role === "manager";
}

/** The card's copy for a locked beat. */
export function hostRegenLockedLabel(scene: StoryboardScene): string {
  const renders = (scene.submits ?? []).filter(s =>
    isHostProvider(s.provider)
  ).length;
  return `Rendered ${renders}× — regenerate used`;
}

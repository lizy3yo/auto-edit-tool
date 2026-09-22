/**
 * The regenerate limit on a host beat.
 *
 * A lip-synced host scene is the film's dearest beat: every regenerate is a full HeyGen render,
 * billed per second of output, kept or not. Two operator regenerations on top of the first
 * render — three paid renders — is the ceiling: a beat that has not come right in three tries
 * needs a different fix ("Make b-roll", a new photo, a shorter line), not a fourth roll. Past
 * it the Regenerate button locks for editors; an admin or manager may override with a confirm
 * that names the cost, since a hard wall with no exit ships the one genuinely broken scene
 * broken.
 *
 * Counted from the scene's ledger (`StoryboardScene.submits`), and ONLY the entries an operator
 * clicked for (`regenerate`): automatic retries and resumes are capped separately and must not
 * eat the operator's two. A split scene is exempt — its regenerate re-renders the b-roll panel
 * only and never touches the lip-sync lane. Pure and shared, so the card, the router and the
 * tests answer from one rule.
 */
import type { Role } from "./roles";
import type { StoryboardScene } from "./types";

/** Operator regenerations allowed per host beat on top of its first render. */
export const MAX_HOST_REGENERATIONS = 2;

/** A full-frame lip-synced host beat — the only shape the limit applies to. */
export function isLimitedHostScene(scene: StoryboardScene): boolean {
  return !!scene.hostPresent && !scene.splitVisual;
}

/** How many of this scene's paid renders were operator regenerations. */
export function hostRegenerationsUsed(scene: StoryboardScene): number {
  return (scene.submits ?? []).filter(s => s.reason === "regenerate").length;
}

/** True when the scene is a host beat that has spent its regenerations. */
export function hostRegenerationLocked(scene: StoryboardScene): boolean {
  return (
    isLimitedHostScene(scene) &&
    hostRegenerationsUsed(scene) >= MAX_HOST_REGENERATIONS
  );
}

/** Who may regenerate a locked beat anyway (after a confirm that names the cost). */
export function canOverrideHostRegenLimit(role: Role): boolean {
  return role === "admin" || role === "manager";
}

/** The card's copy for a locked beat. */
export function hostRegenLockedLabel(scene: StoryboardScene): string {
  const renders = (scene.submits ?? []).length;
  return `Rendered ${renders}× — regenerate limit reached`;
}

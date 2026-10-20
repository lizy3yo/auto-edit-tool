/**
 * A split screen that shipped as the HOST ALONE: the picture beside the host was never drawn (or
 * never put beside the host), so the scene plays the bare lip-synced take full frame while the
 * storyboard, the editor and assembly still call it a split. The render path used to log that
 * and carry on, with nothing on the job — 39 completed splits locally (job 226 scenes 3
 * and 133, job 383 scene 26) and 49 in production, none with a warning; 24 of the
 * production ones had a panel that PASSED its check and was thrown away by a 300 s timer.
 *
 * Read off the stored clips, so a film rendered before the render path warned is found too: a
 * split's finished clip is its composite (`/split-…`), never the bare host take it was built
 * from, so a completed split whose clip IS its host take has no panel. "Regenerate" on that scene
 * is the repair (`regenerateSplitRight`): it draws only the panel and keeps the host take.
 *
 * Pure and shared, so the card's badge and the job's list agree.
 */
import type { StoryboardScene } from "./types";

/** True when this completed split screen is showing its host take without the panel. */
export function splitPanelMissing(scene: StoryboardScene): boolean {
  if (!scene.hostPresent || !scene.splitVisual) return false;
  if (scene.sceneStatus !== "completed") return false;
  const host = scene.hostClipUrls?.[0];
  const clip = scene.clipUrls?.[0] ?? scene.clipUrl;
  return !!host && clip === host;
}

/** The scenes of a storyboard whose split screen shows the host alone, in scene order. */
export function splitPanelsMissing(
  scenes: readonly StoryboardScene[] | null | undefined
): number[] {
  return (scenes ?? []).filter(splitPanelMissing).map(s => s.index);
}

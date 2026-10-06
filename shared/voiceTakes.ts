/**
 * Voice TAKES — the old and the new version of a scene's voice after "Redo voice".
 *
 * A redo is a fresh provider read, and a fresh read can come back worse than the one it replaces,
 * so the voice a scene had is kept beside the new one. The new one plays by default and the
 * operator can put the old one back for free: switching is a metadata write, and both files stay
 * on R2. Mirrors `shared/hostTakes.ts`, which does the same for a host beat's picture.
 *
 * Also holds the ONE rule for who may redo which scene's voice (`voiceRedoRefusal`), shared by
 * the card (which hides the button) and the route (which refuses the request).
 *
 * Pure and shared: the edit session records and swaps takes, the card lists them, the tests pin
 * the rules.
 */
import { canOverrideHostRegenLimit } from "./hostRegenLimit";
import type { Role } from "./roles";
import type { StoryboardScene, SubmitActor, VoiceTake } from "./types";

/** The scene's current voice as a take, or null when it has no audio to keep. */
export function currentVoice(
  scene: StoryboardScene,
  source: VoiceTake["source"],
  by?: SubmitActor,
  at = new Date().toISOString()
): VoiceTake | null {
  if (!scene.audioUrl) return null;
  const take: VoiceTake = { audioUrl: scene.audioUrl, at, source };
  if (scene.audioDuration != null) take.audioDuration = scene.audioDuration;
  if (scene.narrationStartSec != null)
    take.narrationStartSec = scene.narrationStartSec;
  if (scene.narrationEndSec != null)
    take.narrationEndSec = scene.narrationEndSec;
  if (by) take.by = by;
  return take;
}

/** Put a take's voice on the scene. A take with no master range clears the scene's. */
export function applyVoice(scene: StoryboardScene, take: VoiceTake): void {
  scene.audioUrl = take.audioUrl;
  scene.audioDuration = take.audioDuration;
  scene.narrationStartSec = take.narrationStartSec;
  scene.narrationEndSec = take.narrationEndSec;
}

/**
 * After a redo lands: keep `before` (the voice the scene had) and add the scene's new voice as
 * the next take, which becomes the active one. Idempotent on the same file.
 */
export function recordRedoneVoice(
  scene: StoryboardScene,
  before: VoiceTake | null,
  by?: SubmitActor
): void {
  const fresh = currentVoice(scene, "redo", by);
  if (!fresh) return;
  const takes = scene.voiceTakes?.length
    ? [...scene.voiceTakes]
    : before
      ? [before]
      : [];
  if (before && !takes.some(t => t.audioUrl === before.audioUrl))
    takes.push(before);
  const existing = takes.findIndex(t => t.audioUrl === fresh.audioUrl);
  if (existing >= 0) {
    scene.voiceTakes = takes;
    scene.activeVoiceTake = existing;
    return;
  }
  takes.push(fresh);
  scene.voiceTakes = takes;
  scene.activeVoiceTake = takes.length - 1;
}

/** Index of the voice take the scene is playing, or null when it has no take list. */
export function activeVoiceTakeIndex(scene: StoryboardScene): number | null {
  const takes = scene.voiceTakes;
  if (!takes?.length) return null;
  const i = scene.activeVoiceTake ?? takes.length - 1;
  return i >= 0 && i < takes.length ? i : takes.length - 1;
}

/**
 * Switch the scene to voice take `index`. Returns an error message instead of throwing so the
 * edit session can surface it; a no-op switch (already playing it) is ok. A host beat is refused:
 * its mouth follows its voice, so its voice switches with its host take.
 */
export function selectVoiceTake(
  scene: StoryboardScene,
  index: number
): { ok: true; changed: boolean } | { ok: false; reason: string } {
  const takes = scene.voiceTakes;
  if (!takes?.length)
    return { ok: false, reason: "This scene has only one voice take" };
  if (!Number.isInteger(index) || index < 0 || index >= takes.length)
    return { ok: false, reason: `Voice take ${index + 1} does not exist` };
  if (scene.hostPresent)
    return {
      ok: false,
      reason:
        "A host scene's voice switches with its host take — pick the take instead",
    };
  if (activeVoiceTakeIndex(scene) === index) return { ok: true, changed: false };
  applyVoice(scene, takes[index]);
  scene.activeVoiceTake = index;
  return { ok: true, changed: true };
}

/** "Voice 1 (original)", "Voice 2 (redone by Hank)". */
export function voiceTakeLabel(take: VoiceTake, index: number): string {
  const what =
    take.source === "original"
      ? "original"
      : take.by
        ? `redone by ${take.by.name}`
        : "redone";
  return `Voice ${index + 1} (${what})`;
}

/**
 * Why this scene's voice cannot be redone by this person, or null when it can.
 *
 * A HOST scene — full-frame or split screen — is admins and operations managers only: the mouth
 * was animated to the old voice, so a new voice means a new paid lip-sync render.
 */
export function voiceRedoRefusal(
  scene: Pick<StoryboardScene, "hostPresent">,
  video: { suppliedNarration: boolean },
  role: Role
): string | null {
  if (video.suppliedNarration)
    return "This video uses a narration file you supplied, so a new provider voice would put a second voice in it.";
  if (scene.hostPresent && !canOverrideHostRegenLimit(role))
    return "Only an admin or an operations manager can redo the voice of a host scene — it renders the host clip again.";
  return null;
}

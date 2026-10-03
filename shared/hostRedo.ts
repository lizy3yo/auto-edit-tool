/**
 * "Redo host clips" — one click that renders again every host beat HeyGen refused because of the
 * host PHOTO (its content check: `avatar_not_usable`).
 *
 * A refused photo fails every beat on it the same way, so nothing the film does on its own can
 * fix it: a person changes the photo (another one, or "Make phone look again"), then asks for the
 * clips. The film snapshots its photos when it is generated, so an ordinary retry would send the
 * refused one again — the redo re-reads the channel's photos as they are set NOW first.
 *
 * It also takes back the beats an older film already gave up on for this reason: the start, CTA
 * and end beats left "Host needed", and the check-ins that were made b-roll automatically.
 *
 * Pure and shared, so the card's count, the confirm's cost and the server's pass agree.
 */
import type { StoryboardScene } from "./types";

/** HeyGen's words for a photo its content check will not animate. */
export function isHostPhotoRefusal(raw: string | undefined | null): boolean {
  return /avatar_not_usable|did not pass content moderation/i.test(raw ?? "");
}

const hasClip = (s: StoryboardScene) => !!(s.clipUrls?.length || s.clipUrl);

/** Why a scene is part of a redo, or null when it is not. */
export function hostRedoKind(
  s: StoryboardScene
): "waiting" | "needed" | "broll" | null {
  if (s.hostPresent && !hasClip(s)) {
    if (s.hostWaiting?.photo) return "waiting";
    if (s.hostNeeded && isHostPhotoRefusal(s.hostNeeded.reason))
      return "needed";
    return null;
  }
  if (
    !s.hostPresent &&
    s.autoBroll &&
    !s.autoBroll.limit &&
    isHostPhotoRefusal(s.autoBroll.reason) &&
    // What "Make host" needs too: narration to speak, and a frame that is not the QR/cover/asset.
    !!s.audioUrl &&
    !s.qrHero &&
    !s.coverHero &&
    !s.assetImageUrl
  )
    return "broll";
  return null;
}

export interface HostRedoPlan {
  /** Scene indices to render with the host again, in film order. */
  scenes: number[];
  /** How many of them are pictures now and become host beats again. */
  fromBroll: number;
  /** Seconds of host output the redo pays for (each beat's narration). */
  sec: number;
}

/** What a redo would render. `scenes` empty ⇒ the button is not offered. */
export function planHostRedo(
  scenes: StoryboardScene[] | null | undefined
): HostRedoPlan {
  const out: HostRedoPlan = { scenes: [], fromBroll: 0, sec: 0 };
  for (const s of scenes ?? []) {
    const kind = s ? hostRedoKind(s) : null;
    if (!kind) continue;
    out.scenes.push(s.index);
    if (kind === "broll") out.fromBroll++;
    out.sec += Math.max(0, s.audioDuration ?? 0);
  }
  return out;
}

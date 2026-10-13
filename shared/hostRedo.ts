/**
 * "Redo host clips" — one click that renders again every host beat lost to the host PHOTO: HeyGen
 * refused it (its content check: `avatar_not_usable`), or could not get it ready
 * (`isHostPhotoPrepFailure`).
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

/** How the HeyGen adapter words a photo registration that outlasted its retries. */
export const HOST_PHOTO_PREP_FAILED = "HeyGen could not prepare the host photo";

/**
 * HeyGen could not get the host photo READY — its own trouble, not the photo's and not the
 * beat's: the copy it had just made of the photo was "not found" (`asset_not_found`), a
 * registration collided with one still in flight (409), the avatar never finished, or an avatar
 * it had handed out was gone (`avatar_not_found`). Every beat on the photo fails the same way
 * until HeyGen recovers, so they wait together and are taken back by one redo. Also reads the
 * words films recorded BEFORE the adapter retried this (2026-10-05), so those are recoverable.
 * A registration HeyGen turned down for the photo itself (400, no face) is deliberately not one.
 */
export function isHostPhotoPrepFailure(
  raw: string | undefined | null
): boolean {
  return /HeyGen could not prepare the host photo|avatar registration failed \((?:404|409)\)|asset_not_found|avatar_not_found|avatar group \S+ not ready/i.test(
    raw ?? ""
  );
}

/** Lost to the host photo either way — what a redo takes back. */
const isHostPhotoFailure = (raw: string | undefined | null) =>
  isHostPhotoRefusal(raw) || isHostPhotoPrepFailure(raw);

const hasClip = (s: StoryboardScene) => !!(s.clipUrls?.length || s.clipUrl);

/** Why a scene is part of a redo, or null when it is not. */
export function hostRedoKind(
  s: StoryboardScene
): "waiting" | "needed" | "broll" | null {
  if (s.hostPresent && !hasClip(s)) {
    if (s.hostWaiting?.photo) return "waiting";
    if (s.hostNeeded && isHostPhotoFailure(s.hostNeeded.reason))
      return "needed";
    return null;
  }
  if (
    !s.hostPresent &&
    s.autoBroll &&
    !s.autoBroll.limit &&
    isHostPhotoFailure(s.autoBroll.reason) &&
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
  /**
   * How many were lost because HeyGen REFUSED the photo (the photo has to change first). The
   * rest were lost to HeyGen not getting it ready, where the redo is simply another try.
   */
  refused: number;
}

/** Whether this redo beat was lost to a REFUSED photo (else: one HeyGen could not prepare). */
function lostToRefusal(s: StoryboardScene): boolean {
  if (s.hostWaiting) return !s.hostWaiting.prep;
  return isHostPhotoRefusal(s.hostNeeded?.reason ?? s.autoBroll?.reason);
}

/** What a redo would render. `scenes` empty ⇒ the button is not offered. */
export function planHostRedo(
  scenes: StoryboardScene[] | null | undefined
): HostRedoPlan {
  const out: HostRedoPlan = { scenes: [], fromBroll: 0, sec: 0, refused: 0 };
  for (const s of scenes ?? []) {
    const kind = s ? hostRedoKind(s) : null;
    if (!kind) continue;
    out.scenes.push(s.index);
    if (kind === "broll") out.fromBroll++;
    if (lostToRefusal(s)) out.refused++;
    out.sec += Math.max(0, s.audioDuration ?? 0);
  }
  return out;
}

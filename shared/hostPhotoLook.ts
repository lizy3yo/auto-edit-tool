/**
 * shared/hostPhotoLook.ts — which picture a host photo actually renders from.
 *
 * Every host photo has its ORIGINAL (`imageUrl`, as uploaded) and a PHONE-LOOK copy made from it
 * (`phoneImageUrl`, server/hostPhoneLook.ts). The phone look is the DEFAULT everywhere — the
 * picker, every video, the HeyGen test, the VSL — and each photo has a switch back to the
 * original. This is the one rule, shared by the server (generate route, HeyGen test) and the
 * browser (picker, Admin), so what a tile shows is what renders.
 *
 * THE LOOK IS VERSIONED (2026-10-11). The first phone look (2026-09-28, removed 2026-10-05)
 * RE-SHOT the host from a new spot — off-centre and zoomed out — and its copies are still on the
 * rows. Today's look keeps the host exactly where the photo puts them and changes only how it was
 * recorded, so a copy counts only when the CURRENT recipe made it
 * (`phoneLookVersion === PHONE_LOOK_VERSION`); an older one is remade and never rendered.
 */

/**
 * Bump when the recipe changes in a way that makes earlier copies the wrong look. 3 (2026-10-16):
 * real skin asked for in detail, and a lip-sync-ready mouth for a photo whose lips are hard to see
 * (`server/hostPhoneLook.ts`, `MOUTH_READY_CLAUSE`) — what the render tests of four hosts proved.
 * 4 (2026-10-16): an open mouth (mid-word, a toothy grin) is rested closed as the last step.
 */
export const PHONE_LOOK_VERSION = 4;

/**
 * A copy this recipe can bring up to date WITHOUT drawing it again. 4 (2026-10-16) only adds the
 * mouth-at-rest edit (`REST_MOUTH_PROMPT`) on top of 3, so a v3 copy — each one already through the
 * framing lock, the quality and skin checks and the render tests — gets just that step, and keeps
 * its look; a fresh draw would be a new roll of the dice. Null when the bump changes the look.
 */
export const PHONE_LOOK_UPGRADES_FROM: number | null = 3;

/** The fields this module reads — the DB row satisfies it. */
export interface HostPhotoLookLike {
  imageUrl: string;
  phoneImageUrl?: string | null;
  useOriginal?: boolean | null;
  phoneLookError?: string | null;
  /** Which recipe made `phoneImageUrl` and recorded `phoneLookError`; 0/unset = before versions. */
  phoneLookVersion?: number | null;
}

/** This row's copy and error are today's recipe's — an older recipe's are ignored. Pure. */
const current = (p: HostPhotoLookLike): boolean =>
  (p.phoneLookVersion ?? 0) === PHONE_LOOK_VERSION;

/** The phone copy this photo may render from: made by the current recipe and not failed. Pure. */
export function usablePhoneLook(p: HostPhotoLookLike): string | null {
  return current(p) && !p.phoneLookError && p.phoneImageUrl ? p.phoneImageUrl : null;
}

/** Why the current recipe could not make this photo's copy, if it could not. Pure. */
export function phoneLookFailure(p: HostPhotoLookLike): string | null {
  return current(p) && p.phoneLookError ? p.phoneLookError : null;
}

/** The picture a video (or the HeyGen test) uses for this photo. Pure. */
export function hostPhotoUrl(p: HostPhotoLookLike): string {
  return (!p.useOriginal && usablePhoneLook(p)) || p.imageUrl;
}

/**
 * Where a photo's look stands, for the picker's label:
 *  - "phone":    the phone-look version is made and in use
 *  - "original": the operator switched to the original
 *  - "making":   the phone look is still being made — the original is used until it lands
 *  - "failed":   it could not be made (`phoneLookError`) — the original is used
 * Pure.
 */
export type HostPhotoLookState = "phone" | "original" | "making" | "failed";

export function hostPhotoLookState(p: HostPhotoLookLike): HostPhotoLookState {
  if (p.useOriginal) return "original";
  if (usablePhoneLook(p)) return "phone";
  return phoneLookFailure(p) ? "failed" : "making";
}

/** Plain words for the state, shown under the tile. */
export const HOST_PHOTO_LOOK_LABEL: Record<HostPhotoLookState, string> = {
  phone: "Phone look",
  original: "Original",
  making: "Making phone look…",
  failed: "Original (phone look failed)",
};

/** One photo in a HeyGen test run (an upload, or a library photo added to the run). */
export interface TestPhoto {
  original: string;
  /** Its phone-look version, once made. */
  phone?: string;
  /** Why the phone look could not be made. */
  failed?: string;
  useOriginal: boolean;
  /** Where it came from — shown on the tile. */
  source?: "upload" | "channel";
  /**
   * Test BOTH looks of this photo in the one run — a clip from the original and a clip from its
   * phone look, same script and voice, so the look is the only thing that differs.
   */
  both?: boolean;
}

const asLook = (p: TestPhoto): HostPhotoLookLike => ({
  imageUrl: p.original,
  phoneImageUrl: p.phone,
  useOriginal: p.useOriginal,
  phoneLookError: p.failed,
  // The page only ever holds a copy the server handed it as usable (`usablePhoneLook` for a
  // library photo, `phoneLookForUrl`'s per-recipe cache for an upload), so it is always current.
  phoneLookVersion: PHONE_LOOK_VERSION,
});

/** The picture a test photo renders from — the same rule as a channel's photos. Pure. */
export const testPhotoUrl = (p: TestPhoto): string => hostPhotoUrl(asLook(p));
/**
 * Every picture a test photo puts in the run: its one look, or — ticked "Both looks", once the
 * phone look exists — the original then the phone look. Pure.
 */
export function testPhotoUrls(p: TestPhoto): string[] {
  return p.both && p.phone && !p.failed ? [p.original, p.phone] : [testPhotoUrl(p)];
}

/** Where every phone-look copy is stored — how a finished clip's picture is told apart. */
export const PHONE_LOOK_KEY_PREFIX = "host-photos/phone-";
/** This picture is a phone-look copy (of either recipe), not a photo as uploaded. Pure. */
export const isPhoneLookUrl = (url: string): boolean => url.includes(`/${PHONE_LOOK_KEY_PREFIX}`);

/** Where a test photo's look stands. Pure. */
export const testPhotoState = (p: TestPhoto): HostPhotoLookState => hostPhotoLookState(asLook(p));

/**
 * shared/hostPhotoLook.ts — which picture a host photo actually renders from.
 *
 * Every host photo has its ORIGINAL (`imageUrl`, as uploaded) and a PHONE-LOOK version made from
 * it (`phoneImageUrl`, server/hostPhoneLook.ts): the same host in the same room, remade as a frame
 * of a video they recorded on a propped-up phone. The operator's call on 2026-09-28: the phone
 * look is the DEFAULT everywhere — the picker, every video, the HeyGen test — and each photo has a
 * switch back to the original. This is the one rule, shared by the server (generate route, HeyGen
 * test) and the browser (picker, Admin), so what a tile shows is what renders.
 */

/** The fields this module reads — the DB row satisfies it. */
export interface HostPhotoLookLike {
  imageUrl: string;
  phoneImageUrl?: string | null;
  useOriginal?: boolean | null;
  phoneLookError?: string | null;
}

/** The picture a video (or the HeyGen test) uses for this photo. Pure. */
export function hostPhotoUrl(p: HostPhotoLookLike): string {
  return !p.useOriginal && p.phoneImageUrl ? p.phoneImageUrl : p.imageUrl;
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
  if (p.phoneImageUrl) return "phone";
  return p.phoneLookError ? "failed" : "making";
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
}

const asLook = (p: TestPhoto): HostPhotoLookLike => ({
  imageUrl: p.original,
  phoneImageUrl: p.phone,
  useOriginal: p.useOriginal,
  phoneLookError: p.failed,
});

/** The picture a test photo renders from — the same rule as a channel's photos. Pure. */
export const testPhotoUrl = (p: TestPhoto): string => hostPhotoUrl(asLook(p));
/** Where a test photo's look stands. Pure. */
export const testPhotoState = (p: TestPhoto): HostPhotoLookState => hostPhotoLookState(asLook(p));

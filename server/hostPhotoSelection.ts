/**
 * server/hostPhotoSelection.ts
 *
 * Which of a channel's host photos a video shoots from — the pure half of the picker, shared by
 * the generate route and the `channelHostPhoto.setSelected` guard so the two cannot disagree.
 *
 * A channel's photos carry a saved `isSelected` tick (drizzle/schema.ts), which is the choice
 * every operator and device sees. The generate form still sends the ids it currently shows as
 * ticked, so a click that has not landed yet cannot leave the film and the picker disagreeing;
 * the saved ticks are the DEFAULT for a caller that sends nothing (an older client, a script).
 */

/** The fields this module reads — the DB row satisfies it. */
export interface HostPhotoLike {
  id: number;
  imageUrl: string;
  isSelected: boolean;
}

/**
 * The photos a video renders from, primary first (library order is kept). An explicit list wins
 * when it names at least one known photo — unknown ids are ignored rather than rejected, since
 * a photo can be removed between opening the form and pressing generate, and that should cost
 * an angle, not the render. With no usable list the channel's saved ticks apply, and a channel
 * with nothing ticked (only possible for rows predating the column) falls back to every photo.
 */
export function selectedHostPhotos<T extends HostPhotoLike>(
  library: T[],
  hostPhotoIds?: number[]
): T[] {
  if (hostPhotoIds?.length) {
    const explicit = library.filter(p => hostPhotoIds.includes(p.id));
    if (explicit.length) return explicit;
  }
  const ticked = library.filter(p => p.isSelected);
  return ticked.length ? ticked : library;
}

/**
 * Whether one photo may be unticked: never the channel's last ticked one, because a video with
 * no host photo cannot render a host scene. Ticking is always allowed.
 */
export function canDeselectHostPhoto<T extends HostPhotoLike>(
  library: T[],
  id: number
): boolean {
  const ticked = library.filter(p => p.isSelected);
  if (!ticked.some(p => p.id === id)) return true; // already unticked — a no-op
  return ticked.length > 1;
}

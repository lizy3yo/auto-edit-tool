/**
 * server/hostPhotoSelection.ts
 *
 * Which of a channel's host photos a video shoots from — the pure half of the picker, shared by
 * the generate route and the `channelHostPhoto` routes so the two cannot disagree.
 *
 * ONE PHOTO PER CHANNEL (2026-10-15): a video renders its host from exactly one photo, the
 * channel's best (`pickHostPhoto`: the operator's own pick, else the highest score from
 * `server/hostPhotoScore.ts`). The competitor review found every competitor keeps one host photo
 * for the whole channel, while ours rotated two to four "angles" per video and changed them
 * between videos. The saved `isSelected` tick (drizzle/schema.ts) is that one photo, the choice
 * every operator and device sees; the other photos stay in the library, unused. The generate form
 * still sends the id it shows, so a click that has not landed yet cannot leave the film and the
 * picker disagreeing; the saved tick is the DEFAULT for a caller that sends nothing.
 */

/** The fields this module reads — the DB row satisfies it. */
export interface HostPhotoLike {
  id: number;
  imageUrl: string;
  isSelected: boolean;
  /** The photo's score (0-100, `hostPhotoScore.ts`); null until it has been measured. */
  qualityScore?: number | null;
  /** An operator chose this photo by hand — it is used whatever the scores say. */
  pickedByHand?: boolean;
}

/**
 * The ONE photo a channel's videos use: the operator's own pick when there is one, else the
 * highest-scoring photo, else (nothing measured yet) the first in library order — the primary.
 * Ties keep library order, so a re-score that changes nothing never flips the choice. Pure.
 */
export function pickHostPhoto<T extends HostPhotoLike>(library: T[]): T | undefined {
  const byHand = library.find(p => p.pickedByHand);
  if (byHand) return byHand;
  let best: T | undefined;
  for (const p of library)
    if (!best || (p.qualityScore ?? -1) > (best.qualityScore ?? -1)) best = p;
  return best;
}

/**
 * The photo a video renders from — always ONE (none for an empty library). An explicit id from
 * the form wins when it names a known photo (the first known one, if an older client sends
 * several) — unknown ids are ignored rather than rejected, since a photo can be removed between
 * opening the form and pressing generate. With no usable id the channel's saved tick applies, and
 * with no single tick (rows predating the rule) the best photo (`pickHostPhoto`).
 */
export function selectedHostPhotos<T extends HostPhotoLike>(
  library: T[],
  hostPhotoIds?: number[]
): T[] {
  if (hostPhotoIds?.length) {
    const explicit = hostPhotoIds.map(id => library.find(p => p.id === id)).find(Boolean);
    if (explicit) return [explicit];
  }
  const ticked = library.filter(p => p.isSelected);
  const chosen = ticked.length === 1 ? ticked[0] : pickHostPhoto(ticked.length ? ticked : library);
  return chosen ? [chosen] : [];
}

/**
 * The tick changes that make `chosenId` the channel's one photo: every other ticked photo is
 * unticked and the chosen one ticked. Only rows whose tick changes are returned. Pure.
 */
export function oneTickChanges<T extends HostPhotoLike>(
  library: T[],
  chosenId: number
): { id: number; isSelected: boolean }[] {
  return library
    .filter(p => p.isSelected !== (p.id === chosenId))
    .map(p => ({ id: p.id, isSelected: p.id === chosenId }));
}

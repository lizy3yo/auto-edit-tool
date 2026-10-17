/**
 * server/hostPhotoChoice.ts — keeps every channel on ONE host photo, the best one (2026-10-15).
 *
 * `syncChannelHostPhoto` scores each library photo that has not been scored for its current image
 * (`hostPhotoScore.ts`: measured face, size, light and sharpness, judged skin and lips — once per
 * photo, saved on the row), picks the channel's photo (`pickHostPhoto`: the operator's own pick,
 * else the highest score), leaves exactly that one ticked (`isSelected`), and makes the PHONE LOOK
 * for that photo only — the other photos are not used, so no copy is paid for them.
 *
 * Called in the background when the picker lists a channel and after a photo is added, removed or
 * picked, and (with a short wait) when a video starts. Never throws: a photo that cannot be read
 * keeps no score and loses only to a scored one; the pick falls back to library order.
 */
import type { ChannelHostPhoto } from "../drizzle/schema";
import { getChannelHostPhotos, updateChannelHostPhoto } from "./db";
import { ensurePhoneLook } from "./hostPhoneLook";
import { rateHostPhoto } from "./hostPhotoScore";
import { oneTickChanges, pickHostPhoto } from "./hostPhotoSelection";
import { presignOwnBucketUrl } from "./storage";

/** A photo needs scoring when it never was, or its image changed since. Pure. */
export function needsScore(p: Pick<ChannelHostPhoto, "imageUrl" | "qualityScore" | "qualityOf">): boolean {
  return p.qualityScore == null || p.qualityOf !== p.imageUrl;
}

const scoring = new Map<number, Promise<void>>();

/** Score one photo and save it on the row. One at a time per photo; never throws. */
export function scoreHostPhotoRow(p: ChannelHostPhoto): Promise<void> {
  const running = scoring.get(p.id);
  if (running) return running;
  const job = (async () => {
    try {
      const resp = await fetch(await presignOwnBucketUrl(p.imageUrl), { signal: AbortSignal.timeout(60_000) });
      if (!resp.ok) throw new Error(`photo ${resp.status}`);
      const r = await rateHostPhoto(Buffer.from(await resp.arrayBuffer()));
      await updateChannelHostPhoto(p.id, {
        qualityScore: r.score,
        qualityNotes: r.notes.join("; ").slice(0, 255) || null,
        qualityOf: p.imageUrl,
      });
      console.log(`[HostPhotoChoice] photo ${p.id} (${p.channelKey}) scored ${r.score}${r.notes.length ? ` — ${r.notes.join("; ")}` : ""}`);
    } catch (err: any) {
      console.warn(`[HostPhotoChoice] photo ${p.id} (${p.channelKey}) could not be scored: ${err?.message ?? err}`);
    } finally {
      scoring.delete(p.id);
    }
  })();
  scoring.set(p.id, job);
  return job;
}

const syncing = new Map<string, Promise<ChannelHostPhoto | undefined>>();

/**
 * Score what needs it, tick the channel's one photo, make its phone look. Returns the chosen row.
 * A second call while one runs joins it.
 */
export function syncChannelHostPhoto(channelKey: string): Promise<ChannelHostPhoto | undefined> {
  const running = syncing.get(channelKey);
  if (running) return running;
  const job = (async () => {
    try {
      let rows = await getChannelHostPhotos(channelKey, true);
      const stale = rows.filter(needsScore);
      if (stale.length) {
        await Promise.all(stale.map(scoreHostPhotoRow));
        rows = await getChannelHostPhotos(channelKey, true);
      }
      const chosen = pickHostPhoto(rows);
      if (!chosen) return undefined;
      for (const c of oneTickChanges(rows, chosen.id)) await updateChannelHostPhoto(c.id, { isSelected: c.isSelected });
      void ensurePhoneLook({ ...chosen, isSelected: true });
      return { ...chosen, isSelected: true };
    } catch (err: any) {
      console.warn(`[HostPhotoChoice] ${channelKey}: ${err?.message ?? err}`);
      return undefined;
    } finally {
      syncing.delete(channelKey);
    }
  })();
  syncing.set(channelKey, job);
  return job;
}

/** `syncChannelHostPhoto`, but give up waiting after `ms` (the sync carries on). */
export async function syncChannelHostPhotoWithin(channelKey: string, ms: number): Promise<void> {
  await Promise.race([syncChannelHostPhoto(channelKey), new Promise(res => setTimeout(res, ms))]);
}

/** The operator picks `id` as the channel's photo (or, with null, hands the choice back). */
export async function pickChannelHostPhotoByHand(channelKey: string, id: number | null): Promise<void> {
  const rows = await getChannelHostPhotos(channelKey, true);
  for (const p of rows) {
    const byHand = p.id === id;
    if (p.pickedByHand !== byHand) await updateChannelHostPhoto(p.id, { pickedByHand: byHand });
  }
  await syncChannelHostPhoto(channelKey);
}

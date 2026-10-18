/**
 * THE DETAIL CHECK'S REDRAWS, CAPPED PER VIDEO (2026-10-18, the operator's condition).
 *
 * The picture check's `detail` question (`detailQuestion` in overlayTextScan.ts: the right thing in
 * the wrong state, number or position) was approved on condition that it does not raise what a video
 * costs. The question rides the check every described picture already gets — no new call — but each
 * "not as described" answer was one more paid picture and one more check, with nothing bounding how
 * many a video could take. Now a video may spend at most `DETAIL_REDRAWS_PER_VIDEO` (3) redraws on
 * the detail ALONE; past that a flagged picture ships and says so (`pictureFlaws`, the card's badge,
 * one job warning), so a person decides whether to regenerate it.
 *
 * Measured before it was turned on, on the 148 described pictures of the seven practice films of
 * 2026-10-18 (jobs 401-407, the check asked as the pipeline asks it, nothing redrawn): 5 flagged —
 * job 402 scene 26, "beverage cart in the rear rows with a nearly empty snack basket" drawn well
 * stocked; job 406 scene 27, "a clean red and black push mower" drawn muddy — never more than 2 in
 * one video, and one of the 5 also "missing" (which takes that redraw anyway). So the cap almost
 * never binds on a 3-minute film, and when a long one makes it bind, the cost still cannot grow past
 * it.
 *
 * Counted in memory per video, like the per-video picture memory of `server/pictureVariety.ts`, and
 * never written anywhere: a restart forgets the count, so a resumed video may take up to the cap once
 * more. A count is a few bytes, so no video is forgotten while the process lives — later videos never
 * re-open the cap under a long render, as an evicting map would.
 */

/** Redraws one video may spend on the detail verdict alone (`DETAIL_REDRAWS_PER_VIDEO` overrides). */
export const DETAIL_REDRAWS_PER_VIDEO = 3;

/** The cap in force: a whole number ≥ 0 from the environment (0 = never redrawn, only flagged). */
export function detailRedrawsPerVideo(): number {
  const raw = process.env.DETAIL_REDRAWS_PER_VIDEO?.trim();
  if (!raw) return DETAIL_REDRAWS_PER_VIDEO;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DETAIL_REDRAWS_PER_VIDEO;
}

const taken = new Map<number, number>();

/**
 * Take one of the video's detail redraws: true when one was left (and it is now spent), false past
 * the cap. Synchronous on purpose — a video's pictures are drawn several at once, and two checks that
 * answer together must not both read "one left".
 *
 * Outside a video (`jobId` null: a bench script, a test) nothing is counted or capped — that picture
 * still gets at most the one redraw it shares with a missing thing.
 */
export function takeDetailRedraw(jobId: number | null | undefined): boolean {
  if (jobId == null) return true;
  const used = taken.get(jobId) ?? 0;
  if (used >= detailRedrawsPerVideo()) return false;
  taken.set(jobId, used + 1);
  return true;
}

/** How many detail redraws a video has spent in this process. */
export function detailRedrawsTaken(jobId: number): number {
  return taken.get(jobId) ?? 0;
}

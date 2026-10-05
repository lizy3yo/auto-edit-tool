/**
 * A large upload sent in small pieces — the rules the browser and the server share.
 *
 * A narration file went up as ONE request, so a connection that dropped at 95% of a 29 MB
 * file started again from nothing, and on a weak connection it could simply never finish.
 * In pieces, each is retried on its own, and an upload picked up again asks the server which
 * pieces it already holds and sends only the rest.
 */

/** One piece. Small enough that a retry loses little and the progress bar moves on a weak link. */
export const PART_BYTES = 1024 * 1024;

/** How many pieces a file of `size` bytes is sent as. */
export const partCount = (size: number) =>
  Math.max(1, Math.ceil(size / PART_BYTES));

/** The byte range of piece `index` (end exclusive). */
export function partRange(index: number, size: number): [number, number] {
  const start = index * PART_BYTES;
  return [start, Math.min(size, start + PART_BYTES)];
}

/** An upload's id is made by the browser; it is only ever a folder name, so keep it to one. */
export const isUploadId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(id);

/**
 * The pieces still to send. `held` is what the server reports — index and byte length — and a
 * piece only counts when it is the full length it should be, so one cut off mid-write is sent
 * again rather than trusted.
 */
export function partsToSend(
  size: number,
  held: readonly { index: number; bytes: number }[]
): number[] {
  const total = partCount(size);
  const complete = new Set(
    held
      .filter(h => {
        if (!Number.isInteger(h.index) || h.index < 0 || h.index >= total)
          return false;
        const [start, end] = partRange(h.index, size);
        return h.bytes === end - start;
      })
      .map(h => h.index)
  );
  return Array.from({ length: total }, (_, i) => i).filter(
    i => !complete.has(i)
  );
}

/** Seconds to wait before try `attempt` (1-based) of one piece: 1, 2, 4, 8, then 15. */
export const partRetryDelayMs = (attempt: number) =>
  Math.min(15_000, 1000 * 2 ** (attempt - 1));
/** Tries per piece before the upload stops and says so. The pieces sent so far are kept. */
export const PART_ATTEMPTS = 6;

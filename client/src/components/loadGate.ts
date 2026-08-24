/**
 * A FIFO concurrency gate for browser media loads.
 *
 * The storyboard filmstrip mounts one `<video>` per scene — up to ~200 of them. Letting every
 * one fetch at once queues them all behind the browser's ~6-connection-per-host cap, which
 * starves whatever the operator is actually looking at (the detail panel's player sits black
 * waiting its turn). This lets a few through at a time and hands the slot on as each finishes.
 *
 * Pure and framework-free so the queueing is unit-testable — the DOM half (does a `<video>`
 * actually paint a frame?) is the part that needs a browser, and it's kept out of here.
 */
export function createLoadGate(maxConcurrent: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  /**
   * Run `task` once a slot is free. Returns a release callback the caller MUST invoke when the
   * load settles (success or failure) — releasing is idempotent, and releasing while still
   * queued simply cancels the pending task instead of freeing a slot that was never taken.
   */
  function acquire(task: () => void): () => void {
    let released = false;
    const start = () => {
      active++;
      task();
    };
    const release = () => {
      if (released) return;
      released = true;
      const queuedAt = waiting.indexOf(start);
      if (queuedAt >= 0) {
        waiting.splice(queuedAt, 1); // never started — just leave the queue
        return;
      }
      active--;
      waiting.shift()?.();
    };
    if (active < maxConcurrent) start();
    else waiting.push(start);
    return release;
  }

  /** Test/diagnostic view of the gate's state. */
  const stats = () => ({ active, queued: waiting.length });

  return { acquire, stats };
}

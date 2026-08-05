/**
 * Minimal FIFO async semaphore — bounds how many async operations run concurrently.
 *
 * Unlike the per-adapter token buckets (which throttle submission *rate*) this caps the
 * number of jobs actually *in-flight*: a slot is held for the whole submit→poll lifecycle and
 * released only when that job reaches a terminal state. Used as a single global instance per
 * provider so the cap holds across all concurrent longform jobs on this process.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];
  /** Total slot count (the cap). Read-only after construction. */
  readonly max: number;
  /** High-water mark of slots simultaneously held since construction. */
  private peak = 0;

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
    this.available = this.max;
  }

  /** Slots currently held (in-flight). Read-only introspection. */
  inUse(): number {
    return this.max - this.available;
  }

  /** Callers parked waiting for a slot. Read-only introspection. */
  waiting(): number {
    return this.waiters.length;
  }

  /** Highest concurrent in-flight count observed so far. Read-only introspection. */
  peakInUse(): number {
    return this.peak;
  }

  /** Acquire a slot, waiting (FIFO) until one frees if the semaphore is full. */
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      if (this.inUse() > this.peak) this.peak = this.inUse();
      return;
    }
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }

  /** Release a slot: wake the next waiter (FIFO) or increment the free count. */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot directly to the waiter — keeps `available` accounting correct
      // (the slot never returns to the pool, it transfers to the woken task).
      next();
      return;
    }
    this.available += 1;
  }
}

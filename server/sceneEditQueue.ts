/**
 * server/sceneEditQueue.ts
 *
 * The scheduling core of a per-job SCENE EDIT SESSION: the operator's regenerate / split-edit
 * clicks on one job land here as requests keyed by scene index, and a single session loop
 * (in `longformVideo.ts`, `runSceneEditSession`) drains them into concurrent tasks.
 *
 * Why a queue and not one lock pass per click: every pass used to be its own `withJobLock`
 * turn — a strict FIFO — so the second scene you clicked did not START until the first had
 * fully rendered, and while any of them ran the job row read "processing" and the client hid
 * every scene's editor. This object is what lets clicks on 5, 9 and 12 all be in flight at
 * once, picked up WHILE the session runs, with one live storyboard document and one settle.
 *
 * Pure bookkeeping, no IO, no timers — so the rules are unit-tested in isolation:
 *
 * - A request for a scene that is QUEUED but not started REPLACES the earlier one ("latest
 *   wins": the operator changed their mind before it rendered, and rendering both would pay
 *   twice for one outcome).
 * - A request for a scene that is ACTIVE (rendering right now) is IGNORED and reported as such,
 *   so the caller can tell the operator instead of silently dropping it (the old
 *   `activeRegenerations` dedupe dropped silently and the router still said ok).
 * - `drain()` hands every pending request to the session and marks those scenes active;
 *   `finish()` retires one. `waitForChange()` parks the session loop until something happens —
 *   a new request or a finished task — so the loop never spins and never sleeps past an event.
 * - `close()` seals the queue when the session decides to end; a request arriving after that
 *   belongs to a NEW session (the caller checks `closed`). Sealing is synchronous and happens
 *   in the same tick the loop observes idle, so no request can fall between two sessions.
 */

/** Anything keyed by scene. The session stores its own request union here. */
export interface SceneKeyed {
  sceneIndex: number;
}

/** What became of an enqueue — surfaced to the router and the client. */
export type EditAccept = "queued" | "superseded" | "ignored";

/** Snapshot for the UI: which scenes wait and which are rendering. */
export interface EditQueueState {
  queued: number[];
  active: number[];
}

export class SceneEditQueue<Req extends SceneKeyed> {
  private readonly pending = new Map<number, Req>();
  private readonly active = new Set<number>();
  private waiters: Array<() => void> = [];
  /** Set by the session when it has decided to end; no further requests are accepted here. */
  closed = false;

  /**
   * Add a request. Pending scene ⇒ replaced (latest wins). Active scene ⇒ ignored. Throws if
   * the queue is closed — the caller must route the request to a fresh session instead.
   */
  enqueue(req: Req): EditAccept {
    if (this.closed) throw new Error("SceneEditQueue is closed");
    if (this.active.has(req.sceneIndex)) return "ignored";
    const had = this.pending.has(req.sceneIndex);
    this.pending.set(req.sceneIndex, req);
    this.wake();
    return had ? "superseded" : "queued";
  }

  /** Take every pending request (in arrival order) and mark its scene active. */
  drain(): Req[] {
    const out = Array.from(this.pending.values());
    this.pending.clear();
    for (const r of out) this.active.add(r.sceneIndex);
    return out;
  }

  /** Retire a finished task's scene. */
  finish(sceneIndex: number): void {
    this.active.delete(sceneIndex);
    this.wake();
  }

  /** Nothing waiting and nothing running. */
  get idle(): boolean {
    return this.pending.size === 0 && this.active.size === 0;
  }

  isActive(sceneIndex: number): boolean {
    return this.active.has(sceneIndex);
  }

  isPending(sceneIndex: number): boolean {
    return this.pending.has(sceneIndex);
  }

  /** Whether the scene is anywhere in this queue (waiting or rendering). */
  has(sceneIndex: number): boolean {
    return this.pending.has(sceneIndex) || this.active.has(sceneIndex);
  }

  state(): EditQueueState {
    return {
      queued: Array.from(this.pending.keys()),
      active: Array.from(this.active),
    };
  }

  /** Resolves on the next enqueue or finish. Resolves immediately if work is already waiting. */
  waitForChange(): Promise<void> {
    if (this.pending.size > 0) return Promise.resolve();
    return new Promise<void>(resolve => this.waiters.push(resolve));
  }

  /** Seal: the owning session is ending. Idempotent. */
  close(): void {
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }
}

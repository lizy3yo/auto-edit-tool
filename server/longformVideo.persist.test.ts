import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Only updateLongformVideoJob matters here; other named ./db imports stay undefined
// (none are called at import time), which is fine for exercising the debounce helpers.
// vi.hoisted so the spy exists when the hoisted vi.mock factory runs.
const { updateSpy } = vi.hoisted(() => ({ updateSpy: vi.fn(async () => {}) }));
vi.mock("./db", () => ({
  updateLongformVideoJob: updateSpy,
  // The queued-retry test only cares that the click is PARKED, never that the pass succeeds;
  // a missing row makes the locked core fail fast instead of reaching for a provider.
  getLongformVideoJobById: async () => null,
}));

import {
  schedulePersist,
  flushPersist,
  withJobLock,
  dispatchScenesByProvider,
  retryFailedScenes,
  isRetryQueued,
  SCENE_DEADLINE_STILL_MS,
} from "./longformVideo";

describe("coalesced storyboard persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateSpy.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("collapses a burst of schedulePersist calls into one trailing write with the latest payload", () => {
    schedulePersist(1, { storyboard: ["a"] });
    schedulePersist(1, { storyboard: ["b"] });
    schedulePersist(1, { progress: { scenesDone: 3 } });
    expect(updateSpy).not.toHaveBeenCalled(); // nothing written yet — still debouncing

    vi.advanceTimersByTime(2500);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(1, {
      storyboard: ["b"], // latest wins
      progress: { scenesDone: 3 }, // merged
    });
  });

  it("flushPersist writes immediately and cancels the pending timer", async () => {
    schedulePersist(2, { storyboard: ["x"] });
    await flushPersist(2);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(2, { storyboard: ["x"] });

    vi.advanceTimersByTime(5000); // timer was cancelled — no second write
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("flushPersist with nothing pending is a no-op", async () => {
    await flushPersist(999);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("clip-stage liveness guards", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateSpy.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  // The prod failure (jobs 140/141/143): one still-lane worker never returned from its await, so
  // the lane's Promise.all never settled. The load-bearing assertion is `resolves` — before the
  // deadline this promise hangs forever and the test times out instead of failing.
  it("abandons a parked still scene as failed instead of hanging the lane", async () => {
    const parked = { index: 0, stillImage: true } as any;
    const healthy = { index: 1, stillImage: true } as any;
    // No jobId → skips the 69labs lane-usage logger's interval.
    const done = dispatchScenesByProvider(
      [parked, healthy],
      null,
      {} as any,
      async s => {
        if (s === parked) await new Promise<void>(() => {}); // never settles
        s.sceneStatus = "completed";
      }
    );

    await vi.advanceTimersByTimeAsync(SCENE_DEADLINE_STILL_MS + 1_000);

    await expect(done).resolves.toBeUndefined();
    expect(parked.sceneStatus).toBe("failed");
    expect(parked.error).toMatch(/wall clock/);
    expect(healthy.sceneStatus).toBe("completed"); // sibling unaffected
  });

  it("heartbeats updatedAt while the job lock is held, and stops once released", async () => {
    let release!: () => void;
    const held = withJobLock(7, () => new Promise<void>(r => (release = r)));

    await vi.advanceTimersByTimeAsync(61_000);
    // Explicit Date, not { status: "processing" } — MySQL's ON UPDATE CURRENT_TIMESTAMP only fires
    // when a column value actually changes, so a no-op write would heartbeat nothing.
    expect(updateSpy).toHaveBeenCalledWith(7, { updatedAt: expect.any(Date) });

    release();
    await held;
    updateSpy.mockClear();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(updateSpy).not.toHaveBeenCalled(); // interval cleared
  });
});

/**
 * Real timers: `withJobLock` installs a 60s heartbeat, and these cases release the lock
 * immediately, so there is nothing to fast-forward.
 */
describe("retry parked behind a running pass", () => {
  it("queues the click instead of dropping it, and does not stack repeats", async () => {
    let release!: () => void;
    const pass = withJobLock(42, () => new Promise<void>(r => (release = r)));
    expect(isRetryQueued(42)).toBe(false);

    // Previously this returned immediately and silently: an operator who saw a scene fail at
    // 151/282 had to wait out the other 131 before the button appeared at all.
    const retry = retryFailedScenes(42).catch(() => {});
    expect(isRetryQueued(42)).toBe(true);

    // Impatient second click is absorbed by the parked one — five clicks must not become
    // five identical passes queued behind each other.
    await retryFailedScenes(42);
    expect(isRetryQueued(42)).toBe(true);

    release();
    await pass;
    await retry;
    // Cleared once it owns the lock, so the button stops reading "queued" and the NEXT
    // failure during the retry pass can be asked for in turn.
    expect(isRetryQueued(42)).toBe(false);
  });

  it("runs straight away when no pass owns the job", async () => {
    await retryFailedScenes(43).catch(() => {});
    expect(isRetryQueued(43)).toBe(false);
  });
});

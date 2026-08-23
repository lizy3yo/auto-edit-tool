import { describe, it, expect } from "vitest";
import { SceneEditQueue } from "./sceneEditQueue";

type Req = { sceneIndex: number; tag: string };

describe("SceneEditQueue", () => {
  it("queues distinct scenes and drains them in arrival order", () => {
    const q = new SceneEditQueue<Req>();
    expect(q.enqueue({ sceneIndex: 5, tag: "a" })).toBe("queued");
    expect(q.enqueue({ sceneIndex: 9, tag: "b" })).toBe("queued");
    expect(q.enqueue({ sceneIndex: 12, tag: "c" })).toBe("queued");
    expect(q.state()).toEqual({ queued: [5, 9, 12], active: [] });
    const batch = q.drain();
    expect(batch.map(r => r.sceneIndex)).toEqual([5, 9, 12]);
    expect(q.state()).toEqual({ queued: [], active: [5, 9, 12] });
  });

  // The operator changed their mind before the scene started rendering: render the LATEST
  // request once, never both.
  it("replaces a pending request for the same scene (latest wins)", () => {
    const q = new SceneEditQueue<Req>();
    q.enqueue({ sceneIndex: 5, tag: "first" });
    expect(q.enqueue({ sceneIndex: 5, tag: "second" })).toBe("superseded");
    const batch = q.drain();
    expect(batch).toEqual([{ sceneIndex: 5, tag: "second" }]);
  });

  // A scene that is rendering right now can't take a new prompt mid-flight; the caller is told
  // so (the old code dropped it silently and still reported ok).
  it("ignores a request for a scene that is already active", () => {
    const q = new SceneEditQueue<Req>();
    q.enqueue({ sceneIndex: 5, tag: "a" });
    q.drain();
    expect(q.enqueue({ sceneIndex: 5, tag: "b" })).toBe("ignored");
    expect(q.state()).toEqual({ queued: [], active: [5] });
    // Other scenes are unaffected.
    expect(q.enqueue({ sceneIndex: 6, tag: "c" })).toBe("queued");
  });

  it("accepts the same scene again once its task has finished", () => {
    const q = new SceneEditQueue<Req>();
    q.enqueue({ sceneIndex: 5, tag: "a" });
    q.drain();
    q.finish(5);
    expect(q.enqueue({ sceneIndex: 5, tag: "b" })).toBe("queued");
  });

  it("is idle only when nothing waits and nothing runs", () => {
    const q = new SceneEditQueue<Req>();
    expect(q.idle).toBe(true);
    q.enqueue({ sceneIndex: 1, tag: "a" });
    expect(q.idle).toBe(false);
    q.drain();
    expect(q.idle).toBe(false);
    q.finish(1);
    expect(q.idle).toBe(true);
  });

  // The session loop parks on this between events; it must wake for BOTH kinds of event and
  // must not park at all when work is already waiting (or the loop would stall forever).
  it("waitForChange resolves on enqueue, on finish, and immediately when work is pending", async () => {
    const q = new SceneEditQueue<Req>();
    let woke = false;
    const w1 = q.waitForChange().then(() => (woke = true));
    expect(woke).toBe(false);
    q.enqueue({ sceneIndex: 1, tag: "a" });
    await w1;
    expect(woke).toBe(true);

    // Work is pending ⇒ no parking.
    let immediate = false;
    await q.waitForChange().then(() => (immediate = true));
    expect(immediate).toBe(true);

    q.drain();
    let wokeOnFinish = false;
    const w2 = q.waitForChange().then(() => (wokeOnFinish = true));
    q.finish(1);
    await w2;
    expect(wokeOnFinish).toBe(true);
  });

  // Sealing is how the session hands off to its successor: nothing may be accepted after the
  // loop has observed idle, or that request would be lost between two sessions.
  it("refuses requests once closed and wakes any waiter", async () => {
    const q = new SceneEditQueue<Req>();
    let woke = false;
    const w = q.waitForChange().then(() => (woke = true));
    q.close();
    await w;
    expect(woke).toBe(true);
    expect(q.closed).toBe(true);
    expect(() => q.enqueue({ sceneIndex: 1, tag: "late" })).toThrow(/closed/);
  });

  it("reports membership for pending and active scenes", () => {
    const q = new SceneEditQueue<Req>();
    q.enqueue({ sceneIndex: 3, tag: "a" });
    expect(q.has(3)).toBe(true);
    expect(q.isPending(3)).toBe(true);
    expect(q.isActive(3)).toBe(false);
    q.drain();
    expect(q.has(3)).toBe(true);
    expect(q.isPending(3)).toBe(false);
    expect(q.isActive(3)).toBe(true);
    q.finish(3);
    expect(q.has(3)).toBe(false);
  });
});

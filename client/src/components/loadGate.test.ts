import { describe, it, expect } from "vitest";
import { createLoadGate } from "@/components/loadGate";

describe("createLoadGate (media load concurrency)", () => {
  it("starts up to the cap immediately and queues the rest", () => {
    const gate = createLoadGate(3);
    const started: number[] = [];
    for (let i = 0; i < 10; i++) gate.acquire(() => started.push(i));
    expect(started).toEqual([0, 1, 2]);
    expect(gate.stats()).toEqual({ active: 3, queued: 7 });
  });

  it("never exceeds the cap across a full drain, and eventually runs EVERY task", () => {
    const gate = createLoadGate(3);
    const started: number[] = [];
    const releases: (() => void)[] = [];
    let peak = 0;
    for (let i = 0; i < 75; i++) {
      releases[i] = gate.acquire(() => {
        started.push(i);
        peak = Math.max(peak, gate.stats().active);
      });
    }
    // Settle them in order, as the tiles' `seeked`/`error` handlers would.
    for (let i = 0; i < 75; i++) {
      peak = Math.max(peak, gate.stats().active);
      releases[i]();
    }
    expect(peak).toBeLessThanOrEqual(3); // the whole point: the strip never floods the host
    expect(started).toHaveLength(75); // and nothing is stranded in the queue
    expect(started).toEqual(Array.from({ length: 75 }, (_, i) => i)); // FIFO: scene order
    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
  });

  it("releasing out of order still drains everything", () => {
    const gate = createLoadGate(2);
    const started: number[] = [];
    const rel = Array.from({ length: 6 }, (_, i) =>
      gate.acquire(() => started.push(i))
    );
    expect(started).toEqual([0, 1]);
    rel[1](); // second finishes first
    expect(started).toEqual([0, 1, 2]);
    rel[0]();
    expect(started).toEqual([0, 1, 2, 3]);
    rel[2]();
    rel[3]();
    rel[4]();
    rel[5]();
    expect(started).toHaveLength(6);
    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
  });

  it("a double release does not free someone else's slot", () => {
    const gate = createLoadGate(1);
    const started: number[] = [];
    const rel = Array.from({ length: 3 }, (_, i) =>
      gate.acquire(() => started.push(i))
    );
    rel[0]();
    rel[0](); // idempotent — must not admit two at once
    expect(gate.stats().active).toBe(1);
    expect(started).toEqual([0, 1]);
    rel[1]();
    expect(started).toEqual([0, 1, 2]);
  });

  it("unmounting while still queued cancels instead of leaking a slot", () => {
    const gate = createLoadGate(1);
    const started: number[] = [];
    const rel = Array.from({ length: 3 }, (_, i) =>
      gate.acquire(() => started.push(i))
    );
    rel[2](); // scrolled away / filter changed before it ever started
    expect(gate.stats()).toEqual({ active: 1, queued: 1 });
    rel[0]();
    expect(started).toEqual([0, 1]);
    rel[1]();
    // Task 2 left the queue, so nothing runs it — and the gate is idle, not stuck at active=1.
    expect(started).toEqual([0, 1]);
    expect(gate.stats()).toEqual({ active: 0, queued: 0 });
  });

  it("a stalled task blocks only until its timeout release fires", () => {
    const gate = createLoadGate(2);
    const started: number[] = [];
    const rel = Array.from({ length: 4 }, (_, i) =>
      gate.acquire(() => started.push(i))
    );
    expect(started).toEqual([0, 1]);
    // Task 0 never reports back (404 / undecodable codec); its timeout release runs instead.
    rel[0]();
    expect(started).toEqual([0, 1, 2]);
    rel[1]();
    rel[2]();
    expect(started).toEqual([0, 1, 2, 3]);
  });
});

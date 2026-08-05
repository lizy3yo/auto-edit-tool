import { describe, it, expect } from "vitest";
import { Semaphore } from "./semaphore";

/** Drain all pending microtasks (a queued waiter resumes over several hops). */
const tick = () => new Promise(r => setTimeout(r, 0));

describe("Semaphore", () => {
  it("allows up to `max` concurrent holders without blocking", async () => {
    const s = new Semaphore(3);
    await s.acquire();
    await s.acquire();
    await s.acquire(); // 3rd still resolves immediately
    let fourthResolved = false;
    s.acquire().then(() => {
      fourthResolved = true;
    });
    await tick();
    expect(fourthResolved).toBe(false); // 4th blocks until a release
    s.release();
    await tick();
    expect(fourthResolved).toBe(true);
  });

  it("wakes waiters in FIFO order", async () => {
    const s = new Semaphore(1);
    await s.acquire(); // take the only slot
    const order: number[] = [];
    const w1 = s.acquire().then(() => order.push(1));
    const w2 = s.acquire().then(() => order.push(2));
    const w3 = s.acquire().then(() => order.push(3));
    s.release(); // wakes w1
    await w1;
    s.release(); // wakes w2
    await w2;
    s.release(); // wakes w3
    await w3;
    expect(order).toEqual([1, 2, 3]);
  });

  it("never exceeds `max` in-flight under contention beyond capacity", async () => {
    const MAX = 4;
    const TASKS = 20;
    const s = new Semaphore(MAX);
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: TASKS }, () =>
        (async () => {
          await s.acquire();
          try {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise(r => setTimeout(r, 1));
          } finally {
            inFlight--;
            s.release();
          }
        })()
      )
    );
    expect(peak).toBeLessThanOrEqual(MAX);
    expect(inFlight).toBe(0);
  });

  it("treats max < 1 as a single slot", async () => {
    const s = new Semaphore(0);
    await s.acquire();
    let second = false;
    s.acquire().then(() => {
      second = true;
    });
    await tick();
    expect(second).toBe(false);
    s.release();
    await tick();
    expect(second).toBe(true);
  });
});

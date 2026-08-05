import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The poll throttler is a single 120/min bucket shared by ~90 concurrent jobs, so tokens are
 * scarce. `acquirePollToken(priority)` must serve near-complete jobs (FINALIZING/PROCESSING) ahead
 * of still-queued (PENDING) ones, otherwise a render that finished server-side waits ~45-140s to
 * be detected and the scene times out of its image budget. These tests pin (a) the status→priority
 * mapping and (b) the gating: under contention the higher-priority waiter takes the next token.
 *
 * Each test re-imports the module so the module-global bucket starts full (POLL_BUCKET_MAX = 2).
 */

async function freshMod() {
  vi.resetModules();
  return import("./sixtynine-labs");
}

afterEach(() => vi.useRealTimers());

describe("pollPriorityFor", () => {
  it("ranks FINALIZING > PROCESSING > everything else", async () => {
    const { pollPriorityFor } = await freshMod();
    expect(pollPriorityFor("FINALIZING")).toBe(0);
    expect(pollPriorityFor("PROCESSING")).toBe(1);
    expect(pollPriorityFor("PENDING")).toBe(2);
    expect(pollPriorityFor("WHATEVER")).toBe(2);
  });
});

describe("acquirePollToken priority gating", () => {
  it("hands the next refilled token to the higher-priority waiter first", async () => {
    vi.useFakeTimers();
    const { acquirePollToken } = await freshMod();

    // Drain the 2 starting tokens so the next acquisitions must wait for a refill.
    await acquirePollToken(2);
    await acquirePollToken(2);

    const order: string[] = [];
    // Low-priority (PENDING) waiter registers first — without priority it would win on FIFO.
    const low = acquirePollToken(2).then(() => order.push("low"));
    // High-priority (FINALIZING) waiter registers after, but must preempt.
    const high = acquirePollToken(0).then(() => order.push("high"));

    // One refill (~500ms at 2 tokens/sec) frees a single token; the high-priority waiter takes it.
    await vi.advanceTimersByTimeAsync(700);
    await high;
    expect(order).toEqual(["high"]);

    // Next refill frees the low-priority waiter.
    await vi.advanceTimersByTimeAsync(700);
    await low;
    expect(order).toEqual(["high", "low"]);
  }, 10_000);
});

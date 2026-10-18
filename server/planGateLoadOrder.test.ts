import { describe, expect, it } from "vitest";

// The server only ever reaches the plan gate THROUGH longformVideo (routers → longformVideo →
// planGate), so planGate's top level runs before longformVideo's own and nothing it imports from
// longformVideo is set yet there. Every other test file imports planGate first, which hides it:
// `COVER_SENTENCE_MAX_SEC = HOST_SENTENCE_MAX_SEC` passed every test and stopped node at boot with
// "Cannot access 'HOST_SENTENCE_MAX_SEC' before initialization" (vitest reads it as undefined).
// Its own file, so longformVideo really is loaded first.
describe("the plan gate loads the way the server loads it", () => {
  it("every value planGate exports is set when longformVideo is imported first", async () => {
    const longform = await import("./longformVideo");
    const gate = await import("./planGate");
    const unset = Object.entries(gate)
      .filter(([, v]) => v === undefined || (typeof v === "number" && Number.isNaN(v)))
      .map(([k]) => k);
    expect(unset).toEqual([]);
    // The cover's ceiling is a number of its own for that reason; it stays the host's.
    expect(gate.COVER_SENTENCE_MAX_SEC).toBe(longform.HOST_SENTENCE_MAX_SEC);
  });
});

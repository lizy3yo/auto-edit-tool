import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The meter's job is to attribute spend to the right render and lose none of it. The cases
 * below are the ways that quietly fails: a call made outside any job, two calls to the same
 * model that should merge rather than double a row, and a DB write that fails and must not
 * take the spend down with it.
 */

const rows = new Map<number, any>();

vi.mock("./db", () => ({
  getLongformVideoJobById: vi.fn(async (id: number) => rows.get(id) ?? null),
  updateLongformVideoJob: vi.fn(async (id: number, updates: any) => {
    rows.set(id, { ...(rows.get(id) ?? { id }), ...updates });
  }),
}));

const {
  recordUsage,
  withCostMeter,
  flushJobUsage,
  getJobCostBreakdown,
  currentCostJobId,
} = await import("./costMeter");
const db = await import("./db");

const claudeCall = (model: string, inTok: number, outTok: number) =>
  recordUsage({
    lane: "llm" as const,
    provider: "anthropic",
    model,
    calls: 1,
    quantity: 0,
    inputTokens: inTok,
    outputTokens: outTok,
  });

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
});

describe("job attribution", () => {
  it("drops usage recorded outside any job rather than mis-attributing it", async () => {
    rows.set(1, { id: 1, status: "completed" });
    expect(currentCostJobId()).toBeNull();

    claudeCall("claude-opus-4-8", 1000, 1000);
    await flushJobUsage(1);

    // Nothing was written — an unattributed call must not land on an arbitrary job.
    expect(db.updateLongformVideoJob).not.toHaveBeenCalled();
  });

  it("attributes every call made inside the context, including across awaits", async () => {
    rows.set(7, { id: 7, status: "processing" });

    await withCostMeter(7, async () => {
      claudeCall("claude-opus-4-8", 1_000_000, 0);
      // AsyncLocalStorage must survive the await boundary — this is the whole reason the
      // adapters can stay job-unaware.
      await new Promise(r => setTimeout(r, 1));
      claudeCall("claude-opus-4-8", 1_000_000, 0);
    });
    await flushJobUsage(7);

    const stored = rows.get(7).costUsage;
    expect(stored).toHaveLength(1); // same lane+vendor+model → one merged row
    expect(stored[0].calls).toBe(2);
    expect(stored[0].inputTokens).toBe(2_000_000);
  });

  it("keeps distinct models on separate lines", async () => {
    rows.set(8, { id: 8, status: "processing" });

    await withCostMeter(8, async () => {
      claudeCall("claude-opus-4-8", 1000, 100);
      claudeCall("claude-haiku-4-5-20251001", 1000, 100);
    });
    await flushJobUsage(8);

    expect(rows.get(8).costUsage).toHaveLength(2);
  });

  it("merges a second pass into what the first pass already stored", async () => {
    // A resume or a scene regen bills on top of the original render; it must add, not replace.
    rows.set(9, { id: 9, status: "processing" });

    await withCostMeter(9, async () => claudeCall("claude-opus-4-8", 500, 50));
    await flushJobUsage(9);
    await withCostMeter(9, async () => claudeCall("claude-opus-4-8", 500, 50));
    await flushJobUsage(9);

    const stored = rows.get(9).costUsage;
    expect(stored).toHaveLength(1);
    expect(stored[0].calls).toBe(2);
    expect(stored[0].inputTokens).toBe(1000);
  });
});

describe("durability", () => {
  it("re-buffers spend when the DB write fails, so the next flush retries it", async () => {
    rows.set(10, { id: 10, status: "processing" });
    vi.mocked(db.updateLongformVideoJob).mockRejectedValueOnce(
      new Error("connection lost")
    );

    await withCostMeter(10, async () =>
      claudeCall("claude-opus-4-8", 4000, 400)
    );
    await flushJobUsage(10); // fails
    expect(rows.get(10).costUsage).toBeUndefined();

    await flushJobUsage(10); // retries the same lines
    expect(rows.get(10).costUsage[0].inputTokens).toBe(4000);
  });

  it("never throws out of recordUsage — a metering bug must not fail a render", async () => {
    expect(() => recordUsage(null as any)).not.toThrow();
  });
});

describe("coverage guard", () => {
  // AIReiter shipped as a drop-in replacement for the metered APIMART lane and went
  // unmetered for a release: b-roll and stills on that lane reported as free. Nothing in
  // the type system catches that, so this does. It is a lint, deliberately: if a provider
  // adapter submits a generation request, it must record the spend.
  it("every generation-submitting provider adapter records usage", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    const dir = join(import.meta.dirname, "providers");
    const offenders: string[] = [];

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      // Not adapters: the interface, the still router, the concurrency primitive, barrel.
      if (
        ["base.ts", "fallback.ts", "semaphore.ts", "index.ts"].includes(file)
      ) {
        continue;
      }
      const src = readFileSync(join(dir, file), "utf8");

      // A POST to a provider is the spend signal. Everything free in these files —
      // balances, status polls, artifact downloads, key-health probes — is a GET.
      // (`generateContent` covers gemini-image, which goes through the Google SDK.)
      //
      // Two weaker signals were tried and rejected: matching endpoint URLs let
      // `aireiter.ts` through, because it builds its URL as `${AIREITER_BASE}/submit` and
      // the literal never appears; matching the `base.ts` method names let
      // `openai-image.ts` through, because its entry point is `generateOpenAIStill`.
      const spendsMoney =
        /method:\s*["']POST["']/.test(src) || /generateContent/.test(src);
      if (!spendsMoney) continue;

      // The three lip-sync adapters are metered externally, in one place: the wrapper
      // `resolveLipsyncAdapter` puts around `lane.submit`.
      if (/\bsubmitLipsync\s*\(/.test(src)) continue;

      if (!/recordUsage/.test(src)) offenders.push(file);
    }

    expect(
      offenders,
      `these provider adapters submit billable work but never call recordUsage: ${offenders.join(", ")}`
    ).toEqual([]);
  });
});

describe("getJobCostBreakdown", () => {
  it("marks a job with no recorded usage as unmetered, not as $0.00", async () => {
    // Renders from before metering existed have no costUsage. Showing them as free would
    // be a lie; the UI needs to say the record is missing.
    rows.set(11, { id: 11, status: "completed" });

    const b = await getJobCostBreakdown(11);
    expect(b.metered).toBe(false);
    expect(b.totalUsd).toBe(0);
    expect(b.sections).toHaveLength(0);
  });

  it("groups lanes into sections and badges Claude exact, providers estimated", async () => {
    rows.set(12, { id: 12, status: "processing" });

    await withCostMeter(12, async () => {
      claudeCall("claude-opus-4-8", 1_000_000, 1_000_000); // $30 exactly
      recordUsage({
        lane: "image",
        provider: "apimart",
        model: "gpt-image-2",
        calls: 3,
        quantity: 3,
      });
    });

    const b = await getJobCostBreakdown(12);
    expect(b.metered).toBe(true);
    expect(b.inProgress).toBe(true); // job still processing → "total so far"

    const llm = b.sections.find(s => s.key === "llm")!;
    expect(llm.accuracy).toBe("exact");
    expect(llm.subtotalUsd).toBeCloseTo(30, 6);
    expect(llm.count).toBeNull(); // no unit count on the writing section

    const images = b.sections.find(s => s.key === "image")!;
    expect(images.accuracy).toBe("estimated");
    expect(images.count).toBe(3); // header shows the image count, as in the design

    expect(b.totalUsd).toBeCloseTo(llm.subtotalUsd + images.subtotalUsd, 6);
  });

  it("flags a total as a floor when any line has no mapped rate", async () => {
    rows.set(14, { id: 14, status: "completed" });

    await withCostMeter(14, async () => {
      recordUsage({
        lane: "image",
        provider: "some-new-gateway",
        model: "mystery",
        calls: 5,
        quantity: 5,
      });
    });

    const b = await getJobCostBreakdown(14);
    expect(b.hasUnpricedLines).toBe(true);
    // The calls happened and are counted — only the rate is missing.
    expect(b.sections[0].lines[0].rateKnown).toBe(false);
    expect(b.sections[0].count).toBe(5);
  });

  it("flushes buffered usage before reading, so a mid-render dialog isn't stale", async () => {
    rows.set(13, { id: 13, status: "processing" });

    // Record but do NOT flush — the debounce timer has not fired yet.
    await withCostMeter(13, async () =>
      claudeCall("claude-opus-4-8", 1_000_000, 0)
    );

    const b = await getJobCostBreakdown(13);
    expect(b.totalUsd).toBeCloseTo(5, 6);
  });
});

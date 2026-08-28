import { describe, it, expect, vi, beforeEach } from "vitest";

const getJobCostRows = vi.fn();
const getAllChannelConfigs = vi.fn();

vi.mock("./db", () => ({
  getJobCostRows: (...a: any[]) => getJobCostRows(...a),
  getAllChannelConfigs: (...a: any[]) => getAllChannelConfigs(...a),
}));

/** A fixed rate keeps the EUR assertions about the roll-up, not about the ECB. */
vi.mock("./fx", async () => {
  const rate = { usdToEur: 0.5, source: "pinned", asOf: "2026-08-01" };
  return {
    getUsdToEurRate: async () => rate,
    toEur: (usd: number) => Math.round(usd * 0.5 * 10_000) / 10_000,
  };
});

const { getMonthlyCostReport } = await import("./costRollup");

/** $1.00 of Claude output tokens at the opus-5 rate ($25/MTok ⇒ 40k tokens). */
const claudeDollar = {
  lane: "llm",
  provider: "anthropic",
  model: "claude-opus-5",
  calls: 1,
  quantity: 0,
  inputTokens: 0,
  outputTokens: 40_000,
};

/** A vendor with no mapped rate — priced at 0 but flagged, never silently dropped. */
const unpriced = {
  lane: "image",
  provider: "some-new-vendor",
  model: "whatever-1",
  calls: 1,
  quantity: 10,
};

/** This UTC month, and the one before it — the window the report always covers. */
const now = new Date();
const thisMonth = (day: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 12));
const lastMonth = (day: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day, 12));

const monthOf = (d: Date) => d.toISOString().slice(0, 7);

describe("getMonthlyCostReport", () => {
  beforeEach(() => {
    getJobCostRows.mockReset();
    getAllChannelConfigs.mockReset();
    getAllChannelConfigs.mockResolvedValue([
      { channelKey: "gardening", displayName: "The Garden Bench" },
    ]);
  });

  it("rolls generations up into channel and month totals that agree with the rows", async () => {
    getJobCostRows.mockResolvedValue([
      {
        id: 1,
        createdAt: thisMonth(3),
        status: "completed",
        costUsage: [claudeDollar],
        title: "Autumn leaves",
        channelKey: "gardening",
      },
      {
        id: 2,
        createdAt: thisMonth(9),
        status: "failed",
        costUsage: [claudeDollar, claudeDollar],
        title: "Winter mulch",
        channelKey: "gardening",
      },
      {
        id: 3,
        createdAt: thisMonth(11),
        status: "completed",
        costUsage: [claudeDollar],
        title: "Edging a bed",
        channelKey: "lawncare",
      },
    ]);

    const report = await getMonthlyCostReport({ months: 3 });
    const month = report.months.find(m => m.month === monthOf(thisMonth(1)))!;

    expect(month.usd).toBeCloseTo(4, 6);
    expect(month.eur).toBeCloseTo(2, 6);
    expect(month.videos).toBe(3);

    // The subtotal chain is the point: month === Σ channels === Σ generations.
    const channelSum = month.channels.reduce((n, c) => n + c.usd, 0);
    const rowSum = month.channels
      .flatMap(c => c.generations)
      .reduce((n, g) => n + g.usd, 0);
    expect(channelSum).toBeCloseTo(month.usd, 6);
    expect(rowSum).toBeCloseTo(month.usd, 6);

    // Costliest channel first, and a configured channel shows its display name.
    expect(month.channels[0].label).toBe("The Garden Bench");
    expect(month.channels[0].usd).toBeCloseTo(3, 6);
    expect(month.channels[0].videos).toBe(2);
    // An unconfigured channel key still reports, under the key itself.
    expect(month.channels[1].label).toBe("lawncare");

    // A failed render still spent money and must appear.
    const failed = month.channels[0].generations.find(g => g.jobId === 2)!;
    expect(failed.status).toBe("failed");
    expect(failed.usd).toBeCloseTo(2, 6);
    expect(failed.eur).toBeCloseTo(1, 6);
  });

  it("keeps months apart and always emits the full window, newest first", async () => {
    getJobCostRows.mockResolvedValue([
      {
        id: 1,
        createdAt: thisMonth(2),
        status: "completed",
        costUsage: [claudeDollar],
        title: null,
        channelKey: "gardening",
      },
      {
        id: 2,
        createdAt: lastMonth(20),
        status: "completed",
        costUsage: [claudeDollar, claudeDollar],
        title: null,
        channelKey: "gardening",
      },
    ]);

    const report = await getMonthlyCostReport({ months: 4 });
    expect(report.months).toHaveLength(4);
    expect(report.months[0].month).toBe(monthOf(thisMonth(1)));
    expect(report.months[1].month).toBe(monthOf(lastMonth(1)));
    expect(report.months[0].usd).toBeCloseTo(1, 6);
    expect(report.months[1].usd).toBeCloseTo(2, 6);
    // A month with no renders is still listed, at zero — an absent row reads as lost data.
    expect(report.months[2].videos).toBe(0);
    expect(report.months[2].usd).toBe(0);
  });

  it("counts an unmetered render without pretending it was free", async () => {
    getJobCostRows.mockResolvedValue([
      {
        id: 1,
        createdAt: thisMonth(4),
        status: "completed",
        costUsage: null,
        title: "Pre-metering render",
        channelKey: "gardening",
      },
      {
        id: 2,
        createdAt: thisMonth(5),
        status: "completed",
        costUsage: [claudeDollar],
        title: "Metered render",
        channelKey: "gardening",
      },
    ]);

    const report = await getMonthlyCostReport({ months: 1 });
    const month = report.months[0];
    expect(month.videos).toBe(2);
    expect(month.meteredVideos).toBe(1);
    expect(month.unmeteredVideos).toBe(1);
    expect(month.usd).toBeCloseTo(1, 6);
    expect(
      month.channels[0].generations.find(g => g.jobId === 1)!.metered
    ).toBe(false);
  });

  it("flags a vendor with no rate so the total reads as a floor", async () => {
    getJobCostRows.mockResolvedValue([
      {
        id: 1,
        createdAt: thisMonth(6),
        status: "completed",
        costUsage: [claudeDollar, unpriced],
        title: "New vendor",
        channelKey: "gardening",
      },
    ]);

    const report = await getMonthlyCostReport({ months: 1 });
    const month = report.months[0];
    expect(month.hasUnpricedLines).toBe(true);
    expect(month.channels[0].generations[0].hasUnpricedLines).toBe(true);
    // The unpriced line contributes nothing, so the total is the Claude dollar alone.
    expect(month.usd).toBeCloseTo(1, 6);
  });

  it("reads costUsage whether the driver hands it back parsed or as a string", async () => {
    getJobCostRows.mockResolvedValue([
      {
        id: 1,
        createdAt: thisMonth(7),
        status: "completed",
        costUsage: JSON.stringify([claudeDollar]),
        title: "String JSON",
        channelKey: "gardening",
      },
    ]);

    const report = await getMonthlyCostReport({ months: 1 });
    expect(report.months[0].usd).toBeCloseTo(1, 6);
  });

  it("buckets renders with no channel under Unassigned rather than dropping them", async () => {
    getJobCostRows.mockResolvedValue([
      {
        id: 1,
        createdAt: thisMonth(8),
        status: "completed",
        costUsage: [claudeDollar],
        title: null,
        channelKey: null,
      },
    ]);

    const report = await getMonthlyCostReport({ months: 1 });
    expect(report.months[0].channels[0].label).toBe("Unassigned");
    expect(report.months[0].usd).toBeCloseTo(1, 6);
  });

  it("splits the month by lane so the spend can be attributed", async () => {
    getJobCostRows.mockResolvedValue([
      {
        id: 1,
        createdAt: thisMonth(10),
        status: "completed",
        costUsage: [
          claudeDollar,
          {
            lane: "lipsync",
            provider: "heygen",
            model: "avatar-iv",
            calls: 1,
            quantity: 100,
          },
        ],
        title: null,
        channelKey: "gardening",
      },
    ]);

    const report = await getMonthlyCostReport({ months: 1 });
    const lanes = report.months[0].lanes;
    // 100s at the $0.06/s default is the bigger line, so it sorts first.
    expect(lanes[0].key).toBe("lipsync");
    expect(lanes[0].usd).toBeCloseTo(6, 6);
    expect(lanes[0].eur).toBeCloseTo(3, 6);
    expect(lanes[1].key).toBe("llm");
    expect(lanes.reduce((n, l) => n + l.usd, 0)).toBeCloseTo(
      report.months[0].usd,
      6
    );
  });
});

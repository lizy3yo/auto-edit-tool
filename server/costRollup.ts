/**
 * Monthly spend, rolled up from the same metering the per-job dialog reads.
 *
 * `server/costMeter.ts` records what each render actually spent and `server/pricing.ts` prices
 * it; this file does nothing but ADD those figures up — per generation, per channel, per month —
 * so there is still exactly one cost model in the app. If a rate changes in `pricing.ts`, every
 * number here moves with it, including for renders that finished months ago, because quantities
 * are what is stored and dollars are computed on read.
 *
 * **The row IS a generation.** Channel subtotals and month totals are sums over the generation
 * rows, never a separate query — a subtotal that could disagree with the rows under it would be
 * worse than no subtotal.
 *
 * **Months are UTC.** A render is attributed to the UTC month of its `createdAt`. The Spend tab
 * renders row dates in UTC too, so a row can never appear outside the month it was counted in.
 *
 * **What a total is not.** Three separate caveats travel with the numbers rather than being
 * quietly absorbed:
 *   - `unmeteredVideos` — renders from before metering existed. They cost money nobody recorded,
 *     so the month is incomplete, not cheap.
 *   - `hasUnpricedLines` — a vendor with no rate mapped (`pricing.ts` refuses to borrow another
 *     vendor's rate). The total is then a FLOOR.
 *   - Spend lands in the month the job was CREATED. `UsageLine` carries no timestamp, so a
 *     January render regenerated in February bills to January. Per-usage timestamps would be a
 *     schema change; this is the documented approximation.
 */

import { SECTION_META } from "./costMeter";
import { getAllChannelConfigs, getJobCostRows } from "./db";
import { getUsdToEurRate, toEur, type FxRate } from "./fx";
import { priceLine, type UsageLine } from "./pricing";

/** Default window. A year of months is what a finance review actually looks at. */
const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 36;

/** Channel key stand-in for renders whose `inputParams` carry none. */
const UNASSIGNED = "__unassigned__";

export interface GenerationSpend {
  jobId: number;
  title: string | null;
  createdAt: string;
  status: "processing" | "completed" | "failed";
  usd: number;
  eur: number;
  /** False ⇒ no usage recorded at all. The UI says "not metered", never €0.00. */
  metered: boolean;
  /** True ⇒ at least one vendor had no rate, so this row is a floor. */
  hasUnpricedLines: boolean;
}

export interface ChannelSpend {
  channelKey: string;
  label: string;
  usd: number;
  eur: number;
  videos: number;
  generations: GenerationSpend[];
}

export interface LaneSpend {
  key: string;
  label: string;
  usd: number;
  eur: number;
}

export interface MonthSpend {
  /** `YYYY-MM`, UTC. */
  month: string;
  /** `August 2026` — formatted once here so the table and the CSV never disagree. */
  label: string;
  usd: number;
  eur: number;
  videos: number;
  meteredVideos: number;
  unmeteredVideos: number;
  hasUnpricedLines: boolean;
  lanes: LaneSpend[];
  channels: ChannelSpend[];
}

export interface MonthlyCostReport {
  months: MonthSpend[];
  fx: FxRate;
  generatedAt: string;
}

/**
 * mysql2 hands a JSON column back already parsed on some driver versions and as a string on
 * others (same defensive read as `getJobsForChannel` in `db.ts`).
 */
function asUsageLines(raw: unknown): UsageLine[] {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  return Array.isArray(value) ? (value as UsageLine[]) : [];
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

const monthLabel = (key: string) =>
  new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${key}-01T00:00:00Z`));

/** First instant of the window: the start of the UTC month `months - 1` back from this one. */
function windowStart(months: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)
  );
}

/** Every month in the window, newest first — including ones with no renders at all. */
function monthsInWindow(months: number): string[] {
  const now = new Date();
  return Array.from({ length: months }, (_, i) =>
    monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)))
  );
}

/**
 * The monthly spend report. One database read for the renders, one for the channel names, one
 * cached FX lookup — the pricing itself is pure arithmetic over data already in memory.
 */
export async function getMonthlyCostReport(
  opts: { months?: number } = {}
): Promise<MonthlyCostReport> {
  const months = Math.max(
    1,
    Math.min(MAX_MONTHS, Math.floor(opts.months ?? DEFAULT_MONTHS))
  );

  const [rows, channels, fx] = await Promise.all([
    getJobCostRows(windowStart(months)),
    getAllChannelConfigs(),
    getUsdToEurRate(),
  ]);

  const channelLabels = new Map<string, string>();
  for (const c of channels) {
    channelLabels.set(c.channelKey, c.displayName?.trim() || c.channelKey);
  }

  /** month → channel → accumulating bucket. */
  const byMonth = new Map<
    string,
    {
      channels: Map<string, ChannelSpend>;
      lanes: Map<string, number>;
      usd: number;
      videos: number;
      metered: number;
      unpriced: boolean;
    }
  >();

  for (const row of rows) {
    const createdAt = new Date(row.createdAt);
    if (Number.isNaN(createdAt.getTime())) continue;
    const key = monthKey(createdAt);

    let month = byMonth.get(key);
    if (!month) {
      month = {
        channels: new Map(),
        lanes: new Map(),
        usd: 0,
        videos: 0,
        metered: 0,
        unpriced: false,
      };
      byMonth.set(key, month);
    }

    const lines = asUsageLines(row.costUsage).map(priceLine);
    const usd = lines.reduce((n, l) => n + l.usd, 0);
    const hasUnpricedLines = lines.some(l => !l.rateKnown);

    for (const line of lines) {
      month.lanes.set(line.lane, (month.lanes.get(line.lane) ?? 0) + line.usd);
    }

    const channelKey = row.channelKey?.trim() || UNASSIGNED;
    let channel = month.channels.get(channelKey);
    if (!channel) {
      channel = {
        channelKey,
        label:
          channelKey === UNASSIGNED
            ? "Unassigned"
            : (channelLabels.get(channelKey) ?? channelKey),
        usd: 0,
        eur: 0,
        videos: 0,
        generations: [],
      };
      month.channels.set(channelKey, channel);
    }

    channel.generations.push({
      jobId: row.id,
      title: row.title?.trim() || null,
      createdAt: createdAt.toISOString(),
      status: row.status,
      usd,
      eur: toEur(usd, fx),
      metered: lines.length > 0,
      hasUnpricedLines,
    });
    channel.usd += usd;
    channel.videos += 1;

    month.usd += usd;
    month.videos += 1;
    if (lines.length > 0) month.metered += 1;
    if (hasUnpricedLines) month.unpriced = true;
  }

  const result: MonthSpend[] = monthsInWindow(months).map(key => {
    const m = byMonth.get(key);

    const channelList = (m ? Array.from(m.channels.values()) : [])
      .map(c => ({
        ...c,
        eur: toEur(c.usd, fx),
        // Costliest render first — the row you would question is the row you see.
        generations: c.generations.sort((a, b) => b.usd - a.usd),
      }))
      .sort((a, b) => b.usd - a.usd || a.label.localeCompare(b.label));

    const lanes: LaneSpend[] = (m ? Array.from(m.lanes.entries()) : [])
      .map(([lane, usd]) => ({
        key: lane,
        // A lane added to pricing.ts but not to SECTION_META still shows its spend.
        label: SECTION_META[lane as UsageLine["lane"]]?.label ?? lane,
        usd,
        eur: toEur(usd, fx),
      }))
      .sort((a, b) => b.usd - a.usd);

    const usd = m?.usd ?? 0;
    const videos = m?.videos ?? 0;
    const metered = m?.metered ?? 0;

    return {
      month: key,
      label: monthLabel(key),
      usd,
      eur: toEur(usd, fx),
      videos,
      meteredVideos: metered,
      unmeteredVideos: videos - metered,
      hasUnpricedLines: m?.unpriced ?? false,
      lanes,
      channels: channelList,
    };
  });

  return {
    months: result,
    fx,
    generatedAt: new Date().toISOString(),
  };
}

import { useMemo, useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Wallet,
} from "lucide-react";
import { GenerationCostDialog } from "@/components/GenerationCostDialog";

/**
 * Admin → Spend: what the providers cost, by month.
 *
 * The unit of the report is ONE GENERATION. A month total is the sum of its channels, a channel
 * is the sum of its renders, and every render is listed with its own figure — so any number here
 * can be walked down to the individual video that produced it, and from there into the existing
 * per-render breakdown dialog for the lane-by-lane detail.
 *
 * EUR and USD are shown side by side everywhere because the providers bill in dollars and the
 * books are in euros; neither is a derived afterthought of the other in the UI. The one exchange
 * rate used for the whole report is stated under the figures with its source and date — a EUR
 * total whose rate you cannot see is not one you can reconcile.
 *
 * Server-side counterpart: `server/costRollup.ts` (roll-up), `server/pricing.ts` (rates) and
 * `server/fx.ts` (the ECB rate).
 */

/** Months are bucketed in UTC server-side, so every date here is rendered in UTC to match. */
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const intFmt = new Intl.NumberFormat("en-US");

/**
 * Money, in the currency asked for. Sub-cent figures get four decimals rather than rounding to
 * zero — a long tail of cheap calls is still spend, and "€0.00" reads as free.
 */
function money(n: number, currency: "USD" | "EUR"): string {
  const sub = n > 0 && n < 0.01;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: sub ? 4 : 2,
    maximumFractionDigits: sub ? 4 : 2,
  }).format(n);
}

/** One CSV field: quoted, with embedded quotes doubled. */
const csvCell = (v: string | number) =>
  `"${String(v ?? "").replace(/"/g, '""')}"`;

type Report = RouterOutputs["longformVideo"]["getMonthlyCostReport"];
type MonthSpend = Report["months"][number];

/** A headline figure: EUR large, USD under it, never one without the other. */
function Kpi({
  label,
  eur,
  usd,
  hint,
}: {
  label: string;
  eur: number;
  usd: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
        {money(eur, "EUR")}
      </p>
      <p className="text-sm tabular-nums text-muted-foreground">
        {money(usd, "USD")}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A plain counter tile, for the figures that aren't money. */
function CountTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One channel block: its subtotal, and every generation that made it up. */
function ChannelBlock({
  channel,
  monthUsd,
  onOpenJob,
}: {
  channel: MonthSpend["channels"][number];
  monthUsd: number;
  onOpenJob: (jobId: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const share = monthUsd > 0 ? (channel.usd / monthUsd) * 100 : 0;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {channel.label}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {intFmt.format(channel.videos)}{" "}
          {channel.videos === 1 ? "generation" : "generations"} ·{" "}
          {share.toFixed(1)}%
        </span>
        <span className="w-24 shrink-0 text-right text-sm tabular-nums">
          {money(channel.usd, "USD")}
        </span>
        <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
          {money(channel.eur, "EUR")}
        </span>
      </button>

      {open && (
        <div className="border-t border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Generation</th>
                <th className="px-4 py-2 text-right font-medium">USD</th>
                <th className="px-4 py-2 text-right font-medium">EUR</th>
              </tr>
            </thead>
            <tbody>
              {channel.generations.map(g => (
                <tr
                  key={g.jobId}
                  onClick={() => onOpenJob(g.jobId)}
                  className="cursor-pointer border-t border-border/60 hover:bg-secondary/40"
                  title="Open the per-render breakdown"
                >
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">
                    {dateFmt.format(new Date(g.createdAt))}
                  </td>
                  <td className="max-w-0 px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="truncate">
                        {g.title ?? `Render #${g.jobId}`}
                      </span>
                      {g.status !== "completed" && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] uppercase tracking-wider"
                        >
                          {g.status}
                        </Badge>
                      )}
                    </div>
                  </td>
                  {/* An unmetered render predates cost metering. Its calls were never
                      counted, so $0.00 would be a lie about a video that cost money. */}
                  {g.metered ? (
                    <>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {money(g.usd, "USD")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                        {money(g.eur, "EUR")}
                      </td>
                    </>
                  ) : (
                    <td
                      colSpan={2}
                      className="whitespace-nowrap px-4 py-2 text-right text-xs text-muted-foreground"
                    >
                      not metered
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function MonthlySpend() {
  const { data, isLoading, error } =
    trpc.longformVideo.getMonthlyCostReport.useQuery({ months: 12 });
  const [selected, setSelected] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<number | null>(null);

  const months = data?.months ?? [];
  // Default to the current month — the first entry, which the server always emits even when
  // nothing has been rendered in it yet.
  const month = months.find(m => m.month === selected) ?? months[0] ?? null;
  const previous = month
    ? (months[months.findIndex(m => m.month === month.month) + 1] ?? null)
    : null;

  const delta = useMemo(() => {
    if (!month || !previous || previous.usd <= 0) return null;
    return ((month.usd - previous.usd) / previous.usd) * 100;
  }, [month, previous]);

  /** Per-generation rows for the selected month — the shape a finance sheet wants. */
  const exportCsv = () => {
    if (!month || !data) return;
    const header = [
      "month",
      "channel",
      "generation_id",
      "title",
      "created_utc",
      "status",
      "usd",
      "eur",
      "metered",
    ];
    const rows = month.channels.flatMap(c =>
      c.generations.map(g =>
        [
          month.month,
          c.label,
          g.jobId,
          g.title ?? "",
          g.createdAt,
          g.status,
          g.usd.toFixed(4),
          g.eur.toFixed(4),
          g.metered ? "yes" : "no",
        ].map(csvCell)
      )
    );
    const totals = [
      month.month,
      "TOTAL",
      "",
      "",
      "",
      "",
      month.usd.toFixed(4),
      month.eur.toFixed(4),
      "",
    ].map(csvCell);
    const csv = [
      header.map(csvCell).join(","),
      ...rows.map(r => r.join(",")),
      totals.join(","),
      // The rate belongs in the file, not just on the screen — a EUR column in a
      // spreadsheet is unreconcilable without it.
      csvCell(
        `USD to EUR ${data.fx.usdToEur} (${data.fx.source}, ${data.fx.asOf})`
      ),
    ].join("\r\n");

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `spend-${month.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4" />
          Monthly spend
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select
            value={month?.month ?? ""}
            onValueChange={setSelected}
            disabled={months.length === 0}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              {months.map(m => (
                <SelectItem key={m.month} value={m.month}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={!month || month.videos === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            CSV
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Totalling every render…
          </div>
        )}

        {error && (
          <p className="py-6 text-sm text-destructive">
            Couldn't load the spend report: {error.message}
          </p>
        )}

        {data && month && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                label={`${month.label} total`}
                eur={month.eur}
                usd={month.usd}
                hint={
                  delta == null
                    ? undefined
                    : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs ${previous?.label}`
                }
              />
              <CountTile
                label="Generations"
                value={intFmt.format(month.videos)}
                hint={
                  month.unmeteredVideos > 0
                    ? `${intFmt.format(month.unmeteredVideos)} not metered`
                    : undefined
                }
              />
              <Kpi
                label="Per generation"
                eur={month.meteredVideos ? month.eur / month.meteredVideos : 0}
                usd={month.meteredVideos ? month.usd / month.meteredVideos : 0}
                hint="Average across metered renders"
              />
              <CountTile
                label="Channels"
                value={intFmt.format(month.channels.length)}
                hint={month.channels[0]?.label}
              />
            </div>

            {month.hasUnpricedLines && (
              <p className="rounded-md border border-chart-3/40 bg-chart-3/10 px-3 py-2.5 text-xs leading-relaxed text-chart-3">
                At least one provider used this month has no rate configured, so
                this total is a <strong className="font-semibold">floor</strong>
                , not an estimate — the real figure is higher. Set the matching{" "}
                <code className="text-[11px]">COST_*</code> env var to include
                it.
              </p>
            )}

            {month.unmeteredVideos > 0 && (
              <p className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                {intFmt.format(month.unmeteredVideos)} of this month's{" "}
                {intFmt.format(month.videos)} renders recorded no usage — cost
                metering was added after they ran. They contribute nothing to
                the total, which therefore understates the month.
              </p>
            )}

            {month.lanes.length > 0 && (
              <section>
                <h3 className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Where it went
                </h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {month.lanes.map(lane => (
                    <div
                      key={lane.key}
                      className="flex items-baseline justify-between gap-3 rounded-md border border-border px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {lane.label}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="text-sm tabular-nums">
                          {money(lane.eur, "EUR")}
                        </span>
                        <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                          {money(lane.usd, "USD")}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                By channel, by generation
              </h3>
              {month.channels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No renders in {month.label}.
                </p>
              ) : (
                month.channels.map(c => (
                  <ChannelBlock
                    key={c.channelKey}
                    channel={c}
                    monthUsd={month.usd}
                    onOpenJob={setOpenJobId}
                  />
                ))
              )}
            </section>

            <section>
              <h3 className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Last 12 months
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 text-left font-medium">Month</th>
                    <th className="py-2 text-right font-medium">Generations</th>
                    <th className="py-2 text-right font-medium">USD</th>
                    <th className="py-2 text-right font-medium">EUR</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map(m => (
                    <tr
                      key={m.month}
                      onClick={() => setSelected(m.month)}
                      className={`cursor-pointer border-t border-border/60 hover:bg-secondary/40 ${
                        m.month === month.month ? "bg-secondary/60" : ""
                      }`}
                    >
                      <td className="py-2">{m.label}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {intFmt.format(m.videos)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {money(m.usd, "USD")}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {money(m.eur, "EUR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
              Converted at{" "}
              <span className="text-foreground tabular-nums">
                1 USD = {data.fx.usdToEur.toFixed(4)} EUR
              </span>{" "}
              —{" "}
              {data.fx.source === "ecb"
                ? `ECB reference rate, ${data.fx.asOf}`
                : data.fx.source === "pinned"
                  ? `pinned rate (USD_EUR_RATE)`
                  : `fallback rate — the ECB rate could not be fetched and none is pinned`}
              {data.fx.stale &&
                " · today's rate could not be fetched, so this one is stale"}
              .
              <br />
              <br />
              Quantities are metered from the calls each render actually made,
              including retries and discarded attempts, which providers bill for
              all the same. Only Anthropic's rates are exact; HeyGen, 69Labs and
              APIMART bill credit bundles whose dollar value depends on your
              plan, so those lines are list-price estimates — open any
              generation for its lane-by-lane breakdown. Spend is attributed to
              the month the render was started, and months run in UTC. Storage,
              bandwidth and ffmpeg run on your own machine and R2, so they are
              outside these totals.
            </p>
          </>
        )}
      </CardContent>

      <GenerationCostDialog
        jobId={openJobId}
        open={openJobId != null}
        onOpenChange={open => !open && setOpenJobId(null)}
      />
    </Card>
  );
}

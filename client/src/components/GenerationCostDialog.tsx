import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Receipt } from "lucide-react";

/**
 * Priced spend breakdown for one render.
 *
 * The two badges are the point of the design, not decoration. **Exact** means the quantity and
 * the rate are both known — only Anthropic publishes per-token list prices, so only Claude
 * lines earn it. **Estimated** means the quantity is metered from real provider calls but the
 * rate is a list-price assumption, because HeyGen, 69Labs and APIMART all bill opaque credit
 * bundles whose dollar value depends on the plan. Presenting both as one flat number would be
 * the wrong kind of confident, so they stay visibly separate.
 *
 * Server-side counterpart: `server/costMeter.ts` (metering) and `server/pricing.ts` (rates).
 */

const usd = (n: number) =>
  n >= 0.01 || n === 0
    ? `$${n.toFixed(2)}`
    : // Sub-cent lines round to $0.00 and read as free, which they aren't. Show enough
      // precision that a long tail of cheap calls is still legible.
      `$${n.toFixed(4)}`;

export function GenerationCostDialog({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, error } =
    trpc.longformVideo.getCostBreakdown.useQuery(
      { jobId: jobId ?? 0 },
      {
        enabled: open && jobId != null,
        // A running job keeps spending — refresh while the dialog is open so the figure moves.
        refetchInterval: query =>
          query.state.data?.inProgress ? 15_000 : false,
      }
    );

  const hasSpend = useMemo(
    () => (data?.sections.length ?? 0) > 0,
    [data?.sections.length]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4 text-primary" />
            Estimated generation cost
          </DialogTitle>
          <DialogDescription className="sr-only">
            Priced breakdown of the provider calls this video made.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Totalling this render…
          </div>
        )}

        {error && (
          <p className="py-6 text-sm text-destructive">
            Couldn't load the cost breakdown: {error.message}
          </p>
        )}

        {data && !isLoading && (
          <>
            <div className="flex items-baseline gap-2 pb-1">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">
                {usd(data.totalUsd)}
              </span>
              <span className="text-sm text-muted-foreground">
                {data.inProgress ? "total so far" : "total"}
              </span>
            </div>

            {data.hasUnpricedLines && (
              <p className="rounded-md border border-chart-3/40 bg-chart-3/10 px-3 py-2.5 text-xs leading-relaxed text-chart-3">
                One or more providers below have no rate configured, so this
                total is a <strong className="font-semibold">floor</strong>, not
                an estimate — the real figure is higher. Set the matching{" "}
                <code className="text-[11px]">COST_*</code> env var to include
                them.
              </p>
            )}

            {!data.metered && (
              <p className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                No spend recorded for this render. Cost metering was added after
                it ran, so its provider calls were never counted — this is a gap
                in the record, not a free video. Newly generated videos are
                metered from their first API call.
              </p>
            )}

            {data.metered && !hasSpend && (
              <p className="text-xs text-muted-foreground">
                This render hasn't made a billable call yet.
              </p>
            )}

            {data.sections.map(section => (
              <section
                key={section.key}
                className="border-t border-border pt-4"
              >
                <header className="flex items-center justify-between gap-3 pb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.label}
                    {section.count != null && (
                      <span className="ml-1.5 font-normal normal-case tracking-normal">
                        ({section.count})
                      </span>
                    )}
                  </h3>
                  <Badge
                    variant="outline"
                    className={
                      section.accuracy === "exact"
                        ? "border-primary/40 bg-primary/10 text-primary uppercase tracking-wider"
                        : "border-chart-3/40 bg-chart-3/10 text-chart-3 uppercase tracking-wider"
                    }
                  >
                    {section.accuracy}
                  </Badge>
                </header>

                <ul className="space-y-2.5">
                  {section.lines.map(line => (
                    <li
                      key={line.label}
                      className="flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">
                          {line.label}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {line.detail}
                        </p>
                      </div>
                      {/* $0.00 would read as "these calls were free". They weren't — we
                          just have no rate for that vendor yet. */}
                      <span
                        className={
                          line.rateKnown
                            ? "shrink-0 text-sm tabular-nums text-foreground"
                            : "shrink-0 text-xs text-chart-3"
                        }
                      >
                        {line.rateKnown ? usd(line.usd) : "rate not set"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {hasSpend && (
              <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
                Every count above is metered from the calls this render actually
                made — real token counts, images and seconds of rendered video,
                including retries and discarded attempts, which providers bill
                for all the same.
                <br />
                <br />
                <span className="text-foreground">Exact</span> sections use
                Anthropic's published per-token rates, so they match what you're
                billed. <span className="text-foreground">Estimated</span>{" "}
                sections have the same real counts but a list-price rate:
                HeyGen, 69Labs and APIMART bill credit bundles whose dollar
                value depends on your plan, so those totals are an
                approximation. Check one invoice, then pin your real rates in{" "}
                <code className="rounded bg-secondary px-1 py-0.5 text-[11px]">
                  server/pricing.ts
                </code>{" "}
                (or the matching <code className="text-[11px]">COST_*</code> env
                vars) and every figure here becomes yours.
                <br />
                <br />
                Storage, bandwidth and ffmpeg run on your own machine and R2, so
                they're outside this total.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

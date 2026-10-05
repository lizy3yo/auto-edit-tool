import { summarizeJobPicks, type JobPickFacts } from "@shared/jobPicks";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * "Made with" — the picks a video was generated with (`shared/jobPicks.ts`), always on its card.
 * The form above only shows the picks for the NEXT video, so without this a finished video has
 * nothing saying what it was made with.
 */
export function JobPicks({
  facts,
  channelName,
}: {
  facts: JobPickFacts;
  /** The channel's display name, when the caller has the channel list. */
  channelName?: string;
}) {
  const picks = summarizeJobPicks(facts, { channelName, formatDate });
  return (
    <section
      aria-label="What this video was made with"
      className="rounded-md border border-border bg-secondary/40 px-3 py-2"
    >
      <h3 className="text-xs font-medium text-muted-foreground">Made with</h3>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {picks.map(p => (
          <div key={p.key} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{p.label}</dt>
            <dd className="break-words text-xs font-medium">{p.value}</dd>
            {p.note && (
              <dd className="break-words text-[11px] text-muted-foreground">
                {p.note}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

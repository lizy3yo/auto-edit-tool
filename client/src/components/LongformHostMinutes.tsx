import {
  HOST_MINUTES_OPTIONS,
  formatMinSec,
  type HostBudget,
} from "@shared/hostMinutes";

/**
 * "Minutes of talking head" — the per-video host budget on the generate form.
 *
 * Host lip-sync is the one lane billed by the second of output, so this is the dial that sets a
 * video's biggest cost. The estimate beside it is priced at the same rate the Cost dialog uses
 * afterwards (`COST_HEYGEN_PER_SEC`), and the over-the-guide note appears as soon as the script
 * makes it true — the confirm dialog then asks the actual question.
 */
export function LongformHostMinutes({
  value,
  onChange,
  estimate,
  filmSec,
  ratePerSec,
  hasHostPhoto,
  disabled,
}: {
  value: number;
  onChange: (minutes: number) => void;
  /** `resolveHostBudget` for the current pick against the ESTIMATED film length. */
  estimate: HostBudget;
  /** Estimated film length in seconds (0 until there is a script). */
  filmSec: number;
  /** USD per second of host video; undefined while the rate is loading. */
  ratePerSec?: number;
  hasHostPhoto: boolean;
  disabled?: boolean;
}) {
  const money = (usd: number) => `$${usd.toFixed(2).replace(/\.00$/, "")}`;
  const tab = (on: boolean) =>
    `rounded px-3 py-1 text-xs tabular-nums transition-colors disabled:opacity-60 ${
      on
        ? "bg-secondary font-medium text-secondary-foreground"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label="Minutes of talking head"
        className="inline-flex rounded-md border border-border p-0.5"
      >
        {HOST_MINUTES_OPTIONS.map(m => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m)}
            aria-pressed={value === m}
            className={tab(value === m)}
          >
            {m} min
          </button>
        ))}
      </div>

      <p className="text-xs tabular-nums text-muted-foreground">
        {value}:00 of host on camera
        {ratePerSec != null && (
          <>
            {" "}
            · ~{money(value * 60 * ratePerSec)} of lip-sync · each extra minute
            ≈ {money(60 * ratePerSec)}
          </>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        The host is always on camera for the hook, every call to action and the
        outro. The rest of the time is spread as short check-ins, about one a
        minute. The time that frees up goes to still images.
      </p>

      {!hasHostPhoto && (
        <p className="text-xs text-muted-foreground">
          This channel has no host photo, so there are no talking-head scenes to
          budget.
        </p>
      )}
      {hasHostPhoto && filmSec > 0 && estimate.overGuide && (
        <p className="text-xs text-warning">
          On this ~{formatMinSec(filmSec)} script the guide is{" "}
          {formatMinSec(estimate.guideSec)} of host (
          {Math.round((estimate.guideSec / filmSec) * 100)}%). You'll be asked
          to confirm {value} min when you generate.
        </p>
      )}
    </div>
  );
}

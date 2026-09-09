import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Check, Loader2, Star } from "lucide-react";

/**
 * Which of the channel's host photos THIS video may be shot from.
 *
 * The channel holds a library of camera angles; a video uses any subset of it, so one film can
 * run on a single photo and the next on four. Everything is selected by default, which is what a
 * channel migrated from the old two-photo pair gets — an operator who never opens this keeps
 * exactly the behaviour they had.
 *
 * The FIRST selected photo is the primary: split-screen scenes and the opening shot are pinned
 * to it, and it carries ~71% of host runtime whatever else is ticked. Order comes from the
 * channel library, not from click order, so what the picker shows as first is what renders as
 * primary. Re-ordering is done in Admin, where it applies to every future video, rather than
 * here, where it would silently mean something different per render.
 */
export function LongformHostPhotoPicker({
  channelKey,
  value,
  onChange,
  disabled,
}: {
  channelKey: string;
  /** Selected row ids. Empty = "all", which is also what the server reads it as. */
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const { data: photos, isLoading } = trpc.channelHostPhoto.list.useQuery(
    { channelKey, activeOnly: true },
    { enabled: !!channelKey }
  );

  const rows = photos ?? [];
  const ids = rows.map(p => p.id);

  // Start with everything ticked, and drop ids that have since left the channel. Without the
  // prune a photo removed in Admin would stay in the payload and the server would silently
  // ignore it — the count in this panel and the angles in the film would disagree.
  useEffect(() => {
    if (!rows.length) return;
    if (!value.length) {
      onChange(ids);
      return;
    }
    const live = value.filter(id => ids.includes(id));
    if (live.length !== value.length) onChange(live.length ? live : ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, ids.join(",")]);

  if (!channelKey) return null;
  if (isLoading)
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading host photos…
      </div>
    );

  if (!rows.length)
    return (
      <p className="text-[11px] font-medium text-destructive">
        This channel has no host photos — add one under Channels, or host scenes
        cannot be rendered.
      </p>
    );

  const selected = value.length ? value : ids;
  const chosen = rows.filter(p => selected.includes(p.id));

  const toggle = (id: number) => {
    if (disabled) return;
    const next = selected.includes(id)
      ? selected.filter(x => x !== id)
      : [...selected, id];
    // A video with no host photo cannot render a host scene, so the last one can't be unticked.
    if (!next.length) return;
    onChange(ids.filter(x => next.includes(x)));
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">Host photos</Label>
      <p className="text-[11px] text-muted-foreground">
        Which camera angles this video is shot from. The first selected is the
        primary — it opens the film, carries the split-screen scenes and most of
        the host time; the rest break up consecutive host cuts.
      </p>
      <div className="flex flex-wrap gap-2">
        {rows.map((p, i) => {
          const on = selected.includes(p.id);
          const isPrimary = chosen[0]?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(p.id)}
              aria-pressed={on}
              className={`relative w-20 shrink-0 overflow-hidden rounded-md border text-left transition disabled:opacity-60 ${
                on
                  ? "border-primary ring-1 ring-primary"
                  : "border-border opacity-50 hover:opacity-80"
              }`}
            >
              <img src={p.imageUrl} alt="" className="h-20 w-20 object-cover" />
              {on && (
                <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
              )}
              <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground">
                {isPrimary ? (
                  <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
                    <Star className="h-2.5 w-2.5" />
                    Primary
                  </span>
                ) : (
                  `Angle ${i + 1}`
                )}
              </span>
            </button>
          );
        })}
      </div>
      {/* Host plates are generated per look PER ANGLE, so the image cost of ticking another
          photo is visible here rather than discovered on the invoice. */}
      <p className="text-[11px] text-muted-foreground">
        {chosen.length === 1
          ? "1 angle — every host scene uses it, with no angle changes."
          : `${chosen.length} angles — no two host scenes in a row will repeat one.`}
      </p>
    </div>
  );
}

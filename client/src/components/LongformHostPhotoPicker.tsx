import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { hostAngleGuideWarning } from "@shared/hostMinutes";
import { Check, Loader2, Star } from "lucide-react";
import { toast } from "sonner";

/**
 * Which of the channel's host photos its videos are shot from.
 *
 * The ticks are SAVED ON THE CHANNEL (`channel_host_photos.isSelected`), so what one operator
 * chooses here is what every operator sees on every device, and a reload shows the same ticks.
 * They used to be local component state that reset to "everything" on every mount, which read
 * as the choice not being kept. A click writes straight through `channelHostPhoto.setSelected`
 * and the tiles follow the server's answer; while a write is in flight the tiles are disabled so
 * two quick clicks cannot race. `onChange` still hands the parent the ticked ids to ride on the
 * generate call, so the film and the picker agree even if the last write has not landed.
 *
 * The FIRST photo is the primary: the opening shot and the split-screen scenes are pinned to it.
 * Every other host beat takes the angles in turn (`assignHostShots`), so each photo ticked is
 * seen about as often as every other and no two host shots in a row repeat one. The star on a
 * non-primary tile makes it the primary — the same `setPrimary` Admin offers, reordering the
 * channel's library, so it too applies to every future video on the channel.
 *
 * Because the shots are shared out evenly, more angles means fewer shots each: past the guide
 * for the chosen host minutes (`hostAngleGuideWarning`) an extra camera turns up so rarely it
 * reads as a random cut. The picker warns there and the job records the same line; nothing is
 * unticked, since an operator may want the variety on purpose.
 */
export function LongformHostPhotoPicker({
  channelKey,
  value,
  onChange,
  hostMinutes,
  disabled,
}: {
  channelKey: string;
  /** The ticked row ids as last reported by `onChange` — what the generate call sends. */
  value: number[];
  onChange: (ids: number[]) => void;
  /** The "Talking head" pick, in minutes — what the angle guide is measured against. */
  hostMinutes?: number;
  disabled?: boolean;
}) {
  const utils = trpc.useUtils();
  const listInput = { channelKey, activeOnly: true } as const;
  const { data: photos, isLoading } = trpc.channelHostPhoto.list.useQuery(
    listInput,
    { enabled: !!channelKey }
  );

  const setSelected = trpc.channelHostPhoto.setSelected.useMutation({
    // The server returns the channel's list after the write — take it as the truth rather than
    // refetching, so the tile flips the moment the write lands.
    onSuccess: rows => utils.channelHostPhoto.list.setData(listInput, rows),
    onError: err => toast.error(err.message),
  });
  const setPrimary = trpc.channelHostPhoto.setPrimary.useMutation({
    onSuccess: () => utils.channelHostPhoto.list.invalidate(),
    onError: err => toast.error(err.message),
  });

  const rows = photos ?? [];
  // A channel with nothing ticked can only be one whose rows predate the tick column; the
  // server renders every photo there (`selectedHostPhotos`), and so does this view.
  const anyTicked = rows.some(p => p.isSelected);
  const chosen = rows.filter(p => !anyTicked || p.isSelected);
  const chosenIds = chosen.map(p => p.id);

  // Keep the parent's copy in step with the saved ticks — that copy rides on the generate call.
  useEffect(() => {
    if (!rows.length) return;
    if (
      chosenIds.length !== value.length ||
      chosenIds.some((id, i) => id !== value[i])
    )
      onChange(chosenIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenIds.join(",")]);

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

  const busy = setSelected.isPending || setPrimary.isPending;
  const locked = disabled || busy;

  const toggle = (id: number) => {
    if (locked) return;
    const on = chosenIds.includes(id);
    // A video with no host photo cannot render a host scene, so the last one can't be unticked.
    // The server refuses it too; this just spares the round trip.
    if (on && chosen.length === 1) {
      toast.error("At least one host photo must stay ticked.");
      return;
    }
    setSelected.mutate({ channelKey, id, selected: !on });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">Host photos</Label>
      <p className="text-[11px] text-muted-foreground">
        Which camera angles this channel&apos;s videos are shot from. The first
        is the primary — it opens the film and carries the split-screen scenes.
        The rest take turns with it, so every ticked photo is seen about as
        often. Ticks and the primary are saved to the channel, for everyone.
      </p>
      <div className="flex flex-wrap gap-2">
        {rows.map((p, i) => {
          const on = chosenIds.includes(p.id);
          // The film's primary is the first TICKED photo (`selectedHostPhotos`), which is the
          // library's first only while that one is ticked — label what will actually render.
          const isPrimary = chosen[0]?.id === p.id;
          return (
            <div
              key={p.id}
              className={`relative w-20 shrink-0 overflow-hidden rounded-md border text-left transition ${
                on
                  ? "border-primary ring-1 ring-primary"
                  : "border-border opacity-50 hover:opacity-80"
              } ${locked ? "opacity-60" : ""}`}
            >
              <button
                type="button"
                disabled={locked}
                onClick={() => toggle(p.id)}
                aria-pressed={on}
                aria-label={`${on ? "Untick" : "Tick"} ${isPrimary ? "primary" : `angle ${i + 1}`}`}
                className="block w-full disabled:cursor-default"
              >
                <img
                  src={p.imageUrl}
                  alt=""
                  className="h-20 w-20 object-cover"
                />
                {on && (
                  <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
              {isPrimary ? (
                <span className="flex items-center gap-0.5 px-1.5 py-1 text-[10px] font-medium text-foreground">
                  <Star className="h-2.5 w-2.5 fill-current" />
                  Primary
                </span>
              ) : (
                <div className="flex items-center justify-between px-1.5 py-1 text-[10px] text-muted-foreground">
                  <span className="truncate">Angle {i + 1}</span>
                  {/* Reorders the channel's library — the same "Make primary" Admin has — and
                      ticks the photo, since a primary that is not used makes no sense. */}
                  <button
                    type="button"
                    disabled={locked}
                    title="Make this the primary angle"
                    aria-label={`Make angle ${i + 1} the primary`}
                    onClick={() => {
                      if (locked) return;
                      setPrimary.mutate({ channelKey, id: p.id });
                    }}
                    className="rounded p-0.5 hover:bg-secondary hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Host plates are generated per look PER ANGLE, so the image cost of ticking another
          photo is visible here rather than discovered on the invoice. */}
      <p className="text-[11px] text-muted-foreground">
        {busy ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving to the channel…
          </span>
        ) : chosen.length === 1 ? (
          "1 angle — every host scene uses it, with no angle changes."
        ) : (
          `${chosen.length} angles — the host shots rotate through them; no two in a row repeat one.`
        )}
      </p>
      {hostMinutes != null && (
        <HostAngleGuideNote minutes={hostMinutes} angles={chosen.length} />
      )}
    </div>
  );
}

/**
 * The over-the-guide line under the photos: more angles ticked than the chosen host minutes can
 * carry (`hostAngleGuideWarning`). Renders nothing within the guide. Split out so the harness
 * can show it without a channel or a database.
 */
export function HostAngleGuideNote({
  minutes,
  angles,
}: {
  minutes: number;
  angles: number;
}) {
  const guide = hostAngleGuideWarning(minutes, angles);
  if (!guide) return null;
  return (
    <p
      role="status"
      data-testid="host-angle-guide"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300"
    >
      {guide}
    </p>
  );
}

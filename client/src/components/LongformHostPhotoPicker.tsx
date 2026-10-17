import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCanEditChannel } from "@/hooks/useMayEdit";
import { Label } from "@/components/ui/label";
import { hostAngleGuideWarning } from "@shared/hostMinutes";
import { Check, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { hostPhotoLookState, hostPhotoUrl, usablePhoneLook } from "@shared/hostPhotoLook";
import { HostPhotoTile } from "./HostPhotoTile";
import { HostPhotoPreview } from "./HostPhotoPreview";
import { StepIssue } from "./StepIssues";

/**
 * The ONE host photo this channel's videos are shot from (2026-10-15, the operator: "reduce to 1
 * photo per channel; the system should automatically pick the best image").
 *
 * The competitor review found every competitor keeps one host photo for the whole channel, while
 * ours rotated several "angles" in a video and changed them between videos. So a channel now uses
 * exactly one photo, chosen by the system (`server/hostPhotoChoice.ts`): every photo is scored for
 * a talking head — one clear face, size, light, sharpness, real (not airbrushed) skin and clearly
 * visible lips (`server/hostPhotoScore.ts`) — and the best is used. The score and what cost it
 * points are on each tile. Clicking another photo picks it by hand (saved on the channel, for
 * every operator and device) until "Pick automatically" hands the choice back. The other photos
 * stay in the library, unused; only the chosen photo gets a phone-look copy.
 *
 * Each tile shows the picture the video will actually use: the photo's PHONE LOOK by default
 * (shared/hostPhotoLook.ts), with a switch back to the original, saved on the channel. While a
 * phone look is being made or a photo scored, the list refreshes itself.
 */
export function LongformHostPhotoPicker({
  channelKey,
  value,
  onChange,
  disabled,
}: {
  channelKey: string;
  /** The chosen row id as last reported by `onChange` — what the generate call sends. */
  value: number[];
  onChange: (ids: number[]) => void;
  /** Kept for callers; a single photo has no angle guide to measure. */
  hostMinutes?: number;
  disabled?: boolean;
}) {
  const utils = trpc.useUtils();
  // The choice is the CHANNEL's, so a guest changes it only on a channel they created; on any
  // other the video uses the photo the channel already has.
  const canEdit = useCanEditChannel(channelKey);
  const listInput = { channelKey, activeOnly: true } as const;
  const { data: photos, isLoading } = trpc.channelHostPhoto.list.useQuery(listInput, {
    enabled: !!channelKey,
    // A phone look being made, or a photo being scored, lands in the background — look again.
    refetchInterval: q =>
      (q.state.data ?? []).some(
        p => (p.isSelected && hostPhotoLookState(p) === "making") || p.qualityScore == null
      )
        ? 5_000
        : false,
  });

  const setSelected = trpc.channelHostPhoto.setSelected.useMutation({
    // The server returns the channel's list after the write — take it as the truth.
    onSuccess: rows => utils.channelHostPhoto.list.setData(listInput, rows),
    onError: err => toast.error(err.message),
  });
  const autoPick = trpc.channelHostPhoto.autoPick.useMutation({
    onSuccess: rows => utils.channelHostPhoto.list.setData(listInput, rows),
    onError: err => toast.error(err.message),
  });
  const setLook = trpc.channelHostPhoto.setLook.useMutation({
    onSuccess: rows => utils.channelHostPhoto.list.setData(listInput, rows),
    onError: err => toast.error(err.message),
  });

  const rows = photos ?? [];
  // The photo open in the big preview — read from the live list so a switch inside it shows.
  const [previewId, setPreviewId] = useState<number | null>(null);
  const previewRow = rows.find(p => p.id === previewId) ?? null;
  // The channel's one photo: the ticked one (the server keeps exactly one), else the best scored.
  const chosen =
    rows.find(p => p.isSelected) ??
    [...rows].sort((a, b) => (b.qualityScore ?? -1) - (a.qualityScore ?? -1))[0];
  const chosenIds = chosen ? [chosen.id] : [];
  const byHand = !!chosen?.pickedByHand;

  // Keep the parent's copy in step with the saved choice — that copy rides on the generate call.
  useEffect(() => {
    if (!rows.length) return;
    if (chosenIds.length !== value.length || chosenIds.some((id, i) => id !== value[i]))
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
      <StepIssue tone="error">
        This channel has no host photos — add one under Channels, or host scenes
        cannot be rendered.
      </StepIssue>
    );

  const busy = setSelected.isPending || setLook.isPending || autoPick.isPending;
  const locked = disabled || busy || !canEdit;

  const choose = (id: number) => {
    if (locked || id === chosen?.id) return;
    setSelected.mutate({ channelKey, id, selected: true });
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">Host photo</Label>
      <p className="text-[11px] text-muted-foreground">
        Every video on this channel uses one host photo, so the host looks the
        same in every video. The system picks the best one — a clear face, good
        light, real-looking skin and lips you can see — and you can click
        another to use it instead. It is used in its phone look; switch to
        Original to use it as uploaded.
      </p>
      <div className="flex flex-wrap gap-2">
        {rows.map(p => {
          const on = p.id === chosen?.id;
          return (
            <HostPhotoTile
              key={p.id}
              imageUrl={hostPhotoUrl(p)}
              active={on}
              disabled={locked}
              onPictureClick={() => choose(p.id)}
              pressed={on}
              pictureLabel={on ? "The channel's host photo" : "Use this photo"}
              corner={
                on && (
                  <span className="block rounded-full bg-primary p-0.5 text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )
              }
              onPreview={() => setPreviewId(p.id)}
              label={<PhotoScoreLabel photo={p} inUse={on} byHand={on && byHand} />}
              lookState={hostPhotoLookState(p)}
              onLookChange={useOriginal => setLook.mutate({ channelKey, id: p.id, useOriginal })}
            />
          );
        })}
      </div>
      <HostPhotoPreview
        photo={
          previewRow
            ? {
                original: previewRow.imageUrl,
                phone: usablePhoneLook(previewRow),
                state: hostPhotoLookState(previewRow),
              }
            : null
        }
        title={previewRow && chosen?.id === previewRow.id ? "The channel's host photo" : "Host photo"}
        onOpenChange={open => !open && setPreviewId(null)}
        disabled={locked}
        onChange={useOriginal =>
          previewRow && setLook.mutate({ channelKey, id: previewRow.id, useOriginal })
        }
      />
      <p className="text-[11px] text-muted-foreground">
        {busy ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving to the channel…
          </span>
        ) : byHand ? (
          <>
            Chosen by hand.{" "}
            {canEdit && (
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => autoPick.mutate({ channelKey })}
              >
                Pick automatically
              </button>
            )}
          </>
        ) : rows.length > 1 ? (
          "Picked automatically — the best-scoring photo. Click another photo to use it instead."
        ) : (
          "The channel's only photo."
        )}
      </p>
      {!canEdit && (
        <p className="text-[11px] text-muted-foreground">
          View only. This is the channel&apos;s saved photo, and your video uses
          it. Your account can change only a channel it created.
        </p>
      )}
    </div>
  );
}

/** A tile's caption: "In use" or "Use this one", the photo's score and what cost it points. */
export function PhotoScoreLabel({
  photo,
  inUse,
  byHand,
}: {
  photo: { qualityScore?: number | null; qualityNotes?: string | null };
  inUse: boolean;
  byHand?: boolean;
}) {
  const score = photo.qualityScore;
  return (
    <div className="space-y-0.5" title={photo.qualityNotes ?? undefined}>
      <div className="flex items-center justify-between gap-1">
        <span
          className={
            inUse
              ? "flex items-center gap-0.5 font-medium text-foreground"
              : "text-muted-foreground"
          }
        >
          {inUse && <Star className="h-2.5 w-2.5 fill-current" />}
          {inUse ? (byHand ? "In use (chosen)" : "In use") : "Use this one"}
        </span>
        <span
          className={
            score == null
              ? "text-muted-foreground"
              : score >= 85
                ? "font-medium text-emerald-600 dark:text-emerald-400"
                : score >= 70
                  ? "font-medium text-amber-600 dark:text-amber-400"
                  : "font-medium text-red-600 dark:text-red-400"
          }
        >
          {score == null ? "Scoring…" : `${score}/100`}
        </span>
      </div>
      {photo.qualityNotes && (
        <div className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">
          {photo.qualityNotes.split("; ").slice(0, 2).join(" · ")}
        </div>
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

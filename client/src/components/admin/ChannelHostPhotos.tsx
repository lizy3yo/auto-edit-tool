import { useState } from "react";
import { Thumb } from "@/components/Thumb";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImageIcon, Loader2, Star, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { hostPhotoLookState, hostPhotoUrl, usablePhoneLook, phoneLookFailure } from "@shared/hostPhotoLook";
import { PhotoLookSwitch } from "../HostPhotoLookSwitch";
import { HostPhotoPreview } from "../HostPhotoPreview";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * A channel's HOST PHOTOS — the camera angles its videos can be shot from.
 *
 * Replaces the fixed pair of upload fields this panel used to carry. A channel holds as many
 * angles as it has and each video picks which of them it uses, so the library is a LIST rather
 * than two slots.
 *
 * Order is meaning, not decoration: the first row is the PRIMARY camera, and the pipeline pins
 * split-screen scenes and the locked cold open to it. That is why promotion is an explicit
 * "Make primary" action rather than drag-and-drop — the only position that changes behaviour is
 * the first one, so that is the only move worth offering.
 *
 * Like the books list, these rows are their own records and are written the moment you confirm —
 * Save Configuration covers the channel's own fields, not this list.
 */

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export function ChannelHostPhotos({ channelKey }: { channelKey: string }) {
  const { canRemove, canManageChannels } = useAuth();
  const utils = trpc.useUtils();
  const [draftUrl, setDraftUrl] = useState("");
  const [addConfirmOpen, setAddConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    id: number;
    position: number;
    imageUrl: string;
  } | null>(null);
  const [pendingPrimary, setPendingPrimary] = useState<{
    id: number;
    position: number;
    imageUrl: string;
  } | null>(null);

  const listInput = { channelKey, activeOnly: true } as const;
  const { data: photos, isLoading } = trpc.channelHostPhoto.list.useQuery(listInput, {
    enabled: !!channelKey,
    // A phone look being made lands in the background — look again until none is left.
    refetchInterval: q =>
      (q.state.data ?? []).some(p => hostPhotoLookState(p) === "making") ? 5_000 : false,
  });

  const invalidate = () => utils.channelHostPhoto.list.invalidate();

  const upload = trpc.styleReference.upload.useMutation({
    onSuccess: ({ url }) => setDraftUrl(url),
    onError: err => toast.error(err.message),
  });

  const save = trpc.channelHostPhoto.save.useMutation({
    onSuccess: () => {
      toast.success("Host photo added.");
      setDraftUrl("");
      setAddConfirmOpen(false);
      invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const remove = trpc.channelHostPhoto.deactivate.useMutation({
    onSuccess: () => {
      toast.success("Host photo removed — finished videos are unaffected.");
      setPendingDelete(null);
      invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const setPrimary = trpc.channelHostPhoto.setPrimary.useMutation({
    onSuccess: () => {
      toast.success("Primary camera angle updated.");
      setPendingPrimary(null);
      invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const setLook = trpc.channelHostPhoto.setLook.useMutation({
    onSuccess: rows => utils.channelHostPhoto.list.setData(listInput, rows),
    onError: err => toast.error(err.message),
  });
  // The channel's DEFAULT look: switches every photo here and is what a new photo starts on.
  const { data: defaultLook } = trpc.channelHostPhoto.defaultLook.useQuery(
    { channelKey },
    { enabled: !!channelKey }
  );
  const defaultOriginal = !!defaultLook?.useOriginal;
  const lookName = (useOriginal: boolean) => (useOriginal ? "the original" : "the phone look");
  const setChannelLook = trpc.channelHostPhoto.setChannelLook.useMutation({
    onSuccess: ({ photos: next }, { useOriginal }) => {
      utils.channelHostPhoto.list.setData(listInput, next);
      utils.channelHostPhoto.defaultLook.setData({ channelKey }, { useOriginal });
      toast.success(`This channel now uses ${lookName(useOriginal)} by default.`);
    },
    onError: err => toast.error(err.message),
  });
  const [allChannelsLook, setAllChannelsLookOpen] = useState(false);
  const setAllChannelsLook = trpc.channelHostPhoto.setAllChannelsLook.useMutation({
    onSuccess: ({ channels, skipped }, { useOriginal }) => {
      setAllChannelsLookOpen(false);
      utils.channelHostPhoto.list.invalidate();
      utils.channelHostPhoto.defaultLook.invalidate();
      toast.success(
        `${channels} channel${channels === 1 ? "" : "s"} now use ${lookName(useOriginal)} by default.` +
          (skipped ? ` ${skipped} you cannot change ${skipped === 1 ? "was" : "were"} left as they were.` : "")
      );
    },
    onError: err => toast.error(err.message),
  });

  const remake = trpc.channelHostPhoto.remakePhoneLook.useMutation({
    onSuccess: rows => {
      toast.success("Making a new phone look — it appears here in a minute.");
      utils.channelHostPhoto.list.setData(listInput, rows);
    },
    onError: err => toast.error(err.message),
  });

  const rows = photos ?? [];
  // The photo open in the big preview — read from the live list so a switch inside it shows.
  const [previewId, setPreviewId] = useState<number | null>(null);
  const previewRow = rows.find(p => p.id === previewId) ?? null;

  return (
    <div className="space-y-3">
      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          <User className="h-3.5 w-3.5" />
          Host Photos
        </Label>
      </div>

      {/* Default look — the same Phone / Original switch every photo has, for the whole channel. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-secondary/20 px-3 py-2">
        <span className="text-xs font-medium">Default look</span>
        <div className="w-40 [&>div]:mt-0">
          <PhotoLookSwitch
            state={defaultOriginal ? "original" : "phone"}
            disabled={!defaultLook || setChannelLook.isPending}
            onChange={useOriginal => setChannelLook.mutate({ channelKey, useOriginal })}
          />
        </div>
        <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
          Switches every photo on this channel, and photos added later start on it. Each
          photo can still be switched on its own below.
          {(() => {
            const own = rows.filter(p => p.useOriginal !== defaultOriginal).length;
            return defaultLook && own > 0
              ? ` ${own} photo${own === 1 ? " is" : "s are"} switched on ${own === 1 ? "its" : "their"} own.`
              : "";
          })()}
        </span>
        {canManageChannels && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-xs"
            disabled={!defaultLook}
            onClick={() => setAllChannelsLookOpen(true)}
          >
            Apply to all channels
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[11px] italic text-muted-foreground">
          No host photos yet. Add the first below — without one, host scenes
          cannot be rendered.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((p, i) => (
            <div key={p.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-start gap-3">
                {/* Both versions side by side: what was uploaded, and the phone look videos use
                    by default (shared/hostPhotoLook.ts). The one in use is outlined. */}
                <div className="flex shrink-0 gap-2">
                  {[
                    { label: "Original", url: p.imageUrl, used: hostPhotoUrl(p) === p.imageUrl },
                    { label: "Phone look", url: usablePhoneLook(p), used: !!usablePhoneLook(p) && hostPhotoUrl(p) === usablePhoneLook(p) },
                  ].map(v => (
                    <div key={v.label} className="w-24 space-y-0.5 text-center">
                      {v.url ? (
                        <button
                          type="button"
                          onClick={() => setPreviewId(p.id)}
                          title="Click to see it big"
                          aria-label={`Preview the ${v.label.toLowerCase()}`}
                          className="block cursor-zoom-in"
                        >
                          <img
                            src={v.url}
                            alt=""
                            className={`h-16 w-24 rounded border object-cover ${v.used ? "border-primary ring-1 ring-primary" : "border-border opacity-60"}`}
                          />
                        </button>
                      ) : (
                        <div className="flex h-16 w-24 items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground">
                          {hostPhotoLookState(p) === "making" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "—"}
                        </div>
                      )}
                      <span className="text-[10px] text-muted-foreground">{v.label}</span>
                    </div>
                  ))}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  {i === 0 ? (
                    <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
                      <Star className="h-3 w-3" />
                      Primary
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Angle {i + 1}
                    </span>
                  )}
                  {/* The tick lives on the generate form's picker and is saved to the channel;
                      shown here so a manager can see which angles the editors switched off. */}
                  {!p.isSelected && (
                    <span className="block text-[11px] italic text-muted-foreground">
                      Not used — unticked on the long-form page
                    </span>
                  )}
                  <div className="max-w-[12rem]">
                    <PhotoLookSwitch
                      state={hostPhotoLookState(p)}
                      disabled={setLook.isPending}
                      onChange={useOriginal => setLook.mutate({ channelKey, id: p.id, useOriginal })}
                    />
                  </div>
                  {phoneLookFailure(p) && (
                    <span className="block text-[10px] text-destructive" title={phoneLookFailure(p) ?? undefined}>
                      Phone look could not be made — the original is used.
                    </span>
                  )}
                  {(usablePhoneLook(p) || phoneLookFailure(p)) && (
                    <button
                      type="button"
                      disabled={remake.isPending}
                      onClick={() => remake.mutate({ channelKey, id: p.id })}
                      className="text-[11px] text-primary underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      Make phone look again
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {i !== 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        setPendingPrimary({
                          id: p.id,
                          position: i + 1,
                          imageUrl: p.imageUrl,
                        })
                      }
                    >
                      Make primary
                    </Button>
                  )}
                  {canRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label={
                        i === 0 ? "Remove primary angle" : `Remove angle ${i + 1}`
                      }
                      onClick={() =>
                        setPendingDelete({
                          id: p.id,
                          position: i + 1,
                          imageUrl: p.imageUrl,
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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
        title={previewId === rows[0]?.id ? "Primary host photo" : "Host photo"}
        onOpenChange={open => !open && setPreviewId(null)}
        disabled={setLook.isPending}
        onChange={useOriginal =>
          previewRow && setLook.mutate({ channelKey, id: previewRow.id, useOriginal })
        }
      />

      {/* Add — the upload lands in a draft so the angle can be named before it is written,
          the same shape as the books form below. */}
      <div className="space-y-2 rounded-md border border-dashed border-border p-3">
        <Label className="text-xs">Add a host photo</Label>
        {draftUrl ? (
          <div className="flex flex-wrap items-start gap-3">
            <img
              src={draftUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded border border-border object-cover"
            />
            <span className="min-w-0 flex-1 self-center text-xs text-muted-foreground">
              Will be added as{" "}
              {rows.length === 0
                ? "the primary angle"
                : `angle ${rows.length + 1}`}
            </span>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDraftUrl("")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={save.isPending}
                onClick={() => setAddConfirmOpen(true)}
              >
                Add photo
              </Button>
            </div>
          </div>
        ) : (
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-secondary/30 px-3 text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground">
            {upload.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
            {upload.isPending ? "Uploading…" : "Upload host photo"}
            <input
              type="file"
              accept={ACCEPTED.join(",")}
              className="hidden"
              disabled={upload.isPending}
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (!ACCEPTED.includes(file.type))
                  return toast.error("Use a JPG, PNG, or WEBP image.");
                if (file.size > 10 * 1024 * 1024)
                  return toast.error("Image must be under 10 MB");
                const reader = new FileReader();
                reader.onload = () =>
                  upload.mutate({ dataUrl: reader.result as string });
                reader.readAsDataURL(file);
              }}
            />
          </label>
        )}
      </div>

      <AlertDialog
        open={addConfirmOpen}
        onOpenChange={open => {
          if (!open && !save.isPending) setAddConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add this host photo?</AlertDialogTitle>
            <AlertDialogDescription>
              {rows.length === 0
                ? "This becomes the channel's primary camera angle."
                : `This is added as angle ${rows.length + 1}. It is written to the channel immediately.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-3 rounded-md border border-border p-3">
            {draftUrl && (
              <img
                src={draftUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded border border-border object-cover"
              />
            )}
            <span className="min-w-0 flex-1 truncate text-sm">
              {rows.length === 0 ? "Primary" : `Angle ${rows.length + 1}`}
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={save.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                save.mutate({ channelKey, imageUrl: draftUrl });
              }}
              disabled={save.isPending}
            >
              {save.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Add photo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={allChannelsLook}
        onOpenChange={open => {
          if (!open && !setAllChannelsLook.isPending) setAllChannelsLookOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Use {lookName(defaultOriginal)} on every channel?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every channel&apos;s default look becomes{" "}
              {defaultOriginal ? "Original" : "Phone"}, and every host photo on every channel
              switches to it — including photos switched on their own. Photos added later start
              on it. Videos already rendered are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setAllChannelsLook.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                setAllChannelsLook.mutate({ useOriginal: defaultOriginal });
              }}
              disabled={setAllChannelsLook.isPending}
            >
              {setAllChannelsLook.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Apply to all channels
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingPrimary !== null}
        onOpenChange={open => {
          if (!open && !setPrimary.isPending) setPendingPrimary(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make this the primary angle?</AlertDialogTitle>
            <AlertDialogDescription>
              Split-screen scenes and the opening shot of every future video on
              this channel will use it. Videos already rendered are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-3 rounded-md border border-border p-3">
            {pendingPrimary && (
              <img
                src={pendingPrimary.imageUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded border border-border object-cover"
              />
            )}
            <span className="min-w-0 flex-1 truncate text-sm">
              {pendingPrimary ? `Angle ${pendingPrimary.position}` : ""}
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setPrimary.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                if (pendingPrimary)
                  setPrimary.mutate({ channelKey, id: pendingPrimary.id });
              }}
              disabled={setPrimary.isPending}
            >
              {setPrimary.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Make primary
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open && !remove.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this host photo?</AlertDialogTitle>
            <AlertDialogDescription>
              It can no longer be used in new videos. Videos that already used
              it are unaffected.
              {pendingDelete?.position === 1 && rows.length > 1
                ? " This is the primary angle — the next one in the list takes over as primary."
                : ""}
              {rows.length === 1
                ? " This is the channel's only host photo; without one, host scenes cannot be rendered."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-3 rounded-md border border-border p-3">
            {pendingDelete && (
              <img
                src={pendingDelete.imageUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded border border-border object-cover"
              />
            )}
            <span className="min-w-0 flex-1 truncate text-sm">
              {pendingDelete?.position === 1
                ? "Primary"
                : pendingDelete
                  ? `Angle ${pendingDelete.position}`
                  : ""}
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                if (pendingDelete) remove.mutate({ id: pendingDelete.id });
              }}
              disabled={remove.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {remove.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

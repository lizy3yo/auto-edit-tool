import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import {
  HOST_PHOTO_LOOK_LABEL,
  type HostPhotoLookState,
} from "@shared/hostPhotoLook";
import { PhotoLookSwitch } from "./HostPhotoLookSwitch";

/** One host photo as the preview needs it: both versions and where its look stands. */
export interface PreviewPhoto {
  original: string;
  phone?: string | null;
  state: HostPhotoLookState;
}

/**
 * The big side-by-side view of a host photo — its ORIGINAL and its PHONE LOOK
 * (shared/hostPhotoLook.ts) — so the two can be judged at a size where the face and the room
 * actually show, instead of on an 80-pixel tile. The one videos use is outlined, and the same
 * Phone / Original switch as the tile sits under them; clicking a version picks it too. One
 * component for the generate form's picker, Admin and the HeyGen test, so it looks and works the
 * same everywhere.
 */
export function HostPhotoPreview({
  photo,
  title,
  onOpenChange,
  onChange,
  disabled,
}: {
  /** The photo to show; null closes the preview. */
  photo: PreviewPhoto | null;
  title?: string;
  onOpenChange: (open: boolean) => void;
  /** Switch the photo's look — omitted where the look cannot be changed. */
  onChange?: (useOriginal: boolean) => void;
  disabled?: boolean;
}) {
  const inUse = photo?.state === "phone" ? "phone" : "original";
  const pane = (which: "original" | "phone", url: string | null | undefined) => {
    const used = inUse === which;
    const label = which === "phone" ? "Phone look" : "Original";
    const pickable = !!url && !!onChange && !disabled && !used;
    return (
      <figure className="min-w-0 flex-1 space-y-1.5">
        <button
          type="button"
          disabled={!pickable}
          onClick={() => onChange?.(which === "original")}
          aria-label={pickable ? `Use the ${label.toLowerCase()}` : label}
          className={`block w-full overflow-hidden rounded-md border-2 ${used ? "border-primary" : "border-border"} ${pickable ? "cursor-pointer hover:border-primary/60" : "cursor-default"}`}
        >
          {url ? (
            <img src={url} alt={label} className="aspect-video w-full bg-muted object-contain" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground">
              {photo?.state === "making" ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" /> Making phone look…
                </span>
              ) : (
                "No phone look"
              )}
            </div>
          )}
        </button>
        <figcaption className="flex items-center justify-between text-xs">
          <span className="font-medium">{label}</span>
          {used && <span className="text-primary">Used in videos</span>}
        </figcaption>
      </figure>
    );
  };
  return (
    <Dialog open={!!photo} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        {photo && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">{title ?? "Host photo"}</DialogTitle>
              <DialogDescription>
                The original as uploaded, and the phone look made from it. The outlined one is
                what videos use — {HOST_PHOTO_LOOK_LABEL[photo.state].toLowerCase()}.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 sm:flex-row">
              {pane("original", photo.original)}
              {pane("phone", photo.phone)}
            </div>
            {onChange && (
              <div className="mx-auto w-full max-w-xs">
                <PhotoLookSwitch state={photo.state} disabled={disabled} onChange={onChange} />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The big view of a host photo, so it can be judged at a size where the face and the room
 * actually show, instead of on an 80-pixel tile. One component for the generate form's picker,
 * Admin, the HeyGen test and the Upsell VSL, so it looks and works the same everywhere.
 */
export function HostPhotoPreview({
  imageUrl,
  title,
  onOpenChange,
}: {
  /** The photo to show; null closes the preview. */
  imageUrl: string | null;
  title?: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!imageUrl} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {imageUrl && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">{title ?? "Host photo"}</DialogTitle>
              <DialogDescription>
                The photo as uploaded. This is what videos use.
              </DialogDescription>
            </DialogHeader>
            <img
              src={imageUrl}
              alt={title ?? "Host photo"}
              className="aspect-video w-full rounded-md border border-border bg-muted object-contain"
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

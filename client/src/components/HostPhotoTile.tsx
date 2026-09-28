import type { ReactNode } from "react";
import { Loader2, ZoomIn } from "lucide-react";
import type { HostPhotoLookState } from "@shared/hostPhotoLook";
import { PhotoLookSwitch } from "./HostPhotoLookSwitch";

/**
 * One host photo as a tile — the SAME tile on the generate form's picker and the HeyGen test, so
 * the two read as one tool and cannot drift apart. The picture is the one videos use (its phone
 * look by default, shared/hostPhotoLook.ts); the magnifier opens the big side-by-side preview
 * (`HostPhotoPreview`); the Phone / Original switch sits under the label. What differs between
 * the pages is passed in: the corner badge (a tick, or a remove button), what clicking the
 * picture does (tick it, or open the preview), and the label row.
 */
export function HostPhotoTile({
  imageUrl,
  active = true,
  corner,
  onPictureClick,
  pressed,
  pictureLabel,
  onPreview,
  label,
  lookState,
  onLookChange,
  disabled,
}: {
  /** The picture shown — what videos use. */
  imageUrl: string;
  /** Outlined and full strength when true (a ticked photo, or any photo in a test run). */
  active?: boolean;
  /** The top-right badge: a tick on the picker, a remove button on the test. */
  corner?: ReactNode;
  /** What clicking the picture does; without it the picture opens the preview. */
  onPictureClick?: () => void;
  /** The picture's toggle state, for screen readers (the picker's tick). */
  pressed?: boolean;
  /** Screen-reader name for the picture's click. */
  pictureLabel: string;
  onPreview: () => void;
  /** The row under the picture: "★ Primary" / "Angle 2", or "Photo 1 · Upload". */
  label: ReactNode;
  lookState: HostPhotoLookState;
  onLookChange: (useOriginal: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`relative w-24 shrink-0 overflow-hidden rounded-md border text-left transition ${
        active ? "border-primary ring-1 ring-primary" : "border-border opacity-50 hover:opacity-80"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        disabled={disabled && !!onPictureClick}
        onClick={onPictureClick ?? onPreview}
        aria-pressed={pressed}
        aria-label={pictureLabel}
        className={`block w-full disabled:cursor-default ${onPictureClick ? "" : "cursor-zoom-in"}`}
      >
        <img src={imageUrl} alt="" className="h-20 w-24 object-cover" />
        {lookState === "making" && (
          <span className="absolute inset-x-0 top-0 flex h-20 items-center justify-center bg-background/50">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
      </button>
      {corner && <div className="absolute right-1 top-1">{corner}</div>}
      <button
        type="button"
        onClick={onPreview}
        title="See it big — the original and the phone look"
        aria-label={`Preview — ${pictureLabel}`}
        className="absolute left-1 top-1 rounded-full bg-background/80 p-0.5 text-foreground hover:bg-background"
      >
        <ZoomIn className="h-3 w-3" />
      </button>
      <div className="px-1.5 py-1 text-[10px]">{label}</div>
      <div className="px-1 pb-1">
        <PhotoLookSwitch state={lookState} disabled={disabled} onChange={onLookChange} />
      </div>
    </div>
  );
}

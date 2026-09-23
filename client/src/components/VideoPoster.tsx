import { useRef, useState } from "react";
import { Loader2, Film } from "lucide-react";
import { captureFrame, releaseOnUnmount } from "@/lib/mediaLifecycle";

/** Canvas width for the captured still — enough for the library's largest card on HiDPI. */
const POSTER_STILL_W = 640;

/**
 * Thumbnail for one render.
 *
 * There is no poster image to show: nothing in the pipeline writes a still per film, and
 * generating one would mean an ffmpeg pass plus an R2 object on every assembly — and would
 * only ever cover *new* renders, leaving the existing library grey. So the thumbnail is the
 * video itself, with `preload="metadata"`, which fetches headers and the first frame and
 * stops. No autoplay, no audio, no full download.
 *
 * The source is the first scene's clip where available (it exists long before assembly
 * finishes, so an in-flight render still previews), falling back to the finished film.
 *
 * Once the first frame is decoded it is copied onto a canvas and the `<video>` is removed and
 * released: a player kept alive to show one still holds a hardware decoder and GPU memory, and
 * enough of them on one page black the tab out (see `lib/mediaLifecycle.ts`).
 */
export function VideoPoster({
  posterUrl,
  finalVideoUrl,
  status,
  className = "",
}: {
  posterUrl: string | null;
  finalVideoUrl: string | null;
  status: "processing" | "completed" | "failed";
  className?: string;
}) {
  const src = posterUrl ?? finalVideoUrl;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The source the canvas currently holds a frame of — a new source shows its video again. */
  const [capturedSrc, setCapturedSrc] = useState<string | null>(null);
  const captured = !!src && capturedSrc === src;

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-secondary/60 ${className}`}
      >
        {status === "processing" ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Film className="h-5 w-5 text-muted-foreground/50" />
        )}
      </div>
    );
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className={`bg-secondary/60 object-cover ${className} ${captured ? "" : "hidden"}`}
      />
      {!captured && (
        <video
          ref={releaseOnUnmount}
          src={src}
          // `metadata` is the whole trick — enough for a first frame, not the file.
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          className={`bg-secondary/60 object-cover ${className}`}
          // `loadeddata` is too early to copy: Chrome reports a current frame before it has one
          // it will draw. A small seek forces a real decode (the `SceneStripThumb` trick), and
          // `seeked` is the moment it is on the element.
          onLoadedMetadata={e => {
            try {
              e.currentTarget.currentTime = 0.05;
            } catch {
              // Not seekable: the video just stays, as before.
            }
          }}
          // Keep the frame, drop the player. If the copy fails the video simply stays, as before.
          onSeeked={e => {
            if (
              canvasRef.current &&
              captureFrame(e.currentTarget, canvasRef.current, POSTER_STILL_W)
            )
              setCapturedSrc(src);
          }}
        />
      )}
    </>
  );
}

import { Loader2, Film } from "lucide-react";

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
    <video
      src={src}
      // `metadata` is the whole trick — enough for a first frame, not the file.
      preload="metadata"
      muted
      playsInline
      tabIndex={-1}
      className={`bg-secondary/60 object-cover ${className}`}
    />
  );
}

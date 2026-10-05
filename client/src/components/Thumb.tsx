import { useState, type ImgHTMLAttributes } from "react";
import { thumbSrc } from "@/lib/thumb";

/**
 * A small `<img>` of a stored picture: the server's light copy, and the picture itself if that
 * cannot be had. For tiles and list rows only — anything opened big shows the original.
 */
export function Thumb({
  src,
  width = 320,
  ...img
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width"> & {
  src: string;
  /** The served width; pick the first at or above twice the tile's CSS width. */
  width?: 160 | 320 | 640;
}) {
  /** The source whose light copy failed — a new `src` gets its own try. */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const light = thumbSrc(src, width);
  const showOriginal = failedSrc === src || light === src;
  return (
    <img
      {...img}
      src={showOriginal ? src : light}
      loading="lazy"
      decoding="async"
      onError={e => {
        if (!showOriginal) setFailedSrc(src);
        else img.onError?.(e);
      }}
    />
  );
}

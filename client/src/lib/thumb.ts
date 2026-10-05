/**
 * The address of a small server-made picture of a stored file (`server/thumbs.ts`) — a frame
 * of a clip at `atSec`, or a photo scaled down. Anything that is not a stored https file (a
 * just-picked upload's `data:`/`blob:` address) is returned as it is.
 *
 * The server answers 404 when it cannot make one; every caller then loads the file itself,
 * exactly as it did before this existed.
 */
export function thumbSrc(
  url: string,
  width: 160 | 320 | 640,
  atSec = 0
): string {
  if (!/^https:\/\//i.test(url)) return url;
  const t = atSec > 0 ? `&t=${Math.round(atSec * 10) / 10}` : "";
  return `/api/thumb?url=${encodeURIComponent(url)}&w=${width}${t}`;
}

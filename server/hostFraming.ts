/**
 * A host clip zoomed in to a close framing — "Clean host clips" only.
 *
 * Until 2026-10-05 a video's host was lip-synced from a "phone look" COPY of each library photo:
 * the same person and room, redrawn by an image model from a step further back. Videos made then
 * show the host small in the frame (more table, the apron's bib), and the redrawn copy is where a
 * stamped corner mark came from. Photos are used as uploaded now, so new videos have neither —
 * but the older ones keep the clips they were rendered with.
 *
 * The repair is a plain zoom, the same for every clip: `HOST_CLEAN_ZOOM` (1.4×), centred, from
 * the top of the frame. Measured on a real clip the host was 71% of the size in the uploaded
 * photo, so 1.4× brings the face back to the photo's size; the lower-right of the wide frame,
 * mark included, is simply out of the picture. One fixed crop means every host scene of a film
 * is framed alike — a crop worked out clip by clip moved the room a little from scene to scene.
 *
 * A first version matched each clip to the channel's photos to decide the zoom. On the hosted
 * app it changed nothing and could not say why, and the operator asked for the zoom itself.
 * What is left of that is one guard: a clip whose host is ALREADY close is not zoomed, so a
 * second click, or a click on a newer video, cannot push the face out of the frame.
 *
 * Deliberately not run on clips as they arrive: it is a repair for a video the operator picks.
 * Never throws: any failure keeps the clip as it was.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { execFfmpeg } from "./ffmpegSpawn";
import { detectFaces } from "./pico";

const zoomSetting = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 1 && v <= 2 ? v : fallback;
};

/** How far a wide host clip is zoomed in. `HOST_CLEAN_ZOOM` overrides it, held to 1..2. */
export const hostCleanZoom = (): number => zoomSetting("HOST_CLEAN_ZOOM", 1.4);

/**
 * How far the host of a SPLIT SCREEN is zoomed in (`HOST_CLEAN_ZOOM_SPLIT`). Gentler, at the
 * operator's call: the host's half of a split is narrow, so the full 1.4× left the face filling
 * most of it.
 */
export const hostCleanZoomSplit = (): number =>
  zoomSetting("HOST_CLEAN_ZOOM_SPLIT", 1.2);

/**
 * A face this tall — its box as a share of the frame's height — is a host already framed close.
 * Measured: 0.47 in an uploaded photo and 0.49 in a zoomed clip, against 0.32-0.36 in a wide one.
 */
export const CLOSE_FACE = 0.42;

/** Width a frame is read at to find the face. */
const FACE_W = 480;

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The part of a `frameW × frameH` clip kept by a `zoom`: the frame's own shape, `1/zoom` of its
 * size, centred left to right and taken from the TOP — a host drawn from a step back has the
 * extra picture below, so the top keeps the head where it was. Even pixels. Null when the zoom
 * would change nothing. Pure.
 */
export function zoomCrop(
  frameW: number,
  frameH: number,
  zoom: number
): Crop | null {
  if (!(zoom > 1.001)) return null;
  const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2);
  const w = even(frameW / zoom);
  const h = even(frameH / zoom);
  return { x: Math.floor((frameW - w) / 4) * 2, y: 0, w, h };
}

/** Enlarged back to the frame's size, with the sharpening an upscaled host clip gets. Pure. */
export const framingFilter = (
  crop: Crop,
  frameW: number,
  frameH: number
): string =>
  `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` +
  `scale=${frameW}:${frameH}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,setsar=1`;

/**
 * Should a clip be zoomed, given how tall its host's face is in the frame? A close face is left
 * alone. No face found is zoomed: the operator asked for the zoom, and a host clip the finder
 * cannot read is far likelier a wide one than a close one. Pure.
 */
export function shouldZoom(faceShare: number | null): boolean {
  return faceShare == null || faceShare < CLOSE_FACE;
}

/** How one clip's zoom went: zoomed, already close, or it could not run. */
export type FramingOutcome = "framed" | "already" | "failed";

/** The host's face height in a frame, as a share of the frame's height; null when none is found. */
async function faceShareOf(png: Buffer): Promise<number | null> {
  const { data, info } = await sharp(png)
    .resize({ width: FACE_W })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bytes = new Uint8Array(info.width * info.height);
  for (let i = 0; i < bytes.length; i++) bytes[i] = data[i * info.channels];
  const face = detectFaces(bytes, info.width, info.height)[0];
  return face ? face.size / info.height : null;
}

/**
 * The clip zoomed in to a close framing, or the SAME buffer when its host is already close or on
 * any failure. `label` names the clip in the log; `onOutcome` is told how it went.
 */
export async function zoomHostClip(
  clip: Buffer,
  label = "host clip",
  onOutcome?: (outcome: FramingOutcome) => void,
  /** How far to zoom; a split screen's host passes the gentler `hostCleanZoomSplit()`. */
  zoom: number = hostCleanZoom()
): Promise<Buffer> {
  if (process.env.HOST_CLEAN_ZOOM === "0") return clip;
  const dir = await mkdtemp(path.join(tmpdir(), "host-framing-"));
  try {
    const src = path.join(dir, "in.mp4");
    await writeFile(src, clip);
    const still = path.join(dir, "first.png");
    await execFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-frames:v", "1", still],
      { maxBuffer: 1 << 26 }
    );
    const png = await readFile(still);
    const meta = await sharp(png).metadata();
    if (!meta.width || !meta.height) throw new Error("frame has no size");
    const faceShare = await faceShareOf(png).catch(() => null);
    if (!shouldZoom(faceShare)) {
      console.log(
        `[HostFraming] ${label}: host already close (face ${Math.round((faceShare as number) * 100)}% of the frame's height) — not zoomed`
      );
      onOutcome?.("already");
      return clip;
    }
    const crop = zoomCrop(meta.width, meta.height, zoom);
    if (!crop) {
      onOutcome?.("already");
      return clip;
    }
    const out = path.join(dir, "out.mp4");
    await execFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf",
        framingFilter(crop, meta.width, meta.height),
        "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", out],
      { maxBuffer: 1 << 26 }
    );
    console.log(
      `[HostFraming] ${label}: zoomed ${zoom}× ` +
        `(face was ${faceShare == null ? "not found" : `${Math.round(faceShare * 100)}% of the frame's height`})`
    );
    const zoomed = await readFile(out);
    onOutcome?.("framed");
    return zoomed;
  } catch (err: any) {
    console.warn(
      `[HostFraming] ${label}: kept as it was — ${err?.message ?? err}`
    );
    onOutcome?.("failed");
    return clip;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

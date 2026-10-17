// Renders one motion graphic with Remotion, from the shared templates in `graphics/` (the same
// code the lab renders). The templates are bundled once per process (webpack, ~10-20 s) and the
// headless Chrome Remotion drives is fetched once (~100 MB) the first time — the single-process
// server keeps both for its life.
//
// CARDS → H.264 MP4 (opaque, yuv420p, CRF 16 — visually lossless for flat graphics). OVERLAYS →
// ProRes 4444 with alpha (yuva444p10le), the broadcast-standard intermediate for keyed graphics,
// which ffmpeg composites natively.
//
// LICENCE: Remotion is free for individuals, companies of up to 3 employees and evaluation; a
// for-profit company with more than 3 needs a company licence (remotion.pro/license) before
// production use.
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { templateById } from "../../graphics/src/registry";

/** The shared templates (`graphics/` at the repo root; GRAPHICS_DIR overrides). */
export const GRAPHICS_DIR = process.env.GRAPHICS_DIR ?? path.resolve(process.cwd(), "graphics");

let bundled: Promise<string> | null = null;

function getBundle(): Promise<string> {
  bundled ??= (async () => {
    await ensureBrowser();
    return bundle({ entryPoint: path.join(GRAPHICS_DIR, "src", "index.ts"), publicDir: path.join(GRAPHICS_DIR, "public") });
  })().catch(e => {
    bundled = null; // a failed bundle is tried again next time, not remembered
    throw e;
  });
  return bundled;
}

/** GPU path for Chrome: ANGLE on Windows (as the lab measured), SwANGLE elsewhere (a server with no
 * GPU). `GRAPHICS_GL` overrides. */
const CHROMIUM = {
  gl: (process.env.GRAPHICS_GL ?? (process.platform === "win32" ? "angle" : "swangle")) as "angle" | "swangle",
};

/** Frames rendered in parallel per graphic (tabs of the one Chrome). */
const CONCURRENCY = Number(process.env.GRAPHICS_RENDER_CONCURRENCY ?? 4);

export async function renderGraphic(id: string, props: Record<string, unknown>, output: string): Promise<{ ms: number; frames: number }> {
  const serveUrl = await getBundle();
  const def = templateById(id);
  // Remotion MERGES a composition's default props under the ones passed in, so a setting a cue
  // leaves out would show the Studio's sample text. Every default the cue does not set is sent as
  // null (the templates' Root turns null back into "not set").
  const inputProps = { ...Object.fromEntries(Object.keys(def.defaultProps).map(k => [k, null])), ...props };
  const composition = await selectComposition({ serveUrl, id, inputProps, chromiumOptions: CHROMIUM });
  const t0 = Date.now();
  if (def.kind === "card") {
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "h264",
      crf: 16,
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: 95,
      outputLocation: output,
      concurrency: CONCURRENCY,
      chromiumOptions: CHROMIUM,
      overwrite: true,
    });
  } else {
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "prores",
      proResProfile: "4444",
      pixelFormat: "yuva444p10le",
      imageFormat: "png",
      outputLocation: output,
      concurrency: CONCURRENCY,
      chromiumOptions: CHROMIUM,
      overwrite: true,
    });
  }
  return { ms: Date.now() - t0, frames: composition.durationInFrames };
}

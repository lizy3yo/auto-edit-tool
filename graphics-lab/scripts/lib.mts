// Shared helpers for the render / composite / bench scripts.
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderStill,
  selectComposition,
  ensureBrowser,
} from "@remotion/renderer";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { templateById } from "../src/registry.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(ROOT, "out");

export function outDir(...parts: string[]): string {
  const d = path.join(OUT, ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

/**
 * ffmpeg for compositing: FFMPEG_PATH, else the main app's own ffmpeg-static binary (read only —
 * the lab installs no ffmpeg of its own, so the composite runs on the SAME build assembly uses).
 */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const req = createRequire(path.join(ROOT, "..", "package.json"));
  const p = req("ffmpeg-static") as string;
  if (!existsSync(p)) throw new Error(`ffmpeg not found at ${p}; set FFMPEG_PATH`);
  return p;
}

export function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let err = "";
    let out = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (err += d));
    p.on("error", reject);
    p.on("close", code =>
      code === 0 ? resolve(out + err) : reject(new Error(`${path.basename(bin)} exited ${code}: ${err.slice(-1500)}`))
    );
  });
}

let bundled: Promise<string> | null = null;

/** Bundle the Remotion project once per process (webpack, ~10-20 s). */
export function getBundle(): Promise<string> {
  bundled ??= (async () => {
    await ensureBrowser();
    return bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), publicDir: path.join(ROOT, "public") });
  })();
  return bundled;
}

const CHROMIUM = { gl: "angle" as const };

export type RenderJob = { id: string; props: Record<string, unknown>; output: string };

/**
 * Render one graphic. CARDS → H.264 MP4 (opaque, yuv420p, CRF 16 — visually lossless for flat
 * graphics). OVERLAYS → ProRes 4444 with alpha (yuva444p10le), the broadcast-standard
 * intermediate for keyed graphics, which ffmpeg composites natively.
 */
export async function renderGraphic(job: RenderJob, opts: { concurrency?: number } = {}): Promise<{ ms: number; frames: number }> {
  const serveUrl = await getBundle();
  const def = templateById(job.id);
  // Remotion MERGES a composition's default props under the ones passed in, so a setting a cue
  // leaves out would show the Studio's sample text (job 383: a VS card with no kicker showed
  // "First thing on the label"). Every default the cue does not set is sent as null.
  job = { ...job, props: { ...Object.fromEntries(Object.keys(def.defaultProps).map(k => [k, null])), ...job.props } };
  const composition = await selectComposition({ serveUrl, id: job.id, inputProps: job.props, chromiumOptions: CHROMIUM });
  const t0 = Date.now();
  if (def.kind === "card") {
    await renderMedia({
      serveUrl,
      composition,
      inputProps: job.props,
      codec: "h264",
      crf: 16,
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: 95,
      outputLocation: job.output,
      concurrency: opts.concurrency ?? 4,
      chromiumOptions: CHROMIUM,
      overwrite: true,
    });
  } else {
    await renderMedia({
      serveUrl,
      composition,
      inputProps: job.props,
      codec: "prores",
      proResProfile: "4444",
      pixelFormat: "yuva444p10le",
      imageFormat: "png",
      outputLocation: job.output,
      concurrency: opts.concurrency ?? 4,
      chromiumOptions: CHROMIUM,
      overwrite: true,
    });
  }
  return { ms: Date.now() - t0, frames: composition.durationInFrames };
}

/** One frame as a PNG (transparent for overlays). */
export async function renderFrame(id: string, props: Record<string, unknown>, frame: number, output: string): Promise<void> {
  const serveUrl = await getBundle();
  const composition = await selectComposition({ serveUrl, id, inputProps: props, chromiumOptions: CHROMIUM });
  await renderStill({
    serveUrl,
    composition,
    inputProps: props,
    frame: Math.min(frame, composition.durationInFrames - 1),
    output,
    imageFormat: "png",
    chromiumOptions: CHROMIUM,
    overwrite: true,
  });
}

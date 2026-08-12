import path from "path";
import { readFileSync } from "fs";
import { runFfmpeg, downloadToTemp, dimensionsFor } from "./videoAssembly";
import { ECHOMIMIC_SIZE } from "./providers/echomimic-lipsync";

/**
 * ── The 768 → 1080p framing problem ──────────────────────────────────────────────────────
 *
 * EchoMimicV3 renders a SQUARE frame and tops out at 768×768. It cannot produce 16:9 and it
 * cannot produce 1080p. Cropping its output to 16:9 gives 768×432 — below 720p — which then
 * needs a 2.5× upscale onto the 1920×1080 assembly canvas. That is a visibly soft host on the
 * one shot viewers look at hardest.
 *
 * The way out is to stop asking the model for the whole frame. 768 ÷ 1080 = 71%, so as long as
 * the host occupies at most 71% of the frame HEIGHT, the square is placed at native resolution
 * and **nothing is upscaled at all**. The rest of the 16:9 frame is a separately generated
 * contextual plate — which is also how the per-scene backgrounds get built.
 *
 * Two layouts, both of which deliver a true 1920×1080 frame:
 *
 *   PANEL (default, safe)          INSET (better, needs a look first)
 *   ┌──────────┬──────────┐        ┌─────────────────────────┐
 *   │  host    │ context  │        │  plate (context)        │
 *   │  square  │  still   │        │      ┌────────┐         │
 *   │  768²    │  KenBurn │        │      │ host   │         │
 *   └──────────┴──────────┘        │      │ 768²   │         │
 *                                  └──────┴────────┴─────────┘
 *
 * PANEL has a hard edge between the two halves, which reads as an intentional design choice —
 * so there is no seam to hide. It reuses the split-screen shape this pipeline already ships.
 *
 * INSET composites the animated square back into the exact rectangle it was cropped from, so
 * the background lines up by construction. The catch: EchoMimicV3 regenerates every pixel of
 * the square, so its background drifts slightly from the static plate and the box edge can
 * show. `featherPx` cross-fades that boundary. Drift is small on low-motion host shots (the
 * same reason HeyGen is pinned to `expressiveness: "low"`), but it is a real risk and the
 * reason PANEL is the default.
 */

/** Where the host square sits inside the 1920×1080 plate. Origin is top-left. */
export interface HostBox {
  x: number;
  y: number;
  size: number;
}

/**
 * FALLBACK crop box, used only when RetinaFace finds no face in the plate.
 *
 * The worker normally detects the host and returns the box it actually cut from, which is then
 * what the compose uses — so the two directions of the round trip agree by construction rather
 * than by both trusting the same guess. This fixed rectangle is the floor for when detection
 * fails: bottom-aligned, because a seated host's head sits near the top of their bounding box
 * and their torso runs to the frame bottom, matching what `hostPlatePrompt` asks for.
 */
export function hostBoxFor(
  align: "left" | "center" | "right" = "left",
  size: number = ECHOMIMIC_SIZE,
  canvas = dimensionsFor("16:9")
): HostBox {
  const y = Math.max(0, canvas.height - size); // bottom-aligned
  const margin = Math.round(canvas.width * 0.06);
  const x =
    align === "left"
      ? margin
      : align === "right"
        ? Math.max(0, canvas.width - size - margin)
        : Math.round((canvas.width - size) / 2);
  return { x, y, size };
}

/**
 * Prompt fragment that makes the image model place the host where `hostBoxFor` will cut.
 *
 * This is the load-bearing half of the INSET layout: there is no face detection anywhere in
 * this pipeline, so the crop box is FIXED and the composition has to come to it. Asking for a
 * specific placement in words is cheaper and more predictable than detecting one after the
 * fact — and if the model misses, the failure is a badly framed host rather than a crash.
 */
export function hostPlatePrompt(
  context: string,
  align: "left" | "center" | "right" = "left"
): string {
  const side =
    align === "center"
      ? "centred in the frame"
      : `on the ${align} side of the frame`;
  return (
    `Cinematic 16:9 photograph. The host is seated ${side}, shown from the waist up, ` +
    `facing the camera directly, occupying roughly the lower two-thirds of the frame height. ` +
    `Behind and beside them: ${context}. Even, soft lighting on the host's face. ` +
    `The host must be fully inside their side of the frame with clear space around the head — ` +
    `do not crop the head or shoulders.`
  );
}

/**
 * INSET: composite the animated square back into the hole it came from.
 *
 * The plate is a still, so it becomes a static background for the clip's whole duration
 * (`-loop 1` + `-shortest`). `featherPx` builds a soft-edged alpha mask via `geq` so the
 * boundary cross-fades instead of showing a hard rectangle where the model's regenerated
 * background disagrees with the plate.
 */
export function buildInsetArgs(opts: {
  platePath: string;
  hostClipPath: string;
  outputPath: string;
  box: HostBox;
  width: number;
  height: number;
  fps?: number;
  featherPx?: number;
}): string[] {
  const fps = opts.fps ?? 25;
  const f = Math.max(0, opts.featherPx ?? 24);
  const s = opts.box.size;

  // Alpha ramps 0→1 over `f` px on every edge; 1 everywhere inside. With f=0 the mask is
  // solid and this degenerates to a plain overlay.
  const mask =
    f > 0
      ? `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':` +
        `a='255*min(1,min(min(X,${s}-1-X),min(Y,${s}-1-Y))/${f})'`
      : "";

  const filter =
    `[0:v]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase,` +
    `crop=${opts.width}:${opts.height},setsar=1,fps=${fps}[plate];` +
    `[1:v]scale=${s}:${s},setsar=1,fps=${fps}${mask}[host];` +
    `[plate][host]overlay=${opts.box.x}:${opts.box.y}:format=auto,` +
    `format=yuv420p[v]`;

  return [
    "-y",
    "-loop",
    "1",
    "-i",
    opts.platePath,
    "-i",
    opts.hostClipPath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "1:a?", // the model's output carries the narration; keep it if present
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    opts.outputPath,
  ];
}

/**
 * PANEL: host square on one side at native resolution, contextual still filling the other.
 *
 * The square is placed 1:1 with no scaling — that is the whole point of this layout — and the
 * context image is cropped to whatever width is left. At 1920×1080 with a 768 square that
 * leaves 1152px of context, and the host is pillarboxed vertically against a blurred copy of
 * itself so there is no dead black band.
 */
export function buildPanelArgs(opts: {
  contextPath: string;
  hostClipPath: string;
  outputPath: string;
  width: number;
  height: number;
  size: number;
  hostSide?: "left" | "right";
  fps?: number;
}): string[] {
  const fps = opts.fps ?? 25;
  const s = opts.size;
  const ctxW = opts.width - s;
  const hostX = opts.hostSide === "right" ? ctxW : 0;
  const ctxX = opts.hostSide === "right" ? 0 : s;
  // Vertical centring for a square shorter than the canvas (768 in a 1080 frame ⇒ 156px top
  // and bottom). Filled with a blurred, zoomed copy of the host rather than black.
  const hostY = Math.round((opts.height - s) / 2);

  const filter =
    // Blurred backdrop so the pillarbox reads as depth of field, not a letterbox bug.
    `[1:v]scale=${s}:${opts.height}:force_original_aspect_ratio=increase,` +
    `crop=${s}:${opts.height},gblur=sigma=24,setsar=1,fps=${fps}[hostbg];` +
    `[1:v]scale=${s}:${s},setsar=1,fps=${fps}[hostfg];` +
    `[hostbg][hostfg]overlay=0:${hostY}[hostpanel];` +
    `[0:v]scale=${ctxW}:${opts.height}:force_original_aspect_ratio=increase,` +
    `crop=${ctxW}:${opts.height},setsar=1,fps=${fps}[ctx];` +
    `color=black:size=${opts.width}x${opts.height}:rate=${fps}[bg];` +
    `[bg][ctx]overlay=${ctxX}:0[withctx];` +
    `[withctx][hostpanel]overlay=${hostX}:0:format=auto,format=yuv420p[v]`;

  return [
    "-y",
    "-loop",
    "1",
    "-i",
    opts.contextPath,
    "-i",
    opts.hostClipPath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "1:a?",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    opts.outputPath,
  ];
}

/**
 * Render one host scene's final 1920×1080 frame from the animated square plus its plate.
 * `mode` picks the layout; see the diagram at the top of this file.
 */
export async function composeHostFrame(opts: {
  mode: "panel" | "inset";
  plateUrl: string;
  hostClipUrl: string;
  box: HostBox;
  workDir: string;
  fps?: number;
  featherPx?: number;
  hostSide?: "left" | "right";
}): Promise<Buffer> {
  const dims = dimensionsFor("16:9");
  const platePath = await downloadToTemp(
    opts.plateUrl,
    opts.workDir,
    "plate.png"
  );
  const hostPath = await downloadToTemp(
    opts.hostClipUrl,
    opts.workDir,
    "host.mp4"
  );
  const outputPath = path.join(opts.workDir, "host-1080p.mp4");

  const args =
    opts.mode === "inset"
      ? buildInsetArgs({
          platePath,
          hostClipPath: hostPath,
          outputPath,
          box: opts.box,
          width: dims.width,
          height: dims.height,
          fps: opts.fps,
          featherPx: opts.featherPx,
        })
      : buildPanelArgs({
          contextPath: platePath,
          hostClipPath: hostPath,
          outputPath,
          width: dims.width,
          height: dims.height,
          size: opts.box.size,
          hostSide: opts.hostSide,
          fps: opts.fps,
        });

  await runFfmpeg(args);
  return readFileSync(outputPath);
}

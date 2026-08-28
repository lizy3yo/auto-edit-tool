/**
 * server/videoAssembly.ts
 *
 * FFmpeg-based assembly for the long-form video pipeline.
 *
 * The script is voiced as ONE continuous master narration (built by `concatAudio`
 * from per-paragraph TTS). Assembly then:
 *  1. Re-encodes every clip to uniform, SILENT params (libx264 / yuv420p, `-an`),
 *     head-trimming host clips to drop Grok's reference-photo intro while keeping
 *     each clip's natural length (no per-scene mux — clip audio is discarded).
 *  2. Concatenates the uniform clips and lays the master narration over the whole
 *     thing, trimmed to the narration length, into one finished MP4.
 *
 * Arg-builder functions are pure and exported for unit testing; the spawn-based
 * runners do the actual IO. Modeled on the FFmpeg usage in server/dubbing.ts.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import { getMediaDuration } from "./mediaProbe";
import {
  correctFocus,
  cropWindow,
  detectFace,
  focusCropX,
  medianFocus,
  panelFraction,
  type FaceSource,
} from "./faceAlign";
import sharp from "sharp";
import { getFFmpegPath } from "./ffmpegPath";
import { Semaphore } from "./providers/semaphore";
import { presignOwnBucketUrl } from "./storage";
import { describeError } from "./_core/errorDetail";
import {
  beginRun as beginAssemblyCacheRun,
  cacheEnabled,
  cacheKey,
  endRun as endAssemblyCacheRun,
  getOrBuild,
  hashBuffer,
  sweep as sweepAssemblyCache,
} from "./assemblyCache";
import type { SplitLayout, VideoAspectRatio } from "../shared/types";
// The film timeline's arithmetic moved to `shared/` so the browser's live cut preview runs the
// SAME code this does rather than a second implementation that can drift — see
// shared/filmTimeline.ts. Re-exported because both planners have always been part of this
// module's surface (videoTimeline.ts and the tests import them from here).
import {
  FPS,
  planMasterOverlayScenes,
  planScenePieces,
  type ScenePiecePlan,
} from "../shared/filmTimeline";
export { FPS, planMasterOverlayScenes, planScenePieces, type ScenePiecePlan };

/**
 * Cap on simultaneous local ffmpeg processes, PROCESS-WIDE (every concurrent longform job shares
 * it). The still lane runs Ken Burns encodes at `sixtynineImageConcurrency` (7) *per job*, so five
 * jobs launched together (prod 139-143, a 13-minute window) put ~50 x264 encoders on one box —
 * every one lost the fight for threads/memory and produced the "Error initializing output stream"
 * / "Error reinitializing filters" / EAGAIN cascade that failed 41 scenes across three jobs and
 * burned all 3 `runFfmpegWithRetry` attempts. Half the cores (min 2): each encoder is itself
 * multi-threaded, so this is throughput-neutral — it turns thrash into an orderly queue.
 * Env override because `os.cpus()` reports HOST cores inside a container, not the deploy's quota.
 * A process cap alone was NOT enough: `buildKenBurnsArgs` had no `-threads`, so six slots each ran
 * x264 at its default ncpu*1.5 and the same cascade took out prod jobs 199-201 on 2026-08-03.
 * Every burst builder now passes `-threads 2` — keep it that way when adding one.
 * ponytail: only `runFfmpeg` is capped. `measureLoudness` / silencedetect spawn ffmpeg directly and
 * stay uncapped on purpose (analysis-only, near-zero CPU) so they can never queue behind an encode.
 * Never add a provider call inside `runFfmpeg`: the lock nesting is strictly one-way today
 * (provider semaphore → ffmpeg semaphore, ffmpeg is a leaf), and a back-edge would deadlock.
 */
const FFMPEG_SLOTS = new Semaphore(
  Number(
    process.env.FFMPEG_CONCURRENCY ??
      Math.max(2, Math.floor(os.cpus().length / 2))
  )
);

/**
 * Hard ceiling on ONE ffmpeg call. `spawn()` has no timeout, so a wedged ffmpeg parks its caller
 * forever *and* holds an FFMPEG_SLOTS slot forever — enough of those and every encode in the
 * process deadlocks, which would make the cap above strictly worse than no cap. 30min sits far
 * above the longest legitimate call (the whole-film concat/remux). Deliberately worded so
 * `isTransientFfmpegError` does NOT match it: retrying a 30-minute hang 3× is 90 minutes.
 */
export const FFMPEG_MAX_MS = 30 * 60_000;

/**
 * Hard ceiling on ONE asset download. `fetch` has no default timeout, so a stalled socket
 * parks the assembly forever with no DB write — the shape that let a live job outlive the
 * 30-min inactivity watchdog. Unlike a socket-inactivity timer this caps the whole call
 * including the body read, so it can false-fail a large slow download: env-overridable.
 */
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.ASSEMBLY_DOWNLOAD_TIMEOUT_MS ?? 120_000
);

/**
 * x264 quality for the INTERMEDIATE encodes vs the one delivered scene.
 * ponytail: a still scene is encoded THREE times before YouTube ever sees it (Ken Burns →
 * buildSilentSceneArgs → buildSceneMuxArgs; a split-screen adds a fourth), and the still lane is
 * ~50% of runtime (`STILL_IMAGE_FRACTION`) rendered off a pristine PNG. CRF 23 at every hop was a
 * *delivery* number used as an *intermediate* one, stacking generation loss on the only lane with
 * real detail to lose. The ceiling this names: YouTube re-encodes regardless — 18/20 stops US from
 * being the bottleneck, it cannot make YouTube's output better than YouTube's output. Raise only
 * if intermediate disk/R2 bytes actually hurt.
 *
 * Same split for the x264 SPEED preset. `medium` was uniform, but every one of these encodes feeds
 * YouTube's re-transcode, so a faster preset is near-free wall-clock: `veryfast` on the intermediates
 * (~2–3× faster than `medium` at these steps), `fast` on the one delivered scene. Same ceiling —
 * this only stops US being the encode bottleneck; the cost is larger transient temp/R2 bytes. Push
 * back toward `medium` only if those bytes hurt or a delivered still reads soft.
 */
const CRF_INTERMEDIATE = "18";
const CRF_DELIVERY = "20";
const PRESET_INTERMEDIATE = "veryfast";
const PRESET_DELIVERY = "fast";

// How many scenes to encode at once in assemblePerSceneFilm. Each scene runs its own
// ffmpeg re-encodes, and a single short-clip encode doesn't saturate a multi-core box, so
// running several scenes concurrently fills idle cores.
// ponytail: 3 concurrent × `-threads 2` per encode (see buildSilentSceneArgs/buildSceneMuxArgs)
// bounds total encoder threads. Was 5 with no thread cap, which exhausted the host on big
// (200+ scene) jobs — EAGAIN / encoder-init starvation dropped scenes wholesale. Raise only if
// cores sit idle AND large jobs still assemble.
const ASSEMBLY_CONCURRENCY = 3;

/**
 * Whether a per-scene ffmpeg failure is a transient host-load blip (retry it) rather than a data
 * error (drop fast). The encoder couldn't get threads/memory because the box was momentarily
 * saturated. `EAGAIN` covers the spawn-level failure ("spawn /usr/bin/ffmpeg EAGAIN") where the
 * host was so starved it couldn't even fork ffmpeg — the exact cause that dropped scenes wholesale
 * on 170+-scene jobs. Data errors (download 404, "no clips") don't match. Pure — unit-tested.
 */
export function isTransientFfmpegError(message: string): boolean {
  return /Resource temporarily unavailable|opening encoder|Failed to configure output pad|EAGAIN/i.test(
    message
  );
}

/**
 * Seconds trimmed off the front of an image-to-video clip before muxing.
 * veo-video (like grok before it) leaks the reference photo into the opening
 * frame(s) and morphs into the real scene over ~1–1.5s; dropping the first
 * second removes that portrait intro so the clip starts in-scene. Applied to
 * host clips AND face-model b-roll clips (humanPresent) — any
 * scene that supplies imageUrls to the provider.
 */
export const HOST_INTRO_TRIM_SEC = 1.0;

/**
 * Host name-card edge animation, seconds: the card waits `DELAY` into the FIRST scene of its run,
 * ramps up over `FADE`, sits still across every internal cut, and ramps back down over the last
 * `FADE` of the LAST scene — hitting zero exactly on the cut out of the cold open.
 * `MIN_WINDOW` is the shortest fully-on hold worth rendering; below it the card would flash, so
 * that scene gets none.
 */
export const NAME_CARD_DELAY_SEC = 0.5;
export const NAME_CARD_FADE_SEC = 0.5;
export const NAME_CARD_MIN_WINDOW_SEC = 1.5;

/**
 * Output pixel dimensions for a given aspect ratio (1080p class).
 * ponytail: the canvas is 1080p but the b-roll sources are 720p — still lane (gpt-image-2 @
 * 1280×720 by decision, `OPENAI_IMAGE_SIZE`) and motion b-roll (`grok-imagine-video`, API-capped
 * at 720p) are UPSCALED here (host lip-sync renders native 1080p on HeyGen). 1080p buys: YouTube
 * tiers its transcode bitrate ladder by upload resolution, so a 1080p upload gets more bits even
 * for upscaled content. Real 1080p detail on the ~50%-of-runtime still lane would need
 * `OPENAI_IMAGE_SIZE` at 2048×1152 (measured near-free) — see that file.
 */
export function dimensionsFor(aspectRatio: VideoAspectRatio): {
  width: number;
  height: number;
} {
  return aspectRatio === "9:16"
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };
}

/** Maximum zoom factor for the still-image (Ken Burns) pan/zoom. Kept subtle. */
export const KEN_BURNS_MAX_ZOOM = 1.08;
/**
 * Build FFmpeg args that animate ONE still image into a silent video clip of `durationSec`
 * with a subtle pan/zoom (Ken Burns). The still is cover-cropped to the target aspect, then a
 * smooth, centered zoom (in or out by `index` parity, no horizontal drift) is rendered to
 * exactly `width×height` at `fps`. Output is silent and uniform so it flows into
 * `assemblePerSceneFilm` exactly like a generated clip. Pure — no IO.
 *
 * NOT `zoompan` — that filter truncates the crop origin to whole pixels in its INPUT domain, so a
 * 1.185px/frame ideal travel comes out as 1,1,2,1,1,2… — a ~5Hz sawtooth you see as shake. The old
 * fix was a pre-upscale (×3) to shrink the quantum to 1/3 of an output pixel; it never removed it,
 * and ×4 measured as no visible payoff. `perspective` resamples at 1/256px instead, so the
 * quantization is gone outright, and dropping the upscale makes it cheaper too. Measured over 60
 * frames as the coefficient of variation of inter-frame difference energy (flat == smooth):
 * zoompan ×3 = 25.3%, this = 1.2%. Wall/peak-RSS on a 1080p 6s clip: 2.20s/100MB -> 1.98s/78MB.
 */
// Book-cover look (tunable knobs — eyeball on a real render). The cover is centered at
// COVER_HEIGHT_FRAC of the frame height over a blurred, darkened copy of itself, which itself
// sits on a solid dark backdrop so the frame is opaque no matter what the cover's alpha is.
const COVER_HEIGHT_FRAC = 0.78;
const COVER_BG_BLUR_SIGMA = 28;
// ponytail: backdrop for covers whose background was removed (transparent PNG). An opaque
// cover's blurred backdrop covers the frame, so this color is only ever seen on alpha covers.
const COVER_BACKDROP_COLOR = "0x14141A";

export function buildKenBurnsArgs(opts: {
  imagePath: string;
  outputPath: string;
  width: number;
  height: number;
  durationSec: number;
  index?: number;
  fps?: number;
  maxZoom?: number;
  /** Book-cover look: center the image on a blurred, darkened copy of itself over a dark backdrop. */
  cover?: boolean;
}): string[] {
  const { imagePath, outputPath, width, height } = opts;
  const fps = opts.fps ?? FPS;
  const maxZoom = opts.maxZoom ?? KEN_BURNS_MAX_ZOOM;
  const dur = Math.max(0.5, opts.durationSec);
  const frames = Math.max(1, Math.round(dur * fps));
  const span = (maxZoom - 1).toFixed(4);
  // Even scenes zoom IN, odd scenes zoom OUT.
  const zoomIn = (opts.index ?? 0) % 2 === 0;
  const z = zoomIn
    ? `(1+${span}*on/${frames})`
    : `(${maxZoom.toFixed(4)}-${span}*on/${frames})`;
  // A centered source rect of (W/z, H/z) mapped onto the whole destination frame — i.e. a pure
  // centered zoom, no drift. Axis-aligned by construction: left/right share an x, top/bottom
  // share a y. Transpose two of these and the zoom silently becomes a skew, which is the one
  // thing the unit test guards.
  const hw = `W/(2*${z})`;
  const hh = `H/(2*${z})`;
  const [l, r, t, b] = [`W/2-${hw}`, `W/2+${hw}`, `H/2-${hh}`, `H/2+${hh}`];
  const kenBurns =
    `perspective=x0=${l}:y0=${t}:x1=${r}:y1=${t}:x2=${l}:y2=${b}:x3=${r}:y3=${b}:` +
    `interpolation=cubic:sense=source:eval=frame`;
  let filter: string;
  if (opts.cover) {
    // Cover: a solid dark base, a blurred/darkened full-frame copy of the cover over it, and the
    // sharp cover on top — all centered, then the whole composite gets the same gentle Ken Burns
    // zoom. The image is split 2 ways so one input feeds backdrop + foreground.
    //
    // `format=rgba` is load-bearing: it synthesizes an all-255 alpha plane when the source has no
    // alpha, so ONE chain serves both plain covers and background-removed (transparent) ones. The
    // solid base makes the frame opaque unconditionally — without it a transparent cover's blurred
    // backdrop stays transparent and the final `-pix_fmt yuv420p` flattens it to black mush. An
    // opaque cover's backdrop covers the frame, so the base is invisible and the look is unchanged.
    //
    // ORDER IS LOAD-BEARING: the backdrop is composited onto the base BEFORE `gblur`, never after.
    // A background-removed PNG stores black RGB where alpha=0, and `gblur` is non-premultiplied —
    // blurring first drags that black across the whole bloom and leaves hard dark seams around it.
    // Compositing first yields an opaque image, so the blur has no alpha to smear, and the leftover
    // fringe is the 1-2px the scaler makes at the cover's own edge.
    // `eq` also runs before the overlay, so it darkens only the cover and never crushes the base to
    // black (brightness=-0.28 would). It does NOT commute with the blur — `eq` clamps at 0/255 —
    // so a plain cover's backdrop differs slightly from the pre-halo-removal look. Only the blurred
    // backdrop moves, never the sharp cover, and this scene's look changed anyway when the halo went.
    const fgH = Math.round(height * COVER_HEIGHT_FRAC);
    filter =
      `color=c=${COVER_BACKDROP_COLOR}:s=${width}x${height}:r=${fps}[base];` +
      `[0:v]format=rgba,split=2[bg][fg];` +
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
      `eq=brightness=-0.28:saturation=0.9[bge];` +
      `[base][bge]overlay=(W-w)/2:(H-h)/2,gblur=sigma=${COVER_BG_BLUR_SIGMA}[bgf];` +
      `[fg]scale=-2:${fgH}[fgo];` +
      `[bgf][fgo]overlay=(W-w)/2:(H-h)/2,${kenBurns},` +
      `setsar=1[v]`;
  } else {
    filter =
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},` +
      `${kenBurns},` +
      `setsar=1[v]`;
  }
  return [
    "-y",
    // ponytail: load-bearing. `-loop 1` alone feeds the graph at the image2 default of 25fps, not
    // `fps`. `zoompan` used to hide that by generating its own timeline; `perspective` has no fps
    // option, so without this its `on` advances 25x/sec and `-r` duplicates every 5th frame.
    "-framerate",
    String(fps),
    "-loop",
    "1",
    "-i",
    imagePath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-an",
    "-t",
    dur.toFixed(3),
    "-c:v",
    "libx264",
    // ponytail: cap encoder threads so N concurrent stills don't oversubscribe the host.
    "-threads",
    "2",
    "-preset",
    PRESET_INTERMEDIATE,
    "-crf",
    CRF_INTERMEDIATE,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/**
 * Build the FFmpeg args for ONE PIECE of a cut clip: trim its footage to start at `startSec`
 * (the piece's own — possibly overridden — footage offset) and hold it to exactly
 * `durationSec` of on-screen time. `tpad` clones the last frame if the footage runs out before
 * the piece's time is up (the "independent trim, freeze on run-out" behaviour — see
 * `shared/types.ts` `pieceClipIns`); it's a no-op when the footage already covers the whole
 * piece. Input is the scene's own already-normalized silent video (post `buildSilentSceneArgs`
 * + concat), so no scale/crop here — just trim + hold. Silent, fixed length. Pure — no IO.
 */
export function buildScenePieceArgs(opts: {
  videoPath: string;
  outputPath: string;
  /** Seconds into the (already-normalized) video where this piece's footage starts. */
  startSec: number;
  /** This piece's on-screen duration, seconds. */
  durationSec: number;
  fps?: number;
}): string[] {
  const fps = opts.fps ?? FPS;
  const dur = opts.durationSec.toFixed(3);
  const trim =
    opts.startSec > 0
      ? `trim=start=${opts.startSec.toFixed(3)},setpts=PTS-STARTPTS,`
      : "";
  const filter = `[0:v]${trim}tpad=stop_mode=clone:stop_duration=${dur}[v]`;
  return [
    "-y",
    "-i",
    opts.videoPath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-an",
    "-t",
    dur,
    "-c:v",
    "libx264",
    // ponytail: cap encoder threads so N concurrent scenes don't oversubscribe the host.
    "-threads",
    "2",
    "-preset",
    PRESET_INTERMEDIATE,
    "-crf",
    CRF_INTERMEDIATE,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    opts.outputPath,
  ];
}

/**
 * Rebuild a CUT scene's silent video as separate independently-trimmed PIECES, concatenated —
 * the render side of the operator's cut markers + per-piece footage slip. `sceneVideoPath` is
 * the scene's already-normalized (scaled/cropped/concatenated) silent video; `cuts` are its
 * sorted cut offsets (seconds into the slice); `totalDurationSec` is the scene's full on-screen
 * time (the same value the mux step will hold the whole scene to). The actual per-piece timing
 * is `planScenePieces` (pure, unit-tested); this is just the ffmpeg-per-plan-entry + concat
 * shell around it. Each piece is held (`tpad`) to exactly its own share, so a piece whose
 * footage runs out freezes on ITS OWN last frame rather than jump-cutting into the next piece's
 * — the "independent trim" this feature is for.
 *
 * Returns the path to the concatenated pieced video (same directory, `s{sceneIndex}-pieced.mp4`).
 */
async function buildPiecedSceneVideo(opts: {
  scene: { clipInSec?: number; pieceClipIns?: Record<string, number> };
  cuts: number[];
  sceneVideoPath: string;
  totalDurationSec: number;
  workDir: string;
  sceneIndex: number;
}): Promise<string> {
  const {
    scene,
    cuts,
    sceneVideoPath,
    totalDurationSec,
    workDir,
    sceneIndex: s,
  } = opts;
  const videoDurationSec = await getMediaDuration(sceneVideoPath);
  const plan = planScenePieces({
    cuts,
    totalDurationSec,
    videoDurationSec,
    clipInSec: scene.clipInSec,
    pieceClipIns: scene.pieceClipIns,
  });
  const pieceOuts: string[] = [];
  for (let i = 0; i < plan.length; i++) {
    const pieceOut = path.join(workDir, `s${s}-piece${i}.mp4`);
    await runFfmpeg(
      buildScenePieceArgs({
        videoPath: sceneVideoPath,
        outputPath: pieceOut,
        startSec: plan[i].startSec,
        durationSec: plan[i].durationSec,
      })
    );
    pieceOuts.push(pieceOut);
  }
  if (pieceOuts.length === 1) return pieceOuts[0];
  const piecedVideo = path.join(workDir, `s${s}-pieced.mp4`);
  const plist = path.join(workDir, `s${s}-plist.txt`);
  writeFileSync(plist, pieceOuts.map(concatListLine).join("\n") + "\n");
  await runFfmpeg(
    buildConcatCopyArgs({ listPath: plist, outputPath: piecedVideo })
  );
  return piecedVideo;
}

/**
 * Build the FFmpeg args that normalize ONE raw clip into a uniform, SILENT scene
 * file (no audio). Used by the continuous-narration (talking-head) assembly, where
 * one master voiceover is laid over the whole concatenated video. The video filter
 * (head-trim → scale → crop → setsar → fps) keeps the clip's NATURAL length (no `-t`,
 * no `tpad`) and drops all audio (`-an`). Pure — no IO.
 */
export function buildSilentSceneArgs(opts: {
  videoPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps?: number;
  /** Seconds to drop from the front of the clip (Grok's reference-photo intro). */
  trimLeadSec?: number;
}): string[] {
  const { videoPath, outputPath, width, height } = opts;
  const fps = opts.fps ?? FPS;
  const trimLeadSec = opts.trimLeadSec ?? 0;
  const trim =
    trimLeadSec > 0
      ? `trim=start=${trimLeadSec.toFixed(3)},setpts=PTS-STARTPTS,`
      : "";
  const vf =
    `[0:v]${trim}scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},setsar=1,fps=${fps}[v]`;
  return [
    "-y",
    "-i",
    videoPath,
    "-filter_complex",
    vf,
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    // ponytail: cap encoder threads so N concurrent scenes don't oversubscribe the host.
    "-threads",
    "2",
    "-preset",
    PRESET_INTERMEDIATE,
    "-crf",
    CRF_INTERMEDIATE,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/**
 * Build the FFmpeg args that concat uniform silent scene files (concat demuxer)
 * AND lay one master narration track over the whole thing, trimmed to the
 * narration length. Input 0 is the concat list (video), input 1 is the master
 * audio. Re-encodes video once so `-t` is frame-accurate. Pure — no IO.
 */
export function buildOverlayMuxArgs(opts: {
  listPath: string;
  audioPath: string;
  outputPath: string;
  durationSec: number;
  fps?: number;
}): string[] {
  const fps = opts.fps ?? FPS;
  const dur = opts.durationSec.toFixed(3);
  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    opts.listPath,
    "-i",
    opts.audioPath,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-t",
    dur,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    opts.outputPath,
  ];
}

/**
 * Build args to concat audio inputs in the PCM domain: decode every input, align
 * each with `aformat`, join with the `concat` filter, and encode the result ONCE
 * to MP3. Joining in PCM discards each MP3's encoder delay/padding and avoids the
 * frame-boundary clicks a stream-copy concat of MP3 frames produces at every seam.
 *
 * TTS-baked edge silence is intentionally KEPT: a dB-threshold trim can eat the
 * decaying tail of a quiet final word (audible chop), and Whisper word timings now
 * give the exact speech extent — boundary placement (`assignSceneRanges`) and the
 * hold floor make provider dead air harmless without trimming.
 * Handles a single input too (`concat=n=1`). Pure — no IO.
 */
export function buildAudioConcatFilterArgs(opts: {
  inputPaths: string[];
  outputPath: string;
}): string[] {
  const n = opts.inputPaths.length;
  const ins = opts.inputPaths.flatMap(p => ["-i", p]);
  const pre = opts.inputPaths
    .map(
      (_, i) =>
        `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`
    )
    .join(";");
  const join = opts.inputPaths.map((_, i) => `[a${i}]`).join("");
  const filter = `${pre};${join}concat=n=${n}:v=0:a=1[a]`;
  return [
    "-y",
    ...ins,
    "-filter_complex",
    filter,
    "-map",
    "[a]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    opts.outputPath,
  ];
}

/**
 * Build args to concat the finished per-scene MP4s' AUDIO into ONE continuous track: decode each
 * scene's AAC, force it to exactly its encoded scene length (`apad` then `atrim`), join in the PCM,
 * and encode ONCE to AAC. Like `buildAudioConcatFilterArgs` this discards each segment's encoder
 * delay/padding so the film has no per-scene seam clicks, and every segment keeps its exact length
 * so the rebuilt audio stays frame-aligned to the copied video, which matters for lip-synced host
 * scenes. Pure — no IO.
 */
export function buildFilmAudioConcatArgs(opts: {
  segments: { path: string; durationSec: number }[];
  outputPath: string;
}): string[] {
  const n = opts.segments.length;
  const ins = opts.segments.flatMap(s => ["-i", s.path]);
  const pre = opts.segments
    .map(
      (s, i) =>
        `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,` +
        `apad,atrim=end=${s.durationSec.toFixed(3)}[a${i}]`
    )
    .join(";");
  const join = opts.segments.map((_, i) => `[a${i}]`).join("");
  const filter = `${pre};${join}concat=n=${n}:v=0:a=1[a]`;
  return [
    "-y",
    ...ins,
    "-filter_complex",
    filter,
    "-map",
    "[a]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    opts.outputPath,
  ];
}

/**
 * How far below the narration the music bed sits, in dB.
 *
 * WCAG 2.2 SC 1.4.7 (Low or No Background Audio) sets 20 dB as the accessibility FLOOR for
 * background audio under speech — "people who are hard of hearing often have great difficulty
 * separating speech from background sound", and our audience skews 50–70. More ducking is more
 * separation, so going past the floor stays compliant; the risk is the other direction, and -24
 * was auditioned early and read as too buried.
 *
 * -22 rather than the -20 this sat at: requested by ear, and it lands between the two values
 * already auditioned. Note the per-channel beds arrived in the same change and are quieter and
 * flatter than the Lyria set they replaced (LRA 2.2–6.0), so part of what this compensates for
 * may already be gone — if the bed now reads as absent rather than calm, -20 is the way back.
 * Retune here and nowhere else.
 */
export const MUSIC_BED_DUCK_DB = -22;
/** Music block length after the 30s intro block. */
const MUSIC_BLOCK_SEC = 120;
/** Silence between music blocks — the ear resets, so the next bed reads as new. */
const MUSIC_GAP_SEC = 30;
/** Opening music block (shorter, so the film gets under way quickly). */
const MUSIC_INTRO_SEC = 30;
/** Fade at each block's edges — a bed that starts abruptly announces itself. */
const MUSIC_FADE_SEC = 2;
/** A trailing sliver shorter than this is dropped: a 3s music stab reads as a mistake. */
const MUSIC_MIN_BLOCK_SEC = 8;
/**
 * How much further into a bed each reuse starts. Channels ship ONE bed each (168–321s against a
 * 120s block, so 48–201s of slack), which means this is the only thing standing between a long
 * film and the same 120s on loop. Deliberately smaller than the block, and the caller clamps it
 * to the file's real length, so late reuses converge on "as far in as it goes".
 */
const MUSIC_REPEAT_OFFSET_SEC = 20;

/**
 * Lay out the music/silence timeline for a film of `totalSec`:
 *
 *   0:00–0:30 bed 1 · 0:30–1:00 silence · 1:00–3:00 bed 2 · 3:00–3:30 silence · 3:30–5:30 bed 3 …
 *
 * i.e. a 30s intro block, then 2min music / 30s silence forever. Every block gets its OWN bed
 * (`bedIndex` increments), so the music never returns with the same beat it left on. The final
 * block is trimmed to the film length and dropped entirely if the remainder is a sliver.
 * Pure — unit-tested.
 */
export function planMusicSchedule(
  totalSec: number
): { startSec: number; durSec: number; bedIndex: number }[] {
  const blocks: { startSec: number; durSec: number; bedIndex: number }[] = [];
  let at = 0;
  for (let i = 0; at < totalSec; i++) {
    const full = i === 0 ? MUSIC_INTRO_SEC : MUSIC_BLOCK_SEC;
    const durSec = Math.min(full, totalSec - at);
    if (durSec >= MUSIC_MIN_BLOCK_SEC)
      blocks.push({ startSec: at, durSec, bedIndex: i });
    at += full + MUSIC_GAP_SEC;
  }
  return blocks;
}

/**
 * Build args to mix the music bed under a finished narration track. Input 0 is the narration;
 * inputs 1..N are one bed file per block (a bed used twice is simply passed twice — a flat
 * filter beats an asplit fan-out here). Each block is trimmed from its bed's head, faded at
 * both edges, and joined with `anullsrc` silence for the gaps.
 *
 * The bed is then (a) carved 6dB at 3kHz, where consonants live and music masks speech worst,
 * and (b) loudnorm'd to `narrationLufs + MUSIC_BED_DUCK_DB` — calibrated against the MEASURED
 * narration, so a quiet TTS take doesn't bury the bed nor a loud one swamp it.
 *
 * `amix` runs with `normalize=0`: the default would scale every input by 1/n and quietly drop
 * the narration 6 dB. Pure — no IO.
 */
export function buildMusicBedMixArgs(opts: {
  narrationPath: string;
  /** One bed file per block, in schedule order (parallel to `blocks`). */
  bedPaths: string[];
  /**
   * Seconds into each bed to start its block (parallel to `bedPaths`, default 0). Films longer
   * than the channel's bed set reuse beds; a reused bed starts further in so the viewer hears a
   * different passage instead of the same 120s twice. The caller clamps against the bed's real
   * duration — this just trims where it is told.
   */
  bedOffsets?: number[];
  blocks: { startSec: number; durSec: number }[];
  /** Integrated loudness of the narration, LUFS (see `measureLoudness`). */
  narrationLufs: number;
  outputPath: string;
}): string[] {
  const FMT =
    "aformat=sample_rates=48000:channel_layouts=stereo:sample_fmts=fltp";
  const parts: string[] = [];
  const order: string[] = [];

  opts.blocks.forEach((b, i) => {
    const prev =
      i === 0 ? 0 : opts.blocks[i - 1].startSec + opts.blocks[i - 1].durSec;
    const gap = b.startSec - prev;
    if (gap > 1e-3) {
      parts.push(
        `anullsrc=r=48000:cl=stereo,${FMT},atrim=end=${gap.toFixed(3)}[s${i}]`
      );
      order.push(`[s${i}]`);
    }
    const d = b.durSec;
    const fade = Math.min(MUSIC_FADE_SEC, d / 2);
    const off = opts.bedOffsets?.[i] ?? 0;
    parts.push(
      `[${i + 1}:a]${FMT},atrim=start=${off.toFixed(3)}:end=${(off + d).toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${fade.toFixed(3)},` +
        `afade=t=out:st=${(d - fade).toFixed(3)}:d=${fade.toFixed(3)}[m${i}]`
    );
    order.push(`[m${i}]`);
  });

  const target = (opts.narrationLufs + MUSIC_BED_DUCK_DB).toFixed(1);
  const filter =
    parts.join(";") +
    `;${order.join("")}concat=n=${order.length}:v=0:a=1,` +
    // Consonants (1–4kHz) are what background music masks; carve the bed there.
    `equalizer=f=3000:width_type=o:width=1.5:g=-6,` +
    `loudnorm=I=${target}:TP=-2:LRA=11[mus];` +
    // duration=first: the bed is padded/cut to the narration, never the other way round.
    `[0:a][mus]amix=inputs=2:duration=first:normalize=0[a]`;

  return [
    "-y",
    "-i",
    opts.narrationPath,
    ...opts.bedPaths.flatMap(p => ["-i", p]),
    "-filter_complex",
    filter,
    "-map",
    "[a]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    opts.outputPath,
  ];
}

/** A cut is clean when at least this much detected silence immediately precedes it. */
const INSERT_CLEAN_LEAD_SEC = 0.04;
/** Shortest silence a dirty cut may move into — a real inter-word gap (fast TTS reads pause
 *  as little as ~85ms between sentences), while plosive closures inside words stay shorter. */
const INSERT_MIN_GAP_SEC = 0.08;
/** How far a dirty insert cut may move to reach a gap (mirrors the alignment snap pass's
 *  SNAP_TOLERANCE_SEC — not imported: narrationAlignment imports from here). */
const INSERT_SNAP_TOLERANCE_SEC = 0.75;
/** Neither neighbor scene may shrink below this after a move. */
const MIN_SLICE_SEC = 0.1;
/** Fade length at each master split seam — sub-audible, kills the discontinuity click. */
const OVERLAY_SEAM_FADE_SEC = 0.015;

/**
 * Repair the scene boundaries that master-overlay assembly will physically split (the
 * silence-insert points from `planMasterOverlayScenes` — hold-floor pads and qrTail holds)
 * so no cut lands on speech. Boundaries persisted by an older aligner can sit a few tens of
 * ms past the next word's acoustic onset; splitting there plays a syllable fragment, injects
 * silence, and resumes mid-word. Retry paths reuse those stored boundaries verbatim, so this
 * runs at assembly time against the real master audio.
 *
 * `silences` must come from a short-gap scan (`detectSilencesFromFile(path, 0.03)`) — healthy
 * onset cuts often follow gaps far below the 0.12s alignment-pause threshold, and the gaps
 * next to a mis-cut can be just as short. A boundary is clean when the `INSERT_CLEAN_LEAD_SEC`
 * before it lies inside a silence. A dirty boundary moves to the end of the nearest silence of
 * at least `INSERT_MIN_GAP_SEC` minus that lead: both silence edges are acoustically measured,
 * so `end − lead` resumes just before the next word while leaving the previous word's full
 * tail on the pre-insert side. Both neighbors are updated so the ranges stay contiguous. The
 * final scene's end is never touched (it must keep matching the master duration). Mutates
 * `scenes`; returns the moves for logging. Pure — unit-tested.
 */
export function sanitizeInsertBoundaries(
  scenes: {
    sliceStartSec: number;
    sliceEndSec: number;
    holdSec?: number;
    tailHoldSec?: number;
  }[],
  silences: SilenceInterval[]
): { boundary: number; fromSec: number; toSec: number }[] {
  const moves: { boundary: number; fromSec: number; toSec: number }[] = [];
  for (let i = 0; i < scenes.length - 1; i++) {
    const s = scenes[i];
    const sliceLen = Math.max(0, s.sliceEndSec - s.sliceStartSec);
    const extra =
      Math.max(sliceLen, s.holdSec ?? 0) + (s.tailHoldSec ?? 0) - sliceLen;
    if (extra <= 1e-3) continue; // no insert here — this boundary is never split
    const t = s.sliceEndSec;
    const clean = silences.some(
      sil => sil.start <= t - INSERT_CLEAN_LEAD_SEC && sil.end >= t - 1e-3
    );
    if (clean) continue;
    let best: number | null = null;
    for (const sil of silences) {
      if (sil.end - sil.start < INSERT_MIN_GAP_SEC) continue;
      const to = sil.end - INSERT_CLEAN_LEAD_SEC;
      if (Math.abs(to - t) > INSERT_SNAP_TOLERANCE_SEC) continue;
      if (best === null || Math.abs(to - t) < Math.abs(best - t)) best = to;
    }
    if (
      best === null ||
      best < s.sliceStartSec + MIN_SLICE_SEC ||
      best > scenes[i + 1].sliceEndSec - MIN_SLICE_SEC
    ) {
      continue; // no usable gap nearby — leave it; the seam fade still de-clicks the cut
    }
    s.sliceEndSec = best;
    scenes[i + 1].sliceStartSec = best;
    moves.push({ boundary: i, fromSec: t, toSec: best });
  }
  return moves;
}

/**
 * Build args for the master-overlay film audio: ONE decode of the untouched continuous master
 * narration, silence inserted only where the video intentionally freezes (`inserts`, from
 * `planMasterOverlayScenes`), padded/trimmed to the film's exact frame length, ONE AAC encode.
 * No per-scene cuts at all — scene transitions are seamless by construction. Callers must drop
 * inserts at/after the master's end (`atSec` within ~50ms of the master duration): the trailing
 * `apad` covers them, and a zero-length tail chunk would break `concat`. Pure — no IO.
 *
 * A LEAD hold (the first scene's `headHoldSec`) surfaces as an insert at `atSec` 0 — silence
 * before the master has played ANY of itself. It can't be spliced in like the others (there's
 * no chunk of master audio before it to trim — that chunk would be zero-length, which breaks
 * `concat` the same way a zero-length trailing chunk does), so it's pulled out here and simply
 * prepended to the chain once the rest of the plan is built exactly as it would without it —
 * the no-lead-hold path below is untouched, byte-for-byte, when there isn't one.
 */
export function buildMasterOverlayAudioArgs(opts: {
  masterPath: string;
  /** Ascending, strictly inside (0, masterDuration) — except a single lead hold at exactly 0. */
  inserts: { atSec: number; durSec: number }[];
  totalSec: number;
  outputPath: string;
}): string[] {
  const FMT =
    "aformat=sample_rates=48000:channel_layouts=stereo:sample_fmts=fltp";
  const end = opts.totalSec.toFixed(3);
  const leadHold =
    opts.inserts.length && opts.inserts[0].atSec <= 1e-3
      ? opts.inserts[0]
      : null;
  const inserts = leadHold ? opts.inserts.slice(1) : opts.inserts;
  const leadGap = leadHold
    ? `anullsrc=r=48000:cl=stereo,${FMT},atrim=end=${leadHold.durSec.toFixed(3)}[g0]`
    : null;
  const n = inserts.length;
  let filter: string;
  if (n === 0 && !leadHold) {
    filter = `[0:a]${FMT},apad,atrim=end=${end}[a]`;
  } else if (n === 0) {
    filter =
      `[0:a]${FMT}[base];${leadGap};` +
      `[g0][base]concat=n=2:v=0:a=1,apad,atrim=end=${end}[a]`;
  } else {
    // Split the master into N+1 chunks at the insert points, interleave a silence per insert,
    // and re-join in the PCM domain: [c0][g1][c1][g2]…[gN][cN]. Each seam gets a sub-audible
    // fade so even a cut over room tone (or an unsanitizable one over speech) never clicks.
    const fadeIn = `afade=t=in:st=0:d=${OVERLAY_SEAM_FADE_SEC}`;
    const fadeOut = (chunkLen: number) =>
      `afade=t=out:st=${Math.max(0, chunkLen - OVERLAY_SEAM_FADE_SEC).toFixed(3)}:d=${OVERLAY_SEAM_FADE_SEC}`;
    const t = inserts.map(i => i.atSec.toFixed(3));
    const split =
      `[0:a]${FMT},asplit=${n + 1}` +
      inserts.map((_, i) => `[c${i}]`).join("") +
      `[c${n}]`;
    const chunks = inserts.map((ins, i) => {
      const from = i === 0 ? "" : `start=${t[i - 1]}:`;
      const chunkLen = i === 0 ? ins.atSec : ins.atSec - inserts[i - 1].atSec;
      const lead = i === 0 ? "" : `${fadeIn},`;
      return `[c${i}]atrim=${from}end=${t[i]},asetpts=PTS-STARTPTS,${lead}${fadeOut(chunkLen)}[p${i}]`;
    });
    chunks.push(
      `[c${n}]atrim=start=${t[n - 1]},asetpts=PTS-STARTPTS,${fadeIn}[p${n}]`
    );
    const gaps = inserts.map(
      (ins, i) =>
        `anullsrc=r=48000:cl=stereo,${FMT},atrim=end=${ins.durSec.toFixed(3)}[g${i + 1}]`
    );
    const order =
      (leadHold ? "[g0]" : "") +
      inserts.map((_, i) => `[p${i}][g${i + 1}]`).join("");
    const total = leadHold ? 2 * n + 2 : 2 * n + 1;
    filter =
      [
        split,
        ...chunks,
        ...(leadHold ? [leadGap as string] : []),
        ...gaps,
      ].join(";") +
      `;${order}[p${n}]concat=n=${total}:v=0:a=1,apad,atrim=end=${end}[a]`;
  }
  return [
    "-y",
    "-i",
    opts.masterPath,
    "-filter_complex",
    filter,
    "-map",
    "[a]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    opts.outputPath,
  ];
}

/**
 * Build args to concat uniformly-encoded media files (concat demuxer, stream copy).
 * Used both to join a scene's silent clips and to join the finished scene MP4s — all of
 * which share codec params from `buildSilentSceneArgs` / `buildSceneMuxArgs`. `videoOnly`
 * drops the per-scene audio from the join (master-overlay mode replaces it wholesale). Pure.
 */
export function buildConcatCopyArgs(opts: {
  listPath: string;
  outputPath: string;
  videoOnly?: boolean;
}): string[] {
  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    opts.listPath,
    ...(opts.videoOnly ? ["-map", "0:v"] : []),
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    opts.outputPath,
  ];
}

/**
 * Build args to remux a stream-copied video track with a separately-built audio track into the final
 * MP4 (`-c copy`, no re-encode). Input 0 supplies the video, input 1 the continuous audio. Pure.
 */
export function buildFilmRemuxArgs(opts: {
  videoPath: string;
  audioPath: string;
  outputPath: string;
}): string[] {
  return [
    "-y",
    "-i",
    opts.videoPath,
    "-i",
    opts.audioPath,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    opts.outputPath,
  ];
}

/**
 * Build args to mux ONE scene: lay the scene's own narration over its (already
 * concatenated, silent) video, locked to exactly `durationSec`. A last-frame clone-pad
 * (`tpad`) guarantees the video never falls short of the audio, and `-t durationSec`
 * trims it to exactly the narration length — so the scene's visuals stay aligned to its
 * audio. Re-encodes once for frame-accurate `-t`. Pure — no IO.
 */
export function buildSceneMuxArgs(opts: {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  durationSec: number;
  fps?: number;
  /**
   * Operator trim: seconds dropped from the head of the (already concatenated) scene video
   * before it is held/cut to `durationSec` — `scene.clipInSec`, "cut forward". Applied here, on
   * the whole scene video, so a multi-clip host scene trims across its chunks as one piece.
   * The caller clamps it inside the video's real length; 0/undefined ⇒ from the top.
   */
  startSec?: number;
  /**
   * `scene.headHoldSec` — clone the (post-trim) FIRST frame for this many seconds before the
   * picture starts playing; the mirror of the tail hold, at the front. `durationSec` already
   * includes it (see `planMasterOverlayScenes`), so this only needs to tell `tpad` where the
   * extra time goes: the trailing `-t durationSec` still does the final, exact trim.
   */
  headHoldSec?: number;
  /**
   * Optional QR-code PNG overlaid on a CTA scene. The QR is scaled-to-fit and padded onto a
   * white "quiet-zone" card so it stays scannable over any backdrop. `height` sizes the card
   * relative to the frame. `placement` (default `"corner"`) picks the layout: `"corner"` is the
   * small bottom-right card used across the pitch; `"center"` is the large, centered card for
   * the injected QR-hero beat. Added as a third ffmpeg input (`-loop 1 -i`), so the video stays
   * input 0 and audio input 1.
   */
  qrOverlay?: {
    imagePath: string;
    height: number;
    placement?: "corner" | "center";
  };
  /**
   * Optional host lower-third ("name card") — a full-frame transparent PNG (see
   * `renderNameCardPng`) drawn over the whole scene at a fixed full-frame `overlay=0:0`.
   * Added as another `-loop 1 -i` input AFTER the QR, so the two can coexist.
   *
   * Default is STATIC — on in frame 0, unchanged throughout, gone on the cut — which is what
   * every scene INSIDE the cold-open run wants: nothing moves at the seams, so the run reads as
   * one continuous card. `fadeIn` is set only on the FIRST scene of the run (card waits
   * `NAME_CARD_DELAY_SEC`, then ramps up over `NAME_CARD_FADE_SEC`) and `fadeOut` only on the
   * LAST (ramps down over the final `NAME_CARD_FADE_SEC`, zero exactly on the cut).
   */
  nameCard?: { imagePath: string; fadeIn?: boolean; fadeOut?: boolean };
  /**
   * Optional burned-in caption — a full-frame transparent PNG (`renderCaptionCardPng`) drawn over
   * the whole scene at `overlay=0:0`, like the name card. Added as the LAST `-loop 1 -i` input so
   * it composites on top of both the QR and the lower third, and so adding it never renumbers the
   * inputs the other two already use.
   *
   * Static for the scene's whole length: an asset beat exists to be read, and a caption that
   * fades is a caption someone misses.
   */
  caption?: { imagePath: string };
}): string[] {
  const fps = opts.fps ?? FPS;
  const dur = opts.durationSec.toFixed(3);

  // Name-card timing: when is it fully on? Drop it entirely if that hold is too brief to read —
  // a flash is worse than no card.
  // ponytail: the guard is per scene, so a first scene too short to hold the card just means the
  // card starts hard-on at the next cut instead of fading in. Only reachable under ~2.5s.
  const nc = opts.nameCard;
  const ncOnStart = nc?.fadeIn ? NAME_CARD_DELAY_SEC + NAME_CARD_FADE_SEC : 0;
  const ncOnEnd = nc?.fadeOut
    ? opts.durationSec - NAME_CARD_FADE_SEC
    : opts.durationSec;
  const ncOn = !!nc && ncOnEnd - ncOnStart >= NAME_CARD_MIN_WINDOW_SEC;

  // Inputs: video=0, audio=1, then whichever overlays are present, in this order.
  const qrIdx = 2;
  const cardIdx = opts.qrOverlay ? 3 : 2;
  const capIdx = cardIdx + (ncOn ? 1 : 0);
  const inputs: string[] = [];
  if (opts.qrOverlay) inputs.push("-loop", "1", "-i", opts.qrOverlay.imagePath);
  if (ncOn) inputs.push("-loop", "1", "-i", nc.imagePath);
  if (opts.caption) inputs.push("-loop", "1", "-i", opts.caption.imagePath);

  // Each overlay contributes a prep chain plus an `overlay` position; they're stitched into one
  // chain below so the last one lands on `[v]`.
  const overlays: { prep: string; label: string; pos: string }[] = [];
  if (opts.qrOverlay) {
    // A white card with the QR centered and padded. `corner` (default) is a small card (~28% of
    // frame height) composited bottom-right with a small margin; `center` is a large card (~66%
    // of frame height) composited dead-center.
    const center = opts.qrOverlay.placement === "center";
    const card = Math.round(opts.qrOverlay.height * (center ? 0.66 : 0.28));
    const inner = Math.round(card * 0.86);
    const margin = Math.round(opts.qrOverlay.height * 0.045);
    overlays.push({
      prep:
        `[${qrIdx}:v]scale=${inner}:${inner}:force_original_aspect_ratio=decrease,` +
        `pad=${card}:${card}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[qr]`,
      label: "qr",
      pos: center ? `(W-w)/2:(H-h)/2` : `W-w-${margin}:H-h-${margin}`,
    });
  }
  if (ncOn) {
    // The PNG is `-loop 1`, so a bare overlay covers frame 0 → cut with no timing at all. The
    // alpha fades bound it instead of an `enable` window: `fade=t=in` leaves every frame before
    // `st` fully transparent, and `fade=t=out` stays transparent through the cut.
    const fades = [
      nc.fadeIn
        ? `,fade=t=in:st=${NAME_CARD_DELAY_SEC.toFixed(3)}:d=${NAME_CARD_FADE_SEC}:alpha=1`
        : "",
      nc.fadeOut
        ? `,fade=t=out:st=${ncOnEnd.toFixed(3)}:d=${NAME_CARD_FADE_SEC}:alpha=1`
        : "",
    ].join("");
    overlays.push({
      prep: `[${cardIdx}:v]format=rgba${fades}[card]`,
      label: "card",
      pos: "0:0",
    });
  }
  if (opts.caption) {
    // Already full-frame and pre-positioned, so this is a straight alpha composite — same shape
    // as the name card, minus the fades.
    overlays.push({
      prep: `[${capIdx}:v]format=rgba[cap]`,
      label: "cap",
      pos: "0:0",
    });
  }

  // Head trim first, then the hold: tpad clones the LAST frame, which must be the last frame of
  // the trimmed picture, not of the untrimmed source. `start_duration` (the head hold) is
  // generous the same way `stop_duration` already is — it clones more than strictly needed, and
  // the trailing `-t durationSec` trims the whole thing down to exactly the planned length.
  const head =
    opts.startSec && opts.startSec > 0
      ? `trim=start=${opts.startSec.toFixed(3)},setpts=PTS-STARTPTS,`
      : "";
  const headPad =
    opts.headHoldSec && opts.headHoldSec > 0
      ? `start_mode=clone:start_duration=${opts.headHoldSec.toFixed(3)}:`
      : "";
  let filter: string;
  if (overlays.length === 0) {
    filter = `[0:v]${head}tpad=${headPad}stop_mode=clone:stop_duration=${dur}[v]`;
  } else {
    const parts = [
      `[0:v]${head}tpad=${headPad}stop_mode=clone:stop_duration=${dur}[base]`,
    ];
    let cur = "base";
    overlays.forEach((o, i) => {
      const out = i === overlays.length - 1 ? "v" : `ov${i}`;
      parts.push(o.prep, `[${cur}][${o.label}]overlay=${o.pos}[${out}]`);
      cur = out;
    });
    filter = parts.join(";");
  }
  return [
    "-y",
    "-i",
    opts.videoPath,
    "-i",
    opts.audioPath,
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "1:a",
    // Pad the audio with trailing silence so a held scene (cover reveal, or a sub-floor scene with
    // no merge partner) whose narration is shorter than the held video keeps a full-length audio
    // track instead of desyncing the concat. No-op when audio already equals `dur`; `-t` trims it.
    "-af",
    "apad",
    "-t",
    dur,
    "-c:v",
    "libx264",
    // ponytail: cap encoder threads so N concurrent scenes don't oversubscribe the host.
    "-threads",
    "2",
    "-preset",
    PRESET_DELIVERY,
    "-crf",
    CRF_DELIVERY,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    opts.outputPath,
  ];
}

/**
 * Panel widths of the split-screen layout. The b-roll panel is a full-height SQUARE
 * (1080x1080 on a 1920x1080 canvas), so the still it carries — generated 1:1 — lands
 * uncropped. That leaves the host the remainder (840px), not a half. On a portrait canvas a
 * square right panel wouldn't fit, so fall back to 50/50 there rather than emitting invalid
 * crop args; longform is always landscape today.
 *
 * Shared by the compositor and `buildHostPanelArgs` (which crops the host back OUT of a
 * finished composite) so the two can never disagree about where the seam is.
 */
export function splitPanelWidths(
  width: number,
  height: number
): { rightW: number; hostW: number } {
  const rightW = height < width ? height : Math.floor(width / 2);
  return { rightW, hostW: width - rightW };
}

/** Round down to even — yuv420p 4:2:0 subsampling needs even panel widths. */
const evenPx = (x: number) => x - (x % 2);

/**
 * Resolved pixel geometry of a split layout: where each panel sits and how wide it is.
 * With no layout (or no seam override) this reproduces `splitPanelWidths` exactly — square
 * b-roll panel, host the remainder — so legacy composites are byte-identical. A `seamX`
 * override places the dividing line at that fraction of canvas width (clamped to 0.2..0.8 so
 * neither panel collapses, rounded to even pixels for yuv420p). `hostSide: "right"` mirrors
 * the panel order; the seam is still measured from the LEFT edge either way.
 *
 * Shared by the compositor and both panel extractors so the three can never disagree about
 * where the seam is. Pure — unit-tested.
 */
export function resolveSplitLayout(
  width: number,
  height: number,
  layout?: SplitLayout | null
): {
  hostW: number;
  brollW: number;
  /** x offset of the host panel on the canvas. */
  hostX: number;
  /** x offset of the b-roll panel on the canvas. */
  brollX: number;
  hostOnLeft: boolean;
  /** Width of whichever panel is on the left — the divider's x position. */
  leftW: number;
} {
  const hostOnLeft = (layout?.hostSide ?? "left") !== "right";
  let hostW: number;
  const seam = layout?.seamX;
  if (seam != null && Number.isFinite(seam)) {
    const seamPx = evenPx(
      Math.round(Math.min(0.8, Math.max(0.2, seam)) * width)
    );
    hostW = hostOnLeft ? seamPx : width - seamPx;
  } else {
    hostW = splitPanelWidths(width, height).hostW;
  }
  const brollW = width - hostW;
  return {
    hostW,
    brollW,
    hostX: hostOnLeft ? 0 : brollW,
    brollX: hostOnLeft ? hostW : 0,
    hostOnLeft,
    leftW: hostOnLeft ? hostW : brollW,
  };
}

/**
 * Build FFmpeg args for the split-screen: the lip-synced host clip (input 0) fills the LEFT
 * panel, a separately-generated b-roll clip (input 1) fills a full-height SQUARE panel on the
 * RIGHT (`height × height` — 1080×1080 on the 1920×1080 canvas), leaving the host the
 * remainder (840px). Deliberately NOT 50/50: the b-roll still is generated 1:1, so a square
 * slot displays it whole, where the old `width/2` slot cover-cropped ~44% of its width away.
 * Each panel is cover-scaled then cropped to its own width, hstacked, with a thin black
 * divider drawn over the seam. The host clip's length is authoritative (`-t durationSec`); the
 * right clip is looped (`-stream_loop -1`) and trimmed to match. Audio is dropped (`-an`) —
 * assembly lays the master narration over the whole film. Pure — no IO.
 *
 * The host crop is CENTRED only when `hostFocusX` is null. That panel is the canvas remainder
 * (840 of 1920), so a centred crop keeps just the middle 43.75% of the source frame — fine for
 * a centred subject, and a face against the divider or a sliced cheek for anything else. The
 * host plate is framed by an image model, which does not reliably centre the subject, so
 * `compositeSplitScreenClip` measures the face and passes its position here to pan the window.
 */
export function buildSplitScreenArgs(opts: {
  hostPath: string;
  rightPath: string;
  outputPath: string;
  width: number;
  height: number;
  durationSec: number;
  fps?: number;
  /**
   * Horizontal centre of the host's face, 0..1 across the source frame. Null (the default)
   * keeps ffmpeg's own centred crop, byte-identical to the pre-alignment args. This is the
   * EFFECTIVE focus — the caller resolves manual-vs-measured; `layout.hostFocusX` is NOT read
   * here so the two sources can't fight.
   */
  hostFocusX?: number | null;
  /**
   * Manual geometry (side, seam, b-roll pan). Absent ⇒ the historical layout: host LEFT at
   * the canvas remainder, square b-roll panel, b-roll centred.
   */
  layout?: SplitLayout | null;
}): string[] {
  const { hostPath, rightPath, outputPath, width, height } = opts;
  const fps = opts.fps ?? FPS;
  const { hostW, brollW, hostOnLeft, leftW } = resolveSplitLayout(
    width,
    height,
    opts.layout
  );
  const dur = opts.durationSec.toFixed(3);
  const coverCrop = (label: string, w: number, cropX?: string | null) =>
    `scale=${w}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${w}:${height}${cropX ? `:${cropX}:0` : ""},setpts=PTS-STARTPTS[${label}]`;
  // Both lanes can pan. The default square b-roll panel shows its 1:1 still whole (nothing to
  // pan it to, and focusCropX(centre) emits nothing — args stay byte-identical), but a moved
  // seam makes the panel narrower than its cover-scaled source, so the pan becomes real.
  const host = coverCrop("H", hostW, focusCropX(opts.hostFocusX ?? null));
  const broll = coverCrop(
    "B",
    brollW,
    focusCropX(opts.layout?.brollFocusX ?? null)
  );
  const stackOrder = hostOnLeft ? "[H][B]" : "[B][H]";
  const filter =
    `[0:v]${host};` +
    `[1:v]${broll};` +
    `${stackOrder}hstack=inputs=2,` +
    `drawbox=x=${leftW - 2}:y=0:w=4:h=${height}:color=black:t=fill,` +
    `setsar=1,fps=${fps}[v]`;
  return [
    "-y",
    "-i",
    hostPath,
    "-stream_loop",
    "-1",
    "-i",
    rightPath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-an",
    "-t",
    dur,
    "-c:v",
    "libx264",
    // ponytail: cap encoder threads so N concurrent scenes don't oversubscribe the host.
    "-threads",
    "2",
    "-preset",
    PRESET_INTERMEDIATE,
    "-crf",
    CRF_INTERMEDIATE,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/**
 * The inverse of `buildSplitScreenArgs`: crop the LEFT (host) panel back out of a finished
 * split-screen clip, so the right half can be replaced without re-rendering the host. The
 * output is exactly `hostW × height` — the width `buildSplitScreenArgs` cover-scales the host
 * to — so feeding it straight back in is a no-op scale and the recomposite lands pixel-aligned
 * with the original. Audio is dropped (`-an`); the split clip carries none anyway. Pure — no IO.
 */
export function buildHostPanelArgs(opts: {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps?: number;
  /** The layout the composite was RENDERED with — not the layout being edited toward. */
  layout?: SplitLayout | null;
}): string[] {
  const { inputPath, outputPath, width, height } = opts;
  const fps = opts.fps ?? FPS;
  const { hostW, hostX } = resolveSplitLayout(width, height, opts.layout);
  return [
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    `[0:v]crop=${hostW}:${height}:${hostX}:0,setsar=1,fps=${fps}[v]`,
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    // ponytail: cap encoder threads so N concurrent scenes don't oversubscribe the host.
    "-threads",
    "2",
    "-preset",
    PRESET_INTERMEDIATE,
    "-crf",
    CRF_INTERMEDIATE,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/**
 * `buildHostPanelArgs`' mirror for the OTHER half: crop the b-roll panel back out of a
 * finished split-screen clip. Used when a layout edit lands on a scene rendered before
 * `splitRightUrl` existed — the panel is recovered once from the composite, stored, and every
 * later recomposite reuses it. Same geometry source as the compositor, so the crop always
 * lands exactly on the panel. Pure — no IO.
 */
export function buildBrollPanelArgs(opts: {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps?: number;
  /** The layout the composite was RENDERED with — not the layout being edited toward. */
  layout?: SplitLayout | null;
}): string[] {
  const { inputPath, outputPath, width, height } = opts;
  const fps = opts.fps ?? FPS;
  const { brollW, brollX } = resolveSplitLayout(width, height, opts.layout);
  return [
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    `[0:v]crop=${brollW}:${height}:${brollX}:0,setsar=1,fps=${fps}[v]`,
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    // ponytail: cap encoder threads so N concurrent scenes don't oversubscribe the host.
    "-threads",
    "2",
    "-preset",
    PRESET_INTERMEDIATE,
    "-crf",
    CRF_INTERMEDIATE,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

/**
 * Run FFmpeg with the given args, rejecting on a non-zero exit code.
 * Bounded two ways: at most `FFMPEG_SLOTS.max` run at once process-wide, and any single call is
 * SIGKILLed after `FFMPEG_MAX_MS` so a wedged process can't hold its slot (or its caller) forever.
 */
export async function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPath = getFFmpegPath();
  await FFMPEG_SLOTS.acquire();
  try {
    return await new Promise<void>((resolve, reject) => {
      // ponytail: -hide_banner -loglevel error drops the banner/swscaler-warning
      // noise that was burying the real libx264 error under stderr.slice(); with it,
      // stderr is short and contains only the actual failure reason, so report it whole.
      const proc = spawn(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        ...args,
      ]);
      let stderr = "";
      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`FFmpeg timed out after ${FFMPEG_MAX_MS}ms`));
      }, FFMPEG_MAX_MS);
      proc.stderr.on("data", d => {
        stderr += d.toString();
      });
      proc.on("close", code => {
        clearTimeout(killTimer);
        if (code !== 0) {
          reject(new Error(`FFmpeg failed (exit ${code}): ${stderr.trim()}`));
        } else {
          resolve();
        }
      });
      proc.on("error", err => {
        clearTimeout(killTimer);
        reject(new Error(`FFmpeg process error: ${err.message}`));
      });
    });
  } finally {
    FFMPEG_SLOTS.release();
  }
}

/**
 * Retry `fn` while its error looks transient, then rethrow. Defaults are the ffmpeg
 * host-saturation policy (3 attempts, 1.5s/3s) that the clip encodes and the assembly
 * scene loop both ran as separate copies.
 *
 * ponytail: deliberately covers only the three call sites that shared this exact shape.
 * The other retry loops in the pipeline (TTS task resumption, still-image content-policy
 * escalation, storyboard host-fill) carry per-attempt state and non-throw success signals
 * — they are retries in name only, and forcing them through here would grow this signature
 * past the point where it saves anything.
 */
async function retryTransient<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number;
    label: string;
    tag: string;
    isRetryable?: (msg: string, err: any) => boolean;
    backoffMs?: (tryNo: number) => number;
  }
): Promise<T> {
  const isRetryable = opts.isRetryable ?? isTransientFfmpegError;
  // 5s, 10s, 20s — let the host drain. Was 1.5s/3s, which put all three attempts inside a ~5s
  // window: a saturation episode lasting a minute (four concurrent jobs, prod 198-201) burned
  // every attempt and took the scene out anyway. ~35s of waiting is nothing against a 40-min job.
  const backoff = opts.backoffMs ?? ((tryNo: number) => 5000 * 2 ** tryNo);
  for (let tryNo = 0; ; tryNo++) {
    try {
      return await fn();
    } catch (err: any) {
      // describeError, not err.message: undici collapses every connection-level failure
      // into "fetch failed" and hides the actual reason (ENOTFOUND / ECONNREFUSED / TLS)
      // in err.cause, which made these retry lines useless for diagnosis. It only appends
      // to the base message, so the ffmpeg substring matching in `isRetryable` is unaffected.
      const msg = describeError(err);
      if (tryNo >= opts.attempts - 1 || !isRetryable(msg, err)) throw err;
      const ms = backoff(tryNo);
      console.warn(
        `${opts.tag} ${opts.label} transient failure, retry ${tryNo + 1}/${opts.attempts - 1} in ${ms}ms: ${msg}`
      );
      await new Promise(r => setTimeout(r, ms));
    }
  }
}

/**
 * The transient-retry above around a single ffmpeg call — for the clip-generation encodes
 * (Ken Burns stills, split-screen composites) that previously died wholesale on host-load
 * EAGAIN blips with no retry, permanently failing random scenes and aborting the whole film.
 * Retries ONLY transient host-saturation errors; a data/param error fails fast. Callers pass
 * args to a fixed output path with `-y`, so re-running overwrites.
 */
async function runFfmpegWithRetry(
  args: string[],
  label = "ffmpeg"
): Promise<void> {
  await retryTransient(() => runFfmpeg(args), {
    attempts: 4,
    label,
    tag: "[Clip]",
  });
}

/**
 * Hard ceiling on one analysis-only ffmpeg pass (`runFfmpegCapture`). These decode a whole
 * master narration, so seconds-to-a-minute is normal and this is pure hang protection.
 */
const FFMPEG_PROBE_MAX_MS = Number(
  process.env.FFMPEG_PROBE_MAX_MS ?? 10 * 60_000
);

/**
 * Spawn ffmpeg and resolve its stderr — for the analysis passes whose results print at `info`
 * level (loudnorm's JSON report, silencedetect's intervals) and would be swallowed by
 * `runFfmpeg`'s `-loglevel error`. Same SIGKILL guard as `runFfmpeg`: `spawn` has no timeout,
 * and both of these sit on the assembly path where a wedged process parks the job with no DB
 * write. Deliberately NOT slot-capped — they inform the encodes, so queueing them behind
 * FFMPEG_SLOTS risks a deadlock, and they are cheap next to an encode.
 */
async function runFfmpegCapture(
  args: string[],
  label: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(getFFmpegPath(), args);
    let out = "";
    const killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${label} timed out after ${FFMPEG_PROBE_MAX_MS}ms`));
    }, FFMPEG_PROBE_MAX_MS);
    proc.stderr.on("data", d => {
      out += d.toString();
    });
    proc.on("close", () => {
      clearTimeout(killTimer);
      resolve(out);
    });
    proc.on("error", err => {
      clearTimeout(killTimer);
      reject(new Error(`FFmpeg process error: ${err.message}`));
    });
  });
}

/**
 * Integrated loudness (LUFS) of an audio file, via one analysis-only loudnorm pass.
 * Needs its own spawn rather than `runFfmpeg`: loudnorm prints its JSON report at `info`
 * level, which runFfmpeg's `-loglevel error` would swallow. Throws if the report is
 * unparseable — the caller treats that like any other music-bed failure and ships the
 * narration untouched.
 */
async function measureLoudness(filePath: string): Promise<number> {
  const stderr = await runFfmpegCapture(
    [
      "-hide_banner",
      "-i",
      filePath,
      "-af",
      "loudnorm=print_format=json",
      "-f",
      "null",
      "-",
    ],
    "loudnorm"
  );
  const m = stderr.match(/"input_i"\s*:\s*"?(-?[\d.]+)/);
  if (!m) throw new Error("loudnorm produced no input_i");
  const lufs = Number(m[1]);
  // -70 LUFS is loudnorm's floor for digital silence: a "measurement" there means the
  // narration didn't decode, and scaling the bed off it would blast or bury the music.
  if (!Number.isFinite(lufs) || lufs <= -70)
    throw new Error(`implausible narration loudness ${m[1]} LUFS`);
  return lufs;
}

/** Download a remote URL to a temp file and return the local path. Exported for tests. */
export async function downloadToTemp(
  url: string,
  dir: string,
  name: string
): Promise<string> {
  // ponytail: a film is ~2 downloads per scene, so at 183 scenes a single transient
  // "fetch failed" reliably drops a scene and fails the whole assembly. Three tries with a
  // short backoff; a permanent failure still throws.
  //
  // Our own R2 objects are read through the authenticated S3 endpoint, never the public
  // r2.dev hostname (see `presignOwnBucketUrl`). Resolved once, outside the retry: the
  // signature outlives three attempts by an hour, and re-signing per attempt would only
  // hide a genuine credential failure behind the retry loop.
  const fetchUrl = await presignOwnBucketUrl(url);
  const buf = await retryTransient(
    async () => {
      // Constructed per attempt — a hoisted signal would start attempts 2 and 3 already
      // aborted. This caps the whole call including the body read, so it can genuinely
      // false-fail a slow-but-progressing download; hence the env override.
      const resp = await fetch(fetchUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!resp.ok) {
        const err: any = new Error(
          `Download failed (${resp.status}) for ${name}`
        );
        err.status = resp.status;
        throw err;
      }
      return Buffer.from(await resp.arrayBuffer());
    },
    {
      attempts: 3,
      label: `download ${name}`,
      tag: "[Assembly]",
      // A 4xx is permanent (expired or deleted object); burning two more attempts and
      // 1.5s of backoff on it only delays the failure. Network errors, timeouts and 5xx retry.
      isRetryable: (_msg, err) => !(err?.status >= 400 && err?.status < 500),
      backoffMs: tryNo => 500 * (tryNo + 1),
    }
  );
  const filePath = path.join(dir, name);
  writeFileSync(filePath, buf);
  return filePath;
}

/**
 * Run `fn` against a fresh temp dir and delete the dir afterwards, whatever happens.
 * Cleanup is best-effort: a film leaves gigabytes behind, but failing to remove scratch
 * files must never fail an otherwise-finished render.
 */
async function withTempDir<T>(
  prefix: string,
  fn: (workDir: string) => Promise<T>
): Promise<T> {
  const workDir = path.join(os.tmpdir(), `${prefix}-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });
  try {
    return await fn(workDir);
  } finally {
    if (existsSync(workDir)) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}

/** Escape a path for an FFmpeg concat list line. */
function concatListLine(filePath: string): string {
  // concat demuxer: wrap in single quotes, escape embedded single quotes
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

/**
 * Download the given audio URLs (in order), normalize each to a uniform MP3, and
 * concat them into ONE master narration track. Returns the master buffer and its
 * measured duration. Handles a single URL (just normalizes it). Used to build the
 * continuous voiceover for talking-head videos from per-paragraph TTS segments.
 */
export async function concatAudio(
  audioUrls: string[]
): Promise<{ buffer: Buffer; durationSec: number }> {
  if (audioUrls.length === 0) {
    throw new Error("concatAudio: no audio URLs provided");
  }
  return withTempDir("narration", async workDir => {
    const inputPaths: string[] = [];
    for (let i = 0; i < audioUrls.length; i++) {
      inputPaths.push(
        await downloadToTemp(audioUrls[i], workDir, `seg-${i}.mp3`)
      );
    }
    const masterPath = path.join(workDir, "master.mp3");
    await runFfmpeg(
      buildAudioConcatFilterArgs({ inputPaths, outputPath: masterPath })
    );
    const durationSec = await getMediaDuration(masterPath);
    const buffer = readFileSync(masterPath);
    return { buffer, durationSec };
  });
}

/** What `compositeSplitScreenClip` decided about the host crop, for logging and persistence. */
export interface SplitCompositeResult {
  buffer: Buffer;
  /** Host focus the composite was rendered with; null ⇒ ffmpeg's centred crop. */
  hostFocusX: number | null;
  /**
   * Where that focus came from: the operator (`manual`), a value persisted from an earlier
   * composite of the same host clip (`hint`), a detector (`pico` / `haiku`), or nothing at all
   * (`centre` — no face found, legacy behaviour).
   */
  focusSource: "manual" | "hint" | FaceSource | "centre";
}

/**
 * Composite a lip-synced host clip (LEFT panel) with a b-roll clip (RIGHT panel) into one
 * split-screen clip. Downloads both, measures the host clip's duration (it is the
 * authoritative length — its mouth is lip-synced to the narration), loops/trims the right
 * clip to match, and returns the composited MP4 bytes plus the host focus it used. Cleans up
 * its temp dir.
 *
 * The host crop is decided in this order:
 *   1. `layout.hostFocusX` — the operator placed the host; no detection, deterministic.
 *   2. `autoFocusHint` — a focus this host clip was measured at before (callers persist it on
 *      the scene as `splitAutoFocusX`), so a recomposite — retrofit, panel swap, seam drag —
 *      lands on the same pixels without re-measuring.
 *   3. `measureHostFocusX` — sample frames, find the face, pan the crop to it, then crop those
 *      frames the way ffmpeg will and CHECK the face sits mid-panel, correcting if not. See
 *      `faceAlign.ts` for why a measured crop is needed and `buildSplitScreenArgs` for what the
 *      focus does.
 */
export async function compositeSplitScreenClip(
  hostUrl: string,
  rightUrl: string,
  opts: {
    width: number;
    height: number;
    fps?: number;
    layout?: SplitLayout | null;
    /** A previously measured auto focus for THIS host clip — reused instead of re-measuring. */
    autoFocusHint?: number | null;
  }
): Promise<SplitCompositeResult> {
  return withTempDir("split", async workDir => {
    const hostPath = await downloadToTemp(hostUrl, workDir, "host.mp4");
    const rightPath = await downloadToTemp(rightUrl, workDir, "right.mp4");
    const durationSec = await getMediaDuration(hostPath);
    const { hostW } = resolveSplitLayout(opts.width, opts.height, opts.layout);
    const manualFocus = opts.layout?.hostFocusX;
    let hostFocusX: number | null;
    let focusSource: SplitCompositeResult["focusSource"];
    if (manualFocus != null && Number.isFinite(manualFocus)) {
      hostFocusX = manualFocus;
      focusSource = "manual";
    } else if (
      opts.autoFocusHint != null &&
      Number.isFinite(opts.autoFocusHint)
    ) {
      hostFocusX = opts.autoFocusHint;
      focusSource = "hint";
    } else {
      const m = await measureHostFocusX(hostPath, durationSec, workDir, {
        panelW: hostW,
        panelH: opts.height,
      });
      hostFocusX = m.focus;
      focusSource = m.source;
    }
    const outputPath = path.join(workDir, "split.mp4");
    await runFfmpegWithRetry(
      buildSplitScreenArgs({
        hostPath,
        rightPath,
        outputPath,
        width: opts.width,
        height: opts.height,
        durationSec,
        fps: opts.fps,
        hostFocusX,
        layout: opts.layout,
      }),
      "split"
    );
    return { buffer: readFileSync(outputPath), hostFocusX, focusSource };
  });
}

/** One frame out of a video, as a JPEG. Cheap — decodes to the seek point and stops. Pure. */
export function buildFrameGrabArgs(
  inputPath: string,
  outputPath: string,
  atSec: number
): string[] {
  return [
    "-y",
    // Before `-i`: an input-side seek, so ffmpeg jumps rather than decoding up to the point.
    "-ss",
    atSec.toFixed(3),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outputPath,
  ];
}

/**
 * Fractions of the clip's length that get sampled. Never 0 or 1: lip-sync providers commonly
 * open and close on a held or fading frame, and a black or half-dissolved frame is the one
 * place a face detector reliably finds nothing. Five, so the median survives two bad frames.
 */
const FACE_SAMPLE_POINTS = [0.15, 0.33, 0.5, 0.67, 0.85];

/**
 * How far off mid-panel the verified face may sit, as a fraction of panel width, before the
 * focus is corrected. 3% of an 840 px panel is ~25 px — invisible; below that the correction
 * would be chasing detector jitter.
 */
const PANEL_CENTER_TOLERANCE = 0.03;

/** Correct-and-recheck rounds. One is almost always enough; two covers a coarse first read. */
const VERIFY_ROUNDS = 2;

/**
 * Where the host's face sits across the frame, for the split-screen crop, and which detector
 * said so. `focus` null ⇒ crop centred (`source: "centre"`).
 *
 * Two passes:
 *
 * MEASURE — sample several frames and take the median reading rather than trusting one. A
 * single frame is one blink, one motion blur, one gesture across the face away from
 * mis-cropping the entire scene, and the crop it decides is baked into the render. Frames are
 * measured concurrently; pico is ~100 ms on the CPU per frame, and the Haiku fallback only
 * runs for frames pico could not read.
 *
 * VERIFY — the part that makes this robust to the detector rather than dependent on it. Crop
 * the same frames to the panel window the focus implies (the exact clamp ffmpeg will apply —
 * `cropWindow`), run the deterministic detector on THAT, and measure where the face sits in
 * the panel. Off by more than `PANEL_CENTER_TOLERANCE` ⇒ shift the focus by the error and
 * check again. So a coarse or biased first read converges, a two-person frame that picked the
 * wrong face gets caught, and a face the window can't reach (pressed against the source edge,
 * window already clamped) is logged as such rather than fought.
 *
 * Resolution-independent by construction: every reading is a FRACTION of frame width, the
 * panel is a fraction of the cover-scaled source (`panelFraction`), and the result is consumed
 * as an ffmpeg expression over `in_w`/`out_w`, so nothing here assumes 1920x1080.
 *
 * Never throws — a failed grab, a missing key or an unreadable answer all land on null, which
 * restores the previous centred behaviour. Alignment is an improvement to the crop, never a
 * precondition for producing the clip.
 */
async function measureHostFocusX(
  hostPath: string,
  durationSec: number,
  workDir: string,
  panel: { panelW: number; panelH: number }
): Promise<{ focus: number | null; source: FaceSource | "centre" }> {
  try {
    // Grab the frames once; both passes read them.
    const frames: Buffer[] = (
      await Promise.all(
        FACE_SAMPLE_POINTS.map(async (frac, i): Promise<Buffer | null> => {
          try {
            const framePath = path.join(workDir, `hostframe-${i}.jpg`);
            // Clamped so a very short clip doesn't seek past its own end.
            const at = Math.min(Math.max(durationSec * frac, 0.1), durationSec);
            await runFfmpeg(buildFrameGrabArgs(hostPath, framePath, at));
            return readFileSync(framePath);
          } catch {
            // One unreadable frame is not a failed measurement — the others still count.
            return null;
          }
        })
      )
    ).filter((b): b is Buffer => b !== null);
    if (!frames.length) {
      console.log(
        `[FaceAlign] no frames could be read — centring the host panel`
      );
      return { focus: null, source: "centre" };
    }

    // MEASURE
    const readings = await Promise.all(frames.map(f => detectFace(f)));
    const hits = readings.filter(
      (r): r is { x: number; source: FaceSource } => r !== null
    );
    let focus = medianFocus(hits.map(h => h.x));
    if (focus === null) {
      console.log(
        `[FaceAlign] no face found in ${frames.length} frames — centring the host panel`
      );
      return { focus: null, source: "centre" };
    }
    const source: FaceSource =
      hits.filter(h => h.source === "pico").length * 2 >= hits.length
        ? "pico"
        : "haiku";
    const spread =
      Math.max(...hits.map(h => h.x)) - Math.min(...hits.map(h => h.x));
    console.log(
      `[FaceAlign] host face at x=${focus.toFixed(3)} of frame ` +
        `(${source}, median of ${hits.length}/${frames.length} frames, spread ${spread.toFixed(3)})`
    );

    // VERIFY — crop the frames the way ffmpeg will and look again.
    const meta = await sharp(frames[0]).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    const frac = panelFraction(srcW, srcH, panel.panelW, panel.panelH);
    if (frac >= 1) {
      // The panel shows the whole source width — there is nothing to pan.
      return { focus, source };
    }
    for (let round = 1; round <= VERIFY_ROUNDS; round++) {
      const win = cropWindow(focus, frac);
      const left = Math.round(win.left * srcW);
      const width = Math.max(
        1,
        Math.min(srcW - left, Math.round(win.width * srcW))
      );
      const panelReadings = await Promise.all(
        frames.map(async f => {
          try {
            const crop = await sharp(f)
              .extract({ left, top: 0, width, height: srcH })
              .png()
              .toBuffer();
            return (await detectFace(crop, { allowHaiku: false }))?.x ?? null;
          } catch {
            return null;
          }
        })
      );
      const seen = medianFocus(panelReadings);
      if (seen === null) {
        console.log(
          `[FaceAlign] verify round ${round}: no face readable in the cropped panel — keeping x=${focus.toFixed(3)}`
        );
        break;
      }
      const err = seen - 0.5;
      if (Math.abs(err) <= PANEL_CENTER_TOLERANCE) {
        console.log(
          `[FaceAlign] verified: face at ${(seen * 100).toFixed(0)}% of the host panel ` +
            `(round ${round}, focus x=${focus.toFixed(3)})`
        );
        return { focus, source };
      }
      const corrected = correctFocus(focus, seen, frac);
      // The window can't move any further — the face is pressed against the source edge.
      const clampedAtEdge = cropWindow(corrected, frac).left === win.left;
      console.log(
        `[FaceAlign] verify round ${round}: face at ${(seen * 100).toFixed(0)}% of the panel — ` +
          (clampedAtEdge
            ? `crop window already at the frame edge, cannot centre further`
            : `correcting focus x=${focus.toFixed(3)} → ${corrected.toFixed(3)}`)
      );
      if (clampedAtEdge) break;
      focus = corrected;
    }
    return { focus, source };
  } catch (err: any) {
    console.warn(
      `[FaceAlign] could not sample the host clip: ${err.message} — centring the host panel`
    );
    return { focus: null, source: "centre" };
  }
}

/**
 * Recover the host (LEFT) panel from an already-composited split-screen clip, returning the
 * cropped MP4 bytes. Used to back-fill `scene.hostClipUrls` on scenes rendered before that
 * field existed, so their right panel can be swapped without re-running the lip-sync provider.
 * Costs one extra encode generation, once per scene — afterwards the stored panel is reused.
 */
export async function extractHostPanel(
  splitUrl: string,
  opts: {
    width: number;
    height: number;
    fps?: number;
    /** The layout the composite was RENDERED with, so the crop lands on the panel. */
    layout?: SplitLayout | null;
  }
): Promise<Buffer> {
  return withTempDir("hostpanel", async workDir => {
    const inputPath = await downloadToTemp(splitUrl, workDir, "split.mp4");
    const outputPath = path.join(workDir, "host.mp4");
    await runFfmpegWithRetry(
      buildHostPanelArgs({
        inputPath,
        outputPath,
        layout: opts.layout,
        width: opts.width,
        height: opts.height,
        fps: opts.fps,
      }),
      "hostpanel"
    );
    return readFileSync(outputPath);
  });
}

/**
 * `extractHostPanel`'s mirror: recover the b-roll panel from an already-composited
 * split-screen clip. Back-fills `scene.splitRightUrl` on scenes rendered before that field
 * existed so a layout edit can recomposite them without regenerating the panel.
 */
export async function extractBrollPanel(
  splitUrl: string,
  opts: {
    width: number;
    height: number;
    fps?: number;
    /** The layout the composite was RENDERED with, so the crop lands on the panel. */
    layout?: SplitLayout | null;
  }
): Promise<Buffer> {
  return withTempDir("brollpanel", async workDir => {
    const inputPath = await downloadToTemp(splitUrl, workDir, "split.mp4");
    const outputPath = path.join(workDir, "broll.mp4");
    await runFfmpegWithRetry(
      buildBrollPanelArgs({
        inputPath,
        outputPath,
        layout: opts.layout,
        width: opts.width,
        height: opts.height,
        fps: opts.fps,
      }),
      "brollpanel"
    );
    return readFileSync(outputPath);
  });
}

/**
 * Animate a still image (by URL) into a silent pan/zoom (Ken Burns) MP4 of `durationSec`,
 * returning the bytes. Downloads the image, runs `buildKenBurnsArgs`, reads the result, and
 * cleans up its temp dir. The output is uniform (matches `dimensionsFor`) so it slots into
 * `assemblePerSceneFilm` like any generated clip.
 */
export async function renderKenBurnsClip(
  imageUrl: string,
  opts: {
    durationSec: number;
    aspectRatio: VideoAspectRatio;
    index?: number;
    fps?: number;
    /** Book-cover look: center the image on a blurred, darkened copy of itself over a dark backdrop. */
    cover?: boolean;
    /**
     * Override the canvas, for a panel that isn't a whole frame — the split-screen right half is
     * square, which `VideoAspectRatio` ("16:9" | "9:16") can't express and isn't worth widening
     * that union (used project-wide) for one call site.
     */
    dims?: { width: number; height: number };
  }
): Promise<Buffer> {
  const { width, height } = opts.dims ?? dimensionsFor(opts.aspectRatio);
  return withTempDir("kenburns", async workDir => {
    const imagePath = await downloadToTemp(imageUrl, workDir, "still.img");
    const outputPath = path.join(workDir, "kenburns.mp4");
    await runFfmpegWithRetry(
      buildKenBurnsArgs({
        imagePath,
        outputPath,
        width,
        height,
        durationSec: opts.durationSec,
        index: opts.index,
        fps: opts.fps,
        cover: opts.cover,
      }),
      "kenburns"
    );
    return readFileSync(outputPath);
  });
}

/** Build FFmpeg args to extract one re-encoded MP3 segment `[start, start+len)`. */
export function buildAudioSegmentArgs(opts: {
  inputPath: string;
  outputPath: string;
  startSec: number;
  lenSec: number;
}): string[] {
  // 12ms edge fades: when a cut has to land against (or inside) speech — words with no acoustic
  // gap between scenes — the slice edge never clicks. Same defense as the overlay's seam fades.
  const fade = Math.min(0.012, opts.lenSec / 2);
  return [
    "-y",
    "-ss",
    opts.startSec.toFixed(3),
    "-t",
    opts.lenSec.toFixed(3),
    "-i",
    opts.inputPath,
    "-af",
    `afade=t=in:st=0:d=${fade.toFixed(3)},afade=t=out:st=${Math.max(
      0,
      opts.lenSec - fade
    ).toFixed(3)}:d=${fade.toFixed(3)}`,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    opts.outputPath,
  ];
}

/** Build FFmpeg args to transcode any audio to mono 16 kHz MP3 (small — ideal for Whisper). */
export function buildMonoDownsampleArgs(opts: {
  inputPath: string;
  outputPath: string;
}): string[] {
  return [
    "-y",
    "-i",
    opts.inputPath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "48k",
    opts.outputPath,
  ];
}

/**
 * Download an audio URL and transcode it to a mono 16 kHz MP3, returning the bytes. Whisper
 * downmixes to mono 16 kHz internally, so this is lossless for transcription while keeping a
 * long narration comfortably under Whisper's 25 MB upload cap. Cleans up its temp dir.
 */
export async function extractMonoAudio(audioUrl: string): Promise<Buffer> {
  return withTempDir("mono", async workDir => {
    const inPath = await downloadToTemp(audioUrl, workDir, "master.mp3");
    const outPath = path.join(workDir, "mono16k.mp3");
    await runFfmpeg(
      buildMonoDownsampleArgs({ inputPath: inPath, outputPath: outPath })
    );
    return readFileSync(outPath);
  });
}

/**
 * Cut one audio URL into segments `[startSec, startSec+lenSec)`, in order, returning the MP3
 * bytes for each. Downloads the source ONCE, then re-encodes each segment (`buildAudioSegmentArgs`).
 * Used to slice the single master narration back into per-scene tracks. Cleans up its temp dir.
 */
export async function sliceAudioSegments(
  audioUrl: string,
  segments: { startSec: number; lenSec: number }[]
): Promise<Buffer[]> {
  return withTempDir("slice", async workDir => {
    const inPath = await downloadToTemp(audioUrl, workDir, "master.mp3");
    const out: Buffer[] = [];
    for (let i = 0; i < segments.length; i++) {
      const outPath = path.join(workDir, `seg-${i}.mp3`);
      await runFfmpeg(
        buildAudioSegmentArgs({
          inputPath: inPath,
          outputPath: outPath,
          startSec: segments[i].startSec,
          lenSec: segments[i].lenSec,
        })
      );
      out.push(readFileSync(outPath));
    }
    return out;
  });
}

/** One near-silent interval in an audio track, in seconds. */
export type SilenceInterval = { start: number; end: number };

/** Parse ffmpeg `silencedetect` stderr into `[{start,end}]` intervals. Pure — unit-tested. */
export function parseSilenceLog(stderr: string): SilenceInterval[] {
  const intervals: SilenceInterval[] = [];
  let start: number | null = null;
  for (const m of Array.from(
    stderr.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)
  )) {
    const value = parseFloat(m[2]);
    if (m[1] === "start") {
      start = value;
    } else if (start !== null) {
      intervals.push({ start, end: value });
      start = null;
    }
  }
  return intervals;
}

/**
 * Detect near-silent intervals in an in-memory audio buffer via ffmpeg `silencedetect`.
 * Used to snap master-narration scene cuts onto real pauses (never mid-word). `d=0.12`
 * ignores sub-120ms plosive gaps so only genuine pauses are reported. Returns [] on any
 * ffmpeg failure (caller then keeps its computed boundaries). Cleans up its temp dir.
 */
export async function detectSilencesFromBuffer(
  buffer: Buffer,
  minDurSec?: number
): Promise<SilenceInterval[]> {
  try {
    return await withTempDir("sil", async workDir => {
      const inPath = path.join(workDir, "in.mp3");
      writeFileSync(inPath, buffer);
      return await detectSilencesFromFile(inPath, minDurSec);
    });
  } catch {
    return [];
  }
}

/**
 * `detectSilencesFromBuffer` for audio already on disk. `minDurSec` is the shortest gap
 * silencedetect reports: the 0.12s default matches the alignment snap pass (only genuine
 * pauses); sanitizing insert cuts also scans at ~0.03s so short inter-word gaps count as
 * clean cut sites. Returns [] on any ffmpeg failure.
 */
export async function detectSilencesFromFile(
  inPath: string,
  minDurSec = 0.12
): Promise<SilenceInterval[]> {
  try {
    // No `-loglevel error` here — silencedetect emits its results at info level on stderr.
    const stderr = await runFfmpegCapture(
      [
        "-hide_banner",
        "-nostats",
        "-i",
        inPath,
        "-af",
        `silencedetect=noise=-38dB:d=${minDurSec}`,
        "-f",
        "null",
        "-",
      ],
      "silencedetect"
    );
    return parseSilenceLog(stderr);
  } catch {
    return [];
  }
}

/**
 * Probe the playable duration (seconds) of an in-memory media buffer by writing it to a temp
 * file and running ffprobe (via `getMediaDuration`). Used to verify a provider-returned clip is
 * as long as expected before it's accepted. Returns 0 if the buffer is empty/unprobeable so
 * callers can treat an undecodable clip as a hard shortfall rather than throwing here.
 */
export async function probeBufferDurationSec(
  buffer: Buffer,
  ext = "mp4"
): Promise<number> {
  if (!buffer?.length) return 0;
  try {
    return await withTempDir("probe", async workDir => {
      const filePath = path.join(workDir, `probe.${ext}`);
      writeFileSync(filePath, buffer);
      return await getMediaDuration(filePath);
    });
  } catch {
    return 0;
  }
}

/**
 * Probe the duration (seconds) of media at a URL. Best-effort: any fetch/probe failure
 * returns 0 (callers treat 0 as "unknown" and skip), mirroring probeBufferDurationSec.
 */
export async function probeUrlDurationSec(
  url: string,
  ext = "mp4"
): Promise<number> {
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!resp.ok) return 0;
    return await probeBufferDurationSec(
      Buffer.from(await resp.arrayBuffer()),
      ext
    );
  } catch {
    return 0;
  }
}

/**
 * Assemble a talking-head video: normalize every clip to a uniform SILENT scene,
 * concatenate them, and lay ONE master narration track over the whole thing,
 * trimmed to the narration length. The narration duration is measured from the
 * downloaded master track (so re-assembly after a restart needs no persisted
 * duration). Clips that fail to normalize are skipped. Returns the final buffer.
 */
export async function assembleContinuousFilm(opts: {
  /**
   * Ordered clips, each with its own head-trim. Only host clips (which carry the
   * reference image and leak the reference-photo intro) get a non-zero trim;
   * b-roll clips are text-only and pass `trimLeadSec: 0` so nothing is dropped.
   */
  clips: { url: string; trimLeadSec: number }[];
  narrationUrl: string;
  aspectRatio: VideoAspectRatio;
}): Promise<{ buffer: Buffer; usedClips: number; durationSec: number }> {
  const { clips, narrationUrl, aspectRatio } = opts;
  const { width, height } = dimensionsFor(aspectRatio);

  return withTempDir("longform", async workDir => {
    const sceneFiles: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      try {
        const videoPath = await downloadToTemp(
          clips[i].url,
          workDir,
          `clip-${i}.mp4`
        );
        const outputPath = path.join(workDir, `scene-${i}.mp4`);
        await runFfmpeg(
          buildSilentSceneArgs({
            videoPath,
            outputPath,
            width,
            height,
            trimLeadSec: clips[i].trimLeadSec,
          })
        );
        sceneFiles.push(outputPath);
      } catch (err: any) {
        console.error(`[Assembly] clip ${i} normalize failed: ${err.message}`);
      }
    }

    if (sceneFiles.length === 0) {
      throw new Error("No clips could be normalized for assembly.");
    }

    const audioPath = await downloadToTemp(
      narrationUrl,
      workDir,
      "narration.mp3"
    );
    const durationSec = await getMediaDuration(audioPath);

    const listPath = path.join(workDir, "concat.txt");
    writeFileSync(listPath, sceneFiles.map(concatListLine).join("\n") + "\n");

    const finalPath = path.join(workDir, "final.mp4");
    await runFfmpeg(
      buildOverlayMuxArgs({
        listPath,
        audioPath,
        outputPath: finalPath,
        durationSec,
      })
    );

    const buffer = readFileSync(finalPath);
    return { buffer, usedClips: sceneFiles.length, durationSec };
  });
}

/**
 * Assemble a talking-head video SCENE BY SCENE. For each scene: normalize its clip(s) to
 * uniform silent video, concatenate them, then lay the scene's OWN narration over that
 * video locked to exactly the narration's measured length (`buildSceneMuxArgs`). Finally
 * concatenate the finished scene MP4s in order. Because each scene is independently locked
 * to its own audio, visuals stay aligned to the audio under them and drift cannot
 * accumulate. Each scene's audio duration is measured from the downloaded track (so
 * re-assembly needs no persisted duration). Scenes that fail are skipped. Returns the
 * final buffer.
 */
export async function assemblePerSceneFilm(opts: {
  /**
   * Ordered scenes. `clipUrls` are the scene's clip(s) in order; `trimLeadSec` is the
   * per-clip head-trim (non-zero only for host clips with a reference photo); `audioUrl`
   * is the scene's own narration; `audioDurationSec` is the floored hold length — the scene is
   * held to `max(measured audio, audioDurationSec)` so a sub-floor/cover-reveal beat freezes the
   * last frame with a silent tail instead of cutting at the raw narration length.
   */
  scenes: {
    clipUrls: string[];
    trimLeadSec: number;
    audioUrl: string;
    audioDurationSec?: number;
    /** Optional QR-code PNG (R2 URL) overlaid on CTA scenes. */
    qrOverlayUrl?: string;
    /** QR layout: `"center"` (large, centered — the QR-hero beat) or `"corner"` (default, small bottom-right). */
    qrPlacement?: "corner" | "center";
    /** Extra silent frozen tail (seconds) appended past the held length — the CTA QR-block release
     *  beat lingers so the QR stays on screen ~3s after the release line (or the operator's
     *  override, which may be 0). */
    tailHoldSec?: number;
    /** Extra silent frozen hold (seconds) BEFORE this scene's own first word — the mirror of
     *  `tailHoldSec`, at the front. Only meaningful on the first scene of the film. */
    headHoldSec?: number;
    /** Operator trim: seconds into the scene's clip(s) where the picture starts. */
    clipInSec?: number;
    /** Operator cut markers (CapCut-style split), seconds into the scene's slice. */
    cutPoints?: number[];
    /** Per-piece footage offset overrides, keyed by the cut that starts each piece. */
    pieceClipIns?: Record<string, number>;
    /**
     * This scene's slice of the master narration, seconds on the master timeline. When every
     * scene has both AND `masterAudioUrl` is set, assembly runs in master-overlay mode: scene
     * videos are frame-locked to the master timeline and the untouched master is laid over the
     * whole film (seamless audio). Absent → per-scene audio concat (legacy path).
     */
    sliceStartSec?: number;
    sliceEndSec?: number;
    /**
     * Optional burned-in caption for THIS scene: a full-frame transparent PNG
     * (`renderCaptionCardPng`). Per-scene rather than per-run because each asset beat carries its
     * own text. Non-fatal — a caption that can't be staged costs the text, never the film.
     */
    captionPng?: Buffer;
  }[];
  aspectRatio: VideoAspectRatio;
  /** R2 URL of the continuous master narration — enables master-overlay mode (see above). */
  masterAudioUrl?: string;
  /**
   * Music beds (R2 URLs, one per `planMusicSchedule` block — see `pickMusicBeds`). Present →
   * a calm bed is laid under the finished narration at MUSIC_BED_DUCK_DB. Absent or failing →
   * the film ships with narration only; music never fails an assembly.
   */
  musicBedUrls?: string[];
  /**
   * Optional host lower-third: a full-frame transparent PNG (`renderNameCardPng`) overlaid on a
   * CONTIGUOUS run of scenes (`nameCardSceneIndices` — the locked cold open). The run fades in at
   * its head and out at its tail and is static across every cut between, so it reads as one card
   * that arrives once and leaves once. Each entry is a position in the `scenes` array above, not a
   * `StoryboardScene.index`. Non-fatal: if the PNG can't be staged, the film renders without it.
   */
  nameCard?: { png: Buffer; sceneIndices: number[] };
}): Promise<{
  buffer: Buffer;
  usedScenes: number;
  /** Scenes that could not be assembled, each with the failure reason (for diagnosis). */
  skipped: { index: number; reason: string }[];
  durationSec: number;
}> {
  const { scenes, aspectRatio } = opts;
  const { width, height } = dimensionsFor(aspectRatio);

  // Master-overlay mode: every scene knows its slice of the master timeline and the master
  // track is available — frame-lock each scene's video to that timeline and lay the untouched
  // master over the whole film. Otherwise (pre-overlay/resumed jobs, re-voiced scenes) keep the
  // per-scene audio concat path. The plan itself is computed below, after the slice boundaries
  // are sanitized against the real master audio.
  const overlaySlices =
    opts.masterAudioUrl &&
    scenes.length > 0 &&
    scenes.every(
      s =>
        Number.isFinite(s.sliceStartSec as number) &&
        Number.isFinite(s.sliceEndSec as number)
    )
      ? scenes.map(s => ({
          sliceStartSec: s.sliceStartSec as number,
          sliceEndSec: s.sliceEndSec as number,
          holdSec: s.audioDurationSec,
          tailHoldSec: s.tailHoldSec,
          headHoldSec: s.headHoldSec,
        }))
      : null;

  // ponytail: the one temp dir NOT on `withTempDir` — this body is ~400 lines, and
  // re-indenting all of it into a closure is a large diff on the most-churned function
  // here for no behaviour change. Fold it in whenever this function gets split up.
  const workDir = path.join(os.tmpdir(), `longform-${randomUUID()}`);
  mkdirSync(workDir, { recursive: true });
  // Hold off cache eviction for as long as this film is running (see `beginRun`): it keeps cache
  // paths open for minutes, and a sweep triggered by another job finishing must not delete one.
  beginAssemblyCacheRun();

  // Download the CTA QR overlay once (same image for every CTA scene). A failure here is
  // non-fatal — the CTA host scenes still render, just without the QR card.
  let qrPath: string | undefined;
  const qrUrl = scenes.find(s => s.qrOverlayUrl)?.qrOverlayUrl;
  if (qrUrl) {
    try {
      qrPath = await downloadToTemp(qrUrl, workDir, "qr-overlay.png");
    } catch (err: any) {
      console.warn(
        `[Assembly] QR overlay download failed, continuing without it: ${err.message}`
      );
    }
  }

  // Stage each scene's caption PNG. Same posture as the QR and the name card: a failure here
  // costs that scene's text, never the film.
  const captionPaths = new Map<number, string>();
  // Content hash of each STAGED caption, for the scene cache key: the mux output depends on the
  // caption's pixels, and two runs render the same text to the same PNG. Only populated for
  // captions that actually made it to disk, so a staging failure keys as "no caption" — which is
  // exactly what the encode below will then do.
  const captionHashes = new Map<number, string>();
  scenes.forEach((scene, i) => {
    if (!scene.captionPng) return;
    try {
      const p = path.join(workDir, `caption-${i}.png`);
      writeFileSync(p, scene.captionPng);
      captionPaths.set(i, p);
      captionHashes.set(i, hashBuffer(scene.captionPng));
    } catch (err: any) {
      console.warn(
        `[Assembly] caption write failed for scene ${i}, continuing without it: ${err.message}`
      );
    }
  });

  // Stage the host name card once. Same posture as the QR: a failure here costs the lower third,
  // never the film.
  let nameCardPath: string | undefined;
  let nameCardHash: string | undefined;
  if (opts.nameCard) {
    try {
      nameCardPath = path.join(workDir, "name-card.png");
      writeFileSync(nameCardPath, opts.nameCard.png);
      nameCardHash = hashBuffer(opts.nameCard.png);
    } catch (err: any) {
      nameCardPath = undefined;
      console.warn(
        `[Assembly] name card write failed, continuing without it: ${err.message}`
      );
    }
  }

  try {
    // Overlay mode splits the master at the insert points (hold pads, qrTail holds), so those
    // cut points must not land on speech: boundaries persisted by an older aligner (which every
    // retry path reuses verbatim) can sit a few tens of ms past a word's onset. Scan the real
    // master and re-snap any dirty insert boundary onto the nearest genuine pause BEFORE the
    // frame plan is derived. A failure here degrades exactly like before: plan on the stored
    // boundaries and let the overlay step below retry the download / fall back.
    let masterPath: string | null = null;
    let overlayPlan: ReturnType<typeof planMasterOverlayScenes> | null = null;
    if (overlaySlices) {
      try {
        masterPath = await downloadToTemp(
          opts.masterAudioUrl as string,
          workDir,
          "master-vo.mp3"
        );
        // Whisperx-tiled ranges systematically end ~0.45s before the container's real
        // duration, and the final word's decay lives in that gap: left alone, the last
        // slice both chops that tail (audio past lastSliceEnd is atrim'd at totalSec)
        // and trips the ±0.25s master-match guard below, silently dropping every job to
        // the per-scene concat path. Stretch the last slice to the full master; a drift
        // beyond 1.5s means a stale/re-voiced master and is left for the guard to reject.
        const masterDur = await getMediaDuration(masterPath);
        const lastSlice = overlaySlices[overlaySlices.length - 1];
        const drift = masterDur - lastSlice.sliceEndSec;
        if (drift > 1e-3 && drift <= 1.5) {
          console.log(
            `[Assembly] stretched final slice ${lastSlice.sliceEndSec.toFixed(3)}→${masterDur.toFixed(3)} to cover the master's real tail`
          );
          lastSlice.sliceEndSec = masterDur;
        }
        const silences = await detectSilencesFromFile(masterPath, 0.03);
        const moved = sanitizeInsertBoundaries(overlaySlices, silences);
        if (moved.length > 0) {
          console.log(
            `[Assembly] re-snapped ${moved.length} insert boundary(ies) onto real pauses: ` +
              moved
                .map(
                  m =>
                    `#${m.boundary} ${m.fromSec.toFixed(3)}→${m.toSec.toFixed(3)}`
                )
                .join(", ")
          );
        }
      } catch (err: any) {
        console.warn(
          `[Assembly] master pre-scan failed (${err?.message}) — planning on stored boundaries`
        );
        masterPath = null;
      }
      overlayPlan = planMasterOverlayScenes({ scenes: overlaySlices });
    }

    // Each scene is independent (distinct, index-namespaced temp files), so they encode
    // concurrently. Output is index-keyed (`sceneOuts[s]`), not push order, so the final
    // concat stays in scene order regardless of which scene finishes first.
    const sceneOuts: ({ path: string; durationSec: number } | null)[] =
      new Array(scenes.length).fill(null);
    const skipped: { index: number; reason: string }[] = [];

    const SCENE_ENCODE_ATTEMPTS = 4;

    // Cache bookkeeping, for the one summary line at the end of the run.
    let normHits = 0;
    let muxHits = 0;
    /** Scene-mux cache keys, in scene order — the film-audio concat key is built from them. */
    const sceneKeys: string[] = new Array(scenes.length).fill("");

    /**
     * Name a normalized silent clip from everything that can change its bytes. Deliberately
     * NOT a function of the scene it sits in: the same clip at the same head-trim normalizes
     * identically wherever it appears, so a timing edit anywhere reuses every one of these.
     */
    const normKeyFor = (clipUrl: string, trimLeadSec: number): string =>
      cacheKey("norm", {
        clipUrl,
        trimLeadSec,
        width,
        height,
        fps: FPS,
        crf: CRF_INTERMEDIATE,
        preset: PRESET_INTERMEDIATE,
      });

    const attemptScene = async (s: number): Promise<void> => {
      const scene = scenes[s];
      const normKeys = scene.clipUrls.map(u =>
        normKeyFor(u, scene.trimLeadSec)
      );
      if (normKeys.length === 0) throw new Error("no clips");

      // Where this scene sits in the name-card run: the head fades in, the tail fades out,
      // everything between draws it static. Resolved before the key so the key can name it.
      const ncRun = opts.nameCard?.sceneIndices ?? [];
      const ncAt = ncRun.indexOf(s);
      const ncKey =
        nameCardPath && nameCardHash && ncAt >= 0
          ? {
              hash: nameCardHash,
              fadeIn: ncAt === 0,
              fadeOut: ncAt === ncRun.length - 1,
            }
          : undefined;

      // The finished scene MP4 is a pure function of these. Two determinants are named
      // INDIRECTLY on purpose, so the key can be computed without doing any IO first:
      //  - the head-trim is keyed as the operator's raw `clipInSec`, not the clamped `startSec`
      //    (the clamp is a deterministic function of it and the normalized clips, both already
      //    named here) — so the clamp's probe only runs on a miss;
      //  - outside overlay mode the on-screen length is keyed as `{audioUrl, audioDurationSec,
      //    holds}` rather than the measured duration, which is a deterministic function of the
      //    same audio file — so the audio only gets downloaded on a miss.
      // Overlays are keyed on what was actually STAGED (a QR whose download failed, or a caption
      // that could not be written, keys as absent) so the key matches the encode that follows.
      const muxKey = cacheKey("mux", {
        normKeys,
        audioUrl: scene.audioUrl,
        length: overlayPlan
          ? {
              mode: "overlay",
              frames: overlayPlan.scenes[s].frames,
              muxDurationSec: overlayPlan.scenes[s].muxDurationSec,
            }
          : {
              mode: "scene",
              audioDurationSec: scene.audioDurationSec,
              tailHoldSec: scene.tailHoldSec,
              headHoldSec: scene.headHoldSec,
            },
        headHoldSec: scene.headHoldSec,
        clipInSec: scene.clipInSec,
        cutPoints: scene.cutPoints,
        pieceClipIns: scene.pieceClipIns,
        qr:
          scene.qrOverlayUrl && qrPath
            ? {
                url: scene.qrOverlayUrl,
                placement: scene.qrPlacement ?? "corner",
                height,
              }
            : undefined,
        nameCard: ncKey,
        caption: captionHashes.get(s),
        crf: CRF_DELIVERY,
        preset: PRESET_DELIVERY,
      });
      sceneKeys[s] = muxKey;

      const cached = await getOrBuild<{ encodedSec: number }>({
        kind: "scene",
        key: muxKey,
        ext: "mp4",
        fallbackDir: workDir,
        build: async sceneOut => buildScene(s, normKeys, ncKey, sceneOut),
      });
      if (cached.hit) muxHits++;
      // The sidecar carries the length measured when this scene was encoded, so a hit skips the
      // probe too. A missing/unreadable sidecar just means we measure again.
      const encodedSec =
        cached.meta?.encodedSec ?? (await getMediaDuration(cached.path));
      sceneOuts[s] = { path: cached.path, durationSec: encodedSec };
    };

    /** Encode one scene from scratch into `sceneOut`. Only reached on a scene-cache miss. */
    const buildScene = async (
      s: number,
      normKeys: string[],
      ncKey: { fadeIn: boolean; fadeOut: boolean } | undefined,
      sceneOut: string
    ): Promise<{ encodedSec: number }> => {
      const scene = scenes[s];
      // 1. Normalize each clip to a uniform, silent, head-trimmed scene file. Cached on its own
      //    key: a trim/split/hold edit never changes these, so only a REGENERATED clip re-encodes.
      const silent: string[] = [];
      for (let c = 0; c < scene.clipUrls.length; c++) {
        const norm = await getOrBuild({
          kind: "norm",
          key: normKeys[c],
          ext: "mp4",
          fallbackDir: workDir,
          build: async out => {
            const raw = await downloadToTemp(
              scene.clipUrls[c],
              workDir,
              `s${s}-c${c}.mp4`
            );
            await runFfmpeg(
              buildSilentSceneArgs({
                videoPath: raw,
                outputPath: out,
                width,
                height,
                trimLeadSec: scene.trimLeadSec,
              })
            );
            return undefined;
          },
        });
        if (norm.hit) normHits++;
        silent.push(norm.path);
      }
      if (silent.length === 0) throw new Error("no clips");

      // 2. Concat the scene's clips into one silent scene video.
      let sceneVideo: string;
      if (silent.length === 1) {
        sceneVideo = silent[0];
      } else {
        sceneVideo = path.join(workDir, `s${s}-video.mp4`);
        const vlist = path.join(workDir, `s${s}-vlist.txt`);
        writeFileSync(vlist, silent.map(concatListLine).join("\n") + "\n");
        await runFfmpeg(
          buildConcatCopyArgs({ listPath: vlist, outputPath: sceneVideo })
        );
      }

      // 3. Lay the scene's own narration over its video, locked to the audio length.
      const audioPath = await downloadToTemp(
        scene.audioUrl,
        workDir,
        `s${s}-audio.mp3`
      );
      // Hold the scene to at least its floored length (SCENE_MIN_HOLD_SEC for a held sub-floor
      // scene), plus any `tailHoldSec` (the CTA QR-block release beat's silent tail). tpad freezes
      // the last frame and apad pads silence out to this length; `-t` trims to it. No-op when audio
      // already equals the floor and there's no tail.
      // Overlay mode instead frame-locks the scene to the master-timeline plan (half-frame
      // midpoint → the encode emits exactly the planned frame count); the slice audio is still
      // muxed in as the fallback path's source.
      const durationSec = overlayPlan
        ? overlayPlan.scenes[s].muxDurationSec
        : Math.max(
            await getMediaDuration(audioPath),
            scene.audioDurationSec ?? 0
          ) +
          (scene.tailHoldSec ?? 0) +
          (scene.headHoldSec ?? 0);

      // 3.5. A CUT scene: rebuild its video as separate PIECES, each independently trimmed
      // (own footage offset) and held to its own on-screen share, then concatenated — so a
      // piece that was slipped away from its neighbour's footage freezes on its OWN last frame
      // instead of jump-cutting into whatever the continuous default would have shown. A
      // scene with no cuts is untouched (falls straight to the single-trim path below,
      // byte-identical args to before this feature existed).
      const cuts = [...(scene.cutPoints ?? [])].sort((a, b) => a - b);
      if (cuts.length > 0) {
        sceneVideo = await buildPiecedSceneVideo({
          scene,
          cuts,
          sceneVideoPath: sceneVideo,
          totalDurationSec: durationSec,
          workDir,
          sceneIndex: s,
        });
      }

      // Operator trim ("cut forward"): drop the head of the scene video, clamped so it can never
      // trim past the footage — a trim at/after the end would leave zero frames for tpad to
      // clone. Probed only when set, so untrimmed scenes cost nothing extra. Skipped for a cut
      // scene: piece 0's own trim (still `scene.clipInSec`) was already applied while building
      // the pieced video above, so trimming again here would double it.
      let startSec = 0;
      if (cuts.length === 0 && scene.clipInSec && scene.clipInSec > 0) {
        const videoDur = await getMediaDuration(sceneVideo);
        startSec = Math.max(0, Math.min(scene.clipInSec, videoDur - 0.25));
        if (startSec < scene.clipInSec)
          console.warn(
            `[Assembly] scene ${s} trim ${scene.clipInSec}s clamped to ${startSec.toFixed(3)}s (clip is ${videoDur.toFixed(2)}s)`
          );
      }
      await runFfmpeg(
        buildSceneMuxArgs({
          videoPath: sceneVideo,
          audioPath,
          outputPath: sceneOut,
          durationSec,
          startSec,
          headHoldSec: scene.headHoldSec,
          qrOverlay:
            scene.qrOverlayUrl && qrPath
              ? {
                  imagePath: qrPath,
                  height,
                  placement: scene.qrPlacement ?? "corner",
                }
              : undefined,
          nameCard:
            nameCardPath && ncKey
              ? {
                  imagePath: nameCardPath,
                  fadeIn: ncKey.fadeIn,
                  fadeOut: ncKey.fadeOut,
                }
              : undefined,
          caption: captionPaths.has(s)
            ? { imagePath: captionPaths.get(s) as string }
            : undefined,
        })
      );
      // Lock the rebuilt film audio to the scene's ACTUAL encoded length, not the nominal
      // durationSec. buildSceneMuxArgs cuts video with a frame-quantized `-t`, so the encoded scene
      // runs a fraction of a frame longer than durationSec; the container duration reflects that
      // (video is the longer stream). Feeding nominal durationSec to buildFilmAudioConcatArgs would
      // let that sub-frame remainder accumulate and drift the continuous audio ahead of the picture
      // over a long film. apad fills the tiny remainder with silence at the (paused) scene seam.
      // Persisted as the cache entry's sidecar so a later hit skips this probe too.
      return { encodedSec: await getMediaDuration(sceneOut) };
    };

    const processScene = async (s: number): Promise<void> => {
      try {
        await retryTransient(() => attemptScene(s), {
          attempts: SCENE_ENCODE_ATTEMPTS,
          label: `scene ${s}`,
          tag: "[Assembly]",
        });
      } catch (err: any) {
        // A skipped scene drops out of the film rather than failing it — the whole
        // point of the pool is that one bad scene doesn't cost the other 200.
        const msg = err?.message ?? String(err);
        console.error(`[Assembly] scene ${s} failed: ${msg}`);
        skipped.push({ index: s, reason: msg });
      }
    };

    // Bounded worker pool: `cursor++` is race-free (single-threaded JS; the increment runs
    // synchronously between awaits), so each worker claims a distinct scene index.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < scenes.length) {
        await processScene(cursor++);
      }
    };
    // Big films (170+ scenes) exhausted the host even at 3 concurrent encodes — EAGAIN dropped
    // scenes wholesale. Halve the pool past 150 scenes so a large job trades a little wall-time
    // for actually finishing. Small jobs keep the full pool.
    const effectiveConcurrency = scenes.length > 150 ? 2 : ASSEMBLY_CONCURRENCY;
    await Promise.all(
      Array.from(
        { length: Math.min(effectiveConcurrency, scenes.length) },
        worker
      )
    );

    const sceneFiles = sceneOuts.filter(
      (f): f is { path: string; durationSec: number } => f !== null
    );
    // Cache keys of the scenes that SURVIVED, in film order — the per-scene audio-concat key is
    // built from these (content, not temp paths) so the same cut hits in a fresh workDir.
    const keptSceneKeys = sceneKeys.filter((_, i) => sceneOuts[i] !== null);
    skipped.sort((a, b) => a.index - b.index);

    if (sceneFiles.length === 0) {
      throw new Error("No scenes could be assembled.");
    }

    // 4. Join the finished scene MP4s. Video is stream-copied (lossless, fast). Audio:
    //  - Master-overlay mode (every scene frame-locked to the master timeline, no scene skipped):
    //    lay the UNTOUCHED continuous master over the whole film — no per-scene audio cuts at all,
    //    so scene transitions are seamless by construction.
    //  - Otherwise rebuild from the per-scene slices as ONE continuous encode
    //    (`buildFilmAudioConcatArgs`) — still no seam clicks, but each frame-quantized scene
    //    boundary carries a sub-frame apad silence.
    // A skipped scene disables overlay for this run (the master would desync past the hole).
    const activePlan = skipped.length === 0 ? overlayPlan : null;
    const listPath = path.join(workDir, "final-concat.txt");
    writeFileSync(
      listPath,
      sceneFiles
        .map((f, i) =>
          activePlan
            ? // Pin each scene's start offset to the frame plan: the concat demuxer offsets the
              // next file by the previous one's CONTAINER duration, and per-scene AAC frame
              // quantization (~21ms) would otherwise drift the join off the master timeline.
              `${concatListLine(f.path)}\nduration ${(activePlan.scenes[i].frames / FPS).toFixed(6)}`
            : concatListLine(f.path)
        )
        .join("\n") + "\n"
    );
    const videoPath = path.join(workDir, "film-video.mp4");
    await runFfmpeg(
      buildConcatCopyArgs({
        listPath,
        outputPath: videoPath,
        videoOnly: activePlan !== null,
      })
    );

    // The film's narration track. Cached like the scenes: a picture-only edit (a trim, a slip,
    // a regenerated clip) changes none of its inputs, so the whole-film audio encode — plus the
    // master download it needs — is skipped entirely on a reassemble.
    //
    // The two paths get DIFFERENT keys, and the overlay key is only ever published when the
    // overlay actually succeeded: a build that throws leaves nothing behind (`getOrBuild`
    // publishes on success only), so a transient master-download failure degrades to the concat
    // path for that run without poisoning the cache for the next one.
    let overlayAudio: { path: string; key: string } | null = null;
    const lastSliceEnd = overlaySlices?.length
      ? overlaySlices[overlaySlices.length - 1].sliceEndSec
      : undefined;
    if (activePlan) {
      const overlayKey = cacheKey("filmaudio-overlay", {
        masterAudioUrl: opts.masterAudioUrl,
        inserts: activePlan.inserts,
        totalSec: activePlan.totalSec,
        lastSliceEnd,
      });
      try {
        const built = await getOrBuild({
          kind: "filmaudio",
          key: overlayKey,
          ext: "m4a",
          fallbackDir: workDir,
          build: async out => {
            if (!masterPath) {
              masterPath = await downloadToTemp(
                opts.masterAudioUrl as string,
                workDir,
                "master-vo.mp3"
              );
            }
            const masterDur = await getMediaDuration(masterPath);
            // A master that doesn't match the scene ranges (stale URL, re-voiced job) would lay
            // the wrong words under every scene — fall back rather than desync.
            if (Math.abs(masterDur - (lastSliceEnd as number)) > 0.25) {
              throw new Error(
                `master narration ${masterDur.toFixed(2)}s doesn't match scene ranges' ${(lastSliceEnd as number).toFixed(2)}s`
              );
            }
            await runFfmpeg(
              buildMasterOverlayAudioArgs({
                masterPath,
                // End-of-master inserts (the closing qrTail hold) are covered by the trailing
                // apad; a zero-length tail chunk would break the concat filter.
                inserts: activePlan.inserts.filter(
                  g => g.atSec < (lastSliceEnd as number) - 0.05
                ),
                totalSec: activePlan.totalSec,
                outputPath: out,
              })
            );
            return undefined;
          },
        });
        overlayAudio = { path: built.path, key: overlayKey };
      } catch (err: any) {
        console.warn(
          `[Assembly] master overlay failed (${err?.message}) — falling back to per-scene audio concat`
        );
      }
    }
    let audioPath: string;
    let audioKey: string;
    if (overlayAudio) {
      audioPath = overlayAudio.path;
      audioKey = overlayAudio.key;
    } else {
      // Keyed on the scene CONTENT hashes rather than their temp paths, so the same cut rebuilt
      // in a fresh workDir still hits. A scene that was skipped simply isn't in the list.
      const segments = activePlan
        ? // The video was already joined on the frame plan — lock the rebuilt audio to the
          // same plan (encodedSec would drift: per-scene AAC can outlast the video stream).
          sceneFiles.map((f, i) => ({
            path: f.path,
            durationSec: activePlan.scenes[i].frames / FPS,
          }))
        : sceneFiles;
      audioKey = cacheKey("filmaudio-concat", {
        segments: segments.map((seg, i) => ({
          scene: keptSceneKeys[i],
          durationSec: seg.durationSec,
        })),
      });
      const built = await getOrBuild({
        kind: "filmaudio",
        key: audioKey,
        ext: "m4a",
        fallbackDir: workDir,
        build: async out => {
          await runFfmpeg(
            buildFilmAudioConcatArgs({ segments, outputPath: out })
          );
          return undefined;
        },
      });
      audioPath = built.path;
    }

    // Music bed, laid over whichever audio path won above (master overlay or per-scene concat)
    // so both get it from one block. Every failure here — a bed 404, a bad loudness read, an
    // ffmpeg error — degrades to the narration-only track rather than losing the film.
    //
    // Cached on the narration track's own key plus the bed list: everything downstream of those
    // (the block schedule, the reuse offsets, the measured LUFS) is a deterministic function of
    // them, so naming them names the mix. On a hit this skips the bed downloads, the loudness
    // scan and the full-length mix encode. A build that throws publishes nothing, so a dead CDN
    // costs this run its music and the next run retries.
    let mixedPath = audioPath;
    if (opts.musicBedUrls?.length) {
      try {
        const mixKey = cacheKey("filmmix", {
          audioKey,
          musicBedUrls: opts.musicBedUrls,
          duckDb: MUSIC_BED_DUCK_DB,
          repeatOffsetSec: MUSIC_REPEAT_OFFSET_SEC,
        });
        const narrationSec = await getMediaDuration(audioPath);
        const blocks = planMusicSchedule(narrationSec);
        if (blocks.length === 0)
          throw new Error("film too short for a music bed");
        // One dead bed URL used to cost the whole film its music, since a single rejection
        // failed the Promise.all and dropped us into the narration-only catch below. Retry
        // that block on the job's first bed instead: a repeated bed is a far smaller
        // regression than a silent film, and if the first bed is unreachable too the CDN is
        // down and narration-only is the honest outcome.
        const firstBedUrl = opts.musicBedUrls[0];
        const mixed = await getOrBuild({
          kind: "filmmix",
          key: mixKey,
          ext: "m4a",
          fallbackDir: workDir,
          build: async bgmPath => {
            const bedPaths = await Promise.all(
              blocks.map(async (b, i) => {
                // Fewer beds than blocks would only happen if a caller under-fills the list;
                // wrap rather than crash (pickMusicBeds already sizes it correctly).
                const url = opts.musicBedUrls![i % opts.musicBedUrls!.length];
                try {
                  return await downloadToTemp(url, workDir, `bed-${i}.mp3`);
                } catch (err: any) {
                  console.warn(
                    `[Assembly] bed ${i} (${url}) failed (${err?.message}) — falling back to ${firstBedUrl}`
                  );
                  return downloadToTemp(firstBedUrl, workDir, `bed-${i}.mp3`);
                }
              })
            );
            // A film with more blocks than the channel has beds reuses them — with one bed per
            // channel that is EVERY block after the first. Start each reuse further into the track
            // so it is a different passage, not the same 120s again, clamped to what the file
            // actually holds (168–321s against a 120s block). First use always gets 0.
            const seen = new Map<string, number>();
            const bedOffsets = await Promise.all(
              blocks.map(async (b, i) => {
                const url = opts.musicBedUrls![i % opts.musicBedUrls!.length];
                const n = seen.get(url) ?? 0;
                seen.set(url, n + 1);
                if (n === 0) return 0;
                const bedSec = await getMediaDuration(bedPaths[i]);
                return Math.max(
                  0,
                  Math.min(n * MUSIC_REPEAT_OFFSET_SEC, bedSec - b.durSec)
                );
              })
            );
            const narrationLufs = await measureLoudness(audioPath);
            await runFfmpeg(
              buildMusicBedMixArgs({
                narrationPath: audioPath,
                bedPaths,
                bedOffsets,
                blocks,
                narrationLufs,
                outputPath: bgmPath,
              })
            );
            console.log(
              `[Assembly] music bed: ${blocks.length} block(s), narration ${narrationLufs.toFixed(1)} LUFS ` +
                `→ bed ${(narrationLufs + MUSIC_BED_DUCK_DB).toFixed(1)} LUFS`
            );
            return undefined;
          },
        });
        mixedPath = mixed.path;
      } catch (err: any) {
        console.warn(
          `[Assembly] music bed failed (${err?.message}) — shipping narration-only audio`
        );
      }
    }

    const finalPath = path.join(workDir, "final.mp4");
    await runFfmpeg(
      buildFilmRemuxArgs({
        videoPath,
        audioPath: mixedPath,
        outputPath: finalPath,
      })
    );

    const buffer = readFileSync(finalPath);
    const durationSec = await getMediaDuration(finalPath);
    if (cacheEnabled()) {
      console.log(
        `[Assembly] cache: ${muxHits}/${scenes.length} scenes reused, ` +
          `${normHits} normalized clip(s) reused`
      );
    }
    return {
      buffer,
      usedScenes: sceneFiles.length,
      skipped,
      durationSec,
    };
  } finally {
    if (existsSync(workDir)) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
    // Evict AFTER the run, never during it: mid-run eviction could delete an entry this very
    // film is about to concat. `endRun` first, so the last assembly standing is the one that
    // actually sweeps. Best-effort — a failed sweep only means the cache stays large.
    endAssemblyCacheRun();
    sweepAssemblyCache();
  }
}

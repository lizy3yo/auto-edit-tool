/**
 * server/lipsyncLead.ts — the run-up before a lip-synced host scene.
 *
 * Measured second by second on a pinned-camera InfiniteTalk render, the first ~2 s are a COLD
 * START: the mouth talks (3.2-3.7) while head and torso sit at 0.17-0.38 — a talking statue —
 * and the body only arrives at 0.4-0.7 from the third second on, which is where the operator
 * pointed and said "that part feels natural". The render begins from a frozen photo with no
 * motion history and needs a couple of seconds to get going. The reference engine shows no
 * such ramp, and every host scene in a film starts cold, so every host beat opened stiff.
 *
 * The standard remedy is to discard the warm-up: hand the model a lead-in it will never show.
 * Here the lead is the narration that ACTUALLY precedes the scene in the master track — she is
 * genuinely mid-sentence, so by the visible start her body is already moving — and the first
 * `leadSec` of the returned video is trimmed away (`trimClipHead`). A scene with nothing before
 * it (the film's first) or one voiced off-master gets silence instead: she idles, then begins,
 * which is also how a person behaves.
 *
 * Fail-open: any failure returns null and the caller sends the plain scene track with no lead —
 * a cold-started render beats no render.
 */
import path from "path";
import os from "os";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { sliceAudioSegments, runFfmpeg, downloadToTemp } from "./videoAssembly";
import { storagePut } from "./storage";

export interface LeadTrackScene {
  index: number;
  audioUrl?: string;
  narrationStartSec?: number;
  narrationEndSec?: number;
}

/**
 * Build the padded narration for one host scene: `leadSec` of run-up followed by the scene's
 * own words. Returns the uploaded track, the lead actually prepended (always `leadSec`, padded
 * with silence where the master has less than that before the scene), and `narrationUrl` —
 * the clean, UN-padded narration the delivered clip should carry (see `trimClipHead`) — or
 * null.
 *
 * `narrationUrl` is cut from the MASTER when the scene sits on it, never taken from
 * `scene.audioUrl`: cut-room edits move a scene's range without re-slicing its file (the film
 * plays the master by range), so the stored file is routinely stale — a scene whose range said
 * 5.4 s had a 3.4 s file. Off-master, the file is the only narration there is.
 */
export async function buildLipsyncLeadTrack(opts: {
  jobId: number;
  scene: LeadTrackScene;
  masterAudioUrl: string | null | undefined;
  leadSec: number;
}): Promise<{ url: string; leadSec: number; narrationUrl: string } | null> {
  const { jobId, scene, masterAudioUrl, leadSec } = opts;
  if (!(leadSec > 0) || !scene.audioUrl) return null;
  try {
    const start = scene.narrationStartSec;
    const end = scene.narrationEndSec;
    const onMaster =
      !!masterAudioUrl && start != null && end != null && end > start;

    let track: Buffer;
    let silenceSec: number;
    let narrationUrl = scene.audioUrl;
    if (onMaster) {
      // As much real preceding speech as exists, the rest silence. The un-padded slice is cut
      // in the same pass and uploaded as the clip's own narration.
      const fromMaster = Math.min(leadSec, start);
      let plain: Buffer;
      [track, plain] = await sliceAudioSegments(masterAudioUrl, [
        {
          startSec: start - fromMaster,
          lenSec: Math.max(0.1, end - start + fromMaster),
        },
        { startSec: start, lenSec: Math.max(0.1, end - start) },
      ]);
      silenceSec = leadSec - fromMaster;
      const plainKey = `longform/${jobId}/scene-${scene.index}-lipsync-narration-${randomUUID().slice(0, 6)}.mp3`;
      narrationUrl = (await storagePut(plainKey, plain, "audio/mpeg")).url;
    } else {
      track = await withWorkDir(async dir => {
        const p = await downloadToTemp(
          scene.audioUrl as string,
          dir,
          "scene.mp3"
        );
        return readFileSync(p);
      });
      silenceSec = leadSec;
    }
    if (silenceSec > 0.01) track = await prependSilence(track, silenceSec);

    const key = `longform/${jobId}/scene-${scene.index}-lipsync-vo-${randomUUID().slice(0, 6)}.mp3`;
    const { url } = await storagePut(key, track, "audio/mpeg");
    console.log(
      `[LipsyncLead] scene ${scene.index}: ${leadSec}s run-up ` +
        `(${onMaster ? `${(leadSec - silenceSec).toFixed(2)}s from the master` : "off-master"}` +
        `${silenceSec > 0.01 ? `, ${silenceSec.toFixed(2)}s silence` : ""})`
    );
    return { url, leadSec, narrationUrl };
  } catch (err: any) {
    console.warn(
      `[LipsyncLead] scene ${scene.index}: run-up failed (${err?.message ?? err}) — sending the plain track`
    );
    return null;
  }
}

/**
 * Silence of `sec` seconds in front of an audio buffer, re-encoded as MP3.
 *
 * The sample FORMAT is pinned to float on both legs, and that is load-bearing: `anullsrc`
 * emits 8-bit unsigned PCM, and when the two legs were only matched on rate and layout,
 * `concat` negotiated the common format DOWN to 8 bits — the narration itself was quantized
 * to 8-bit, which is a raised broadband noise floor (spectral centroid doubled, flatness
 * tripled: "thin, buzzing"). That track then drove the lip-sync model and was muxed into the
 * delivered clip. Measured fix: the corrected chain is spectrally identical to the source.
 * Silence is generated at the narration's own 48 kHz so nothing is resampled either.
 */
export async function prependSilence(
  audio: Buffer,
  sec: number
): Promise<Buffer> {
  return withWorkDir(async dir => {
    const inPath = path.join(dir, "in.mp3");
    const outPath = path.join(dir, "out.mp3");
    writeFileSync(inPath, audio);
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-t",
      sec.toFixed(3),
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-i",
      inPath,
      "-filter_complex",
      "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[s];" +
        "[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a];" +
        "[s][a]concat=n=2:v=0:a=1[out]",
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      outPath,
    ]);
    return readFileSync(outPath);
  });
}

/**
 * Drop the first `sec` seconds of a clip. `-ss` BEFORE `-i` with a re-encode is frame-accurate
 * (a stream copy would snap to the nearest keyframe and leave part of the run-up in).
 *
 * With `narrationUrl`, the worker's audio is DISCARDED and the scene's own narration file — the
 * exact track the film lays over this scene — is muxed in from time 0 instead. The worker's
 * audio is a re-encode of the padded lead track and then re-encoded again here: two extra lossy
 * hops on top of the mp3 it started from, and the first render with a run-up came back with its
 * spectral centroid doubled and flatness tripled ("thin, buzzing"). The trimmed video begins
 * exactly where the narration begins, so muxing the original is both cleaner and, by
 * construction, in sync.
 */
export async function trimClipHead(
  video: Buffer,
  sec: number,
  opts: { narrationUrl?: string } = {}
): Promise<Buffer> {
  return withWorkDir(async dir => {
    const inPath = path.join(dir, "in.mp4");
    const outPath = path.join(dir, "out.mp4");
    writeFileSync(inPath, video);
    const narrationPath = opts.narrationUrl
      ? await downloadToTemp(opts.narrationUrl, dir, "narration.mp3")
      : null;
    await runFfmpeg([
      "-y",
      "-ss",
      sec.toFixed(3),
      "-i",
      inPath,
      ...(narrationPath ? ["-i", narrationPath] : []),
      "-map",
      "0:v",
      // The narration from 0 — one AAC encode from the mp3 the film uses, no worker hops.
      // No `-shortest`: it ends the file when the muxer first sees EOF on EITHER stream,
      // which with a copied or buffered video stream cut a 5.4 s clip to 3.4 s in testing.
      // The narration IS the scene's expected length, so nothing needs capping.
      ...(narrationPath ? ["-map", "1:a"] : ["-map", "0:a?"]),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outPath,
    ]);
    return readFileSync(outPath);
  });
}

async function withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(os.tmpdir(), `lipsync-lead-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}

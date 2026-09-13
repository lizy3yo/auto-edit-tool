/**
 * server/lipsyncSyncGate.ts — every LTX host clip is judged against its words before it is
 * stored, and what the judge finds is acted on.
 *
 * Before this the lane ASSUMED sync: a fixed 10-frame shift in the worker (right on average —
 * the mouth landed 400-520 ms late on every render measured — and wrong for any given
 * render by the spread around it) and one seed, never checked. This gate runs the same judge
 * as `scripts/measure-lipsync.mts` (`server/lipsyncJudge.ts`) on the delivered clip:
 *
 *   tracks the words, offset by more than a hair   → SHIFT the picture by the measured offset
 *                                                    (trim the head or hold the first frame;
 *                                                    the audio never moves). No re-render.
 *   does not track the words at all               → RETRY on the next seed, bounded
 *                                                    (`LTX_SYNC_RETRIES`); the last ships,
 *                                                    flagged.
 *   tracks, offset within tolerance                → SHIP.
 *
 * The shift targets a small LEAD (`TARGET_LAG_MS`, -40 ms): a mouth naturally moves 40-120 ms
 * before its sound is heard, and a judge peak there is what real speech measures. Everything
 * measured and done is returned for the scene record (`scene.lipsyncJudge`) so "is it in
 * sync" is a number on the job, not a feeling.
 *
 * `decide` is pure and unit-tested; `shiftClip` is the one ffmpeg step.
 */
import { spawnSync } from "child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { getFFmpegPath } from "./ffmpegPath";
import {
  judgeClip,
  SYNC_MARGIN,
  FPS,
  type JudgeResult,
  type Word,
} from "./lipsyncJudge";

/** Where the peak should sit after a shift: the natural lead of a mouth over its sound. */
export const TARGET_LAG_MS = -40;
/** A peak this close to the target is left alone — one frame at the judge's 25 fps is 40 ms. */
export const SHIFT_DEADBAND_MS = 80;
/** Below this the correlation is noise whatever the far level says. */
export const TRACK_FLOOR_R = 0.15;
/** The scan is ±600 ms; a peak on its edge is not a peak, it is the scan running out. */
const SCAN_EDGE_MS = 560;

export type GateAction = "ship" | "shift" | "retry";

export interface GateDecision {
  action: GateAction;
  /** Milliseconds the PICTURE moves earlier (positive) or later (negative) for `shift`. */
  shiftMs: number;
  reason: string;
}

/** Both witnesses must clear this to be called confident. */
export const CONFIDENT_R = 0.3;
export const CONFIDENT_MARGIN = 0.15;
/** The two witnesses must agree on the offset within this to move a frame. */
export const AGREE_MS = 100;

const confident = (r: number, far: number) =>
  r >= CONFIDENT_R && r - far >= CONFIDENT_MARGIN;

/**
 * The decision table. Pure. Two witnesses (the phonetic track and the audio envelope):
 *   phonetic at CHANCE (below the floor, or peaking on the scan's edge) and the envelope not
 *     tracking either                                  → retry on a fresh seed
 *   both confident AND agreeing on the offset, beyond the deadband → shift by their mean
 *   anything else                                      → ship as rendered, both recorded
 * Measured 2026-09-14 on 14 clips: the single-witness version shifted a clip from 86% to 75%
 * of sounds matched on a peak the other witness put 600 ms away, and on the 14 the two
 * witnesses never once agreed within 100 ms while both confident — so in practice nothing
 * is shifted, and the gate's real work is recording both readings and re-seeding a dead
 * mouth. The retry test is the phonetic PEAK alone, not the margin over the far level: the
 * far level is noisy on a 6 s clip (0.06-0.33 on the same host), and a margin test retried
 * two clips that ship fine (r 0.27 at 83% of sounds; r 0.22 in whole-photo mode) while the
 * dead mouth reads r 0.02 — nowhere near the floor.
 */
export function decide(j: JudgeResult): GateDecision {
  if (j.frames === 0 || j.words === 0) {
    return { action: "ship", shiftMs: 0, reason: "could not judge — shipped as rendered" };
  }
  const phTracks = j.peakR >= TRACK_FLOOR_R && Math.abs(j.lagMs) < SCAN_EDGE_MS;
  const envTracks = j.env
    ? j.env.peakR >= TRACK_FLOOR_R &&
      j.env.peakR - j.env.farR >= SYNC_MARGIN &&
      Math.abs(j.env.lagMs) < SCAN_EDGE_MS
    : false;
  if (!phTracks && !envTracks) {
    return {
      action: "retry",
      shiftMs: 0,
      reason: `mouth does not trace the words by either witness (phonetic r ${j.peakR.toFixed(2)} vs ${j.farR.toFixed(2)}${j.env ? `, envelope r ${j.env.peakR.toFixed(2)} vs ${j.env.farR.toFixed(2)}` : ""})`,
    };
  }
  if (
    j.env &&
    confident(j.peakR, j.farR) &&
    confident(j.env.peakR, j.env.farR) &&
    Math.abs(j.lagMs - j.env.lagMs) <= AGREE_MS
  ) {
    const lag = (j.lagMs + j.env.lagMs) / 2;
    const off = lag - TARGET_LAG_MS;
    if (Math.abs(off) >= SHIFT_DEADBAND_MS) {
      return {
        action: "shift",
        shiftMs: Math.round(off),
        reason: `both witnesses confident and agree (${ms(j.lagMs)} / ${ms(j.env.lagMs)}) — shifting the picture ${off > 0 ? "earlier" : "later"} by ${Math.abs(Math.round(off))} ms`,
      };
    }
  }
  return {
    action: "ship",
    shiftMs: 0,
    reason: `tracks (phonetic r ${j.peakR.toFixed(2)} at ${ms(j.lagMs)}${j.env ? `, envelope r ${j.env.peakR.toFixed(2)} at ${ms(j.env.lagMs)}` : ""}) — shipped as rendered`,
  };
}

/**
 * Move the picture by `shiftMs` while the audio stays put. Earlier (positive): drop that much
 * from the head and hold the last frame at the end. Later (negative): hold the first frame at
 * the start and cut the end. Length and audio are unchanged. One re-encode.
 */
export async function shiftClip(
  clip: Buffer,
  shiftMs: number,
  durationSec: number
): Promise<Buffer> {
  const work = path.join(
    os.tmpdir(),
    `lipsync-shift-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  mkdirSync(work, { recursive: true });
  try {
    const inPath = path.join(work, "in.mp4");
    const outPath = path.join(work, "out.mp4");
    writeFileSync(inPath, clip);
    const sec = Math.abs(shiftMs) / 1000;
    const vf =
      shiftMs > 0
        ? `trim=start=${sec.toFixed(4)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${sec.toFixed(4)}`
        : `tpad=start_mode=clone:start_duration=${sec.toFixed(4)}`;
    const r = spawnSync(
      getFFmpegPath(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inPath,
        "-filter:v",
        vf,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-t",
        durationSec.toFixed(4),
        "-c:v",
        "libx264",
        "-crf",
        "12",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { encoding: "utf8", maxBuffer: 16 << 20 }
    );
    if (r.status !== 0)
      throw new Error(`ffmpeg failed: ${r.stderr.slice(-400)}`);
    return readFileSync(outPath);
  } finally {
    // Best-effort: on Windows a handle can still be closing; a failed cleanup must never
    // turn a judged clip into a failed render.
    try {
      rmSync(work, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch {
      /* leave the temp dir */
    }
  }
}

export interface GateOutcome {
  video: Buffer;
  judge: JudgeResult;
  decision: GateDecision;
  /** The judge re-run on the shifted clip, when a shift was applied. */
  after?: JudgeResult;
}

/**
 * Judge, and shift if that is what the judge says. A `retry` decision is returned, not acted
 * on: only the caller can re-render (it owns the seed and the provider call).
 */
export async function syncGate(
  clip: Buffer,
  words: Word[] | null,
  opts: { durationSec: number; label: string }
): Promise<GateOutcome> {
  const judge = await judgeClip(clip, words, opts.label);
  const decision = decide(judge);
  console.log(
    `[LipsyncGate] ${opts.label}: r ${judge.peakR.toFixed(2)} at ${ms(judge.lagMs)} (far ${judge.farR.toFixed(2)}), ` +
      `${Math.round(judge.soundsPct * 100)}% of sounds, lips-closed ${isFinite(judge.closure) ? judge.closure.toFixed(3) : "n/a"} ` +
      `[${judge.wordsSource} words] → ${decision.action}: ${decision.reason}`
  );
  if (decision.action !== "shift") return { video: clip, judge, decision };
  try {
    const shifted = await shiftClip(clip, decision.shiftMs, opts.durationSec);
    // Re-judge with the same words: the shift should land the peak in the natural band.
    const after = await judgeClip(shifted, words, `${opts.label} (shifted)`);
    console.log(
      `[LipsyncGate] ${opts.label}: after shift r ${after.peakR.toFixed(2)} at ${ms(after.lagMs)}`
    );
    // A shift that made things worse is not kept — the original is the safer clip.
    if (after.frames > 0 && after.peakR < judge.peakR - 0.05) {
      return {
        video: clip,
        judge,
        decision: {
          ...decision,
          action: "ship",
          reason: `${decision.reason} — reverted, the shifted clip judged worse (r ${after.peakR.toFixed(2)})`,
        },
        after,
      };
    }
    return { video: shifted, judge, decision, after };
  } catch (err: any) {
    console.warn(
      `[LipsyncGate] ${opts.label}: shift failed (${err?.message ?? err}) — shipped as rendered`
    );
    return {
      video: clip,
      judge,
      decision: {
        ...decision,
        action: "ship",
        reason: `${decision.reason} — shift failed`,
      },
    };
  }
}

/** Words for one chunk of a scene: the scene's words that fall inside it, re-based to its start. */
export function wordsForChunk(
  words: Word[] | undefined,
  startSec: number,
  lenSec: number
): Word[] | null {
  if (!words?.length) return null;
  const end = startSec + lenSec;
  return words
    .filter(w => w.end > startSec && w.start < end)
    .map(w => ({
      word: w.word,
      start: Math.max(0, w.start - startSec),
      end: Math.min(lenSec, w.end - startSec),
    }));
}

const ms = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)} ms`;

/** For the record on the scene. */
export function summarize(o: GateOutcome) {
  const j = o.after ?? o.judge;
  return {
    r: Math.round(j.peakR * 100) / 100,
    lagMs: Math.round(j.lagMs),
    soundsPct: Math.round(j.soundsPct * 100),
    closure: isFinite(j.closure) ? Math.round(j.closure * 1000) / 1000 : null,
    action: o.decision.action,
    shiftedMs: o.decision.action === "shift" ? o.decision.shiftMs : 0,
    wordsSource: j.wordsSource,
    envR: j.env ? Math.round(j.env.peakR * 100) / 100 : null,
    envLagMs: j.env ? Math.round(j.env.lagMs) : null,
    reason: o.decision.reason,
    /** Frames judged at 25 fps; 0 = could not judge. */
    frames: j.frames,
    /** Exported for tests/logging; unused by the UI. */
    _fps: FPS,
  };
}

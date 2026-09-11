/**
 * server/lipsyncChunks.ts — cutting a host beat into pieces a length-capped lip-sync model
 * can render.
 *
 * LTX-2.3 generates at most 20 s per call. A host beat is usually shorter, but the hook, the
 * outro and a long CTA can run past that, and a model handed 30 s of audio either refuses or
 * truncates. So a beat over the cap is cut into pieces of at most that length and each piece
 * is rendered as its own chunk of the same scene — `runChunkTasks` already renders a scene as
 * N chunks and `composeHostScene` already carries N clips, because HeyGen's lane once
 * chunked the same way. The cut lands in a real pause wherever one is near, so the mouth is
 * shut at the join instead of mid-word.
 *
 * Two halves: `planLipsyncChunks` is pure arithmetic (unit-tested) and `cutNarrationChunks`
 * does the ffmpeg + upload. A resume re-runs the PLAN only — same inputs, same cuts — to
 * recover the per-chunk lengths the truncation guard needs, without re-uploading anything.
 */
import path from "path";
import os from "os";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import {
  sliceAudioSegments,
  detectSilencesFromBuffer,
  downloadToTemp,
} from "./videoAssembly";
import { storagePut } from "./storage";

export interface Pause {
  start: number;
  end: number;
}

export interface LipsyncChunk {
  startSec: number;
  lenSec: number;
}

/** No chunk shorter than this — a one-second render is a bad use of a model load. */
export const MIN_CHUNK_SEC = 2;
/** Keep a cut this far inside a pause so the next word keeps its lead-in (assembly's convention). */
const CLEAN_LEAD_SEC = 0.04;

/**
 * Cut `durationSec` of narration into the fewest pieces of at most `maxSec`, each cut placed
 * in the pause nearest its ideal (evenly spaced) position, or at the ideal position itself
 * when no pause fits. `pauses` are in the NARRATION's own time (0 = its first sample).
 *
 * Every piece is guaranteed ≤ `maxSec` and ≥ `MIN_CHUNK_SEC` (except when the whole beat is
 * shorter than that, which is returned as one piece). Pure.
 */
export function planLipsyncChunks(
  durationSec: number,
  maxSec: number,
  pauses: Pause[] = []
): LipsyncChunk[] {
  if (!(durationSec > 0)) return [];
  if (!(maxSec > 0) || durationSec <= maxSec)
    return [{ startSec: 0, lenSec: durationSec }];

  const pieces = Math.ceil(durationSec / maxSec);
  const chunks: LipsyncChunk[] = [];
  let cursor = 0;
  for (let k = 1; k < pieces; k++) {
    const left = pieces - k; // pieces still to cut after this one
    const remaining = durationSec - cursor;
    // The cut must leave the rest coverable by `left` pieces of `maxSec`, and this piece
    // no longer than `maxSec` — that window always contains the ideal even split.
    const lo = Math.max(cursor + MIN_CHUNK_SEC, durationSec - left * maxSec);
    const hi = Math.min(cursor + maxSec, durationSec - left * MIN_CHUNK_SEC);
    const ideal = cursor + remaining / (left + 1);
    let cut = Math.min(Math.max(ideal, lo), hi);
    let best = Infinity;
    for (const p of pauses) {
      const pLo = Math.max(p.start + CLEAN_LEAD_SEC, lo);
      const pHi = Math.min(p.end - CLEAN_LEAD_SEC, hi);
      if (pHi < pLo) continue;
      const cand = Math.min(Math.max(ideal, pLo), pHi);
      const d = Math.abs(cand - ideal);
      if (d < best) {
        best = d;
        cut = cand;
      }
    }
    cut = Math.round(cut * 1000) / 1000;
    chunks.push({ startSec: cursor, lenSec: cut - cursor });
    cursor = cut;
  }
  chunks.push({ startSec: cursor, lenSec: durationSec - cursor });
  return chunks;
}

export interface ChunkableScene {
  index: number;
  audioUrl?: string;
  narrationStartSec?: number;
  narrationEndSec?: number;
}

/**
 * The pauses inside one scene's narration, in the scene's own time. Taken from the master's
 * silences where the scene sits on it (free — kept at voicing), else detected on the scene's
 * file. Errors degrade to "no pauses": the plan still cuts, just not in silence.
 */
export async function scenePauses(
  scene: ChunkableScene,
  masterSilences: Pause[] | null | undefined
): Promise<Pause[]> {
  const start = scene.narrationStartSec;
  const end = scene.narrationEndSec;
  if (masterSilences?.length && start != null && end != null && end > start) {
    // Rounded to the millisecond: the subtraction leaves float dust that would otherwise
    // land a cut 1e-14 s off a pause edge and read as a different number in logs.
    const ms = (t: number) => Math.round(t * 1000) / 1000;
    return masterSilences
      .filter(s => s.end > start && s.start < end)
      .map(s => ({
        start: ms(Math.max(0, s.start - start)),
        end: ms(Math.min(end - start, s.end - start)),
      }));
  }
  if (!scene.audioUrl) return [];
  try {
    const buf = await withWorkDir(async dir =>
      readFileSync(await downloadToTemp(scene.audioUrl as string, dir, "n.mp3"))
    );
    return await detectSilencesFromBuffer(buf);
  } catch (err: any) {
    console.warn(
      `[LipsyncChunks] scene ${scene.index}: silence detection failed (${err?.message ?? err}) — cutting without pauses`
    );
    return [];
  }
}

/**
 * Cut the scene's narration file into `chunks` and upload each. Returns the URLs in chunk
 * order. Throws on a failed cut — a lip-sync chunk set with a hole in it is meaningless.
 */
export async function cutNarrationChunks(
  jobId: number,
  scene: ChunkableScene,
  chunks: LipsyncChunk[]
): Promise<string[]> {
  if (!scene.audioUrl) throw new Error("scene has no narration audio to chunk");
  const buffers = await sliceAudioSegments(scene.audioUrl, chunks);
  const urls: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const key = `longform/${jobId}/scene-${scene.index}-lipsync-chunk-${i}-${randomUUID().slice(0, 6)}.mp3`;
    urls.push((await storagePut(key, buffers[i], "audio/mpeg")).url);
  }
  console.log(
    `[LipsyncChunks] scene ${scene.index}: ${chunks.length} chunks ` +
      `(${chunks.map(c => c.lenSec.toFixed(1)).join(" / ")} s)`
  );
  return urls;
}

async function withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(os.tmpdir(), `lipsync-chunks-${randomUUID()}`);
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

// Measurements every composite is held to. All of them read the RENDERED files, never the plan,
// because the faults they catch (a one-frame flash, audio drifting at a join) only exist in the
// output.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DIFF_W = 160;
const DIFF_H = 90;

/**
 * Mean absolute luma change between consecutive frames (0-255, on a 160x90 greyscale copy).
 * `d[k]` is the change INTO frame k (d[0] = 0). Cached next to the video as `<file>.diffs.json`.
 */
export async function frameDiffs(ff: string, file: string): Promise<number[]> {
  const cache = `${file}.diffs.json`;
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const n = DIFF_W * DIFF_H;
  const d: number[] = await new Promise((resolve, reject) => {
    const p = spawn(ff, ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${DIFF_W}:${DIFF_H},format=gray`, "-f", "rawvideo", "-"], { windowsHide: true });
    const out: number[] = [];
    let buf = Buffer.alloc(0);
    let prev: Buffer | null = null;
    p.stdout.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= n) {
        const f = buf.subarray(0, n);
        buf = buf.subarray(n);
        if (!prev) out.push(0);
        else {
          let s = 0;
          for (let k = 0; k < n; k++) s += Math.abs(f[k] - prev[k]);
          out.push(s / n);
        }
        prev = Buffer.from(f);
      }
    });
    p.on("error", reject);
    p.on("close", code => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg exited ${code}`))));
  });
  writeFileSync(cache, JSON.stringify(d.map(x => Math.round(x * 100) / 100)));
  return d;
}

/**
 * HARD CUTS: frames whose change is a jump against their neighbourhood — at least 10 and 6x the
 * median of the second around it. A Ken Burns drift, a moving clip or a talking host never gets
 * there (0.1-2); every scene cut on job 376 measured 30-108.
 */
export function detectCuts(d: number[]): number[] {
  const cuts: number[] = [];
  for (let k = 1; k < d.length; k++) {
    const around = [...d.slice(Math.max(1, k - 15), k - 1), ...d.slice(k + 2, k + 17)].sort((a, b) => a - b);
    const med = around[around.length >> 1] ?? 0;
    if (d[k] >= Math.max(10, 6 * med)) cuts.push(k);
  }
  return cuts;
}

/**
 * A FLASH: a picture that lasts 3 frames or fewer between two HARD cuts (both ≥ 20 — every scene
 * cut on job 376 measured 27-114; one step of an eased fade stays under it).
 */
export function flashes(d: number[], cutFrames: number[], maxFrames = 3, hard = 20): [number, number][] {
  const big = cutFrames.filter(k => d[k] >= hard);
  const out: [number, number][] = [];
  for (let i = 1; i < big.length; i++) if (big[i] - big[i - 1] <= maxFrames) out.push([big[i - 1], big[i]]);
  return out;
}

/**
 * Change the COMPOSITE adds in the frames right before each of the film's cuts. A graphic fading
 * out into a cut brightens the old shot for its last frames — a flicker no cut detector sees,
 * because each step is small. The film's own change is subtracted, so a moving clip is not blamed.
 */
export function preCutPumps(reel: number[], film: number[], cutFrames: number[], window = 5, limit = 3): { frame: number; added: number }[] {
  const out: { frame: number; added: number }[] = [];
  for (const c of cutFrames) {
    let added = 0;
    for (let k = Math.max(1, c - window); k < c; k++) added += Math.max(0, (reel[k] ?? 0) - (film[k] ?? 0));
    if (added > limit) out.push({ frame: c, added: Math.round(added * 10) / 10 });
  }
  return out;
}

/** 100 Hz loudness envelope of a stretch of a file's audio. */
async function envelope(ff: string, file: string, ss: number, t: number): Promise<number[]> {
  const raw: Buffer = await new Promise((resolve, reject) => {
    const p = spawn(ff, ["-hide_banner", "-loglevel", "error", "-ss", ss.toFixed(3), "-i", file, "-t", t.toFixed(3), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { windowsHide: true });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", reject);
    p.on("close", code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}`))));
  });
  const s = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  const env: number[] = [];
  for (let i = 0; i + 80 <= s.length; i += 80) {
    let a = 0;
    for (let k = i; k < i + 80; k++) a += Math.abs(s[k]);
    env.push(a / 80);
  }
  return env;
}

/**
 * How much LATER (ms, positive) the audio of `file` at `fileAt` plays than the film's audio at
 * `filmAt` — a cross-correlation of loudness envelopes at 10 ms resolution over ±300 ms.
 */
export async function audioOffsetMs(ff: string, file: string, fileAt: number, film: string, filmAt: number, len: number): Promise<number> {
  const a = await envelope(ff, file, fileAt, len);
  const b = await envelope(ff, film, filmAt - 0.3, len + 0.6);
  let best = -Infinity;
  let bestLag = 30;
  for (let lag = 0; lag <= 60; lag++) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * (b[i + lag] ?? 0);
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return (30 - bestLag) * 10;
}

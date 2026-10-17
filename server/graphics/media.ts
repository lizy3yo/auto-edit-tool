// The graphics step's ffmpeg work: frame-to-frame change, single frames, the film's narration.
// Every call goes through server/ffmpegSpawn (mp3 inputs named, a busy machine waited out).
import { execFfmpeg, retryUnstarted, spawnFfmpeg } from "../ffmpegSpawn";

const DIFF_W = 160;
const DIFF_H = 90;

/** Mean absolute luma change between consecutive frames (0-255, on a 160x90 greyscale copy).
 * `d[k]` is the change INTO frame k (d[0] = 0). */
export function frameDiffs(file: string): Promise<number[]> {
  const n = DIFF_W * DIFF_H;
  return retryUnstarted(() => new Promise<number[]>((resolve, reject) => {
    const p = spawnFfmpeg(["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${DIFF_W}:${DIFF_H},format=gray`, "-f", "rawvideo", "-"], { windowsHide: true });
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
          for (let i = 0; i < n; i++) s += Math.abs(f[i] - prev[i]);
          out.push(s / n);
        }
        prev = Buffer.from(f);
      }
    });
    let err = "";
    p.stderr.on("data", d => (err += d));
    p.on("error", reject);
    p.on("close", code => (code === 0 ? resolve(out) : reject(new Error(`frame diffs failed (${code}): ${err.slice(-300)}`))));
  }));
}

export const FRAME_W = 1920;
export const FRAME_H = 1080;

/** One full-size frame at `t` seconds: RGBA (a graphic, its alpha intact) or RGB (the film). */
export async function grabFrame(file: string, t: number, rgba: boolean): Promise<Uint8Array> {
  const { stdout } = await execFfmpeg(
    ["-hide_banner", "-loglevel", "error", "-ss", Math.max(0, t).toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=${FRAME_W}:${FRAME_H}`, "-pix_fmt", rgba ? "rgba" : "rgb24", "-f", "rawvideo", "-"],
    { encoding: "buffer", maxBuffer: 64 << 20, windowsHide: true }
  );
  const b = stdout as Buffer;
  const size = FRAME_W * FRAME_H * (rgba ? 4 : 3);
  if (b.length < size) throw new Error(`frame grab at ${t.toFixed(2)} s returned ${b.length} bytes`);
  return new Uint8Array(b.buffer, b.byteOffset, size);
}

/** The film's own sound as mono 16 kHz mp3 — what the word-timing transcription reads. */
export async function narrationOf(file: string): Promise<Buffer> {
  const { stdout } = await execFfmpeg(
    ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", "-f", "mp3", "-"],
    { encoding: "buffer", maxBuffer: 256 << 20, windowsHide: true }
  );
  return stdout as Buffer;
}

/** Run ffmpeg to completion (the composite pass). */
export async function ffmpeg(args: string[]): Promise<void> {
  await execFfmpeg(["-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 16 << 20, windowsHide: true });
}

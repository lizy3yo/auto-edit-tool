/**
 * server/ffmpegSpawn.ts
 *
 * The ONE way this server starts ffmpeg. Every call goes through `spawnFfmpeg`, which names the
 * format of any mp3 it is handed instead of letting ffmpeg guess.
 *
 * Why: ffmpeg guesses an input's format from its first bytes. A sub-second voice slice is mostly
 * its ID3 tag (69Labs stamps an AIGC label on every file), and the guess came back as raw VVC
 * VIDEO — the scene mux then found no audio stream ("-map 1:a matches no streams") and Mae's job
 * 219 lost the same scene on every assembly. Fixing it in the two builders that failed left eight
 * other spawn sites (the duration probe among them) guessing, so the fix lives here, where no
 * caller can skip it; `ffmpegSpawn.test.ts` fails if a new file spawns ffmpeg any other way.
 */
import { execFile, spawn, type ExecFileOptions, type SpawnOptionsWithoutStdio } from "child_process";
import { closeSync, openSync, readSync } from "fs";
import { freemem } from "os";
import { getFFmpegPath } from "./ffmpegPath";

/**
 * Whether a local file is an mp3, read off its first bytes: an ID3 tag, or an MPEG audio frame
 * sync with a real layer (layer bits 00 are ADTS AAC, which also starts 0xFFF, so they don't
 * count). Anything unreadable — a URL, a lavfi source, a missing file — is "not known". Pure
 * apart from the one 3-byte read.
 */
export function isMp3File(filePath: string): boolean {
  const protocol = /^[a-z][a-z0-9+.-]*:/i.test(filePath) && !/^[a-z]:[\\/]/i.test(filePath);
  if (!filePath || protocol) {
    return false; // a URL or protocol input (http:, anullsrc=…, pipe:) — nothing local to read
  }
  try {
    const fd = openSync(filePath, "r");
    try {
      const head = Buffer.alloc(3);
      if (readSync(fd, head, 0, 3, 0) < 3) return false;
      if (head.toString("latin1") === "ID3") return true;
      return head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** `-i <path>`, with `-f mp3` in front when the file is an mp3. */
export function audioInput(filePath: string): string[] {
  return isMp3File(filePath) ? ["-f", "mp3", "-i", filePath] : ["-i", filePath];
}

/**
 * The same args with `-f mp3` put in front of every `-i <mp3>` that does not already name its
 * format. Leaves everything else exactly as it was. Pure apart from the header reads.
 */
export function withInputFormats(args: readonly string[]): string[] {
  const out: string[] = [];
  // Whether THIS input already names its format anywhere among its own options (everything
  // since the previous input), e.g. `-f rawvideo -pix_fmt gray -s 480x270 -r 25 -i masks.gray`
  // — a raw mask of 255s starts 0xFF 0xFF, which the sniff reads as an MPEG sync (2026-09-30).
  let named = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-f") named = true;
    if (a === "-i" && k + 1 < args.length) {
      if (!named && isMp3File(args[k + 1])) out.push("-f", "mp3");
      named = false;
      out.push(a, args[++k]);
      continue;
    }
    out.push(a);
  }
  return out;
}

/** Start ffmpeg with `args` (mp3 inputs named). Same return as `child_process.spawn`. */
export function spawnFfmpeg(args: readonly string[], opts: SpawnOptionsWithoutStdio = {}) {
  return spawn(getFFmpegPath(), withInputFormats(args), opts);
}

/**
 * Whether an ffmpeg failure means the process never got going — the machine was out of room to
 * start it — as opposed to ffmpeg running and refusing the job. Linux says EAGAIN / ENOMEM;
 * Windows says `spawn UNKNOWN`, or starts a child that dies initialising with exit 3221225794
 * (0xC0000142). Nothing ran, so trying again cannot do harm. Pure — unit-tested.
 */
export function ffmpegNeverStarted(message: string): boolean {
  return /spawn (UNKNOWN|EAGAIN|ENOMEM|EMFILE|ENFILE)\b|\b3221225794\b|0xC0000142|Cannot allocate memory|malloc of size \d+ failed/i.test(
    message
  );
}

/**
 * Free memory, in MB, below which a new ffmpeg waits to start. Each process caps its own ffmpeg
 * count, but nothing looked at the whole MACHINE: three 3-min films rendering at once (2026-09-29)
 * ran nine encodes of up to ~1 GB each and left 0.9 of 13.9 GB free — x264 failed "malloc of size
 * … failed". Checking the computer's own free memory works across every process at once.
 */
export const FFMPEG_MIN_FREE_MB = Number(
  process.env.FFMPEG_MIN_FREE_MB ?? (process.env.VITEST ? 0 : 1024)
);
/** Never wait longer than this for memory — then start anyway (the retry below still guards). */
const MEMORY_WAIT_MAX_MS = 180_000;

/**
 * Wait until the machine has `minMb` of free memory, checking every 2-3 s (jittered, so processes
 * waiting together do not all start at once), for at most `maxMs`. Returns how long it waited.
 * `free` and `pauseMs` are injectable for tests.
 */
export async function waitForFreeMemory(
  minMb = FFMPEG_MIN_FREE_MB,
  maxMs = MEMORY_WAIT_MAX_MS,
  free: () => number = () => freemem() / 1048576,
  pauseMs: () => number = () => 2000 + Math.random() * 1000
): Promise<number> {
  const start = Date.now();
  let logged = false;
  while (free() < minMb && Date.now() - start < maxMs) {
    if (!logged) {
      console.warn(`[ffmpeg] only ${Math.round(free())} MB free — waiting for memory before starting`);
      logged = true;
    }
    await new Promise(r => setTimeout(r, pauseMs()));
  }
  return Date.now() - start;
}

/** Waits between tries of an ffmpeg that never started: 2 s, 5 s, 10 s, 20 s. */
export const UNSTARTED_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];

/**
 * Run `once` (one ffmpeg call), and while it fails because ffmpeg never started, wait and run it
 * again. Every ffmpeg call site goes through this, so a busy moment no longer fails a film at a
 * step with no retry of its own — Diane's job 222 died in narration slicing on `spawn UNKNOWN`,
 * and Pearl's job 220 in assembly on exit 3221225794. Any other failure is thrown at once.
 */
export async function retryUnstarted<T>(
  once: () => Promise<T>,
  delaysMs: readonly number[] = UNSTARTED_RETRY_DELAYS_MS
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      await waitForFreeMemory();
      return await once();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= delaysMs.length || !ffmpegNeverStarted(msg)) throw err;
      console.warn(
        `[ffmpeg] could not start (${msg.split("\n")[0].slice(0, 120)}) — machine busy, trying again in ${delaysMs[attempt] / 1000}s`
      );
      await new Promise(r => setTimeout(r, delaysMs[attempt]));
    }
  }
}

/**
 * Run ffmpeg to completion and collect its output — the `execFile` shape, for callers that read
 * frames off stdout. Same two protections as `spawnFfmpeg`: mp3 inputs are named, and a machine
 * too busy to start ffmpeg is waited out. The exit code is put into the message, because
 * execFile only says "Command failed" and the Windows start-up failure is recognised by its code.
 */
export function execFfmpeg(
  args: readonly string[],
  opts: ExecFileOptions & { encoding?: BufferEncoding | "buffer" | null } = {}
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  return retryUnstarted(
    () =>
      new Promise((resolve, reject) => {
        execFile(getFFmpegPath(), withInputFormats(args), opts, (err, stdout, stderr) => {
          if (!err) return resolve({ stdout, stderr });
          const code = (err as NodeJS.ErrnoException & { code?: unknown }).code;
          if (code != null && !err.message.includes(String(code))) err.message += ` (exit ${code})`;
          reject(err);
        });
      })
  );
}

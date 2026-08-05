import { existsSync } from "fs";
import { spawn } from "child_process";
import { getFFmpegPath } from "./ffmpegPath";

/** Hard ceiling on one duration probe of a local file. Env-overridable. */
const PROBE_MAX_MS = Number(process.env.PROBE_MAX_MS ?? 60_000);

/**
 * Get the duration of a media file in seconds using ffprobe.
 */
export async function getMediaDuration(filePath: string): Promise<number> {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = ffmpegPath.replace(/ffmpeg$/, "ffprobe");
  // If ffprobe doesn't exist alongside ffmpeg-static, use ffmpeg to probe
  const probeBin = existsSync(ffprobePath) ? ffprobePath : "ffprobe";

  return new Promise((resolve, reject) => {
    // `spawn` has no timeout, and a longform assembly calls this ~2× per scene (~500 times
    // on a 250-scene film) — one wedged probe parks the whole job with no DB write, which
    // is how a live job outlives the inactivity watchdog. Reading a local file's header
    // never legitimately takes a minute, so this is pure hang protection.
    let live: ReturnType<typeof spawn> | null = null;
    const killTimer = setTimeout(() => {
      live?.kill("SIGKILL");
      reject(new Error(`Duration probe timed out for ${filePath}`));
    }, PROBE_MAX_MS);
    const settle = <T>(fn: (v: T) => void) => {
      return (v: T) => {
        clearTimeout(killTimer);
        fn(v);
      };
    };
    const ok = settle(resolve);
    const fail = settle(reject);

    // Fallback: derive duration by parsing `ffmpeg -i` stderr. Used when ffprobe
    // is unavailable (ffmpeg-static ships ffmpeg only, no ffprobe) — covers both
    // a non-zero ffprobe exit and a spawn ENOENT (no ffprobe on PATH).
    const probeWithFfmpeg = () => {
      const ffProc = spawn(getFFmpegPath(), ["-i", filePath], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      live = ffProc;
      let ffErr = "";
      ffProc.on("error", err => fail(err));
      ffProc.stderr.on("data", d => {
        ffErr += d.toString();
      });
      ffProc.on("close", () => {
        const match = ffErr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (match) {
          const hours = parseInt(match[1]);
          const minutes = parseInt(match[2]);
          const seconds = parseInt(match[3]);
          const centiseconds = parseInt(match[4]);
          ok(hours * 3600 + minutes * 60 + seconds + centiseconds / 100);
        } else {
          fail(new Error(`Could not determine duration: ${ffErr}`));
        }
      });
    };

    const proc = spawn(probeBin, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    live = proc;

    let output = "";
    // ffprobe binary missing (ENOENT) emits "error", not "close" — fall back to ffmpeg.
    proc.on("error", () => probeWithFfmpeg());
    proc.stdout.on("data", d => {
      output += d.toString();
    });
    proc.on("close", code => {
      if (code !== 0) {
        probeWithFfmpeg();
      } else {
        const dur = parseFloat(output.trim());
        if (isNaN(dur)) fail(new Error(`Invalid duration output: ${output}`));
        else ok(dur);
      }
    });
  });
}

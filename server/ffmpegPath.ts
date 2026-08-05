/**
 * server/ffmpegPath.ts
 *
 * Single, ESM-safe resolver for the ffmpeg binary path.
 *
 * Production runs an ESM bundle (esbuild --format=esm), where a bare
 * `require("ffmpeg-static")` throws (`require` is undefined) — silently falling
 * back to the system `"ffmpeg"` string, which is not on PATH in the deploy
 * container (→ `spawn ffmpeg ENOENT`). A static ESM import of `ffmpeg-static`
 * (kept external by `--packages=external`) resolves the bundled binary reliably,
 * independent of PATH. System ffmpeg remains a last-resort fallback.
 */
import { existsSync } from "fs";
import { isAbsolute } from "path";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";

/** Absolute path to the bundled ffmpeg-static binary, falling back to system ffmpeg. */
export function getFFmpegPath(): string {
  // Explicit override (e.g. a local system ffmpeg with filters the bundled static
  // build lacks, like drawtext/libfreetype). Set automatically by resolveFFmpegPath()
  // when auto-detection finds a better binary.
  const override = process.env.FFMPEG_PATH;
  if (override) {
    // Absolute paths: verify the file still exists before trusting the override.
    // Bare names ("ffmpeg"): resolved via PATH by the OS at spawn time — existsSync
    // would always return false for a plain name, so skip the check.
    if (!isAbsolute(override) || existsSync(override)) {
      return override;
    }
  }
  if (
    typeof ffmpegStatic === "string" &&
    ffmpegStatic &&
    existsSync(ffmpegStatic)
  ) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}

function probeDrawtext(bin: string): Promise<boolean> {
  return new Promise(resolve => {
    // Use "-filters" to list compiled-in filters — no rendering, no font needed.
    // The previous render-based probe (drawtext=text=x without fontfile=) relied on
    // fontconfig to find a system font; minimal Nix containers have none, so it
    // returned exit 1 even when libfreetype was compiled in.
    const proc = spawn(bin, ["-hide_banner", "-filters"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.on("close", code =>
      resolve(code === 0 && /\bdrawtext\b/.test(stdout))
    );
    proc.on("error", () => resolve(false));
  });
}

/**
 * Spawn a login shell (`sh -l`) so that /etc/profile.d/*.sh is sourced —
 * this picks up Nix profile PATH additions that nixpacks may register via
 * profile scripts rather than Docker ENV, making `ffmpeg-full` findable even
 * when `process.env.PATH` doesn't include the Nix store bin dirs.
 * Returns the absolute path reported by `which ffmpeg`, or null if not found.
 */
function findFFmpegViaLoginShell(): Promise<string | null> {
  return new Promise(resolve => {
    const proc = spawn("sh", ["-l", "-c", "which ffmpeg 2>/dev/null"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    proc.on("close", code => {
      const p = out.trim();
      resolve(code === 0 && p ? p : null);
    });
    proc.on("error", () => resolve(null));
  });
}

let _resolved: { path: string; drawtext: boolean } | undefined;

/**
 * Resolve the best available FFmpeg binary, preferring one with drawtext
 * (libfreetype) support. Cached per process.
 *
 * - If FFMPEG_PATH is explicitly set in env, respects it unconditionally.
 * - Otherwise probes candidates in order: bundled ffmpeg-static →
 *   /usr/bin/ffmpeg → /usr/local/bin/ffmpeg → "ffmpeg" (PATH). The first
 *   candidate with drawtext support wins and is pinned via FFMPEG_PATH so
 *   getFFmpegPath() picks it up for all subsequent calls.
 */
export async function resolveFFmpegPath(): Promise<{
  path: string;
  drawtext: boolean;
}> {
  if (_resolved) return _resolved;

  const override = process.env.FFMPEG_PATH;
  if (override && existsSync(override)) {
    const drawtext = await probeDrawtext(override);
    _resolved = { path: override, drawtext };
    return _resolved;
  }

  // Log PATH once so Railway deploy logs show exactly what the process sees.
  console.log(
    "[FFmpeg] process PATH:",
    process.env.PATH?.slice(0, 300) ?? "(unset)"
  );

  // nixpacks on Railway registers Nix package paths via /etc/profile.d/*.sh —
  // those are only sourced by login shells, not inherited by direct Node spawns.
  // A login-shell `which` picks up ffmpeg-full even when it's absent from PATH.
  const loginShellPath = await findFFmpegViaLoginShell();
  if (loginShellPath) {
    console.log("[FFmpeg] login-shell found:", loginShellPath);
  }

  const candidates: string[] = [
    typeof ffmpegStatic === "string" && ffmpegStatic && existsSync(ffmpegStatic)
      ? ffmpegStatic
      : "",
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    // Nix profile symlinks — stable absolute paths in nixpacks/Railway Nix containers
    // where the Nix store may not be on the Node subprocess's inherited PATH.
    "/nix/var/nix/profiles/default/bin/ffmpeg",
    "/root/.nix-profile/bin/ffmpeg",
    // Login-shell discovery: catches ffmpeg-full when Nix PATH is only in profile scripts.
    loginShellPath ?? "",
    "ffmpeg",
  ].filter(Boolean);

  for (const c of candidates) {
    if (c !== "ffmpeg" && !existsSync(c)) continue;
    if (await probeDrawtext(c)) {
      process.env.FFMPEG_PATH = c;
      _resolved = { path: c, drawtext: true };
      return _resolved;
    }
  }

  const fallback =
    candidates.find(c => c === "ffmpeg" || existsSync(c)) ?? "ffmpeg";
  _resolved = { path: fallback, drawtext: false };
  return _resolved;
}

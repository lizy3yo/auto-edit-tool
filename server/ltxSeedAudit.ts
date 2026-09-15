/**
 * server/ltxSeedAudit.ts — pick, ONCE per host photo, the seeds this photo renders calmly on.
 *
 * Why: on LTX the eyes and brows of a render depend on the seed, and the same seed gives the
 * same face every time. Measured 2026-09-15 against the operator's accepted HeyGen clips:
 * HeyGen keeps the eyes at the photo's own size (eye ratio 0.96 / 1.09 on the two hosts);
 * our renders of Granny opened them 23-44% wider on every seed tried, worst on the seed the
 * scene hashing happened to hand her — the "startled" look — while the man's good renders
 * read 1.06-1.10. No wording removed it (three wordings on the same seed, same eyes), and
 * there is no dial for it: the eyes only exist once they are drawn.
 *
 * So the check moves BEFORE production: when a photo is first rendered, a few short clips
 * (`LTX_SEED_AUDIT_SEC` of the scene's own narration) are rendered on candidate seeds, the
 * worker reports the mouth's liveness and the eyes' width against the photo for each
 * (`timings.liveness`, `timings.expression`), and the seeds that pass are saved in
 * `app_settings` under the photo's key. Every scene of that photo then draws its seed from the
 * audited list instead of the raw hash, and a retry steps to the next audited seed. The audit
 * is per PHOTO, not per scene: one cost per new host photo, then production stops rolling the
 * dice on the face. A seed calm on a short line is not guaranteed calm on a long one; the
 * post-render expression gate (not built as of this note) is the safety net for that.
 *
 * Fails open everywhere: no worker reading, a failed snippet, a failed render ⇒ the scene
 * renders on its hash seed exactly as before, and the reason is logged.
 */
import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { getAppSetting, setAppSetting } from "./db";
import { storagePut } from "./storage";
import { downloadToTemp } from "./videoAssembly";
import { getFFmpegPath } from "./ffmpegPath";

/** Seeds tried for a photo, in this order. Small, stable, human-readable in the job JSON. */
export const CANDIDATE_SEEDS = [7, 11, 23, 42, 101, 202, 303, 404];
/** Eyes wider than this many times the photo's fail the audit (HeyGen 0.96-1.09; ours 1.23+). */
export const EYE_WIDE_RATIO = 1.2;
/** The worker's mouth-liveness floor — a frozen mouth fails the audit too. */
export const LIVENESS_FLOOR = 10;

export interface SeedTrial {
  seed: number;
  liveness: number | null;
  eyeRatio: number | null;
  wideFrac: number | null;
  error?: string;
}

export interface SeedAudit {
  /** Seeds that passed, calmest first; falls back to the least-wide when none passed. */
  seeds: number[];
  trials: SeedTrial[];
  /** True when no seed passed and `seeds` is the least-bad fallback. */
  noneCalm: boolean;
  sampleSec: number;
  auditedAt: string;
}

/** The app_settings key for a photo: its URL, hashed short. */
export function auditKeyFor(imageUrl: string): string {
  return `ltx_seed_audit:${createHash("sha1").update(imageUrl).digest("hex").slice(0, 16)}`;
}

/**
 * Read the two readings out of a worker's timings. The worker puts `liveness` (a number) and
 * `expression: {eye_ratio, wide_frac}` beside its stage timings; an older worker has neither.
 */
export function readingsFrom(
  timings: Record<string, unknown> | undefined
): Pick<SeedTrial, "liveness" | "eyeRatio" | "wideFrac"> {
  const live = timings?.liveness;
  const expr = timings?.expression as
    | { eye_ratio?: unknown; wide_frac?: unknown }
    | undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    liveness: num(live),
    eyeRatio: num(expr?.eye_ratio),
    wideFrac: num(expr?.wide_frac),
  };
}

/** The decision. Pure. A missing reading does not fail a seed — an older worker still works. */
export function selectSeeds(
  trials: SeedTrial[],
  opts: { eyeWideRatio?: number; livenessFloor?: number } = {}
): Pick<SeedAudit, "seeds" | "noneCalm"> {
  const wide = opts.eyeWideRatio ?? EYE_WIDE_RATIO;
  const floor = opts.livenessFloor ?? LIVENESS_FLOOR;
  const ok = trials.filter(
    t =>
      !t.error &&
      (t.liveness == null || t.liveness >= floor) &&
      (t.eyeRatio == null || t.eyeRatio <= wide)
  );
  const byCalm = (a: SeedTrial, b: SeedTrial) =>
    (a.eyeRatio ?? 1) - (b.eyeRatio ?? 1) || (b.liveness ?? 0) - (a.liveness ?? 0);
  if (ok.length) return { seeds: ok.sort(byCalm).map(t => t.seed), noneCalm: false };
  // Nothing passed: keep the seeds whose mouth moved, least wide first, so the scene still
  // renders on the best of a bad lot rather than on a seed nobody measured.
  const alive = trials.filter(t => !t.error && (t.liveness == null || t.liveness >= floor));
  const pool = alive.length ? alive : trials.filter(t => !t.error);
  return { seeds: pool.sort(byCalm).map(t => t.seed), noneCalm: true };
}

/** Which audited seed a scene renders on: stable per scene, stepping through the list on retry. */
export function pickAuditedSeed(
  audit: Pick<SeedAudit, "seeds">,
  scene: { index: number },
  bump = 0
): number | null {
  if (!audit.seeds.length) return null;
  return audit.seeds[(scene.index + bump) % audit.seeds.length];
}

/** The first `sec` seconds of a narration, re-hosted for the worker. */
async function narrationSnippet(audioUrl: string, sec: number): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ltx-audit-"));
  try {
    const src = await downloadToTemp(audioUrl, dir, "full.mp3");
    const out = path.join(dir, "snippet.mp3");
    const r = spawnSync(
      getFFmpegPath(),
      ["-y", "-loglevel", "error", "-i", src, "-t", sec.toFixed(2), "-c:a", "libmp3lame", "-q:a", "2", out],
      { encoding: "utf8" }
    );
    if (r.status !== 0) throw new Error(`ffmpeg snippet failed: ${r.stderr?.slice(0, 200)}`);
    const put = await storagePut(
      `ltx-audit/${createHash("sha1").update(audioUrl).digest("hex").slice(0, 12)}-${sec}s.mp3`,
      readFileSync(out),
      "audio/mpeg"
    );
    return put.url;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One in-flight audit per photo per process; 200 scenes of one host share one. */
const inFlight = new Map<string, Promise<SeedAudit | null>>();

/**
 * The audit for a photo — from app_settings when it exists, else run now. `render` submits
 * ONE candidate (the caller's own params with this seed and this audio) and returns the
 * worker's timings when it lands; the caller owns concurrency and metering.
 */
export async function ensureLtxSeedAudit(
  imageUrl: string,
  audioUrl: string,
  opts: {
    render: (seed: number, audioUrl: string) => Promise<Record<string, unknown> | undefined>;
    count?: number;
    sampleSec?: number;
    log?: (line: string) => void;
  }
): Promise<SeedAudit | null> {
  const key = auditKeyFor(imageUrl);
  const log = opts.log ?? ((l: string) => console.log(`[LTX seed audit] ${l}`));
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const stored = await getAppSetting(key);
        if (stored) {
          const audit = JSON.parse(stored) as SeedAudit;
          if (Array.isArray(audit.seeds) && audit.seeds.length) return audit;
        }
      } catch (err: any) {
        log(`stored audit unreadable (${err?.message ?? err}) — auditing again`);
      }
      const count = Math.max(1, Math.min(CANDIDATE_SEEDS.length, opts.count ?? 4));
      const sampleSec = opts.sampleSec ?? 2.5;
      const seeds = CANDIDATE_SEEDS.slice(0, count);
      try {
        const snippet = await narrationSnippet(audioUrl, sampleSec);
        log(`${imageUrl.split("/").pop()}: auditing seeds ${seeds.join(", ")} on a ${sampleSec}s snippet`);
        const trials: SeedTrial[] = await Promise.all(
          seeds.map(async seed => {
            try {
              const timings = await opts.render(seed, snippet);
              return { seed, ...readingsFrom(timings) };
            } catch (err: any) {
              return { seed, liveness: null, eyeRatio: null, wideFrac: null, error: String(err?.message ?? err).slice(0, 200) };
            }
          })
        );
        const picked = selectSeeds(trials);
        const audit: SeedAudit = { ...picked, trials, sampleSec, auditedAt: new Date().toISOString() };
        log(
          `${imageUrl.split("/").pop()}: ${trials
            .map(t => `${t.seed}: eyes ${t.eyeRatio ?? "?"} live ${t.liveness ?? "?"}${t.error ? " ERR" : ""}`)
            .join(" | ")} → seeds [${audit.seeds.join(", ")}]${audit.noneCalm ? " (none calm — least wide kept)" : ""}`
        );
        if (audit.seeds.length) await setAppSetting(key, JSON.stringify(audit));
        return audit.seeds.length ? audit : null;
      } catch (err: any) {
        log(`audit failed (${err?.message ?? err}) — rendering on the hash seed`);
        return null;
      }
    })();
    inFlight.set(key, pending);
    pending.then(a => {
      if (!a) inFlight.delete(key);
    });
  }
  return pending;
}

/** Test-only. */
export function __resetLtxSeedAuditCache(): void {
  inFlight.clear();
}

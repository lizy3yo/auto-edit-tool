/**
 * server/ltxSeedAudit.ts — pick, ONCE per host photo, the seeds (and the room-locking adapter's
 * strength) this photo renders well on: mouth alive, eyes calm, body moving WITH the head.
 *
 * Why: on LTX the eyes, the brows and how much of the body moves all depend on the seed, and
 * the same seed gives the same result every time. Measured 2026-09-15 against the operator's
 * accepted HeyGen clips: HeyGen keeps the eyes at the photo's own size (eye ratio 0.96 / 1.09);
 * our renders of Granny Mae opened them 23-44% wider on every seed tried. Measured 2026-09-16:
 * with the Cinemagraph adapter holding the room still, some renders froze the BODY too — Granny
 * Mae's head moving on a still cardigan with the braid adrift (body 0.11 / 0.12 of the head's
 * travel, HeyGen 0.18-0.31), Granny Ruth's hands frozen on her hoop (0.05 / 0.08 of the head,
 * 0.11 where hands move). No wording removes either for every photo, and neither exists until
 * it is drawn.
 *
 * So the check runs BEFORE production: the first time a photo is rendered, short clips
 * (`LTX_SEED_AUDIT_SEC` of the scene's own narration) are rendered on candidate seeds, the worker
 * reports liveness, the eyes and the body for each (`timings.liveness`, `timings.expression`,
 * `timings.body`), and when fewer than two pass, a second round tries more seeds with the
 * adapter at a lighter strength (it is what freezes the body). Every candidate is ranked, passing
 * ones first, and saved in `app_settings` under the photo's key. Every scene of that photo draws
 * from the passing picks (stable per scene), and a retry steps DOWN the ranking — never the same
 * seed twice. A seed good on a short line is not guaranteed good on a long one; the post-render
 * body gate in longformVideo is the safety net for that.
 *
 * Fails open everywhere: no worker reading, a failed snippet, a failed render ⇒ the scene renders
 * on its hash seed exactly as before, and the reason is logged.
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
/** Fewer passing candidates than this in round one ⇒ a second round at a lighter strength. */
export const MIN_PASSING = 2;
/** The second round's adapter strength, as a fraction of the configured one. */
export const LIGHTER_STRENGTH = 0.7;
/**
 * Bump when what counts as a pass changes, so every photo is audited again under the new rule.
 * v2 (2026-09-16): the body check joined liveness and the eyes.
 */
export const AUDIT_VERSION: number = 2;

export interface SeedPick {
  seed: number;
  /** The adapter's strength for this pick; null when no adapter is in use. */
  strength: number | null;
}

export interface SeedTrial extends SeedPick {
  liveness: number | null;
  eyeRatio: number | null;
  wideFrac: number | null;
  /** The worker's `max(shoulders, hands) / head` travel (null on an older worker). */
  bodyScore: number | null;
  /** The worker's hands-band score when the hands are in frame (null otherwise). */
  handsScore: number | null;
  /** The worker's verdict: the body does not move with the head. */
  bodyFrozen: boolean | null;
  error?: string;
}

export interface SeedAudit {
  version: number;
  /** Every usable candidate, best first; the first `passing` of them passed every check. */
  ranked: SeedPick[];
  passing: number;
  /** Seeds of the passing picks, for the log and older readers. */
  seeds: number[];
  trials: SeedTrial[];
  /** True when nothing passed and `ranked` is the least-bad order. */
  noneCalm: boolean;
  sampleSec: number;
  auditedAt: string;
}

/** The app_settings key for a photo: its URL, hashed short, under the audit's version. */
export function auditKeyFor(imageUrl: string): string {
  const h = createHash("sha1").update(imageUrl).digest("hex").slice(0, 16);
  return `ltx_seed_audit_v${AUDIT_VERSION}:${h}`;
}

/**
 * Read the readings out of a worker's timings. The worker puts `liveness` (a number),
 * `expression: {eye_ratio, wide_frac}` and `body: {body_score, hands_score, frozen}` beside its
 * stage timings; an older worker has some or none of them.
 */
export function readingsFrom(
  timings: Record<string, unknown> | undefined
): Pick<SeedTrial, "liveness" | "eyeRatio" | "wideFrac" | "bodyScore" | "handsScore" | "bodyFrozen"> {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const expr = timings?.expression as { eye_ratio?: unknown; wide_frac?: unknown } | undefined;
  const body = timings?.body as
    | { body_score?: unknown; hands_score?: unknown; frozen?: unknown }
    | undefined;
  return {
    liveness: num(timings?.liveness),
    eyeRatio: num(expr?.eye_ratio),
    wideFrac: num(expr?.wide_frac),
    bodyScore: num(body?.body_score),
    handsScore: num(body?.hands_score),
    bodyFrozen: typeof body?.frozen === "boolean" ? body.frozen : null,
  };
}

/** Does a trial pass every check? A missing reading does not fail it — an older worker still works. */
export function passes(
  t: SeedTrial,
  opts: { eyeWideRatio?: number; livenessFloor?: number } = {}
): boolean {
  const wide = opts.eyeWideRatio ?? EYE_WIDE_RATIO;
  const floor = opts.livenessFloor ?? LIVENESS_FLOOR;
  return (
    !t.error &&
    (t.liveness == null || t.liveness >= floor) &&
    (t.eyeRatio == null || t.eyeRatio <= wide) &&
    t.bodyFrozen !== true
  );
}

/**
 * The ranking. Pure. Passing trials first (calmest eyes, then the most body movement); then the
 * rest by how badly they failed — a frozen mouth is the worst, a frozen body next, wide eyes
 * last — so a scene that has to step past every pass lands on the least-bad render.
 */
export function rankTrials(
  trials: SeedTrial[],
  opts: { eyeWideRatio?: number; livenessFloor?: number } = {}
): Pick<SeedAudit, "ranked" | "passing" | "seeds" | "noneCalm"> {
  const floor = opts.livenessFloor ?? LIVENESS_FLOOR;
  const usable = trials.filter(t => !t.error);
  const ok = usable.filter(t => passes(t, opts));
  const bad = usable.filter(t => !passes(t, opts));
  const byQuality = (a: SeedTrial, b: SeedTrial) =>
    (a.eyeRatio ?? 1) - (b.eyeRatio ?? 1) || (b.bodyScore ?? 0) - (a.bodyScore ?? 0) || (b.liveness ?? 0) - (a.liveness ?? 0);
  const penalty = (t: SeedTrial) =>
    (t.liveness != null && t.liveness < floor ? 4 : 0) + (t.bodyFrozen === true ? 2 : 0) + ((t.eyeRatio ?? 1) > (opts.eyeWideRatio ?? EYE_WIDE_RATIO) ? 1 : 0);
  ok.sort(byQuality);
  bad.sort((a, b) => penalty(a) - penalty(b) || byQuality(a, b));
  const ranked = [...ok, ...bad].map(t => ({ seed: t.seed, strength: t.strength }));
  return { ranked, passing: ok.length, seeds: ok.map(t => t.seed), noneCalm: ok.length === 0 };
}

/**
 * Which pick a scene renders on. Stable per scene among the passing picks; a retry (`bump`)
 * steps down the whole ranking, so it never repeats a seed. Null when the ranking is exhausted
 * (the caller falls back to the hash seed).
 */
export function pickAuditedSeed(
  audit: Pick<SeedAudit, "ranked" | "passing">,
  scene: { index: number },
  bump = 0
): SeedPick | null {
  if (!audit.ranked?.length) return null;
  const pool = Math.max(1, audit.passing || audit.ranked.length);
  const idx = (scene.index % pool) + bump;
  return idx < audit.ranked.length ? audit.ranked[idx] : null;
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

const describeTrial = (t: SeedTrial) =>
  `${t.seed}${t.strength != null ? `@${t.strength}` : ""}: eyes ${t.eyeRatio ?? "?"} live ${t.liveness ?? "?"} body ${t.bodyScore ?? "?"}${t.handsScore != null ? `/hands ${t.handsScore}` : ""}${t.bodyFrozen ? " FROZEN" : ""}${t.error ? " ERR" : ""}`;

/** One in-flight audit per photo per process; 200 scenes of one host share one. */
const inFlight = new Map<string, Promise<SeedAudit | null>>();

/**
 * The audit for a photo — from app_settings when it exists under the current version, else run
 * now. `render` submits ONE candidate (the caller's own params with this seed, this audio and
 * this adapter strength) and returns the worker's timings when it lands; the caller owns
 * concurrency and metering. `strength` is the configured adapter strength, or null without one
 * (then there is no lighter second round).
 */
export async function ensureLtxSeedAudit(
  imageUrl: string,
  audioUrl: string,
  opts: {
    render: (seed: number, audioUrl: string, strength: number | null) => Promise<Record<string, unknown> | undefined>;
    strength?: number | null;
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
      const name = imageUrl.split("/").pop();
      try {
        const stored = await getAppSetting(key);
        if (stored) {
          const audit = JSON.parse(stored) as SeedAudit;
          if (audit.version === AUDIT_VERSION && Array.isArray(audit.ranked) && audit.ranked.length) return audit;
        }
      } catch (err: any) {
        log(`stored audit unreadable (${err?.message ?? err}) — auditing again`);
      }
      const count = Math.max(1, Math.min(CANDIDATE_SEEDS.length / 2, opts.count ?? 4));
      const sampleSec = opts.sampleSec ?? 2.5;
      const base = opts.strength ?? null;
      const runRound = async (picks: SeedPick[]): Promise<SeedTrial[]> =>
        Promise.all(
          picks.map(async p => {
            try {
              const timings = await opts.render(p.seed, snippet, p.strength);
              return { ...p, ...readingsFrom(timings) };
            } catch (err: any) {
              return {
                ...p,
                liveness: null, eyeRatio: null, wideFrac: null, bodyScore: null, handsScore: null, bodyFrozen: null,
                error: String(err?.message ?? err).slice(0, 200),
              };
            }
          })
        );
      let snippet = "";
      try {
        snippet = await narrationSnippet(audioUrl, sampleSec);
        const first = CANDIDATE_SEEDS.slice(0, count).map(seed => ({ seed, strength: base }));
        log(`${name}: auditing ${first.map(p => p.seed).join(", ")}${base != null ? ` at adapter ${base}` : ""} on a ${sampleSec}s snippet`);
        let trials = await runRound(first);
        if (rankTrials(trials).passing < MIN_PASSING && base != null) {
          const lighter = Math.round(base * LIGHTER_STRENGTH * 100) / 100;
          const second = CANDIDATE_SEEDS.slice(count, count * 2).map(seed => ({ seed, strength: lighter }));
          log(`${name}: ${rankTrials(trials).passing} passed — a second round at adapter ${lighter}`);
          trials = [...trials, ...(await runRound(second))];
        }
        const picked = rankTrials(trials);
        const audit: SeedAudit = { version: AUDIT_VERSION, ...picked, trials, sampleSec, auditedAt: new Date().toISOString() };
        log(
          `${name}: ${trials.map(describeTrial).join(" | ")} → ${audit.passing} passing [${audit.ranked
            .slice(0, Math.max(1, audit.passing))
            .map(p => `${p.seed}${p.strength != null ? `@${p.strength}` : ""}`)
            .join(", ")}]${audit.noneCalm ? " (none passed — least-bad order kept)" : ""}`
        );
        if (audit.ranked.length) {
          try {
            await setAppSetting(key, JSON.stringify(audit));
          } catch (err: any) {
            log(`audit not remembered (${err?.message ?? err}) — it still applies to this run`);
          }
        }
        return audit.ranked.length ? audit : null;
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

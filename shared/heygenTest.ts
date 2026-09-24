/**
 * The HeyGen test bench (the "HeyGen test" page): which host photo makes the best talking head.
 *
 * One script is voiced ONCE in a channel's voice and every photo in the run is lip-synced from
 * that same audio, so the photo is the only thing that differs between the clips. The limits
 * live here so the form and the server refuse the same thing — the form to say so before the
 * click, the server because the client is not the lock.
 */
import { ESTIMATE_WORDS_PER_SEC } from "./hostMinutes";

/** The voiced audio is cut to this before HeyGen sees it: the hard cap on one clip's cost. */
export const HEYGEN_TEST_MAX_SEC = 30;

/** ~30 s at the pipeline's calibrated read rate (2.8 words/s). */
export const HEYGEN_TEST_MAX_WORDS = Math.round(
  HEYGEN_TEST_MAX_SEC * ESTIMATE_WORDS_PER_SEC
);

/** Photos per run — each one is a separate paid HeyGen render. */
export const HEYGEN_TEST_MAX_IMAGES = 4;

/** Optional run name (the `runName` column's width). */
export const HEYGEN_TEST_MAX_NAME = 120;

/** Runs (Generate clicks) per page of the results list. */
export const HEYGEN_TEST_RUNS_PER_PAGE = 5;

/**
 * The page buttons to show: every page when there are few, otherwise the first, the last and
 * the current page's neighbours with "…" for each gap — `1 … 4 5 6 … 12`. The list is always the
 * same length (7) once the gaps appear, so the buttons do not jump about as you page.
 */
export function pageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
  if (current >= total - 3)
    return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "…", current - 1, current, current + 1, "…", total];
}

/** Words as the pipeline counts them for pacing: whitespace-separated tokens. */
export function countScriptWords(script: string): number {
  const t = script.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Seconds the script should read in, capped at what will actually be rendered. */
export function estimateTestSeconds(script: string): number {
  return Math.min(
    HEYGEN_TEST_MAX_SEC,
    countScriptWords(script) / ESTIMATE_WORDS_PER_SEC
  );
}

/** Why a run would be refused, or null when it can go. */
export function heygenTestInputError(input: {
  script: string;
  imageUrls: string[];
}): string | null {
  const words = countScriptWords(input.script);
  if (words === 0) return "Write a script for the host to say.";
  if (words > HEYGEN_TEST_MAX_WORDS)
    return `The script is ${words} words — keep it to ${HEYGEN_TEST_MAX_WORDS} (about ${HEYGEN_TEST_MAX_SEC} s).`;
  if (input.imageUrls.length === 0) return "Add at least one photo.";
  if (input.imageUrls.length > HEYGEN_TEST_MAX_IMAGES)
    return `At most ${HEYGEN_TEST_MAX_IMAGES} photos per run.`;
  if (new Set(input.imageUrls).size !== input.imageUrls.length)
    return "The same photo is in the run twice.";
  return null;
}

/** A tab's HeyGen account (`heygen_key_slot_N`) or the shared `HEYGEN_API_KEY`. */
export type HeygenTestAccount = number | "shared";

/**
 * Progress for one clip, as the page's bar shows it. HeyGen reports a STAGE, never a percentage,
 * so within a stage this is an estimate from elapsed time against that stage's typical length:
 * linear to 90% of the stage's share at the typical time, then easing toward (never reaching)
 * the share's end — so the bar slows rather than stalls or lies when a stage runs long, never
 * goes backwards across a stage change, and only shows 100 when the clip is actually done.
 */
export type HeygenTestPhase = "voicing" | "preparing" | "rendering";

export const HEYGEN_TEST_PHASES: Record<
  HeygenTestPhase,
  { label: string; from: number; to: number }
> = {
  voicing: { label: "Voicing script", from: 0, to: 15 },
  preparing: { label: "Preparing photo", from: 15, to: 30 },
  rendering: { label: "Rendering on HeyGen", from: 30, to: 100 },
};

/** Typical seconds per stage. Rendering: Avatar IV takes ~6.5 s per second of video, plus queue. */
export function typicalPhaseSec(
  phase: HeygenTestPhase,
  audioSec: number
): number {
  if (phase === "voicing") return 25;
  if (phase === "preparing") return 90;
  return Math.max(45, audioSec * 6.5 + 20);
}

export function heygenTestProgress(
  row: {
    status: string;
    videoId: string | null;
    audioMs: number | null;
    phaseStartedAt: Date | string | null;
  },
  nowMs: number,
  /** Fallback clip length before the audio exists (the script's estimate). */
  estimateSec: number
): {
  phase: HeygenTestPhase;
  label: string;
  percent: number;
  etaSec: number;
  /** This stage is past its typical length — the page says so instead of a stale estimate. */
  overdue: boolean;
} | null {
  const phase: HeygenTestPhase | null =
    row.status === "voicing"
      ? "voicing"
      : row.status === "rendering"
        ? row.videoId
          ? "rendering"
          : "preparing"
        : null;
  if (!phase) return null;
  const audioSec = row.audioMs ? row.audioMs / 1000 : estimateSec;
  const typical = typicalPhaseSec(phase, audioSec);
  const started = row.phaseStartedAt
    ? new Date(row.phaseStartedAt).getTime()
    : nowMs;
  const t = Math.max(0, (nowMs - started) / 1000);
  const fill =
    t <= typical
      ? 0.9 * (t / typical)
      : 0.9 + 0.09 * (1 - Math.exp(-(t - typical) / typical));
  const { label, from, to } = HEYGEN_TEST_PHASES[phase];
  const later = (["voicing", "preparing", "rendering"] as const)
    .slice(["voicing", "preparing", "rendering"].indexOf(phase) + 1)
    .reduce((sum, p) => sum + typicalPhaseSec(p, audioSec), 0);
  return {
    phase,
    label,
    percent: Math.min(99, Math.floor(from + (to - from) * fill)),
    etaSec: Math.max(0, typical - t) + later,
    overdue: t > typical,
  };
}

/**
 * The plain-language line a failed clip shows. The raw error (HeyGen's JSON, status codes, our
 * internal wording) stays on the row for debugging and is offered as the card's hover text; an
 * operator reads what happened and what to do about it. Ordered: the first match wins, so the
 * specific cases sit above the general ones.
 */
const FRIENDLY_ERRORS: [RegExp, string][] = [
  // Voicing — the one step every clip in a run shares.
  [
    /voice id .*not found|voicenotfound/i,
    "The channel's voice couldn't be found. Check the voice under Channels, then retry.",
  ],
  [
    /censor/i,
    "The voice service wouldn't read this script. Reword it and try again.",
  ],
  [
    /voicing failed|voiced audio/i,
    "The script couldn't be voiced. Please retry.",
  ],
  // The photo, while HeyGen prepares it.
  [
    /still processing|resource_not_ready|missing image dimensions|not ready within/i,
    "HeyGen took too long to prepare this photo. Please retry.",
  ],
  [
    /\bfaces?\b/i,
    "HeyGen couldn't find a clear face in this photo. Try a front-facing photo of one person.",
  ],
  // The account — above the photo catch-all, so a bad key is never blamed on the photo.
  [
    /key has been removed/i,
    "This HeyGen account no longer has a key. An admin needs to add it in Provider keys.",
  ],
  [
    /\((401|403)\)|unauthori[sz]ed|invalid api key|forbidden/i,
    "This HeyGen account's key isn't working. An admin needs to update it in Provider keys.",
  ],
  [
    /\(402\)|insufficient|\bcredits?\b|quota|balance/i,
    "This HeyGen account is out of credits. Top it up, then retry.",
  ],
  [
    /\(429\)|rate limit|too many requests/i,
    "HeyGen is busy right now. Please retry in a minute.",
  ],
  // The connection — also above the photo catch-all: a HeyGen outage is not the photo's fault.
  [
    /\(5\d\d\)|fetch failed|network|econnreset|etimedout|socket|timed out|abort/i,
    "Couldn't reach HeyGen. Please retry.",
  ],
  [
    /avatar registration failed/i,
    "HeyGen couldn't use this photo. Try a different photo.",
  ],
  [
    /server restart/i,
    "Stopped by a server update before it started. Nothing was charged — please retry.",
  ],
  [
    /render failed|refused the render|returned no video|download failed|video not found/i,
    "HeyGen couldn't finish this video. Please retry.",
  ],
];

export function friendlyHeygenTestError(raw: string): string {
  for (const [pattern, message] of FRIENDLY_ERRORS)
    if (pattern.test(raw)) return message;
  return "Something went wrong with this clip. Please retry.";
}

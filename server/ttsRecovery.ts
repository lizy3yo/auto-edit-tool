/**
 * server/ttsRecovery.ts
 *
 * Wait out a voice-provider outage instead of failing the render at voicing.
 *
 * The master narration is the first paid step, and when the voice provider is down it used to
 * fail the whole job on the spot. The operator then had to paste the script again, or press
 * "Retry failed scenes" — which, on a job with no narration at all, voiced every scene as its
 * own request: 229 submits into the same outage, every one failing "TTS generation failed", and
 * a choppy film even when it worked (a hosted job, 2026-09-26).
 *
 * Now a narration failure is sorted first (`classifyNarrationFailure`):
 *   - WAIT — an outage, a timeout, an unexplained FAILED, a jam. The job stays "processing" on
 *     the voiceover stage, sends the provider one tiny test line in the film's own voice every
 *     `TTS_WAIT_CHECK_MS`, and as soon as that comes back it records the narration again and the
 *     render carries on by itself — same script, same settings, nothing re-entered.
 *   - STOP — things time does not fix (the voice is gone, no credits, the key is rejected, the
 *     text was blocked). The job fails at once with what to fix.
 *
 * A broken VOICE looks exactly like an outage (the task queues and fails with no useful reason),
 * so a failed check also tries another channel's voice; when that works `VOICE_STUCK_CHECKS`
 * times in a row the job stops and says to pick a different voice, instead of waiting 2 hours.
 *
 * Bounded twice, because a re-voicing is a whole paid read: the wait gives up
 * `TTS_WAIT_MAX_MS` after it began (`ttsWait.since`, persisted, so a restart does not reset
 * it), and at most `TTS_WAIT_MAX_REVOICES` automatic re-voicings are started. It never moves the
 * film to another vendor — that is the operator's choice (`inputParams.ttsVendor`).
 *
 * Everything here is pure or takes its effects as `deps`, so the loop is tested without a
 * provider, a database or a clock. `longformVideo.ts` wires it.
 */
import type { StoryboardScene, TtsWaitState } from "@shared/types";
import { describeError } from "./_core/errorDetail";

const envMs = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** How often a waiting job sends its test line. */
export const TTS_WAIT_CHECK_MS = envMs("TTS_WAIT_CHECK_MS", 5 * 60_000);
/** How long a job waits for the provider before it gives up. */
export const TTS_WAIT_MAX_MS = envMs("TTS_WAIT_MAX_MS", 2 * 60 * 60_000);
/** Automatic re-voicings after the first failure (each is a whole paid read). */
export const TTS_WAIT_MAX_REVOICES = Math.floor(
  envMs("TTS_WAIT_MAX_REVOICES", 2)
);

/** The line the health check voices — short, so a check costs next to nothing. */
export const TTS_PROBE_TEXT = "This is a quick voice check.";

/**
 * Thrown by the pipeline when recording the master narration failed. Carries the original error
 * (`cause`) and the vendor, so the pipeline's catch can tell a voicing failure from any other.
 */
export class NarrationFailedError extends Error {
  readonly vendor: string;
  constructor(cause: unknown, vendor: string) {
    super(`Narration failed: ${describeError(cause)}`);
    this.name = "NarrationFailedError";
    this.vendor = vendor;
    (this as { cause?: unknown }).cause = cause;
  }
}

export function ttsVendorLabel(providerType: string): string {
  return providerType === "minimax" ? "MiniMax" : "69Labs";
}

export type StopReason =
  "voice" | "voiceStuck" | "credits" | "censored" | "auth" | "config";
export type FailureVerdict =
  { kind: "wait" } | { kind: "stop"; reason: StopReason };

/**
 * Wait, or stop and tell a person? Reads the error's class name and message, since the errors
 * come from two vendors' adapters and the class does not always survive (a probe reports a
 * string). Anything unrecognised WAITS: the wait is bounded, and an unexplained failure is the
 * outage case this exists for. Pure.
 */
export function classifyNarrationFailure(err: unknown): FailureVerdict {
  const name = String((err as { name?: string } | null)?.name ?? "");
  const msg =
    typeof err === "string"
      ? err
      : String((err as { message?: string } | null)?.message ?? err ?? "");
  if (name === "CensoredTTSError" || /censor|content moderation/i.test(msg)) {
    return { kind: "stop", reason: "censored" };
  }
  if (
    name === "VoiceNotFoundError" ||
    /rejected (the )?voice|voice id.{0,40}not found/i.test(msg)
  ) {
    return { kind: "stop", reason: "voice" };
  }
  if (
    name === "TTSCreditError" ||
    /credits? depleted|out of credits|insufficient (credits?|balance)/i.test(
      msg
    )
  ) {
    return { kind: "stop", reason: "credits" };
  }
  if (
    /authentication failed|unauthori[sz]ed|forbidden|invalid api key|\((401|403)\)/i.test(
      msg
    )
  ) {
    return { kind: "stop", reason: "auth" };
  }
  if (
    /unsupported tts provider|no minimax api key|no minimax voice id/i.test(msg)
  ) {
    return { kind: "stop", reason: "config" };
  }
  return { kind: "wait" };
}

const STOP_ADVICE: Record<StopReason, (vendor: string) => string> = {
  voice: v =>
    `the channel's voice isn't available on ${v} (it may have been deleted, or belong to ` +
    `another account). Fix the voice in Admin → Channels, then press "Try voicing again"`,
  voiceStuck: v =>
    `${v} is working, but not with this channel's voice — a test line in it failed twice ` +
    `while another channel's voice worked straight away. Pick a different voice in Admin → ` +
    `Channels (or ask ${v} support about this voice ID), then start the video again`,
  credits: v =>
    `${v} is out of credits. Top up the account, then press "Try voicing again"`,
  censored: v =>
    `${v} blocked part of the script with its content filter. Change the flagged wording and ` +
    `start a new render`,
  auth: v =>
    `${v} rejected the API key. Check it in Admin → Provider Keys, then press "Try voicing again"`,
  config: () =>
    `the voice provider isn't set up for this render. Check Admin → Provider Keys and ` +
    `Admin → Channels, then press "Try voicing again"`,
};

const detail = (error: string) =>
  error.length > 300 ? `${error.slice(0, 299)}…` : error;

export function stopMessage(
  vendor: string,
  reason: StopReason,
  error: string
): string {
  return `Narration failed: ${STOP_ADVICE[reason](vendor)}. (${vendor} said: ${detail(error)})`;
}

export function gaveUpMessage(wait: TtsWaitState, now: number): string {
  const mins = Math.max(1, Math.round((now - Date.parse(wait.since)) / 60_000));
  return (
    `Narration failed: ${wait.vendor} still wasn't working after waiting ${mins} min. ` +
    `Nothing has been paid for clips. Press "Try voicing again" once it's back, or upload ` +
    `your own narration. (Last error: ${detail(wait.lastError)})`
  );
}

export function tooManyMessage(wait: TtsWaitState): string {
  return (
    `Narration failed: ${wait.vendor} failed ${wait.revoices + 1} times in a row while ` +
    `recording the narration, even though its voice check passed each time. Press "Try ` +
    `voicing again" to try once more, or upload your own narration. ` +
    `(Last error: ${detail(wait.lastError)})`
  );
}

export type NarrationFailurePlan =
  { action: "wait"; wait: TtsWaitState } | { action: "fail"; message: string };

/**
 * What to do when recording the master narration fails. `prior` is the job's wait if it was
 * already waiting (a re-voicing that failed again). Pure.
 */
export function planNarrationFailure(input: {
  prior?: TtsWaitState;
  cause: unknown;
  vendor: string;
  now: number;
}): NarrationFailurePlan {
  const { prior, cause, vendor, now } = input;
  const error = describeError(cause);
  const verdict = classifyNarrationFailure(cause);
  if (verdict.kind === "stop") {
    return {
      action: "fail",
      message: stopMessage(vendor, verdict.reason, error),
    };
  }
  if (!prior) {
    return {
      action: "wait",
      wait: {
        since: new Date(now).toISOString(),
        revoices: 0,
        lastError: error,
        vendor,
      },
    };
  }
  const wait = { ...prior, lastError: error };
  if (now - Date.parse(prior.since) >= TTS_WAIT_MAX_MS) {
    return { action: "fail", message: gaveUpMessage(wait, now) };
  }
  if (prior.revoices >= TTS_WAIT_MAX_REVOICES) {
    return { action: "fail", message: tooManyMessage(wait) };
  }
  return { action: "wait", wait };
}

/** The card's line while waiting. `check` counts from 1. */
export function waitLabel(wait: TtsWaitState, check: number): string {
  const every = Math.round(TTS_WAIT_CHECK_MS / 60_000);
  const upTo = Math.round(TTS_WAIT_MAX_MS / 60_000);
  const limit = upTo % 60 === 0 ? `${upTo / 60} h` : `${upTo} min`;
  return (
    `Waiting for ${wait.vendor} — checking every ${every} min, up to ${limit}` +
    (check > 1 ? ` (check ${check})` : "")
  );
}

/** How far into the wait, 0-100 — the card's bar fills as the wait runs out. */
export function waitPct(wait: TtsWaitState, now: number): number {
  const frac = (now - Date.parse(wait.since)) / TTS_WAIT_MAX_MS;
  return Math.round(Math.min(1, Math.max(0, frac)) * 100);
}

/** The job fields `diedBeforeNarration` reads — a job row satisfies it. */
export interface NarrationJobLike {
  status: string;
  masterAudioUrl?: string | null;
  storyboard?: unknown;
}

/**
 * A render that stopped before it was ever voiced: no narration track, and nothing on the
 * board voiced or rendered. The one safe thing to do with it is to run it again from the top —
 * nothing downstream of voicing has been paid for. It is ALSO the case where "Retry failed
 * scenes" used to voice every scene as its own request, so that button routes here instead.
 * Pure.
 */
export function diedBeforeNarration(job: NarrationJobLike): boolean {
  if (job.status === "processing" || job.masterAudioUrl) return false;
  const scenes = Array.isArray(job.storyboard)
    ? (job.storyboard as StoryboardScene[])
    : [];
  return !scenes.some(s => !!(s.audioUrl || s.clipUrls?.length || s.clipUrl));
}

// ─── The wait loop ─────────────────────────────────────────────────

/**
 * A voice that fails while another voice on the same account works this many checks IN A ROW is
 * broken, not waiting on an outage. More than one, so a momentary queue on one voice is not
 * mistaken for it.
 */
export const VOICE_STUCK_CHECKS = 2;

export type ProbeResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      name?: string;
      /**
       * Whether another voice on the same account worked at the same moment: true ⇒ the
       * provider is up and the film's voice is the problem; false/undefined ⇒ an outage (or
       * nothing to compare against).
       */
      othersWork?: boolean;
    };

export interface TtsWaitDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** False once the job was cancelled, restarted by hand, or otherwise moved on. */
  stillWaiting(): Promise<boolean>;
  /** Voice the test line in the film's own voice. */
  probe(): Promise<ProbeResult>;
  /** Show where the wait is on the job card. */
  report(label: string, pct: number): void;
  /** Keep the latest error on the row. */
  save(wait: TtsWaitState): Promise<void>;
  /** The provider answered: record the narration again (and carry on). */
  revoice(wait: TtsWaitState): Promise<void>;
  fail(message: string): Promise<void>;
}

/** One live loop per job, with a way to cut its sleep short ("Try voicing again" while waiting). */
const _waiters = new Map<number, () => void>();

export function isTtsWaiting(jobId: number): boolean {
  return _waiters.has(jobId);
}

/** Check now instead of at the next interval. False when no loop is running for the job. */
export function wakeTtsWaiter(jobId: number): boolean {
  const wake = _waiters.get(jobId);
  if (!wake) return false;
  wake();
  return true;
}

/**
 * Wait for the provider, then re-voice. Returns when the job has been handed on (re-voiced,
 * failed, or taken over by someone else). A second call for a job already waiting is a no-op.
 */
export async function runTtsWait(
  jobId: number,
  initial: TtsWaitState,
  deps: TtsWaitDeps
): Promise<void> {
  if (_waiters.has(jobId)) return;
  let wakeNow: () => void = () => {};
  _waiters.set(jobId, () => wakeNow());
  const wait: TtsWaitState = { ...initial };
  const deadline = Date.parse(wait.since) + TTS_WAIT_MAX_MS;
  let released = false;
  const release = () => {
    if (!released) _waiters.delete(jobId);
    released = true;
  };
  // Checks in a row where the film's voice failed and another voice worked.
  let stuck = 0;
  try {
    for (let check = 1; ; check++) {
      deps.report(waitLabel(wait, check), waitPct(wait, deps.now()));
      // The first check runs at once: it is what tells a broken voice from an outage, and a
      // broken voice should not cost the operator a whole interval to find out about.
      const delay =
        check === 1
          ? 0
          : Math.max(0, Math.min(TTS_WAIT_CHECK_MS, deadline - deps.now()));
      await Promise.race([
        deps.sleep(delay),
        new Promise<void>(resolve => (wakeNow = resolve)),
      ]);
      wakeNow = () => {};
      if (!(await deps.stillWaiting())) return;

      const r = await deps.probe();
      if (r.ok) {
        if (wait.revoices >= TTS_WAIT_MAX_REVOICES) {
          await deps.fail(tooManyMessage(wait));
          return;
        }
        // Released BEFORE the re-voice: if it fails again, the pipeline comes straight back
        // here to wait some more, and must find the slot free.
        release();
        await deps.revoice({ ...wait, revoices: wait.revoices + 1 });
        return;
      }
      wait.lastError = r.error;
      const verdict = classifyNarrationFailure({
        name: r.name,
        message: r.error,
      });
      if (verdict.kind === "stop") {
        await deps.fail(stopMessage(wait.vendor, verdict.reason, r.error));
        return;
      }
      // The provider is up and only this voice fails — waiting will not fix that (Werner's
      // voice, 2026-09-26: queued, never started, failed ~4 min later, while every other
      // channel's voice answered in under a minute).
      stuck = r.othersWork ? stuck + 1 : 0;
      if (stuck >= VOICE_STUCK_CHECKS) {
        await deps.fail(stopMessage(wait.vendor, "voiceStuck", r.error));
        return;
      }
      if (deps.now() >= deadline) {
        await deps.fail(gaveUpMessage(wait, deps.now()));
        return;
      }
      await deps.save(wait);
    }
  } finally {
    release();
  }
}

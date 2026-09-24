/**
 * The two ways a host render can end without a clip that are NOT the beat's own failure, kept
 * apart from ordinary errors so the render paths can treat them as what they are.
 *
 * ACCOUNT failures (`HostAccountError`) — a rejected key, no credits, HeyGen down or refusing
 * every call. Every host beat in the job would fail the same way, and none of them is at fault:
 * burning their retries would spend the per-beat allowance (`shared/hostRegenLimit.ts`) on a
 * problem a render cannot fix, and making them b-roll would strip the host out of the film over
 * a billing issue. So the job PAUSES the host lane instead: the first beat to hit one records it
 * here, every other host submit in the job fails fast with the same reason without calling
 * HeyGen, the beats are left clip-less with `scene.hostWaiting`, and the job stops at the
 * assembly gate naming the account. "Retry failed scenes" (or any render click) lifts the pause.
 * HeyGen accepted nothing, so nothing was billed and no ledger entry exists to count.
 *
 * CAP refusals (`HostRenderCapError`) — the beat has used the renders it is allowed. Thrown by
 * the render gate before anything is submitted.
 */

/** The job's HeyGen account failed; the reason is operator copy, `raw` the provider's words. */
export class HostAccountError extends Error {
  constructor(
    readonly reason: string,
    readonly raw: string
  ) {
    super(`HeyGen account problem — ${reason}`);
    this.name = "HostAccountError";
  }
}

export const isHostAccountError = (e: unknown): e is HostAccountError =>
  e instanceof HostAccountError;

/** The beat has spent its automatic retries or its regenerate. Nothing was submitted. */
export class HostRenderCapError extends Error {
  constructor(
    readonly why: "retries" | "regenerate",
    readonly used: number,
    readonly cap: number
  ) {
    super(
      why === "retries"
        ? `host render failed ${used} time${used === 1 ? "" : "s"} — no retries left`
        : `the one host regenerate for this beat has been used`
    );
    this.name = "HostRenderCapError";
  }
}

export const isHostRenderCapError = (e: unknown): e is HostRenderCapError =>
  e instanceof HostRenderCapError;

/**
 * Operator copy for an account-level failure, or null when the error is about THIS render
 * (a photo HeyGen cannot use, an audio stream it rejects, one render that failed). Checked in
 * this order so a bad key is never blamed on the network. Pure; exported for tests.
 *
 * Submit errors reach here only after the adapter's own retries (429/5xx/network are retried
 * inside `submitLipsync`), so a 5xx or a dropped connection here is HeyGen being down, not a
 * blip.
 */
export function hostAccountFailure(raw: string | undefined): string | null {
  const msg = raw ?? "";
  if (!msg) return null;
  if (/no lip-sync adapter is configured|key has been removed/i.test(msg))
    return "no HeyGen key is set for this tab";
  if (/\((401|403)\)|unauthori[sz]ed|invalid api key|forbidden/i.test(msg))
    return "the HeyGen key was rejected";
  if (
    /\(402\)|insufficient|not enough credits?|out of credits?|quota|payment required|\bbalance\b/i.test(
      msg
    )
  )
    return "the HeyGen account is out of credits";
  if (/suspend|deactivat|subscription (?:has )?(?:expired|ended)/i.test(msg))
    return "the HeyGen account is suspended";
  if (/\(429\)|rate limit|too many requests/i.test(msg))
    return "HeyGen is refusing requests (rate limit)";
  if (
    /HeyGen API error \(5\d\d\)|submit failed after retries|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(
      msg
    )
  )
    return "HeyGen is not responding";
  return null;
}

/** Jobs whose host lane is paused on an account failure, with the reason. In-memory by design. */
const paused = new Map<number, HostAccountError>();

/** Record the pause (first failure wins — it is the one the operator needs to read). */
export function pauseHostLane(jobId: number, err: HostAccountError): void {
  if (!paused.has(jobId)) paused.set(jobId, err);
}

/** The pause in force for this job, if any. */
export function hostLanePause(jobId: number): HostAccountError | undefined {
  return paused.get(jobId);
}

/** Lift the pause — a person clicked to render again, so they believe the account is fixed. */
export function resumeHostLane(jobId: number): void {
  paused.delete(jobId);
}

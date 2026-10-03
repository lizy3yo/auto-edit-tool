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
import { isHostPhotoRefusal } from "../shared/hostRedo";

/**
 * The job's HeyGen account failed; the reason is operator copy, `raw` the provider's words.
 *
 * `photoUrl` set ⇒ it is not the account at all but the HOST PHOTO HeyGen refuses to animate
 * (`hostPhotoRefusal`). Same class because it is the same kind of failure — every beat on that
 * photo fails the same way, no retry can change it, and the beat is not at fault — so it takes
 * the same road: no retries spent, no b-roll made, the beat waits. It pauses only the beats on
 * THAT photo; another angle HeyGen accepts keeps rendering.
 */
export class HostAccountError extends Error {
  constructor(
    readonly reason: string,
    readonly raw: string,
    readonly photoUrl?: string
  ) {
    super(
      photoUrl ? `HeyGen ${reason}` : `HeyGen account problem — ${reason}`
    );
    this.name = "HostAccountError";
  }
  /** True when HeyGen refused the photo, not the account. */
  get photo(): boolean {
    return !!this.photoUrl;
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

/** Operator copy for a photo HeyGen will not animate. */
export const HOST_PHOTO_REFUSED = "refused the host photo (its content check)";

/**
 * Whether HeyGen refused the PHOTO itself — its content moderation will not animate this image,
 * so every beat on it fails the same way however often it is asked. A film (2026-10-03) whose
 * phone-look photo was refused spent every host beat's retries on it, turned 25 check-ins into
 * pictures it then had to throw away, and wrote 30 warnings for one cause. Deliberately narrow:
 * "no face detected" and the like stay the render's own failure. Pure; exported for tests.
 */
export const hostPhotoRefusal = (raw: string | undefined): boolean =>
  isHostPhotoRefusal(raw);

/** Jobs whose host lane is paused on an account failure, with the reason. In-memory by design. */
const paused = new Map<number, HostAccountError>();
/** Per job, the photos HeyGen refused — only beats on one of these wait. In-memory too. */
const refusedPhotos = new Map<number, Map<string, HostAccountError>>();

/**
 * Record the pause (first failure wins — it is the one the operator needs to read). Returns
 * whether this is NEWS: the first refusal of this photo, so the caller warns once per photo and
 * not once per beat.
 */
export function pauseHostLane(jobId: number, err: HostAccountError): boolean {
  if (err.photoUrl) {
    const byPhoto = refusedPhotos.get(jobId) ?? new Map();
    refusedPhotos.set(jobId, byPhoto);
    if (byPhoto.has(err.photoUrl)) return false;
    byPhoto.set(err.photoUrl, err);
    return true;
  }
  if (paused.has(jobId)) return false;
  paused.set(jobId, err);
  return true;
}

/**
 * The pause in force for this job, if any: the account's, else — for a beat rendering from
 * `photoUrl` — that photo's refusal.
 */
export function hostLanePause(
  jobId: number,
  photoUrl?: string
): HostAccountError | undefined {
  return (
    paused.get(jobId) ??
    (photoUrl ? refusedPhotos.get(jobId)?.get(photoUrl) : undefined)
  );
}

/** Lift the pause — a person clicked to render again, so they believe the account is fixed. */
export function resumeHostLane(jobId: number): void {
  paused.delete(jobId);
  refusedPhotos.delete(jobId);
}

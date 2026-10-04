/**
 * Which videos are taken over, and by whom (`shared/jobTakeover.ts` holds the rules).
 *
 * Kept in memory — single process, so that is authoritative — and written through to
 * `app_settings.job_takeovers` so a restart does not hand every video back mid-fix. Deliberately
 * NOT columns on `longform_video_jobs`: every write to that row moves its `updatedAt`, which is
 * the heartbeat the stale-job sweep and the restart resume read, so a takeover kept alive by its
 * holder's page would make a dead render look alive.
 */
import {
  settleTakeover,
  type JobTakeover,
  type JobTakeoverView,
} from "../shared/jobTakeover";
import { getAppSetting, setAppSetting } from "./db";

const SETTING_KEY = "job_takeovers";

const takeovers = new Map<number, JobTakeover>();
let loaded: Promise<void> | null = null;

function load(): Promise<void> {
  return (loaded ??= (async () => {
    try {
      const raw = await getAppSetting(SETTING_KEY);
      const stored = raw ? (JSON.parse(raw) as Record<string, JobTakeover>) : {};
      const now = Date.now();
      for (const [jobId, t] of Object.entries(stored)) {
        if (!t || typeof t.userId !== "number") continue;
        // The restart is not the holder's absence: the idle clock starts again from boot.
        takeovers.set(Number(jobId), { ...t, activeAt: now });
      }
    } catch (err) {
      console.warn("[Takeover] could not read saved takeovers:", err);
    }
  })());
}

let saving: Promise<void> = Promise.resolve();
function save(): void {
  const snapshot = JSON.stringify(Object.fromEntries(takeovers));
  saving = saving
    .then(() => setAppSetting(SETTING_KEY, snapshot))
    .catch(err => console.warn("[Takeover] could not save takeovers:", err));
}

/**
 * The takeover on a job right now, or null. Passing the job's `status` lets a finished or
 * forgotten takeover release itself here, on the reads that happen anyway.
 */
export async function getTakeover(
  jobId: number,
  status?: string
): Promise<JobTakeover | null> {
  await load();
  const current = takeovers.get(jobId);
  if (!current) return null;
  const next = settleTakeover(current, status, Date.now());
  if (next === current) return current;
  if (next) takeovers.set(jobId, next);
  else takeovers.delete(jobId);
  save();
  return next;
}

/** Take a video over. The caller has already checked who may (`mayTakeOver`). */
export async function takeOverJob(
  jobId: number,
  user: { id: number; name: string }
): Promise<JobTakeover> {
  await load();
  const now = Date.now();
  const takeover: JobTakeover = {
    userId: user.id,
    userName: user.name,
    at: now,
    activeAt: now,
  };
  takeovers.set(jobId, takeover);
  save();
  return takeover;
}

/** Hand a video back. Returns whether there was a takeover to release. */
export async function releaseTakeover(jobId: number): Promise<boolean> {
  await load();
  if (!takeovers.delete(jobId)) return false;
  save();
  return true;
}

/** The holder has the video open or just clicked on it — the idle clock starts again. Memory only. */
export function touchTakeover(jobId: number, userId: number): void {
  const t = takeovers.get(jobId);
  if (t && t.userId === userId) t.activeAt = Date.now();
}

/** Hand a video back if this person is the one holding it. */
export async function releaseTakeoverHeldBy(
  jobId: number,
  userId: number
): Promise<void> {
  await load();
  if (takeovers.get(jobId)?.userId !== userId) return;
  takeovers.delete(jobId);
  save();
}

export const takeoverView = (
  t: JobTakeover | null,
  userId: number
): JobTakeoverView | null =>
  t ? { byName: t.userName, mine: t.userId === userId, at: t.at } : null;

/** Test hook: forget everything, as a fresh process would. */
export function _resetTakeoversForTest(): void {
  takeovers.clear();
  loaded = Promise.resolve();
}

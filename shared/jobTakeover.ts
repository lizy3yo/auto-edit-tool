/**
 * Taking over a video: an admin or operations manager opens someone's video to fix it, and until
 * they hand it back nobody else may change it — two people clicking Retry on one film pay twice
 * and overwrite each other.
 *
 * Pure rules, shared so the server's refusal and the card's paused state cannot disagree.
 */
import { canSeeAllJobs, type Account } from "./roles";

/** A takeover nobody has looked at for this long is released, so a forgotten one locks no one out. */
export const TAKEOVER_IDLE_MS = 30 * 60 * 1000;

export type JobTakeover = {
  userId: number;
  userName: string;
  /** When it was taken, and when its holder last had the video open or clicked on it. */
  at: number;
  activeAt: number;
  /** Seen running since it was taken — a video that then FINISHES is handed back by itself. */
  sawProcessing?: boolean;
};

/** What the card is told about a takeover. */
export type JobTakeoverView = { byName: string; mine: boolean; at: number };

export type JobAccessRefusal =
  | { kind: "notYours" }
  | { kind: "takenOver"; byName: string };

/**
 * Why `user` may not do this to the job, or null when they may.
 *
 * READ: the owner, and the oversight tiers (`canSeeAllJobs`). WRITE: the same people, except that
 * while the video is taken over only the person who took it may change it — the owner and other
 * admins are paused alike.
 */
export function jobAccessRefusal(
  job: { userId: number },
  user: { id: number } & Account,
  mode: "read" | "write",
  takeover: JobTakeover | null
): JobAccessRefusal | null {
  if (job.userId !== user.id && !canSeeAllJobs(user))
    return { kind: "notYours" };
  if (mode === "write" && takeover && takeover.userId !== user.id)
    return { kind: "takenOver", byName: takeover.userName };
  return null;
}

/** Who may take a video over: the oversight tiers, on a video that is not their own. */
export function mayTakeOver(
  job: { userId: number },
  user: { id: number } & Account
): boolean {
  return canSeeAllJobs(user) && job.userId !== user.id;
}

/**
 * What a takeover becomes when the video's status is seen: unchanged, marked as having run, or
 * null — released — once it is idle past `TAKEOVER_IDLE_MS` or the video it re-ran has finished.
 */
export function settleTakeover(
  takeover: JobTakeover,
  status: string | undefined,
  now: number
): JobTakeover | null {
  if (now - takeover.activeAt > TAKEOVER_IDLE_MS) return null;
  if (status === "completed" && takeover.sawProcessing) return null;
  if (status === "processing" && !takeover.sawProcessing)
    return { ...takeover, sawProcessing: true };
  return takeover;
}

export const takenOverMessage = (byName: string) =>
  `${byName} is fixing this video — your buttons are paused until they hand it back.`;

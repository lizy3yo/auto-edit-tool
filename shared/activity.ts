/**
 * The Activity page's rules: which of everyone's videos need a person, and in what order the
 * list shows them. Pure, shared by the route that counts them (and feeds the nav's bell) and the
 * tests that pin them.
 */

/** How far back "recent" reaches. A failure older than this no longer lights the bell. */
export const ACTIVITY_RECENT_MS = 24 * 60 * 60 * 1000;

export type ActivityFacts = {
  status: string;
  errorMessage?: string | null;
  /** Waiting out a voice-provider outage (`inputParams.ttsWait`). */
  waitingForVoice: boolean;
  /** A scene carries `hostNeeded` / `hostWaiting` (see the host lane notes in CLAUDE.md). */
  hostNeeded: boolean;
  hostWaiting: boolean;
};

/**
 * Why a video needs someone, in plain words — or null when it does not. A video its own maker
 * cancelled is not a problem, and neither is one that simply finished.
 */
export function activityAttention(f: ActivityFacts): string | null {
  if (f.status === "completed") return null;
  if (f.hostNeeded) return "Host needed on a key scene";
  if (f.hostWaiting) return "Waiting for HeyGen";
  if (f.status === "processing")
    return f.waitingForVoice ? "Waiting for the voice provider" : null;
  if (/^cancell?ed\b/i.test(f.errorMessage?.trim() ?? "")) return null;
  return "Failed";
}

/** Videos that need someone first, then the ones running, then the rest — newest first in each. */
export function sortActivity<
  T extends { attention: string | null; status: string; updatedAt: Date },
>(items: T[]): T[] {
  const rank = (i: T) => (i.attention ? 0 : i.status === "processing" ? 1 : 2);
  return [...items].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

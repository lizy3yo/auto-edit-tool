import {
  markStaleLongformJobsFailed,
  getStaleLongformJobIdsWithPendingRenders,
  updateLongformVideoJob,
} from "./db";
import {
  retryJobAssembly,
  isJobRegenerating,
  isJobRendering,
} from "./longformVideo";

const CHECK_INTERVAL_MS = 1 * 60 * 1000; // every 1 minute

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic stale-job watchdog.
 * Safe to call multiple times — only one interval will run.
 */
export function startTimeoutChecker() {
  if (intervalHandle) return;

  console.log(
    "[Timeout] Starting longform watchdog (every 1 min, jobs stale after 30 min)"
  );

  // Run once immediately on startup
  cleanupStaleLongformJobs().catch(console.error);

  intervalHandle = setInterval(() => {
    cleanupStaleLongformJobs().catch(console.error);
  }, CHECK_INTERVAL_MS);
}

/**
 * Clean up stale longform jobs. Jobs time out after 30 minutes of inactivity
 * (the clips stage legitimately runs long; any DB write resets the clock).
 */
async function cleanupStaleLongformJobs(): Promise<void> {
  try {
    // Salvage stale longform jobs whose scenes have in-flight provider renders (the render
    // finished after the pipeline process died). Touch them to processing synchronously so
    // the fail sweep below skips them, then resume + assemble in the background. Results stay
    // downloadable on the provider for 24h, so this recovers the clip without re-rendering.
    await resumeOrphanedLongformRenders();
    const longformCount = await markStaleLongformJobsFailed(30);
    if (longformCount > 0) {
      console.log(`[Timeout] Cleaned up ${longformCount} stale longform jobs`);
    }
  } catch (err) {
    console.error("[Timeout] Error cleaning up stale jobs:", err);
  }
}

/**
 * Resume longform jobs orphaned by a server restart whose scenes still carry in-flight
 * provider render task IDs. Touches each to "processing" (resetting the stale clock so the
 * fail sweep skips it), then fires `retryJobAssembly` in the BACKGROUND — it resumes the
 * pending renders and assembles, without blocking the 1-min checker on a multi-minute poll.
 */
async function resumeOrphanedLongformRenders(): Promise<void> {
  const jobIds = await getStaleLongformJobIdsWithPendingRenders(30);
  for (const jobId of jobIds) {
    if (isJobRegenerating(jobId)) continue; // user is mid-regeneration — don't auto-assemble
    if (isJobRendering(jobId)) continue; // a live render/resume pass already owns this job
    // Reset the clock synchronously so markStaleLongformJobsFailed below doesn't fail it.
    await updateLongformVideoJob(jobId, { status: "processing" }).catch(
      () => {}
    );
    console.log(
      `[Timeout] Resuming orphaned longform job ${jobId} (pending renders)`
    );
    retryJobAssembly(jobId).catch(err =>
      console.error(`[Timeout] longform ${jobId} resume failed:`, err?.message)
    );
  }
}

/**
 * Stop the periodic timeout checker.
 */
export function stopTimeoutChecker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[Timeout] Stopped generation timeout checker");
  }
}

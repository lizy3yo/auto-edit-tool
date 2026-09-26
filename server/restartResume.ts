/**
 * server/restartResume.ts
 *
 * Pick renders back up after the server restarts. The server is ONE long-lived process
 * (CLAUDE.md), so every job still `processing` at boot was cut off by the restart — a deploy, a
 * crash, or `tsx watch` reloading on a saved file. Before this, such a job sat on "Generating"
 * with nothing running it until the watchdog failed it 30 minutes later, and a job cut off
 * before the clip stage was never resumed at all (the watchdog only salvages scenes carrying a
 * provider task id).
 *
 * Each job is continued from where it stopped, through the path the operator's own buttons use,
 * so nothing already paid for is paid for again:
 *   - storyboard / voiceover → the pipeline from the top; the master narration, once voiced, is
 *     checkpointed on `inputParams.voicedMasterUrl` and reused instead of re-voiced
 *   - clips → "Retry failed scenes": collects renders still in flight by their saved task ids,
 *     renders only scenes with no clip, then assembles
 *   - assembly / done → "Retry assembly" (local ffmpeg — free; settles an already-finished film)
 *   - waiting for the voice provider (`inputParams.ttsWait`) → the wait again, which does not
 *     spend the one automatic resume (`server/ttsRecovery.ts`)
 *
 * ONE automatic resume per job (`inputParams.autoResumedAt`): a job cut off a second time is
 * failed with a message saying so, so a server that keeps crashing cannot loop a render.
 * It never spends on voiceover by itself: a clip-stage job with scenes missing their narration
 * (the state an interrupted "Retry failed scenes" re-voice leaves) is failed with a message
 * instead. And a job idle past `MAX_RESUME_AGE_MS` is failed — providers keep finished results
 * ~24 h, so resuming it would re-render what has expired.
 */
import type { LongformInputParams, StoryboardScene } from "@shared/types";
import { getProcessingLongformJobs, updateLongformVideoJob } from "./db";
import {
  resumeTtsWait,
  retryFailedScenes,
  retryJobAssembly,
  runLongformPipeline,
} from "./longformVideo";

/** Providers keep finished renders ~24 h; past that a resume would pay for them again. */
export const MAX_RESUME_AGE_MS = 24 * 60 * 60 * 1000;

export type RestartAction =
  | { kind: "pipeline" }
  | { kind: "retryScenes" }
  | { kind: "assemble" }
  | { kind: "waitForTts" }
  | { kind: "giveUp"; message: string };

/** The fields `planRestartResume` reads — a job row satisfies it. */
export interface RestartJobLike {
  stage: string;
  updatedAt: Date | string;
  inputParams: unknown;
  storyboard: unknown;
}

const hasClip = (s: StoryboardScene) => !!(s.clipUrls?.length || s.clipUrl);

/** What to do with one job found `processing` at boot. Pure — exported for unit testing. */
export function planRestartResume(
  job: RestartJobLike,
  now = Date.now()
): RestartAction {
  const params = (job.inputParams ?? {}) as LongformInputParams;
  const scenes = Array.isArray(job.storyboard)
    ? (job.storyboard as StoryboardScene[])
    : [];

  // Waiting for the voice provider (`server/ttsRecovery.ts`): pick the wait back up. Checked
  // before the one-resume rule, because a wait spends nothing by itself — it re-voices only once
  // a voice check passes, its re-voicings are capped, and its 2-hour limit counts from when it
  // began, so a deploy during a wait neither loses the job nor extends the wait.
  if (
    params.ttsWait &&
    (job.stage === "voiceover" || job.stage === "storyboard") &&
    !scenes.some(hasClip)
  ) {
    return { kind: "waitForTts" };
  }

  if (params.autoResumedAt) {
    return {
      kind: "giveUp",
      message:
        "The server restarted during this render twice. It was picked up automatically the " +
        "first time; press Retry to continue from where it stopped.",
    };
  }
  if (now - new Date(job.updatedAt).getTime() > MAX_RESUME_AGE_MS) {
    return {
      kind: "giveUp",
      message:
        "The server restarted during this render more than a day ago, and providers only keep " +
        "finished clips for about a day — press Retry to continue, or start a new render.",
    };
  }

  switch (job.stage) {
    case "storyboard":
    case "voiceover":
      // Nothing is rendered before the clip stage. A board that somehow carries clips would have
      // every one of them re-rendered by a restart from the top, so leave that to a person.
      if (scenes.some(hasClip)) {
        return {
          kind: "giveUp",
          message:
            "The server restarted during this render. Press Retry to continue from where it stopped.",
        };
      }
      return { kind: "pipeline" };
    case "clips":
      // Every scene carries its narration once voicing finishes. Scenes WITHOUT it mean a
      // re-voice was cut off; continuing would buy a fresh voiceover per scene, which is not a
      // decision to take unattended.
      if (scenes.some(s => !s.audioUrl)) {
        return {
          kind: "giveUp",
          message:
            "The server restarted while this render was re-voicing scenes. It was not resumed " +
            "automatically, because that would pay for more voiceovers — press Retry failed " +
            "scenes to continue.",
        };
      }
      return scenes.some(s => !hasClip(s) || s.renderTaskIds?.length)
        ? { kind: "retryScenes" }
        : { kind: "assemble" };
    default:
      return { kind: "assemble" };
  }
}

/**
 * How long boot waits before deciding a `processing` job was cut off. Every running job touches
 * its row once a minute (`startJobHeartbeat` in longformVideo), so a row that moves inside this
 * window is still being run by ANOTHER live process — a render started from a script
 * (`scripts/stress/run.mts`), or an old instance still finishing during a deploy. Resuming it
 * too ran the same job twice at once: a stress rehearsal (job 112, 2026-09-24) was voiced and
 * storyboarded twice by a `tsx watch` reload, then failed as "restarted twice" by the next one.
 */
export const LIVE_CHECK_MS = 90_000;

/** True when a job's row moved between two reads — some live process is heartbeating it. Pure. */
export function stillRunningElsewhere(
  before: { updatedAt: Date | string },
  after: { updatedAt: Date | string }
): boolean {
  return (
    new Date(after.updatedAt).getTime() !== new Date(before.updatedAt).getTime()
  );
}

/**
 * Run once at boot, BEFORE the watchdog's first sweep: the write below resets each job's stale
 * clock, so the sweep does not fail a job this is about to continue. Waits `liveCheckMs` first
 * and leaves alone any job whose row moved meanwhile (`stillRunningElsewhere`).
 */
export async function resumeJobsAfterRestart(
  liveCheckMs = LIVE_CHECK_MS
): Promise<void> {
  const first = await getProcessingLongformJobs();
  if (first.length === 0) return;
  await new Promise(r => setTimeout(r, liveCheckMs));
  const now = new Map((await getProcessingLongformJobs()).map(j => [j.id, j]));
  const jobs = first.flatMap(before => {
    const job = now.get(before.id);
    if (!job) return []; // finished or failed while we waited
    if (stillRunningElsewhere(before, job)) {
      console.log(
        `[Restart] longform ${job.id} is still running in another process — not resumed`
      );
      return [];
    }
    return [job];
  });
  for (const job of jobs) {
    const action = planRestartResume(job);
    const params = (job.inputParams ?? {}) as LongformInputParams;
    if (action.kind === "giveUp") {
      console.warn(
        `[Restart] longform ${job.id} (${job.stage}) not resumed: ${action.message}`
      );
      await updateLongformVideoJob(job.id, {
        status: "failed",
        errorMessage: action.message,
        completedAt: new Date(),
      }).catch(err =>
        console.error(
          `[Restart] longform ${job.id} could not be failed:`,
          err?.message
        )
      );
      continue;
    }
    if (action.kind === "waitForTts") {
      console.log(
        `[Restart] longform ${job.id} was waiting for the voice provider — waiting again`
      );
      resumeTtsWait(job.id).catch(err =>
        console.error(
          `[Restart] longform ${job.id} could not resume its wait:`,
          err?.message
        )
      );
      continue;
    }
    // Spend the one automatic resume BEFORE starting, so a crash inside it counts.
    await updateLongformVideoJob(job.id, {
      inputParams: { ...params, autoResumedAt: new Date().toISOString() },
      errorMessage: null,
    });
    console.log(
      `[Restart] resuming longform ${job.id} from the ${job.stage} stage (${action.kind})`
    );
    const run =
      action.kind === "pipeline"
        ? runLongformPipeline(job.id)
        : action.kind === "retryScenes"
          ? retryFailedScenes(job.id)
          : retryJobAssembly(job.id);
    run.catch(err =>
      console.error(`[Restart] longform ${job.id} resume failed:`, err?.message)
    );
  }
}

/**
 * server/cancelRenders.ts — stop the GPU when a job is cancelled or deleted.
 *
 * Cancelling or deleting a job used to touch database rows only. The pipeline's own
 * `assertNotCancelled` stops it starting NEW work, but a render already submitted keeps
 * running — and the RunPod lane bills by RUNNING time, not by output. Measured: an untracked
 * render left over from a removed job billed 8 minutes of GPU on a worker nobody was waiting
 * for, and it would have run to the execution cap unnoticed.
 *
 * HeyGen is billed per second of FINISHED output, so an abandoned render there costs the same
 * whether it is stopped or not; only the RunPod lane leaks. A 69Labs b-roll task is likewise
 * billed per output and its ids are not RunPod jobs, so `renderProvider` decides what is
 * touched rather than the mere presence of a task id.
 *
 * Its own module, not a corner of the 12k-line pipeline, so the money path can be tested
 * without standing the whole pipeline up.
 */
import { ENV } from "./_core/env";
import { RunpodLipsyncAdapter } from "./providers/runpod-lipsync";

/** The shape this needs from a job row — anything with a storyboard will do. */
export interface CancellableJob {
  id?: number;
  storyboard?: unknown;
}

/**
 * Tell RunPod to stop every host render `job` still has in flight. Returns how many were
 * asked to stop.
 *
 * Best-effort by construction: the adapter's `cancelJob` never throws, so failing to cancel
 * leaves exactly the behaviour that existed before this function. Call it BEFORE the row is
 * written or removed — once the job is gone, so are the task ids.
 */
export async function cancelJobProviderRenders(
  job: CancellableJob | null | undefined,
  reason: string
): Promise<number> {
  if (!job || !ENV.runpodInfinitetalkEndpoint || !ENV.runPodApiKey) return 0;
  const scenes = job.storyboard;
  if (!Array.isArray(scenes)) return 0;
  const ids = scenes
    .filter(s => s?.renderProvider === "runpod")
    .flatMap((s): string[] => s.renderTaskIds ?? [])
    .filter((id): id is string => !!id);
  if (!ids.length) return 0;
  const runpod = new RunpodLipsyncAdapter(
    ENV.runpodInfinitetalkEndpoint,
    ENV.runPodApiKey,
    // Irrelevant to cancelling — the adapter only needs the endpoint and the key here.
    "fast"
  );
  for (const id of ids) await runpod.cancelJob(id);
  console.log(
    `[Longform ${job.id ?? "?"}] ${reason}: told RunPod to stop ${ids.length} in-flight host render(s)`
  );
  return ids.length;
}

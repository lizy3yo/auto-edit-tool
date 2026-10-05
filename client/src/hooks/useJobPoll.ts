import { useQuery, type Query } from "@tanstack/react-query";
import { getQueryKey, type TRPCClientErrorLike } from "@trpc/react-query";
import type { AppRouter } from "../../../server/routers";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useConnection } from "@/lib/connection";
import { pollIntervalMs } from "@shared/weakNetwork";

/** A video's full poll answer — what the card reads. */
export type JobPoll = Extract<
  RouterOutputs["longformVideo"]["pollJob"],
  { unchanged: false }
>;
type PollError = TRPCClientErrorLike<AppRouter>;
type PollQuery = Query<JobPoll, PollError>;

/**
 * The last full answer the SERVER gave for each video, with its fingerprint. Kept apart from
 * the query cache on purpose: an "unchanged" reply must restore exactly what the server last
 * said, as a full re-download would have, not whatever is in the cache now.
 */
const held = new Map<number, JobPoll>();
/** A little over the five tabs a person has. */
const HELD_MAX = 8;

function hold(jobId: number, answer: JobPoll) {
  held.delete(jobId);
  held.set(jobId, answer);
  if (held.size > HELD_MAX) held.delete(held.keys().next().value!);
}

/**
 * `longformVideo.pollJob`, without re-downloading what the page already has. The page sends
 * the fingerprint of the answer it holds; while nothing has changed the server replies with a
 * few bytes and the held answer is returned. On a weak connection it also asks less often.
 *
 * Same query key as `trpc.longformVideo.pollJob.useQuery({ jobId })`, so every existing
 * `utils.longformVideo.pollJob.invalidate(...)` still reaches it.
 */
export function useJobPoll(
  jobId: number | null,
  options: {
    enabled: boolean;
    retry: (failureCount: number, error: PollError) => boolean;
    /** The interval on a good connection, or false to stop. */
    refetchInterval: (query: PollQuery) => number | false;
  }
) {
  const utils = trpc.useUtils();
  const { quality } = useConnection();
  const id = jobId ?? 0;
  return useQuery<JobPoll, PollError>({
    queryKey: getQueryKey(trpc.longformVideo.pollJob, { jobId: id }, "query"),
    queryFn: async ({ signal }) => {
      const ask = (have?: string) =>
        utils.client.longformVideo.pollJob.query(
          { jobId: id, have },
          { signal }
        );
      const mine = held.get(id);
      let answer = await ask(mine?.rev);
      // "Unchanged" for an answer no longer held cannot happen — but never return nothing.
      if (answer.unchanged && !mine) answer = await ask();
      if (answer.unchanged) return mine!;
      hold(id, answer);
      return answer;
    },
    enabled: options.enabled,
    retry: options.retry,
    refetchIntervalInBackground: true, // keep polling while the tab is hidden
    refetchInterval: query => {
      const base = options.refetchInterval(query);
      return base === false ? false : pollIntervalMs(base, quality);
    },
  });
}

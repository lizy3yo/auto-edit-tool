/**
 * The ONE permission check for a video.
 *
 * `routers.ts` used to carry ~35 copies of `job.userId !== ctx.user.id && !canSeeAllJobs(…)`,
 * and two routes had none at all: "Make host" — a paid HeyGen render — and the cost breakdown
 * were open to any signed-in user on any video. Every route that touches a job now goes through
 * `assertJobAccess`; a tripwire in `jobAccess.test.ts` fails if an inline check comes back.
 *
 * It also enforces a takeover (`shared/jobTakeover.ts`): while someone is fixing a video, a
 * WRITE from anyone else is refused, the owner included.
 */
import { TRPCError } from "@trpc/server";
import { jobAccessRefusal, takenOverMessage } from "../shared/jobTakeover";
import type { Role } from "../shared/roles";
import { getTakeover, touchTakeover } from "./jobTakeover";

export async function assertJobAccess(
  job: { id: number; userId: number; status: string },
  user: { id: number; role: Role },
  mode: "read" | "write"
): Promise<void> {
  const takeover = await getTakeover(job.id, job.status);
  const refusal = jobAccessRefusal(job, user, mode, takeover);
  if (refusal?.kind === "notYours")
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your video" });
  if (refusal?.kind === "takenOver")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: takenOverMessage(refusal.byName),
    });
  // The holder's own clicks and open page are what keep a takeover from timing out.
  if (takeover?.userId === user.id) touchTakeover(job.id, user.id);
}

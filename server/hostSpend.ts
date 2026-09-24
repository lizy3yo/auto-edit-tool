/**
 * The host spend GATE: the running total of paid lip-sync seconds per job, checked on every
 * HeyGen submit (`resolveLipsyncAdapter`) against the job's limit (`shared/hostSpend.ts`).
 *
 * The total is seeded ONCE per process from the job's metered `costUsage` (the number the Cost
 * dialog shows) and then moved synchronously on every reservation, so eight host beats submitting
 * at once cannot all read "under the limit" before any of them has counted. Single-process by
 * design, like the semaphores and the cost meter it sits beside (CLAUDE.md, "Single process only").
 */
import { flushJobUsage, heygenSecondsIn } from "./costMeter";
import {
  decideHostSpend,
  hostSpendLimitSec,
  type HostSpendDecision,
} from "../shared/hostSpend";
import type {
  LongformInputParams,
  SceneSubmitReason,
  StoryboardScene,
} from "../shared/types";
import type { UsageLine } from "./pricing";

/** `HOST_SPEND_LIMIT=0` turns the limit off (the plan still budgets; nothing is refused). */
export const hostSpendLimitEnabled = (): boolean =>
  process.env.HOST_SPEND_LIMIT !== "0";

/** Thrown by the gate. Never a PendingRenderError, so nothing resubmits it. */
export class HostSpendLimitError extends Error {
  constructor(
    readonly spentSec: number,
    readonly limitSec: number
  ) {
    super(
      `the video's host limit is spent (${Math.round(spentSec)}s of ${Math.round(limitSec)}s)`
    );
    this.name = "HostSpendLimitError";
  }
}

export const isHostSpendLimitError = (e: unknown): e is HostSpendLimitError =>
  e instanceof HostSpendLimitError ||
  (e as any)?.name === "HostSpendLimitError";

const totals = new Map<number, Promise<{ sec: number }>>();

async function totalFor(jobId: number): Promise<{ sec: number }> {
  let t = totals.get(jobId);
  if (!t) {
    t = (async () => {
      await flushJobUsage(jobId);
      const { getLongformVideoJobById } = await import("./db");
      const job = await getLongformVideoJobById(jobId);
      return { sec: heygenSecondsIn(job?.costUsage as UsageLine[] | null) };
    })();
    totals.set(jobId, t);
    // A failed seed must not wedge the job on a rejected promise forever.
    t.catch(() => totals.delete(jobId));
  }
  return t;
}

/** Seconds already paid (or reserved) for this job's host lane. */
export async function hostSecondsSpent(jobId: number): Promise<number> {
  try {
    return (await totalFor(jobId)).sec;
  } catch {
    return 0;
  }
}

/** One-shot admin/manager overrides, keyed `jobId:sceneIndex`, consumed by the next submit. */
const overrides = new Set<string>();
export function grantHostSpendOverride(jobId: number, sceneIndex: number) {
  overrides.add(`${jobId}:${sceneIndex}`);
}

/**
 * Reserve `needSec` for one submit, or refuse. On success the caller MUST call `release(false)`
 * if the provider did not accept the submit (nothing was billed); an accepted submit keeps the
 * reservation, since the meter bills it too.
 */
export async function reserveHostSpend(args: {
  jobId: number;
  params: LongformInputParams;
  scene: StoryboardScene;
  needSec: number;
  reason: SceneSubmitReason | undefined;
}): Promise<{
  decision: HostSpendDecision;
  release: (accepted: boolean) => void;
}> {
  const { jobId, params, scene, needSec, reason } = args;
  const noop = () => {};
  const limitSec = hostSpendLimitEnabled() ? hostSpendLimitSec(params) : null;
  let total: { sec: number };
  try {
    total = await totalFor(jobId);
  } catch {
    // The meter could not be read: never block a render on a bookkeeping failure.
    return { decision: { ok: true, why: "unlimited" }, release: noop };
  }
  // Synchronous from here: the check and the reservation are one step.
  const key = `${jobId}:${scene.index}`;
  const decision = decideHostSpend({
    spentSec: total.sec,
    needSec,
    limitSec,
    protectedBeat: !!scene.hostProtected,
    reason,
    override: overrides.has(key),
  });
  if (!decision.ok) return { decision, release: noop };
  if (decision.why === "override") {
    overrides.delete(key);
    // For the ledger: this render went past the video's limit on a manager's confirm.
    scene.submitPastLimit = true;
  }
  total.sec += needSec;
  let released = false;
  return {
    decision,
    release: accepted => {
      if (released || accepted) return;
      released = true;
      total.sec = Math.max(0, total.sec - needSec);
    },
  };
}

/**
 * The router's check for an operator click that renders on the host lane (Regenerate on a
 * full-frame host beat, "Make host"): null when it may go ahead, else the numbers to show. With
 * `override` (an admin/manager confirmed the cost) it grants the scene one render past the limit.
 */
export async function hostSpendRefusal(
  jobId: number,
  params: LongformInputParams | null,
  scene: StoryboardScene,
  override: boolean
): Promise<{ spentSec: number; limitSec: number } | null> {
  if (!hostSpendLimitEnabled()) return null;
  const limitSec = hostSpendLimitSec(params);
  if (limitSec == null) return null;
  const spentSec = await hostSecondsSpent(jobId);
  const d = decideHostSpend({
    spentSec,
    needSec: Math.max(0, scene.audioDuration ?? 0),
    limitSec,
    protectedBeat: !!scene.hostProtected,
    reason: "regenerate",
    override: false,
  });
  if (d.ok) return null;
  if (override) {
    grantHostSpendOverride(jobId, scene.index);
    return null;
  }
  return { spentSec, limitSec };
}

/** Tests only. */
export function __resetHostSpend() {
  totals.clear();
  overrides.clear();
}

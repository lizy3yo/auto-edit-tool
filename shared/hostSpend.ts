/**
 * The host SPEND LIMIT — the per-video ceiling on paid lip-sync seconds.
 *
 * `planHostMinutes` / `capHostMinutes` decide which beats are host BEFORE anything renders, and
 * the per-beat limits (`MAX_TRANSIENT_RESUBMITS_HOST`, `MAX_HOST_REGENERATIONS`) bound each beat
 * on its own. Nothing bounded the VIDEO: ~36 host beats × three paid renders each is ~108 renders
 * allowed, and a 3-minute pick metered 98 calls / 566 s / $33.96 without tripping any of them.
 *
 * The limit is the host budget the plan spent (`inputParams.hostBudgetSec`, which is the pick or
 * less), so the generate form's "~$10.80 of lip-sync" is a promise and not an estimate. The start,
 * the CTAs and the end (`scene.hostProtected`) render FIRST and are never refused by an automatic
 * pass — their retries come out of the same budget, and the middle check-ins, rendered last,
 * are the ones that become b-roll when it runs out. An operator's paid click (Regenerate, "Make
 * host") is refused past the limit on every beat; an admin or manager may override it once.
 *
 * Pure and shared, so the gate, the router, the poll and the Cost dialog answer from one rule.
 */
import type {
  LongformInputParams,
  SceneSubmitReason,
  StoryboardScene,
} from "./types";

/** Slack for rounding between a narration's measured length and the plan's arithmetic. */
export const HOST_SPEND_EPSILON_SEC = 1;

/**
 * The job's limit in seconds of paid host output, or null when it has none (no host-minutes pick
 * — a job from before the pick existed — or a b-roll-only film).
 */
export function hostSpendLimitSec(
  params: Pick<
    LongformInputParams,
    "hostBudgetSec" | "hostMinutes" | "brollOnly"
  > | null
): number | null {
  if (!params || params.brollOnly) return null;
  if (params.hostBudgetSec != null && params.hostBudgetSec > 0)
    return params.hostBudgetSec;
  if (params.hostMinutes != null && params.hostMinutes > 0)
    return params.hostMinutes * 60;
  return null;
}

/** Submits an operator clicked for. Everything else is the pipeline finishing its own plan. */
export const isOperatorSubmit = (reason: SceneSubmitReason | undefined) =>
  reason === "regenerate";

export type HostSpendDecision =
  | { ok: true; why: "within" | "protected" | "override" | "unlimited" }
  | { ok: false; spentSec: number; limitSec: number; needSec: number };

/**
 * May this host render be paid for? `spentSec` is everything already accepted for the job
 * (including in-flight reservations), `needSec` this render's seconds of output.
 */
export function decideHostSpend(args: {
  spentSec: number;
  needSec: number;
  limitSec: number | null;
  /** The beat is the start, a CTA or the end (`scene.hostProtected`). */
  protectedBeat: boolean;
  reason: SceneSubmitReason | undefined;
  /** An admin/manager confirmed this one render past the limit. */
  override: boolean;
}): HostSpendDecision {
  const { spentSec, needSec, limitSec, protectedBeat, reason, override } = args;
  if (limitSec == null) return { ok: true, why: "unlimited" };
  if (spentSec + needSec <= limitSec + HOST_SPEND_EPSILON_SEC)
    return { ok: true, why: "within" };
  if (override) return { ok: true, why: "override" };
  if (protectedBeat && !isOperatorSubmit(reason))
    return { ok: true, why: "protected" };
  return { ok: false, spentSec, limitSec, needSec };
}

/** Seconds of paid host output per submit reason, from the scenes' ledgers. */
export function hostSpendByReason(
  scenes: StoryboardScene[]
): Partial<Record<SceneSubmitReason, number>> {
  const out: Partial<Record<SceneSubmitReason, number>> = {};
  for (const s of scenes ?? []) {
    for (const sub of s?.submits ?? []) {
      if (sub.provider !== "heygen" && sub.provider !== "runpod") continue;
      out[sub.reason] = (out[sub.reason] ?? 0) + Math.max(0, sub.sec ?? 0);
    }
  }
  return out;
}

/** What the card and the Cost dialog show about the limit. */
export interface HostSpendSummary {
  limitSec: number;
  spentSec: number;
  /** Paid seconds per reason — the ledger's view (renders before the ledger existed are absent). */
  byReason: Partial<Record<SceneSubmitReason, number>>;
  /** Host beats the limit turned into b-roll. */
  madeBroll: number;
  reached: boolean;
}

export function summarizeHostSpend(
  params: LongformInputParams | null,
  scenes: StoryboardScene[],
  spentSec: number
): HostSpendSummary | null {
  const limitSec = hostSpendLimitSec(params);
  if (limitSec == null) return null;
  return {
    limitSec,
    spentSec,
    byReason: hostSpendByReason(scenes),
    madeBroll: (scenes ?? []).filter(s => s?.autoBroll?.limit).length,
    reached: spentSec >= limitSec - HOST_SPEND_EPSILON_SEC,
  };
}

const REASON_LABEL: Record<SceneSubmitReason, string> = {
  first: "first renders",
  resume: "resumed",
  transient: "provider retries",
  infra: "provider failures",
  retry: "retry clicks",
  regenerate: "regenerates",
  merge: "merges",
};

export const hostSpendReasonLabel = (r: SceneSubmitReason): string =>
  REASON_LABEL[r] ?? r;

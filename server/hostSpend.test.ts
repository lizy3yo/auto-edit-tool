import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decideHostSpend,
  hostSpendByReason,
  hostSpendLimitSec,
  summarizeHostSpend,
} from "../shared/hostSpend";
import {
  HostSpendLimitError,
  __resetHostSpend,
  hostSpendRefusal,
  isHostSpendLimitError,
  reserveHostSpend,
} from "./hostSpend";
import { heygenSecondsIn } from "./costMeter";
import {
  markProtectedHostBeats,
  planAutoBroll,
  protectedHostFirst,
  runChunkTasks,
  PendingRenderError,
} from "./longformVideo";
import { SIXTYNINE_VIDEO_SLOTS } from "./providers/sixtynine-labs";
import * as db from "./db";
import type { LongformInputParams, StoryboardScene } from "../shared/types";

const host = (
  index: number,
  sec: number,
  extra: Partial<StoryboardScene> = {}
): StoryboardScene => ({
  index,
  narration: `line ${index}`,
  visualPrompt: "host talks",
  hostPresent: true,
  audioDuration: sec,
  ...extra,
});

describe("hostSpendLimitSec", () => {
  it("is the budget the plan spent, else the pick, else none", () => {
    expect(hostSpendLimitSec({ hostBudgetSec: 150, hostMinutes: 3 })).toBe(150);
    expect(hostSpendLimitSec({ hostMinutes: 3 })).toBe(180);
    expect(hostSpendLimitSec({})).toBeNull();
    expect(hostSpendLimitSec({ hostMinutes: 3, brollOnly: true })).toBeNull();
    expect(hostSpendLimitSec(null)).toBeNull();
  });
});

describe("decideHostSpend", () => {
  const base = {
    spentSec: 170,
    needSec: 6,
    limitSec: 180 as number | null,
    protectedBeat: false,
    reason: "first" as const,
    override: false,
  };

  it("allows a render that fits, with a second of rounding slack", () => {
    expect(decideHostSpend(base).ok).toBe(true);
    expect(decideHostSpend({ ...base, spentSec: 175 }).ok).toBe(true); // 181 ≤ 180 + 1
    expect(decideHostSpend({ ...base, spentSec: 176 }).ok).toBe(false);
  });

  it("refuses a check-in past the limit, whatever the automatic reason", () => {
    for (const reason of [
      "first",
      "resume",
      "transient",
      "infra",
      "retry",
    ] as const)
      expect(decideHostSpend({ ...base, spentSec: 180, reason }).ok).toBe(
        false
      );
  });

  it("never refuses the start / a CTA / the end on an automatic pass", () => {
    const d = decideHostSpend({
      ...base,
      spentSec: 400,
      protectedBeat: true,
      reason: "transient",
    });
    expect(d).toEqual({ ok: true, why: "protected" });
  });

  it("refuses an operator regenerate past the limit even on a protected beat, unless overridden", () => {
    const over = {
      ...base,
      spentSec: 180,
      protectedBeat: true,
      reason: "regenerate" as const,
    };
    expect(decideHostSpend(over).ok).toBe(false);
    expect(decideHostSpend({ ...over, override: true })).toEqual({
      ok: true,
      why: "override",
    });
  });

  it("does nothing on a job with no limit", () => {
    expect(
      decideHostSpend({ ...base, spentSec: 9999, limitSec: null }).ok
    ).toBe(true);
  });
});

describe("hostSpendByReason / summarizeHostSpend", () => {
  it("totals host-lane ledger seconds by reason and ignores b-roll", () => {
    const scenes = [
      host(1, 6, {
        submits: [
          { provider: "heygen", at: "", reason: "first", sec: 6 },
          { provider: "heygen", at: "", reason: "regenerate", sec: 6 },
        ],
      }),
      host(2, 5, {
        submits: [
          { provider: "heygen", at: "", reason: "first", sec: 5 },
          { provider: "heygen", at: "", reason: "transient", sec: 5 },
        ],
      }),
      {
        ...host(3, 8),
        hostPresent: false,
        submits: [
          { provider: "sixtynine_labs", at: "", reason: "first", sec: 8 },
        ],
      },
    ];
    expect(hostSpendByReason(scenes)).toEqual({
      first: 11,
      regenerate: 6,
      transient: 5,
    });
  });

  it("reports the limit, the spend and the check-ins the limit made b-roll", () => {
    const scenes = [
      host(1, 6),
      {
        ...host(2, 6),
        hostPresent: false,
        autoBroll: { reason: "x", at: "", limit: true },
      },
      {
        ...host(3, 6),
        hostPresent: false,
        autoBroll: { reason: "lane failed", at: "" },
      },
    ];
    const s = summarizeHostSpend(
      { hostMinutes: 3 } as LongformInputParams,
      scenes,
      180
    );
    expect(s).toMatchObject({
      limitSec: 180,
      spentSec: 180,
      madeBroll: 1,
      reached: true,
    });
    expect(
      summarizeHostSpend({} as LongformInputParams, scenes, 180)
    ).toBeNull();
  });

  it("counts HeyGen seconds out of the metered usage the Cost dialog shows", () => {
    expect(
      heygenSecondsIn([
        {
          lane: "lipsync",
          provider: "heygen",
          model: "heygen-avatar-iv",
          calls: 98,
          quantity: 566,
        },
        {
          lane: "lipsync",
          provider: "runpod",
          model: "x",
          calls: 1,
          quantity: 900,
        },
        {
          lane: "video",
          provider: "apimart",
          model: "grok",
          calls: 3,
          quantity: 30,
        },
      ])
    ).toBe(566);
  });
});

describe("the spend gate", () => {
  const params = { hostMinutes: 3, hostBudgetSec: 180 } as LongformInputParams;
  let jobUsage: number;
  beforeEach(() => {
    __resetHostSpend();
    jobUsage = 0;
    vi.spyOn(db, "getLongformVideoJobById").mockImplementation(
      async () =>
        ({
          costUsage: [
            {
              lane: "lipsync",
              provider: "heygen",
              model: "heygen-avatar-iv",
              calls: 1,
              quantity: jobUsage,
            },
          ],
        }) as any
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("lets exactly the renders that fit through when eight submit at once", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        reserveHostSpend({
          jobId: 501,
          params,
          scene: host(i + 1, 30),
          needSec: 30,
          reason: "first",
        })
      )
    );
    expect(results.filter(r => r.decision.ok)).toHaveLength(6); // 6 × 30 s = the 3:00 limit
  });

  it("seeds from what the job already paid, and gives a refused-by-provider submit back", async () => {
    jobUsage = 170;
    const a = await reserveHostSpend({
      jobId: 502,
      params,
      scene: host(1, 6),
      needSec: 6,
      reason: "first",
    });
    expect(a.decision.ok).toBe(true);
    const b = await reserveHostSpend({
      jobId: 502,
      params,
      scene: host(2, 6),
      needSec: 6,
      reason: "first",
    });
    expect(b.decision.ok).toBe(false);
    a.release(false); // the provider never took it — nothing billed
    const c = await reserveHostSpend({
      jobId: 502,
      params,
      scene: host(2, 6),
      needSec: 6,
      reason: "first",
    });
    expect(c.decision.ok).toBe(true);
  });

  it("the router refuses a regenerate at the limit, and a manager's override lets exactly one through", async () => {
    jobUsage = 180;
    const s = host(4, 6);
    expect(await hostSpendRefusal(503, params, s, false)).toEqual({
      spentSec: 180,
      limitSec: 180,
    });
    expect(await hostSpendRefusal(503, params, s, true)).toBeNull();
    const first = await reserveHostSpend({
      jobId: 503,
      params,
      scene: s,
      needSec: 6,
      reason: "regenerate",
    });
    expect(first.decision).toEqual({ ok: true, why: "override" });
    const again = await reserveHostSpend({
      jobId: 503,
      params,
      scene: s,
      needSec: 6,
      reason: "regenerate",
    });
    expect(again.decision.ok).toBe(false);
  });

  it("is off with HOST_SPEND_LIMIT=0", async () => {
    vi.stubEnv("HOST_SPEND_LIMIT", "0");
    jobUsage = 999;
    const r = await reserveHostSpend({
      jobId: 504,
      params,
      scene: host(1, 6),
      needSec: 6,
      reason: "first",
    });
    expect(r.decision.ok).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("protected host beats", () => {
  it("stamps the start, CTAs and end, and sends them to the host lane first", () => {
    const scenes: StoryboardScene[] = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0 ? host(i, 6) : { ...host(i, 6), hostPresent: false }
    );
    scenes[0].hostOpener = true;
    scenes[6].cta = true;
    scenes[11].hostPresent = true;
    expect(markProtectedHostBeats(scenes, 0)).toBe(3);
    expect(scenes.filter(s => s.hostProtected).map(s => s.index)).toEqual([
      0, 6, 11,
    ]);
    const order = protectedHostFirst(scenes.filter(s => s.hostPresent)).map(
      s => s.index
    );
    expect(order).toEqual([0, 6, 11, 2, 4, 8, 10]);
  });
});

describe("runChunkTasks and the limit", () => {
  it("passes the refusal up as itself, submits once, and leaves nothing to resume or ledger", async () => {
    const s = host(3, 6);
    const submit = vi.fn(async () => {
      throw new HostSpendLimitError(180, 180);
    });
    const err = await runChunkTasks(
      9,
      s,
      "heygen",
      1,
      submit,
      async () => ({ success: true }),
      async () => {},
      SIXTYNINE_VIDEO_SLOTS
    ).catch(e => e);
    expect(isHostSpendLimitError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(PendingRenderError);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(0, "first");
    expect(s.renderTaskIds).toBeUndefined();
    expect(s.submits).toBeUndefined();
  });
});

describe("planAutoBroll for the limit", () => {
  it("demotes even with HOST_FAIL_TO_BROLL off, and marks it as the limit's doing", () => {
    const s = host(5, 6);
    expect(
      planAutoBroll(s, "the video's host limit is spent", false, true)
    ).toBe(true);
    expect(s.hostPresent).toBe(false);
    expect(s.autoBroll).toMatchObject({
      limit: true,
      reason: "the video's host limit is spent",
    });
  });
});

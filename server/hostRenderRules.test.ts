import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOST_AUTO_RETRIES,
  HOST_AUTO_RETRIES_PROTECTED,
  MAX_HOST_REGENERATIONS,
  decideHostRender,
  hostAutoRendersUsed,
} from "../shared/hostRegenLimit";
import {
  activeTakeIndex,
  currentTake,
  recordRegeneratedTake,
  selectHostTake,
} from "../shared/hostTakes";
import { UNNAMED_CLICKER, hostRenderBreakdown } from "../shared/hostSpend";
import {
  hostAccountFailure,
  hostLanePause,
  isHostAccountError,
  isHostRenderCapError,
  resumeHostLane,
} from "./hostLaneFailure";
import {
  PendingRenderError,
  describeUnassemblableScenes,
  runChunkTasks,
} from "./longformVideo";
import { SIXTYNINE_VIDEO_SLOTS } from "./providers/sixtynine-labs";
import type {
  SceneSubmit,
  SceneSubmitReason,
  StoryboardScene,
} from "../shared/types";

const sub = (
  reason: SceneSubmitReason,
  extra: Partial<SceneSubmit> = {}
): SceneSubmit => ({
  provider: "heygen",
  at: "2026-09-25T00:00:00.000Z",
  reason,
  sec: 6,
  ...extra,
});

const host = (
  submits: SceneSubmit[] = [],
  extra: Partial<StoryboardScene> = {}
): StoryboardScene => ({
  index: 4,
  narration: "n",
  visualPrompt: "host on camera",
  hostPresent: true,
  audioDuration: 6,
  submits,
  ...extra,
});

describe("host render allowance", () => {
  it("a check-in gets its first render plus ONE automatic retry", () => {
    expect(HOST_AUTO_RETRIES).toBe(1);
    expect(decideHostRender(host([]), "first").ok).toBe(true);
    expect(decideHostRender(host([sub("first")]), "infra").ok).toBe(true);
    const d = decideHostRender(host([sub("first"), sub("infra")]), "retry");
    expect(d).toEqual({ ok: false, why: "retries", used: 2, cap: 2 });
  });

  it("the start, a CTA or the end gets TWO automatic retries", () => {
    expect(HOST_AUTO_RETRIES_PROTECTED).toBe(2);
    const p = (subs: SceneSubmit[]) => host(subs, { hostProtected: true });
    expect(decideHostRender(p([sub("first"), sub("infra")]), "retry").ok).toBe(
      true
    );
    expect(
      decideHostRender(p([sub("first"), sub("infra"), sub("retry")]), "retry")
        .ok
    ).toBe(false);
  });

  it("a Retry failed scenes click is an automatic render — clicking again never buys more", () => {
    const s = host([sub("first"), sub("retry")]);
    expect(hostAutoRendersUsed(s)).toBe(2);
    expect(decideHostRender(s, "retry").ok).toBe(false);
  });

  it("allows ONE operator regenerate, independent of the automatic count", () => {
    expect(MAX_HOST_REGENERATIONS).toBe(1);
    const spentAuto = host([sub("first"), sub("infra")]);
    expect(decideHostRender(spentAuto, "regenerate").ok).toBe(true);
    const regenerated = host([sub("first"), sub("regenerate")]);
    expect(decideHostRender(regenerated, "regenerate")).toMatchObject({
      ok: false,
      why: "regenerate",
    });
  });

  it("a manager's confirm lets one regenerate past the limit, marked as such", () => {
    const s = host([sub("first"), sub("regenerate")]);
    expect(decideHostRender(s, "regenerate", true)).toEqual({
      ok: true,
      pastLimit: true,
    });
    // ...but never an automatic retry: a person would click Regenerate for that.
    expect(
      decideHostRender(host([sub("first"), sub("infra")]), "retry", true).ok
    ).toBe(false);
  });

  it("ignores b-roll lane entries and never limits a split's panel regenerate", () => {
    const s = host([
      sub("first", { provider: "sixtynine_labs" }),
      sub("first"),
    ]);
    expect(hostAutoRendersUsed(s)).toBe(1);
    const split = host([sub("first"), sub("regenerate")], {
      splitVisual: "a still",
    });
    expect(decideHostRender(split, "regenerate").ok).toBe(true);
  });

  it("a merge renders a new, longer beat — it is not a re-roll", () => {
    const s = host([sub("first"), sub("infra"), sub("regenerate")]);
    expect(decideHostRender(s, "merge").ok).toBe(true);
  });
});

describe("hostAccountFailure", () => {
  it.each([
    ["HeyGen API error (401): unauthorized", "the HeyGen key was rejected"],
    ["HeyGen API error (403): forbidden", "the HeyGen key was rejected"],
    [
      "HeyGen API error (402): payment required",
      "the HeyGen account is out of credits",
    ],
    ["Insufficient credits to render", "the HeyGen account is out of credits"],
    ["HeyGen API error (503): upstream", "HeyGen is not responding"],
    ["HeyGen submit failed after retries", "HeyGen is not responding"],
    ["fetch failed", "HeyGen is not responding"],
    [
      "HeyGen API error (429): slow down",
      "HeyGen is refusing requests (rate limit)",
    ],
  ])("%s ⇒ account", (raw, reason) => {
    expect(hostAccountFailure(raw)).toBe(reason);
  });

  it.each([
    "Invalid audio stream",
    "HeyGen video not found (404): gone",
    "HeyGen avatar registration failed (400): no face detected",
    "empty clip returned (0 bytes)",
    "",
  ])("%s ⇒ this render's own failure", raw => {
    expect(hostAccountFailure(raw)).toBeNull();
  });
});

describe("host takes", () => {
  const withClip = (url: string, extra: Partial<StoryboardScene> = {}) =>
    host([], { clipUrls: [url], clipUrl: url, ...extra });

  it("keeps the old take beside the new one and plays the new one", () => {
    const s = withClip("old.mp4", { lipsyncImageUrl: "a.jpg" });
    const before = currentTake(s, "original");
    s.clipUrls = ["new.mp4"];
    s.clipUrl = "new.mp4";
    s.lipsyncImageUrl = "b.jpg";
    recordRegeneratedTake(s, before, { id: 2, name: "Hank" });
    expect(s.hostTakes?.map(t => t.clipUrls[0])).toEqual([
      "old.mp4",
      "new.mp4",
    ]);
    expect(s.hostTakes?.[1].by?.name).toBe("Hank");
    expect(activeTakeIndex(s)).toBe(1);
  });

  it("switching puts every picture field of the chosen take back, and back again", () => {
    const s = withClip("old.mp4", {
      lipsyncImageUrl: "a.jpg",
      clipShortSec: 0.4,
    });
    const before = currentTake(s, "original");
    s.clipUrls = ["new.mp4"];
    s.clipUrl = "new.mp4";
    s.lipsyncImageUrl = "b.jpg";
    s.clipShortSec = undefined;
    recordRegeneratedTake(s, before);

    expect(selectHostTake(s, 0)).toEqual({ ok: true, changed: true });
    expect(s.clipUrl).toBe("old.mp4");
    expect(s.lipsyncImageUrl).toBe("a.jpg");
    expect(s.clipShortSec).toBe(0.4);

    expect(selectHostTake(s, 1)).toEqual({ ok: true, changed: true });
    expect(s.clipUrl).toBe("new.mp4");
    expect(s.clipShortSec).toBeUndefined();
    expect(selectHostTake(s, 1)).toEqual({ ok: true, changed: false });
  });

  it("starts no take list when the beat had no clip to keep", () => {
    const s = host([]);
    s.clipUrls = ["new.mp4"];
    recordRegeneratedTake(s, null);
    expect(s.hostTakes).toBeUndefined();
  });

  it("refuses a take that does not exist, or a scene that is b-roll now", () => {
    const s = withClip("old.mp4");
    const before = currentTake(s, "original");
    s.clipUrls = ["new.mp4"];
    s.clipUrl = "new.mp4";
    recordRegeneratedTake(s, before);
    expect(selectHostTake(s, 5).ok).toBe(false);
    expect(selectHostTake({ ...s, hostPresent: false }, 0).ok).toBe(false);
  });
});

describe("hostRenderBreakdown (Cost dialog)", () => {
  it("separates the pipeline's renders from people's clicks, with names", () => {
    const hank = { id: 2, name: "Hank" };
    const maria = { id: 3, name: "Maria" };
    const joe = { id: 4, name: "Joe" };
    const scenes = [
      host([sub("first"), sub("infra"), sub("regenerate", { by: hank })]),
      {
        ...host([
          sub("first"),
          sub("regenerate", { by: maria }),
          sub("regenerate", { by: joe, pastLimit: true }),
        ]),
        index: 7,
      },
      {
        ...host([sub("first"), sub("retry", { by: hank }), sub("retry")]),
        index: 9,
      },
      { ...host([sub("first", { provider: "sixtynine_labs" })]), index: 10 },
    ];
    const g = hostRenderBreakdown(scenes);
    expect(g.map(x => [x.kind, x.renders])).toEqual([
      ["first", 3],
      ["auto", 1],
      ["regenerate", 2],
      ["retry", 2],
      ["pastLimit", 1],
    ]);
    const regen = g.find(x => x.kind === "regenerate")!;
    expect(regen.by).toEqual([
      { name: "Hank", renders: 1 },
      { name: "Maria", renders: 1 },
    ]);
    expect(regen.scenes).toEqual([4, 7]);
    expect(g.find(x => x.kind === "retry")!.by).toEqual([
      { name: "Hank", renders: 1 },
      { name: UNNAMED_CLICKER, renders: 1 },
    ]);
    expect(g.find(x => x.kind === "pastLimit")!.by).toEqual([
      { name: "Joe", renders: 1 },
    ]);
    // The automatic lines never carry names.
    expect(g.find(x => x.kind === "first")!.by).toEqual([]);
    expect(g.reduce((n, x) => n + x.sec, 0)).toBe(9 * 6);
  });
});

describe("runChunkTasks and the host allowance", () => {
  const JOB = 7123;
  afterEach(() => resumeHostLane(JOB));
  const run = (
    s: StoryboardScene,
    submit: Parameters<typeof runChunkTasks>[4],
    poll: Parameters<typeof runChunkTasks>[5] = async () => ({
      success: false,
      error: "HeyGen video not found (404): gone",
      infraFailure: true,
    })
  ) =>
    runChunkTasks(
      JOB,
      s,
      "heygen",
      1,
      submit,
      poll,
      async () => {},
      SIXTYNINE_VIDEO_SLOTS
    ).catch(e => e);

  it("refuses a render past the beat's retries without calling HeyGen", async () => {
    const s = host([sub("first"), sub("infra")]);
    s.nextSubmitReason = "retry";
    const submit = vi.fn(async () => ({ taskId: "x" }));
    const err = await run(s, submit);
    expect(isHostRenderCapError(err)).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(s.submits).toHaveLength(2);
  });

  it("an account failure pauses the job's host lane; the next beat never reaches HeyGen", async () => {
    const a = host([]);
    const submitA = vi.fn(async () => ({
      error: "HeyGen API error (402): insufficient credits",
    }));
    const errA = await run(a, submitA);
    expect(isHostAccountError(errA)).toBe(true);
    expect(errA.reason).toBe("the HeyGen account is out of credits");
    expect(submitA).toHaveBeenCalledTimes(1);
    expect(a.submits).toEqual([]); // nothing accepted, nothing counted
    expect(hostLanePause(JOB)).toBeDefined();

    const b = { ...host([]), index: 5 };
    const submitB = vi.fn(async () => ({ taskId: "y" }));
    const errB = await run(b, submitB);
    expect(isHostAccountError(errB)).toBe(true);
    expect(submitB).not.toHaveBeenCalled();

    resumeHostLane(JOB);
    expect(hostLanePause(JOB)).toBeUndefined();
  });

  it("an accepted render HeyGen fails for credits pauses too, and is not resubmitted", async () => {
    const s = host([]);
    const err = await run(
      s,
      async () => ({ taskId: "t1" }),
      async () => ({ success: false, error: "Insufficient credit balance" })
    );
    expect(isHostAccountError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(PendingRenderError);
    expect(s.renderTaskIds).toBeUndefined();
  });

  it("names the clicker on the ledger and marks a confirmed render past the limit", async () => {
    const s = host([sub("first"), sub("regenerate")]);
    s.nextSubmitReason = "regenerate";
    s.nextSubmitBy = { id: 4, name: "Joe" };
    s.nextSubmitOverride = true;
    const err = await run(s, async () => ({ taskId: "t2" }));
    expect(err).toBeInstanceOf(PendingRenderError); // the 404 poll — resubmit later
    const last = s.submits!.at(-1)!;
    expect(last).toMatchObject({
      reason: "regenerate",
      by: { id: 4, name: "Joe" },
      pastLimit: true,
    });
    expect(s.nextSubmitBy).toBeUndefined();
    expect(s.nextSubmitOverride).toBeUndefined();
  });
});

describe("the assembly gate names why host beats are missing", () => {
  it("waiting on the account, and host needed, each with its own way forward", () => {
    const scenes: StoryboardScene[] = [
      host([], {
        index: 1,
        audioUrl: "a.mp3",
        hostWaiting: { reason: "the HeyGen key was rejected", at: "x" },
      }),
      host([], {
        index: 2,
        audioUrl: "a.mp3",
        hostNeeded: { reason: "Invalid audio stream", at: "x" },
      }),
      host([], { index: 3, audioUrl: "a.mp3", clipUrl: "c.mp4" }),
    ];
    const msg = describeUnassemblableScenes(scenes, true)!;
    expect(msg).toContain("Waiting for HeyGen — the HeyGen key was rejected");
    expect(msg).toContain("Retry failed scenes");
    expect(msg).toContain("Host needed on scene(s) 2");
    expect(msg).not.toContain("scene 3");
  });
});

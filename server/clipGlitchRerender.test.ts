import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkedKeyframeOf,
  clipGlitchRerenderEnabled,
  planGlitchRerender,
  renderSceneClip,
  runChunkTasks,
  type SceneClipLanes,
} from "./longformVideo";
import { SIXTYNINE_VIDEO_SLOTS } from "./providers/sixtynine-labs";
import { hostSpendReasonLabel } from "../shared/hostSpend";
import { isAutomaticSubmit } from "../shared/hostRegenLimit";
import type { LongformInputParams, StoryboardScene } from "../shared/types";

// Local job 262 scene 16 (2026-10-18 audit): its clip was judged to move wrong twice, so it was
// paid for twice, drew a new keyframe for each render and a THIRD image for the still it shipped,
// and the second render sat on the ledger as "resume".
const KF = "https://pub.example.r2.dev/longform/262/broll-kf-16-0-a1B2c3.png";
const smokeShot = (over: Partial<StoryboardScene> = {}): StoryboardScene => ({
  index: 16,
  narration: "Photoelectric sees the slow, smoldering fire substantially earlier.",
  visualPrompt:
    "main smoke alarm mounted on hallway ceiling with a thin curl of smoke rising beneath it",
  hostPresent: false,
  selfMoving: true,
  audioDuration: 4.2,
  pictureUrl: KF,
  clipUrls: ["https://pub.example.r2.dev/longform/262/clip-16-0-x.mp4"],
  clipUrl: "https://pub.example.r2.dev/longform/262/clip-16-0-x.mp4",
  renderTaskIds: ["task-1"],
  submits: [{ provider: "sixtynine_labs", at: "2026-10-01T00:00:00.000Z", reason: "first", sec: 4.2 }],
  ...over,
});

describe("checkedKeyframeOf — the start frame the judged clip was rendered from", () => {
  it("is the scene's b-roll keyframe", () => {
    expect(checkedKeyframeOf(smokeShot(), true)).toBe(KF);
    expect(checkedKeyframeOf(smokeShot({ pictureUrl: `${KF}?v=2` }), true)).toBe(`${KF}?v=2`);
  });

  it("is nothing when the clip had no keyframe or the picture is not one", () => {
    // BROLL_NO_KEYFRAME=1: the clip was text-to-video, and pictureUrl may be an older picture's.
    expect(checkedKeyframeOf(smokeShot(), false)).toBeUndefined();
    expect(
      checkedKeyframeOf(smokeShot({ pictureUrl: "https://pub.example.r2.dev/longform/262/still-src-16-q.jpg" }), true)
    ).toBeUndefined();
    expect(checkedKeyframeOf(smokeShot({ pictureUrl: undefined }), true)).toBeUndefined();
  });
});

describe("planGlitchRerender — a clip that moves wrong is paid for once (the operator, 2026-10-18)", () => {
  it("the first glitch makes it the still, from the checked frame — no second render, no glitch reason", () => {
    const s = smokeShot();
    expect(planGlitchRerender(s, { what: "the smoke alarm slid along the ceiling", rerender: false })).toEqual({
      next: "still",
      keyframe: KF,
    });
    expect(s.motionGlitches).toBe(1);
    expect(s.nextSubmitReason).toBeUndefined();
    expect(s.clipUrls).toBeUndefined();
    expect(s.clipUrl).toBeUndefined();
    expect(s.renderTaskIds).toBeUndefined();
    // The frame stays the scene's picture — later pictures are drawn from it (picture memory).
    expect(s.pictureUrl).toBe(KF);
    // The ledger keeps its ONE paid render and says what became of it.
    expect(s.submits).toHaveLength(1);
    expect(s.submits![0]).toMatchObject({ reason: "first", movedWrong: "the smoke alarm slid along the ceiling" });
    // A still from now on, before the still is even made: a retry of a still that failed must
    // never buy the video again.
    expect(s.stillImage).toBe(true);
  });

  it("marks only a b-roll entry — a beat made b-roll keeps its lip-sync ledger untouched", () => {
    const s = smokeShot({
      submits: [{ provider: "heygen", at: "2026-10-01T00:00:00.000Z", reason: "first", sec: 4.2 }],
    });
    planGlitchRerender(s, { what: "x", rerender: false });
    expect(s.submits![0].movedWrong).toBeUndefined();
    // A scene from before the ledger has nothing to mark, and still becomes the still.
    const old = smokeShot({ submits: undefined });
    expect(planGlitchRerender(old, { rerender: false }).next).toBe("still");
    expect(old.submits).toBeUndefined();
  });

  it("a glitch with no keyframe (BROLL_NO_KEYFRAME=1) still never renders again", () => {
    const s = smokeShot({ pictureUrl: "https://pub.example.r2.dev/longform/262/still-src-16-q.jpg" });
    expect(planGlitchRerender(s, { rerender: false })).toEqual({ next: "still", keyframe: undefined });
    expect(s.nextSubmitReason).toBeUndefined();
  });
});

describe("CLIP_GLITCH_RERENDER=1 — the old second render from the same frame", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless the switch is exactly 1", () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "");
    expect(clipGlitchRerenderEnabled()).toBe(false);
    vi.stubEnv("CLIP_GLITCH_RERENDER", "0");
    expect(clipGlitchRerenderEnabled()).toBe(false);
    vi.stubEnv("CLIP_GLITCH_RERENDER", "1");
    expect(clipGlitchRerenderEnabled()).toBe(true);
    // The default of `planGlitchRerender` follows the switch.
    expect(planGlitchRerender(smokeShot()).next).toBe("rerender");
    vi.stubEnv("CLIP_GLITCH_RERENDER", "");
    expect(planGlitchRerender(smokeShot()).next).toBe("still");
  });

  it("the first glitch renders again from the checked frame, ledgered as a glitch re-render", () => {
    const s = smokeShot();
    expect(planGlitchRerender(s, { rerender: true })).toEqual({ next: "rerender", keyframe: KF });
    expect(s.motionGlitches).toBe(1);
    expect(s.nextSubmitReason).toBe("glitch");
    expect(s.clipUrls).toBeUndefined();
    expect(s.pictureUrl).toBe(KF);
    // Still a moving cutaway: the second render is a video.
    expect(s.stillImage).toBeFalsy();
  });

  it("the second glitch makes it the still, made from the frame — never a third paid render", () => {
    const s = smokeShot({ motionGlitches: 1 });
    expect(planGlitchRerender(s, { rerender: true })).toEqual({ next: "still", keyframe: KF });
    expect(s.stillImage).toBe(true);
    expect(s.motionGlitches).toBe(2);
    expect(s.nextSubmitReason).toBeUndefined();
  });
});

describe("the glitch re-render has its own line on the ledger (CLIP_GLITCH_RERENDER=1)", () => {
  const run = (s: StoryboardScene) =>
    runChunkTasks(
      9262,
      s,
      "sixtynine_labs",
      1,
      async () => ({ taskId: "task-2" }),
      async () => ({ success: false, error: "stop here", terminal: true }),
      async () => {},
      SIXTYNINE_VIDEO_SLOTS
    ).catch(e => e);

  it("is written as 'glitch', not 'resume'", async () => {
    const s = smokeShot();
    planGlitchRerender(s, { rerender: true });
    await run(s);
    expect(s.submits?.map(x => x.reason)).toEqual(["first", "glitch"]);
    expect(s.nextSubmitReason).toBeUndefined();
  });

  it("a second submit with no reason given is still a resume", async () => {
    const s = smokeShot({ renderTaskIds: undefined });
    await run(s);
    expect(s.submits?.map(x => x.reason)).toEqual(["first", "resume"]);
  });

  it("is labelled, and counted as the pipeline's own render", () => {
    expect(hostSpendReasonLabel("glitch")).toBe("glitch re-renders");
    expect(isAutomaticSubmit("glitch")).toBe(true);
  });
});

/**
 * The clip loop itself (`renderSceneClip`) with its paid lanes filled in: the clip render writes
 * the ledger the way `runChunkTasks` does (one entry per accepted submit, named by
 * `nextSubmitReason`), the check gives its verdicts in turn, and the still records the frame it
 * was made from.
 */
function lanesFor(scene: StoryboardScene, verdicts: boolean[]) {
  const renders: (string | undefined)[] = [];
  const stills: (string | undefined)[] = [];
  // What the check was told: the picture's description and whether its subject moves by itself.
  const scanned: [string | undefined, boolean | undefined][] = [];
  let stillFailures = 0;
  const lanes: SceneClipLanes = {
    clips: async keyframe => {
      renders.push(keyframe);
      (scene.submits ??= []).push({
        provider: "sixtynine_labs",
        at: "2026-10-18T00:00:00.000Z",
        reason: scene.nextSubmitReason ?? (scene.submits?.length ? "resume" : "first"),
        sec: scene.audioDuration,
      });
      scene.nextSubmitReason = undefined;
      return [`https://pub.example.r2.dev/longform/262/clip-16-${renders.length}.mp4`];
    },
    scan: async (_url, about, selfMoving) => {
      scanned.push([about, selfMoving]);
      return verdicts.shift()
        ? { glitch: true, what: "the smoke alarm slid along the ceiling" }
        : { glitch: false, what: "" };
    },
    // Like `fallbackSceneToStill`: the scene is settled a still only once the still is made.
    still: async keyframe => {
      stills.push(keyframe);
      if (stillFailures-- > 0) throw new Error("ken burns encode failed");
      scene.stillImage = true;
      scene.sceneStatus = "completed";
    },
  };
  return {
    lanes,
    renders,
    stills,
    scanned,
    failStillOnce: () => (stillFailures = 1),
    failStill: (n: number) => (stillFailures = n),
  };
}

const PARAMS = {} as LongformInputParams;
const loop = (scene: StoryboardScene, lanes: SceneClipLanes) =>
  renderSceneClip(scene, 9262, {} as any, PARAMS, null, "instruction", async () => {}, undefined, lanes);
// A fresh scene, before its first render: the keyframe drawn for it is its picture.
const fresh = () =>
  smokeShot({ clipUrls: undefined, clipUrl: undefined, renderTaskIds: undefined, submits: undefined });

describe("renderSceneClip — each paid video is rendered once", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a clip that moves wrong becomes the still made from its checked frame — no second submit", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "");
    const s = fresh();
    const t = lanesFor(s, [true]);
    await loop(s, t.lanes);
    expect(t.renders).toEqual([undefined]); // one paid render
    expect(t.stills).toEqual([KF]); // the still IS the frame — no new image
    expect(s.submits?.map(x => [x.reason, x.movedWrong])).toEqual([
      ["first", "the smoke alarm slid along the ceiling"],
    ]);
    expect(s.motionGlitches).toBe(1);
    expect(s.stillImage).toBe(true);
    expect(s.sceneStatus).toBe("completed");
  });

  it("a still that fails to encode is tried again from the same frame, never a new draw or a render", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "");
    const s = fresh();
    const t = lanesFor(s, [true]);
    t.failStillOnce();
    await loop(s, t.lanes);
    expect(t.renders).toHaveLength(1);
    expect(t.stills).toEqual([KF, KF]);
    expect(s.sceneStatus).toBe("completed");
  });

  it("a still that fails twice leaves a failed STILL — a retry makes the still, never buys the video again", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "");
    const s = fresh();
    const t = lanesFor(s, [true]);
    t.failStill(2);
    await loop(s, t.lanes);
    expect(t.renders).toHaveLength(1);
    expect(t.stills).toEqual([KF, KF]);
    expect(s.sceneStatus).toBe("failed");
    // What "Retry failed scenes" and a restart render from: the scene says still.
    expect(s.stillImage).toBe(true);
    expect(s.submits).toHaveLength(1);
  });

  it("a video that FAILED (no clip judged) whose still fails stays a moving cutaway, as before", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "");
    const s = fresh();
    const t = lanesFor(s, []);
    t.lanes.clips = async () => {
      throw new Error("grok task failed");
    };
    t.failStillOnce();
    await loop(s, t.lanes);
    expect(t.stills).toEqual([undefined]); // a new draw: no frame was checked for a clip
    expect(t.scanned).toEqual([]);
    expect(s.sceneStatus).toBe("failed");
    expect(s.stillImage).toBeFalsy();
    expect(s.motionGlitches).toBeUndefined();
  });

  it("with CLIP_GLITCH_RERENDER=1 the old one re-render from the same frame comes back", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "1");
    const s = fresh();
    const t = lanesFor(s, [true, false]);
    await loop(s, t.lanes);
    expect(t.renders).toEqual([undefined, KF]);
    expect(t.stills).toEqual([]);
    expect(s.submits?.map(x => x.reason)).toEqual(["first", "glitch"]);
    expect(s.submits![0].movedWrong).toBe("the smoke alarm slid along the ceiling");
    expect(s.submits![1].movedWrong).toBeUndefined();
    expect(s.sceneStatus).toBe("completed");
    expect(s.stillImage).toBeFalsy();
  });

  it("with the switch on, a second glitch makes the still from the frame — two renders, never three", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "1");
    const s = fresh();
    const t = lanesFor(s, [true, true]);
    await loop(s, t.lanes);
    expect(t.renders).toEqual([undefined, KF]);
    expect(t.stills).toEqual([KF]);
    expect(s.motionGlitches).toBe(2);
  });

  it("a clean clip is kept as it was — one render, no still, nothing marked", async () => {
    vi.stubEnv("CLIP_GLITCH_RERENDER", "");
    const s = fresh();
    const t = lanesFor(s, [false]);
    await loop(s, t.lanes);
    expect(t.renders).toEqual([undefined]);
    expect(t.stills).toEqual([]);
    // The check is told what the picture is and that its subject moves by itself.
    expect(t.scanned).toEqual([[s.visualPrompt, true]]);
    expect(s.clipUrls).toEqual(["https://pub.example.r2.dev/longform/262/clip-16-1.mp4"]);
    expect(s.submits?.map(x => [x.reason, x.movedWrong])).toEqual([["first", undefined]]);
    expect(s.motionGlitches).toBeUndefined();
    expect(s.stillImage).toBeFalsy();
    expect(s.sceneStatus).toBe("completed");
  });
});

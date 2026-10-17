import { describe, expect, it } from "vitest";
import { checkedKeyframeOf, planGlitchRerender, runChunkTasks } from "./longformVideo";
import { SIXTYNINE_VIDEO_SLOTS } from "./providers/sixtynine-labs";
import { hostSpendReasonLabel } from "../shared/hostSpend";
import { isAutomaticSubmit } from "../shared/hostRegenLimit";
import type { StoryboardScene } from "../shared/types";

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

describe("planGlitchRerender — one more render from the same frame, then the still from it", () => {
  it("the first glitch renders again from the checked frame, ledgered as a glitch re-render", () => {
    const s = smokeShot();
    expect(planGlitchRerender(s)).toEqual({ next: "rerender", keyframe: KF });
    expect(s.motionGlitches).toBe(1);
    expect(s.nextSubmitReason).toBe("glitch");
    expect(s.clipUrls).toBeUndefined();
    expect(s.clipUrl).toBeUndefined();
    expect(s.renderTaskIds).toBeUndefined();
    // The frame stays the scene's picture — later pictures are drawn from it (picture memory).
    expect(s.pictureUrl).toBe(KF);
  });

  it("the second glitch makes it the still, made from the frame — never a third paid render", () => {
    const s = smokeShot({ motionGlitches: 1 });
    expect(planGlitchRerender(s)).toEqual({ next: "still", keyframe: KF });
    expect(s.motionGlitches).toBe(2);
    expect(s.nextSubmitReason).toBeUndefined();
  });
});

describe("the glitch re-render has its own line on the ledger", () => {
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
    planGlitchRerender(s);
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

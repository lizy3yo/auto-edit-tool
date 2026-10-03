import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hostRedoKind,
  isHostPhotoRefusal,
  planHostRedo,
} from "../shared/hostRedo";
import {
  hostAccountFailure,
  hostLanePause,
  isHostAccountError,
  resumeHostLane,
} from "./hostLaneFailure";
import {
  describeUnassemblableScenes,
  prepareHostRedo,
  runChunkTasks,
} from "./longformVideo";
import { SIXTYNINE_VIDEO_SLOTS } from "./providers/sixtynine-labs";
import type { StoryboardScene } from "../shared/types";

// HeyGen's own words, from the film that failed on 2026-10-03.
const REFUSED =
  "HeyGen API error (400): This avatar cannot be used because it did not pass content moderation. (avatar_not_usable)";

const host = (extra: Partial<StoryboardScene> = {}): StoryboardScene => ({
  index: 4,
  narration: "n",
  visualPrompt: "host on camera",
  hostPresent: true,
  audioUrl: "a.mp3",
  audioDuration: 6,
  submits: [],
  ...extra,
});

const picture = (extra: Partial<StoryboardScene> = {}): StoryboardScene => ({
  index: 10,
  narration: "n",
  visualPrompt: "a workbench",
  hostPresent: false,
  stillImage: true,
  audioUrl: "a.mp3",
  audioDuration: 5,
  clipUrl: "still.mp4",
  clipUrls: ["still.mp4"],
  ...extra,
});

describe("a host photo HeyGen refuses", () => {
  it("is recognised, and is neither the account's failure nor another photo problem", () => {
    expect(isHostPhotoRefusal(REFUSED)).toBe(true);
    expect(hostAccountFailure(REFUSED)).toBeNull();
    expect(
      isHostPhotoRefusal(
        "HeyGen avatar registration failed (400): no face detected"
      )
    ).toBe(false);
    expect(isHostPhotoRefusal("Invalid audio stream")).toBe(false);
    expect(isHostPhotoRefusal(undefined)).toBe(false);
  });
});

describe("runChunkTasks stops at the first refusal of a photo", () => {
  const JOB = 7124;
  afterEach(() => resumeHostLane(JOB));
  const run = (
    s: StoryboardScene,
    submit: Parameters<typeof runChunkTasks>[4]
  ) =>
    runChunkTasks(
      JOB,
      s,
      "heygen",
      1,
      submit,
      async () => ({ success: false, error: "unreached" }),
      async () => {},
      SIXTYNINE_VIDEO_SLOTS
    ).catch(e => e);

  it("asks HeyGen once, spends nothing, and the next beat on that photo never reaches it", async () => {
    const a = host({ lipsyncImageUrl: "phone.jpg" });
    const submitA = vi.fn(async () => ({ error: REFUSED }));
    const errA = await run(a, submitA);
    expect(isHostAccountError(errA)).toBe(true);
    expect(errA.photo).toBe(true);
    expect(submitA).toHaveBeenCalledTimes(1); // no second try at a photo that cannot pass
    expect(a.submits).toEqual([]); // nothing accepted, nothing counted

    const b = host({ index: 5, lipsyncImageUrl: "phone.jpg" });
    const submitB = vi.fn(async () => ({ taskId: "y" }));
    const errB = await run(b, submitB);
    expect(isHostAccountError(errB)).toBe(true);
    expect(submitB).not.toHaveBeenCalled();
  });

  it("leaves a beat on ANOTHER photo free to render", async () => {
    await run(host({ lipsyncImageUrl: "phone.jpg" }), async () => ({
      error: REFUSED,
    }));
    expect(hostLanePause(JOB, "phone.jpg")).toBeDefined();
    expect(hostLanePause(JOB, "angle2.jpg")).toBeUndefined();
    const other = host({ index: 6, lipsyncImageUrl: "angle2.jpg" });
    const submit = vi.fn(async () => ({ taskId: "ok" }));
    await run(other, submit);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("a click lifts it", async () => {
    await run(host({ lipsyncImageUrl: "phone.jpg" }), async () => ({
      error: REFUSED,
    }));
    resumeHostLane(JOB);
    expect(hostLanePause(JOB, "phone.jpg")).toBeUndefined();
  });
});

describe("the assembly gate says it once, with the way forward", () => {
  it("names the photo and Redo host clips, not the account", () => {
    const at = "x";
    const msg = describeUnassemblableScenes(
      [
        host({ index: 1, hostWaiting: { reason: "r", at, photo: true } }),
        host({ index: 9, hostWaiting: { reason: "r", at, photo: true } }),
      ],
      true
    )!;
    expect(msg).toContain("HeyGen refused the host photo");
    expect(msg).toContain("(1, 9)");
    expect(msg).toContain("Redo host clips");
    expect(msg).not.toContain("Fix the account");
  });
});

describe("Redo host clips", () => {
  const at = "2026-10-03T00:00:00.000Z";
  const refusedBroll = (index: number) =>
    picture({
      index,
      autoBroll: {
        reason: `host render failed after 0 attempts: ${REFUSED}`,
        at,
      },
    });

  it("takes the waiting beats, the 'Host needed' ones and the check-ins made b-roll for the photo", () => {
    const scenes = [
      host({ index: 1, hostWaiting: { reason: "r", at, photo: true } }),
      host({ index: 13, hostNeeded: { reason: REFUSED, at } }),
      refusedBroll(24),
      host({ index: 30, clipUrl: "ok.mp4" }),
    ];
    const plan = planHostRedo(scenes);
    expect(plan.scenes).toEqual([1, 13, 24]);
    expect(plan.fromBroll).toBe(1);
    expect(plan.sec).toBe(6 + 6 + 5);
  });

  it("leaves everything that was not the photo alone", () => {
    expect(
      hostRedoKind(host({ hostNeeded: { reason: "Invalid audio stream", at } }))
    ).toBeNull();
    expect(
      hostRedoKind(host({ hostWaiting: { reason: "out of credits", at } }))
    ).toBeNull();
    // Made b-roll by the host limit, by another failure, or by a person.
    expect(
      hostRedoKind(picture({ autoBroll: { reason: REFUSED, at, limit: true } }))
    ).toBeNull();
    expect(
      hostRedoKind(
        picture({ autoBroll: { reason: "Invalid audio stream", at } })
      )
    ).toBeNull();
    expect(hostRedoKind(picture())).toBeNull();
    // A frame that is the QR card cannot be a host beat.
    expect(hostRedoKind({ ...refusedBroll(7), qrHero: true })).toBeNull();
  });

  it("makes them clip-less host beats again, with no trace of the refusal", () => {
    const scenes = [
      host({
        index: 13,
        hostNeeded: { reason: REFUSED, at },
        sceneStatus: "failed",
        error: "Host needed",
        lipsyncImageUrl: "phone.jpg",
      }),
      refusedBroll(24),
      host({ index: 30, clipUrl: "ok.mp4", lipsyncImageUrl: "phone.jpg" }),
    ];
    expect(prepareHostRedo(scenes, 1)).toEqual([13, 24]);
    const [needed, was, kept] = scenes;
    expect(needed.hostNeeded).toBeUndefined();
    expect(needed.error).toBeUndefined();
    expect(needed.lipsyncImageUrl).toBeUndefined();
    expect(was.hostPresent).toBe(true);
    expect(was.autoBroll).toBeUndefined();
    expect(was.clipUrl).toBeUndefined();
    expect(was.clipUrls).toEqual([]);
    expect(was.brollVisual).toBe("a workbench"); // "Make b-roll" can still go back
    // A host beat that rendered keeps its clip.
    expect(kept.clipUrl).toBe("ok.mp4");
    expect(planHostRedo(scenes).scenes).toEqual([]);
  });
});

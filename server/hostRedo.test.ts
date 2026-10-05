import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hostRedoKind,
  isHostPhotoPrepFailure,
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

// HeyGen's own words, from the film of 2026-10-05: it could not find the copy of the photo it had
// just made, and every host beat was treated as having failed on its own.
const NOT_FOUND =
  'HeyGen avatar registration failed (404): {"error":{"code":"asset_not_found","doc_url":"https://developers.heygen.com/docs/error-codes#asset-not-found","message":"Asset cf4766654b8e4e239753cb3ee97e29d1 not found"}}';
const CONFLICT =
  'HeyGen avatar registration failed (409): {"error":{"code":"conflict","doc_url":"https://developers.heygen.com/docs/error-codes#conflict","message":"Photo avatar creation conflicted with an existing operation."}}';
const AVATAR_GONE =
  "HeyGen API error (404): Avatar not found: 1cfea30d62c743468e0f4ca0b5e3236d (avatar_not_found)";
const PREP = `HeyGen could not prepare the host photo (404): {"error":{"code":"asset_not_found"}}`;

describe("a host photo HeyGen could not get ready", () => {
  it("is recognised in every wording, old and new, and is not a refusal", () => {
    for (const raw of [NOT_FOUND, CONFLICT, AVATAR_GONE, PREP]) {
      expect(isHostPhotoPrepFailure(raw)).toBe(true);
      expect(isHostPhotoRefusal(raw)).toBe(false);
      expect(hostAccountFailure(raw)).toBeNull();
    }
  });

  it("is not a photo HeyGen turned down, another beat failure, or the account", () => {
    expect(
      isHostPhotoPrepFailure(
        "HeyGen avatar registration failed (400): no face detected"
      )
    ).toBe(false);
    expect(isHostPhotoPrepFailure(REFUSED)).toBe(false);
    expect(isHostPhotoPrepFailure("Invalid audio stream")).toBe(false);
    expect(
      isHostPhotoPrepFailure(
        "HeyGen API error (404): Video(s) not found: a9471f (resource_not_found)"
      )
    ).toBe(false);
    // A registration that died on a HeyGen outage or the key is still the account's.
    expect(
      hostAccountFailure("HeyGen could not prepare the host photo (503): {}")
    ).toBe("HeyGen is not responding");
    expect(
      hostAccountFailure("HeyGen could not prepare the host photo (429): {}")
    ).toMatch(/rate limit/);
    expect(
      hostAccountFailure("HeyGen avatar registration failed (401): {}")
    ).toMatch(/key was rejected/);
  });
});

describe("runChunkTasks makes the beats on that photo wait", () => {
  const JOB = 7125;
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

  it("asks once, spends nothing, and the next beat on the photo never reaches HeyGen", async () => {
    const a = host({ lipsyncImageUrl: "host.jpg", hostProtected: true });
    const submitA = vi.fn(async () => ({ error: PREP }));
    const errA = await run(a, submitA);
    expect(isHostAccountError(errA)).toBe(true);
    expect(errA.photo).toBe(true);
    expect(errA.prep).toBe(true);
    expect(submitA).toHaveBeenCalledTimes(1); // the adapter already did the waiting
    expect(a.submits).toEqual([]); // nothing accepted, nothing counted against the beat

    const b = host({ index: 5, lipsyncImageUrl: "host.jpg" });
    const submitB = vi.fn(async () => ({ taskId: "y" }));
    expect(isHostAccountError(await run(b, submitB))).toBe(true);
    expect(submitB).not.toHaveBeenCalled();

    // Another angle is not held up, and a click lifts the wait.
    expect(hostLanePause(JOB, "angle2.jpg")).toBeUndefined();
    resumeHostLane(JOB);
    expect(hostLanePause(JOB, "host.jpg")).toBeUndefined();
  });
});

describe("the assembly gate says it once, with the way forward", () => {
  it("says the photo is fine and to try again when HeyGen could not prepare it", () => {
    const at = "x";
    const msg = describeUnassemblableScenes(
      [
        host({
          index: 1,
          hostWaiting: { reason: "r", at, photo: true, prep: true },
        }),
        host({
          index: 9,
          hostWaiting: { reason: "r", at, photo: true, prep: true },
        }),
      ],
      true
    )!;
    expect(msg).toContain("HeyGen could not prepare the host photo");
    expect(msg).toContain("(1, 9)");
    expect(msg).toContain("Redo host clips");
    expect(msg).not.toContain("refused");
    expect(msg).not.toContain("Change the photo");
  });

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

  it("takes back what the film of 2026-10-05 lost to a photo HeyGen could not prepare", () => {
    const scenes = [
      host({ index: 1, hostNeeded: { reason: NOT_FOUND, at } }),
      picture({ index: 25, autoBroll: { reason: NOT_FOUND, at } }),
      picture({ index: 70, autoBroll: { reason: CONFLICT, at } }),
      picture({ index: 136, autoBroll: { reason: AVATAR_GONE, at } }),
      host({
        index: 200,
        hostWaiting: { reason: "r", at, photo: true, prep: true },
      }),
    ];
    const plan = planHostRedo(scenes);
    expect(plan.scenes).toEqual([1, 25, 70, 136, 200]);
    expect(plan.fromBroll).toBe(3);
    expect(plan.refused).toBe(0); // nothing to change on the photo — only to try again
    expect(prepareHostRedo(scenes, 1)).toEqual([1, 25, 70, 136, 200]);
    expect(scenes.every(s => s.hostPresent && !s.hostNeeded)).toBe(true);
  });

  it("counts the beats lost to a REFUSED photo, which has to change first", () => {
    expect(
      planHostRedo([
        host({ index: 1, hostWaiting: { reason: "r", at, photo: true } }),
        host({ index: 2, hostNeeded: { reason: NOT_FOUND, at } }),
      ]).refused
    ).toBe(1);
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

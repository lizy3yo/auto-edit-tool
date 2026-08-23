import { describe, it, expect, vi, beforeEach } from "vitest";

// The session needs exactly two DB calls: the job snapshot at start and the row writes it makes
// (processing flip, per-task persists, final settle). Everything else it touches is pure or is
// replaced by the per-task `runOne` seam below, so no provider, ffmpeg or network is involved.
const { updateSpy, getJobSpy } = vi.hoisted(() => ({
  updateSpy: vi.fn(async () => {}),
  getJobSpy: vi.fn(async (_id: number) => null as any),
}));
vi.mock("./db", () => ({
  updateLongformVideoJob: updateSpy,
  getLongformVideoJobById: getJobSpy,
  // Referenced by unrelated helpers at call time only.
  getAppSetting: vi.fn(async () => null),
  getActiveProvider: vi.fn(async () => null),
}));

import {
  enqueueSceneEdit,
  getSceneEditState,
  sceneEditsSettled,
  isJobRegenerating,
  withJobLock,
  type SceneEditRequest,
} from "./longformVideo";

type Gate = { promise: Promise<void>; release: () => void };
const gate = (): Gate => {
  let release!: () => void;
  const promise = new Promise<void>(r => (release = r));
  return { promise, release };
};

/** A storyboard of N finished scenes, so the settle sees no clip-less holes. */
const storyboard = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    narration: `s${i + 1}`,
    visualPrompt: `p${i + 1}`,
    hostPresent: false,
    clipUrl: `https://x/${i + 1}.mp4`,
    clipUrls: [`https://x/${i + 1}.mp4`],
    sceneStatus: "completed",
  }));

let nextJob = 5000;

beforeEach(() => {
  updateSpy.mockClear();
  getJobSpy.mockReset();
});

describe("scene edit session", () => {
  it("runs edits on different scenes CONCURRENTLY, picks up clicks while running, settles once", async () => {
    const jobId = ++nextJob;
    const scenes = storyboard(3);
    getJobSpy.mockResolvedValue({
      id: jobId,
      inputParams: {},
      storyboard: scenes,
    });

    const gates = new Map<number, Gate>();
    const started: number[] = [];
    const runOne = async (_ctx: any, req: SceneEditRequest) => {
      started.push(req.sceneIndex);
      const g = gate();
      gates.set(req.sceneIndex, g);
      await g.promise;
      const scene = scenes.find(s => s.index === req.sceneIndex)!;
      scene.sceneStatus = "completed";
      scene.regenerated = true;
    };

    // Click scene 1 ...
    expect(
      enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 1 }, { runOne })
    ).toBe("queued");
    // ... let the session start it ...
    await vi.waitFor(() => expect(started).toEqual([1]));
    expect(getSceneEditState(jobId)).toEqual({
      queued: [],
      active: [1],
      editing: true,
    });
    expect(isJobRegenerating(jobId)).toBe(true);

    // ... then click scene 2 WHILE 1 is rendering: it starts immediately, not after 1.
    expect(
      enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 2 }, { runOne })
    ).toBe("queued");
    await vi.waitFor(() => expect(started).toEqual([1, 2]));
    expect(getSceneEditState(jobId).active.sort()).toEqual([1, 2]);

    // A click on a scene that is rendering is reported, not silently dropped.
    expect(
      enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 2 }, { runOne })
    ).toBe("ignored");

    // The job row flipped to processing exactly ONCE, on the first batch.
    const processingWrites = updateSpy.mock.calls.filter(
      c => (c as any)[1]?.status === "processing"
    );
    expect(processingWrites).toHaveLength(1);
    expect((processingWrites[0] as any)[1].stage).toBe("clips");

    // Finish 1; the session keeps going for 2 — no settle yet.
    gates.get(1)!.release();
    await vi.waitFor(() =>
      expect(getSceneEditState(jobId).active).toEqual([2])
    );
    expect(
      updateSpy.mock.calls.some(c => (c as any)[1]?.status === "completed")
    ).toBe(false);

    // Scene 1 can be queued again now that its task is done.
    expect(
      enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 1 }, { runOne })
    ).toBe("queued");
    await vi.waitFor(() => expect(started).toEqual([1, 2, 1]));

    gates.get(2)!.release();
    gates.get(1)!.release();
    await sceneEditsSettled(jobId);

    // Settled ONCE: completed, render-only (finalVideoUrl cleared), no error.
    const settles = updateSpy.mock.calls.filter(
      c => (c as any)[1]?.status === "completed"
    );
    expect(settles).toHaveLength(1);
    expect((settles[0] as any)[1]).toMatchObject({
      stage: "done",
      finalVideoUrl: null,
      errorMessage: null,
    });
    expect(getSceneEditState(jobId)).toEqual({
      queued: [],
      active: [],
      editing: false,
    });
    expect(isJobRegenerating(jobId)).toBe(false);
    expect(scenes[0].regenerated).toBe(true);
    expect(scenes[1].regenerated).toBe(true);
    expect(scenes[2].regenerated).toBeUndefined(); // never edited
  });

  it("replaces an unstarted request for the same scene (latest wins) while the lock is held elsewhere", async () => {
    const jobId = ++nextJob;
    const scenes = storyboard(2);
    getJobSpy.mockResolvedValue({
      id: jobId,
      inputParams: {},
      storyboard: scenes,
    });

    // Another pass owns the job lock (say, a retrofit) — the session must wait behind it.
    const hold = gate();
    const other = withJobLock(jobId, () => hold.promise);

    const ran: string[] = [];
    const runOne = async (_ctx: any, req: SceneEditRequest) => {
      ran.push(req.kind === "regen" ? (req.customVisualPrompt ?? "") : "split");
    };
    expect(
      enqueueSceneEdit(
        jobId,
        { kind: "regen", sceneIndex: 1, customVisualPrompt: "first" },
        { runOne }
      )
    ).toBe("queued");
    expect(
      enqueueSceneEdit(
        jobId,
        { kind: "regen", sceneIndex: 1, customVisualPrompt: "second" },
        { runOne }
      )
    ).toBe("superseded");
    // Parked behind another pass: the scene is visibly queued, but `editing` is false — the
    // job's "processing" belongs to THAT pass and the client must keep showing it as such.
    expect(getSceneEditState(jobId)).toEqual({
      queued: [1],
      active: [],
      editing: false,
    });
    // Nothing has run — the lock is held.
    expect(ran).toEqual([]);

    hold.release();
    await other;
    await sceneEditsSettled(jobId);
    expect(ran).toEqual(["second"]); // rendered once, with the latest prompt
  });

  it("a failing task fails ITS scene only; the job settles completed with the error listed", async () => {
    const jobId = ++nextJob;
    const scenes = storyboard(2);
    getJobSpy.mockResolvedValue({
      id: jobId,
      inputParams: {},
      storyboard: scenes,
    });

    const runOne = async (_ctx: any, req: SceneEditRequest) => {
      const scene = scenes.find(s => s.index === req.sceneIndex)!;
      if (req.sceneIndex === 1) {
        scene.sceneStatus = "failed";
        scene.error = "provider said no";
        // Keeps its old clip (single-regen semantics) — the film stays playable.
      } else {
        scene.sceneStatus = "completed";
      }
    };
    enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 1 }, { runOne });
    enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 2 }, { runOne });
    await sceneEditsSettled(jobId);

    const settle = updateSpy.mock.calls.find(
      c => (c as any)[1]?.status === "completed"
    ) as any;
    expect(settle).toBeTruthy();
    expect(settle[1].errorMessage).toMatch(/Scene 1: provider said no/);
    expect(scenes[0].sceneStatus).toBe("failed");
    expect(scenes[1].sceneStatus).toBe("completed");
  });

  it("a clip-less outcome (batch semantics) fails the job so Retry failed scenes is offered", async () => {
    const jobId = ++nextJob;
    const scenes = storyboard(2);
    getJobSpy.mockResolvedValue({
      id: jobId,
      inputParams: {},
      storyboard: scenes,
    });

    const runOne = async (_ctx: any, req: SceneEditRequest) => {
      const scene = scenes.find(s => s.index === req.sceneIndex)!;
      scene.sceneStatus = "failed";
      scene.error = "boom";
    };
    // clearClip: the batch path drops the old clip up front.
    enqueueSceneEdit(
      jobId,
      { kind: "regen", sceneIndex: 1, clearClip: true },
      { runOne }
    );
    await sceneEditsSettled(jobId);
    // prepareSceneEdit cleared the clip; the task failed; the settle sees a hole.
    expect(scenes[0].clipUrls).toEqual([]);
    const settle = updateSpy.mock.calls.find(
      c => (c as any)[1]?.status === "failed"
    ) as any;
    expect(settle).toBeTruthy();
    expect(settle[1].errorMessage).toMatch(/scene 1/);
  });

  it("a new click after the session closed starts a fresh session (nothing lost between them)", async () => {
    const jobId = ++nextJob;
    const scenes = storyboard(1);
    getJobSpy.mockResolvedValue({
      id: jobId,
      inputParams: {},
      storyboard: scenes,
    });
    const ran: number[] = [];
    const runOne = async (_ctx: any, req: SceneEditRequest) => {
      ran.push(req.sceneIndex);
      scenes[0].sceneStatus = "completed";
    };
    enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 1 }, { runOne });
    await sceneEditsSettled(jobId);
    expect(ran).toEqual([1]);
    expect(getSceneEditState(jobId).editing).toBe(false);

    expect(
      enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 1 }, { runOne })
    ).toBe("queued");
    await sceneEditsSettled(jobId);
    expect(ran).toEqual([1, 1]);
    // Two sessions ⇒ two processing flips and two settles.
    expect(
      updateSpy.mock.calls.filter(c => (c as any)[1]?.status === "processing")
    ).toHaveLength(2);
    expect(
      updateSpy.mock.calls.filter(c => (c as any)[1]?.status === "completed")
    ).toHaveLength(2);
  });

  it("a session whose every edit failed leaves the existing final cut alone (no finalVideoUrl reset)", async () => {
    const jobId = ++nextJob;
    const scenes = storyboard(1);
    getJobSpy.mockResolvedValue({
      id: jobId,
      inputParams: {},
      storyboard: scenes,
    });
    const runOne = async (_ctx: any, req: SceneEditRequest) => {
      const scene = scenes.find(s => s.index === req.sceneIndex)!;
      scene.sceneStatus = "failed";
      scene.error = "no credits";
    };
    enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 1 }, { runOne });
    await sceneEditsSettled(jobId);
    const settle = updateSpy.mock.calls.find(
      c => (c as any)[1]?.status === "completed"
    ) as any;
    expect(settle).toBeTruthy();
    expect("finalVideoUrl" in settle[1]).toBe(false); // the old cut stays playable
    expect(settle[1].errorMessage).toMatch(/Scene 1: no credits/);
  });

  it("clears the cut only when a clip actually changed", async () => {
    const jobId = ++nextJob;
    const scenes = storyboard(1);
    getJobSpy.mockResolvedValue({
      id: jobId,
      inputParams: {},
      storyboard: scenes,
    });
    const runOne = async (_ctx: any, req: SceneEditRequest) => {
      scenes.find(s => s.index === req.sceneIndex)!.sceneStatus = "completed";
    };
    enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 1 }, { runOne });
    await sceneEditsSettled(jobId);
    const settle = updateSpy.mock.calls.find(
      c => (c as any)[1]?.status === "completed"
    ) as any;
    expect(settle[1].finalVideoUrl).toBeNull();
  });

  it("a later success on the same scene clears its earlier failure from the settle message", async () => {
    const jobId = ++nextJob;
    const scenes = storyboard(2);
    getJobSpy.mockResolvedValue({
      id: jobId,
      inputParams: {},
      storyboard: scenes,
    });
    const blocker = gate();
    let firstAttempt = true;
    const runOne = async (_ctx: any, req: SceneEditRequest) => {
      const scene = scenes.find(s => s.index === req.sceneIndex)!;
      if (req.sceneIndex === 2) {
        await blocker.promise; // keeps the session open for the re-queue
        scene.sceneStatus = "completed";
        return;
      }
      if (firstAttempt) {
        firstAttempt = false;
        scene.sceneStatus = "failed";
        scene.error = "flaky";
      } else {
        scene.sceneStatus = "completed";
      }
    };
    enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 2 }, { runOne });
    enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 1 }, { runOne });
    await vi.waitFor(() => expect(scenes[0].sceneStatus).toBe("failed"));
    await vi.waitFor(() =>
      expect(getSceneEditState(jobId).active).toEqual([2])
    );
    expect(
      enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 1 }, { runOne })
    ).toBe("queued");
    await vi.waitFor(() => expect(scenes[0].sceneStatus).toBe("completed"));
    blocker.release();
    await sceneEditsSettled(jobId);
    const settle = updateSpy.mock.calls.find(
      c => (c as any)[1]?.status === "completed"
    ) as any;
    expect(settle[1].errorMessage).toBeNull();
  });

  it("drops a request for a scene the storyboard does not have without touching the row", async () => {
    const jobId = ++nextJob;
    const scenes = storyboard(1);
    getJobSpy.mockResolvedValue({
      id: jobId,
      inputParams: {},
      storyboard: scenes,
    });
    const runOne = vi.fn(async () => {});
    enqueueSceneEdit(jobId, { kind: "regen", sceneIndex: 999 }, { runOne });
    await sceneEditsSettled(jobId);
    expect(runOne).not.toHaveBeenCalled();
    // No processing flip, no settle — a stale client cannot un-stitch a finished film.
    expect(
      updateSpy.mock.calls.filter(c => (c as any)[1]?.status !== undefined)
    ).toHaveLength(0);
    expect(getSceneEditState(jobId).editing).toBe(false);
  });
});

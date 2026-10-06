import { describe, it, expect, vi, beforeEach } from "vitest";

// Cancel reads the job, and then either puts the row back or fails it and frees its tab. Those
// are the only DB calls it makes; no provider, ffmpeg or network is involved.
const { updateSpy, getJobSpy, clearSlotsSpy } = vi.hoisted(() => ({
  updateSpy: vi.fn(async (_id: number, _patch: Record<string, unknown>) => {}),
  getJobSpy: vi.fn(async (_id: number) => null as any),
  clearSlotsSpy: vi.fn(async (_id: number) => {}),
}));
vi.mock("./db", () => ({
  updateLongformVideoJob: updateSpy,
  getLongformVideoJobById: getJobSpy,
  clearLongformSlotsByJobId: clearSlotsSpy,
  getAppSetting: vi.fn(async () => null),
  getActiveProvider: vi.fn(async () => null),
}));

import {
  beginRevertiblePass,
  cancelLongformJob,
  endRevertiblePass,
  passStopped,
} from "./longformVideo";

const OWNER = 7;
let nextJob = 9000;

/** The row writes that changed the job's status, in order. */
const statusWrites = () =>
  updateSpy.mock.calls
    .map(c => c[1])
    .filter(p => "status" in p)
    .map(p => ({ status: p.status, stage: p.stage, errorMessage: p.errorMessage }));

beforeEach(() => {
  updateSpy.mockClear();
  clearSlotsSpy.mockClear();
  getJobSpy.mockReset();
});

describe("cancelling a NEW video that is still being made", () => {
  it("marks it failed and frees its tab, as it always did", async () => {
    const jobId = ++nextJob;
    getJobSpy.mockResolvedValue({
      id: jobId,
      userId: OWNER,
      status: "processing",
      stage: "clips",
      storyboard: [],
    });
    expect(await cancelLongformJob(jobId, OWNER)).toBe("cancelled");
    expect(clearSlotsSpy).toHaveBeenCalledWith(jobId);
    expect(statusWrites()).toEqual([
      { status: "failed", stage: undefined, errorMessage: "Cancelled by user" },
    ]);
    expect(passStopped(jobId)).toBe(false);
  });
});

describe("cancelling work on a video that already has its scenes", () => {
  it("puts a finished video back as it was — never failed, never taken off its tab", async () => {
    const jobId = ++nextJob;
    // As the rebuild found it: finished, with its film.
    beginRevertiblePass(jobId, {
      status: "completed",
      stage: "done",
      errorMessage: null,
    });
    // As Cancel finds it, mid-rebuild.
    getJobSpy.mockResolvedValue({
      id: jobId,
      userId: OWNER,
      status: "processing",
      stage: "assembly",
      storyboard: [],
    });
    expect(await cancelLongformJob(jobId, OWNER)).toBe("restored");
    expect(clearSlotsSpy).not.toHaveBeenCalled();
    expect(statusWrites()).toEqual([
      { status: "completed", stage: "done", errorMessage: null },
    ]);
    // The pass is told to stop, and stays told until it has wound down.
    expect(passStopped(jobId)).toBe(true);
    endRevertiblePass(jobId);
    expect(passStopped(jobId)).toBe(false);
  });

  it("puts a video whose last assembly had failed back to exactly that, message and all", async () => {
    const jobId = ++nextJob;
    beginRevertiblePass(jobId, {
      status: "failed",
      stage: "assembly",
      errorMessage: "Assembly dropped 1/40 scene(s)",
    });
    getJobSpy.mockResolvedValue({
      id: jobId,
      userId: OWNER,
      status: "processing",
      stage: "assembly",
      storyboard: [],
    });
    expect(await cancelLongformJob(jobId, OWNER)).toBe("restored");
    expect(statusWrites()).toEqual([
      {
        status: "failed",
        stage: "assembly",
        errorMessage: "Assembly dropped 1/40 scene(s)",
      },
    ]);
    endRevertiblePass(jobId);
  });

  it("goes back to the old cancel once the pass is over", async () => {
    const jobId = ++nextJob;
    beginRevertiblePass(jobId, { status: "completed", stage: "done" });
    endRevertiblePass(jobId);
    getJobSpy.mockResolvedValue({
      id: jobId,
      userId: OWNER,
      status: "processing",
      stage: "clips",
      storyboard: [],
    });
    expect(await cancelLongformJob(jobId, OWNER)).toBe("cancelled");
    expect(clearSlotsSpy).toHaveBeenCalledWith(jobId);
  });

  it("still refuses someone who may not touch the video", async () => {
    const jobId = ++nextJob;
    beginRevertiblePass(jobId, { status: "completed", stage: "done" });
    getJobSpy.mockResolvedValue({
      id: jobId,
      userId: OWNER,
      status: "processing",
      stage: "assembly",
      storyboard: [],
    });
    await expect(cancelLongformJob(jobId, OWNER + 1)).rejects.toThrow(
      "Not authorized"
    );
    expect(passStopped(jobId)).toBe(false);
    expect(statusWrites()).toEqual([]);
    endRevertiblePass(jobId);
  });
});

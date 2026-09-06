import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cancelling or deleting a job must stop the GPU, not just the bookkeeping. RunPod bills by
 * RUNNING time, so a render nobody is waiting for keeps costing money until it finishes or
 * hits the execution cap — measured once at 8 minutes of GPU on a removed job.
 */
const cancelled: string[] = [];
vi.mock("./providers/runpod-lipsync", () => ({
  RunpodLipsyncAdapter: class {
    constructor(
      public ep: string,
      public key: string,
      public quality: string
    ) {}
    async cancelJob(id: string) {
      cancelled.push(id);
    }
  },
}));
vi.mock("./_core/env", () => ({
  ENV: {
    runpodInfinitetalkEndpoint: "ep-1",
    runPodApiKey: "key-1",
  },
}));

const { cancelJobProviderRenders } = await import("./cancelRenders");

beforeEach(() => {
  cancelled.length = 0;
});

const scene = (index: number, provider?: string, ids?: string[]) => ({
  index,
  narration: `s${index}`,
  visualPrompt: "",
  hostPresent: true,
  renderProvider: provider,
  renderTaskIds: ids,
});

describe("cancelJobProviderRenders", () => {
  it("stops every RunPod render the job still holds", async () => {
    const n = await cancelJobProviderRenders(
      {
        id: 52,
        storyboard: [
          scene(1, "runpod", ["task-a"]),
          scene(3, "runpod", ["task-b", "task-c"]),
        ],
      },
      "deleted by user"
    );
    expect(n).toBe(3);
    expect(cancelled).toEqual(["task-a", "task-b", "task-c"]);
  });

  it("leaves other providers alone — a 69Labs task is billed per output, not per second", async () => {
    const n = await cancelJobProviderRenders(
      {
        id: 52,
        storyboard: [
          scene(1, "sixtynine_labs", ["ae_zrq-X0VTAtdzSvPV"]),
          scene(2, "heygen", ["hg-1"]),
          scene(3, "runpod", ["task-a"]),
        ],
      },
      "cancelled by user"
    );
    expect(n).toBe(1);
    expect(cancelled).toEqual(["task-a"]);
  });

  it("is a no-op on a job with nothing in flight, a missing job, or a junk storyboard", async () => {
    expect(await cancelJobProviderRenders(null, "x")).toBe(0);
    expect(await cancelJobProviderRenders({ id: 1 }, "x")).toBe(0);
    expect(
      await cancelJobProviderRenders({ id: 1, storyboard: "not-an-array" }, "x")
    ).toBe(0);
    expect(
      await cancelJobProviderRenders(
        { id: 1, storyboard: [scene(1, "runpod", [])] },
        "x"
      )
    ).toBe(0);
    // A scene mid-submit can hold an empty slot in its id array; never cancel "".
    expect(
      await cancelJobProviderRenders(
        { id: 1, storyboard: [scene(1, "runpod", ["", "task-a"])] },
        "x"
      )
    ).toBe(1);
    expect(cancelled).toEqual(["task-a"]);
  });
});

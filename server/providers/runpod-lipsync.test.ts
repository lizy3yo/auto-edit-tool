import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RunpodLipsyncAdapter,
  RUNPOD_LIPSYNC_EXECUTION_TIMEOUT_MS,
} from "./runpod-lipsync";

// Instant sleeps so the poll cadence and retry backoffs don't slow the suite.
vi.mock("./base", async importOriginal => {
  const mod = await importOriginal<typeof import("./base")>();
  return { ...mod, sleep: () => Promise.resolve() };
});

// The adapter presigns both media URLs before submitting. Presigning is exercised by the
// storage tests; here it would only drag S3 config into a unit test, so it passes through.
vi.mock("../storage", () => ({
  presignOwnBucketUrl: async (url: string) => `${url}?signed`,
}));

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

type FetchCall = { url: string; method: string; body: any };

/**
 * Route by URL: `/run` submits, `/status/...` polls, `/cancel/...` stops a job. Records
 * calls for assertions.
 */
function installFetchMock(routes: {
  run?: (call: FetchCall) => any;
  status?: (call: FetchCall) => any;
  cancel?: (call: FetchCall) => any;
}) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: FetchCall = {
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      if (url.includes("/run")) {
        return routes.run?.(call) ?? jsonRes(200, { id: "job-1" });
      }
      if (url.includes("/status/")) {
        return (
          routes.status?.(call) ??
          jsonRes(200, { status: "COMPLETED", output: { video: "" } })
        );
      }
      if (url.includes("/cancel/")) {
        return routes.cancel?.(call) ?? jsonRes(200, { status: "CANCELLED" });
      }
      throw new Error(`unrouted fetch: ${url}`);
    })
  );
  return calls;
}

const params = {
  imageUrl: "https://cdn.example/host.jpg",
  audioUrl: "https://cdn.example/scene-3.mp3",
  prompt: "An older man speaks to camera.",
  width: 1280,
  height: 720,
};

/** One-frame-ish MP4 stand-in; only the round-trip through base64 matters here. */
const CLIP = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

describe("RunpodLipsyncAdapter.submitLipsync", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("submits the I2V single-person payload with presigned media and the quality tier", async () => {
    const calls = installFetchMock({});
    const adapter = new RunpodLipsyncAdapter("ep-1", "key-1", "fast");

    const res = await adapter.submitLipsync(params);

    expect(res.taskId).toBe("job-1");
    const submit = calls.find(c => c.url.includes("/run"))!;
    expect(submit.url).toBe("https://api.runpod.ai/v2/ep-1/run");
    expect(submit.body.input).toMatchObject({
      input_type: "image",
      person_count: "single",
      // Presigned, not the raw public URL — `*.r2.dev` is blocked on many networks and the
      // worker fetches these itself.
      image_url: "https://cdn.example/host.jpg?signed",
      wav_url: "https://cdn.example/scene-3.mp3?signed",
      prompt: params.prompt,
      width: 1280,
      height: 720,
      quality: "fast",
    });
  });

  it("forwards the negative prompt so motion can be retuned without a worker rebuild", async () => {
    const calls = installFetchMock({});
    await new RunpodLipsyncAdapter("ep-1", "key-1", "fast").submitLipsync({
      ...params,
      negativePrompt: "head shaking, swaying, jitter",
    });
    expect(calls[0].body.input.negative_prompt).toBe(
      "head shaking, swaying, jitter"
    );
  });

  it("omits the field entirely when unset, so an older worker keeps its own default", async () => {
    const calls = installFetchMock({});
    await new RunpodLipsyncAdapter("ep-1", "key-1", "fast").submitLipsync(
      params
    );
    // Sending `undefined` would serialise to null and blank the workflow's own negative
    // prompt on a worker that predates the override — absent must mean absent.
    expect(calls[0].body.input).not.toHaveProperty("negative_prompt");
  });

  it("switches to V2V conditioning when a pinned-camera plate video is supplied", async () => {
    const calls = installFetchMock({});
    await new RunpodLipsyncAdapter("ep-1", "key-1", "fast").submitLipsync({
      ...params,
      videoUrl: "https://cdn.example/plate.mp4",
    });
    const input = calls[0].body.input;
    expect(input.input_type).toBe("video");
    expect(input.video_url).toBe("https://cdn.example/plate.mp4?signed");
    // The photo is not sent alongside — the plate IS the photo, repeated; sending both
    // would leave the worker to pick, and which one wins is not our contract.
    expect(input).not.toHaveProperty("image_url");
  });

  it("sends the V2V anchor-dial overrides only when set", async () => {
    const calls = installFetchMock({});
    const adapter = new RunpodLipsyncAdapter("ep-1", "key-1", "fast");
    await adapter.submitLipsync({
      ...params,
      videoUrl: "https://cdn.example/plate.mp4",
      samplerSteps: 8,
      samplerStartStep: 1,
    });
    expect(calls[0].body.input.steps).toBe(8);
    expect(calls[0].body.input.start_step).toBe(1);

    // Unset must mean absent — the worker's workflow defaults rule, and an older worker
    // image must not receive keys it would misread.
    await adapter.submitLipsync(params);
    expect(calls[1].body.input).not.toHaveProperty("steps");
    expect(calls[1].body.input).not.toHaveProperty("start_step");
  });

  it("sends the motion dials in either mode, and only when set", async () => {
    const calls = installFetchMock({});
    const adapter = new RunpodLipsyncAdapter("ep-1", "key-1", "fast");
    // Photo mode — the dials are not tied to the plate.
    await adapter.submitLipsync({
      ...params,
      shift: 3,
      audioScale: 0.7,
      audioCfgScale: 2,
      nagScale: 14,
      scheduler: "flowmatch_distill",
      motionFrame: 37,
      fetaWeight: 1,
    });
    expect(calls[0].body.input).toMatchObject({
      motion_frame: 37,
      feta_weight: 1,
      input_type: "image",
      shift: 3,
      audio_scale: 0.7,
      audio_cfg_scale: 2,
      nag_scale: 14,
      scheduler: "flowmatch_distill",
    });
    // Unset ⇒ absent, so the workflow's own defaults rule and an older worker sees no keys.
    await adapter.submitLipsync(params);
    for (const k of [
      "shift",
      "audio_scale",
      "audio_cfg_scale",
      "nag_scale",
      "scheduler",
      "motion_frame",
      "feta_weight",
    ])
      expect(calls[1].body.input).not.toHaveProperty(k);
  });

  it("passes quality=full through so the 40-step workflow is selectable per render", async () => {
    const calls = installFetchMock({});
    await new RunpodLipsyncAdapter("ep-1", "key-1", "full").submitLipsync(
      params
    );
    expect(calls[0].body.input.quality).toBe("full");
  });

  it("retries a 5xx submit and reports the failure once the budget is spent", async () => {
    let n = 0;
    installFetchMock({
      run: () => {
        n++;
        return jsonRes(500, { error: "boom" });
      },
    });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).submitLipsync(params);

    expect(n).toBeGreaterThan(1);
    expect(res.taskId).toBeUndefined();
    expect(res.error).toContain("500");
  });
});

describe("RunpodLipsyncAdapter.pollVideo", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("keeps polling through IN_QUEUE/IN_PROGRESS, then decodes the base64 clip", async () => {
    const statuses = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
    let i = 0;
    installFetchMock({
      status: () => {
        const status = statuses[Math.min(i++, statuses.length - 1)];
        return jsonRes(200, {
          status,
          executionTime: 172_110,
          ...(status === "COMPLETED"
            ? { output: { video: CLIP.toString("base64") } }
            : {}),
        });
      },
    });

    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1");

    expect(res.success).toBe(true);
    expect(res.mimeType).toBe("video/mp4");
    expect(Buffer.from(res.fileData!).equals(CLIP)).toBe(true);
    expect(i).toBe(3);
  });

  it("strips a data: prefix if the worker ever adds one", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "COMPLETED",
          output: { video: `data:video/mp4;base64,${CLIP.toString("base64")}` },
        }),
    });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1");
    expect(Buffer.from(res.fileData!).equals(CLIP)).toBe(true);
  });

  it("surfaces a handler error, which arrives inside a COMPLETED job rather than a FAILED one", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "COMPLETED",
          output: { error: "ComfyUI rejected the workflow (400)" },
        }),
    });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1");

    expect(res.success).toBe(false);
    expect(res.error).toContain("ComfyUI rejected the workflow");
    expect(res.infraFailure).toBe(true);
  });

  it("explains a network-volume result instead of reporting an empty render", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "COMPLETED",
          output: { video_path: "/runpod-volume/infinitetalk_task_1.mp4" },
        }),
    });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1");

    expect(res.success).toBe(false);
    expect(res.error).toContain("network-volume");
  });

  it("treats a FAILED job as terminal infra failure, not something to keep polling", async () => {
    installFetchMock({
      status: () => jsonRes(200, { status: "FAILED", error: "CUDA OOM" }),
    });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1");

    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
    expect(res.error).toContain("CUDA OOM");
    expect(res.pending).toBeUndefined();
  });

  it("returns pending (not failed) on client timeout so a resume can collect the render", async () => {
    installFetchMock({ status: () => jsonRes(200, { status: "IN_PROGRESS" }) });

    // A timeout in the past ends the loop after its first pass without waiting.
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1", -1);

    expect(res.success).toBe(false);
    expect(res.pending).toBe(true);
    expect(res.taskId).toBe("job-1");
  });

  it("treats an aged-out job id as terminal so the scene re-submits", async () => {
    installFetchMock({ status: () => jsonRes(404, { error: "not found" }) });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1");

    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
    expect(res.error).toContain("404");
  });
});

describe("RunpodLipsyncAdapter execution cap", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("sends a per-request executionTimeout so the endpoint's own 20-min default cannot kill a long beat", async () => {
    const calls = installFetchMock({});
    await new RunpodLipsyncAdapter("ep-1", "key-1", "fast").submitLipsync(
      params
    );
    expect(calls[0].body.policy).toEqual({
      executionTimeout: RUNPOD_LIPSYNC_EXECUTION_TIMEOUT_MS,
    });
    // Must clear the 20-min dashboard default the lane was first deployed under, and stay
    // under the 45-min scene deadline so RunPod's verdict arrives before the app abandons.
    expect(RUNPOD_LIPSYNC_EXECUTION_TIMEOUT_MS).toBeGreaterThan(20 * 60_000);
    expect(RUNPOD_LIPSYNC_EXECUTION_TIMEOUT_MS).toBeLessThan(45 * 60_000);
  });

  it("marks a render RunPod stopped at the execution cap as terminal — never an infra failure to resubmit", async () => {
    // Verbatim shape of the real verdict: status FAILED (not TIMED_OUT), executionTime just
    // past the cap. Resubmitting this identically was the loop that ran job 17 for 90 min.
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "FAILED",
          error: "executionTimeout exceeded",
          executionTime: 1_207_946,
          delayTime: 19_590,
        }),
    });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1");

    expect(res.success).toBe(false);
    expect(res.terminal).toBe(true);
    expect(res.infraFailure).toBeUndefined();
    expect(res.pending).toBeUndefined();
    // The operator gets the minutes burned and the levers, not a bare status word.
    expect(res.error).toContain("20 min");
    expect(res.error).toMatch(/480p|faster GPU|EXECUTION_TIMEOUT/);
  });

  it("treats a TIMED_OUT status the same way", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, { status: "TIMED_OUT", executionTime: 60_000 }),
    });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1");
    expect(res.terminal).toBe(true);
    expect(res.infraFailure).toBeUndefined();
  });

  it("still resubmits an ordinary FAILED job (a crashed worker is not deterministic)", async () => {
    installFetchMock({
      status: () => jsonRes(200, { status: "FAILED", error: "CUDA OOM" }),
    });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1");
    expect(res.infraFailure).toBe(true);
    expect(res.terminal).toBeUndefined();
  });
});

describe("RunpodLipsyncAdapter.cancelJob", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to the endpoint's cancel route so a stranded render stops billing", async () => {
    const calls = installFetchMock({});
    await new RunpodLipsyncAdapter("ep-1", "key-1", "fast").cancelJob("job-1");

    const cancel = calls.find(c => c.url.includes("/cancel/"))!;
    expect(cancel.url).toBe("https://api.runpod.ai/v2/ep-1/cancel/job-1");
    expect(cancel.method).toBe("POST");
  });

  it("swallows a failed cancel — it is a cost optimisation, never a render blocker", async () => {
    installFetchMock({ cancel: () => jsonRes(500, { error: "nope" }) });
    await expect(
      new RunpodLipsyncAdapter("ep-1", "key-1", "fast").cancelJob("job-1")
    ).resolves.toBeUndefined();
  });

  it("swallows a network error during cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      })
    );
    await expect(
      new RunpodLipsyncAdapter("ep-1", "key-1", "fast").cancelJob("job-1")
    ).resolves.toBeUndefined();
  });

  it("is never triggered by polling itself — a timeout returns pending so a resume can collect", async () => {
    const calls = installFetchMock({
      status: () => jsonRes(200, { status: "IN_PROGRESS" }),
    });
    const res = await new RunpodLipsyncAdapter(
      "ep-1",
      "key-1",
      "fast"
    ).pollVideo("job-1", -1);

    expect(res.pending).toBe(true);
    // Cancelling here would discard GPU time already paid for; only an abandoned scene cancels.
    expect(calls.some(c => c.url.includes("/cancel/"))).toBe(false);
  });
});

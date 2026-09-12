import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LtxLipsyncAdapter,
  LTX_LIPSYNC_EXECUTION_TIMEOUT_MS,
} from "./ltx-lipsync";

// Instant sleeps so the poll cadence and retry backoffs don't slow the suite.
vi.mock("./base", async importOriginal => {
  const mod = await importOriginal<typeof import("./base")>();
  return { ...mod, sleep: () => Promise.resolve() };
});

// Presigning is exercised by the storage tests; here it passes through.
vi.mock("../storage", () => ({
  presignOwnBucketUrl: async (url: string) => `${url}?signed`,
}));

const metered: any[] = [];
vi.mock("../costMeter", () => ({
  recordUsage: (line: any) => {
    metered.push(line);
  },
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
      if (url.includes("/run"))
        return routes.run?.(call) ?? jsonRes(200, { id: "job-1" });
      if (url.includes("/status/"))
        return (
          routes.status?.(call) ??
          jsonRes(200, { status: "COMPLETED", output: { video: "" } })
        );
      if (url.includes("/cancel/"))
        return routes.cancel?.(call) ?? jsonRes(200, { status: "CANCELLED" });
      throw new Error(`unrouted fetch: ${url}`);
    })
  );
  return calls;
}

const params = {
  imageUrl: "https://cdn.example/host.jpg",
  audioUrl: "https://cdn.example/scene-3.mp3",
  prompt: "A woman speaks to camera.",
};

const CLIP = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

beforeEach(() => {
  vi.clearAllMocks();
  metered.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("LtxLipsyncAdapter.submitLipsync", () => {
  it("sends only the photo, the audio and the prompt — the worker's defaults rule", async () => {
    const calls = installFetchMock({});
    const res = await new LtxLipsyncAdapter("ep-ltx", "key-1").submitLipsync(
      params
    );

    expect(res.taskId).toBe("job-1");
    const submit = calls.find(c => c.url.includes("/run"))!;
    expect(submit.url).toBe("https://api.runpod.ai/v2/ep-ltx/run");
    expect(submit.body.input).toEqual({
      image_url: "https://cdn.example/host.jpg?signed",
      audio_url: "https://cdn.example/scene-3.mp3?signed",
      prompt: params.prompt,
    });
    // The per-request GPU cap travels with every submit, as on the InfiniteTalk lane.
    expect(submit.body.policy.executionTimeout).toBe(
      LTX_LIPSYNC_EXECUTION_TIMEOUT_MS
    );
  });

  it("sends the enhancer switch and the render dials only when set", async () => {
    const calls = installFetchMock({});
    const adapter = new LtxLipsyncAdapter("ep-ltx", "key-1");
    await adapter.submitLipsync({
      ...params,
      enhancePrompt: false,
      imgStrength: 1,
      sampler: "euler",
      decodeTile: "1536/384/192/48",
      textCfg: 3,
    });
    expect(calls[0].body.input).toMatchObject({
      enhance_prompt: false,
      img_strength: 1,
      sampler: "euler",
      decode_tile: "1536/384/192/48",
      text_cfg: 3,
    });
    // Unset ⇒ absent: the worker's graph defaults rule, and `false` must be sendable (it is
    // the value that turns the shipped-on enhancer off), so the check is on presence.
    await adapter.submitLipsync(params);
    for (const k of [
      "enhance_prompt",
      "img_strength",
      "sampler",
      "decode_tile",
      "text_cfg",
    ])
      expect(calls[1].body.input).not.toHaveProperty(k);
  });

  it("sends size, seed and the negative prompt only when set", async () => {
    const calls = installFetchMock({});
    const adapter = new LtxLipsyncAdapter("ep-ltx", "key-1");
    await adapter.submitLipsync({
      ...params,
      width: 1920,
      height: 1080,
      seed: 7,
      negativePrompt: "blurry",
    });
    expect(calls[0].body.input).toMatchObject({
      width: 1920,
      height: 1080,
      seed: 7,
      negative_prompt: "blurry",
    });
    // Half a size is no size: never send a width the worker has to pair with its own height.
    await adapter.submitLipsync({ ...params, width: 1920 });
    expect(calls[1].body.input).not.toHaveProperty("width");
    expect(calls[1].body.input).not.toHaveProperty("height");
  });

  it("retries a 5xx submit and reports the failure once the budget is spent", async () => {
    let n = 0;
    installFetchMock({
      run: () => {
        n++;
        return jsonRes(500, { error: "boom" });
      },
    });
    const res = await new LtxLipsyncAdapter("ep-ltx", "key-1").submitLipsync(
      params
    );
    expect(n).toBeGreaterThan(1);
    expect(res.taskId).toBeUndefined();
    expect(res.error).toContain("500");
  });
});

describe("LtxLipsyncAdapter.pollVideo", () => {
  it("polls through IN_QUEUE/IN_PROGRESS, decodes the clip and meters the GPU seconds", async () => {
    const statuses = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
    let i = 0;
    installFetchMock({
      status: () => {
        const status = statuses[Math.min(i++, statuses.length - 1)];
        return jsonRes(200, {
          status,
          executionTime: 95_000,
          ...(status === "COMPLETED"
            ? { output: { video: CLIP.toString("base64") } }
            : {}),
        });
      },
    });

    const res = await new LtxLipsyncAdapter("ep-ltx", "key-1").pollVideo(
      "job-1"
    );

    expect(res.success).toBe(true);
    expect(Buffer.from(res.fileData!).equals(CLIP)).toBe(true);
    expect(res.gpuSeconds).toBe(95);
    expect(i).toBe(3);
    // Metered under its own provider so pricing cannot bill it at InfiniteTalk's or
    // HeyGen's rate by accident.
    expect(metered).toEqual([
      {
        lane: "lipsync",
        provider: "ltx",
        model: "ltx-2.3",
        calls: 1,
        quantity: 95,
      },
    ]);
  });

  it("surfaces a handler error, which arrives inside a COMPLETED job", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "COMPLETED",
          output: { error: "ComfyUI rejected the workflow (400)" },
        }),
    });
    const res = await new LtxLipsyncAdapter("ep-ltx", "key-1").pollVideo(
      "job-1"
    );
    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
    expect(res.error).toContain("ComfyUI rejected the workflow");
    expect(metered).toEqual([]);
  });

  it("treats a render stopped at the execution cap as terminal, and still meters it", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "FAILED",
          error: "executionTimeout exceeded",
          executionTime: 1_500_000,
        }),
    });
    const res = await new LtxLipsyncAdapter("ep-ltx", "key-1").pollVideo(
      "job-1"
    );
    expect(res.success).toBe(false);
    expect(res.terminal).toBe(true);
    expect(res.infraFailure).toBeUndefined();
    expect(res.error).toContain("LTX_LIPSYNC_MAX_SEC");
    expect(metered[0]).toMatchObject({ provider: "ltx", quantity: 1500 });
  });

  it("treats a cancelled job as terminal — never resubmit a render somebody stopped", async () => {
    installFetchMock({
      status: () => jsonRes(200, { status: "CANCELLED" }),
    });
    const res = await new LtxLipsyncAdapter("ep-ltx", "key-1").pollVideo(
      "job-1"
    );
    expect(res.terminal).toBe(true);
    expect(res.infraFailure).toBeUndefined();
  });

  it("treats a FAILED job as an infra failure the orchestrator may resubmit", async () => {
    installFetchMock({
      status: () => jsonRes(200, { status: "FAILED", error: "CUDA OOM" }),
    });
    const res = await new LtxLipsyncAdapter("ep-ltx", "key-1").pollVideo(
      "job-1"
    );
    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
    expect(res.error).toContain("CUDA OOM");
  });

  it("returns pending (not failed) on client timeout so a resume can collect the render", async () => {
    installFetchMock({ status: () => jsonRes(200, { status: "IN_PROGRESS" }) });
    const res = await new LtxLipsyncAdapter("ep-ltx", "key-1").pollVideo(
      "job-1",
      -1
    );
    expect(res.success).toBe(false);
    expect(res.pending).toBe(true);
    expect(res.taskId).toBe("job-1");
  });

  it("treats an aged-out job id as terminal so the scene re-submits", async () => {
    installFetchMock({ status: () => jsonRes(404, { error: "not found" }) });
    const res = await new LtxLipsyncAdapter("ep-ltx", "key-1").pollVideo(
      "job-1"
    );
    expect(res.infraFailure).toBe(true);
    expect(res.error).toContain("404");
  });
});

describe("LtxLipsyncAdapter.cancelJob", () => {
  it("posts the cancel and never throws", async () => {
    const calls = installFetchMock({ cancel: () => jsonRes(500, {}) });
    await expect(
      new LtxLipsyncAdapter("ep-ltx", "key-1").cancelJob("job-9")
    ).resolves.toBeUndefined();
    expect(calls[0].url).toBe("https://api.runpod.ai/v2/ep-ltx/cancel/job-9");
    expect(calls[0].method).toBe("POST");
  });
});

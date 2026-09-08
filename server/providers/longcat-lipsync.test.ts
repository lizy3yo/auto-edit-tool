import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LongcatLipsyncAdapter,
  LONGCAT_EXECUTION_TIMEOUT_MS,
  longcatSegmentsFor,
  longcatDurationFor,
} from "./longcat-lipsync";

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

const recorded: any[] = [];
vi.mock("../costMeter", () => ({
  recordUsage: (line: any) => recorded.push(line),
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
  prompt: "An older woman speaks to camera.",
  resolution: "720p" as const,
  numSegments: 2,
};

/** One-frame-ish MP4 stand-in; only the round-trip through base64 matters here. */
const CLIP = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

describe("longcat segment geometry", () => {
  /**
   * The property that matters for cost: segments are a STEP function of beat length, so
   * trimming a beat without crossing a boundary saves nothing. These have to agree with
   * `worker/geometry.py` in the worker repo — the worker renders what this priced.
   */
  it("buys 3.72s in the first segment and 3.2s in each one after", () => {
    expect(longcatSegmentsFor(0)).toBe(1);
    expect(longcatSegmentsFor(3.72)).toBe(1);
    expect(longcatSegmentsFor(3.73)).toBe(2);
    expect(longcatSegmentsFor(6.92)).toBe(2);
    expect(longcatSegmentsFor(6.93)).toBe(3);
    expect(longcatSegmentsFor(10.12)).toBe(3);

    expect(longcatDurationFor(1)).toBeCloseTo(3.72, 2);
    expect(longcatDurationFor(2)).toBeCloseTo(6.92, 2);
    expect(longcatDurationFor(3)).toBeCloseTo(10.12, 2);
  });

  it("charges a 3.8s beat exactly what a 6.9s beat costs", () => {
    expect(longcatSegmentsFor(3.8)).toBe(longcatSegmentsFor(6.9));
  });
});

describe("LongcatLipsyncAdapter.submitLipsync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorded.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("submits presigned media, the resolution name and an explicit segment count", async () => {
    const calls = installFetchMock({});
    const adapter = new LongcatLipsyncAdapter("ep-1", "key-1");

    const res = await adapter.submitLipsync(params);

    expect(res.taskId).toBe("job-1");
    const submit = calls.find(c => c.url.includes("/run"))!;
    expect(submit.body.input.image_url).toBe(`${params.imageUrl}?signed`);
    expect(submit.body.input.audio_url).toBe(`${params.audioUrl}?signed`);
    // A resolution NAME, not pixels: the worker buckets by the image's aspect ratio.
    expect(submit.body.input.resolution).toBe("720p");
    expect(submit.body.input).not.toHaveProperty("width");
    // Sent explicitly — letting the worker derive it from an 82s example track is how a
    // test render became 26 segments.
    expect(submit.body.input.num_segments).toBe(2);
    expect(submit.body.policy.executionTimeout).toBe(
      LONGCAT_EXECUTION_TIMEOUT_MS
    );
  });

  /**
   * The one real dial on mouth motion here — prompt wording measured 9.30 -> 8.17 against an
   * accepted 2.75, because the distilled path leaves nothing for a prompt to be amplified by.
   * If this stops reaching the worker, the lane silently reverts to the exaggerated mouth.
   */
  it("sends audio_scale, the mouth dial, when the lane sets one", async () => {
    const calls = installFetchMock({});
    await new LongcatLipsyncAdapter("ep-1", "key-1").submitLipsync({
      ...params,
      audioScale: 0.75,
    });
    const input = calls.find(c => c.url.includes("/run"))!.body.input;
    expect(input.audio_scale).toBe(0.75);
  });

  it("omits optional dials so the worker keeps its own defaults", async () => {
    const calls = installFetchMock({});
    await new LongcatLipsyncAdapter("ep-1", "key-1").submitLipsync(params);
    const input = calls.find(c => c.url.includes("/run"))!.body.input;
    for (const key of ["use_int8", "use_distill", "seed", "negative_prompt"]) {
      expect(input).not.toHaveProperty(key);
    }
  });
});

describe("LongcatLipsyncAdapter.pollVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorded.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the clip and meters RunPod's executionTime as GPU seconds", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "COMPLETED",
          executionTime: 696_000,
          output: {
            video: CLIP.toString("base64"),
            duration_sec: 6.91,
            frames: 173,
            segments: 2,
            width: 1152,
            height: 800,
          },
        }),
    });

    const res = await new LongcatLipsyncAdapter("ep-1", "key-1").pollVideo(
      "job-1"
    );

    expect(res.success).toBe(true);
    expect(res.fileData?.equals(CLIP)).toBe(true);
    expect(res.gpuSeconds).toBe(696);
    // Billed by GPU time, not by output — so the metered quantity is seconds of GPU.
    expect(recorded).toEqual([
      {
        lane: "lipsync",
        provider: "longcat",
        model: "longcat-avatar-1.5",
        calls: 1,
        quantity: 696,
      },
    ]);
  });

  it("treats an execution-cap kill as TERMINAL, and still meters the GPU it burned", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "FAILED",
          executionTime: 2_400_000,
          error: "executionTimeout exceeded",
        }),
    });

    const res = await new LongcatLipsyncAdapter("ep-1", "key-1").pollVideo(
      "job-1"
    );

    expect(res.success).toBe(false);
    // Deterministic: the same beat renders the same segments and dies at the same minute.
    // Resubmitting would pay twice for the same failure.
    expect(res.terminal).toBe(true);
    expect(res.infraFailure).toBeFalsy();
    expect(recorded[0].quantity).toBe(2400);
  });

  it("names the GPU architecture mismatch instead of reporting a broken build", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "FAILED",
          error:
            "RuntimeError: CUDA error: no kernel image is available for execution on the device",
        }),
    });

    const res = await new LongcatLipsyncAdapter("ep-1", "key-1").pollVideo(
      "job-1"
    );

    expect(res.terminal).toBe(true);
    expect(res.error).toMatch(/Blackwell/);
    expect(res.error).toMatch(/enabled GPU types/);
  });

  it("does not resubmit a cancelled job", async () => {
    installFetchMock({
      status: () => jsonRes(200, { status: "CANCELLED" }),
    });
    const res = await new LongcatLipsyncAdapter("ep-1", "key-1").pollVideo(
      "job-1"
    );
    expect(res.terminal).toBe(true);
    expect(res.infraFailure).toBeFalsy();
  });

  it("surfaces a worker-level error from a job RunPod calls COMPLETED", async () => {
    // The handler catches its own exceptions and returns `{ error }`, so this is the branch
    // that actually reports what went wrong inside the model — a FAILED status means the
    // worker process died instead.
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "COMPLETED",
          executionTime: 12_000,
          output: { error: "FileNotFoundError: image not found" },
        }),
    });

    const res = await new LongcatLipsyncAdapter("ep-1", "key-1").pollVideo(
      "job-1"
    );

    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
    expect(res.error).toMatch(/FileNotFoundError/);
    // It ran on the GPU to get there, so it is billed and must be metered.
    expect(recorded[0].quantity).toBe(12);
  });
});

describe("longcat host direction", () => {
  const build = async (scene: any = { index: 1 }, mode: any = "longcat") => {
    const { buildLipsyncPrompt } = await import("../longformVideo");
    return buildLipsyncPrompt(scene as any, false, mode);
  };

  /**
   * The distilled path runs at guidance 1.0, which skips the classifier-free pass — so there
   * is no negative-prompt channel at all. Both InfiniteTalk directions delegate their guards
   * to one; this lane cannot, so every guard has to be a positive statement.
   */
  it("states its guards positively, since the negative prompt is inert under distill", async () => {
    const prompt = await build();
    expect(prompt).toMatch(/lips still close completely on p, b and m/i);
    expect(prompt).toMatch(/holding their own shape/i);
    expect(prompt).toMatch(/brows stay resting/i);
    expect(prompt).toMatch(/chest only breathes/i);
  });

  /**
   * Measured 9.30 mouth motion against HeyGen's 2.75 and an accepted band of 2.6-2.9. The
   * cause was InfiniteTalk's anti-mumbling wording imported into a model that does not
   * mumble, contradicting the restraint clause two sentences later. If either phrase comes
   * back, the exaggerated mouth comes back with it.
   */
  it("asks the mouth for restraint, never for articulation", async () => {
    const prompt = await build();
    expect(prompt).toMatch(/jaw barely moves/i);
    expect(prompt).toMatch(/never wide/i);
    expect(prompt).not.toMatch(/articulates every word/i);
    expect(prompt).not.toMatch(/jaw opens/i);
  });

  /**
   * "relaxed and alive rather than stiff" is a counter to InfiniteTalk's stiffness. On a
   * model whose body chain measured INVERTED (lap 4.97 against head 2.52) it argues for the
   * failure, so the stillness has to lead instead.
   */
  it("leads with the lower body and drops the anti-stiffness wording", async () => {
    const prompt = await build();
    expect(prompt).not.toMatch(/relaxed and alive rather than stiff/i);
    const hands = prompt.search(/hands rest where they are/i);
    const head = prompt.search(/the head is calm/i);
    expect(hands).toBeGreaterThan(-1);
    expect(head).toBeGreaterThan(hands);
  });

  /**
   * `gestureCue` exists because InfiniteTalk under-moves. Appending it here adds motion to a
   * model already over-moving. The EXPRESSION cue stays — it steers the face, not the body.
   */
  it("withholds the body cue on this lane but keeps the expression cue", async () => {
    const scene = {
      index: 1,
      deliveryCue: "warm and certain",
      gestureCue: "small nod on the number",
    };
    const longcat = await build(scene);
    expect(longcat).toContain("warm and certain");
    expect(longcat).not.toContain("small nod on the number");

    // Unchanged for every other lane — this gate must not leak into InfiniteTalk.
    const photo = await build(scene, "photo");
    expect(photo).toContain("small nod on the number");
  });
});

describe("longcat cost metering", () => {
  /**
   * The Cost dialog showed "rate not set" beside "1,321s of video" for a lane metered in GPU
   * seconds. Two allowlists gate on the provider name and neither had `longcat`, even though
   * `lipsyncRateFor` did — so the rate was never applied and the unit was labelled as output
   * seconds, which understates a ~700 GPU-second beat as if it were 7 seconds of billing.
   */
  it("prices the lane and labels its quantity as GPU time, not video", async () => {
    const { priceLine } = await import("../pricing");
    const line = {
      lane: "lipsync" as const,
      provider: "longcat",
      model: "longcat-avatar-1.5",
      calls: 1,
      quantity: 696,
    };

    const priced = priceLine(line);
    expect(priced.rateKnown).toBe(true);
    // 696 GPU-s on H100 PCIe at $4.79/h. Wrong by ~75x if the HeyGen per-output rate is used.
    expect(priced.usd).toBeGreaterThan(0.5);
    expect(priced.usd).toBeLessThan(1.5);
  });

  it("keeps both GPU-billed lanes in one set so the rate and the unit cannot disagree", async () => {
    const { GPU_BILLED_LIPSYNC_PROVIDERS } = await import("../pricing");
    expect(GPU_BILLED_LIPSYNC_PROVIDERS.has("runpod")).toBe(true);
    expect(GPU_BILLED_LIPSYNC_PROVIDERS.has("longcat")).toBe(true);
    expect(GPU_BILLED_LIPSYNC_PROVIDERS.has("heygen")).toBe(false);
  });
});

describe("segment sizing", () => {
  /**
   * Measured in production: a 1.74s beat was submitted as TWO segments and billed 673
   * GPU-seconds — 431 per finished second against a normal ~100, roughly $0.90 for under two
   * seconds of video. The lane fell back to a hard-coded 6s when the beat length was not yet
   * known, and 6s rounds up to two segments. A guess that can only be wrong upward costs
   * money on every short beat, so an unknown length now sends nothing and the worker sizes
   * itself from the audio file it is holding.
   */
  it("sizes a short beat to one segment, not two", () => {
    expect(longcatSegmentsFor(1.74)).toBe(1);
    expect(longcatSegmentsFor(3.72)).toBe(1);
    // The value the old fallback used, and why it was expensive.
    expect(longcatSegmentsFor(6)).toBe(2);
  });
});

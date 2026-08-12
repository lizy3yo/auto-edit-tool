import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EchomimicLipsyncAdapter,
  ECHOMIMIC_MAX_AUDIO_SEC,
  ECHOMIMIC_SIZE,
} from "./echomimic-lipsync";

vi.mock("./base", async importOriginal => {
  const mod = await importOriginal<typeof import("./base")>();
  return { ...mod, sleep: () => Promise.resolve() };
});

// The adapter mints a presigned PUT so the worker can upload straight to R2. No S3 in tests.
const presignPut = vi.fn(async (key: string) => ({
  key,
  uploadUrl: `https://r2.example/put/${key}?sig=abc`,
  publicUrl: `https://cdn.example/${key}`,
}));
vi.mock("../storage", () => ({ presignPut: (k: string) => presignPut(k) }));

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

type Call = { url: string; method: string; body: any };

function installFetchMock(routes: {
  run?: (c: Call) => any;
  status?: (c: Call) => any;
}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      if (url.endsWith("/run"))
        return routes.run ? routes.run(call) : jsonRes(200, { id: "job-1" });
      if (url.includes("/status/"))
        return routes.status
          ? routes.status(call)
          : jsonRes(200, {
              status: "COMPLETED",
              output: {
                ok: true,
                gpu_seconds: 96,
                seconds: 5.4,
                box: { x: 420, y: 300, size: 768 },
                detected: true,
              },
            });
      return jsonRes(200, {});
    })
  );
  return calls;
}

const adapter = () => new EchomimicLipsyncAdapter("rp-key", "endpoint-1");
const FALLBACK = { x: 115, y: 312, size: 768 };
const baseParams = {
  plateUrl: "https://cdn.example/plate.png",
  audioUrl: "https://cdn.example/scene.wav",
  outputKey: "longform/echomimic/1.mp4",
  fallbackBox: FALLBACK,
};

beforeEach(() => {
  vi.restoreAllMocks();
  presignPut.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("EchomimicLipsyncAdapter.submitLipsync", () => {
  it("presigns an upload and submits the RunPod job", async () => {
    const calls = installFetchMock({});
    const res = await adapter().submitLipsync({
      ...baseParams,
      durationSec: 5,
    });
    expect(res).toEqual({ taskId: "job-1" });

    const run = calls.find(c => c.url.endsWith("/run"))!;
    expect(run.url).toBe("https://api.runpod.ai/v2/endpoint-1/run");
    // The WHOLE plate goes to the worker — it detects the host and crops there itself.
    expect(run.body.input).toMatchObject({
      plate_url: baseParams.plateUrl,
      audio_url: baseParams.audioUrl,
      upload_url: expect.stringContaining("sig=abc"),
      fallback_box: { x: FALLBACK.x, y: FALLBACK.y },
      size: ECHOMIMIC_SIZE,
      fps: 25,
    });
    expect("image_url" in run.body.input).toBe(false);
    // The worker uploads directly — R2 credentials never leave this process.
    expect(presignPut).toHaveBeenCalledWith(baseParams.outputKey);
  });

  // Standard inference caps at 138 frames ≈ 5.5s, below the pipeline's 8s host ceiling.
  it("rejects over-long narration locally instead of paying for the failure", async () => {
    const calls = installFetchMock({});
    const res = await adapter().submitLipsync({
      ...baseParams,
      durationSec: ECHOMIMIC_MAX_AUDIO_SEC + 2,
    });
    expect(res.taskId).toBeUndefined();
    expect(res.error).toMatch(/at most/);
    expect(calls).toHaveLength(0);
  });

  it("fails clearly when the endpoint is unconfigured", async () => {
    const res = await new EchomimicLipsyncAdapter("rp-key", "").submitLipsync(
      baseParams
    );
    expect(res.error).toMatch(/RUNPOD_ECHOMIMIC_ENDPOINT/);
  });

  it("retries a 5xx and succeeds", async () => {
    let n = 0;
    installFetchMock({
      run: () =>
        ++n === 1
          ? jsonRes(502, { e: "bad gateway" })
          : jsonRes(200, { id: "job-2" }),
    });
    expect(await adapter().submitLipsync(baseParams)).toEqual({
      taskId: "job-2",
    });
    expect(n).toBe(2);
  });
});

describe("EchomimicLipsyncAdapter.pollVideo", () => {
  it("returns the R2 url the worker uploaded to, not bytes", async () => {
    installFetchMock({});
    const a = adapter();
    await a.submitLipsync(baseParams);
    const r = await a.pollVideo("job-1", 60_000);
    expect(r.success).toBe(true);
    expect(r.fileUrl).toBe(`https://cdn.example/${baseParams.outputKey}`);
    // No download/re-upload round trip — runChunkTasks takes the fileUrl branch.
    expect(r.fileData).toBeUndefined();
  });

  // The detected box is what the server composites back to; without it the animated square
  // would land wherever the fixed guess said, which is the bug detection exists to fix.
  it("surfaces the box the worker actually cut from", async () => {
    installFetchMock({});
    const a = adapter();
    await a.submitLipsync(baseParams);
    const r = await a.pollVideo("job-1", 60_000);
    expect(r.box).toEqual({ x: 420, y: 300, size: 768 });
    expect(r.detected).toBe(true);
  });

  it("reports detected=false so a fallback crop is visible in the logs", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "COMPLETED",
          output: {
            ok: true,
            box: { x: 115, y: 312, size: 768 },
            detected: false,
          },
        }),
    });
    const a = adapter();
    await a.submitLipsync(baseParams);
    const r = await a.pollVideo("job-1", 60_000);
    expect(r.success).toBe(true);
    expect(r.detected).toBe(false);
  });

  it("keeps polling through IN_QUEUE and IN_PROGRESS", async () => {
    let n = 0;
    installFetchMock({
      status: () =>
        jsonRes(
          200,
          ++n < 3
            ? { status: n === 1 ? "IN_QUEUE" : "IN_PROGRESS" }
            : { status: "COMPLETED", output: { ok: true } }
        ),
    });
    const a = adapter();
    await a.submitLipsync(baseParams);
    expect((await a.pollVideo("job-1", 60_000)).success).toBe(true);
    expect(n).toBe(3);
  });

  it.each(["FAILED", "CANCELLED", "TIMED_OUT"])(
    "treats %s as an infraFailure so the orchestrator re-submits",
    async status => {
      installFetchMock({
        status: () => jsonRes(200, { status, error: "boom" }),
      });
      const r = await adapter().pollVideo("job-1", 60_000);
      expect(r.success).toBe(false);
      expect(r.infraFailure).toBe(true);
    }
  );

  // COMPLETED means the worker returned, not that it succeeded — our handler reports its own
  // errors in output.error with a 200.
  it("catches a handler-level error inside a COMPLETED job", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          status: "COMPLETED",
          output: { error: "inference failed", ok: false },
        }),
    });
    const r = await adapter().pollVideo("job-1", 60_000);
    expect(r.success).toBe(false);
    expect(r.infraFailure).toBe(true);
    expect(r.error).toMatch(/inference failed/);
  });

  // A resumed poll in a fresh process has no in-memory job→url map.
  it("uses expectedUrl when resuming a job submitted before a restart", async () => {
    installFetchMock({});
    const r = await adapter().pollVideo(
      "job-restarted",
      60_000,
      "https://cdn.example/known.mp4"
    );
    expect(r.success).toBe(true);
    expect(r.fileUrl).toBe("https://cdn.example/known.mp4");
  });

  it("fails loudly rather than guessing when the destination is unknown", async () => {
    installFetchMock({});
    const r = await adapter().pollVideo("job-orphan", 60_000);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/destination URL is unknown/);
  });

  it("treats a rejected key as terminal without inviting a re-submit", async () => {
    installFetchMock({ status: () => jsonRes(401, {}) });
    const r = await adapter().pollVideo("job-1", 60_000);
    expect(r.success).toBe(false);
    expect(r.infraFailure).toBeUndefined();
  });

  it("returns pending on client timeout so the job resumes", async () => {
    installFetchMock({});
    const r = await adapter().pollVideo("job-1", 0);
    expect(r.pending).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WavespeedLipsyncAdapter,
  WAVESPEED_MODELS,
  wavespeedSlotsFor,
} from "./wavespeed-lipsync";
import { ENV } from "../_core/env";

vi.mock("./base", async importOriginal => {
  const mod = await importOriginal<typeof import("./base")>();
  return { ...mod, sleep: () => Promise.resolve() };
});

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new Uint8Array([7, 7, 7]).buffer,
  };
}

type Call = { url: string; method: string; body: any; headers: any };

function installFetchMock(routes: {
  submit?: (c: Call) => any;
  result?: (c: Call) => any;
}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body as string) : undefined,
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      if (call.method === "POST")
        return routes.submit
          ? routes.submit(call)
          : jsonRes(200, { code: 200, data: { id: "pred-1" } });
      if (url.includes("/predictions/"))
        return routes.result
          ? routes.result(call)
          : jsonRes(200, {
              data: {
                id: "pred-1",
                status: "completed",
                outputs: ["https://cdn.wavespeed/x.mp4"],
                timings: { inference: 42000 },
              },
            });
      return jsonRes(200, {});
    })
  );
  return calls;
}

const adapter = () => new WavespeedLipsyncAdapter("ws-key");
const base = {
  imageUrl: "https://cdn.example/host.png",
  audioUrl: "https://cdn.example/scene.wav",
};

const origRes = ENV.wavespeedResolution;
beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  ENV.wavespeedResolution = origRes;
});

describe("WavespeedLipsyncAdapter.submitLipsync", () => {
  it("POSTs the InfiniteTalk model with image + audio and returns the prediction id", async () => {
    const calls = installFetchMock({});
    const res = await adapter().submitLipsync({ ...base, durationSec: 6 });
    expect(res).toEqual({ taskId: "pred-1" });

    const submit = calls.find(c => c.method === "POST")!;
    expect(submit.url).toBe(
      "https://api.wavespeed.ai/api/v3/wavespeed-ai/infinitetalk"
    );
    expect(submit.headers.Authorization).toBe("Bearer ws-key");
    expect(submit.body).toMatchObject({
      image: base.imageUrl,
      audio: base.audioUrl,
      resolution: "720p",
    });
    // Our own TTS drives the mouth — never a model-generated voice or a script field.
    expect("voice" in submit.body).toBe(false);
    expect("text" in submit.body).toBe(false);
  });

  it("honours the 480p tier when configured", async () => {
    ENV.wavespeedResolution = "480p";
    const calls = installFetchMock({});
    await adapter().submitLipsync(base);
    expect(calls[0].body.resolution).toBe("480p");
  });

  // The cheap lane — $0.015/s against HeyGen's $0.067 — must hit its own endpoint, and its
  // documented schema has NO resolution field, so sending one risks a 422 we still pay for.
  it("routes to InfiniteTalk Fast and omits the undocumented resolution field", async () => {
    const calls = installFetchMock({});
    await new WavespeedLipsyncAdapter(
      "ws-key",
      WAVESPEED_MODELS["infinitetalk-fast"]
    ).submitLipsync(base);
    expect(calls[0].url).toBe(
      "https://api.wavespeed.ai/api/v3/wavespeed-ai/infinitetalk-fast"
    );
    expect("resolution" in calls[0].body).toBe(false);
    expect(calls[0].body).toMatchObject({
      image: base.imageUrl,
      audio: base.audioUrl,
    });
  });

  // Every model takes the identical input shape; only the endpoint and ceiling differ.
  it("routes to the Hunyuan Avatar endpoint when that model is selected", async () => {
    const calls = installFetchMock({});
    await new WavespeedLipsyncAdapter(
      "ws-key",
      WAVESPEED_MODELS.hunyuan
    ).submitLipsync(base);
    expect(calls[0].url).toBe(
      "https://api.wavespeed.ai/api/v3/wavespeed-ai/hunyuan-avatar"
    );
    expect(calls[0].body).toMatchObject({
      image: base.imageUrl,
      audio: base.audioUrl,
      resolution: "720p",
    });
  });

  // Host scenes cap at 8s so neither ceiling bites, but a submit past it is a billed reject.
  it.each([
    ["infinitetalk", 600],
    ["infinitetalk-fast", 600],
    ["hunyuan", 120],
  ])("rejects narration past %s's %ds ceiling locally", async (key, max) => {
    const calls = installFetchMock({});
    const res = await new WavespeedLipsyncAdapter(
      "ws-key",
      WAVESPEED_MODELS[key as string]
    ).submitLipsync({ ...base, durationSec: max + 1 });
    expect(res.taskId).toBeUndefined();
    expect(res.error).toMatch(new RegExp(`at most ${max}s`));
    expect(calls).toHaveLength(0);
  });

  // A 200 can still carry a business-level rejection in the envelope.
  it("treats a non-200 code inside a 200 body as a failure", async () => {
    installFetchMock({
      submit: () =>
        jsonRes(200, { code: 400, message: "insufficient balance" }),
    });
    const res = await adapter().submitLipsync(base);
    expect(res.taskId).toBeUndefined();
    expect(res.error).toMatch(/insufficient balance/);
  });

  it("retries a 429 and succeeds", async () => {
    let n = 0;
    installFetchMock({
      submit: () =>
        ++n === 1
          ? jsonRes(429, { message: "rate limited" })
          : jsonRes(200, { code: 200, data: { id: "pred-2" } }),
    });
    expect(await adapter().submitLipsync(base)).toEqual({ taskId: "pred-2" });
    expect(n).toBe(2);
  });
});

describe("WavespeedLipsyncAdapter.pollVideo", () => {
  it("downloads the output once the prediction completes", async () => {
    installFetchMock({});
    const r = await adapter().pollVideo("pred-1", 60_000);
    expect(r.success).toBe(true);
    expect(r.mimeType).toBe("video/mp4");
    expect(Buffer.from(r.fileData as Buffer)).toEqual(Buffer.from([7, 7, 7]));
  });

  it("keeps polling through created and processing", async () => {
    let n = 0;
    installFetchMock({
      result: () =>
        jsonRes(200, {
          data:
            ++n < 3
              ? { status: n === 1 ? "created" : "processing" }
              : {
                  status: "completed",
                  outputs: ["https://cdn.wavespeed/x.mp4"],
                },
        }),
    });
    expect((await adapter().pollVideo("pred-1", 60_000)).success).toBe(true);
    expect(n).toBe(3);
  });

  it.each(["failed", "cancelled", "timeout"])(
    "treats %s as an infraFailure so the orchestrator re-submits",
    async status => {
      installFetchMock({
        result: () => jsonRes(200, { data: { status, error: "boom" } }),
      });
      const r = await adapter().pollVideo("pred-1", 60_000);
      expect(r.success).toBe(false);
      expect(r.infraFailure).toBe(true);
      expect(r.error).toMatch(/boom/);
    }
  );

  it("marks an unknown prediction id (e.g. a stale HeyGen taskId) as infraFailure", async () => {
    installFetchMock({ result: () => jsonRes(404, {}) });
    const r = await adapter().pollVideo("heygen-stale", 60_000);
    expect(r.success).toBe(false);
    expect(r.infraFailure).toBe(true);
  });

  // Re-submitting cannot fix a revoked key, so it must NOT be flagged infraFailure.
  it("treats a rejected key as terminal without inviting a re-submit", async () => {
    installFetchMock({ result: () => jsonRes(401, {}) });
    const r = await adapter().pollVideo("pred-1", 60_000);
    expect(r.success).toBe(false);
    expect(r.infraFailure).toBeUndefined();
  });

  it("errors when a completed prediction carries no output url", async () => {
    installFetchMock({
      result: () =>
        jsonRes(200, { data: { status: "completed", outputs: [] } }),
    });
    const r = await adapter().pollVideo("pred-1", 60_000);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no output url/);
  });

  it("returns pending on client timeout so the job resumes instead of re-paying", async () => {
    installFetchMock({});
    const r = await adapter().pollVideo("pred-1", 0);
    expect(r.pending).toBe(true);
    expect(r.taskId).toBe("pred-1");
  });
});

describe("per-account isolation", () => {
  it("gives each API key its own concurrency semaphore", () => {
    expect(wavespeedSlotsFor("ws-a")).toBe(wavespeedSlotsFor("ws-a"));
    expect(wavespeedSlotsFor("ws-a")).not.toBe(wavespeedSlotsFor("ws-b"));
  });
});

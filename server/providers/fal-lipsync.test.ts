import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FalLipsyncAdapter,
  FAL_LIPSYNC_MODELS,
  falQueueApp,
  falSlotsFor,
  notifyFalRequest,
  waitForFalRequest,
} from "./fal-lipsync";
import { ENV } from "../_core/env";

// Instant sleeps so retry/poll backoffs don't slow the suite.
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
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  };
}

type FetchCall = {
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
};

/**
 * Route fetches by URL shape. fal has no registration step, so there are only three kinds of
 * call: the queue submit (POST), `/requests/{id}/status`, and the result GET.
 */
function installFetchMock(routes: {
  submit?: (call: FetchCall) => any;
  status?: (call: FetchCall) => any;
  result?: (call: FetchCall) => any;
  download?: (call: FetchCall) => any;
}) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: FetchCall = {
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body as string) : undefined,
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      if (call.method === "POST")
        return routes.submit
          ? routes.submit(call)
          : jsonRes(200, {
              request_id: "req-1",
              response_url:
                "https://queue.fal.run/fal-ai/bytedance/requests/req-1",
            });
      if (url.endsWith("/status"))
        return routes.status
          ? routes.status(call)
          : jsonRes(202, { status: "IN_QUEUE", queue_position: 3 });
      if (url.includes("/requests/"))
        return routes.result
          ? routes.result(call)
          : jsonRes(200, { video: { url: "https://v3.fal.media/x.mp4" } });
      return routes.download ? routes.download(call) : jsonRes(200, {});
    })
  );
  return calls;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("falQueueApp", () => {
  // The queue routes hang off the two-segment APP id, not the full endpoint path. Guessing
  // wrong 404s every poll while the render bills anyway.
  it("takes the first two path segments of the endpoint id", () => {
    expect(falQueueApp("fal-ai/bytedance/omnihuman/v1.5")).toBe(
      "fal-ai/bytedance"
    );
    expect(falQueueApp("fal-ai/flux/dev")).toBe("fal-ai/flux");
    expect(falQueueApp("fal-ai/infinitalk")).toBe("fal-ai/infinitalk");
  });
});

describe("FalLipsyncAdapter.submitLipsync", () => {
  it("POSTs the raw input to the queue and returns the request_id as the taskId", async () => {
    const calls = installFetchMock({});
    const res = await new FalLipsyncAdapter("key").submitLipsync({
      imageUrl: "https://cdn.example.com/host.png",
      audioUrl: "https://cdn.example.com/a.mp3",
      durationSec: 6,
    });
    expect(res).toEqual({ taskId: "req-1" });

    const submit = calls.find(c => c.method === "POST")!;
    expect(submit.url).toContain(
      "https://queue.fal.run/fal-ai/bytedance/omnihuman/v1.5"
    );
    // `Key <token>`, not `Bearer` — fal 401s a Bearer prefix.
    expect(submit.headers.Authorization).toBe("Key key");
    // Raw body, NOT wrapped in `{ input: … }` (that wrapper is SDK-only and 422s over REST).
    expect(submit.body).toMatchObject({
      image_url: "https://cdn.example.com/host.png",
      audio_url: "https://cdn.example.com/a.mp3",
      resolution: "1080p",
    });
    expect("input" in submit.body).toBe(false);
  });

  it("rejects narration longer than the model accepts without paying for the 422", async () => {
    const calls = installFetchMock({});
    const res = await new FalLipsyncAdapter("key").submitLipsync({
      imageUrl: "https://x/host.png",
      audioUrl: "https://x/a.mp3",
      durationSec: 45, // over omnihuman's 30s 1080p ceiling
    });
    expect(res.taskId).toBeUndefined();
    expect(res.error).toMatch(/accepts at most 30s/);
    expect(calls).toHaveLength(0);
  });

  it("sizes a frame-count model from the narration length", async () => {
    const calls = installFetchMock({});
    await new FalLipsyncAdapter(
      "key",
      FAL_LIPSYNC_MODELS.infinitalk
    ).submitLipsync({
      imageUrl: "https://x/host.png",
      audioUrl: "https://x/a.mp3",
      durationSec: 6,
    });
    // Rounded UP (6s × 25fps + 1) — a short render trips the truncation guard and is re-paid.
    expect(calls[0].body.num_frames).toBe(151);
  });

  it("returns an error (not a throw) when the submit fails hard", async () => {
    installFetchMock({ submit: () => jsonRes(422, { detail: "bad audio" }) });
    const res = await new FalLipsyncAdapter("key").submitLipsync({
      imageUrl: "https://x/host.png",
      audioUrl: "https://x/a.mp3",
    });
    expect(res.taskId).toBeUndefined();
    expect(res.error).toMatch(/fal API error \(422\)/);
  });

  it("retries a 429 and succeeds", async () => {
    let attempts = 0;
    installFetchMock({
      submit: () =>
        ++attempts === 1
          ? jsonRes(429, { detail: "rate limited" })
          : jsonRes(200, { request_id: "req-2" }),
    });
    const res = await new FalLipsyncAdapter("key").submitLipsync({
      imageUrl: "https://x/host.png",
      audioUrl: "https://x/a.mp3",
    });
    expect(res).toEqual({ taskId: "req-2" });
    expect(attempts).toBe(2);
  });
});

describe("FalLipsyncAdapter.pollVideo", () => {
  it("downloads the video once the request COMPLETEs", async () => {
    installFetchMock({ status: () => jsonRes(200, { status: "COMPLETED" }) });
    const res = await new FalLipsyncAdapter("key").pollVideo("req-1", 60_000);
    expect(res.success).toBe(true);
    expect(res.mimeType).toBe("video/mp4");
    expect(Buffer.from(res.fileData as Buffer)).toEqual(
      Buffer.from([1, 2, 3, 4])
    );
  });

  it("keeps polling through the 202 queue states", async () => {
    let n = 0;
    installFetchMock({
      status: () =>
        ++n < 3
          ? jsonRes(202, { status: n === 1 ? "IN_QUEUE" : "IN_PROGRESS" })
          : jsonRes(200, { status: "COMPLETED" }),
    });
    const res = await new FalLipsyncAdapter("key").pollVideo("req-1", 60_000);
    expect(res.success).toBe(true);
    expect(n).toBe(3);
  });

  // COMPLETED means "the worker is done", not "the worker succeeded" — an errored render only
  // surfaces on the result fetch.
  it("marks a completed-but-errored render as infraFailure so the orchestrator re-submits", async () => {
    installFetchMock({
      status: () => jsonRes(200, { status: "COMPLETED" }),
      result: () => jsonRes(500, { detail: "render exploded" }),
    });
    const res = await new FalLipsyncAdapter("key").pollVideo("req-1", 60_000);
    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
    expect(res.error).toMatch(/render exploded/);
  });

  it("marks an unknown request id (e.g. a stale HeyGen taskId) as infraFailure", async () => {
    installFetchMock({ status: () => jsonRes(404, { detail: "not found" }) });
    const res = await new FalLipsyncAdapter("key").pollVideo(
      "heygen-stale-id",
      60_000
    );
    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
  });

  // Re-submitting cannot fix a revoked key, so it must NOT be flagged infraFailure.
  it("treats a rejected key as terminal without inviting a re-submit", async () => {
    installFetchMock({
      status: () => jsonRes(401, { detail: "unauthorized" }),
    });
    const res = await new FalLipsyncAdapter("key").pollVideo("req-1", 60_000);
    expect(res.success).toBe(false);
    expect(res.infraFailure).toBeUndefined();
    expect(res.error).toMatch(/rejected the API key/);
  });

  it("returns pending on client timeout so the job resumes instead of re-submitting", async () => {
    installFetchMock({});
    const res = await new FalLipsyncAdapter("key").pollVideo("req-1", 0);
    expect(res.success).toBe(false);
    expect(res.pending).toBe(true);
    expect(res.taskId).toBe("req-1");
  });

  it("polls the response_url fal handed back at submit time", async () => {
    const calls = installFetchMock({
      submit: () =>
        jsonRes(200, {
          request_id: "req-9",
          response_url: "https://queue.fal.run/custom/app/requests/req-9",
        }),
      status: () => jsonRes(200, { status: "COMPLETED" }),
    });
    const adapter = new FalLipsyncAdapter("key");
    await adapter.submitLipsync({
      imageUrl: "https://x/host.png",
      audioUrl: "https://x/a.mp3",
    });
    await adapter.pollVideo("req-9", 60_000);
    expect(
      calls.some(
        c => c.url === "https://queue.fal.run/custom/app/requests/req-9/status"
      )
    ).toBe(true);
  });

  it("reconstructs the queue URL for an id submitted before a restart", async () => {
    const calls = installFetchMock({
      status: () => jsonRes(200, { status: "COMPLETED" }),
    });
    // Fresh adapter, no in-memory response_url — the two-segment app id has to carry it.
    await new FalLipsyncAdapter("key").pollVideo("req-after-restart", 60_000);
    expect(calls[0].url).toBe(
      "https://queue.fal.run/fal-ai/bytedance/requests/req-after-restart/status"
    );
  });
});

describe("completion webhook", () => {
  const submitUrl = async () => {
    const calls = installFetchMock({});
    await new FalLipsyncAdapter("key").submitLipsync({
      imageUrl: "https://x/host.png",
      audioUrl: "https://x/a.mp3",
    });
    return calls.find(c => c.method === "POST")!.url;
  };

  it("asks fal to call back when a public base URL is configured", async () => {
    const prev = ENV.publicBaseUrl;
    ENV.publicBaseUrl = "https://app.example.com/";
    try {
      expect(await submitUrl()).toMatch(
        /\?fal_webhook=https%3A%2F%2Fapp\.example\.com%2Fapi%2Fwebhooks%2Ffal%2F[0-9a-f]{32}$/
      );
    } finally {
      ENV.publicBaseUrl = prev;
    }
  });

  it("omits the callback when unconfigured (poll-only, e.g. local dev)", async () => {
    const prev = ENV.publicBaseUrl;
    ENV.publicBaseUrl = "";
    try {
      expect(await submitUrl()).not.toContain("fal_webhook");
    } finally {
      ENV.publicBaseUrl = prev;
    }
  });

  const settled = (p: Promise<void>) =>
    Promise.race([p.then(() => true), Promise.resolve().then(() => false)]);

  it("wakes a parked poll loop and unregisters it", async () => {
    const w = waitForFalRequest("req-hook");
    expect(await settled(w.wait)).toBe(false);
    notifyFalRequest("req-hook");
    expect(await settled(w.wait)).toBe(true);
    const again = waitForFalRequest("req-hook");
    expect(await settled(again.wait)).toBe(false);
    again.cancel();
    w.cancel(); // idempotent after the wake
  });

  it("replays a callback that arrived before anyone was waiting", async () => {
    notifyFalRequest("req-early");
    expect(await settled(waitForFalRequest("req-early").wait)).toBe(true);
    const next = waitForFalRequest("req-early");
    expect(await settled(next.wait)).toBe(false);
    next.cancel();
  });
});

describe("per-account isolation", () => {
  it("gives each API key its own concurrency semaphore", () => {
    expect(falSlotsFor("key-a")).toBe(falSlotsFor("key-a"));
    expect(falSlotsFor("key-a")).not.toBe(falSlotsFor("key-b"));
  });
});

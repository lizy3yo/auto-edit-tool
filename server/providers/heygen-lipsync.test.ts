import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HeygenLipsyncAdapter,
  heygenSlotsFor,
  notifyHeygenVideo,
  waitForHeygenVideo,
} from "./heygen-lipsync";
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

type FetchCall = { url: string; method: string; body: any };

/**
 * Route fetches by URL. Records every call (url, method, parsed body) for assertions.
 * Registration flow: POST /avatars → group completed on first poll → POST /videos.
 */
function installFetchMock(routes: {
  video?: (call: FetchCall) => any;
  status?: (call: FetchCall) => any;
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
      if (url.endsWith("/avatars") && call.method === "POST") {
        return jsonRes(200, {
          data: {
            avatar_item: { id: "avatar-1" },
            avatar_group: { id: "group-1" },
          },
        });
      }
      if (url.includes("/avatars/") && call.method === "GET") {
        return jsonRes(200, { data: { status: "completed" } });
      }
      if (url.endsWith("/videos") && call.method === "POST") {
        return routes.video
          ? routes.video(call)
          : jsonRes(200, { data: { video_id: "vid-1" } });
      }
      if (url.includes("/videos/") && call.method === "GET") {
        return routes.status
          ? routes.status(call)
          : jsonRes(200, { data: { status: "processing" } });
      }
      // video_url download
      return jsonRes(200, {});
    })
  );
  return calls;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

// Each test uses a distinct imageUrl — the module-level avatar cache persists across tests.
let n = 0;
const freshImageUrl = () => `https://cdn.example.com/host-${++n}.png`;

describe("HeygenLipsyncAdapter.submitLipsync", () => {
  it("registers the photo avatar, waits for it, and submits with our audio_url", async () => {
    const calls = installFetchMock({});
    const adapter = new HeygenLipsyncAdapter("key");
    const res = await adapter.submitLipsync({
      imageUrl: freshImageUrl(),
      audioUrl: "https://cdn.example.com/a.mp3",
    });
    expect(res).toEqual({ taskId: "vid-1" });

    const videoCall = calls.find(
      c => c.url.endsWith("/videos") && c.method === "POST"
    )!;
    expect(videoCall.body).toMatchObject({
      type: "avatar",
      avatar_id: "avatar-1",
      audio_url: "https://cdn.example.com/a.mp3",
      // expressiveness pinned low (top-level — nesting it under engine is a 400)
      expressiveness: "low",
      engine: { type: "avatar_iv" },
      resolution: "1080p",
      aspect_ratio: "16:9",
    });
    // audio_url drives lip-sync — never a HeyGen voice or script
    expect("voice_id" in videoCall.body).toBe(false);
    expect("script" in videoCall.body).toBe(false);
  });

  it("dedupes concurrent submits for the same photo to one avatar registration", async () => {
    const calls = installFetchMock({});
    const adapter = new HeygenLipsyncAdapter("key");
    const imageUrl = freshImageUrl();
    const params = (i: number) => ({
      imageUrl,
      audioUrl: `https://cdn.example.com/${i}.mp3`,
    });
    const [a, b] = await Promise.all([
      adapter.submitLipsync(params(1)),
      adapter.submitLipsync(params(2)),
    ]);
    expect(a.taskId).toBe("vid-1");
    expect(b.taskId).toBe("vid-1");
    const registrations = calls.filter(
      c => c.url.endsWith("/avatars") && c.method === "POST"
    );
    expect(registrations).toHaveLength(1);
  });

  it("retries video creation while the fresh avatar reports missing image dimensions", async () => {
    let videoAttempts = 0;
    installFetchMock({
      video: () =>
        ++videoAttempts === 1
          ? jsonRes(400, {
              error: { message: "Talking photo has missing image dimensions" },
            })
          : jsonRes(200, { data: { video_id: "vid-2" } }),
    });
    const adapter = new HeygenLipsyncAdapter("key");
    const res = await adapter.submitLipsync({
      imageUrl: freshImageUrl(),
      audioUrl: "https://x/a.mp3",
    });
    expect(res).toEqual({ taskId: "vid-2" });
    expect(videoAttempts).toBe(2);
  });

  it("returns an error (not a throw) when video creation fails hard", async () => {
    installFetchMock({
      video: () => jsonRes(400, { error: "bad audio" }),
    });
    const adapter = new HeygenLipsyncAdapter("key");
    const res = await adapter.submitLipsync({
      imageUrl: freshImageUrl(),
      audioUrl: "https://x/a.mp3",
    });
    expect(res.taskId).toBeUndefined();
    expect(res.error).toMatch(/HeyGen API error \(400\)/);
  });
});

describe("HeygenLipsyncAdapter.pollVideo", () => {
  it("downloads the video on completed", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          data: { status: "completed", video_url: "https://files/x.mp4" },
        }),
    });
    const adapter = new HeygenLipsyncAdapter("key");
    const res = await adapter.pollVideo("vid-1", 60_000);
    expect(res.success).toBe(true);
    expect(res.mimeType).toBe("video/mp4");
    expect(Buffer.from(res.fileData as Buffer)).toEqual(
      Buffer.from([1, 2, 3, 4])
    );
  });

  it("marks a failed render as infraFailure so the orchestrator re-submits", async () => {
    installFetchMock({
      status: () =>
        jsonRes(200, {
          data: { status: "failed", failure_message: "render exploded" },
        }),
    });
    const adapter = new HeygenLipsyncAdapter("key");
    const res = await adapter.pollVideo("vid-1", 60_000);
    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
    expect(res.error).toBe("render exploded");
  });

  it("marks an unknown video id (e.g. a stale taskId) as infraFailure", async () => {
    installFetchMock({
      status: () => jsonRes(404, { error: "not found" }),
    });
    const adapter = new HeygenLipsyncAdapter("key");
    const res = await adapter.pollVideo("runpod-stale-id", 60_000);
    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
  });

  it("returns pending on client timeout so the job resumes instead of re-submitting", async () => {
    installFetchMock({});
    const adapter = new HeygenLipsyncAdapter("key");
    const res = await adapter.pollVideo("vid-1", 0);
    expect(res.success).toBe(false);
    expect(res.pending).toBe(true);
    expect(res.taskId).toBe("vid-1");
  });
});

describe("completion webhook", () => {
  const videoBody = async () => {
    const calls = installFetchMock({});
    await new HeygenLipsyncAdapter("key").submitLipsync({
      imageUrl: freshImageUrl(),
      audioUrl: "https://cdn.example.com/a.mp3",
    });
    return calls.find(c => c.url.endsWith("/videos") && c.method === "POST")!
      .body;
  };

  it("asks HeyGen to call back when a public base URL is configured", async () => {
    const prev = ENV.publicBaseUrl;
    ENV.publicBaseUrl = "https://app.example.com/";
    try {
      expect((await videoBody()).callback_url).toMatch(
        /^https:\/\/app\.example\.com\/api\/webhooks\/heygen\/[0-9a-f]{32}$/
      );
    } finally {
      ENV.publicBaseUrl = prev;
    }
  });

  it("omits the callback when unconfigured (poll-only, e.g. local dev)", async () => {
    const prev = ENV.publicBaseUrl;
    ENV.publicBaseUrl = "";
    try {
      expect("callback_url" in (await videoBody())).toBe(false);
    } finally {
      ENV.publicBaseUrl = prev;
    }
  });

  const settled = (p: Promise<void>) =>
    Promise.race([p.then(() => true), Promise.resolve().then(() => false)]);

  it("wakes a parked poll loop and unregisters it", async () => {
    const w = waitForHeygenVideo("vid-hook");
    expect(await settled(w.wait)).toBe(false);
    notifyHeygenVideo("vid-hook");
    expect(await settled(w.wait)).toBe(true);
    // Registry cleared: a fresh wait for the same id parks again instead of resolving.
    const again = waitForHeygenVideo("vid-hook");
    expect(await settled(again.wait)).toBe(false);
    again.cancel();
    w.cancel(); // idempotent after the wake
  });

  it("replays a callback that arrived before anyone was waiting", async () => {
    notifyHeygenVideo("vid-early");
    expect(await settled(waitForHeygenVideo("vid-early").wait)).toBe(true);
    // Consumed once only — the next wait parks.
    const next = waitForHeygenVideo("vid-early");
    expect(await settled(next.wait)).toBe(false);
    next.cancel();
  });
});

describe("per-account isolation", () => {
  it("gives each API key its own concurrency semaphore", () => {
    expect(heygenSlotsFor("key-a")).toBe(heygenSlotsFor("key-a"));
    expect(heygenSlotsFor("key-a")).not.toBe(heygenSlotsFor("key-b"));
  });

  // An avatar_id belongs to the account that registered it, so a photo-URL-keyed cache
  // would hand tab B tab A's foreign id and 400 every video create.
  it("registers the same photo once per account, not once per photo", async () => {
    const imageUrl = freshImageUrl();
    const audioUrl = "https://cdn.example.com/a.mp3";
    const registrations = (calls: FetchCall[]) =>
      calls.filter(c => c.url.endsWith("/avatars") && c.method === "POST")
        .length;

    let calls = installFetchMock({});
    await new HeygenLipsyncAdapter("key-a").submitLipsync({
      imageUrl,
      audioUrl,
    });
    await new HeygenLipsyncAdapter("key-b").submitLipsync({
      imageUrl,
      audioUrl,
    });
    expect(registrations(calls)).toBe(2);

    // Same key, same photo ⇒ still cached.
    calls = installFetchMock({});
    await new HeygenLipsyncAdapter("key-a").submitLipsync({
      imageUrl,
      audioUrl,
    });
    expect(registrations(calls)).toBe(0);
  });
});

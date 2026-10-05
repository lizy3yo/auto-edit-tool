import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HeygenLipsyncAdapter,
  heygenSlotsFor,
  notifyHeygenVideo,
  waitForHeygenVideo,
} from "./heygen-lipsync";
import { ENV } from "../_core/env";
import { HOST_PHOTO_PREP_FAILED } from "../../shared/hostRedo";

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

/** A real JPEG header, so the adapter uploads the photo instead of registering by URL. */
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0,
]);
const photoRes = () => ({ ...jsonRes(200, {}), arrayBuffer: async () => JPEG.buffer });

/**
 * Route fetches by URL. Records every call (url, method, parsed body) for assertions.
 * Registration flow: POST /avatars → group completed on first poll → POST /videos.
 */
function installFetchMock(routes: {
  video?: (call: FetchCall) => any;
  status?: (call: FetchCall) => any;
  /** POST /avatars — the photo registration. */
  avatars?: (call: FetchCall) => any;
  /** GET /avatars/{group} — is the avatar ready. */
  group?: (call: FetchCall) => any;
  /** POST /assets — the photo upload. Unset ⇒ `{}`, so the adapter registers by URL. */
  assets?: (call: FetchCall) => any;
  /** The host photo download (any URL on cdn.example.com ending .png). */
  photo?: (call: FetchCall) => any;
}) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: FetchCall = {
        url,
        method: init?.method ?? "GET",
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      if (url.endsWith("/assets") && call.method === "POST")
        return routes.assets ? routes.assets(call) : jsonRes(200, {});
      if (routes.photo && /host-\d+\.png$/.test(url)) return routes.photo(call);
      if (url.endsWith("/avatars") && call.method === "POST") {
        if (routes.avatars) return routes.avatars(call);
        return jsonRes(200, {
          data: {
            avatar_item: { id: "avatar-1" },
            avatar_group: { id: "group-1" },
          },
        });
      }
      if (url.includes("/avatars/") && call.method === "GET") {
        if (routes.group) return routes.group(call);
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

  it("retries video creation while HeyGen answers 409 resource_not_ready", async () => {
    let videoAttempts = 0;
    installFetchMock({
      video: () =>
        ++videoAttempts <= 2
          ? jsonRes(409, {
              error: {
                code: "resource_not_ready",
                message:
                  "This avatar is still processing. Wait for avatar creation to complete, then try again.",
              },
            })
          : jsonRes(200, { data: { video_id: "vid-3" } }),
    });
    const adapter = new HeygenLipsyncAdapter("key");
    const res = await adapter.submitLipsync({
      imageUrl: freshImageUrl(),
      audioUrl: "https://x/a.mp3",
    });
    expect(res).toEqual({ taskId: "vid-3" });
    expect(videoAttempts).toBe(3);
  });

  it("does not retry an unrelated 409", async () => {
    let videoAttempts = 0;
    installFetchMock({
      video: () => {
        videoAttempts++;
        return jsonRes(409, { error: { code: "conflict", message: "nope" } });
      },
    });
    const adapter = new HeygenLipsyncAdapter("key");
    const res = await adapter.submitLipsync({
      imageUrl: freshImageUrl(),
      audioUrl: "https://x/a.mp3",
    });
    expect(res.error).toMatch(/HeyGen API error \(409\)/);
    expect(videoAttempts).toBe(1);
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

// The film of 2026-10-05: HeyGen answered a photo registration with 404 `asset_not_found` for
// the copy of the photo it had just made. Nothing retried it, and one failed call failed every
// host beat sharing it.
describe("photo registration survives HeyGen's own hiccups", () => {
  const registered = () =>
    jsonRes(200, {
      data: { avatar_item: { id: "avatar-9" }, avatar_group: { id: "g" } },
    });
  const assetNotFound = () =>
    jsonRes(404, {
      error: {
        code: "asset_not_found",
        message: "Asset cf4766654b8e4e239753cb3ee97e29d1 not found",
      },
    });
  const submit = () =>
    new HeygenLipsyncAdapter("key").submitLipsync({
      imageUrl: freshImageUrl(),
      audioUrl: "https://x/a.mp3",
    });
  const registrations = (calls: FetchCall[]) =>
    calls.filter(c => c.url.endsWith("/avatars") && c.method === "POST");

  it("asks again when HeyGen says its copy of the photo is not found yet", async () => {
    let n = 0;
    const calls = installFetchMock({
      avatars: () => (++n <= 2 ? assetNotFound() : registered()),
    });
    expect(await submit()).toEqual({ taskId: "vid-1" });
    expect(registrations(calls)).toHaveLength(3);
  });

  it("asks again on a 409 while an earlier registration is still in flight", async () => {
    let n = 0;
    installFetchMock({
      avatars: () =>
        ++n === 1
          ? jsonRes(409, {
              error: {
                code: "conflict",
                message:
                  "Photo avatar creation conflicted with an existing operation.",
              },
            })
          : registered(),
    });
    expect(await submit()).toEqual({ taskId: "vid-1" });
    expect(n).toBe(2);
  });

  it("gives up after its waits, in words the render lane reads as 'not this beat'", async () => {
    const calls = installFetchMock({ avatars: assetNotFound });
    const res = await submit();
    expect(res.taskId).toBeUndefined();
    expect(res.error).toContain(HOST_PHOTO_PREP_FAILED);
    expect(res.error).toContain("(404)");
    expect(registrations(calls)).toHaveLength(9); // the first try + 8 waits
  });

  it("does not ask again when HeyGen turns the photo itself down", async () => {
    const calls = installFetchMock({
      avatars: () => jsonRes(400, { error: { message: "no face detected" } }),
    });
    const res = await submit();
    expect(res.error).toMatch(/HeyGen avatar registration failed \(400\)/);
    expect(res.error).not.toContain(HOST_PHOTO_PREP_FAILED);
    expect(registrations(calls)).toHaveLength(1);
  });

  it("stops waiting when HeyGen says the avatar failed", async () => {
    installFetchMock({
      group: () => jsonRes(200, { data: { status: "failed" } }),
    });
    const res = await submit();
    expect(res.error).toMatch(/avatar registration failed \(training\)/);
  });

  it("uploads the photo itself and registers from that asset, reused on a retry", async () => {
    let n = 0;
    const calls = installFetchMock({
      photo: photoRes,
      assets: () => jsonRes(200, { data: { asset_id: "asset-1" } }),
      avatars: () => (++n === 1 ? assetNotFound() : registered()),
    });
    expect(await submit()).toEqual({ taskId: "vid-1" });
    expect(calls.filter(c => c.url.endsWith("/assets"))).toHaveLength(1);
    const regs = registrations(calls);
    expect(regs).toHaveLength(2);
    for (const r of regs)
      expect(r.body.file).toEqual({ type: "asset_id", asset_id: "asset-1" });
    // A definite refusal is retried as a NEW request: a reused key would replay the refusal.
    expect(regs[0].headers["Idempotency-Key"]).toBeTruthy();
    expect(regs[1].headers["Idempotency-Key"]).not.toBe(
      regs[0].headers["Idempotency-Key"]
    );
  });

  it("keeps the idempotency key across a 5xx, which may have landed", async () => {
    let n = 0;
    const calls = installFetchMock({
      avatars: () => (++n === 1 ? jsonRes(503, {}) : registered()),
    });
    await submit();
    const [a, b] = registrations(calls);
    expect(b.headers["Idempotency-Key"]).toBe(a.headers["Idempotency-Key"]);
  });

  it("registers by URL when the upload is not accepted", async () => {
    const calls = installFetchMock({
      photo: photoRes,
      assets: () => jsonRes(400, { error: { message: "unsupported" } }),
    });
    expect(await submit()).toEqual({ taskId: "vid-1" });
    expect(registrations(calls)[0].body.file.type).toBe("url");
  });

  it("registers the photo again, once, when its avatar is gone on HeyGen", async () => {
    let videos = 0;
    const calls = installFetchMock({
      video: () =>
        ++videos === 1
          ? jsonRes(404, {
              error: {
                code: "avatar_not_found",
                message: "Avatar not found: 1cfea30d62c743468e0f4ca0b5e3236d",
              },
            })
          : jsonRes(200, { data: { video_id: "vid-7" } }),
    });
    expect(await submit()).toEqual({ taskId: "vid-7" });
    expect(registrations(calls)).toHaveLength(2);
  });

  it("does not loop when the avatar is gone a second time", async () => {
    const calls = installFetchMock({
      video: () =>
        jsonRes(404, {
          error: { code: "avatar_not_found", message: "Avatar not found: x" },
        }),
    });
    const res = await submit();
    expect(res.error).toContain(HOST_PHOTO_PREP_FAILED);
    expect(registrations(calls)).toHaveLength(2);
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

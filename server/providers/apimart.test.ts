import { describe, it, expect, vi, afterEach } from "vitest";
import { ApimartAdapter, extractVideoUrl } from "./apimart";
import type { VideoGenerationParams } from "./base";

const jsonResp = (body: any, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const bufResp = (buf: Buffer): Response =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => Uint8Array.from(buf).buffer,
  }) as unknown as Response;

const params = (
  over: Partial<VideoGenerationParams> = {}
): VideoGenerationParams => ({
  prompt: "a seed tray",
  model: "grok-imagine-video",
  aspectRatio: "16:9",
  resolution: "720p",
  duration: 6,
  count: 1,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("ApimartAdapter.submitVideo", () => {
  it("builds the grok body (model/size/duration/image_urls) and returns task_id", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResp({
        code: 200,
        data: [{ task_id: "task-1", status: "submitted" }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await new ApimartAdapter("k").submitVideo(
      params({ imageUrls: ["https://cdn/frame.png"] })
    );

    expect(r.taskId).toBe("task-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/videos/generations");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("grok-imagine-1.5-video-apimart");
    expect(body.size).toBe("16:9");
    expect(body.duration).toBe(6);
    expect(body.quality).toBe("720p");
    expect(body.image_urls).toEqual(["https://cdn/frame.png"]);
  });

  it("sends the grok body for every caller — one video model, no per-model branch", async () => {
    // The adapter used to branch to a seedance body for longform b-roll. Seedance is gone; b-roll
    // now rides the same grok request as host scenes and studio edit-video, so no request should
    // ever carry the old seedance-only fields.
    const fetchMock = vi.fn(async () => jsonResp({ data: [{ task_id: "t" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await new ApimartAdapter("k").submitVideo(
      params({ model: "grok-imagine-video", resolution: "4K" })
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.model).toBe("grok-imagine-1.5-video-apimart");
    expect(body.aspect_ratio).toBeUndefined();
    expect(body.resolution).toBeUndefined();
    expect(body.audio).toBeUndefined();
  });

  it("locks size to 16:9 regardless of the requested aspect ratio", async () => {
    const fetchMock = vi.fn(async () => jsonResp({ data: [{ task_id: "t" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await new ApimartAdapter("k").submitVideo(params({ aspectRatio: "9:16" }));
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.size).toBe("16:9");
    expect(body.quality).toBe("720p");
  });

  it("clamps duration below the API minimum (6)", async () => {
    const fetchMock = vi.fn(async () => jsonResp({ data: [{ task_id: "t" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await new ApimartAdapter("k").submitVideo(params({ duration: 4 }));
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.duration).toBe(6);
  });

  it("clamps duration above the API maximum (15)", async () => {
    // APIMART hard-400s Grok over 15s ("invalid_duration ... got: 18"), which failed a whole
    // longform assembly. An over-long scene must render a 15s clip, not blow up.
    const fetchMock = vi.fn(async () => jsonResp({ data: [{ task_id: "t" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await new ApimartAdapter("k").submitVideo(params({ duration: 18 }));
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.duration).toBe(15);
  });

  it("returns an error (not a taskId) on a non-ok submit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResp({ message: "bad request" }, false, 400))
    );
    const r = await new ApimartAdapter("k").submitVideo(params());
    expect(r.taskId).toBeUndefined();
    expect(r.error).toContain("APIMART");
  });
});

describe("ApimartAdapter.pollVideo", () => {
  it("downloads the video into a buffer on completed", async () => {
    const mp4 = Buffer.from("MP4-BYTES");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: any) => {
        if (String(u).includes("/v1/tasks/"))
          return jsonResp({
            data: {
              status: "completed",
              result: { videos: [{ url: "https://cdn/out.mp4" }] },
            },
          });
        return bufResp(mp4);
      })
    );
    const r = await new ApimartAdapter("k").pollVideo("task-1");
    expect(r.success).toBe(true);
    expect(r.mimeType).toBe("video/mp4");
    expect(Buffer.from(r.fileData as Buffer).toString()).toBe("MP4-BYTES");
  });

  it("returns pending (resume-safe) when the deadline is hit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResp({ data: { status: "processing" } }))
    );
    const r = await new ApimartAdapter("k").pollVideo("task-1", 0);
    expect(r.success).toBe(false);
    expect(r.pending).toBe(true);
    expect(r.taskId).toBe("task-1");
  });

  it("treats a cancelled task as a terminal failure, not a resumable pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResp({ data: { status: "cancelled" } }))
    );
    const r = await new ApimartAdapter("k").pollVideo("task-1");
    expect(r.success).toBe(false);
    expect(r.pending).toBeFalsy();
    expect(r.taskId).toBe("task-1");
  });

  it("maps a content-policy failure so the softer-prompt retry fires", async () => {
    const { isContentPolicyError } = await import("./sixtynine-labs");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResp({
          data: { status: "failed", error: "blocked prompt: content policy" },
        })
      )
    );
    const r = await new ApimartAdapter("k").pollVideo("task-1");
    expect(r.success).toBe(false);
    expect(isContentPolicyError(r.error)).toBe(true);
  });

  it("coerces a non-string failure payload (object/number) instead of throwing, keeping the inner text classifiable", async () => {
    const { isTransientVideoError } = await import("./sixtynine-labs");

    // Object error: must not throw "raw.substring is not a function", and the inner
    // message must survive so the transient classifier still fires (→ retry).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResp({
          data: {
            status: "failed",
            error: { code: 500, message: "provider timeout, try again" },
          },
        })
      )
    );
    let r = await new ApimartAdapter("k").pollVideo("task-1");
    expect(r.success).toBe(false);
    expect(typeof r.error).toBe("string");
    expect(isTransientVideoError(r.error)).toBe(true);

    // Numeric error code: coerced to a string, no throw.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResp({ data: { status: "error", error: 429 } }))
    );
    r = await new ApimartAdapter("k").pollVideo("task-1");
    expect(r.success).toBe(false);
    expect(typeof r.error).toBe("string");
  });

  it("treats grok's `missing post_id` round glitch as transient so the scene resubmits", async () => {
    const { isTransientVideoError } = await import("./sixtynine-labs");
    // Both underscore (code) and space (message) phrasings must classify as transient.
    expect(isTransientVideoError("missing_post_id")).toBe(true);
    expect(isTransientVideoError("Video round 2/2 missing post_id")).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResp({
          data: {
            status: "failed",
            error: {
              code: "task_failed",
              message: "[missing_post_id] Video round 2/2 missing post_id",
              type: "task_failed",
            },
          },
        })
      )
    );
    const r = await new ApimartAdapter("k").pollVideo("task-1");
    expect(r.success).toBe(false);
    expect(typeof r.error).toBe("string");
    // Survives mapError's coercion + truncation → runChunkTasks re-classifies it transient
    // → PendingRenderError → fresh resubmit on resume.
    expect(isTransientVideoError(r.error)).toBe(true);
  });
});

describe("ApimartAdapter.generateImage", () => {
  it("builds the gpt-image-2 body and downloads the image into a buffer", async () => {
    const png = Buffer.from("PNG-BYTES");
    const fetchMock = vi.fn(async (u: any) => {
      if (String(u).includes("/v1/images/generations"))
        return jsonResp({ data: [{ task_id: "img-1", status: "submitted" }] });
      if (String(u).includes("/v1/tasks/"))
        return jsonResp({
          data: {
            status: "completed",
            result: { images: [{ url: ["https://cdn/out.png"] }] },
          },
        });
      return bufResp(png);
    });
    vi.stubGlobal("fetch", fetchMock);

    const [r] = await new ApimartAdapter("k").generateImage({
      prompt: "a seed tray",
      model: "gpt-image-2",
      aspectRatio: "16:9",
      count: 1,
      imageSize: "1K",
    });

    expect(r.success).toBe(true);
    expect(r.mimeType).toBe("image/png");
    expect(Buffer.from(r.fileData as Buffer).toString()).toBe("PNG-BYTES");
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/v1/images/generations"
    );
    expect(body.model).toBe("gpt-image-2");
    expect(body.size).toBe("1280x720"); // 16:9 → explicit pixels (firm landscape lock)
    expect(body.resolution).toBe("1k");
    expect(body.quality).toBe("high");
  });

  it("maps 9:16 to explicit pixels and passes other ratios through", async () => {
    const fetchMock = vi.fn(async (u: any) => {
      if (String(u).includes("/v1/images/generations"))
        return jsonResp({ data: [{ task_id: "img-2", status: "submitted" }] });
      if (String(u).includes("/v1/tasks/"))
        return jsonResp({
          data: {
            status: "completed",
            result: { images: [{ url: "https://cdn/out.png" }] },
          },
        });
      return bufResp(Buffer.from("PNG"));
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ApimartAdapter("k");

    await adapter.generateImage({
      prompt: "p",
      model: "gpt-image-2",
      aspectRatio: "9:16",
      count: 1,
    });
    let body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.size).toBe("720x1280");

    fetchMock.mockClear();
    await adapter.generateImage({
      prompt: "p",
      model: "gpt-image-2",
      aspectRatio: "1:1",
      count: 1,
    });
    body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.size).toBe("1:1"); // unmapped ratio → aspect passthrough
  });
});

describe("extractVideoUrl", () => {
  it("reads a string url and a string[] url", () => {
    expect(extractVideoUrl({ result: { videos: [{ url: "a.mp4" }] } })).toBe(
      "a.mp4"
    );
    expect(extractVideoUrl({ result: { videos: [{ url: ["b.mp4"] }] } })).toBe(
      "b.mp4"
    );
    expect(extractVideoUrl({ result: { videos: [] } })).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AireiterAdapter, aireiterLaneEnabled } from "./aireiter";
import { generateStillWithFallback } from "./fallback";
import { ENV } from "../_core/env";

// Instant sleeps so retry/poll backoffs don't slow the suite.
vi.mock("./base", async importOriginal => {
  const mod = await importOriginal<typeof import("./base")>();
  return { ...mod, sleep: () => Promise.resolve() };
});

// No DB in unit tests: the Admin-entered key row is always absent, so the key in force is
// whatever `ENV.aireiterApiKey` is set to per-test.
vi.mock("../db", () => ({
  getAppSetting: async () => null,
  setAppSetting: async () => undefined,
}));

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
  };
}

type Call = { url: string; body: any };

/** Route by endpoint: /submit, /query, and the CDN download. */
function installFetchMock(routes: {
  submit?: (c: Call) => any;
  query?: (c: Call) => any;
}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      if (url.endsWith("/submit"))
        return routes.submit
          ? routes.submit(call)
          : jsonRes(200, {
              statusCode: 200,
              data: { out_task_id: call.body.out_task_id },
            });
      if (url.endsWith("/query"))
        return routes.query
          ? routes.query(call)
          : jsonRes(200, {
              data: {
                status: "completed",
                output: [{ url: "https://cdn.aireiter/x.mp4" }],
              },
            });
      return jsonRes(200, {});
    })
  );
  return calls;
}

const origEnv = {
  key: ENV.aireiterApiKey,
  lanes: ENV.aireiterLanes,
  res: ENV.aireiterVideoResolution,
};
beforeEach(() => {
  vi.restoreAllMocks();
  ENV.aireiterApiKey = "ae-key";
  ENV.aireiterLanes = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
  ENV.aireiterApiKey = origEnv.key;
  ENV.aireiterLanes = origEnv.lanes;
  ENV.aireiterVideoResolution = origEnv.res;
});

describe("aireiterLaneEnabled — the bolt-on stays off by default", () => {
  it("is off when no lanes are named", async () => {
    expect(await aireiterLaneEnabled("broll")).toBe(false);
    expect(await aireiterLaneEnabled("stills")).toBe(false);
  });

  it("enables only the named lane", async () => {
    ENV.aireiterLanes = "broll";
    expect(await aireiterLaneEnabled("broll")).toBe(true);
    expect(await aireiterLaneEnabled("stills")).toBe(false);
  });

  it("accepts a comma list and `all`, ignoring case and spaces", async () => {
    ENV.aireiterLanes = " Broll , stills ";
    expect(await aireiterLaneEnabled("broll")).toBe(true);
    expect(await aireiterLaneEnabled("stills")).toBe(true);
    ENV.aireiterLanes = "all";
    expect(await aireiterLaneEnabled("broll")).toBe(true);
    expect(await aireiterLaneEnabled("stills")).toBe(true);
  });

  // A named lane with no key (Admin row absent AND env blank) must stay OFF rather than
  // fail every render.
  it("stays off when the key is missing even if a lane is named", async () => {
    ENV.aireiterLanes = "all";
    ENV.aireiterApiKey = "";
    expect(await aireiterLaneEnabled("broll")).toBe(false);
  });
});

/**
 * The whole point of the bolt-on is to burn AIReiter credits INSTEAD of APIMART's, so
 * AIReiter must win whenever its lane is on — even on a tab that has a perfectly good
 * APIMART key. A reordering of that if/else chain would silently start billing APIMART
 * again, which is exactly the regression these guard against.
 */
describe("AIReiter takes precedence over APIMART", () => {
  it("uses AIReiter for stills even when an APIMART key is present", async () => {
    ENV.aireiterLanes = "stills";
    const calls = installFetchMock({
      query: () =>
        jsonRes(200, {
          data: {
            status: "completed",
            output: [{ url: "https://cdn.aireiter/x.png" }],
          },
        }),
    });

    const r = await generateStillWithFallback({
      prompt: "a copper pipe joint",
      apimartKey: "apimart-key-that-must-not-be-used",
    });

    expect(r.success).toBe(true);
    expect(calls.some(c => c.url.includes("aireiter.com"))).toBe(true);
    expect(calls.some(c => c.url.includes("api.apimart.ai"))).toBe(false);
  });

  it("leaves stills on APIMART when only the broll lane is enabled", async () => {
    ENV.aireiterLanes = "broll";
    const calls = installFetchMock({});

    await generateStillWithFallback({
      prompt: "a copper pipe joint",
      apimartKey: "apimart-key",
    }).catch(() => undefined); // APIMART is unmocked here; we only care who was called

    expect(calls.some(c => c.url.includes("aireiter.com"))).toBe(false);
    expect(calls.some(c => c.url.includes("api.apimart.ai"))).toBe(true);
  });
});

describe("AireiterAdapter.submitVideo", () => {
  it("submits grok with our own out_task_id as the resume handle", async () => {
    const calls = installFetchMock({});
    const res = await new AireiterAdapter("ae-key").submitVideo({
      prompt: "a quiet workshop",
      model: "grok-imagine-1.5-video" as any,
      aspectRatio: "16:9",
      resolution: "1080p" as any,
      duration: 8,
      count: 1,
      imageUrls: ["https://r2/keyframe.png"],
    });

    const submit = calls.find(c => c.url.endsWith("/submit"))!;
    expect(submit.body.model).toBe("grok_imagine_1_5");
    expect(submit.body.params).toMatchObject({
      image_url: "https://r2/keyframe.png",
      prompt: "a quiet workshop",
      video_length: 8,
      aspect_ratio: "16:9",
      resolution: "720p", // their ceiling — the requested 1080p can't be honoured
    });
    // The id we generated is the id we poll and persist — no translation on resume.
    expect(res.taskId).toBe(submit.body.out_task_id);
    expect(res.taskId).toMatch(/^ae_/);
  });

  // Their Grok is image-to-video only; a text-only submit is a paid 400.
  it("refuses a keyframe-less submit locally instead of paying for the error", async () => {
    const calls = installFetchMock({});
    const res = await new AireiterAdapter("ae-key").submitVideo({
      prompt: "x",
      model: "grok-imagine-1.5-video" as any,
      aspectRatio: "16:9",
      resolution: "1080p" as any,
      duration: 8,
      count: 1,
    });
    expect(res.taskId).toBeUndefined();
    expect(res.error).toMatch(/image-to-video only/);
    expect(calls).toHaveLength(0);
  });

  it("clamps duration to the 1–15s the model accepts", async () => {
    const calls = installFetchMock({});
    await new AireiterAdapter("ae-key").submitVideo({
      prompt: "x",
      model: "m" as any,
      aspectRatio: "16:9",
      resolution: "1080p" as any,
      duration: 40,
      count: 1,
      imageUrls: ["https://r2/k.png"],
    });
    expect(calls[0].body.params.video_length).toBe(15);
  });

  // Verified live: AIReiter answers an unknown route/method with 200 + its marketing HTML
  // instead of a 404/405. Swallowing that would hand back an id for a task that never
  // existed, then poll it to the timeout ceiling.
  it("hard-fails on a non-JSON body instead of inventing a task id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => "<!DOCTYPE html><html>marketing page</html>",
        json: async () => {
          throw new Error("not json");
        },
      }))
    );
    const res = await new AireiterAdapter("ae-key").submitVideo({
      prompt: "x",
      model: "m" as any,
      aspectRatio: "16:9",
      resolution: "1080p" as any,
      duration: 5,
      count: 1,
      imageUrls: ["https://r2/k.png"],
    });
    expect(res.taskId).toBeUndefined();
    expect(res.error).toMatch(/non-JSON body/);
  });

  // Verified live: errors arrive as HTTP 200 with `statusCode: 400` in the body — and `ok`
  // is `true` even then, so it cannot be trusted.
  it("treats a non-200 statusCode inside a 200 body as a failure", async () => {
    installFetchMock({
      submit: () =>
        jsonRes(200, { statusCode: 400, message: "no credits", ok: true }),
    });
    const res = await new AireiterAdapter("ae-key").submitVideo({
      prompt: "x",
      model: "m" as any,
      aspectRatio: "16:9",
      resolution: "1080p" as any,
      duration: 5,
      count: 1,
      imageUrls: ["https://r2/k.png"],
    });
    expect(res.taskId).toBeUndefined();
    expect(res.error).toMatch(/no credits/);
  });
});

describe("AireiterAdapter.pollVideo", () => {
  it("downloads the output once the task completes", async () => {
    installFetchMock({});
    const res = await new AireiterAdapter("ae-key").pollVideo("ae_1", 60_000);
    expect(res.success).toBe(true);
    expect(res.mimeType).toBe("video/mp4");
    expect(Buffer.from(res.fileData as Buffer)).toEqual(Buffer.from([9, 9, 9]));
  });

  it("keeps polling through pending/processing", async () => {
    let n = 0;
    installFetchMock({
      query: () =>
        jsonRes(200, {
          data:
            ++n < 3
              ? { status: n === 1 ? "pending" : "processing" }
              : {
                  status: "completed",
                  output: [{ url: "https://cdn.aireiter/x.mp4" }],
                },
        }),
    });
    const res = await new AireiterAdapter("ae-key").pollVideo("ae_1", 60_000);
    expect(res.success).toBe(true);
    expect(n).toBe(3);
  });

  it("marks a failed task as infraFailure so the orchestrator re-submits", async () => {
    installFetchMock({
      query: () => jsonRes(200, { data: { status: "failed" } }),
    });
    const res = await new AireiterAdapter("ae-key").pollVideo("ae_1", 60_000);
    expect(res.success).toBe(false);
    expect(res.infraFailure).toBe(true);
  });

  it("returns pending on client timeout so the job resumes instead of re-paying", async () => {
    installFetchMock({});
    const res = await new AireiterAdapter("ae-key").pollVideo("ae_1", 0);
    expect(res.pending).toBe(true);
    expect(res.taskId).toBe("ae_1");
  });

  // Verified live: an unknown id returns 200 + {"statusCode":400,"message":"api task not
  // found"}. Reading that as "no data yet" would poll for the full 10-minute ceiling.
  it("fails an unknown task id immediately rather than polling to the ceiling", async () => {
    installFetchMock({
      query: () =>
        jsonRes(200, {
          statusCode: 400,
          message: "api task not found",
          data: null,
          ok: true,
        }),
    });
    const res = await new AireiterAdapter("ae-key").pollVideo(
      "ae_gone",
      60_000
    );
    expect(res.success).toBe(false);
    expect(res.pending).toBeUndefined();
    expect(res.infraFailure).toBe(true);
    expect(res.error).toMatch(/api task not found/);
  });
});

describe("AireiterAdapter.generateImage", () => {
  it("submits gpt_image_2 and returns the downloaded bytes", async () => {
    const calls = installFetchMock({
      query: () =>
        jsonRes(200, {
          data: {
            status: "completed",
            output: [{ url: "https://cdn.aireiter/x.png" }],
          },
        }),
    });
    const [r] = await new AireiterAdapter("ae-key").generateImage({
      prompt: "a wrench on a bench",
      model: "gpt-image-2",
      aspectRatio: "16:9",
      count: 1,
      imageUrls: ["https://r2/ref.png"],
    });
    expect(r.success).toBe(true);
    expect(r.mimeType).toBe("image/png");
    const submit = calls.find(c => c.url.endsWith("/submit"))!;
    expect(submit.body.model).toBe("gpt_image_2");
    expect(submit.body.params).toMatchObject({
      prompt: "a wrench on a bench",
      aspect_ratio: "16:9",
      image_url: ["https://r2/ref.png"],
    });
  });

  it("fans `count` out to one task per image", async () => {
    const calls = installFetchMock({});
    const out = await new AireiterAdapter("ae-key").generateImage({
      prompt: "x",
      model: "gpt-image-2",
      aspectRatio: "1:1",
      count: 3,
    });
    expect(out).toHaveLength(3);
    expect(calls.filter(c => c.url.endsWith("/submit"))).toHaveLength(3);
  });
});

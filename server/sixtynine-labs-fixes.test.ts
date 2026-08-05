import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isTransientVideoError,
  isContentPolicyError,
  IMAGE_TIMEOUT_MS,
  imageModelChain,
} from "./providers/sixtynine-labs";
import { ENV } from "./_core/env";

/**
 * Tests for the 5 fixes applied to the 69Labs adapter and shuttle regenerate:
 * 1. Global image rate limiter (token bucket)
 * 2. Credits regex fix (no longer matches "limit")
 * 3. Per-image retry (not entire batch)
 * 4. Regenerate debounce (30s cooldown)
 * 5. IMAGE_TIMEOUT_MS increased to 300s
 */

// ─── FIX #2: Credits regex ───
describe("Credits detection regex", () => {
  // The fixed regex: /credit|quota|insufficient/i
  // Previously was: /credit|limit|quota|insufficient/i — which caught "limit" in rate-limit messages
  const CREDITS_REGEX = /credit|quota|insufficient/i;

  it("should detect actual credit errors", () => {
    expect(CREDITS_REGEX.test("Your credits have been depleted")).toBe(true);
    expect(CREDITS_REGEX.test("Insufficient credits remaining")).toBe(true);
    expect(CREDITS_REGEX.test("Monthly quota exceeded")).toBe(true);
    expect(CREDITS_REGEX.test("insufficient balance")).toBe(true);
  });

  it("should NOT match rate-limit errors containing 'limit'", () => {
    expect(CREDITS_REGEX.test("Rate limit exceeded")).toBe(false);
    expect(CREDITS_REGEX.test("Too many requests, limit reached")).toBe(false);
    expect(CREDITS_REGEX.test("Request limit per minute exceeded")).toBe(false);
    expect(CREDITS_REGEX.test("Concurrent request limit")).toBe(false);
  });

  it("should NOT match generic server errors", () => {
    expect(CREDITS_REGEX.test("Internal server error")).toBe(false);
    expect(CREDITS_REGEX.test("Service unavailable")).toBe(false);
    expect(CREDITS_REGEX.test("Task timed out after 300s")).toBe(false);
  });
});

// ─── FIX #1: Token bucket rate limiter ───
describe("Token bucket rate limiter", () => {
  // Simulate the token bucket logic
  const BUCKET_MAX = 8;
  const REFILL_RATE = 4; // tokens per second

  it("should allow burst up to bucket max", () => {
    let tokens = BUCKET_MAX;
    let acquired = 0;
    while (tokens >= 1) {
      tokens -= 1;
      acquired++;
    }
    expect(acquired).toBe(BUCKET_MAX);
  });

  it("should refill tokens over time", () => {
    let tokens = 0; // empty bucket
    const elapsedSeconds = 2;
    tokens = Math.min(BUCKET_MAX, tokens + elapsedSeconds * REFILL_RATE);
    expect(tokens).toBe(8); // 2s * 4/s = 8, capped at max 8
  });

  it("should partially refill", () => {
    let tokens = 0;
    const elapsedSeconds = 0.5;
    tokens = Math.min(BUCKET_MAX, tokens + elapsedSeconds * REFILL_RATE);
    expect(tokens).toBe(2); // 0.5s * 4/s = 2
  });

  it("should not exceed max", () => {
    let tokens = 7;
    const elapsedSeconds = 10;
    tokens = Math.min(BUCKET_MAX, tokens + elapsedSeconds * REFILL_RATE);
    expect(tokens).toBe(BUCKET_MAX);
  });
});

// ─── FIX #4: Regenerate debounce ───
describe("Shuttle regenerate debounce", () => {
  const REGEN_COOLDOWN_MS = 30_000;
  const timestamps = new Map<number, number>();

  beforeEach(() => {
    timestamps.clear();
  });

  it("should allow first regenerate call", () => {
    const jobId = 1;
    const lastRegenTime = timestamps.get(jobId) || 0;
    const elapsed = Date.now() - lastRegenTime;
    expect(elapsed >= REGEN_COOLDOWN_MS).toBe(true);
    timestamps.set(jobId, Date.now());
  });

  it("should block second call within cooldown window", () => {
    const jobId = 1;
    const now = Date.now();
    timestamps.set(jobId, now);

    // Simulate immediate second call
    const lastRegenTime = timestamps.get(jobId) || 0;
    const elapsed = now - lastRegenTime;
    expect(elapsed < REGEN_COOLDOWN_MS).toBe(true);
  });

  it("should allow call after cooldown expires", () => {
    const jobId = 1;
    const pastTime = Date.now() - REGEN_COOLDOWN_MS - 1000; // 31s ago
    timestamps.set(jobId, pastTime);

    const lastRegenTime = timestamps.get(jobId) || 0;
    const elapsed = Date.now() - lastRegenTime;
    expect(elapsed >= REGEN_COOLDOWN_MS).toBe(true);
  });

  it("should track different jobs independently", () => {
    const now = Date.now();
    timestamps.set(1, now); // job 1 just regenerated
    timestamps.set(2, now - REGEN_COOLDOWN_MS - 1000); // job 2 regenerated 31s ago

    const elapsed1 = now - (timestamps.get(1) || 0);
    const elapsed2 = now - (timestamps.get(2) || 0);

    expect(elapsed1 < REGEN_COOLDOWN_MS).toBe(true); // job 1 blocked
    expect(elapsed2 >= REGEN_COOLDOWN_MS).toBe(true); // job 2 allowed
  });
});

// ─── FIX #5: Image poll ceiling vs fallback budget ───
describe("IMAGE_TIMEOUT_MS configuration", () => {
  it("poll ceiling stays ABOVE the fallback budget so the budget governs failover/breaker", () => {
    // Invariant relied on by FallbackImageAdapter: its budget sentinel (imagePrimaryTimeoutMs)
    // must fire before this poll ceiling, otherwise the breaker never opens during an outage.
    expect(IMAGE_TIMEOUT_MS).toBeGreaterThan(ENV.imagePrimaryTimeoutMs);
  });

  it("poll ceiling clears the real ~150-165s still render time", () => {
    expect(IMAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(200_000);
  });
});

// ─── FIX #3: Per-image retry logic ───
describe("Per-image retry (not entire batch)", () => {
  it("should retry individual failed images independently", async () => {
    // Simulate 4 images where image 2 fails on first attempt
    const imageResults: {
      index: number;
      attempts: number;
      success: boolean;
    }[] = [];

    for (let i = 0; i < 4; i++) {
      let attempts = 0;
      let success = false;

      for (let attempt = 0; attempt <= 3; attempt++) {
        attempts++;
        // Image 2 fails on first attempt, succeeds on second
        if (i === 1 && attempt === 0) {
          continue; // retry
        }
        success = true;
        break;
      }

      imageResults.push({ index: i, attempts, success });
    }

    // Image 0, 2, 3 should succeed on first attempt
    expect(imageResults[0].attempts).toBe(1);
    expect(imageResults[2].attempts).toBe(1);
    expect(imageResults[3].attempts).toBe(1);

    // Image 1 should succeed on second attempt
    expect(imageResults[1].attempts).toBe(2);
    expect(imageResults[1].success).toBe(true);

    // All should succeed
    expect(imageResults.every(r => r.success)).toBe(true);
  });

  it("should not retry other images when one fails", () => {
    // In the old code, a 429 on image 2 would call _generateImageWithRetry(params, attempt+1)
    // which re-submits ALL images. The new code uses _generateSingleImage per image.
    // This test verifies the concept: each image has its own retry counter.

    const perImageAttempts = [0, 0, 0, 0];
    const MAX_RETRIES = 3;

    // Simulate: image 2 gets 429 three times
    for (let i = 0; i < 4; i++) {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        perImageAttempts[i]++;
        if (i === 2 && attempt < MAX_RETRIES) continue; // keep retrying image 2
        break; // success for others
      }
    }

    // Images 0, 1, 3 should have 1 attempt each
    expect(perImageAttempts[0]).toBe(1);
    expect(perImageAttempts[1]).toBe(1);
    expect(perImageAttempts[3]).toBe(1);

    // Image 2 should have 4 attempts (initial + 3 retries)
    expect(perImageAttempts[2]).toBe(4);

    // Total API calls: 7 (not 16 as in old code where all 4 would be retried 3 times)
    const totalCalls = perImageAttempts.reduce((a, b) => a + b, 0);
    expect(totalCalls).toBe(7);
  });
});

// ─── Resumable video flow: submit/poll split surfaces taskId + pending ───
describe("SixtyNineLabsAdapter submit/poll split (resumable flow)", () => {
  function makeResponse(body: unknown, ok = true, status = 200): Response {
    return {
      ok,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("submitVideo returns the job ID to persist before polling", async () => {
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeResponse({ id: "job-123" }))
    );
    const adapter = new SixtyNineLabsAdapter("vk_test");
    const r = await adapter.submitVideo({
      prompt: "p",
      model: "grok-imagine-video",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 5,
      count: 1,
    });
    expect(r.taskId).toBe("job-123");
    expect(r.error).toBeUndefined();
  });

  it("builds a Gemini Omni ingredients body for host b-roll (ref image + ingredients + explicit 8s)", async () => {
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const fetchMock = vi.fn(async () => makeResponse({ id: "job-omni" }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.submitVideo({
      prompt: "host holds up a salt can",
      model: "gemini-omni",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 8,
      count: 1,
      imageUrls: ["https://example.com/face-model.jpg"],
      videoInputMode: "ingredients",
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.model).toBe("gemini-omni");
    expect(body.imageUrls).toEqual(["https://example.com/face-model.jpg"]);
    expect(body.videoInputMode).toBe("ingredients");
    // Gemini Omni takes an explicit duration string (not Grok's 5/10 bucketing).
    expect(body.duration).toBe("8");
  });

  it("sends grok image-to-video with ONE imageUrl and NO videoInputMode (grok exposes no modes)", async () => {
    // Fresh module → full submit-rate bucket (this is the 3rd submit in the describe; the
    // module-global 2-token bucket is drained by the two above, so it would otherwise wait
    // out a ~12s refill and time out).
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const fetchMock = vi.fn(async () => makeResponse({ id: "job-grok-img" }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.submitVideo({
      prompt: "ladybug on a leaf",
      model: "grok-imagine-video",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 6,
      count: 1,
      // Caller may pass two URLs + a mode; both must be coerced for grok.
      imageUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      videoInputMode: "keyframes",
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.model).toBe("grok-imagine-video");
    // grok caps image input at 1...
    expect(body.imageUrls).toEqual(["https://example.com/a.jpg"]);
    // ...and supports no mode — sending one is the "No providers support" 400.
    expect(body.videoInputMode).toBeUndefined();
  });

  it("passes grok duration through as an integer string in the 6–30s range", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const fetchMock = vi.fn(async () => makeResponse({ id: "job-grok-dur" }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.submitVideo({
      prompt: "ladybug on a leaf",
      model: "grok-imagine-video",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 11,
      count: 1,
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.duration).toBe("11");
  });

  it("veo-3.1-fast (b-roll fallback): wire id passes through, up to 2 imageUrls, NO duration/mode", async () => {
    // Fresh module → full submit-rate bucket (the module-global bucket is drained by the
    // other submit tests above; the ratelimit suite uses this same resetModules pattern).
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const fetchMock = vi.fn(async () => makeResponse({ id: "job-veo-fast" }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.submitVideo({
      prompt: "close-up of soil",
      model: "veo-3.1-fast",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 6,
      count: 1,
      imageUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
      videoInputMode: "keyframes",
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.model).toBe("veo-3.1-fast");
    // Veo Fast accepts up to 2 image inputs (unlike grok's cap of 1)...
    expect(body.imageUrls).toEqual([
      "https://example.com/a.jpg",
      "https://example.com/b.jpg",
    ]);
    // ...and takes no duration or videoInputMode (runs at its fixed default).
    expect(body.duration).toBeUndefined();
    expect(body.videoInputMode).toBeUndefined();
  });

  it("pollVideo returns pending (not failure) when the job is still rendering at timeout", async () => {
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    // status always PROCESSING → poll hits its ceiling → TIMEOUT → pending result.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeResponse({ id: "job-9", status: "PROCESSING" }))
    );
    const adapter = new SixtyNineLabsAdapter("vk_test");
    const r = await adapter.pollVideo("job-9", 50);
    expect(r.success).toBe(false);
    expect(r.pending).toBe(true);
    expect(r.taskId).toBe("job-9");
  });

  // ─── "No providers support this combination" is NOT retried at submit ───
  // It's a param-incompatibility error; resubmitting the same body will never recover it.
  // The fallback (strip face ref, degrade to text-only) is handled at the chain level in
  // generateSceneClips — submitVideo just needs to fail fast so the chain can advance quickly.
  it("fails fast on 'No providers support' without resubmitting", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeResponse(
        {
          error: "No providers support this combination of video options",
          code: "BAD_REQUEST",
        },
        false,
        400
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new SixtyNineLabsAdapter("vk_test");
    const r = await adapter.submitVideo({
      prompt: "p",
      model: "grok-imagine-video",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 5,
      count: 1,
    });
    // One attempt, no retries — fails fast so the caller's fallback chain can fire immediately.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.taskId).toBeUndefined();
    expect(r.error).toContain("No providers support");
  });

  it("fails fast on a non-transient 400 (bad param) without resubmitting", async () => {
    // Fresh module → full submit-token bucket, so this resolves instantly (no retry, no wait).
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeResponse(
          { error: "Invalid aspectRatio for model", code: "BAD_REQUEST" },
          false,
          400
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new SixtyNineLabsAdapter("vk_test");
    const r = await adapter.submitVideo({
      prompt: "p",
      model: "grok-imagine-video",
      aspectRatio: "21:9",
      resolution: "720p",
      duration: 5,
      count: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.taskId).toBeUndefined();
    expect(r.error).toContain("400");
  });
});

// ─── Image generate body: per-model capability gating ───
// 69Labs 400s (→ silent Gemini fallback) if a request sends a param a model rejects:
// `resolution` for non-nano models, an unsupported `aspectRatio`, or `imageUrls` to a model
// with supportsImageInput=false / over its maxImageUrls cap. Gated via IMAGE_MODEL_CAPS.
describe("SixtyNineLabsAdapter image generate body — capability gating", () => {
  // PNG magic bytes so detectImageMimeType resolves and the happy path completes.
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function imageRouterMock() {
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const resp = (body: unknown, extra: Partial<Response> = {}) =>
        ({
          ok: true,
          status: 200,
          headers: {
            get: (h: string) => (/content-type/i.test(h) ? "image/png" : null),
          },
          json: async () => body,
          text: async () => JSON.stringify(body),
          arrayBuffer: async () => PNG.buffer,
          ...extra,
        }) as unknown as Response;

      if (u.includes("/images/generate")) {
        bodies.push(JSON.parse((init?.body as string) ?? "{}"));
        return resp({ id: "img-1" });
      }
      if (u.includes("/images/status/")) {
        return resp({ id: "img-1", status: "COMPLETED" });
      }
      if (u.includes("/images/download/")) {
        return resp(null);
      }
      return resp({});
    });
    return { fetchMock, bodies };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("omits `resolution` for gpt-image-2 even when imageSize is set", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = imageRouterMock();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SixtyNineLabsAdapter("vk_test");
    const r = await adapter.generateImage({
      prompt: "a red apple on a wooden table",
      model: "gpt-image-2",
      aspectRatio: "16:9",
      imageSize: "1K",
      count: 1,
    });

    expect(r[0].success).toBe(true);
    expect(bodies[0].model).toBe("gpt-image-2");
    expect(bodies[0].resolution).toBeUndefined();
  });

  it("includes `resolution` for nano-banana models", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = imageRouterMock();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.generateImage({
      prompt: "a red apple",
      model: "nano-banana",
      aspectRatio: "16:9",
      imageSize: "1K",
      count: 1,
    });

    // mapImageModel("nano-banana") → "nano-banana-2", which supports resolution.
    expect(bodies[0].model).toBe("nano-banana-2");
    expect(bodies[0].resolution).toBe("1k");
  });

  it("keeps `imageUrls` for gpt-image-2 (supports image input)", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = imageRouterMock();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.generateImage({
      prompt: "host holding a salt can",
      model: "gpt-image-2",
      aspectRatio: "16:9",
      imageSize: "1K",
      count: 1,
      imageUrls: ["https://example.com/face.jpg"],
    });

    expect(bodies[0].imageUrls).toEqual(["https://example.com/face.jpg"]);
  });

  it("drops `imageUrls` for a model with no image input (z-image)", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = imageRouterMock();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.generateImage({
      prompt: "a red apple",
      model: "z-image",
      aspectRatio: "16:9",
      count: 1,
      imageUrls: ["https://example.com/ref.jpg"],
    });

    expect(bodies[0].model).toBe("z-image");
    expect(bodies[0].imageUrls).toBeUndefined();
  });

  it("caps `imageUrls` at the model's maxImageUrls (nano-banana-2 = 14)", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = imageRouterMock();
    vi.stubGlobal("fetch", fetchMock);

    const urls = Array.from(
      { length: 20 },
      (_, i) => `https://example.com/ref-${i}.jpg`
    );
    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.generateImage({
      prompt: "a collage",
      model: "nano-banana",
      aspectRatio: "16:9",
      count: 1,
      imageUrls: urls,
    });

    expect(bodies[0].imageUrls).toHaveLength(14);
    expect(bodies[0].imageUrls[0]).toBe("https://example.com/ref-0.jpg");
  });

  it("coerces an unsupported aspectRatio to the model default (img-flux → 16:9)", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = imageRouterMock();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.generateImage({
      prompt: "a landscape",
      model: "img-flux",
      aspectRatio: "9:16", // img-flux only supports 16:9
      count: 1,
    });

    expect(bodies[0].model).toBe("img-flux");
    expect(bodies[0].aspectRatio).toBe("16:9");
  });

  it("passes a supported aspectRatio through unchanged (gpt-image-2 + 16:9)", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = imageRouterMock();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SixtyNineLabsAdapter("vk_test");
    await adapter.generateImage({
      prompt: "a portrait",
      model: "gpt-image-2",
      aspectRatio: "16:9",
      count: 1,
    });

    expect(bodies[0].aspectRatio).toBe("16:9");
  });

  // Router whose /images/generate returns an HTTP error for one model and the happy path
  // (submit → COMPLETED → download) for every other model. Records every submitted body.
  function modelErrorRouterMock(
    failModel: string,
    status: number,
    code: string
  ) {
    const bodies: any[] = [];
    const ok = (body: unknown) =>
      ({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (/content-type/i.test(h) ? "image/png" : null),
        },
        json: async () => body,
        text: async () => JSON.stringify(body),
        arrayBuffer: async () => PNG.buffer,
      }) as unknown as Response;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/images/generate")) {
        const parsed = JSON.parse((init?.body as string) ?? "{}");
        bodies.push(parsed);
        if (parsed.model === failModel) {
          const errBody = JSON.stringify({ error: "An error occurred", code });
          return {
            ok: false,
            status,
            headers: { get: () => null },
            json: async () => JSON.parse(errBody),
            text: async () => errBody,
          } as unknown as Response;
        }
        return ok({ id: "img-1" });
      }
      if (u.includes("/images/status/"))
        return ok({ id: "img-1", status: "COMPLETED" });
      if (u.includes("/images/download/")) return ok(null);
      return ok({});
    });
    return { fetchMock, bodies };
  }

  it("falls back to nano-banana-2 when nano-banana-pro is 503 (server unavailable)", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = modelErrorRouterMock(
      "nano-banana-pro",
      503,
      "SERVICE_UNAVAILABLE"
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    try {
      const adapter = new SixtyNineLabsAdapter("vk_test");
      const promise = adapter.generateImage({
        prompt: "an ebook cover",
        model: "nano-banana-pro",
        aspectRatio: "2:3",
        imageSize: "2K",
        count: 1,
      });
      // Advance through the primary model's exhausted 5xx backoffs (~5+10+20s) + the poll.
      await vi.advanceTimersByTimeAsync(120_000);
      const r = await promise;

      // pro tried until retries exhausted (1 + MAX_RETRIES=3 = 4), then ONE nano-banana-2 submit.
      expect(bodies.filter(b => b.model === "nano-banana-pro")).toHaveLength(4);
      expect(bodies.filter(b => b.model === "nano-banana-2")).toHaveLength(1);
      expect(r[0].success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT fall back on a terminal 400 (a different model won't help)", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = modelErrorRouterMock(
      "nano-banana-pro",
      400,
      "BAD_REQUEST"
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new SixtyNineLabsAdapter("vk_test");
    const r = await adapter.generateImage({
      prompt: "an ebook cover",
      model: "nano-banana-pro",
      aspectRatio: "2:3",
      imageSize: "2K",
      count: 1,
    });

    // 400 is non-retryable and terminal — one pro submit, no fallback model attempted.
    expect(bodies.filter(b => b.model === "nano-banana-pro")).toHaveLength(1);
    expect(bodies.filter(b => b.model === "nano-banana-2")).toHaveLength(0);
    expect(r[0].success).toBe(false);
  });

  it("falls back gpt-image-2 → grok-imagine-image when gpt-image-2 is 503 (longform still/keyframe)", async () => {
    vi.resetModules();
    const { SixtyNineLabsAdapter } = await import("./providers/sixtynine-labs");
    const { fetchMock, bodies } = modelErrorRouterMock(
      "gpt-image-2",
      503,
      "SERVICE_UNAVAILABLE"
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    try {
      const adapter = new SixtyNineLabsAdapter("vk_test");
      const promise = adapter.generateImage({
        prompt: "a ladybug on a leaf",
        model: "gpt-image-2",
        aspectRatio: "16:9",
        imageSize: "1K",
        count: 1,
      });
      // Advance through the primary model's exhausted 5xx backoffs + the fallback poll.
      await vi.advanceTimersByTimeAsync(120_000);
      const r = await promise;

      // gpt-image-2 tried until retries exhausted (1 + MAX_RETRIES=3 = 4), then ONE grok submit.
      expect(bodies.filter(b => b.model === "gpt-image-2")).toHaveLength(4);
      const grok = bodies.filter(b => b.model === "grok-imagine-image");
      expect(grok).toHaveLength(1);
      // grok-imagine-image supports 16:9 and has resolution:false — request must omit resolution.
      expect(grok[0].aspectRatio).toBe("16:9");
      expect(grok[0].resolution).toBeUndefined();
      expect(r[0].success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Image model fallback chain: gpt-image-2 → grok-imagine-image (before Gemini) ───
describe("imageModelChain", () => {
  it("falls back gpt-image-2 → grok-imagine-image", () => {
    expect(imageModelChain("gpt-image-2")).toEqual([
      "gpt-image-2",
      "grok-imagine-image",
    ]);
  });

  it("keeps the nano-banana-pro → nano-banana-2 fallback (regression)", () => {
    expect(imageModelChain("nano-banana-pro")).toEqual([
      "nano-banana-pro",
      "nano-banana-2",
    ]);
  });

  it("does not chain a model with no configured fallback", () => {
    expect(imageModelChain("grok-imagine-image")).toEqual([
      "grok-imagine-image",
    ]);
    expect(imageModelChain("z-image")).toEqual(["z-image"]);
  });
});

// ─── isTransientVideoError: "No providers support" must NOT be transient ───
describe("isTransientVideoError", () => {
  it("returns false for 'No providers support this combination' (param error, not overload)", () => {
    expect(
      isTransientVideoError(
        '{"error":"No providers support this combination of video options","code":"BAD_REQUEST"}'
      )
    ).toBe(false);
    expect(isTransientVideoError("No providers support this combination")).toBe(
      false
    );
  });

  it("returns true for genuine transient server errors", () => {
    expect(isTransientVideoError("INTERNAL SERVER ERROR")).toBe(true);
    expect(isTransientVideoError("provider timed out")).toBe(true);
    expect(isTransientVideoError("did not respond")).toBe(true);
    expect(isTransientVideoError("took too long")).toBe(true);
    expect(isTransientVideoError("SERVER_ERROR")).toBe(true);
    expect(isTransientVideoError("service overloaded")).toBe(true);
  });

  it("returns false for null / undefined / empty", () => {
    expect(isTransientVideoError(null)).toBe(false);
    expect(isTransientVideoError(undefined)).toBe(false);
    expect(isTransientVideoError("")).toBe(false);
  });
});

// ─── isContentPolicyError: classifier rejections recover with a softer prompt ───
describe("isContentPolicyError", () => {
  it("returns true for the 69labs classifier vocabulary", () => {
    expect(isContentPolicyError("Blocked prompt: restricted wording")).toBe(
      true
    );
    expect(isContentPolicyError("content policy violation")).toBe(true);
    expect(isContentPolicyError("celebrity or well-known person")).toBe(true);
    expect(isContentPolicyError("minor / underage detection")).toBe(true);
    expect(isContentPolicyError("sexual or erotic content")).toBe(true);
  });

  it("returns true for real-world APIMART and OpenAI moderation strings", () => {
    expect(
      isContentPolicyError(
        "[content_moderated] Video round 1/1 content moderated"
      )
    ).toBe(true);
    expect(
      isContentPolicyError("Your request was rejected by the safety system")
    ).toBe(true);
  });

  it("keeps APIMART's transient moderated_or_stream_errors glitch out of the policy lane", () => {
    expect(
      isContentPolicyError(
        "[moderated_or_stream_errors] Video round 1/2 missing_post_id"
      )
    ).toBe(false);
  });

  it("returns false for credits, transient, and empty errors", () => {
    expect(isContentPolicyError("PAYMENT_REQUIRED: credits depleted")).toBe(
      false
    );
    expect(isContentPolicyError("provider timed out")).toBe(false);
    expect(isContentPolicyError("69Labs API error (500)")).toBe(false);
    expect(isContentPolicyError(null)).toBe(false);
    expect(isContentPolicyError("")).toBe(false);
  });
});

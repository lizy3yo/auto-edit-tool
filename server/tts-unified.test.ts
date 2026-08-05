import { describe, it, expect, vi } from "vitest";

// ─── 69Labs TTS Module Tests ───

describe("69Labs TTS module", () => {
  it("createTTSTask69Labs sends correct request body", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");

    // Mock fetch to capture the request
    const originalFetch = globalThis.fetch;
    let capturedBody: any = null;
    let capturedUrl: string = "";
    let capturedHeaders: any = null;

    globalThis.fetch = vi.fn(async (url: any, opts: any) => {
      capturedUrl = url.toString();
      capturedHeaders = opts?.headers;
      capturedBody = JSON.parse(opts?.body || "{}");
      return new Response(JSON.stringify({ id: "test-job-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      const taskId = await createTTSTask69Labs("vk_test_key", {
        text: "Hello world",
        voiceId: "21m00Tcm4TlvDq8ikWAM",
        modelId: "eleven_multilingual_v2",
        speed: 1.0,
        stability: 0.5,
      });

      expect(taskId).toBe("test-job-123");
      expect(capturedUrl).toBe("https://69labs.vip/api/v1/tts/generate");
      expect(capturedHeaders?.Authorization).toBe("Bearer vk_test_key");
      expect(capturedBody.text).toBe("Hello world");
      expect(capturedBody.voiceId).toBe("21m00Tcm4TlvDq8ikWAM");
      expect(capturedBody.modelId).toBe("eleven_multilingual_v2");
      expect(capturedBody.splitType).toBe("smart");
      expect(capturedBody.voiceSettings?.speed).toBe(1.0);
      expect(capturedBody.voiceSettings?.stability).toBe(0.5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("createTTSTask69Labs sends minimaxSettings.speed for minimax voices", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");

    const originalFetch = globalThis.fetch;
    let capturedBody: any = null;

    globalThis.fetch = vi.fn(async (_url: any, opts: any) => {
      capturedBody = JSON.parse(opts?.body || "{}");
      return new Response(JSON.stringify({ id: "mm-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      await createTTSTask69Labs("vk_test_key", {
        text: "Hello",
        voiceId: "catalog_voice_1",
        voiceProvider: "minimax",
        speed: 1.3,
      });

      expect(capturedBody.voiceProvider).toBe("minimax");
      expect(capturedBody.modelId).toBe("speech-02-hd");
      expect(capturedBody.minimaxSettings?.speed).toBe(1.3);
      expect(capturedBody.voiceSettings).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("pollTTSTask69Labs handles COMPLETED status", async () => {
    const { pollTTSTask69Labs } = await import("./tts69labs");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "job-456",
          status: "COMPLETED",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as any;

    try {
      const result = await pollTTSTask69Labs("vk_test_key", "job-456");
      expect(result.status).toBe("completed");
      expect(result.audioUrl).toContain("tts/download/job-456");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("pollTTSTask69Labs handles CENSORED status", async () => {
    const { pollTTSTask69Labs } = await import("./tts69labs");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "job-789",
          status: "CENSORED",
          blockedChunks: [{ index: 2, text: "blocked text" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as any;

    try {
      const result = await pollTTSTask69Labs("vk_test_key", "job-789");
      expect(result.status).toBe("censored");
      expect(result.blockedChunks).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("pollTTSTask69Labs handles PROCESSING status", async () => {
    const { pollTTSTask69Labs } = await import("./tts69labs");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: "job-abc",
          status: "PROCESSING",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as any;

    try {
      const result = await pollTTSTask69Labs("vk_test_key", "job-abc");
      expect(result.status).toBe("processing");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Unified TTS Routing Tests ───

describe("Unified TTS routing", () => {
  it("routes to 69Labs when providerType is sixtynine_labs", async () => {
    const ttsUnified = await import("./ttsUnified");

    const originalFetch = globalThis.fetch;
    let capturedUrl: string = "";

    globalThis.fetch = vi.fn(async (url: any, opts: any) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ id: "69labs-job-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      const taskId = await ttsUnified.createUnifiedTTSTask(
        "sixtynine_labs",
        "vk_test",
        {
          text: "Test",
          voiceId: "voice123",
        }
      );
      expect(taskId).toBe("69labs-job-1");
      expect(capturedUrl).toContain("69labs.vip");
      expect(capturedUrl).toContain("/tts/generate");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // longform-studio: GenAIPro was dropped in the extraction — anything but
  // 69Labs must throw loudly instead of silently mis-routing.
  it("throws for non-69Labs provider types", async () => {
    const ttsUnified = await import("./ttsUnified");
    await expect(
      ttsUnified.createUnifiedTTSTask("genaipro", "jwt_test", {
        text: "Test",
        voiceId: "voice123",
      })
    ).rejects.toThrow("Unsupported TTS provider");
  });
});

// ─── Video Duration Fix Tests ───

describe("69Labs video duration handling", () => {
  it(
    "does NOT send duration for veo-video model",
    { timeout: 30000 },
    async () => {
      const { SixtyNineLabsAdapter } =
        await import("./providers/sixtynine-labs");

      const originalFetch = globalThis.fetch;
      let capturedBody: any = null;

      globalThis.fetch = vi.fn(async (url: any, opts: any) => {
        if (opts?.method === "POST") {
          capturedBody = JSON.parse(opts.body || "{}");
          return new Response(
            JSON.stringify({ id: "vid-1", queuePosition: 1 }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        // Poll returns FAILED to exit quickly
        return new Response(
          JSON.stringify({ id: "vid-1", status: "FAILED", error: "test" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as any;

      try {
        const adapter = new SixtyNineLabsAdapter("vk_test");
        await adapter.generateVideo({
          prompt: "test",
          model: "veo-3.1-generate" as any, // maps to veo-video
          aspectRatio: "16:9" as any,
          count: 1,
          duration: 6 as any, // should NOT be sent for veo-video
        });

        expect(capturedBody).toBeDefined();
        expect(capturedBody.model).toBe("veo-video");
        expect(capturedBody.duration).toBeUndefined(); // KEY: no duration for veo-video
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );

  it(
    "DOES send duration for luma-flash model",
    { timeout: 30000 },
    async () => {
      const { SixtyNineLabsAdapter } =
        await import("./providers/sixtynine-labs");

      const originalFetch = globalThis.fetch;
      let capturedBody: any = null;

      globalThis.fetch = vi.fn(async (url: any, opts: any) => {
        if (opts?.method === "POST") {
          capturedBody = JSON.parse(opts.body || "{}");
          return new Response(
            JSON.stringify({ id: "vid-2", queuePosition: 1 }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response(
          JSON.stringify({ id: "vid-2", status: "FAILED", error: "test" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }) as any;

      try {
        const adapter = new SixtyNineLabsAdapter("vk_test");
        await adapter.generateVideo({
          prompt: "test",
          model: "luma-flash" as any,
          aspectRatio: "16:9" as any,
          count: 1,
          duration: 8 as any, // should be sent as "10" for luma-flash
        });

        expect(capturedBody).toBeDefined();
        expect(capturedBody.model).toBe("luma-flash");
        expect(capturedBody.duration).toBe("10"); // 8 > 5 → "10"
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

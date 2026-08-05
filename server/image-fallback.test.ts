import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Gemini adapter so the fallback path is exercised without real API calls.
const { geminiGenerateImage } = vi.hoisted(() => ({
  geminiGenerateImage: vi.fn(),
}));

vi.mock("./providers/gemini-image", () => ({
  GeminiImageAdapter: class {
    generateImage = (...args: any[]) => geminiGenerateImage(...args);
  },
}));

// Mutable ENV so we can toggle the Gemini key + primary budget per test.
// Retries default to 0 here so the existing budget/breaker tests behave as a single
// attempt; the retry suite sets imagePrimaryRetries explicitly.
vi.mock("./_core/env", () => ({
  ENV: {
    geminiApiKey: "test-key",
    imagePrimaryTimeoutMs: 120_000,
    imagePrimaryRetries: 0,
    imageRetryTimeoutMs: 60_000,
    imageRetryTotalBudgetMs: 250_000,
  },
}));

import { FallbackImageAdapter, __resetBreaker } from "./providers/fallback";
import { ENV } from "./_core/env";

const imgParams = {
  prompt: "x",
  model: "nano-banana-pro",
  aspectRatio: "2:3",
  count: 2,
} as any;

function fakePrimary(imageResults: any) {
  return {
    generateImage: vi.fn().mockResolvedValue(imageResults),
    generateVideo: vi.fn().mockResolvedValue([{ success: true }]),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
  };
}

beforeEach(() => {
  geminiGenerateImage.mockReset();
  ENV.geminiApiKey = "test-key";
  ENV.imagePrimaryTimeoutMs = 120_000;
  ENV.imagePrimaryRetries = 0;
  ENV.imageRetryTimeoutMs = 60_000;
  ENV.imageRetryTotalBudgetMs = 250_000;
  __resetBreaker();
});

describe("FallbackImageAdapter", () => {
  it("returns primary results unchanged when all succeed (Gemini not called)", async () => {
    const primary = fakePrimary([
      { success: true, fileData: Buffer.from("a") },
      { success: true, fileData: Buffer.from("b") },
    ]);
    const fb = new FallbackImageAdapter(primary as any);
    const res = await fb.generateImage(imgParams);
    expect(res).toHaveLength(2);
    expect(res.every(r => r.success)).toBe(true);
    expect(geminiGenerateImage).not.toHaveBeenCalled();
  });

  it("falls back to Gemini for failed slots, preserving order and length", async () => {
    const primary = fakePrimary([
      { success: false, error: "credits depleted" },
      { success: true, fileData: Buffer.from("b") },
    ]);
    geminiGenerateImage.mockResolvedValue([
      { success: true, fileData: Buffer.from("g"), taskId: "gemini-fallback" },
    ]);
    const fb = new FallbackImageAdapter(primary as any);
    const res = await fb.generateImage(imgParams);
    expect(res).toHaveLength(2);
    expect(res[0].taskId).toBe("gemini-fallback");
    expect(res[1].success).toBe(true);
    // Only the single failed slot is regenerated.
    expect(geminiGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 })
    );
  });

  it("skips Gemini for failed slots when noGeminiFallback is set", async () => {
    const primary = fakePrimary([
      { success: false, error: "credits depleted" },
      { success: true, fileData: Buffer.from("b") },
    ]);
    const fb = new FallbackImageAdapter(primary as any);
    const res = await fb.generateImage({
      ...imgParams,
      noGeminiFallback: true,
    });
    expect(res).toHaveLength(2);
    expect(res[0].success).toBe(false);
    expect(res[1].success).toBe(true);
    expect(geminiGenerateImage).not.toHaveBeenCalled();
  });

  it("falls back for all slots when the primary throws", async () => {
    const primary = {
      generateImage: vi.fn().mockRejectedValue(new Error("boom")),
      generateVideo: vi.fn(),
      testConnection: vi.fn(),
    };
    geminiGenerateImage.mockResolvedValue([
      { success: true, fileData: Buffer.from("g1") },
      { success: true, fileData: Buffer.from("g2") },
    ]);
    const fb = new FallbackImageAdapter(primary as any);
    const res = await fb.generateImage(imgParams);
    expect(res).toHaveLength(2);
    expect(res.every(r => r.success)).toBe(true);
    expect(geminiGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 })
    );
  });

  it("routes straight to Gemini for an image-incapable primary, never calling it", async () => {
    const primary = fakePrimary([]);
    (primary as any).supportsImageGeneration = false;
    geminiGenerateImage.mockResolvedValue([
      { success: true, fileData: Buffer.from("g1") },
      { success: true, fileData: Buffer.from("g2") },
    ]);
    const fb = new FallbackImageAdapter(primary as any);
    const res = await fb.generateImage(imgParams);
    expect(res).toHaveLength(2);
    expect(res.every(r => r.success)).toBe(true);
    expect(primary.generateImage).not.toHaveBeenCalled();
    expect(geminiGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 })
    );
  });

  it("throws for an image-incapable primary when GEMINI_API_KEY is absent", async () => {
    ENV.geminiApiKey = "";
    const primary = fakePrimary([]);
    (primary as any).supportsImageGeneration = false;
    const fb = new FallbackImageAdapter(primary as any);
    await expect(fb.generateImage(imgParams)).rejects.toThrow(
      /does not support image generation and GEMINI_API_KEY is not set/
    );
    expect(primary.generateImage).not.toHaveBeenCalled();
    expect(geminiGenerateImage).not.toHaveBeenCalled();
  });

  it("passes primary failures through when GEMINI_API_KEY is absent", async () => {
    ENV.geminiApiKey = "";
    const primary = fakePrimary([
      { success: false, error: "credits depleted" },
      { success: true, fileData: Buffer.from("b") },
    ]);
    const fb = new FallbackImageAdapter(primary as any);
    const res = await fb.generateImage(imgParams);
    expect(res[0].success).toBe(false);
    expect(geminiGenerateImage).not.toHaveBeenCalled();
  });

  it("delegates video and testConnection to the primary", async () => {
    const primary = fakePrimary([]);
    const fb = new FallbackImageAdapter(primary as any);
    await fb.generateVideo({} as any);
    await fb.testConnection();
    expect(primary.generateVideo).toHaveBeenCalled();
    expect(primary.testConnection).toHaveBeenCalled();
  });

  it("forwards submitVideo/pollVideo when the primary implements them (resume seam)", async () => {
    const primary = {
      ...fakePrimary([]),
      submitVideo: vi.fn().mockResolvedValue({ taskId: "job-1" }),
      pollVideo: vi.fn().mockResolvedValue({ success: true }),
    };
    const fb = new FallbackImageAdapter(primary as any);
    expect(typeof fb.submitVideo).toBe("function");
    expect(typeof fb.pollVideo).toBe("function");
    const sub = await fb.submitVideo!({} as any);
    await fb.pollVideo!("job-1", 123);
    expect(sub.taskId).toBe("job-1");
    expect(primary.submitVideo).toHaveBeenCalled();
    expect(primary.pollVideo).toHaveBeenCalledWith("job-1", 123);
  });

  it("omits submitVideo/pollVideo when the primary lacks them (legacy adapters)", () => {
    const fb = new FallbackImageAdapter(fakePrimary([]) as any);
    expect(fb.submitVideo).toBeUndefined();
    expect(fb.pollVideo).toBeUndefined();
  });

  describe("primary time budget", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("fails over to Gemini when the primary exceeds the budget", async () => {
      // Primary never resolves (simulates 69Labs hanging on PENDING jobs).
      const primary = {
        generateImage: vi.fn().mockReturnValue(new Promise(() => {})),
        generateVideo: vi.fn(),
        testConnection: vi.fn(),
      };
      geminiGenerateImage.mockResolvedValue([
        {
          success: true,
          fileData: Buffer.from("g1"),
          taskId: "gemini-fallback",
        },
        {
          success: true,
          fileData: Buffer.from("g2"),
          taskId: "gemini-fallback",
        },
      ]);
      const fb = new FallbackImageAdapter(primary as any);
      const p = fb.generateImage(imgParams);
      // Advance past the budget so the timeout sentinel wins the race.
      await vi.advanceTimersByTimeAsync(ENV.imagePrimaryTimeoutMs + 1);
      const res = await p;
      expect(res).toHaveLength(2);
      expect(res.every(r => r.success)).toBe(true);
      expect(geminiGenerateImage).toHaveBeenCalledWith(
        expect.objectContaining({ count: 2 })
      );
    });

    it("returns failures (no Gemini) when budget exceeded and no key", async () => {
      ENV.geminiApiKey = "";
      const primary = {
        generateImage: vi.fn().mockReturnValue(new Promise(() => {})),
        generateVideo: vi.fn(),
        testConnection: vi.fn(),
      };
      const fb = new FallbackImageAdapter(primary as any);
      const p = fb.generateImage(imgParams);
      await vi.advanceTimersByTimeAsync(ENV.imagePrimaryTimeoutMs + 1);
      const res = await p;
      expect(res).toHaveLength(2);
      expect(res.every(r => !r.success)).toBe(true);
      expect(geminiGenerateImage).not.toHaveBeenCalled();
    });

    it("surfaces a timeout reason on the failed slots (not the 'not attempted' placeholder)", async () => {
      // No key so the primary failure is returned verbatim — lets us assert the recorded
      // reason. A budget timeout must read "timed out", not the initial placeholder.
      ENV.geminiApiKey = "";
      const primary = {
        generateImage: vi.fn().mockReturnValue(new Promise(() => {})),
        generateVideo: vi.fn(),
        testConnection: vi.fn(),
      };
      const fb = new FallbackImageAdapter(primary as any);
      const p = fb.generateImage(imgParams);
      await vi.advanceTimersByTimeAsync(ENV.imagePrimaryTimeoutMs + 1);
      const res = await p;
      expect(res.every(r => !r.success)).toBe(true);
      expect(res[0].error).toContain("timed out");
      expect(res[0].error).not.toContain("not attempted");
    });
  });

  describe("circuit breaker", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    async function timeOutOnce() {
      const primary = {
        generateImage: vi.fn().mockReturnValue(new Promise(() => {})),
        generateVideo: vi.fn(),
        testConnection: vi.fn(),
      };
      geminiGenerateImage.mockResolvedValue([
        {
          success: true,
          fileData: Buffer.from("g"),
          taskId: "gemini-fallback",
        },
        {
          success: true,
          fileData: Buffer.from("g"),
          taskId: "gemini-fallback",
        },
      ]);
      const fb = new FallbackImageAdapter(primary as any);
      const p = fb.generateImage(imgParams);
      await vi.advanceTimersByTimeAsync(ENV.imagePrimaryTimeoutMs + 1);
      await p;
      return primary;
    }

    it("opens after the threshold and routes straight to Gemini", async () => {
      await timeOutOnce(); // consecutiveTimeouts = 1
      await timeOutOnce(); // consecutiveTimeouts = 2 → breaker opens

      // Next call must skip the primary entirely.
      const primary = {
        generateImage: vi.fn().mockReturnValue(new Promise(() => {})),
        generateVideo: vi.fn(),
        testConnection: vi.fn(),
      };
      geminiGenerateImage.mockResolvedValue([
        { success: true, fileData: Buffer.from("g") },
        { success: true, fileData: Buffer.from("g") },
      ]);
      const fb = new FallbackImageAdapter(primary as any);
      const res = await fb.generateImage(imgParams);
      expect(primary.generateImage).not.toHaveBeenCalled();
      expect(res.every(r => r.success)).toBe(true);
      expect(geminiGenerateImage).toHaveBeenCalledWith(
        expect.objectContaining({ count: 2 })
      );
    });

    it("re-engages the primary after the cooldown elapses", async () => {
      await timeOutOnce(); // consecutiveTimeouts = 1
      await timeOutOnce(); // consecutiveTimeouts = 2 → breaker opens for COOLDOWN

      // Advance past the cooldown window so the breaker is considered closed.
      await vi.advanceTimersByTimeAsync(120_000 + 1);

      // A healthy primary (resolves within budget) is tried again and succeeds.
      const healthy = {
        generateImage: vi.fn().mockResolvedValue([
          { success: true, fileData: Buffer.from("a") },
          { success: true, fileData: Buffer.from("b") },
        ]),
        generateVideo: vi.fn(),
        testConnection: vi.fn(),
      };
      const fb = new FallbackImageAdapter(healthy as any);
      const res = await fb.generateImage(imgParams);
      expect(healthy.generateImage).toHaveBeenCalled();
      expect(res.every(r => r.success)).toBe(true);
    });
  });

  describe("primary retries", () => {
    it("retries the primary on an in-budget failure and skips Gemini when it recovers", async () => {
      ENV.imagePrimaryRetries = 3;
      const primary = {
        generateImage: vi
          .fn()
          .mockResolvedValueOnce([
            { success: false, error: "transient" },
            { success: false, error: "transient" },
          ])
          .mockResolvedValueOnce([
            { success: true, fileData: Buffer.from("a") },
            { success: true, fileData: Buffer.from("b") },
          ]),
        generateVideo: vi.fn(),
        testConnection: vi.fn(),
      };
      const fb = new FallbackImageAdapter(primary as any);
      const res = await fb.generateImage(imgParams);
      expect(res).toHaveLength(2);
      expect(res.every(r => r.success)).toBe(true);
      // Attempt 1 (failed) + 1 retry (recovered).
      expect(primary.generateImage).toHaveBeenCalledTimes(2);
      expect(geminiGenerateImage).not.toHaveBeenCalled();
    });

    it("retries only the still-failing slot, then falls back to Gemini once exhausted", async () => {
      ENV.imagePrimaryRetries = 2;
      const primary = {
        generateImage: vi
          .fn()
          .mockResolvedValue([{ success: false, error: "hard fail" }]),
        generateVideo: vi.fn(),
        testConnection: vi.fn(),
      };
      geminiGenerateImage.mockResolvedValue([
        {
          success: true,
          fileData: Buffer.from("g"),
          taskId: "gemini-fallback",
        },
      ]);
      const fb = new FallbackImageAdapter(primary as any);
      const res = await fb.generateImage({ ...imgParams, count: 1 });
      // 1 attempt + 2 retries on the primary before Gemini.
      expect(primary.generateImage).toHaveBeenCalledTimes(3);
      expect(res[0].taskId).toBe("gemini-fallback");
      expect(geminiGenerateImage).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1 })
      );
    });

    describe("with fake timers", () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      it("retries the primary on a budget timeout before reaching Gemini", async () => {
        ENV.imagePrimaryRetries = 1;
        const primary = {
          generateImage: vi.fn().mockReturnValue(new Promise(() => {})),
          generateVideo: vi.fn(),
          testConnection: vi.fn(),
        };
        geminiGenerateImage.mockResolvedValue([
          { success: true, fileData: Buffer.from("g1") },
          { success: true, fileData: Buffer.from("g2") },
        ]);
        const fb = new FallbackImageAdapter(primary as any);
        // heartbeated → no total-time deadline; both attempts time out, then Gemini.
        const p = fb.generateImage({ ...imgParams, heartbeated: true });
        await vi.advanceTimersByTimeAsync(ENV.imagePrimaryTimeoutMs + 1);
        await vi.advanceTimersByTimeAsync(ENV.imageRetryTimeoutMs + 1);
        const res = await p;
        expect(primary.generateImage).toHaveBeenCalledTimes(2);
        expect(res.every(r => r.success)).toBe(true);
        expect(geminiGenerateImage).toHaveBeenCalledWith(
          expect.objectContaining({ count: 2 })
        );
      });

      it("bounds no-heartbeat timeout retries by imageRetryTotalBudgetMs", async () => {
        ENV.imagePrimaryRetries = 5;
        // 120s first attempt, then 60s retries; 250s ceiling → only attempts whose
        // start + 60s ≤ 250s run: attempt0 (~120s), retry1 (~180s), retry2 (~240s).
        const primary = {
          generateImage: vi.fn().mockReturnValue(new Promise(() => {})),
          generateVideo: vi.fn(),
          testConnection: vi.fn(),
        };
        geminiGenerateImage.mockResolvedValue([
          { success: true, fileData: Buffer.from("g1") },
          { success: true, fileData: Buffer.from("g2") },
        ]);
        const fb = new FallbackImageAdapter(primary as any);
        const p = fb.generateImage(imgParams); // no heartbeated
        await vi.advanceTimersByTimeAsync(ENV.imagePrimaryTimeoutMs + 1);
        await vi.advanceTimersByTimeAsync(ENV.imageRetryTimeoutMs + 1);
        await vi.advanceTimersByTimeAsync(ENV.imageRetryTimeoutMs + 1);
        const res = await p;
        // Bounded to 3 attempts despite imagePrimaryRetries=5, then Gemini.
        expect(primary.generateImage).toHaveBeenCalledTimes(3);
        expect(res.every(r => r.success)).toBe(true);
        expect(geminiGenerateImage).toHaveBeenCalledWith(
          expect.objectContaining({ count: 2 })
        );
      });
    });
  });
});

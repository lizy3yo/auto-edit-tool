import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// invokeGemini builds its client lazily from ENV, so stub the SDK before importing.
const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));
vi.mock("./_core/env", () => ({ ENV: { geminiApiKey: "test-key" } }));

const { invokeGemini } = await import("./gemini");

/** The shape the SDK surfaces for a 429: status plus the violation JSON in the message. */
function quotaError(quotaId: string) {
  const err: any = new Error(
    JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
        ],
      },
    })
  );
  err.status = 429;
  return err;
}

describe("invokeGemini retry policy", () => {
  beforeEach(() => {
    generateContent.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("does NOT retry a per-day quota exhaustion — it cannot clear inside the job", async () => {
    generateContent.mockRejectedValue(
      quotaError("GenerateRequestsPerDayPerProjectPerModel-FreeTier")
    );
    await expect(
      invokeGemini({ systemPrompt: "s", userMessage: "u" })
    ).rejects.toThrow();
    // One attempt only: no backoff burned on a quota that resets tomorrow.
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("still retries a burst (per-minute) 429, which does clear", async () => {
    generateContent.mockRejectedValue(
      quotaError("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")
    );
    const p = invokeGemini({ systemPrompt: "s", userMessage: "u" });
    const assertion = expect(p).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
    // Initial attempt + MAX_RETRIES.
    expect(generateContent).toHaveBeenCalledTimes(4);
  });

  it("returns normally when the call succeeds", async () => {
    generateContent.mockResolvedValue({
      text: "hello",
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
      candidates: [{ finishReason: "STOP" }],
    });
    const r = await invokeGemini({ systemPrompt: "s", userMessage: "u" });
    expect(r.text).toBe("hello");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

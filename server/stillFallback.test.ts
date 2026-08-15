import { describe, it, expect, vi, beforeEach } from "vitest";

const generateOpenAIStill = vi.fn();
const geminiGenerateImage = vi.fn();

vi.mock("./providers/openai-image", () => ({
  generateOpenAIStill: (...a: any[]) => generateOpenAIStill(...a),
}));
vi.mock("./providers/gemini-image", () => ({
  GeminiImageAdapter: class {
    generateImage = (...a: any[]) => geminiGenerateImage(...a);
  },
}));
vi.mock("./_core/env", () => ({
  ENV: { geminiApiKey: "test-key", imagePrimaryTimeoutMs: 1000 },
}));

const { generateStillWithFallback } = await import("./providers/fallback");

const OK = {
  success: true,
  fileData: Buffer.from("img"),
  mimeType: "image/png",
};

describe("generateStillWithFallback", () => {
  beforeEach(() => {
    generateOpenAIStill.mockReset();
    geminiGenerateImage.mockReset();
  });

  it("uses OpenAI when it succeeds, and never calls Gemini", async () => {
    generateOpenAIStill.mockResolvedValue(OK);
    const r = await generateStillWithFallback({ prompt: "a worn P-trap" });
    expect(r.success).toBe(true);
    expect(geminiGenerateImage).not.toHaveBeenCalled();
  });

  it("falls back to Gemini when OpenAI has no credits — the job-3 failure", async () => {
    generateOpenAIStill.mockResolvedValue({
      success: false,
      error: "OpenAI image 429: You have no credits remaining.",
    });
    geminiGenerateImage.mockResolvedValue([OK]);
    const r = await generateStillWithFallback({ prompt: "a worn P-trap" });
    expect(r.success).toBe(true);
    expect(geminiGenerateImage).toHaveBeenCalledTimes(1);
  });

  it("falls back when OpenAI throws, not just when it returns failure", async () => {
    generateOpenAIStill.mockRejectedValue(new Error("socket hang up"));
    geminiGenerateImage.mockResolvedValue([OK]);
    expect((await generateStillWithFallback({ prompt: "x" })).success).toBe(
      true
    );
  });

  it("passes the reference image and 1:1 through to Gemini", async () => {
    generateOpenAIStill.mockResolvedValue({ success: false, error: "nope" });
    geminiGenerateImage.mockResolvedValue([OK]);
    await generateStillWithFallback({
      prompt: "book cover",
      referenceImageUrl: "https://cdn/cover.png",
      square: true,
    });
    expect(geminiGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        aspectRatio: "1:1",
        imageUrls: ["https://cdn/cover.png"],
      })
    );
  });

  it("defaults to 16:9 and omits imageUrls when there is no reference", async () => {
    generateOpenAIStill.mockResolvedValue({ success: false, error: "nope" });
    geminiGenerateImage.mockResolvedValue([OK]);
    await generateStillWithFallback({ prompt: "a drain" });
    const arg = geminiGenerateImage.mock.calls[0][0];
    expect(arg.aspectRatio).toBe("16:9");
    expect(arg).not.toHaveProperty("imageUrls");
  });

  it("reports BOTH errors when the fallback also fails — a one-sided message is undebuggable", async () => {
    generateOpenAIStill.mockResolvedValue({
      success: false,
      error: "no credits",
    });
    geminiGenerateImage.mockResolvedValue([{ success: false, error: "quota" }]);
    const r = await generateStillWithFallback({ prompt: "x" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("no credits");
    expect(r.error).toContain("quota");
  });
});

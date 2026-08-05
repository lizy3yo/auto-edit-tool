import { describe, it, expect } from "vitest";
import { GeminiImageAdapter } from "./providers/gemini-image";

describe("GeminiImageAdapter", () => {
  it("exposes the ProviderAdapter interface", () => {
    const a = new GeminiImageAdapter("test-key");
    expect(typeof a.generateImage).toBe("function");
    expect(typeof a.generateVideo).toBe("function");
    expect(typeof a.testConnection).toBe("function");
  });

  it("returns `count` failures when no API key is configured", async () => {
    const a = new GeminiImageAdapter("");
    const res = await a.generateImage({
      prompt: "x",
      model: "nano-banana-pro",
      aspectRatio: "2:3",
      count: 3,
    });
    expect(res).toHaveLength(3);
    expect(res.every(r => !r.success)).toBe(true);
    expect(res[0].error).toContain("GEMINI_API_KEY");
  });

  it("does not support video", async () => {
    const a = new GeminiImageAdapter("test-key");
    const res = await a.generateVideo({
      prompt: "x",
      model: "veo-3.1-generate",
      aspectRatio: "16:9",
      resolution: "1080p",
      duration: 8,
      count: 1,
    });
    expect(res[0].success).toBe(false);
    expect(res[0].error).toContain("video");
  });

  it("testConnection reflects key presence", async () => {
    expect((await new GeminiImageAdapter("").testConnection()).success).toBe(
      false
    );
    expect((await new GeminiImageAdapter("k").testConnection()).success).toBe(
      true
    );
  });

  // Live test — only runs when a real GEMINI_API_KEY is configured.
  it("generates a real image when GEMINI_API_KEY is set", async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return; // skip when no key
    const a = new GeminiImageAdapter(key);
    const res = await a.generateImage({
      prompt: "A simple solid red square on a white background, minimal",
      model: "nano-banana-pro",
      aspectRatio: "1:1",
      count: 1,
    });
    expect(res).toHaveLength(1);
    expect(res[0].success).toBe(true);
    expect(res[0].fileData).toBeTruthy();
    expect(res[0].mimeType).toMatch(/^image\//);
  }, 60_000);
});

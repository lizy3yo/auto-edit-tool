import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateOpenAIStill, OPENAI_IMAGE_SIZE } from "./openai-image";
import { ENV } from "../_core/env";

// A 1×1 PNG, base64 — what OpenAI returns in `data[0].b64_json`.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

const jsonResp = (body: any, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const imgResp = (): Response =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => Uint8Array.from(Buffer.from("cover-bytes")).buffer,
  }) as unknown as Response;

let savedKey: string;
beforeEach(() => {
  savedKey = ENV.openaiApiKey;
  ENV.openaiApiKey = "test-key";
});
afterEach(() => {
  ENV.openaiApiKey = savedKey;
  vi.unstubAllGlobals();
});

describe("generateOpenAIStill", () => {
  it("text-to-image → generations endpoint with size/quality and decoded buffer", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResp({ data: [{ b64_json: PNG_B64 }] })
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await generateOpenAIStill({ prompt: "a raised garden bed" });

    expect(out.success).toBe(true);
    expect(Buffer.isBuffer(out.fileData)).toBe(true);
    expect(out.mimeType).toBe("image/png");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    const body = JSON.parse((init as any).body);
    expect(body).toMatchObject({
      model: "gpt-image-2",
      size: OPENAI_IMAGE_SIZE,
      quality: "low",
      n: 1,
    });
  });

  it("with a reference → fetches the cover then POSTs the edits endpoint as multipart", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/images/edits")
        ? jsonResp({ data: [{ b64_json: PNG_B64 }] })
        : imgResp()
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await generateOpenAIStill({
      prompt: "show the book",
      referenceImageUrl: "https://cdn.example.com/cover.png",
    });

    expect(out.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://cdn.example.com/cover.png"
    );
    const [editUrl, init] = fetchMock.mock.calls[1];
    expect(editUrl).toBe("https://api.openai.com/v1/images/edits");
    expect((init as any).body).toBeInstanceOf(FormData);
  });

  it("surfaces a moderation block so isContentPolicyError can catch it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResp(
          { error: { message: "rejected by our safety system" } },
          false,
          400
        )
      )
    );
    const out = await generateOpenAIStill({ prompt: "nope" });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/safety/i);
  });

  it("fails cleanly when the key is missing", async () => {
    ENV.openaiApiKey = "";
    const out = await generateOpenAIStill({ prompt: "x" });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/OPENAI_API_KEY/);
  });
});

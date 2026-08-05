import { describe, it, expect, vi, afterEach } from "vitest";
import type { VideoGenerationParams } from "./base";

/**
 * No-cost characterization of the 69Labs video-submit rate limiting.
 *
 * 69Labs documents `POST /api/v1/videos/generate` at **5 req/min** (returns 429 +
 * Retry-After above that). Our adapter front-runs that cap with a dedicated token
 * bucket: VIDEO_SUBMIT_BUCKET_MAX = 2 (burst), refill 4/60 tokens/sec (~4/min).
 *
 * These tests exercise the REAL bucket + REAL 429 path through `submitVideo`, with
 * `fetch` stubbed so no billed video is ever generated. Each test re-imports the
 * module (vi.resetModules) so the module-global bucket starts full.
 */

/** Minimal Response stub for the global fetch mock. */
function res(
  body: unknown,
  ok = true,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return {
    ok,
    status,
    headers: {
      get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Response;
}

const params: VideoGenerationParams = {
  prompt: "rate-limit probe",
  model: "grok-imagine-video",
  aspectRatio: "16:9",
  resolution: "720p",
  duration: 8,
  count: 1,
};

async function freshAdapter() {
  vi.resetModules();
  const mod = await import("./sixtynine-labs");
  return new mod.SixtyNineLabsAdapter("test-key");
}

afterEach(() => vi.unstubAllGlobals());

describe("69Labs 429 handling (provider rate limit reached)", () => {
  it("honors Retry-After on a 429 and resubmits to success", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        // Simulate the provider's documented 429 + Retry-After: 1.
        return res("Rate limit exceeded", false, 429, { "Retry-After": "1" });
      }
      return res({ id: "job-after-429" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = await freshAdapter();

    const t0 = Date.now();
    const r = await adapter.submitVideo(params);
    const elapsed = Date.now() - t0;

    expect(fetchMock).toHaveBeenCalledTimes(2); // retried after the 429
    expect(r.taskId).toBe("job-after-429");
    expect(r.error).toBeUndefined();
    expect(elapsed).toBeGreaterThanOrEqual(950); // waited ~the 1s Retry-After
  }, 10_000);
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 5xx backoff shrinks to 1 ms so the retry path runs in real time under test, and the per-key
// submit bucket is widened so five attempts on one key are not paced by the token refill.
process.env.SIXTYNINE_TTS_5XX_BASE_DELAY_MS = "1";
process.env.SIXTYNINE_TTS_SUBMIT_BURST = "8";

const CF_521 =
  "<!DOCTYPE html><html><head><title>69labs.vip | 521: Web server is down</title></head>" +
  "<body><h1>Web server is down</h1><span>Cloudflare Ray ID: <strong>a347f31acb97798d</strong></span></body></html>";

const html521 = () =>
  new Response(CF_521, {
    status: 521,
    headers: { "Content-Type": "text/html" },
  });
const okTask = (id: string) =>
  new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("69Labs TTS behind a Cloudflare origin outage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("retries task creation through a 521 and succeeds when the origin returns", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");
    const responses = [html521(), html521(), okTask("job-after-outage")];
    const fetchMock = vi.fn(async () => responses.shift()!);
    globalThis.fetch = fetchMock as any;

    const taskId = await createTTSTask69Labs("vk_outage_key_1", {
      text: "Hello",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      modelId: "eleven_multilingual_v2",
    });
    expect(taskId).toBe("job-after-outage");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up with a one-line message, never the HTML page", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");
    globalThis.fetch = vi.fn(async () => html521()) as any;

    const err = await createTTSTask69Labs("vk_outage_key_2", {
      text: "Hello",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      modelId: "eleven_multilingual_v2",
    }).catch(e => e as Error);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("69Labs TTS is unavailable (521)");
    expect(msg).toContain("Web server is down");
    expect(msg).toContain("Ray a347f31acb97798d");
    expect(msg).not.toContain("<");
    expect(msg.length).toBeLessThan(260);
  });

  it("treats a 5xx on a status poll as still-processing, not a failure", async () => {
    const { pollTTSTask69Labs } = await import("./tts69labs");
    globalThis.fetch = vi.fn(async () => html521()) as any;
    const r = await pollTTSTask69Labs("vk_outage_key_3", "job-1");
    expect(r).toEqual({ taskId: "job-1", status: "processing" });
  });

  it("still fails a poll fast on a 4xx", async () => {
    const { pollTTSTask69Labs } = await import("./tts69labs");
    globalThis.fetch = vi.fn(
      async () => new Response('{"message":"Task not found"}', { status: 404 })
    ) as any;
    await expect(
      pollTTSTask69Labs("vk_outage_key_4", "job-gone")
    ).rejects.toThrow("69Labs TTS poll failed (404): Task not found");
  });
});

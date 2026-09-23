import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isTrustedUrl, sanitizeFilename } from "./download";

// This route is mounted unauthenticated, so the allowlist is the only thing between a
// caller and "fetch whatever the server can reach". These are the bypasses that the old
// `startsWith` check waved through.
describe("isTrustedUrl", () => {
  const prev = process.env.R2_PUBLIC_URL;
  beforeAll(() => {
    process.env.R2_PUBLIC_URL = "https://pub-abc123.r2.dev";
  });
  afterAll(() => {
    process.env.R2_PUBLIC_URL = prev;
  });

  it("allows the allowlisted host", () => {
    expect(isTrustedUrl("https://pub-abc123.r2.dev/videos/a.mp4")).toBe(true);
  });

  it("rejects an attacker subdomain that merely starts with it", () => {
    expect(isTrustedUrl("https://pub-abc123.r2.dev.attacker.com/x")).toBe(
      false
    );
  });

  it("rejects the userinfo trick", () => {
    expect(isTrustedUrl("https://pub-abc123.r2.dev@attacker.com/x")).toBe(
      false
    );
  });

  it("rejects non-https, including link-local metadata", () => {
    expect(isTrustedUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isTrustedUrl("file:///etc/passwd")).toBe(false);
    expect(isTrustedUrl("not a url")).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("strips non-ASCII chars so Content-Disposition stays Latin-1 safe", () => {
    const name = sanitizeFilename(
      "From Worst Lawn on the Block to Greenest — The Beginner Plan Anyone Can Follow This Weekend"
    );
    expect(name.length).toBeGreaterThan(0);
    expect(name).toMatch(/^[\x20-\x7E]+$/);
    expect(() =>
      new Headers().set(
        "Content-Disposition",
        `attachment; filename="${name}.mp3"`
      )
    ).not.toThrow();
  });

  it("returns empty string when nothing usable remains", () => {
    expect(sanitizeFilename("🌱🌿—“”")).toBe("");
  });
});

// The route itself, over a real socket. Storage is faked; the browser is a real HTTP client.
describe("download transfer", () => {
  const R2 = "https://pub-test.r2.dev";
  const realFetch = globalThis.fetch;
  let base = "";
  let server: import("http").Server;
  let upstream: (signal: AbortSignal) => Promise<Response>;
  const saved = {
    pub: process.env.R2_PUBLIC_URL,
    connect: process.env.DOWNLOAD_CONNECT_TIMEOUT_MS,
    idle: process.env.DOWNLOAD_IDLE_TIMEOUT_MS,
  };

  beforeAll(async () => {
    process.env.R2_PUBLIC_URL = R2;
    process.env.DOWNLOAD_CONNECT_TIMEOUT_MS = "200";
    process.env.DOWNLOAD_IDLE_TIMEOUT_MS = "400";
    globalThis.fetch = (async (input: any, init?: any) =>
      String(input).startsWith(R2)
        ? upstream(init?.signal)
        : realFetch(input, init)) as typeof fetch;
    const express = (await import("express")).default;
    const { downloadRouter } = await import("./download");
    const app = express();
    app.use("/api/download", downloadRouter);
    await new Promise<void>(r => {
      server = app.listen(0, () => r());
    });
    base = `http://127.0.0.1:${(server.address() as any).port}/api/download`;
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    process.env.R2_PUBLIC_URL = saved.pub;
    process.env.DOWNLOAD_CONNECT_TIMEOUT_MS = saved.connect;
    process.env.DOWNLOAD_IDLE_TIMEOUT_MS = saved.idle;
    await new Promise(r => server.close(r));
  });

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  /** A storage response that sends `chunks` pieces of `size` bytes, `gapMs` apart. */
  const trickle = (
    chunks: number,
    size: number,
    gapMs: number,
    stopAfter = chunks
  ) =>
    new Response(
      new ReadableStream({
        async start(ctrl) {
          for (let i = 0; i < chunks; i++) {
            if (i === stopAfter) return; // stalls forever: never closes
            await sleep(gapMs);
            ctrl.enqueue(new Uint8Array(size).fill(i % 256));
          }
          ctrl.close();
        },
      }),
      {
        headers: {
          "content-type": "video/mp4",
          "content-length": String(chunks * size),
        },
      }
    );
  const get = () =>
    realFetch(
      `${base}?url=${encodeURIComponent(`${R2}/longform/1/final-x.mp4`)}&type=video&name=film`
    );

  it("delivers a slow file in full, long past the connect limit — the old 30 s cut-off", async () => {
    upstream = async () => trickle(15, 64 * 1024, 60); // ~900 ms total, connect limit 200 ms
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(15 * 64 * 1024));
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(15 * 64 * 1024);
    expect(body[body.length - 1]).toBe(14);
  });

  it("fails a stalled transfer visibly instead of handing over a short file", async () => {
    upstream = async () => trickle(10, 64 * 1024, 20, 3); // 3 chunks, then nothing
    const res = await get();
    expect(res.status).toBe(200);
    // The size promised in the header is never reached, so the client sees a broken transfer.
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it("answers 500 when storage never responds", async () => {
    upstream = signal =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason))
      );
    const res = await get();
    expect(res.status).toBe(500);
  });
});

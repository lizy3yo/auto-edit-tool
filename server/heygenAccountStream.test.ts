import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

let role = "manager";
let free: (number | "shared")[] = [0, 1];

vi.mock("./_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(async (req: any) => {
      if (!req.headers.cookie) throw new Error("no session");
      return { id: 1, role, status: "active" };
    }),
  },
}));
vi.mock("./heygenTest", () => ({
  getHeygenAccountAvailability: vi.fn(async () => ({
    available: free.map(account => ({ account, label: String(account) })),
    configured: 2,
    ratePerSec: 0.06,
  })),
}));

const { registerHeygenAccountStream } = await import("./heygenAccountStream");
const { notifyHeygenAccountsChanged } = await import("./heygenAccountEvents");

let server: Server | null = null;
afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = null;
});

async function listen(): Promise<string> {
  const app = express();
  registerHeygenAccountStream(app);
  server = app.listen(0);
  await new Promise(r => server!.once("listening", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/heygen-test/accounts/stream`;
}

/** Reads `accounts` events off an open stream as they arrive. */
function eventReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  return async (): Promise<any> => {
    for (;;) {
      const m = buf.match(/event: accounts\ndata: (.*)\n\n/);
      if (m) {
        buf = buf.slice(m.index! + m[0].length);
        return JSON.parse(m[1]);
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buf += decoder.decode(value, { stream: true });
    }
  };
}

describe("HeyGen account stream", () => {
  it("refuses a request with no session, and an editor", async () => {
    const url = await listen();
    expect((await fetch(url)).status).toBe(401);
    role = "editor";
    expect((await fetch(url, { headers: { cookie: "s=1" } })).status).toBe(403);
    role = "manager";
  });

  it("sends the free list on connect, and again the moment it changes", async () => {
    const url = await listen();
    free = [0, 1];
    const res = await fetch(url, { headers: { cookie: "s=1" } });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const next = eventReader(res.body!);

    expect((await next()).available.map((a: any) => a.account)).toEqual([0, 1]);

    // Tab 1's film starts: the page hears it without asking.
    free = [1];
    const t0 = Date.now();
    notifyHeygenAccountsChanged();
    const pushed = await next();
    expect(pushed.available.map((a: any) => a.account)).toEqual([1]);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

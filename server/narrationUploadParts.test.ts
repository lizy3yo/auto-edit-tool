import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PART_BYTES, partCount, partRange } from "../shared/uploadParts";

// The routes under test are the transport: signed in as one person, and the audio work and
// the bucket are stand-ins that hand back exactly the bytes they were given.
const user = { id: 7 };
vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: async () => user },
}));
const stored: Buffer[] = [];
vi.mock("./storage", () => ({
  storagePut: async (key: string, data: Buffer) => {
    stored.push(Buffer.from(data));
    return { key, url: `https://cdn.example/${key}` };
  },
}));
vi.mock("./narrationIngest", () => ({
  normalizeNarrationAudio: async (raw: Buffer) => raw,
  probeAudioDurationSec: async () => 12.5,
}));

let server: Server;
let base: string;

beforeAll(async () => {
  const { narrationUploadRouter } = await import("./narrationUpload");
  const app = express();
  app.use(express.json());
  app.use("/api/narration-upload", narrationUploadRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/narration-upload`;
});
afterAll(() => server.close());

/** A file whose every byte says where it is, so a piece out of place shows. */
const fileOf = (size: number) =>
  Buffer.from(
    Uint8Array.from({ length: size }, (_, i) => (i * 31 + (i >> 8)) & 0xff)
  );

const newId = () =>
  `test${Date.now()}${Math.random().toString(36).slice(2, 14)}`;

const put = (id: string, index: number, file: Buffer) => {
  const [start, end] = partRange(index, file.length);
  return fetch(`${base}/${id}/part/${index}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: file.subarray(start, end),
  });
};
const complete = (id: string, parts: number, contentType = "audio/mpeg") =>
  fetch(`${base}/${id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts, contentType }),
  });

describe("a narration uploaded in pieces", () => {
  it("is stored byte for byte as the file that was sent, in any order", async () => {
    const file = fileOf(2 * PART_BYTES + 4321);
    const id = newId();
    const total = partCount(file.length);
    for (const index of [2, 0, 1])
      expect((await put(id, index, file)).ok).toBe(true);
    const res = await complete(id, total);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ durationSec: 12.5 });
    expect(stored.at(-1)!.equals(file)).toBe(true);
  });

  it("says which pieces it holds, so a dropped upload sends only the rest", async () => {
    const file = fileOf(3 * PART_BYTES);
    const id = newId();
    await put(id, 0, file);
    await put(id, 1, file);
    // The connection dropped here. Completing now is refused, with what IS held.
    const early = await complete(id, 3);
    expect(early.status).toBe(409);
    expect((await early.json()).held.map((h: any) => h.index)).toEqual([0, 1]);

    const held = (await (await fetch(`${base}/${id}`)).json()).held;
    expect(held).toEqual([
      { index: 0, bytes: PART_BYTES },
      { index: 1, bytes: PART_BYTES },
    ]);
    await put(id, 2, file);
    expect((await complete(id, 3)).status).toBe(200);
    expect(stored.at(-1)!.equals(file)).toBe(true);
  });

  it("answers a repeated 'complete' with the first result instead of storing twice", async () => {
    const file = fileOf(1000);
    const id = newId();
    await put(id, 0, file);
    const first = await (await complete(id, 1)).json();
    const count = stored.length;
    // The first answer never arrived, so the page asks again.
    const again = await complete(id, 1);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(stored.length).toBe(count);
  });

  it("refuses a piece over the size, a bad id and a file that is not audio", async () => {
    const id = newId();
    const tooBig = await fetch(`${base}/${id}/part/0`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.alloc(PART_BYTES + 1),
    });
    expect(tooBig.status).toBe(413);
    expect(
      (await fetch(`${base}/..%2F..%2Fetc/part/0`, { method: "PUT" })).status
    ).not.toBe(200);
    expect((await fetch(`${base}/short`)).status).toBe(400);

    const file = fileOf(10);
    const other = newId();
    await put(other, 0, file);
    expect((await complete(other, 1, "video/mp4")).status).toBe(400);
  });
});

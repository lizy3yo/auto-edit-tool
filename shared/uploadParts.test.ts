import { describe, expect, it } from "vitest";
import {
  PART_BYTES,
  isUploadId,
  partCount,
  partRange,
  partRetryDelayMs,
  partsToSend,
} from "./uploadParts";

const MB = 1024 * 1024;

describe("an upload in pieces", () => {
  it("cuts a file into pieces that cover every byte exactly once", () => {
    const size = 29 * MB + 123;
    const total = partCount(size);
    expect(total).toBe(30);
    let next = 0;
    for (let i = 0; i < total; i++) {
      const [start, end] = partRange(i, size);
      expect(start).toBe(next);
      expect(end - start).toBeLessThanOrEqual(PART_BYTES);
      next = end;
    }
    expect(next).toBe(size);
  });

  it("sends a tiny file as one piece", () => {
    expect(partCount(10)).toBe(1);
    expect(partRange(0, 10)).toEqual([0, 10]);
  });
});

describe("partsToSend — carrying on from where it stopped", () => {
  const size = 3 * MB + 500;

  it("sends everything when the server holds nothing", () => {
    expect(partsToSend(size, [])).toEqual([0, 1, 2, 3]);
  });

  it("sends only what is missing", () => {
    expect(
      partsToSend(size, [
        { index: 0, bytes: MB },
        { index: 1, bytes: MB },
      ])
    ).toEqual([2, 3]);
  });

  it("sends a piece again when the server's copy is short", () => {
    // Cut off mid-write: trusting it would store a narration with a hole in it.
    expect(
      partsToSend(size, [
        { index: 0, bytes: MB },
        { index: 1, bytes: MB - 7 },
        { index: 3, bytes: 500 },
      ])
    ).toEqual([1, 2]);
  });

  it("ignores pieces that are not this file's", () => {
    expect(
      partsToSend(MB, [
        { index: 0, bytes: MB },
        { index: 9, bytes: MB },
        { index: -1, bytes: MB },
      ])
    ).toEqual([]);
  });
});

describe("the upload id is only ever a folder name", () => {
  it("accepts what the browser makes", () => {
    expect(isUploadId("0f8fad5bd9cb469fa16570867728950e")).toBe(true);
  });

  it("refuses anything that could leave its folder", () => {
    for (const bad of [
      "../../etc/passwd",
      "a/b",
      "short",
      "",
      null,
      12,
      "x".repeat(80),
    ])
      expect(isUploadId(bad)).toBe(false);
  });
});

describe("partRetryDelayMs", () => {
  it("backs off and stops growing", () => {
    expect([1, 2, 3, 4, 5, 6].map(partRetryDelayMs)).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000,
    ]);
  });
});

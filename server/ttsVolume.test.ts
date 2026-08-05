import { describe, it, expect } from "vitest";
import { parseVolumeMultiplier } from "./ttsUnified";

describe("parseVolumeMultiplier", () => {
  it("returns undefined for null/unset/NULL so no ffmpeg pass runs", () => {
    expect(parseVolumeMultiplier(null)).toBeUndefined();
    expect(parseVolumeMultiplier(undefined)).toBeUndefined();
    expect(parseVolumeMultiplier("NULL")).toBeUndefined();
    expect(parseVolumeMultiplier("")).toBeUndefined();
  });

  it("returns undefined for neutral (≈1.0) — byte-identical output", () => {
    expect(parseVolumeMultiplier("1.0")).toBeUndefined();
    expect(parseVolumeMultiplier("1")).toBeUndefined();
    expect(parseVolumeMultiplier("1.0005")).toBeUndefined();
  });

  it("parses valid in-band multipliers", () => {
    expect(parseVolumeMultiplier("1.3")).toBe(1.3);
    expect(parseVolumeMultiplier("0.5")).toBe(0.5);
    expect(parseVolumeMultiplier("2")).toBe(2);
  });

  it("returns undefined for out-of-range or garbage", () => {
    expect(parseVolumeMultiplier("0.4")).toBeUndefined();
    expect(parseVolumeMultiplier("2.5")).toBeUndefined();
    expect(parseVolumeMultiplier("1MKuq")).toBeUndefined();
    expect(parseVolumeMultiplier("abc")).toBeUndefined();
  });
});

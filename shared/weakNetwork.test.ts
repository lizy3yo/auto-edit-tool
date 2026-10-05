import { describe, expect, it } from "vitest";
import {
  MAX_POLL_MS,
  linkQuality,
  pickVideoSource,
  pollIntervalMs,
} from "./weakNetwork";

describe("linkQuality", () => {
  it("is good until an answer is slow to arrive", () => {
    expect(linkQuality(null)).toBe("good");
    expect(linkQuality(300)).toBe("good");
    expect(linkQuality(2000)).toBe("slow");
    expect(linkQuality(6000)).toBe("verySlow");
  });

  it("takes the browser's data-saver setting as slow", () => {
    expect(linkQuality(100, true)).toBe("slow");
    expect(linkQuality(6000, true)).toBe("verySlow");
  });
});

describe("pollIntervalMs", () => {
  it("leaves a good connection's interval alone", () => {
    expect(pollIntervalMs(3000, "good")).toBe(3000);
    expect(pollIntervalMs(1000, "good")).toBe(1000);
  });

  it("asks less often on a weak one, never past the ceiling", () => {
    expect(pollIntervalMs(3000, "slow")).toBe(6000);
    expect(pollIntervalMs(3000, "verySlow")).toBe(MAX_POLL_MS);
    expect(pollIntervalMs(5000, "verySlow")).toBe(MAX_POLL_MS);
    expect(pollIntervalMs(1000, "verySlow")).toBe(3500);
  });

  it("never asks MORE often than it was told to", () => {
    expect(pollIntervalMs(60_000, "verySlow")).toBe(60_000);
  });
});

describe("pickVideoSource", () => {
  const full = "https://x/final-a.mp4";
  const light = "https://x/previews/a-480p.mp4";

  it("plays the light copy on the page and the film in full screen", () => {
    expect(
      pickVideoSource({ mode: "auto", fullscreen: false, full, light })
    ).toBe(light);
    expect(
      pickVideoSource({ mode: "auto", fullscreen: true, full, light })
    ).toBe(full);
  });

  it("keeps Data saver in full screen when the person chose it", () => {
    expect(
      pickVideoSource({ mode: "light", fullscreen: true, full, light })
    ).toBe(light);
  });

  it("plays the film everywhere on Full quality", () => {
    expect(
      pickVideoSource({ mode: "full", fullscreen: false, full, light })
    ).toBe(full);
  });

  it("plays the film when there is no light copy, whatever is picked", () => {
    for (const mode of ["auto", "light", "full"] as const)
      expect(
        pickVideoSource({ mode, fullscreen: false, full, light: null })
      ).toBe(full);
  });
});

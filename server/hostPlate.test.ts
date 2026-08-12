import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  lookIndexFor,
  hostPlatePrompt,
  assignHostPlateContexts,
  plateKey,
  resolveHostPlate,
  __resetPlateCache,
} from "./hostPlate";
import { ENV } from "./_core/env";
import type { StoryboardScene } from "../shared/types";

const generateStillWithFallback = vi.fn();
const storagePut = vi.fn();
vi.mock("./providers/fallback", () => ({
  generateStillWithFallback: (...a: any[]) => generateStillWithFallback(...a),
}));
vi.mock("./storage", () => ({
  storagePut: (...a: any[]) => storagePut(...a),
}));

const scene = (
  index: number,
  hostPresent: boolean,
  visualPrompt = ""
): StoryboardScene =>
  ({ index, hostPresent, visualPrompt, narration: "" }) as StoryboardScene;

const orig = { plates: ENV.hostPlates, looks: ENV.hostPlateLooks };
beforeEach(() => {
  vi.clearAllMocks();
  __resetPlateCache();
  ENV.hostPlates = "1";
  ENV.hostPlateLooks = 4;
  generateStillWithFallback.mockResolvedValue({
    success: true,
    fileData: Buffer.from("img"),
  });
  storagePut.mockImplementation(async (key: string) => ({
    key,
    url: `https://cdn/${key}`,
  }));
});
afterEach(() => {
  ENV.hostPlates = orig.plates;
  ENV.hostPlateLooks = orig.looks;
});

describe("lookIndexFor", () => {
  it("spreads host beats evenly across the configured looks", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(i => lookIndexFor(i, 8, 4))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
  });

  it("never exceeds the last look when the count doesn't divide evenly", () => {
    for (let i = 0; i < 7; i++)
      expect(lookIndexFor(i, 7, 4)).toBeLessThanOrEqual(3);
    expect(lookIndexFor(6, 7, 4)).toBe(3);
  });

  it("collapses to a single look for one scene or one configured look", () => {
    expect(lookIndexFor(0, 1, 4)).toBe(0);
    expect(lookIndexFor(5, 9, 1)).toBe(0);
  });
});

describe("assignHostPlateContexts", () => {
  /**
   * A host scene's own visualPrompt describes the HOST, not the room. The cutaways carry the
   * subject matter, so the look has to borrow from them or every plate says "talking head".
   */
  it("takes the setting from surrounding b-roll, not from the host scene", () => {
    const scenes = [
      scene(1, true, "seated host talks to camera"),
      scene(2, false, "a corroded copper pipe under a kitchen sink, dripping"),
    ];
    assignHostPlateContexts(scenes, "plumbing");
    expect(scenes[0].hostPlateContext).toBe(
      "a corroded copper pipe under a kitchen sink, dripping"
    );
  });

  it("gives every scene in a look the SAME string so they share one plate", () => {
    ENV.hostPlateLooks = 2;
    const scenes = [
      scene(1, true),
      scene(2, false, "a tiled bathroom wall"),
      scene(3, true),
      scene(4, true),
      scene(5, false, "a workshop bench with tools"),
      scene(6, true),
    ];
    assignHostPlateContexts(scenes, "plumbing");
    const hosts = scenes.filter(s => s.hostPresent);
    const distinct = new Set(hosts.map(s => s.hostPlateContext));
    expect(distinct.size).toBe(2); // one per look, not one per scene
  });

  it("falls back to the video subject when a look has no usable cutaway", () => {
    const scenes = [scene(1, true), scene(2, true)];
    assignHostPlateContexts(scenes, "plumbing");
    expect(scenes[0].hostPlateContext).toMatch(/relevant to plumbing/);
  });

  // Enhanced b-roll prompts are ~60 words of camera direction, which would fight the plate
  // prompt's own framing instructions.
  it("truncates a long enhanced b-roll prompt to its first clause", () => {
    const scenes = [
      scene(1, true),
      scene(
        2,
        false,
        "a brass fitting catches the light. Slow dolly in, shallow depth of field, warm key"
      ),
    ];
    assignHostPlateContexts(scenes);
    expect(scenes[0].hostPlateContext).toBe(
      "a brass fitting catches the light"
    );
  });

  it("does nothing when there are no host scenes", () => {
    const scenes = [scene(1, false, "b-roll")];
    assignHostPlateContexts(scenes, "plumbing");
    expect(scenes[0].hostPlateContext).toBeUndefined();
  });
});

describe("hostPlatePrompt", () => {
  it("carries the setting and forbids cropping the head", () => {
    const p = hostPlatePrompt("a tiled bathroom");
    expect(p).toContain("a tiled bathroom");
    expect(p).toMatch(/do not crop the head/i);
    expect(p).toContain("16:9");
    // The setting must be legible — a tight headshot in a new room defeats the purpose.
    expect(p).toMatch(/environment is clearly visible/i);
  });
});

describe("plateKey", () => {
  // A scene pinned to the alt photo must plate FROM that photo, or the two-angle cut rhythm
  // collapses to one face.
  it("separates the primary and alt host photos", () => {
    expect(plateKey(1, "kitchen", 0)).not.toBe(plateKey(1, "kitchen", 1));
  });

  it("is stable for the same look and scoped per job", () => {
    expect(plateKey(1, "kitchen", 0)).toBe(plateKey(1, "kitchen", 0));
    expect(plateKey(1, "kitchen", 0)).not.toBe(plateKey(2, "kitchen", 0));
  });
});

describe("resolveHostPlate", () => {
  const base = {
    jobId: 7,
    hostPhotoUrl: "https://cdn/headshot.png",
    apimartKey: null,
  };

  it("returns the raw photo untouched when plates are off", async () => {
    ENV.hostPlates = "0";
    const s = scene(1, true);
    s.hostPlateContext = "a kitchen";
    expect(await resolveHostPlate({ ...base, scene: s })).toBe(
      base.hostPhotoUrl
    );
    expect(generateStillWithFallback).not.toHaveBeenCalled();
  });

  it("generates a plate from the host photo as identity reference", async () => {
    const s = scene(1, true);
    s.hostPlateContext = "a tiled bathroom";
    const url = await resolveHostPlate({ ...base, scene: s });
    expect(url).toMatch(/host-plate-0-/);
    expect(s.hostPlateUrl).toBe(url);
    expect(generateStillWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImageUrl: base.hostPhotoUrl })
    );
  });

  // Host scenes in a look render concurrently; without promise caching each would pay for its
  // own plate and get a slightly different face.
  it("generates ONE plate for concurrent scenes sharing a look", async () => {
    const a = scene(1, true);
    const b = scene(3, true);
    a.hostPlateContext = b.hostPlateContext = "a workshop bench";
    const [ua, ub] = await Promise.all([
      resolveHostPlate({ ...base, scene: a }),
      resolveHostPlate({ ...base, scene: b }),
    ]);
    expect(ua).toBe(ub);
    expect(generateStillWithFallback).toHaveBeenCalledTimes(1);
  });

  it("reuses an already-plated scene instead of regenerating", async () => {
    const s = scene(1, true);
    s.hostPlateContext = "a kitchen";
    s.hostPlateUrl = "https://cdn/existing.png";
    expect(await resolveHostPlate({ ...base, scene: s })).toBe(
      "https://cdn/existing.png"
    );
    expect(generateStillWithFallback).not.toHaveBeenCalled();
  });

  // A plate is an enhancement — losing the background beats failing the scene.
  it("falls back to the raw photo when generation fails", async () => {
    generateStillWithFallback.mockResolvedValue({
      success: false,
      error: "no credits",
    });
    const s = scene(1, true);
    s.hostPlateContext = "a kitchen";
    expect(await resolveHostPlate({ ...base, scene: s })).toBe(
      base.hostPhotoUrl
    );
    expect(s.hostPlateUrl).toBeUndefined();
  });

  it("retries on the next scene rather than caching a failure", async () => {
    generateStillWithFallback.mockResolvedValueOnce({
      success: false,
      error: "transient",
    });
    const a = scene(1, true);
    const b = scene(2, true);
    a.hostPlateContext = b.hostPlateContext = "a kitchen";
    expect(await resolveHostPlate({ ...base, scene: a })).toBe(
      base.hostPhotoUrl
    );
    expect(await resolveHostPlate({ ...base, scene: b })).toMatch(
      /host-plate-/
    );
    expect(generateStillWithFallback).toHaveBeenCalledTimes(2);
  });

  it("passes through when an older storyboard has no assigned context", async () => {
    const s = scene(1, true);
    expect(await resolveHostPlate({ ...base, scene: s })).toBe(
      base.hostPhotoUrl
    );
    expect(generateStillWithFallback).not.toHaveBeenCalled();
  });
});

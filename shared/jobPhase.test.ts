import { describe, it, expect } from "vitest";
import {
  assemblyPhase,
  levelPhase,
  ASSEMBLY_WEIGHTS,
  LEVEL_WEIGHTS,
} from "./jobPhase";

describe("assemblyPhase", () => {
  it("gives the scene encodes most of the bar and counts them one by one", () => {
    expect(assemblyPhase({ step: "prepare" })).toEqual({
      label: "Preparing",
      pct: 0,
    });
    expect(assemblyPhase({ step: "scenes", done: 0, total: 224 })).toEqual({
      label: "Encoding scenes 0/224",
      pct: 3,
    });
    expect(assemblyPhase({ step: "scenes", done: 112, total: 224 }).pct).toBe(
      44
    );
    expect(assemblyPhase({ step: "scenes", done: 224, total: 224 }).pct).toBe(
      85
    );
  });

  it("runs the whole-film steps in order after the scenes, ending short of 100 until the upload", () => {
    const order = ["join", "audio", "music", "final", "upload"] as const;
    const pcts = order.map(step => assemblyPhase({ step }).pct);
    expect(pcts).toEqual([85, 88, 92, 95, 97]);
    expect(assemblyPhase({ step: "audio" }).label).toBe(
      "Building the audio track"
    );
  });

  it("clamps a count past its total and survives a zero total", () => {
    expect(assemblyPhase({ step: "scenes", done: 300, total: 224 }).pct).toBe(
      85
    );
    expect(assemblyPhase({ step: "scenes", done: 0, total: 0 }).pct).toBe(3);
  });

  it("covers 0..100 with no gaps or overlaps between steps", () => {
    for (const weights of [ASSEMBLY_WEIGHTS, LEVEL_WEIGHTS]) {
      const spans = Object.values(weights);
      expect(spans[0][0]).toBe(0);
      expect(spans[spans.length - 1][1]).toBe(100);
      for (let i = 1; i < spans.length; i++)
        expect(spans[i][0]).toBe(spans[i - 1][1]);
    }
  });
});

describe("levelPhase", () => {
  it("walks download → measure → apply → save, then re-cut slices to 100", () => {
    expect(levelPhase({ step: "download" }).pct).toBe(0);
    expect(levelPhase({ step: "measure" })).toEqual({
      label: "Measuring the voice",
      pct: 5,
    });
    expect(levelPhase({ step: "apply" }).pct).toBe(40);
    expect(levelPhase({ step: "save" }).pct).toBe(75);
    expect(levelPhase({ step: "slices", done: 10, total: 20 })).toEqual({
      label: "Re-cutting scene audio 10/20",
      pct: 93,
    });
    expect(levelPhase({ step: "slices", done: 20, total: 20 }).pct).toBe(100);
  });
});

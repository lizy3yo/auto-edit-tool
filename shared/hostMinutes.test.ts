import { describe, it, expect } from "vitest";
import {
  resolveHostBudget,
  hostGuideFraction,
  formatMinSec,
  HOST_MINUTES_MAX_FRACTION,
} from "./hostMinutes";
import { DEFAULT_LONGFORM_PACING, LEGACY_PACING } from "./pacing";

describe("resolveHostBudget", () => {
  it("gives the selected minutes when they sit within the guide", () => {
    // 20-min film, 35% guide = 7 min; 3 min is well inside it.
    const b = resolveHostBudget({
      minutes: 3,
      filmSec: 1200,
      guideFraction: 0.35,
    });
    expect(b.basis).toBe("selected");
    expect(b.overGuide).toBe(false);
    expect(b.budgetSec).toBe(180);
  });

  it("falls back to the guide when over it and not overridden", () => {
    // 10-min film: guide 3.5 min, pick 7.
    for (const override of [false, undefined]) {
      const b = resolveHostBudget({
        minutes: 7,
        override,
        filmSec: 600,
        guideFraction: 0.35,
      });
      expect(b.overGuide).toBe(true);
      expect(b.basis).toBe("guide");
      expect(b.budgetSec).toBeCloseTo(210);
    }
  });

  it("honours an override, capped at half the film", () => {
    const within = resolveHostBudget({
      minutes: 5,
      override: true,
      filmSec: 720,
      guideFraction: 0.35,
    });
    expect(within.basis).toBe("override");
    expect(within.budgetSec).toBe(300);
    expect(within.clampedToMax).toBe(false);

    const clamped = resolveHostBudget({
      minutes: 7,
      override: true,
      filmSec: 600,
      guideFraction: 0.35,
    });
    expect(clamped.budgetSec).toBe(600 * HOST_MINUTES_MAX_FRACTION);
    expect(clamped.clampedToMax).toBe(true);
  });

  it("never makes an override cheaper than the guide it overrides", () => {
    // An admin guide above half the film (the pacing page allows 55%).
    const b = resolveHostBudget({
      minutes: 7,
      override: true,
      filmSec: 600,
      guideFraction: 0.55,
    });
    expect(b.budgetSec).toBeGreaterThanOrEqual(b.guideSec);
  });
});

describe("hostGuideFraction", () => {
  it("reads the visual-mix dial, or the legacy 35% when the dial is off", () => {
    expect(hostGuideFraction(DEFAULT_LONGFORM_PACING)).toBe(
      DEFAULT_LONGFORM_PACING.visualMix.hostShare
    );
    expect(hostGuideFraction(LEGACY_PACING)).toBe(0.35);
  });
});

describe("formatMinSec", () => {
  it("prints m:ss", () => {
    expect(formatMinSec(180)).toBe("3:00");
    expect(formatMinSec(65.4)).toBe("1:05");
    expect(formatMinSec(-3)).toBe("0:00");
  });
});

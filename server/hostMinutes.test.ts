import { describe, it, expect } from "vitest";
import {
  planHostMinutes,
  capHostMinutes,
  ensureHostInCta,
  hostBudgetForJob,
  HOST_MIN_HOLD_SEC,
  WORDS_PER_SEC,
} from "./longformVideo";
import { ESTIMATE_WORDS_PER_SEC } from "../shared/hostMinutes";
import { DEFAULT_LONGFORM_PACING } from "../shared/pacing";
import type { LongformInputParams, StoryboardScene } from "../shared/types";

const SCENE_SEC = 6;

/** A film of `count` 6s scenes; `host(i)` decides the storyboard's own host beats. */
function film(
  count: number,
  host: (i: number) => boolean,
  extra: (i: number) => Partial<StoryboardScene> = () => ({})
): StoryboardScene[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    narration: `line ${i}`,
    visualPrompt: host(i) ? "host talks" : `b-roll ${i}`,
    hostPresent: host(i),
    audioDuration: SCENE_SEC,
    ...(host(i) ? { brollVisual: `cutaway ${i}` } : {}),
    ...(i === 0 ? { hostOpener: true as const } : {}),
    ...extra(i),
  }));
}

const hostSec = (scenes: StoryboardScene[]) =>
  scenes.reduce((s, x) => s + (x.hostPresent ? (x.audioDuration ?? 0) : 0), 0);

/** Start times (s) of every host beat, in order. */
const hostStarts = (scenes: StoryboardScene[]) =>
  scenes.flatMap((s, i) => (s.hostPresent ? [i * SCENE_SEC] : []));

describe("planHostMinutes", () => {
  // 20-minute film, host on every other beat (the storyboard writes host heavily), one CTA
  // block at 10:00–11:00 with a host beat in it.
  const twentyMin = () =>
    film(
      200,
      i => i % 2 === 0 || i === 199,
      i => (i >= 100 && i < 110 ? { cta: true } : {})
    );

  it("keeps hook, CTA and outro, and lands at/under the budget", () => {
    const scenes = twentyMin();
    const plan = planHostMinutes(scenes, 180, { canPromote: true });
    expect(scenes[0].hostPresent).toBe(true); // hook
    expect(scenes[100].hostPresent).toBe(true); // CTA host beat
    expect(scenes[199].hostPresent).toBe(true); // outro
    expect(hostSec(scenes)).toBeLessThanOrEqual(180);
    // It spends the budget rather than stopping at the minimum.
    expect(hostSec(scenes)).toBeGreaterThan(180 - 2 * SCENE_SEC);
    expect(plan.anchorsOverBudget).toBe(false);
    expect(plan.cadenceSec).toBe(60);
  });

  it("puts the host on screen about once a minute", () => {
    const scenes = twentyMin();
    planHostMinutes(scenes, 180, { canPromote: true });
    const starts = hostStarts(scenes);
    for (let k = 1; k < starts.length; k++) {
      // The CTA block is its own host rhythm; elsewhere no gap may run past ~90s.
      expect(starts[k] - starts[k - 1]).toBeLessThanOrEqual(90);
    }
  });

  it("never leaves two host beats side by side outside the cold open", () => {
    const scenes = twentyMin();
    planHostMinutes(scenes, 180, { canPromote: true });
    for (let i = 2; i < scenes.length; i++) {
      if (scenes[i].cta || scenes[i - 1].cta) continue;
      expect(scenes[i].hostPresent && scenes[i - 1].hostPresent).toBe(false);
    }
  });

  it("widens the spacing evenly when the budget cannot cover one a minute", () => {
    // 30-minute film, 1 minute of host: 7 check-ins' worth after the anchors.
    const scenes = film(
      300,
      i => i % 2 === 0 || i === 299,
      i => (i >= 150 && i < 160 ? { cta: true } : {})
    );
    const plan = planHostMinutes(scenes, 60, { canPromote: true });
    expect(plan.cadenceSec).toBeGreaterThan(60);
    expect(hostSec(scenes)).toBeLessThanOrEqual(60);
    // Both halves of the film get check-ins — the budget is not spent up front.
    const interior = hostStarts(scenes).filter(
      t => t > SCENE_SEC && t < 299 * SCENE_SEC && (t < 900 || t >= 960)
    );
    expect(interior.some(t => t < 900)).toBe(true);
    expect(interior.some(t => t >= 960)).toBe(true);
  });

  it("promotes a cutaway where no host beat sits near a target, keeping its b-roll to go back to", () => {
    // Only the bookends are host; four minutes of pure b-roll between them.
    const scenes = film(40, i => i === 0 || i === 39);
    const plan = planHostMinutes(scenes, 60, { canPromote: true });
    expect(plan.promoted.length).toBeGreaterThan(0);
    for (const idx of plan.promoted) {
      const s = scenes[idx];
      expect(s.hostPresent).toBe(true);
      expect(s.stillImage).toBe(false);
      expect(s.brollVisual).toBe(`b-roll ${idx}`);
      expect(s.minHoldSec).toBeGreaterThanOrEqual(HOST_MIN_HOLD_SEC);
    }
  });

  it("does not promote without a host photo", () => {
    const scenes = film(40, i => i === 0 || i === 39);
    const plan = planHostMinutes(scenes, 60, { canPromote: false });
    expect(plan.promoted).toEqual([]);
    expect(hostStarts(scenes)).toEqual([0, 39 * SCENE_SEC]);
  });

  it("keeps every anchor and flags it when the anchors alone exceed the budget", () => {
    const scenes = twentyMin();
    const plan = planHostMinutes(scenes, 10, { canPromote: true });
    expect(plan.anchorsOverBudget).toBe(true);
    expect(plan.checkIns).toBe(0);
    // Exactly the anchors survive: the hook, the CTA block's own host beats, the outro.
    const anchor = (i: number) => i === 0 || i === 199 || !!scenes[i].cta;
    scenes.forEach((s, i) => {
      if (anchor(i) && i % 2 === 0) expect(s.hostPresent).toBe(true);
      if (!anchor(i)) expect(s.hostPresent).toBe(false);
    });
    expect(scenes[199].hostPresent).toBe(true);
  });

  it("reserves the beat ensureHostInCta will add, so the pitch does not bust the budget", () => {
    // A CTA block with NO host beat: ensureHostInCta flips one later.
    const scenes = film(
      200,
      i => i % 2 === 0 || i === 199,
      i => (i >= 101 && i < 110 && i % 2 === 1 ? { cta: true } : {})
    );
    // Make the CTA run contiguous and host-free.
    for (let i = 101; i < 110; i++) {
      scenes[i].cta = true;
      scenes[i].hostPresent = false;
    }
    const plan = planHostMinutes(scenes, 180, { canPromote: true });
    expect(plan.ctaReserveSec).toBe(SCENE_SEC);
    ensureHostInCta(scenes);
    const capped = capHostMinutes(scenes, 180);
    expect(capped.overBudget).toBe(false);
    expect(hostSec(scenes)).toBeLessThanOrEqual(180);
  });
});

describe("capHostMinutes", () => {
  it("removes the most redundant check-in and never an anchor", () => {
    // host: hook 0, check-ins 4 and 6 (12s apart), 14 (far from both), outro 19.
    const scenes = film(20, i => [0, 4, 6, 14, 19].includes(i));
    const r = capHostMinutes(scenes, 4 * SCENE_SEC);
    expect(r.demoted).toHaveLength(1);
    expect([4, 6]).toContain(r.demoted[0]);
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[14].hostPresent).toBe(true);
    expect(scenes[19].hostPresent).toBe(true);
    expect(r.overBudget).toBe(false);
  });

  it("demotes a lone check-in too", () => {
    const scenes = film(20, i => [0, 10, 19].includes(i));
    const r = capHostMinutes(scenes, 2 * SCENE_SEC);
    expect(r.demoted).toEqual([10]);
  });

  it("reports over budget rather than cutting hook, pitch or outro", () => {
    const scenes = film(
      20,
      i => [0, 10, 19].includes(i),
      i => (i === 10 ? { cta: true } : {})
    );
    const r = capHostMinutes(scenes, SCENE_SEC);
    expect(r.demoted).toEqual([]);
    expect(r.overBudget).toBe(true);
  });
});

describe("hostBudgetForJob", () => {
  const scenes = film(200, () => false);
  const base = { script: "x" } as LongformInputParams;

  it("is null without a host-minutes pick, so the percentage mix runs unchanged", () => {
    expect(hostBudgetForJob(base, scenes, DEFAULT_LONGFORM_PACING)).toBeNull();
  });

  it("is null on a b-roll-only job", () => {
    expect(
      hostBudgetForJob(
        { ...base, hostMinutes: 3, brollOnly: true },
        scenes,
        DEFAULT_LONGFORM_PACING
      )
    ).toBeNull();
  });

  it("resolves against the measured film", () => {
    // 1200s film, 35% guide: 3 min fits.
    const b = hostBudgetForJob(
      { ...base, hostMinutes: 3 },
      scenes,
      DEFAULT_LONGFORM_PACING
    );
    expect(b?.budgetSec).toBe(180);
    expect(b?.basis).toBe("selected");
  });
});

it("the form's length estimate and the pipeline's pace are one number", () => {
  expect(WORDS_PER_SEC).toBe(ESTIMATE_WORDS_PER_SEC);
});

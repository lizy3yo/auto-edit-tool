import { describe, it, expect } from "vitest";
import {
  planHostMinutes,
  capHostMinutes,
  hostTheCtaPitch,
  hostBudgetForJob,
  hostSectionSecForJob,
  shapeHostSections,
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
    narration: `line ${i}.`, // a whole sentence: host takes may only be whole sentences
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

/** Host (H) / b-roll (B) pattern of a run of scenes. */
const pattern = (scenes: StoryboardScene[], from: number, to: number) =>
  scenes
    .slice(from, to + 1)
    .map(s => (s.hostPresent ? "H" : "B"))
    .join("");

describe("shapeHostSections", () => {
  // 40 × 6 s = 4:00. A 20 s section holds scenes 0–2 (intro) and 37–39 (outro).
  it("builds host/b-roll switching from pure b-roll, opening and closing on the host", () => {
    const scenes = film(40, i => i === 0 || i === 39);
    const r = shapeHostSections(scenes, 20, { canPromote: true });
    expect(pattern(scenes, 0, 2)).toBe("HBH");
    expect(pattern(scenes, 37, 39)).toBe("HBH");
    expect(r.promoted.sort((a, b) => a - b)).toEqual([2, 37]);
    // Nothing outside the sections is touched.
    expect(pattern(scenes, 3, 36)).toBe("B".repeat(34));
  });

  it("breaks up a section the storyboard wrote as solid host", () => {
    const scenes = film(40, i => i < 3 || i > 36);
    const r = shapeHostSections(scenes, 20, { canPromote: true });
    expect(pattern(scenes, 0, 2)).toBe("HBH");
    expect(pattern(scenes, 37, 39)).toBe("HBH");
    expect(r.demoted.sort((a, b) => a - b)).toEqual([1, 38]);
  });

  it("keeps the locked two-angle cold open together", () => {
    const scenes = film(
      40,
      i => i < 3 || i === 39,
      i => (i === 1 ? { hostOpener: true } : {})
    );
    shapeHostSections(scenes, 20, { canPromote: true });
    expect(pattern(scenes, 0, 2)).toBe("HHB");
  });

  it("leaves a CTA beat inside a section exactly as it is", () => {
    const scenes = film(
      40,
      i => i === 0 || i >= 38,
      i => (i === 38 ? { cta: true, ctaIndex: 0 } : {})
    );
    shapeHostSections(scenes, 20, { canPromote: true });
    expect(scenes[38].hostPresent).toBe(true);
    expect(scenes[38].cta).toBe(true);
    // The closer is kept; the beat before the CTA host is not promoted beside it.
    expect(pattern(scenes, 37, 39)).toBe("BHH");
  });

  it("skips a beat too short or too long for the host, and does not promote without a photo", () => {
    const scenes = film(40, i => i === 0 || i === 39);
    scenes[2].audioDuration = 2; // under the host floor
    scenes[3].audioDuration = 6;
    const r = shapeHostSections(scenes, 25, { canPromote: true });
    expect(scenes[2].hostPresent).toBe(false);
    expect(scenes[3].hostPresent).toBe(true); // the next beat takes the turn

    const noPhoto = film(40, i => i === 0 || i === 39);
    expect(
      shapeHostSections(noPhoto, 20, { canPromote: false }).promoted
    ).toEqual([]);
    expect(r.promoted).toContain(3);
  });

  it("does nothing without a section length", () => {
    const scenes = film(40, i => i < 3 || i > 36);
    const r = shapeHostSections(scenes, 0, { canPromote: true });
    expect(r).toEqual({ promoted: [], demoted: [] });
    expect(pattern(scenes, 0, 2)).toBe("HHH");
  });
});

describe("planHostMinutes with intro/outro sections", () => {
  // 20-minute film, host on every other beat, one CTA block at 10:00–11:00.
  const twentyMin = () =>
    film(
      200,
      i => i % 2 === 0 || i === 199,
      i => (i >= 100 && i < 110 ? { cta: true, ctaIndex: 0 } : {})
    );

  it("keeps every section host beat, counts it as hook/outro, and stays in budget", () => {
    const scenes = twentyMin();
    // 30 s sections: intro scenes 0–4, outro scenes 195–199.
    const plan = planHostMinutes(scenes, 180, {
      canPromote: true,
      sectionSec: 30,
    });
    expect(pattern(scenes, 0, 4)).toBe("HBHBH");
    expect(pattern(scenes, 195, 199)).toBe("HBHBH");
    expect(plan.hookSec).toBe(3 * SCENE_SEC);
    expect(plan.outroSec).toBe(3 * SCENE_SEC);
    expect(hostSec(scenes)).toBeLessThanOrEqual(180);
    // Check-ins run between the sections, not inside them.
    expect(plan.checkIns).toBeGreaterThan(0);
  });

  it("never lets the final cap remove a section host beat", () => {
    const scenes = twentyMin();
    planHostMinutes(scenes, 180, { canPromote: true, sectionSec: 30 });
    const r = capHostMinutes(scenes, 30, 30); // far under what the anchors need
    expect(r.overBudget).toBe(true);
    expect(pattern(scenes, 0, 4)).toBe("HBHBH");
    expect(pattern(scenes, 195, 199)).toBe("HBHBH");
  });

  it("sizes the sections from the job's pick, and not at all without one", () => {
    const scenes = twentyMin();
    const base = { script: "x" } as LongformInputParams;
    expect(hostSectionSecForJob({ ...base, hostMinutes: 3 }, scenes)).toBe(20);
    expect(hostSectionSecForJob({ ...base, hostMinutes: 7 }, scenes)).toBe(80);
    expect(hostSectionSecForJob(base, scenes)).toBe(0);
  });
});

describe("planHostMinutes", () => {
  // 20-minute film, host on every other beat (the storyboard writes host heavily), one CTA
  // block at 10:00–11:00 with a host beat in it.
  const twentyMin = () =>
    film(
      200,
      i => i % 2 === 0 || i === 199,
      i => (i >= 100 && i < 110 ? { cta: true, ctaIndex: 0 } : {})
    );

  it("keeps hook, CTA and outro, and lands at/under the budget", () => {
    const scenes = twentyMin();
    const plan = planHostMinutes(scenes, 180, { canPromote: true });
    expect(scenes[0].hostPresent).toBe(true); // hook
    expect(scenes[100].hostPresent).toBe(true); // CTA host beat
    expect(scenes[199].hostPresent).toBe(true); // outro
    // The pitch's five cutaways go to the host later — their time is held back now.
    expect(plan.ctaReserveSec).toBe(5 * SCENE_SEC);
    const planned = hostSec(scenes) + plan.ctaReserveSec;
    expect(planned).toBeLessThanOrEqual(180);
    // It spends the budget rather than stopping at the minimum.
    expect(planned).toBeGreaterThan(180 - 2 * SCENE_SEC);
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
    // 30-minute film, 1 minute of host: 6 check-ins' worth after the anchors (hook, a two-beat
    // pitch — one host, one reserved — and the outro).
    const scenes = film(
      300,
      i => i % 2 === 0 || i === 299,
      i => (i >= 150 && i < 152 ? { cta: true, ctaIndex: 0 } : {})
    );
    const plan = planHostMinutes(scenes, 60, { canPromote: true });
    expect(plan.cadenceSec).toBeGreaterThan(60);
    expect(hostSec(scenes)).toBeLessThanOrEqual(60);
    // Both halves of the film get check-ins — the budget is not spent up front.
    const interior = hostStarts(scenes).filter(
      t => t > SCENE_SEC && t < 299 * SCENE_SEC && (t < 900 || t >= 912)
    );
    expect(interior.some(t => t < 900)).toBe(true);
    expect(interior.some(t => t >= 912)).toBe(true);
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

  it("reserves every pitch beat hostTheCtaPitch will host, so check-ins pay for the pitch", () => {
    // A CTA block with NO host beat: hostTheCtaPitch puts the host on all nine later.
    const scenes = film(
      200,
      i => i % 2 === 0 || i === 199,
      i =>
        i >= 101 && i < 110 && i % 2 === 1 ? { cta: true, ctaIndex: 0 } : {}
    );
    // Make the CTA run contiguous and host-free.
    for (let i = 101; i < 110; i++) {
      scenes[i].cta = true;
      scenes[i].ctaIndex = 0;
      scenes[i].hostPresent = false;
    }
    const plan = planHostMinutes(scenes, 180, { canPromote: true });
    expect(plan.ctaReserveSec).toBe(9 * SCENE_SEC);
    hostTheCtaPitch(scenes, { canHost: true });
    for (let i = 101; i < 110; i++) expect(scenes[i].hostPresent).toBe(true);
    const capped = capHostMinutes(scenes, 180);
    expect(capped.overBudget).toBe(false);
    expect(hostSec(scenes)).toBeLessThanOrEqual(180);
  });

  it("leaves the beats the operator's assets will take out of the reserve", () => {
    const scenes = film(200, i => i % 2 === 0 || i === 199);
    for (let i = 101; i < 110; i++) {
      scenes[i].cta = true;
      scenes[i].ctaIndex = 0;
      scenes[i].hostPresent = false;
    }
    const plan = planHostMinutes(scenes, 180, {
      canPromote: true,
      assetCount: 2,
    });
    expect(plan.ctaReserveSec).toBe(7 * SCENE_SEC);
  });

  it("reserves nothing without a host photo — the pitch stays pictures", () => {
    const scenes = film(200, i => i % 2 === 0 || i === 199);
    for (let i = 101; i < 110; i++) {
      scenes[i].cta = true;
      scenes[i].ctaIndex = 0;
      scenes[i].hostPresent = false;
    }
    const plan = planHostMinutes(scenes, 180, { canPromote: false });
    expect(plan.ctaReserveSec).toBe(0);
  });
});

describe("whole-sentence host takes", () => {
  it("never promotes a cutaway that starts or stops mid-sentence", () => {
    // Only the bookends are host; every cutaway is a clause of a longer sentence.
    const scenes = film(
      40,
      i => i === 0 || i === 39,
      i => (i === 0 || i === 39 ? {} : { narration: `clause ${i},` })
    );
    const plan = planHostMinutes(scenes, 60, { canPromote: true });
    expect(plan.promoted).toEqual([]);
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
      i => (i === 10 ? { cta: true, ctaIndex: 0 } : {})
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

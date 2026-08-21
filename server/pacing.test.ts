import { describe, it, expect } from "vitest";
import type {
  StoryboardScene,
  LongformAsset,
  LongformCtaBook,
} from "../shared/types";
import {
  DEFAULT_LONGFORM_PACING,
  LEGACY_PACING,
  MAX_JOB_ASSETS,
  MAX_QUARTER_LOAD,
  PACING_BOUNDS,
  resolveLongformPacing,
  scaleRamp,
  type LongformPacing,
} from "../shared/pacing";
import {
  HOST_RAMP,
  HOST_SCREEN_FRACTION,
  HOST_SPLITVISUAL_FRACTION,
  MOTION_RAMP,
  STILL_IMAGE_FRACTION,
  RAMP_MIN_SCENES,
  hostFractionFor,
  hostRampFor,
  motionFractionFor,
  motionRampFor,
  splitFractionFor,
  stillFractionFor,
  maxAdjacentMotionFor,
  MOTION_RUN_CAP_THRESHOLD,
  pacingFor,
  markFastOpenScenes,
  placeAssetBeats,
  enforceHostSplitMix,
  enforceStillMotionRatio,
  enforceVisualAdjacency,
  rebalanceHostScreenTime,
  segmentScriptByDuration,
  splitIntoUnits,
  splitOverlongScenes,
  coalesceShortScenes,
  measuredSizeFor,
  applySceneHoldFloor,
  SCENE_MIN_HOLD_SEC,
  HOST_MIN_HOLD_SEC,
  LONG_SCENE_MAX_SEC,
  bookForScene,
  coverImageForScene,
  qrOverlayUrlFor,
  markCtaFromSpans,
} from "./longformVideo";

/** A pacing config with everything at its shipping default except the named overrides. */
const withPacing = (over: Partial<LongformPacing>): LongformPacing =>
  resolveLongformPacing({ ...DEFAULT_LONGFORM_PACING, ...over });

const cut = (
  i: number,
  extra: Partial<StoryboardScene> = {}
): StoryboardScene => ({
  index: i,
  narration: `s${i}`,
  visualPrompt: "b-roll",
  hostPresent: false,
  stillImage: true,
  objectMotion: true,
  audioDuration: 4,
  ...extra,
});

const host = (
  i: number,
  extra: Partial<StoryboardScene> = {}
): StoryboardScene => ({
  index: i,
  narration: `h${i}`,
  visualPrompt: "host",
  hostPresent: true,
  audioDuration: 4,
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────
// The load-bearing promise: OFF is the pre-config pipeline, byte for byte.
// ─────────────────────────────────────────────────────────────────────

describe("LEGACY_PACING mirrors the shipped constants", () => {
  it("resolves to the module constants the balancers used before the config existed", () => {
    expect(hostFractionFor(LEGACY_PACING)).toBe(HOST_SCREEN_FRACTION);
    expect(motionFractionFor(LEGACY_PACING)).toBeCloseTo(
      1 - HOST_SCREEN_FRACTION - STILL_IMAGE_FRACTION
    );
    expect(stillFractionFor(LEGACY_PACING)).toBeCloseTo(STILL_IMAGE_FRACTION);
    expect(splitFractionFor(LEGACY_PACING)).toBe(HOST_SPLITVISUAL_FRACTION);
    expect(hostRampFor(LEGACY_PACING)).toEqual(HOST_RAMP);
    expect(motionRampFor(LEGACY_PACING, HOST_RAMP)).toEqual(MOTION_RAMP);
  });

  it("keeps the shipped motion run cap of 1 — a raised cap must be opt-in", () => {
    expect(maxAdjacentMotionFor(LEGACY_PACING)).toBe(1);
  });

  it("is what a job with no snapshot renders with (an old row must not change)", () => {
    expect(pacingFor({})).toBe(LEGACY_PACING);
    expect(pacingFor({ pacing: DEFAULT_LONGFORM_PACING })).toBe(
      DEFAULT_LONGFORM_PACING
    );
  });

  it("leaves the fast-open window off, so every beat keeps the film-wide band", () => {
    const scenes = [cut(1, { scriptText: "one two three four five" })];
    expect(markFastOpenScenes(scenes, LEGACY_PACING)).toBe(0);
    expect(scenes[0].fastOpen).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveLongformPacing — the only thing standing between a hand-written
// settings row and the balancers.
// ─────────────────────────────────────────────────────────────────────

describe("resolveLongformPacing", () => {
  it("fills every field from the defaults when given nothing", () => {
    expect(resolveLongformPacing(undefined)).toEqual(DEFAULT_LONGFORM_PACING);
    expect(resolveLongformPacing(null)).toEqual(DEFAULT_LONGFORM_PACING);
    expect(resolveLongformPacing({})).toEqual(DEFAULT_LONGFORM_PACING);
  });

  it("merges a PARTIAL row field by field, so a new dial never invalidates a stored config", () => {
    const r = resolveLongformPacing({ visualMix: { motionShare: 0.5 } });
    expect(r.visualMix.motionShare).toBe(0.5);
    expect(r.visualMix.hostShare).toBe(
      DEFAULT_LONGFORM_PACING.visualMix.hostShare
    );
    expect(r.fastOpen).toEqual(DEFAULT_LONGFORM_PACING.fastOpen);
  });

  it("clamps every dial into its published bounds", () => {
    const r = resolveLongformPacing({
      visualMix: { hostShare: 9, motionShare: -3 },
      splitScreen: { hostShare: 5, motion: { share: 42 } },
      fastOpen: { zoneSec: 9999, minShotSec: 0.1, maxShotSec: 99 },
    });
    expect(r.visualMix.hostShare).toBe(PACING_BOUNDS.hostShare.max);
    expect(r.visualMix.motionShare).toBe(PACING_BOUNDS.motionShare.min);
    expect(r.splitScreen.hostShare).toBe(PACING_BOUNDS.splitHostShare.max);
    expect(r.splitScreen.motion.share).toBe(PACING_BOUNDS.splitMotionShare.max);
    expect(r.fastOpen.zoneSec).toBe(PACING_BOUNDS.zoneSec.max);
    expect(r.fastOpen.minShotSec).toBe(PACING_BOUNDS.minShotSec.min);
    expect(r.fastOpen.maxShotSec).toBe(PACING_BOUNDS.maxShotSec.max);
  });

  it("caps host + motion so stills always keep a share of the film", () => {
    const r = resolveLongformPacing({
      visualMix: { hostShare: 0.55, motionShare: 0.6 },
    });
    expect(r.visualMix.hostShare + r.visualMix.motionShare).toBeLessThanOrEqual(
      MAX_QUARTER_LOAD + 1e-9
    );
    expect(stillFractionFor(r)).toBeGreaterThan(0);
  });

  it("never lets the fast-open ceiling fall to or below its floor", () => {
    const r = resolveLongformPacing({
      fastOpen: { enabled: true, minShotSec: 3, maxShotSec: 3 },
    });
    expect(r.fastOpen.maxShotSec).toBeGreaterThan(r.fastOpen.minShotSec);
  });

  it("survives garbage without throwing (a corrupt row must not stop a render)", () => {
    expect(() =>
      resolveLongformPacing({ visualMix: "nonsense", fastOpen: 42 })
    ).not.toThrow();
    const r = resolveLongformPacing({ visualMix: { hostShare: "abc" } });
    expect(Number.isFinite(r.visualMix.hostShare)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// scaleRamp — the reason a raised share doesn't overflow the early quarters.
// ─────────────────────────────────────────────────────────────────────

describe("scaleRamp", () => {
  const caps = [1, 1, 1, 1];

  it("is an identity when the target mean already IS the shape's mean", () => {
    const r = scaleRamp(HOST_RAMP, HOST_SCREEN_FRACTION, caps);
    r.forEach((v, i) => expect(v).toBeCloseTo(HOST_RAMP[i], 10));
  });

  it("hits the requested mean and keeps the front-loading", () => {
    const r = scaleRamp(MOTION_RAMP, 0.385, caps);
    expect(r.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(0.385, 6);
    expect(r[0]).toBeGreaterThan(r[1]);
    expect(r[1]).toBeGreaterThan(r[2]);
    expect(r[2]).toBeGreaterThan(r[3]);
  });

  it("water-fills the overflow instead of clipping the mean away", () => {
    // A steep shape at a high mean would put Q1 far over its ceiling; the excess has to land
    // in the later quarters, not vanish.
    const r = scaleRamp(MOTION_RAMP, 0.4, [0.3, 1, 1, 1]);
    expect(r[0]).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(r.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(0.4, 6);
  });

  it("never exceeds a ceiling, even when the mean is unreachable", () => {
    const r = scaleRamp(MOTION_RAMP, 0.9, [0.2, 0.2, 0.2, 0.2]);
    r.forEach(v => expect(v).toBeLessThanOrEqual(0.2 + 1e-9));
  });

  it("keeps host + motion inside MAX_QUARTER_LOAD at the extremes", () => {
    const p = resolveLongformPacing({
      visualMix: { enabled: true, hostShare: 0.55, motionShare: 0.6 },
    });
    const h = hostRampFor(p);
    const m = motionRampFor(p, h);
    h.forEach((hv, q) =>
      expect(hv + m[q]).toBeLessThanOrEqual(MAX_QUARTER_LOAD + 1e-9)
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// 1. More video
// ─────────────────────────────────────────────────────────────────────

describe("visual mix dial", () => {
  it("converges the still share toward the DIALLED remainder on a short script", () => {
    const p = withPacing({
      visualMix: { enabled: true, hostShare: 0.35, motionShare: 0.38 },
    });
    const scenes = Array.from({ length: 6 }, (_, i) =>
      cut(i, { audioDuration: 10 })
    );
    expect(scenes.length).toBeLessThan(RAMP_MIN_SCENES);
    const r = enforceStillMotionRatio(scenes, p);
    expect(r.total).toBe(60);
    // stills = 1 - 0.35 - 0.38 = 27% of total = 16.2s. The converge loop only flips a scene while
    // the flip moves the total CLOSER to target, so on 10s scenes it can land at most half a
    // scene away — the target is a fraction of runtime, not of scene count.
    const target = stillFractionFor(p) * 60;
    expect(Math.abs(r.stillSeconds - target)).toBeLessThanOrEqual(5);
    // …and materially below where the legacy 50% target would have left it.
    const legacyScenes = Array.from({ length: 6 }, (_, i) =>
      cut(i, { audioDuration: 10 })
    );
    const legacy = enforceStillMotionRatio(legacyScenes, LEGACY_PACING);
    expect(r.stillSeconds).toBeLessThan(legacy.stillSeconds);
  });

  it("raises motion per quarter when the dial is raised", () => {
    const mk = () => Array.from({ length: 200 }, (_, i) => cut(i));
    const legacy = mk();
    const raised = mk();
    enforceStillMotionRatio(legacy, LEGACY_PACING);
    const r = enforceStillMotionRatio(
      raised,
      withPacing({
        visualMix: { enabled: true, hostShare: 0.35, motionShare: 0.38 },
      })
    );
    const motion = (s: StoryboardScene[]) =>
      s
        .filter(x => !x.stillImage)
        .reduce((t, x) => t + (x.audioDuration ?? 0), 0);
    expect(motion(raised)).toBeGreaterThan(motion(legacy));
    expect(r.motionSeconds / r.total).toBeGreaterThan(0.3);
  });

  it("raises the adjacency motion-run cap once a cap of 1 would undo the budget", () => {
    expect(
      maxAdjacentMotionFor(
        withPacing({
          visualMix: { enabled: true, hostShare: 0.35, motionShare: 0.38 },
        })
      )
    ).toBe(2);
    expect(
      maxAdjacentMotionFor(
        withPacing({
          visualMix: {
            enabled: true,
            hostShare: 0.35,
            motionShare: MOTION_RUN_CAP_THRESHOLD,
          },
        })
      )
    ).toBe(1);
  });
});

describe("enforceVisualAdjacency motion run cap", () => {
  const motion = (i: number) => cut(i, { stillImage: false });

  it("breaks EVERY motion pair at the default cap of 1 (unchanged behaviour)", () => {
    const scenes = [motion(1), motion(2), motion(3), motion(4)];
    const r = enforceVisualAdjacency(scenes);
    expect(r.motionBroken).toBe(2);
    expect(scenes.map(s => !!s.stillImage)).toEqual([false, true, false, true]);
  });

  it("allows runs of two at a cap of 2, breaking only the overflowing beat", () => {
    const scenes = [motion(1), motion(2), motion(3), motion(4)];
    const r = enforceVisualAdjacency(scenes, { maxAdjacentMotion: 2 });
    expect(r.motionBroken).toBe(1);
    expect(scenes.map(s => !!s.stillImage)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it("still leaves no run longer than the cap", () => {
    const scenes = Array.from({ length: 12 }, (_, i) => motion(i + 1));
    enforceVisualAdjacency(scenes, { maxAdjacentMotion: 2 });
    let run = 0;
    for (const s of scenes) {
      run = s.stillImage ? 0 : run + 1;
      expect(run).toBeLessThanOrEqual(2);
    }
  });

  it("keeps the host cap at 1 regardless of the motion cap", () => {
    const scenes = [host(1), host(2), host(3), host(4, { brollVisual: "x" })];
    enforceVisualAdjacency(scenes, { maxAdjacentMotion: 2 });
    let run = 0;
    for (const s of scenes) {
      run = s.hostPresent ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2 + 4. Split screen
// ─────────────────────────────────────────────────────────────────────

describe("split-screen dial", () => {
  const hosts = () =>
    Array.from({ length: 20 }, (_, i) =>
      host(i + 1, { brollVisual: `beside ${i}` })
    );

  it("converges the split share to the dialled fraction of HOST runtime", () => {
    const p = withPacing({
      splitScreen: {
        enabled: true,
        hostShare: 20 / 35,
        motion: { enabled: false, share: 0 },
      },
    });
    const scenes = hosts();
    const r = enforceHostSplitMix(scenes, p);
    expect(r.splitSeconds / r.hostSeconds).toBeCloseTo(20 / 35, 1);
  });

  it("switched off still converges to the legacy floor — no film renders split-free", () => {
    // Splits are a constant of the format: a snapshot with the toggle off (e.g. taken before
    // the operator turned it on) must still produce the classic ~7.5%-of-film split share.
    const scenes = hosts().map(s => ({ ...s, splitVisual: "authored beside" }));
    const r = enforceHostSplitMix(
      scenes,
      withPacing({
        splitScreen: {
          enabled: false,
          hostShare: 0.5,
          motion: { enabled: false, share: 0 },
        },
      })
    );
    expect(r.splitSeconds).toBeGreaterThan(0);
    expect(r.splitSeconds / r.hostSeconds).toBeCloseTo(
      LEGACY_PACING.splitScreen.hostShare,
      1
    );
    // The right panel stays a still — motion is genuinely off when disabled.
    expect(r.motionSeconds).toBe(0);
    expect(scenes.every(s => !s.splitMotion)).toBe(true);
  });

  it("a dial above the floor wins over it", () => {
    const scenes = hosts();
    const r = enforceHostSplitMix(
      scenes,
      withPacing({
        splitScreen: {
          enabled: true,
          hostShare: 0.8,
          motion: { enabled: false, share: 0 },
        },
      })
    );
    expect(r.splitSeconds / r.hostSeconds).toBeCloseTo(0.8, 1);
  });

  it("assigns a MOVING right panel to the dialled share of split runtime", () => {
    const p = withPacing({
      splitScreen: {
        enabled: true,
        hostShare: 20 / 35,
        motion: { enabled: true, share: 0.5 },
      },
    });
    const scenes = hosts();
    const r = enforceHostSplitMix(scenes, p);
    expect(r.motionSeconds / r.splitSeconds).toBeCloseTo(0.5, 1);
    // Every moving panel is on a scene that actually HAS a right panel.
    for (const s of scenes)
      if (s.splitMotion) expect(s.splitVisual).toBeTruthy();
  });

  it("assigns no moving panel when right-panel video is switched off", () => {
    const scenes = hosts();
    const r = enforceHostSplitMix(
      scenes,
      withPacing({
        splitScreen: {
          enabled: true,
          hostShare: 20 / 35,
          motion: { enabled: false, share: 0.9 },
        },
      })
    );
    expect(r.motionSeconds).toBe(0);
    expect(scenes.every(s => !s.splitMotion)).toBe(true);
  });

  it("clears stale splitMotion on a re-run rather than accumulating it", () => {
    const p = withPacing({
      splitScreen: {
        enabled: true,
        hostShare: 20 / 35,
        motion: { enabled: true, share: 0.5 },
      },
    });
    const scenes = hosts();
    enforceHostSplitMix(scenes, p);
    const first = scenes.map(s => !!s.splitMotion);
    enforceHostSplitMix(scenes, p);
    expect(scenes.map(s => !!s.splitMotion)).toEqual(first);
  });

  it("never splits the locked cold open", () => {
    const scenes = [
      host(1, { hostOpener: true, splitVisual: "nope" }),
      host(2, { hostOpener: true, splitVisual: "nope" }),
      ...Array.from({ length: 10 }, (_, i) =>
        host(i + 3, { brollVisual: `beside ${i}` })
      ),
    ];
    enforceHostSplitMix(
      scenes,
      withPacing({
        splitScreen: {
          enabled: true,
          hostShare: 0.8,
          motion: { enabled: true, share: 1 },
        },
      })
    );
    expect(scenes[0].splitVisual).toBeUndefined();
    expect(scenes[1].splitVisual).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Fast opening
// ─────────────────────────────────────────────────────────────────────

describe("markFastOpenScenes", () => {
  const words = (n: number) =>
    Array.from({ length: n }, () => "word").join(" ");
  const p = withPacing({
    fastOpen: { enabled: true, zoneSec: 20, minShotSec: 2, maxShotSec: 5 },
  });

  it("marks only the leading scenes inside the window", () => {
    // 2.8 words/sec × 20s ≈ 56 words of window; 10-word scenes ⇒ ~6 scenes.
    const scenes = Array.from({ length: 20 }, (_, i) =>
      cut(i + 1, { scriptText: words(10) })
    );
    const marked = markFastOpenScenes(scenes, p);
    expect(marked).toBeGreaterThan(3);
    expect(marked).toBeLessThan(scenes.length);
    // Contiguous from the front — no gaps.
    scenes.forEach((s, i) => expect(!!s.fastOpen).toBe(i < marked));
  });

  it("SKIPS the locked cold open, which keeps the film-wide band", () => {
    const scenes = [
      host(1, { hostOpener: true, scriptText: words(10) }),
      host(2, { hostOpener: true, scriptText: words(10) }),
      ...Array.from({ length: 10 }, (_, i) =>
        cut(i + 3, { scriptText: words(10) })
      ),
    ];
    markFastOpenScenes(scenes, p);
    expect(scenes[0].fastOpen).toBeUndefined();
    expect(scenes[1].fastOpen).toBeUndefined();
    expect(scenes[2].fastOpen).toBe(true);
  });

  it("clears any previous marking, so a re-run is not additive", () => {
    const scenes = Array.from({ length: 5 }, (_, i) =>
      cut(i + 1, { scriptText: words(10), fastOpen: true as const })
    );
    markFastOpenScenes(scenes, LEGACY_PACING);
    expect(scenes.every(s => s.fastOpen === undefined)).toBe(true);
  });
});

describe("fast-open band", () => {
  const p = withPacing({
    fastOpen: { enabled: true, zoneSec: 45, minShotSec: 2, maxShotSec: 5 },
  });

  it("splits a fast-zone cutaway at the TIGHTER ceiling", () => {
    const text =
      "First sentence here. Second sentence here. Third sentence here. Fourth sentence here.";
    const inZone = [
      cut(1, { scriptText: text, audioDuration: 7, fastOpen: true as const }),
    ];
    const outZone = [cut(1, { scriptText: text, audioDuration: 7 })];
    // 7s is under the film-wide 8s ceiling but over the window's 5s one.
    expect(splitOverlongScenes(outZone, undefined, p)).toHaveLength(1);
    expect(splitOverlongScenes(inZone, undefined, p).length).toBeGreaterThan(1);
  });

  it("holds a fast-zone cutaway to the LOWER floor instead of the film-wide one", () => {
    const s = cut(1, { audioDuration: 2.2, fastOpen: true as const });
    applySceneHoldFloor(s, p);
    expect(s.audioDuration).toBe(2.2); // already clears the 2s window floor

    const t = cut(2, { audioDuration: 2.2 });
    applySceneHoldFloor(t, p);
    expect(t.audioDuration).toBe(SCENE_MIN_HOLD_SEC); // outside the window: floored to 3s
  });

  it("never lowers the HOST floor — a face that cuts at 2s reads as a glitch", () => {
    const s = host(1, { audioDuration: 2.2, fastOpen: true as const });
    applySceneHoldFloor(s, p);
    expect(s.audioDuration).toBe(HOST_MIN_HOLD_SEC);
  });

  it("does not merge a short fast-zone beat back up to the film-wide ceiling", () => {
    const scenes = [
      cut(1, {
        scriptText: "Short one.",
        audioDuration: 2.5,
        fastOpen: true as const,
      }),
      cut(2, { scriptText: "A much longer neighbour here.", audioDuration: 6 }),
    ];
    const out = coalesceShortScenes(scenes, measuredSizeFor(p));
    // 2.5s already clears the window floor of 2s, so nothing merges at all.
    expect(out).toHaveLength(2);
  });

  it("still merges a beat under even the window floor", () => {
    const scenes = [
      cut(1, {
        scriptText: "Tiny.",
        audioDuration: 1.2,
        fastOpen: true as const,
      }),
      cut(2, { scriptText: "Neighbour here.", audioDuration: 3 }),
    ];
    expect(coalesceShortScenes(scenes, measuredSizeFor(p))).toHaveLength(1);
  });

  it("leaves scenes outside the window on the film-wide band", () => {
    const long =
      "One two three four five six seven. Eight nine ten eleven twelve.";
    const s = cut(1, { scriptText: long, audioDuration: 7 });
    expect(splitOverlongScenes([s], undefined, p)).toHaveLength(1);
    expect(LONG_SCENE_MAX_SEC).toBe(8);
  });
});

describe("segmentScriptByDuration with a fast-open window", () => {
  const SCRIPT =
    "Short one. Short two. Short three. Short four. Short five. Short six. " +
    "Short seven. Short eight. Short nine. Short ten. Short eleven. Short twelve.";

  it("cuts MORE often inside the window than the standard band does", () => {
    const units = splitIntoUnits(SCRIPT);
    const flat = segmentScriptByDuration(units, SCRIPT, 2.8, 0, LEGACY_PACING);
    const fast = segmentScriptByDuration(
      units,
      SCRIPT,
      2.8,
      0,
      withPacing({
        fastOpen: {
          enabled: true,
          zoneSec: 60,
          minShotSec: 1.5,
          maxShotSec: 5,
        },
      })
    );
    expect(fast.length).toBeGreaterThan(flat.length);
  });

  it("still tiles the script exactly — no text gained or lost", () => {
    const units = splitIntoUnits(SCRIPT);
    for (const p of [
      LEGACY_PACING,
      withPacing({
        fastOpen: { enabled: true, zoneSec: 10, minShotSec: 2, maxShotSec: 5 },
      }),
    ]) {
      const chunks = segmentScriptByDuration(units, SCRIPT, 2.8, 0, p);
      expect(chunks.map(c => SCRIPT.slice(c.start, c.end)).join("")).toBe(
        SCRIPT
      );
    }
  });

  it("tiles exactly with a locked host opener AND a window", () => {
    const units = splitIntoUnits(SCRIPT);
    const chunks = segmentScriptByDuration(
      units,
      SCRIPT,
      2.8,
      2,
      withPacing({
        fastOpen: { enabled: true, zoneSec: 20, minShotSec: 2, maxShotSec: 5 },
      })
    );
    expect(chunks.map(c => SCRIPT.slice(c.start, c.end)).join("")).toBe(SCRIPT);
  });

  it("is byte-identical to the pre-config segmentation when the window is off", () => {
    const units = splitIntoUnits(SCRIPT);
    expect(
      segmentScriptByDuration(units, SCRIPT, 2.8, 1, LEGACY_PACING)
    ).toEqual(segmentScriptByDuration(units, SCRIPT, 2.8, 1));
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Assets + captions
// ─────────────────────────────────────────────────────────────────────

describe("placeAssetBeats", () => {
  const assets: LongformAsset[] = [
    { url: "https://r2/a1.jpg", caption: "Book one" },
    { url: "https://r2/a2.jpg", caption: "Book two" },
    { url: "https://r2/a3.jpg" },
  ];
  const pitch = (): StoryboardScene[] => [
    cut(1),
    host(2),
    ...Array.from({ length: 8 }, (_, i) => cut(i + 3, { cta: true })),
    host(11, { cta: true }),
    cut(12),
  ];

  it("places one asset per CTA cutaway, in script order", () => {
    const scenes = pitch();
    expect(
      placeAssetBeats(scenes, assets, {
        captions: true,
        qrImageUrl: "https://r2/qr.png",
      })
    ).toBe(3);
    const placed = scenes.filter(s => s.assetImageUrl);
    expect(placed).toHaveLength(3);
    expect(placed.map(s => s.assetImageUrl)).toEqual(assets.map(a => a.url));
    expect(placed.map(s => s.index)).toEqual(
      [...placed.map(s => s.index)].sort((a, b) => a - b)
    );
  });

  it("spreads the assets across the pitch rather than bunching them at its head", () => {
    const scenes = pitch();
    placeAssetBeats(scenes, assets, { captions: true });
    const idx = scenes.filter(s => s.assetImageUrl).map(s => s.index);
    expect(Math.max(...idx) - Math.min(...idx)).toBeGreaterThan(idx.length);
  });

  it("never claims a HOST beat — the pitch must keep its face", () => {
    const scenes = pitch();
    placeAssetBeats(scenes, assets, { captions: true });
    expect(scenes.filter(s => s.hostPresent && s.assetImageUrl)).toHaveLength(
      0
    );
    expect(scenes.find(s => s.index === 11)?.hostPresent).toBe(true);
  });

  it("never claims a QR-hero or cover-reveal beat", () => {
    const scenes = pitch();
    scenes[2].qrHero = true;
    scenes[3].coverHero = true;
    placeAssetBeats(scenes, assets, { captions: true });
    expect(scenes[2].assetImageUrl).toBeUndefined();
    expect(scenes[3].assetImageUrl).toBeUndefined();
  });

  it("never claims a beat outside the CTA window", () => {
    const scenes = pitch();
    placeAssetBeats(scenes, assets, { captions: true });
    expect(scenes[0].assetImageUrl).toBeUndefined(); // scene 1, no cta
    expect(scenes[scenes.length - 1].assetImageUrl).toBeUndefined();
  });

  it("pins the beat to the still lane and clears the motion flags", () => {
    const scenes = pitch();
    placeAssetBeats(scenes, assets, { captions: true });
    for (const s of scenes.filter(x => x.assetImageUrl)) {
      expect(s.stillImage).toBe(true);
      expect(s.hostPresent).toBe(false);
      expect(s.objectMotion).toBeUndefined();
      expect(s.humanPresent).toBeUndefined();
    }
  });

  it("carries the corner QR only when the channel has one", () => {
    const withQr = pitch();
    placeAssetBeats(withQr, assets, {
      captions: true,
      qrImageUrl: "https://r2/qr.png",
    });
    expect(withQr.filter(s => s.assetImageUrl).every(s => s.qrCorner)).toBe(
      true
    );

    const noQr = pitch();
    placeAssetBeats(noQr, assets, { captions: true });
    expect(noQr.filter(s => s.assetImageUrl).some(s => s.qrCorner)).toBe(false);
  });

  it("drops the caption when captions are switched off", () => {
    const scenes = pitch();
    placeAssetBeats(scenes, assets, { captions: false });
    expect(scenes.every(s => !s.assetCaption)).toBe(true);
  });

  it("places what fits and reports it when the pitch has too few beats", () => {
    const scenes = [cut(1, { cta: true }), host(2, { cta: true })];
    expect(placeAssetBeats(scenes, assets, { captions: true })).toBe(1);
  });

  it("is a no-op with no assets and with no CTA window", () => {
    expect(placeAssetBeats(pitch(), undefined, { captions: true })).toBe(0);
    expect(placeAssetBeats(pitch(), [], { captions: true })).toBe(0);
    expect(placeAssetBeats([cut(1), host(2)], assets, { captions: true })).toBe(
      0
    );
  });

  it("is IDEMPOTENT — a second run must not place the same uploads twice", () => {
    const scenes = pitch();
    placeAssetBeats(scenes, assets, { captions: true });
    const before = scenes.map(s => s.assetImageUrl);
    expect(placeAssetBeats(scenes, assets, { captions: true })).toBe(0);
    expect(scenes.map(s => s.assetImageUrl)).toEqual(before);
    expect(scenes.filter(s => s.assetImageUrl)).toHaveLength(assets.length);
  });

  it("survives an asset beat through the merge pass — an upload is never absorbed", () => {
    const scenes: StoryboardScene[] = [
      cut(1, {
        cta: true,
        scriptText: "Tiny.",
        audioDuration: 1,
        assetImageUrl: "https://r2/a1.jpg",
      }),
      cut(2, { cta: true, scriptText: "Neighbour.", audioDuration: 4 }),
    ];
    const out = coalesceShortScenes(scenes, measuredSizeFor(LEGACY_PACING));
    expect(out).toHaveLength(2);
    expect(out[0].assetImageUrl).toBe("https://r2/a1.jpg");
  });

  it("caps the supported upload count in one place the UI and router share", () => {
    expect(MAX_JOB_ASSETS).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// The whole sequence, as the pipeline runs it.
// ─────────────────────────────────────────────────────────────────────

describe("full balancer sequence under a dialled config", () => {
  const p = withPacing({
    visualMix: { enabled: true, hostShare: 0.35, motionShare: 0.38 },
    splitScreen: {
      enabled: true,
      hostShare: 20 / 35,
      motion: { enabled: true, share: 0.5 },
    },
  });

  const film = (): StoryboardScene[] =>
    Array.from({ length: 60 }, (_, i) =>
      i % 3 === 0
        ? host(i + 1, { brollVisual: `beside ${i}` })
        : cut(i + 1, { objectMotion: true })
    );

  it("holds the render invariant: a non-host motion beat always carries a motion flag", () => {
    const scenes = film();
    rebalanceHostScreenTime(scenes, p);
    enforceHostSplitMix(scenes, p);
    enforceStillMotionRatio(scenes, p);
    enforceVisualAdjacency(scenes, {
      hasAltHost: false,
      maxAdjacentMotion: maxAdjacentMotionFor(p),
    });
    for (const s of scenes) {
      expect(
        !!s.hostPresent ||
          !!s.stillImage ||
          !!s.humanPresent ||
          !!s.objectMotion
      ).toBe(true);
    }
  });

  it("delivers materially more motion than the legacy config on the same film", () => {
    const dialled = film();
    const legacy = film();
    for (const [scenes, cfg] of [
      [dialled, p],
      [legacy, LEGACY_PACING],
    ] as const) {
      rebalanceHostScreenTime(scenes, cfg);
      enforceHostSplitMix(scenes, cfg);
      enforceStillMotionRatio(scenes, cfg);
      enforceVisualAdjacency(scenes, {
        hasAltHost: false,
        maxAdjacentMotion: maxAdjacentMotionFor(cfg),
      });
    }
    const motionSec = (s: StoryboardScene[]) =>
      s
        .filter(x => !x.hostPresent && !x.stillImage)
        .reduce((t, x) => t + (x.audioDuration ?? 0), 0);
    expect(motionSec(dialled)).toBeGreaterThan(motionSec(legacy));
  });

  it("leaves an all-legacy run identical to the pre-config pipeline", () => {
    const a = film();
    const b = film();
    rebalanceHostScreenTime(a, LEGACY_PACING);
    enforceHostSplitMix(a, LEGACY_PACING);
    enforceStillMotionRatio(a, LEGACY_PACING);
    enforceVisualAdjacency(a, { hasAltHost: false });

    rebalanceHostScreenTime(b);
    enforceHostSplitMix(b);
    enforceStillMotionRatio(b);
    enforceVisualAdjacency(b, { hasAltHost: false });

    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Books per CTA block — one video can pitch a different book mid-roll and at the close.
// ─────────────────────────────────────────────────────────────────────

describe("per-CTA-block books", () => {
  const bookA: LongformCtaBook = {
    ctaIndex: 0,
    bookId: 11,
    title: "The Soil Handbook",
    coverImageUrl: "https://r2/cover-a.jpg",
    shopUrl: "https://shop.example/soil",
    trackingUrl: "https://shop.example/soil?ref=183",
    qrImageUrl: "https://r2/qr-a.png",
    qrVerified: true,
  };
  const bookB: LongformCtaBook = {
    ctaIndex: 1,
    bookId: 22,
    title: "The Greenhouse Guide",
    coverImageUrl: "https://r2/cover-b.jpg",
    shopUrl: "https://shop.example/greenhouse",
    trackingUrl: "https://shop.example/greenhouse?ref=183",
    qrImageUrl: "https://r2/qr-b.png",
    qrVerified: true,
  };
  const ctaBooks = [bookA, bookB];
  const params = {
    ctaBooks,
    bookCoverImageUrl: "https://r2/CHANNEL-cover.jpg",
  };

  it("resolves a beat to the book of ITS OWN block", () => {
    expect(bookForScene({ ctaIndex: 0 }, ctaBooks)?.bookId).toBe(11);
    expect(bookForScene({ ctaIndex: 1 }, ctaBooks)?.bookId).toBe(22);
  });

  it("returns nothing outside a marked block, or with no books", () => {
    expect(bookForScene({ ctaIndex: undefined }, ctaBooks)).toBeUndefined();
    expect(bookForScene({ ctaIndex: 0 }, undefined)).toBeUndefined();
    expect(bookForScene({ ctaIndex: 0 }, [])).toBeUndefined();
  });

  it("reveals a DIFFERENT cover in each block of the same video", () => {
    expect(coverImageForScene({ ctaIndex: 0 }, params)).toBe(
      bookA.coverImageUrl
    );
    expect(coverImageForScene({ ctaIndex: 1 }, params)).toBe(
      bookB.coverImageUrl
    );
  });

  it("falls back to the CHANNEL cover for an unassigned block", () => {
    expect(coverImageForScene({ ctaIndex: 7 }, params)).toBe(
      params.bookCoverImageUrl
    );
    expect(coverImageForScene({ ctaIndex: undefined }, params)).toBe(
      params.bookCoverImageUrl
    );
  });

  it("shows each block its OWN book's QR", () => {
    expect(
      qrOverlayUrlFor({ qrHero: true, ctaIndex: 0 }, "CHANNEL-QR", ctaBooks)
    ).toBe(bookA.qrImageUrl);
    expect(
      qrOverlayUrlFor({ qrCorner: true, ctaIndex: 1 }, "CHANNEL-QR", ctaBooks)
    ).toBe(bookB.qrImageUrl);
  });

  it("falls back to the channel QR when the block has no book", () => {
    expect(
      qrOverlayUrlFor({ qrHero: true, ctaIndex: 9 }, "CHANNEL-QR", ctaBooks)
    ).toBe("CHANNEL-QR");
    expect(qrOverlayUrlFor({ qrHero: true }, "CHANNEL-QR", undefined)).toBe(
      "CHANNEL-QR"
    );
  });

  it("keeps the pre-books behaviour byte-for-byte when no books are passed", () => {
    expect(qrOverlayUrlFor({ qrHero: true }, "CHANNEL-QR")).toBe("CHANNEL-QR");
    expect(qrOverlayUrlFor({ qrCorner: true }, "CHANNEL-QR")).toBe(
      "CHANNEL-QR"
    );
    expect(qrOverlayUrlFor({}, "CHANNEL-QR")).toBeUndefined();
    expect(qrOverlayUrlFor({ coverHero: true }, "CHANNEL-QR")).toBe(
      "CHANNEL-QR"
    );
    expect(qrOverlayUrlFor({ qrHero: true }, undefined)).toBeUndefined();
  });

  it("draws the block's OWN book QR over the cover reveal too", () => {
    expect(
      qrOverlayUrlFor({ coverHero: true, ctaIndex: 0 }, "CHANNEL-QR", ctaBooks)
    ).toBe(bookA.qrImageUrl);
  });

  it("a block whose book has no generated QR falls back rather than showing none", () => {
    const noQr = [{ ...bookA, qrImageUrl: undefined }];
    expect(
      qrOverlayUrlFor({ qrHero: true, ctaIndex: 0 }, "CHANNEL-QR", noQr)
    ).toBe("CHANNEL-QR");
  });
});

describe("markCtaFromSpans block numbering", () => {
  const s = (i: number, text: string): StoryboardScene => ({
    index: i,
    narration: text,
    scriptText: text,
    visualPrompt: "x",
    hostPresent: false,
    stillImage: true,
    audioDuration: 4,
  });

  it("numbers each block, so the book lookup has a key", () => {
    const scenes = [
      s(1, "one two three"),
      s(2, "four five six"),
      s(3, "seven eight nine"),
      s(4, "ten eleven twelve"),
    ];
    markCtaFromSpans(scenes, [
      { start: 3, end: 6 },
      { start: 9, end: 12 },
    ]);
    expect(scenes.map(x => x.ctaIndex)).toEqual([undefined, 0, undefined, 1]);
    expect(scenes.map(x => !!x.cta)).toEqual([false, true, false, true]);
  });

  it("leaves ctaIndex unset outside every block", () => {
    const scenes = [s(1, "one two three"), s(2, "four five six")];
    markCtaFromSpans(scenes, [{ start: 3, end: 6 }]);
    expect(scenes[0].ctaIndex).toBeUndefined();
    expect(scenes[1].ctaIndex).toBe(0);
  });

  it("is a no-op with no spans, matching the legacy heuristics path", () => {
    const scenes = [s(1, "one two three")];
    markCtaFromSpans(scenes, []);
    expect(scenes[0].ctaIndex).toBeUndefined();
    expect(scenes[0].cta).toBeUndefined();
  });
});

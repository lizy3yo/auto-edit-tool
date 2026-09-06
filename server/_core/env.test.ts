import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * `ENV` is built from `process.env` at import time, so each case sets the variables it
 * cares about, resets the module registry and imports fresh.
 */
async function loadEnv(vars: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  try {
    return (await import("./env")).ENV;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

afterEach(() => vi.resetModules());

describe("ENV.lipsyncResolution", () => {
  it("is 720p by default regardless of NODE_ENV", async () => {
    // The old rule was `isProduction ? 720p : 480p`, which silently made every local A/B of
    // the InfiniteTalk lane a softer, cheaper product than the deploy ships. A dev box and
    // production must render the same size unless someone asks otherwise.
    expect(
      (
        await loadEnv({
          LIPSYNC_RESOLUTION: undefined,
          NODE_ENV: "development",
        })
      ).lipsyncResolution
    ).toBe("720p");
    expect(
      (await loadEnv({ LIPSYNC_RESOLUTION: undefined, NODE_ENV: "production" }))
        .lipsyncResolution
    ).toBe("720p");
  });

  it("drops to 480p only when explicitly asked, in any environment", async () => {
    expect(
      (await loadEnv({ LIPSYNC_RESOLUTION: "480p", NODE_ENV: "production" }))
        .lipsyncResolution
    ).toBe("480p");
    // 1080p is SELECTABLE but not the default — it is ~2.25x the GPU seconds and off the
    // checkpoint's trained 720p, so it is opted into per render, never inherited.
    expect(
      (await loadEnv({ LIPSYNC_RESOLUTION: "1080p", NODE_ENV: "development" }))
        .lipsyncResolution
    ).toBe("1080p");
    // Junk is still not an invitation to guess — it falls back to the default.
    expect(
      (await loadEnv({ LIPSYNC_RESOLUTION: "4k", NODE_ENV: "development" }))
        .lipsyncResolution
    ).toBe("720p");
  });
});

describe("ENV pinned-camera anchor defaults", () => {
  it("defaults steps and start_step TOGETHER at the measured 75% ratio", async () => {
    // The RATIO is what was calibrated (8/2 measured at parity with the reference; 8/1
    // overshot to ~150%), so 12/3 raises refinement without touching freedom. Cost is the
    // ACTIVE count and quality is the TOTAL — 8/2 was 6 active against the last known-good
    // state's 12, and those renders came back soft, morphy and rough.
    const env = await loadEnv({
      RUNPOD_LIPSYNC_V2V_STEPS: undefined,
      RUNPOD_LIPSYNC_V2V_START_STEP: undefined,
    });
    expect(env.runpodLipsyncV2vSteps).toBe(12);
    expect(env.runpodLipsyncV2vStartStep).toBe(3);
    // 9 active steps: 1.5x the refinement of the 8/2 it replaces, same freedom.
    expect(env.runpodLipsyncV2vSteps - env.runpodLipsyncV2vStartStep).toBe(9);
    expect(env.runpodLipsyncV2vStartStep / env.runpodLipsyncV2vSteps).toBe(
      0.25
    );
  });

  it("still yields to an explicit override for experiments", async () => {
    expect(
      (await loadEnv({ RUNPOD_LIPSYNC_V2V_START_STEP: "1" }))
        .runpodLipsyncV2vStartStep
    ).toBe(1);
  });
});

describe("ENV render dials — the accepted settings are the defaults", () => {
  it("bakes the judged values so a fresh deploy renders like the accepted clip", async () => {
    const d = await loadEnv({
      RUNPOD_LIPSYNC_AUDIO_CFG: undefined,
      RUNPOD_LIPSYNC_NAG_SCALE: undefined,
      RUNPOD_LIPSYNC_MOTION_FRAME: undefined,
      RUNPOD_LIPSYNC_FETA_WEIGHT: undefined,
      RUNPOD_LIPSYNC_AUDIO_CFG_STEPS: undefined,
      RUNPOD_LIPSYNC_QUANTIZATION: undefined,
      RUNPOD_LIPSYNC_TORCH_COMPILE: undefined,
    });
    expect(d.runpodLipsyncAudioCfgScale).toBe(2.5);
    expect(d.runpodLipsyncNagScale).toBe(13);
    expect(d.runpodLipsyncMotionFrame).toBe(37);
    expect(d.runpodLipsyncFetaWeight).toBe(0);
    expect(d.runpodLipsyncAudioCfgSteps).toBe(0.5);
    expect(d.runpodLipsyncQuantization).toBe("fp8_e4m3fn");
    // The compiler is off unless asked for; the off-signal is what the worker receives.
    expect(d.runpodLipsyncTorchCompile).toBe(false);
    expect(
      (await loadEnv({ RUNPOD_LIPSYNC_TORCH_COMPILE: "1" }))
        .runpodLipsyncTorchCompile
    ).toBeUndefined();
  });
});

describe("ENV.runpodLipsyncBatch", () => {
  it("defaults to two beats per call and never drops below one", async () => {
    const d = await loadEnv({
      RUNPOD_LIPSYNC_BATCH: undefined,
      RUNPOD_LIPSYNC_BATCH_MAX_SEC: undefined,
    });
    expect(d.runpodLipsyncBatch).toBe(2);
    expect(d.runpodLipsyncBatchMaxSec).toBe(14);
    expect(
      (await loadEnv({ RUNPOD_LIPSYNC_BATCH: "0" })).runpodLipsyncBatch
    ).toBe(1);
    expect(
      (
        await loadEnv({
          RUNPOD_LIPSYNC_BATCH: "3",
          RUNPOD_LIPSYNC_BATCH_MAX_SEC: "20",
        })
      ).runpodLipsyncBatchMaxSec
    ).toBe(20);
  });
});

describe("ENV.runpodLipsyncLeadSec", () => {
  it("defaults to a 2s run-up and can be switched off", async () => {
    expect(
      (await loadEnv({ RUNPOD_LIPSYNC_LEAD_SEC: undefined }))
        .runpodLipsyncLeadSec
    ).toBe(2);
    expect(
      (await loadEnv({ RUNPOD_LIPSYNC_LEAD_SEC: "0" })).runpodLipsyncLeadSec
    ).toBe(0);
  });
});

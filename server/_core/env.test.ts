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
    // Junk is not an invitation to guess — it falls back to the default.
    expect(
      (await loadEnv({ LIPSYNC_RESOLUTION: "1080p", NODE_ENV: "development" }))
        .lipsyncResolution
    ).toBe("720p");
  });
});

describe("ENV pinned-camera anchor defaults", () => {
  it("defaults steps and start_step TOGETHER at the measured 75% ratio", async () => {
    // 8/2 measured at parity with the reference and 8/1 overshot to ~150%, so the ratio is
    // what is calibrated, not the step count. 16/4 keeps it while doubling refinement; both
    // are baked so a fresh deploy renders correctly with no variable set.
    const env = await loadEnv({
      RUNPOD_LIPSYNC_V2V_STEPS: undefined,
      RUNPOD_LIPSYNC_V2V_START_STEP: undefined,
    });
    expect(env.runpodLipsyncV2vSteps).toBe(16);
    expect(env.runpodLipsyncV2vStartStep).toBe(4);
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

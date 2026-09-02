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

describe("ENV.runpodLipsyncV2vStartStep", () => {
  it("defaults to the measured-at-parity value so no host needs a variable", async () => {
    // 8/1 overshot to ~150% of the reference's body motion, 8/2 landed on it. Baking 2 means
    // a fresh deploy renders correctly without anyone remembering to set this.
    expect(
      (await loadEnv({ RUNPOD_LIPSYNC_V2V_START_STEP: undefined }))
        .runpodLipsyncV2vStartStep
    ).toBe(2);
  });

  it("still yields to an explicit override for experiments", async () => {
    expect(
      (await loadEnv({ RUNPOD_LIPSYNC_V2V_START_STEP: "1" }))
        .runpodLipsyncV2vStartStep
    ).toBe(1);
  });
});

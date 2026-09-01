import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory app_settings. Mocked before the module under test imports it.
const settings = new Map<string, string>();
vi.mock("./db", () => ({
  getAppSetting: async (key: string) => settings.get(key) ?? null,
  setAppSetting: async (key: string, value: string) => {
    settings.set(key, value);
  },
}));

/**
 * A mutable stand-in for the frozen ENV object, so a case can vary one var and re-read.
 * `vi.mock` is hoisted above this declaration, hence the getter indirection.
 */
const env = {
  lipsyncProvider: "heygen" as "heygen" | "runpod",
  runpodLipsyncQuality: "fast" as "fast" | "full",
  runpodLipsyncInput: "image" as "image" | "video",
  runpodInfinitetalkEndpoint: "",
  runPodApiKey: "",
};
vi.mock("./_core/env", () => ({
  ENV: new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => (env as Record<string, unknown>)[prop],
  }),
}));

import {
  getLipsyncProvider,
  setLipsyncProvider,
  getLipsyncQuality,
  setLipsyncQuality,
  getLipsyncCameraMode,
  setLipsyncCameraMode,
  runpodLipsyncReadiness,
  __resetLipsyncCaches,
  LIPSYNC_PROVIDER_KEY,
  LIPSYNC_QUALITY_KEY,
  LIPSYNC_CAMERA_KEY,
} from "./lipsyncProvider";

beforeEach(() => {
  settings.clear();
  __resetLipsyncCaches();
  env.lipsyncProvider = "heygen";
  env.runpodLipsyncQuality = "fast";
  env.runpodLipsyncInput = "image";
  env.runpodInfinitetalkEndpoint = "";
  env.runPodApiKey = "";
});

describe("getLipsyncProvider", () => {
  it("defaults to the env var when nothing has ever been chosen in Admin", async () => {
    expect(await getLipsyncProvider()).toBe("heygen");

    __resetLipsyncCaches();
    env.lipsyncProvider = "runpod";
    // An existing deployment configured purely through env keeps behaving as it did.
    expect(await getLipsyncProvider()).toBe("runpod");
  });

  it("lets the stored setting override the env default in both directions", async () => {
    env.lipsyncProvider = "runpod";
    await setLipsyncProvider("heygen");
    expect(await getLipsyncProvider()).toBe("heygen");

    await setLipsyncProvider("runpod");
    expect(await getLipsyncProvider()).toBe("runpod");
    expect(settings.get(LIPSYNC_PROVIDER_KEY)).toBe("runpod");
  });

  it("falls back to the env default on an unrecognised stored value", async () => {
    settings.set(LIPSYNC_PROVIDER_KEY, "wav2lip-from-the-future");
    expect(await getLipsyncProvider()).toBe("heygen");
  });

  it("serves a cached read, so a per-scene caller costs one DB round trip", async () => {
    await setLipsyncProvider("heygen");
    // Mutating the store behind the cache proves the second read never reached it.
    settings.set(LIPSYNC_PROVIDER_KEY, "runpod");
    expect(await getLipsyncProvider()).toBe("heygen");

    __resetLipsyncCaches();
    expect(await getLipsyncProvider()).toBe("runpod");
  });
});

describe("getLipsyncQuality", () => {
  it("defaults to the env tier and is overridden by the stored one", async () => {
    expect(await getLipsyncQuality()).toBe("fast");

    await setLipsyncQuality("full");
    expect(await getLipsyncQuality()).toBe("full");
    expect(settings.get(LIPSYNC_QUALITY_KEY)).toBe("full");

    await setLipsyncQuality("fast");
    expect(await getLipsyncQuality()).toBe("fast");
  });

  it("ignores a junk stored tier rather than passing it to the worker", async () => {
    settings.set(LIPSYNC_QUALITY_KEY, "ultra");
    expect(await getLipsyncQuality()).toBe("fast");
  });
});

describe("runpodLipsyncReadiness", () => {
  it("reports which half is missing so the UI can name it", () => {
    expect(runpodLipsyncReadiness()).toEqual({
      endpointSet: false,
      keySet: false,
      ready: false,
    });

    env.runpodInfinitetalkEndpoint = "ep-1";
    expect(runpodLipsyncReadiness()).toMatchObject({
      endpointSet: true,
      keySet: false,
      ready: false,
    });

    env.runPodApiKey = "key-1";
    expect(runpodLipsyncReadiness()).toMatchObject({ ready: true });
  });
});

describe("getLipsyncCameraMode", () => {
  it("defaults to photo, follows the env default, and is overridden by the stored row", async () => {
    expect(await getLipsyncCameraMode()).toBe("photo");

    __resetLipsyncCaches();
    // RUNPOD_LIPSYNC_INPUT=video flips the never-set default to the pinned (V2V) path.
    env.runpodLipsyncInput = "video";
    expect(await getLipsyncCameraMode()).toBe("pinned");

    await setLipsyncCameraMode("photo");
    expect(await getLipsyncCameraMode()).toBe("photo");
    expect(settings.get(LIPSYNC_CAMERA_KEY)).toBe("photo");

    await setLipsyncCameraMode("pinned");
    expect(await getLipsyncCameraMode()).toBe("pinned");
  });

  it("ignores a junk stored value rather than sending it to the lane", async () => {
    settings.set(LIPSYNC_CAMERA_KEY, "handheld");
    expect(await getLipsyncCameraMode()).toBe("photo");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const getAppSetting = vi.fn();
const setAppSetting = vi.fn();
vi.mock("./db", () => ({
  getAppSetting: (...a: any[]) => getAppSetting(...a),
  setAppSetting: (...a: any[]) => setAppSetting(...a),
}));
// ffmpeg/R2 are not exercised by these tests — stub so the module imports cleanly.
vi.mock("./videoAssembly", () => ({ runFfmpeg: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));

const {
  isMockMode,
  setMockMode,
  __resetMockCache,
  mockAudioDurationSec,
  mockImage,
  MOCK_MODE_KEY,
} = await import("./mockMode");

describe("mock mode toggle", () => {
  beforeEach(() => {
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    __resetMockCache();
  });

  it("is OFF by default — an unset row must never silently disable real providers", async () => {
    getAppSetting.mockResolvedValue(null);
    expect(await isMockMode()).toBe(false);
  });

  it('is ON only for exactly "1"', async () => {
    getAppSetting.mockResolvedValue("1");
    expect(await isMockMode()).toBe(true);
    __resetMockCache();
    getAppSetting.mockResolvedValue("0");
    expect(await isMockMode()).toBe(false);
    __resetMockCache();
    // A stray value must fail CLOSED (real providers), not open.
    getAppSetting.mockResolvedValue("true");
    expect(await isMockMode()).toBe(false);
  });

  it("fails closed when the settings read throws", async () => {
    getAppSetting.mockRejectedValue(new Error("db down"));
    expect(await isMockMode()).toBe(false);
  });

  it("caches, so a 200-scene render does not hit the DB per scene", async () => {
    getAppSetting.mockResolvedValue("1");
    await isMockMode();
    await isMockMode();
    await isMockMode();
    expect(getAppSetting).toHaveBeenCalledTimes(1);
  });

  it("setMockMode writes the flag and updates the cache immediately", async () => {
    getAppSetting.mockResolvedValue(null);
    await setMockMode(true);
    expect(setAppSetting).toHaveBeenCalledWith(MOCK_MODE_KEY, "1");
    // No further DB read — the write primed the cache.
    expect(await isMockMode()).toBe(true);
    expect(getAppSetting).not.toHaveBeenCalled();
  });
});

describe("mock asset sizing", () => {
  it("sizes audio from word count at the pipeline's 2.5 words/sec", () => {
    expect(mockAudioDurationSec("one two three four five")).toBe(2);
    expect(mockAudioDurationSec("")).toBe(1); // never zero — ffmpeg rejects a 0s source
  });

  it("renders a real 16:9 PNG, and a square one on request", async () => {
    const wide = await mockImage("slow drain, grease not a blockage");
    expect(wide.mimeType).toBe("image/png");
    // PNG magic — proves sharp produced a decodable image, not an empty buffer.
    expect(wide.buffer.subarray(1, 4).toString()).toBe("PNG");

    const sharpLib = (await import("sharp")).default;
    expect((await sharpLib(wide.buffer).metadata()).width).toBe(1920);
    const square = await mockImage("panel", true);
    expect((await sharpLib(square.buffer).metadata()).width).toBe(1024);
  });

  it("escapes script text so a quote or ampersand cannot break the SVG", async () => {
    const img = await mockImage(`Roger's "fix" & <clog>`);
    expect(img.buffer.length).toBeGreaterThan(0);
  });
});

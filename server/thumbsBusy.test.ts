import { describe, expect, it, vi } from "vitest";

// A machine with almost no free memory, where every ffmpeg start waits up to three minutes.
vi.mock("node:os", async importOriginal => ({
  ...(await importOriginal<typeof import("node:os")>()),
  freemem: () => 200 * 1048576,
}));
vi.mock("./ffmpegSpawn", () => ({
  FFMPEG_MIN_FREE_MB: 1024,
  execFfmpeg: vi.fn(async () => {
    throw new Error(
      "ffmpeg must not be started for a thumbnail on a busy machine"
    );
  }),
}));
vi.mock("./storage", () => ({
  IMMUTABLE_CACHE: "x",
  presignOwnBucketUrl: async (u: string) => u,
  storageRead: async () => null,
  storagePut: async () => ({ key: "k", url: "u" }),
}));

describe("a thumbnail on a machine short of memory", () => {
  it("steps aside at once instead of waiting for memory, and is not remembered as failed", async () => {
    const { getThumb, ThumbBusyError } = await import("./thumbs");
    const { execFfmpeg } = await import("./ffmpegSpawn");
    const req = {
      url: "https://pub-x.r2.dev/longform/1/clip-1.mp4",
      w: 320 as const,
      t: 0,
    };
    const started = Date.now();
    await expect(getThumb(req)).rejects.toBeInstanceOf(ThumbBusyError);
    // The tile on Dale's 187-scene storyboard sat on its spinner for minutes (2026-10-05).
    expect(Date.now() - started).toBeLessThan(1000);
    expect(execFfmpeg).not.toHaveBeenCalled();
    // Busy is the machine's state, not the picture's: the next look tries again.
    await expect(getThumb(req)).rejects.toBeInstanceOf(ThumbBusyError);
  });
});

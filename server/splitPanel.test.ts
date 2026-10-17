import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardScene } from "@shared/types";
import { splitPanelMissing, splitPanelsMissing } from "@shared/splitPanel";
import {
  markSplitPanelMissing,
  SPLIT_COMPOSITE_MARGIN_MS,
  SPLIT_PANEL_MIN_DRAW_MS,
  splitPanelFor,
  splitPanelMissingWarning,
  splitPanelWaitMs,
  startSplitPanelDraw,
  takeSplitPanelDraw,
  type SplitPanelOutcome,
} from "./splitPanel";

const MIN = 60_000;

const split = (
  index: number,
  splitVisual: string | undefined,
  over: Partial<StoryboardScene> = {}
): StoryboardScene =>
  ({
    index,
    hostPresent: true,
    splitVisual,
    narration: "",
    visualPrompt: "",
    ...over,
  }) as StoryboardScene;

/** A draw that lands `ms` from now with `url` (or fails with `error`). */
const landsAfter = (ms: number, url: string) =>
  new Promise<string>(resolve => setTimeout(() => resolve(url), ms));
const failsAfter = (ms: number, error: string) =>
  new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error(error)), ms)
  );
const asOutcome = (p: Promise<string>): Promise<SplitPanelOutcome> =>
  p.then(
    url => ({ url }),
    e => ({ error: e as Error })
  );

describe("a split's panel waits as long as its host scene has left", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("job 400 scene 3: a panel landing at 301 s, past the old 300 s timer, is composited, not thrown away", async () => {
    // The log: the panel finished "still image OK on retry 3" after its timeout had fired.
    const still = vi.fn(() => landsAfter(1_000, "https://r2/still-3-b.mp4"));
    const result = splitPanelFor({
      started: asOutcome(landsAfter(301_000, "https://r2/still-3-a.mp4")),
      still,
      deadlineAt: Date.now() + 25 * MIN,
    });
    await vi.advanceTimersByTimeAsync(301_000);
    await expect(result).resolves.toEqual({ url: "https://r2/still-3-a.mp4" });
    expect(still).not.toHaveBeenCalled();
  });

  it("job 383 scene 26: a panel that fails twice ships the host alone, with one warning naming the scene", async () => {
    // Its panel ("Printed label on front of a smoke detector box, close-up…") failed its writing
    // check on both draws.
    const scene = split(
      26,
      "Printed label on front of a smoke detector box, close-up, resting on a surface indoors",
      {
        scriptText: "Second thing on the label. Power.",
        sceneStatus: "completed",
        hostClipUrls: ["https://r2/longform/383/clip-26-0-x.mp4"],
        clipUrls: ["https://r2/longform/383/clip-26-0-x.mp4"],
      } as Partial<StoryboardScene>
    );
    const why = "Still image has readable writing (a label)";
    const still = vi.fn(() => failsAfter(60_000, why));
    const log = vi.fn();
    const result = splitPanelFor({
      started: asOutcome(failsAfter(240_000, why)),
      still,
      deadlineAt: Date.now() + 25 * MIN,
      log,
    });
    await vi.advanceTimersByTimeAsync(300_000);
    const panel = await result;
    expect(panel).toEqual({ reason: why });
    expect(still).toHaveBeenCalledTimes(1); // one more draw, only because the first FAILED
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/drawing it once more/)
    );

    const warn = vi.fn();
    markSplitPanelMissing(scene, panel.reason!, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(
      /^Scene 26: the split screen shows the host alone/
    );
    expect(warn.mock.calls[0][0]).toContain(why);
    expect(scene.splitPanelMissing).toEqual({
      reason: why,
      at: "2026-10-18T10:05:00.000Z", // when it gave up: the second draw failed at 5 min
    });
    expect(splitPanelMissing(scene)).toBe(true);
  });

  it("a panel that fails once and comes on the second draw is used, with no warning", async () => {
    const still = vi.fn(() => landsAfter(30_000, "https://r2/still-14-b.mp4"));
    const result = splitPanelFor({
      started: asOutcome(failsAfter(10_000, "Still image generation failed")),
      still,
      deadlineAt: Date.now() + 25 * MIN,
    });
    await vi.advanceTimersByTimeAsync(40_000);
    await expect(result).resolves.toEqual({ url: "https://r2/still-14-b.mp4" });
    expect(still).toHaveBeenCalledTimes(1);
  });

  it("a panel still being drawn when the scene's time runs out is not drawn a second time", async () => {
    // Two draws side by side would only double the cost and the image lane's queue.
    const still = vi.fn(() => landsAfter(1_000, "https://r2/never.mp4"));
    const deadlineAt = Date.now() + 10 * MIN;
    const result = splitPanelFor({
      started: asOutcome(landsAfter(30 * MIN, "https://r2/too-late.mp4")),
      still,
      deadlineAt,
    });
    // It gives up when only the composite's room is left on the clock, not at the deadline.
    await vi.advanceTimersByTimeAsync(10 * MIN - SPLIT_COMPOSITE_MARGIN_MS);
    const panel = await result;
    expect(panel.url).toBeUndefined();
    expect(panel.reason).toMatch(
      /still being drawn when the scene's time ran out/
    );
    expect(still).not.toHaveBeenCalled();
  });

  it("with no draw started beside the host, one is drawn now", async () => {
    const still = vi.fn(() => landsAfter(5_000, "https://r2/still-7.mp4"));
    const result = splitPanelFor({ still, deadlineAt: Date.now() + 20 * MIN });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toEqual({ url: "https://r2/still-7.mp4" });
    expect(still).toHaveBeenCalledTimes(1);
  });

  it("a finished panel is used even when the clock has nothing left", async () => {
    const still = vi.fn(() => landsAfter(1_000, "https://r2/x.mp4"));
    const result = splitPanelFor({
      started: Promise.resolve({ url: "https://r2/done.mp4" }),
      still,
      deadlineAt: Date.now() - MIN,
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toEqual({ url: "https://r2/done.mp4" });
    expect(still).not.toHaveBeenCalled();
  });

  it("a moving panel that fails falls to the still, which may fail once: moving once, still twice", async () => {
    const moving = vi.fn(() =>
      failsAfter(
        60_000,
        "Split-screen right clip moves wrong (the cloth slides)"
      )
    );
    let n = 0;
    const still = vi.fn(() =>
      ++n === 1
        ? failsAfter(20_000, "Still image generation failed")
        : landsAfter(20_000, "https://r2/still-9.mp4")
    );
    const result = splitPanelFor({
      moving,
      still,
      deadlineAt: Date.now() + 25 * MIN,
    });
    await vi.advanceTimersByTimeAsync(100_000);
    await expect(result).resolves.toEqual({ url: "https://r2/still-9.mp4" });
    expect(moving).toHaveBeenCalledTimes(1);
    expect(still).toHaveBeenCalledTimes(2);
  });

  it("a moving panel that outlasts the scene's time is not followed by a still", async () => {
    const still = vi.fn(() => landsAfter(1_000, "https://r2/x.mp4"));
    const result = splitPanelFor({
      moving: () => landsAfter(30 * MIN, "https://r2/moving.mp4"),
      still,
      deadlineAt: Date.now() + 8 * MIN,
    });
    await vi.advanceTimersByTimeAsync(8 * MIN);
    expect((await result).reason).toMatch(/time ran out/);
    expect(still).not.toHaveBeenCalled();
  });

  it("a scene its clock already gave up on starts no panel at all — not a paid moving clip, not a still", async () => {
    // Its worker runs on with a deadline in the past; a draw started now is paid for and unseen.
    const moving = vi.fn(() => landsAfter(1_000, "https://r2/moving.mp4"));
    const still = vi.fn(() => landsAfter(1_000, "https://r2/still.mp4"));
    const panel = await splitPanelFor({
      moving,
      still,
      deadlineAt: Date.now() - MIN,
    });
    expect(panel.url).toBeUndefined();
    expect(panel.reason).toMatch(/time ran out before it could be drawn/);
    expect(moving).not.toHaveBeenCalled();
    expect(still).not.toHaveBeenCalled();
  });

  it("with no draw started and under a minute to wait, nothing is drawn; with a minute it is", async () => {
    const still = vi.fn(() => landsAfter(5_000, "https://r2/still-7.mp4"));
    const tooLittle = await splitPanelFor({
      still,
      deadlineAt:
        Date.now() + SPLIT_COMPOSITE_MARGIN_MS + SPLIT_PANEL_MIN_DRAW_MS - 1,
    });
    expect(tooLittle.reason).toMatch(/before it could be drawn/);
    expect(still).not.toHaveBeenCalled();

    const enough = splitPanelFor({
      still,
      deadlineAt:
        Date.now() + SPLIT_COMPOSITE_MARGIN_MS + SPLIT_PANEL_MIN_DRAW_MS,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(enough).resolves.toEqual({ url: "https://r2/still-7.mp4" });
    expect(still).toHaveBeenCalledTimes(1);
  });

  it("a started draw that fails with under a minute left is not drawn again, and says why it failed", async () => {
    const why = "Still image generation failed";
    const still = vi.fn(() => landsAfter(1_000, "https://r2/never.mp4"));
    const result = splitPanelFor({
      started: asOutcome(failsAfter(30_000, why)),
      still,
      deadlineAt: Date.now() + SPLIT_COMPOSITE_MARGIN_MS + 80_000,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toEqual({ reason: why });
    expect(still).not.toHaveBeenCalled();
  });

  it("a moving panel that fails with under a minute left gives its own reason and draws no still", async () => {
    const why = "Split-screen right clip moves wrong";
    const still = vi.fn(() => landsAfter(1_000, "https://r2/never.mp4"));
    const result = splitPanelFor({
      moving: () => failsAfter(2 * MIN, why),
      still,
      deadlineAt: Date.now() + SPLIT_COMPOSITE_MARGIN_MS + 2 * MIN + 30_000,
    });
    await vi.advanceTimersByTimeAsync(2 * MIN);
    await expect(result).resolves.toEqual({ reason: why });
    expect(still).not.toHaveBeenCalled();
  });

  it("the wait is the scene's time left less the composite's room, never below zero", () => {
    const now = Date.now();
    expect(splitPanelWaitMs(now + 25 * MIN, now)).toBe(22 * MIN);
    expect(splitPanelWaitMs(now + 2 * MIN, now)).toBe(0);
    expect(splitPanelWaitMs(now - MIN, now)).toBe(0);
  });
});

describe("the panel is drawn beside the host render, once", () => {
  it("one draw per scene and wording; a retried host render reuses it", async () => {
    const scene = split(
      3,
      "a finished sampler quilt folded over a wooden rocker"
    );
    const draw = vi.fn(async () => "https://r2/still-3.mp4");
    expect(startSplitPanelDraw(scene, draw)).toBe(true);
    expect(startSplitPanelDraw(scene, draw)).toBe(false);
    expect(draw).toHaveBeenCalledTimes(1);
    await expect(takeSplitPanelDraw(scene)).resolves.toEqual({
      url: "https://r2/still-3.mp4",
    });
    // Handed over once: the next render of this scene starts afresh.
    expect(takeSplitPanelDraw(scene)).toBeUndefined();
  });

  it("a draw for words the panel no longer has is dropped, never put beside the wrong line", () => {
    const scene = split(
      133,
      "fabric scraps, batting and a binding strip on a sewing table"
    );
    startSplitPanelDraw(scene, async () => "https://r2/old.mp4");
    scene.splitVisual = "a finished mug rug on the table";
    expect(takeSplitPanelDraw(scene)).toBeUndefined();
  });

  it("only a split host beat starts one", () => {
    const draw = vi.fn(async () => "https://r2/x.mp4");
    expect(startSplitPanelDraw(split(4, undefined), draw)).toBe(false);
    expect(
      startSplitPanelDraw(split(5, "a feeder", { hostPresent: false }), draw)
    ).toBe(false);
    expect(draw).not.toHaveBeenCalled();
  });

  it("a draw that fails with nobody waiting on it is held as an outcome, not thrown", async () => {
    // The host render failed: nobody takes the panel, and an unhandled rejection would stop the
    // whole process.
    const scene = split(8, "a box of scraps by the bin");
    startSplitPanelDraw(scene, async () => {
      throw new Error("Still image generation failed");
    });
    await new Promise(r => setTimeout(r, 0));
    const got = await takeSplitPanelDraw(scene);
    expect(got && "error" in got && got.error.message).toBe(
      "Still image generation failed"
    );
  });
});

describe("a split shipped as the host alone is found from its clips", () => {
  const host = "https://r2/longform/383/clip-26-0-x.mp4";
  const done = (over: Partial<StoryboardScene>) =>
    split(26, "Printed label on front of a smoke detector box, close-up", {
      sceneStatus: "completed",
      hostClipUrls: [host],
      ...over,
    });

  it("job 383 scene 26: its clip IS its host take", () => {
    expect(splitPanelMissing(done({ clipUrls: [host] }))).toBe(true);
    expect(splitPanelMissing(done({ clipUrl: host }))).toBe(true);
  });

  it("a composite, a full-frame beat, an unfinished scene or one with no host take kept is not", () => {
    expect(
      splitPanelMissing(
        done({ clipUrls: ["https://r2/longform/383/split-26-0-x.mp4"] })
      )
    ).toBe(false);
    expect(
      splitPanelMissing(done({ clipUrls: [host], splitVisual: undefined }))
    ).toBe(false);
    expect(
      splitPanelMissing(done({ clipUrls: [host], sceneStatus: "processing" }))
    ).toBe(false);
    expect(
      splitPanelMissing(done({ clipUrls: [host], hostClipUrls: undefined }))
    ).toBe(false);
  });

  it("job 226: scenes 3 and 133 are listed, its composites are not", () => {
    const take = (i: number) => `https://r2/longform/226/clip-${i}-0-a.mp4`;
    const board = [
      split(
        3,
        "A finished twelve-block sampler quilt folded over a wooden rocker",
        {
          sceneStatus: "completed",
          hostClipUrls: [take(3)],
          clipUrls: [take(3)],
        }
      ),
      split(4, "a sewing table with a rotary cutter", {
        sceneStatus: "completed",
        hostClipUrls: [take(4)],
        clipUrls: ["https://r2/longform/226/split-4-0-a.mp4"],
      }),
      split(
        133,
        "Fabric scraps, batting, and binding strip laid out on a sewing table",
        {
          sceneStatus: "completed",
          hostClipUrls: [take(133)],
          clipUrls: [take(133)],
        }
      ),
    ];
    expect(splitPanelsMissing(board)).toEqual([3, 133]);
    expect(splitPanelsMissing(null)).toEqual([]);
  });

  it("the job's warning names the scene and says how to put it right", () => {
    expect(
      splitPanelMissingWarning(
        26,
        "it was still being drawn when the scene's time ran out"
      )
    ).toBe(
      "Scene 26: the split screen shows the host alone — the picture beside the host could not " +
        "be made (it was still being drawn when the scene's time ran out). Regenerate the scene " +
        "to draw it: the host take is kept and the host is not rendered again."
    );
  });
});

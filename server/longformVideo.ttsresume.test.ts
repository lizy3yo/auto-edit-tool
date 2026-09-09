import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A TTS task that outlives the call which created it must be RESUMABLE, not orphaned.
 *
 * The id used to live in a local inside `generateSceneVoiceover`, so a segment that timed out
 * walked away from a job still running on 69Labs. 69Labs then refuses the identical resubmit with
 * 409 DUPLICATE_TTS_IN_PROGRESS for as long as the orphan sits in its queue — so every later
 * retry of that scene failed in milliseconds against a ghost of our own making, and the audio the
 * account had already been billed for was unreachable. The clip lane has persisted
 * `renderTaskIds` for exactly this reason; these are the TTS mirror's guarantees.
 */

const { createSpy, pollSpy, updateSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(),
  pollSpy: vi.fn(),
  updateSpy: vi.fn(async () => {}),
}));

vi.mock("./db", () => ({
  updateLongformVideoJob: updateSpy,
  getLongformVideoJobById: async () => null,
}));
vi.mock("./mockMode", () => ({
  isMockMode: async () => false,
  mockVoiceoverUrl: async () => "https://mock.test/vo.mp3",
}));
vi.mock("./storage", () => ({
  storagePut: async (key: string) => ({ url: `https://r2.test/${key}` }),
  presignOwnBucketUrl: async (u: string) => u,
}));
// Only the audio concat is stubbed — it would otherwise download the provider's CDN URL. The
// rest of the assembly module is real, since longformVideo imports a great deal of it.
vi.mock("./videoAssembly", async () => {
  const actual =
    await vi.importActual<typeof import("./videoAssembly")>("./videoAssembly");
  return {
    ...actual,
    concatAudio: async () => ({
      buffer: Buffer.from("fake-mp3"),
      durationSec: 2.5,
    }),
  };
});
vi.mock("./ttsUnified", async () => {
  // The error classes are real: `generateSceneVoiceover` branches on `instanceof`.
  const real =
    await vi.importActual<typeof import("./tts69labs")>("./tts69labs");
  return {
    createUnifiedTTSTask: createSpy,
    pollUnifiedTTSTask: pollSpy,
    capDeadAirPauses: async (b: Buffer) => b,
    VoiceNotFoundError: real.VoiceNotFoundError,
    DuplicateTTSError: real.DuplicateTTSError,
  };
});

import { buildSceneNarration } from "./longformVideo";
import { DuplicateTTSError } from "./tts69labs";
import type { StoryboardScene } from "@shared/types";

const scene = (over: Partial<StoryboardScene> = {}): StoryboardScene =>
  ({
    index: 1,
    scriptText: "Eight dollars of cedar.",
    ...over,
  }) as StoryboardScene;

const params: any = { ttsSpeed: 1, voiceId: "v1" };
const completed = (taskId: string) => ({
  taskId,
  status: "completed",
  audioUrl: "https://cdn.test/a.mp3",
});

/**
 * Drive a call to completion on fake timers. `generateSceneVoiceover` polls every 4s for up to
 * 5 minutes per attempt and sleeps 5s between attempts, so on a real clock these tests cost
 * ~25 seconds of wall time to assert nothing about waiting.
 */
async function settle<T>(p: Promise<T>, ms = 12 * 60 * 1000): Promise<T> {
  const done = p.then(
    v => () => v,
    e => () => {
      throw e;
    }
  );
  await vi.advanceTimersByTimeAsync(ms);
  return (await done)();
}

describe("scene narration TTS is resumable", () => {
  beforeEach(() => {
    createSpy.mockReset();
    pollSpy.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("persists the task id at submit, before the result is known", async () => {
    const s = scene();
    const seen: (string[] | undefined)[] = [];
    createSpy.mockResolvedValue("tts_job_1");
    pollSpy.mockResolvedValue(completed("tts_job_1"));

    await settle(
      buildSceneNarration(7, "sixtynine_labs", "k", s, params, () =>
        seen.push(s.ttsTaskIds ? [...s.ttsTaskIds] : undefined)
      )
    );

    // First write is the id, and it lands before any poll — a crash, a timeout or a killed pass
    // at any point after the submit still leaves a resumable id on the row.
    expect(seen[0]).toEqual(["tts_job_1"]);
    expect(seen.at(-1)).toBeUndefined(); // cleared once collected
    expect(s.ttsTaskIds).toBeUndefined();
  });

  it("keeps the id when the poll times out — the job is still running and still billed", async () => {
    const s = scene();
    createSpy.mockResolvedValue("tts_job_1");
    pollSpy.mockResolvedValue({ taskId: "tts_job_1", status: "processing" });

    const settled = buildSceneNarration(
      7,
      "sixtynine_labs",
      "k",
      s,
      params
    ).catch(e => e as Error);
    // Two 5-minute polling windows plus the 5s gap between attempts.
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

    expect(await settled).toBeInstanceOf(Error);
    expect(s.ttsTaskIds).toEqual(["tts_job_1"]);
    expect(createSpy).toHaveBeenCalledTimes(1); // never resubmitted — that is the 409
  });

  it("resumes a persisted id instead of submitting again", async () => {
    const s = scene({ ttsTaskIds: ["tts_job_1"] });
    pollSpy.mockResolvedValue(completed("tts_job_1"));

    const out = await settle(
      buildSceneNarration(7, "sixtynine_labs", "k", s, params)
    );

    expect(createSpy).not.toHaveBeenCalled(); // no second submit, no 409, no second charge
    expect(out.url).toContain("https://r2.test/longform/7/scene-1-vo-");
    expect(s.ttsTaskIds).toBeUndefined(); // collected — nothing left to resume
  });

  it("adopts the job a duplicate names rather than failing on audio already billed", async () => {
    const s = scene();
    createSpy.mockRejectedValue(
      new DuplicateTTSError("duplicate", "tts_running_9")
    );
    pollSpy.mockResolvedValue(completed("tts_running_9"));

    const out = await settle(
      buildSceneNarration(7, "sixtynine_labs", "k", s, params)
    );

    expect(pollSpy).toHaveBeenCalledWith(
      "sixtynine_labs",
      "k",
      "tts_running_9",
      undefined
    );
    expect(out.url).toContain("scene-1-vo-");
  });

  it("forgets an id the provider reports as failed, so the next attempt submits fresh", async () => {
    const s = scene({ ttsTaskIds: ["tts_dead"] });
    createSpy.mockResolvedValue("tts_fresh");
    pollSpy
      .mockResolvedValueOnce({
        taskId: "tts_dead",
        status: "failed",
        error: "TTS failed",
      })
      .mockResolvedValue(completed("tts_fresh"));

    const out = await settle(
      buildSceneNarration(7, "sixtynine_labs", "k", s, params)
    );

    // A failed job never completes on resume — re-polling it forever is the one case where
    // holding the id is worse than paying for a new one.
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(out.url).toContain("scene-1-vo-");
    expect(s.ttsTaskIds).toBeUndefined();
  });
});

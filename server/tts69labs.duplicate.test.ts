import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The 409 cooldown is a real ~45s wait in production (a TTS job has to FINISH before the submit
// can be accepted); shrink it so the retry path runs in real time here. The submit bucket is
// widened for the same reason as the outage suite: five attempts on one key must not be paced
// by the token refill.
process.env.SIXTYNINE_TTS_409_COOLDOWN_MS = "1";
process.env.SIXTYNINE_TTS_SUBMIT_BURST = "8";
// A 409 also zeroes that key's token bucket (every concurrent worker must back off together), so
// the refill rate has to be lifted too or each retry waits out a real 3s token.
process.env.SIXTYNINE_TTS_SUBMIT_RATE = "6000";

const duplicate = (body: string) =>
  new Response(body, {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
const okTask = (id: string) =>
  new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const params = {
  text: "Hello",
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  modelId: "eleven_multilingual_v2",
};

describe("parseDuplicateTaskId", () => {
  it("reads the blocking job id out of the common body shapes", async () => {
    const { parseDuplicateTaskId } = await import("./tts69labs");
    expect(parseDuplicateTaskId('{"taskId":"tts_abc123"}')).toBe("tts_abc123");
    expect(parseDuplicateTaskId('{"jobId":"tts_abc123"}')).toBe("tts_abc123");
    expect(parseDuplicateTaskId('{"error":{"id":"tts_abc123"}}')).toBe(
      "tts_abc123"
    );
    expect(parseDuplicateTaskId('{"data":{"jobId":"tts_abc123"}}')).toBe(
      "tts_abc123"
    );
  });

  it("finds a UUID quoted in prose", async () => {
    const { parseDuplicateTaskId } = await import("./tts69labs");
    expect(
      parseDuplicateTaskId(
        "A TTS job (5f8d0a12-3b4c-4d5e-8f90-1a2b3c4d5e6f) is already in progress"
      )
    ).toBe("5f8d0a12-3b4c-4d5e-8f90-1a2b3c4d5e6f");
  });

  // The failure that matters: adopting a non-id sends the caller off to poll something that
  // does not exist, instead of waiting the real duplicate out.
  it("never adopts the error code or prose as a task id", async () => {
    const { parseDuplicateTaskId } = await import("./tts69labs");
    expect(parseDuplicateTaskId('{"error":"DUPLICATE_TTS_IN_PROGRESS"}')).toBe(
      undefined
    );
    expect(parseDuplicateTaskId("DUPLICATE_TTS_IN_PROGRESS")).toBe(undefined);
    expect(
      parseDuplicateTaskId(
        '{"code":"DUPLICATE_TTS_IN_PROGRESS","message":"A matching generation is already running"}'
      )
    ).toBe(undefined);
  });
});

describe("69Labs TTS duplicate (409) handling", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // The wedge this whole change exists to undo: a 409 used to throw on sight, so every retry of
  // an affected scene failed in milliseconds against a job we ourselves had orphaned.
  it("waits a duplicate out and succeeds when the blocking job finishes", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");
    const responses = [
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS"}'),
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS"}'),
      okTask("job-after-duplicate"),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    globalThis.fetch = fetchMock as any;

    await expect(createTTSTask69Labs("vk_dup_key_1", params)).resolves.toBe(
      "job-after-duplicate"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up as a DuplicateTTSError, naming no task, once the budget is spent", async () => {
    const { createTTSTask69Labs, DuplicateTTSError } =
      await import("./tts69labs");
    globalThis.fetch = vi.fn(async () =>
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS"}')
    ) as any;

    const err = await createTTSTask69Labs("vk_dup_key_2", params).catch(
      e => e as Error
    );
    expect(err).toBeInstanceOf(DuplicateTTSError);
    expect((err as InstanceType<typeof DuplicateTTSError>).taskId).toBe(
      undefined
    );
    expect((err as Error).message).toContain("DUPLICATE_TTS_IN_PROGRESS");
  });

  // Waiting a duplicate out is right for ONE orphan. It is wrong for an account full of them:
  // the wait is per submit, so a retry across 200 unvoiced scenes spends minutes each to learn
  // the identical fact — hours of it, with nothing on screen but "Failed".
  it("fails the next scene instantly once the account is known jammed", async () => {
    const { createTTSTask69Labs, DuplicateTTSError } =
      await import("./tts69labs");
    const fetchMock = vi.fn(async () =>
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS"}')
    );
    globalThis.fetch = fetchMock as any;

    // Scene one spends the whole budget discovering it.
    await createTTSTask69Labs("vk_jam_key", params).catch(e => e);
    const spent = fetchMock.mock.calls.length;
    expect(spent).toBeGreaterThan(1);

    // Scene two asks nothing and is told the same thing.
    const err = await createTTSTask69Labs("vk_jam_key", {
      ...params,
      text: "A different scene entirely.",
    }).catch(e => e as Error);
    expect(err).toBeInstanceOf(DuplicateTTSError);
    expect((err as Error).message).toContain("DUPLICATE_TTS_IN_PROGRESS");
    expect(fetchMock).toHaveBeenCalledTimes(spent); // no further API calls at all
  });

  // The note must not outlive the condition it describes — a jam that drains on 69Labs' side
  // has to be noticed by the next scene, not short-circuited for the rest of the run.
  it("lets the key through again once the note lapses", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");
    const responses = [
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS"}'),
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS"}'),
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS"}'),
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS"}'),
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS"}'),
      okTask("job-once-drained"),
    ];
    globalThis.fetch = vi.fn(async () => responses.shift()!) as any;

    await createTTSTask69Labs("vk_drain_key", params).catch(e => e);

    // Only Date is faked — `sleep` inside the submit loop must keep real timers, or the retry
    // path never resolves. Forward only: winding the clock BACK starves the key's token bucket,
    // which sizes its wait from the elapsed time since the last refill.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000); // well past the note's TTL
    try {
      await expect(createTTSTask69Labs("vk_drain_key", params)).resolves.toBe(
        "job-once-drained"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // A named job is a recovery, not a failure: it is almost always one of ours, and the account
  // has already been billed for it.
  it("surfaces the blocking task id so the caller can adopt it", async () => {
    const { createTTSTask69Labs, DuplicateTTSError } =
      await import("./tts69labs");
    const fetchMock = vi.fn(async () =>
      duplicate('{"error":"DUPLICATE_TTS_IN_PROGRESS","jobId":"tts_running_9"}')
    );
    globalThis.fetch = fetchMock as any;

    const err = await createTTSTask69Labs("vk_dup_key_3", params).catch(
      e => e as Error
    );
    expect(err).toBeInstanceOf(DuplicateTTSError);
    expect((err as InstanceType<typeof DuplicateTTSError>).taskId).toBe(
      "tts_running_9"
    );
    // Adopting costs a poll, not a submit — so it must not burn the retry budget first.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

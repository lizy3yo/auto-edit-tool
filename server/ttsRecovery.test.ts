import { describe, it, expect, vi } from "vitest";
import type { TtsWaitState } from "@shared/types";
import {
  classifyNarrationFailure,
  diedBeforeNarration,
  NarrationFailedError,
  planNarrationFailure,
  runTtsWait,
  TTS_WAIT_CHECK_MS,
  TTS_WAIT_MAX_MS,
  TTS_WAIT_MAX_REVOICES,
  VOICE_STUCK_CHECKS,
  wakeTtsWaiter,
  type ProbeResult,
  type TtsWaitDeps,
} from "./ttsRecovery";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const named = (name: string, message: string) =>
  Object.assign(new Error(message), { name });
const wait = (over: Partial<TtsWaitState> = {}): TtsWaitState => ({
  since: new Date(NOW).toISOString(),
  revoices: 0,
  lastError: "TTS failed",
  vendor: "69Labs",
  ...over,
});

describe("classifyNarrationFailure", () => {
  it("waits out an outage, a timeout and an unexplained FAILED", () => {
    for (const msg of [
      "69Labs marked the voice-over as failed without giving a reason",
      "TTS generation failed",
      "TTS timed out",
      "69Labs TTS is unavailable (521) after 4 attempts — the provider's server is down",
      "69Labs TTS task creation rate-limited (429) after 4 attempts",
      "fetch failed (ECONNRESET)",
    ]) {
      expect(classifyNarrationFailure(new Error(msg))).toEqual({
        kind: "wait",
      });
    }
    // A duplicate jam clears by itself too.
    expect(
      classifyNarrationFailure(
        named("DuplicateTTSError", "69Labs TTS job already in progress")
      )
    ).toEqual({ kind: "wait" });
  });

  it("stops at once on what waiting cannot fix", () => {
    expect(
      classifyNarrationFailure(named("VoiceNotFoundError", "not found"))
    ).toEqual({ kind: "stop", reason: "voice" });
    expect(
      classifyNarrationFailure(
        new Error(
          'Narration failed: 69Labs rejected voice ID "abc" — not found.'
        )
      )
    ).toEqual({ kind: "stop", reason: "voice" });
    expect(
      classifyNarrationFailure(
        new Error("TTS credits depleted on 69Labs. Check your dashboard.")
      )
    ).toEqual({ kind: "stop", reason: "credits" });
    expect(
      classifyNarrationFailure(named("CensoredTTSError", "blocked"))
    ).toEqual({ kind: "stop", reason: "censored" });
    expect(
      classifyNarrationFailure(
        new Error("69Labs TTS task creation failed (401): Unauthorized")
      )
    ).toEqual({ kind: "stop", reason: "auth" });
    expect(
      classifyNarrationFailure(
        new Error(
          "This render is set to voice on MiniMax, but no MiniMax API key is configured"
        )
      )
    ).toEqual({ kind: "stop", reason: "config" });
  });
});

describe("planNarrationFailure", () => {
  it("starts a wait on the first failure", () => {
    const plan = planNarrationFailure({
      cause: new Error("TTS generation failed"),
      vendor: "69Labs",
      now: NOW,
    });
    expect(plan).toEqual({
      action: "wait",
      wait: {
        since: new Date(NOW).toISOString(),
        revoices: 0,
        lastError: "TTS generation failed",
        vendor: "69Labs",
      },
    });
  });

  it("fails with what to fix when waiting will not help", () => {
    const plan = planNarrationFailure({
      cause: named("VoiceNotFoundError", "voice gone"),
      vendor: "69Labs",
      now: NOW,
    });
    expect(plan.action).toBe("fail");
    if (plan.action === "fail") {
      expect(plan.message).toContain("Admin → Channels");
      expect(plan.message).toContain("voice gone");
    }
  });

  it("keeps the original start time when a re-voicing fails again", () => {
    const prior = wait({ revoices: 1 });
    const plan = planNarrationFailure({
      prior,
      cause: new Error("TTS timed out"),
      vendor: "69Labs",
      now: NOW + 30 * 60_000,
    });
    expect(plan).toEqual({
      action: "wait",
      wait: { ...prior, lastError: "TTS timed out" },
    });
  });

  it("gives up once the wait has run out", () => {
    const plan = planNarrationFailure({
      prior: wait(),
      cause: new Error("TTS timed out"),
      vendor: "69Labs",
      now: NOW + TTS_WAIT_MAX_MS,
    });
    expect(plan.action).toBe("fail");
    if (plan.action === "fail") {
      expect(plan.message).toContain("still wasn't working");
      expect(plan.message).toContain("Try voicing again");
    }
  });

  it("gives up after the last automatic re-voicing fails", () => {
    const plan = planNarrationFailure({
      prior: wait({ revoices: TTS_WAIT_MAX_REVOICES }),
      cause: new Error("TTS timed out"),
      vendor: "69Labs",
      now: NOW + 60_000,
    });
    expect(plan.action).toBe("fail");
  });

  it("reads the cause through the pipeline's wrapper", () => {
    const err = new NarrationFailedError(
      named("VoiceNotFoundError", "voice gone"),
      "69Labs"
    );
    const plan = planNarrationFailure({
      cause: (err as { cause?: unknown }).cause,
      vendor: err.vendor,
      now: NOW,
    });
    expect(plan.action).toBe("fail");
  });
});

describe("diedBeforeNarration", () => {
  const job = (over: Record<string, unknown> = {}) => ({
    status: "failed",
    masterAudioUrl: null,
    storyboard: [{ index: 1 }, { index: 2 }],
    ...over,
  });

  it("is true for a failed render with nothing voiced or rendered", () => {
    expect(diedBeforeNarration(job())).toBe(true);
    expect(diedBeforeNarration(job({ storyboard: [] }))).toBe(true);
  });

  it("is false once anything downstream of voicing exists, or while running", () => {
    expect(diedBeforeNarration(job({ masterAudioUrl: "m.mp3" }))).toBe(false);
    expect(
      diedBeforeNarration(
        job({ storyboard: [{ index: 1, audioUrl: "a.mp3" }] })
      )
    ).toBe(false);
    expect(
      diedBeforeNarration(job({ storyboard: [{ index: 1, clipUrl: "c.mp4" }] }))
    ).toBe(false);
    expect(diedBeforeNarration(job({ status: "processing" }))).toBe(false);
  });
});

describe("runTtsWait", () => {
  /** Deps on a fake clock: every sleep advances it by exactly the time asked for. */
  function fakeDeps(probes: ProbeResult[], over: Partial<TtsWaitDeps> = {}) {
    let clock = NOW;
    const calls = {
      probes: 0,
      reports: [] as string[],
      revoiced: [] as TtsWaitState[],
      failed: [] as string[],
    };
    const deps: TtsWaitDeps = {
      now: () => clock,
      sleep: async ms => {
        clock += ms;
      },
      stillWaiting: async () => true,
      probe: async () => probes[Math.min(calls.probes++, probes.length - 1)],
      report: label => void calls.reports.push(label),
      save: async () => {},
      revoice: async w => void calls.revoiced.push(w),
      fail: async m => void calls.failed.push(m),
      ...over,
    };
    return { deps, calls, clock: () => clock };
  }
  const down: ProbeResult = { ok: false, error: "TTS failed" };

  it("re-voices as soon as the voice check passes", async () => {
    const { deps, calls, clock } = fakeDeps([down, down, { ok: true }]);
    await runTtsWait(1, wait(), deps);
    expect(calls.probes).toBe(3);
    expect(calls.revoiced).toEqual([{ ...wait(), revoices: 1 }]);
    expect(calls.failed).toEqual([]);
    // The first check runs at once, then one per interval.
    expect(clock()).toBe(NOW + 2 * TTS_WAIT_CHECK_MS);
    expect(calls.reports[0]).toMatch(/^Waiting for 69Labs/);
  });

  it("stops at once when the check says the voice is gone", async () => {
    const { deps, calls } = fakeDeps([
      { ok: false, error: "voice not found", name: "VoiceNotFoundError" },
    ]);
    await runTtsWait(2, wait(), deps);
    expect(calls.revoiced).toEqual([]);
    expect(calls.failed).toHaveLength(1);
    expect(calls.failed[0]).toContain("Admin → Channels");
  });

  it("gives up when the wait runs out, after one last check", async () => {
    const { deps, calls, clock } = fakeDeps([down]);
    await runTtsWait(3, wait(), deps);
    expect(calls.revoiced).toEqual([]);
    expect(calls.failed).toHaveLength(1);
    expect(calls.failed[0]).toContain("still wasn't working");
    expect(clock()).toBe(NOW + TTS_WAIT_MAX_MS);
    expect(calls.probes).toBe(
      Math.ceil(TTS_WAIT_MAX_MS / TTS_WAIT_CHECK_MS) + 1
    );
  });

  it("stops early when only this voice fails and other voices work", async () => {
    const stuck: ProbeResult = {
      ok: false,
      error: "This job failed to complete. Please try again.",
      othersWork: true,
    };
    const { deps, calls, clock } = fakeDeps([stuck]);
    await runTtsWait(9, wait(), deps);
    expect(calls.probes).toBe(VOICE_STUCK_CHECKS);
    expect(calls.revoiced).toEqual([]);
    expect(calls.failed).toHaveLength(1);
    expect(calls.failed[0]).toContain("Admin → Channels");
    expect(calls.failed[0]).toContain("not with this channel's voice");
    // Minutes, not the two-hour wait.
    expect(clock()).toBe(NOW + (VOICE_STUCK_CHECKS - 1) * TTS_WAIT_CHECK_MS);
  });

  it("does not blame the voice when the comparison fails too, or only once", async () => {
    const stuck: ProbeResult = { ok: false, error: "x", othersWork: true };
    const outage: ProbeResult = { ok: false, error: "x", othersWork: false };
    const { deps, calls } = fakeDeps([stuck, outage, stuck, { ok: true }]);
    await runTtsWait(10, wait(), deps);
    expect(calls.failed).toEqual([]);
    expect(calls.revoiced).toHaveLength(1);
  });

  it("does nothing more once the job was cancelled", async () => {
    const { deps, calls } = fakeDeps([{ ok: true }], {
      stillWaiting: async () => false,
    });
    await runTtsWait(4, wait(), deps);
    expect(calls.probes).toBe(0);
    expect(calls.revoiced).toEqual([]);
    expect(calls.failed).toEqual([]);
  });

  it("refuses another re-voicing once they are used up", async () => {
    const { deps, calls } = fakeDeps([{ ok: true }]);
    await runTtsWait(5, wait({ revoices: TTS_WAIT_MAX_REVOICES }), deps);
    expect(calls.revoiced).toEqual([]);
    expect(calls.failed).toHaveLength(1);
  });

  it("checks right away when woken, instead of at the next interval", async () => {
    let clock = NOW;
    const probe = vi.fn(async (): Promise<ProbeResult> => ({ ok: true }));
    const revoice = vi.fn(async () => {});
    const run = runTtsWait(6, wait(), {
      now: () => clock,
      sleep: () => new Promise(() => {}), // never elapses by itself
      stillWaiting: async () => true,
      probe,
      report: () => {},
      save: async () => {},
      revoice,
      fail: async () => {},
    });
    expect(wakeTtsWaiter(6)).toBe(true);
    await run;
    expect(probe).toHaveBeenCalledTimes(1);
    expect(revoice).toHaveBeenCalledTimes(1);
    expect(wakeTtsWaiter(6)).toBe(false); // the loop is gone
    expect(clock).toBe(NOW);
  });

  it("frees the job before re-voicing, so a failed re-voicing can wait again", async () => {
    const second = fakeDeps([down, { ok: true }]);
    const first = fakeDeps([{ ok: true }], {
      // What the pipeline does when the re-voicing fails too: it starts a new wait.
      revoice: w => runTtsWait(7, w, second.deps),
    });
    await runTtsWait(7, wait(), first.deps);
    expect(second.calls.probes).toBe(2);
    expect(second.calls.revoiced).toEqual([{ ...wait(), revoices: 2 }]);
  });

  it("runs one loop per job", async () => {
    const a = fakeDeps([{ ok: true }], { sleep: () => new Promise(() => {}) });
    const b = fakeDeps([{ ok: true }]);
    const run = runTtsWait(8, wait(), a.deps);
    await runTtsWait(8, wait(), b.deps);
    expect(b.calls.probes).toBe(0);
    wakeTtsWaiter(8);
    await run;
    expect(a.calls.revoiced).toHaveLength(1);
  });
});

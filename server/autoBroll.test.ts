import { describe, expect, it } from "vitest";
import { planAutoBroll, hostFailToBrollEnabled } from "./longformVideo";
import type { StoryboardScene } from "../shared/types";

const hostBeat = (): StoryboardScene => ({
  index: 144,
  narration: "Warm gold belongs with blonde, honey, and brunette.",
  visualPrompt: "the seated host talks",
  hostPresent: true,
  lipsynced: true,
  hostShot: 1,
  audioUrl: "https://cdn.example.com/scene-144-vo.mp3",
  audioDuration: 6.2,
  narrationStartSec: 731.2,
  narrationEndSec: 737.4,
  sceneStatus: "failed",
  error: "Clip: heygen render failure (Invalid audio stream detected)",
  submits: [
    { provider: "heygen", at: "2026-09-22T10:00:00.000Z", reason: "first" },
    { provider: "heygen", at: "2026-09-22T10:05:00.000Z", reason: "infra" },
    { provider: "heygen", at: "2026-09-22T10:10:00.000Z", reason: "infra" },
  ],
});

describe("planAutoBroll — a host beat the lip-sync lane gave up on becomes a cutaway", () => {
  it("is on unless HOST_FAIL_TO_BROLL=0", () => {
    expect(hostFailToBrollEnabled()).toBe(true);
  });

  it("demotes the beat exactly as 'Make b-roll' does and records why", () => {
    const s = hostBeat();
    expect(planAutoBroll(s, "Invalid audio stream detected", true)).toBe(true);
    // A cutaway now: no host, a still, narration untouched (the film stays on the overlay path).
    expect(s.hostPresent).toBe(false);
    expect(s.stillImage).toBe(true);
    expect(s.lipsynced).toBe(false);
    expect(s.hostShot).toBeUndefined();
    expect(s.audioUrl).toBe("https://cdn.example.com/scene-144-vo.mp3");
    expect(s.narrationStartSec).toBe(731.2);
    expect(s.narrationEndSec).toBe(737.4);
    // The trace the card and the warning read from — with the attempt count in it.
    expect(s.autoBroll?.reason).toBe(
      "host render failed after 3 attempts: Invalid audio stream detected"
    );
    expect(s.autoBroll?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(s.error).toBeUndefined();
    // The ledger is history, not state: it survives so the cost dialog still adds up.
    expect(s.submits).toHaveLength(3);
  });

  it("leaves a b-roll scene alone — the Ken Burns fallback is that lane's own", () => {
    const s = { ...hostBeat(), hostPresent: false, lipsynced: false };
    expect(planAutoBroll(s, "grok failed", true)).toBe(false);
    expect(s.autoBroll).toBeUndefined();
    expect(s.hostPresent).toBe(false);
  });

  it("does nothing when the switch is off, so the old 'Failed' card comes back", () => {
    const s = hostBeat();
    expect(planAutoBroll(s, "Invalid audio stream detected", false)).toBe(
      false
    );
    expect(s.hostPresent).toBe(true);
    expect(s.autoBroll).toBeUndefined();
    expect(s.error).toContain("Invalid audio stream");
  });

  it("converts a split too — the whole beat goes full-frame b-roll, not just the right panel", () => {
    const s = {
      ...hostBeat(),
      splitVisual: "a ceramic dish of earrings",
      splitRightUrl: "https://cdn.example.com/split-right.mp4",
      hostClipUrls: ["https://cdn.example.com/host.mp4"],
    };
    expect(planAutoBroll(s, "HeyGen video not found (404)", true)).toBe(true);
    expect(s.splitVisual).toBeUndefined();
    expect(s.splitRightUrl).toBeUndefined();
    expect(s.hostClipUrls).toBeUndefined();
    expect(s.hostPresent).toBe(false);
  });
});

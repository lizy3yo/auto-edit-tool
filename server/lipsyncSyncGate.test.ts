import { describe, it, expect, vi } from "vitest";

vi.mock("./ffmpegPath", () => ({ getFFmpegPath: () => "ffmpeg" }));
vi.mock("./_core/voiceTranscription", () => ({
  transcribeWordsFromBuffer: vi.fn(),
}));

import {
  decide,
  wordsForChunk,
  TARGET_LAG_MS,
  SHIFT_DEADBAND_MS,
  TRACK_FLOOR_R,
} from "./lipsyncSyncGate";
import type { JudgeResult } from "./lipsyncJudge";

const judge = (over: Partial<JudgeResult>): JudgeResult => ({
  peakR: 0.4,
  lagMs: -40,
  farR: 0.08,
  soundsPct: 0.8,
  closure: 0.05,
  range: 0.1,
  frames: 150,
  words: 20,
  wordsSource: "scene",
  ...over,
});

describe("decide (the sync gate's table)", () => {
  const both = (lag: number, envLag = lag) =>
    judge({ peakR: 0.4, farR: 0.08, lagMs: lag, env: { peakR: 0.4, farR: 0.1, lagMs: envLag } });

  it("ships a clip that tracks the words at the natural lead", () => {
    const d = decide(both(-40));
    expect(d.action).toBe("ship");
    expect(d.shiftMs).toBe(0);
  });

  it("leaves a peak within the deadband alone — a frame at 25 fps is 40 ms", () => {
    expect(decide(both(TARGET_LAG_MS + SHIFT_DEADBAND_MS - 1)).action).toBe("ship");
    expect(decide(both(TARGET_LAG_MS - SHIFT_DEADBAND_MS + 1)).action).toBe("ship");
  });

  it("shifts only when BOTH witnesses are confident and agree — earlier when the mouth is late", () => {
    const d = decide(both(400, 360));
    expect(d.action).toBe("shift");
    expect(d.shiftMs).toBe(420); // mean 380, target -40
  });

  it("shifts later when both say the mouth runs well ahead", () => {
    expect(decide(both(-240, -200)).action).toBe("shift");
    expect(decide(both(-240, -200)).shiftMs).toBe(-180);
  });

  it("does NOT move a frame when the witnesses disagree, or when only one is confident", () => {
    // Measured: phonetic +208 ms, envelope -417 ms on the same clip.
    expect(decide(both(208, -417)).action).toBe("ship");
    // One witness weak.
    expect(
      decide(judge({ peakR: 0.4, farR: 0.08, lagMs: 400, env: { peakR: 0.2, farR: 0.12, lagMs: 380 } })).action
    ).toBe("ship");
    // No envelope witness at all: never shift on the phonetic track alone.
    expect(decide(judge({ peakR: 0.5, farR: 0.05, lagMs: 400 })).action).toBe("ship");
  });

  it("asks for a fresh seed when the phonetic track is at chance and the envelope does not track", () => {
    // The dead mouth (new_clip1): phonetic r 0.02 vs 0.12, envelope r 0.19 vs 0.11 — the
    // envelope is above the floor but not above its own far level by the margin.
    expect(
      decide(judge({ peakR: 0.02, farR: 0.12, lagMs: -583, env: { peakR: 0.19, farR: 0.11, lagMs: -583 } })).action
    ).toBe("retry");
    // The envelope tracking on its own is enough to ship.
    expect(
      decide(judge({ peakR: 0.06, farR: 0.22, lagMs: 480, env: { peakR: 0.35, farR: 0.1, lagMs: -40 } })).action
    ).toBe("ship");
    expect(TRACK_FLOOR_R).toBeGreaterThan(0.1);
  });

  it("does NOT retry a clip whose peak clears the floor but not the noisy far level", () => {
    // Measured, both ship fine by eye: v2_static r 0.27 vs 0.20 at 83% of sounds; m0_stab
    // (whole-photo mode, the softer mouth) r 0.22 vs 0.13.
    expect(decide(judge({ peakR: 0.27, farR: 0.2, lagMs: -42, env: { peakR: 0.13, farR: 0.19, lagMs: 500 } })).action).toBe("ship");
    expect(decide(judge({ peakR: 0.22, farR: 0.13, lagMs: -83, env: { peakR: 0.18, farR: 0.11, lagMs: 292 } })).action).toBe("ship");
  });

  it("treats a peak on the edge of the scan as no sync for that witness", () => {
    expect(decide(judge({ peakR: 0.4, farR: 0.08, lagMs: 600, env: { peakR: 0.4, farR: 0.1, lagMs: -600 } })).action).toBe("retry");
  });

  it("ships as rendered when it could not judge — never blocks a render on its own failure", () => {
    expect(decide(judge({ frames: 0 })).action).toBe("ship");
    expect(decide(judge({ words: 0 })).action).toBe("ship");
  });
});

describe("wordsForChunk", () => {
  const words = [
    { word: "one", start: 0.2, end: 0.6 },
    { word: "two", start: 5.8, end: 6.4 },
    { word: "three", start: 6.5, end: 7.0 },
  ];

  it("re-bases a chunk's words to its own start and clips the straddler", () => {
    const w = wordsForChunk(words, 6.0, 4.0)!;
    expect(w.map(x => x.word)).toEqual(["two", "three"]);
    expect(w[0].start).toBe(0); // straddled the chunk start
    expect(w[0].end).toBeCloseTo(0.4);
    expect(w[1].start).toBeCloseTo(0.5);
  });

  it("returns null with no saved words, so the gate transcribes instead", () => {
    expect(wordsForChunk(undefined, 0, 6)).toBeNull();
    expect(wordsForChunk([], 0, 6)).toBeNull();
  });
});

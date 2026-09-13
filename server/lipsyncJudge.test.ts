import { describe, it, expect, vi } from "vitest";

vi.mock("./ffmpegPath", () => ({ getFFmpegPath: () => "ffmpeg" }));
vi.mock("./_core/voiceTranscription", () => ({
  transcribeWordsFromBuffer: vi.fn(),
}));

import {
  predictedTrack,
  lagScan,
  phonesOf,
  PHONE_OPEN,
  FPS,
  type Word,
  type Frame,
} from "./lipsyncJudge";

const words: Word[] = [
  { word: "That", start: 0.2, end: 0.5 },
  { word: "coffee", start: 0.55, end: 1.0 },
  { word: "can", start: 1.05, end: 1.3 },
  { word: "of", start: 1.35, end: 1.45 },
  { word: "blanket", start: 1.6, end: 2.1 },
  { word: "money", start: 2.2, end: 2.7 },
  { word: "problem", start: 2.9, end: 3.4 },
  { word: "before", start: 3.5, end: 3.9 },
];

describe("phonesOf", () => {
  it("reads the dictionary and falls back to spelling classes", () => {
    expect(phonesOf("blanket")).toEqual(["B", "L", "AE", "NG", "K", "AH", "T"]);
    expect(phonesOf("xqzzv")).not.toHaveLength(0);
  });
});

describe("lagScan on a synthetic mouth", () => {
  const n = Math.round(4.2 * FPS);
  const pred = predictedTrack(words, n, PHONE_OPEN, 0);

  const mouth = (shiftFrames: number): Frame[] =>
    Array.from({ length: n }, (_, i) => {
      const j = i - shiftFrames;
      const open = j >= 0 && j < n ? pred[j] : 0;
      return { open, aspect: 1, width: 0.5 };
    });

  it("finds a mouth that says the words on time, with a sharp peak at lag 0", () => {
    const s = lagScan(
      pred,
      mouth(0).map(f => f.open)
    );
    expect(s.peakLagMs).toBe(0);
    expect(s.peakR).toBeGreaterThan(0.9);
    expect(s.farR).toBeLessThan(0.5);
  });

  it("measures a mouth that is LATE by 10 frames as +400 ms", () => {
    const s = lagScan(
      pred,
      mouth(10).map(f => f.open)
    );
    expect(s.peakLagMs).toBe(400);
    expect(s.peakR).toBeGreaterThan(0.9);
  });

  it("measures a mouth that is EARLY by 2 frames as -80 ms", () => {
    const s = lagScan(
      pred,
      mouth(-2).map(f => f.open)
    );
    expect(s.peakLagMs).toBe(-80);
  });

  it("scores a mouth that merely flaps as noise: no peak above the far level", () => {
    let seed = 7;
    const rnd = () =>
      (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const flap = Array.from({ length: n }, () => rnd());
    const s = lagScan(pred, flap);
    expect(s.peakR - s.farR).toBeLessThan(0.3);
  });
});

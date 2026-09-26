import { describe, it, expect } from "vitest";
import {
  auditStoryboardTimeline,
  clockTime,
  describeIssue,
  healTranscriptHoles,
  mergePatchedWords,
  patchSpans,
 planTranscriptPieces,
  transcribeInPieces,
} from "./alignmentHeal";
import type { WhisperWord } from "./_core/voiceTranscription";
import type { StoryboardScene } from "../shared/types";

const w = (word: string, start: number, end: number): WhisperWord => ({
  word,
  start,
  end,
});

/** `n` ten-word scenes at a steady 3.3 s each, every one carrying its master range. */
function board(n: number): StoryboardScene[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    narration: "",
    scriptText: Array.from({ length: 10 }, (_, k) => `w${i}x${k}`).join(" "),
    visualPrompt: "",
    hostPresent: false,
    narrationStartSec: i * 3.3,
    narrationEndSec: (i + 1) * 3.3,
  }));
}

describe("mergePatchedWords", () => {
  it("replaces the words inside the span and offsets the patch onto the master clock", () => {
    const words = [w("a", 0, 1), w("stray", 12, 12.2), w("z", 30, 31)];
    const patch = [w("b", 1, 2), w("c", 5, 6)];
    const out = mergePatchedWords(words, patch, 10, 20);
    expect(out.map(x => x.word)).toEqual(["a", "b", "c", "z"]);
    expect(out[1].start).toBe(11);
    expect(out[2].end).toBe(16);
  });

  it("keeps a word straddling an edge exactly once", () => {
    // Original word's midpoint is outside the span → kept; the patch's copy of it is outside
    // too (midpoint 9.9 on the master clock) → dropped.
    const words = [w("edge", 9.6, 10.2)];
    const patch = [w("edge", -0.4, 0.2), w("next", 0.5, 0.9)];
    const out = mergePatchedWords(words, patch, 10, 20);
    expect(out.map(x => x.word)).toEqual(["edge", "next"]);
  });
});

describe("patchSpans", () => {
  it("pads, clamps to the master and folds overlapping runs together", () => {
    const spans = patchSpans(
      [
        { fromScene: 0, toScene: 1, startSec: 0.2, endSec: 10 },
        { fromScene: 2, toScene: 3, startSec: 10.5, endSec: 20 },
        { fromScene: 9, toScene: 9, startSec: 95, endSec: 99.8 },
      ],
      100
    );
    expect(spans).toEqual([
      { fromSec: 0, toSec: 21 },
      { fromSec: 94, toSec: 100 },
    ]);
  });
});

describe("healTranscriptHoles", () => {
  const run = { fromScene: 3, toScene: 9, startSec: 100, endSec: 160 };
  const base = [w("before", 90, 90.5), w("after", 170, 170.5)];
  const slice = async () => Buffer.alloc(0);

  it("splices a successful re-transcription into the hole", async () => {
    const heard = Array.from({ length: 120 }, (_, i) =>
      w(`p${i}`, 1 + i * 0.5, 1.3 + i * 0.5)
    );
    const out = await healTranscriptHoles({
      monoAudio: Buffer.alloc(0),
      words: base,
      runs: [run],
      masterDurationSec: 200,
      slice,
      transcribe: async () => ({ words: heard, duration: 62 }),
    });
    expect(out.patched).toBe(1);
    expect(out.words[0].word).toBe("before");
    expect(out.words[out.words.length - 1].word).toBe("after");
    expect(out.words[1].start).toBeCloseTo(100, 5); // 99 (span start) + 1
    expect(out.words.length).toBe(122);
  });

  it("keeps the original when the second try hears nothing either, or fails", async () => {
    for (const transcribe of [
      async () => ({ words: [w("uh", 1, 1.2)], duration: 62 }),
      async () => ({ error: "down", code: "SERVICE_ERROR" as const }),
      async () => {
        throw new Error("boom");
      },
    ]) {
      const out = await healTranscriptHoles({
        monoAudio: Buffer.alloc(0),
        words: base,
        runs: [run],
        masterDurationSec: 200,
        slice,
        transcribe: transcribe as any,
      });
      expect(out.patched).toBe(0);
      expect(out.words).toBe(base);
    }
  });
});

describe("auditStoryboardTimeline", () => {
  it("passes a healthy film", () => {
    expect(auditStoryboardTimeline(board(30))).toEqual([]);
  });

  it("names the collapsed stretch and the scene that swallowed it — job 94's shape", () => {
    const scenes = board(30);
    // Scenes 21–27 collapse at 66 s; scene 28 runs 66 → 92.4 (its own 3.3 s + their 23.1 s).
    for (let i = 20; i <= 26; i++) {
      scenes[i].narrationStartSec = 66;
      scenes[i].narrationEndSec = 66;
    }
    scenes[27].narrationStartSec = 66;
    const issues = auditStoryboardTimeline(scenes);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ fromIndex: 21, toIndex: 28 });
    expect(issues[0].startSec).toBeCloseTo(66, 5);
    expect(issues[0].endSec).toBeCloseTo(92.4, 5);
    expect(describeIssue(issues[0])).toBe("scenes 21–28 (1:06–1:32)");
  });

  it("does not second-guess a length the operator set in the cut room", () => {
    const scenes = board(30);
    scenes[10].timingOriginal = {
      narrationStartSec: 33,
      narrationEndSec: 36.3,
    } as StoryboardScene["timingOriginal"];
    scenes[10].narrationEndSec = 33.4; // ripple-trimmed to 0.4 s, on purpose
    expect(auditStoryboardTimeline(scenes)).toEqual([]);
  });

  it("has nothing to say about a film voiced scene by scene (no master ranges)", () => {
    const scenes = board(30);
    scenes[4].narrationStartSec = undefined;
    scenes[4].narrationEndSec = undefined;
    expect(auditStoryboardTimeline(scenes)).toEqual([]);
  });
});

describe("clockTime", () => {
  it("reads like the player's own clock", () => {
    expect(clockTime(563.2)).toBe("9:23");
    expect(clockTime(59.6)).toBe("1:00");
    expect(clockTime(-3)).toBe("0:00");
  });
});

describe("transcribing a long narration in pieces", () => {
  it("covers the narration exactly once, each join shared by two overlapping pieces", () => {
    const pieces = planTranscriptPieces(1540.9);
    expect(pieces.length).toBe(4);
    expect(pieces[0].fromSec).toBe(0);
    expect(pieces[pieces.length - 1].toSec).toBeCloseTo(1540.9);
    for (let k = 1; k < pieces.length; k++) {
      expect(pieces[k].fromSec).toBeLessThan(pieces[k - 1].toSec); // overlap
      expect(pieces[k].ownFrom).toBeCloseTo(pieces[k - 1].ownTo); // owned ranges tile
    }
    expect(planTranscriptPieces(300)).toEqual([{ fromSec: 0, toSec: 300, ownFrom: 0, ownTo: 300 }]);
  });

  it("stitches the pieces onto the narration's clock, keeping each word once", async () => {
    // A fake narration: one word every second for 1000 s.
    const truth = (from: number, len: number) =>
      Array.from({ length: Math.floor(len) }, (_, i) => ({
        word: `w${Math.round(from) + i}`,
        start: i + 0.1,
        end: i + 0.6,
      }));
    const r = await transcribeInPieces({
      monoAudio: Buffer.alloc(1),
      durationSec: 1000,
      slice: async (_a: Buffer, from: number, len: number) =>
        Buffer.from(JSON.stringify([from, len])),
      transcribe: (async (b: Buffer) => {
        const [from, len] = JSON.parse(b.toString());
        return { words: truth(from, len), duration: len };
      }) as any,
    });
    expect("error" in r).toBe(false);
    const words = (r as any).words as { word: string; start: number }[];
    expect(words.length).toBe(1000);
    expect(new Set(words.map(w => w.word)).size).toBe(1000);
    expect(words[500].word).toBe("w500");
    expect(words[500].start).toBeCloseTo(500.1);
  });

  it("leaves a hole for the repair when one piece keeps failing, and errors only when all do", async () => {
    let calls = 0;
    const r = await transcribeInPieces({
      monoAudio: Buffer.alloc(1),
      durationSec: 1000,
      slice: async (_a: Buffer, from: number, len: number) =>
        Buffer.from(JSON.stringify([from, len])),
      transcribe: (async (b: Buffer) => {
        calls++;
        const [from, len] = JSON.parse(b.toString());
        if (from === 0) return { error: "CUDA failed with error out of memory", code: "TRANSCRIPTION_FAILED" };
        return { words: [{ word: "x", start: 1, end: 1.5 }], duration: len };
      }) as any,
    });
    expect("error" in r).toBe(false);
    expect(calls).toBeGreaterThan(planTranscriptPieces(1000).length); // the failing piece was retried
    const none = await transcribeInPieces({
      monoAudio: Buffer.alloc(1),
      durationSec: 1000,
      slice: async () => Buffer.alloc(1),
      transcribe: (async () => ({ error: "down", code: "SERVICE_ERROR" })) as any,
    });
    expect("error" in none).toBe(true);
  });
});

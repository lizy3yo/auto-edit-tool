import { describe, it, expect } from "vitest";
import { masterOverlayEligible, planTimelineRepair } from "./longformVideo";
import { auditStoryboardTimeline } from "./alignmentHeal";
import type { WhisperWord } from "./_core/voiceTranscription";
import type { StoryboardScene } from "../shared/types";

/**
 * A rendered film of `n` ten-word scenes read at a steady 3 words/sec, plus the full, correct
 * transcript of its master. Every scene carries its true range, a clip and an audio slice.
 */
function renderedFilm(n: number) {
  const scenes: StoryboardScene[] = [];
  const words: WhisperWord[] = [];
  let t = 0;
  for (let s = 0; s < n; s++) {
    const start = t;
    const toks: string[] = [];
    for (let k = 0; k < 10; k++) {
      const tok = `w${s}x${k}`;
      toks.push(tok);
      words.push({ word: tok, start: t, end: t + 0.3 });
      t += 1 / 3;
    }
    scenes.push({
      index: s + 1,
      narration: "",
      scriptText: toks.join(" "),
      visualPrompt: "",
      hostPresent: false,
      narrationStartSec: start,
      narrationEndSec: t,
      audioUrl: `vo-${s}`,
      clipUrls: [`clip-${s}`],
    });
  }
  return { scenes, words, dur: t };
}

/** Job 94's damage: scenes `from..to-1` collapse where `from` began, scene `to` owns the gap. */
function breakTimeline(scenes: StoryboardScene[], from: number, to: number) {
  const at = scenes[from].narrationStartSec as number;
  for (let i = from; i < to; i++) {
    scenes[i].narrationStartSec = at;
    scenes[i].narrationEndSec = at;
  }
  scenes[to].narrationStartSec = at;
}

describe("planTimelineRepair", () => {
  it("re-times only the broken stretch and hands every other scene back untouched", () => {
    const { scenes, words, dur } = renderedFilm(40);
    breakTimeline(scenes, 24, 35);
    const snapshot = scenes.map(s => ({ ...s }));
    const issues = auditStoryboardTimeline(scenes);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ fromIndex: 25, toIndex: 36 });

    const plan = planTimelineRepair({
      stored: scenes,
      issues,
      words,
      masterDurationSec: dur,
    });
    expect(plan.unrepairable).toHaveLength(0);
    expect(plan.movedScenes.map(s => s.index)).toEqual([
      25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
    ]);
    // Untouched scenes are the ORIGINAL objects, range and clip exactly as stored.
    plan.scenes.forEach((s, i) => {
      if (plan.movedScenes.includes(s)) return;
      expect(s).toBe(scenes[i]);
      expect(s.narrationStartSec).toBe(snapshot[i].narrationStartSec);
      expect(s.narrationEndSec).toBe(snapshot[i].narrationEndSec);
      expect(s.clipUrls).toEqual(snapshot[i].clipUrls);
    });
    // Every moved scene is back to its real ~3.3 s, and the whole film still tiles exactly.
    for (const s of plan.movedScenes) {
      const len =
        (s.narrationEndSec as number) - (s.narrationStartSec as number);
      expect(len).toBeGreaterThan(3);
      expect(len).toBeLessThan(3.7);
    }
    for (let i = 1; i < plan.scenes.length; i++)
      expect(plan.scenes[i].narrationStartSec).toBe(
        plan.scenes[i - 1].narrationEndSec
      );
    expect(masterOverlayEligible(plan.scenes, "master.mp3")).toBe(true);
    expect(auditStoryboardTimeline(plan.scenes)).toEqual([]);
  });

  it("refuses, changing nothing, when the narration itself does not match the script", () => {
    const { scenes, words, dur } = renderedFilm(40);
    // The master really does hold five extra minutes after scene 20 that no scene's words cover.
    const shifted = words.map(w =>
      w.start >= (scenes[20].narrationStartSec as number)
        ? { ...w, start: w.start + 300, end: w.end + 300 }
        : w
    );
    for (let i = 20; i < 40; i++) {
      scenes[i].narrationStartSec =
        (scenes[i].narrationStartSec as number) + 300;
      scenes[i].narrationEndSec = (scenes[i].narrationEndSec as number) + 300;
    }
    scenes[19].narrationEndSec = scenes[20].narrationStartSec;
    const issues = auditStoryboardTimeline(scenes);
    expect(issues.length).toBeGreaterThan(0);
    const plan = planTimelineRepair({
      stored: scenes,
      issues,
      words: shifted,
      masterDurationSec: dur + 300,
    });
    expect(plan.unrepairable.length).toBeGreaterThan(0);
    expect(plan.movedScenes).toHaveLength(0);
    expect(plan.scenes).toBe(scenes);
  });
});

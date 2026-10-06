import { describe, expect, it } from "vitest";
import { applyTake, currentTake, recordRegeneratedTake } from "./hostTakes";
import type { StoryboardScene } from "./types";
import {
  activeVoiceTakeIndex,
  currentVoice,
  recordRedoneVoice,
  selectVoiceTake,
  voiceRedoRefusal,
  voiceTakeLabel,
} from "./voiceTakes";

const scene = (over: Partial<StoryboardScene> = {}): StoryboardScene =>
  ({
    index: 4,
    narration: "a line",
    visualPrompt: "a picture",
    audioUrl: "old.mp3",
    audioDuration: 4,
    narrationStartSec: 10,
    narrationEndSec: 14,
    ...over,
  }) as StoryboardScene;

const hank = { id: 2, name: "Hank" };

describe("voice takes", () => {
  it("keeps the old voice beside the new one, with the new one playing", () => {
    const s = scene();
    const before = currentVoice(s, "original");
    s.audioUrl = "new.mp3";
    s.audioDuration = 4.3;
    s.narrationStartSec = undefined;
    s.narrationEndSec = undefined;
    recordRedoneVoice(s, before, hank);
    expect(s.voiceTakes?.map(t => t.audioUrl)).toEqual(["old.mp3", "new.mp3"]);
    expect(activeVoiceTakeIndex(s)).toBe(1);
    expect(voiceTakeLabel(s.voiceTakes![0], 0)).toBe("Voice 1 (original)");
    expect(voiceTakeLabel(s.voiceTakes![1], 1)).toBe("Voice 2 (redone by Hank)");
  });

  it("switching back restores the old file, its length and its place in the master", () => {
    const s = scene();
    const before = currentVoice(s, "original");
    s.audioUrl = "new.mp3";
    s.audioDuration = 4.3;
    s.narrationStartSec = undefined;
    s.narrationEndSec = undefined;
    recordRedoneVoice(s, before);
    expect(selectVoiceTake(s, 0)).toEqual({ ok: true, changed: true });
    expect(s).toMatchObject({
      audioUrl: "old.mp3",
      audioDuration: 4,
      narrationStartSec: 10,
      narrationEndSec: 14,
      activeVoiceTake: 0,
    });
    // Forward again: the redone take has no slice of the master.
    expect(selectVoiceTake(s, 1)).toEqual({ ok: true, changed: true });
    expect(s.audioUrl).toBe("new.mp3");
    expect(s.narrationStartSec).toBeUndefined();
  });

  it("a second redo adds a third take and never repeats one", () => {
    const s = scene();
    let before = currentVoice(s, "original");
    s.audioUrl = "new1.mp3";
    recordRedoneVoice(s, before);
    before = currentVoice(s, "redo");
    s.audioUrl = "new2.mp3";
    recordRedoneVoice(s, before);
    recordRedoneVoice(s, before);
    expect(s.voiceTakes?.map(t => t.audioUrl)).toEqual([
      "old.mp3",
      "new1.mp3",
      "new2.mp3",
    ]);
    expect(activeVoiceTakeIndex(s)).toBe(2);
  });

  it("refuses a take that does not exist, a scene never redone, and a host scene", () => {
    expect(selectVoiceTake(scene(), 0).ok).toBe(false);
    const s = scene();
    const before = currentVoice(s, "original");
    s.audioUrl = "new.mp3";
    recordRedoneVoice(s, before);
    expect(selectVoiceTake(s, 5).ok).toBe(false);
    expect(selectVoiceTake(s, 1)).toEqual({ ok: true, changed: false });
    s.hostPresent = true;
    expect(selectVoiceTake(s, 0).ok).toBe(false);
  });
});

describe("who may redo a scene's voice", () => {
  const video = { suppliedNarration: false };
  const cutaway = { hostPresent: false };
  const host = { hostPresent: true };
  const split = { hostPresent: true, splitVisual: "a still" };

  it("anyone may redo a cutaway", () => {
    for (const role of ["admin", "manager", "editor"] as const)
      expect(voiceRedoRefusal(cutaway, video, role)).toBeNull();
  });

  it("a host scene is admins and operations managers only", () => {
    expect(voiceRedoRefusal(host, video, "admin")).toBeNull();
    expect(voiceRedoRefusal(host, video, "manager")).toBeNull();
    expect(voiceRedoRefusal(host, video, "editor")).toMatch(/admin/);
  });

  it("a split screen follows the host rule, and a supplied narration is refused for everyone", () => {
    expect(voiceRedoRefusal(split, video, "admin")).toBeNull();
    expect(voiceRedoRefusal(split, video, "editor")).toMatch(/admin/);
    expect(
      voiceRedoRefusal(cutaway, { suppliedNarration: true }, "admin")
    ).toMatch(/narration file/);
  });
});

describe("a host take and its voice switch together", () => {
  const hostScene = () =>
    scene({ hostPresent: true, clipUrls: ["old.mp4"], clipUrl: "old.mp4" });

  it("a beat whose voice was never redone records no voice on its takes", () => {
    const s = hostScene();
    expect(currentTake(s, "original")?.voice).toBeUndefined();
  });

  it("a failed render puts the old shot AND the old voice back", () => {
    const s = hostScene();
    const voiceBefore = currentVoice(s, "original")!;
    s.voiceTakes = [voiceBefore];
    const takeBefore = currentTake(s, "original")!;
    expect(takeBefore.voice?.audioUrl).toBe("old.mp3");
    // The redo replaced the voice, then the host render did not come through.
    s.audioUrl = "new.mp3";
    s.narrationStartSec = undefined;
    s.narrationEndSec = undefined;
    applyTake(s, takeBefore);
    expect(s).toMatchObject({
      clipUrl: "old.mp4",
      audioUrl: "old.mp3",
      narrationStartSec: 10,
      narrationEndSec: 14,
    });
  });

  it("each take of a redone beat carries the voice it was lip-synced to", () => {
    const s = hostScene();
    s.voiceTakes = [currentVoice(s, "original")!];
    const takeBefore = currentTake(s, "original")!;
    s.audioUrl = "new.mp3";
    s.clipUrls = ["new.mp4"];
    s.clipUrl = "new.mp4";
    recordRegeneratedTake(s, takeBefore, hank);
    expect(s.hostTakes?.map(t => t.voice?.audioUrl)).toEqual([
      "old.mp3",
      "new.mp3",
    ]);
    applyTake(s, s.hostTakes![0]);
    expect(s.audioUrl).toBe("old.mp3");
    applyTake(s, s.hostTakes![1]);
    expect(s.audioUrl).toBe("new.mp3");
  });
});

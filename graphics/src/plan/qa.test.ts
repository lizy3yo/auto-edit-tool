import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_HOLD_MAX_SEC, CARD_HOLD_SILENT_MAX_SEC, MAX_LINGER_SEC, holdToCut, resolveCues, stillUpAfterWords, type CueSpec, type ResolvedCue, type Word } from "../cueResolve";
import { TEMPLATES, templateById } from "../registry";
import { judgeFilm } from "./qa";

const FPS = 30;
/** Words said one after another, 0.3 s apart. */
const W = (s: string, start: number, step = 0.3): Word[] => s.split(" ").map((text, i) => ({ text, start: +(start + i * step).toFixed(3), end: +(start + i * step + 0.26).toFixed(3) }));
/** A placed graphic by its frames, with nothing else for the other checks to find. */
const placed = (id: string, template: string, startFrame: number, endFrame: number) =>
  ({ id, template, start: startFrame / FPS, end: endFrame / FPS, startFrame, endFrame, props: { durationSec: (endFrame - startFrame) / FPS }, sync: [], conformed: { start: false, end: false } }) as ResolvedCue;
/** QA over a still film (no cuts, no flashes): only the graphics' own lengths can fail it. */
const judge = (cues: ResolvedCue[]) => {
  const still = new Array(4400).fill(0);
  return judgeFilm({ fps: FPS, cues, filmDiffs: still, reelDiffs: still, rules: [], readability: [] });
};

describe("QA reports a graphic up too short to read (Dale's job 397 stored 'pass' with 1.27 s and 1.40 s)", () => {
  it("Dale's '3 piles', frames 1446-1484 (48.20-49.47 s), fails", () => {
    const qa = judge([placed("three-piles", "BigNumberOverlay", 1446, 1484)]);
    expect(qa.pass).toBe(false);
    expect(qa.lines).toContain("Shorter than 1.5 s: 1");
    expect(qa.failures).toEqual(["up too short to read (under 1.5 s): three-piles (1.27 s)"]);
  });

  it("a title and an approved graphic are reported too: his saved 1.4 s chapter label", () => {
    const qa = judge([placed("chapter-3-ad-fee", "ChapterLabel", 4067, 4109)]);
    expect(qa.failures).toEqual(["up too short to read (under 1.5 s): chapter-3-ad-fee (1.40 s)"]);
  });

  it("1.5 s exactly passes, and so does one frame under it (edges rounded onto the frame grid); two frames under fails", () => {
    expect(judge([placed("exact", "BigNumberOverlay", 1446, 1491)]).pass).toBe(true);
    expect(judge([placed("frame-short", "BigNumberOverlay", 1446, 1490)]).pass).toBe(true);
    expect(judge([placed("two-short", "BigNumberOverlay", 1446, 1489)]).failures).toEqual(["up too short to read (under 1.5 s): two-short (1.43 s)"]);
    const ok = judge([placed("chapter-1-sort", "ChapterLabel", 1234, 1369), placed("smalls-list", "ListWindow", 1591, 1682)]);
    expect(ok.pass).toBe(true);
    expect(ok.lines).toContain("Shorter than 1.5 s: 0");
  });
});

describe("QA judges a graphic still up after its words by the resolver's own rules (job 400's '7 thieves', 1:35-1:41)", () => {
  // The stored plan of job 400, the word times its resolver used and the film's picture cuts. The
  // "7 thieves" card (BigNumber, a full-frame card) was placed 95.30-100.63 and left on the cut, in
  // the silence after "…name all seven of the thieves." — and QA failed the film: it measured from
  // "seven" (98.94), the card's last word, with the 1.2 s a caption gets.
  const job = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "job400-graphics.json"), "utf8")) as {
    plan: CueSpec[];
    words: Word[];
    cutFrames: number[];
    placed: { id: string; start: number; end: number }[];
  };
  const opts = (cuts: number[]) => ({
    cuts,
    fps: FPS,
    structural: new Set(TEMPLATES.filter(t => t.structural).map(t => t.id)),
    cards: new Set(TEMPLATES.filter(t => t.kind === "card").map(t => t.id)),
    fullFrame: new Set(TEMPLATES.filter(t => t.kind === "card" || t.underlay === "window").map(t => t.id)),
  });
  const cuts = job.cutFrames.map(f => f / FPS);
  const cues = resolveCues(job.plan, job.words, opts(cuts));
  const thieves = cues.find(c => c.id === "seven-thieves")!;

  it("is placed where the film had it, its end on the cut — not by the hold: its end fell inside the stretched 'thieves.'", () => {
    expect([thieves.start, thieves.end]).toEqual([95.3, 100.633]);
    expect(job.placed.find(p => p.id === "seven-thieves")).toMatchObject({ start: 95.3, end: 100.633 });
    expect(thieves.conformed).toEqual({ start: false, end: true });
    const said = job.words.find(w => w.text === "thieves.")!;
    expect([said.start, said.end]).toEqual([99.244, 100.905]); // stretched over the pause (sound: 99.8-100.65)
    expect(thieves.contentEnd).toBe(98.944);
    // the old copy of the rules: 1.69 s past its last word, over the 1.2 s a caption gets
    expect(thieves.end - thieves.contentEnd!).toBeGreaterThan(MAX_LINGER_SEC);
  });

  it("is measured from where its own sentence finished, and the hold covers the cut it leaves on (silence: 3.5 s)", () => {
    expect(thieves.spokenEnd).toBe(100.905);
    expect(thieves.hold).toEqual({ cut: 100.633, max: CARD_HOLD_SILENT_MAX_SEC });
    expect(stillUpAfterWords(thieves, FPS)).toBe(false);
    const qa = judge(cues);
    expect(qa.lines).toContain("Still up after their words: 0");
    expect(qa.failures.filter(f => f.startsWith("still up"))).toEqual([]);
  });

  it("nothing the resolver places on job 400 is failed, whatever the cuts", () => {
    const layouts = [[], cuts, cuts.filter((_, i) => i % 2 === 0), ...[-0.4, -0.2, 0.2, 0.4].map(d => cuts.map(c => Math.round((c + d) * FPS) / FPS))];
    for (const layout of layouts) {
      const placedOn = resolveCues(job.plan, job.words, opts(layout));
      expect(placedOn.filter(c => !templateById(c.template).structural && stillUpAfterWords(c, FPS)).map(c => c.id)).toEqual([]);
    }
  });

  it("a card kept past the cut its hold covers is still failed (2 s into '2,000 years ago, a man named…')", () => {
    const kept = { ...thieves, end: 103.0, endFrame: 3090 };
    expect(stillUpAfterWords(kept, FPS)).toBe(true);
    expect(judge([kept]).failures).toContain("still up after its words: seven-thieves");
  });

  it("a caption left over the next sentence is still failed (job 384: 'It isn't dead.' stayed into 'It just happens to be slow')", () => {
    const words = W("It isn't broken. It isn't dead. It just happens to be slow at waking up.", 10);
    const [c] = resolveCues([{ id: "not-dead", template: "DimCaption", start: "It isn't broken.", props: { phrase: { text: "It isn't broken. It isn't dead.", words: true } } }], words);
    expect(stillUpAfterWords(c, FPS)).toBe(false);
    const dead = words.find(w => w.text === "dead.")!;
    expect(c.spokenEnd).toBe(dead.end);
    const stale = { ...c, end: dead.end + 4.7, endFrame: Math.round((dead.end + 4.7) * FPS) };
    expect(stillUpAfterWords(stale, FPS)).toBe(true);
  });
});

describe("the hold to the cut is one test, with the resolver's limits (holdToCut)", () => {
  // Dale's "$10 in fees" (job 397): "…off a $100 board." ends 141.18, nothing said until the cut at 143.37.
  const dale: Word[] = [
    { text: "roughly", start: 140.0, end: 140.32 }, { text: "$10", start: 140.34, end: 140.62 }, { text: "off", start: 140.64, end: 140.72 },
    { text: "a", start: 140.74, end: 140.76 }, { text: "$100", start: 140.78, end: 140.94 }, { text: "board.", start: 141.0, end: 141.18 },
    { text: "But", start: 143.56, end: 143.79 },
  ];
  it("through silence a card may stay 3.5 s after its sentence finished, no longer", () => {
    expect(holdToCut(dale, 140.62, 141.9, 143.37)).toEqual({ ok: true, spoken: 141.18, max: CARD_HOLD_SILENT_MAX_SEC });
    expect(holdToCut(dale, 140.62, 141.9, 141.18 + CARD_HOLD_SILENT_MAX_SEC + 0.1).ok).toBe(false);
  });
  it("when something more is said before the cut, 2 s (the old QA allowed every held card 3.5 s)", () => {
    const talk = dale.map(w => (w.text === "But" ? { ...w, start: 143.1, end: 143.3 } : w));
    expect(holdToCut(talk, 140.62, 141.9, 143.37)).toMatchObject({ ok: false, max: CARD_HOLD_MAX_SEC });
    expect(holdToCut(talk, 140.62, 141.9, 143.15)).toMatchObject({ ok: true, max: CARD_HOLD_MAX_SEC });
  });
  it("never over a new line begun well before the cut; the rest of its own sentence may finish under it", () => {
    const words = [...W("Match the length to the neckline, and hold the piece up near your face.", 185.5), ...W("Then wear it often.", 190.6)];
    const face = words.find(w => w.text === "face.")!;
    expect(holdToCut(words, face.end, face.end + 0.4, 191.9).ok).toBe(false);
    const own = W("hold the piece up near your face by a window.", 185.5);
    expect(holdToCut(own, own.find(w => w.text === "face")!.end, own.find(w => w.text === "face")!.end + 0.3, 189).spoken).toBe(own.at(-1)!.end);
  });
});

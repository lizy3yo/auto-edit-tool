import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../registry";
import type { ResolvedCue } from "../cueResolve";
import { DEFAULT_SPLIT_HOST_PANEL, DIM_GAP_SEC, MIN_GAP_SEC, checkRules, hostPanelFor, nameTagRange, overHostTake, placementFor, underNameTag, type FilmLayout, type LayoutScene } from "./rules";

/**
 * A caption on a split stays in the host's panel. Gideon's job 400 at 2:18 (scene 27, host left, a
 * blank scroll right): "When a man like that sits down to write about time, I pull my chair in
 * closer." was drawn for the full frame, and its dark box ran across the seam — half over the host,
 * half over the scroll. The lab's composite set the panel; the app's finishing step did not.
 */

// Job 400's scenes around its two host captions, as the film has them (seconds on the film).
const scene = (index: number, start: number, end: number, over: Partial<LayoutScene> = {}): LayoutScene => ({ index, narrationStartSec: start, narrationEndSec: end, ...over });
const film: FilmLayout = {
  scenes: [
    scene(1, 0, 2.5, { hostPresent: true, hostOpener: true }),
    scene(2, 2.5, 12.88),
    // A split whose picture never came: the film plays the host take full frame (no `split`).
    scene(3, 12.88, 17.32, { hostPresent: true }),
    scene(4, 17.32, 25.13),
    scene(26, 130.97, 138.19),
    scene(27, 138.19, 144.12, { hostPresent: true, split: true, hostPanel: { x: 0, w: 840 } }),
    scene(28, 144.12, 151.76),
  ],
};

describe("hostPanelFor — a caption over a split stays beside the host", () => {
  it("400 host-chair-closer (138.20-143.13 s over split scene 27) takes the host's panel", () => {
    expect(hostPanelFor({ start: 138.2, end: 143.133 }, film)).toEqual({ x: 0, w: 840 });
  });

  it("400 host-sixty-four (15.27-17.33 s) sits on a full-frame host take — no panel", () => {
    expect(hostPanelFor({ start: 15.267, end: 17.333 }, film)).toBeUndefined();
  });

  it("over b-roll or a full host take, no panel", () => {
    expect(hostPanelFor({ start: 0.4, end: 2.4 }, film)).toBeUndefined();
    expect(hostPanelFor({ start: 145, end: 148 }, film)).toBeUndefined();
  });

  it("an edge that only touches the split (snapped onto its cut, a frame or two off its range) does not take it", () => {
    expect(hostPanelFor({ start: 135, end: 138.25 }, film)).toBeUndefined();
    expect(hostPanelFor({ start: 144.05, end: 147 }, film)).toBeUndefined();
    // a real overlap does
    expect(hostPanelFor({ start: 135, end: 138.5 }, film)).toEqual({ x: 0, w: 840 });
  });

  it("a split with no measured panel takes the default layout (the picture a full-height square on the right)", () => {
    const plain: FilmLayout = { scenes: [scene(27, 138.19, 144.12, { hostPresent: true, split: true })] };
    expect(DEFAULT_SPLIT_HOST_PANEL).toEqual({ x: 0, w: 840 });
    expect(hostPanelFor({ start: 138.2, end: 143.1 }, plain)).toEqual(DEFAULT_SPLIT_HOST_PANEL);
  });

  it("the operator's layout is followed: a dragged seam, the host on the right", () => {
    const wide: FilmLayout = { scenes: [scene(5, 10, 16, { hostPresent: true, split: true, hostPanel: { x: 0, w: 960 } })] };
    expect(hostPanelFor({ start: 11, end: 14 }, wide)).toEqual({ x: 0, w: 960 });
    const right: FilmLayout = { scenes: [scene(5, 10, 16, { hostPresent: true, split: true, hostPanel: { x: 1080, w: 840 } })] };
    expect(hostPanelFor({ start: 11, end: 14 }, right)).toEqual({ x: 1080, w: 840 });
  });

  it("one drawing over two splits sits where both host panels are; host on opposite sides ⇒ the longer split's", () => {
    const two: FilmLayout = {
      scenes: [
        scene(5, 10, 13, { hostPresent: true, split: true, hostPanel: { x: 0, w: 840 } }),
        scene(6, 13, 16, { hostPresent: true, split: true, hostPanel: { x: 0, w: 960 } }),
      ],
    };
    expect(hostPanelFor({ start: 11, end: 15 }, two)).toEqual({ x: 0, w: 840 });
    const opposite: FilmLayout = {
      scenes: [
        scene(5, 10, 13, { hostPresent: true, split: true, hostPanel: { x: 0, w: 840 } }),
        scene(6, 13, 16, { hostPresent: true, split: true, hostPanel: { x: 1080, w: 840 } }),
      ],
    };
    expect(hostPanelFor({ start: 12, end: 15.5 }, opposite)).toEqual({ x: 1080, w: 840 });
  });

  it("one that runs on from a split onto a full host take keeps the panel (one drawing never crosses the seam)", () => {
    const mixed: FilmLayout = {
      scenes: [scene(5, 10, 12, { hostPresent: true, split: true, hostPanel: { x: 0, w: 840 } }), scene(6, 12, 18, { hostPresent: true })],
    };
    expect(hostPanelFor({ start: 11, end: 16 }, mixed)).toEqual({ x: 0, w: 840 });
  });
});

describe("which templates take the panel", () => {
  it("the host caption does; nothing that is held to b-roll, darkens the frame or is a card does", () => {
    const takes = TEMPLATES.filter(t => t.panel).map(t => t.id);
    expect(takes).toContain("HostCaption");
    for (const t of TEMPLATES.filter(t => t.panel)) {
      expect(t.kind).toBe("overlay");
      expect(t.dims || t.on === "broll" || t.underlay).toBeFalsy();
    }
  });
});

describe("the planner is told which side the host is on", () => {
  it("a split the operator turned round reads host right; the default still reads host left", async () => {
    const { userPrompt } = await import("./planner");
    const right = userPrompt({ scenes: [scene(27, 138.19, 144.12, { hostPresent: true, split: true, hostPanel: { x: 1080, w: 840 }, scriptText: "I pull my chair in closer." })] }, []);
    expect(right).toContain("#27 2:18.2-2:24.1 SPLIT (host right, picture left)");
    expect(userPrompt(film, [])).toContain("#27 2:18.2-2:24.1 SPLIT (host left, picture right)");
  });
});

/**
 * The name tag is where the app drew it. Gideon's job 401 now carries it on "My name is Gideon
 * Grant…" (scene 14, 67.54-74.05 s), not the cold open; a rule still guessing "the cold open" would
 * let a host caption sit under the card on the introduction and keep one off the opening for nothing.
 */
describe("nameTagRange — the scenes the app drew the name card on", () => {
  const gideon = (nameCardScenes?: number[]): FilmLayout => ({
    scenes: [
      scene(1, 0, 3.03, { hostPresent: true, hostOpener: true }),
      scene(2, 3.03, 8.1),
      scene(13, 61.86, 67.54),
      scene(14, 67.54, 74.05, { hostPresent: true }),
      scene(15, 74.05, 80.2),
    ],
    ...(nameCardScenes ? { nameCardScenes } : {}),
  });
  const caption = (start: number, end: number) =>
    ({ id: "cap", template: "HostCaption", start, end, props: { durationSec: end - start }, sync: [], conformed: { start: false, end: false }, startFrame: Math.round(start * 30), endFrame: Math.round(end * 30) }) as ResolvedCue;

  it("401: the introduction take, as the app says", () => {
    expect(nameTagRange(gideon([14]))).toEqual([67.54, 74.05]);
    expect(checkRules([caption(68, 72)], gideon([14])).map(p => p.problem)).toContain("host caption while the name tag is up");
    expect(checkRules([caption(0.2, 2.8)], gideon([14]))).toEqual([]);
  });

  it("a film the app drew no card on has no tag at all", () => {
    expect(nameTagRange(gideon([]))).toBeUndefined();
    expect(checkRules([caption(0.2, 2.8)], gideon([]))).toEqual([]);
  });

  it("unset (the lab, an old caller): the cold open, as before", () => {
    expect(nameTagRange(gideon())).toEqual([0, 3.03]);
  });

  it("the planner is told the tag is up on the introduction, not on the opening", async () => {
    const { userPrompt } = await import("./planner");
    const told = userPrompt(gideon([14]), []);
    expect(told).toMatch(/#14 [^\n]*\[NAME TAG UP\]/);
    expect(told).not.toMatch(/#1 [^\n]*\[NAME TAG UP\]/);
  });
});

/**
 * A chapter label over a host take sits clear of the host's face. Job 407, "Number two squared the
 * walls with a broadaxe." (115.33-118.33 s, host scene 21, full frame): drawn where it sits over
 * b-roll, its band (y 660-925) cut across the centred host's beard for 3 s. Job 402's "The whole can"
 * (55.90-60.40 s, split scene 14) also ran across the seam onto the picture beside the host.
 */
describe("placementFor — where a graphic's drawing goes on this film", () => {
  // Job 407's scenes around its two chapter labels (seconds on the film, as stored).
  const sam: FilmLayout = {
    scenes: [
      scene(1, 0, 7.154, { hostPresent: true, hostOpener: true }),
      scene(2, 7.154, 11.7938),
      scene(13, 61.576, 67.8766, { hostPresent: true, split: true, hostPanel: { x: 0, w: 840 } }),
      scene(14, 67.8766, 78.065),
      scene(20, 98.7739, 115.328),
      scene(21, 115.328, 119.416, { hostPresent: true }),
      scene(22, 119.416, 127.451),
    ],
  };

  it("407 chapter-walls over full-frame host scene 21: low, below the chin — no panel, the left side", () => {
    expect(overHostTake({ start: 115.333, end: 118.333 }, sam)).toBe(true);
    expect(placementFor("ChapterLabel", { start: 115.333, end: 118.333 }, sam)).toEqual({ low: true });
  });

  it("407 chapter-roof over b-roll scene 14 stays as designed: it only touches the split before it by 0.01 s", () => {
    expect(overHostTake({ start: 67.867, end: 72.367 }, sam)).toBe(false);
    expect(placementFor("ChapterLabel", { start: 67.867, end: 72.367 }, sam)).toEqual({});
  });

  it("402 chapter-whole-can over split scene 14, running on over the b-roll after it: the host's panel, low", () => {
    const helena: FilmLayout = {
      scenes: [
        scene(13, 47.2874, 55.9074),
        scene(14, 55.9074, 59.3458, { hostPresent: true, split: true, hostPanel: { x: 0, w: 840 } }),
        scene(15, 59.3458, 66.154),
      ],
    };
    expect(placementFor("ChapterLabel", { start: 55.9, end: 60.4 }, helena)).toEqual({ panel: { x: 0, w: 840 }, low: true });
  });

  it("389 chapter-4-fairs over full-frame host scene 30 is low too; a host on the right of a split keeps its panel's side", () => {
    const dale: FilmLayout = { scenes: [scene(1, 0, 2.212, { hostPresent: true, hostOpener: true }), scene(29, 154.505, 164.337), scene(30, 164.337, 169.345, { hostPresent: true }), scene(31, 169.345, 181.689)] };
    expect(placementFor("ChapterLabel", { start: 164.333, end: 168.333 }, dale)).toEqual({ low: true });
    const right: FilmLayout = { scenes: [scene(30, 164.337, 169.345, { hostPresent: true, split: true, hostPanel: { x: 1080, w: 840 } })], nameCardScenes: [] };
    expect(placementFor("ChapterLabel", { start: 164.4, end: 168.3 }, right)).toEqual({ panel: { x: 1080, w: 840 }, low: true });
  });

  it("over the take the name tag is on, a low label takes the right (the tag holds the bottom-left)", () => {
    // 407 with the tag where the app drew it (the cold open) — a part counted on that take.
    const tagged: FilmLayout = { ...sam, nameCardScenes: [1] };
    expect(underNameTag({ start: 2, end: 6 }, tagged)).toBe(true);
    expect(placementFor("ChapterLabel", { start: 2, end: 6 }, tagged)).toEqual({ low: true, side: "right" });
    // scene 21 has no tag: the left, as everywhere else
    expect(placementFor("ChapterLabel", { start: 115.333, end: 118.333 }, tagged)).toEqual({ low: true });
    // a film the app drew no tag on
    expect(placementFor("ChapterLabel", { start: 2, end: 6 }, { ...sam, nameCardScenes: [] })).toEqual({ low: true });
  });

  it("only a chapter label is moved below the chin; a host caption keeps its own place (its panel on a split, as before)", () => {
    expect(placementFor("HostCaption", { start: 138.2, end: 143.133 }, film)).toEqual({ panel: { x: 0, w: 840 } });
    expect(placementFor("HostCaption", { start: 15.267, end: 17.333 }, film)).toEqual({});
    expect(placementFor("StepLabels", { start: 115.333, end: 118.333 }, sam)).toEqual({});
  });

  it("the templates that go below the chin are overlays allowed over a host take", () => {
    const low = TEMPLATES.filter(t => t.belowChin);
    expect(low.map(t => t.id)).toContain("ChapterLabel");
    for (const t of low) {
      expect(t.kind).toBe("overlay");
      expect(t.dims || t.on === "broll" || t.underlay).toBeFalsy();
    }
  });
});

/**
 * Two graphics that darken the frame keep DIM_GAP_SEC apart, a cut between them or not. Job 408
 * (2:04-2:12): "The toilet is fine." as a caption, the picture back for 1.2 s, then "If you think one
 * is already in there, the plunger is the wrong tool." — dimmed, lifted, dimmed again on the cut, a
 * run of subtitles. Job 410 (1:24-1:32): "Could I keep the rest of the can, please?" then 1.9 s later
 * "If they're running short, …". Times as shipped.
 */
describe("checkRules — two graphics that darken the frame keep apart", () => {
  const placed = (id: string, template: string, start: number, end: number, conformedEnd = false) =>
    ({ id, template, start, end, props: {}, sync: [], conformed: { start: false, end: conformedEnd }, startFrame: Math.round(start * 30), endFrame: Math.round(end * 30) }) as unknown as ResolvedCue;
  const broll = (scenes: [number, number, number][]): FilmLayout => ({ scenes: scenes.map(([i, a, b]) => scene(i, a, b)) });
  const toilet = broll([[21, 118.38, 127.767], [22, 127.767, 134.69], [23, 134.69, 139.44]]);
  const dimProblems = (cues: ResolvedCue[], f: FilmLayout) => checkRules(cues, f, { gap: MIN_GAP_SEC }).filter(p => p.problem.includes("darkens the frame again"));

  it("408: the plunger caption, 1.2 s after 'The toilet is fine.', is refused — naming the one before it", () => {
    expect(DIM_GAP_SEC).toBe(3);
    const fine = placed("toilet-is-fine", "DimCaption", 124.567, 126.533);
    const plunger = placed("plunger-wrong-tool-caption", "DimCaption", 127.767, 131.767);
    expect(checkRules([fine, plunger], toilet, { gap: MIN_GAP_SEC })).toEqual([
      {
        cue: "plunger-wrong-tool-caption",
        problem:
          "darkens the frame again 1.2 s after toilet-is-fine — two graphics that darken the picture need 3 s between them: keep the stronger one, or show this one another way",
      },
    ]);
    // The final check (no gap asked) holds it too, so a saved plan does not bring it back.
    expect(checkRules([fine, plunger], toilet).map(p => p.cue)).toEqual(["plunger-wrong-tool-caption"]);
  });

  it("410: the second caption, 1.9 s after 'Could I keep the rest of the can, please?', is refused", () => {
    const can = broll([[19, 81.06, 86.15], [20, 86.15, 92.36]]);
    const cues = [placed("keep-the-can-line", "DimCaption", 83.9, 86.133), placed("no-worse-off-caption", "DimCaption", 88.067, 92.367)];
    expect(dimProblems(cues, can).map(p => p.cue)).toEqual(["no-worse-off-caption"]);
  });

  it("a cut does not separate them, and a graphic between them that does not darken does not either", () => {
    // The first ends ON the cut and the second starts there: two graphics need no gap across a cut,
    // but the frame stays dark across this one.
    expect(dimProblems([placed("a", "DimCaption", 124.567, 127.767, true), placed("b", "ArrowCaption", 127.767, 130)], toilet).map(p => p.cue)).toEqual(["b"]);
    // A label between the two.
    expect(dimProblems([placed("a", "DimCaption", 120, 123), placed("label", "SmallLabel", 124, 125), placed("b", "Quote", 125.5, 128)], toilet).map(p => p.cue)).toEqual(["b"]);
  });

  it("clean cases are left alone: 3 s or more apart (406), or the next graphic does not darken (408)", () => {
    // 406 (2:05-2:17): "9 out of 10" over the footage, then "Fixed and washed, …" 3.07 s later.
    const mower = broll([[25, 117.13, 124.96], [26, 124.96, 132.44], [27, 132.44, 137.34]]);
    const fuel = [placed("nine-of-ten-fuel", "BigNumberOverlay", 124.967, 129.367), placed("fixed-mower-resale", "DimCaption", 132.433, 137.333)];
    expect(checkRules(fuel, mower, { gap: MIN_GAP_SEC })).toEqual([]);
    // 408: the plunger caption, then the "A toilet auger" label 2.9 s later — a label leaves the
    // picture as it is.
    const auger = [placed("plunger-wrong-tool-caption", "DimCaption", 127.767, 131.767), placed("toilet-auger-label", "SmallLabel", 134.7, 136.733)];
    expect(checkRules(auger, toilet, { gap: MIN_GAP_SEC })).toEqual([]);
  });

  it("every template that darkens the frame is held to it", () => {
    expect(TEMPLATES.filter(t => t.dims).map(t => t.id).sort()).toEqual(["ArrowCaption", "BarChart", "BigNumberOverlay", "DimCaption", "Quote", "TitleOverFootage"]);
  });
});

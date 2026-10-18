import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../registry";
import { DEFAULT_SPLIT_HOST_PANEL, hostPanelFor, type FilmLayout, type LayoutScene } from "./rules";

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

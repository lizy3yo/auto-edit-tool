import { describe, it, expect } from "vitest";
import {
  hostBoxFor,
  hostPlatePrompt,
  buildInsetArgs,
  buildPanelArgs,
} from "./hostFrame";
import { dimensionsFor } from "./videoAssembly";

const CANVAS = dimensionsFor("16:9"); // 1920x1080

describe("hostBoxFor — the FALLBACK box, used only when face detection fails", () => {
  it("bottom-aligns the square so a seated host's torso reaches the frame edge", () => {
    const box = hostBoxFor("left", 768, CANVAS);
    expect(box.size).toBe(768);
    expect(box.y).toBe(CANVAS.height - 768); // 312
    expect(box.y + box.size).toBe(CANVAS.height);
  });

  it("keeps the square fully inside the canvas for every alignment", () => {
    for (const align of ["left", "center", "right"] as const) {
      const b = hostBoxFor(align, 768, CANVAS);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.size).toBeLessThanOrEqual(CANVAS.width);
      expect(b.y + b.size).toBeLessThanOrEqual(CANVAS.height);
    }
  });

  it("centres exactly when asked", () => {
    const b = hostBoxFor("center", 768, CANVAS);
    expect(b.x).toBe((CANVAS.width - 768) / 2);
  });

  /**
   * The whole reason this module exists: at 768 in a 1080-high frame the host occupies 71% of
   * the height and is placed 1:1. If this ever exceeds the canvas height the square would need
   * upscaling and the quality argument for the lane collapses. Holds for a DETECTED box too —
   * the worker clamps to the same size.
   */
  it("never requires upscaling — the square fits inside the frame height", () => {
    const b = hostBoxFor("left", 768, CANVAS);
    expect(b.size).toBeLessThanOrEqual(CANVAS.height);
    expect(b.size / CANVAS.height).toBeCloseTo(0.711, 2);
  });
});

describe("hostPlatePrompt", () => {
  // The worker detects the host, but the prompt still steers composition: a waist-up host on
  // a known side keeps the detected box well inside the plate and the framing consistent.
  it("names the side so the composition matches the fixed crop box", () => {
    expect(hostPlatePrompt("a tiled bathroom", "left")).toContain(
      "on the left side of the frame"
    );
    expect(hostPlatePrompt("a tiled bathroom", "right")).toContain(
      "on the right side of the frame"
    );
    expect(hostPlatePrompt("a tiled bathroom", "center")).toContain(
      "centred in the frame"
    );
  });

  it("carries the scene context and forbids cropping the head", () => {
    const p = hostPlatePrompt("a copper pipe workshop");
    expect(p).toContain("a copper pipe workshop");
    expect(p).toMatch(/do not crop the head/i);
    expect(p).toContain("16:9");
  });
});

describe("buildInsetArgs", () => {
  const base = {
    platePath: "/tmp/plate.png",
    hostClipPath: "/tmp/host.mp4",
    outputPath: "/tmp/out.mp4",
    box: hostBoxFor("left", 768, CANVAS),
    width: CANVAS.width,
    height: CANVAS.height,
  };

  it("overlays the square at exactly the box it was cropped from", () => {
    const f = buildInsetArgs(base).join(" ");
    expect(f).toContain(`overlay=${base.box.x}:${base.box.y}`);
    expect(f).toContain(`scale=${base.box.size}:${base.box.size}`);
  });

  it("loops the still plate and stops at the clip length", () => {
    const args = buildInsetArgs(base);
    expect(args.slice(0, 4)).toEqual(["-y", "-loop", "1", "-i"]);
    expect(args).toContain("-shortest");
  });

  // The model regenerates the whole square, so its background drifts from the static plate.
  // Feathering cross-fades that boundary instead of showing a hard rectangle.
  it("builds a feathered alpha ramp by default and a solid one at featherPx 0", () => {
    expect(buildInsetArgs(base).join(" ")).toContain("geq=");
    expect(buildInsetArgs({ ...base, featherPx: 0 }).join(" ")).not.toContain(
      "geq="
    );
  });

  it("keeps the narration track from the model output", () => {
    expect(buildInsetArgs(base)).toContain("1:a?");
  });
});

describe("buildPanelArgs", () => {
  const base = {
    contextPath: "/tmp/ctx.png",
    hostClipPath: "/tmp/host.mp4",
    outputPath: "/tmp/out.mp4",
    width: CANVAS.width,
    height: CANVAS.height,
    size: 768,
  };

  it("places the host 1:1 with no scaling — the point of the layout", () => {
    const f = buildPanelArgs(base).join(" ");
    expect(f).toContain("scale=768:768");
  });

  it("gives the context panel exactly the remaining width", () => {
    const f = buildPanelArgs(base).join(" ");
    expect(f).toContain(`scale=${CANVAS.width - 768}:${CANVAS.height}`);
  });

  it("swaps sides without overflowing the canvas", () => {
    const right = buildPanelArgs({ ...base, hostSide: "right" }).join(" ");
    expect(right).toContain(`overlay=${CANVAS.width - 768}:0`);
    const left = buildPanelArgs({ ...base, hostSide: "left" }).join(" ");
    expect(left).toContain("overlay=0:0");
  });

  // 768 in a 1080 frame leaves 156px above and below; filling it with black would read as a
  // letterbox bug rather than a design choice.
  it("pillarboxes the square against a blurred copy instead of black bars", () => {
    const f = buildPanelArgs(base).join(" ");
    expect(f).toContain("gblur=");
    expect(f).toContain(`overlay=0:${(CANVAS.height - 768) / 2}`);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  CLOSE_FACE,
  framingFilter,
  hostCleanZoom,
  hostCleanZoomSplit,
  shouldZoom,
  zoomCrop,
} from "./hostFraming";

const FW = 1920;
const FH = 1080;

describe("the part of a wide host clip that is kept", () => {
  it("is the frame's own shape, 1/zoom of its size", () => {
    const c = zoomCrop(FW, FH, 1.4)!;
    expect(c.w / c.h).toBeCloseTo(FW / FH, 2);
    expect(c.w).toBeCloseTo(FW / 1.4, -1);
  });

  it("is centred left to right and taken from the top, so the head stays where it was", () => {
    const c = zoomCrop(FW, FH, 1.4)!;
    expect(c.y).toBe(0);
    expect(Math.abs(c.x + c.w / 2 - FW / 2)).toBeLessThanOrEqual(2);
  });

  it("cuts the wide frame's lower-right corner off, where the stamped mark sat", () => {
    const c = zoomCrop(FW, FH, 1.4)!;
    expect(c.x + c.w).toBeLessThan(0.933 * FW);
    expect(c.y + c.h).toBeLessThan(0.874 * FH);
  });

  it("is the same crop for every clip, so every host scene of a film is framed alike", () => {
    expect(zoomCrop(FW, FH, 1.4)).toEqual(zoomCrop(FW, FH, 1.4));
  });

  it("stays inside the frame on even pixels at any size", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [854, 480],
    ])
      for (const zoom of [1.1, 1.4, 2]) {
        const c = zoomCrop(w, h, zoom)!;
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(w);
        expect(c.y + c.h).toBeLessThanOrEqual(h);
        for (const v of [c.x, c.y, c.w, c.h]) expect(v % 2).toBe(0);
      }
  });

  it("is nothing at all when the zoom is 1", () => {
    expect(zoomCrop(FW, FH, 1)).toBeNull();
  });

  it("writes the filter ffmpeg is given: crop, enlarge back, sharpen", () => {
    expect(framingFilter({ x: 274, y: 0, w: 1370, h: 770 }, FW, FH)).toBe(
      "crop=1370:770:274:0,scale=1920:1080:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,setsar=1"
    );
  });
});

describe("which clips are zoomed", () => {
  it("zooms a wide clip — the host's face a third of the frame's height", () => {
    // Read off a real wide clip: 0.32 to 0.36.
    expect(shouldZoom(0.32)).toBe(true);
    expect(shouldZoom(0.36)).toBe(true);
  });

  it("leaves a clip whose host is already close, so a second click cannot zoom twice", () => {
    // An uploaded photo reads 0.47, a clip already zoomed 0.49.
    expect(shouldZoom(0.47)).toBe(false);
    expect(shouldZoom(0.49)).toBe(false);
    expect(shouldZoom(CLOSE_FACE)).toBe(false);
  });

  it("zooms when no face can be found — the operator asked for the zoom", () => {
    expect(shouldZoom(null)).toBe(true);
  });
});

describe("how far it zooms", () => {
  const saved = process.env.HOST_CLEAN_ZOOM;
  afterEach(() => {
    if (saved === undefined) delete process.env.HOST_CLEAN_ZOOM;
    else process.env.HOST_CLEAN_ZOOM = saved;
  });

  it("is 1.4× unless set otherwise", () => {
    delete process.env.HOST_CLEAN_ZOOM;
    expect(hostCleanZoom()).toBe(1.4);
  });

  it("is gentler for a split screen, whose host half is narrow", () => {
    delete process.env.HOST_CLEAN_ZOOM_SPLIT;
    expect(hostCleanZoomSplit()).toBe(1.2);
    expect(hostCleanZoomSplit()).toBeLessThan(hostCleanZoom());
    // 1.2× still ends above the stamped mark: centred at 87.4% of the height, ~35 px tall
    // each way at 1080p, so its top edge is just below where the kept picture stops.
    const c = zoomCrop(FW, FH, hostCleanZoomSplit())!;
    expect(c.y + c.h).toBeLessThanOrEqual(0.874 * FH - 35);
  });

  it("takes a sensible setting and ignores a senseless one", () => {
    process.env.HOST_CLEAN_ZOOM = "1.25";
    expect(hostCleanZoom()).toBe(1.25);
    process.env.HOST_CLEAN_ZOOM = "9";
    expect(hostCleanZoom()).toBe(1.4);
    process.env.HOST_CLEAN_ZOOM = "wide";
    expect(hostCleanZoom()).toBe(1.4);
  });
});

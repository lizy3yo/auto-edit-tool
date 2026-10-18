// The chapter label over a host take sits clear of the host's face. Job 407 (Sawdust Sam, scene 21,
// "Number two squared the walls with a broadaxe.", 115.33-118.33 s): the label was drawn where it
// sits over b-roll — a band from y 660 to 925 of 1080, left 100 to 1060 — and its top edge cut across
// the centred host's beard (it ends at ~690 px) for 3 s. Job 402's (Helena Hart, scene 14, a split)
// also ran across the seam onto the picture beside her. Rendered to markup with the frame clock set
// by hand, so the test needs no browser.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("remotion", async importOriginal => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => 40,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 90, id: "ChapterLabel" }),
}));

import { CHAPTER_PLATE, ChapterLabel, chapterBox, type ChapterBox } from "./overlays";
import { HEIGHT, LAYOUT, WIDTH } from "./theme";

/** The plate's drawn rectangle on the frame. */
const drawn = (b: ChapterBox) => ({ x0: b.left, x1: b.left + b.width * b.scale, y0: b.top, y1: b.top + CHAPTER_PLATE.h * b.scale });
/** Job 407's host: his beard ends at ~690 px (the review frame chapter-walls-m, 345 of 540). */
const BEARD_407 = 690;
/** The host name card's right edge at its widest: 5.2% margin + at most 42% of the frame
 * (server/nameCard.ts `renderNameCardPng`). */
const NAME_CARD_MAX_RIGHT = Math.round(WIDTH * 0.052) + Math.round(WIDTH * 0.42);

describe("chapterBox: where the chapter label's plate goes", () => {
  it("over b-roll: as designed — bottom-left, full size (407 chapter-roof over scene 14 keeps it)", () => {
    expect(chapterBox({})).toEqual({ left: 100, top: HEIGHT - 155 - 265, width: 960, scale: 1 });
    expect(drawn(chapterBox({}))).toEqual({ x0: 100, x1: 1060, y0: 660, y1: 925 });
  });

  it("407 chapter-walls, over a full-frame host take: below the chin, inside the action-safe area", () => {
    const b = drawn(chapterBox({ low: true }));
    // The plate as designed started 30 px ABOVE the end of the beard; low, it starts 100 px below it.
    expect(drawn(chapterBox({})).y0).toBeLessThan(BEARD_407);
    expect(b.y0).toBe(LAYOUT.belowChinY);
    expect(b.y0).toBeGreaterThanOrEqual(BEARD_407 + 100);
    expect(b.y1).toBeLessThanOrEqual(HEIGHT - LAYOUT.actionSafeY);
    expect(b.x0).toBe(100);
    expect(b.x1).toBeLessThanOrEqual(WIDTH - 100);
  });

  it("while the name card holds the bottom-left, a low label takes the right, clear of the card at its widest", () => {
    const b = drawn(chapterBox({ low: true, side: "right" }));
    expect(b.x1).toBeCloseTo(WIDTH - 100, 6);
    expect(b.x0).toBeGreaterThan(NAME_CARD_MAX_RIGHT);
    expect(b.y0).toBe(LAYOUT.belowChinY);
  });

  it("402 chapter-whole-can, over a split (host left, 840 px): inside the host's panel, clear of the seam", () => {
    const b = drawn(chapterBox({ panel: { x: 0, w: 840 } }));
    expect(b.x0).toBe(100);
    expect(b.x1).toBeLessThanOrEqual(840 - 48 + 1e-6);
    expect(b.y0).toBe(LAYOUT.belowChinY);
    // the same with `low` set too, as the finishing step sets both
    expect(chapterBox({ low: true, panel: { x: 0, w: 840 } })).toEqual(chapterBox({ panel: { x: 0, w: 840 } }));
  });

  it("the host on the right of a split: inside that panel, from the seam to the frame's margin", () => {
    const b = drawn(chapterBox({ panel: { x: 1080, w: 840 } }));
    expect(b.x0).toBe(1080 + 48);
    expect(b.x1).toBeLessThanOrEqual(WIDTH - 100 + 1e-6);
  });

  it("a seam dragged far over (the narrowest host panel is a fifth of the frame): shrunk to fit, never across", () => {
    const b = drawn(chapterBox({ panel: { x: 0, w: 384 } }));
    expect(b.x1).toBeLessThanOrEqual(384 - 48 + 1e-6);
    expect(b.y0).toBe(LAYOUT.belowChinY);
    expect(b.y1).toBeLessThan(HEIGHT);
  });
});

describe("the chapter label as drawn", () => {
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(React.createElement(ChapterLabel, { kicker: "Walls · 2 of 3", number: 2, title: "The walls", durationSec: 3, ...props }));

  it("over b-roll: exactly where it always was (top 660 is bottom 155 on a 265 px plate), unscaled", () => {
    const html = render({});
    expect(html).toContain("left:100px;top:660px;height:265px;width:960px");
    expect(html).not.toContain("scale(");
  });

  it("407 chapter-walls over the host: drawn from y 790 down, at 0.8 of its size", () => {
    const html = render({ low: true });
    expect(html).toContain("left:100px;top:790px;height:265px;width:960px");
    expect(html).toContain("transform:scale(0.8)");
  });
});

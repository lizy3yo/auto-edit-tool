// The accent arrow shows nothing before it starts drawing (job 400, clock-before-after: a Before →
// After card from 62.77 s whose arrow drew at ~65.0 s; until then the shaft was a line of length 0,
// and its round cap painted an 8 px orange dot alone at the middle of the screen). Rendered to
// markup with the frame clock set by hand, so the test needs no browser.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ frame: 0 }));
vi.mock("remotion", async importOriginal => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 150, id: "BeforeAfter" }),
}));

import { BeforeAfterCard, StepCardsCard } from "./cards";
import { Arrow, MeasuringContext } from "./components";
import { appearFrame, drawnTo } from "./timing";

const FPS = 30;
const render = (frame: number, el: React.ReactElement) => {
  clock.frame = frame;
  // measuring: icons stand as empty boxes, so no picture is fetched
  return renderToStaticMarkup(React.createElement(MeasuringContext.Provider, { value: true }, el));
};
const lines = (html: string) => [...html.matchAll(/<line [^>]*x2="([\d.]+)"/g)].map(m => Number(m[1]));
const heads = (html: string) => [...html.matchAll(/<polygon [^>]*opacity="([\d.]+)"/g)].map(m => Number(m[1]));

describe("drawnTo: how far a drawn-in line reaches", () => {
  it("is nothing — not a line of length 0 — until the line starts", () => {
    expect(drawnTo(0, 160)).toBeNull();
    expect(drawnTo(-0.2, 160)).toBeNull();
    expect(drawnTo(Number.NaN, 160)).toBeNull();
  });
  it("then runs along its length, and stops at its end", () => {
    expect(drawnTo(0.25, 160)).toBe(40);
    expect(drawnTo(1, 160)).toBe(160);
    expect(drawnTo(1.4, 160)).toBe(160);
  });
  it("a line with no room to draw is never drawn", () => {
    expect(drawnTo(1, 0)).toBeNull();
    expect(drawnTo(1, -4)).toBeNull();
  });
});

describe("the accent arrow", () => {
  const arrow = React.createElement(Arrow, { atFrame: 30, width: 180, thickness: 8 });
  const head = 8 * 3.2;

  it("before it starts drawing: no shaft and no head, though its box keeps its place in the row", () => {
    for (const f of [0, 12, 29, 30]) {
      const html = render(f, arrow);
      expect(lines(html)).toEqual([]);
      expect(heads(html)).toEqual([0]);
      expect(html).toContain('width="180"');
    }
  });

  it("the first frame after it starts, the shaft is already drawing (not a dot): part of the way, no head yet", () => {
    const [x2] = lines(render(31, arrow));
    expect(x2).toBeGreaterThan(10);
    expect(x2).toBeLessThan(180 - head);
    expect(heads(render(31, arrow))).toEqual([0]);
  });

  it("drawn: the whole shaft and the head", () => {
    const html = render(45, arrow);
    expect(lines(html)).toEqual([180 - head]);
    expect(heads(html)).toEqual([1]);
  });
});

describe("job 400 clock-before-after: nothing between the two sides until 'now'", () => {
  // The card's own words, as heard: "background" at 63.065 s, "now" at 65.167 s; the card from 62.767 s.
  const card = React.createElement(BeforeAfterCard, {
    durationSec: 5,
    kicker: "The clock",
    before: { icon: "23f0", label: "Background noise at thirty", at: 63.065 - 62.767 },
    after: { icon: "1f4e2", label: "The loudest thing", at: 65.167 - 62.767 },
  });
  const drawsAt = appearFrame(65.167 - 62.767, FPS) - 6; // the arrow leads the after side by 6 frames

  it("from the card's first frame to the arrow's start, no part of the arrow is drawn", () => {
    expect(drawsAt).toBe(64); // 64.9 s into the film — where the reviewer saw the dot leave
    for (let f = 0; f <= drawsAt; f++) {
      const html = render(f, card);
      expect(lines(html)).toEqual([]);
      expect(heads(html)).toEqual([0]);
    }
  });

  it("and the arrow still draws, as before, with the after side", () => {
    expect(lines(render(drawsAt + 1, card))[0]).toBeGreaterThan(0);
    const end = render(drawsAt + 12, card);
    expect(lines(end)).toHaveLength(1);
    expect(heads(end)).toEqual([1]);
  });
});

describe("step cards: each arrow appears only with its own step", () => {
  const steps = [
    { text: "One", at: 0.2 },
    { text: "Two", at: 1.5 },
    { text: "Three", at: 3 },
  ];
  const card = React.createElement(StepCardsCard, { durationSec: 5, steps });
  it("while step one is on screen, neither arrow shows", () => {
    const html = render(appearFrame(1.5, FPS) - 4, card);
    expect(lines(html)).toEqual([]);
    expect(heads(html)).toEqual([0, 0]);
  });
  it("once step two comes the first arrow draws and the second still shows nothing", () => {
    expect(lines(render(appearFrame(1.5, FPS) + 10, card))).toHaveLength(1);
    expect(heads(render(appearFrame(1.5, FPS) + 10, card))).toEqual([1, 0]);
  });
});

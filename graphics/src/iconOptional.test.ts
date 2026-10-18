// An icon is optional on the graphics that used to require one (round 10 review: an icon is the
// object the words name, or none — job 399's food tin on a drink-can fact, job 400's megaphone for
// "The loudest thing"). A card with no icon draws its words alone and does not crash on a missing
// code: the finishing step also takes off an icon whose image cannot be had (server/graphics
// `inlineIcons`), and BeforeAfter, IconLabels and IconCallout handed it straight to `code.startsWith`.
// Rendered to markup with the frame clock set by hand, so the test needs no browser.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("remotion", async importOriginal => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => 120,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 150, id: "Icons" }),
}));

import { BeforeAfterCard } from "./cards";
import { MeasuringContext } from "./components";
import { IconCallout } from "./more";
import { IconLabels } from "./overlays";

/** Measuring: an icon stands as an empty box of its size, so no picture is fetched. */
const measured = (el: React.ReactElement) => renderToStaticMarkup(React.createElement(MeasuringContext.Provider, { value: true }, el));
const boxes = (html: string, size: number) => html.split(`width:${size}px;height:${size}px`).length - 1;

describe("a graphic with no icon draws its words alone", () => {
  // job 400 clock-before-after, with the icons left out (the after side names no object)
  const clock = (icons: boolean) =>
    React.createElement(BeforeAfterCard, {
      durationSec: 5,
      kicker: "The clock",
      before: { label: "Background noise at thirty", at: 0.3, ...(icons ? { icon: "23f0" } : {}) },
      after: { label: "The loudest thing", at: 2.4, ...(icons ? { icon: "23f0" } : {}) },
    });

  it("BeforeAfter: both labels, no icon box, and no crash when rendered for real", () => {
    const html = renderToStaticMarkup(clock(false));
    expect(html).toContain("Background noise at thirty");
    expect(html).toContain("The loudest thing");
    expect(html).not.toContain("<img");
    expect(boxes(measured(clock(false)), 240)).toBe(0);
    // with its icons, as before: one 240 px icon a side
    expect(boxes(measured(clock(true)), 240)).toBe(2);
  });

  it("IconLabels: each label without its icon", () => {
    const labels = (icons: boolean) =>
      React.createElement(IconLabels, {
        durationSec: 4,
        items: [
          { text: "Photoelectric", at: 0.2, ...(icons ? { icon: "2705" } : {}) },
          { text: "Dual sensor", at: 1.4, ...(icons ? { icon: "2705" } : {}) },
        ],
      });
    const html = renderToStaticMarkup(labels(false));
    expect(html).toContain("Photoelectric");
    expect(html).not.toContain("<img");
    expect(boxes(measured(labels(false)), 60)).toBe(0);
    expect(boxes(measured(labels(true)), 60)).toBe(2);
  });

  it("IconCallout: a saved callout whose icon was taken off draws its words with no empty disc", () => {
    const callout = (icon?: string) => React.createElement(IconCallout, { durationSec: 4, phrase: { text: "The battery was pulled.", at: 0.3 }, ...(icon ? { icon } : {}) });
    const html = renderToStaticMarkup(callout());
    expect(html).toContain("pulled.");
    expect(html).not.toContain("width:110px;height:110px");
    expect(html).toMatch(/padding:18px 44px(;|")/);
    expect(boxes(measured(callout("1f50b")), 70)).toBe(1);
    expect(measured(callout("1f50b"))).toContain("width:110px;height:110px");
  });
});

import { describe, expect, it } from "vitest";
import { Hct, argbFromRgb } from "@material/material-color-utilities";
import { MIN_CONTRAST, contrastOf, themeFor, themeFromPixels, towardWhite, withAlpha } from "./palette";
import { THEME } from "./theme";

/** A synthetic "photo": a list of [r, g, b, share] blocks. */
function photo(blocks: [number, number, number, number][]): number[] {
  const out: number[] = [];
  for (const [r, g, b, n] of blocks) for (let i = 0; i < n; i++) out.push(argbFromRgb(r, g, b));
  return out;
}
const hueOf = (hex: string) => Hct.fromInt((0xff000000 | parseInt(hex.slice(1), 16)) >>> 0).hue;
const meetsMinimums = (c: ReturnType<typeof contrastOf>) => {
  expect(c.text).toBeGreaterThanOrEqual(MIN_CONTRAST.text);
  expect(c.accent).toBeGreaterThanOrEqual(MIN_CONTRAST.accent);
  expect(c.muted).toBeGreaterThanOrEqual(MIN_CONTRAST.muted);
  expect(c.accentOnPlate).toBeGreaterThanOrEqual(MIN_CONTRAST.accentOnPlate);
};

describe("theme from the host photo", () => {
  it("the default (Steve's navy and blue) meets every contrast minimum", () => {
    meetsMinimums(contrastOf(THEME));
  });

  it("takes a navy shirt's hue, and every pair stays readable", () => {
    const { theme, report } = themeFromPixels(photo([[30, 45, 90, 4000], [200, 160, 140, 3000], [180, 180, 175, 3000]]));
    expect(report.source).not.toBe("default");
    expect(Math.abs(hueOf(theme.accent) - hueOf("#1E2D5A"))).toBeLessThan(30);
    meetsMinimums(report.contrast);
  });

  it("a shirt in many shades beats one big grey wall (Frederick's photo)", () => {
    const { theme } = themeFromPixels(
      photo([[140, 140, 131, 4500], [23, 40, 70, 500], [27, 44, 73, 450], [25, 39, 65, 400], [26, 42, 69, 400], [21, 37, 66, 350], [205, 160, 135, 2500], [120, 100, 80, 900]])
    );
    expect(Math.abs(hueOf(theme.accent) - hueOf("#172846"))).toBeLessThan(30);
  });

  it("never picks skin, even when the face fills most of the photo", () => {
    const { theme } = themeFromPixels(photo([[205, 160, 135, 7000], [150, 110, 90, 1500], [40, 120, 70, 800]]));
    expect(Math.abs(hueOf(theme.accent) - hueOf("#287846"))).toBeLessThan(30);
  });

  it("keeps the default when nothing in the photo can carry a colour", () => {
    const { theme, report } = themeFromPixels(photo([[120, 120, 120, 5000], [200, 200, 198, 5000]]));
    expect(report.source).toBe("default");
    expect(theme).toEqual(THEME);
  });

  it("moves a red source off the warning red", () => {
    const { theme, report } = themeFromPixels(photo([[200, 30, 35, 5000], [120, 120, 120, 5000]]));
    expect(report.note).toContain("warning red");
    const d = Math.abs(((hueOf(theme.accent) - hueOf(theme.danger) + 540) % 360) - 180);
    expect(d).toBeGreaterThanOrEqual(25);
    meetsMinimums(report.contrast);
  });

  it("withAlpha", () => {
    expect(withAlpha("#44A3FF", 0.25)).toBe("rgba(68,163,255,0.25)");
  });
});

describe("the colours a cue renders with", () => {
  // Hank's job 390: the video's theme when its "6 hours" number was left out as unreadable.
  const theme = { bg: "#221710", accent: "#eb9046" };

  it("as designed: the video's own accent", () => {
    expect(themeFor({ theme }).accent).toBe("#eb9046");
    expect(themeFor({ theme }).danger).toBe(THEME.danger);
  });

  it("`plain` draws the accent in the plain text colour, and the warning red keeps its colour", () => {
    const t = themeFor({ theme, plain: true });
    expect(t.accent).toBe(t.text);
    expect(t.accent).toBe("#FFFFFF");
    expect(t.danger).toBe(THEME.danger);
    expect(t.bg).toBe("#221710");
  });

  it("`plain` on top of `lift`: the accent is plain, the warning red stays lifted", () => {
    const t = themeFor({ theme, lift: 1, plain: true });
    expect(t.accent).toBe("#FFFFFF");
    expect(t.danger).toBe(towardWhite(THEME.danger, 0.4));
  });

  it("only `plain: true` turns it on", () => {
    expect(themeFor({ theme, plain: "yes" }).accent).toBe("#eb9046");
    expect(themeFor({ theme, plain: 1 }).accent).toBe("#eb9046");
  });

  it("the accent stays a #rrggbb even when a theme's text colour is not one, and still equals the text", () => {
    const t = themeFor({ theme: { ...theme, text: "white" }, plain: true });
    expect(t.accent).toBe("#FFFFFF");
    expect(t.text).toBe(t.accent);
    // Not drawn plain, such a theme's text is left exactly as it was.
    expect(themeFor({ theme: { ...theme, text: "white" } }).text).toBe("white");
  });
});

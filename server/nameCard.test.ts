import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { renderNameCardPng } from "./nameCard";
import { interFontReady } from "./fontConfig";
import { THEME } from "../graphics/src/theme";

const FRAME = { width: 1920, height: 1080 };

describe("renderNameCardPng", () => {
  it("returns null when the channel has no host identity configured", async () => {
    expect(await renderNameCardPng(FRAME)).toBeNull();
    expect(
      await renderNameCardPng({
        ...FRAME,
        name: "  ",
        title: "",
        location: null,
      })
    ).toBeNull();
  });

  it("renders a full-frame transparent PNG so the overlay can sit at 0:0", async () => {
    const png = await renderNameCardPng({
      ...FRAME,
      name: "Riley Danvers",
      title: "Gardener",
      location: "Fresno, CA",
    });
    expect(png).not.toBeNull();
    const meta = await sharp(png as Buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.hasAlpha).toBe(true);
  });

  it("draws the card bottom-left, clear of the bottom-right QR corner", async () => {
    const png = (await renderNameCardPng({
      ...FRAME,
      name: "Riley Danvers",
      title: "Gardener",
      location: "Fresno, CA",
    })) as Buffer;
    // `trim` crops to the drawn (non-transparent) region; its offsets tell us where the
    // card actually landed. Left edge well inside the left half, bottom edge above the frame.
    const { info } = await sharp(png)
      .trim()
      .toBuffer({ resolveWithObject: true });
    const left = info.trimOffsetLeft ?? 0;
    const top = info.trimOffsetTop ?? 0;
    expect(Math.abs(left)).toBeLessThan(1920 * 0.1);
    expect(Math.abs(left) + info.width).toBeLessThan(1920 * 0.5);
    expect(Math.abs(top) + info.height).toBeLessThan(1080);
  });

  it("renders a still-valid card when only some lines are set", async () => {
    const png = await renderNameCardPng({
      ...FRAME,
      name: "Riley Danvers",
      location: "Fresno, CA",
    });
    expect((await sharp(png as Buffer).metadata()).width).toBe(1920);
  });

  it("keeps a very long name inside the card's width cap", async () => {
    const png = (await renderNameCardPng({
      ...FRAME,
      name: "Bartholomew Vandersteen-Whitfield",
      title: "Master Horticulturalist",
      location: "Cheyenne Wells, CO",
    })) as Buffer;
    const { info } = await sharp(png)
      .trim()
      .toBuffer({ resolveWithObject: true });
    // Wraps/shrinks rather than running across the frame under the host's face.
    expect(Math.abs(info.trimOffsetLeft ?? 0) + info.width).toBeLessThan(
      1920 * 0.5
    );
  });

  it("escapes XML metacharacters instead of emitting broken SVG", async () => {
    const png = await renderNameCardPng({
      ...FRAME,
      name: 'Steve "Sully" O\'Brien & Co <b>',
      title: "Gardener",
      location: "Fresno, CA",
    });
    expect((await sharp(png as Buffer).metadata()).width).toBe(1920);
  });
});

/** The card's pixels, read back: RGBA, unpremultiplied. */
async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };
  return { at, width: info.width, height: info.height };
}

const hex = (h: string) => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});
const near = (p: { r: number; g: number; b: number }, q: { r: number; g: number; b: number }, tol = 6) =>
  Math.abs(p.r - q.r) <= tol && Math.abs(p.g - q.g) <= tol && Math.abs(p.b - q.b) <= tol;

/** Where the card is: the accent edge is the one fully opaque column at the card's left. */
async function cardOf(png: Buffer) {
  const px = await pixels(png);
  const barX = Math.round(1920 * 0.052) + 3;
  const rows: number[] = [];
  for (let y = 0; y < px.height; y++) if (px.at(barX, y).a === 255) rows.push(y);
  const top = rows[0];
  const bottom = rows[rows.length - 1];
  const mid = Math.round((top + bottom) / 2);
  // The plate's right edge on a row with no text: the top padding row.
  let right = barX;
  for (let x = barX; x < px.width; x++) if (px.at(x, top + 2).a >= 150) right = x;
  return { px, barX, top, bottom, mid, right };
}

describe("renderNameCardPng — the graphics' look (jobs 405, 407)", () => {
  // Jobs 405 ("Luca Marino / Cat Trainer") and 407 ("Sawdust Sam") opened on the card in a
  // Times-style serif: on Windows librsvg never found Inter (FONTCONFIG_FILE set from Node does not
  // reach the native fontconfig) and fell back with no error.
  it("draws its words in Inter, not the fallback serif", async () => {
    await renderNameCardPng({ ...FRAME, name: "Sawdust Sam" });
    expect(await interFontReady()).toBe(true);
  });

  it("puts the channel's accent on its edge and on the role, the role above the name", async () => {
    const accent = "#E8A13A";
    const png = (await renderNameCardPng({ ...FRAME, name: "Luca Marino", title: "Cat Trainer", accent })) as Buffer;
    const { px, barX, top, bottom, right } = await cardOf(png);
    expect(near(px.at(barX, Math.round((top + bottom) / 2)), hex(accent))).toBe(true);
    const accentRows: number[] = [];
    const whiteRows: number[] = [];
    for (let y = top; y <= bottom; y++)
      for (let x = barX + 10; x < right; x++) {
        const p = px.at(x, y);
        if (p.a < 250) continue;
        if (near(p, hex(accent), 10)) accentRows.push(y);
        else if (near(p, { r: 255, g: 255, b: 255 }, 4)) whiteRows.push(y);
      }
    expect(accentRows.length).toBeGreaterThan(0);
    expect(whiteRows.length).toBeGreaterThan(0);
    // ChapterLabel's order: the kicker over the title.
    expect(Math.max(...accentRows)).toBeLessThan(Math.min(...whiteRows));
  });

  it("sits on the graphics' plate with square corners", async () => {
    const png = (await renderNameCardPng({ ...FRAME, name: "Gary" })) as Buffer;
    const { px, barX, top, bottom, right } = await cardOf(png);
    // Inside the plate, clear of the words: the overlays' plate colour at their 0.74 base alpha,
    // not darkened by its own shadow.
    const plate = px.at(barX + 12, top + 4);
    expect(near(plate, { r: 12, g: 16, b: 22 }, 2)).toBe(true);
    expect(Math.abs(plate.a - Math.round(0.74 * 255))).toBeLessThanOrEqual(2);
    // Square: the plate's own corners are as solid as its middle.
    expect(px.at(right, top).a).toBeGreaterThanOrEqual(185);
    expect(px.at(right, bottom).a).toBeGreaterThanOrEqual(185);
  });

  it("hugs its words: the plate ends one padding past the name, not a guess past it", async () => {
    const png = (await renderNameCardPng({ ...FRAME, name: "Luca Marino" })) as Buffer;
    const { px, barX, top, bottom, right } = await cardOf(png);
    let inkRight = 0;
    for (let y = top; y <= bottom; y++)
      for (let x = barX + 10; x <= right; x++) {
        const p = px.at(x, y);
        if (p.a >= 250 && near(p, { r: 255, g: 255, b: 255 }, 60)) inkRight = Math.max(inkRight, x);
      }
    // 34 px of padding at 1080p, give or take the measuring's edge pixels.
    expect(right - inkRight).toBeGreaterThanOrEqual(28);
    expect(right - inkRight).toBeLessThanOrEqual(40);
  });

  it("keeps the theme's own accent when the one given is not a plain colour", async () => {
    const png = (await renderNameCardPng({ ...FRAME, name: "Gary", accent: 'red" onload="x' })) as Buffer;
    const { px, barX, top, bottom } = await cardOf(png);
    expect(near(px.at(barX, Math.round((top + bottom) / 2)), hex(THEME.accent))).toBe(true);
  });
});

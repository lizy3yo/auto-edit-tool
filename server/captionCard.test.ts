import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { renderCaptionCardPng, CAPTION_MAX_CHARS } from "./captionCard";

const W = 1920;
const H = 1080;

describe("renderCaptionCardPng", () => {
  it("returns null for a blank caption, so 'no text typed' is simply no card", async () => {
    expect(
      await renderCaptionCardPng({ text: undefined, width: W, height: H })
    ).toBeNull();
    expect(
      await renderCaptionCardPng({ text: "   ", width: W, height: H })
    ).toBeNull();
  });

  it("renders a FULL-FRAME transparent PNG, so the overlay stays a fixed 0:0", async () => {
    const png = await renderCaptionCardPng({
      text: "The Lost Book of Herbal Remedies",
      width: W,
      height: H,
    });
    expect(png).toBeTruthy();
    const meta = await sharp(png as Buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(W);
    expect(meta.height).toBe(H);
    expect(meta.hasAlpha).toBe(true);
  });

  it("draws in the BOTTOM band and leaves the top of the frame untouched", async () => {
    const png = await renderCaptionCardPng({
      text: "Scan to get your copy",
      width: W,
      height: H,
    });
    const { data, info } = await sharp(png as Buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3];
    // Top half: fully transparent — an asset render must not be covered by its own caption.
    expect(alphaAt(W / 2, Math.round(H * 0.25))).toBe(0);
    // Bottom-centre: the card.
    expect(alphaAt(W / 2, Math.round(H * 0.9))).toBeGreaterThan(0);
  });

  it("keeps clear of the bottom-RIGHT corner, where the QR card sits", async () => {
    const png = await renderCaptionCardPng({
      text: "A caption that is reasonably long but not extreme",
      width: W,
      height: H,
    });
    const { data, info } = await sharp(png as Buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels + 3];
    // The QR card is ~28% of frame height square in the bottom-right with a small margin;
    // sample well inside it.
    expect(alphaAt(Math.round(W * 0.93), Math.round(H * 0.9))).toBe(0);
  });

  it("wraps a long caption instead of shrinking it into illegibility", async () => {
    const short = await renderCaptionCardPng({
      text: "Short",
      width: W,
      height: H,
    });
    const long = await renderCaptionCardPng({
      text: "A considerably longer caption that has to wrap onto more than a single line",
      width: W,
      height: H,
    });
    const inkRows = async (png: Buffer) => {
      const { data, info } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let rows = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * info.channels + 3] > 0) {
            rows++;
            break;
          }
        }
      }
      return rows;
    };
    // More lines ⇒ a taller card, which is the wrap actually happening.
    expect(await inkRows(long as Buffer)).toBeGreaterThan(
      await inkRows(short as Buffer)
    );
  });

  it("truncates past the caption ceiling rather than laying out a paragraph", async () => {
    const png = await renderCaptionCardPng({
      text: "x".repeat(CAPTION_MAX_CHARS * 3),
      width: W,
      height: H,
    });
    expect(png).toBeTruthy();
    const meta = await sharp(png as Buffer).metadata();
    expect(meta.height).toBe(H);
  });

  it("never throws on punctuation that would break the SVG", async () => {
    const png = await renderCaptionCardPng({
      text: `Rogers & Sons' "best" <deal> — 50% off`,
      width: W,
      height: H,
    });
    expect(png).toBeTruthy();
  });
});

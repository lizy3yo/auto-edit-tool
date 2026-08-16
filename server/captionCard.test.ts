import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  renderCaptionCardPng,
  breakLongTokens,
  CAPTION_MAX_CHARS,
} from "./captionCard";

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

describe("breakLongTokens", () => {
  it("leaves ordinary prose untouched", () => {
    expect(breakLongTokens("The Backyard Soil Handbook", 12)).toBe(
      "The Backyard Soil Handbook"
    );
  });

  it("hard-breaks a token longer than the budget", () => {
    expect(breakLongTokens("abcdefghij", 4)).toBe("abcd efgh ij");
  });

  it("breaks only the long token, keeping its neighbours whole", () => {
    expect(breakLongTokens("go to averyverylongdomain now", 6)).toBe(
      "go to averyv erylon gdomai n now"
    );
  });

  it("collapses whitespace runs rather than emitting empty tokens", () => {
    expect(breakLongTokens("a   b\n\nc", 10)).toBe("a b c");
  });

  it("is a no-op on a degenerate budget instead of looping forever", () => {
    expect(breakLongTokens("abc", 0)).toBe("abc");
  });
});

describe("renderCaptionCardPng — the QR collision guard (regression)", () => {
  /** Alpha bounding box of the rendered card. */
  const extent = async (png: Buffer) => {
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let left = info.width;
    let right = -1;
    let top = info.height;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * info.channels + 3] > 0) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
        }
      }
    }
    return { left, right, top };
  };

  /**
   * The CTA QR card's left edge, from `buildSceneMuxArgs`' own geometry: a square 28% of frame
   * height, inset by a 4.5% margin, bottom-right. An asset beat carries BOTH overlays, so a
   * caption reaching past this covers the code viewers are told to scan.
   */
  const qrLeftEdge = (w: number, h: number) =>
    w - Math.round(h * 0.28) - Math.round(h * 0.045);

  it("keeps a SPACELESS caption inside its card instead of running the full frame width", async () => {
    // The original defect: `wrapWords` only breaks on whitespace, so one long token became a
    // single over-wide centre-anchored line that ran off both edges of the frame.
    const png = await renderCaptionCardPng({
      text: "x".repeat(200),
      width: W,
      height: H,
    });
    const { left, right } = await extent(png as Buffer);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThan(qrLeftEdge(W, H));
  });

  it("keeps a long URL — the realistic version of that input — clear of the QR", async () => {
    const png = await renderCaptionCardPng({
      text: "TheBackyardSoilHandbook.com/offer/autumn-special-forty-two-recipes",
      width: W,
      height: H,
    });
    const { right } = await extent(png as Buffer);
    expect(right).toBeLessThan(qrLeftEdge(W, H));
  });

  it("clears the QR at every caption length, not just the extremes", async () => {
    for (const text of [
      "Short",
      "The Backyard Soil Handbook",
      "42 soil recipes, worked out for every crop — $11 and it ships anywhere",
      "y".repeat(CAPTION_MAX_CHARS),
    ]) {
      const png = await renderCaptionCardPng({ text, width: W, height: H });
      const { right, top } = await extent(png as Buffer);
      expect(right).toBeLessThan(qrLeftEdge(W, H));
      // …and stays in the lower band rather than riding up over the artwork. A wrapped
      // three-line caption is legitimately tall, so this bounds the card, not its first line.
      expect(top).toBeGreaterThan(H * 0.55);
    }
  });

  it("stays symmetric about the frame centre, so it reads as a caption and not a sidebar", async () => {
    const png = await renderCaptionCardPng({
      text: "42 soil recipes, worked out for every crop",
      width: W,
      height: H,
    });
    const { left, right } = await extent(png as Buffer);
    expect(Math.abs((left + right) / 2 - W / 2)).toBeLessThan(4);
  });
});

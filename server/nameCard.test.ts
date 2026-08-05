import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { renderNameCardPng } from "./nameCard";

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
      name: "Steve Calloway",
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
      name: "Steve Calloway",
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
      name: "Steve Calloway",
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

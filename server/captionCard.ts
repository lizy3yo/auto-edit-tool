import sharp from "sharp";
import { escapeXml, estimateTextWidth, fitLines } from "./coverComposite";
import { getInterFontsBase64 } from "./fontData";
import { ensureFontConfig } from "./fontConfig";

/** Multiplier matching coverComposite's measurements for Inter semibold-ish body text. */
const CAPTION_W = 0.56;

/**
 * Longest caption we will lay out. Past this the text stops being a caption and starts being a
 * paragraph nobody reads at arm's length — it is truncated with an ellipsis rather than shrunk
 * until illegible.
 */
export const CAPTION_MAX_CHARS = 140;

/**
 * Render an asset beat's caption as a FULL-FRAME transparent PNG with the card baked in at its
 * final bottom-centre position — the same shape as `renderNameCardPng`, so the ffmpeg overlay is
 * a fixed `0:0` with no position maths in the filter graph (see `buildSceneMuxArgs`).
 *
 * Bottom-CENTRE deliberately: the host lower third owns bottom-left and the CTA QR card owns
 * bottom-right, and an asset beat can carry the QR at the same time. The card is width-capped at
 * 62% of the frame so it clears the QR card's column even at its widest.
 *
 * Text is rasterized through sharp/librsvg — the same path as the ebook covers and the name card,
 * NOT ffmpeg `drawtext`, because the production ffmpeg build may lack libfreetype entirely (see
 * `resolveFFmpegPath`).
 *
 * Returns `null` for a blank caption, so callers treat "no caption typed" as simply no card.
 */
export async function renderCaptionCardPng(opts: {
  text?: string | null;
  width: number;
  height: number;
}): Promise<Buffer | null> {
  const raw = opts.text?.trim() ?? "";
  if (!raw) return null;
  const text =
    raw.length > CAPTION_MAX_CHARS
      ? `${raw.slice(0, CAPTION_MAX_CHARS - 1).trimEnd()}…`
      : raw;

  // librsvg has no system fonts in production — point fontconfig at the bundled Inter first.
  ensureFontConfig();
  const { bold, regular } = getInterFontsBase64();

  const W = opts.width;
  const H = opts.height;
  const padX = Math.round(W * 0.026);
  const padY = Math.round(H * 0.028);
  const marginY = Math.round(H * 0.072);
  // Clear of the QR card's column (~28% of frame height square, bottom-right) at every width.
  const maxTextW = Math.round(W * 0.62) - padX * 2;

  const { fontSize, lines } = fitLines(
    text,
    maxTextW,
    Math.round(H * 0.05), // start large — this exists to be readable on a phone
    Math.round(H * 0.03), // and never shrink past legible; wrap instead
    CAPTION_W
  );
  const lineH = Math.round(fontSize * 1.24);

  const textW = Math.max(
    ...lines.map(l => estimateTextWidth(l, fontSize, CAPTION_W))
  );
  const cardW = Math.round(Math.min(textW, maxTextW) + padX * 2);
  const cardH = lines.length * lineH + padY * 2;
  const cardX = Math.round((W - cardW) / 2);
  const cardY = H - marginY - cardH;

  let y = cardY + padY;
  const textSvg: string[] = [];
  for (const line of lines) {
    textSvg.push(
      `<text x="${W / 2}" y="${y}" font-size="${fontSize}" font-family="Inter" ` +
        `font-weight="700" fill="white" text-anchor="middle" ` +
        `dominant-baseline="hanging">${escapeXml(line)}</text>`
    );
    y += lineH;
  }

  // The scrim is near-opaque on purpose: an asset beat is a product render, so the caption sits
  // over busy, bright artwork where a subtle wash would leave the text unreadable — which is the
  // one thing this card exists to prevent.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      @font-face { font-family: 'Inter'; font-weight: 700; src: url('data:font/truetype;base64,${bold}'); }
      @font-face { font-family: 'Inter'; font-weight: 400; src: url('data:font/truetype;base64,${regular}'); }
    </style>
  </defs>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="14" fill="#0D0D0D" fill-opacity="0.82"/>
  ${textSvg.join("\n  ")}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

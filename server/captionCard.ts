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
 * Hard-break any token longer than `maxChars`.
 *
 * `wrapWords` (shared with the covers and the name card) only ever breaks on whitespace, so a
 * single long token — a URL, a hashtag, a run-on — is emitted as one over-wide line. The SVG text
 * is centre-anchored and unclipped, so that line does not merely overflow its card: it runs off
 * BOTH edges of the frame, straight across the bottom-right corner where the CTA QR sits. An
 * operator typing `TheBackyardSoilHandbook.com/offer` would have covered the code viewers are
 * being asked to scan.
 *
 * Breaking here rather than in `wrapWords` keeps the covers and the lower third byte-identical —
 * they have their own width budgets and no QR to collide with. Pure — unit-tested.
 */
export function breakLongTokens(text: string, maxChars: number): string {
  if (maxChars < 1) return text;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap(word => {
      if (word.length <= maxChars) return [word];
      const parts: string[] = [];
      for (let i = 0; i < word.length; i += maxChars) {
        parts.push(word.slice(i, i + maxChars));
      }
      return parts;
    })
    .join(" ");
}

/**
 * Render an asset beat's caption as a FULL-FRAME transparent PNG with the card baked in at its
 * final bottom-centre position — the same shape as `renderNameCardPng`, so the ffmpeg overlay is
 * a fixed `0:0` with no position maths in the filter graph (see `buildSceneMuxArgs`).
 *
 * Bottom-CENTRE deliberately: the host lower third owns bottom-left and the CTA QR card owns
 * bottom-right, and an asset beat can carry the QR at the same time. The card's width budget is
 * derived from the QR's own geometry so it clears that column at its widest — see `maxTextW`.
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
  // Width budget, DERIVED from the QR card rather than guessed: an asset beat carries the corner
  // QR too, and the caption is centred, so the card may only grow until its right edge reaches the
  // QR's left edge. `QR_*` mirror `buildSceneMuxArgs`' corner geometry — the two must agree, and
  // deriving it here is what makes that agreement checkable instead of coincidental.
  //
  // 16:9 only, which is all this pipeline produces (`TALKING_HEAD_ASPECT_RATIO`). On a portrait
  // canvas the QR card would reach past the frame's centre line and no CENTRED caption could clear
  // it — that layout needs the caption stacked above the QR, not beside it. The clamp below keeps
  // such a canvas merely narrow rather than negative.
  const QR_CARD_FRAC = 0.28;
  const QR_MARGIN_FRAC = 0.045;
  const qrLeftEdge =
    W - Math.round(H * QR_CARD_FRAC) - Math.round(H * QR_MARGIN_FRAC);
  const maxTextW = Math.max(
    Math.round(W * 0.3),
    Math.min(
      Math.round(W * 0.62),
      // Centred, so half the card lives right of centre; leave a small visual gutter.
      2 * (qrLeftEdge - Math.round(W / 2)) - Math.round(W * 0.012)
    ) -
      padX * 2
  );
  const startFs = Math.round(H * 0.05); // start large — this exists to be readable on a phone
  const minFs = Math.round(H * 0.03); // and never shrink past legible; wrap instead

  // Break tokens too long to fit even at the SMALLEST size we will use, so `fitLines` always has
  // a wrappable string. Without this a spaceless caption overflows the frame — see
  // `breakLongTokens`. Budget at `minFs`, the size that fits the most characters per line.
  const maxCharsPerLine = Math.max(
    1,
    Math.floor(maxTextW / (minFs * CAPTION_W))
  );
  const { fontSize, lines } = fitLines(
    breakLongTokens(text, maxCharsPerLine),
    maxTextW,
    startFs,
    minFs,
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
  // The text is CLIPPED to the card. `estimateTextWidth` is exactly that — an estimate — and
  // librsvg ignores `textLength`, so a line can still measure a little wider than predicted. Left
  // unclipped, centre-anchored text does not just overspill its scrim: it runs off both edges of
  // the frame and across the bottom-right corner where the CTA QR sits. Clipping bounds the worst
  // case to a clipped glyph instead of a caption drawn over the code we are asking viewers to
  // scan. `breakLongTokens` above is what stops it being reached in the first place.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      @font-face { font-family: 'Inter'; font-weight: 700; src: url('data:font/truetype;base64,${bold}'); }
      @font-face { font-family: 'Inter'; font-weight: 400; src: url('data:font/truetype;base64,${regular}'); }
    </style>
    <clipPath id="cardClip">
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="14"/>
    </clipPath>
  </defs>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="14" fill="#0D0D0D" fill-opacity="0.82"/>
  <g clip-path="url(#cardClip)">
  ${textSvg.join("\n  ")}
  </g>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

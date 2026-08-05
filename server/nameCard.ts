import sharp from "sharp";
import { escapeXml, estimateTextWidth, fitLines } from "./coverComposite";
import { getInterFontsBase64 } from "./fontData";
import { ensureFontConfig } from "./fontConfig";

/** Multipliers matching coverComposite's measurements for Inter. */
const BOLD_W = 0.66;
const REGULAR_W = 0.52;

type Block = {
  lines: string[];
  fontSize: number;
  weight: 400 | 700;
  opacity: number;
  lineH: number;
  gapAbove: number;
};

/**
 * Render the host lower-third ("Riley Danvers" / "Gardener" / "Fresno, CA") as a
 * FULL-FRAME transparent PNG with the card baked in at its final bottom-left
 * position. Full-frame keeps the ffmpeg overlay a fixed `0:0` — no position math
 * in the filter graph (see `buildSceneMuxArgs`).
 *
 * Bottom-LEFT deliberately: the CTA QR card lives bottom-right.
 *
 * Text is rasterized through sharp/librsvg (the same path as the ebook covers),
 * NOT ffmpeg `drawtext` — the production ffmpeg build may lack libfreetype
 * entirely (see `resolveFFmpegPath`).
 *
 * Returns `null` when every line is blank, so callers can treat "channel has no
 * host identity configured" as simply no card.
 */
export async function renderNameCardPng(opts: {
  name?: string | null;
  title?: string | null;
  location?: string | null;
  width: number;
  height: number;
}): Promise<Buffer | null> {
  const name = opts.name?.trim() ?? "";
  const title = opts.title?.trim() ?? "";
  const location = opts.location?.trim() ?? "";
  if (!name && !title && !location) return null;

  // Ensure librsvg can resolve Inter via fontconfig (prod has no system fonts).
  ensureFontConfig();
  const { bold, regular } = getInterFontsBase64();

  const W = opts.width;
  const H = opts.height;
  const pad = Math.round(W * 0.022);
  const marginX = Math.round(W * 0.052);
  const marginY = Math.round(H * 0.09);
  // Cap the card at ~42% of the frame so a long name wraps/shrinks instead of
  // running under the host's face.
  const maxTextW = Math.round(W * 0.42) - pad * 2;

  const blocks: Block[] = [];
  if (name) {
    const { fontSize, lines } = fitLines(
      name,
      maxTextW,
      Math.round(H * 0.041),
      Math.round(H * 0.026),
      BOLD_W
    );
    blocks.push({
      lines,
      fontSize,
      weight: 700,
      opacity: 1,
      lineH: Math.round(fontSize * 1.18),
      gapAbove: 0,
    });
  }
  for (const [text, opacity] of [
    [title, 0.92],
    [location, 0.72],
  ] as const) {
    if (!text) continue;
    const { fontSize, lines } = fitLines(
      text,
      maxTextW,
      Math.round(H * 0.028),
      Math.round(H * 0.019),
      REGULAR_W
    );
    blocks.push({
      lines,
      fontSize,
      weight: 400,
      opacity,
      lineH: Math.round(fontSize * 1.3),
      // Breathe under the name; the two sub-lines sit tight together.
      gapAbove: blocks.length === 1 ? Math.round(fontSize * 0.35) : 0,
    });
  }

  const textW = Math.max(
    ...blocks.flatMap(b =>
      b.lines.map(l =>
        estimateTextWidth(l, b.fontSize, b.weight === 700 ? BOLD_W : REGULAR_W)
      )
    )
  );
  const cardW = Math.round(Math.min(textW, maxTextW) + pad * 2);
  const textH = blocks.reduce(
    (acc, b) => acc + b.gapAbove + b.lines.length * b.lineH,
    0
  );
  const cardH = textH + pad * 2;
  const cardY = H - marginY - cardH;

  let y = cardY + pad;
  const textSvg: string[] = [];
  for (const b of blocks) {
    y += b.gapAbove;
    for (const line of b.lines) {
      textSvg.push(
        `<text x="${marginX + pad}" y="${y}" font-size="${b.fontSize}" font-family="Inter" ` +
          `font-weight="${b.weight}" fill="white" fill-opacity="${b.opacity}" ` +
          `dominant-baseline="hanging">${escapeXml(line)}</text>`
      );
      y += b.lineH;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      @font-face { font-family: 'Inter'; font-weight: 700; src: url('data:font/truetype;base64,${bold}'); }
      @font-face { font-family: 'Inter'; font-weight: 400; src: url('data:font/truetype;base64,${regular}'); }
    </style>
  </defs>
  <rect x="${marginX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="10" fill="#0D0D0D" fill-opacity="0.72"/>
  ${textSvg.join("\n  ")}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

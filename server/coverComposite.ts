import sharp from "sharp";
import { getInterFontsBase64 } from "./fontData";
import { ensureFontConfig } from "./fontConfig";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function wrapWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (test.length > maxChars && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Estimate the rendered pixel width of a text string.
 * multiplier: 0.65 for bold uppercase (Inter 700), 0.52 for regular mixed-case.
 * letterSpacing: per-character additional spacing in px.
 */
export function estimateTextWidth(
  text: string,
  fontSize: number,
  multiplier: number,
  letterSpacing = 0
): number {
  return text.length * fontSize * multiplier + text.length * letterSpacing;
}

/**
 * Wrap text and auto-shrink the font size until the widest line fits maxWidth.
 *
 * librsvg ignores SVG `textLength`/`lengthAdjust`, so we cannot compress glyphs
 * — we control fit purely through `font-size` (which librsvg honors) plus
 * word wrapping. Returns the chosen font size and the wrapped lines.
 *
 * multiplier: measured ~0.66 for bold uppercase Inter, ~0.52 for regular.
 */
export function fitLines(
  text: string,
  maxWidth: number,
  startFs: number,
  minFs: number,
  multiplier: number,
  letterSpacing = 0
): { fontSize: number; lines: string[] } {
  const target = maxWidth * 0.96; // safety pad against estimate error
  let lines: string[] = [text];
  for (let fs = startFs; fs >= minFs; fs -= 1) {
    const charsPerLine = Math.max(
      1,
      Math.floor(maxWidth / (fs * multiplier + letterSpacing))
    );
    lines = wrapWords(text, charsPerLine);
    const widest = Math.max(
      ...lines.map(l => estimateTextWidth(l, fs, multiplier, letterSpacing))
    );
    if (widest <= target) return { fontSize: fs, lines };
  }
  return { fontSize: minFs, lines };
}

export async function compositeTextOnCover(
  bgBuffer: Buffer,
  title: string,
  subtitle: string,
  authorName: string
): Promise<Buffer> {
  // Ensure librsvg can resolve Inter via fontconfig (prod has no system fonts).
  ensureFontConfig();

  const { bold, regular } = getInterFontsBase64();
  const meta = await sharp(bgBuffer).metadata();
  const W = meta.width ?? 768;
  const H = meta.height ?? 1024;

  const topH = Math.round(H * 0.36);
  const botH = Math.round(H * 0.22);
  const cx = W / 2;
  const PAD = Math.round(W * 0.07);
  const textW = W - PAD * 2;

  // Title — bold uppercase, letter-spacing 1. Auto-shrink to fit textW.
  const titleLetterSpacing = 1;
  const { fontSize: titleFontSize, lines: titleLines } = fitLines(
    title.toUpperCase(),
    textW,
    52,
    30,
    0.66,
    titleLetterSpacing
  );
  const titleLineH = Math.round(titleFontSize * 1.18);
  const titleBlockH = titleLines.length * titleLineH;

  // Subtitle — regular italic mixed-case.
  const { fontSize: subFontSize, lines: subLines } = fitLines(
    subtitle,
    textW,
    22,
    16,
    0.52,
    0
  );
  const subLineH = Math.round(subFontSize * 1.3);

  const titleStartY = Math.round((topH - titleBlockH) / 2);

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="${cx}" y="${titleStartY + i * titleLineH}" font-size="${titleFontSize}" font-family="Inter" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="hanging" letter-spacing="${titleLetterSpacing}">${escapeXml(line)}</text>`
    )
    .join("\n");

  const subStartY = titleStartY + titleBlockH + 10;
  const subSvg = subLines
    .map(
      (line, i) =>
        `<text x="${cx}" y="${subStartY + i * subLineH}" font-size="${subFontSize}" font-family="Inter" font-weight="400" font-style="italic" fill="white" text-anchor="middle" dominant-baseline="hanging">${escapeXml(line)}</text>`
    )
    .join("\n");

  // Author — bold uppercase, letter-spacing 2. Auto-shrink + wrap if long.
  const authorLetterSpacing = 2;
  const { fontSize: authorFontSize, lines: authorLines } = fitLines(
    authorName.toUpperCase(),
    textW,
    26,
    18,
    0.66,
    authorLetterSpacing
  );
  const authorLineH = Math.round(authorFontSize * 1.2);
  const authorBlockH = authorLines.length * authorLineH;
  const authorStartY =
    H - Math.round(botH * 0.45) - Math.round(authorBlockH / 2);

  const authorSvg = authorLines
    .map(
      (line, i) =>
        `<text x="${cx}" y="${authorStartY + i * authorLineH}" font-size="${authorFontSize}" font-family="Inter" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="hanging" letter-spacing="${authorLetterSpacing}">${escapeXml(line)}</text>`
    )
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <style>
      @font-face { font-family: 'Inter'; font-weight: 700; src: url('data:font/truetype;base64,${bold}'); }
      @font-face { font-family: 'Inter'; font-weight: 400; src: url('data:font/truetype;base64,${regular}'); }
    </style>
    <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0D0D0D" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="#0D0D0D" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0D0D0D" stop-opacity="0"/>
      <stop offset="100%" stop-color="#0D0D0D" stop-opacity="0.88"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${topH}" fill="url(#tg)"/>
  <rect x="0" y="${H - botH}" width="${W}" height="${botH}" fill="url(#bg)"/>
  ${titleSvg}
  ${subSvg}
  ${authorSvg}
</svg>`;

  return sharp(bgBuffer)
    .composite([{ input: Buffer.from(svg), blend: "over" }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

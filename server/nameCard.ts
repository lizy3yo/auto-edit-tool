import sharp from "sharp";
import { escapeXml, fitLines } from "./coverComposite";
import { interFontReady } from "./fontConfig";
import { THEME } from "../graphics/src/theme";

/**
 * The card's look, in px at 1080p (scaled to the frame), taken from the motion graphics' own system
 * (graphics/src/theme.ts, overlays.tsx) so the first graphic of a film matches every one after it.
 * Jobs 405 and 407 opened on a grey rounded box in a serif while every other graphic was Inter on
 * the theme's plate with its accent. Here: the label plate at the overlays' stronger base alpha
 * (StepLabels — the card sits on a live host take, a light wall as often as a dark room), square
 * corners with ChapterLabel's accent edge, the role as ChapterLabel's kicker (accent, upper case,
 * tracked 0.24em) above the name, the place in the theme's secondary white under it.
 */
const STYLE = {
  plate: "rgba(12,16,22,0.74)",
  bar: 7,
  padX: 34,
  padY: 24,
  kicker: { size: 26, min: 18, weight: 700, tracking: 0.24, lineH: 1.3 },
  name: { size: 56, min: 34, weight: 700, tracking: 0, lineH: 1.12 },
  location: { size: 28, min: 20, weight: 400, tracking: 0, lineH: 1.3 },
  /** Space above the name (under the kicker) and above the place (under the name). */
  gapName: 8,
  gapLocation: 4,
  /** The overlays' plate shadow: 0 12px 40px rgba(0,0,0,0.30). */
  shadow: { dy: 12, blur: 20, opacity: 0.3 },
} as const;

/** Inter's cap height, in em — each line's capitals are centred in its line box. */
const CAP_HEIGHT = 0.727;

type BlockStyle = (typeof STYLE)["kicker" | "name" | "location"];

type Block = {
  lines: string[];
  fontSize: number;
  weight: number;
  trackingPx: number;
  fill: string;
  lineH: number;
  gapAbove: number;
  /** Drawn width of the widest line, px. */
  width: number;
};

/** A colour safe to write into the SVG: `#rrggbb`, else the theme's default accent. */
function safeAccent(accent: string | null | undefined): string {
  return accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : THEME.accent;
}

function textEl(
  line: string,
  x: number,
  y: number,
  b: Pick<Block, "fontSize" | "weight" | "trackingPx" | "fill">
): string {
  const tracking = b.trackingPx ? ` letter-spacing="${b.trackingPx.toFixed(2)}"` : "";
  return (
    `<text x="${x}" y="${y.toFixed(1)}" font-size="${b.fontSize}" font-family="${THEME.font}" ` +
    `font-weight="${b.weight}"${tracking} fill="${b.fill}">${escapeXml(line)}</text>`
  );
}

/**
 * The drawn width of one line, measured by drawing it: the card hugs its words instead of guessing
 * from average letter widths (the old guess left a box a third wider than the name).
 */
async function drawnWidth(
  line: string,
  b: Pick<Block, "fontSize" | "weight" | "trackingPx">
): Promise<number> {
  const pad = Math.ceil(b.fontSize);
  const w = Math.ceil(line.length * (b.fontSize + b.trackingPx) + pad * 2);
  const h = Math.ceil(b.fontSize * 2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    textEl(line, pad, b.fontSize * 1.4, { ...b, fill: "white" }) +
    `</svg>`;
  try {
    const { info } = await sharp(Buffer.from(svg))
      .png()
      .trim()
      .toBuffer({ resolveWithObject: true });
    return info.width;
  } catch {
    // Nothing drawn (only spaces) — trim has nothing to keep.
    return 0;
  }
}

/**
 * Fit one block (kicker, name or place) into `maxW`: its own size when the line fits, smaller down
 * to its floor, then wrapped at the floor. Widths are MEASURED at the starting size and scaled
 * (type scales linearly), so the wrap uses this text's real letter widths, not an average.
 */
async function layoutBlock(
  text: string,
  style: BlockStyle,
  scale: number,
  maxW: number,
  fill: string,
  gapAbove: number
): Promise<Block> {
  const start = Math.round(style.size * scale);
  const min = Math.round(style.min * scale);
  const trackingAt = (fs: number) => fs * style.tracking;
  const at = (fs: number) => ({ fontSize: fs, weight: style.weight, trackingPx: trackingAt(fs) });
  const full = await drawnWidth(text, at(start));
  let fontSize = start;
  let lines = [text];
  if (full > maxW) {
    const fits = Math.floor((start * maxW) / full);
    if (fits >= min) fontSize = fits;
    else {
      // Too long even at the floor: wrap there, using this text's measured letter width.
      fontSize = min;
      const perChar = full / start / Math.max(1, text.length);
      lines = fitLines(text, maxW, min, min, perChar).lines;
    }
  }
  const widths = await Promise.all(lines.map(l => drawnWidth(l, at(fontSize))));
  return {
    lines,
    fontSize,
    weight: style.weight,
    trackingPx: trackingAt(fontSize),
    fill,
    lineH: Math.round(fontSize * style.lineH),
    gapAbove,
    width: Math.min(maxW, Math.max(...widths)),
  };
}

/**
 * Render the host lower-third ("CAT TRAINER" / "Riley Danvers" / "Fresno, CA") as a FULL-FRAME
 * transparent PNG with the card baked in at its final bottom-left position. Full-frame keeps the
 * ffmpeg overlay a fixed `0:0` — no position math in the filter graph (see `buildSceneMuxArgs`).
 *
 * Bottom-LEFT deliberately: the CTA QR card lives bottom-right.
 *
 * Text is rasterized through sharp/librsvg (the same path as the ebook covers), NOT ffmpeg
 * `drawtext` — the production ffmpeg build may lack libfreetype entirely (see
 * `resolveFFmpegPath`). Inter is registered first (`interFontReady`): without it a Windows machine
 * drew the card in Times (jobs 405, 407).
 *
 * `accent` is the channel's graphics accent (from its host photo, `themeFromPixels`), so the card
 * carries the same colour as the film's graphics; unset ⇒ the theme's default.
 *
 * Returns `null` when every line is blank, so callers can treat "channel has no host identity
 * configured" as simply no card.
 */
export async function renderNameCardPng(opts: {
  name?: string | null;
  title?: string | null;
  location?: string | null;
  accent?: string | null;
  width: number;
  height: number;
}): Promise<Buffer | null> {
  const name = opts.name?.trim() ?? "";
  const title = opts.title?.trim() ?? "";
  const location = opts.location?.trim() ?? "";
  if (!name && !title && !location) return null;

  await interFontReady();

  const W = opts.width;
  const H = opts.height;
  const scale = H / 1080;
  const px = (v: number) => Math.round(v * scale);
  const bar = Math.max(2, px(STYLE.bar));
  const padX = px(STYLE.padX);
  const padY = px(STYLE.padY);
  const marginX = Math.round(W * 0.052);
  const marginY = Math.round(H * 0.09);
  // Cap the card at ~42% of the frame so a long name wraps/shrinks instead of running under the
  // host's face.
  const maxTextW = Math.round(W * 0.42) - bar - padX * 2;
  const accent = safeAccent(opts.accent);

  const blocks: Block[] = [];
  if (title)
    blocks.push(await layoutBlock(title.toUpperCase(), STYLE.kicker, scale, maxTextW, accent, 0));
  if (name)
    blocks.push(
      await layoutBlock(name, STYLE.name, scale, maxTextW, THEME.text, blocks.length ? px(STYLE.gapName) : 0)
    );
  if (location)
    blocks.push(
      await layoutBlock(
        location,
        STYLE.location,
        scale,
        maxTextW,
        THEME.textSecondary,
        blocks.length ? px(STYLE.gapLocation) : 0
      )
    );

  const textW = Math.max(...blocks.map(b => b.width));
  const textH = blocks.reduce((acc, b) => acc + b.gapAbove + b.lines.length * b.lineH, 0);
  const cardW = bar + padX + textW + padX;
  const cardH = textH + padY * 2;
  const cardY = H - marginY - cardH;
  const textX = marginX + bar + padX;

  let top = cardY + padY;
  const textSvg: string[] = [];
  for (const b of blocks) {
    top += b.gapAbove;
    for (const line of b.lines) {
      // Alphabetic baseline with the capitals centred in the line box: every renderer agrees on
      // it, where "hanging" moves between librsvg versions.
      textSvg.push(textEl(line, textX, top + (b.lineH + CAP_HEIGHT * b.fontSize) / 2, b));
      top += b.lineH;
    }
  }

  // The shadow is drawn only OUTSIDE the plate, as a CSS box-shadow is: under a translucent plate it
  // would darken the plate past the graphics' own.
  const sh = STYLE.shadow;
  const box = `x="${marginX}" y="${cardY}" width="${cardW}" height="${cardH}"`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <filter id="plate-shadow" x="-30%" y="-60%" width="160%" height="240%">
      <feDropShadow dx="0" dy="${px(sh.dy)}" stdDeviation="${px(sh.blur)}" flood-color="#000" flood-opacity="${sh.opacity}"/>
    </filter>
    <mask id="outside-plate">
      <rect width="${W}" height="${H}" fill="white"/>
      <rect ${box} fill="black"/>
    </mask>
  </defs>
  <g mask="url(#outside-plate)"><rect ${box} fill="#000" filter="url(#plate-shadow)"/></g>
  <rect ${box} fill="${STYLE.plate}"/>
  <rect x="${marginX}" y="${cardY}" width="${bar}" height="${cardH}" fill="${accent}"/>
  ${textSvg.join("\n  ")}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

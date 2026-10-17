// The graphics' colours, taken from the channel's own HOST PHOTO, so every channel's cards match its
// host instead of all sharing Steve Cooper's navy and blue.
//
// Method — Google's Material Color Utilities (Apache-2.0; the engine behind Android's "Material
// You" dynamic colour): the photo is quantized (Celebi), its colours VOTE by hue (share of the
// photo × chroma; greys and skin never vote — see `sourceColour`), and the winner becomes a tonal
// palette in HCT space, where "tone" is perceptual lightness. The card ground, glow and
// accent are tones of that one hue, so they always belong together.
//
// Readability is GUARANTEED, not hoped for: every text colour is pushed to the tone that meets its
// WCAG 2.x contrast minimum against the ground it sits on (body text 7:1, the accent 4.5:1, quiet
// secondary text 3:1 — large text), and the tests fail on any pair that does not.
//
// Pure — no I/O. `scripts/theme.mts` reads the photo and writes a channel's theme.
import { Contrast, Hct, QuantizerCelebi, TonalPalette, argbFromRgb, hexFromArgb } from "@material/material-color-utilities";
import { THEME, type Theme } from "./theme";

/** Skin is never the brand colour: a host photo is mostly face and hands. Hue/chroma/tone window
 * (HCT) that covers light to deep skin under ordinary indoor light. */
function isSkin(h: Hct): boolean {
  return h.hue >= 20 && h.hue <= 75 && h.chroma >= 8 && h.chroma <= 48 && h.tone >= 25 && h.tone <= 88;
}

/** The warning red's hue (HCT). An accent too close to it would make a warning read as decoration. */
const DANGER_HUE = Hct.fromInt(0xffff5a4e).hue;

/** Tone of the card ground. Steve's measured #0B192B is tone ~9. */
const GROUND_TONE = 9;
const GLOW_TONE = 17;

export type PaletteReport = {
  source: string;
  sourceHue: number;
  sourceChroma: number;
  /** WCAG contrast ratios actually achieved. */
  contrast: { text: number; accent: number; muted: number; accentOnPlate: number };
  /** Why the source was chosen, or why the default was kept. */
  note: string;
};

/** WCAG relative-luminance contrast between two colours. */
export function contrastRatio(a: number, b: number): number {
  return Contrast.ratioOfTones(Hct.fromInt(a).tone, Hct.fromInt(b).tone);
}

/** Lightest-first: the tone at or above `from` that reaches `ratio` against a ground tone. */
function toneFor(groundTone: number, from: number, ratio: number): number {
  for (let t = Math.max(from, groundTone); t <= 100; t += 1) if (Contrast.ratioOfTones(t, groundTone) >= ratio) return t;
  return 100;
}

/**
 * Theme from a photo's pixels (ARGB ints). Falls back to the default theme when nothing in the
 * photo can carry a brand (a grey room and a grey shirt).
 */
export function themeFromPixels(pixels: number[]): { theme: Theme; report: PaletteReport } {
  const source = sourceColour(pixels);
  if (source === undefined) {
    return {
      theme: THEME,
      report: { source: "default", sourceHue: 0, sourceChroma: 0, contrast: contrastOf(THEME), note: "no colour in the photo could carry a brand; default navy and blue kept" },
    };
  }
  const src = Hct.fromInt(source);
  // Keep the hue; give the accent enough colour to read as one, and the ground just a tint of it.
  let hue = src.hue;
  let note = `strongest usable colour in the photo, hue ${Math.round(src.hue)}°, chroma ${Math.round(src.chroma)}`;
  if (Math.abs(((hue - DANGER_HUE + 540) % 360) - 180) < 25) {
    // Red-ish source: a red accent would look like a warning everywhere. Warm it to orange.
    hue = (DANGER_HUE + 30) % 360;
    note += "; moved off the warning red";
  }
  const accentPalette = TonalPalette.fromHueAndChroma(hue, Math.max(48, Math.min(src.chroma, 80)));
  const groundPalette = TonalPalette.fromHueAndChroma(hue, Math.min(Math.max(src.chroma * 0.35, 8), 16));
  const neutral = TonalPalette.fromHueAndChroma(hue, 6);

  const accentTone = toneFor(GROUND_TONE, 68, 4.5);
  const theme: Theme = {
    ...THEME,
    bg: hexFromArgb(groundPalette.tone(GROUND_TONE)),
    glow: hexFromArgb(groundPalette.tone(GLOW_TONE)),
    accent: hexFromArgb(accentPalette.tone(accentTone)),
    text: "#FFFFFF",
    textSecondary: "rgba(255,255,255,0.86)",
    textMuted: hexFromArgb(neutral.tone(toneFor(GROUND_TONE, 45, 3))),
  };
  return { theme, report: { source: hexFromArgb(source), sourceHue: Math.round(src.hue), sourceChroma: Math.round(src.chroma), contrast: contrastOf(theme), note } };
}

/** Below this chroma a colour is a grey: a wall, a ceiling, a grey shirt. */
const MIN_SOURCE_CHROMA = 12;
const HUE_BIN = 15;

/**
 * The photo's brand colour: a HUE VOTE over the quantized clusters. One coloured garment comes back
 * from the quantizer as many small clusters of the same hue (Frederick's navy tee: seven clusters
 * of 2-4% each, ~20% together), which Material's own `Score` passed over for one large grey wall
 * cluster (chroma 5). So clusters are pooled by hue (15° bins), each weighted by its share of the
 * photo times its chroma (capped at 40, so a small neon object cannot outvote a shirt); greys
 * (chroma < 12) and skin never vote. The winner is the bin's most populous cluster.
 */
function sourceColour(pixels: number[]): number | undefined {
  const quantized = QuantizerCelebi.quantize(pixels, 128);
  const bins = new Map<number, { weight: number; best: number; bestN: number }>();
  for (const [argb, n] of Array.from(quantized)) {
    const h = Hct.fromInt(argb);
    if (h.chroma < MIN_SOURCE_CHROMA || isSkin(h)) continue;
    const bin = Math.floor(h.hue / HUE_BIN);
    const b = bins.get(bin) ?? { weight: 0, best: argb, bestN: 0 };
    b.weight += (n / pixels.length) * Math.min(h.chroma, 40);
    if (n > b.bestN) {
      b.best = argb;
      b.bestN = n;
    }
    bins.set(bin, b);
  }
  let winner: { weight: number; best: number } | undefined;
  for (const b of Array.from(bins.values())) if (!winner || b.weight > winner.weight) winner = b;
  // A trace of colour is not a brand: at least ~1% of the photo at full chroma.
  return winner && winner.weight >= 0.4 ? winner.best : undefined;
}

function argbOf(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return (0xff000000 | parseInt(m[1], 16)) >>> 0;
}

/** The contrast every theme is held to (the plate is the dark translucent label background,
 * measured over mid-grey footage as its worst realistic case). */
export function contrastOf(t: Theme): PaletteReport["contrast"] {
  const bg = argbOf(t.bg);
  const plateOverGrey = argbFromRgb(62, 64, 68);
  return {
    text: round2(contrastRatio(argbOf(t.text), bg)),
    accent: round2(contrastRatio(argbOf(t.accent), bg)),
    muted: round2(contrastRatio(argbOf(t.textMuted), bg)),
    accentOnPlate: round2(contrastRatio(argbOf(t.accent), plateOverGrey)),
  };
}

/** WCAG minimums the theme must meet. */
export const MIN_CONTRAST = { text: 7, accent: 4.5, muted: 3, accentOnPlate: 3 } as const;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** `#rrggbb` at an alpha, for glows and tints that follow the accent. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** `#rrggbb` mixed toward white by `t` (0-1). */
export function towardWhite(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const m = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, "0");
  return `#${m((n >> 16) & 255)}${m((n >> 8) & 255)}${m(n & 255)}`;
}

/**
 * The theme a cue renders with: the video's own (from its host photo) or the default, and — when
 * the composite measured its coloured words too dark to read on the picture — `lift` (0-1) moves
 * the accent and the warning red toward white, the same colour in a lighter shade. `plain` is the
 * last fix before a graphic is left out: the accent drawn in the theme's plain text colour (white
 * on the dim ground), so the number or key word reads like the rest of the text, its colour given
 * up. The warning red keeps its colour (it says "warning"). One function, used by the renderer
 * (Root) and by the readability check (which needs the exact text colours).
 */
export function themeFor(props: { theme?: unknown; lift?: unknown; plain?: unknown }): Theme {
  const base = props.theme ? { ...THEME, ...(props.theme as Partial<Theme>) } : THEME;
  const lift = typeof props.lift === "number" ? Math.min(1, Math.max(0, props.lift)) : 0;
  const t = lift ? { ...base, accent: towardWhite(base.accent, 0.4 * lift), danger: towardWhite(base.danger, 0.4 * lift) } : base;
  if (props.plain !== true) return t;
  // The accent stays a #rrggbb (glows `withAlpha` and the readability check's inks parse it), and
  // accent and text stay the SAME string: the check's inks and a step disc (NumberDot) both read
  // "drawn plain" as accent === text, and a mismatch would draw a white digit on a white disc.
  const ink = /^#[0-9a-f]{6}$/i.test(base.text) ? base.text : "#FFFFFF";
  return { ...t, accent: ink, text: ink };
}

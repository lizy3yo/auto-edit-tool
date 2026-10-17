// The building blocks every template is made of. A template never styles text or draws a
// background on its own — it composes these, which is what keeps fourteen templates one look.
import React from "react";
import {
  AbsoluteFill,
  Img,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { withAlpha } from "./palette";
import { THEME, TYPE, type Theme } from "./theme";
import { fadeIn, pageStarts, splitWords, strikeSweep, wordFrames, type Phrase } from "./timing";

export const ThemeContext = React.createContext<Theme>(THEME);
export const useTheme = () => React.useContext(ThemeContext);

/**
 * READABILITY on footage. Text laid over a picture can land on a white box or a bright window, so
 * every text graphic on footage takes a `shade` (0-1): how much MORE it darkens behind its words
 * than its normal look. 0 is the designed look; the composite measures the real contrast on the
 * rendered frames and raises it only where the picture needs it (scripts/legibility.mts).
 */
export const shaded = (base: number, shade = 0, max = 0.92): number => base + (max - base) * Math.min(1, Math.max(0, shade));

/** Where a movable text graphic sits: side and band of the frame (title-safe). The composite
 * moves one to the calmest part of the picture when its first place is too bright to read. */
export type Place = { h: "left" | "right"; v: "top" | "middle" | "bottom" };
export const PLACES: Place[] = [
  { h: "left", v: "middle" },
  { h: "left", v: "top" },
  { h: "left", v: "bottom" },
  { h: "right", v: "middle" },
  { h: "right", v: "top" },
  { h: "right", v: "bottom" },
];

/** Absolute position for a block of text at `place`; `align` follows the side. */
export function placeStyle(place: Place | undefined, height: number): React.CSSProperties {
  const p = place ?? PLACES[0];
  const top = p.v === "top" ? 150 : p.v === "bottom" ? 1080 - 170 - height : (1080 - height) / 2;
  return {
    position: "absolute",
    top,
    ...(p.h === "left" ? { left: 160 } : { right: 160 }),
    textAlign: p.h === "left" ? "left" : "right",
    display: "flex",
    flexDirection: "column",
    alignItems: p.h === "left" ? "flex-start" : "flex-end",
  };
}

/** A soft dark pool behind a block of text (no hard box): stronger with `shade`. */
export const textPool = (shade = 0): React.CSSProperties =>
  shade > 0
    ? {
        background: `radial-gradient(ellipse 60% 70% at 50% 50%, rgba(0,0,0,${(0.62 * shade).toFixed(3)}) 0%, rgba(0,0,0,${(0.38 * shade).toFixed(3)}) 55%, rgba(0,0,0,0) 100%)`,
        padding: "40px 60px",
        margin: "-40px -60px",
      }
    : {};

/** Soft shadow every piece of text on a card carries (measured off the reference). */
export const TEXT_SHADOW = "0 6px 28px rgba(0,0,0,0.35)";

/** Navy card ground: flat colour, a soft centre glow, and the faint 120 px grid. */
export const CardBackground: React.FC = () => {
  const t = useTheme();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: t.bg,
        backgroundImage: [
          `radial-gradient(ellipse 34% 40% at 52% 50%, ${t.glow} 0%, rgba(0,0,0,0) 100%)`,
          `linear-gradient(${t.grid} 1px, transparent 1px)`,
          `linear-gradient(90deg, ${t.grid} 1px, transparent 1px)`,
        ].join(","),
        backgroundSize: `100% 100%, ${t.gridStep}px ${t.gridStep}px, ${t.gridStep}px ${t.gridStep}px`,
      }}
    />
  );
};

/** A spring entrance from `atFrame`: fades and rises `rise` px. Returns style to spread. */
export function useEnter(atFrame: number, rise = 18): React.CSSProperties {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - atFrame,
    fps,
    config: { damping: 200, stiffness: 140, mass: 0.7 },
  });
  return {
    opacity: frame < atFrame ? 0 : Math.min(1, s * 1.15),
    transform: `translateY(${(1 - s) * rise}px)`,
  };
}

/**
 * The small spaced label above a card's text ("BEHIND THE DOOR", "[ MYTH ]"), with the short
 * accent underline when it is not bracketed — the two variants on the reference.
 */
export const Kicker: React.FC<{
  text: string;
  bracketed?: boolean;
  atFrame?: number;
  color?: string;
  size?: number;
}> = ({ text, bracketed, atFrame = 0, color, size = TYPE.kicker }) => {
  const t = useTheme();
  const enter = useEnter(atFrame, 8);
  const c = color ?? t.accent;
  return (
    <div style={{ ...enter, display: "inline-block" }}>
      <div
        style={{
          fontFamily: t.font,
          fontWeight: 700,
          fontSize: size,
          letterSpacing: TYPE.kickerTracking,
          textTransform: "uppercase",
          color: c,
          whiteSpace: "nowrap",
        }}
      >
        {bracketed ? (
          <>
            <span style={{ color: "rgba(255,255,255,0.55)" }}>[ </span>
            {text}
            <span style={{ color: "rgba(255,255,255,0.55)" }}> ]</span>
          </>
        ) : (
          text
        )}
      </div>
      {!bracketed && (
        <div
          style={{
            marginTop: size * 0.45,
            width: size * 4,
            height: Math.max(3, Math.round(size * 0.13)),
            borderRadius: 2,
            background: c,
          }}
        />
      )}
    </div>
  );
};

/** A strike's stroke, in the words' own size: 7 px on the 88 px myth, as the old bar was. */
export const STRIKE_THICKNESS = "0.08em";

/**
 * Text that appears word by word exactly as it is spoken. `emphasis` lists the words (matched
 * without punctuation, case-insensitive) drawn in the accent colour — Steve never colours more
 * than one or two, and the planner is held to that, not this component.
 */
export const WordReveal: React.FC<{
  phrase: Phrase;
  style?: React.CSSProperties;
  emphasis?: string[];
  emphasisColor?: string;
  uppercase?: boolean;
  /** Words not yet spoken: hidden (default) or shown dim, as a "ghost" line. */
  ghost?: boolean;
  /** Page a long line like subtitles: at most this many words on screen, the next page replacing
   * it the moment its first word is said — so a whole sentence is shown, never half of it. */
  pageWords?: number;
  /** Strike the words through, the stroke `progress` (0-1) of the way along (`strikeSweep`). */
  strike?: { progress: number; color: string };
}> = ({ phrase, style, emphasis = [], emphasisColor, uppercase, ghost, pageWords, strike }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const measuring = React.useContext(MeasuringContext);
  const all = splitWords(phrase.text);
  const allFrames = wordFrames(phrase, fps);
  const starts = pageStarts(all, pageWords ?? 0);
  let page = 0;
  for (let p = 1; p < starts.length; p++) if (frame >= allFrames[starts[p]]) page = p;
  const from = starts[page];
  const to = starts[page + 1] ?? all.length;
  const words = all.slice(from, to);
  const frames = allFrames.slice(from, to);
  const em = new Set(emphasis.map(norm));
  const reveal = frames.map(f => fadeIn(frame, f));
  const opacity = (i: number) => (ghost ? 0.18 + 0.82 * reveal[i] : reveal[i]);
  // THE STRIKE is a line-through on each word and on each space between two, so it crosses every
  // line exactly where that line's words are, however they wrap and at whatever size (a space the
  // wrap moves to a line's end is not drawn, so neither is its stroke) — one bar across the whole
  // block fell between the two lines of a wrapped myth (job 399). It is drawn on a see-through copy
  // laid exactly over the words, not on the words: there each word's soft shadow fell across the
  // stroke of the space before it, a dark notch between every two words. The copy is built from
  // the SAME elements as the words under it — a struck phrase keeps each space in its own span from
  // its first frame, in both — because line balancing reads the elements, not only the letters:
  // with bare spaces below and spans above, a 14-word myth broke after "attendants" below and after
  // "only" above (test render, 2026-10-18), the stroke across the wrong words. A measuring render
  // leaves it out, as it leaves out every mark that is not a word.
  const sweep = strike && strike.progress > 0 && !measuring ? strikeSweep(words, strike.progress) : undefined;
  const struck = (a: number): React.CSSProperties => ({
    textDecorationLine: "line-through",
    textDecorationColor: withAlpha(strike?.color ?? t.danger, Math.round(a * 1000) / 1000),
    textDecorationThickness: STRIKE_THICKNESS,
  });
  const layer = (stroke?: { words: number[]; gaps: number[] }) =>
    words.map((w, i) => (
      <React.Fragment key={i}>
        <span
          style={{
            display: "inline-block",
            opacity: opacity(i),
            transform: `translateY(${(1 - reveal[i]) * 10}px)`,
            color: stroke ? "transparent" : em.has(norm(w)) ? (emphasisColor ?? t.accent) : undefined,
            textTransform: uppercase ? "uppercase" : undefined,
            ...(stroke ? struck(stroke.words[i]) : null),
          }}
        >
          {w}
        </span>
        {i === words.length - 1 ? null : !strike ? (
          " "
        ) : (
          // a space is struck only once both its words are on screen
          <span style={stroke ? struck(stroke.gaps[i] * Math.min(opacity(i), opacity(i + 1))) : undefined}> </span>
        )}
      </React.Fragment>
    ));
  const own = style?.position;
  return (
    <div
      style={
        {
          textWrap: "balance",
          ...style,
          ...(sweep ? { position: own && own !== "static" ? own : "relative" } : null),
        } as React.CSSProperties
      }
    >
      {layer()}
      {sweep && (
        <div style={{ position: "absolute", inset: 0, padding: "inherit", color: "transparent", textShadow: "none" }}>
          {layer(sweep)}
        </div>
      )}
    </div>
  );
};

/** Anything that is not a letter, digit, apostrophe or hyphen (built at runtime: the app's type
 * check targets a JavaScript older than the Unicode-property regex literal). */
const NOT_WORD_CHAR = new RegExp("[^\\p{L}\\p{N}'-]", "gu");

function norm(w: string): string {
  return w.toLowerCase().replace(NOT_WORD_CHAR, "");
}

/** On when a graphic is rendered only to MEASURE its words' readability: everything that is not a
 * word is left out — icons (pictures; one close to the accent's colour would read as coloured
 * text) and decorative marks (a strike-through line across words). Each keeps its exact box, so
 * the words sit where they sit in the real graphic. */
export const MeasuringContext = React.createContext(false);

/** A Noto Color Emoji icon (Apache-2.0), by code point file name in `public/icons`. */
export const Icon: React.FC<{ code: string; size: number; style?: React.CSSProperties }> = ({
  code,
  size,
  style,
}) =>
  React.useContext(MeasuringContext) ? (
    <div style={{ width: size, height: size, flex: "none", ...style }} />
  ) : (
  <Img
    // The app hands icons in INLINE (a data: URL): a long-running server bundles the templates
    // once, so an icon fetched after that could not be served from the bundle's own folder.
    src={code.startsWith("data:") ? code : staticFile(`icons/${code}.png`)}
    style={{ width: size, height: size, objectFit: "contain", ...style }}
  />
);

/** The round accent "VS" badge. */
export const VsBadge: React.FC<{ atFrame: number; size?: number }> = ({ atFrame, size = 150 }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - atFrame, fps, config: { damping: 14, stiffness: 160 } });
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: t.accent,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: t.font,
        fontWeight: 900,
        fontSize: size * 0.4,
        color: t.bg,
        transform: `scale(${frame < atFrame ? 0 : s})`,
        boxShadow: "0 10px 40px " + withAlpha(t.accent, 0.25),
      }}
    >
      VS
    </div>
  );
};

/** A small numbered accent disc ("1", "2"…) used by step labels and step cards. */
export const NumberDot: React.FC<{ n: number; size: number }> = ({ n, size }) => {
  const t = useTheme();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: t.accent,
        // A disc drawn in the plain text colour (the last readability fix, `plain`) carries its
        // digit in the ground colour: a white digit on a white disc is no digit.
        color: t.accent === t.text ? t.bg : "#fff",
        fontFamily: t.font,
        fontWeight: 800,
        fontSize: size * 0.56,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      {n}
    </div>
  );
};

/** A right-pointing accent arrow that draws itself in from `atFrame`. */
export const Arrow: React.FC<{ atFrame: number; width: number; thickness?: number }> = ({
  atFrame,
  width,
  thickness = 5,
}) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const p = fadeIn(frame, atFrame, 10);
  const head = thickness * 3.2;
  return (
    <svg width={width} height={head * 2} style={{ overflow: "visible", flex: "none" }}>
      <line
        x1={0}
        y1={head}
        x2={(width - head) * p}
        y2={head}
        stroke={t.accent}
        strokeWidth={thickness}
        strokeLinecap="round"
      />
      <polygon
        points={`${width - head * 1.4},${head - head * 0.75} ${width},${head} ${width - head * 1.4},${head + head * 0.75}`}
        fill={t.accent}
        opacity={p >= 0.95 ? 1 : 0}
      />
    </svg>
  );
};

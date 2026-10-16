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
import { fadeIn, splitWords, wordFrames, type Phrase } from "./timing";

export const ThemeContext = React.createContext<Theme>(THEME);
export const useTheme = () => React.useContext(ThemeContext);

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
}> = ({ phrase, style, emphasis = [], emphasisColor, uppercase, ghost }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const words = splitWords(phrase.text);
  const frames = wordFrames(phrase, fps);
  const em = new Set(emphasis.map(norm));
  return (
    <div style={{ textWrap: "balance", ...style } as React.CSSProperties}>
      {words.map((w, i) => {
        const p = fadeIn(frame, frames[i]);
        const isEm = em.has(norm(w));
        return (
          <React.Fragment key={i}>
            <span
              style={{
                display: "inline-block",
                opacity: ghost ? 0.18 + 0.82 * p : p,
                transform: `translateY(${(1 - p) * 10}px)`,
                color: isEm ? (emphasisColor ?? t.accent) : undefined,
                textTransform: uppercase ? "uppercase" : undefined,
              }}
            >
              {w}
            </span>
            {i < words.length - 1 ? " " : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

function norm(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
}

/** A Noto Color Emoji icon (Apache-2.0), by code point file name in `public/icons`. */
export const Icon: React.FC<{ code: string; size: number; style?: React.CSSProperties }> = ({
  code,
  size,
  style,
}) => (
  <Img
    src={staticFile(`icons/${code}.png`)}
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
        color: "#fff",
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

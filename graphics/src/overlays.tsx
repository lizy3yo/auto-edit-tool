// OVERLAYS: drawn ON the footage, rendered with a transparent background (ProRes 4444 alpha) so
// assembly composites them over whatever picture is under them — a b-roll still, a clip or the
// host take. They enter on the word that names them and fade out over their last frames.
//
// Placement keeps clear of what the film already owns: the host name card (bottom-left, cold
// open only) and the CTA QR card (bottom-right). Labels sit bottom-LEFT but above the name
// card's band, and nothing is ever planned inside a CTA block (the planner's rule, not ours).
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Arrow, Icon, NumberDot, TEXT_SHADOW, WordReveal, placeStyle, shaded, textPool, useEnter, useTheme, type Place } from "./components";
import { LAYOUT, TYPE } from "./theme";
import { appearFrame, fadeIn, fadeOutAtEnd, scrimIn, scrimOut, type Phrase } from "./timing";
import type { BaseProps } from "./cards";

export const useAt = () => {
  const { fps } = useVideoConfig();
  return (sec: number) => appearFrame(sec, fps);
};

/** How much more an overlay darkens behind its words (0-1), set per cue from the measured
 * contrast (scripts/legibility.mts). Plates read it through `usePlate`. */
export const ShadeContext = React.createContext(0);
/** The dark label plate at the shade this cue needs (base alpha 0.62-0.74, up to 0.92). */
export const usePlate = (baseAlpha: number): string => {
  const shade = React.useContext(ShadeContext);
  return `rgba(12,16,22,${shaded(baseAlpha, shade).toFixed(3)})`;
};

/** Wraps an overlay so it leaves softly at its end. */
export const ExitContext = React.createContext<"fade" | "cut" | "scrim">("fade");

/** Wraps an overlay so it leaves softly at its end — or with the picture, on a cut. */
export const Leave: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const exit = React.useContext(ExitContext);
  const opacity = exit === "cut" ? 1 : exit === "scrim" ? scrimOut(frame, durationInFrames) : fadeOutAtEnd(frame, durationInFrames);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** Translucent plate behind text on footage: readable on a white wall or a dark room alike. */
export const plate = (bg: string): React.CSSProperties => ({
  background: bg,
  borderRadius: 6,
  boxShadow: "0 12px 40px rgba(0,0,0,0.30)",
});

/* ───────────────────────── Chapter label ───────────────────────── */

export type ChapterProps = BaseProps & {
  /** e.g. "On the label · 1 of 3" — the reference's "QUESTION 1 OF 5". */
  kicker: string;
  number: number;
  title: string;
};

export const ChapterLabel: React.FC<ChapterProps> = ({ kicker, number, title }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const wipe = fadeIn(frame, 0, 12);
  const k = useEnter(5, 10);
  const n = useEnter(8, 16);
  const ti = useEnter(12, 16);
  return (
    <Leave>
      <div
        style={{
          position: "absolute",
          left: 100,
          bottom: 155,
          height: 265,
          width: 960,
          clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
          ...plate(usePlate(0.62)),
          borderRadius: 0,
          borderLeft: `7px solid ${t.accent}`,
          boxSizing: "border-box",
          padding: "40px 44px",
        }}
      >
        <div
          style={{
            ...k,
            fontFamily: t.font,
            fontWeight: 700,
            fontSize: 28,
            letterSpacing: TYPE.kickerTracking,
            textTransform: "uppercase",
            color: t.accent,
          }}
        >
          {kicker}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 34, marginTop: 6 }}>
          <div
            style={{
              ...n,
              fontFamily: t.font,
              fontWeight: 800,
              fontSize: 156,
              lineHeight: 1,
              color: t.accent,
            }}
          >
            {number}
          </div>
          <div
            style={{
              ...ti,
              fontFamily: t.font,
              fontWeight: 800,
              fontSize: 64,
              lineHeight: 1.05,
              paddingBottom: 14,
              textTransform: "uppercase",
              color: t.text,
              maxWidth: 680,
            }}
          >
            {title}
          </div>
        </div>
      </div>
    </Leave>
  );
};

/* ───────────────────────── Step labels (bottom strip) ───────────────────────── */

export type StepLabelsProps = BaseProps & { steps: { text: string; at: number }[] };

const Pill: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const t = useTheme();
  const enter = useEnter(at, 14);
  return (
    <div
      style={{
        ...enter,
        ...plate(usePlate(0.74)),
        borderRadius: 12,
        padding: "14px 22px 14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontFamily: t.font,
        fontWeight: 700,
        fontSize: TYPE.pill + 2,
        color: t.text,
        flex: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
};

export const StepLabels: React.FC<StepLabelsProps> = ({ steps }) => {
  const at = useAt();
  return (
    <Leave>
      <div
        style={{
          position: "absolute",
          left: LAYOUT.actionSafeX,
          bottom: 110,
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Arrow atFrame={at(s.at) - 5} width={58} thickness={4} />}
            <Pill at={at(s.at)}>
              <NumberDot n={i + 1} size={38} />
              {s.text}
            </Pill>
          </React.Fragment>
        ))}
      </div>
    </Leave>
  );
};

/* ───────────────────────── Warning label ───────────────────────── */

export type WarningProps = BaseProps & { label?: string; text: Phrase; emphasis?: string[] };

export const WarningLabel: React.FC<WarningProps> = ({ label = "Warning", text, emphasis }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const wipe = fadeIn(frame, 0, 12);
  return (
    <Leave>
      <div
        style={{
          position: "absolute",
          left: LAYOUT.actionSafeX,
          top: 560,
          maxWidth: 1100,
          clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
          ...plate(usePlate(0.62)),
          borderRadius: 0,
          borderLeft: `7px solid ${t.danger}`,
          padding: "26px 40px 30px 30px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontFamily: t.font,
            fontWeight: 800,
            fontSize: 24,
            letterSpacing: TYPE.kickerTracking,
            textTransform: "uppercase",
            color: t.danger,
          }}
        >
          <Icon code="26a0" size={36} />
          {label}
        </div>
        <WordReveal
          phrase={text}
          emphasis={emphasis}
          emphasisColor={t.danger}
          style={{ marginTop: 10, fontFamily: t.font, fontWeight: 800, fontSize: 52, lineHeight: 1.15, color: t.text }}
        />
      </div>
    </Leave>
  );
};

/* ───────────────────────── Icon labels ───────────────────────── */

/** The icons are optional: each is the thing its label names, or none (round 10 review); the planner
 * gives every item one or none. */
export type IconLabelsProps = BaseProps & { items: { icon?: string; text: string; at: number }[] };

export const IconLabels: React.FC<IconLabelsProps> = ({ items }) => {
  const at = useAt();
  return (
    <Leave>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 110,
          display: "flex",
          justifyContent: "center",
          gap: 22,
        }}
      >
        {items.map((it, i) => (
          <Pill key={i} at={at(it.at)}>
            {it.icon && <Icon code={it.icon} size={60} />}
            <span style={{ fontSize: 36, fontWeight: 800 }}>{it.text}</span>
          </Pill>
        ))}
      </div>
    </Leave>
  );
};

/* ───────────────────────── Caption over the host ───────────────────────── */

/**
 * What sits behind a caption on the host: nothing designed (the words and their shadow), a soft
 * dark pool as the readability check asks for more, and — its strongest step — a dark rounded
 * caption BOX, broadcast captioning's answer to white words over a white beard or a light shirt
 * (Dale, job 386: the pool alone left four captions unreadable).
 */
const captionBacking = (shade: number): React.CSSProperties =>
  shade >= 1 ? { background: "rgba(12,16,22,0.84)", borderRadius: 12, padding: "14px 30px" } : textPool(shade);

export type HostCaptionProps = BaseProps & {
  phrase: Phrase;
  emphasis?: string[];
  /**
   * Top of the caption, px. Must sit BELOW the chin: our hosts are framed closer than the
   * reference's (Frederick's chin is at ~0.66 of the height, Steve's ~0.5), so the reference's
   * chest-height 610 lands on the beard. Phase 2 sets this from the face box the split-screen
   * code already measures (`pico.ts`); 790 clears every host photo we have.
   */
  top?: number;
  /** On a SPLIT host scene, the host's panel (px): the caption stays inside it and never runs
   * across the seam onto the picture. Unset ⇒ full frame. */
  panel?: { x: number; w: number };
};

/**
 * Big uppercase words over the host, each landing as it is said ("NOT · THE · BOWL"), centred
 * below the face and clear of the name card (bottom-left) and the CTA QR (bottom-right).
 */
/** Words a caption shows at once; a longer sentence pages (see WordReveal). */
export const CAPTION_PAGE_WORDS = { HostCaption: 8, DimCaption: 10, ArrowCaption: 10 } as const;

export const HostCaption: React.FC<HostCaptionProps> = ({ phrase, emphasis, top = 790, panel }) => {
  const t = useTheme();
  const shade = React.useContext(ShadeContext);
  return (
    <Leave>
      <div style={{ position: "absolute", left: panel?.x ?? 0, width: panel?.w ?? 1920, top: panel ? top - 60 : top, display: "flex", justifyContent: "center" }}>
        <div style={captionBacking(shade)}>
        <WordReveal
          phrase={phrase}
          emphasis={emphasis}
          uppercase
          pageWords={CAPTION_PAGE_WORDS.HostCaption}
          style={{
            fontFamily: t.font,
            fontWeight: 900,
            fontSize: panel ? TYPE.caption : TYPE.caption + 14,
            letterSpacing: "-0.01em",
            color: t.text,
            textAlign: "center",
            maxWidth: panel ? panel.w - 96 : 1500,
            lineHeight: 1.1,
            textShadow: "0 4px 18px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.5)",
          }}
        />
        </div>
      </div>
    </Leave>
  );
};

/* ───────────────────────── Caption over darkened footage ───────────────────────── */

export type DimCaptionProps = BaseProps & {
  phrase: Phrase;
  emphasis?: string[];
  /** How dark the footage goes (0-1). */
  dim?: number;
  /** Where the line sits (the composite moves it off a bright part of the picture). */
  place?: Place;
};

export const DimCaption: React.FC<DimCaptionProps> = ({ phrase, emphasis, dim = 0.55, place }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const scrim = scrimIn(frame);
  const shade = React.useContext(ShadeContext);
  return (
    <Leave>
      <AbsoluteFill style={{ background: `rgba(5,10,18,${shaded(dim, shade, 0.8) * scrim})` }} />
      <div style={{ ...placeStyle(place, 220) }}>
        <div style={textPool(shade)}>
        <WordReveal
          phrase={phrase}
          emphasis={emphasis}
          pageWords={CAPTION_PAGE_WORDS.DimCaption}
          style={{
            fontFamily: t.font,
            fontWeight: 800,
            fontSize: TYPE.headlineSmall,
            lineHeight: 1.12,
            color: t.text,
            maxWidth: 1300,
            textShadow: TEXT_SHADOW,
          }}
        />
        </div>
      </div>
    </Leave>
  );
};

/* ───────────────────────── Quote card ───────────────────────── */

/**
 * A round, heavy opening quote (“) drawn as a vector: Inter's own glyph is two slanted bars, and
 * a serif fallback would bring in a second typeface — the one slip the reference itself made.
 * Each mark is a ball with a tail curling up and right; the pair sits on one baseline.
 */
const QuoteMark: React.FC<{ size: number; color: string }> = ({ size, color }) => {
  const one = (dx: number) => (
    <g transform={`translate(${dx} 0)`}>
      <circle cx={42} cy={86} r={38} fill={color} />
      <path d="M8 84 C 6 44, 30 12, 78 2 L 84 16 C 52 30, 40 52, 44 70 Z" fill={color} />
    </g>
  );
  return (
    <svg width={size} height={size * 0.66} viewBox="0 0 196 130" style={{ overflow: "visible" }}>
      {one(0)}
      {one(104)}
    </svg>
  );
};

export type QuoteProps = BaseProps & { quote: Phrase; author: string; emphasis?: string[] };

/**
 * The host's own line, signed. Drawn over the footage it interrupts, which assembly BLURS for
 * the card's length (an underlay instruction on the cue), with a dark scrim of our own on top —
 * the reference's "quote over soft footage" look.
 */
export const QuoteCard: React.FC<QuoteProps> = ({ quote, author, emphasis }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const scrim = scrimIn(frame);
  const at = useAt();
  const mark = useEnter(2, 20);
  // The author is known from the start: sign the card early so even a short quote shows it.
  const sig = useEnter(at(quote.at) + 14, 12);
  return (
    <Leave>
      <AbsoluteFill style={{ background: `rgba(6,12,20,${shaded(0.62, React.useContext(ShadeContext), 0.85) * scrim})` }} />
      <div style={{ ...mark, position: "absolute", left: 150, top: 150 }}>
        <QuoteMark size={190} color={t.accent} />
      </div>
      <div style={{ position: "absolute", left: 270, top: 420 }}>
        <WordReveal
          phrase={quote}
          emphasis={emphasis}
          style={{
            fontFamily: t.font,
            fontWeight: 800,
            fontSize: 80,
            lineHeight: 1.14,
            color: t.text,
            maxWidth: 1380,
            textShadow: TEXT_SHADOW,
          }}
        />
        <div style={{ ...sig, display: "flex", alignItems: "center", gap: 22, marginTop: 40 }}>
          <div style={{ width: 80, height: 4, background: t.accent, borderRadius: 2 }} />
          <div
            style={{
              fontFamily: t.font,
              fontWeight: 700,
              fontSize: 30,
              letterSpacing: TYPE.kickerTracking,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.72)",
            }}
          >
            {author}
          </div>
        </div>
      </div>
    </Leave>
  );
};

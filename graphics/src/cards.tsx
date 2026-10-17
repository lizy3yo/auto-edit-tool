// FULL-SCREEN CARDS. Each one takes the place of a picture for the seconds a point is made,
// on the navy ground, and HARD-CUTS in and out like the reference (the ground is on frame 0;
// only its contents animate). Every time in the props is seconds from the card's own start.
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import {
  Arrow,
  CardBackground,
  Icon,
  Kicker,
  NumberDot,
  TEXT_SHADOW,
  VsBadge,
  WordReveal,
  useEnter,
  useTheme,
} from "./components";
import { withAlpha } from "./palette";
import { LAYOUT, TYPE } from "./theme";
import { appearFrame, countUpValue, fadeIn, type Phrase } from "./timing";

export type BaseProps = {
  durationSec: number;
  /** How an overlay leaves: "fade" (default) or "cut" — with the picture, when its cue ends on a
   * cut (a host-take caption leaves WITH the host). Cards always cut. */
  exit?: "fade" | "cut";
};

const useAt = () => {
  const { fps } = useVideoConfig();
  return (sec: number) => appearFrame(sec, fps);
};

/* ───────────────────────── Statement ("What I've been told", "[ MYTH ]", fact) ───────────────────────── */

export type StatementProps = BaseProps & {
  kicker: string;
  bracketed?: boolean;
  headline: Phrase;
  emphasis?: string[];
};

export const StatementCard: React.FC<StatementProps> = ({ kicker, bracketed, headline, emphasis }) => {
  const t = useTheme();
  return (
    <AbsoluteFill>
      <CardBackground />
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: LAYOUT.marginX }}>
        <div style={{ marginBottom: 28 }}>
          <Kicker text={kicker} bracketed={bracketed} />
        </div>
        <WordReveal
          phrase={headline}
          emphasis={emphasis}
          style={{
            fontFamily: t.font,
            fontWeight: 800,
            fontSize: TYPE.headline,
            lineHeight: 1.12,
            letterSpacing: "-0.015em",
            color: t.text,
            maxWidth: 1180,
            textShadow: TEXT_SHADOW,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Myth → Truth ───────────────────────── */

export type MythTruthProps = BaseProps & {
  myth: Phrase;
  truth: Phrase;
  emphasis?: string[];
};

export const MythTruthCard: React.FC<MythTruthProps> = ({ myth, truth, emphasis }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const at = useAt();
  const turn = at(truth.at);
  const p = fadeIn(frame, turn, 10);
  const strike = fadeIn(frame, turn - 2, 12);
  const big: React.CSSProperties = {
    fontFamily: t.font,
    fontWeight: 800,
    lineHeight: 1.12,
    letterSpacing: "-0.015em",
    maxWidth: 1240,
    textShadow: TEXT_SHADOW,
  };
  return (
    <AbsoluteFill>
      <CardBackground />
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: LAYOUT.marginX }}>
        <div style={{ opacity: 1 - 0.62 * p, marginBottom: 56 * p }}>
          <div style={{ marginBottom: 22 }}>
            <Kicker text="Myth" bracketed />
          </div>
          <div style={{ position: "relative", display: "inline-block" }}>
            <WordReveal
              phrase={myth}
              style={{ ...big, fontSize: TYPE.headline - 24 * p, color: t.text }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: "52%",
                height: 7,
                width: `${strike * 100}%`,
                background: t.danger,
                borderRadius: 4,
              }}
            />
          </div>
        </div>
        <div style={{ opacity: p, transform: `translateY(${(1 - p) * 24}px)` }}>
          <div style={{ marginBottom: 22 }}>
            <Kicker text="Truth" bracketed atFrame={turn} />
          </div>
          <WordReveal
            phrase={truth}
            emphasis={emphasis}
            style={{ ...big, fontSize: TYPE.headline, color: t.text }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ───────────────────────── This vs That ───────────────────────── */

export type Side = { icon?: string; title: string; sub?: string; at: number };

export type VersusProps = BaseProps & {
  kicker?: string;
  left: Side;
  right: Side;
  /** The side the point favours is drawn in the accent; the other goes quiet. */
  winner?: "left" | "right" | "none";
};

/**
 * One side of the comparison. Both sides read neutral (white) until the comparison is DECIDED
 * — the moment the second side is said — then the favoured side turns accent and the other
 * steps back. Greying a side before its rival is even on screen gives the verdict away early.
 */
const SidePanel: React.FC<{ side: Side; tone: "win" | "lose" | "plain"; cx: number; decideFrame: number }> = ({
  side,
  tone,
  cx,
  decideFrame,
}) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const at = useAt();
  const enter = useEnter(at(side.at), 26);
  const d = tone === "plain" ? 0 : fadeIn(frame, decideFrame, 12);
  const titleColor = tone === "win" && d > 0.5 ? t.accent : t.text;
  const loseDim = tone === "lose" ? 1 - 0.55 * d : 1;
  return (
    <div
      style={{
        ...enter,
        opacity: (enter.opacity as number) * loseDim,
        filter: tone === "lose" ? `grayscale(${0.7 * d})` : undefined,
        position: "absolute",
        left: cx - 430,
        width: 860,
        top: 330,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      {side.icon && (
        <Icon code={side.icon} size={230} />
      )}
      <div
        style={{
          marginTop: 28,
          fontFamily: t.font,
          fontWeight: 800,
          fontSize: TYPE.sideTitle + 8,
          letterSpacing: "-0.01em",
          color: titleColor,
          textShadow: TEXT_SHADOW,
        }}
      >
        {side.title}
      </div>
      {side.sub && (
        <div
          style={{
            marginTop: 14,
            fontFamily: t.font,
            fontWeight: 600,
            fontSize: TYPE.sideSub,
            color: t.textSecondary,
            maxWidth: 760,
          }}
        >
          {side.sub}
        </div>
      )}
    </div>
  );
};

export const VersusCard: React.FC<VersusProps> = ({ kicker, left, right, winner = "none" }) => {
  const frame = useCurrentFrame();
  const at = useAt();
  const line = fadeIn(frame, 0, 14);
  const tone = (s: "left" | "right") =>
    winner === "none" ? "plain" : winner === s ? "win" : "lose";
  const decide = Math.max(at(left.at), at(right.at)) + 6;
  return (
    <AbsoluteFill>
      <CardBackground />
      {kicker && (
        <div style={{ position: "absolute", left: LAYOUT.marginX, top: LAYOUT.kickerY }}>
          <Kicker text={kicker} />
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 959,
          top: 260,
          width: 2,
          height: 700 * line,
          background: "rgba(255,255,255,0.14)",
        }}
      />
      <SidePanel side={left} tone={tone("left")} cx={480} decideFrame={decide} />
      <SidePanel side={right} tone={tone("right")} cx={1440} decideFrame={decide} />
      <div style={{ position: "absolute", left: 960 - 75, top: 530 }}>
        <VsBadge atFrame={Math.min(at(left.at), at(right.at)) + 4} />
      </div>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Big number ───────────────────────── */

export type BigNumberProps = BaseProps & {
  /** "card": the navy ground (a full-screen card). "dim": over the footage, darkened — Steve's
   * "Big number over dimmed footage" (15,000 years), when the picture matters too. */
  ground?: "card" | "dim";
  dim?: number;
  kicker?: string;
  value: number;
  prefix?: string;
  unit?: string;
  /** When the number is said: the count starts here and lands ~1 s later. */
  at: number;
  line?: Phrase;
  /** Seconds the count takes (default 1.1); shorter when the card must clear a host take. */
  countSec?: number;
};

export const BigNumberCard: React.FC<BigNumberProps> = ({ kicker, value, prefix, unit, at: atSec, line, countSec, ground = "card", dim = 0.6 }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = useAt();
  // The count LANDS on the spoken number — it races up while the line leads in and settles the
  // moment the number is said ("60" as he says "sixty"). Counting only from the word on made
  // the number arrive about a second after it was heard.
  const land = at(atSec) + 2;
  const countFrames = Math.min(Math.round((countSec ?? 1.1) * fps), land);
  const start = land - countFrames;
  const unitEnter = useEnter(land, 12);
  // Reading order follows SPEAKING order: a line said before its number ("from smoking to fully
  // involved in about … 3 minutes") goes above it, so the card never sits half empty waiting.
  const lineFirst = !!line && line.at < atSec;
  // One stacked column, so a line that wraps to two rows pushes the number down instead of
  // running under it (job 384's "3 minutes" card drew the number over the line's second row).
  return (
    <AbsoluteFill>
      {ground === "card" ? <CardBackground /> : <AbsoluteFill style={{ background: `rgba(5,10,18,${dim * Math.min(1, frame / 9)})` }} />}
      {kicker && (
        <div style={{ position: "absolute", left: LAYOUT.marginX, top: LAYOUT.kickerY }}>
          <Kicker text={kicker} />
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: LAYOUT.marginX,
          top: lineFirst ? 380 : 330,
          display: "flex",
          flexDirection: lineFirst ? "column-reverse" : "column",
          alignItems: "flex-start",
          gap: lineFirst ? 36 : 50,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 28,
            fontFamily: t.font,
            opacity: frame < start ? 0 : 1,
          }}
        >
          <span
            style={{
              fontWeight: 900,
              fontSize: TYPE.bigNumber,
              lineHeight: 0.9,
              letterSpacing: "-0.04em",
              color: t.accent,
              fontVariantNumeric: "tabular-nums",
              textShadow: TEXT_SHADOW,
            }}
          >
            {prefix}
            {countUpValue(frame, start, value, fps, countFrames / fps, prefix && /[$£€¥]/.test(prefix) ? 1000 : 10000)}
          </span>
          {unit && (
            <span
              style={{
                ...unitEnter,
                fontWeight: 800,
                fontSize: TYPE.bigUnit,
                color: t.text,
                textShadow: TEXT_SHADOW,
              }}
            >
              {unit}
            </span>
          )}
        </div>
        {line && (
          <div>
            <WordReveal
              phrase={line}
              style={{
                fontFamily: t.font,
                fontWeight: 800,
                fontSize: TYPE.bigUnit - 4,
                color: t.text,
                maxWidth: 1500,
                textShadow: TEXT_SHADOW,
              }}
            />
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Step-by-step cards ───────────────────────── */

export type StepCardsProps = BaseProps & {
  kicker?: string;
  steps: { text: string; icon?: string; at: number }[];
};

const StepBox: React.FC<{ n: number; text: string; icon?: string; at: number }> = ({ n, text, icon, at: atSec }) => {
  const t = useTheme();
  const at = useAt();
  const enter = useEnter(at(atSec), 24);
  return (
    <div
      style={{
        ...enter,
        width: 380,
        height: 300,
        boxSizing: "border-box",
        padding: "30px 30px 34px",
        borderRadius: 18,
        background: withAlpha(t.accent, 0.1),
        border: "1.5px solid " + withAlpha(t.accent, 0.16),
        boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        flex: "none",
      }}
    >
      <NumberDot n={n} size={46} />
      {icon && <Icon code={icon} size={84} />}
      <div
        style={{
          fontFamily: t.font,
          fontWeight: 800,
          fontSize: 42,
          lineHeight: 1.15,
          color: t.text,
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const StepCardsCard: React.FC<StepCardsProps> = ({ kicker, steps }) => {
  const at = useAt();
  return (
    <AbsoluteFill>
      <CardBackground />
      {kicker && (
        <div style={{ position: "absolute", left: LAYOUT.marginX, top: LAYOUT.kickerY }}>
          <Kicker text={kicker} />
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: LAYOUT.marginX,
          right: LAYOUT.marginX,
          top: 360,
          display: "flex",
          alignItems: "center",
          gap: 26,
        }}
      >
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Arrow atFrame={at(s.at) - 4} width={88} />}
            <StepBox n={i + 1} {...s} />
          </React.Fragment>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Before → After ───────────────────────── */

export type BeforeAfterProps = BaseProps & {
  kicker?: string;
  before: { icon: string; label: string; at: number };
  after: { icon: string; label: string; at: number };
};

export const BeforeAfterCard: React.FC<BeforeAfterProps> = ({ kicker, before, after }) => {
  const t = useTheme();
  const at = useAt();
  const b = useEnter(at(before.at), 22);
  const a = useEnter(at(after.at), 22);
  const label: React.CSSProperties = {
    marginTop: 26,
    fontFamily: t.font,
    fontWeight: 800,
    fontSize: 60,
    textShadow: TEXT_SHADOW,
    textAlign: "center",
    maxWidth: 620,
  };
  return (
    <AbsoluteFill>
      <CardBackground />
      {kicker && (
        <div style={{ position: "absolute", left: LAYOUT.marginX, top: LAYOUT.kickerY }}>
          <Kicker text={kicker} />
        </div>
      )}
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 120, paddingTop: 80 }}>
        <div style={{ ...b, display: "flex", flexDirection: "column", alignItems: "center", width: 620 }}>
          <Icon code={before.icon} size={240} />
          <div style={{ ...label, color: t.textSecondary }}>{before.label}</div>
        </div>
        <Arrow atFrame={at(after.at) - 6} width={180} thickness={8} />
        <div style={{ ...a, display: "flex", flexDirection: "column", alignItems: "center", width: 620 }}>
          <Icon code={after.icon} size={240} />
          <div style={{ ...label, color: t.accent }}>{after.label}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Two points, joined ───────────────────────── */

export type TwoPointProps = BaseProps & {
  title: Phrase;
  a: { label: string; sub?: string; at: number };
  b: { label: string; sub?: string; at: number };
};

const Orb: React.FC<{ lit: number }> = ({ lit }) => {
  const t = useTheme();
  return (
    <div
      style={{
        width: 150,
        height: 150,
        borderRadius: "50%",
        background: "radial-gradient(circle at 38% 32%, color-mix(in srgb, " + t.glow + ", white 18%) 0%, " + t.glow + " 58%, " + t.bg + " 100%)",
        boxShadow: `0 0 ${40 * lit}px ${withAlpha(t.accent, 0.55 * lit)}, inset 0 -10px 30px rgba(0,0,0,0.5)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: 14, height: 14, borderRadius: "50%", background: t.accent, opacity: 0.4 + 0.6 * lit }} />
    </div>
  );
};

export const TwoPointCard: React.FC<TwoPointProps> = ({ title, a, b }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const at = useAt();
  const fa = at(a.at);
  const fb = at(b.at);
  const ea = useEnter(fa, 20);
  const eb = useEnter(fb, 20);
  const line = fadeIn(frame, fa + 4, Math.max(8, fb - fa));
  const point = (p: TwoPointProps["a"], enter: React.CSSProperties, lit: number, x: number) => (
    <div style={{ ...enter, position: "absolute", left: x - 260, width: 520, top: 470, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Orb lit={lit} />
      <div style={{ marginTop: 30, fontFamily: t.font, fontWeight: 800, fontSize: 58, color: t.text, textShadow: TEXT_SHADOW, textAlign: "center" }}>
        {p.label}
      </div>
      {p.sub && (
        <div style={{ marginTop: 10, fontFamily: t.font, fontWeight: 600, fontSize: 32, color: t.textMuted, textAlign: "center" }}>
          {p.sub}
        </div>
      )}
    </div>
  );
  return (
    <AbsoluteFill>
      <CardBackground />
      <div style={{ position: "absolute", top: 240, width: "100%", display: "flex", justifyContent: "center" }}>
        <WordReveal
          phrase={title}
          style={{ fontFamily: t.font, fontWeight: 700, fontSize: 58, color: t.text, textShadow: TEXT_SHADOW, textAlign: "center", maxWidth: 1640 }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 560 + 75,
          top: 470 + 74,
          width: (800 - 150) * line,
          height: 3,
          background: `linear-gradient(90deg, ${withAlpha(t.accent, 0.25)}, ${t.accent})`,
        }}
      />
      {point(a, ea, fadeIn(frame, fa, 10), 560)}
      {point(b, eb, fadeIn(frame, fb, 10), 1360)}
    </AbsoluteFill>
  );
};

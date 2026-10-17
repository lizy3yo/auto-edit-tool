// The rest of Steve Cooper's graphics, from the competitor review (Talking-heads-review.xlsx,
// "Steve Cooper" sheet: every graphic in four videos, counted). Same building blocks, same
// theme, same motion as the first fourteen — a template never styles itself.
//
// Each one is GENERAL: words come from the script (cueResolve), colours from the channel's host
// photo (palette), and where text sits over footage it reads `shade` / `place` so the composite can
// keep it readable on any picture (scripts/legibility.mts).
import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BigNumberCard, type BaseProps, type BigNumberProps } from "./cards";
import {
  CardBackground,
  MeasuringContext,
  Icon,
  Kicker,
  NumberDot,
  TEXT_SHADOW,
  WordReveal,
  placeStyle,
  shaded,
  textPool,
  useEnter,
  useTheme,
  type Place,
} from "./components";
import { withAlpha } from "./palette";
import { CAPTION_PAGE_WORDS, Leave, ShadeContext, plate, useAt, usePlate } from "./overlays";
import { LAYOUT, TYPE } from "./theme";
import { fadeIn, scrimIn, type Phrase } from "./timing";

const useShade = () => React.useContext(ShadeContext);

/* ───────────────────────── Title over footage, one word in blue ───────────────────────── */

export type TitleProps = BaseProps & { kicker?: string; phrase: Phrase; emphasis?: string[]; place?: Place };

/** The opening line of the video over its first picture (Steve: 0:05 in all four videos). A soft
 * shade on the text's side only — the picture stays the picture. */
export const TitleOverFootage: React.FC<TitleProps> = ({ kicker, phrase, emphasis, place }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const shade = useShade();
  const side = place?.h ?? "left";
  const a = shaded(0.55, shade, 0.85) * scrimIn(frame, 12);
  return (
    <Leave>
      <AbsoluteFill
        style={{ background: `linear-gradient(${side === "left" ? "90deg" : "270deg"}, rgba(5,10,18,${a}) 0%, rgba(5,10,18,${a * 0.6}) 45%, rgba(5,10,18,0) 75%)` }}
      />
      <div style={placeStyle(place, 260)}>
        {kicker && (
          <div style={{ marginBottom: 26 }}>
            <Kicker text={kicker} />
          </div>
        )}
        <div style={textPool(shade)}>
          <WordReveal
            phrase={phrase}
            emphasis={emphasis}
            style={{ fontFamily: t.font, fontWeight: 800, fontSize: 104, lineHeight: 1.08, letterSpacing: "-0.015em", color: t.text, maxWidth: 1150, textShadow: TEXT_SHADOW }}
          />
        </div>
      </div>
    </Leave>
  );
};

/* ───────────────────────── Small label ───────────────────────── */

export type SmallLabelProps = BaseProps & { text: string; at: number; place?: Place };

/** Names the thing in the picture, a few words ("the front door"): a small pill with an accent dot. */
export const SmallLabel: React.FC<SmallLabelProps> = ({ text, at: atSec, place }) => {
  const t = useTheme();
  const at = useAt();
  const enter = useEnter(at(atSec), 10);
  return (
    <Leave>
      <div style={placeStyle(place ?? { h: "left", v: "bottom" }, 70)}>
        <div style={{ ...enter, ...plate(usePlate(0.74)), borderRadius: 40, padding: "14px 28px 14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 16, height: 16, borderRadius: "50%", background: t.accent, flex: "none" }} />
          <span style={{ fontFamily: t.font, fontWeight: 700, fontSize: 38, color: t.text, whiteSpace: "nowrap" }}>{text}</span>
        </div>
      </div>
    </Leave>
  );
};

/* ───────────────────────── Big number over dimmed footage ───────────────────────── */

export const BigNumberOverlay: React.FC<BigNumberProps> = props => {
  const shade = useShade();
  return (
    <Leave>
      <BigNumberCard {...props} ground="dim" dim={shaded(props.dim ?? 0.6, shade, 0.85)} />
    </Leave>
  );
};

/* ───────────────────────── Number label (two values compared) ───────────────────────── */

export type NumberLabelProps = BaseProps & {
  kicker?: string;
  a: { label: string; value: string; at: number };
  b: { label: string; value: string; at: number };
};

const ValuePill: React.FC<{ label: string; value: string; at: number; strong: boolean }> = ({ label, value, at: atSec, strong }) => {
  const t = useTheme();
  const at = useAt();
  const enter = useEnter(at(atSec), 14);
  return (
    <div style={{ ...enter, ...plate(usePlate(0.74)), borderRadius: 14, padding: "18px 30px", display: "flex", flexDirection: "column", gap: 4, minWidth: 260 }}>
      <span style={{ fontFamily: t.font, fontWeight: 700, fontSize: 26, letterSpacing: TYPE.kickerTracking, textTransform: "uppercase", color: "rgba(255,255,255,0.72)" }}>{label}</span>
      <span style={{ fontFamily: t.font, fontWeight: 900, fontSize: 72, lineHeight: 1, color: strong ? t.accent : t.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
};

/** Two values side by side on the footage ("Dog 39 °C / You 37 °C"). */
export const NumberLabel: React.FC<NumberLabelProps> = ({ kicker, a, b }) => {
  const t = useTheme();
  return (
    <Leave>
      <div style={{ position: "absolute", left: LAYOUT.actionSafeX + 24, bottom: 120, display: "flex", flexDirection: "column", gap: 16 }}>
        {kicker && (
          <div style={{ ...plate(usePlate(0.74)), alignSelf: "flex-start", padding: "8px 16px", borderRadius: 8 }}>
            <Kicker text={kicker} size={24} />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "stretch", gap: 18 }}>
          <ValuePill {...a} strong />
          <div style={{ alignSelf: "center", fontFamily: t.font, fontWeight: 800, fontSize: 34, color: "rgba(255,255,255,0.8)", textShadow: TEXT_SHADOW }}>vs</div>
          <ValuePill {...b} strong={false} />
        </div>
      </div>
    </Leave>
  );
};

/* ───────────────────────── Bar chart on footage ───────────────────────── */

export type BarChartProps = BaseProps & {
  title?: string;
  /** 2-4 bars; `value` sets the length, `display` is what is written ("300 million"). */
  bars: { label: string; value: number; display?: string; at: number }[];
};

/** Numbers the script compares, as bars that grow when each is said, over darkened footage. */
export const BarChart: React.FC<BarChartProps> = ({ title, bars }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const at = useAt();
  const shade = useShade();
  const max = Math.max(...bars.map(b => b.value), 1);
  return (
    <Leave>
      <AbsoluteFill style={{ background: `rgba(5,10,18,${shaded(0.5, shade, 0.85) * scrimIn(frame)})` }} />
      <div style={{ position: "absolute", left: LAYOUT.marginX, top: 230, width: 1300 }}>
        {title && (
          <div style={{ marginBottom: 46 }}>
            <Kicker text={title} />
          </div>
        )}
        {bars.map((b, i) => {
          const start = at(b.at);
          const grow = fadeIn(frame, start, 18);
          const enter = fadeIn(frame, start - 3, 8);
          const w = Math.max(0.02, b.value / max) * 1000 * grow;
          return (
            <div key={i} style={{ opacity: enter, marginBottom: 40 }}>
              <div style={{ fontFamily: t.font, fontWeight: 700, fontSize: 36, color: t.text, marginBottom: 12, textShadow: TEXT_SHADOW }}>{b.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ width: w, height: 46, borderRadius: 8, background: i === 0 ? t.accent : withAlpha(t.accent, 0.45), boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }} />
                <div style={{ opacity: grow, fontFamily: t.font, fontWeight: 900, fontSize: 48, color: i === 0 ? t.accent : t.text, whiteSpace: "nowrap", textShadow: TEXT_SHADOW }}>
                  {b.display ?? String(b.value)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Leave>
  );
};

/* ───────────────────────── Checklist on footage ───────────────────────── */

export type ChecklistProps = BaseProps & { title?: string; items: { text: string; at: number }[] };

const Tick: React.FC<{ p: number; size: number }> = ({ p, size }) => {
  const t = useTheme();
  return (
    <div style={{ width: size, height: size, borderRadius: 8, border: `3px solid ${p > 0 ? t.accent : "rgba(255,255,255,0.55)"}`, background: p > 0 ? withAlpha(t.accent, 0.18) : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24">
        <path d="M4 12.5 L10 18 L20 6" fill="none" stroke={t.accent} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={30} strokeDashoffset={30 * (1 - p)} />
      </svg>
    </div>
  );
};

const CheckRow: React.FC<{ text: string; atFrame: number; first: boolean }> = ({ text, atFrame, first }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const show = useEnter(atFrame - 4, 10);
  return (
    <div style={{ ...show, display: "flex", alignItems: "center", gap: 20, marginTop: first ? 0 : 18 }}>
      <Tick p={fadeIn(frame, atFrame, 10)} size={46} />
      <span style={{ fontFamily: t.font, fontWeight: 700, fontSize: 42, color: t.text }}>{text}</span>
    </div>
  );
};

/** Signs or things to check, each ticked as it is said ("Time for a vet visit"). */
export const Checklist: React.FC<ChecklistProps> = ({ title, items }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const at = useAt();
  const wipe = fadeIn(frame, 0, 12);
  return (
    <Leave>
      <div style={{ position: "absolute", left: LAYOUT.actionSafeX + 24, top: 200, minWidth: 620, maxWidth: 900, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`, ...plate(usePlate(0.7)), borderRadius: 0, borderLeft: `7px solid ${t.accent}`, padding: "30px 40px 34px 34px" }}>
        {title && (
          <div style={{ marginBottom: 22 }}>
            <Kicker text={title} size={26} />
          </div>
        )}
        {items.map((it, i) => (
          <CheckRow key={i} text={it.text} atFrame={at(it.at)} first={i === 0} />
        ))}
      </div>
    </Leave>
  );
};

/* ───────────────────────── Crossed-out list ───────────────────────── */

export type CrossedListProps = BaseProps & { items: { text: string; icon?: string; at: number; keep?: boolean }[] };

const CrossItem: React.FC<{ text: string; icon?: string; keep?: boolean; atFrame: number }> = ({ text, icon, keep, atFrame }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const enter = useEnter(atFrame, 14);
  const bg = usePlate(0.74);
  const strike = keep ? 0 : fadeIn(frame, atFrame + 8, 10);
  const measuring = React.useContext(MeasuringContext);
  return (
    <div style={{ ...enter, ...plate(bg), borderRadius: 12, padding: "14px 26px", display: "flex", alignItems: "center", gap: 14, position: "relative", border: keep ? `3px solid ${t.accent}` : undefined }}>
      {icon && <Icon code={icon} size={56} style={{ opacity: 1 - 0.5 * strike }} />}
      <span style={{ fontFamily: t.font, fontWeight: 800, fontSize: 38, color: keep ? t.accent : t.text, opacity: 1 - 0.45 * strike, whiteSpace: "nowrap" }}>{text}</span>
      {!keep && !measuring && <div style={{ position: "absolute", left: 14, right: 14, top: "50%", height: 6, marginTop: -3, transformOrigin: "left", transform: `scaleX(${strike})`, background: t.danger, borderRadius: 3 }} />}
    </div>
  );
};

/** Things the script dismisses ("not the bowl, not the house"), each struck through as it is
 * said; a `keep` item (the real answer) stays and lights up. */
export const CrossedList: React.FC<CrossedListProps> = ({ items }) => {
  const at = useAt();
  return (
    <Leave>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 110, display: "flex", justifyContent: "center", gap: 22 }}>
        {items.map((it, i) => (
          <CrossItem key={i} {...it} atFrame={at(it.at)} />
        ))}
      </div>
    </Leave>
  );
};

/* ───────────────────────── Red MYTH stamp ───────────────────────── */

export type MythStampProps = BaseProps & { label?: string; at: number; phrase?: Phrase; place?: Place };

/** A red stamp slammed onto the picture when a myth is said; the myth itself, if shown, underneath. */
export const MythStamp: React.FC<MythStampProps> = ({ label = "Myth", at: atSec, phrase, place }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = useAt();
  const f = at(atSec);
  const s = spring({ frame: frame - f, fps, config: { damping: 11, stiffness: 220, mass: 0.6 } });
  const shade = useShade();
  return (
    <Leave>
      <div style={placeStyle(place ?? { h: "right", v: "top" }, 300)}>
        <div style={{ opacity: frame < f ? 0 : 1, transform: `rotate(-9deg) scale(${frame < f ? 1.6 : 1.6 - 0.6 * s})`, border: `10px solid ${t.danger}`, borderRadius: 18, padding: "6px 40px 10px", fontFamily: t.font, fontWeight: 900, fontSize: 120, letterSpacing: "0.08em", textTransform: "uppercase", color: t.danger, background: `rgba(12,16,22,${shaded(0.35, shade)})`, textShadow: "0 4px 18px rgba(0,0,0,0.35)" }}>
          {label}
        </div>
        {phrase && (
          <div style={{ ...textPool(shade), marginTop: 34 }}>
            <WordReveal phrase={phrase} style={{ fontFamily: t.font, fontWeight: 800, fontSize: 52, lineHeight: 1.15, color: t.text, maxWidth: 900, textShadow: TEXT_SHADOW }} />
          </div>
        )}
      </div>
    </Leave>
  );
};

/* ───────────────────────── Yes / no answer card ───────────────────────── */

export type YesNoProps = BaseProps & { kicker?: string; question: Phrase; answer: "yes" | "no"; at: number; line?: Phrase };

/** A question the script asks, then its answer stamped in big ("Their answer"). */
export const YesNoCard: React.FC<YesNoProps> = ({ kicker, question, answer, at: atSec, line }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = useAt();
  const f = at(atSec);
  const s = spring({ frame: frame - f, fps, config: { damping: 13, stiffness: 180 } });
  const c = answer === "yes" ? t.accent : t.danger;
  return (
    <AbsoluteFill>
      <CardBackground />
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: LAYOUT.marginX }}>
        {kicker && (
          <div style={{ marginBottom: 26 }}>
            <Kicker text={kicker} />
          </div>
        )}
        <WordReveal phrase={question} style={{ fontFamily: t.font, fontWeight: 800, fontSize: 76, lineHeight: 1.12, color: t.text, maxWidth: 1450, textShadow: TEXT_SHADOW }} />
        <div style={{ display: "flex", alignItems: "center", gap: 40, marginTop: 40 }}>
          <div style={{ opacity: frame < f ? 0 : 1, transform: `scale(${frame < f ? 0.6 : 0.6 + 0.4 * s})`, transformOrigin: "left center", fontFamily: t.font, fontWeight: 900, fontSize: 220, lineHeight: 1, letterSpacing: "-0.03em", color: c, textShadow: TEXT_SHADOW }}>
            {answer === "yes" ? "Yes." : "No."}
          </div>
          {line && <WordReveal phrase={line} style={{ fontFamily: t.font, fontWeight: 700, fontSize: 48, lineHeight: 1.18, color: t.textSecondary, maxWidth: 900 }} />}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Fact card ───────────────────────── */

export type FactProps = BaseProps & { kicker?: string; fact: Phrase; emphasis?: string[]; source?: string; icon?: string };

/** A finding the script states ("With their person nearby, dogs tend to explore more"), with
 * where it comes from, when the script says so. */
export const FactCard: React.FC<FactProps> = ({ kicker = "Fact", fact, emphasis, source, icon }) => {
  const t = useTheme();
  const at = useAt();
  const src = useEnter(at(fact.at) + 18, 10);
  return (
    <AbsoluteFill>
      <CardBackground />
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: LAYOUT.marginX }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 30 }}>
          {icon && <Icon code={icon} size={64} />}
          <Kicker text={kicker} bracketed />
        </div>
        <WordReveal phrase={fact} emphasis={emphasis} style={{ fontFamily: t.font, fontWeight: 800, fontSize: 92, lineHeight: 1.12, letterSpacing: "-0.015em", color: t.text, maxWidth: 1400, textShadow: TEXT_SHADOW }} />
        {source && (
          <div style={{ ...src, display: "flex", alignItems: "center", gap: 20, marginTop: 40 }}>
            <div style={{ width: 70, height: 4, background: t.accent, borderRadius: 2 }} />
            <span style={{ fontFamily: t.font, fontWeight: 600, fontSize: 32, color: t.textMuted }}>{source}</span>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Footage / host in a window ───────────────────────── */

/** The window the composite scales the film's picture into (16:9, left column). */
export const WINDOW = { x: 140, y: 255, w: 880, h: 495, r: 22 };

/** The card ground with a transparent rounded window: the composite puts the picture (b-roll, or
 * the host take) scaled into it. Cut in and out like a card — a fade would show the black around
 * the scaled picture. */
const WindowGround: React.FC = () => {
  const t = useTheme();
  const { x, y, w, h, r } = WINDOW;
  const hole = `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
  return (
    <>
      <AbsoluteFill style={{ clipPath: `path(evenodd, "M0 0 H1920 V1080 H0 Z ${hole}")` }}>
        <CardBackground />
      </AbsoluteFill>
      <div style={{ position: "absolute", left: x - 3, top: y - 3, width: w, height: h, border: `3px solid ${withAlpha(t.accent, 0.55)}`, borderRadius: r + 3, boxShadow: "0 24px 60px rgba(0,0,0,0.45)" }} />
    </>
  );
};

const RIGHT_COL = WINDOW.x + WINDOW.w + 90;

export type TermWindowProps = BaseProps & { kicker?: string; term: string; at: number; meaning: Phrase };

/** A term the script names and explains ("The vomeronasal organ"), beside the picture. */
export const TermWindow: React.FC<TermWindowProps> = ({ kicker = "The term", term, at: atSec, meaning }) => {
  const t = useTheme();
  const at = useAt();
  const te = useEnter(at(atSec), 18);
  return (
    <AbsoluteFill>
      <WindowGround />
      <div style={{ position: "absolute", left: RIGHT_COL, top: WINDOW.y, width: 1920 - RIGHT_COL - 120 }}>
        <Kicker text={kicker} />
        <div style={{ ...te, marginTop: 30, fontFamily: t.font, fontWeight: 900, fontSize: 76, lineHeight: 1.05, color: t.accent, textShadow: TEXT_SHADOW }}>{term}</div>
        <WordReveal phrase={meaning} style={{ marginTop: 30, fontFamily: t.font, fontWeight: 700, fontSize: 46, lineHeight: 1.2, color: t.text }} />
      </div>
    </AbsoluteFill>
  );
};

export type ListWindowProps = BaseProps & { title?: string; items: { text: string; at: number }[] };

/** A list item's size: the list is the point of the moment, so it reads at a glance (60 px, against
 * 46 before — Dale's ranking read as small print beside the picture). */
const LIST_TEXT = 60;
/** How far an item already said steps back when the next one is spoken. */
const LIST_PAST_OPACITY = 0.45;

const ListRow: React.FC<{ n: number; text: string; atFrame: number; nextFrame?: number }> = ({ n, text, atFrame, nextFrame }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const e = useEnter(atFrame, 16);
  // The item being said is at full strength; once the next is spoken it steps back, so the eye
  // follows the voice down the list.
  const back = nextFrame === undefined ? 0 : fadeIn(frame, nextFrame, 8);
  const opacity = (e.opacity as number) * (1 - (1 - LIST_PAST_OPACITY) * back);
  return (
    <div style={{ ...e, opacity, display: "flex", alignItems: "flex-start", gap: 26, marginTop: n > 1 ? 34 : 0 }}>
      <NumberDot n={n} size={62} />
      <span style={{ fontFamily: t.font, fontWeight: 800, fontSize: LIST_TEXT, lineHeight: 1.08, color: t.text, textWrap: "balance" } as React.CSSProperties}>{text}</span>
    </div>
  );
};

/** A short list beside the picture — the b-roll ("Half its life asleep") or, as HostListWindow,
 * the host ("6 things your dog hopes for", 3 bullets). The list is centred on the picture's
 * height, every row's place kept from the start so nothing moves as items arrive. */
export const ListWindow: React.FC<ListWindowProps> = ({ title, items }) => {
  const at = useAt();
  const frames = items.map(it => at(it.at));
  return (
    <AbsoluteFill>
      <WindowGround />
      <div
        style={{
          position: "absolute",
          left: RIGHT_COL,
          top: WINDOW.y - 40,
          height: WINDOW.h + 80,
          width: 1920 - RIGHT_COL - 100,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {title && (
          <div style={{ marginBottom: 44 }}>
            <Kicker text={title} />
          </div>
        )}
        {items.map((it, i) => (
          <ListRow key={i} n={i + 1} text={it.text} atFrame={frames[i]} nextFrame={frames[i + 1]} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Caption with an arrow to the subject ───────────────────────── */

export type ArrowCaptionProps = BaseProps & {
  phrase: Phrase;
  emphasis?: string[];
  place?: Place;
  /** The point the arrow lands on, px — the picture's subject, measured off the frame by the
   * composite (scripts/legibility.mts), so it works on any picture. */
  target?: { x: number; y: number };
};

/** Caption over darkened footage with a drawn arrow to the thing it is about ("He couldn't make
 * the jump"). The arrow starts at the caption's inner edge and curves to the subject. */
export const ArrowCaption: React.FC<ArrowCaptionProps> = ({ phrase, emphasis, place, target = { x: 1300, y: 540 } }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const at = useAt();
  const shade = useShade();
  const p = place ?? { h: target.x > 960 ? "left" : "right", v: target.y > 540 ? "top" : "bottom" };
  const box = placeStyle(p, 200);
  // Arrow from the caption's inner edge towards the subject, stopping short of it.
  const fromX = p.h === "left" ? 160 + 820 : 1920 - 160 - 820;
  const fromY = (box.top as number) + 100;
  const dx = target.x - fromX;
  const dy = target.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const toX = target.x - (dx / len) * 70;
  const toY = target.y - (dy / len) * 70;
  const cx = (fromX + toX) / 2 + (dy / len) * 120;
  const cy = (fromY + toY) / 2 - (dx / len) * 120;
  const draw = fadeIn(frame, at(phrase.at) + 10, 16);
  const ang = Math.atan2(toY - cy, toX - cx);
  const hx = (k: number) => toX - 30 * Math.cos(ang + k);
  const hy = (k: number) => toY - 30 * Math.sin(ang + k);
  return (
    <Leave>
      <AbsoluteFill style={{ background: `rgba(5,10,18,${shaded(0.5, shade, 0.8) * scrimIn(frame)})` }} />
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        <path d={`M${fromX} ${fromY} Q${cx} ${cy} ${toX} ${toY}`} fill="none" stroke={t.accent} strokeWidth={8} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
        <polygon points={`${toX},${toY} ${hx(0.5)},${hy(0.5)} ${hx(-0.5)},${hy(-0.5)}`} fill={t.accent} opacity={draw > 0.95 ? 1 : 0} />
      </svg>
      <div style={box}>
        <div style={textPool(shade)}>
          <WordReveal phrase={phrase} emphasis={emphasis} pageWords={CAPTION_PAGE_WORDS.ArrowCaption} style={{ fontFamily: t.font, fontWeight: 800, fontSize: 72, lineHeight: 1.12, color: t.text, maxWidth: 820, textShadow: TEXT_SHADOW }} />
        </div>
      </div>
    </Leave>
  );
};

/* ───────────────────────── Icon callout ───────────────────────── */

export type IconCalloutProps = BaseProps & { icon: string; phrase: Phrase; emphasis?: string[]; place?: Place };

/** One short point with one icon on the footage ("Nobody earns a dime"). */
export const IconCallout: React.FC<IconCalloutProps> = ({ icon, phrase, emphasis, place }) => {
  const t = useTheme();
  const frame = useCurrentFrame();
  const wipe = fadeIn(frame, 0, 12);
  const ic = useEnter(4, 14);
  return (
    <Leave>
      <div style={placeStyle(place ?? { h: "left", v: "bottom" }, 150)}>
        <div style={{ display: "flex", alignItems: "center", gap: 28, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`, ...plate(usePlate(0.7)), borderRadius: 80, padding: "18px 44px 18px 18px" }}>
          <div style={{ ...ic, width: 110, height: 110, borderRadius: "50%", background: withAlpha(t.accent, 0.18), border: `3px solid ${t.accent}`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <Icon code={icon} size={70} />
          </div>
          <WordReveal phrase={phrase} emphasis={emphasis} style={{ fontFamily: t.font, fontWeight: 800, fontSize: 52, lineHeight: 1.12, color: t.text, maxWidth: 900 }} />
        </div>
      </div>
    </Leave>
  );
};

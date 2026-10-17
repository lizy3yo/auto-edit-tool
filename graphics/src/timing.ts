// Pure timing maths shared by every template. Kept free of React so it can be unit-tested and,
// later, lifted into the app's `shared/` next to `filmTimeline.ts` unchanged.
import { Easing, interpolate } from "remotion";
import { MOTION } from "./theme";

/**
 * A piece of on-screen text and WHEN it is spoken. `at` is seconds from the graphic's own start.
 * `wordTimes` (same length as the words of `text`) makes each word appear as it is said — the
 * kinetic-caption look. Without it the whole phrase appears at `at`.
 */
export type Phrase = {
  text: string;
  at: number;
  wordTimes?: number[];
};

/** Split the way every template renders: on whitespace, punctuation kept on its word. */
export function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Seconds → the frame a word should START appearing on (with the read-ahead lead). */
export function appearFrame(sec: number, fps: number): number {
  return Math.max(0, Math.round((sec - MOTION.wordLeadSec) * fps));
}

/**
 * A long line split into PAGES the way subtitles page: at most `max` words each, broken after a
 * comma, colon or full stop once a page holds at least half its share, never leaving a last page of
 * one or two words. Returns the index of each page's first word. Pure.
 */
export function pageStarts(words: string[], max: number): number[] {
  if (!(max > 0) || words.length <= max) return [0];
  const starts = [0];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const len = i - start + 1;
    const left = words.length - i - 1;
    const breakHere = len >= max || (/[,;:.?!]["”')]*$/.test(words[i]) && len >= Math.ceil(max / 2) && left > 2);
    if (breakHere && left > 0) {
      start = i + 1;
      starts.push(start);
    }
  }
  // a last page of one or two words joins the page before
  if (starts.length > 1 && words.length - starts[starts.length - 1] <= 2) starts.pop();
  return starts;
}

/** Per-word appear frames for a phrase. Missing / short `wordTimes` fall back to `at`. */
export function wordFrames(phrase: Phrase, fps: number): number[] {
  const words = splitWords(phrase.text);
  return words.map((_, i) => {
    const t = phrase.wordTimes?.[i];
    return appearFrame(typeof t === "number" && Number.isFinite(t) ? t : phrase.at, fps);
  });
}

/**
 * A strike-through drawn left to right across a phrase, however it wraps: how far each word, and
 * each space between two words, is struck (0-1) when the stroke is `progress` (0-1) of the way
 * along. The stroke runs over the characters in reading order — the first line, then the next —
 * so every line of a wrapped phrase is crossed, a word at a time, and its speed does not depend
 * on where the lines break. One bar across the middle of the whole block could not do that: on a
 * myth wrapped to two lines it fell in the gap between them, ran past the words and left the
 * second line unstruck (job 399, "He figures she must know somebody on the crew."). Pure.
 */
export function strikeSweep(words: string[], progress: number): { words: number[]; gaps: number[] } {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const lens = words.map(w => Math.max(1, w.length));
  const front = p * (lens.reduce((n, l) => n + l, 0) + Math.max(0, words.length - 1));
  const part = (start: number, len: number) => Math.min(1, Math.max(0, (front - start) / len));
  const struck: number[] = [];
  const gaps: number[] = [];
  let at = 0;
  lens.forEach((len, i) => {
    struck.push(part(at, len));
    at += len;
    if (i < lens.length - 1) {
      gaps.push(part(at, 1));
      at += 1;
    }
  });
  return { words: struck, gaps };
}

/**
 * Where a line drawn in from x 0 ends when it is `progress` (0-1) of the way along `length`, or
 * null while it has not started — then it must not be drawn at all. A line of length 0 is not
 * nothing: with round caps it paints a dot as wide as its stroke, and job 400's Before → After card
 * (clock-before-after, 62.8-65.0 s) showed that dot alone in the middle of the screen for two
 * seconds before its arrow drew. Pure.
 */
export function drawnTo(progress: number, length: number): number | null {
  if (!(progress > 0) || !(length > 0)) return null;
  return length * Math.min(1, progress);
}

/** 0 → 1 as a word fades in. Ease-out so it lands softly instead of popping. */
export function fadeIn(frame: number, start: number, dur = MOTION.wordIn): number {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

/**
 * A full-frame darkening (a scrim under a caption or quote) eases IN and out over ~0.3 s. An
 * ease-out drops a third of the way in its first frame, which on a whole frame reads as a dip.
 */
export function scrimIn(frame: number, dur = 9): number {
  return interpolate(frame, [0, dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
}

/**
 * A full-frame darkening LEAVES the way it entered: eased in and out over ~0.4 s. The overlay
 * fade's ease-in drops most of the darkness in its last two or three frames, which on a whole
 * frame is a brightness jump the eye reads as a flash (job 385, 23.57 s).
 */
export function scrimOut(frame: number, total: number, dur = 12): number {
  return interpolate(frame, [total - dur, total], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
}

/** 1 → 0 over the last `dur` frames of a graphic (overlays leave softly; cards hard-cut). */
export function fadeOutAtEnd(frame: number, total: number, dur = MOTION.overlayOut): number {
  return interpolate(frame, [total - dur, total], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
}

/**
 * The count-up of a big number: eased so it races then settles (0 → 22 → 44 → 57 → 60 on the
 * reference), and lands EXACTLY on the target — never 59.97 rounded to 59. Decimal places follow
 * the target's own ("2.5" counts in tenths).
 */
export function countUpValue(
  frame: number,
  start: number,
  target: number,
  fps: number,
  durSec = MOTION.countUpSec,
  /** Group digits from this size up: 10,000 by default, 1,000 for money. */
  groupFrom = 10000
): string {
  const decimals = (String(target).split(".")[1] ?? "").length;
  const p = interpolate(frame, [start, start + durSec * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const v = p >= 1 ? target : target * p;
  return groupDigits(v.toFixed(decimals), Math.abs(target) >= groupFrom);
}

/** Thousands separators, as the script writes the number ("10,000"). A four-digit number is left
 * bare unless it is money (`groupFrom` 1000): "1998" may be a year, "$1,500" never is. */
export function groupDigits(n: string, group: boolean): string {
  if (!group) return n;
  const [int, dec] = n.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const grouped = int.replace("-", "").replace(new RegExp("\\B(?=(\\d{3})+(?!\\d))", "g"), ",");
  return sign + grouped + (dec !== undefined ? "." + dec : "");
}

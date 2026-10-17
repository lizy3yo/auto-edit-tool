// The Myth/Truth card's strike-through, on the words as they wrap (job 399, crew-myth-truth: one bar
// at half the height of the whole myth fell BETWEEN its two lines, ran ~100 px past the words and
// left "somebody on the crew." unstruck). Rendered to markup with the frame clock set by hand, so
// the test needs no browser; how the lines break is the browser's, so what is held here is that
// the stroke is drawn on every word and every space between two — the things that wrap with them.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ frame: 0 }));
vi.mock("remotion", async importOriginal => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 120, id: "MythTruth" }),
}));

import { MythTruthCard, StatementCard, mythType } from "./cards";
import { MeasuringContext, STRIKE_THICKNESS } from "./components";
import { THEME, TYPE } from "./theme";
import { appearFrame, splitWords, strikeSweep, type Phrase } from "./timing";

const FPS = 30;
const said = (text: string, from: number, step = 0.27): Phrase => ({
  text,
  at: from,
  wordTimes: splitWords(text).map((_, i) => from + i * step),
});
// Job 399's card (22.47-26.47 s): the myth said over its first ~2.3 s, "She doesn't." at ~2.65 s.
const MYTH = "He figures she must know somebody on the crew.";
const props = (myth = MYTH, step = Math.min(0.27, 2.2 / splitWords(myth).length)) => ({
  durationSec: 4,
  myth: said(myth, 0.05, step),
  truth: said("She doesn't.", 2.65),
  emphasis: ["doesn't."],
});
const turn = appearFrame(2.65, FPS);

const render = (frame: number, myth?: string, measuring = false, step?: number) => {
  clock.frame = frame;
  return renderToStaticMarkup(
    React.createElement(MeasuringContext.Provider, { value: measuring }, React.createElement(MythTruthCard, props(myth, step)))
  );
};
/** Every strike colour drawn, in reading order (word, space, word …). */
const strokes = (html: string) =>
  [...html.matchAll(/text-decoration-line:line-through;text-decoration-color:rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g)].map(m => ({
    rgb: `${m[1]},${m[2]},${m[3]}`,
    alpha: Number(m[4]),
  }));
const RED = "255,90,78"; // THEME.danger
/** The struck myth's two layers: its words, and the see-through copy laid over them. */
const layers = (html: string) => {
  const start = html.indexOf(">", html.indexOf('position:relative"')) + 1;
  const copyAt = html.indexOf('<div style="position:absolute;inset:0', start);
  const copyStart = html.indexOf(">", copyAt) + 1;
  return { words: html.slice(start, copyAt), copy: html.slice(copyStart, html.indexOf("</div>", copyStart)) };
};
const bare = (html: string) => html.replace(/ style="[^"]*"/g, "");

describe("strikeSweep: a stroke across a phrase that may wrap", () => {
  const words = splitWords(MYTH);
  it("strikes nothing before it starts and every word and every space between two when done", () => {
    expect(strikeSweep(words, 0)).toEqual({ words: Array(9).fill(0), gaps: Array(8).fill(0) });
    expect(strikeSweep(words, 1)).toEqual({ words: Array(9).fill(1), gaps: Array(8).fill(1) });
  });

  it("runs left to right in reading order — the first line, then the next — never skipping ahead", () => {
    for (const p of [0.1, 0.35, 0.5, 0.8]) {
      const s = strikeSweep(words, p);
      const order = s.words.flatMap((w, i) => (i < s.gaps.length ? [w, s.gaps[i]] : [w]));
      for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThanOrEqual(order[i - 1]);
      expect(order[0]).toBeGreaterThan(0);
      expect(order[order.length - 1]).toBeLessThan(1);
    }
  });

  it("moves at an even pace over the letters, so where the lines break changes nothing", () => {
    // "He figures she must " is 20 of the myth's 46 characters: there the stroke has crossed exactly
    // those four words and their spaces, and not touched "know".
    const s = strikeSweep(words, 20 / MYTH.length);
    expect(s.words.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(s.gaps.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(s.words[4]).toBe(0);
  });

  it("a one-word phrase is one stroke; out-of-range and missing progress are clamped", () => {
    expect(strikeSweep(["Wrong."], 1)).toEqual({ words: [1], gaps: [] });
    expect(strikeSweep(words, 1.7)).toEqual(strikeSweep(words, 1));
    expect(strikeSweep(words, -0.2)).toEqual(strikeSweep(words, 0));
    expect(strikeSweep(words, NaN)).toEqual(strikeSweep(words, 0));
    expect(strikeSweep([], 1)).toEqual({ words: [], gaps: [] });
  });
});

describe("the Myth/Truth card strikes the myth on its words, every line", () => {
  it("399 crew-myth-truth: once the truth is on, all 9 words and the 8 spaces between them carry the red stroke", () => {
    const html = render(turn + 15);
    const s = strokes(html);
    expect(s).toHaveLength(9 + 8);
    for (const x of s) expect(x).toEqual({ rgb: RED, alpha: 1 });
    expect(html).toContain(`text-decoration-thickness:${STRIKE_THICKNESS}`);
    // the old single bar at half the block's height is gone
    expect(html).not.toMatch(/top:52%/);
    expect(html).not.toMatch(/position:absolute;left:0;top/);
  });

  it("the truth is never struck", () => {
    const html = render(turn + 15);
    const truth = html.slice(html.lastIndexOf("Truth"));
    expect(truth).toContain("doesn&#x27;t.");
    expect(truth).not.toMatch(/line-through/);
  });

  it("before the truth comes the myth reads unstruck — its spaces already in their own spans, so the stroke's arrival moves no word", () => {
    const html = render(turn - 6);
    expect(html).not.toMatch(/line-through/);
    expect(html).not.toMatch(/inset:0/);
    expect(html).toContain("He</span><span> </span><span");
    const start = html.indexOf(">", html.indexOf("text-wrap:balance")) + 1;
    expect(bare(html.slice(start, html.indexOf("</div>", start)))).toBe(bare(layers(render(turn + 15)).words));
  });

  it("the stroke is drawn on a see-through copy built from exactly the same elements as the words under it", () => {
    // 2026-10-18 render: with bare spaces under the copy's spans, a 14-word myth balanced to
    // "Flight attendants / only help passengers" below and "Flight attendants only / help
    // passengers" above, and the stroke ran across the wrong words.
    const { words, copy } = layers(render(turn + 15, "Flight attendants only help passengers they already know from earlier trips on this route."));
    expect(bare(copy)).toBe(bare(words));
    expect(copy.match(/color:transparent/g)).toHaveLength(14);
    expect(words).not.toMatch(/line-through|transparent/);
    const html = render(turn + 15);
    expect(html).toContain("position:absolute;inset:0;padding:inherit;color:transparent;text-shadow:none");
  });

  it("a space is struck only once both its words are on screen (a myth still being said when the truth comes)", () => {
    const late = "Flight attendants only help passengers they already know from earlier trips on this route.";
    const s = strokes(render(turn + 15, late, false, 0.27)); // its last words are said after the turn
    expect(s[0].alpha).toBe(1);
    expect(s[s.length - 2].alpha).toBe(0); // the space between "this" and "route."
  });

  it("mid-stroke the first words are struck and the last not yet", () => {
    const s = strokes(render(turn + 1));
    expect(s).toHaveLength(17);
    expect(s[0].alpha).toBe(1);
    expect(s[s.length - 1].alpha).toBe(0);
    for (let i = 1; i < s.length; i++) expect(s[i].alpha).toBeLessThanOrEqual(s[i - 1].alpha);
  });

  it("a myth of one, a few or many words (one, two or three lines) is struck word for word", () => {
    for (const myth of ["Wrong.", "Crew get the best seats.", "Flight attendants only help passengers they already know from earlier trips on this route."]) {
      const n = splitWords(myth).length;
      const s = strokes(render(turn + 15, myth));
      expect(s).toHaveLength(2 * n - 1);
      expect(s.every(x => x.alpha === 1)).toBe(true);
    }
  });

  it("a measuring render leaves the stroke out (it is a mark, not a word) and keeps the words where they sit", () => {
    const real = render(turn + 15);
    const measured = render(turn + 15, undefined, true);
    expect(measured).not.toMatch(/line-through/);
    expect(measured.match(/max-width:[\d.]+px/g)).toEqual(real.match(/max-width:[\d.]+px/g));
  });

  it("other text is drawn exactly as before: no stroke, bare spaces", () => {
    clock.frame = 90;
    const html = renderToStaticMarkup(
      React.createElement(StatementCard, { durationSec: 4, kicker: "Fact", headline: said("Crew notice who asks politely.", 0.1) })
    );
    expect(html).not.toMatch(/line-through/);
    expect(html.match(/<span/g)).toHaveLength(5);
  });
});

describe("the myth keeps its line breaks as it shrinks at the turn", () => {
  it("its measure shrinks in proportion to its type, so no word jumps to another line mid-turn (399: 3 lines became 2)", () => {
    const ratio = 1240 / TYPE.headline;
    for (const p of [0, 0.25, 0.5, 0.9, 1]) {
      const { fontSize, maxWidth } = mythType(p);
      expect(maxWidth / fontSize).toBeCloseTo(ratio, 9);
    }
    expect(mythType(0)).toEqual({ fontSize: 112, maxWidth: 1240 });
    expect(mythType(1).fontSize).toBe(88);
    expect(mythType(2)).toEqual(mythType(1));
  });

  it("on the card: full size and full measure before the turn, the same proportion after it", () => {
    const before = render(turn - 6).match(/max-width:([\d.]+)px;[^"]*?font-size:([\d.]+)px/);
    const after = render(turn + 15).match(/max-width:([\d.]+)px;[^"]*?font-size:([\d.]+)px/);
    expect(before?.slice(1).map(Number)).toEqual([1240, 112]);
    const [w, f] = after!.slice(1).map(Number);
    expect(f).toBe(88);
    expect(w / f).toBeCloseTo(1240 / 112, 6);
  });

  it("the truth keeps the full size and measure", () => {
    const html = render(turn + 15);
    expect(html.slice(html.lastIndexOf("Truth"))).toMatch(/max-width:1240px;[^"]*font-size:112px/);
    expect(THEME.danger).toBe("#FF5A4E");
  });
});

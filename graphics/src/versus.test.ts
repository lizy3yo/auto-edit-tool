// A Versus side's sub enters when ITS words are said, and the VS badge with the second side (round 13
// review of Werner's job 408, 0:05-0:13, "american-vs-german-floor"). The card drew each side's title
// and sub together at the side's "at": "It is empty" was up from 5.8 s though said at 7.45, and "A small
// bin, with a lid" from 8.85 s while the narrator was still on "In a German bathroom, usually," — he
// says "a small bin stands there, with a lid" at 11.11, so the card gave the reveal away 2.3 s early.
// The badge, drawn with the FIRST side, pointed at an empty right half for 2.8 s. QA's words-vs-heard
// line read only the titles ("worst 66 ms"). Every case below is the words as the film's transcript
// timed them.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ frame: 0 }));
vi.mock("remotion", async importOriginal => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300, id: "Versus" }),
}));

import { VersusCard, type VersusProps } from "./cards";
import { resolveCues, type CueSpec, type ResolvedCue, type Word } from "./cueResolve";
import { judgeFilm } from "./plan/qa";
import { systemPrompt } from "./plan/planner";
import { TEMPLATES, resolveSets } from "./registry";
import { appearFrame } from "./timing";

const FPS = 30;
/** Words as the transcriber timed them: "text@start-end …". */
const T = (s: string): Word[] =>
  s.split(" ").map(t => {
    const [text, range] = t.split("@");
    const [start, end] = range.split("-").map(Number);
    return { text, start, end };
  });

// Werner's job 408, 4.8-14.2 s, and its picture cuts (scenes 3 and 4 start at 7.29 and 13.75).
const floor = T(
  "wall.@4.892-5.192 In@5.832-5.912 most@5.972-6.172 American@6.232-6.632 bathrooms,@6.672-7.212 it@7.453-7.513 is@7.573-7.653 empty.@7.813-8.173 In@8.793-8.873 a@8.913-8.953 German@9.053-9.413 bathroom,@9.453-9.953 usually,@10.313-10.653 a@11.113-11.153 small@11.233-11.493 bin@11.573-11.833 stands@11.893-12.173 there,@12.233-12.454 with@12.714-12.834 a@12.894-12.934 lid.@12.974-13.234 It@13.894-13.954 is@13.994-14.054"
);
const cuts = [2.12, 7.29, 13.75, 22.27];
/** The plan as stored on the job. */
const versus = (left: Record<string, unknown> = {}, right: Record<string, unknown> = {}): CueSpec => ({
  id: "american-vs-german-floor",
  template: "Versus",
  start: "In most American bathrooms, it",
  startPad: -0.15,
  end: "stands there, with a lid.",
  endPad: 0.3,
  props: {
    kicker: "Beside the toilet",
    winner: "none",
    left: { at: "@In most American bathrooms", say: "In most American bathrooms, it is empty", sub: "It is empty", title: "American bathroom", ...left },
    right: { at: "@In a German bathroom", say: "a small bin stands there, with a lid", sub: "A small bin, with a lid", title: "German bathroom", ...right },
  },
});
const resolve = (spec: CueSpec, words: Word[] = floor, cutsAt: number[] = cuts) => resolveCues([spec], words, { cuts: cutsAt, fps: FPS, ...resolveSets() })[0];
type ResolvedSide = { at: number; subAt?: number; saidUntil?: number };
const sides = (c: ResolvedCue) => [c.props.left, c.props.right] as ResolvedSide[];
const at = (word: string, after = 0) => floor.find(w => w.text === word && w.start >= after)!.start;

describe("the resolver times each sub to its own words inside the side's 'say'", () => {
  it("408: 'It is empty' on 'it' (7.45), 'A small bin, with a lid' on the 'a' of 'a small bin' (11.11) — never the 'a' of 'In a German'", () => {
    const c = resolve(versus());
    expect([c.start, c.end]).toEqual([5.667, 13.767]); // the card itself is placed as the film had it
    const [left, right] = sides(c);
    expect(c.start + left.subAt!).toBeCloseTo(at("it"), 3);
    expect(c.start + right.subAt!).toBeCloseTo(at("a", 11), 3);
    // the titles keep their own words, and the verdict its "say"
    expect(c.start + left.at).toBeCloseTo(at("In"), 3);
    expect(c.start + right.at).toBeCloseTo(at("In", 8), 3);
    expect(c.start + right.saidUntil!).toBeCloseTo(13.234, 3);
    // QA reads both subs where they are drawn
    expect(c.sync.filter(s => s.prop).map(s => [s.element, s.word, s.wordStart, s.prop])).toEqual([
      ['left.sub "It is empty"', "it", 7.453, "left.subAt"],
      ['right.sub "A small bin, with a lid"', "a", 11.113, "right.subAt"],
    ]);
  });

  it("a sub that rewords the narrator appears when the side's 'say' begins, if that is after its title", () => {
    const c = resolve(versus({}, { sub: "Lidded bin there" }));
    expect(c.start + sides(c)[1].subAt!).toBeCloseTo(at("a", 11), 3);
  });

  it("a sub said with its title enters with it — no time of its own (Walter Wren, job 404, 1:23)", () => {
    const robin = T(
      "January@82.121-82.801 could@82.941-83.141 be@83.201-83.321 a@83.361-83.401 traveler@83.482-83.922 from@83.962-84.122 up@84.202-84.282 north@84.362-84.702 instead@84.982-85.383 of@85.403-85.463 the@85.503-85.583 one@85.683-85.783 that@85.803-85.923 raised@85.963-86.223 a@86.283-86.323 family@86.363-86.743 on@86.843-86.904 your@86.944-87.084 porch@87.144-87.424 light.@87.484-87.684 And@88.33-88.41 if@88.45-88.51"
    );
    const spec: CueSpec = {
      id: "versus-january-robin",
      template: "Versus",
      start: "January could be a traveler",
      startPad: -0.15,
      end: "family on your porch light",
      endPad: 0.3,
      props: {
        kicker: "Your January robin",
        winner: "none",
        // the sub is the title's own words; and a sub reworded ("…here") whose "say" starts with the side
        left: { at: "@a traveler from up north", say: "a traveler from up north", sub: "A traveler from up north", title: "Northern traveler" },
        right: { at: "@the one that raised a family", say: "the one that raised a family on your porch light", sub: "Raised a family here", title: "Your porch robin" },
      },
    };
    const c = resolve(spec, robin, [80.36, 88.8]);
    expect(sides(c).map(s => s.subAt)).toEqual([undefined, undefined]);
    expect(c.sync.filter(s => s.prop)).toEqual([]);
  });

  it("a sub whose words are outside its 'say' enters with its title (Sawdust Sam, job 407, 2:21)", () => {
    const log = T(
      "because@141.776-142.056 a@142.136-142.156 fresh@142.216-142.516 log@142.616-142.976 gives@143.036-143.276 up@143.376-143.456 its@143.516-143.636 chips@143.756-144.136 far@144.676-145.016 easier@145.217-145.597 than@145.637-145.777 a@145.817-145.857 seasoned@145.937-146.397 one.@146.557-146.677 And@147.397-147.497"
    );
    const spec: CueSpec = {
      id: "fresh-vs-seasoned",
      template: "Versus",
      start: "because a fresh log gives up",
      startPad: -0.15,
      end: "than a seasoned one",
      endPad: 0.3,
      props: {
        kicker: "Hewing",
        winner: "left",
        left: { at: "@a fresh log", say: "a fresh log", sub: "Gives up chips easier", title: "Fresh log" },
        right: { at: "@a seasoned one", say: "a seasoned one", sub: "Harder going", title: "Seasoned log" },
      },
    };
    expect(sides(resolve(spec, log, [138.53, 141.46])).map(s => s.subAt)).toEqual([undefined, undefined]);
  });

  it("the planner is told the sub's words belong in the side's 'say'", () => {
    expect(systemPrompt({ kept: false })).toContain(`(a side's "say" is all its words as said, its sub's words among them: the title appears on "at", the sub as its own words are said)`);
  });
});

/** The card drawn at `frame`. */
const draw = (frame: number, props: VersusProps) => {
  clock.frame = frame;
  return renderToStaticMarkup(React.createElement(VersusCard, props));
};
const styleOf = (html: string, text: string) => new RegExp(`<div style="([^"]*)">${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</div>`).exec(html)?.[1];
const opacity = (style: string | undefined) => Number(/opacity:([\d.]+)/.exec(style ?? "")?.[1] ?? NaN);
const badgeScale = (html: string) => Number(/scale\(([\d.]+)\)[^"]*">VS</.exec(html)?.[1] ?? NaN);

describe("the card draws each sub on its words and the badge with the second side", () => {
  const c = resolve(versus());
  const props = c.props as unknown as VersusProps;
  const [left, right] = sides(c);

  it("'It is empty' waits for its words while 'American bathroom' is up", () => {
    const before = draw(appearFrame(left.subAt!, FPS) - 1, props);
    expect(before).toContain("American bathroom");
    expect(opacity(styleOf(before, "It is empty"))).toBe(0);
    expect(opacity(styleOf(draw(appearFrame(left.subAt!, FPS) + 15, props), "It is empty"))).toBeGreaterThan(0.9);
  });

  it("'A small bin, with a lid' waits for 'a small bin…', 2.3 s after 'German bathroom' appears", () => {
    const titleUp = draw(appearFrame(right.at, FPS) + 20, props);
    expect(titleUp).toContain("German bathroom");
    expect(opacity(styleOf(titleUp, "A small bin, with a lid"))).toBe(0);
    expect(opacity(styleOf(draw(appearFrame(right.subAt!, FPS) - 1, props), "A small bin, with a lid"))).toBe(0);
    expect(opacity(styleOf(draw(appearFrame(right.subAt!, FPS) + 15, props), "A small bin, with a lid"))).toBeGreaterThan(0.9);
  });

  it("the VS badge is not drawn beside the first side alone — it enters with 'German bathroom'", () => {
    expect(badgeScale(draw(appearFrame(left.at, FPS) + 20, props))).toBe(0);
    expect(badgeScale(draw(appearFrame(right.at, FPS) - 1, props))).toBe(0);
    expect(badgeScale(draw(appearFrame(right.at, FPS) + 30, props))).toBeGreaterThan(0.9);
  });

  it("a side with no sub time of its own (the Studio sample) shows its sub with its title", () => {
    const studio = TEMPLATES.find(t => t.id === "Versus")!.defaultProps as unknown as VersusProps;
    // (its icons left out: an image needs a real composition to draw)
    const sample = { ...studio, left: { ...studio.left, icon: undefined }, right: { ...studio.right, icon: undefined } };
    const html = draw(appearFrame(sample.left.at, FPS) + 1, sample);
    expect(styleOf(html, sample.left.sub!)).not.toMatch(/opacity/);
  });
});

describe("QA reads each sub where it is drawn", () => {
  const still = new Array(600).fill(0);
  const judge = (cues: ResolvedCue[]) => judgeFilm({ fps: FPS, cues, filmDiffs: still, reelDiffs: still, rules: [], readability: [] });
  const c = resolve(versus());

  it("408: four elements, every one on its voice", () => {
    const qa = judge([c]);
    expect(qa.lines.find(l => l.startsWith("Words on screen vs. heard"))).toMatch(/^Words on screen vs\. heard: worst \d+ ms over 4 elements$/);
    expect(qa.failures).toEqual([]);
  });

  it("a sub drawn with its title, as the film had it, is 2.3 s ahead of its voice", () => {
    const right = c.props.right as ResolvedSide;
    const asShipped = { ...c, props: { ...c.props, right: { ...right, subAt: right.at } } };
    const qa = judge([asShipped]);
    expect(qa.failures).toHaveLength(1);
    const ms = Number(/^a word on screen (\d+) ms off its voice$/.exec(qa.failures[0])?.[1]);
    expect(ms).toBeGreaterThan(2000);
  });
});

// Two values side by side get "vs" only when they are COMPARED (round 11 review). The NumberLabel
// template drew "vs" between any two values: Gary's job 406 (sharpening-prices, 1:22) read "A KNIFE
// $5 to $10 vs A MOWER BLADE $10 to $20" for "$5 to $10 a knife and $10 to $20 a mower blade" — a
// price for each of two services, not a contest — and Dale's job 397 (furniture-price-range, 1:04)
// "FROM $150 vs UP TO $600" for a range. The "vs" also showed from the graphic's first frame, alone
// beside the kicker, before either value. Every case below is the words as the film's transcript
// timed them.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ frame: 0 }));
vi.mock("remotion", async importOriginal => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 150, id: "NumberLabel" }),
}));

import { pairCompared, resolveCues, type CueSpec, type Word } from "./cueResolve";
import { NumberLabel } from "./more";
import { systemPrompt } from "./plan/planner";
import { TEMPLATES } from "./registry";
import { appearFrame } from "./timing";

/** Words as the transcriber timed them: "text@start-end …". */
const T = (s: string): Word[] =>
  s.split(" ").map(t => {
    const [text, range] = t.split("@");
    const [start, end] = range.split("-").map(Number);
    return { text, start, end };
  });

const label = (id: string, start: string, end: string, a: Record<string, unknown>, b: Record<string, unknown>, extra: Record<string, unknown> = {}): CueSpec => ({
  id,
  template: "NumberLabel",
  start,
  startPad: -0.15,
  end,
  endPad: 0.3,
  props: { kicker: "Kicker", a, b, ...extra },
});
/** The `compare` the template is handed for this cue on these words. */
const compared = (spec: CueSpec, words: Word[]) => resolveCues([spec], words)[0].props.compare;

// Gary's job 406, 82.0-86.4 s and 99.9-103.5 s.
const charge = T(
  "You@82.138-82.278 charge@82.318-82.618 $5@82.718-82.978 to@83.138-83.318 $10@83.358-83.659 a@83.699-83.719 knife@83.779-84.059 and@84.239-84.359 $10@84.459-84.679 to@84.719-84.799 $20@84.859-85.179 a@85.239-85.279 mower@85.319-85.579 blade,@85.599-85.899 and@86.28-86.36 the@86.38-86.46 work@86.5-86.7 takes@86.74-86.96"
);
const volume = T(
  "20@100.025-100.186 knives@100.226-100.566 is@100.666-100.766 a@100.806-100.846 slow@100.926-101.226 morning.@101.266-101.586 40@102.266-102.647 is@102.827-102.927 a@102.967-103.007 good@103.067-103.247 one.@103.347-103.467 but@104.058-104.178 edges@104.318-104.578"
);
// Dale's job 397, 64.6-68.2 s.
const furniture = T("boxes.@63.587-64.007 And@64.628-64.788 furniture,@64.928-65.408 $150@65.849-66.229 to@66.449-66.989 $600.@67.41-68.23 Once@68.891-69.091");
// Gideon's job 401, 15.4-19.4 s.
const age = T("He@15.427-15.528 is@15.608-15.688 64.@15.868-16.528 His@17.428-17.569 father@17.649-18.049 made@18.289-18.489 it@18.529-18.589 to@18.629-19.049 81.@19.289-19.409 And@20.49-20.59");
// Hank's job 382 (graphics-lab/cues/hank-382.json, figured-vs-took) and Ruth's job 350 (ruth-350.json, bowl-time-cost).
const figured = T("square.@70.55-71.28 I@71.28-71.39 figured@71.39-72.18 two@72.18-72.52 hours.@72.52-73.41 It@73.41-73.62 took@73.62-74.08 six.@74.08-74.75 It@74.75-74.97");
const bowl = T(
  "It@160.32-160.51 takes@160.51-160.88 about@160.88-161.28 25@161.28-161.76 minutes@161.76-162.32 apiece@162.32-162.8 and@162.8-163.04 the@163.04-163.6 cost@163.6-163.62 is@163.62-163.76 the@163.76-164 cord@164-164.4 and@164.4-164.65 a@164.65-164.72 little@164.93-165.26 thread@165.26-165.66 call@165.66-166.03 it@166.03-166.14 50@166.14-166.61 cents.@166.61-167.29 Everyone@167.29-167.87"
);

describe("a pair gets 'vs' only when it is compared: the words between its values, else the plan's mark", () => {
  const sharpening = (a: string, b: string, compare?: boolean) =>
    label("sharpening-prices", "You charge $5 to $10", "a mower blade,", { label: "A knife", value: "$5 to $10", at: a }, { label: "A mower blade", value: "$10 to $20", at: b }, compare === undefined ? {} : { compare });

  it("406 sharpening-prices: a price for each of two things, joined by 'and', is no comparison — even marked as one", () => {
    // as planned: each value's "at" runs on to its thing, so only "and" is said between them
    expect(compared(sharpening("@$5 to $10 a knife", "@$10 to $20 a mower"), charge)).toBe(false);
    expect(compared(sharpening("@$5 to $10 a knife", "@$10 to $20 a mower", true), charge)).toBe(false);
    // "at" on the bare number: "to $10 a knife and" — the join still ends on "and", the second value right after it
    expect(compared(sharpening("@$5", "@$10 to $20", true), charge)).toBe(false);
  });

  it("397 furniture-price-range: a range ('$150 to $600') is no comparison — even marked as one", () => {
    const range = label("furniture-price-range", "And furniture, $150 to $600.", "$150 to $600.", { label: "From", value: "$150", at: "@$150" }, { label: "Up to", value: "$600", at: "@$600." }, { compare: true });
    expect(compared(range, furniture)).toBe(false);
  });

  it("where the words between do not settle it, the plan's mark does (401's age and his father's, 406's volume math, 382's estimate and what it took)", () => {
    const ages = (compare?: boolean) =>
      label("age-vs-father", "He is 64.", "made it to 81.", { label: "His age", value: "64", at: "@sixty-four" }, { label: "His father", value: "81", at: "@eighty-one" }, compare === undefined ? {} : { compare });
    expect(compared(ages(true), age)).toBe(true);
    expect(compared(ages(), age)).toBe(false);
    const morning = label("volume-math", "20 knives is a slow morning.", "40 is a good one.", { label: "A slow morning", value: "20 knives", at: "@twenty knives" }, { label: "A good one", value: "40 knives", at: "@forty is a good" }, { compare: true });
    expect(compared(morning, volume)).toBe(true);
    const took = label("figured-vs-took", "I figured 2 hours. It", "It took 6.", { label: "Figured", value: "2 hours", at: "@2 hours." }, { label: "Took", value: "6", at: "@took 6." }, { compare: true });
    expect(compared(took, figured)).toBe(true);
  });

  it("two different measures the plan did not mark stay side by side (350: 'TIME 25 minutes vs COST 50 cents')", () => {
    const timeCost = label("bowl-time-cost", "It takes about twenty-five minutes apiece", "call it fifty cents", { label: "Time", value: "25 minutes", at: "@twenty-five minutes" }, { label: "Cost", value: "50 cents", at: "@fifty cents" });
    expect(compared(timeCost, bowl)).toBe(false);
  });

  it("a comparing word between the values compares them, marked or not", () => {
    expect(pairCompared(undefined, { join: "against", second: "$15" })).toBe(true);
    expect(pairCompared(false, { join: "for the plain one, compared to", second: "$40 for the oak" })).toBe(true);
    expect(pairCompared(undefined, { join: "a month instead of", second: "$90" })).toBe(true);
    const words = T("You@1.0-1.2 pay@1.2-1.4 $3@1.4-1.8 instead@1.9-2.2 of@2.2-2.3 $10.@2.3-2.8");
    expect(compared(label("pay", "You pay $3", "of $10.", { label: "Here", value: "$3", at: "@$3" }, { label: "There", value: "$10", at: "@$10." }), words)).toBe(true);
  });

  it("a contrast named after the 'and' is the plan's call, never read as a list", () => {
    // "…and now 3": the join ends on "now", or the second value's own words open on it
    expect(pairCompared(true, { join: "minutes back then, and now", second: "3 minutes." })).toBe(true);
    expect(pairCompared(true, { join: "and", second: "now 3 minutes." })).toBe(true);
    expect(pairCompared(true, { join: "and his", second: "81." })).toBe(true);
    // a choice or a range said in words is not compared
    expect(pairCompared(true, { join: "or", second: "$10 a blade" })).toBe(false);
    expect(pairCompared(true, { join: "all the way up to", second: "six hundred dollars" })).toBe(false);
    // nothing timed to words (an "at" in seconds, as in the Studio sample): the mark alone
    expect(pairCompared(true)).toBe(true);
    expect(pairCompared(undefined)).toBe(false);
    expect(pairCompared("true")).toBe(false);
  });
});

/** NumberLabel drawn at `frame`, its "vs" element's style (undefined when it is not drawn). */
const versusAt = (frame: number, props: Record<string, unknown>) => {
  clock.frame = frame;
  const html = renderToStaticMarkup(React.createElement(NumberLabel, props as React.ComponentProps<typeof NumberLabel>));
  return /<div style="([^"]*)">vs<\/div>/.exec(html)?.[1];
};
const opacity = (style: string | undefined) => Number(/opacity:([\d.]+)/.exec(style ?? "")?.[1] ?? NaN);

describe("the template draws 'vs' only for a compared pair, and only once the second value is said", () => {
  // 406's sharpening-prices as resolved: the first value at 0.53 s into the cue, the second at 2.43 s.
  const pair = { durationSec: 4.17, kicker: "You charge", a: { label: "A knife", value: "$5 to $10", at: 0.533 }, b: { label: "A mower blade", value: "$10 to $20", at: 2.433 } };

  it("no 'vs' at all when the pair is not compared, or nobody said it was", () => {
    for (const f of [0, 30, 100]) {
      expect(versusAt(f, { ...pair, compare: false })).toBeUndefined();
      expect(versusAt(f, pair)).toBeUndefined();
    }
  });

  it("a compared pair's 'vs' enters with the second value — never alone beside the kicker, or beside the first value only", () => {
    const b = appearFrame(pair.b.at, 30);
    expect(opacity(versusAt(0, { ...pair, compare: true }))).toBe(0);
    expect(opacity(versusAt(b - 1, { ...pair, compare: true }))).toBe(0);
    expect(opacity(versusAt(b + 12, { ...pair, compare: true }))).toBeGreaterThan(0.9);
  });

  it("the Studio sample ('Then 17 min / Now 3 min') is a comparison and shows its 'vs'", () => {
    const sample = TEMPLATES.find(t => t.id === "NumberLabel")!.defaultProps;
    expect(sample.compare).toBe(true);
    expect(opacity(versusAt(120, sample))).toBeGreaterThan(0.9);
  });
});

describe("the planner is told when a pair is compared", () => {
  it("names 'compare', what is compared, and that a range or a list is not", () => {
    const prompt = systemPrompt({ kept: false });
    expect(prompt).toMatch(/NumberLabel — says two values together: two compared, a range, or one for each of two things/);
    expect(prompt).toContain('"compare": true draws "vs" between the two, ONLY when the line weighs one value against the other');
    expect(prompt).toMatch(/A range \("\$20 to \$50"\), two values\s+listed with "and" or offered with "or"/);
  });
});

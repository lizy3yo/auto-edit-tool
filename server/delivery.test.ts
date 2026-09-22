import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync } from "fs";
import path from "path";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));
const ffmpegCalls: string[][] = [];
vi.mock("./videoAssembly", () => ({
  runFfmpeg: async (args: string[]) => {
    ffmpegCalls.push(args);
    writeFileSync(args[args.length - 1], "master");
  },
  downloadToTemp: async (_url: string, dir: string, name: string) => {
    const p = path.join(dir, name);
    writeFileSync(p, "run");
    return p;
  },
}));
// The run levels are set per test by file name (`run-0.mp3` → index 0); a run with no entry
// "fails to measure", which is the path a bad download takes in production.
const { runLevels } = vi.hoisted(() => ({
  runLevels: {} as Record<number, number>,
}));
vi.mock("./narrationLevel", async () => {
  const actual =
    await vi.importActual<typeof import("./narrationLevel")>(
      "./narrationLevel"
    );
  return {
    ...actual,
    measureSpeechLevelDb: async (p: string) => {
      const i = Number(/run-(\d+)\.mp3$/.exec(p)?.[1]);
      if (!(i in runLevels)) throw new Error("unmeasurable");
      return runLevels[i];
    },
  };
});

import {
  scriptParagraphs,
  parseDeliveryPlan,
  planDelivery,
  deliverySpeedFor,
  deliveryRuns,
  planChangesTheRead,
  applyDeliveryToScenes,
  concatWithPauses,
  runMatchGainsDb,
  type DeliveryPlan,
} from "./delivery";

const SCRIPT =
  "Your first blanket is going to try and quit on you three times. And I can tell you where all three are waiting.\n\n" +
  "They come from four small habits nobody bothers to teach you, and we're building all four today.\n\n" +
  "Habit one. Count your chain before you turn. Every single row.";

const plan = (
  paces: string[],
  pauses: number[] = [],
  moods: string[] = [],
  gestures: string[] = []
): DeliveryPlan => ({
  paragraphs: paces.map((pace, i) => ({
    index: i + 1,
    pace: pace as any,
    pauseAfterMs: pauses[i] ?? 0,
    mood: moods[i] ?? "",
    gesture: gestures[i] ?? "",
  })),
});

beforeEach(() => {
  mockInvoke.mockReset();
  ffmpegCalls.length = 0;
  for (const k of Object.keys(runLevels)) delete runLevels[Number(k)];
});

describe("parseDeliveryPlan", () => {
  it("reads Claude's JSON, defaults what is missing, snaps pauses and trims moods", () => {
    const text =
      'Here you go:\n{"paragraphs":[{"index":1,"pace":"measured","pauseAfterMs":250,"mood":"warm, gentle smile — eyes soft and kind","gesture":"small nod on the number, then settles back"},' +
      '{"index":3,"pace":"loud","pauseAfterMs":"600","mood":"serious"}]}';
    const p = parseDeliveryPlan(text, 3)!;
    expect(p.paragraphs).toEqual([
      {
        index: 1,
        pace: "measured",
        pauseAfterMs: 300,
        mood: "warm, gentle smile eyes soft",
        gesture: "small nod on the number, then", // trimmed to 6 words
      },
      // not returned → defaults
      { index: 2, pace: "natural", pauseAfterMs: 0, mood: "", gesture: "" },
      // bad pace → natural; no gesture given → ""
      {
        index: 3,
        pace: "natural",
        pauseAfterMs: 600,
        mood: "serious",
        gesture: "",
      },
    ]);
  });

  it("returns null for a reply with no usable JSON", () => {
    expect(parseDeliveryPlan("I cannot do that.", 3)).toBeNull();
    expect(parseDeliveryPlan('{"paragraphs":[]}', 3)).toBeNull();
  });
});

describe("planDelivery", () => {
  it("makes one Claude call with every paragraph numbered and returns the plan", async () => {
    mockInvoke.mockResolvedValue({
      text: '{"paragraphs":[{"index":1,"pace":"natural","pauseAfterMs":0,"mood":"warm"},{"index":2,"pace":"slow","pauseAfterMs":300,"mood":"serious"},{"index":3,"pace":"slow","pauseAfterMs":0,"mood":"patient"}]}',
    });
    const p = await planDelivery(SCRIPT, { hostName: "Granny Mae" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const msg = mockInvoke.mock.calls[0][0].userMessage as string;
    expect(msg).toContain("The host is Granny Mae.");
    expect(msg).toContain("[1] Your first blanket");
    expect(msg).toContain("[3] Habit one.");
    expect(msg).toContain("exactly 3 entries");
    // The body cue is asked for in the SAME call — gestures cost nothing extra.
    expect(msg).toContain('"gesture"');
    expect(msg).toContain("use the head above all");
    expect(p?.paragraphs.map(x => x.pace)).toEqual(["natural", "slow", "slow"]);
  });

  it("fails open: a thrown call or garbage reply yields null, never an error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("429"));
    expect(await planDelivery(SCRIPT)).toBeNull();
    mockInvoke.mockResolvedValueOnce({ text: "nope" });
    expect(await planDelivery(SCRIPT)).toBeNull();
    expect(await planDelivery("   ")).toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

describe("deliverySpeedFor", () => {
  it("shades the channel's base speed by the pace and clamps", () => {
    expect(deliverySpeedFor(undefined, "natural")).toBeUndefined(); // untouched: the voice's own pace
    expect(deliverySpeedFor(0.8, "natural")).toBe(0.8);
    expect(deliverySpeedFor(0.8, "slow")).toBe(0.68);
    expect(deliverySpeedFor(undefined, "brisk")).toBe(1.08);
    expect(deliverySpeedFor(1.2, "brisk")).toBe(1.3); // clamped
    expect(deliverySpeedFor(0.7, "slow")).toBe(0.6); // clamped
    expect(deliverySpeedFor(0.9, undefined)).toBe(0.9);
  });
});

describe("deliveryRuns", () => {
  it("joins same-pace paragraphs into one run and breaks where the pace changes", () => {
    const runs = deliveryRuns(SCRIPT, plan(["natural", "natural", "slow"]));
    expect(runs.map(r => r.pace)).toEqual(["natural", "slow"]);
    expect(runs[0].paragraphIndices).toEqual([1, 2]);
    expect(runs[0].text).toContain("three times.");
    expect(runs[0].text).toContain("\n\nThey come from");
    expect(runs[1].text).toBe(
      "Habit one. Count your chain before you turn. Every single row."
    );
  });

  it("a requested pause ends its run, and the last run never carries one", () => {
    const runs = deliveryRuns(
      SCRIPT,
      plan(["natural", "natural", "natural"], [300, 0, 600])
    );
    expect(runs.map(r => r.paragraphIndices)).toEqual([[1], [2, 3]]);
    expect(runs.map(r => r.pauseAfterMs)).toEqual([300, 0]);
  });

  it("planChangesTheRead is false for one pace and no pauses — the one-shot read stays", () => {
    expect(planChangesTheRead(plan(["natural", "natural", "natural"]))).toBe(
      false
    );
    expect(planChangesTheRead(plan(["measured", "measured"]))).toBe(false);
    expect(planChangesTheRead(plan(["natural", "slow"]))).toBe(true);
    expect(planChangesTheRead(plan(["natural"], [300]))).toBe(true);
    expect(planChangesTheRead(null)).toBe(false);
  });
});

describe("applyDeliveryToScenes", () => {
  it("gives each scene the pace and mood of the paragraph its words come from", () => {
    const scenes: any[] = [
      {
        index: 1,
        scriptText:
          "Your first blanket is going to try and quit on you three times.",
      },
      {
        index: 2,
        scriptText: "And I can tell you where all three are waiting.",
      },
      {
        index: 3,
        scriptText:
          "They come from four small habits nobody bothers to teach you, and we're building all four today.",
      },
      { index: 4, scriptText: "Habit one. Count your chain before you turn." },
      { index: 5, scriptText: "" },
    ];
    const n = applyDeliveryToScenes(
      scenes,
      plan(
        ["natural", "measured", "slow"],
        [],
        ["warm gentle smile", "", "serious, patient"],
        ["small nod on the number", "leans in slightly", ""]
      ),
      SCRIPT
    );
    expect(n).toBe(4);
    expect(scenes.map(s => s.deliveryPace)).toEqual([
      "natural",
      "natural",
      "measured",
      "slow",
      undefined,
    ]);
    expect(scenes.map(s => s.deliveryCue)).toEqual([
      "warm gentle smile",
      "warm gentle smile",
      undefined,
      "serious, patient",
      undefined,
    ]);
    // The body cue rides the same paragraph mapping as the mood.
    expect(scenes.map(s => s.gestureCue)).toEqual([
      "small nod on the number",
      "small nod on the number",
      "leans in slightly",
      undefined,
      undefined,
    ]);
  });
});

describe("concatWithPauses", () => {
  it("splices room tone, not silence, after the runs that ask for it", async () => {
    await concatWithPauses(["u1", "u2", "u3"], [300, 0, 600]);
    const args = ffmpegCalls[0];
    const graph = args[args.indexOf("-filter_complex") + 1];
    // Three runs, one pause (after run 1; run 2 asked for none; the last run's is meaningless).
    expect(graph.match(/anoisesrc/g)).toHaveLength(1);
    expect(graph).toContain("atrim=end=0.300");
    expect(graph).toContain("[r0][p0][r1][r2]concat=n=4");
    expect(graph).not.toContain("anullsrc");
    // Nothing measured ⇒ nothing gained: the runs are joined as they arrived.
    expect(graph).not.toContain("volume=");
    expect(scriptParagraphs(SCRIPT)).toHaveLength(3);
  });

  it("matches each run to the median level before the join, skipping ones it cannot measure", async () => {
    // Run 1 sits 4 dB under the median, run 3 sits 3 dB over; run 2 is the median itself, and
    // run 4 never measured — the shape of a delivery-run master with one quiet generation.
    Object.assign(runLevels, { 0: -30, 1: -26, 2: -23 });
    await concatWithPauses(["u1", "u2", "u3", "u4"], [0, 0, 0, 0]);
    const args = ffmpegCalls[0];
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain(
      "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=4dB[r0]"
    );
    expect(graph).toContain("channel_layouts=stereo[r1]");
    expect(graph).toContain("channel_layouts=stereo,volume=-3dB[r2]");
    expect(graph).toContain("channel_layouts=stereo[r3]");
    expect(graph).toContain("[r0][r1][r2][r3]concat=n=4");
  });
});

describe("runMatchGainsDb", () => {
  it("pulls every measured run to the median and leaves the unmeasured at 0", () => {
    expect(runMatchGainsDb([-30, -26, -23, undefined])).toEqual([4, 0, -3, 0]);
  });
  it("needs two measured runs before it trusts a median", () => {
    expect(runMatchGainsDb([-30])).toEqual([0]);
    expect(runMatchGainsDb([-30, undefined, NaN])).toEqual([0, 0, 0]);
  });
  it("ignores a difference inside the deadband and a difference too large to be a real take", () => {
    // 0.3 dB is not worth a gain; 12 dB is a wrong file, not a quiet read.
    expect(runMatchGainsDb([-26.3, -26, -26])).toEqual([0, 0, 0]);
    expect(runMatchGainsDb([-38, -26, -26])).toEqual([0, 0, 0]);
  });
});

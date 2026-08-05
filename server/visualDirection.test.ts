import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LongformInputParams, StoryboardScene } from "../shared/types";

const invokeGemini = vi.fn();
vi.mock("./gemini", () => ({
  invokeGemini: (...a: any[]) => invokeGemini(...a),
}));

const getChannelLayer = vi.fn();
vi.mock("./composer", () => ({
  getChannelLayer: (...a: any[]) => getChannelLayer(...a),
}));

import {
  VISUAL_DIRECTION_SYSTEM,
  STYLE_BIBLE_SYSTEM,
  buildVisualDirectionUserMessage,
  buildStyleBibleUserMessage,
  parseVisualDirection,
  resolveBeats,
  deriveVisualDirection,
  deriveStyleBible,
  STYLE_BIBLE_MAX_WORDS,
  BEAT_MAX_WORDS,
} from "./visualDirection";

// Braces matter: vitest treats a function RETURNED from beforeEach as a teardown hook, and
// mockReset() returns the mock — a braceless arrow would invoke it after every test.
beforeEach(() => {
  invokeGemini.mockReset();
  getChannelLayer.mockReset();
  getChannelLayer.mockResolvedValue({
    layerContent: "Tom is a tired gardener.",
  });
});

const scene = (index: number, over: Partial<StoryboardScene> = {}) =>
  ({
    index,
    scriptText: `line ${index}`,
    visualPrompt: `visual ${index}`,
    hostPresent: false,
    ...over,
  }) as StoryboardScene;

const params = (over: Partial<LongformInputParams> = {}) =>
  ({
    channelKey: "demo",
    script: "s",
    lockMode: "none",
    voiceId: "v",
    ...over,
  }) as LongformInputParams;

const ok = (payload: unknown, stopReason = "end_turn") => ({
  text: JSON.stringify(payload),
  stopReason,
  inputTokens: 1,
  outputTokens: 1,
});

describe("parseVisualDirection", () => {
  it("parses a well-formed payload", () => {
    const d = parseVisualDirection(
      JSON.stringify({
        styleBible:
          "a cramped Zone 6b backyard, late autumn, chipped terracotta",
        beats: [{ from: 1, to: 8, beat: "set up the frost problem" }],
      })
    );
    expect(d?.styleBible).toContain("Zone 6b");
    expect(d?.beats).toEqual([
      { from: 1, to: 8, beat: "set up the frost problem" },
    ]);
  });

  it("parses JSON wrapped in a markdown fence", () => {
    const raw = '```json\n{"styleBible":"a windy allotment","beats":[]}\n```';
    expect(parseVisualDirection(raw)?.styleBible).toBe("a windy allotment");
  });

  it("returns null on max_tokens truncation", () => {
    expect(
      parseVisualDirection('{"styleBible":"a wind', "max_tokens")
    ).toBeNull();
  });

  it("returns null when the style bible is missing or blank — it's the load-bearing half", () => {
    expect(parseVisualDirection(JSON.stringify({ beats: [] }))).toBeNull();
    expect(
      parseVisualDirection(JSON.stringify({ styleBible: "   ", beats: [] }))
    ).toBeNull();
  });

  it("keeps the bible when beats is missing or not an array", () => {
    expect(
      parseVisualDirection(JSON.stringify({ styleBible: "a shed" }))
    ).toEqual({ styleBible: "a shed", beats: [] });
    expect(
      parseVisualDirection(
        JSON.stringify({ styleBible: "a shed", beats: "nope" })
      )
    ).toEqual({ styleBible: "a shed", beats: [] });
  });

  it("filters off-shape beats PER ITEM — one bad range must not cost the good ones", () => {
    const d = parseVisualDirection(
      JSON.stringify({
        styleBible: "a shed",
        beats: [
          { from: 1, to: 4, beat: "good" },
          { from: 9, to: 2, beat: "backwards range" },
          { from: 0, to: 3, beat: "zero-based, indices are 1-based" },
          { from: 1.5, to: 4, beat: "non-integer" },
          { from: 5, to: 6, beat: "   " },
          { from: 7, to: 8 },
          "not an object",
          null,
          { from: 10, to: 12, beat: "also good" },
        ],
      })
    );
    expect(d?.beats).toEqual([
      { from: 1, to: 4, beat: "good" },
      { from: 10, to: 12, beat: "also good" },
    ]);
  });

  it("truncates an over-long bible and beat — the prompt asks for a cap, this enforces it", () => {
    const long = (n: number) =>
      Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const d = parseVisualDirection(
      JSON.stringify({
        styleBible: long(200),
        beats: [{ from: 1, to: 2, beat: long(80) }],
      })
    );
    expect(d!.styleBible.split(/\s+/)).toHaveLength(STYLE_BIBLE_MAX_WORDS);
    expect(d!.beats[0].beat.split(/\s+/)).toHaveLength(BEAT_MAX_WORDS);
  });
});

describe("resolveBeats", () => {
  it("denormalizes ranges onto the scenes they cover", () => {
    const scenes = [scene(1), scene(2), scene(3), scene(4)];
    const map = resolveBeats(
      [
        { from: 1, to: 2, beat: "opening" },
        { from: 3, to: 4, beat: "payoff" },
      ],
      scenes
    );
    expect(map).toEqual({
      1: "opening",
      2: "opening",
      3: "payoff",
      4: "payoff",
    });
  });

  it("leaves a scene no range covers without a beat", () => {
    const map = resolveBeats(
      [{ from: 1, to: 2, beat: "opening" }],
      [scene(1), scene(5)]
    );
    expect(map).toEqual({ 1: "opening" });
    expect(map[5]).toBeUndefined();
  });

  it("resolves overlapping ranges deterministically (first wins)", () => {
    const map = resolveBeats(
      [
        { from: 1, to: 5, beat: "first" },
        { from: 3, to: 8, beat: "second" },
      ],
      [scene(4)]
    );
    expect(map[4]).toBe("first");
  });

  it("returns an empty map for no beats", () => {
    expect(resolveBeats([], [scene(1)])).toEqual({});
  });
});

describe("buildVisualDirectionUserMessage", () => {
  it("includes the persona when present and numbers every scene", () => {
    const msg = buildVisualDirectionUserMessage("Tom is tired.", [
      scene(1),
      scene(2),
    ]);
    expect(msg).toContain("Channel personality profile:\nTom is tired.");
    expect(msg).toContain("1: line 1");
    expect(msg).toContain("2: line 2");
  });

  it("omits the persona section entirely when there is no channel layer", () => {
    const msg = buildVisualDirectionUserMessage(null, [scene(1)]);
    expect(msg).not.toContain("Channel personality profile");
    expect(msg).toContain("1: line 1");
  });

  it("falls back to narration when a scene has no verbatim scriptText", () => {
    const msg = buildVisualDirectionUserMessage(null, [
      scene(1, { scriptText: undefined, narration: "spoken words" }),
    ]);
    expect(msg).toContain("1: spoken words");
  });

  it("includes the video subject when set", () => {
    expect(
      buildVisualDirectionUserMessage(null, [scene(1)], "overwintering garlic")
    ).toContain("Video subject: overwintering garlic");
  });

  it("pins a known bible verbatim so the beats agree with the seeded world", () => {
    const msg = buildVisualDirectionUserMessage(
      null,
      [scene(1)],
      undefined,
      "a cramped Zone 6b backyard, late autumn"
    );
    expect(msg).toContain("STYLE BIBLE is already fixed");
    expect(msg).toContain("a cramped Zone 6b backyard, late autumn");
  });

  it("omits the bible block when no known bible is passed", () => {
    expect(buildVisualDirectionUserMessage(null, [scene(1)])).not.toContain(
      "already fixed"
    );
  });
});

describe("buildStyleBibleUserMessage", () => {
  it("sends persona + subject + the RAW script, with no scene numbers", () => {
    const msg = buildStyleBibleUserMessage(
      "Tom is tired.",
      "The whole spoken script goes here.",
      "overwintering garlic"
    );
    expect(msg).toContain("Channel personality profile:\nTom is tired.");
    expect(msg).toContain("Video subject: overwintering garlic");
    expect(msg).toContain("The whole spoken script goes here.");
    expect(msg).not.toMatch(/^\d+:/m); // no "1: ..." numbered scene lines
  });

  it("omits the persona section when there is no channel layer", () => {
    expect(buildStyleBibleUserMessage(null, "script")).not.toContain(
      "Channel personality profile"
    );
  });
});

// The bible is content-only BY PROMPT ONLY — nothing in code stops a look-flavored one, and such
// a bible would contradict `amateurIphoneLook()` inside the same prompt, splitting every render
// toward the stock look. This test and the ban list it guards are the entire enforcement, and
// nothing inspects the rendered frames, so a regression here is invisible until review.
describe("VISUAL_DIRECTION_SYSTEM (smoke bait)", () => {
  it("bans camera, lens, and depth-of-field language", () => {
    for (const term of [
      /close-up/i,
      /shallow depth/i,
      /35mm/i,
      /bokeh/i,
      /focal length/i,
    ]) {
      expect(VISUAL_DIRECTION_SYSTEM).toMatch(term);
    }
    expect(VISUAL_DIRECTION_SYSTEM).toMatch(/never say how it is filmed/i);
  });

  it("bans lighting, palette, and grade language", () => {
    for (const term of [/golden hour/i, /backlit/i, /grade/i, /desaturated/i]) {
      expect(VISUAL_DIRECTION_SYSTEM).toMatch(term);
    }
  });

  it("bans printed matter — the persona layer carries the channel's book strategy", () => {
    expect(VISUAL_DIRECTION_SYSTEM).toMatch(/book cover/i);
    expect(VISUAL_DIRECTION_SYSTEM).toMatch(/printed guide/i);
  });

  it("frames the direction as a tie-breaker, never an addition", () => {
    expect(VISUAL_DIRECTION_SYSTEM).toMatch(/TIE-BREAKER, never an addition/);
    expect(VISUAL_DIRECTION_SYSTEM).toMatch(
      /does not state|doesn't state|leaves open/i
    );
  });

  it("asks for ranges, not one entry per scene — the truncation cliff depends on it", () => {
    expect(VISUAL_DIRECTION_SYSTEM).toMatch(
      /do NOT\s+write a range per scene/i
    );
  });
});

describe("deriveVisualDirection", () => {
  it("returns the bible with beats already denormalized onto scene indices", async () => {
    invokeGemini.mockResolvedValue(
      ok({
        styleBible: "a cramped backyard, late autumn",
        beats: [{ from: 1, to: 2, beat: "set up the problem" }],
      })
    );
    const d = await deriveVisualDirection(params(), [
      scene(1),
      scene(2),
      scene(3),
    ]);
    expect(d).toEqual({
      styleBible: "a cramped backyard, late autumn",
      beats: { 1: "set up the problem", 2: "set up the problem" },
    });
  });

  it("reuses getChannelLayer so visuals agree with the script's persona", async () => {
    invokeGemini.mockResolvedValue(ok({ styleBible: "a shed", beats: [] }));
    await deriveVisualDirection(params({ channelKey: "demo" }), [scene(1)]);
    expect(getChannelLayer).toHaveBeenCalledWith("demo");
    expect(invokeGemini.mock.calls[0][0].userMessage).toContain(
      "Tom is a tired gardener."
    );
  });

  it("still derives when the channel has no persona anywhere", async () => {
    getChannelLayer.mockResolvedValue(null);
    invokeGemini.mockResolvedValue(ok({ styleBible: "a shed", beats: [] }));
    const d = await deriveVisualDirection(params(), [scene(1)]);
    expect(d?.styleBible).toBe("a shed");
  });

  it("fails open on an LLM throw — a job must never die for want of direction", async () => {
    invokeGemini.mockRejectedValue(new Error("529 overloaded"));
    expect(await deriveVisualDirection(params(), [scene(1)])).toBeNull();
    expect(invokeGemini).toHaveBeenCalledTimes(2);
  });

  it("retries once, then succeeds", async () => {
    invokeGemini
      .mockRejectedValueOnce(new Error("529 overloaded"))
      .mockResolvedValueOnce(ok({ styleBible: "a shed", beats: [] }));
    const d = await deriveVisualDirection(params(), [scene(1)]);
    expect(d?.styleBible).toBe("a shed");
    expect(invokeGemini).toHaveBeenCalledTimes(2);
  });

  it("fails open on an unparseable payload", async () => {
    invokeGemini.mockResolvedValue({
      text: "Sure! Here's your direction.",
      stopReason: "end_turn",
    });
    expect(await deriveVisualDirection(params(), [scene(1)])).toBeNull();
  });

  it("fails open on a truncated payload rather than half-applying it", async () => {
    invokeGemini.mockResolvedValue(
      ok({ styleBible: "a shed", beats: [] }, "max_tokens")
    );
    expect(await deriveVisualDirection(params(), [scene(1)])).toBeNull();
  });

  it("makes no LLM call for an empty scene list", async () => {
    expect(await deriveVisualDirection(params(), [])).toBeNull();
    expect(invokeGemini).not.toHaveBeenCalled();
  });
});

describe("STYLE_BIBLE_SYSTEM (smoke bait)", () => {
  it("shares the load-bearing ban list with the combined prompt", () => {
    for (const term of [
      /close-up/i,
      /golden hour/i,
      /book cover/i,
      /TIE-BREAKER, never an addition/,
    ]) {
      expect(STYLE_BIBLE_SYSTEM).toMatch(term);
    }
  });

  it("asks for the bible only — no beats contract", () => {
    expect(STYLE_BIBLE_SYSTEM).toContain('{"styleBible":"..."}');
    expect(STYLE_BIBLE_SYSTEM).not.toContain('"beats"');
  });
});

describe("deriveStyleBible", () => {
  it("returns just the bible from persona + raw script (no scenes needed)", async () => {
    invokeGemini.mockResolvedValue(
      ok({ styleBible: "a cramped backyard, late autumn" })
    );
    const bible = await deriveStyleBible(params(), "the full spoken script");
    expect(bible).toBe("a cramped backyard, late autumn");
    expect(getChannelLayer).toHaveBeenCalledWith("demo");
    expect(invokeGemini.mock.calls[0][0].systemPrompt).toBe(STYLE_BIBLE_SYSTEM);
    expect(invokeGemini.mock.calls[0][0].userMessage).toContain(
      "the full spoken script"
    );
  });

  it("still derives when the channel has no persona anywhere", async () => {
    getChannelLayer.mockResolvedValue(null);
    invokeGemini.mockResolvedValue(ok({ styleBible: "a shed" }));
    expect(await deriveStyleBible(params(), "script")).toBe("a shed");
  });

  it("retries once, then succeeds", async () => {
    invokeGemini
      .mockRejectedValueOnce(new Error("529 overloaded"))
      .mockResolvedValueOnce(ok({ styleBible: "a windy allotment" }));
    expect(await deriveStyleBible(params(), "script")).toBe(
      "a windy allotment"
    );
    expect(invokeGemini).toHaveBeenCalledTimes(2);
  });

  it("fails open to null after two failed attempts — a job must never die for want of a bible", async () => {
    invokeGemini.mockRejectedValue(new Error("529 overloaded"));
    expect(await deriveStyleBible(params(), "script")).toBeNull();
    expect(invokeGemini).toHaveBeenCalledTimes(2);
  });

  it("fails open on a truncated payload rather than half-applying it", async () => {
    invokeGemini.mockResolvedValue(ok({ styleBible: "a shed" }, "max_tokens"));
    expect(await deriveStyleBible(params(), "script")).toBeNull();
  });

  it("makes no LLM call for an empty script", async () => {
    expect(await deriveStyleBible(params(), "   ")).toBeNull();
    expect(invokeGemini).not.toHaveBeenCalled();
  });
});

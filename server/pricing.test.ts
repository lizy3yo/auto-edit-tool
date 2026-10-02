import { describe, it, expect } from "vitest";
import {
  claudeRateFor,
  priceLine,
  lipsyncRateFor,
  RATES,
  type UsageLine,
} from "./pricing";

/**
 * These are the arithmetic the cost dialog shows a user. A wrong rate lookup or a dropped
 * cache-token discount is invisible in the UI — it just quietly reports the wrong number — so
 * the cases that have actually bitten in similar code are pinned here.
 */

const line = (
  over: Partial<UsageLine> & Pick<UsageLine, "lane">
): UsageLine => ({
  provider: "test",
  model: "test",
  calls: 1,
  quantity: 0,
  ...over,
});

describe("claudeRateFor", () => {
  it("resolves a dated model id against its own rate", () => {
    // The authoring lane pins `claude-haiku-4-5-20251001`; without the date allowance it
    // would price the busiest LLM lane at $0.
    expect(claudeRateFor("claude-haiku-4-5-20251001")).toMatchObject({
      input: 1,
      output: 5,
      cacheRead: 0.1,
    });
  });

  it("never prices a model at a neighbour's rate", () => {
    // The prefix lookup this replaced priced claude-opus-5-5 as claude-opus-5 ($5/$25 against
    // $4/$20) and claude-sonnet-5-5 at the old Sonnet rate — every video's Claude cost read
    // high and looked right (2026-10-02).
    expect(claudeRateFor("claude-opus-5-5")).toMatchObject({
      input: 4,
      output: 20,
      cacheRead: 0.2,
    });
    expect(claudeRateFor("claude-opus-5")).toMatchObject({
      input: 5,
      output: 25,
      cacheRead: 0.5,
    });
    expect(claudeRateFor("claude-sonnet-5-5")?.input).toBe(2);
    // A model nobody has priced yet reports "rate not set", never its family's old price.
    expect(claudeRateFor("claude-sonnet-5-7")).toBeNull();
    expect(claudeRateFor("claude-opus-5-5-fast")).toBeNull();
  });

  it("returns null for an unknown model rather than guessing", () => {
    expect(claudeRateFor("some-future-model")).toBeNull();
  });

  it("has a rate for every Claude model the server calls", async () => {
    // A model added to a pipeline step without a row in CLAUDE_RATES would report its spend
    // as "rate not set" on every video. Any quoted claude-… id in server code must price.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const ids = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "node_modules" && name !== "assets") walk(path);
        } else if (
          name.endsWith(".ts") &&
          !name.endsWith(".test.ts") &&
          name !== "pricing.ts"
        ) {
          const src = readFileSync(path, "utf8");
          for (const m of src.matchAll(/["'`](claude-[a-z0-9.-]+)["'`]/g))
            ids.add(m[1]);
        }
      }
    };
    walk(import.meta.dirname);
    walk(join(import.meta.dirname, "..", "shared"));
    expect(ids.size).toBeGreaterThan(3);
    const unpriced = [...ids].filter(id => !claudeRateFor(id));
    expect(unpriced, `no rate in CLAUDE_RATES for: ${unpriced.join(", ")}`).toEqual([]);
  });
});

describe("priceLine — LLM", () => {
  it("prices input and output tokens at the model's published rates", () => {
    const r = priceLine(
      line({
        lane: "llm",
        provider: "anthropic",
        model: "claude-opus-4-8",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })
    );
    expect(r.usd).toBeCloseTo(30, 6); // $5 in + $25 out
    expect(r.exact).toBe(true);
  });

  it("prices cache reads at the model's own rate, writes at 1.25x (5 min) or 2x (1 h)", () => {
    // Folding cache tokens into input_tokens would overcharge a cached prompt tenfold —
    // this is the single easiest way to make the whole figure wrong.
    const r = priceLine(
      line({
        lane: "llm",
        model: "claude-haiku-4-5-20251001",
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      })
    );
    expect(r.usd).toBeCloseTo(0.1 + 1.25, 6);
  });

  it("reads Opus 5.5's cache at 0.05x of input, not the old flat 0.1x", () => {
    const r = priceLine(
      line({
        lane: "llm",
        model: "claude-opus-5-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        cacheWrite1hTokens: 1_000_000,
      })
    );
    // $4 in + $20 out + $0.20 read + $5 (5-min write) + $8 (1-hour write)
    expect(r.usd).toBeCloseTo(4 + 20 + 0.2 + 5 + 8, 6);
  });

  it("uses the dollars fixed at call time, so a later price change never rewrites a video", () => {
    const r = priceLine(
      line({
        lane: "llm",
        model: "claude-opus-5-5",
        calls: 3,
        inputTokens: 1_000_000,
        usd: 1.234,
        pricedCalls: 3,
      })
    );
    expect(r.usd).toBe(1.234);
    // One call without a fixed price (a model nobody had priced yet): the whole line is
    // priced from its tokens at today's rates instead of a partial sum.
    const partial = priceLine(
      line({ lane: "llm", model: "claude-opus-5-5", calls: 3, inputTokens: 1_000_000, usd: 1, pricedCalls: 2 })
    );
    expect(partial.usd).toBeCloseTo(4, 6);
  });

  it("flags an unknown model as unpriced rather than inventing a rate", () => {
    const r = priceLine(
      line({
        lane: "llm",
        model: "claude-nonexistent-9",
        inputTokens: 5_000_000,
      })
    );
    expect(r.usd).toBe(0);
    expect(r.exact).toBe(false);
    expect(r.rateKnown).toBe(false);
  });
});

describe("priceLine — metered non-LLM lanes", () => {
  it("prices TTS per thousand characters, per vendor", () => {
    const r = priceLine(
      line({ lane: "tts", provider: "sixtynine_labs", quantity: 10_000 })
    );
    expect(r.usd).toBeCloseTo(10 * RATES.ttsPer1kChars, 6);
    // Rate is a list-price assumption, so this must never claim to be exact.
    expect(r.exact).toBe(false);

    // A second vendor must NOT be priced at the first one's rate — the whole reason this lane
    // stopped being a single flat number when MiniMax was added.
    const mm = priceLine(
      line({ lane: "tts", provider: "minimax", quantity: 10_000 })
    );
    expect(mm.usd).toBeCloseTo(10 * RATES.minimaxTtsPer1kChars, 6);
  });

  it("reports an unmapped TTS vendor as unpriced rather than guessing", () => {
    // Same rule the image and video lanes follow: a rate we cannot vouch for is a visible gap,
    // never a neighbour's number wearing this vendor's name.
    const r = priceLine(
      line({ lane: "tts", provider: "whoever", quantity: 1000 })
    );
    expect(r.usd).toBe(0);
    expect(r.rateKnown).toBe(false);
  });

  it("prices images per image, per vendor", () => {
    const openai = priceLine(
      line({ lane: "image", provider: "openai", quantity: 10 })
    );
    const apimart = priceLine(
      line({ lane: "image", provider: "apimart", quantity: 10 })
    );
    expect(openai.usd).toBeCloseTo(10 * RATES.openaiImage, 6);
    expect(apimart.usd).toBeCloseTo(10 * RATES.apimartImage, 6);
  });

  it("prices b-roll clips per second of generated video", () => {
    const r = priceLine(
      line({ lane: "video", provider: "apimart", quantity: 15 })
    );
    expect(r.usd).toBeCloseTo(15 * RATES.apimartVideoPerSecond, 6);
  });

  it("prices lip-sync per second of rendered host video", () => {
    const heygen = priceLine(
      line({ lane: "lipsync", provider: "heygen", quantity: 100 })
    );
    expect(heygen.usd).toBeCloseTo(100 * RATES.heygenPerSecond, 6);
  });
});

describe("unmapped providers are visible, never silently mispriced", () => {
  // Regression: AIReiter shipped as a drop-in for the APIMART lane and, because the image
  // and video branches used APIMART as a bare `else`, its spend was priced at APIMART's
  // rates without a word. A wrong number that looks right is worse than a visible gap, so
  // every lane now looks up an explicit map with no default.
  it("does not fall through to APIMART for an unknown image vendor", () => {
    const r = priceLine(
      line({ lane: "image", provider: "some-new-gateway", quantity: 100 })
    );
    expect(r.rateKnown).toBe(false);
    expect(r.usd).toBe(0);
  });

  it("does not fall through to APIMART for an unknown video vendor", () => {
    const r = priceLine(
      line({ lane: "video", provider: "some-new-gateway", quantity: 100 })
    );
    expect(r.rateKnown).toBe(false);
  });

  it("does not fall through to HeyGen for an unknown lip-sync vendor", () => {
    const r = priceLine(
      line({ lane: "lipsync", provider: "some-new-lipsync", quantity: 100 })
    );
    expect(r.rateKnown).toBe(false);
  });

  it("prices the AIReiter bolt-on on both lanes it can take over", () => {
    // AIREITER_LANES can route b-roll, stills, or both — neither may report as free.
    const img = priceLine(
      line({ lane: "image", provider: "aireiter", quantity: 10 })
    );
    const vid = priceLine(
      line({ lane: "video", provider: "aireiter", quantity: 10 })
    );
    expect(img.rateKnown).toBe(true);
    expect(img.usd).toBeCloseTo(10 * RATES.aireiterImage, 6);
    expect(vid.rateKnown).toBe(true);
    expect(vid.usd).toBeCloseTo(10 * RATES.aireiterVideoPerSecond, 6);
  });

  it("prices every vendor the pipeline can actually reach", () => {
    // If a new provider adapter is added and its rate is forgotten, this fails.
    const reachable: Array<[UsageLine["lane"], string]> = [
      ["image", "apimart"],
      ["image", "openai"],
      ["image", "gemini"],
      ["image", "sixtynine_labs"],
      ["image", "aireiter"],
      ["video", "apimart"],
      ["video", "sixtynine_labs"],
      ["video", "aireiter"],
      ["lipsync", "heygen"],
    ];
    for (const [lane, provider] of reachable) {
      expect(
        priceLine(line({ lane, provider, quantity: 1 })).rateKnown,
        `${lane}/${provider} has no rate mapped`
      ).toBe(true);
    }
  });
});

describe("lipsyncRateFor", () => {
  it("prices the HeyGen lane", () => {
    expect(lipsyncRateFor("heygen")).toBe(RATES.heygenPerSecond);
  });
});

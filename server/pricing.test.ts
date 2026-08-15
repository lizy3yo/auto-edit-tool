import { describe, it, expect } from "vitest";
import {
  claudeRateFor,
  priceLine,
  lipsyncRateFor,
  RATES,
  WAVESPEED_MIN_BILLED_SECONDS,
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
  it("resolves a dated model id against its family rate", () => {
    // The authoring lane pins `claude-haiku-4-5-20251001`; an exact-match lookup would
    // miss it and silently price the busiest LLM lane at $0.
    expect(claudeRateFor("claude-haiku-4-5-20251001")).toEqual({
      input: 1,
      output: 5,
    });
  });

  it("prefers the longest matching prefix", () => {
    // "claude-opus-4-8" and "claude-opus-5" must not collide, and a shorter prefix must
    // never win over a more specific one.
    expect(claudeRateFor("claude-opus-4-8")).toEqual({ input: 5, output: 25 });
    expect(claudeRateFor("claude-sonnet-4-6")).toEqual({
      input: 3,
      output: 15,
    });
  });

  it("returns null for an unknown model rather than guessing", () => {
    expect(claudeRateFor("some-future-model")).toBeNull();
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

  it("discounts cache reads to 0.1x input and charges writes at 1.25x", () => {
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
  it("prices TTS per thousand characters", () => {
    const r = priceLine(line({ lane: "tts", quantity: 10_000 }));
    expect(r.usd).toBeCloseTo(10 * RATES.ttsPer1kChars, 6);
    // Rate is a list-price assumption, so this must never claim to be exact.
    expect(r.exact).toBe(false);
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

  it("prices lip-sync per second at the active lane's rate", () => {
    const heygen = priceLine(
      line({ lane: "lipsync", provider: "heygen", quantity: 100 })
    );
    const fast = priceLine(
      line({
        lane: "lipsync",
        provider: "wavespeed",
        model: "wavespeed-ai/infinitetalk-fast",
        quantity: 100,
      })
    );
    expect(heygen.usd).toBeCloseTo(100 * RATES.heygenPerSecond, 6);
    // The whole point of the Fast lane is that it is materially cheaper — if this ever
    // stops holding, the rate table has drifted from what the adapter documents.
    expect(fast.usd).toBeLessThan(heygen.usd);
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
      ["lipsync", "fal"],
      ["lipsync", "wavespeed"],
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
  it("separates WaveSpeed's Fast variant from standard InfiniteTalk", () => {
    expect(lipsyncRateFor("wavespeed", "wavespeed-ai/infinitetalk-fast")).toBe(
      RATES.wavespeedFastPerSecond
    );
    expect(lipsyncRateFor("wavespeed", "wavespeed-ai/infinitetalk")).toBe(
      RATES.wavespeedPerSecond
    );
  });

  it("falls back to HeyGen for an unrecognised provider", () => {
    expect(lipsyncRateFor("something-new")).toBe(RATES.heygenPerSecond);
  });

  it("exposes WaveSpeed's 5-second minimum so short host beats aren't under-billed", () => {
    // Host beats floor at 3s (SCENE_MIN_HOLD_SEC); WaveSpeed bills 5. Charging the true
    // 3s would under-report a WaveSpeed film across every short beat.
    expect(WAVESPEED_MIN_BILLED_SECONDS).toBe(5);
  });
});

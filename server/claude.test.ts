import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Anthropic bills every request it completes, whether or not we use the answer. The meter used
 * to count a call only after the caller accepted it, so two billed shapes never reached a
 * video's cost: a reply that arrived after our own per-call timeout, and a reply with no text
 * block. Both are pinned here (2026-10-02).
 */

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));
vi.mock("./_core/env", () => ({ ENV: { anthropicApiKey: "test-key" } }));
const recordUsage = vi.fn();
vi.mock("./costMeter", () => ({ recordUsage }));
const refreshForUnknownModel = vi.fn(async () => {});
vi.mock("./claudePrices", () => ({ refreshForUnknownModel }));

const { invokeClaude } = await import("./claude");

const reply = (content: unknown[], output = 50) => ({
  content,
  stop_reason: "end_turn",
  usage: {
    input_tokens: 100,
    output_tokens: output,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
});

beforeEach(() => {
  create.mockReset();
  recordUsage.mockReset();
  refreshForUnknownModel.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Claude calls are billed when Anthropic answers", () => {
  it("counts a reply with no text, which Anthropic still charged for", async () => {
    create.mockResolvedValue(reply([{ type: "thinking", thinking: "" }], 4000));
    await expect(
      invokeClaude({ userMessage: "x", model: "claude-opus-5-5" })
    ).rejects.toThrow(/no text/);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0]).toMatchObject({
      model: "claude-opus-5-5",
      outputTokens: 4000,
    });
  });

  it("counts a reply that lands after our timeout gave up on it", async () => {
    vi.useFakeTimers();
    // The thinking call takes 6 minutes (past the 5-minute cap); the fallback answers at once.
    create
      .mockImplementationOnce(
        () =>
          new Promise(r =>
            setTimeout(() => r(reply([{ type: "text", text: "late" }], 900)), 6 * 60_000)
          )
      )
      .mockResolvedValueOnce(reply([{ type: "text", text: "ok" }]));

    const call = invokeClaude({
      userMessage: "x",
      model: "claude-opus-4-8",
      extendedThinking: true,
    });
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    await expect(call).resolves.toMatchObject({ text: "ok" });
    expect(recordUsage).toHaveBeenCalledTimes(1); // the fallback

    await vi.advanceTimersByTimeAsync(60_000);
    expect(recordUsage).toHaveBeenCalledTimes(2); // the abandoned call, billed in full
    expect(recordUsage.mock.calls[1][0]).toMatchObject({ outputTokens: 900 });
  });

  it("counts each answered call once — never twice for a used answer", async () => {
    create.mockResolvedValue(reply([{ type: "text", text: "ok" }]));
    await invokeClaude({ userMessage: "x", model: "claude-sonnet-5" });
    await Promise.resolve();
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });

  it("splits 1-hour cache writes from 5-minute ones, since they price differently", async () => {
    create.mockResolvedValue({
      ...reply([{ type: "text", text: "ok" }]),
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 300,
        cache_creation: {
          ephemeral_5m_input_tokens: 100,
          ephemeral_1h_input_tokens: 200,
        },
      },
    });
    await invokeClaude({ userMessage: "x", model: "claude-sonnet-5-5" });
    expect(recordUsage.mock.calls[0][0]).toMatchObject({
      cacheWriteTokens: 100,
      cacheWrite1hTokens: 200,
    });
  });

  it("fixes each call's dollars when it happens, at today's prices", async () => {
    create.mockResolvedValue(reply([{ type: "text", text: "ok" }], 1_000_000));
    await invokeClaude({ userMessage: "x", model: "claude-opus-5-5" });
    // 100 input tokens at $4/MTok + 1M output at $20/MTok
    expect(recordUsage.mock.calls[0][0].usd).toBeCloseTo(20 + 0.0004, 6);
    expect(recordUsage.mock.calls[0][0].pricedCalls).toBe(1);
  });

  it("adds Anthropic's US-only surcharge when the call ran US-only", async () => {
    const r = reply([{ type: "text", text: "ok" }], 1_000_000);
    create.mockResolvedValue({ ...r, usage: { ...r.usage, input_tokens: 0, inference_geo: "us" } });
    await invokeClaude({ userMessage: "x", model: "claude-sonnet-5-5" });
    expect(recordUsage.mock.calls[0][0].usd).toBeCloseTo(10 * 1.1, 6);
  });

  it("re-reads Anthropic's prices for a model it has never seen", async () => {
    create.mockResolvedValue(reply([{ type: "text", text: "ok" }]));
    await invokeClaude({ userMessage: "x", model: "claude-brand-new-1" });
    await new Promise(r => setTimeout(r, 0));
    expect(refreshForUnknownModel).toHaveBeenCalledWith("claude-brand-new-1");
    // Still recorded (tokens kept), just without dollars — shown as "rate not set".
    expect(recordUsage.mock.calls[0][0].usd).toBeUndefined();
  });
});

/**
 * Sonnet 5 thinks when `thinking` is omitted, and thinking is billed as output. A yes/no check
 * asks for it off; a model that cannot switch it off must not be sent the field (it 400s).
 */
describe("thinking off and the step label", () => {
  it("switches thinking off the way each model accepts, and leaves the rest alone", async () => {
    create.mockResolvedValue(reply([{ type: "text", text: "ok" }]));
    await invokeClaude({ userMessage: "x", model: "claude-sonnet-5", thinking: "off" });
    expect(create.mock.calls[0][0].thinking).toEqual({ type: "disabled" });
    create.mockClear();
    // Sonnet 5.5 answers 400 to `disabled`; `between_tools` is its off switch.
    await invokeClaude({ userMessage: "x", model: "claude-sonnet-5-5", thinking: "off" });
    expect(create.mock.calls[0][0].thinking).toEqual({ type: "between_tools" });

    for (const model of [
      "claude-opus-5-5",
      "claude-haiku-4-5-20251001",
    ]) {
      create.mockClear();
      await invokeClaude({ userMessage: "x", model, thinking: "off" });
      expect(create.mock.calls[0][0].thinking).toBeUndefined();
    }
  });

  it("leaves thinking alone when the caller did not ask", async () => {
    create.mockResolvedValue(reply([{ type: "text", text: "ok" }]));
    await invokeClaude({ userMessage: "x", model: "claude-sonnet-5" });
    expect(create.mock.calls[0][0].thinking).toBeUndefined();
  });

  it("sends effort only to a model that takes it", async () => {
    create.mockResolvedValue(reply([{ type: "text", text: "ok" }]));
    await invokeClaude({ userMessage: "x", model: "claude-opus-5-5", effort: "low" });
    expect(create.mock.calls[0][0].output_config).toEqual({ effort: "low" });
    create.mockClear();
    await invokeClaude({ userMessage: "x", model: "claude-haiku-4-5-20251001", effort: "low" });
    expect(create.mock.calls[0][0].output_config).toBeUndefined();
    create.mockClear();
    await invokeClaude({ userMessage: "x", model: "claude-opus-5-5" });
    expect(create.mock.calls[0][0].output_config).toBeUndefined();
  });

  it("puts the step on the cost line", async () => {
    create.mockResolvedValue(reply([{ type: "text", text: "ok" }]));
    await invokeClaude({ userMessage: "x", model: "claude-sonnet-5", step: "Shot list" });
    await vi.waitFor(() => expect(recordUsage).toHaveBeenCalled());
    expect(recordUsage.mock.calls[0][0].step).toBe("Shot list");
  });
});

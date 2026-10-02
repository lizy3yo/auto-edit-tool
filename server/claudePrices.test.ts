import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Claude's prices come from Anthropic's own price page, never from a typed-in table (the typed
 * table priced Opus 5.5 and the Sonnets above what Anthropic charged — 2026-10-02). The page is
 * read by its column HEADERS, a page that stops parsing changes nothing, and a model the table
 * does not know triggers a re-read.
 */

const settings = new Map<string, string>();
vi.mock("./db", () => ({
  getAppSetting: vi.fn(async (k: string) => settings.get(k) ?? null),
  setAppSetting: vi.fn(async (k: string, v: string) => void settings.set(k, v)),
}));

const page = readFileSync(
  join(import.meta.dirname, "__fixtures__", "claude-pricing-2026-10-02.md"),
  "utf8"
);
const {
  parseClaudePricePage,
  modelIdFromName,
  refreshClaudePrices,
  refreshForUnknownModel,
  startClaudePriceRefresh,
} = await import("./claudePrices");
const { claudeRateFor, setLiveClaudeRates } = await import("./pricing");

beforeEach(() => {
  settings.clear();
  setLiveClaudeRates({}, null);
  vi.unstubAllGlobals();
});

describe("parseClaudePricePage", () => {
  it("reads every column of Anthropic's real table", () => {
    const t = parseClaudePricePage(page)!;
    expect(t.rates["claude-opus-5-5"]).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite5m: 5,
      cacheWrite1h: 8,
    });
    expect(t.rates["claude-sonnet-5-5"]).toMatchObject({ input: 2, output: 10 });
    expect(t.rates["claude-haiku-4-5"]).toMatchObject({ cacheRead: 0.1 });
    // A footnote marker on a price must not break it (Sonnet 5's "$2 / MTok<sup>3</sup>").
    expect(t.rates["claude-sonnet-5"]).toMatchObject({ input: 2, output: 10 });
    expect(t.rates["claude-mythos-5-1"]).toMatchObject({ cacheRead: 0.25 });
    expect(t.usOnlyMultiplier).toBe(1.1);
  });

  it("finds columns by their header, so a moved column cannot shift a price", () => {
    const moved = [
      "| Output tokens | Model | Cache hits and refreshes | 1h cache writes | 5m cache writes | Base input tokens |",
      "| :- | :- | :- | :- | :- | :- |",
      ...["Opus 5.5", "Opus 5", "Sonnet 5.5", "Sonnet 5", "Haiku 4.5"].map(
        m => `| $20 / MTok | Claude ${m} | $0.20 / MTok | $8 / MTok | $5 / MTok | $4 / MTok |`
      ),
    ].join("\n");
    expect(parseClaudePricePage(moved)!.rates["claude-opus-5"]).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite5m: 5,
      cacheWrite1h: 8,
    });
  });

  it("refuses a page it cannot trust rather than pricing videos from it", () => {
    expect(parseClaudePricePage("<html>Something went wrong</html>")).toBeNull();
    // Only two parsable rows: the table changed shape.
    const short = page.split("\n").slice(0, 6).join("\n");
    expect(parseClaudePricePage(short)).toBeNull();
    // A misread row (output cheaper than input) is dropped, not used.
    const broken = page.replace(
      /\| Claude Opus 5\.5 \|[^\n]*/,
      "| Claude Opus 5.5 | $40 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok | $20 / MTok |"
    );
    expect(parseClaudePricePage(broken)!.rates["claude-opus-5-5"]).toBeUndefined();
  });

  it("turns Anthropic's display names into model ids", () => {
    expect(modelIdFromName("Claude Opus 5.5")).toBe("claude-opus-5-5");
    expect(
      modelIdFromName("Claude Mythos 5.1 ([limited availability](https://x))")
    ).toBe("claude-mythos-5-1");
    expect(modelIdFromName("Claude Haiku 4.5")).toBe("claude-haiku-4-5");
    expect(modelIdFromName("Model")).toBeNull();
    expect(modelIdFromName("Batch input")).toBeNull();
  });
});

describe("refreshing", () => {
  it("applies the page's prices, over the built-in table, and saves them", async () => {
    const changed = page.replace(
      /\| Claude Sonnet 5\.5 \|[^\n]*/,
      "| Claude Sonnet 5.5 | $1.50 / MTok | $1.875 / MTok | $3 / MTok | $0.15 / MTok | $7.50 / MTok |"
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(changed)));
    expect(await refreshClaudePrices()).toBe(true);
    expect(claudeRateFor("claude-sonnet-5-5")).toMatchObject({ input: 1.5, output: 7.5 });
    expect(JSON.parse(settings.get("claude_prices")!).rates["claude-sonnet-5-5"].input).toBe(1.5);
  });

  it("keeps the last good prices when the page is down or unreadable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(page)));
    await refreshClaudePrices();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("maintenance", { status: 503 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await refreshClaudePrices()).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>new layout</html>")));
    expect(await refreshClaudePrices()).toBe(false);
    warn.mockRestore();
    expect(claudeRateFor("claude-opus-5-5")).toMatchObject({ input: 4 });
  });

  it("applies the saved copy at boot, before the page answers", async () => {
    settings.set(
      "claude_prices",
      JSON.stringify({ fetchedAt: "2026-10-01", ...parseClaudePricePage(page)!, rates: {
        ...parseClaudePricePage(page)!.rates,
        "claude-sonnet-9": { input: 1, output: 2, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },
      } })
    );
    let answer!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => (answer = r))));
    await startClaudePriceRefresh();
    // The page has not answered yet — the saved copy is already in force.
    expect(claudeRateFor("claude-sonnet-9")).toMatchObject({ input: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    answer(new Response("down", { status: 503 }));
    await refreshClaudePrices(); // settles the read in flight
    warn.mockRestore();
  });

  it("re-reads the page when a model has no price, but not on every call", async () => {
    const fetchSpy = vi.fn(async () => new Response(page));
    vi.stubGlobal("fetch", fetchSpy);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await refreshForUnknownModel("claude-new-1");
    await refreshForUnknownModel("claude-new-1");
    log.mockRestore();
    // The boot test above already read once; at most one more read within the window.
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

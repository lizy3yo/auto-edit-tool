/**
 * Claude's prices, read from Anthropic's own published price list — never typed in.
 *
 * Anthropic has no API that returns prices, but it publishes them as a Markdown page with one
 * table row per model (base input, 5-minute and 1-hour cache writes, cache hits, output). This
 * file reads that page at boot and once a day, keeps the last good table in `app_settings`,
 * and hands it to `server/pricing.ts`. A model the table does not know triggers an immediate
 * re-read, so a model added to the pipeline on the day Anthropic ships it is priced from its
 * first call.
 *
 * Why it matters (2026-10-02): the hard-coded table priced Opus 5.5 at $5/$25 and the Sonnets
 * at $3/$15 after Anthropic had cut them to $4/$20 and $2/$10, so every video read high and
 * nothing looked wrong.
 *
 * Safe by construction: a page that cannot be fetched, or whose table no longer parses into
 * sane numbers, changes nothing — the last good table (or the built-in one) stays in force and
 * the log says so. Each call's dollars are fixed when the call is metered (`server/claude.ts`),
 * so a later price change never rewrites what an earlier video cost.
 */

import { setLiveClaudeRates, type TokenRate } from "./pricing";

export const CLAUDE_PRICING_URL =
  "https://platform.claude.com/docs/en/about-claude/pricing.md";

const SETTING_KEY = "claude_prices";
const REFRESH_EVERY_MS = 24 * 60 * 60_000;
/** An unknown model re-reads the page at most this often, so a typo cannot hammer it. */
const UNKNOWN_MODEL_REFETCH_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;
/** A real table has every current model; fewer rows means the page changed shape. */
const MIN_MODELS = 5;

export interface ClaudePriceTable {
  rates: Record<string, TokenRate>;
  /** The "US-only inference" surcharge (`inference_geo: "us"`), as a multiplier. */
  usOnlyMultiplier: number | null;
}

const db = () => import("./db");

/** "$12.50 / MTok<sup>1</sup>" → 12.5. */
function parseMoney(cell: string): number | null {
  const m = cell.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*MTok/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * "Claude Opus 5.5" → "claude-opus-5-5"; "Claude Mythos 5.1 ([limited availability](…))" →
 * "claude-mythos-5-1". Returns null for a cell that is not a Claude model name.
 */
export function modelIdFromName(cell: string): string | null {
  const name = cell
    .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, "") // "([retired …](url))"
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // plain links
    .replace(/<[^>]+>[^<]*<\/[^>]+>/g, "") // <sup>2</sup>
    .replace(/\([^)]*\)/g, "")
    .trim();
  if (!/^Claude\s+[A-Za-z]+\s+\d+(?:\.\d+)?$/.test(name)) return null;
  return name.toLowerCase().replace(/\./g, "-").replace(/\s+/g, "-");
}

/**
 * Read the model table out of the pricing page. Columns are found by their HEADERS, not their
 * order, so a column Anthropic adds or moves does not shift a price into the wrong field.
 * Returns null when the page does not hold a table this file can trust.
 */
export function parseClaudePricePage(md: string): ClaudePriceTable | null {
  const lines = md.split(/\r?\n/);
  const rates: Record<string, TokenRate> = {};

  for (let i = 0; i < lines.length; i++) {
    const header = splitRow(lines[i]);
    if (!header) continue;
    const col = (re: RegExp) => header.findIndex(h => re.test(h));
    const c = {
      model: col(/^model$/i),
      input: col(/base input/i),
      write5m: col(/5m cache write/i),
      write1h: col(/1h cache write/i),
      read: col(/cache hit/i),
      output: col(/^output/i),
    };
    if (Object.values(c).some(v => v < 0)) continue;

    for (let j = i + 2; j < lines.length; j++) {
      const row = splitRow(lines[j]);
      if (!row) break;
      const id = modelIdFromName(row[c.model] ?? "");
      if (!id) continue;
      const input = parseMoney(row[c.input] ?? "");
      const output = parseMoney(row[c.output] ?? "");
      const cacheWrite5m = parseMoney(row[c.write5m] ?? "");
      const cacheWrite1h = parseMoney(row[c.write1h] ?? "");
      const cacheRead = parseMoney(row[c.read] ?? "");
      if (
        input == null ||
        output == null ||
        cacheWrite5m == null ||
        cacheWrite1h == null ||
        cacheRead == null
      )
        continue;
      // Sanity: output dearer than input, a cache read cheaper, writes dearer. A row that
      // breaks these was misread — drop it rather than price a video with it.
      if (!(output > input && cacheRead < input && cacheWrite5m >= input))
        continue;
      if (!(cacheWrite1h >= cacheWrite5m)) continue;
      rates[id] = { input, output, cacheRead, cacheWrite5m, cacheWrite1h };
    }
    break; // the first table with these headers is the model table
  }

  if (Object.keys(rates).length < MIN_MODELS) return null;
  const geo = md.match(/inference_geo[^.]*?(\d+(?:\.\d+)?)x\s+(?:pricing\s+)?multiplier/i);
  const usOnly = geo ? Number(geo[1]) : NaN;
  return {
    rates,
    usOnlyMultiplier: usOnly > 1 && usOnly < 2 ? usOnly : null,
  };
}

function splitRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return null;
  return t
    .slice(1, -1)
    .split("|")
    .map(s => s.trim());
}

let lastFetchAt = 0;
let inFlight: Promise<boolean> | null = null;
let timer: NodeJS.Timeout | null = null;

function apply(table: ClaudePriceTable, source: string): void {
  setLiveClaudeRates(table.rates, table.usOnlyMultiplier);
  console.log(
    `[Prices] Claude prices from ${source}: ${Object.keys(table.rates).length} models`
  );
}

/** Fetch and apply Anthropic's current table. Resolves true when it took. Never throws. */
export function refreshClaudePrices(): Promise<boolean> {
  if (inFlight) return inFlight;
  lastFetchAt = Date.now();
  inFlight = (async () => {
    try {
      const res = await fetch(CLAUDE_PRICING_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const table = parseClaudePricePage(await res.text());
      if (!table) throw new Error("the price table no longer parses");
      logChanges(table);
      apply(table, "Anthropic's price page");
      const { setAppSetting } = await db();
      await setAppSetting(
        SETTING_KEY,
        JSON.stringify({ fetchedAt: new Date().toISOString(), ...table })
      ).catch(() => {});
      return true;
    } catch (err: any) {
      console.warn(
        `[Prices] could not read Claude's prices (${err?.message ?? err}) — keeping the last good ones`
      );
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

let current: Record<string, TokenRate> = {};
function logChanges(next: ClaudePriceTable): void {
  for (const [id, r] of Object.entries(next.rates)) {
    const old = current[id];
    if (!old) continue;
    if (old.input !== r.input || old.output !== r.output || old.cacheRead !== r.cacheRead)
      console.log(
        `[Prices] ${id} changed: $${old.input}/$${old.output} → $${r.input}/$${r.output} per MTok`
      );
  }
  current = next.rates;
}

/**
 * A model with no price: re-read the page now (a new model is the usual reason), at most once
 * per `UNKNOWN_MODEL_REFETCH_MS`. Resolves when the read is done.
 */
export async function refreshForUnknownModel(model: string): Promise<void> {
  if (inFlight) {
    await inFlight;
    return;
  }
  if (Date.now() - lastFetchAt < UNKNOWN_MODEL_REFETCH_MS) return;
  console.log(`[Prices] no price for ${model} — re-reading Anthropic's price page`);
  await refreshClaudePrices();
}

/**
 * Boot: apply the last good table from the database at once (so the first calls after a
 * restart price correctly even if the page is unreachable), then read the page and keep
 * re-reading daily. Never blocks boot and never throws.
 */
export async function startClaudePriceRefresh(): Promise<void> {
  try {
    const { getAppSetting } = await db();
    const saved = await getAppSetting(SETTING_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as ClaudePriceTable & { fetchedAt?: string };
      if (parsed?.rates && Object.keys(parsed.rates).length >= MIN_MODELS) {
        current = parsed.rates;
        apply(parsed, `the saved copy of ${parsed.fetchedAt ?? "an earlier read"}`);
      }
    }
  } catch (err: any) {
    console.warn(`[Prices] saved Claude prices unreadable: ${err?.message ?? err}`);
  }
  void refreshClaudePrices();
  if (!timer) {
    timer = setInterval(() => void refreshClaudePrices(), REFRESH_EVERY_MS);
    timer.unref?.();
  }
}

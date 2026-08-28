/**
 * USD → EUR for the spend report.
 *
 * Every rate in `server/pricing.ts` is quoted in dollars because every provider bills in
 * dollars — so EUR here is a PRESENTATION of a dollar figure, never a second source of truth.
 * One rate is fetched, cached, and applied to the whole report, so the two currency columns
 * on a row can never disagree with each other.
 *
 * **Where the rate comes from.** The European Central Bank publishes one reference rate per
 * currency per business day; `api.frankfurter.app` republishes exactly that series, free and
 * without a key. That is the number European accounting actually uses, so it is the default.
 * It is fetched at most once a day and persisted to `app_settings`, so a restart does not
 * re-fetch and an outage does not lose the last known rate.
 *
 * **When it can't be reached.** Never throws and never blocks the report. The fallback chain is
 * the last stored ECB rate (stale, still labelled with the date it is from) → the pinned rate
 * from `USD_EUR_RATE` → a hard-coded constant. The rate's `source` and `asOf` travel with the
 * numbers to the UI, because a EUR figure whose rate you cannot see is not an auditable one.
 */

import { getAppSetting, setAppSetting } from "./db";

/** `app_settings` row holding the last rate we managed to fetch. */
const FX_SETTING_KEY = "fx_usd_eur";

/** ECB publishes daily; refetching more often than that buys nothing. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/** The report must render even when the network doesn't. */
const FETCH_TIMEOUT_MS = 8_000;

const ECB_URL = "https://api.frankfurter.app/latest?from=USD&to=EUR";

/**
 * Last-resort rate, used only when the ECB is unreachable AND nothing has ever been stored AND
 * `USD_EUR_RATE` is unset. Deliberately a plausible mid-2026 figure rather than 1.0: a wrong
 * rate that is labelled `fallback` in the UI is more honest than pretending the currencies are
 * at parity.
 */
const PINNED_FALLBACK = 0.92;

export interface FxRate {
  /** Multiply USD by this to get EUR. */
  usdToEur: number;
  /**
   * `ecb` — the real reference rate. `pinned` — `USD_EUR_RATE`, set by hand. `fallback` — the
   * constant above, i.e. nothing better was available. The UI shows this verbatim.
   */
  source: "ecb" | "pinned" | "fallback";
  /** The date the rate is FOR (ECB publication date), `YYYY-MM-DD`. */
  asOf: string;
  /** True when the stored ECB rate is older than a day because a refresh failed. */
  stale: boolean;
}

/** Shape persisted to `app_settings`. */
interface StoredRate {
  usdToEur: number;
  asOf: string;
  fetchedAt: number;
}

let memo: { rate: FxRate; fetchedAt: number } | null = null;

/** `USD_EUR_RATE`, if it is a usable number. */
function pinnedRate(): number | null {
  const raw = process.env.USD_EUR_RATE;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fallbackRate(asOf: string, stale: boolean): FxRate {
  const pinned = pinnedRate();
  return pinned != null
    ? { usdToEur: pinned, source: "pinned", asOf, stale }
    : { usdToEur: PINNED_FALLBACK, source: "fallback", asOf, stale };
}

const today = () => new Date().toISOString().slice(0, 10);

async function readStored(): Promise<StoredRate | null> {
  try {
    const raw = await getAppSetting(FX_SETTING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRate;
    return Number.isFinite(parsed?.usdToEur) && parsed.usdToEur > 0
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** One ECB reference rate, or null on any failure — this must never surface as an error. */
async function fetchEcbRate(): Promise<StoredRate | null> {
  try {
    const res = await fetch(ECB_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      date?: string;
      rates?: Record<string, number>;
    };
    const rate = body?.rates?.EUR;
    if (!Number.isFinite(rate) || !rate || rate <= 0) {
      throw new Error("no EUR rate in response");
    }
    return {
      usdToEur: rate,
      asOf: body.date ?? today(),
      fetchedAt: Date.now(),
    };
  } catch (err: any) {
    console.warn(`[FX] ECB rate fetch failed: ${err?.message}`);
    return null;
  }
}

/**
 * The USD→EUR rate to price a report with. Cached in memory for the day, then in
 * `app_settings` across restarts. Never throws.
 */
export async function getUsdToEurRate(): Promise<FxRate> {
  const now = Date.now();
  if (memo && now - memo.fetchedAt < REFRESH_AFTER_MS) return memo.rate;

  const stored = await readStored();
  if (stored && now - stored.fetchedAt < REFRESH_AFTER_MS) {
    const rate: FxRate = {
      usdToEur: stored.usdToEur,
      source: "ecb",
      asOf: stored.asOf,
      stale: false,
    };
    memo = { rate, fetchedAt: now };
    return rate;
  }

  const fresh = await fetchEcbRate();
  if (fresh) {
    // A failed write costs a refetch next time, nothing more — don't fail the report over it.
    await setAppSetting(FX_SETTING_KEY, JSON.stringify(fresh)).catch(() => {});
    const rate: FxRate = {
      usdToEur: fresh.usdToEur,
      source: "ecb",
      asOf: fresh.asOf,
      stale: false,
    };
    memo = { rate, fetchedAt: now };
    return rate;
  }

  // Unreachable: keep serving the last real rate, but say it is old.
  if (stored) {
    const rate: FxRate = {
      usdToEur: stored.usdToEur,
      source: "ecb",
      asOf: stored.asOf,
      stale: true,
    };
    // Short memo so the next report retries the ECB rather than sitting on a stale rate.
    memo = { rate, fetchedAt: now - REFRESH_AFTER_MS + 15 * 60 * 1000 };
    return rate;
  }

  return fallbackRate(today(), false);
}

/** USD → EUR at `rate`, rounded to the cent the way an invoice line would be. */
export const toEur = (usd: number, rate: FxRate): number =>
  Math.round(usd * rate.usdToEur * 10_000) / 10_000;

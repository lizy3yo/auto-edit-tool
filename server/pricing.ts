/**
 * Per-video cost model — the ONE place every dollar figure in this app comes from.
 *
 * Two kinds of number meet here, and the UI keeps them visually separate because their
 * trustworthiness is not the same:
 *
 *  - **Quantities** are METERED, never guessed. Claude reports real input/output token counts
 *    on every response; TTS knows the exact character count it submitted; the image, video and
 *    lip-sync lanes each count their own billed submissions and seconds. `server/costMeter.ts`
 *    accumulates these per job. A quantity is as accurate as the provider's own dashboard.
 *  - **Rates** are LIST PRICES, and only Anthropic's are knowable from here. The rest depend on
 *    which plan each account is on — HeyGen bills credits whose dollar value is per-plan, 69Labs
 *    and APIMART bill opaque credit bundles. Every non-Anthropic rate below is therefore an
 *    estimate, marked `estimated` in the breakdown and overridable by env var so a wrong guess
 *    is a one-line fix rather than a redeploy.
 *
 * So: a section badged EXACT is right to the cent. A section badged ESTIMATED has the right
 * count multiplied by a rate you should check against your own invoice once, then pin here.
 *
 * Sources for the defaults are cited per-rate. Where the repo already knew a number — such as
 * gpt-image-2's ~$0.003/image at our 720p/low settings — that number is used rather than a
 * fresh guess.
 */

/** `$X per unit`, read from an env override if present. */
const rate = (envVar: string, fallback: number): number => {
  const raw = process.env[envVar];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// ---------------------------------------------------------------------------
// Anthropic — the only EXACT lane. Published per-MTok list rates.
// ---------------------------------------------------------------------------

export interface TokenRate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cache-READ tokens — per model (Opus 5.5 reads at 0.05x, Fable 5.1 at 0.025x). */
  cacheRead: number;
  /** USD per 1M 5-minute cache-write tokens. */
  cacheWrite5m: number;
  /** USD per 1M 1-hour cache-write tokens. */
  cacheWrite1h: number;
}

/**
 * The FALLBACK only. Live prices come from Anthropic's own price page
 * (`server/claudePrices.ts`, read at boot and daily) and win over this table; it is here so a
 * server that has never reached that page still prices correctly. Copied from that page on
 * 2026-10-02.
 */
const BUILT_IN_CLAUDE_RATES: Record<string, TokenRate> = {
  "claude-fable-5-1": claudeRate(10, 50, 0.25),
  "claude-mythos-5-1": claudeRate(10, 50, 0.25),
  "claude-fable-5": claudeRate(10, 50, 1),
  "claude-mythos-5": claudeRate(10, 50, 1),
  "claude-opus-5-5": claudeRate(4, 20, 0.2),
  "claude-opus-5": claudeRate(5, 25, 0.5),
  "claude-opus-4-8": claudeRate(5, 25, 0.5),
  "claude-opus-4-7": claudeRate(5, 25, 0.5),
  "claude-opus-4-6": claudeRate(5, 25, 0.5),
  "claude-opus-4-5": claudeRate(5, 25, 0.5),
  "claude-sonnet-5-5": claudeRate(2, 10, 0.2),
  "claude-sonnet-5": claudeRate(2, 10, 0.2),
  "claude-sonnet-4-6": claudeRate(3, 15, 0.3),
  "claude-sonnet-4-5": claudeRate(3, 15, 0.3),
  "claude-haiku-4-5": claudeRate(1, 5, 0.1),
};

/** Cache writes are 1.25x (5 min) and 2x (1 h) of input on every current model. */
function claudeRate(input: number, output: number, cacheRead: number): TokenRate {
  return {
    input,
    output,
    cacheRead,
    cacheWrite5m: input * 1.25,
    cacheWrite1h: input * 2,
  };
}

let liveClaudeRates: Record<string, TokenRate> = {};
/** Anthropic's US-only inference surcharge (`inference_geo: "us"`); 1.1x when last read. */
let usOnlyMultiplier = 1.1;

/** Called by `server/claudePrices.ts` with the table it read off Anthropic's price page. */
export function setLiveClaudeRates(
  rates: Record<string, TokenRate>,
  usOnly: number | null
): void {
  liveClaudeRates = { ...rates };
  if (usOnly) usOnlyMultiplier = usOnly;
}

/**
 * Exact id, or the id plus a `-YYYYMMDD` snapshot date — never a neighbouring model. The
 * prefix lookup this replaced priced `claude-sonnet-5-5` as `claude-sonnet-5` and
 * `claude-opus-5-5` as `claude-opus-5`; an unknown id now reports "rate not set" (and makes
 * `server/claude.ts` re-read Anthropic's page) instead of borrowing a price.
 */
export function claudeRateFor(model: string): TokenRate | null {
  const base = model.replace(/-\d{8}$/, "");
  return liveClaudeRates[base] ?? BUILT_IN_CLAUDE_RATES[base] ?? null;
}

export interface ClaudeTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWrite1hTokens: number;
}

/** Dollars for one call's tokens at today's prices, or null when the model has no price. */
export function claudeCallUsd(
  model: string,
  t: ClaudeTokens,
  inferenceGeo?: string | null
): number | null {
  const r = claudeRateFor(model);
  if (!r) return null;
  const usd =
    (t.inputTokens * r.input +
      t.outputTokens * r.output +
      t.cacheReadTokens * r.cacheRead +
      t.cacheWriteTokens * r.cacheWrite5m +
      t.cacheWrite1hTokens * r.cacheWrite1h) /
    1_000_000;
  return inferenceGeo === "us" ? usd * usOnlyMultiplier : usd;
}

// ---------------------------------------------------------------------------
// Everything else — ESTIMATED. Override any of these with the matching env var
// once you have checked a real invoice.
// ---------------------------------------------------------------------------

export const RATES = {
  /**
   * 69Labs TTS, USD per 1,000 characters of script. 69Labs resells ElevenLabs credits and
   * publishes no per-character dollar rate, so this is the mid-tier ElevenLabs equivalent.
   * A 10-minute film is ~9k characters, i.e. cents — this is never the line that hurts.
   */
  ttsPer1kChars: rate("COST_TTS_PER_1K_CHARS", 0.05),
  minimaxTtsPer1kChars: rate("COST_MINIMAX_TTS_PER_1K_CHARS", 0.03),

  /**
   * RunPod WhisperX serverless, USD per GPU-second, billed on wall time of the run.
   * RunPod's 24GB tier runs ~$0.00021–$0.00044/s depending on card; this is the midpoint.
   * One transcription per film, so this is rounding error at any plausible rate.
   */
  whisperxPerGpuSecond: rate("COST_WHISPERX_PER_GPU_SEC", 0.0004),

  /**
   * APIMART `gpt-image-2`, USD per image at our submit settings (1280x720 / 1k / quality
   * "high"). `server/providers/openai-image.ts` measures OpenAI-direct at ~$0.003/image at
   * 720p quality `low`; APIMART's lane asks for `high`, which draws several times the render
   * tokens, hence the higher default here. This is the single biggest estimate in the model
   * for image-heavy films — worth pinning against a real APIMART invoice first.
   */
  apimartImage: rate("COST_APIMART_IMAGE", 0.02),

  /**
   * OpenAI-direct `gpt-image-2`, USD per image at 1280x720 quality `low` — the settings
   * `openai-image.ts` actually submits, whose own comment measures 106 output render tokens
   * at ~$0.003/image. The most trustworthy non-Anthropic rate here.
   */
  openaiImage: rate("COST_OPENAI_IMAGE", 0.003),

  /** Google `gemini-3.1-flash-image`, USD per image. Fallback lane only. */
  geminiImage: rate("COST_GEMINI_IMAGE", 0.03),

  /** 69Labs image credit, USD per image. Fallback lane only; 69Labs bills credit bundles. */
  sixtynineImage: rate("COST_69LABS_IMAGE", 0.05),

  /**
   * APIMART `grok-imagine-1.5-video`, USD per second of generated 720p clip. B-roll clips are
   * 6–15s each (`brollClipDuration`), so a clip lands at roughly $0.12–$0.30 at the default.
   */
  apimartVideoPerSecond: rate("COST_APIMART_VIDEO_PER_SEC", 0.02),

  /** 69Labs video credit, USD per second. Fallback/test lane only. */
  sixtynineVideoPerSecond: rate("COST_69LABS_VIDEO_PER_SEC", 0.05),

  /**
   * AIReiter — the bolt-on gateway `AIREITER_LANES` routes b-roll and/or stills to. It serves
   * the *same two models* as the APIMART lane it replaces (`grok_imagine_1_5`, `gpt_image_2`),
   * so these default to the APIMART rates rather than to zero.
   *
   * That is a deliberate placeholder, not a measurement: AIReiter sells prepaid credit
   * bundles (the Admin panel shows a credit count, not dollars), so the true rate is whatever
   * you paid per credit divided by the credits a render burns. Pin it once you know.
   */
  aireiterImage: rate("COST_AIREITER_IMAGE", 0.02),
  aireiterVideoPerSecond: rate("COST_AIREITER_VIDEO_PER_SEC", 0.02),

  /**
   * HeyGen Avatar IV, USD per second of rendered host video. HeyGen bills API credits whose
   * dollar value is per-plan, so this is an estimate benchmarked against comparable still+audio
   * lanes that publish flat per-second rates — those put HeyGen at ~$0.06/s. Note 1080p and
   * 720p cost the same, so resolution is not a lever.
   */
  heygenPerSecond: rate("COST_HEYGEN_PER_SEC", 0.06),

  /**
   * Self-hosted InfiniteTalk on RunPod, USD per GPU-SECOND — not per second of rendered
   * video like HeyGen above. RunPod bills the GPU by the millisecond and the adapter meters
   * its reported `executionTime`, so the unit that survives a change of GPU tier is this one.
   * The default is a 96GB Blackwell at $3.49/hr; divide your endpoint's hourly rate by 3600
   * and set the var if you deploy on anything else.
   */
  runpodLipsyncPerGpuSecond: rate("COST_RUNPOD_LIPSYNC_PER_GPU_SEC", 0.00097),
} as const;

/**
 * Rate for one lip-sync line, in the unit that vendor's `quantity` is metered in: seconds
 * of finished video for HeyGen, GPU seconds for the self-hosted RunPod lane. Mixing the two
 * is safe only because each adapter records the quantity its own rate is quoted against.
 */
export function lipsyncRateFor(provider: string, _model?: string): number {
  return provider === "runpod"
    ? RATES.runpodLipsyncPerGpuSecond
    : RATES.heygenPerSecond;
}

// ---------------------------------------------------------------------------
// Pricing a metered line
// ---------------------------------------------------------------------------

/** One accumulated usage line, as stored on the job row. */
export interface UsageLine {
  /** Lane this belongs to — drives which section of the breakdown it renders in. */
  lane: "llm" | "tts" | "transcription" | "image" | "video" | "lipsync";
  /** Vendor, e.g. `anthropic`, `apimart`, `heygen`. */
  provider: string;
  /** Model id as submitted, e.g. `claude-haiku-4-5-20251001`. */
  model: string;
  /** Billed API calls that produced this line. */
  calls: number;
  /**
   * Primary billed quantity in the lane's own unit: tokens are carried separately below, so
   * this is images for `image`, seconds for `video`/`lipsync`/`transcription`, characters for
   * `tts`. Unused (0) for `llm`.
   */
  quantity: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  /** 5-minute-TTL cache writes (1.25x input). */
  cacheWriteTokens?: number;
  /** 1-hour-TTL cache writes (2x input), kept apart because they price differently. */
  cacheWrite1hTokens?: number;
  /**
   * LLM only: dollars fixed when each call was metered, at that day's prices, and how many of
   * `calls` carry one. When every call does, this IS the line's cost.
   */
  usd?: number;
  pricedCalls?: number;
}

/** A priced line, ready to render. */
export interface PricedLine extends UsageLine {
  usd: number;
  /** True only when both the quantity and the rate are known exactly (Anthropic). */
  exact: boolean;
  /**
   * False when no rate is mapped for this provider/model, so `usd` is 0 because we don't
   * know — not because the calls were free. The UI must say "rate not set" rather than
   * show $0.00.
   *
   * This exists because the alternative bit us: an unmapped provider used to fall through
   * to APIMART's rate, so when the AIReiter lane was added its spend was silently priced as
   * APIMART's. A wrong number that looks right is worse than a visible gap, so every lane
   * below looks its rate up in an explicit per-provider map with **no default**.
   */
  rateKnown: boolean;
}

/** Per-image rate by vendor. No default — an unlisted vendor is reported as unpriced. */
/** USD per 1,000 characters accepted, by TTS provider. */
const TTS_RATES: Record<string, number> = {
  sixtynine_labs: RATES.ttsPer1kChars,
  minimax: RATES.minimaxTtsPer1kChars,
};

const IMAGE_RATES: Record<string, number> = {
  apimart: RATES.apimartImage,
  openai: RATES.openaiImage,
  gemini: RATES.geminiImage,
  sixtynine_labs: RATES.sixtynineImage,
  aireiter: RATES.aireiterImage,
};

/** Per-second-of-clip rate by vendor. No default, same reasoning as above. */
const VIDEO_RATES: Record<string, number> = {
  apimart: RATES.apimartVideoPerSecond,
  sixtynine_labs: RATES.sixtynineVideoPerSecond,
  aireiter: RATES.aireiterVideoPerSecond,
};

/** Lip-sync vendors we have a rate for. No default — an unlisted vendor is unpriced. */
const LIPSYNC_PROVIDERS = new Set(["heygen", "runpod"]);

export function priceLine(line: UsageLine): PricedLine {
  const priced = (
    usd: number,
    opts: { exact?: boolean; rateKnown?: boolean } = {}
  ): PricedLine => ({
    ...line,
    usd,
    exact: opts.exact ?? false,
    rateKnown: opts.rateKnown ?? true,
  });

  /** Multiply a metered quantity by a mapped rate, or report it as unpriced. */
  const byRate = (rate: number | undefined) =>
    rate == null
      ? priced(0, { rateKnown: false })
      : priced(line.quantity * rate);

  switch (line.lane) {
    case "llm": {
      // Dollars fixed at call time (each call priced the moment it was metered, at that day's
      // prices) are the exact figure — a later price change must not rewrite an old video.
      // Lines from before that, or holding a call that had no price yet, are priced from
      // their tokens at today's rates.
      if (line.usd != null && line.pricedCalls === line.calls)
        return priced(line.usd, { exact: true });
      const usd = claudeCallUsd(line.model, {
        inputTokens: line.inputTokens ?? 0,
        outputTokens: line.outputTokens ?? 0,
        cacheReadTokens: line.cacheReadTokens ?? 0,
        cacheWriteTokens: line.cacheWriteTokens ?? 0,
        cacheWrite1hTokens: line.cacheWrite1hTokens ?? 0,
      });
      // An unrecognised model means a rate we cannot vouch for — say so rather than
      // inventing one or borrowing another model's.
      if (usd == null) return priced(0, { rateKnown: false });
      return priced(usd, { exact: true });
    }

    case "tts": {
      // Per PROVIDER, not one flat rate: reporting MiniMax spend at 69Labs' number is exactly
      // the "wrong number that looks right" this file refuses to ship elsewhere. An unmapped
      // provider reports UNPRICED rather than borrowing a neighbour's rate — the same rule the
      // image and video lanes follow.
      const r = TTS_RATES[line.provider];
      if (r == null) return priced(0, { rateKnown: false });
      return priced((line.quantity / 1000) * r);
    }

    case "transcription":
      return priced(line.quantity * RATES.whisperxPerGpuSecond);

    case "image":
      return byRate(IMAGE_RATES[line.provider]);

    case "video":
      return byRate(VIDEO_RATES[line.provider]);

    case "lipsync":
      return LIPSYNC_PROVIDERS.has(line.provider)
        ? priced(line.quantity * lipsyncRateFor(line.provider, line.model))
        : priced(0, { rateKnown: false });
  }
}

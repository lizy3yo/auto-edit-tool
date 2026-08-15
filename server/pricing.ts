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
 * Sources for the defaults are cited per-rate. Where the repo already knew a number — the
 * WaveSpeed per-second rates, gpt-image-2's ~$0.003/image at our 720p/low settings — that
 * number is used rather than a fresh guess.
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
}

/**
 * Anthropic list pricing, USD per million tokens. Keys are matched by longest prefix, so a
 * dated model id (`claude-haiku-4-5-20251001`) resolves against its family entry.
 */
const CLAUDE_RATES: Record<string, TokenRate> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache reads bill at ~0.1x the input rate; 5-minute cache writes at ~1.25x. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Longest-prefix lookup so dated ids (`...-20251001`) hit their family rate. */
export function claudeRateFor(model: string): TokenRate | null {
  let best: TokenRate | null = null;
  let bestLen = 0;
  for (const [prefix, r] of Object.entries(CLAUDE_RATES)) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = r;
      bestLen = prefix.length;
    }
  }
  return best;
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
   * dollar value is per-plan, so this is derived from the comparison already recorded in
   * `server/providers/wavespeed-lipsync.ts`: InfiniteTalk Fast at a known $0.015/s is "roughly
   * a quarter of HeyGen", and a film's host lane is "~$6 against HeyGen's ~$28". Both put
   * HeyGen at ~$0.06/s. Note 1080p and 720p cost the same, so resolution is not a lever.
   */
  heygenPerSecond: rate("COST_HEYGEN_PER_SEC", 0.06),

  /** fal.ai `bytedance/omnihuman/v1.5`, USD per second of output (= audio length). */
  falPerSecond: rate("COST_FAL_PER_SEC", 0.06),

  /** WaveSpeed InfiniteTalk 720p — documented at ~$0.06/s (480p is ~$0.03/s). */
  wavespeedPerSecond: rate("COST_WAVESPEED_PER_SEC", 0.06),

  /** WaveSpeed InfiniteTalk **Fast** — documented flat $0.015/s, no resolution tiers. */
  wavespeedFastPerSecond: rate("COST_WAVESPEED_FAST_PER_SEC", 0.015),
} as const;

/**
 * WaveSpeed bills a **5-second minimum per render**. Host beats cap at 8s and can be as short
 * as 3s, so ignoring this would under-report a WaveSpeed film by a third on its shortest beats.
 */
export const WAVESPEED_MIN_BILLED_SECONDS = 5;

/** Per-second rate for the lip-sync lane actually in use. */
export function lipsyncRateFor(provider: string, model?: string): number {
  if (provider === "fal") return RATES.falPerSecond;
  if (provider === "wavespeed") {
    return model?.includes("fast")
      ? RATES.wavespeedFastPerSecond
      : RATES.wavespeedPerSecond;
  }
  return RATES.heygenPerSecond;
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
  cacheWriteTokens?: number;
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

/** Per-second-of-host-video rate by lip-sync vendor. No default. */
const LIPSYNC_PROVIDERS = new Set(["heygen", "fal", "wavespeed"]);

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
      const r = claudeRateFor(line.model);
      // An unrecognised model means a rate we cannot vouch for — say so rather than
      // inventing one or borrowing another model's.
      if (!r) return priced(0, { rateKnown: false });
      const inTok = line.inputTokens ?? 0;
      const outTok = line.outputTokens ?? 0;
      const cacheRead = line.cacheReadTokens ?? 0;
      const cacheWrite = line.cacheWriteTokens ?? 0;
      const usd =
        (inTok * r.input +
          outTok * r.output +
          cacheRead * r.input * CACHE_READ_MULTIPLIER +
          cacheWrite * r.input * CACHE_WRITE_MULTIPLIER) /
        1_000_000;
      return priced(usd, { exact: true });
    }

    case "tts":
      return priced((line.quantity / 1000) * RATES.ttsPer1kChars);

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

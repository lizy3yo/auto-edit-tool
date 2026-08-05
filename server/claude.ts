import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./_core/env";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!ENV.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    client = new Anthropic({
      apiKey: ENV.anthropicApiKey,
      timeout: 10 * 60 * 1000,
    }); // 10 minute timeout for large scripts
  }
  return client;
}

export interface ClaudeImage {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export interface ClaudeParams {
  systemPrompt?: string;
  userMessage: string;
  maxTokens?: number;
  /** Override the model. Defaults to claude-opus-4-7. Use a lighter model (sonnet/haiku) for simple tasks. */
  model?: string;
  /**
   * Enable extended thinking for this call.
   * When true, Claude will "think" before responding, improving quality for complex tasks.
   * Adds ~10-30k thinking tokens (increases cost ~2-4x and time ~2x).
   * Should only be used for script writing, NOT for short prompt generation.
   */
  extendedThinking?: boolean;
  /**
   * Optional image(s) to include in the message (for Claude Vision calls).
   * When provided, the message is sent as a content array [...images, text] instead of
   * plain text. A single image and an array are both accepted — one image is the common
   * case; the multi-image form lets a caller show Claude several frames in one call.
   */
  imageInput?: ClaudeImage | ClaudeImage[];
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

/**
 * Retry configuration for transient Anthropic API errors.
 * - 529: Overloaded — Anthropic's servers are temporarily at capacity
 * - 500: Internal Server Error — transient backend failure
 * - 502/503: Bad Gateway / Service Unavailable — infrastructure issues
 */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 5000; // 5 seconds initial delay
const MAX_DELAY_MS = 60000; // 60 seconds max delay

/**
 * Calculate exponential backoff delay with jitter.
 */
function getRetryDelay(attempt: number): number {
  const exponentialDelay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 1000; // 0-1s jitter
  return Math.min(exponentialDelay + jitter, MAX_DELAY_MS);
}

/**
 * Check if an error is retryable based on its HTTP status code.
 */
function isRetryableError(error: any): boolean {
  // Anthropic SDK errors have a `status` property
  if (error?.status && RETRYABLE_STATUS_CODES.has(error.status)) {
    return true;
  }
  // Also check for error type strings from the API
  if (error?.error?.type === "overloaded_error") {
    return true;
  }
  // Network errors (ECONNRESET, ETIMEDOUT, etc.)
  if (
    error?.code === "ECONNRESET" ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "ENOTFOUND"
  ) {
    return true;
  }
  // Anthropic SDK APIConnectionError (no status code, message contains 'Connection error')
  if (error?.message?.toLowerCase()?.includes("connection error")) {
    return true;
  }
  // Generic network/fetch errors
  if (error?.name === "APIConnectionError" || error?.name === "FetchError") {
    return true;
  }
  return false;
}

/**
 * Call Claude Opus 4.6 via the Anthropic SDK with automatic retry for transient errors.
 *
 * Standard mode: Used for prompt generation (thumbnails, edit images, edit videos).
 * Extended thinking mode: Used for script writing only — Claude "thinks" before writing,
 * producing higher quality output at the cost of more tokens and time.
 *
 * Retries up to 3 times with exponential backoff for:
 * - 529 Overloaded
 * - 500 Internal Server Error
 * - 502 Bad Gateway
 * - 503 Service Unavailable
 * - 429 Rate Limited
 * - Network errors (ECONNRESET, ETIMEDOUT)
 */
/**
 * Per-call timeout for extended thinking calls.
 * If an extended thinking call exceeds this, we abort and retry without thinking.
 * Standard calls use the Anthropic client's 10-minute timeout.
 */
const THINKING_CALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function invokeClaude(
  params: ClaudeParams
): Promise<ClaudeResult> {
  const {
    systemPrompt,
    userMessage,
    maxTokens = 1024,
    extendedThinking = false,
    imageInput,
    model,
  } = params;

  const anthropic = getClient();

  // Build system prompt with prompt caching when provided.
  const systemParam = systemPrompt
    ? [
        {
          type: "text" as const,
          text: systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ]
    : undefined;

  // If extended thinking is requested, try it first with a per-call timeout.
  // On timeout, fall back to standard mode automatically.
  if (extendedThinking) {
    try {
      const result = await callClaudeWithRetries({
        anthropic,
        systemParam,
        userMessage,
        maxTokens: maxTokens + 10000,
        useThinking: true,
        perCallTimeoutMs: THINKING_CALL_TIMEOUT_MS,
        imageInput,
        model,
      });
      return result;
    } catch (thinkingError: any) {
      const isTimeout =
        thinkingError?.message?.includes("timed out") ||
        thinkingError?.message?.toLowerCase()?.includes("connection error") ||
        thinkingError?.name === "APIConnectionError" ||
        thinkingError?.code === "ETIMEDOUT";

      if (isTimeout) {
        console.warn(
          `[Claude] Extended thinking timed out after ${THINKING_CALL_TIMEOUT_MS / 1000}s, ` +
            `falling back to standard mode`
        );
        // Fall through to standard mode below
      } else {
        // Non-timeout error — propagate
        throw thinkingError;
      }
    }
  }

  // Standard mode (or fallback from thinking timeout)
  return callClaudeWithRetries({
    anthropic,
    systemParam,
    userMessage,
    imageInput,
    maxTokens,
    useThinking: false,
    model,
  });
}

async function callClaudeWithRetries(opts: {
  anthropic: Anthropic;
  systemParam: any;
  userMessage: string;
  maxTokens: number;
  useThinking: boolean;
  perCallTimeoutMs?: number;
  imageInput?: ClaudeParams["imageInput"];
  model?: string;
}): Promise<ClaudeResult> {
  const {
    anthropic,
    systemParam,
    userMessage,
    maxTokens,
    useThinking,
    perCallTimeoutMs,
    imageInput,
    model,
  } = opts;
  const resolvedModel = model ?? "claude-opus-4-8";

  // Build the user message content — plain text or [...images, text] array for vision calls
  const images = imageInput
    ? Array.isArray(imageInput)
      ? imageInput
      : [imageInput]
    : [];
  const userContent: Anthropic.MessageParam["content"] = images.length
    ? [
        ...images.map(img => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: img.mediaType,
            data: img.base64,
          },
        })),
        { type: "text" as const, text: userMessage },
      ]
    : userMessage;

  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      let apiPromise: Promise<Anthropic.Message>;

      if (useThinking) {
        apiPromise = anthropic.messages.create({
          model: resolvedModel,
          max_tokens: maxTokens,
          temperature: 1,
          thinking: { type: "adaptive" },
          ...(systemParam ? { system: systemParam } : {}),
          messages: [{ role: "user", content: userContent }],
        });
      } else {
        apiPromise = anthropic.messages.create({
          model: resolvedModel,
          max_tokens: maxTokens,
          ...(systemParam ? { system: systemParam } : {}),
          messages: [{ role: "user", content: userContent }],
        });
      }

      // Apply per-call timeout if specified
      let response: Anthropic.Message;
      if (perCallTimeoutMs) {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Claude ${useThinking ? "thinking" : "standard"} call timed out after ${perCallTimeoutMs / 1000}s`
                )
              ),
            perCallTimeoutMs
          )
        );
        response = await Promise.race([apiPromise, timeoutPromise]);
      } else {
        response = await apiPromise;
      }

      // Extract text from the response (skip thinking blocks)
      const textBlock = response.content.find(block => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Claude returned no text content");
      }

      if (attempt > 0) {
        console.log(`[Claude] Request succeeded after ${attempt} retry(ies)`);
      }
      if (useThinking) {
        console.log(
          `[Claude] Adaptive thinking used — thinking tokens will appear in usage`
        );
      }

      return {
        text: textBlock.text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason || "unknown",
      };
    } catch (error: any) {
      lastError = error;

      // If this is a per-call timeout, don't retry — bubble up immediately
      if (error?.message?.includes("timed out")) {
        throw error;
      }

      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = getRetryDelay(attempt);
        const statusInfo = error?.status
          ? `HTTP ${error.status}`
          : error?.code || "unknown";
        const errorType = error?.error?.type || error?.message || "unknown";
        console.warn(
          `[Claude] Retryable error (${statusInfo}: ${errorType}), ` +
            `attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${Math.round(delay / 1000)}s...`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      break;
    }
  }

  const statusCode = lastError?.status || "unknown";
  const errorType =
    lastError?.error?.type || lastError?.message || "Unknown error";
  const retriedMsg = MAX_RETRIES > 0 ? ` (after ${MAX_RETRIES} retries)` : "";

  throw new Error(
    `Claude API error${retriedMsg}: ${statusCode} — ${errorType}`
  );
}

/**
 * Multi-turn Claude conversation for the 3-pass ideation pipeline.
 * Accepts a full message array and returns the assistant's response.
 * Always uses adaptive thinking (Opus 4.7) for maximum quality.
 */
export async function invokeClaudeMultiTurn(params: {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
}): Promise<ClaudeResult> {
  const { systemPrompt, messages, maxTokens = 16000 } = params;
  const anthropic = getClient();

  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: maxTokens + 10000,
        temperature: 1, // Required for thinking mode
        thinking: {
          type: "adaptive",
        },
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });

      const textBlock = response.content.find(block => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Claude returned no text content");
      }

      if (attempt > 0) {
        console.log(
          `[Claude Multi-Turn] Request succeeded after ${attempt} retry(ies)`
        );
      }

      return {
        text: textBlock.text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason || "unknown",
      };
    } catch (error: any) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = getRetryDelay(attempt);
        console.warn(
          `[Claude Multi-Turn] Retryable error, attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${Math.round(delay / 1000)}s...`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      break;
    }
  }

  const statusCode = lastError?.status || "unknown";
  const errorType =
    lastError?.error?.type || lastError?.message || "Unknown error";
  throw new Error(
    `Claude Multi-Turn API error (after ${MAX_RETRIES} retries): ${statusCode} — ${errorType}`
  );
}

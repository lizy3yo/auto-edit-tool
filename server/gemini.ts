import { GoogleGenAI } from "@google/genai";
import { ENV } from "./_core/env";
import type { ClaudeParams, ClaudeResult } from "./claude";

// Drop-in Gemini 2.5 Flash wrapper with the SAME signature/return shape as
// `invokeClaude`, so the longform authoring lane (subject, visual direction,
// storyboard, b-roll enhance) swaps model with a one-word call-site rename.
// `imageInput`/`extendedThinking` from ClaudeParams are intentionally unsupported
// here — none of those authoring steps pass them.

const MODEL = "gemini-2.5-flash";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    if (!ENV.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    client = new GoogleGenAI({ apiKey: ENV.geminiApiKey });
  }
  return client;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 5000;
const MAX_DELAY_MS = 60000;

function isRetryable(error: any): boolean {
  const status = error?.status ?? error?.code;
  if (typeof status === "number" && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }
  const msg = String(error?.message ?? error).toLowerCase();
  return (
    msg.includes("overloaded") ||
    msg.includes("unavailable") ||
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
}

function retryDelay(attempt: number): number {
  const exp = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(exp + Math.random() * 1000, MAX_DELAY_MS);
}

/** Map Gemini's finishReason onto the Anthropic stopReason vocabulary callers branch on. */
function mapStopReason(finishReason: string | undefined): string {
  // storyboardBatch salvages ONLY when this reads exactly "max_tokens".
  if (finishReason === "MAX_TOKENS") return "max_tokens";
  return (finishReason ?? "stop").toLowerCase();
}

export async function invokeGemini(
  params: ClaudeParams
): Promise<ClaudeResult> {
  const { systemPrompt, userMessage, maxTokens = 1024 } = params;
  const ai = getClient();

  let lastError: any = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: userMessage,
        config: {
          ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
          maxOutputTokens: maxTokens,
          // ponytail: thinking off — these are short prompt-generation calls, not
          // reasoning. Raise the budget here if storyboard/direction quality drops.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      return {
        text: response.text ?? "",
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        stopReason: mapStopReason(response.candidates?.[0]?.finishReason),
      };
    } catch (error: any) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        await new Promise(r => setTimeout(r, retryDelay(attempt)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

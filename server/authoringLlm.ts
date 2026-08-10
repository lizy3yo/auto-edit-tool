import { invokeClaude, type ClaudeParams, type ClaudeResult } from "./claude";
import { ENV } from "./_core/env";

/**
 * Authoring LLM helper for longform video generation (visual direction, style bible, prompt enhancement).
 * Uses Anthropic Claude for superior prompt quality and visual directing.
 */
export async function invokeAuthoringLlm(
  params: ClaudeParams
): Promise<ClaudeResult> {
  const { isMockMode, mockLlmResponse } = await import("./mockMode");
  if (await isMockMode()) return mockLlmResponse(params.systemPrompt, params.userMessage);

  if (!ENV.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  // Use Claude 3.5 Haiku for fast, high-quality prompt enhancement & visual directing
  return invokeClaude({ ...params, model: "claude-3-5-haiku-20241022" });
}

// Alias for backwards compatibility with call-sites
export const invokeGemini = invokeAuthoringLlm;

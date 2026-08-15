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
  if (await isMockMode())
    return mockLlmResponse(params.systemPrompt, params.userMessage);

  if (!ENV.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  // Fast Claude tier for prompt enhancement & visual directing. Pinned to a LIVE model:
  // claude-3-5-haiku-20241022 was retired and every call 404'd ("model: claude-3-5-haiku-
  // 20241022"), which silently killed the whole visual-directing lane — the style bible
  // failed both attempts and every per-scene enhance threw, while script writing and
  // storyboarding kept working because they run on opus. Override to a heavier model if
  // b-roll prompt quality needs it; the lane runs once per scene, so cost scales with
  // scene count.
  return invokeClaude({
    ...params,
    model: process.env.AUTHORING_MODEL || "claude-haiku-4-5-20251001",
  });
}

// Alias for backwards compatibility with call-sites
export const invokeGemini = invokeAuthoringLlm;

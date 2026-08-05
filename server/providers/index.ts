import type { ProviderType } from "../../shared/types";
import type { ProviderAdapter } from "./base";
import { SixtyNineLabsAdapter } from "./sixtynine-labs";
import { FallbackImageAdapter } from "./fallback";

/**
 * Factory function to create the appropriate provider adapter.
 *
 * The concrete adapter is wrapped in FallbackImageAdapter so that any image
 * generation failure from the primary provider automatically falls back to
 * Google Gemini. Video generation and connection testing are unaffected.
 */
export function createProviderAdapter(
  providerType: ProviderType,
  apiKey: string
): ProviderAdapter {
  let adapter: ProviderAdapter;
  switch (providerType) {
    case "sixtynine_labs":
      adapter = new SixtyNineLabsAdapter(apiKey);
      break;
    default:
      throw new Error(`Unknown provider type: ${providerType}`);
  }
  return new FallbackImageAdapter(adapter);
}

export type { ProviderAdapter } from "./base";

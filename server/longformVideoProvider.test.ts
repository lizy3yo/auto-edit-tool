import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for resolveVideoProvider: longform clip generation must prefer a
 * configured 69Labs provider over whatever provider is "active", falling back
 * to the active provider when no 69Labs is configured.
 */

vi.mock("./db", async () => {
  const actual = (await vi.importActual("./db")) as any;
  return {
    ...actual,
    getActiveProvider: vi.fn(),
    getProviderByType: vi.fn(),
  };
});

vi.mock("./encryption", () => ({
  encrypt: vi.fn((v: string) => `enc_${v}`),
  decrypt: vi.fn((v: string) => v.replace("enc_", "")),
  maskApiKey: vi.fn((v: string) => `****${v.slice(-4)}`),
}));

import { getProviderByType } from "./db";
import { resolveVideoProvider } from "./longformVideo";

const sixtyNine = {
  id: 1,
  providerType: "sixtynine_labs",
  apiKeyEncrypted: "enc_vk_live",
};

// A separate "active" provider record (distinct id/key) — decrypt-only so the fallback
// path doesn't trigger GenAIPro's JWT auto-refresh.
const activeProvider = {
  id: 2,
  providerType: "sixtynine_labs",
  apiKeyEncrypted: "enc_active_key",
};

describe("resolveVideoProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers the looked-up 69Labs provider over the active provider", async () => {
    vi.mocked(getProviderByType).mockResolvedValue(sixtyNine as any);

    const result = await resolveVideoProvider(activeProvider);

    expect(getProviderByType).toHaveBeenCalledWith("sixtynine_labs");
    expect(result).toEqual({
      providerType: "sixtynine_labs",
      apiKey: "vk_live",
    });
  });

  it("falls back to the active provider when no 69Labs is configured", async () => {
    vi.mocked(getProviderByType).mockResolvedValue(null);

    const result = await resolveVideoProvider(activeProvider);

    expect(result).toEqual({
      providerType: "sixtynine_labs",
      apiKey: "active_key",
    });
  });

  it("falls back to the active provider when 69Labs exists but has no key", async () => {
    vi.mocked(getProviderByType).mockResolvedValue({
      ...sixtyNine,
      apiKeyEncrypted: null,
    } as any);

    const result = await resolveVideoProvider(activeProvider);

    expect(result.providerType).toBe("sixtynine_labs");
    expect(result.apiKey).toBe("active_key");
  });
});

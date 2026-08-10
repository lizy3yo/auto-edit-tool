import { describe, it, expect } from "vitest";
import { summarizeProviderError } from "./longformVideo";

/** The exact body Google returns; this is what used to be pasted into a job warning verbatim. */
const GEMINI_DAILY_429 = JSON.stringify({
  error: {
    code: 429,
    message:
      "You exceeded your current quota, please check your plan and billing details. " +
      "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, " +
      "limit: 20, model: gemini-2.5-flash\nPlease retry in 55.43s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            quotaDimensions: { location: "global", model: "gemini-2.5-flash" },
            quotaValue: "20",
          },
        ],
      },
    ],
  },
});

describe("summarizeProviderError", () => {
  it("collapses a Gemini daily-quota body to one readable line", () => {
    const out = summarizeProviderError(GEMINI_DAILY_429);
    expect(out).toContain("daily quota exhausted");
    expect(out).toContain("gemini-2.5-flash");
    expect(out).toContain("20/day");
    // The whole point: short enough to read in the UI.
    expect(out.length).toBeLessThan(160);
    expect(out).not.toContain("{");
  });

  it("distinguishes an empty balance from a rate limit", () => {
    expect(
      summarizeProviderError("OpenAI image 429: You have no credits remaining.")
    ).toContain("no credits remaining");
    expect(summarizeProviderError("Error 429: too many requests")).toBe(
      "provider rate limit (429)"
    );
  });

  it("reports a rejected key", () => {
    expect(
      summarizeProviderError('{"error":{"message":"invalid API key"}}')
    ).toContain("rejected the API key");
  });

  it("keeps the first line of an unknown error, hard-capped", () => {
    expect(summarizeProviderError("socket hang up\nat TLSSocket")).toBe(
      "socket hang up"
    );
    const long = "x".repeat(400);
    expect(summarizeProviderError(long).length).toBeLessThanOrEqual(160);
    expect(summarizeProviderError(long).endsWith("…")).toBe(true);
  });

  it("never returns an empty string", () => {
    expect(summarizeProviderError("")).toBe("unknown error");
    expect(summarizeProviderError(undefined as any)).toBe("unknown error");
  });
});

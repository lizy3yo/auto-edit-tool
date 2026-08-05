import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isTrustedUrl, sanitizeFilename } from "./download";

// This route is mounted unauthenticated, so the allowlist is the only thing between a
// caller and "fetch whatever the server can reach". These are the bypasses that the old
// `startsWith` check waved through.
describe("isTrustedUrl", () => {
  const prev = process.env.R2_PUBLIC_URL;
  beforeAll(() => {
    process.env.R2_PUBLIC_URL = "https://pub-abc123.r2.dev";
  });
  afterAll(() => {
    process.env.R2_PUBLIC_URL = prev;
  });

  it("allows the allowlisted host", () => {
    expect(isTrustedUrl("https://pub-abc123.r2.dev/videos/a.mp4")).toBe(true);
  });

  it("rejects an attacker subdomain that merely starts with it", () => {
    expect(isTrustedUrl("https://pub-abc123.r2.dev.attacker.com/x")).toBe(
      false
    );
  });

  it("rejects the userinfo trick", () => {
    expect(isTrustedUrl("https://pub-abc123.r2.dev@attacker.com/x")).toBe(
      false
    );
  });

  it("rejects non-https, including link-local metadata", () => {
    expect(isTrustedUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isTrustedUrl("file:///etc/passwd")).toBe(false);
    expect(isTrustedUrl("not a url")).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("strips non-ASCII chars so Content-Disposition stays Latin-1 safe", () => {
    const name = sanitizeFilename(
      "From Worst Lawn on the Block to Greenest — The Beginner Plan Anyone Can Follow This Weekend"
    );
    expect(name.length).toBeGreaterThan(0);
    expect(name).toMatch(/^[\x20-\x7E]+$/);
    expect(() =>
      new Headers().set(
        "Content-Disposition",
        `attachment; filename="${name}.mp3"`
      )
    ).not.toThrow();
  });

  it("returns empty string when nothing usable remains", () => {
    expect(sanitizeFilename("🌱🌿—“”")).toBe("");
  });
});

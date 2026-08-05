import { describe, expect, it } from "vitest";
import { safeParseJSON } from "./jsonRepair";

describe("safeParseJSON", () => {
  it("parses clean JSON without repair", () => {
    const r = safeParseJSON<{ body_text: string }>(
      JSON.stringify({ body_text: "hello world" })
    );
    expect(r.success).toBe(true);
    expect(r.repaired).toBe(false);
    expect(r.data?.body_text).toBe("hello world");
  });

  it("repairs a stray unescaped double-quote inside a string value", () => {
    // This is the failure mode from Job 2340016: a quoted phrase inside prose.
    const raw =
      '{"body_text":"They called it the "Lazy" Garden, and it worked."}';
    const r = safeParseJSON<{ body_text: string }>(raw);
    expect(r.success).toBe(true);
    expect(r.repaired).toBe(true);
    expect(r.data?.body_text).toBe(
      'They called it the "Lazy" Garden, and it worked.'
    );
  });

  it("repairs multiple stray quotes across multiple fields", () => {
    const raw =
      '{"title":"The "Lazy" Garden","body_text":"He said "stop" and walked away.","n":3}';
    const r = safeParseJSON<{ title: string; body_text: string; n: number }>(
      raw
    );
    expect(r.success).toBe(true);
    expect(r.data?.title).toBe('The "Lazy" Garden');
    expect(r.data?.body_text).toBe('He said "stop" and walked away.');
    expect(r.data?.n).toBe(3);
  });

  it("preserves already-escaped quotes", () => {
    const raw = '{"body_text":"He said \\"hi\\" to me."}';
    const r = safeParseJSON<{ body_text: string }>(raw);
    expect(r.success).toBe(true);
    expect(r.data?.body_text).toBe('He said "hi" to me.');
  });

  it("repairs literal newlines inside a string value", () => {
    const raw = '{"body_text":"line one\nline two"}';
    const r = safeParseJSON<{ body_text: string }>(raw);
    expect(r.success).toBe(true);
    expect(r.repaired).toBe(true);
    expect(r.data?.body_text).toBe("line one\nline two");
  });

  it("removes trailing commas", () => {
    const raw = '{"a":1,"b":[1,2,3,],}';
    const r = safeParseJSON<{ a: number; b: number[] }>(raw);
    expect(r.success).toBe(true);
    expect(r.data?.a).toBe(1);
    expect(r.data?.b).toEqual([1, 2, 3]);
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n{"body_text":"fenced"}\n```';
    const r = safeParseJSON<{ body_text: string }>(raw);
    expect(r.success).toBe(true);
    expect(r.data?.body_text).toBe("fenced");
  });

  it("extracts JSON object from surrounding prose", () => {
    const raw = 'Here is your output:\n\n{"body_text":"extracted"}';
    const r = safeParseJSON<{ body_text: string }>(raw);
    expect(r.success).toBe(true);
    expect(r.data?.body_text).toBe("extracted");
  });

  it("closes truncated JSON", () => {
    const raw = '{"body_text":"unterminated and cut off';
    const r = safeParseJSON<{ body_text: string }>(raw);
    expect(r.success).toBe(true);
    expect(r.data?.body_text).toBe("unterminated and cut off");
  });

  it("fails fast on max_tokens truncation", () => {
    const r = safeParseJSON('{"body_text":"partial', "max_tokens");
    expect(r.success).toBe(false);
    expect(r.error).toContain("max_tokens");
  });
});

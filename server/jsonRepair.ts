/**
 * server/jsonRepair.ts
 *
 * Robust JSON extraction and repair for LLM outputs.
 * Handles common failure modes:
 * - Markdown code fences wrapping the JSON
 * - max_tokens truncation (incomplete JSON)
 * - Unterminated strings (literal newlines inside JSON strings)
 * - Trailing commas before ] or }
 * - Unescaped control characters in string values
 */

// ─── Types ───

export interface SafeParseResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  repaired?: boolean;
}

// ─── Main entry point ───

export function safeParseJSON<T = any>(
  raw: string,
  stopReason?: string
): SafeParseResult<T> {
  // 1. Check for max_tokens truncation
  if (stopReason === "max_tokens") {
    return {
      success: false,
      error: `Response truncated by max_tokens limit (stop_reason: max_tokens). The JSON output was cut off before completion. Increase max_tokens for this stage.`,
    };
  }

  // 2. Strip markdown fences if present
  let cleaned = stripMarkdownFences(raw);

  // 2b. Extract JSON object from surrounding prose (e.g. "Here is your outline:\n\n{...}")
  cleaned = extractBalancedJSON(cleaned);

  // 3. Try direct parse first
  try {
    const data = JSON.parse(cleaned) as T;
    return { success: true, data, repaired: false };
  } catch (firstError: any) {
    // 4. Attempt repair
    const repaired = repairJSON(cleaned);
    try {
      const data = JSON.parse(repaired) as T;
      console.log(
        `[JSONRepair] Successfully repaired JSON (original error: ${firstError.message})`
      );
      return { success: true, data, repaired: true };
    } catch (secondError: any) {
      return {
        success: false,
        error: `JSON parse failed after repair attempt. Original error: ${firstError.message}. Post-repair error: ${secondError.message}. First 200 chars: ${cleaned.substring(0, 200)}`,
      };
    }
  }
}

// ─── Extract balanced JSON object from surrounding prose ───

function extractBalancedJSON(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) return trimmed;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(firstBrace, i + 1);
    }
  }
  // No balanced close found — return from first { to end; repair will close it
  return trimmed.slice(firstBrace);
}

// ─── Strip markdown fences ───

export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();

  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(
    /^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```$/
  );
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Match opening fence without closing (truncated response)
  const openFenceMatch = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*)$/);
  if (openFenceMatch && !openFenceMatch[1].includes("```")) {
    return openFenceMatch[1].trim();
  }

  return trimmed;
}

// ─── JSON repair ───

function repairJSON(text: string): string {
  let result = text;

  // Step 1: Fix unescaped string content (literal newlines/tabs and stray
  // double-quotes inside JSON string values) in a single coherent pass
  result = fixUnescapedStringContent(result);

  // Step 2: Remove trailing commas before ] or }
  result = result.replace(/,\s*([\]}])/g, "$1");

  // Step 3: Fix unescaped control characters (tabs, etc.)
  // eslint-disable-next-line no-control-regex -- intentionally replaces raw control chars in malformed JSON
  result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ");

  // Step 4: If JSON is truncated (doesn't end with } or ]), try to close it
  const lastSignificant = result.trimEnd();
  if (lastSignificant.length > 0) {
    const lastChar = lastSignificant[lastSignificant.length - 1];
    if (lastChar !== "}" && lastChar !== "]") {
      result = attemptCloseTruncatedJSON(result);
    }
  }

  return result;
}

// ─── Fix unescaped string content (newlines/tabs + stray quotes) ───

// Characters that legitimately follow a string's *closing* quote in JSON
// (after optional whitespace): value/element/member terminators and the
// key→value colon.
const STRING_TERMINATORS = new Set([",", "}", "]", ":"]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function fixUnescapedStringContent(json: string): string {
  const chars = json.split("");
  const result: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (escaped) {
      result.push(ch);
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      result.push(ch);
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        // Opening quote of a key or value string.
        inString = true;
        result.push(ch);
        continue;
      }

      // Inside a string: decide whether this quote closes it or is stray
      // content. Look ahead past whitespace to the next significant char.
      let j = i + 1;
      while (j < chars.length && isWhitespace(chars[j])) j++;
      const next = j < chars.length ? chars[j] : "";

      if (next === "" || STRING_TERMINATORS.has(next)) {
        // Real closing delimiter.
        inString = false;
        result.push(ch);
      } else {
        // Stray content quote — escape it and stay in the string.
        result.push('\\"');
      }
      continue;
    }

    if (inString && ch === "\n") {
      result.push("\\n");
      continue;
    }

    if (inString && ch === "\r") {
      result.push("\\r");
      continue;
    }

    if (inString && ch === "\t") {
      result.push("\\t");
      continue;
    }

    result.push(ch);
  }

  return result.join("");
}

// ─── Attempt to close truncated JSON ───

function attemptCloseTruncatedJSON(json: string): string {
  // Count open brackets/braces that need closing
  const depth = { brace: 0, bracket: 0 };
  let inString = false;
  let escaped = false;

  for (const ch of json) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth.brace++;
    if (ch === "}") depth.brace--;
    if (ch === "[") depth.bracket++;
    if (ch === "]") depth.bracket--;
  }

  // If we're inside a string, close it first
  if (inString) {
    json += '"';
  }

  // Remove any trailing comma
  json = json.replace(/,\s*$/, "");

  // Close open brackets/braces
  for (let i = 0; i < depth.bracket; i++) json += "]";
  for (let i = 0; i < depth.brace; i++) json += "}";

  return json;
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace every supplied on-camera host name with "the host" (possessive forms →
 * "the host's"), so no proper name reaches the video model's "well-known person"
 * filter — 69labs rejects any prompt naming "a celebrity or other well-known person".
 *
 * `aliases` is every form that could surface in a script and reach a video prompt:
 * full name, channel display name, bare first name. Build it from the channel's
 * config with `hostNameAliases()` in server/db.ts. Case-insensitive, word-boundaried,
 * possessive-aware (straight and curly apostrophes). Applied longest-first so a
 * phrase like "Danvers Outdoors" is consumed before the bare "Danvers". Empty list is a
 * no-op. Only the supplied aliases are touched — unrelated proper nouns in the prose
 * are left alone. Pure.
 */
export function stripHostNames(text: string, aliases: string[]): string {
  if (!text || !aliases || aliases.length === 0) return text;
  // Longest-first so multi-word aliases match before their bare first name.
  const ordered = [...aliases].sort((a, b) => b.length - a.length);
  let out = text;
  for (const alias of ordered) {
    const a = escapeRegExp(alias);
    // Possessive first: "Danvers's" / "Danvers’s" → "the host's".
    out = out.replace(new RegExp(`\\b${a}['’]s\\b`, "gi"), "the host's");
    // Bare name → "the host".
    out = out.replace(new RegExp(`\\b${a}\\b`, "gi"), "the host");
  }
  // Collapse artifacts: "the the host", duplicated host, and extra whitespace.
  out = out
    .replace(/\bthe\s+the\s+host\b/gi, "the host")
    .replace(/\bthe\s+host\s+the\s+host\b/gi, "the host")
    .replace(/[ \t]{2,}/g, " ");
  return out;
}

/**
 * @deprecated Angles have been removed in v2.0. Niche determines the template style directly.
 * Kept here only for backward compatibility with old stored inputParams.
 */
export const ANGLES = ["Classical", "Amish", "Forbidden", "Medieval"] as const;

/**
 * Format options for the Scripts page.
 */
export const SCRIPT_FORMATS = [
  "How-To",
  "Listicle",
  "Forbidden",
  "Documentary",
] as const;

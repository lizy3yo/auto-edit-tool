/**
 * shared/ctaMarkers.ts
 *
 * The CTA-marker script contract, in ONE place both sides import: the server validates and
 * spans the markers at submit time (`parseCtaMarkers` in server/longformVideo.ts builds its
 * word-offset spans on these regexes), and the client previews the same scan in the generate
 * confirmation dialog — so what the dialog promises is exactly what the router will accept.
 *
 * Everything here is pure string work. No imports, so it bundles into the client for free.
 */

// Tolerant spoken-script markers: case-insensitive, any run of "=", optional spaces.
const SCRIPT_START_MARKER = /^[ \t]*={2,}[ \t]*SCRIPT[ \t]*={2,}[ \t]*$/im;
const SCRIPT_END_MARKER =
  /^[ \t]*={2,}[ \t]*END[ \t]+SCRIPT[ \t]*={2,}[ \t]*$/im;

/** True if a blank-line-delimited paragraph is part of the known template preamble. */
function isPreambleParagraph(p: string): boolean {
  const t = p.trim();
  if (!t) return true;
  if (/^reference image\b.*identity lock/i.test(t)) return true;
  if (/^this is the spoken script\b/i.test(t)) return true;
  if (/^host\s*\(/i.test(t)) return true;
  if (/^look\s*&?\s*pacing/i.test(t)) return true;
  // A paragraph made entirely of "* …" bullets (optionally led by a Host:/Look header).
  const lines = t
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
  return (
    lines.length > 0 &&
    lines.every(
      l =>
        l.startsWith("*") ||
        /^host\s*\(/i.test(l) ||
        /^look\s*&?\s*pacing/i.test(l)
    )
  );
}

/**
 * Return ONLY the spoken portion of a pasted script — the text that should be voiced
 * verbatim. Directing text (identity lock, host look, look & pacing) must never be
 * spoken; that lives in the saved instruction (`DEFAULT_LONGFORM_INSTRUCTION`).
 *
 * - If a tolerant `=== SCRIPT ===` marker is present, return what's after it (up to an
 *   optional `=== END SCRIPT ===`).
 * - Otherwise strip a recognized leading template-preamble block only, stopping at the
 *   first normal narration paragraph. A pure script (no marker/preamble) is unchanged.
 *
 * Conservative: never returns empty when the input is non-empty (falls back to the raw
 * text if stripping would remove everything). Pure — unit-tested.
 */
export function extractSpokenScript(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const start = raw.match(SCRIPT_START_MARKER);
  if (start && start.index !== undefined) {
    let after = raw.slice(start.index + start[0].length);
    const end = after.match(SCRIPT_END_MARKER);
    if (end && end.index !== undefined) after = after.slice(0, end.index);
    const trimmed = after.trim();
    return trimmed || raw.trim();
  }
  const paras = raw.split(/\n\s*\n/);
  let i = 0;
  while (i < paras.length && isPreambleParagraph(paras[i])) i++;
  if (i === 0 || i >= paras.length) return raw.trim(); // nothing stripped, or would empty
  return paras.slice(i).join("\n\n").trim();
}

// Exact CTA block markers (own line; surrounding spaces/tabs tolerated, nothing else).
// Deliberately NOT tolerant like the SCRIPT markers — the script template emits them verbatim.
// The START marker takes an optional book name — `===START CTA (The Old Way Home)===` — which
// EXPLICITLY assigns that book to the block (capture group 1). The marker line is stripped
// before voicing either way, so the name is never spoken.
export const CTA_START_LINE =
  /^[ \t]*===START CTA(?:[ \t]*\(([^)]*)\))?===[ \t]*$/;
export const CTA_END_LINE = /^[ \t]*===END CTA===[ \t]*$/;

/**
 * Scan a RAW pasted script for `===START CTA=== / ===END CTA===` blocks: extract the spoken
 * portion, then pair the marker lines. Returns each block's text and the same pairing errors
 * the server rejects on (`END` before `START`, an unclosed `START`, a nested `START`). Empty
 * blocks (adjacent markers) are dropped, mirroring the server's span parse.
 *
 * This is the CLIENT-facing view of the scan — block text for previews. The server's
 * `parseCtaMarkers` keeps its own walk because it needs word offsets and the cleaned script,
 * but both are built on the exported regexes, so a line is a marker to one exactly when it is
 * a marker to the other. Pure — unit-tested.
 */
export function scanCtaBlocks(rawScript: string): {
  blocks: Array<{ text: string; label?: string }>;
  /** Marker pairs whose body was blank — dropped (nothing to voice), but worth warning on. */
  empty: number;
  errors: string[];
} {
  const blocks: Array<{ text: string; label?: string }> = [];
  const errors: string[] = [];
  let empty = 0;
  let open: string[] | null = null;
  let openLabel: string | undefined;
  for (const line of extractSpokenScript(rawScript).split("\n")) {
    const start = line.match(CTA_START_LINE);
    if (start) {
      if (open != null)
        errors.push("===START CTA=== while the previous block is still open");
      else {
        open = [];
        openLabel = start[1]?.trim() || undefined;
      }
      continue;
    }
    if (CTA_END_LINE.test(line)) {
      if (open == null)
        errors.push("===END CTA=== without a preceding ===START CTA===");
      else {
        const text = open.join("\n").trim();
        if (text) blocks.push({ text, label: openLabel });
        else empty++;
        open = null;
        openLabel = undefined;
      }
      continue;
    }
    if (open != null) open.push(line);
  }
  if (open != null)
    errors.push("===START CTA=== without a closing ===END CTA===");
  return { blocks, empty, errors };
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ");

/**
 * Does this spoken text NAME this book? Half of the title's words-over-3-letters appearing
 * is a match — the rule the router uses to assign an uploaded book to the CTA block that
 * pitches it, shared here so the confirmation dialog previews the same assignment the render
 * will make. Pure — unit-tested.
 */
export function ctaTitleMatches(title: string, text: string): boolean {
  const tokens = normTitle(title)
    .split(/\s+/)
    .filter(t => t.length > 3);
  if (tokens.length === 0) return false;
  const hay = normTitle(text);
  return (
    tokens.filter(t => hay.includes(t)).length >= Math.ceil(tokens.length / 2)
  );
}

/**
 * Does a marker label — `===START CTA (label)===` — refer to this book? Exact match after
 * normalization first (covers short titles the token rule can't), then the loose token rule.
 * Pure — unit-tested.
 */
export function ctaLabelMatches(title: string, label: string): boolean {
  const canon = (s: string) => normTitle(s).replace(/\s+/g, " ").trim();
  return canon(title) === canon(label) || ctaTitleMatches(title, label);
}

/**
 * One book competing for a CTA block. `requiresCall` marks an AUTO candidate — a book the
 * channel supplies rather than the operator attaching it to this video — which places itself
 * ONLY when the script calls it (marker name or spoken title) and never by position, so a
 * shelf of channel books can't leak into a video whose script never mentions them.
 */
export interface CtaBookCandidate {
  title: string;
  requiresCall?: boolean;
}

/**
 * Which book lands on each marked CTA block. THE placement rule — the router runs this at
 * submit and the generate dialog previews it, so they cannot disagree. Per block:
 * the book its marker NAMES (`===START CTA (title)===`, `ctaLabelMatches`) → the book the
 * block's spoken text names (`ctaTitleMatches`) → the operator-attached book at this block's
 * position → when exactly one was attached, that one for every block → none (the block falls
 * back to the channel cover/QR). Candidates are searched in order, so listing the operator's
 * own books before the channel's makes the operator win any tie. Positional fallbacks skip
 * `requiresCall` candidates entirely. Returns one entry per block: the matched candidate's
 * index (or null) plus how it matched. Pure — unit-tested.
 */
export function previewBookAssignments(
  blocks: Array<{ text: string; label?: string }>,
  books: Array<string | CtaBookCandidate>
): Array<{ bookIndex: number | null; byLabel: boolean; byTitle: boolean }> {
  const cands = books.map(b => (typeof b === "string" ? { title: b } : b));
  // Only directly-attached books are handed out by position / as the single default.
  const direct = cands
    .map((c, idx) => (c.requiresCall ? -1 : idx))
    .filter(idx => idx >= 0);
  return blocks.map((b, i) => {
    if (b.label) {
      const labelled = cands.findIndex(c => ctaLabelMatches(c.title, b.label!));
      if (labelled >= 0)
        return { bookIndex: labelled, byLabel: true, byTitle: false };
    }
    const named = cands.findIndex(c => ctaTitleMatches(c.title, b.text));
    if (named >= 0) return { bookIndex: named, byLabel: false, byTitle: true };
    if (i < direct.length)
      return { bookIndex: direct[i], byLabel: false, byTitle: false };
    if (direct.length === 1)
      return { bookIndex: direct[0], byLabel: false, byTitle: false };
    return { bookIndex: null, byLabel: false, byTitle: false };
  });
}

/**
 * The fixed lines the pipeline anchors the big centered QR to: it fills the screen from the
 * TRIGGER line through the RELEASE line (then a frozen hold), and the cover reveal plays just
 * before. They live here so `buildBookCtaTemplate` emits them verbatim and the server's
 * anchor scan (`markCtaQrBlock` in server/longformVideo.ts) matches what the template wrote.
 */
export const CTA_QR_TRIGGER = "Now go ahead and grab your phone";
export const CTA_QR_RELEASE = "I'll wait right here.";

/**
 * The copy-paste skeleton for ONE book: bare markers with the book's name in the START line,
 * nothing else. The name in the marker is what assigns the book to the block (see
 * `previewBookAssignments`) and it is never voiced — the operator writes (or prompts) the
 * spoken pitch between the markers themselves. Deliberately empty inside: pre-written copy
 * kept getting shipped verbatim, and the block is dropped anyway until real text fills it.
 * Pure — unit-tested.
 */
export function buildBookCtaTemplate(title: string): string {
  // Parens inside the name would close the marker's own group early — strip them; the
  // label match is token-based, so "Book (2nd ed)" still matches "Book 2nd ed".
  const safe = title.trim().replace(/[()]/g, "").replace(/\s+/g, " ");
  return [`===START CTA (${safe})===`, "", "===END CTA==="].join("\n");
}

/**
 * The placeholder line inside `CTA_MARKER_TEMPLATE`. Anything between the markers is SPOKEN
 * VERBATIM, so the dialog refuses to generate while a block still contains this line —
 * exported separately so that check and the template can't drift apart.
 */
export const CTA_TEMPLATE_PLACEHOLDER =
  "(Replace this line with your spoken pitch — name the book or product title out loud.)";

/**
 * The one-click skeleton the generate dialog inserts when a script has no marked CTA. The
 * inner line is SPOKEN VERBATIM if left in place, so it is written as an instruction the
 * operator cannot mistake for copy — and the dialog blocks Generate until it is replaced.
 */
export const CTA_MARKER_TEMPLATE = [
  "===START CTA===",
  CTA_TEMPLATE_PLACEHOLDER,
  "===END CTA===",
].join("\n");

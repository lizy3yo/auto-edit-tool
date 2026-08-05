/**
 * server/ctaDetector.ts
 *
 * I4 — Programmatic CTA detector.
 * Pure server-side function. No LLM calls. No side effects. No DB writes.
 *
 * Locates mid_cta and close_cta paragraphs in the assembled script by content
 * matching, then checks structural requirements per channel type (product vs subscribe).
 *
 * Result feeds Stage 6's Gate 7 in I5 — but this module only detects; it does not gate.
 */

import { countWords } from "./wordCount";

// ─── Interfaces ───

export interface CTADetectionInput {
  fullAssembledScript: string;
  channelType: "product" | "subscribe";
  channelLayer: string;
  stage3Outline: any;
}

export interface CTASectionResult {
  detected: boolean;
  position_percent: number;
  contains_url: boolean;
  contains_price: boolean;
  contains_qr_mention: boolean;
  contains_book_name_token: boolean;
  contains_subscribe_verb: boolean;
  contains_bell_mention: boolean;
  word_count: number;
  failures: string[];
}

export interface CTADetectionResult {
  passes_minimum_requirements: boolean;
  mid_cta: CTASectionResult;
  close_cta: CTASectionResult;
  overall_failures: string[];
}

// ─── Channel Layer Extraction Helpers ───

/**
 * Extract the product URL from the channel layer's CTA STRATEGY section.
 * Looks for the `**URL:**` line under `### Product details`.
 * Returns the domain string (e.g., "example.com") or null.
 */
export function extractProductUrl(channelLayer: string): string | null {
  const match = channelLayer.match(/\*\*URL:\*\*\s*(.+)/i);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Extract the book name from the channel layer's CTA STRATEGY section.
 * Looks for the `**Name:**` line under `### Product details`.
 * Returns the raw book name string or null.
 */
export function extractBookName(channelLayer: string): string | null {
  // The persona "Identity card" section also has a **Name:** line (the host's
  // name) that appears before this one; scope to the Product details block so
  // we don't grab the host name. No product block → no book.
  const i = channelLayer.search(/^#{2,4}\s*Product details/im);
  if (i < 0) return null;
  const match = channelLayer.slice(i).match(/\*\*Name:\*\*\s*\*?(.+?)\*?\s*$/m);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Extract distinctive tokens from the book name for fuzzy matching.
 * Filters out common stop words and short words, returns lowercase tokens.
 */
export function getBookNameTokens(bookName: string): string[] {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "for",
    "of",
    "and",
    "in",
    "to",
    "your",
    "my",
    "with",
    "from",
    "by",
    "on",
    "at",
    "is",
    "it",
    "its",
    "that",
    "this",
    "s",
    "day",
    "days",
  ]);
  return bookName
    .toLowerCase()
    .replace(/['']/g, "'")
    .split(/[\s\-–—]+/)
    .map(t => t.replace(/[^a-z0-9']/g, ""))
    .filter(t => t.length > 2 && !stopWords.has(t));
}

// ─── Paragraph Splitting ───

/**
 * Split the script into paragraphs. A paragraph is a non-empty block of text
 * separated by one or more blank lines.
 */
function splitParagraphs(
  text: string
): Array<{ text: string; startIndex: number }> {
  const paragraphs: Array<{ text: string; startIndex: number }> = [];
  const regex = /[^\n]+(?:\n(?!\n)[^\n]*)*/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const trimmed = match[0].trim();
    if (trimmed.length > 0) {
      paragraphs.push({ text: trimmed, startIndex: match.index });
    }
  }
  return paragraphs;
}

// ─── CTA Paragraph Detection ───

/**
 * MAX_CTA_PARAGRAPH_WORDS: If a single paragraph exceeds this word count AND
 * contains multiple occurrences of the CTA signal token separated by a large
 * gap, the detector splits it into sub-segments so that mid_cta and close_cta
 * can be identified independently.
 *
 * Rationale: legitimate CTA paragraphs are 80-350 words. A 1,000+ word
 * paragraph containing both CTAs indicates the LLM did not insert a paragraph
 * break between them.
 */
const MAX_CTA_PARAGRAPH_WORDS = 400;

/**
 * Minimum word gap between two CTA signal clusters within a single oversized
 * paragraph before the detector considers them as separate CTAs.
 */
const MIN_SPLIT_GAP_WORDS = 200;

/**
 * Given an oversized paragraph that contains multiple occurrences of a signal
 * token (e.g., product URL), attempt to split it into sub-segments so that
 * each segment contains one CTA cluster.
 *
 * Strategy: find all positions of the signal token, cluster them (within 100
 * words of each other), and if there are 2+ clusters separated by ≥
 * MIN_SPLIT_GAP_WORDS, split the paragraph at the midpoint between clusters.
 */
function splitOversizedCtaParagraph(
  paragraph: { text: string; startIndex: number },
  signalToken: string
): Array<{ text: string; startIndex: number }> {
  const words = paragraph.text.split(/\s+/);
  const wordCount = words.length;

  if (wordCount <= MAX_CTA_PARAGRAPH_WORDS) {
    return [paragraph];
  }

  // Find word indices where the signal token appears
  const tokenLower = signalToken.toLowerCase();
  const signalPositions: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i].toLowerCase().includes(tokenLower)) {
      signalPositions.push(i);
    }
  }

  if (signalPositions.length < 2) {
    return [paragraph];
  }

  // Cluster signal positions (within 100 words of each other)
  const clusters: Array<{ start: number; end: number }> = [];
  let currentCluster = { start: signalPositions[0], end: signalPositions[0] };
  for (let i = 1; i < signalPositions.length; i++) {
    if (signalPositions[i] - currentCluster.end <= 100) {
      currentCluster.end = signalPositions[i];
    } else {
      clusters.push({ ...currentCluster });
      currentCluster = { start: signalPositions[i], end: signalPositions[i] };
    }
  }
  clusters.push(currentCluster);

  if (clusters.length < 2) {
    return [paragraph];
  }

  // Check if the gap between first and last cluster is large enough
  const gapWords = clusters[clusters.length - 1].start - clusters[0].end;
  if (gapWords < MIN_SPLIT_GAP_WORDS) {
    return [paragraph];
  }

  // Split at the midpoint between the first and last cluster
  const splitWordIndex = Math.floor(
    (clusters[0].end + clusters[clusters.length - 1].start) / 2
  );

  // Reconstruct sub-paragraphs
  const firstHalfWords = words.slice(0, splitWordIndex);
  const secondHalfWords = words.slice(splitWordIndex);

  const firstText = firstHalfWords.join(" ");
  const secondText = secondHalfWords.join(" ");

  // Calculate startIndex for the second sub-paragraph
  const secondStartIndex =
    paragraph.startIndex + paragraph.text.indexOf(secondText.substring(0, 40));
  // Fallback: estimate from word ratio
  const estimatedSecondStart =
    paragraph.startIndex +
    Math.floor((splitWordIndex / wordCount) * paragraph.text.length);

  return [
    { text: firstText, startIndex: paragraph.startIndex },
    {
      text: secondText,
      startIndex:
        secondStartIndex > paragraph.startIndex
          ? secondStartIndex
          : estimatedSecondStart,
    },
  ];
}

/**
 * For product channels: find paragraphs containing the product URL.
 * Applies oversized-paragraph splitting before filtering.
 */
function findProductCtaParagraphs(
  paragraphs: Array<{ text: string; startIndex: number }>,
  productUrl: string
): Array<{ text: string; startIndex: number }> {
  const urlLower = productUrl.toLowerCase();

  // First pass: find paragraphs containing the URL
  const rawMatches = paragraphs.filter(p =>
    p.text.toLowerCase().includes(urlLower)
  );

  // Second pass: split any oversized paragraphs
  const splitMatches: Array<{ text: string; startIndex: number }> = [];
  for (const para of rawMatches) {
    const subParas = splitOversizedCtaParagraph(para, productUrl);
    // Only keep sub-paragraphs that still contain the URL
    for (const sp of subParas) {
      if (sp.text.toLowerCase().includes(urlLower)) {
        splitMatches.push(sp);
      }
    }
  }

  return splitMatches;
}

/**
 * For subscribe channels: find paragraphs containing a subscribe verb.
 */
function findSubscribeCtaParagraphs(
  paragraphs: Array<{ text: string; startIndex: number }>
): Array<{ text: string; startIndex: number }> {
  const subscribePattern =
    /\b(subscribe|subscribing|hit\s+subscribe|tap\s+subscribe|click\s+subscribe)\b/i;
  return paragraphs.filter(p => subscribePattern.test(p.text));
}

// ─── Per-CTA Structural Checks ───

function checkProductCta(
  paragraph: string,
  productUrl: string,
  bookNameTokens: string[]
): Omit<
  CTASectionResult,
  "detected" | "position_percent" | "word_count" | "failures"
> {
  const lower = paragraph.toLowerCase();
  const contains_url = lower.includes(productUrl.toLowerCase());
  const contains_price =
    /\$\s?\d+/.test(paragraph) ||
    /\b(seventeen|eighteen|nineteen|twenty|fifteen|sixteen)\s+(dollars|ninety[- ]nine)\b/i.test(
      paragraph
    ) ||
    /\bnineteen\s+ninety[- ]nine\b/i.test(paragraph);
  const contains_qr_mention = /\bqr\b/i.test(paragraph);
  // Primary check: exact book name tokens. Fallback: generic product reference
  // words ("guide", "book", "protocol") — the close CTA often says "the same guide"
  // rather than repeating the full title.
  const hasExactToken =
    bookNameTokens.length > 0 &&
    bookNameTokens.some(token => lower.includes(token));
  const hasGenericProductRef = /\b(guide|book|protocol|ebook|e-book)\b/i.test(
    paragraph
  );
  const contains_book_name_token =
    hasExactToken || (contains_url && hasGenericProductRef);

  return {
    contains_url,
    contains_price,
    contains_qr_mention,
    contains_book_name_token,
    contains_subscribe_verb: false,
    contains_bell_mention: false,
  };
}

function checkSubscribeCta(
  paragraph: string
): Omit<
  CTASectionResult,
  "detected" | "position_percent" | "word_count" | "failures"
> {
  const subscribePattern =
    /\b(subscribe|subscribing|hit\s+subscribe|tap\s+subscribe|click\s+subscribe)\b/i;
  const bellPattern = /\b(bell|notification)\b/i;

  return {
    contains_url: false,
    contains_price: false,
    contains_qr_mention: false,
    contains_book_name_token: false,
    contains_subscribe_verb: subscribePattern.test(paragraph),
    contains_bell_mention: bellPattern.test(paragraph),
  };
}

// ─── Build Failures List ───

function buildFailures(
  label: string,
  channelType: "product" | "subscribe",
  section: Omit<CTASectionResult, "failures">
): string[] {
  const failures: string[] = [];

  if (!section.detected) {
    failures.push(`${label}: not detected in script`);
    return failures;
  }

  if (channelType === "product") {
    if (!section.contains_url) failures.push(`${label}: missing product URL`);
    if (!section.contains_book_name_token)
      failures.push(`${label}: missing book name reference`);
    if (!section.contains_price)
      failures.push(`${label}: missing price mention (soft signal)`);
    if (!section.contains_qr_mention)
      failures.push(`${label}: missing QR code mention (soft signal)`);
  } else {
    if (!section.contains_subscribe_verb)
      failures.push(`${label}: missing subscribe verb`);
    if (!section.contains_bell_mention)
      failures.push(
        `${label}: missing bell/notification mention (soft signal)`
      );
  }

  return failures;
}

// ─── Empty Section Result ───

function emptySection(): CTASectionResult {
  return {
    detected: false,
    position_percent: 0,
    contains_url: false,
    contains_price: false,
    contains_qr_mention: false,
    contains_book_name_token: false,
    contains_subscribe_verb: false,
    contains_bell_mention: false,
    word_count: 0,
    failures: [],
  };
}

// ─── Main Detection Function ───

export function detectCTAs(input: CTADetectionInput): CTADetectionResult {
  const { fullAssembledScript, channelType, channelLayer, stage3Outline } =
    input;

  // Graceful handling of missing/malformed inputs
  if (
    !fullAssembledScript ||
    typeof fullAssembledScript !== "string" ||
    fullAssembledScript.trim().length === 0
  ) {
    const midSection = emptySection();
    midSection.failures = ["mid_cta: script is empty or missing"];
    const closeSection = emptySection();
    closeSection.failures = ["close_cta: script is empty or missing"];
    return {
      passes_minimum_requirements: false,
      mid_cta: midSection,
      close_cta: closeSection,
      overall_failures: ["Script is empty or missing — cannot detect CTAs"],
    };
  }

  // Verify Stage 3 outline has CTA sections
  const outlineSections = stage3Outline?.outline_sections || [];
  const hasMidCtaOutline = outlineSections.some(
    (s: any) => s.section_name === "mid_cta"
  );
  const hasCloseCtaOutline = outlineSections.some(
    (s: any) => s.section_name === "close_cta"
  );

  if (!hasMidCtaOutline && !hasCloseCtaOutline) {
    const midSection = emptySection();
    midSection.failures = ["mid_cta: Stage 3 outline missing mid_cta entry"];
    const closeSection = emptySection();
    closeSection.failures = [
      "close_cta: Stage 3 outline missing close_cta entry",
    ];
    return {
      passes_minimum_requirements: false,
      mid_cta: midSection,
      close_cta: closeSection,
      overall_failures: [
        "Stage 3 outline has no mid_cta or close_cta entries — CTA detection cannot proceed",
      ],
    };
  }

  const totalLength = fullAssembledScript.length;
  const paragraphs = splitParagraphs(fullAssembledScript);

  // Find CTA paragraphs based on channel type
  let ctaParagraphs: Array<{ text: string; startIndex: number }>;

  if (channelType === "product") {
    const productUrl = extractProductUrl(channelLayer);
    if (!productUrl) {
      const midSection = emptySection();
      midSection.failures = [
        "mid_cta: could not extract product URL from channel layer",
      ];
      const closeSection = emptySection();
      closeSection.failures = [
        "close_cta: could not extract product URL from channel layer",
      ];
      return {
        passes_minimum_requirements: false,
        mid_cta: midSection,
        close_cta: closeSection,
        overall_failures: [
          "Could not extract product URL from channel layer CTA STRATEGY section",
        ],
      };
    }
    ctaParagraphs = findProductCtaParagraphs(paragraphs, productUrl);
  } else {
    ctaParagraphs = findSubscribeCtaParagraphs(paragraphs);
  }

  // Assign mid_cta (first match) and close_cta (last match)
  let midParagraph: { text: string; startIndex: number } | null = null;
  let closeParagraph: { text: string; startIndex: number } | null = null;

  if (ctaParagraphs.length === 0) {
    // No CTA paragraphs found
  } else if (ctaParagraphs.length === 1) {
    // Single match — determine if it's mid or close based on position
    const posPercent = (ctaParagraphs[0].startIndex / totalLength) * 100;
    if (posPercent < 60) {
      midParagraph = ctaParagraphs[0];
    } else {
      closeParagraph = ctaParagraphs[0];
    }
  } else {
    // Multiple matches — first is mid, last is close
    midParagraph = ctaParagraphs[0];
    closeParagraph = ctaParagraphs[ctaParagraphs.length - 1];
  }

  // Build mid_cta result
  let midResult: CTASectionResult;
  if (midParagraph) {
    const posPercent = (midParagraph.startIndex / totalLength) * 100;
    let checks: Omit<
      CTASectionResult,
      "detected" | "position_percent" | "word_count" | "failures"
    >;
    if (channelType === "product") {
      const productUrl = extractProductUrl(channelLayer)!;
      const bookName = extractBookName(channelLayer) || "";
      const tokens = getBookNameTokens(bookName);
      checks = checkProductCta(midParagraph.text, productUrl, tokens);
    } else {
      checks = checkSubscribeCta(midParagraph.text);
    }
    const partial = {
      detected: true,
      position_percent: Math.round(posPercent * 10) / 10,
      word_count: countWords(midParagraph.text),
      ...checks,
    };
    const failures = buildFailures("mid_cta", channelType, partial);
    midResult = { ...partial, failures };
  } else {
    midResult = emptySection();
    midResult.failures = ["mid_cta: not detected in script"];
  }

  // Build close_cta result
  let closeResult: CTASectionResult;
  if (closeParagraph) {
    const posPercent = (closeParagraph.startIndex / totalLength) * 100;
    let checks: Omit<
      CTASectionResult,
      "detected" | "position_percent" | "word_count" | "failures"
    >;
    if (channelType === "product") {
      const productUrl = extractProductUrl(channelLayer)!;
      const bookName = extractBookName(channelLayer) || "";
      const tokens = getBookNameTokens(bookName);
      checks = checkProductCta(closeParagraph.text, productUrl, tokens);
    } else {
      checks = checkSubscribeCta(closeParagraph.text);
    }
    const partial = {
      detected: true,
      position_percent: Math.round(posPercent * 10) / 10,
      word_count: countWords(closeParagraph.text),
      ...checks,
    };
    const failures = buildFailures("close_cta", channelType, partial);
    closeResult = { ...partial, failures };
  } else {
    closeResult = emptySection();
    closeResult.failures = ["close_cta: not detected in script"];
  }

  // Aggregate overall_failures
  const overall_failures = [...midResult.failures, ...closeResult.failures];

  // passes_minimum_requirements logic
  let passes: boolean;
  if (channelType === "product") {
    passes =
      midResult.detected &&
      midResult.contains_url &&
      midResult.contains_book_name_token &&
      closeResult.detected &&
      closeResult.contains_url &&
      closeResult.contains_book_name_token;
  } else {
    passes =
      midResult.detected &&
      midResult.contains_subscribe_verb &&
      closeResult.detected &&
      closeResult.contains_subscribe_verb;
  }

  return {
    passes_minimum_requirements: passes,
    mid_cta: midResult,
    close_cta: closeResult,
    overall_failures,
  };
}

/**
 * server/wordCount.ts
 *
 * Stage 5a — Deterministic word count validator.
 * Validates the assembled script against committed_target_word_count.
 * Returns pass/fail with detailed per-section feedback for Stage 4 retry.
 *
 * Tolerance: ±20% of committed_target_word_count.
 * Word count is ALWAYS measured programmatically server-side.
 * Claude's self-reported word_count is advisory only — never used for validation.
 */

export interface WordCountInput {
  fullAssembledScript: string;
  targetWordCount: number;
}

export interface SectionDelta {
  sectionNumber: number;
  sectionName: string;
  targetWords: number;
  actualWords: number;
  delta: number;
  deltaPercent: number;
}

export interface WordCountResult {
  passed: boolean;
  actualWordCount: number;
  targetWordCount: number;
  deviationPercent: number;
  deviationFromTarget: number;
  tolerancePercent: number;
  feedbackForStage4: string;
}

const DEFAULT_TOLERANCE_PERCENT = 20;

/**
 * Count words in a script using whitespace splitting.
 * This is the single authoritative word counting method.
 */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0).length;
}

/**
 * Build detailed per-section feedback for Stage 4 retry.
 * Identifies which sections are short/long and by how much,
 * with explicit instructions on where to add/cut words.
 */
export function buildSectionFeedback(
  sectionBreakdown:
    | Array<{
        section_number: number;
        section_name: string;
        approximate_word_count: number;
      }>
    | undefined,
  outlineSections:
    | Array<{
        section_number: number;
        section_name: string;
        target_word_count: number;
      }>
    | undefined,
  totalDeviation: number,
  actualWordCount: number,
  targetWordCount: number
): string {
  if (!sectionBreakdown || !outlineSections) {
    // Fallback: no section data available
    if (totalDeviation > 0) {
      return (
        `WORD COUNT EXCEEDED: Assembled script is ${actualWordCount} words ` +
        `(committed target: ${targetWordCount}, ${Math.round((Math.abs(totalDeviation) / targetWordCount) * 100)}% over). ` +
        `Cut ${Math.abs(totalDeviation)} words. Tighten transitions, remove redundant examples, ` +
        `and compress verbose explanations. Do NOT remove structural sections.`
      );
    } else {
      return (
        `WORD COUNT SHORT: Assembled script is ${actualWordCount} words ` +
        `(committed target: ${targetWordCount}, ${Math.round((Math.abs(totalDeviation) / targetWordCount) * 100)}% under). ` +
        `Add ${Math.abs(totalDeviation)} words. Expand examples, add concrete details, ` +
        `or deepen explanations. Do NOT pad with filler.`
      );
    }
  }

  // Build per-section deltas
  const deltas: SectionDelta[] = [];
  for (const outline of outlineSections) {
    const actual = sectionBreakdown.find(
      s => s.section_number === outline.section_number
    );
    if (actual) {
      const delta = actual.approximate_word_count - outline.target_word_count;
      deltas.push({
        sectionNumber: outline.section_number,
        sectionName: outline.section_name,
        targetWords: outline.target_word_count,
        actualWords: actual.approximate_word_count,
        delta,
        deltaPercent: Math.round((delta / outline.target_word_count) * 100),
      });
    }
  }

  // Sort by absolute delta descending to highlight worst offenders
  const sorted = [...deltas].sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta)
  );
  const shortSections = sorted.filter(d => d.delta < -20); // more than 20 words short
  const longSections = sorted.filter(d => d.delta > 20);

  let feedback = "";
  if (totalDeviation < 0) {
    feedback +=
      `WORD COUNT SHORT: Assembled script is ${actualWordCount} words (committed target: ${targetWordCount}, ` +
      `${Math.round((Math.abs(totalDeviation) / targetWordCount) * 100)}% under). Need ${Math.abs(totalDeviation)} more words.\n\n`;
    feedback += `PER-SECTION DELTAS (sections that need expansion):\n`;
    for (const s of shortSections) {
      feedback += `  - Section ${s.sectionNumber} (${s.sectionName}): ${s.actualWords} words vs ${s.targetWords} target (${Math.abs(s.delta)} words short, ${Math.abs(s.deltaPercent)}% under)\n`;
    }
    if (shortSections.length > 0) {
      const primary = shortSections[0];
      feedback += `\nACTION: Add approximately ${Math.abs(primary.delta)} words to Section ${primary.sectionNumber} (${primary.sectionName}). `;
      feedback += `Expand with concrete details, specific measurements, personal anecdotes, or additional examples. `;
      if (shortSections.length > 1) {
        const secondary = shortSections[1];
        feedback += `Also add ~${Math.abs(secondary.delta)} words to Section ${secondary.sectionNumber} (${secondary.sectionName}). `;
      }
      feedback += `Do NOT pad with filler or repeat existing points.`;
    }
  } else {
    feedback +=
      `WORD COUNT EXCEEDED: Assembled script is ${actualWordCount} words (committed target: ${targetWordCount}, ` +
      `${Math.round((Math.abs(totalDeviation) / targetWordCount) * 100)}% over). Cut ${Math.abs(totalDeviation)} words.\n\n`;
    feedback += `PER-SECTION DELTAS (sections that need trimming):\n`;
    for (const s of longSections) {
      feedback += `  - Section ${s.sectionNumber} (${s.sectionName}): ${s.actualWords} words vs ${s.targetWords} target (${Math.abs(s.delta)} words over, ${s.deltaPercent}% over)\n`;
    }
    if (longSections.length > 0) {
      const primary = longSections[0];
      feedback += `\nACTION: Cut approximately ${primary.delta} words from Section ${primary.sectionNumber} (${primary.sectionName}). `;
      feedback += `Tighten transitions, remove redundant examples, compress verbose explanations. `;
      feedback += `Do NOT remove structural sections or the bonus tip.`;
    }
  }

  return feedback;
}

/**
 * Validate the assembled script's word count against the committed target.
 * Uses programmatic server-side word count — never Claude's self-report.
 * Returns a result object with pass/fail and feedback for retry.
 */
export function validateWordCount(
  input: WordCountInput,
  tolerancePercent: number = DEFAULT_TOLERANCE_PERCENT
): WordCountResult {
  const actualWordCount = countWords(input.fullAssembledScript);
  const deviation = actualWordCount - input.targetWordCount;
  const deviationPercent = Math.round(
    (Math.abs(deviation) / input.targetWordCount) * 100
  );
  const passed = deviationPercent <= tolerancePercent;

  let feedbackForStage4 = "";
  if (!passed) {
    if (deviation > 0) {
      feedbackForStage4 =
        `WORD COUNT EXCEEDED: Assembled script is ${actualWordCount} words ` +
        `(committed target: ${input.targetWordCount}, ${deviationPercent}% over). ` +
        `Cut ${Math.abs(deviation)} words. Tighten transitions, remove redundant ` +
        `examples, and compress verbose explanations. Do NOT remove structural ` +
        `sections or the bonus tip.`;
    } else {
      feedbackForStage4 =
        `WORD COUNT SHORT: Assembled script is ${actualWordCount} words ` +
        `(committed target: ${input.targetWordCount}, ${deviationPercent}% under). ` +
        `Add ${Math.abs(deviation)} words. Expand examples, add concrete details, ` +
        `deepen explanations, or add a second before/after contrast. ` +
        `Do NOT pad with filler or repeat existing points.`;
    }
  }

  return {
    passed,
    actualWordCount,
    targetWordCount: input.targetWordCount,
    deviationPercent,
    deviationFromTarget: deviation,
    tolerancePercent,
    feedbackForStage4,
  };
}

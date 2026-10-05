/**
 * A job's warnings, made readable. The server writes one line per event, so one cause across
 * many scenes arrives as many near-identical lines, each carrying the provider's raw error — a
 * film (2026-10-05) showed 33 lines of HeyGen JSON for a single failure. This groups the lines
 * that say the same thing into one row listing its scenes, and moves the provider's words out of
 * the sentence into `details`, shown only when asked for.
 *
 * It only re-arranges what it is given: every warning lands in exactly one group, nothing is
 * dropped, and a line it cannot parse is passed through whole. Pure and shared, so the card
 * draws what this returns and nothing else decides what a person sees.
 */

export interface JobWarningGroup {
  /** Scenes this warning is about, ascending; empty for a warning about the whole film. */
  scenes: number[];
  /** The sentence, without the scene prefix and without the provider's raw error. */
  text: string;
  /** The provider's own words taken out of `text`, one entry per distinct error. */
  details: string[];
  /** How many of the job's warnings this row stands for. */
  count: number;
}

/** A parenthesis this long, or holding JSON, is a provider's error rather than part of a sentence. */
const DETAIL_MIN_CHARS = 60;

const isProviderDetail = (inner: string) =>
  inner.length >= DETAIL_MIN_CHARS || /[{}]/.test(inner);

/**
 * Split the first provider-error parenthesis out of a sentence. Scans depth, because the errors
 * nest their own: "(HeyGen avatar registration failed (404): {…})".
 */
function splitDetail(sentence: string): { text: string; detail?: string } {
  for (let open = sentence.indexOf("("); open >= 0; ) {
    let depth = 0;
    let close = -1;
    for (let i = open; i < sentence.length; i++) {
      if (sentence[i] === "(") depth++;
      else if (sentence[i] === ")" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) break; // never closed — leave the sentence as it is
    const inner = sentence.slice(open + 1, close);
    if (isProviderDetail(inner)) {
      const text = (sentence.slice(0, open) + sentence.slice(close + 1))
        .replace(/\s+([.,;:])/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim();
      return { text, detail: inner.trim() };
    }
    open = sentence.indexOf("(", close + 1);
  }
  return { text: sentence };
}

/**
 * Group a job's warnings by what they say. The row standing for the most warnings comes first
 * (ties keep the order they were first seen in), so the card's few visible rows are the film's
 * biggest problem and not whichever warning happened to be written first.
 */
export function groupJobWarnings(
  warnings: readonly string[] | null | undefined
): JobWarningGroup[] {
  const groups = new Map<string, JobWarningGroup>();
  for (const raw of warnings ?? []) {
    const line = (raw ?? "").trim();
    if (!line) continue;
    const scene = /^Scene (\d+):\s*([\s\S]+)$/.exec(line);
    const { text, detail } = splitDetail(scene ? scene[2] : line);
    // A film-wide warning and a per-scene one never share a row, even with the same words.
    const key = `${scene ? "scene" : "film"}|${text}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { scenes: [], text, details: [], count: 0 }));
    group.count++;
    if (scene) {
      const index = Number(scene[1]);
      if (!group.scenes.includes(index)) group.scenes.push(index);
    }
    if (detail && !group.details.includes(detail)) group.details.push(detail);
  }
  const out = Array.from(groups.values());
  for (const g of out) g.scenes.sort((a, b) => a - b);
  return out.sort((a, b) => b.count - a.count); // stable: ties stay in first-seen order
}

/** "Scene 4" / "Scenes 1, 10, 16", or "" for a film-wide warning. */
export function warningScenesLabel(group: JobWarningGroup): string {
  if (!group.scenes.length) return "";
  return `${group.scenes.length === 1 ? "Scene" : "Scenes"} ${group.scenes.join(", ")}`;
}

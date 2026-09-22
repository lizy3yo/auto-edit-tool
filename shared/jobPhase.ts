/**
 * The step-by-step progress of a long server pass that is not the clip stage — "Even out voice"
 * and the film assembly — as one label and one percentage for the job card.
 *
 * Both passes used to report nothing: assembly showed "Stitching final video" for the whole of a
 * 20-minute film's encode, and the voice pass left the card idle while it worked, so a click
 * looked like it had done nothing. The percentage is WEIGHTED by where the time actually goes:
 * on a film the per-scene encodes are the bulk of assembly, so they own most of the bar, and a
 * scene reused from the assembly cache counts instantly. Pure, so the server that writes it and
 * the tests that pin it agree on the arithmetic. Rides in the job's `progress` JSON as `phase`.
 */

export interface JobPhase {
  /** What is happening now, e.g. "Encoding scenes 120/224". */
  label: string;
  /** 0-100, whole number. */
  pct: number;
}

export type AssemblyStep =
  | { step: "prepare" }
  | { step: "scenes"; done: number; total: number }
  | { step: "join" }
  | { step: "audio" }
  | { step: "music" }
  | { step: "final" }
  | { step: "upload" };

export type LevelStep =
  | { step: "download" }
  | { step: "measure" }
  | { step: "apply" }
  | { step: "save" }
  | { step: "slices"; done: number; total: number };

/** [start, end] of each step's share of the bar, in order. */
export const ASSEMBLY_WEIGHTS: Record<AssemblyStep["step"], [number, number]> =
  {
    prepare: [0, 3],
    scenes: [3, 85],
    join: [85, 88],
    audio: [88, 92],
    music: [92, 95],
    final: [95, 97],
    upload: [97, 100],
  };

export const LEVEL_WEIGHTS: Record<LevelStep["step"], [number, number]> = {
  download: [0, 5],
  measure: [5, 40],
  apply: [40, 75],
  save: [75, 85],
  slices: [85, 100],
};

const ASSEMBLY_LABELS: Record<AssemblyStep["step"], string> = {
  prepare: "Preparing",
  scenes: "Encoding scenes",
  join: "Joining scenes",
  audio: "Building the audio track",
  music: "Adding music",
  final: "Writing the final file",
  upload: "Uploading",
};

const LEVEL_LABELS: Record<LevelStep["step"], string> = {
  download: "Downloading the narration",
  measure: "Measuring the voice",
  apply: "Levelling the narration",
  save: "Saving",
  slices: "Re-cutting scene audio",
};

function place(
  [start, end]: [number, number],
  done?: number,
  total?: number
): number {
  const frac =
    done != null && total != null && total > 0
      ? Math.min(1, Math.max(0, done / total))
      : 0;
  return Math.round(start + (end - start) * frac);
}

export function assemblyPhase(p: AssemblyStep): JobPhase {
  if (p.step === "scenes") {
    return {
      label: `${ASSEMBLY_LABELS.scenes} ${p.done}/${p.total}`,
      pct: place(ASSEMBLY_WEIGHTS.scenes, p.done, p.total),
    };
  }
  return { label: ASSEMBLY_LABELS[p.step], pct: ASSEMBLY_WEIGHTS[p.step][0] };
}

export function levelPhase(p: LevelStep): JobPhase {
  if (p.step === "slices") {
    return {
      label: `${LEVEL_LABELS.slices} ${p.done}/${p.total}`,
      pct: place(LEVEL_WEIGHTS.slices, p.done, p.total),
    };
  }
  return { label: LEVEL_LABELS[p.step], pct: LEVEL_WEIGHTS[p.step][0] };
}

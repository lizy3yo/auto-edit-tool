/**
 * A picture that SHIPPED although its last check still named a fault — said in plain words for the
 * job's warnings and the scene's badge (2026-10-18, the audit).
 *
 * The still loop never stops a film over a picture: after its redraws it keeps the frame it has
 * (job 343: a phone screen drawn four times, "writing, brand, staged" each time, the last one kept).
 * Nothing said so — the replay of 54 practice films found 240 of 1,810 checked pictures (13%)
 * shipped with a fault on their last check, and the only trace was a server log line. The scene
 * now carries what the check named on the frame that shipped (`pictureFlaws`, `panelFlaws`) and
 * the job warns once per picture, so a person can regenerate the ones that show.
 *
 * Pure and shared: the server words the warning, the card draws the badge.
 */
import type { StoryboardScene } from "./types";

/**
 * What the later checks named on a frame the defect check had let through — written onto the SAME
 * record entry (`scene.pictureChecks`), so the record says why a draw that "passed" was redrawn.
 * Until 2026-10-18 only the defect check was recorded: 15 shipped-with-a-fault pictures had an
 * earlier "clean" entry, some of them refused by a check nothing wrote down, and the record read as
 * a clean picture thrown away.
 */
export const DIFFERENT_THING = "different thing";
export const COPIES_MEMORY = "copies its memory";
export const NOT_THE_HOST = "not the host";
export const NEAR_COPY = "near copy";

const WORDS: Record<string, string> = {
  broken: "broken geometry",
  "stamped text": "stamped text",
  writing: "readable writing",
  missing: "its subject missing",
  detail: "its subject not as described",
  "ruled out": "something its line rules out",
  person: "a person or a hand behind the QR card",
  "brand or clutter": "a brand or clutter",
  "wrong place": "the wrong place for its line",
  staged: "a staged look",
  [DIFFERENT_THING]: "a different thing than its earlier pictures",
  [COPIES_MEMORY]: "its earlier picture's framing",
  [NEAR_COPY]: "a near copy of another picture",
  [NOT_THE_HOST]: "someone other than the host",
};

/**
 * The faults a shipped frame still carries: every flag but "unchecked" — a check that could not
 * run says nothing about the picture (it gets its own redraw, `uncheckedRerolls`).
 */
export function shippedFlaws(flags: readonly string[] | undefined): string[] {
  return (flags ?? []).filter(f => f !== "unchecked");
}

/** "readable writing", "readable writing and a staged look", "a, b and c". */
export function pictureFlawWords(flaws: readonly string[]): string {
  const words = Array.from(new Set(flaws.map(f => WORDS[f] ?? f)));
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The job warning for one picture. The same faults read the same sentence on every scene, so the
 * card's warning list groups them into one row naming the scenes (`groupJobWarnings`).
 */
export function pictureFlawWarning(index: number, flaws: readonly string[], panel: boolean): string {
  return `${pictureFlawWarningPrefix(index, panel)}${pictureFlawWords(flaws)} — its redraws did not clear it`;
}

/** How that warning starts for one scene's picture — found again when the picture is drawn anew. */
export function pictureFlawWarningPrefix(index: number, panel: boolean): string {
  return `Scene ${index}: ${panel ? "split panel" : "picture"} shipped with `;
}

/**
 * What the scene's own picture shipped with, when it is showing: the panel of a split, the picture
 * of a cutaway. Never on a host take, a book cover or an operator's image — a scene made host later
 * keeps its old field, and must not wear a badge for a picture it no longer shows.
 */
export function sceneShippedFlaws(
  scene: Pick<
    StoryboardScene,
    "hostPresent" | "splitVisual" | "coverHero" | "assetImageUrl" | "pictureFlaws" | "panelFlaws"
  >
): { flaws: string[]; panel: boolean } | null {
  if (scene.hostPresent) {
    return scene.splitVisual && scene.panelFlaws?.length
      ? { flaws: scene.panelFlaws, panel: true }
      : null;
  }
  if (scene.coverHero || scene.assetImageUrl) return null;
  return scene.pictureFlaws?.length ? { flaws: scene.pictureFlaws, panel: false } : null;
}

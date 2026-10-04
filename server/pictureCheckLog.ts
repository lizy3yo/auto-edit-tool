/**
 * What kind of picture was checked, and what the check said — kept on the scene so a film can be
 * read afterwards as "which kinds of picture come out right the first time".
 *
 * The picture check costs about a quarter of a video's Claude bill and runs on EVERY picture. It
 * can only be skipped for a kind of picture once that kind is known to pass nearly always, and
 * until 2026-10-05 nothing recorded which kind failed: the log said "readable writing detected"
 * with no picture beside it. This is the record; `scripts/stress/checks.mts` reads it.
 *
 * Pure — unit-tested.
 */
import type { StoryboardScene } from "@shared/types";
import { SHOWS_SCREEN } from "./shotList";

/** The kinds, most failure-prone first: a picture is the FIRST one that fits. */
export const PICTURE_KINDS = [
  "screen",
  "writing",
  "named kind",
  "person or hands",
  "key thing",
  "plain",
] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

/** One check of one drawn picture. */
export interface PictureCheck {
  kind: PictureKind;
  /** The split-screen panel, not the full-frame picture. */
  panel?: boolean;
  /** Every defect the check named ("writing", "staged", "missing"…); empty = it passed. */
  flags: string[];
}

/** The kind of picture `visual` describes for this scene. */
export function pictureKindOf(scene: StoryboardScene, visual: string): PictureKind {
  if (SHOWS_SCREEN.test(visual)) return "screen";
  if (scene.pictureText || scene.blurPrint) return "writing";
  if (scene.namedLook) return "named kind";
  if (scene.humanPresent || scene.brollHostLook) return "person or hands";
  if (scene.keyThing) return "key thing";
  return "plain";
}

/** The defects a verdict names, in the order the picture loop acts on them. */
export function checkFlags(v: {
  broken?: boolean;
  unchecked?: boolean;
  overlay?: boolean;
  writing?: boolean;
  missing?: boolean;
  messy?: boolean;
  wrongPlace?: boolean;
  staged?: boolean;
}): string[] {
  return [
    v.broken && "broken",
    v.unchecked && "unchecked",
    v.overlay && "stamped text",
    v.writing && "writing",
    v.missing && "missing",
    v.messy && "brand or clutter",
    v.wrongPlace && "wrong place",
    v.staged && "staged",
  ].filter((f): f is string => !!f);
}

/** Note one check on its scene. Never throws — a record must not cost a picture. */
export function recordPictureCheck(
  scene: StoryboardScene,
  visual: string,
  panel: boolean,
  verdict: Parameters<typeof checkFlags>[0]
): void {
  try {
    (scene.pictureChecks ??= []).push({
      kind: pictureKindOf(scene, visual),
      ...(panel ? { panel: true } : {}),
      flags: checkFlags(verdict),
    });
  } catch {
    /* a record, nothing more */
  }
}

export interface KindTally {
  kind: PictureKind;
  /** Pictures of this kind (a split panel counts as its own picture). */
  pictures: number;
  /** Of those, how many passed on the first drawing. */
  passedFirst: number;
  /** Checks run in all, redraws included. */
  checks: number;
  /** How often each defect was named, across all checks. */
  flags: Record<string, number>;
}

/** Read a film's (or several films') scenes into one row per kind of picture. */
export function tallyPictureChecks(scenes: StoryboardScene[]): KindTally[] {
  const rows = new Map<PictureKind, KindTally>();
  for (const scene of scenes) {
    for (const panel of [false, true]) {
      const checks = (scene.pictureChecks ?? []).filter(c => !!c.panel === panel);
      if (!checks.length) continue;
      const kind = checks[0].kind as PictureKind;
      const row =
        rows.get(kind) ??
        rows.set(kind, { kind, pictures: 0, passedFirst: 0, checks: 0, flags: {} }).get(kind)!;
      row.pictures++;
      if (checks[0].flags.length === 0) row.passedFirst++;
      row.checks += checks.length;
      for (const c of checks) for (const f of c.flags) row.flags[f] = (row.flags[f] ?? 0) + 1;
    }
  }
  return PICTURE_KINDS.flatMap(k => (rows.has(k) ? [rows.get(k)!] : []));
}

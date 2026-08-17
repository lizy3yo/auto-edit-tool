/**
 * server/videoDescription.ts — the YouTube description block for a finished render.
 *
 * Produces something the operator pastes verbatim: one labelled tracking link per book the video
 * pitched, then chapter markers. Both halves matter for attribution — the link is what carries the
 * `?ref=`, and the chapters are what stop someone rewriting the description by hand and dropping
 * the link while they are in there.
 *
 * Pure — unit-tested.
 */
import type { LongformCtaBook } from "../shared/types";
import { formatTimecode, type TimelineEntry } from "./videoTimeline";

/**
 * Minimum gap between chapter markers, seconds.
 *
 * YouTube requires chapters to be at least 10s apart and to start at 0:00, and silently ignores
 * the whole list when either rule is broken — so a 3s beat that produced a marker would cost the
 * operator every chapter, not just that one.
 */
export const MIN_CHAPTER_GAP_SEC = 10;

/** YouTube needs at least three markers before it renders chapters at all. */
export const MIN_CHAPTERS = 3;

/**
 * Turn the timeline into YouTube chapter markers.
 *
 * Chapters come from CTA blocks and the notable set-pieces, not from every scene: a 90-scene film
 * would produce 90 markers, which is unusable and past YouTube's practical limit. The first marker
 * is forced to 0:00 because YouTube discards a list that doesn't start there.
 *
 * Returns [] when fewer than `MIN_CHAPTERS` survive the spacing rule — better no chapters than a
 * list YouTube throws away.
 */
export function buildChapters(
  entries: TimelineEntry[],
  opts: { title?: string } = {}
): { atSec: number; label: string }[] {
  if (entries.length === 0) return [];

  const notable: { atSec: number; label: string }[] = [];
  // Always open at 0:00 — YouTube's hard requirement.
  notable.push({ atSec: 0, label: opts.title?.trim() || "Start" });

  let lastKind: string | null = null;
  for (const e of entries) {
    // Only the beats a viewer would want to jump to. Ordinary host/b-roll alternation is not a
    // chapter; it is the film.
    let label: string | null = null;
    if (e.kind === "cover") label = "The book";
    else if (e.kind === "qrHero") label = "Scan the code";
    else if (e.kind === "asset")
      label = e.assetCaption?.trim() || "A look inside";
    else if (e.cta && lastKind !== "cta") label = "Where to get it";

    lastKind = e.cta ? "cta" : e.kind;
    if (!label || e.startSec <= 0) continue;
    notable.push({ atSec: e.startSec, label });
  }

  // Enforce the spacing rule, keeping the earliest of any cluster.
  const spaced: { atSec: number; label: string }[] = [];
  for (const c of notable) {
    const prev = spaced[spaced.length - 1];
    if (!prev || c.atSec - prev.atSec >= MIN_CHAPTER_GAP_SEC) spaced.push(c);
  }
  return spaced.length >= MIN_CHAPTERS ? spaced : [];
}

/**
 * Build the full description block.
 *
 * Books with no tracking URL are listed without a link rather than omitted — an operator who
 * forgot to set a shop URL should SEE the gap in the text they are about to publish, not discover
 * it when a month of sales turn out to be unattributable.
 *
 * The same book pitched in two blocks is listed once: both blocks share one link, so a duplicate
 * line would just look like a mistake.
 */
export function buildVideoDescription(opts: {
  title?: string;
  ctaBooks?: LongformCtaBook[];
  timeline?: TimelineEntry[];
}): string {
  const parts: string[] = [];

  const seen = new Set<string>();
  for (const book of opts.ctaBooks ?? []) {
    const key = book.trackingUrl ?? `no-url:${book.bookId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(
      book.trackingUrl
        ? `${book.title}:\n${book.trackingUrl}`
        : `${book.title}:\n(no shop link set — add one in Admin → Books)`
    );
  }

  const chapters = buildChapters(opts.timeline ?? [], { title: opts.title });
  if (chapters.length) {
    parts.push(
      [
        "Chapters:",
        ...chapters.map(c => `${formatTimecode(c.atSec)} ${c.label}`),
      ].join("\n")
    );
  }

  return parts.join("\n\n").trim();
}

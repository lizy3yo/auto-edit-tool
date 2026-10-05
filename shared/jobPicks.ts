/**
 * What a video was MADE WITH — the picks on the generate form as they were when Generate was
 * clicked, read off the job's own snapshot.
 *
 * The form above a video only ever shows the picks for the NEXT one (it goes back to its defaults
 * on every load), so a finished video had nothing saying what it was made with: a card whose Cost
 * screen read "Host limit: 2:55 of 7:00 used" sat under a form showing "3 min" (2026-10-05), and
 * the form looked like the answer. This is the answer, for every pick on the form.
 *
 * Two steps, both pure: `jobPickFacts` reduces the job to the few facts worth showing (never the
 * script's text, a URL or a key — it is sent to the browser on every poll), and
 * `summarizeJobPicks` words them. Shared, so the card and the Cost screen cannot disagree.
 */
import { stripCtaMarkerLines } from "./ctaMarkers";
import { ESTIMATE_WORDS_PER_SEC, formatMinSec } from "./hostMinutes";
import type { LongformInputParams } from "./types";

export interface JobPickFacts {
  channelKey: string;
  /** Which of the form's three narration options voiced it. */
  voice: "channel" | "minimax" | "file";
  /** Minutes of talking head picked; null on a video made before the pick existed. */
  hostMinutes: number | null;
  /** The answer to the over-the-guide question; undefined ⇒ it was never asked. */
  hostOverride?: boolean;
  /** The limit the pick became once the film was measured; undefined until the clip stage. */
  hostBudgetSec?: number;
  /** A video with no host at all. */
  brollOnly: boolean;
  /** Host photos (camera angles) the video renders from. */
  hostPhotos: number;
  /** Ticked photos that could not be fetched at Generate and were left out. */
  droppedHostPhotos: number;
  /** Titles of the books picked for this video's calls to action, in order. */
  books: string[];
  /** The channel's own book, used when none was picked for the video. */
  channelBook?: string;
  title?: string;
  /** Spoken words in the script (markers and voice directions left out). */
  scriptWords: number;
  /** A practice run: everything but the paid video lanes. */
  rehearsal: boolean;
  madeBy?: string;
  /** ISO time the video was generated. */
  madeAt?: string;
}

/** The facts worth showing, from the job's saved settings and its row. */
export function jobPickFacts(
  params: Partial<LongformInputParams> | null | undefined,
  row?: { userName?: string | null; createdAt?: Date | string | null }
): JobPickFacts {
  const p = params ?? {};
  const spoken = stripCtaMarkerLines(p.script ?? "");
  const photos = p.faceImageUrls?.length
    ? p.faceImageUrls.length
    : [p.faceImageUrl, p.faceImageUrl2].filter(Boolean).length;
  const madeAt = row?.createdAt ? new Date(row.createdAt) : null;
  return {
    channelKey: p.channelKey ?? "",
    voice: p.manualNarrationUrl
      ? "file"
      : p.ttsVendor === "minimax"
        ? "minimax"
        : "channel",
    hostMinutes: p.hostMinutes ?? null,
    hostOverride: p.hostMinutesOverride,
    hostBudgetSec: p.hostBudgetSec,
    brollOnly: !!p.brollOnly,
    hostPhotos: photos,
    droppedHostPhotos: p.droppedHostPhotos ?? 0,
    books: (p.ctaBooks ?? []).map(b => b.title).filter(Boolean),
    channelBook: p.bookTitle || undefined,
    title: p.title || undefined,
    scriptWords: spoken.trim().split(/\s+/).filter(Boolean).length,
    rehearsal: !!p.rehearsal,
    madeBy: row?.userName || undefined,
    madeAt:
      madeAt && !Number.isNaN(madeAt.getTime())
        ? madeAt.toISOString()
        : undefined,
  };
}

/** One row of the "Made with" list. */
export interface JobPick {
  key:
    | "channel"
    | "voice"
    | "host"
    | "photos"
    | "cta"
    | "title"
    | "script"
    | "madeBy"
    | "practice";
  label: string;
  value: string;
  /** A second, quieter line: how the pick turned out, or why it reads as it does. */
  note?: string;
}

/** Shown where a video was made before the setting was saved. */
export const PICK_NOT_RECORDED = "Not recorded";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The talking-head pick in words, shared with the Cost screen. The pick is what a person chose;
 * the limit is what it became for this film's length — never more, sometimes less.
 */
export function hostPickLine(
  f: Pick<
    JobPickFacts,
    "hostMinutes" | "hostOverride" | "hostBudgetSec" | "brollOnly"
  >
): { value: string; note?: string } {
  if (f.brollOnly) return { value: "No host (b-roll only)" };
  if (f.hostMinutes == null)
    return {
      value: PICK_NOT_RECORDED,
      note: "Made before minutes were picked; the host share of the video applied.",
    };
  const value = `${f.hostMinutes} min picked`;
  if (f.hostBudgetSec == null)
    return { value, note: "The limit is set once the voice is recorded." };
  const limit = `limit ${formatMinSec(f.hostBudgetSec)}`;
  if (f.hostBudgetSec < f.hostMinutes * 60 - 1)
    return {
      value,
      note: f.hostOverride
        ? `${limit}: half of this video, the most a pick can take.`
        : `${limit}: lowered to the guide for this video's length.`,
    };
  return {
    value,
    note: f.hostOverride ? `${limit}, confirmed over the guide.` : `${limit}.`,
  };
}

/**
 * The "Made with" list, in the generate form's own order. `channelName` is the channel's display
 * name when the caller knows it; `formatDate` words the time for the reader's locale.
 */
export function summarizeJobPicks(
  f: JobPickFacts,
  opts: { channelName?: string; formatDate?: (iso: string) => string } = {}
): JobPick[] {
  const host = hostPickLine(f);
  const picks: JobPick[] = [
    {
      key: "channel",
      label: "Channel",
      value: opts.channelName || f.channelKey || PICK_NOT_RECORDED,
    },
    {
      key: "voice",
      label: "Voice",
      value:
        f.voice === "file"
          ? "Your own narration file"
          : f.voice === "minimax"
            ? "MiniMax voice"
            : "Channel voice",
    },
    { key: "host", label: "Talking head", ...host },
    {
      key: "photos",
      label: "Host photos",
      value: f.hostPhotos ? plural(f.hostPhotos, "angle") : "None",
      ...(f.droppedHostPhotos
        ? {
            note: `${plural(f.droppedHostPhotos, "ticked photo")} could not be loaded and ${f.droppedHostPhotos === 1 ? "was" : "were"} left out.`,
          }
        : {}),
    },
    {
      key: "cta",
      label: "Call to action",
      value: f.books.length
        ? f.books.map(t => `"${t}"`).join(", ")
        : f.channelBook
          ? `"${f.channelBook}"`
          : "None",
      ...(!f.books.length && f.channelBook
        ? { note: "The channel's book; none was picked for this video." }
        : {}),
    },
    { key: "title", label: "Video title", value: f.title || "Not set" },
    {
      key: "script",
      label: "Script",
      value: f.scriptWords
        ? `${f.scriptWords.toLocaleString("en-US")} words`
        : PICK_NOT_RECORDED,
      ...(f.scriptWords
        ? {
            note: `About ${formatMinSec(f.scriptWords / ESTIMATE_WORDS_PER_SEC)} of video.`,
          }
        : {}),
    },
    {
      key: "madeBy",
      label: "Made by",
      value: f.madeBy || PICK_NOT_RECORDED,
      ...(f.madeAt
        ? { note: (opts.formatDate ?? (iso => iso.slice(0, 10)))(f.madeAt) }
        : {}),
    },
  ];
  if (f.rehearsal)
    picks.push({
      key: "practice",
      label: "Practice run",
      value: "Yes",
      note: "The host and moving shots are stand-ins; nothing was paid for them.",
    });
  return picks;
}

/**
 * Per-job cost metering.
 *
 * Every billable provider call in the pipeline records what it actually spent — real token
 * counts, real image counts, real seconds of rendered video — against whichever job is running.
 * `server/pricing.ts` turns those quantities into dollars; this file is only about capturing
 * them faithfully.
 *
 * **Why AsyncLocalStorage.** The pipeline is 9k lines deep and the provider adapters
 * (`server/providers/*`) know nothing about jobs by design. Threading a `jobId` through every
 * call site would touch most of the file for no benefit to the pipeline itself. Instead the six
 * money-spending entry points run inside `withCostMeter(jobId, ...)`, and every adapter records
 * into whatever job is ambient. This is safe here precisely because of the constraint already
 * written into CLAUDE.md: **one long-lived process**, same as the in-memory semaphores and poll
 * loops. A call that somehow escapes the context records nothing rather than mis-attributing.
 *
 * **Persistence.** Totals live in `longform_video_jobs.costUsage` so they survive the restart
 * the watchdog is built around. Writes are debounced — a film makes hundreds of billable calls
 * and each one must not cost a round-trip — and flushed on demand whenever the breakdown is
 * read, so the dialog is never stale.
 *
 * Jobs rendered before this file existed have no `costUsage` and report as unmetered rather
 * than as $0.00, which would be a lie.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { priceLine, type PricedLine, type UsageLine } from "./pricing";

/**
 * `./db` is imported lazily, not at module scope.
 *
 * `recordUsage` is pure in-memory bookkeeping and is imported by every provider adapter. A
 * static `import { ... } from "./db"` would pull the whole Drizzle/mysql2 module graph into
 * each of them — enough extra load time to push `server/tts-unified.test.ts` past its 5s
 * timeout under a parallel suite. Only the flush and the read actually touch the database, so
 * only they pay for it. Same reason the pipeline defers `./mockMode`.
 */
const db = () => import("./db");

const jobContext = new AsyncLocalStorage<number>();

/** In-flight totals, keyed by job id, not yet flushed to the row. */
const pending = new Map<number, Map<string, UsageLine>>();
const flushTimers = new Map<number, NodeJS.Timeout>();

const FLUSH_DEBOUNCE_MS = 3_000;

/** Lines merge when they describe the same lane + vendor + model. */
const lineKey = (l: UsageLine) => `${l.lane}::${l.provider}::${l.model}`;

/**
 * Run `fn` with `jobId` as the ambient billing context. Every `recordUsage` call made anywhere
 * inside — including inside promises it spawns — attributes to this job.
 */
export function withCostMeter<T>(
  jobId: number,
  fn: () => Promise<T>
): Promise<T> {
  return jobContext.run(jobId, fn);
}

/** The job currently being billed, or null outside any metered entry point. */
export const currentCostJobId = (): number | null =>
  jobContext.getStore() ?? null;

/**
 * Record one billable provider call against the ambient job.
 *
 * Call this only on calls that were actually billed. A submit that 4xx'd before the provider
 * did any work costs nothing and must not be recorded; a submit that succeeded and was later
 * discarded (a content-policy re-roll, a truncated render we re-paid for) very much was billed
 * and must be. Never throws — a metering bug must not be able to fail a render.
 */
export function recordUsage(line: UsageLine): void {
  try {
    const jobId = jobContext.getStore();
    if (jobId == null) return;

    let lines = pending.get(jobId);
    if (!lines) pending.set(jobId, (lines = new Map()));

    const key = lineKey(line);
    const prev = lines.get(key);
    if (!prev) {
      lines.set(key, { ...line });
    } else {
      prev.calls += line.calls;
      prev.quantity += line.quantity;
      prev.inputTokens = (prev.inputTokens ?? 0) + (line.inputTokens ?? 0);
      prev.outputTokens = (prev.outputTokens ?? 0) + (line.outputTokens ?? 0);
      prev.cacheReadTokens =
        (prev.cacheReadTokens ?? 0) + (line.cacheReadTokens ?? 0);
      prev.cacheWriteTokens =
        (prev.cacheWriteTokens ?? 0) + (line.cacheWriteTokens ?? 0);
    }

    scheduleFlush(jobId);
  } catch (err: any) {
    console.warn(`[Cost] recordUsage failed (ignored):`, err?.message);
  }
}

function scheduleFlush(jobId: number): void {
  if (flushTimers.has(jobId)) return;
  const timer = setTimeout(() => {
    flushTimers.delete(jobId);
    void flushJobUsage(jobId);
  }, FLUSH_DEBOUNCE_MS);
  // Don't hold the process open for a pending cost write.
  timer.unref?.();
  flushTimers.set(jobId, timer);
}

/**
 * Merge this job's pending lines into its stored `costUsage` and clear the buffer.
 *
 * Read-modify-write is safe without a lock because the process is single-threaded and the
 * buffer is cleared before the await — a concurrent `recordUsage` lands in a fresh buffer and
 * is picked up by the next flush rather than being lost or double-counted.
 */
export async function flushJobUsage(jobId: number): Promise<void> {
  const timer = flushTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(jobId);
  }

  const buffered = pending.get(jobId);
  if (!buffered || buffered.size === 0) return;
  pending.delete(jobId);
  const additions = Array.from(buffered.values());

  try {
    const { getLongformVideoJobById, updateLongformVideoJob } = await db();
    const job = await getLongformVideoJobById(jobId);
    const stored = (job?.costUsage as UsageLine[] | null) ?? [];
    await updateLongformVideoJob(jobId, {
      costUsage: mergeLines(stored, additions),
    });
  } catch (err: any) {
    // Put the lines back so the next flush retries them rather than losing the spend.
    const buf = pending.get(jobId) ?? new Map<string, UsageLine>();
    for (const line of additions) {
      const prev = buf.get(lineKey(line));
      buf.set(lineKey(line), prev ? sumLines(prev, line) : line);
    }
    pending.set(jobId, buf);
    console.warn(`[Cost] flush failed for job ${jobId}:`, err?.message);
  }
}

function sumLines(a: UsageLine, b: UsageLine): UsageLine {
  return {
    ...a,
    calls: a.calls + b.calls,
    quantity: a.quantity + b.quantity,
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
  };
}

function mergeLines(base: UsageLine[], additions: UsageLine[]): UsageLine[] {
  const merged = new Map<string, UsageLine>();
  for (const line of base.concat(additions)) {
    const key = lineKey(line);
    const prev = merged.get(key);
    merged.set(key, prev ? sumLines(prev, line) : { ...line });
  }
  return Array.from(merged.values());
}

// ---------------------------------------------------------------------------
// Reading the breakdown
// ---------------------------------------------------------------------------

export interface CostSection {
  key: string;
  /** Section heading, e.g. "WRITING & EDITING (CLAUDE)". */
  label: string;
  /** Count shown beside the heading — image/clip/render counts, as in the reference design. */
  count: number | null;
  /** Drives the EXACT / ESTIMATED badge. */
  accuracy: "exact" | "estimated";
  subtotalUsd: number;
  lines: Array<{
    label: string;
    /** Second line under the label — call count, token count, seconds. */
    detail: string;
    usd: number;
    /** False ⇒ no rate mapped; the UI shows "rate not set", never $0.00. */
    rateKnown: boolean;
  }>;
}

export interface CostBreakdown {
  jobId: number;
  totalUsd: number;
  /**
   * False when the job row carries no usage at all — a render from before metering existed, or
   * one that has not yet made a billable call. The UI says so instead of showing $0.00.
   */
  metered: boolean;
  /** True while the job is still spending, so the total is "so far". */
  inProgress: boolean;
  /**
   * True when at least one line has no mapped rate, so the total is a floor rather than an
   * estimate. Surfaced as a warning — a missing rate must not silently deflate the figure.
   */
  hasUnpricedLines: boolean;
  sections: CostSection[];
}

const SECTION_META: Record<
  UsageLine["lane"],
  { label: string; showCount: boolean; order: number }
> = {
  llm: { label: "Writing & editing (Claude)", showCount: false, order: 0 },
  tts: { label: "Narration (text-to-speech)", showCount: false, order: 1 },
  image: { label: "Images", showCount: true, order: 2 },
  video: { label: "B-roll clips", showCount: true, order: 3 },
  lipsync: { label: "Host lip-sync", showCount: true, order: 4 },
  transcription: { label: "Narration alignment", showCount: false, order: 5 },
};

const nf = new Intl.NumberFormat("en-US");

/** Human label for one line's billed quantity. */
function detailFor(line: PricedLine): string {
  const calls = `${nf.format(line.calls)} ${line.calls === 1 ? "call" : "calls"}`;
  switch (line.lane) {
    case "llm": {
      const inTok =
        (line.inputTokens ?? 0) +
        (line.cacheReadTokens ?? 0) +
        (line.cacheWriteTokens ?? 0);
      return `${calls} · ${nf.format(inTok)} in / ${nf.format(line.outputTokens ?? 0)} out tokens`;
    }
    case "tts":
      return `${calls} · ${nf.format(Math.round(line.quantity))} characters`;
    case "image":
      return `${nf.format(Math.round(line.quantity))} ${line.quantity === 1 ? "image" : "images"}`;
    case "video":
    case "lipsync":
      return `${calls} · ${nf.format(Math.round(line.quantity))}s of video`;
    case "transcription":
      return `${calls} · ${nf.format(Math.round(line.quantity))}s of GPU time`;
  }
}

/** How many billed units a section header should advertise. */
function countFor(lane: UsageLine["lane"], lines: PricedLine[]): number {
  const sum = (f: (l: PricedLine) => number) =>
    Math.round(lines.reduce((n, l) => n + f(l), 0));
  return lane === "image" ? sum(l => l.quantity) : sum(l => l.calls);
}

/**
 * Build the priced breakdown for one job. Flushes any buffered usage first, so a dialog opened
 * mid-render reflects everything spent up to this second rather than up to the last debounce.
 */
export async function getJobCostBreakdown(
  jobId: number
): Promise<CostBreakdown> {
  await flushJobUsage(jobId);

  const { getLongformVideoJobById } = await db();
  const job = await getLongformVideoJobById(jobId);
  const stored = (job?.costUsage as UsageLine[] | null) ?? [];
  const priced = stored.map(priceLine);

  const byLane = new Map<UsageLine["lane"], PricedLine[]>();
  for (const line of priced) {
    const bucket = byLane.get(line.lane);
    if (bucket) bucket.push(line);
    else byLane.set(line.lane, [line]);
  }

  const lanes = Array.from(byLane.keys()).sort(
    (a, b) => SECTION_META[a].order - SECTION_META[b].order
  );

  const sections: CostSection[] = lanes.map(lane => {
    const lines = byLane.get(lane) ?? [];
    const meta = SECTION_META[lane];
    return {
      key: lane,
      label: meta.label,
      count: meta.showCount ? countFor(lane, lines) : null,
      // A section is EXACT only when every line in it is — one un-priced model
      // downgrades the whole section rather than overstating confidence.
      accuracy: lines.every(l => l.exact) ? "exact" : "estimated",
      subtotalUsd: lines.reduce((n, l) => n + l.usd, 0),
      lines: lines
        .sort((a, b) => b.usd - a.usd)
        .map(l => ({
          label: l.model,
          detail: detailFor(l),
          usd: l.usd,
          rateKnown: l.rateKnown,
        })),
    };
  });

  return {
    jobId,
    totalUsd: priced.reduce((n, l) => n + l.usd, 0),
    metered: stored.length > 0,
    inProgress: job?.status === "processing",
    hasUnpricedLines: priced.some(l => !l.rateKnown),
    sections,
  };
}

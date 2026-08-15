import { getDb } from "./db";
import { sql } from "drizzle-orm";

/**
 * Boot-time check that the database matches `drizzle/schema.ts`.
 *
 * Drizzle's `db.select()` expands to an explicit column list, so a column that exists in the
 * schema file but not in the database makes MySQL reject the query outright
 * (`ER_BAD_FIELD_ERROR`). When that column is on `longform_video_jobs`, EVERY read of a job
 * fails — `pollJob`, the pipeline, the library — and the UI simply renders nothing. That is
 * exactly what an unapplied migration looked like in practice: buttons that "did nothing",
 * with the real cause buried in a tRPC 500.
 *
 * The failure is cheap to detect and expensive to diagnose, so it is checked once at boot and
 * reported in terms of the fix rather than the SQL error.
 */

/** Columns and tables added after the initial migration, each with the migration that adds it. */
const EXPECTED = [
  {
    probe: sql`SELECT costUsage FROM longform_video_jobs LIMIT 1`,
    what: "longform_video_jobs.costUsage",
    why: "per-video cost metering",
  },
  {
    probe: sql`SELECT slotIndex FROM longform_slots LIMIT 1`,
    what: "longform_slots",
    why: "the saved workspace (which job each tab holds)",
  },
];

/**
 * Log a loud, actionable warning for anything missing. Deliberately does NOT throw: a stale
 * schema should be obvious, not a boot failure that takes the whole app down.
 */
export async function checkSchema(): Promise<void> {
  const db = await getDb();
  if (!db) return; // no DATABASE_URL — a separate, already-loud failure

  const missing: string[] = [];
  for (const { probe, what, why } of EXPECTED) {
    try {
      await db.execute(probe);
    } catch (err: any) {
      // Only a missing table/column counts; a transient connection error is not schema drift.
      if (
        err?.cause?.code === "ER_BAD_FIELD_ERROR" ||
        err?.cause?.errno === 1146
      ) {
        missing.push(`  - ${what}  (${why})`);
      }
    }
  }

  if (missing.length === 0) return;

  console.error(
    [
      "",
      "═".repeat(72),
      "  DATABASE SCHEMA IS OUT OF DATE — the app will misbehave until you migrate.",
      "",
      "  Missing:",
      ...missing,
      "",
      "  Every read of a job selects all schema columns, so a missing one makes",
      "  MySQL reject the query and the UI renders nothing (buttons appear dead).",
      "",
      "  Fix:  npx drizzle-kit migrate",
      "═".repeat(72),
      "",
    ].join("\n")
  );
}

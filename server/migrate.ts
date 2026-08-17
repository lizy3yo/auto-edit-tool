import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb } from "./db";

/**
 * Apply any unapplied migrations at boot.
 *
 * There is no release step anywhere in the deploy: Railway (like `pnpm start` on a box) runs
 * `build` and then `node dist/index.js`, and `db:push` is a thing a human remembers to type.
 * So a deploy shipped code that selected `costUsage` / `youtubeUrl` / `longform_slots` against
 * a database that had never been migrated, and every read of a job returned a 500 — while the
 * same code on a migrated dev machine was perfectly healthy.
 *
 * Safe to do at boot here specifically because the app is single-process by design (see the
 * in-memory semaphores and poll loops in `longformVideo.ts`); there is no second instance to
 * race for the migration lock.
 *
 * Deliberately does NOT throw. A database that rejects a migration is bad, but a boot loop is
 * worse — `checkSchema()` runs straight after and names whatever is still missing.
 */
export async function runMigrations(): Promise<void> {
  if (process.env.AUTO_MIGRATE === "0") {
    console.log("[Migrate] skipped (AUTO_MIGRATE=0)");
    return;
  }

  const db = await getDb();
  if (!db) return; // no DATABASE_URL — a separate, already-loud failure

  // Resolved from the working directory, which is the project root under both `pnpm dev` and
  // `pnpm start`. The bundle lives in `dist/`, the migrations do not get bundled with it.
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");

  try {
    await migrate(db, { migrationsFolder });
    console.log(`[Migrate] schema up to date (${migrationsFolder})`);
  } catch (err: any) {
    console.error(
      [
        "",
        "═".repeat(72),
        "  MIGRATIONS FAILED — the app will serve 500s on anything they add.",
        "",
        `  Folder: ${migrationsFolder}`,
        `  Reason: ${err?.cause?.code ?? err?.code ?? ""} ${err?.message ?? err}`,
        "",
        "  If this says a table already exists, the database was built with",
        "  `drizzle-kit push` and has no migration journal to compare against;",
        "  baseline it before this can take over.",
        "═".repeat(72),
        "",
      ].join("\n")
    );
  }
}

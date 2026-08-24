import { eq, desc, and, inArray, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import {
  providerConfigs,
  channelConfigs,
  appSettings,
  longformVideoJobs,
  longformSlots,
  books,
  channelAssets,
  longformSales,
  users,
} from "../drizzle/schema";
import type {
  InsertProviderConfig,
  InsertChannelConfig,
  InsertLongformVideoJob,
  Book,
  InsertBook,
  ChannelAsset,
  InsertChannelAsset,
  InsertLongformSale,
  User,
  InsertUser,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // Log where we're dialing (never the credentials) — a bad DATABASE_URL
      // surfaces as an opaque ETIMEDOUT per query, with nothing naming the host.
      try {
        const u = new URL(process.env.DATABASE_URL);
        console.log(
          `[Database] connecting to ${u.hostname}:${u.port || 3306}${u.pathname}`
        );
      } catch {
        console.warn("[Database] DATABASE_URL is not a parseable URL");
      }
      const pool = createPool({
        uri: process.env.DATABASE_URL,
        connectionLimit: 20,
        waitForConnections: true,
        queueLimit: 0,
        // Fail fast: the default has queries hanging ~2min on an unreachable
        // host, which reads as "the app is slow" instead of "the DB is down".
        connectTimeout: 10_000,
      });
      // Raise the per-session sort buffer above MySQL's 256 KB default.
      //
      // The library query sorts rows whose select list holds three
      // `json_unquote(json_extract(...))` expressions. Those are typed LONGTEXT, and filesort
      // sizes its buffer from each column's DECLARED width (4 GB), never the actual data — so
      // it blew the buffer on a table holding ONE job. The symptom is
      // `ER_OUT_OF_SORTMEMORY (1038)`, which Drizzle reports only as `Failed query: select ...`.
      //
      // Production (MySQL 9.4) hits this; dev (MySQL 8.4) does not, on identical
      // `sort_buffer_size` and `max_sort_length` — so it is unreproducible locally, and the
      // library, side panel and history views 500 in production only. Verified against the
      // production database: the exact query fails at 262144 and succeeds at this value.
      //
      // Allocated incrementally per sort (MySQL 8.0.12+), not reserved per connection.
      const sortBuffer =
        Number(process.env.MYSQL_SORT_BUFFER_SIZE) || 8_388_608;
      pool.on("connection", conn => {
        conn.query(`SET SESSION sort_buffer_size = ${sortBuffer}`, err => {
          if (err)
            console.warn(
              "[Database] could not raise sort_buffer_size:",
              (err as { code?: string }).code ?? err.message
            );
        });
      });
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Provider Config Helpers ───

export async function getActiveProvider() {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(providerConfigs)
    .where(eq(providerConfigs.isActive, true))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllProviderConfigs() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(providerConfigs)
    .orderBy(desc(providerConfigs.updatedAt));
}

export async function upsertProviderConfig(config: InsertProviderConfig) {
  const db = await getDb();
  if (!db) return;

  // If setting as active, deactivate all others first
  if (config.isActive) {
    await db.update(providerConfigs).set({ isActive: false });
  }

  if (config.id) {
    await db
      .update(providerConfigs)
      .set({
        providerType: config.providerType,
        displayName: config.displayName,
        apiKeyEncrypted: config.apiKeyEncrypted,
        apiKeyLast4: config.apiKeyLast4,
        customConfig: config.customConfig,
        isActive: config.isActive,
        connectionStatus: config.connectionStatus,
        lastTestedAt: config.lastTestedAt,
      })
      .where(eq(providerConfigs.id, config.id));
  } else {
    await db.insert(providerConfigs).values(config);
  }
}

export async function updateProviderConnectionStatus(
  id: number,
  status: "connected" | "disconnected" | "untested"
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(providerConfigs)
    .set({
      connectionStatus: status,
      lastTestedAt: new Date(),
    })
    .where(eq(providerConfigs.id, id));
}

export async function setActiveProvider(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(providerConfigs).set({ isActive: false });
  await db
    .update(providerConfigs)
    .set({ isActive: true })
    .where(eq(providerConfigs.id, id));
}

export async function getProviderByType(type: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(providerConfigs)
    .where(eq(providerConfigs.providerType, type as any))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function deleteProviderConfig(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(providerConfigs).where(eq(providerConfigs.id, id));
}

export async function updateProviderApiKey(
  id: number,
  apiKeyEncrypted: string,
  apiKeyLast4: string
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(providerConfigs)
    .set({
      apiKeyEncrypted,
      apiKeyLast4,
      connectionStatus: "connected" as const,
      lastTestedAt: new Date(),
    })
    .where(eq(providerConfigs.id, id));
}

// ─── Long-form Video Job Helpers ───

export async function createLongformVideoJob(
  job: InsertLongformVideoJob
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(longformVideoJobs).values(job);
  return result[0].insertId;
}

export async function updateLongformVideoJob(
  id: number,
  updates: Partial<InsertLongformVideoJob>
) {
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(longformVideoJobs)
      .set(updates)
      .where(eq(longformVideoJobs.id, id));
  } catch (err: any) {
    // Retry once on stale-connection errors
    if (
      err?.message?.includes("Failed query") ||
      err?.cause?.code === "PROTOCOL_CONNECTION_LOST"
    ) {
      console.warn(
        `[DB] updateLongformVideoJob retry for job ${id} after connection error`
      );
      _db = null;
      const freshDb = await getDb();
      if (!freshDb) return;
      await freshDb
        .update(longformVideoJobs)
        .set(updates)
        .where(eq(longformVideoJobs.id, id));
    } else {
      throw err;
    }
  }
}

export async function getLongformVideoJobById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(longformVideoJobs)
    .where(eq(longformVideoJobs.id, id))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

// Status-only read for cheap mid-pipeline cancellation checks — avoids
// re-selecting the whole row (incl. the large `storyboard` JSON) on each check.
export async function getLongformVideoJobStatus(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({ status: longformVideoJobs.status })
    .from(longformVideoJobs)
    .where(eq(longformVideoJobs.id, id))
    .limit(1);
  return result.length > 0 ? result[0].status : null;
}

export async function getActiveLongformVideoJobs(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(longformVideoJobs)
    .where(
      and(
        eq(longformVideoJobs.userId, userId),
        eq(longformVideoJobs.status, "processing")
      )
    )
    .orderBy(desc(longformVideoJobs.createdAt));
}

// Light columns for the history list — never selects the full script
// (inputParams) or storyboard JSON; title/channelKey are pulled out as scalars.
const longformHistoryColumns = {
  id: longformVideoJobs.id,
  status: longformVideoJobs.status,
  stage: longformVideoJobs.stage,
  userName: longformVideoJobs.userName,
  createdAt: longformVideoJobs.createdAt,
  completedAt: longformVideoJobs.completedAt,
  errorMessage: longformVideoJobs.errorMessage,
  finalVideoUrl: longformVideoJobs.finalVideoUrl,
  title: sql<
    string | null
  >`json_unquote(json_extract(${longformVideoJobs.inputParams}, '$.title'))`,
  channelKey: sql<
    string | null
  >`json_unquote(json_extract(${longformVideoJobs.inputParams}, '$.channelKey'))`,
};

/**
 * Library columns — the history set plus what a visual card needs.
 *
 * `posterUrl` is the FIRST scene's rendered clip, pulled out with `json_extract` so the
 * multi-megabyte storyboard array never crosses the wire. Scene 1 is always a host beat
 * (`buildUnifiedScenes` opens and closes on the host), so it makes a recognisable thumbnail,
 * and it exists long before the film is assembled — an in-progress render gets a real preview
 * instead of a grey box. The client falls back to `finalVideoUrl` when it is absent.
 */
const longformLibraryColumns = {
  ...longformHistoryColumns,
  progress: longformVideoJobs.progress,
  posterUrl: sql<
    string | null
  >`json_unquote(json_extract(${longformVideoJobs.storyboard}, '$[0].clipUrl'))`,
};

/**
 * Every job for the library views — unlike the history queries this includes `processing`,
 * because the side panel's whole point is showing a render while it is still going.
 * `allUsers` is for admins, matching `getAllLongformVideoJobHistory`.
 */
export async function getLongformLibrary(
  userId: number,
  opts: { allUsers?: boolean; limit?: number } = {}
) {
  const db = await getDb();
  if (!db) return [];
  const q = db.select(longformLibraryColumns).from(longformVideoJobs);
  return (opts.allUsers ? q : q.where(eq(longformVideoJobs.userId, userId)))
    .orderBy(desc(longformVideoJobs.createdAt))
    .limit(opts.limit ?? 200);
}

export async function getLongformVideoJobHistory(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(longformHistoryColumns)
    .from(longformVideoJobs)
    .where(
      and(
        eq(longformVideoJobs.userId, userId),
        inArray(longformVideoJobs.status, ["completed", "failed"])
      )
    )
    .orderBy(desc(longformVideoJobs.createdAt))
    .limit(limit);
}

// Admin: every user's finished jobs, each carrying its maker's userName.
export async function getAllLongformVideoJobHistory(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(longformHistoryColumns)
    .from(longformVideoJobs)
    .where(inArray(longformVideoJobs.status, ["completed", "failed"]))
    .orderBy(desc(longformVideoJobs.createdAt))
    .limit(limit);
}

// ─── Long-form workspace (the five tabs, per user) ───

/**
 * This user's five tabs. Missing rows simply mean "empty tab", so a first sign-in needs no
 * seeding — the caller pads to `LONGFORM_SLOT_COUNT`.
 */
export async function getLongformSlots(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(longformSlots)
    .where(eq(longformSlots.userId, userId))
    .orderBy(longformSlots.slotIndex);
}

/**
 * Upsert one tab. `jobId`/`draftTitle` are each optional so the caller can change one without
 * clobbering the other — passing `null` clears, passing nothing leaves it alone.
 */
export async function setLongformSlot(
  userId: number,
  slotIndex: number,
  patch: { jobId?: number | null; draftTitle?: string | null }
) {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if ("jobId" in patch) set.jobId = patch.jobId ?? null;
  if ("draftTitle" in patch) set.draftTitle = patch.draftTitle || null;
  if (Object.keys(set).length === 0) return;

  await db
    .insert(longformSlots)
    .values({ userId, slotIndex, ...set })
    .onDuplicateKeyUpdate({ set });
}

/**
 * Delete a job.
 *
 * `allowAny` is the oversight tier's key: admins and operations managers see every render in the
 * library (`canSeeAllJobs`), so a delete button they can SEE has to be one they can press.
 * Editors stay pinned to their own.
 */
export async function deleteLongformVideoJob(
  id: number,
  userId: number,
  opts: { allowAny?: boolean } = {}
) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const job = await db
    .select()
    .from(longformVideoJobs)
    .where(eq(longformVideoJobs.id, id))
    .limit(1);
  if (!job.length) throw new Error("Long-form video job not found");
  if (!opts.allowAny && job[0].userId !== userId) {
    throw new Error("Not authorized");
  }
  // Release any tab still pointing at this job BEFORE the row goes. There is no FK from
  // `longform_slots`, so a delete would otherwise leave a tab pinned to an id that no longer
  // loads — and it would come back on every reload, since slots are server-persisted. The tab
  // to clear belongs to the job's OWNER, who is not necessarily whoever pressed delete.
  await db
    .update(longformSlots)
    .set({ jobId: null, draftTitle: null })
    .where(
      and(eq(longformSlots.userId, job[0].userId), eq(longformSlots.jobId, id))
    );
  await db.delete(longformVideoJobs).where(eq(longformVideoJobs.id, id));
}

/**
 * IDs of stale (processing + inactive past the cutoff) longform jobs whose storyboard has a
 * scene with persisted in-flight render task IDs. These are resumable — the provider render
 * likely finished after the pipeline process died — so the watchdog tries to resume them
 * before the blanket stale-fail sweep.
 */
export async function getStaleLongformJobIdsWithPendingRenders(
  timeoutMinutes = 30
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
  const rows = await db
    .select({
      id: longformVideoJobs.id,
      storyboard: longformVideoJobs.storyboard,
    })
    .from(longformVideoJobs)
    .where(
      and(
        eq(longformVideoJobs.status, "processing"),
        lt(longformVideoJobs.updatedAt, cutoff)
      )
    );
  return rows
    .filter(
      r =>
        Array.isArray(r.storyboard) &&
        (r.storyboard as any[]).some(s => s?.renderTaskIds?.length)
    )
    .map(r => r.id);
}

export async function markStaleLongformJobsFailed(
  timeoutMinutes = 30
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
  const result = await db
    .update(longformVideoJobs)
    .set({
      status: "failed",
      errorMessage: `Job timed out after ${timeoutMinutes} minutes of inactivity`,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(longformVideoJobs.status, "processing"),
        lt(longformVideoJobs.updatedAt, cutoff)
      )
    );
  return (result as any)?.[0]?.affectedRows ?? 0;
}

// ─── Channel Config Helpers ───

export async function getChannelConfig(channelKey: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(channelConfigs)
    .where(eq(channelConfigs.channelKey, channelKey));
  return rows[0] ?? null;
}

/**
 * Every on-camera name form for `channelKey` that could surface in a script and reach
 * a video prompt — full host name, channel display name, and the bare first name.
 * Feeds `stripHostNames` (shared/constants.ts) before clips are submitted to 69labs,
 * which rejects prompts naming a "well-known person". Unknown channel → [] (no-op).
 */
export async function hostNameAliases(channelKey: string): Promise<string[]> {
  const c = await getChannelConfig(channelKey);
  if (!c) return [];
  const names = [c.hostName, c.displayName].filter(Boolean) as string[];
  const first = c.hostName?.trim().split(/\s+/)[0];
  // ponytail: >2 chars keeps initials/particles ("A.", "de") from eating whole words.
  if (first && first.length > 2) names.push(first);
  return names;
}

export async function getAllChannelConfigs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(channelConfigs).orderBy(channelConfigs.channelKey);
}

export async function upsertChannelConfig(
  channelKey: string,
  data: Partial<InsertChannelConfig>
) {
  const db = await getDb();
  if (!db) return;
  const existing = await getChannelConfig(channelKey);
  if (existing) {
    await db
      .update(channelConfigs)
      .set(data)
      .where(eq(channelConfigs.channelKey, channelKey));
  } else {
    await db.insert(channelConfigs).values({ channelKey, ...data });
  }
}

export async function createChannelConfig(data: InsertChannelConfig) {
  const db = await getDb();
  if (!db) return;
  await db.insert(channelConfigs).values(data);
}

export async function deleteChannelConfig(channelKey: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(channelConfigs)
    .where(eq(channelConfigs.channelKey, channelKey));
}

// ─── App Settings Helpers ───

export async function getAppSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(appSettings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
}

// ─── Books ───

/** All books for a channel, newest first. `activeOnly` hides soft-deleted rows from the picker. */
export async function getBooks(
  channelKey: string,
  activeOnly = false
): Promise<Book[]> {
  const db = await getDb();
  if (!db) return [];
  const where = activeOnly
    ? and(eq(books.channelKey, channelKey), eq(books.isActive, true))
    : eq(books.channelKey, channelKey);
  return db.select().from(books).where(where).orderBy(desc(books.createdAt));
}

/** One book by id, or null. Used when a job resolves its CTA assignments. */
export async function getBookById(id: number): Promise<Book | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(books).where(eq(books.id, id));
  return row ?? null;
}

export async function createBook(data: InsertBook): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [res] = await db.insert(books).values(data);
  return (res as any)?.insertId ?? null;
}

export async function updateBook(
  id: number,
  data: Partial<InsertBook>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(books).set(data).where(eq(books.id, id));
}

/**
 * Soft-delete. Never a hard delete: finished videos snapshot their book onto the job, but the
 * Books page still resolves ids to show which book a video sold, and a hard delete would turn
 * those rows into dangling references.
 */
export async function deactivateBook(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(books).set({ isActive: false }).where(eq(books.id, id));
}

// ─── Channel Assets ───
// Per-channel CTA images, managed like books (define once, reuse every video).

export async function getChannelAssets(
  channelKey: string,
  activeOnly = false
): Promise<ChannelAsset[]> {
  const db = await getDb();
  if (!db) return [];
  const where = activeOnly
    ? and(
        eq(channelAssets.channelKey, channelKey),
        eq(channelAssets.isActive, true)
      )
    : eq(channelAssets.channelKey, channelKey);
  return db
    .select()
    .from(channelAssets)
    .where(where)
    .orderBy(desc(channelAssets.createdAt));
}

export async function createChannelAsset(
  data: InsertChannelAsset
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [res] = await db.insert(channelAssets).values(data);
  return (res as any)?.insertId ?? null;
}

export async function updateChannelAsset(
  id: number,
  data: Partial<InsertChannelAsset>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(channelAssets).set(data).where(eq(channelAssets.id, id));
}

/** Soft-delete, same reasoning as `deactivateBook`: keep finished videos' snapshots resolvable. */
export async function deactivateChannelAsset(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(channelAssets)
    .set({ isActive: false })
    .where(eq(channelAssets.id, id));
}

// ─── Sales ───

/**
 * Record one reported sale. Returns `false` when `externalOrderId` was already recorded — the
 * duplicate guard that makes the store's webhook safe to retry.
 */
export async function recordSale(data: InsertLongformSale): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(longformSales).values(data);
    return true;
  } catch (err: any) {
    // MySQL duplicate-key on the unique externalOrderId — a replay, not an error.
    //
    // Drizzle WRAPS the driver error in a DrizzleQueryError, so the mysql2 code lives on
    // `.cause`, not on the error itself. Checking only the top level meant the guard never
    // fired: a retried webhook threw, the endpoint answered 500, and the store retried it
    // forever without the sale ever being recorded. Walk the cause chain.
    if (isDuplicateKeyError(err)) return false;
    throw err;
  }
}

/** True when `err` (or anything it wraps) is a MySQL duplicate-key violation. */
function isDuplicateKeyError(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
  }
  return false;
}

/** Per-video sales totals, keyed by jobId. Only attributed sales (a jobId was parsed) count. */
export async function getSalesByJob(
  jobIds: number[]
): Promise<Map<number, { sales: number; revenueCents: number }>> {
  const out = new Map<number, { sales: number; revenueCents: number }>();
  const db = await getDb();
  if (!db || jobIds.length === 0) return out;
  const rows = await db
    .select({
      jobId: longformSales.jobId,
      sales: sql<number>`COUNT(*)`,
      revenueCents: sql<number>`COALESCE(SUM(${longformSales.amountCents}), 0)`,
    })
    .from(longformSales)
    .where(inArray(longformSales.jobId, jobIds))
    .groupBy(longformSales.jobId);
  for (const r of rows) {
    if (r.jobId == null) continue;
    out.set(r.jobId, {
      sales: Number(r.sales),
      revenueCents: Number(r.revenueCents),
    });
  }
  return out;
}

/** Sales for ONE video, split by the product the store reported — a video may pitch two books. */
export async function getSalesByProductForJob(
  jobId: number
): Promise<
  { productId: string | null; sales: number; revenueCents: number }[]
> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      productId: longformSales.productId,
      sales: sql<number>`COUNT(*)`,
      revenueCents: sql<number>`COALESCE(SUM(${longformSales.amountCents}), 0)`,
    })
    .from(longformSales)
    .where(eq(longformSales.jobId, jobId))
    .groupBy(longformSales.productId);
  return rows.map(r => ({
    productId: r.productId,
    sales: Number(r.sales),
    revenueCents: Number(r.revenueCents),
  }));
}

/**
 * Job id → title, for the ids given. Unknown ids and jobs with no title are simply ABSENT from
 * the map, so the caller can fall back per id rather than having to distinguish null from missing.
 *
 * Selects the title out of the JSON rather than the row: `inputParams` holds the entire script,
 * and a report page asking for 500 videos would otherwise drag 500 scripts across the wire to
 * read one string from each.
 */
export async function getVideoTitles(
  ids: number[]
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const db = await getDb();
  if (!db || ids.length === 0) return out;
  const rows = await db
    .select({
      id: longformVideoJobs.id,
      title: sql<
        string | null
      >`json_unquote(json_extract(${longformVideoJobs.inputParams}, '$.title'))`,
    })
    .from(longformVideoJobs)
    .where(inArray(longformVideoJobs.id, ids));
  for (const r of rows) {
    const title = r.title?.trim();
    if (title) out.set(r.id, title);
  }
  return out;
}

/**
 * Recent jobs for one channel, with just enough to preview a book's tracking link against a REAL
 * video: the id, the title, and whichever books that render actually pitched.
 *
 * `ctaBooks` is pulled out of `inputParams` by JSON path rather than selecting the column — the
 * column also holds the full script, and a picker listing 50 videos does not need 50 scripts.
 */
export async function getJobsForChannel(
  channelKey: string,
  limit = 50
): Promise<{ id: number; title: string | null; ctaBooks: unknown }[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: longformVideoJobs.id,
      title: sql<
        string | null
      >`json_unquote(json_extract(${longformVideoJobs.inputParams}, '$.title'))`,
      ctaBooks: sql<
        string | null
      >`json_extract(${longformVideoJobs.inputParams}, '$.ctaBooks')`,
      channelKey: sql<
        string | null
      >`json_unquote(json_extract(${longformVideoJobs.inputParams}, '$.channelKey'))`,
    })
    .from(longformVideoJobs)
    .orderBy(desc(longformVideoJobs.id))
    .limit(Math.max(1, Math.min(200, limit * 4)));
  return rows
    .filter(r => r.channelKey === channelKey)
    .slice(0, limit)
    .map(r => ({
      id: r.id,
      title: r.title,
      // mysql2 hands JSON back already parsed on some driver versions and as a string on others.
      ctaBooks:
        typeof r.ctaBooks === "string"
          ? (() => {
              try {
                return JSON.parse(r.ctaBooks);
              } catch {
                return null;
              }
            })()
          : r.ctaBooks,
    }));
}

// ─── Accounts (`users`) ───

/** Public shape of an account — everything the admin table shows, and never the hash. */
export type PublicUser = Omit<User, "passwordHash">;

const publicUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  status: users.status,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

/** Emails are stored lower-cased so sign-in is case-insensitive and the unique index bites. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Full row INCLUDING the hash — for the login path only. */
export async function getUserByEmail(email: string): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

/** Full row INCLUDING the hash — for the change-password path only. */
export async function getUserByIdWithHash(id: number): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** One account, hash-free. Resolves the session on every authenticated request. */
export async function getPublicUserById(
  id: number
): Promise<PublicUser | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select(publicUserColumns)
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Every account, oldest first — the admin Users table. Hash-free by construction. */
export async function listUsers(): Promise<PublicUser[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select(publicUserColumns).from(users).orderBy(users.id);
}

/**
 * The bootstrap admin.
 *
 * `getPublicUserById(1)` is not good enough: id 1 is the seeded root, but if it were ever
 * deleted a legacy `openId: "admin"` cookie has to resolve to SOME admin rather than to
 * nobody. Lowest id wins, so it is stable across restarts.
 */
export async function getRootAdmin(): Promise<PublicUser | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select(publicUserColumns)
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")))
    .orderBy(users.id)
    .limit(1);
  return rows[0] ?? null;
}

/** How many admins can still sign in — the lockout guard's denominator. */
export async function countActiveAdmins(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Insert an account. `id` is only ever passed by `ensureRootAdmin`, which pins the bootstrap
 * admin at 1 so the jobs, slots and library already stamped `userId = 1` stay attached to it.
 */
export async function createUser(
  data: InsertUser & { id?: number }
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const [res] = await db
    .insert(users)
    .values({ ...data, email: normalizeEmail(data.email) })
    .$returningId();
  return data.id ?? res.id;
}

export async function updateUser(
  id: number,
  patch: Partial<
    Pick<User, "name" | "email" | "role" | "status" | "passwordHash">
  >
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const set = { ...patch };
  if (set.email) set.email = normalizeEmail(set.email);
  if (Object.keys(set).length === 0) return;
  await db.update(users).set(set).where(eq(users.id, id));
}

export async function deleteUser(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // Jobs deliberately keep the dangling `userId` (and their `userName` snapshot): a departed
  // editor's renders are the channel's work product, not theirs to take with them. Their five
  // tabs are workspace state and do go.
  await db.delete(longformSlots).where(eq(longformSlots.userId, id));
  await db.delete(users).where(eq(users.id, id));
}

/** Stamped on every successful sign-in — the "is this account still in use?" column. */
export async function touchUserLogin(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, id));
}

/** How many renders each account owns — shown before an admin deletes one. */
export async function countJobsByUser(): Promise<Map<number, number>> {
  const db = await getDb();
  if (!db) return new Map();
  const rows = await db
    .select({
      userId: longformVideoJobs.userId,
      n: sql<number>`count(*)`,
    })
    .from(longformVideoJobs)
    .groupBy(longformVideoJobs.userId);
  return new Map(rows.map(r => [Number(r.userId), Number(r.n)]));
}

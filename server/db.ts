import { eq, desc, and, inArray, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import {
  providerConfigs,
  channelConfigs,
  appSettings,
  longformVideoJobs,
} from "../drizzle/schema";
import type {
  InsertProviderConfig,
  InsertChannelConfig,
  InsertLongformVideoJob,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const pool = createPool({
        uri: process.env.DATABASE_URL,
        connectionLimit: 20,
        waitForConnections: true,
        queueLimit: 0,
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

export async function deleteLongformVideoJob(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const job = await db
    .select()
    .from(longformVideoJobs)
    .where(eq(longformVideoJobs.id, id))
    .limit(1);
  if (!job.length) throw new Error("Long-form video job not found");
  if (job[0].userId !== userId) throw new Error("Not authorized");
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

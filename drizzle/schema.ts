import {
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Provider configuration — stores which API provider is active and its credentials.
 * Only one row should be "active" at a time. (Enum kept identical to the source
 * app so shared types don't ripple; only "sixtynine_labs" is used here.)
 */
export const providerConfigs = mysqlTable("provider_configs", {
  id: int("id").autoincrement().primaryKey(),
  providerType: mysqlEnum("providerType", [
    "genaipro",
    "google_gemini",
    "fal_ai",
    "replicate",
    "kie_ai",
    "sixtynine_labs",
    "custom",
  ]).notNull(),
  displayName: varchar("displayName", { length: 128 }).notNull(),
  /** Encrypted API key — never sent to frontend */
  apiKeyEncrypted: text("apiKeyEncrypted"),
  /** Last 4 chars of API key for masked display */
  apiKeyLast4: varchar("apiKeyLast4", { length: 4 }),
  /** Custom endpoint fields (JSON) — only used for "custom" provider */
  customConfig: json("customConfig"),
  isActive: boolean("isActive").default(false).notNull(),
  connectionStatus: mysqlEnum("connectionStatus", [
    "connected",
    "disconnected",
    "untested",
  ])
    .default("untested")
    .notNull(),
  lastTestedAt: timestamp("lastTestedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProviderConfig = typeof providerConfigs.$inferSelect;
export type InsertProviderConfig = typeof providerConfigs.$inferInsert;

/**
 * Long-form faceless video jobs — script → AI storyboard → per-scene TTS +
 * Grok clip → stitched into one finished MP4. One row per generated film.
 */
export const longformVideoJobs = mysqlTable("longform_video_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  userName: varchar("userName", { length: 255 }),
  /** Overall job status */
  status: mysqlEnum("status", ["processing", "completed", "failed"])
    .default("processing")
    .notNull(),
  /** Current pipeline stage (for progress UI) */
  stage: mysqlEnum("stage", [
    "storyboard",
    "voiceover",
    "clips",
    "assembly",
    "done",
  ])
    .default("storyboard")
    .notNull(),
  /** Input params: script, targetSeconds, clipLen, aspectRatio, lockMode, faceImageUrl, voiceId, ttsModel */
  inputParams: json("inputParams"),
  /** Storyboard scenes, each carrying its narration, visualPrompt, hostPresent, audioUrl, audioDuration, clipUrl, sceneStatus */
  storyboard: json("storyboard"),
  /** Progress counters: { scenesTotal, scenesDone } */
  progress: json("progress"),
  /**
   * Metered provider spend for this render — an array of `UsageLine`
   * (`server/pricing.ts`): one entry per lane + vendor + model, carrying real token counts,
   * image counts and rendered seconds. `server/costMeter.ts` accumulates it; the cost
   * breakdown dialog prices it. Null on jobs rendered before metering existed, which the UI
   * reports as unmetered rather than as $0.00.
   */
  costUsage: json("costUsage"),
  /**
   * R2 URL of the ONE continuous master narration (Stage 2). Assembly lays this
   * untouched track over the whole film (per-scene `narrationStartSec/EndSec` map the
   * scenes onto it); absent on pre-overlay jobs → per-scene audio concat fallback.
   */
  masterAudioUrl: text("masterAudioUrl"),
  /** Final stitched video */
  finalVideoUrl: text("finalVideoUrl"),
  finalFileKey: varchar("finalFileKey", { length: 512 }),
  /**
   * The YouTube URL this render was published to, pasted back by the operator after upload.
   *
   * Nothing in the pipeline reads it — it exists so a sales report reads as "Never Throw Away
   * Autumn Leaves → 8 sales" instead of "ref=183 → 8 sales". The tracking link is what ties a
   * sale to a video; this ties that video to something a human recognises.
   */
  youtubeUrl: varchar("youtubeUrl", { length: 512 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LongformVideoJob = typeof longformVideoJobs.$inferSelect;
export type InsertLongformVideoJob = typeof longformVideoJobs.$inferInsert;

/**
 * The five long-form tabs, per user — which job each one currently holds and the download
 * title typed into it.
 *
 * This used to live in `localStorage`, which made the workspace device-bound: the same account
 * on another machine came up with five empty tabs even though every job was already in the
 * database. The renders themselves were never at risk (they are rows here with media on R2);
 * it was only the *desk* that didn't travel. Keyed by (userId, slotIndex) so signing in
 * anywhere restores the same five tabs.
 *
 * Scene-checkbox selections stay in `localStorage` on purpose — they are throwaway UI state
 * for one regenerate click, not something worth syncing.
 */
export const longformSlots = mysqlTable(
  "longform_slots",
  {
    userId: int("userId").notNull(),
    /** 0–4, matching `LONGFORM_SLOT_COUNT`. */
    slotIndex: int("slotIndex").notNull(),
    /** Job shown in this tab; null when the tab is a blank form. */
    jobId: int("jobId"),
    /** Download title typed into the tab before/while generating. */
    draftTitle: varchar("draftTitle", { length: 255 }),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [primaryKey({ columns: [table.userId, table.slotIndex] })]
);

export type LongformSlot = typeof longformSlots.$inferSelect;

/**
 * Channel configurations — per-channel voice, host identity, CTA assets and
 * generation defaults. (Drive/Sheets/YouTube columns are inert carry-overs so
 * copied code compiles; nothing in this app writes to those services.)
 */
export const channelConfigs = mysqlTable("channel_configs", {
  id: int("id").autoincrement().primaryKey(),
  /** Channel key — the row's stable id, also the music-bed set prefix (server/musicBeds.ts) */
  channelKey: varchar("channelKey", { length: 64 }).notNull().unique(),
  /** ElevenLabs voice ID for TTS */
  voiceId: varchar("voiceId", { length: 128 }),
  /** ElevenLabs voice name (for display) */
  voiceName: varchar("voiceName", { length: 255 }),
  /** TTS model to use */
  ttsModel: varchar("ttsModel", { length: 64 }),
  /** TTS speed multiplier (e.g., 0.90, 1.0, 1.10) */
  ttsSpeed: varchar("ttsSpeed", { length: 8 }),
  /** TTS volume multiplier applied as an ffmpeg gain (0.5–2, null/1.0 = neutral) */
  ttsVolume: varchar("ttsVolume", { length: 8 }),
  /** Google Drive folder ID for this channel's output (inert) */
  driveFolderId: varchar("driveFolderId", { length: 128 }),
  /** Google Drive folder name (inert) */
  driveFolderName: varchar("driveFolderName", { length: 255 }),
  /** Default script angle (classical, amish, forbidden, medieval) */
  defaultAngle: varchar("defaultAngle", { length: 32 }),
  /** Default script format (howto, listicle) */
  defaultFormat: varchar("defaultFormat", { length: 32 }),
  /** Default word count target */
  defaultWordCount: int("defaultWordCount"),
  /** Default niche for this channel */
  defaultNiche: varchar("defaultNiche", { length: 64 })
    .default("gardening")
    .notNull(),
  /** Google Sheets ID (inert) */
  ideationSheetId: varchar("ideationSheetId", { length: 255 }),
  /** YouTube channel URL (inert) */
  youtubeUrl: varchar("youtubeUrl", { length: 512 }),
  /** YouTube channel ID (inert) */
  youtubeChannelId: varchar("youtubeChannelId", { length: 128 }),
  /** Display name shown in the channel picker */
  displayName: varchar("displayName", { length: 255 }),
  /** Persona profile text (drives script generation tone) */
  personaProfile: text("personaProfile"),
  /** Niche slug (e.g., "gardening", "lawncare") */
  nicheSlug: varchar("nicheSlug", { length: 64 }),
  /** Author / pen name */
  authorName: varchar("author_name", { length: 255 }),
  /** QR-code image (R2 URL) overlaid on CTA scenes of this channel's long-form videos */
  ctaQrImageUrl: varchar("ctaQrImageUrl", { length: 512 }),
  /** Book cover image (R2 URL) revealed full-frame when the book is first named in each CTA */
  bookCoverImageUrl: varchar("bookCoverImageUrl", { length: 512 }),
  /** Host photo (R2 URL): identity-lock start frame for talking-host scenes + lip-sync */
  hostPhotoUrl: varchar("hostPhotoUrl", { length: 512 }),
  /** Second host photo (R2 URL): alternate camera angle, alternated with hostPhotoUrl across host scenes */
  hostPhotoUrl2: varchar("hostPhotoUrl2", { length: 512 }),
  /** Host's full name for the on-screen lower third, e.g. "Riley Danvers" */
  hostName: varchar("hostName", { length: 128 }),
  /** Host's title for the lower third, e.g. "Gardener" */
  hostTitle: varchar("hostTitle", { length: 128 }),
  /** Host's city & state for the lower third, e.g. "Fresno, CA" */
  hostLocation: varchar("hostLocation", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChannelConfig = typeof channelConfigs.$inferSelect;
export type InsertChannelConfig = typeof channelConfigs.$inferInsert;

/**
 * Books — the products a channel's videos pitch. One row per book, per channel (a book is not
 * shared across channels; the same title sold on two channels is two rows, so each keeps its own
 * shop link and its sales stay separable).
 *
 * This replaces the single `channel_configs.bookCoverImageUrl` / `ctaQrImageUrl` pair, which
 * could only ever describe ONE book per channel. Those columns are retained as the fallback for
 * videos with no book assigned, so nothing already rendered changes.
 *
 * `shopUrl` is the load-bearing field: the per-video tracking link and its QR are both derived
 * from it (`buildTrackingUrl`). A book with no shop URL still supplies its cover, just no QR.
 */
export const books = mysqlTable("books", {
  id: int("id").autoincrement().primaryKey(),
  /** Owning channel — books are per-channel, never shared. */
  channelKey: varchar("channelKey", { length: 64 }).notNull(),
  /** Display title, and what `markCoverReveal` searches the CTA text for. */
  title: varchar("title", { length: 255 }).notNull(),
  /** Cover image (R2 URL) revealed full-frame in this book's CTA block. */
  coverImageUrl: varchar("coverImageUrl", { length: 512 }),
  /**
   * Where this book is sold. The per-video link is this plus `?ref=<jobId>`, and the on-screen QR
   * encodes that. Null ⇒ the book can still be shown, but carries no QR and no tracking.
   */
  shopUrl: varchar("shopUrl", { length: 512 }),
  /** Soft-delete: an inactive book stays attached to the videos that already used it. */
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Book = typeof books.$inferSelect;
export type InsertBook = typeof books.$inferInsert;

/**
 * Sales reported by the webstore, one row per paid line item.
 *
 * Written ONLY by `POST /api/sales` (see `server/salesWebhook.ts`), which the store calls after a
 * payment clears. This is a convenience copy for reporting beside each video — the store's own
 * orders table remains the source of truth, so a lost or duplicated ping costs a report line, not
 * money.
 *
 * `externalOrderId` is UNIQUE: the store is told to include its own order/line id, so a retried
 * or replayed ping is ignored rather than counted twice.
 *
 * `ref` is stored as the raw string the store sent, and `jobId` is the parse of it. An
 * unrecognised ref is KEPT (with a null jobId) rather than dropped, so a mis-tagged link shows up
 * as an unattributed sale instead of silently vanishing.
 */
export const longformSales = mysqlTable("longform_sales", {
  id: int("id").autoincrement().primaryKey(),
  /** The store's own order (or order-line) id. Unique — this is the duplicate guard. */
  externalOrderId: varchar("externalOrderId", { length: 128 })
    .notNull()
    .unique(),
  /** Raw `?ref=` value as sent by the store; kept verbatim even when it doesn't parse. */
  ref: varchar("ref", { length: 64 }),
  /** The video this sale is attributed to, parsed from `ref`. Null = unattributed. */
  jobId: int("jobId"),
  /** The store's product identifier — its SKU/slug/id, matched to a book where possible. */
  productId: varchar("productId", { length: 128 }),
  /** Book this maps to, when `productId` matches a known `shopUrl`/title. Null = unmatched. */
  bookId: int("bookId"),
  /** Integer minor units (cents). Never a float — money is not a floating-point quantity. */
  amountCents: int("amountCents").notNull(),
  currency: varchar("currency", { length: 8 }).default("USD").notNull(),
  /** When the store reported it (our clock, not theirs). */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LongformSale = typeof longformSales.$inferSelect;
export type InsertLongformSale = typeof longformSales.$inferInsert;

/**
 * Channel layers — per-channel prompt layer read via raw SQL in composer.ts
 * (`SELECT * FROM channel_layers WHERE channel_key = ? AND is_active = 1`).
 * Snake_case column names are load-bearing: they must match the raw SQL.
 */
export const channelLayers = mysqlTable("channel_layers", {
  id: int("id").autoincrement().primaryKey(),
  channelKey: varchar("channel_key", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  layerContent: text("layer_content").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ChannelLayerRow = typeof channelLayers.$inferSelect;

/**
 * App settings — key-value store. Holds `longform_instruction_prompt` plus the
 * AES-encrypted provider key slots (`apimart_key_slot_0..4`, `apimart_key_edit`,
 * `heygen_key_slot_0..4`).
 */
export const appSettings = mysqlTable("app_settings", {
  /** Setting key (unique identifier) */
  key: varchar("key", { length: 128 }).primaryKey(),
  /** Setting value (stored as text) */
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

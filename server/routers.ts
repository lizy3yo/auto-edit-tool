import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import {
  adminProcedure,
  approvedProcedure,
  managerProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import { ROLES, ROLE_LABEL, canSeeAllJobs, type Role } from "../shared/roles";
import {
  countActiveAdmins,
  countJobsByUser,
  createUser,
  deleteUser,
  getPublicUserById,
  getUserByEmail,
  getUserByIdWithHash,
  listUsers,
  normalizeEmail,
  updateUser,
} from "./db";
import { invalidateUserCache } from "./_core/sdk";
import {
  MAX_PASSWORD_LENGTH,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./passwords";
import {
  getActiveProvider,
  getAllProviderConfigs,
  upsertProviderConfig,
  updateProviderConnectionStatus,
  setActiveProvider,
  deleteProviderConfig,
  getChannelConfig,
  getAllChannelConfigs,
  upsertChannelConfig,
  createChannelConfig,
  deleteChannelConfig,
  getAppSetting,
  setAppSetting,
  getLongformVideoJobById,
  getActiveLongformVideoJobs,
  getLongformVideoJobHistory,
  getAllLongformVideoJobHistory,
  getLongformLibrary,
  getLongformSlots,
  setLongformSlot,
  deleteLongformVideoJob,
  updateLongformVideoJob,
  getBooks,
  createBook,
  updateBook,
  deactivateBook,
  getChannelAssets,
  createChannelAsset,
  updateChannelAsset,
  deactivateChannelAsset,
  getSalesByJob,
  getSalesByProductForJob,
  getJobsForChannel,
} from "./db";
import {
  createLongformJob,
  runLongformPipeline,
  regenerateScene as regenerateLongformScene,
  regenerateScenes as regenerateLongformScenes,
  getSceneEditState,
  setSceneTiming as setLongformSceneTiming,
  splitSceneInTwo as splitLongformScene,
  undoSceneSplit as undoLongformSceneSplit,
  moveSceneCut as moveLongformSceneCut,
  setScenePieceClipIn as setLongformScenePieceClipIn,
  retrofitSplitScreens as retrofitLongformSplitScreens,
  retrofitBookCover as retrofitLongformBookCover,
  setSceneSplit as setLongformSceneSplit,
  retryJobAssembly,
  sceneFloorSec,
  revertJobTiming,
  rippleTrimScene,
  mergeSceneWithNext,
  unmergeScene,
  revertSceneTimingEdits as revertLongformSceneTiming,
  retryFailedScenes as retryLongformFailedScenes,
  describeIncompleteScenes,
  cancelLongformJob,
  DEFAULT_LONGFORM_INSTRUCTION,
  LONGFORM_INSTRUCTION_KEY,
  LONGFORM_PACING_KEY,
  getLongformPacing,
  LONGFORM_SLOT_COUNT,
  getApimartSlotKey,
  getApimartSlotMasked,
  setApimartSlotKey,
  getApimartEditKey,
  getApimartEditMasked,
  setApimartEditKey,
  getHeygenSlotKey,
  getHeygenSlotMasked,
  setHeygenSlotKey,
  assembleScenePromptPreview,
  syncSceneClipFields,
  parseCtaMarkers,
  extractSpokenScript,
} from "./longformVideo";
// Cut-room pre-checks, so a refused edit is an error the operator reads, not a silent no-op.
import {
  validateTimingEdit,
  validateAddCut,
  validateMoveCut,
  validateSetPieceClipIn,
  validateMergeWithNext,
  validateUnmerge,
  planRippleTrim,
  type Silence,
  cutPoints,
  MAX_TAIL_HOLD_SEC,
  MAX_HEAD_HOLD_SEC,
} from "./sceneTiming";
import { previewBookAssignments, ctaLabelMatches } from "../shared/ctaMarkers";
import {
  buildTrackingUrl,
  stripTrackingParam,
  renderVerifiedQrPng,
} from "./tracking";
import {
  buildVideoTimeline,
  summarizeTimeline,
  SHOT_LABELS,
} from "./videoTimeline";
import { buildVideoDescription } from "./videoDescription";
import { getJobCostBreakdown } from "./costMeter";
import { getMonthlyCostReport } from "./costRollup";
import { ApimartAdapter } from "./providers/apimart";
import { HeygenLipsyncAdapter } from "./providers/heygen-lipsync";
// AIREITER BOLT-ON (temporary) — delete with the router block below.
import {
  AireiterAdapter,
  aireiterKey,
  aireiterKeyMasked,
  aireiterLaneEnabled,
  setAireiterKey,
} from "./providers/aireiter";
import { ENV } from "./_core/env";
import type {
  LongformInputParams,
  LongformCtaBook,
  StoryboardScene,
} from "../shared/types";
import {
  DEFAULT_LONGFORM_PACING,
  MAX_JOB_ASSETS,
  resolveLongformPacing,
} from "../shared/pacing";
import { getChannelLayer } from "./composer";
import { isMockMode, setMockMode } from "./mockMode";
import {
  getLipsyncProvider,
  setLipsyncProvider,
  getLipsyncQuality,
  setLipsyncQuality,
  runpodLipsyncReadiness,
} from "./lipsyncProvider";
import { extractBookName } from "./ctaDetector";
import { createProviderAdapter } from "./providers";
import { rehostToR2 } from "./storage";
import type { ProviderType } from "../shared/types";
import { parseVolumeMultiplier } from "./ttsUnified";
import { encrypt, decrypt, maskApiKey } from "./encryption";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

/** Decrypt a stored provider API key. */
async function getProviderApiKey(provider: any): Promise<string> {
  return decrypt(provider.apiKeyEncrypted!);
}

// ─── Auth Router ───
const authRouter = router({
  me: publicProcedure.query(opts => opts.ctx.user),
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
});

// ─── Provider Router ───
const providerRouter = router({
  list: adminProcedure.query(async () => {
    const configs = await getAllProviderConfigs();
    return configs.map(c => ({
      ...c,
      apiKeyEncrypted: undefined,
      apiKeyMasked: c.apiKeyLast4
        ? maskApiKey("x".repeat(20) + c.apiKeyLast4)
        : null,
    }));
  }),

  getStatus: protectedProcedure.query(async () => {
    const config = await getActiveProvider();
    if (!config) {
      return {
        providerType: null,
        displayName: "No Provider",
        connectionStatus: "disconnected" as const,
      };
    }
    return {
      providerType: config.providerType,
      displayName: config.displayName,
      connectionStatus: config.connectionStatus,
    };
  }),

  getBalance: protectedProcedure.query(async () => {
    const config = await getActiveProvider();
    if (!config || !config.apiKeyEncrypted) return null;

    if (config.providerType === "sixtynine_labs") {
      try {
        const apiKey = await getProviderApiKey(config);
        const { SixtyNineLabsAdapter } =
          await import("./providers/sixtynine-labs");
        const adapter = new SixtyNineLabsAdapter(apiKey);
        const balance = await adapter.getBalance();
        if (!balance) return null;
        return {
          totalQuota:
            balance.monthlyImageUsage.limit + balance.monthlyVideoUsage.limit,
          usedQuota:
            balance.monthlyImageUsage.used + balance.monthlyVideoUsage.used,
          availableQuota:
            balance.monthlyImageUsage.remaining +
            balance.monthlyVideoUsage.remaining,
          earliestExpiry: balance.imageCredits.resetsAt
            ? new Date(balance.imageCredits.resetsAt)
            : null,
          activePackageCount: 1,
          // 69Labs breakdown for provider-aware UI
          dailyImages: balance.imageCredits,
          dailyVideos: balance.videoCredits,
          monthlyImages: balance.monthlyImageUsage,
          monthlyVideos: balance.monthlyVideoUsage,
        };
      } catch {
        return null;
      }
    }

    return null;
  }),

  save: adminProcedure
    .input(
      z.object({
        id: z.number().optional(),
        providerType: z.enum(["sixtynine_labs"]),
        displayName: z.string().min(1),
        apiKey: z.string().optional(),
        isActive: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const data: any = {
        providerType: input.providerType,
        displayName: input.displayName,
        isActive: input.isActive,
        connectionStatus: "untested" as const,
      };

      if (input.id) data.id = input.id;

      if (input.apiKey) {
        data.apiKeyEncrypted = encrypt(input.apiKey);
        data.apiKeyLast4 = input.apiKey.slice(-4);
      }

      await upsertProviderConfig(data);
      return { success: true };
    }),

  setActive: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await setActiveProvider(input.id);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteProviderConfig(input.id);
      return { success: true };
    }),

  testConnection: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const configs = await getAllProviderConfigs();
      const config = configs.find(c => c.id === input.id);
      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Provider not found",
        });
      }

      if (!config.apiKeyEncrypted) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No API key configured",
        });
      }

      const apiKey = await getProviderApiKey(config);
      const adapter = createProviderAdapter(
        config.providerType as ProviderType,
        apiKey
      );

      const result = await adapter.testConnection();

      await updateProviderConnectionStatus(
        input.id,
        result.success ? "connected" : "disconnected"
      );

      return result;
    }),
});

// ─── Channel Config Router ───
// Decimal string in the same 0.7–1.2 band the voiceover path enforces, so a
// junk value like "1MKuq-YN" can never be saved to channel_configs again.
const ttsSpeedInput = z
  .string()
  .refine(
    v => {
      // whole string must be a decimal (parseFloat is too lenient: "1MKuq-YN" → 1)
      if (!/^\d+(\.\d+)?$/.test(v)) return false;
      const n = Number(v);
      return n >= 0.7 && n <= 1.2;
    },
    {
      message:
        "ttsSpeed must be a decimal string between 0.7 and 1.2 (e.g. 0.90)",
    }
  )
  .optional();

// Decimal string in the 0.5–2 volume band (mirrors the 69labs minimax volume
// range); applied as an ffmpeg gain at generation time. 1.0 = neutral.
const ttsVolumeInput = z
  .string()
  .refine(
    v => {
      if (!/^\d+(\.\d+)?$/.test(v)) return false;
      const n = Number(v);
      return n >= 0.5 && n <= 2;
    },
    {
      message:
        "ttsVolume must be a decimal string between 0.5 and 2 (e.g. 1.30)",
    }
  )
  .optional();

const channelConfigRouter = router({
  list: managerProcedure.query(async () => {
    return getAllChannelConfigs();
  }),

  get: managerProcedure
    .input(z.object({ channelKey: z.string() }))
    .query(async ({ input }) => {
      return getChannelConfig(input.channelKey);
    }),

  upsert: managerProcedure
    .input(
      z.object({
        channelKey: z.string(),
        displayName: z.string().optional(),
        personaProfile: z.string().optional(),
        nicheSlug: z.string().optional(),
        authorName: z.string().optional(),
        ctaQrImageUrl: z.string().url().optional(),
        bookCoverImageUrl: z.string().url().optional(),
        hostPhotoUrl: z.string().url().optional(),
        hostPhotoUrl2: z.string().url().optional(),
        hostName: z.string().optional(),
        hostTitle: z.string().optional(),
        hostLocation: z.string().optional(),
        voiceId: z.string().optional(),
        voiceName: z.string().optional(),
        ttsModel: z.string().optional(),
        ttsSpeed: ttsSpeedInput,
        ttsVolume: ttsVolumeInput,
        defaultAngle: z.string().optional(),
        defaultFormat: z.string().optional(),
        defaultWordCount: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { channelKey, ...data } = input;
      await upsertChannelConfig(channelKey, data);
      return { success: true };
    }),

  // Narrow write for operators: only the two voice-tuning fields, editable
  // inline from the Long-form page. Channel-wide, so a change is used for
  // every future generation on that channel.
  setVoiceTuning: approvedProcedure
    .input(
      z.object({
        channelKey: z.string(),
        ttsSpeed: ttsSpeedInput,
        ttsVolume: ttsVolumeInput,
      })
    )
    .mutation(async ({ input }) => {
      const { channelKey, ...data } = input;
      await upsertChannelConfig(channelKey, data);
      return { success: true };
    }),

  create: managerProcedure
    .input(
      z.object({
        displayName: z.string().min(1),
        // Persona is set in the prompt per render, not per channel, so the form no
        // longer collects one. Kept accepted-but-optional rather than deleted so an
        // older client posting the field still creates a channel instead of failing
        // an input validation it can't see.
        personaProfile: z.string().optional(),
        nicheSlug: z.string().min(1),
        authorName: z.string().min(1),
        ctaQrImageUrl: z.string().url().optional(),
        bookCoverImageUrl: z.string().url().optional(),
        hostPhotoUrl: z.string().url().optional(),
        hostPhotoUrl2: z.string().url().optional(),
        hostName: z.string().optional(),
        hostTitle: z.string().optional(),
        hostLocation: z.string().optional(),
        voiceId: z.string().optional(),
        voiceName: z.string().optional(),
        ttsModel: z.string().optional(),
        ttsSpeed: ttsSpeedInput,
        ttsVolume: ttsVolumeInput,
        defaultAngle: z.string().optional(),
        defaultFormat: z.string().optional(),
        defaultWordCount: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const channelKey = input.displayName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      const existing = await getChannelConfig(channelKey);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Channel key "${channelKey}" already exists`,
        });
      }
      const { displayName, personaProfile, nicheSlug, ...rest } = input;
      await createChannelConfig({
        channelKey,
        displayName,
        personaProfile,
        nicheSlug,
        ...rest,
      });
      return { channelKey };
    }),

  delete: managerProcedure
    .input(z.object({ channelKey: z.string() }))
    .mutation(async ({ input }) => {
      await deleteChannelConfig(input.channelKey);
      return { success: true };
    }),

  // Every channel is a channel_configs row created in Admin → Channels; there is no
  // built-in set, so there is nothing to distinguish and nothing undeletable.
  listAllChannels: approvedProcedure.query(async () => {
    const dbConfigs = await getAllChannelConfigs();
    return (
      dbConfigs
        .filter(c => c.displayName)
        // `profile: c.personaProfile` is gone with the setting: no client read it,
        // and shipping every channel's stored persona to the browser on each list
        // fetch outlived the field that produced it.
        .map(c => ({
          key: c.channelKey,
          name: c.displayName!,
          niche: c.nicheSlug ?? "",
        }))
    );
  }),
});

// ─── Shuttle Router (name kept so the copied client code is untouched) ───
const shuttleRouter = router({
  /** Get channel defaults for the longform form */
  channelDefaults: approvedProcedure
    .input(z.object({ channelKey: z.string() }))
    .query(async ({ input }) => {
      const config = await getChannelConfig(input.channelKey);
      return {
        voiceId: config?.voiceId || null,
        voiceName: config?.voiceName || null,
        ttsModel: config?.ttsModel || "eleven_multilingual_v2",
        ttsSpeed: config?.ttsSpeed || null,
        ttsVolume: config?.ttsVolume || null,
        driveFolderId: config?.driveFolderId || null,
        driveFolderName: config?.driveFolderName || null,
        defaultAngle: config?.defaultAngle || null,
        defaultFormat: config?.defaultFormat || null,
        defaultWordCount: config?.defaultWordCount || null,
        hostPhotoUrl: config?.hostPhotoUrl || null,
        hostPhotoUrl2: config?.hostPhotoUrl2 || null,
        // The generate dialog's CTA preview needs to know whether an unmarked script would be
        // REJECTED (the router requires ===CTA=== markers when the channel has a cover/QR) or
        // merely warned about. Just the boolean — the URLs themselves stay server-side.
        hasCtaCoverOrQr: !!(config?.bookCoverImageUrl || config?.ctaQrImageUrl),
      };
    }),
});

// ─── Style Reference Router (image uploads for channel assets) ───
const styleReferenceRouter = router({
  upload: approvedProcedure
    .input(z.object({ dataUrl: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const commaIdx = input.dataUrl.indexOf(",");
      if (commaIdx === -1)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid data URL",
        });
      const header = input.dataUrl.substring(0, commaIdx);
      const base64Data = input.dataUrl.substring(commaIdx + 1);
      const mimeMatch = header.match(/data:([^;]+)/);
      const mimeType = mimeMatch?.[1] ?? "image/jpeg";
      if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unsupported image type. Use JPG, PNG, or WEBP.",
        });
      }
      const ext = mimeType.includes("png")
        ? "png"
        : mimeType.includes("webp")
          ? "webp"
          : "jpg";
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Image must be under 10 MB",
        });
      }
      const fileKey = `style-references/${ctx.user.id}/${nanoid(12)}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, mimeType);
      return { url };
    }),
});

// ─── Books Router (the products a channel's videos pitch) ───
const bookRouter = router({
  /** Books for a channel. `activeOnly` for the video form's picker; Admin sees everything. */
  list: approvedProcedure
    .input(
      z.object({
        channelKey: z.string().min(1),
        activeOnly: z.boolean().default(false),
      })
    )
    .query(async ({ input }) => getBooks(input.channelKey, input.activeOnly)),

  /**
   * Create or update a book. `shopUrl` is validated by building a throwaway tracking link from
   * it — the same function the render uses — so a URL that would silently produce no QR is
   * rejected here, where the operator can see why, rather than at render time.
   */
  save: managerProcedure
    .input(
      z.object({
        id: z.number().optional(),
        channelKey: z.string().min(1),
        title: z.string().min(1).max(255),
        coverImageUrl: z.string().url().max(512).nullish(),
        shopUrl: z.string().max(512).nullish(),
      })
    )
    .mutation(async ({ input }) => {
      const shopUrl = input.shopUrl?.trim() || null;
      if (shopUrl && !buildTrackingUrl(shopUrl, 1)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That shop link isn't a usable web address. Use something like " +
            "https://yourshop.com/the-book",
        });
      }
      const data = {
        channelKey: input.channelKey,
        title: input.title.trim(),
        coverImageUrl: input.coverImageUrl || null,
        // Store the NORMALIZED url (scheme added, tracking param stripped) so what renders is
        // what was validated.
        shopUrl: shopUrl ? stripTrackingParam(shopUrl) : null,
      };
      if (input.id) {
        await updateBook(input.id, data);
        return { id: input.id };
      }
      const id = await createBook({ ...data, isActive: true });
      return { id };
    }),

  /** Soft-delete — finished videos keep resolving the book they sold. */
  deactivate: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deactivateBook(input.id);
      return { success: true };
    }),

  /**
   * Preview a book's plain QR (no video tag), for checking the link is right before any render.
   * Returned as a data URL so the UI shows exactly the bytes the pipeline would generate.
   */
  previewQr: approvedProcedure
    .input(
      z.object({
        shopUrl: z.string().min(1).max(512),
        /**
         * Preview the link and QR a SPECIFIC video would get, rather than the book's plain shop
         * link. The book itself carries no `ref` — the tag identifies a video, and a book does
         * not know which video will pitch it — so without this there is no way to see or test a
         * real tracking link short of paying for a render.
         */
        jobId: z.number().int().positive().max(999_999_999).optional(),
      })
    )
    .query(async ({ input }) => {
      const base = stripTrackingParam(input.shopUrl);
      // With a jobId this is the EXACT link that video would carry; without one it is the plain
      // shop link. Both go through `buildTrackingUrl`, so a URL that would fail at render time
      // fails here instead, where it can be fixed.
      const url = input.jobId ? buildTrackingUrl(base, input.jobId) : base;
      if (!url || !buildTrackingUrl(base, 1)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That shop link isn't a usable web address.",
        });
      }
      const { png, verified, decoded } = await renderVerifiedQrPng(url, 512);
      return {
        url,
        jobId: input.jobId ?? null,
        verified,
        decoded,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      };
    }),

  /**
   * Videos on this channel, for previewing a book's tracking link against a REAL one instead of
   * a made-up number.
   *
   * Videos that ACTUALLY pitched this book come back with the link and QR the pipeline generated
   * for them — those are not previews, they are the published artefacts. Every other video comes
   * back bare, and the caller can preview what its link WOULD be.
   */
  videosForBook: approvedProcedure
    .input(
      z.object({
        channelKey: z.string().min(1),
        bookId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const jobs = await getJobsForChannel(input.channelKey, 50);
      return jobs.map(j => {
        const used = ((j.ctaBooks as LongformCtaBook[] | null) ?? []).find(
          b => input.bookId != null && b.bookId === input.bookId
        );
        return {
          id: j.id,
          title: j.title,
          /** True when this render really pitched the book — its link below is the published one. */
          usedThisBook: !!used,
          trackingUrl: used?.trackingUrl ?? null,
          qrImageUrl: used?.qrImageUrl ?? null,
        };
      });
    }),

  /**
   * How many CTA blocks a script contains, so the video form can ask for one book per block
   * before anything is rendered. Returns a short excerpt of each block for orientation.
   */
  detectCtaBlocks: approvedProcedure
    .input(z.object({ script: z.string().max(50000) }))
    .query(async ({ input }) => {
      const { script, spans, errors } = parseCtaMarkers(
        extractSpokenScript(input.script)
      );
      const words = script.split(/\s+/).filter(Boolean);
      return {
        errors,
        blocks: spans.map((sp, i) => ({
          ctaIndex: i,
          excerpt: words
            .slice(sp.start, Math.min(sp.end, sp.start + 18))
            .join(" "),
        })),
      };
    }),
});

// ─── Channel Asset Router ───
// The channel-level counterpart of the per-job asset upload: images shown verbatim during the
// CTA, configured once per channel and used by every video on it. Same shape as `bookRouter`.
const channelAssetRouter = router({
  /** A channel's assets. `activeOnly` for the generate flow; Admin sees soft-deleted ones too. */
  list: approvedProcedure
    .input(
      z.object({
        channelKey: z.string().min(1),
        activeOnly: z.boolean().default(false),
      })
    )
    .query(async ({ input }) =>
      getChannelAssets(input.channelKey, input.activeOnly)
    ),

  /**
   * Add or update an asset. `imageUrl` is already an R2 URL from `styleReference.upload`, the same
   * upload path the book cover and per-video assets used, so it is validated as a URL and stored
   * as-is.
   */
  save: managerProcedure
    .input(
      z.object({
        id: z.number().optional(),
        channelKey: z.string().min(1),
        imageUrl: z.string().url().max(512),
        caption: z.string().max(200).nullish(),
      })
    )
    .mutation(async ({ input }) => {
      const data = {
        channelKey: input.channelKey,
        imageUrl: input.imageUrl,
        caption: input.caption?.trim() || null,
      };
      if (input.id) {
        await updateChannelAsset(input.id, data);
        return { id: input.id };
      }
      const id = await createChannelAsset({ ...data, isActive: true });
      return { id };
    }),

  /** Soft-delete — finished videos keep the asset they snapshotted at render time. */
  deactivate: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deactivateChannelAsset(input.id);
      return { success: true };
    }),
});

// ─── Long-form Video Router ───
const longformVideoRouter = router({
  /**
   * Priced spend breakdown for one render.
   *
   * Quantities are metered from the real provider calls the job made (`server/costMeter.ts`);
   * rates come from `server/pricing.ts`, where only Anthropic's are exact. Safe to poll while a
   * job is still running — the read flushes buffered usage first, so the figure is current to
   * the second and `inProgress` tells the UI to label it "so far".
   */
  getCostBreakdown: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ input }) => getJobCostBreakdown(input.jobId)),

  /**
   * Monthly provider spend across every render — total, per channel, and per generation, in USD
   * and EUR (`server/costRollup.ts`).
   *
   * `adminProcedure`, not `managerProcedure`: this is the company's spend across all accounts,
   * which sits with the provider keys rather than with the people directing renders. The Admin
   * page hides the tab on the same rule.
   */
  getMonthlyCostReport: adminProcedure
    .input(z.object({ months: z.number().int().min(1).max(36) }).optional())
    .query(async ({ input }) =>
      getMonthlyCostReport({ months: input?.months })
    ),

  /** Admin: read the saved directing instruction (falls back to the default). */
  getInstructionPrompt: managerProcedure.query(async () => {
    const saved = await getAppSetting(LONGFORM_INSTRUCTION_KEY);
    return {
      content: saved ?? DEFAULT_LONGFORM_INSTRUCTION,
      isDefault: saved == null,
      default: DEFAULT_LONGFORM_INSTRUCTION,
    };
  }),

  /** Admin: save the directing instruction applied to every long-form session. */
  setInstructionPrompt: managerProcedure
    .input(z.object({ content: z.string().min(1).max(20000) }))
    .mutation(async ({ input }) => {
      await setAppSetting(LONGFORM_INSTRUCTION_KEY, input.content);
      return { success: true };
    }),

  /**
   * Everything needed to publish one finished render: where each kind of shot lands, the
   * paste-ready description, the tracking links, and the QR codes actually generated.
   *
   * Read-only and derived — nothing here is persisted, so it always reflects the current
   * storyboard rather than a stale copy taken at render time.
   */
  getPublishKit: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your job" });
      }
      const params = (job.inputParams ?? {}) as LongformInputParams;
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const timeline = buildVideoTimeline(scenes);
      return {
        jobId: job.id,
        title: params.title ?? null,
        youtubeUrl: job.youtubeUrl ?? null,
        timeline,
        summary: summarizeTimeline(timeline),
        labels: SHOT_LABELS,
        books: (params.ctaBooks ?? []).map(b => ({
          ctaIndex: b.ctaIndex,
          bookId: b.bookId,
          title: b.title,
          trackingUrl: b.trackingUrl ?? null,
          qrImageUrl: b.qrImageUrl ?? null,
          qrVerified: b.qrVerified ?? null,
        })),
        description: buildVideoDescription({
          title: params.title,
          ctaBooks: params.ctaBooks,
          timeline,
        }),
      };
    }),

  /**
   * Store the YouTube URL this render was published to. Nothing in the pipeline reads it — it
   * exists so a sales report reads by title instead of by job id. Blank clears it.
   */
  setYoutubeUrl: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        youtubeUrl: z.string().max(512),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your job" });
      }
      const trimmed = input.youtubeUrl.trim();
      if (trimmed && !/^https?:\/\/\S+$/i.test(trimmed)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paste the full YouTube URL, starting with https://",
        });
      }
      await updateLongformVideoJob(input.jobId, {
        youtubeUrl: trimmed || null,
      });
      return { youtubeUrl: trimmed || null };
    }),

  /** Reported sales for one video, split by the product the store named. */
  getSales: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your job" });
      }
      const byProduct = await getSalesByProductForJob(input.jobId);
      return {
        byProduct,
        sales: byProduct.reduce((t, r) => t + r.sales, 0),
        revenueCents: byProduct.reduce((t, r) => t + r.revenueCents, 0),
      };
    }),

  /**
   * The pacing dials (visual mix, split screen, fast open, captions) — see `shared/pacing.ts`.
   * Readable by any approved user so the job form can show what a render will do; only an admin
   * can change them.
   */
  getPacing: approvedProcedure.query(async () => ({
    pacing: await getLongformPacing(),
    defaults: DEFAULT_LONGFORM_PACING,
  })),

  /**
   * Admin: save the pacing dials. The payload is re-resolved through `resolveLongformPacing`
   * before it is stored, so what lands in `app_settings` is always complete and in-bounds — a
   * hand-crafted request cannot write a config the balancers would then have to defend against.
   * In-flight jobs are unaffected: each snapshots its own pacing at render start.
   */
  setPacing: managerProcedure
    .input(z.object({ pacing: z.unknown() }))
    .mutation(async ({ input }) => {
      const resolved = resolveLongformPacing(input.pacing);
      await setAppSetting(LONGFORM_PACING_KEY, JSON.stringify(resolved));
      return { pacing: resolved };
    }),

  /** Admin: read the masked per-tab APIMART keys (slots 0–4) + the edit-pages key, null where unset. */
  /**
   * Mock mode — every paid provider lane replaced by a locally generated stand-in.
   * Readable by any approved user (the Longform page shows a banner so nobody mistakes a
   * mock render for a real one); only an admin can flip it.
   */
  getMockMode: approvedProcedure.query(async () => ({
    enabled: await isMockMode(),
  })),

  setMockMode: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await setMockMode(input.enabled);
      return { enabled: input.enabled };
    }),

  /**
   * Which vendor renders host scenes, and (RunPod only) at which quality tier. Returns the
   * RunPod readiness flags alongside, so the Admin UI can name what is missing instead of
   * offering a switch the pipeline would silently ignore — `resolveLipsyncLane` falls back
   * to HeyGen when the endpoint or key is absent.
   */
  getLipsyncProvider: adminProcedure.query(async () => {
    const [provider, quality] = await Promise.all([
      getLipsyncProvider(),
      getLipsyncQuality(),
    ]);
    return { provider, quality, runpod: runpodLipsyncReadiness() };
  }),

  setLipsyncProvider: adminProcedure
    .input(z.object({ provider: z.enum(["heygen", "runpod"]) }))
    .mutation(async ({ input }) => {
      // Refuse rather than accept a setting the pipeline would ignore: silently writing
      // "runpod" while every render kept going to HeyGen is the confusing failure here.
      if (input.provider === "runpod" && !runpodLipsyncReadiness().ready) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "RunPod InfiniteTalk is not configured — set RUNPOD_INFINITETALK_ENDPOINT and RUN_POD_KEY first.",
        });
      }
      await setLipsyncProvider(input.provider);
      return { provider: input.provider };
    }),

  setLipsyncQuality: adminProcedure
    .input(z.object({ quality: z.enum(["fast", "full"]) }))
    .mutation(async ({ input }) => {
      await setLipsyncQuality(input.quality);
      return { quality: input.quality };
    }),

  getApimartKeys: adminProcedure.query(async () => {
    const [slots, editMasked] = await Promise.all([
      Promise.all(
        Array.from({ length: LONGFORM_SLOT_COUNT }, (_, slotIndex) =>
          getApimartSlotMasked(slotIndex).then(masked => ({
            slotIndex,
            masked,
          }))
        )
      ),
      getApimartEditMasked(),
    ]);
    return { slots, editMasked };
  }),

  /** Admin: live balance per stored APIMART key (free endpoint). Null balance = unset key OR failed check. */
  getApimartBalances: adminProcedure.query(async () => {
    const balanceFor = async (key: string | null) =>
      key ? new ApimartAdapter(key).getBalance() : null;
    const [slots, edit] = await Promise.all([
      Promise.all(
        Array.from({ length: LONGFORM_SLOT_COUNT }, (_, slotIndex) =>
          getApimartSlotKey(slotIndex)
            .then(balanceFor)
            .then(balance => ({ slotIndex, balance }))
        )
      ),
      getApimartEditKey().then(balanceFor),
    ]);
    return { slots, edit };
  }),

  /** Admin: set (or clear, with an empty string) a tab's APIMART key. */
  setApimartKey: adminProcedure
    .input(
      z.object({
        slotIndex: z
          .number()
          .int()
          .min(0)
          .max(LONGFORM_SLOT_COUNT - 1),
        apiKey: z.string().max(400),
      })
    )
    .mutation(async ({ input }) => {
      await setApimartSlotKey(input.slotIndex, input.apiKey);
      return { success: true };
    }),

  /** Admin: set (or clear, with an empty string) the Edit Images/Videos pages' APIMART key. */
  setApimartEditKey: adminProcedure
    .input(z.object({ apiKey: z.string().max(400) }))
    .mutation(async ({ input }) => {
      await setApimartEditKey(input.apiKey);
      return { success: true };
    }),

  /** Admin: read the masked per-tab HeyGen keys (slots 0–4), null where unset. */
  getHeygenKeys: adminProcedure.query(async () => {
    const slots = await Promise.all(
      Array.from({ length: LONGFORM_SLOT_COUNT }, (_, slotIndex) =>
        getHeygenSlotMasked(slotIndex).then(masked => ({ slotIndex, masked }))
      )
    );
    return { slots };
  }),

  /** Admin: remaining credits per stored HeyGen key. Null = unset key OR failed check. */
  getHeygenQuotas: adminProcedure.query(async () => {
    const slots = await Promise.all(
      Array.from({ length: LONGFORM_SLOT_COUNT }, (_, slotIndex) =>
        getHeygenSlotKey(slotIndex)
          .then(key =>
            key ? new HeygenLipsyncAdapter(key).getRemainingQuota() : null
          )
          .then(quota => ({ slotIndex, quota }))
      )
    );
    return { slots };
  }),

  /** Admin: set (or clear, with an empty string) a tab's HeyGen key. */
  setHeygenKey: adminProcedure
    .input(
      z.object({
        slotIndex: z
          .number()
          .int()
          .min(0)
          .max(LONGFORM_SLOT_COUNT - 1),
        apiKey: z.string().max(400),
      })
    )
    .mutation(async ({ input }) => {
      await setHeygenSlotKey(input.slotIndex, input.apiKey);
      return { success: true };
    }),

  // ─── AIREITER BOLT-ON (temporary — delete this block to remove) ─────────
  /**
   * Admin: the AIReiter key, its live credit balance, and which lanes it is serving.
   * One key for all 5 tabs, unlike APIMART/HeyGen — AIReiter is a single account with one
   * shared credit pool, so per-tab slots would buy nothing.
   */
  getAireiter: adminProcedure.query(async () => {
    const masked = await aireiterKeyMasked();
    const lanes = {
      broll: await aireiterLaneEnabled("broll"),
      stills: await aireiterLaneEnabled("stills"),
    };
    return {
      masked,
      lanes,
      // Env fallback in play (key set via AIREITER_API_KEY rather than this field).
      usingEnvKey: !masked && !!(await aireiterKey()),
    };
  }),

  /** Admin: live credit balance for the AIReiter key. Null = unset key or failed check. */
  getAireiterBalance: adminProcedure.query(async () => ({
    credits: await (await AireiterAdapter.resolve()).getBalance(),
  })),

  /** Admin: set (or clear, with an empty string) the AIReiter key. */
  setAireiterKey: adminProcedure
    .input(z.object({ apiKey: z.string().max(400) }))
    .mutation(async ({ input }) => {
      await setAireiterKey(input.apiKey);
      return { success: true };
    }),
  // ─── END AIREITER BOLT-ON ───────────────────────────────────────────────

  /** Kick off a long-form video job — returns the job id immediately. */
  generate: approvedProcedure
    .input(
      z.object({
        script: z.string().min(1).max(50000),
        channelKey: z.string().min(1),
        title: z.string().max(255).optional(),
        /** Which long-form tab (slot 0–4) launched this — picks the per-tab APIMART video key. */
        slotIndex: z
          .number()
          .int()
          .min(0)
          .max(LONGFORM_SLOT_COUNT - 1)
          .optional(),
        /**
         * Operator-supplied images shown verbatim inside the CTA pitch (`placeAssetBeats`) —
         * uploaded through `styleReference.upload`, so these are already our own R2 URLs. Capped
         * at `MAX_JOB_ASSETS`: the pitch has only so many person-free beats to place them on, and
         * anything beyond that would be silently dropped.
         */
        assets: z
          .array(
            z.object({
              url: z.string().url(),
              caption: z.string().max(200).optional(),
            })
          )
          .max(MAX_JOB_ASSETS)
          .optional(),
        /**
         * Books this video pitches — uploaded on the generate form, NOT assigned to a block. The
         * operator "calls" a book by naming it in the script's CTA text, and the server places
         * each one on the CTA block whose text matches its title (see the title-match below), so
         * there is no per-block picker. Snapshotted onto the job; `saveToChannel` also persists it
         * as a reusable channel book. Blocks that match no book fall back to the channel cover/QR.
         */
        ctaBooks: z
          .array(
            z.object({
              title: z.string().min(1).max(255),
              coverImageUrl: z.string().url().max(512).optional(),
              shopUrl: z.string().max(512).optional(),
              saveToChannel: z.boolean().optional(),
            })
          )
          .max(32)
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = await getActiveProvider();
      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No active provider configured",
        });
      }

      const channelConfig = await getChannelConfig(input.channelKey);
      if (!channelConfig?.voiceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No voice configured for this channel. Configure it in Admin → Channels.",
        });
      }

      // Explicit CTA markers are the ground truth for CTA/book-cover placement. Malformed
      // pairing is always rejected; a channel with a cover/QR configured REQUIRES at least
      // one marked block (the script template wraps both the mid-roll and the close).
      //
      // `parseCtaMarkers` (not `validateCtaMarkers`) because the placement match below needs the
      // spoken block TEXT, which only this returns. `spans` are word-index ranges into `script`,
      // and their order is the `ctaIndex` the pipeline keys scenes off — the same derivation the
      // book form's `detectCtaBlocks` used, so the indices line up.
      const ctaMarkers = parseCtaMarkers(extractSpokenScript(input.script));
      const ctaBlockWords = ctaMarkers.script.split(/\s+/).filter(Boolean);
      if (ctaMarkers.errors.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `CTA marker error: ${ctaMarkers.errors.join("; ")}`,
        });
      }
      // A book assignment is keyed by BLOCK INDEX, so assigning one to a script with no marked
      // blocks would silently do nothing. Reject it here rather than render a film that quietly
      // ignored the operator's choice.
      if (
        (channelConfig.bookCoverImageUrl ||
          channelConfig.ctaQrImageUrl ||
          input.ctaBooks?.length) &&
        ctaMarkers.spans.length === 0
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This channel has a book cover/QR configured — wrap each CTA block " +
            "in ===START CTA=== / ===END CTA=== lines (they are stripped before voicing).",
        });
      }
      if (ctaMarkers.spans.length === 1) {
        console.warn(
          "[longform] script has only 1 marked CTA block (expected mid-roll + close)"
        );
      }

      let ttsSpeed: number | undefined;
      if (channelConfig.ttsSpeed && channelConfig.ttsSpeed !== "NULL") {
        const parsedSpeed = parseFloat(channelConfig.ttsSpeed);
        if (!isNaN(parsedSpeed) && parsedSpeed >= 0.7 && parsedSpeed <= 1.2) {
          ttsSpeed = parsedSpeed;
        }
      }
      const ttsVolume = parseVolumeMultiplier(channelConfig.ttsVolume);

      // Book title for the in-CTA cover reveal — extracted from the channel layer's CTA
      // strategy section. Only needed when a cover image is configured; failure → no cover beat.
      let bookTitle: string | undefined;
      if (channelConfig.bookCoverImageUrl) {
        const layer = await getChannelLayer(input.channelKey);
        bookTitle = layer
          ? (extractBookName(layer.layerContent) ?? undefined)
          : undefined;
      }

      // Rehost external reference images onto R2 up front so APIMART (and our gpt-image editor)
      // only ever fetch our CDN — an external/slow/bad-cert host in the channel config otherwise
      // fails every host/book scene at render time. face + cover fail fast (they're required refs);
      // QR is non-fatal (videoAssembly treats a missing QR as a no-op), so drop it on failure.
      const faceImageUrl = channelConfig.hostPhotoUrl
        ? await rehostToR2(channelConfig.hostPhotoUrl, "face")
        : undefined;
      // Optional alt-angle host photo — never fail the job if it's missing/bad, just fall back
      // to single-angle (the whole feature is a nice-to-have on top of the primary face).
      const faceImageUrl2 = channelConfig.hostPhotoUrl2
        ? await rehostToR2(channelConfig.hostPhotoUrl2, "face").catch(
            () => undefined
          )
        : undefined;
      const bookCoverImageUrl = channelConfig.bookCoverImageUrl
        ? await rehostToR2(channelConfig.bookCoverImageUrl, "cover")
        : undefined;
      let qrImageUrl: string | undefined;
      if (channelConfig.ctaQrImageUrl) {
        try {
          qrImageUrl = await rehostToR2(channelConfig.ctaQrImageUrl, "qr");
        } catch (err) {
          console.warn(
            "[longform] QR rehost failed, continuing without QR:",
            err
          );
        }
      }

      // CTA assets now come from the CHANNEL, not this request: they are configured once in
      // Admin → Channels and every video on the channel uses all of them, the same way books
      // live on the channel. `input.assets` is still accepted by the schema so an older client
      // mid-deploy doesn't 400, but it is deliberately ignored — the channel is the source.
      //
      // Snapshotted onto the job below exactly as an upload was, so the pipeline
      // (`placeAssetBeats`) is unchanged and a finished film keeps the assets it shipped with
      // even after the channel's list is edited. Rehosted (non-fatal, same as the QR): a bad
      // asset is skipped with a log line rather than failing the render. Capped at
      // MAX_JOB_ASSETS — the pitch has only so many person-free beats to place them on.
      const channelAssetRows = await getChannelAssets(input.channelKey, true);
      const assets: { url: string; caption?: string }[] = [];
      for (const a of channelAssetRows.slice(0, MAX_JOB_ASSETS)) {
        try {
          assets.push({
            url: await rehostToR2(a.imageUrl, "asset"),
            caption: a.caption?.trim() || undefined,
          });
        } catch (err) {
          console.warn("[longform] asset rehost failed, skipping it:", err);
        }
      }

      // Snapshot each assigned book onto the job — a resume or regenerate months later must
      // reproduce the film that shipped, even if the book has since been renamed or re-priced.
      // A book that no longer exists, or belongs to another channel, is dropped rather than
      // failing the render: that block falls back to the channel cover/QR.
      const inputBooks = input.ctaBooks ?? [];

      // A shop link is validated up front so a typo fails here (operator present) not
      // mid-render. Book→block placement itself happens below via previewBookAssignments.
      for (const b of inputBooks) {
        const shop = b.shopUrl?.trim() || undefined;
        if (shop && !buildTrackingUrl(shop, 1)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              `The shop link on "${b.title}" isn't a usable web address. Fix it or clear it ` +
              "(a book with no link still shows its cover).",
          });
        }
      }

      // "Also save to this channel" — persist a reusable channel book, de-duped by title so
      // repeated renders don't pile up copies. Independent of placement below.
      if (inputBooks.some(b => b.saveToChannel)) {
        const existing = await getBooks(input.channelKey, false);
        const already = (t: string) =>
          existing.some(
            e => e.title.trim().toLowerCase() === t.trim().toLowerCase()
          );
        for (const b of inputBooks) {
          if (!b.saveToChannel || already(b.title)) continue;
          const shop = b.shopUrl?.trim() || null;
          await createBook({
            channelKey: input.channelKey,
            title: b.title.trim(),
            coverImageUrl: b.coverImageUrl ?? null,
            shopUrl: shop ? stripTrackingParam(shop) : null,
            isActive: true,
          });
        }
      }

      // Place a book on each CTA block. Priority: the book the block NAMES (title match) →
      // otherwise the book at this block's position → otherwise, when only one was uploaded, that
      // one for every block. So an uploaded book is never silently dropped just because its title
      // doesn't appear word-for-word in the script; a block that still resolves nothing uses the
      // channel cover/QR. `markCoverReveal` reveals an assigned-but-unnamed book on the block's
      // first beat, so the cover shows either way.
      //
      // `bookId: 0` marks a snapshot with no channel row behind it (a book that was ALSO saved to
      // the channel is still snapshotted from the upload, so a later channel edit can't change a
      // film that already shipped). Covers are rehosted once each, cached across blocks that
      // share a book, so the render only fetches our own CDN.
      const coverCache = new Map<string, string | undefined>();
      const rehostCover = async (url?: string) => {
        if (!url) return undefined;
        if (!coverCache.has(url)) {
          coverCache.set(url, await rehostToR2(url, "cover").catch(() => url));
        }
        return coverCache.get(url);
      };
      // The placement rule lives in shared/ctaMarkers.ts (previewBookAssignments) — the same
      // function the generate dialog previews with: a block's `===START CTA (name)===` label
      // first, then the spoken-title match, then order / single-book fallbacks.
      //
      // AUTO-ADD: every book saved on the channel is a candidate too, no picking required —
      // but as `requiresCall`, so it places itself ONLY on a block that calls it (marker name
      // or spoken title), never by position. The video's own rows are listed first, so a
      // manual row always beats a channel book with the same name, and a channel duplicate of
      // a manual row is dropped up front.
      const channelBookRows = (await getBooks(input.channelKey, true)).filter(
        row => !inputBooks.some(x => ctaLabelMatches(x.title, row.title))
      );
      const assignments = previewBookAssignments(
        ctaMarkers.spans.map(sp => ({
          text: ctaBlockWords.slice(sp.start, sp.end).join(" "),
          label: sp.label,
        })),
        [
          ...inputBooks.map(x => ({ title: x.title })),
          ...channelBookRows.map(r => ({ title: r.title, requiresCall: true })),
        ]
      );
      const ctaBooks: LongformCtaBook[] = [];
      for (let i = 0; i < ctaMarkers.spans.length; i++) {
        const idx = assignments[i].bookIndex;
        if (idx == null) continue;
        const manual = idx < inputBooks.length ? inputBooks[idx] : undefined;
        const row = manual
          ? undefined
          : channelBookRows[idx - inputBooks.length];
        const shop = (manual?.shopUrl ?? row?.shopUrl ?? undefined)?.trim();
        ctaBooks.push({
          ctaIndex: i,
          // A real row id marks the channel as the source; 0 stays the per-video marker.
          bookId: row?.id ?? 0,
          title: (manual?.title ?? row!.title).trim(),
          coverImageUrl: await rehostCover(
            manual?.coverImageUrl ?? row?.coverImageUrl ?? undefined
          ),
          shopUrl: shop ? stripTrackingParam(shop) : undefined,
        });
      }

      const params: LongformInputParams = {
        script: input.script,
        lockMode: "ingredients",
        // Host images are configured per channel (Admin → Channels), not per job.
        faceImageUrl,
        faceImageUrl2,
        // On-screen lower third for the host, drawn once on the 2nd host shot. Plain strings —
        // nothing to rehost. All three blank → no card.
        hostName: channelConfig.hostName ?? undefined,
        hostTitle: channelConfig.hostTitle ?? undefined,
        hostLocation: channelConfig.hostLocation ?? undefined,
        channelKey: input.channelKey,
        voiceId: channelConfig.voiceId,
        ttsModel: channelConfig.ttsModel || "eleven_multilingual_v2",
        ttsSpeed,
        ttsVolume,
        // QR overlaid on CTA scenes; resolved from the channel config (saved once in Admin).
        qrImageUrl,
        // Book cover revealed full-frame at the first in-CTA title mention (no-op without both).
        bookCoverImageUrl,
        bookTitle,
        title: input.title?.trim() || undefined,
        apimartSlot: input.slotIndex,
        // Uploaded images shown verbatim in the CTA pitch. Rehosted like every other reference so
        // the render only ever fetches our own CDN; an asset that can't be rehosted is DROPPED
        // rather than failing the job — the film is still correct without it, and the pipeline
        // warns when it places fewer assets than were supplied.
        assets: assets.length ? assets : undefined,
        // Per-CTA-block books. Empty ⇒ the channel's single cover/QR, i.e. the pre-books film.
        ctaBooks: ctaBooks.length ? ctaBooks : undefined,
      };

      const jobId = await createLongformJob(
        ctx.user.id,
        ctx.user.name || "Unknown",
        params
      );
      if (!jobId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create long-form video job",
        });
      }

      runLongformPipeline(jobId).catch(err => {
        console.error("[Longform] Background pipeline failed:", err);
      });

      return { jobId };
    }),

  /** Poll a job's progress. */
  pollJob: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Sampled BEFORE the row read so the two can only disagree in the harmless direction:
      // a session that settles between them reads "editing + (processing|completed)", never
      // "not editing + processing" — which the client would show as a pipeline render for one
      // poll cycle (editors gone, Cancel shown).
      const sceneEdits = getSceneEditState(input.jobId);
      const job = await getLongformVideoJobById(input.jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      // Attach the exact assembled provider prompts per scene (read-only preview) so the UI
      // can show what actually ships to grok-imagine-video / gpt-image-2 before a regen spends
      // credits. Pure string assembly, guarded per scene inside the helper.
      const previewParams = (job.inputParams ?? {}) as LongformInputParams;
      const rawScenes = job.storyboard as StoryboardScene[] | null;
      const storyboard: StoryboardScene[] | null = Array.isArray(rawScenes)
        ? rawScenes.map(scene =>
            syncSceneClipFields({
              ...scene,
              // The on-screen floor, derived when the storyboard predates the field. `floorFor`
              // needs the channel's pacing, so the browser cannot work it out — and without it
              // the live preview would hold every scene that pause-snapping left with a measured
              // narration longer than its slice, which the rendered film no longer does.
              minHoldSec:
                scene.minHoldSec ??
                (scene.coverHero
                  ? undefined
                  : sceneFloorSec(scene, previewParams)),
              ...assembleScenePromptPreview(scene, previewParams),
            })
          )
        : rawScenes;
      return {
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        storyboard,
        // The job's live scene-edit queue (which scenes wait / render right now). Lets every
        // tab — and a reloaded one — show per-scene state, and lets the client tell "the
        // operator is editing scenes" apart from "the pipeline is rendering": both read
        // status "processing" on the row.
        sceneEdits,
        // The continuous master narration — the cut-room preview plays the exact slice under a
        // scene (seeking into this) so a moved cut previews with the right words, where the
        // per-scene `audioUrl` slice was cut at the ORIGINAL boundaries.
        masterAudioUrl: job.masterAudioUrl ?? null,
        finalVideoUrl: job.finalVideoUrl,
        errorMessage: job.errorMessage,
        channelKey:
          (job.inputParams as { channelKey?: string } | null)?.channelKey ??
          null,
        title: (job.inputParams as { title?: string } | null)?.title ?? null,
        // The script this job was actually generated from. `channelKey` and `title` were
        // already carried out of `inputParams` for exactly this reason — the script was the
        // one field left behind, so a restored tab showed the storyboard of one script beside
        // the text of another.
        script: (job.inputParams as { script?: string } | null)?.script ?? null,
        // The books this job pitched, so a restored tab shows them in the uploader instead of a
        // blank list — the same reason `script` is carried. The snapshot has one entry per CTA
        // block, so a book used on two blocks appears twice; the client de-dupes by title.
        ctaBooks:
          (job.inputParams as { ctaBooks?: LongformCtaBook[] } | null)
            ?.ctaBooks ?? null,
        // Whether a book-cover reveal is even possible for this job — gates the "Add book
        // cover" retrofit button (per-video books above already gate it via ctaBooks).
        bookCoverImageUrl:
          (job.inputParams as { bookCoverImageUrl?: string } | null)
            ?.bookCoverImageUrl ?? null,
        visualStyleBible:
          (job.inputParams as { visualStyleBible?: string } | null)
            ?.visualStyleBible ?? null,
      };
    }),

  /** Current user's active (processing) jobs — for auto-resume on reload. */
  myActiveJobs: approvedProcedure.query(async ({ ctx }) => {
    return getActiveLongformVideoJobs(ctx.user.id);
  }),

  /**
   * This account's five tabs — which job each holds and its draft title.
   *
   * Server-side so the workspace follows the account rather than the browser: sign in on
   * another machine and the same tabs come back. Always returns exactly
   * `LONGFORM_SLOT_COUNT` entries; absent rows are empty tabs.
   */
  getSlots: approvedProcedure.query(async ({ ctx }) => {
    const rows = await getLongformSlots(ctx.user.id);
    const byIndex = new Map(rows.map(r => [r.slotIndex, r]));
    return Array.from({ length: LONGFORM_SLOT_COUNT }, (_, slotIndex) => ({
      slotIndex,
      jobId: byIndex.get(slotIndex)?.jobId ?? null,
      draftTitle: byIndex.get(slotIndex)?.draftTitle ?? "",
    }));
  }),

  /** Persist one tab. Omitted fields are left as they are; null clears. */
  setSlot: approvedProcedure
    .input(
      z.object({
        slotIndex: z
          .number()
          .int()
          .min(0)
          .max(LONGFORM_SLOT_COUNT - 1),
        jobId: z.number().int().nullable().optional(),
        draftTitle: z.string().max(255).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { slotIndex, ...patch } = input;
      await setLongformSlot(ctx.user.id, slotIndex, patch);
      return { success: true };
    }),

  /**
   * Every job for the side panel and the Library page — processing included, so a render in
   * flight is visible while it runs. Admins and operations managers see every account's, matching
   * `allJobHistory`; editors see their own.
   */
  library: approvedProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(500).optional() })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const rows = await getLongformLibrary(ctx.user.id, {
        allUsers: canSeeAllJobs(ctx.user.role),
        limit: input?.limit,
      });
      // Attach reported sales so the library answers "which video earns?" at a glance. One
      // grouped query for the whole page, not one per row.
      const sales = await getSalesByJob(rows.map(r => r.id)).catch(
        () => new Map<number, { sales: number; revenueCents: number }>()
      );
      return rows.map(r => ({
        ...r,
        sales: sales.get(r.id)?.sales ?? 0,
        revenueCents: sales.get(r.id)?.revenueCents ?? 0,
      }));
    }),

  /** Current user's finished (completed/failed) jobs — for the history panel. */
  myJobHistory: approvedProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(100).optional() })
        .optional()
    )
    .query(async ({ ctx, input }) =>
      getLongformVideoJobHistory(ctx.user.id, input?.limit ?? 50)
    ),

  /** Oversight (admin / operations manager): every account's finished jobs, with the maker's name. */
  allJobHistory: managerProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(200).optional() })
        .optional()
    )
    .query(async ({ input }) =>
      getAllLongformVideoJobHistory(input?.limit ?? 100)
    ),

  /** Regenerate a single scene's clip and re-stitch the film. */
  regenerateScene: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        sceneIndex: z.number().int().min(1),
        customVisualPrompt: z.string().optional(),
        // Split scenes own `splitVisual`, not `visualPrompt` — the host half is reused as-is.
        customSplitVisual: z.string().optional(),
        // Operator edited the prompt — render it exactly as typed (skip re-enhance).
        verbatim: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      if (!hasScene(job.storyboard, input.sceneIndex))
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Scene ${input.sceneIndex} not found`,
        });
      // Queues on the job's edit session and returns at once; the render runs in the
      // background, concurrently with any other queued scene. `accepted` tells the client
      // whether it was queued, replaced an unstarted request, or was ignored because that
      // scene is rendering right now.
      const accepted = await regenerateLongformScene(
        input.jobId,
        input.sceneIndex,
        input.customVisualPrompt,
        input.verbatim,
        input.customSplitVisual
      );
      return { ok: true, accepted };
    }),

  /** Batch-regenerate a multi-selected set of scenes (re-render each, assemble once). */
  regenerateScenes: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        sceneIndices: z.array(z.number().int().min(1)).min(1),
        prompts: z
          .array(
            z.object({
              index: z.number().int().min(1),
              visualPrompt: z.string().optional(),
              splitVisual: z.string().optional(),
            })
          )
          .optional(),
        // Scenes whose prompt the operator edited — render exactly as typed (skip re-enhance).
        verbatimIndices: z.array(z.number().int().min(1)).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      const known = input.sceneIndices.filter(i => hasScene(job.storyboard, i));
      if (!known.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "None of the selected scenes exist on this job",
        });
      const accepted = await regenerateLongformScenes(
        input.jobId,
        known,
        input.prompts,
        input.verbatimIndices
      );
      return { ok: true, accepted };
    }),

  /**
   * Add split screens to an already-rendered film whose pacing snapshot predates the operator's
   * split settings. Right panels only — every lip-synced host clip is reused as the left half.
   * Render-only like batch regeneration: preview the new panels, then Assemble.
   */
  retrofitSplitScreens: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.status === "processing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Job is still processing — wait for it to settle first",
        });
      }
      retrofitLongformSplitScreens(input.jobId).catch(err => {
        console.error(
          `[Longform ${input.jobId}] retrofitSplitScreens error:`,
          err
        );
      });
      return { ok: true };
    }),

  /**
   * Add a book-cover reveal to an already-rendered film whose storyboard has none — the book
   * cover counterpart to `retrofitSplitScreens`. Costs nothing (literal cover image, no
   * generation). Falls back to the channel's live Books library when the job's own snapshot has
   * none — a manual click here counts as "calling" an otherwise-uncalled channel book, unlike
   * generation itself. Render-only: preview the new cover, then Assemble.
   */
  retrofitBookCover: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.status === "processing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Job is still processing — wait for it to settle first",
        });
      }
      const channelKey = (job.inputParams as { channelKey?: string } | null)
        ?.channelKey;
      const channelBooks = channelKey ? await getBooks(channelKey, true) : [];
      retrofitLongformBookCover(input.jobId, channelBooks).catch(err => {
        console.error(
          `[Longform ${input.jobId}] retrofitBookCover error:`,
          err
        );
      });
      return { ok: true };
    }),

  /**
   * Split editor: edit one host scene's split state on a rendered job. The lip-synced host
   * half is always reused; only the right panel changes. `off` un-splits (free), `prompt`
   * renders a fresh panel from text (one still), `scene` reuses another scene's footage as
   * the panel (free — ffmpeg only), `layout` repositions the composite — host side, seam,
   * per-panel pan — from the operator's drag (free — ffmpeg only, and a manual host position
   * skips the face-detection calls). Render-only: preview, then Assemble.
   */
  /**
   * Cut room: change WHEN a scene's picture shows — trim its clip, move the cut with a
   * neighbour, hold its last frame — without re-rendering or re-voicing anything. Persists on
   * the scene (via the job's edit session) and marks it `timingEdited`; the operator re-stitches
   * with Reassemble when done. Validated against the stored storyboard first so a refused edit
   * comes back as an error with the reason.
   */
  setSceneTiming: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        sceneIndex: z.number().int().min(1),
        clipInSec: z.number().min(0).optional(),
        startSec: z.number().min(0).optional(),
        endSec: z.number().min(0).optional(),
        tailHoldSec: z.number().min(0).max(MAX_TAIL_HOLD_SEC).optional(),
        headHoldSec: z.number().min(0).max(MAX_HEAD_HOLD_SEC).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const { jobId, ...edit } = input;
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const v = validateTimingEdit(scenes, edit);
      if (!v.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: v.reason });
      const accepted = await setLongformSceneTiming(jobId, edit);
      return { ok: true, accepted };
    }),

  /**
   * Cut room: split one scene into two at an offset into its slice. The second half keeps the
   * same footage, continuing seamlessly, until it is regenerated. Scenes renumber.
   */
  splitScene: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        sceneIndex: z.number().int().min(1),
        atOffsetSec: z.number().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const v = validateAddCut(scenes, input.sceneIndex, input.atOffsetSec);
      if (!v.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: v.reason });
      const live = getSceneEditState(input.jobId);
      if (live.active.length || live.queued.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Can't cut while scenes are rendering or queued — wait for them to finish",
        });
      const accepted = await splitLongformScene(
        input.jobId,
        input.sceneIndex,
        input.atOffsetSec
      );
      return { ok: true, accepted };
    }),

  /**
   * Cut room: undo a split — rejoin the group containing this scene back into one. Reverses
   * `splitScene`; metadata only, no render.
   */
  undoSplit: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        sceneIndex: z.number().int().min(1),
        // Remove the cut nearest this offset; omit to clear every cut on the scene.
        atOffsetSec: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const scene = scenes.find(sc => sc.index === input.sceneIndex);
      if (!scene || cutPoints(scene).length === 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This scene has no cut to undo",
        });
      const live = getSceneEditState(input.jobId);
      if (live.active.length || live.queued.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Can't undo a cut while scenes are rendering or queued — wait for them to finish",
        });
      const accepted = await undoLongformSceneSplit(
        input.jobId,
        input.sceneIndex,
        input.atOffsetSec
      );
      return { ok: true, accepted };
    }),

  /**
   * Cut room: drag an existing cut marker to a new position — CapCut's move-the-split-point.
   * The clip is unchanged; only where it's marked cut moves. Metadata only, no render.
   */
  moveCut: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        sceneIndex: z.number().int().min(1),
        fromOffsetSec: z.number().min(0),
        toOffsetSec: z.number().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const v = validateMoveCut(
        scenes,
        input.sceneIndex,
        input.fromOffsetSec,
        input.toOffsetSec
      );
      if (!v.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: v.reason });
      const accepted = await moveLongformSceneCut(
        input.jobId,
        input.sceneIndex,
        input.fromOffsetSec,
        input.toOffsetSec
      );
      return { ok: true, accepted };
    }),

  /**
   * Cut room: slip one piece of a cut scene to a different moment of the SAME footage — its own
   * independent trim, separate from its neighbours (`clipInSec: null` clears it back to the
   * continuous default). The clip is unchanged; this changes what plays, so it marks
   * `timingEdited` and needs a reassemble.
   */
  setPieceClipIn: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        sceneIndex: z.number().int().min(1),
        cutOffsetSec: z.number().min(0),
        clipInSec: z.number().min(0).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const v = validateSetPieceClipIn(
        scenes,
        input.sceneIndex,
        input.cutOffsetSec,
        input.clipInSec
      );
      if (!v.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: v.reason });
      const accepted = await setLongformScenePieceClipIn(
        input.jobId,
        input.sceneIndex,
        input.cutOffsetSec,
        input.clipInSec
      );
      return { ok: true, accepted };
    }),

  /**
   * Cut room: RIPPLE trim — end a scene earlier and delete the narration between there and where
   * it used to end, instead of handing those words to the next scene. The film gets shorter by
   * exactly that much. The cut snaps onto a real pause so it never lands mid-word; the response
   * carries what will actually be removed, so the UI can show it before it is applied.
   */
  rippleTrimScene: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        sceneIndex: z.number().int().min(1),
        newSec: z.number().min(0),
        edge: z.enum(["start", "end"]).default("end"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const plan = planRippleTrim(
        scenes,
        input.sceneIndex,
        input.newSec,
        (job.masterSilences as Silence[] | null) ?? undefined,
        input.edge
      );
      if (!plan.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: plan.reason });
      const accepted = await rippleTrimScene(
        input.jobId,
        input.sceneIndex,
        input.newSec,
        input.edge
      );
      return {
        ok: true,
        accepted,
        removedSec: plan.removedSec,
        snapped: plan.snapped,
      };
    }),

  /**
   * Cut room: merge one scene with the scene after it and re-render the pair as ONE continuous
   * clip — removes the visible cut between two neighbouring shots. A RENDER edit (costs one
   * clip generation); the merged narration is sliced from the existing master, never re-voiced.
   * Refused while anything else renders: the merge renumbers every later scene, and a queued
   * request keyed by an old index would land on the wrong card.
   */
  mergeScenes: approvedProcedure
    .input(z.object({ jobId: z.number(), sceneIndex: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (!job.masterAudioUrl)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This job has no master narration — merge needs one",
        });
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const v = validateMergeWithNext(scenes, input.sceneIndex);
      if (!v.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: v.reason });
      const live = getSceneEditState(input.jobId);
      if (live.active.length || live.queued.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Can't merge while scenes are rendering or queued — wait for them to finish",
        });
      const accepted = await mergeSceneWithNext(input.jobId, input.sceneIndex);
      return { ok: true, accepted };
    }),

  /**
   * Cut room: undo a merge — put back the two scenes a merged scene was made from, with their
   * own clips and audio exactly as they were. Instant metadata, nothing re-renders (the
   * originals' media still exists on R2). Refused once the merged scene's boundaries have been
   * re-timed (the restored pair would no longer tile) and while anything renders (renumbers).
   */
  unmergeScenes: approvedProcedure
    .input(z.object({ jobId: z.number(), sceneIndex: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const v = validateUnmerge(scenes, input.sceneIndex);
      if (!v.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: v.reason });
      const live = getSceneEditState(input.jobId);
      if (live.active.length || live.queued.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Can't unmerge while scenes are rendering or queued — wait for them to finish",
        });
      const accepted = await unmergeScene(input.jobId, input.sceneIndex);
      return { ok: true, accepted };
    }),

  /**
   * Cut room: put ONE scene back to the cut it had before its first timing edit. The scene's own
   * settings (trim, splits, piece slips, holds) always come back; a shared start/end edge only
   * does when the neighbour on that side was never edited itself, since taking it back moves
   * that neighbour too. Metadata only — needs a reassemble, spends nothing.
   */
  revertSceneTiming: approvedProcedure
    .input(z.object({ jobId: z.number(), sceneIndex: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const scenes = (job.storyboard ?? []) as StoryboardScene[];
      const scene = scenes.find(s => s.index === input.sceneIndex);
      if (!scene)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Scene ${input.sceneIndex} not found`,
        });
      if (!scene.timingOriginal)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Scene ${input.sceneIndex} has no timing edits to revert`,
        });
      const accepted = await revertLongformSceneTiming(
        input.jobId,
        input.sceneIndex
      );
      return { ok: true, accepted };
    }),

  /**
   * Cut room: put the WHOLE job back to its pristine cut. Safe where the per-scene revert has to
   * hold an edge back — restoring every scene at once moves both sides of every shared boundary
   * together, so the narration cannot end up with a gap or an overlap.
   */
  revertJobTiming: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      try {
        return {
          ok: true,
          ...(await revertJobTiming(input.jobId, ctx.user.id, {
            allowAny: canSeeAllJobs(ctx.user.role),
          })),
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err?.message ?? "Could not revert",
        });
      }
    }),

  setSceneSplit: approvedProcedure
    .input(
      z.object({
        jobId: z.number(),
        sceneIndex: z.number().int().min(1),
        mode: z.enum(["off", "prompt", "scene", "layout"]),
        prompt: z.string().optional(),
        verbatim: z.boolean().optional(),
        sourceIndex: z.number().int().min(1).optional(),
        layout: z
          .object({
            hostSide: z.enum(["left", "right"]).optional(),
            seamX: z.number().min(0).max(1).optional(),
            hostFocusX: z.number().min(0).max(1).optional(),
            brollFocusX: z.number().min(0).max(1).optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (input.mode === "scene" && input.sourceIndex == null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Pick the scene whose footage the panel should show",
        });
      }
      if (input.mode === "layout" && input.layout == null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A layout edit needs the layout to apply",
        });
      }
      const edit =
        input.mode === "off"
          ? ({ mode: "off" } as const)
          : input.mode === "prompt"
            ? ({
                mode: "prompt",
                prompt: input.prompt,
                verbatim: input.verbatim,
              } as const)
            : input.mode === "layout"
              ? ({ mode: "layout", layout: input.layout! } as const)
              : ({ mode: "scene", sourceIndex: input.sourceIndex! } as const);
      if (!hasScene(job.storyboard, input.sceneIndex))
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Scene ${input.sceneIndex} not found`,
        });
      const accepted = await setLongformSceneSplit(
        input.jobId,
        input.sceneIndex,
        edit
      );
      return { ok: true, accepted };
    }),

  /** Re-run the assembly stage for a stuck/failed job whose clips are ready. */
  retryAssembly: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.stage !== "assembly") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Job is not in the assembly stage",
        });
      }
      retryJobAssembly(input.jobId).catch(err => {
        console.error(`[Longform ${input.jobId}] retryAssembly error:`, err);
      });
      return { ok: true };
    }),

  /**
   * Assemble the final cut on demand. Scene regeneration and retry are render-only —
   * they leave the film un-stitched and clear finalVideoUrl — so this is how the
   * operator rebuilds the final after previewing the new clips. Fire-and-forget:
   * retryJobAssembly flips the job to processing, resumes any pending renders,
   * stitches, and settles done + a fresh finalVideoUrl. Its "already finished"
   * short-circuit can't fire here because the render-only settle cleared the final.
   */
  assembleFinal: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      retryJobAssembly(input.jobId).catch(err => {
        console.error(`[Longform ${input.jobId}] assembleFinal error:`, err);
      });
      return { ok: true };
    }),

  /**
   * Force a re-stitch of an ALREADY-FINISHED film — the one case `assembleFinal` can't reach,
   * because its short-circuit deliberately skips re-encoding a job that already has a good
   * final and no incomplete scenes. This is for when the operator explicitly wants a fresh
   * assembly anyway: e.g. an assembly-time-only fix (QR placement, cover resolution) that a
   * plain re-stitch of the SAME already-rendered clips picks up, no scene regeneration needed.
   */
  reassembleFinal: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.status === "processing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Job is still processing — wait for it to settle first",
        });
      }
      retryJobAssembly(input.jobId, true).catch(err => {
        console.error(`[Longform ${input.jobId}] reassembleFinal error:`, err);
      });
      return { ok: true };
    }),

  /**
   * Retry every clip-less scene (host + b-roll). A job that never reached its first assembly
   * is stitched automatically once the holes are filled; a job that already shipped a cut is
   * render-only, leaving the re-stitch to the manual Assemble button.
   */
  retryFailedScenes: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (
        !job ||
        (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      // ponytail: read-then-act guard, not an atomic CAS. Covers rapid
      // single-client spam (serialized) and the common cross-tab case. If
      // exact-simultaneous cross-device clicks must be blocked, switch to a
      // conditional UPDATE (status='processing' WHERE status='failed').
      if (job.status === "processing") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Retry already in progress",
        });
      }
      if (
        describeIncompleteScenes(
          (job.storyboard as StoryboardScene[]) || []
        ) === null
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No failed scenes to retry",
        });
      }
      retryLongformFailedScenes(input.jobId).catch(err => {
        console.error(
          `[Longform ${input.jobId}] retryFailedScenes error:`,
          err
        );
      });
      return { ok: true };
    }),

  /** Set/update the job's video title (merged into inputParams; names the download). */
  setTitle: approvedProcedure
    .input(z.object({ jobId: z.number(), title: z.string().max(255) }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      await updateLongformVideoJob(input.jobId, {
        inputParams: {
          ...(job.inputParams as Record<string, unknown> | null),
          title: input.title.trim() || undefined,
        },
      });
      return { ok: true };
    }),

  /**
   * Set/update the job's whole-video visual style bible (merged into inputParams).
   *
   * Per-job operator content like the title, so it matches `setTitle`'s tier — not
   * `setInstructionPrompt`, which is the global admin directing prompt. There is no companion
   * re-render call: the bible is read from inputParams at render time, so an edit takes effect
   * on the next `regenerateScenes`.
   */
  setStyleBible: approvedProcedure
    .input(z.object({ jobId: z.number(), styleBible: z.string().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.userId !== ctx.user.id && !canSeeAllJobs(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      await updateLongformVideoJob(input.jobId, {
        inputParams: {
          ...(job.inputParams as Record<string, unknown> | null),
          visualStyleBible: input.styleBible.trim() || undefined,
        },
      });
      return { ok: true };
    }),

  /** Cancel a running job (marks failed; background pipeline drains naturally). */
  cancelJob: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await cancelLongformJob(input.jobId, ctx.user.id, {
        allowAny: canSeeAllJobs(ctx.user.role),
      });
      return { ok: true };
    }),

  /** Delete a job. */
  deleteJob: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteLongformVideoJob(input.jobId, ctx.user.id, {
        allowAny: canSeeAllJobs(ctx.user.role),
      });
      return { ok: true };
    }),
});

/** Whether a job's storyboard carries a scene with this index. */
function hasScene(storyboard: unknown, sceneIndex: number): boolean {
  return (
    Array.isArray(storyboard) &&
    storyboard.some(sc => sc && (sc as StoryboardScene).index === sceneIndex)
  );
}

// ─── User Router ───

const roleEnum = z.enum(ROLES);
/**
 * Deliberately only bounded, not length-checked: zod's own `too_small` issue serialises as a
 * raw JSON blob, which is what the operator would see in the toast. `assertPasswordOk` runs
 * first in every mutation below and produces a sentence instead. The cap stays here because an
 * unbounded string is a scrypt-sized denial of service, not a policy question.
 */
const passwordField = z.string().min(1).max(MAX_PASSWORD_LENGTH);

/** Reject a password the shared policy refuses, as a message the operator can act on. */
function assertPasswordOk(password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
}

/**
 * Refuse any change that would leave the studio with no way in.
 *
 * Deleting the last admin, disabling them, or demoting them to editor all end the same way: a
 * running deploy nobody can administer, recoverable only by editing the database by hand. The
 * check runs on the CURRENT state, so it also covers "two admins, one already disabled".
 */
async function assertNotLastAdmin(
  target: { id: number; role: Role; status: string },
  next: { role?: Role; status?: "active" | "disabled"; deleting?: boolean }
) {
  const stillAdmin =
    (next.role ?? target.role) === "admin" &&
    (next.status ?? target.status) === "active" &&
    !next.deleting;
  if (stillAdmin) return;
  if (target.role !== "admin" || target.status !== "active") return;

  if ((await countActiveAdmins()) <= 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This is the last active admin. Promote another account to admin first.",
    });
  }
}

/**
 * Accounts — admin-only, except `changePassword`, which is every user's own.
 *
 * The three tiers are defined in `shared/roles.ts` and enforced by the procedures in
 * `server/_core/trpc.ts`; this router is only where they are handed out. Password hashes never
 * appear in any response: `listUsers` selects around the column rather than deleting it
 * afterwards, so a field added later cannot leak by being forgotten.
 */
const userRouter = router({
  /** Every account, with how many renders each one owns (shown before a delete). */
  list: adminProcedure.query(async () => {
    const [rows, jobCounts] = await Promise.all([
      listUsers(),
      countJobsByUser(),
    ]);
    return rows.map(u => ({ ...u, jobCount: jobCounts.get(u.id) ?? 0 }));
  }),

  /**
   * One account's renders — the "who did what" view behind the Videos count.
   *
   * Deliberately the SAME shape `longformVideo.library` returns (poster, title, channel,
   * status, sales), because it is the same question asked with the maker fixed instead of the
   * viewer. Reusing `getLongformLibrary` means it also inherits the light column set: no
   * script, no storyboard JSON, so listing a prolific account costs a page of text, not
   * megabytes.
   */
  videos: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        limit: z.number().int().min(1).max(500).optional(),
      })
    )
    .query(async ({ input }) => {
      const rows = await getLongformLibrary(input.id, { limit: input.limit });
      // One grouped sales query for the whole list, not one per row — same as the library.
      const sales = await getSalesByJob(rows.map(r => r.id)).catch(
        () => new Map<number, { sales: number; revenueCents: number }>()
      );
      return rows.map(r => ({
        ...r,
        sales: sales.get(r.id)?.sales ?? 0,
        revenueCents: sales.get(r.id)?.revenueCents ?? 0,
      }));
    }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(128),
        email: z.string().trim().email().max(255),
        password: passwordField,
        role: roleEnum,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertPasswordOk(input.password);
      const email = normalizeEmail(input.email);
      if (await getUserByEmail(email)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with that email already exists",
        });
      }

      const id = await createUser({
        email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        status: "active",
      });
      console.log(
        `[Accounts] ${ctx.user.email} created ${ROLE_LABEL[input.role]} ${email} (id ${id})`
      );
      return { id };
    }),

  /** Rename, re-tier or switch an account off. Password changes go through `resetPassword`. */
  update: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1).max(128).optional(),
        email: z.string().trim().email().max(255).optional(),
        role: roleEnum.optional(),
        status: z.enum(["active", "disabled"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const target = await getPublicUserById(id);
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      // Self-demotion and self-disabling are how an admin locks themselves out one click at a
      // time; the last-admin guard below would not catch it while a second admin exists.
      if (id === ctx.user.id && patch.role && patch.role !== "admin") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot change your own role",
        });
      }
      if (id === ctx.user.id && patch.status === "disabled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot disable your own account",
        });
      }
      await assertNotLastAdmin(target, {
        role: patch.role,
        status: patch.status,
      });

      if (patch.email) {
        const email = normalizeEmail(patch.email);
        const clash = await getUserByEmail(email);
        if (clash && clash.id !== id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An account with that email already exists",
          });
        }
      }

      await updateUser(id, patch);
      invalidateUserCache(id);
      console.log(
        `[Accounts] ${ctx.user.email} updated ${target.email} (${Object.keys(patch).join(", ") || "no-op"})`
      );
      return { success: true };
    }),

  /** Admin sets a new password for someone else — the "they forgot it" path. */
  resetPassword: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        password: passwordField,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertPasswordOk(input.password);
      const target = await getPublicUserById(input.id);
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      await updateUser(input.id, {
        passwordHash: await hashPassword(input.password),
      });
      console.log(
        `[Accounts] ${ctx.user.email} reset the password for ${target.email}`
      );
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const target = await getPublicUserById(input.id);
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot delete your own account",
        });
      }
      await assertNotLastAdmin(target, { deleting: true });

      await deleteUser(input.id);
      invalidateUserCache(input.id);
      console.log(
        `[Accounts] ${ctx.user.email} deleted account ${target.email}`
      );
      return { success: true };
    }),

  /**
   * Change your OWN password. Requires the current one even though the session already proves
   * identity — it is what stops an unattended signed-in browser from becoming a permanent
   * takeover.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
        newPassword: passwordField,
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertPasswordOk(input.newPassword);
      const me = await getUserByIdWithHash(ctx.user.id);
      if (!me) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }
      if (!(await verifyPassword(input.currentPassword, me.passwordHash))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is incorrect",
        });
      }

      await updateUser(me.id, {
        passwordHash: await hashPassword(input.newPassword),
      });
      console.log(`[Accounts] ${me.email} changed their own password`);
      return { success: true };
    }),
});

export const appRouter = router({
  auth: authRouter,
  user: userRouter,
  provider: providerRouter,
  channelConfig: channelConfigRouter,
  shuttle: shuttleRouter,
  styleReference: styleReferenceRouter,
  longformVideo: longformVideoRouter,
  book: bookRouter,
  channelAsset: channelAssetRouter,
});

export type AppRouter = typeof appRouter;

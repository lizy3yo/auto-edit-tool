import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import {
  adminProcedure,
  approvedProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
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
  deleteLongformVideoJob,
  updateLongformVideoJob,
} from "./db";
import { CHANNEL_ORDER, CHANNEL_PROFILES } from "../shared/constants";
import {
  createLongformJob,
  runLongformPipeline,
  regenerateScene as regenerateLongformScene,
  regenerateScenes as regenerateLongformScenes,
  retryJobAssembly,
  retryFailedScenes as retryLongformFailedScenes,
  describeIncompleteScenes,
  cancelLongformJob,
  DEFAULT_LONGFORM_INSTRUCTION,
  LONGFORM_INSTRUCTION_KEY,
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
  validateCtaMarkers,
  syncSceneClipFields,
} from "./longformVideo";
import { ApimartAdapter } from "./providers/apimart";
import { HeygenLipsyncAdapter } from "./providers/heygen-lipsync";
import type { LongformInputParams, StoryboardScene } from "../shared/types";
import { getChannelLayer } from "./composer";
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

  getStatus: publicProcedure.query(async () => {
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
  list: adminProcedure.query(async () => {
    return getAllChannelConfigs();
  }),

  get: adminProcedure
    .input(z.object({ channelKey: z.string() }))
    .query(async ({ input }) => {
      return getChannelConfig(input.channelKey);
    }),

  upsert: adminProcedure
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

  create: adminProcedure
    .input(
      z.object({
        displayName: z.string().min(1),
        personaProfile: z.string().min(1),
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

  delete: adminProcedure
    .input(z.object({ channelKey: z.string() }))
    .mutation(async ({ input }) => {
      if ((CHANNEL_ORDER as readonly string[]).includes(input.channelKey)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot delete built-in channels",
        });
      }
      await deleteChannelConfig(input.channelKey);
      return { success: true };
    }),

  listAllChannels: approvedProcedure.query(async () => {
    const dbConfigs = await getAllChannelConfigs();
    const staticChannels = CHANNEL_ORDER.map(key => ({
      key,
      name: CHANNEL_PROFILES[key].name,
      niche: CHANNEL_PROFILES[key].niche,
      profile: CHANNEL_PROFILES[key].profile,
      isDynamic: false,
    }));
    const dynamicChannels = dbConfigs
      .filter(
        c =>
          c.displayName &&
          !(CHANNEL_ORDER as readonly string[]).includes(c.channelKey)
      )
      .map(c => ({
        key: c.channelKey,
        name: c.displayName!,
        niche: c.nicheSlug ?? "gardening",
        profile: c.personaProfile ?? "",
        isDynamic: true,
      }));
    return [...staticChannels, ...dynamicChannels];
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

// ─── Long-form Video Router ───
const longformVideoRouter = router({
  /** Admin: read the saved directing instruction (falls back to the default). */
  getInstructionPrompt: adminProcedure.query(async () => {
    const saved = await getAppSetting(LONGFORM_INSTRUCTION_KEY);
    return {
      content: saved ?? DEFAULT_LONGFORM_INSTRUCTION,
      isDefault: saved == null,
      default: DEFAULT_LONGFORM_INSTRUCTION,
    };
  }),

  /** Admin: save the directing instruction applied to every long-form session. */
  setInstructionPrompt: adminProcedure
    .input(z.object({ content: z.string().min(1).max(20000) }))
    .mutation(async ({ input }) => {
      await setAppSetting(LONGFORM_INSTRUCTION_KEY, input.content);
      return { success: true };
    }),

  /** Admin: read the masked per-tab APIMART keys (slots 0–4) + the edit-pages key, null where unset. */
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
      const ctaMarkers = validateCtaMarkers(input.script);
      if (ctaMarkers.errors.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `CTA marker error: ${ctaMarkers.errors.join("; ")}`,
        });
      }
      if (
        (channelConfig.bookCoverImageUrl || channelConfig.ctaQrImageUrl) &&
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
      const job = await getLongformVideoJobById(input.jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
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
              ...assembleScenePromptPreview(scene, previewParams),
            })
          )
        : rawScenes;
      return {
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        storyboard,
        finalVideoUrl: job.finalVideoUrl,
        errorMessage: job.errorMessage,
        channelKey:
          (job.inputParams as { channelKey?: string } | null)?.channelKey ??
          null,
        title: (job.inputParams as { title?: string } | null)?.title ?? null,
        visualStyleBible:
          (job.inputParams as { visualStyleBible?: string } | null)
            ?.visualStyleBible ?? null,
      };
    }),

  /** Current user's active (processing) jobs — for auto-resume on reload. */
  myActiveJobs: approvedProcedure.query(async ({ ctx }) => {
    return getActiveLongformVideoJobs(ctx.user.id);
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

  /** Admin: every user's finished jobs, with the maker's name. */
  allJobHistory: adminProcedure
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
      if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      regenerateLongformScene(
        input.jobId,
        input.sceneIndex,
        input.customVisualPrompt,
        input.verbatim,
        input.customSplitVisual
      ).catch(err => {
        console.error("[Longform] Scene regeneration failed:", err);
      });
      return { ok: true };
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
      if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized" });
      }
      regenerateLongformScenes(
        input.jobId,
        input.sceneIndices,
        input.prompts,
        input.verbatimIndices
      ).catch(err => {
        console.error("[Longform] Batch scene regeneration failed:", err);
      });
      return { ok: true };
    }),

  /** Re-run the assembly stage for a stuck/failed job whose clips are ready. */
  retryAssembly: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getLongformVideoJobById(input.jobId);
      if (!job || (job.userId !== ctx.user.id && ctx.user.role !== "admin")) {
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
      if (!job || (job.userId !== ctx.user.id && ctx.user.role !== "admin")) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      retryJobAssembly(input.jobId).catch(err => {
        console.error(`[Longform ${input.jobId}] assembleFinal error:`, err);
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
      if (!job || (job.userId !== ctx.user.id && ctx.user.role !== "admin")) {
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
      if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
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
      if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
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
      await cancelLongformJob(input.jobId, ctx.user.id);
      return { ok: true };
    }),

  /** Delete a job. */
  deleteJob: approvedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteLongformVideoJob(input.jobId, ctx.user.id);
      return { ok: true };
    }),
});

export const appRouter = router({
  auth: authRouter,
  provider: providerRouter,
  channelConfig: channelConfigRouter,
  shuttle: shuttleRouter,
  styleReference: styleReferenceRouter,
  longformVideo: longformVideoRouter,
});

export type AppRouter = typeof appRouter;

/**
 * The HeyGen test bench (the "HeyGen test" page beside Channels, admins and operations managers).
 *
 * Answers one question before a film is paid for: which host PHOTO makes the best talking head.
 * A run is one script and up to four photos. The script is voiced ONCE, in the chosen channel's
 * own voice and settings exactly as a film would voice it, cut to `HEYGEN_TEST_MAX_SEC`, and
 * every photo is lip-synced from that one audio file — so the photo is the only variable between
 * the clips. The render is the production call itself (`HeygenLipsyncAdapter.submitLipsync`:
 * Avatar IV, 1080p, expressiveness "low"), so what the bench shows is what a film would get.
 *
 * Spend: HeyGen bills per second of output, so a clip costs its audio length × the HeyGen rate,
 * and the 30 s cut is the hard cap on it. It is NOT in the Spend tab — that totals per-job
 * `costUsage`, and a test is not a job — so the bench prints each clip's cost on its card.
 *
 * Restart safety mirrors the pipeline's: HeyGen's `video_id` is persisted the moment the render
 * is accepted, and `resumeHeygenTests` (run on every list read) polls an orphaned row's render
 * rather than submitting it again. A row cut off BEFORE HeyGen accepted it has nothing to poll
 * and is failed with a message saying so — the bench never re-spends unattended.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  HEYGEN_TEST_MAX_SEC,
  heygenTestInputError,
  type HeygenTestAccount,
} from "../shared/heygenTest";
import type { LongformInputParams } from "../shared/types";
import type { HeygenTest } from "../drizzle/schema";
import {
  createHeygenTests,
  getChannelConfig,
  getHeygenTestBatch,
  getProcessingLongformSlots,
  getUnfinishedHeygenTests,
  updateHeygenTest,
  updateHeygenTestBatch,
} from "./db";
import { ENV } from "./_core/env";
import {
  generateSceneVoiceover,
  getHeygenSlotKey,
  LONGFORM_SLOT_COUNT,
  resolveTTSVendor,
  TTS_SIMILARITY,
  TTS_STABILITY,
  TTS_STYLE,
  voiceIdForVendor,
} from "./longformVideo";
import { parseVolumeMultiplier } from "./ttsUnified";
import { downloadToTemp, runFfmpeg } from "./videoAssembly";
import { getMediaDuration } from "./mediaProbe";
import { storagePut } from "./storage";
import { isMockMode } from "./mockMode";
import { RATES } from "./pricing";
import {
  HEYGEN_LIPSYNC_TIMEOUT_MS,
  HeygenLipsyncAdapter,
  heygenSlotsFor,
} from "./providers/heygen-lipsync";

export type TtsVendor = "sixtynine_labs" | "minimax";

/** A HeyGen account the form can offer, labelled. Keys never leave the server. */
export type HeygenTestAccountOption = {
  account: HeygenTestAccount;
  label: string;
};

/** What the account picker shows: the free accounts, out of how many have a key at all. */
export type HeygenAccountAvailability = {
  available: HeygenTestAccountOption[];
  configured: number;
  ratePerSec: number;
};

/**
 * Pure: which configured accounts are free. A film renders its host on its tab's account, or on
 * the shared key when that tab has none (or it has no tab); a HeyGen test holds the account it
 * was started on until it settles.
 */
export function planHeygenAvailability(
  configured: HeygenTestAccountOption[],
  keyedSlots: ReadonlySet<number>,
  processingFilmSlots: (number | null)[],
  unfinishedTestAccounts: HeygenTestAccount[]
): HeygenTestAccountOption[] {
  const busy = new Set<HeygenTestAccount>(unfinishedTestAccounts);
  for (const slot of processingFilmSlots)
    busy.add(slot != null && keyedSlots.has(slot) ? slot : "shared");
  return configured.filter(a => !busy.has(a.account));
}

/**
 * The TAB accounts free right now — what the picker lists and what `startHeygenTest` re-checks.
 * The shared `HEYGEN_API_KEY` is deliberately not offered: tests run on a tab's own account.
 */
export async function getHeygenAccountAvailability(
  opts: { ignoreBatchId?: string } = {}
): Promise<HeygenAccountAvailability> {
  const configured: HeygenTestAccountOption[] = [];
  const keyedSlots = new Set<number>();
  for (let slot = 0; slot < LONGFORM_SLOT_COUNT; slot++) {
    if (await getHeygenSlotKey(slot)) {
      keyedSlots.add(slot);
      configured.push({ account: slot, label: `Tab ${slot + 1} account` });
    }
  }
  const [filmSlots, tests] = await Promise.all([
    getProcessingLongformSlots(),
    getUnfinishedHeygenTests(),
  ]);
  return {
    available: planHeygenAvailability(
      configured,
      keyedSlots,
      filmSlots,
      tests
        .filter(t => t.batchId !== opts.ignoreBatchId)
        .map(t => t.heygenSlot ?? "shared")
    ),
    configured: configured.length,
    ratePerSec: RATES.heygenPerSecond,
  };
}

async function heygenKeyFor(
  account: HeygenTestAccount
): Promise<string | null> {
  if (account === "shared") return ENV.heygenApiKey || null;
  return getHeygenSlotKey(account);
}

/** Estimated spend of one clip, from the seconds actually rendered. */
export function heygenTestCostUsd(
  row: Pick<HeygenTest, "audioMs" | "videoId">
) {
  if (!row.videoId || !row.audioMs) return 0;
  return (row.audioMs / 1000) * RATES.heygenPerSecond;
}

/**
 * What this process is working on right now: whole batches from the insert until every row has
 * settled, plus single rows a resume is polling. Single process ⇒ this is authoritative. The
 * batch is claimed BEFORE its rows are written, so a list read landing mid-insert never mistakes
 * a fresh run for an orphan.
 */
const activeBatches = new Set<string>();
const active = new Set<number>();

export class HeygenTestInputError extends Error {}

/**
 * Validate, write one row per photo, and start the run in the background. Throws
 * `HeygenTestInputError` for anything the operator can fix, before anything is spent.
 */
export async function startHeygenTest(input: {
  userId: number;
  channelKey: string;
  ttsVendor: TtsVendor;
  account: HeygenTestAccount;
  script: string;
  imageUrls: string[];
  /** Optional label for the run; blank = none. */
  name?: string;
}): Promise<{ batchId: string }> {
  const bad = heygenTestInputError(input);
  if (bad) throw new HeygenTestInputError(bad);
  if (await isMockMode())
    throw new HeygenTestInputError(
      "Mock mode is on — the HeyGen test needs a real render. Turn mock mode off first."
    );
  if (!(await heygenKeyFor(input.account)))
    throw new HeygenTestInputError(
      "That HeyGen account has no key — pick another, or add one in Admin → Provider keys."
    );
  // The picker only offers free accounts, but a film can take one between its last update and
  // this click — refuse rather than queue a test behind a live film's host renders.
  const { available } = await getHeygenAccountAvailability();
  if (!available.some(a => a.account === input.account))
    throw new HeygenTestInputError(
      "That HeyGen account just became busy with a film — pick another one, or wait for it to finish."
    );
  const channel = await getChannelConfig(input.channelKey);
  if (!channel) throw new HeygenTestInputError("Unknown channel.");
  const voiceId =
    input.ttsVendor === "minimax" ? channel.minimaxVoiceId : channel.voiceId;
  if (!voiceId)
    throw new HeygenTestInputError(
      `This channel has no ${input.ttsVendor === "minimax" ? "MiniMax " : ""}voice set — add one under Channels.`
    );

  const batchId = nanoid(16);
  activeBatches.add(batchId);
  try {
    await createHeygenTests(
      input.imageUrls.map(imageUrl => ({
        batchId,
        userId: input.userId,
        channelKey: input.channelKey,
        ttsVendor: input.ttsVendor,
        heygenSlot: input.account === "shared" ? null : input.account,
        imageUrl,
        script: input.script.trim(),
        runName: input.name?.trim() || null,
        status: "voicing" as const,
        phaseStartedAt: new Date(),
      }))
    );
  } catch (err) {
    activeBatches.delete(batchId);
    throw err;
  }
  void getHeygenTestBatch(batchId)
    .then(runBatch)
    .catch(err =>
      console.error(`[HeyGen test ${batchId}] run crashed: ${err?.message}`)
    )
    .finally(() => activeBatches.delete(batchId));
  return { batchId };
}

async function runBatch(rows: HeygenTest[]): Promise<void> {
  const first = rows[0];
  if (!first) return;
  let audioUrl: string;
  let audioMs: number;
  try {
    ({ audioUrl, audioMs } = await voiceTestScript(first));
  } catch (err: any) {
    await updateHeygenTestBatch(first.batchId, {
      status: "failed",
      error: `Voicing failed: ${err?.message ?? err}`,
    });
    return;
  }
  await updateHeygenTestBatch(first.batchId, {
    audioUrl,
    audioMs,
    status: "rendering",
    phaseStartedAt: new Date(),
  });
  await Promise.all(
    rows.map(r => renderRow({ ...r, audioUrl, audioMs, status: "rendering" }))
  );
}

/** Voice the script in the channel's voice, cut it to the cap, and host it on R2. */
async function voiceTestScript(
  row: HeygenTest
): Promise<{ audioUrl: string; audioMs: number }> {
  const channel = await getChannelConfig(row.channelKey);
  if (!channel) throw new Error("channel no longer exists");
  const speed = channel.ttsSpeed ? parseFloat(channel.ttsSpeed) : NaN;
  // Only the fields the voicing helpers read; the rest of a film's params mean nothing here.
  const params = {
    ttsVendor: row.ttsVendor as TtsVendor,
    voiceId: channel.voiceId ?? "",
    minimaxVoiceId: channel.minimaxVoiceId ?? undefined,
  } as LongformInputParams;
  const { providerType, apiKey } = await resolveTTSVendor(params);
  const voicedUrl = await generateSceneVoiceover(
    providerType,
    apiKey,
    row.script,
    voiceIdForVendor(params),
    channel.ttsModel || "eleven_multilingual_v2",
    Number.isFinite(speed) && speed >= 0.7 && speed <= 1.2 ? speed : undefined,
    parseVolumeMultiplier(channel.ttsVolume),
    TTS_STABILITY,
    TTS_STYLE,
    TTS_SIMILARITY
  );

  const dir = await mkdtemp(path.join(tmpdir(), "heygen-test-"));
  try {
    const src = await downloadToTemp(voicedUrl, dir, "voiced");
    const out = path.join(dir, "cut.mp3");
    // One pass: the 30 s cap (the cost ceiling) and the mp3/48k/stereo shape a film's
    // narration slices have, so HeyGen is handed what production hands it.
    await runFfmpeg([
      "-y",
      "-i",
      src,
      "-vn",
      "-t",
      String(HEYGEN_TEST_MAX_SEC),
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      out,
    ]);
    const sec = await getMediaDuration(out);
    if (!(sec > 0)) throw new Error("the voiced audio came back empty");
    const { url } = await storagePut(
      `heygen-tests/${row.batchId}/voice.mp3`,
      await readFile(out),
      "audio/mpeg"
    );
    return { audioUrl: url, audioMs: Math.round(sec * 1000) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Submit (unless HeyGen already has it), poll, and host the finished clip on R2. */
async function renderRow(row: HeygenTest): Promise<void> {
  active.add(row.id);
  try {
    const key = await heygenKeyFor(row.heygenSlot ?? "shared");
    if (!key) throw new Error("the HeyGen account's key has been removed");
    const heygen = new HeygenLipsyncAdapter(key);
    // Shares the account's semaphore with the pipeline, so a test never pushes a live render
    // past HeyGen's per-account concurrency cap.
    const slots = heygenSlotsFor(key);
    await slots.acquire();
    try {
      let videoId = row.videoId;
      if (!videoId) {
        if (!row.audioUrl) throw new Error("no voiced audio to render from");
        const submitted = await heygen.submitLipsync({
          imageUrl: row.imageUrl,
          audioUrl: row.audioUrl,
        });
        if (!submitted.taskId)
          throw new Error(submitted.error || "HeyGen refused the render");
        videoId = submitted.taskId;
        await updateHeygenTest(row.id, { videoId, phaseStartedAt: new Date() });
      }
      const result = await heygen.pollVideo(videoId, HEYGEN_LIPSYNC_TIMEOUT_MS);
      if (result.pending) {
        // Still rendering on HeyGen. Leave the row as is — the next list read resumes it.
        return;
      }
      if (!result.success)
        throw new Error(result.error || "HeyGen render failed");
      if (!result.fileData?.length) throw new Error("HeyGen returned no video");
      const { url: videoUrl } = await storagePut(
        `heygen-tests/${row.batchId}/${row.id}.mp4`,
        result.fileData,
        "video/mp4"
      );
      await updateHeygenTest(row.id, {
        videoUrl,
        status: "done",
        error: null,
      });
    } finally {
      slots.release();
    }
  } catch (err: any) {
    await updateHeygenTest(row.id, {
      status: "failed",
      error: String(err?.message ?? err),
    });
  } finally {
    active.delete(row.id);
  }
}

/** Name, rename or (blank) un-name a run. Metadata only — nothing is rendered or re-checked. */
export async function renameHeygenRun(
  batchId: string,
  name: string
): Promise<void> {
  await updateHeygenTestBatch(batchId, { runName: name.trim() || null });
}

/**
 * Run a batch's FAILED clips again — the ids given, or every failed one. An operator click, so it
 * may spend: a clip whose render HeyGen refused or failed is submitted afresh.
 *
 * Voicing is the batch's shared step: if it never produced audio, the failed rows are voiced
 * again together (one read for all of them, as on the first run). Otherwise each row goes
 * straight back to HeyGen on the batch's existing audio, so the retried clip is directly
 * comparable with its siblings. Runs on the account the batch was started on, re-checked for a
 * film that took it in the meantime (the batch's own unfinished clips do not count as busy).
 */
export async function retryHeygenTests(
  batchId: string,
  ids?: number[]
): Promise<{ retried: number }> {
  if (await isMockMode())
    throw new HeygenTestInputError(
      "Mock mode is on — the HeyGen test needs a real render. Turn mock mode off first."
    );
  const rows = await getHeygenTestBatch(batchId);
  const targets = rows.filter(
    r =>
      r.status === "failed" && !active.has(r.id) && (!ids || ids.includes(r.id))
  );
  if (!targets.length)
    throw new HeygenTestInputError(
      "Nothing to retry — those clips are no longer failed."
    );

  const account: HeygenTestAccount = targets[0].heygenSlot ?? "shared";
  const { available } = await getHeygenAccountAvailability({
    ignoreBatchId: batchId,
  });
  if (!available.some(a => a.account === account))
    throw new HeygenTestInputError(
      `${account === "shared" ? "That HeyGen account" : `The Tab ${account + 1} account`} is busy with a film right now — retry when it finishes.`
    );

  const reset = {
    error: null,
    videoId: null,
    videoUrl: null,
    phaseStartedAt: new Date(),
  };
  const audio = rows.find(r => r.audioUrl);
  if (!audio?.audioUrl || !audio.audioMs) {
    if (activeBatches.has(batchId))
      throw new HeygenTestInputError("This run is still in progress.");
    // No audio means voicing failed, and voicing is shared: every clip in the batch failed with
    // it and goes again together (`runBatch` writes the new audio to the whole batch).
    const all = rows.filter(r => r.status === "failed");
    activeBatches.add(batchId);
    await updateHeygenTestBatch(batchId, { ...reset, status: "voicing" });
    void runBatch(
      all.map(r => ({ ...r, ...reset, status: "voicing" as const }))
    )
      .catch(err =>
        console.error(`[HeyGen test ${batchId}] retry crashed: ${err?.message}`)
      )
      .finally(() => activeBatches.delete(batchId));
    return { retried: all.length };
  }

  const { audioUrl, audioMs } = audio;
  for (const r of targets) {
    // Claimed before the status write, so a list read in between never takes it for an orphan.
    active.add(r.id);
    const next = { ...reset, audioUrl, audioMs, status: "rendering" as const };
    await updateHeygenTest(r.id, next);
    void renderRow({ ...r, ...next });
  }
  return { retried: targets.length };
}

/**
 * Pick up rows a restart (or a poll timeout) left behind. A row HeyGen accepted is polled — its
 * render is already paid for; one that never reached HeyGen is failed, never resubmitted.
 */
export async function resumeHeygenTests(): Promise<void> {
  const rows = await getUnfinishedHeygenTests();
  for (const row of rows) {
    if (activeBatches.has(row.batchId) || active.has(row.id)) continue;
    if (row.status === "rendering" && row.videoId) {
      active.add(row.id);
      void renderRow(row);
      continue;
    }
    await updateHeygenTest(row.id, {
      status: "failed",
      error:
        "Interrupted by a server restart before HeyGen accepted the render — run it again.",
    });
  }
}

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
 *
 * The UPSELL VSL page (`shared/vsl.ts`) runs on this same engine: a row with `kind = "vsl"` is one
 * clip for a channel's upsell page, carrying the book it thanks the buyer for. Only what a VSL
 * adds is branched on `kind` (one photo, the book, where the files are kept); voicing, the 30 s
 * cap, the render, resume, retry and the account rules are the one code path.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  accountToSlot,
  heygenAccountLabel,
  HEYGEN_TEST_MAX_SEC,
  heygenTestInputError,
  slotToAccount,
  type HeygenTestAccount,
} from "../shared/heygenTest";
import { vslInputError, type HeygenTestKind } from "../shared/vsl";
import type { LongformInputParams } from "../shared/types";
import type { HeygenTest } from "../drizzle/schema";
import {
  createHeygenTests,
  getChannelConfig,
  getHeygenTestBatch,
  getUnfinishedHeygenTests,
  updateHeygenTest,
  updateHeygenTestBatch,
} from "./db";
import { ENV } from "./_core/env";
import { assignHeygenTestAccount, configuredAccounts } from "./accountPool";
import {
  generateSceneVoiceover,
  getHeygenSlotKey,
  getHeygenTestKey,
  getHeygenTestMasked,
  resolveTTSVendor,
  TTS_SIMILARITY,
  TTS_STABILITY,
  TTS_STYLE,
  voiceIdForVendor,
  voiceTextFor,
} from "./longformVideo";
import { stripVoiceDirections } from "../shared/voiceDirections";
import { parseVolumeMultiplier } from "./ttsUnified";
import { downloadToTemp, runFfmpeg } from "./videoAssembly";
import { getMediaDuration } from "./mediaProbe";
import { storagePut } from "./storage";
import { steadyHostClip } from "./hostSteady";
import { isMockMode } from "./mockMode";
import { RATES } from "./pricing";
import {
  HEYGEN_LIPSYNC_TIMEOUT_MS,
  HeygenLipsyncAdapter,
  heygenSlotsFor,
} from "./providers/heygen-lipsync";

export type TtsVendor = "sixtynine_labs" | "minimax";

/**
 * What the two pages need to know before a run: whether any HeyGen key exists at all (the one
 * thing that still blocks a run — a busy account never does, the run waits its turn), and the
 * rate their cost estimate uses. Keys never leave the server.
 */
export async function getHeygenTestStatus(): Promise<{
  ready: boolean;
  ratePerSec: number;
}> {
  const [pool, test] = await Promise.all([
    configuredAccounts("heygen"),
    getHeygenTestMasked(),
  ]);
  return {
    ready: pool.length > 0 || !!test || !!ENV.heygenApiKey,
    ratePerSec: RATES.heygenPerSecond,
  };
}

async function heygenKeyFor(
  account: HeygenTestAccount
): Promise<string | null> {
  if (account === "shared") return ENV.heygenApiKey || null;
  if (account === "test") return getHeygenTestKey();
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
  script: string;
  imageUrls: string[];
  /** Optional label for the run; blank = none. */
  name?: string;
  /** Which page started it; a VSL also names the book and renders exactly one photo. */
  kind?: HeygenTestKind;
  bookTitle?: string;
}): Promise<{ batchId: string }> {
  const kind = input.kind ?? "test";
  const bad =
    heygenTestInputError(input) ??
    (kind === "vsl"
      ? input.imageUrls.length > 1
        ? "A VSL is one clip — pick one photo."
        : vslInputError({ script: input.script, bookTitle: input.bookTitle ?? "" })
      : null);
  if (bad) throw new HeygenTestInputError(bad);
  if (await isMockMode())
    throw new HeygenTestInputError(
      "Mock mode is on — the HeyGen test needs a real render. Turn mock mode off first."
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
    // The account is the server's pick, never the operator's (`assignHeygenTestAccount`): the
    // least busy one, written with the rows under one lock, and kept for the run's whole life —
    // a retry or a resume must reach the account that holds its HeyGen video id. A busy account
    // is not refused; the clips wait on its semaphore in `runClip`.
    await assignHeygenTestAccount(async account => {
      if (account == null)
        throw new HeygenTestInputError(
          "No HeyGen key is set — add one in Admin → Provider keys."
        );
      await createHeygenTests(
        input.imageUrls.map(imageUrl => ({
          batchId,
          userId: input.userId,
          channelKey: input.channelKey,
          ttsVendor: input.ttsVendor,
          heygenSlot: accountToSlot(account),
          imageUrl,
          script: input.script.trim(),
          runName: input.name?.trim() || null,
          kind,
          bookTitle: kind === "vsl" ? input.bookTitle!.trim() : null,
          status: "voicing" as const,
          phaseStartedAt: new Date(),
        }))
      );
    });
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

/**
 * Where a run's files live on R2. A VSL is kept under its channel — it is that channel's asset,
 * and a channel's clips can be listed straight off the bucket.
 */
export function heygenTestStorageDir(
  row: Pick<HeygenTest, "kind" | "channelKey" | "batchId">
): string {
  return row.kind === "vsl"
    ? `vsl/${row.channelKey}/${row.batchId}`
    : `heygen-tests/${row.batchId}`;
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
  const model = channel.ttsModel || "eleven_multilingual_v2";
  // `[laughs]`-style directions reach the voice only when it acts them out (v4 on an
  // ElevenLabs voice); any other voice would say them, so it gets the script without them.
  const { text } = await voiceTextFor({
    clean: stripVoiceDirections(row.script),
    directed: row.script,
    providerType,
    apiKey,
    voiceId: voiceIdForVendor(params),
    model,
  });
  const voicedUrl = await generateSceneVoiceover(
    providerType,
    apiKey,
    text,
    voiceIdForVendor(params),
    model,
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
      `${heygenTestStorageDir(row)}/voice.mp3`,
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
    const key = await heygenKeyFor(slotToAccount(row.heygenSlot));
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
      // The test shows what a VIDEO will show: the same steadier and room freeze a film's host
      // takes get (`runChunkTasks`), so a photo HeyGen "breathes" on is judged as it will play.
      const clip = await steadyHostClip(
        Buffer.from(result.fileData),
        `HeyGen test ${row.batchId} photo ${row.id}`
      );
      const { url: videoUrl } = await storagePut(
        `${heygenTestStorageDir(row)}/${row.id}.mp4`,
        clip,
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
 * comparable with its siblings. Runs on the account the batch was started on — never another,
 * and never refused because that account is busy: the clips wait their turn on it.
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

  const account = slotToAccount(targets[0].heygenSlot);
  if (!(await heygenKeyFor(account)))
    throw new HeygenTestInputError(
      `${heygenAccountLabel(account)} no longer has a key — add it back in Admin → Provider keys, or start a new run.`
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

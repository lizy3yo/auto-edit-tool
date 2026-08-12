/**
 * Lip-sync lane test harness — the host lane in isolation.
 *
 * Calls ONE provider's adapter directly with a host photo + a narration clip and writes the
 * mp4 to disk. No storyboard, no TTS, no b-roll, no assembly, no DB writes — so it costs one
 * clip instead of a film, and a failure points at the provider rather than at the pipeline.
 *
 * The point is A/B: run the SAME photo and audio through two providers and compare. A single
 * good-looking clip proves little; what matters is whether the face survives across several
 * consecutive scenes, which is exactly where EchoMimicV3 fell over.
 *
 *   # pull the photo + one host scene's audio straight out of a finished job
 *   npx tsx scripts/test-lipsync.ts --job 181
 *   npx tsx scripts/test-lipsync.ts --job 181 --scene 12 --provider heygen
 *
 *   # real speech through the channel's own 69Labs voice — the honest test
 *   npx tsx scripts/test-lipsync.ts --image https://…/host.png --say "Hey, it's Roger."
 *
 *   # or drive it with explicit URLs
 *   npx tsx scripts/test-lipsync.ts --image https://…/host.png --audio https://…/scene.mp3
 *
 *   # three consecutive host scenes on one provider — the identity-drift test
 *   npx tsx scripts/test-lipsync.ts --job 181 --scenes 3
 *
 * Keys come from the same places a render uses: the per-tab Admin slot first, then the env
 * fallback. Nothing here is mocked, so it spends real credits — one clip at a time.
 *
 * NOTE: `--job` reads a finished job's scene audio, which on a MOCK render is a silent
 * placeholder — every provider then returns a closed mouth, which looks like a lip-sync
 * failure and isn't one. Use `--say` when the job you have was rendered in mock mode.
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { ENV } from "../server/_core/env";
import { getLongformVideoJobById, getChannelConfig } from "../server/db";
import {
  getHeygenSlotKey,
  getFalSlotKey,
  getWavespeedSlotKey,
  resolveTTSProvider,
} from "../server/longformVideo";
import {
  createUnifiedTTSTask,
  pollUnifiedTTSTask,
  parseVolumeMultiplier,
} from "../server/ttsUnified";
import type { StoryboardScene } from "../shared/types";

type Provider = "heygen" | "fal" | "wavespeed";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Speak `text` in a channel's own 69Labs voice and return the public audio URL.
 *
 * Exists because the obvious test source — a finished job's scene audio — is a placeholder on
 * any MOCK render, and a near-silent track produces a closed mouth on every provider. That
 * looks like a lip-sync failure and isn't one. This gives the test real speech without running
 * a whole film.
 */
async function speak(channelKey: string, text: string): Promise<string> {
  const ch: any = await getChannelConfig(channelKey);
  if (!ch) throw new Error(`channel "${channelKey}" not found`);
  if (!ch.voiceId)
    throw new Error(`channel "${channelKey}" has no voiceId configured`);

  const { providerType, apiKey } = await resolveTTSProvider(null);
  const taskId = await createUnifiedTTSTask(providerType, apiKey, {
    text,
    voiceId: ch.voiceId,
    modelId: ch.ttsModel ?? undefined,
    speed: ch.ttsSpeed ? Number(ch.ttsSpeed) : undefined,
  });
  console.log(`  TTS submitted (${ch.voiceName ?? ch.voiceId}), polling…`);

  const volume = parseVolumeMultiplier(ch.ttsVolume);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    const r = await pollUnifiedTTSTask(providerType, apiKey, taskId, volume);
    if (r.status === "completed" && r.audioUrl) return r.audioUrl;
    if (r.status === "failed" || r.status === "censored")
      throw new Error(`TTS ${r.status}: ${r.error ?? "no detail"}`);
  }
  throw new Error("TTS timed out after 5 minutes");
}

/**
 * Confirm a URL is actually fetchable and looks like the media type we claim, BEFORE handing
 * it to a provider.
 *
 * Providers fetch these server-side, so a typo (or an un-substituted `<placeholder>`) comes
 * back minutes later as an opaque decode error — "cannot identify image file" — after the
 * submit has already been billed. Ten seconds of checking here turns that into an instant,
 * obvious local failure.
 */
async function assertFetchable(url: string, kind: "image" | "audio") {
  if (!/^https?:\/\//i.test(url))
    throw new Error(
      `--${kind === "image" ? "image" : "audio"} is not a URL: "${url}"` +
        (url.startsWith("<")
          ? " — looks like an unsubstituted placeholder"
          : "")
    );
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-2047" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    throw new Error(`${kind} URL unreachable: ${e?.message ?? e}`);
  }
  if (!res.ok) throw new Error(`${kind} URL returned ${res.status}: ${url}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct && !ct.startsWith(kind) && !ct.includes("octet-stream"))
    console.warn(`  ⚠ ${kind} URL content-type is "${ct}"`);
}

/** Resolve a provider's key the same way `resolveLipsyncAdapter` does: slot, then env. */
async function keyFor(provider: Provider, slot: number): Promise<string> {
  if (provider === "heygen")
    return (await getHeygenSlotKey(slot)) ?? ENV.heygenApiKey;
  if (provider === "fal") return (await getFalSlotKey(slot)) ?? ENV.falApiKey;
  return (await getWavespeedSlotKey(slot)) ?? ENV.wavespeedApiKey;
}

/** One submit → poll → write cycle. Returns wall-clock seconds, or null on failure. */
async function renderOne(
  provider: Provider,
  key: string,
  imageUrl: string,
  audioUrl: string,
  durationSec: number | undefined,
  outPath: string
): Promise<number | null> {
  const started = Date.now();

  const submit = async () => {
    if (provider === "heygen") {
      const { HeygenLipsyncAdapter } =
        await import("../server/providers/heygen-lipsync");
      const a = new HeygenLipsyncAdapter(key);
      return {
        res: await a.submitLipsync({ imageUrl, audioUrl }),
        poll: (id: string) => a.pollVideo(id),
      };
    }
    if (provider === "fal") {
      const { FalLipsyncAdapter } =
        await import("../server/providers/fal-lipsync");
      const a = new FalLipsyncAdapter(key);
      return {
        res: await a.submitLipsync({ imageUrl, audioUrl, durationSec }),
        poll: (id: string) => a.pollVideo(id),
      };
    }
    const { WavespeedLipsyncAdapter } =
      await import("../server/providers/wavespeed-lipsync");
    const a = new WavespeedLipsyncAdapter(key);
    return {
      res: await a.submitLipsync({ imageUrl, audioUrl, durationSec }),
      poll: (id: string) => a.pollVideo(id),
    };
  };

  const { res, poll } = await submit();
  if (!res.taskId) {
    console.error(`  ✗ submit failed: ${res.error}`);
    return null;
  }
  console.log(`  submitted ${res.taskId}, polling…`);

  const out = await poll(res.taskId);
  const wall = (Date.now() - started) / 1000;
  if (!out.success) {
    console.error(`  ✗ ${out.error}`);
    return null;
  }

  // HeyGen/fal/WaveSpeed all return bytes; a lane that uploaded straight to R2 would set
  // fileUrl instead, so handle both rather than assuming.
  if (out.fileData) writeFileSync(outPath, Buffer.from(out.fileData as Buffer));
  else if (out.fileUrl) {
    const dl = await fetch(out.fileUrl);
    writeFileSync(outPath, Buffer.from(await dl.arrayBuffer()));
  }
  console.log(`  ✓ ${outPath}  (${wall.toFixed(1)}s wall)`);
  return wall;
}

async function main() {
  const provider = (arg("provider") ?? ENV.lipsyncProvider) as Provider;
  const slot = Number(arg("slot") ?? 0);
  const key = await keyFor(provider, slot);
  if (!key) {
    console.error(
      `No ${provider} key. Set it in Admin → Provider Keys (slot ${slot + 1}) or in .env.`
    );
    process.exit(1);
  }

  // Explicit URLs win; otherwise pull them out of a finished job so there is nothing to
  // hand-copy and the inputs are exactly what a real render would have used.
  let pairs: Array<{
    image: string;
    audio: string;
    dur?: number;
    tag: string;
  }> = [];
  const jobId = arg("job");
  if (jobId) {
    const job = await getLongformVideoJobById(Number(jobId));
    if (!job) throw new Error(`job ${jobId} not found`);
    const params = job.inputParams as any;
    const scenes = (job.storyboard as any as StoryboardScene[]) ?? [];
    const hosts = scenes.filter(s => s.hostPresent && s.audioUrl);
    if (!hosts.length) throw new Error("job has no host scenes with audio");

    const wanted = arg("scene");
    const count = Number(arg("scenes") ?? (wanted ? 1 : 1));
    const picked = wanted
      ? hosts.filter(s => s.index === Number(wanted))
      : hosts.slice(0, count);

    pairs = picked.map(s => ({
      // Honour the scene's alt-angle photo, exactly as the render would.
      image:
        s.hostShot === 1 && params?.faceImageUrl2
          ? params.faceImageUrl2
          : params?.faceImageUrl,
      audio: s.audioUrl!,
      dur: s.audioDuration,
      tag: `scene${s.index}`,
    }));
  } else {
    const say = arg("say");
    const image = arg("image");
    let audio = arg("audio");

    if (say) {
      // Real speech through the channel's configured voice — the only way to judge lip-sync
      // without running a full film, since mock renders leave a silent placeholder behind.
      const channelKey = arg("channel") ?? "roger_the_pipe_guy";
      console.log(`generating narration on channel "${channelKey}"…`);
      audio = await speak(channelKey, say);
      console.log(`  audio: ${audio}\n`);
    }
    if (!image || !audio)
      throw new Error(
        'pass --job <id>, or --image <url> with either --audio <url> or --say "text"'
      );
    pairs = [{ image, audio, tag: "single" }];
  }

  console.log(
    `\nlip-sync test — provider=${provider} slot=${slot} clips=${pairs.length}\n`
  );

  // Validate every input before spending anything — a bad URL is the cheapest failure to catch.
  for (const p of pairs) {
    if (!p.image) continue;
    await assertFetchable(p.image, "image");
    await assertFetchable(p.audio, "audio");
  }

  let total = 0;
  let ok = 0;
  for (const p of pairs) {
    if (!p.image) {
      console.error(`  ✗ ${p.tag}: job has no host photo configured`);
      continue;
    }
    console.log(
      `${p.tag}  (${p.dur ? p.dur.toFixed(1) + "s" : "?"} narration)`
    );
    const wall = await renderOne(
      provider,
      key,
      p.image,
      p.audio,
      p.dur,
      `lipsync-${provider}-${p.tag}.mp4`
    );
    if (wall != null) {
      total += wall;
      ok++;
    }
  }

  console.log(
    `\n${ok}/${pairs.length} rendered${ok ? `, ${(total / ok).toFixed(1)}s average` : ""}.`
  );
  if (ok > 1)
    console.log(
      "Watch them back to back — identity across consecutive scenes is the real test."
    );
  process.exit(0);
}

main().catch(e => {
  console.error(e?.message ?? e);
  process.exit(1);
});

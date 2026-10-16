// Redraw ONLY the named b-roll pictures of a finished job through the app's own "Regenerate scene"
// route (the button's code path: the prompt writer, every picture rule and the picture check all
// run), wait for the edit session to settle, then re-assemble the film once.
//   (from the repo root) npx tsx graphics-lab/scripts/regen-scenes.mts --job 383 --file graphics-lab/cues/regen-383.json
// The file: [{ "scene": 11, "visual": "what the picture must show" }, …]. `visual` goes in as the
// operator's description; the app re-writes it unless `"verbatim": true` (the "render exactly as typed" option).
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ensureFontConfig } from "../../server/fontConfig";
import { resolveFFmpegPath } from "../../server/ffmpegPath";
import { appRouter } from "../../server/routers";
import { getLongformVideoJobById } from "../../server/db";

ensureFontConfig();
await resolveFFmpegPath();

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const jobId = Number(arg("job"));
const list = JSON.parse(readFileSync(arg("file")!, "utf8")) as { scene: number; visual: string; verbatim?: boolean }[];
const caller = appRouter.createCaller({
  req: { headers: {} } as never,
  res: {} as never,
  user: { id: 1, openId: "user:1", name: "Admin", email: "", role: "admin", status: "active" } as never,
});

async function settle(label: string): Promise<string> {
  const t0 = Date.now();
  await new Promise(r => setTimeout(r, 5_000));
  for (;;) {
    const job = await getLongformVideoJobById(jobId);
    if (job?.status !== "processing") {
      console.log(`[regen] ${label}: ${job?.status} after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      return job?.status ?? "missing";
    }
    await new Promise(r => setTimeout(r, 10_000));
  }
}

for (const { scene, visual, verbatim } of list) {
  const r = await caller.longformVideo.regenerateScene({ jobId, sceneIndex: scene, customVisualPrompt: visual, verbatim: !!verbatim });
  console.log(`[regen] scene ${scene}: ${JSON.stringify(r)}`);
}
await settle("pictures");
await caller.longformVideo.assembleFinal({ jobId });
const status = await settle("assembly");
const job = await getLongformVideoJobById(jobId);
console.log(`[regen] final: ${job?.finalVideoUrl ?? "(none)"}`);
process.exit(status === "completed" ? 0 : 1);

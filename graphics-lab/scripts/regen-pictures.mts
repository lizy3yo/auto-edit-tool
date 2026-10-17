// Redraw a few b-roll scenes of a finished film THROUGH THE APP (the real `regenerateScenes` route,
// as the bootstrap admin) and wait until the edit session settles. The film is re-stitched afterwards
// with final-reassemble.mts. Usage: npx tsx graphics-lab/scripts/regen-pictures.mts --job 395 --scenes 21,25
import "dotenv/config";
import { ensureFontConfig } from "../../server/fontConfig";
import { resolveFFmpegPath } from "../../server/ffmpegPath";
import { appRouter } from "../../server/routers";
import { getLongformVideoJobById } from "../../server/db";
ensureFontConfig();
await resolveFFmpegPath();
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const jobId = Number(arg("job"));
const scenes = (arg("scenes") ?? "").split(",").map(Number).filter(Boolean);
const caller = appRouter.createCaller({ req: { headers: {} } as never, res: {} as never, user: { id: 1, openId: "user:1", name: "Admin", email: "", role: "admin", status: "active" } as never });
const before = Object.fromEntries(((await getLongformVideoJobById(jobId))!.storyboard as any[]).filter(s => scenes.includes(s.index)).map(s => [s.index, s.stillSourceUrl ?? s.clipUrl]));
console.log("[regen]", JSON.stringify(await caller.longformVideo.regenerateScenes({ jobId, sceneIndices: scenes })));
const started = Date.now();
for (;;) {
  await new Promise(r => setTimeout(r, 10_000));
  const job = await getLongformVideoJobById(jobId);
  const sb = (job!.storyboard as any[]).filter(s => scenes.includes(s.index));
  const done = sb.every(s => (s.stillSourceUrl ?? s.clipUrl) && (s.stillSourceUrl ?? s.clipUrl) !== before[s.index] && s.sceneStatus !== "processing");
  if (done && job!.status !== "processing") {
    for (const s of sb) console.log(`[regen] scene ${s.index}: ${s.sceneStatus} ${s.stillSourceUrl ?? s.clipUrl}`);
    break;
  }
  if (Date.now() - started > 30 * 60_000) { console.log("[regen] timed out"); break; }
}
process.exit(0);

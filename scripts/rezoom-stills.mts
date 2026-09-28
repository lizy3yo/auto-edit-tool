/**
 * scripts/rezoom-stills.mts — apply the still-zoom length rule (`stillZooms`: 3 s or longer zooms,
 * shorter stays still) to FINISHED films, then reassemble them. Free: no image is generated.
 *
 *   npx tsx scripts/rezoom-stills.mts 220 221 ...
 */
import "dotenv/config";
import { rezoomJobStills, retryJobAssembly } from "../server/longformVideo";
import { getLongformVideoJobById } from "../server/db";

for (const id of process.argv.slice(2).map(Number).filter(Number.isFinite)) {
  const changed = await rezoomJobStills(id);
  console.log(`job ${id}: ${changed.length} picture(s) re-cut${changed.length ? ` [${changed.join(", ")}]` : ""}`);
  if (!changed.length) continue;
  await retryJobAssembly(id, true);
  const j = await getLongformVideoJobById(id);
  console.log(`job ${id}: reassembled — ${j?.status} ${j?.finalVideoUrl ?? ""}`);
}
process.exit(0);

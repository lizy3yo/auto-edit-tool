import "dotenv/config";
import { createConnection } from "mysql2/promise";
const c = await createConnection({ uri: process.env.DATABASE_URL });
let last = "";
for (let i = 0; i < 90; i++) {
  const [r] = await c.query(
    "SELECT status,stage,progress,errorMessage,finalVideoUrl,TIMESTAMPDIFF(SECOND,updatedAt,NOW()) AS stale FROM longform_video_jobs WHERE id=3"
  );
  const j = r[0];
  const p = j.progress || {};
  const s = `${j.status}/${j.stage} ${p.scenesDone ?? "-"}/${p.scenesTotal ?? "-"} stale=${j.stale}s`;
  if (s !== last) {
    console.log(new Date().toISOString().slice(11, 19), s, (p.warnings || []).join(" | "));
    last = s;
  }
  if (j.status === "completed" || j.status === "failed") {
    console.log("TERMINAL:", j.status, "| err:", j.errorMessage, "| url:", j.finalVideoUrl);
    break;
  }
  await new Promise(r => setTimeout(r, 10000));
}
await c.end();
process.exit(0);

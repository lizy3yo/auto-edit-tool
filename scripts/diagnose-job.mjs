// Read-only report on why a longform job will not assemble.
//
// Assembly needs every scene to carry BOTH a clip and the narration that plays under it
// (`sceneIsAssemblable` in server/longformVideo.ts). When it refuses, the job card names the
// scenes but not how they got that way — this prints the row state behind the message so the
// cause is read off the data instead of inferred from the symptom.
//
// Touches nothing: one SELECT, no writes. Safe to run against production.
//
// Usage: node scripts/diagnose-job.mjs <jobId>   (reads DATABASE_URL from .env or the environment)
import "dotenv/config";
import { createConnection } from "mysql2/promise";

const jobId = Number(process.argv[2]);
if (!Number.isInteger(jobId)) {
  console.error("Usage: node scripts/diagnose-job.mjs <jobId>");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL");
  process.exit(1);
}

const conn = await createConnection(url);
try {
  const [rows] = await conn.query(
    "SELECT id, status, stage, masterAudioUrl, masterSilences, finalVideoUrl, finalFileKey, " +
      "errorMessage, storyboard, createdAt, updatedAt, completedAt FROM longform_video_jobs WHERE id = ? LIMIT 1",
    [jobId]
  );
  if (rows.length === 0) {
    console.error(`No job ${jobId}`);
    process.exit(1);
  }
  const job = rows[0];
  // mysql2 hands back JSON columns already parsed on some driver/server combinations and as a
  // string on others — normalize rather than assume.
  const parse = v => (typeof v === "string" ? JSON.parse(v) : v);
  const scenes = parse(job.storyboard) ?? [];
  const silences = parse(job.masterSilences) ?? [];

  console.log(`\njob ${job.id}  status=${job.status}  stage=${job.stage}`);
  console.log(
    `  created ${job.createdAt}  updated ${job.updatedAt}  completed ${job.completedAt ?? "-"}`
  );
  console.log(
    `  masterAudioUrl : ${job.masterAudioUrl ? "SET" : "*** NULL ***"}`
  );
  console.log(`  masterSilences : ${silences.length} pause(s)`);
  console.log(
    `  finalVideoUrl  : ${job.finalVideoUrl ? "SET" : "-"}   finalFileKey: ${job.finalFileKey ? "SET" : "-"}`
  );
  console.log(`  errorMessage   : ${job.errorMessage ?? "-"}`);
  console.log(`  scenes         : ${scenes.length}`);

  const hasClip = s => !!(s.clipUrls?.length || s.clipUrl);
  const bad = scenes.filter(s => !hasClip(s) || !s.audioUrl);

  // The three shapes that matter, counted over the WHOLE board: a job where only the failing
  // scenes lack a master range reads very differently from one where none of them has one.
  const withRange = scenes.filter(
    s =>
      Number.isFinite(s.narrationStartSec) && Number.isFinite(s.narrationEndSec)
  ).length;
  console.log(
    `  with audioUrl  : ${scenes.filter(s => s.audioUrl).length}/${scenes.length}` +
      `   with clip: ${scenes.filter(hasClip).length}/${scenes.length}` +
      `   with master range: ${withRange}/${scenes.length}`
  );

  if (bad.length === 0) {
    console.log(
      "\nEvery scene is assemblable — nothing here blocks a stitch.\n"
    );
  } else {
    console.log(`\n${bad.length} scene(s) assembly would refuse:\n`);
    console.log(
      "  idx  clip  audio  range(start→end)        status      provider  lipsynced host  error"
    );
    for (const s of bad) {
      const range =
        Number.isFinite(s.narrationStartSec) &&
        Number.isFinite(s.narrationEndSec)
          ? `${s.narrationStartSec.toFixed(2)}→${s.narrationEndSec.toFixed(2)}`
          : "MISSING";
      console.log(
        `  ${String(s.index).padStart(4)}  ` +
          `${hasClip(s) ? "yes " : "NO  "}  ` +
          `${s.audioUrl ? "yes  " : "NO   "}  ` +
          `${range.padEnd(22)} ` +
          `${String(s.sceneStatus ?? "-").padEnd(11)} ` +
          `${String(s.renderProvider ?? "-").padEnd(9)} ` +
          `${s.lipsynced ? "yes      " : "no       "} ` +
          `${s.hostPresent ? "yes " : "no  "} ` +
          `${s.error ?? ""}`
      );
    }
    // The neighbours of a failing scene tell you whether the loss follows the storyboard's
    // structure (a run, a lane, a CTA block) or is scattered — different causes.
    console.log("\n  context (each failing scene and its neighbours):");
    for (const s of bad) {
      const at = scenes.findIndex(x => x.index === s.index);
      const near = scenes
        .slice(Math.max(0, at - 1), at + 2)
        .map(
          x =>
            `${x.index}${x.index === s.index ? "*" : ""}:` +
            `${x.hostPresent ? "host" : x.stillImage ? "still" : "motion"}` +
            `${x.cta ? "/cta" : ""}${x.audioUrl ? "" : "/noaudio"}`
        )
        .join("  ");
      console.log(`    ${near}`);
    }
    console.log("");
  }
} finally {
  await conn.end();
}

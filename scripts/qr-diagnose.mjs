/**
 * Read-only QR diagnostic for one longform job.
 *
 *   node scripts/qr-diagnose.mjs <jobId>
 *
 * Prints what the job actually persisted — the channel's dead QR/cover fields, the books that
 * attached to each CTA block (and whether each got a generated code), and the per-scene
 * qrHero/qrCorner/coverHero flags. Answers "why is there no QR" without reading any code.
 */
import fs from "fs";
import mysql from "mysql2/promise";

const jobId = Number(process.argv[2]);
if (!Number.isFinite(jobId)) {
  console.error("usage: node scripts/qr-diagnose.mjs <jobId>");
  process.exit(1);
}
const url =
  process.env.DATABASE_URL ||
  fs.readFileSync(".env", "utf8").match(/DATABASE_URL=(.*)/)?.[1]?.trim();
if (!url) {
  console.error("DATABASE_URL not set (env or .env)");
  process.exit(1);
}

const c = await mysql.createConnection(url);
const [[job]] = await c.query(
  "select id, title, channelKey, stage, status, inputParams, scenes from longform_video_jobs where id = ?",
  [jobId]
);
if (!job) {
  console.error(`job ${jobId} not found`);
  await c.end();
  process.exit(1);
}
const p = typeof job.inputParams === "string" ? JSON.parse(job.inputParams) : job.inputParams;
const scenes = typeof job.scenes === "string" ? JSON.parse(job.scenes) : job.scenes;
const [[chan]] = await c.query(
  "select ctaQrImageUrl, bookCoverImageUrl from channel_configs where channelKey = ?",
  [job.channelKey]
);
const [books] = await c.query(
  "select id, title, shopUrl from books where channelKey = ? and isActive = 1",
  [job.channelKey]
);

console.log(`\njob ${job.id} — ${job.title ?? "(untitled)"}  [${job.channelKey}]  ${job.status}/${job.stage}`);

console.log(`\nchannel legacy fields (both unsettable in the UI now):`);
console.log(`  ctaQrImageUrl     ${chan?.ctaQrImageUrl ? "SET" : "empty"}`);
console.log(`  bookCoverImageUrl ${chan?.bookCoverImageUrl ? "SET" : "empty"}`);
console.log(`  params.qrImageUrl ${p?.qrImageUrl ? "SET" : "empty"}   <- gate A`);
console.log(`  params.bookTitle  ${p?.bookTitle ? JSON.stringify(p.bookTitle) : "empty"}   <- cover-beat search term`);

console.log(`\nchannel books (attach ONLY when a block names them):`);
for (const b of books) console.log(`  #${b.id} ${JSON.stringify(b.title)}  shopUrl ${b.shopUrl ? "SET" : "MISSING"}`);
if (!books.length) console.log("  (none)");

const ctaBooks = p?.ctaBooks ?? [];
console.log(`\nbooks attached to THIS job: ${ctaBooks.length}   <- gate B`);
for (const b of ctaBooks)
  console.log(
    `  block ${b.ctaIndex}: ${JSON.stringify(b.title)}  ` +
      `link ${b.trackingUrl ? "yes" : "NO"}  code ${b.qrImageUrl ? (b.qrVerified ? "yes" : "yes (unverified)") : "NO"}`
  );
if (!ctaBooks.length)
  console.log("  (none — with gate A empty too, every QR pass returns immediately)");

const list = Array.isArray(scenes) ? scenes : [];
const cta = list.filter(s => s.cta);
const count = f => list.filter(f).length;
console.log(`\nscenes: ${list.length} total, ${cta.length} inside a CTA block`);
console.log(`  qrHero   (big centred) ${count(s => s.qrHero)}`);
console.log(`  qrCorner (bottom-right) ${count(s => s.qrCorner)}`);
console.log(`  coverHero (cover reveal) ${count(s => s.coverHero)}`);
console.log(`  qrTail   (frozen hold)  ${count(s => s.qrTail)}`);

if (cta.length) {
  console.log(`\nper CTA scene:`);
  for (const s of cta) {
    const flags = [
      s.hostPresent ? "host" : "broll",
      s.qrHero && "qrHero",
      s.qrCorner && "qrCorner",
      s.coverHero && "coverHero",
      s.qrTail && "qrTail",
      s.assetImageUrl && "asset",
    ].filter(Boolean).join(" ");
    const book = ctaBooks.find(b => b.ctaIndex === s.ctaIndex);
    const code = s.qrHero || s.qrCorner || s.coverHero
      ? (book?.qrImageUrl ?? p?.qrImageUrl ? "DRAWS" : "no code -> BLANK")
      : "-";
    console.log(
      `  #${String(s.index).padStart(3)}  block ${s.ctaIndex ?? "-"}  ${flags.padEnd(34)} ${code}   ${JSON.stringify((s.narration ?? "").slice(0, 44))}`
    );
  }
}

const trigger = "Now go ahead and grab your phone";
const hits = list.filter(s => (s.scriptText ?? s.narration ?? "").includes(trigger)).length;
console.log(`\nanchor line ${JSON.stringify(trigger)}: ${hits} scene(s) contain it verbatim`);
if (!hits) console.log("  -> anchored path skipped; QR falls back to the tail-of-block heuristic");

await c.end();

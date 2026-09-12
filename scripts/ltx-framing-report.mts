/**
 * scripts/ltx-framing-report.mts — what the LTX lane would do with every host photo.
 *
 *   pnpm tsx scripts/ltx-framing-report.mts            # every channel's host photos in the DB
 *   pnpm tsx scripts/ltx-framing-report.mts a.jpg b.jpg # local files or URLs
 *
 * Runs `analyzeHostPhoto` (server/ltxFraming.ts) — the same detector and the same crop rule the
 * pipeline uses — and prints one row per photo: size, faces found, the host face's size as a
 * fraction of the frame, and the crop it would render (or why it would not). Read it BEFORE
 * trusting a new host photo: a face under a third of the frame gets cropped, a close-up is left
 * alone, and a photo where the detector finds nothing is rendered as is with that fact printed.
 */
import "dotenv/config";
import { readFile } from "fs/promises";
import { analyzeHostPhoto, describe, planLtxBase } from "../server/ltxFraming";

async function bytesFor(src: string): Promise<Buffer> {
  if (/^https?:\/\//.test(src)) {
    const { presignOwnBucketUrl } = await import("../server/storage");
    const res = await fetch(await presignOwnBucketUrl(src));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(src);
}

async function fromDb(): Promise<{ label: string; url: string }[]> {
  const { getDb } = await import("../server/db");
  const { channelConfigs, channelHostPhotos } =
    await import("../drizzle/schema");
  const db = await getDb();
  const channels = await db.select().from(channelConfigs);
  const photos = await db.select().from(channelHostPhotos);
  const out: { label: string; url: string }[] = [];
  for (const c of channels as any[]) {
    const own = (photos as any[]).filter(
      p => p.channelKey === c.channelKey && p.isActive !== false
    );
    const urls: string[] = own.length
      ? own.sort((a, b) => a.sortOrder - b.sortOrder).map(p => p.imageUrl)
      : [c.hostPhotoUrl, c.hostPhotoUrl2].filter(Boolean);
    urls.forEach((url, i) =>
      out.push({ label: `${c.channelKey ?? c.id} #${i}`, url })
    );
  }
  return out;
}

const args = process.argv.slice(2);
const items = args.length
  ? args.map(a => ({ label: a.split(/[\\/]/).pop()!, url: a }))
  : await fromDb();

if (!items.length) {
  console.log("no host photos found");
  process.exit(0);
}

const rows: string[][] = [
  [
    "photo",
    "size",
    "faces",
    "host face",
    "auto: base pass",
    "crop mode: window",
  ],
];
for (const it of items) {
  try {
    const f = await analyzeHostPhoto(await bytesFor(it.url));
    rows.push([
      it.label,
      `${f.photoW}x${f.photoH}`,
      String(f.faces),
      f.face
        ? `${f.face.size}px = ${Math.round((f.faceFrac ?? 0) * 100)}% (q ${f.face.q})`
        : "—",
      (() => {
        const b = planLtxBase(f.faceFrac);
        return f.face
          ? `${b.name} (face ${b.facePx} px)${b.capped ? " CAPPED — re-frame" : ""}`
          : "544p — no face";
      })(),
      f.crop
        ? `${f.crop.w}x${f.crop.h} @ (${f.crop.x},${f.crop.y}) → face ${Math.round((f.cropFaceFrac ?? 0) * 100)}%`
        : `as is — ${f.reason}`,
    ]);
    console.error(`  ${it.label}: ${describe(f)}`);
  } catch (e: any) {
    rows.push([it.label, "?", "?", "?", `FAILED: ${e?.message ?? e}`]);
  }
}
const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
for (const r of rows)
  console.log(r.map((c, i) => c.padEnd(widths[i])).join("  "));
process.exit(0);

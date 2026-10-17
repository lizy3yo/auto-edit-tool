/**
 * scripts/score-host-photos.mts — score every channel's host photos the way the picker does.
 *
 *   npx tsx scripts/score-host-photos.mts [--out DIR] [--channel KEY] [file.jpg ...]
 *
 * For each active library photo: the ORIGINAL and, when made, its PHONE LOOK, each measured and
 * scored by `server/hostPhotoScore.ts`, plus which photo the channel would use. Local files given
 * on the command line are scored too (candidate base photos before they are uploaded). Writes
 * <out>/scores.json and a face crop per photo (<out>/faces/) so a person can see what the numbers
 * describe.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getChannelHostPhotos, getDb } from "../server/db";
import { channelHostPhotos } from "../drizzle/schema";
import { presignOwnBucketUrl } from "../server/storage";
import { rateHostPhoto } from "../server/hostPhotoScore";
import { pickHostPhoto } from "../server/hostPhotoSelection";
import { usablePhoneLook } from "../shared/hostPhotoLook";

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const OUT = opt("--out") ?? "bench/host-fix/photo-scores";
const ONLY = opt("--channel");
mkdirSync(path.join(OUT, "faces"), { recursive: true });

async function load(url: string): Promise<Buffer> {
  const r = await fetch(await presignOwnBucketUrl(url), { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function faceSheet(name: string, buf: Buffer, m: { faceX: number; faceY: number; faceWidth: number; width: number; height: number }) {
  if (!m.faceWidth) return;
  const s = m.faceWidth * m.width * 1.6;
  const left = Math.max(0, Math.round(m.faceX * m.width - s / 2));
  const top = Math.max(0, Math.round(m.faceY * m.height - s / 2));
  await sharp(buf).rotate()
    .extract({ left, top, width: Math.min(Math.round(s), m.width - left), height: Math.min(Math.round(s), m.height - top) })
    .resize(400).jpeg({ quality: 85 }).toFile(path.join(OUT, "faces", `${name}.jpg`));
}

const rows: any[] = [];
const db = await getDb();
const keys = ONLY
  ? [ONLY]
  : [...new Set((await db!.select({ k: channelHostPhotos.channelKey }).from(channelHostPhotos)).map(r => r.k))];
for (const key of keys) {
  const photos = await getChannelHostPhotos(key, true);
  const scored = [];
  for (const p of photos) {
    const entry: any = { channel: key, id: p.id, sortOrder: p.sortOrder, isSelected: p.isSelected, useOriginal: p.useOriginal };
    for (const [label, url] of [["original", p.imageUrl], ["phone", usablePhoneLook(p)]] as const) {
      if (!url) continue;
      try {
        const buf = await load(url);
        const r = await rateHostPhoto(buf);
        entry[label] = { score: r.score, notes: r.notes, judged: r.judged, ...r.measure };
        await faceSheet(`${key}-${p.id}-${label}`, buf, r.measure);
      } catch (e: any) {
        entry[label] = { error: String(e?.message ?? e) };
      }
    }
    scored.push({ ...p, qualityScore: entry.original?.score ?? null });
    rows.push(entry);
    console.log(
      `${key.padEnd(28)} #${p.id}  original ${entry.original?.score ?? "-"}  phone ${entry.phone?.score ?? "-"}  ` +
        `skin ${entry.original?.judged?.skin ?? "-"}/${entry.phone?.judged?.skin ?? "-"}  mouth ${entry.original?.judged?.mouth ?? "-"}/${entry.phone?.judged?.mouth ?? "-"}  ` +
        `${(entry.original?.notes ?? []).join("; ")}`
    );
  }
  const pick = pickHostPhoto(scored);
  if (pick) console.log(`${key.padEnd(28)} → uses #${pick.id}`);
}
for (const file of argv) {
  const buf = readFileSync(file);
  const r = await rateHostPhoto(buf);
  rows.push({ file, score: r.score, notes: r.notes, judged: r.judged, ...r.measure });
  await faceSheet(path.basename(file).replace(/\.\w+$/, ""), buf, r.measure);
  console.log(`${path.basename(file).padEnd(40)} ${r.score}  skin ${r.measure.skinTexture}  mouth ${r.measure.mouthContrast}  ${r.notes.join("; ")}`);
}
writeFileSync(path.join(OUT, "scores.json"), JSON.stringify(rows, null, 2));
process.exit(0);

// One-off: copy the 21 music-bed mp3s from the old gardenflow CDN into THIS app's R2
// bucket, under the same `music/beds/<channel>/` keys that server/musicBeds.ts expects.
// After this runs, the app never touches cdn.gardenflows.com again.
//
// Usage: node scripts/migrate-music-beds.mjs
//   (reads R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET from .env)
import "dotenv/config";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const SOURCE_BASE = "https://cdn.gardenflows.com"; // old CDN — source of the copy only

const KEYS = [
  "garrys_lawn/bed-01.mp3",
  "garrys_lawn/bed-02.mp3",
  "petes_lawn_secrets/bed-01.mp3",
  "petes_lawn_secrets/bed-02.mp3",
  "david_wright/bed-01.mp3",
  "david_wright/bed-02.mp3",
  "david_yoder/bed-01.mp3",
  "david_yoder/bed-02.mp3",
  "elias_miller/bed-01.mp3",
  "elias_miller/bed-02.mp3",
  "roy_mullins/bed-01.mp3",
  "roy_mullins/bed-02.mp3",
  "travis_tiny_kolbe/bed-01.mp3",
  "travis_tiny_kolbe/bed-02.mp3",
  "wes_kingfisher/bed-01.mp3",
  "wes_kingfisher/bed-02.mp3",
  "debra_wilson/bed-01.mp3",
  "debra_wilson/bed-02.mp3",
  "donna_larsen/bed-02.mp3",
  "donna_larsen/bed-03.mp3",
].map(k => `music/beds/${k}`);

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } =
  process.env;
if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_BUCKET
) {
  console.error(
    "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env"
  );
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

let copied = 0,
  skipped = 0,
  failed = 0;
for (const key of KEYS) {
  // Idempotent: re-running skips objects that already landed.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    console.log(`skip (exists)  ${key}`);
    skipped++;
    continue;
  } catch {
    /* not there yet — copy it */
  }
  try {
    const res = await fetch(`${SOURCE_BASE}/${key}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: "audio/mpeg",
      })
    );
    console.log(`copied ${(body.length / 1e6).toFixed(1)}MB  ${key}`);
    copied++;
  } catch (err) {
    console.error(`FAILED ${key}: ${err.message}`);
    failed++;
  }
}
console.log(`\ndone: ${copied} copied, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Add channels read from the hosted app to the LOCAL tool: the channel's settings, its books and
// its host photos. A channel that already exists locally is skipped whole — nothing local is ever
// changed or overwritten. The hosted app is not contacted: the data file was read from it (read
// only) beforehand, and its pictures already live in the shared bucket, so the rows point at them.
//   (repo root) npx tsx scripts/channels/import-hosted-channels.mts scripts/channels/hosted-channels-2026-10-18.json [--dry]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createBook, createChannelHostPhoto, getChannelConfig, upsertChannelConfig } from "../../server/db";

type Hosted = {
  channelKey: string;
  displayName: string;
  hostName?: string;
  hostTitle?: string;
  authorName?: string;
  voiceId: string;
  voiceName?: string;
  ttsModel?: string;
  nicheSlug?: string;
  photos: string[];
  books: { title: string; cover?: string; shopUrl?: string }[];
};

const file = process.argv[2];
if (!file) throw new Error("usage: import-hosted-channels.mts <data.json> [--dry]");
const dry = process.argv.includes("--dry");
const data = JSON.parse(readFileSync(file, "utf8")) as { base: string; channels: Hosted[] };
const url = (p: string) => (/^https?:/.test(p) ? p : data.base + p);
/** The local bootstrap admin (id 1) owns what is imported, like every pre-accounts row. */
const OWNER = 1;

for (const c of data.channels) {
  if (await getChannelConfig(c.channelKey)) {
    console.log(`skip  ${c.channelKey} (already in the local tool)`);
    continue;
  }
  console.log(`add   ${c.channelKey}: ${c.photos.length} photo(s), ${c.books.length} book(s)${dry ? " (dry run)" : ""}`);
  if (dry) continue;
  await upsertChannelConfig(c.channelKey, {
    displayName: c.displayName,
    hostName: c.hostName ?? null,
    hostTitle: c.hostTitle ?? null,
    authorName: c.authorName ?? null,
    voiceId: c.voiceId,
    voiceName: c.voiceName ?? null,
    ttsModel: c.ttsModel ?? null,
    nicheSlug: c.nicheSlug ?? null,
    hostPhotoUrl: c.photos[0] ? url(c.photos[0]) : null,
    hostPhotoUrl2: c.photos[1] ? url(c.photos[1]) : null,
    createdBy: OWNER,
  } as never);
  // The first photo is the one the channel's latest hosted video was made from: picked by hand, so
  // the local tool renders the same host the hosted channel shows.
  for (const [i, p] of c.photos.entries())
    await createChannelHostPhoto({
      channelKey: c.channelKey,
      imageUrl: url(p),
      sortOrder: i,
      isActive: true,
      isSelected: i === 0,
      pickedByHand: i === 0,
      createdBy: OWNER,
    } as never);
  for (const b of c.books)
    await createBook({
      channelKey: c.channelKey,
      title: b.title,
      coverImageUrl: b.cover ? url(b.cover) : null,
      shopUrl: b.shopUrl ?? null,
      isActive: true,
      createdBy: OWNER,
    } as never);
}
process.exit(0);

// Export channel_configs + channel_layers from the OLD (gardenflow) database
// into scripts/channels.json, ready for scripts/seed.mjs.
//
// Usage:
//   OLD_DATABASE_URL="mysql://user:pass@host:port/db" node scripts/export-channels.mjs
//   Optionally: --channels haven,homesteadHank   (filter by channelKey)
import { createConnection } from "mysql2/promise";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.OLD_DATABASE_URL;
if (!url) {
  console.error("Set OLD_DATABASE_URL to the source (gardenflow) MySQL URL");
  process.exit(1);
}

const filterArg = process.argv.indexOf("--channels");
const filter =
  filterArg !== -1 && process.argv[filterArg + 1]
    ? process.argv[filterArg + 1].split(",").map(s => s.trim())
    : null;

const conn = await createConnection(url);
try {
  const [configs] = await conn.query("SELECT * FROM channel_configs");
  const [layers] = await conn.query("SELECT * FROM channel_layers");

  const keep = row =>
    !filter || filter.includes(row.channelKey ?? row.channel_key);
  const out = {
    exportedAt: new Date().toISOString(),
    channelConfigs: configs.filter(keep),
    channelLayers: layers.filter(keep),
  };

  const dest = join(dirname(fileURLToPath(import.meta.url)), "channels.json");
  writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(
    `Wrote ${out.channelConfigs.length} channel_configs + ${out.channelLayers.length} channel_layers → ${dest}`
  );
} finally {
  await conn.end();
}

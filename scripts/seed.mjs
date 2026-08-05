// Seed the longform-studio database:
//  1. One provider_configs row for 69Labs (isActive=1; key entered later via Admin UI)
//  2. Channels from scripts/channels.json if present (produced by export-channels.mjs)
//
// Usage: node scripts/seed.mjs   (reads DATABASE_URL from .env or the environment)
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL");
  process.exit(1);
}

const conn = await createConnection(url);
try {
  // ── 69Labs provider row ────────────────────────────────────────────────
  const [existing] = await conn.query(
    "SELECT id FROM provider_configs WHERE providerType = 'sixtynine_labs' LIMIT 1"
  );
  if (existing.length === 0) {
    await conn.query(
      "INSERT INTO provider_configs (providerType, displayName, isActive, connectionStatus) VALUES ('sixtynine_labs', '69Labs', 1, 'untested')"
    );
    console.log(
      "Seeded 69Labs provider row (active; add its key in Admin → Provider Keys)"
    );
  } else {
    console.log("69Labs provider row already present — skipped");
  }

  // ── Channels from channels.json ────────────────────────────────────────
  const jsonPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "channels.json"
  );
  if (!existsSync(jsonPath)) {
    console.log(
      "No scripts/channels.json — skipping channel import (create channels in Admin → Channels)"
    );
    process.exit(0);
  }
  const { channelConfigs, channelLayers } = JSON.parse(
    readFileSync(jsonPath, "utf8")
  );

  for (const row of channelConfigs ?? []) {
    const { id, createdAt, updatedAt, faceModelImageUrl, ...data } = row;
    const cols = Object.keys(data);
    const placeholders = cols.map(() => "?").join(", ");
    const updates = cols
      .filter(c => c !== "channelKey")
      .map(c => `\`${c}\` = VALUES(\`${c}\`)`)
      .join(", ");
    await conn.query(
      `INSERT INTO channel_configs (${cols.map(c => `\`${c}\``).join(", ")}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`,
      cols.map(c => data[c])
    );
  }
  console.log(`Upserted ${channelConfigs?.length ?? 0} channel_configs`);

  for (const row of channelLayers ?? []) {
    const { id, created_at, updated_at, ...data } = row;
    const cols = Object.keys(data);
    const placeholders = cols.map(() => "?").join(", ");
    const updates = cols
      .filter(c => c !== "channel_key")
      .map(c => `\`${c}\` = VALUES(\`${c}\`)`)
      .join(", ");
    await conn.query(
      `INSERT INTO channel_layers (${cols.map(c => `\`${c}\``).join(", ")}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`,
      cols.map(c => data[c])
    );
  }
  console.log(`Upserted ${channelLayers?.length ?? 0} channel_layers`);
} finally {
  await conn.end();
}

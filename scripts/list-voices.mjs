// List every voice the configured 69Labs account can see, and optionally check
// whether a specific voice ID is among them — the diagnostic for
// `400 "This voice ID was not found"` TTS failures (a custom/cloned voice only
// resolves for the ACCOUNT whose API key the app uses).
//
// Usage:
//   node scripts/list-voices.mjs [voiceIdToCheck]
//
// Key resolution (never printed):
//   1. SIXTYNINE_LABS_API_KEY in .env / environment, else
//   2. decrypted from the provider_configs row (needs DATABASE_URL + JWT_SECRET —
//      point DATABASE_URL at the Railway DB to check the production account).
import "dotenv/config";
import crypto from "node:crypto";

const BASE_URL = "https://69labs.vip/api/v1";
const checkId = process.argv[2];

async function resolveApiKey() {
  if (process.env.SIXTYNINE_LABS_API_KEY)
    return process.env.SIXTYNINE_LABS_API_KEY;
  const url = process.env.DATABASE_URL;
  const secret = process.env.JWT_SECRET;
  if (!url || !secret) {
    console.error(
      "Set SIXTYNINE_LABS_API_KEY, or DATABASE_URL + JWT_SECRET to read the stored key."
    );
    process.exit(1);
  }
  const { createConnection } = await import("mysql2/promise");
  const conn = await createConnection(url);
  try {
    const [rows] = await conn.query(
      "SELECT apiKeyEncrypted FROM provider_configs WHERE providerType = 'sixtynine_labs' AND isActive = 1 LIMIT 1"
    );
    const enc = rows[0]?.apiKeyEncrypted;
    if (!enc) {
      console.error(
        "No active 69Labs provider row with a stored key — add it in Admin → Provider Keys."
      );
      process.exit(1);
    }
    // Same scheme as server/encryption.ts — the salt is load-bearing.
    const key = crypto.scryptSync(secret, "longform-studio", 32);
    const [ivHex, tagHex, data] = enc.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(data, "hex", "utf8") + decipher.final("utf8");
  } finally {
    await conn.end();
  }
}

const apiKey = await resolveApiKey();
const headers = { Authorization: `Bearer ${apiKey}` };

// GET /voice-clones is the account's clone library (the shape the 69Labs web app uses).
// NOTE: these IDs do NOT resolve on /tts/generate — the server routes them through
// POST /voice-clones/generate (see server/tts69labs.ts).
let voices = null;
const resp = await fetch(`${BASE_URL}/voice-clones`, { headers });
console.log(`GET /voice-clones → ${resp.status}`);
if (resp.ok) {
  const body = await resp.json().catch(() => null);
  const list = Array.isArray(body) ? body : (body?.voiceClones ?? null);
  if (Array.isArray(list)) voices = list;
  else {
    console.log("  (200 but unrecognized shape — raw below)");
    console.log(JSON.stringify(body, null, 2).slice(0, 4000));
  }
}

if (!voices) {
  console.error(
    "\nNo clone list returned. A 401 means the API key is invalid/expired; anything else, " +
      "share the raw output above."
  );
  process.exit(1);
}

console.log(`\n${voices.length} voice clone(s) in this account:\n`);
for (const v of voices) {
  const id = v.id ?? v.voiceId ?? "?";
  const name = v.name ?? "?";
  console.log(
    `  ${String(id).padEnd(38)} ${String(name).padEnd(28)} status=${v.status ?? "?"}`
  );
}

if (checkId) {
  const hit = voices.find(v => [v.id, v.voiceId].includes(checkId));
  console.log(
    hit
      ? `\n✔ ${checkId} IS one of this account's voice clones ("${hit.name ?? "?"}").` +
          `\n  The server auto-routes it through POST /voice-clones/generate.`
      : `\n✘ ${checkId} is NOT visible to this account. The app's API key belongs to a` +
          `\n  different 69Labs account than the one holding this voice clone — either store` +
          `\n  THAT account's API key in Admin → Provider Keys, or use one of the IDs above` +
          `\n  in Admin → Channels.`
  );
}

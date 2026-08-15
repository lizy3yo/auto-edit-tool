/**
 * Pre-flight for a longform render: resolve the exact per-channel values the pipeline reads,
 * then probe every external dependency with a CHEAP call (list/quota endpoints — nothing that
 * generates or spends provider credit).
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { getChannelLayer } from "../server/composer.ts";
import { extractBookName, extractProductUrl } from "../server/ctaDetector.ts";
import { decrypt } from "../server/encryption.ts";
import { storagePut } from "../server/storage.ts";

const line = (n: string, ok: boolean | null, msg: string) =>
  console.log(
    `${ok === null ? "??" : ok ? "OK" : "!!"}  ${n.padEnd(22)} ${msg}`
  );

async function probe(
  name: string,
  url: string,
  headers: Record<string, string>
) {
  try {
    const r = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    const body = r.ok
      ? ""
      : ` ${(await r.text().catch(() => "")).slice(0, 110)}`;
    line(name, r.ok, `HTTP ${r.status}${body}`);
  } catch (e: any) {
    line(name, false, e.message);
  }
}

console.log("── channel resolution (what generate actually reads) ──");
const layer = await getChannelLayer("roger_the_pipe_guy");
line(
  "channel layer",
  !!layer,
  layer ? `${layer.layerContent.length} chars, "${layer.name}"` : "NONE"
);
const book = layer ? extractBookName(layer.layerContent) : null;
line("book title", !!book, book ?? "NOT FOUND — cover reveal will be skipped");
const purl = layer ? extractProductUrl(layer.layerContent) : null;
line("product URL", !!purl, purl ?? "NOT FOUND");

console.log("\n── stored keys ──");
const conn = await createConnection({ uri: process.env.DATABASE_URL! });
const [pc] = (await conn.query(
  "SELECT apiKeyEncrypted FROM provider_configs WHERE providerType='sixtynine_labs' AND isActive=1"
)) as any[];
let sixtyNine: string | null = null;
try {
  sixtyNine = pc[0]?.apiKeyEncrypted ? decrypt(pc[0].apiKeyEncrypted) : null;
  line("69Labs key", !!sixtyNine, sixtyNine ? "decrypts cleanly" : "absent");
} catch (e: any) {
  line(
    "69Labs key",
    false,
    `DECRYPT FAILED — ${e.message} (JWT_SECRET rotated?)`
  );
}
const [st] = (await conn.query(
  "SELECT `key`,value FROM app_settings"
)) as any[];
const slots: Record<string, string> = {};
for (const r of st) {
  try {
    slots[r.key] = decrypt(JSON.parse(r.value).enc);
    line(r.key, true, "decrypts cleanly");
  } catch (e: any) {
    line(r.key, false, `decrypt failed — ${e.message}`);
  }
}
for (const k of ["heygen_key_slot_0", "apimart_key_edit"])
  if (!(k in slots)) line(k, null, "not set (falls back to env / disabled)");
await conn.end();

console.log("\n── external dependencies ──");
if (process.env.ANTHROPIC_API_KEY)
  await probe("Anthropic", "https://api.anthropic.com/v1/models?limit=1", {
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  });
if (process.env.OPENAI_API_KEY)
  await probe("OpenAI", "https://api.openai.com/v1/models", {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  });
if (process.env.GEMINI_API_KEY)
  // models.list does NOT consume the generate_content quota — safe to call while exhausted.
  await probe(
    "Gemini (list)",
    `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}&pageSize=1`,
    {}
  );
const heygenKey = slots["heygen_key_slot_0"] ?? process.env.HEYGEN_API_KEY;
if (heygenKey)
  await probe(
    "HeyGen quota",
    "https://api.heygen.com/v2/user/remaining_quota",
    {
      "x-api-key": heygenKey,
    }
  );
if (slots["apimart_key_slot_0"])
  await probe("APIMART", "https://api.apimart.ai/v1/models", {
    Authorization: `Bearer ${slots["apimart_key_slot_0"]}`,
  });
if (sixtyNine)
  await probe(
    "69Labs",
    "https://69labs.vip/api/v1/tts/status/healthcheck-probe",
    {
      Authorization: `Bearer ${sixtyNine}`,
    }
  );

// RunPod: the pipeline builds https://api.runpod.ai/v2/<endpoint>/run — empty endpoint = 401.
const ep = process.env.RUNPOD_WHISPERX_ENDPOINT;
line(
  "RunPod whisperx",
  !!ep,
  ep
    ? `endpoint set (${ep})`
    : "RUNPOD_WHISPERX_ENDPOINT MISSING — proportional slicing fallback"
);

try {
  const { url } = await storagePut(
    `diagnostics/health-${process.pid}.txt`,
    Buffer.from("x"),
    "text/plain"
  );
  const r = await fetch(url);
  line("R2 round-trip", r.ok && !url.includes(".r2.dev//"), `HTTP ${r.status}`);
} catch (e: any) {
  line("R2 round-trip", false, e.message);
}

// getChannelLayer opens a drizzle pool that keeps the event loop alive; without this the
// process never exits and piped stdout is never flushed.
process.exit(0);

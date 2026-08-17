/**
 * server/composer.ts (trimmed for longform-studio)
 *
 * Only the channel-layer resolution survives here: longform prompt composition
 * reads the per-channel prompt layer via raw SQL. A channel with no authored
 * layer simply has none — the persona that used to be synthesized from
 * `channel_configs.personaProfile` now comes from the render's own prompt.
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";

export interface ChannelLayer {
  id: number;
  channelKey: string;
  name: string;
  layerContent: string;
  isActive: boolean;
}

export async function getChannelLayer(
  channelKey: string
): Promise<ChannelLayer | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.execute(
    sql`SELECT * FROM channel_layers WHERE channel_key = ${channelKey} AND is_active = 1 LIMIT 1`
  );
  const data = (rows as any)[0];
  if (data && data.length > 0) {
    const r = data[0];
    return {
      id: r.id,
      channelKey: r.channel_key,
      name: r.name,
      layerContent: r.layer_content,
      isActive: Boolean(r.is_active),
    };
  }

  // No authored `channel_layers` row ⇒ no layer. There used to be a fallback here
  // that synthesized one from `channel_configs.personaProfile`, but the persona is
  // no longer a channel setting — it is written into the prompt per render, so a
  // stored profile silently prepending itself to every style bible was the opposite
  // of that. The column and its rows are untouched; nothing reads them.
  //
  // Returning null is a supported path, not a degraded one: `deriveStyleBible` and
  // `deriveVisualDirection` both omit the persona block and derive the world from
  // the script alone.
  return null;
}

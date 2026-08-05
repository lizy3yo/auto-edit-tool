/**
 * server/composer.ts (trimmed for longform-studio)
 *
 * Only the channel-layer resolution survives here: longform prompt composition
 * reads the per-channel prompt layer via raw SQL, with a fallback that
 * synthesizes a layer from CHANNEL_PROFILES / channel_configs persona text.
 */

import { getDb, getChannelConfig } from "./db";
import { sql } from "drizzle-orm";
import { CHANNEL_PROFILES } from "../shared/constants";

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

  // Fallback: no channel_layers row (e.g. dynamic channels created via
  // channel_configs without an authored layer). Synthesize a layer from the
  // channel's persona text: static CHANNEL_PROFILES first, then channel_configs.
  const staticProfile = CHANNEL_PROFILES[channelKey];
  const config = await getChannelConfig(channelKey);
  const personaText = staticProfile?.profile ?? config?.personaProfile ?? null;
  if (!personaText) return null;

  return {
    id: 0,
    channelKey,
    name: config?.displayName ?? staticProfile?.name ?? channelKey,
    layerContent: personaText,
    isActive: true,
  };
}

/**
 * The ONE "may this account change this?" check for everything that is not a video (videos go
 * through `assertJobAccess`, which asks the same rule).
 *
 * A guest sees what an operations manager sees and may change only what they created — a
 * channel, a book, a CTA asset, a host photo, a test or VSL run (`mayEditOwned` in
 * `shared/roles.ts`). Every route that changes one of those calls a helper here; a tripwire in
 * `ownership.test.ts` fails if one is added without it.
 *
 * No database read is made for an account the rule does not bind: the owner is only looked up
 * when the answer depends on it.
 */
import { TRPCError } from "@trpc/server";
import { VIEW_ONLY_ERR_MSG } from "../shared/const";
import { mayEditOwned, type Account } from "../shared/roles";
import { getChannelConfig, getHeygenTestBatch } from "./db";

type Actor = { id: number } & Account;

/** True when the rule cannot refuse this account whoever the owner is — so no lookup is needed. */
const unbound = (user: Actor) => mayEditOwned(user, null);

/** Refuse unless `user` may change something `ownerId` created. */
export function assertMayEdit(
  user: Actor,
  ownerId: number | null | undefined
): void {
  if (!mayEditOwned(user, ownerId))
    throw new TRPCError({ code: "FORBIDDEN", message: VIEW_ONLY_ERR_MSG });
}

/**
 * Refuse unless `user` may change this CHANNEL — its settings, and what it holds: adding a
 * book, an asset or a host photo to a channel changes that channel. A channel that does not
 * exist is nobody's.
 */
export async function assertChannelEditable(
  user: Actor,
  channelKey: string
): Promise<void> {
  if (unbound(user)) return;
  const channel = await getChannelConfig(channelKey);
  assertMayEdit(user, channel?.createdBy);
}

/** Whether `user` may change this channel — `assertChannelEditable` as a yes/no. */
export async function canEditChannel(
  user: Actor,
  channelKey: string
): Promise<boolean> {
  if (unbound(user)) return true;
  return mayEditOwned(user, (await getChannelConfig(channelKey))?.createdBy);
}

/** Refuse unless `user` may change this existing book, asset or host photo. */
export async function assertItemEditable(
  user: Actor,
  load: () => Promise<{ createdBy: number | null } | null>
): Promise<void> {
  if (unbound(user)) return;
  assertMayEdit(user, (await load())?.createdBy);
}

/** Refuse unless `user` may change this HeyGen test or VSL run (rename, retry, "use this one"). */
export async function assertRunEditable(
  user: Actor,
  batchId: string
): Promise<void> {
  if (unbound(user)) return;
  const rows = await getHeygenTestBatch(batchId);
  assertMayEdit(user, rows[0]?.userId);
}

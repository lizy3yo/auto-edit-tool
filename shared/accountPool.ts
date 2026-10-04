/**
 * The provider account pool: APIMART (b-roll clips) and HeyGen (host lip-sync) keys are a LIST of
 * accounts, and every new video takes the least busy one.
 *
 * They used to belong to tab numbers — `apimart_key_slot_N` was "tab N+1's key" — and every user
 * has their own five tabs, so everyone's tab 1 rendered on the same account while account 5 sat
 * idle, and a sixth account could not be added at all. The stored rows are unchanged (account N
 * is still `…_key_slot_N`), so the five keys entered before the pool are accounts 1–5.
 *
 * Pure, and shared so the Admin page and the server agree on how many accounts there can be.
 */

/** How many accounts of each provider Admin can hold. Tabs stay at five per user. */
export const PROVIDER_ACCOUNT_MAX = 20;

/** The fields of a job's `inputParams` that say which account it renders on. */
export type JobAccounts = {
  apimartAccount?: number | null;
  heygenAccount?: number | null;
  /** Jobs made before the pool: the tab number, which picked both keys. */
  apimartSlot?: number | null;
};

const valid = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;

/** The APIMART account a job renders its b-roll clips on, or null when it has none. */
export function apimartAccountOf(params: JobAccounts): number | null {
  if (valid(params.apimartAccount)) return params.apimartAccount;
  return valid(params.apimartSlot) ? params.apimartSlot : null;
}

/** The HeyGen account a job lip-syncs its host on, or null (⇒ the shared `HEYGEN_API_KEY`). */
export function heygenAccountOf(params: JobAccounts): number | null {
  if (valid(params.heygenAccount)) return params.heygenAccount;
  return valid(params.apimartSlot) ? params.apimartSlot : null;
}

/** How many of the running videos are on each account. */
export function countByAccount(busy: (number | null)[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const a of busy) if (a != null) counts.set(a, (counts.get(a) ?? 0) + 1);
  return counts;
}

/**
 * The account a new video takes: the one with the fewest videos running on it, the lowest number
 * on a tie. `configured` is the accounts that have a key; `busy` is one entry per running video.
 * Null when no account has a key.
 */
export function pickLeastBusyAccount(
  configured: number[],
  busy: (number | null)[]
): number | null {
  const counts = countByAccount(busy);
  let best: number | null = null;
  for (const account of [...configured].sort((a, b) => a - b)) {
    if (best == null || (counts.get(account) ?? 0) < (counts.get(best) ?? 0))
      best = account;
  }
  return best;
}

/**
 * Which provider account a new video renders on — the server half of `shared/accountPool.ts`.
 *
 * `assignJobAccounts` is the one place a video is given its accounts. It holds an in-process
 * lock from reading the load to the job row being written (single process, so that is the whole
 * race): two Generate clicks landing together would otherwise both read "Account 3 is free" and
 * both take it.
 */
import {
  PROVIDER_ACCOUNT_MAX,
  countByAccount,
  pickLeastBusyAccount,
} from "../shared/accountPool";
import {
  pickHeygenTestAccount,
  slotToAccount,
  type HeygenTestAccount,
} from "../shared/heygenTest";
import { ENV } from "./_core/env";
import { getProcessingJobAccounts, getUnfinishedHeygenTests } from "./db";
import {
  getApimartSlotMasked,
  getHeygenSlotMasked,
  getHeygenTestMasked,
} from "./longformVideo";

export type PoolProvider = "apimart" | "heygen";

const maskedFor = (provider: PoolProvider) =>
  provider === "apimart" ? getApimartSlotMasked : getHeygenSlotMasked;

/**
 * The accounts of a provider that have a key, lowest first. Read off the stored row's masked
 * tail — no decrypt, which costs a key derivation each (`server/encryption.ts`).
 */
export async function configuredAccounts(
  provider: PoolProvider
): Promise<number[]> {
  const masked = await Promise.all(
    Array.from({ length: PROVIDER_ACCOUNT_MAX }, (_, account) =>
      maskedFor(provider)(account)
    )
  );
  return masked.flatMap((m, account) => (m ? [account] : []));
}

/** How many videos are rendering on each account right now. */
export async function accountLoad(): Promise<
  Record<PoolProvider, Map<number, number>>
> {
  const busy = await getProcessingJobAccounts();
  return {
    apimart: countByAccount(busy.map(b => b.apimart)),
    heygen: countByAccount(busy.map(b => b.heygen)),
  };
}

export type AssignedAccounts = {
  apimartAccount?: number;
  heygenAccount?: number;
};

let lock: Promise<unknown> = Promise.resolve();

/** Run `fn` alone: every pick reads the load and writes its row before the next one reads. */
function withAccountLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn);
  lock = run.catch(() => undefined);
  return run;
}

/**
 * Every HeyGen render in flight, by the account it is on: each processing film's host account
 * (the shared key when it has none) and each unfinished HeyGen test / VSL clip's. Films and
 * tests count against the SAME number, so neither piles onto an account the other is using.
 */
async function heygenBusy(): Promise<HeygenTestAccount[]> {
  const [films, tests] = await Promise.all([
    getProcessingJobAccounts(),
    getUnfinishedHeygenTests(),
  ]);
  return [
    ...films.map(f => f.heygen ?? ("shared" as const)),
    ...tests.map(t => slotToAccount(t.heygenSlot)),
  ];
}

/**
 * Pick the account a HeyGen test or VSL run renders on (`pickHeygenTestAccount`) and hand it
 * to `create`, which must write the run's rows before it returns. Null ⇒ no HeyGen key at all.
 */
export function assignHeygenTestAccount<T>(
  create: (account: HeygenTestAccount | null) => Promise<T>
): Promise<T> {
  return withAccountLock(async () => {
    const [pool, testMasked, busy] = await Promise.all([
      configuredAccounts("heygen"),
      getHeygenTestMasked(),
      heygenBusy(),
    ]);
    return create(
      pickHeygenTestAccount({
        testKey: !!testMasked,
        pool,
        sharedKey: !!ENV.heygenApiKey,
        busy,
      })
    );
  });
}

/**
 * Pick the least busy account of each provider and hand them to `create`, which must write the
 * job row (status `processing`) before it returns — that row is what the next pick counts.
 * An account left undefined means no account of that provider has a key: b-roll then fails loud
 * and the host falls back to the shared `HEYGEN_API_KEY`, exactly as a keyless tab used to.
 */
export function assignJobAccounts<T>(
  create: (accounts: AssignedAccounts) => Promise<T>
): Promise<T> {
  return withAccountLock(async () => {
    const [apimart, heygen, busy, heygenRenders] = await Promise.all([
      configuredAccounts("apimart"),
      configuredAccounts("heygen"),
      getProcessingJobAccounts(),
      heygenBusy(),
    ]);
    return create({
      apimartAccount:
        pickLeastBusyAccount(
          apimart,
          busy.map(b => b.apimart)
        ) ?? undefined,
      heygenAccount:
        pickLeastBusyAccount(
          heygen,
          heygenRenders.map(a => (typeof a === "number" ? a : null))
        ) ?? undefined,
    });
  });
}

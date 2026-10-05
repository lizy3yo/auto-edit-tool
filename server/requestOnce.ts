/**
 * A paid click that is asked twice runs once.
 *
 * On a weak connection the request can reach the server and the ANSWER get lost: the page
 * shows an error, the person clicks Generate again, and two films are made and paid for. The
 * page now sends an id with each such click and sends the SAME id again when the last try was
 * never answered (`client/src/lib/requestId.ts`); a repeat gets the first one's result.
 *
 * In memory, like every other lock here (one process — see CLAUDE.md). A restart forgets, and
 * so does a failure: a run that threw is not remembered, so trying again really tries again.
 */

const REMEMBER_MS = 15 * 60_000;

const runs = new Map<string, { result: Promise<unknown>; at: number }>();

export function once<T>(
  route: string,
  userId: number,
  requestId: string | undefined,
  run: () => Promise<T>,
  now: () => number = Date.now
): Promise<T> {
  // No id (an older page still open): exactly the behaviour before this existed.
  if (!requestId) return run();
  runs.forEach((v, k) => {
    if (now() - v.at > REMEMBER_MS) runs.delete(k);
  });
  // Per route and per account: an id is only ever compared with that person's own clicks.
  const key = `${route}:${userId}:${requestId}`;
  const known = runs.get(key);
  if (known) return known.result as Promise<T>;
  const result = run();
  runs.set(key, { result, at: now() });
  result.catch(() => {
    if (runs.get(key)?.result === result) runs.delete(key);
  });
  return result;
}

/** Test hook: forget everything, as a fresh process would. */
export function _resetOnceForTest(): void {
  runs.clear();
}

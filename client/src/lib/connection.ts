import { useSyncExternalStore } from "react";
import { linkQuality, type LinkQuality } from "@shared/weakNetwork";

/**
 * How the connection is doing right now, for the whole page: the poll asks less often on a weak
 * one, the player starts on the light video, and the banner says so. Measured, not guessed —
 * `navigator.connection` exists in Chromium only and reports the link's class, not what this
 * server's answers are actually taking.
 */

/**
 * Requests whose server side is one quick database read, so the time they take is the
 * connection's. Anything else (a mutation that calls a provider, an upload) says nothing about
 * the link, and is never timed or cut off.
 */
const QUICK = new Set([
  "auth.me",
  "longformVideo.pollJob",
  "longformVideo.takeoverState",
  "longformVideo.getSlots",
  "activity.list",
]);
/** A quick request still unanswered after this is abandoned, so the next poll is not stuck behind it. */
export const QUICK_TIMEOUT_MS = 30_000;

/** True when every call in a tRPC batch URL is a quick one. */
export function isQuickBatch(url: string): boolean {
  const path = url.split("?")[0];
  const names = path.slice(path.lastIndexOf("/") + 1).split(",");
  return names.every(n => QUICK.has(n));
}

export type ConnectionState = { online: boolean; quality: LinkQuality };

const samples: number[] = [];
let state: ConnectionState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  quality: "good",
};
const listeners = new Set<() => void>();

const saveData = () =>
  typeof navigator !== "undefined" &&
  (navigator as { connection?: { saveData?: boolean } }).connection
    ?.saveData === true;

function publish(next: ConnectionState) {
  if (next.online === state.online && next.quality === state.quality) return;
  state = next;
  listeners.forEach(l => l());
}

/** Record how long a quick request took. The middle of the last three, so one blip is not a verdict. */
export function recordRoundTrip(ms: number) {
  samples.push(ms);
  if (samples.length > 3) samples.shift();
  const middle = [...samples].sort((a, b) => a - b)[samples.length >> 1];
  // An answer arrived, so we are online whatever the browser's own flag says.
  publish({ online: true, quality: linkQuality(middle, saveData()) });
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => publish({ ...state, online: true }));
  window.addEventListener("offline", () =>
    publish({ ...state, online: false })
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const getConnection = () => state;
export const useConnection = () =>
  useSyncExternalStore(subscribe, getConnection, getConnection);

/**
 * `fetch` for the tRPC link: times quick requests (that is the measurement) and gives them a
 * time limit. Everything else passes straight through.
 */
export async function measuredFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  if (!isQuickBatch(url)) return globalThis.fetch(input, init);
  const limit = AbortSignal.timeout(QUICK_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
  const started = performance.now();
  try {
    const res = await globalThis.fetch(input, { ...init, signal });
    // Time to the first byte: the caller reads the body, and reading it here too would
    // download it twice. A weak link shows in the wait just the same.
    recordRoundTrip(performance.now() - started);
    return res;
  } catch (err) {
    if (limit.aborted) recordRoundTrip(QUICK_TIMEOUT_MS);
    throw err;
  }
}

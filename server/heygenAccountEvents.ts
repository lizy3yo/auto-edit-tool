/**
 * "Which HeyGen accounts are free may have just changed."
 *
 * Fired from the db helpers wherever a film's or a HeyGen test's STATUS is written, and heard by
 * the live account stream on the HeyGen test page (`server/heygenAccountStream.ts`), which
 * recomputes and pushes the free list. A signal, not a payload: listeners re-read the database,
 * so a missed or doubled event costs one query, never a wrong answer.
 *
 * In-memory — fine because the app is single-process by design (see CLAUDE.md).
 */
import { EventEmitter } from "node:events";

const bus = new EventEmitter();
// One listener per open HeyGen test page; the default cap of 10 would warn on a busy day.
bus.setMaxListeners(0);

export function notifyHeygenAccountsChanged(): void {
  bus.emit("changed");
}

/** Subscribe; returns the unsubscribe. */
export function onHeygenAccountsChanged(listener: () => void): () => void {
  bus.on("changed", listener);
  return () => bus.off("changed", listener);
}

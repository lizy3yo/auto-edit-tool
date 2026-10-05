import { createHash } from "node:crypto";

/**
 * A short fingerprint of a poll answer. The page sends back the one it holds (`have`) and, when
 * the answer has not changed, gets the fingerprint alone instead of the whole storyboard — a
 * rendering video was re-sending every scene, its prompts and the script every 3 s to every
 * open tab, which is most of what the page needed a fast connection for.
 *
 * Hashed from the answer itself rather than from a version column: `updatedAt` is the
 * heartbeat (it moves every minute with nothing changed), and half of the answer is not on the
 * job row at all (the scene-edit queue, a takeover, the retry flag).
 */
export function pollRevision(payload: unknown): string {
  return createHash("sha1")
    .update(JSON.stringify(payload) ?? "")
    .digest("base64url")
    .slice(0, 20);
}

/** The whole answer, or only its fingerprint when the caller already holds it. */
export function answerPoll<T extends object>(
  payload: T,
  have: string | undefined
): ({ unchanged: false; rev: string } & T) | { unchanged: true; rev: string } {
  const rev = pollRevision(payload);
  return have === rev
    ? { unchanged: true, rev }
    : { ...payload, unchanged: false, rev };
}

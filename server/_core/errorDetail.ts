/**
 * Undici's `fetch` reports every connection-level failure as the same opaque
 * `TypeError: fetch failed`, hiding the real reason (DNS, refused, TLS, connect
 * timeout) one level down in `err.cause`. Storing the bare message meant a whole
 * render's worth of scenes surfaced "fetch failed" with nothing to act on.
 *
 * `describeError` walks the cause chain and appends the first thing that
 * actually names the failure, so a persisted `scene.error` stays diagnosable
 * after the process that produced it is gone.
 */
export function describeError(err: unknown): string {
  const base =
    (err as any)?.message ?? (typeof err === "string" ? err : String(err));

  const parts: string[] = [];
  let cause: any = (err as any)?.cause;
  // Cause chains are 1-2 deep in practice; the bound is a cycle guard.
  for (let depth = 0; cause && depth < 4; depth++) {
    const code = cause.code ? String(cause.code) : "";
    const msg = cause.message ? String(cause.message) : "";
    const detail = [code, msg].filter(Boolean).join(": ");
    // Skip a cause that only repeats what the outer message already says.
    if (detail && !base.includes(detail) && !parts.includes(detail)) {
      parts.push(detail);
    }
    cause = cause.cause;
  }

  // undici hangs the target host off the socket-level cause, not the message.
  const host = (err as any)?.cause?.hostname ?? (err as any)?.hostname;
  if (host && !base.includes(host)) parts.push(`host=${host}`);

  return parts.length ? `${base} (${parts.join("; ")})` : base;
}

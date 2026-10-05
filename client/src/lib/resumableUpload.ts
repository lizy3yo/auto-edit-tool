import {
  PART_ATTEMPTS,
  partCount,
  partRange,
  partRetryDelayMs,
  partsToSend,
} from "@shared/uploadParts";

/**
 * Send a narration file in small pieces (`shared/uploadParts.ts`). A piece that fails is tried
 * again on its own; picking the same file again after a failure — even after a reload — sends
 * only the pieces the server does not already hold.
 */

const BASE = "/api/narration-upload";

/**
 * The upload's id, remembered per FILE (name, size, last change) for this browser tab, which is
 * what lets a second try find the first one's pieces.
 */
function uploadIdFor(file: File): string {
  const key = `narration-upload:${file.name}:${file.size}:${file.lastModified}`;
  try {
    const known = sessionStorage.getItem(key);
    if (known) return known;
  } catch {
    // No storage: the upload still works, it just cannot be resumed after a reload.
  }
  const id = crypto.randomUUID().replace(/-/g, "");
  try {
    sessionStorage.setItem(key, id);
  } catch {
    // As above.
  }
  return id;
}

function forget(file: File) {
  try {
    sessionStorage.removeItem(
      `narration-upload:${file.name}:${file.size}:${file.lastModified}`
    );
  } catch {
    // Nothing was remembered.
  }
}

/** Resolves when the browser is back online, or at once if it already is. */
const backOnline = () =>
  navigator.onLine
    ? Promise.resolve()
    : new Promise<void>(resolve =>
        window.addEventListener("online", () => resolve(), { once: true })
      );

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type Held = { index: number; bytes: number }[];

async function askHeld(id: string): Promise<Held> {
  try {
    const res = await fetch(`${BASE}/${id}`, { credentials: "include" });
    const body = await res.json();
    return Array.isArray(body?.held) ? body.held : [];
  } catch {
    return []; // could not ask: send everything, which is always correct
  }
}

async function sendPart(id: string, file: File, index: number) {
  const [start, end] = partRange(index, file.size);
  for (let attempt = 1; ; attempt++) {
    await backOnline();
    try {
      const res = await fetch(`${BASE}/${id}/part/${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(start, end),
        credentials: "include",
      });
      if (res.ok) return;
      // A refusal (not signed in, too large) will not change by asking again.
      if (res.status < 500 && res.status !== 408 && res.status !== 429) {
        const body = await res.json().catch(() => ({}) as any);
        throw Object.assign(
          new Error(body?.error || `Upload failed (${res.status})`),
          { final: true }
        );
      }
    } catch (e: any) {
      if (e?.final) throw e;
    }
    if (attempt >= PART_ATTEMPTS)
      throw new Error(
        "The connection kept dropping. What was sent is saved — choose the same file again to continue."
      );
    await wait(partRetryDelayMs(attempt));
  }
}

export async function uploadNarrationInParts(
  file: File,
  onProgress: (fraction: number) => void
): Promise<{ url: string; durationSec: number }> {
  const id = uploadIdFor(file);
  const total = partCount(file.size);
  let todo = partsToSend(file.size, await askHeld(id));
  onProgress((total - todo.length) / total);

  // Twice at most: a piece the server lost between the two steps is sent once more.
  for (let round = 0; ; round++) {
    for (const index of todo) {
      await sendPart(id, file, index);
      onProgress(
        Math.min(1, (total - todo.length + todo.indexOf(index) + 1) / total)
      );
    }
    await backOnline();
    const res = await fetch(`${BASE}/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: total,
        contentType: file.type || "audio/mpeg",
      }),
      credentials: "include",
    });
    const body = await res.json().catch(() => ({}) as any);
    if (res.ok) {
      forget(file);
      return body;
    }
    if (res.status === 409 && round === 0 && Array.isArray(body?.held)) {
      todo = partsToSend(file.size, body.held);
      continue;
    }
    // The file itself was refused (wrong type, no audio in it): a fresh try starts clean.
    if (res.status < 500) forget(file);
    throw new Error(body?.error || `Upload failed (${res.status})`);
  }
}

import { useRef } from "react";

/**
 * The id sent with a paid click (`server/requestOnce.ts`), so a click whose answer was lost on
 * a weak connection can be clicked again without paying twice.
 *
 * The SAME id goes out again only when the last try was never answered and asks for exactly
 * the same thing. Once the server has answered — yes or no — the next click is a new request.
 */
export function useRequestId() {
  const last = useRef<{ asked: string; id: string } | null>(null);
  return {
    idFor(input: unknown): string {
      const asked = JSON.stringify(input);
      if (last.current?.asked !== asked)
        last.current = { asked, id: crypto.randomUUID() };
      return last.current.id;
    },
    /** Call from onSuccess, and from onError with the error. */
    settled(error?: unknown) {
      // A tRPC error the SERVER sent carries `data`; a request that never got an answer
      // (connection dropped, timed out) does not — that is the one to keep the id for.
      const unanswered = !!error && (error as { data?: unknown }).data == null;
      if (!unanswered) last.current = null;
    },
  };
}

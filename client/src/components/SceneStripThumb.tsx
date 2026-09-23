import { useEffect, useRef, useState } from "react";
import { Loader2, CloudOff } from "lucide-react";
import { createLoadGate } from "@/components/loadGate";

/**
 * One scene's thumbnail in the storyboard filmstrip.
 *
 * A storyboard is up to ~200 scenes and the strip renders every scene in the current minute
 * filter, so pointing a `<video preload="metadata">` at R2 from each tile at once queues ~75
 * requests behind the browser's ~6-per-host connection cap. That starves everything behind them:
 * the strip fills in slowly AND the detail panel's own player sits black waiting its turn.
 *
 * So tiles load through a shared FIFO gate, a few at a time, leaving connections free for the
 * player the operator is actually looking at. Mount order is scene order, so the tiles nearest
 * the front of the strip — the ones on screen — are served first. Deliberately NOT gated on
 * IntersectionObserver visibility: its failure mode is a tile that never loads at all, and it
 * does not fire in every embedded webview.
 *
 * `preload="metadata"` alone loads dimensions/duration but, in most engines, never decodes and
 * presents a frame — the element stays black. A tiny seek past `startSec` forces that first
 * decode (and lands past the opening keyframe, which is often a black flash on encoded video).
 * Same trick as `LongformScenePreview`'s poster frame, minus the controls and audio sync a
 * thumbnail doesn't need.
 */

/** Tiles fetching at once. Well under the ~6-per-host cap, so the detail player keeps a lane. */
const gate = createLoadGate(3);
/**
 * A tile that never reports back (404, decode failure, a codec that fires neither `seeked` nor
 * `error`) must not hold its slot forever, or the rest of the strip stops loading behind it.
 */
const THUMB_SLOT_TIMEOUT_MS = 15_000;

export function SceneStripThumb({
  clipUrl,
  startSec = 0,
  className,
}: {
  clipUrl: string;
  /** The operator's trim — which frame of the footage represents this scene. */
  startSec?: number;
  className?: string;
}) {
  // Three gates: `loading` attaches the src (starts the fetch once a slot frees up), `painted`
  // reveals the element once a real frame is on it, `failed` swaps in a retry affordance — a
  // tile is never a black rectangle pretending to be footage, nor a spinner that never ends.
  // `painted` and `failed` are mutually exclusive per attempt (see `settle`), so a tile always
  // shows exactly one of: the frame, a spinner, or Retry.
  const [loading, setLoading] = useState(false);
  const [painted, setPainted] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Bumped by the retry button to re-run the effect and mount a fresh element. */
  const [attempt, setAttempt] = useState(0);
  const releaseRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Set once this attempt has an outcome (frame painted, or failed). Everything after that is
   * ignored: the timeout used to keep running past a successful paint and flip the tile to
   * `failed` 15 s later, which unmounted the video while `painted` hid the retry button — an
   * empty tile. A late `error` from the element (buffering beyond the first frame) did the same.
   */
  const settledRef = useRef(false);

  useEffect(() => {
    setLoading(false);
    setPainted(false);
    setFailed(false);
    settledRef.current = false;
    releaseRef.current = gate.acquire(() => {
      setLoading(true);
      // A tile that never reports back must not hold its slot — but it also must not sit on a
      // spinner forever, so the timeout surfaces the failure as well as freeing the queue. It
      // starts when the slot is granted, not at mount: it bounds the LOAD, and a tile far down
      // a long strip can legitimately wait longer than that for its turn.
      timerRef.current = setTimeout(fail, THUMB_SLOT_TIMEOUT_MS);
    });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      releaseRef.current?.();
    };
  }, [clipUrl, attempt]);

  /** End this attempt: stop the timeout and hand the slot to the next tile. Idempotent. */
  const settle = () => {
    if (settledRef.current) return false;
    settledRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    releaseRef.current?.();
    return true;
  };
  // Hand the slot on as soon as this tile has its frame — the fetch that matters is done, even
  // though the element keeps whatever it buffered.
  function paint() {
    if (settle()) setPainted(true);
  }
  function fail() {
    if (settle()) setFailed(true);
  }

  return (
    <div className={className}>
      {loading && !failed && (
        <video
          // Remount on retry: React would otherwise reuse this exact DOM node, and a media
          // element that has already errored on a src does not re-fetch when merely re-rendered.
          key={attempt}
          src={clipUrl}
          preload="metadata"
          muted
          playsInline
          className={`w-full h-full object-cover bg-black transition-opacity ${
            painted ? "opacity-100" : "opacity-0"
          }`}
          onLoadedMetadata={e => {
            try {
              e.currentTarget.currentTime = startSec + 0.05;
            } catch {
              // Not seekable: show it as-is rather than spinning forever on a frame that
              // will never be decoded.
              paint();
            }
          }}
          onSeeked={paint}
          onError={fail}
        />
      )}
      {!painted &&
        (failed ? (
          // Storage unreachable (the clip lives on R2) or the object is gone. Say so instead of
          // spinning forever — an endless spinner reads as "still working" and hides the fault.
          <button
            type="button"
            className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:text-foreground"
            title="Couldn't load this clip from storage — click to retry"
            onClick={e => {
              e.stopPropagation();
              setAttempt(n => n + 1); // re-runs the effect: back through the gate, fresh element
            }}
          >
            <CloudOff className="h-4 w-4" />
            <span className="text-[9px] leading-none">Retry</span>
          </button>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ))}
    </div>
  );
}

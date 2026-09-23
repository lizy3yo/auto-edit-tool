import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

/**
 * Lifetime management for `<video>`/`<audio>` elements.
 *
 * Every media element that has loaded a frame holds a hardware decoder and GPU surfaces, and a
 * browser only has so many: Chrome refuses new players past ~75 per page, and a modest GPU runs
 * out of video memory well before that — at which point its GPU process resets and the whole
 * tab goes black until it recovers. The long-form page can reach that easily: five job tabs stay
 * mounted (so background jobs keep polling), each with a filmstrip, previews, editors and a
 * player. Two leaks made it worse:
 *
 *  - Removing a `<video>` from the DOM does NOT free its decoder. It lingers until garbage
 *    collection, so clicking through minute ranges stacked up dozens of dead players.
 *  - A hidden tab (`display: none`) keeps every player it has fully loaded.
 *
 * The fix is the standard one: pause, drop the source and call `load()`, which releases the
 * decoder immediately — on unmount, and whenever the element's tab is hidden.
 */

/** Pause and release an element's decoder and buffers now, instead of at garbage collection. */
export function releaseMedia(el: HTMLMediaElement | null | undefined) {
  if (!el) return;
  try {
    el.pause();
    el.removeAttribute("src");
    el.load();
  } catch {
    // Already detached or never loaded — nothing held.
  }
}

/**
 * Callback ref that releases the element when React removes it (React 19 ref cleanup). For
 * short-lived elements that manage nothing else — e.g. a thumbnail's loader, which exists only
 * until its frame is captured.
 */
export function releaseOnUnmount(el: HTMLMediaElement | null) {
  if (!el) return;
  return () => releaseMedia(el);
}

/**
 * Whether media under this subtree may hold a source. The long-form page provides `false` for
 * every job tab except the one on screen; everywhere else it defaults to `true`.
 */
export const MediaActiveContext = createContext(true);

export function useMediaActive() {
  return useContext(MediaActiveContext);
}

/**
 * Wire one declarative `<video src>`/`<audio src>` into that lifecycle. Returns the `ref` and
 * `src` to put on the element in place of the originals:
 *
 *  - the ref releases the element when it unmounts (React 19 callback-ref cleanup), and keeps
 *    `target` — the component's own ref, if it has one — pointing at it;
 *  - `src` is withheld while the tab is hidden, and the element is paused and flushed at that
 *    moment, so a hidden tab holds no decoders. Coming back re-attaches the source and the
 *    element's own `loadedmetadata` handlers restore its frame.
 *
 * Component state (drafts, playheads) is untouched: only the element's source comes and goes.
 */
export function useManagedMedia<T extends HTMLMediaElement>(
  src: string | undefined,
  target?: RefObject<T | null>
) {
  const active = useMediaActive();
  const elRef = useRef<T | null>(null);

  const ref = useCallback(
    (el: T | null) => {
      elRef.current = el;
      if (target) target.current = el;
      if (!el) return;
      return () => {
        releaseMedia(el);
        elRef.current = null;
        if (target && target.current === el) target.current = null;
      };
    },
    // `target` is a ref object — stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Layout effect: runs after React has removed the `src` attribute, before paint.
  useLayoutEffect(() => {
    if (!active) releaseMedia(elRef.current);
  }, [active]);

  return { ref, src: active ? src : undefined };
}

/**
 * Copy the element's current frame onto `canvas` at the frame's own aspect ratio (the canvas is
 * styled with `object-fit` exactly as the video was, so the crop on screen is unchanged). The
 * canvas stays drawable when the source is cross-origin — it is only marked tainted, which
 * matters for reading pixels back, never for showing them. Returns false when there is no
 * decoded frame to copy.
 */
export function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxWidth: number
) {
  const { videoWidth: w, videoHeight: h } = video;
  // HAVE_CURRENT_DATA: below it there is no decoded frame and drawImage paints nothing.
  if (!w || !h || video.readyState < 2) return false;
  const scale = Math.min(1, maxWidth / w);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return true;
  } catch {
    return false;
  }
}

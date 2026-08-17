import { useEffect, useRef, useState } from "react";

// ponytail: YouTube-style hover preview is a hidden <video> seeked to the hover
// time — no sprite sheet / server work. Slight seek latency on hover is the
// known ceiling; upgrade to a server sprite if that ever matters.

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const PREVIEW_W = 160;

export function LongformVideoPlayer({
  src,
  seekRef,
}: {
  src: string;
  /**
   * Optional handle the parent can call to jump the player to a timestamp — used by the publish
   * kit's timestamp map, so "check the split screen at 2:14" is one click. A ref rather than a
   * controlled `currentTime` prop: seeking is an EVENT, and a controlled value would fight the
   * user every time they scrubbed.
   */
  seekRef?: React.MutableRefObject<((sec: number) => void) | null>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(false); // pointer over this player, ref not state
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [hover, setHover] = useState<{ t: number; x: number } | null>(null);

  // Expose a seek handle to the parent. Cleared on unmount so a stale closure can never be
  // called against a detached <video>.
  useEffect(() => {
    if (!seekRef) return;
    seekRef.current = (sec: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, sec);
      v.play().catch(() => {
        /* autoplay may be blocked; the seek still landed */
      });
      v.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    return () => {
      seekRef.current = null;
    };
  }, [seekRef]);

  // ponytail: per-instance handler bound to THIS player's videoRef. Acts only
  // when this player is the active one (playing / focused / hovered), so
  // multiple slots don't fight. Runs in CAPTURE phase + stopPropagation so it
  // beats the native controls' timeline scrubber — that shadow-DOM slider
  // otherwise seeks by a duration-derived step (variable skip) before a
  // bubble-phase listener would ever see the key. preventDefault also kills the
  // <video> body's ±5s seek, so skips stay a consistent ±2 and work while paused.
  // Space: a focused <video> toggles play/pause natively (not cancelable via
  // keydown preventDefault), so we let native own it and only handle Space
  // ourselves when the video isn't focused — otherwise it'd toggle twice.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const v = videoRef.current;
      if (!v) return;
      const isArrow = e.key === "ArrowLeft" || e.key === "ArrowRight";
      const isSpace = e.key === " ";
      if (!isArrow && !isSpace) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return; // don't hijack typing
      const active =
        !v.paused ||
        e.target === v ||
        containerRef.current?.contains(e.target as Node) ||
        hoverRef.current;
      if (!active) return;
      if (isSpace) {
        if (e.target === v) return; // focused <video> toggles natively
        e.preventDefault(); // not focused: we toggle + stop page scroll
        if (v.paused) v.play();
        else v.pause();
        return;
      }
      e.preventDefault();
      e.stopPropagation(); // don't let the native scrubber also seek
      const d = e.key === "ArrowLeft" ? -2 : 2;
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function hoverTime(e: React.MouseEvent<HTMLDivElement>): {
    t: number;
    x: number;
  } | null {
    const bar = barRef.current;
    if (!bar || !duration) return null;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    return { t: (x / rect.width) * duration, x };
  }

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const h = hoverTime(e);
    if (!h) return;
    setHover(h);
    if (previewRef.current) previewRef.current.currentTime = h.t;
  }

  function onSeek(e: React.MouseEvent<HTMLDivElement>) {
    const h = hoverTime(e);
    if (h && videoRef.current) videoRef.current.currentTime = h.t;
  }

  const pct = duration ? (current / duration) * 100 : 0;
  const previewLeft = hover
    ? Math.max(
        0,
        Math.min(
          (barRef.current?.clientWidth ?? 0) - PREVIEW_W,
          hover.x - PREVIEW_W / 2
        )
      )
    : 0;

  return (
    <div
      ref={containerRef}
      className="space-y-2"
      onMouseEnter={() => (hoverRef.current = true)}
      onMouseLeave={() => (hoverRef.current = false)}
    >
      <video
        ref={videoRef}
        src={src}
        controls
        className="w-full rounded-lg bg-black max-h-[480px]"
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
      />

      <div className="relative">
        {/* seek bar */}
        <div
          ref={barRef}
          className="relative h-2 cursor-pointer rounded-full bg-secondary/60"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={onSeek}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* hover preview */}
        {hover && (
          <div
            className="pointer-events-none absolute bottom-4 z-20 overflow-hidden rounded-md border border-border bg-black shadow-lg"
            style={{ left: previewLeft, width: PREVIEW_W }}
          >
            <video
              ref={previewRef}
              src={src}
              muted
              preload="metadata"
              className="block w-full"
            />
            <div className="bg-black/80 py-0.5 text-center text-xs text-white">
              {formatTime(hover.t)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

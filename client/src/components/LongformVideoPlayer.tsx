import { useEffect, useRef, useState } from "react";
import { useManagedMedia } from "@/lib/mediaLifecycle";
import { trpc } from "@/lib/trpc";
import { pickVideoSource, type VideoQuality } from "@shared/weakNetwork";

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

const QUALITY_KEY = "player-quality";
function storedQuality(): VideoQuality {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return v === "light" || v === "full" ? v : "auto";
  } catch {
    return "auto";
  }
}

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

  // THE LIGHT COPY (`server/lightVideo.ts`): a 480p file about a sixth of the film's size, so
  // the player on the page works on a weak connection. Full screen plays the film itself, and
  // Download always is the film. With no light copy this player behaves exactly as before.
  const [mode, setMode] = useState<VideoQuality>(storedQuality);
  const [fullscreen, setFullscreen] = useState(false);
  const lightQuery = trpc.longformVideo.lightVideo.useQuery(
    { url: src },
    {
      staleTime: Infinity,
      retry: false,
      refetchInterval: q => (q.state.data?.pending ? 15_000 : false),
    }
  );
  const lightReady = lightQuery.data?.url ?? null;
  /** The light copy this player has taken up — never swapped in under a film that is playing. */
  const [light, setLight] = useState<string | null>(null);
  useEffect(() => setLight(null), [src]);
  useEffect(() => {
    const v = videoRef.current;
    if (lightReady && (!v || (v.paused && v.currentTime < 0.5)))
      setLight(lightReady);
  }, [lightReady]);
  const activeSrc = pickVideoSource({ mode, fullscreen, full: src, light });

  /**
   * Where the film was when the file under it changed, to carry on from there. Read during
   * render, while the element still holds the OLD file: by the time an effect runs the new
   * `src` is on it and its time is already back at zero.
   */
  const resumeRef = useRef<{ t: number; playing: boolean } | null>(null);
  const shownRef = useRef({ film: src, file: activeSrc });
  if (shownRef.current.file !== activeSrc) {
    const v = videoRef.current;
    resumeRef.current =
      v && shownRef.current.film === src
        ? { t: v.currentTime, playing: !v.paused }
        : null; // a different film starts from the top
    shownRef.current = { film: src, file: activeSrc };
  }
  /** A switch is happening anyway, so a light copy that arrived mid-film can be taken up. */
  const takeUpLight = () => {
    if (lightReady) setLight(lightReady);
  };
  useEffect(() => {
    const onChange = () => {
      const el = document.fullscreenElement;
      takeUpLight();
      setFullscreen(!!el && !!containerRef.current?.contains(el));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
    // `takeUpLight` reads the latest `lightReady`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightReady]);
  const chooseQuality = (next: VideoQuality) => {
    takeUpLight();
    setMode(next);
    try {
      localStorage.setItem(QUALITY_KEY, next);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  };

  // Both released on unmount (the hover preview mounts per hover) and while the tab is hidden.
  const main = useManagedMedia(activeSrc, videoRef);
  // The scrubbing preview is a thumbnail: the light copy is plenty, and a second connection to
  // the full film was the heaviest thing on the page.
  const preview = useManagedMedia(light ?? src, previewRef);
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
        ref={main.ref}
        src={main.src}
        controls
        className="w-full rounded-lg bg-black max-h-[480px]"
        onLoadedMetadata={e => {
          const v = e.currentTarget;
          setDuration(v.duration);
          const resume = resumeRef.current;
          resumeRef.current = null;
          if (!resume) return;
          v.currentTime = Math.min(resume.t, v.duration || resume.t);
          if (resume.playing) v.play().catch(() => {});
        }}
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
              ref={preview.ref}
              src={preview.src}
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

      {(lightReady || lightQuery.data?.pending) && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>
            {!lightReady
              ? "Preparing a light version for slow connections…"
              : activeSrc === src
                ? "Playing full quality"
                : "Playing the light version — full screen and Download are full quality"}
          </span>
          <label className="flex items-center gap-1.5">
            Quality
            <select
              value={mode}
              onChange={e => chooseQuality(e.target.value as VideoQuality)}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              <option value="auto">Auto</option>
              <option value="light">Data saver</option>
              <option value="full">Full quality</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

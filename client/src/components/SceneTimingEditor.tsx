/**
 * client/src/components/SceneTimingEditor.tsx
 *
 * The cut room for ONE scene — laid out like a CapCut track, scoped to what the film can
 * honestly do. The narration is one continuous track and never moves; every scene's picture sits
 * over its slice of it. A viewer on top plays the scene exactly as it will ship (picture + the
 * narration under it). Below it, the timeline:
 *
 *   ruler   ─ timestamps on the master timeline
 *   video   ─ a filmstrip of REAL frames from the footage that will play in this slice, drawn as
 *             separate ROUNDED BLOCKS — one per piece between cuts, with a real visible gap at
 *             each cut (not a line over one strip): drag the gap to slide the cut, click its ×
 *             to remove it. The neighbours' slabs are dimmed either side; where the footage
 *             runs out the tail is hatched (assembly holds the last frame there)
 *   voice   ─ the narration waveform (this scene's slice, plus the neighbours'), so a cut can be
 *             dropped on a breath and a trim landed on a word
 *   playhead─ full-height line with a grab knob; drag it, or drag anywhere on the ruler/track
 *
 * - click / drag the track → scrub the playhead; SPLIT HERE divides the scene at it (the second
 *                            half keeps the same footage, continuing seamlessly, until regenerated)
 * - ⇄ grip / shift-drag    → slip the footage under the slice: trim, "cut forward/back". An
 *                            explicit gesture, so placing the playhead can never nudge the trim
 * - drag a CUT handle      → move the cut with the neighbour (one runs longer, the other shorter)
 * - HOLD                   → freeze the last frame N s after the last word (the narration pauses)
 * - space / ← → (shift)    → play-pause / nudge the playhead 0.1 s (1 s)
 *
 * Every drag scrubs the viewer live, and playback runs from the playhead to the end of the slice.
 * The voice is the MASTER narration seeked to the slice, so a moved cut previews with the right
 * words; the per-scene slice is the fallback. Everything is preview-only until Apply (one
 * persisted edit, no render); the film re-stitches on Reassemble.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Check,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  History,
  Scissors,
  X,
  SkipBack,
} from "lucide-react";

/** Shortest slice a move/split may leave — mirrors server/sceneTiming.ts MIN_SLICE_SEC. */
const MIN_SLICE_SEC = 0.5;
/**
 * One frame at the pipeline's 30fps. Every footage-addressing edit — the two slips, placing a
 * cut, dragging one — stops here short of the clip's end, i.e. ON its last frame and never past
 * it. Deliberately NOT `MIN_SLICE_SEC`: that reserved half a second of footage, which is both
 * too strict at the top (a clip may legitimately be left with a sliver) and fatal for a clip
 * SHORTER than 0.5s, whose limit collapsed to 0 and left it un-slippable.
 */
const FRAME_SEC = 1 / 30;
const MAX_TAIL_HOLD_SEC = 10;
/** The CTA release beat's default hold when the operator hasn't set one (server QR_TAIL_HOLD_SEC). */
const DEFAULT_QR_TAIL_HOLD_SEC = 3;
/** Mirrors server/sceneTiming.ts MAX_HEAD_HOLD_SEC. */
const MAX_HEAD_HOLD_SEC = 10;
/** How far picture and voice may drift during playback before the voice is snapped back. */
const MAX_DRIFT_SEC = 0.15;

/** Timeline geometry (px). */
const RULER_H = 18;
const VIDEO_H = 56;
const VOICE_H = 26;
/** Filmstrip thumbnail width — 16:9 at the track height. */
const THUMB_W = Math.round((VIDEO_H * 16) / 9);
/** Visual gap (px, each side) between two pieces at a cut, and their corner radius. */
const CUT_GAP_PX = 3;
const PIECE_RADIUS = 6;

/** Rounded-rect path, manual (not every target has `CanvasRenderingContext2D.roundRect`). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const fmt = (v: number) => `${v.toFixed(1)}s`;
/** mm:ss(.d) for the ruler. */
const clock = (sec: number, decimals: boolean) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${decimals ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0")}`;
};

export interface SceneTimingDraft {
  clipInSec?: number;
  startSec?: number;
  endSec?: number;
  tailHoldSec?: number;
  headHoldSec?: number;
}

type Drag =
  | { kind: "clip"; startX: number; startClipIn: number }
  | { kind: "start" | "end"; startX: number; startVal: number }
  | { kind: "headhold"; startX: number; startVal: number }
  | { kind: "cutmove"; startX: number; startVal: number }
  | {
      kind: "pieceslip";
      startX: number;
      startVal: number;
      cutKey: string;
      /** Furthest footage offset this piece may show. `undefined` while the clip's duration is
       *  still unknown — the drag then does nothing rather than run unbounded. */
      maxIn: number | undefined;
    }
  | { kind: "scrub" };

/**
 * The furthest footage offset a slip may address: the clip's LAST frame, never past it.
 *
 * `undefined` when the clip's duration isn't known yet. That case used to read `Infinity`, so a
 * drag begun before the video's metadata arrived was bounded by nothing and could park the
 * footage beyond the end of the file. Unknown now means "don't move".
 *
 * Deliberately not `MIN_SLICE_SEC`: reserving half a second of footage is both too strict at the
 * top (a sliver is a legitimate choice) and fatal for a clip SHORTER than 0.5s, whose limit
 * collapsed to 0 and left it un-slippable. Pure — unit-tested.
 */
export function maxSlipSec(clipDurationSec?: number): number | undefined {
  if (clipDurationSec === undefined || !Number.isFinite(clipDurationSec))
    return undefined;
  return Math.max(0, clipDurationSec - FRAME_SEC);
}

/**
 * How far a scene's own boundary handles may be dragged.
 *
 * A handle may only make the scene it belongs to SHORTER: its start moves later, its end moves
 * earlier, and neither leaves the scene's own persisted range. Editing scene 2 therefore can
 * never reach into scene 1 or scene 3 — which is what the old bounds allowed, since they were
 * measured from the NEIGHBOUR's far edge (a 11–17 scene could be dragged out to 5.5–23, and a
 * 17–24 scene's start down to 11.5).
 *
 * The narration still tiles: time given up at a boundary goes to the neighbour on that side. So
 * lengthening a scene means shortening its neighbour, from that neighbour's own editor, where
 * the same rule applies — the operation stays reversible, it just always shrinks whatever you
 * are pointing at.
 *
 * `draftStart`/`draftEnd` are the live (uncommitted) values, so the two handles cannot cross:
 * each keeps `MIN_SLICE_SEC` of picture against where the other one currently sits. A scene
 * already shorter than that floor simply cannot shrink further — both handles pin.
 *
 * The first scene's start and the last scene's end are fixed to the narration's own ends (the
 * server requires it), so with no neighbour on that side the handle does not move at all.
 * Pure — unit-tested.
 */
export function boundaryLimits(o: {
  /** The scene's persisted range — the outer limit in both directions. */
  startSec: number;
  endSec: number;
  /** The live draft, for keeping the two handles `MIN_SLICE_SEC` apart. */
  draftStart: number;
  draftEnd: number;
  hasPrev: boolean;
  hasNext: boolean;
}): { minStart: number; maxStart: number; minEnd: number; maxEnd: number } {
  return {
    minStart: o.startSec,
    maxStart: o.hasPrev
      ? Math.max(o.startSec, o.draftEnd - MIN_SLICE_SEC)
      : o.startSec,
    minEnd: o.hasNext
      ? Math.min(o.endSec, o.draftStart + MIN_SLICE_SEC)
      : o.endSec,
    maxEnd: o.endSec,
  };
}

/**
 * The slice offset at which a piece's picture runs out — where its footage ends and assembly
 * starts holding the last frame. `pieceBoundSec` is where the piece begins on the slice,
 * `pieceStartSec` the footage offset it opens on. `undefined` when the duration isn't known.
 * Pure — unit-tested.
 */
export function pieceLiveEnd(
  pieceBoundSec: number,
  pieceStartSec: number,
  clipDurationSec?: number
): number | undefined {
  if (clipDurationSec === undefined || !Number.isFinite(clipDurationSec))
    return undefined;
  return pieceBoundSec + Math.max(0, clipDurationSec - pieceStartSec);
}

/**
 * Which piece (0-based) an offset into the slice falls in, given `bounds = [0, ...cuts, sliceLen]`.
 */
function pieceIndexAt(off: number, bounds: number[]): number {
  let i = 0;
  while (i < bounds.length - 2 && off >= bounds[i + 1]) i++;
  return i;
}

// ─── media helpers ──────────────────────────────────────────────────────────────────────────

/**
 * Frames out of the footage for the filmstrip, grabbed from a hidden <video> one seek at a
 * time and cached per footage-time (rounded to 50 ms). Drawing a cross-origin video onto a
 * canvas is allowed (the canvas is merely tainted — it still renders), so no CORS is needed.
 * `version` bumps whenever a new frame lands so the strip repaints.
 */
function useFrameGrabber(src: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cache = useRef(new Map<number, HTMLCanvasElement>());
  const queue = useRef<number[]>([]);
  const busy = useRef(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!src) {
      videoRef.current = null;
      cache.current.clear();
      queue.current = [];
      return;
    }
    const v = document.createElement("video");
    v.src = src;
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    videoRef.current = v;
    cache.current.clear();
    queue.current = [];
    busy.current = false;
    return () => {
      v.removeAttribute("src");
      v.load();
      videoRef.current = null;
    };
  }, [src]);

  const key = (t: number) => Math.round(t * 20);

  const pump = useCallback(async () => {
    if (busy.current) return;
    const v = videoRef.current;
    if (!v) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const k = queue.current.shift() as number;
        if (cache.current.has(k)) continue;
        if (v.readyState < 1) {
          await new Promise<void>(res => {
            const on = () => {
              v.removeEventListener("loadedmetadata", on);
              res();
            };
            v.addEventListener("loadedmetadata", on);
          });
        }
        const t = Math.min(k / 20, Math.max(0, (v.duration || 0) - 0.05));
        await new Promise<void>(res => {
          const on = () => {
            v.removeEventListener("seeked", on);
            res();
          };
          v.addEventListener("seeked", on);
          try {
            v.currentTime = t;
          } catch {
            res();
          }
        });
        const c = document.createElement("canvas");
        c.width = THUMB_W * 2;
        c.height = VIDEO_H * 2;
        const ctx = c.getContext("2d");
        if (ctx && v.videoWidth) {
          // Cover-fit the frame into the thumb (same crop assembly applies to a 16:9 canvas).
          const scale = Math.max(
            c.width / v.videoWidth,
            c.height / v.videoHeight
          );
          const w = v.videoWidth * scale;
          const h = v.videoHeight * scale;
          ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
        }
        cache.current.set(k, c);
        setVersion(n => n + 1);
      }
    } finally {
      busy.current = false;
    }
  }, []);

  const request = useCallback(
    (times: number[]) => {
      let added = false;
      for (const t of times) {
        const k = key(t);
        if (cache.current.has(k) || queue.current.includes(k)) continue;
        queue.current.push(k);
        added = true;
      }
      if (added) void pump();
    },
    [pump]
  );

  const get = useCallback((t: number) => cache.current.get(key(t)), []);
  return useMemo(() => ({ request, get, version }), [request, get, version]);
}

/** Decoded peak envelope of an audio file — fetched same-origin through the download proxy. */
const peaksCache = new Map<
  string,
  Promise<{ peaks: Float32Array; duration: number } | null>
>();
function loadPeaks(url: string) {
  let p = peaksCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        // Through the same-origin proxy (R2 sends no CORS headers); a same-origin URL or a
        // CORS-enabled host can be read directly if the proxy can't serve it.
        const isAudio = (r: Response | null): r is Response =>
          !!r &&
          r.ok &&
          !/text\/html/i.test(r.headers.get("content-type") ?? "");
        let res = await fetch(
          `/api/download?url=${encodeURIComponent(url)}&type=audio`
        ).catch(() => null);
        if (!isAudio(res)) res = await fetch(url).catch(() => null);
        if (!isAudio(res)) return null;
        const buf = await res.arrayBuffer();
        const Ctx =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return null;
        const ac: AudioContext = new Ctx();
        const audio = await ac.decodeAudioData(buf);
        void ac.close?.();
        const data = audio.getChannelData(0);
        // ~40 buckets per second is plenty for a strip a few hundred px wide.
        const n = Math.max(1, Math.round(audio.duration * 40));
        const per = Math.max(1, Math.floor(data.length / n));
        const peaks = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let m = 0;
          const from = i * per;
          const to = Math.min(data.length, from + per);
          for (let j = from; j < to; j++) {
            const a = Math.abs(data[j]);
            if (a > m) m = a;
          }
          peaks[i] = m;
        }
        return { peaks, duration: audio.duration };
      } catch {
        return null;
      }
    })();
    peaksCache.set(url, p);
  }
  return p;
}
function usePeaks(url?: string) {
  const [peaks, setPeaks] = useState<{
    peaks: Float32Array;
    duration: number;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    setPeaks(null);
    if (!url) return;
    void loadPeaks(url).then(p => {
      if (alive) setPeaks(p);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return peaks;
}

// ─── the editor ─────────────────────────────────────────────────────────────────────────────

export function SceneTimingEditor(props: {
  sceneIndex: number;
  clipUrl: string;
  /** This scene's slice of the master narration. */
  startSec: number;
  endSec: number;
  clipInSec?: number;
  /** Persisted hold override; undefined ⇒ the default (3 s on a CTA release beat, else 0). */
  tailHoldSec?: number;
  /** CTA release beat — carries the default 3 s hold. */
  qrTail?: boolean;
  /**
   * Persisted hold BEFORE this scene's own first word — tailHoldSec's mirror, at the front.
   * Only meaningful (and only shown, via the start handle) when `prevStartSec` is undefined —
   * this scene has no neighbour before it, so a pause there can only come from holding on its
   * own opening frame. No default: undefined ⇒ 0.
   */
  headHoldSec?: number;
  /** Earliest this scene's start may move to (previous scene's start + floor); undefined ⇒ pinned. */
  prevStartSec?: number;
  /** Latest this scene's end may move to (next scene's end − floor); undefined ⇒ pinned. */
  nextEndSec?: number;
  /** Neighbours' narration slices, for the voice track either side of the cuts. */
  prevAudioUrl?: string;
  nextAudioUrl?: string;
  /** Neighbours' footage + trims, so their slabs show real frames either side of the cuts. */
  prevClipUrl?: string;
  prevClipInSec?: number;
  nextClipUrl?: string;
  nextClipInSec?: number;
  /** Neighbour scene numbers — shown on their slabs and passed back when one is clicked. */
  prevIndex?: number;
  nextIndex?: number;
  /** Click a neighbour clip on the timeline to edit that scene (CapCut-style). */
  onSelectScene?: (sceneIndex: number) => void;
  /** Lip-synced host: a start move keeps the mouth in sync by trimming the same amount. */
  lipsync?: boolean;
  /** The continuous master narration — preferred voice for the viewer (exact for moved cuts). */
  masterAudioUrl?: string | null;
  /** This scene's narration slice (cut at the PERSISTED boundaries) — voice track + fallback. */
  audioUrl?: string;
  pending?: boolean;
  disabled?: boolean;
  onApply: (edit: SceneTimingDraft) => void;
  onSplit: (atOffsetSec: number) => void;
  /** Persisted cut markers on this scene (seconds into the slice) — drawn on the timeline. */
  cutPoints?: number[];
  /** Remove the cut nearest this offset. */
  onRemoveCut?: (atOffsetSec: number) => void;
  /** Drag an existing cut to a new offset — CapCut's move-the-split-point. */
  onMoveCut?: (fromOffsetSec: number, toOffsetSec: number) => void;
  /**
   * Per-piece footage offset overrides, keyed by the cut (as a string) that starts each piece —
   * each piece after a cut can show a different moment of the SAME footage, independent of its
   * neighbour. Absent for a piece ⇒ it continues where its neighbour left off (the default).
   */
  pieceClipIns?: Record<string, number>;
  /** Slip one piece to a different footage offset, or clear it (`clipInSec: null`). */
  onSetPieceClipIn?: (cutOffsetSec: number, clipInSec: number | null) => void;
  /**
   * Whether this scene has a pristine cut on file to go back to (`scene.timingOriginal`) — set
   * by its first timing edit. Absent ⇒ nothing has been changed here, or the job predates the
   * snapshot, and the control is hidden rather than shown doing nothing.
   */
  canRevert?: boolean;
  /** Put this scene back to that pristine cut. */
  onRevert?: () => void;
}) {
  const { startSec, endSec, prevStartSec, nextEndSec, pending, disabled } =
    props;
  const persistedClipIn = props.clipInSec ?? 0;
  // The previous scene is the SAME footage playing continuously into this one (a split's first
  // half): moving the cut between them must carry this scene's footage so the picture flows
  // across it — the client mirror of the server's `isContinuousPair`, for a live preview.
  const continuousWithPrev =
    props.prevClipUrl !== undefined &&
    props.prevClipUrl === props.clipUrl &&
    props.prevStartSec !== undefined &&
    Math.abs(
      (props.prevClipInSec ?? 0) +
        (props.startSec - props.prevStartSec) -
        persistedClipIn
    ) < 0.05;
  const defaultHold = props.qrTail ? DEFAULT_QR_TAIL_HOLD_SEC : 0;
  const persistedHold = props.tailHoldSec ?? defaultHold;
  const persistedHeadHold = props.headHoldSec ?? 0;

  const [start, setStart] = useState(startSec);
  const [end, setEnd] = useState(endSec);
  const [clipIn, setClipIn] = useState(persistedClipIn);
  const [hold, setHold] = useState(persistedHold);
  const [headHold, setHeadHold] = useState(persistedHeadHold);
  const [playhead, setPlayhead] = useState(0); // offset into the slice
  const [playing, setPlaying] = useState(false);
  const [clipDur, setClipDur] = useState<number | undefined>(undefined);
  // "dirty" is derived below, not tracked: a drag that moved nothing (a click on the track) or
  // came back to where it started is not a change — a phantom change used to block Split.

  const [stripW, setStripW] = useState(600);
  // The cut currently being dragged: its original offset (identifies which marker) and its
  // live offset while the pointer moves. Cleared on drop.
  const [draggingCut, setDraggingCut] = useState<{
    original: number;
    current: number;
  } | null>(null);
  // Cut markers shown on the timeline. Server-owned (`props.cutPoints`), with an optimistic
  // overlay so a Split/remove shows at once and reconciles on the next poll.
  const persistedCuts = props.cutPoints ?? [];
  const [optimisticCuts, setOptimisticCuts] = useState<number[] | null>(null);
  const cutsKey = persistedCuts.join(",");
  useEffect(() => {
    setOptimisticCuts(null); // props are the source of truth again
  }, [cutsKey]);
  const rawCuts = (optimisticCuts ?? persistedCuts)
    .slice()
    .sort((a, b) => a - b);

  // Re-seed whenever the persisted values change (apply round-trip). Keyed by value: polling
  // recreates objects every few seconds and a reset on identity would fight the operator's drag.
  const seedKey = `${startSec}|${endSec}|${persistedClipIn}|${persistedHold}|${persistedHeadHold}`;
  useEffect(() => {
    setStart(startSec);
    setEnd(endSec);
    setClipIn(persistedClipIn);
    setHold(persistedHold);
    setHeadHold(persistedHeadHold);
    // The slice may have shrunk (a split keeps this editor on the first half): keep the
    // playhead inside it.
    setPlayhead(p => clamp(p, 0, Math.max(0, endSec - startSec)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const filmRef = useRef<HTMLCanvasElement>(null);
  const voiceRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  // The playback clock — a plain interval, not requestAnimationFrame: rAF is suspended in a
  // background/hidden tab, and the readout must keep up with the media whenever it is looked at.
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latest values for the playback loop (it runs outside React's render cycle).
  const live = useRef({ start, end, clipIn, playhead });
  live.current = { start, end, clipIn, playhead };

  // Track the strip's width (the timeline is drawn in px).
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setStripW(w);
    });
    ro.observe(el);
    setStripW(el.getBoundingClientRect().width || 600);
    return () => ro.disconnect();
  }, []);

  const sliceLen = end - start;
  // Cut markers inside the current slice (a moved cut could push one out of range).
  const cuts = rawCuts.filter(c => c > 0.01 && c < sliceLen - 0.01);
  const dirty =
    start !== startSec ||
    end !== endSec ||
    clipIn !== persistedClipIn ||
    hold !== persistedHold ||
    headHold !== persistedHeadHold;
  const voiceSrc = props.masterAudioUrl ?? props.audioUrl;
  /** Where an offset into the slice sits in the viewer's voice track. */
  const voiceTime = useCallback(
    (off: number, s: number) =>
      props.masterAudioUrl ? s + off : s - startSec + off,
    [props.masterAudioUrl, startSec]
  );

  // Piece boundaries: [0, ...cuts, sliceLen] — piece i spans bounds[i]..bounds[i+1]; piece 0's
  // footage start is `clipIn`, piece i>0's is keyed by the cut that starts it (`cuts[i-1]`).
  const bounds = useMemo(() => [0, ...cuts, sliceLen], [cuts, sliceLen]);
  // Per-piece footage offset overrides. Server-owned (`props.pieceClipIns`), with an optimistic
  // overlay so a slip/reset shows at once and reconciles on the next poll — mirrors `cuts` above.
  const persistedPieceSlips = props.pieceClipIns ?? {};
  const pieceSlipsKey = Object.entries(persistedPieceSlips)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
  const [optimisticPieceSlips, setOptimisticPieceSlips] = useState<Record<
    string,
    number
  > | null>(null);
  useEffect(() => {
    setOptimisticPieceSlips(null);
  }, [pieceSlipsKey]);
  const pieceSlipsMap = optimisticPieceSlips ?? persistedPieceSlips;
  // The piece slip currently being dragged: its cut key and live footage offset. Cleared on drop.
  const [draggingPieceSlip, setDraggingPieceSlip] = useState<{
    cutKey: string;
    current: number;
  } | null>(null);
  /** Effective footage-offset a piece starts at — the live drag value, its override, or default. */
  const pieceStartFor = (i: number, key: string | undefined, cIn = clipIn) => {
    if (i === 0 || key === undefined) return cIn;
    if (draggingPieceSlip && draggingPieceSlip.cutKey === key)
      return draggingPieceSlip.current;
    return pieceSlipsMap[key] ?? cIn + Number(key);
  };
  /** Slice offset → footage time, honouring per-piece slips (used to seek the viewer). */
  const footageTimeAt = useCallback(
    (off: number, cIn = clipIn) => {
      const i = pieceIndexAt(off, bounds);
      const a = bounds[i];
      const key = i === 0 ? undefined : String(cuts[i - 1]);
      return pieceStartFor(i, key, cIn) + (off - a);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bounds, cuts, clipIn, pieceSlipsMap, draggingPieceSlip]
  );

  // ── the viewer ────────────────────────────────────────────────────────────────────────────
  const seekTo = useCallback(
    (off: number, s = live.current.start, cIn = live.current.clipIn) => {
      const v = videoRef.current;
      const a = audioRef.current;
      if (v && Number.isFinite(off)) {
        try {
          v.currentTime = Math.max(0, footageTimeAt(off, cIn));
        } catch {
          /* metadata not loaded yet */
        }
      }
      if (a && Number.isFinite(off)) {
        try {
          a.currentTime = Math.max(0, voiceTime(off, s));
        } catch {
          /* not loaded yet */
        }
      }
    },
    [voiceTime, footageTimeAt]
  );

  const stopLoop = () => {
    if (clockRef.current !== null) clearInterval(clockRef.current);
    clockRef.current = null;
  };

  const pause = useCallback(() => {
    stopLoop();
    videoRef.current?.pause();
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  /** Play from the current playhead to the end of the slice, voice in step with the picture. */
  const play = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const { start: s, end: e, playhead: ph } = live.current;
    const len = e - s;
    const from = ph >= len - 0.05 ? 0 : ph; // at the end ⇒ play again from the top
    seekTo(from);
    setPlayhead(from);
    setPlaying(true);
    void v.play().catch(() => setPlaying(false));
    const a = audioRef.current;
    if (a && voiceSrc) void a.play().catch(() => {});
    stopLoop();
    const tick = () => {
      const vv = videoRef.current;
      const aa = audioRef.current;
      if (!vv) return;
      const { start: s2, end: e2, clipIn: c2 } = live.current;
      const len2 = e2 - s2;
      const haveVoice = !!(aa && voiceSrc);
      // The voice is the clock when we have it (it runs the whole slice even across a cut, where
      // a piece's footage may jump to a different moment); otherwise the picture is.
      const off = haveVoice
        ? aa!.currentTime - voiceTime(0, s2)
        : vv.currentTime - c2;
      // Keep the picture under the voice — a piece's slip can jump the footage forward/back of
      // where the video naturally arrived, so this seeks (not just tracks) across a cut.
      if (haveVoice && !vv.ended && !vv.paused) {
        const wantV = footageTimeAt(off, c2);
        if (Math.abs(vv.currentTime - wantV) > MAX_DRIFT_SEC) {
          try {
            vv.currentTime = Math.max(0, wantV);
          } catch {
            /* mid-seek */
          }
        }
      }
      // With no voice to keep time, the picture is the clock — and it stops where the footage
      // ends, so treat that as the end of the preview too (assembly would hold the frame on).
      const pictureOut = !haveVoice && (vv.ended || vv.paused);
      if (off >= len2 || pictureOut) {
        stopLoop();
        vv.pause();
        aa?.pause();
        setPlayhead(pictureOut && off < len2 ? Math.max(0, off) : len2);
        setPlaying(false);
        return;
      }
      setPlayhead(Math.max(0, off));
    };
    clockRef.current = setInterval(tick, 50);
  }, [seekTo, voiceSrc, voiceTime, footageTimeAt]);

  useEffect(() => () => stopLoop(), []); // unmount

  const nudge = (d: number) => {
    pause();
    const off = r3(
      clamp(live.current.playhead + d, 0, live.current.end - live.current.start)
    );
    setPlayhead(off);
    seekTo(off);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || pending) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === " ") {
      e.preventDefault();
      if (playing) pause();
      else play();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudge(e.shiftKey ? -1 : -0.1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nudge(e.shiftKey ? 1 : 0.1);
    }
  };

  // ── the timeline ──────────────────────────────────────────────────────────────────────────
  // Window: this scene's PERSISTED slice plus a slab of each neighbour — as much of the
  // neighbour as the cut could move into, capped so a long neighbour can't squash this scene to
  // a sliver. Persisted values, not the draft, so it doesn't slide under the pointer mid-drag.
  const persistedLen = Math.max(0.001, endSec - startSec);
  const pad = Math.max(3, persistedLen);
  const winStart =
    prevStartSec !== undefined
      ? startSec - Math.min(startSec - prevStartSec, pad)
      : startSec;
  const winEnd =
    nextEndSec !== undefined
      ? endSec + Math.min(nextEndSec - endSec, pad)
      : endSec;
  const winLen = Math.max(0.001, winEnd - winStart);
  const pxPerSec = stripW / winLen;
  const x = (sec: number) => (sec - winStart) * pxPerSec;
  const pct = (sec: number) => ((sec - winStart) / winLen) * 100;

  // The piece under the playhead, and where ITS footage sits on the timeline (frame 0 is at
  // `start + pieceA - pieceStart`) — each piece can show a different moment of the footage, so
  // the freeze/coverage readout is scoped to the one the operator is actually looking at.
  const playheadPieceIdx = pieceIndexAt(playhead, bounds);
  const playheadPieceA = bounds[playheadPieceIdx];
  const playheadPieceB = bounds[playheadPieceIdx + 1];
  const playheadPieceKey =
    playheadPieceIdx === 0 ? undefined : String(cuts[playheadPieceIdx - 1]);
  const playheadPieceStart = pieceStartFor(playheadPieceIdx, playheadPieceKey);
  const pieceLen = playheadPieceB - playheadPieceA;
  const maxSlipIn = maxSlipSec(clipDur);
  /** Where piece `i`'s picture runs out, in slice-seconds. A cut may not be placed or dragged
   *  past it: a marker inside a freeze divides one still frame from the same still frame. */
  const liveEndOf = (i: number) =>
    pieceLiveEnd(
      bounds[i],
      pieceStartFor(i, i === 0 ? undefined : String(cuts[i - 1])),
      clipDur
    );
  const clipStartT = start + playheadPieceA - playheadPieceStart;
  const clipEndT = clipDur !== undefined ? clipStartT + clipDur : undefined;
  const coveredSec =
    clipDur !== undefined
      ? clamp(clipDur - playheadPieceStart, 0, pieceLen)
      : undefined;
  const freezeSec =
    coveredSec !== undefined ? Math.max(0, pieceLen - coveredSec) : undefined;

  // Cut limits: a handle may only shorten THIS scene, never push into a neighbour.
  const { minStart, maxStart, minEnd, maxEnd } = boundaryLimits({
    startSec,
    endSec,
    draftStart: start,
    draftEnd: end,
    hasPrev: prevStartSec !== undefined,
    hasNext: nextEndSec !== undefined,
  });

  // Ruler ticks: the coarsest step that keeps labels ≥ 70 px apart.
  const ticks = useMemo(() => {
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
    const step = steps.find(s => s * pxPerSec >= 70) ?? 60;
    const first = Math.ceil(winStart / step) * step;
    const out: number[] = [];
    for (let t = first; t <= winEnd + 1e-6; t += step) out.push(r3(t));
    return { step, at: out, decimals: step < 1 };
  }, [pxPerSec, winStart, winEnd]);

  // Filmstrip: frames of the footage that PLAY in this slice, one per THUMB_W px of track —
  // and the neighbours' frames in their slabs, so the cut reads against what's on either side.
  const grabber = useFrameGrabber(props.clipUrl);
  const prevGrabber = useFrameGrabber(props.prevClipUrl ?? "");
  const nextGrabber = useFrameGrabber(props.nextClipUrl ?? "");
  const slotSec = THUMB_W / pxPerSec;
  const prevClipIn = props.prevClipInSec ?? 0;
  const nextClipIn = props.nextClipInSec ?? 0;
  useEffect(() => {
    if (!Number.isFinite(slotSec) || slotSec <= 0) return;
    // Previous scene: its footage time at timeline t is prevClipIn + (t − prevStart); visible
    // slab is [winStart, start). Next: nextClipIn + (t − end); slab is [end, winEnd).
    if (props.prevClipUrl && prevStartSec !== undefined) {
      const from = prevClipIn + Math.max(0, winStart - prevStartSec);
      const to = prevClipIn + (start - prevStartSec);
      const times: number[] = [];
      for (let k = Math.floor(from / slotSec); k * slotSec <= to; k++)
        times.push(k * slotSec);
      prevGrabber.request(times);
    }
    if (props.nextClipUrl) {
      // Same footage-time grid the painter reads (k·slotSec), from the next scene's trim on.
      const from = nextClipIn;
      const to = nextClipIn + (winEnd - end);
      const times: number[] = [];
      for (let k = Math.floor(from / slotSec); k * slotSec <= to; k++)
        times.push(k * slotSec);
      nextGrabber.request(times);
    }
  }, [
    slotSec,
    start,
    end,
    winStart,
    winEnd,
    prevStartSec,
    prevClipIn,
    nextClipIn,
    props.prevClipUrl,
    props.nextClipUrl,
    prevGrabber,
    nextGrabber,
  ]);
  useEffect(() => {
    if (!Number.isFinite(slotSec) || slotSec <= 0) return;
    // Slots are in FOOTAGE time, stable across slips: slot k shows frame k*slotSec. Each piece
    // requests its OWN range — after a cut a piece may show a different moment of the footage.
    const times: number[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i];
      const b = bounds[i + 1];
      const key = i === 0 ? undefined : String(cuts[i - 1]);
      const s = pieceStartFor(i, key);
      const firstK = Math.max(0, Math.floor(s / slotSec));
      const lastK = Math.floor((s + (b - a)) / slotSec);
      for (let k = firstK; k <= lastK; k++) {
        const t = k * slotSec;
        if (clipDur !== undefined && t >= clipDur) break;
        times.push(t);
      }
    }
    grabber.request(times);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clipIn,
    sliceLen,
    slotSec,
    clipDur,
    grabber,
    bounds,
    cuts,
    pieceSlipsMap,
    draggingPieceSlip,
  ]);

  // Paint the video track.
  useEffect(() => {
    const c = filmRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(stripW * dpr);
    c.height = Math.round(VIDEO_H * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stripW, VIDEO_H);
    const sx = x(start);
    const ex = x(end);
    // The clip is drawn as SEPARATE ROUNDED BLOCKS, one per piece between cuts — a real visual
    // split (a gap you can see), not a line drawn over one continuous strip. Live cut position
    // during a drag (`draggingCut`) is folded in so the gap itself slides as you drag it.
    const liveCuts = cuts
      .map(c =>
        draggingCut && draggingCut.original === c ? draggingCut.current : c
      )
      .sort((a, b) => a - b);
    const paintBounds = [0, ...liveCuts, sliceLen];
    for (let i = 0; i < paintBounds.length - 1; i++) {
      const a = paintBounds[i];
      const b = paintBounds[i + 1];
      // Identity key for THIS piece's footage offset — the STATIC cut value (not the live
      // dragged position), so a slip's key stays put while a neighbouring cut is being dragged.
      const key = i === 0 ? undefined : String(cuts[i - 1]);
      const pieceStart = pieceStartFor(i, key);
      const pieceClipStartT = start + a - pieceStart; // where footage frame 0 sits on the timeline
      const px0 = x(start + a);
      const px1 = x(start + b);
      const leftInset = i === 0 ? 0 : CUT_GAP_PX;
      const rightInset = i === paintBounds.length - 2 ? 0 : CUT_GAP_PX;
      const rx0 = px0 + leftInset;
      const rx1 = px1 - rightInset;
      if (rx1 - rx0 <= 0.5) continue; // degenerate mid-drag, skip a vanishing sliver
      ctx.save();
      roundRectPath(ctx, rx0, 0, rx1 - rx0, VIDEO_H, PIECE_RADIUS);
      ctx.clip();
      ctx.fillStyle = "rgba(60,60,70,0.9)";
      ctx.fillRect(px0, 0, px1 - px0, VIDEO_H);
      // Frames for this piece only (its own slice of footage time — independent of its neighbour).
      if (Number.isFinite(slotSec) && slotSec > 0) {
        const firstK = Math.max(0, Math.floor(pieceStart / slotSec));
        const lastK = Math.floor((pieceStart + (b - a)) / slotSec) + 1;
        for (let k = firstK; k <= lastK; k++) {
          const t = k * slotSec;
          if (clipDur !== undefined && t >= clipDur) break;
          const img = grabber.get(t);
          const fpx = x(pieceClipStartT + t);
          if (img) ctx.drawImage(img, fpx, 0, THUMB_W, VIDEO_H);
          else {
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.fillRect(fpx, 0, THUMB_W, VIDEO_H);
          }
          // Thin seam between frames, like a real filmstrip.
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(fpx, 0, 1, VIDEO_H);
        }
      }
      // This piece's own footage ran out: hatched hold, confined to the piece's own shape.
      const pieceEndFootage = pieceStart + (b - a);
      if (clipDur !== undefined && clipDur < pieceEndFootage) {
        const hx = Math.max(x(pieceClipStartT + clipDur), px0);
        ctx.fillStyle = "rgba(234,179,8,0.28)";
        ctx.fillRect(hx, 0, px1 - hx, VIDEO_H);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
        for (let hpx = hx - VIDEO_H; hpx < px1; hpx += 8) {
          ctx.beginPath();
          ctx.moveTo(hpx, VIDEO_H);
          ctx.lineTo(hpx + VIDEO_H, 0);
          ctx.stroke();
        }
      }
      ctx.restore();
      // A faint border so each block reads as its own piece, like a clip chip.
      ctx.save();
      roundRectPath(
        ctx,
        rx0 + 0.5,
        0.5,
        rx1 - rx0 - 1,
        VIDEO_H - 1,
        PIECE_RADIUS
      );
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    // Neighbours: their own frames, dimmed, so the cut reads against what's either side.
    const paintSlab = (
      g: typeof grabber,
      slabX0: number,
      slabX1: number,
      footageAt: (t: number) => number, // timeline sec → footage sec
      timelineAt: (f: number) => number // footage sec → timeline sec
    ) => {
      if (slabX1 - slabX0 <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(slabX0, 0, slabX1 - slabX0, VIDEO_H);
      ctx.clip();
      ctx.fillStyle = "rgba(60,60,70,0.9)";
      ctx.fillRect(slabX0, 0, slabX1 - slabX0, VIDEO_H);
      if (Number.isFinite(slotSec) && slotSec > 0) {
        const f0 = footageAt(winStart + slabX0 / pxPerSec);
        const f1 = footageAt(winStart + slabX1 / pxPerSec);
        ctx.globalAlpha = 0.45;
        for (
          let k = Math.max(0, Math.floor(f0 / slotSec));
          k * slotSec <= f1;
          k++
        ) {
          const f = k * slotSec;
          const img = g.get(f);
          const px = x(timelineAt(f));
          if (img) ctx.drawImage(img, px, 0, THUMB_W, VIDEO_H);
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(px, 0, 1, VIDEO_H);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    };
    if (sx > 0 && prevStartSec !== undefined)
      paintSlab(
        prevGrabber,
        0,
        sx,
        t => prevClipIn + (t - prevStartSec),
        f => prevStartSec + (f - prevClipIn)
      );
    else if (sx > 0) {
      ctx.fillStyle = "rgba(120,120,130,0.25)";
      ctx.fillRect(0, 0, sx, VIDEO_H);
    }
    if (ex < stripW && nextEndSec !== undefined)
      paintSlab(
        nextGrabber,
        ex,
        stripW,
        t => nextClipIn + (t - end),
        f => end + (f - nextClipIn)
      );
    else if (ex < stripW) {
      ctx.fillStyle = "rgba(120,120,130,0.25)";
      ctx.fillRect(ex, 0, stripW - ex, VIDEO_H);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stripW,
    start,
    end,
    clipIn,
    clipDur,
    slotSec,
    grabber.version,
    prevGrabber.version,
    nextGrabber.version,
    prevClipIn,
    nextClipIn,
    winStart,
    winLen,
    cuts,
    draggingCut,
    pieceSlipsMap,
    draggingPieceSlip,
  ]);

  // Voice track: this scene's slice (persisted bounds) and the neighbours', as waveforms.
  const mine = usePeaks(props.audioUrl);
  const prevPeaks = usePeaks(props.prevAudioUrl);
  const nextPeaks = usePeaks(props.nextAudioUrl);
  useEffect(() => {
    const c = voiceRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(stripW * dpr);
    c.height = Math.round(VOICE_H * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stripW, VOICE_H);
    const draw = (
      p: { peaks: Float32Array; duration: number } | null,
      fromSec: number,
      toSec: number,
      color: string
    ) => {
      const x0 = x(fromSec);
      const x1 = x(toSec);
      ctx.fillStyle = "rgba(45,178,165,0.18)";
      ctx.fillRect(x0, 0, x1 - x0, VOICE_H);
      if (!p || p.duration <= 0) return;
      ctx.fillStyle = color;
      const mid = VOICE_H / 2;
      for (
        let px = Math.max(0, Math.floor(x0));
        px < Math.min(stripW, x1);
        px++
      ) {
        // `px` is floored to an integer pixel but `x0` usually isn't, so the very first pixel
        // of a segment can sit fractionally BEFORE x0 — `f` goes slightly negative, floors to
        // -1, and indexes the peaks array from the end (`undefined` past index 0), turning that
        // bar into `NaN` height, which `fillRect` silently skips: a blank sliver at the start of
        // every drawn segment (i.e. right where a scene's own waveform begins).
        const f = (px - x0) / Math.max(1, x1 - x0);
        const i = Math.max(
          0,
          Math.min(p.peaks.length - 1, Math.floor(f * p.peaks.length))
        );
        const h = Math.max(1, p.peaks[i] * (VOICE_H - 4));
        ctx.fillRect(px, mid - h / 2, 1, h);
      }
    };
    if (prevStartSec !== undefined)
      draw(
        prevPeaks,
        Math.max(winStart, prevStartSec),
        startSec,
        "rgba(45,178,165,0.45)"
      );
    draw(mine, startSec, endSec, "rgb(45,178,165)");
    if (nextEndSec !== undefined)
      draw(
        nextPeaks,
        endSec,
        Math.min(winEnd, nextEndSec),
        "rgba(45,178,165,0.45)"
      );
    // The draft cuts over the voice, so a moved cut reads against the words.
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(x(start) - 0.5, 0, 1, VOICE_H);
    ctx.fillRect(x(end) - 0.5, 0, 1, VOICE_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stripW,
    mine,
    prevPeaks,
    nextPeaks,
    startSec,
    endSec,
    start,
    end,
    winStart,
    winLen,
    prevStartSec,
    nextEndSec,
  ]);

  const timeAtX = (clientX: number) => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect) return start;
    return winStart + ((clientX - rect.left) / rect.width) * winLen;
  };
  const scrubTo = (clientX: number) => {
    const off = r3(
      clamp(
        timeAtX(clientX) - live.current.start,
        0,
        live.current.end - live.current.start
      )
    );
    setPlayhead(off);
    seekTo(off);
  };
  const begin = (d: Drag, e: React.PointerEvent) => {
    if (disabled || pending) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // preventDefault above also blocks the click-to-focus, so take focus by hand — the keyboard
    // shortcuts (space, arrows) need the editor focused.
    rootRef.current?.focus({ preventScroll: true });
    pause();
    dragRef.current = d;
    if (d.kind === "scrub") scrubTo(e.clientX);
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    if (d.kind === "scrub") {
      scrubTo(e.clientX);
      return;
    }
    const dSec = (e.clientX - d.startX) / pxPerSec;
    if (d.kind === "clip") {
      // Slipping the footage right shows an EARLIER part of it → smaller clipIn.
      if (maxSlipIn === undefined) return; // duration not in yet; never slip blind
      const next = r3(clamp(d.startClipIn - dSec, 0, maxSlipIn));
      setClipIn(next);
      seekTo(live.current.playhead, live.current.start, next);
    } else if (d.kind === "start") {
      const ns = r3(clamp(d.startVal + dSec, minStart, maxStart));
      setStart(ns);
      let cIn = live.current.clipIn;
      if (props.lipsync || continuousWithPrev) {
        // Mirror the server: a lip-synced host keeps its mouth on the words, and a split's two
        // halves keep their footage continuous — both mean this scene starts `ns - startSec`
        // later/earlier in its own footage (clamped at the top).
        cIn = r3(Math.max(0, persistedClipIn + (ns - startSec)));
        setClipIn(cIn);
      }
      setPlayhead(0); // preview the new first frame
      seekTo(0, ns, cIn);
    } else if (d.kind === "headhold") {
      // The first scene's own handle: nothing to trade with, so dragging right just grows the
      // pause before the picture (and its narration) starts — clamped at 0, never negative.
      const next = r3(clamp(d.startVal + dSec, 0, MAX_HEAD_HOLD_SEC));
      setHeadHold(next);
    } else if (d.kind === "cutmove") {
      // Bounds: both slice edges, and MIN_SLICE_SEC clear of every OTHER cut (this one is free
      // to slide through where it started).
      let lo = MIN_SLICE_SEC;
      let hi = sliceLen - MIN_SLICE_SEC;
      for (const c of cuts) {
        if (c === d.startVal) continue;
        if (c < d.startVal) lo = Math.max(lo, c + MIN_SLICE_SEC);
        else hi = Math.min(hi, c - MIN_SLICE_SEC);
      }
      // ...and never past where the piece it ends still HAS picture: a cut dropped inside a
      // frozen tail divides one still frame from the same still frame.
      const cutLiveEnd = liveEndOf(Math.max(0, cuts.indexOf(d.startVal)));
      if (cutLiveEnd !== undefined) hi = Math.min(hi, cutLiveEnd);
      const next = r3(clamp(d.startVal + dSec, lo, hi));
      setDraggingCut({ original: d.startVal, current: next });
      setPlayhead(next);
      seekTo(next);
    } else if (d.kind === "pieceslip") {
      // Slipping right shows an EARLIER part of the footage → smaller offset, same as the
      // whole-scene ⇄ slip — but scoped to this ONE piece, independent of its neighbour.
      if (d.maxIn === undefined) return; // duration not in yet; never slip blind
      const next = r3(clamp(d.startVal - dSec, 0, d.maxIn));
      setDraggingPieceSlip({ cutKey: d.cutKey, current: next });
      // Live-preview: if the playhead is inside THIS piece, reseek the viewer to it directly
      // (bypassing the not-yet-committed drag state, which react hasn't re-rendered with yet).
      const idx = cuts.indexOf(Number(d.cutKey));
      if (idx >= 0) {
        const a = bounds[idx + 1];
        const b = bounds[idx + 2];
        const ph = live.current.playhead;
        if (ph >= a && ph < b) {
          const v = videoRef.current;
          if (v) {
            try {
              v.currentTime = Math.max(0, next + (ph - a));
            } catch {
              /* metadata not loaded yet */
            }
          }
        }
      }
    } else {
      const ne = r3(clamp(d.startVal + dSec, minEnd, maxEnd));
      setEnd(ne);
      const off = r3(ne - live.current.start); // preview the new last frame
      setPlayhead(off);
      seekTo(off);
    }
  };
  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind === "cutmove") {
      const moved = draggingCut;
      setDraggingCut(null);
      if (moved && Math.abs(moved.current - moved.original) > 1e-6) {
        setOptimisticCuts(
          cuts
            .map(c => (c === moved.original ? moved.current : c))
            .sort((a, b) => a - b)
        );
        props.onMoveCut?.(moved.original, moved.current);
      }
    } else if (d?.kind === "pieceslip") {
      const moved = draggingPieceSlip;
      setDraggingPieceSlip(null);
      if (moved) {
        const baseline =
          pieceSlipsMap[moved.cutKey] ?? clipIn + Number(moved.cutKey);
        if (Math.abs(moved.current - baseline) > 1e-6) {
          setOptimisticPieceSlips({
            ...pieceSlipsMap,
            [moved.cutKey]: moved.current,
          });
          props.onSetPieceClipIn?.(Number(moved.cutKey), moved.current);
        }
      }
    }
  };

  const reset = () => {
    pause();
    setStart(startSec);
    setEnd(endSec);
    setClipIn(persistedClipIn);
    setHold(persistedHold);
    setHeadHold(persistedHeadHold);
    setPlayhead(0);
    seekTo(0, startSec, persistedClipIn);
  };

  const apply = () => {
    pause();
    const edit: SceneTimingDraft = {};
    if (clipIn !== persistedClipIn) edit.clipInSec = clipIn;
    if (start !== startSec) edit.startSec = start;
    if (end !== endSec) edit.endSec = end;
    if (hold !== persistedHold) edit.tailHoldSec = hold;
    if (headHold !== persistedHeadHold) edit.headHoldSec = headHold;
    if (Object.keys(edit).length === 0) return;
    props.onApply(edit);
  };

  // A split may only land where there is real picture. Past `liveEnd` the scene is holding its
  // last frame, and a marker there divides a still from itself.
  const splitLiveEnd = liveEndOf(playheadPieceIdx);
  const splitPastFootage =
    splitLiveEnd !== undefined && playhead > splitLiveEnd + 1e-6;
  const canSplit =
    !dirty &&
    !splitPastFootage &&
    playhead >= MIN_SLICE_SEC &&
    sliceLen - playhead >= MIN_SLICE_SEC &&
    !cuts.some(c => Math.abs(c - playhead) < MIN_SLICE_SEC);
  const addCut = () => {
    pause();
    setOptimisticCuts([...cuts, r3(playhead)].sort((a, b) => a - b));
    props.onSplit(playhead);
  };
  const removeCut = (c: number) => {
    pause();
    setOptimisticCuts(cuts.filter(x => x !== c));
    props.onRemoveCut?.(c);
  };
  const resetPieceSlip = (key: string) => {
    pause();
    const rest = { ...pieceSlipsMap };
    delete rest[key];
    setOptimisticPieceSlips(rest);
    props.onSetPieceClipIn?.(Number(key), null);
  };
  const atFreeze = clipEndT !== undefined && start + playhead > clipEndT + 0.02;
  const playheadPct = pct(start + playhead);
  const TRACKS_H = RULER_H + VIDEO_H + VOICE_H + 4;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="space-y-2 rounded border border-border bg-secondary/20 p-2 outline-none focus-visible:ring-1 focus-visible:ring-primary"
      title="Space: play/pause · ←/→: nudge 0.1s (shift: 1s)"
    >
      {/* Viewer — the scene as it will ship: picture at the playhead, voice under it. */}
      <div className="relative overflow-hidden rounded bg-black">
        <video
          ref={videoRef}
          src={props.clipUrl}
          muted
          playsInline
          preload="metadata"
          className="mx-auto aspect-video max-h-[240px] w-full object-contain"
          onLoadedMetadata={e => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration)) setClipDur(r3(v.duration));
            seekTo(live.current.playhead);
          }}
          onClick={() => (playing ? pause() : play())}
        />
        {voiceSrc && <audio ref={audioRef} src={voiceSrc} preload="metadata" />}
        {atFreeze && (
          <span className="pointer-events-none absolute right-2 top-2 rounded bg-warning/80 px-1.5 py-0.5 text-[10px] font-medium text-black">
            last frame held — footage ended
          </span>
        )}
        <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white">
          {clock(start + playhead, true)} · +{playhead.toFixed(2)}s /{" "}
          {sliceLen.toFixed(2)}s
        </span>
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          disabled={disabled}
          onClick={() => (playing ? pause() : play())}
          title={playing ? "Pause (space)" : "Play from the playhead (space)"}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          disabled={disabled}
          onClick={() => {
            pause();
            setPlayhead(0);
            seekTo(0);
          }}
          title="Back to the start of the scene"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          On screen {fmt(start)} → {fmt(end)} ({fmt(sliceLen)})
          {clipDur !== undefined && (
            <>
              {" "}
              · footage {fmt(clipDur)}
              {playheadPieceStart > 0.005 && (
                <>, starts {fmt(playheadPieceStart)} in</>
              )}
              {freezeSec !== undefined && freezeSec > 0.05 && (
                <> · last frame freezes {fmt(freezeSec)}</>
              )}
            </>
          )}
          {props.lipsync && (
            <>
              {" "}
              · host lip-sync: a start move trims to keep the mouth on the words
            </>
          )}
          {!props.masterAudioUrl && props.audioUrl && start !== startSec && (
            <> · voice preview approximate until applied</>
          )}
        </p>
      </div>

      {/* Timeline — ruler, filmstrip between the cut handles, voice waveform, playhead. */}
      <div
        ref={stripRef}
        className="relative select-none overflow-hidden rounded bg-[#1b1d22] text-white"
        style={{ height: TRACKS_H }}
        onPointerDown={e => begin({ kind: "scrub" }, e)}
        onPointerMove={move}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Ruler */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 border-b border-white/10"
          style={{ height: RULER_H }}
        >
          {ticks.at.map(t => (
            <div
              key={t}
              className="absolute bottom-0 h-full"
              style={{ left: `${pct(t)}%` }}
            >
              <div className="absolute bottom-0 left-0 h-1.5 w-px bg-white/50" />
              <span className="absolute bottom-1.5 left-1 font-mono text-[9px] leading-none text-white/60">
                {clock(t, ticks.decimals)}
              </span>
            </div>
          ))}
        </div>
        {/* Video track: the filmstrip (canvas) + the cut handles. */}
        <div
          className="absolute inset-x-0"
          style={{ top: RULER_H + 2, height: VIDEO_H }}
        >
          <canvas
            ref={filmRef}
            className="absolute inset-0 h-full w-full"
            style={{ width: stripW, height: VIDEO_H }}
          />
          {/* The slice: click/drag scrubs (like the rest of the strip); SHIFT-drag slips the
              footage under the slice. The ⇄ grip slips without the modifier. */}
          <div
            className="absolute inset-y-0"
            style={{
              left: `${pct(start)}%`,
              width: `${pct(end) - pct(start)}%`,
            }}
            title={
              clipDur !== undefined
                ? `Footage ${fmt(clipDur)}${clipIn > 0 ? ` — starts ${fmt(clipIn)} in` : ""}. Click to place the playhead · shift-drag (or drag ⇄) to slip the footage.`
                : "Click to place the playhead · shift-drag to slip the footage"
            }
            onPointerDown={e =>
              e.shiftKey
                ? begin(
                    { kind: "clip", startX: e.clientX, startClipIn: clipIn },
                    e
                  )
                : begin({ kind: "scrub" }, e)
            }
          >
            <span className="pointer-events-none absolute left-1 top-0.5 rounded bg-black/50 px-1 font-mono text-[9px] text-white/80">
              scene {props.sceneIndex}
              {clipIn > 0 ? ` · +${fmt(clipIn)}` : ""}
            </span>
            <span
              className="absolute bottom-0.5 left-1 cursor-grab rounded bg-black/60 px-1 font-mono text-[10px] text-white/90 hover:bg-primary active:cursor-grabbing"
              title="Drag to slip the footage under this slice (which part of the clip plays)"
              onPointerDown={e =>
                begin(
                  { kind: "clip", startX: e.clientX, startClipIn: clipIn },
                  e
                )
              }
            >
              ⇄ slip
            </span>
          </div>
          {/* Neighbour clips: click to edit that scene (its footage is drawn on the slab). */}
          {prevStartSec !== undefined && props.prevIndex !== undefined && (
            <div
              className="group absolute inset-y-0 left-0 cursor-pointer"
              style={{ width: `${pct(start)}%` }}
              title={`Edit scene ${props.prevIndex}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                props.onSelectScene?.(props.prevIndex as number);
              }}
            >
              <span className="pointer-events-none absolute right-1 top-0.5 rounded bg-black/45 px-1 font-mono text-[9px] text-white/70 group-hover:bg-primary group-hover:text-white">
                ‹ scene {props.prevIndex}
              </span>
            </div>
          )}
          {nextEndSec !== undefined && props.nextIndex !== undefined && (
            <div
              className="group absolute inset-y-0 right-0 cursor-pointer"
              style={{ width: `${100 - pct(end)}%` }}
              title={`Edit scene ${props.nextIndex}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => {
                e.stopPropagation();
                props.onSelectScene?.(props.nextIndex as number);
              }}
            >
              <span className="pointer-events-none absolute left-1 top-0.5 rounded bg-black/45 px-1 font-mono text-[9px] text-white/70 group-hover:bg-primary group-hover:text-white">
                scene {props.nextIndex} ›
              </span>
            </div>
          )}
          {/* Cut handles — CapCut-style white grips at the clip edges. */}
          {prevStartSec !== undefined ? (
            <div
              className="absolute inset-y-0 flex w-3 -translate-x-1/2 cursor-col-resize items-center justify-center rounded-l bg-white hover:bg-primary"
              style={{ left: `${pct(start)}%` }}
              title="Move the cut with the previous scene"
              onPointerDown={e =>
                begin({ kind: "start", startX: e.clientX, startVal: start }, e)
              }
            >
              <div className="h-4 w-0.5 rounded bg-black/50" />
            </div>
          ) : (
            // The FIRST scene of the film: no neighbour to trade time with, so this handle
            // holds instead of moves — drag right to add a silent pause before playback starts.
            <div
              className="absolute inset-y-0 flex w-3 -translate-x-1/2 cursor-col-resize items-center justify-center rounded-l bg-white hover:bg-primary"
              style={{ left: `${pct(start)}%` }}
              title={
                headHold > 0
                  ? `Hold before this scene's first word (+${fmt(headHold)}) — drag to adjust`
                  : "Drag to hold before this scene's first word (a pause before playback starts)"
              }
              onPointerDown={e =>
                begin(
                  { kind: "headhold", startX: e.clientX, startVal: headHold },
                  e
                )
              }
            >
              <div className="h-4 w-0.5 rounded bg-black/50" />
              {headHold > 0 && (
                <span className="pointer-events-none absolute bottom-5 left-0 whitespace-nowrap rounded bg-black/60 px-1 font-mono text-[9px] text-white/90">
                  hold +{fmt(headHold)}
                </span>
              )}
            </div>
          )}
          {nextEndSec !== undefined && (
            <div
              className="absolute inset-y-0 flex w-3 -translate-x-1/2 cursor-col-resize items-center justify-center rounded-r bg-white hover:bg-primary"
              style={{ left: `${pct(end)}%` }}
              title="Move the cut with the next scene"
              onPointerDown={e =>
                begin({ kind: "end", startX: e.clientX, startVal: end }, e)
              }
            >
              <div className="h-4 w-0.5 rounded bg-black/50" />
            </div>
          )}
          {/* Per-piece slip handles — every piece AFTER the first cut can show a different
              moment of the SAME footage, independent of its neighbour (piece 0's slip is the
              main "⇄ slip" grip on the slice above). */}
          {cuts.map((c, idx) => {
            const key = String(c);
            const a = bounds[idx + 1];
            const b = bounds[idx + 2];
            const pieceStart = pieceStartFor(idx + 1, key);
            const hasOverride = key in pieceSlipsMap;
            return (
              <div
                key={`pieceslip-${key}`}
                className="pointer-events-none absolute inset-y-0"
                style={{
                  left: `${pct(start + a)}%`,
                  width: `${pct(start + b) - pct(start + a)}%`,
                }}
              >
                <div className="pointer-events-auto absolute bottom-0.5 left-1 flex items-center gap-0.5">
                  <span
                    className="cursor-grab rounded bg-black/60 px-1 font-mono text-[10px] text-white/90 hover:bg-primary active:cursor-grabbing"
                    title="Drag to slip this piece's footage — independent of its neighbour"
                    onPointerDown={e => {
                      begin(
                        {
                          kind: "pieceslip",
                          startX: e.clientX,
                          startVal: pieceStart,
                          cutKey: key,
                          maxIn: maxSlipIn,
                        },
                        e
                      );
                    }}
                  >
                    ⇄ slip
                  </span>
                  {hasOverride && (
                    <button
                      type="button"
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:border-destructive hover:text-destructive"
                      disabled={disabled || pending}
                      title="Reset this piece to the continuous default"
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => {
                        e.stopPropagation();
                        resetPieceSlip(key);
                      }}
                    >
                      <X className="h-2 w-2" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Voice track */}
        <canvas
          ref={voiceRef}
          className="pointer-events-none absolute inset-x-0"
          style={{ top: RULER_H + VIDEO_H + 4, width: stripW, height: VOICE_H }}
        />
        {/* Cut hit-zones — the CUT ITSELF is the visible gap between two rounded blocks in the
            canvas above; these are just the (invisible) drag handle and the small remove
            control sitting on top of it. Drag anywhere on the gap to slide the cut. */}
        {cuts.map(c => {
          const shown =
            draggingCut && draggingCut.original === c ? draggingCut.current : c;
          return (
            <div
              key={c}
              className="absolute"
              style={{
                left: `${pct(start + shown)}%`,
                top: RULER_H,
                height: VIDEO_H + 2,
              }}
            >
              <div
                className="absolute inset-y-0 left-0 w-4 -translate-x-1/2 cursor-ew-resize"
                title={`Drag to move this cut (+${fmt(shown)})`}
                onPointerDown={e => {
                  if (disabled || pending) return;
                  setDraggingCut({ original: c, current: c });
                  begin({ kind: "cutmove", startX: e.clientX, startVal: c }, e);
                }}
              />
              <button
                type="button"
                className="pointer-events-auto absolute left-0 top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:border-destructive hover:text-destructive"
                disabled={disabled || pending}
                title={`Remove this cut (at +${fmt(c)})`}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation();
                  removeCut(c);
                }}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          );
        })}
        {/* Playhead: full height, wide grab zone, knob on the ruler. */}
        <div
          className="absolute inset-y-0 w-4 -translate-x-1/2 cursor-ew-resize"
          style={{ left: `${playheadPct}%` }}
          title="Drag to scrub"
          onPointerDown={e => begin({ kind: "scrub" }, e)}
        >
          <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" />
          <div className="absolute left-1/2 top-0 h-3.5 w-3 -translate-x-1/2 rounded-b-sm rounded-t bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Hold after line
          <Input
            type="number"
            min={0}
            max={MAX_TAIL_HOLD_SEC}
            step={0.5}
            value={hold}
            disabled={disabled || pending}
            onChange={e => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              setHold(r3(clamp(v, 0, MAX_TAIL_HOLD_SEC)));
            }}
            className="h-7 w-16 text-xs"
          />
          s
          {props.qrTail && (
            <span className="text-[10px]">
              (CTA release beat — default {DEFAULT_QR_TAIL_HOLD_SEC}s; 0 removes
              the pause)
            </span>
          )}
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={disabled || pending || !canSplit}
            title={
              dirty
                ? "Apply or reset your timing changes first"
                : splitPastFootage
                  ? "The footage has run out here — the picture is holding its last frame. Move the playhead back into the clip to split it."
                  : `Cut the clip here (+${fmt(playhead)}) — a marker on the same clip, like a CapCut split`
            }
            onClick={addCut}
          >
            <Scissors className="mr-1.5 h-3 w-3" />
            Split here
          </Button>
          {props.canRevert && props.onRevert && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={disabled || pending}
              title="Put this scene back to the cut it had before your first timing edit — trim, splits, slips and holds. Its start and end are shared with the scenes either side, so those move back with it."
              onClick={() => {
                pause();
                props.onRevert?.();
              }}
            >
              <History className="mr-1.5 h-3 w-3" />
              Revert to original
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={disabled || pending || !dirty}
            title="Discard the changes you haven't applied yet"
            onClick={reset}
          >
            <RotateCcw className="mr-1.5 h-3 w-3" />
            Reset
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={disabled || pending || !dirty}
            onClick={apply}
          >
            {pending ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3 w-3" />
            )}
            Apply timing
          </Button>
        </div>
      </div>
    </div>
  );
}

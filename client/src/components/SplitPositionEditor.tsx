/**
 * client/src/components/SplitPositionEditor.tsx
 *
 * CapCut-style position editor for a split-screen scene. The two halves are the two real
 * videos (bare host render + standalone b-roll panel) laid out exactly as the ffmpeg
 * compositor will lay them out, so what you drag IS what renders:
 *
 * - drag inside a panel  → pans that clip inside its panel (`hostFocusX` / `brollFocusX`)
 * - drag the divider     → moves the seam between the panels (`seamX`)
 * - swap button          → mirrors which side the host sits on (`hostSide`)
 *
 * The CSS `object-position` math below reproduces ffmpeg's cover-scale-then-crop: ffmpeg puts
 * the crop window's left edge at clamp(focus·W − w/2, 0, W−w); CSS object-position P% puts it
 * at P·(W−w). Equating the two gives P — so the preview and the render agree pixel-for-pixel.
 *
 * Everything here is preview-only. Apply sends one `layout` edit; the server recomposites the
 * stored halves with ffmpeg — no provider call, no credits, and a manual host position also
 * skips the face-detection pass.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, Check, Loader2, RotateCcw } from "lucide-react";
import type { SplitLayout } from "@shared/types";

/** Canvas aspect — longform is always 16:9. */
const CANVAS_AR = 16 / 9;
/** The stock layout's seam when the host is LEFT: square b-roll panel, host the remainder. */
const DEFAULT_HOST_LEFT_SEAM = 1 - 1 / CANVAS_AR; // 0.4375
const SEAM_MIN = 0.2;
const SEAM_MAX = 0.8;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Seam the server uses when none is stored, for the given host side. */
const defaultSeam = (hostOnLeft: boolean) =>
  hostOnLeft ? DEFAULT_HOST_LEFT_SEAM : 1 - DEFAULT_HOST_LEFT_SEAM;

/**
 * CSS object-position X (0..100) that reproduces ffmpeg's focus crop for a cover-fit video.
 * `panelAR` is the panel's own width/height; `srcAR` the source's. No horizontal slack (source
 * not wider than the panel) ⇒ centred, same as ffmpeg.
 */
function objectPositionX(
  focus: number,
  srcAR: number | undefined,
  panelAR: number
): number {
  if (!srcAR || srcAR <= panelAR) return 50;
  return clamp(
    ((focus * srcAR - panelAR / 2) / (srcAR - panelAR)) * 100,
    0,
    100
  );
}

type DragState =
  | { kind: "seam"; containerLeft: number; containerW: number }
  | {
      kind: "host" | "broll";
      startX: number;
      startFocus: number;
      panelW: number;
      panelAR: number;
      srcAR: number;
    };

export function SplitPositionEditor(props: {
  hostUrl: string;
  rightUrl: string;
  /** The persisted layout — the editor re-seeds from it whenever it changes. */
  layout?: SplitLayout;
  pending?: boolean;
  disabled?: boolean;
  onApply: (layout: SplitLayout) => void;
}) {
  const { layout, pending, disabled } = props;
  const [draft, setDraft] = useState<SplitLayout>(() => ({ ...layout }));
  const [dirty, setDirty] = useState(false);
  // Natural aspect of each source, once metadata arrives — needed for the crop math.
  const [srcAR, setSrcAR] = useState<{ host?: number; broll?: number }>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // Re-seed from the scene whenever the persisted layout changes (apply round-trip). Keyed by
  // VALUE, not object identity — polling recreates the object every few seconds, and resetting
  // on identity would yank the handles out of the operator's hand mid-drag.
  const layoutKey = JSON.stringify(layout ?? null);
  useEffect(() => {
    setDraft({ ...layout });
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const hostOnLeft = (draft.hostSide ?? "left") !== "right";
  const seam = draft.seamX ?? defaultSeam(hostOnLeft);
  const hostFrac = hostOnLeft ? seam : 1 - seam;
  const brollFrac = 1 - hostFrac;
  const hostAR = hostFrac * CANVAS_AR;
  const brollAR = brollFrac * CANVAS_AR;
  const hostFocus = draft.hostFocusX; // undefined ⇒ auto face detection on the server
  const brollFocus = draft.brollFocusX ?? 0.5;

  const edit = (patch: Partial<SplitLayout>) => {
    setDraft(d => ({ ...d, ...patch }));
    setDirty(true);
  };

  const beginPanelDrag = (
    kind: "host" | "broll",
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (disabled || pending) return;
    const ar = kind === "host" ? srcAR.host : srcAR.broll;
    const panelAR = kind === "host" ? hostAR : brollAR;
    if (!ar || ar <= panelAR) return; // no horizontal slack — nothing to pan
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind,
      startX: e.clientX,
      startFocus: kind === "host" ? (hostFocus ?? 0.5) : brollFocus,
      panelW: e.currentTarget.getBoundingClientRect().width,
      panelAR,
      srcAR: ar,
    };
  };

  const beginSeamDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || pending) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "seam",
      containerLeft: rect.left,
      containerW: rect.width,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    if (d.kind === "seam") {
      edit({
        seamX: clamp(
          (e.clientX - d.containerLeft) / d.containerW,
          SEAM_MIN,
          SEAM_MAX
        ),
      });
      return;
    }
    // Dragging the content: the clip follows the pointer, so the focus moves the other way.
    const df = ((e.clientX - d.startX) * d.panelAR) / (d.srcAR * d.panelW);
    const focus = clamp(d.startFocus - df, 0, 1);
    edit(d.kind === "host" ? { hostFocusX: focus } : { brollFocusX: focus });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const swapSides = () => {
    // Mirror the seam too, so each panel keeps its width — the panels trade places whole.
    edit({
      hostSide: hostOnLeft ? "right" : "left",
      seamX: 1 - seam,
    });
  };

  const reset = () => {
    setDraft({});
    setDirty(true);
  };

  const panel = (kind: "host" | "broll") => {
    const isHost = kind === "host";
    const focus = isHost ? (hostFocus ?? 0.5) : brollFocus;
    const posX = objectPositionX(
      focus,
      isHost ? srcAR.host : srcAR.broll,
      isHost ? hostAR : brollAR
    );
    return (
      <div
        key={kind}
        className="relative h-full overflow-hidden cursor-grab active:cursor-grabbing"
        style={{ width: `${(isHost ? hostFrac : brollFrac) * 100}%` }}
        onPointerDown={e => beginPanelDrag(kind, e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <video
          src={isHost ? props.hostUrl : props.rightUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="h-full w-full object-cover pointer-events-none"
          style={{ objectPosition: `${posX}% 50%` }}
          onLoadedMetadata={e => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight)
              setSrcAR(p => ({ ...p, [kind]: v.videoWidth / v.videoHeight }));
          }}
        />
        <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white pointer-events-none">
          {isHost ? "Host" : "B-roll"}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-2" onClick={e => e.stopPropagation()}>
      <div
        ref={containerRef}
        className="relative w-full aspect-video bg-black rounded overflow-hidden select-none touch-none flex"
      >
        {hostOnLeft
          ? [panel("host"), panel("broll")]
          : [panel("broll"), panel("host")]}
        {/* Seam handle — the black divider the compositor draws, draggable. */}
        <div
          className="absolute inset-y-0 z-10 cursor-col-resize"
          style={{ left: `calc(${seam * 100}% - 6px)`, width: 12 }}
          onPointerDown={beginSeamDrag}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="absolute inset-y-0 left-1/2 -ml-[2px] w-[4px] bg-black" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-[6px] rounded bg-white/80" />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Drag a clip to position it in its panel · drag the divider to resize the
        panels ·{" "}
        {hostFocus == null
          ? "host is auto-centered on the face until you drag it"
          : `host position ${(hostFocus * 100).toFixed(0)}% (manual)`}{" "}
        · seam {(seam * 100).toFixed(0)}%
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={disabled || pending}
          onClick={swapSides}
        >
          <ArrowLeftRight className="mr-1.5 h-3 w-3" />
          Swap sides
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={disabled || pending}
          onClick={reset}
        >
          <RotateCcw className="mr-1.5 h-3 w-3" />
          Reset to auto
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={disabled || pending || !dirty}
          onClick={() => props.onApply(draft)}
        >
          {pending ? (
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-3 w-3" />
          )}
          Apply position
        </Button>
      </div>
    </div>
  );
}

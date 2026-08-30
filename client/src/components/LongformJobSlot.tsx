import { useState, useEffect, useId, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { downloadFile } from "@/lib/download";
import { armNotifications, notifyJobDone } from "@/lib/notify";
import { useAuth } from "@/_core/hooks/useAuth";
import { LongformVideoPlayer } from "./LongformVideoPlayer";
import { GenerationCostDialog } from "./GenerationCostDialog";
import { ChannelVoiceTuning } from "@/components/ChannelVoiceTuning";
import {
  LongformCtaBooks,
  type CtaBookAssignment,
} from "@/components/LongformCtaBooks";
import { LongformPublishKit } from "@/components/LongformPublishKit";
import { LongformScenePreview } from "@/components/LongformScenePreview";
import { SceneStripThumb } from "@/components/SceneStripThumb";
import { SplitPositionEditor } from "@/components/SplitPositionEditor";
import { SceneTimingEditor } from "@/components/SceneTimingEditor";
import {
  CutPreviewSwitch,
  LongformCutPreview,
  QR_TAIL_HOLD_SEC,
} from "@/components/LongformCutPreview";
import {
  FPS,
  planMasterOverlayScenes,
  sceneHoldPlan,
} from "@shared/filmTimeline";
import { sanitizeError, isCreditError } from "@/lib/errorSanitizer";
import { triggerCreditErrorPopup } from "@/components/CreditErrorPopup";
import type { SplitLayout, StoryboardScene } from "@shared/types";
import {
  scanCtaBlocks,
  previewBookAssignments,
  ctaLabelMatches,
  CTA_MARKER_TEMPLATE,
  CTA_TEMPLATE_PLACEHOLDER,
} from "@shared/ctaMarkers";
import {
  ScanFace,
  Loader2,
  Download,
  CheckCircle2,
  XCircle,
  X,
  RefreshCw,
  Film,
  Image as ImageIcon,
  Images,
  User,
  Trees,
  Search,
  Pencil,
  ChevronRight,
  Receipt,
  Columns2,
  Scissors,
  BookOpen,
  History,
  Merge,
} from "lucide-react";

export type SlotStatus = "idle" | "processing" | "completed" | "failed";

/**
 * One numbered section of the generate form.
 *
 * The form was a single undivided card holding six unrelated controls in a flat
 * `space-y-6` stack — a script box, a channel picker, CTA books, asset uploads, a
 * title and a warning — with no signal about which were required to press the
 * button at the bottom. Numbering them says how many decisions there are and how
 * far along you got; the rules between them say where one ends.
 */
function Step({
  n,
  title,
  hint,
  optional,
  collapsed,
  onToggle,
  summary,
  children,
}: {
  n: number;
  title: string;
  hint?: React.ReactNode;
  optional?: boolean;
  /**
   * Pass a boolean to make the step collapsible; the header becomes the toggle. Undefined
   * leaves it a plain always-open section, which is what the other three steps want — their
   * controls are a few rows each and hiding them would only add a click.
   */
  collapsed?: boolean;
  onToggle?: () => void;
  /** Stand-in shown in place of the body while collapsed. */
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const bodyId = useId();
  const collapsible = collapsed !== undefined;
  const isOpen = !collapsed;

  const heading = (
    <>
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-medium tabular-nums text-muted-foreground"
      >
        {n}
      </span>
      <h3 className="text-sm font-medium">{title}</h3>
      {optional && (
        <span className="text-xs font-normal text-muted-foreground">
          Optional
        </span>
      )}
    </>
  );

  return (
    <section className="border-t border-border px-5 py-5 first:border-t-0 sm:px-6">
      {collapsible ? (
        // A real <button> rather than a clickable div: this needs to be tabbable and to
        // toggle on Space/Enter, and `aria-expanded` is what tells a screen reader the
        // script is hidden rather than missing.
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={bodyId}
          className="group flex w-full items-center gap-2.5 text-left"
        >
          {heading}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
            {isOpen ? "Hide" : "Show"}
            <ChevronRight
              aria-hidden
              className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
          </span>
        </button>
      ) : (
        <div className="flex items-baseline gap-2.5">{heading}</div>
      )}

      {/* Unmounted rather than hidden while collapsed: the script box is the tallest thing
          on the page and a `display:none` textarea still holds its value in the DOM, so
          there is nothing to preserve by keeping it mounted. */}
      {isOpen ? (
        <div id={bodyId} className="mt-3 space-y-2 sm:pl-[30px]">
          {children}
          {hint && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
      ) : (
        summary && (
          <div id={bodyId} className="mt-2 sm:pl-[30px]">
            {summary}
          </div>
        )
      )}
    </section>
  );
}

/**
 * Read-only pointer to the channel's CTA assets, shown where the per-video uploader used to be.
 *
 * Assets moved to the channel (Admin → Channels), configured once and used by every video, so
 * the generate form no longer collects them. This just reports how many the picked channel has,
 * so it is clear the CTA already carries them and where to change them.
 */
function ChannelAssetsNote({ channelKey }: { channelKey: string }) {
  const { data } = trpc.channelAsset.list.useQuery(
    { channelKey, activeOnly: true },
    { enabled: !!channelKey }
  );
  const count = data?.length ?? 0;
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Images className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {count > 0 ? (
        <>
          {count} channel asset{count === 1 ? "" : "s"} will show in this
          video&apos;s call-to-action. Manage them under Channels.
        </>
      ) : (
        <>
          No channel assets set. Add product shots or extra renders under
          Channels and every video on this channel will show them.
        </>
      )}
    </p>
  );
}

const STAGE_LABELS: Record<string, string> = {
  storyboard: "Storyboarding script",
  voiceover: "Generating voiceovers",
  clips: "Generating video clips",
  assembly: "Stitching final video",
  done: "Done",
};

/**
 * The job id and draft title for this tab live in the database (`longform_slots`), reached
 * through the parent's `onJobIdChange` / `onTitleChange`. They used to be `localStorage`,
 * which tied the workspace to one browser; the renders were always server-side, but the tabs
 * were not. Scene-checkbox selection below stays local on purpose — it is throwaway UI state
 * for a single regenerate click.
 */

function selKey(storageKey: string, jobId: number) {
  return `${storageKey}_regen_sel_${jobId}`;
}

function loadSelectedScenes(
  storageKey: string,
  jobId: number | null
): number[] {
  if (jobId === null) return [];
  try {
    const raw = localStorage.getItem(selKey(storageKey, jobId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSelectedScenes(
  storageKey: string,
  jobId: number | null,
  ids: number[]
) {
  if (jobId === null) return;
  if (ids.length === 0) localStorage.removeItem(selKey(storageKey, jobId));
  else localStorage.setItem(selKey(storageKey, jobId), JSON.stringify(ids));
}

/** Host lip-synced on the LEFT, a still from `splitVisual` on the RIGHT. */
const isSplitScene = (s: StoryboardScene) => !!(s.hostPresent && s.splitVisual);

/**
 * The prompt a scene actually renders from. On a split scene that's `splitVisual` (the right
 * still) — its `visualPrompt` reaches no model, because the host half is lip-synced and gets
 * reused verbatim on regenerate.
 */
const ownedPrompt = (s: StoryboardScene) =>
  (isSplitScene(s) ? s.splitVisual : s.visualPrompt) ?? "";

interface LongformJobSlotProps {
  /** 0-based slot index, used for labels. */
  slotIndex: number;
  /** Unique localStorage key for this slot's job id (e.g. ..._0). */
  storageKey: string;
  /** Job id handed down by the parent for auto-resume reconciliation. */
  initialJobId?: number | null;
  /** Draft download title restored from this account's saved workspace. */
  initialTitle?: string;
  /** Report a new/cleared job id so the parent can persist the tab server-side. */
  onJobIdChange?: (jobId: number | null) => void;
  /** Report a draft-title edit (debounced by the caller) for the same reason. */
  onTitleChange?: (title: string) => void;
  /** Default script text for this slot (only slot 0 seeds the sample). */
  defaultScript: string;
  /** Channel list, lifted to the parent so it is fetched once. */
  channels: { key: string; name: string }[];
  /** Active provider display name, for the per-scene "Visual Prompt → X" label. */
  providerDisplayName?: string;
  /** Notifies the parent when this slot's job status changes (for tab badges). */
  onStatusChange?: (slotIndex: number, status: SlotStatus) => void;
}

export default function LongformJobSlot({
  slotIndex,
  storageKey,
  initialJobId,
  initialTitle = "",
  onJobIdChange,
  onTitleChange,
  defaultScript,
  channels,
  providerDisplayName,
  onStatusChange,
}: LongformJobSlotProps) {
  const [script, setScript] = useState(defaultScript);
  // Open while a tab is still being filled in, folded once it holds a render (see the
  // hydration effect). Never auto-collapses while you are typing — only adopting a job does it.
  const [scriptCollapsed, setScriptCollapsed] = useState(false);
  const [channelKey, setChannelKey] = useState<string>("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [dismissedJobId, setDismissedJobId] = useState<number | null>(null);
  const [jobId, setJobId] = useState<number | null>(() => initialJobId ?? null);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);
  // Which scene the filmstrip has open in the detail panel below it. Falls back to the first
  // scene in view when nothing's been clicked yet, or when a minute-chip/search filter drops
  // the previously active scene out of view — see `activeSceneIndex` near the storyboard list.
  const [activeSceneIndexState, setActiveSceneIndexState] = useState<
    number | null
  >(null);
  // Per-scene prompt edits, keyed by scene index. Survives collapsing/switching
  // scenes so the batch "Regenerate N selected" button can read every edit; both
  // regen buttons fall back to scene.visualPrompt when a scene wasn't edited.
  const [promptEdits, setPromptEdits] = useState<Record<number, string>>({});
  // Local override for the whole-video style bible. null = not editing, so the polled value
  // shows through — same shape as promptEdits, dropped on mutation success.
  const [bibleEdit, setBibleEdit] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState(0);
  const [queuedScenes, setQueuedScenes] = useState<number[]>([]);
  // Two-phase settle for queuedScenes: "queued" (optimistic, set on click) →
  // "confirmed" once a poll sees the scene processing server-side → removed when
  // a later poll shows it terminal. The regen mutations are fire-and-forget and
  // the server flips scene status only after slow LLM work, so settling on the
  // first terminal status would un-queue against the STALE pre-regen snapshot
  // and stop polling while the server is still working.
  const queuePhase = useRef<Map<number, "queued" | "confirmed">>(new Map());
  // When each scene was queued locally — the settle fallback for an edit so fast (ffmpeg-only
  // split edits) that no poll ever catches it in flight.
  const queuedAt = useRef<Map<number, number>>(new Map());
  // Cut-room edits (split / trim / move / hold) apply as instant metadata — they never flip the
  // job to "processing", so the normal poll gate stays off. This keeps a short, fast poll window
  // open after such an edit so its result (a re-sliced storyboard, an extra scene) shows up in
  // ~1s, then polling goes quiet again. Timestamp = poll until this ms.
  const [cutRoomWatchUntil, setCutRoomWatchUntil] = useState(0);
  const watchCutRoom = () => setCutRoomWatchUntil(Date.now() + 12_000);
  const [selectedScenes, setSelectedScenes] = useState<number[]>([]);
  const [sceneSearch, setSceneSearch] = useState("");
  const [downloadTitle, setDownloadTitle] = useState(initialTitle);
  // Whether the no-render cut preview is open (see LongformCutPreview): the browser plays the
  // scene clips against the master narration so an edit can be judged without a Reassemble.
  const [showCutPreview, setShowCutPreview] = useState(false);
  // Guard on the whole-job revert: it throws away every timing edit on the film at once, and
  // there is no snapshot of a snapshot to undo it with.
  const [confirmRevertAll, setConfirmRevertAll] = useState(false);
  // Which books this video pitches. Seeded from the draft saved in localStorage so a reload
  // doesn't lose them; a tab holding a render replaces this from `job.ctaBooks` (hydration).
  // Seeded empty; a restored DRAFT is adopted once the workspace arrives (the adopt effect
  // below), and a tab holding a render replaces this from `job.ctaBooks` (the hydration effect).
  const [ctaBooks, setCtaBooks] = useState<CtaBookAssignment[]>([]);
  // Set by the finished-video player; the timestamp map calls it to jump to a shot.
  const playerSeekRef = useRef<((sec: number) => void) | null>(null);
  // Timestamps map onto the RENDERED film, so a click while the live preview is on screen has to
  // switch back first — and the player it seeks does not exist until that render lands. Park the
  // target here and let the effect below fire it once the player has remounted.
  const pendingSeekRef = useRef<number | null>(null);
  const isAdmin = useAuth().user?.role === "admin";

  // Masked APIMART keys (admin-only). B-roll VIDEO renders on this tab's APIMART key; with no key
  // set the tab falls back to 69 Labs video, so warn the admin.
  const { data: apimartKeys } = trpc.longformVideo.getApimartKeys.useQuery(
    undefined,
    { enabled: isAdmin }
  );
  const apimartKeyMissing =
    isAdmin && !apimartKeys?.slots.find(s => s.slotIndex === slotIndex)?.masked;

  // Adopt a parent-provided id (resume reconciliation) if we don't have one yet.
  useEffect(() => {
    if (
      jobId === null &&
      initialJobId != null &&
      initialJobId !== dismissedJobId
    ) {
      setJobId(initialJobId);
    }
  }, [initialJobId, jobId, storageKey, dismissedJobId]);

  const { data: channelDefaults } = trpc.shuttle.channelDefaults.useQuery(
    { channelKey },
    { enabled: !!channelKey }
  );

  const utils = trpc.useUtils();

  const generateMutation = trpc.longformVideo.generate.useMutation({
    onSuccess: ({ jobId: id }) => {
      setDismissedJobId(null);
      setJobId(id);
      onJobIdChange?.(id);
      toast.success(`Video ${slotIndex + 1} started`);
    },
    onError: err => {
      if (isCreditError(err.message)) triggerCreditErrorPopup();
      else toast.error(err.message);
    },
  });

  const styleBibleMutation = trpc.longformVideo.setStyleBible.useMutation({
    onSuccess: () => {
      // Persisted server-side; drop the local override so the next poll is the source of truth.
      setBibleEdit(null);
      utils.longformVideo.pollJob.invalidate();
      toast.success("Style direction saved — regenerate scenes to apply");
    },
    onError: err => toast.error(err.message),
  });

  // Drop a scene from the optimistic queue — on a rejected request, or when the server says
  // it ignored it (that scene is rendering right now).
  const unqueueScene = (sceneIndex: number) => {
    queuePhase.current.delete(sceneIndex);
    queuedAt.current.delete(sceneIndex);
    setQueuedScenes(prev => prev.filter(i => i !== sceneIndex));
  };

  const regenMutation = trpc.longformVideo.regenerateScene.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        unqueueScene(vars.sceneIndex);
        if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
        toast.info(
          `Scene ${vars.sceneIndex} is already rendering — wait for it, then regenerate again`
        );
        return;
      }
      toast.success(
        d.accepted === "superseded"
          ? "Updated the queued regenerate with your latest prompt"
          : "Queued — rendering alongside your other edits"
      );
      // Collapse only THIS scene's editor; another scene's may be open mid-edit.
      setExpandedScene(cur => (cur === vars.sceneIndex ? null : cur));
      // Edit is now persisted server-side; drop the local override so the next
      // poll's scene.visualPrompt becomes the source of truth.
      setPromptEdits(p => {
        const { [vars.sceneIndex]: _, ...rest } = p;
        return rest;
      });
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: (err, vars) => {
      toast.error(err.message);
      // Roll back the optimistic queue so the spinner doesn't hang forever.
      unqueueScene(vars.sceneIndex);
    },
  });

  // Split editor: per-scene selection of "use another scene's footage as the right panel".
  const [splitSource, setSplitSource] = useState<
    Record<number, number | undefined>
  >({});
  const splitEditMutation = trpc.longformVideo.setSceneSplit.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        unqueueScene(vars.sceneIndex);
        if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
        toast.info(
          `Scene ${vars.sceneIndex} is already rendering — wait for it, then apply the split edit`
        );
        return;
      }
      toast.success(
        vars.mode === "off"
          ? "Removing the split — back to full-frame host..."
          : vars.mode === "scene"
            ? "Compositing the chosen footage beside the host..."
            : vars.mode === "layout"
              ? "Repositioning the split — pure ffmpeg, nothing regenerates..."
              : "Rendering a fresh right panel..."
      );
      setExpandedScene(cur => (cur === vars.sceneIndex ? null : cur));
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: (err, vars) => {
      toast.error(err.message);
      unqueueScene(vars.sceneIndex);
    },
  });
  const applySplitEdit = (
    scene: StoryboardScene,
    edit:
      | { mode: "off" }
      | { mode: "prompt"; prompt?: string; verbatim?: boolean }
      | { mode: "scene"; sourceIndex: number }
      | { mode: "layout"; layout: SplitLayout }
  ) => {
    if (!jobId) return;
    armNotifications();
    queuePhase.current.set(scene.index, "queued");
    queuedAt.current.set(scene.index, Date.now());
    setQueuedScenes(prev =>
      prev.includes(scene.index) ? prev : [...prev, scene.index]
    );
    splitEditMutation.mutate({ jobId, sceneIndex: scene.index, ...edit });
  };

  // Cut room: timing edits are metadata only (no render) — they persist at once and the film
  // re-stitches on Reassemble. The scene flashes through the edit session for a moment; no
  // optimistic spinner is worth it.
  const timingMutation = trpc.longformVideo.setSceneTiming.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        toast.info(
          `Scene ${vars.sceneIndex} is rendering — apply the timing change once it finishes`
        );
        return;
      }
      toast.success("Timing saved — Reassemble to apply it to the film");
      watchCutRoom();
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });
  const splitSceneMutation = trpc.longformVideo.splitScene.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        toast.info(
          `Scene ${vars.sceneIndex} is rendering — cut it once it finishes`
        );
        return;
      }
      toast.success("Cut added — the clip is marked, still one scene");
      // A cut is a marker on the SAME clip (CapCut-style): no new scene, no renumber, nothing
      // re-renders. The editor stays put; just refetch so the marker shows.
      watchCutRoom();
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });

  const undoSplitMutation = trpc.longformVideo.undoSplit.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        toast.info(
          `Scene ${vars.sceneIndex} is rendering — remove the cut once it finishes`
        );
        return;
      }
      toast.success("Cut removed");
      watchCutRoom();
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });

  const moveCutMutation = trpc.longformVideo.moveCut.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        toast.info(
          `Scene ${vars.sceneIndex} is rendering — move the cut once it finishes`
        );
        return;
      }
      watchCutRoom();
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });

  const rippleMutation = trpc.longformVideo.rippleTrimScene.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        toast.info(
          `Scene ${vars.sceneIndex} is rendering — trim it once it finishes`
        );
        return;
      }
      toast.success(
        `Removed ${d.removedSec.toFixed(2)}s of narration` +
          (d.snapped ? " (snapped onto a pause)" : "") +
          " — Reassemble to apply it"
      );
      watchCutRoom();
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });

  const mergeScenesMutation = trpc.longformVideo.mergeScenes.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        toast.info(
          `Scene ${vars.sceneIndex} is rendering — merge it once it finishes`
        );
        return;
      }
      toast.success(
        "Merging with the next scene — re-rendering as one continuous clip"
      );
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });

  const unmergeScenesMutation = trpc.longformVideo.unmergeScenes.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        toast.info(
          `Scene ${vars.sceneIndex} is rendering — unmerge it once it finishes`
        );
        return;
      }
      toast.success(
        "Unmerged — the original two scenes are back. Reassemble to apply"
      );
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });

  const revertSceneTimingMutation =
    trpc.longformVideo.revertSceneTiming.useMutation({
      onSuccess: (d, vars) => {
        if (d.accepted === "ignored") {
          toast.info(
            `Scene ${vars.sceneIndex} is rendering — revert it once it finishes`
          );
          return;
        }
        toast.success(
          `Scene ${vars.sceneIndex} back to its original cut — Reassemble to apply it`
        );
        watchCutRoom();
        if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
      },
      onError: err => toast.error(err.message),
    });

  const revertJobTimingMutation =
    trpc.longformVideo.revertJobTiming.useMutation({
      onSuccess: d => {
        toast.success(
          `${d.reverted} scene(s) back to their original cut — Reassemble to apply it`
        );
        setConfirmRevertAll(false);
        if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
      },
      onError: err => toast.error(err.message),
    });

  const setPieceClipInMutation = trpc.longformVideo.setPieceClipIn.useMutation({
    onSuccess: (d, vars) => {
      if (d.accepted === "ignored") {
        toast.info(
          `Scene ${vars.sceneIndex} is rendering — slip the piece once it finishes`
        );
        return;
      }
      toast.success("Piece slipped — Reassemble to apply it to the film");
      watchCutRoom();
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });

  const regenBatchMutation = trpc.longformVideo.regenerateScenes.useMutation({
    onSuccess: (d, vars) => {
      const ignored = vars.sceneIndices.filter(
        i => d.accepted?.[i] === "ignored"
      );
      for (const i of ignored) unqueueScene(i);
      const taken = vars.sceneIndices.length - ignored.length;
      if (ignored.length)
        toast.info(
          `Scene${ignored.length > 1 ? "s" : ""} ${ignored.join(", ")} already rendering — skipped`
        );
      if (taken > 0)
        toast.success(
          `Queued ${taken} scene${taken > 1 ? "s" : ""} — rendering together`
        );
      // queuedScenes was set optimistically in onClick (so polling starts on the
      // click itself, not a round-trip later).
      // Overrides are persisted server-side now; clear the local copies.
      setPromptEdits(p => {
        const rest = { ...p };
        for (const i of vars.sceneIndices) delete rest[i];
        return rest;
      });
      // Keep the selection checked/highlighted through regeneration.
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: (err, vars) => {
      toast.error(err.message);
      // Roll back the optimistic queue so spinners don't hang forever.
      for (const i of vars.sceneIndices) queuePhase.current.delete(i);
      setQueuedScenes(prev => prev.filter(i => !vars.sceneIndices.includes(i)));
    },
  });

  const retryAssemblyMutation = trpc.longformVideo.retryAssembly.useMutation({
    onSuccess: () => toast.success("Retrying assembly..."),
    onError: err => toast.error(err.message),
  });

  const assembleFinalMutation = trpc.longformVideo.assembleFinal.useMutation({
    onSuccess: () => {
      toast.success("Assembling final video...");
      // Refetch so status flips completed → processing: hides the Assemble button
      // and resumes polling so it can't be double-fired.
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });

  const reassembleFinalMutation =
    trpc.longformVideo.reassembleFinal.useMutation({
      onSuccess: () => {
        toast.success(
          "Re-stitching the final video from the existing clips — no scenes re-render."
        );
        if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
      },
      onError: err => toast.error(err.message),
    });

  const retryFailedScenesMutation =
    trpc.longformVideo.retryFailedScenes.useMutation({
      onSuccess: () => {
        toast.success("Retrying failed scenes...");
        // Refetch so status flips failed → processing: hides the button and
        // resumes polling, so it can't be spammed.
        if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
      },
      onError: err => toast.error(err.message),
    });

  const retrofitSplitsMutation =
    trpc.longformVideo.retrofitSplitScreens.useMutation({
      onSuccess: () => {
        toast.success(
          "Adding split screens — the host clips are reused, only the right panels render."
        );
        // Refetch so status flips completed → processing and polling resumes.
        if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
      },
      onError: err => toast.error(err.message),
    });

  const retrofitBookCoverMutation =
    trpc.longformVideo.retrofitBookCover.useMutation({
      onSuccess: () => {
        toast.success(
          "Adding the book cover reveal — free, no clips regenerate except the cover beat itself."
        );
        if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
      },
      onError: err => toast.error(err.message),
    });

  const cancelMutation = trpc.longformVideo.cancelJob.useMutation({
    onSuccess: () => {
      setDownloadTitle("");
      onTitleChange?.("");
      setJobId(null);
      onJobIdChange?.(null);
      toast.success("Job cancelled");
    },
    onError: err => toast.error(err.message),
  });

  const confirmClearOutput = () => {
    setShowClearConfirm(false);
    if (jobId !== null) {
      setDismissedJobId(jobId);
    }
    setJobId(null);
    onJobIdChange?.(null);
    setDownloadTitle("");
    onTitleChange?.("");
    toast.success(
      `Tab ${slotIndex + 1} is free — the video is in your library`
    );
  };

  const { data: rawJob, dataUpdatedAt } = trpc.longformVideo.pollJob.useQuery(
    { jobId: jobId ?? 0 },
    {
      enabled: jobId !== null && jobId !== dismissedJobId,
      refetchIntervalInBackground: true, // keep polling while the tab is hidden
      // Poll while running or while scenes are queued for regeneration; stop
      // once finished (refresh restores it via the persisted id, but a done
      // job with nothing queued shouldn't be re-fetched every 3s).
      refetchInterval: q =>
        q.state.data?.status === "processing" ||
        q.state.data?.sceneEdits?.editing ||
        queuedScenes.length > 0
          ? 3000
          : Date.now() < cutRoomWatchUntil
            ? 1000
            : false,
    }
  );

  const job = jobId !== null && jobId !== dismissedJobId ? rawJob : null;

  const isProcessing = job?.status === "processing";
  // The job's live scene-edit queue, from the server (which scenes wait / render right now).
  // Both "the pipeline is rendering" and "the operator is editing scenes" read status
  // "processing" on the job row; this is what tells them apart. The local optimistic queue is
  // folded in so the click itself counts, before the first poll comes back.
  const sceneEdits = job?.sceneEdits ?? {
    queued: [] as number[],
    active: [] as number[],
    editing: false,
  };
  // Server-owned: true only while an edit session HOLDS the job lock. A request parked
  // behind a pipeline/assembly pass is not editing yet — that pass is what's running, and
  // the UI must show it as such. The local optimistic queue drives badges and polling only.
  const isEditing = sceneEdits.editing;
  // Only an initial/pipeline render takes the editors away — scene edits keep them live.
  const isPipelineRunning = isProcessing && !isEditing;

  // Pre-fill the channel from the job after a refresh (local state resets to ""
  // on reload, but the restored job carries the channel it was generated with).
  useEffect(() => {
    if (!channelKey && job?.channelKey) setChannelKey(job.channelKey);
  }, [channelKey, job?.channelKey]);

  /**
   * Show the script the tab's job was generated from.
   *
   * `script` initialises from `defaultScript` and nothing ever replaced it, so a tab holding a
   * finished render showed the built-in lawn-care sample (slot 0) or an empty box (the rest) —
   * the storyboard of one script sitting under the text of another. Opening a past render from
   * the library was the worst case: the whole point is to read what it was made from.
   *
   * Keyed by job id rather than a boolean: adopting a DIFFERENT job has to re-hydrate, but the
   * ~2s poll returning the same job must not, or it would overwrite the operator mid-sentence
   * every time they started editing toward a re-generate.
   */
  const hydratedScriptFor = useRef<number | null>(null);
  useEffect(() => {
    if (jobId === null || job?.script == null) return;
    if (hydratedScriptFor.current === jobId) return;
    hydratedScriptFor.current = jobId;
    setScript(job.script);
    // Fold it away on arrival. A generated script runs to thousands of characters — job 12's
    // is 7,006 — and left open it pushes the channel, the CTA blocks and the generate button
    // off the bottom of the screen. Once a tab holds a render the script is reference
    // material, not the thing being worked on, so it opens on request.
    setScriptCollapsed(true);
  }, [jobId, job?.script]);

  // Same as the script: restore the books this job pitched, so reopening a render shows them in
  // the uploader instead of a blank list. The snapshot has one entry per CTA block, so a book
  // used in two pitches comes back twice — de-dupe by title into the uploader's one-row-per-book
  // shape. Keyed by jobId so the ~2s poll doesn't overwrite an edit in progress.
  const hydratedBooksFor = useRef<number | null>(null);
  useEffect(() => {
    if (jobId === null || job?.ctaBooks == null) return;
    if (hydratedBooksFor.current === jobId) return;
    hydratedBooksFor.current = jobId;
    const seen = new Set<string>();
    const books: CtaBookAssignment[] = [];
    for (const b of job.ctaBooks) {
      const key = b.title.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      books.push({
        title: b.title,
        coverImageUrl: b.coverImageUrl ?? undefined,
        shopUrl: b.shopUrl ?? undefined,
      });
    }
    setCtaBooks(books);
  }, [jobId, job?.ctaBooks]);

  // A cleared tab is a fresh start: hydrate again for the next job, and open the box back up
  // because an empty collapsed script step is a dead end — there would be nothing to click
  // toward and no way to see that a script is what's missing.
  useEffect(() => {
    if (jobId === null) {
      hydratedScriptFor.current = null;
      hydratedBooksFor.current = null;
      setScriptCollapsed(false);
    }
  }, [jobId]);

  const scenes = useMemo(
    () => (job?.storyboard as StoryboardScene[] | null) ?? [],
    [job?.storyboard]
  );
  // Derived from server data so the "Regenerated" badge survives a refresh.
  const regeneratedScenes = useMemo(
    () => scenes.filter(s => s.regenerated).map(s => s.index),
    [scenes]
  );

  // A finished film rendered with a stale pacing snapshot can be (nearly) split-free.
  // Offer the retrofit when the split share of host runtime sits clearly under the
  // pipeline's legacy floor (~21% of host time) — the server reuses every lip-synced
  // host clip and renders only the right panels.
  const needsSplitRetrofit = useMemo(() => {
    const host = scenes.filter(
      s => s.hostPresent && (s.clipUrls?.length || s.clipUrl)
    );
    const dur = (s: StoryboardScene) => s.audioDuration ?? 0;
    const hostSec = host.reduce((sum, s) => sum + dur(s), 0);
    if (hostSec <= 0) return false;
    const splitSec = host.reduce(
      (sum, s) => sum + (s.splitVisual ? dur(s) : 0),
      0
    );
    return splitSec / hostSec < 0.15;
  }, [scenes]);

  // Deliver a timestamp click that had to wait for the rendered player to come back. Child
  // effects run before the parent's, so by the time this fires the player has already published
  // its seek handle.
  useEffect(() => {
    if (showCutPreview || pendingSeekRef.current == null) return;
    const sec = pendingSeekRef.current;
    pendingSeekRef.current = null;
    playerSeekRef.current?.(sec);
  }, [showCutPreview]);

  /** Jump the rendered film to `sec`, switching away from the live preview if it is on screen. */
  const seekRenderedFilm = (sec: number) => {
    if (showCutPreview) {
      pendingSeekRef.current = sec;
      setShowCutPreview(false);
      return;
    }
    playerSeekRef.current?.(sec);
  };

  /**
   * Where each scene lands in the finished film, as `m:ss`.
   *
   * Laid out with `planMasterOverlayScenes` — the renderer's own function — rather than by
   * summing narration lengths, because a scene freezes past its words wherever there's a hold
   * (the sub-floor pad, a CTA release tail, an operator's hold) and every later scene sits that
   * much further in. Keyed by `scene.index`; a scene with no narration range yet (pre-voicing)
   * simply isn't in the map and shows its number alone.
   */
  const sceneTimecodes = useMemo(() => {
    const usable = scenes
      .filter(
        s =>
          Number.isFinite(s.narrationStartSec as number) &&
          Number.isFinite(s.narrationEndSec as number) &&
          (s.narrationEndSec as number) > (s.narrationStartSec as number)
      )
      .sort((a, b) => a.index - b.index);
    const out = new Map<number, string>();
    if (!usable.length) return out;
    // Mirrors assembleAndFinalize: a cover-reveal beat ends with its narration, everything else
    // is floored to its stored duration, and an operator's hold overrides the CTA default.
    const plan = planMasterOverlayScenes({
      scenes: usable.map(s => ({
        sliceStartSec: s.narrationStartSec as number,
        sliceEndSec: s.narrationEndSec as number,
        ...sceneHoldPlan(s),
      })),
    });
    let at = 0;
    usable.forEach((s, i) => {
      const t = Math.max(0, Math.floor(at));
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const sec = String(t % 60).padStart(2, "0");
      out.set(
        s.index,
        h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
      );
      at += plan.scenes[i].frames / FPS;
    });
    return out;
  }, [scenes]);

  /**
   * Scenes carrying a pristine cut to go back to. Empty for a job whose timing has never been
   * edited — and also for one edited BEFORE snapshots existed, whose original is genuinely
   * unrecoverable; the control stays hidden rather than appearing and failing.
   */
  const revertableScenes = useMemo(
    () => scenes.filter(s => s.timingOriginal).map(s => s.index),
    [scenes]
  );

  // Whether the browser can play this cut without an assembly: the master narration exists and
  // at least one scene has both a clip and its slice of that narration. Deliberately not gated
  // on `finalVideoUrl` — the whole point is to see a cut BEFORE (or instead of) rendering one.
  const cutPreviewReady = useMemo(
    () =>
      !!job?.masterAudioUrl &&
      scenes.some(
        s =>
          (s.clipUrls?.length || s.clipUrl) &&
          Number.isFinite(s.narrationStartSec as number) &&
          Number.isFinite(s.narrationEndSec as number)
      ),
    [job?.masterAudioUrl, scenes]
  );

  // Report status up to the parent so the tab label can show a badge.
  useEffect(() => {
    const status: SlotStatus =
      jobId === null ? "idle" : ((job?.status as SlotStatus) ?? "processing");
    onStatusChange?.(slotIndex, status);
  }, [jobId, job?.status, slotIndex, onStatusChange]);

  // Chime + OS notification when a new final cut lands (initial render OR a
  // re-assembly after regen / retry), or when the job fails. Watching the
  // finalVideoUrl change catches re-assembly even when the poll misses the brief
  // processing blip. Guarding on a defined previous value skips the false alert
  // when a reload restores an already-finished job (undefined → url).
  const prevStatus = useRef<string | undefined>(undefined);
  const prevFinalUrl = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const s = job?.status;
    const url = job?.finalVideoUrl ?? null;
    if (
      prevFinalUrl.current !== undefined &&
      url &&
      url !== prevFinalUrl.current
    ) {
      notifyJobDone(`Video ${slotIndex + 1}`, true);
    } else if (prevStatus.current === "processing" && s === "failed") {
      notifyJobDone(`Video ${slotIndex + 1}`, false);
    }
    prevStatus.current = s;
    prevFinalUrl.current = url;
  }, [job?.status, job?.finalVideoUrl, slotIndex]);

  useEffect(() => {
    setSelectedGroup(0);
    setQueuedScenes([]);
    queuePhase.current.clear();
    queuedAt.current.clear();
    setSelectedScenes(loadSelectedScenes(storageKey, jobId));
  }, [jobId, storageKey]);

  // Persist the marked-for-regenerate selection so it survives refresh/close.
  useEffect(() => {
    saveSelectedScenes(storageKey, jobId, selectedScenes);
  }, [selectedScenes, jobId, storageKey]);

  // Persist the draft title to the account (not the browser) so it follows you to another
  // machine. Debounced: this fires per keystroke, and a write per character would be a
  // mutation storm for a field nobody types fast into.
  useEffect(() => {
    if (downloadTitle === initialTitle) return;
    const t = setTimeout(() => onTitleChange?.(downloadTitle), 600);
    return () => clearTimeout(t);
  }, [downloadTitle, initialTitle, onTitleChange]);

  // Clear scenes from the queued list once the poll confirms they finished — but
  // only after a poll has SEEN them processing (two-phase, see queuePhase): right
  // after the click the DB still holds the pre-regen snapshot where the scene is
  // "completed", and settling on that would kill the spinner AND stop polling
  // while the server is still regenerating. The "Regenerated" badge is derived
  // from the persisted `scene.regenerated`.
  useEffect(() => {
    if (!job?.storyboard || queuedScenes.length === 0) return;
    const sb = job.storyboard as StoryboardScene[];
    const status = (i: number) => sb.find(sc => sc.index === i)?.sceneStatus;
    const server = job.sceneEdits;
    const inServerQueue = (i: number) =>
      !!server && (server.queued.includes(i) || server.active.includes(i));
    const settled: number[] = [];
    for (const i of queuedScenes) {
      const s = status(i);
      const phase = queuePhase.current.get(i) ?? "queued";
      if (
        phase === "queued" &&
        (inServerQueue(i) || s === "processing" || s === "rendering")
      ) {
        queuePhase.current.set(i, "confirmed");
      } else if (
        phase === "confirmed" &&
        !inServerQueue(i) &&
        (s === "completed" || s === "failed")
      ) {
        settled.push(i);
      } else if (
        phase === "queued" &&
        !inServerQueue(i) &&
        job.status !== "processing" &&
        Date.now() - (queuedAt.current.get(i) ?? 0) > 12_000
      ) {
        // Never seen in flight: the edit finished between two polls (ffmpeg-only edits take
        // seconds) and the job has settled. Without this the spinner would never stop.
        settled.push(i);
      }
    }
    if (settled.length === 0) return;
    for (const i of settled) {
      queuePhase.current.delete(i);
      queuedAt.current.delete(i);
    }
    setQueuedScenes(prev => prev.filter(i => !settled.includes(i)));
    // `dataUpdatedAt` advances on every successful poll even when the payload is structurally
    // identical (react-query keeps the same object reference then), so the 12 s fallback above
    // is re-evaluated each poll rather than only when the job changes.
  }, [job, queuedScenes, dataUpdatedAt]);

  const minuteGroups = useMemo(() => {
    if (scenes.length === 0) return [];
    const map = new Map<number, StoryboardScene[]>();
    let cum = 0;
    for (const scene of scenes) {
      const min = Math.floor(cum / 60);
      if (!map.has(min)) map.set(min, []);
      map.get(min)!.push(scene);
      cum += scene.audioDuration ?? 5;
    }
    return Array.from(map.entries()).map(([min, list]) => ({
      label: `${min}:00–${min + 1}:00`,
      scenes: list,
    }));
  }, [scenes]);

  // Scenes marked-to-regenerate (selected), in-flight, or already regenerated —
  // the contents of the last "Regenerate" tab. selectedGroup === -1 selects it.
  const regenTabIndices = useMemo(
    () => new Set([...selectedScenes, ...queuedScenes, ...regeneratedScenes]),
    [selectedScenes, queuedScenes, regeneratedScenes]
  );
  const regenScenes = useMemo(
    () => scenes.filter(s => regenTabIndices.has(s.index)),
    [scenes, regenTabIndices]
  );

  const visibleScenes =
    selectedGroup === -1
      ? regenScenes
      : (minuteGroups[selectedGroup]?.scenes ?? []);

  // Free-text filter on the scene's spoken script (its display name).
  const displayScenes = useMemo(() => {
    const q = sceneSearch.trim().toLowerCase();
    if (!q) return visibleScenes;
    return visibleScenes.filter(s =>
      (s.scriptText ?? s.narration ?? "").toLowerCase().includes(q)
    );
  }, [visibleScenes, sceneSearch]);

  // Which scene the filmstrip has open in the detail panel below it. Falls back to the first
  // scene in view whenever nothing's been clicked yet, or a filter/minute-chip change drops the
  // previously active scene out of view.
  const activeSceneIndex =
    activeSceneIndexState !== null &&
    displayScenes.some(s => s.index === activeSceneIndexState)
      ? activeSceneIndexState
      : (displayScenes[0]?.index ?? null);

  // Bounce off the regen tab once it empties so we never strand an empty view.
  useEffect(() => {
    if (selectedGroup === -1 && regenScenes.length === 0) setSelectedGroup(0);
  }, [selectedGroup, regenScenes.length]);

  // Batch regen is "in flight" while the request is pending or any selected scene
  // is still queued — drives both the spinner and the disabled (anti-spam) state.
  const batchRegenLoading =
    regenBatchMutation.isPending ||
    selectedScenes.some(i => queuedScenes.includes(i));

  // A scene counts as operator-edited when its local prompt override differs from
  // the stored one — edited prompts render VERBATIM (server skips the LLM
  // re-enhance); untouched prompts stay seeds and re-enhance as before.
  const isEdited = (i: number) => {
    const edit = promptEdits[i];
    if (edit === undefined) return false;
    const scene = scenes.find(s => s.index === i);
    return edit.trim() !== (scene ? ownedPrompt(scene) : "").trim();
  };

  // Single-click per-scene regenerate — shared by the collapsed one-click button
  // and the expanded editor's button. Queues optimistically so the spinner and
  // polling start on the click itself (the mutation is fire-and-forget).
  const regenerateSingle = (scene: StoryboardScene) => {
    if (!jobId) return;
    const prompt = (promptEdits[scene.index] ?? ownedPrompt(scene)).trim();
    if (!prompt) return;
    armNotifications();
    queuePhase.current.set(scene.index, "queued");
    queuedAt.current.set(scene.index, Date.now());
    setQueuedScenes(prev =>
      prev.includes(scene.index) ? prev : [...prev, scene.index]
    );
    regenMutation.mutate({
      jobId,
      sceneIndex: scene.index,
      ...(isSplitScene(scene)
        ? { customSplitVisual: prompt }
        : { customVisualPrompt: prompt }),
      verbatim: isEdited(scene.index) || undefined,
    });
  };

  const progress = job?.progress as
    | { scenesTotal: number; scenesDone: number; warnings?: string[] }
    | undefined;

  // Scenes with no clip — the holes a "Retry failed scenes" pass would fill.
  const missingClipCount = useMemo(
    () => scenes.filter(s => !(s.clipUrls?.length || s.clipUrl)).length,
    [scenes]
  );
  const canRetryFailed = job?.status === "failed" && missingClipCount > 0;

  const retryFailedScenesButton = canRetryFailed ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        if (!jobId) return;
        armNotifications(); // a retry can run for an hour — notify even in a background tab
        retryFailedScenesMutation.mutate({ jobId });
      }}
      disabled={retryFailedScenesMutation.isPending}
    >
      <RefreshCw className="mr-2 h-4 w-4" />
      Retry failed scenes ({missingClipCount})
    </Button>
  ) : null;

  // The displayed job id is kept in localStorage so a finished job stays on
  // screen across refreshes — it's only replaced when a new job is generated,
  // or cleared on delete/cancel. (Don't clear it on completion.)

  const canGenerate =
    script.trim().length > 0 &&
    !!channelKey &&
    !!channelDefaults?.voiceId &&
    !generateMutation.isPending &&
    !isProcessing;

  const wordCount = useMemo(
    () => script.trim().split(/\s+/).filter(Boolean).length,
    [script]
  );

  // CTA preview for the generate confirmation: the same marker scan and book→block title
  // match the server runs at submit, so the dialog can say — before the click — whether the
  // render would be rejected (unmarked script on a channel with a cover/QR or with books
  // assigned) and which block each named book lands on.
  const ctaScan = useMemo(() => scanCtaBlocks(script), [script]);
  const ctaBookTitles = useMemo(
    () => ctaBooks.map(b => b.title.trim()).filter(Boolean),
    [ctaBooks]
  );
  // The channel's saved books auto-place when a block calls them (marker name or spoken
  // title) — same rule the server runs, so the preview needs the same candidate list:
  // this video's own rows first (they win ties), channel books behind as call-only.
  const { data: dialogChannelBooks } = trpc.book.list.useQuery(
    { channelKey, activeOnly: true },
    { enabled: !!channelKey }
  );

  // A finished film can have a book configured but no cover-reveal beat anywhere in the
  // storyboard — the storyboard-time marking pass couldn't place one (or the channel's book was
  // never called by name in the script, so it was never attached at all). Offer the retrofit
  // when there's a cover to place from ANY source it now falls back to (per-video book, channel
  // fallback cover, or the channel's live Books library — `dialogChannelBooks`, same query the
  // CTA dialog above uses) and the film has CTA beats at all.
  //
  // Computed as a REASON, not just a boolean — this button went through a round of "why isn't
  // it showing" guesswork with no way for the operator to see which condition failed. Same fix
  // as `blockedReason` on the Generate button: a hidden control with no explanation is
  // indistinguishable from a broken one.
  const bookCoverGateReason = useMemo(():
    "eligible" | "no-book" | "no-cta" | "already-has-cover" => {
    const hasBook =
      !!job?.bookCoverImageUrl ||
      !!job?.ctaBooks?.length ||
      !!dialogChannelBooks?.some(b => b.coverImageUrl);
    if (!hasBook) return "no-book";
    if (!scenes.some(s => s.cta)) return "no-cta";
    if (scenes.some(s => s.coverHero)) return "already-has-cover";
    return "eligible";
  }, [scenes, job?.bookCoverImageUrl, job?.ctaBooks, dialogChannelBooks]);
  const needsBookCoverRetrofit = bookCoverGateReason === "eligible";
  // Only worth explaining when there's an actual CTA pitch to ask about — a video with no CTA
  // at all is the normal, silent case and needs no note.
  const bookCoverStatusNote =
    !needsBookCoverRetrofit && scenes.some(s => s.cta)
      ? bookCoverGateReason === "no-book"
        ? "No book/cover found for this CTA — checked this video's own snapshot, the channel's fallback cover, and the channel's Books library."
        : bookCoverGateReason === "already-has-cover"
          ? "This CTA already has a cover reveal."
          : null
      : null;

  const ctaCandidates = useMemo(
    () => [
      ...ctaBookTitles.map(title => ({ title })),
      ...(dialogChannelBooks ?? [])
        .filter(r => !ctaBookTitles.some(t => ctaLabelMatches(t, r.title)))
        .map(r => ({ title: r.title, requiresCall: true })),
    ],
    [ctaBookTitles, dialogChannelBooks]
  );
  const ctaAssignments = useMemo(
    () => previewBookAssignments(ctaScan.blocks, ctaCandidates),
    [ctaScan.blocks, ctaCandidates]
  );
  // The exact condition the router 400s on — surfacing it here turns a failed submit into a
  // disabled button with the fix written next to it.
  const ctaWouldReject =
    ctaScan.errors.length > 0 ||
    ((channelDefaults?.hasCtaCoverOrQr || ctaBookTitles.length > 0) &&
      ctaScan.blocks.length === 0);
  // An inserted-but-unedited template would be VOICED verbatim — hold Generate until replaced.
  const ctaPlaceholderLeft = ctaScan.blocks.some(b =>
    b.text.includes(CTA_TEMPLATE_PLACEHOLDER)
  );
  const insertCtaTemplate = () => {
    setScript(s => `${s.trimEnd()}\n\n${CTA_MARKER_TEMPLATE}\n`);
  };
  // ~150 wpm is a narration pace, not a reading one. Deliberately labelled
  // "roughly" — the real runtime is measured from the rendered voiceover.
  const estimatedMinutes = useMemo(() => {
    const total = Math.round((wordCount / 150) * 60);
    const m = Math.floor(total / 60);
    return m > 0 ? `${m}m ${total % 60}s` : `${total}s`;
  }, [wordCount]);

  /**
   * Why the generate button is disabled, in the operator's terms. The button used
   * to just sit greyed out — three separate conditions can disable it and none of
   * them announced itself, so the fix was guesswork.
   */
  const blockedReason = isProcessing
    ? isEditing
      ? "Scene edits are rendering on this tab. It'll free up when they finish."
      : "This tab is rendering. It'll free up when the job finishes."
    : generateMutation.isPending
      ? null
      : !script.trim()
        ? "Paste a script to get started."
        : !channelKey
          ? "Pick a channel — it supplies the voice and host."
          : !channelDefaults?.voiceId
            ? "That channel has no voice configured. Set one under Channels."
            : null;

  const confirmGenerate = () => {
    setShowConfirm(false);
    armNotifications(); // unlock audio + request notification permission on the click
    // Drop half-filled rows: a book with no title can't be matched to a CTA line, and an empty
    // title would fail the server's `title.min(1)` and reject the whole render.
    const books = ctaBooks
      .filter(b => b.title.trim())
      .map(b => ({
        title: b.title.trim(),
        coverImageUrl: b.coverImageUrl,
        shopUrl: b.shopUrl?.trim() || undefined,
        saveToChannel: b.saveToChannel || undefined,
      }));
    generateMutation.mutate({
      script: script.trim(),
      channelKey,
      title: downloadTitle.trim() || undefined,
      slotIndex,
      // Assets are no longer sent from here — the server reads them from the channel.
      ctaBooks: books.length ? books : undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Deliberately NOT `overflow-hidden`, which would otherwise be the obvious
          way to keep the full-bleed sections inside the rounded corners: it makes
          the card a scroll container, and a `sticky` child then resolves against
          that container instead of the viewport — the generate button below would
          silently stop sticking. The footer rounds its own bottom corners instead. */}
      <Card className="gap-0 py-0">
        <Step
          n={1}
          title="Script"
          hint="Spoken words only, voiced verbatim. Directing notes here would be read aloud — the host look, b-roll style and 16:9 framing come from the saved Longform instruction, and the host photo and face model from the channel."
          collapsed={scriptCollapsed}
          onToggle={() => setScriptCollapsed(c => !c)}
          summary={
            // Enough to recognise WHICH script is folded up in this tab without opening it —
            // five tabs of "112 words" would say nothing about which is which.
            <div className="space-y-1">
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {script.trim() || "No script yet."}
              </p>
              {wordCount > 0 && (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {wordCount.toLocaleString()} words · roughly{" "}
                  {estimatedMinutes} of narration
                </p>
              )}
            </div>
          }
        >
          <Textarea
            id={`lf-script-${slotIndex}`}
            value={script}
            onChange={e => setScript(e.target.value)}
            placeholder="Paste the spoken script…"
            className="min-h-[200px] resize-y text-sm leading-relaxed"
          />
          {/* Live, because script length is what decides runtime and spend, and
              that used to be invisible until the voiceover stage reported back. */}
          <p className="text-xs tabular-nums text-muted-foreground">
            {wordCount.toLocaleString()} word{wordCount === 1 ? "" : "s"}
            {wordCount > 0 && ` · roughly ${estimatedMinutes} of narration`}
          </p>
          {/* B-roll VIDEO renders on this tab's APIMART key (stills always use OpenAI gpt-image-2).
              Key status is admin-only (getApimartKeys is adminProcedure), so the warning is too. */}
          {apimartKeyMissing && (
            <Alert tone="warning" className="text-xs">
              No APIMART key for this tab — set it in Admin → Longform. B-roll
              video will use 69 Labs.
            </Alert>
          )}
        </Step>

        <Step
          n={2}
          title="Channel"
          hint="The voiceover uses this channel's saved voice."
        >
          <Select value={channelKey} onValueChange={setChannelKey}>
            <SelectTrigger className="w-full sm:max-w-sm">
              <SelectValue placeholder="Select a channel…" />
            </SelectTrigger>
            <SelectContent>
              {channels.map(ch => (
                <SelectItem key={ch.key} value={ch.key}>
                  {ch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {channelKey && channelDefaults && (
            <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3 text-xs">
              {channelDefaults.voiceId ? (
                <p>
                  <span className="font-medium">Voice: </span>
                  <span className="text-muted-foreground">
                    {channelDefaults.voiceName ?? channelDefaults.voiceId}
                  </span>
                </p>
              ) : (
                <p className="font-medium text-destructive">
                  No voice configured for this channel — set one under Channels.
                </p>
              )}
              <ChannelVoiceTuning
                key={channelKey}
                channelKey={channelKey}
                ttsSpeed={channelDefaults.ttsSpeed}
                ttsVolume={channelDefaults.ttsVolume}
              />
            </div>
          )}
        </Step>

        <Step n={3} title="Call to action" optional>
          {/* Which book each CTA block pitches — one video can sell more than one. */}
          <LongformCtaBooks
            script={script}
            channelKey={channelKey}
            value={ctaBooks}
            onChange={setCtaBooks}
            disabled={generateMutation.isPending || isProcessing}
          />

          {/* Assets are no longer uploaded per video — they live on the channel and every
              video uses all of them. This is a read-only pointer to where they are set. */}
          {channelKey && <ChannelAssetsNote channelKey={channelKey} />}
        </Step>

        <Step
          n={4}
          title="Video title"
          optional
          hint="Names the tab, the library entry and the downloaded MP4."
        >
          <Input
            value={downloadTitle}
            onChange={e => setDownloadTitle(e.target.value)}
            placeholder="Untitled video"
            className="w-full sm:max-w-sm"
          />
        </Step>

        {/* Sticky rather than in flow: the form above runs well past a screen, so
            the button that acts on it used to be off-screen from the moment you
            started typing — you wrote the script, then scrolled back down to find
            the control you had just scrolled past. */}
        <div className="sticky bottom-0 z-10 rounded-b-xl border-t border-border bg-card/95 px-5 py-4 backdrop-blur-sm sm:px-6">
          <Button
            onClick={() => setShowConfirm(true)}
            disabled={!canGenerate}
            className="h-11 w-full text-base font-medium"
            size="lg"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Submitting…
              </>
            ) : isProcessing ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <ScanFace className="mr-2 h-5 w-5" />
                Generate video {slotIndex + 1}
              </>
            )}
          </Button>
          {/* A disabled button with no reason is the same as a broken one. */}
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {blockedReason ??
              "Voiced word-for-word into a 16:9 film. Length — and cost — follow your script."}
          </p>
        </div>
      </Card>

      {/* Progress / result */}
      {job && (
        <Card className="bg-card border-primary/20">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                ) : job.status === "completed" ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0 text-destructive" />
                )}
                {job.status === "completed" || isEditing ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Select value={channelKey} onValueChange={setChannelKey}>
                      <SelectTrigger className="h-9 w-40 border-border">
                        <SelectValue placeholder="Channel" />
                      </SelectTrigger>
                      <SelectContent>
                        {channels.map(ch => (
                          <SelectItem key={ch.key} value={ch.key}>
                            {ch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        job.title ? "font-medium" : "text-muted-foreground"
                      }`}
                    >
                      {job.title || "Video title (optional)"}
                    </span>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium">
                      {STAGE_LABELS[job.stage] || job.stage}
                    </p>
                    {progress &&
                      (job.stage === "voiceover" || job.stage === "clips") && (
                        <p className="text-xs text-muted-foreground">
                          {progress.scenesDone}/{progress.scenesTotal} scenes
                        </p>
                      )}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* Available during the render too, not just after — the total updates as the
                  job spends, which is when it is most worth watching. */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCost(true)}
                  className="text-muted-foreground hover:text-primary"
                  title="What this video cost to generate"
                >
                  <Receipt className="mr-2 h-4 w-4" />
                  Cost
                </Button>
                {isPipelineRunning ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => jobId && cancelMutation.mutate({ jobId })}
                    disabled={cancelMutation.isPending}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                ) : (
                  // "Clear Output" under a bin icon read as "throw this render away", so the
                  // one control that frees a tab was the last one anybody would risk clicking.
                  // It has never deleted anything: it nulls this slot's job id, and the render
                  // stays in the library. The label says that now, and the icon is an X —
                  // detach — rather than a bin.
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowClearConfirm(true)}
                    className="text-muted-foreground hover:text-foreground"
                    title="Free this tab — the video stays in your library"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Remove from tab
                  </Button>
                )}
              </div>
            </div>

            {isEditing && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Editing scenes — {sceneEdits.active.length} rendering ·{" "}
                {sceneEdits.queued.length +
                  queuedScenes.filter(
                    i =>
                      !sceneEdits.active.includes(i) &&
                      !sceneEdits.queued.includes(i)
                  ).length}{" "}
                queued. Other scenes stay editable.
              </p>
            )}
            {progress &&
              !isEditing &&
              (job.stage === "voiceover" || job.stage === "clips") && (
                <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${
                        progress.scenesTotal > 0
                          ? Math.round(
                              (progress.scenesDone / progress.scenesTotal) * 100
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
              )}

            {job.status === "failed" && (
              <p className="text-xs text-destructive">
                {sanitizeError(job.errorMessage || "Generation failed")}
              </p>
            )}

            {progress?.warnings && progress.warnings.length > 0 && (
              <ul className="space-y-0.5">
                {progress.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-warning">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            )}

            {retryFailedScenesButton}

            {/* Available whenever the job isn't actively rendering and has SOME clips to work
                with — not tied to "completed", so it also covers a failed/cancelled-mid-assembly
                job like this one. The server's own retrofit guard (job.status !== "processing")
                is the real safety net; this just decides when to show the control at all. */}
            {job.status !== "processing" &&
              scenes.some(s => s.clipUrls?.length || s.clipUrl) && (
                <>
                  {bookCoverStatusNote && (
                    <p className="text-xs text-muted-foreground">
                      {bookCoverStatusNote}
                    </p>
                  )}
                  {needsBookCoverRetrofit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!jobId) return;
                        armNotifications();
                        retrofitBookCoverMutation.mutate({ jobId });
                      }}
                      disabled={retrofitBookCoverMutation.isPending}
                      title="This film has a book but no cover reveal. Add it — free, only the cover beat renders."
                    >
                      {retrofitBookCoverMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <BookOpen className="mr-2 h-4 w-4" />
                      )}
                      Add book cover
                    </Button>
                  )}
                </>
              )}

            {job.stage === "assembly" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!jobId) return;
                  armNotifications();
                  retryAssemblyMutation.mutate({ jobId });
                }}
                disabled={retryAssemblyMutation.isPending}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry Assembly
              </Button>
            )}

            {job.status === "completed" &&
              !job.finalVideoUrl &&
              scenes.some(s => s.clipUrls?.length || s.clipUrl) && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Scenes re-rendered. Preview them below, then rebuild the
                    final cut.
                  </p>
                  {/* No final exists yet, so the preview IS the only way to see the cut — show
                      it inline rather than behind a toggle. */}
                  {cutPreviewReady && (
                    <LongformCutPreview
                      scenes={scenes}
                      masterAudioUrl={job.masterAudioUrl as string}
                    />
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!jobId) return;
                      armNotifications();
                      assembleFinalMutation.mutate({ jobId });
                    }}
                    disabled={assembleFinalMutation.isPending}
                  >
                    {assembleFinalMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Assemble final video
                  </Button>
                </div>
              )}

            {job.status === "completed" &&
              job.finalVideoUrl &&
              scenes.some(sc => sc.timingEdited) && (
                <p className="flex items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  <Scissors className="h-3.5 w-3.5 shrink-0" />
                  Timing edits pending on{" "}
                  {scenes.filter(sc => sc.timingEdited).length} scene(s) — the
                  rendered film is the previous cut. Switch to{" "}
                  <b>Live preview</b> to see them now, or <b>Reassemble</b> to
                  bake them in (ffmpeg only, no credits).
                </p>
              )}
            {job.status === "completed" && revertableScenes.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {revertableScenes.length} scene(s) have timing edits.
                </span>
                {confirmRevertAll ? (
                  <>
                    <span className="text-foreground">
                      Put every one back to its original cut? This cannot be
                      undone.
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs"
                      disabled={revertJobTimingMutation.isPending}
                      onClick={() => {
                        if (!jobId) return;
                        revertJobTimingMutation.mutate({ jobId });
                      }}
                    >
                      {revertJobTimingMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <History className="mr-1.5 h-3 w-3" />
                      )}
                      Revert all
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setConfirmRevertAll(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setConfirmRevertAll(true)}
                    title="Put every scene back to the cut it had before its first timing edit. Metadata only — Reassemble afterwards to apply it to the film."
                  >
                    <History className="mr-1.5 h-3 w-3" />
                    Revert all timing
                  </Button>
                )}
              </div>
            )}
            {job.status === "completed" && job.finalVideoUrl && (
              <div className="space-y-3">
                {/* One player slot, two sources. The switcher sits directly above the picture so
                    the two cuts occupy the same place on screen and can be compared by clicking
                    between them — a second player below the film would read as a second film. */}
                {cutPreviewReady && (
                  <CutPreviewSwitch
                    live={showCutPreview}
                    onChange={setShowCutPreview}
                  />
                )}
                {cutPreviewReady && showCutPreview ? (
                  <LongformCutPreview
                    scenes={scenes}
                    masterAudioUrl={job.masterAudioUrl as string}
                  />
                ) : (
                  <LongformVideoPlayer
                    src={job.finalVideoUrl}
                    seekRef={playerSeekRef}
                  />
                )}
                <div className="flex justify-end gap-2">
                  {needsSplitRetrofit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!jobId) return;
                        armNotifications();
                        retrofitSplitsMutation.mutate({ jobId });
                      }}
                      disabled={retrofitSplitsMutation.isPending}
                      title="This film rendered without split screens. Add them — the host clips are reused, only the right panels render."
                    >
                      {retrofitSplitsMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Columns2 className="mr-2 h-4 w-4" />
                      )}
                      Add split screens
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!jobId) return;
                      armNotifications();
                      reassembleFinalMutation.mutate({ jobId });
                    }}
                    disabled={reassembleFinalMutation.isPending}
                    title="Re-stitch the final video from the clips already rendered — no scenes regenerate, free."
                  >
                    {reassembleFinalMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Reassemble
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      job.finalVideoUrl &&
                      downloadFile(
                        job.finalVideoUrl,
                        "video",
                        job.title || undefined
                      )
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download MP4
                  </Button>
                </div>
                {/* Links, QR, description, timestamp map — everything needed to publish. */}
                {jobId != null && (
                  <div className="border-t border-border pt-4">
                    <LongformPublishKit
                      jobId={jobId}
                      onSeek={seekRenderedFilm}
                    />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Storyboard review — stays visible after assembly so scenes can still be
          regenerated; a regen is render-only, clears finalVideoUrl, and surfaces the
          manual "Assemble final video" button above */}
      {scenes.length > 0 && (
        // Anchor for "Open" from the library: the generator form above is tall, so landing
        // at the top of the page looked like nothing had happened. The page scrolls here.
        <div className="space-y-3" id={`storyboard-${slotIndex}`}>
          {/* `top-0` would park this underneath the app header, which is now
              sticky too — offset by its height so the two stack instead. */}
          <div className="sticky top-[var(--app-header-h)] z-20 -mx-4 space-y-3 border-b border-border bg-background px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">
                Storyboard ({scenes.length} scenes)
              </h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={sceneSearch}
                    onChange={e => setSceneSearch(e.target.value)}
                    placeholder="Search script..."
                    className="h-7 w-40 pl-7 text-xs"
                  />
                </div>
                {selectedScenes.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={batchRegenLoading || isPipelineRunning}
                      onClick={() => {
                        if (!jobId) return;
                        armNotifications();
                        const prompts = selectedScenes
                          .map(i => {
                            const scene = scenes.find(s => s.index === i);
                            const prompt = (
                              promptEdits[i] ??
                              (scene ? ownedPrompt(scene) : "")
                            ).trim();
                            const split = !!scene && isSplitScene(scene);
                            return {
                              index: i,
                              visualPrompt: split ? undefined : prompt,
                              splitVisual: split ? prompt : undefined,
                            };
                          })
                          .filter(p => p.visualPrompt || p.splitVisual);
                        const verbatim = selectedScenes.filter(isEdited);
                        // Queue optimistically so spinners + polling start on
                        // this click, not a round-trip later (onError rolls back).
                        for (const i of selectedScenes)
                          if (!queuedScenes.includes(i)) {
                            queuePhase.current.set(i, "queued");
                            queuedAt.current.set(i, Date.now());
                          }
                        setQueuedScenes(prev =>
                          prev.concat(
                            selectedScenes.filter(i => !prev.includes(i))
                          )
                        );
                        regenBatchMutation.mutate({
                          jobId,
                          sceneIndices: selectedScenes,
                          prompts: prompts.length ? prompts : undefined,
                          verbatimIndices: verbatim.length
                            ? verbatim
                            : undefined,
                        });
                      }}
                    >
                      {batchRegenLoading ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1.5 h-3 w-3" />
                      )}
                      Regenerate {selectedScenes.length} selected
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setSelectedScenes([])}
                    >
                      Clear
                    </Button>
                  </>
                )}
              </div>
            </div>
            {/* Whole-video style direction — the one world every b-roll cutaway shares.
                Derived once at render start from the channel persona + full script; editing it
                and regenerating scenes re-runs them against the new world. Per-scene fixes go
                through each scene's own prompt box (which regenerates verbatim). */}
            <details className="group">
              <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
                <span className="inline-flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                  Visual style direction
                </span>
              </summary>
              <div className="mt-2 space-y-2">
                {!job?.visualStyleBible && bibleEdit === null ? (
                  <p className="text-xs text-muted-foreground">
                    No style direction derived for this job.
                  </p>
                ) : (
                  <>
                    <Textarea
                      value={bibleEdit ?? job?.visualStyleBible ?? ""}
                      onChange={e => setBibleEdit(e.target.value)}
                      rows={3}
                      className="text-xs"
                      placeholder="The place, season, and recurring materials every cutaway shares. Content only — no camera, lighting, or colour."
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={
                          bibleEdit === null ||
                          isProcessing ||
                          styleBibleMutation.isPending
                        }
                        onClick={() => {
                          if (!jobId || bibleEdit === null) return;
                          styleBibleMutation.mutate({
                            jobId,
                            styleBible: bibleEdit,
                          });
                        }}
                      >
                        {styleBibleMutation.isPending && (
                          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        )}
                        Save
                      </Button>
                      {bibleEdit !== null && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setBibleEdit(null)}
                        >
                          Cancel
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Applies on the next scene regenerate.
                      </span>
                    </div>
                  </>
                )}
              </div>
            </details>
            {(minuteGroups.length > 1 || regenScenes.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {minuteGroups.map((g, i) => (
                  <Button
                    key={i}
                    size="sm"
                    variant={selectedGroup === i ? "default" : "outline"}
                    className="h-7 text-xs font-mono"
                    onClick={() => setSelectedGroup(i)}
                  >
                    {g.label}
                  </Button>
                ))}
                {regenScenes.length > 0 && (
                  <Button
                    size="sm"
                    variant={selectedGroup === -1 ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setSelectedGroup(-1)}
                  >
                    Regenerate ({regenScenes.length})
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {displayScenes.map(scene => {
              const isSceneRendering = sceneEdits.active.includes(scene.index);
              const isSceneQueued =
                queuedScenes.includes(scene.index) ||
                isSceneRendering ||
                sceneEdits.queued.includes(scene.index);
              const isTileSelected = selectedScenes.includes(scene.index);
              return (
                <div
                  key={scene.index}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveSceneIndexState(scene.index)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveSceneIndexState(scene.index);
                    }
                  }}
                  className={`shrink-0 w-32 rounded-md border overflow-hidden cursor-pointer transition-colors ${
                    scene.index === activeSceneIndex
                      ? "border-primary ring-2 ring-primary"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="relative aspect-video bg-secondary/40">
                    {isSceneQueued ? (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : scene.clipUrl ? (
                      <SceneStripThumb
                        clipUrl={scene.clipUrl}
                        startSec={scene.clipInSec}
                        className="absolute inset-0"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        {scene.sceneStatus === "failed" ? (
                          <XCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                      </div>
                    )}
                    <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-[10px] font-mono text-white">
                      #{scene.index}
                      {sceneTimecodes.has(scene.index) && (
                        <span className="text-white/70">
                          {" · "}
                          {sceneTimecodes.get(scene.index)}
                        </span>
                      )}
                    </span>
                    <Checkbox
                      checked={isTileSelected}
                      onCheckedChange={() =>
                        setSelectedScenes(prev =>
                          prev.includes(scene.index)
                            ? prev.filter(i => i !== scene.index)
                            : [...prev, scene.index]
                        )
                      }
                      onClick={e => e.stopPropagation()}
                      aria-label={`Select scene ${scene.index}`}
                      className="absolute top-1 right-1 bg-background/80"
                    />
                    {isSceneQueued ? (
                      <span className="absolute bottom-1 right-1 rounded-full bg-info p-0.5">
                        <Loader2 className="h-3 w-3 text-white animate-spin" />
                      </span>
                    ) : scene.sceneStatus === "failed" ? (
                      <span className="absolute bottom-1 right-1 rounded-full bg-destructive p-0.5">
                        <XCircle className="h-3 w-3 text-white" />
                      </span>
                    ) : (
                      regeneratedScenes.includes(scene.index) &&
                      scene.sceneStatus === "completed" && (
                        <span className="absolute bottom-1 right-1 rounded-full bg-success p-0.5">
                          <CheckCircle2 className="h-3 w-3 text-white" />
                        </span>
                      )
                    )}
                  </div>
                  <div className="flex items-center gap-1 px-1.5 py-1 bg-card">
                    {scene.hostPresent ? (
                      <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <Trees className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-[10.5px] text-foreground">
                      {scene.scriptText ?? scene.narration ?? "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid gap-3">
            {displayScenes
              .filter(scene => scene.index === activeSceneIndex)
              .map(scene => {
                const isSceneRendering = sceneEdits.active.includes(
                  scene.index
                );
                const isSceneQueued =
                  queuedScenes.includes(scene.index) ||
                  isSceneRendering ||
                  sceneEdits.queued.includes(scene.index);
                const isSelected = selectedScenes.includes(scene.index);
                return (
                  <Card
                    key={scene.index}
                    className={`bg-card transition-colors ${
                      isSelected
                        ? "border-primary ring-2 ring-primary"
                        : "border-border"
                    }`}
                  >
                    <CardContent className="p-4 flex gap-4">
                      <div className="w-44 shrink-0">
                        {isSceneQueued ? (
                          <div className="flex items-center justify-center h-24 rounded bg-secondary/40 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                          </div>
                        ) : scene.clipUrl ? (
                          <LongformScenePreview
                            clipUrl={scene.clipUrl}
                            audioUrl={scene.audioUrl}
                            startSec={scene.clipInSec}
                            durationSec={
                              scene.narrationStartSec != null &&
                              scene.narrationEndSec != null
                                ? scene.narrationEndSec -
                                  scene.narrationStartSec
                                : undefined
                            }
                            className="w-full rounded bg-black"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-24 rounded bg-secondary/40 text-muted-foreground">
                            {scene.sceneStatus === "failed" ? (
                              <XCircle className="h-5 w-5 text-destructive" />
                            ) : (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() =>
                              setSelectedScenes(prev =>
                                prev.includes(scene.index)
                                  ? prev.filter(i => i !== scene.index)
                                  : [...prev, scene.index]
                              )
                            }
                            aria-label={`Select scene ${scene.index}`}
                          />
                          <span className="text-xs font-mono text-muted-foreground">
                            #{scene.index}
                            {sceneTimecodes.has(scene.index) && (
                              <> · {sceneTimecodes.get(scene.index)}</>
                            )}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[10px] gap-1 py-0"
                          >
                            {scene.hostPresent ? (
                              <>
                                <User className="h-3 w-3" /> Host
                              </>
                            ) : (
                              <>
                                <Trees className="h-3 w-3" /> B-roll
                              </>
                            )}
                          </Badge>
                          {!scene.hostPresent && (
                            <Badge
                              variant="outline"
                              className="text-[10px] gap-1 py-0"
                            >
                              {scene.stillImage ? (
                                <>
                                  <ImageIcon className="h-3 w-3" /> Still
                                </>
                              ) : (
                                <>
                                  <Film className="h-3 w-3" /> Video
                                </>
                              )}
                            </Badge>
                          )}
                          {scene.sceneStatus === "failed" && (
                            <Badge
                              variant="destructive"
                              className="text-[10px] py-0"
                            >
                              Failed
                            </Badge>
                          )}
                          {scene.sceneStatus === "rendering" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 text-warning border-warning/40"
                            >
                              Rendering — retry to resume
                            </Badge>
                          )}
                          {isSceneQueued && (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 gap-1 text-info border-info/40"
                            >
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {isSceneRendering ? "Rendering" : "Queued"}
                            </Badge>
                          )}
                          {regeneratedScenes.includes(scene.index) &&
                            !isSceneQueued &&
                            scene.sceneStatus === "completed" && (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0 gap-1 text-success border-success/40"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Regenerated
                              </Badge>
                            )}
                        </div>
                        <div className="space-y-0.5">
                          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            Spoken
                          </Label>
                          <p className="text-sm line-clamp-3">
                            {scene.scriptText ?? scene.narration}
                          </p>
                        </div>
                        <div className="space-y-0.5">
                          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            Visual
                          </Label>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {ownedPrompt(scene)}
                          </p>
                        </div>
                        {scene.error && (
                          <p className="text-xs text-destructive">
                            {sanitizeError(scene.error)}
                          </p>
                        )}
                        {!isPipelineRunning &&
                          (expandedScene === scene.index ? (
                            <div
                              className="space-y-2 pt-1"
                              onClick={e => e.stopPropagation()}
                            >
                              {scene.clipUrl && (
                                // `muted` is gone with the silent clip: the point of the expanded
                                // editor is judging a shot against its line, which needs the line.
                                <LongformScenePreview
                                  clipUrl={scene.clipUrl}
                                  audioUrl={scene.audioUrl}
                                  startSec={scene.clipInSec}
                                  durationSec={
                                    scene.narrationStartSec != null &&
                                    scene.narrationEndSec != null
                                      ? scene.narrationEndSec -
                                        scene.narrationStartSec
                                      : undefined
                                  }
                                  className="w-full rounded bg-black max-h-[120px]"
                                />
                              )}
                              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                Spoken (voiced verbatim)
                              </Label>
                              <p className="text-xs text-muted-foreground italic">
                                {scene.scriptText ?? scene.narration}
                              </p>
                              {scene.clipUrl &&
                                scene.narrationStartSec != null &&
                                scene.narrationEndSec != null &&
                                (() => {
                                  const pos = scenes.findIndex(
                                    sc => sc.index === scene.index
                                  );
                                  const prev =
                                    pos > 0 ? scenes[pos - 1] : undefined;
                                  const next =
                                    pos >= 0 && pos < scenes.length - 1
                                      ? scenes[pos + 1]
                                      : undefined;
                                  return (
                                    <SceneTimingEditor
                                      sceneIndex={scene.index}
                                      clipUrl={scene.clipUrl}
                                      startSec={scene.narrationStartSec}
                                      endSec={scene.narrationEndSec}
                                      clipInSec={scene.clipInSec}
                                      tailHoldSec={scene.tailHoldSec}
                                      headHoldSec={scene.headHoldSec}
                                      qrTail={scene.qrTail}
                                      prevStartSec={prev?.narrationStartSec}
                                      nextEndSec={next?.narrationEndSec}
                                      lipsync={
                                        !!scene.hostPresent && !!scene.lipsynced
                                      }
                                      masterAudioUrl={job?.masterAudioUrl}
                                      audioUrl={scene.audioUrl}
                                      prevAudioUrl={prev?.audioUrl}
                                      nextAudioUrl={next?.audioUrl}
                                      prevClipUrl={prev?.clipUrl}
                                      prevClipInSec={prev?.clipInSec}
                                      nextClipUrl={next?.clipUrl}
                                      nextClipInSec={next?.clipInSec}
                                      prevIndex={prev?.index}
                                      nextIndex={next?.index}
                                      onSelectScene={i => setExpandedScene(i)}
                                      pending={
                                        timingMutation.isPending ||
                                        splitSceneMutation.isPending ||
                                        moveCutMutation.isPending ||
                                        setPieceClipInMutation.isPending ||
                                        revertSceneTimingMutation.isPending ||
                                        rippleMutation.isPending ||
                                        isSceneQueued
                                      }
                                      onApply={edit => {
                                        if (!jobId) return;
                                        timingMutation.mutate({
                                          jobId,
                                          sceneIndex: scene.index,
                                          ...edit,
                                        });
                                      }}
                                      onSplit={atOffsetSec => {
                                        if (!jobId) return;
                                        splitSceneMutation.mutate({
                                          jobId,
                                          sceneIndex: scene.index,
                                          atOffsetSec,
                                        });
                                      }}
                                      cutPoints={scene.cutPoints}
                                      onRemoveCut={atOffsetSec => {
                                        if (!jobId) return;
                                        undoSplitMutation.mutate({
                                          jobId,
                                          sceneIndex: scene.index,
                                          atOffsetSec,
                                        });
                                      }}
                                      onMoveCut={(
                                        fromOffsetSec,
                                        toOffsetSec
                                      ) => {
                                        if (!jobId) return;
                                        moveCutMutation.mutate({
                                          jobId,
                                          sceneIndex: scene.index,
                                          fromOffsetSec,
                                          toOffsetSec,
                                        });
                                      }}
                                      pieceClipIns={scene.pieceClipIns}
                                      onSetPieceClipIn={(
                                        cutOffsetSec,
                                        clipInSec
                                      ) => {
                                        if (!jobId) return;
                                        setPieceClipInMutation.mutate({
                                          jobId,
                                          sceneIndex: scene.index,
                                          cutOffsetSec,
                                          clipInSec,
                                        });
                                      }}
                                      onRipple={
                                        job?.masterAudioUrl
                                          ? (newSec, edge) => {
                                              if (!jobId) return;
                                              rippleMutation.mutate({
                                                jobId,
                                                sceneIndex: scene.index,
                                                newSec,
                                                edge,
                                              });
                                            }
                                          : undefined
                                      }
                                      canRevert={!!scene.timingOriginal}
                                      onRevert={() => {
                                        if (!jobId) return;
                                        revertSceneTimingMutation.mutate({
                                          jobId,
                                          sceneIndex: scene.index,
                                        });
                                      }}
                                    />
                                  );
                                })()}
                              {/* Merge two neighbouring shots into ONE continuous clip — the fix
                                  for a cut that chops the host mid-flow (e.g. the two-angle cold
                                  open). Shown only where the server would accept it, so the
                                  button never appears just to refuse. */}
                              {(() => {
                                if (!job?.masterAudioUrl) return null;
                                const pos = scenes.findIndex(
                                  sc => sc.index === scene.index
                                );
                                const next =
                                  pos >= 0 && pos < scenes.length - 1
                                    ? scenes[pos + 1]
                                    : undefined;
                                const setPiece = (s: StoryboardScene) =>
                                  s.qrHero || s.coverHero || !!s.assetImageUrl;
                                if (
                                  !next ||
                                  scene.narrationStartSec == null ||
                                  scene.narrationEndSec == null ||
                                  next.narrationStartSec == null ||
                                  next.narrationEndSec == null ||
                                  Math.abs(
                                    next.narrationStartSec -
                                      scene.narrationEndSec
                                  ) > 0.05 ||
                                  setPiece(scene) ||
                                  setPiece(next) ||
                                  isSplitScene(scene) ||
                                  isSplitScene(next) ||
                                  !!scene.hostPresent !== !!next.hostPresent
                                )
                                  return null;
                                return (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    disabled={
                                      mergeScenesMutation.isPending ||
                                      isSceneQueued
                                    }
                                    title="Glue this scene and the next into one scene and re-render them as a single continuous clip — removes the cut between them. Costs one clip render."
                                    onClick={() => {
                                      if (!jobId) return;
                                      mergeScenesMutation.mutate({
                                        jobId,
                                        sceneIndex: scene.index,
                                      });
                                    }}
                                  >
                                    <Merge className="mr-1.5 h-3.5 w-3.5" />
                                    Merge with scene #{next.index} — one
                                    continuous clip
                                  </Button>
                                );
                              })()}
                              {/* Undo a merge: the originals' clips and audio still exist, so
                                  the two cards come back instantly — nothing re-renders. */}
                              {scene.mergeOriginal && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full"
                                  disabled={
                                    unmergeScenesMutation.isPending ||
                                    isSceneQueued
                                  }
                                  title="Put back the two scenes this one was merged from, with their original clips — free, nothing re-renders."
                                  onClick={() => {
                                    if (!jobId) return;
                                    unmergeScenesMutation.mutate({
                                      jobId,
                                      sceneIndex: scene.index,
                                    });
                                  }}
                                >
                                  <History className="mr-1.5 h-3.5 w-3.5" />
                                  Unmerge — restore the original two scenes
                                </Button>
                              )}
                              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                {isSplitScene(scene)
                                  ? "Right panel (still) → gpt-image-2"
                                  : `Visual Prompt → ${providerDisplayName || "Model"}`}
                              </Label>
                              {isSplitScene(scene) && (
                                <p className="text-[10px] text-muted-foreground">
                                  Host video on the left is reused — only the
                                  right still regenerates.
                                </p>
                              )}
                              <Textarea
                                value={
                                  promptEdits[scene.index] ?? ownedPrompt(scene)
                                }
                                onChange={e =>
                                  setPromptEdits(p => ({
                                    ...p,
                                    [scene.index]: e.target.value,
                                  }))
                                }
                                className="text-xs min-h-[80px] border-border resize-y"
                                placeholder="Describe the visual for this scene..."
                              />
                              {(scene.assembledClipPrompt ||
                                scene.assembledStillPrompt) && (
                                <details className="text-[11px] text-muted-foreground">
                                  <summary className="cursor-pointer select-none uppercase tracking-wide text-[10px]">
                                    Prompt sent to provider
                                  </summary>
                                  {scene.assembledStillPrompt && (
                                    <div className="mt-1 break-words">
                                      <span className="font-semibold">
                                        Still → gpt-image-2:
                                      </span>{" "}
                                      {scene.assembledStillPrompt}
                                    </div>
                                  )}
                                  {scene.assembledClipPrompt && (
                                    <div className="mt-1 break-words">
                                      <span className="font-semibold">
                                        Clip → grok-imagine-video:
                                      </span>{" "}
                                      {scene.assembledClipPrompt}
                                    </div>
                                  )}
                                </details>
                              )}
                              {scene.hostPresent && (
                                <div className="rounded-md border border-border p-2.5 space-y-2">
                                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                    <Columns2 className="h-3 w-3" /> Split
                                    screen
                                  </Label>
                                  {/* The two halves ARE two separate videos — show them that way. */}
                                  {isSplitScene(scene) &&
                                    scene.hostClipUrls?.[0] &&
                                    scene.splitRightUrl && (
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <p className="text-[10px] text-muted-foreground mb-1">
                                            Host (reused, never re-rendered)
                                          </p>
                                          <video
                                            src={scene.hostClipUrls[0]}
                                            controls
                                            muted
                                            preload="none"
                                            className="w-full rounded bg-black max-h-[100px]"
                                            onClick={e => e.stopPropagation()}
                                          />
                                        </div>
                                        <div>
                                          <p className="text-[10px] text-muted-foreground mb-1">
                                            Right panel (swappable)
                                          </p>
                                          <video
                                            src={scene.splitRightUrl}
                                            controls
                                            muted
                                            preload="none"
                                            className="w-full rounded bg-black max-h-[100px]"
                                            onClick={e => e.stopPropagation()}
                                          />
                                        </div>
                                      </div>
                                    )}
                                  {isSplitScene(scene) &&
                                    scene.hostClipUrls?.[0] &&
                                    scene.splitRightUrl && (
                                      <div className="space-y-1">
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                          Position (drag — applies with one free
                                          ffmpeg recomposite)
                                        </p>
                                        <SplitPositionEditor
                                          hostUrl={scene.hostClipUrls[0]}
                                          rightUrl={scene.splitRightUrl}
                                          layout={scene.splitLayout}
                                          autoHostFocusX={scene.splitAutoFocusX}
                                          pending={isSceneQueued}
                                          onApply={layout =>
                                            applySplitEdit(scene, {
                                              mode: "layout",
                                              layout,
                                            })
                                          }
                                        />
                                      </div>
                                    )}
                                  <p className="text-[10px] text-muted-foreground">
                                    {isSplitScene(scene)
                                      ? "Swap what shows beside the host, or go back to full-frame. The host video never re-renders."
                                      : "Put a visual beside the host: render one from the prompt above, or reuse any scene's footage."}
                                  </p>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {isSplitScene(scene) && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        disabled={isSceneQueued}
                                        onClick={() =>
                                          applySplitEdit(scene, { mode: "off" })
                                        }
                                      >
                                        Remove split
                                      </Button>
                                    )}
                                    {!isSplitScene(scene) && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        disabled={isSceneQueued}
                                        onClick={() =>
                                          applySplitEdit(scene, {
                                            mode: "prompt",
                                            prompt:
                                              promptEdits[
                                                scene.index
                                              ]?.trim() || undefined,
                                            verbatim:
                                              isEdited(scene.index) ||
                                              undefined,
                                          })
                                        }
                                      >
                                        <Columns2 className="mr-1.5 h-3 w-3" />
                                        Make split screen
                                      </Button>
                                    )}
                                    <Select
                                      value={
                                        splitSource[scene.index]?.toString() ??
                                        ""
                                      }
                                      onValueChange={v =>
                                        setSplitSource(p => ({
                                          ...p,
                                          [scene.index]: v
                                            ? Number(v)
                                            : undefined,
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="h-7 w-56 text-xs">
                                        <SelectValue placeholder="Use another scene's footage…" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {scenes
                                          .filter(
                                            s =>
                                              s.index !== scene.index &&
                                              (s.hostPresent
                                                ? !!s.splitRightUrl
                                                : !!(
                                                    s.clipUrls?.length ||
                                                    s.clipUrl
                                                  ))
                                          )
                                          .map(s => (
                                            <SelectItem
                                              key={s.index}
                                              value={s.index.toString()}
                                              className="text-xs"
                                            >
                                              #{s.index}{" "}
                                              {s.hostPresent
                                                ? "(panel)"
                                                : s.stillImage
                                                  ? "(still)"
                                                  : "(video)"}{" "}
                                              —{" "}
                                              {(
                                                (s.hostPresent
                                                  ? s.splitVisual
                                                  : s.visualPrompt) ?? ""
                                              ).slice(0, 48)}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                    {splitSource[scene.index] != null && (
                                      <Button
                                        size="sm"
                                        className="h-7 text-xs"
                                        disabled={isSceneQueued}
                                        onClick={() =>
                                          applySplitEdit(scene, {
                                            mode: "scene",
                                            sourceIndex:
                                              splitSource[scene.index]!,
                                          })
                                        }
                                      >
                                        Show it beside the host
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={
                                    isSceneQueued ||
                                    !(
                                      promptEdits[scene.index] ??
                                      ownedPrompt(scene)
                                    ).trim()
                                  }
                                  onClick={() => regenerateSingle(scene)}
                                >
                                  {isSceneQueued ? (
                                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="mr-1.5 h-3 w-3" />
                                  )}
                                  Regenerate
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setExpandedScene(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={isSceneQueued}
                                onClick={e => {
                                  e.stopPropagation();
                                  regenerateSingle(scene);
                                }}
                              >
                                {isSceneQueued ? (
                                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-1.5 h-3 w-3" />
                                )}
                                Regenerate
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={isSceneQueued}
                                onClick={e => {
                                  e.stopPropagation();
                                  setExpandedScene(scene.index);
                                }}
                              >
                                <Pencil className="mr-1.5 h-3 w-3" />
                                Edit
                              </Button>
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </div>
      )}

      {/* Confirmation */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Generate long-form video {slotIndex + 1}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {channelDefaults?.hostPhotoUrl ? (
                  <p>
                    This will voice your full script word-for-word and
                    storyboard it into a 16:9 video. The on-camera host
                    (talking-head) scenes are lip-synced with{" "}
                    <strong>HeyGen Avatar IV</strong> and make up a small share
                    of the runtime; b-roll cutaways and image scenes are
                    generated with <strong>69Labs</strong>.
                  </p>
                ) : (
                  <p>
                    This will voice your full script word-for-word and
                    storyboard it into a 16:9 b-roll video generated with{" "}
                    <strong>69Labs</strong>. This channel has no host photo set
                    (Admin → Channels), so there are no lip-synced talking-head
                    scenes.
                  </p>
                )}
                {/* The three facts that decide whether this click is the right
                    one, together, instead of scattered up the form. */}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-muted/60 p-3 text-xs">
                  <dt className="text-muted-foreground">Script</dt>
                  <dd className="tabular-nums">
                    {wordCount.toLocaleString()} words · roughly{" "}
                    {estimatedMinutes}
                  </dd>
                  <dt className="text-muted-foreground">Host lock</dt>
                  <dd>
                    {channelDefaults?.hostPhotoUrl
                      ? "On"
                      : "No channel photo — text-only"}
                  </dd>
                  <dt className="text-muted-foreground">B-roll model</dt>
                  <dd>Grok</dd>
                </dl>
                {/* CTA check — the cases the router would reject are announced HERE, with the
                    fix next to them, instead of surfacing as a server error after the click. */}
                <div className="space-y-1.5 rounded-md border border-border p-3 text-xs">
                  <p className="font-medium text-foreground">Call to action</p>
                  {ctaScan.errors.length > 0 ? (
                    <p className="text-destructive">
                      Broken CTA markers: {ctaScan.errors.join("; ")}. Fix the
                      script to generate.
                    </p>
                  ) : ctaScan.blocks.length === 0 ? (
                    <>
                      <p
                        className={
                          ctaWouldReject ? "text-destructive" : "text-warning"
                        }
                      >
                        {ctaScan.empty > 0
                          ? `Your CTA markers are empty — write the spoken pitch between ===START CTA=== and ===END CTA===${ctaWouldReject ? ", or generating would fail" : ""}.`
                          : ctaWouldReject
                            ? ctaBookTitles.length > 0
                              ? `You assigned ${ctaBookTitles.length === 1 ? "a book" : `${ctaBookTitles.length} books`} (${ctaBookTitles.map(t => `“${t}”`).join(", ")}) but the script has no marked CTA block — generating would fail.`
                              : "This channel has a book cover/QR configured, so the script needs marked CTA blocks — generating would fail."
                            : "No CTA blocks marked. Books, covers, QR and channel assets only appear inside ===START CTA=== / ===END CTA=== blocks."}
                      </p>
                      {ctaScan.empty === 0 && (
                        <>
                          <p className="text-muted-foreground">
                            Wrap your pitch paragraphs in ===START CTA=== /
                            ===END CTA=== lines (they are never voiced), or:
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={insertCtaTemplate}
                          >
                            Insert CTA template at the end of the script
                          </Button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <p>
                        {ctaScan.blocks.length} CTA block
                        {ctaScan.blocks.length === 1 ? "" : "s"} marked
                        {ctaScan.blocks.length === 1 &&
                          " — most films carry 2 (mid-roll + close)"}
                        .
                      </p>
                      {ctaCandidates.length > 0 && (
                        <ul className="space-y-0.5">
                          {ctaAssignments.map((a, i) => (
                            <li key={i}>
                              Block {i + 1} →{" "}
                              {a.bookIndex != null ? (
                                <>
                                  “{ctaCandidates[a.bookIndex].title}”{" "}
                                  <span className="text-muted-foreground">
                                    (
                                    {a.bookIndex >= ctaBookTitles.length
                                      ? "channel book — "
                                      : ""}
                                    {a.byLabel
                                      ? "named in the marker"
                                      : a.byTitle
                                        ? "title spoken in this block"
                                        : "by order — the block never names it"}
                                    )
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">
                                  channel cover/QR fallback
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {ctaScan.empty > 0 && (
                        <p className="text-warning">
                          {ctaScan.empty} marker pair
                          {ctaScan.empty === 1 ? " is" : "s are"} still empty —
                          write the pitch between those markers or remove them.
                        </p>
                      )}
                      {ctaPlaceholderLeft && (
                        <p className="text-destructive">
                          A CTA block still contains the inserted template
                          placeholder — replace it with your spoken pitch, or it
                          would be read aloud word-for-word.
                        </p>
                      )}
                    </>
                  )}
                </div>
                <p className="text-warning">
                  Length follows your script; long scripts spend many credits
                  and can run for a long time.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmGenerate}
              // The CTA section above says WHY and carries the fix (markers / template edit) —
              // submitting anyway would just bounce off the router's own validation.
              disabled={ctaWouldReject || ctaPlaceholderLeft}
            >
              Generate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GenerationCostDialog
        jobId={jobId}
        open={showCost}
        onOpenChange={setShowCost}
      />

      {/* Confirms a detach, not a delete. The old copy — "clear the video output, error
          messages, and storyboard" — described losing three things and never mentioned that
          the render survives, which is the fact that decides whether you press it. Nothing
          about the action changed; only what it admits to doing. */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove this video from tab {slotIndex + 1}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The render stays in your library — this only frees the tab so you
              can start another. Open it again any time from the library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep here</AlertDialogCancel>
            {/* Not the destructive red: nothing is destroyed, and dressing a reversible
                action as one is how a useful control ends up avoided. */}
            <AlertDialogAction onClick={confirmClearOutput}>
              Remove from tab
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

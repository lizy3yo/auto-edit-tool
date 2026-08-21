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
import { SplitPositionEditor } from "@/components/SplitPositionEditor";
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
  BookOpen,
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
  const [selectedScenes, setSelectedScenes] = useState<number[]>([]);
  const [sceneSearch, setSceneSearch] = useState("");
  const [downloadTitle, setDownloadTitle] = useState(initialTitle);
  // Which books this video pitches. Seeded from the draft saved in localStorage so a reload
  // doesn't lose them; a tab holding a render replaces this from `job.ctaBooks` (hydration).
  // Seeded empty; a restored DRAFT is adopted once the workspace arrives (the adopt effect
  // below), and a tab holding a render replaces this from `job.ctaBooks` (the hydration effect).
  const [ctaBooks, setCtaBooks] = useState<CtaBookAssignment[]>([]);
  // Set by the finished-video player; the timestamp map calls it to jump to a shot.
  const playerSeekRef = useRef<((sec: number) => void) | null>(null);
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

  const regenMutation = trpc.longformVideo.regenerateScene.useMutation({
    onSuccess: (_d, vars) => {
      toast.success("Regenerating scene...");
      setExpandedScene(null);
      // Edit is now persisted server-side; drop the local override so the next
      // poll's scene.visualPrompt becomes the source of truth.
      setPromptEdits(p => {
        const { [vars.sceneIndex]: _, ...rest } = p;
        return rest;
      });
    },
    onError: (err, vars) => {
      toast.error(err.message);
      // Roll back the optimistic queue so the spinner doesn't hang forever.
      queuePhase.current.delete(vars.sceneIndex);
      setQueuedScenes(prev => prev.filter(i => i !== vars.sceneIndex));
    },
  });

  // Split editor: per-scene selection of "use another scene's footage as the right panel".
  const [splitSource, setSplitSource] = useState<
    Record<number, number | undefined>
  >({});
  const splitEditMutation = trpc.longformVideo.setSceneSplit.useMutation({
    onSuccess: (_d, vars) => {
      toast.success(
        vars.mode === "off"
          ? "Removing the split — back to full-frame host..."
          : vars.mode === "scene"
            ? "Compositing the chosen footage beside the host..."
            : vars.mode === "layout"
              ? "Repositioning the split — pure ffmpeg, nothing regenerates..."
              : "Rendering a fresh right panel..."
      );
      setExpandedScene(null);
      if (jobId) utils.longformVideo.pollJob.invalidate({ jobId });
    },
    onError: (err, vars) => {
      toast.error(err.message);
      queuePhase.current.delete(vars.sceneIndex);
      setQueuedScenes(prev => prev.filter(i => i !== vars.sceneIndex));
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
    setQueuedScenes(prev =>
      prev.includes(scene.index) ? prev : [...prev, scene.index]
    );
    splitEditMutation.mutate({ jobId, sceneIndex: scene.index, ...edit });
  };

  const regenBatchMutation = trpc.longformVideo.regenerateScenes.useMutation({
    onSuccess: (_d, vars) => {
      toast.success(`Regenerating ${vars.sceneIndices.length} scenes...`);
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

  const { data: rawJob } = trpc.longformVideo.pollJob.useQuery(
    { jobId: jobId ?? 0 },
    {
      enabled: jobId !== null && jobId !== dismissedJobId,
      refetchIntervalInBackground: true, // keep polling while the tab is hidden
      // Poll while running or while scenes are queued for regeneration; stop
      // once finished (refresh restores it via the persisted id, but a done
      // job with nothing queued shouldn't be re-fetched every 3s).
      refetchInterval: q =>
        q.state.data?.status === "processing" || queuedScenes.length > 0
          ? 3000
          : false,
    }
  );

  const job = jobId !== null && jobId !== dismissedJobId ? rawJob : null;

  const isProcessing = job?.status === "processing";

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
    const settled: number[] = [];
    for (const i of queuedScenes) {
      const s = status(i);
      const phase = queuePhase.current.get(i) ?? "queued";
      if (phase === "queued" && (s === "processing" || s === "rendering")) {
        queuePhase.current.set(i, "confirmed");
      } else if (
        phase === "confirmed" &&
        (s === "completed" || s === "failed")
      ) {
        settled.push(i);
      }
    }
    if (settled.length === 0) return;
    for (const i of settled) queuePhase.current.delete(i);
    setQueuedScenes(prev => prev.filter(i => !settled.includes(i)));
  }, [job, queuedScenes]);

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
  const needsBookCoverRetrofit = useMemo(() => {
    const hasBook =
      !!job?.bookCoverImageUrl ||
      !!job?.ctaBooks?.length ||
      !!dialogChannelBooks?.some(b => b.coverImageUrl);
    if (!hasBook) return false;
    if (!scenes.some(s => s.cta)) return false;
    return !scenes.some(s => s.coverHero);
  }, [scenes, job?.bookCoverImageUrl, job?.ctaBooks, dialogChannelBooks]);

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
    ? "This tab is rendering. It'll free up when the job finishes."
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
                {job.status === "completed" ? (
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
                {isProcessing ? (
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

            {progress &&
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

            {job.status === "completed" && job.finalVideoUrl && (
              <div className="space-y-3">
                <LongformVideoPlayer
                  src={job.finalVideoUrl}
                  seekRef={playerSeekRef}
                />
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
                      onSeek={sec => playerSeekRef.current?.(sec)}
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
                      disabled={batchRegenLoading || isProcessing}
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
                          if (!queuedScenes.includes(i))
                            queuePhase.current.set(i, "queued");
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
          <div className="grid gap-3">
            {displayScenes.map(scene => {
              const isSceneQueued = queuedScenes.includes(scene.index);
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
                            Regenerating
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
                      {!isProcessing &&
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
                                className="w-full rounded bg-black max-h-[120px]"
                              />
                            )}
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                              Spoken (voiced verbatim)
                            </Label>
                            <p className="text-xs text-muted-foreground italic">
                              {scene.scriptText ?? scene.narration}
                            </p>
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
                                  <Columns2 className="h-3 w-3" /> Split screen
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
                                        pending={
                                          splitEditMutation.isPending ||
                                          isSceneQueued
                                        }
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
                                      disabled={
                                        splitEditMutation.isPending ||
                                        isSceneQueued
                                      }
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
                                      disabled={
                                        splitEditMutation.isPending ||
                                        isSceneQueued
                                      }
                                      onClick={() =>
                                        applySplitEdit(scene, {
                                          mode: "prompt",
                                          prompt:
                                            promptEdits[scene.index]?.trim() ||
                                            undefined,
                                          verbatim:
                                            isEdited(scene.index) || undefined,
                                        })
                                      }
                                    >
                                      <Columns2 className="mr-1.5 h-3 w-3" />
                                      Make split screen
                                    </Button>
                                  )}
                                  <Select
                                    value={
                                      splitSource[scene.index]?.toString() ?? ""
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
                                      disabled={
                                        splitEditMutation.isPending ||
                                        isSceneQueued
                                      }
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
                                  regenMutation.isPending ||
                                  queuedScenes.includes(scene.index) ||
                                  !(
                                    promptEdits[scene.index] ??
                                    ownedPrompt(scene)
                                  ).trim()
                                }
                                onClick={() => regenerateSingle(scene)}
                              >
                                {regenMutation.isPending || isSceneQueued ? (
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
                              disabled={
                                regenMutation.isPending || isSceneQueued
                              }
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

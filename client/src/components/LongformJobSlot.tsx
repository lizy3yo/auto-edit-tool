import { useState, useEffect, useMemo, useRef } from "react";
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
import { LongformAssets } from "@/components/LongformAssets";
import {
  LongformCtaBooks,
  type CtaBookAssignment,
} from "@/components/LongformCtaBooks";
import { LongformPublishKit } from "@/components/LongformPublishKit";
import { LongformScenePreview } from "@/components/LongformScenePreview";
import { sanitizeError, isCreditError } from "@/lib/errorSanitizer";
import { triggerCreditErrorPopup } from "@/components/CreditErrorPopup";
import type { LongformAsset, StoryboardScene } from "@shared/types";
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
  User,
  Trees,
  Search,
  Pencil,
  ChevronRight,
  Trash2,
  Receipt,
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
  children,
}: {
  n: number;
  title: string;
  hint?: React.ReactNode;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border px-5 py-5 first:border-t-0 sm:px-6">
      <div className="mb-3 flex items-baseline gap-2.5">
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 translate-y-0.5 items-center justify-center rounded-full bg-secondary text-[11px] font-medium tabular-nums text-muted-foreground"
        >
          {n}
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
        {optional && (
          <span className="text-xs text-muted-foreground">Optional</span>
        )}
      </div>
      <div className="space-y-2 sm:pl-[30px]">
        {children}
        {hint && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </section>
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
  // Per-job asset images (book renders, product shots) shown verbatim in the CTA pitch. Local
  // state only: they belong to the NEXT generate click, and the job row persists them once it
  // starts. Cleared alongside the script when a new job is submitted.
  const [assets, setAssets] = useState<LongformAsset[]>([]);
  // Which book each CTA block pitches. Local until generate, then snapshotted onto the job.
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
    toast.success(`Video ${slotIndex + 1} output cleared`);
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

  const scenes = useMemo(
    () => (job?.storyboard as StoryboardScene[] | null) ?? [],
    [job?.storyboard]
  );
  // Derived from server data so the "Regenerated" badge survives a refresh.
  const regeneratedScenes = useMemo(
    () => scenes.filter(s => s.regenerated).map(s => s.index),
    [scenes]
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
    generateMutation.mutate({
      script: script.trim(),
      channelKey,
      title: downloadTitle.trim() || undefined,
      slotIndex,
      assets: assets.length ? assets : undefined,
      ctaBooks: ctaBooks.length ? ctaBooks : undefined,
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

          {/* Uploaded assets shown verbatim in this video's CTA pitch. */}
          <LongformAssets
            assets={assets}
            onChange={setAssets}
            disabled={generateMutation.isPending || isProcessing}
          />
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowClearConfirm(true)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Clear output and error log from this slot"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear Output
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
                <p className="text-warning">
                  Length follows your script; long scripts spend many credits
                  and can run for a long time.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmGenerate}>
              Generate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear Output Confirmation Modal */}
      <GenerationCostDialog
        jobId={jobId}
        open={showCost}
        onOpenChange={setShowCost}
      />

      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Video Output?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear the current video output, error messages, and
              storyboard from Video {slotIndex + 1} so you can start a new video
              run cleanly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Output</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClearOutput}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear Output
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

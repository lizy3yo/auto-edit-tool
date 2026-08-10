import { useState, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { ChannelVoiceTuning } from "@/components/ChannelVoiceTuning";
import { sanitizeError, isCreditError } from "@/lib/errorSanitizer";
import { triggerCreditErrorPopup } from "@/components/CreditErrorPopup";
import type { StoryboardScene } from "@shared/types";
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
} from "lucide-react";

export type SlotStatus = "idle" | "processing" | "completed" | "failed";

const STAGE_LABELS: Record<string, string> = {
  storyboard: "Storyboarding script",
  voiceover: "Generating voiceovers",
  clips: "Generating video clips",
  assembly: "Stitching final video",
  done: "Done",
};

function loadJobId(storageKey: string): number | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveJobId(storageKey: string, id: number | null) {
  if (id === null) localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, JSON.stringify(id));
}

function titleKey(storageKey: string) {
  return `${storageKey}_title`;
}

function loadTitle(storageKey: string): string {
  try {
    return localStorage.getItem(titleKey(storageKey)) ?? "";
  } catch {
    return "";
  }
}

function saveTitle(storageKey: string, title: string) {
  if (title) localStorage.setItem(titleKey(storageKey), title);
  else localStorage.removeItem(titleKey(storageKey));
}

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
  defaultScript,
  channels,
  providerDisplayName,
  onStatusChange,
}: LongformJobSlotProps) {
  const [script, setScript] = useState(defaultScript);
  const [channelKey, setChannelKey] = useState<string>("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [dismissedJobId, setDismissedJobId] = useState<number | null>(null);
  const [jobId, setJobId] = useState<number | null>(
    () => loadJobId(storageKey) ?? initialJobId ?? null
  );
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
  const [downloadTitle, setDownloadTitle] = useState(() =>
    loadTitle(storageKey)
  );
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
    if (jobId === null && initialJobId != null && initialJobId !== dismissedJobId) {
      setJobId(initialJobId);
      saveJobId(storageKey, initialJobId);
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
      saveJobId(storageKey, id);
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
      saveTitle(storageKey, "");
      setDownloadTitle("");
      setJobId(null);
      saveJobId(storageKey, null);
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
    saveJobId(storageKey, null);
    saveTitle(storageKey, "");
    setDownloadTitle("");
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

  // Persist the title on-device so it survives refresh/close (incl. before a job
  // exists). The DB copy is written at generate time and on blur (see below).
  useEffect(() => {
    saveTitle(storageKey, downloadTitle);
  }, [downloadTitle, storageKey]);

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

  const confirmGenerate = () => {
    setShowConfirm(false);
    armNotifications(); // unlock audio + request notification permission on the click
    generateMutation.mutate({
      script: script.trim(),
      channelKey,
      title: downloadTitle.trim() || undefined,
      slotIndex,
    });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardContent className="p-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            Paste only the spoken script, word-for-word — it is voiced verbatim
            as one continuous narration. The host look, b-roll style, tone, and
            16:9 framing are applied automatically from the saved Longform
            instruction (Admin → Longform); don't put directing notes here. The
            host photo and face model are configured per channel in Admin →
            Channels.
          </p>

          {/* Script */}
          <div className="space-y-2">
            <Label
              htmlFor={`lf-script-${slotIndex}`}
              className="text-sm font-medium"
            >
              Script
            </Label>
            <Textarea
              id={`lf-script-${slotIndex}`}
              value={script}
              onChange={e => setScript(e.target.value)}
              className="min-h-[200px] bg-secondary/50 border-border resize-y text-sm leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">
              Spoken script only — voiced word-for-word. Directing notes here
              would be read aloud, so keep them out (look & style come from the
              saved Longform instruction).
            </p>
          </div>

          {/* B-roll VIDEO renders on this tab's APIMART key (stills always use OpenAI gpt-image-2).
              Key status is admin-only (getApimartKeys is adminProcedure), so the warning is too. */}
          {apimartKeyMissing && (
            <p className="text-xs text-amber-400">
              ⚠ No APIMART key for this tab — set it in Admin → Longform. B-roll
              video will use 69 Labs.
            </p>
          )}

          {/* Channel (voice) */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Channel</Label>
            <Select value={channelKey} onValueChange={setChannelKey}>
              <SelectTrigger className="bg-secondary/50 border-border">
                <SelectValue placeholder="Select a channel..." />
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
              <div className="rounded border border-border/50 bg-secondary/20 p-2 text-xs space-y-2">
                {channelDefaults.voiceId ? (
                  <p>
                    <span className="font-medium text-foreground/70">
                      Voice:{" "}
                    </span>
                    {channelDefaults.voiceName ?? channelDefaults.voiceId}
                  </p>
                ) : (
                  <p className="text-red-400 font-medium">
                    ⚠ No voice configured for this channel
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
            <p className="text-xs text-muted-foreground">
              The voiceover uses this channel's saved voice.
            </p>
          </div>

          {/* Video title */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Video title</Label>
            <Input
              value={downloadTitle}
              onChange={e => setDownloadTitle(e.target.value)}
              placeholder="Video title (optional)"
              className="bg-secondary/50 border-border"
            />
          </div>

          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300/90">
            Length is set by your script — it's voiced word-for-word and
            storyboarded into a 16:9 talking-head video with b-roll cutaways.
            Clip count and runtime are computed after the voiceover. Longer
            scripts cost more credits and can take a long time. Each video tab
            you generate runs as its own job and consumes credits independently.
          </div>

          <Button
            onClick={() => setShowConfirm(true)}
            disabled={!canGenerate}
            className="w-full h-12 text-base font-medium"
            size="lg"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Submitting...
              </>
            ) : isProcessing ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <ScanFace className="mr-2 h-5 w-5" />
                Generate Video {slotIndex + 1}
              </>
            )}
          </Button>
        </CardContent>
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
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0 text-red-400" />
                )}
                {job.status === "completed" ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Select value={channelKey} onValueChange={setChannelKey}>
                      <SelectTrigger className="h-9 w-40 bg-secondary/50 border-border">
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
              {isProcessing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => jobId && cancelMutation.mutate({ jobId })}
                  disabled={cancelMutation.isPending}
                  className="text-muted-foreground hover:text-red-400"
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowClearConfirm(true)}
                  className="text-muted-foreground hover:text-red-400"
                  title="Clear output and error log from this slot"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear Output
                </Button>
              )}
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
              <p className="text-xs text-red-400">
                {sanitizeError(job.errorMessage || "Generation failed")}
              </p>
            )}

            {progress?.warnings && progress.warnings.length > 0 && (
              <ul className="space-y-0.5">
                {progress.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-500">
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
                <LongformVideoPlayer src={job.finalVideoUrl} />
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
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Storyboard review — stays visible after assembly so scenes can still be
          regenerated; a regen is render-only, clears finalVideoUrl, and surfaces the
          manual "Assemble final video" button above */}
      {scenes.length > 0 && (
        <div className="space-y-3">
          <div className="sticky top-0 z-20 -mx-4 space-y-3 border-b border-border bg-background px-4 py-3">
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
                        <video
                          src={scene.clipUrl}
                          controls
                          preload="none"
                          onClick={e => e.stopPropagation()}
                          className="w-full rounded bg-black"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-24 rounded bg-secondary/40 text-muted-foreground">
                          {scene.sceneStatus === "failed" ? (
                            <XCircle className="h-5 w-5 text-red-400" />
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
                            className="text-[10px] py-0 text-amber-400 border-amber-400/40"
                          >
                            Rendering — retry to resume
                          </Badge>
                        )}
                        {isSceneQueued && (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 gap-1 text-blue-400 border-blue-400/40"
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
                              className="text-[10px] py-0 gap-1 text-green-400 border-green-400/40"
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
                        <p className="text-xs text-red-400">
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
                              <video
                                src={scene.clipUrl}
                                controls
                                muted
                                preload="none"
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
                              className="text-xs min-h-[80px] bg-secondary/50 border-border resize-y"
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
                <div className="bg-secondary/50 rounded-md p-3 text-xs space-y-1">
                  <p>
                    Host lock:{" "}
                    {channelDefaults?.hostPhotoUrl
                      ? "on"
                      : "no channel photo — text-only"}
                  </p>
                  <p>B-roll model: Grok</p>
                </div>
                <p className="text-amber-400">
                  Length follows your script; long scripts consume many credits
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
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Video Output?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear the current video output, error messages, and storyboard from Video {slotIndex + 1} so you can start a new video run cleanly.
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

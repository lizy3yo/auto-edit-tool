import { useState, useEffect, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LongformJobSlot, { type SlotStatus } from "@/components/LongformJobSlot";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Coins,
  Film,
  History,
} from "lucide-react";

const MAX_SLOTS = 5;
const STORAGE_KEY_BASE = "longform_job_id";
const slotKey = (i: number) => `${STORAGE_KEY_BASE}_${i}`;

/**
 * Default script — a PURE SPOKEN sample (no preamble, no markers). Paste your own
 * spoken script/VSL here; it is voiced word-for-word and storyboarded automatically.
 * Host look, b-roll style, tone, and framing come from the saved Longform instruction
 * (Admin → Longform), not from this box. 16:9; length is set by the script.
 */
const DEFAULT_SCRIPT = `Hey, it's me again. If your lawn looks tired no matter how often you mow, I want to walk you through the few things that actually moved the needle for my customers this season.

First, your mowing height. Most folks cut way too short. Raise the deck — taller grass shades the soil, chokes out weeds, and holds water through the hot stretch.

Next, sharpen the blade. A dull blade tears the grass instead of cutting it, and that ragged tip is what turns a lawn brown at the edges.

Do those two things for thirty days and you'll see the difference. That's the whole protocol — simple, repeatable, and it works.`;

function loadSlotId(i: number): number | null {
  try {
    const raw = localStorage.getItem(slotKey(i));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Same JSON format the slot's loadJobId reads — writing here + remounting the
// slot (via its React key) makes it adopt this id on the next mount.
function saveSlotId(i: number, id: number) {
  try {
    localStorage.setItem(slotKey(i), JSON.stringify(id));
  } catch {
    /* localStorage unavailable — slot just won't persist */
  }
}

export default function FaceLockVideo() {
  const [activeTab, setActiveTab] = useState("0");
  const [resumeIds, setResumeIds] = useState<(number | null)[]>(() =>
    Array.from({ length: MAX_SLOTS }, (_, i) => loadSlotId(i))
  );
  const [slotStatuses, setSlotStatuses] = useState<SlotStatus[]>(() =>
    Array.from({ length: MAX_SLOTS }, () => "idle")
  );
  // Bumped per slot to force a remount when a history job is loaded into it, so
  // the slot's useState initializer re-runs and picks up the new localStorage id.
  const [slotNonce, setSlotNonce] = useState<number[]>(() =>
    Array.from({ length: MAX_SLOTS }, () => 0)
  );
  // Per-tab "ready, go look" flag: set when a non-active tab's job reaches a
  // terminal state, cleared when that tab is opened. Drives the subtle pulse.
  const [needsAttention, setNeedsAttention] = useState<boolean[]>(() =>
    Array.from({ length: MAX_SLOTS }, () => false)
  );
  // Read inside handleStatusChange (a stable useCallback) without going stale.
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const { data: providerStatus } = trpc.provider.getStatus.useQuery();
  const { data: balance } = trpc.provider.getBalance.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: allChannels } = trpc.channelConfig.listAllChannels.useQuery();

  // Auto-resume in-flight jobs after reload: claim any active job not already
  // held by a slot's persisted id, assigning it to the next empty slot.
  const { data: activeJobs } = trpc.longformVideo.myActiveJobs.useQuery();
  useEffect(() => {
    if (!activeJobs || activeJobs.length === 0) return;
    const claimed = new Set<number>();
    for (let i = 0; i < MAX_SLOTS; i++) {
      const id = loadSlotId(i);
      if (id != null) claimed.add(id);
    }
    setResumeIds(prev => {
      const next = [...prev];
      let changed = false;
      for (const job of activeJobs) {
        if (claimed.has(job.id) || next.includes(job.id)) continue;
        const free = next.findIndex(
          (v, i) => v == null && loadSlotId(i) == null
        );
        if (free === -1) break;
        next[free] = job.id;
        claimed.add(job.id);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [activeJobs]);

  const handleStatusChange = useCallback(
    (slotIndex: number, status: SlotStatus) => {
      setSlotStatuses(prev => {
        if (prev[slotIndex] === status) return prev;
        // Flag a subtle pulse when a job on a tab we're NOT viewing just
        // reached a terminal state (completed or failed).
        const terminal = status === "completed" || status === "failed";
        if (terminal && slotIndex !== Number(activeTabRef.current)) {
          setNeedsAttention(a =>
            a[slotIndex] ? a : a.map((v, i) => (i === slotIndex ? true : v))
          );
        }
        return prev.map((s, i) => (i === slotIndex ? status : s));
      });
    },
    []
  );

  // Opening a tab stops its pulse.
  useEffect(() => {
    const idx = Number(activeTab);
    setNeedsAttention(prev =>
      prev[idx] ? prev.map((v, i) => (i === idx ? false : v)) : prev
    );
  }, [activeTab]);

  // Load a past job into a slot: prefer the first idle slot so a running job
  // isn't replaced; fall back to the active tab when all slots are busy.
  const openFromHistory = useCallback(
    (jobId: number) => {
      setSlotStatuses(statuses => {
        const idle = statuses.findIndex(s => s === "idle");
        const idx = idle === -1 ? Number(activeTabRef.current) : idle;
        saveSlotId(idx, jobId);
        setSlotNonce(n => n.map((v, i) => (i === idx ? v + 1 : v)));
        setActiveTab(String(idx));
        return statuses;
      });
    },
    [setActiveTab]
  );

  const statusIcon = (status: SlotStatus) => {
    switch (status) {
      case "processing":
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
      case "completed":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
      case "failed":
        return <XCircle className="h-3.5 w-3.5 text-red-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Film className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Long-form Video
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {balance && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/50 rounded-lg px-3 py-1.5">
              <Coins className="h-4 w-4 text-primary" />
              <span>
                {providerStatus?.providerType === "sixtynine_labs" &&
                (balance as any).dailyVideos
                  ? `${(balance as any).dailyVideos.remaining}/${(balance as any).dailyVideos.limit} daily · ${(balance as any).monthlyVideos.remaining}/${(balance as any).monthlyVideos.limit} monthly`
                  : `${balance.availableQuota} / ${balance.totalQuota} credits`}
              </span>
            </div>
          )}
          <HistoryDialog onOpen={openFromHistory} />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Generate {MAX_SLOTS} videos in parallel — each tab is its own job with
        its own script, channel, and b-roll model. They run independently and
        each consumes credits on its own.
      </p>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center gap-2">
          <TabsList>
            {Array.from({ length: MAX_SLOTS }, (_, i) => (
              <TabsTrigger
                key={i}
                value={String(i)}
                className={`gap-1.5 ${needsAttention[i] ? "tab-pulse" : ""}`}
              >
                Video {i + 1}
                {statusIcon(slotStatuses[i])}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {Array.from({ length: MAX_SLOTS }, (_, i) => (
          // forceMount keeps every slot mounted so background jobs keep polling
          // even while another tab is in view; Radix hides the inactive ones.
          <TabsContent
            key={`${i}-${slotNonce[i]}`}
            value={String(i)}
            forceMount
            className="mt-6"
          >
            <div className={activeTab === String(i) ? "" : "hidden"}>
              <LongformJobSlot
                slotIndex={i}
                storageKey={slotKey(i)}
                initialJobId={resumeIds[i]}
                defaultScript={i === 0 ? DEFAULT_SCRIPT : ""}
                channels={allChannels ?? []}
                providerDisplayName={providerStatus?.displayName}
                onStatusChange={handleStatusChange}
              />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function HistoryDialog({ onOpen }: { onOpen: (jobId: number) => void }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Admins see every user's jobs (with the maker's name); others see their own.
  const mine = trpc.longformVideo.myJobHistory.useQuery(undefined, {
    enabled: open && !isAdmin,
  });
  const all = trpc.longformVideo.allJobHistory.useQuery(undefined, {
    enabled: open && isAdmin,
  });
  const history = isAdmin ? all.data : mine.data;
  const isLoading = isAdmin ? all.isLoading : mine.isLoading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <History className="h-4 w-4" />
          History
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Video history</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : !history || history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No finished videos yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map(job => (
                <li
                  key={job.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 break-words text-sm font-medium">
                      {job.title || `Video #${job.id}`}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant={
                          job.status === "failed" ? "destructive" : "secondary"
                        }
                        className={
                          job.status === "completed"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : undefined
                        }
                      >
                        {job.status}
                      </Badge>
                      {isAdmin && job.userName && (
                        <span className="font-medium text-foreground">
                          {job.userName}
                        </span>
                      )}
                      {job.channelKey && <span>{job.channelKey}</span>}
                      <span>{new Date(job.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => {
                      onOpen(job.id);
                      setOpen(false);
                    }}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

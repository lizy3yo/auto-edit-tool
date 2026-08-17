import { useState, useEffect, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LongformJobSlot, { type SlotStatus } from "@/components/LongformJobSlot";
import { VideoLibraryPanel } from "@/components/VideoLibraryPanel";
import { Loader2, CheckCircle2, XCircle, Coins, Film } from "lucide-react";

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

/**
 * The five tabs live in the database (`longform_slots`), not `localStorage`.
 *
 * They used to be device-local, which meant signing in on another machine gave you five empty
 * tabs even though every render was already a row in MySQL with its media on R2. The videos
 * were never at risk — only the workspace failed to travel. `longformVideo.getSlots` /
 * `setSlot` now carry it, so the same account picks up where it left off on any PC.
 */

export default function FaceLockVideo() {
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState("0");
  // Null until the server's slots arrive. Tabs mount immediately either way and adopt a late
  // id (see `LongformJobSlot`'s resume effect), so this only decides whether a tab starts
  // empty or restored.
  const [resumeIds, setResumeIds] = useState<(number | null)[] | null>(null);
  const [draftTitles, setDraftTitles] = useState<string[]>(() =>
    Array.from({ length: MAX_SLOTS }, () => "")
  );

  const {
    data: savedSlots,
    // `isLoadingError`, not `isError`: only a workspace that never loaded is worth warning
    // about. A refetch that fails while the tabs are already on screen changes nothing.
    isLoadingError: slotsUnavailable,
    error: slotsError,
  } = trpc.longformVideo.getSlots.useQuery(undefined, {
    // `tsx watch` restarts the server on every save, so requests get dropped routinely in a
    // dev session. This used to be `retry: false`, which turned a two-second restart into a
    // permanently empty workspace and a migration warning for an up-to-date schema.
    retry: 3,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 4000),
  });

  // Set once the workspace is settled — either the server's slots were adopted, or the user
  // moved a tab first. Until then a late `getSlots` may still fill the tabs in; after it, it
  // must never overwrite what is on screen (including this page's own refetches).
  const workspaceSettled = useRef(false);
  useEffect(() => {
    if (!savedSlots || workspaceSettled.current) return;
    workspaceSettled.current = true;
    setResumeIds(savedSlots.map(s => s.jobId));
    setDraftTitles(prev =>
      prev.some(Boolean) ? prev : savedSlots.map(s => s.draftTitle)
    );
  }, [savedSlots]);

  useEffect(() => {
    // The saved workspace is a convenience, never a prerequisite: fall back to empty tabs so
    // the generator still works — leaving `resumeIds` null made every open silently no-op.
    // Deliberately does NOT settle the workspace, so slots that arrive on a later refetch are
    // still adopted rather than discarded — that discard is what actually lost the tabs.
    if (slotsUnavailable) {
      setResumeIds(
        prev => prev ?? Array.from({ length: MAX_SLOTS }, () => null)
      );
    }
  }, [slotsUnavailable]);

  const { mutate: setSlotMutate } = trpc.longformVideo.setSlot.useMutation({
    onSuccess: () => void utils.longformVideo.getSlots.invalidate(),
  });
  /** Write one tab through to the DB. Fire-and-forget: local state already moved. */
  const persistSlot = useCallback(
    (
      slotIndex: number,
      patch: { jobId?: number | null; draftTitle?: string | null }
    ) => {
      // What's on screen is the truth from here on, so a `getSlots` result landing later
      // (this mutation's own invalidation included) must not overwrite it.
      workspaceSettled.current = true;
      setSlotMutate({ slotIndex, ...patch });
    },
    [setSlotMutate]
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
  // Same reason: `openFromHistory` needs the current slot ids to detect an already-open job
  // without taking `resumeIds` as a dependency (which would re-create the callback on every
  // status change and re-fire the `?open=` effect).
  const resumeIdsRef = useRef(resumeIds);
  useEffect(() => {
    resumeIdsRef.current = resumeIds;
  }, [resumeIds]);
  // `claimSlot` needs the live statuses without depending on them (which would make every
  // callback below unstable and re-fire the `?open=` effect on each status tick).
  const slotStatusesRef = useRef<SlotStatus[]>(
    Array.from({ length: MAX_SLOTS }, () => "idle")
  );

  const { data: providerStatus } = trpc.provider.getStatus.useQuery();
  const { data: balance } = trpc.provider.getBalance.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: allChannels } = trpc.channelConfig.listAllChannels.useQuery();

  // Auto-resume in-flight jobs: claim any active job no tab already holds into the next
  // empty one. Still useful with server-side slots — a render started on another machine (or
  // one whose tab was cleared) otherwise has no tab here.
  const { data: activeJobs } = trpc.longformVideo.myActiveJobs.useQuery();
  useEffect(() => {
    if (!activeJobs || activeJobs.length === 0 || !resumeIds) return;
    setResumeIds(prev => {
      if (!prev) return prev;
      const next = [...prev];
      let changed = false;
      for (const job of activeJobs) {
        if (next.includes(job.id)) continue;
        const free = next.findIndex(v => v == null);
        if (free === -1) break;
        next[free] = job.id;
        persistSlot(free, { jobId: job.id });
        changed = true;
      }
      return changed ? next : prev;
    });
    // `resumeIds` is read through the guard above only to know slots have loaded; adding it
    // to the deps would re-run this on every claim and fight its own setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobs, !!resumeIds, persistSlot]);

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
        const next = prev.map((s, i) => (i === slotIndex ? status : s));
        slotStatusesRef.current = next;
        return next;
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
  //
  // Reads state through refs and performs its writes at the top level. The previous version
  // did all of this INSIDE a `setSlotStatuses` updater, which is impure — React may invoke an
  // updater more than once (it does in StrictMode), so every click fired the persist mutation
  // twice and bumped the remount nonce by two.
  const claimSlot = useCallback(() => {
    const idle = slotStatusesRef.current.findIndex(s => s === "idle");
    return idle === -1 ? Number(activeTabRef.current) : idle;
  }, []);

  /**
   * Bring the storyboard into view after a slot adopts a job. The scenes render only once
   * the first poll returns, so this retries briefly rather than scrolling to nothing — and
   * gives up quietly if the job has no storyboard (a render that failed before storyboarding).
   */
  const scrollToStoryboard = useCallback((idx: number) => {
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(`storyboard-${idx}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (++tries < 40) setTimeout(tick, 100); // ~4s, then stop
    };
    setTimeout(tick, 100);
  }, []);

  const openFromHistory = useCallback(
    (jobId: number) => {
      // Already open in a slot? Just go there — re-loading it would pointlessly
      // remount a slot that is already showing this job (and may be mid-render).
      const existing = (resumeIdsRef.current ?? []).findIndex(
        id => id === jobId
      );
      if (existing !== -1) {
        setActiveTab(String(existing));
        scrollToStoryboard(existing);
        return;
      }
      const idx = claimSlot();
      persistSlot(idx, { jobId });
      setResumeIds(prev => {
        // Before `getSlots` resolves this is still null. Seeding a fresh array rather than
        // bailing out is the fix for clicks that used to be silently dropped on a cold load
        // — the id was discarded and the slot remounted empty.
        const base = prev ?? Array.from({ length: MAX_SLOTS }, () => null);
        return base.map((v, i) => (i === idx ? jobId : v));
      });
      setSlotNonce(n => n.map((v, i) => (i === idx ? v + 1 : v)));
      setActiveTab(String(idx));
      scrollToStoryboard(idx);
    },
    [setActiveTab, persistSlot, claimSlot, scrollToStoryboard]
  );

  /**
   * A deleted video must not stay loaded in a tab. The server already nulled the slot row, so
   * this is the live half: reset the tab in place (no focus change — the delete happened over
   * in the panel, and yanking the active tab would be a second surprise).
   */
  const handleJobDeleted = useCallback(
    (jobId: number) => {
      const idx = (resumeIdsRef.current ?? []).findIndex(id => id === jobId);
      if (idx === -1) return;
      // No `persistSlot` here (the server already nulled the row), so claim the workspace
      // explicitly — otherwise a slot list still in flight could put the deleted job back.
      workspaceSettled.current = true;
      setResumeIds(prev => {
        const base = prev ?? Array.from({ length: MAX_SLOTS }, () => null);
        return base.map((v, i) => (i === idx ? null : v));
      });
      setDraftTitles(prev => prev.map((v, i) => (i === idx ? "" : v)));
      setSlotNonce(n => n.map((v, i) => (i === idx ? v + 1 : v)));
    },
    [setDraftTitles]
  );

  /** Clear a slot back to an empty form and focus it — the panel's "+ New". */
  const handleNewVideo = useCallback(() => {
    const idx = claimSlot();
    persistSlot(idx, { jobId: null, draftTitle: null });
    setResumeIds(prev => {
      const base = prev ?? Array.from({ length: MAX_SLOTS }, () => null);
      return base.map((v, i) => (i === idx ? null : v));
    });
    setDraftTitles(prev => prev.map((v, i) => (i === idx ? "" : v)));
    setSlotNonce(n => n.map((v, i) => (i === idx ? v + 1 : v)));
    setActiveTab(String(idx));
  }, [setActiveTab, persistSlot, claimSlot]);

  // Deep link from the Library page: `/?open=<jobId>` loads that job into a slot, then
  // strips the param so a reload doesn't re-open it over whatever you moved on to.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("open");
    const jobId = param ? Number(param) : NaN;
    if (Number.isInteger(jobId)) {
      openFromHistory(jobId);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [openFromHistory]);

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

  // Banner only — the render itself reads the setting server-side, so a stale client can
  // never cause a real spend it didn't warn about.
  const { data: mockMode } = trpc.longformVideo.getMockMode.useQuery();

  return (
    <div className="flex items-start gap-6">
      <VideoLibraryPanel
        onOpen={openFromHistory}
        onNew={handleNewVideo}
        onDeleted={handleJobDeleted}
        activeJobIds={resumeIds ?? []}
      />
      <div className="min-w-0 flex-1 space-y-6">
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
          </div>
        </div>

        {slotsUnavailable && (
          <div className="rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="font-medium">Workspace sync is unavailable.</span>{" "}
            Tabs still work, but this session can't restore or remember which
            job each one holds. It clears itself as soon as the server answers —
            if it persists, the server log names the cause (a stale schema is
            reported there by name).
            {slotsError?.message && (
              <span className="text-muted-foreground">
                {" "}
                ({slotsError.message})
              </span>
            )}
          </div>
        )}

        {mockMode?.enabled && (
          <div className="rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm">
            <span className="font-medium">Mock mode is ON.</span> Renders are
            free and produce placeholder footage — no credits are spent and no
            provider is contacted. Turn it off in Admin → Provider Keys before a
            real run.
          </div>
        )}

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
                  initialJobId={resumeIds?.[i] ?? null}
                  initialTitle={draftTitles[i] ?? ""}
                  onTitleChange={title => {
                    setDraftTitles(prev =>
                      prev.map((v, j) => (j === i ? title : v))
                    );
                    persistSlot(i, { draftTitle: title });
                  }}
                  onJobIdChange={jobId => {
                    setResumeIds(prev =>
                      prev ? prev.map((v, j) => (j === i ? jobId : v)) : prev
                    );
                    persistSlot(i, { jobId });
                  }}
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
    </div>
  );
}

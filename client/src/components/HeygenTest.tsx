import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  countScriptWords,
  estimateTestSeconds,
  HEYGEN_TEST_MAX_IMAGES,
  HEYGEN_TEST_MAX_WORDS,
  friendlyHeygenTestError,
  HEYGEN_TEST_MAX_NAME,
  HEYGEN_TEST_RUNS_PER_PAGE,
  heygenTestInputError,
  pageList,
  heygenTestProgress,
} from "@shared/heygenTest";
import { ROLE_LABEL } from "@shared/roles";

/**
 * HeyGen test bench (`/heygen-test`) — which host photo makes the best talking head, before a film pays for it.
 *
 * One script, voiced once in a channel's own voice, lip-synced onto up to four photos. The audio
 * is identical across the clips, so the photo is the only thing being compared. Every clip is a
 * real, billed HeyGen render (the production call), capped at 30 s. Runs are shared between
 * admins and operations managers, so a result someone else produced is there to compare against.
 */

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
// The results filters sit in one row, so they size to their content instead of filling it.
const filterSelectClass =
  "h-9 w-auto rounded-md border border-input bg-background px-2 text-sm";

type Vendor = "sixtynine_labs" | "minimax";

export function HeygenTest() {
  const utils = trpc.useUtils();
  const { data: channels } = trpc.channelConfig.list.useQuery();
  const accountsLive = useLiveHeygenAccounts();
  const { data: accountInfo } = trpc.heygenTest.accounts.useQuery(undefined, {
    // The live stream keeps this current; poll only while it is reconnecting.
    refetchInterval: accountsLive ? false : 30_000,
  });
  const [channelKey, setChannelKey] = useState("");
  const [vendor, setVendor] = useState<Vendor>("sixtynine_labs");
  const [account, setAccount] = useState<string>("");
  const [script, setScript] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [runName, setRunName] = useState("");
  // Results page, lifted here so a new run can bring the list back to page 1 where it lands.
  const [page, setPage] = useState(1);

  const channel = channels?.find(c => c.channelKey === channelKey);
  const voiced = (channels ?? []).filter(c => c.voiceId || c.minimaxVoiceId);
  // Only FREE accounts are listed. A pick that just became busy falls back to the first free one.
  const accounts = accountInfo?.available ?? [];
  const allBusy =
    !!accountInfo && accountInfo.configured > 0 && !accounts.length;
  const accountValue = accounts.some(a => String(a.account) === account)
    ? account
    : accounts[0]
      ? String(accounts[0].account)
      : "";
  // A channel with only one vendor's voice gets that vendor; the chooser shows only with both.
  const effectiveVendor: Vendor =
    channel && !channel.voiceId && channel.minimaxVoiceId
      ? "minimax"
      : channel && !channel.minimaxVoiceId
        ? "sixtynine_labs"
        : vendor;

  const { data: libraryPhotos } = trpc.channelHostPhoto.list.useQuery(
    { channelKey, activeOnly: true },
    { enabled: !!channelKey }
  );

  const upload = trpc.styleReference.upload.useMutation({
    onSuccess: ({ url }) => addImage(url),
    onError: err => toast.error(err.message),
  });

  const start = trpc.heygenTest.start.useMutation({
    onSuccess: () => {
      toast.success("Test started — voicing, then rendering on HeyGen.");
      setImageUrls([]);
      setRunName("");
      setPage(1);
      utils.heygenTest.list.invalidate();
      utils.heygenTest.runners.invalidate();
      utils.heygenTest.channels.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  function addImage(url: string) {
    setImageUrls(prev =>
      prev.includes(url) || prev.length >= HEYGEN_TEST_MAX_IMAGES
        ? prev
        : [...prev, url]
    );
  }

  const words = countScriptWords(script);
  const estSec = estimateTestSeconds(script);
  const rate = accountInfo?.ratePerSec ?? 0;
  const inputError = heygenTestInputError({ script, imageUrls });
  const blocker = !accountValue
    ? allBusy
      ? "Waiting for a HeyGen account to free up."
      : "No HeyGen account has a key — add one in Provider keys."
    : inputError;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Video className="h-4 w-4" />
            New test
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Voice (channel)</Label>
              <select
                className={selectClass}
                value={channelKey}
                onChange={e => setChannelKey(e.target.value)}
              >
                <option value="">Pick a channel…</option>
                {voiced.map(c => (
                  <option key={c.channelKey} value={c.channelKey}>
                    {c.displayName ?? c.channelKey}
                  </option>
                ))}
              </select>
            </div>
            {channel?.voiceId && channel?.minimaxVoiceId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Voice provider</Label>
                <select
                  className={selectClass}
                  value={vendor}
                  onChange={e => setVendor(e.target.value as Vendor)}
                >
                  <option value="sixtynine_labs">69Labs</option>
                  <option value="minimax">MiniMax</option>
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">HeyGen account</Label>
              <Select
                value={accountValue}
                onValueChange={setAccount}
                disabled={accounts.length === 0}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue
                    placeholder={
                      allBusy ? "No account free right now" : "No keys set"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem
                      key={String(a.account)}
                      value={String(a.account)}
                    >
                      <span>{a.label}</span>
                      <Badge
                        variant="outline"
                        className="border-success/30 bg-success/10 text-success"
                      >
                        Available
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {allBusy && (
            <Alert tone="warning" title="All HeyGen accounts are in use" />
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">
              Photos ({imageUrls.length}/{HEYGEN_TEST_MAX_IMAGES})
            </Label>
            <div className="flex flex-wrap gap-2">
              {imageUrls.map(url => (
                <div key={url} className="relative">
                  <img
                    src={url}
                    alt=""
                    className="h-24 w-24 rounded border border-border object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5"
                    onClick={() =>
                      setImageUrls(prev => prev.filter(u => u !== url))
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {imageUrls.length < HEYGEN_TEST_MAX_IMAGES && (
                <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-border text-[11px] text-muted-foreground hover:bg-muted">
                  {upload.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                  {upload.isPending ? "Uploading…" : "Upload"}
                  <input
                    type="file"
                    accept={ACCEPTED.join(",")}
                    className="hidden"
                    disabled={upload.isPending}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      if (!ACCEPTED.includes(file.type))
                        return toast.error("Use a JPG, PNG, or WEBP image.");
                      if (file.size > 10 * 1024 * 1024)
                        return toast.error("Image must be under 10 MB");
                      const reader = new FileReader();
                      reader.onload = () =>
                        upload.mutate({ dataUrl: reader.result as string });
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              )}
            </div>
            {!!libraryPhotos?.length && (
              <div className="space-y-1 pt-1">
                <p className="text-[11px] text-muted-foreground">
                  Or add from this channel&apos;s host photos:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {libraryPhotos.map(p => {
                    const picked = imageUrls.includes(p.imageUrl);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={
                          picked || imageUrls.length >= HEYGEN_TEST_MAX_IMAGES
                        }
                        onClick={() => addImage(p.imageUrl)}
                        className="rounded border border-border disabled:opacity-40"
                        title={picked ? "Already in the run" : "Add to the run"}
                      >
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="h-12 w-12 rounded object-cover"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="heygen-run-name">
              Run name <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="heygen-run-name"
              value={runName}
              maxLength={HEYGEN_TEST_MAX_NAME}
              onChange={e => setRunName(e.target.value)}
              placeholder="e.g. Granny Mae — kitchen vs porch"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Script</Label>
            <Textarea
              rows={4}
              value={script}
              onChange={e => setScript(e.target.value)}
              placeholder="What the host says — about 30 seconds at most."
            />
            <p
              className={`text-[11px] ${words > HEYGEN_TEST_MAX_WORDS ? "text-destructive" : "text-muted-foreground"}`}
            >
              {words}/{HEYGEN_TEST_MAX_WORDS} words · about {Math.round(estSec)}{" "}
              s
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!channelKey || !!blocker || start.isPending}
              onClick={() =>
                start.mutate({
                  channelKey,
                  ttsVendor: effectiveVendor,
                  account:
                    accountValue === "shared" ? "shared" : Number(accountValue),
                  script,
                  imageUrls,
                  name: runName.trim() || undefined,
                })
              }
            >
              {start.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Generate{" "}
              {imageUrls.length > 1 ? `${imageUrls.length} clips` : "clip"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {blocker ??
                `About $${(imageUrls.length * Math.max(estSec, 1) * rate).toFixed(2)} on HeyGen (${imageUrls.length} × ~${Math.round(estSec)} s)`}
            </span>
          </div>
        </CardContent>
      </Card>

      <HeygenTestResults page={page} onPageChange={setPage} />
    </div>
  );
}

/**
 * Subscribes to the server's live account stream (`/api/heygen-test/accounts/stream`) and writes
 * each push straight into the `heygenTest.accounts` query cache, so the picker changes the moment
 * a film starts or finishes. Returns whether the stream is connected; while it is not, the query
 * polls instead. EventSource reconnects on its own after a drop.
 */
function useLiveHeygenAccounts(): boolean {
  const utils = trpc.useUtils();
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/heygen-test/accounts/stream");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener("accounts", e => {
      try {
        utils.heygenTest.accounts.setData(
          undefined,
          JSON.parse((e as MessageEvent).data)
        );
      } catch {
        // A malformed push is ignored; the next one (or the fallback poll) corrects it.
      }
    });
    return () => es.close();
  }, [utils]);
  return live;
}

const STATUS_LABEL: Record<string, string> = {
  voicing: "Voicing",
  rendering: "Rendering on HeyGen",
  done: "Done",
  failed: "Failed",
};

function HeygenTestResults({
  page,
  onPageChange,
}: {
  page: number;
  onPageChange: (page: number) => void;
}) {
  const utils = trpc.useUtils();
  const { data: channels } = trpc.channelConfig.list.useQuery();
  const { data: runners } = trpc.heygenTest.runners.useQuery();
  const { data: testedChannelKeys } = trpc.heygenTest.channels.useQuery();
  // Only channels that have test runs, by their display name.
  const testedChannels = useMemo(
    () =>
      (testedChannelKeys ?? [])
        .map(key => ({
          key,
          name: channels?.find(c => c.channelKey === key)?.displayName ?? key,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [testedChannelKeys, channels]
  );
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [runnerFilter, setRunnerFilter] = useState("");
  const filtered = !!search || !!channelFilter || !!runnerFilter;

  // Search as you type, without a request per keystroke; a new search starts at page 1.
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchText.trim() !== search) {
        setSearch(searchText.trim());
        onPageChange(1);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [searchText, search, onPageChange]);

  const { data, isLoading, isFetching } = trpc.heygenTest.list.useQuery(
    {
      page,
      search: search || undefined,
      channelKey: channelFilter || undefined,
      userId: runnerFilter ? Number(runnerFilter) : undefined,
    },
    {
      // Keep the current page on screen while the next one loads, instead of a blank flash.
      placeholderData: keepPreviousData,
      // Poll only while something on this page is still working.
      refetchInterval: query =>
        query.state.data?.rows.some(
          r => r.status === "voicing" || r.status === "rendering"
        )
          ? 5_000
          : false,
    }
  );
  const rows = data?.rows;
  const totalRuns = data?.totalRuns ?? 0;
  const pageCount = data?.pageCount ?? 1;

  // A delete (or a filter) can leave you past the last page — step back to it.
  useEffect(() => {
    if (data && page > data.pageCount) onPageChange(data.pageCount);
  }, [data, page, onPageChange]);

  const clearFilters = () => {
    setSearchText("");
    setSearch("");
    setChannelFilter("");
    setRunnerFilter("");
    onPageChange(1);
  };

  const rename = trpc.heygenTest.rename.useMutation({
    onSuccess: () => utils.heygenTest.list.invalidate(),
    onError: err => toast.error(err.message),
  });
  // The run awaiting delete confirmation; null while no dialog is open.
  const [pendingDelete, setPendingDelete] = useState<{
    batchId: string;
    imageUrls: string[];
    running: boolean;
  } | null>(null);
  const remove = trpc.heygenTest.deleteBatch.useMutation({
    onSuccess: () => {
      toast.success("Test run deleted.");
      setPendingDelete(null);
      utils.heygenTest.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const retry = trpc.heygenTest.retry.useMutation({
    onSuccess: ({ retried }) => {
      toast.success(
        retried === 1 ? "Retrying 1 clip." : `Retrying ${retried} clips.`
      );
      utils.heygenTest.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });
  // Ticks once a second while anything runs, so the bars move between polls.
  const running = !!rows?.some(
    r => r.status === "voicing" || r.status === "rendering"
  );
  const now = useNow(running);

  const batches = useMemo(() => {
    type Row = NonNullable<typeof rows>[number];
    const byBatch = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const list = byBatch.get(r.batchId) ?? [];
      list.push(r);
      byBatch.set(r.batchId, list);
    }
    // Newest run first; within a run, the photos in the order they were added.
    return Array.from(byBatch.values())
      .map(list => [...list].sort((a, b) => a.id - b.id))
      .sort((a, b) => b[b.length - 1].id - a[a.length - 1].id);
  }, [rows]);

  if (isLoading)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading tests…
      </div>
    );
  if (totalRuns === 0 && !filtered)
    return (
      <p className="text-sm italic text-muted-foreground">
        No tests yet. Results show here, side by side.
      </p>
    );

  const firstShown = (page - 1) * HEYGEN_TEST_RUNS_PER_PAGE + 1;
  const lastShown = Math.min(page * HEYGEN_TEST_RUNS_PER_PAGE, totalRuns);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search run name or script"
            className="pl-8"
            aria-label="Search run name or script"
          />
        </div>
        <select
          className={`${filterSelectClass} min-w-[150px]`}
          value={channelFilter}
          aria-label="Channel"
          onChange={e => {
            setChannelFilter(e.target.value);
            onPageChange(1);
          }}
        >
          <option value="">All channels</option>
          {testedChannels.map(c => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={`${filterSelectClass} min-w-[140px]`}
          value={runnerFilter}
          aria-label="Run by"
          onChange={e => {
            setRunnerFilter(e.target.value);
            onPageChange(1);
          }}
        >
          <option value="">Anyone</option>
          {(runners ?? []).map(u => (
            <option key={u.id} value={String(u.id)}>
              {u.name}
            </option>
          ))}
        </select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        )}
      </div>

      {batches.length === 0 && (
        <p className="text-sm italic text-muted-foreground">
          No runs match these filters.
        </p>
      )}

      {batches.map(batch => {
        const first = batch[0];
        const cost = batch.reduce((s, r) => s + r.costUsd, 0);
        const failedCount = batch.filter(r => r.status === "failed").length;
        return (
          <Card key={first.batchId}>
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <RunName
                    name={first.runName}
                    saving={rename.isPending}
                    onSave={name =>
                      rename.mutate({ batchId: first.batchId, name })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Run by{" "}
                    <span className="font-medium text-foreground">
                      {first.userName ?? "a removed account"}
                    </span>
                    {first.userRole ? ` (${ROLE_LABEL[first.userRole]})` : ""}
                    {" · "}
                    <time dateTime={new Date(first.createdAt).toISOString()}>
                      {formatRunDate(first.createdAt)}
                    </time>
                    {" · "}
                    {first.channelKey}
                    {cost > 0 ? ` · $${cost.toFixed(2)}` : ""}
                  </p>
                  <p className="line-clamp-2 text-sm">“{first.script}”</p>
                  {first.audioUrl && (
                    <audio
                      controls
                      preload="none"
                      src={first.audioUrl}
                      className="h-8"
                    />
                  )}
                </div>
                {failedCount > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate({ batchId: first.batchId })}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Retry all failed ({failedCount})
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  aria-label="Delete this test run"
                  disabled={remove.isPending}
                  onClick={() =>
                    setPendingDelete({
                      batchId: first.batchId,
                      imageUrls: batch.map(r => r.imageUrl),
                      running: batch.some(
                        r => r.status === "voicing" || r.status === "rendering"
                      ),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {batch.map(r => {
                  const progress = heygenTestProgress(
                    {
                      ...r,
                      phaseStartedAt: r.phaseStartedAt ?? r.updatedAt,
                    },
                    now,
                    estimateTestSeconds(r.script)
                  );
                  return (
                    <div
                      key={r.id}
                      className="space-y-2 rounded-md border border-border p-2"
                    >
                      {r.status === "done" && r.videoUrl ? (
                        <video
                          controls
                          preload="metadata"
                          src={r.videoUrl}
                          poster={r.imageUrl}
                          className="aspect-video w-full rounded bg-black object-contain"
                        />
                      ) : (
                        <img
                          src={r.imageUrl}
                          alt=""
                          className="aspect-video w-full rounded bg-muted object-contain"
                        />
                      )}
                      {progress ? (
                        <div className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="font-medium">
                              {progress.label}
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {progress.percent}%
                            </span>
                          </div>
                          <Progress
                            value={progress.percent}
                            className="h-1.5"
                            aria-label={`${progress.label}: ${progress.percent}%`}
                          />
                          <p className="text-[11px] text-muted-foreground">
                            {progress.overdue
                              ? "Taking longer than usual…"
                              : `About ${formatEta(progress.etaSec)} left`}
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant={
                              r.status === "failed"
                                ? "destructive"
                                : r.status === "done"
                                  ? "default"
                                  : "secondary"
                            }
                          >
                            {STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                          {r.status === "failed" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={retry.isPending}
                              onClick={() =>
                                retry.mutate({
                                  batchId: r.batchId,
                                  ids: [r.id],
                                })
                              }
                            >
                              <RotateCcw className="mr-1 h-3 w-3" />
                              Retry
                            </Button>
                          ) : (
                            r.costUsd > 0 && (
                              <span className="text-[11px] text-muted-foreground">
                                ${r.costUsd.toFixed(2)}
                              </span>
                            )
                          )}
                        </div>
                      )}
                      {r.error && (
                        // Plain language on the card; the technical original on hover.
                        <p
                          className="break-words text-[11px] text-destructive"
                          title={r.error}
                        >
                          {friendlyHeygenTestError(r.error)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {totalRuns > 0 && (
        <nav
          aria-label="Test runs pages"
          className="flex flex-wrap items-center justify-between gap-3 pt-1"
        >
          <p className="text-xs text-muted-foreground">
            Showing {firstShown}–{lastShown} of {totalRuns}{" "}
            {totalRuns === 1 ? "run" : "runs"}
            {isFetching && (
              <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" />
            )}
          </p>
          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              {pageList(page, pageCount).map((p, i) =>
                p === "…" ? (
                  <span
                    key={`gap-${i}`}
                    className="px-1.5 text-sm text-muted-foreground"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? "default" : "ghost"}
                    size="sm"
                    className="h-8 min-w-8 px-2 tabular-nums"
                    aria-current={p === page ? "page" : undefined}
                    onClick={() => onPageChange(p)}
                  >
                    {p}
                  </Button>
                )
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={page >= pageCount}
                onClick={() => onPageChange(page + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </nav>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open && !remove.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this test run?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.imageUrls.length === 1
                ? "Its clip is removed from this page."
                : `All ${pendingDelete?.imageUrls.length ?? 0} of its clips are removed from this page.`}{" "}
              This can&apos;t be undone.
              {pendingDelete?.running &&
                " Clips still rendering will finish on HeyGen and are still charged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-wrap gap-2">
            {pendingDelete?.imageUrls.map(url => (
              <img
                key={url}
                src={url}
                alt=""
                className="h-16 w-16 rounded border border-border object-cover"
              />
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={e => {
                // Keep the dialog open until the delete lands, so a failure is seen in context.
                e.preventDefault();
                if (pendingDelete)
                  remove.mutate({ batchId: pendingDelete.batchId });
              }}
            >
              {remove.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** `Date.now()`, re-read every second while `active` — drives the progress bars between polls. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** "Sep 25, 2026 at 12:22 AM" — in the viewer's own timezone. */
function formatRunDate(at: Date | string): string {
  const d = new Date(at);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** "45 s", "2 min" — the precision an estimate deserves. */
function formatEta(sec: number): string {
  if (sec < 60) return `${Math.max(5, Math.round(sec / 5) * 5)} s`;
  return `${Math.round(sec / 60)} min`;
}

/**
 * A run's name, renamable in place. Unnamed runs offer "Add a name"; Enter saves, Escape cancels,
 * and saving a blank name clears it.
 */
function RunName({
  name,
  saving,
  onSave,
}: {
  name: string | null;
  saving: boolean;
  onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing)
    return (
      <form
        className="flex max-w-md items-center gap-1"
        onSubmit={e => {
          e.preventDefault();
          if (draft.trim() !== (name ?? "")) onSave(draft);
          setEditing(false);
        }}
      >
        <Input
          autoFocus
          value={draft}
          maxLength={HEYGEN_TEST_MAX_NAME}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="Name this run"
          className="h-8"
          aria-label="Run name"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label="Save name"
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label="Cancel"
          onClick={() => setEditing(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </form>
    );

  return (
    <div className="flex items-center gap-1">
      {name ? <p className="truncate text-sm font-semibold">{name}</p> : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={
          name
            ? "h-7 w-7 p-0 text-muted-foreground"
            : "-ml-2 h-7 px-2 text-xs text-muted-foreground"
        }
        disabled={saving}
        aria-label={name ? "Rename run" : "Add a name"}
        onClick={() => {
          setDraft(name ?? "");
          setEditing(true);
        }}
      >
        <Pencil className="h-3.5 w-3.5" />
        {!name && <span className="ml-1">Add a name</span>}
      </Button>
    </div>
  );
}

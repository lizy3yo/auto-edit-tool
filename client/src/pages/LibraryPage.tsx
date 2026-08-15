import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VideoPoster } from "@/components/VideoPoster";
import { downloadFile } from "@/lib/download";
import {
  Loader2,
  Plus,
  Search,
  Tv,
  Download,
  Pencil,
  CheckCircle2,
  XCircle,
} from "lucide-react";

/**
 * Every render as a browsable grid — the counterpart to the side panel, for when you want to
 * find something rather than glance at it.
 *
 * "Open" routes back to the generator and loads the job into a slot, via a `?open=<id>` query
 * param the Long-form page consumes on mount. A query param rather than shared state so the
 * link survives a reload and can be pasted.
 */
export default function LibraryPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("all");

  const { data: jobs, isLoading } = trpc.longformVideo.library.useQuery(
    undefined,
    { refetchInterval: 20_000 }
  );
  const { data: channels } = trpc.channelConfig.listAllChannels.useQuery();

  const channelName = useMemo(() => {
    const map = new Map((channels ?? []).map(c => [c.key, c.name]));
    return (key: string | null) => (key ? (map.get(key) ?? key) : null);
  }, [channels]);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = search.trim().toLowerCase();
    return jobs.filter(job => {
      if (channel !== "all" && job.channelKey !== channel) return false;
      if (!q) return true;
      return [
        job.title,
        channelName(job.channelKey),
        job.userName,
        `#${job.id}`,
      ]
        .filter(Boolean)
        .some(field => String(field).toLowerCase().includes(q));
    });
  }, [jobs, search, channel, channelName]);

  // Only offer channels that actually have videos — a filter that returns nothing is noise.
  const usedChannels = useMemo(() => {
    const keys = new Set(
      (jobs ?? []).map(j => j.channelKey).filter((k): k is string => !!k)
    );
    return (channels ?? []).filter(c => keys.has(c.key));
  }, [jobs, channels]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Your Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobs?.length ?? 0} video{jobs?.length === 1 ? "" : "s"} — open one
            to keep working, or start a new render.
          </p>
        </div>
        <Button onClick={() => navigate("/")} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New video
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, channel or maker…"
            className="pl-9"
          />
        </div>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-56">
            <Tv className="mr-2 h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              All channels ({jobs?.length ?? 0})
            </SelectItem>
            {usedChannels.map(c => (
              <SelectItem key={c.key} value={c.key}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading library…
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-20 text-center text-sm text-muted-foreground">
          {jobs?.length
            ? "No videos match that search."
            : "No videos yet. Generate one and it shows up here."}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {filtered.map(job => (
            <article
              key={job.id}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40"
            >
              <div className="relative">
                <VideoPoster
                  posterUrl={job.posterUrl}
                  finalVideoUrl={job.finalVideoUrl}
                  status={job.status}
                  className="aspect-video w-full"
                />
                <StatusBadge status={job.status} />
              </div>

              <div className="flex flex-1 flex-col gap-1 p-3">
                <h2 className="line-clamp-2 text-sm font-medium leading-snug">
                  {job.title || `Video #${job.id}`}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {channelName(job.channelKey) ?? "No channel"}
                  {job.userName ? ` · ${job.userName}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(job.createdAt).toLocaleDateString()}
                </p>

                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5"
                    onClick={() => navigate(`/?open=${job.id}`)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Open
                  </Button>
                  {job.finalVideoUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1.5"
                      onClick={() =>
                        downloadFile(
                          job.finalVideoUrl!,
                          "video",
                          job.title || undefined
                        )
                      }
                    >
                      <Download className="h-3.5 w-3.5" />
                      Save
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "processing" | "completed" | "failed";
}) {
  const base =
    "absolute left-2 top-2 flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium backdrop-blur";
  if (status === "processing") {
    return (
      <span className={`${base} bg-primary/20 text-primary`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Generating…
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={`${base} bg-red-500/20 text-red-400`}>
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span className={`${base} bg-emerald-500/20 text-emerald-400`}>
      <CheckCircle2 className="h-3 w-3" />
      Ready
    </span>
  );
}

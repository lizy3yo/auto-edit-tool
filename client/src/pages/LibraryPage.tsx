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
import {
  VideoPlayerDialog,
  type PlayableJob,
} from "@/components/VideoPlayerDialog";
import {
  DeleteVideoDialog,
  type DeletableJob,
} from "@/components/DeleteVideoDialog";
import { GenerationCostDialog } from "@/components/GenerationCostDialog";
import { downloadFile } from "@/lib/download";
import { PageHeader } from "@/components/PageHeader";
import {
  Loader2,
  LibraryBig,
  Plus,
  Search,
  Tv,
  Download,
  Pencil,
  Play,
  Trash2,
  CheckCircle2,
  XCircle,
  Receipt,
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
  const [playing, setPlaying] = useState<PlayableJob | null>(null);
  const [deleting, setDeleting] = useState<DeletableJob | null>(null);
  const [costJobId, setCostJobId] = useState<number | null>(null);
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
      <PageHeader
        icon={LibraryBig}
        title="Your library"
        description={`${jobs?.length ?? 0} video${jobs?.length === 1 ? "" : "s"} — open one to keep working, or start a new render.`}
        actions={
          <Button onClick={() => navigate("/")} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New video
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        {/* `min-w-64` unconditionally was 256px of hard floor — wider than the content
            column on the narrowest phones, so the field itself forced a sideways scroll.
            Full-width row of its own below `sm`, flexible beside the filter above it. */}
        <div className="relative w-full min-w-0 flex-1 sm:w-auto sm:min-w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, channel or maker…"
            className="pl-9"
          />
        </div>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-full sm:w-56">
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
        // Explicit breakpoints rather than auto-fill: caps out at 3 per row on large
        // screens so cards stay a proper size instead of auto-packing many narrow ones.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(job => (
            <article
              key={job.id}
              // Hover lifts rather than tinting the border: on white a 40%-primary
              // hairline is a colour most people won't register as a state change.
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
            >
              <button
                type="button"
                onClick={() => setPlaying(job)}
                title="Play"
                className="group/play relative block w-full"
              >
                <VideoPoster
                  posterUrl={job.posterUrl}
                  finalVideoUrl={job.finalVideoUrl}
                  status={job.status}
                  className="aspect-video w-full"
                />
                <StatusBadge status={job.status} />
                {job.finalVideoUrl && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/play:opacity-100">
                    <Play className="h-8 w-8 fill-white text-white" />
                  </span>
                )}
              </button>

              <div className="flex flex-1 flex-col gap-1 p-3">
                <button
                  type="button"
                  onClick={() => setPlaying(job)}
                  className="line-clamp-2 text-left text-sm font-medium leading-snug hover:text-primary"
                >
                  {job.title || `Video #${job.id}`}
                </button>
                <p className="text-xs text-muted-foreground">
                  {channelName(job.channelKey) ?? "No channel"}
                  {job.userName ? ` · ${job.userName}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(job.createdAt).toLocaleDateString()}
                </p>

                {/* Two distinct jobs, so two labelled buttons rather than one ambiguous
                    click: View watches the finished film, Open goes to the storyboard
                    workspace where scenes are inspected and regenerated. Download and
                    Delete stay icon-only — labelling all four overflows the card.

                    Wraps because the four together need ~240px and a card at the grid's
                    240px minimum only has 216px inside its padding: on one rigid line the
                    row spilled past the card edge. It stays on one line at any normal card
                    width and drops the icon buttons underneath only at the narrowest. */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-w-0 flex-1 basis-20 gap-1.5"
                    onClick={() => setPlaying(job)}
                    // Kept enabled with no video: the dialog explains why there is
                    // nothing to play, which beats a dead button with no reason.
                    title={
                      job.finalVideoUrl
                        ? "Watch the finished video"
                        : "No finished video — see why"
                    }
                  >
                    <Play className="h-3.5 w-3.5" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-w-0 flex-1 basis-20 gap-1.5"
                    onClick={() => navigate(`/?open=${job.id}`)}
                    title="Open the storyboard — inspect and regenerate scenes"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Open
                  </Button>
                  {job.finalVideoUrl && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5 px-2.5"
                      onClick={() =>
                        downloadFile(
                          job.finalVideoUrl!,
                          "video",
                          job.title || undefined
                        )
                      }
                      title="Download MP4"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5 px-2.5"
                    onClick={() => setCostJobId(job.id)}
                    title="What this video cost to generate"
                  >
                    <Receipt className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5 px-2.5 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                    onClick={() => setDeleting(job)}
                    title="Delete this video from your library"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <VideoPlayerDialog
        job={playing}
        onOpenChange={o => !o && setPlaying(null)}
        onEdit={id => navigate(`/?open=${id}`)}
      />

      <DeleteVideoDialog
        job={deleting}
        onOpenChange={o => !o && setDeleting(null)}
        onDeleted={jobId => setPlaying(p => (p?.id === jobId ? null : p))}
      />

      <GenerationCostDialog
        jobId={costJobId}
        open={costJobId != null}
        onOpenChange={o => !o && setCostJobId(null)}
      />
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "processing" | "completed" | "failed";
}) {
  // Sits ON the poster frame, so a translucent tint is not enough — it has to read
  // against whatever that frame happens to be. Solid fill, light text, and a ring
  // to lift it off a light thumbnail.
  const base =
    "absolute left-2 top-2 flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-white shadow-sm ring-1 ring-black/10";
  if (status === "processing") {
    return (
      <span className={`${base} bg-primary`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Generating…
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={`${base} bg-destructive`}>
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span className={`${base} bg-success`}>
      <CheckCircle2 className="h-3 w-3" />
      Ready
    </span>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { VideoPoster } from "@/components/VideoPoster";
import {
  Loader2,
  Plus,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Play,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  VideoPlayerDialog,
  type PlayableJob,
} from "@/components/VideoPlayerDialog";
import {
  DeleteVideoDialog,
  type DeletableJob,
} from "@/components/DeleteVideoDialog";

/**
 * How many videos the panel lists: the ten most recent. The panel is as tall as those rows and
 * no taller, so it never ends in an empty stretch; a window too short for ten scrolls the list.
 */
const PANEL_ROWS = 10;

/**
 * Persistent list of the latest renders, alongside the generator.
 *
 * The five job slots are workspaces, not a record: a finished film scrolls out of reach the
 * moment its slot is reused, and the only way back was a modal. This panel keeps the whole
 * library one click away while you work, and shows in-flight renders live — which is why it
 * reads `longformVideo.library` (all statuses) rather than the history queries
 * (completed/failed only).
 *
 * Clicking a row PLAYS the video — that is what a library is for. Loading it into a generator
 * tab is the secondary action, on the pencil button that appears on hover; it used to be the
 * only one, which made a click feel like nothing had happened.
 *
 * It shows the MOST RECENT ten and nothing else (`PANEL_ROWS`): an account with dozens of
 * renders turned this into a second scroll column beside a page that already scrolls, and the
 * older rows were never what anyone came here for — the Library page is. The footer keeps the
 * true total, from `libraryCounts`, so "View all 19" still means nineteen.
 */
export function VideoLibraryPanel({
  onOpen,
  onNew,
  onDeleted,
  activeJobIds,
}: {
  onOpen: (jobId: number) => void;
  onNew: () => void;
  /** Fired after a video is deleted — the page clears any tab that was showing it. */
  onDeleted?: (jobId: number) => void;
  /** Job ids currently loaded in a slot — highlighted so you can see where you are. */
  activeJobIds: (number | null)[];
}) {
  const { canRemove } = useAuth();
  const { data: page, isLoading } = trpc.longformVideo.library.useQuery(
    { limit: PANEL_ROWS },
    {
      // Cheap query (no script, no storyboard), and it carries live "Generating…" rows,
      // so keep it fresh while a render runs.
      refetchInterval: 20_000,
    }
  );
  const { data: counts } = trpc.longformVideo.libraryCounts.useQuery(
    undefined,
    {
      refetchInterval: 60_000,
    }
  );

  const jobs = page?.items.slice(0, PANEL_ROWS);
  const total = counts?.total;

  const [playing, setPlaying] = useState<PlayableJob | null>(null);
  const [deleting, setDeleting] = useState<DeletableJob | null>(null);
  const open = new Set(activeJobIds.filter((id): id is number => id != null));

  return (
    // Hidden below `lg`: a fixed 288px column on a narrow viewport squeezes the generator
    // (script box, storyboard grid) into something unusable. The Library nav item is the
    // way in at those sizes. `sticky` keeps it in view while the long generator page
    // scrolls, instead of scrolling away with it.
    <aside className="sticky top-[calc(var(--app-header-h)+1.5rem)] hidden max-h-[calc(100vh-var(--app-header-h)-3rem)] w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card lg:flex xl:w-72">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Your Library</h2>
          {total != null && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              {total}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onNew}
        >
          <Plus className="h-3 w-3" />
          New
        </Button>
      </header>

      {/* `min-h-0` lets the list shrink and scroll inside a window too short for all ten. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : !jobs || jobs.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No videos yet. Generate one and it shows up here.
          </p>
        ) : (
          <ul className="p-2">
            {jobs.map(job => {
              const isOpen = open.has(job.id);
              return (
                <li key={job.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setPlaying(job)}
                    title="Watch this video"
                    className={`flex w-full items-center gap-3 rounded-md p-2 pr-14 text-left transition-colors ${
                      isOpen
                        ? "bg-secondary ring-1 ring-primary/40"
                        : "hover:bg-secondary/60"
                    }`}
                  >
                    <span className="relative shrink-0">
                      <VideoPoster
                        posterUrl={job.posterUrl}
                        finalVideoUrl={job.finalVideoUrl}
                        status={job.status}
                        className="h-11 w-16 rounded"
                      />
                      {job.finalVideoUrl && (
                        <span className="absolute inset-0 flex items-center justify-center rounded bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <Play className="h-4 w-4 fill-white text-white" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {job.title || `Video #${job.id}`}
                      </span>
                      <StatusLine job={job} />
                    </span>
                  </button>
                  {/* Same split as the Library page: the row watches the video, these
                      open the storyboard workspace and delete. Always visible rather
                      than hover-only — a hidden control reads as a missing one. */}
                  <button
                    type="button"
                    onClick={() => onOpen(job.id)}
                    title="Open the storyboard — inspect and regenerate scenes"
                    className={`absolute ${canRemove ? "right-8" : "right-1.5"} top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => setDeleting(job)}
                      title="Delete this video from your library"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Link
        href="/library"
        className="flex items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3" />
        View all{total != null ? ` ${total}` : ""} in Library
      </Link>

      <VideoPlayerDialog
        job={playing}
        onOpenChange={o => !o && setPlaying(null)}
        onEdit={onOpen}
      />

      <DeleteVideoDialog
        job={deleting}
        onOpenChange={o => !o && setDeleting(null)}
        onDeleted={jobId => {
          // Close the player too if it was showing the video that just went away.
          setPlaying(p => (p?.id === jobId ? null : p));
          onDeleted?.(jobId);
        }}
      />
    </aside>
  );
}

/** Second line of a row: stage while rendering, outcome once it is done. */
function StatusLine({
  job,
}: {
  job: {
    status: "processing" | "completed" | "failed";
    stage: string;
    progress: unknown;
  };
}) {
  if (job.status === "processing") {
    const p = job.progress as {
      scenesDone?: number;
      scenesTotal?: number;
    } | null;
    const scenes =
      p?.scenesTotal && (job.stage === "clips" || job.stage === "voiceover")
        ? ` ${p.scenesDone ?? 0}/${p.scenesTotal}`
        : "";
    return (
      <span className="flex items-center gap-1 text-xs text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Generating…{scenes}
      </span>
    );
  }
  if (job.status === "failed") {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-success">
      <CheckCircle2 className="h-3 w-3" />
      Ready
    </span>
  );
}

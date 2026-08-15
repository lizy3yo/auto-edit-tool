import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VideoPoster } from "@/components/VideoPoster";
import {
  Loader2,
  Plus,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";

/**
 * Persistent list of every render, alongside the generator.
 *
 * The five job slots are workspaces, not a record: a finished film scrolls out of reach the
 * moment its slot is reused, and the only way back was a modal. This panel keeps the whole
 * library one click away while you work, and shows in-flight renders live — which is why it
 * reads `longformVideo.library` (all statuses) rather than the history queries
 * (completed/failed only).
 *
 * `onOpen` hands a job id back to the page, which loads it into a slot — the same path the
 * old history dialog used, so nothing about how a job is opened changes.
 */
export function VideoLibraryPanel({
  onOpen,
  onNew,
  activeJobIds,
}: {
  onOpen: (jobId: number) => void;
  onNew: () => void;
  /** Job ids currently loaded in a slot — highlighted so you can see where you are. */
  activeJobIds: (number | null)[];
}) {
  const { data: jobs, isLoading } = trpc.longformVideo.library.useQuery(
    undefined,
    {
      // Cheap query (no script, no storyboard), and it carries live "Generating…" rows,
      // so keep it fresh while a render runs.
      refetchInterval: 20_000,
    }
  );

  const open = new Set(activeJobIds.filter((id): id is number => id != null));

  return (
    <aside className="flex h-[calc(100vh-6.5rem)] w-72 shrink-0 flex-col rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Your Library</h2>
          {jobs && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              {jobs.length}
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

      <ScrollArea className="flex-1">
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
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(job.id)}
                    className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors ${
                      isOpen
                        ? "bg-secondary ring-1 ring-primary/40"
                        : "hover:bg-secondary/60"
                    }`}
                  >
                    <VideoPoster
                      posterUrl={job.posterUrl}
                      finalVideoUrl={job.finalVideoUrl}
                      status={job.status}
                      className="h-11 w-16 shrink-0 rounded"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {job.title || `Video #${job.id}`}
                      </p>
                      <StatusLine job={job} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      <Link
        href="/library"
        className="flex items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3" />
        View all{jobs ? ` ${jobs.length}` : ""} in Library
      </Link>
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
      <span className="flex items-center gap-1 text-xs text-red-400">
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-emerald-400">
      <CheckCircle2 className="h-3 w-3" />
      Ready
    </span>
  );
}

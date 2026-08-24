import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VideoPoster } from "@/components/VideoPoster";
import {
  VideoPlayerDialog,
  type PlayableJob,
} from "@/components/VideoPlayerDialog";
import { CheckCircle2, Film, Loader2, Play, XCircle } from "lucide-react";

type JobStatus = "processing" | "completed" | "failed";

/** Small inline status pill — the library's badge sits on the poster; this one sits in a row. */
function StatusPill({ status }: { status: JobStatus }) {
  const base =
    "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium";
  if (status === "processing") {
    return (
      <span className={`${base} bg-primary/10 text-primary`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Generating
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={`${base} bg-destructive/10 text-destructive`}>
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span className={`${base} bg-success/10 text-success`}>
      <CheckCircle2 className="h-3 w-3" />
      Ready
    </span>
  );
}

/**
 * Every render one account made — opened from the Videos count in Admin → Users.
 *
 * The count alone answers "how much", never "what". This is the same information the library
 * shows, with the maker fixed instead of the viewer: a row per render, newest first, in-flight
 * ones included so an account that is *currently* working shows it. Clicking a row plays the
 * film, which is what a list of videos is for.
 *
 * The query only runs while the dialog is open — a table of ten accounts must not fire ten
 * library queries on render.
 */
export function UserVideosDialog({
  user,
  onClose,
}: {
  user: { id: number; name: string; email: string } | null;
  onClose: () => void;
}) {
  const [playing, setPlaying] = useState<PlayableJob | null>(null);
  const [, navigate] = useLocation();

  const { data: videos, isLoading } = trpc.user.videos.useQuery(
    { id: user?.id ?? 0 },
    {
      enabled: user !== null,
      // In-flight renders are in this list, so keep it moving while the dialog is open.
      refetchInterval: user !== null ? 20_000 : false,
    }
  );

  // Same lookup the Library page builds — `listAllChannels` returns `{key, name}`, and a
  // channel that has since been deleted falls back to its raw key rather than blanking.
  const { data: channels } = trpc.channelConfig.listAllChannels.useQuery(
    undefined,
    { enabled: user !== null }
  );
  const channelName = useMemo(() => {
    const map = new Map((channels ?? []).map(c => [c.key, c.name]));
    return (key: string | null) => (key ? (map.get(key) ?? key) : null);
  }, [channels]);

  return (
    <>
      <Dialog open={user !== null} onOpenChange={o => !o && onClose()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="pr-6 text-base">
              Videos by {user?.name}
            </DialogTitle>
            <DialogDescription>
              {user?.email}
              {videos
                ? ` · ${videos.length} render${videos.length === 1 ? "" : "s"}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading videos…
            </div>
          ) : !videos?.length ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Film className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                This account hasn&apos;t generated any videos yet.
              </p>
            </div>
          ) : (
            // Capped height: a prolific account would otherwise push the dialog past the
            // viewport and take its own scrollbar with it.
            <ScrollArea className="max-h-[60vh] pr-3">
              <ul className="space-y-1.5">
                {videos.map(job => (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => setPlaying(job as PlayableJob)}
                      className="group flex w-full items-center gap-3 rounded-md border border-border bg-card p-2 text-left transition-colors hover:bg-muted"
                    >
                      <span className="relative shrink-0">
                        <VideoPoster
                          posterUrl={job.posterUrl}
                          finalVideoUrl={job.finalVideoUrl}
                          status={job.status}
                          className="h-12 w-20 rounded"
                        />
                        {job.finalVideoUrl && (
                          <span className="absolute inset-0 flex items-center justify-center rounded bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <Play className="h-4 w-4 fill-white text-white" />
                          </span>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {job.title || `Video #${job.id}`}
                          </span>
                          <StatusPill status={job.status} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {channelName(job.channelKey) ?? "No channel"} ·{" "}
                          {new Date(job.createdAt).toLocaleDateString()}
                          {job.sales > 0 &&
                            ` · ${job.sales} sale${job.sales === 1 ? "" : "s"}`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Sibling, not nested: the player stacks above the list, and closing it returns you to
          the list rather than dismissing both. */}
      <VideoPlayerDialog
        job={playing}
        onOpenChange={o => !o && setPlaying(null)}
        // Opening the storyboard is a Long-form page action, so hand off to it the same way
        // the Library does — `?open=` is the param that page reads on mount.
        onEdit={jobId => navigate(`/?open=${jobId}`)}
      />
    </>
  );
}

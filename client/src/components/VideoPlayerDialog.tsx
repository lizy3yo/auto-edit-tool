import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LongformVideoPlayer } from "./LongformVideoPlayer";
import { downloadFile } from "@/lib/download";
import { sanitizeError } from "@/lib/errorSanitizer";
import { Download, Loader2, Pencil, XCircle } from "lucide-react";

export interface PlayableJob {
  id: number;
  title: string | null;
  status: "processing" | "completed" | "failed";
  stage: string;
  finalVideoUrl: string | null;
  errorMessage: string | null;
}

/**
 * Watch a finished render.
 *
 * Clicking a library entry used to only load it into a generator tab — you then had to find
 * the player far down that tab's page. For a library, "click it and it plays" is the expected
 * behaviour, so playback is the primary action and loading it into a tab is the secondary one.
 *
 * A job without a `finalVideoUrl` is the common case here (a failed render, or one still
 * assembling), so this explains *why* there's nothing to play instead of showing a dead
 * player — which is what "nothing happens" looked like.
 */
export function VideoPlayerDialog({
  job,
  onOpenChange,
  onEdit,
}: {
  job: PlayableJob | null;
  onOpenChange: (open: boolean) => void;
  /** Load this job into a generator tab (the old click behaviour). */
  onEdit: (jobId: number) => void;
}) {
  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {job && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 text-base leading-snug">
                {job.title || `Video #${job.id}`}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Playback and actions for this render.
              </DialogDescription>
            </DialogHeader>

            {job.finalVideoUrl ? (
              <LongformVideoPlayer src={job.finalVideoUrl} />
            ) : job.status === "processing" ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-secondary/40 py-14 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-sm font-medium">Still rendering</p>
                <p className="text-xs text-muted-foreground">
                  There's no finished film to play until assembly completes.
                  Open it in a tab to watch the scenes come in.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-secondary/40 px-6 py-14 text-center">
                <XCircle className="h-5 w-5 text-red-400" />
                <p className="text-sm font-medium">
                  {job.status === "failed"
                    ? "This render failed"
                    : "No finished video"}
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {job.errorMessage
                    ? sanitizeError(job.errorMessage)
                    : "It never produced a final MP4. Open it in a tab to retry the failed scenes or re-assemble."}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  onEdit(job.id);
                  onOpenChange(false);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Open in tab
              </Button>
              {job.finalVideoUrl && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    downloadFile(
                      job.finalVideoUrl!,
                      "video",
                      job.title || undefined
                    )
                  }
                >
                  <Download className="h-3.5 w-3.5" />
                  Download MP4
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

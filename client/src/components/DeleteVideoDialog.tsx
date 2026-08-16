import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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

/** The fields the confirmation needs — a subset of a `longformVideo.library` row. */
export type DeletableJob = {
  id: number;
  title: string | null;
  status: "processing" | "completed" | "failed";
};

/**
 * Confirm-then-delete for one library video. Shared by the side panel and the Library page so
 * the wording, the cache invalidation and the in-flight-render warning stay identical wherever
 * you delete from.
 *
 * Deleting drops the job row: title, storyboard, scene history, cost ledger. The rendered MP4
 * and its clips stay in R2 — nothing here reaches into the bucket — so this frees the library,
 * not storage.
 */
export function DeleteVideoDialog({
  job,
  onOpenChange,
  onDeleted,
}: {
  /** The video pending deletion; `null` closes the dialog. */
  job: DeletableJob | null;
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful delete — lets a caller drop the job from local state. */
  onDeleted?: (jobId: number) => void;
}) {
  const utils = trpc.useUtils();

  const del = trpc.longformVideo.deleteJob.useMutation({
    onSuccess: (_res, vars) => {
      toast.success("Video deleted.");
      utils.longformVideo.library.invalidate();
      utils.longformVideo.myJobHistory.invalidate();
      utils.longformVideo.allJobHistory.invalidate();
      // The server clears any tab pinned to this job, so the slot query is now stale too.
      utils.longformVideo.getSlots.invalidate();
      onDeleted?.(vars.jobId);
      onOpenChange(false);
    },
    onError: err => toast.error(err.message ?? "Failed to delete."),
  });

  const rendering = job?.status === "processing";

  return (
    <AlertDialog
      open={job !== null}
      onOpenChange={open => {
        // Never yank the dialog out from under an in-flight request — the result still has a
        // toast and a cache invalidation to deliver.
        if (!open && !del.isPending) onOpenChange(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {job?.title || `Video #${job?.id}`}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the video from your library, along with its
            storyboard, scene history and cost breakdown. It can&apos;t be
            undone. The rendered files already uploaded to R2 are not deleted.
            {rendering && (
              <>
                {" "}
                <span className="font-medium text-amber-500">
                  This render is still running. Deleting it does not stop the
                  work already submitted to the providers — those scenes finish
                  and bill as normal, with nowhere left to land.
                </span>
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={e => {
              // Radix closes on action click by default; the mutation's onSuccess owns that
              // instead, so a failure leaves the dialog up with the error toast beside it.
              e.preventDefault();
              if (job) del.mutate({ jobId: job.id });
            }}
            disabled={del.isPending}
            className="bg-destructive hover:bg-destructive/90"
          >
            {del.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

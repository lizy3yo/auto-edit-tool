import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  groupJobWarnings,
  warningScenesLabel,
  type JobWarningGroup,
} from "@shared/jobWarnings";

/** Rows shown before "Show all" — enough to see what is wrong without pushing the card down. */
const COLLAPSED_ROWS = 3;

const linkButton =
  "rounded-sm underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function WarningRow({ group }: { group: JobWarningGroup }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const scenes = warningScenesLabel(group);
  return (
    <li className="text-xs text-warning">
      <span aria-hidden="true">⚠ </span>
      {scenes && <span className="font-medium">{scenes}: </span>}
      {group.text}
      {group.details.length > 0 && (
        <>
          {" "}
          <button
            type="button"
            className={linkButton}
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen(v => !v)}
          >
            {open ? "Hide details" : "Details"}
          </button>
          {open && (
            <ul
              id={detailsId}
              className="mt-1 space-y-1 rounded-md border border-warning/30 bg-warning/5 p-2 font-mono text-[11px] text-muted-foreground"
            >
              {group.details.map(d => (
                <li key={d} className="break-words">
                  {d}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

/**
 * The job card's issues behind one counted button: the reason a video failed and its warnings,
 * opened in a dialog so they take no room on the card. Red when the video failed, amber for
 * warnings alone; nothing at all when there is neither.
 */
export function JobIssuesButton({
  error,
  warnings,
}: {
  /** Why the video failed, when it did. */
  error?: string;
  warnings: string[];
}) {
  const count = (error ? 1 : 0) + groupJobWarnings(warnings).length;
  if (count === 0) return null;
  const label = `${count} issue${count === 1 ? "" : "s"}`;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          className={`tabular-nums ${error ? "text-destructive hover:text-destructive" : "text-warning hover:text-warning"}`}
        >
          <AlertTriangle className="mr-1.5 h-4 w-4" />
          {count}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error && (
            <p className="whitespace-pre-line text-sm text-destructive">
              {error}
            </p>
          )}
          <JobWarnings warnings={warnings} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The job card's warnings: one row per cause (`groupJobWarnings`), the provider's raw error
 * behind "Details", and the first few rows until "Show all" is clicked. Nothing is hidden
 * without a count saying so.
 */
export function JobWarnings({ warnings }: { warnings: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const groups = groupJobWarnings(warnings);
  if (groups.length === 0) return null;
  const hidden = groups.length - COLLAPSED_ROWS;
  const visible = showAll || hidden <= 0 ? groups : groups.slice(0, COLLAPSED_ROWS);
  return (
    <div className="space-y-1">
      <ul id={listId} className="space-y-0.5">
        {visible.map(g => (
          <WarningRow key={`${g.scenes.length ? "s" : "f"}|${g.text}`} group={g} />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className={`text-xs text-muted-foreground ${linkButton}`}
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll(v => !v)}
        >
          {showAll ? "Show less" : `Show all ${groups.length} warnings`}
        </button>
      )}
    </div>
  );
}

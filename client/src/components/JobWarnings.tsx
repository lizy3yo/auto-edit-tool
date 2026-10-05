import { useId, useState } from "react";
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

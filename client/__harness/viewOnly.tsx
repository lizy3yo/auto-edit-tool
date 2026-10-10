import "@/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useViewOnlyGuard,
  VIEW_EDIT,
  VIEW_OK,
} from "@/components/ViewOnlyGuard";

/**
 * A guest looking at a video someone else made (`useViewOnlyGuard`): the time-range tabs, the
 * search box and Cost keep working; Regenerate, Retry and a save field are paused — including a
 * control drawn AFTER the pause began, and the save field inside a look-only area.
 */
const RANGES = ["0:00-1:00", "1:00-2:00", "2:00-3:00"];

function Card() {
  const [viewOnly, setViewOnly] = useState(true);
  const [range, setRange] = useState(0);
  const [search, setSearch] = useState("");
  const [regens, setRegens] = useState(0);
  const [late, setLate] = useState(false);
  const ref = useViewOnlyGuard<HTMLFieldSetElement>(viewOnly);

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          id="toggle"
          type="checkbox"
          checked={viewOnly}
          onChange={e => setViewOnly(e.target.checked)}
        />
        View only (a guest on someone else&apos;s video)
      </label>
      <button
        id="draw-late"
        type="button"
        className="text-xs underline"
        onClick={() => setLate(true)}
      >
        Draw another scene&apos;s Regenerate now
      </button>

      <fieldset
        ref={ref}
        className="m-0 min-w-0 space-y-4 rounded-lg border border-border p-4"
      >
        <div className="flex flex-wrap gap-1.5" {...VIEW_OK}>
          {RANGES.map((label, i) => (
            <Button
              key={label}
              size="sm"
              variant={range === i ? "default" : "outline"}
              className="h-7 font-mono text-xs"
              onClick={() => setRange(i)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div {...VIEW_OK}>
          <Input
            id="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search script..."
            className="h-7 w-48 text-xs"
          />
        </div>
        <div className="flex gap-2">
          <Button {...VIEW_OK} id="cost" size="sm" variant="ghost">
            Cost
          </Button>
          <Button id="regen" size="sm" onClick={() => setRegens(n => n + 1)}>
            Regenerate
          </Button>
          <Button id="retry" size="sm" variant="outline">
            Retry failed scenes
          </Button>
          {late && (
            <Button id="late" size="sm" onClick={() => setRegens(n => n + 1)}>
              Regenerate scene 2
            </Button>
          )}
        </div>
        {/* A look-only area with one part that changes the video after all. */}
        <div className="space-y-2" {...VIEW_OK}>
          <Button id="copy" size="sm" variant="outline">
            Copy description
          </Button>
          <div className="flex gap-2" {...VIEW_EDIT}>
            <Input id="youtube" placeholder="YouTube link" className="h-8" />
            <Button id="save" size="sm">
              Save
            </Button>
          </div>
        </div>
      </fieldset>

      <p id="state" className="font-mono text-xs text-muted-foreground">
        range={RANGES[range]} search=&quot;{search}&quot; regenerates={regens}
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Card />);

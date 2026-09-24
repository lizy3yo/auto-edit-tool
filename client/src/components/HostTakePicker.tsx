import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { activeTakeIndex, hostTakeLabel } from "@shared/hostTakes";
import type { StoryboardScene } from "@shared/types";
import { LongformScenePreview } from "./LongformScenePreview";

/**
 * The old and the new version of a regenerated host beat, side by side (`shared/hostTakes.ts`).
 * A host regenerate is one paid render per beat, so it never throws away the shot it replaced:
 * the operator plays both against the line and keeps either. Switching is free — the clips are
 * already rendered — and shows in the cut preview at once; the finished film picks it up on the
 * next Reassemble.
 */
export function HostTakePicker({
  scene,
  disabled,
  onSelect,
}: {
  scene: StoryboardScene;
  disabled?: boolean;
  onSelect: (take: number) => void;
}) {
  const takes = scene.hostTakes ?? [];
  if (takes.length < 2) return null;
  const active = activeTakeIndex(scene);
  const durationSec =
    scene.narrationStartSec != null && scene.narrationEndSec != null
      ? scene.narrationEndSec - scene.narrationStartSec
      : undefined;
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Takes — pick the one the film uses
      </Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {takes.map((take, i) => {
          const inUse = i === active;
          return (
            <div
              key={`${i}-${take.clipUrls[0]}`}
              className={
                "space-y-1.5 rounded-md border p-2 " +
                (inUse ? "border-primary/60 bg-primary/5" : "border-border")
              }
            >
              <LongformScenePreview
                clipUrl={take.clipUrl ?? take.clipUrls[0]}
                audioUrl={scene.audioUrl}
                startSec={scene.clipInSec}
                durationSec={durationSec}
                className="w-full rounded bg-black max-h-[110px]"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {hostTakeLabel(take, i)}
                </span>
                {inUse ? (
                  <Badge
                    variant="outline"
                    className="gap-1 py-0 text-[10px] text-success border-success/40"
                  >
                    <Check className="h-3 w-3" /> In use
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    disabled={disabled}
                    onClick={() => onSelect(i)}
                  >
                    Use this take
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Switching is free. Reassemble to put the chosen take in the finished
        film.
      </p>
    </div>
  );
}

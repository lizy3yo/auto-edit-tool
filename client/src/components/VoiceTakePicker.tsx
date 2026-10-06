import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { activeVoiceTakeIndex, voiceTakeLabel } from "@shared/voiceTakes";
import type { StoryboardScene } from "@shared/types";

/**
 * The old and the new voice of a scene after "Redo voice" (`shared/voiceTakes.ts`). A redo is a
 * fresh provider read and can come back worse than the one it replaces, so the operator plays
 * both and keeps either. Switching is free — both files already exist — and the finished film
 * picks it up on the next Reassemble. Cutaways only: a host scene's voice follows its host take.
 */
export function VoiceTakePicker({
  scene,
  disabled,
  onSelect,
}: {
  scene: StoryboardScene;
  disabled?: boolean;
  onSelect: (take: number) => void;
}) {
  const takes = scene.voiceTakes ?? [];
  if (scene.hostPresent || takes.length < 2) return null;
  const active = activeVoiceTakeIndex(scene);
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Voice takes — pick the one the film uses
      </Label>
      <div className="space-y-2">
        {takes.map((take, i) => {
          const inUse = i === active;
          return (
            <div
              key={`${i}-${take.audioUrl}`}
              className={
                "space-y-1.5 rounded-md border p-2 " +
                (inUse ? "border-primary/60 bg-primary/5" : "border-border")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {voiceTakeLabel(take, i)}
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
                    Use this voice
                  </Button>
                )}
              </div>
              <audio
                controls
                preload="none"
                src={take.audioUrl}
                className="h-8 w-full"
              />
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Switching is free. Reassemble to put the chosen voice in the finished
        film.
      </p>
    </div>
  );
}

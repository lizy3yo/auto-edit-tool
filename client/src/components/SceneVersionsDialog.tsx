import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import {
  activePictureTakeIndex,
  pictureTakeLabel,
} from "@shared/pictureTakes";
import type { StoryboardScene } from "@shared/types";
import { HostTakePicker } from "./HostTakePicker";
import { LongformScenePreview } from "./LongformScenePreview";
import { VoiceTakePicker } from "./VoiceTakePicker";

/** A regenerated cutaway's pictures, side by side (`shared/pictureTakes.ts`). */
function PictureTakePicker({
  scene,
  disabled,
  onSelect,
}: {
  scene: StoryboardScene;
  disabled?: boolean;
  onSelect: (take: number) => void;
}) {
  const takes = scene.pictureTakes ?? [];
  if (scene.hostPresent || takes.length < 2) return null;
  const active = activePictureTakeIndex(scene);
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Pictures — pick the one the film uses
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
                className="w-full rounded bg-black max-h-[110px]"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {pictureTakeLabel(take, i)}
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
                    Use this picture
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Every version a scene has, in one place, opened from the card's "Versions" button.
 *
 * A HOST scene's version is its clip and the voice it was lip-synced to, switched together so
 * the lips always match. A cutaway's picture and voice are independent, so each has its own
 * list. Switching is free — everything listed already exists — and the finished film picks the
 * choice up on the next assemble.
 */
export function SceneVersionsDialog({
  scene,
  disabled,
  onOpenChange,
  onSelectHostTake,
  onSelectPicture,
  onSelectVoice,
}: {
  /** The scene whose versions are open, or null when the box is closed. */
  scene: StoryboardScene | null;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectHostTake: (take: number) => void;
  onSelectPicture: (take: number) => void;
  onSelectVoice: (take: number) => void;
}) {
  return (
    <Dialog open={!!scene} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scene {scene?.index} versions</DialogTitle>
          <DialogDescription>
            Switching is free. Assemble the video to apply it.
          </DialogDescription>
        </DialogHeader>
        {scene && (
          <div className="space-y-4">
            {scene.hostPresent ? (
              <HostTakePicker
                scene={scene}
                disabled={disabled}
                onSelect={onSelectHostTake}
              />
            ) : (
              <>
                <PictureTakePicker
                  scene={scene}
                  disabled={disabled}
                  onSelect={onSelectPicture}
                />
                <VoiceTakePicker
                  scene={scene}
                  disabled={disabled}
                  onSelect={onSelectVoice}
                />
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

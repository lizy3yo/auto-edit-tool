import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

/**
 * Inline Speed + Volume sliders for a channel's TTS. Saves straight to the channel
 * config (production DB) so the values are used for every future generation on that
 * channel. Mount with `key={channelKey}` so it re-seeds when the channel changes.
 *
 * Speed → 69labs voiceSettings.speed (0.7–1.2). Volume → ffmpeg gain (0.5–2, 1.0 = neutral).
 * Sliders are range-bounded so a value can't go past min/max.
 */
export function ChannelVoiceTuning({
  channelKey,
  ttsSpeed,
  ttsVolume,
}: {
  channelKey: string;
  ttsSpeed: string | null | undefined;
  ttsVolume: string | null | undefined;
}) {
  const utils = trpc.useUtils();
  const [speed, setSpeed] = useState(parseFloat(ttsSpeed ?? "1.0") || 1);
  const [volume, setVolume] = useState(parseFloat(ttsVolume ?? "1.0") || 1);

  const save = trpc.channelConfig.setVoiceTuning.useMutation({
    onSuccess: () => {
      utils.shuttle.channelDefaults.invalidate({ channelKey });
      toast.success("Voice settings saved");
    },
    onError: err => toast.error(err.message),
  });

  // Persist on release (onValueCommit) — skip if nothing changed.
  const commit = (s: number, v: number) => {
    if (
      s === (parseFloat(ttsSpeed ?? "1.0") || 1) &&
      v === (parseFloat(ttsVolume ?? "1.0") || 1)
    )
      return;
    save.mutate({
      channelKey,
      ttsSpeed: s.toFixed(2),
      ttsVolume: v.toFixed(2),
    });
  };

  return (
    <div className="w-full space-y-3">
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <Label>Speed</Label>
          <span className="text-muted-foreground tabular-nums">
            {speed.toFixed(2)}x
          </span>
        </div>
        <Slider
          min={0.7}
          max={1.2}
          step={0.05}
          value={[speed]}
          onValueChange={([s]) => setSpeed(s)}
          onValueCommit={([s]) => commit(s, volume)}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <Label>Volume</Label>
          <span className="text-muted-foreground tabular-nums">
            {volume.toFixed(2)}x
          </span>
        </div>
        <Slider
          min={0.5}
          max={2}
          step={0.05}
          value={[volume]}
          onValueChange={([v]) => setVolume(v)}
          onValueCommit={([v]) => commit(speed, v)}
        />
      </div>
    </div>
  );
}

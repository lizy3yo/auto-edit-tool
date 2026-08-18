import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_LONGFORM_PACING,
  MAX_QUARTER_LOAD,
  PACING_BOUNDS,
  type LongformPacing,
} from "@shared/pacing";

/**
 * Admin editor for the long-form PACING DIALS — the visual mix, the split-screen lane, the fast
 * opening and asset captions (see `shared/pacing.ts`).
 *
 * Every feature is a switch plus its dials, and switching one OFF restores the pre-config
 * pipeline for that feature alone, so an operator can turn them on one at a time and attribute
 * the change in the finished film. Saving affects the NEXT render only: each job snapshots its
 * pacing at start, so a film already in flight is never re-cut underneath itself.
 */

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** One labelled slider row. `format` renders the live value beside the label. */
function Dial(props: {
  label: string;
  hint?: string;
  value: number;
  bounds: { min: number; max: number; step: number };
  format: (n: number) => string;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div className={props.disabled ? "opacity-50" : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-sm">{props.label}</Label>
        <span className="text-sm font-mono tabular-nums">
          {props.format(props.value)}
        </span>
      </div>
      <Slider
        className="mt-2"
        value={[props.value]}
        min={props.bounds.min}
        max={props.bounds.max}
        step={props.bounds.step}
        disabled={props.disabled}
        onValueChange={([v]) => props.onChange(v)}
      />
      {props.hint && (
        <p className="text-xs text-muted-foreground mt-1.5">{props.hint}</p>
      )}
    </div>
  );
}

/** A feature block: its on/off switch, a one-line description, and its dials when on. */
function Feature(props: {
  title: string;
  description: string;
  offMeans: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">{props.title}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {props.description}
          </p>
        </div>
        <Switch checked={props.enabled} onCheckedChange={props.onToggle} />
      </div>
      {props.enabled ? (
        <div className="space-y-4 pt-1">{props.children}</div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Off — {props.offMeans}
        </p>
      )}
    </div>
  );
}

export function LongformPacing() {
  const { data, isLoading } = trpc.longformVideo.getPacing.useQuery();
  const utils = trpc.useUtils();
  const [pacing, setPacing] = useState<LongformPacing | null>(null);

  useEffect(() => {
    if (data?.pacing) setPacing(data.pacing);
  }, [data?.pacing]);

  const saveMutation = trpc.longformVideo.setPacing.useMutation({
    onSuccess: () => {
      toast.success("Pacing saved — applies to the next render.");
      utils.longformVideo.getPacing.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to save."),
  });

  if (isLoading || !pacing) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  const set = (patch: (p: LongformPacing) => LongformPacing) =>
    setPacing(p => (p ? patch(p) : p));
  const dirty = JSON.stringify(pacing) !== JSON.stringify(data?.pacing);

  const { visualMix, splitScreen, fastOpen, captions } = pacing;
  // Stills are the derived remainder everywhere in the pipeline — show the operator the number
  // they are actually setting rather than making them subtract two sliders in their head.
  const stillShare = Math.max(
    0,
    1 - visualMix.hostShare - visualMix.motionShare
  );
  // Motion yields to host at the ceiling (same rule the server resolver applies), so the motion
  // slider's usable top moves as the host slider does.
  const motionMax = Math.min(
    PACING_BOUNDS.motionShare.max,
    Math.max(
      PACING_BOUNDS.motionShare.min,
      MAX_QUARTER_LOAD - visualMix.hostShare
    )
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Longform Pacing
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-2">
          How much of a film is talking head, moving video, and stills; how
          often the host shares the frame; and how fast the opening cuts.
          Applies to the <strong>next</strong> render — a job already running
          keeps the settings it started with.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Feature
          title="Visual mix"
          description="How the film's runtime divides between the host, moving b-roll, and stills. Stills are whatever is left."
          offMeans="the standard 35% host / 15% video / 50% stills."
          enabled={visualMix.enabled}
          onToggle={v =>
            set(p => ({ ...p, visualMix: { ...p.visualMix, enabled: v } }))
          }
        >
          <Dial
            label="Talking head"
            value={visualMix.hostShare}
            bounds={PACING_BOUNDS.hostShare}
            format={pct}
            onChange={n =>
              set(p => ({
                ...p,
                visualMix: {
                  ...p.visualMix,
                  hostShare: n,
                  motionShare: Math.min(
                    p.visualMix.motionShare,
                    MAX_QUARTER_LOAD - n
                  ),
                },
              }))
            }
          />
          <Dial
            label="Moving b-roll video"
            hint="A target, not a guarantee: only beats that genuinely contain movement can be video, so a static script lands under it. The render log prints what was achievable beside the target."
            value={visualMix.motionShare}
            bounds={{ ...PACING_BOUNDS.motionShare, max: motionMax }}
            format={pct}
            onChange={n =>
              set(p => ({
                ...p,
                visualMix: { ...p.visualMix, motionShare: n },
              }))
            }
          />
          <div className="flex items-baseline justify-between text-sm border-t border-border pt-3">
            <span className="text-muted-foreground">
              Stills (the remainder)
            </span>
            <span className="font-mono tabular-nums">{pct(stillShare)}</span>
          </div>
        </Feature>

        <Feature
          title="Split screen"
          description="The host talking on the left with a visual beside them on the right. Splits are a constant of the format — every film gets at least the classic ~7.5% share."
          offMeans="the classic baseline — splits on ~7.5% of the film with a still right panel. This dial can only raise the share, never remove splits."
          enabled={splitScreen.enabled}
          onToggle={v =>
            set(p => ({ ...p, splitScreen: { ...p.splitScreen, enabled: v } }))
          }
        >
          <Dial
            label="Share of host time"
            hint={`≈ ${pct(splitScreen.hostShare * visualMix.hostShare)} of the whole film at the current host share.`}
            value={splitScreen.hostShare}
            bounds={PACING_BOUNDS.splitHostShare}
            format={pct}
            onChange={n =>
              set(p => ({
                ...p,
                splitScreen: { ...p.splitScreen, hostShare: n },
              }))
            }
          />
          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm">Moving right panel</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Render the right half as a video clip instead of a still with
                  a slow pan.
                </p>
              </div>
              <Switch
                checked={splitScreen.motion.enabled}
                onCheckedChange={v =>
                  set(p => ({
                    ...p,
                    splitScreen: {
                      ...p.splitScreen,
                      motion: { ...p.splitScreen.motion, enabled: v },
                    },
                  }))
                }
              />
            </div>
            {splitScreen.motion.enabled ? (
              <Dial
                label="Share of split beats that move"
                value={splitScreen.motion.share}
                bounds={PACING_BOUNDS.splitMotionShare}
                format={pct}
                onChange={n =>
                  set(p => ({
                    ...p,
                    splitScreen: {
                      ...p.splitScreen,
                      motion: { ...p.splitScreen.motion, share: n },
                    },
                  }))
                }
              />
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Off — every right panel is a still with a slow pan.
              </p>
            )}
          </div>
        </Feature>

        <Feature
          title="Fast opening"
          description="Cut faster across the start of the film, so the visuals keep up with the script's opening pace."
          offMeans="one uniform 3–8s shot band across the whole film."
          enabled={fastOpen.enabled}
          onToggle={v =>
            set(p => ({ ...p, fastOpen: { ...p.fastOpen, enabled: v } }))
          }
        >
          <Dial
            label="Window length"
            hint="Measured from the start of the narration. The locked cold open is excluded — it keeps its own timing."
            value={fastOpen.zoneSec}
            bounds={PACING_BOUNDS.zoneSec}
            format={n => `${n}s`}
            onChange={n =>
              set(p => ({ ...p, fastOpen: { ...p.fastOpen, zoneSec: n } }))
            }
          />
          <Dial
            label="Shortest shot in the window"
            hint="Cutaways only. A lip-synced host shot never goes under 4s — a face that cuts faster reads as a glitch."
            value={fastOpen.minShotSec}
            bounds={PACING_BOUNDS.minShotSec}
            format={n => `${n.toFixed(1)}s`}
            onChange={n =>
              set(p => ({
                ...p,
                fastOpen: {
                  ...p.fastOpen,
                  minShotSec: n,
                  maxShotSec: Math.max(p.fastOpen.maxShotSec, n + 1),
                },
              }))
            }
          />
          <Dial
            label="Longest shot in the window"
            value={fastOpen.maxShotSec}
            bounds={{
              ...PACING_BOUNDS.maxShotSec,
              min: Math.max(
                PACING_BOUNDS.maxShotSec.min,
                fastOpen.minShotSec + 1
              ),
            }}
            format={n => `${n.toFixed(1)}s`}
            onChange={n =>
              set(p => ({ ...p, fastOpen: { ...p.fastOpen, maxShotSec: n } }))
            }
          />
        </Feature>

        <Feature
          title="Asset captions"
          description="Burn the caption you type under each uploaded asset onto its beat, bottom-centre."
          offMeans="uploaded assets render clean, with no text."
          enabled={captions.enabled}
          onToggle={v => set(p => ({ ...p, captions: { enabled: v } }))}
        >
          <p className="text-xs text-muted-foreground">
            Assets themselves are uploaded per video, on the Longform page.
          </p>
        </Feature>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-xs text-muted-foreground">
            {dirty ? "Unsaved changes." : "Saved."}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setPacing(data?.defaults ?? DEFAULT_LONGFORM_PACING)
              }
              disabled={saveMutation.isPending}
            >
              Restore defaults
            </Button>
            <Button
              onClick={() => saveMutation.mutate({ pacing })}
              disabled={saveMutation.isPending || !dirty}
            >
              {saveMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

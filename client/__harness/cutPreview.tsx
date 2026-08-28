import "@/index.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import {
  CutPreviewSwitch,
  LongformCutPreview,
  planCutBeats,
} from "@/components/LongformCutPreview";
import type { StoryboardScene } from "@shared/types";
import clipUrl from "./media/clip.mp4?url";
import masterUrl from "./media/next.mp3?url";

/**
 * Exercises `LongformCutPreview` without a database, a job or R2.
 *
 * Every beat points at the SAME 8 s clip at a different offset, which is the useful case to
 * watch: if the two-player swap and the film clock are right, each cut lands on visibly different
 * footage at the right moment even though the file never changes. The master is the 7 s
 * `next.mp3`, split into three beats.
 *
 * The toggles reproduce the cut-room edits the preview exists to show — a trim, a split, a
 * per-piece slip, and a frozen hold — so a change to the arithmetic can be watched rather than
 * reasoned about. The planned beats are printed underneath: with a hold on, the film runs LONGER
 * than the 7 s narration and every later beat shifts, exactly as the rendered file does.
 */
const scene = (over: Partial<StoryboardScene>): StoryboardScene =>
  ({ hostPresent: false, narration: "", clipUrl, ...over }) as StoryboardScene;

function Harness() {
  const [trimmed, setTrimmed] = useState(false);
  const [slipped, setSlipped] = useState(false);
  const [held, setHeld] = useState(false);
  const [leadIn, setLeadIn] = useState(false);
  // Mirrors LongformJobSlot's player slot: one frame, two sources, switched in place.
  const [live, setLive] = useState(true);

  const scenes: StoryboardScene[] = [
    scene({
      index: 1,
      narrationStartSec: 0,
      narrationEndSec: 2.3,
      audioDuration: 2.3,
      headHoldSec: leadIn ? 1.5 : undefined,
    }),
    scene({
      index: 2,
      narrationStartSec: 2.3,
      narrationEndSec: 4.6,
      audioDuration: 2.3,
      clipInSec: trimmed ? 4 : 0,
      tailHoldSec: held ? 2 : undefined,
      ...(slipped ? { cutPoints: [1], pieceClipIns: { "1": 7 } } : {}),
    }),
    scene({
      index: 3,
      narrationStartSec: 4.6,
      narrationEndSec: 7.03,
      audioDuration: 2.43,
    }),
  ];

  const toggle = (label: string, on: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={on}
        onChange={e => set(e.target.checked)}
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-4 text-foreground">
      <h1 className="text-lg font-semibold">Cut preview harness</h1>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {toggle("Scene 2 trimmed to 4 s in", trimmed, setTrimmed)}
        {toggle(
          "Scene 2 split at 1 s, 2nd piece slipped to 7 s",
          slipped,
          setSlipped
        )}
        {toggle("Scene 2 holds 2 s on its last frame", held, setHeld)}
        {toggle("Scene 1 holds 1.5 s before the first word", leadIn, setLeadIn)}
      </div>
      <div className="space-y-3">
        <CutPreviewSwitch live={live} onChange={setLive} />
        {live ? (
          <LongformCutPreview scenes={scenes} masterAudioUrl={masterUrl} />
        ) : (
          <div className="flex aspect-video max-h-[480px] w-full items-center justify-center rounded-lg bg-black text-sm text-muted-foreground">
            (stand-in for the rendered film player)
          </div>
        )}
      </div>
      <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
        {JSON.stringify(
          planCutBeats(scenes).map(b => ({
            scene: b.index,
            film: [+b.startSec.toFixed(2), +b.endSec.toFixed(2)],
            master: +b.masterStartSec.toFixed(2),
            head: b.headHoldSec || undefined,
            tail: +b.tailHoldSec.toFixed(2) || undefined,
            clipIn: b.clipInSec || undefined,
            cuts: b.cutPoints.length ? b.cutPoints : undefined,
            slips: Object.keys(b.pieceClipIns).length
              ? b.pieceClipIns
              : undefined,
          })),
          null,
          1
        )}
      </pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

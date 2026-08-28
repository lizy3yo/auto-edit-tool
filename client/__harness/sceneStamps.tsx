import "@/index.css";
import { createRoot } from "react-dom/client";
import { QR_TAIL_HOLD_SEC } from "@/components/LongformCutPreview";
import { FPS, planMasterOverlayScenes } from "@shared/filmTimeline";
import type { StoryboardScene } from "@shared/types";

/**
 * The storyboard's scene timecodes, in isolation.
 *
 * `LongformJobSlot` is 2,700 lines behind a login and a live job, so the arithmetic it uses to
 * stamp each scene card is reproduced here against a board that exercises the cases that make
 * film time diverge from narration time — a held sub-floor beat, a CTA release tail, an
 * operator's hold. If a scene's stamp ever drifts from where it actually lands in the file,
 * this is where it shows up first.
 */
const scene = (over: Partial<StoryboardScene>): StoryboardScene =>
  ({ hostPresent: false, narration: "", ...over }) as StoryboardScene;

const board: StoryboardScene[] = [
  scene({
    index: 1,
    narrationStartSec: 0,
    narrationEndSec: 12,
    audioDuration: 12,
  }),
  // Sub-floor: 1s of words held to the 3s floor, so it occupies 3s of the film.
  scene({
    index: 2,
    narrationStartSec: 12,
    narrationEndSec: 13,
    audioDuration: 3,
  }),
  scene({
    index: 3,
    narrationStartSec: 13,
    narrationEndSec: 25,
    audioDuration: 12,
  }),
  // A CTA release beat: 3s of frozen QR after the last word.
  scene({
    index: 4,
    narrationStartSec: 25,
    narrationEndSec: 33,
    audioDuration: 8,
    qrTail: true,
  }),
  scene({
    index: 5,
    narrationStartSec: 33,
    narrationEndSec: 61,
    audioDuration: 28,
  }),
  // The operator removed that beat's default pause on this one.
  scene({
    index: 6,
    narrationStartSec: 61,
    narrationEndSec: 70,
    audioDuration: 9,
    qrTail: true,
    tailHoldSec: 0,
  }),
  scene({
    index: 7,
    narrationStartSec: 70,
    narrationEndSec: 95,
    audioDuration: 25,
  }),
];

function stamps(scenes: StoryboardScene[]) {
  const usable = scenes
    .filter(
      s =>
        Number.isFinite(s.narrationStartSec as number) &&
        Number.isFinite(s.narrationEndSec as number) &&
        (s.narrationEndSec as number) > (s.narrationStartSec as number)
    )
    .sort((a, b) => a.index - b.index);
  const out = new Map<number, string>();
  if (!usable.length) return out;
  const plan = planMasterOverlayScenes({
    scenes: usable.map(s => ({
      sliceStartSec: s.narrationStartSec as number,
      sliceEndSec: s.narrationEndSec as number,
      holdSec: s.coverHero ? undefined : s.audioDuration,
      tailHoldSec: s.tailHoldSec ?? (s.qrTail ? QR_TAIL_HOLD_SEC : undefined),
      headHoldSec: s.headHoldSec,
    })),
  });
  let at = 0;
  usable.forEach((s, i) => {
    const t = Math.max(0, Math.floor(at));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = String(t % 60).padStart(2, "0");
    out.set(
      s.index,
      h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
    );
    at += plan.scenes[i].frames / FPS;
  });
  return out;
}

function Harness() {
  const tc = stamps(board);
  const naive = (s: StoryboardScene) => {
    const t = Math.floor(s.narrationStartSec as number);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  };
  return (
    <div className="space-y-4 text-foreground">
      <h1 className="text-sm font-medium">Storyboard scene stamps</h1>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {board.map(s => (
          <div
            key={s.index}
            className="w-32 shrink-0 overflow-hidden rounded-md border border-border"
          >
            <div className="relative aspect-video bg-secondary/40">
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 font-mono text-[10px] text-white">
                #{s.index}
                {tc.has(s.index) && (
                  <span className="text-white/70"> · {tc.get(s.index)}</span>
                )}
              </span>
            </div>
            <p className="truncate px-1.5 py-1 text-[11px] text-muted-foreground">
              {s.qrTail ? "cta beat" : "scene"}
            </p>
          </div>
        ))}
      </div>
      <table className="text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="pr-4 text-left font-normal">scene</th>
            <th className="pr-4 text-left font-normal">stamp (film time)</th>
            <th className="pr-4 text-left font-normal">narration start</th>
            <th className="text-left font-normal">why they differ</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {board.map(s => (
            <tr key={s.index}>
              <td className="pr-4">#{s.index}</td>
              <td className="pr-4">{tc.get(s.index)}</td>
              <td className="pr-4 text-muted-foreground">{naive(s)}</td>
              <td className="font-sans text-muted-foreground">
                {tc.get(s.index) !== naive(s)
                  ? "pushed back by an earlier hold"
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

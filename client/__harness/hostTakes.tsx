import "@/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HostTakePicker } from "@/components/HostTakePicker";
import { HostRenderLines } from "@/components/GenerationCostDialog";
import { hostRenderBreakdown, summarizeHostSpend } from "@shared/hostSpend";
import { selectHostTake } from "@shared/hostTakes";
import type { SceneSubmit, StoryboardScene } from "@shared/types";

/**
 * The host regenerate rules' two visible pieces, without a job or a database:
 *  - the TAKE PICKER a regenerated host beat shows (old take vs new, "Use this take" swaps the
 *    scene's clip through the same `selectHostTake` the edit session runs);
 *  - the Cost dialog's HOST RENDER LINES — the pipeline's own renders vs people's clicks, with
 *    names, and the renders a manager confirmed past a limit.
 */
const CLIP = "/__harness/media/clip.mp4";
const VOICE = "/__harness/media/voice.mp3";

const sub = (
  reason: SceneSubmit["reason"],
  extra: Partial<SceneSubmit> = {}
): SceneSubmit => ({
  provider: "heygen",
  at: "2026-09-25T09:00:00.000Z",
  reason,
  sec: 7,
  ...extra,
});
const hank = { id: 2, name: "Hank" };
const maria = { id: 3, name: "Maria" };
const joe = { id: 4, name: "Joe (manager)" };

const initialScene: StoryboardScene = {
  index: 12,
  narration: "the one tool",
  scriptText: "Here's the one tool I'd never give up in the shop.",
  visualPrompt: "host on camera",
  hostPresent: true,
  audioUrl: VOICE,
  narrationStartSec: 40,
  narrationEndSec: 47,
  clipUrls: [`${CLIP}#new`],
  clipUrl: `${CLIP}#new`,
  submits: [sub("first"), sub("regenerate", { by: hank })],
  hostTakes: [
    {
      clipUrls: [`${CLIP}#old`],
      clipUrl: `${CLIP}#old`,
      at: "2026-09-25T09:00:00.000Z",
      source: "original",
    },
    {
      clipUrls: [`${CLIP}#new`],
      clipUrl: `${CLIP}#new`,
      at: "2026-09-25T09:20:00.000Z",
      source: "regenerate",
      by: hank,
    },
  ],
  activeTake: 1,
};

const board: StoryboardScene[] = [
  { ...initialScene },
  {
    ...initialScene,
    index: 3,
    hostTakes: undefined,
    submits: [sub("first"), sub("infra")],
  },
  {
    ...initialScene,
    index: 20,
    hostTakes: undefined,
    submits: [
      sub("first"),
      sub("regenerate", { by: maria }),
      sub("regenerate", { by: joe, pastLimit: true }),
    ],
  },
  {
    ...initialScene,
    index: 31,
    hostTakes: undefined,
    submits: [sub("first"), sub("retry", { by: hank }), sub("retry")],
  },
  ...Array.from({ length: 16 }, (_, i) => ({
    ...initialScene,
    index: 40 + i,
    hostTakes: undefined,
    submits: [sub("first")],
  })),
];

function App() {
  const [scene, setScene] = useState<StoryboardScene>(initialScene);
  const [log, setLog] = useState<string[]>([]);
  const spentSec = board.reduce(
    (n, s) => n + (s.submits ?? []).reduce((m, x) => m + (x.sec ?? 0), 0),
    0
  );
  return (
    <div className="space-y-8 text-foreground">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Take picker (scene 12)</h2>
        <HostTakePicker
          scene={scene}
          onSelect={take => {
            const next = structuredClone(scene);
            const r = selectHostTake(next, take);
            setLog(l => [
              ...l,
              r.ok
                ? `take ${take + 1} → clipUrl ${next.clipUrl}`
                : `refused: ${r.reason}`,
            ]);
            setScene(next);
          }}
        />
        <pre data-testid="take-log" className="text-xs text-muted-foreground">
          {log.join("\n") || "(no switch yet)"}
        </pre>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          Cost dialog — host lip-sync lines
        </h2>
        <HostRenderLines
          spend={summarizeHostSpend({ hostMinutes: 3 } as any, board, spentSec)}
          groups={hostRenderBreakdown(board)}
        />
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

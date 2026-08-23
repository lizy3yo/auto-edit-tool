import "@/index.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { SceneTimingEditor } from "@/components/SceneTimingEditor";
import clipUrl from "./media/clip.mp4?url";
import voiceUrl from "./media/voice.mp3?url";
import prevUrl from "./media/prev.mp3?url";
import nextUrl from "./media/next.mp3?url";

type Scene = {
  index: number;
  startSec: number;
  endSec: number;
  clipInSec: number;
  tailHoldSec?: number;
  cutPoints?: number[];
  pieceClipIns?: Record<string, number>;
};

/**
 * Stand-in for the storyboard around the scene being edited. Starts as scene 2 of 3 on a 30 s
 * master (prev [5,11) · this [11,17) · next [17,24), footage 8 s). `applySplit` reproduces the
 * server's `splitSceneAt` locally so the editor's post-split behaviour (stay on the first half,
 * refill the shorter slice) can be checked without a backend.
 */
function Harness() {
  const [scenes, setScenes] = useState<Scene[]>([
    { index: 1, startSec: 5, endSec: 11, clipInSec: 0 },
    {
      index: 2,
      startSec: 11,
      endSec: 17,
      clipInSec: 0,
      tailHoldSec: undefined,
    },
    { index: 3, startSec: 17, endSec: 24, clipInSec: 3 },
  ]);
  const [editingIndex, setEditingIndex] = useState(2);
  const [log, setLog] = useState<string[]>([]);
  const at = scenes.findIndex(s => s.index === editingIndex);
  const scene = scenes[at];
  const prev = at > 0 ? scenes[at - 1] : undefined;
  const next = at < scenes.length - 1 ? scenes[at + 1] : undefined;

  return (
    <div className="space-y-3 text-foreground">
      <h1 className="text-sm font-medium">
        SceneTimingEditor harness — editing scene {editingIndex} of{" "}
        {scenes.length}
      </h1>
      <SceneTimingEditor
        key={scene.index}
        sceneIndex={scene.index}
        clipUrl={clipUrl}
        startSec={scene.startSec}
        endSec={scene.endSec}
        clipInSec={scene.clipInSec}
        tailHoldSec={scene.tailHoldSec}
        qrTail
        prevStartSec={prev?.startSec}
        nextEndSec={next?.endSec}
        audioUrl={voiceUrl}
        prevAudioUrl={prev ? prevUrl : undefined}
        nextAudioUrl={next ? nextUrl : undefined}
        prevClipUrl={prev ? clipUrl : undefined}
        nextClipUrl={next ? clipUrl : undefined}
        nextClipInSec={next?.clipInSec}
        prevIndex={prev?.index}
        nextIndex={next?.index}
        onSelectScene={setEditingIndex}
        onApply={edit => {
          setLog(l => [...l, "apply " + JSON.stringify(edit)]);
          setScenes(list =>
            list.map(s => (s.index === scene.index ? { ...s, ...edit } : s))
          );
        }}
        cutPoints={scene.cutPoints}
        onSplit={offset => {
          setLog(l => [...l, `cut scene ${scene.index} at +${offset}`]);
          // Mirror the server: add a cut MARKER on the same scene (no new scene, no renumber).
          setScenes(list =>
            list.map(s =>
              s.index === scene.index
                ? {
                    ...s,
                    cutPoints: Array.from(
                      new Set([
                        ...(s.cutPoints ?? []),
                        Math.round(offset * 1000) / 1000,
                      ])
                    ).sort((a, b) => a - b),
                  }
                : s
            )
          );
        }}
        onRemoveCut={offset => {
          setLog(l => [
            ...l,
            `remove cut on scene ${scene.index} near +${offset}`,
          ]);
          setScenes(list =>
            list.map(s =>
              s.index === scene.index
                ? {
                    ...s,
                    cutPoints: (s.cutPoints ?? []).filter(
                      c => Math.abs(c - offset) > 0.01
                    ),
                  }
                : s
            )
          );
        }}
        onMoveCut={(from, to) => {
          setLog(l => [
            ...l,
            `move cut on scene ${scene.index}: +${from} -> +${to}`,
          ]);
          setScenes(list =>
            list.map(s => {
              if (s.index !== scene.index) return s;
              const fromKey = (s.cutPoints ?? []).find(
                c => Math.abs(c - from) < 0.01
              );
              const rest = { ...(s.pieceClipIns ?? {}) };
              if (fromKey !== undefined && String(fromKey) in rest) {
                rest[String(to)] = rest[String(fromKey)];
                delete rest[String(fromKey)];
              }
              return {
                ...s,
                cutPoints: (s.cutPoints ?? [])
                  .map(c => (Math.abs(c - from) < 0.01 ? to : c))
                  .sort((a, b) => a - b),
                pieceClipIns: Object.keys(rest).length ? rest : undefined,
              };
            })
          );
        }}
        pieceClipIns={scene.pieceClipIns}
        onSetPieceClipIn={(cutOffsetSec, clipInSec) => {
          setLog(l => [
            ...l,
            `piece slip on scene ${scene.index} at +${cutOffsetSec}: ${clipInSec === null ? "reset" : `-> ${clipInSec}`}`,
          ]);
          setScenes(list =>
            list.map(s => {
              if (s.index !== scene.index) return s;
              const key = String(cutOffsetSec);
              const rest = { ...(s.pieceClipIns ?? {}) };
              if (clipInSec === null) delete rest[key];
              else rest[key] = clipInSec;
              return {
                ...s,
                pieceClipIns: Object.keys(rest).length ? rest : undefined,
              };
            })
          );
        }}
      />
      <div className="flex gap-2 text-xs">
        {scenes.map(s => (
          <button
            key={s.index}
            className={`rounded border px-2 py-1 ${s.index === editingIndex ? "border-primary bg-primary/10" : "border-border"}`}
            onClick={() => setEditingIndex(s.index)}
          >
            scene {s.index} ({s.startSec}–{s.endSec})
          </button>
        ))}
      </div>
      <pre id="log" className="text-xs text-muted-foreground">
        {log.join("\n")}
      </pre>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);

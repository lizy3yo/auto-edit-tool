import "@/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LongformHostMinutes } from "@/components/LongformHostMinutes";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_HOST_MINUTES,
  ESTIMATE_WORDS_PER_SEC,
  formatMinSec,
  resolveHostBudget,
} from "@shared/hostMinutes";

/**
 * The "Talking head" step of the generate form, and the confirm dialog's over-the-guide question,
 * without a login, a channel or a database. The script length is a slider so both sides of the
 * guide can be seen: ~3,400 words is a 20-minute film (every pick fits), ~1,700 is a 10-minute one
 * (5+ minutes needs confirming, 7 hits the half-film ceiling).
 *
 * The dialog block mirrors `LongformJobSlot`'s copy and conditions; the arithmetic is the shared
 * `resolveHostBudget`, the same function the pipeline runs on the measured narration.
 */
const GUIDE = 0.35;
const RATE = 0.06;

function Harness() {
  const [minutes, setMinutes] = useState(DEFAULT_HOST_MINUTES);
  const [words, setWords] = useState(1700);
  const filmSec = Math.round(words / ESTIMATE_WORDS_PER_SEC);
  const estimate = resolveHostBudget({
    minutes,
    filmSec,
    guideFraction: GUIDE,
  });
  const override = resolveHostBudget({
    minutes,
    override: true,
    filmSec,
    guideFraction: GUIDE,
  });

  return (
    <div className="space-y-6 text-foreground">
      <label className="block space-y-1 text-xs text-muted-foreground">
        Script: {words.toLocaleString()} words ≈ {formatMinSec(filmSec)}
        <input
          type="range"
          min={300}
          max={5000}
          step={100}
          value={words}
          onChange={e => setWords(Number(e.target.value))}
          className="block w-full"
        />
      </label>

      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">3 · Talking head</h2>
        <LongformHostMinutes
          value={minutes}
          onChange={setMinutes}
          estimate={estimate}
          filmSec={filmSec}
          ratePerSec={RATE}
          hasHostPhoto
        />
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4 text-sm">
        <h2 className="font-medium">Confirm dialog</h2>
        {estimate.overGuide ? (
          <>
            <Alert
              tone="warning"
              className="text-xs"
              title="More talking head than the guide"
            >
              <p>
                {minutes} min of host is{" "}
                {Math.round((estimate.requestedSec / filmSec) * 100)}% of this ~
                {formatMinSec(filmSec)} film. The guide for this length is{" "}
                {formatMinSec(estimate.guideSec)} ({Math.round(GUIDE * 100)}%).
              </p>
              {override.clampedToMax && (
                <p>
                  Half the film is the most any video gets, so "anyway" means{" "}
                  {formatMinSec(override.budgetSec)}.
                </p>
              )}
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline">Cancel</Button>
              <Button className="bg-secondary text-secondary-foreground hover:bg-secondary/80">
                Use the guide — {formatMinSec(estimate.guideSec)}
              </Button>
              <Button>Use {formatMinSec(override.budgetSec)} anyway</Button>
            </div>
          </>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline">Cancel</Button>
            <Button>Generate</Button>
          </div>
        )}
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

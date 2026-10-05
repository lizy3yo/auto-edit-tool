import "@/index.css";
import { createRoot } from "react-dom/client";
import { JobWarnings } from "@/components/JobWarnings";

/**
 * The job card's warnings box on the card of 2026-10-05: 33 host warnings for one HeyGen
 * failure, each carrying HeyGen's JSON. Shows the grouped rows, "Details" and "Show all".
 */
const heygen = (asset: string) =>
  `HeyGen avatar registration failed (404): {"error":{"code":"asset_not_found","doc_url":"https://developers.heygen.com/docs/error-codes#asset-not-found","message":"Asset ${asset} not found"}}`;
const needed = (scene: number, asset: string) =>
  `Scene ${scene}: the host could not be rendered (${heygen(asset)}). It is the start, a CTA or the end, so it was not made b-roll — Regenerate it or make it b-roll yourself.`;
const broll = (scene: number, asset: string) =>
  `Scene ${scene}: the host lane could not render this beat (${heygen(asset)}) — made it b-roll automatically. Regenerate renders a different still; returning the host needs a fresh host render.`;

const WARNINGS = [
  "Scene 226: the big QR is only on screen for 5.4s of narration — add a line after the scan instruction (before ===END CTA===) so viewers have time to scan.",
  "Plan check 7 could not be fixed: flash shot 0.82s",
  "Plan check 7 could not be fixed: host take only 0.82s",
  "Plan check 11 could not be fixed: only 1% of cutaway time is moving",
  ...[22, 16, 20, 1, 18, 61, 10, 59].map(n =>
    needed(n, "cf4766654b8e4e239753cb3ee97e29d1")
  ),
  ...[219, 215, 226, 224, 222].map(n =>
    needed(n, "682ea6db1ef242e6a6bb33e9958612ae")
  ),
  ...[25, 40, 36].map(n => broll(n, "682ea6db1ef242e6a6bb33e9958612ae")),
  ...[48, 52, 46, 57, 55].map(n => broll(n, "471956cfdfcc4982b7a9420fe31c28d5")),
];

createRoot(document.getElementById("root")!).render(
  <div className="space-y-6">
    <section className="space-y-2 rounded-lg border p-4">
      <h2 className="text-sm font-medium">25 warnings, one cause</h2>
      <JobWarnings warnings={WARNINGS} />
    </section>
    <section className="space-y-2 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Two warnings (no "Show all")</h2>
      <JobWarnings warnings={WARNINGS.slice(0, 2)} />
    </section>
  </div>
);

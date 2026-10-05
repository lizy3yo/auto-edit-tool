import "@/index.css";
import { createRoot } from "react-dom/client";
import { JobPicks } from "@/components/JobPicks";
import { jobPickFacts } from "@shared/jobPicks";
import type { LongformInputParams } from "@shared/types";

/**
 * The job card's "Made with" block (`shared/jobPicks.ts`) on three videos: the 7-minute pick of
 * 2026-10-05, a video with every option used, and one made before the picks were saved.
 */
const script = Array.from({ length: 3400 }, () => "word").join(" ");
const base = {
  script,
  channelKey: "dale",
  voiceId: "v",
  lockMode: "none",
} as LongformInputParams;
const row = { userName: "Kirk", createdAt: "2026-10-05T14:02:00Z" };

const cases: [string, LongformInputParams, typeof row | undefined][] = [
  [
    "7 min picked (the card of 2026-10-05)",
    {
      ...base,
      faceImageUrl: "host.jpg",
      hostMinutes: 7,
      hostBudgetSec: 420,
      bookTitle: "The Board Book",
    },
    row,
  ],
  [
    "Own narration, 3 angles, two books, lowered to the guide, practice run",
    {
      ...base,
      script: script.slice(0, 2500),
      title: "Five boards that sell",
      manualNarrationUrl: "vo.mp3",
      faceImageUrls: ["a", "b", "c"],
      droppedHostPhotos: 1,
      hostMinutes: 3,
      hostBudgetSec: 130,
      ctaBooks: [
        { ctaIndex: 0, bookId: 1, title: "The Board Book" },
        { ctaIndex: 1, bookId: 2, title: "Weekend Projects That Sell" },
      ],
      rehearsal: true,
    },
    row,
  ],
  ["Made before the picks were saved", { ...base, script: "" }, undefined],
];

createRoot(document.getElementById("root")!).render(
  <div className="space-y-6">
    {cases.map(([title, params, r]) => (
      <section key={title} className="space-y-2 rounded-lg border p-4">
        <h2 className="text-sm font-medium">{title}</h2>
        <JobPicks
          facts={jobPickFacts(params, r)}
          channelName={r ? "Dale Oakfield" : undefined}
        />
      </section>
    ))}
  </div>
);

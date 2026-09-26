import { describe, it, expect, vi } from "vitest";

// The planner is pure; stub the modules the boot runner pulls in so importing it touches no DB.
vi.mock("./db", () => ({
  getProcessingLongformJobs: vi.fn(),
  updateLongformVideoJob: vi.fn(),
}));
vi.mock("./longformVideo", () => ({
  resumeTtsWait: vi.fn(),
  retryFailedScenes: vi.fn(),
  retryJobAssembly: vi.fn(),
  runLongformPipeline: vi.fn(),
}));

import {
  MAX_RESUME_AGE_MS,
  planRestartResume,
  resumeJobsAfterRestart,
  stillRunningElsewhere,
} from "./restartResume";
import { getProcessingLongformJobs, updateLongformVideoJob } from "./db";
import { runLongformPipeline } from "./longformVideo";

const NOW = Date.parse("2026-09-23T14:00:00Z");
const job = (over: Partial<Parameters<typeof planRestartResume>[0]> = {}) => ({
  stage: "clips",
  updatedAt: new Date(NOW - 60_000),
  inputParams: {},
  storyboard: [],
  ...over,
});
const scene = (over: Record<string, unknown> = {}) => ({
  index: 1,
  audioUrl: "https://r2/scene-1-vo.mp3",
  ...over,
});

describe("planRestartResume", () => {
  it("restarts the pipeline for a job cut off before the clip stage", () => {
    expect(planRestartResume(job({ stage: "storyboard" }), NOW).kind).toBe(
      "pipeline"
    );
    expect(
      planRestartResume(job({ stage: "voiceover", storyboard: [scene()] }), NOW)
        .kind
    ).toBe("pipeline");
  });

  it("picks a wait for the voice provider back up, even after a resume was spent", () => {
    const ttsWait = {
      since: new Date(NOW - 10 * 60_000).toISOString(),
      revoices: 0,
      lastError: "TTS failed",
      vendor: "69Labs",
    };
    for (const stage of ["voiceover", "storyboard"]) {
      expect(
        planRestartResume(
          job({
            stage,
            inputParams: { ttsWait, autoResumedAt: "2026-09-23T13:00:00Z" },
          }),
          NOW
        ).kind
      ).toBe("waitForTts");
    }
    // A board with clips is never restarted from the top, waiting or not.
    expect(
      planRestartResume(
        job({
          stage: "voiceover",
          inputParams: { ttsWait },
          storyboard: [scene({ clipUrls: ["c.mp4"] })],
        }),
        NOW
      ).kind
    ).toBe("giveUp");
  });

  it("never restarts from the top a board that already carries clips", () => {
    const a = planRestartResume(
      job({ stage: "voiceover", storyboard: [scene({ clipUrls: ["c.mp4"] })] }),
      NOW
    );
    expect(a.kind).toBe("giveUp");
  });

  it("retries the scenes of a clip-stage job with unrendered or in-flight scenes", () => {
    expect(
      planRestartResume(
        job({
          storyboard: [scene({ clipUrls: ["c.mp4"] }), scene({ index: 2 })],
        }),
        NOW
      ).kind
    ).toBe("retryScenes");
    expect(
      planRestartResume(
        job({
          storyboard: [scene({ clipUrls: ["c.mp4"], renderTaskIds: ["t1"] })],
        }),
        NOW
      ).kind
    ).toBe("retryScenes");
  });

  it("only assembles a clip-stage job whose every scene is rendered", () => {
    expect(
      planRestartResume(job({ storyboard: [scene({ clipUrl: "c.mp4" })] }), NOW)
        .kind
    ).toBe("assemble");
  });

  it("assembles a job cut off in assembly or after it", () => {
    expect(planRestartResume(job({ stage: "assembly" }), NOW).kind).toBe(
      "assemble"
    );
    expect(planRestartResume(job({ stage: "done" }), NOW).kind).toBe(
      "assemble"
    );
  });

  it("will not pay for voiceovers unattended: scenes missing narration give up", () => {
    const a = planRestartResume(
      job({ storyboard: [scene(), scene({ index: 2, audioUrl: undefined })] }),
      NOW
    );
    expect(a.kind).toBe("giveUp");
    expect(a.kind === "giveUp" && a.message).toMatch(/voiceovers/);
  });

  it("resumes a job once — a second restart gives up", () => {
    const a = planRestartResume(
      job({
        stage: "storyboard",
        inputParams: { autoResumedAt: "2026-09-23T13:00:00Z" },
      }),
      NOW
    );
    expect(a.kind).toBe("giveUp");
    expect(a.kind === "giveUp" && a.message).toMatch(/twice/);
  });

  it("gives up on a job idle past what providers keep", () => {
    const stale = job({ updatedAt: new Date(NOW - MAX_RESUME_AGE_MS - 1) });
    expect(planRestartResume(stale, NOW).kind).toBe("giveUp");
  });
});

describe("resumeJobsAfterRestart — a job another process is still running", () => {
  const row = (updatedAt: string) => ({
    id: 112,
    stage: "voiceover",
    updatedAt: new Date(updatedAt),
    inputParams: {},
    storyboard: [],
  });

  it("detects a heartbeat between the two reads", () => {
    expect(
      stillRunningElsewhere(
        { updatedAt: "2026-09-24T07:00:00Z" },
        { updatedAt: "2026-09-24T07:01:00Z" }
      )
    ).toBe(true);
    expect(
      stillRunningElsewhere(
        { updatedAt: "2026-09-24T07:00:00Z" },
        { updatedAt: new Date("2026-09-24T07:00:00Z") }
      )
    ).toBe(false);
  });

  it("leaves a heartbeating job alone and does not spend its one resume", async () => {
    vi.mocked(getProcessingLongformJobs)
      .mockResolvedValueOnce([row("2026-09-24T07:00:00Z")] as any)
      .mockResolvedValueOnce([row("2026-09-24T07:01:00Z")] as any);
    await resumeJobsAfterRestart(0);
    expect(runLongformPipeline).not.toHaveBeenCalled();
    expect(updateLongformVideoJob).not.toHaveBeenCalled();
  });

  it("resumes a job whose row did not move — nothing is running it", async () => {
    vi.mocked(runLongformPipeline).mockResolvedValue(undefined);
    vi.mocked(updateLongformVideoJob).mockResolvedValue(undefined as any);
    vi.mocked(getProcessingLongformJobs)
      .mockResolvedValueOnce([row("2026-09-24T07:00:00Z")] as any)
      .mockResolvedValueOnce([row("2026-09-24T07:00:00Z")] as any);
    await resumeJobsAfterRestart(0);
    expect(runLongformPipeline).toHaveBeenCalledWith(112);
  });
});

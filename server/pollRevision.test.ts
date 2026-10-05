import { describe, expect, it } from "vitest";
import { answerPoll, pollRevision } from "./pollRevision";

const job = {
  status: "processing",
  storyboard: [{ index: 0, clipUrl: null as string | null }],
};

describe("answerPoll", () => {
  it("sends everything to a page that holds nothing", () => {
    const answer = answerPoll(job, undefined);
    expect(answer).toMatchObject({ unchanged: false, status: "processing" });
    expect(answer.rev).toBe(pollRevision(job));
  });

  it("sends only the fingerprint when nothing changed", () => {
    const first = answerPoll(job, undefined);
    expect(answerPoll(structuredClone(job), first.rev)).toEqual({
      unchanged: true,
      rev: first.rev,
    });
  });

  it("sends everything again the moment anything changes", () => {
    const first = answerPoll(job, undefined);
    const next = {
      ...job,
      storyboard: [{ index: 0, clipUrl: "https://x/clip.mp4" }],
    };
    const answer = answerPoll(next, first.rev);
    expect(answer.unchanged).toBe(false);
    expect(answer.rev).not.toBe(first.rev);
  });

  it("treats a fingerprint it does not recognise as holding nothing", () => {
    expect(answerPoll(job, "stale").unchanged).toBe(false);
  });
});

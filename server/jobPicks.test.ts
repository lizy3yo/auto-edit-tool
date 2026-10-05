import { describe, expect, it } from "vitest";
import {
  PICK_NOT_RECORDED,
  hostPickLine,
  jobPickFacts,
  summarizeJobPicks,
  type JobPick,
} from "../shared/jobPicks";
import { summarizeHostSpend } from "../shared/hostSpend";
import type { LongformInputParams } from "../shared/types";

const SCRIPT = [
  "Hi, I'm Dale. [laughs] Today we build a board.",
  "===START CTA(The Board Book)===",
  "Grab the book below.",
  "===END CTA===",
  "See you next time.",
].join("\n");

const params = (extra: Partial<LongformInputParams> = {}) =>
  ({
    script: SCRIPT,
    channelKey: "dale",
    voiceId: "v",
    lockMode: "none",
    faceImageUrl: "https://x/host.jpg",
    ...extra,
  }) as LongformInputParams;

const row = { userName: "Kirk", createdAt: new Date("2026-10-05T14:02:00Z") };
const pick = (list: JobPick[], key: JobPick["key"]) =>
  list.find(p => p.key === key)!;

describe("what a video was made with", () => {
  // The card of 2026-10-05: the Cost screen read "of 7:00" under a form showing "3 min".
  it("says 7 minutes were picked when the video was made with 7", () => {
    const facts = jobPickFacts(
      params({ hostMinutes: 7, hostBudgetSec: 420 }),
      row
    );
    const host = pick(summarizeJobPicks(facts), "host");
    expect(host.value).toBe("7 min picked");
    expect(host.note).toBe("limit 7:00.");
    expect(
      summarizeHostSpend(
        params({ hostMinutes: 7, hostBudgetSec: 420 }),
        [],
        175
      )!.pickedMinutes
    ).toBe(7);
  });

  it("says when the pick was lowered for the video's length, or confirmed over the guide", () => {
    expect(
      hostPickLine({ hostMinutes: 3, hostBudgetSec: 130, brollOnly: false })
        .note
    ).toMatch(/^limit 2:10: lowered to the guide/);
    expect(
      hostPickLine({
        hostMinutes: 7,
        hostBudgetSec: 300,
        hostOverride: true,
        brollOnly: false,
      }).note
    ).toMatch(/^limit 5:00: half of this video/);
    expect(
      hostPickLine({
        hostMinutes: 5,
        hostBudgetSec: 300,
        hostOverride: true,
        brollOnly: false,
      }).note
    ).toBe("limit 5:00, confirmed over the guide.");
    // Before the clip stage there is a pick but no limit yet.
    expect(hostPickLine({ hostMinutes: 3, brollOnly: false }).note).toMatch(
      /once the voice is recorded/
    );
  });

  it("does not invent a pick for a video made before minutes were picked, or with no host", () => {
    expect(hostPickLine({ hostMinutes: null, brollOnly: false }).value).toBe(
      PICK_NOT_RECORDED
    );
    expect(hostPickLine({ hostMinutes: 3, brollOnly: true }).value).toBe(
      "No host (b-roll only)"
    );
    expect(summarizeHostSpend(params(), [], 0)).toBeNull();
  });

  it("names the voice by the option chosen on the form", () => {
    const voice = (extra: Partial<LongformInputParams>) =>
      pick(summarizeJobPicks(jobPickFacts(params(extra))), "voice").value;
    expect(voice({})).toBe("Channel voice");
    expect(voice({ ttsVendor: "minimax" })).toBe("MiniMax voice");
    // A supplied file wins: no vendor voiced anything.
    expect(
      voice({ ttsVendor: "minimax", manualNarrationUrl: "https://x/vo.mp3" })
    ).toBe("Your own narration file");
  });

  it("counts host photos and says when a ticked one was left out", () => {
    const photos = (extra: Partial<LongformInputParams>) =>
      pick(summarizeJobPicks(jobPickFacts(params(extra))), "photos");
    expect(photos({}).value).toBe("1 angle");
    expect(
      photos({ faceImageUrls: ["a", "b", "c"], droppedHostPhotos: 1 })
    ).toEqual({
      key: "photos",
      label: "Host photos",
      value: "3 angles",
      note: "1 ticked photo could not be loaded and was left out.",
    });
    expect(photos({ faceImageUrl: undefined }).value).toBe("None");
  });

  it("names the books picked for the video, else the channel's, else none", () => {
    const cta = (extra: Partial<LongformInputParams>) =>
      pick(summarizeJobPicks(jobPickFacts(params(extra))), "cta");
    expect(
      cta({
        bookTitle: "Channel Book",
        ctaBooks: [
          { ctaIndex: 0, bookId: 1, title: "The Board Book" },
          { ctaIndex: 1, bookId: 2, title: "Second" },
        ],
      }).value
    ).toBe('"The Board Book", "Second"');
    const channel = cta({ bookTitle: "Channel Book" });
    expect(channel.value).toBe('"Channel Book"');
    expect(channel.note).toMatch(/channel's book/);
    expect(cta({}).value).toBe("None");
  });

  it("counts only spoken words, shows the title and who made it", () => {
    const facts = jobPickFacts(params({ title: "Board build" }), row);
    // 8 + 4 + 4 spoken words: no marker lines, no [laughs].
    expect(facts.scriptWords).toBe(16);
    const list = summarizeJobPicks(facts, {
      channelName: "Dale Oakfield",
      formatDate: () => "5 Oct, 14:02",
    });
    expect(pick(list, "channel").value).toBe("Dale Oakfield");
    expect(pick(list, "title").value).toBe("Board build");
    expect(pick(list, "script").value).toBe("16 words");
    expect(pick(list, "madeBy")).toMatchObject({
      value: "Kirk",
      note: "5 Oct, 14:02",
    });
    expect(list.some(p => p.key === "practice")).toBe(false);
  });

  it("falls back to the channel key, 'Not set' and 'Not recorded' instead of blanks", () => {
    const list = summarizeJobPicks(jobPickFacts(params({ script: "" })));
    expect(pick(list, "channel").value).toBe("dale");
    expect(pick(list, "title").value).toBe("Not set");
    expect(pick(list, "script").value).toBe(PICK_NOT_RECORDED);
    expect(pick(list, "madeBy").value).toBe(PICK_NOT_RECORDED);
    expect(list.every(p => p.value.length > 0)).toBe(true);
  });

  it("marks a practice run", () => {
    const list = summarizeJobPicks(jobPickFacts(params({ rehearsal: true })));
    expect(pick(list, "practice").value).toBe("Yes");
  });

  it("never carries the script's text, a URL or a voice id to the browser", () => {
    const sent = JSON.stringify(
      jobPickFacts(
        params({ manualNarrationUrl: "https://x/vo.mp3", voiceId: "secret" }),
        row
      )
    );
    expect(sent).not.toMatch(/https?:|Today we build|secret/);
  });

  it("survives a job with no saved settings", () => {
    expect(() => summarizeJobPicks(jobPickFacts(null))).not.toThrow();
  });
});

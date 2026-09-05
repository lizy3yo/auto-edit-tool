import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync } from "fs";
import path from "path";
import type { StoryboardScene } from "../shared/types";

const sliceCalls: { startSec: number; lenSec: number }[][] = [];
const ffmpegCalls: string[][] = [];
const puts: string[] = [];
let probeDurations: number[] = [];
vi.mock("./videoAssembly", () => ({
  runFfmpeg: async (args: string[]) => {
    ffmpegCalls.push(args);
    writeFileSync(args[args.length - 1], "out");
  },
  downloadToTemp: async (_url: string, dir: string, name: string) => {
    const p = path.join(dir, name);
    writeFileSync(p, "dl");
    return p;
  },
  sliceAudioSegments: async (
    _url: string,
    segs: { startSec: number; lenSec: number }[]
  ) => {
    sliceCalls.push(segs);
    return segs.map((_, i) => Buffer.from(`slice-${i}`));
  },
  probeBufferDurationSec: async () => probeDurations.shift() ?? 1,
}));
vi.mock("./storage", () => ({
  storagePut: async (key: string) => {
    puts.push(key);
    return { url: `https://cdn/${key}` };
  },
}));
vi.mock("./lipsyncLead", () => ({
  prependSilence: async (b: Buffer) => Buffer.concat([Buffer.from("sil+"), b]),
}));

import {
  planLipsyncGroups,
  assignLipsyncGroups,
  buildGroupTrack,
  cutGroupPiece,
  GROUP_GAP_MS,
} from "./lipsyncBatch";

const host = (
  index: number,
  start: number,
  end: number,
  extra: Partial<StoryboardScene> = {}
): StoryboardScene =>
  ({
    index,
    narration: `s${index}`,
    visualPrompt: "",
    hostPresent: true,
    narrationStartSec: start,
    narrationEndSec: end,
    ...extra,
  }) as StoryboardScene;

beforeEach(() => {
  sliceCalls.length = 0;
  ffmpegCalls.length = 0;
  puts.length = 0;
  probeDurations = [];
});

describe("planLipsyncGroups", () => {
  const opts = { maxScenes: 3, maxSec: 14 };

  it("packs consecutive beats in storyboard order up to the size and length caps", () => {
    const g = planLipsyncGroups(
      [host(7, 30, 35), host(1, 0, 5), host(4, 12, 17), host(9, 40, 46)],
      opts
    );
    // 5 + 0.5 + 5 = 10.5 fits; adding 5 more (16) does not → new group.
    expect(g.map(x => [x.leader.index, x.members.map(m => m.index)])).toEqual([
      [1, [4]],
      [7, [9]],
    ]);
  });

  it("renders solo what cannot share a call: another photo, no master range, a resume, an over-long beat", () => {
    const g = planLipsyncGroups(
      [
        host(1, 0, 5),
        host(2, 5, 9, { hostShot: 1 }), // alt photo
        host(3, 9, 13, { hostShot: 1 }),
        host(4, 13, 14, {
          narrationStartSec: undefined,
          narrationEndSec: undefined,
          audioDuration: 1,
        }),
        host(5, 14, 18, { renderTaskIds: ["t"] }),
        host(6, 18, 40),
        host(7, 40, 44),
      ],
      opts
    );
    expect(g.map(x => [x.leader.index, x.members.map(m => m.index)])).toEqual([
      [1, []],
      [2, [3]],
      [4, []],
      [5, []],
      [6, []],
      [7, []],
    ]);
  });

  it("is one call per scene at batch 1", () => {
    const g = planLipsyncGroups([host(1, 0, 5), host(2, 5, 9)], {
      maxScenes: 1,
      maxSec: 14,
    });
    expect(g.every(x => x.members.length === 0)).toBe(true);
    expect(g).toHaveLength(2);
  });
});

describe("assignLipsyncGroups", () => {
  it("marks leaders and members and dispatches only leaders and solos", () => {
    const a = host(1, 0, 5);
    const b = host(2, 5, 9);
    const c = host(3, 20, 40);
    const r = assignLipsyncGroups([a, b, c], { maxScenes: 2, maxSec: 14 });
    expect(r.dispatch.map(s => s.index)).toEqual([1, 3]);
    expect(a.lipsyncGroup).toEqual({ leader: 1, members: [2] });
    expect(b.lipsyncGroup).toEqual({ leader: 1 });
    expect(c.lipsyncGroup).toBeUndefined();
    expect(r.membersOf.get(a)).toEqual([b]);
  });

  it("re-attaches a resumed member to its leader, and releases one whose leader is gone", () => {
    const leader = host(1, 0, 5, {
      lipsyncGroup: { leader: 1, members: [2], cuts: [] },
      renderTaskIds: ["task-1"],
    });
    const member = host(2, 5, 9, { lipsyncGroup: { leader: 1 } });
    const orphan = host(6, 30, 34, { lipsyncGroup: { leader: 5 } });
    const r = assignLipsyncGroups([leader, member, orphan], {
      maxScenes: 3,
      maxSec: 14,
    });
    expect(r.dispatch.map(s => s.index)).toEqual([1, 6]);
    expect(r.membersOf.get(leader)).toEqual([member]);
    expect(orphan.lipsyncGroup).toBeUndefined(); // renders solo, paid again, never lost
  });

  it("a leader whose members all completed renders solo", () => {
    const leader = host(1, 0, 5, {
      lipsyncGroup: { leader: 1, members: [2] },
    });
    const r = assignLipsyncGroups([leader], { maxScenes: 3, maxSec: 14 });
    expect(r.dispatch).toEqual([leader]);
    expect(leader.lipsyncGroup).toBeUndefined();
  });
});

describe("buildGroupTrack", () => {
  it("cuts every piece from the master in one pass and lays the cuts out with room-tone gaps", async () => {
    probeDurations = [5.02, 4.01];
    const leader = host(3, 10, 15);
    const member = host(5, 20, 24);
    const r = await buildGroupTrack({
      jobId: 9,
      leader,
      members: [member],
      masterAudioUrl: "https://r2/master.mp3",
      leadSec: 2,
    });
    // Lead [8,10), then each scene's own words.
    expect(sliceCalls[0]).toEqual([
      { startSec: 8, lenSec: 2 },
      { startSec: 10, lenSec: 5 },
      { startSec: 20, lenSec: 4 },
    ]);
    expect(r.cuts).toEqual([
      { index: 3, startSec: 0, durationSec: 5.02 },
      { index: 5, startSec: 5.02 + GROUP_GAP_MS / 1000, durationSec: 4.01 },
    ]);
    expect(r.leadSec).toBe(2);
    expect(r.totalSec).toBeCloseTo(2 + 5.02 + 0.5 + 4.01, 5);
    // The gap is room tone, not silence, and both tracks are stored.
    const graphs = ffmpegCalls.map(a => a[a.indexOf("-filter_complex") + 1]);
    expect(
      graphs.some(g => g.includes("anoisesrc") && g.includes("atrim=end=0.500"))
    ).toBe(true);
    expect(puts.some(k => /group-3-lipsync-vo-/.test(k))).toBe(true);
    expect(puts.some(k => /group-3-lipsync-narration-/.test(k))).toBe(true);
  });

  it("pads the lead with silence when the master has less than the run-up before the leader", async () => {
    probeDurations = [3];
    const r = await buildGroupTrack({
      jobId: 9,
      leader: host(1, 0.5, 3.5),
      members: [],
      masterAudioUrl: "https://r2/master.mp3",
      leadSec: 2,
    });
    expect(r.leadSec).toBe(2); // the trim is always the full lead
    expect(sliceCalls[0][0]).toEqual({ startSec: 0, lenSec: 0.5 });
  });

  it("refuses a scene with no master range", async () => {
    await expect(
      buildGroupTrack({
        jobId: 9,
        leader: host(1, 0, 5),
        members: [host(2, 0, 0)],
        masterAudioUrl: "https://r2/master.mp3",
        leadSec: 2,
      })
    ).rejects.toThrow(/no master range/);
  });
});

describe("cutGroupPiece", () => {
  it("cuts by start and length with a re-encode and the scene's own narration from time 0", async () => {
    await cutGroupPiece(
      Buffer.from("mp4"),
      { index: 5, startSec: 5.52, durationSec: 4.01 },
      "https://r2/scene-5-narration.mp3"
    );
    const args = ffmpegCalls[0];
    expect(args[args.indexOf("-ss") + 1]).toBe("5.520");
    expect(args[args.indexOf("-t") + 1]).toBe("4.010");
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    const joined = args.join(" ");
    expect(joined).toContain("-map 0:v");
    expect(joined).toContain("-map 1:a");
    expect(joined).toContain("libx264");
    expect(joined).not.toContain("-shortest");
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TAKEOVER_IDLE_MS,
  jobAccessRefusal,
  mayTakeOver,
  settleTakeover,
  type JobTakeover,
} from "../shared/jobTakeover";
import {
  activityAttention,
  sortActivity,
  type ActivityFacts,
} from "../shared/activity";

const job = { userId: 7 };
const owner = { id: 7, role: "editor" as const };
const otherEditor = { id: 8, role: "editor" as const };
const manager = { id: 2, role: "manager" as const };
const admin = { id: 1, role: "admin" as const };
const heldByManager: JobTakeover = {
  userId: manager.id,
  userName: "Mara",
  at: 1000,
  activeAt: 1000,
};

describe("who may touch a video", () => {
  it("its owner, an admin and a manager may read and change it", () => {
    for (const user of [owner, admin, manager])
      for (const mode of ["read", "write"] as const)
        expect(jobAccessRefusal(job, user, mode, null)).toBeNull();
  });

  it("another editor may do neither", () => {
    expect(jobAccessRefusal(job, otherEditor, "read", null)).toEqual({
      kind: "notYours",
    });
    expect(jobAccessRefusal(job, otherEditor, "write", null)).toEqual({
      kind: "notYours",
    });
  });
});

describe("a taken-over video", () => {
  it("pauses its owner's changes and names who has it", () => {
    expect(jobAccessRefusal(job, owner, "write", heldByManager)).toEqual({
      kind: "takenOver",
      byName: "Mara",
    });
  });

  it("still lets its owner watch", () => {
    expect(jobAccessRefusal(job, owner, "read", heldByManager)).toBeNull();
  });

  it("lets the person who took it change it", () => {
    expect(jobAccessRefusal(job, manager, "write", heldByManager)).toBeNull();
  });

  it("pauses everyone else too — a second admin clicking is the same double spend", () => {
    expect(jobAccessRefusal(job, admin, "write", heldByManager)).toEqual({
      kind: "takenOver",
      byName: "Mara",
    });
    expect(jobAccessRefusal(job, admin, "read", heldByManager)).toBeNull();
  });

  it("is never a way in for an editor who could not see it anyway", () => {
    expect(jobAccessRefusal(job, otherEditor, "read", heldByManager)).toEqual({
      kind: "notYours",
    });
  });
});

describe("who may take a video over", () => {
  it("an admin or manager, on someone else's video", () => {
    expect(mayTakeOver(job, admin)).toBe(true);
    expect(mayTakeOver(job, manager)).toBe(true);
  });

  it("never an editor, and never your own video", () => {
    expect(mayTakeOver(job, otherEditor)).toBe(false);
    expect(mayTakeOver({ userId: admin.id }, admin)).toBe(false);
  });
});

describe("a takeover hands itself back", () => {
  const t: JobTakeover = { ...heldByManager, at: 0, activeAt: 0 };

  it("stays while its holder is around", () => {
    expect(settleTakeover(t, "failed", TAKEOVER_IDLE_MS)).toBe(t);
  });

  it("is released 30 minutes after its holder was last there", () => {
    expect(settleTakeover(t, "failed", TAKEOVER_IDLE_MS + 1)).toBeNull();
  });

  it("is released when the video it re-ran finishes", () => {
    const running = settleTakeover(t, "processing", 10)!;
    expect(running.sawProcessing).toBe(true);
    expect(settleTakeover(running, "completed", 20)).toBeNull();
  });

  it("is kept on a finished video taken over to fix a scene — it never ran", () => {
    expect(settleTakeover(t, "completed", 10)).toBe(t);
  });

  it("is kept when the re-run fails again: it still needs fixing", () => {
    const running = settleTakeover(t, "processing", 10)!;
    expect(settleTakeover(running, "failed", 20)).toBe(running);
  });
});

describe("what needs attention", () => {
  const facts = (over: Partial<ActivityFacts>): ActivityFacts => ({
    status: "processing",
    waitingForVoice: false,
    hostNeeded: false,
    hostWaiting: false,
    ...over,
  });

  it("a video that is simply running or finished does not", () => {
    expect(activityAttention(facts({}))).toBeNull();
    expect(activityAttention(facts({ status: "completed" }))).toBeNull();
  });

  it("a failed video does", () => {
    expect(
      activityAttention(facts({ status: "failed", errorMessage: "boom" }))
    ).toBe("Failed");
  });

  it("a video its maker cancelled does not", () => {
    expect(
      activityAttention(
        facts({ status: "failed", errorMessage: "Cancelled by user" })
      )
    ).toBeNull();
  });

  it("a running video stuck waiting does, and says on what", () => {
    expect(activityAttention(facts({ waitingForVoice: true }))).toMatch(
      /voice/
    );
    expect(activityAttention(facts({ hostWaiting: true }))).toMatch(/HeyGen/);
    expect(
      activityAttention(facts({ status: "failed", hostNeeded: true }))
    ).toMatch(/Host needed/);
  });

  it("lists what needs someone first, then what is running, newest first", () => {
    const at = (min: number) => new Date(2026, 0, 1, 0, min);
    const sorted = sortActivity([
      { id: 1, attention: null, status: "completed", updatedAt: at(9) },
      { id: 2, attention: null, status: "processing", updatedAt: at(1) },
      { id: 3, attention: "Failed", status: "failed", updatedAt: at(2) },
      { id: 4, attention: null, status: "processing", updatedAt: at(5) },
      { id: 5, attention: "Failed", status: "failed", updatedAt: at(7) },
    ]);
    expect(sorted.map(i => i.id)).toEqual([5, 3, 4, 2, 1]);
  });
});

/**
 * TRIPWIRE. Every route that takes a `jobId` goes through `assertJobAccess` — the one check that
 * knows who owns a video AND who has taken it over. Two routes had no check at all before it
 * existed ("Make host", a paid render, and the cost breakdown), and an inline ownership test
 * would let a paused owner keep clicking.
 */
describe("one permission check", () => {
  const source = readFileSync(path.join(__dirname, "routers.ts"), "utf8");

  it("routers.ts carries no inline ownership test", () => {
    expect(source).not.toMatch(
      /\b(?:job|owner)(?:\[0\])?\.userId\s*[!=]==\s*ctx\.user\.id/
    );
  });

  it("every route with a jobId input calls assertJobAccess", () => {
    // Routes that take a job id but are not an action on that job by its owner.
    const exempt = new Set([
      "setSlot", // which job a TAB shows — the user's own workspace
      "previewQr", // the number only tags a link; no job is read
      "takeOver", // the takeover itself: `mayTakeOver`
      "handBack",
    ]);
    const starts = [
      ...source.matchAll(
        /^  ([a-zA-Z0-9_]+): (?:approved|manager|admin|public|protected)Procedure/gm
      ),
    ];
    const unchecked = starts
      .map((m, i) => ({
        name: m[1],
        body: source.slice(m.index!, starts[i + 1]?.index ?? source.length),
      }))
      .filter(
        r =>
          /\bjobId: z\.number\(\)/.test(r.body) &&
          !exempt.has(r.name) &&
          !r.body.includes("assertJobAccess(")
      )
      .map(r => r.name);
    expect(unchecked).toEqual([]);
  });

  // "Clean host clips" is admin only (`canCleanHostClips`). The card hides the button from
  // everyone else; the route must refuse them too, or it could still be called directly.
  it("cleanHostClips refuses everyone but an admin", () => {
    const start = source.indexOf("  cleanHostClips: ");
    expect(start).toBeGreaterThan(-1);
    // Everything in the route up to where the cleaning starts.
    const work = source.indexOf("steadyLongformJobHostClips(", start);
    expect(work).toBeGreaterThan(start);
    expect(source.slice(start, work)).toContain(
      "canCleanHostClips(ctx.user.role)"
    );
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getChannelConfig: vi.fn(async (key: string) =>
    key === "mine"
      ? { createdBy: 3 }
      : key === "theirs"
        ? { createdBy: 2 }
        : key === "old"
          ? { createdBy: null }
          : null
  ),
  getHeygenTestBatch: vi.fn(async (batchId: string) =>
    batchId === "mine"
      ? [{ userId: 3 }]
      : batchId === "theirs"
        ? [{ userId: 2 }]
        : []
  ),
}));

import { getChannelConfig, getHeygenTestBatch } from "./db";
import {
  assertChannelEditable,
  assertItemEditable,
  assertMayEdit,
  assertRunEditable,
  canEditChannel,
} from "./ownership";

const guest = { id: 3, role: "guest" as const, managerAccess: true };
const manager = { id: 2, role: "manager" as const };
const admin = { id: 1, role: "admin" as const };

describe("a guest changes only what they created", () => {
  it("their own channel, and nobody else's", async () => {
    await expect(assertChannelEditable(guest, "mine")).resolves.toBeUndefined();
    await expect(assertChannelEditable(guest, "theirs")).rejects.toThrow(
      /View only/
    );
    expect(await canEditChannel(guest, "mine")).toBe(true);
    expect(await canEditChannel(guest, "theirs")).toBe(false);
  });

  it("a channel with no recorded maker, or that does not exist, is nobody's", async () => {
    await expect(assertChannelEditable(guest, "old")).rejects.toThrow(
      /View only/
    );
    await expect(assertChannelEditable(guest, "missing")).rejects.toThrow(
      /View only/
    );
  });

  it("their own book, asset or host photo, and nobody else's", async () => {
    await expect(
      assertItemEditable(guest, async () => ({ createdBy: 3 }))
    ).resolves.toBeUndefined();
    for (const row of [{ createdBy: 2 }, { createdBy: null }, null])
      await expect(assertItemEditable(guest, async () => row)).rejects.toThrow(
        /View only/
      );
  });

  it("their own test or VSL run, and nobody else's", async () => {
    await expect(assertRunEditable(guest, "mine")).resolves.toBeUndefined();
    await expect(assertRunEditable(guest, "theirs")).rejects.toThrow(
      /View only/
    );
    await expect(assertRunEditable(guest, "gone")).rejects.toThrow(/View only/);
  });
});

describe("nobody else is bound by it", () => {
  it("an admin and a manager change anything, and no owner is looked up", async () => {
    vi.mocked(getChannelConfig).mockClear();
    vi.mocked(getHeygenTestBatch).mockClear();
    const load = vi.fn(async () => ({ createdBy: 99 }));
    for (const user of [admin, manager]) {
      expect(() => assertMayEdit(user, 99)).not.toThrow();
      expect(() => assertMayEdit(user, null)).not.toThrow();
      await expect(
        assertChannelEditable(user, "theirs")
      ).resolves.toBeUndefined();
      await expect(assertItemEditable(user, load)).resolves.toBeUndefined();
      await expect(assertRunEditable(user, "theirs")).resolves.toBeUndefined();
      expect(await canEditChannel(user, "old")).toBe(true);
    }
    expect(getChannelConfig).not.toHaveBeenCalled();
    expect(getHeygenTestBatch).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
});

/**
 * TRIPWIRE. A guest reaches every operations manager route, so every one of those that CHANGES
 * something must ask who created it. A changing route added behind `managerProcedure` with no
 * ownership check would let a guest edit what they did not create with nothing failing.
 */
describe("every changing route asks who created it", () => {
  const source = readFileSync(path.join(__dirname, "routers.ts"), "utf8");
  const starts = [
    ...source.matchAll(
      /^  ([a-zA-Z0-9_]+): (approved|manager|remover|sharedSettings|admin|public|protected)Procedure/gm
    ),
  ];
  const routes = starts.map((m, i) => ({
    name: m[1],
    gate: m[2],
    body: source.slice(m.index!, starts[i + 1]?.index ?? source.length),
  }));
  const route = (name: string, containing: string) =>
    routes.find(r => r.name === name && r.body.includes(containing));

  const OWNERSHIP_CHECK =
    /assert(?:ChannelEditable|ItemEditable|RunEditable|JobAccess)\(|mayTakeOver\(/;

  it("each manager-gated change checks ownership, or only creates something new", () => {
    // Routes that make something new for the caller (or give back what the caller holds), so
    // there is no earlier owner to ask about.
    const createsOnly = new Set([
      "create", // a new channel, stamped with its maker
      "start", // a new HeyGen test or VSL run, the caller's own
      "handBack", // releases a takeover, which a guest can never hold
    ]);
    const unchecked = routes
      .filter(
        r =>
          r.gate === "manager" &&
          r.body.includes(".mutation(") &&
          !createsOnly.has(r.name) &&
          !OWNERSHIP_CHECK.test(r.body)
      )
      .map(r => r.name);
    expect(unchecked).toEqual([]);
  });

  it("the channel writes open to every role check ownership too", () => {
    for (const name of ["setVoiceTuning", "setPrimary", "setSelected"]) {
      const r = routes.find(x => x.name === name);
      expect(r, name).toBeTruthy();
      expect(r!.body, name).toContain("assertChannelEditable(ctx.user");
    }
  });

  it("books, assets and host photos check the channel AND the item", () => {
    const saves = routes.filter(r => r.name === "save" && r.gate === "manager");
    expect(saves).toHaveLength(3);
    for (const r of saves) {
      expect(r.body).toContain("assertChannelEditable(ctx.user");
      expect(r.body).toContain("assertItemEditable(ctx.user");
      expect(r.body).toContain("createdBy: ctx.user.id");
    }
  });

  it("a new channel records who made it", () => {
    expect(route("create", "createChannelConfig(")!.body).toContain(
      "createdBy: ctx.user.id"
    );
  });

  it("generate saves a book to the channel only for someone who may change it", () => {
    const generate = route("generate", "saveToChannel")!;
    const save = generate.body.indexOf("createBook(");
    expect(save).toBeGreaterThan(-1);
    expect(generate.body.slice(0, save)).toContain(
      "canEditChannel(ctx.user, input.channelKey)"
    );
  });

  it("the shared settings are behind their own gate", () => {
    for (const name of ["setInstructionPrompt", "setPacing"])
      expect(routes.find(r => r.name === name)?.gate, name).toBe(
        "sharedSettings"
      );
  });
});

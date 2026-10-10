import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROLES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  canCleanHostClips,
  canEditSharedSettings,
  canManageChannels,
  canManageKeys,
  canOpenAdmin,
  canRemove,
  canSeeAllJobs,
  hasManagerAccess,
  isRole,
  mayEditOwned,
  type Account,
} from "./roles";
import { canOverrideHostRegenLimit } from "./hostRegenLimit";

/**
 * These predicates are the ONE definition the tRPC gates (`server/_core/trpc.ts`) and the nav
 * (`client/src/App.tsx`) both answer from. A change here silently changes who can do what, in
 * both places at once — so the table is pinned.
 *
 * A guest appears twice: their "Operations manager access" switch on, and off.
 */
describe("role capabilities", () => {
  const matrix: Record<
    string,
    {
      account: Account;
      keys: boolean;
      channels: boolean;
      allJobs: boolean;
      admin: boolean;
      remove: boolean;
      pastHostLimit: boolean;
      /** Changes what someone else created, and the settings every video shares. */
      editsOthers: boolean;
    }
  > = {
    admin: {
      account: { role: "admin" },
      keys: true,
      channels: true,
      allJobs: true,
      admin: true,
      remove: true,
      pastHostLimit: true,
      editsOthers: true,
    },
    manager: {
      account: { role: "manager" },
      keys: false,
      channels: true,
      allJobs: true,
      admin: true,
      remove: true,
      pastHostLimit: true,
      editsOthers: true,
    },
    "guest, access on": {
      account: { role: "guest", managerAccess: true },
      keys: false,
      channels: true,
      allJobs: true,
      admin: true,
      remove: false,
      pastHostLimit: false,
      editsOthers: false,
    },
    "guest, access off": {
      account: { role: "guest", managerAccess: false },
      keys: false,
      channels: false,
      allJobs: false,
      admin: false,
      remove: false,
      pastHostLimit: false,
      editsOthers: false,
    },
    editor: {
      account: { role: "editor" },
      keys: false,
      channels: false,
      allJobs: false,
      admin: false,
      remove: true,
      pastHostLimit: false,
      // Never refused by the ownership rule: the gate in front of each route is what stops an
      // editor, who reaches no manager route at all.
      editsOthers: true,
    },
  };

  it("the table covers every role", () => {
    const covered = new Set(Object.values(matrix).map(m => m.account.role));
    expect([...covered].sort()).toEqual([...ROLES].sort());
  });

  for (const [name, want] of Object.entries(matrix)) {
    const { account } = want;
    it(`${name}: provider keys and accounts`, () => {
      expect(canManageKeys(account.role)).toBe(want.keys);
    });
    it(`${name}: channels, books and directing`, () => {
      expect(canManageChannels(account)).toBe(want.channels);
    });
    it(`${name}: every account's renders`, () => {
      expect(canSeeAllJobs(account)).toBe(want.allJobs);
    });
    it(`${name}: opens the Admin page`, () => {
      expect(canOpenAdmin(account)).toBe(want.admin);
    });
    it(`${name}: removes things`, () => {
      expect(canRemove(account.role)).toBe(want.remove);
    });
    it(`${name}: changes what someone else created`, () => {
      const me = { id: 7, ...account };
      expect(mayEditOwned(me, 8)).toBe(want.editsOthers);
      // Nobody's (older than the created-by columns) counts as someone else's.
      expect(mayEditOwned(me, null)).toBe(want.editsOthers);
      expect(mayEditOwned(me, undefined)).toBe(want.editsOthers);
      // What they created themselves is always theirs to change.
      expect(mayEditOwned(me, 7)).toBe(true);
    });
    it(`${name}: changes the settings every video shares`, () => {
      expect(canEditSharedSettings(account)).toBe(
        want.editsOthers && want.channels
      );
    });
    it(`${name}: renders a host beat past its limit`, () => {
      expect(canOverrideHostRegenLimit(account.role)).toBe(want.pastHostLimit);
    });
  }

  it("only admins reach the keys", () => {
    expect(ROLES.filter(canManageKeys)).toEqual(["admin"]);
  });

  it("only admins clean host clips", () => {
    expect(ROLES.filter(canCleanHostClips)).toEqual(["admin"]);
  });

  it("only a guest can never remove", () => {
    expect(ROLES.filter(role => !canRemove(role))).toEqual(["guest"]);
  });

  it("a guest's access is off unless the switch is exactly on", () => {
    expect(hasManagerAccess({ role: "guest" })).toBe(false);
    expect(hasManagerAccess({ role: "guest", managerAccess: null })).toBe(
      false
    );
    expect(hasManagerAccess({ role: "guest", managerAccess: true })).toBe(true);
  });

  it("the switch changes nothing on any other role", () => {
    for (const role of ["admin", "manager"] as const)
      expect(hasManagerAccess({ role, managerAccess: false })).toBe(true);
    expect(hasManagerAccess({ role: "editor", managerAccess: true })).toBe(
      false
    );
  });

  it("every role is labelled and described", () => {
    for (const role of ROLES) {
      expect(ROLE_LABEL[role]).toBeTruthy();
      expect(ROLE_DESCRIPTION[role]).toBeTruthy();
    }
  });
});

describe("isRole", () => {
  it("accepts the four tiers and nothing else", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    for (const bad of ["", "Admin", "owner", "superuser", 1, null, undefined]) {
      expect(isRole(bad)).toBe(false);
    }
  });
});

/**
 * TRIPWIRE. A guest reaches everything an operations manager does EXCEPT removing — so every
 * route that removes something must sit behind a gate that asks `canRemove`. A remove route
 * added later behind `managerProcedure` would hand a guest a delete with nothing failing.
 */
describe("every remove route refuses a guest", () => {
  const source = readFileSync(
    path.join(__dirname, "..", "server", "routers.ts"),
    "utf8"
  );
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
  const removes = routes.filter(r =>
    /^(delete|remove|deactivate|purge|erase|destroy)/i.test(r.name)
  );

  it("finds the remove routes", () => {
    expect(removes.map(r => r.name).sort()).toEqual([
      "deactivate",
      "deactivate",
      "deactivate",
      "delete",
      "delete",
      "delete",
      "deleteBatch",
      "deleteJob",
    ]);
  });

  it("each is admin only, behind the remove gate, or asks canRemove itself", () => {
    const open = removes
      .filter(
        r =>
          r.gate !== "admin" &&
          r.gate !== "remover" &&
          !r.body.includes("canRemove(ctx.user.role)")
      )
      .map(r => r.name);
    expect(open).toEqual([]);
  });

  it("the remove gate asks canRemove", () => {
    const trpc = readFileSync(
      path.join(__dirname, "..", "server", "_core", "trpc.ts"),
      "utf8"
    );
    const start = trpc.indexOf("export const removerProcedure");
    expect(start).toBeGreaterThan(-1);
    const end = trpc.indexOf("export const", start + 1);
    expect(trpc.slice(start, end)).toContain("canRemove(account.role)");
  });
});

import { describe, expect, it } from "vitest";
import {
  ROLES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  canManageChannels,
  canManageKeys,
  canOpenAdmin,
  canSeeAllJobs,
  isRole,
} from "./roles";

/**
 * These predicates are the ONE definition the tRPC gates (`server/_core/trpc.ts`) and the nav
 * (`client/src/App.tsx`) both answer from. A change here silently changes who can do what, in
 * both places at once — so the table is pinned.
 */
describe("role capabilities", () => {
  const matrix = {
    admin: {
      keys: true,
      channels: true,
      allJobs: true,
      admin: true,
    },
    manager: {
      keys: false,
      channels: true,
      allJobs: true,
      admin: true,
    },
    editor: {
      keys: false,
      channels: false,
      allJobs: false,
      admin: false,
    },
  } as const;

  for (const role of ROLES) {
    it(`${role}: provider keys and accounts`, () => {
      expect(canManageKeys(role)).toBe(matrix[role].keys);
    });
    it(`${role}: channels, books and directing`, () => {
      expect(canManageChannels(role)).toBe(matrix[role].channels);
    });
    it(`${role}: every account's renders`, () => {
      expect(canSeeAllJobs(role)).toBe(matrix[role].allJobs);
    });
    it(`${role}: opens the Admin page`, () => {
      expect(canOpenAdmin(role)).toBe(matrix[role].admin);
    });
  }

  it("only admins reach the keys", () => {
    expect(ROLES.filter(canManageKeys)).toEqual(["admin"]);
  });

  it("every role is labelled and described", () => {
    for (const role of ROLES) {
      expect(ROLE_LABEL[role]).toBeTruthy();
      expect(ROLE_DESCRIPTION[role]).toBeTruthy();
    }
  });
});

describe("isRole", () => {
  it("accepts the three tiers and nothing else", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    for (const bad of ["", "Admin", "owner", "superuser", 1, null, undefined]) {
      expect(isRole(bad)).toBe(false);
    }
  });
});

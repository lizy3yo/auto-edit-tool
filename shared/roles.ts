/**
 * The three tiers the studio is operated at, and every question the app asks about them.
 *
 * Shared rather than server-only so the nav, the Admin tab strip and the tRPC gates all answer
 * from ONE definition. A capability the client hides must still be refused by the server —
 * these helpers are what both sides call, so the two cannot drift apart.
 */
export const ROLES = ["admin", "manager", "editor"] as const;

export type Role = (typeof ROLES)[number];

export type AccountStatus = "active" | "disabled";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Project manager",
  editor: "Editor",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: "Full access, including provider API keys and account management.",
  manager:
    "Channels, books, CTA assets, directing instruction and pacing, plus every render. No API keys.",
  editor: "Long-form video and the library, limited to their own renders.",
};

export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" && (ROLES as readonly string[]).includes(value)
  );
}

/** Provider API keys, account management, mock mode — the admin-only surface. */
export function canManageKeys(role: Role): boolean {
  return role === "admin";
}

/** Channels, books, CTA assets, the directing instruction and pacing. */
export function canManageChannels(role: Role): boolean {
  return role === "admin" || role === "manager";
}

/**
 * Whether the library, history and per-job editors span every account.
 *
 * Editors are scoped to their own renders — their own five tabs, their own library. Admins and
 * project managers oversee all of them.
 */
export function canSeeAllJobs(role: Role): boolean {
  return role === "admin" || role === "manager";
}

/** Whether the Admin page is reachable at all (managers get it minus keys and accounts). */
export function canOpenAdmin(role: Role): boolean {
  return role === "admin" || role === "manager";
}

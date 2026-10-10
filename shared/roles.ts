/**
 * The four tiers the studio is operated at, and every question the app asks about them.
 *
 * Shared rather than server-only so the nav, the Admin tab strip and the tRPC gates all answer
 * from ONE definition. A capability the client hides must still be refused by the server —
 * these helpers are what both sides call, so the two cannot drift apart.
 */
export const ROLES = ["admin", "manager", "guest", "editor"] as const;

export type Role = (typeof ROLES)[number];

export type AccountStatus = "active" | "disabled";

/**
 * What a capability question is asked of: the role, plus the one per-account switch.
 *
 * `managerAccess` only means something on a GUEST (Admin → Users, "Operations manager access").
 * It is denied unless it is exactly `true`, so an account read without the column answers no.
 */
export type Account = { role: Role; managerAccess?: boolean | null };

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Operations manager",
  guest: "Guest",
  editor: "Editor",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: "Full access, including provider API keys and account management.",
  manager:
    "Channels, books, CTA assets, directing instruction and pacing, plus every render. No API keys.",
  guest:
    "An operations manager who can never delete anything or render past the host limit. Their access to the manager pages is switched on or off per account.",
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

/**
 * The operations manager's reach: admins and operations managers always, a guest only while
 * their switch is on. Every manager capability below answers from this one line.
 */
export function hasManagerAccess(account: Account): boolean {
  if (account.role === "admin" || account.role === "manager") return true;
  return account.role === "guest" && account.managerAccess === true;
}

/** Channels, books, CTA assets, the directing instruction and pacing. */
export function canManageChannels(account: Account): boolean {
  return hasManagerAccess(account);
}

/**
 * Whether the library, history and per-job editors span every account.
 *
 * Editors are scoped to their own renders — their own five tabs, their own library. Admins and
 * operations managers oversee all of them, and so does a guest whose switch is on.
 */
export function canSeeAllJobs(account: Account): boolean {
  return hasManagerAccess(account);
}

/**
 * Whether this role may remove anything at all — a channel, a book, a CTA asset, a host photo,
 * a test or VSL run, a video (their own included). A guest never may. WHAT a role that may
 * remove can reach is still decided by the gate in front of each route.
 */
export function canRemove(role: Role): boolean {
  return role !== "guest";
}

/**
 * "Clean host clips" on a video's card: it re-processes every host clip of a finished video and
 * rebuilds the film, so it is an admin's tool. The button and the route both ask here.
 */
export function canCleanHostClips(role: Role): boolean {
  return role === "admin";
}

/** Whether the Admin page is reachable at all (managers get it minus keys and accounts). */
export function canOpenAdmin(account: Account): boolean {
  return hasManagerAccess(account);
}

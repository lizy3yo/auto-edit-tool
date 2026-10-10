import {
  CANNOT_REMOVE_ERR_MSG,
  NOT_ADMIN_ERR_MSG,
  UNAUTHED_ERR_MSG,
} from "@shared/const";
import { canManageChannels, canRemove, type Account } from "@shared/roles";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

/**
 * One gate, parameterised by the capability being asked for.
 *
 * The exported procedures below are the ONLY way a router expresses permission, and each
 * answers from `shared/roles.ts` — the same predicates the client hides its nav with. A tier
 * added there cannot silently gain access here.
 */
const requireRole = (allow: (account: Account) => boolean, message: string) =>
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    // A disabled account is already refused at `authenticateRequest`; this is the second lock
    // on the same door, for the case where a session was resolved before the switch flipped.
    if (ctx.user.status !== "active") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your account has been disabled. Contact an admin.",
      });
    }
    if (!allow(ctx.user)) {
      throw new TRPCError({ code: "FORBIDDEN", message });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  });

/**
 * Any active account: long-form video and the library, which every tier gets. Reads and writes
 * behind it are still scoped per-account — an editor sees their own renders (see
 * `canSeeAllJobs`).
 */
export const approvedProcedure = t.procedure.use(
  requireRole(() => true, NOT_ADMIN_ERR_MSG)
);

/**
 * Admin or operations manager — and a guest whose switch is on: channels, books, CTA assets,
 * the directing instruction, pacing, and oversight of every render. Never provider API keys —
 * those stay on `adminProcedure`.
 */
export const managerProcedure = t.procedure.use(
  requireRole(canManageChannels, NOT_ADMIN_ERR_MSG)
);

/**
 * `managerProcedure` for a route that REMOVES something (a channel, a book, a CTA asset, a host
 * photo, a test or VSL run). A guest reaches everything else a manager does and never these;
 * a tripwire in `roles.test.ts` fails if a remove route is put behind another gate.
 */
export const removerProcedure = t.procedure.use(
  requireRole(
    account => canManageChannels(account) && canRemove(account.role),
    CANNOT_REMOVE_ERR_MSG
  )
);

/** Admin only: provider API keys, mock mode, and account management. */
export const adminProcedure = t.procedure.use(
  requireRole(account => account.role === "admin", NOT_ADMIN_ERR_MSG)
);

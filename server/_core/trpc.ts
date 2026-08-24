import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { canManageChannels, type Role } from "@shared/roles";
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
 * The three exported procedures below are the ONLY way a router expresses permission, and each
 * answers from `shared/roles.ts` — the same predicates the client hides its nav with. A tier
 * added there cannot silently gain access here.
 */
const requireRole = (allow: (role: Role) => boolean, message: string) =>
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
    if (!allow(ctx.user.role)) {
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
 * Admin or operations manager: channels, books, CTA assets, the directing instruction, pacing,
 * and oversight of every render. Never provider API keys — those stay on `adminProcedure`.
 */
export const managerProcedure = t.procedure.use(
  requireRole(canManageChannels, NOT_ADMIN_ERR_MSG)
);

/** Admin only: provider API keys, mock mode, and account management. */
export const adminProcedure = t.procedure.use(
  requireRole(role => role === "admin", NOT_ADMIN_ERR_MSG)
);

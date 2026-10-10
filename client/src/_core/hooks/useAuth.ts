import { trpc } from "@/lib/trpc";
import {
  canManageChannels,
  canManageKeys,
  canOpenAdmin,
  canRemove,
  canSeeAllJobs,
  type Role,
} from "@shared/roles";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/" } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    localStorage.setItem("user-info", JSON.stringify(meQuery.data));
    // Null until `auth.me` resolves. Every capability below reads false while it is, so a
    // half-loaded page never flashes a tab the account is not entitled to.
    const role = (meQuery.data?.role ?? null) as Role | null;
    // The role plus a guest's "Operations manager access" switch — what the manager
    // capabilities are asked of (`Account` in `shared/roles.ts`).
    const account = role
      ? { role, managerAccess: meQuery.data?.managerAccess }
      : null;
    return {
      user: meQuery.data ?? null,
      role,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
      // Answered from `shared/roles.ts` — the same predicates the tRPC procedures gate on, so
      // what the UI hides and what the server refuses cannot drift apart.
      isAdmin: role === "admin",
      canManageKeys: role ? canManageKeys(role) : false,
      canManageChannels: account ? canManageChannels(account) : false,
      canSeeAllJobs: account ? canSeeAllJobs(account) : false,
      canOpenAdmin: account ? canOpenAdmin(account) : false,
      // False for a guest: every delete button asks here, and the server refuses them too.
      canRemove: role ? canRemove(role) : false,
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath;
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}

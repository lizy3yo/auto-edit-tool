import { useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { canEditSharedSettings, mayEditOwned } from "@shared/roles";

/** Shown wherever a control is hidden or paused because the account did not create the thing. */
export const VIEW_ONLY_NOTE =
  "View only. Your account can change only what it created.";

/**
 * "May I change what this account created?" — the screens' half of `mayEditOwned`
 * (`shared/roles.ts`), the rule the server refuses by. Only a guest is ever told no. False
 * until `auth.me` resolves, so a control never flashes for an account that may not use it.
 */
export function useMayEdit(): (ownerId: number | null | undefined) => boolean {
  const { user } = useAuth();
  return useCallback(
    (ownerId: number | null | undefined) =>
      !!user && mayEditOwned(user, ownerId),
    [user]
  );
}

/**
 * Whether this account may change a CHANNEL — its settings, and what it holds (books, CTA
 * assets, host photos, the ticked camera angles). True while the channel list is loading for
 * every account the rule does not bind, so nothing is paused for them in the meantime.
 */
export function useCanEditChannel(channelKey: string | null | undefined) {
  const { user } = useAuth();
  const bound = !!user && !mayEditOwned(user, null);
  const { data: channels } = trpc.channelConfig.listAllChannels.useQuery(
    undefined,
    { enabled: bound && !!channelKey, staleTime: 30_000 }
  );
  if (!user) return false;
  if (!bound) return true;
  const channel = channels?.find(c => c.key === channelKey);
  return mayEditOwned(user, channel?.createdBy);
}

/** Whether this account may change the settings every video shares (instruction, pacing). */
export function useCanEditSharedSettings(): boolean {
  const { user } = useAuth();
  return !!user && canEditSharedSettings(user);
}

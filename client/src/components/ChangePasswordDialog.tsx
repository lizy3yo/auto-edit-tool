import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Kept in step with `MIN_PASSWORD_LENGTH` in `server/passwords.ts`, which is the real gate. */
const MIN_LENGTH = 8;

/**
 * Change your own password.
 *
 * The current password is required even though the session already proves who you are — it is
 * what stops an unattended, signed-in browser from being turned into a permanent takeover. The
 * server checks it again; this form only saves a round trip.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const mutation = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Password changed");
      reset();
      onOpenChange(false);
    },
    onError: err => toast.error(err.message),
  });

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const canSubmit =
    current.length > 0 &&
    next.length >= MIN_LENGTH &&
    next === confirm &&
    !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            At least {MIN_LENGTH} characters. You stay signed in on this device.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={e => {
            e.preventDefault();
            if (!canSubmit) return;
            mutation.mutate({ currentPassword: current, newPassword: next });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={e => setNext(e.target.value)}
            />
            {tooShort && (
              <p className="text-xs text-destructive">
                Must be at least {MIN_LENGTH} characters.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
            />
            {mismatch && (
              <p className="text-xs text-destructive">
                Passwords do not match.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

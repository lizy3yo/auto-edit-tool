import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ROLES, ROLE_DESCRIPTION, ROLE_LABEL, type Role } from "@shared/roles";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Film,
  KeyRound,
  Loader2,
  Trash2,
  UserPlus,
  Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { UserVideosDialog } from "@/components/admin/UserVideosDialog";

/** Kept in step with `MIN_PASSWORD_LENGTH` in `server/passwords.ts`, which is the real gate. */
const MIN_LENGTH = 8;

type UserRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: "active" | "disabled";
  lastLoginAt: Date | null;
  createdAt: Date;
  jobCount: number;
};

const ROLE_BADGE: Record<Role, "default" | "secondary" | "outline"> = {
  admin: "default",
  manager: "secondary",
  editor: "outline",
};

function formatDate(value: Date | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** The role picker, with each tier's reach spelled out under the name. */
function RolePicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={v => onChange(v as Role)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map(role => (
          <SelectItem key={role} value={role}>
            {ROLE_LABEL[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("editor");

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("editor");
  };

  const createMutation = trpc.user.create.useMutation({
    onSuccess: () => {
      toast.success(`${ROLE_LABEL[role]} account created`);
      reset();
      onOpenChange(false);
      utils.user.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_LENGTH &&
    !createMutation.isPending;

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
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            The password is set here and handed over out of band — there is no
            invite email. They can change it themselves from the account menu.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={e => {
            e.preventDefault();
            if (!canSubmit) return;
            createMutation.mutate({ name, email, password, role });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-user-name">Name</Label>
            <Input
              id="new-user-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jordan Reyes"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jordan@example.com"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-user-password">Password</Label>
            <Input
              id="new-user-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={`At least ${MIN_LENGTH} characters`}
            />
            {password.length > 0 && password.length < MIN_LENGTH && (
              <p className="text-xs text-destructive">
                Must be at least {MIN_LENGTH} characters.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-user-role">Role</Label>
            <RolePicker id="new-user-role" value={role} onChange={setRole} />
            <p className="text-xs text-muted-foreground">
              {ROLE_DESCRIPTION[role]}
            </p>
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
              {createMutation.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: UserRow | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");

  const mutation = trpc.user.resetPassword.useMutation({
    onSuccess: () => {
      toast.success("Password reset");
      setPassword("");
      onClose();
    },
    onError: err => toast.error(err.message),
  });

  const canSubmit = password.length >= MIN_LENGTH && !mutation.isPending;

  return (
    <Dialog
      open={user !== null}
      onOpenChange={o => {
        if (!o) {
          setPassword("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Sets a new password for {user?.name}. Their existing sessions stay
            signed in — disable the account instead if you need them out now.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={e => {
            e.preventDefault();
            if (!canSubmit || !user) return;
            mutation.mutate({ id: user.id, password });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={`At least ${MIN_LENGTH} characters`}
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Accounts — create, re-tier, suspend and remove the people who use the studio.
 *
 * Admin-only, and deliberately blunt: the three tiers are a ladder (`shared/roles.ts`), so the
 * whole surface is a role picker, an on/off switch and a password reset. Every guard that
 * matters — last-admin, self-demotion, self-delete — lives on the server; the disabled controls
 * here just explain the refusal before it happens.
 */
export function UserManagement() {
  const { user: me } = useAuth();
  const utils = trpc.useUtils();
  const { data: users, isLoading } = trpc.user.list.useQuery();

  const [addOpen, setAddOpen] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [viewingVideos, setViewingVideos] = useState<UserRow | null>(null);

  const updateMutation = trpc.user.update.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      utils.auth.me.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const deleteMutation = trpc.user.delete.useMutation({
    onSuccess: () => {
      toast.success("Account deleted");
      setDeleting(null);
      utils.user.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const rows = (users ?? []) as UserRow[];
  const activeAdmins = rows.filter(
    u => u.role === "admin" && u.status === "active"
  ).length;

  /** Why a control is disabled, or null when it is not. Mirrors the server's guards. */
  const lockReason = (user: UserRow, change: "role" | "status" | "delete") => {
    if (user.id === me?.id) {
      if (change === "role") return "You cannot change your own role";
      if (change === "status") return "You cannot disable your own account";
      return "You cannot delete your own account";
    }
    if (
      user.role === "admin" &&
      user.status === "active" &&
      activeAdmins <= 1
    ) {
      return "This is the last active admin";
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersIcon className="h-4 w-4" />
          Accounts
          {rows.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {rows.length}
            </Badge>
          )}
        </CardTitle>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          Add account
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {ROLES.map(role => (
            <div
              key={role}
              className="rounded-md border border-border bg-muted/40 p-3"
            >
              <Badge variant={ROLE_BADGE[role]}>{ROLE_LABEL[role]}</Badge>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {ROLE_DESCRIPTION[role]}
              </p>
            </div>
          ))}
        </div>

        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          // The table is the widest thing on the page; it scrolls in its own box rather than
          // pushing the whole Admin layout sideways on a narrow window.
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Videos</th>
                  <th className="px-3 py-2 font-medium">Last sign-in</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(user => {
                  const roleLock = lockReason(user, "role");
                  const statusLock = lockReason(user, "status");
                  const deleteLock = lockReason(user, "delete");
                  const busy =
                    updateMutation.isPending &&
                    updateMutation.variables?.id === user.id;

                  return (
                    <tr
                      key={user.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium">
                          {user.name}
                          {user.id === me?.id && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {user.email}
                        </div>
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="w-40" title={roleLock ?? undefined}>
                          <RolePicker
                            value={user.role}
                            disabled={Boolean(roleLock) || busy}
                            onChange={role =>
                              updateMutation.mutate({ id: user.id, role })
                            }
                          />
                        </div>
                      </td>

                      <td className="px-3 py-2.5">
                        <Badge
                          variant={
                            user.status === "active" ? "default" : "secondary"
                          }
                        >
                          {user.status === "active" ? "Active" : "Disabled"}
                        </Badge>
                      </td>

                      {/* The count is the way IN to the list — "4" answers how much and
                          nothing else, so it is a button whenever there is something to
                          show, and inert text when there is not. */}
                      <td className="px-3 py-2.5">
                        {user.jobCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => setViewingVideos(user)}
                            title={`See the ${user.jobCount} video${user.jobCount === 1 ? "" : "s"} ${user.name} made`}
                            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium text-primary transition-colors hover:bg-primary/10"
                          >
                            <Film className="h-3.5 w-3.5" />
                            {user.jobCount}
                          </button>
                        ) : (
                          <span className="px-1.5 text-muted-foreground">
                            0
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 text-muted-foreground">
                        {formatDate(user.lastLoginAt)}
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setResetting(user)}
                          >
                            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                            Password
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={Boolean(statusLock) || busy}
                            title={statusLock ?? undefined}
                            onClick={() =>
                              updateMutation.mutate({
                                id: user.id,
                                status:
                                  user.status === "active"
                                    ? "disabled"
                                    : "active",
                              })
                            }
                          >
                            {user.status === "active" ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={Boolean(deleteLock)}
                            title={deleteLock ?? undefined}
                            onClick={() => setDeleting(user)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          ADMIN_EMAIL / ADMIN_PASSWORD only seed the first admin when this table
          is empty. After that, accounts are managed here and those env vars are
          ignored.
        </p>
      </CardContent>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} />
      <UserVideosDialog
        user={viewingVideos}
        onClose={() => setViewingVideos(null)}
      />
      <ResetPasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.jobCount
                ? `Their ${deleting.jobCount} video${deleting.jobCount === 1 ? "" : "s"} stay in the library — the renders are the channel's work, not the account's. Only the account and its five tabs are removed.`
                : "The account and its five tabs are removed. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={e => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate({ id: deleting.id });
              }}
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

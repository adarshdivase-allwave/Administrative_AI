import * as React from "react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import {
  KeyRound,
  Plus,
  ShieldCheck,
  Users,
  UserX,
  UserCheck,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/amplify-client";
import { USER_ROLES, type UserRole } from "@shared/constants";
import { formatIST } from "@shared/fy";

interface CognitoUser {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  createdAt?: string;
  groups?: string[];
}

const inviteSchema = z.object({
  email: z.string().email("Invalid email"),
  givenName: z.string().optional(),
  familyName: z.string().optional(),
  role: z.enum(USER_ROLES).optional(),
});
type InviteForm = z.infer<typeof inviteSchema>;

export function UserManagementPage() {
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyUsername, setBusyUsername] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CognitoUser | null>(null);

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "" },
  });

  async function call<T>(
    args: Record<string, unknown>,
  ): Promise<{ users?: T[]; affected?: string; error?: string }> {
    const res = await (api as unknown as {
      mutations: {
        manageUser: (args: Record<string, unknown>) => Promise<{
          data?: { users?: T[]; affected?: string; error?: string };
          errors?: Array<{ message?: string }>;
        }>;
      };
    }).mutations.manageUser(args);
    if (res.errors?.length) throw new Error(res.errors[0]?.message ?? "Request failed");
    return res.data ?? {};
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await call<CognitoUser>({ op: "LIST", limit: 60 });
      setUsers((res.users as unknown as CognitoUser[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onInvite() {
    const ok = await form.trigger();
    if (!ok) return;
    setSubmitting(true);
    try {
      await call({
        op: "CREATE",
        ...form.getValues(),
      });
      toast.success(`Invitation sent to ${form.getValues("email")}`);
      setInviteOpen(false);
      form.reset({ email: "" });
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function addOrRemoveGroup(
    user: CognitoUser,
    role: UserRole,
    add: boolean,
  ) {
    setBusyUsername(user.username);
    try {
      await call({
        op: add ? "ADD_GROUP" : "REMOVE_GROUP",
        username: user.username,
        role,
      });
      toast.success(`${add ? "Added to" : "Removed from"} ${role}`);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyUsername(null);
    }
  }

  async function resetPw(user: CognitoUser) {
    setBusyUsername(user.username);
    try {
      await call({ op: "RESET_PASSWORD", username: user.username });
      toast.success(`Password reset triggered for ${user.email} — they'll get an email`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyUsername(null);
    }
  }

  async function toggleEnabled(user: CognitoUser) {
    setBusyUsername(user.username);
    try {
      await call({
        op: user.enabled ? "DISABLE" : "ENABLE",
        username: user.username,
      });
      toast.success(`${user.email} ${user.enabled ? "disabled" : "enabled"}`);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyUsername(null);
    }
  }

  async function deleteUser() {
    if (!confirmDelete) return;
    setBusyUsername(confirmDelete.username);
    try {
      await call({ op: "DELETE", username: confirmDelete.username });
      toast.success(`Deleted ${confirmDelete.email}`);
      setConfirmDelete(null);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyUsername(null);
    }
  }

  const columns: ColumnDef<CognitoUser>[] = [
    {
      accessorKey: "email",
      header: "User",
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-sm">{row.original.email}</div>
          <div className="font-mono text-[10px] text-muted-foreground truncate">
            {row.original.username}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "groups",
      header: "Roles",
      cell: ({ row }) => {
        const groups = row.original.groups ?? [];
        return (
          <div className="flex flex-wrap gap-1">
            {USER_ROLES.map((role) => {
              const on = groups.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  disabled={busyUsername === row.original.username}
                  onClick={() => addOrRemoveGroup(row.original, role, !on)}
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
                    on
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {role}
                </button>
              );
            })}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Cognito status",
      cell: ({ getValue }) => (
        <Badge variant="outline" className="text-[10px]">
          {String(getValue()).replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      accessorKey: "enabled",
      header: "Active",
      cell: ({ getValue }) =>
        getValue() ? (
          <Badge variant="success" className="text-[10px]">Enabled</Badge>
        ) : (
          <Badge variant="destructive" className="text-[10px]">Disabled</Badge>
        ),
    },
    {
      accessorKey: "createdAt",
      header: "Invited",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return <span className="text-xs">{v ? formatIST(new Date(v)) : "—"}</span>;
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => resetPw(row.original)}
            disabled={busyUsername === row.original.username}
            title="Trigger password reset email"
            aria-label="Reset password"
          >
            <KeyRound className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => toggleEnabled(row.original)}
            disabled={busyUsername === row.original.username}
            title={row.original.enabled ? "Disable account" : "Enable account"}
            aria-label="Toggle enabled"
          >
            {row.original.enabled ? (
              <UserX className="h-3.5 w-3.5" />
            ) : (
              <UserCheck className="h-3.5 w-3.5 text-success" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={() => setConfirmDelete(row.original)}
            disabled={busyUsername === row.original.username}
            title="Delete user permanently"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="User management"
        description="Invite teammates, manage role-group membership, reset passwords, and disable accounts — all from here."
        breadcrumbs={[{ label: "Admin" }, { label: "Users" }]}
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="h-4 w-4" /> Invite user
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard icon={Users} label="Total" value={users.length} />
        <StatCard
          icon={ShieldCheck}
          label="Admins"
          value={users.filter((u) => u.groups?.includes("Admin")).length}
        />
        <StatCard
          icon={UserCheck}
          label="Active"
          value={users.filter((u) => u.enabled).length}
          tone="success"
        />
        <StatCard
          icon={UserX}
          label="Disabled"
          value={users.filter((u) => !u.enabled).length}
          tone="warning"
        />
      </div>

      <DataTable
        data={users}
        columns={columns}
        loading={loading}
        error={error}
        searchPlaceholder="Search by email..."
        emptyTitle="No users yet"
        emptyDescription="Invite your first teammate to get started."
        emptyAction={
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Plus className="h-4 w-4" /> Invite user
          </Button>
        }
      />

      <EntityDrawer
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        mode="create"
        entityName="user"
        description="We'll send Cognito's standard invitation email with a temporary password. The user will set their own password on first login."
        onSubmit={onInvite}
        submitting={submitting}
      >
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Invite</div>
          <Labeled label="Email *">
            <Input type="email" autoFocus autoComplete="email" {...form.register("email")} />
            {form.formState.errors.email && (
              <p className="text-[11px] text-destructive">{form.formState.errors.email.message}</p>
            )}
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="First name">
              <Input {...form.register("givenName")} />
            </Labeled>
            <Labeled label="Last name">
              <Input {...form.register("familyName")} />
            </Labeled>
          </div>
          <Labeled label="Starting role">
            <Select
              value={form.watch("role") ?? ""}
              onValueChange={(v) => form.setValue("role", v as UserRole)}
            >
              <SelectTrigger><SelectValue placeholder="Pick a role (optional)" /></SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labeled>
          <div className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
            Tip: You can also manage users directly in the AWS Cognito console — both surfaces
            read/write the same pool.
          </div>
        </Card>
      </EntityDrawer>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.email}?`}
        description="This removes the Cognito user permanently. Their historical audit-log rows keep the username reference but the account cannot sign in again."
        destructive
        confirmLabel="Delete permanently"
        onConfirm={deleteUser}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "success" | "warning";
}) {
  return (
    <Card
      className={`p-3 flex items-center justify-between ${
        tone === "success"
          ? "border-success/40 bg-success/5"
          : tone === "warning"
            ? "border-warning/40 bg-warning/5"
            : ""
      }`}
    >
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
      <Icon className="h-5 w-5 text-muted-foreground" />
    </Card>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

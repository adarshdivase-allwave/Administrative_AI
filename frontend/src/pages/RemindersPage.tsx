import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlarmClock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { EntityDrawer } from "@/components/entity-drawer";
import { api } from "@/lib/amplify-client";
import { useAuthStore } from "@/stores/auth-store";
import { formatIST } from "@shared/fy";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const formSchema = z
  .object({
    title: z.string().min(1, "Title required"),
    body: z.string().optional(),
    remindAtLocal: z.string().min(1, "Date and time required"),
    recurring: z.boolean().default(false),
    recurrence: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.recurring && !val.recurrence) {
      ctx.addIssue({ code: "custom", path: ["recurrence"], message: "Choose repeat interval" });
    }
  });

type FormValues = z.infer<typeof formSchema>;

type ReminderRow = {
  id: string;
  userId: string;
  title: string;
  body?: string | null;
  remindAt: string;
  recurring?: boolean | null;
  cronExpression?: string | null;
  status?: "ACTIVE" | "COMPLETED" | "CANCELLED" | null;
};

export function RemindersPage() {
  const userId = useAuthStore((s) => s.user?.userId ?? "");
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      body: "",
      remindAtLocal: "",
      recurring: false,
      recurrence: "DAILY",
    },
  });
  const recurring = form.watch("recurring");

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await (
        api.models as unknown as {
          Reminder: {
            list: (args: { filter: unknown; limit: number }) => Promise<{ data?: ReminderRow[] }>;
          };
        }
      ).Reminder.list({
        filter: { userId: { eq: userId } },
        limit: 200,
      });
      const data = res.data ?? [];
      data.sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime());
      setRows(data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(values: FormValues) {
    if (!userId) {
      toast.error("Not signed in");
      return;
    }
    const iso = new Date(values.remindAtLocal).toISOString();
    try {
      const createRes = await (
        api.models as unknown as {
          Reminder: {
            create: (input: Record<string, unknown>) => Promise<{ data?: ReminderRow }>;
          };
        }
      ).Reminder.create({
        userId,
        title: values.title.trim(),
        body: values.body?.trim() || undefined,
        remindAt: iso,
        recurring: values.recurring,
        cronExpression: values.recurring ? values.recurrence : undefined,
        status: "ACTIVE",
      });
      const id = createRes.data?.id;
      if (!id) throw new Error("Create returned no id");

      await (
        api as unknown as {
          mutations: {
            syncReminderSchedule: (args: { reminderId: string; op: string }) => Promise<unknown>;
          };
        }
      ).mutations.syncReminderSchedule({ reminderId: id, op: "UPSERT" });

      toast.success("Reminder saved and scheduled");
      setDrawerOpen(false);
      form.reset({
        title: "",
        body: "",
        remindAtLocal: "",
        recurring: false,
        recurrence: "DAILY",
      });
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function cancelReminder(r: ReminderRow) {
    try {
      await (
        api as unknown as {
          mutations: {
            syncReminderSchedule: (args: { reminderId: string; op: string }) => Promise<unknown>;
          };
        }
      ).mutations.syncReminderSchedule({ reminderId: r.id, op: "DELETE" });
      await (
        api.models as unknown as {
          Reminder: { update: (args: { id: string; status: string }) => Promise<unknown> };
        }
      ).Reminder.update({ id: r.id, status: "CANCELLED" });
      toast.success("Reminder cancelled");
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My reminders"
        description="Personal staff reminders — email via STAFF_REMINDER template when SES is configured."
        actions={
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New reminder
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <AlarmClock className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle>Upcoming</CardTitle>
            <CardDescription>Active and past reminders you created</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reminders yet. Create one to get email nudges.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                  <div>
                    <div className="font-medium">{r.title}</div>
                    {r.body ? <div className="text-muted-foreground">{r.body}</div> : null}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatIST(new Date(r.remindAt))}
                      {r.recurring ? ` · repeats (${r.cronExpression ?? "—"})` : ""}
                      {r.status && r.status !== "ACTIVE" ? ` · ${r.status}` : ""}
                    </div>
                  </div>
                  {r.status === "ACTIVE" ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive"
                      aria-label="Cancel reminder"
                      onClick={() => void cancelReminder(r)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode="create"
        entityName="reminder"
        description="You will receive an email at fire time if your profile email is available to the system."
        onSubmit={() => void form.handleSubmit(onSubmit)()}
        submitting={form.formState.isSubmitting}
      >
        <div className="space-y-4 px-1 py-2">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...form.register("title")} />
            {form.formState.errors.title ? (
              <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="body">Details (optional)</Label>
            <Textarea id="body" rows={3} {...form.register("body")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remindAtLocal">Remind at (your local time)</Label>
            <Input id="remindAtLocal" type="datetime-local" {...form.register("remindAtLocal")} />
            {form.formState.errors.remindAtLocal ? (
              <p className="text-xs text-destructive">{form.formState.errors.remindAtLocal.message}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="recurring"
              checked={recurring}
              onCheckedChange={(c) => form.setValue("recurring", c === true)}
            />
            <Label htmlFor="recurring" className="font-normal">
              Recurring
            </Label>
          </div>
          {recurring ? (
            <div className="space-y-2">
              <Label>Repeat</Label>
              <Select
                value={form.watch("recurrence") ?? "DAILY"}
                onValueChange={(v) => form.setValue("recurrence", v as FormValues["recurrence"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      </EntityDrawer>
    </div>
  );
}

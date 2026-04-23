import * as React from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, Clock, FileText, Plus, Send } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, InlineSpinner } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { MoneyInput } from "@/components/fields/money-input";
import { toast } from "@/components/ui/toast";
import { useCrud } from "@/hooks/use-crud";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/amplify-client";
import { formatInr } from "@shared/currency";
import { daysBetween, formatIST, fyLabel } from "@shared/fy";
import { MAX_GST_DOC_LENGTH, ALLOWED_DOC_CHAR_REGEX } from "@shared/numbering";
import { cn } from "@/lib/cn";

const schema = z.object({
  invoiceNumber: z
    .string()
    .min(3, "Required")
    .max(MAX_GST_DOC_LENGTH, `Max ${MAX_GST_DOC_LENGTH} chars per GST rules`)
    .regex(ALLOWED_DOC_CHAR_REGEX, "Only A-Z, 0-9, hyphens, slashes"),
  invoiceDate: z.string().min(1, "Required"),
  clientId: z.string().min(1, "Required"),
  projectId: z.string().optional(),
  amountDueInr: z.coerce.number().positive("Must be > 0"),
  cgstInr: z.coerce.number().min(0).default(0),
  sgstInr: z.coerce.number().min(0).default(0),
  igstInr: z.coerce.number().min(0).default(0),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  dueDate: z.string().min(1, "Required"),
  notes: z.string().optional(),
});
type InvoiceForm = z.infer<typeof schema>;

interface Invoice extends InvoiceForm {
  id: string;
  status?: string;
  totalAmountInr?: number;
  paidAt?: string;
  paidAmountInr?: number;
  msmeNoticeSentAt?: string;
  fyYear?: string;
}
interface Client { id: string; name: string }
interface Project { id: string; projectName: string }

interface MsmeLog {
  id: string;
  invoiceId: string;
  sentAt?: string;
  daysOverdue?: number;
  templateUsed?: string;
  sesMessageId?: string;
}

export function InvoicesPage() {
  const isAdminOrSales = useAuthStore((s) => s.hasRole(["Admin", "Sales"]));
  const crud = useCrud<Invoice>("ClientInvoice");
  const clients = useCrud<Client>("Client");
  const projects = useCrud<Project>("Project");
  const msmeLogs = useCrud<MsmeLog>("MSMEComplianceLog");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);

  const clientById = useMemo(
    () => new Map(clients.data.map((c) => [c.id, c])),
    [clients.data],
  );
  const msmeByInvoice = useMemo(
    () => new Map(msmeLogs.data.map((m) => [m.invoiceId, m])),
    [msmeLogs.data],
  );

  const form = useForm<InvoiceForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      invoiceNumber: "",
      invoiceDate: new Date().toISOString().slice(0, 10),
      clientId: "",
      amountDueInr: 0,
      cgstInr: 0,
      sgstInr: 0,
      igstInr: 0,
      paymentTermsDays: 30,
      dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
    },
  });

  function openCreate() {
    const today = new Date().toISOString().slice(0, 10);
    form.reset({
      invoiceNumber: "",
      invoiceDate: today,
      clientId: "",
      amountDueInr: 0,
      cgstInr: 0,
      sgstInr: 0,
      igstInr: 0,
      paymentTermsDays: 30,
      dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
    });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }
  function openEdit(inv: Invoice) {
    form.reset({ ...inv });
    setEditing(inv);
    setMode("edit");
    setDrawerOpen(true);
  }

  // Auto-compute dueDate when invoiceDate or terms change.
  React.useEffect(() => {
    const sub = form.watch((vals, info) => {
      if (info.name === "invoiceDate" || info.name === "paymentTermsDays") {
        if (vals.invoiceDate && vals.paymentTermsDays != null) {
          const d = new Date(vals.invoiceDate);
          d.setDate(d.getDate() + (vals.paymentTermsDays ?? 30));
          form.setValue("dueDate", d.toISOString().slice(0, 10));
        }
      }
    });
    return () => sub.unsubscribe();
  }, [form]);

  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const values = form.getValues();
    const totalAmount =
      values.amountDueInr + values.cgstInr + values.sgstInr + values.igstInr;
    const payload = {
      ...values,
      totalAmountInr: totalAmount,
      status: "DRAFT",
      fyYear: fyLabel(new Date(values.invoiceDate)).replace(/^FY /, ""),
    };

    let invoiceId: string | undefined;
    if (mode === "create") {
      const created = await crud.create(payload as never);
      invoiceId = (created as Invoice | null)?.id;
      if (invoiceId) setDrawerOpen(false);
    } else if (editing) {
      const updated = await crud.update(editing.id, payload);
      invoiceId = (updated as Invoice | null)?.id;
      if (updated) setDrawerOpen(false);
    }

    // On create, offer to schedule reminders.
    if (mode === "create" && invoiceId) {
      try {
        await (
          api as unknown as {
            mutations: {
              scheduleInvoiceReminders: (args: {
                action: string;
                invoiceId: string;
              }) => Promise<{ data?: { scheduled: number } }>;
            };
          }
        ).mutations.scheduleInvoiceReminders({ action: "CREATE", invoiceId });
        toast.success("Reminder schedule created (8 stages T-15 → T+45)");
      } catch (e) {
        toast.error(`Invoice saved, but reminder scheduling failed: ${(e as Error).message}`);
      }
    }
  }

  async function markPaid(inv: Invoice) {
    await crud.update(inv.id, {
      status: "PAID",
      paidAt: new Date().toISOString(),
      paidAmountInr: inv.totalAmountInr,
    });
    // Cancel outstanding reminders.
    try {
      await (
        api as unknown as {
          mutations: {
            scheduleInvoiceReminders: (args: {
              action: string;
              invoiceId: string;
            }) => Promise<{ data?: { deleted: number } }>;
          };
        }
      ).mutations.scheduleInvoiceReminders({ action: "CANCEL", invoiceId: inv.id });
    } catch (_e) {
      // non-fatal — the reminder-sender Lambda also short-circuits on PAID.
    }
  }

  async function rebuildSchedule(invoiceId: string) {
    setSchedulingId(invoiceId);
    try {
      const res = await (
        api as unknown as {
          mutations: {
            scheduleInvoiceReminders: (args: {
              action: string;
              invoiceId: string;
            }) => Promise<{ data?: { scheduled: number; deleted: number } }>;
          };
        }
      ).mutations.scheduleInvoiceReminders({ action: "UPDATE", invoiceId });
      if (res.data) {
        toast.success(`Rebuilt: ${res.data.scheduled} scheduled, ${res.data.deleted} removed`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSchedulingId(null);
    }
  }

  const columns: ColumnDef<Invoice>[] = [
    {
      accessorKey: "invoiceNumber",
      header: "Invoice",
      cell: ({ row }) => (
        <div>
          <div className="font-mono text-xs font-medium">{row.original.invoiceNumber}</div>
          <div className="text-[10px] text-muted-foreground">
            {row.original.invoiceDate ? formatIST(new Date(row.original.invoiceDate)) : "—"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "clientId",
      header: "Client",
      cell: ({ getValue }) => (
        <span className="text-xs">{clientById.get(getValue() as string)?.name ?? "—"}</span>
      ),
    },
    {
      accessorKey: "totalAmountInr",
      header: () => <div className="text-right">Total</div>,
      cell: ({ getValue }) => (
        <div className="text-right font-mono text-xs">
          {formatInr(Number(getValue() ?? 0), { showSymbol: false })}
        </div>
      ),
    },
    {
      accessorKey: "dueDate",
      header: "Due",
      cell: ({ row }) => {
        const v = row.original.dueDate;
        if (!v) return <span className="text-muted-foreground">—</span>;
        const d = new Date(v);
        const days = daysBetween(new Date(), d);
        const status = row.original.status;
        if (status === "PAID") return <span className="text-xs text-success">Paid</span>;
        if (days < 0)
          return (
            <span className="text-xs text-destructive">
              {formatIST(d)} · {-days}d overdue
            </span>
          );
        return (
          <span className="text-xs">
            {formatIST(d)} · in {days}d
          </span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = row.original.status ?? "DRAFT";
        const msme = msmeByInvoice.get(row.original.id);
        return (
          <div className="space-y-0.5">
            <StatusBadge status={s} />
            {msme && (
              <div className="text-[10px] text-muted-foreground">
                MSME notice: {msme.sentAt ? formatIST(new Date(msme.sentAt)) : "—"}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {row.original.status !== "PAID" && isAdminOrSales && (
            <Button size="sm" variant="ghost" onClick={() => markPaid(row.original)}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Mark paid
            </Button>
          )}
          {row.original.status !== "PAID" && isAdminOrSales && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => rebuildSchedule(row.original.id)}
              disabled={schedulingId === row.original.id}
              title="Rebuild reminder schedule"
            >
              {schedulingId === row.original.id ? (
                <InlineSpinner className="h-3.5 w-3.5" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Client invoices"
        description="Every invoice triggers an 8-stage reminder schedule. MSME notices fire automatically 45+ days past due."
        breadcrumbs={[{ label: "Finance" }, { label: "Invoices" }]}
        actions={
          isAdminOrSales && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> New invoice
            </Button>
          )
        }
      />

      {/* Quick summary strip */}
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard
          icon={FileText}
          label="Total invoices"
          value={crud.data.length}
          loading={crud.loading}
        />
        <SummaryCard
          icon={Clock}
          label="Overdue"
          value={crud.data.filter((i) => i.status === "OVERDUE").length}
          tone="warning"
          loading={crud.loading}
        />
        <SummaryCard
          icon={AlertTriangle}
          label="MSME notices sent"
          value={crud.data.filter((i) => i.status === "MSME_NOTICE_SENT").length}
          tone="destructive"
          loading={crud.loading}
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Paid this FY"
          value={crud.data.filter((i) => i.status === "PAID").length}
          tone="success"
          loading={crud.loading}
        />
      </div>

      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search by invoice #..."
        emptyTitle="No invoices yet"
        emptyDescription="Create your first invoice. Reminders are scheduled automatically."
        emptyAction={
          isAdminOrSales && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New invoice
            </Button>
          )
        }
        onRowClick={openEdit}
        initialSorting={[{ id: "invoiceDate", desc: true }]}
      />

      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="invoice"
        description="Enter GST components separately — CGST+SGST for intrastate, IGST for interstate."
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Identity</div>
          <Labeled label="Invoice number * (GST: ≤ 16 alphanumeric)">
            <Input className="font-mono uppercase" {...form.register("invoiceNumber")} maxLength={16} />
            {form.formState.errors.invoiceNumber && (
              <p className="text-[11px] text-destructive">{form.formState.errors.invoiceNumber.message}</p>
            )}
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Invoice date *">
              <Input type="date" {...form.register("invoiceDate")} />
            </Labeled>
            <Labeled label="Payment terms (days)">
              <Input type="number" min={0} max={365} {...form.register("paymentTermsDays")} />
            </Labeled>
          </div>
          <Labeled label="Due date">
            <Input type="date" {...form.register("dueDate")} />
            <p className="text-[11px] text-muted-foreground">Auto-calculated from invoice date + terms.</p>
          </Labeled>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Client + project</div>
          <Labeled label="Client *">
            <Select
              value={form.watch("clientId") ?? ""}
              onValueChange={(v) => form.setValue("clientId", v, { shouldValidate: true })}
            >
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients.data.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label="Project (optional)">
            <Select
              value={form.watch("projectId") ?? ""}
              onValueChange={(v) => form.setValue("projectId", v)}
            >
              <SelectTrigger><SelectValue placeholder="Link to a project" /></SelectTrigger>
              <SelectContent>
                {projects.data.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labeled>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Amounts</div>
          <MoneyInput
            label="Base amount (ex-GST) *"
            {...form.register("amountDueInr")}
            value={form.watch("amountDueInr")}
          />
          {form.formState.errors.amountDueInr && (
            <p className="text-[11px] text-destructive">{form.formState.errors.amountDueInr.message}</p>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Labeled label="CGST ₹">
              <Input type="number" step="0.01" {...form.register("cgstInr")} />
            </Labeled>
            <Labeled label="SGST ₹">
              <Input type="number" step="0.01" {...form.register("sgstInr")} />
            </Labeled>
            <Labeled label="IGST ₹">
              <Input type="number" step="0.01" {...form.register("igstInr")} />
            </Labeled>
          </div>
          <div className="rounded-md bg-muted/40 p-2 text-xs font-mono flex justify-between">
            <span>Total (computed)</span>
            <span className="font-semibold">
              {formatInr(
                (form.watch("amountDueInr") ?? 0) +
                  (form.watch("cgstInr") ?? 0) +
                  (form.watch("sgstInr") ?? 0) +
                  (form.watch("igstInr") ?? 0),
              )}
            </span>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Notes</div>
          <Textarea rows={3} {...form.register("notes")} />
        </Card>
      </EntityDrawer>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "secondary" | "destructive" | "warning" | "success"> = {
    DRAFT: "secondary",
    SENT: "default",
    CONFIRMATION_PENDING: "secondary",
    CONFIRMED: "default",
    REMINDER_SENT: "warning",
    DUE_TODAY: "warning",
    OVERDUE: "destructive",
    MSME_NOTICE_SENT: "destructive",
    PAID: "success",
    CANCELLED: "secondary",
    DISPUTED: "warning",
  };
  return (
    <Badge variant={map[status] ?? "secondary"} className="text-[10px]">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "warning" | "destructive" | "success";
  loading?: boolean;
}) {
  return (
    <Card
      className={cn(
        "p-3 flex items-center justify-between",
        tone === "warning" && "border-warning/40 bg-warning/5",
        tone === "destructive" && "border-destructive/40 bg-destructive/5",
        tone === "success" && "border-success/40 bg-success/5",
      )}
    >
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-xl font-semibold">{loading ? "…" : value}</div>
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

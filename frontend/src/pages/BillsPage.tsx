import * as React from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { BadgeIndianRupee, CheckCircle2, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { MoneyInput } from "@/components/fields/money-input";
import { useCrud } from "@/hooks/use-crud";
import { BILL_TYPES, BILLING_CYCLES } from "@shared/constants";
import { formatInr } from "@shared/currency";
import { daysBetween, formatIST, fyLabel } from "@shared/fy";
import { cn } from "@/lib/cn";

const schema = z.object({
  billType: z.enum(BILL_TYPES),
  description: z.string().min(2, "Required"),
  vendorOrAuthority: z.string().optional(),
  billingCycle: z.enum(BILLING_CYCLES).default("MONTHLY"),
  dueDate: z.string().min(1, "Required"),
  recurringDayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
  reminderDaysBefore: z.coerce.number().int().min(0).max(30).default(3),
  amountInr: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
});
type BillForm = z.infer<typeof schema>;

interface Bill extends BillForm {
  id: string;
  status?: string;
  fyYear?: string;
  paidAt?: string;
  attachmentS3Key?: string;
}

export function BillsPage() {
  const crud = useCrud<Bill>("Bill");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Bill | null>(null);
  const [view, setView] = useState<"all" | "pending" | "overdue" | "paid">("pending");

  const form = useForm<BillForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      billType: "ELECTRICITY",
      description: "",
      billingCycle: "MONTHLY",
      dueDate: new Date().toISOString().slice(0, 10),
      reminderDaysBefore: 3,
      amountInr: 0,
    },
  });

  function openCreate() {
    form.reset({
      billType: "ELECTRICITY",
      description: "",
      billingCycle: "MONTHLY",
      dueDate: new Date().toISOString().slice(0, 10),
      reminderDaysBefore: 3,
      amountInr: 0,
    });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }
  function openEdit(b: Bill) {
    form.reset(b);
    setEditing(b);
    setMode("edit");
    setDrawerOpen(true);
  }

  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const values = form.getValues();
    const payload = {
      ...values,
      fyYear: fyLabel(new Date(values.dueDate)).replace(/^FY /, ""),
      status: "PENDING",
    };
    if (mode === "create") {
      if (await crud.create(payload as never)) setDrawerOpen(false);
    } else if (editing) {
      if (await crud.update(editing.id, payload)) setDrawerOpen(false);
    }
  }

  async function markPaid(bill: Bill) {
    await crud.update(bill.id, {
      status: "PAID",
      paidAt: new Date().toISOString(),
    });
  }

  const withStatus = useMemo(() => {
    return crud.data.map((b) => {
      if (b.status === "PAID") return b;
      const d = b.dueDate ? new Date(b.dueDate) : null;
      if (d && daysBetween(new Date(), d) < 0) {
        return { ...b, status: "OVERDUE" as const };
      }
      return b;
    });
  }, [crud.data]);

  const filtered = useMemo(() => {
    switch (view) {
      case "pending":
        return withStatus.filter((b) => b.status === "PENDING" || b.status === "INVOICE_CREATED");
      case "overdue":
        return withStatus.filter((b) => b.status === "OVERDUE");
      case "paid":
        return withStatus.filter((b) => b.status === "PAID");
      default:
        return withStatus;
    }
  }, [withStatus, view]);

  const counts = useMemo(
    () => ({
      pending: withStatus.filter((b) => b.status === "PENDING" || b.status === "INVOICE_CREATED").length,
      overdue: withStatus.filter((b) => b.status === "OVERDUE").length,
      paid: withStatus.filter((b) => b.status === "PAID").length,
      tds: withStatus.filter((b) => b.billType === "TDS").length,
    }),
    [withStatus],
  );

  const columns: ColumnDef<Bill>[] = [
    {
      accessorKey: "billType",
      header: "Type",
      cell: ({ getValue }) => {
        const t = getValue() as string;
        const isTds = t === "TDS";
        return (
          <Badge variant={isTds ? "warning" : "outline"}>{t.replace(/_/g, " ")}</Badge>
        );
      },
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-sm">{row.original.description}</div>
          {row.original.vendorOrAuthority && (
            <div className="text-[10px] text-muted-foreground">{row.original.vendorOrAuthority}</div>
          )}
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
      accessorKey: "amountInr",
      header: () => <div className="text-right">Amount</div>,
      cell: ({ getValue }) => (
        <div className="text-right font-mono text-xs">
          {formatInr(Number(getValue() ?? 0), { showSymbol: false })}
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const s = (getValue() as string) ?? "PENDING";
        const variant: "default" | "secondary" | "destructive" | "warning" | "success" =
          s === "PAID" ? "success" : s === "OVERDUE" ? "destructive" : s === "INVOICE_CREATED" ? "default" : "warning";
        return <Badge variant={variant} className="text-[10px]">{s.replace(/_/g, " ")}</Badge>;
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {row.original.status !== "PAID" && (
            <Button size="sm" variant="ghost" onClick={() => markPaid(row.original)}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Mark paid
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bills & obligations"
        description="TDS deposits (auto-created on the 1st of every month), electricity, credit card, telephone, custom bills."
        breadcrumbs={[{ label: "Finance" }, { label: "Bills" }]}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New bill
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <FilterCard label="Pending" value={counts.pending} active={view === "pending"} onClick={() => setView("pending")} />
        <FilterCard label="Overdue" value={counts.overdue} active={view === "overdue"} onClick={() => setView("overdue")} tone="destructive" />
        <FilterCard label="Paid" value={counts.paid} active={view === "paid"} onClick={() => setView("paid")} tone="success" />
        <FilterCard label="TDS bills" value={counts.tds} active={false} onClick={() => setView("all")} tone="warning" />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search bills..."
        emptyTitle={
          view === "pending" ? "No pending bills" :
          view === "overdue" ? "No overdue bills — nice!" :
          view === "paid" ? "No paid bills yet" : "No bills yet"
        }
        emptyDescription="TDS bills are auto-created on the 1st of every month. Add electricity, credit card, and other obligations here."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Add bill</Button>}
        onRowClick={openEdit}
        initialSorting={[{ id: "dueDate", desc: false }]}
      />

      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="bill"
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <BadgeIndianRupee className="h-4 w-4 text-muted-foreground" /> Details
          </div>
          <Labeled label="Type *">
            <Select value={form.watch("billType")} onValueChange={(v) => form.setValue("billType", v as typeof BILL_TYPES[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BILL_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label="Description *">
            <Input {...form.register("description")} placeholder="TDS deposit for April 2025" />
            {form.formState.errors.description && (
              <p className="text-[11px] text-destructive">{form.formState.errors.description.message}</p>
            )}
          </Labeled>
          <Labeled label="Vendor / authority">
            <Input {...form.register("vendorOrAuthority")} placeholder="Income Tax Department (TDS)" />
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Cycle">
              <Select
                value={form.watch("billingCycle")}
                onValueChange={(v) => form.setValue("billingCycle", v as typeof BILLING_CYCLES[number])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_CYCLES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label="Due date *">
              <Input type="date" {...form.register("dueDate")} />
            </Labeled>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Recurring day of month">
              <Input type="number" min={1} max={31} {...form.register("recurringDayOfMonth")} />
            </Labeled>
            <Labeled label="Reminder days before">
              <Input type="number" min={0} max={30} {...form.register("reminderDaysBefore")} />
            </Labeled>
          </div>
          <MoneyInput label="Amount (estimate)" {...form.register("amountInr")} value={form.watch("amountInr")} />
        </Card>
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Notes</div>
          <Textarea rows={3} {...form.register("notes")} />
        </Card>
      </EntityDrawer>
    </div>
  );
}

function FilterCard({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone?: "destructive" | "success" | "warning";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
        active && "ring-2 ring-ring",
        tone === "destructive" && "border-destructive/40 bg-destructive/5",
        tone === "success" && "border-success/40 bg-success/5",
        tone === "warning" && "border-warning/40 bg-warning/5",
      )}
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </button>
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

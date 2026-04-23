import * as React from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, FileText, Pencil, Plus, Trash2 } from "lucide-react";
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
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MoneyInput } from "@/components/fields/money-input";
import { useCrud } from "@/hooks/use-crud";
import { useAuthStore } from "@/stores/auth-store";
import { formatInr } from "@shared/currency";
import { daysBetween, formatIST } from "@shared/fy";
import { cn } from "@/lib/cn";

const STATUSES = ["ACTIVE", "EXPIRED", "RENEWED", "CANCELLED"] as const;

const schema = z.object({
  contractNumber: z.string().min(2, "Required"),
  vendorId: z.string().optional(),
  startDate: z.string().min(1, "Required"),
  endDate: z.string().min(1, "Required"),
  annualCostInr: z.coerce.number().min(0).default(0),
  coverage: z.string().optional(),
  status: z.enum(STATUSES).default("ACTIVE"),
  notes: z.string().optional(),
});
type AmcForm = z.infer<typeof schema>;

interface Amc extends AmcForm {
  id: string;
  renewalReminderSentAt?: string;
}
interface Vendor { id: string; name: string }

export function AmcContractsPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const crud = useCrud<Amc>("AMCContract");
  const vendors = useCrud<Vendor>("Vendor");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Amc | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Amc | null>(null);

  const vendorById = useMemo(
    () => new Map(vendors.data.map((v) => [v.id, v])),
    [vendors.data],
  );

  const form = useForm<AmcForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      contractNumber: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
      status: "ACTIVE",
      annualCostInr: 0,
    },
  });

  function openCreate() {
    form.reset({
      contractNumber: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
      status: "ACTIVE",
      annualCostInr: 0,
    });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }
  function openEdit(a: Amc) {
    form.reset(a);
    setEditing(a);
    setMode("edit");
    setDrawerOpen(true);
  }
  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const values = form.getValues();
    if (new Date(values.endDate) <= new Date(values.startDate)) {
      form.setError("endDate", { message: "End date must be after start date" });
      return;
    }
    if (mode === "create") {
      if (await crud.create(values as never)) setDrawerOpen(false);
    } else if (editing) {
      if (await crud.update(editing.id, values)) setDrawerOpen(false);
    }
  }

  // Augment with expiry-aware pills.
  const rows = useMemo(() => {
    return crud.data.map((a) => {
      const daysToExpiry = a.endDate ? daysBetween(new Date(), new Date(a.endDate)) : null;
      let computedStatus = a.status ?? "ACTIVE";
      if (computedStatus === "ACTIVE" && daysToExpiry !== null && daysToExpiry < 0) {
        computedStatus = "EXPIRED";
      }
      return { ...a, computedStatus, daysToExpiry };
    });
  }, [crud.data]);

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.computedStatus === "ACTIVE").length,
      expiring: rows.filter(
        (r) => r.computedStatus === "ACTIVE" && r.daysToExpiry !== null && r.daysToExpiry <= 45,
      ).length,
      expired: rows.filter((r) => r.computedStatus === "EXPIRED").length,
    }),
    [rows],
  );

  const columns: ColumnDef<(typeof rows)[number]>[] = [
    {
      accessorKey: "contractNumber",
      header: "Contract #",
      cell: ({ getValue }) => <span className="font-mono text-xs font-medium">{String(getValue())}</span>,
    },
    {
      accessorKey: "vendorId",
      header: "Vendor",
      cell: ({ getValue }) => (
        <span className="text-xs">{vendorById.get(getValue() as string)?.name ?? "—"}</span>
      ),
    },
    {
      accessorKey: "coverage",
      header: "Coverage",
      cell: ({ getValue }) => {
        const v = (getValue() as string) || "";
        return <span className="text-xs line-clamp-1 max-w-[240px] inline-block">{v || "—"}</span>;
      },
    },
    {
      accessorKey: "annualCostInr",
      header: () => <div className="text-right">Annual ₹</div>,
      cell: ({ getValue }) => (
        <div className="text-right font-mono text-xs">
          {formatInr(Number(getValue() ?? 0), { showSymbol: false })}
        </div>
      ),
    },
    {
      accessorKey: "endDate",
      header: "Ends",
      cell: ({ row }) => {
        const d = row.original.endDate ? new Date(row.original.endDate) : null;
        if (!d) return <span className="text-muted-foreground">—</span>;
        const days = row.original.daysToExpiry ?? 0;
        const expiring = days <= 45 && days >= 0;
        const expired = days < 0;
        return (
          <div className="text-xs">
            <div>{formatIST(d)}</div>
            <div
              className={cn(
                "text-[10px]",
                expired && "text-destructive",
                expiring && "text-warning",
              )}
            >
              {expired ? `${-days}d expired` : `in ${days}d`}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "computedStatus",
      header: "Status",
      cell: ({ getValue }) => {
        const s = getValue() as string;
        const variant: "default" | "secondary" | "destructive" | "success" =
          s === "ACTIVE" ? "success" : s === "EXPIRED" ? "destructive" : s === "RENEWED" ? "default" : "secondary";
        return <Badge variant={variant} className="text-[10px]">{s}</Badge>;
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(row.original)} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(row.original)} aria-label="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="AMC contracts"
        description="Annual Maintenance Contracts. Contracts expiring in the next 45 days are flagged automatically by the amc-renewal-checker Lambda."
        breadcrumbs={[{ label: "Inventory" }, { label: "AMC contracts" }]}
        actions={isAdmin && <Button onClick={openCreate}><Plus className="h-4 w-4" /> New contract</Button>}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile label="Active" value={counts.active} />
        <SummaryTile label="Expiring ≤ 45 days" value={counts.expiring} tone="warning" />
        <SummaryTile label="Expired" value={counts.expired} tone="destructive" />
      </div>

      <DataTable
        data={rows}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search contract #, coverage..."
        emptyTitle="No AMC contracts yet"
        emptyDescription="Track annual maintenance contracts to get renewal alerts 45 days before expiry."
        emptyAction={isAdmin && <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Add contract</Button>}
        onRowClick={openEdit}
        initialSorting={[{ id: "endDate", desc: false }]}
      />

      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="AMC contract"
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 text-muted-foreground" /> Contract
          </div>
          <Labeled label="Contract number *">
            <Input className="font-mono" {...form.register("contractNumber")} />
            {form.formState.errors.contractNumber && (
              <p className="text-[11px] text-destructive">{form.formState.errors.contractNumber.message}</p>
            )}
          </Labeled>
          <Labeled label="Vendor">
            <Select value={form.watch("vendorId") ?? ""} onValueChange={(v) => form.setValue("vendorId", v)}>
              <SelectTrigger><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.data.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Start date *">
              <Input type="date" {...form.register("startDate")} />
            </Labeled>
            <Labeled label="End date *">
              <Input type="date" {...form.register("endDate")} />
              {form.formState.errors.endDate && (
                <p className="text-[11px] text-destructive">{form.formState.errors.endDate.message}</p>
              )}
            </Labeled>
          </div>
          <Labeled label="Status">
            <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v as typeof STATUSES[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Labeled>
          <MoneyInput label="Annual cost (INR)" {...form.register("annualCostInr")} value={form.watch("annualCostInr")} />
          <Labeled label="Coverage">
            <Textarea rows={2} {...form.register("coverage")} placeholder="On-site repair, spare parts, firmware updates..." />
          </Labeled>
        </Card>
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Notes</div>
          <Textarea rows={3} {...form.register("notes")} />
        </Card>
      </EntityDrawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete AMC ${deleteTarget?.contractNumber}?`}
        destructive
        confirmLabel="Delete"
        description="Units covered by this contract keep their amcContractId — you should reassign them first."
        onConfirm={async () => {
          if (deleteTarget) await crud.remove(deleteTarget.id);
        }}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning" | "destructive";
}) {
  return (
    <Card
      className={cn(
        "p-3 flex items-center justify-between",
        tone === "warning" && "border-warning/40 bg-warning/5",
        tone === "destructive" && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
      {tone && <AlertTriangle className="h-5 w-5 opacity-70" />}
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

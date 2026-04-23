import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, Wrench } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { MoneyInput } from "@/components/fields/money-input";
import { useCrud } from "@/hooks/use-crud";
import { formatInr } from "@shared/currency";
import { formatIST } from "@shared/fy";

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"] as const;

const schema = z.object({
  ticketNumber: z.string().optional(),
  unitId: z.string().min(1, "Pick a unit"),
  issue: z.string().min(3, "Required"),
  diagnosis: z.string().optional(),
  resolution: z.string().optional(),
  status: z.enum(STATUSES).default("OPEN"),
  costInr: z.coerce.number().min(0).default(0),
});
type TicketForm = z.infer<typeof schema>;
interface Ticket extends TicketForm {
  id: string;
  reportedAt?: string;
  resolvedAt?: string;
}
interface Unit { id: string; serialNumber?: string; productId?: string }

export function ServiceTicketsPage() {
  const crud = useCrud<Ticket>("ServiceTicket");
  const units = useCrud<Unit>("UnitRecord", { limit: 500 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Ticket | null>(null);

  const form = useForm<TicketForm>({
    resolver: zodResolver(schema),
    defaultValues: { unitId: "", issue: "", status: "OPEN", costInr: 0 },
  });

  function openCreate() {
    form.reset({ unitId: "", issue: "", status: "OPEN", costInr: 0 });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }
  function openEdit(t: Ticket) {
    form.reset(t);
    setEditing(t);
    setMode("edit");
    setDrawerOpen(true);
  }

  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const values = form.getValues();
    const payload = {
      ...values,
      ...(mode === "create" && { reportedAt: new Date().toISOString() }),
      ...(values.status === "RESOLVED" && !editing?.resolvedAt && {
        resolvedAt: new Date().toISOString(),
      }),
    };
    if (mode === "create") {
      if (await crud.create(payload as never)) setDrawerOpen(false);
    } else if (editing) {
      if (await crud.update(editing.id, payload)) setDrawerOpen(false);
    }
  }

  const unitById = new Map(units.data.map((u) => [u.id, u]));

  const columns: ColumnDef<Ticket>[] = [
    {
      accessorKey: "ticketNumber",
      header: "#",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.ticketNumber ?? row.original.id.slice(0, 8)}</span>
      ),
    },
    {
      accessorKey: "unitId",
      header: "Unit",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">
          {unitById.get(getValue() as string)?.serialNumber ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "issue",
      header: "Issue",
      cell: ({ getValue }) => (
        <span className="text-xs line-clamp-1 max-w-xs inline-block">{String(getValue())}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const s = getValue() as string;
        const variant: "default" | "secondary" | "success" | "warning" =
          s === "RESOLVED" ? "success" : s === "IN_PROGRESS" ? "warning" : s === "CANCELLED" ? "secondary" : "default";
        return <Badge variant={variant} className="text-[10px]">{s.replace(/_/g, " ")}</Badge>;
      },
    },
    {
      accessorKey: "costInr",
      header: () => <div className="text-right">Cost</div>,
      cell: ({ getValue }) => (
        <div className="text-right font-mono text-xs">
          {formatInr(Number(getValue() ?? 0), { showSymbol: false })}
        </div>
      ),
    },
    {
      accessorKey: "reportedAt",
      header: "Reported",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return <span className="text-xs">{v ? formatIST(new Date(v)) : "—"}</span>;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Service tickets"
        description="Track per-unit servicing. Resolved tickets update the unit's lastServiceDate."
        breadcrumbs={[{ label: "Inventory" }, { label: "Service" }]}
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> New ticket</Button>}
      />
      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search tickets..."
        emptyTitle="No service tickets"
        emptyDescription="Create tickets when a unit needs repair or service."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> New ticket</Button>}
        onRowClick={openEdit}
        initialSorting={[{ id: "reportedAt", desc: true }]}
      />
      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="service ticket"
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wrench className="h-4 w-4 text-muted-foreground" /> Ticket
          </div>
          <Labeled label="Unit *">
            <Select value={form.watch("unitId")} onValueChange={(v) => form.setValue("unitId", v)}>
              <SelectTrigger><SelectValue placeholder="Pick a unit" /></SelectTrigger>
              <SelectContent>
                {units.data.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.serialNumber ?? u.id.slice(0, 10)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label="Status">
            <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v as typeof STATUSES[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label="Issue *">
            <Textarea rows={2} {...form.register("issue")} />
            {form.formState.errors.issue && <p className="text-[11px] text-destructive">{form.formState.errors.issue.message}</p>}
          </Labeled>
          <Labeled label="Diagnosis"><Textarea rows={2} {...form.register("diagnosis")} /></Labeled>
          <Labeled label="Resolution"><Textarea rows={2} {...form.register("resolution")} /></Labeled>
          <MoneyInput label="Cost (INR)" {...form.register("costInr")} value={form.watch("costInr")} />
        </Card>
      </EntityDrawer>
    </div>
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

import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Plus, Plane } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { useCrud } from "@/hooks/use-crud";
import { formatIST } from "@shared/fy";

const STATUSES = ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"] as const;

const schema = z.object({
  transferNumber: z.string().optional(),
  sourceGodownId: z.string().min(1, "Required"),
  destinationGodownId: z.string().min(1, "Required"),
  transporterName: z.string().optional(),
  vehicleNumber: z.string().optional(),
  lrDocketNumber: z.string().optional(),
  dispatchedAt: z.string().optional(),
  receivedAt: z.string().optional(),
  status: z.enum(STATUSES).default("DRAFT"),
  notes: z.string().optional(),
});
type TransferForm = z.infer<typeof schema>;
interface Transfer extends TransferForm { id: string; unitIds?: string[] }
interface Godown { id: string; name: string }

export function TransfersPage() {
  const crud = useCrud<Transfer>("TransferOrder");
  const godowns = useCrud<Godown>("Godown");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Transfer | null>(null);

  const form = useForm<TransferForm>({
    resolver: zodResolver(schema),
    defaultValues: { sourceGodownId: "", destinationGodownId: "", status: "DRAFT" },
  });

  function openCreate() {
    form.reset({ sourceGodownId: "", destinationGodownId: "", status: "DRAFT" });
    setEditing(null); setMode("create"); setDrawerOpen(true);
  }
  function openEdit(t: Transfer) { form.reset(t); setEditing(t); setMode("edit"); setDrawerOpen(true); }

  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const v = form.getValues();
    if (v.sourceGodownId === v.destinationGodownId) {
      form.setError("destinationGodownId", { message: "Source and destination must differ" });
      return;
    }
    const payload = {
      ...v,
      ...(v.status === "IN_TRANSIT" && !v.dispatchedAt && { dispatchedAt: new Date().toISOString() }),
      ...(v.status === "RECEIVED" && !v.receivedAt && { receivedAt: new Date().toISOString() }),
    };
    if (mode === "create") { if (await crud.create(payload as never)) setDrawerOpen(false); }
    else if (editing) { if (await crud.update(editing.id, payload)) setDrawerOpen(false); }
  }

  const godownById = new Map(godowns.data.map((g) => [g.id, g]));

  const columns: ColumnDef<Transfer>[] = [
    {
      accessorKey: "transferNumber",
      header: "#",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.transferNumber ?? row.original.id.slice(0, 8)}</span>,
    },
    {
      id: "route",
      header: "Route",
      cell: ({ row }) => (
        <div className="flex items-center gap-1 text-xs">
          <span>{godownById.get(row.original.sourceGodownId ?? "")?.name ?? "—"}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span>{godownById.get(row.original.destinationGodownId ?? "")?.name ?? "—"}</span>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const s = getValue() as string;
        const variant: "default" | "secondary" | "success" | "warning" =
          s === "RECEIVED" ? "success" : s === "IN_TRANSIT" ? "warning" : s === "CANCELLED" ? "secondary" : "default";
        return <Badge variant={variant} className="text-[10px]">{s.replace(/_/g, " ")}</Badge>;
      },
    },
    { accessorKey: "transporterName", header: "Transporter" },
    { accessorKey: "vehicleNumber", header: "Vehicle", cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string) ?? "—"}</span> },
    {
      accessorKey: "dispatchedAt",
      header: "Dispatched",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return <span className="text-xs">{v ? formatIST(new Date(v)) : "—"}</span>;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inter-godown transfers"
        description="Move units between your own godowns. Status transitions trigger UnitRecord updates."
        breadcrumbs={[{ label: "Inventory" }, { label: "Transfers" }]}
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> New transfer</Button>}
      />
      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search transfers..."
        emptyTitle="No transfers yet"
        emptyDescription="Move units from one godown to another."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> New transfer</Button>}
        onRowClick={openEdit}
        initialSorting={[{ id: "dispatchedAt", desc: true }]}
      />
      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="transfer"
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Plane className="h-4 w-4 text-muted-foreground" /> Transfer
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="From godown *">
              <Select value={form.watch("sourceGodownId")} onValueChange={(v) => form.setValue("sourceGodownId", v, { shouldValidate: true })}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  {godowns.data.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label="To godown *">
              <Select value={form.watch("destinationGodownId")} onValueChange={(v) => form.setValue("destinationGodownId", v, { shouldValidate: true })}>
                <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>
                  {godowns.data.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {form.formState.errors.destinationGodownId && <p className="text-[11px] text-destructive">{form.formState.errors.destinationGodownId.message}</p>}
            </Labeled>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Labeled label="Transporter"><Input {...form.register("transporterName")} /></Labeled>
            <Labeled label="Vehicle #"><Input className="font-mono" {...form.register("vehicleNumber")} /></Labeled>
            <Labeled label="LR #"><Input className="font-mono" {...form.register("lrDocketNumber")} /></Labeled>
          </div>
          <Labeled label="Status">
            <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v as typeof STATUSES[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </Labeled>
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

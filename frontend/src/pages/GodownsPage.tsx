import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Warehouse, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useCrud } from "@/hooks/use-crud";
import { useAuthStore } from "@/stores/auth-store";

const schema = z.object({
  name: z.string().min(2, "Required"),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/, "6-digit pincode")
    .optional()
    .or(z.literal("")),
  manager: z.string().optional(),
  phone: z.string().optional(),
});
type GodownFormValues = z.infer<typeof schema>;
interface Godown extends GodownFormValues {
  id: string;
}

export function GodownsPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const crud = useCrud<Godown>("Godown");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Godown | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Godown | null>(null);

  const form = useForm<GodownFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  function openCreate() {
    form.reset({ name: "" });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }
  function openEdit(g: Godown) {
    form.reset(g);
    setEditing(g);
    setMode("edit");
    setDrawerOpen(true);
  }
  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const values = form.getValues();
    const cleaned = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== "" && v !== undefined),
    ) as GodownFormValues;
    if (mode === "create") {
      if (await crud.create(cleaned as never)) setDrawerOpen(false);
    } else if (editing) {
      if (await crud.update(editing.id, cleaned)) setDrawerOpen(false);
    }
  }

  const columns: ColumnDef<Godown>[] = [
    {
      accessorKey: "name",
      header: "Godown",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.city && (
            <div className="text-xs text-muted-foreground">
              {row.original.city}
              {row.original.state ? `, ${row.original.state}` : ""}
            </div>
          )}
        </div>
      ),
    },
    { accessorKey: "manager", header: "Manager" },
    { accessorKey: "phone", header: "Phone" },
    { accessorKey: "pincode", header: "Pincode", cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string) || "—"}</span> },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(row.original)} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => setDeleteTarget(row.original)}
              aria-label="Delete"
            >
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
        title="Godowns"
        description="Physical storage locations. Every unit belongs to exactly one godown."
        breadcrumbs={[{ label: "Inventory" }, { label: "Godowns" }]}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New godown
          </Button>
        }
      />
      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search godowns..."
        emptyTitle="No godowns yet"
        emptyDescription="Add at least one godown before creating GRNs."
        emptyAction={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add godown
          </Button>
        }
        onRowClick={openEdit}
      />
      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="godown"
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Warehouse className="h-4 w-4 text-muted-foreground" /> Details
          </div>
          <div className="space-y-3">
            <Labeled label="Name *">
              <Input {...form.register("name")} placeholder="Mumbai Godown" />
              {form.formState.errors.name && <p className="text-[11px] text-destructive">{form.formState.errors.name.message}</p>}
            </Labeled>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Manager"><Input {...form.register("manager")} /></Labeled>
              <Labeled label="Phone"><Input {...form.register("phone")} inputMode="tel" /></Labeled>
            </div>
          </div>
        </Card>
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Address</div>
          <Labeled label="Address line 1"><Input {...form.register("addressLine1")} /></Labeled>
          <Labeled label="Address line 2"><Input {...form.register("addressLine2")} /></Labeled>
          <div className="grid grid-cols-3 gap-3">
            <Labeled label="City"><Input {...form.register("city")} /></Labeled>
            <Labeled label="State"><Input {...form.register("state")} /></Labeled>
            <Labeled label="Pincode">
              <Input {...form.register("pincode")} maxLength={6} inputMode="numeric" />
              {form.formState.errors.pincode && <p className="text-[11px] text-destructive">{form.formState.errors.pincode.message}</p>}
            </Labeled>
          </div>
        </Card>
      </EntityDrawer>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete godown "${deleteTarget?.name}"?`}
        description="Units assigned to this godown will become orphaned. Usually you want to move them to another godown first via a transfer order."
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteTarget) await crud.remove(deleteTarget.id);
        }}
      />
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

import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Users, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GstinInput } from "@/components/fields/gstin-input";
import { useCrud } from "@/hooks/use-crud";
import { useAuthStore } from "@/stores/auth-store";
import { GSTIN_REGEX } from "@shared/gstin";

const schema = z.object({
  name: z.string().min(2, "Required"),
  gstin: z.string().regex(GSTIN_REGEX, "Invalid GSTIN format").optional().or(z.literal("")),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN")
    .optional()
    .or(z.literal("")),
  contactName: z.string().optional(),
  contactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  billingEmail: z
    .string()
    .email("Invalid email — used for invoice delivery")
    .optional()
    .or(z.literal("")),
  contactPhone: z.string().optional(),
  billingAddressLine1: z.string().optional(),
  billingCity: z.string().optional(),
  billingState: z.string().optional(),
  billingPincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/, "6-digit pincode")
    .optional()
    .or(z.literal("")),
  tallyLedgerName: z.string().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  isActive: z.boolean().default(true),
});
type ClientFormValues = z.infer<typeof schema>;

interface Client extends ClientFormValues {
  id: string;
  stateCode?: string;
}

export function ClientsPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const crud = useCrud<Client>("Client");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      gstin: "",
      pan: "",
      paymentTermsDays: 30,
      isActive: true,
    },
  });

  function openCreate() {
    form.reset({ name: "", gstin: "", pan: "", paymentTermsDays: 30, isActive: true });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }

  function openEdit(client: Client) {
    form.reset(client);
    setEditing(client);
    setMode("edit");
    setDrawerOpen(true);
  }

  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const values = form.getValues();
    const cleaned = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== "" && v !== undefined),
    ) as ClientFormValues;
    const payload = { ...cleaned, stateCode: cleaned.gstin?.slice(0, 2) };

    if (mode === "create") {
      const created = await crud.create(payload as never);
      if (created) setDrawerOpen(false);
    } else if (editing) {
      const updated = await crud.update(editing.id, payload);
      if (updated) setDrawerOpen(false);
    }
  }

  const columns: ColumnDef<Client>[] = [
    {
      accessorKey: "name",
      header: "Client",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.billingCity && (
            <div className="text-xs text-muted-foreground">{row.original.billingCity}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "gstin",
      header: "GSTIN",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{(getValue() as string) || "—"}</span>
      ),
    },
    {
      accessorKey: "billingEmail",
      header: "Billing email",
      cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "paymentTermsDays",
      header: "Terms",
      cell: ({ getValue }) => <Badge variant="outline">Net {String(getValue())}</Badge>,
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ getValue }) =>
        getValue() ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="secondary">Inactive</Badge>
        ),
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
            onClick={() => openEdit(row.original)}
            aria-label="Edit"
          >
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

  const gstin = form.watch("gstin") ?? "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clients"
        description="Buyers of your AV work. Billing email is where invoices + MSME notices land."
        breadcrumbs={[{ label: "Finance" }, { label: "Clients" }]}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New client
          </Button>
        }
      />

      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search clients..."
        emptyTitle="No clients yet"
        emptyDescription="Add a client to start booking projects and issuing invoices."
        emptyAction={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add client
          </Button>
        }
        onRowClick={openEdit}
      />

      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="client"
        description="GSTIN drives interstate vs intrastate GST on DCs. Billing email receives invoice PDFs + MSME notices."
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Users className="h-4 w-4 text-muted-foreground" /> Identity
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Legal name *</Label>
              <Input id="name" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="text-[11px] text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <GstinInput
              value={gstin}
              onChange={(v) => form.setValue("gstin", v, { shouldValidate: true })}
              error={form.formState.errors.gstin?.message}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pan">PAN</Label>
                <Input
                  id="pan"
                  {...form.register("pan")}
                  className="font-mono uppercase"
                  maxLength={10}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paymentTermsDays">Payment terms (days)</Label>
                <Input
                  id="paymentTermsDays"
                  type="number"
                  min={0}
                  max={365}
                  {...form.register("paymentTermsDays")}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Contacts</div>
          <div className="grid grid-cols-2 gap-3">
            <InlineInput label="Primary contact" {...form.register("contactName")} />
            <InlineInput label="Phone" {...form.register("contactPhone")} inputMode="tel" />
            <InlineInput
              label="General email"
              type="email"
              {...form.register("contactEmail")}
            />
            <InlineInput
              label="Billing email"
              type="email"
              {...form.register("billingEmail")}
            />
            {form.formState.errors.billingEmail && (
              <p className="col-span-2 text-[11px] text-destructive">
                {form.formState.errors.billingEmail.message}
              </p>
            )}
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Billing address</div>
          <InlineInput label="Address line 1" {...form.register("billingAddressLine1")} />
          <div className="grid grid-cols-3 gap-3">
            <InlineInput label="City" {...form.register("billingCity")} />
            <InlineInput label="State" {...form.register("billingState")} />
            <InlineInput
              label="Pincode"
              {...form.register("billingPincode")}
              maxLength={6}
              inputMode="numeric"
            />
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Tally & status</div>
          <InlineInput
            label="Tally ledger name"
            {...form.register("tallyLedgerName")}
            hint="Must match the client's ledger name in TallyPrime exactly."
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox {...form.register("isActive")} />
            <span className="text-sm">Active client (unchecked = archived)</span>
          </label>
        </Card>
      </EntityDrawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete client "${deleteTarget?.name}"?`}
        description="Historical invoices + projects keep their reference but show the client as archived. This cannot be undone."
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteTarget) await crud.remove(deleteTarget.id);
        }}
      />
    </div>
  );
}

function InlineInput({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} {...props} />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

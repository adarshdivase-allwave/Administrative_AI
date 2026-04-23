import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GstinInput } from "@/components/fields/gstin-input";
import { useCrud } from "@/hooks/use-crud";
import { useAuthStore } from "@/stores/auth-store";
import { GSTIN_REGEX } from "@shared/gstin";

/**
 * Vendors — reference implementation for every CRUD page in the platform.
 *
 * Any field that affects compliance (GSTIN, Tally ledger name, MSME flag,
 * payment terms) is validated at both levels:
 *   - Zod schema — catches structural errors at submit time
 *   - Live field UI (`<GstinInput>`) — gives immediate feedback as user types
 */
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
  contactPhone: z.string().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z
    .string()
    .regex(/^[1-9][0-9]{5}$/, "6-digit pincode")
    .optional()
    .or(z.literal("")),
  tallyLedgerName: z.string().optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  msmeRegistered: z.boolean().default(false),
  msmeUdyamNumber: z.string().optional(),
  isActive: z.boolean().default(true),
  notes: z.string().optional(),
});
type VendorFormValues = z.infer<typeof schema>;

interface Vendor extends VendorFormValues {
  id: string;
  stateCode?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function VendorsPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const crud = useCrud<Vendor>("Vendor");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null);

  const form = useForm<VendorFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      gstin: "",
      pan: "",
      paymentTermsDays: 30,
      msmeRegistered: false,
      isActive: true,
    },
  });

  function openCreate() {
    form.reset({
      name: "",
      gstin: "",
      pan: "",
      paymentTermsDays: 30,
      msmeRegistered: false,
      isActive: true,
    });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }

  function openEdit(vendor: Vendor) {
    form.reset(vendor);
    setEditing(vendor);
    setMode("edit");
    setDrawerOpen(true);
  }

  async function onSubmit() {
    const valid = await form.trigger();
    if (!valid) return;
    const values = form.getValues();
    // Strip empty strings for optional fields so DynamoDB doesn't store them.
    const cleaned = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== "" && v !== undefined),
    ) as VendorFormValues;

    if (mode === "create") {
      const created = await crud.create({
        ...cleaned,
        stateCode: cleaned.gstin?.slice(0, 2),
      } as never);
      if (created) setDrawerOpen(false);
    } else if (editing) {
      const updated = await crud.update(editing.id, {
        ...cleaned,
        stateCode: cleaned.gstin?.slice(0, 2),
      });
      if (updated) setDrawerOpen(false);
    }
  }

  const columns: ColumnDef<Vendor>[] = [
    {
      accessorKey: "name",
      header: "Vendor",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.city && (
            <div className="text-xs text-muted-foreground">{row.original.city}</div>
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
      accessorKey: "contactEmail",
      header: "Contact",
      cell: ({ row }) => (
        <div className="text-xs">
          <div>{row.original.contactEmail ?? "—"}</div>
          <div className="text-muted-foreground">{row.original.contactPhone ?? ""}</div>
        </div>
      ),
    },
    {
      accessorKey: "paymentTermsDays",
      header: "Terms",
      cell: ({ getValue }) => <Badge variant="outline">Net {String(getValue())}</Badge>,
    },
    {
      accessorKey: "msmeRegistered",
      header: "MSME",
      cell: ({ getValue }) =>
        getValue() ? <Badge variant="secondary">Yes</Badge> : <span className="text-muted-foreground">—</span>,
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
        title="Vendors"
        description="Suppliers of inventory items. GSTIN + Tally ledger mappings live here."
        breadcrumbs={[{ label: "Procurement" }, { label: "Vendors" }]}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New vendor
          </Button>
        }
      />

      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search by name, GSTIN, city..."
        emptyTitle="No vendors yet"
        emptyDescription="Add your first vendor to start creating GRNs and purchase orders."
        emptyAction={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add vendor
          </Button>
        }
        onRowClick={openEdit}
      />

      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="vendor"
        description="GSTIN auto-detects the state code. Tally ledger name must match your TallyPrime ledger exactly."
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <FormSection icon={Building2} title="Identity">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Vendor name *</Label>
              <Input
                id="name"
                {...form.register("name")}
                placeholder="LG Electronics India Pvt Ltd"
              />
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
                  placeholder="AAACL1234A"
                  className="font-mono uppercase"
                  maxLength={10}
                />
                {form.formState.errors.pan && (
                  <p className="text-[11px] text-destructive">{form.formState.errors.pan.message}</p>
                )}
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
        </FormSection>

        <FormSection title="Contact">
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label="Contact name" {...form.register("contactName")} />
            <LabeledInput label="Phone" {...form.register("contactPhone")} inputMode="tel" />
            <LabeledInput
              label="Email"
              type="email"
              {...form.register("contactEmail")}
              className="col-span-2"
            />
            {form.formState.errors.contactEmail && (
              <p className="col-span-2 text-[11px] text-destructive">
                {form.formState.errors.contactEmail.message}
              </p>
            )}
          </div>
        </FormSection>

        <FormSection title="Address">
          <div className="space-y-3">
            <LabeledInput label="Address line 1" {...form.register("addressLine1")} />
            <div className="grid grid-cols-3 gap-3">
              <LabeledInput label="City" {...form.register("city")} />
              <LabeledInput label="State" {...form.register("state")} />
              <LabeledInput
                label="Pincode"
                {...form.register("pincode")}
                maxLength={6}
                inputMode="numeric"
              />
            </div>
            {form.formState.errors.pincode && (
              <p className="text-[11px] text-destructive">
                {form.formState.errors.pincode.message}
              </p>
            )}
          </div>
        </FormSection>

        <FormSection title="Tally + MSME">
          <div className="space-y-3">
            <LabeledInput
              label="Tally ledger name"
              placeholder="LG Electronics"
              {...form.register("tallyLedgerName")}
              hint="Must match the ledger name as it appears in TallyPrime exactly."
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox {...form.register("msmeRegistered")} />
              <span className="text-sm">Vendor is MSME-registered</span>
            </label>
            {form.watch("msmeRegistered") && (
              <LabeledInput
                label="Udyam Registration Number"
                {...form.register("msmeUdyamNumber")}
              />
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox {...form.register("isActive")} />
              <span className="text-sm">Active vendor (unchecked = archived)</span>
            </label>
          </div>
        </FormSection>

        <FormSection title="Notes">
          <Textarea rows={3} {...form.register("notes")} placeholder="Internal notes" />
        </FormSection>
      </EntityDrawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete vendor "${deleteTarget?.name}"?`}
        description="This permanently removes the vendor. Historical GRNs + POs keep their reference but show the vendor as archived."
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteTarget) await crud.remove(deleteTarget.id);
        }}
      />
    </div>
  );
}

function FormSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <span>{title}</span>
      </div>
      {children}
    </Card>
  );
}

function LabeledInput({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}


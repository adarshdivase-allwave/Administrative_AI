import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { type ColumnDef } from "@tanstack/react-table";
import { Tag, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { EntityDrawer } from "@/components/entity-drawer";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { HsnInput } from "@/components/fields/hsn-input";
import { MoneyInput } from "@/components/fields/money-input";
import { useCrud } from "@/hooks/use-crud";
import { useAuthStore } from "@/stores/auth-store";
import { PRODUCT_CATEGORIES } from "@shared/constants";
import { formatInr } from "@shared/currency";
import { normalizeHsnForTally, validateHsn } from "@shared/hsn";

const schema = z.object({
  productName: z.string().min(2, "Required"),
  brand: z.string().optional(),
  category: z.enum([...PRODUCT_CATEGORIES, ""] as [string, ...string[]]).optional(),
  modelNumber: z.string().optional(),
  hsnCode: z.string().optional(),
  gstRatePercent: z.coerce.number().min(0).max(28).default(18),
  sellingPrice: z.coerce.number().min(0).default(0),
  unitOfMeasure: z.string().default("Nos"),
  lowStockThreshold: z.coerce.number().int().min(0).default(0),
  reorderQuantity: z.coerce.number().int().min(0).default(0),
  importRequired: z.boolean().default(false),
  importLeadTimeDays: z.coerce.number().int().min(0).optional(),
  countryOfOrigin: z.string().optional(),
  customsDutyPercent: z.coerce.number().min(0).max(100).optional(),
  warrantyPeriodMonths: z.coerce.number().int().min(0).default(12),
  amcEligible: z.boolean().default(false),
  weightKg: z.coerce.number().min(0).optional(),
  dimensionsLxWxHCm: z.string().optional(),
});
type ProductFormValues = z.infer<typeof schema>;
interface Product extends ProductFormValues {
  id: string;
  hsnTallyFormat?: string;
  hsnTallyCompatible?: boolean;
  sellingPriceExGST?: number;
}

export function ProductsPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const crud = useCrud<Product>("ProductMaster");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      productName: "",
      gstRatePercent: 18,
      sellingPrice: 0,
      unitOfMeasure: "Nos",
      lowStockThreshold: 0,
      reorderQuantity: 0,
      importRequired: false,
      warrantyPeriodMonths: 12,
      amcEligible: false,
    },
  });

  function openCreate() {
    form.reset({
      productName: "",
      gstRatePercent: 18,
      sellingPrice: 0,
      unitOfMeasure: "Nos",
      lowStockThreshold: 0,
      reorderQuantity: 0,
      importRequired: false,
      warrantyPeriodMonths: 12,
      amcEligible: false,
    });
    setEditing(null);
    setMode("create");
    setDrawerOpen(true);
  }
  function openEdit(p: Product) {
    form.reset(p);
    setEditing(p);
    setMode("edit");
    setDrawerOpen(true);
  }

  async function onSubmit() {
    const ok = await form.trigger();
    if (!ok) return;
    const values = form.getValues();
    const cleaned = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== "" && v !== undefined),
    ) as ProductFormValues;

    // Derived fields: Tally-normalized HSN, exclusive-GST price.
    const hsnValid = values.hsnCode ? validateHsn(values.hsnCode) : null;
    const tallyFormat = values.hsnCode ? normalizeHsnForTally(values.hsnCode) : undefined;
    const exGst =
      values.sellingPrice > 0 && values.gstRatePercent > 0
        ? Math.round((values.sellingPrice / (1 + values.gstRatePercent / 100)) * 100) / 100
        : values.sellingPrice;

    const payload = {
      ...cleaned,
      hsnTallyFormat: tallyFormat,
      hsnTallyCompatible: hsnValid?.valid ?? false,
      hsnCodeSource: "MANUAL" as const,
      sellingPriceExGST: exGst,
    };

    if (mode === "create") {
      if (await crud.create(payload as never)) setDrawerOpen(false);
    } else if (editing) {
      if (await crud.update(editing.id, payload)) setDrawerOpen(false);
    }
  }

  const columns: ColumnDef<Product>[] = [
    {
      accessorKey: "productName",
      header: "Product",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.productName}</div>
          <div className="text-[11px] text-muted-foreground">
            {row.original.brand ?? "—"}
            {row.original.modelNumber ? ` · ${row.original.modelNumber}` : ""}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ getValue }) => <Badge variant="outline">{(getValue() as string) || "—"}</Badge>,
    },
    {
      accessorKey: "hsnCode",
      header: "HSN",
      cell: ({ getValue, row }) => {
        const v = getValue() as string | undefined;
        if (!v) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-1 font-mono text-xs">
            {v}
            {row.original.hsnTallyCompatible === false && (
              <Badge variant="destructive" className="text-[9px]">Tally ✗</Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "gstRatePercent",
      header: "GST",
      cell: ({ getValue }) => `${String(getValue() ?? "—")}%`,
    },
    {
      accessorKey: "sellingPrice",
      header: () => <div className="text-right">MRP</div>,
      cell: ({ getValue }) => {
        const v = getValue() as number | undefined;
        return <div className="text-right font-mono text-xs">{v ? formatInr(v, { showSymbol: false }) : "—"}</div>;
      },
    },
    {
      accessorKey: "importRequired",
      header: "Import",
      cell: ({ getValue }) =>
        getValue() ? <Badge variant="warning">Imported</Badge> : <span className="text-muted-foreground">—</span>,
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
        title="Products"
        description="The catalog. Each physical unit in inventory refers to a product here."
        breadcrumbs={[{ label: "Inventory" }, { label: "Products" }]}
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> New product</Button>}
      />
      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search by name, brand, model, HSN..."
        emptyTitle="No products yet"
        emptyDescription="Create the product catalog before you can ingest GRNs."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" /> Add product</Button>}
        onRowClick={openEdit}
      />
      <EntityDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        entityName="product"
        description="HSN code drives GST + Tally export. Imported products unlock import-specific fields."
        onSubmit={onSubmit}
        submitting={form.formState.isSubmitting}
      >
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Tag className="h-4 w-4 text-muted-foreground" /> Identity
          </div>
          <Labeled label="Product name *">
            <Input {...form.register("productName")} />
            {form.formState.errors.productName && <p className="text-[11px] text-destructive">{form.formState.errors.productName.message}</p>}
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Brand"><Input {...form.register("brand")} /></Labeled>
            <Labeled label="Model #"><Input {...form.register("modelNumber")} className="font-mono" /></Labeled>
          </div>
          <Labeled label="Category">
            <Select
              value={form.watch("category") ?? ""}
              onValueChange={(v) => form.setValue("category", v as ProductFormValues["category"])}
            >
              <SelectTrigger><SelectValue placeholder="Pick a category" /></SelectTrigger>
              <SelectContent>
                {PRODUCT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labeled>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">HSN + GST</div>
          <HsnInput
            value={form.watch("hsnCode") ?? ""}
            onChange={(v) => form.setValue("hsnCode", v)}
            error={form.formState.errors.hsnCode?.message}
          />
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="GST rate %">
              <Input type="number" step="0.01" {...form.register("gstRatePercent")} />
            </Labeled>
            <Labeled label="Unit of measure">
              <Input {...form.register("unitOfMeasure")} placeholder="Nos" />
            </Labeled>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Pricing</div>
          <MoneyInput
            label="Selling price (inc. GST)"
            required
            {...form.register("sellingPrice")}
            value={form.watch("sellingPrice")}
          />
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Stock thresholds</div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Low-stock threshold">
              <Input type="number" min={0} {...form.register("lowStockThreshold")} />
            </Labeled>
            <Labeled label="Reorder quantity">
              <Input type="number" min={0} {...form.register("reorderQuantity")} />
            </Labeled>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Imports</div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox {...form.register("importRequired")} />
            <span className="text-sm">This product is imported</span>
          </label>
          {form.watch("importRequired") && (
            <div className="grid grid-cols-3 gap-3">
              <Labeled label="Lead time (days)">
                <Input type="number" min={0} {...form.register("importLeadTimeDays")} />
              </Labeled>
              <Labeled label="Country of origin">
                <Input {...form.register("countryOfOrigin")} placeholder="USA" />
              </Labeled>
              <Labeled label="Customs duty %">
                <Input type="number" step="0.01" {...form.register("customsDutyPercent")} />
              </Labeled>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Warranty + physical</div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Warranty (months)">
              <Input type="number" min={0} {...form.register("warrantyPeriodMonths")} />
            </Labeled>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox {...form.register("amcEligible")} />
                <span className="text-sm">AMC eligible</span>
              </label>
            </div>
            <Labeled label="Weight (kg)">
              <Input type="number" step="0.01" {...form.register("weightKg")} />
            </Labeled>
            <Labeled label="Dimensions L×W×H cm">
              <Input {...form.register("dimensionsLxWxHCm")} placeholder="124.5 × 71.2 × 8.4" />
            </Labeled>
          </div>
        </Card>
      </EntityDrawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={`Delete product "${deleteTarget?.productName}"?`}
        destructive
        confirmLabel="Delete"
        description="Units referencing this product will show '(unknown product)'. Normally you want to archive rather than delete."
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

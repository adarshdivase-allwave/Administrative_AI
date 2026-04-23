import * as React from "react";
import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Plus,
  Save,
  Search,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/amplify-client";
import { useCrud } from "@/hooks/use-crud";
import { DC_TYPES, type DcType } from "@shared/constants";
import { checkEWayBillRequirement, validateEWayBillForDc } from "@shared/eway-bill";
import { isIntrastate } from "@shared/gstin";
import { splitGst, formatInr } from "@shared/currency";
import { fyShort } from "@shared/fy";
import { cn } from "@/lib/cn";

/**
 * DC Create — moves units from General Stock to a target category.
 *
 * Compliance rails:
 *   - e-Way Bill becomes required at ≥ ₹50,000 total value
 *   - GST split = intrastate (CGST+SGST) when company+client share state,
 *     interstate (IGST) otherwise — inferred from GSTIN state codes
 *   - DC number auto-generated in GST-compliant format (DC-YYXX-NNNNN)
 *
 * Data flow on save:
 *   1. Create DeliveryChallan header (state = DRAFT)
 *   2. For each picked unit:
 *      - Create DispatchLineItem row
 *      - Update UnitRecord: inventoryCategory -> (PROJECT/DEMO/…),
 *                           status -> (ALLOCATED/ON_DEMO/…),
 *                           currentProjectId / currentDemoId as appropriate
 *   3. Update DC header with totals + status = DISPATCHED
 */

const schema = z.object({
  dcNumber: z.string().min(3, "Required"),
  dcDate: z.string().min(1, "Required"),
  dcType: z.enum(DC_TYPES),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  deliveryAddressLine1: z.string().optional(),
  deliveryCity: z.string().optional(),
  deliveryState: z.string().optional(),
  deliveryPincode: z.string().optional(),
  transporterName: z.string().optional(),
  vehicleNumber: z.string().optional(),
  lrDocketNumber: z.string().optional(),
  eWayBillNumber: z.string().optional(),
  notes: z.string().optional(),
});
type DcForm = z.infer<typeof schema>;

interface Unit {
  id: string;
  serialNumber?: string;
  productId?: string;
  inventoryCategory?: string;
  status?: string;
  godownId?: string;
  godownLocation?: string;
  purchasePrice?: number;
  hsnTallyFormat?: string;
}
interface Product {
  id: string;
  productName?: string;
  modelNumber?: string;
  gstRatePercent?: number;
  sellingPrice?: number;
  hsnTallyFormat?: string;
}
interface Client { id: string; name: string; gstin?: string; billingAddressLine1?: string; billingCity?: string; billingState?: string; billingPincode?: string }
interface Project { id: string; projectName: string; clientId?: string; siteAddressLine1?: string; siteCity?: string; siteState?: string; sitePincode?: string }

const CATEGORY_MAP: Record<DcType, { category: string; status: string }> = {
  PROJECT: { category: "PROJECT", status: "ALLOCATED_TO_PROJECT" },
  DEMO: { category: "DEMO", status: "ON_DEMO" },
  STANDBY: { category: "STANDBY", status: "ON_STANDBY" },
  ASSET: { category: "ASSET", status: "ASSET_IN_USE" },
};

export function DcCreatePage() {
  const nav = useNavigate();
  const units = useCrud<Unit>("UnitRecord", {
    filter: { status: { eq: "IN_STOCK" } },
    limit: 500,
  });
  const products = useCrud<Product>("ProductMaster");
  const clients = useCrud<Client>("Client");
  const projects = useCrud<Project>("Project");

  // Company state code for intrastate check — in production this comes from
  // SystemSettings. For now use an env var fallback.
  const companyGstin = (import.meta.env.VITE_COMPANY_GSTIN as string | undefined) ?? "";

  const form = useForm<DcForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      dcNumber: `DC-${fyShort(new Date())}-${String(Date.now()).slice(-5)}`,
      dcDate: new Date().toISOString().slice(0, 10),
      dcType: "PROJECT",
    },
  });

  const dcType = form.watch("dcType");
  const clientId = form.watch("clientId");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const productById = useMemo(
    () => new Map(products.data.map((p) => [p.id, p])),
    [products.data],
  );
  const pickedUnits = useMemo(
    () => units.data.filter((u) => pickedIds.has(u.id)),
    [units.data, pickedIds],
  );

  // Auto-fill address from project or client on change.
  React.useEffect(() => {
    const projectId = form.getValues("projectId");
    if (dcType === "PROJECT" && projectId) {
      const p = projects.data.find((x) => x.id === projectId);
      if (p) {
        form.setValue("deliveryAddressLine1", p.siteAddressLine1 ?? "");
        form.setValue("deliveryCity", p.siteCity ?? "");
        form.setValue("deliveryState", p.siteState ?? "");
        form.setValue("deliveryPincode", p.sitePincode ?? "");
        if (p.clientId) form.setValue("clientId", p.clientId);
      }
    } else if (clientId) {
      const c = clients.data.find((x) => x.id === clientId);
      if (c) {
        form.setValue("deliveryAddressLine1", c.billingAddressLine1 ?? "");
        form.setValue("deliveryCity", c.billingCity ?? "");
        form.setValue("deliveryState", c.billingState ?? "");
        form.setValue("deliveryPincode", c.billingPincode ?? "");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.watch("projectId"), clientId, dcType]);

  const client = clients.data.find((c) => c.id === clientId);
  const intrastate = companyGstin && client?.gstin ? isIntrastate(companyGstin, client.gstin) : true;

  // Compute totals.
  const totals = useMemo(() => {
    let subtotal = 0;
    let gst = 0;
    for (const u of pickedUnits) {
      const p = productById.get(u.productId ?? "");
      const basePrice = p?.sellingPrice ?? u.purchasePrice ?? 0;
      const rate = p?.gstRatePercent ?? 18;
      const split = splitGst(basePrice, rate, intrastate);
      subtotal += split.exclusive;
      gst += split.cgst + split.sgst + split.igst;
    }
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      gst: Math.round(gst * 100) / 100,
      total: Math.round((subtotal + gst) * 100) / 100,
    };
  }, [pickedUnits, productById, intrastate]);

  const eway = checkEWayBillRequirement(totals.total);

  async function handleSave() {
    const ok = await form.trigger();
    if (!ok) { toast.error("Fix the header errors first"); return; }
    if (pickedUnits.length === 0) { toast.error("Pick at least one unit"); return; }

    const values = form.getValues();

    // e-Way Bill enforcement.
    const evCheck = validateEWayBillForDc({
      totalValueInr: totals.total,
      eWayBillNumber: values.eWayBillNumber,
    });
    if (!evCheck.ok) { toast.error(evCheck.error); return; }

    if (dcType === "PROJECT" && !values.projectId) { toast.error("Pick a project"); return; }
    if (dcType !== "STANDBY" && !values.clientId) { toast.error("Pick a client"); return; }

    setSaving(true);
    try {
      // 1. Create DC.
      const dcRes = await (
        api.models as unknown as {
          DeliveryChallan: {
            create: (input: Record<string, unknown>) => Promise<{ data?: { id: string }; errors?: unknown }>;
          };
        }
      ).DeliveryChallan.create({
        dcNumber: values.dcNumber,
        dcDate: new Date(values.dcDate).toISOString(),
        dcType: values.dcType,
        clientId: values.clientId,
        projectId: values.projectId,
        deliveryAddressLine1: values.deliveryAddressLine1,
        deliveryCity: values.deliveryCity,
        deliveryState: values.deliveryState,
        deliveryPincode: values.deliveryPincode,
        transporterName: values.transporterName,
        vehicleNumber: values.vehicleNumber,
        lrDocketNumber: values.lrDocketNumber,
        eWayBillNumber: values.eWayBillNumber,
        eWayBillRequired: eway.required,
        totalValueInr: totals.total,
        totalGstInr: totals.gst,
        intrastate,
        placeOfSupplyStateCode: client?.gstin?.slice(0, 2),
        status: "DISPATCHED",
        notes: values.notes,
      });
      if (!dcRes.data?.id) throw new Error("DC create returned no id");
      const dcId = dcRes.data.id;

      // 2. Create DispatchLineItem per unit + update UnitRecord.
      for (const unit of pickedUnits) {
        const product = productById.get(unit.productId ?? "");
        await (
          api.models as unknown as {
            DispatchLineItem: {
              create: (input: Record<string, unknown>) => Promise<{ errors?: unknown }>;
            };
          }
        ).DispatchLineItem.create({
          deliveryChallanId: dcId,
          unitId: unit.id,
          productName: product?.productName,
          modelNumber: product?.modelNumber,
          hsnTallyFormat: product?.hsnTallyFormat ?? unit.hsnTallyFormat,
          unitPriceInr: product?.sellingPrice ?? unit.purchasePrice ?? 0,
          gstRatePercent: product?.gstRatePercent ?? 18,
        });

        const mapping = CATEGORY_MAP[values.dcType];
        await (
          api.models as unknown as {
            UnitRecord: {
              update: (input: Record<string, unknown>) => Promise<{ errors?: unknown }>;
            };
          }
        ).UnitRecord.update({
          id: unit.id,
          inventoryCategory: mapping.category,
          status: mapping.status,
          currentProjectId: values.dcType === "PROJECT" ? values.projectId : undefined,
        });
      }

      toast.success(`DC ${values.dcNumber} saved — ${pickedUnits.length} unit(s) dispatched`);
      nav("/dc");
    } catch (e) {
      toast.error((e as Error).message ?? "DC save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeader
        title="New Delivery Challan"
        description="Move units from General Stock to a project, demo, standby, or asset category."
        breadcrumbs={[{ label: "Inventory" }, { label: "DC", to: "/dc" }, { label: "New" }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/dc">Cancel</Link>
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save DC
            </Button>
          </>
        }
      />

      <Card className="p-4 space-y-4">
        <div className="text-sm font-medium">Header</div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="DC number *" error={form.formState.errors.dcNumber?.message}>
            <Input className="font-mono" {...form.register("dcNumber")} />
          </Field>
          <Field label="DC date *" error={form.formState.errors.dcDate?.message}>
            <Input type="date" {...form.register("dcDate")} />
          </Field>
          <Field label="DC type *">
            <Select value={dcType} onValueChange={(v) => form.setValue("dcType", v as DcType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DC_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {dcType === "PROJECT" && (
            <Field label="Project *">
              <Select
                value={form.watch("projectId") ?? ""}
                onValueChange={(v) => form.setValue("projectId", v)}
              >
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.data.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {(dcType === "PROJECT" || dcType === "DEMO" || dcType === "ASSET") && (
            <Field label="Client *">
              <Select
                value={form.watch("clientId") ?? ""}
                onValueChange={(v) => form.setValue("clientId", v)}
              >
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clients.data.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div className="text-sm font-medium">Delivery address</div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Address"><Input {...form.register("deliveryAddressLine1")} /></Field>
          <Field label="City"><Input {...form.register("deliveryCity")} /></Field>
          <Field label="State"><Input {...form.register("deliveryState")} /></Field>
          <Field label="Pincode"><Input {...form.register("deliveryPincode")} maxLength={6} /></Field>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div className="text-sm font-medium">Transporter + e-Way Bill</div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Transporter"><Input {...form.register("transporterName")} /></Field>
          <Field label="Vehicle #"><Input className="font-mono" {...form.register("vehicleNumber")} /></Field>
          <Field label="LR / docket #"><Input className="font-mono" {...form.register("lrDocketNumber")} /></Field>
        </div>
        <div
          className={cn(
            "rounded-md border p-3 text-sm flex items-start gap-2",
            eway.required ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-border bg-muted/40",
          )}
        >
          {eway.required ? (
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : (
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
          )}
          <div className="flex-1">
            <div className="font-medium">{eway.message}</div>
            <Input
              className={cn("mt-2 font-mono", !eway.required && "max-w-xs")}
              placeholder="12-digit e-Way Bill number"
              inputMode="numeric"
              maxLength={12}
              {...form.register("eWayBillNumber")}
            />
          </div>
        </div>

        <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
          <div className="font-medium flex items-center gap-1">
            {intrastate ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Info className="h-3 w-3 text-primary" />}
            {intrastate ? "Intrastate supply" : "Interstate supply"}
          </div>
          <div className="text-muted-foreground">
            {intrastate
              ? "CGST + SGST will apply (each at half the product's GST rate)."
              : "IGST will apply at the full product GST rate."}
            {!companyGstin && " Set VITE_COMPANY_GSTIN or configure System Settings for accurate detection."}
          </div>
        </div>
      </Card>

      {/* Unit picker */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">
            Units to dispatch{" "}
            <Badge variant="outline">{pickedUnits.length} picked</Badge>
          </div>
          <Button variant="outline" onClick={() => setPickerOpen(true)} disabled={units.loading}>
            <Plus className="h-4 w-4" /> Pick units from stock
          </Button>
        </div>
        {pickedUnits.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No units picked yet. Click "Pick units from stock" to choose from General Stock.
          </p>
        ) : (
          <div className="divide-y">
            {pickedUnits.map((u) => {
              const p = productById.get(u.productId ?? "");
              return (
                <div key={u.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p?.productName ?? "(unknown product)"}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      SN: {u.serialNumber} · {u.godownLocation ?? "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono">
                      {p?.sellingPrice ? formatInr(p.sellingPrice, { showSymbol: false }) : "—"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setPickedIds((s) => {
                          const next = new Set(s);
                          next.delete(u.id);
                          return next;
                        });
                      }}
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Totals */}
      <Card className="p-4 space-y-2 font-mono text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal (ex-GST)</span>
          <span>{formatInr(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">GST ({intrastate ? "CGST+SGST" : "IGST"})</span>
          <span>{formatInr(totals.gst)}</span>
        </div>
        <Separator />
        <div className="flex justify-between text-base">
          <span>Grand total</span>
          <span className="font-semibold text-primary">{formatInr(totals.total)}</span>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <Label>Notes</Label>
        <Textarea rows={3} {...form.register("notes")} placeholder="Internal notes" />
      </Card>

      <UnitPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allUnits={units.data}
        products={productById}
        alreadyPicked={pickedIds}
        onPick={(id) =>
          setPickedIds((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
      />
    </div>
  );
}

function UnitPickerDialog({
  open,
  onOpenChange,
  allUnits,
  products,
  alreadyPicked,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allUnits: Unit[];
  products: Map<string, Product>;
  alreadyPicked: Set<string>;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allUnits;
    return allUnits.filter((u) => {
      const p = products.get(u.productId ?? "");
      return (
        (u.serialNumber ?? "").toLowerCase().includes(q) ||
        (p?.productName ?? "").toLowerCase().includes(q) ||
        (p?.modelNumber ?? "").toLowerCase().includes(q) ||
        (u.godownLocation ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, allUnits, products]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick units from General Stock</DialogTitle>
          <DialogDescription>
            {allUnits.length} available units with status IN_STOCK. Click to toggle.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by serial, product, location..."
            className="pl-9"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto divide-y -mx-2 px-2">
          {matching.map((u) => {
            const p = products.get(u.productId ?? "");
            const picked = alreadyPicked.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onPick(u.id)}
                className={cn(
                  "flex w-full items-center justify-between py-2 text-left hover:bg-accent/40 rounded-md px-2",
                  picked && "bg-primary/5",
                )}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{p?.productName ?? "(unknown)"}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    SN: {u.serialNumber} · {u.godownLocation ?? "—"}
                  </div>
                </div>
                {picked ? (
                  <Badge variant="success" className="flex-shrink-0">Picked</Badge>
                ) : (
                  <Badge variant="outline" className="flex-shrink-0">Available</Badge>
                )}
              </button>
            );
          })}
          {matching.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No units match "{query}".
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

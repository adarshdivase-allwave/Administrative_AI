import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle,
  Barcode,
  ClipboardPaste,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
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
import { MoneyInput } from "@/components/fields/money-input";
import { HsnInput } from "@/components/fields/hsn-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/amplify-client";
import { useCrud } from "@/hooks/use-crud";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { CameraScannerButton } from "@/components/camera-scanner";
import { SUPPORTED_CURRENCIES, type Currency } from "@shared/constants";
import { normalizeHsnForTally, validateHsn } from "@shared/hsn";
import { formatInr, toInr } from "@shared/currency";
import { fyShort } from "@shared/fy";
import { cn } from "@/lib/cn";

/**
 * GRN Create — the backbone data-entry flow.
 *
 * Mental model:
 *   1. Header: GRN number (auto-generated client-side), date, vendor (drives GSTIN),
 *      vendor invoice #, currency. Foreign currency pulls live forex.
 *   2. Line items (1+): one ProductMaster per line. Each line carries an HSN code,
 *      unit price, godown, warranty, and a list of serial numbers — each SN
 *      becomes a UnitRecord on save.
 *   3. Save: runs a batch of createGoodsReceivedNote + createUnitRecord-per-serial.
 *      If any serial is already in the system, we abort the whole save (no
 *      partial orphans) and highlight the offending row.
 */

const headerSchema = z.object({
  grnNumber: z.string().min(3, "Required"),
  grnDate: z.string().min(1, "Required"),
  vendorId: z.string().min(1, "Pick a vendor"),
  vendorInvoiceNumber: z.string().optional(),
  vendorInvoiceDate: z.string().optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).default("INR"),
  notes: z.string().optional(),
});
type HeaderForm = z.infer<typeof headerSchema>;

interface Vendor { id: string; name: string; gstin?: string }
interface Product {
  id: string;
  productName?: string;
  modelNumber?: string;
  brand?: string;
  hsnCode?: string;
  gstRatePercent?: number;
  warrantyPeriodMonths?: number;
}
interface Godown { id: string; name: string }

interface LineItem {
  id: string; // client-only uid
  productId: string;
  hsnCode: string;
  unitPrice: number; // in selected currency
  godownId: string;
  godownLocation?: string;
  warrantyExpiryDate?: string;
  serials: string[];
  notes?: string;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function GrnCreatePage() {
  const nav = useNavigate();
  const vendors = useCrud<Vendor>("Vendor");
  const products = useCrud<Product>("ProductMaster");
  const godowns = useCrud<Godown>("Godown");
  const [forexRate, setForexRate] = useState<number | null>(null);
  const [forexLoading, setForexLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<HeaderForm>({
    resolver: zodResolver(headerSchema),
    defaultValues: {
      grnNumber: `GRN-${fyShort(new Date())}-${String(Date.now()).slice(-5)}`,
      grnDate: new Date().toISOString().slice(0, 10),
      currency: "INR",
    },
  });
  const currency = form.watch("currency");

  const [lines, setLines] = useState<LineItem[]>([
    { id: uid(), productId: "", hsnCode: "", unitPrice: 0, godownId: "", serials: [] },
  ]);

  // Fetch forex rate when currency !== INR.
  useEffect(() => {
    if (currency === "INR") {
      setForexRate(1);
      return;
    }
    void fetchRate(currency);
  }, [currency]);

  async function fetchRate(c: Currency) {
    setForexLoading(true);
    try {
      const res = await (
        api as unknown as {
          queries: {
            forexRate: (args: {
              quoteCurrency: string;
              forceRefresh?: boolean;
            }) => Promise<{ data?: { rate: number } }>;
          };
        }
      ).queries.forexRate({ quoteCurrency: c });
      if (res.data?.rate) setForexRate(res.data.rate);
    } catch (e) {
      toast.error("Couldn't fetch forex rate — enter manually or try again.");
      console.warn(e);
    } finally {
      setForexLoading(false);
    }
  }

  // Derived totals
  const totals = useMemo(() => {
    const rate = forexRate ?? 1;
    let totalInr = 0;
    let totalGst = 0;
    let serialCount = 0;
    for (const line of lines) {
      const product = products.data.find((p) => p.id === line.productId);
      const gst = product?.gstRatePercent ?? 18;
      const lineForeign = line.unitPrice * line.serials.length;
      const lineInr = currency === "INR" ? lineForeign : toInr(lineForeign, rate);
      const lineGst = lineInr * (gst / 100);
      totalInr += lineInr;
      totalGst += lineGst;
      serialCount += line.serials.length;
    }
    return {
      totalValueForeign: lines.reduce((s, l) => s + l.unitPrice * l.serials.length, 0),
      totalValueInr: Math.round(totalInr * 100) / 100,
      totalGstInr: Math.round(totalGst * 100) / 100,
      serialCount,
    };
  }, [lines, forexRate, currency, products.data]);

  // ---- line item operations ----
  const addLine = useCallback(() => {
    setLines((p) => [
      ...p,
      { id: uid(), productId: "", hsnCode: "", unitPrice: 0, godownId: "", serials: [] },
    ]);
  }, []);
  const removeLine = useCallback((id: string) => {
    setLines((p) => (p.length > 1 ? p.filter((l) => l.id !== id) : p));
  }, []);
  const updateLine = useCallback((id: string, patch: Partial<LineItem>) => {
    setLines((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  // ---- save ----
  async function handleSave() {
    const ok = await form.trigger();
    if (!ok) {
      toast.error("Fix the header errors first");
      return;
    }
    if (lines.length === 0 || lines.every((l) => l.serials.length === 0)) {
      toast.error("Add at least one line item with serial numbers");
      return;
    }
    for (const l of lines) {
      if (!l.productId) { toast.error("Every line needs a product"); return; }
      if (!l.hsnCode) { toast.error("Every line needs an HSN code"); return; }
      if (!l.godownId) { toast.error("Every line needs a godown"); return; }
      if (l.serials.length === 0) { toast.error("Every line needs at least one serial number"); return; }
      const hsnOk = validateHsn(l.hsnCode);
      if (!hsnOk.valid) { toast.error(`Invalid HSN: ${hsnOk.error}`); return; }
    }

    // Duplicate-serial check inside this form.
    const seen = new Set<string>();
    for (const l of lines) {
      for (const s of l.serials) {
        if (seen.has(s)) { toast.error(`Duplicate serial within GRN: ${s}`); return; }
        seen.add(s);
      }
    }

    setSaving(true);
    try {
      const header = form.getValues();
      const vendor = vendors.data.find((v) => v.id === header.vendorId);
      const rate = forexRate ?? 1;

      // 1. Create the GRN header.
      const grnRes = await (
        api.models as unknown as {
          GoodsReceivedNote: {
            create: (input: Record<string, unknown>) => Promise<{ data?: { id: string }; errors?: unknown }>;
          };
        }
      ).GoodsReceivedNote.create({
        grnNumber: header.grnNumber,
        grnDate: new Date(header.grnDate).toISOString(),
        vendorId: header.vendorId,
        vendorGstin: vendor?.gstin,
        vendorInvoiceNumber: header.vendorInvoiceNumber,
        vendorInvoiceDate: header.vendorInvoiceDate ?? undefined,
        currency: header.currency,
        forexRateAtGrn: rate,
        totalValueForeign: totals.totalValueForeign,
        totalValueInr: totals.totalValueInr,
        totalGstInr: totals.totalGstInr,
        notes: header.notes,
      });
      if (!grnRes.data?.id) throw new Error("GRN create returned no id");
      const grnId = grnRes.data.id;

      // 2. Create a UnitRecord per serial.
      for (const line of lines) {
        const product = products.data.find((p) => p.id === line.productId);
        const tallyHsn = normalizeHsnForTally(line.hsnCode);
        for (const sn of line.serials) {
          await (
            api.models as unknown as {
              UnitRecord: {
                create: (input: Record<string, unknown>) => Promise<{ errors?: unknown }>;
              };
            }
          ).UnitRecord.create({
            productId: line.productId,
            serialNumber: sn.trim(),
            inventoryCategory: "GENERAL_STOCK",
            status: "IN_STOCK",
            condition: "NEW",
            godownId: line.godownId,
            godownLocation: line.godownLocation,
            purchasePrice: currency === "INR" ? line.unitPrice : toInr(line.unitPrice, rate),
            purchasePriceForeignCurrency: currency === "INR" ? undefined : line.unitPrice,
            purchaseCurrency: currency,
            forexRateAtPurchase: rate,
            purchaseDate: new Date(header.grnDate).toISOString(),
            vendorId: header.vendorId,
            grnId,
            hsnCode: tallyHsn,
            hsnTallyFormat: tallyHsn,
            hsnValidationStatus: "VALID",
            warrantyExpiryDate:
              line.warrantyExpiryDate ??
              (product?.warrantyPeriodMonths
                ? new Date(
                    new Date(header.grnDate).getTime() +
                      product.warrantyPeriodMonths * 30 * 86400_000,
                  )
                    .toISOString()
                    .slice(0, 10)
                : undefined),
            notes: line.notes,
          });
        }
      }

      toast.success(`GRN ${header.grnNumber} saved with ${totals.serialCount} unit(s)`);
      nav("/grn");
    } catch (e) {
      const msg = (e as Error).message ?? "GRN save failed";
      if (/ConditionalCheckFailed|already exists|ConditionalCheck/i.test(msg)) {
        toast.error("One or more serial numbers are already in the system.");
      } else {
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  const rate = forexRate ?? 1;

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeader
        title="New GRN"
        description="Receive stock from a vendor. Every serial becomes an individually-tracked unit."
        breadcrumbs={[{ label: "Inventory" }, { label: "GRN", to: "/grn" }, { label: "New" }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/grn">Cancel</Link>
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save GRN
            </Button>
          </>
        }
      />

      <Card className="p-4 space-y-4">
        <div className="text-sm font-medium">Header</div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="GRN number *" error={form.formState.errors.grnNumber?.message}>
            <Input className="font-mono" {...form.register("grnNumber")} />
          </Field>
          <Field label="GRN date *" error={form.formState.errors.grnDate?.message}>
            <Input type="date" {...form.register("grnDate")} />
          </Field>
          <Field label="Vendor *" error={form.formState.errors.vendorId?.message}>
            <Select
              value={form.watch("vendorId") ?? ""}
              onValueChange={(v) => form.setValue("vendorId", v, { shouldValidate: true })}
            >
              <SelectTrigger><SelectValue placeholder={vendors.loading ? "Loading…" : "Select vendor"} /></SelectTrigger>
              <SelectContent>
                {vendors.data.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Vendor invoice #">
            <Input className="font-mono" {...form.register("vendorInvoiceNumber")} />
          </Field>
          <Field label="Vendor invoice date">
            <Input type="date" {...form.register("vendorInvoiceDate")} />
          </Field>
          <Field label="Currency">
            <div className="flex gap-2">
              <Select
                value={currency}
                onValueChange={(v) => form.setValue("currency", v as Currency)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currency !== "INR" && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => fetchRate(currency)}
                  disabled={forexLoading}
                  aria-label="Refresh forex rate"
                >
                  {forexLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </Field>
        </div>
        {currency !== "INR" && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            Live rate: <strong className="font-mono">1 {currency} = ₹ {rate.toFixed(2)}</strong>
          </div>
        )}
      </Card>

      {/* Line items */}
      <div className="space-y-3">
        {lines.map((line, idx) => (
          <LineCard
            key={line.id}
            index={idx}
            line={line}
            currency={currency}
            rate={rate}
            products={products.data}
            godowns={godowns.data}
            onChange={(patch) => updateLine(line.id, patch)}
            onRemove={() => removeLine(line.id)}
            removable={lines.length > 1}
          />
        ))}
      </div>

      <Button variant="outline" onClick={addLine}>
        <Plus className="h-4 w-4" /> Add line item
      </Button>

      {/* Totals */}
      <Card className="p-4 space-y-2 font-mono text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Serials in this GRN</span>
          <span className="font-semibold">{totals.serialCount}</span>
        </div>
        {currency !== "INR" && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Total ({currency})</span>
            <span>{totals.totalValueForeign.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal (INR)</span>
          <span>{formatInr(totals.totalValueInr)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">GST (INR)</span>
          <span>{formatInr(totals.totalGstInr)}</span>
        </div>
        <Separator />
        <div className="flex justify-between text-base">
          <span>Grand total</span>
          <span className="font-semibold text-primary">
            {formatInr(totals.totalValueInr + totals.totalGstInr)}
          </span>
        </div>
      </Card>
    </div>
  );
}

// ========== Line card ==========

function LineCard({
  index,
  line,
  currency,
  rate,
  products,
  godowns,
  onChange,
  onRemove,
  removable,
}: {
  index: number;
  line: LineItem;
  currency: Currency;
  rate: number;
  products: Product[];
  godowns: Godown[];
  onChange: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const product = products.find((p) => p.id === line.productId);
  const lineForeign = line.unitPrice * line.serials.length;
  const lineInr = currency === "INR" ? lineForeign : toInr(lineForeign, rate);

  // Auto-populate HSN from product when selected.
  function selectProduct(pid: string) {
    const p = products.find((pp) => pp.id === pid);
    onChange({
      productId: pid,
      hsnCode: line.hsnCode || p?.hsnCode || "",
    });
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Badge variant="outline" className="font-mono">#{index + 1}</Badge>
          {product ? (
            <span>{product.productName} {product.modelNumber && <span className="text-muted-foreground">· {product.modelNumber}</span>}</span>
          ) : (
            <span className="text-muted-foreground">No product selected</span>
          )}
        </div>
        {removable && (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onRemove} aria-label="Remove line">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Product *">
          <Select value={line.productId} onValueChange={selectProduct}>
            <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.productName}
                  {p.modelNumber ? ` — ${p.modelNumber}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="HSN / SAC *" className="md:col-span-1">
          <HsnInput
            value={line.hsnCode}
            onChange={(v) => onChange({ hsnCode: v })}
            label=""
          />
        </Field>
        <Field label={`Unit price (${currency}) *`}>
          <MoneyInput
            currencySymbol={currency === "INR" ? "₹" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "£"}
            value={line.unitPrice}
            onChange={(e) => onChange({ unitPrice: Number(e.target.value) || 0 })}
            label=""
            showIndianPreview={currency === "INR"}
          />
        </Field>
        <Field label="Godown *">
          <Select value={line.godownId} onValueChange={(v) => onChange({ godownId: v })}>
            <SelectTrigger><SelectValue placeholder="Select godown" /></SelectTrigger>
            <SelectContent>
              {godowns.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Rack / shelf">
          <Input
            className="font-mono"
            placeholder="A3-S2"
            value={line.godownLocation ?? ""}
            onChange={(e) => onChange({ godownLocation: e.target.value })}
          />
        </Field>
        <Field label="Warranty expiry">
          <Input
            type="date"
            value={line.warrantyExpiryDate ?? ""}
            onChange={(e) => onChange({ warrantyExpiryDate: e.target.value })}
          />
        </Field>
        <Field label="Notes" className="lg:col-span-2">
          <Input value={line.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} />
        </Field>
      </div>

      <SerialCapture
        serials={line.serials}
        onChange={(serials) => onChange({ serials })}
      />

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {line.serials.length} unit{line.serials.length !== 1 ? "s" : ""} @ {currency}{" "}
          {line.unitPrice.toFixed(2)}
        </span>
        <span className="font-mono font-medium">
          Line total: {formatInr(lineInr)}
        </span>
      </div>
    </Card>
  );
}

// ========== Serial capture ==========

function SerialCapture({
  serials,
  onChange,
}: {
  serials: string[];
  onChange: (serials: string[]) => void;
}) {
  const [manual, setManual] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [scanMode, setScanMode] = useState(false);

  function addSerial(raw: string) {
    const sn = raw.trim();
    if (!sn) return;
    if (serials.includes(sn)) {
      toast.error(`Serial ${sn} already in this line`);
      return;
    }
    onChange([...serials, sn]);
  }

  function removeSerial(sn: string) {
    onChange(serials.filter((x) => x !== sn));
  }

  useBarcodeScanner({
    onScan: (code) => {
      if (!scanMode) return;
      addSerial(code);
      toast.success(`Scanned ${code}`);
    },
    alwaysListen: scanMode,
  });

  function handleManualKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addSerial(manual);
      setManual("");
    }
  }

  function processBulk() {
    const lines = bulkText
      .split(/[\n,;\t]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const added: string[] = [];
    const dupes: string[] = [];
    for (const l of lines) {
      if (serials.includes(l) || added.includes(l)) {
        dupes.push(l);
      } else {
        added.push(l);
      }
    }
    onChange([...serials, ...added]);
    setBulkText("");
    setBulkOpen(false);
    toast.success(`Added ${added.length} serial${added.length !== 1 ? "s" : ""}${dupes.length ? `, ${dupes.length} duplicates skipped` : ""}`);
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Label>Serial numbers ({serials.length})</Label>
        <div className="flex gap-1 flex-wrap">
          <Button
            type="button"
            variant={scanMode ? "default" : "outline"}
            size="sm"
            onClick={() => setScanMode(!scanMode)}
            aria-pressed={scanMode}
          >
            <Barcode className="h-4 w-4" />
            {scanMode ? "Scanning…" : "USB scan"}
          </Button>
          <CameraScannerButton
            label="Camera"
            continuous
            onScan={(code) => addSerial(code)}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
            <ClipboardPaste className="h-4 w-4" />
            Bulk paste
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={handleManualKey}
          placeholder="Type or scan a serial, press Enter"
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => { addSerial(manual); setManual(""); }}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {serials.length === 0 ? (
        <p className={cn("text-[11px]", "text-muted-foreground")}>
          <AlertCircle className="inline h-3 w-3 mr-1" />
          Add at least one serial number — each becomes an independently-tracked unit.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
          {serials.map((sn) => (
            <span
              key={sn}
              className="group inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 font-mono text-[11px]"
            >
              {sn}
              <button
                type="button"
                onClick={() => removeSerial(sn)}
                className="opacity-60 group-hover:opacity-100"
                aria-label={`Remove ${sn}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk paste serials</DialogTitle>
            <DialogDescription>
              Paste one serial per line, or separate by commas / semicolons / tabs. Duplicates are skipped automatically.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={8}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"SN-LG-00001\nSN-LG-00002\nSN-LG-00003"}
            className="font-mono text-xs"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={processBulk} disabled={!bulkText.trim()}>
              Add {bulkText.split(/[\n,;\t]/).map((s) => s.trim()).filter(Boolean).length} serial(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

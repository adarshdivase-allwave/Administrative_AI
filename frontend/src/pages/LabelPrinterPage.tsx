import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Printer, QrCode, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCrud } from "@/hooks/use-crud";
import { cn } from "@/lib/cn";

/**
 * QR label printer.
 *
 * Renders 50×30 mm or 40×25 mm thermal-printer labels. Each label has:
 *   - Product name + model
 *   - Serial number (bold, mono)
 *   - QR code encoding https://<host>/unit/<unitId>
 *   - Brand + godown location + warranty expiry (if present)
 *
 * Uses `window.print()` — the CSS `@page` rule sizes for thermal printers.
 * Works with any browser-visible printer (Zebra, Brother, Dymo, etc.).
 */

interface Unit {
  id: string;
  serialNumber?: string;
  productId?: string;
  godownLocation?: string;
  warrantyExpiryDate?: string;
}
interface Product {
  id: string;
  productName?: string;
  modelNumber?: string;
  brand?: string;
}

const SIZES = {
  "50x30": { widthMm: 50, heightMm: 30, qrPx: 70 },
  "40x25": { widthMm: 40, heightMm: 25, qrPx: 56 },
  "80x40": { widthMm: 80, heightMm: 40, qrPx: 100 },
} as const;
type SizeKey = keyof typeof SIZES;

export function LabelPrinterPage() {
  const units = useCrud<Unit>("UnitRecord", { limit: 500 });
  const products = useCrud<Product>("ProductMaster");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [size, setSize] = useState<SizeKey>("50x30");
  const [qrDataByUnit, setQrDataByUnit] = useState<Record<string, string>>({});
  const printRef = useRef<HTMLDivElement>(null);

  const productById = useMemo(() => new Map(products.data.map((p) => [p.id, p])), [products.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return units.data;
    return units.data.filter((u) => {
      const p = productById.get(u.productId ?? "");
      return (
        (u.serialNumber ?? "").toLowerCase().includes(q) ||
        (p?.productName ?? "").toLowerCase().includes(q) ||
        (p?.modelNumber ?? "").toLowerCase().includes(q)
      );
    });
  }, [units.data, productById, query]);

  const selectedUnits = useMemo(
    () => units.data.filter((u) => selected.has(u.id)),
    [units.data, selected],
  );

  // Generate QR data URLs for selected units.
  useEffect(() => {
    const missing = selectedUnits.filter((u) => !qrDataByUnit[u.id]);
    if (missing.length === 0) return;
    void (async () => {
      const next = { ...qrDataByUnit };
      for (const u of missing) {
        const url = `${window.location.origin}/unit/${u.id}`;
        next[u.id] = await QRCode.toDataURL(url, { margin: 1, width: 140 });
      }
      setQrDataByUnit(next);
    })();
  }, [selectedUnits, qrDataByUnit]);

  function togglePick(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((u) => u.id)));
  }

  function doPrint() {
    // Apply @page size via a dynamically-injected style tag.
    const s = SIZES[size];
    const style = document.createElement("style");
    style.id = "label-print-style";
    style.textContent = `
      @media print {
        @page { size: ${s.widthMm}mm ${s.heightMm}mm; margin: 0; }
        body * { visibility: hidden; }
        #label-print-root, #label-print-root * { visibility: visible; }
        #label-print-root { position: absolute; top: 0; left: 0; width: 100%; }
        .label-card {
          page-break-after: always;
          break-after: page;
        }
      }
    `;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => style.remove(), 1000);
  }

  const s = SIZES[size];

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        title="QR label printer"
        description="Print scan-ready labels for any unit. Works with thermal printers (Zebra, Brother, Dymo) over the browser."
        breadcrumbs={[{ label: "Inventory" }, { label: "Labels" }]}
        actions={
          <Button onClick={doPrint} disabled={selected.size === 0}>
            <Printer className="h-4 w-4" /> Print {selected.size} label{selected.size !== 1 ? "s" : ""}
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by serial, product, model..."
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={toggleAll}>
              {selected.size === filtered.length && filtered.length > 0 ? "Clear all" : "Select all"}
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-auto divide-y border rounded-md">
            {filtered.map((u) => {
              const p = productById.get(u.productId ?? "");
              const checked = selected.has(u.id);
              return (
                <label
                  key={u.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 p-2 hover:bg-accent/40",
                    checked && "bg-primary/5",
                  )}
                >
                  <Checkbox checked={checked} onChange={() => togglePick(u.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{p?.productName ?? "(unknown)"}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {u.serialNumber} · {u.godownLocation ?? "—"}
                    </div>
                  </div>
                </label>
              );
            })}
            {filtered.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No units match.
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <QrCode className="h-4 w-4 text-muted-foreground" /> Settings
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Label size</Label>
            <Select value={size} onValueChange={(v) => setSize(v as SizeKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="50x30">50 × 30 mm (standard)</SelectItem>
                <SelectItem value="40x25">40 × 25 mm (compact)</SelectItem>
                <SelectItem value="80x40">80 × 40 mm (large)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-[11px] text-muted-foreground space-y-1">
            <p>Tips:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>For thermal printers, disable browser margins in the print dialog.</li>
              <li>Use "Save as PDF" first to preview before feeding label stock.</li>
              <li>The QR encodes the full unit URL — logged-in users see the full unit page; anonymous scanners see a read-only summary.</li>
            </ul>
          </div>
        </Card>
      </div>

      {/* Preview (and the element we actually print) */}
      {selectedUnits.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">
            Preview ({selectedUnits.length} label{selectedUnits.length !== 1 ? "s" : ""})
          </div>
          <div
            id="label-print-root"
            ref={printRef}
            className="flex flex-wrap gap-3 p-2 bg-muted/30 rounded-md"
          >
            {selectedUnits.map((u) => {
              const p = productById.get(u.productId ?? "");
              return (
                <div
                  key={u.id}
                  className="label-card bg-white text-black border rounded-sm flex gap-2 p-2 font-mono"
                  style={{ width: `${s.widthMm}mm`, height: `${s.heightMm}mm`, fontFamily: "sans-serif" }}
                >
                  {qrDataByUnit[u.id] && (
                    <img
                      src={qrDataByUnit[u.id]}
                      alt="QR"
                      style={{ width: s.qrPx, height: s.qrPx, flexShrink: 0 }}
                    />
                  )}
                  <div className="flex-1 min-w-0 text-[10px] leading-tight space-y-0.5">
                    <div className="font-bold truncate">{p?.productName ?? "—"}</div>
                    <div className="text-[9px] text-gray-600 truncate">
                      {p?.brand}
                      {p?.modelNumber ? ` · ${p.modelNumber}` : ""}
                    </div>
                    <div className="font-mono font-bold">{u.serialNumber}</div>
                    <div className="text-[9px] text-gray-600">
                      {u.godownLocation ?? ""}
                    </div>
                    {u.warrantyExpiryDate && (
                      <div className="text-[9px] text-gray-600">W: {u.warrantyExpiryDate}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/amplify-client";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/components/ui/toast";
import { formatInr } from "@shared/currency";
import { formatIST } from "@shared/fy";
import { cn } from "@/lib/cn";
import * as React from "react";
// Ensure React in scope for JSX (StrictMode setup)
void React;

interface Grn {
  id: string;
  grnNumber?: string;
  grnDate?: string;
  vendorId?: string;
  vendorGstin?: string;
  vendorInvoiceNumber?: string;
  vendorInvoiceDate?: string;
  currency?: string;
  forexRateAtGrn?: number;
  totalValueInr?: number;
  totalValueForeign?: number;
  totalGstInr?: number;
  intrastate?: boolean;
  tallyXmlS3Key?: string;
  tallyExportedAt?: string;
  notes?: string;
}
interface Vendor { id: string; name: string; gstin?: string; contactEmail?: string }
interface Unit {
  id: string;
  serialNumber?: string;
  productId?: string;
  grnId?: string;
  purchasePrice?: number;
  purchasePriceForeignCurrency?: number;
  hsnCode?: string;
  hsnTallyFormat?: string;
  warrantyExpiryDate?: string;
  godownLocation?: string;
  condition?: string;
  inventoryCategory?: string;
  status?: string;
}
interface Product { id: string; productName?: string; brand?: string; modelNumber?: string; gstRatePercent?: number }

export function GrnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [grn, setGrn] = useState<Grn | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const grnRes = await (api.models as unknown as {
          GoodsReceivedNote: { get: (args: { id: string }) => Promise<{ data?: Grn }> };
        }).GoodsReceivedNote.get({ id });
        if (cancelled) return;
        const g = grnRes.data;
        if (!g) {
          setError("GRN not found");
          return;
        }
        setGrn(g);

        // Parallel: vendor + units + products-used
        const [vendorRes, unitsRes] = await Promise.all([
          g.vendorId
            ? (api.models as unknown as {
                Vendor: { get: (args: { id: string }) => Promise<{ data?: Vendor }> };
              }).Vendor.get({ id: g.vendorId })
            : Promise.resolve({ data: null }),
          (api.models as unknown as {
            UnitRecord: { list: (args: { filter: unknown; limit: number }) => Promise<{ data?: Unit[] }> };
          }).UnitRecord.list({ filter: { grnId: { eq: id } }, limit: 500 }),
        ]);

        if (cancelled) return;
        setVendor(vendorRes?.data ?? null);
        const unitData = unitsRes.data ?? [];
        setUnits(unitData);

        const productIds = [...new Set(unitData.map((u) => u.productId).filter(Boolean) as string[])];
        if (productIds.length > 0) {
          const productResults = await Promise.all(
            productIds.map((pid) =>
              (api.models as unknown as {
                ProductMaster: { get: (args: { id: string }) => Promise<{ data?: Product }> };
              }).ProductMaster.get({ id: pid }),
            ),
          );
          if (cancelled) return;
          const map = new Map(
            productResults
              .map((r) => r.data)
              .filter((p): p is Product => Boolean(p))
              .map((p) => [p.id, p]),
          );
          setProducts(map);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function exportTally() {
    if (!id) return;
    setExporting(true);
    try {
      const res = await (api as unknown as {
        mutations: {
          generateTallyExport: (args: { kind: string; grnId: string }) => Promise<{
            data?: { presignedUrl: string; xmlSize: number };
          }>;
        };
      }).mutations.generateTallyExport({ kind: "GRN", grnId: id });
      if (res.data?.presignedUrl) {
        window.open(res.data.presignedUrl, "_blank", "noopener");
        toast.success(`Tally XML exported (${res.data.xmlSize} bytes)`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const lineGroups = useMemo(() => {
    // Group by productId so we show "10 × LG 55UR640S" not 10 individual rows.
    const byProduct = new Map<string, { units: Unit[]; product: Product | undefined }>();
    for (const u of units) {
      const pid = u.productId ?? "__none";
      const existing = byProduct.get(pid);
      if (existing) existing.units.push(u);
      else byProduct.set(pid, { units: [u], product: products.get(pid) });
    }
    return [...byProduct.values()];
  }, [units, products]);

  if (loading) {
    return (
      <div className="space-y-4 max-w-5xl">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (error || !grn) {
    return (
      <Card className="p-6 text-center space-y-2 max-w-md mx-auto">
        <p className="text-sm font-medium">{error ?? "GRN not found"}</p>
        <Button asChild variant="outline">
          <Link to="/grn"><ArrowLeft className="h-4 w-4" /> Back to GRN list</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        title={grn.grnNumber ?? "GRN"}
        description={
          grn.grnDate
            ? `Received ${formatIST(new Date(grn.grnDate))} · ${units.length} unit${units.length !== 1 ? "s" : ""}`
            : "GRN detail"
        }
        breadcrumbs={[{ label: "Inventory" }, { label: "GRN", to: "/grn" }, { label: grn.grnNumber ?? "" }]}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            {isAdmin && (
              <Button onClick={exportTally} disabled={exporting}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Tally XML
              </Button>
            )}
          </>
        }
      />

      {grn.tallyExportedAt && (
        <div className="rounded-md border border-success/40 bg-success/5 p-2 text-xs">
          Tally XML last exported {formatIST(new Date(grn.tallyExportedAt))}
        </div>
      )}

      {/* Header grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Vendor</div>
          <dl className="space-y-1 text-sm">
            <Row label="Name" value={vendor?.name} />
            <Row label="GSTIN" value={grn.vendorGstin ?? vendor?.gstin} mono />
            <Row label="Email" value={vendor?.contactEmail} />
          </dl>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Vendor invoice</div>
          <dl className="space-y-1 text-sm">
            <Row label="Invoice #" value={grn.vendorInvoiceNumber} mono />
            <Row
              label="Invoice date"
              value={grn.vendorInvoiceDate ? formatIST(new Date(grn.vendorInvoiceDate)) : undefined}
            />
            <Row label="Currency" value={grn.currency} />
            {grn.currency && grn.currency !== "INR" && grn.forexRateAtGrn && (
              <Row
                label="Forex rate"
                value={`1 ${grn.currency} = ₹ ${grn.forexRateAtGrn.toFixed(2)}`}
                mono
              />
            )}
          </dl>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Totals</div>
          <dl className="space-y-1 text-sm">
            {grn.currency && grn.currency !== "INR" && (
              <Row label={`Total (${grn.currency})`} value={grn.totalValueForeign?.toFixed(2)} mono />
            )}
            <Row
              label="Subtotal (INR)"
              value={grn.totalValueInr ? formatInr(grn.totalValueInr) : "—"}
              mono
            />
            <Row
              label="GST (INR)"
              value={grn.totalGstInr ? formatInr(grn.totalGstInr) : "—"}
              mono
            />
            <Row
              label="Grand total"
              value={
                grn.totalValueInr && grn.totalGstInr
                  ? formatInr(grn.totalValueInr + grn.totalGstInr)
                  : "—"
              }
              mono
              bold
            />
          </dl>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Notes</div>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {grn.notes ?? "No notes."}
          </p>
        </Card>
      </div>

      {/* Line groups */}
      <Card className="p-4">
        <div className="text-sm font-medium mb-3">
          Units ({units.length}) — grouped by product
        </div>
        {lineGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No units linked to this GRN.
          </p>
        ) : (
          <div className="space-y-4">
            {lineGroups.map((g, i) => (
              <LineGroup key={i} product={g.product} units={g.units} currency={grn.currency} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function LineGroup({
  product,
  units,
  currency,
}: {
  product: Product | undefined;
  units: Unit[];
  currency?: string;
}) {
  const sample = units[0];
  return (
    <div className="border rounded-md">
      <div className="flex items-center justify-between border-b bg-muted/40 p-2">
        <div>
          <div className="font-medium text-sm">{product?.productName ?? "(unknown product)"}</div>
          <div className="text-xs text-muted-foreground">
            {product?.brand}
            {product?.modelNumber ? ` · ${product.modelNumber}` : ""}
            {sample?.hsnTallyFormat && (
              <>
                {" · HSN "}
                <span className="font-mono">{sample.hsnTallyFormat}</span>
                {product?.gstRatePercent != null && ` · GST ${product.gstRatePercent}%`}
              </>
            )}
          </div>
        </div>
        <Badge variant="outline">{units.length} unit{units.length !== 1 ? "s" : ""}</Badge>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <th className="p-2 text-left">Serial #</th>
              <th className="p-2 text-left">Location</th>
              <th className="p-2 text-left">Condition</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Warranty</th>
              <th className="p-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className="border-b last:border-b-0">
                <td className="p-2 font-mono">{u.serialNumber ?? "—"}</td>
                <td className="p-2 font-mono text-muted-foreground">{u.godownLocation ?? "—"}</td>
                <td className="p-2">{u.condition ?? "—"}</td>
                <td className="p-2"><Badge variant="outline" className="text-[9px]">{u.status ?? "—"}</Badge></td>
                <td className="p-2">{u.warrantyExpiryDate ?? "—"}</td>
                <td className="p-2 text-right font-mono">
                  {currency === "INR" || !u.purchasePriceForeignCurrency
                    ? u.purchasePrice
                      ? formatInr(u.purchasePrice, { showSymbol: false })
                      : "—"
                    : u.purchasePriceForeignCurrency.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  bold,
}: {
  label: string;
  value?: string | number;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn(mono && "font-mono", bold && "font-semibold")}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Download, Loader2, Mail, Printer, Truck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/amplify-client";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/components/ui/toast";
import { formatInr } from "@shared/currency";
import { formatIST } from "@shared/fy";
import { cn } from "@/lib/cn";

interface Dc {
  id: string;
  dcNumber?: string;
  dcDate?: string;
  dcType?: string;
  clientId?: string;
  projectId?: string;
  deliveryAddressLine1?: string;
  deliveryCity?: string;
  deliveryState?: string;
  deliveryPincode?: string;
  transporterName?: string;
  vehicleNumber?: string;
  lrDocketNumber?: string;
  eWayBillNumber?: string;
  eWayBillRequired?: boolean;
  totalValueInr?: number;
  totalGstInr?: number;
  intrastate?: boolean;
  status?: string;
  tallyExportedAt?: string;
  notes?: string;
}
interface Client { id: string; name: string; gstin?: string; billingEmail?: string }
interface Project { id: string; projectName: string }
interface Line {
  id: string;
  unitId?: string;
  productName?: string;
  modelNumber?: string;
  hsnTallyFormat?: string;
  unitPriceInr?: number;
  gstRatePercent?: number;
}

export function DcDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [dc, setDc] = useState<Dc | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [voucherType, setVoucherType] = useState<"Sales" | "Delivery Note">("Sales");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const dcRes = await (api.models as unknown as {
          DeliveryChallan: { get: (args: { id: string }) => Promise<{ data?: Dc }> };
        }).DeliveryChallan.get({ id });
        if (cancelled) return;
        const d = dcRes.data;
        if (!d) { setError("DC not found"); return; }
        setDc(d);

        const [clientRes, projectRes, linesRes] = await Promise.all([
          d.clientId
            ? (api.models as unknown as {
                Client: { get: (args: { id: string }) => Promise<{ data?: Client }> };
              }).Client.get({ id: d.clientId })
            : Promise.resolve({ data: null }),
          d.projectId
            ? (api.models as unknown as {
                Project: { get: (args: { id: string }) => Promise<{ data?: Project }> };
              }).Project.get({ id: d.projectId })
            : Promise.resolve({ data: null }),
          (api.models as unknown as {
            DispatchLineItem: {
              list: (args: { filter: unknown; limit: number }) => Promise<{ data?: Line[] }>;
            };
          }).DispatchLineItem.list({
            filter: { deliveryChallanId: { eq: id } },
            limit: 500,
          }),
        ]);
        if (cancelled) return;
        setClient(clientRes?.data ?? null);
        setProject(projectRes?.data ?? null);
        setLines(linesRes.data ?? []);
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
          generateTallyExport: (args: {
            kind: string;
            dcId: string;
            voucherType: string;
          }) => Promise<{ data?: { presignedUrl: string } }>;
        };
      }).mutations.generateTallyExport({
        kind: "DC",
        dcId: id,
        voucherType,
      });
      if (res.data?.presignedUrl) {
        window.open(res.data.presignedUrl, "_blank", "noopener");
        toast.success("Tally XML exported");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function acknowledge() {
    if (!id) return;
    try {
      await (api.models as unknown as {
        DeliveryChallan: { update: (input: Record<string, unknown>) => Promise<{ errors?: unknown }> };
      }).DeliveryChallan.update({ id, status: "ACKNOWLEDGED" });
      toast.success("Marked as acknowledged");
      setDc((d) => (d ? { ...d, status: "ACKNOWLEDGED" } : d));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-5xl">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (error || !dc) {
    return (
      <Card className="p-6 text-center space-y-2 max-w-md mx-auto">
        <p className="text-sm font-medium">{error ?? "DC not found"}</p>
        <Button asChild variant="outline">
          <Link to="/dc"><ArrowLeft className="h-4 w-4" /> Back to DC list</Link>
        </Button>
      </Card>
    );
  }

  const eWayRequired = Boolean(dc.eWayBillRequired || (dc.totalValueInr ?? 0) >= 50_000);

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        title={dc.dcNumber ?? "DC"}
        description={
          dc.dcDate
            ? `Dispatched ${formatIST(new Date(dc.dcDate))} · Type ${dc.dcType ?? "—"}`
            : "Delivery challan detail"
        }
        breadcrumbs={[{ label: "Inventory" }, { label: "DC", to: "/dc" }, { label: dc.dcNumber ?? "" }]}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            {dc.status === "DISPATCHED" && isAdmin && (
              <Button variant="outline" onClick={acknowledge}>
                <CheckCircle2 className="h-4 w-4" /> Mark acknowledged
              </Button>
            )}
            {isAdmin && (
              <div className="flex items-center gap-1">
                <Select value={voucherType} onValueChange={(v) => setVoucherType(v as "Sales" | "Delivery Note")}>
                  <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Sales">Sales voucher</SelectItem>
                    <SelectItem value="Delivery Note">Delivery Note</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={exportTally} disabled={exporting}>
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Tally
                </Button>
              </div>
            )}
          </>
        }
      />

      {dc.status && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status:</span>
          <Badge
            variant={
              dc.status === "CLOSED" ? "success" :
              dc.status === "DISPATCHED" ? "default" :
              dc.status === "ACKNOWLEDGED" ? "default" : "secondary"
            }
          >
            {dc.status.replace(/_/g, " ")}
          </Badge>
          {eWayRequired && (
            <Badge variant={dc.eWayBillNumber ? "success" : "destructive"}>
              e-Way Bill {dc.eWayBillNumber ? `✓ ${dc.eWayBillNumber}` : "missing"}
            </Badge>
          )}
          {dc.tallyExportedAt && (
            <Badge variant="outline">
              Tally exported {formatIST(new Date(dc.tallyExportedAt))}
            </Badge>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Recipient</div>
          <dl className="space-y-1 text-sm">
            <Row label="Client" value={client?.name} />
            <Row label="GSTIN" value={client?.gstin} mono />
            <Row label="Billing email" value={client?.billingEmail} />
            <Row label="Project" value={project?.projectName} />
          </dl>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Delivery address</div>
          <dl className="space-y-1 text-sm">
            <Row label="Address" value={dc.deliveryAddressLine1} />
            <Row
              label="City / State"
              value={[dc.deliveryCity, dc.deliveryState].filter(Boolean).join(", ")}
            />
            <Row label="Pincode" value={dc.deliveryPincode} mono />
            <Row
              label="Supply type"
              value={dc.intrastate ? "Intrastate (CGST + SGST)" : "Interstate (IGST)"}
            />
          </dl>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2 flex items-center gap-2">
            <Truck className="h-4 w-4 text-muted-foreground" /> Transporter
          </div>
          <dl className="space-y-1 text-sm">
            <Row label="Transporter" value={dc.transporterName} />
            <Row label="Vehicle" value={dc.vehicleNumber} mono />
            <Row label="LR / docket" value={dc.lrDocketNumber} mono />
            <Row label="e-Way Bill" value={dc.eWayBillNumber} mono />
          </dl>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">Totals</div>
          <dl className="space-y-1 text-sm">
            <Row label="Subtotal" value={dc.totalValueInr ? formatInr(dc.totalValueInr) : undefined} mono />
            <Row
              label={dc.intrastate ? "CGST + SGST" : "IGST"}
              value={dc.totalGstInr ? formatInr(dc.totalGstInr) : undefined}
              mono
            />
            <Row
              label="Grand total"
              value={
                dc.totalValueInr != null
                  ? formatInr((dc.totalValueInr ?? 0) + (dc.totalGstInr ?? 0))
                  : undefined
              }
              mono
              bold
            />
          </dl>
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Line items ({lines.length})</div>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No line items recorded.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="border-b">
                <tr className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="p-2 text-left">Unit</th>
                  <th className="p-2 text-left">Product</th>
                  <th className="p-2 text-left">HSN</th>
                  <th className="p-2 text-right">Price (INR)</th>
                  <th className="p-2 text-right">GST %</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-b-0">
                    <td className="p-2 font-mono text-[10px]">{l.unitId?.slice(0, 12) ?? "—"}</td>
                    <td className="p-2">
                      <div>{l.productName ?? "—"}</div>
                      {l.modelNumber && <div className="text-[10px] text-muted-foreground">{l.modelNumber}</div>}
                    </td>
                    <td className="p-2 font-mono">{l.hsnTallyFormat ?? "—"}</td>
                    <td className="p-2 text-right font-mono">
                      {l.unitPriceInr ? formatInr(l.unitPriceInr, { showSymbol: false }) : "—"}
                    </td>
                    <td className="p-2 text-right">{l.gstRatePercent ?? "—"}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dc.notes && (
        <Card className="p-4">
          <div className="text-sm font-medium mb-1">Notes</div>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{dc.notes}</p>
        </Card>
      )}

      {client?.billingEmail && (
        <Card className="p-3 text-xs flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          Email DC PDF to {client.billingEmail} — SES integration pending UI; the backend <code>DC_TO_CLIENT</code> template is ready.
        </Card>
      )}
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

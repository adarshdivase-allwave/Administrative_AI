import { useState } from "react";
import { Link } from "react-router-dom";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, Download, Truck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { useCrud } from "@/hooks/use-crud";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/amplify-client";
import { formatInr } from "@shared/currency";
import { formatIST } from "@shared/fy";
import { useAuthStore } from "@/stores/auth-store";

interface Dc {
  id: string;
  dcNumber?: string;
  dcDate?: string;
  dcType?: string;
  clientId?: string;
  projectId?: string;
  totalValueInr?: number;
  eWayBillNumber?: string;
  status?: string;
}
interface Client {
  id: string;
  name: string;
}

export function DcListPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const crud = useCrud<Dc>("DeliveryChallan");
  const clients = useCrud<Client>("Client");
  const [exporting, setExporting] = useState<string | null>(null);
  const clientById = new Map(clients.data.map((c) => [c.id, c]));

  async function exportTally(dcId: string, kind: "Sales" | "Delivery Note") {
    if (!isAdmin) {
      toast.error("Only Admin can export to Tally");
      return;
    }
    setExporting(dcId);
    try {
      const res = await (
        api as unknown as {
          mutations: {
            generateTallyExport: (args: {
              kind: string;
              dcId: string;
              voucherType: string;
            }) => Promise<{ data?: { presignedUrl: string } }>;
          };
        }
      ).mutations.generateTallyExport({ kind: "DC", dcId, voucherType: kind });
      if (res.data?.presignedUrl) {
        window.open(res.data.presignedUrl, "_blank", "noopener");
        toast.success("Tally XML ready");
      } else {
        toast.error("Export failed");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(null);
    }
  }

  const columns: ColumnDef<Dc>[] = [
    {
      accessorKey: "dcNumber",
      header: "DC #",
      cell: ({ row }) => (
        <Link to={`/dc/${row.original.id}`} className="font-mono text-xs font-medium hover:underline">
          {row.original.dcNumber ?? row.original.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      accessorKey: "dcDate",
      header: "Date",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return <span className="text-xs">{v ? formatIST(new Date(v)) : "—"}</span>;
      },
    },
    {
      accessorKey: "dcType",
      header: "Type",
      cell: ({ getValue }) => <Badge variant="outline">{(getValue() as string) ?? "—"}</Badge>,
    },
    {
      accessorKey: "clientId",
      header: "Client",
      cell: ({ getValue }) => (
        <span className="text-xs">{clientById.get(getValue() as string)?.name ?? "—"}</span>
      ),
    },
    {
      accessorKey: "totalValueInr",
      header: () => <div className="text-right">Total</div>,
      cell: ({ getValue }) => {
        const v = getValue() as number | undefined;
        return <div className="text-right font-mono text-xs">{v ? formatInr(v, { showSymbol: false }) : "—"}</div>;
      },
    },
    {
      accessorKey: "eWayBillNumber",
      header: "e-Way Bill",
      cell: ({ getValue, row }) => {
        const v = getValue() as string | undefined;
        const value = row.original.totalValueInr ?? 0;
        if (v) return <Badge variant="success" className="font-mono text-[10px]">{v}</Badge>;
        if (value >= 50_000) return <Badge variant="destructive">Missing (required)</Badge>;
        return <span className="text-muted-foreground text-xs">—</span>;
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const s = getValue() as string | undefined;
        const variant: "default" | "secondary" | "warning" | "success" =
          s === "CLOSED" ? "success" : s === "DISPATCHED" ? "default" : s === "ACKNOWLEDGED" ? "default" : "secondary";
        return <Badge variant={variant}>{s?.replace(/_/g, " ") ?? "—"}</Badge>;
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportTally(row.original.id, "Sales")}
              disabled={exporting === row.original.id}
            >
              <Download className="h-3.5 w-3.5" /> Tally
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Delivery Challans"
        description="Outbound movement. DC moves units from General Stock to Project / Demo / Standby / Asset."
        breadcrumbs={[{ label: "Inventory" }, { label: "DC" }]}
        actions={
          <Button asChild>
            <Link to="/dc/new">
              <Plus className="h-4 w-4" /> New DC
            </Link>
          </Button>
        }
      />
      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search DC #, client..."
        emptyTitle="No delivery challans yet"
        emptyDescription="Create a DC to dispatch units to a project or demo."
        emptyAction={
          <Button size="sm" asChild>
            <Link to="/dc/new">
              <Plus className="h-4 w-4" /> New DC
            </Link>
          </Button>
        }
        initialSorting={[{ id: "dcDate", desc: true }]}
      />
      {crud.data.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Truck className="h-3 w-3" />
          {crud.data.length} DC{crud.data.length !== 1 ? "s" : ""} issued.
        </p>
      )}
    </div>
  );
}

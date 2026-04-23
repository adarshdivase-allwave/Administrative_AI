import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, ClipboardList, Download } from "lucide-react";
import { Link } from "react-router-dom";
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

interface Grn {
  id: string;
  grnNumber?: string;
  grnDate?: string;
  vendorId?: string;
  vendorInvoiceNumber?: string;
  currency?: string;
  totalValueInr?: number;
  tallyXmlS3Key?: string;
  tallyExportedAt?: string;
}
interface Vendor {
  id: string;
  name: string;
}

export function GrnListPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const crud = useCrud<Grn>("GoodsReceivedNote");
  const vendors = useCrud<Vendor>("Vendor");
  const [exporting, setExporting] = useState<string | null>(null);

  const vendorById = new Map(vendors.data.map((v) => [v.id, v]));

  async function exportTally(grnId: string) {
    if (!isAdmin) {
      toast.error("Only Admin can export to Tally");
      return;
    }
    setExporting(grnId);
    try {
      const res = await (
        api as unknown as {
          mutations: {
            generateTallyExport: (args: {
              kind: string;
              grnId: string;
            }) => Promise<{ data?: { presignedUrl: string }; errors?: unknown }>;
          };
        }
      ).mutations.generateTallyExport({ kind: "GRN", grnId });
      if (res.data?.presignedUrl) {
        window.open(res.data.presignedUrl, "_blank", "noopener");
        toast.success("Tally XML ready");
        await crud.reload();
      } else {
        toast.error("Export failed — check Tally ledger map in System Settings");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(null);
    }
  }

  const columns: ColumnDef<Grn>[] = [
    {
      accessorKey: "grnNumber",
      header: "GRN #",
      cell: ({ row }) => (
        <Link
          to={`/grn/${row.original.id}`}
          className="font-mono text-xs font-medium hover:underline"
        >
          {row.original.grnNumber ?? row.original.id.slice(0, 8)}
        </Link>
      ),
    },
    {
      accessorKey: "grnDate",
      header: "Date",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return <span className="text-xs">{v ? formatIST(new Date(v)) : "—"}</span>;
      },
    },
    {
      accessorKey: "vendorId",
      header: "Vendor",
      cell: ({ getValue }) => (
        <span className="text-xs">{vendorById.get(getValue() as string)?.name ?? "—"}</span>
      ),
    },
    {
      accessorKey: "vendorInvoiceNumber",
      header: "Invoice #",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{(getValue() as string) ?? "—"}</span>
      ),
    },
    {
      accessorKey: "currency",
      header: "Cur.",
      cell: ({ getValue }) => (
        <Badge variant="outline" className="font-mono text-[10px]">
          {(getValue() as string) ?? "INR"}
        </Badge>
      ),
    },
    {
      accessorKey: "totalValueInr",
      header: () => <div className="text-right">Total</div>,
      cell: ({ getValue }) => {
        if (!isAdmin) return <div className="text-right text-muted-foreground">—</div>;
        const v = getValue() as number | undefined;
        return (
          <div className="text-right font-mono text-xs">
            {v ? formatInr(v, { showSymbol: false }) : "—"}
          </div>
        );
      },
    },
    {
      accessorKey: "tallyExportedAt",
      header: "Tally",
      cell: ({ getValue }) =>
        getValue() ? <Badge variant="success">Exported</Badge> : <Badge variant="outline">—</Badge>,
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
              onClick={() => exportTally(row.original.id)}
              disabled={exporting === row.original.id}
            >
              <Download className="h-3.5 w-3.5" /> Tally XML
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Goods Received Notes"
        description="Vendor inbound. Each GRN records physical units with serial numbers, HSN, and forex-converted costs."
        breadcrumbs={[{ label: "Inventory" }, { label: "GRN" }]}
        actions={
          <Button asChild>
            <Link to="/grn/new">
              <Plus className="h-4 w-4" /> New GRN
            </Link>
          </Button>
        }
      />
      <DataTable
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        error={crud.error}
        searchPlaceholder="Search by GRN #, invoice, vendor..."
        emptyTitle="No GRNs yet"
        emptyDescription="Create your first GRN to receive stock from a vendor."
        emptyAction={
          <Button size="sm" asChild>
            <Link to="/grn/new">
              <Plus className="h-4 w-4" /> New GRN
            </Link>
          </Button>
        }
        initialSorting={[{ id: "grnDate", desc: true }]}
      />
      {crud.data.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <ClipboardList className="h-3 w-3" />
          {crud.data.length} GRN{crud.data.length !== 1 ? "s" : ""} in the database.
        </p>
      )}
    </div>
  );
}
